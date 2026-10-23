import * as fs from 'fs';
import * as path from 'path';
import { glob } from 'glob';

const VAULT_PATH = process.env.VAULT_PATH || '/mnt/c/MCP';

export function getVaultPath(): string {
  return VAULT_PATH;
}

// Hard guardrail (Daniel, 2026-10-23): the Confidential folder is never read, listed, searched or written
// by any tool. Enforced here, not by instructions: resolvePath refuses it (and anything outside the vault),
// getAllNotes never returns it. Matching ignores case and follows symlinks.
export const PROTECTED_FOLDERS = ['confidential'];

function vaultRelative(p: string): string {
  let real = path.resolve(p);
  try { real = fs.realpathSync(real); } catch { /* not created yet: check the path as given */ }
  let root = path.resolve(VAULT_PATH);
  try { root = fs.realpathSync(root); } catch { /* vault missing: compare as given */ }
  return path.relative(root, real);
}

// True when p is outside the vault or inside a protected folder.
export function isProtected(p: string): boolean {
  const rel = vaultRelative(p);
  if (rel.startsWith('..') || path.isAbsolute(rel)) return true;
  const first = rel.split(path.sep)[0].toLowerCase();
  return PROTECTED_FOLDERS.includes(first);
}

export function resolvePath(...parts: string[]): string {
  const full = path.join(VAULT_PATH, ...parts);
  if (isProtected(full)) throw new Error(`Refused: ${parts.join('/')} is outside the vault or in a protected folder`);
  return full;
}

export function ensureDir(dirPath: string): void {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

export function writeNote(filePath: string, content: string): void {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, content, 'utf8');
}

export function readNote(filePath: string): string {
  return fs.readFileSync(filePath, 'utf8');
}

export function noteExists(filePath: string): boolean {
  return fs.existsSync(filePath);
}

export function sanitizeFilename(title: string): string {
  return title
    .replace(/[<>:"/\\|?*]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .substring(0, 200);
}

export async function getAllNotes(folder?: string): Promise<string[]> {
  const searchPath = folder ? resolvePath(folder) : VAULT_PATH;
  const pattern = path.join(searchPath, '**/*.md').replace(/\\/g, '/');
  const files = await glob(pattern, { nodir: true });
  return files.filter((f) => !isProtected(f));
}

export function getRelativePath(absolutePath: string): string {
  return path.relative(VAULT_PATH, absolutePath);
}
