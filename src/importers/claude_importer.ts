import * as path from 'path';
import { resolvePath, writeNote, sanitizeFilename, getAllNotes, readNote } from '../utils/vault_ops';
import { buildFrontmatter, autoTag, now } from '../utils/metadata';

export interface ConversationMessage {
  role: 'human' | 'assistant';
  content: string;
  timestamp?: string;
}

export interface ConversationData {
  id: string;
  title: string;
  created: string;
  updated?: string;
  messages: ConversationMessage[];
  summary?: string;
}

export interface ImportResult {
  success: boolean;
  title: string;
  file_path: string;
  relative_path: string;
  tags: string[];
  message: string;
  skipped?: boolean;
}

export type DuplicateMode = 'skip' | 'overwrite';

async function findExistingBySourceId(sourceId: string): Promise<string | null> {
  const notes = await getAllNotes('Sources/Claude-Conversations');
  for (const notePath of notes) {
    const content = readNote(notePath);
    if (content.includes(`source_id: "${sourceId}"`)) {
      return notePath;
    }
  }
  return null;
}

function formatMessages(messages: ConversationMessage[]): string {
  return messages
    .map(msg => {
      const role = msg.role === 'human' ? '**You**' : '**Claude**';
      const ts = msg.timestamp ? ` _(${msg.timestamp})_` : '';
      return `${role}${ts}\n\n${msg.content}`;
    })
    .join('\n\n---\n\n');
}

function extractTopics(messages: ConversationMessage[]): string[] {
  const allText = messages.map(m => m.content).join(' ');
  const topics: string[] = [];

  const patterns: [RegExp, string][] = [
    [/\bpython\b/i, 'python'],
    [/\btypescript\b/i, 'typescript'],
    [/\bjavascript\b/i, 'javascript'],
    [/\bwsl\b/i, 'wsl'],
    [/\bobsidian\b/i, 'obsidian'],
    [/\bmcp\b/i, 'mcp'],
    [/\bcareer\b|\bjob\b|\binterview\b/i, 'career'],
    [/\bai\b|\bclaude\b|\bllm\b/i, 'ai'],
    [/\bstartup\b|\bsaas\b|\bproduct\b/i, 'business'],
    [/\bfinance\b|\binvest\b|\bmoney\b/i, 'finance'],
    [/\bpkm\b|\bknowledge base\b|\bnotes\b/i, 'pkm'],
  ];

  for (const [re, topic] of patterns) {
    if (re.test(allText)) topics.push(topic);
  }

  return [...new Set(topics)];
}

export async function importConversation(
  conv: ConversationData,
  duplicateMode: DuplicateMode = 'skip'
): Promise<ImportResult> {
  const folderPath = 'Sources/Claude-Conversations';
  const filename = sanitizeFilename(conv.title) + '.md';
  const filePath = resolvePath(folderPath, filename);
  const relativePath = path.join(folderPath, filename);

  // Deduplication: check if this source_id already exists
  const existing = await findExistingBySourceId(conv.id);
  if (existing && duplicateMode === 'skip') {
    return {
      success: true,
      skipped: true,
      title: conv.title,
      file_path: existing,
      relative_path: path.relative(resolvePath(), existing),
      tags: [],
      message: `Skipped (already exists): ${conv.title}`,
    };
  }

  const allText = conv.messages.map(m => m.content).join(' ');
  const autoTags = autoTag(allText, conv.title);
  const topicTags = extractTopics(conv.messages);
  const allTags = [...new Set(['claude-conversation', ...autoTags, ...topicTags])];

  const wordCount = allText.split(/\s+/).length;
  const msgCount = conv.messages.length;

  const frontmatter = buildFrontmatter({
    title: conv.title,
    created: conv.created,
    updated: conv.updated || conv.created,
    imported: now(),
    source: 'claude-conversations',
    source_id: conv.id,
    tags: allTags,
    status: 'imported',
    word_count: wordCount,
    message_count: msgCount,
  });

  let body = '';

  if (conv.summary) {
    body += `## Summary\n\n${conv.summary}\n\n`;
  }

  body += `## Conversation\n\n${formatMessages(conv.messages)}`;

  const fullContent = `${frontmatter}\n\n# ${conv.title}\n\n${body}`;
  writeNote(filePath, fullContent);

  return {
    success: true,
    title: conv.title,
    file_path: filePath,
    relative_path: relativePath,
    tags: allTags,
    message: `Imported: ${conv.title}`,
  };
}

export async function importBatch(
  conversations: ConversationData[],
  duplicateMode: DuplicateMode = 'skip'
): Promise<ImportResult[]> {
  const results: ImportResult[] = [];
  for (const conv of conversations) {
    try {
      const result = await importConversation(conv, duplicateMode);
      results.push(result);
      if (result.skipped) {
        process.stderr.write(`  [SKIP] ${conv.title}\n`);
      } else {
        process.stderr.write(`  [OK] ${conv.title}\n`);
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      results.push({
        success: false,
        title: conv.title,
        file_path: '',
        relative_path: '',
        tags: [],
        message: `Failed: ${msg}`,
      });
      process.stderr.write(`  [ERR] ${conv.title}: ${msg}\n`);
    }
  }
  return results;
}
