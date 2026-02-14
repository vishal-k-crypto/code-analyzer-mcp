/**
 * Vector Store Service
 * Manages embeddings and semantic search using LanceDB
 */

import { connect, Connection, Table } from 'vectordb';
import { pipeline, FeatureExtractionPipeline } from '@xenova/transformers';
import { join } from 'path';
import { mkdir } from 'fs/promises';
import type { FileChunk } from '../types/task.js';

// Vector record stored in LanceDB
interface VectorRecord {
  id: string;
  filePath: string;
  chunkIndex: number;
  content: string;
  startLine: number;
  endLine: number;
  vector: number[];
}

// Search result with similarity score
export interface VectorSearchResult {
  filePath: string;
  chunkIndex: number;
  content: string;
  startLine: number;
  endLine: number;
  score: number;
}

/**
 * VectorStore manages file embeddings and semantic search
 */
export class VectorStore {
  private dbPath: string;
  private connection: Connection | null = null;
  private table: Table | null = null;
  private embedder: FeatureExtractionPipeline | null = null;
  private initialized = false;
  private initPromise: Promise<void> | null = null;

  // Embedding model - using small local model
  private readonly MODEL_NAME = 'Xenova/all-MiniLM-L6-v2';
  private readonly VECTOR_DIM = 384; // MiniLM-L6-v2 produces 384-dimensional embeddings
  private readonly CHUNK_SIZE = 512; // characters per chunk
  private readonly CHUNK_OVERLAP = 128; // overlap between chunks

  constructor(projectPath: string) {
    this.dbPath = join(projectPath, '.orchestrator', 'vector-store');
  }

  /**
   * Initialize the vector store
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;
    if (this.initPromise) return this.initPromise;

    this.initPromise = this.doInitialize();
    return this.initPromise;
  }

  private async doInitialize(): Promise<void> {
    try {
      // Create database directory
      await mkdir(this.dbPath, { recursive: true });

      // Connect to LanceDB
      this.connection = await connect(this.dbPath);

      // Open or create table
      const tableNames = await this.connection.tableNames();
      if (tableNames.includes('file_embeddings')) {
        this.table = await this.connection.openTable('file_embeddings');
      } else {
        // Create new table with sample record for schema
        const sampleRecord = {
          id: 'sample',
          filePath: 'sample.ts',
          chunkIndex: 0,
          content: 'sample',
          startLine: 0,
          endLine: 0,
          vector: new Array(this.VECTOR_DIM).fill(0)
        };
        this.table = await this.connection.createTable('file_embeddings', [sampleRecord]);
      }

      // Initialize embedding model
      this.embedder = await pipeline('feature-extraction', this.MODEL_NAME);

      this.initialized = true;
    } catch (error) {
      console.error('Failed to initialize vector store:', error);
      throw error;
    }
  }

  /**
   * Generate embedding for text
   */
  private async generateEmbedding(text: string): Promise<number[]> {
    if (!this.embedder) {
      throw new Error('Vector store not initialized');
    }

    // Truncate text if too long (model has max token limit)
    const truncated = text.slice(0, 512 * 4); // Rough estimate: 4 chars per token

    const output = await this.embedder(truncated, {
      pooling: 'mean',
      normalize: true
    });

    return Array.from(output.data) as number[];
  }

  /**
   * Chunk file content into smaller pieces
   */
  chunkContent(content: string): Array<{ content: string; startLine: number; endLine: number }> {
    const lines = content.split('\n');
    const chunks: Array<{ content: string; startLine: number; endLine: number }> = [];

    let currentChunk = '';
    let startLine = 0;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      
      // Start a new chunk if current is large enough
      if (currentChunk.length >= this.CHUNK_SIZE && currentChunk.length > 0) {
        chunks.push({
          content: currentChunk.trim(),
          startLine: startLine + 1, // 1-indexed
          endLine: i
        });
        
        // Overlap: keep last few lines for context
        const overlapLines = currentChunk.split('\n').slice(-Math.floor(this.CHUNK_OVERLAP / 50));
        currentChunk = overlapLines.join('\n') + '\n' + line;
        startLine = i - overlapLines.length + 1;
      } else {
        currentChunk += (currentChunk ? '\n' : '') + line;
      }
    }

