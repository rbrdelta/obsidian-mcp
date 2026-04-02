import * as fs from 'fs';
import * as path from 'path';
import { glob } from 'glob';

const VAULT_PATH = process.env.VAULT_PATH || '/mnt/c/MCP';

export function getVaultPath(): string {
  return VAULT_PATH;
}

export function resolvePath(...parts: string[]): string {
  return path.join(VAULT_PATH, ...parts);
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
  const searchPath = folder ? path.join(VAULT_PATH, folder) : VAULT_PATH;
  const pattern = path.join(searchPath, '**/*.md').replace(/\\/g, '/');
  return glob(pattern, { nodir: true });
}

export function getRelativePath(absolutePath: string): string {
  return path.relative(VAULT_PATH, absolutePath);
}
