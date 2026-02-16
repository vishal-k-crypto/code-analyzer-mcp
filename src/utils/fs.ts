/**
 * File System Utilities
 * Common file operations with error handling
 */

import { promises as fs, existsSync, mkdirSync, constants } from 'fs';
import { dirname, join, relative, resolve } from 'path';

/**
 * Ensure directory exists (recursive)
 */
export async function ensureDir(dirPath: string): Promise<void> {
  if (!existsSync(dirPath)) {
    mkdirSync(dirPath, { recursive: true });
  }
}

/**
 * Check if file exists
 */
export function fileExists(filePath: string): boolean {
  return existsSync(filePath);
}

/**
 * Read file with error handling
 */
export async function readFileSafe(filePath: string, encoding: BufferEncoding = 'utf-8'): Promise<string | null> {
  try {
    return await fs.readFile(filePath, encoding);
  } catch {
    return null;
  }
}

/**
 * Write file with atomic operation (write to temp then rename)
 */
export async function writeFileAtomic(filePath: string, content: string): Promise<void> {
  const tempPath = `${filePath}.tmp.${Date.now()}`;
  
  try {
    // Ensure parent directory exists
    await ensureDir(dirname(filePath));
    
    // Write to temp file
    await fs.writeFile(tempPath, content, { mode: 0o600 });
    
    // Atomic rename
    await fs.rename(tempPath, filePath);
  } catch (error) {
    // Clean up temp file on error
    try {
      await fs.unlink(tempPath);
    } catch {
      // Ignore cleanup errors
    }
    throw error;
  }
}

/**
 * Copy file with directory creation
 */
export async function copyFileSafe(src: string, dest: string): Promise<void> {
  await ensureDir(dirname(dest));
  await fs.copyFile(src, dest);
}

/**
 * Remove file if it exists
 */
export async function removeFileSafe(filePath: string): Promise<void> {
  try {
    await fs.unlink(filePath);
  } catch {
    // Ignore errors (file may not exist)
  }
}

/**
 * List directory contents
 */
export async function listDir(dirPath: string): Promise<string[]> {
  try {
    return await fs.readdir(dirPath);
  } catch {
    return [];
  }
}

/**
 * Get file stats with error handling
 */
export async function statSafe(filePath: string): Promise<import('fs').Stats | null> {
  try {
    return await fs.stat(filePath);
  } catch {
    return null;
  }
}

/**
 * Check if path is a directory
 */
export async function isDirectory(filePath: string): Promise<boolean> {
  const stats = await statSafe(filePath);
  return stats?.isDirectory() ?? false;
}

/**
 * Check if path is a file
 */
export async function isFile(filePath: string): Promise<boolean> {
  const stats = await statSafe(filePath);
  return stats?.isFile() ?? false;
}

/**
 * Get relative path from base
 */
export function getRelativePath(from: string, to: string): string {
  return relative(from, to);
}

/**
 * Resolve path to absolute
 */
export function resolvePath(filePath: string, base?: string): string {
  if (base) {
    return resolve(base, filePath);
  }
  return resolve(filePath);
}

/**
 * Join paths safely
 */
export function joinPaths(...paths: string[]): string {
  return join(...paths);
}

/**
 * Find files matching pattern
 */
export async function findFiles(
  dirPath: string,
  options: {
    pattern?: RegExp;
    recursive?: boolean;
    includeDirs?: boolean;
  } = {}
): Promise<string[]> {
  const { pattern, recursive = true, includeDirs = false } = options;
  const results: string[] = [];

  async function scan(currentPath: string): Promise<void> {
    const entries = await listDir(currentPath);

    for (const entry of entries) {
      const fullPath = join(currentPath, entry);
      const stats = await statSafe(fullPath);

      if (!stats) continue;

      if (stats.isDirectory()) {
        if (includeDirs && (!pattern || pattern.test(entry))) {
          results.push(fullPath);
        }
        if (recursive) {
          await scan(fullPath);
        }
      } else if (stats.isFile()) {
        if (!pattern || pattern.test(entry)) {
          results.push(fullPath);
        }
      }
    }
  }

  await scan(dirPath);
  return results;
}

/**
 * Check file permissions
 */
export async function canRead(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath, constants.R_OK);
    return true;
  } catch {
    return false;
  }
}

export async function canWrite(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath, constants.W_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * Get file size in bytes
 */
export async function getFileSize(filePath: string): Promise<number> {
  const stats = await statSafe(filePath);
  return stats?.size ?? 0;
}

/**
 * Read JSON file with error handling
 */
export async function readJsonFile<T = unknown>(filePath: string): Promise<T | null> {
  const content = await readFileSafe(filePath);
  if (!content) return null;
  
  try {
    return JSON.parse(content) as T;
  } catch {
    return null;
  }
}

/**
 * Write JSON file
 */
export async function writeJsonFile(filePath: string, data: unknown, pretty = true): Promise<void> {
  const content = pretty ? JSON.stringify(data, null, 2) : JSON.stringify(data);
  await writeFileAtomic(filePath, content);
}
