/**
 * Tutor Service Layer
 * Handles vector similarity search for misconceptions and curriculum chunks
 */

import { Client } from "pg";
import { GoogleGenerativeAI } from "@google/generative-ai";
import * as dotenv from "dotenv";
import * as path from "path";
import { fileURLToPath } from "url";

// Load environment variables
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "../..");
dotenv.config({ path: path.join(projectRoot, ".env") });

// Constants
const EMBEDDING_MODEL = "text-embedding-004";
const EMBEDDING_DIM = 768;
const SIMILARITY_THRESHOLD = 0.85;

// Database connection
let dbClient: Client | null = null;

function getDbClient(): Client {
  if (!dbClient) {
    dbClient = new Client({
      host: process.env.DB_HOST || "localhost",
      port: parseInt(process.env.DB_PORT || "5432"),
      database: process.env.DB_NAME || "fastapi_db",
      user: process.env.DB_USER || "postgres",
      password: process.env.DB_PASSWORD || "postgres",
    });
  }
  return dbClient;
}

// Initialize Gemini for embeddings
let genAI: GoogleGenerativeAI | null = null;

function getGeminiClient(): GoogleGenerativeAI {
  if (!genAI) {
    const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
    if (!apiKey) {
      throw new Error("GEMINI_API_KEY or GOOGLE_API_KEY not found in environment variables");
    }
    genAI = new GoogleGenerativeAI(apiKey);
  }
  return genAI;
}

/**
 * Generate embedding for text using Gemini text-embedding-004
 */
async function generateEmbedding(text: string): Promise<number[]> {
  const genAI = getGeminiClient();
  const model = genAI.getGenerativeModel({ model: EMBEDDING_MODEL });
  const result = await model.embedContent(text);
  return result.embedding.values; // Returns 768-length array
}

/**
 * Convert embedding array to pgvector format string
 */
function embeddingToVector(embedding: number[]): string {
  return `[${embedding.join(",")}]`;
}

export class TutorService {
  private db: Client;
  private initialized: boolean = false;

  constructor() {
    this.db = getDbClient();
  }

  /**
   * Initialize database connection
   */
  async initialize(): Promise<void> {
    if (!this.initialized) {
      if (!this.db) {
        this.db = getDbClient();
      }
      await this.db.connect();
      this.initialized = true;
    }
  }

  /**
   * Diagnose if student's mistake matches a known misconception
   * 
   * @param studentInput - The student's answer or explanation
   * @param questionId - Optional question ID to filter misconceptions
   * @returns Object with found flag and remediation text
   */
  async diagnoseMistake(
    studentInput: string,
    questionId?: string
  ): Promise<{ found: boolean; remediation: string | null }> {
    await this.initialize();

    try {
      // Generate embedding for student input
      const embedding = await generateEmbedding(studentInput);
      const embeddingVector = embeddingToVector(embedding);

      // Search misconceptions using vector similarity
      // Note: misconceptions table may not have embeddings yet
      // We'll use a hybrid approach: try vector search first, fallback to text search
      const hasEmbedding = await this.checkMisconceptionsHasEmbedding();
      
      if (hasEmbedding) {
        // Vector similarity search (if embeddings exist)
        const result = await this.db.query(
          `SELECT name, remediation_text,
             (1 - (embedding <=> $1::vector(${EMBEDDING_DIM}))) as similarity
           FROM misconceptions
           WHERE embedding IS NOT NULL
             AND (1 - (embedding <=> $1::vector(${EMBEDDING_DIM}))) > $2
           ORDER BY similarity DESC
           LIMIT 1`,
          [embeddingVector, SIMILARITY_THRESHOLD]
        );

        if (result.rows.length > 0) {
          return {
            found: true,
            remediation: result.rows[0].remediation_text,
          };
        }
      }
      
      // Fallback: Text-based search on name and remediation_text
      // This works even without embeddings and can catch keyword matches
      const searchTerms = studentInput
        .toLowerCase()
        .split(/\s+/)
        .filter(w => w.length > 3)
        .slice(0, 3);
      
      if (searchTerms.length > 0) {
        // Build a simple ILIKE query for each term
        const conditions = searchTerms.map((_, i) => 
          `(name ILIKE $${i + 1} OR remediation_text ILIKE $${i + 1})`
        ).join(" OR ");
        
        const params = searchTerms.map(term => `%${term}%`);
        
        const query = `SELECT name, remediation_text
           FROM misconceptions
           WHERE ${conditions}
           LIMIT 1`;
        
        const result = await this.db.query(query, params);

        if (result.rows.length > 0) {
          return {
            found: true,
            remediation: result.rows[0].remediation_text,
          };
        }
      }

      return { found: false, remediation: null };
    } catch (error) {
      console.error("Error in diagnoseMistake:", error);
      return { found: false, remediation: null };
    }
  }

