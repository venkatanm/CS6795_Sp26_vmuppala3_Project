"""
Daily Test Generator Service

Generates personalized 10-question daily practice tests using:
- Bucket A (6 questions): Top 3 struggling concepts, 2 questions each
- Bucket B (2 questions): Misconception traps
- Bucket C (2 questions): Maintenance review (lower priority)
"""
from typing import List, Dict, Any, Optional, Set
from datetime import date, datetime
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, text, func
from sqlalchemy.orm import selectinload
from src.db.models import Item, QuestionConcept, Concept, ConceptMisconception, Misconception, TutorChat, Session, ExamDefinition
import json
import random

# Exam IDs for diagnostics and full-length (to exclude from daily tests)
DIAGNOSTIC_MATH_UUID = "550e8400-e29b-41d4-a716-446655440000"
DIAGNOSTIC_RW_UUID = "550e8400-e29b-41d4-a716-446655440001"


async def get_student_profile(
    db: AsyncSession,
    user_id: str,
    tenant_id: str = "public"
) -> Optional[Dict[str, Any]]:
    """Fetch student profile from database."""
    try:
        # Query student_profiles table
        query = text("""
            SELECT concept_mastery, unlocked_concepts, locked_concepts, 
                   review_queue, next_session_focus, total_sessions, last_session_at
            FROM student_profiles
            WHERE user_id = :user_id AND tenant_id = :tenant_id
        """)
        result = await db.execute(query, {"user_id": user_id, "tenant_id": tenant_id})
        row = result.fetchone()
        
        if not row:
            return None
        
        return {
            "concept_mastery": row.concept_mastery or {},
            "unlocked_concepts": row.unlocked_concepts or [],
            "locked_concepts": row.locked_concepts or [],
            "review_queue": row.review_queue or [],
            "next_session_focus": row.next_session_focus,
            "total_sessions": row.total_sessions or 0,
            "last_session_at": row.last_session_at,
        }
    except Exception as e:
        print(f"[DailyTestService] Error fetching student profile: {e}")
        return None


def get_concepts_for_review(profile: Dict[str, Any]) -> List[Dict[str, Any]]:
    """Get concepts that need review (spaced repetition)."""
    if not profile or not profile.get("review_queue"):
        return []
    
    today = date.today().isoformat()
    review_queue = profile.get("review_queue", [])
    
    # Filter concepts that are due for review
    due_concepts = [
        review for review in review_queue
        if review.get("reviewDate", "") <= today
    ]
    
    # Sort by priority (highest first)
    due_concepts.sort(key=lambda x: x.get("priority", 0), reverse=True)
    
    return due_concepts


def _item_matches_domain(item: Dict[str, Any], domain: Optional[str]) -> bool:
    """Check if item matches the requested domain (Math or RW)."""
    if not domain:
        return True
    variables = item.get("variables") or {}
    if isinstance(variables, str):
        try:
            variables = json.loads(variables)
        except (json.JSONDecodeError, TypeError):
            variables = {}
    section = str(variables.get("section", "") or "")
    question_type = str(variables.get("question_type", "") or "")
    is_math = section == "Math" or "Math" in question_type
    is_rw = section == "Reading and Writing" or "RW" in question_type or "Reading" in question_type or "Writing" in question_type
    if domain == "Math":
        return is_math
    if domain in ("RW", "Reading and Writing"):
        return is_rw
    return True


async def get_seen_item_ids(
    db: AsyncSession,
    user_id: str,
    tenant_id: str = "public"
) -> Set[str]:
    """Get all item IDs the user has seen in diagnostics, full-length, or daily tests."""
    seen: Set[str] = set()
    try:
        # Get all sessions for this user
        stmt = select(Session).where(
            Session.user_id == user_id,
            Session.tenant_id == tenant_id,
            Session.response_history.isnot(None)
        )
        result = await db.execute(stmt)
        sessions = result.scalars().all()
        
        # Get exam titles for full-length and daily
        exam_ids = list({s.exam_id for s in sessions if s.exam_id})
        exam_titles: Dict[str, str] = {}
        if exam_ids:
            exam_stmt = select(ExamDefinition.id, ExamDefinition.title).where(
                ExamDefinition.id.in_(exam_ids)
            )
            exam_result = await db.execute(exam_stmt)
            for row in exam_result.fetchall():
                exam_titles[str(row.id)] = (row.title or "") or ""
        
        for session in sessions:
            if not session.response_history:
                continue
            exam_id_str = str(session.exam_id) if session.exam_id else ""
            title = exam_titles.get(exam_id_str, "")
            # Include: diagnostics, full-length (title contains Full/Mock), daily (title contains Daily)
            is_diagnostic = exam_id_str in (DIAGNOSTIC_MATH_UUID, DIAGNOSTIC_RW_UUID)
            is_full_length = "Full" in title or "Mock" in title
            is_daily = "Daily" in title
            if not (is_diagnostic or is_full_length or is_daily):
                continue
            for resp in session.response_history or []:
                if isinstance(resp, dict):
                    item_id = resp.get("item_id") or resp.get("questionId") or resp.get("question_id")
                    if item_id:
                        raw_id = str(item_id).removeprefix("daily-").strip()
                        if raw_id:
                            seen.add(raw_id)
    except Exception as e:
        print(f"[DailyTestService] Error fetching seen item IDs: {e}")
    return seen


