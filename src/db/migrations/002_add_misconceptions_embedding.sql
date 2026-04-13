-- Add embedding column to misconceptions table for vector similarity search
-- This enables the TutorService to find misconceptions via vector search

DO $$
BEGIN
    -- Check if embedding column already exists
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'misconceptions' AND column_name = 'embedding'
    ) THEN
        -- Add embedding column
        ALTER TABLE misconceptions 
        ADD COLUMN embedding vector(768);
        
        -- Create index for vector similarity search
        CREATE INDEX IF NOT EXISTS idx_misconceptions_embedding 
        ON misconceptions 
        USING hnsw (embedding vector_cosine_ops)
        WITH (m = 16, ef_construction = 64);
        
        RAISE NOTICE 'Added embedding column and index to misconceptions table';
    ELSE
        RAISE NOTICE 'Embedding column already exists in misconceptions table';
    END IF;
END $$;
