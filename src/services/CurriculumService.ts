/**
 * Curriculum Service
 * 
 * Manages student learning paths, concept mastery, and curriculum updates.
 * Integrates with the Architect Agent to make intelligent curriculum decisions.
 */

import { generateCurriculumPlan, ArchitectContext, SessionLog, KnowledgeGraphState, ConceptMasteryState, CurriculumPlan } from '../ai/agents/ArchitectAgent';

export interface StudentProfile {
  userId: string;
  tenantId: string;
  conceptMastery: Record<string, {
    mastery: number;
    status: 'locked' | 'unlocked' | 'mastered';
    lastPracticed?: string;
  }>;
  unlockedConcepts: string[];
  lockedConcepts: string[];
  reviewQueue: Array<{
    conceptId: string;
    conceptName: string;
    reviewDate: string;
    priority: number;
    reason?: string;
  }>;
  nextSessionFocus?: string;
  totalSessions: number;
  lastSessionAt?: string;
}

export interface SessionAnalysis {
  /** Session ID */
  sessionId: string;
  /** User ID */
  userId: string;
  /** Session start time */
  startTime: number;
  /** Session end time */
  endTime?: number;
  /** Response history from session */
  responseHistory: Array<{
    item_id: string;
    selected_option?: number;
    correct_answer?: number;
    is_correct?: boolean;
    time_spent?: number;
    timestamp?: number;
  }>;
}

/**
 * Convert session analysis to session logs
 */
async function convertToSessionLogs(
  analysis: SessionAnalysis,
  getConceptsForItem: (itemId: string) => Promise<string[]>
): Promise<SessionLog[]> {
  const logs: SessionLog[] = [];

  for (const response of analysis.responseHistory) {
    const concepts = await getConceptsForItem(response.item_id);
    
    logs.push({
      itemId: response.item_id,
      concepts,
      isCorrect: response.is_correct || false,
      timeSpent: response.time_spent || 0,
      studentAnswer: response.selected_option,
      correctAnswer: response.correct_answer,
      timestamp: response.timestamp || Date.now(),
    });
  }

  return logs;
}

/**
 * Build knowledge graph state from student profile and concept data
 */
function buildKnowledgeGraphState(
  profile: StudentProfile,
  allConcepts: Array<{ id: string; name: string }>,
  prerequisites: Array<{ prerequisiteId: string; dependentId: string }>
): KnowledgeGraphState {
  const concepts = new Map<string, ConceptMasteryState>();

  allConcepts.forEach(concept => {
    const mastery = profile.conceptMastery[concept.id] || {
      mastery: 0.0,
      status: 'locked' as const,
    };

    concepts.set(concept.id, {
      conceptId: concept.id,
      conceptName: concept.name,
      masteryLevel: mastery.mastery,
      status: mastery.status,
      timesPracticed: 0, // Would need to track this separately
      timesCorrect: 0, // Would need to track this separately
      lastPracticedAt: mastery.lastPracticed ? new Date(mastery.lastPracticed).getTime() : undefined,
    });
  });

  return {
    concepts,
    prerequisites,
  };
}

/**
 * Calculate performance metrics from session logs
 */
function calculatePerformanceMetrics(logs: SessionLog[]): {
  overallAccuracy: number;
  averageTimeSpent: number;
  totalQuestions: number;
} {
  if (logs.length === 0) {
    return {
      overallAccuracy: 0,
      averageTimeSpent: 0,
      totalQuestions: 0,
    };
  }

  const correct = logs.filter(log => log.isCorrect).length;
  const totalTime = logs.reduce((sum, log) => sum + log.timeSpent, 0);

  return {
    overallAccuracy: correct / logs.length,
    averageTimeSpent: totalTime / logs.length,
    totalQuestions: logs.length,
  };
}

/**
 * Update student profile with curriculum plan
 */
