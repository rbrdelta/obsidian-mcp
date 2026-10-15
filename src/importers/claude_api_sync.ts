/**
 * Sync conversations from claude.ai API → vault.
 *
 * Auth: Set CLAUDE_SESSION_KEY env var with your sessionKey cookie value.
 *       (Claude Desktop → F12 → Application → Cookies → sessionKey)
 *
 * Usage:
 *   CLAUDE_SESSION_KEY=sk-ant-... npx ts-node src/importers/claude_api_sync.ts [--dry-run] [--overwrite] [--full] [--limit N] [--since YYYY-MM-DD]
 *
 * By default, incremental sync: reads .last_sync timestamp, only fetches
 * conversations updated since then. Use --full to force a full scan.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as https from 'https';
import { ConversationData, ConversationMessage, importBatch, DuplicateMode } from './claude_importer';
import { resolvePath } from '../utils/vault_ops';
import { loadSkiplist, isSkipped } from './skiplist';

const ORG_ID = process.env.CLAUDE_ORG_ID || 'a4c7ab73-85b6-4a30-a76d-f73f601fbf82';
const BASE_URL = 'https://claude.ai';
const RATE_LIMIT_MS = 350; // ~3 req/sec with margin

// --- Sync index: fast source_id lookup without scanning all files ---

const SYNC_INDEX_FILENAME = '.claude_sync_index.json';
const LAST_SYNC_FILENAME = '.claude_last_sync';

interface SyncIndex {
  /** Map of conversation UUID → relative file path */
  ids: Record<string, string>;
  /** When this index was last rebuilt */
  built_at: string;
}

function getSyncIndexPath(): string {
  return resolvePath('Sources/Claude-Conversations', SYNC_INDEX_FILENAME);
}

function getLastSyncPath(): string {
  return resolvePath('Sources/Claude-Conversations', LAST_SYNC_FILENAME);
}

function loadSyncIndex(): SyncIndex {
  const indexPath = getSyncIndexPath();
  try {
    return JSON.parse(fs.readFileSync(indexPath, 'utf8'));
  } catch {
    return { ids: {}, built_at: '' };
  }
}

function saveSyncIndex(index: SyncIndex): void {
  fs.writeFileSync(getSyncIndexPath(), JSON.stringify(index, null, 2), 'utf8');
}

function rebuildSyncIndex(): SyncIndex {
  const dir = resolvePath('Sources/Claude-Conversations');
  const ids: Record<string, string> = {};

  if (!fs.existsSync(dir)) {
    return { ids, built_at: new Date().toISOString() };
  }

  const files = fs.readdirSync(dir).filter(f => f.endsWith('.md'));
  for (const file of files) {
    const filePath = path.join(dir, file);
    // Read only the first 500 bytes — frontmatter is at the top
    const fd = fs.openSync(filePath, 'r');
    const buf = Buffer.alloc(500);
    fs.readSync(fd, buf, 0, 500, 0);
    fs.closeSync(fd);
    const head = buf.toString('utf8');
    const match = head.match(/source_id:\s*"([^"]+)"/);
    if (match) {
      ids[match[1]] = path.join('Sources/Claude-Conversations', file);
    }
  }

  const index: SyncIndex = { ids, built_at: new Date().toISOString() };
  saveSyncIndex(index);
  return index;
}

function loadLastSync(): string | null {
  try {
    return fs.readFileSync(getLastSyncPath(), 'utf8').trim();
  } catch {
    return null;
  }
}

function saveLastSync(timestamp: string): void {
  fs.writeFileSync(getLastSyncPath(), timestamp, 'utf8');
}

// --- Raw API types (match claude.ai response format) ---

interface RawContent {
  type: string;
  text?: string;
}

interface RawMessage {
  uuid: string;
  text: string;
  content: RawContent[];
  sender: 'human' | 'assistant';
  created_at: string;
  updated_at: string;
  attachments: unknown[];
  files: unknown[];
}

interface RawConversationSummary {
  uuid: string;
  name: string;
  summary: string;
  created_at: string;
  updated_at: string;
  project?: { uuid: string; name: string } | null;
}

interface RawConversationFull extends RawConversationSummary {
  chat_messages: RawMessage[];
}

// --- HTTP client ---

