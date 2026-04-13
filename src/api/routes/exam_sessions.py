"""
Exam Session API routes for module-based exam fetching.

Handles fetching current module and submitting modules for routing.
"""
import json
import math
import time
from uuid import UUID
from typing import Optional, Dict, Any, List
from datetime import datetime, timezone, date
from fastapi import APIRouter, Depends, Request, HTTPException, status
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, text
from src.db.session import get_db
from src.core.redis import get_redis
from src.db.models import Session, ExamDefinition, Item
from src.services.session import SessionManager
from src.core.engine import NavigationEngine
from src.schemas.exam import Container

router = APIRouter()


async def _upsert_student_profile_from_responses(
    db: AsyncSession,
    user_id: str,
    tenant_id: str,
    response_history: List[Dict[str, Any]],
) -> None:
    """
    Calculate per-skill-tag mastery from response_history and upsert student_profiles.

    Mastery format stored in concept_mastery JSONB:
        {
          "<skill_tag>": {
            "total": <int>,
            "correct": <int>,
            "last_seen": "<ISO timestamp>",
            "priority_score": <float 0.0–1.0>
          },
          ...
        }

    review_queue format (list of dicts consumed by get_concepts_for_review):
        [
          {
            "conceptId": "<concept_name / skill_tag>",
            "reviewDate": "<YYYY-MM-DD>",
            "priority": <float>,
            "total": <int>,
            "correct": <int>
          },
          ...
        ]
    """
    try:
        # --- 1. Aggregate per skill_tag ---
        skill_stats: Dict[str, Dict[str, Any]] = {}
        now_iso = datetime.now(timezone.utc).isoformat()

        for resp in response_history:
            if not isinstance(resp, dict):
                continue
            item_id = resp.get("item_id")
            if not item_id:
                continue

            # Look up skill_tag from the items table
            if _is_uuid(item_id):
                item_result = await db.execute(
                    select(Item.skill_tag).where(
                        Item.id == UUID(item_id),
                        Item.tenant_id == tenant_id,
                    )
                )
            else:
                item_result = await db.execute(
                    select(Item.skill_tag).where(
                        Item.logical_id == item_id,
                        Item.tenant_id == tenant_id,
                    )
                )
            row = item_result.fetchone()
            skill_tag = (row[0] if row else None) or resp.get("skill_tag")

            if not skill_tag:
                skill_tag = "Unknown"

            if skill_tag not in skill_stats:
                skill_stats[skill_tag] = {"total": 0, "correct": 0}
            skill_stats[skill_tag]["total"] += 1
            if resp.get("is_correct"):
                skill_stats[skill_tag]["correct"] += 1

        if not skill_stats:
            print(f"[StudentProfile] No skill stats derived for user {user_id} — skipping upsert")
            return

        # --- 2. Build concept_mastery dict ---
        concept_mastery: Dict[str, Any] = {}
        review_queue: List[Dict[str, Any]] = []
        today = date.today().isoformat()

        for skill_tag, stats in skill_stats.items():
            total = stats["total"]
            correct = stats["correct"]
            accuracy = correct / total if total > 0 else 0.0
            # priority_score: high when accuracy is low (struggles more → higher priority)
            # Slightly scale by attempt count (more attempts = more signal)
            confidence = min(total / 5.0, 1.0)  # saturates at 5 attempts
            priority_score = round((1.0 - accuracy) * confidence, 4)

            concept_mastery[skill_tag] = {
                "total": total,
                "correct": correct,
                "last_seen": now_iso,
                "priority_score": priority_score,
            }

            # Only add to review_queue if there is something to practice
            if total > 0:
                review_queue.append({
                    "conceptId": skill_tag,
                    "reviewDate": today,  # due immediately after diagnostic
                    "priority": priority_score,
                    "total": total,
                    "correct": correct,
                })

        # Sort review_queue by priority descending
        review_queue.sort(key=lambda x: x["priority"], reverse=True)

        # --- 3. Upsert student_profiles ---
        check_query = text("""
            SELECT id FROM student_profiles
            WHERE user_id = :user_id AND tenant_id = :tenant_id
        """)
        check_result = await db.execute(check_query, {"user_id": user_id, "tenant_id": tenant_id})
        existing = check_result.fetchone()

        if existing:
            update_query = text("""
                UPDATE student_profiles
                SET concept_mastery = :concept_mastery::jsonb,
                    review_queue    = :review_queue::jsonb,
                    total_sessions  = total_sessions + 1,
                    last_session_at = now(),
                    updated_at      = now()
                WHERE user_id = :user_id AND tenant_id = :tenant_id
            """)
            await db.execute(update_query, {
                "user_id": user_id,
                "tenant_id": tenant_id,
                "concept_mastery": json.dumps(concept_mastery),
                "review_queue": json.dumps(review_queue),
            })
            print(f"[StudentProfile] Updated profile for user {user_id} — {len(concept_mastery)} skill tags")
        else:
            insert_query = text("""
                INSERT INTO student_profiles
                    (user_id, tenant_id, concept_mastery, review_queue,
                     unlocked_concepts, locked_concepts, total_sessions, last_session_at)
                VALUES
                    (:user_id, :tenant_id, :concept_mastery::jsonb, :review_queue::jsonb,
                     '[]'::jsonb, '[]'::jsonb, 1, now())
            """)
            await db.execute(insert_query, {
                "user_id": user_id,
                "tenant_id": tenant_id,
                "concept_mastery": json.dumps(concept_mastery),
                "review_queue": json.dumps(review_queue),
            })
            print(f"[StudentProfile] Created profile for user {user_id} — {len(concept_mastery)} skill tags")

    except Exception as exc:
        # Non-fatal: log and continue so the exam completion still succeeds
        import traceback
        print(f"[StudentProfile] ERROR upserting student profile for user {user_id}: {exc}")
        print(traceback.format_exc())


