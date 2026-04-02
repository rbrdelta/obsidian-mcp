import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ErrorCode,
  McpError,
} from '@modelcontextprotocol/sdk/types.js';

import { createNote } from './tools/create_note';
import { readNote } from './tools/read_note';
import { searchNotes } from './tools/search_notes';
import { linkNotes } from './tools/link_notes';
import { getBacklinks } from './tools/get_backlinks';
import { processDailyNote } from './tools/process_daily_note';
import { takeScreenshot } from './tools/screenshot';

const VAULT_PATH = process.env.VAULT_PATH || '/mnt/c/MCP';

const server = new Server(
  {
    name: 'obsidian-mcp',
    version: '1.0.0',
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: 'create_note',
      description: 'Create a new note in the Obsidian vault with YAML frontmatter and auto-tagging',
      inputSchema: {
        type: 'object',
        properties: {
          title: { type: 'string', description: 'Note title' },
          content: { type: 'string', description: 'Note content (markdown)' },
          tags: { type: 'array', items: { type: 'string' }, description: 'Tags to apply' },
          folder: { type: 'string', description: 'Target folder key (inbox, conversations, knowledge_projects, career, people, concepts, discoveries)' },
          source: { type: 'string', description: 'Source of the note' },
          source_id: { type: 'string', description: 'Source identifier' },
          related: { type: 'array', items: { type: 'string' }, description: 'Related note titles for wiki-links' },
          status: { type: 'string', description: 'Note status (active, imported, archived)' },
          created: { type: 'string', description: 'ISO timestamp for creation date' },
        },
        required: ['title', 'content'],
      },
    },
    {
      name: 'read_note',
      description: 'Read the full content, frontmatter, and metadata of a specific note by path or title',
      inputSchema: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Relative path in vault (e.g. "2026-03-13.md" or "Sources/Claude-Conversations/PKM Project 1.md")' },
          title: { type: 'string', description: 'Note title (resolved by filename search across vault)' },
        },
      },
    },
    {
      name: 'search_notes',
      description: 'Full-text search across all notes in the vault, including imported conversations',
      inputSchema: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Search query' },
          folder: { type: 'string', description: 'Restrict search to folder' },
          tags: { type: 'array', items: { type: 'string' }, description: 'Filter by tags' },
          date_from: { type: 'string', description: 'Filter notes created after this date (ISO)' },
          date_to: { type: 'string', description: 'Filter notes created before this date (ISO)' },
          limit: { type: 'number', description: 'Maximum results to return (default 20)' },
        },
        required: ['query'],
      },
    },
    {
      name: 'link_notes',
      description: 'Create bidirectional [[wiki-style]] links between notes',
      inputSchema: {
        type: 'object',
        properties: {
          links: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                source: { type: 'string', description: 'Source note title or relative path' },
                target: { type: 'string', description: 'Target note title or relative path' },
                alias: { type: 'string', description: 'Optional display alias for the link' },
              },
              required: ['source', 'target'],
            },
            description: 'List of note pairs to link',
          },
          bidirectional: { type: 'boolean', description: 'Create links in both directions (default true)' },
        },
        required: ['links'],
      },
    },
    {
      name: 'get_backlinks',
      description: 'Find all notes that link to a specific note, grouped by folder',
      inputSchema: {
        type: 'object',
        properties: {
          note_title: { type: 'string', description: 'Title of the note to find backlinks for' },
        },
        required: ['note_title'],
      },
    },
    {
      name: 'process_daily_note',
      description: 'Process a daily note: split into atomic notes, deduplicate voice-to-text, auto-tag, auto-link, and rewrite the daily note as a linked index',
      inputSchema: {
        type: 'object',
        properties: {
          date: { type: 'string', description: 'ISO date of the daily note (e.g. "2026-03-13")' },
          dry_run: { type: 'boolean', description: 'Preview proposed notes without creating them (default false)' },
          min_lines: { type: 'number', description: 'Skip sections shorter than this many lines (default 2)' },
          auto_link: { type: 'boolean', description: 'Search vault for related notes and add wiki-links (default true)' },
        },
        required: ['date'],
      },
    },
    {
      name: 'screenshot',
      description: 'Take a screenshot of the current Windows screen and return it as an image',
      inputSchema: {
        type: 'object',
        properties: {
          save_to_vault: { type: 'boolean', description: 'Also save the screenshot to the vault Inbox (default false)' },
        },
      },
    },
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    switch (name) {
      case 'create_note': {
        const result = await createNote(args as unknown as Parameters<typeof createNote>[0]);
        return {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
        };
      }

      case 'read_note': {
        const result = await readNote(args as unknown as Parameters<typeof readNote>[0]);
        return {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
        };
      }

      case 'search_notes': {
        const result = await searchNotes(args as unknown as Parameters<typeof searchNotes>[0]);
        return {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
        };
      }

      case 'link_notes': {
        const result = await linkNotes(args as unknown as Parameters<typeof linkNotes>[0]);
        return {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
        };
      }

      case 'get_backlinks': {
        const result = await getBacklinks(args as unknown as Parameters<typeof getBacklinks>[0]);
        return {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
        };
      }

      case 'process_daily_note': {
        const result = await processDailyNote(args as unknown as Parameters<typeof processDailyNote>[0]);
        return {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
        };
      }

      case 'screenshot': {
        const { output, imageData, mimeType } = await takeScreenshot(
          args as unknown as Parameters<typeof takeScreenshot>[0]
        );
        return {
          content: [
            { type: 'image', data: imageData, mimeType },
            { type: 'text', text: output.message },
          ],
        };
      }

      default:
        throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${name}`);
    }
  } catch (err: unknown) {
    if (err instanceof McpError) throw err;
    const msg = err instanceof Error ? err.message : String(err);
    throw new McpError(ErrorCode.InternalError, `Tool error: ${msg}`);
  }
});

async function main() {
  process.stderr.write(`[obsidian-mcp] Starting server...\n`);
  process.stderr.write(`[obsidian-mcp] Vault: ${VAULT_PATH}\n`);

  const transport = new StdioServerTransport();
  await server.connect(transport);

  process.stderr.write(`[obsidian-mcp] Server ready\n`);
}

main().catch((err) => {
  process.stderr.write(`[obsidian-mcp] Fatal: ${err}\n`);
  process.exit(1);
});
