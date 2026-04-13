/**
 * Curriculum Architect Agent
 * 
 * Analyzes student session logs and knowledge graph mastery state to make
 * curriculum decisions about unlocking/locking concepts and scheduling reviews.
 */

export interface SessionLog {
  /** Question/item ID */
  itemId: string;
  /** Concept(s) tested by this question */
  concepts: string[];
  /** Whether the answer was correct */
  isCorrect: boolean;
  /** Time spent on question (seconds) */
  timeSpent: number;
  /** Student's answer */
  studentAnswer?: string | number;
  /** Correct answer */
  correctAnswer?: string | number;
  /** Timestamp */
  timestamp: number;
}

export interface ConceptMasteryState {
  /** Concept ID */
  conceptId: string;
  /** Concept name */
  conceptName: string;
  /** Mastery level (0.0 to 1.0) */
  masteryLevel: number;
  /** Status: "locked", "unlocked", "mastered" */
  status: 'locked' | 'unlocked' | 'mastered';
  /** Number of times practiced */
  timesPracticed: number;
  /** Number of times correct */
  timesCorrect: number;
  /** Last practiced timestamp */
  lastPracticedAt?: number;
  /** Next review date (for spaced repetition) */
  nextReviewAt?: number;
}

export interface KnowledgeGraphState {
  /** Map of concept ID to mastery state */
  concepts: Map<string, ConceptMasteryState>;
  /** Prerequisite relationships */
  prerequisites: Array<{ prerequisiteId: string; dependentId: string }>;
}

export interface CurriculumPlan {
  /** Concept IDs to unlock */
  unlock: string[];
  /** Concept IDs to lock */
  lock: string[];
  /** Spaced repetition review queue */
  reviewQueue: Array<{
    conceptId: string;
    conceptName: string;
    reviewDate: string; // ISO date string
    priority: number; // 0.0 to 1.0
    reason: string;
  }>;
  /** Focus area for next session */
  nextSessionFocus?: string;
  /** Reasoning for the plan */
  reasoning?: string;
}

export interface ArchitectContext {
  /** Session logs from last 20 minutes */
  sessionLogs: SessionLog[];
  /** Current knowledge graph mastery state */
  knowledgeGraph: KnowledgeGraphState;
  /** Student's overall performance metrics */
  performanceMetrics?: {
    overallAccuracy: number; // 0.0 to 1.0
    averageTimeSpent: number; // seconds
    totalQuestions: number;
  };
}

/**
 * Architect Agent System Prompt
 */
const ARCHITECT_SYSTEM_PROMPT = `You are a Curriculum Architect Agent. Your role is to analyze student performance and make intelligent decisions about their learning path.

YOUR RESPONSIBILITIES:
1. **Unlock Concepts**: When a student struggles with a concept, unlock its prerequisites so they can build foundational knowledge
2. **Lock Concepts**: When a student is struggling, lock advanced concepts that depend on the struggling concept
3. **Schedule Reviews**: Use spaced repetition to schedule reviews for concepts that need reinforcement
4. **Focus Areas**: Identify the most important area for the next session

DECISION RULES:

**Unlock Logic:**
- If student struggles with Concept X (accuracy < 60%), unlock prerequisites of X
- If student shows mastery (accuracy > 80%, multiple correct), unlock concepts that depend on X
- Never unlock concepts that have unmet prerequisites (check prerequisite chain)

**Lock Logic:**
- If student struggles with Concept X, lock concepts that depend on X
- If student hasn't practiced a prerequisite in 7+ days, consider locking dependent concepts

**Review Queue Logic:**
- Concepts with accuracy < 70% should be reviewed within 3 days
- Concepts with accuracy 70-80% should be reviewed within 7 days
- Concepts with accuracy > 80% but not mastered should be reviewed within 14 days
- Use spaced repetition intervals: 1 day, 3 days, 7 days, 14 days, 30 days

**Next Session Focus:**
- Identify the concept category with the most struggles
- Or the prerequisite that's blocking progress
- Or the area with the highest review priority

OUTPUT FORMAT:
Return a JSON object with this structure:
{
  "unlock": ["concept_id_1", "concept_id_2"],
  "lock": ["concept_id_3"],
  "reviewQueue": [
    {
      "conceptId": "concept_id_4",
      "conceptName": "Linear Equations",
      "reviewDate": "2024-01-04",
      "priority": 0.9,
      "reason": "Struggled with 3 out of 4 questions"
    }
  ],
  "nextSessionFocus": "Grammar Basics",
  "reasoning": "Student struggled with Dangling Modifiers, unlocking Participles prerequisite. Locking Advanced Style until basics are mastered."
}

Return ONLY valid JSON, no additional text.`;

