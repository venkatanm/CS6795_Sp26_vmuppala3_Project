/**
 * ExamPacket TypeScript Schema
 * 
 * This is the "source of truth" for the client-side exam runner.
 * The ExamPacket bundles all exam content, configuration, and routing logic
 * into a single JSON object that can be pre-fetched and cached.
 */

import { ScoringConfig } from './ScoringTable';

/**
 * Configuration for the exam session
 */
export interface ExamConfig {
  /** Total time allowed for the exam in seconds */
  total_time: number;
  
  /** List of tools allowed during the exam (e.g., "calculator", "formula_sheet") */
  allowed_tools: string[];
}

/**
 * Routing logic for adaptive exam modules
 */
export interface RoutingLogic {
  /** 
   * Score threshold needed to route to Hard Module 2.
   * If Module 1 score >= this threshold, student routes to Hard Module 2.
   * Otherwise, student routes to Easy Module 2.
   */
  module_1_threshold: number;
}

/**
 * Answer choice option
 */
export interface QuestionOption {
  /** Unique identifier for this option */
  id: string | number;
  
  /** Display text for this option */
  text: string;
}

/**
 * Full question object stored in the content bank
 * 
 * Note: We separate question_order (in modules) from question data (in content_bank)
 * to allow for future randomization of question presentation order without
 * duplicating question content.
 */
export interface QuestionContent {
  /** The question text/prompt (also called "stem") */
  text: string;
  
  /** Array of answer choices */
  choices: QuestionOption[];
  
  /** The correct answer (option ID) */
  correct_answer: string | number;
  
  /** 
   * URLs to any assets (images, diagrams, etc.) needed for this question.
   * 
   * Why bundle assets here?
   * - Pre-caching: The client can pre-fetch all images before the exam starts,
   *   ensuring smooth experience without loading delays during the exam.
   * - Offline capability: Assets can be cached for offline exam taking.
   * - Performance: Reduces network requests during active exam taking.
   */
  asset_urls?: string[];
  
  /** Optional solution/explanation text */
  solution_text?: string;
  
  /** Optional skill tag (e.g., "Algebra", "Reading Comprehension") */
  skill_tag?: string;
  
  /** 
   * Optional stimulus/passage text for Reading/Writing questions.
   * This is the primary field for passage content (standardized on "stimulus").
   * Multiple questions may share the same passage (identified by passageId).
   */
  stimulus?: string;
  
  /** 
   * @deprecated Use stimulus instead. Kept for backward compatibility.
   * Optional passage text for Reading/Writing questions.
   */
  passageText?: string;
  
  /** 
   * @deprecated Use stimulus instead. Kept for backward compatibility.
   * Optional passage text (legacy field name).
   */
  passage?: string;
  
  /** 
   * Optional passage ID for grouping questions that share the same passage.
   * Used for memoization and performance optimization.
   */
  passageId?: string;
  
  /** 
   * Whether this is a Student-Produced Response (SPR) / grid-in question.
   * If true, choices array should be empty or ignored.
   */
  is_spr?: boolean;
  
  /**
   * SAT Domain: The primary subject area of the question
   * Required for diagnostic analytics and domain mastery tracking
   */
  domain: 'Reading and Writing' | 'Math';
  
  /**
   * SAT Category: The specific content category within the domain
   * Required for diagnostic analytics and category performance tracking
   * 
   * Reading and Writing categories:
   * - Information and Ideas: Central ideas, details, inferences, command of evidence
   * - Craft and Structure: Words in context, text structure, purpose, perspective
   * - Expression of Ideas: Rhetorical synthesis, transitions
   * - Standard English Conventions: Boundaries, form/structure/ sense
   * 
   * Math categories:
   * - Algebra: Linear equations, systems, inequalities
   * - Advanced Math: Nonlinear equations, functions
   * - Problem-Solving and Data Analysis: Ratios, percentages, statistics
   * - Geometry and Trigonometry: Area, volume, coordinate geometry, trigonometry
   */
  category: 
    | 'Information and Ideas'
    | 'Craft and Structure'
    | 'Expression of Ideas'
    | 'Standard English Conventions'
    | 'Algebra'
    | 'Advanced Math'
    | 'Problem-Solving and Data Analysis'
    | 'Geometry and Trigonometry';
  
  /**
   * Specific skill or topic within the category
   * Examples:
   * - "Linear Equations"
   * - "Central Ideas"
   * - "Words in Context"
   * - "Quadratic Functions"
   * - "Data Inferences"
   * Required for detailed skill-level analytics
   */
  skill: string;
  
  /**
   * Difficulty level on a 4-point scale
   * 1 = Easy
   * 2 = Medium
   * 3 = Hard
   * 4 = Very Hard
   * Required for adaptive routing and difficulty-based analytics
   */
  difficulty_level: 1 | 2 | 3 | 4;
}

/**
 * Module definition within an exam
 */
export interface ExamModule {
  /** Unique identifier for this module */
  id: string;
  
  /** 
   * Module type: "fixed" means all questions are shown in order.
   * Other types may be added in the future (e.g., "adaptive", "randomized").
   */
  type: "fixed" | "adaptive" | "randomized";
  
  /** 
   * Ordered list of question IDs that appear in this module.
   * These IDs reference questions in the content_bank.
   * 
   * Separating order from content allows:
   * - Randomization of presentation order without duplicating data
   * - Easy reordering of questions
   * - A/B testing different question sequences
   */
  question_order: string[];
}

/**
 * Complete ExamPacket structure
 * 
 * This object contains everything needed to run an exam on the client side:
 * - Exam configuration (time limits, allowed tools)
 * - Routing logic for adaptive modules
 * - Module definitions with question ordering
 * - Complete question content bank
 */
export interface ExamPacket {
  /** Unique identifier for this exam */
  exam_id: string;
  
  /** Exam configuration (time limits, allowed tools) */
  config: ExamConfig;
  
  /** Routing logic for adaptive exam flow */
  routing_logic: RoutingLogic;
  
  /** 
   * Array of module definitions.
   * 
   * Requirements:
   * - Module 1 must be type: "fixed"
   * - Module 2 must be defined twice:
   *   - Once as id: "rw_module_2_easy"
   *   - Once as id: "rw_module_2_hard"
   */
  modules: ExamModule[];
  
  /** 
   * Content bank: Dictionary mapping question_id to full question objects.
   * 
   * Key: question_id (string) - matches IDs referenced in modules.question_order
   * Value: QuestionContent - complete question data including text, choices, assets
   * 
   * Why a separate content bank?
   * - Prevents duplication: Questions can be referenced by multiple modules
   * - Enables randomization: Question order can change without duplicating content
   * - Efficient caching: All question data can be pre-loaded at once
   * - Asset pre-loading: All images/assets can be fetched before exam starts
   */
  content_bank: Record<string, QuestionContent>;
  
  /** 
   * Optional scoring configuration for converting theta to section scores.
   * 
   * If provided, this allows per-exam scoring curves. If not provided,
   * the ScoreEngine will use default scoring tables.
   * 
   * Why inject scoring tables here?
   * - Per-exam customization: Different exams can have different scoring curves
   * - Easy updates: Change scoring without code deployment
   * - A/B testing: Test different scoring curves
   */
  scoring_table?: ScoringConfig;
}
