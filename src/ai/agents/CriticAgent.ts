/**
 * Critic Agent
 * 
 * A pedagogical auditor that reviews the Socratic Tutor's draft responses
 * before they are sent to the user. Ensures the tutor never violates the
 * prime directive of never giving answers.
 */

export interface CriticEvaluation {
  /** Whether the response passes the audit */
  status: 'PASS' | 'FAIL';
  /** Reason for failure (if status is FAIL) */
  reason?: string;
  /** Feedback for the tutor to improve the response (if status is FAIL) */
  feedback?: string;
  /** Confidence score (0-1) */
  confidence?: number;
}

export interface CriticContext {
  /** The tutor's draft response to evaluate */
  draftResponse: string;
  /** The student's question/input */
  studentInput: string;
  /** The current question/problem being discussed */
  currentQuestion?: string;
  /** Reference material from RAG (for fact-checking) */
  referenceMaterial?: Array<{
    content: string;
    source?: string;
    concept?: string;
  }>;
  /** The correct answer (for checking if it's revealed) */
  correctAnswer?: string | number;
  /** Concept being discussed */
  concept?: string;
}

/**
 * Critic Agent System Prompt
 */
const CRITIC_SYSTEM_PROMPT = `You are a pedagogical auditor. Your ONLY job is to evaluate the Socratic Tutor's response and FAIL it if it violates pedagogical principles.

CRITICAL FAILURE CONDITIONS (any of these = FAIL):
1. **Answer Revelation**: The response reveals the answer directly or indirectly
   - Contains the numerical answer
   - Confirms or denies if a student's answer is correct
   - Shows the final result of a calculation
   - Gives away the solution through examples

2. **Key Step Revelation**: The response gives away the key step without forcing the student to think
   - Shows the specific formula or method to use
   - Provides step-by-step instructions that lead directly to the answer
   - Tells the student exactly what operation to perform
   - Reveals the approach without asking the student to discover it

3. **Factual Hallucination**: The response contains incorrect information
   - States facts that contradict the provided reference material
   - Makes claims that cannot be verified against the context
   - Provides incorrect definitions or formulas
   - Misrepresents concepts from the reference material

EVALUATION PROCESS:
1. Check for answer revelation (scan for numbers, confirmations, solutions)
2. Check for key step revelation (look for direct instructions, formulas, methods)
3. Verify facts against reference material (if provided)
4. Determine if the response guides discovery or provides shortcuts

OUTPUT FORMAT:
- If PASS: { "status": "PASS" }
- If FAIL: { "status": "FAIL", "reason": "Brief reason", "feedback": "Specific guidance for improvement" }

The feedback should be actionable and help the tutor rewrite the response to be more guiding and less revealing.`;

/**
 * Build the critic evaluation prompt
 */
function buildCriticPrompt(context: CriticContext): string {
  const parts: string[] = [];

  parts.push(CRITIC_SYSTEM_PROMPT);
  parts.push('');

  parts.push('## TUTOR DRAFT RESPONSE TO EVALUATE:');
  parts.push(context.draftResponse);
  parts.push('');

  parts.push('## STUDENT INPUT:');
  parts.push(context.studentInput);
  parts.push('');

  if (context.currentQuestion) {
    parts.push('## CURRENT QUESTION:');
    parts.push(context.currentQuestion);
    parts.push('');
  }

  if (context.referenceMaterial && context.referenceMaterial.length > 0) {
    parts.push('## REFERENCE MATERIAL (for fact-checking):');
    context.referenceMaterial.forEach((ref, idx) => {
      parts.push(`\n[Reference ${idx + 1}]`);
      if (ref.concept) {
        parts.push(`Concept: ${ref.concept}`);
      }
      if (ref.source) {
        parts.push(`Source: ${ref.source}`);
      }
      parts.push(`Content: ${ref.content}`);
      parts.push('');
    });
    parts.push('Use this reference material to verify factual claims in the tutor response.');
    parts.push('');
  }

  if (context.correctAnswer !== undefined) {
    parts.push('## CORRECT ANSWER (for checking if revealed):');
    parts.push(`The correct answer is: ${context.correctAnswer}`);
    parts.push('FAIL if the tutor response reveals this answer in any way.');
    parts.push('');
  }

  if (context.concept) {
    parts.push('## CONCEPT:');
    parts.push(context.concept);
    parts.push('');
  }

  parts.push('## YOUR EVALUATION:');
  parts.push('Evaluate the tutor response and return JSON in the format:');
  parts.push('- { "status": "PASS" } if the response is pedagogically sound');
  parts.push('- { "status": "FAIL", "reason": "...", "feedback": "..." } if it violates any rule');
  parts.push('');
  parts.push('Return ONLY valid JSON, no additional text.');

  return parts.join('\n');
}