async def _upsert_student_profile_from_performance(
    db: AsyncSession,
    user_id: str,
    tenant_id: str,
    performance_profile: Dict[str, Any],
) -> None:
    """
    Update student_profiles.concept_mastery from a performanceProfile dict sent by the frontend.

    The performanceProfile is expected to contain per-category stats, e.g.:
        { "Algebra": { "total": 5, "correct": 3 }, ... }

    Any existing mastery entries for the same keys are merged (totals accumulated).
    """
    try:
        if not performance_profile or not isinstance(performance_profile, dict):
            return

        now_iso = datetime.now(timezone.utc).isoformat()
        today = date.today().isoformat()

        # Fetch existing mastery
        check_query = text("""
            SELECT id, concept_mastery, review_queue, total_sessions
            FROM student_profiles
            WHERE user_id = :user_id AND tenant_id = :tenant_id
        """)
        result = await db.execute(check_query, {"user_id": user_id, "tenant_id": tenant_id})
        existing_row = result.fetchone()

        existing_mastery: Dict[str, Any] = {}
        existing_queue: List[Dict[str, Any]] = []
        if existing_row:
            existing_mastery = existing_row.concept_mastery or {}
            existing_queue = existing_row.review_queue or []

        # Merge performance_profile into existing mastery
        for category, stats in performance_profile.items():
            if not isinstance(stats, dict):
                continue
            total = int(stats.get("total", 0))
            correct = int(stats.get("correct", 0))
            if total == 0:
                continue

            prev = existing_mastery.get(category, {"total": 0, "correct": 0})
            new_total = prev.get("total", 0) + total
            new_correct = prev.get("correct", 0) + correct
            accuracy = new_correct / new_total if new_total > 0 else 0.0
            confidence = min(new_total / 5.0, 1.0)
            priority_score = round((1.0 - accuracy) * confidence, 4)

            existing_mastery[category] = {
                "total": new_total,
                "correct": new_correct,
                "last_seen": now_iso,
                "priority_score": priority_score,
            }

        # Rebuild review_queue — replace or add entries for updated categories
        queue_map = {item["conceptId"]: item for item in existing_queue}
        for category, mastery in existing_mastery.items():
            priority_score = mastery.get("priority_score", 0.0)
            if mastery.get("total", 0) > 0:
                queue_map[category] = {
                    "conceptId": category,
                    "reviewDate": today,
                    "priority": priority_score,
                    "total": mastery.get("total", 0),
                    "correct": mastery.get("correct", 0),
                }
        review_queue = sorted(queue_map.values(), key=lambda x: x["priority"], reverse=True)

        if existing_row:
            await db.execute(text("""
                UPDATE student_profiles
                SET concept_mastery = :concept_mastery::jsonb,
                    review_queue    = :review_queue::jsonb,
                    total_sessions  = total_sessions + 1,
                    last_session_at = now(),
                    updated_at      = now()
                WHERE user_id = :user_id AND tenant_id = :tenant_id
            """), {
                "user_id": user_id,
                "tenant_id": tenant_id,
                "concept_mastery": json.dumps(existing_mastery),
                "review_queue": json.dumps(review_queue),
            })
            print(f"[StudentProfile] Merged performanceProfile for user {user_id} — {len(existing_mastery)} skill tags")
        else:
            await db.execute(text("""
                INSERT INTO student_profiles
                    (user_id, tenant_id, concept_mastery, review_queue,
                     unlocked_concepts, locked_concepts, total_sessions, last_session_at)
                VALUES
                    (:user_id, :tenant_id, :concept_mastery::jsonb, :review_queue::jsonb,
                     '[]'::jsonb, '[]'::jsonb, 1, now())
            """), {
                "user_id": user_id,
                "tenant_id": tenant_id,
                "concept_mastery": json.dumps(existing_mastery),
                "review_queue": json.dumps(review_queue),
            })
            print(f"[StudentProfile] Created profile from performanceProfile for user {user_id} — {len(existing_mastery)} skill tags")

    except Exception as exc:
        import traceback
        print(f"[StudentProfile] ERROR upserting from performanceProfile for user {user_id}: {exc}")
        print(traceback.format_exc())


