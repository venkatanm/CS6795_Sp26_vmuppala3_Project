/**
 * Socratic Tutor System Prompt
 * 
 * This module defines the system prompt for the AI Tutor that uses Socratic questioning
 * to guide students without ever giving direct answers.
 * 
 * The prompt enforces:
 * - Never revealing answers
 * - Using guiding questions
 * - Chain of Thought reasoning
 * - Context-aware responses based on misconceptions and reference material
 */

export interface StudentMisconception {
  /** The concept the student is struggling with */
  concept: string;
  /** The student's incorrect answer or approach */
  wrongAnswer: string;
  /** Description of why this is a misconception */
  description?: string;
}

export interface ReferenceMaterial {
  /** Content from RAG pipeline */
  content: string;
  /** Source of the material */
  source?: string;
  /** Concept this material relates to */
  concept?: string;
}

export interface ConversationTurn {
  /** Role: 'student' or 'tutor' */
  role: 'student' | 'tutor';
  /** The message content */
  content: string;
  /** Timestamp */
  timestamp?: Date;
}

export interface SocraticTutorContext {
  /** The student's misconception (if identified) */
  studentMisconception?: StudentMisconception;
  /** Reference material from RAG pipeline */
  referenceMaterial?: ReferenceMaterial[];
  /** Last 5 conversation turns */
  conversationHistory?: ConversationTurn[];
  /** Current question/problem the student is working on */
  currentQuestion?: string;
  /** Concept being discussed */
  concept?: string;
}

/**
 * The Prime Directive - Core principle that must never be violated
 */
export const PRIME_DIRECTIVE = `You are a Socratic Tutor. Your role is to guide students through discovery, not to solve problems for them.

CRITICAL RULES (NEVER VIOLATE):
1. NEVER give the answer, even if the student explicitly asks for it
2. NEVER show complete solutions or step-by-step calculations
3. NEVER confirm if a student's answer is correct or incorrect directly
4. ALWAYS respond with guiding questions that lead the student to discover the answer
5. If asked "What's the answer?", respond: "I can't give you the answer, but I can help you think through it. What do you think the first step should be?"
6. If asked "Is this correct?", respond: "Let's check your reasoning. Can you explain why you chose that approach?"
7. If asked "Just tell me", respond: "I understand you want the answer, but you'll learn more by working through it. What part are you stuck on?"

TONE GUARDRAILS:
- Never use emojis or casual language
- Be concise: Maximum 3 sentences per turn
- Be professional and supportive, not condescending
- Reference the student's previous mistakes when relevant (e.g., "Remember the issue with commas we saw earlier?")
- Use precise mathematical language
- Acknowledge effort without confirming correctness

Your goal is to help students develop problem-solving skills through guided discovery, not to provide shortcuts.`;

/**
 * Chain of Thought Template
 * Forces the AI to reason through its response before generating it
 */
export const CHAIN_OF_THOUGHT_TEMPLATE = `Before responding, you MUST think through the following (this is hidden from the student):

1. IDENTIFY THE MISCONCEPTION:
   - What specific error is the student making?
   - What knowledge gap does this reveal?
   - What concept do they need to understand better?

2. SELECT REFERENCE MATERIAL:
   - Which reference material is most relevant to address this misconception?
   - What key points from the reference should guide your questions?

3. DESIGN THE GUIDING QUESTION:
   - What question will help the student discover their error?
   - What question will lead them to the correct approach?
   - Is this question too leading (giving away the answer)? If yes, make it more open-ended.

4. CHECK FOR ANSWER LEAKAGE:
   - Does your response contain any part of the answer?
   - Does it confirm or deny correctness?
   - Does it show calculations or steps that reveal the solution?
   - If YES to any, rewrite to be more guiding and less revealing.

5. ENSURE SOCRATIC METHOD:
   - Does your question encourage the student to think?
   - Does it build on what they already know?
   - Does it lead them to discover rather than memorize?

ONLY AFTER completing this chain of thought should you generate your response to the student.`;

/**
 * Few-Shot Examples: Perfect Socratic Interactions
 * These examples demonstrate the ideal tutor voice and approach
 */
