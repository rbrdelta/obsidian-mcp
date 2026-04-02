import * as fs from 'fs';
import * as path from 'path';
import { resolvePath, getAllNotes, getRelativePath, noteExists } from '../utils/vault_ops';
import { parseNote } from '../utils/markdown';

export interface ReadNoteInput {
  path?: string;    // Relative path in vault, e.g. "2026-03-13.md" or "Sources/Claude-Conversations/PKM Project 1.md"
  title?: string;   // Note title — resolved via vault-wide filename search
}

export interface ReadNoteOutput {
  title: string;
  path: string;
  relative_path: string;
  content: string;
  frontmatter: Record<string, unknown>;
  tags: string[];
  created: string;
  modified: string;
  word_count: number;
}

async function resolveByTitle(title: string): Promise<string | null> {
  const allNotes = await getAllNotes();
  const target = title.endsWith('.md') ? title : title + '.md';
  for (const notePath of allNotes) {
    if (path.basename(notePath) === target) return notePath;
  }
  // Fallback: case-insensitive match
  const targetLower = target.toLowerCase();
  for (const notePath of allNotes) {
    if (path.basename(notePath).toLowerCase() === targetLower) return notePath;
  }
  return null;
}

export async function readNote(input: ReadNoteInput): Promise<ReadNoteOutput> {
  if (!input.path && !input.title) {
    throw new Error('Either path or title is required');
  }

  let fullPath: string;

  if (input.path) {
    fullPath = resolvePath(input.path);
    if (!noteExists(fullPath)) {
      throw new Error(`Note not found: ${input.path}`);
    }
  } else {
    const resolved = await resolveByTitle(input.title!);
    if (!resolved) {
      throw new Error(`Note not found by title: ${input.title}`);
    }
    fullPath = resolved;
  }

  const raw = fs.readFileSync(fullPath, 'utf8');
  const parsed = parseNote(raw);
  const fm = parsed.frontmatter;
  const stat = fs.statSync(fullPath);

  const titleStr = (fm.title as string) || path.basename(fullPath, '.md');
  const tags = (fm.tags as string[]) || [];
  const created = (fm.created as string) || stat.birthtime.toISOString();
  const modified = (fm.updated as string) || stat.mtime.toISOString();
  const wordCount = parsed.content.split(/\s+/).filter(w => w.length > 0).length;

  return {
    title: titleStr,
    path: fullPath,
    relative_path: getRelativePath(fullPath),
    content: parsed.content,
    frontmatter: fm,
    tags,
    created,
    modified,
    word_count: wordCount,
  };
}
