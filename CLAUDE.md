# Obsidian MCP Server

MCP server that connects Claude (Desktop, Code, Browser) to an Obsidian vault at `/mnt/c/MCP`.

## Quick Reference

```bash
npm run build          # Rebuild TypeScript → dist/
npm test               # Tests against dev vault (/mnt/c/MCP-dev)
npm run test:prod      # Tests against prod vault (/mnt/c/MCP)
npm run promote        # build + test dev + test prod (full pipeline)
```

## MCP Tools (7 total)

`create_note`, `read_note`, `search_notes`, `link_notes`, `get_backlinks`, `process_daily_note`, `screenshot`

## Data Sync Importers

| Importer | Source file | Status |
|----------|-----------|--------|
| Claude.ai API sync | `src/importers/claude_api_sync.ts` | Active — 270+ conversations |
| Notion API sync | `src/importers/notion_sync.ts` | Active, dynamic — 104 pages (Daniel's workspace, updates over API) |
| Notion export parser | `src/importers/notion_export_parser.ts` | One-time, static — 77 pages (guest workspace snapshot, not updated) |
| Claude.ai bulk export | `src/importers/claude_ai_export_parser.ts` | Legacy (one-time use) |
| Apple Notes sync | `src/importers/apple_notes_sync.ts` | Semi-automated — 278 notes (iPhone Shortcut → iCloud Drive, 50/batch) |

### Sync Commands
```bash
# Claude.ai (needs CLAUDE_SESSION_KEY env var)
npm run sync / sync:dry / sync:dev

# Notion (needs NOTION_TOKEN env var)
npm run notion:sync / notion:dry / notion:dev

# Apple Notes (run iPhone Shortcut first, wait for iCloud sync)
npm run apple:sync / apple:dry / apple:dev
```

All importers follow the same pattern: idempotent by `source_id`, incremental via index + timestamp files, test in dev vault first.

## Architecture

- **Entry point:** `dist/server.js` (compiled from `src/server.ts`)
- **Shared utilities:** `src/utils/vault_ops.ts` (path resolution, file I/O), `src/utils/metadata.ts` (frontmatter, auto-tagging)
- **Importer shared types:** `src/importers/claude_importer.ts` (`ConversationData`, `ImportResult`, `importBatch()`)
- **Dev vault:** `/mnt/c/MCP-dev` — always test here first
- **Prod vault:** `/mnt/c/MCP` — only after dev passes

## Development Rules

- New tools: build with `dry_run` first, validate, then enable writes
- Never touch prod without passing dev tests
- All vault notes use YAML frontmatter with `source`, `source_id`, `tags`, `status`
- Organization is tags + links, not folders
- **NEVER read, search, or access `/mnt/c/MCP/Confidential/`** — private data, off-limits to all AI surfaces
