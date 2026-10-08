# obsidian-mcp

MCP server that gives Claude Code and Claude Desktop read/write access to an Obsidian vault: search, notes, links and AI tagging across ~670 imported notes (Claude.ai conversations, Notion, Apple Notes). The vault path is set by `VAULT_PATH`.

Write-up: [Field Note 01 — Conversation Sync](https://rowbyroh.com/field-notes/conversation-sync).

## Tools

| Tool | Description |
|------|-------------|
| `create_note` | Create note with YAML frontmatter + auto-tagging |
| `search_notes` | Full-text search with tag/date filters |
| `link_notes` | Bidirectional [[wiki-links]] between notes |
| `get_backlinks` | Find all notes linking to a note |
| `read_note` | Read a note's full content, frontmatter and metadata by path or title |
| `process_daily_note` | Split a daily note into atomic notes, dedupe voice-to-text, auto-tag, auto-link |
| `screenshot` | Capture the current Windows screen as an image |

## Setup

```bash
npm install
npm run build
```

MCP config at `~/.config/claude/mcp_servers.json` points Claude to `dist/server.js`.

## Commands

```bash
npm run build          # compile TypeScript
npm run test           # run test suite
VAULT_PATH=/mnt/c/MCP npx ts-node src/seed_conversations.ts  # re-seed conversations
```

## Importing Real Conversations

Export conversations from Claude.ai, then use `importConversation()` from `src/importers/claude_importer.ts` with the `ConversationData` interface.
