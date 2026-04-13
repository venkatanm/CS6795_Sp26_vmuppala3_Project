'use client';

import { useCallback, useEffect, useMemo, useState, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { ExamProvider, useExam } from '@/src/context/ExamContext';
import ExamRunner from '@/src/components/ExamRunner';
import Intermission from '@/src/components/exam/Intermission';
import { db } from '@/src/lib/db';
import { examLoader } from '@/src/services/ExamLoader';

type SimulationStep = 'RW' | 'BREAK' | 'MATH';
type SimulationType = 'SIMULATION_RW' | 'SIMULATION_MATH';

const MOCK_PROGRESS_KEY = 'mock_progress';

// Full-length simulation exam UUIDs seeded in exam_definitions table.
// Override via env vars if needed (e.g. for staging/prod).
const SIMULATION_RW_EXAM_ID =
  process.env.NEXT_PUBLIC_SIMULATION_RW_EXAM_ID ||
  '550e8400-e29b-41d4-a716-446655440003';
const SIMULATION_MATH_EXAM_ID =
  process.env.NEXT_PUBLIC_SIMULATION_MATH_EXAM_ID ||
  '550e8400-e29b-41d4-a716-446655440002';

function isSimulationStep(value: unknown): value is SimulationStep {
  return value === 'RW' || value === 'BREAK' || value === 'MATH';
}

function useSimulationFlow() {
  const [step, setStep] = useState<SimulationStep>('RW');

  // Hydrate from localStorage on mount
  useEffect(() => {
    try {
      const raw = localStorage.getItem(MOCK_PROGRESS_KEY);
      if (raw && isSimulationStep(raw)) {
        setStep(raw);
      }
    } catch {
      // ignore (e.g. storage unavailable)
    }
  }, []);

  // Persist to localStorage
  useEffect(() => {
    try {
      localStorage.setItem(MOCK_PROGRESS_KEY, step);
    } catch {
      // ignore
    }
  }, [step]);

  return { step, setStep };
}

async function findActiveSessionIdForExam(examId: string): Promise<string | null> {
  // 1) Prefer local IndexedDB (offline-first)
  try {
    const sessions = await db.sessions.toArray();
    const localActive = sessions.find(
      (s) => s.examId === examId && s.status === 'active'
    );
    if (localActive?.id) return localActive.id;
  } catch {
    // ignore
  }

  // 2) Best-effort backend check via Next API proxy
  try {
    const resp = await fetch('/api/student/sessions', { method: 'GET' });
    if (!resp.ok) return null;
    const sessions = (await resp.json()) as Array<any>;
    const serverActive = sessions.find(
      (s) => s.examId === examId && (s.status === 'active' || s.status === 'in_progress' as string)
    );
    return serverActive?.id || null;
  } catch {
    return null;
  }
}

async function createOrResumeSession(examId: string): Promise<string> {
  const activeId = await findActiveSessionIdForExam(examId);
  if (activeId) return activeId;

  const sessionId = `session-${Date.now()}`;

  // Best-effort backend session creation (works only if examId is a UUID)
  let backendSessionId = sessionId;
  let isBackendCreated = false;
  try {
    const createResp = await fetch('/api/student/sessions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId, examId }),
    });
    if (createResp.ok) {
      const data = await createResp.json();
      backendSessionId = data.session_id || sessionId;
      isBackendCreated = true;
    }
  } catch {
    // local-only mode
  }

  await db.sessions.put({
    id: backendSessionId,
    examId,
    isSynced: isBackendCreated,
    currentModuleId: undefined,
    currentQuestionIndex: 0,
    status: 'active',
    answers: {},
    createdAt: Date.now(),
    updatedAt: Date.now(),
  } as any);

  return backendSessionId;
}

function ExamInterface({
  type,
  onComplete,
}: {
  type: SimulationType;
  onComplete: () => void;
}) {
  const router = useRouter();
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const examId = useMemo(() => {
    return type === 'SIMULATION_RW' ? SIMULATION_RW_EXAM_ID : SIMULATION_MATH_EXAM_ID;
  }, [type]);

  const initialTimeRemaining = type === 'SIMULATION_RW' ? 32 * 60 : 35 * 60;
  const totalQuestions = type === 'SIMULATION_RW' ? 54 : 44;

  // Resume/create session on mount + whenever examId changes
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        setError(null);
        
        // Now create or resume the session
        const id = await createOrResumeSession(examId);
        if (cancelled) return;
        setSessionId(id);
      } catch (e: any) {
        if (cancelled) return;
        setError(e?.message || 'Failed to start simulation session');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [examId]);

  // When exam completes, clear mock_progress and run callback
  const handleComplete = useCallback(() => {
    try {
      localStorage.removeItem(MOCK_PROGRESS_KEY);
    } catch {
      // ignore
    }
    onComplete();
  }, [onComplete]);

  function CompletionWatcher({ onDone }: { onDone: () => void }) {
    const { state } = useExam();
    const doneRef = useRef(false);

    useEffect(() => {
      if (doneRef.current) return;
      if (state.session?.status === 'completed') {
        doneRef.current = true;
        onDone();
      }
    }, [state.session?.status, onDone]);

    return null;
  }

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center p-6">
        <div className="max-w-lg w-full rounded-xl border border-red-200 bg-red-50 p-6 text-red-800">
          <div className="font-semibold mb-2">Unable to start simulation</div>
          <div className="text-sm whitespace-pre-wrap">{error}</div>
          <div className="mt-4 flex gap-2">
            <button
              className="px-4 py-2 rounded-lg bg-white border border-red-200 hover:bg-red-100 text-sm"
              onClick={() => router.push('/dashboard')}
            >
              Back to Dashboard
            </button>
            <button
              className="px-4 py-2 rounded-lg bg-red-600 hover:bg-red-700 text-white text-sm"
              onClick={() => window.location.reload()}
            >
              Retry
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (!sessionId) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-lg animate-pulse text-gray-700">Starting simulation…</div>
      </div>
    );
  }

  return (
    <ExamProvider>
      <CompletionWatcher onDone={handleComplete} />
      <ExamRunner
        sessionId={sessionId}
        initialTimeRemaining={initialTimeRemaining}
        totalQuestions={totalQuestions}
      />
    </ExamProvider>
  );
}

export default function SimulationControllerPage() {
  const router = useRouter();
  const { step, setStep } = useSimulationFlow();

  if (step === 'RW') {
    return <ExamInterface type="SIMULATION_RW" onComplete={() => setStep('BREAK')} />;
  }

  if (step === 'BREAK') {
    return <Intermission onComplete={() => setStep('MATH')} />;
  }

  return (
    <ExamInterface
      type="SIMULATION_MATH"
      onComplete={() => {
        setStep('RW'); // reset for next time
        router.push('/dashboard');
      }}
    />
  );
}

