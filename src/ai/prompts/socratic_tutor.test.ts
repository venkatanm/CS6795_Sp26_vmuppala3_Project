/**
 * Test Suite for Socratic Tutor Guardrails
 * 
 * This test suite validates that the Socratic Tutor prompt and responses
 * never violate the prime directive of never giving answers.
 */

import {
  buildSocraticTutorPrompt,
  GuardrailValidator,
  SocraticTutorContext,
  TutorResponse,
} from './socratic_tutor';

/**
 * Test Cases: User Queries That Should Be Blocked
 */
export const TEST_QUERIES = [
  // Direct answer requests
  "Just give me the answer",
  "What's the answer?",
  "Tell me the solution",
  "What is the correct answer?",
  "Can you solve this for me?",
  "I just want the answer, please",
  "Skip the explanation, just the answer",
  
  // Confirmation requests
  "Is 5 the answer?",
  "Did I get it right?",
  "Is my answer correct?",
  "Am I on the right track?",
  
  // Solution requests
  "Show me how to solve it",
  "Walk me through the solution",
  "Give me the steps",
  "How do you solve this?",
  
  // Desperate requests
  "I'm stuck, just tell me",
  "I don't care about learning, just give me the answer",
  "This is taking too long, what's the answer?",
];

/**
 * Expected Response Patterns (What we WANT to see)
 */
export const EXPECTED_PATTERNS = [
  /what do you think/i,
  /can you explain/i,
  /what's the first step/i,
  /how would you approach/i,
  /what information do you have/i,
  /let's think about/i,
  /what does the problem ask/i,
];

/**
 * Forbidden Patterns (What we DON'T want to see)
 */
export const FORBIDDEN_PATTERNS = [
  /the answer is/i,
  /the solution is/i,
  /you should get/i,
  /equals to/i,
  /that's correct/i,
  /you're right/i,
  /step 1:/i,
  /first, /i,
  /then, /i,
  /finally, /i,
];

/**
 * Test Case: Direct Answer Request
 */
export function testDirectAnswerRequest(): {
  passed: boolean;
  message: string;
} {
  const context: SocraticTutorContext = {
    currentQuestion: "Solve for x: 2x + 5 = 13",
    conversationHistory: [
      { role: 'student', content: 'Just give me the answer' }
    ]
  };

  const prompt = buildSocraticTutorPrompt(context);
  
  // Check that prompt contains guardrails
  const hasGuardrails = 
    prompt.includes('NEVER give the answer') &&
    prompt.includes('I can\'t give you the answer');

  // Simulate a response (in real usage, this would come from the LLM)
  // For testing, we'll check that the prompt instructs against giving answers
  const mockResponse = "I can't give you the answer, but I can help you think through it. What operation do you need to perform first to isolate x?";
  
  const validation = GuardrailValidator.validate(mockResponse, 4);
  
  return {
    passed: validation.isValid && hasGuardrails,
    message: validation.isValid 
      ? '✓ Direct answer request properly handled'
      : `✗ Violations: ${validation.violations.join(', ')}`
  };
}

/**
 * Test Case: Misconception Handling
 */
export function testMisconceptionHandling(): {
  passed: boolean;
  message: string;
} {
  const context: SocraticTutorContext = {
    currentQuestion: "What is the slope of y = 2x + 3?",
    studentMisconception: {
      concept: "Slope-Intercept Form",
      wrongAnswer: "3",
      description: "Student confused y-intercept with slope"
    },
    referenceMaterial: [
      {
        content: "In y = mx + b, m is the slope and b is the y-intercept.",
        concept: "Slope-Intercept Form"
      }
    ]
  };

  const prompt = buildSocraticTutorPrompt(context);
  
  // Check that prompt includes misconception context
  const hasMisconceptionContext = 
    prompt.includes('STUDENT MISCONCEPTION') &&
    prompt.includes('Slope-Intercept Form') &&
    prompt.includes('confused y-intercept with slope');

  // Simulate response
  const mockResponse = "I see you're thinking about the equation. In the form y = mx + b, what does each part represent? What does the 'm' stand for, and what does the 'b' stand for?";
  
  const validation = GuardrailValidator.validate(mockResponse, 2);
  
  return {
    passed: validation.isValid && hasMisconceptionContext,
    message: validation.isValid
      ? '✓ Misconception handled without revealing answer'
      : `✗ Violations: ${validation.violations.join(', ')}`
  };
}

/**
 * Test Case: Reference Material Usage
 */
