import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * API Route: Get Current Module
 *
 * Proxies GET requests to the FastAPI backend /session/{session_id}/current-module.
 * Handles authentication and adds X-User-ID, X-Tenant-ID headers.
 * Supports optional ?module_id= for review mode.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> }
) {
  try {
    const { sessionId } = await params;
    if (!sessionId) {
      return NextResponse.json(
        { error: 'Missing sessionId' },
        { status: 400 }
      );
    }

    const { userId } = await auth();

    const backendUrl = process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:8000';
    const url = new URL(request.url);
    const queryString = url.search;
    const backendPath = `${backendUrl}/api/exam/session/${sessionId}/current-module${queryString}`;

    const headers: Record<string, string> = {
      'X-Tenant-ID': 'public',
    };
    if (userId) {
      headers['X-User-ID'] = userId;
    }

    const backendResponse = await fetch(backendPath, {
      method: 'GET',
      headers,
    });

    if (!backendResponse.ok) {
      let errorText = '';
      try {
        errorText = await backendResponse.text();
      } catch {
        errorText = 'Failed to read error response';
      }
      return NextResponse.json(
        { error: `Backend error: ${backendResponse.status}`, details: errorText },
        { status: backendResponse.status }
      );
    }

    const result = await backendResponse.json();
    return NextResponse.json(result);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json(
      { error: 'Internal server error', details: message },
      { status: 500 }
    );
  }
}