async def get_items_for_concept(
    db: AsyncSession,
    concept_id: str,
    difficulty: Optional[str] = None,
    limit: int = 10,
    tenant_id: str = "public",
    domain: Optional[str] = None,
    exclude_item_ids: Optional[Set[str]] = None
) -> List[Dict[str, Any]]:
    """Get items (questions) for a specific concept."""
    try:
        domain_filter = ""
        params_extra = {}
        if domain == "Math":
            domain_filter = " AND (i.variables->>'section' = 'Math' OR i.variables->>'question_type' LIKE '%Math%')"
        elif domain in ("RW", "Reading and Writing"):
            domain_filter = " AND (i.variables->>'section' = 'Reading and Writing' OR i.variables->>'question_type' LIKE '%RW%' OR i.variables->>'question_type' LIKE '%Reading%' OR i.variables->>'question_type' LIKE '%Writing%')"
        
        if difficulty:
            difficulty_map = {
                "Easy": "E", "Medium": "M", "Hard": "H",
                "E": "E", "M": "M", "H": "H"
            }
            mapped_difficulty = difficulty_map.get(difficulty, difficulty)
            query = text(f"""
                SELECT DISTINCT i.id, i.question_text, i.correct_answer, i.options,
                       i.solution_text, i.skill_tag, i.variables
                FROM items i
                INNER JOIN question_concepts qc ON i.id = qc.question_id
                WHERE qc.concept_id = :concept_id::uuid
                  AND i.tenant_id = :tenant_id
                  AND (
                    (i.variables->>'difficulty' = :mapped_difficulty) OR
                    (i.variables->>'difficulty' = :difficulty) OR
                    (i.variables->>'difficulty_level' = :mapped_difficulty) OR
                    (i.variables->>'difficulty_level' = :difficulty)
                  )
                  {domain_filter}
                LIMIT :limit
            """)
            params = {
                "concept_id": concept_id,
                "tenant_id": tenant_id,
                "mapped_difficulty": mapped_difficulty,
                "difficulty": difficulty,
                "limit": limit * 3,  # Fetch extra for filtering
            }
        else:
            query = text(f"""
                SELECT DISTINCT i.id, i.question_text, i.correct_answer, i.options,
                       i.solution_text, i.skill_tag, i.variables
                FROM items i
                INNER JOIN question_concepts qc ON i.id = qc.question_id
                WHERE qc.concept_id = :concept_id::uuid
                  AND i.tenant_id = :tenant_id
                  {domain_filter}
                LIMIT :limit
            """)
            params = {
                "concept_id": concept_id,
                "tenant_id": tenant_id,
                "limit": limit * 3,
            }
        
        result = await db.execute(query, params)
        rows = result.fetchall()
        exclude = exclude_item_ids or set()
        
        items = []
        for row in rows:
            item_id = str(row.id)
            if item_id in exclude:
                continue
            items.append({
                "id": item_id,
                "question_text": row.question_text,
                "correct_answer": row.correct_answer,
                "options": row.options or [],
                "solution_text": row.solution_text,
                "skill_tag": row.skill_tag,
                "variables": row.variables or {},
            })
            if len(items) >= limit:
                break
        return items
    except Exception as e:
        print(f"[DailyTestService] Error fetching items for concept {concept_id}: {e}")
        import traceback
        traceback.print_exc()
        return []


