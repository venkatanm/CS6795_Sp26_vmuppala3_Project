'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useExamStore } from '../store/exam-store';
import Image from 'next/image';

export default function Home() {
  const router = useRouter();
  const { startExam, isLoading } = useExamStore();
  const [studentName, setStudentName] = useState('');
  const [error, setError] = useState<string | null>(null);

  const handleStartExam = async () => {
    if (!studentName.trim()) {
      setError('Please enter your name');
      return;
    }

    setError(null);
    
    try {
      const sessionId = await startExam(studentName);
      router.push(`/exam/${sessionId}`);
    } catch (err: any) {
      setError(err.message || 'Failed to start exam. Please try again.');
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-zinc-50 font-sans dark:bg-black">
      <main className="flex min-h-screen w-full max-w-3xl flex-col items-center justify-between py-32 px-16 bg-white dark:bg-black sm:items-start">
        <Image
          className="dark:invert"
          src="/next.svg"
          alt="Next.js logo"
          width={100}
          height={20}
          priority
        />
        <div className="flex flex-col items-center gap-6 text-center sm:items-start sm:text-left">
          <h1 className="max-w-xs text-3xl font-semibold leading-10 tracking-tight text-black dark:text-zinc-50">
            Start Mock Exam
          </h1>
          <p className="max-w-md text-lg leading-8 text-zinc-600 dark:text-zinc-400">
            Enter your name to begin the exam session.
          </p>
          
          <div className="flex flex-col gap-4 w-full max-w-md">
            <div>
              <input
                type="text"
                value={studentName}
                onChange={(e) => setStudentName(e.target.value)}
                placeholder="Enter your name"
                className="w-full px-4 py-2 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-black dark:text-zinc-50 focus:outline-none focus:ring-2 focus:ring-zinc-500 dark:focus:ring-zinc-400"
                disabled={isLoading}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !isLoading) {
                    handleStartExam();
                  }
                }}
              />
            </div>
            
            {error && (
              <div className="text-red-600 dark:text-red-400 text-sm">
                {error}
              </div>
            )}
            
            <button
              onClick={handleStartExam}
              disabled={isLoading || !studentName.trim()}
              className="flex h-12 w-full items-center justify-center gap-2 rounded-full bg-foreground px-5 text-background transition-colors hover:bg-[#383838] dark:hover:bg-[#ccc] disabled:opacity-50 disabled:cursor-not-allowed md:w-[200px]"
            >
              {isLoading ? 'Starting...' : 'Start Mock Exam'}
            </button>
          </div>
        </div>
      </main>
    </div>
  );
}