/**
 * Parse critic evaluation from LLM response
 */
function parseCriticResponse(response: string): CriticEvaluation {
  try {
    // Try to extract JSON from response
    const jsonMatch = response.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      
      if (parsed.status === 'PASS') {
        return {
          status: 'PASS',
          confidence: parsed.confidence || 0.9,
        };
      } else if (parsed.status === 'FAIL') {
        return {
          status: 'FAIL',
          reason: parsed.reason || 'Response violates pedagogical principles',
          feedback: parsed.feedback || 'Rewrite to be more guiding and less revealing',
          confidence: parsed.confidence || 0.8,
        };
      }
    }
  } catch (e) {
    console.warn('[CriticAgent] Failed to parse response, defaulting to FAIL:', e);
  }

  // Default to FAIL if parsing fails (fail-safe)
  return {
    status: 'FAIL',
    reason: 'Could not parse evaluation response',
    feedback: 'Ensure the response follows Socratic method principles',
    confidence: 0.5,
  };
}

/**
 * Check for answer revelation using pattern matching
 */
function checkAnswerRevelation(
  response: string,
  correctAnswer?: string | number
): { detected: boolean; reason?: string } {
  if (correctAnswer !== undefined) {
    const answerStr = String(correctAnswer);
    
    // Check if answer appears in response (but allow in questions)
    if (response.includes(answerStr)) {
      // Allow if it's in a question format
      const questionPattern = /(is|are|does|do|can|will|what|how|why).*\?/i;
      if (!questionPattern.test(response)) {
        return {
          detected: true,
          reason: `Response contains the answer: ${answerStr}`,
        };
      }
    }
  }

  // Check for answer-giving patterns
  const answerPatterns = [
    /the answer is/i,
    /the solution is/i,
    /you should get/i,
    /equals to/i,
    /which is/i,
    /result is/i,
    /the correct answer/i,
    /that's correct/i,
    /you're right/i,
    /exactly right/i,
  ];

  for (const pattern of answerPatterns) {
    if (pattern.test(response)) {
      return {
        detected: true,
        reason: 'Response contains answer-giving language',
      };
    }
  }

  return { detected: false };
}

/**
 * Check for key step revelation
 */
function checkKeyStepRevelation(response: string): { detected: boolean; reason?: string } {
  // Patterns that reveal key steps
  const stepPatterns = [
    /first, (you|we) (need to|should|must)/i,
    /the (formula|equation|method) (is|to use)/i,
    /(you|we) (should|must|need to) (use|apply|calculate)/i,
    /step 1:/i,
    /step 2:/i,
    /here's how/i,
    /let me (show|solve|calculate)/i,
    /the (first|next) step (is|to)/i,
  ];

  for (const pattern of stepPatterns) {
    if (pattern.test(response)) {
      return {
        detected: true,
        reason: 'Response reveals key steps without guiding discovery',
      };
    }
  }

  // Check for too many solution indicators
  const solutionIndicators = [
    /first/i,
    /then/i,
    /finally/i,
    /next/i,
    /now/i,
  ];

  const matches = solutionIndicators.filter(pattern => pattern.test(response));
  if (matches.length >= 3) {
    return {
      detected: true,
      reason: 'Response provides too many sequential instructions',
    };
  }

  return { detected: false };
}

/**
 * Verify facts against reference material
 */