async def get_recent_misconceptions(
    db: AsyncSession,
    user_id: str,
    tenant_id: str = "public",
    limit: int = 5
) -> List[Dict[str, Any]]:
    """Get recent misconceptions triggered by the user."""
    try:
        # Query tutor_chats to find misconceptions
        query = text("""
            SELECT DISTINCT cm.misconception_id, m.name as misconception_name
            FROM tutor_chats tc
            INNER JOIN sessions s ON tc.session_id = s.id
            INNER JOIN concept_misconceptions cm ON tc.category = cm.concept_id::text
            INNER JOIN misconceptions m ON cm.misconception_id = m.id
            WHERE s.user_id = :user_id
              AND s.tenant_id = :tenant_id
            ORDER BY tc.created_at DESC
            LIMIT :limit
        """)
        
        result = await db.execute(query, {
            "user_id": user_id,
            "tenant_id": tenant_id,
            "limit": limit
        })
        rows = result.fetchall()
        
        return [
            {
                "misconception_id": str(row.misconception_id),
                "misconception_name": row.misconception_name,
            }
            for row in rows
        ]
    except Exception as e:
        print(f"[DailyTestService] Error fetching misconceptions: {e}")
        return []


async def get_items_for_misconceptions(
    db: AsyncSession,
    misconception_ids: List[str],
    limit: int = 2,
    tenant_id: str = "public",
    domain: Optional[str] = None,
    exclude_item_ids: Optional[Set[str]] = None
) -> List[Dict[str, Any]]:
    """Get items that test specific misconceptions."""
    if not misconception_ids:
        return []
    
    try:
        domain_filter = ""
        if domain == "Math":
            domain_filter = " AND (i.variables->>'section' = 'Math' OR i.variables->>'question_type' LIKE '%Math%')"
        elif domain in ("RW", "Reading and Writing"):
            domain_filter = " AND (i.variables->>'section' = 'Reading and Writing' OR i.variables->>'question_type' LIKE '%RW%' OR i.variables->>'question_type' LIKE '%Reading%' OR i.variables->>'question_type' LIKE '%Writing%')"
        
        query = text(f"""
            SELECT DISTINCT i.id, i.question_text, i.correct_answer, i.options,
                   i.solution_text, i.skill_tag, i.variables
            FROM items i
            INNER JOIN skills s ON i.skill_id = s.id
            INNER JOIN skill_misconceptions sm ON s.id = sm.skill_id
            WHERE sm.misconception_id = ANY(:misconception_ids::uuid[])
              AND i.tenant_id = :tenant_id
              {domain_filter}
            LIMIT :limit
        """)
        
        result = await db.execute(query, {
            "misconception_ids": misconception_ids,
            "tenant_id": tenant_id,
            "limit": limit * 3,
        })
        rows = result.fetchall()
        exclude = exclude_item_ids or set()
        
        items = []
        for row in rows:
            item_id = str(row.id)
            if item_id in exclude:
                continue
            items.append({
                "id": item_id,
                "question_text": row.question_text,
                "correct_answer": row.correct_answer,
                "options": row.options or [],
                "solution_text": row.solution_text,
                "skill_tag": row.skill_tag,
                "variables": row.variables or {},
            })
            if len(items) >= limit:
                break
        return items
    except Exception as e:
        print(f"[DailyTestService] Error fetching items for misconceptions: {e}")
        return []


async def get_random_items(
    db: AsyncSession,
    limit: int = 10,
    tenant_id: str = "public",
    domain: Optional[str] = None,
    exclude_item_ids: Optional[Set[str]] = None
) -> List[Dict[str, Any]]:
    """Get random items as fallback."""
    try:
        domain_filter = ""
        if domain == "Math":
            domain_filter = " AND (variables->>'section' = 'Math' OR variables->>'question_type' LIKE '%Math%')"
        elif domain in ("RW", "Reading and Writing"):
            domain_filter = " AND (variables->>'section' = 'Reading and Writing' OR variables->>'question_type' LIKE '%RW%' OR variables->>'question_type' LIKE '%Reading%' OR variables->>'question_type' LIKE '%Writing%')"
        
        query = text(f"""
            SELECT id, question_text, correct_answer, options,
                   solution_text, skill_tag, variables
            FROM items
            WHERE tenant_id = :tenant_id
              {domain_filter}
            ORDER BY RANDOM()
            LIMIT :limit
        """)
        
        result = await db.execute(query, {"tenant_id": tenant_id, "limit": limit * 3})
        rows = result.fetchall()
        exclude = exclude_item_ids or set()
        
        items = []
        for row in rows:
            item_id = str(row.id)
            if item_id in exclude:
                continue
            items.append({
                "id": item_id,
                "question_text": row.question_text,
                "correct_answer": row.correct_answer,
                "options": row.options or [],
                "solution_text": row.solution_text,
                "skill_tag": row.skill_tag,
                "variables": row.variables or {},
            })
            if len(items) >= limit:
                break
        return items
    except Exception as e:
        print(f"[DailyTestService] Error fetching random items: {e}")
        return []


