import api from '@/lib/api';
import { ExamPacket } from '@/src/types/ExamPacket';

/**
 * Module 1 Response Interface
 */
export interface Module1Response {
  questionId: string;
  isCorrect: boolean;
}

/**
 * Routing Result Interface
 */
export interface RoutingResult {
  success: boolean;
  nextModuleId: string; // "rw_module_2_hard" or "rw_module_2_easy"
  rawScore: number;
  threshold: number;
  totalQuestions: number;
  message?: string;
}

/**
 * ModuleRouter Service
 * 
 * Processes Module 1 results and assigns the correct Module 2 based on routing logic.
 * 
 * Logic:
 * 1. Calculate raw score from Module 1 responses
 * 2. Compare against routing_threshold from ExamPacket
 * 3. If score >= threshold, route to rw_module_2_hard
 * 4. Else, route to rw_module_2_easy
 * 5. Update session with nextModuleId via backend API
 */
class ModuleRouterService {
  /**
   * Route to Module 2 based on Module 1 results.
   * 
   * @param sessionId - The current session ID
   * @param examPacket - The ExamPacket containing routing logic and module definitions
   * @param module1Responses - Array of Module 1 responses with questionId and isCorrect
   * @returns Promise<RoutingResult> - The routing decision and score information
   * @throws Error - If routing fails or API call fails
   */
  async routeModule(
    sessionId: string,
    examPacket: ExamPacket,
    module1Responses: Module1Response[]
  ): Promise<RoutingResult> {
    // Step 1: Validate inputs
    if (!sessionId) {
      throw new Error('Session ID is required');
    }
    if (!examPacket) {
      throw new Error('ExamPacket is required');
    }
    if (!module1Responses || module1Responses.length === 0) {
      throw new Error('Module 1 responses are required');
    }

    // Step 2: Get routing threshold from ExamPacket
    const threshold = examPacket.routing_logic?.module_1_threshold;
    if (threshold === undefined || threshold === null) {
      throw new Error('Routing threshold not found in ExamPacket');
    }

    // Step 3: Calculate raw score (count of correct answers)
    const rawScore = module1Responses.filter(r => r.isCorrect).length;
    const totalQuestions = module1Responses.length;

    // Step 4: Determine next module based on threshold
    // Hard Rule: If Score >= Threshold, route to rw_module_2_hard
    // Else: Route to rw_module_2_easy
    const nextModuleId = rawScore >= threshold 
      ? 'rw_module_2_hard' 
      : 'rw_module_2_easy';

    // Step 5: Verify that the next module exists in the ExamPacket
    const nextModule = examPacket.modules.find(m => m.id === nextModuleId);
    if (!nextModule) {
      throw new Error(
        `Next module ${nextModuleId} not found in ExamPacket. ` +
        `Available modules: ${examPacket.modules.map(m => m.id).join(', ')}`
      );
    }

    // Step 6: Update session via backend API
    try {
        // Extract question IDs for the next module from ExamPacket
        const nextModuleQuestionIds = nextModule.question_order || [];

        const response = await api.post<{
        success: boolean;
        next_module_id: string;
        raw_score: number;
        threshold: number;
        message?: string;
      }>('/sessions/route-module', {
        session_id: sessionId,
        module_1_responses: module1Responses.map(r => ({
          questionId: r.questionId,
          isCorrect: r.isCorrect,
        })),
        next_module_question_ids: nextModuleQuestionIds, // Append question set
      });

      if (!response.data.success) {
        throw new Error(response.data.message || 'Routing failed');
      }

      // Step 7: Return routing result
      return {
        success: true,
        nextModuleId: response.data.next_module_id,
        rawScore: response.data.raw_score,
        threshold: response.data.threshold,
        totalQuestions,
        message: response.data.message,
      };
    } catch (error: any) {
      console.error('[ModuleRouter] Error routing module:', error);
      
      // If API call fails, we can still return the routing decision
      // but log the error. In a production system, you might want to
      // queue this for retry or handle it differently.
      if (error.response?.status >= 500) {
        // Server error - return routing decision but mark as potentially unsynced
        return {
          success: true, // Routing logic succeeded locally
          nextModuleId,
          rawScore,
          threshold,
          totalQuestions,
          message: `Routing decision made locally (score: ${rawScore}/${totalQuestions}). ` +
                   `Session update may be pending due to server error.`,
        };
      }
      
      // Re-throw other errors
      throw new Error(
        `Failed to route module: ${error.response?.data?.detail || error.message}`
      );
    }
  }

  /**
   * Calculate raw score from Module 1 responses (without API call).
   * Useful for preview or validation before routing.
   * 
   * @param module1Responses - Array of Module 1 responses
   * @returns Object with rawScore and totalQuestions
   */
  calculateScore(module1Responses: Module1Response[]): {
    rawScore: number;
    totalQuestions: number;
  } {
    const rawScore = module1Responses.filter(r => r.isCorrect).length;
    const totalQuestions = module1Responses.length;
    
    return { rawScore, totalQuestions };
  }

  /**
   * Determine next module ID based on score and threshold (without API call).
   * Useful for preview or validation before routing.
   * 
   * @param rawScore - The raw score (number of correct answers)
   * @param threshold - The routing threshold
   * @returns The next module ID ("rw_module_2_hard" or "rw_module_2_easy")
   */
  determineNextModule(rawScore: number, threshold: number): string {
    return rawScore >= threshold ? 'rw_module_2_hard' : 'rw_module_2_easy';
  }
}

// Export singleton instance
export const moduleRouter = new ModuleRouterService();

// Export for testing or custom instances
export default ModuleRouterService;

/**
 * Route to next module based on score and threshold.
 * Convenience function for testing and direct usage.
 * 
 * @param score - The raw score (number of correct answers)
 * @param threshold - The routing threshold
 * @returns The next module ID ("rw_module_2_hard" or "rw_module_2_easy")
 */
export function routeToNextModule(score: number, threshold: number): string {
  return moduleRouter.determineNextModule(score, threshold);
}