class SubmitModuleRequest(BaseModel):
    """Request body for submitting a module."""
    session_id: str
    module_id: str
    responses: List[Dict[str, Any]]  # List of {question_id, selected_option_id, time_spent}


class SubmitModuleResponse(BaseModel):
    """Response from submitting a module."""
    status: str  # "module_complete" or "exam_complete"
    next_module_id: Optional[str] = None
    module_score: int  # Score out of total questions
    routing_threshold_met: Optional[bool] = None
    message: Optional[str] = None


# Helper functions
def _find_module_1_id(structure: Dict[str, Any]) -> Optional[str]:
    """Find Module 1 ID in exam structure.
    
    For diagnostic exams, looks for modules with "module_1" in the ID.
    For daily tests, looks for "daily_module".
    If neither pattern matches, returns the first module found.
    """
    if isinstance(structure, dict):
        children = structure.get("children", [])
        for child in children:
            if isinstance(child, dict):
                child_id = child.get("id", "")
                child_type = child.get("type", "")
                # Check for diagnostic module 1
                if "module_1" in child_id.lower():
                    return child_id
                # Check for daily test module
                if "daily_module" in child_id.lower() and child_type == "module":
                    return child_id
                # Recursively search children
                found = _find_module_1_id(child)
                if found:
                    return found
        # If no specific pattern found, return the first module (for daily tests or other structures)
        for child in children:
            if isinstance(child, dict) and child.get("type") == "module":
                return child.get("id")
    return None


def _find_module_in_structure(structure: Dict[str, Any], module_id: str) -> Optional[Dict[str, Any]]:
    """Find a module by ID in the exam structure."""
    if isinstance(structure, dict):
        # Check if this is the module we're looking for
        if structure.get("id") == module_id:
            return structure
        
        # Check children
        children = structure.get("children", [])
        for child in children:
            found = _find_module_in_structure(child, module_id)
            if found:
                return found
    return None


def _find_module_2_easy_id(structure: Dict[str, Any]) -> Optional[str]:
    """Find Module 2 Easy ID in exam structure."""
    return _find_module_by_pattern(structure, "module_2_easy")


def _find_module_2_hard_id(structure: Dict[str, Any]) -> Optional[str]:
    """Find Module 2 Hard ID in exam structure."""
    return _find_module_by_pattern(structure, "module_2_hard")


def _find_module_by_pattern(structure: Dict[str, Any], pattern: str) -> Optional[str]:
    """Find a module ID containing the pattern."""
    if isinstance(structure, dict):
        module_id = structure.get("id", "")
        if pattern.lower() in module_id.lower():
            return module_id
        
        children = structure.get("children", [])
        for child in children:
            found = _find_module_by_pattern(child, pattern)
            if found:
                return found
    return None


def _is_uuid(value: str) -> bool:
    """Check if a string is a valid UUID."""
    try:
        UUID(value)
        return True
    except (ValueError, TypeError):
        return False


