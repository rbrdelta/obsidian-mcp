import * as fs from 'fs';
import * as path from 'path';
import { getAllNotes, getVaultPath, getRelativePath } from '../utils/vault_ops';
import { parseNote, extractExcerpt } from '../utils/markdown';

export interface SearchInput {
  query: string;
  folder?: string;
  tags?: string[];
  date_from?: string;
  date_to?: string;
  limit?: number;
}

export interface SearchResult {
  title: string;
  file_path: string;
  relative_path: string;
  excerpt: string;
  tags: string[];
  created: string;
  score: number;
}

export interface SearchOutput {
  results: SearchResult[];
  total: number;
  query: string;
}

export async function searchNotes(input: SearchInput): Promise<SearchOutput> {
  const allFiles = await getAllNotes(input.folder);
  const queryLower = input.query.toLowerCase();
  const results: SearchResult[] = [];

  for (const filePath of allFiles) {
    try {
      const raw = fs.readFileSync(filePath, 'utf8');
      const parsed = parseNote(raw);
      const fm = parsed.frontmatter;

      // Filter by tags
      if (input.tags && input.tags.length > 0) {
        const noteTags = (fm.tags as string[]) || [];
        const hasTag = input.tags.some(t => noteTags.includes(t));
        if (!hasTag) continue;
      }

      // Filter by date range
      if (input.date_from && fm.created) {
        if (new Date(fm.created as string) < new Date(input.date_from)) continue;
      }
      if (input.date_to && fm.created) {
        if (new Date(fm.created as string) > new Date(input.date_to)) continue;
      }

      // Score: count occurrences of query in title + content
      const titleStr = (fm.title as string) || path.basename(filePath, '.md');
      const fullText = titleStr.toLowerCase() + ' ' + parsed.content.toLowerCase();
      const titleText = titleStr.toLowerCase();

      let score = 0;
      let searchPos = 0;
      while ((searchPos = fullText.indexOf(queryLower, searchPos)) !== -1) {
        score++;
        searchPos += queryLower.length;
      }

      // Title match bonus
      if (titleText.includes(queryLower)) score += 10;

      if (score === 0) continue;

      results.push({
        title: titleStr,
        file_path: filePath,
        relative_path: getRelativePath(filePath),
        excerpt: extractExcerpt(parsed.content, input.query),
        tags: (fm.tags as string[]) || [],
        created: (fm.created as string) || '',
        score,
      });
    } catch {
      // Skip unreadable files
    }
  }

  // Sort by score descending
  results.sort((a, b) => b.score - a.score);

  const limit = input.limit || 20;
  const sliced = results.slice(0, limit);

  return {
    results: sliced,
    total: results.length,
    query: input.query,
  };
}