export const FEW_SHOT_EXAMPLES = `
## FEW-SHOT EXAMPLES: Perfect Socratic Interactions

Study these examples to understand the ideal tutor voice and approach:

### Example 1: Student asks for answer directly
STUDENT: "What's the answer to this problem?"
TUTOR: "I can't give you the answer, but I can help you think through it. What information does the problem give you, and what are you trying to find?"

### Example 2: Student makes a mistake with slope
STUDENT: "I think the slope is 3" (for y = 2x + 3)
TUTOR: "Let's look at choice B. In the form y = mx + b, what does each part represent? What does the 'm' stand for, and what does the 'b' stand for?"

### Example 3: Student struggles with quadratic formula
STUDENT: "I don't know how to solve this quadratic equation."
TUTOR: "What form is this equation in? If you had an equation like x² = 9, how would you solve it?"

### Example 4: Student asks if answer is correct
STUDENT: "Is 5 the answer?"
TUTOR: "Let's check your reasoning. Can you walk me through the steps you took to get 5?"

### Example 5: Student confused about negative slope
STUDENT: "I got -2 for the slope, but that doesn't make sense."
TUTOR: "If the slope is negative, what does that tell us about the line's direction? Does a negative slope mean the line goes up or down as we move to the right?"

### Example 6: Student struggles with system of equations
STUDENT: "I don't know where to start with these two equations."
TUTOR: "What do both equations have in common? If you could eliminate one variable, what would that help you do?"

### Example 7: Student makes calculation error
STUDENT: "I multiplied 3 × 4 and got 11."
TUTOR: "Let's check that calculation. What's another way you could verify 3 × 4? Can you think of it as repeated addition?"

### Example 8: Student asks for formula
STUDENT: "What formula should I use?"
TUTOR: "What information do you have? What are you trying to find? That will help us identify which relationship applies here."

### Example 9: Student references previous mistake
STUDENT: "I'm making the same mistake again."
TUTOR: "Remember the issue with commas we saw earlier? What pattern did we notice then that might apply here?"

### Example 10: Student is stuck
STUDENT: "I'm completely stuck."
TUTOR: "What part of the problem do you understand? Start with what you know, and we'll build from there."

BAD EXAMPLES (NEVER DO THIS):
❌ "No, that's wrong. Try A."
❌ "The answer is 4."
❌ "Yes, that's correct!"
❌ "Here's how you solve it: Step 1..."
❌ "Great job! 😊"
❌ "You should use the quadratic formula: x = (-b ± √(b²-4ac)) / 2a"

GOOD EXAMPLES (ALWAYS DO THIS):
✅ "Let's look at choice B. If the slope is negative, what does that tell us about the line's direction?"
✅ "What information does the problem give you? What are you trying to find?"
✅ "Can you explain why you chose that approach?"
✅ "Remember the issue with commas we saw earlier? What pattern did we notice?"
`;

/**
 * Main System Prompt Template
 * Combines all components into the final prompt
 */
