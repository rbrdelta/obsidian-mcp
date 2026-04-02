/**
 * Seeds 20 representative conversations into the vault.
 * These represent the kinds of conversations a PKM/dev user would have.
 * Replace with actual Claude conversation exports when available.
 */

import { importBatch, ConversationData } from './importers/claude_importer';

const conversations: ConversationData[] = [
  {
    id: 'conv-001',
    title: 'PKM System Design and Obsidian Setup',
    created: '2026-01-10T09:00:00Z',
    updated: '2026-01-10T11:30:00Z',
    summary: 'Designed a personal knowledge management system using Obsidian with MCP integration for Claude access.',
    messages: [
      { role: 'human', content: 'I want to build a unified knowledge base that works with Claude. I use Obsidian and want to be able to search and create notes from Claude conversations.' },
      { role: 'assistant', content: 'Great idea! Here\'s a solid architecture for your PKM system:\n\n**Core Components:**\n1. **Obsidian Vault** - Your knowledge store at `/mnt/c/MCP`\n2. **MCP Server** - Bridges Claude to your vault\n3. **Importers** - Pull in conversations, notes from other apps\n\n**Vault Structure:**\n```\nMCP/\n├── Inbox/          # Quick captures\n├── Sources/        # Raw imports\n├── Knowledge/      # Processed notes\n├── Daily/          # Daily notes\n└── Meta/           # System docs\n```\n\nThe key insight is to separate *sources* (raw imports) from *knowledge* (processed, linked notes). This keeps your vault clean.' },
      { role: 'human', content: 'What MCP tools should I build first?' },
      { role: 'assistant', content: 'For Phase 1, focus on these 4 tools:\n\n1. **`create_note`** - Create notes with proper YAML frontmatter\n2. **`search_notes`** - Full-text search across vault\n3. **`link_notes`** - Create bidirectional wiki-links\n4. **`get_backlinks`** - Find what links to a note\n\nThis gives you the CRUD + discovery operations you need. Later you can add `daily_note`, `move_note`, and `merge_notes` tools.' },
    ],
  },
  {
    id: 'conv-002',
    title: 'WSL2 Development Environment Setup',
    created: '2026-01-08T14:00:00Z',
    updated: '2026-01-08T16:00:00Z',
    summary: 'Set up a complete WSL2 development environment with Node.js, Python, and VS Code integration.',
    messages: [
      { role: 'human', content: 'Help me set up WSL2 as my primary dev environment. I have Windows 11 with Ubuntu installed.' },
      { role: 'assistant', content: 'Here\'s a complete WSL2 dev setup:\n\n**1. Update Ubuntu:**\n```bash\nsudo apt update && sudo apt upgrade -y\n```\n\n**2. Install Node.js via nvm:**\n```bash\ncurl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.0/install.sh | bash\nnvm install --lts\n```\n\n**3. Install Python:**\n```bash\nsudo apt install python3 python3-pip python3-venv -y\n```\n\n**4. Mount Windows drives:**\nWindows drives are at `/mnt/c/`. For performance, keep your dev files in `~/` (Linux filesystem), not `/mnt/c/`.\n\n**5. VS Code:**\nInstall the WSL extension and open projects with `code .` from WSL terminal.' },
      { role: 'human', content: 'How do I access files between WSL and Windows?' },
      { role: 'assistant', content: 'File access between WSL and Windows:\n\n**From WSL to Windows:** `/mnt/c/Users/YourName/`\n**From Windows to WSL:** `\\\\wsl$\\Ubuntu\\home\\yourusername\\`\n\n**Performance tip:** Keep working files in WSL filesystem (`~/projects/`). Only use `/mnt/c/` for shared files like your Obsidian vault. I/O across the boundary is ~3x slower.' },
    ],
  },
  {
    id: 'conv-003',
    title: 'TypeScript MCP Server Architecture',
    created: '2026-01-11T10:00:00Z',
    updated: '2026-01-11T13:00:00Z',
    summary: 'Designed TypeScript MCP server with proper tool schemas, error handling, and stdio transport.',
    messages: [
      { role: 'human', content: 'How do I structure a TypeScript MCP server? I want tools that work with both Claude Desktop and Claude Code.' },
      { role: 'assistant', content: 'Here\'s the standard MCP server structure for TypeScript:\n\n```typescript\nimport { Server } from \'@modelcontextprotocol/sdk/server/index.js\';\nimport { StdioServerTransport } from \'@modelcontextprotocol/sdk/server/stdio.js\';\n\nconst server = new Server(\n  { name: \'my-server\', version: \'1.0.0\' },\n  { capabilities: { tools: {} } }\n);\n\n// List tools handler\nserver.setRequestHandler(ListToolsRequestSchema, async () => ({\n  tools: [/* your tool definitions */]\n}));\n\n// Call tool handler\nserver.setRequestHandler(CallToolRequestSchema, async (request) => {\n  // dispatch to tool functions\n});\n\nconst transport = new StdioServerTransport();\nawait server.connect(transport);\n```\n\n**Key points:**\n- Use stdio transport for both Claude Desktop and Claude Code\n- Tool schemas must follow JSON Schema\n- Always write logs to `stderr`, not `stdout`' },
      { role: 'human', content: 'What goes in mcp_servers.json for Claude Desktop?' },
      { role: 'assistant', content: '```json\n{\n  "mcpServers": {\n    "my-server": {\n      "type": "stdio",\n      "command": "node",\n      "args": ["/path/to/dist/server.js"],\n      "env": {\n        "MY_ENV_VAR": "value"\n      }\n    }\n  }\n}\n```\n\nFor Claude Code, the config lives at `~/.config/claude/mcp_servers.json` (same format but without the `mcpServers` wrapper in some versions).' },
    ],
  },
  {
    id: 'conv-004',
    title: 'Career Pivot Strategy - Tech to Product',
    created: '2025-11-15T09:00:00Z',
    updated: '2025-11-15T10:30:00Z',
    summary: 'Explored career pivot from engineering to product management. Identified transferable skills and target companies.',
    messages: [
      { role: 'human', content: 'I\'m a senior engineer with 8 years experience. I want to pivot to product management. How realistic is this and what should my strategy be?' },
      { role: 'assistant', content: 'This is one of the most natural pivots in tech and very achievable. Your engineering background is actually a competitive advantage for technical PM roles.\n\n**Why engineers make great PMs:**\n- Deep understanding of technical constraints and tradeoffs\n- Credibility with eng teams\n- Can write better specs\n- Understand what\'s hard vs easy to build\n\n**Strategy:**\n1. **Target technical PM roles first** - Infrastructure PM, Platform PM, Developer Tools PM\n2. **Leverage current company** - Volunteer for PM-adjacent work: write specs, run customer interviews, own roadmap items\n3. **Build your portfolio** - Document a product you shipped, including the why/how decisions\n4. **Network** - PM communities: Lenny\'s Newsletter, Reforge, MindTheProduct\n\n**Timeline:** 6-12 months if strategic. Start internally if possible.' },
      { role: 'human', content: 'What companies should I target for a first PM role coming from engineering?' },
      { role: 'assistant', content: '**Best fits for engineer-to-PM:**\n\n**Developer tool companies** (your eng skills shine most):\n- Linear, Vercel, Railway, Supabase\n- GitHub, GitLab (established, good programs)\n- Stripe (legendary PM culture)\n\n**Mid-size companies** (faster progression, more scope):\n- Series B-D startups in your domain\n- Look for "Technical PM" or "Platform PM" in job titles\n\n**Avoid initially:**\n- Consumer apps (very different skillset)\n- Big Tech APM programs (designed for new grads)\n\n**Your differentiator:** Apply to companies where you can talk to their engineering stack credibly. If you\'ve worked with Postgres, target Supabase. Used Kubernetes? Target a cloud-native company.' },
    ],
  },
  {
    id: 'conv-005',
    title: 'Side Project Ideas - AI SaaS Products',
    created: '2025-12-01T20:00:00Z',
    updated: '2025-12-01T21:30:00Z',
    summary: 'Brainstormed AI-powered SaaS product ideas with market analysis and MVP scope.',
    messages: [
      { role: 'human', content: 'I want to build an AI SaaS side project. I have TypeScript/Python skills and $500/mo to spend on APIs. What are promising niches?' },
      { role: 'assistant', content: '**High-signal niches in 2025-2026:**\n\n**1. Vertical AI agents for SMBs**\n- Bookkeepers/accountants: automated categorization + anomaly detection\n- Property managers: lease analysis, maintenance ticket routing\n- Law firms: contract review, precedent research\n\n**2. Workflow automation with AI judgment**\n- "If X happens in Notion/Linear/Slack, do Y with AI reasoning"\n- Zapier is too dumb; full code is too hard; there\'s a gap\n\n**3. Personal AI infrastructure**\n- Tools that help individuals have persistent AI memory\n- Your PKM project is in this space!\n\n**With $500/mo API budget:** You can run ~5M Claude Haiku tokens or ~500k Sonnet tokens. Focus on products where each API call has clear value.' },
      { role: 'human', content: 'Which of these could I launch in 30 days?' },
      { role: 'assistant', content: '**30-day viable option: Niche document processor**\n\nPick ONE document type in ONE industry:\n- Example: "AI lease abstractor for property managers"\n- Users upload PDF leases, get structured data + summaries\n- $49/mo for 50 leases, $149/mo unlimited\n\n**Week 1:** Build PDF → Claude → structured JSON pipeline\n**Week 2:** Basic UI (Next.js), auth (Clerk), payments (Stripe)\n**Week 3:** 10 beta users from Reddit/LinkedIn/cold DM\n**Week 4:** Iterate on feedback, launch ProductHunt\n\n**Stack:** Next.js + Vercel + Supabase + Stripe + Claude API\n**Cost:** ~$50/mo infra + API costs\n**Revenue target:** 10 customers = $490-1490/mo' },
    ],
  },
  {
    id: 'conv-006',
    title: 'Python Async Patterns and Best Practices',
    created: '2025-10-20T14:00:00Z',
    updated: '2025-10-20T15:30:00Z',
    summary: 'Deep dive into Python async/await patterns, common pitfalls, and performance optimization.',
    messages: [
      { role: 'human', content: 'I keep getting confused about Python asyncio. When should I use async def vs regular functions? And what\'s the difference between gather and create_task?' },
      { role: 'assistant', content: '**When to use async:**\n- I/O bound operations: HTTP requests, DB queries, file reads\n- NOT for CPU-bound work (use multiprocessing instead)\n\n**gather vs create_task:**\n\n```python\n# gather: runs coroutines concurrently, waits for all\nresults = await asyncio.gather(fetch(url1), fetch(url2))\n\n# create_task: fire and forget, runs in background\ntask = asyncio.create_task(fetch(url1))\n# ... do other work ...\nresult = await task\n```\n\n**Key difference:** `gather` is for when you need all results before proceeding. `create_task` is for when you want to start something and do other work meanwhile.\n\n**Common pitfall:**\n```python\n# WRONG: this runs sequentially!\nresult1 = await fetch(url1)\nresult2 = await fetch(url2)\n\n# RIGHT: concurrent\nresult1, result2 = await asyncio.gather(fetch(url1), fetch(url2))\n```' },
      { role: 'human', content: 'How do I handle errors when using gather?' },
      { role: 'assistant', content: '```python\n# By default, gather cancels all tasks if one fails\n# Use return_exceptions=True to get errors as values:\n\nresults = await asyncio.gather(\n    fetch(url1), fetch(url2), fetch(url3),\n    return_exceptions=True\n)\n\nfor result in results:\n    if isinstance(result, Exception):\n        print(f"Failed: {result}")\n    else:\n        process(result)\n```\n\nFor more control, use `asyncio.TaskGroup` (Python 3.11+):\n```python\nasync with asyncio.TaskGroup() as tg:\n    task1 = tg.create_task(fetch(url1))\n    task2 = tg.create_task(fetch(url2))\n# All tasks done here; any exception propagates\n```' },
    ],
  },
  {
    id: 'conv-007',
    title: 'Interview Prep - System Design',
    created: '2025-11-28T19:00:00Z',
    updated: '2025-11-28T21:00:00Z',
    summary: 'Practiced system design interviews with URL shortener and rate limiter examples.',
    messages: [
      { role: 'human', content: 'I have a senior engineering interview at a top tech company next week. Help me prep for system design. Give me a mock question.' },
      { role: 'assistant', content: '**Mock Question:** Design a URL shortener like bit.ly\n\n**Clarify requirements first (ask these):**\n- Scale: 100M URLs/day? 1B?\n- Read/write ratio? (typically 100:1 for shorteners)\n- Custom URLs? Analytics? Expiration?\n\n**High-level design:**\n1. **API:** POST /shorten → short_code; GET /{code} → redirect\n2. **ID generation:** Base62 encode a counter or use UUID. Counter + ZooKeeper for distributed unique IDs.\n3. **Storage:** Key-value store (Redis for hot, Cassandra for cold)\n4. **Redirect:** 301 (permanent, cached) vs 302 (temporary, tracked)\n\n**Deep dives to prepare:** Handling hot URLs, expiration cleanup, analytics pipeline, avoiding hash collisions.' },
      { role: 'human', content: 'How should I structure my answer to stay within time?' },
      { role: 'assistant', content: '**45-minute system design framework:**\n\n- **0-5min:** Clarify requirements, define scope\n- **5-10min:** Back-of-envelope math (users, QPS, storage)\n- **10-20min:** High-level architecture (draw boxes, explain flow)\n- **20-35min:** Deep dive on 2-3 components the interviewer cares about\n- **35-45min:** Handle edge cases, tradeoffs, what you\'d do differently\n\n**Communication tips:**\n- Think out loud, narrate decisions\n- State tradeoffs explicitly: "I chose X over Y because..."\n- Ask "Does this direction make sense?" before going deep\n- It\'s OK to say "I\'d look up the exact numbers but roughly..."' },
    ],
  },
  {
    id: 'conv-008',
    title: 'Obsidian Plugin Ecosystem and Workflows',
    created: '2026-01-05T10:00:00Z',
    updated: '2026-01-05T11:00:00Z',
    summary: 'Explored essential Obsidian plugins for a developer-focused PKM workflow.',
    messages: [
      { role: 'human', content: 'What Obsidian plugins should I install for a developer-focused knowledge base?' },
      { role: 'assistant', content: '**Essential plugins for devs:**\n\n**Core workflow:**\n- **Dataview** - Query your vault like a database (`TABLE`, `LIST`, `TASK`)\n- **Templater** - Dynamic templates with JavaScript\n- **QuickAdd** - Fast note creation from anywhere\n\n**Linking & discovery:**\n- **Graph Analysis** - Find related notes algorithmically\n- **Strange New Worlds** - See backlinks inline while writing\n\n**Code & technical:**\n- **Code Block Enhancer** - Better code blocks with copy button\n- **Excalidraw** - Diagrams in your vault\n\n**Capture:**\n- **Clipper** (browser extension) - Clip web pages to vault\n- **Daily Notes** (core) - Quick daily log\n\n**Avoid early on:** Don\'t install too many plugins before establishing your workflow. Start with Dataview + Templater, add others as needed.' },
      { role: 'human', content: 'How do I set up Dataview for tracking my projects?' },
      { role: 'assistant', content: '**Project tracking with Dataview:**\n\nAdd YAML frontmatter to project notes:\n```yaml\n---\nstatus: active  # active | paused | done\npriority: high\ndue: 2026-02-01\ntags: [project, saas]\n---\n```\n\nThen in your dashboard note:\n````markdown\n```dataview\nTABLE status, priority, due\nFROM "Knowledge/Projects"\nWHERE status = "active"\nSORT priority DESC\n```\n````\n\n**For tasks across notes:**\n````markdown\n```dataview\nTASK\nFROM "Knowledge/Projects"\nWHERE !completed\nGROUP BY file.name\n```\n````' },
    ],
  },
  {
    id: 'conv-009',
    title: 'Financial Planning and Investment Strategy',
    created: '2025-09-15T20:00:00Z',
    updated: '2025-09-15T21:00:00Z',
    summary: 'Discussed investment portfolio allocation, index funds vs individual stocks, and emergency fund sizing.',
    messages: [
      { role: 'human', content: 'I\'m 32, have $80k saved, and want to start investing seriously. I have a stable tech job. How should I think about allocation?' },
      { role: 'assistant', content: '**Before investing: Checklist**\n- Emergency fund: 3-6 months expenses in HYSA ✓ (you mentioned stable job, so 3mo is fine)\n- High-interest debt: Pay off anything >7% APR first\n- Employer 401k match: Contribute at least enough to get full match (free money)\n\n**Basic allocation for your situation:**\n- Max 401k: $23,500/yr (2025 limit)\n- Max Roth IRA: $7,000/yr (if income eligible)\n- Taxable brokerage: remainder\n\n**Within accounts:** At 32, something like 90% equities / 10% bonds is reasonable. Simple approach: VTSAX (total US market) + VXUS (international) + BND (bonds). Three funds, done.\n\n*This is general education, not personalized financial advice.*' },
      { role: 'human', content: 'Is it worth trying to pick individual stocks or just stick to index funds?' },
      { role: 'assistant', content: 'The data is pretty clear: **index funds beat most active managers over 15+ years**. S&P 500 outperforms ~85% of active fund managers over 15 years.\n\n**If you want to do individual stocks anyway:**\n- "Play money" rule: max 5-10% of portfolio\n- Only stocks in industries you understand deeply\n- Be honest about whether you\'re investing or gambling\n\n**The math:** If you invest $80k today in index funds at 7% average real return, you\'ll have ~$600k at 60. Individual stock picking needs to significantly outperform to beat that after taxes and time spent.\n\n**My take:** Your tech salary and skills are your alpha. Optimize your career (get raises, equity, side income) more than trying to beat the market.' },
    ],
  },
  {
    id: 'conv-010',
    title: 'Git Advanced Workflows and Team Practices',
    created: '2025-10-05T11:00:00Z',
    updated: '2025-10-05T12:00:00Z',
    summary: 'Covered advanced git workflows including rebasing, bisect, reflog recovery, and team branching strategies.',
    messages: [
      { role: 'human', content: 'What are some advanced git techniques I should know as a senior dev?' },
      { role: 'assistant', content: '**Git techniques that separate seniors:**\n\n**1. Interactive rebase for clean history:**\n```bash\ngit rebase -i HEAD~5  # squash/reorder last 5 commits\n```\n\n**2. Git bisect to find regressions:**\n```bash\ngit bisect start\ngit bisect bad           # current is broken\ngit bisect good v1.2.0   # this was good\n# git checks out middle commit, you test, repeat\ngit bisect good/bad\n```\n\n**3. Reflog - recover "lost" commits:**\n```bash\ngit reflog              # see all HEAD positions\ngit checkout HEAD@{5}  # go back to where you were\n```\n\n**4. Stash with names:**\n```bash\ngit stash push -m "wip: auth refactor"\ngit stash list\ngit stash pop stash@{0}\n```\n\n**5. Partial staging:**\n```bash\ngit add -p  # interactive hunk selection\n```' },
    ],
  },
  {
    id: 'conv-011',
    title: 'LLM Prompt Engineering Techniques',
    created: '2025-12-10T14:00:00Z',
    updated: '2025-12-10T15:30:00Z',
    summary: 'Explored prompt engineering patterns: chain of thought, few-shot, system prompts, and structured output.',
    messages: [
      { role: 'human', content: 'What are the most effective prompt engineering techniques for getting better results from Claude?' },
      { role: 'assistant', content: '**High-impact techniques:**\n\n**1. Chain of Thought (CoT)**\nAdd "Think step by step" or include `<thinking>` tags. Dramatically improves reasoning tasks.\n\n**2. Few-shot examples**\nShow 2-3 examples of input → output before your actual request. More reliable than describing the format.\n\n**3. Role + context in system prompt**\n```\nYou are a senior TypeScript engineer reviewing PRs at a startup. Be direct and technical. Flag security issues.\n```\n\n**4. Structured output with XML tags**\n```\nReturn your analysis in this format:\n<summary>one sentence</summary>\n<issues>bullet list</issues>\n<recommendation>action item</recommendation>\n```\n\n**5. Constrain the output**\n"In 3 bullet points", "In one paragraph", "As a JSON object with keys: x, y, z"\n\n**6. Break complex tasks into steps**\nDon\'t ask Claude to do 5 things in one prompt. Chain prompts.' },
      { role: 'human', content: 'How do I get Claude to be more concise?' },
      { role: 'assistant', content: 'Most reliable techniques for concise Claude:\n\n1. **State the constraint directly:** "Answer in 2-3 sentences max."\n2. **Ask for bullet points:** Inherently shorter than prose\n3. **Specify what to omit:** "No preamble, no summary. Just the answer."\n4. **Grade the response:** "That\'s too long. Give me the key point in one sentence."\n5. **Use system prompt:** Put "Be extremely concise" in the system prompt, not the user message\n\nThe most powerful: combine format + length constraint: "In a markdown table with 3 columns (what, why, example), max 5 rows."' },
    ],
  },
  {
    id: 'conv-012',
    title: 'React Performance Optimization',
    created: '2025-10-15T10:00:00Z',
    updated: '2025-10-15T11:30:00Z',
    summary: 'Covered React performance patterns: memo, useMemo, useCallback, virtualization, and profiling.',
    messages: [
      { role: 'human', content: 'My React app is getting slow with large lists. What are the best optimization strategies?' },
      { role: 'assistant', content: '**React performance toolkit:**\n\n**1. Virtualize large lists** (most impactful for your case)\n```tsx\nimport { FixedSizeList } from \'react-window\';\n// Renders only visible items, not all 10,000\n```\n\n**2. Memoize expensive components:**\n```tsx\nconst Item = React.memo(({ data }) => <div>{data.name}</div>);\n```\n\n**3. Memoize expensive calculations:**\n```tsx\nconst sorted = useMemo(() => expensiveSort(items), [items]);\n```\n\n**4. Stable callbacks:**\n```tsx\nconst handleClick = useCallback((id) => {\n  dispatch({ type: \'SELECT\', id });\n}, [dispatch]);\n```\n\n**Before optimizing:** Profile first! React DevTools Profiler shows exactly what\'s re-rendering and why. Don\'t guess.' },
    ],
  },
  {
    id: 'conv-013',
    title: 'PostgreSQL Query Optimization',
    created: '2025-09-20T09:00:00Z',
    updated: '2025-09-20T10:30:00Z',
    summary: 'Diagnosed slow PostgreSQL queries, explained EXPLAIN ANALYZE output, and covered index strategies.',
    messages: [
      { role: 'human', content: 'I have a PostgreSQL query that\'s taking 3 seconds. It joins 4 tables and filters by date. How do I diagnose and fix it?' },
      { role: 'assistant', content: '**Step 1: Get the query plan**\n```sql\nEXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT) \nSELECT ... FROM ... WHERE ...;\n```\n\n**What to look for:**\n- `Seq Scan` on large tables = missing index\n- High `rows=X` estimates that are way off actual = stale stats (`ANALYZE table_name`)\n- `Hash Join` vs `Nested Loop` - hash is usually better for large sets\n- `Buffers: hit=X read=Y` - high read = disk I/O bottleneck\n\n**Common fixes:**\n1. **Add index on filter columns:**\n```sql\nCREATE INDEX idx_orders_created ON orders(created_at);\n-- For range queries:\nCREATE INDEX idx_orders_date_range ON orders(created_at) WHERE created_at > \'2025-01-01\';\n```\n2. **Composite index for common query patterns:**\n```sql\nCREATE INDEX idx_orders_user_status ON orders(user_id, status);\n```\n3. **Refresh statistics:** `ANALYZE orders;`\n4. **Materialized view** for heavy aggregations run repeatedly' },
    ],
  },
  {
    id: 'conv-014',
    title: 'Personal Productivity System Design',
    created: '2025-11-01T09:00:00Z',
    updated: '2025-11-01T10:30:00Z',
    summary: 'Designed a minimal productivity system combining time blocking, weekly reviews, and AI assistance.',
    messages: [
      { role: 'human', content: 'I feel overwhelmed with too many systems - I have Notion, Todoist, calendar, and Obsidian and nothing works together. Help me simplify.' },
      { role: 'assistant', content: '**The problem:** Too many apps = cognitive overhead maintaining them all.\n\n**Minimal viable system:**\n\n**One capture point:** Everything goes to one inbox (Obsidian Inbox or physical notebook)\n\n**One task list:** Pick ONE. Todoist is fine, or just Obsidian Tasks. Migrate everything there.\n\n**Calendar = commitments only:** Time-blocked work sessions, meetings, deadlines. Not "I might do this."\n\n**Weekly review (30 min Sundays):**\n1. Empty inbox → process to tasks/notes/trash\n2. Review what didn\'t get done and why\n3. Set 3 priorities for the week\n\n**Obsidian role:** Long-term reference and thinking. Not task management.\n\n**My recommendation:** Drop Notion (highest maintenance). Use Obsidian for notes, Todoist for tasks, Calendar for time, nothing else.' },
      { role: 'human', content: 'How do I actually stick to a weekly review habit?' },
      { role: 'assistant', content: '**Making weekly reviews stick:**\n\n1. **Calendar block it** - Sunday 6-6:30pm, recurring, treat like a meeting\n2. **Same location** - same chair, same music, signals your brain it\'s time\n3. **Reduce friction** - Pre-make a simple checklist in Obsidian you open every time\n4. **Minimum viable review** - On low-energy weeks, just the 3-priority question: "What are my 3 priorities this week?"\n5. **Accountability** - Tell someone, or post publicly that you\'re doing it\n\n**The real secret:** Lower your standards for what "counts" as a review. Five minutes of reflection beats zero. Don\'t let perfect be the enemy of consistent.' },
    ],
  },
  {
    id: 'conv-015',
    title: 'Docker and Container Fundamentals',
    created: '2025-08-10T14:00:00Z',
    updated: '2025-08-10T15:30:00Z',
    summary: 'Covered Docker fundamentals, multi-stage builds, docker-compose, and container networking.',
    messages: [
      { role: 'human', content: 'Explain Docker to me assuming I know Linux but have never used containers.' },
      { role: 'assistant', content: '**Docker = isolated process + filesystem snapshot**\n\nA container is like a lightweight VM that shares the host kernel but has its own isolated filesystem, network, and process space.\n\n**Key concepts:**\n- **Image:** A read-only template (Dockerfile bakes in your app + deps)\n- **Container:** A running instance of an image\n- **Registry:** Where images live (Docker Hub, ECR, GCR)\n\n**Basic workflow:**\n```dockerfile\n# Dockerfile\nFROM node:20-alpine\nWORKDIR /app\nCOPY package*.json ./\nRUN npm ci\nCOPY . .\nCMD ["node", "server.js"]\n```\n\n```bash\ndocker build -t myapp .\ndocker run -p 3000:3000 myapp\n```\n\n**Why it matters:** "Works on my machine" → "works everywhere." Deploy the same image to dev/staging/prod.' },
      { role: 'human', content: 'What\'s a multi-stage build and when should I use it?' },
      { role: 'assistant', content: '**Multi-stage builds** let you use one image to build and a smaller image to run:\n\n```dockerfile\n# Stage 1: Build\nFROM node:20 AS builder\nWORKDIR /app\nCOPY . .\nRUN npm ci && npm run build\n\n# Stage 2: Run (only copy compiled output)\nFROM node:20-alpine AS runner\nWORKDIR /app\nCOPY --from=builder /app/dist ./dist\nCOPY --from=builder /app/node_modules ./node_modules\nCMD ["node", "dist/server.js"]\n```\n\n**Result:** Builder image might be 1GB (with all dev tools). Runner image is 150MB.\n\n**Use when:**\n- You have a build step (TypeScript, Go, Rust, etc.)\n- You want small production images\n- Always for production workloads' },
    ],
  },
  {
    id: 'conv-016',
    title: 'API Design Best Practices',
    created: '2025-09-01T10:00:00Z',
    updated: '2025-09-01T11:30:00Z',
    summary: 'Covered REST API design patterns, versioning strategies, error formats, and authentication.',
    messages: [
      { role: 'human', content: 'I\'m designing a REST API for a new product. What are the most important design decisions to get right early?' },
      { role: 'assistant', content: '**Critical early decisions:**\n\n**1. Versioning strategy** (hardest to change later)\n- URL path: `/v1/users` (most common, easiest)\n- Header: `API-Version: 2024-01-01` (Stripe\'s approach)\n- Pick one and commit\n\n**2. Consistent error format:**\n```json\n{\n  "error": {\n    "code": "USER_NOT_FOUND",\n    "message": "No user with id 123",\n    "request_id": "req_abc123"\n  }\n}\n```\nAlways return the same shape. Include `request_id` from day 1.\n\n**3. Pagination:**\n- Cursor-based for large/realtime data (Twitter/Slack style)\n- Offset/limit for simple cases\n- Return `next_cursor` and `has_more` in every list response\n\n**4. Resource naming:** Plural nouns, no verbs:\n- `GET /users` not `GET /getUsers`\n- `POST /users` to create\n- `PATCH /users/123` for partial update\n\n**5. Auth:** JWT or API keys from day 1. Never none.' },
    ],
  },
  {
    id: 'conv-017',
    title: 'Networking and Building Relationships in Tech',
    created: '2025-10-30T19:00:00Z',
    updated: '2025-10-30T20:00:00Z',
    summary: 'Strategies for building genuine professional relationships in tech without feeling transactional.',
    messages: [
      { role: 'human', content: 'I want to grow my network in tech but networking feels fake and transactional to me. How do I do it in a way that feels genuine?' },
      { role: 'assistant', content: '**Reframe networking as "making friends who code"**\n\nThe transactional feeling comes from networking with an agenda. Shift to:\n\n**Give first:**\n- Share what you\'re learning publicly (Twitter/X, LinkedIn, blog)\n- Answer questions in communities (Discord, Reddit, Slack groups)\n- Introduce people who should know each other\n\n**Be interested, not interesting:**\n- Ask what someone is working on and actually listen\n- Follow up on things they mentioned weeks later\n- "How did that launch go?"\n\n**Context-based connections** (highest quality):\n- OSS contributions → you worked together, have a shared project\n- Conferences → you both attended a talk, natural conversation\n- Online communities → regular presence builds familiarity\n\n**Cold outreach that works:**\n"I read your post on X. I tried your approach and [specific result]. Quick question: [specific question]."' },
    ],
  },
  {
    id: 'conv-018',
    title: 'Vim and Terminal Productivity Setup',
    created: '2025-08-20T11:00:00Z',
    updated: '2025-08-20T12:30:00Z',
    summary: 'Terminal productivity setup with zsh, tmux, Neovim, and essential aliases for WSL2 development.',
    messages: [
      { role: 'human', content: 'How should I set up my terminal for maximum productivity on WSL2? I spend most of my time in the terminal.' },
      { role: 'assistant', content: '**WSL2 terminal stack:**\n\n**Shell: zsh + Oh My Zsh**\n```bash\nsudo apt install zsh\nsh -c "$(curl -fsSL https://raw.github.com/ohmyzsh/ohmyzsh/master/tools/install.sh)"\n```\nPlugins: `git zsh-autosuggestions zsh-syntax-highlighting`\n\n**Multiplexer: tmux**\n```bash\nsudo apt install tmux\n```\nKey bindings: `Ctrl+b c` new window, `Ctrl+b "` horizontal split, `Ctrl+b %` vertical\n\n**Editor: Neovim (if you want vim)**\n```bash\nsudo apt install neovim\n```\nOr just use VS Code with WSL extension (honestly great for most workflows)\n\n**Essential aliases in ~/.zshrc:**\n```bash\nalias ll="ls -la"\nalias gs="git status"\nalias gc="git commit"\nalias gp="git push"\nalias py="python3"\nalias dc="docker compose"\n```\n\n**Starship prompt** (beautiful, fast):\n```bash\ncurl -sS https://starship.rs/install.sh | sh\n```' },
    ],
  },
  {
    id: 'conv-019',
    title: 'Mental Models for Decision Making',
    created: '2025-11-20T20:00:00Z',
    updated: '2025-11-20T21:00:00Z',
    summary: 'Explored practical mental models: inversion, second-order thinking, opportunity cost, and Chesterton\'s fence.',
    messages: [
      { role: 'human', content: 'What are the most useful mental models for making better decisions as an engineer and generally in life?' },
      { role: 'assistant', content: '**Most useful mental models:**\n\n**Inversion** - Instead of "how do I succeed?", ask "how do I fail, and avoid that?"\nGreat for risk assessment and pre-mortems.\n\n**Second-order thinking** - "And then what?" For every consequence, think one level deeper. Useful for architectural decisions: "This abstraction makes it easier now, but what happens when we scale?"\n\n**Opportunity cost** - Every yes is a no to something else. When evaluating a project, ask "what am I NOT doing if I do this?"\n\n**Chesterton\'s Fence** - Don\'t remove something until you understand why it was put there. Before deleting code/process/feature, understand its original purpose.\n\n**Reversibility matrix** (Bezos):\n- Type 1: Irreversible, high stakes → slow down, get it right\n- Type 2: Reversible, low stakes → decide fast, iterate\n\n**Map vs territory** - Your model of the system is not the system. Regularly test assumptions against reality.' },
    ],
  },
  {
    id: 'conv-020',
    title: 'Claude Code and AI-Assisted Development Workflow',
    created: '2026-01-12T09:00:00Z',
    updated: '2026-01-12T11:00:00Z',
    summary: 'Explored using Claude Code for pair programming, code review, refactoring, and building the PKM system.',
    messages: [
      { role: 'human', content: 'How are you finding developers actually using Claude Code effectively in their daily workflow?' },
      { role: 'assistant', content: '**Most effective Claude Code workflows:**\n\n**1. Codebase exploration**\n"Find all the places where we handle auth tokens and explain the flow" - better than grepping manually.\n\n**2. Rubber duck + implementation**\nExplain your approach, get feedback, then have Claude write the scaffolding while you fill in domain logic.\n\n**3. Test generation**\n"Write tests for this function covering edge cases" - Claude is good at thinking of cases you\'d miss.\n\n**4. Refactoring with context**\nShare multiple related files, ask for refactor. Better than single-file tools because it sees the full picture.\n\n**5. Documentation**\n"Write a README for this project" after the code exists.\n\n**Less effective:**\n- Complex multi-step tasks without checkpoints\n- Tasks requiring external state/APIs Claude can\'t see\n- When you don\'t know enough to verify the output' },
      { role: 'human', content: 'What\'s your take on the "AI will replace programmers" narrative?' },
      { role: 'assistant', content: '**My honest take:**\n\nAI is replacing some programming tasks, not programmers. The tasks being automated are the most tedious parts: boilerplate, scaffolding, documentation, simple transformations.\n\nWhat\'s getting more valuable:\n- **Problem formulation** - Knowing what to build and why\n- **Judgment calls** - Architecture, tradeoffs, "is this the right abstraction?"\n- **Domain knowledge** - Understanding the business/user well enough to verify AI output\n- **System thinking** - How pieces fit together\n\nThe programmers most at risk are those who only do mechanical implementation. The ones who are growing are using AI as leverage to work at a higher level.\n\nIn 5 years, "programming" will look more like directing and reviewing than typing. That\'s probably good for the profession overall.' },
    ],
  },
];

async function main() {
  process.stderr.write('[seed] Starting conversation import...\n');
  process.stderr.write(`[seed] Importing ${conversations.length} conversations\n`);

  const results = await importBatch(conversations);

  const succeeded = results.filter(r => r.success).length;
  const failed = results.filter(r => !r.success).length;

  process.stderr.write(`\n[seed] Complete: ${succeeded} imported, ${failed} failed\n`);

  // Print summary to stdout for capture
  console.log(JSON.stringify({ succeeded, failed, results }, null, 2));
}

main().catch(err => {
  process.stderr.write(`[seed] Fatal: ${err}\n`);
  process.exit(1);
});
