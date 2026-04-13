/**
 * Tutor-Critic Orchestrator
 * 
 * Manages the workflow: User Input -> Tutor Agent -> Draft Response -> Critic Agent -> Final Response
 * 
 * Implements retry logic: If the Critic fails a response, the Tutor regenerates
 * using the Critic's feedback.
 */

import { evaluateTutorResponse, CriticContext, CriticEvaluation } from './agents/CriticAgent';
import { buildSocraticTutorPrompt, SocraticTutorContext } from './prompts/socratic_tutor';

export type StatusCallback = (status: {
  stage: 'analyzing' | 'generating' | 'reviewing' | 'checking' | 'complete';
  message?: string;
  progress?: number;
}) => void;

export interface OrchestratorConfig {
  /** Maximum number of retry attempts */
  maxRetries?: number;
  /** Whether to use LLM for critic evaluation */
  useLLMCritic?: boolean;
  /** Function to call LLM for tutor response generation */
  tutorLLMCall?: (prompt: string, systemPrompt: string) => Promise<string>;
  /** Function to call LLM for critic evaluation */
  criticLLMCall?: (prompt: string, systemPrompt: string) => Promise<string>;
  /** Streaming function for tutor response (returns async generator) */
  tutorStreamCall?: (prompt: string, systemPrompt: string) => AsyncGenerator<string>;
  /** Status callback for UI updates */
  onStatusUpdate?: StatusCallback;
  /** Latency target in milliseconds (default: 3000ms) */
  latencyTarget?: number;
  /** Filler message to show if latency exceeds target */
  fillerMessage?: string;
}

export interface OrchestratorResult {
  /** The final response to send to the user */
  response: string;
  /** Number of retries needed */
  retries: number;
  /** Whether the final response passed critic evaluation */
  passed: boolean;
  /** Evaluation details from the critic */
  evaluation?: CriticEvaluation;
  /** Any errors that occurred */
  error?: string;
  /** Performance metrics */
  performance?: {
    totalTime: number;
    tutorTime: number;
    criticTime: number;
    retryCount: number;
    exceededLatencyTarget: boolean;
  };
}

export interface TutorRequest {
  /** Student's input/question */
  studentInput: string;
  /** Context for the tutor */
  tutorContext: SocraticTutorContext;
  /** Correct answer (for critic to check against) */
  correctAnswer?: string | number;
}

/**
 * Default LLM call function (placeholder - should be replaced with actual implementation)
 */
async function defaultLLMCall(prompt: string, systemPrompt: string): Promise<string> {
  // This is a placeholder - in production, replace with actual LLM API call
  // (OpenAI, Gemini, etc.)
  throw new Error('LLM call function not provided. Please provide tutorLLMCall in config.');
}

/**
 * Generate tutor response using LLM
 */
async function generateTutorResponse(
  request: TutorRequest,
  feedback?: string,
  llmCall?: (prompt: string, systemPrompt: string) => Promise<string>
): Promise<string> {
  const callFunction = llmCall || defaultLLMCall;

  // Build the tutor prompt
  let tutorPrompt = buildSocraticTutorPrompt(request.tutorContext);

  // Add student input
  tutorPrompt += `\n\n## STUDENT INPUT:\n${request.studentInput}\n`;

  // Add critic feedback if this is a retry
  if (feedback) {
    tutorPrompt += `\n\n## CRITIC FEEDBACK (IMPORTANT - Address this in your response):\n${feedback}\n`;
    tutorPrompt += '\nThe previous response was rejected. Please rewrite it following the feedback above.\n';
  }

  // Add instruction to respond
  tutorPrompt += '\n## YOUR RESPONSE:\nGenerate your response following the Socratic method.';

  // Call LLM
  const systemPrompt = 'You are a Socratic Tutor. Guide students through discovery, never give answers.';
  const response = await callFunction(tutorPrompt, systemPrompt);

  return response.trim();
}

/**
 * Orchestrate the tutor-critic workflow with streaming and performance monitoring
 * 
 * Workflow:
 * 1. Generate draft response from Tutor (with streaming support)
 * 2. Evaluate with Critic
 * 3. If FAIL, retry with feedback (up to maxRetries)
 * 4. Return final response
 * 
 * Performance:
 * - Monitors latency and emits filler tokens if >3 seconds
 * - Emits status updates for optimistic UI
 * - Supports streaming responses
 */