  /**
   * Check if misconceptions table has embedding column
   */
  private async checkMisconceptionsHasEmbedding(): Promise<boolean> {
    try {
      const result = await this.db.query(
        `SELECT column_name 
         FROM information_schema.columns 
         WHERE table_name = 'misconceptions' 
           AND column_name = 'embedding'`
      );
      return result.rows.length > 0;
    } catch (error) {
      return false;
    }
  }

  /**
   * Fetch concept explanation from curriculum chunks
   * 
   * @param query - Student's question or concept they're asking about
   * @param studentScore - Student's current SAT score (for adaptive filtering)
   * @returns Top 3 curriculum chunks with explanations
   */
  async fetchConceptExplanation(
    query: string,
    studentScore: number
  ): Promise<Array<{ content: string; source?: string; skill_id?: string }>> {
    await this.initialize();

    try {
      // Generate embedding for query
      const queryEmbedding = await generateEmbedding(query);
      const embeddingVector = embeddingToVector(queryEmbedding);

      // Get skill band descriptor for student's score
      // Score ranges: 200-800, typically broken into bands like 200-400, 400-600, 600-800
      const scoreBand = this.getScoreBand(studentScore);
      
      // Query skill_bands to get descriptor for this score range
      let skillBandDescriptor = "";
      try {
        const bandResult = await this.db.query(
          `SELECT descriptor 
           FROM skill_bands 
           WHERE $1::int >= CAST(SPLIT_PART(score_range, '-', 1) AS INT)
             AND $1::int <= CAST(SPLIT_PART(score_range, '-', 2) AS INT)
           LIMIT 1`,
          [studentScore]
        );
        
        if (bandResult.rows.length > 0) {
          skillBandDescriptor = bandResult.rows[0].descriptor;
        }
      } catch (error) {
        // If skill_bands query fails, continue without descriptor
        console.warn("Could not fetch skill band descriptor:", error);
      }

      // Build search query with optional skill band context
      // Use vector similarity search on curriculum_chunks
      const searchQuery = skillBandDescriptor 
        ? `${query} ${skillBandDescriptor}` // Append descriptor for context
        : query;

      const searchEmbedding = await generateEmbedding(searchQuery);
      const searchVector = embeddingToVector(searchEmbedding);

      // Vector similarity search on curriculum_chunks
      const result = await this.db.query(
        `SELECT content, source_type as source, skill_id,
           (1 - (embedding <=> $1::vector(${EMBEDDING_DIM}))) as similarity
         FROM curriculum_chunks
         WHERE embedding IS NOT NULL
         ORDER BY similarity DESC
         LIMIT 3`,
        [searchVector]
      );

      return result.rows.map(row => ({
        content: row.content,
        source: row.source || undefined,
        skill_id: row.skill_id || undefined,
      }));
    } catch (error) {
      console.error("Error in fetchConceptExplanation:", error);
      return [];
    }
  }

  /**
   * Get score band for a given score
   */
  private getScoreBand(score: number): string {
    if (score < 400) return "200-400";
    if (score < 600) return "400-600";
    if (score < 700) return "600-700";
    return "700-800";
  }

  /**
   * Close database connection
   */
  async close(): Promise<void> {
    if (this.db && this.initialized) {
      await this.db.end();
      this.initialized = false;
    }
  }
}
