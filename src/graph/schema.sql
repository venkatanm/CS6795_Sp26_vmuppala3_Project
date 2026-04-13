-- SAT Knowledge Graph Schema
-- 
-- This schema implements a lightweight graph structure using relational tables
-- to map questions to concepts and concepts to each other.
--
-- Nodes:
--   - Concept: Mathematical concepts (e.g., "Heart of Algebra", "Linear Equations", "Slope-Intercept Form")
--   - Question: Referenced via items table (items.id)
--   - Misconception: Common student misconceptions (e.g., "Confusing Slope for Y-Intercept")
--
-- Edges:
--   - TESTS: Question -> Concept (via question_concepts table)
--   - PREREQUISITE_OF: Concept -> Concept (via concept_prerequisites table)
--   - COMMONLY_CONFUSED_WITH: Concept -> Misconception (via concept_misconceptions table)

-- ============================================================================
-- NODES
-- ============================================================================

-- Concepts: Mathematical concepts tested on the SAT
CREATE TABLE IF NOT EXISTS concepts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR NOT NULL UNIQUE,
    description TEXT,
    category VARCHAR,  -- e.g., "Heart of Algebra", "Problem Solving and Data Analysis"
    level INTEGER,     -- Hierarchy level (1 = top-level, 2 = sub-concept, etc.)
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ix_concepts_name ON concepts(name);
CREATE INDEX IF NOT EXISTS ix_concepts_category ON concepts(category);

-- Misconceptions: Common student misconceptions
CREATE TABLE IF NOT EXISTS misconceptions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR NOT NULL UNIQUE,
    description TEXT,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ix_misconceptions_name ON misconceptions(name);

-- ============================================================================
-- EDGES
-- ============================================================================

-- TESTS Edge: Question -> Concept
-- Links questions (items) to the concepts they test
CREATE TABLE IF NOT EXISTS question_concepts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    question_id UUID NOT NULL REFERENCES items(id) ON DELETE CASCADE,
    concept_id UUID NOT NULL REFERENCES concepts(id) ON DELETE CASCADE,
    weight FLOAT DEFAULT 1.0,  -- Optional: how strongly this question tests the concept
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ix_question_concepts_question_id ON question_concepts(question_id);
CREATE INDEX IF NOT EXISTS ix_question_concepts_concept_id ON question_concepts(concept_id);

-- PREREQUISITE_OF Edge: Concept -> Concept
-- Links concepts in prerequisite relationships (e.g., Linear Equations -> Systems of Equations)
CREATE TABLE IF NOT EXISTS concept_prerequisites (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    prerequisite_id UUID NOT NULL REFERENCES concepts(id) ON DELETE CASCADE,
    dependent_id UUID NOT NULL REFERENCES concepts(id) ON DELETE CASCADE,
    strength FLOAT DEFAULT 1.0,  -- Optional: how strong the prerequisite relationship is
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ix_concept_prerequisites_prerequisite_id ON concept_prerequisites(prerequisite_id);
CREATE INDEX IF NOT EXISTS ix_concept_prerequisites_dependent_id ON concept_prerequisites(dependent_id);

-- COMMONLY_CONFUSED_WITH Edge: Concept -> Misconception
-- Links concepts to misconceptions students commonly have
CREATE TABLE IF NOT EXISTS concept_misconceptions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    concept_id UUID NOT NULL REFERENCES concepts(id) ON DELETE CASCADE,
    misconception_id UUID NOT NULL REFERENCES misconceptions(id) ON DELETE CASCADE,
    frequency FLOAT DEFAULT 1.0,  -- Optional: how frequently this misconception occurs
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ix_concept_misconceptions_concept_id ON concept_misconceptions(concept_id);
CREATE INDEX IF NOT EXISTS ix_concept_misconceptions_misconception_id ON concept_misconceptions(misconception_id);

-- ============================================================================
-- EXAMPLE QUERIES
-- ============================================================================

-- Find all concepts tested by a specific question
-- SELECT c.name, c.category, qc.weight
-- FROM question_concepts qc
-- JOIN concepts c ON qc.concept_id = c.id
-- WHERE qc.question_id = 'question-uuid-here';

-- Find all prerequisites for a concept
-- SELECT c.name, cp.strength
-- FROM concept_prerequisites cp
-- JOIN concepts c ON cp.prerequisite_id = c.id
-- WHERE cp.dependent_id = 'concept-uuid-here';

-- Find all concepts that depend on a given concept
-- SELECT c.name, cp.strength
-- FROM concept_prerequisites cp
-- JOIN concepts c ON cp.dependent_id = c.id
-- WHERE cp.prerequisite_id = 'concept-uuid-here';

-- Find all misconceptions for a concept
-- SELECT m.name, m.description, cm.frequency
-- FROM concept_misconceptions cm
-- JOIN misconceptions m ON cm.misconception_id = m.id
-- WHERE cm.concept_id = 'concept-uuid-here';

-- Find all questions that test a specific concept
-- SELECT i.id, i.question_text, i.skill_tag, qc.weight
-- FROM question_concepts qc
-- JOIN items i ON qc.question_id = i.id
-- WHERE qc.concept_id = 'concept-uuid-here';
