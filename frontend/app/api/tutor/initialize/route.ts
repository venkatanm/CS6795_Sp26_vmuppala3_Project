/**
 * Socratic Tutor Initialize API Route
 * Initializes a tutor session for a specific question
 */

import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Initialize a tutor session
 * This endpoint is called when the ChatPanel opens to set up context
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { questionId, sessionId, studentAnswer } = body;

    if (!questionId || !sessionId) {
      return NextResponse.json(
        { error: "questionId and sessionId are required" },
        { status: 400 }
      );
    }

    // For now, we don't need to do anything special on initialization
    // The chat/stream endpoint will handle the actual conversation
    // This endpoint exists to satisfy the frontend hook's initialization call
    
    // Optionally, we could return an initial greeting message here
    // For now, return empty to let the user start the conversation
    
    return NextResponse.json({
      success: true,
      initialMessage: null, // No initial message - user will send first message
    });
  } catch (error: any) {
    console.error("Error in POST /api/tutor/initialize:", error);
    return NextResponse.json(
      { error: error.message || "Internal server error" },
      { status: 500 }
    );
  }
}
