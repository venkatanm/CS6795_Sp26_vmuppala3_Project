# AI System Architecture

This directory contains the AI components for the Socratic Tutor system, including the Tutor Agent, Critic Agent, and Orchestrator.

## Architecture Overview

```
User Input
    ↓
Tutor Agent (Generates draft response)
    ↓
Critic Agent (Evaluates draft)
    ↓
[If FAIL] → Retry with feedback (up to maxRetries)
    ↓
[If PASS] → Final Response → User
```

## Components

### 1. Socratic Tutor (`prompts/socratic_tutor.ts`)
- System prompt for the tutor agent
- Ensures responses follow Socratic method
- Never gives direct answers
- Uses guiding questions

### 2. Critic Agent (`agents/CriticAgent.ts`)
- Pedagogical auditor
- Evaluates tutor responses before sending to user
- Checks for:
  - Answer revelation
  - Key step revelation
  - Factual hallucinations (against RAG context)
- Returns PASS/FAIL with feedback

### 3. Orchestrator (`orchestrator.ts`)
- Manages the tutor-critic workflow
- Implements retry logic
- Handles LLM calls for both agents
- Returns final validated response

## Usage

### Basic Example

```typescript
import { orchestrateTutorResponse } from './orchestrator';
import { SocraticTutorContext } from './prompts/socratic_tutor';

const context: SocraticTutorContext = {
  currentQuestion: "Solve for x: 2x + 5 = 13",
  studentMisconception: {
    concept: "Linear Equations",
    wrongAnswer: "5",
    description: "Student forgot to subtract 5"
  },
  referenceMaterial: [
    {
      content: "To solve linear equations, isolate the variable...",
      concept: "Linear Equations"
    }
  ],
  conversationHistory: [
    { role: 'student', content: 'I don\'t understand' }
  ]
};

const result = await orchestrateTutorResponse(
  {
    studentInput: "What's the answer?",
    tutorContext: context,
    correctAnswer: 4,
  },
  {
    maxRetries: 3,
    tutorLLMCall: async (prompt, systemPrompt) => {
      // Call your LLM API
      return llmResponse;
    },
    criticLLMCall: async (prompt, systemPrompt) => {
      // Call your LLM API
      return criticResponse;
    },
  }
);

console.log(result.response); // Final validated response
console.log(result.retries); // Number of retries needed
console.log(result.passed); // Whether it passed critic
```

### Quick Evaluation (Pattern Matching Only)

For fast pre-checks without LLM calls:

```typescript
import { quickEvaluate } from './agents/CriticAgent';

const evaluation = quickEvaluate({
  draftResponse: "The answer is 4.",
  studentInput: "What's 2 + 2?",
  correctAnswer: 4,
});

if (evaluation.status === 'FAIL') {
  console.log('Violation:', evaluation.reason);
  console.log('Feedback:', evaluation.feedback);
}
```

## Integration with Backend

The orchestrator should be integrated into the backend API (`src/api/routes/tutor_chat.py`):

```python
# In tutor_chat.py
from src.ai.orchestrator import orchestrate_tutor_response  # Python wrapper needed

async def generate_tutor_response(...):
    # Build context
    tutor_context = {
        "currentQuestion": item.question_text,
        "referenceMaterial": reference_material,
        # ...
    }
    
    # Call orchestrator (requires Python wrapper or API call to TypeScript service)
    result = await orchestrate_tutor_response(
        student_input=student_message,
        tutor_context=tutor_context,
        correct_answer=item.correct_answer,
        config={
            "maxRetries": 3,
            "tutorLLMCall": call_openai,
            "criticLLMCall": call_openai,
        }
    )
    
    return result["response"]
```

## Testing

Run the Critic Agent tests:

```typescript
import { runCriticTests } from './agents/CriticAgent.test';

const results = runCriticTests();
console.log(`Passed: ${results.passed}/${results.total}`);
```

## Configuration

### OrchestratorConfig

- `maxRetries`: Maximum retry attempts (default: 3)
- `useLLMCritic`: Whether to use LLM for critic (default: true)
- `tutorLLMCall`: Function to call LLM for tutor responses
- `criticLLMCall`: Function to call LLM for critic evaluation

### CriticContext

- `draftResponse`: The tutor's draft response to evaluate
- `studentInput`: The student's question/input
- `currentQuestion`: The problem being discussed
- `referenceMaterial`: RAG content for fact-checking
- `correctAnswer`: Answer to check if revealed
- `concept`: Concept being discussed

## Error Handling

The orchestrator handles:
- LLM API failures
- Parsing errors
- Max retry limits
- Timeout errors

All errors are caught and returned in the `OrchestratorResult.error` field.

## Performance Considerations

1. **Quick Evaluation**: Use `quickEvaluate()` for fast pattern-matching checks before expensive LLM calls
2. **Caching**: Cache reference material to avoid repeated RAG queries
3. **Streaming**: The orchestrator can be extended to support streaming responses
4. **Parallel Evaluation**: Consider evaluating multiple drafts in parallel for faster retries

## Future Enhancements

- [ ] Python wrapper for orchestrator (for backend integration)
- [ ] Streaming support in orchestrator
- [ ] More sophisticated fact-checking against RAG
- [ ] Confidence scoring for critic evaluations
- [ ] A/B testing different critic strategies
- [ ] Metrics and logging for quality monitoring
