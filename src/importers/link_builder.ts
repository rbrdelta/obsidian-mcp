/**
 * Build inter-note links across the vault based on tag overlap + keyword similarity.
 *
 * For each note, finds the top related notes and appends a ## Related section
 * with [[wikilinks]]. Also detects series (numbered/sequential titles) and
 * adds prev/next navigation.
 *
 * Usage:
 *   npm run links:dev:dry   # preview on dev
 *   npm run links:dev       # apply to dev
 *   npm run links:dry       # preview on prod
 *   npm run links           # apply to prod
 */

import * as fs from 'fs';
import * as path from 'path';
import matter from 'gray-matter';
import { getAllNotes, getVaultPath, getRelativePath } from '../utils/vault_ops';

const MAX_RELATED = 5;
const MIN_SCORE = 0.15;

interface NoteIndex {
  filePath: string;
  relPath: string;
  title: string;
  domains: string[];
  modes: string[];
  source: string;
  keywords: Set<string>;
  wordCount: number;
}

/**
 * Extract meaningful keywords from text (title + first ~500 words of body).
 * Filters out stopwords and very short tokens.
 */
function extractKeywords(title: string, body: string): Set<string> {
  const stopwords = new Set([
    'the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for',
    'of', 'with', 'by', 'from', 'is', 'are', 'was', 'were', 'be', 'been',
    'being', 'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would',
    'could', 'should', 'may', 'might', 'can', 'shall', 'not', 'no', 'nor',
    'so', 'if', 'then', 'than', 'that', 'this', 'these', 'those', 'it',
    'its', 'i', 'me', 'my', 'we', 'our', 'you', 'your', 'he', 'she',
    'they', 'them', 'their', 'what', 'which', 'who', 'whom', 'how', 'when',
    'where', 'why', 'all', 'each', 'every', 'both', 'few', 'more', 'most',
    'other', 'some', 'such', 'only', 'same', 'just', 'also', 'very', 'about',
    'up', 'out', 'into', 'over', 'after', 'before', 'between', 'under',
    'again', 'there', 'here', 'once', 'during', 'while', 'through',
    'above', 'below', 'any', 'own', 'too', 'don', 'now', 'get', 'got',
    'one', 'two', 'like', 'make', 'think', 'know', 'want', 'see', 'look',
    'use', 'way', 'thing', 'things', 'much', 'well', 'back', 'even',
    'new', 'good', 'first', 'last', 'long', 'great', 'little', 'right',
    'still', 'going', 'need', 'said', 'say', 'time', 'come', 'take',
  ]);

  // Use title (weighted) + first 500 words of body
  const truncBody = body.split(/\s+/).slice(0, 500).join(' ');
  const text = `${title} ${title} ${title} ${truncBody}`.toLowerCase();

  const words = text
    .replace(/[^a-z0-9\s-]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 3 && !stopwords.has(w));

  return new Set(words);
}

/**
 * Compute similarity between two notes.
 * Weighted: domain overlap (0.5) + keyword Jaccard (0.5)
 */
function similarity(a: NoteIndex, b: NoteIndex): number {
  // Domain overlap: Jaccard on domain tags
  const aDomains = new Set(a.domains);
  const bDomains = new Set(b.domains);
  const domainIntersect = [...aDomains].filter(d => bDomains.has(d)).length;
  const domainUnion = new Set([...aDomains, ...bDomains]).size;
  const domainScore = domainUnion > 0 ? domainIntersect / domainUnion : 0;

  // Keyword overlap: Jaccard on extracted keywords
  const kwIntersect = [...a.keywords].filter(k => b.keywords.has(k)).length;
  const kwUnion = new Set([...a.keywords, ...b.keywords]).size;
  const kwScore = kwUnion > 0 ? kwIntersect / kwUnion : 0;

  return (domainScore * 0.5) + (kwScore * 0.5);
}

/**
 * Detect series: notes with numbered suffixes or shared base titles.
 * Returns map of base title → ordered list of note indices.
 */
