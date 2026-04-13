import { useState, useCallback } from 'react';
import { moduleRouter, Module1Response, RoutingResult } from '@/src/services/ModuleRouter';
import { ExamPacket } from '@/src/types/ExamPacket';

/**
 * Hook return type
 */
export interface UseRoutingReturn {
  /**
   * Route to Module 2 based on Module 1 results
   */
  routeModule: (
    sessionId: string,
    examPacket: ExamPacket,
    module1Responses: Module1Response[]
  ) => Promise<RoutingResult>;
  
  /**
   * Current routing result (null if not yet routed)
   */
  routingResult: RoutingResult | null;
  
  /**
   * Whether routing is in progress
   */
  isRouting: boolean;
  
  /**
   * Error message if routing failed
   */
  error: string | null;
  
  /**
   * Reset the routing state
   */
  reset: () => void;
  
  /**
   * Preview the routing decision without making API call
   */
  previewRouting: (
    examPacket: ExamPacket,
    module1Responses: Module1Response[]
  ) => {
    nextModuleId: string;
    rawScore: number;
    threshold: number;
    totalQuestions: number;
  } | null;
}

/**
 * useRouting Hook
 * 
 * Provides a React hook interface for module routing functionality.
 * 
 * Features:
 * - Routes to Module 2 based on Module 1 results
 * - Manages loading and error states
 * - Provides preview functionality
 * - Handles API calls and state updates
 * 
 * @example
 * ```tsx
 * const { routeModule, isRouting, routingResult, error } = useRouting();
 * 
 * const handleModule1Complete = async () => {
 *   const result = await routeModule(sessionId, examPacket, responses);
 *   if (result.success) {
 *     // Navigate to result.nextModuleId
 *   }
 * };
 * ```
 */
export function useRouting(): UseRoutingReturn {
  const [routingResult, setRoutingResult] = useState<RoutingResult | null>(null);
  const [isRouting, setIsRouting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /**
   * Route to Module 2 based on Module 1 results
   */
  const routeModule = useCallback(
    async (
      sessionId: string,
      examPacket: ExamPacket,
      module1Responses: Module1Response[]
    ): Promise<RoutingResult> => {
      setIsRouting(true);
      setError(null);
      setRoutingResult(null);

      try {
        const result = await moduleRouter.routeModule(
          sessionId,
          examPacket,
          module1Responses
        );

        setRoutingResult(result);
        setIsRouting(false);

        return result;
      } catch (err: any) {
        const errorMessage = err.message || 'Failed to route module';
        setError(errorMessage);
        setIsRouting(false);
        
        // Re-throw so caller can handle it
        throw err;
      }
    },
    []
  );

  /**
   * Preview the routing decision without making API call
   */
  const previewRouting = useCallback(
    (
      examPacket: ExamPacket,
      module1Responses: Module1Response[]
    ): {
      nextModuleId: string;
      rawScore: number;
      threshold: number;
      totalQuestions: number;
    } | null => {
      try {
        if (!examPacket || !module1Responses || module1Responses.length === 0) {
          return null;
        }

        const threshold = examPacket.routing_logic?.module_1_threshold;
        if (threshold === undefined || threshold === null) {
          return null;
        }

        const { rawScore, totalQuestions } = moduleRouter.calculateScore(module1Responses);
        const nextModuleId = moduleRouter.determineNextModule(rawScore, threshold);

        return {
          nextModuleId,
          rawScore,
          threshold,
          totalQuestions,
        };
      } catch (err) {
        console.error('[useRouting] Error previewing routing:', err);
        return null;
      }
    },
    []
  );

  /**
   * Reset the routing state
   */
  const reset = useCallback(() => {
    setRoutingResult(null);
    setError(null);
    setIsRouting(false);
  }, []);

  return {
    routeModule,
    routingResult,
    isRouting,
    error,
    reset,
    previewRouting,
  };
}
