/**
 * Shared skiplist for vault sync — prevents specific items from being imported.
 *
 * Skiplist file lives at Sources/.sync_skiplist.json in the vault.
 * Each source has its own array of IDs (native to that source).
 *
 * Usage:
 *   import { loadSkiplist, isSkipped } from './skiplist';
 *   const skiplist = loadSkiplist();
 *   if (isSkipped(skiplist, 'claude_ai', conversationUuid)) { ... }
 */

import * as fs from 'fs';
import { resolvePath } from '../utils/vault_ops';

const SKIPLIST_PATH = 'Sources/.sync_skiplist.json';

export interface Skiplist {
  claude_ai: string[];
  notion: string[];
  apple_notes: string[];
}

export function loadSkiplist(): Skiplist {
  try {
    const raw = fs.readFileSync(resolvePath(SKIPLIST_PATH), 'utf8');
    return JSON.parse(raw);
  } catch {
    return { claude_ai: [], notion: [], apple_notes: [] };
  }
}

export function isSkipped(skiplist: Skiplist, source: keyof Skiplist, id: string): boolean {
  return skiplist[source].includes(id);
}