// Error messages start with a fixed tag so vault-sync.sh can tell a dead key
// (AUTH_EXPIRED) from a transient failure without guessing from the wording.
// Only AUTH_EXPIRED means "get a new key"; everything else retries next run.
class ApiError extends Error {
  constructor(message: string, readonly retryable: boolean) {
    super(message);
  }
}

const RETRY_DELAYS_MS = [5000, 20000];

/**
 * Classify a non-2xx response. Claude.ai sits behind Cloudflare, which also
 * answers 403 when it challenges a non-browser client — that is not an
 * expired key. A real auth failure comes back from the API as JSON.
 */
export function classifyFailure(status: number, contentType: string, cfMitigated: string, body: string): ApiError {
  const snippet = body.replace(/\s+/g, ' ').slice(0, 200);
  const detail = `status=${status} cf-mitigated=${cfMitigated || '-'} body="${snippet}"`;
  const isJson = contentType.includes('application/json');
  if (status === 401 || (status === 403 && isJson && !cfMitigated)) {
    return new ApiError(`AUTH_EXPIRED ${detail}`, false);
  }
  if (status === 403) return new ApiError(`CF_BLOCKED ${detail}`, true);
  if (status === 429 || status >= 500) return new ApiError(`TRANSIENT ${detail}`, true);
  return new ApiError(`HTTP_ERROR ${detail}`, false);
}

function apiGetOnce<T>(urlPath: string, sessionKey: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const url = new URL(urlPath, BASE_URL);
    const req = https.get(url, {
      headers: {
        'Cookie': `sessionKey=${sessionKey}`,
        'Accept': 'application/json',
        'User-Agent': 'obsidian-mcp-sync/1.0',
      },
    }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (chunk: Buffer) => chunks.push(chunk));
      res.on('end', () => {
        const body = Buffer.concat(chunks).toString('utf8');
        const status = res.statusCode ?? 0;
        if (status < 200 || status >= 300) {
          reject(classifyFailure(
            status,
            String(res.headers['content-type'] ?? ''),
            String(res.headers['cf-mitigated'] ?? ''),
            body,
          ));
          return;
        }
        try {
          resolve(JSON.parse(body));
        } catch (e) {
          reject(new ApiError(`HTTP_ERROR unparseable body for ${urlPath}: ${e}`, true));
        }
      });
    });

    // Network errors (DNS, reset, AggregateError from happy-eyeballs) are transient
    req.on('error', (e) => reject(e instanceof ApiError ? e : new ApiError(`TRANSIENT network: ${e}`, true)));
    req.setTimeout(30000, () => {
      req.destroy(new ApiError(`TRANSIENT timeout fetching ${urlPath}`, true));
    });
  });
}

