'use client';

// Route segment config - prevents server action caching issues
export const dynamic = 'force-dynamic';

import { useEffect, useState } from 'react';
import { useUser, UserButton } from '@clerk/nextjs';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Brain, BookOpen, History, Settings, FileQuestion, Clock, Stethoscope, GraduationCap } from 'lucide-react';
import { db } from '@/src/lib/db';
import { ExamProvider, useExam } from '@/src/context/ExamContext';
import DiagnosticCards from '@/src/components/dashboard/DiagnosticCards';
import ProgressPanel from '@/src/components/dashboard/ProgressPanel';

interface Exam {
  id: string;
  title: string;
  description?: string;
  question_count?: number;
  time_limit_seconds?: number;
}

interface Session {
  id: string;
  exam_id: string;
  examId?: string; // For DiagnosticCards compatibility
  exam_title: string;
  status: string;
  score: number | null;
  finalScore?: number | null; // For DiagnosticCards compatibility
  created_at: string;
  start_time?: string;
  end_time?: string;
  time_taken?: number;
}


/**
 * Inner Dashboard Component that uses ExamContext
 */
function DashboardContent() {
  const { user, isLoaded } = useUser();
  const router = useRouter();
  const { actions } = useExam();
  
  // Log user info for debugging
  useEffect(() => {
    if (user) {
      console.log('[Dashboard] User info:', {
        userId: user.id,
        email: user.emailAddresses?.[0]?.emailAddress || user.primaryEmailAddress?.emailAddress || 'N/A',
        firstName: user.firstName,
        lastName: user.lastName
      });
      console.log('[Dashboard] Note: Backend uses Clerk userId (not email) to identify users');
      console.log('[Dashboard] Backend will query sessions for userId:', user.id);
    }
  }, [user]);
  const [exams, setExams] = useState<Exam[]>([]);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadingExams, setLoadingExams] = useState(false);
  const [loadingSessions, setLoadingSessions] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sessionRefreshKey, setSessionRefreshKey] = useState(0);
  const [recommendations, setRecommendations] = useState<{
    has_profile: boolean;
    top_concepts: Array<{ concept: string; accuracy: number; total_questions: number; priority: number }>;
    daily_focus: string | null;
    message: string;
    total_sessions?: number;
  } | null>(null);

  useEffect(() => {
    if (!isLoaded) return;

    if (!user) {
      router.push('/');
      return;
    }

    // Note: Exams are no longer cached in IndexedDB (module-based fetching)
    // For now, we'll keep exams empty as we're focusing on sessions
    const fetchExams = async () => {
      try {
        setIsLoading(true);
        // Exams are fetched on-demand from backend, not cached locally
        // Set empty array for now - can be enhanced to fetch from backend if needed
        setExams([]);
      } catch (err: any) {
        // Filter out Axios/Network errors - these are not relevant for offline-first IndexedDB
        const isAxiosError = err?.isAxiosError || 
                            err?.code === 'ERR_NETWORK' || 
                            err?.message?.includes('Network Error') ||
                            err?.message?.includes('Request failed');
        
        if (!isAxiosError) {
          console.error('Failed to fetch exams from IndexedDB:', err);
          setError('Failed to load exams from local database');
        } else {
          // Silently ignore Axios/Network errors (we're offline-first now)
          console.debug('Ignored Axios/Network error in fetchExams (offline-first mode)');
        }
      } finally {
        setIsLoading(false);
      }
    };

    const fetchSessions = async () => {
      try {
        setLoadingSessions(true);
        
        // 1. Fetch sessions from backend first (for cross-device persistence)
        let backendSessions: any[] = [];
        try {
          console.log('[Dashboard] 🔄 Fetching sessions from backend...');
          const backendResponse = await fetch('/api/student/sessions');
          if (backendResponse.ok) {
            backendSessions = await backendResponse.json();
            console.log(`[Dashboard] ✅ Fetched ${backendSessions.length} sessions from backend`);
            console.log('[Dashboard] 📊 Backend sessions data:', JSON.stringify(backendSessions, null, 2));
            
            if (backendSessions.length === 0) {
              console.log('[Dashboard] ℹ️ No sessions found in backend (user may not have completed any exams yet)');
              // If backend has no sessions, clear diagnostic sessions from IndexedDB
              // This handles the case where reset_diagnostic.py deleted backend sessions
              const diagnosticExamIds = [
                '550e8400-e29b-41d4-a716-446655440000', // DIAGNOSTIC_MATH
                '550e8400-e29b-41d4-a716-446655440001'  // DIAGNOSTIC_RW
              ];
              const localDiagnosticSessions = await db.sessions
                .where('examId')
                .anyOf(diagnosticExamIds)
                .toArray();
              // DON'T clear local sessions if backend has none - they might be syncing
              // Only clear if they're explicitly marked as synced but don't exist in backend
              // This prevents deleting sessions that are in the process of syncing
              const syncedButMissing = localDiagnosticSessions.filter(
                s => s.isSynced === true && s.status !== 'completed'
              );
              if (syncedButMissing.length > 0) {
                console.log(`[Dashboard] 🧹 Clearing ${syncedButMissing.length} synced diagnostic session(s) from IndexedDB (backend has none and they're not completed)`);
                await db.sessions.bulkDelete(syncedButMissing.map(s => s.id));
              } else if (localDiagnosticSessions.length > 0) {
                console.log(`[Dashboard] ℹ️ Keeping ${localDiagnosticSessions.length} local diagnostic session(s) - they may be syncing or are completed`);
              }
            } else {
              // Log details about completed sessions
              const completedSessions = backendSessions.filter((s: any) => s.status === 'completed');
              console.log(`[Dashboard] 📈 Found ${completedSessions.length} completed sessions`);
              completedSessions.forEach((s: any) => {
                console.log(`[Dashboard]   - Session ${s.id}: score=${s.finalScore}, hasProfile=${!!s.performanceProfile}`);
              });
              
              // Remove local diagnostic sessions that don't exist in backend
              // This handles the case where reset_diagnostic.py deleted backend sessions
              const diagnosticExamIds = [
                '550e8400-e29b-41d4-a716-446655440000', // DIAGNOSTIC_MATH
                '550e8400-e29b-41d4-a716-446655440001'  // DIAGNOSTIC_RW
              ];
              const backendSessionIds = new Set(backendSessions.map((s: any) => s.id));
              const localDiagnosticSessions = await db.sessions
                .where('examId')
                .anyOf(diagnosticExamIds)
                .toArray();
              const orphanedSessions = localDiagnosticSessions.filter(
                s => !backendSessionIds.has(s.id)
              );
              if (orphanedSessions.length > 0) {
                console.log(`[Dashboard] 🧹 Removing ${orphanedSessions.length} orphaned diagnostic session(s) from IndexedDB`);
                await db.sessions.bulkDelete(orphanedSessions.map(s => s.id));
              }
            }
            
            // Save backend sessions to local IndexedDB for offline access
            for (const backendSession of backendSessions) {
              try {
                await db.sessions.put({
                  id: backendSession.id,
                  examId: backendSession.examId,
                  isSynced: true,
                  status: backendSession.status || 'active',
                  finalScore: backendSession.finalScore,
                  performanceProfile: backendSession.performanceProfile,
                  answers: backendSession.answers || {},
                  currentModuleId: backendSession.currentModuleId,
                  currentQuestionIndex: backendSession.currentQuestionIndex || 0,
                  createdAt: backendSession.createdAt || Date.now(),
                  updatedAt: backendSession.updatedAt || Date.now()
                });
              } catch (dbError) {
                console.warn(`Failed to save backend session ${backendSession.id} to IndexedDB:`, dbError);
              }
            }
          } else {
            console.warn('⚠️ Backend sessions fetch failed, continuing with local-only mode');
          }
        } catch (backendError) {
          console.warn('⚠️ Error fetching sessions from backend (offline mode):', backendError);
          // Continue with local-only mode
        }
        
        // 2. Fetch sessions from local IndexedDB
        const localSessions = await db.sessions.toArray();
        
        // 3. Merge backend and local sessions (backend takes precedence for duplicates)
        const sessionMap = new Map<string, any>();
        
        // Add local sessions first
        localSessions.forEach(session => {
          sessionMap.set(session.id, session);
        });
        
        // Override with backend sessions (they're more up-to-date)
        // BUT: If a local session is marked as 'completed' and backend shows 'active' or doesn't exist,
        // prefer the local 'completed' status (sync might be pending)
        backendSessions.forEach(backendSession => {
          const localSession = sessionMap.get(backendSession.id);
          // If local session is completed but backend shows non-completed status, keep local status
          // This handles the case where sync hasn't completed yet, or backend has an intermediate
          // status like "MODULE_1_COMPLETE" that hasn't been updated to "completed" yet
          if (localSession && localSession.status === 'completed' && backendSession.status !== 'completed') {
            console.log(`[Dashboard] ⚠️ Local session ${backendSession.id} is completed but backend shows ${backendSession.status} - using local status`);
            // Update backend session with local completed status
            backendSession.status = 'completed';
            backendSession.finalScore = localSession.finalScore || backendSession.finalScore;
            backendSession.performanceProfile = localSession.performanceProfile || backendSession.performanceProfile;
          }
          sessionMap.set(backendSession.id, backendSession);
        });
        
        // Also check for local completed sessions that don't exist in backend yet
        // Don't delete them - they might be syncing
        const localCompletedSessions = Array.from(sessionMap.values()).filter(
          s => s.status === 'completed' && !backendSessions.find(bs => bs.id === s.id)
        );
        if (localCompletedSessions.length > 0) {
          console.log(`[Dashboard] ℹ️ Found ${localCompletedSessions.length} local completed session(s) not yet in backend - keeping them (sync may be in progress)`);
        }
        
        // Convert to array and sort by updatedAt descending (most recent first)
        const allSessions = Array.from(sessionMap.values());
        allSessions.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
        
        // 4. Fetch exam titles from backend (or use examId as fallback)
        // Since we no longer cache examContent, we'll fetch titles on-demand or use examId
        const examTitleMap = new Map<string, string>();
        
        // Try to fetch exam titles from backend for unique exam IDs
        const uniqueExamIds = Array.from(new Set(allSessions.map(s => s.examId).filter(Boolean)));

        // Fetch exam titles in parallel (with error handling)
        // Uses Next.js API proxy to avoid CORS issues with direct backend calls
        await Promise.allSettled(
          uniqueExamIds.map(async (examId) => {
            try {
              const response = await fetch(`/api/exams/${examId}`);
              if (response.ok) {
                try {
                  const examData = await response.json();
                  examTitleMap.set(examId, examData.title || examId);
                } catch (jsonError) {
                  // If JSON parsing fails, use examId as fallback
                  console.warn(`Failed to parse exam data for ${examId}:`, jsonError);
                  examTitleMap.set(examId, examId);
                }
              } else {
                // Fallback to examId if fetch fails
                examTitleMap.set(examId, examId);
              }
            } catch (err) {
              // Fallback to examId on error
              console.warn(`Failed to fetch exam title for ${examId}:`, err);
              examTitleMap.set(examId, examId);
            }
          })
        );
        
        // 5. Transform sessions to match Session interface
        const transformedSessions: Session[] = allSessions.map((session) => {
          const examTitle = examTitleMap.get(session.examId) || session.examId || 'Unknown Exam';
          
          return {
            id: session.id,
            exam_id: session.examId,
            examId: session.examId, // Also include examId for DiagnosticCards compatibility
            exam_title: examTitle,
            status: session.status || 'active',
            score: session.finalScore || null, // Use finalScore from session record
            finalScore: session.finalScore || null, // Also include finalScore for DiagnosticCards
            created_at: new Date(session.createdAt || Date.now()).toISOString(),
          };
        });
        
        setSessions(transformedSessions);
        console.log(`✅ Loaded ${transformedSessions.length} total sessions (${backendSessions.length} from backend, ${localSessions.length} local)`);
      } catch (err: any) {
        // Filter out Axios/Network errors - these are not relevant for offline-first IndexedDB
        const isAxiosError = err?.isAxiosError || 
                            err?.code === 'ERR_NETWORK' || 
                            err?.message?.includes('Network Error') ||
                            err?.message?.includes('Request failed');
        
        if (!isAxiosError) {
          console.error('Failed to fetch sessions:', err);
          setError('Failed to load session history');
        } else {
          // Silently ignore Axios/Network errors (we're offline-first now)
          console.debug('Ignored Axios/Network error in fetchSessions (offline-first mode)');
        }
      } finally {
        setLoadingSessions(false);
      }
    };

    const fetchRecommendations = async () => {
      try {
        const res = await fetch('/api/student/recommendations');
        if (res.ok) {
          const data = await res.json();
          setRecommendations(data);
        }
      } catch (e) {
        // Non-critical — silently ignore
      }
    };

    fetchExams();
    fetchSessions();
    fetchRecommendations();
  }, [user, isLoaded, router, sessionRefreshKey]);

  const handleStartExam = async (examId: string) => {
    if (!user) {
      setError('Please sign in to start an exam');
      return;
    }

    try {
      setIsLoading(true);
      setError(null);
      
      // Create session ID
      const sessionId = `session-${Date.now()}`;
      
      // Note: ExamContent caching removed - exams are fetched on-demand from backend
      // Verify exam exists by fetching from backend
      const backendUrl = process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:8000';
      try {
        const examResponse = await fetch(`${backendUrl}/exams/${examId}`, {
          headers: { 'X-Tenant-ID': 'public' }
        });
        if (!examResponse.ok) {
          throw new Error(`Exam ${examId} not found in backend`);
        }
      } catch (err) {
        throw new Error(`Failed to verify exam ${examId}: ${err instanceof Error ? err.message : 'Unknown error'}`);
      }
      
      // Create session in backend first (for cross-device persistence)
      let backendSessionId = sessionId;
      let isBackendCreated = false;
      try {
        console.log(`🔄 Creating session ${sessionId} in backend...`);
        const createResponse = await fetch('/api/student/sessions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            sessionId: sessionId,
            examId: examId
          })
        });

        if (createResponse.ok) {
          const createData = await createResponse.json();
          backendSessionId = createData.session_id || sessionId;
          isBackendCreated = true;
          console.log(`✅ Session created in backend: ${backendSessionId}`);
        } else {
          const errorData = await createResponse.json().catch(() => ({ error: 'Unknown error' }));
          console.warn(`⚠️ Failed to create session in backend (will continue locally):`, errorData);
          // Continue with local-only mode
        }
      } catch (error) {
        console.warn(`⚠️ Error creating session in backend (will continue locally):`, error);
        // Continue with local-only mode
      }
      
      // Create session locally in IndexedDB
      await db.sessions.put({
        id: backendSessionId, // Use backend session ID if created
        examId: examId,
        isSynced: isBackendCreated, // Mark as synced if backend creation succeeded
        currentModuleId: undefined,
        currentQuestionIndex: 0,
        status: 'active',
        answers: {},
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
      
      router.push(`/exam/simulation/${backendSessionId}`);
    } catch (err: any) {
      console.error('Failed to start exam:', err);
      setError(err.message || 'Failed to start exam. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  const formatTimeLimit = (seconds: number) => {
    const minutes = Math.floor(seconds / 60);
    return `${minutes} min`;
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString();
  };

  const formatScore = (score: number | null) => {
    if (score === null) return 'N/A';
    return Math.round(score).toString();
  };

  const inspectDatabase = async () => {
    console.clear();
    console.log("%c🔍 STARTING DATABASE INSPECTION...", "color: blue; font-weight: bold; font-size: 14px;");
    
    const tables = db.tables;
    
    for (const table of tables) {
      const count = await table.count();
      const samples = await table.limit(2).toArray();
      
      console.group(`📂 Table: ${table.name} (${count} rows)`);
      console.log("Schema/Index:", table.schema);
      console.table(samples); // Renders a nice table for the samples
      console.log("Raw Data:", samples); // In case table view truncates
      console.groupEnd();
    }
    
    console.log("%c✅ INSPECTION COMPLETE", "color: green; font-weight: bold;");
    alert("Database details logged to Console (F12)!");
  };

  const seedDiagnosticExam = async () => {
    // Note: ExamContent caching has been removed - exams are now fetched on-demand from backend
    // This function is deprecated. Diagnostic exams should be created via the backend API.
    alert('⚠️ Exam seeding is no longer supported.\n\nExams are now fetched on-demand from the backend. Diagnostic exams should be created via the admin panel or backend API.');
    console.warn('[Seed Diagnostic Exam] This function is deprecated - examContent caching has been removed');
  };

  const seedData = async () => {
    try {
      // Create a Session linked to a test exam
      const examId = 'sat-practice-1';
      const sessionId = 'test-session-1';
      await db.sessions.put({
        id: sessionId,
        examId: examId,
        isSynced: false,
        currentModuleId: 'rw_module_1',
        currentQuestionIndex: 0,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        status: 'active',
      });

      alert(`✅ Created Session: ${sessionId}\nExam: ${examId}\n\nYou can now navigate to /exam/simulation/${sessionId} to test the UI.`);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to seed data';
      alert(`❌ Error: ${errorMessage}`);
      console.error('[Seed Data] Error:', err);
    }
  };

  if (!isLoaded) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="text-lg">Loading...</div>
      </div>
    );
  }

  if (!user) {
    return null; // Will redirect
  }

  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-black">
      {/* Top Bar */}
      <div className="border-b border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            <div className="flex items-center gap-4">
              <h1 className="text-2xl font-bold text-indigo-600 dark:text-indigo-400">
                Velox Student
              </h1>
              {user?.publicMetadata?.role === 'admin' && (
                <Button
                  onClick={() => router.push('/admin')}
                  variant="outline"
                  size="sm"
                  className="border-zinc-300 dark:border-zinc-700"
                >
                  <Settings className="h-4 w-4 mr-2" />
                  Admin Dashboard
                </Button>
              )}
            </div>
            <div className="flex items-center">
              <UserButton afterSignOutUrl="/" />
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Header */}
        <div className="mb-8">
          <h2 className="text-3xl font-bold text-black dark:text-zinc-50">
            Welcome Back! Ready to learn?
          </h2>
        </div>

        {error && (
          <div className="mb-4 p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg">
            <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
          </div>
        )}

        {/* Section 0: Diagnostic Cards */}
        <DiagnosticCards
          sessions={sessions.filter((s): s is typeof s & { examId: string } => !!s.examId)}
          isLoading={loadingSessions}
          userId={user?.id}
        />

        {/* What to Study Today */}
        {recommendations && (
          <div className="mb-8 p-5 rounded-xl border border-indigo-200 dark:border-indigo-800 bg-indigo-50 dark:bg-indigo-900/20">
            <div className="flex items-start gap-3">
              <Brain className="h-5 w-5 text-indigo-600 dark:text-indigo-400 mt-0.5 flex-shrink-0" />
              <div className="flex-1 min-w-0">
                <h3 className="text-base font-semibold text-indigo-900 dark:text-indigo-100 mb-1">
                  What to study today
                </h3>
                <p className="text-sm text-indigo-700 dark:text-indigo-300 mb-3">
                  {recommendations.message}
                </p>
                {recommendations.top_concepts.length > 0 && (
                  <div className="flex flex-wrap gap-2">
                    {recommendations.top_concepts.slice(0, 5).map((c) => (
                      <span
                        key={c.concept}
                        className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium bg-white dark:bg-indigo-800 border border-indigo-200 dark:border-indigo-700 text-indigo-800 dark:text-indigo-200"
                      >
                        {c.concept}
                        <span className={`font-bold ${c.accuracy < 60 ? 'text-red-500' : c.accuracy < 80 ? 'text-yellow-600' : 'text-green-600'}`}>
                          {c.accuracy}%
                        </span>
                      </span>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Section 1: Daily Practice - NEW EXPERIENCE */}
        <div className="mb-12">
          <div className="flex items-center gap-2 mb-6">
            <BookOpen className="h-5 w-5 text-indigo-600 dark:text-indigo-400" />
            <h3 className="text-2xl font-semibold text-black dark:text-zinc-50">
              Daily Practice
            </h3>
            <Badge variant="outline" className="ml-2 bg-green-50 text-green-700 border-green-200">
              New
            </Badge>
          </div>
          <p className="text-sm text-zinc-600 dark:text-zinc-400 mb-6">
            Your personalized daily practice session based on spaced repetition. Start your daily mix to strengthen your knowledge.
          </p>
          <Card className="border-zinc-200 dark:border-zinc-800 shadow-lg">
            <CardContent className="p-8">
              <div className="text-center">
                <p className="text-xl font-bold text-black dark:text-zinc-50 mb-2">
                  Daily Practice
                </p>
                <p className="text-sm text-zinc-600 dark:text-zinc-400 mb-6">
                  Get personalized questions based on your retention state and learning progress. Choose Math or Reading & Writing.
                </p>
                <div className="flex flex-col sm:flex-row gap-4 justify-center">
                  <Button
                    onClick={async () => {
                      if (!user) {
                        setError('Please sign in to start daily practice');
                        return;
                      }
                      try {
                        setError(null);
                        setLoadingExams(true);
                        const response = await fetch('/api/student/daily-practice?domain=Math', {
                          method: 'POST',
                          headers: { 'Content-Type': 'application/json' },
                        });

                        if (!response.ok) {
                          const errorData = await response.json().catch(() => ({ detail: `Failed: ${response.status}` }));
                          throw new Error(errorData.detail || errorData.message || 'Failed to generate daily test');
                        }
                        const data = await response.json();
                        const { session_id, exam_id, exam_packet } = data;
                        if (!exam_packet) throw new Error('No exam packet returned from server');
                        // Use real UUID exam_id from backend, not exam_packet.exam_id (non-UUID format)
                        const realExamId = exam_id || exam_packet.exam_id;
                        await db.sessions.put({
                          id: session_id,
                          examId: realExamId,
                          isSynced: true,
                          currentModuleId: exam_packet.modules?.[0]?.id,
                          currentQuestionIndex: 0,
                          status: 'active',
                          answers: {},
                          createdAt: Date.now(),
                          updatedAt: Date.now(),
                        });
                        router.push(`/exam/simulation/${session_id}`);
                      } catch (err: any) {
                        console.error('Failed to start daily practice:', err);
                        setError(err.message || 'Failed to start daily practice. Please try again.');
                      } finally {
                        setLoadingExams(false);
                      }
                    }}
                    disabled={isLoading || loadingExams}
                    className="bg-indigo-600 hover:bg-indigo-700 text-white px-10 py-8 text-xl font-semibold shadow-lg hover:shadow-xl transition-all"
                    size="lg"
                  >
                    {isLoading || loadingExams ? 'Starting...' : 'Daily Math'}
                  </Button>
                  <Button
                    onClick={async () => {
                      if (!user) {
                        setError('Please sign in to start daily practice');
                        return;
                      }
                      try {
                        setError(null);
                        setLoadingExams(true);
                        const response = await fetch('/api/student/daily-practice?domain=RW', {
                          method: 'POST',
                          headers: { 'Content-Type': 'application/json' },
                        });
                        if (!response.ok) {
                          const errorData = await response.json().catch(() => ({ detail: `Failed: ${response.status}` }));
                          throw new Error(errorData.detail || errorData.message || 'Failed to generate daily test');
                        }
                        const data = await response.json();
                        const { session_id, exam_id, exam_packet } = data;
                        if (!exam_packet) throw new Error('No exam packet returned from server');
                        // Use real UUID exam_id from backend, not exam_packet.exam_id (non-UUID format)
                        const realExamId = exam_id || exam_packet.exam_id;
                        await db.sessions.put({
                          id: session_id,
                          examId: realExamId,
                          isSynced: true,
                          currentModuleId: exam_packet.modules?.[0]?.id,
                          currentQuestionIndex: 0,
                          status: 'active',
                          answers: {},
                          createdAt: Date.now(),
                          updatedAt: Date.now(),
                        });
                        router.push(`/exam/simulation/${session_id}`);
                      } catch (err: any) {
                        console.error('Failed to start daily practice:', err);
                        setError(err.message || 'Failed to start daily practice. Please try again.');
                      } finally {
                        setLoadingExams(false);
                      }
                    }}
                    disabled={isLoading || loadingExams}
                    className="bg-indigo-600 hover:bg-indigo-700 text-white px-10 py-8 text-xl font-semibold shadow-lg hover:shadow-xl transition-all"
                    size="lg"
                  >
                    {isLoading || loadingExams ? 'Starting...' : 'Daily RW'}
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Section 1.5: Full Length Tests */}
        <div className="mb-12">
          <div className="flex items-center gap-2 mb-6">
            <GraduationCap className="h-5 w-5 text-orange-600 dark:text-orange-400" />
            <h3 className="text-2xl font-semibold text-black dark:text-zinc-50">
              Full Length Tests
            </h3>
            <Badge variant="outline" className="ml-2 bg-orange-50 text-orange-700 border-orange-200">
              Complete
            </Badge>
          </div>
          <p className="text-sm text-zinc-600 dark:text-zinc-400 mb-6">
            Take a complete Digital SAT practice test with Reading & Writing and Math sections, including a 10-minute break between sections.
          </p>
          <Card className="border-zinc-200 dark:border-zinc-800 shadow-lg">
            <CardContent className="p-8">
              <div className="text-center">
                <p className="text-xl font-bold text-black dark:text-zinc-50 mb-2">
                  Full Mock Exam
                </p>
                <p className="text-sm text-zinc-600 dark:text-zinc-400 mb-4">
                  Complete Digital SAT format: 54 Reading & Writing questions (64 minutes) + 10-minute break + 44 Math questions (70 minutes)
                </p>
                <div className="flex items-center justify-center gap-4 mb-6 text-sm text-zinc-600 dark:text-zinc-400">
                  <div className="flex items-center gap-2">
                    <FileQuestion className="h-4 w-4" />
                    <span>98 Questions</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Clock className="h-4 w-4" />
                    <span>~144 Minutes</span>
                  </div>
                </div>
                <Button
                  onClick={() => {
                    if (!user) {
                      setError('Please sign in to start full length test');
                      return;
                    }
                    router.push('/simulation');
                  }}
                  disabled={isLoading}
                  className="bg-orange-600 hover:bg-orange-700 text-white px-10 py-8 text-xl font-semibold shadow-lg hover:shadow-xl transition-all"
                  size="lg"
                >
                  Start Full Mock Exam
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Section 2: Additional Exams (Legacy, hidden if no exams) */}
        {exams.length > 0 && (
          <div className="mb-12 opacity-50">
            <div className="flex items-center gap-2 mb-6">
              <BookOpen className="h-5 w-5 text-zinc-400 dark:text-zinc-600" />
              <h3 className="text-xl font-semibold text-zinc-600 dark:text-zinc-400">
                Additional Exams
              </h3>
            </div>
            <p className="text-sm text-zinc-500 dark:text-zinc-500 mb-6">
              Additional practice exams (legacy)
            </p>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {exams.map((exam) => (
                <Card
                  key={exam.id}
                  className="border-zinc-200 dark:border-zinc-800 hover:shadow-lg transition-shadow"
                >
                  <CardHeader>
                    <CardTitle className="text-lg">{exam.title}</CardTitle>
                    {exam.description && (
                      <p className="text-sm text-zinc-600 dark:text-zinc-400 mt-2 line-clamp-2">
                        {exam.description}
                      </p>
                    )}
                  </CardHeader>
                  <CardContent>
                    <div className="flex items-center justify-between mb-4">
                      <div className="flex items-center gap-2 text-sm text-zinc-600 dark:text-zinc-400">
                        <FileQuestion className="h-4 w-4" />
                        <span>{exam.question_count} Questions</span>
                      </div>
                      {exam.time_limit_seconds && (
                        <div className="flex items-center gap-2 text-sm text-zinc-600 dark:text-zinc-400">
                          <Clock className="h-4 w-4" />
                          <span>{formatTimeLimit(exam.time_limit_seconds)}</span>
                        </div>
                      )}
                    </div>
                    <Button
                      onClick={() => handleStartExam(exam.id)}
                      disabled={isLoading}
                      className="w-full bg-indigo-600 hover:bg-indigo-700 text-white"
                    >
                      {isLoading ? 'Starting...' : 'Start Exam'}
                    </Button>
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>
        )}

        {/* Section 2.5: Progress */}
        <div className="mb-12">
          <div className="flex items-center gap-2 mb-6">
            <Brain className="h-5 w-5 text-indigo-600 dark:text-indigo-400" />
            <h3 className="text-2xl font-semibold text-black dark:text-zinc-50">
              My Progress
            </h3>
          </div>
          <ProgressPanel userId={user?.id} sessions={sessions} />
        </div>

        {/* Section 3: The Cockpit (History) */}
        <div>
          <div className="flex items-center gap-2 mb-6">
            <History className="h-5 w-5 text-indigo-600 dark:text-indigo-400" />
            <h3 className="text-2xl font-semibold text-black dark:text-zinc-50">
              The Cockpit
            </h3>
          </div>
          <p className="text-sm text-zinc-600 dark:text-zinc-400 mb-1">
            Past Attempts
          </p>
          <p className="text-xs text-zinc-400 dark:text-zinc-500 mb-6">
            Scores are estimated based on practice sessions and are not predictive of official SAT results.
          </p>

          {loadingSessions ? (
            <div className="text-center py-12">
              <div className="text-sm text-zinc-500 dark:text-zinc-400">
                Loading history...
              </div>
            </div>
          ) : sessions.length === 0 ? (
            <Card className="border-zinc-200 dark:border-zinc-800">
              <CardContent className="py-12">
                <div className="text-center text-sm text-zinc-500 dark:text-zinc-400">
                  No exam attempts yet. Start your first exam from Daily Practice above!
                </div>
              </CardContent>
            </Card>
          ) : (
            <Card className="border-zinc-200 dark:border-zinc-800">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Exam Name</TableHead>
                    <TableHead>Date</TableHead>
                    <TableHead>
                      Score
                      <span className="block text-xs font-normal text-zinc-400 dark:text-zinc-500">Estimated score based on practice sessions</span>
                    </TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {sessions.map((session) => (
                    <TableRow key={session.id}>
                      <TableCell className="font-medium">
                        {session.exam_title}
                      </TableCell>
                      <TableCell className="text-zinc-600 dark:text-zinc-400">
                        {formatDate(session.created_at)}
                      </TableCell>
                      <TableCell>
                        <Badge variant="secondary">
                          {formatScore(session.score)}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant={
                            session.status === 'completed'
                              ? 'default'
                              : 'outline'
                          }
                        >
                          {session.status}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        {session.status === 'completed' ? (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => {
                              // Navigate to the new review page
                              router.push(`/exam/${session.id}/review`);
                            }}
                          >
                            Review
                          </Button>
                        ) : (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={async () => {
                              // Before resuming, check if session is actually completed locally
                              // and trigger a sync if needed
                              try {
                                const { db } = await import('@/src/lib/db');
                                const localSession = await db.sessions.get(session.id);
                                if (localSession && localSession.status === 'completed' && session.status === 'active') {
                                  console.log(`[Dashboard] 🔄 Local session ${session.id} is completed but backend shows active - triggering sync`);
                                  // Trigger a sync
                                  try {
                                    await fetch('/api/student/sync', {
                                      method: 'POST',
                                      headers: { 'Content-Type': 'application/json' },
                                      body: JSON.stringify({
                                        sessionId: localSession.id,
                                        session: {
                                          id: localSession.id,
                                          examId: localSession.examId,
                                          currentModuleId: localSession.currentModuleId,
                                          currentQuestionIndex: localSession.currentQuestionIndex,
                                          status: localSession.status,
                                          answers: localSession.answers,
                                          finalScore: localSession.finalScore,
                                          performanceProfile: localSession.performanceProfile,
                                          updatedAt: localSession.updatedAt || Date.now()
                                        }
                                      })
                                    });
                                    // Refresh sessions after sync
                                    setTimeout(() => setSessionRefreshKey(k => k + 1), 1000);
                                  } catch (syncError) {
                                    console.error('Error syncing session:', syncError);
                                  }
                                }
                              } catch (error) {
                                console.error('Error checking session:', error);
                              }
                              router.push(`/exam/simulation/${session.id}`);
                            }}
                          >
                            Resume
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </Card>
          )}
        </div>
      </div>
      
    </div>
  );
}

/**
 * Dashboard Page with ExamProvider wrapper
 */
export default function DashboardPage() {
  return (
    <ExamProvider>
      <DashboardContent />
    </ExamProvider>
  );
}
