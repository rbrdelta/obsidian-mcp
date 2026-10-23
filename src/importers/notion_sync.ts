/**
 * Sync pages from Notion API → vault.
 *
 * Auth: Set NOTION_TOKEN env var with your integration token.
 *
 * Usage:
 *   NOTION_TOKEN=ntn_... npx ts-node src/importers/notion_sync.ts [--dry-run] [--full] [--limit N]
 *
 * By default, incremental sync: reads .last_sync timestamp, only fetches
 * pages updated since then. Use --full to force a full scan.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as https from 'https';
import { resolvePath, writeNote, sanitizeFilename } from '../utils/vault_ops';
import { buildFrontmatter, autoTag, now } from '../utils/metadata';
import { loadSkiplist, isSkipped } from './skiplist';

const NOTION_VERSION = '2022-06-28';
const RATE_LIMIT_MS = 350; // ~3 req/sec
const DEST_FOLDER = 'Sources/Notion';

// --- Sync state ---

const SYNC_INDEX_FILENAME = '.notion_sync_index.json';
const LAST_SYNC_FILENAME = '.notion_last_sync';

interface SyncIndex {
  ids: Record<string, { path: string; last_edited: string }>;
  built_at: string;
}

function getSyncIndexPath(): string {
  return resolvePath(DEST_FOLDER, SYNC_INDEX_FILENAME);
}

function getLastSyncPath(): string {
  return resolvePath(DEST_FOLDER, LAST_SYNC_FILENAME);
}

function loadSyncIndex(): SyncIndex {
  try {
    return JSON.parse(fs.readFileSync(getSyncIndexPath(), 'utf8'));
  } catch {
    return { ids: {}, built_at: '' };
  }
}

function saveSyncIndex(index: SyncIndex): void {
  const dir = resolvePath(DEST_FOLDER);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(getSyncIndexPath(), JSON.stringify(index, null, 2), 'utf8');
}

function rebuildSyncIndex(): SyncIndex {
  const dir = resolvePath(DEST_FOLDER);
  const ids: Record<string, { path: string; last_edited: string }> = {};

  if (!fs.existsSync(dir)) {
    return { ids, built_at: new Date().toISOString() };
  }

  const files = fs.readdirSync(dir).filter(f => f.endsWith('.md'));
  for (const file of files) {
    const filePath = path.join(dir, file);
    const fd = fs.openSync(filePath, 'r');
    const buf = Buffer.alloc(600);
    fs.readSync(fd, buf, 0, 600, 0);
    fs.closeSync(fd);
    const head = buf.toString('utf8');
    const idMatch = head.match(/source_id:\s*"([^"]+)"/);
    const editMatch = head.match(/updated:\s*"([^"]+)"/);
    if (idMatch) {
      ids[idMatch[1]] = {
        path: path.join(DEST_FOLDER, file),
        last_edited: editMatch?.[1] || '',
      };
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
  const dir = resolvePath(DEST_FOLDER);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(getLastSyncPath(), timestamp, 'utf8');
}

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
      if (res.statusCode === 401) {
        reject(new Error('Auth failed. Check your NOTION_TOKEN.'));
        res.resume();
        return;
      }
      if (res.statusCode === 429) {
        reject(new Error('Rate limited. Wait and retry.'));
        res.resume();
        return;
      }
      if (res.statusCode && (res.statusCode < 200 || res.statusCode >= 300)) {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => {
          const errBody = Buffer.concat(chunks).toString('utf8');
          reject(new Error(`Notion API ${res.statusCode}: ${errBody}`));
        });
        return;
      }

      const chunks: Buffer[] = [];
      res.on('data', (chunk: Buffer) => chunks.push(chunk));
      res.on('end', () => {
        try {
          resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
        } catch (e) {
          reject(new Error(`Failed to parse Notion response: ${e}`));
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

// --- Notion types ---

interface NotionRichText {
  type: string;
  plain_text: string;
  href?: string | null;
  annotations?: {
    bold?: boolean;
    italic?: boolean;
    strikethrough?: boolean;
    underline?: boolean;
    code?: boolean;
  };
}

interface NotionBlock {
  id: string;
  type: string;
  has_children: boolean;
  [key: string]: unknown;
}

interface NotionPage {
  id: string;
  object: 'page';
  created_time: string;
  last_edited_time: string;
  parent: { type: string; database_id?: string; page_id?: string };
  properties: Record<string, NotionProperty>;
  url: string;
}

interface NotionProperty {
  type: string;
  title?: NotionRichText[];
  rich_text?: NotionRichText[];
  multi_select?: { name: string }[];
  select?: { name: string } | null;
  status?: { name: string } | null;
  [key: string]: unknown;
}

interface SearchResponse {
  results: NotionPage[];
  has_more: boolean;
  next_cursor: string | null;
}

interface BlocksResponse {
  results: NotionBlock[];
  has_more: boolean;
  next_cursor: string | null;
}

// --- Block → Markdown conversion ---

export function richTextToMarkdown(richTexts: NotionRichText[]): string {
  return richTexts.map(rt => {
    let text = rt.plain_text;
    const a = rt.annotations;
    if (a?.code) text = `\`${text}\``;
    if (a?.bold) text = `**${text}**`;
    if (a?.italic) text = `*${text}*`;
    if (a?.strikethrough) text = `~~${text}~~`;
    if (rt.href) text = `[${text}](${rt.href})`;
    return text;
  }).join('');
}

function getRichText(block: NotionBlock, blockType: string): NotionRichText[] {
  const data = block[blockType] as { rich_text?: NotionRichText[] } | undefined;
  return data?.rich_text || [];
}

export function blockToMarkdown(block: NotionBlock, indent: number = 0): string {
  const prefix = '  '.repeat(indent);
  const type = block.type;

  switch (type) {
    case 'paragraph':
      return prefix + richTextToMarkdown(getRichText(block, 'paragraph'));
    case 'heading_1':
      return `# ${richTextToMarkdown(getRichText(block, 'heading_1'))}`;
    case 'heading_2':
      return `## ${richTextToMarkdown(getRichText(block, 'heading_2'))}`;
    case 'heading_3':
      return `### ${richTextToMarkdown(getRichText(block, 'heading_3'))}`;
    case 'bulleted_list_item':
      return `${prefix}- ${richTextToMarkdown(getRichText(block, 'bulleted_list_item'))}`;
    case 'numbered_list_item':
      return `${prefix}1. ${richTextToMarkdown(getRichText(block, 'numbered_list_item'))}`;
    case 'to_do': {
      const todo = block.to_do as { checked?: boolean; rich_text?: NotionRichText[] };
      const checked = todo?.checked ? 'x' : ' ';
      return `${prefix}- [${checked}] ${richTextToMarkdown(todo?.rich_text || [])}`;
    }
    case 'toggle':
      return `${prefix}- ${richTextToMarkdown(getRichText(block, 'toggle'))}`;
    case 'quote':
      return `> ${richTextToMarkdown(getRichText(block, 'quote'))}`;
    case 'callout': {
      const callout = block.callout as { icon?: { emoji?: string }; rich_text?: NotionRichText[] };
      const icon = callout?.icon?.emoji || '';
      return `> ${icon} ${richTextToMarkdown(callout?.rich_text || [])}`;
    }
    case 'code': {
      const code = block.code as { language?: string; rich_text?: NotionRichText[] };
      const lang = code?.language || '';
      const text = richTextToMarkdown(code?.rich_text || []);
      return `\`\`\`${lang}\n${text}\n\`\`\``;
    }
    case 'divider':
      return '---';
    case 'image': {
      const img = block.image as { type?: string; file?: { url?: string }; external?: { url?: string }; caption?: NotionRichText[] };
      const url = img?.type === 'file' ? img.file?.url : img?.external?.url;
      const caption = richTextToMarkdown(img?.caption || []);
      return url ? `![${caption}](${url})` : `[image: ${caption}]`;
    }
    case 'bookmark': {
      const bm = block.bookmark as { url?: string; caption?: NotionRichText[] };
      const caption = richTextToMarkdown(bm?.caption || []);
      return bm?.url ? `[${caption || bm.url}](${bm.url})` : '';
    }
    case 'table_of_contents':
    case 'breadcrumb':
    case 'column_list':
    case 'column':
      return ''; // structural elements, skip
    default:
      // Try to extract rich_text from unknown block types
      const data = block[type] as { rich_text?: NotionRichText[] } | undefined;
      if (data?.rich_text) return prefix + richTextToMarkdown(data.rich_text);
      return `<!-- unsupported block type: ${type} -->`;
  }
}

// --- Fetch all blocks for a page (recursive for children) ---

async function getPageBlocks(token: string, pageId: string, indent: number = 0): Promise<string[]> {
  const lines: string[] = [];
  let cursor: string | undefined;

  while (true) {
    const urlPath = `/v1/blocks/${pageId}/children?page_size=100${cursor ? '&start_cursor=' + cursor : ''}`;
    const resp = await notionRequest<BlocksResponse>('GET', urlPath, token);

    for (const block of resp.results) {
      const md = blockToMarkdown(block, indent);
      if (md) lines.push(md);

      if (block.has_children && block.type !== 'child_page' && block.type !== 'child_database') {
        await sleep(RATE_LIMIT_MS);
        const children = await getPageBlocks(token, block.id, indent + 1);
        lines.push(...children);
      }
    }

    if (!resp.has_more) break;
    cursor = resp.next_cursor || undefined;
    await sleep(RATE_LIMIT_MS);
  }

  return lines;
}

// --- Page title extraction ---

export function getPageTitle(page: NotionPage): string {
  for (const prop of Object.values(page.properties)) {
    if (prop.type === 'title' && prop.title) {
      const text = prop.title.map(t => t.plain_text).join('');
      if (text) return text;
    }
  }
  return `Notion ${page.id.substring(0, 8)}`;
}

// --- Extract database properties as metadata ---

export function extractProperties(page: NotionPage): Record<string, string> {
  const meta: Record<string, string> = {};
  for (const [key, prop] of Object.entries(page.properties)) {
    if (prop.type === 'title') continue; // already used as title
    switch (prop.type) {
      case 'rich_text':
        if (prop.rich_text?.length) meta[key.toLowerCase()] = prop.rich_text.map(t => t.plain_text).join('');
        break;
      case 'multi_select':
        if (prop.multi_select?.length) meta[key.toLowerCase()] = prop.multi_select.map(s => s.name).join(', ');
        break;
      case 'select':
        if (prop.select?.name) meta[key.toLowerCase()] = prop.select.name;
        break;
      case 'status':
        if (prop.status?.name) meta[key.toLowerCase()] = prop.status.name;
        break;
    }
  }
  return meta;
}

// --- Import a single page ---

async function importPage(token: string, page: NotionPage, dryRun: boolean): Promise<{ success: boolean; title: string; path: string; skipped?: boolean }> {
  const title = getPageTitle(page);

  if (dryRun) {
    return { success: true, title, path: '', skipped: false };
  }

  // Fetch page blocks
  const blockLines = await getPageBlocks(token, page.id);
  const content = blockLines.join('\n\n');

  // Extract properties for metadata
  const props = extractProperties(page);
  const allText = `${title} ${content}`;
  const autoTags = autoTag(allText, title);
  const tags = [...new Set(['notion', ...autoTags])];

  // Determine parent context
  let parentDb = '';
  if (page.parent.type === 'database_id' && page.parent.database_id) {
    parentDb = page.parent.database_id;
  }

  const wordCount = content.split(/\s+/).filter(Boolean).length;

  const frontmatterFields: Record<string, unknown> = {
    title,
    created: page.created_time,
    updated: page.last_edited_time,
    imported: now(),
    source: 'notion',
    source_id: page.id,
    notion_url: page.url,
    tags,
    status: 'imported',
    word_count: wordCount,
  };

  // Add database properties
  if (parentDb) frontmatterFields.notion_database = parentDb;
  for (const [k, v] of Object.entries(props)) {
    frontmatterFields[`notion_${k}`] = v;
  }

  const frontmatter = buildFrontmatter(frontmatterFields);
  const fullContent = `${frontmatter}\n\n# ${title}\n\n${content}`;

  const filename = sanitizeFilename(title) + '.md';
  const filePath = resolvePath(DEST_FOLDER, filename);
  writeNote(filePath, fullContent);

  return { success: true, title, path: path.join(DEST_FOLDER, filename) };
}

// --- Main sync ---

interface SyncOptions {
  dryRun: boolean;
  full: boolean;
  limit?: number;
}

async function sync(token: string, options: SyncOptions) {
  const { dryRun, full, limit } = options;
  const syncStartTime = new Date().toISOString();

  // Load index
  process.stderr.write('[notion] Loading sync index...\n');
  let index = loadSyncIndex();
  if (Object.keys(index.ids).length === 0) {
    process.stderr.write('[notion] No index found, rebuilding from vault...\n');
    index = rebuildSyncIndex();
  }
  process.stderr.write(`[notion] Index has ${Object.keys(index.ids).length} known pages\n`);

  // Determine since cutoff
  let sinceFilter: string | null = null;
  if (!full) {
    sinceFilter = loadLastSync();
    if (sinceFilter) {
      process.stderr.write(`[notion] Incremental sync since ${sinceFilter}\n`);
    } else {
      process.stderr.write('[notion] No previous sync found, doing full scan\n');
    }
  }

  // Search for all pages (Notion search API only supports simple object filter)
  process.stderr.write('[notion] Fetching pages from Notion...\n');
  const allPages: NotionPage[] = [];
  let cursor: string | undefined;

  while (true) {
    const body: Record<string, unknown> = {
      filter: { property: 'object', value: 'page' },
      page_size: 100,
    };
    if (cursor) body.start_cursor = cursor;

    const resp = await notionRequest<SearchResponse>('POST', '/v1/search', token, body);
    const pages = resp.results.filter(r => r.object === 'page') as NotionPage[];
    allPages.push(...pages);

    if (!resp.has_more) break;
    cursor = resp.next_cursor || undefined;
    await sleep(RATE_LIMIT_MS);
  }
  process.stderr.write(`[notion] Found ${allPages.length} pages\n`);

  // Determine which pages need syncing, filter skiplist
  const skiplist = loadSkiplist();
  let toSync: NotionPage[];
  if (full) {
    toSync = allPages;
  } else {
    toSync = allPages.filter(p => {
      const existing = index.ids[p.id];
      if (!existing) return true; // new page
      // Updated since last import
      return p.last_edited_time > existing.last_edited;
    });
  }
  const skippedCount = toSync.filter(p => isSkipped(skiplist, 'notion', p.id)).length;
  toSync = toSync.filter(p => !isSkipped(skiplist, 'notion', p.id));
  if (skippedCount > 0) {
    process.stderr.write(`[notion] ${skippedCount} pages skipped (skiplist)\n`);
  }
  process.stderr.write(`[notion] ${toSync.length} pages to sync\n`);

  if (limit) {
    toSync = toSync.slice(0, limit);
    process.stderr.write(`[notion] Limited to ${toSync.length}\n`);
  }

  if (toSync.length === 0) {
    process.stderr.write('[notion] Nothing to sync. Vault is up to date.\n');
    if (!dryRun) saveLastSync(syncStartTime);
    console.log(JSON.stringify({ imported: 0, updated: 0, failed: 0, total_notion: allPages.length, total_index: Object.keys(index.ids).length }));
    return;
  }

  if (dryRun) {
    process.stderr.write('\n[notion] DRY RUN — would sync:\n');
    for (const p of toSync) {
      const title = getPageTitle(p);
      const action = index.ids[p.id] ? 'UPDATE' : 'NEW';
      process.stderr.write(`  [${action}] ${title} (${p.last_edited_time})\n`);
    }
    console.log(JSON.stringify({ dry_run: true, would_sync: toSync.length, total_notion: allPages.length, total_index: Object.keys(index.ids).length }));
    return;
  }

  // Sync pages
  let imported = 0;
  let updated = 0;
  let failed = 0;

  for (let i = 0; i < toSync.length; i++) {
    const page = toSync[i];
    const title = getPageTitle(page);
    const isUpdate = !!index.ids[page.id];
    process.stderr.write(`[notion] ${i + 1}/${toSync.length}: ${isUpdate ? 'Updating' : 'Importing'} ${title}\n`);

    try {
      const result = await importPage(token, page, false);
      if (result.success) {
        index.ids[page.id] = { path: result.path, last_edited: page.last_edited_time };
        if (isUpdate) {
          updated++;
          process.stderr.write(`  [UPD] ${title}\n`);
        } else {
          imported++;
          process.stderr.write(`  [OK] ${title}\n`);
        }
      }
    } catch (err: unknown) {
      failed++;
      const msg = err instanceof Error ? err.message : String(err);
      process.stderr.write(`  [ERR] ${title}: ${msg}\n`);
    }

    if (i < toSync.length - 1) await sleep(RATE_LIMIT_MS);
  }

  saveSyncIndex(index);
  saveLastSync(syncStartTime);

  process.stderr.write(`\n[notion] Done: ${imported} new, ${updated} updated, ${failed} failed\n`);
  process.stderr.write(`[notion] Total: ${Object.keys(index.ids).length} in index\n`);

  console.log(JSON.stringify({ imported, updated, failed, total_index: Object.keys(index.ids).length }));
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
  const full = args.includes('--full');

  let limit: number | undefined;
  const limitIdx = args.indexOf('--limit');
  if (limitIdx !== -1 && args[limitIdx + 1]) {
    limit = parseInt(args[limitIdx + 1], 10);
  }

  await sync(token, { dryRun, full, limit });
}

if (require.main === module) {
  main().catch(err => {
    process.stderr.write(`Fatal: ${err}\n`);
    process.exit(1);
  });
}