def item_to_question_content(item: Dict[str, Any], base_url: str = "") -> Dict[str, Any]:
    """Convert database item to QuestionContent format."""
    # Parse variables if it's a string (JSON)
    variables = item.get("variables", {})
    if isinstance(variables, str):
        import json
        try:
            variables = json.loads(variables)
        except (json.JSONDecodeError, TypeError):
            variables = {}
    elif not isinstance(variables, dict):
        variables = {}
    
    # Extract image paths from variables
    image_paths = []
    if isinstance(variables, dict):
        image_paths = variables.get("image_paths", [])
        if not isinstance(image_paths, list):
            image_paths = []
    
    # Convert image paths to URLs
    assets = []
    if base_url:
        for img_path in image_paths:
            if img_path:
                img_path_clean = img_path.lstrip("/")
                assets.append(f"{base_url}/api/images/{img_path_clean}")
    
    # Determine if this is a Student-Produced Response (SPR) question
    question_type = variables.get("question_type", "")
    is_spr = (
        variables.get("is_spr") or
        variables.get("type") == "spr" or
        question_type in ["SPR Math", "SPR RW"] or
        (not item.get("options") or len(item.get("options", [])) == 0) and variables.get("section") == "Math"
    )
    
    # Determine domain
    domain = "Math" if variables.get("section") == "Math" else "Reading and Writing"
    
    # Determine category
    category = variables.get("primary_class") or variables.get("category") or ""
    
    # Extract stimulus/passage text for RW questions
    # STANDARDIZED: Use stimulus as primary field
    # Fallback order: variables.stimulus -> variables.passageText -> variables.passage
    stimulus_text = None
    if isinstance(variables, dict):
        stimulus_text = (
            variables.get("stimulus") or 
            variables.get("passageText") or 
            variables.get("passage") or 
            None
        )
    
    return {
        "question_id": f"daily-{item['id']}",
        "text": item["question_text"],  # Use 'text' for consistency
        "stem": item["question_text"],  # Keep 'stem' for backward compatibility
        "stimulus": stimulus_text or "",  # PRIMARY: Standardized on stimulus for RW questions
        "passageText": stimulus_text or "",  # DEPRECATED: Keep for backward compatibility
        "passage": stimulus_text or "",  # DEPRECATED: Keep for backward compatibility
        "choices": item.get("options", []),
        "correct_answer": item["correct_answer"],
        "solution": item.get("solution_text", ""),
        "solution_text": item.get("solution_text", ""),
        "assets": assets,  # Include image URLs
        "is_spr": is_spr,  # Student-Produced Response flag
        "domain": domain,  # Math or Reading and Writing
        "category": category,  # Skill category
        "skill_tag": item.get("skill_tag", ""),
        "skill": item.get("skill_tag", ""),
        "difficulty_level": (
            1 if str(variables.get("difficulty") or variables.get("difficulty_level") or "").upper() in ["E", "EASY"] else
            2 if str(variables.get("difficulty") or variables.get("difficulty_level") or "").upper() in ["M", "MEDIUM"] else
            3 if str(variables.get("difficulty") or variables.get("difficulty_level") or "").upper() in ["H", "HARD"] else
            2  # Default to Medium
        ),
        "metadata": {
            "skill_tag": item.get("skill_tag"),
            "difficulty": variables.get("difficulty") or 
                         variables.get("difficulty_level") or 2,
        }
    }


def build_exam_packet(
    items: List[Dict[str, Any]],
    user_id: str,
    base_url: str = ""
) -> Dict[str, Any]:
    """Build ExamPacket from selected items."""
    # Convert items to QuestionContent format
    content_bank: Dict[str, Dict[str, Any]] = {}
    question_order: List[str] = []
    
    for item in items:
        question_id = f"daily-{item['id']}"
        content_bank[question_id] = item_to_question_content(item, base_url)
        question_order.append(question_id)
    
    # Create a single module for the daily test
    module = {
        "id": "daily_module",
        "type": "fixed",
        "question_order": question_order,
    }
    
    return {
        "exam_id": f"daily-test-{user_id}-{int(datetime.now().timestamp())}",
        "config": {
            "total_time": 850,  # ~85 seconds per question (avg of 75s RW + 95s Math) for 10 questions
            "allowed_tools": ["calculator"],
        },
        "routing_logic": {
            "module_1_threshold": 0,  # Not applicable for daily tests
        },
        "modules": [module],
        "content_bank": content_bank,
    }


