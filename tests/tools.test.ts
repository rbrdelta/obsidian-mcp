// The MCP tools and the server's tool dispatch, against a temp vault. The server is started
// over stdio the way Claude Code starts it. Never touches the dev or prod vault.
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const VAULT = fs.mkdtempSync(path.join(os.tmpdir(), 'tools-vault-'));
process.env.VAULT_PATH = VAULT;
delete process.env.ANTHROPIC_API_KEY; // the heuristic path only; no API calls from tests

import { createNote } from '../src/tools/create_note';
import { readNote } from '../src/tools/read_note';
import { searchNotes } from '../src/tools/search_notes';
import { linkNotes } from '../src/tools/link_notes';
import { getBacklinks } from '../src/tools/get_backlinks';
import { processDailyNote } from '../src/tools/process_daily_note';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

let bad = 0;
const check = (name: string, ok: boolean) => { if (!ok) bad++; console.log(ok ? 'PASS' : 'FAIL', name); };
const write = (rel: string, s: string) => { fs.mkdirSync(path.dirname(path.join(VAULT, rel)), { recursive: true }); fs.writeFileSync(path.join(VAULT, rel), s); };
const read = (rel: string) => fs.readFileSync(path.join(VAULT, rel), 'utf8');
const throws = async (fn: () => Promise<unknown>, msg: string) => { try { await fn(); return false; } catch (e) { return String(e).includes(msg); } };