async def _calculate_module_2_routing(
    db: AsyncSession,
    exam: ExamDefinition,
    structure: Dict[str, Any],
    response_history: List[Dict[str, Any]],
    tenant_id: str
) -> str:
    """Calculate which Module 2 to route to based on Module 1 score."""
    # Find Module 1
    module1_id = _find_module_1_id(structure)
    
    # Determine module prefix from Module 1 ID or exam metadata
    module_prefix = ""
    if module1_id:
        if module1_id.startswith("rw_"):
            module_prefix = "rw_"
        elif module1_id.startswith("math_"):
            module_prefix = "math_"
    else:
        # Try to infer from exam metadata
        exam_metadata = structure.get("metadata", {}) if isinstance(structure, dict) else {}
        exam_type = exam_metadata.get("exam_type", "")
        if exam_type == "DIAGNOSTIC_RW":
            module_prefix = "rw_"
        elif exam_type == "DIAGNOSTIC_MATH":
            module_prefix = "math_"
    
    if not module1_id:
        # Default to easy module if we can't find Module 1
        return _find_module_2_easy_id(structure) or f"{module_prefix}module_2_easy"
    
    module1 = _find_module_in_structure(structure, module1_id)
    if not module1:
        return _find_module_2_easy_id(structure) or f"{module_prefix}module_2_easy"
    
    # Extract Module 1 item IDs
    module1_item_ids = []
    items = module1.get("items", [])
    for item in items:
        if isinstance(item, dict):
            module1_item_ids.append(item.get("item_id"))
        elif isinstance(item, str):
            module1_item_ids.append(item)
    
    # Calculate Module 1 score
    module1_responses = [
        r for r in response_history
        if (r.get("item_id") or r.get("questionId") or r.get("question_id")) in module1_item_ids
    ]
    
    # Fetch correct answers for Module 1 questions
    correct_count = 0
    total_questions = len(module1_item_ids)
    
    for response in module1_responses:
        item_id = response.get("item_id") or response.get("questionId") or response.get("question_id")
        selected_answer = response.get("selected_option_id") or response.get("selectedOptionId")
        
        if item_id and selected_answer:
            # Fetch item to get correct answer
            if _is_uuid(item_id):
                item_result = await db.execute(
                    select(Item).where(
                        (Item.id == UUID(item_id)) & (Item.tenant_id == tenant_id)
                    )
                )
            else:
                item_result = await db.execute(
                    select(Item).where(
                        (Item.logical_id == item_id) & (Item.tenant_id == tenant_id)
                    )
                )
            item_obj = item_result.scalar_one_or_none()
            
            if item_obj and str(item_obj.correct_answer).upper() == str(selected_answer).upper():
                correct_count += 1
    
    # Calculate score as percentage
    module1_score = correct_count / total_questions if total_questions > 0 else 0.0
    
    # Get routing threshold from Module 1 metadata or exam metadata (default 58% = 7/12)
    module1_metadata = module1.get("metadata", {})
    exam_metadata = structure.get("metadata", {}) if isinstance(structure, dict) else {}
    routing_threshold = module1_metadata.get("routing_threshold") or exam_metadata.get("routing_threshold", 0.58)
    
    # Determine routing
    module2_type = "HARD" if module1_score >= routing_threshold else "EASY"
    print(f"[DEBUG] Student scored {correct_count}/{total_questions}. Routing to {module2_type} module.")
    
    if module1_score >= routing_threshold:
        # Route to Hard Module 2
        module2_hard_id = _find_module_2_hard_id(structure)
        return module2_hard_id or f"{module_prefix}module_2_hard"
    else:
        # Route to Easy Module 2
        module2_easy_id = _find_module_2_easy_id(structure)
        return module2_easy_id or f"{module_prefix}module_2_easy"


def _item_to_question_content(item_row, request: Request, question_id: str, exam_metadata: Dict[str, Any] = None, item_uuid: str = None) -> Dict[str, Any]:
    """Convert database item row to QuestionContent format."""
    exam_metadata = exam_metadata or {}
    
    # Extract image paths
    image_paths = []
    if item_row.variables and isinstance(item_row.variables, dict):
        image_paths = item_row.variables.get("image_paths", [])
        if not isinstance(image_paths, list):
            image_paths = []
    
    # Convert image paths to URLs
    assets = []
    base_url = str(request.base_url).rstrip("/")
    for img_path in image_paths:
        if img_path:
            img_path_clean = img_path.lstrip("/")
            assets.append(f"{base_url}/api/images/{img_path_clean}")
    
    # Determine if SPR
    # Handle variables - it might be a dict, string (JSON), or None
    variables = {}
    if item_row.variables:
        if isinstance(item_row.variables, dict):
            variables = item_row.variables
        elif isinstance(item_row.variables, str):
            # Parse JSON string (can happen with raw SQL queries)
            import json
            try:
                variables = json.loads(item_row.variables)
            except (json.JSONDecodeError, TypeError):
                variables = {}
        else:
            # Try to convert to dict if it's some other type
            try:
                variables = dict(item_row.variables) if hasattr(item_row.variables, '__iter__') else {}
            except:
                variables = {}
    
    question_type = variables.get("question_type", "")
    is_spr = (
        variables.get("is_spr") or
        variables.get("type") == "spr" or
        question_type in ["SPR Math", "SPR RW"] or
        (not item_row.options or len(item_row.options) == 0) and variables.get("section") == "Math"
    )
    
    # Determine domain
    exam_type = exam_metadata.get("exam_type", "")
    if exam_type == "DIAGNOSTIC_MATH":
        domain = "Math"
    elif exam_type == "DIAGNOSTIC_RW":
        domain = "Reading and Writing"
    elif variables.get("section") == "Math":
        domain = "Math"
    else:
        domain = "Reading and Writing"
    
    # Determine category
    category = variables.get("primary_class") or variables.get("category") or ""
    
    # Convert options to choices format
    choices = []
    if item_row.options:
        if isinstance(item_row.options, list):
            for idx, opt in enumerate(item_row.options):
                if isinstance(opt, str):
                    choices.append({
                        "id": chr(65 + idx),  # A, B, C, D
                        "text": opt
                    })
                elif isinstance(opt, dict):
                    choices.append({
                        "id": opt.get("id", chr(65 + idx)),
                        "text": opt.get("text", opt.get("content", str(opt)))
                    })
    
    # Extract passage/stimulus text
    # STANDARDIZED: Use stimulus as primary field for RW questions
    # Fallback order: variables.stimulus -> variables.passageText -> variables.passage -> passage_text column
    stimulus_text = None
    if variables.get("stimulus"):
        stimulus_text = variables.get("stimulus")
    elif variables.get("passageText"):
        stimulus_text = variables.get("passageText")
    elif variables.get("passage"):
        stimulus_text = variables.get("passage")
    elif hasattr(item_row, 'passage_text') and item_row.passage_text:
        stimulus_text = item_row.passage_text
    
    # Debug logging for RW questions (only log first few to avoid spam)
    if domain == "Reading and Writing" and not stimulus_text:
        import logging
        logger = logging.getLogger(__name__)
        logger.warning(
            f"[PASSAGE DEBUG] Question {question_id}: No stimulus found. "
            f"Variables type: {type(item_row.variables).__name__}, "
            f"Has stimulus key: {'stimulus' in variables if isinstance(variables, dict) else 'N/A'}, "
            f"Variables keys: {list(variables.keys())[:5] if isinstance(variables, dict) else 'N/A'}"
        )
    
    return {
        "question_id": question_id,
        "_item_uuid": item_uuid or str(item_row.id),
        "text": item_row.question_text,
        "stem": item_row.question_text,
        "stimulus": stimulus_text or "",  # PRIMARY: Standardized on stimulus
        "passageText": stimulus_text or "",  # DEPRECATED: Keep for backward compatibility
        "passage": stimulus_text or "",  # DEPRECATED: Keep for backward compatibility
        "choices": choices,
        "correct_answer": item_row.correct_answer,
        "solution": item_row.solution_text or "",
        "solution_text": item_row.solution_text or "",
        "assets": assets,
        "is_spr": is_spr,
        "domain": domain,
        "category": category,
        "skill_tag": item_row.skill_tag,
        "skill": item_row.skill_tag or "",
        "difficulty_level": (
            1 if (variables.get("difficulty") or variables.get("difficulty_level") or "").upper() in ["E", "EASY"] else
            2 if (variables.get("difficulty") or variables.get("difficulty_level") or "").upper() in ["M", "MEDIUM"] else
            3 if (variables.get("difficulty") or variables.get("difficulty_level") or "").upper() in ["H", "HARD"] else
            2  # Default to Medium
        ),
        "metadata": {
            "skill_tag": item_row.skill_tag,
            "difficulty": variables.get("difficulty") or variables.get("difficulty_level") or 2,
        }
    }


