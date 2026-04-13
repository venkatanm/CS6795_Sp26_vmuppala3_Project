import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';

// Route segment config - ensures this route is handled correctly
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// DEBUG: Log route registration
console.log('[Submit Module API] 📝 Route file loaded: app/api/exam/submit-module/route.ts');
console.log('[Submit Module API]   - Route path: /api/exam/submit-module');

/**
 * API Route: Submit Module
 * 
 * Proxies module submission requests to the FastAPI backend.
 * Handles authentication and adds X-User-ID header.
 */
export async function POST(request: NextRequest) {
  // DEBUG: Log that the route handler was called
  console.log('[Submit Module API] 🚀 Route handler called - POST /api/exam/submit-module');
  console.log('[Submit Module API]   - Request URL:', request.url);
  console.log('[Submit Module API]   - Request method:', request.method);
  
  try {
    // Get authenticated user from Clerk
    console.log('[Submit Module API] 🔐 Authenticating user...');
    const { userId } = await auth();
    console.log('[Submit Module API]   - User ID:', userId || 'NOT AUTHENTICATED');
    
    if (!userId) {
      console.error('[Submit Module API] Unauthorized - User not authenticated');
      return NextResponse.json(
        { error: 'Unauthorized - User not authenticated' },
        { status: 401 }
      );
    }

    console.log('[Submit Module API] 📥 Parsing request body...');
    const body = await request.json();
    console.log('[Submit Module API]   - Body keys:', Object.keys(body));
    const { session_id, module_id, responses } = body;

    if (!session_id || !module_id || !responses) {
      console.error('[Submit Module API] ❌ Missing required fields:', { 
        hasSessionId: !!session_id, 
        hasModuleId: !!module_id, 
        hasResponses: !!responses 
      });
      return NextResponse.json(
        { error: 'Missing required fields: session_id, module_id, responses' },
        { status: 400 }
      );
    }

    // Get backend URL from environment
    const backendUrl = process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:8000';

    console.log(`[Submit Module API] 📤 Calling backend: ${backendUrl}/api/exam/submit-module`);
    console.log(`[Submit Module API]   - Session ID: ${session_id}`);
    console.log(`[Submit Module API]   - Module ID: ${module_id}`);
    console.log(`[Submit Module API]   - Response count: ${responses?.length || 0}`);
    console.log(`[Submit Module API]   - User ID: ${userId}`);

    // Call FastAPI backend submit-module endpoint
    const backendResponse = await fetch(`${backendUrl}/api/exam/submit-module`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-User-ID': userId,
        'X-Tenant-ID': 'public'
      },
      body: JSON.stringify({
        session_id,
        module_id,
        responses
      })
    });

    console.log(`[Submit Module API] 📥 Backend response status: ${backendResponse.status}`);

    if (!backendResponse.ok) {
      let errorText = '';
      try {
        errorText = await backendResponse.text();
      } catch (e) {
        errorText = `Failed to read error response: ${e instanceof Error ? e.message : String(e)}`;
      }
      console.error('[Submit Module API] ❌ Backend error:', {
        status: backendResponse.status,
        statusText: backendResponse.statusText,
        errorText: errorText,
        backendUrl: `${backendUrl}/api/exam/submit-module`,
        userId: userId
      });
      return NextResponse.json(
        { error: `Backend error: ${backendResponse.status}`, details: errorText },
        { status: backendResponse.status }
      );
    }

    const result = await backendResponse.json();
    console.log('[Submit Module API] ✅ Backend response:', JSON.stringify(result, null, 2));
    return NextResponse.json(result);
  } catch (error: any) {
    console.error('[Submit Module API] Error:', error);
    return NextResponse.json(
      { error: 'Internal server error', details: error.message },
      { status: 500 }
    );
  }
}
