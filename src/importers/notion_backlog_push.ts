/**
 * Push backlog deliverables from config → Notion database.
 *
 * Model:
 *   Outcome (why) → Deliverable (Notion row) → Status (open/done)
 *
 * Deliverables are defined in config/backlog_epics.json with outcome, initiative,
 * impact, dependencies, and status. Each deliverable = one Notion database row.
 *
 * Two databases under the top-level "Claude" page (workspace-level, visible in sidebar):
 *   - "Active" — open deliverables
 *   - "Archive" — completed deliverables (velocity history)
 *
 * Auth: Set NOTION_TOKEN env var with your integration token.
 *
 * Usage:
 *   NOTION_TOKEN=ntn_... npx ts-node src/importers/notion_backlog_push.ts [--dry-run]
 */

import * as fs from 'fs';
import * as path from 'path';
import * as https from 'https';

const NOTION_VERSION = '2022-06-28';
const RATE_LIMIT_MS = 350;

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

interface OutcomeConfig {
  key: string;
  name: string;
  impact: string;
}

interface DeliverableConfig {
  id: string;
  title: string;
  initiative: string;
  outcome: string;
  status: 'open' | 'done';
  impact?: string;
  depends_on?: string[] | null;
  size?: string;
  completed?: string;
}

interface BacklogConfig {
  outcomes: OutcomeConfig[];
  deliverables: DeliverableConfig[];
  seeds?: unknown[];
  gaps_and_fixes?: unknown[];
  design_explorations?: unknown[];
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
  deliverables: Record<string, SyncEntry>;
  last_push: string;
}

function getSyncIndexPath(): string {
  // Use vault path if available, otherwise local
  const vaultPath = process.env.VAULT_PATH;
  if (vaultPath) {
    return path.join(vaultPath, SYNC_DIR, SYNC_INDEX_FILENAME);
  }
  return path.join(SYNC_DIR, SYNC_INDEX_FILENAME);
}

function loadSyncIndex(): SyncIndex {
  try {
    const raw = JSON.parse(fs.readFileSync(getSyncIndexPath(), 'utf8'));
    // Migrate from old epic-based index
    if (raw.epics && !raw.deliverables) {
      return {
        active_db_id: raw.active_db_id || '',
        archive_db_id: raw.archive_db_id || '',
        deliverables: {},
        last_push: raw.last_push || '',
      };
    }
    return {
      active_db_id: raw.active_db_id || '',
      archive_db_id: raw.archive_db_id || '',
      deliverables: raw.deliverables || {},
      last_push: raw.last_push || '',
    };
  } catch {
    return { active_db_id: '', archive_db_id: '', deliverables: {}, last_push: '' };
  }
}

function saveSyncIndex(index: SyncIndex): void {
  fs.writeFileSync(getSyncIndexPath(), JSON.stringify(index, null, 2), 'utf8');
}

// --- Content hashing ---

function hashDeliverable(d: DeliverableConfig, outcomeName: string): string {
  const parts = [
    d.id, d.title, d.initiative, d.outcome, d.status,
    d.impact || '', d.size || '',
    d.completed || '',
    outcomeName,
    (d.depends_on || []).join(','),
  ];
  return Buffer.from(parts.join('||')).toString('base64').substring(0, 40);
}

// --- Notion database operations ---

