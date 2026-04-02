/**
 * Sync Apple Notes exported via iPhone Shortcut → iCloud Drive → vault.
 *
 * The iPhone Shortcut exports notes as markdown files to:
 *   iCloud Drive/NotesExport/<note-title>.md
 *
 * Each file has a simple header block:
 *   <!-- apple-notes-meta
 *   created: 2025-07-15T10:30:00Z
 *   modified: 2026-03-20T14:22:00Z
 *   folder: Personal
 *   -->
 *
 * Usage:
 *   npm run apple:sync        # incremental sync to prod
 *   npm run apple:dry         # preview only
 *   npm run apple:dev         # sync to dev vault
 *   npm run apple:sync -- --full   # force re-import all
 */

import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { resolvePath, writeNote, sanitizeFilename, noteExists } from '../utils/vault_ops';
import { buildFrontmatter, autoTag, now } from '../utils/metadata';
import { loadSkiplist, isSkipped } from './skiplist';

const DEST_FOLDER = 'Sources/Apple-Notes';
const SYNC_INDEX_FILENAME = '.apple_sync_index.json';
const ICLOUD_EXPORT_PATH = process.env.APPLE_NOTES_PATH
  || '/mnt/c/Users/deero/iCloudDrive/NotesExport';

interface SyncIndex {
  files: Record<string, { path: string; hash: string; modified: string }>;
  built_at: string;
}

interface NoteMeta {
  created: string;
  modified: string;
  folder: string;
  tags: string;
  title: string;
}

function getSyncIndexPath(): string {
  return resolvePath(DEST_FOLDER, SYNC_INDEX_FILENAME);
}

function loadSyncIndex(): SyncIndex {
  try {
    return JSON.parse(fs.readFileSync(getSyncIndexPath(), 'utf8'));
  } catch {
    return { files: {}, built_at: '' };
  }
}

function saveSyncIndex(index: SyncIndex): void {
  const dir = resolvePath(DEST_FOLDER);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(getSyncIndexPath(), JSON.stringify(index, null, 2), 'utf8');
}

function hashContent(content: string): string {
  return crypto.createHash('md5').update(content).digest('hex');
}

/**
 * Parse Apple date format "Aug 9, 2023 at 1:08 PM" to ISO string.
 * Falls back to input string if parsing fails.
 */
function parseAppleDate(dateStr: string): string {
  if (!dateStr) return '';
  // Remove "at" and try to parse
  const cleaned = dateStr.replace(/\s+at\s+/i, ' ');
  const parsed = new Date(cleaned);
  if (!isNaN(parsed.getTime())) {
    return parsed.toISOString();
  }
  return dateStr;
}

/**
 * Parse exported note format:
 *   Title on first line
 *   key: value metadata lines
 *   --> or --- separator
 *   body content
 *
 * Falls back to file stats if no metadata found.
 */
function parseMeta(content: string, filePath: string): { meta: NoteMeta; body: string } {
  // Match either --> or --- as separator
  const separatorMatch = content.match(/\n(-->|---)\s*\n/);

  if (separatorMatch && separatorMatch.index !== undefined) {
    const headerBlock = content.slice(0, separatorMatch.index);
    const body = content.slice(separatorMatch.index + separatorMatch[0].length);
    const headerLines = headerBlock.split('\n');

    const meta: NoteMeta = { created: '', modified: '', folder: '', tags: '', title: '' };

    // First line is the title
    if (headerLines.length > 0) {
      meta.title = headerLines[0].trim();
    }

    // Remaining lines are key: value pairs
    for (let i = 1; i < headerLines.length; i++) {
      const line = headerLines[i];
      const colonIdx = line.indexOf(':');
      if (colonIdx === -1) continue;
      const key = line.slice(0, colonIdx).trim();
      const value = line.slice(colonIdx + 1).trim();
      if (key === 'created') meta.created = parseAppleDate(value);
      if (key === 'modified') meta.modified = parseAppleDate(value);
      if (key === 'folder') meta.folder = value;
      if (key === 'tags') meta.tags = value;
    }

    return { meta, body };
  }

  // Fallback: no separator found, treat entire content as body
  const stats = fs.statSync(filePath);
  return {
    meta: {
      created: stats.birthtime.toISOString(),
      modified: stats.mtime.toISOString(),
      folder: '',
      tags: '',
      title: '',
    },
    body: content,
  };
}

interface SyncOptions {
  dryRun: boolean;
  full: boolean;
}

