import { NextRequest, NextResponse } from 'next/server';

// Route segment config - ensures this route is handled correctly
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * API Route: Socratic Hint Generator
 * 
 * Generates a Socratic-style hint for a student's incorrect answer.
 * This endpoint can either:
 * 1. Call the backend LLM agent (if available)
 * 2. Use a mock response for development
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const {
      questionId,
      sessionId,
      stimulus,  // PRIMARY: Standardized on stimulus
      passageText,  // DEPRECATED: Keep for backward compatibility
      stem,
      studentAnswer,
      correctAnswer,
      choices,
      category
    } = body;
    
    // Standardize on stimulus (primary), with fallback to passageText
    const passageContent = stimulus || passageText || '';

    // Validate required fields
    if (!questionId || !sessionId || !stem || !studentAnswer || !correctAnswer) {
      return NextResponse.json(
        { error: 'Missing required fields' },
        { status: 400 }
      );
    }

    // Log: This is a Fresh Generation (cache miss - frontend handles cache check)
    console.log(`[Socratic Hint API] Fresh Generation Request - Question: ${questionId}, Session: ${sessionId}`);

    const backendUrl = process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:8000';
    
    try {
      // First, check if backend has cached response in PostgreSQL
      // The backend tutor-chat route will check cache automatically, but we can also
      // check directly via a GET endpoint if we add one. For now, the POST will check cache.
      
      // Try to call the backend tutor API (it will check PostgreSQL cache first)
      const backendResponse = await fetch(`${backendUrl}/api/tutor-chat/chat/stream`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          questionId,
          sessionId,
          message: `The student chose ${studentAnswer} but the correct answer is ${correctAnswer}. Without giving away the answer directly, provide a Socratic hint that helps them find the error in their logic.`,
          conversationHistory: [
            {
              role: 'system',
              content: `You are a helpful peer tutor using the Socratic method. The question is: "${stem}". ${passageContent ? `The passage context is: "${passageContent.substring(0, 500)}"` : ''} ${category ? `This question tests: ${category}. ` : ''}The student chose ${studentAnswer} but the correct answer is ${correctAnswer}. Explain the logic error for the chosen answer without giving away the correct one. Guide them to the correct category: ${category || 'the relevant skill area'}. Use a friendly, peer-to-peer tone.`
            }
          ]
        })
      });

      if (backendResponse.ok) {
        // Handle streaming response or regular JSON
        const contentType = backendResponse.headers.get('content-type');
        if (contentType?.includes('text/event-stream')) {
          // Handle SSE stream
          const reader = backendResponse.body?.getReader();
          const decoder = new TextDecoder();
          let fullResponse = '';
          
          if (reader) {
            while (true) {
              const { done, value } = await reader.read();
              if (done) break;
              const chunk = decoder.decode(value);
              const lines = chunk.split('\n');
              for (const line of lines) {
                if (line.startsWith('data: ')) {
                  const data = JSON.parse(line.slice(6));
                  if (data.content) {
                    fullResponse += data.content;
                  }
                }
              }
            }
          }
          
          return NextResponse.json({ hint: fullResponse });
        } else {
          const data = await backendResponse.json();
          return NextResponse.json({ hint: data.message || data.hint || data.content });
        }
      }
    } catch (backendError) {
      console.warn('Backend API not available, using mock response:', backendError);
    }

    // Fallback: Generate a mock Socratic hint
    const mockHint = generateMockSocraticHint(stem, studentAnswer, correctAnswer, passageContent, choices);
    
    return NextResponse.json({ 
      hint: mockHint,
      note: 'This is a mock response. Connect to backend LLM for real Socratic tutoring.'
    });
  } catch (error: any) {
    console.error('Error generating Socratic hint:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to generate hint' },
      { status: 500 }
    );
  }
}

/**
 * Generate a mock Socratic hint when backend is unavailable
 */
function generateMockSocraticHint(
  stem: string,
  studentAnswer: string,
  correctAnswer: string,
  stimulus?: string,  // PRIMARY: Standardized on stimulus
  choices?: Array<{ id: string; text: string }>,
  category?: string
): string {
  const studentChoice = choices?.find(c => String(c.id).toUpperCase() === String(studentAnswer).toUpperCase());
  const correctChoice = choices?.find(c => String(c.id).toUpperCase() === String(correctAnswer).toUpperCase());
  
  let hint = `I see you chose ${studentAnswer}. Let's think about this step by step.\n\n`;
  
  if (category) {
    hint += `This question is testing your understanding of ${category}. `;
    hint += `Keep that category in mind as we work through the logic.\n\n`;
  }
  
  if (stimulus) {
    hint += `First, let's look back at the passage. What is the main idea or key information it's trying to convey? `;
    hint += `Sometimes the answer requires us to connect different parts of the text together.\n\n`;
  }
  
  hint += `Consider: What specific evidence in the question or passage supports ${correctAnswer}? `;
  hint += `What might ${studentAnswer} be missing or overlooking?\n\n`;
  
  hint += `Try re-reading the question carefully. What is it really asking you to find or determine? `;
  hint += `Sometimes the key is in understanding what the question is testing, not just what the answer choices say.`;
  
  return hint;
}
