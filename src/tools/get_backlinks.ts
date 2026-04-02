import * as fs from 'fs';
import * as path from 'path';
import { getAllNotes, getRelativePath } from '../utils/vault_ops';
import { parseNote, extractWikiLinks, extractExcerpt } from '../utils/markdown';

export interface GetBacklinksInput {
  note_title: string;  // title or filename (without .md)
}

export interface BacklinkResult {
  title: string;
  file_path: string;
  relative_path: string;
  folder: string;
  excerpt: string;
}

export interface GetBacklinksOutput {
  note: string;
  backlinks: BacklinkResult[];
  total: number;
  by_folder: Record<string, BacklinkResult[]>;
}

export async function getBacklinks(input: GetBacklinksInput): Promise<GetBacklinksOutput> {
  const allFiles = await getAllNotes();
  const targetTitle = input.note_title.replace(/\.md$/, '');
  const backlinks: BacklinkResult[] = [];

  for (const filePath of allFiles) {
    try {
      const raw = fs.readFileSync(filePath, 'utf8');
      const parsed = parseNote(raw);
      const links = extractWikiLinks(parsed.content);

      const linksToTarget = links.filter(
        l => l.toLowerCase() === targetTitle.toLowerCase()
      );

      if (linksToTarget.length > 0) {
        const fm = parsed.frontmatter;
        const title = (fm.title as string) || path.basename(filePath, '.md');
        const relPath = getRelativePath(filePath);
        const folder = path.dirname(relPath);
        const excerpt = extractExcerpt(parsed.content, `[[${targetTitle}`);

        backlinks.push({
          title,
          file_path: filePath,
          relative_path: relPath,
          folder,
          excerpt,
        });
      }
    } catch {
      // Skip unreadable files
    }
  }

  // Group by folder
  const byFolder: Record<string, BacklinkResult[]> = {};
  for (const bl of backlinks) {
    if (!byFolder[bl.folder]) byFolder[bl.folder] = [];
    byFolder[bl.folder].push(bl);
  }

  return {
    note: targetTitle,
    backlinks,
    total: backlinks.length,
    by_folder: byFolder,
  };
}