async function sync(options: SyncOptions) {
  const { dryRun, full } = options;

  if (!fs.existsSync(ICLOUD_EXPORT_PATH)) {
    process.stderr.write(`[apple] Export folder not found: ${ICLOUD_EXPORT_PATH}\n`);
    process.stderr.write('[apple] Run the iPhone Shortcut first to export notes to iCloud Drive/NotesExport/\n');
    process.exit(1);
  }

  const files = fs.readdirSync(ICLOUD_EXPORT_PATH).filter(f => f.endsWith('.md') || f.endsWith('.txt'));
  process.stderr.write(`[apple] Found ${files.length} notes in ${ICLOUD_EXPORT_PATH}\n`);

  if (files.length === 0) {
    process.stderr.write('[apple] No markdown files found. Is the Shortcut export complete?\n');
    return;
  }

  const index = full ? { files: {}, built_at: '' } : loadSyncIndex();
  const skiplist = loadSkiplist();
  process.stderr.write(`[apple] Index has ${Object.keys(index.files).length} known notes\n`);

  let imported = 0;
  let updated = 0;
  let skipped = 0;
  let failed = 0;

  for (const file of files) {
    const srcPath = path.join(ICLOUD_EXPORT_PATH, file);
    let rawContent: string;
    try {
      rawContent = fs.readFileSync(srcPath, 'utf8');
    } catch {
      process.stderr.write(`  [SKIP] ${file} (cloud-only, not downloaded)\n`);
      skipped++;
      continue;
    }
    const contentHash = hashContent(rawContent);

    const { meta, body } = parseMeta(rawContent, srcPath);

    // Use title from metadata, fall back to filename
    const ext = path.extname(file);
    const title = meta.title || path.basename(file, ext);
    const indexKey = sanitizeFilename(title);
    const existing = index.files[indexKey];

    // Skip confidential notes — never import, delete export file
    // Check both metadata tags field AND body for #confidential hashtag
    const tagsConfidential = meta.tags
      .toLowerCase()
      .split(/,\s*/)
      .some(t => t.replace(/^#/, '').trim() === 'confidential');
    const bodyConfidential = /^#confidential\b/m.test(body);
    const isConfidential = tagsConfidential || bodyConfidential;
    if (isConfidential) {
      process.stderr.write(`  [CONFIDENTIAL] ${title} — skipped, deleting export file\n`);
      try { fs.unlinkSync(srcPath); } catch {}
      skipped++;
      continue;
    }

    // Skip if on skiplist
    if (isSkipped(skiplist, 'apple_notes', indexKey)) {
      process.stderr.write(`  [SKIPLIST] ${title}\n`);
      skipped++;
      continue;
    }

    // Skip if content unchanged
    if (existing && existing.hash === contentHash && !full) {
      skipped++;
      continue;
    }

    const isUpdate = !!existing;

    if (dryRun) {
      const action = isUpdate ? 'UPDATE' : 'NEW';
      process.stderr.write(`  [DRY ${action}] ${title}\n`);
      if (isUpdate) updated++; else imported++;
      continue;
    }

    try {
      // Strip leading "# Title" if present — we add it back
      let noteBody = body;
      const titleMatch = body.match(/^# .+\n+/);
      if (titleMatch) {
        noteBody = body.slice(titleMatch[0].length);
      }
      const wordCount = noteBody.split(/\s+/).filter(Boolean).length;
      const allText = `${title} ${noteBody}`;
      const autoTags = autoTag(allText, title);
      const appleTags = meta.tags
        ? meta.tags.split(/,\s*/).map(t => t.trim().replace(/^#/, '')).filter(Boolean)
        : [];
      const tags = [...new Set(['apple-notes', ...appleTags, ...autoTags])];

      if (meta.folder) {
        tags.push(`folder/${meta.folder.toLowerCase().replace(/\s+/g, '-')}`);
      }

      const frontmatterFields: Record<string, unknown> = {
        title,
        created: meta.created || now(),
        updated: meta.modified || now(),
        imported: now(),
        source: 'apple-notes',
        source_id: `apple-notes-${contentHash.substring(0, 12)}`,
        tags,
        status: 'imported',
        word_count: wordCount,
      };

      if (meta.folder) {
        frontmatterFields.apple_folder = meta.folder;
      }

      const frontmatter = buildFrontmatter(frontmatterFields);
      const fullContent = `${frontmatter}\n\n# ${title}\n\n${noteBody}`;

      const cleanFilename = sanitizeFilename(title) + '.md';
      const destPath = resolvePath(DEST_FOLDER, cleanFilename);
      writeNote(destPath, fullContent);

      index.files[indexKey] = {
        path: path.join(DEST_FOLDER, cleanFilename),
        hash: contentHash,
        modified: meta.modified || now(),
      };

      if (isUpdate) {
        updated++;
        process.stderr.write(`  [UPD] ${title}\n`);
      } else {
        imported++;
        process.stderr.write(`  [OK] ${title}\n`);
      }
    } catch (err: unknown) {
      failed++;
      const msg = err instanceof Error ? err.message : String(err);
      process.stderr.write(`  [ERR] ${title}: ${msg}\n`);
    }
  }

  if (!dryRun) {
    index.built_at = now();
    saveSyncIndex(index);
  }

  process.stderr.write(`\n[apple] Done: ${imported} new, ${updated} updated, ${skipped} unchanged, ${failed} failed\n`);
  process.stderr.write(`[apple] Total: ${Object.keys(index.files).length + imported} in index\n`);

  console.log(JSON.stringify({ imported, updated, skipped, failed, total: files.length }));
}

// --- CLI ---

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const full = args.includes('--full');

  await sync({ dryRun, full });
}

main().catch(err => {
  process.stderr.write(`Fatal: ${err}\n`);
  process.exit(1);
});
