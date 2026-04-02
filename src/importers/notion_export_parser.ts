/**
 * One-time import of Notion export (markdown files from manual export).
 * For guest workspaces or bulk imports where API sync isn't available.
 *
 * Usage:
 *   npx ts-node src/importers/notion_export_parser.ts /path/to/extracted/content [--dry-run] [--overwrite]
 */

import * as fs from 'fs';
import * as path from 'path';
import { resolvePath, writeNote, sanitizeFilename, noteExists } from '../utils/vault_ops';
import { buildFrontmatter, autoTag, now } from '../utils/metadata';

const DEST_FOLDER = 'Sources/Notion';
const ATTACH_FOLDER = 'Attachments';

// Notion export filenames: "Title abc123def456.md" — last segment before .ext is the block ID
const NOTION_ID_PATTERN = /\s+([a-f0-9]{32}|[a-f0-9-]{36})$/;

function extractTitleAndId(filename: string): { title: string; notionId: string } {
  const ext = path.extname(filename);
  const base = path.basename(filename, ext);
  const match = base.match(NOTION_ID_PATTERN);

  if (match) {
    const notionId = match[1];
    const title = base.slice(0, match.index).trim();
    return { title: title || base, notionId };
  }

  return { title: base, notionId: '' };
}

function isMarkdown(filename: string): boolean {
  return filename.endsWith('.md');
}

function isAttachment(filename: string): boolean {
  const ext = path.extname(filename).toLowerCase();
  return ['.png', '.jpg', '.jpeg', '.gif', '.svg', '.pdf', '.xlsx', '.xls', '.docx', '.doc', '.csv', '.pptx'].includes(ext);
}

interface ImportOptions {
  dryRun: boolean;
  overwrite: boolean;
}

async function importExport(sourceDir: string, options: ImportOptions) {
  const { dryRun, overwrite } = options;

  if (!fs.existsSync(sourceDir)) {
    process.stderr.write(`Error: source directory not found: ${sourceDir}\n`);
    process.exit(1);
  }

  const files = fs.readdirSync(sourceDir);
  const mdFiles = files.filter(isMarkdown);
  const attachFiles = files.filter(isAttachment);

  process.stderr.write(`[notion-export] Found ${mdFiles.length} markdown files, ${attachFiles.length} attachments\n`);

  // Build a map of attachment original names for rewriting references
  const attachmentMap = new Map<string, string>();

  // Copy attachments first
  for (const file of attachFiles) {
    const destPath = resolvePath(ATTACH_FOLDER, file);
    attachmentMap.set(file, `${ATTACH_FOLDER}/${file}`);

    if (dryRun) {
      process.stderr.write(`  [DRY] Would copy attachment: ${file}\n`);
      continue;
    }

    if (noteExists(destPath) && !overwrite) {
      process.stderr.write(`  [SKIP] Attachment exists: ${file}\n`);
      continue;
    }

    const srcPath = path.join(sourceDir, file);
    const destDir = resolvePath(ATTACH_FOLDER);
    if (!fs.existsSync(destDir)) fs.mkdirSync(destDir, { recursive: true });
    fs.copyFileSync(srcPath, destPath);
    process.stderr.write(`  [OK] Attachment: ${file}\n`);
  }

  // Import markdown files
  let imported = 0;
  let skipped = 0;
  let failed = 0;

  for (const file of mdFiles) {
    const { title, notionId } = extractTitleAndId(file);
    const cleanFilename = sanitizeFilename(title) + '.md';
    const destPath = resolvePath(DEST_FOLDER, cleanFilename);

    if (noteExists(destPath) && !overwrite) {
      process.stderr.write(`  [SKIP] Already exists: ${title}\n`);
      skipped++;
      continue;
    }

    if (dryRun) {
      const action = noteExists(destPath) ? 'UPDATE' : 'NEW';
      process.stderr.write(`  [DRY ${action}] ${title}\n`);
      imported++;
      continue;
    }

    try {
      let content = fs.readFileSync(path.join(sourceDir, file), 'utf8');

      // Strip the leading "# Title" line if it matches — we'll add it back with frontmatter
      const firstLineMatch = content.match(/^# .+\n+/);
      let bodyContent = content;
      if (firstLineMatch) {
        bodyContent = content.slice(firstLineMatch[0].length);
      }

      // Rewrite Notion-style relative links to attachments
      // e.g. [text](filename%20abc123.ext) or ![img](filename%20abc123.ext)
      for (const [origName, vaultPath] of attachmentMap) {
        const encoded = encodeURIComponent(origName).replace(/%20/g, '%20');
        // Match both URL-encoded and plain references
        bodyContent = bodyContent.split(origName).join(vaultPath);
        bodyContent = bodyContent.split(encoded).join(vaultPath);
      }

      // Also rewrite Notion internal page references: [text](Title%20abc123.md)
      // Convert to wiki-links where possible
      for (const otherFile of mdFiles) {
        const { title: otherTitle } = extractTitleAndId(otherFile);
        const encoded = encodeURIComponent(otherFile).replace(/%20/g, '%20');
        // Replace markdown links to other notion pages with wiki-links
        const linkPattern = new RegExp(`\\[([^\\]]+)\\]\\(${escapeRegex(encoded)}\\)`, 'g');
        bodyContent = bodyContent.replace(linkPattern, `[[${ otherTitle }]]`);
        const plainPattern = new RegExp(`\\[([^\\]]+)\\]\\(${escapeRegex(otherFile)}\\)`, 'g');
        bodyContent = bodyContent.replace(plainPattern, `[[${ otherTitle }]]`);
      }

      const wordCount = bodyContent.split(/\s+/).filter(Boolean).length;
      const allText = `${title} ${bodyContent}`;
      const autoTags = autoTag(allText, title);
      const tags = [...new Set(['notion', 'notion-export', ...autoTags])];

      const frontmatter = buildFrontmatter({
        title,
        created: now(),
        imported: now(),
        source: 'notion-export',
        source_id: notionId || `notion-export-${sanitizeFilename(title)}`,
        tags,
        status: 'imported',
        word_count: wordCount,
      });

      const fullContent = `${frontmatter}\n\n# ${title}\n\n${bodyContent}`;
      writeNote(destPath, fullContent);

      const action = noteExists(destPath) ? 'UPD' : 'OK';
      process.stderr.write(`  [${action}] ${title}\n`);
      imported++;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      process.stderr.write(`  [ERR] ${title}: ${msg}\n`);
      failed++;
    }
  }

  process.stderr.write(`\n[notion-export] Done: ${imported} imported, ${skipped} skipped, ${failed} failed\n`);
  process.stderr.write(`[notion-export] Attachments: ${attachFiles.length}\n`);
  console.log(JSON.stringify({ imported, skipped, failed, attachments: attachFiles.length }));
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// --- CLI ---

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const overwrite = args.includes('--overwrite');
  const sourceDir = args.find(a => !a.startsWith('--'));

  if (!sourceDir) {
    process.stderr.write('Usage: npx ts-node src/importers/notion_export_parser.ts /path/to/content [--dry-run] [--overwrite]\n');
    process.exit(1);
  }

  await importExport(sourceDir, { dryRun, overwrite });
}

main().catch(err => {
  process.stderr.write(`Fatal: ${err}\n`);
  process.exit(1);
});
