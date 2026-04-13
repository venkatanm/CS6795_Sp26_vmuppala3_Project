'use client'; // <--- CRITICAL: This tells Next.js to run this in the browser, not the server

import React from 'react';
import { useParams } from 'next/navigation'; // App Router hook
import { ExamProvider } from '@/src/context/ExamContext';
import ExamRunner from '@/src/components/ExamRunner'; // Ensure this path matches where ExamRunner.tsx is located

export default function SimulationPage() {
  // 1. Get the ID from the URL
  const params = useParams();
  const sessionId = params?.sessionId as string;

  // 2. Safety Check
  if (!sessionId) {
    return (
      <div className="flex h-screen items-center justify-center">
        <div className="text-xl animate-pulse">Initializing Environment...</div>
      </div>
    );
  }

  // 3. Render the Offline Exam Engine
  return (
    <ExamProvider>
      <ExamRunner sessionId={sessionId} />
    </ExamProvider>
  );
}