function detectSeries(notes: NoteIndex[]): Map<string, number[]> {
  const series = new Map<string, number[]>();

  // Pattern: "Title N", "Title Session N", "Title Part N"
  const seriesPattern = /^(.+?)[\s-]*(?:session|part|chapter|phase|v|#)?\s*(\d+)\s*$/i;
  // Pattern: date-stamped like "2025-10-03"
  const datePattern = /^\d{4}-\d{2}-\d{2}/;

  const buckets = new Map<string, { idx: number; order: number }[]>();

  for (let i = 0; i < notes.length; i++) {
    const title = notes[i].title;
    const match = title.match(seriesPattern);
    if (match) {
      const base = match[1].trim();
      if (!buckets.has(base)) buckets.set(base, []);
      buckets.get(base)!.push({ idx: i, order: parseInt(match[2]) });
    }
  }

  // Only keep series with 2+ members
  for (const [base, members] of buckets) {
    if (members.length >= 2) {
      members.sort((a, b) => a.order - b.order);
      series.set(base, members.map(m => m.idx));
    }
  }

  return series;
}

/**
 * Build the ## Related section content.
 */
function buildRelatedSection(
  relatedTitles: string[],
  prevTitle?: string,
  nextTitle?: string
): string {
  const lines: string[] = ['', '---', '', '## Related', ''];

  if (prevTitle || nextTitle) {
    if (prevTitle) lines.push(`- Previous: [[${prevTitle}]]`);
    if (nextTitle) lines.push(`- Next: [[${nextTitle}]]`);
    lines.push('');
  }

  for (const title of relatedTitles) {
    lines.push(`- [[${title}]]`);
  }

  return lines.join('\n');
}

/**
 * Remove existing ## Related section from content.
 */
function stripRelatedSection(content: string): string {
  // Match --- separator followed by ## Related and everything after
  const pattern = /\n---\n\n## Related\n[\s\S]*$/;
  return content.replace(pattern, '');
}

interface LinkBuilderOptions {
  dryRun: boolean;
}

async function buildLinks(options: LinkBuilderOptions): Promise<void> {
  const { dryRun } = options;
  const vaultPath = getVaultPath();

  process.stderr.write(`[links] Vault: ${vaultPath}\n`);
  process.stderr.write(`[links] Mode: ${dryRun ? 'DRY RUN' : 'LIVE'}\n\n`);

  // Phase 1: Index all notes
  process.stderr.write('[links] Phase 1: Indexing notes...\n');
  const allFiles = await getAllNotes('Sources');
  const notes: NoteIndex[] = [];

  for (const filePath of allFiles) {
    try {
      const raw = fs.readFileSync(filePath, 'utf8');
      const { data: fm, content } = matter(raw);

      if (!fm || !fm.title) continue;

      const tags: string[] = Array.isArray(fm.tags) ? fm.tags : [];
      const domains = tags.filter(t => t.startsWith('domain/'));
      const modes = tags.filter(t => t.startsWith('mode/'));

      notes.push({
        filePath,
        relPath: getRelativePath(filePath),
        title: fm.title as string,
        domains,
        modes,
        source: (fm.source as string) || '',
        keywords: extractKeywords(fm.title as string, content),
        wordCount: (fm.word_count as number) || 0,
      });
    } catch {
      // skip unparseable files
    }
  }

  process.stderr.write(`[links] Indexed ${notes.length} notes\n`);

  // Phase 2: Detect series
  process.stderr.write('[links] Phase 2: Detecting series...\n');
  const series = detectSeries(notes);
  process.stderr.write(`[links] Found ${series.size} series\n`);

  // Build series lookup: noteIdx → { prev?, next? }
  const seriesNav = new Map<number, { prev?: string; next?: string }>();
  for (const [, members] of series) {
    for (let i = 0; i < members.length; i++) {
      const nav: { prev?: string; next?: string } = {};
      if (i > 0) nav.prev = notes[members[i - 1]].title;
      if (i < members.length - 1) nav.next = notes[members[i + 1]].title;
      seriesNav.set(members[i], nav);
    }
  }

  // Phase 3: Compute similarities and find top related for each note
  process.stderr.write('[links] Phase 3: Computing similarities...\n');

  let linked = 0;
  let noLinks = 0;

  for (let i = 0; i < notes.length; i++) {
    const note = notes[i];

    // Skip very short notes (< 10 words) — not enough signal
    if (note.wordCount < 10 && note.keywords.size < 5) {
      noLinks++;
      continue;
    }

    // Score against all other notes
    const scores: { idx: number; score: number }[] = [];
    for (let j = 0; j < notes.length; j++) {
      if (i === j) continue;
      const score = similarity(note, notes[j]);
      if (score >= MIN_SCORE) {
        scores.push({ idx: j, score });
      }
    }

    scores.sort((a, b) => b.score - a.score);
    const topRelated = scores.slice(0, MAX_RELATED);

    // Get series nav if any
    const nav = seriesNav.get(i);

    // Filter out series nav titles from related (avoid duplicates)
    const navTitles = new Set<string>();
    if (nav?.prev) navTitles.add(nav.prev);
    if (nav?.next) navTitles.add(nav.next);

    const relatedTitles = topRelated
      .map(s => notes[s.idx].title)
      .filter(t => !navTitles.has(t));

    if (relatedTitles.length === 0 && !nav) {
      noLinks++;
      continue;
    }

    if (dryRun) {
      process.stderr.write(`  [DRY] ${note.title}\n`);
      if (nav?.prev) process.stderr.write(`    prev: ${nav.prev}\n`);
      if (nav?.next) process.stderr.write(`    next: ${nav.next}\n`);
      for (const rt of relatedTitles) {
        const score = topRelated.find(s => notes[s.idx].title === rt)?.score || 0;
        process.stderr.write(`    → ${rt} (${score.toFixed(2)})\n`);
      }
      linked++;
      continue;
    }

    // Write links
    try {
      const raw = fs.readFileSync(note.filePath, 'utf8');
      const { data: fm, content } = matter(raw);
      const cleanContent = stripRelatedSection(content);
      const relatedSection = buildRelatedSection(relatedTitles, nav?.prev, nav?.next);
      const updated = matter.stringify(cleanContent + relatedSection, fm);
      fs.writeFileSync(note.filePath, updated, 'utf8');
      linked++;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      process.stderr.write(`  [ERR] ${note.title}: ${msg}\n`);
    }
  }

  process.stderr.write(`\n[links] Done: ${linked} notes linked, ${noLinks} notes skipped (too short or no matches)\n`);
  console.log(JSON.stringify({ total: notes.length, linked, skipped: noLinks }));
}

// --- CLI ---
async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  await buildLinks({ dryRun });
}

main().catch(err => {
  process.stderr.write(`Fatal: ${err}\n`);
  process.exit(1);
});
