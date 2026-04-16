/**
 * Pull backlog changes from Notion → config/backlog_epics.json.
 *
 * Reads Active and Archive databases, compares with local config,
 * and syncs back any changes made in Notion (status, completion date).
 *
 * Notion is the editing surface (phone), vault config is source of truth
 * for structure (dependencies, initiative, outcome). This pull syncs:
 *   - Status changes (open ↔ done)
 *   - Completed date (set when marked done in Notion)
 *
 * Auth: Set NOTION_TOKEN env var with your integration token.
 *
 * Usage:
 *   NOTION_TOKEN=ntn_... npx ts-node src/importers/notion_backlog_pull.ts [--dry-run]
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

// --- Types ---

interface NotionPage {
  id: string;
  properties: {
    'ID'?: { rich_text: { plain_text: string }[] };
    'Status'?: { select: { name: string } | null };
    'Completed'?: { date: { start: string } | null };
    'Name'?: { title: { plain_text: string }[] };
  };
}

interface QueryResponse {
  results: NotionPage[];
  has_more: boolean;
  next_cursor: string | null;
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
  outcomes: { key: string; name: string; impact: string }[];
  deliverables: DeliverableConfig[];
  seeds?: unknown[];
  gaps_and_fixes?: unknown[];
  design_explorations?: unknown[];
}

interface SyncIndex {
  active_db_id: string;
  archive_db_id: string;
  deliverables: Record<string, { notion_page_id: string; database: string; last_pushed: string; content_hash: string }>;
  last_push: string;
}

// --- Load/save ---

function loadConfig(): BacklogConfig {
  return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
}

function saveConfig(config: BacklogConfig): void {
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2) + '\n', 'utf8');
}

function getSyncIndexPath(): string {
  const vaultPath = process.env.VAULT_PATH;
  if (vaultPath) return path.join(vaultPath, SYNC_DIR, SYNC_INDEX_FILENAME);
  return path.join(SYNC_DIR, SYNC_INDEX_FILENAME);
}

function loadSyncIndex(): SyncIndex {
  try {
    return JSON.parse(fs.readFileSync(getSyncIndexPath(), 'utf8'));
  } catch {
    return { active_db_id: '', archive_db_id: '', deliverables: {}, last_push: '' };
  }
}

// --- Query all pages from a database ---

async function queryAllPages(token: string, dbId: string): Promise<NotionPage[]> {
  const pages: NotionPage[] = [];
  let cursor: string | undefined;

  do {
    const body: Record<string, unknown> = { page_size: 100 };
    if (cursor) body.start_cursor = cursor;

    const resp = await notionRequest<QueryResponse>(
      'POST', `/v1/databases/${dbId}/query`, token, body
    );
    pages.push(...resp.results);
    cursor = resp.has_more ? (resp.next_cursor || undefined) : undefined;
    await sleep(RATE_LIMIT_MS);
  } while (cursor);

  return pages;
}

// --- Extract deliverable ID from Notion page ---

function getPageDeliverableId(page: NotionPage): string | null {
  const idProp = page.properties['ID'];
  if (idProp?.rich_text?.[0]?.plain_text) {
    return idProp.rich_text[0].plain_text;
  }
  return null;
}

function getPageStatus(page: NotionPage): 'open' | 'done' | null {
  const status = page.properties['Status']?.select?.name;
  if (status === 'open' || status === 'done') return status;
  return null;
}

function getPageCompleted(page: NotionPage): string | null {
  return page.properties['Completed']?.date?.start || null;
}

// --- Main pull ---

async function pull(token: string, dryRun: boolean) {
  const index = loadSyncIndex();

  if (!index.active_db_id || !index.archive_db_id) {
    process.stderr.write('[backlog-pull] No sync index found. Run push first to establish database IDs.\n');
    process.exit(1);
  }

  process.stderr.write('[backlog-pull] Querying Notion databases...\n');

  const activePages = await queryAllPages(token, index.active_db_id);
  const archivePages = await queryAllPages(token, index.archive_db_id);
  const allPages = [...activePages, ...archivePages];

  process.stderr.write(`[backlog-pull] Found ${activePages.length} active + ${archivePages.length} archived pages\n`);

  // Build lookup: deliverable ID → Notion state
  const notionState = new Map<string, { status: 'open' | 'done'; completed: string | null; dbType: 'active' | 'archive' }>();

  for (const page of activePages) {
    const dId = getPageDeliverableId(page);
    const status = getPageStatus(page);
    if (dId && status) {
      notionState.set(dId, { status, completed: getPageCompleted(page), dbType: 'active' });
    }
  }

  for (const page of archivePages) {
    const dId = getPageDeliverableId(page);
    const status = getPageStatus(page);
    if (dId && status) {
      notionState.set(dId, { status, completed: getPageCompleted(page), dbType: 'archive' });
    }
  }

  // Compare with config
  const config = loadConfig();
  let changes = 0;

  for (const d of config.deliverables) {
    const notion = notionState.get(d.id);
    if (!notion) continue;

    // Status change
    if (notion.status !== d.status) {
      process.stderr.write(`  [STATUS] ${d.id} ${d.title}: ${d.status} → ${notion.status}\n`);
      if (!dryRun) {
        d.status = notion.status;
        // Auto-set completed date when marked done without one
        if (d.status === 'done' && !d.completed) {
          d.completed = notion.completed || new Date().toISOString().split('T')[0];
        }
        // Clear completed if reopened
        if (d.status === 'open' && d.completed) {
          delete d.completed;
        }
      }
      changes++;
    }

    // Completed date change (only if status is done)
    if (d.status === 'done' && notion.completed && notion.completed !== d.completed) {
      process.stderr.write(`  [COMPLETED] ${d.id} ${d.title}: ${d.completed || '(none)'} → ${notion.completed}\n`);
      if (!dryRun) {
        d.completed = notion.completed;
      }
      changes++;
    }
  }

  if (changes > 0 && !dryRun) {
    saveConfig(config);
    process.stderr.write(`\n[backlog-pull] Updated config with ${changes} change(s)\n`);
  } else if (changes > 0) {
    process.stderr.write(`\n[backlog-pull] DRY RUN — ${changes} change(s) would be applied\n`);
  } else {
    process.stderr.write('\n[backlog-pull] No changes detected\n');
  }

  console.log(JSON.stringify({ dry_run: dryRun, changes, pages_read: allPages.length }));
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

  await pull(token, dryRun);
}

main().catch(err => {
  process.stderr.write(`Fatal: ${err}\n`);
  process.exit(1);
});