export async function orchestrateTutorResponse(
  request: TutorRequest,
  config: OrchestratorConfig = {}
): Promise<OrchestratorResult> {
  const {
    maxRetries = 3,
    useLLMCritic = true,
    tutorLLMCall,
    criticLLMCall,
    tutorStreamCall,
    onStatusUpdate,
    latencyTarget = 3000,
    fillerMessage = "That's an interesting thought, let me check...",
  } = config;

  const startTime = Date.now();
  let draftResponse: string = '';
  let evaluation: CriticEvaluation | undefined;
  let retries = 0;
  let lastFeedback: string | undefined;
  let tutorTime = 0;
  let criticTime = 0;
  let fillerEmitted = false;

  // Retry loop
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      // Emit status update
      onStatusUpdate?.({ 
        stage: attempt === 0 ? 'analyzing' : 'generating',
        message: attempt === 0 ? 'Analyzing your question...' : 'Regenerating response...',
      });

      // Step 1: Generate draft response from Tutor
      const tutorStartTime = Date.now();
      
      // Check if we should emit filler message
      const elapsed = Date.now() - startTime;
      if (elapsed > latencyTarget && !fillerEmitted && attempt === 0) {
        draftResponse = fillerMessage + ' ';
        fillerEmitted = true;
        onStatusUpdate?.({ 
          stage: 'generating',
          message: 'Generating response...',
        });
      }

      if (tutorStreamCall && attempt === 0) {
        // Use streaming if available
        draftResponse = '';
        const stream = tutorStreamCall(
          buildSocraticTutorPrompt(request.tutorContext) + `\n\n## STUDENT INPUT:\n${request.studentInput}\n`,
          'You are a Socratic Tutor. Guide students through discovery, never give answers.'
        );
        
        for await (const chunk of stream) {
          draftResponse += chunk;
          // Emit streaming updates
          onStatusUpdate?.({ 
            stage: 'generating',
            message: 'Generating response...',
            progress: draftResponse.length / 100, // Rough estimate
          });
        }
      } else {
        // Use regular generation
        draftResponse = await generateTutorResponse(
          request,
          lastFeedback,
          tutorLLMCall
        );
      }
      
      tutorTime += Date.now() - tutorStartTime;

      // Step 2: Evaluate with Critic
      onStatusUpdate?.({ 
        stage: 'reviewing',
        message: 'Reviewing your work...',
      });

      const criticStartTime = Date.now();
      const criticContext: CriticContext = {
        draftResponse,
        studentInput: request.studentInput,
        currentQuestion: request.tutorContext.currentQuestion,
        referenceMaterial: request.tutorContext.referenceMaterial,
        correctAnswer: request.correctAnswer,
        concept: request.tutorContext.concept,
      };

      evaluation = await evaluateTutorResponse(
        criticContext,
        useLLMCritic,
        criticLLMCall
      );
      
      criticTime += Date.now() - criticStartTime;
      
      onStatusUpdate?.({ 
        stage: 'checking',
        message: 'Checking logic...',
      });

      // Step 3: Check if passed
      if (evaluation.status === 'PASS') {
        const totalTime = Date.now() - startTime;
        onStatusUpdate?.({ 
          stage: 'complete',
          message: 'Complete',
        });
        
        return {
          response: draftResponse,
          retries: attempt,
          passed: true,
          evaluation,
          performance: {
            totalTime,
            tutorTime,
            criticTime,
            retryCount: attempt,
            exceededLatencyTarget: totalTime > latencyTarget,
          },
        };
      }

      // Step 4: If failed and we have retries left, prepare feedback for retry
      if (attempt < maxRetries) {
        lastFeedback = evaluation.feedback || evaluation.reason || 'Response needs improvement';
        retries = attempt + 1;
        
        // Log retry (in production, use proper logging)
        console.log(`[Orchestrator] Response failed critic check (attempt ${attempt + 1}/${maxRetries + 1}):`, evaluation.reason);
        console.log(`[Orchestrator] Feedback:`, lastFeedback);
      } else {
        // Max retries reached
        console.warn('[Orchestrator] Max retries reached. Returning last response despite failure.');
        const totalTime = Date.now() - startTime;
        onStatusUpdate?.({ 
          stage: 'complete',
          message: 'Complete',
        });
        
        return {
          response: draftResponse,
          retries: maxRetries,
          passed: false,
          evaluation,
          error: `Max retries (${maxRetries}) reached. Response may not meet quality standards.`,
          performance: {
            totalTime,
            tutorTime,
            criticTime,
            retryCount: maxRetries,
            exceededLatencyTarget: totalTime > latencyTarget,
          },
        };
      }
    } catch (error: any) {
      // Error during generation or evaluation
      const errorMessage = error.message || 'Unknown error occurred';
      console.error('[Orchestrator] Error:', error);

      if (attempt === maxRetries) {
        // Last attempt failed
        const totalTime = Date.now() - startTime;
        onStatusUpdate?.({ 
          stage: 'complete',
          message: 'Error occurred',
        });
        
        return {
          response: draftResponse || 'I apologize, but I encountered an error. Please try again.',
          retries: attempt,
          passed: false,
          error: errorMessage,
          performance: {
            totalTime,
            tutorTime,
            criticTime,
            retryCount: attempt,
            exceededLatencyTarget: totalTime > latencyTarget,
          },
        };
      }

      // Retry on error
      retries = attempt + 1;
      lastFeedback = 'An error occurred. Please try generating the response again.';
    }
  }

  // Should never reach here, but TypeScript needs a return
  return {
    response: draftResponse || 'Unable to generate response.',
    retries,
    passed: false,
    error: 'Unexpected error in orchestrator loop',
  };
}

/**
 * Quick orchestration (uses pattern matching only, no LLM critic)
 * Useful for fast responses when LLM calls are expensive
 */
export async function quickOrchestrate(
  request: TutorRequest,
  config: Omit<OrchestratorConfig, 'useLLMCritic'> = {}
): Promise<OrchestratorResult> {
  return orchestrateTutorResponse(request, {
    ...config,
    useLLMCritic: false,
  });
}

/**
 * Example usage and integration
 */
export const EXAMPLE_USAGE = `
// Example: Integrate with OpenAI
import { orchestrateTutorResponse } from './orchestrator';
import { OpenAI } from 'openai';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

async function getTutorResponse(studentInput: string, context: SocraticTutorContext) {
  const result = await orchestrateTutorResponse(
    {
      studentInput,
      tutorContext: context,
      correctAnswer: 4, // Optional, for critic to check
    },
    {
      maxRetries: 3,
      useLLMCritic: true,
      tutorLLMCall: async (prompt, systemPrompt) => {
        const response = await openai.chat.completions.create({
          model: 'gpt-4',
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: prompt },
          ],
        });
        return response.choices[0].message.content || '';
      },
      criticLLMCall: async (prompt, systemPrompt) => {
        const response = await openai.chat.completions.create({
          model: 'gpt-4',
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: prompt },
          ],
        });
        return response.choices[0].message.content || '';
      },
    }
  );

  return result.response;
}
`;