async def generate_daily_test(
    db: AsyncSession,
    user_id: str,
    tenant_id: str = "public",
    domain: Optional[str] = None
) -> Dict[str, Any]:
    """
    Generate a 10-question Daily Test packet.
    
    Composition:
    - Bucket A (6 questions): Top 3 struggling concepts, 2 questions each
    - Bucket B (2 questions): Misconception traps
    - Bucket C (2 questions): Maintenance review (lower priority)
    
    Excludes questions from diagnostics, full-length, and previous daily tests.
    """
    try:
        # 0. Get item IDs the user has already seen (diagnostics, full-length, daily)
        exclude_ids = await get_seen_item_ids(db, user_id, tenant_id)
        
        # 1. Fetch student profile
        profile = await get_student_profile(db, user_id, tenant_id)
        
        if not profile:
            # New user: return random mix (filtered by domain, excluding seen)
            print(f"[DailyTestService] No profile found for user {user_id}, generating random test")
            random_items = await get_random_items(db, 10, tenant_id, domain=domain, exclude_item_ids=exclude_ids)
            return build_exam_packet(random_items, user_id)
        
        # 2. Get concepts for review (sorted by priority)
        review_concepts = get_concepts_for_review(profile)
        
        selected_items: List[Dict[str, Any]] = []
        existing_ids = set(exclude_ids)
        
        # 3. Bucket A: Top 3 concepts, 2 questions each (6 questions)
        if review_concepts:
            top3_concepts = review_concepts[:3]
            
            for review_concept in top3_concepts:
                concept_id = review_concept.get("conceptId")
                if not concept_id:
                    continue
                
                items = await get_items_for_concept(db, concept_id, "Hard", 2, tenant_id, domain=domain, exclude_item_ids=existing_ids)
                if not items:
                    items = await get_items_for_concept(db, concept_id, "Medium", 2, tenant_id, domain=domain, exclude_item_ids=existing_ids)
                
                for item in items:
                    existing_ids.add(item["id"])
                selected_items.extend(items)
        
        # 4. Bucket B: Misconception traps (2 questions)
        recent_misconceptions = await get_recent_misconceptions(db, user_id, tenant_id, 5)
        if recent_misconceptions:
            misconception_ids = [m["misconception_id"] for m in recent_misconceptions]
            trap_items = await get_items_for_misconceptions(db, misconception_ids, 2, tenant_id, domain=domain, exclude_item_ids=existing_ids)
            for item in trap_items:
                existing_ids.add(item["id"])
            selected_items.extend(trap_items)
        
        # 5. Bucket C: Maintenance review (2 questions, priority < 0.3)
        maintenance_concepts = [c for c in review_concepts if c.get("priority", 1.0) < 0.3]
        if maintenance_concepts:
            for concept in maintenance_concepts[:2]:
                concept_id = concept.get("conceptId")
                if not concept_id:
                    continue
                
                items = await get_items_for_concept(db, concept_id, "Hard", 1, tenant_id, domain=domain, exclude_item_ids=existing_ids)
                if items:
                    for item in items:
                        existing_ids.add(item["id"])
                    selected_items.extend(items)
        
        # 6. Fallback: If we don't have 10 questions, fill with random items
        if len(selected_items) < 10:
            needed = 10 - len(selected_items)
            random_items = await get_random_items(db, needed * 2, tenant_id, domain=domain, exclude_item_ids=existing_ids)
            selected_items.extend(random_items[:needed])
        
        # 7. Build and return ExamPacket
        return build_exam_packet(selected_items[:10], user_id)
        
    except Exception as e:
        print(f"[DailyTestService] Error generating daily test: {e}")
        import traceback
        traceback.print_exc()
        # Fallback to random items on error
        exclude_ids = await get_seen_item_ids(db, user_id, tenant_id)
        random_items = await get_random_items(db, 10, tenant_id, domain=domain, exclude_item_ids=exclude_ids)
        return build_exam_packet(random_items, user_id)
