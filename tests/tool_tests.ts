/**
 * Automated tests for all 4 MCP tools + vault validation
 * Test artifacts are cleaned up after each run.
 */

import * as fs from 'fs';
import * as path from 'path';

// Set VAULT_PATH before importing modules that use it
process.env.VAULT_PATH = process.env.VAULT_PATH || '/mnt/c/MCP';

import { createNote } from '../src/tools/create_note';
import { readNote } from '../src/tools/read_note';
import { searchNotes } from '../src/tools/search_notes';
import { linkNotes } from '../src/tools/link_notes';
import { getBacklinks } from '../src/tools/get_backlinks';
import { processDailyNote } from '../src/tools/process_daily_note';
import { getAllNotes, resolvePath } from '../src/utils/vault_ops';

const VAULT_PATH = process.env.VAULT_PATH!;

interface TestResult {
  name: string;
  passed: boolean;
  message: string;
  duration_ms: number;
}

const results: TestResult[] = [];
const testFiles: string[] = []; // track files to clean up

async function test(name: string, fn: () => Promise<void>): Promise<void> {
  const start = Date.now();
  try {
    await fn();
    results.push({ name, passed: true, message: 'OK', duration_ms: Date.now() - start });
    process.stdout.write(`  ✓ ${name}\n`);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    results.push({ name, passed: false, message: msg, duration_ms: Date.now() - start });
    process.stdout.write(`  ✗ ${name}: ${msg}\n`);
  }
}

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

function trackFile(filePath: string): void {
  testFiles.push(filePath);
}

function cleanup(): void {
  for (const f of testFiles) {
    try {
      if (fs.existsSync(f)) fs.unlinkSync(f);
    } catch {
      // best-effort cleanup
    }
  }
}

