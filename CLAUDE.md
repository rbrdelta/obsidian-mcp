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
| Apple Notes sync | `src/importers/apple_notes_sync.ts` | Retired 2026-10-09 — 278 notes kept as archive |

### Sync Commands
```bash
# Claude.ai (needs CLAUDE_SESSION_KEY env var)
npm run sync / sync:dry / sync:dev

# Notion (needs NOTION_TOKEN env var)
npm run notion:sync / notion:dry / notion:dev

# Apple Notes (retired 2026-10-09 — archive only, don't run the Shortcut)
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

## Collaboration Modes

Match your posture to the mode Daniel is working in:

- **Explore mode** — Daniel will say "explore", "what if", or "what about". Push past the obvious answers. Try unconventional approaches. Don't converge too early. Surface tradeoffs and interesting alternatives rather than picking the safe default. Iterate through the mediocre-obvious layer to get to the good bits.
- **Build mode** — Daniel will provide acceptance criteria or a sprint contract. Execute to spec. Do NOT add features, reinterpret requirements, or "improve" the acceptance criteria. If something is ambiguous, ask — don't assume.
- **Solve mode** — Technical problem. Daniel defines the problem, you own the solution. Lead the implementation. Use your judgment on approach without over-explaining or asking permission for standard engineering decisions.

When the mode isn't explicit, infer from context: a problem statement with no spec = solve mode, a spec with acceptance criteria = build mode, open-ended questions = explore mode.

## Sprint Contract Format

When Daniel provides a sprint contract, it contains his intent — not a starting point for reinterpretation. Sprint contracts include:

- **Intent**: What he's trying to achieve and WHY this shape, not just what
- **Acceptance criteria**: Specific, testable outcomes he wrote himself
- **Anti-goals**: What this is NOT — prevents scope creep and "improvements" beyond scope
- **Examples**: Concrete before/after or input/output pairs when available

**Rules for sprint contracts:**
- Do NOT rewrite or "improve" the acceptance criteria. Execute them as written.
- If a criterion is ambiguous, ask for clarification rather than interpreting.
- Anti-goals are hard constraints — never build toward them even if it seems like a good idea.

## Planning Conversations

When Daniel describes what he wants to build:

1. **Capture his intent verbatim first** before asking clarifying questions
2. **Frame follow-up questions around gaps in HIS description**, not around implementation possibilities — ask "what did you mean by X" not "would you like X or Y"
3. **Don't front-load implementation concerns** during ideation — let Daniel finish thinking before raising constraints
4. **Distinguish what Daniel is asking**: Is it a technical problem (you lead), a creative project (push past defaults, iterate), or production-ready build (execute to spec)?
5. **The agent's planning perspective is not Daniel's perspective** — the model's follow-up questions reflect what it's capable of and what's probable from training data, not what Daniel is imagining. Bridge that gap by asking about his vision, not proposing from yours.

## New Features

When building new tools or importers, Daniel may provide failing tests first. These are the spec:

- Make the tests pass without modifying the test assertions
- The test file defines the acceptance criteria — treat it like a sprint contract
- If a test seems wrong, ask before changing it
