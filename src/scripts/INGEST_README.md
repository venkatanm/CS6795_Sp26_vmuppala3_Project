# Curriculum Content Ingestion

This script ingests PDF content into the `curriculum_chunks` table with embeddings for RAG retrieval.

## Overview

The ingestion process has two streams:

### Stream A: Math PDF (High Trust)
- **File**: `sat-suite-classroom-practice-math.pdf`
- **Process**: Direct chunk → embed → insert
- **No cleaning needed** - assumes high-quality source

### Stream B: Watermarked Book
- **File**: `Official Digital Study Guide.pdf.pdf`
- **Process**: 
  1. Filter out "Practice Test" chapters
  2. Chunk by concept (~1000 tokens)
  3. Clean with Gemini 2.5 Flash Lite (parallel batches of 20)
  4. Audit for watermark survival
  5. Embed → Insert

## Prerequisites

1. **Database**: Ensure the SQL migration has been applied:
   ```bash
   Get-Content src/db/migrations/001_socratic_init.sql | docker exec -i fastapi_db psql -U postgres -d fastapi_db
   ```

2. **Environment Variables**: `.env` file in project root:
   ```
   DATABASE_URL=postgresql://postgres:postgres@localhost:5432/fastapi_db
   GEMINI_API_KEY=your_gemini_api_key_here
   ```

3. **PDF Files**: Ensure these files exist in `data/`:
   - `sat-suite-classroom-practice-math.pdf`
   - `Official Digital Study Guide.pdf.pdf`

4. **Dependencies**: Install npm packages:
   ```bash
   cd src/scripts
   npm install
   ```

## Usage

```bash
cd src/scripts
npm run ingest
```

Or directly:
```bash
npx tsx ingest_content.ts
```

## What It Does

### Text Cleaning (Gemini 2.5 Flash Lite)
- Removes watermark "VIETACCEPTED SAT IELTS"
- Removes page numbers and headers
- Fixes words broken by newlines
- Preserves LaTeX math formatting ($, \frac, etc.)

### Chunking Strategy
- Splits text by paragraphs
- Combines paragraphs until ~1000 tokens (~4000 characters)
- Preserves semantic boundaries

### Embedding Generation
- Uses Gemini `text-embedding-004` (768 dimensions)
- Stored as pgvector in PostgreSQL

### Parallel Processing
- Stream B processes 20 chunks in parallel for cleaning
- Significantly faster than sequential processing

## Output

The script will:
- Process both PDFs
- Show progress for each chunk/batch
- Report watermark audit failures
- Display summary statistics

## Validation

After ingestion, verify the data:

```sql
-- Count chunks
SELECT COUNT(*) FROM curriculum_chunks;

-- Check by source
SELECT source, COUNT(*) as chunk_count 
FROM curriculum_chunks 
GROUP BY source;

-- Check watermark audit (should be 0)
SELECT COUNT(*) 
FROM curriculum_chunks 
WHERE content LIKE '%VIETACCEPTED%';
```

## Troubleshooting

- **PDF not found**: Ensure PDFs are in `data/` directory at project root
- **Database connection error**: Check `DATABASE_URL` and ensure Docker containers are running
- **Gemini API error**: Verify `GEMINI_API_KEY` is set correctly
- **Embedding errors**: Check Gemini API quota and rate limits
