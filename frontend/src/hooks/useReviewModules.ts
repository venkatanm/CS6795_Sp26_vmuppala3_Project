/**
 * Hook to fetch all completed modules for review mode.
 * 
 * In review mode, we need to fetch all modules that were completed during the exam
 * to show all questions for review.
 */
import { useQuery } from '@tanstack/react-query';
import { useExam } from '../context/ExamContext';

interface ReviewModule {
  module: {
    id: string;
    type: string;
    question_order: string[];
  };
  questions: Record<string, any>;
  config: {
    total_time: number;
    allowed_tools: string[];
  };
}

/**
 * Fetch all completed modules for a session.
 * 
 * Strategy:
 * 1. Get session from ExamContext to determine which modules were completed
 * 2. Fetch each completed module from the backend
 * 3. Combine all questions into a single list for review
 */
export function useReviewModules(sessionId: string | null): {
  allModules: ReviewModule[];
  allQuestionIds: string[];
  isLoading: boolean;
  error: Error | null;
} {
  const { state } = useExam();
  
  // Determine which modules were completed based on session status
  const completedModuleIds = (() => {
    if (!state.session || state.session.status !== 'completed') {
      return [];
    }
    
    // For diagnostic exams, we typically have Module 1 and Module 2
    // We can infer module IDs from the session's currentModuleId and exam structure
    const moduleIds: string[] = [];
    
    // Always include Module 1 (diagnostic exams start with Module 1)
    const examId = state.session.examId;
    const isMath = examId === '550e8400-e29b-41d4-a716-446655440000';
    const isRW = examId === '550e8400-e29b-41d4-a716-446655440001';
    
    if (isMath) {
      moduleIds.push('math_module_1');
      // If completed, Module 2 was also taken (either easy or hard)
      if (state.session.currentModuleId) {
        const module2Id = state.session.currentModuleId;
        if (module2Id === 'math_module_2_easy' || module2Id === 'math_module_2_hard') {
          moduleIds.push(module2Id);
        }
      }
    } else if (isRW) {
      moduleIds.push('rw_module_1');
      // If completed, Module 2 was also taken (either easy or hard)
      if (state.session.currentModuleId) {
        const module2Id = state.session.currentModuleId;
        if (module2Id === 'rw_module_2_easy' || module2Id === 'rw_module_2_hard') {
          moduleIds.push(module2Id);
        }
      }
    }
    
    return moduleIds;
  })();
  
  // Fetch each completed module
  const moduleQueries = completedModuleIds.map(moduleId =>
    useQuery({
      queryKey: ['review-module', sessionId, moduleId],
      queryFn: async () => {
        if (!sessionId) throw new Error('No session ID');
        // For review mode, we can fetch a specific module by temporarily setting current_module_id
        // Or we can create a new endpoint. For now, let's use the current-module endpoint
        // with a query parameter to specify which module to fetch
        const response = await fetch(
          `/api/exam/session/${sessionId}/current-module?module_id=${moduleId}`
        );
        if (!response.ok) throw new Error(`Failed to fetch module ${moduleId}: ${response.status}`);
        return response.json() as Promise<ReviewModule>;
      },
      enabled: !!sessionId && !!moduleId && state.session?.status === 'completed',
      staleTime: 5 * 60 * 1000, // Cache for 5 minutes in review mode
    })
  );
  
  const isLoading = moduleQueries.some(q => q.isLoading);
  const errors = moduleQueries.map(q => q.error).filter(Boolean) as Error[];
  const error = errors.length > 0 ? errors[0] : null;
  
  const allModules = moduleQueries
    .map(q => q.data)
    .filter((data): data is ReviewModule => data !== undefined);
  
  // Combine all question IDs from all modules
  const allQuestionIds = allModules.flatMap(m => m.module.question_order || []);
  
  return {
    allModules,
    allQuestionIds,
    isLoading,
    error
  };
}
