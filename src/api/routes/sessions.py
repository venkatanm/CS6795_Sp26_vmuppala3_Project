"""
Session API routes for creating and managing exam sessions.
"""
import json
import json
from uuid import UUID
from fastapi import APIRouter, Depends, Request, HTTPException, status, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from pydantic import BaseModel
from src.db.session import get_db
from src.core.redis import get_redis
from src.db.models import Session, ExamDefinition, Item
from src.services.session import SessionManager
from src.services.tutor import generate_study_plan

router = APIRouter()


class CreateSessionRequest(BaseModel):
    """Request to create a new exam session."""
    exam_id: str
    user_id: str


@router.post("", status_code=status.HTTP_201_CREATED)
async def create_session(
    payload: CreateSessionRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
    redis = Depends(get_redis)
):
    """
    Create a new exam session.
    
    Args:
        payload: Contains exam_id and user_id
        request: FastAPI request object (for headers)
        db: Database session
        redis: Redis client
        
    Returns:
        session_id: UUID string of the created session
    """
    try:
        # Get tenant_id from headers or use default
        tenant_id = request.headers.get("X-Tenant-ID", "public")
        
        # Use user_id from payload or header
        user_id = payload.user_id or request.headers.get("X-User-ID")
        if not user_id:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="user_id is required in request body or X-User-ID header"
            )
        
        # Parse exam_id to UUID
        try:
            exam_uuid = UUID(payload.exam_id)
        except ValueError:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Invalid exam_id format: {payload.exam_id}"
            )
        
        # Create session using SessionManager
        session_manager = SessionManager(redis, db)
        session_id = await session_manager.create_session(
            exam_uuid,
            user_id,
            tenant_id
        )
        
        # Commit the session creation
        await db.commit()
        
        return {
            "session_id": str(session_id),
            "exam_id": payload.exam_id,
            "user_id": user_id,
            "message": "Session created successfully"
        }
        
    except HTTPException:
        raise
    except Exception as e:
        import traceback
        error_trace = traceback.format_exc()
        print(f"[Create Session] Error: {str(e)}")
        print(f"[Create Session] Traceback: {error_trace}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to create session: {str(e)}"
        )


@router.get("")
async def list_user_sessions(
    request: Request,
    user_id: str = Query(None, description="User ID to filter sessions (optional, uses X-User-ID header if not provided)"),
    db: AsyncSession = Depends(get_db),
    redis = Depends(get_redis)
):
    """
    List all sessions for the authenticated user.
    
    Args:
        request: FastAPI request object (for headers)
        user_id: Optional user_id query parameter (if not provided, uses X-User-ID header)
        db: Database session
        redis: Redis client
        
    Returns:
        List of session objects with basic info
    """
    try:
        # Get user_id from query parameter or header
        user_id = user_id or request.headers.get("X-User-ID")
        if not user_id:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="user_id is required in query parameter or X-User-ID header"
            )
        
        # Query all sessions for this user from database
        result = await db.execute(
            select(Session).where(Session.user_id == user_id).order_by(Session.created_at.desc())
        )
        db_sessions = result.scalars().all()
        
        print(f"[List User Sessions] Found {len(db_sessions)} sessions for user_id: {user_id}")
        for db_session in db_sessions:
            print(f"  - Session {db_session.id}: status={db_session.status}, section_score={db_session.section_score}")
        
        # Format response
        session_list = []
        session_manager = SessionManager(redis, db)
        
        for db_session in db_sessions:
            # Get Redis session data if available
            redis_session = await session_manager.get_session(str(db_session.id))
            
            # Also check Redis metadata key for performance_profile (stored separately)
            performance_profile = None
            metadata_key = f"session:{db_session.id}:metadata"
            try:
                metadata_raw = await redis.hget(metadata_key, "performance_profile")
                if metadata_raw:
                    import json
                    performance_profile = json.loads(metadata_raw)
            except Exception as e:
                print(f"[List User Sessions] Error reading performance_profile from Redis: {e}")
            
            # Merge database and Redis data
            session_data = {
                "id": str(db_session.id),
                "exam_id": str(db_session.exam_id) if db_session.exam_id else None,
                "user_id": db_session.user_id,
                "status": db_session.status,
                "section_score": db_session.section_score,  # Final SAT score (200-800)
                "student_theta": db_session.student_theta,  # IRT theta
                "performance_profile": db_session.performance_profile or performance_profile,  # From PostgreSQL, fallback to Redis
                "current_module_id": db_session.current_module_id,  # From PostgreSQL
                "current_question_index": db_session.current_question_index,  # From PostgreSQL
                "created_at": db_session.created_at.isoformat() if db_session.created_at else None,
                "updated_at": db_session.updated_at.isoformat() if db_session.updated_at else None,
            }
            
            # Add Redis session data if available (for backward compatibility)
            if redis_session:
                # Only use Redis data if PostgreSQL doesn't have it
                if not session_data.get("current_module_id"):
                    session_data["current_module_id"] = redis_session.get("current_module_id")
                if session_data.get("current_question_index") is None:
                    session_data["current_question_index"] = redis_session.get("current_question_index", 0)
                if not session_data.get("response_history"):
                    session_data["response_history"] = redis_session.get("response_history", [])
            
            session_list.append(session_data)
        
        return session_list
        
    except HTTPException:
        raise
    except Exception as e:
        import traceback
        print(f"[List User Sessions] Error: {e}")
        print(traceback.format_exc())
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to list user sessions: {str(e)}"
        )


