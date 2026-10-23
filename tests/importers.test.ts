// Importers, reclassify and the link builder, run end to end against a temp vault and a temp
// Apple Notes export folder. No network: the API-facing parts are tested through their
// conversion functions only. Never touches the dev or prod vault.
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import matter from 'gray-matter';

const VAULT = fs.mkdtempSync(path.join(os.tmpdir(), 'importers-vault-'));
const EXPORT = fs.mkdtempSync(path.join(os.tmpdir(), 'apple-export-'));
process.env.VAULT_PATH = VAULT;
process.env.APPLE_NOTES_PATH = EXPORT;

import { importConversation, ConversationData } from '../src/importers/claude_importer';
import { convertConversation } from '../src/importers/claude_api_sync';
import { parseExport } from '../src/importers/claude_ai_export_parser';
import { blockToMarkdown, getPageTitle, extractProperties } from '../src/importers/notion_sync';
import { extractTitleAndId } from '../src/importers/notion_export_parser';
import { sync as appleSync, parseMeta } from '../src/importers/apple_notes_sync';
import { reclassify } from '../src/importers/reclassify';
import { buildLinks, detectSeries } from '../src/importers/link_builder';

let bad = 0;
const check = (name: string, ok: boolean) => { if (!ok) bad++; console.log(ok ? 'PASS' : 'FAIL', name); };
const read = (rel: string) => fs.readFileSync(path.join(VAULT, rel), 'utf8');
const exists = (rel: string) => fs.existsSync(path.join(VAULT, rel));
const write = (rel: string, s: string) => { fs.mkdirSync(path.dirname(path.join(VAULT, rel)), { recursive: true }); fs.writeFileSync(path.join(VAULT, rel), s); };
const clearSources = () => fs.rmSync(path.join(VAULT, 'Sources'), { recursive: true, force: true });

