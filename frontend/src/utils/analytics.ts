import { ExamPacket, QuestionContent } from '@/src/types/ExamPacket';

/**
 * Response data from session
 */
export interface ResponseData {
  questionId: string;
  isCorrect: boolean;
  selectedOptionId?: string | number | null;
  timeSpent?: number;
  timestamp?: number;
}

/**
 * Domain score aggregation result
 */
export interface DomainScore {
  /** Domain name (e.g., "Heart of Algebra", "Problem Solving") */
  domain: string;
  
  /** Number of correct answers in this domain */
  correct: number;
  
  /** Total number of questions in this domain */
  total: number;
  
  /** Accuracy percentage (0-100) */
  accuracy: number;
}

/**
 * Aggregate domain scores from exam responses.
 * 
 * Groups questions by their domain/skill_tag from ExamPacket and calculates
 * accuracy percentage for each domain.
 * 
 * @param responses - Array of response data with questionId and isCorrect
 * @param examPacket - ExamPacket containing content_bank with skill_tag/domain info
 * @returns Array of DomainScore objects sorted by domain name
 * 
 * @example
 * ```typescript
 * const domainScores = aggregateDomainScores(responses, examPacket);
 * // Returns: [
 * //   { domain: "Heart of Algebra", correct: 8, total: 10, accuracy: 80 },
 * //   { domain: "Problem Solving", correct: 5, total: 6, accuracy: 83.33 }
 * // ]
 * ```
 */
export function aggregateDomainScores(
  responses: ResponseData[],
  examPacket: ExamPacket
): DomainScore[] {
  // Map to track domain statistics
  const domainStats = new Map<string, { correct: number; total: number }>();

  // Process each response
  for (const response of responses) {
    const questionId = response.questionId;
    
    // Try to find question in content bank
    // questionId might be a UUID or logical_id, so we need to check both
    let question: QuestionContent | undefined = examPacket.content_bank[questionId];
    
    // If not found by direct key, try to find by matching any key
    // (in case questionId is a UUID but content_bank uses logical_ids)
    if (!question) {
      const matchingKey = Object.keys(examPacket.content_bank).find(
        key => key === questionId || key.includes(questionId) || questionId.includes(key)
      );
      if (matchingKey) {
        question = examPacket.content_bank[matchingKey];
      }
    }

    if (!question) {
      // Question not found in content bank, skip
      console.warn(`Question ${questionId} not found in ExamPacket content_bank`);
      continue;
    }

    // Get domain from skill_tag or use default
    // Note: The requirement mentions "domain" tag, but ExamPacket uses "skill_tag"
    // We'll use skill_tag as the domain identifier
    const domain = question.skill_tag || 'Unknown Domain';

    // Initialize domain stats if not exists
    if (!domainStats.has(domain)) {
      domainStats.set(domain, { correct: 0, total: 0 });
    }

    const stats = domainStats.get(domain)!;
    stats.total += 1;

    if (response.isCorrect) {
      stats.correct += 1;
    }
  }

  // Convert to DomainScore array and calculate accuracy
  const domainScores: DomainScore[] = Array.from(domainStats.entries())
    .map(([domain, stats]) => ({
      domain,
      correct: stats.correct,
      total: stats.total,
      accuracy: stats.total > 0 
        ? Math.round((stats.correct / stats.total) * 100 * 100) / 100 // Round to 2 decimal places
        : 0,
    }))
    .sort((a, b) => a.domain.localeCompare(b.domain)); // Sort alphabetically

  return domainScores;
}

/**
 * Get routing information from session state.
 * 
 * Extracts which Module 2 the student was routed to (Hard or Easy).
 * 
 * @param sessionState - Session state object from API
 * @returns Object with routing information, or null if not available
 */
export function getRoutingInfo(sessionState: any): {
  nextModuleId: string;
  isHard: boolean;
  moduleName: string;
} | null {
  // Check for nextModuleId in session state
  const nextModuleId = sessionState?.nextModuleId;
  
  if (!nextModuleId) {
    // Try to extract from response_history routing metadata
    const responseHistory = sessionState?.response_history || [];
    const routingMetadata = responseHistory.find(
      (entry: any) => entry?.type === 'routing_decision'
    );
    
    if (routingMetadata?.next_module_id) {
      const moduleId = routingMetadata.next_module_id;
      const isHard = moduleId === 'rw_module_2_hard';
      return {
        nextModuleId: moduleId,
        isHard,
        moduleName: isHard ? 'Hard' : 'Easy',
      };
    }
    
    return null;
  }

  const isHard = nextModuleId === 'rw_module_2_hard';
  return {
    nextModuleId,
    isHard,
    moduleName: isHard ? 'Hard' : 'Easy',
  };
}

/**
 * Format domain name for display.
 * 
 * Converts technical domain names to user-friendly display names.
 * 
 * @param domain - Raw domain name from skill_tag
 * @returns Formatted domain name for display
 */
export function formatDomainName(domain: string): string {
  // Map common domain names to display names
  const domainMap: Record<string, string> = {
    'Algebra': 'Heart of Algebra',
    'Geometry': 'Problem Solving and Data Analysis',
    'Data Analysis': 'Problem Solving and Data Analysis',
    'Problem Solving': 'Problem Solving and Data Analysis',
    'Advanced Math': 'Advanced Math',
    'Number Operations': 'Heart of Algebra',
    'Reading Comprehension': 'Reading Comprehension',
    'Writing and Language': 'Writing and Language',
  };

  // Check if we have a mapping
  if (domainMap[domain]) {
    return domainMap[domain];
  }

  // If no mapping, return as-is (capitalize first letter of each word)
  return domain
    .split(' ')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(' ');
}