async def _fetch_module_questions(
    db: AsyncSession,
    item_ids: List[str],
    tenant_id: str,
    request: Request,
    exam_metadata: Dict[str, Any] = None
) -> Dict[str, Dict[str, Any]]:
    """Fetch questions for a module from database."""
    questions = {}
    exam_metadata = exam_metadata or {}
    
    # Split item_ids into UUIDs and strings
    uuid_item_ids = []
    string_item_ids = []
    for item_id in item_ids:
        if item_id and _is_uuid(item_id):
            uuid_item_ids.append(item_id)
        elif item_id:
            string_item_ids.append(item_id)
    
    # Query by logical_id (string)
    if string_item_ids:
        placeholders = ", ".join([f":item_id_{i}" for i in range(len(string_item_ids))])
        query = text(f"""
            SELECT id, question_text, correct_answer, options, 
                   solution_text, skill_tag, variables::jsonb as variables, logical_id
            FROM items
            WHERE logical_id IN ({placeholders})
              AND tenant_id = :tenant_id
        """)
        params = {"tenant_id": tenant_id}
        for i, item_id in enumerate(string_item_ids):
            params[f"item_id_{i}"] = item_id
        
        result = await db.execute(query, params)
        rows = result.fetchall()
        
        for row in rows:
            item_id = row.logical_id or str(row.id)
            questions[item_id] = _item_to_question_content(row, request, item_id, exam_metadata, item_uuid=str(row.id))

    # Query by id (UUID)
    if uuid_item_ids:
        uuid_list = [UUID(uid) for uid in uuid_item_ids]
        placeholders = ", ".join([f":item_id_{i}" for i in range(len(uuid_list))])
        query = text(f"""
            SELECT id, question_text, correct_answer, options,
                   solution_text, skill_tag, variables::jsonb as variables, logical_id
            FROM items
            WHERE id IN ({placeholders})
              AND tenant_id = :tenant_id
        """)
        params = {"tenant_id": tenant_id}
        for i, item_uuid in enumerate(uuid_list):
            params[f"item_id_{i}"] = item_uuid

        result = await db.execute(query, params)
        rows = result.fetchall()

        for row in rows:
            item_id = row.logical_id or str(row.id)
            # Only add if not already added from logical_id query
            if item_id not in questions:
                questions[item_id] = _item_to_question_content(row, request, item_id, exam_metadata, item_uuid=str(row.id))
    
    return questions


