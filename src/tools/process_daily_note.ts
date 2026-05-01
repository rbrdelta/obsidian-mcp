import * as fs from 'fs';
import * as path from 'path';
import { resolvePath, noteExists, writeNote, getAllNotes } from '../utils/vault_ops';
import { parseNote, extractExcerpt } from '../utils/markdown';
import { autoTag, now } from '../utils/metadata';
import { createNote } from './create_note';
import { searchNotes } from './search_notes';
import { linkNotes } from './link_notes';
import { classifySection, isAvailable as aiAvailable } from '../utils/ai_classifier';

// ─── Types ────────────────────────────────────────────────────────────

export interface ProcessDailyNoteInput {
  date: string;            // ISO date, e.g. "2026-03-13"
  dry_run?: boolean;       // Default false
  min_lines?: number;      // Default 2
  auto_link?: boolean;     // Default true
}

interface ProposedNote {
  title: string;
  content: string;
  tags: string[];
  related: string[];
  content_preview: string;
}

interface SkippedNote {
  reason: 'too_short' | 'duplicate_title' | 'empty' | 'duplicate_content';
  content_preview: string;
}

interface CreatedNote {
  title: string;
  folder: string;
  tags: string[];
  related: string[];
  content_preview: string;
}

export interface ProcessDailyNoteOutput {
  source_note: string;
  notes_created: CreatedNote[];
  notes_skipped: SkippedNote[];
  daily_note_updated: boolean;
  dry_run: boolean;
  proposed?: ProposedNote[];  // Only in dry_run mode
}

// ─── Section splitting ───────────────────────────────────────────────

interface RawSection {
  header: string;
  content: string;
}