/**
 * Build the architect prompt from context
 */
function buildArchitectPrompt(context: ArchitectContext): string {
  const parts: string[] = [];

  parts.push(ARCHITECT_SYSTEM_PROMPT);
  parts.push('');

  parts.push('## SESSION LOGS (Last 20 minutes):');
  if (context.sessionLogs.length === 0) {
    parts.push('No recent session activity.');
  } else {
    context.sessionLogs.forEach((log, idx) => {
      parts.push(`\n[Question ${idx + 1}]`);
      parts.push(`Concepts: ${log.concepts.join(', ')}`);
      parts.push(`Correct: ${log.isCorrect ? 'Yes' : 'No'}`);
      parts.push(`Time Spent: ${log.timeSpent}s`);
      if (log.studentAnswer !== undefined) {
        parts.push(`Student Answer: ${log.studentAnswer}`);
      }
    });
  }
  parts.push('');

  parts.push('## KNOWLEDGE GRAPH MASTERY STATE:');
  const concepts = Array.from(context.knowledgeGraph.concepts.values());
  if (concepts.length === 0) {
    parts.push('No mastery data available.');
  } else {
    concepts.forEach(concept => {
      parts.push(`\n[${concept.conceptName}] (ID: ${concept.conceptId})`);
      parts.push(`Status: ${concept.status}`);
      parts.push(`Mastery: ${(concept.masteryLevel * 100).toFixed(1)}%`);
      parts.push(`Practiced: ${concept.timesPracticed} times (${concept.timesCorrect} correct)`);
      if (concept.lastPracticedAt) {
        parts.push(`Last Practiced: ${new Date(concept.lastPracticedAt).toISOString()}`);
      }
      if (concept.nextReviewAt) {
        parts.push(`Next Review: ${new Date(concept.nextReviewAt).toISOString()}`);
      }
    });
  }
  parts.push('');

  parts.push('## PREREQUISITE RELATIONSHIPS:');
  if (context.knowledgeGraph.prerequisites.length === 0) {
    parts.push('No prerequisite relationships defined.');
  } else {
    context.knowledgeGraph.prerequisites.forEach(prereq => {
      const prereqConcept = concepts.find(c => c.conceptId === prereq.prerequisiteId);
      const dependentConcept = concepts.find(c => c.conceptId === prereq.dependentId);
      if (prereqConcept && dependentConcept) {
        parts.push(`${prereqConcept.conceptName} → ${dependentConcept.conceptName}`);
      }
    });
  }
  parts.push('');

  if (context.performanceMetrics) {
    parts.push('## PERFORMANCE METRICS:');
    parts.push(`Overall Accuracy: ${(context.performanceMetrics.overallAccuracy * 100).toFixed(1)}%`);
    parts.push(`Average Time: ${context.performanceMetrics.averageTimeSpent.toFixed(1)}s`);
    parts.push(`Total Questions: ${context.performanceMetrics.totalQuestions}`);
    parts.push('');
  }

  parts.push('## YOUR TASK:');
  parts.push('Analyze the session logs and mastery state. Generate a curriculum plan that:');
  parts.push('1. Unlocks prerequisites for struggling concepts');
  parts.push('2. Locks advanced concepts that depend on struggling areas');
  parts.push('3. Schedules spaced repetition reviews');
  parts.push('4. Identifies next session focus');
  parts.push('');
  parts.push('Return your plan as JSON following the format specified above.');

  return parts.join('\n');
}