@router.patch("/{session_id}/status")
async def update_session_status(
    session_id: str,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    """
    Update the status of a session (e.g., mark as completed).
    Used by E2E tests to create completed sessions for Review flow testing.
    """
    try:
        body = await request.json()
        new_status = body.get("status")
        if not new_status:
            raise HTTPException(status_code=400, detail="status field required")

        try:
            session_uuid = UUID(session_id)
        except ValueError:
            raise HTTPException(status_code=400, detail=f"Invalid session_id: {session_id}")

        result = await db.execute(select(Session).where(Session.id == session_uuid))
        db_session = result.scalar_one_or_none()

        if not db_session:
            raise HTTPException(status_code=404, detail=f"Session {session_id} not found")

        db_session.status = new_status
        await db.commit()
        return {"id": session_id, "status": new_status}

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to update session status: {str(e)}")


@router.get("/{session_id}")
async def get_session(
    session_id: str,
    request: Request,
    db: AsyncSession = Depends(get_db),
    redis = Depends(get_redis)
):
    """
    Get session details by session ID.
    
    Returns session state from Redis and database.
    """
    try:
        # Parse session_id to UUID
        try:
            session_uuid = UUID(session_id)
        except ValueError:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Invalid session_id format: {session_id}"
            )
        
        # Get session from Redis (contains routing info and response history)
        session_manager = SessionManager(redis, db)
        redis_session = await session_manager.get_session(session_id)
        
        # Get session from database (contains section_score, student_theta, etc.)
        result = await db.execute(
            select(Session).where(Session.id == session_uuid)
        )
        db_session = result.scalar_one_or_none()
        
        if not db_session and not redis_session:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Session with id {session_id} not found"
            )
        
        # Merge Redis and database data
        session_data = {}
        
        # Start with Redis data (if available)
        if redis_session:
            session_data.update(redis_session)
        
        # Override/add database fields
        if db_session:
            session_data.update({
                "id": str(db_session.id),
                "exam_id": str(db_session.exam_id),
                "user_id": db_session.user_id,
                "status": db_session.status,
                "student_theta": db_session.student_theta,
                "section_score": db_session.section_score,
                "performance_profile": db_session.performance_profile,  # From PostgreSQL
                "current_module_id": db_session.current_module_id,  # From PostgreSQL
                "current_question_index": db_session.current_question_index,  # From PostgreSQL
                "start_time": db_session.start_time.isoformat() if db_session.start_time else None,
                "end_time": db_session.end_time.isoformat() if db_session.end_time else None,
                "created_at": db_session.created_at.isoformat() if db_session.created_at else None,
                "updated_at": db_session.updated_at.isoformat() if db_session.updated_at else None,
            })
            # Use database response_history if available, otherwise use Redis
            if db_session.response_history is not None:
                session_data["response_history"] = db_session.response_history
        
        return session_data
        
    except HTTPException:
        raise
    except Exception as e:
        import traceback
        error_trace = traceback.format_exc()
        print(f"[Get Session] Error: {str(e)}")
        print(f"[Get Session] Traceback: {error_trace}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to get session: {str(e)}"
        )


def _collect_module_item_ids(structure: dict, module_id: str) -> list:
    """Collect item_ids from a module in the exam structure."""
    module = _find_module_in_structure(structure, module_id)
    if not module:
        return []
    items = module.get("items", [])
    result = []
    for item in items:
        if isinstance(item, dict):
            result.append(item.get("item_id"))
        elif isinstance(item, str):
            result.append(item)
    return [x for x in result if x]