async function main() {
  // Keep the importers' progress output out of the test log
  const origLog = console.log;
  const origErr = process.stderr.write.bind(process.stderr);
  const quiet = () => { console.log = () => {}; (process.stderr as any).write = () => true; };
  const loud = () => { console.log = origLog; (process.stderr as any).write = origErr; };

  // ─── Claude.ai conversations ────────────────────────────────────────
  const raw = {
    uuid: 'abcdef12-0000', name: '', summary: ' s ', created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-02T00:00:00Z',
    chat_messages: [
      { uuid: '1', text: 'ignored', content: [{ type: 'text', text: 'hello' }, { type: 'tool_use' }], sender: 'human', created_at: 't1', updated_at: '', attachments: [], files: [] },
      { uuid: '2', text: '', content: [], sender: 'assistant', created_at: 't2', updated_at: '', attachments: [], files: [] },
      { uuid: '3', text: 'fallback text', content: [], sender: 'assistant', created_at: 't3', updated_at: '', attachments: [], files: [] },
    ],
  } as any;
  const conv = convertConversation(raw)!;
  check('claude convert: text blocks preferred over the text field; non-text blocks dropped', conv.messages[0].content === 'hello');
  check('claude convert: empty messages dropped; text field used when no blocks', conv.messages.length === 2 && conv.messages[1].content === 'fallback text');
  check('claude convert: untitled conversation named "Conversation <first 8 of id>"', conv.title === 'Conversation abcdef12');
  check('claude convert: conversation with no text returns null', convertConversation({ ...raw, chat_messages: [raw.chat_messages[1]] }) === null);

  const exportFile = path.join(EXPORT, '..', `conv-${Date.now()}.json`);
  fs.writeFileSync(exportFile, JSON.stringify([raw, { ...raw, uuid: 'empty', chat_messages: [] }]));
  check('bulk export parser: keeps conversations with messages only', parseExport(exportFile).length === 1);
  fs.unlinkSync(exportFile);

  const c: ConversationData = {
    id: 'conv-1', title: 'Plan: the MCP server?', created: '2026-01-01T00:00:00Z', summary: 'A summary',
    project: 'My Project', messages: [{ role: 'human', content: 'about obsidian', timestamp: 't' }, { role: 'assistant', content: 'reply' }],
  };
  const r1 = await importConversation(c);
  const file1 = read(r1.relative_path);
  check('claude import: file in Sources/Claude-Conversations named from the sanitized title', r1.relative_path === 'Sources/Claude-Conversations/Plan the MCP server.md');
  check('claude import: frontmatter has source, source_id, project, status imported, counts',
    file1.includes('source: "claude-conversations"') && file1.includes('source_id: "conv-1"') && file1.includes('project: "My Project"') &&
    file1.includes('status: "imported"') && file1.includes('message_count: 2'));
  check('claude import: claude-conversation tag plus auto and topic tags', file1.includes('"claude-conversation"') && file1.includes('"pkm"') && file1.includes('"obsidian"'));
  check('claude import: summary section, then messages labelled You / Claude split by ---',
    file1.includes('## Summary\n\nA summary') && file1.includes('**You** _(t)_\n\nabout obsidian\n\n---\n\n**Claude**\n\nreply'));
  const r2 = await importConversation({ ...c, title: 'Renamed' });
  check('claude import: same source_id is skipped, even under a new title', r2.skipped === true && !exists('Sources/Claude-Conversations/Renamed.md'));
  const r3 = await importConversation({ ...c, summary: 'New summary' }, 'overwrite');
  check('claude import: overwrite mode rewrites the file', !r3.skipped && read(r3.relative_path).includes('New summary'));

  // ─── Notion conversion ──────────────────────────────────────────────
  const rt = (t: string, a: any = {}, href: string | null = null) => ({ type: 'text', plain_text: t, annotations: a, href });
  const b = (type: string, data: any) => ({ id: 'b', type, has_children: false, [type]: data }) as any;
  check('notion: bold, italic, code, strike and links become markdown',
    blockToMarkdown(b('paragraph', { rich_text: [rt('x', { bold: true }), rt('y', { italic: true }), rt('z', { code: true }), rt('s', { strikethrough: true }), rt('l', {}, 'http://u')] })) === '**x***y*`z`~~s~~[l](http://u)');
  check('notion: headings, bullets, numbers, quotes, divider',
    blockToMarkdown(b('heading_2', { rich_text: [rt('H')] })) === '## H' &&
    blockToMarkdown(b('bulleted_list_item', { rich_text: [rt('i')] }), 1) === '  - i' &&
    blockToMarkdown(b('numbered_list_item', { rich_text: [rt('n')] })) === '1. n' &&
    blockToMarkdown(b('quote', { rich_text: [rt('q')] })) === '> q' &&
    blockToMarkdown(b('divider', {})) === '---');
  check('notion: to-do checkboxes keep their state', blockToMarkdown(b('to_do', { checked: true, rich_text: [rt('done')] })) === '- [x] done');
  check('notion: code block keeps its language', blockToMarkdown(b('code', { language: 'ts', rich_text: [rt('a=1')] })) === '```ts\na=1\n```');
  check('notion: image uses its file or external url', blockToMarkdown(b('image', { type: 'external', external: { url: 'http://i' }, caption: [rt('c')] })) === '![c](http://i)');
  check('notion: layout blocks are dropped, unknown blocks leave a comment',
    blockToMarkdown(b('column_list', {})) === '' && blockToMarkdown(b('weird', {})) === '<!-- unsupported block type: weird -->');
  const page = { id: '12345678-aaaa', properties: { Name: { type: 'title', title: [] }, Tags: { type: 'multi_select', multi_select: [{ name: 'a' }, { name: 'b' }] }, Stage: { type: 'status', status: { name: 'Doing' } } } } as any;
  check('notion: page with an empty title is named "Notion <first 8 of id>"', getPageTitle(page) === 'Notion 12345678');
  const props = extractProperties(page);
  check('notion: database properties become lowercased text fields', props.tags === 'a, b' && props.stage === 'Doing');
  check('notion export: trailing Notion id split from the file name',
    JSON.stringify(extractTitleAndId('My Page 0123456789abcdef0123456789abcdef.md')) === JSON.stringify({ title: 'My Page', notionId: '0123456789abcdef0123456789abcdef' }));

  // ─── Apple Notes export → vault ─────────────────────────────────────
  const note = (title: string, extra: string, body: string) => `${title}\ncreated: Aug 9, 2023 at 1:08 PM\nfolder: Home Stuff\n${extra}---\n${body}`;
  fs.writeFileSync(path.join(EXPORT, 'normal.md'), note('Shopping list', 'tags: #errands, groceries\n', '# Shopping list\nbuy milk and eggs today'));
  fs.writeFileSync(path.join(EXPORT, 'secret1.md'), note('Secret one', 'tags: #Confidential\n', 'private body'));
  fs.writeFileSync(path.join(EXPORT, 'secret2.md'), note('Secret two', '', '#confidential\nprivate body'));
  fs.writeFileSync(path.join(EXPORT, 'listed.md'), note('Skipped note', '', 'body'));
  write('Sources/.sync_skiplist.json', JSON.stringify({ claude_ai: [], notion: [], apple_notes: ['Skipped note'] }));

  const pm = parseMeta(fs.readFileSync(path.join(EXPORT, 'normal.md'), 'utf8'), path.join(EXPORT, 'normal.md'));
  check('apple: first line is the title; Apple dates become ISO', pm.meta.title === 'Shopping list' && /^2023-08-09T/.test(pm.meta.created));

  quiet(); await appleSync({ dryRun: true, full: false }); loud();
  check('apple: dry run writes nothing to the vault', !exists('Sources/Apple-Notes/Shopping list.md'));
  quiet(); await appleSync({ dryRun: false, full: false }); loud();
  const apple = exists('Sources/Apple-Notes/Shopping list.md') ? read('Sources/Apple-Notes/Shopping list.md') : '';
  check('apple: note written with apple-notes, its own tags and a folder/ tag',
    apple.includes('"apple-notes"') && apple.includes('"errands"') && apple.includes('"groceries"') && apple.includes('"folder/home-stuff"') && apple.includes('apple_folder: "Home Stuff"'));
  check('apple: leading "# Title" in the body is not doubled', apple.split('# Shopping list').length === 2);
  check('apple: #confidential (tag or body line) never reaches the vault',
    !exists('Sources/Apple-Notes/Secret one.md') && !exists('Sources/Apple-Notes/Secret two.md'));
  check('apple: #confidential export files are deleted', !fs.existsSync(path.join(EXPORT, 'secret1.md')) && !fs.existsSync(path.join(EXPORT, 'secret2.md')));
  check('apple: skiplisted title is not imported', !exists('Sources/Apple-Notes/Skipped note.md'));
  fs.writeFileSync(path.join(VAULT, 'Sources/Apple-Notes/Shopping list.md'), 'MARKER');
  quiet(); await appleSync({ dryRun: false, full: false }); loud();
  check('apple: unchanged export (same content hash) is skipped', read('Sources/Apple-Notes/Shopping list.md') === 'MARKER');
  fs.appendFileSync(path.join(EXPORT, 'normal.md'), '\nand bread');
  quiet(); await appleSync({ dryRun: false, full: false }); loud();
  check('apple: changed export overwrites the vault copy', read('Sources/Apple-Notes/Shopping list.md').includes('and bread'));

  // ─── Reclassify ─────────────────────────────────────────────────────
  clearSources();
  write('Sources/Notion/a.md', '---\ntitle: Resume rewrite\nsource: notion\nstatus: imported\njpmc: work-example\ntags:\n  - notion\n  - folder/work\n  - randomtag\n  - domain/freight\n---\nbody text\n');
  write('Sources/Notion/b.md', '---\ntitle: No source\ntags:\n  - keepme\n---\nbody\n');
  const bBefore = read('Sources/Notion/b.md');
  quiet(); await reclassify({ dryRun: true }); loud();
  check('reclassify: dry run writes nothing', read('Sources/Notion/a.md').includes('randomtag'));
  quiet(); await reclassify({ dryRun: false }); loud();
  const a = matter(read('Sources/Notion/a.md')).data;
  check('reclassify: source tags and folder/ tags kept; other tags replaced by the taxonomy',
    a.tags.includes('notion') && a.tags.includes('folder/work') && !a.tags.includes('randomtag') && !a.tags.includes('domain/freight') && a.tags.includes('domain/career'));
  check('reclassify: status imported becomes seed, with a status/ tag', a.status === 'seed' && a.tags.includes('status/seed'));
  check('reclassify: other frontmatter keys (e.g. the jpmc label) kept; reclassified stamp added', a.jpmc === 'work-example' && !!a.reclassified);
  check('reclassify: note with no source is left untouched', read('Sources/Notion/b.md') === bBefore);
  const aAfter = read('Sources/Notion/a.md');
  quiet(); await reclassify({ dryRun: false }); loud();
  check('reclassify: second run changes nothing', read('Sources/Notion/a.md') === aAfter);

  // ─── Link builder ───────────────────────────────────────────────────
  clearSources();
  const kw = 'compost bins worm castings garden soil microbes nitrogen carbon ratio moisture';
  const n = (title: string, body: string) => `---\ntitle: ${title}\nsource: notion\nword_count: 50\ntags:\n  - domain/ventures\n---\n${body}\n`;
  write('Sources/Notion/Compost Notes 1.md', n('Compost Notes 1', kw));
  write('Sources/Notion/Compost Notes 2.md', n('Compost Notes 2', kw));
  write('Sources/Notion/Garden plan.md', n('Garden plan', kw));
  write('Sources/Notion/Unrelated.md', '---\ntitle: Unrelated\nsource: notion\nword_count: 50\n---\nquantum chromodynamics lattice gauge theory hadrons quarks gluons\n');
  write('Sources/Notion/untitled.md', '---\nsource: notion\n---\n' + kw);
  check('links: numbered titles form a series in number order',
    JSON.stringify([...detectSeries([{ title: 'X Part 2' }, { title: 'X Part 1' }, { title: 'Y' }] as any).values()]) === JSON.stringify([[1, 0]]));
  quiet(); await buildLinks({ dryRun: true }); loud();
  check('links: dry run writes nothing', !read('Sources/Notion/Garden plan.md').includes('## Related'));
  quiet(); await buildLinks({ dryRun: false }); loud();
  const g = read('Sources/Notion/Garden plan.md');
  const s1 = read('Sources/Notion/Compost Notes 1.md');
  check('links: similar notes get a Related section of wikilinks', g.includes('## Related') && g.includes('[[Compost Notes 1]]') && g.includes('[[Compost Notes 2]]'));
  check('links: series members get Next/Previous and are not repeated in the list',
    s1.includes('- Next: [[Compost Notes 2]]') && s1.split('[[Compost Notes 2]]').length === 2);
  check('links: notes below the similarity floor get no links', !read('Sources/Notion/Unrelated.md').includes('## Related'));
  check('links: notes with no title in frontmatter are not indexed or linked', !g.includes('untitled') && !read('Sources/Notion/untitled.md').includes('## Related'));
  quiet(); await buildLinks({ dryRun: false }); loud();
  check('links: rerun replaces the Related section instead of adding a second one', read('Sources/Notion/Garden plan.md').split('## Related').length === 2);

  fs.rmSync(VAULT, { recursive: true });
  fs.rmSync(EXPORT, { recursive: true });
  process.exit(bad ? 1 : 0);
}

main().catch(err => { console.log('FAIL crashed:', err); process.exit(1); });
