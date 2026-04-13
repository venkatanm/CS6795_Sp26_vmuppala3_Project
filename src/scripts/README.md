# Socratic Graph Taxonomy Seeder

This script parses SAT assessment framework PDFs and populates the knowledge graph database.

## Prerequisites

1. **PostgreSQL Database**: Ensure your database is running and the migration has been applied:
   ```bash
   # Apply the migration
   psql -d fastapi_db -f ../db/migrations/001_socratic_init.sql
   # Or if using Alembic, create a migration that runs this SQL file
   ```

2. **Environment Variables**: Create a `.env` file in the project root with:
   ```
   DATABASE_URL=postgresql://postgres:postgres@localhost:5432/fastapi_db
   GEMINI_API_KEY=your_gemini_api_key_here
   ```

3. **PDF Files**: Ensure these files exist in the `data/` directory:
   - `assessment-framework-for-digital-sat-suite.pdf`
   - `skills-insight-digital-sat-suite.pdf`

## Installation

```bash
cd src/scripts
npm install
```

## Usage

```bash
npm run seed
```

Or directly with tsx:
```bash
npx tsx seed_taxonomy.ts
```

## What It Does

1. **Step A**: Parses `assessment-framework-for-digital-sat-suite.pdf` (pages 10-30)
   - Extracts **Domains** (e.g., "Craft and Structure", "Heart of Algebra")
   - Extracts **Skills** within each domain (e.g., "Words in Context", "Linear Equations")
   - Uses **Gemini 2.5 Flash Lite** to structure the data
   - Optimized for Gemini's large context window - processes entire document sections at once

2. **Step B**: Parses `skills-insight-digital-sat-suite.pdf`
   - Extracts **Score Band descriptors** for each skill
   - Maps skills to score ranges (e.g., "490-540", "550-600", "600-690", "700-800")
   - Uses **Gemini 2.5 Flash Lite** to extract ability descriptions for each band
   - Processes ALL skills in a single request (no batching needed)

3. **Database Insertion**: Inserts all extracted data into PostgreSQL tables

4. **Validation**: Queries skill bands for score range "600-690" to verify seeding

## Output

The script will:
- Print progress for each step
- Show inserted domains and skills
- Display validation results with sample skill band descriptors

## Troubleshooting

- **PDF not found**: Ensure PDFs are in the `data/` directory at the project root
- **Database connection error**: Check `DATABASE_URL` in `.env`
- **Gemini API error**: Verify `GEMINI_API_KEY` is set and valid
- **JSON parsing error**: The LLM response may need manual adjustment; check console output
- **Module not found**: Run `npm install` in the `src/scripts/` directory to install dependencies