async function apiGet<T>(urlPath: string, sessionKey: string): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await apiGetOnce<T>(urlPath, sessionKey);
    } catch (err) {
      const retryable = err instanceof ApiError && err.retryable;
      if (!retryable || attempt >= RETRY_DELAYS_MS.length) throw err;
      process.stderr.write(`[sync] ${(err as Error).message} — retrying in ${RETRY_DELAYS_MS[attempt] / 1000}s\n`);
      await sleep(RETRY_DELAYS_MS[attempt]);
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// --- API methods ---

interface ConversationListResponse {
  data: RawConversationSummary[];
  has_more: boolean;
}

/** Fetch recent conversations (single page, sorted by updated_at desc) */
async function listRecentConversations(sessionKey: string, limit: number = 100): Promise<RawConversationSummary[]> {
  const urlPath = `/api/organizations/${ORG_ID}/chat_conversations_v2?limit=${limit}&offset=0&consistency=eventual`;
  const response = await apiGet<ConversationListResponse>(urlPath, sessionKey);
  return response.data;
}

/** Fetch all conversations (paginated) */
async function listAllConversations(sessionKey: string): Promise<RawConversationSummary[]> {
  const all: RawConversationSummary[] = [];
  let offset = 0;
  const pageSize = 100;

  while (true) {
    const urlPath = `/api/organizations/${ORG_ID}/chat_conversations_v2?limit=${pageSize}&offset=${offset}&consistency=eventual`;
    const response = await apiGet<ConversationListResponse>(urlPath, sessionKey);
    all.push(...response.data);
    process.stderr.write(`[sync]   ...fetched ${all.length} so far\n`);

    if (!response.has_more || response.data.length === 0) break;
    offset += response.data.length;
    await sleep(RATE_LIMIT_MS);
  }

  return all;
}

async function getConversation(sessionKey: string, uuid: string): Promise<RawConversationFull> {
  const urlPath = `/api/organizations/${ORG_ID}/chat_conversations/${uuid}?tree=True&rendering_mode=messages&render_all_tools=true&consistency=eventual`;
  return apiGet<RawConversationFull>(urlPath, sessionKey);
}

// --- Transform (reuses same logic as export parser) ---

function extractText(msg: RawMessage): string {
  if (msg.content && msg.content.length > 0) {
    return msg.content
      .filter(c => c.type === 'text' && c.text)
      .map(c => c.text!)
      .join('\n')
      .trim();
  }
  return (msg.text || '').trim();
}

function convertConversation(raw: RawConversationFull): ConversationData | null {
  const messages = raw.chat_messages
    .map((m): ConversationMessage | null => {
      const text = extractText(m);
      if (!text) return null;
      return {
        role: m.sender === 'human' ? 'human' : 'assistant',
        content: text,
        timestamp: m.created_at,
      };
    })
    .filter((m): m is ConversationMessage => m !== null);

  if (messages.length === 0) return null;

  const title = raw.name?.trim() || `Conversation ${raw.uuid.substring(0, 8)}`;

  return {
    id: raw.uuid,
    title,
    created: raw.created_at,
    updated: raw.updated_at,
    summary: raw.summary?.trim() || undefined,
    messages,
  };
}

// --- Main sync logic ---

interface SyncOptions {
  dryRun: boolean;
  duplicateMode: DuplicateMode;
  full: boolean;
  limit?: number;
  since?: string; // ISO date string — only sync conversations updated after this date
}

async function sync(sessionKey: string, options: SyncOptions) {
  const { dryRun, duplicateMode, full, limit, since } = options;
  const syncStartTime = new Date().toISOString();

  // Step 1: Load or rebuild the sync index
  process.stderr.write('[sync] Loading sync index...\n');
  let index = loadSyncIndex();
  if (Object.keys(index.ids).length === 0) {
    process.stderr.write('[sync] No index found, rebuilding from vault...\n');
    index = rebuildSyncIndex();
  }
  process.stderr.write(`[sync] Index has ${Object.keys(index.ids).length} known conversations\n`);

  // Step 2: Determine the "since" cutoff
  let effectiveSince = since;
  if (!effectiveSince && !full) {
    const lastSync = loadLastSync();
    if (lastSync) {
      effectiveSince = lastSync;
      process.stderr.write(`[sync] Incremental sync since ${effectiveSince}\n`);
    } else {
      process.stderr.write('[sync] No previous sync found, doing full scan\n');
    }
  }

  // Step 3: Fetch conversations from API
  let conversations: RawConversationSummary[];
  if (effectiveSince && !full) {
    // Incremental: fetch one page of recent conversations, filter by date
    process.stderr.write('[sync] Fetching recent conversations...\n');
    conversations = await listRecentConversations(sessionKey);
    const sinceDate = new Date(effectiveSince);
    conversations = conversations.filter(c => new Date(c.updated_at) >= sinceDate);
    process.stderr.write(`[sync] ${conversations.length} conversations updated since last sync\n`);
  } else {
    // Full scan
    process.stderr.write('[sync] Fetching all conversations from claude.ai...\n');
    conversations = await listAllConversations(sessionKey);
    process.stderr.write(`[sync] Found ${conversations.length} conversations on claude.ai\n`);
  }

  // Step 4: Diff against index, filter skiplist
  const skiplist = loadSkiplist();
  let toSync: RawConversationSummary[];
  if (duplicateMode === 'overwrite') {
    toSync = conversations;
  } else {
    toSync = conversations.filter(c => !index.ids[c.uuid]);
  }
  const skippedCount = toSync.filter(c => isSkipped(skiplist, 'claude_ai', c.uuid)).length;
  toSync = toSync.filter(c => !isSkipped(skiplist, 'claude_ai', c.uuid));
  if (skippedCount > 0) {
    process.stderr.write(`[sync] ${skippedCount} conversations skipped (skiplist)\n`);
  }
  process.stderr.write(`[sync] ${toSync.length} new conversations to sync\n`);

  if (limit) {
    toSync = toSync.slice(0, limit);
    process.stderr.write(`[sync] Limited to ${toSync.length}\n`);
  }

  if (toSync.length === 0) {
    process.stderr.write('[sync] Nothing to sync. Vault is up to date.\n');
    if (!dryRun) saveLastSync(syncStartTime);
    console.log(JSON.stringify({ imported: 0, skipped: 0, failed: 0, total_api: conversations.length, total_index: Object.keys(index.ids).length }));
    return;
  }

  if (dryRun) {
    process.stderr.write('\n[sync] DRY RUN — would import:\n');
    for (const c of toSync) {
      process.stderr.write(`  - ${c.name || c.uuid} (${c.updated_at})\n`);
    }
    console.log(JSON.stringify({ dry_run: true, would_import: toSync.length, total_api: conversations.length, total_index: Object.keys(index.ids).length }));
    return;
  }

  // Step 5: Fetch full conversation data and import
  const fullConversations: ConversationData[] = [];
  for (let i = 0; i < toSync.length; i++) {
    const summary = toSync[i];
    process.stderr.write(`[sync] Fetching ${i + 1}/${toSync.length}: ${summary.name || summary.uuid}\n`);

    try {
      const fullConv = await getConversation(sessionKey, summary.uuid);
      const conv = convertConversation(fullConv);
      if (conv) {
        // Project name only exists on the list response, not the individual fetch
        conv.project = summary.project?.name;
        fullConversations.push(conv);
      } else {
        process.stderr.write(`  [SKIP] Empty conversation: ${summary.name}\n`);
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      // A dead key fails every remaining fetch; stop before saving last-sync
      if (msg.startsWith('AUTH_EXPIRED')) throw err;
      process.stderr.write(`  [ERR] Failed to fetch ${summary.name}: ${msg}\n`);
    }

    // Rate limit
    if (i < toSync.length - 1) {
      await sleep(RATE_LIMIT_MS);
    }
  }

  process.stderr.write(`[sync] Fetched ${fullConversations.length} conversations, importing to vault...\n`);

  // Step 6: Import using existing pipeline
  const results = await importBatch(fullConversations, duplicateMode);

  // Step 7: Update sync index with newly imported conversations
  for (const result of results) {
    if (result.success && !result.skipped) {
      // Find the UUID from our toSync list by matching title
      const matching = fullConversations.find(c => c.title === result.title);
      if (matching) {
        index.ids[matching.id] = result.relative_path;
      }
    }
  }
  saveSyncIndex(index);
  saveLastSync(syncStartTime);

  const imported = results.filter(r => r.success && !r.skipped).length;
  const skipped = results.filter(r => r.skipped).length;
  const failed = results.filter(r => !r.success).length;

  process.stderr.write(`\n[sync] Done: ${imported} imported, ${skipped} skipped, ${failed} failed\n`);
  process.stderr.write(`[sync] Total: ${Object.keys(index.ids).length} in index\n`);

  if (failed > 0) {
    process.stderr.write('Failed:\n');
    results.filter(r => !r.success).forEach(r => {
      process.stderr.write(`  - ${r.title}: ${r.message}\n`);
    });
  }

  console.log(JSON.stringify({ imported, skipped, failed, total_index: Object.keys(index.ids).length }));
}

// --- CLI ---

async function main() {
  const sessionKey = process.env.CLAUDE_SESSION_KEY;
  if (!sessionKey) {
    process.stderr.write('Error: CLAUDE_SESSION_KEY env var not set.\n');
    process.stderr.write('Get it from Claude Desktop: F12 → Application → Cookies → claude.ai → sessionKey\n');
    process.exit(1);
  }

  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const overwrite = args.includes('--overwrite');
  const full = args.includes('--full');

  let limit: number | undefined;
  const limitIdx = args.indexOf('--limit');
  if (limitIdx !== -1 && args[limitIdx + 1]) {
    limit = parseInt(args[limitIdx + 1], 10);
  }

  let since: string | undefined;
  const sinceIdx = args.indexOf('--since');
  if (sinceIdx !== -1 && args[sinceIdx + 1]) {
    since = args[sinceIdx + 1];
  }

  const duplicateMode: DuplicateMode = overwrite ? 'overwrite' : 'skip';

  await sync(sessionKey, { dryRun, duplicateMode, full, limit, since });
}

if (require.main === module) {
  main().catch(err => {
    process.stderr.write(`Fatal: ${err instanceof Error ? err.message : err}\n`);
    process.exit(1);
  });
}
