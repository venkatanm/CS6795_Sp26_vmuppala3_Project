'use client';
import { useState, useEffect, useMemo, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useExam } from '../context/ExamContext';  
import { useAnnotationTools } from '../hooks/useAnnotationTools';
import { useAnswerSync } from '../hooks/useAnswerSync';
import styles from './ExamRunner.module.css';
import SplitScreenLayout from '../layouts/SplitScreen';
import ExamHeader from '../components/navigation/ExamHeader';
import BottomBar from '../components/navigation/BottomBar';
import CalculatorModal from '../components/tools/CalculatorModal';
import ReferenceSheetModal from '../components/tools/ReferenceSheetModal';
import Highlighter from '../components/tools/Highlighter';
import DiagnosticReport from '../components/reports/DiagnosticReport';
import ChatPanel from '../components/tutor/ChatPanel';
import ReviewGrid from '../components/screens/ReviewGrid';
import { RotateCcw, X, Bookmark, HelpCircle } from 'lucide-react';
import { db } from '../lib/db';
import MathRenderer from './math/MathRenderer';
import { processMathMLInHTML } from '../utils/mathmlToLatex';

// Helper function to format answer preview (e.g., "3/2" displays as fraction)
function formatAnswerPreview(value: string): string {
  if (!value) return "";
  
  // Remove spaces
  const cleaned = value.trim();
  
  // Check if it's a fraction (contains /)
  if (cleaned.includes('/')) {
    const parts = cleaned.split('/');
    if (parts.length === 2) {
      const numerator = parts[0].trim();
      const denominator = parts[1].trim();
      // Validate both parts are numbers
      if (/^-?\d+$/.test(numerator) && /^\d+$/.test(denominator) && denominator !== '0') {
        return `${numerator}/${denominator}`;
      }
    }
  }
  
  // Check if it's a decimal
  if (cleaned.includes('.')) {
    const num = parseFloat(cleaned);
    if (!isNaN(num)) {
      // Format to show up to 4 decimal places
      return num.toString();
    }
  }
  
  // Check if it's a whole number
  if (/^-?\d+$/.test(cleaned)) {
    return cleaned;
  }
  
  return cleaned;
}

// Helper function to normalize answer for comparison
// Also converts numeric index (0/1/2/3) to letter (A/B/C/D) for correct_answer compatibility
function normalizeAnswer(value: string): string {
  if (!value) return "";
  const v = value.trim();
  // Convert numeric index to letter: "0" -> "a", "1" -> "b", etc.
  if (/^[0-3]$/.test(v)) {
    return String.fromCharCode(97 + parseInt(v, 10));
  }
  return v.toLowerCase();
}

// Helper function to compare answers (handles fractions, decimals, etc.)
function answersMatch(userAnswer: string, correctAnswer: string | number): boolean {
  const user = normalizeAnswer(userAnswer);
  const correct = normalizeAnswer(String(correctAnswer));
  
  // Direct match
  if (user === correct) return true;
  
  // Try to evaluate as numbers
  try {
    const userNum = parseFloat(user);
    const correctNum = parseFloat(correct);
    if (!isNaN(userNum) && !isNaN(correctNum)) {
      // Compare with small tolerance for floating point
      return Math.abs(userNum - correctNum) < 0.0001;
    }
  } catch (e) {
    // Ignore parse errors
  }
  
  // Try fraction evaluation
  try {
    const evalUser = evaluateFraction(user);
    const evalCorrect = evaluateFraction(correct);
    if (evalUser !== null && evalCorrect !== null) {
      return Math.abs(evalUser - evalCorrect) < 0.0001;
    }
  } catch (e) {
    // Ignore evaluation errors
  }
  
  return false;
}

// Helper function to evaluate fraction string (e.g., "3/2" -> 1.5)
function evaluateFraction(value: string): number | null {
  if (!value.includes('/')) {
    const num = parseFloat(value);
    return isNaN(num) ? null : num;
  }
  
  const parts = value.split('/');
  if (parts.length !== 2) return null;
  
  const numerator = parseFloat(parts[0].trim());
  const denominator = parseFloat(parts[1].trim());
  
  if (isNaN(numerator) || isNaN(denominator) || denominator === 0) {
    return null;
  }
  
  return numerator / denominator;
}

