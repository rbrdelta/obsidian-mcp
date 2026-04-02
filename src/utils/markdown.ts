import matter from 'gray-matter';

export interface ParsedNote {
  frontmatter: Record<string, unknown>;
  content: string;
  raw: string;
}

export function parseNote(raw: string): ParsedNote {
  const parsed = matter(raw);
  return {
    frontmatter: parsed.data as Record<string, unknown>,
    content: parsed.content,
    raw,
  };
}

export function extractExcerpt(content: string, query: string, contextChars = 200): string {
  const lower = content.toLowerCase();
  const queryLower = query.toLowerCase();
  const idx = lower.indexOf(queryLower);

  if (idx === -1) {
    return content.substring(0, contextChars).replace(/\n+/g, ' ').trim() + '...';
  }

  const start = Math.max(0, idx - contextChars / 2);
  const end = Math.min(content.length, idx + query.length + contextChars / 2);
  const excerpt = content.substring(start, end).replace(/\n+/g, ' ').trim();

  return (start > 0 ? '...' : '') + excerpt + (end < content.length ? '...' : '');
}

export function extractWikiLinks(content: string): string[] {
  const regex = /\[\[([^\]|#]+)(?:[|#][^\]]*)?\]\]/g;
  const links: string[] = [];
  let match;
  while ((match = regex.exec(content)) !== null) {
    links.push(match[1].trim());
  }
  return [...new Set(links)];
}

export function addWikiLink(content: string, linkTarget: string, alias?: string): string {
  const link = alias ? `[[${linkTarget}|${alias}]]` : `[[${linkTarget}]]`;
  if (content.includes(`[[${linkTarget}`)) {
    return content;
  }
  // Append to related section or end of file
  if (content.includes('## Related')) {
    return content.replace('## Related', `## Related\n- ${link}`);
  }
  return content.trimEnd() + `\n\n## Related\n- ${link}\n`;
}