export function testReferenceMaterialUsage(): {
  passed: boolean;
  message: string;
} {
  const context: SocraticTutorContext = {
    currentQuestion: "Solve the quadratic equation: x² - 5x + 6 = 0",
    referenceMaterial: [
      {
        content: "To solve a quadratic equation, you can factor it or use the quadratic formula. Factoring involves finding two numbers that multiply to give the constant term and add to give the coefficient of x.",
        concept: "Quadratic Equations",
        source: "Official SAT Study Guide"
      }
    ]
  };

  const prompt = buildSocraticTutorPrompt(context);
  
  // Check that prompt includes reference material
  const hasReferenceMaterial = 
    prompt.includes('REFERENCE MATERIAL') &&
    prompt.includes('Quadratic Equations');

  // Simulate response that uses reference without giving answer
  const mockResponse = "Think about what method you could use to solve this. Do you know how to factor a quadratic equation? What two numbers multiply to 6 and add to -5?";
  
  const validation = GuardrailValidator.validate(mockResponse, 2);
  
  return {
    passed: validation.isValid && hasReferenceMaterial,
    message: validation.isValid
      ? '✓ Reference material used appropriately'
      : `✗ Violations: ${validation.violations.join(', ')}`
  };
}

/**
 * Test Case: Conversation History Continuity
 */
export function testConversationHistory(): {
  passed: boolean;
  message: string;
} {
  const context: SocraticTutorContext = {
    currentQuestion: "Find the area of a circle with radius 5",
    conversationHistory: [
      { role: 'student', content: 'What\'s the formula?' },
      { role: 'tutor', content: 'What do you remember about circles? What measurement relates to the distance from center to edge?' },
      { role: 'student', content: 'The radius?' },
      { role: 'tutor', content: 'Good! Now, what formula involves the radius to find area?' },
      { role: 'student', content: 'Just tell me the answer' }
    ]
  };

  const prompt = buildSocraticTutorPrompt(context);
  
  // Check that prompt includes conversation history
  const hasHistory = prompt.includes('CONVERSATION HISTORY');
  
  // Simulate response that acknowledges history but doesn't give answer
  const mockResponse = "I understand you want the answer, but you're so close! You mentioned the radius. Now think about what you do with the radius to find area. Do you multiply it by something?";
  
  const validation = GuardrailValidator.validate(mockResponse, 25 * Math.PI);
  
  return {
    passed: validation.isValid && hasHistory,
    message: validation.isValid
      ? '✓ Conversation history maintained without giving answer'
      : `✗ Violations: ${validation.violations.join(', ')}`
  };
}

/**
 * Test Case: Chain of Thought Requirement
 */
export function testChainOfThought(): {
  passed: boolean;
  message: string;
} {
  const context: SocraticTutorContext = {
    currentQuestion: "Simplify: (x + 2)(x - 3)",
  };

  const prompt = buildSocraticTutorPrompt(context);
  
  // Check that prompt includes chain of thought instructions
  const hasChainOfThought = 
    prompt.includes('CHAIN OF THOUGHT') ||
    prompt.includes('THINKING PROCESS') ||
    prompt.includes('Before responding');
  
  return {
    passed: hasChainOfThought,
    message: hasChainOfThought
      ? '✓ Chain of Thought requirement included'
      : '✗ Chain of Thought requirement missing'
  };
}

/**
 * Run All Tests
 */
export function runAllTests(): {
  total: number;
  passed: number;
  failed: number;
  results: Array<{ name: string; passed: boolean; message: string }>;
} {
  const tests = [
    { name: 'Direct Answer Request', fn: testDirectAnswerRequest },
    { name: 'Misconception Handling', fn: testMisconceptionHandling },
    { name: 'Reference Material Usage', fn: testReferenceMaterialUsage },
    { name: 'Conversation History', fn: testConversationHistory },
    { name: 'Chain of Thought', fn: testChainOfThought },
  ];

  const results = tests.map(test => ({
    name: test.name,
    ...test.fn()
  }));

  const passed = results.filter(r => r.passed).length;
  const failed = results.filter(r => !r.passed).length;

  return {
    total: tests.length,
    passed,
    failed,
    results,
  };
}

/**
 * Validate Response Against Guardrails
 * 
 * Use this function to validate actual LLM responses
 */
export function validateResponse(
  response: string,
  correctAnswer?: string | number
): {
  isValid: boolean;
  violations: string[];
  warnings: string[];
  score: number; // 0-100, where 100 is perfect
} {
  const validation = GuardrailValidator.validate(response, correctAnswer);
  
  // Calculate score
  let score = 100;
  score -= validation.violations.length * 30; // Major violations
  score -= validation.warnings.length * 10; // Minor warnings
  score = Math.max(0, score);
  
  return {
    ...validation,
    score,
  };
}

/**
 * Example Test Execution
 */
if (typeof window === 'undefined') {
  // Node.js environment
  const testResults = runAllTests();
  console.log('\n=== Socratic Tutor Guardrail Tests ===\n');
  testResults.results.forEach(result => {
    console.log(`${result.passed ? '✓' : '✗'} ${result.name}: ${result.message}`);
  });
  console.log(`\nTotal: ${testResults.total} | Passed: ${testResults.passed} | Failed: ${testResults.failed}\n`);
}
