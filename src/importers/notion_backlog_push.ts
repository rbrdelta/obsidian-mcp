/**
 * Push Master Backlog epics from vault → Notion database.
 *
 * Model:
 *   Initiative (property) → Epic (Notion row) → Deliverables (counted from vault checkboxes)
 *
 * Epic definitions live in config/backlog_epics.json. The parser reads the Master Backlog
 * markdown, matches deliverables to epics via section context and keyword patterns,
 * and pushes to Notion.
 *
 * Two databases under the top-level "Claude" page (workspace-level, visible in sidebar):
 *   - "Active" — active epics (stack-ranked)
 *   - "Archive" — completed epics (velocity history)
 *
 * Auth: Set NOTION_TOKEN env var with your integration token.
 *
 * Usage:
 *   NOTION_TOKEN=ntn_... npx ts-node src/importers/notion_backlog_push.ts [--dry-run]
 */

import * as fs from 'fs';
import * as path from 'path';
import * as https from 'https';
import { resolvePath } from '../utils/vault_ops';

const NOTION_VERSION = '2022-06-28';
const RATE_LIMIT_MS = 350;

const BACKLOG_PATH = 'Inbox/Master Backlog.md';
const SYNC_DIR = 'Inbox';
const SYNC_INDEX_FILENAME = '.notion_backlog_sync.json';
const CONFIG_PATH = path.join(__dirname, '../../config/backlog_epics.json');

// --- Notion API client ---

function notionRequest<T>(method: string, urlPath: string, token: string, body?: unknown): Promise<T> {
  return new Promise((resolve, reject) => {
    const options: https.RequestOptions = {
      hostname: 'api.notion.com',
      path: urlPath,
      method,
      headers: {
        'Authorization': `Bearer ${token}`,
        'Notion-Version': NOTION_VERSION,
        'Content-Type': 'application/json',
      },
    };
    const req = https.request(options, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
          try { resolve(JSON.parse(text)); }
          catch (e) { reject(new Error(`Failed to parse Notion response: ${e}`)); }
        } else if (res.statusCode === 401) {
          reject(new Error('Auth failed. Check your NOTION_TOKEN.'));
        } else if (res.statusCode === 429) {
          reject(new Error('Rate limited. Wait and retry.'));
        } else {
          reject(new Error(`Notion API ${res.statusCode}: ${text}`));
        }
      });
    });
    req.on('error', reject);
    req.setTimeout(30000, () => req.destroy(new Error('Timeout')));
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// --- Config types ---

interface EpicMatchConfig {
  sections: string[];
  subsections: string[];
  keywords: string[];
}

interface EpicConfig {
  key: string;
  name: string;
  initiative: string;
  tier: string;
  theme: string;
  why: string;
  match: EpicMatchConfig;
}

interface BacklogConfig {
  epics: EpicConfig[];
  dedup_keywords: string[];
  skip_keywords: string[];
}

function loadConfig(): BacklogConfig {
  return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
}

// --- Sync state ---

interface SyncEntry {
  notion_page_id: string;
  database: 'active' | 'archive';
  last_pushed: string;
  content_hash: string;
}

interface SyncIndex {
  active_db_id: string;
  archive_db_id: string;
  epics: Record<string, SyncEntry>;
  last_push: string;
}

function getSyncIndexPath(): string {
  return resolvePath(SYNC_DIR, SYNC_INDEX_FILENAME);
}

function loadSyncIndex(): SyncIndex {
  try {
    return JSON.parse(fs.readFileSync(getSyncIndexPath(), 'utf8'));
  } catch {
    return { active_db_id: '', archive_db_id: '', epics: {}, last_push: '' };
  }
}

function saveSyncIndex(index: SyncIndex): void {
  fs.writeFileSync(getSyncIndexPath(), JSON.stringify(index, null, 2), 'utf8');
}

// --- Parsed deliverable ---

interface Deliverable {
  title: string;
  done: boolean;
  rawLine: string;
  section: string;
  subsection: string;
}

// --- Epic with matched deliverables ---

interface Epic {
  key: string;
  name: string;
  initiative: string;
  tier: string;
  theme: string;
  why: string;
  status: string;
  deliverables: number;
  remaining: number;
  dueDate: string | null;
  deliverableList: { title: string; done: boolean }[];
}