export function buildSocraticTutorPrompt(context: SocraticTutorContext): string {
  const parts: string[] = [];

  // Prime Directive
  parts.push(PRIME_DIRECTIVE);
  parts.push('');
  
  // Few-Shot Examples
  parts.push(FEW_SHOT_EXAMPLES);
  parts.push('');

  // Chain of Thought Requirement
  parts.push('## THINKING PROCESS (Hidden from Student)');
  parts.push(CHAIN_OF_THOUGHT_TEMPLATE);
  parts.push('');

  // Context: Student Misconception
  if (context.studentMisconception) {
    parts.push('## STUDENT MISCONCEPTION');
    parts.push(`The student is struggling with: ${context.studentMisconception.concept}`);
    parts.push(`Their incorrect approach/answer: ${context.studentMisconception.wrongAnswer}`);
    if (context.studentMisconception.description) {
      parts.push(`Why this is a misconception: ${context.studentMisconception.description}`);
    }
    parts.push('');
    parts.push('Your task: Design questions that help them identify and correct this misconception WITHOUT revealing the correct answer.');
    parts.push('');
  }

  // Context: Reference Material
  if (context.referenceMaterial && context.referenceMaterial.length > 0) {
    parts.push('## REFERENCE MATERIAL (Use to Guide Your Questions)');
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
    parts.push('Use this material to inform your guiding questions, but DO NOT quote it directly or reveal information that gives away the answer.');
    parts.push('');
  }

  // Context: Current Question
  if (context.currentQuestion) {
    parts.push('## CURRENT QUESTION');
    parts.push(context.currentQuestion);
    parts.push('');
    parts.push('Remember: You cannot solve this for the student. Guide them through understanding what the question is asking and how to approach it.');
    parts.push('');
  }

  // Context: Conversation History
  if (context.conversationHistory && context.conversationHistory.length > 0) {
    parts.push('## CONVERSATION HISTORY (Last 5 Turns)');
    const recentHistory = context.conversationHistory.slice(-5);
    recentHistory.forEach((turn, idx) => {
      parts.push(`${turn.role.toUpperCase()}: ${turn.content}`);
    });
    parts.push('');
    parts.push('Build on this conversation. If the student is repeating questions, acknowledge their frustration but continue guiding rather than giving answers.');
    parts.push('');
  }

  // Final Instructions
  parts.push('## YOUR RESPONSE');
  parts.push('Generate your response following these steps:');
  parts.push('1. Complete the Chain of Thought process above (hidden)');
  parts.push('2. Check that your response contains NO answers, solutions, or confirmations');
  parts.push('3. Ask 1-2 guiding questions that help the student discover the next step');
  parts.push('4. Be concise: Maximum 3 sentences per turn');
  parts.push('5. Reference previous mistakes if relevant (e.g., "Remember the issue with commas we saw earlier?")');
  parts.push('6. Never use emojis or casual language');
  parts.push('7. Use professional, precise mathematical language');
  parts.push('8. If they ask for the answer, politely refuse and redirect with a question');
  parts.push('');
  parts.push('Remember: A good Socratic tutor helps students think, not think for them. Study the few-shot examples above to match the ideal voice and approach.');

  return parts.join('\n');
}

/**
 * Response Format Template
 * Ensures consistent response structure
 */
export interface TutorResponse {
  /** The actual response to show the student */
  response: string;
  /** Hidden chain of thought (for debugging/validation) */
  chainOfThought?: {
    misconceptionIdentified?: string;
    referenceUsed?: string;
    guidingQuestionRationale?: string;
    answerLeakageCheck?: string;
  };
}

/**
 * Example Usage
 */
export const EXAMPLE_USAGE = `
// Example 1: Student asks for answer directly
const context1: SocraticTutorContext = {
  currentQuestion: "Solve for x: 2x + 5 = 13",
  conversationHistory: [
    { role: 'student', content: 'What\'s the answer?' }
  ]
};

// Example 2: Student has a misconception
const context2: SocraticTutorContext = {
  currentQuestion: "What is the slope of the line y = 2x + 3?",
  studentMisconception: {
    concept: "Slope-Intercept Form",
    wrongAnswer: "3",
    description: "Student confused y-intercept (b) with slope (m)"
  },
  referenceMaterial: [
    {
      content: "In y = mx + b, m is the slope and b is the y-intercept...",
      concept: "Slope-Intercept Form"
    }
  ]
};

// Build the prompt
const prompt = buildSocraticTutorPrompt(context2);
`;

/**
 * Guardrail Validation Functions
 * Used to test that responses don't violate the prime directive
 */
export class GuardrailValidator {
  /**
   * Check if response contains direct answer
   */
  static containsAnswer(response: string, correctAnswer?: string | number): boolean {
    if (correctAnswer) {
      // Check if the response contains the answer
      const answerStr = String(correctAnswer);
      if (response.includes(answerStr)) {
        // But allow it if it's in a question like "Is the answer 5?"
        const questionPattern = /(is|are|does|do|can|will).*\?/i;
        if (!questionPattern.test(response)) {
          return true;
        }
      }
    }

    // Check for common answer-giving patterns
    const answerPatterns = [
      /the answer is/i,
      /the solution is/i,
      /the correct answer/i,
      /you should get/i,
      /equals to/i,
      /which is/i,
      /result is/i,
    ];

    return answerPatterns.some(pattern => pattern.test(response));
  }

  /**
   * Check if response confirms correctness
   */
  static confirmsCorrectness(response: string): boolean {
    const confirmationPatterns = [
      /that's correct/i,
      /you're right/i,
      /exactly right/i,
      /that is correct/i,
      /correct!/i,
      /yes, that's/i,
      /perfect!/i,
    ];

    return confirmationPatterns.some(pattern => pattern.test(response));
  }

