/**
 * Batch reclassify all vault notes with the two-axis taxonomy.
 *
 * Reads every .md file in Sources/, applies domain/mode/lifecycle tags,
 * preserves source-specific tags and metadata, updates frontmatter in place.
 *
 * Usage:
 *   npm run reclassify:dry    # preview changes (no writes)
 *   npm run reclassify:dev    # apply to dev vault
 *   npm run reclassify        # apply to prod vault
 */

import * as fs from 'fs';
import * as path from 'path';
import matter from 'gray-matter';
import { getAllNotes, getVaultPath, getRelativePath } from '../utils/vault_ops';
import { classifyNote } from '../utils/metadata';

// Source tags to preserve (not replaced by taxonomy)
const SOURCE_TAGS = new Set([
  'claude-conversation', 'apple-notes', 'notion', 'notion-export',
]);

// Tags to preserve that start with these prefixes
const PRESERVE_PREFIXES = ['folder/', 'domain/', 'mode/', 'status/'];

interface ReclassifyOptions {
  dryRun: boolean;
}

interface ReclassifyResult {
  total: number;
  updated: number;
  skipped: number;
  failed: number;
  noChange: number;
}

function isSourceTag(tag: string): boolean {
  return SOURCE_TAGS.has(tag);
}

function isPreservedPrefix(tag: string): boolean {
  return PRESERVE_PREFIXES.some(p => tag.startsWith(p));
}

async function reclassify(options: ReclassifyOptions): Promise<void> {
  const { dryRun } = options;
  const vaultPath = getVaultPath();

  process.stderr.write(`[reclassify] Vault: ${vaultPath}\n`);
  process.stderr.write(`[reclassify] Mode: ${dryRun ? 'DRY RUN' : 'LIVE'}\n\n`);

  const allFiles = await getAllNotes('Sources');
  process.stderr.write(`[reclassify] Found ${allFiles.length} notes in Sources/\n`);

  const result: ReclassifyResult = { total: allFiles.length, updated: 0, skipped: 0, failed: 0, noChange: 0 };

  for (const filePath of allFiles) {
    const relPath = getRelativePath(filePath);
    try {
      const raw = fs.readFileSync(filePath, 'utf8');
      const { data: fm, content } = matter(raw);

      if (!fm || !fm.source) {
        process.stderr.write(`  [SKIP] ${relPath} (no frontmatter/source)\n`);
        result.skipped++;
        continue;
      }

      const title = fm.title || path.basename(filePath, '.md');
      const source = fm.source as string;
      const existingStatus = fm.status as string | undefined;

      // Classify
      const { domains, modes, lifecycle } = classifyNote(content, title, source, existingStatus);

      // Build new tag list: source tags + folder tags + taxonomy tags
      const oldTags: string[] = Array.isArray(fm.tags) ? fm.tags : [];
      const preservedTags = oldTags.filter(t => isSourceTag(t) || t.startsWith('folder/'));

      const newTags = [
        ...preservedTags,
        ...domains,
        ...modes,
        lifecycle,
      ];

      // Deduplicate
      const uniqueTags = [...new Set(newTags)];

      // Check if anything changed
      const oldSorted = [...oldTags].sort().join(',');
      const newSorted = [...uniqueTags].sort().join(',');
      const statusChanged = fm.status !== lifecycle.replace('status/', '');

      if (oldSorted === newSorted && !statusChanged) {
        result.noChange++;
        continue;
      }

      if (dryRun) {
        const addedTags = uniqueTags.filter(t => !oldTags.includes(t));
        const removedTags = oldTags.filter(t => !uniqueTags.includes(t));
        process.stderr.write(`  [DRY] ${relPath}\n`);
        if (addedTags.length) process.stderr.write(`    + ${addedTags.join(', ')}\n`);
        if (removedTags.length) process.stderr.write(`    - ${removedTags.join(', ')}\n`);
        result.updated++;
        continue;
      }

      // Update frontmatter
      fm.tags = uniqueTags;
      fm.status = lifecycle.replace('status/', '');
      fm.reclassified = new Date().toISOString();

      const updated = matter.stringify(content, fm);
      fs.writeFileSync(filePath, updated, 'utf8');
      result.updated++;

    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      process.stderr.write(`  [ERR] ${relPath}: ${msg}\n`);
      result.failed++;
    }
  }

  process.stderr.write(`\n[reclassify] Done: ${result.updated} updated, ${result.noChange} unchanged, ${result.skipped} skipped, ${result.failed} failed\n`);
  console.log(JSON.stringify(result));
}

// --- CLI ---
async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  await reclassify({ dryRun });
}

main().catch(err => {
  process.stderr.write(`Fatal: ${err}\n`);
  process.exit(1);
});
