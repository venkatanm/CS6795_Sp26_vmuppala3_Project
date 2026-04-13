/**
 * RetrievalService
 * 
 * Service for querying the RAG vector database to retrieve relevant curriculum chunks.
 * 
 * This service calls the backend API which performs semantic search using pgvector
 * to find the most relevant explanations for concepts based on student history.
 */
import api from '@/lib/api';

export interface StudentHistoryItem {
  concept: string;
  score: number; // 0.0 to 1.0, where < 0.7 indicates weakness
}

export interface CurriculumChunk {
  content: string;
  concept_name: string | null;
  concept_id: string | null;
  difficulty: string | null;
  source: string | null;
  similarity: number; // 0.0 to 1.0, cosine similarity score
  metadata: Record<string, any>;
}

export interface QueryOptions {
  concept?: string;
  student_history?: StudentHistoryItem[];
  query_text?: string;
  difficulty?: 'easy' | 'medium' | 'hard';
  top_k?: number; // Default: 3
}

class RetrievalService {
  /**
   * Query the RAG database for relevant curriculum chunks.
   * 
   * @param options - Query options including concept, student history, etc.
   * @returns Promise<CurriculumChunk[]> - Top K most relevant chunks
   */
  async query(options: QueryOptions): Promise<CurriculumChunk[]> {
    try {
      const response = await api.post<{ chunks: CurriculumChunk[] }>(
        '/api/rag/query',
        {
          concept: options.concept,
          student_history: options.student_history,
          query_text: options.query_text,
          difficulty: options.difficulty,
          top_k: options.top_k || 3,
        }
      );

      return response.data.chunks;
    } catch (error: any) {
      console.error('[RetrievalService] Error querying RAG database:', error);
      
      // Return empty array on error (graceful degradation)
      if (error.response?.status === 404) {
        console.warn('[RetrievalService] RAG endpoint not found. Ensure backend is running and endpoint is configured.');
      } else if (error.response?.status >= 500) {
        console.error('[RetrievalService] Server error. RAG service may be unavailable.');
      }
      
      return [];
    }
  }

  /**
   * Query by concept name.
   * Convenience method for simple concept-based queries.
   * 
   * @param concept - Concept name (e.g., "Linear Equations")
   * @param difficulty - Optional difficulty filter
   * @param top_k - Number of results (default: 3)
   * @returns Promise<CurriculumChunk[]>
   */
  async queryByConcept(
    concept: string,
    difficulty?: 'easy' | 'medium' | 'hard',
    top_k: number = 3
  ): Promise<CurriculumChunk[]> {
    return this.query({
      concept,
      difficulty,
      top_k,
    });
  }

  /**
   * Query with student history for personalized explanations.
   * 
   * @param concept - Concept name
   * @param studentHistory - Student's past performance on concepts
   * @param top_k - Number of results (default: 3)
   * @returns Promise<CurriculumChunk[]>
   */
  async queryWithHistory(
    concept: string,
    studentHistory: StudentHistoryItem[],
    top_k: number = 3
  ): Promise<CurriculumChunk[]> {
    return this.query({
      concept,
      student_history: studentHistory,
      top_k,
    });
  }

  /**
   * Free-form semantic search.
   * 
   * @param queryText - Natural language query (e.g., "How do I solve quadratic equations?")
   * @param top_k - Number of results (default: 3)
   * @returns Promise<CurriculumChunk[]>
   */
  async semanticSearch(
    queryText: string,
    top_k: number = 3
  ): Promise<CurriculumChunk[]> {
    return this.query({
      query_text: queryText,
      top_k,
    });
  }
}

// Export singleton instance
export const retrievalService = new RetrievalService();

// Export class for testing
export default RetrievalService;
