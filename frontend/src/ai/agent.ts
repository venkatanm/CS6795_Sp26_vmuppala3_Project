/**
 * Socratic Tutor Agent
 * Uses Vercel AI SDK with Google Provider to create a Socratic tutoring agent
 * 
 * Note: This file does NOT use "use server" because it's only used in API routes,
 * not as a server action. This prevents "UnrecognizedActionError" when the dev server restarts.
 */

import { GoogleGenerativeAI } from "@google/generative-ai";

// Initialize Gemini
let genAI: GoogleGenerativeAI | null = null;

function getGeminiClient(): GoogleGenerativeAI {
  if (!genAI) {
    const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
    console.log("[Agent] Checking for API key:", {
      hasGeminiKey: !!process.env.GEMINI_API_KEY,
      hasGoogleKey: !!process.env.GOOGLE_API_KEY,
      apiKeyLength: apiKey?.length || 0
    });
    if (!apiKey) {
      console.error("[Agent] ❌ API key not found in environment variables");
      throw new Error("GEMINI_API_KEY or GOOGLE_API_KEY not found in environment variables");
    }
    console.log("[Agent] ✅ API key found, initializing Gemini client");
    genAI = new GoogleGenerativeAI(apiKey);
  }
  return genAI;
}

/**
 * Call backend API for diagnosing student mistakes
 * Note: This is a placeholder - the backend may not have this endpoint yet
 * For now, return a simple response
 */
async function diagnoseMistake(
  studentInput: string,
  questionId?: string
): Promise<{ found: boolean; remediation: string | null }> {
  // TODO: Implement backend API call when endpoint is available
  // For now, return a simple response
  console.log("[Agent] Diagnose called:", { studentInput, questionId });
  return {
    found: false,
    remediation: null
  };
}

/**
 * Call backend API for fetching concept explanations
 * Note: This is a placeholder - the backend may not have this endpoint yet
 * For now, return empty results
 */
async function fetchConceptExplanation(
  query: string,
  studentScore: number
): Promise<Array<{ content: string }>> {
  // TODO: Implement backend API call when endpoint is available
  // For now, return empty results
  console.log("[Agent] Lookup concept called:", { query, studentScore });
  return [];
}

// System prompt for Socratic Tutor
const SYSTEM_PROMPT = `You are a Socratic Tutor for the Digital SAT.

**Your Prime Directives:**
1. **NEVER give the answer.** If the student asks for it, refuse politely and offer a hint.
2. **Diagnose First:** If the student is wrong, use the diagnose tool to see if they fell into a trap. Use the remediation text provided by the tool.
3. **Teach Principles:** If they are confused, use the lookup_concept tool to find the rule. Explain the rule, then ask them to apply it.
4. **Be Concise:** Keep responses under 3 sentences unless explaining a complex rule.

**Tone:** Encouraging, precise, and patient.`;

/**
 * Tool definitions for the agent
 */
const tools = {
  diagnose: {
    name: "diagnose",
    description: "Checks if the student's wrong answer matches a known cognitive error. Use this when a student gives an incorrect answer or explanation.",
    parameters: {
      type: "object",
      properties: {
        studentInput: {
          type: "string",
          description: "The student's answer or explanation of their reasoning",
        },
        questionId: {
          type: "string",
          description: "Optional question ID to filter misconceptions",
        },
      },
      required: ["studentInput"],
    },
  },
  lookup_concept: {
    name: "lookup_concept",
    description: "Retrieves textbook explanations for a concept. Use this when the student asks about a concept, rule, or needs clarification.",
    parameters: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "The concept or topic the student is asking about",
        },
        studentScore: {
          type: "number",
          description: "The student's current SAT score for adaptive content filtering",
        },
      },
      required: ["query", "studentScore"],
    },
  },
};

/**
 * Execute a tool call
 */
async function executeTool(
  toolName: string,
  args: any,
  studentScore: number
): Promise<string> {
  switch (toolName) {
    case "diagnose":
      const diagnoseResult = await diagnoseMistake(
        args.studentInput,
        args.questionId
      );
      if (diagnoseResult.found) {
        return `Found matching misconception. Remediation: ${diagnoseResult.remediation}`;
      } else {
        // Even if no specific misconception is found, provide helpful guidance
        // The model should use the question context from the system prompt to give specific help
        return "No specific misconception pattern matched. However, I can help you understand the question better. Let me guide you through the reasoning.";
      }

    case "lookup_concept":
      const conceptResults = await fetchConceptExplanation(
        args.query,
        args.studentScore || studentScore
      );
      if (conceptResults.length > 0) {
        return conceptResults
          .map((r, i) => `[${i + 1}] ${r.content}`)
          .join("\n\n");
      } else {
        return "No relevant curriculum content found.";
      }

    default:
      return `Unknown tool: ${toolName}`;
  }
}

/**
 * Generate a response from the Socratic Tutor agent
 * 
 * @param messages - Conversation history
 * @param studentScore - Student's current SAT score
 * @param currentQuestionId - Optional current question ID
 * @param systemPromptOverride - Optional system prompt to override the default (may include question context)
 * @returns Stream of response chunks
 */
