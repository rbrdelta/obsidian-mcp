// Tagging, taxonomy, frontmatter, markdown helpers and the skiplist.
// Runs against a temp vault; never touches the dev or prod vault.
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const VAULT = fs.mkdtempSync(path.join(os.tmpdir(), 'taxonomy-vault-'));
process.env.VAULT_PATH = VAULT;

import { buildFrontmatter, autoTag, classifyNote, slugify } from '../src/utils/metadata';
import { extractExcerpt, extractWikiLinks, addWikiLink } from '../src/utils/markdown';
import { sanitizeFilename } from '../src/utils/vault_ops';
import { loadSkiplist, isSkipped } from '../src/importers/skiplist';

let bad = 0;
const check = (name: string, ok: boolean) => { if (!ok) bad++; console.log(ok ? 'PASS' : 'FAIL', name); };

// --- Frontmatter ---
const fm = buildFrontmatter({ title: 'A "quoted" title', tags: ['x', 'y'], empty: [], none: undefined, n: 3 });
check('frontmatter: strings are JSON-quoted', fm.includes('title: "A \\"quoted\\" title"'));
check('frontmatter: arrays become YAML lists', fm.includes('tags:\n  - "x"\n  - "y"'));
check('frontmatter: empty arrays and undefined are left out', !fm.includes('empty') && !fm.includes('none'));
check('frontmatter: numbers unquoted', fm.includes('n: 3'));

// --- Auto-tag (create_note and importers) ---
check('autoTag: keyword in content adds its tag', autoTag('notes in obsidian', 'x').includes('pkm'));
check('autoTag: short keywords match whole words only ("ai" not in "said")', !autoTag('she said hello', 'x').includes('ai'));
check('autoTag: short keyword as a word matches', autoTag('using ai daily', 'x').includes('ai'));
check('autoTag: no match gives no tags', autoTag('zzz qqq', 'zzz').length === 0);

// --- Two-axis taxonomy (reclassify) ---
const short = classifyNote('nothing relevant here', 'Resume tips', 'notion');
check('classify: a title keyword alone qualifies a short note', short.domains.includes('domain/career'));
const longBody = Array(600).fill('word').join(' ') + ' resume';
check('classify: notes over 500 words need 2+ points for a domain', !classifyNote(longBody, 'Untitled', 'notion').domains.includes('domain/career'));
check('classify: a title hit counts 3 points', classifyNote(longBody, 'Resume', 'notion').domains.includes('domain/career'));
const many = classifyNote('job python claude freight budget furniture parenting course obsidian startup', 'x', 'notion');
check('classify: at most 3 domains', many.domains.length === 3);
check('classify: claude conversation with no mode keyword defaults to mode/thinking', classifyNote('zzz', 'zzz', 'claude-conversations').modes[0] === 'mode/thinking');
check('classify: apple note defaults to mode/doing', classifyNote('zzz', 'zzz', 'apple-notes').modes[0] === 'mode/doing');
check('classify: other sources default to mode/reference', classifyNote('zzz', 'zzz', 'phone-notes').modes[0] === 'mode/reference');
check('classify: at most 2 modes', classifyNote('what if todo how to lesson learned', 'x', 'notion').modes.length === 2);
check('classify: status imported maps to status/seed', classifyNote('x', 'x', 'notion', 'imported').lifecycle === 'status/seed');
check('classify: status active/evergreen/archived kept',
  classifyNote('x', 'x', 'notion', 'active').lifecycle === 'status/active' &&
  classifyNote('x', 'x', 'notion', 'evergreen').lifecycle === 'status/evergreen' &&
  classifyNote('x', 'x', 'notion', 'archived').lifecycle === 'status/archived');

// --- File names ---
check('sanitizeFilename: strips characters Windows forbids', sanitizeFilename('a<b>c:d"e/f\\g|h?i*j') === 'abcdefghij');
check('sanitizeFilename: collapses whitespace and caps at 200', sanitizeFilename('a   b') === 'a b' && sanitizeFilename('x'.repeat(300)).length === 200);
check('slugify: lowercase, hyphens', slugify('Hello, World 2') === 'hello-world-2');

// --- Markdown helpers ---
check('wikilinks: alias and heading are stripped, duplicates removed',
  JSON.stringify(extractWikiLinks('[[A]] [[B|alias]] [[C#Head]] [[A]]')) === JSON.stringify(['A', 'B', 'C']));
check('addWikiLink: appends a Related section', addWikiLink('body', 'T') === 'body\n\n## Related\n- [[T]]\n');
check('addWikiLink: existing link not added twice', addWikiLink('see [[T]]', 'T') === 'see [[T]]');
check('addWikiLink: adds under an existing Related heading', addWikiLink('x\n## Related\n- [[A]]', 'T').includes('## Related\n- [[T]]\n- [[A]]'));
check('addWikiLink: alias form', addWikiLink('x', 'T', 'shown').includes('[[T|shown]]'));
const ex = extractExcerpt('a'.repeat(300) + 'NEEDLE' + 'b'.repeat(300), 'needle');
check('excerpt: centred on the match, case-insensitive, with ... both sides', ex.startsWith('...') && ex.endsWith('...') && ex.includes('NEEDLE'));
check('excerpt: no match gives the opening 200 characters', extractExcerpt('x'.repeat(500), 'zzz') === 'x'.repeat(200) + '...');

// --- Skiplist ---
check('skiplist: missing file means nothing skipped', loadSkiplist().claude_ai.length === 0);
fs.mkdirSync(path.join(VAULT, 'Sources'), { recursive: true });
fs.writeFileSync(path.join(VAULT, 'Sources/.sync_skiplist.json'), JSON.stringify({ claude_ai: ['u1'], notion: [], apple_notes: [] }));
const sl = loadSkiplist();
check('skiplist: listed id is skipped, others are not', isSkipped(sl, 'claude_ai', 'u1') && !isSkipped(sl, 'claude_ai', 'u2'));

fs.rmSync(VAULT, { recursive: true });
process.exit(bad ? 1 : 0);
