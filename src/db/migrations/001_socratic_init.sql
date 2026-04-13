-- Socratic Graph Schema Migration
-- This migration creates the knowledge graph structure for SAT tutoring

-- Enable pgvector extension for embeddings
CREATE EXTENSION IF NOT EXISTS vector;

-- Domains: Top-level SAT categories (e.g., "Reading and Writing", "Math")
CREATE TABLE IF NOT EXISTS domains (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(255) NOT NULL UNIQUE,
    weight FLOAT DEFAULT 1.0,  -- Relative importance/weight for scoring
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_domains_name ON domains(name);

-- Skills: Specific skills within each domain (e.g., "Words in Context", "Linear Equations")
CREATE TABLE IF NOT EXISTS skills (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    domain_id UUID NOT NULL REFERENCES domains(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    bloom_level VARCHAR(50),  -- e.g., "Remember", "Understand", "Apply", "Analyze", "Evaluate", "Create"
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(domain_id, name)  -- Skill names must be unique within a domain
);

CREATE INDEX IF NOT EXISTS idx_skills_domain_id ON skills(domain_id);
CREATE INDEX IF NOT EXISTS idx_skills_name ON skills(name);

-- Skill Bands: Score range descriptors (e.g., "600-690" level abilities)
-- This stores what students at different score levels can do for each skill
CREATE TABLE IF NOT EXISTS skill_bands (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    skill_id UUID NOT NULL REFERENCES skills(id) ON DELETE CASCADE,
    score_range VARCHAR(50) NOT NULL,  -- e.g., "490-540", "550-600", "600-690", "700-800"
    descriptor TEXT NOT NULL,  -- Specific ability description for this score band
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(skill_id, score_range)  -- One descriptor per skill per score range
);

CREATE INDEX IF NOT EXISTS idx_skill_bands_skill_id ON skill_bands(skill_id);
CREATE INDEX IF NOT EXISTS idx_skill_bands_score_range ON skill_bands(score_range);

-- Misconceptions: Common student errors and remediation strategies
CREATE TABLE IF NOT EXISTS misconceptions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(255) NOT NULL UNIQUE,
    remediation_text TEXT NOT NULL,  -- How to address this misconception
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_misconceptions_name ON misconceptions(name);

-- Curriculum Chunks: RAG-able content chunks linked to skills
-- These are embedded and searchable for contextual tutoring
-- Note: This extends the existing 'curriculum_chunks' table if it exists, or creates a new one
DO $$
BEGIN
    -- Check if curriculum_chunks table exists
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'curriculum_chunks') THEN
        -- Add skill_id column if it doesn't exist
        IF NOT EXISTS (
            SELECT 1 FROM information_schema.columns 
            WHERE table_name = 'curriculum_chunks' AND column_name = 'skill_id'
        ) THEN
            ALTER TABLE curriculum_chunks ADD COLUMN skill_id UUID REFERENCES skills(id) ON DELETE SET NULL;
            CREATE INDEX IF NOT EXISTS idx_curriculum_chunks_skill_id ON curriculum_chunks(skill_id);
        END IF;
        
        -- Add source_type column if it doesn't exist
        IF NOT EXISTS (
            SELECT 1 FROM information_schema.columns 
            WHERE table_name = 'curriculum_chunks' AND column_name = 'source_type'
        ) THEN
            ALTER TABLE curriculum_chunks ADD COLUMN source_type VARCHAR(100);
            CREATE INDEX IF NOT EXISTS idx_curriculum_chunks_source_type ON curriculum_chunks(source_type);
        END IF;
        
        -- Add embedding column if it doesn't exist (for vector search)
        -- Note: If embedding exists as String type, we'll leave it and add a new vector column
        IF NOT EXISTS (
            SELECT 1 FROM information_schema.columns 
            WHERE table_name = 'curriculum_chunks' AND column_name = 'embedding'
        ) THEN
            ALTER TABLE curriculum_chunks ADD COLUMN embedding vector(768); -- Updated for Gemini text-embedding
        ELSE
            -- Check if embedding is already a vector type, if not, add a new vector_embedding column
            IF NOT EXISTS (
                SELECT 1 FROM information_schema.columns 
                WHERE table_name = 'curriculum_chunks' 
                AND column_name = 'embedding' 
                AND data_type = 'USER-DEFINED'
                AND udt_name = 'vector'
            ) THEN
                -- Embedding exists but is not a vector type (likely String), add vector_embedding
                ALTER TABLE curriculum_chunks ADD COLUMN vector_embedding vector(768); -- Updated for Gemini text-embedding
            END IF;
        END IF;
        
        -- Create HNSW index on embedding if it's a vector type
        -- Use vector_embedding if embedding is String type
        IF EXISTS (
            SELECT 1 FROM information_schema.columns 
            WHERE table_name = 'curriculum_chunks' 
            AND column_name = 'embedding' 
            AND data_type = 'USER-DEFINED'
            AND udt_name = 'vector'
        ) THEN
            -- Create HNSW index on embedding if it doesn't exist
            IF NOT EXISTS (
                SELECT 1 FROM pg_indexes 
                WHERE tablename = 'curriculum_chunks' AND indexname = 'idx_curriculum_chunks_embedding'
            ) THEN
                CREATE INDEX idx_curriculum_chunks_embedding 
                ON curriculum_chunks 
                USING hnsw (embedding vector_cosine_ops)
                WITH (m = 16, ef_construction = 64);
            END IF;
        ELSIF EXISTS (
            SELECT 1 FROM information_schema.columns 
            WHERE table_name = 'curriculum_chunks' AND column_name = 'vector_embedding'
        ) THEN
            -- Create HNSW index on vector_embedding if it doesn't exist
            IF NOT EXISTS (
                SELECT 1 FROM pg_indexes 
                WHERE tablename = 'curriculum_chunks' AND indexname = 'idx_curriculum_chunks_vector_embedding'
            ) THEN
                CREATE INDEX idx_curriculum_chunks_vector_embedding 
                ON curriculum_chunks 
                USING hnsw (vector_embedding vector_cosine_ops)
                WITH (m = 16, ef_construction = 64);
            END IF;
        END IF;
    ELSE
        -- Create curriculum_chunks table if it doesn't exist
        CREATE TABLE curriculum_chunks (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            content TEXT NOT NULL,
            skill_id UUID REFERENCES skills(id) ON DELETE SET NULL,
            source_type VARCHAR(100),  -- e.g., "official_guide", "practice_test", "curriculum"
            embedding vector(768),  -- Gemini text-embedding dimension (768)
            created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
            updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
        );
        
        -- HNSW index for fast vector similarity search
        CREATE INDEX idx_curriculum_chunks_embedding 
        ON curriculum_chunks 
        USING hnsw (embedding vector_cosine_ops)
        WITH (m = 16, ef_construction = 64);
        
        CREATE INDEX idx_curriculum_chunks_skill_id ON curriculum_chunks(skill_id);
        CREATE INDEX idx_curriculum_chunks_source_type ON curriculum_chunks(source_type);
    END IF;
END $$;

-- Items: Questions/problems linked to skills
-- Note: This extends the existing 'items' table if it exists, or creates a new one
-- If items table already exists, we'll add the skill_id column separately
DO $$
BEGIN
    -- Check if items table exists and add skill_id if it doesn't exist
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'items') THEN
        -- Add skill_id column if it doesn't exist
        IF NOT EXISTS (
            SELECT 1 FROM information_schema.columns 
            WHERE table_name = 'items' AND column_name = 'skill_id'
        ) THEN
            ALTER TABLE items ADD COLUMN skill_id UUID REFERENCES skills(id) ON DELETE SET NULL;
            CREATE INDEX IF NOT EXISTS idx_items_skill_id ON items(skill_id);
        END IF;
        
        -- Add difficulty_level if it doesn't exist
        IF NOT EXISTS (
            SELECT 1 FROM information_schema.columns 
            WHERE table_name = 'items' AND column_name = 'difficulty_level'
        ) THEN
            ALTER TABLE items ADD COLUMN difficulty_level INTEGER;
            CREATE INDEX IF NOT EXISTS idx_items_difficulty_level ON items(difficulty_level);
        END IF;
    ELSE
        -- Create items table if it doesn't exist
        CREATE TABLE items (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            content TEXT NOT NULL,  -- Question text/content
            rationale TEXT,  -- Explanation of the correct answer
            skill_id UUID REFERENCES skills(id) ON DELETE SET NULL,
            difficulty_level INTEGER,  -- 1-4 scale or similar
            created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
            updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
        );
        
        CREATE INDEX IF NOT EXISTS idx_items_skill_id ON items(skill_id);
        CREATE INDEX IF NOT EXISTS idx_items_difficulty_level ON items(difficulty_level);
    END IF;
END $$;

-- Junction table: Link misconceptions to skills
CREATE TABLE IF NOT EXISTS skill_misconceptions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    skill_id UUID NOT NULL REFERENCES skills(id) ON DELETE CASCADE,
    misconception_id UUID NOT NULL REFERENCES misconceptions(id) ON DELETE CASCADE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(skill_id, misconception_id)
);

CREATE INDEX IF NOT EXISTS idx_skill_misconceptions_skill_id ON skill_misconceptions(skill_id);
CREATE INDEX IF NOT EXISTS idx_skill_misconceptions_misconception_id ON skill_misconceptions(misconception_id);

-- Add comments for documentation
COMMENT ON TABLE domains IS 'Top-level SAT domains (Reading and Writing, Math)';
COMMENT ON TABLE skills IS 'Specific skills within each domain';
COMMENT ON TABLE skill_bands IS 'Score range descriptors showing what students can do at different levels';
COMMENT ON TABLE misconceptions IS 'Common student errors and remediation strategies';
COMMENT ON TABLE curriculum_chunks IS 'RAG-able content chunks for contextual tutoring';
COMMENT ON TABLE skill_misconceptions IS 'Junction table linking skills to common misconceptions';