function hashContent(epic: Epic): string {
  const parts = [
    epic.name, epic.initiative, epic.tier, epic.theme, epic.status,
    String(epic.deliverables), String(epic.remaining),
    epic.dueDate || '',
    epic.deliverableList.map(d => `${d.done ? 'x' : 'o'}:${d.title}`).join('|'),
  ];
  return Buffer.from(parts.join('||')).toString('base64').substring(0, 40);
}

// --- Markdown parser → raw deliverables ---

function parseDeliverables(content: string): Deliverable[] {
  const lines = content.split('\n');
  const deliverables: Deliverable[] = [];

  // Strip frontmatter
  let inFM = false, pastFM = false;
  const contentLines: string[] = [];
  for (const line of lines) {
    if (line.trim() === '---' && !pastFM) {
      if (inFM) pastFM = true; else inFM = true;
      continue;
    }
    if (inFM && !pastFM) continue;
    contentLines.push(line);
  }

  const skipSections = new Set(['top objective', 'runway model', 'legend', 'related']);
  let section = '', subsection = '', skip = false;

  for (const line of contentLines) {
    const t = line.trim();

    const h2 = t.match(/^##\s+(.+)/);
    if (h2) {
      const heading = h2[1].replace(/\*\*/g, '').trim();
      if (skipSections.has(heading.toLowerCase()) || heading.toLowerCase().startsWith('runway')) {
        skip = true; continue;
      }
      skip = false;
      section = heading;
      subsection = '';
      continue;
    }
    if (skip) continue;

    const h34 = t.match(/^#{3,4}\s+(.+)/);
    if (h34) {
      subsection = h34[1].replace(/\*\*/g, '').trim();
      continue;
    }

    const check = t.match(/^-\s+\[([ xX])\]\s+(.+)/);
    if (check) {
      const done = check[1].toLowerCase() === 'x';
      const body = check[2];
      const title = extractTitle(body);
      deliverables.push({ title, done, rawLine: body, section, subsection });
    }
  }

  return deliverables;
}

function extractTitle(body: string): string {
  const bold = body.match(/^\*\*(.+?)\*\*\s*[—–-]?\s*/s);
  if (bold) return bold[1].replace(/^\d+\.\s*/, '').trim();
  const dash = body.match(/^(.+?)\s*[—–]\s*/s);
  if (dash) return dash[1].replace(/^\d+\.\s*/, '').trim();
  return body.replace(/^\d+\.\s*/, '').trim().substring(0, 120);
}

// --- Match deliverables to epics ---

function matchDeliverablesToEpics(deliverables: Deliverable[], config: BacklogConfig): { epics: Epic[]; unmatched: Deliverable[] } {
  // Track which deliverables have been claimed (for dedup)
  const claimed = new Set<number>();
  const epicDeliverables = new Map<string, { title: string; done: boolean }[]>();

  // Initialize all epics
  for (const ec of config.epics) {
    epicDeliverables.set(ec.key, []);
  }

  // Dedup: track titles we've already matched (lowercased keyword match)
  const dedupSeen = new Set<string>();

  for (let i = 0; i < deliverables.length; i++) {
    const d = deliverables[i];
    const titleLower = d.title.toLowerCase();
    const rawLower = d.rawLine.toLowerCase();
    const sectionLower = d.section.toLowerCase();
    const subLower = d.subsection.toLowerCase();

    // Skip items matching skip_keywords entirely (e.g., ongoing non-epic work)
    let isSkipped = false;
    for (const sk of (config.skip_keywords || [])) {
      if (titleLower.includes(sk.toLowerCase()) || rawLower.includes(sk.toLowerCase())) {
        isSkipped = true;
        claimed.add(i);
        break;
      }
    }
    if (isSkipped) continue;

    // Check dedup — skip if this deliverable's title matches a dedup keyword we've already seen
    let isDupe = false;
    for (const dk of config.dedup_keywords) {
      if (titleLower.includes(dk.toLowerCase())) {
        if (dedupSeen.has(dk.toLowerCase())) {
          isDupe = true;
          claimed.add(i);
          break;
        }
        dedupSeen.add(dk.toLowerCase());
      }
    }
    if (isDupe) continue;

    // Try to match to an epic
    let matched = false;
    for (const ec of config.epics) {
      if (matchesEpic(d, ec.match, sectionLower, subLower, titleLower, rawLower)) {
        epicDeliverables.get(ec.key)!.push({ title: d.title, done: d.done });
        claimed.add(i);
        matched = true;
        break;
      }
    }
  }

  // Build epics
  const epics: Epic[] = [];
  for (const ec of config.epics) {
    const items = epicDeliverables.get(ec.key)!;
    if (items.length === 0) continue;

    const total = items.length;
    const doneCount = items.filter(d => d.done).length;
    const remaining = total - doneCount;

    let status: string;
    if (doneCount === total) status = 'done';
    else if (doneCount > 0) status = 'in-progress';
    else status = 'todo';

    // Extract due date from any deliverable
    let dueDate: string | null = null;
    for (const d of deliverables) {
      if (claimed.has(deliverables.indexOf(d))) {
        const dateMatch = d.rawLine.match(/(\d{4}-\d{2}-\d{2})/);
        if (dateMatch) { dueDate = dateMatch[1]; break; }
      }
    }

    epics.push({
      key: ec.key,
      name: ec.name,
      initiative: ec.initiative,
      tier: ec.tier,
      theme: ec.theme,
      why: ec.why,
      status,
      deliverables: total,
      remaining,
      dueDate,
      deliverableList: items,
    });
  }

  // Collect unmatched
  const unmatched = deliverables.filter((_, i) => !claimed.has(i));

  return { epics, unmatched };
}

function matchesEpic(
  d: Deliverable,
  match: EpicMatchConfig,
  sectionLower: string,
  subLower: string,
  titleLower: string,
  rawLower: string,
): boolean {
  // Must match at least one section pattern
  const sectionMatch = match.sections.some(s => sectionLower.includes(s.toLowerCase()));
  if (!sectionMatch) return false;

  // Must match at least one keyword
  const keywordMatch = match.keywords.some(kw => {
    const kwLower = kw.toLowerCase();
    return titleLower.includes(kwLower) || rawLower.includes(kwLower);
  });
  if (!keywordMatch) return false;

  // Subsection match is optional but adds confidence — if specified, at least one must match
  if (match.subsections.length > 0) {
    const subMatch = match.subsections.some(s => subLower.includes(s.toLowerCase()));
    // If subsection doesn't match, still allow if keyword match is strong (exact title match)
    if (!subMatch) {
      // Allow if keyword appears in the title itself (not just raw line)
      const titleKeywordMatch = match.keywords.some(kw => titleLower.includes(kw.toLowerCase()));
      if (!titleKeywordMatch) return false;
    }
  }

  return true;
}

// --- Notion database operations ---

const DB_SCHEMA = {
  'Name': { title: {} },
  'Initiative': {
    select: {
      options: [
        { name: 'CCA-F + Anthropic', color: 'red' },
        { name: 'Website', color: 'blue' },
        { name: 'Deadweight', color: 'orange' },
        { name: 'Composter', color: 'green' },
        { name: 'Obsidian MCP', color: 'purple' },
        { name: 'Agentic System', color: 'pink' },
        { name: 'Agentic Stack', color: 'pink' },
        { name: 'Claude Harness', color: 'gray' },
      ],
    },
  },
  'Tier': {
    select: {
      options: [
        { name: '1', color: 'red' },
        { name: '2', color: 'yellow' },
        { name: '3', color: 'default' },
        { name: 'Enabling', color: 'purple' },
      ],
    },
  },
  'Theme': {
    select: {
      options: [
        { name: 'Career', color: 'red' },
        { name: 'Portfolio', color: 'blue' },
        { name: 'Revenue', color: 'green' },
        { name: 'Infrastructure', color: 'gray' },
      ],
    },
  },
  'Status': {
    select: {
      options: [
        { name: 'todo', color: 'default' },
        { name: 'in-progress', color: 'blue' },
        { name: 'done', color: 'green' },
        { name: 'blocked', color: 'red' },
      ],
    },
  },
  'Deliverables': { number: { format: 'number' } },
  'Remaining': { number: { format: 'number' } },
  'Due Date': { date: {} },
  'Notes': { rich_text: {} },
  'Rank': { number: { format: 'number' } },
};

// Top-level "Claude" page in Notion workspace — databases live under this
const CONTAINER_PAGE_ID = '3438b1a8-eec5-8030-9171-d2bb76f4078a';
const ACTIVE_DB_NAME = 'Active';
const ARCHIVE_DB_NAME = 'Archive';

async function findDatabase(token: string, parentPageId: string, name: string): Promise<string | null> {
  const resp = await notionRequest<{ results: { id: string; parent: { page_id?: string }; title: { plain_text: string }[] }[] }>(
    'POST', '/v1/search', token,
    { filter: { property: 'object', value: 'database' }, page_size: 100 }
  );
  for (const db of resp.results) {
    if (db.parent?.page_id === parentPageId) {
      const title = db.title?.[0]?.plain_text || '';
      if (title === name) return db.id;
    }
  }
  return null;
}

async function createDatabase(token: string, parentPageId: string, name: string): Promise<string> {
  const body = {
    parent: { type: 'page_id', page_id: parentPageId },
    title: [{ type: 'text', text: { content: name } }],
    properties: DB_SCHEMA,
    is_inline: false,
  };
  const result = await notionRequest<{ id: string }>('POST', '/v1/databases', token, body);
  process.stderr.write(`[backlog-push] Created database "${name}": ${result.id}\n`);
  return result.id;
}

async function ensureDatabases(token: string, index: SyncIndex): Promise<{ activeId: string; archiveId: string }> {
  let activeId = index.active_db_id;
  if (activeId) {
    try {
      const db = await notionRequest<{ id: string; archived: boolean }>('GET', `/v1/databases/${activeId}`, token);
      if (db.archived) activeId = '';
    } catch { activeId = ''; }
  }
  if (!activeId) {
    activeId = await findDatabase(token, CONTAINER_PAGE_ID, ACTIVE_DB_NAME) || await createDatabase(token, CONTAINER_PAGE_ID, ACTIVE_DB_NAME);
    await sleep(RATE_LIMIT_MS);
  }

  let archiveId = index.archive_db_id;
  if (archiveId) {
    try {
      const db = await notionRequest<{ id: string; archived: boolean }>('GET', `/v1/databases/${archiveId}`, token);
      if (db.archived) archiveId = '';
    } catch { archiveId = ''; }
  }
  if (!archiveId) {
    archiveId = await findDatabase(token, CONTAINER_PAGE_ID, ARCHIVE_DB_NAME) || await createDatabase(token, CONTAINER_PAGE_ID, ARCHIVE_DB_NAME);
    await sleep(RATE_LIMIT_MS);
  }

  return { activeId, archiveId };
}

// --- Build Notion page content ---

function buildNotionProperties(epic: Epic): Record<string, unknown> {
  const props: Record<string, unknown> = {
    'Name': { title: [{ text: { content: epic.name } }] },
    'Initiative': { select: { name: epic.initiative } },
    'Tier': { select: { name: epic.tier } },
    'Theme': { select: { name: epic.theme } },
    'Status': { select: { name: epic.status } },
    'Deliverables': { number: epic.deliverables },
    'Remaining': { number: epic.remaining },
  };

  if (epic.dueDate) {
    props['Due Date'] = { date: { start: epic.dueDate } };
  }

  // Notes = why statement
  props['Notes'] = {
    rich_text: [{ text: { content: epic.why.substring(0, 2000) } }],
  };

  return props;
}

function buildDeliverableBlocks(epic: Epic): unknown[] {
  const blocks: unknown[] = [];

  // "Why" as a quote block
  blocks.push({
    object: 'block',
    type: 'quote',
    quote: {
      rich_text: [{ type: 'text', text: { content: epic.why } }],
    },
  });

  // Deliverables as to_do blocks
  for (const d of epic.deliverableList) {
    blocks.push({
      object: 'block',
      type: 'to_do',
      to_do: {
        rich_text: [{ type: 'text', text: { content: d.title.substring(0, 2000) } }],
        checked: d.done,
      },
    });
  }

  return blocks;
}

async function createPage(token: string, dbId: string, epic: Epic): Promise<string> {
  const body = {
    parent: { database_id: dbId },
    properties: buildNotionProperties(epic),
    children: buildDeliverableBlocks(epic),
  };
  const result = await notionRequest<{ id: string }>('POST', '/v1/pages', token, body);
  return result.id;
}

async function updatePage(token: string, pageId: string, epic: Epic): Promise<void> {
  // Update properties
  await notionRequest<unknown>('PATCH', `/v1/pages/${pageId}`, token, {
    properties: buildNotionProperties(epic),
  });

  // Replace page content: delete existing blocks, add new ones
  // First, get existing blocks
  const existing = await notionRequest<{ results: { id: string }[] }>(
    'GET', `/v1/blocks/${pageId}/children?page_size=100`, token
  );
  await sleep(RATE_LIMIT_MS);

  // Delete each existing block
  for (const block of existing.results) {
    await notionRequest<unknown>('DELETE', `/v1/blocks/${block.id}`, token);
    await sleep(RATE_LIMIT_MS);
  }

  // Add new blocks
  const blocks = buildDeliverableBlocks(epic);
  if (blocks.length > 0) {
    await notionRequest<unknown>('PATCH', `/v1/blocks/${pageId}/children`, token, {
      children: blocks,
    });
  }
}

async function archivePage(token: string, pageId: string): Promise<void> {
  await notionRequest<unknown>('PATCH', `/v1/pages/${pageId}`, token, { archived: true });
}

// --- Main push ---

async function push(token: string, dryRun: boolean) {
  process.stderr.write('[backlog-push] Loading config and Master Backlog...\n');

  const config = loadConfig();
  process.stderr.write(`[backlog-push] ${config.epics.length} epics defined in config\n`);

  const backlogPath = resolvePath(BACKLOG_PATH);
  if (!fs.existsSync(backlogPath)) {
    process.stderr.write(`[backlog-push] ERROR: ${backlogPath} not found\n`);
    process.exit(1);
  }

  const content = fs.readFileSync(backlogPath, 'utf8');
  const deliverables = parseDeliverables(content);
  process.stderr.write(`[backlog-push] Parsed ${deliverables.length} deliverables from backlog\n`);

  const { epics, unmatched } = matchDeliverablesToEpics(deliverables, config);
  process.stderr.write(`[backlog-push] Matched to ${epics.length} epics\n`);

  if (unmatched.length > 0) {
    // Only warn about non-done unmatched items
    const unmatchedActive = unmatched.filter(d => !d.done);
    if (unmatchedActive.length > 0) {
      process.stderr.write(`[backlog-push] WARNING: ${unmatchedActive.length} active deliverables unmatched:\n`);
      for (const d of unmatchedActive) {
        process.stderr.write(`  ? ${d.section} > ${d.subsection} > ${d.title}\n`);
      }
    }
    const unmatchedDone = unmatched.filter(d => d.done);
    if (unmatchedDone.length > 0) {
      process.stderr.write(`[backlog-push] ${unmatchedDone.length} done deliverables unmatched (OK — historical)\n`);
    }
  }

  // Summary
  const active = epics.filter(e => e.status !== 'done');
  const done = epics.filter(e => e.status === 'done');
  const totalD = epics.reduce((s, e) => s + e.deliverables, 0);
  const totalR = epics.reduce((s, e) => s + e.remaining, 0);
  process.stderr.write(`[backlog-push] ${active.length} active, ${done.length} done | ${totalD} deliverables matched, ${totalR} remaining\n`);

  // Load sync index + ensure databases
  const index = loadSyncIndex();
  let activeDbId = '(dry-run)';
  let archiveDbId = '(dry-run)';
  if (!dryRun) {
    process.stderr.write('[backlog-push] Ensuring Notion databases...\n');
    const dbs = await ensureDatabases(token, index);
    activeDbId = dbs.activeId;
    archiveDbId = dbs.archiveId;
    index.active_db_id = activeDbId;
    index.archive_db_id = archiveDbId;
  }

  const currentKeys = new Set(epics.map(e => e.key));
  let created = 0, updated = 0, moved = 0, archived = 0, skipped = 0;

  for (const epic of epics) {
    const existing = index.epics[epic.key];
    const currentHash = hashContent(epic);
    const targetDb: 'active' | 'archive' = epic.status === 'done' ? 'archive' : 'active';
    const targetDbId = targetDb === 'active' ? activeDbId : archiveDbId;

    if (existing) {
      if (existing.database !== targetDb) {
        // Move between databases
        if (dryRun) {
          process.stderr.write(`  [MOVE → ${targetDb}] ${epic.initiative} / ${epic.name}\n`);
          moved++;
        } else {
          try {
            await archivePage(token, existing.notion_page_id);
            await sleep(RATE_LIMIT_MS);
            const newPageId = await createPage(token, targetDbId, epic);
            index.epics[epic.key] = {
              notion_page_id: newPageId, database: targetDb,
              last_pushed: new Date().toISOString(), content_hash: currentHash,
            };
            moved++;
            process.stderr.write(`  [MOV] ${epic.name} → ${targetDb}\n`);
          } catch (err: unknown) {
            process.stderr.write(`  [ERR] Move ${epic.name}: ${err instanceof Error ? err.message : err}\n`);
          }
          await sleep(RATE_LIMIT_MS);
        }
      } else if (existing.content_hash !== currentHash) {
        // Update in place
        if (dryRun) {
          process.stderr.write(`  [UPDATE] ${epic.initiative} / ${epic.name} (${epic.remaining}/${epic.deliverables})\n`);
          updated++;
        } else {
          try {
            await updatePage(token, existing.notion_page_id, epic);
            index.epics[epic.key].content_hash = currentHash;
            index.epics[epic.key].last_pushed = new Date().toISOString();
            updated++;
            process.stderr.write(`  [UPD] ${epic.name}\n`);
          } catch (err: unknown) {
            process.stderr.write(`  [ERR] Update ${epic.name}: ${err instanceof Error ? err.message : err}\n`);
          }
          await sleep(RATE_LIMIT_MS);
        }
      } else {
        skipped++;
      }
    } else {
      // Create new
      if (dryRun) {
        process.stderr.write(`  [CREATE → ${targetDb}] ${epic.initiative} / ${epic.name} [${epic.status}] (${epic.remaining}/${epic.deliverables})\n`);
        created++;
      } else {
        try {
          const pageId = await createPage(token, targetDbId, epic);
          index.epics[epic.key] = {
            notion_page_id: pageId, database: targetDb,
            last_pushed: new Date().toISOString(), content_hash: currentHash,
          };
          created++;
          process.stderr.write(`  [NEW] ${epic.name} → ${targetDb}\n`);
        } catch (err: unknown) {
          process.stderr.write(`  [ERR] Create ${epic.name}: ${err instanceof Error ? err.message : err}\n`);
        }
        await sleep(RATE_LIMIT_MS);
      }
    }
  }

  // Remove epics no longer in config or backlog
  for (const [key, entry] of Object.entries(index.epics)) {
    if (!currentKeys.has(key)) {
      if (dryRun) {
        process.stderr.write(`  [REMOVE] ${key}\n`);
        archived++;
      } else {
        try {
          await archivePage(token, entry.notion_page_id);
          delete index.epics[key];
          archived++;
          process.stderr.write(`  [REM] ${key}\n`);
        } catch (err: unknown) {
          process.stderr.write(`  [ERR] Remove ${key}: ${err instanceof Error ? err.message : err}\n`);
        }
        await sleep(RATE_LIMIT_MS);
      }
    }
  }

  if (!dryRun) {
    index.last_push = new Date().toISOString();
    saveSyncIndex(index);
  }

  process.stderr.write(`\n[backlog-push] ${dryRun ? 'DRY RUN ' : ''}Summary: ${created} new, ${updated} updated, ${moved} moved, ${archived} removed, ${skipped} unchanged\n`);
  console.log(JSON.stringify({
    dry_run: dryRun, created, updated, moved, archived, skipped,
    total_epics: epics.length, active_epics: active.length, done_epics: done.length,
    total_deliverables: totalD, remaining_deliverables: totalR,
    unmatched_active: unmatched.filter(d => !d.done).length,
    unmatched_done: unmatched.filter(d => d.done).length,
  }));
}

// --- CLI ---

async function main() {
  const token = process.env.NOTION_TOKEN;
  if (!token) {
    process.stderr.write('Error: NOTION_TOKEN env var not set.\n');
    process.exit(1);
  }

  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');

  await push(token, dryRun);
}

main().catch(err => {
  process.stderr.write(`Fatal: ${err}\n`);
  process.exit(1);
});
