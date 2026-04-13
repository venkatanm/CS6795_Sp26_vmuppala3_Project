import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';

// Route segment config - ensures this route is handled correctly
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * API Route: Create Session in Backend
 * 
 * Creates a new exam session in the FastAPI backend.
 * This ensures sessions exist in the backend before syncing responses.
 */
export async function POST(request: NextRequest) {
  try {
    // Get authenticated user from Clerk
    const { userId } = await auth();
    
    if (!userId) {
      return NextResponse.json(
        { error: 'Unauthorized - User not authenticated' },
        { status: 401 }
      );
    }

    const body = await request.json();
    const { sessionId, examId } = body;

    if (!sessionId || !examId) {
      return NextResponse.json(
        { error: 'Missing required fields: sessionId and examId' },
        { status: 400 }
      );
    }

    // Check if exam_id is a UUID (backend requires UUID format)
    // All exams should use UUID format for backend storage
    const isUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(examId);
    
    if (!isUUID) {
      console.log(`[Sessions API] Skipping backend session creation for non-UUID exam_id: ${examId} (diagnostic exam - local-only mode)`);
      return NextResponse.json({
        success: true,
        message: 'Session will be created locally only (diagnostic exam)',
        session_id: sessionId,
        exam_id: examId,
        user_id: userId,
        skipBackend: true
      });
    }

    // Get backend URL from environment
    const backendUrl = process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:8000';

    // Call FastAPI backend to create session
    // Backend expects: { exam_id: string, user_id: string }
    // Note: Backend route is mounted at /sessions (not /api/sessions)
    console.log(`[Sessions API] Attempting to create session in backend:`, {
      backendUrl: `${backendUrl}/sessions`,
      examId,
      userId,
      sessionId
    });
    
    let backendResponse: Response;
    try {
      backendResponse = await fetch(`${backendUrl}/sessions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-User-ID': userId,
        'X-Tenant-ID': 'public'
      },
      body: JSON.stringify({
        exam_id: examId,
        user_id: userId
      })
      });
      
      console.log(`[Sessions API] Backend response status: ${backendResponse.status}`);
    } catch (networkError: any) {
      // Network error (backend not reachable)
      console.warn(`[Sessions API] Backend not reachable (${backendUrl}/sessions), creating local-only session:`, networkError.message);
      return NextResponse.json({
        success: true,
        message: 'Backend not available, session will be created locally only',
        session_id: sessionId,
        exam_id: examId,
        user_id: userId,
        skipBackend: true,
        warning: 'Backend connection failed'
      });
    }

    if (!backendResponse.ok) {
      let errorText = '';
      try {
        errorText = await backendResponse.text();
      } catch (e) {
        errorText = `Failed to read error response: ${e instanceof Error ? e.message : String(e)}`;
      }
      
      console.error(`[Sessions API] Backend session creation failed: ${backendResponse.status} - ${errorText}`);
      console.error(`[Sessions API] Backend URL: ${backendUrl}/sessions`);
      console.error(`[Sessions API] Request payload:`, JSON.stringify({ exam_id: examId, user_id: userId }, null, 2));
      
      // If session already exists (409), that's okay - return success
      if (backendResponse.status === 409 || backendResponse.status === 400) {
        // Check if error indicates session already exists
        if (errorText.includes('already exists') || errorText.includes('duplicate')) {
          return NextResponse.json({
            success: true,
            message: 'Session already exists in backend',
            session_id: sessionId
          });
        }
      }
      
      // For 400 errors (invalid exam_id format), return graceful error
      if (backendResponse.status === 400 && (errorText.includes('Invalid exam_id') || errorText.includes('UUID'))) {
        console.warn(`[Sessions API] Backend rejected non-UUID exam_id (${examId}), creating local-only session`);
        return NextResponse.json({
          success: true,
          message: 'Backend requires UUID exam_id, session will be created locally only',
          session_id: sessionId,
          exam_id: examId,
          user_id: userId,
          skipBackend: true
        });
      }
      
      // For 404 errors (exam not found in backend), allow local-only mode
      // This happens when the exam definition hasn't been created in the backend yet
      // NOTE: The sync route will auto-create the session when syncing, so this is OK
      if (backendResponse.status === 404) {
        console.warn(`[Sessions API] Backend returned 404 for exam ${examId}. This is OK - the session will be auto-created during sync.`);
        console.warn(`[Sessions API] Error details: ${errorText}`);
        return NextResponse.json({
          success: true,
          message: 'Exam not found in backend, session will be created locally. Session will be auto-created in backend during sync.',
          session_id: sessionId,
          exam_id: examId,
          user_id: userId,
          skipBackend: true,
          warning: 'Exam definition not found in backend - session will be created during sync'
        });
      }
      
      // For 500 errors or other backend errors, log but allow local-only mode
      console.warn(`[Sessions API] Backend returned ${backendResponse.status}, creating local-only session`);
      return NextResponse.json({
        success: true,
        message: 'Backend session creation failed, session will be created locally only',
        session_id: sessionId,
        exam_id: examId,
        user_id: userId,
        skipBackend: true,
        warning: `Backend error: ${errorText || 'Unknown error'}`
      });
    }

    const backendData = await backendResponse.json();
    
    // Backend returns: { session_id, exam_id, user_id, message }
    // Use the session_id from backend if different, or use the one we provided
    const createdSessionId = backendData.session_id || sessionId;
    
    return NextResponse.json({
      success: true,
      message: 'Session created successfully in backend',
      session_id: createdSessionId,
      exam_id: backendData.exam_id || examId,
      user_id: backendData.user_id || userId
    });

  } catch (error: any) {
    console.error('Error creating session in backend:', error);
    return NextResponse.json(
      { 
        error: 'Failed to create session in backend',
        details: error.message 
      },
      { status: 500 }
    );
  }
}

/**
 * API Route: List All User Sessions from Backend
 * 
 * Fetches all exam sessions for the authenticated user from the FastAPI backend.
 * Used for dashboard hydration on login.
 */
export async function GET(request: NextRequest) {
  try {
    // Get authenticated user from Clerk
    const { userId } = await auth();
    
    if (!userId) {
      return NextResponse.json(
        { error: 'Unauthorized - User not authenticated' },
        { status: 401 }
      );
    }

    console.log(`[Sessions API] Fetching sessions for Clerk userId: ${userId}`);
    console.log(`[Sessions API] Note: Backend uses Clerk userId (not email) to identify users`);

    // Get backend URL from environment
    const backendUrl = process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:8000';

    // Call FastAPI backend to list user sessions
    // Note: Backend route is mounted at /sessions (not /api/sessions)
    // The backend GET /sessions endpoint filters by user_id (from query param or X-User-ID header)
    const backendUrlWithQuery = `${backendUrl}/sessions?user_id=${userId}`;
    console.log(`[Sessions API] Calling backend: ${backendUrlWithQuery}`);
    
    const backendResponse = await fetch(backendUrlWithQuery, {
      method: 'GET',
      headers: {
        'X-User-ID': userId,
        'X-Tenant-ID': 'public'
      }
    });

    if (!backendResponse.ok) {
      // If endpoint doesn't exist (404) or other error, return empty array
      // This allows the dashboard to work with local-only sessions
      const errorText = await backendResponse.text();
      console.warn(`[Sessions API] Backend sessions fetch failed: ${backendResponse.status} - ${errorText}`);
      console.warn(`[Sessions API] Backend URL: ${backendUrlWithQuery}`);
      console.warn(`[Sessions API] Clerk userId being used: ${userId}`);
      
      if (backendResponse.status === 404) {
        console.log('[Sessions API] Backend sessions endpoint not found (404), returning empty array - will use local-only mode');
        console.log('[Sessions API] This could mean:');
        console.log('[Sessions API]   1. Backend endpoint /sessions does not exist');
        console.log('[Sessions API]   2. No sessions exist for this userId in the backend');
        console.log('[Sessions API]   3. Backend is not running');
      } else {
        console.error(`[Sessions API] Backend sessions fetch error: ${backendResponse.status} - ${errorText}`);
      }
      
      // Return empty array instead of error to allow local-only mode
      return NextResponse.json([]);
    }

    const backendSessions = await backendResponse.json();
    console.log(`[Sessions API] ✅ Successfully fetched ${backendSessions.length} sessions from backend for userId: ${userId}`);
    
    // Transform backend sessions to frontend format
    // Backend format may vary, so we handle multiple possible structures
    const transformedSessions = Array.isArray(backendSessions) 
      ? backendSessions.map((session: any) => ({
          id: session.id || session.session_id,
          examId: session.exam_id || session.examId,
          status: session.status || 'active',
          finalScore: session.section_score || session.final_score || session.finalScore || session.score,
          performanceProfile: session.performance_profile || session.performanceProfile,
          answers: session.response_history 
            ? session.response_history.reduce((acc: Record<string, string>, response: any) => {
                if (response.item_id && response.selected_option_id !== undefined) {
                  acc[response.item_id] = String(response.selected_option_id);
                }
                return acc;
              }, {})
            : session.answers || {},
          currentModuleId: session.current_module_id || session.currentModuleId,
          currentQuestionIndex: session.current_question_index !== undefined 
            ? session.current_question_index 
            : (session.currentQuestionIndex !== undefined ? session.currentQuestionIndex : 0),
          isSynced: true,
          createdAt: session.created_at 
            ? (typeof session.created_at === 'string' 
                ? new Date(session.created_at).getTime() 
                : session.created_at)
            : Date.now(),
          updatedAt: session.updated_at 
            ? (typeof session.updated_at === 'string' 
                ? new Date(session.updated_at).getTime() 
                : session.updated_at)
            : Date.now()
        }))
      : [];

    return NextResponse.json(transformedSessions);

  } catch (error: any) {
    console.error('Error fetching sessions from backend:', error);
    // Return empty array instead of error to allow local-only mode
    return NextResponse.json([]);
  }
}
