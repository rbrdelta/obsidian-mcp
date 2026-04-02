import * as fs from 'fs';
import * as path from 'path';

const CONFIG_PATH = path.join(__dirname, '../../config/vault_config.json');

interface VaultConfig {
  vault_path: string;
  folders: Record<string, string>;
  auto_tag_rules: Record<string, string[]>;
  domain_rules: Record<string, string[]>;
  mode_rules: Record<string, string[]>;
}

let _config: VaultConfig | null = null;

export function getConfig(): VaultConfig {
  if (!_config) {
    _config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
  }
  return _config!;
}

export function buildFrontmatter(fields: Record<string, unknown>): string {
  const lines = ['---'];
  for (const [key, value] of Object.entries(fields)) {
    if (value === undefined || value === null) continue;
    if (Array.isArray(value)) {
      if (value.length === 0) continue;
      lines.push(`${key}:`);
      for (const item of value) {
        lines.push(`  - ${typeof item === 'string' ? JSON.stringify(item) : item}`);
      }
    } else if (typeof value === 'string') {
      lines.push(`${key}: ${JSON.stringify(value)}`);
    } else {
      lines.push(`${key}: ${value}`);
    }
  }
  lines.push('---');
  return lines.join('\n');
}

export function autoTag(content: string, title: string): string[] {
  const config = getConfig();
  const text = (title + ' ' + content).toLowerCase();
  const tags: Set<string> = new Set();

  for (const [tag, keywords] of Object.entries(config.auto_tag_rules)) {
    if (matchesKeywords(text, keywords)) {
      tags.add(tag);
    }
  }

  return Array.from(tags);
}

function matchesKeywords(text: string, keywords: string[]): boolean {
  return keywords.some(kw => {
    if (kw.length <= 3) {
      const re = new RegExp(`\\b${kw.toLowerCase()}\\b`);
      return re.test(text);
    }
    return text.includes(kw.toLowerCase());
  });
}

/**
 * Count how many keywords from a list appear in the text.
 */
function countKeywordHits(text: string, keywords: string[]): number {
  let hits = 0;
  for (const kw of keywords) {
    if (kw.length <= 3) {
      const re = new RegExp(`\\b${kw.toLowerCase()}\\b`);
      if (re.test(text)) hits++;
    } else if (text.includes(kw.toLowerCase())) {
      hits++;
    }
  }
  return hits;
}

/**
 * Title-weighted classification: keywords in the title count 3x.
 * For domains, require a minimum score that scales with note length
 * to prevent long notes from matching everything.
 */
function scoreDomain(title: string, content: string, keywords: string[]): number {
  const titleText = title.toLowerCase();
  const bodyText = content.toLowerCase();
  const titleHits = countKeywordHits(titleText, keywords);
  const bodyHits = countKeywordHits(bodyText, keywords);
  return (titleHits * 3) + bodyHits;
}

/**
 * Classify a note using the two-axis taxonomy (domain + mode).
 * Returns { domains, modes, lifecycle } for use in reclassification.
 *
 * Uses scored classification: title keywords count 3x, and longer notes
 * need higher scores to qualify for a domain (prevents over-tagging).
 */
export function classifyNote(
  content: string,
  title: string,
  source: string,
  existingStatus?: string
): { domains: string[]; modes: string[]; lifecycle: string } {
  const config = getConfig();
  const wordCount = content.split(/\s+/).filter(Boolean).length;

  // Threshold scales with note length: short notes need 1 hit, long notes need more
  const threshold = wordCount > 2000 ? 3 : wordCount > 500 ? 2 : 1;

  const scored: { tag: string; score: number }[] = [];
  for (const [tag, keywords] of Object.entries(config.domain_rules)) {
    const score = scoreDomain(title, content, keywords);
    if (score >= threshold) {
      scored.push({ tag, score });
    }
  }

  // Cap at 3 domains max — take highest scoring
  scored.sort((a, b) => b.score - a.score);
  const domains = scored.slice(0, 3).map(s => s.tag);

  // Mode detection: use simple keyword match (these are behavioral, not topical)
  const text = (title + ' ' + content).toLowerCase();
  const modes: string[] = [];
  for (const [tag, keywords] of Object.entries(config.mode_rules)) {
    if (matchesKeywords(text, keywords)) {
      modes.push(tag);
    }
  }

  // Default mode heuristics by source if no mode matched
  if (modes.length === 0) {
    if (source === 'claude-conversations') modes.push('mode/thinking');
    else if (source === 'apple-notes') modes.push('mode/doing');
    else if (source === 'notion' || source === 'notion-export') modes.push('mode/reference');
    else modes.push('mode/reference');
  }

  // Cap modes at 2
  if (modes.length > 2) {
    modes.length = 2;
  }

  // Lifecycle: map from existing status or default to seed
  let lifecycle = 'status/seed';
  if (existingStatus === 'active') lifecycle = 'status/active';
  else if (existingStatus === 'evergreen') lifecycle = 'status/evergreen';
  else if (existingStatus === 'archived') lifecycle = 'status/archived';

  return { domains, modes, lifecycle };
}

export function now(): string {
  return new Date().toISOString();
}

export function slugify(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .trim();
}