export async function* generateTutorResponse(
  messages: Array<{ role: "user" | "assistant"; content: string }>,
  studentScore: number = 500,
  currentQuestionId?: string,
  systemPromptOverride?: string
): AsyncGenerator<string, void, unknown> {
  console.log("[Agent] generateTutorResponse called with:", {
    messageCount: messages.length,
    studentScore,
    currentQuestionId,
    hasSystemPrompt: !!systemPromptOverride
  });

  try {
    const genAI = getGeminiClient();
    console.log("[Agent] Gemini client initialized");
    
    const model = genAI.getGenerativeModel({
      model: "gemini-2.5-flash-lite",
    });
    console.log("[Agent] Model initialized: gemini-2.5-flash-lite");

    // Use override system prompt if provided, otherwise use default
    const activeSystemPrompt = systemPromptOverride || SYSTEM_PROMPT;

    // Build conversation with system prompt
    const conversation = [
      { role: "user", parts: [{ text: activeSystemPrompt }] },
      ...messages.map((msg) => ({
        role: msg.role === "user" ? "user" : "model",
        parts: [{ text: msg.content }],
      })),
    ];

    console.log("[Agent] Conversation built:", {
      totalMessages: conversation.length,
      lastUserMessage: messages[messages.length - 1]?.content?.substring(0, 50)
    });
    // Build function declarations for Gemini
    const functionDeclarations = [
      {
        name: tools.diagnose.name,
        description: tools.diagnose.description,
        parameters: {
          type: "object",
          properties: {
            studentInput: {
              type: "string",
              description: "The student's answer or explanation of their reasoning",
            },
            questionId: {
              type: "string",
              description: "Optional question ID to filter misconceptions",
            },
          },
          required: ["studentInput"],
        },
      },
      {
        name: tools.lookup_concept.name,
        description: tools.lookup_concept.description,
        parameters: {
          type: "object",
          properties: {
            query: {
              type: "string",
              description: "The concept or topic the student is asking about",
            },
            studentScore: {
              type: "number",
              description: "The student's current SAT score for adaptive content filtering",
            },
          },
          required: ["query", "studentScore"],
        },
      },
    ];

    // First generation with tools
    console.log("[Agent] Calling Gemini API...");
    const result = await model.generateContent({
      contents: conversation.map((c) => ({
        role: c.role,
        parts: c.parts,
      })),
      tools: [{ functionDeclarations }] as any,
    });

    console.log("[Agent] Gemini API call completed");
    const response = await result.response;
    const candidates = response.candidates;

    console.log("[Agent] Response received:", {
      hasCandidates: !!candidates,
      candidateCount: candidates?.length || 0
    });

    if (!candidates || candidates.length === 0) {
      console.error("[Agent] No candidates in response");
      yield "I apologize, but I couldn't generate a response. Please try again.";
      return;
    }

    const candidate = candidates[0];
    const content = candidate.content;
    
    console.log("[Agent] Candidate content:", {
      hasContent: !!content,
      hasParts: !!content.parts,
      partsCount: content.parts?.length || 0
    });

    // Check if model wants to call a function
    if (content.parts && content.parts.some((part: any) => part.functionCall)) {
      console.log("[Agent] Model requested function call");
      // Execute function calls
      const functionCalls = content.parts
        .filter((part: any) => part.functionCall)
        .map((part: any) => part.functionCall);

      console.log("[Agent] Function calls to execute:", functionCalls.length);

      for (const functionCall of functionCalls) {
        console.log("[Agent] Executing function:", functionCall.name);
        const toolResult = await executeTool(
          functionCall.name,
          functionCall.args || {},
          studentScore
        );
        console.log("[Agent] Tool result:", toolResult.substring(0, 100));

        // Continue conversation with function result
        const followUpResult = await model.generateContent({
          contents: [
            ...conversation,
            {
              role: "model",
              parts: content.parts,
            },
            {
              role: "user",
              parts: [
                {
                  functionResponse: {
                    name: functionCall.name,
                    response: { result: toolResult },
                  },
                },
              ],
            },
          ],
          tools: [{ functionDeclarations }] as any,
        });

        const followUpResponse = await followUpResult.response;
        const followUpText = followUpResponse.text();
        console.log("[Agent] Follow-up response received, length:", followUpText.length);
        yield followUpText;
      }
    } else {
      // No function calls, just return the text
      console.log("[Agent] No function calls, extracting text directly");
      const text = response.text();
      console.log("[Agent] Text extracted, length:", text.length);
      if (!text || text.trim().length === 0) {
        console.error("[Agent] Empty text response from Gemini");
        yield "I apologize, but I couldn't generate a response. Please try again.";
        return;
      }
      yield text;
    }
  } catch (error: any) {
    console.error("[Agent] Error generating tutor response:", {
      error: error.message,
      stack: error.stack,
      name: error.name
    });
    yield `I apologize, but I encountered an error: ${error.message || 'Unknown error'}. Please try again.`;
  }
}

/**
 * Generate a simple non-streaming response (for testing)
 */
export async function generateTutorResponseSimple(
  messages: Array<{ role: "user" | "assistant"; content: string }>,
  studentScore: number = 500,
  currentQuestionId?: string,
  systemPromptOverride?: string
): Promise<string> {
  let fullResponse = "";
  for await (const chunk of generateTutorResponse(messages, studentScore, currentQuestionId, systemPromptOverride)) {
    fullResponse += chunk;
  }
  return fullResponse;
}