export default function ExamRunner({ 
  sessionId,
  totalQuestions = 27,
  initialQuestionIndex = 0,
  initialTimeRemaining = 1920
}: { 
  sessionId: string;
  totalQuestions?: number;
  initialQuestionIndex?: number;
  initialTimeRemaining?: number;
}) {
  const router = useRouter();
  const { state, actions } = useExam();
  
  // --- 🛡️ 1. RENDER GUARD (Fixes Hydration Error) ---
  const [isMounted, setIsMounted] = useState(false);
  useEffect(() => { setIsMounted(true); }, []);

  // --- Socratic Help State ---
  const [socraticHelpOpen, setSocraticHelpOpen] = useState(false);
  const [socraticHelpQuestionId, setSocraticHelpQuestionId] = useState<string | null>(null);
  
  // --- Review Mode State ---
  // Only show diagnostic report for diagnostic exams, not regular exams
  const isDiagnosticExam = useMemo(() => {
    if (!state.session) return false;
    const DIAGNOSTIC_MATH_UUID = '550e8400-e29b-41d4-a716-446655440000';
    const DIAGNOSTIC_RW_UUID = '550e8400-e29b-41d4-a716-446655440001';
    const examId = state.session.examId;
    return examId === DIAGNOSTIC_MATH_UUID || examId === DIAGNOSTIC_RW_UUID;
  }, [state.session?.examId]);
  
  // For diagnostic exams: show report FIRST when completed, then allow review
  // For regular exams: show review mode directly
  // Initialize based on exam type and completion status
  const [showDiagnostic, setShowDiagnostic] = useState(() => {
    // Only show diagnostic report for diagnostic exams when completed
    if (state.session?.status === 'completed') {
      const DIAGNOSTIC_MATH_UUID = '550e8400-e29b-41d4-a716-446655440000';
      const DIAGNOSTIC_RW_UUID = '550e8400-e29b-41d4-a716-446655440001';
      const examId = state.session?.examId;
      if (examId === DIAGNOSTIC_MATH_UUID || examId === DIAGNOSTIC_RW_UUID) {
        return true; // Show diagnostic report first
      }
    }
    return false; // For regular exams or active sessions, default to review mode
  });

  // Track if user has explicitly chosen to view review (prevents useEffect from resetting)
  const userChoseReviewRef = useRef(false);

  // --- 2. LOADING STATE ---
  const isLoading = !isMounted || !state.session || !state.currentModule;
  
  // --- 3. DERIVED STATE ---
  // 0. Flattened question list for review mode (all questions from Module 1 + Module 2)
  // Fetch all completed modules for review mode
  const isReviewModeFlag = state.session?.status === 'completed';
  
  // Determine which modules were completed (for review mode)
  const reviewModule1Id = useMemo(() => {
    if (!isReviewModeFlag || !state.session) return null;
    const examId = state.session.examId;
    const isMath = examId === '550e8400-e29b-41d4-a716-446655440000';
    const isRW = examId === '550e8400-e29b-41d4-a716-446655440001';
    if (isMath) return 'math_module_1';
    if (isRW) return 'rw_module_1';
    return null;
  }, [isReviewModeFlag, state.session]);
  
  const reviewModule2Id = useMemo(() => {
    if (!isReviewModeFlag || !state.session) return null;
    // Module 2 ID is stored in currentModuleId when exam is completed
    const module2Id = state.session.currentModuleId;
    if (!module2Id) return null;
    // Check if it's a Module 2 ID
    if (module2Id.includes('module_2')) {
      return module2Id;
    }
    return null;
  }, [isReviewModeFlag, state.session]);
  
  // Fetch Module 1 for review (always call hook, conditionally enable)
  const reviewModule1Query = useQuery({
    queryKey: ['review-module', sessionId, reviewModule1Id],
    queryFn: async () => {
      if (!reviewModule1Id) throw new Error('No module 1 ID');
      const response = await fetch(
        `/api/exam/session/${sessionId}/current-module?module_id=${reviewModule1Id}`
      );
      if (!response.ok) throw new Error(`Failed to fetch module ${reviewModule1Id}`);
      return response.json();
    },
    enabled: isReviewModeFlag && !!sessionId && !!reviewModule1Id,
    staleTime: 5 * 60 * 1000, // Cache for 5 minutes
  });
  
  // Fetch Module 2 for review (always call hook, conditionally enable)
  const reviewModule2Query = useQuery({
    queryKey: ['review-module', sessionId, reviewModule2Id],
    queryFn: async () => {
      if (!reviewModule2Id) throw new Error('No module 2 ID');
      const response = await fetch(
        `/api/exam/session/${sessionId}/current-module?module_id=${reviewModule2Id}`
      );
      if (!response.ok) throw new Error(`Failed to fetch module ${reviewModule2Id}`);
      return response.json();
    },
    enabled: isReviewModeFlag && !!sessionId && !!reviewModule2Id,
    staleTime: 5 * 60 * 1000, // Cache for 5 minutes
  });
  
  // Combine review module queries into array for easier iteration
  const reviewModuleQueries = useMemo(() => {
    const queries = [];
    if (reviewModule1Query.data) queries.push(reviewModule1Query);
    if (reviewModule2Query.data) queries.push(reviewModule2Query);
    return queries;
  }, [reviewModule1Query.data, reviewModule2Query.data]);
  
  const allReviewQuestions = useMemo(() => {
    if (!isReviewModeFlag) return [];
    
    // Combine question IDs from all completed modules
    const allQuestionIds: string[] = [];
    
    if (reviewModule1Query.data?.module?.question_order) {
      allQuestionIds.push(...reviewModule1Query.data.module.question_order);
    }
    if (reviewModule2Query.data?.module?.question_order) {
      allQuestionIds.push(...reviewModule2Query.data.module.question_order);
    }
    
    // Fallback to current module if no review modules loaded yet
    if (allQuestionIds.length === 0 && state.currentModule) {
      return state.currentModule.module.question_order || [];
    }
    
    return allQuestionIds;
  }, [isReviewModeFlag, reviewModule1Query.data, reviewModule2Query.data, state.currentModule]);

  // 1. Instant Question Resolution (from current module or review modules)
  const currentQuestion = useMemo(() => {
    if (!state.session) return null;

    const isReviewMode = state.session.status === 'completed';
    const questionIndex = state.session.currentQuestionIndex ?? 0;
    
    // In review mode, use allReviewQuestions; otherwise use current module
    let questionId: string | null = null;
    let data: any = null;
    
    if (isReviewMode && allReviewQuestions.length > 0) {
      // Review mode: use flattened question list from all modules
      if (questionIndex < 0 || questionIndex >= allReviewQuestions.length) return null;
      questionId = allReviewQuestions[questionIndex];
      
      // Find question data in review modules (check Module 1, then Module 2)
      if (reviewModule1Query.data?.questions?.[questionId]) {
        data = reviewModule1Query.data.questions[questionId];
      } else if (reviewModule2Query.data?.questions?.[questionId]) {
        data = reviewModule2Query.data.questions[questionId];
      }
      // Fallback to current module if not found in review modules
      if (!data && state.currentModule?.questions?.[questionId]) {
        data = state.currentModule.questions[questionId];
      }
    } else if (state.currentModule) {
      // Normal mode: use current module
      const questionOrder = state.currentModule.module.question_order || [];
      if (questionIndex < 0 || questionIndex >= questionOrder.length) return null;
      questionId = questionOrder[questionIndex];
      if (!questionId) return null;
      data = state.currentModule.questions[questionId];
    }
    
    if (!questionId || !data) return null;

    // Normalize structure: Handle both Math and English question formats
    // Math questions: prompt = question text, answer.choices = nested structure
    // English questions: stem = question text, stimulus = passage, answerOptions = array
    // Use type assertion to access raw fields that may not be in the TypeScript interface
    const rawData = data as any;
    
    // Extract question text (prioritize stem, then text, then prompt)
    const questionText = rawData.stem || data.text || rawData.prompt || "Question text missing";
    
    // Extract passage/stimulus (for RW questions)
    // STANDARDIZED: Use stimulus as primary field, with fallbacks for backward compatibility
    const stimulus = data.stimulus || rawData.stimulus || data.passageText || rawData.passageText || rawData.passage || "";
    
    // Extract choices - handle multiple formats (check ALL possible locations)
    // The bundler should normalize choices, but we also check raw formats as fallback
    let choices: Array<{ id: string; text: string }> = [];
    
    // Format 1: Flat choices array (standard format - what bundler creates)
    // This is the PRIMARY format - bundler stores choices as [{ id: "A", text: "..." }, ...]
    if (data.choices && Array.isArray(data.choices) && data.choices.length > 0) {
      const choicesArray = data.choices as any[];
      choices = choicesArray.map((c: any) => {
        // Handle both normalized format { id: "A", text: "..." } and raw formats
        if (typeof c === 'string') {
          // If choice is just a string, create ID from index
          return { id: String.fromCharCode(65 + choicesArray.indexOf(c)), text: c };
        }
        // Normalized format from bundler: { id: "A", text: "..." }
        return {
          id: String(c.id || c.letter || '').toUpperCase(),
          text: c.text || c.content || String(c)
        };
      });
    }
    // Format 2: answerOptions array (English questions - raw format, in case bundler missed it)
    else if (rawData.answerOptions && Array.isArray(rawData.answerOptions) && rawData.answerOptions.length > 0) {
      choices = rawData.answerOptions.map((c: any, idx: number) => ({
        id: String(c.id || String.fromCharCode(65 + idx)), // A, B, C, D
        text: c.content || c.text || String(c)
      }));
    }
    // Format 3: Nested answer.choices structure (Math questions - raw format, in case bundler missed it)
    else if (rawData.answer && rawData.answer.choices) {
      const nestedChoices = rawData.answer.choices;
      if (typeof nestedChoices === 'object' && !Array.isArray(nestedChoices)) {
        choices = Object.keys(nestedChoices).sort().map(key => ({
          id: key.toUpperCase(),
          text: nestedChoices[key].body || nestedChoices[key].text || nestedChoices[key].content || String(nestedChoices[key])
        }));
      }
    }
    // Format 4: options array (fallback)
    else if (rawData.options && Array.isArray(rawData.options) && rawData.options.length > 0) {
      choices = rawData.options.map((c: any, idx: number) => ({
        id: String(c.id || c.letter || String.fromCharCode(65 + idx)),
        text: c.text || c.content || String(c)
      }));
    }
    
    // Debug logging if no choices found
    if (choices.length === 0) {
      console.warn(`⚠️ No choices found for question ${questionId}. Available fields:`, Object.keys(data));
      console.warn(`   data.choices:`, data.choices);
      console.warn(`   data.answerOptions:`, rawData.answerOptions);
      console.warn(`   data.answer:`, rawData.answer);
      console.warn(`   data.options:`, rawData.options);
      console.warn(`   Full data:`, data);
    } else {
      // Log success for first few questions to verify it's working
      if ((state.session?.currentQuestionIndex ?? 0) < 3) {
        console.log(`✅ Found ${choices.length} choices for question ${questionId}:`, choices.map(c => c.id).join(', '));
      }
    }

    // Get full question data for SPR detection
    const questionData = data;
    const is_spr = questionData?.is_spr || false;
    const domain = questionData?.domain || "";
    
    // Debug logging for RW questions (only log first few to avoid spam)
    if (domain === "Reading and Writing" || domain === "RW") {
      if (!stimulus && (state.session?.currentQuestionIndex ?? 0) < 3) {
        console.warn(`[PASSAGE DEBUG] Question ${questionId}: No stimulus found.`, {
          hasStimulus: !!(data.stimulus || rawData.stimulus),
          hasPassageText: !!data.passageText,
          hasPassage: !!rawData.passage,
          availableKeys: Object.keys(data).slice(0, 10),
          rawDataKeys: Object.keys(rawData).slice(0, 10)
        });
      } else if (stimulus && (state.session?.currentQuestionIndex ?? 0) < 3) {
        console.log(`[PASSAGE DEBUG] Question ${questionId}: Found stimulus (${stimulus.length} chars)`);
      }
    }
    
    // Normalize structure for the UI components
    return {
      id: questionId,
      questionText: questionText,
      stimulus: stimulus,  // PRIMARY: Standardized on stimulus
      passageText: stimulus,  // DEPRECATED: Keep for backward compatibility
      passage: stimulus,  // DEPRECATED: Keep for backward compatibility
      choices: choices,
      is_spr: is_spr,  // Student-Produced Response flag
      domain: domain,  // Math or Reading and Writing
      stem: questionText || data.text || ""
    };
  }, [state.currentModule, state.session?.currentQuestionIndex, allReviewQuestions, reviewModule1Query.data, reviewModule2Query.data]);

  // 2. Derive active module for other uses
  const activeModule = useMemo(() => {
    return state.currentModule?.module || null;
  }, [state.currentModule]);

  // 3. Standardized total question count (prioritizes question_order from content_bank architecture)
  const activeTotalQuestions = useMemo(() => {
    const isReviewMode = state.session?.status === 'completed';
    
    // In review mode, return total count of all questions from both modules
    if (isReviewMode && allReviewQuestions.length > 0) {
      return allReviewQuestions.length;
    }
    
    // Normal exam mode: use current module
    if (!activeModule) return 0;
    // Priority: question_order (Bank format) -> questions (Simple format)
    return activeModule.question_order?.length || (activeModule as any).questions?.length || 0;
  }, [activeModule, state.session?.status, allReviewQuestions]);

  // --- 4. FETCH CURRENT MODULE WITH REACT QUERY ---
  const queryClient = useQueryClient();
  
  // Fetch current module using React Query (via Next.js proxy for auth/routing)
  const { data: currentModuleData, isLoading: isLoadingModule, refetch: refetchModule } = useQuery({
    queryKey: ['current-module', sessionId],
    queryFn: async () => {
      if (!sessionId) throw new Error('No session ID');
      const response = await fetch(`/api/exam/session/${sessionId}/current-module`);
      if (!response.ok) throw new Error(`Failed to fetch module: ${response.status}`);
      return response.json();
    },
    enabled: !!sessionId && isMounted && !!state.session, // Only fetch if we have a session
    staleTime: 0, // Always refetch (module can change)
    gcTime: 0, // Don't cache (we want fresh data)
  });
  
  // Update ExamContext when module data is fetched
  useEffect(() => {
    if (currentModuleData && state.session) {
      const currentModule = {
        module: currentModuleData.module,
        questions: currentModuleData.questions,
        config: currentModuleData.config
      };
      // Only update if it's different (avoid infinite loops)
      if (JSON.stringify(state.currentModule) !== JSON.stringify(currentModule)) {
        // Dispatch to ExamContext
        // Note: We'll need to add a SET_CURRENT_MODULE action or use the existing one
        // For now, loadSession will handle this, but we can also update directly
        console.log('[ExamRunner] ✅ Current module fetched from backend');
      }
    }
  }, [currentModuleData, state.session]);
  
  // Invalidate query when module transitions (after finishModule completes)
  useEffect(() => {
    const sessionStatus = state.session?.status as string;
    if ((sessionStatus === 'MODULE_1_COMPLETE' || sessionStatus === 'MODULE_2_COMPLETE') && state.session?.currentModuleId) {
      // Module transition occurred - invalidate query to fetch next module
      queryClient.invalidateQueries({ queryKey: ['current-module', sessionId] });
    }
  }, [state.session?.status, state.session?.currentModuleId, queryClient, sessionId]);
  
  // --- 5. SUBMIT MODULE MUTATION (React Query) ---
  // NOTE: This mutation is currently unused - finishModule in ExamContext handles module submission
  // Keeping it here for potential future use, but it should go through Next.js API route for auth
  const submitModuleMutation = useMutation({
    mutationFn: async ({ sessionId, moduleId, responses }: { sessionId: string; moduleId: string; responses: any[] }) => {
      // Use Next.js API route (handles authentication via Clerk)
      const response = await fetch('/api/exam/submit-module', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          session_id: sessionId,
          module_id: moduleId,
          responses: responses
        })
      });
      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Failed to submit module: ${response.status} - ${errorText}`);
      }
      return response.json();
    },
    onSuccess: (result) => {
      // Invalidate current-module query to refetch next module
      queryClient.invalidateQueries({ queryKey: ['current-module', sessionId] });
      
      // Update session status based on result
      if (result.status === 'exam_complete') {
        // Exam complete - session status will be updated by ExamContext
        console.log('[ExamRunner] ✅ Exam completed');
      } else if (result.status === 'module_complete' && result.next_module_id) {
        // Module complete - next module will be fetched by invalidated query
        console.log('[ExamRunner] ✅ Module completed, next module:', result.next_module_id);
      }
    },
    onError: (error) => {
      console.error('[ExamRunner] ❌ Error submitting module:', error);
    }
  });
  
  // --- 6. ANSWER SYNC (Offline-Tolerant) ---
  // Memoize the session info object so its reference is stable across renders.
  // Without this, an inline object literal would change on every render, causing
  // useAnswerSync's syncAnswers callback to recreate and trigger an infinite loop.
  const answerSyncSession = useMemo(() => state.session ? {
    examId: state.session.examId,
    status: state.session.status,
    currentModuleId: state.session.currentModuleId,
    currentQuestionIndex: state.session.currentQuestionIndex
  } : undefined, [
    state.session?.examId,
    state.session?.status,
    state.session?.currentModuleId,
    state.session?.currentQuestionIndex
  ]);

  const { syncStatus } = useAnswerSync({
    sessionId: sessionId,
    answers: state.session?.answers || {},
    session: answerSyncSession
  });
  
  // --- 6. EFFECTS ---
  useEffect(() => {
    // Load session when mounted and we have a sessionId
    if (sessionId && isMounted) {
      // Only load if we don't have session
      if (!state.session) {
        console.log(`[ExamRunner] 🔄 Loading session...`);
        actions.loadSession(sessionId);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId, isMounted]); // Don't include actions - it's stable

  // Initialize review mode: Only reset to question 1 on initial load, not on every navigation
  const hasInitializedReviewRef = useRef(false);
  useEffect(() => {
    if (state.session?.status === 'completed' && allReviewQuestions.length > 0 && !hasInitializedReviewRef.current) {
      const totalQuestions = allReviewQuestions.length;
      const currentIndex = state.session.currentQuestionIndex ?? 0;
      
      // Only reset to question 1 (index 0) on initial load if index is invalid
      // Don't reset if user is navigating through questions
      if (currentIndex < 0 || currentIndex >= totalQuestions) {
        console.log(`[ExamRunner] 🔄 Resetting review mode index to 0 (was ${currentIndex}, total: ${totalQuestions})`);
        // Use navigate to reset to first question
        actions.navigate(0);
        // Also update in IndexedDB to persist the reset
        if (state.session) {
          db.sessions.update(state.session.id, {
            currentQuestionIndex: 0,
            updatedAt: Date.now()
          }).catch(err => console.error('Error updating review index:', err));
        }
      }
      // Mark as initialized so we don't reset again during navigation
      hasInitializedReviewRef.current = true;
    }
    // Reset the ref when session changes (new review session)
    if (!state.session || state.session.status !== 'completed') {
      hasInitializedReviewRef.current = false;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.session?.id, state.session?.status, allReviewQuestions.length, actions]);

  // When exam completes, redirect to the new review page
  useEffect(() => {
    const isCompleted = (state.session?.status as any) === 'completed';
    if (isCompleted && sessionId) {
      router.push(`/exam/${sessionId}/review`);
    }
  }, [state.session?.status, sessionId, router]);

  // --- 5. HOOKS ---
  const annotationTools = useAnnotationTools(sessionId, currentQuestion?.id || '');
  const [isCalcOpen, setCalcOpen] = useState(false);
  const [isReferenceOpen, setReferenceOpen] = useState(false);
  const [isReviewGridOpen, setReviewGridOpen] = useState(false);

  // Calculate expiresAt from exam packet duration and session start time
  const expiresAt = useMemo(() => {
    if (!state.session || !state.currentModule) return null;
    
    // Get exam duration from config (in seconds)
    const examDuration = state.currentModule.config?.total_time || 3600; // Default to 1 hour
    
    // Get session start time (createdAt) - if not set, use current time as fallback
    // This handles cases where old sessions might not have createdAt
    const sessionStartTime = state.session.createdAt || state.session.updatedAt || Date.now();
    
    // Calculate expiration time: start time + duration (convert seconds to milliseconds)
    const expirationTime = sessionStartTime + (examDuration * 1000);
    
    return new Date(expirationTime).toISOString();
  }, [state.session?.createdAt, state.session?.updatedAt, state.currentModule?.config?.total_time]);

  // --- 6. RENDER GATES ---
  
  // Show error if loading failed
  if (state.error) {
    return (
      <div className="flex flex-col items-center justify-center h-screen bg-red-50 p-4">
        <h2 className="text-2xl font-bold text-red-600 mb-2">❌ Load Error</h2>
        <p className="text-red-800 mb-4">{state.error}</p>
        <div className="text-sm text-gray-600 mb-4">
          <p>💡 Try:</p>
          <ul className="list-disc list-inside">
            <li>Check the browser console (F12) for more details</li>
            <li>Contact support if the issue persists</li>
          </ul>
        </div>
        <button 
          onClick={() => window.location.reload()}
          className="px-6 py-2 bg-red-600 text-white rounded shadow hover:bg-red-700"
        >
          Reload Page
        </button>
      </div>
    );
  }
  
  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-screen bg-gray-50">
        <div className="text-center">
          <div className="text-xl font-semibold text-gray-600 animate-pulse mb-2">
            🚀 Booting Exam Engine...
          </div>
          <div className="text-sm text-gray-500">
            {state.isLoading ? 'Loading data from IndexedDB...' : 'Waiting for data...'}
          </div>
        </div>
      </div>
    );
  }

  // Only show error if we truly have no modules at all
  if (!activeModule) {
    return (
      <div className="flex flex-col items-center justify-center h-screen bg-red-50 p-4">
        <h2 className="text-2xl font-bold text-red-600 mb-2">⚠️ Module Error</h2>
        <p className="text-red-800 mb-4">
          Could not find Module ID: {state.session?.currentModuleId || 'undefined'}
        </p>
        <div className="text-sm text-gray-600 mb-4">
          <p>Current module: {state.currentModule?.module?.id || 'none'}</p>
          <p>💡 Try:</p>
          <ul className="list-disc list-inside">
            <li>Check the browser console (F12) for more details</li>
            <li>Contact support if the issue persists</li>
          </ul>
        </div>
        <button onClick={() => window.location.reload()} className="px-6 py-2 bg-red-600 text-white rounded shadow hover:bg-red-700">
          Reload Page
        </button>
      </div>
    );
  }

  // Question Loading State
  // In review mode, allow rendering even if currentQuestion is null (will show empty state)
  const isReviewModeCheck = state.session?.status === 'completed';
  if (!currentQuestion && (state.session?.status as any) !== 'module_1_complete' && !isReviewModeCheck) {
    return (
      <div className={styles.container}>
        <div className="p-10 text-center">
          <div className="text-lg font-semibold mb-2">Loading Question Data...</div>
          <div className="text-sm text-gray-500">
             Attempting to load Index {state.session?.currentQuestionIndex} from {state.session?.currentModuleId}
          </div>
          {isReviewModeCheck && allReviewQuestions.length === 0 && (
            <div className="text-sm text-red-500 mt-2">
              No questions found for review. Check console for details.
            </div>
          )}
        </div>
      </div>
    );
  }

  // --- 7. MAIN UI ---
  const isReviewMode = state.session?.status === 'completed';
  const isLastQuestion = (state.session?.currentQuestionIndex ?? 0) === activeTotalQuestions - 1;
  // isModuleComplete: Only true if Module 1 is complete AND we're not already in Module 2
  const currentModuleId = state.session?.currentModuleId;
  const isInModule2 = currentModuleId === 'rw_module_2_hard' || currentModuleId === 'rw_module_2_easy' || 
                      currentModuleId === 'math_module_2_hard' || currentModuleId === 'math_module_2_easy';
  // Check for both uppercase and lowercase status values (backend uses uppercase, some code uses lowercase)
  const sessionStatus = (state.session?.status as any)?.toUpperCase();
  const isModuleComplete = (sessionStatus === 'MODULE_1_COMPLETE' || sessionStatus === 'MODULE_1_COMPLETE') && !isInModule2;
  const isExamComplete = (state.session?.status as any) === 'completed';
  
  // Determine section name from question domain
  const questionDomain = currentQuestion?.domain || state.currentModule?.questions[currentQuestion?.id || '']?.domain || '';
  const sectionName = questionDomain === 'Math' ? 'Section 2: Math' : 'Section 1: Reading and Writing';
  const questionId = currentQuestion?.id || '';

  // Hide header and footer when showing diagnostic report
  const showingDiagnosticReport = isExamComplete && showDiagnostic && isDiagnosticExam;

  return (
    <div className={styles.container}>
      {!showingDiagnosticReport && (
        <header className={styles.header}>
          <ExamHeader
            questionId={questionId}
            expiresAt={expiresAt}
            onTimeExpire={() => {
              // When time expires, automatically finish the exam
              if (!isReviewMode && !isExamComplete) {
                actions.finishModule();
              }
            }}
            sectionName={sectionName}
            totalQuestions={activeTotalQuestions}
            onToggleCalculator={() => setCalcOpen(!isCalcOpen)}
            onToggleReference={() => setReferenceOpen(!isReferenceOpen)}
            syncStatus={syncStatus}
          />
        </header>
      )}

      <main className={styles.mainArea}>
        {isExamComplete ? (
          // Show diagnostic report (only for diagnostic exams) or review mode
          (() => {
            if (showDiagnostic && isDiagnosticExam) {
              return (
                <div className="flex flex-col items-center justify-center h-full bg-gradient-to-br from-blue-50 to-indigo-50 overflow-y-auto py-8">
                  <DiagnosticReport 
                    categoryPerformance={state.session?.categoryPerformance}
                    performanceProfile={state.session?.performanceProfile}
                    finalScore={state.finalScore}
                    examPacket={null}
                    sessionAnswers={state.session?.answers}
                  />
                  <div className="mt-6 flex flex-col sm:flex-row gap-4">
                    <button
                      className="px-8 py-3 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg shadow-lg transition-all font-semibold text-lg"
                      onClick={() => {
                        router.push(`/exam/${sessionId}/review`);
                      }}
                    >
                      Review Answers
                    </button>
                    <button 
                      className="px-8 py-3 bg-gray-600 text-white rounded-lg hover:bg-gray-700 shadow-lg transition-all font-semibold text-lg"
                      onClick={async () => {
                        // Clean up exam state before navigating
                        try {
                          // Mark session as completed if not already
                          if (state.session && state.session.status !== 'completed') {
                            await db.sessions.update(state.session.id, {
                              status: 'completed',
                              updatedAt: Date.now()
                            });
                          }
                        } catch (error) {
                          console.error('Error updating session status:', error);
                        }
                        // Use router.push for clean navigation without full page reload
                        router.push('/dashboard');
                      }}
                    >
                      Return to Dashboard
                    </button>
                  </div>
                </div>
              );
            } else {
              // Review Mode: Show questions with Socratic Help buttons
              // Handle case where currentQuestion might be null (show helpful message)
              if (!currentQuestion) {
                return (
                  <div className="flex flex-col items-center justify-center h-full bg-gray-50 p-8">
                    <div className="bg-white rounded-lg shadow-lg p-8 max-w-md text-center">
                      <h2 className="text-2xl font-bold mb-4 text-gray-800">Review Mode</h2>
                      <p className="text-gray-600 mb-4">
                        {allReviewQuestions.length === 0 
                          ? "No questions found for review. The exam may not have been completed properly."
                          : `Unable to load question ${(state.session?.currentQuestionIndex ?? 0) + 1} of ${allReviewQuestions.length}.`}
                      </p>
                      {allReviewQuestions.length > 0 && (
                        <div className="text-sm text-gray-500 mb-4">
                          <p>Total questions: {allReviewQuestions.length}</p>
                          <p>Current index: {state.session?.currentQuestionIndex ?? 0}</p>
                        </div>
                      )}
                      <button 
                        className="px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 shadow-lg transition-all font-semibold"
                        onClick={() => {
                          // Reset to first question
                          if (allReviewQuestions.length > 0) {
                            actions.navigate(0);
                          } else {
                            router.push('/dashboard');
                          }
                        }}
                      >
                        {allReviewQuestions.length > 0 ? 'Go to First Question' : 'Return to Dashboard'}
                      </button>
                    </div>
                  </div>
                );
              }
              
              return (
                <div className={styles.splitWrapper}>
                  <SplitScreenLayout
                    leftPane={
                      <div className={styles.passageContainer}>
                        <div className={styles.passageBorder}>
                          <div className={styles.passageContent}>
                            <div className="mb-4">
                              <div className="flex items-center justify-between mb-4">
                                <div className="text-sm font-semibold text-gray-500">
                                  Question {(state.session?.currentQuestionIndex ?? 0) + 1} (Review Mode)
                                </div>
                                {/* Socratic Help button for all questions in review mode */}
                                <button
                                  className="px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 text-sm font-medium flex items-center gap-2"
                                  onClick={() => {
                                    setSocraticHelpQuestionId(currentQuestion.id);
                                    setSocraticHelpOpen(true);
                                  }}
                                >
                                  <HelpCircle className="h-4 w-4" />
                                  Get Socratic Help
                                </button>
                              </div>
                              <Highlighter
                                highlights={annotationTools.highlights}
                                onHighlight={annotationTools.addHighlight}
                                onRemoveHighlight={annotationTools.removeHighlight}
                                className={styles.highlighterWrapper}
                              >
                                <div data-testid="question-text" className="text-lg font-medium text-gray-800 mb-4 prose prose-sm max-w-none [&_table]:border [&_table]:border-collapse [&_td]:border [&_th]:border [&_td]:p-2 [&_th]:p-2 [&_p]:mb-2">
                                  <MathRenderer allowHtml>
                                    {processMathMLInHTML(currentQuestion?.questionText || '')}
                                  </MathRenderer>
                                </div>
                                {currentQuestion?.stimulus && (
                                  <div className="mt-4 pt-4 border-t border-gray-200">
                                    <div className="text-sm font-semibold text-gray-500 mb-2">Passage:</div>
                                    <div 
                                      className="text-base text-gray-700 leading-relaxed"
                                      dangerouslySetInnerHTML={{ 
                                        __html: currentQuestion.stimulus 
                                      }}
                                    />
                                  </div>
                                )}
                              </Highlighter>
                            </div>
                          </div>
                        </div>
                      </div>
                    }
                    rightPane={
                      <div className={styles.questionContainer}>
                        <div className={styles.questionHeaderBar}>
                          <div className={styles.questionHeaderLeft}>
                            <span className={styles.questionNumber}>{(state.session?.currentQuestionIndex ?? 0) + 1}</span>
                          </div>
                          <div className={styles.questionHeaderRight} style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                            {isReviewMode && (
                              <button 
                                className="px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 text-sm font-medium flex items-center gap-2"
                                onClick={() => {
                                  setSocraticHelpQuestionId(currentQuestion.id);
                                  setSocraticHelpOpen(true);
                                }}
                              >
                                <HelpCircle className="h-4 w-4" />
                                Socratic Help
                              </button>
                            )}
                            {isDiagnosticExam && (
                              <button 
                                className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 text-sm font-medium"
                                onClick={() => setShowDiagnostic(true)}
                              >
                                Back to Diagnostic
                              </button>
                            )}
                          </div>
                        </div>
                        <div className={styles.optionsContainer}>
                          {currentQuestion?.choices && currentQuestion.choices.length > 0 ? (
                            currentQuestion.choices.map((c: any) => {
                              const isSelected = state.session?.answers?.[currentQuestion.id] === String(c.id);
                              const correctAnswer = state.currentModule?.questions[currentQuestion.id]?.correct_answer;
                              const selectedAnswer = state.session?.answers?.[currentQuestion.id];
                              
                              // Review mode styling: Green for correct answer, Red for incorrect selected answer
                              const isCorrectAnswer = isReviewMode && normalizeAnswer(String(c.id)) === normalizeAnswer(String(correctAnswer ?? ''));
                              const isIncorrectSelected = isReviewMode && isSelected && normalizeAnswer(String(selectedAnswer ?? '')) !== normalizeAnswer(String(correctAnswer ?? ''));
                              
                              return (
                                <div key={c.id} className={`${styles.optionWrapper} ${isSelected ? styles.optionSelected : ''} ${isCorrectAnswer ? 'border-2 border-green-500 bg-green-50' : ''} ${isIncorrectSelected ? 'border-2 border-red-500 bg-red-50' : ''}`}>
                                  <div className="flex items-center w-full gap-2">
                                    <button
                                      data-testid="option-btn"
                                      className={`flex-1 ${styles.optionButton} ${isSelected && !isReviewMode ? 'bg-blue-600 text-white' : ''} ${isCorrectAnswer ? 'bg-green-50' : ''} ${isIncorrectSelected ? 'bg-red-50' : ''}`}
                                      disabled={isReviewMode}
                                      onClick={() => {
                                        if (!isReviewMode) {
                                          actions.submitAnswer(currentQuestion.id, String(c.id));
                                        }
                                      }}
                                    >
                                      <span className={styles.optionLabel}>{c.id}</span>
                                      <span className={styles.optionText}>
                                        <MathRenderer allowHtml>
                                          {processMathMLInHTML(c.text)}
                                        </MathRenderer>
                                      </span>
                                    </button>
                                    {/* Show Socratic Help for incorrect answers OR when no answer was selected */}
                                    {(isIncorrectSelected || (isReviewMode && !selectedAnswer && isCorrectAnswer)) && (
                                      <button
                                        className="px-3 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 text-sm font-medium flex items-center gap-2 whitespace-nowrap"
                                        onClick={() => {
                                          setSocraticHelpQuestionId(currentQuestion.id);
                                          setSocraticHelpOpen(true);
                                        }}
                                      >
                                        <HelpCircle className="h-4 w-4" />
                                        Socratic Help
                                      </button>
                                    )}
                                  </div>
                                </div>
                              );
                            })
                          ) : (
                            <div className="text-gray-500 text-center py-8">
                              No answer choices available for this question.
                            </div>
                          )}
                        </div>
                      </div>
                    }
                    passageId={currentQuestion?.id || ''}
                    questionId={currentQuestion?.id || ''}
                  />
                </div>
              );
            }
          })()
        ) : isModuleComplete ? (
          // Section Complete Card (inside main area, doesn't hide header/footer)
          <div className="flex flex-col items-center justify-center h-full bg-gray-50">
            <div className="bg-white rounded-lg shadow-lg p-8 max-w-md text-center">
              <h1 className="text-3xl font-bold mb-4 text-gray-800">Section Complete!</h1>
              {(() => {
                // Calculate and display Module 1 score if available
                // Note: With module-based fetching, we may not have Module 1 data in currentModule
                // For now, skip score calculation - can be enhanced to fetch Module 1 data if needed
                const nextModuleId = (state.session as any)?.nextModuleId;
                if (state.currentModule && state.session?.answers) {
                  const questionIds = state.currentModule.module.question_order || [];
                  let correctCount = 0;
                  for (const questionId of questionIds) {
                    const questionData = state.currentModule.questions?.[questionId];
                    if (!questionData) continue;
                    const studentAnswer = state.session.answers?.[questionId];
                    const correctAnswer = (questionData as any).correct_answer;
                    const isCorrect = studentAnswer !== undefined &&
                      normalizeAnswer(String(studentAnswer)) === normalizeAnswer(String(correctAnswer ?? ''));
                    if (isCorrect) correctCount++;
                  }
                  const threshold = 12; // Default threshold - routing logic no longer in currentModule
                  const moduleName = nextModuleId === 'rw_module_2_hard' ? 'Hard' : 'Easy';
                  return (
                    <>
                      <div className="mb-4 p-4 bg-blue-50 rounded-lg">
                        <p className="text-lg font-semibold text-gray-700 mb-1">
                          Module 1 Score: {correctCount}/{questionIds.length}
                        </p>
                        <p className="text-sm text-gray-600">
                          Threshold: {threshold} → Routing to <span className="font-bold">{moduleName} Module 2</span>
                        </p>
                      </div>
                      <p className="text-gray-600 mb-6">Take a break. The next module is ready.</p>
                    </>
                  );
                }
                return <p className="text-gray-600 mb-6">Take a break. The next module is ready.</p>;
              })()}
              <button 
                className="px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 shadow-lg transition-all font-semibold"
                onClick={() => actions.startNextModule()}
              >
                Start Module 2
              </button>
            </div>
          </div>
        ) : currentQuestion ? (
          <div className={styles.splitWrapper}>
            <SplitScreenLayout
            leftPane={
              // LEFT PANE: Question Text (and passage if available)
              <div className={styles.passageContainer}>
                <div className={styles.passageBorder}>
                  <div className={styles.passageContent}>
                    <div className="mb-4">
                      <div className="text-sm font-semibold text-gray-500 mb-2">
                        Question {(state.session?.currentQuestionIndex ?? 0) + 1}
                      </div>
                      <Highlighter
                        highlights={annotationTools.highlights}
                        onHighlight={annotationTools.addHighlight}
                        onRemoveHighlight={annotationTools.removeHighlight}
                        className={styles.highlighterWrapper}
                      >
                        {currentQuestion.stimulus && (
                            <div className="mb-4 pb-4 border-b border-gray-200">
                                <div
                                    className="text-base text-gray-700 leading-relaxed prose prose-sm max-w-none [&_table]:border [&_table]:border-collapse [&_td]:border [&_th]:border [&_td]:p-2 [&_th]:p-2"
                                    dangerouslySetInnerHTML={{ __html: currentQuestion.stimulus }}
                                />
                            </div>
                        )}
                        <div data-testid="question-text" className="text-lg font-medium text-gray-800 mb-4 prose prose-sm max-w-none [&_table]:border [&_table]:border-collapse [&_td]:border [&_th]:border [&_td]:p-2 [&_th]:p-2 [&_p]:mb-2">
                          <MathRenderer allowHtml>
                            {processMathMLInHTML(currentQuestion.questionText)}
                          </MathRenderer>
                        </div>
                      </Highlighter>
                    </div>
                  </div>
                </div>
              </div>
            }
            rightPane={
              // RIGHT PANE: Answer Choices
              <div className={styles.questionContainer}>
                <div className={styles.questionHeaderBar}>
                  <div className={styles.questionHeaderLeft}>
                    <span className={styles.questionNumber}>{(state.session?.currentQuestionIndex ?? 0) + 1}</span>
                  </div>
                  <div className={styles.questionHeaderRight}>
                    {/* Mark for Review Button */}
                    <button
                      className={`${styles.markForReviewButton} ${annotationTools.isMarkedForReview ? styles.markForReviewChecked : ''}`}
                      onClick={async () => {
                        await annotationTools.toggleMarkForReview();
                      }}
                      aria-label={annotationTools.isMarkedForReview ? 'Unmark for review' : 'Mark for review'}
                    >
                      <Bookmark 
                        className={`${styles.bookmarkIcon} ${annotationTools.isMarkedForReview ? styles.bookmarkIconFilled : ''}`}
                      />
                      <span>Mark for Review</span>
                    </button>
                    
                    {/* Eliminator Button */}
                    <button 
                      className={`${styles.eliminatorButton} ${annotationTools.isEliminatorMode ? styles.eliminatorButtonActive : ''}`}
                      onClick={annotationTools.toggleEliminatorMode}
                      aria-label={annotationTools.isEliminatorMode ? 'Exit eliminator mode' : 'Enter eliminator mode'}
                    >
                      <X className={styles.eliminatorIcon} /> <span>Eliminator</span>
                    </button>
                  </div>
                </div>

                <div className={styles.optionsContainer}>
                  {/* Check if this is a Student-Produced Response (SPR) question */}
                  {currentQuestion.is_spr || (currentQuestion.domain === 'Math' && (!currentQuestion.choices || currentQuestion.choices.length === 0)) ? (
                    // SPR / Grid-in Question: Text Input
                    (() => {
                      const questionData = state.currentModule?.questions?.[currentQuestion.id];
                      const correctAnswer = questionData ? (questionData as any).correct_answer : undefined;
                      const selectedAnswer = state.session?.answers?.[currentQuestion.id] || '';
                      const answerPreview = formatAnswerPreview(selectedAnswer);
                      
                      // Review mode: Check if answer is correct
                      const isCorrect = isReviewMode && selectedAnswer && answersMatch(selectedAnswer, correctAnswer);
                      const isIncorrect = isReviewMode && selectedAnswer && !isCorrect;
                      
                      return (
                        <div className="space-y-4">
                          {/* Answer Input Field */}
                          <div className="relative">
                            <input
                              type="text"
                              value={selectedAnswer}
                              onChange={(e) => {
                                if (isReviewMode) return; // Don't allow changes in review mode
                                
                                let value = e.target.value;
                                
                                // Remove spaces
                                value = value.replace(/\s/g, '');
                                
                                // Only allow: digits, decimal point, forward slash, negative sign
                                value = value.replace(/[^0-9./-]/g, '');
                                
                                // Limit to 6 characters
                                if (value.length > 6) {
                                  value = value.slice(0, 6);
                                }
                                
                                // Validate negative sign can only be at the start
                                if (value.includes('-') && value.indexOf('-') !== 0) {
                                  value = value.replace(/-/g, '');
                                  if (value.length < 6) {
                                    value = '-' + value;
                                  }
                                }
                                
                                // Update answer
                                actions.submitAnswer(currentQuestion.id, value);
                              }}
                              disabled={isReviewMode}
                              placeholder="Enter your answer"
                              className={`
                                w-full px-4 py-3 text-lg border-2 rounded-lg
                                focus:outline-none focus:ring-2 focus:ring-blue-500
                                ${isCorrect ? 'border-green-500 bg-green-50' : ''}
                                ${isIncorrect ? 'border-red-500 bg-red-50' : ''}
                                ${!isReviewMode ? 'border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900' : ''}
                                disabled:bg-zinc-100 dark:disabled:bg-zinc-800
                              `}
                              maxLength={6}
                            />
                          </div>
                          
                          {/* Answer Preview */}
                          {selectedAnswer && (
                            <div className={`
                              px-4 py-2 rounded-lg text-sm font-medium
                              ${isCorrect ? 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400' : ''}
                              ${isIncorrect ? 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400' : ''}
                              ${!isReviewMode ? 'bg-zinc-100 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300' : ''}
                            `}>
                              <span className="font-semibold">Answer Preview: </span>
                              <span>{answerPreview}</span>
                            </div>
                          )}
                          
                          {/* Instructions for SPR questions */}
                          {!isReviewMode && (
                            <div className="text-xs text-zinc-500 dark:text-zinc-400 space-y-1">
                              <p>• Enter only one answer if multiple are found</p>
                              <p>• Up to 5 characters for positive answers, up to 6 for negative (including the negative sign)</p>
                              <p>• Fractions should be entered as improper fractions (e.g., 7/2) or decimals (e.g., 3.5)</p>
                              <p>• Do not enter symbols like %, commas, or dollar signs</p>
                            </div>
                          )}
                          
                          {/* Socratic Help button for incorrect answers OR when no answer was selected */}
                          {(isIncorrect || (isReviewMode && !selectedAnswer)) && (
                            <button
                              className="w-full px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 text-sm font-medium flex items-center justify-center gap-2"
                              onClick={() => {
                                setSocraticHelpQuestionId(currentQuestion.id);
                                setSocraticHelpOpen(true);
                              }}
                            >
                              <HelpCircle className="h-4 w-4" />
                              Get Socratic Help
                            </button>
                          )}
                        </div>
                      );
                    })()
                  ) : currentQuestion.choices && currentQuestion.choices.length > 0 ? (
                    // Multiple Choice Question: Radio Buttons
                    currentQuestion.choices.map((c: any) => {
                      const isEliminated = annotationTools.isEliminated(c.id);
                      const isSelected = state.session?.answers?.[currentQuestion.id] === String(c.id);
                      
                      // Review mode logic: Get correct answer and selected answer
                      const questionData = state.currentModule?.questions?.[currentQuestion.id];
                      const correctAnswer = questionData ? (questionData as any).correct_answer : undefined;
                      const selectedAnswer = state.session?.answers?.[currentQuestion.id];
                      
                      // Review mode styling: Green for correct answer, Red for incorrect selected answer
                      const isCorrectAnswer = isReviewMode && String(c.id).toUpperCase().trim() === String(correctAnswer).toUpperCase().trim();
                      const isIncorrectSelected = isReviewMode && isSelected && String(selectedAnswer).toUpperCase().trim() !== String(correctAnswer).toUpperCase().trim();
                      
                      return (
                        <div key={c.id} className={`${styles.optionWrapper} ${isEliminated ? styles.optionEliminated : ''} ${isSelected && !isReviewMode ? styles.optionSelected : ''} ${isCorrectAnswer ? 'border-2 border-green-500 bg-green-50' : ''} ${isIncorrectSelected ? 'border-2 border-red-500 bg-red-50' : ''}`}>
                          <div className="flex items-center w-full gap-2">
                            <button
                              data-testid="option-btn"
                              className={`flex-1 ${styles.optionButton} ${isEliminated ? styles.optionButtonEliminated : ''} ${isSelected && !isReviewMode ? 'bg-blue-600 text-white' : ''} ${isCorrectAnswer ? 'bg-green-50' : ''} ${isIncorrectSelected ? 'bg-red-50' : ''}`}
                              onClick={() => {
                                if (!isEliminated && !isReviewMode) {
                                  actions.submitAnswer(currentQuestion.id, String(c.id));
                                }
                              }}
                              disabled={isEliminated || isReviewMode}
                            >
                              <span className={styles.optionLabel}>{c.id}</span>
                              <span 
                                className={`${styles.optionText} ${isEliminated ? styles.optionTextEliminated : ''}`}
                              >
                                <MathRenderer allowHtml>
                                  {processMathMLInHTML(c.text)}
                                </MathRenderer>
                              </span>
                            </button>

                            {/* Eliminator X Button - Show when eliminator mode is active */}
                            {annotationTools.isEliminatorMode && !isReviewMode && (
                              <button
                                className={styles.eliminateButton}
                                onClick={() => annotationTools.toggleElimination(c.id)}
                                aria-label={isEliminated ? `Restore option ${c.id}` : `Eliminate option ${c.id}`}
                                title={isEliminated ? 'Restore' : 'Eliminate'}
                              >
                                <X className="h-4 w-4" />
                              </button>
                            )}
                            
                            {/* Undo Button - Show when eliminated outside eliminator mode */}
                            {isEliminated && !annotationTools.isEliminatorMode && !isReviewMode && (
                              <button
                                className={styles.undoButton}
                                onClick={() => annotationTools.toggleElimination(c.id)}
                                aria-label={`Restore option ${c.id}`}
                              >
                                <RotateCcw className="h-4 w-4" />
                                <span>Undo</span>
                              </button>
                            )}
                            
                            {(() => {
                              // Check if student answered this question
                              const hasNoAnswer = isReviewMode && !selectedAnswer;
                              const showHelp = isIncorrectSelected || (hasNoAnswer && isCorrectAnswer);
                              
                              return showHelp ? (
                                <button
                                  className="px-3 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 text-sm font-medium flex items-center gap-2 whitespace-nowrap"
                                  onClick={() => {
                                    setSocraticHelpQuestionId(currentQuestion.id);
                                    setSocraticHelpOpen(true);
                                  }}
                                >
                                  <HelpCircle className="h-4 w-4" />
                                  Socratic Help
                                </button>
                              ) : null;
                            })()}
                          </div>
                        </div>
                      );
                    })
                  ) : (
                    <div className="text-gray-500 text-center py-8">
                      No answer choices available for this question.
                    </div>
                  )}
                </div>
              </div>
            }
              passageId={currentQuestion.id}
              questionId={currentQuestion.id}
            />
          </div>
        ) : null}

        {/* Socratic Help Chat Panel - New Implementation with Streaming */}
        {socraticHelpOpen && socraticHelpQuestionId && (() => {
          // Build currentQuestion object from available data
          const questionData = state.currentModule?.questions?.[socraticHelpQuestionId];
          const studentAnswer = state.session?.answers?.[socraticHelpQuestionId];
          const correctAnswer = questionData ? (questionData as any).correct_answer : undefined;
          
          // Build questionForChat from currentQuestion or questionData
          let questionForChat: { id: string; text: string; choices?: Array<{ id: string; text: string }>; correctAnswer?: string; explanation?: string; skillTags?: string | string[] } | undefined;
          
          if (currentQuestion && currentQuestion.id === socraticHelpQuestionId) {
            // Use currentQuestion if it matches
            questionForChat = {
              id: currentQuestion.id,
              text: currentQuestion.questionText || '',
              choices: currentQuestion.choices?.map(c => ({ id: String(c.id), text: c.text })),
              correctAnswer: correctAnswer,
              explanation: questionData ? (questionData as any).solution_text : undefined,
              skillTags: questionData ? (questionData as any).skill_tag : undefined,
            };
          } else if (questionData) {
            // Build from questionData
            const rawData = questionData as any;
            questionForChat = {
              id: socraticHelpQuestionId,
              text: rawData.text || rawData.stem || '',
              choices: currentQuestion?.choices?.map(c => ({ id: String(c.id), text: c.text })) || [],
              correctAnswer: correctAnswer,
              explanation: rawData.solution_text || rawData.solution || '',
              skillTags: rawData.skill_tag || rawData.skill || '',
            };
          } else {
            questionForChat = undefined;
          }
          
          return (
            <ChatPanel
              isOpen={socraticHelpOpen}
              onClose={() => {
                setSocraticHelpOpen(false);
                setSocraticHelpQuestionId(null);
              }}
              questionId={socraticHelpQuestionId}
              sessionId={sessionId}
              studentAnswer={studentAnswer}
              questionText={questionForChat?.text || state.currentModule?.questions[socraticHelpQuestionId]?.text || ''}
              currentQuestion={questionForChat}
              mode="default"
              initialMessage={
                (() => {
                  if (!questionData || !correctAnswer) return undefined;
                  
                  // If student selected an incorrect answer
                  if (studentAnswer && String(studentAnswer).toUpperCase().trim() !== String(correctAnswer).toUpperCase().trim()) {
                    return `I chose ${String(studentAnswer).toUpperCase()} but the correct answer is ${String(correctAnswer).toUpperCase()}. Can you help me understand why?`;
                  }
                  
                  // If student didn't answer the question
                  if (!studentAnswer) {
                    return `I didn't answer this question. The correct answer is ${String(correctAnswer).toUpperCase()}. Can you explain why this is the correct answer?`;
                  }
                  
                  // If student got it correct, no initial message needed
                  return undefined;
                })()
              }
            />
          );
        })()}

        {/* Desmos Calculator Modal - Only show for Math sections */}
        {questionDomain === 'Math' && (
          <CalculatorModal
            isOpen={isCalcOpen}
            onClose={() => setCalcOpen(false)}
          />
        )}

        {/* Reference Sheet Modal - Only show for Math sections */}
        {questionDomain === 'Math' && (
          <ReferenceSheetModal
            isOpen={isReferenceOpen}
            onClose={() => setReferenceOpen(false)}
          />
        )}

        {/* Review Grid Modal */}
        {isReviewGridOpen && currentQuestion && activeModule && (
          <ReviewGrid
            totalQuestions={activeTotalQuestions}
            currentQuestionId={currentQuestion.id}
            currentQuestionNumber={(state.session?.currentQuestionIndex ?? 0) + 1}
            sessionId={sessionId}
            questionIds={(() => {
              // Get all question IDs from current module or all modules in review mode
              if (isReviewMode && allReviewQuestions.length > 0) {
                return allReviewQuestions;
              }
              return activeModule.question_order || [];
            })()}
            sectionName={sectionName}
            onQuestionClick={(questionId, questionNumber) => {
              // Navigate to the clicked question
              // questionNumber is 1-based, convert to 0-based index
              const targetIndex = questionNumber - 1;
              
              if (isReviewMode) {
                // In review mode, use the questionNumber directly (it's already the global index)
                if (targetIndex >= 0 && targetIndex < allReviewQuestions.length) {
                  actions.navigate(targetIndex);
                }
              } else {
                // In normal mode, find index in current module
                const moduleIndex = activeModule.question_order?.indexOf(questionId);
                if (moduleIndex !== undefined && moduleIndex >= 0) {
                  actions.navigate(moduleIndex);
                } else {
                  // Fallback: use questionNumber - 1 as index
                  if (targetIndex >= 0 && targetIndex < (activeModule.question_order?.length || 0)) {
                    actions.navigate(targetIndex);
                  }
                }
              }
              setReviewGridOpen(false);
            }}
            onClose={() => setReviewGridOpen(false)}
            onGoToReviewPage={() => {
              // Navigate to review page if exam is complete
              if (isExamComplete) {
                window.location.href = `/exam/${sessionId}/review`;
              }
            }}
          />
        )}
      </main>

      {!showingDiagnosticReport && (
        <footer className={styles.footer}>
          <BottomBar
          currentQuestion={(state.session?.currentQuestionIndex ?? 0) + 1}
          totalQuestions={activeTotalQuestions}
          questionId={questionId}
          sessionId={sessionId}
          onPrev={() => {
            if (isReviewMode) {
              // In review mode, allow navigation (read-only)
              actions.navigate('prev');
            } else {
              actions.navigate('prev');
            }
          }}
          onNext={async () => {
            if (isReviewMode) {
              // In review mode, just navigate (read-only)
              if (isLastQuestion) {
                // Loop back to first question or go to dashboard
                router.push('/dashboard');
                return;
              } else {
                actions.navigate('next');
              }
            } else if (isExamComplete) {
              router.push('/dashboard');
              return;
            } else if (isModuleComplete) {
              // Double-check: Don't start Module 2 if we're already in Module 2 or completed
              const currentModuleId = state.session?.currentModuleId;
              const isAlreadyInModule2 = currentModuleId === 'rw_module_2_hard' || currentModuleId === 'rw_module_2_easy';
              if (isAlreadyInModule2) {
                console.warn("⚠️ Already in Module 2, calling finishModule instead");
                await actions.finishModule();
              } else {
                await actions.startNextModule();
              }
            } else if (isLastQuestion) {
              await actions.finishModule();
            } else {
              actions.navigate('next');
            }
          }}
          isPrevDisabled={
            isReviewMode 
              ? (state.session?.currentQuestionIndex ?? 0) === 0 
              : ((state.session?.currentQuestionIndex ?? 0) === 0 || isModuleComplete || isExamComplete)
          }
          onReviewGrid={() => setReviewGridOpen(true)}
          isNextDisabled={false}
          nextButtonText={
            isReviewMode 
              ? (isLastQuestion ? 'Return to Dashboard' : 'Next')
              : (isExamComplete ? 'Return to Dashboard' : 
                (isModuleComplete ? 'Start Module 2' : 
                (isLastQuestion ? 'Finish Section' : 'Next')))
          }
          studentName="Student"
          />
        </footer>
      )}
    </div>
  );
}