async function main() {
  // ─── create_note ────────────────────────────────────────────────────
  const c1 = await createNote({ title: 'Plan: Q4?', content: 'thinking about obsidian', tags: ['mine'], source_id: 'x1', related: ['Other'] });
  const t1 = read(c1.relative_path);
  check('create_note: default folder Inbox, title sanitized into the file name', c1.relative_path === 'Inbox/Plan Q4.md');
  check('create_note: given tags merged with auto-tags', c1.tags_applied.includes('mine') && c1.tags_applied.includes('pkm'));
  check('create_note: defaults source manual and status active; source_id and related written',
    t1.includes('source: "manual"') && t1.includes('status: "active"') && t1.includes('source_id: "x1"') && t1.includes('related:\n  - "Other"'));
  check('create_note: body starts with "# <title>"', t1.includes('---\n\n# Plan: Q4?\n\nthinking about obsidian'));
  const c2 = await createNote({ title: 'Conv', content: 'x', folder: 'conversations' });
  check('create_note: folder keys map to configured folders', c2.relative_path === 'Sources/Claude-Conversations/Conv.md');
  const c3 = await createNote({ title: 'Free', content: 'x', folder: 'Projects/New' });
  check('create_note: an unknown folder is used as a path', c3.relative_path === 'Projects/New/Free.md');
  const c4 = await createNote({ title: 'Plan: Q4?', content: 'replaced' });
  check('create_note: same title overwrites the existing file', c4.relative_path === c1.relative_path && read(c1.relative_path).includes('replaced'));

  // ─── read_note ──────────────────────────────────────────────────────
  write('Deep/Folder/Case Note.md', '---\ntitle: Case Note\ntags:\n  - t\ncreated: "2026-01-01"\nupdated: "2026-02-01"\n---\none two three\n');
  const rn = await readNote({ title: 'case note' });
  check('read_note: title lookup searches the whole vault, case-insensitive fallback', rn.relative_path === 'Deep/Folder/Case Note.md');
  check('read_note: returns frontmatter, tags, created/updated and a word count', rn.tags[0] === 't' && rn.created === '2026-01-01' && rn.modified === '2026-02-01' && rn.word_count === 3);
  check('read_note: missing path is an error', await throws(() => readNote({ path: 'nope.md' }), 'Note not found'));
  check('read_note: neither path nor title is an error', await throws(() => readNote({}), 'Either path or title'));

  // ─── search_notes ───────────────────────────────────────────────────
  write('Sources/A/zebra title.md', '---\ntitle: Zebra title\ncreated: "2026-03-01"\ntags:\n  - animals\n---\nnothing\n');
  write('Sources/A/many.md', '---\ntitle: Many\ncreated: "2026-01-01"\n---\nzebra zebra zebra zebra\n');
  write('Other/zebra.md', '---\ntitle: Other\ncreated: "2025-01-01"\n---\nzebra\n');
  const s = await searchNotes({ query: 'ZEBRA' });
  check('search: case-insensitive; a title match (+10) outranks body repeats', s.results[0].title === 'Zebra title' && s.total === 3);
  check('search: folder filter', (await searchNotes({ query: 'zebra', folder: 'Sources' })).total === 2);
  check('search: tag filter keeps notes with any listed tag', (await searchNotes({ query: 'zebra', tags: ['animals'] })).total === 1);
  check('search: date range filters on frontmatter created',
    (await searchNotes({ query: 'zebra', date_from: '2026-02-01' })).total === 1 && (await searchNotes({ query: 'zebra', date_to: '2025-06-01' })).total === 1);
  const lim = await searchNotes({ query: 'zebra', limit: 1 });
  check('search: limit cuts results but total counts every match', lim.results.length === 1 && lim.total === 3);

  // ─── link_notes / get_backlinks ─────────────────────────────────────
  write('Inbox/L1.md', 'one');
  write('Inbox/L2.md', 'two');
  const l = await linkNotes({ links: [{ source: 'L1', target: 'L2', alias: 'second' }, { source: 'Missing', target: 'L2' }], bidirectional: false });
  check('link_notes: alias link added; missing note reported as failed', l.created === 1 && l.failed === 1 && read('Inbox/L1.md').includes('[[L2|second]]'));
  check('link_notes: bidirectional false leaves the target alone', !read('Inbox/L2.md').includes('[['));
  write('Inbox/B1.md', 'see [[hub|the hub]]');
  write('Sources/X/B2.md', 'see [[Hub#Section]]');
  const bl = await getBacklinks({ note_title: 'Hub.md' });
  check('get_backlinks: alias and heading links count, name match ignores case and .md', bl.total === 2);
  check('get_backlinks: grouped by folder', !!bl.by_folder['Inbox'] && !!bl.by_folder['Sources/X']);

  // ─── process_daily_note (writes) ────────────────────────────────────
  write('2026-05-05.md', [
    '## morning walk', 'Walked the dog around the lake and planned the garden beds for spring planting.', '',
    '## tiny', 'ok', '',
    '## case note', 'This section shares a name with an existing note so it should be skipped as a duplicate.',
  ].join('\n'));
  const dn = await processDailyNote({ date: '2026-05-05', auto_link: false });
  check('daily note: section becomes an Inbox note with a title-cased name and source daily-note/<date>',
    dn.notes_created.length === 1 && read('Inbox/Morning Walk.md').includes('source: "daily-note/2026-05-05"'));
  check('daily note: sections under 10 words skipped as too short', dn.notes_skipped.some(x => x.reason === 'too_short'));
  check('daily note: a title that already exists in the vault is skipped', dn.notes_skipped.some(x => x.reason === 'duplicate_title'));
  const idx = read('2026-05-05.md');
  check('daily note: rewritten as an index of links with the original kept in a details block',
    idx.includes('## Notes created\n- [[Morning Walk]]') && idx.includes('<details>') && idx.includes('Walked the dog'));
  write('2026-05-06.md', 'First block has more than ten words in it for sure yes indeed.\n---\nSecond block also has more than ten words in it for sure yes.');
  const hr = await processDailyNote({ date: '2026-05-06', dry_run: true, auto_link: false });
  check('daily note: with no ## headings, splits on --- instead', hr.proposed!.length === 2);
  check('daily note: missing daily note is an error', await throws(() => processDailyNote({ date: '1999-01-01' }), 'Daily note not found'));

  // ─── Server over stdio ──────────────────────────────────────────────
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ['-r', 'ts-node/register', path.join(__dirname, '../src/server.ts')],
    env: { ...process.env, VAULT_PATH: VAULT } as Record<string, string>,
    stderr: 'ignore',
  });
  const client = new Client({ name: 'test', version: '0' });
  await client.connect(transport);
  const tools = (await client.listTools()).tools.map(t => t.name).sort();
  check('server: lists the 7 tools', JSON.stringify(tools) === JSON.stringify(['create_note', 'get_backlinks', 'link_notes', 'process_daily_note', 'read_note', 'screenshot', 'search_notes']));
  const res: any = await client.callTool({ name: 'read_note', arguments: { title: 'Case Note' } });
  check('server: a tool call returns the result as JSON text', JSON.parse(res.content[0].text).relative_path === 'Deep/Folder/Case Note.md');
  let err = '';
  try { await client.callTool({ name: 'read_note', arguments: { path: 'nope.md' } }); } catch (e) { err = String(e); }
  check('server: a tool failure comes back as an error naming the cause', err.includes('Tool error: Note not found'));
  err = '';
  try { await client.callTool({ name: 'no_such_tool', arguments: {} }); } catch (e) { err = String(e); }
  check('server: unknown tool is refused', err.includes('Unknown tool'));
  await client.close();

  fs.rmSync(VAULT, { recursive: true });
  process.exit(bad ? 1 : 0);
}

main().catch(err => { console.log('FAIL crashed:', err); process.exit(1); });
