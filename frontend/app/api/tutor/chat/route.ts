/**
 * Socratic Tutor Chat API Route
 * Handles streaming chat responses from the Socratic Tutor agent
 */

import { NextRequest } from "next/server";
import { generateTutorResponse } from "@/src/ai/agent";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Get dynamic system prompt based on turn count and context
 */
function getSystemPrompt(turnCount: number, isReviewMode: boolean = false): string {
  // In review mode, be more direct since the student already knows the answer
  if (isReviewMode) {
    return `You are a helpful SAT tutor explaining why answers are correct or incorrect.

**CRITICAL: In Review Mode, the student already knows the correct answer. Your job is to EXPLAIN, not ask questions.**

**Your Approach:**
1. **Be Direct and Educational:** Immediately explain WHY the correct answer is correct and WHY the student's chosen answer is wrong.
2. **Provide Clear, Specific Explanations:** Give concrete, detailed explanations based on the actual question content. Reference specific parts of the question, answer choices, or passage.
3. **Compare Options Directly:** When a student asks "why is C correct and B wrong?", explain:
   - Why C is correct (specific reasoning)
   - Why B is incorrect (specific flaw or misunderstanding)
   - The key concept or rule being tested
4. **Use the Question Context:** You have access to the full question, answer choices, correct answer, and passage. Use this information to give specific, helpful explanations.

**Response Format:**
- Start with a direct explanation: "C is correct because..."
- Explain why the wrong answer is wrong: "B is incorrect because..."
- Summarize the key concept: "This question tests your understanding of..."

**DO NOT:**
- Ask the student to share the question (you already have it)
- Ask vague questions like "What made you think B was correct?"
- Use only Socratic questioning - provide actual explanations

**Example Good Response:**
"C is correct because [specific reason based on the question text and answer choices]. B is incorrect because [specific reason why B doesn't work based on the question]. The key concept here is [relevant rule/concept]."

**Tone:** Clear, educational, direct, and supportive.`;

  }

  // During active testing, use Socratic method
  const basePrompt = `You are a Socratic Tutor for the Digital SAT.

**Your Prime Directives:**
1. **NEVER give the answer during active testing.** If the student asks for it, refuse politely and offer a hint.
2. **Diagnose First:** If the student is wrong, use the diagnose tool to see if they fell into a trap. Use the remediation text provided by the tool.
3. **Teach Principles:** If they are confused, use the lookup_concept tool to find the rule. Explain the rule, then ask them to apply it.
4. **Be Concise:** Keep responses under 3 sentences unless explaining a complex rule.

**Tone:** Encouraging, precise, and patient.

`;

  if (turnCount <= 2) {
    return basePrompt + `**Mode: SOCRATIC.** Ask a guiding question. Do not reveal the rule yet.`;
  } else if (turnCount === 3) {
    return basePrompt + `**Mode: DIRECT HINT.** The student is struggling. Give a strong hint about the underlying concept (e.g., 'Remember the rule for comma splices'). Ask them to try again.`;
  } else {
    // turnCount >= 4
    return basePrompt + `**Mode: RESOLUTION.** This is the final turn. Briefly explain the correct concept/rule in 1 sentence. Do not ask another question. End the response with 'Let's move to the next question.'`;
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { message, conversationHistory, messages, studentScore = 500, currentQuestionId, questionId, sessionId, isReviewMode, context } = body;

    // Support both formats: new format (message + conversationHistory) and old format (messages array)
    let formattedMessages: Array<{ role: "user" | "assistant"; content: string }> = [];
    
    if (message && conversationHistory) {
      // New format: build messages array from conversationHistory + new message
      formattedMessages = [
        ...conversationHistory.map((msg: any) => ({
          role: msg.role === "student" ? "user" : msg.role === "tutor" ? "assistant" : msg.role,
          content: msg.content || msg.text || "",
        })),
        {
          role: "user" as const,
          content: message,
        },
      ];
    } else if (messages && Array.isArray(messages)) {
      // Old format: use messages array directly
      formattedMessages = messages.map((msg: any) => ({
        role: msg.role === "user" ? "user" : "assistant",
        content: msg.content || msg.text || "",
      }));
    } else {
      return new Response(
        JSON.stringify({ error: "Either (message + conversationHistory) or messages array is required" }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    // Calculate user turns (number of user messages)
    const userTurns = formattedMessages.filter((m) => m.role === "user").length;

    // Hard stop at turn 5+
    if (userTurns > 5) {
      const hardStopStream = new ReadableStream({
        start(controller) {
          const message = "We've spent enough time on this one. Let's move on.";
          const data = `data: ${JSON.stringify({ content: message, turnLimitReached: true })}\n\n`;
          controller.enqueue(new TextEncoder().encode(data));
          controller.enqueue(new TextEncoder().encode("data: [DONE]\n\n"));
          controller.close();
        },
      });

      return new Response(hardStopStream, {
        headers: {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          Connection: "keep-alive",
        },
      });
    }

    // Get question context from request context or fetch from backend
    let questionContext = null;
    const activeQuestionId = currentQuestionId || questionId;
    
    // Priority 1: Use context from request (passed from frontend)
    if (context && context.question_id) {
      questionContext = {
        questionText: context.question_text || '',
        answerChoices: {}, // Will be populated from backend if needed
        correctAnswer: '', // Will be populated from backend if needed
        stimulus: context.stimulus || context.passageText || '',  // PRIMARY: Standardized on stimulus
        passageText: context.stimulus || context.passageText || '',  // DEPRECATED: Keep for backward compatibility
        domain: '',
        skillTag: context.skill || ''
      };
      console.log("[Chat API] Using context from request:", {
        question_id: context.question_id,
        hasQuestionText: !!context.question_text,
        skill: context.skill
      });
    }
    
    // Priority 2: Fetch from backend if context not provided or incomplete
    if ((!questionContext || !questionContext.correctAnswer) && activeQuestionId && sessionId) {
      try {
        const backendUrl = process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:8000';
        // Fetch current module to get question data
        const moduleResponse = await fetch(
          `${backendUrl}/api/exam/session/${sessionId}/current-module`,
          { headers: { 'X-Tenant-ID': 'public' } }
        );
        
        if (moduleResponse.ok) {
          const moduleData = await moduleResponse.json();
          const question = moduleData.questions?.[activeQuestionId];
          
          if (question) {
            // Merge with existing context or create new
            // STANDARDIZED: Use stimulus as primary field
            const stimulus = question.stimulus || question.passageText || question.passage || '';
            questionContext = {
              questionText: context?.question_text || question.questionText || question.stem || '',
              answerChoices: question.answerChoices || question.options || {},
              correctAnswer: question.correctAnswer || question.correct_answer || '',
              stimulus: stimulus,  // PRIMARY: Standardized on stimulus
              passageText: stimulus,  // DEPRECATED: Keep for backward compatibility
              domain: question.domain || '',
              skillTag: context?.skill || question.skillTag || question.skill_tag || ''
            };
            console.log("[Chat API] Question context fetched from backend:", {
              hasQuestionText: !!questionContext.questionText,
              hasAnswerChoices: !!questionContext.answerChoices,
              hasCorrectAnswer: !!questionContext.correctAnswer
            });
          }
        }
      } catch (error) {
        console.warn("[Chat API] Failed to fetch question context:", error);
        // Continue with partial context if available
      }
    }

    // Determine if we're in review mode (student already knows the answer)
    // Check if the conversation mentions review or if the student already knows the correct answer
    const isReviewContext = isReviewMode || 
      formattedMessages.some(msg => 
        msg.content.toLowerCase().includes('correct answer') || 
        msg.content.toLowerCase().includes('why is') ||
        msg.content.toLowerCase().includes('explain why')
      );

    // Get dynamic system prompt based on turn count and review mode
    let dynamicSystemPrompt = getSystemPrompt(userTurns, isReviewContext);
    
    // Enhance system prompt with question context if available
    if (questionContext) {
      const contextSection = `

**Question Context:**
Question: ${questionContext.questionText}
${(questionContext.stimulus || questionContext.passageText) ? `Passage: ${(questionContext.stimulus || questionContext.passageText || '').substring(0, 500)}...` : ''}
${questionContext.domain ? `Domain: ${questionContext.domain}` : ''}
${questionContext.skillTag ? `Skill: ${questionContext.skillTag}` : ''}

Answer Choices:
${Object.entries(questionContext.answerChoices).map(([key, value]) => `${key}: ${value}`).join('\n')}

Correct Answer: ${questionContext.correctAnswer}

**Important:** You have full access to the question, answer choices, and correct answer. Use this information to provide specific, helpful guidance. Do NOT ask the student to share the question or answer choices - you already have them.`;
      
      dynamicSystemPrompt = dynamicSystemPrompt + contextSection;
    }

    // Create a ReadableStream for streaming response
    const stream = new ReadableStream({
      async start(controller) {
        try {
          console.log("[Chat API] Starting stream generation");
          console.log("[Chat API] Parameters:", {
            messageCount: formattedMessages.length,
            studentScore,
            questionId: activeQuestionId,
            hasSystemPrompt: !!dynamicSystemPrompt,
            hasQuestionContext: !!questionContext
          });

          let chunkCount = 0;
          // Use the formattedMessages we already built above
          // Generate response chunks with dynamic system prompt
          for await (const chunk of generateTutorResponse(
            formattedMessages,
            studentScore,
            currentQuestionId || questionId,
            dynamicSystemPrompt
          )) {
            chunkCount++;
            console.log(`[Chat API] Received chunk ${chunkCount}, length: ${chunk.length}`);
            // Send chunk as SSE format
            const data = `data: ${JSON.stringify({ content: chunk })}\n\n`;
            controller.enqueue(new TextEncoder().encode(data));
          }

          console.log(`[Chat API] Stream complete, total chunks: ${chunkCount}`);
          // Send done signal
          controller.enqueue(new TextEncoder().encode("data: [DONE]\n\n"));
          controller.close();
        } catch (error: any) {
          console.error("[Chat API] Error in stream:", {
            error: error.message,
            stack: error.stack,
            name: error.name
          });
          const errorData = `data: ${JSON.stringify({ error: error.message || 'Unknown error occurred' })}\n\n`;
          controller.enqueue(new TextEncoder().encode(errorData));
          controller.close();
        }
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      },
    });
  } catch (error: any) {
    console.error("Error in POST /api/tutor/chat:", error);
    return new Response(
      JSON.stringify({ error: error.message || "Internal server error" }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
}
