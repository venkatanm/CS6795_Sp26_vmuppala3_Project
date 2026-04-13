import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';

// Route segment config - ensures this route is handled correctly
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// DEBUG: Log route registration
console.log('[Sync API] 📝 Route file loaded: app/api/student/sync/route.ts');
console.log('[Sync API]   - Route path: /api/student/sync');
console.log('[Sync API]   - Dynamic: force-dynamic');
console.log('[Sync API]   - Runtime: nodejs');

/**
 * Diagnostic GET endpoint to verify route is registered
 */
export async function GET(request: NextRequest) {
  console.log('[Sync API] 🔍 GET request received - diagnostic check');
  return NextResponse.json({
    status: 'ok',
    message: 'Sync API route is registered and accessible',
    route: '/api/student/sync',
    timestamp: new Date().toISOString()
  });
}

/**
 * API Route: Sync Session to Backend
 * 
 * Proxies session sync requests to the FastAPI backend.
 * Converts frontend session format to backend sync payload format.
 */
export async function POST(request: NextRequest) {
  // DEBUG: Log that the route handler was called
  console.log('[Sync API] 🚀 Route handler called - POST /api/student/sync');
  console.log('[Sync API]   - Request URL:', request.url);
  console.log('[Sync API]   - Request method:', request.method);
  console.log('[Sync API]   - Route file: app/api/student/sync/route.ts');
  
  try {
    // Get authenticated user from Clerk
    console.log('[Sync API] 🔐 Authenticating user...');
    const { userId } = await auth();
    console.log('[Sync API]   - User ID:', userId || 'NOT AUTHENTICATED');
    
    if (!userId) {
      console.error('[Sync API] Unauthorized - User not authenticated');
      return NextResponse.json(
        { error: 'Unauthorized - User not authenticated' },
        { status: 401 }
      );
    }

    console.log('[Sync API] 📥 Parsing request body...');
    const body = await request.json();
    console.log('[Sync API]   - Body keys:', Object.keys(body));
    const { sessionId, session } = body;
    console.log('[Sync API]   - Session ID:', sessionId);
    console.log('[Sync API]   - Session object:', session ? {
      id: session.id,
      examId: session.examId,
      status: session.status,
      answerCount: Object.keys(session.answers || {}).length
    } : 'MISSING');

    if (!sessionId || !session) {
      console.error('[Sync API] ❌ Missing required fields:', { hasSessionId: !!sessionId, hasSession: !!session });
      return NextResponse.json(
        { error: 'Missing required fields: sessionId and session' },
        { status: 400 }
      );
    }

    console.log(`[Sync API] 🔄 Syncing session ${sessionId} for user ${userId}`);
    console.log(`[Sync API]   - Exam ID: ${session.examId}`);
    console.log(`[Sync API]   - Status: ${session.status}`);
    console.log(`[Sync API]   - Answer count: ${Object.keys(session.answers || {}).length}`);

    // Check if sessionId is a UUID (backend requires UUID format)
    // Diagnostic sessions with non-UUID IDs will skip backend sync
    const isSessionUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(sessionId);
    const isExamUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(session.examId || '');
    
    if (!isSessionUUID || !isExamUUID) {
      console.log(`[Sync API] ⚠️ Skipping backend sync for non-UUID session/exam (sessionId: ${sessionId}, examId: ${session.examId}) - local-only mode`);
      return NextResponse.json({
        success: false, // Changed to false - this is not a successful sync
        message: 'Session uses non-UUID format, skipping backend sync (local-only mode)',
        session_id: sessionId,
        skipBackend: true
      });
    }

    // Get backend URL from environment
    const backendUrl = process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:8000';
    console.log(`[Sync API] Backend URL: ${backendUrl}`);

    // Convert frontend session format to backend sync payload format
    // Backend expects: { sessionId, examId, responses: [{ questionId, selectedOptionId, timeSpent, timestamp }] }
    const answers = session.answers || {};
    const responses = Object.entries(answers).map(([questionId, selectedOptionId]) => ({
      questionId,
      selectedOptionId: selectedOptionId || null,
      timeSpent: 0, // TODO: Track time spent per question if needed
      timestamp: session.updatedAt || Date.now()
    }));

    const syncPayload = {
      sessionId: sessionId,
      examId: session.examId,
      responses: responses,
      // Include completion data if session is completed
      status: session.status,
      finalScore: session.finalScore || null,
      performanceProfile: session.performanceProfile || null,
      currentModuleId: session.currentModuleId || null,
      currentQuestionIndex: session.currentQuestionIndex || 0
    };

    // Call FastAPI backend sync endpoint
    const backendSyncUrl = `${backendUrl}/api/sync`;
    console.log(`[Sync API] 📤 Calling backend: ${backendSyncUrl}`);
    console.log(`[Sync API]   - Payload:`, JSON.stringify({
      sessionId: syncPayload.sessionId,
      examId: syncPayload.examId,
      responseCount: syncPayload.responses.length,
      status: syncPayload.status
    }, null, 2));
    
    const backendResponse = await fetch(backendSyncUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-User-ID': userId,
        'X-Tenant-ID': 'public' // TODO: Get tenant from user metadata if needed
      },
      body: JSON.stringify(syncPayload)
    });
    
    console.log(`[Sync API] 📥 Backend response status: ${backendResponse.status}`);

    if (!backendResponse.ok) {
      let errorText = '';
      try {
        errorText = await backendResponse.text();
      } catch (e) {
        errorText = `Failed to read error response: ${e instanceof Error ? e.message : String(e)}`;
      }
      
      // Handle 404 specifically - session might not exist in backend yet
      // The sync route should auto-create it, so 404 might mean:
      // 1. Backend route doesn't exist
      // 2. Backend is not running
      // 3. Some other error
      if (backendResponse.status === 404) {
        console.error(`[Sync API] ❌ Backend returned 404 for session ${sessionId}`);
        console.error(`[Sync API] Error text: ${errorText}`);
        console.error(`[Sync API] This could mean:`);
        console.error(`[Sync API]   1. Backend /api/sync route doesn't exist`);
        console.error(`[Sync API]   2. Backend is not running`);
        console.error(`[Sync API]   3. Session doesn't exist and auto-create failed`);
        // Return error so frontend knows it failed
        return NextResponse.json({
          success: false,
          error: 'Backend sync failed with 404',
          message: 'Backend returned 404 - check if backend is running and /api/sync route exists',
          session_id: sessionId,
          skipBackend: true,
          warning: `Backend error: ${errorText || 'No error details'}`
        }, { status: 404 });
      }
      
      console.error(`[Sync API] Backend sync failed: ${backendResponse.status} - ${errorText}`);
      console.error(`[Sync API] Backend URL: ${backendUrl}/api/sync`);
      console.error(`[Sync API] Sync payload:`, JSON.stringify(syncPayload, null, 2));
      return NextResponse.json(
        { 
          error: 'Backend sync failed',
          details: errorText || 'No error details available',
          status: backendResponse.status,
          backendUrl: `${backendUrl}/api/sync`
        },
        { status: backendResponse.status }
      );
    }

    const backendData = await backendResponse.json();
    
    console.log(`[Sync API] ✅ Backend sync successful`);
    console.log(`[Sync API]   - Backend response:`, JSON.stringify(backendData, null, 2));
    
    return NextResponse.json({
      success: true,
      message: 'Session synced successfully',
      ...backendData
    });

  } catch (error: any) {
    console.error('[Sync API] ❌ EXCEPTION in route handler:', error);
    console.error('[Sync API]   - Error name:', error?.name);
    console.error('[Sync API]   - Error message:', error?.message);
    console.error('[Sync API]   - Error type:', error?.constructor?.name);
    console.error('[Sync API]   - Error stack:', error instanceof Error ? error.stack : 'No stack trace');
    console.error('[Sync API]   - Full error object:', error);
    
    return NextResponse.json(
      { 
        error: 'Failed to sync session',
        details: error?.message || String(error) || 'Unknown error',
        type: error?.constructor?.name || 'Unknown',
        route: '/api/student/sync',
        timestamp: new Date().toISOString()
      },
      { status: 500 }
    );
  }
}
