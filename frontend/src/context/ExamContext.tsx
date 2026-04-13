'use client';

import React, { createContext, useContext, useReducer, useCallback, useEffect, useRef } from 'react';
// FIX: Use relative paths to guarantee connection
import { db, SessionRecord } from '../lib/db'; 
import { ExamPacket, ExamModule, QuestionContent, ExamConfig } from '../types/ExamPacket';
import { estimateThetaMLE, type ResponsePattern } from '../lib/psychometrics/irt';
import { scoreEngine } from '../services/ScoreEngine';
import { ENOUGH_THINKING_EXAM } from '../data/diagnosticExam';

// --- Types ---
interface Session extends SessionRecord {
  answers: Record<string, string>;
  nextModuleId?: string;
  finalScore?: number;
  performanceProfile?: Record<string, { total: number; correct: number }>;
}

interface CurrentModule {
  module: ExamModule;
  questions: Record<string, QuestionContent>;
  config: ExamConfig;
}

interface ExamState {
  session: Session | null;
  currentModule: CurrentModule | null; // Current active module (replaces examPacket)
  isLoading: boolean;
  error: string | null;
  finalScore: number | null; // Final SAT section score (200-800)
}

// --- Actions ---
type Action =
  | { type: 'SET_LOADING'; payload: boolean }
  | { type: 'SET_SESSION'; payload: SessionRecord }
  | { type: 'SET_CURRENT_MODULE'; payload: CurrentModule }
  | { type: 'SET_ERROR'; payload: string }
  | { type: 'SELECT_ANSWER'; payload: { questionId: string; choiceId: string } }
  | { type: 'NAVIGATE'; payload: number }
  | { type: 'SET_FINAL_SCORE'; payload: number }
  | { type: 'SET_ANSWERS'; payload: Record<string, string> };

const initialState: ExamState = {
  session: null,
  currentModule: null,
  isLoading: true, // Default to true so UI waits
  error: null,
  finalScore: null,
};

// Helper removed - no longer needed with module-based fetching

function examReducer(state: ExamState, action: Action): ExamState {
  switch (action.type) {
    case 'SET_LOADING': 
      return { ...state, isLoading: action.payload, error: null };
    case 'SET_SESSION': 
      const updatedSession = {
        ...action.payload,
        answers: (action.payload as any).answers || {}
      };
      return { 
        ...state, 
        session: updatedSession
      };
    case 'SET_CURRENT_MODULE': 
      return { 
        ...state, 
        currentModule: action.payload
      };
    case 'SET_ERROR': 
      return { ...state, isLoading: false, error: action.payload };
    case 'SELECT_ANSWER':
      return {
        ...state,
        session: state.session ? {
          ...state.session,
          answers: {
            ...state.session.answers,
            [action.payload.questionId]: action.payload.choiceId
          },
          updatedAt: Date.now()
        } : null
      };
    case 'SET_ANSWERS':
      return {
        ...state,
        session: state.session ? {
          ...state.session,
          answers: action.payload,
          updatedAt: Date.now()
        } : null
      };
    case 'NAVIGATE':
      return {
        ...state,
        session: state.session ? {
          ...state.session,
          currentQuestionIndex: action.payload,
          updatedAt: Date.now()
        } : null
      };
    case 'SET_FINAL_SCORE':
      return {
        ...state,
        finalScore: action.payload
      };
    default: 
      return state;
  }
}

const ExamContext = createContext<{
  state: ExamState;
  actions: {
    loadSession: (id: string) => Promise<void>;
    submitAnswer: (questionId: string, choiceId: string) => void;
    navigate: (direction: 'next' | 'prev' | number) => void;
    finishModule: () => Promise<void>;
    startNextModule: () => Promise<void>;
    startDiagnostic: (examType?: 'DIAGNOSTIC_MATH' | 'DIAGNOSTIC_RW') => Promise<string>; // Returns sessionId for navigation
  };
} | null>(null);