function verifyFacts(
  response: string,
  referenceMaterial?: Array<{ content: string; concept?: string }>
): { detected: boolean; reason?: string } {
  if (!referenceMaterial || referenceMaterial.length === 0) {
    return { detected: false };
  }

  // This is a simplified check - in production, use more sophisticated fact-checking
  // For now, we'll rely on the LLM to do the fact-checking via the prompt
  
  // Simple heuristic: if response makes strong factual claims but reference material
  // doesn't support them, flag it (this is a basic check)
  
  return { detected: false };
}

/**
 * Evaluate tutor response using the Critic Agent
 * 
 * This function can be called with an LLM or use pattern matching as a first pass.
 * 
 * @param context - The context for evaluation
 * @param useLLM - Whether to use LLM for evaluation (default: true)
 * @param llmCall - Optional function to call LLM (if not provided, uses pattern matching only)
 */
export async function evaluateTutorResponse(
  context: CriticContext,
  useLLM: boolean = true,
  llmCall?: (prompt: string, systemPrompt: string) => Promise<string>
): Promise<CriticEvaluation> {
  // First pass: Pattern matching (fast, always runs)
  const answerCheck = checkAnswerRevelation(context.draftResponse, context.correctAnswer);
  if (answerCheck.detected) {
    return {
      status: 'FAIL',
      reason: answerCheck.reason || 'Answer revelation detected',
      feedback: 'Remove any direct or indirect answer references. Ask guiding questions instead.',
      confidence: 0.95,
    };
  }

  const stepCheck = checkKeyStepRevelation(context.draftResponse);
  if (stepCheck.detected) {
    return {
      status: 'FAIL',
      reason: stepCheck.reason || 'Key step revelation detected',
      feedback: 'Avoid revealing specific steps or formulas. Guide the student to discover the approach through questions.',
      confidence: 0.9,
    };
  }

  const factCheck = verifyFacts(context.draftResponse, context.referenceMaterial);
  if (factCheck.detected) {
    return {
      status: 'FAIL',
      reason: factCheck.reason || 'Factual inconsistency detected',
      feedback: 'Verify all factual claims against the reference material. Only use information that is supported by the context.',
      confidence: 0.85,
    };
  }

  // Second pass: LLM evaluation (if enabled and available)
  if (useLLM && llmCall) {
    try {
      const prompt = buildCriticPrompt(context);
      const llmResponse = await llmCall(prompt, CRITIC_SYSTEM_PROMPT);
      const evaluation = parseCriticResponse(llmResponse);

      // If LLM says FAIL, trust it (it's more sophisticated)
      if (evaluation.status === 'FAIL') {
        return evaluation;
      }

      // If LLM says PASS and pattern matching didn't catch anything, PASS
      return evaluation;
    } catch (error) {
      console.error('[CriticAgent] LLM evaluation failed, using pattern matching result:', error);
      // Fall through to pattern matching result
    }
  }

  // If we get here, pattern matching passed and either:
  // - LLM is not enabled, or
  // - LLM evaluation passed, or
  // - LLM evaluation failed but pattern matching passed
  return {
    status: 'PASS',
    confidence: 0.85,
  };
}

/**
 * Quick evaluation (pattern matching only, no LLM)
 * Useful for fast pre-checks before expensive LLM calls
 */
export function quickEvaluate(context: CriticContext): CriticEvaluation {
  const answerCheck = checkAnswerRevelation(context.draftResponse, context.correctAnswer);
  if (answerCheck.detected) {
    return {
      status: 'FAIL',
      reason: answerCheck.reason,
      feedback: 'Remove answer references. Use guiding questions.',
      confidence: 0.95,
    };
  }

  const stepCheck = checkKeyStepRevelation(context.draftResponse);
  if (stepCheck.detected) {
    return {
      status: 'FAIL',
      reason: stepCheck.reason,
      feedback: 'Avoid revealing steps. Guide discovery through questions.',
      confidence: 0.9,
    };
  }

  return {
    status: 'PASS',
    confidence: 0.8,
  };
}
