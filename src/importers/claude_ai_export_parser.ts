/**
 * Parser for Claude.ai bulk data export format.
 * Converts conversations.json → ConversationData[] for importBatch()
 */

import * as fs from 'fs';
import { ConversationData, ConversationMessage, importBatch, ImportResult, DuplicateMode } from './claude_importer';

interface RawContent {
  type: string;
  text?: string;
}

interface RawMessage {
  uuid: string;
  text: string;
  content: RawContent[];
  sender: 'human' | 'assistant';
  created_at: string;
  updated_at: string;
  attachments: unknown[];
  files: unknown[];
}

interface RawConversation {
  uuid: string;
  name: string;
  summary: string;
  created_at: string;
  updated_at: string;
  account: { uuid: string };
  chat_messages: RawMessage[];
}

function extractText(msg: RawMessage): string {
  // Prefer content array (richer), fall back to text field
  if (msg.content && msg.content.length > 0) {
    return msg.content
      .filter(c => c.type === 'text' && c.text)
      .map(c => c.text!)
      .join('\n')
      .trim();
  }
  return (msg.text || '').trim();
}

function convertConversation(raw: RawConversation): ConversationData | null {
  const messages = raw.chat_messages
    .map((m): ConversationMessage | null => {
      const text = extractText(m);
      if (!text) return null;
      return {
        role: m.sender === 'human' ? 'human' : 'assistant',
        content: text,
        timestamp: m.created_at,
      };
    })
    .filter((m): m is ConversationMessage => m !== null);

  if (messages.length === 0) return null;

  const title = raw.name?.trim() || `Conversation ${raw.uuid.substring(0, 8)}`;

  return {
    id: raw.uuid,
    title,
    created: raw.created_at,
    updated: raw.updated_at,
    summary: raw.summary?.trim() || undefined,
    messages,
  };
}

export function parseExport(filePath: string): ConversationData[] {
  const raw: RawConversation[] = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  const conversations: ConversationData[] = [];

  for (const r of raw) {
    const conv = convertConversation(r);
    if (conv) conversations.push(conv);
  }

  return conversations;
}

export async function importFromExport(
  exportFilePath: string,
  options: { titleFilter?: string; limit?: number; duplicateMode?: DuplicateMode } = {}
): Promise<ImportResult[]> {
  const mode = options.duplicateMode || 'skip';
  process.stderr.write(`[parser] Reading ${exportFilePath}\n`);
  process.stderr.write(`[parser] Duplicate mode: ${mode}\n`);
  let conversations = parseExport(exportFilePath);
  process.stderr.write(`[parser] Parsed ${conversations.length} conversations with messages\n`);

  if (options.titleFilter) {
    const f = options.titleFilter.toLowerCase();
    conversations = conversations.filter(c => c.title.toLowerCase().includes(f));
    process.stderr.write(`[parser] Filtered to ${conversations.length} matching "${options.titleFilter}"\n`);
  }

  if (options.limit) {
    conversations = conversations.slice(0, options.limit);
    process.stderr.write(`[parser] Limited to ${conversations.length}\n`);
  }

  return importBatch(conversations, mode);
}

// CLI entry point
// Usage: ts-node claude_ai_export_parser.ts <path> [titleFilter] [--overwrite]
async function main() {
  const args = process.argv.slice(2);
  const overwrite = args.includes('--overwrite');
  const positional = args.filter(a => !a.startsWith('--'));

  const exportFile = positional[0] || '/tmp/claude_export/conversations.json';
  const titleFilter = positional[1];
  const duplicateMode = overwrite ? 'overwrite' as const : 'skip' as const;

  const results = await importFromExport(exportFile, { titleFilter, duplicateMode });

  const imported = results.filter(r => r.success && !r.skipped).length;
  const skipped = results.filter(r => r.skipped).length;
  const failed = results.filter(r => !r.success).length;

  process.stderr.write(`\n[parser] Done: ${imported} imported, ${skipped} skipped, ${failed} failed\n`);

  if (failed > 0) {
    process.stderr.write('Failed:\n');
    results.filter(r => !r.success).forEach(r => {
      process.stderr.write(`  - ${r.title}: ${r.message}\n`);
    });
  }

  console.log(JSON.stringify({ imported, skipped, failed }, null, 2));
}

main().catch(err => {
  process.stderr.write(`Fatal: ${err}\n`);
  process.exit(1);
});