function updateProfileWithPlan(
  profile: StudentProfile,
  plan: CurriculumPlan,
  allConcepts: Array<{ id: string; name: string }>
): StudentProfile {
  const updated = { ...profile };

  // Update unlocked concepts
  plan.unlock.forEach(conceptId => {
    if (!updated.unlockedConcepts.includes(conceptId)) {
      updated.unlockedConcepts.push(conceptId);
    }
    // Remove from locked if present
    updated.lockedConcepts = updated.lockedConcepts.filter(id => id !== conceptId);
    
    // Update mastery status
    if (!updated.conceptMastery[conceptId]) {
      updated.conceptMastery[conceptId] = {
        mastery: 0.0,
        status: 'unlocked',
      };
    } else {
      updated.conceptMastery[conceptId].status = 'unlocked';
    }
  });

  // Update locked concepts
  plan.lock.forEach(conceptId => {
    if (!updated.lockedConcepts.includes(conceptId)) {
      updated.lockedConcepts.push(conceptId);
    }
    // Remove from unlocked if present
    updated.unlockedConcepts = updated.unlockedConcepts.filter(id => id !== conceptId);
    
    // Update mastery status
    if (updated.conceptMastery[conceptId]) {
      updated.conceptMastery[conceptId].status = 'locked';
    }
  });

  // Update review queue (merge with existing, deduplicate by conceptId)
  const existingReviewMap = new Map(
    updated.reviewQueue.map(r => [r.conceptId, r])
  );
  
  plan.reviewQueue.forEach(review => {
    const existing = existingReviewMap.get(review.conceptId);
    if (!existing || review.priority > existing.priority) {
      existingReviewMap.set(review.conceptId, review);
    }
  });
  
  updated.reviewQueue = Array.from(existingReviewMap.values())
    .sort((a, b) => b.priority - a.priority); // Sort by priority

  // Update next session focus
  if (plan.nextSessionFocus) {
    updated.nextSessionFocus = plan.nextSessionFocus;
  }

  // Update session count and timestamp
  updated.totalSessions += 1;
  updated.lastSessionAt = new Date().toISOString();

  return updated;
}

/**
 * Analyze session and update curriculum
 * 
 * This is the main function that:
 * 1. Gets session logs (last 20 minutes)
 * 2. Gets knowledge graph mastery state
 * 3. Calls Architect Agent
 * 4. Updates student profile
 */
export async function analyzeSessionAndUpdateCurriculum(
  analysis: SessionAnalysis,
  profile: StudentProfile,
  options: {
    /** Function to get concepts for an item */
    getConceptsForItem: (itemId: string) => Promise<string[]>;
    /** All available concepts */
    allConcepts: Array<{ id: string; name: string }>;
    /** Prerequisite relationships */
    prerequisites: Array<{ prerequisiteId: string; dependentId: string }>;
    /** Optional LLM call function */
    llmCall?: (prompt: string, systemPrompt: string) => Promise<string>;
    /** Whether to use LLM (default: true) */
    useLLM?: boolean;
  }
): Promise<{
  updatedProfile: StudentProfile;
  plan: CurriculumPlan;
}> {
  // Step 1: Convert session analysis to session logs
  const sessionLogs = await convertToSessionLogs(
    analysis,
    options.getConceptsForItem
  );

  // Filter to last 20 minutes
  const twentyMinutesAgo = Date.now() - 20 * 60 * 1000;
  const recentLogs = sessionLogs.filter(log => log.timestamp >= twentyMinutesAgo);

  // Step 2: Build knowledge graph state
  const knowledgeGraph = buildKnowledgeGraphState(
    profile,
    options.allConcepts,
    options.prerequisites
  );

  // Step 3: Calculate performance metrics
  const performanceMetrics = calculatePerformanceMetrics(recentLogs);

  // Step 4: Build architect context
  const context: ArchitectContext = {
    sessionLogs: recentLogs,
    knowledgeGraph,
    performanceMetrics,
  };

  // Step 5: Generate curriculum plan
  const plan = await generateCurriculumPlan(
    context,
    options.useLLM !== false,
    options.llmCall
  );

  // Step 6: Update profile with plan
  const updatedProfile = updateProfileWithPlan(
    profile,
    plan,
    options.allConcepts
  );

  return {
    updatedProfile,
    plan,
  };
}

/**
 * Get concepts that need review (spaced repetition)
 */
export function getConceptsForReview(profile: StudentProfile): Array<{
  conceptId: string;
  conceptName: string;
  reviewDate: string;
  priority: number;
  reason?: string;
}> {
  const today = new Date().toISOString().split('T')[0];
  
  return profile.reviewQueue
    .filter(review => review.reviewDate <= today)
    .sort((a, b) => b.priority - a.priority);
}

/**
 * Mark concept as reviewed
 */
export function markConceptReviewed(
  profile: StudentProfile,
  conceptId: string
): StudentProfile {
  const updated = { ...profile };
  
  // Remove from review queue
  updated.reviewQueue = updated.reviewQueue.filter(
    review => review.conceptId !== conceptId
  );
  
  // Update last practiced
  if (updated.conceptMastery[conceptId]) {
    updated.conceptMastery[conceptId].lastPracticed = new Date().toISOString();
  }
  
  return updated;
}