def _find_module_in_structure(structure: dict, module_id: str) -> dict | None:
    """Find a module by ID in the exam structure."""
    if not isinstance(structure, dict):
        return None
    if structure.get("id") == module_id:
        return structure
    for child in structure.get("children", []):
        found = _find_module_in_structure(child, module_id)
        if found:
            return found
    return None


def _find_module_1_id(structure: dict) -> str | None:
    """Find Module 1 ID in exam structure."""
    if not isinstance(structure, dict):
        return None
    for child in structure.get("children", []):
        if isinstance(child, dict) and "module_1" in (child.get("id") or "").lower():
            return child.get("id")
    for child in structure.get("children", []):
        if isinstance(child, dict) and child.get("type") == "module":
            return child.get("id")
    return None


@router.get("/{session_id}/review")
async def get_session_review(
    session_id: str,
    request: Request,
    db: AsyncSession = Depends(get_db),
    redis=Depends(get_redis),
):
    """
    Get review items for a completed session.
    
    Returns a list of ReviewItem objects (question, user answer, correct answer,
    AI explanation, etc.) for the split-screen review interface.
    """
    try:
        session_uuid = UUID(session_id)
    except ValueError:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Invalid session_id format: {session_id}",
        )

    result = await db.execute(select(Session).where(Session.id == session_uuid))
    db_session = result.scalar_one_or_none()

    session_manager = SessionManager(redis, db)
    redis_session = await session_manager.get_session(session_id)

    if not db_session:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Session {session_id} not found",
        )

    response_history = []
    if db_session.response_history:
        response_history = db_session.response_history
    elif redis_session:
        response_history = redis_session.get("response_history", [])

    if not isinstance(response_history, list):
        response_history = []

    response_map = {}
    for r in response_history:
        item_id = r.get("item_id") or r.get("questionId") or r.get("question_id")
        if item_id:
            response_map[str(item_id)] = r

    exam_result = await db.execute(
        select(ExamDefinition).where(ExamDefinition.id == db_session.exam_id)
    )
    exam = exam_result.scalar_one_or_none()
    if not exam:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Exam {db_session.exam_id} not found",
        )

    structure = exam.structure or {}
    if not isinstance(structure, dict):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Exam structure is empty",
        )

    module1_id = _find_module_1_id(structure)
    ordered_item_ids = []
    if module1_id:
        ordered_item_ids.extend(_collect_module_item_ids(structure, module1_id))

    module2_id = db_session.current_module_id
    if module2_id:
        ordered_item_ids.extend(_collect_module_item_ids(structure, module2_id))

    if not ordered_item_ids and response_map:
        ordered_item_ids = list(response_map.keys())

    tenant_id = request.headers.get("X-Tenant-ID", "public")
    review_items = []

    # Deduplicate item_ids (daily_module may appear as both module1 and module2)
    seen_item_ids = set()
    deduped_item_ids = []
    for iid in ordered_item_ids:
        if iid not in seen_item_ids:
            seen_item_ids.add(iid)
            deduped_item_ids.append(iid)
    ordered_item_ids = deduped_item_ids

    from sqlalchemy import or_
    for item_id in ordered_item_ids:
        resp = response_map.get(str(item_id))
        selected_option_id = resp.get("selected_option_id") if resp else None
        is_correct = resp.get("is_correct", False) if resp else False
        time_spent = resp.get("time_spent") if resp else None

        # Strip "daily-" prefix for DB lookup (daily test items stored without prefix)
        db_item_id = str(item_id)
        if db_item_id.startswith("daily-"):
            db_item_id = db_item_id[6:]

        try:
            is_uuid_fmt = len(db_item_id) == 36 and "-" in db_item_id
            if is_uuid_fmt:
                item_stmt = select(Item).where(
                    Item.tenant_id == tenant_id,
                    or_(Item.logical_id == db_item_id, Item.id == UUID(db_item_id)),
                )
            else:
                item_stmt = select(Item).where(
                    Item.tenant_id == tenant_id,
                    Item.logical_id == db_item_id,
                )
        except (ValueError, TypeError):
            item_stmt = select(Item).where(
                Item.tenant_id == tenant_id,
                Item.logical_id == db_item_id,
            )
        item_result = await db.execute(item_stmt)
        item_row = item_result.scalar_one_or_none()
        if not item_row:
            continue

        variables = item_row.variables or {}
        if isinstance(variables, str):
            try:
                variables = json.loads(variables)
            except Exception:
                variables = {}
        if not isinstance(variables, dict):
            variables = {}

        options_raw = item_row.options
        choice_keys = []
        choice_texts = []
        if isinstance(options_raw, dict):
            choice_keys = sorted(options_raw.keys())
            choice_texts = [str(options_raw.get(k, "")) for k in choice_keys]
        elif isinstance(options_raw, list):
            for i, opt in enumerate(options_raw):
                if isinstance(opt, dict):
                    choice_texts.append(opt.get("text", opt.get("content", opt.get("body", str(opt)))))
                    choice_keys.append(opt.get("id", chr(65 + i)))
                else:
                    choice_texts.append(str(opt))
                    choice_keys.append(chr(65 + i) if i < 4 else str(i))
        if not choice_texts and variables:
            answer_opts = variables.get("answerOptions") or variables.get("answer_options")
            if isinstance(answer_opts, list):
                for i, opt in enumerate(answer_opts):
                    if isinstance(opt, dict):
                        choice_texts.append(opt.get("content", opt.get("body", opt.get("text", ""))))
                        choice_keys.append(opt.get("id", chr(65 + i)))
                    else:
                        choice_texts.append(str(opt))
                        choice_keys.append(chr(65 + i) if i < 4 else str(i))

        question_type = variables.get("question_type", "")
        is_spr = (
            variables.get("is_spr")
            or variables.get("type") == "spr"
            or question_type in ["SPR Math", "SPR RW"]
            or (not choice_texts and variables.get("section") == "Math")
        )

        def _normalize_answer(val) -> str:
            if val is None:
                return ""
            s = str(val).strip()
            s = s.replace("°", "").replace("'", "").replace('"', "").replace(" ", "")
            try:
                f = float(s)
                if f == int(f):
                    return str(int(f))
                return str(f)
            except (ValueError, TypeError):
                return s.upper()

        correct_answer_val = str(item_row.correct_answer).strip()
        selected_val = str(selected_option_id).strip() if selected_option_id is not None else ""

        def _option_to_index(val: str, keys: list) -> int:
            """Resolve option value (A/B/C/D or 0/1/2/3) to 0-based index."""
            if not val or not keys:
                return 0
            s = str(val).strip().upper()
            for i, k in enumerate(keys):
                if str(k).upper() == s:
                    return i
            # Fallback: value may be 0-based index ("0","1","2","3")
            if s.isdigit() and 0 <= int(s) < len(keys):
                return int(s)
            # Fallback: keys may be numeric ("0","1","2","3"), value may be letter (A,B,C,D)
            if len(s) == 1 and s in "ABCD" and len(keys) >= ord(s) - ord("A") + 1:
                return ord(s) - ord("A")
            return 0

        correct_idx = 0
        user_idx = 0
        if choice_texts:
            correct_idx = _option_to_index(correct_answer_val, choice_keys)
            if selected_val:
                user_idx = _option_to_index(selected_val, choice_keys)

        is_correct = resp.get("is_correct", False) if resp else False
        if is_spr:
            is_correct = _normalize_answer(selected_val) == _normalize_answer(correct_answer_val)
        elif choice_texts and selected_val:
            is_correct = correct_idx == user_idx

        stimulus = (
            variables.get("stimulus")
            or variables.get("passageText")
            or variables.get("passage")
            or ""
        )
        # Determine domain from per-item question_type (most reliable), then section, then exam metadata
        q_type = str(variables.get("question_type", "") or "").upper()
        q_section = str(variables.get("section", "") or "").upper()
        exam_meta = structure.get("metadata", {}) or {}
        exam_type_str = str(exam_meta.get("exam_type", "") or "").upper()
        if "MATH" in q_type or q_section == "MATH" or "MATH" in exam_type_str:
            domain = "Math"
        else:
            domain = "Reading and Writing"

        options_for_display = choice_texts if choice_texts else []

        review_items.append({
            "item_id": item_row.logical_id or str(item_row.id),
            "question_text": item_row.question_text or "",
            "user_selected_id": user_idx,
            "correct_option_id": correct_idx,
            "is_correct": is_correct,
            "options": options_for_display,
            "is_spr": is_spr,
            "correct_answer": correct_answer_val,
            "user_answer": selected_val,
            "solution_text": item_row.solution_text,
            "skill_tag": item_row.skill_tag,
            "time_spent": time_spent,
            "ai_explanation": item_row.ai_explanation,
            "distractor_analysis": item_row.distractor_analysis,
            "hint_sequence": item_row.hint_sequence,
            "stimulus": stimulus,
            "domain": domain,
        })

    return review_items


