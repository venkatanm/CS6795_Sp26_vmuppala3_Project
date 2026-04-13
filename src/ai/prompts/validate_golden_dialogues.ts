/**
 * Validate Golden Dialogues
 * 
 * Tests that the golden dialogues meet all Socratic Tutor quality standards.
 */

// For browser/TypeScript environments, import JSON directly
// For Node.js, use require or fs.readFileSync
let goldenDialogues: any;

try {
  // Try dynamic import (works in modern environments)
  goldenDialogues = require('./golden_dialogues.json');
} catch (e) {
  // Fallback: define inline or load differently
  console.warn('Could not load golden_dialogues.json, using empty structure');
  goldenDialogues = { dialogues: [], antiPatterns: [] };
}
import { GuardrailValidator, ConversationTurn } from './socratic_tutor';

interface Dialogue {
  id: string;
  scenario: string;
  concept: string;
  question: string;
  correctAnswer: any;
  studentAnswer?: any;
  turns: Array<{
    role: 'student' | 'tutor';
    content: string;
    quality?: string;
    notes?: string;
  }>;
}

/**
 * Validate a single dialogue
 */
function validateDialogue(dialogue: Dialogue): {
  passed: boolean;
  violations: Array<{ turn: number; violations: string[]; warnings: string[] }>;
} {
  const violations: Array<{ turn: number; violations: string[]; warnings: string[] }> = [];

  dialogue.turns.forEach((turn, idx) => {
    if (turn.role === 'tutor') {
      // Build conversation history up to this point
      const history: ConversationTurn[] = dialogue.turns
        .slice(0, idx)
        .map(t => ({
          role: t.role,
          content: t.content,
        }));

      const validation = GuardrailValidator.validate(
        turn.content,
        dialogue.correctAnswer,
        history
      );

      if (!validation.isValid || validation.warnings.length > 0) {
        violations.push({
          turn: idx,
          violations: validation.violations,
          warnings: validation.warnings,
        });
      }
    }
  });

  return {
    passed: violations.length === 0,
    violations,
  };
}

/**
 * Validate all golden dialogues
 */
export function validateAllGoldenDialogues(): {
  total: number;
  passed: number;
  failed: number;
  results: Array<{
    dialogueId: string;
    scenario: string;
    passed: boolean;
    violations: Array<{ turn: number; violations: string[]; warnings: string[] }>;
  }>;
} {
  const dialogues = goldenDialogues.dialogues as Dialogue[];
  const results = dialogues.map(dialogue => {
    const validation = validateDialogue(dialogue);
    return {
      dialogueId: dialogue.id,
      scenario: dialogue.scenario,
      passed: validation.passed,
      violations: validation.violations,
    };
  });

  const passed = results.filter(r => r.passed).length;
  const failed = results.filter(r => !r.passed).length;

  return {
    total: dialogues.length,
    passed,
    failed,
    results,
  };
}

/**
 * Test against anti-patterns
 */
export function testAntiPatterns(): {
  passed: boolean;
  message: string;
} {
  const antiPatterns = goldenDialogues.antiPatterns[0].badExamples;

  let allPassed = true;
  const failures: string[] = [];

  antiPatterns.forEach((example, idx) => {
    const validation = GuardrailValidator.validate(example.badTutor);
    
    if (validation.isValid) {
      allPassed = false;
      failures.push(`Anti-pattern ${idx + 1}: Bad example passed validation (should have failed)`);
    }

    const goodValidation = GuardrailValidator.validate(example.goodTutor);
    if (!goodValidation.isValid) {
      allPassed = false;
      failures.push(`Anti-pattern ${idx + 1}: Good example failed validation (should have passed)`);
    }
  });

  return {
    passed: allPassed,
    message: allPassed
      ? '✓ All anti-patterns correctly identified'
      : `✗ Failures: ${failures.join('; ')}`,
  };
}

/**
 * Run all validations
 */
export function runAllValidations(): {
  dialogues: ReturnType<typeof validateAllGoldenDialogues>;
  antiPatterns: ReturnType<typeof testAntiPatterns>;
} {
  return {
    dialogues: validateAllGoldenDialogues(),
    antiPatterns: testAntiPatterns(),
  };
}

// Run if executed directly
if (typeof window === 'undefined') {
  const results = runAllValidations();
  
  console.log('\n=== Golden Dialogues Validation ===\n');
  console.log(`Dialogues: ${results.dialogues.passed}/${results.dialogues.total} passed`);
  results.dialogues.results.forEach(result => {
    if (!result.passed) {
      console.log(`✗ ${result.dialogueId} (${result.scenario}): ${result.violations.length} violations`);
    }
  });
  
  console.log(`\n${results.antiPatterns.message}\n`);
}