@router.get("/session/{session_id}/current-module")
async def get_current_module(
    session_id: str,
    request: Request,
    db: AsyncSession = Depends(get_db),
    redis = Depends(get_redis),
    module_id: str = None  # Optional: for review mode, fetch specific module
):
    """
    Get the current active module for a session.
    
    Returns only the current module based on session status:
    - If NOT_STARTED or active with no current_module_id: Return Module 1
    - If MODULE_1_COMPLETE: Calculate routing and return Module 2 (Easy or Hard)
    - If completed: Return appropriate module for review
    
    Returns:
        {
            "module": { "id": "...", "type": "...", "question_order": [...] },
            "questions": { "q1": {...}, "q2": {...} },
            "config": { "total_time": 3600, "allowed_tools": [...] }
        }
    """
    tenant_id = request.headers.get("X-Tenant-ID", "public")
    
    try:
        session_uuid = UUID(session_id)
    except ValueError:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Invalid session_id format: {session_id}"
        )
    
    # Get session from database
    result = await db.execute(
        select(Session).where(Session.id == session_uuid)
    )
    db_session = result.scalar_one_or_none()
    
    # Get session from Redis (for response_history)
    session_manager = SessionManager(redis, db)
    redis_session = await session_manager.get_session(session_id)
    
    if not db_session:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Session {session_id} not found"
        )
    
    # Get exam definition
    exam_result = await db.execute(
        select(ExamDefinition).where(ExamDefinition.id == db_session.exam_id)
    )
    exam = exam_result.scalar_one_or_none()
    
    if not exam:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Exam {db_session.exam_id} not found"
        )
    
    structure = exam.structure or {}
    if not structure:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Exam structure is empty"
        )
    
    # Get exam metadata
    exam_metadata = structure.get("metadata", {}) if isinstance(structure, dict) else {}
    
    # Determine current module based on session status
    current_module_id = None
    session_status = db_session.status or "active"
    current_module_id_from_db = db_session.current_module_id
    
    # Get response history for routing calculation
    response_history = []
    if redis_session:
        response_history = redis_session.get("response_history", [])
    elif db_session.response_history:
        response_history = db_session.response_history
    
    # Determine which module to return
    # If module_id query parameter is provided (for review mode), use it
    if module_id:
        # Validate that the module exists in the exam structure
        target_module = _find_module_in_structure(structure, module_id)
        if not target_module:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Module {module_id} not found in exam structure"
            )
        current_module_id = module_id
    elif session_status == "completed":
        # For review mode, return the last module that was completed
        # Or return Module 1 for now (frontend can fetch all modules for review)
        current_module_id = current_module_id_from_db or _find_module_1_id(structure)
    elif session_status in ["active", "NOT_STARTED"]:
        if current_module_id_from_db:
            # Session already has a current module
            current_module_id = current_module_id_from_db
        else:
            # Start with Module 1
            current_module_id = _find_module_1_id(structure)
    elif session_status == "MODULE_1_COMPLETE" or (current_module_id_from_db and "module_1" in current_module_id_from_db.lower()):
        # Module 1 is complete, need to calculate routing
        current_module_id = await _calculate_module_2_routing(
            db, exam, structure, response_history, tenant_id
        )
    else:
        # Default to Module 1
        current_module_id = _find_module_1_id(structure)
    
    if not current_module_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Could not determine current module"
        )
    
    # Extract module from structure
    target_module = _find_module_in_structure(structure, current_module_id)
    if not target_module:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Module {current_module_id} not found in exam structure"
        )
    
    # Extract item IDs from module
    # Keep original IDs for question_order, but use stripped IDs for database queries
    original_item_ids = []
    db_item_ids = []
    id_mapping = {}  # Map from db_id to original_id
    
    if isinstance(target_module, dict):
        items = target_module.get("items", [])
        for item in items:
            if isinstance(item, dict):
                item_id = item.get("item_id")
                if item_id:
                    original_item_ids.append(item_id)
                    # Strip "daily-" prefix if present (for daily tests) for database queries
                    if item_id.startswith("daily-"):
                        db_id = item_id[6:]  # Remove "daily-" prefix
                        db_item_ids.append(db_id)
                        id_mapping[db_id] = item_id
                    else:
                        db_item_ids.append(item_id)
                        id_mapping[item_id] = item_id
            elif isinstance(item, str):
                original_item_ids.append(item)
                # Strip "daily-" prefix if present (for daily tests) for database queries
                if item.startswith("daily-"):
                    db_id = item[6:]  # Remove "daily-" prefix
                    db_item_ids.append(db_id)
                    id_mapping[db_id] = item
                else:
                    db_item_ids.append(item)
                    id_mapping[item] = item
    
    if not db_item_ids:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Module {current_module_id} has no items"
        )
    
    # Fetch items from database using stripped IDs
    questions = await _fetch_module_questions(db, db_item_ids, tenant_id, request, exam_metadata)
    
    # Remap questions to use original IDs (for daily tests with "daily-" prefix)
    remapped_questions = {}
    question_order = []
    
    for db_id, original_id in id_mapping.items():
        # Find the question that matches this db_id
        # db_id may be a UUID string or a logical_id string
        for q_id, q_data in questions.items():
            if (
                str(q_id) == str(db_id)
                or q_data.get("question_id") == db_id
                or q_data.get("_item_uuid") == str(db_id)
            ):
                remapped_questions[original_id] = q_data.copy()
                remapped_questions[original_id]["question_id"] = original_id
                remapped_questions[original_id].pop("_item_uuid", None)
                question_order.append(original_id)
                break
    
    questions = remapped_questions
    
    # Get config from exam metadata
    duration_seconds = exam_metadata.get("duration_seconds", 3600)
    
    return {
        "module": {
            "id": current_module_id,
            "type": target_module.get("type", "fixed"),
            "question_order": question_order
        },
        "questions": questions,
        "config": {
            "total_time": duration_seconds,
            "allowed_tools": exam_metadata.get("allowed_tools", ["calculator"])
        }
    }


