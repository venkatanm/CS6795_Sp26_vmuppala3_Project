/**
 * SAT Knowledge Graph Schema - TypeScript Type Definitions
 * 
 * This file provides TypeScript types for the knowledge graph schema.
 * The actual implementation uses PostgreSQL with SQLAlchemy models.
 */

export interface Concept {
  id: string;  // UUID
  name: string;
  description?: string;
  category?: string;  // e.g., "Heart of Algebra", "Problem Solving and Data Analysis"
  level?: number;  // Hierarchy level (1 = top-level, 2 = sub-concept, etc.)
  created_at: string;  // ISO timestamp
}

export interface Misconception {
  id: string;  // UUID
  name: string;
  description?: string;
  created_at: string;  // ISO timestamp
}

export interface QuestionConcept {
  id: string;  // UUID
  question_id: string;  // UUID - references items.id
  concept_id: string;  // UUID - references concepts.id
  weight?: number;  // How strongly this question tests the concept (default: 1.0)
  created_at: string;  // ISO timestamp
}

export interface ConceptPrerequisite {
  id: string;  // UUID
  prerequisite_id: string;  // UUID - references concepts.id
  dependent_id: string;  // UUID - references concepts.id
  strength?: number;  // How strong the prerequisite relationship is (default: 1.0)
  created_at: string;  // ISO timestamp
}

export interface ConceptMisconception {
  id: string;  // UUID
  concept_id: string;  // UUID - references concepts.id
  misconception_id: string;  // UUID - references misconceptions.id
  frequency?: number;  // How frequently this misconception occurs (default: 1.0)
  created_at: string;  // ISO timestamp
}

/**
 * Graph Edge Types
 */
export enum EdgeType {
  TESTS = "TESTS",  // Question -> Concept
  PREREQUISITE_OF = "PREREQUISITE_OF",  // Concept -> Concept
  COMMONLY_CONFUSED_WITH = "COMMONLY_CONFUSED_WITH",  // Concept -> Misconception
}

/**
 * Graph Node Types
 */
export enum NodeType {
  CONCEPT = "CONCEPT",
  QUESTION = "QUESTION",  // Referenced via items table
  MISCONCEPTION = "MISCONCEPTION",
}

/**
 * Extended types with relationships for query results
 */
export interface ConceptWithPrerequisites extends Concept {
  prerequisites: Concept[];
  dependents: Concept[];
  misconceptions: Misconception[];
}

export interface ConceptWithQuestions extends Concept {
  questions: Array<{
    id: string;
    question_text: string;
    weight: number;
  }>;
}

export interface QuestionWithConcepts {
  id: string;
  question_text: string;
  concepts: Array<{
    id: string;
    name: string;
    category?: string;
    weight: number;
  }>;
}
