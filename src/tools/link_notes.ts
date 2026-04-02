import * as fs from 'fs';
import * as path from 'path';
import { resolvePath, noteExists, writeNote, getAllNotes } from '../utils/vault_ops';
import { parseNote, addWikiLink } from '../utils/markdown';

export interface LinkPair {
  source: string;  // relative path or title
  target: string;  // relative path or title
  alias?: string;
}

export interface LinkNotesInput {
  links: LinkPair[];
  bidirectional?: boolean;
}

export interface LinkResult {
  source: string;
  target: string;
  success: boolean;
  message: string;
}

export interface LinkNotesOutput {
  results: LinkResult[];
  created: number;
  failed: number;
}

let _noteCache: string[] | null = null;

async function resolveNotePath(titleOrPath: string): Promise<string | null> {
  // If it looks like a path, resolve directly
  if (titleOrPath.endsWith('.md')) {
    const full = resolvePath(titleOrPath);
    return noteExists(full) ? full : null;
  }

  // Search entire vault for matching filename
  if (!_noteCache) {
    _noteCache = await getAllNotes();
  }
  const target = titleOrPath + '.md';
  for (const notePath of _noteCache) {
    if (path.basename(notePath) === target) return notePath;
  }
  return null;
}

export async function linkNotes(input: LinkNotesInput): Promise<LinkNotesOutput> {
  const results: LinkResult[] = [];
  const bidirectional = input.bidirectional !== false; // default true

  _noteCache = null; // invalidate cache for fresh resolution
  for (const link of input.links) {
    const sourcePath = await resolveNotePath(link.source);
    const targetPath = await resolveNotePath(link.target);

    if (!sourcePath) {
      results.push({ source: link.source, target: link.target, success: false, message: `Source not found: ${link.source}` });
      continue;
    }
    if (!targetPath) {
      results.push({ source: link.source, target: link.target, success: false, message: `Target not found: ${link.target}` });
      continue;
    }

    const targetTitle = path.basename(targetPath, '.md');
    const sourceTitle = path.basename(sourcePath, '.md');

    try {
      // Add forward link: source -> target
      const sourceRaw = fs.readFileSync(sourcePath, 'utf8');
      const sourceUpdated = addWikiLink(sourceRaw, targetTitle, link.alias);
      writeNote(sourcePath, sourceUpdated);

      // Add back link: target -> source
      if (bidirectional) {
        const targetRaw = fs.readFileSync(targetPath, 'utf8');
        const targetUpdated = addWikiLink(targetRaw, sourceTitle);
        writeNote(targetPath, targetUpdated);
      }

      results.push({
        source: link.source,
        target: link.target,
        success: true,
        message: `Linked [[${sourceTitle}]] <-> [[${targetTitle}]]`,
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      results.push({ source: link.source, target: link.target, success: false, message: msg });
    }
  }

  return {
    results,
    created: results.filter(r => r.success).length,
    failed: results.filter(r => !r.success).length,
  };
}