/**
 * Parse architect response from LLM
 */
function parseArchitectResponse(response: string): CurriculumPlan {
  try {
    // Try to extract JSON from response
    const jsonMatch = response.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      
      return {
        unlock: parsed.unlock || [],
        lock: parsed.lock || [],
        reviewQueue: parsed.reviewQueue || [],
        nextSessionFocus: parsed.nextSessionFocus,
        reasoning: parsed.reasoning,
      };
    }
  } catch (e) {
    console.warn('[ArchitectAgent] Failed to parse response:', e);
  }

  // Default empty plan if parsing fails
  return {
    unlock: [],
    lock: [],
    reviewQueue: [],
  };
}

/**
 * Calculate next review date based on accuracy and mastery status
 * 
 * Spaced repetition intervals:
 * - < 70% accuracy: 3 days
 * - 70-80% accuracy: 7 days
 * - > 80% accuracy (not mastered): 14 days
 * - Mastered: 30 days
 * 
 * @param accuracy - Student's accuracy on this concept (0.0 to 1.0)
 * @param isMastered - Whether the concept is mastered
 * @returns Date object for the next review
 */
function calculateNextReviewDate(accuracy: number, isMastered: boolean): Date {
  const reviewDate = new Date();
  let daysToAdd: number;

  if (isMastered) {
    // Mastered: Review in 30 days
    daysToAdd = 30;
  } else if (accuracy < 0.70) {
    // < 70% accuracy: Review in 3 days
    daysToAdd = 3;
  } else if (accuracy >= 0.70 && accuracy <= 0.80) {
    // 70-80% accuracy: Review in 7 days
    daysToAdd = 7;
  } else {
    // > 80% accuracy (not mastered): Review in 14 days
    daysToAdd = 14;
  }

  reviewDate.setDate(reviewDate.getDate() + daysToAdd);
  return reviewDate;
}

/**
 * Analyze session logs to identify struggling concepts
 */
function identifyStrugglingConcepts(
  sessionLogs: SessionLog[],
  threshold: number = 0.6
): Map<string, { correct: number; total: number; accuracy: number }> {
  const conceptStats = new Map<string, { correct: number; total: number }>();

  sessionLogs.forEach(log => {
    log.concepts.forEach(concept => {
      const stats = conceptStats.get(concept) || { correct: 0, total: 0 };
      stats.total++;
      if (log.isCorrect) {
        stats.correct++;
      }
      conceptStats.set(concept, stats);
    });
  });

  const struggling = new Map<string, { correct: number; total: number; accuracy: number }>();
  conceptStats.forEach((stats, concept) => {
    const accuracy = stats.total > 0 ? stats.correct / stats.total : 0;
    if (accuracy < threshold && stats.total >= 2) {
      struggling.set(concept, { ...stats, accuracy });
    }
  });

  return struggling;
}

/**
 * Generate curriculum plan using rule-based logic (fallback)
 */