async function runTests(): Promise<void> {
  process.stdout.write('\n=== Obsidian MCP Test Suite ===\n\n');

  // ─── Test 1: Vault structure ───────────────────────────────────────
  await test('Vault structure matches spec', async () => {
    const required = [
      'Inbox',
      'Sources/Claude-Conversations',
      'Templates',
      'Attachments',
      'Meta',
    ];
    for (const folder of required) {
      const full = path.join(VAULT_PATH, folder);
      assert(fs.existsSync(full), `Missing folder: ${folder}`);
    }
  });

  // ─── Test 2: create_note ───────────────────────────────────────────
  await test('create_note: creates note with frontmatter', async () => {
    const result = await createNote({
      title: 'Test Note Alpha',
      content: 'This is a test note about Python programming and career development.',
      tags: ['test'],
      folder: 'inbox',
    });
    assert(result.success, 'create_note returned success=false');
    trackFile(result.file_path);
    assert(fs.existsSync(result.file_path), `File not found: ${result.file_path}`);
    const content = fs.readFileSync(result.file_path, 'utf8');
    assert(content.includes('---'), 'Missing YAML frontmatter markers');
    assert(content.includes('title:'), 'Missing title in frontmatter');
    assert(content.includes('created:'), 'Missing created in frontmatter');
    assert(content.includes('tags:'), 'Missing tags in frontmatter');
  });

  // ─── Test 3: create_note auto-tagging ─────────────────────────────
  await test('create_note: auto-tags based on content', async () => {
    const result = await createNote({
      title: 'Test Auto Tag',
      content: 'I want to start a saas startup and use Claude AI for my obsidian knowledge base.',
      folder: 'inbox',
    });
    assert(result.success, 'create_note failed');
    trackFile(result.file_path);
    assert(result.tags_applied.length > 0, 'No auto-tags generated');
    assert(result.tags_applied.includes('pkm') || result.tags_applied.includes('ai'), 'Expected pkm or ai tag');
  });

  // ─── Test 3b: read_note by path ────────────────────────────────────
  await test('read_note: reads note by path', async () => {
    const created = await createNote({
      title: 'Read Test Note',
      content: 'Content for read testing with some words.',
      tags: ['test'],
      folder: 'inbox',
    });
    trackFile(created.file_path);
    const result = await readNote({ path: created.relative_path });
    assert(result.title === 'Read Test Note', `Wrong title: ${result.title}`);
    assert(result.content.includes('Content for read testing'), 'Content not returned');
    assert(result.tags.includes('test'), 'Tags not returned');
    assert(result.word_count > 0, 'Word count missing');
  });

  // ─── Test 3c: read_note by title ───────────────────────────────────
  await test('read_note: reads note by title', async () => {
    const result = await readNote({ title: 'Read Test Note' });
    assert(result.title === 'Read Test Note', `Wrong title: ${result.title}`);
    assert(result.content.includes('Content for read testing'), 'Content not returned by title lookup');
  });

  // ─── Test 4: search_notes ─────────────────────────────────────────
  await test('search_notes: finds imported conversations', async () => {
    const result = await searchNotes({ query: 'obsidian', limit: 5 });
    assert(result.results.length > 0, 'No results found for "obsidian"');
    assert(result.results[0].title !== '', 'First result has no title');
    assert(result.results[0].excerpt !== '', 'First result has no excerpt');
  });

  // ─── Test 5: search_notes with tag filter ─────────────────────────
  await test('search_notes: tag filter works', async () => {
    const result = await searchNotes({ query: 'knowledge', tags: ['pkm'] });
    for (const r of result.results) {
      assert(r.tags.includes('pkm'), `Result "${r.title}" missing pkm tag`);
    }
  });

  // ─── Test 6: link_notes ───────────────────────────────────────────
  await test('link_notes: creates bidirectional links', async () => {
    const noteA = await createNote({
      title: 'Link Test Source',
      content: 'Source note for link testing.',
      folder: 'inbox',
    });
    const noteB = await createNote({
      title: 'Link Test Target',
      content: 'Target note for link testing.',
      folder: 'inbox',
    });
    assert(noteA.success && noteB.success, 'Failed to create test notes');
    trackFile(noteA.file_path);
    trackFile(noteB.file_path);

    const result = await linkNotes({
      links: [{ source: noteA.relative_path, target: noteB.relative_path }],
      bidirectional: true,
    });

    assert(result.created > 0, 'No links created');
    const sourceContent = fs.readFileSync(noteA.file_path, 'utf8');
    assert(sourceContent.includes('[[Link Test Target]]'), 'Forward link not found in source');
    const targetContent = fs.readFileSync(noteB.file_path, 'utf8');
    assert(targetContent.includes('[[Link Test Source]]'), 'Back link not found in target');
  });

  // ─── Test 7: get_backlinks ────────────────────────────────────────
  await test('get_backlinks: returns correct results', async () => {
    const hub = await createNote({ title: 'Hub Note', content: 'Central hub.', folder: 'inbox' });
    const s1 = await createNote({ title: 'Spoke One', content: 'Links to [[Hub Note]] here.', folder: 'inbox' });
    const s2 = await createNote({ title: 'Spoke Two', content: 'Also links to [[Hub Note]].', folder: 'inbox' });
    trackFile(hub.file_path);
    trackFile(s1.file_path);
    trackFile(s2.file_path);

    const result = await getBacklinks({ note_title: 'Hub Note' });
    assert(result.total >= 2, `Expected >=2 backlinks, got ${result.total}`);
    assert(Object.keys(result.by_folder).length > 0, 'by_folder is empty');
  });

  // ─── Test 8: process_daily_note dry run ─────────────────────────
  await test('process_daily_note: dry run splits sections and deduplicates', async () => {
    // Create a test daily note with voice-to-text duplication
    const testDate = '9999-01-01';
    const testNotePath = resolvePath(`${testDate}.md`);
    const fs = require('fs');
    fs.writeFileSync(testNotePath, `
## First Section
This is a meaningful section with enough words to pass the minimum threshold for note creation.

## Second Section
This is a repeated voice-to-text paragraph about testing the deduplication feature in the daily note processor tool.

This is a repeated voice-to-text paragraph about testing the deduplication feature in the daily note processor tool.

## Short
ok
`);
    trackFile(testNotePath);

    const result = await processDailyNote({ date: testDate, dry_run: true });
    assert(result.dry_run === true, 'Should be dry run');
    assert(result.proposed!.length >= 2, `Expected >=2 proposed, got ${result.proposed!.length}`);
    assert(result.notes_created.length === 0, 'Dry run should not create notes');
    assert(result.daily_note_updated === false, 'Dry run should not update daily note');

    // Check dedup: second section should have only one copy of the repeated paragraph
    const secondSection = result.proposed!.find(p => p.title.includes('Second'));
    if (secondSection) {
      const occurrences = secondSection.content.split('repeated voice-to-text paragraph').length - 1;
      assert(occurrences === 1, `Expected 1 occurrence after dedup, got ${occurrences}`);
    }
  });

  // ─── Test 9: Conversations exist in vault ─────────────────────────
  await test('Imported conversations exist in vault', async () => {
    const convFiles = await getAllNotes('Sources/Claude-Conversations');
    const isProd = VAULT_PATH === '/mnt/c/MCP';
    const minExpected = isProd ? 100 : 1;
    assert(convFiles.length >= minExpected, `Expected >=${minExpected} conversations, found ${convFiles.length}`);
  });

  // ─── Test 9: Conversation frontmatter valid ────────────────────────
  await test('Imported conversations have valid frontmatter', async () => {
    const convFiles = await getAllNotes('Sources/Claude-Conversations');
    const sample = convFiles.slice(0, 5);
    for (const f of sample) {
      const content = fs.readFileSync(f, 'utf8');
      assert(content.startsWith('---'), `Missing frontmatter in ${path.basename(f)}`);
      assert(
        content.includes('source: "claude-conversations"') || content.includes('source: claude-conversations'),
        `Missing source in ${path.basename(f)}`
      );
      assert(content.includes('source_id:'), `Missing source_id in ${path.basename(f)}`);
      assert(
        content.includes('status:'),
        `Missing status in ${path.basename(f)}`
      );
    }
  });

  // ─── Test 10: MCP config valid ────────────────────────────────────
  await test('MCP configuration file is valid JSON', async () => {
    const configPath = path.join(process.env.HOME!, '.config/claude/mcp_servers.json');
    assert(fs.existsSync(configPath), `MCP config not found: ${configPath}`);
    const raw = fs.readFileSync(configPath, 'utf8');
    const config = JSON.parse(raw);
    assert('obsidian' in config, 'Missing "obsidian" key in MCP config');
    assert(config.obsidian.command === 'node', 'MCP command should be "node"');
    assert(Array.isArray(config.obsidian.args), 'MCP args should be array');
  });

  // ─── Cleanup ───────────────────────────────────────────────────────
  cleanup();
  process.stdout.write(`\n  Cleaned up ${testFiles.length} test files\n`);

  // ─── Summary ──────────────────────────────────────────────────────
  const passed = results.filter(r => r.passed).length;
  const failed = results.filter(r => !r.passed).length;
  const total = results.length;

  process.stdout.write('\n=== Results ===\n');
  process.stdout.write(`Passed: ${passed}/${total}\n`);
  process.stdout.write(`Failed: ${failed}/${total}\n`);

  if (failed > 0) {
    process.stdout.write('\nFailed tests:\n');
    for (const r of results.filter(r => !r.passed)) {
      process.stdout.write(`  - ${r.name}: ${r.message}\n`);
    }
    process.exit(1);
  } else {
    process.stdout.write('\nAll tests passed!\n');
  }
}

runTests().catch(err => {
  cleanup();
  process.stderr.write(`Test runner crashed: ${err}\n`);
  process.exit(1);
});
