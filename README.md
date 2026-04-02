# obsidian-mcp

MCP server for the Unified Knowledge Base. Connects Claude Code and Claude Desktop to your Obsidian vault at `/mnt/c/MCP`.

## Tools

| Tool | Description |
|------|-------------|
| `create_note` | Create note with YAML frontmatter + auto-tagging |
| `search_notes` | Full-text search with tag/date filters |
| `link_notes` | Bidirectional [[wiki-links]] between notes |
| `get_backlinks` | Find all notes linking to a note |

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
