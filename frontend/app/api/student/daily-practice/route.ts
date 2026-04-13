import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';

const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:8000';

export async function POST(request: NextRequest) {
  try {
    const { userId } = await auth();
    
    if (!userId) {
      return NextResponse.json(
        { detail: 'Unauthorized' },
        { status: 401 }
      );
    }

    // Read domain from URL (Math or RW for domain-specific daily test)
    const { searchParams } = new URL(request.url);
    const domain = searchParams.get('domain') || '';
    const url = domain ? `${BACKEND_URL}/student/daily-practice?domain=${encodeURIComponent(domain)}` : `${BACKEND_URL}/student/daily-practice`;

    // Proxy request to backend
    const backendResponse = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-User-ID': userId,
        'X-Tenant-ID': 'public',
      },
    });

    if (!backendResponse.ok) {
      const errorData = await backendResponse.json().catch(() => ({ 
        detail: `Backend error: ${backendResponse.status}` 
      }));
      return NextResponse.json(
        errorData,
        { status: backendResponse.status }
      );
    }

    const data = await backendResponse.json();
    return NextResponse.json(data);
  } catch (error: any) {
    console.error('Error in daily-practice API route:', error);
    return NextResponse.json(
      { detail: error.message || 'Internal server error' },
      { status: 500 }
    );
  }
}
