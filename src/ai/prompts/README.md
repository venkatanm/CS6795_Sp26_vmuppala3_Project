# Socratic Tutor System Prompt

This module implements a robust system prompt for an AI Tutor that uses Socratic questioning to guide students without ever giving direct answers.

## Core Principles

### The Prime Directive
> "You are a Socratic Tutor. You guide, you do not solve."

The tutor **NEVER**:
- Gives direct answers
- Shows complete solutions
- Confirms correctness directly
- Provides step-by-step calculations

The tutor **ALWAYS**:
- Asks guiding questions
- Helps students discover answers
- Builds on what students already know
- Encourages critical thinking

## Usage

### Basic Example

```typescript
import { buildSocraticTutorPrompt, SocraticTutorContext } from './socratic_tutor';

const context: SocraticTutorContext = {
  currentQuestion: "Solve for x: 2x + 5 = 13",
  conversationHistory: [
    { role: 'student', content: 'I need help with this' }
  ]
};

const prompt = buildSocraticTutorPrompt(context);
// Send prompt to LLM (OpenAI, Gemini, etc.)
```

### With Student Misconception

```typescript
const context: SocraticTutorContext = {
  currentQuestion: "What is the slope of y = 2x + 3?",
  studentMisconception: {
    concept: "Slope-Intercept Form",
    wrongAnswer: "3",
    description: "Student confused y-intercept (b) with slope (m)"
  },
  referenceMaterial: [
    {
      content: "In y = mx + b, m is the slope and b is the y-intercept...",
      concept: "Slope-Intercept Form",
      source: "Official SAT Study Guide"
    }
  ]
};

const prompt = buildSocraticTutorPrompt(context);
```

### With RAG Reference Material

```typescript
import { retrievalService } from '@/src/services/RetrievalService';

// Get reference material from RAG pipeline
const chunks = await retrievalService.query({
  concept: "Linear Equations",
  top_k: 3
});

const context: SocraticTutorContext = {
  currentQuestion: "Solve: 3x - 7 = 14",
  referenceMaterial: chunks.map(chunk => ({
    content: chunk.content,
    concept: chunk.concept_name,
    source: chunk.source
  }))
};

const prompt = buildSocraticTutorPrompt(context);
```

## Guardrail Validation

Always validate LLM responses to ensure they don't violate the prime directive:

```typescript
import { GuardrailValidator } from './socratic_tutor';

const llmResponse = "The answer is 4..."; // ❌ This violates guardrails

const validation = GuardrailValidator.validate(llmResponse, 4);

if (!validation.isValid) {
  console.error('Violations:', validation.violations);
  // Regenerate response or apply post-processing
}
```

## Testing

Run the test suite to verify guardrails:

```typescript
import { runAllTests } from './socratic_tutor.test';

const results = runAllTests();
console.log(`Passed: ${results.passed}/${results.total}`);
```

## Integration with Backend

### Python Backend Integration

If you need to use this in Python, you can:

1. **Convert TypeScript to Python**: The prompt structure is language-agnostic
2. **Use the same prompt template**: Copy the `buildSocraticTutorPrompt` logic
3. **Validate responses**: Implement the same guardrail checks

Example Python usage:

```python
from src.ai.prompts.socratic_tutor import build_socratic_tutor_prompt

context = {
    "current_question": "Solve for x: 2x + 5 = 13",
    "conversation_history": [
        {"role": "student", "content": "What's the answer?"}
    ]
}

prompt = build_socratic_tutor_prompt(context)
# Send to LLM
```

## Chain of Thought

The prompt includes a hidden "Chain of Thought" section that forces the AI to:

1. **Identify the misconception** - What error is the student making?
2. **Select reference material** - What content is most relevant?
3. **Design the guiding question** - What question will help discovery?
4. **Check for answer leakage** - Does the response reveal the answer?
5. **Ensure Socratic method** - Does it encourage thinking?

This thinking process is hidden from the student but ensures quality responses.

## Response Format

The expected response format:

```typescript
interface TutorResponse {
  response: string; // What the student sees
  chainOfThought?: {
    misconceptionIdentified?: string;
    referenceUsed?: string;
    guidingQuestionRationale?: string;
    answerLeakageCheck?: string;
  };
}
```

## Common Patterns

### Student Asks for Answer
**Student**: "Just give me the answer"
**Tutor**: "I can't give you the answer, but I can help you think through it. What do you think the first step should be?"

### Student Confirms Correctness
**Student**: "Is 5 the answer?"
**Tutor**: "Let's check your reasoning. Can you explain why you chose 5? What steps did you take?"

### Student Shows Misconception
**Student**: "I think the slope is 3" (for y = 2x + 3)
**Tutor**: "I see you're thinking about the equation. In the form y = mx + b, what does each part represent? What does the 'm' stand for?"

## Best Practices

1. **Always validate responses** - Use `GuardrailValidator` before showing to students
2. **Use RAG material** - Integrate with the retrieval service for context
3. **Track conversation history** - Maintain last 5 turns for continuity
4. **Identify misconceptions** - Use wrong answers to target guidance
5. **Be patient** - Students may ask for answers multiple times; stay firm but kind

## Testing Guardrails

The test suite includes queries that should be blocked:

- "Just give me the answer"
- "What's the answer?"
- "Tell me the solution"
- "Is 5 the answer?"
- "Show me how to solve it"

All of these should result in guiding questions, not direct answers.