@router.get("/{session_id}/study-plan")
async def get_session_study_plan(
    session_id: str,
    request: Request,
    db: AsyncSession = Depends(get_db)
):
    """
    Get a personalized study plan for a completed session.
    
    Analyzes wrong answers and provides recommendations based on skill_tag weaknesses.
    """
    try:
        # Parse session_id to UUID
        try:
            session_uuid = UUID(session_id)
        except ValueError:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Invalid session_id format: {session_id}"
            )
        
        # Use the generate_study_plan function from tutor service
        recommendations = await generate_study_plan(str(session_uuid), db)
        
        return recommendations
        
    except HTTPException:
        raise
    except Exception as e:
        import traceback
        error_trace = traceback.format_exc()
        print(f"[Get Study Plan] Error: {str(e)}")
        print(f"[Get Study Plan] Traceback: {error_trace}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to get study plan: {str(e)}"
        )


@router.get("/{session_id}/current-item")
async def get_current_item(
    session_id: str,
    request: Request,
    db: AsyncSession = Depends(get_db),
    redis = Depends(get_redis)
):
    """
    Get the current item/question for a session.
    
    Returns the current question the student should answer, or indicates if the test is complete.
    """
    try:
        # Parse session_id to UUID
        try:
            session_uuid = UUID(session_id)
        except ValueError:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Invalid session_id format: {session_id}"
            )
        
        # Get session state from Redis
        session_manager = SessionManager(redis, db)
        session_state = await session_manager.get_session(session_id)
        
        if not session_state:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Session with id {session_id} not found"
            )
        
        # Check if session is completed
        if session_state.get("status") == "completed":
            return {
                "status": "complete",
                "message": "Test is complete"
            }
        
        # Get exam structure
        exam_id = session_state.get("exam_id")
        if not exam_id:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Exam ID not found in session"
            )
        
        exam_result = await db.execute(
            select(ExamDefinition).where(ExamDefinition.id == UUID(exam_id))
        )
        exam = exam_result.scalar_one_or_none()
        
        if not exam:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Exam with id {exam_id} not found"
            )
        
        # Navigate exam structure to find current item
        structure = exam.structure
        current_item_id = None
        current_item_index = session_state.get("current_item_index", 0)
        
        # If we have items in the root structure, get the item at current_item_index
        if isinstance(structure, dict):
            items = structure.get("items", [])
            if isinstance(items, list) and len(items) > current_item_index:
                item_ref = items[current_item_index]
                if isinstance(item_ref, dict):
                    current_item_id = item_ref.get("item_id")
                elif isinstance(item_ref, str):
                    current_item_id = item_ref
            elif isinstance(items, list) and len(items) <= current_item_index:
                # All items answered, test is complete
                return {
                    "status": "complete",
                    "message": "All questions answered"
                }
        
        if not current_item_id:
            # Try to get from current_item_id in session state
            current_item_id = session_state.get("current_item_id")
        
        if not current_item_id:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Current item ID not found in session or exam structure"
            )
        
        # Fetch item from database
        item_result = await db.execute(
            select(Item).where(Item.id == UUID(current_item_id))
        )
        item = item_result.scalar_one_or_none()
        
        if not item:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Item with id {current_item_id} not found"
            )
        
        # Parse options (stored as JSONB)
        options = item.options
        if isinstance(options, list):
            # Options are already a list
            pass
        elif isinstance(options, str):
            # Options might be a JSON string
            import json
            options = json.loads(options)
        else:
            options = []
        
        # Get image URLs from variables if available
        image_urls = []
        if item.variables and isinstance(item.variables, dict):
            image_paths = item.variables.get("image_paths", [])
            if isinstance(image_paths, list):
                # Convert paths to URLs
                base_url = str(request.base_url).rstrip("/")
                for img_path in image_paths:
                    # Remove leading slash if present
                    img_path = img_path.lstrip("/")
                    image_urls.append(f"{base_url}/api/images/{img_path}")
        
        # Return item in format expected by frontend
        return {
            "id": str(item.id),
            "text": item.question_text,
            "options": options,
            "status": "active",
            "image_urls": image_urls  # Include image URLs
        }
        
    except HTTPException:
        raise
    except Exception as e:
        import traceback
        error_trace = traceback.format_exc()
        print(f"[Get Current Item] Error: {str(e)}")
        print(f"[Get Current Item] Traceback: {error_trace}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to get current item: {str(e)}"
        )
