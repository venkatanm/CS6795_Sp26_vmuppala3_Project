/**
 * Test Suite for Critic Agent
 * 
 * Validates that the Critic correctly identifies violations in tutor responses.
 */

import { evaluateTutorResponse, quickEvaluate, CriticContext } from './CriticAgent';

/**
 * Test Cases: Responses that should FAIL
 */
const FAIL_CASES = [
  {
    name: 'Direct Answer Revelation',
    draftResponse: 'The answer is 4.',
    studentInput: 'What is 2 + 2?',
    correctAnswer: 4,
    expectedReason: 'Answer revelation',
  },
  {
    name: 'Answer Confirmation',
    draftResponse: 'Yes, that\'s correct!',
    studentInput: 'Is the answer 4?',
    correctAnswer: 4,
    expectedReason: 'Answer confirmation',
  },
  {
    name: 'Key Step Revelation',
    draftResponse: 'First, you need to use the quadratic formula: x = (-b ± √(b²-4ac)) / 2a',
    studentInput: 'How do I solve this?',
    expectedReason: 'Key step revelation',
  },
  {
    name: 'Step-by-Step Instructions',
    draftResponse: 'Step 1: Subtract 5 from both sides. Step 2: Divide by 2. Step 3: You get x = 4.',
    studentInput: 'Help me solve 2x + 5 = 13',
    correctAnswer: 4,
    expectedReason: 'Step revelation',
  },
  {
    name: 'Formula Directly Given',
    draftResponse: 'The formula you need is y = mx + b, where m is the slope.',
    studentInput: 'What formula should I use?',
    expectedReason: 'Formula revelation',
  },
];

/**
 * Test Cases: Responses that should PASS
 */
const PASS_CASES = [
  {
    name: 'Guiding Question',
    draftResponse: 'What information do you have in the problem? What are you trying to find?',
    studentInput: 'I don\'t know how to start',
    correctAnswer: 4,
  },
  {
    name: 'Socratic Question',
    draftResponse: 'Let\'s think about this. What operation would help you isolate the variable?',
    studentInput: 'How do I solve for x?',
    correctAnswer: 4,
  },
  {
    name: 'Encouraging Discovery',
    draftResponse: 'You mentioned the slope. What does the slope represent in this context?',
    studentInput: 'I think the slope is 2',
    correctAnswer: 2,
  },
  {
    name: 'Building on Student Knowledge',
    draftResponse: 'Good thinking! Now, if you have the slope, what else do you need to write the equation?',
    studentInput: 'I found the slope',
    correctAnswer: 2,
  },
];

/**
 * Run all tests
 */
export function runCriticTests(): {
  total: number;
  passed: number;
  failed: number;
  results: Array<{ name: string; passed: boolean; message: string }>;
} {
  const results: Array<{ name: string; passed: boolean; message: string }> = [];

  // Test FAIL cases
  console.log('\n=== Testing FAIL Cases ===\n');
  FAIL_CASES.forEach(testCase => {
    const context: CriticContext = {
      draftResponse: testCase.draftResponse,
      studentInput: testCase.studentInput,
      correctAnswer: testCase.correctAnswer,
    };

    const evaluation = quickEvaluate(context);
    const passed = evaluation.status === 'FAIL';
    
    results.push({
      name: `FAIL: ${testCase.name}`,
      passed,
      message: passed
        ? `✓ Correctly identified violation: ${evaluation.reason}`
        : `✗ Should have FAILED but got ${evaluation.status}`,
    });

    console.log(`${passed ? '✓' : '✗'} ${testCase.name}: ${evaluation.status} - ${evaluation.reason || 'N/A'}`);
  });

  // Test PASS cases
  console.log('\n=== Testing PASS Cases ===\n');
  PASS_CASES.forEach(testCase => {
    const context: CriticContext = {
      draftResponse: testCase.draftResponse,
      studentInput: testCase.studentInput,
      correctAnswer: testCase.correctAnswer,
    };

    const evaluation = quickEvaluate(context);
    const passed = evaluation.status === 'PASS';
    
    results.push({
      name: `PASS: ${testCase.name}`,
      passed,
      message: passed
        ? `✓ Correctly passed valid response`
        : `✗ Should have PASSED but got ${evaluation.status}: ${evaluation.reason}`,
    });

    console.log(`${passed ? '✓' : '✗'} ${testCase.name}: ${evaluation.status}`);
  });

  const passed = results.filter(r => r.passed).length;
  const failed = results.filter(r => !r.passed).length;

  return {
    total: results.length,
    passed,
    failed,
    results,
  };
}

/**
 * Test with reference material
 */
export async function testWithReferenceMaterial(): Promise<{
  passed: boolean;
  message: string;
}> {
  const context: CriticContext = {
    draftResponse: 'The slope-intercept form is y = mx + b, where m is the slope and b is the y-intercept.',
    studentInput: 'What is slope-intercept form?',
    referenceMaterial: [
      {
        content: 'In y = mx + b, m is the slope and b is the y-intercept.',
        concept: 'Slope-Intercept Form',
        source: 'Official SAT Study Guide',
      },
    ],
  };

  const evaluation = quickEvaluate(context);
  
  // This should PASS because it matches the reference material
  return {
    passed: evaluation.status === 'PASS',
    message: evaluation.status === 'PASS'
      ? '✓ Correctly verified facts against reference material'
      : `✗ Incorrectly flagged valid fact: ${evaluation.reason}`,
  };
}

// Run tests if executed directly
if (typeof window === 'undefined') {
  const testResults = runCriticTests();
  console.log('\n=== Test Summary ===');
  console.log(`Total: ${testResults.total} | Passed: ${testResults.passed} | Failed: ${testResults.failed}\n`);
}