function generateRuleBasedPlan(context: ArchitectContext): CurriculumPlan {
  const plan: CurriculumPlan = {
    unlock: [],
    lock: [],
    reviewQueue: [],
  };

  // Identify struggling concepts
  const struggling = identifyStrugglingConcepts(context.sessionLogs, 0.6);
  
  // For each struggling concept, unlock its prerequisites
  struggling.forEach((stats, conceptName) => {
    // Find concept ID
    const concept = Array.from(context.knowledgeGraph.concepts.values())
      .find(c => c.conceptName === conceptName);
    
    if (concept && concept.status === 'locked') {
      // Find prerequisites
      const prerequisites = context.knowledgeGraph.prerequisites
        .filter(p => {
          const dependent = context.knowledgeGraph.concepts.get(p.dependentId);
          return dependent?.conceptName === conceptName;
        })
        .map(p => p.prerequisiteId);
      
      prerequisites.forEach(prereqId => {
        const prereq = context.knowledgeGraph.concepts.get(prereqId);
        if (prereq && prereq.status === 'locked') {
          plan.unlock.push(prereqId);
        }
      });
    }

    // Add to review queue with spaced repetition intervals
    const isMastered = concept?.status === 'mastered';
    const reviewDate = calculateNextReviewDate(stats.accuracy, isMastered);
    
    plan.reviewQueue.push({
      conceptId: concept?.conceptId || '',
      conceptName: conceptName,
      reviewDate: reviewDate.toISOString().split('T')[0],
      priority: 1.0 - stats.accuracy, // Higher priority for lower accuracy
      reason: `Struggled with ${stats.correct}/${stats.total} questions (${(stats.accuracy * 100).toFixed(0)}% accuracy)`,
    });
  });

  // Lock concepts that depend on struggling concepts
  struggling.forEach((stats, conceptName) => {
    const concept = Array.from(context.knowledgeGraph.concepts.values())
      .find(c => c.conceptName === conceptName);
    
    if (concept) {
      const dependents = context.knowledgeGraph.prerequisites
        .filter(p => p.prerequisiteId === concept.conceptId)
        .map(p => p.dependentId);
      
      dependents.forEach(dependentId => {
        const dependent = context.knowledgeGraph.concepts.get(dependentId);
        if (dependent && dependent.status === 'unlocked' && dependent.masteryLevel < 0.8) {
          plan.lock.push(dependentId);
        }
      });
    }
  });

  // Set next session focus
  if (struggling.size > 0) {
    const topStruggle = Array.from(struggling.entries())
      .sort((a, b) => a[1].accuracy - b[1].accuracy)[0];
    plan.nextSessionFocus = topStruggle[0];
  }

  return plan;
}

/**
 * Generate curriculum plan using Architect Agent
 * 
 * @param context - The architect context with session logs and knowledge graph
 * @param useLLM - Whether to use LLM (default: true)
 * @param llmCall - Optional function to call LLM
 */
export async function generateCurriculumPlan(
  context: ArchitectContext,
  useLLM: boolean = true,
  llmCall?: (prompt: string, systemPrompt: string) => Promise<string>
): Promise<CurriculumPlan> {
  // First, generate rule-based plan as fallback
  const ruleBasedPlan = generateRuleBasedPlan(context);

  // If LLM is available, use it for more sophisticated planning
  if (useLLM && llmCall) {
    try {
      const prompt = buildArchitectPrompt(context);
      const llmResponse = await llmCall(prompt, ARCHITECT_SYSTEM_PROMPT);
      const llmPlan = parseArchitectResponse(llmResponse);

      // Merge LLM plan with rule-based plan (LLM takes precedence)
      return {
        unlock: [...new Set([...llmPlan.unlock, ...ruleBasedPlan.unlock])],
        lock: [...new Set([...llmPlan.lock, ...ruleBasedPlan.lock])],
        reviewQueue: [...llmPlan.reviewQueue, ...ruleBasedPlan.reviewQueue],
        nextSessionFocus: llmPlan.nextSessionFocus || ruleBasedPlan.nextSessionFocus,
        reasoning: llmPlan.reasoning || ruleBasedPlan.reasoning,
      };
    } catch (error) {
      console.error('[ArchitectAgent] LLM call failed, using rule-based plan:', error);
      return ruleBasedPlan;
    }
  }

  return ruleBasedPlan;
}

/**
 * Quick plan generation (rule-based only, no LLM)
 */
export function quickGeneratePlan(context: ArchitectContext): CurriculumPlan {
  return generateRuleBasedPlan(context);
}
