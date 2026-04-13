# Curriculum Architect Agent

The Curriculum Architect Agent analyzes student performance after each session and automatically updates their learning path by unlocking/locking concepts and scheduling spaced repetition reviews.

## Architecture

```
Session Completed
    ↓
Get Session Logs (last 20 minutes)
    ↓
Get Knowledge Graph Mastery State
    ↓
Architect Agent Analysis
    ↓
Generate Curriculum Plan
    ↓
Update Student Profile
```

## Components

### 1. Architect Agent (`src/ai/agents/ArchitectAgent.ts`)

The AI agent that makes curriculum decisions:

**Inputs:**
- Session logs from last 20 minutes
- Knowledge graph mastery state
- Prerequisite relationships

**Decisions:**
- **Unlock**: Prerequisites of struggling concepts
- **Lock**: Advanced concepts that depend on struggling areas
- **Review Queue**: Spaced repetition scheduling
- **Next Focus**: Area for next session

**Output Format:**
```json
{
  "unlock": ["concept_id_1", "concept_id_2"],
  "lock": ["concept_id_3"],
  "reviewQueue": [
    {
      "conceptId": "concept_id_4",
      "conceptName": "Linear Equations",
      "reviewDate": "2024-01-04",
      "priority": 0.9,
      "reason": "Struggled with 3 out of 4 questions"
    }
  ],
  "nextSessionFocus": "Grammar Basics",
  "reasoning": "Student struggled with Dangling Modifiers, unlocking Participles prerequisite."
}
```

### 2. Curriculum Service

**TypeScript** (`src/services/CurriculumService.ts`):
- Logic for analyzing sessions
- Converting session data to architect context
- Updating profiles with plans

**Python** (`src/services/curriculum_service.py`):
- Database integration
- Profile persistence
- Session log retrieval

## Database Schema

### StudentProfile Table

```sql
student_profiles (
  id UUID PRIMARY KEY,
  user_id VARCHAR UNIQUE NOT NULL,
  tenant_id VARCHAR NOT NULL,
  concept_mastery JSONB,  -- {concept_id: {mastery: 0.8, status: "unlocked"}}
  unlocked_concepts JSONB,  -- ["concept_id_1", ...]
  locked_concepts JSONB,  -- ["concept_id_2", ...]
  review_queue JSONB,  -- [{conceptId, reviewDate, priority, ...}]
  next_session_focus VARCHAR,
  total_sessions INTEGER,
  last_session_at TIMESTAMP,
  ...
)
```

### ConceptMastery Table

```sql
concept_mastery (
  id UUID PRIMARY KEY,
  user_id VARCHAR NOT NULL,
  concept_id UUID REFERENCES concepts(id),
  mastery_level FLOAT,  -- 0.0 to 1.0
  status VARCHAR,  -- "locked", "unlocked", "mastered"
  times_practiced INTEGER,
  times_correct INTEGER,
  last_practiced_at TIMESTAMP,
  next_review_at TIMESTAMP,  -- For spaced repetition
  ...
)
```

## Decision Logic

### Unlock Rules

1. **Struggling Concept**: If student accuracy < 60% on a concept
   - Unlock all prerequisites of that concept
   - Example: Struggles with "Dangling Modifiers" → Unlock "Participles"

2. **Mastery Achievement**: If student accuracy > 80% on multiple questions
   - Unlock concepts that depend on this concept
   - Example: Masters "Linear Equations" → Unlock "Systems of Equations"

3. **Prerequisite Chain**: Never unlock a concept if its prerequisites are locked

### Lock Rules

1. **Struggling Dependency**: If student struggles with Concept X
   - Lock all concepts that depend on X
   - Example: Struggles with "Linear Equations" → Lock "Systems of Equations"

2. **Stale Prerequisites**: If prerequisite hasn't been practiced in 7+ days
   - Consider locking dependent concepts

### Review Queue Logic

Spaced repetition intervals based on accuracy:

- **< 70% accuracy**: Review in 3 days
- **70-80% accuracy**: Review in 7 days
- **> 80% accuracy (not mastered)**: Review in 14 days
- **Mastered**: Review in 30 days

Priority calculation:
- Higher priority for lower accuracy
- Higher priority for more recent struggles
- Higher priority for foundational concepts

## Usage

### Analyze Session and Update Curriculum

```python
from src.services.curriculum_service import analyze_session_and_update_curriculum

result = await analyze_session_and_update_curriculum(
    session_id="session_123",
    user_id="user_456",
    tenant_id="school_A",
    db=db,
)

print(result["plan"]["unlock"])  # Concepts to unlock
print(result["plan"]["reviewQueue"])  # Review schedule
```

### Get Student Profile

```python
from src.services.curriculum_service import get_or_create_student_profile

profile = await get_or_create_student_profile(
    user_id="user_456",
    tenant_id="school_A",
    db=db,
)

print(profile.unlocked_concepts)
print(profile.review_queue)
```

### API Endpoints

**POST `/api/curriculum/sessions/{session_id}/analyze`**
- Analyzes a completed session
- Updates student curriculum
- Returns updated profile and plan

**GET `/api/curriculum/students/{user_id}/profile`**
- Get student's learning profile
- Returns unlocked/locked concepts, review queue, etc.

**GET `/api/curriculum/students/{user_id}/review-queue`**
- Get concepts due for review today
- Sorted by priority

## Integration Example

```python
# After session completion
@router.post("/sessions/{session_id}/complete")
async def complete_session(session_id: str, db: AsyncSession = Depends(get_db)):
    # Mark session as completed
    session.status = "completed"
    await db.commit()
    
    # Trigger curriculum analysis (can be async/background task)
    await analyze_session_and_update_curriculum(
        session_id=session_id,
        user_id=session.user_id,
        tenant_id=session.tenant_id,
        db=db,
    )
    
    return {"status": "completed"}
```

## Example Scenarios

### Scenario 1: Struggling with Dangling Modifiers

**Session Log:**
- Question 1: Dangling Modifiers (Wrong)
- Question 2: Dangling Modifiers (Wrong)
- Question 3: Subject-Verb Agreement (Correct)

**Architect Decision:**
```json
{
  "unlock": ["participles_concept_id"],
  "lock": ["advanced_style_concept_id"],
  "reviewQueue": [{
    "conceptId": "dangling_modifiers_id",
    "reviewDate": "2024-01-04",
    "priority": 0.9,
    "reason": "Struggled with 2/2 questions"
  }],
  "nextSessionFocus": "Participles"
}
```

### Scenario 2: Mastering Linear Equations

**Session Log:**
- Question 1: Linear Equations (Correct)
- Question 2: Linear Equations (Correct)
- Question 3: Linear Equations (Correct)

**Architect Decision:**
```json
{
  "unlock": ["systems_of_equations_concept_id"],
  "reviewQueue": [{
    "conceptId": "linear_equations_id",
    "reviewDate": "2024-01-14",
    "priority": 0.3,
    "reason": "Mastered, review in 14 days"
  }],
  "nextSessionFocus": "Systems of Equations"
}
```

## Future Enhancements

- [ ] LLM-based architect agent (currently rule-based)
- [ ] Adaptive spaced repetition intervals
- [ ] Learning velocity tracking
- [ ] Concept difficulty calibration
- [ ] Multi-concept question analysis
- [ ] Time-based mastery decay
