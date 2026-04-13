import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';

// Route segment config - ensures this route is handled correctly
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * API Route: Fetch Session from Backend
 * 
 * Fetches a session from the FastAPI backend and converts it
 * to the frontend's expected format.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> }
) {
  try {
    // Get authenticated user from Clerk
    const { userId } = await auth();

    if (!userId) {
      return NextResponse.json(
        { error: 'Unauthorized - User not authenticated' },
        { status: 401 }
      );
    }

    const { sessionId } = await params;

    if (!sessionId) {
      return NextResponse.json(
        { error: 'Missing sessionId parameter' },
        { status: 400 }
      );
    }

    // Get backend URL from environment
    const backendUrl = process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:8000';

    // Call FastAPI backend to fetch session
    // Note: Backend route is mounted at /sessions (not /api/sessions)
    const backendResponse = await fetch(`${backendUrl}/sessions/${sessionId}`, {
      method: 'GET',
      headers: {
        'X-User-ID': userId,
        'X-Tenant-ID': 'public'
      }
    });

    if (!backendResponse.ok) {
      if (backendResponse.status === 404) {
        return NextResponse.json(
          { error: 'Session not found' },
          { status: 404 }
        );
      }
      const errorText = await backendResponse.text();
      console.error(`Backend fetch failed: ${backendResponse.status} - ${errorText}`);
      return NextResponse.json(
        { 
          error: 'Backend fetch failed',
          details: errorText,
          status: backendResponse.status
        },
        { status: backendResponse.status }
      );
    }

    const backendSession = await backendResponse.json();

    // Convert backend session format to frontend format
    // Backend returns: { id, exam_id, user_id, status, response_history, student_theta, section_score, ... }
    // Also may include Redis fields: current_module_id, current_question_index, etc.
    const frontendSession = {
      id: backendSession.id || sessionId,
      examId: backendSession.exam_id || backendSession.examId,
      currentModuleId: backendSession.current_module_id || backendSession.currentModuleId || undefined,
      currentQuestionIndex: backendSession.current_question_index !== undefined 
        ? backendSession.current_question_index 
        : (backendSession.currentQuestionIndex !== undefined ? backendSession.currentQuestionIndex : 0),
      status: backendSession.status || 'active',
      answers: convertResponseHistoryToAnswers(backendSession.response_history || []),
      finalScore: backendSession.section_score || backendSession.final_score || backendSession.finalScore,
      performanceProfile: backendSession.performance_profile || backendSession.performanceProfile,
      isSynced: true, // Mark as synced since it came from backend
      createdAt: backendSession.created_at 
        ? (typeof backendSession.created_at === 'string' 
            ? new Date(backendSession.created_at).getTime() 
            : backendSession.created_at)
        : Date.now(),
      updatedAt: backendSession.updated_at 
        ? (typeof backendSession.updated_at === 'string' 
            ? new Date(backendSession.updated_at).getTime() 
            : backendSession.updated_at)
        : Date.now()
    };

    return NextResponse.json(frontendSession);

  } catch (error: any) {
    console.error('Error fetching session from backend:', error);
    return NextResponse.json(
      { 
        error: 'Failed to fetch session',
        details: error.message 
      },
      { status: 500 }
    );
  }
}

/**
 * Convert backend response_history format to frontend answers format
 * Backend format: [{ item_id, selected_option_id, ... }]
 * Frontend format: { questionId: selectedOptionId }
 */
function convertResponseHistoryToAnswers(responseHistory: any[]): Record<string, string> {
  const answers: Record<string, string> = {};
  
  for (const response of responseHistory) {
    const questionId = response.item_id || response.questionId;
    const selectedOptionId = response.selected_option_id || response.selectedOptionId;
    
    if (questionId && selectedOptionId !== null && selectedOptionId !== undefined) {
      answers[questionId] = String(selectedOptionId);
    }
  }
  
  return answers;
}
