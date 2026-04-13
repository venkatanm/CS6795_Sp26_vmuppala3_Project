import { create } from 'zustand';
import api from '../lib/api';

interface ExamStore {
  // State
  sessionId: string | null;
  studentName: string;
  isLoading: boolean;

  // Actions
  setSessionId: (id: string) => void;
  startExam: (name: string, examId: string, userId: string) => Promise<string>;
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

  startExam: async (name: string, examId: string, userId: string): Promise<string> => {
    set({ isLoading: true, studentName: name });

    try {
      if (!examId) {
        throw new Error('Exam ID is required');
      }

      if (!userId) {
        throw new Error('User ID is required. Please sign in to take an exam.');
      }

      // Create session with Clerk user ID
      const sessionResponse = await api.post('/sessions', {
        user_id: userId,  // Use Clerk user ID instead of name
        exam_id: examId,
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
