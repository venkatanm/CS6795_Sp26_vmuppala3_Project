/**
 * Exam Mode Types
 */
export type ExamMode = 'simulation' | 'diagnostic' | 'drill';

/**
 * Routing Type
 */
export type RoutingType = 'standard' | 'aggressive' | 'linear';

/**
 * Exam Configuration
 * 
 * Defines the behavior and rules for different exam modes:
 * - simulation: Full mock exams (like Bluebook)
 * - diagnostic: 20-question diagnostic tests
 * - drill: Daily practice drills (10 questions)
 */
export interface ExamConfig {
  /** The exam mode */
  mode: ExamMode;
  
  /** Timer configuration */
  timer: {
    /** Whether to show the timer */
    show: boolean;
    /** Timer direction: 'down' counts down, 'up' counts up */
    direction: 'up' | 'down';
    /** Whether to auto-submit when timer hits zero */
    autoSubmitAtZero: boolean;
  };
  
  /** Feedback configuration */
  feedback: {
    /** Whether to show "Check Answer" button (allows immediate checking) */
    allowImmediateCheck: boolean;
    /** Whether to highlight correct/incorrect answers (green/red) */
    showCorrectness: boolean;
  };
  
  /** Tutor configuration */
  tutor: {
    /** Whether AI tutor is enabled (shows "Ask AI" button) */
    enabled: boolean;
  };
  
  /** Routing configuration */
  routing: {
    /** Routing type: 'standard' (default), 'aggressive' (adaptive), 'linear' (fixed order) */
    type: RoutingType;
  };
}

/**
 * Default exam configurations for each mode
 */
export const DEFAULT_EXAM_CONFIGS: Record<ExamMode, ExamConfig> = {
  simulation: {
    mode: 'simulation',
    timer: {
      show: true,
      direction: 'down',
      autoSubmitAtZero: true,
    },
    feedback: {
      allowImmediateCheck: false,
      showCorrectness: false,
    },
    tutor: {
      enabled: false,
    },
    routing: {
      type: 'standard',
    },
  },
  diagnostic: {
    mode: 'diagnostic',
    timer: {
      show: true,
      direction: 'down',
      autoSubmitAtZero: true,
    },
    feedback: {
      allowImmediateCheck: false,
      showCorrectness: false,
    },
    tutor: {
      enabled: false,
    },
    routing: {
      type: 'standard',
    },
  },
  drill: {
    mode: 'drill',
    timer: {
      show: true,
      direction: 'up', // Drills count up (time spent)
      autoSubmitAtZero: false, // Don't force-submit in drills
    },
    feedback: {
      allowImmediateCheck: true, // Allow checking answers immediately
      showCorrectness: true, // Show green/red highlights
    },
    tutor: {
      enabled: true, // Enable AI tutor for drills
    },
    routing: {
      type: 'linear', // Drills use fixed order
    },
  },
};