  /**
   * Check if response shows step-by-step solution
   */
  static showsSolution(response: string): boolean {
    // Check for numbered steps or solution patterns
    const solutionPatterns = [
      /step 1:/i,
      /first, /i,
      /then, /i,
      /finally, /i,
      /the solution:/i,
      /here's how/i,
      /let me solve/i,
    ];

    // Count how many solution indicators appear
    const matches = solutionPatterns.filter(pattern => pattern.test(response));
    
    // If 3+ solution indicators, likely showing a full solution
    return matches.length >= 3;
  }

  /**
   * Check if response contains guiding questions
   */
  static hasGuidingQuestions(response: string): boolean {
    const questionCount = (response.match(/\?/g) || []).length;
    return questionCount >= 1;
  }

  /**
   * Check if response uses emojis
   */
  static containsEmojis(response: string): boolean {
    // Common emoji patterns
    const emojiPatterns = [
      /[\u{1F300}-\u{1F9FF}]/u, // Emoticons
      /[\u{2600}-\u{26FF}]/u,   // Miscellaneous symbols
      /[\u{2700}-\u{27BF}]/u,   // Dingbats
      /[😀-🙏]/u,                // Emoticons range
      /[👍👎❤️💯]/u,            // Common emojis
    ];

    return emojiPatterns.some(pattern => pattern.test(response));
  }

  /**
   * Check if response is too long (more than 3 sentences)
   */
  static isTooLong(response: string): boolean {
    const sentences = response.split(/[.!?]+/).filter(s => s.trim().length > 0);
    return sentences.length > 3;
  }

  /**
   * Check if response references previous mistakes
   */
  static referencesPreviousMistakes(response: string, conversationHistory?: ConversationTurn[]): boolean {
    if (!conversationHistory || conversationHistory.length < 2) {
      return false;
    }

    const referencePatterns = [
      /remember.*(earlier|before|we saw|we discussed)/i,
      /(earlier|before).*(issue|mistake|error|problem)/i,
      /the.*(issue|mistake|error).*we.*(saw|discussed|noticed)/i,
    ];

    return referencePatterns.some(pattern => pattern.test(response));
  }

  /**
   * Check if response uses casual language
   */
  static usesCasualLanguage(response: string): boolean {
    const casualPatterns = [
      /\b(yeah|yep|nope|nah|dude|bro|omg|lol|haha)\b/i,
      /\b(cool|awesome|sweet|nice|rad)\b/i,
      /(^|\s)(ur|u|r|thru|tho|gonna|wanna)\b/i,
    ];

    return casualPatterns.some(pattern => pattern.test(response));
  }

  /**
   * Validate response against all guardrails
   */
  static validate(
    response: string,
    correctAnswer?: string | number,
    conversationHistory?: ConversationTurn[]
  ): {
    isValid: boolean;
    violations: string[];
    warnings: string[];
  } {
    const violations: string[] = [];
    const warnings: string[] = [];

    if (this.containsAnswer(response, correctAnswer)) {
      violations.push('Response contains direct answer');
    }

    if (this.confirmsCorrectness(response)) {
      violations.push('Response confirms correctness directly');
    }

    if (this.showsSolution(response)) {
      violations.push('Response shows step-by-step solution');
    }

    if (this.containsEmojis(response)) {
      violations.push('Response contains emojis');
    }

    if (this.usesCasualLanguage(response)) {
      violations.push('Response uses casual language');
    }

    if (this.isTooLong(response)) {
      warnings.push('Response exceeds 3 sentences (may be too verbose)');
    }

    if (!this.hasGuidingQuestions(response)) {
      warnings.push('Response may lack guiding questions');
    }

    // Note: referencing previous mistakes is encouraged but not required
    if (conversationHistory && conversationHistory.length >= 2) {
      if (!this.referencesPreviousMistakes(response, conversationHistory)) {
        // Only warn if there were previous mistakes to reference
        const hasPreviousMistakes = conversationHistory.some(turn => 
          turn.role === 'student' && turn.content.toLowerCase().includes('wrong')
        );
        if (hasPreviousMistakes) {
          warnings.push('Response could reference previous mistakes for continuity');
        }
      }
    }

    return {
      isValid: violations.length === 0,
      violations,
      warnings,
    };
  }
}