export const ExamProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [state, dispatch] = useReducer(examReducer, initialState);

  // Helper function to determine exam type and get module IDs
  const getExamModuleIds = useCallback(() => {
    const DIAGNOSTIC_MATH_UUID = '550e8400-e29b-41d4-a716-446655440000';
    const DIAGNOSTIC_RW_UUID = '550e8400-e29b-41d4-a716-446655440001';
    
    // Determine exam type from exam ID (no longer from examPacket)
    const isMathExam = state.session?.examId === DIAGNOSTIC_MATH_UUID;
    const isRWExam = state.session?.examId === DIAGNOSTIC_RW_UUID;
    
    // Fallback: Check current module ID
    const currentModuleId = state.currentModule?.module?.id || state.session?.currentModuleId;
    const modulePrefix = currentModuleId?.startsWith('math_') ? 'math' : 
                        currentModuleId?.startsWith('rw_') ? 'rw' : 
                        isMathExam ? 'math' : 'rw';
    
    return {
      module1: `${modulePrefix}_module_1`,
      module2Easy: `${modulePrefix}_module_2_easy`,
      module2Hard: `${modulePrefix}_module_2_hard`,
      isMath: modulePrefix === 'math'
    };
  }, [state.currentModule, state.session]);
  const isLoadingRef = useRef(false);

  // --- QUICK START: Start Diagnostic Exam ---
  const startDiagnostic = useCallback(async (examType: 'DIAGNOSTIC_MATH' | 'DIAGNOSTIC_RW' = 'DIAGNOSTIC_RW'): Promise<string> => {
    // Note: Diagnostic exam must be seeded in backend before starting
    // Use the seed_diagnostic_exam.py script to create diagnostic exams
    
    // Determine exam ID based on type
    const DIAGNOSTIC_MATH_UUID = '550e8400-e29b-41d4-a716-446655440000';
    const DIAGNOSTIC_RW_UUID = '550e8400-e29b-41d4-a716-446655440001';
    const examId = examType === 'DIAGNOSTIC_MATH' ? DIAGNOSTIC_MATH_UUID : DIAGNOSTIC_RW_UUID;

    // Generate a new sessionId (UUID format for backend compatibility)
    // Use crypto.randomUUID() if available (browser API), otherwise generate a UUID v4
    let sessionId: string;
    if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
      sessionId = crypto.randomUUID();
    } else {
      // Fallback: Generate UUID v4 manually
      sessionId = 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
        const r = Math.random() * 16 | 0;
        const v = c === 'x' ? r : (r & 0x3 | 0x8);
        return v.toString(16);
      });
    }

    // 3. Create session in backend first (for cross-device persistence)
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
        
        // Check if backend creation was skipped (diagnostic exams, network errors, etc.)
        if (createData.skipBackend) {
          console.log(`ℹ️ Backend session creation skipped: ${createData.message || 'local-only mode'}`);
          console.log(`ℹ️ This is OK - the session will be auto-created in the backend when you sync your responses.`);
          console.log(`ℹ️ Creating local session now...`);
          // Continue with local-only mode - session will be created in backend during sync
        } else {
          backendSessionId = createData.session_id || sessionId;
          isBackendCreated = true;
          console.log(`✅ Session created in backend: ${backendSessionId}`);
        }
      } else {
        const errorData = await createResponse.json().catch(() => ({ error: 'Unknown error' }));
        console.warn(`⚠️ Failed to create session in backend (will continue locally):`, errorData);
        // Continue with local-only mode - session will be created locally
      }
    } catch (error) {
      console.warn(`⚠️ Error creating session in backend (will continue locally):`, error);
      // Continue with local-only mode
    }

    // 4. Fetch exam structure to get first module ID
    // Note: We no longer cache full exam packets - modules are fetched on-demand
    let firstModuleId: string | undefined;
    try {
      const examResponse = await fetch(`/api/exams/${examId}`);
      if (examResponse.ok) {
        const examData = await examResponse.json();
        const structure = examData.structure || examData;
        // Handle both direct structure and nested structure
        const children = structure.children || (structure.structure?.children) || [];
        if (children.length > 0) {
          firstModuleId = children[0].id;
        } else if (structure.id) {
          // If no children, use the structure itself as the module
          firstModuleId = structure.id;
        }
      }
    } catch (error) {
      console.warn('Could not fetch exam structure from backend:', error);
      // Default module IDs based on exam type
      if (examType === 'DIAGNOSTIC_MATH') {
        firstModuleId = 'math_module_1';
      } else {
        firstModuleId = 'rw_module_1';
      }
      console.warn('Using default module ID:', firstModuleId);
    }

    // 5. Create a SessionRecord linked to the diagnostic exam
    const newSession: SessionRecord = {
      id: backendSessionId, // Use backend session ID if created, otherwise use generated one
      examId: examId,
      status: 'active',
      currentModuleId: firstModuleId,
      currentQuestionIndex: 0,
      answers: {},
      isSynced: isBackendCreated, // Mark as synced if backend creation succeeded
      createdAt: Date.now(),
      updatedAt: Date.now()
    };

    // 6. Save session to IndexedDB
    await db.sessions.put(newSession);
    console.log(`✅ Created diagnostic session locally: ${backendSessionId} (backend: ${isBackendCreated ? 'yes' : 'no'})`);

    // 7. Return sessionId for navigation
    return backendSessionId;
  }, []);

  // --- Fetch Current Module from Backend ---
  const fetchCurrentModule = useCallback(async (sessionId: string): Promise<CurrentModule | null> => {
    try {
      const response = await fetch(`/api/exam/session/${sessionId}/current-module`);
      
      if (!response.ok) {
        throw new Error(`Failed to fetch current module: ${response.status}`);
      }
      
      const data = await response.json();
      
      // Transform backend response to CurrentModule format
      return {
        module: data.module,
        questions: data.questions,
        config: data.config
      };
    } catch (error) {
      console.error('Error fetching current module:', error);
      return null;
    }
  }, []);

  // --- AUTO-ALIGNMENT LOADER (Module-Based Fetching) ---
  const loadSession = useCallback(async (sessionId: string) => {
    // Prevent multiple simultaneous loads using ref
    if (isLoadingRef.current) {
      console.log("⏸️ Load already in progress, skipping...");
      return;
    }
    
    isLoadingRef.current = true;
    dispatch({ type: 'SET_LOADING', payload: true });
    try {
      // Get Session First (try local, then server if not found)
      const sessions = await db.sessions.toArray();
      let activeSession = sessions.find(s => s.id === sessionId);
      
      // Hydration: If session not found locally, try fetching from backend
      if (!activeSession) {
        try {
          console.log(`🔄 Session ${sessionId} not found locally, attempting backend fetch...`);
          const response = await fetch(`/api/student/sessions/${sessionId}`);
          if (response.ok) {
            const serverSession = await response.json();
            // Save to local IndexedDB
            await db.sessions.put({
              ...serverSession,
              isSynced: true,
              updatedAt: Date.now()
            });
            activeSession = serverSession;
            console.log(`✅ Session ${sessionId} loaded from backend and cached locally`);
          } else if (response.status === 404) {
            console.log(`ℹ️ Session ${sessionId} not found on backend, continuing with local-only mode`);
            activeSession = sessions.find(s => s.status === 'active') || sessions[0];
          } else {
            throw new Error(`Backend returned status ${response.status}`);
          }
        } catch (error) {
          console.warn(`⚠️ Failed to fetch session from backend (offline mode):`, error);
          activeSession = sessions.find(s => s.status === 'active') || sessions[0];
        }
      }
      
      // Fallback: If still no session found, try to find an active one
      if (!activeSession) {
        activeSession = sessions.find(s => s.status === 'active');
      }
      
      if (!activeSession) {
        throw new Error(`Session ${sessionId} not found`);
      }
      
      // Load answers from localStorage if available
      const storageKey = `exam_answers_${activeSession.id}`;
      let savedAnswers: Record<string, string> = {};
      try {
        const savedAnswersStr = localStorage.getItem(storageKey);
        if (savedAnswersStr) {
          savedAnswers = JSON.parse(savedAnswersStr);
          console.log(`✅ Loaded ${Object.keys(savedAnswers).length} answers from localStorage`);
        }
      } catch (e) {
        console.error('Failed to load from localStorage:', e);
      }
      
      // Merge localStorage answers with session answers (localStorage takes precedence)
      const mergedAnswers = {
        ...(activeSession.answers || {}),
        ...savedAnswers
      };
      
      const sessionWithAnswers: Session = {
        ...activeSession,
        answers: mergedAnswers,
        nextModuleId: activeSession.nextModuleId,
        finalScore: activeSession.finalScore,
        performanceProfile: activeSession.performanceProfile
      };
      
      dispatch({ type: 'SET_SESSION', payload: sessionWithAnswers });
      
      // Fetch current module from backend
      const currentModule = await fetchCurrentModule(sessionId);
      if (currentModule) {
        dispatch({ type: 'SET_CURRENT_MODULE', payload: currentModule });
      } else {
        throw new Error('Could not fetch current module from backend');
      }

    } catch (err: any) {
      console.error("🔥 CRITICAL LOAD ERROR:", err);
      dispatch({ type: 'SET_ERROR', payload: err.message || "Failed to align engine" });
    } finally {
      isLoadingRef.current = false;
      dispatch({ type: 'SET_LOADING', payload: false });
    }
  }, []);

  // NOTE: Auto-loading removed - ExamRunner will call loadSession when ready
  // This prevents infinite loops and double-loading

  // --- ACTIONS ---
  const submitAnswer = useCallback((questionId: string, choiceId: string) => {
    if (!state.session) return;
    
    // Guard: Prevent writes if session is already completed
    if (state.session.status === 'completed') {
      console.warn('Cannot submit answer: session is already completed');
      return;
    }
    
    // 1. Update React State immediately (UI updates)
    dispatch({ type: 'SELECT_ANSWER', payload: { questionId, choiceId } });
    
    // 2. Update answers object
    const updatedAnswers = {
      ...(state.session.answers || {}),
      [questionId]: choiceId
    };
    
    // 3. Write to localStorage IMMEDIATELY (source of truth - survives crashes)
    const storageKey = `exam_answers_${state.session.id}`;
    try {
      localStorage.setItem(storageKey, JSON.stringify(updatedAnswers));
    } catch (e) {
      console.error('Failed to write to localStorage:', e);
      // Continue anyway - IndexedDB will handle it
    }
    
    // 4. Update IndexedDB (for structured data and sync queue)
    db.sessions.update(state.session.id, {
      answers: updatedAnswers,
      isSynced: false, // Mark as dirty for sync
      updatedAt: Date.now()
    }).catch(e => console.error('Failed to update IndexedDB:', e));
    
    // Note: useAnswerSync hook will handle the actual network sync
  }, [state.session]);

  const navigate = useCallback((direction: 'next' | 'prev' | number) => {
    if (!state.session || !state.currentModule) return;
    
    // If direction is a number, navigate directly to that index
    if (typeof direction === 'number') {
      const targetIndex = direction;
      const isReviewMode = state.session.status === 'completed';
      
      if (isReviewMode) {
        // Review mode: navigate within current module (TODO: enhance to fetch all modules)
        const currentModule = state.currentModule.module;
        const totalQuestions = currentModule.question_order?.length || 0;
        
        if (targetIndex >= 0 && targetIndex < totalQuestions) {
          dispatch({ type: 'NAVIGATE', payload: targetIndex });
          db.sessions.update(state.session.id, { 
            currentQuestionIndex: targetIndex,
            updatedAt: Date.now()
          }).catch(e => console.error(e));
        }
        return;
      }
      
      // Normal exam mode: navigate to index within current module
      const currentModule = state.currentModule.module;
      if (currentModule) {
        const maxIndex = currentModule.question_order?.length || 0;
        if (targetIndex >= 0 && targetIndex < maxIndex) {
          dispatch({ type: 'NAVIGATE', payload: targetIndex });
          db.sessions.update(state.session.id, { 
            currentQuestionIndex: targetIndex,
            isSynced: false,
            updatedAt: Date.now()
          }).catch(e => console.error(e));
        }
      }
      return;
    }
    
    // Original logic for 'next' | 'prev'

    const isReviewMode = state.session.status === 'completed';
    
    // In review mode, navigate across all completed modules
    if (isReviewMode) {
      // Calculate total questions from all review modules
      // For diagnostic exams: Module 1 (12 questions) + Module 2 (12 questions) = 24 total
      let totalQuestions = 0;
      
      // Check if this is a diagnostic exam (which has 24 questions total)
      const examId = state.session.examId;
      const isDiagnostic = examId === '550e8400-e29b-41d4-a716-446655440000' || 
                          examId === '550e8400-e29b-41d4-a716-446655440001';
      
      if (isDiagnostic) {
        // Diagnostic exams always have 24 questions (12 per module, 2 modules)
        totalQuestions = 24;
      } else if (state.currentModule) {
        // For non-diagnostic exams, use current module's question count
        totalQuestions = state.currentModule.module.question_order?.length || 0;
      }
      
      const currentIndex = state.session.currentQuestionIndex ?? 0;
      const newIndex = currentIndex + (direction === 'next' ? 1 : -1);
      
      // Bounds check for review mode
      if (newIndex < 0 || newIndex >= totalQuestions) {
        return; // Can't go beyond bounds
      }
      
      // Update question index (but don't update module ID in review mode)
      dispatch({ type: 'NAVIGATE', payload: newIndex });
      // Don't mark as unsynced in review mode (read-only navigation)
      db.sessions.update(state.session.id, { 
        currentQuestionIndex: newIndex,
        updatedAt: Date.now()
      }).catch(e => console.error(e));
      return;
    }

    // Normal exam mode: navigation within current module
    const currentIndex = state.session.currentQuestionIndex ?? 0;
    const newIndex = currentIndex + (direction === 'next' ? 1 : -1);
    
    if (newIndex < 0) return;
    
    // Stability Guard: Check question_order from current module
    if (state.currentModule) {
      const maxIndex = state.currentModule.module.question_order?.length || 0;
      if (newIndex >= maxIndex) return;
    }
    
    dispatch({ type: 'NAVIGATE', payload: newIndex });
    // Set isSynced: false to trigger cloud sync
    db.sessions.update(state.session.id, { 
      currentQuestionIndex: newIndex,
      isSynced: false, // Dirty flag: mark as unsynced
      updatedAt: Date.now()
    }).catch(e => console.error(e));
  }, [state.session, state.currentModule]);

  const finishModule = useCallback(async () => {
    if (!state.session || !state.currentModule) {
      console.error("Cannot finish module: missing session or current module");
      return;
    }

    // CRITICAL: Read latest answers from database to ensure we have the most up-to-date data
    // This prevents race conditions where state might not be updated yet
    const latestSession = await db.sessions.get(state.session.id);
    if (!latestSession) {
      console.error("Session not found in database");
      return;
    }
    const latestAnswers = (latestSession as any).answers || {};
    
    // Get current module ID
    const currentModuleId = state.currentModule.module.id;
    const questionOrder = state.currentModule.module.question_order || [];
    
    // Build responses array for submit-module endpoint
    const responses = questionOrder.map((questionId: string) => ({
      question_id: questionId,
      selected_option_id: latestAnswers[questionId] || null,
      time_spent: 0 // TODO: Track time spent per question
    }));
    
    // Call submit-module endpoint through Next.js API route (handles authentication)
    try {
      const response = await fetch('/api/exam/submit-module', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          session_id: state.session.id,
          module_id: currentModuleId,
          responses: responses
        })
      });
      
      if (!response.ok) {
        throw new Error(`Failed to submit module: ${response.status}`);
      }
      
      const result = await response.json();
      
      // Update session based on result
      if (result.status === 'exam_complete') {
        // Calculate performance profile from answers
        const performanceProfile: Record<string, { total: number; correct: number }> = {};
        
        // Get all questions from both modules (for diagnostic exams)
        // Need to combine questions from all completed modules
        const allQuestionIds = Object.keys(latestAnswers);
        const allQuestions: Record<string, any> = {};
        
        // Collect questions from current module (Module 2)
        if (state.currentModule?.questions) {
          Object.assign(allQuestions, state.currentModule.questions);
        }
        
        // For diagnostic exams, also fetch Module 1 questions to get complete performance data
        const examId = state.session.examId;
        const isDiagnostic = examId === '550e8400-e29b-41d4-a716-446655440000' || 
                            examId === '550e8400-e29b-41d4-a716-446655440001';
        
        if (isDiagnostic) {
          try {
            // Determine Module 1 ID based on exam type
            const module1Id = examId === '550e8400-e29b-41d4-a716-446655440000' 
              ? 'math_module_1' 
              : 'rw_module_1';
            
            // Fetch Module 1 questions
            const module1Response = await fetch(
              `/api/exam/session/${state.session.id}/current-module?module_id=${module1Id}`
            );
            
            if (module1Response.ok) {
              const module1Data = await module1Response.json();
              if (module1Data.questions) {
                Object.assign(allQuestions, module1Data.questions);
              }
            }
          } catch (e) {
            console.warn('[finishModule] Failed to fetch Module 1 for performance calculation:', e);
            // Continue with just Module 2 data
          }
        }
        
        // Calculate category performance
        for (const questionId of allQuestionIds) {
          const questionData: any = allQuestions[questionId];
          if (!questionData) continue;
          
          const category = questionData.category || questionData.skill_tag || 'Unknown';
          const correctAnswer = questionData.correct_answer;
          const studentAnswer = latestAnswers[questionId];
          const isCorrect = studentAnswer !== undefined && 
            String(studentAnswer).toUpperCase().trim() === String(correctAnswer).toUpperCase().trim();
          
          if (!performanceProfile[category]) {
            performanceProfile[category] = { total: 0, correct: 0 };
          }
          
          performanceProfile[category].total++;
          if (isCorrect) {
            performanceProfile[category].correct++;
          }
        }
        
        // Calculate final score using IRT (estimateThetaMLE) + ScoreEngine conversion
        const responsePatterns: ResponsePattern[] = [];
        for (const questionId of allQuestionIds) {
          const qData: any = allQuestions[questionId];
          if (!qData) continue;
          const correctAnswer = qData.correct_answer;
          const studentAnswer = latestAnswers[questionId];
          const isCorrect = studentAnswer !== undefined &&
            String(studentAnswer).toUpperCase().trim() === String(correctAnswer).toUpperCase().trim();
          // IRT params: b from difficulty_level (1=Easy->-1, 2=Medium->0, 3=Hard->1), a=1.0, c=0.25
          const dl = qData.difficulty_level ?? 2;
          const b = dl === 1 ? -1 : dl === 3 ? 1 : 0;
          responsePatterns.push({ a: 1.0, b, c: 0.25, response: isCorrect ? 1 : 0 });
        }
        let finalScore: number;
        const section = state.session.examId === '550e8400-e29b-41d4-a716-446655440000' ? 'math' : 'rw';
        if (responsePatterns.length > 0) {
          const theta = estimateThetaMLE(responsePatterns);
          finalScore = scoreEngine.calculateFinalScore(theta, section);
        } else {
          // Fallback: estimate from raw score if question data unavailable
          // Use module_score from backend (correct count for last module)
          const moduleCorrect: number = result.module_score ?? 0;
          const moduleTotalRaw: number = questionOrder.length || 1;
          const proportion = moduleCorrect / moduleTotalRaw;
          // Map proportion to theta: 0%→-2.0, 50%→0.0, 100%→2.0
          const fallbackTheta = (proportion - 0.5) * 4.0;
          finalScore = scoreEngine.calculateFinalScore(fallbackTheta, section);
        }
        
        // Exam is complete
        await db.sessions.update(state.session.id, {
          status: 'completed' as any,
          finalScore: finalScore,
          performanceProfile: performanceProfile,
          updatedAt: Date.now(),
          isSynced: false
        });
        
        dispatch({ 
          type: 'SET_SESSION', 
          payload: { 
            ...state.session, 
            status: 'completed' as any,
            finalScore: finalScore,
            performanceProfile: performanceProfile,
            updatedAt: Date.now()
          } 
        });
        
        dispatch({
          type: 'SET_FINAL_SCORE',
          payload: finalScore
        });
        
        // Trigger immediate sync
        try {
          const syncResponse = await fetch('/api/student/sync', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              sessionId: state.session.id,
              session: {
                ...state.session,
                status: 'completed',
                answers: latestAnswers,
                finalScore: finalScore,
                performanceProfile: performanceProfile
              }
            })
          });
          if (syncResponse.ok) {
            await db.sessions.update(state.session.id, { isSynced: true });
          }
        } catch (syncError) {
          console.error('Error syncing completed session:', syncError);
        }
      } else if (result.status === 'module_complete' && result.next_module_id) {
        // Module complete, fetch next module
        await db.sessions.update(state.session.id, {
          status: 'MODULE_1_COMPLETE' as any,
          currentModuleId: result.next_module_id,
          updatedAt: Date.now(),
          isSynced: false
        });
        
        dispatch({ 
          type: 'SET_SESSION', 
          payload: { 
            ...state.session, 
            status: 'MODULE_1_COMPLETE' as any,
            currentModuleId: result.next_module_id,
            updatedAt: Date.now()
          } 
        });
        
        // Fetch next module and automatically load it
        const nextModule = await fetchCurrentModule(state.session.id);
        if (nextModule) {
          dispatch({ type: 'SET_CURRENT_MODULE', payload: nextModule });
          
          // Also update session to reflect we're now in Module 2
          await db.sessions.update(state.session.id, {
            status: 'active',
            currentQuestionIndex: 0, // Reset to first question of Module 2
            updatedAt: Date.now(),
            isSynced: false
          });

          dispatch({
            type: 'SET_SESSION',
            payload: {
              ...state.session,
              status: 'active',
              currentQuestionIndex: 0,
              currentModuleId: result.next_module_id,
              updatedAt: Date.now()
            }
          });
        } else {
          console.error('[finishModule] Failed to fetch next module after Module 1 completion');
        }
      }
    } catch (error) {
      console.error('Error submitting module:', error);
      throw error;
    }
    
  }, [state.session, state.currentModule, fetchCurrentModule]);

  const startNextModule = useCallback(async () => {
    if (!state.session) return;
    
    // CRITICAL: Prevent starting next module if session is already completed
    const latestSession = await db.sessions.get(state.session.id);
    if (!latestSession) {
      console.error("Session not found in database");
      return;
    }
    
    if (latestSession.status === 'completed') {
      console.warn("⚠️ Cannot start next module: Session is already completed");
      return;
    }
    
    // Fetch next module from backend
    const nextModule = await fetchCurrentModule(state.session.id);
    if (!nextModule) {
      console.error("Failed to fetch next module from backend");
      return;
    }
    
    const nextId = nextModule.module.id;
    
    // Also check: Don't start Module 2 if we're already in Module 2
    const currentModuleId = latestSession.currentModuleId || state.session.currentModuleId;
    const { module2Easy: module2EasyId, module2Hard: module2HardId } = getExamModuleIds();
    if (currentModuleId === module2HardId || currentModuleId === module2EasyId) {
      console.warn("⚠️ Already in Module 2, cannot start Module 2 again");
      return;
    }
    
    console.log(`🚀 Starting Module 2: ${nextId} (${nextId === module2HardId ? 'Hard' : 'Easy'})`);
    
    await db.sessions.update(state.session.id, {
      status: 'active',
      currentQuestionIndex: 0,
      currentModuleId: nextId,
      isSynced: false,
      updatedAt: Date.now()
    });

    const updatedSession: typeof state.session = {
      ...state.session!,
      status: 'active' as const,
      currentModuleId: nextId,
      currentQuestionIndex: 0,
      updatedAt: Date.now()
    };
    dispatch({ type: 'SET_SESSION', payload: updatedSession });
    dispatch({ type: 'SET_CURRENT_MODULE', payload: nextModule });
  }, [state.session, fetchCurrentModule, getExamModuleIds]);

  // Cloud Sync: Watch for unsynced sessions and sync to backend
  useEffect(() => {
    const session = state.session;

    // Guard: Only sync if session exists and is marked as unsynced
    if (!session || session.isSynced) {
      return;
    }

    // Special handling for completed sessions: Force immediate sync (no debounce)
    // This ensures completed sessions with finalScore and performanceProfile are synced immediately
    if (session.status === 'completed') {
      // Immediate sync for completed sessions (critical data)
      (async () => {
        try {
          console.log(`🔄 [CRITICAL] Syncing completed session ${session.id} to backend immediately...`);
          
          let response: Response;
          try {
            response = await fetch('/api/student/sync', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                sessionId: session.id,
                session: {
                  id: session.id,
                  examId: session.examId,
                  currentModuleId: session.currentModuleId,
                  currentQuestionIndex: session.currentQuestionIndex,
                  status: session.status,
                  answers: session.answers,
                  finalScore: session.finalScore,
                  performanceProfile: session.performanceProfile,
                  updatedAt: session.updatedAt || Date.now()
                }
              })
            });
          } catch (fetchError: any) {
            // Network error or route not found
            console.warn(`⚠️ [CRITICAL] Failed to call sync API for completed session (route may not exist or network error):`, fetchError.message);
            return; // Exit early on fetch error
          }

          if (response.ok) {
            await db.sessions.update(session.id, {
              isSynced: true,
              updatedAt: Date.now()
            });
            console.log(`✅ Sync successful`);
          } else {
            // Try to get error details - first as text, then as JSON
            let errorData: any = { error: 'Unknown error' };
            const contentType = response.headers.get('content-type');
            try {
              if (contentType?.includes('application/json')) {
                errorData = await response.json();
              } else {
                const errorText = await response.text();
                errorData = { error: errorText || 'Unknown error', status: response.status, statusText: response.statusText };
              }
            } catch (parseError) {
              errorData = { 
                error: 'Failed to parse error response', 
                status: response.status, 
                statusText: response.statusText,
                parseError: parseError instanceof Error ? parseError.message : String(parseError)
              };
            }
            // Check if this is a skipBackend response (expected for local-only sessions)
            if (errorData.skipBackend) {
              console.log(`ℹ️ [CRITICAL] Completed session ${session.id} is local-only (backend sync skipped)`);
              // Mark as synced since we're intentionally skipping backend
              await db.sessions.update(session.id, {
                isSynced: true,
                updatedAt: Date.now()
              });
            } else {
              console.error(`❌ [CRITICAL] Failed to sync completed session ${session.id}:`, {
                status: response.status,
                statusText: response.statusText,
                error: errorData
              });
            }
          }
        } catch (error) {
          console.error(`❌ [CRITICAL] Error syncing completed session ${session.id}:`, error);
        }
      })();
      return; // Exit early for completed sessions (handled above)
    }

    // Debounce sync to avoid too many requests
    const syncTimeout = setTimeout(async () => {
      try {
        console.log(`🔄 [ExamContext] Starting sync for session ${session.id}`);
        console.log(`   - Session status: ${session.status}`);
        console.log(`   - Exam ID: ${session.examId}`);
        console.log(`   - Answer count: ${Object.keys(session.answers || {}).length}`);
        console.log(`   - Is synced: ${session.isSynced}`);
        
        // Prepare sync payload
        const syncPayload = {
          sessionId: session.id,
          session: {
            id: session.id,
            examId: session.examId,
            currentModuleId: session.currentModuleId,
            currentQuestionIndex: session.currentQuestionIndex,
            status: session.status,
            answers: session.answers,
            finalScore: session.finalScore,
            performanceProfile: session.performanceProfile,
            updatedAt: session.updatedAt || Date.now()
          }
        };
        
        console.log(`📤 [ExamContext] Calling /api/student/sync with payload:`, {
          sessionId: syncPayload.sessionId,
          examId: syncPayload.session.examId,
          status: syncPayload.session.status,
          answerCount: Object.keys(syncPayload.session.answers || {}).length
        });
        
        // Call Next.js API route which handles Clerk auth and proxies to FastAPI backend
        let response: Response;
        try {
          const fetchStartTime = Date.now();
          console.log(`🌐 [ExamContext] Fetch starting at ${new Date().toISOString()}`);
          response = await fetch('/api/student/sync', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(syncPayload)
          });
          const fetchDuration = Date.now() - fetchStartTime;
          console.log(`📥 [ExamContext] Fetch completed in ${fetchDuration}ms`);
          console.log(`   - Response status: ${response.status} ${response.statusText}`);
          console.log(`   - Response URL: ${response.url}`);
          console.log(`   - Response headers:`, Object.fromEntries(response.headers.entries()));
        } catch (fetchError: any) {
          // Network error or route not found
          console.error(`❌ [ExamContext] Fetch error:`, fetchError);
          console.error(`   - Error name: ${fetchError.name}`);
          console.error(`   - Error message: ${fetchError.message}`);
          console.error(`   - Error stack:`, fetchError.stack);
          console.warn(`⚠️ Failed to call sync API (route may not exist or network error):`, fetchError.message);
          // Don't mark as synced - will retry on next change
          return; // Exit early on fetch error
        }

        console.log(`📊 [ExamContext] Processing response...`);
        
        if (response.ok) {
          console.log(`✅ [ExamContext] Response OK (${response.status})`);
          // Check the response data to see if backend actually stored it
          let responseData: any;
          try {
            const responseText = await response.text();
            console.log(`   - Response text length: ${responseText.length}`);
            responseData = JSON.parse(responseText);
            console.log(`   - Parsed response:`, responseData);
          } catch (parseError) {
            console.error(`❌ [ExamContext] Failed to parse response:`, parseError);
            responseData = {};
          }
          
          // If skipBackend is true, the backend didn't actually store it
          if (responseData.skipBackend) {
            console.warn(`⚠️ [ExamContext] Sync returned success but backend was skipped (skipBackend: true)`);
            console.warn(`⚠️ [ExamContext] Session ${session.id} will remain local-only. Backend may not be reachable or session doesn't exist.`);
            // Don't mark as synced - we want to retry
            return;
          }
          
          // Mark as synced after successful server update
          await db.sessions.update(session.id, {
            isSynced: true,
            updatedAt: Date.now()
          });
          console.log(`✅ [ExamContext] Sync successful - data stored in backend`);
          console.log(`   - Response:`, responseData);
        } else {
          console.error(`❌ [ExamContext] Response NOT OK: ${response.status} ${response.statusText}`);
          let errorData: any;
          try {
            const errorText = await response.text();
            console.error(`   - Error response text:`, errorText);
            errorData = JSON.parse(errorText);
            console.error(`   - Parsed error:`, errorData);
          } catch (parseError) {
            console.error(`   - Failed to parse error response:`, parseError);
            errorData = { error: 'Unknown error', status: response.status };
          }
          
          // If route not found (404), log warning but don't spam console
          if (response.status === 404) {
            console.error(`❌ [ExamContext] 404 ERROR - Route not found!`);
            console.error(`   - This means /api/student/sync route is not registered in Next.js`);
            console.error(`   - Possible causes:`);
            console.error(`     1. Next.js cache issue - try deleting .next folder`);
            console.error(`     2. Route file not found at app/api/student/sync/route.ts`);
            console.error(`     3. Middleware blocking the route`);
            console.error(`     4. Next.js dev server needs restart`);
            
            // Check if this is a skipBackend response (expected for local-only sessions)
            if (errorData.skipBackend) {
              console.log(`ℹ️ [ExamContext] Session ${session.id} is local-only (backend sync skipped)`);
              // Mark as synced since we're intentionally skipping backend
              await db.sessions.update(session.id, {
                isSynced: true,
                updatedAt: Date.now()
              });
            } else {
              // Route not found - this is a Next.js routing issue, not a backend issue
              console.warn(`⚠️ [ExamContext] Sync API route not found (404) - Next.js route may not be registered. Session will remain local-only.`);
              console.warn(`⚠️ [ExamContext] To fix: Clear Next.js cache (.next folder) and restart dev server.`);
            }
          } else {
            console.warn(`⚠️ [ExamContext] Failed to sync session ${session.id}:`, errorData);
          }
          // Don't mark as synced unless it's a skipBackend response - will retry on next change
        }
      } catch (error) {
        console.error(`❌ Error syncing session ${session.id}:`, error);
        // Don't throw - allow offline mode to continue
      }
    }, 2000); // 2 second debounce

    return () => clearTimeout(syncTimeout);
  }, [state.session?.id, state.session?.isSynced, state.session?.status, state.session?.answers, state.session?.currentQuestionIndex]);

  return (
    <ExamContext.Provider value={{ state, actions: { loadSession, submitAnswer, navigate, finishModule, startNextModule, startDiagnostic } }}>
      {children}
    </ExamContext.Provider>
  );
};

export const useExam = () => {
  const context = useContext(ExamContext);
  if (!context) throw new Error('useExam must be used within an ExamProvider');
  return context;
};