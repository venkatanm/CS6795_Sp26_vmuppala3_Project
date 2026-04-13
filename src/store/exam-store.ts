import { create } from 'zustand';
import api from '../lib/api';

interface ExamStore {
  // State
  sessionId: string | null;
  studentName: string;
  isLoading: boolean;

  // Actions
  setSessionId: (id: string) => void;
  startExam: (name: string, examId?: string) => Promise<string>;
  reset: () => void;
}

/**
 * Zustand store for managing exam session state.
 */
export const useExamStore = create<ExamStore>((set, get) => ({
  // Initial state
  sessionId: null,
  studentName: '',
  isLoading: false,

  // Actions
  setSessionId: (id: string) => {
    set({ sessionId: id });
  },

  startExam: async (name: string, examId?: string): Promise<string> => {
    set({ isLoading: true, studentName: name });

    try {
      // If examId not provided, fetch the first available exam
      let examIdToUse = examId;
      
      if (!examIdToUse) {
        const examsResponse = await api.get('/exams');
        const exams = examsResponse.data;
        
        if (!exams || exams.length === 0) {
          throw new Error('No exams found. Please create an exam first.');
        }
        
        examIdToUse = exams[0].id;
      }

      // Create session
      const sessionResponse = await api.post('/sessions', {
        user_id: name,
        exam_id: examIdToUse,
      });

      const sessionId = sessionResponse.data.session_id;

      // Update state
      set({
        sessionId,
        isLoading: false,
      });

      return sessionId;
    } catch (error: any) {
      set({ isLoading: false });
      
      // Re-throw with more context
      const errorMessage = error.response?.data?.detail || error.message || 'Failed to start exam';
      throw new Error(errorMessage);
    }
  },

  reset: () => {
    set({
      sessionId: null,
      studentName: '',
      isLoading: false,
    });
  },
}));
