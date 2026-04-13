# Diagnostic Exam Seeding Script

## Overview

The `seed_diagnostic_exam.py` script manages diagnostic exams in the backend database. It allows you to:
- List existing diagnostic exams
- Create new diagnostic exams (DIAGNOSTIC_MATH and/or DIAGNOSTIC_RW)
- Replace existing diagnostic exams

## Prerequisites

1. Backend database must be running and accessible
2. Database connection configured in `.env` file (DATABASE_URL)
3. Items must exist in the database for the diagnostic exam generator to work

## Usage

### List Existing Diagnostic Exams

```bash
python scripts/seed_diagnostic_exam.py --list-only
```

This will show all diagnostic exams currently in the database without creating any new ones.

### Create Diagnostic Exams

**Create both MATH and RW exams:**
```bash
python scripts/seed_diagnostic_exam.py
```

**Create only MATH exam:**
```bash
python scripts/seed_diagnostic_exam.py --type MATH
```

**Create only RW exam:**
```bash
python scripts/seed_diagnostic_exam.py --type RW
```

### Replace Existing Exams

If diagnostic exams already exist, use the `--replace` flag to delete and recreate them:

```bash
python scripts/seed_diagnostic_exam.py --replace
```

**Replace only one type:**
```bash
python scripts/seed_diagnostic_exam.py --type MATH --replace
```

### Non-Interactive Mode

For automation/CI, use `--confirm` to skip confirmation prompts:

```bash
python scripts/seed_diagnostic_exam.py --confirm --replace
```

### Custom Tenant ID

```bash
python scripts/seed_diagnostic_exam.py --tenant-id "custom-tenant"
```

## Command-Line Options

| Option | Description |
|--------|-------------|
| `--list-only` | Only list existing exams, don't create new ones |
| `--replace` | Replace existing exams if they exist |
| `--type {MATH,RW,BOTH}` | Which exam type to create (default: BOTH) |
| `--tenant-id` | Tenant ID (default: "public") |
| `--confirm` | Skip confirmation prompts |

## What the Script Does

1. **Lists existing diagnostic exams** - Shows all exams with "diagnostic" in the title or matching diagnostic UUIDs
2. **Checks for existing exams** - Prevents duplicate creation unless `--replace` is used
3. **Generates exam structure** - Uses `ExamService.generate_diagnostic_exam()` to create:
   - Module 1 (9 questions, Medium difficulty)
   - Module 2 Easy (9 questions, Easy/Medium difficulty)
   - Module 2 Hard (9 questions, Hard/Medium difficulty)
   - Routing rules with configurable threshold (default: 58%)
4. **Stores in database** - Creates `ExamDefinition` records with proper structure and metadata

## Exam Structure

Each diagnostic exam contains:
- **Total Questions:** 24 (12 per module)
- **Total Time:** 3600 seconds (60 minutes, 2.5 minutes per question)
- **Routing Threshold:** 58% (7/12 correct to route to Hard module)
- **Modules:**
  - Module 1: Adaptive routing based on score
  - Module 2 Easy: For scores < threshold
  - Module 2 Hard: For scores >= threshold

## UUIDs

- **DIAGNOSTIC_MATH:** `550e8400-e29b-41d4-a716-446655440000`
- **DIAGNOSTIC_RW:** `550e8400-e29b-41d4-a716-446655440001`

Note: Frontend currently uses `550e8400-e29b-41d4-a716-446655440000` for the diagnostic exam. If you need frontend compatibility, you may want to use the same UUID for RW or update the frontend to support separate exam types.

## Troubleshooting

### "No items found in database"
- Ensure items are loaded into the database first
- Check that items have proper `skill_tag` or `category` fields
- Verify tenant_id matches

### "Exam already exists"
- Use `--replace` flag to replace existing exam
- Or manually delete the exam from the database first

### "Failed to generate exam structure"
- Check database connection
- Verify items exist with proper domain categorization
- Check console output for detailed error messages

## Integration with Frontend

After seeding diagnostic exams in the backend:

1. Frontend will fetch exam structure from backend when starting a diagnostic
2. No local IndexedDB seeding is needed (removed from `startDiagnostic`)
3. Sessions are created in backend and synced properly

## Example Output

```
============================================================
Diagnostic Exam Seeding Script
============================================================
Database: localhost:5432/standard_tests
Tenant ID: public

[INFO] Listing existing diagnostic exams...
[INFO] Found 1 existing diagnostic exam(s):
------------------------------------------------------------
  ID: 550e8400-e29b-41d4-a716-446655440000
  Title: Diagnostic Math Exam
  Type: DIAGNOSTIC_MATH
  Questions: 18
  Active: True
  Created: 2024-01-15T10:30:00

[INFO] Will create 2 diagnostic exam(s):
  - DIAGNOSTIC_MATH
  - DIAGNOSTIC_RW

Continue? (yes/no): yes

[INFO] Creating DIAGNOSTIC_MATH exam...
[INFO] Deleting existing DIAGNOSTIC_MATH exam...
[OK] Deleted existing exam
[INFO] Generating DIAGNOSTIC_MATH exam structure...
[OK] Successfully created DIAGNOSTIC_MATH exam
     Exam ID: 550e8400-e29b-41d4-a716-446655440000
     Questions: 18
     Time: 2700 seconds (45 minutes)
     Routing Threshold: 0.55

[INFO] Creating DIAGNOSTIC_RW exam...
[INFO] Generating DIAGNOSTIC_RW exam structure...
[OK] Successfully created DIAGNOSTIC_RW exam
     Exam ID: 550e8400-e29b-41d4-a716-446655440001
     Questions: 18
     Time: 2700 seconds (45 minutes)
     Routing Threshold: 0.55

============================================================
[SUCCESS] Diagnostic exam seeding completed!
============================================================

[INFO] Final diagnostic exam list:
  - Diagnostic Math Exam (DIAGNOSTIC_MATH): 18 questions
  - Diagnostic Reading & Writing Exam (DIAGNOSTIC_RW): 18 questions
```