function splitSections(content: string): RawSection[] {
  const lines = content.split('\n');
  const sections: RawSection[] = [];
  let currentHeader = '';
  let currentLines: string[] = [];

  for (const line of lines) {
    // H2 header
    if (line.match(/^## (.+)/)) {
      if (currentHeader || currentLines.some(l => l.trim())) {
        sections.push({ header: currentHeader, content: currentLines.join('\n').trim() });
      }
      currentHeader = line.replace(/^## /, '').trim();
      currentLines = [];
    }
    // HR delimiter (fallback if no H2s found later)
    else {
      currentLines.push(line);
    }
  }

  // Push last section
  if (currentHeader || currentLines.some(l => l.trim())) {
    sections.push({ header: currentHeader, content: currentLines.join('\n').trim() });
  }

  // If no H2s were found, try splitting on --- instead
  if (sections.length <= 1 && sections[0]?.content) {
    const hrSections = sections[0].content.split(/\n---\n/);
    if (hrSections.length > 1) {
      return hrSections.map((block, i) => {
        const trimmed = block.trim();
        const firstLine = trimmed.split('\n')[0];
        // Use bold text or first sentence as header
        const boldMatch = firstLine.match(/^\*\*(.+?)\*\*/);
        const header = boldMatch ? boldMatch[1] : firstLine.substring(0, 60);
        return { header, content: trimmed };
      });
    }
  }

  // Filter out sections with no header and no content
  return sections.filter(s => s.header || s.content.trim());
}

// ─── Voice-to-text deduplication ─────────────────────────────────────

function similarity(a: string, b: string): number {
  if (a === b) return 1;
  const aLower = a.toLowerCase().trim();
  const bLower = b.toLowerCase().trim();
  if (aLower === bLower) return 1;

  // Simple word-overlap similarity (Jaccard index)
  const aWords = new Set(aLower.split(/\s+/));
  const bWords = new Set(bLower.split(/\s+/));
  const intersection = new Set([...aWords].filter(w => bWords.has(w)));
  const union = new Set([...aWords, ...bWords]);

  if (union.size === 0) return 0;
  return intersection.size / union.size;
}

function deduplicateParagraphs(content: string): string {
  const paragraphs = content.split(/\n\n+/);
  const kept: string[] = [];

  for (const para of paragraphs) {
    const trimmed = para.trim();
    if (!trimmed) continue;

    // Check if this paragraph is >80% similar to any already-kept paragraph
    const isDuplicate = kept.some(k => similarity(k, trimmed) > 0.8);
    if (!isDuplicate) {
      kept.push(trimmed);
    }
  }

  return kept.join('\n\n');
}

// ─── Classification (heuristic) ──────────────────────────────────────

function classifyTags(title: string, content: string): string[] {
  const text = (title + ' ' + content).toLowerCase();
  const tags = autoTag(text, title);

  // Additional heuristic tags
  const patterns: [RegExp, string][] = [
    [/\b(daughter|son|wife|husband|family|mom|dad|parent|child|kid)\b/i, 'personal'],
    [/\b(lead|leadership|manage|team|culture|tenet|principle|decision)\b/i, 'leadership'],
    [/\b(read|book|learn|study|philosophy|history)\b/i, 'learning'],
    [/\b(idea|project|build|create|tracker|app|tool)\b/i, 'ideas'],
    [/\b(reflect|lesson|insight|realize|principle|mindset)\b/i, 'reflection'],
  ];

  for (const [re, tag] of patterns) {
    if (re.test(text)) tags.push(tag);
  }

  return [...new Set(tags)];
}

function generateTitle(header: string, content: string): string {
  if (header) {
    // Clean up the header — title case, remove markdown
    return header
      .replace(/[*_`#]/g, '')
      .trim()
      .split(' ')
      .map(w => w.charAt(0).toUpperCase() + w.slice(1))
      .join(' ');
  }

  // Generate from first sentence
  const firstSentence = content.split(/[.!?\n]/)[0].trim();
  return firstSentence.substring(0, 60) || 'Untitled Note';
}

// ─── Related notes discovery ─────────────────────────────────────────

async function findRelated(title: string, content: string, maxResults: number = 3): Promise<string[]> {
  // Search for notes related to the title
  const keywords = title.split(/\s+/).filter(w => w.length > 3).join(' ');
  if (!keywords) return [];

  try {
    const results = await searchNotes({ query: keywords, limit: maxResults + 1 });
    return results.results
      .filter(r => r.title !== title) // exclude self
      .slice(0, maxResults)
      .map(r => r.title);
  } catch {
    return [];
  }
}

// ─── Main processor ──────────────────────────────────────────────────

export async function processDailyNote(input: ProcessDailyNoteInput): Promise<ProcessDailyNoteOutput> {
  const dryRun = input.dry_run !== false ? input.dry_run ?? false : false;
  const minLines = input.min_lines ?? 2;
  const autoLink = input.auto_link !== false;

  // Step 1: Read the daily note
  const notePath = resolvePath(`${input.date}.md`);
  if (!noteExists(notePath)) {
    throw new Error(`Daily note not found: ${input.date}.md`);
  }

  const rawContent = fs.readFileSync(notePath, 'utf8');
  const originalContent = rawContent;

  // Step 2: Split into sections
  const sections = splitSections(rawContent);

  const notesCreated: CreatedNote[] = [];
  const notesSkipped: SkippedNote[] = [];
  const proposed: ProposedNote[] = [];

  for (const section of sections) {
    // Deduplicate voice-to-text repeats within the section
    const dedupedContent = deduplicateParagraphs(section.content);

    // Filter: empty
    if (!dedupedContent.trim()) {
      notesSkipped.push({
        reason: 'empty',
        content_preview: section.header || '(empty section)',
      });
      continue;
    }

    // Filter: too short — count words, not lines (voice-to-text often produces single long paragraphs)
    const wordCount = dedupedContent.split(/\s+/).filter(w => w.length > 0).length;
    if (wordCount < 10) {
      notesSkipped.push({
        reason: 'too_short',
        content_preview: dedupedContent.substring(0, 100),
      });
      continue;
    }

    // Check if voice-to-text dedup removed significant content
    if (section.content.length > dedupedContent.length * 1.5) {
      // Significant dedup happened — note it but continue
    }

    let title = generateTitle(section.header, dedupedContent);
    let tags = classifyTags(title, dedupedContent);

    // AI-enhanced classification when API key is available
    if (aiAvailable()) {
      const aiResult = await classifySection(section.header, dedupedContent);
      if (aiResult) {
        title = aiResult.title;
        // Merge AI tags with heuristic tags (AI takes precedence but heuristics add coverage)
        tags = [...new Set([...aiResult.tags, ...tags])];
      }
    }

    // Check for duplicate title in vault
    const allNotes = await getAllNotes();
    const titleFile = title + '.md';
    const exists = allNotes.some(n => path.basename(n) === titleFile);
    if (exists) {
      notesSkipped.push({
        reason: 'duplicate_title',
        content_preview: `"${title}" already exists in vault`,
      });
      continue;
    }

    // Find related notes
    const related = autoLink ? await findRelated(title, dedupedContent) : [];

    const contentPreview = dedupedContent.substring(0, 100);

    if (dryRun) {
      proposed.push({
        title,
        content: dedupedContent,
        tags,
        related,
        content_preview: contentPreview,
      });
    } else {
      // Step 5: Create the note
      const result = await createNote({
        title,
        content: dedupedContent,
        tags,
        folder: 'inbox',
        source: `daily-note/${input.date}`,
        status: 'active',
      });

      // Auto-link to related notes
      if (autoLink && related.length > 0) {
        try {
          await linkNotes({
            links: related.map(r => ({
              source: result.relative_path,
              target: r,
            })),
            bidirectional: true,
          });
        } catch {
          // Non-fatal: linking failure shouldn't block note creation
        }
      }

      notesCreated.push({
        title,
        folder: 'Inbox',
        tags: result.tags_applied,
        related,
        content_preview: contentPreview,
      });
    }
  }

  // Step 6: Rewrite daily note as index (only if not dry_run and notes were created)
  let dailyNoteUpdated = false;
  if (!dryRun && notesCreated.length > 0) {
    const indexContent = buildDailyIndex(input.date, notesCreated, originalContent);
    writeNote(notePath, indexContent);
    dailyNoteUpdated = true;
  }

  return {
    source_note: notePath,
    notes_created: notesCreated,
    notes_skipped: notesSkipped,
    daily_note_updated: dailyNoteUpdated,
    dry_run: dryRun,
    ...(dryRun ? { proposed } : {}),
  };
}

// ─── Daily note index builder ────────────────────────────────────────

function buildDailyIndex(date: string, notes: CreatedNote[], originalContent: string): string {
  const links = notes.map(n => `- [[${n.title}]]`).join('\n');

  return `# ${date}

## Notes created
${links}

## Original capture
<details>
<summary>Raw daily note (archived)</summary>

${originalContent}

</details>
`;
}