const DB_SCHEMA = {
  'Name': { title: {} },
  'Outcome': {
    select: {
      options: [
        { name: '0: Visibility', color: 'purple' },
        { name: 'A: Application', color: 'red' },
        { name: 'B: Deadweight Signal', color: 'orange' },
        { name: 'C: Build Velocity', color: 'blue' },
        { name: 'D: Composter', color: 'green' },
      ],
    },
  },
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
  'Status': {
    select: {
      options: [
        { name: 'open', color: 'blue' },
        { name: 'done', color: 'green' },
      ],
    },
  },
  'Size': {
    select: {
      options: [
        { name: 'S', color: 'green' },
        { name: 'M', color: 'yellow' },
        { name: 'L', color: 'red' },
      ],
    },
  },
  'Impact': { rich_text: {} },
  'Dependencies': { rich_text: {} },
  'Completed': { date: {} },
  'ID': { rich_text: {} },
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

function formatOutcomeLabel(outcome: string, outcomes: OutcomeConfig[]): string {
  const o = outcomes.find(x => x.key === outcome);
  if (!o) return outcome;
  return `${o.key}: ${o.name}`;
}

function buildNotionProperties(
  d: DeliverableConfig,
  outcomes: OutcomeConfig[],
  allDeliverables: DeliverableConfig[],
): Record<string, unknown> {
  const props: Record<string, unknown> = {
    'Name': { title: [{ text: { content: d.title } }] },
    'Outcome': { select: { name: formatOutcomeLabel(d.outcome, outcomes) } },
    'Initiative': { select: { name: d.initiative } },
    'Status': { select: { name: d.status } },
    'ID': { rich_text: [{ text: { content: d.id } }] },
  };

  if (d.size) {
    props['Size'] = { select: { name: d.size } };
  }

  if (d.impact) {
    props['Impact'] = {
      rich_text: [{ text: { content: d.impact.substring(0, 2000) } }],
    };
  }

  if (d.depends_on && d.depends_on.length > 0) {
    // Resolve dependency IDs to titles for readability
    const depTitles = d.depends_on.map(depId => {
      const dep = allDeliverables.find(x => x.id === depId);
      return dep ? `${dep.id}: ${dep.title}` : depId;
    });
    props['Dependencies'] = {
      rich_text: [{ text: { content: depTitles.join('\n').substring(0, 2000) } }],
    };
  }

  if (d.completed) {
    props['Completed'] = { date: { start: d.completed } };
  }

  return props;
}

function buildPageBlocks(d: DeliverableConfig, outcomes: OutcomeConfig[]): unknown[] {
  const blocks: unknown[] = [];
  const outcome = outcomes.find(o => o.key === d.outcome);

  // Impact as a quote block
  if (d.impact) {
    blocks.push({
      object: 'block',
      type: 'quote',
      quote: {
        rich_text: [{ type: 'text', text: { content: d.impact } }],
      },
    });
  }

  // Outcome context
  if (outcome) {
    blocks.push({
      object: 'block',
      type: 'callout',
      callout: {
        rich_text: [{ type: 'text', text: { content: `Outcome ${outcome.key}: ${outcome.name}\n${outcome.impact}` } }],
        icon: { type: 'emoji', emoji: '🎯' },
      },
    });
  }

  return blocks;
}

async function createPage(
  token: string,
  dbId: string,
  d: DeliverableConfig,
  outcomes: OutcomeConfig[],
  allDeliverables: DeliverableConfig[],
): Promise<string> {
  const body = {
    parent: { database_id: dbId },
    properties: buildNotionProperties(d, outcomes, allDeliverables),
    children: buildPageBlocks(d, outcomes),
  };
  const result = await notionRequest<{ id: string }>('POST', '/v1/pages', token, body);
  return result.id;
}

async function updatePage(
  token: string,
  pageId: string,
  d: DeliverableConfig,
  outcomes: OutcomeConfig[],
  allDeliverables: DeliverableConfig[],
): Promise<void> {
  await notionRequest<unknown>('PATCH', `/v1/pages/${pageId}`, token, {
    properties: buildNotionProperties(d, outcomes, allDeliverables),
  });

  // Replace page content
  const existing = await notionRequest<{ results: { id: string }[] }>(
    'GET', `/v1/blocks/${pageId}/children?page_size=100`, token
  );
  await sleep(RATE_LIMIT_MS);

  for (const block of existing.results) {
    await notionRequest<unknown>('DELETE', `/v1/blocks/${block.id}`, token);
    await sleep(RATE_LIMIT_MS);
  }

  const blocks = buildPageBlocks(d, outcomes);
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
  process.stderr.write('[backlog-push] Loading config...\n');

  const config = loadConfig();
  const { outcomes, deliverables } = config;

  const open = deliverables.filter(d => d.status === 'open');
  const done = deliverables.filter(d => d.status === 'done');

  process.stderr.write(`[backlog-push] ${outcomes.length} outcomes, ${deliverables.length} deliverables (${open.length} open, ${done.length} done)\n`);

  // Summary by outcome
  for (const o of outcomes) {
    const oOpen = open.filter(d => d.outcome === o.key);
    const oDone = done.filter(d => d.outcome === o.key);
    process.stderr.write(`  ${o.key}: ${o.name} — ${oOpen.length} open, ${oDone.length} done\n`);
  }

  if (config.seeds) {
    process.stderr.write(`[backlog-push] ${(config.seeds as unknown[]).length} planning seeds (not pushed)\n`);
  }

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

  const currentIds = new Set(deliverables.map(d => d.id));
  let created = 0, updated = 0, moved = 0, archived = 0, skipped = 0;

  for (const d of deliverables) {
    const existing = index.deliverables[d.id];
    const outcomeName = outcomes.find(o => o.key === d.outcome)?.name || d.outcome;
    const currentHash = hashDeliverable(d, outcomeName);
    const targetDb: 'active' | 'archive' = d.status === 'done' ? 'archive' : 'active';
    const targetDbId = targetDb === 'active' ? activeDbId : archiveDbId;

    if (existing) {
      if (existing.database !== targetDb) {
        // Move between databases (e.g., deliverable completed)
        if (dryRun) {
          process.stderr.write(`  [MOVE → ${targetDb}] ${d.id} ${d.title}\n`);
          moved++;
        } else {
          try {
            await archivePage(token, existing.notion_page_id);
            await sleep(RATE_LIMIT_MS);
            const newPageId = await createPage(token, targetDbId, d, outcomes, deliverables);
            index.deliverables[d.id] = {
              notion_page_id: newPageId, database: targetDb,
              last_pushed: new Date().toISOString(), content_hash: currentHash,
            };
            moved++;
            process.stderr.write(`  [MOV] ${d.id} ${d.title} → ${targetDb}\n`);
          } catch (err: unknown) {
            process.stderr.write(`  [ERR] Move ${d.id}: ${err instanceof Error ? err.message : err}\n`);
          }
          await sleep(RATE_LIMIT_MS);
        }
      } else if (existing.content_hash !== currentHash) {
        // Update in place
        if (dryRun) {
          process.stderr.write(`  [UPDATE] ${d.id} ${d.title}\n`);
          updated++;
        } else {
          try {
            await updatePage(token, existing.notion_page_id, d, outcomes, deliverables);
            index.deliverables[d.id].content_hash = currentHash;
            index.deliverables[d.id].last_pushed = new Date().toISOString();
            updated++;
            process.stderr.write(`  [UPD] ${d.id} ${d.title}\n`);
          } catch (err: unknown) {
            process.stderr.write(`  [ERR] Update ${d.id}: ${err instanceof Error ? err.message : err}\n`);
          }
          await sleep(RATE_LIMIT_MS);
        }
      } else {
        skipped++;
      }
    } else {
      // Create new
      if (dryRun) {
        process.stderr.write(`  [CREATE → ${targetDb}] ${d.id} ${d.title} [${d.status}]\n`);
        created++;
      } else {
        try {
          const pageId = await createPage(token, targetDbId, d, outcomes, deliverables);
          index.deliverables[d.id] = {
            notion_page_id: pageId, database: targetDb,
            last_pushed: new Date().toISOString(), content_hash: currentHash,
          };
          created++;
          process.stderr.write(`  [NEW] ${d.id} ${d.title} → ${targetDb}\n`);
        } catch (err: unknown) {
          process.stderr.write(`  [ERR] Create ${d.id}: ${err instanceof Error ? err.message : err}\n`);
        }
        await sleep(RATE_LIMIT_MS);
      }
    }
  }

  // Remove deliverables no longer in config
  for (const [id, entry] of Object.entries(index.deliverables)) {
    if (!currentIds.has(id)) {
      if (dryRun) {
        process.stderr.write(`  [REMOVE] ${id}\n`);
        archived++;
      } else {
        try {
          await archivePage(token, entry.notion_page_id);
          delete index.deliverables[id];
          archived++;
          process.stderr.write(`  [REM] ${id}\n`);
        } catch (err: unknown) {
          process.stderr.write(`  [ERR] Remove ${id}: ${err instanceof Error ? err.message : err}\n`);
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
    total_deliverables: deliverables.length,
    open_deliverables: open.length,
    done_deliverables: done.length,
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