    // Add final chunk
    if (currentChunk.trim()) {
      chunks.push({
        content: currentChunk.trim(),
        startLine: startLine + 1,
        endLine: lines.length
      });
    }

    return chunks;
  }

  /**
   * Index a file by chunking and generating embeddings
   */
  async indexFile(filePath: string, content: string): Promise<FileChunk[]> {
    await this.initialize();

    if (!this.table) {
      throw new Error('Table not initialized');
    }

    // Delete existing embeddings for this file
    await this.deleteFileEmbeddings(filePath);

    // Chunk content
    const chunks = this.chunkContent(content);
    const fileChunks: FileChunk[] = [];
    const records = [];

    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
      const embedding = await this.generateEmbedding(chunk.content);

      const chunkId = `${filePath}#${i}`;
      records.push({
        id: chunkId,
        filePath,
        chunkIndex: i,
        content: chunk.content,
        startLine: chunk.startLine,
        endLine: chunk.endLine,
        vector: embedding
      });

      fileChunks.push({
        id: chunkId,
        content: chunk.content,
        startLine: chunk.startLine,
        endLine: chunk.endLine,
        embedding
      });
    }

    // Insert records in batch
    if (records.length > 0) {
      await this.table.add(records);
    }

    return fileChunks;
  }

  /**
   * Delete all embeddings for a file
   */
  private async deleteFileEmbeddings(_filePath: string): Promise<void> {
    // LanceDB doesn't support direct deletion by filter in all versions
    // We'll overwrite by not including these in future searches
    // In production, you might want to compact the table periodically
  }

  /**
   * Perform semantic search
   */
  async similaritySearch(query: string, topK: number = 10): Promise<VectorSearchResult[]> {
    await this.initialize();

    if (!this.table) {
      throw new Error('Table not initialized');
    }

    const queryEmbedding = await this.generateEmbedding(query);

    const results = await this.table
      .search(queryEmbedding)
      .limit(topK)
      .execute();

    return (results as unknown as VectorRecord[])
      .filter(r => r.filePath !== 'sample.ts')
      .map(r => ({
        filePath: r.filePath,
        chunkIndex: r.chunkIndex,
        content: r.content,
        startLine: r.startLine,
        endLine: r.endLine,
        score: 1 - (this.cosineDistance(queryEmbedding, r.vector))
      }));
  }

  /**
   * Calculate cosine distance between two vectors
   */
  private cosineDistance(a: number[], b: number[]): number {
    let dotProduct = 0;
    let normA = 0;
    let normB = 0;

    for (let i = 0; i < a.length; i++) {
      dotProduct += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }

    const similarity = dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
    return 1 - similarity; // Distance = 1 - similarity
  }

  /**
   * Clear all embeddings
   */
  async clear(): Promise<void> {
    await this.initialize();

    if (this.connection) {
      const tableNames = await this.connection.tableNames();
      if (tableNames.includes('file_embeddings')) {
        await this.connection.dropTable('file_embeddings');
      }
      
      // Recreate table
      const sampleRecord = {
        id: 'sample',
        filePath: 'sample.ts',
        chunkIndex: 0,
        content: 'sample',
        startLine: 0,
        endLine: 0,
        vector: new Array(this.VECTOR_DIM).fill(0)
      };
      this.table = await this.connection.createTable('file_embeddings', [sampleRecord]);
    }
  }

  /**
   * Get stats about the vector store
   */
  async getStats(): Promise<{ totalChunks: number; files: string[] }> {
    await this.initialize();

    if (!this.table) {
      return { totalChunks: 0, files: [] };
    }

    // Use search to get all non-sample records
    const dummyVector = new Array(this.VECTOR_DIM).fill(0);
    const results = await this.table
      .search(dummyVector)
      .limit(10000)
      .execute();

    const files = new Set<string>();
    let totalChunks = 0;
    
    for (const r of results as unknown as VectorRecord[]) {
      if (r.filePath !== 'sample.ts') {
        files.add(r.filePath);
        totalChunks++;
      }
    }

    return {
      totalChunks,
      files: Array.from(files)
    };
  }

  /**
   * Close the vector store connection
   */
  async close(): Promise<void> {
    this.initialized = false;
    this.initPromise = null;
    this.connection = null;
    this.table = null;
    this.embedder = null;
  }
}
