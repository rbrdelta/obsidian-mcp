import * as path from 'path';
import { resolvePath, writeNote, sanitizeFilename } from '../utils/vault_ops';
import { buildFrontmatter, autoTag, now, getConfig } from '../utils/metadata';

export interface CreateNoteInput {
  title: string;
  content: string;
  tags?: string[];
  folder?: string;
  source?: string;
  source_id?: string;
  related?: string[];
  status?: string;
  created?: string;
}

export interface CreateNoteOutput {
  success: boolean;
  file_path: string;
  relative_path: string;
  tags_applied: string[];
  message: string;
}

export async function createNote(input: CreateNoteInput): Promise<CreateNoteOutput> {
  const config = getConfig();

  // Determine folder
  const folderKey = input.folder || 'inbox';
  const folderPath = config.folders[folderKey] || input.folder || 'Inbox';

  // Generate filename
  const filename = sanitizeFilename(input.title) + '.md';
  const filePath = resolvePath(folderPath, filename);
  const relativePath = path.join(folderPath, filename);

  // Auto-tag + merge with provided tags
  const autoTags = autoTag(input.content, input.title);
  const allTags = [...new Set([...(input.tags || []), ...autoTags])];

  // Build frontmatter
  const frontmatter = buildFrontmatter({
    title: input.title,
    created: input.created || now(),
    source: input.source || 'manual',
    ...(input.source_id ? { source_id: input.source_id } : {}),
    tags: allTags,
    ...(input.related && input.related.length > 0 ? { related: input.related } : {}),
    status: input.status || 'active',
  });

  const fullContent = `${frontmatter}\n\n# ${input.title}\n\n${input.content}`;
  writeNote(filePath, fullContent);

  return {
    success: true,
    file_path: filePath,
    relative_path: relativePath,
    tags_applied: allTags,
    message: `Note created: ${relativePath}`,
  };
}