@router.post("/submit-module", response_model=SubmitModuleResponse)
async def submit_module(
    payload: SubmitModuleRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
    redis = Depends(get_redis)
):
    """
    Submit a module and calculate routing to next module.
    
    This endpoint:
    1. Syncs all module responses to the backend
    2. Calculates module score
    3. Determines routing (if Module 1, route to Easy/Hard Module 2)
    4. Updates session status
    5. Returns next module ID or completion status
    """
    tenant_id = request.headers.get("X-Tenant-ID", "public")
    user_id = request.headers.get("X-User-ID")
    
    # DEBUG: Log authentication check
    print(f"[Submit Module Backend]  Authentication check:")
    print(f"[Submit Module Backend]   - User ID from header: {user_id}")
    print(f"[Submit Module Backend]   - Tenant ID from header: {tenant_id}")
    print(f"[Submit Module Backend]   - All headers: {dict(request.headers)}")
    
    if not user_id:
        print(f"[Submit Module Backend]  Unauthorized - X-User-ID header missing")
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="X-User-ID header is required"
        )
    
    print(f"[Submit Module Backend]  Authentication passed")
    print(f"[Submit Module Backend]   - User ID: {user_id}")
    print(f"[Submit Module Backend]   - Tenant ID: {tenant_id}")
    
    try:
        session_uuid = UUID(payload.session_id)
    except ValueError:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Invalid session_id format: {payload.session_id}"
        )
    
    # Get session
    result = await db.execute(
        select(Session).where(Session.id == session_uuid)
    )
    session = result.scalar_one_or_none()
    
    if not session:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Session {payload.session_id} not found"
        )
    
    # Get exam
    exam_result = await db.execute(
        select(ExamDefinition).where(ExamDefinition.id == session.exam_id)
    )
    exam = exam_result.scalar_one_or_none()
    
    if not exam:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Exam {session.exam_id} not found"
        )
    
    structure = exam.structure or {}
    
    # Get session from Redis for response_history
    session_manager = SessionManager(redis, db)
    redis_session = await session_manager.get_session(payload.session_id)
    
    # Update response history
    response_history = redis_session.get("response_history", []) if redis_session else []
    
    # Calculate correctness and module score
    module_item_ids = [r.get("question_id") for r in payload.responses]
    correct_count = 0
    total_questions = len(module_item_ids)
    
    for response in payload.responses:
        question_id = response.get("question_id")
        selected_answer = response.get("selected_option_id")
        
        if not question_id or not selected_answer:
            continue
        
        # Fetch item to get correct answer
        if _is_uuid(question_id):
            item_result = await db.execute(
                select(Item).where(
                    (Item.id == UUID(question_id)) & (Item.tenant_id == tenant_id)
                )
            )
        else:
            item_result = await db.execute(
                select(Item).where(
                    (Item.logical_id == question_id) & (Item.tenant_id == tenant_id)
                )
            )
        item_obj = item_result.scalar_one_or_none()
        
        is_correct = False
        if item_obj:
            is_correct = str(item_obj.correct_answer).upper() == str(selected_answer).upper()
            if is_correct:
                correct_count += 1
        
        # Update or add response in response_history
        existing_idx = None
        for idx, existing in enumerate(response_history):
            existing_item_id = existing.get("item_id") or existing.get("questionId") or existing.get("question_id")
            if existing_item_id == question_id:
                existing_idx = idx
                break
        
        response_record = {
            "item_id": question_id,
            "selected_option_id": selected_answer,
            "is_correct": is_correct,
            "timestamp": response.get("timestamp", int(time.time() * 1000))
        }
        
        if existing_idx is not None:
            response_history[existing_idx] = response_record
        else:
            response_history.append(response_record)
    
    module_score = correct_count
    
    # Determine if this is Module 1 or Module 2
    is_module_1 = "module_1" in payload.module_id.lower()
    
    # Determine module prefix (rw_ or math_) from module_id or exam structure
    module_prefix = ""
    print(f"[Submit Module Backend]  Determining module prefix:")
    print(f"[Submit Module Backend]   - Module ID: {payload.module_id}")
    
    if payload.module_id.startswith("rw_"):
        module_prefix = "rw_"
        print(f"[Submit Module Backend]   - Detected prefix from module_id: rw_")
    elif payload.module_id.startswith("math_"):
        module_prefix = "math_"
        print(f"[Submit Module Backend]   - Detected prefix from module_id: math_")
    else:
        # Try to infer from exam metadata or structure
        exam_metadata = structure.get("metadata", {}) if isinstance(structure, dict) else {}
        exam_type = exam_metadata.get("exam_type", "")
        print(f"[Submit Module Backend]   - Exam type from metadata: {exam_type}")
        if exam_type == "DIAGNOSTIC_RW":
            module_prefix = "rw_"
            print(f"[Submit Module Backend]   - Detected prefix from exam_type: rw_")
        elif exam_type == "DIAGNOSTIC_MATH":
            module_prefix = "math_"
            print(f"[Submit Module Backend]   - Detected prefix from exam_type: math_")
        else:
            # Default fallback: check if we can find any module with prefix
            module1_id = _find_module_1_id(structure)
            print(f"[Submit Module Backend]   - Module 1 ID from structure: {module1_id}")
            if module1_id:
                if module1_id.startswith("rw_"):
                    module_prefix = "rw_"
                    print(f"[Submit Module Backend]   - Detected prefix from Module 1 ID: rw_")
                elif module1_id.startswith("math_"):
                    module_prefix = "math_"
                    print(f"[Submit Module Backend]   - Detected prefix from Module 1 ID: math_")
    
    print(f"[Submit Module Backend]   - Final module_prefix: '{module_prefix}'")
    
    # Calculate routing if Module 1
    next_module_id = None
    routing_threshold_met = None
    
    if is_module_1:
        # Get routing threshold
        module1 = _find_module_in_structure(structure, payload.module_id)
        module1_metadata = module1.get("metadata", {}) if module1 else {}
        exam_metadata = structure.get("metadata", {}) if isinstance(structure, dict) else {}
        routing_threshold_percentage = module1_metadata.get("routing_threshold") or exam_metadata.get("routing_threshold", 0.58)
        
        # Calculate score as percentage
        score_percentage = module_score / total_questions if total_questions > 0 else 0.0
        routing_threshold_met = score_percentage >= routing_threshold_percentage
        
        # Determine next module - use prefix in fallback
        module2_type = "HARD" if routing_threshold_met else "EASY"
        print(f"[DEBUG] Student scored {module_score}/{total_questions}. Routing to {module2_type} module.")
        
        if routing_threshold_met:
            next_module_id = _find_module_2_hard_id(structure) or f"{module_prefix}module_2_hard"
            print(f"[Submit Module Backend]  Routing to HARD module (threshold met)")
        else:
            next_module_id = _find_module_2_easy_id(structure) or f"{module_prefix}module_2_easy"
            print(f"[Submit Module Backend]  Routing to EASY module (threshold not met)")
        
        print(f"[Submit Module Backend]   - Next module ID: {next_module_id}")
        print(f"[Submit Module Backend]   - Module prefix used: '{module_prefix}'")
        
        # Update session status
        session.status = "MODULE_1_COMPLETE"
        session.current_module_id = next_module_id
        print(f"[Submit Module Backend]  Updated session:")
        print(f"[Submit Module Backend]   - Status: {session.status}")
        print(f"[Submit Module Backend]   - Current module ID: {session.current_module_id}")
    else:
        # Module 2 complete, exam is done
        session.status = "completed"
        if session.end_time is None:
            session.end_time = datetime.now(timezone.utc)

        # Persist mastery data to student_profile when a diagnostic exam completes
        if user_id:
            # Merge current module responses into full response_history for mastery calc
            full_history = list(response_history)
            print(f"[StudentProfile] Exam complete — computing mastery for user {user_id} from {len(full_history)} responses")
            await _upsert_student_profile_from_responses(
                db=db,
                user_id=user_id,
                tenant_id=tenant_id,
                response_history=full_history,
            )

    # Update response_history in Redis
    if redis_session:
        redis_session["response_history"] = response_history
        redis_session["status"] = session.status
        redis_session["current_module_id"] = session.current_module_id
        await redis.setex(
            f"session:{payload.session_id}",
            86400,  # 24 hours
            json.dumps(redis_session)
        )
    
    # Update session in database
    await db.commit()
    
    return SubmitModuleResponse(
        status="module_complete" if is_module_1 else "exam_complete",
        next_module_id=next_module_id,
        module_score=module_score,
        routing_threshold_met=routing_threshold_met,
        message="Module submitted successfully" if is_module_1 else "Exam completed"
    )
