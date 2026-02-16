/**
 * Hashing Utilities
 * Hash functions for content validation and deduplication
 */

import { createHash } from 'crypto';

/**
 * Calculate MD5 hash of content
 */
export function md5(content: string): string {
  return createHash('md5').update(content).digest('hex');
}

/**
 * Calculate SHA-1 hash of content
 */
export function sha1(content: string): string {
  return createHash('sha1').update(content).digest('hex');
}

/**
 * Calculate SHA-256 hash of content
 */
export function sha256(content: string): string {
  return createHash('sha256').update(content).digest('hex');
}

/**
 * Calculate simple hash (fast, non-cryptographic)
 * Suitable for checksums and caching
 */
export function simpleHash(content: string): string {
  let hash = 0;
  for (let i = 0; i < content.length; i++) {
    const char = content.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32bit integer
  }
  return hash.toString(16);
}

/**
 * Calculate djb2 hash (fast string hash)
 */
export function djb2(content: string): string {
  let hash = 5381;
  for (let i = 0; i < content.length; i++) {
    hash = ((hash << 5) + hash) + content.charCodeAt(i); // hash * 33 + c
  }
  return hash.toString(16);
}

/**
 * Calculate hash of object (by JSON stringifying)
 */
export function hashObject(obj: unknown, algorithm: 'md5' | 'sha1' | 'sha256' = 'md5'): string {
  const content = JSON.stringify(obj);
  switch (algorithm) {
    case 'md5':
      return md5(content);
    case 'sha1':
      return sha1(content);
    case 'sha256':
      return sha256(content);
    default:
      return md5(content);
  }
}

/**
 * Calculate checksum for file content
 */
export function calculateChecksum(content: string): string {
  return simpleHash(content);
}

/**
 * Verify content against expected hash
 */
export function verifyHash(content: string, expectedHash: string, algorithm: 'md5' | 'simple' = 'simple'): boolean {
  let actualHash: string;
  
  switch (algorithm) {
    case 'md5':
      actualHash = md5(content);
      break;
    case 'simple':
    default:
      actualHash = simpleHash(content);
  }
  
  return actualHash === expectedHash;
}

/**
 * Generate a unique ID based on content
 */
export function contentId(content: string, prefix = 'id'): string {
  return `${prefix}-${simpleHash(content)}`;
}

/**
 * Hash multiple strings together
 */
export function hashMultiple(algorithm: 'md5' | 'sha1' | 'sha256', ...contents: string[]): string {
  const hasher = createHash(algorithm);
  for (const content of contents) {
    hasher.update(content);
  }
  return hasher.digest('hex');
}

/**
 * Calculate rolling hash for substring search
 * Uses Rabin-Karp algorithm
 */
export class RollingHash {
  private base = 256;
  private prime = 101;
  private hash = 0;
  private power = 1;

  /**
   * Calculate initial hash of pattern
   */
  init(pattern: string): number {
    this.hash = 0;
    this.power = 1;

    for (let i = 0; i < pattern.length; i++) {
      this.hash = (this.hash * this.base + pattern.charCodeAt(i)) % this.prime;
      if (i < pattern.length - 1) {
        this.power = (this.power * this.base) % this.prime;
      }
    }

    return this.hash;
  }

  /**
   * Roll hash: remove oldChar and add newChar
   */
  roll(oldChar: string, newChar: string): number {
    this.hash = (this.hash - oldChar.charCodeAt(0) * this.power) % this.prime;
    if (this.hash < 0) this.hash += this.prime;
    
    this.hash = (this.hash * this.base + newChar.charCodeAt(0)) % this.prime;
    
    return this.hash;
  }
}
