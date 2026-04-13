import Dexie, { Table } from 'dexie';
import { ExamPacket } from '@/src/types/ExamPacket';

/**
 * Database record for tracking exam sessions
 */
export interface SessionRecord {
  /** Primary key: UUID of the session */
  id: string;
  
  /** The exam ID this session belongs to */
  examId: string;
  
  /** Whether the session data has been synced to the server */
  isSynced: boolean;
  
  /** Current module ID the student is on */
  currentModuleId?: string;
  
  /** Current question index within the module */
  currentQuestionIndex?: number;
  
  /** Map of QuestionID -> ChoiceID for student answers */
  answers?: Record<string, string>;
  
  /** Timestamp when the session was created */
  createdAt: number;
  
  /** Timestamp when the session was last updated */
  updatedAt: number;
  
  /** Session status: 'active', 'completed', 'paused' */
  status: 'active' | 'completed' | 'paused';
  
  /** 
   * Performance breakdown by SAT category
   * Maps category name to { total: number, correct: number }
   * @deprecated Use performanceProfile instead for domain-level analytics
   */
  categoryPerformance?: Record<string, { total: number; correct: number }>;
  
  /**
   * Performance profile: Domain and category-level analytics
   * Maps category name to { total: number, correct: number }
   * Used for diagnostic reports and mastery tracking
   */
  performanceProfile?: Record<string, { total: number; correct: number }>;

  /**
   * ID of the next module to load after current module completion
   * Used for adaptive routing (e.g., Module 1 → Module 2 Hard/Easy)
   */
  nextModuleId?: string;

  /**
   * Final calculated score for the exam (e.g., 200-800 for SAT)
   * Calculated using IRT theta estimation and score engine
   */
  finalScore?: number;
}

/**
 * Database record for storing student responses
 * 
 * Security: This table stores ONLY psychometric data (responses, scores).
 * It does NOT store PII (names, emails). Only student_hash_id is used
 * for linking responses to users.
 * 
 * Note: The primary key is a composite of [sessionId+questionId] to allow
 * multiple responses for the same question across different sessions.
 */
export interface ResponseRecord {
  /** The session ID this response belongs to */
  sessionId: string;
  
  /** The question ID */
  questionId: string;
  
  /** The selected answer option ID */
  selectedOptionId: string | number | null;
  
  /** Time spent on this question in seconds */
  timeSpent: number;
  
  /** Timestamp when the response was recorded */
  timestamp: number;
  
  /** Whether this response has been synced to the server */
  isSynced: boolean;
  
  /** 
   * Student hash ID (hashed user ID) - NOT the raw user ID or PII.
   * This ensures responses cannot be traced back to student names/emails
   * without the mapping table.
   */
  student_hash_id?: string;
}

/**
 * Database record for xAPI telemetry events
 * 
 * Security: This table stores ONLY psychometric data (events, interactions).
 * It does NOT store PII (names, emails). The actor field stores student_hash_id
 * (hashed user ID) to prevent tracing back to student names/emails.
 */
export interface LogRecord {
  /** Primary key: Auto-increment ID */
  id?: number;
  
  /** The session ID this log belongs to */
  sessionId: string;
  
  /** The type of event (e.g., "tool_used", "question_viewed", "answer_submitted") */
  eventType: string;
  
  /** 
   * Additional event data as JSON.
   * 
   * Security: The 'actor' field in eventData contains student_hash_id (hashed user ID),
   * NOT the raw user ID or any PII. All PII is sanitized before storage.
   */
  eventData: Record<string, any>;
  
  /** Timestamp when the event occurred */
  timestamp: number;
  
  /** Whether this log has been synced to the server */
  isSynced: boolean;
}

/**
 * Database record for storing annotations (eliminations and highlights)
 */
export interface AnnotationRecord {
  /** Primary key: Composite of [sessionId+questionId] */
  sessionId: string;
  questionId: string;
  
  /** Array of eliminated option IDs */
  eliminatedOptions: (string | number)[];
  
  /** Array of text highlight ranges */
  highlights: Array<{
    start: number;
    end: number;
    color?: 'yellow' | 'blue'; // Highlight color, defaults to 'yellow'
  }>;
  
  /** Whether this question is marked for review */
  markedForReview: boolean;
  
  /** Timestamp when annotation was last updated */
  updatedAt: number;
}

/**
 * Database record for storing tutor chat transcripts
 * 
 * Security: This table stores ONLY chat transcripts linked to questions.
 * It does NOT store PII (names, emails). Only questionId and sessionId are used.
 */
export interface TutorChatRecord {
  /** Primary key: Composite of [questionId+sessionId] */
  questionId: string;
  sessionId: string;
  
  /** Array of chat messages */
  messages: Array<{
    role: 'student' | 'tutor';
    content: string;
    timestamp: number;
  }>;
  
  /** The student's wrong answer (for context) */
  studentAnswer?: string | number;
  
  /** Timestamp when chat was created */
  createdAt: number;
  
  /** Timestamp when chat was last updated */
  updatedAt: number;
}

/**
 * SatPrepDB - IndexedDB database for SAT Prep Platform
 * 
 * Stores exam content, sessions, responses, and telemetry logs
 * for offline-first exam taking experience.
 */
class SatPrepDB extends Dexie {
  /** Table for tracking exam sessions */
  sessions!: Table<SessionRecord, string>;
  
  /** Table for storing student responses (compound primary key: [sessionId, questionId]) */
  responses!: Table<ResponseRecord, [string, string]>;
  
  /** Table for storing xAPI telemetry logs */
  logs!: Table<LogRecord, number>;
  
  /** Table for storing annotations (eliminations and highlights) */
  annotations!: Table<AnnotationRecord, [string, string]>;

  /** Table for storing tutor chat transcripts */
  tutorChats!: Table<TutorChatRecord, [string, string]>;

  constructor() {
    super('SatPrepDB');
    
    // Version 1: Initial schema as specified
    // Schema Definition:
    // - sessions: id (Primary Key), examId (index)
    // - responses: [sessionId+questionId] (Compound Primary Key), questionId (index)
    // - logs: ++id (Auto-increment Primary Key)
    this.version(1).stores({
      sessions: 'id, examId',
      responses: '[sessionId+questionId], questionId',
      logs: '++id',
    });
    
    // Version 2: Add annotations table and additional indexes for performance
    this.version(2).stores({
      sessions: 'id, examId, isSynced',
      responses: '[sessionId+questionId], sessionId, questionId',
      logs: '++id, sessionId, isSynced',
      // annotations table: PK = [sessionId+questionId] (compound primary key)
      // Stores eliminated options and text highlights for each question
      annotations: '[sessionId+questionId], sessionId',
    });
    
    // Version 3: Add tutor chats table and status index to sessions
    this.version(3).stores({
      sessions: 'id, examId, isSynced, status', // Added 'status' index
      responses: '[sessionId+questionId], sessionId, questionId',
      logs: '++id, sessionId, isSynced',
      annotations: '[sessionId+questionId], sessionId',
      // tutorChats table: PK = [questionId+sessionId] (compound primary key)
      // Stores chat transcripts for tutor sessions linked to specific questions
      tutorChats: '[questionId+sessionId], sessionId, questionId',
    });
    
    // Version 4: Remove examContent table (module-based fetching, no longer cache full exam packets)
    this.version(4).stores({
      sessions: 'id, examId, isSynced, status',
      responses: '[sessionId+questionId], sessionId, questionId',
      logs: '++id, sessionId, isSynced',
      annotations: '[sessionId+questionId], sessionId',
      tutorChats: '[questionId+sessionId], sessionId, questionId',
    });
    
    // Note: Exam content is no longer cached in IndexedDB.
    // Modules are fetched on-demand from the backend using React Query.
  }
}

// Create and export the database instance
export const db = new SatPrepDB();

