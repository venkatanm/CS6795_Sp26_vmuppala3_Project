"""
Sync API Routes

Handles offline-to-online reconciliation by syncing local exam responses
to the server and recalculating student progress.
"""
import json
from typing import List, Dict, Any, Optional
from uuid import UUID
from fastapi import APIRouter, Depends, Request, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from pydantic import BaseModel
from src.db.session import get_db
from src.core.redis import get_redis
from src.services.session import SessionManager
from src.db.models import Session, Item, ExamDefinition
from src.core.scoring import EloScorer
from src.core.engine import NavigationEngine
from src.schemas.exam import Container
from src.api.routes.exam_sessions import (
    _upsert_student_profile_from_responses,
    _upsert_student_profile_from_performance,
)

router = APIRouter(prefix="", tags=["sync"])  # Explicitly set no prefix - prefix is added in main.py


class SyncResponseItem(BaseModel):
    """Individual response in sync payload"""
    questionId: str
    selectedOptionId: str | int | None
    timeSpent: float
    timestamp: int  # Unix epoch in milliseconds


class SyncPayload(BaseModel):
    """Sync request payload"""
    sessionId: str
    examId: str
    responses: List[SyncResponseItem]
    status: Optional[str] = None  # Session status (e.g., "completed")
    finalScore: Optional[float] = None  # Final SAT section score (200-800)
    performanceProfile: Optional[Dict[str, Any]] = None  # Category performance breakdown
    currentModuleId: Optional[str] = None  # Current module ID
    currentQuestionIndex: Optional[int] = None  # Current question index


class ProgressInfo(BaseModel):
    """Progress information for a module"""
    moduleId: str
    questionsAnswered: int
    totalQuestions: int


class SessionStateResponse(BaseModel):
    """Updated session state after sync"""
    currentModuleId: Optional[str] = None
    currentQuestionIndex: Optional[int] = None
    status: str  # "active", "completed", "paused"
    studentTheta: Optional[float] = None
    progress: Optional[ProgressInfo] = None


class SyncResponse(BaseModel):
    """Sync response"""
    success: bool
    sessionState: Optional[SessionStateResponse] = None
    message: Optional[str] = None


@router.post("", response_model=SyncResponse)  # Root path - combined with prefix "/api/sync" in main.py to create "/api/sync"
async def sync_exam_data(
    payload: SyncPayload,
    request: Request,
    db: AsyncSession = Depends(get_db),
    redis = Depends(get_redis)
):
    """
    Sync offline exam responses to the server.
    
    This endpoint:
    1. Upserts all responses into the session's response_history
    2. Recalculates student progress and ELO score
    3. Updates session state based on responses
    4. Returns the updated session state
    
    Local-First Conflict Resolution:
    - Client responses take precedence (Last-Write-Wins)
    - Responses are upserted by (session_id, question_id)
    - Most recent timestamp wins if duplicate
    - Server recalculates progress from all responses
    """
    print(f"[Sync Backend]  Route handler called - POST /api/sync")
    print(f"[Sync Backend]   - Request URL: {request.url}")
    print(f"[Sync Backend]   - Request method: {request.method}")
    print(f"[Sync Backend]   - Headers: {dict(request.headers)}")
    
    print(f"[Sync Backend]  Received sync request for session {payload.sessionId}")
    print(f"[Sync Backend]   - Exam ID: {payload.examId}")
    print(f"[Sync Backend]   - Response count: {len(payload.responses)}")
    print(f"[Sync Backend]   - Status: {payload.status}")
    print(f"[Sync Backend]   - Final score: {payload.finalScore}")
    print(f"[Sync Backend]   - Current module ID: {payload.currentModuleId}")
    print(f"[Sync Backend]   - Current question index: {payload.currentQuestionIndex}")
    
    tenant_id = request.headers.get("X-Tenant-ID", "public")
    user_id = request.headers.get("X-User-ID")
    
    print(f"[Sync Backend]  Authentication check:")
    print(f"[Sync Backend]   - User ID from header: {user_id}")
    print(f"[Sync Backend]   - Tenant ID from header: {tenant_id}")
    
    if not user_id:
        print("[Sync Backend]  Missing X-User-ID header")
        print("[Sync Backend]   - All headers:", dict(request.headers))
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="X-User-ID header is required"
        )
    
    print(f"[Sync Backend]  Authentication passed")
    print(f"[Sync Backend]   - User ID: {user_id}")
    print(f"[Sync Backend]   - Tenant ID: {tenant_id}")

    try:
        # Convert session_id to UUID
        session_uuid = UUID(payload.sessionId)
        exam_uuid = UUID(payload.examId)
    except ValueError as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Invalid UUID format: {e}"
        )

    # Step 1: Verify session exists and belongs to user, or create it if it doesn't exist
    session_stmt = select(Session).where(
        Session.id == session_uuid,
        Session.user_id == user_id,
        Session.tenant_id == tenant_id
    )
    result = await db.execute(session_stmt)
    session = result.scalar_one_or_none()

    if not session:
        # Session doesn't exist - create it
        print(f"[Sync Backend]  Session {payload.sessionId} not found, creating new session for user {user_id}")
        print(f"[Sync Backend]   - Session UUID: {session_uuid}")
        print(f"[Sync Backend]   - Exam UUID: {exam_uuid}")
        print(f"[Sync Backend]   - Tenant ID: {tenant_id}")
        try:
            session = Session(
                id=session_uuid,
                user_id=user_id,
                exam_id=exam_uuid,
                tenant_id=tenant_id,
                status="active",
                student_theta=1200.0  # Default starting theta
            )
            db.add(session)
            await db.flush()  # Flush to get the session in the database before continuing
            print(f"[Sync Backend]  Created new session {session.id} in database")
        except Exception as create_error:
            print(f"[Sync Backend]  Error creating session: {create_error}")
            print(f"[Sync Backend]   - Error type: {type(create_error).__name__}")
            import traceback
            print(f"[Sync Backend]   - Traceback: {traceback.format_exc()}")
            raise

    # Step 2: Get exam structure to understand modules and questions
    # Note: For diagnostic exams, the exam might not exist in the database yet
    # In that case, we'll skip exam structure validation and work with what we have
    exam_stmt = select(ExamDefinition).where(
        ExamDefinition.id == exam_uuid,
        ExamDefinition.tenant_id == tenant_id
    )
    exam_result = await db.execute(exam_stmt)
    exam = exam_result.scalar_one_or_none()

    exam_structure = {}
    if not exam:
        print(f"[Sync] Warning: Exam {payload.examId} not found in database - proceeding without exam structure validation")
        # Don't fail - allow sync to proceed without exam structure
        # This is needed for diagnostic exams that might not be in the database
    else:
        exam_structure = exam.structure or {}

    if exam and not isinstance(exam_structure, dict):
        print(f"[Sync] Warning: Invalid exam structure format - proceeding without structure validation")
        exam_structure = {}

    # Step 3: Get existing response history or initialize
    response_history = session.response_history or []
    if not isinstance(response_history, list):
        response_history = []

    # Step 4: Upsert responses (Last-Write-Wins strategy)
    # Create a map of existing responses by item_id for quick lookup
    existing_responses_map: Dict[str, Dict[str, Any]] = {
        r.get("item_id"): r for r in response_history if isinstance(r, dict) and r.get("item_id")
    }

    # Process new responses
    print(f"[Sync] Processing {len(payload.responses)} responses")
    for response in payload.responses:
        item_id = response.questionId
        
        # Get item to check correctness
        # Note: For diagnostic exams, items might not exist in database
        # In that case, we'll store the response but can't validate correctness
        item_stmt = select(Item).where(
            Item.logical_id == item_id,
            Item.tenant_id == tenant_id
        )
        item_result = await db.execute(item_stmt)
        item = item_result.scalar_one_or_none()

        # Determine if answer is correct
        is_correct = False
        if item:
            selected_val = response.selectedOptionId
            correct_val = item.correct_answer
            if selected_val is not None and correct_val is not None:
                sel_str = str(selected_val).strip().replace("°", "").replace("'", "").replace('"', "").replace(" ", "")
                cor_str = str(correct_val).strip().replace("°", "").replace("'", "").replace('"', "").replace(" ", "")
                try:
                    sel_f = float(sel_str)
                    cor_f = float(cor_str)
                    is_correct = abs(sel_f - cor_f) < 0.01
                except (ValueError, TypeError):
                    is_correct = sel_str.upper() == cor_str.upper()
        else:
            # Item not found in database - this is OK for diagnostic exams
            # We'll store the response but mark correctness as unknown
            print(f"[Sync] Warning: Item {item_id} not found in database - storing response without correctness validation")

        # Create response record
        response_record = {
            "item_id": item_id,
            "selected_option_id": response.selectedOptionId,
            "time_spent": response.timeSpent,
            "timestamp": response.timestamp,
            "is_correct": is_correct,
        }

        # Upsert: If response exists, update it (Last-Write-Wins by timestamp)
        # If new, add it
        if item_id in existing_responses_map:
            existing_timestamp = existing_responses_map[item_id].get("timestamp", 0)
            if response.timestamp >= existing_timestamp:
                # Newer or equal timestamp, update
                existing_responses_map[item_id] = response_record
        else:
            # New response, add it
            existing_responses_map[item_id] = response_record

    # Convert map back to list
    updated_response_history = list(existing_responses_map.values())

    # Step 5: Recalculate student progress and ELO score
    session_manager = SessionManager(redis, db)
    elo_scorer = EloScorer()
    
    # Get current student theta
    current_theta = session.student_theta or 1200.0
    
    # Recalculate theta based on all responses
    for response in updated_response_history:
        item_id = response.get("item_id")
        if item_id:
            item_result = await db.execute(
                select(Item).where(Item.logical_id == item_id)
            )
            item_obj = item_result.scalar_one_or_none()
            if item_obj:
                # Use default difficulty if not set
                item_difficulty = getattr(item_obj, 'difficulty', 1200.0)
                is_correct = response.get("is_correct", False)
                current_theta = elo_scorer.update_rating(
                    current_theta,
                    item_difficulty,
                    is_correct
                )

    # Step 6: Determine current progress from exam structure
    # Parse exam structure to find modules and questions
    current_module_id = None
    current_question_index = None
    progress_info = None

    try:
        # Navigate through exam structure to determine progress
        navigation_engine = NavigationEngine(exam_structure)
        
        # Count answered questions per module
        answered_questions = {r.get("item_id") for r in updated_response_history}
        
        # Find which module the student is currently on
        # This is a simplified version - you may need to enhance based on your structure
        if isinstance(exam_structure, dict):
            children = exam_structure.get("children", [])
            for child in children:
                if isinstance(child, dict) and child.get("type") == "module":
                    module_id = child.get("id")
                    items = child.get("items", [])
                    module_answered = sum(
                        1 for item in items
                        if isinstance(item, dict) and item.get("item_id") in answered_questions
                    )
                    total = len(items)
                    
                    if module_answered < total:
                        current_module_id = module_id
                        current_question_index = module_answered
                        progress_info = ProgressInfo(
                            moduleId=module_id or "",
                            questionsAnswered=module_answered,
                            totalQuestions=total
                        )
                        break
    except Exception as e:
        print(f"Error calculating progress: {e}")
        # Continue without progress info

    # Step 7: Update session in database
    session.response_history = updated_response_history
    session.student_theta = current_theta

    # Update section-specific theta based on exam type
    DIAGNOSTIC_MATH_UUID = "550e8400-e29b-41d4-a716-446655440000"
    DIAGNOSTIC_RW_UUID = "550e8400-e29b-41d4-a716-446655440001"
    exam_id_str = str(payload.examId)
    if exam_id_str == DIAGNOSTIC_MATH_UUID:
        session.math_theta = current_theta
    elif exam_id_str == DIAGNOSTIC_RW_UUID:
        session.rw_theta = current_theta
    
    # Update status: Use provided status if available (especially for "completed" sessions)
    # Never downgrade status from a terminal/advanced state (MODULE_1_COMPLETE, completed)
    STATUS_PRIORITY = {"completed": 3, "MODULE_1_COMPLETE": 2, "active": 1, "NOT_STARTED": 0, "in_progress": 0}
    current_priority = STATUS_PRIORITY.get(session.status or "", 0)
    incoming_priority = STATUS_PRIORITY.get(payload.status or "", 0)
    if payload.status and incoming_priority >= current_priority:
        session.status = payload.status
    elif not payload.status:
        if current_priority < 1:
            session.status = "active"  # Keep active unless all modules completed
        
        # Check if exam is completed (all modules finished)
        # This is simplified - enhance based on your exam structure
        if progress_info and progress_info.questionsAnswered >= progress_info.totalQuestions:
            # Check if there are more modules
            # For now, mark as completed if we've answered all questions in the structure
            total_questions = sum(
                len(module.get("items", []))
                for module in (exam_structure.get("children", []) if isinstance(exam_structure, dict) else [])
                if isinstance(module, dict) and module.get("type") == "module"
            )
            if len(answered_questions) >= total_questions:
                session.status = "completed"
    
    # Update final score if provided (for completed sessions)
    if payload.finalScore is not None:
        session.section_score = payload.finalScore
    
    # Store performance profile in PostgreSQL
    if payload.performanceProfile:
        session.performance_profile = payload.performanceProfile
        print(f"[Sync]   - Performance profile: {len(payload.performanceProfile)} categories")
    
    # Update current module and question index in PostgreSQL if provided
    # Don't overwrite module_2 with module_1 (stale sync from frontend)
    if payload.currentModuleId is not None:
        current_mod = session.current_module_id or ""
        incoming_mod = payload.currentModuleId or ""
        is_downgrade = ("module_2" in current_mod and "module_1" in incoming_mod)
        if not is_downgrade:
            session.current_module_id = payload.currentModuleId
            print(f"[Sync]   - Current module ID: {payload.currentModuleId}")
        else:
            print(f"[Sync]   - Ignoring stale module_id downgrade: {incoming_mod} -> keeping {current_mod}")
    if payload.currentQuestionIndex is not None:
        session.current_question_index = payload.currentQuestionIndex
        print(f"[Sync]   - Current question index: {payload.currentQuestionIndex}")

    # Update student profile when session transitions to "completed"
    was_completed = (session.status == "completed")
    if was_completed and user_id:
        if payload.performanceProfile:
            # Prefer performance profile data when available (richer category breakdown)
            print(f"[Sync] Session completed — updating student profile from performanceProfile for user {user_id}")
            await _upsert_student_profile_from_performance(
                db=db,
                user_id=user_id,
                tenant_id=tenant_id,
                performance_profile=payload.performanceProfile,
            )
        elif updated_response_history:
            # Fall back to computing mastery from raw response_history
            print(f"[Sync] Session completed — updating student profile from response_history for user {user_id}")
            await _upsert_student_profile_from_responses(
                db=db,
                user_id=user_id,
                tenant_id=tenant_id,
                response_history=updated_response_history,
            )

    # Flush changes to database (transaction will auto-commit when get_db context exits)
    # Note: get_db uses session.begin() which auto-commits when the context manager exits
    # We use flush() to ensure changes are written but let the context manager handle commit
    try:
        print(f"[Sync]  Flushing session {session.id} to database...")
        print(f"[Sync]   - Status: {session.status}")
        print(f"[Sync]   - Response count: {len(updated_response_history)}")
        print(f"[Sync]   - Student theta: {session.student_theta}")
        print(f"[Sync]   - Section score: {session.section_score}")
        print(f"[Sync]   - Response history sample: {updated_response_history[:2] if updated_response_history else 'empty'}")
        
        # Flush to write changes to database (within the transaction)
        # The transaction will auto-commit when get_db context manager exits
        await db.flush()
        
        print(f"[Sync]  Successfully flushed session {session.id} to database")
        print(f"[Sync]   - Status: {session.status}")
        print(f"[Sync]   - Response history length: {len(updated_response_history)}")
    except Exception as flush_error:
        print(f"[Sync]  Error flushing to database: {flush_error}")
        import traceback
        print(f"[Sync] Traceback: {traceback.format_exc()}")
        # Don't try to rollback - let the context manager handle it
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to save session to database: {str(flush_error)}"
        )

    # Step 8: Return updated session state
    session_state = SessionStateResponse(
        currentModuleId=current_module_id,
        currentQuestionIndex=current_question_index,
        status=session.status,
        studentTheta=current_theta,
        progress=progress_info
    )

    return SyncResponse(
        success=True,
        sessionState=session_state,
        message=f"Successfully synced {len(updated_response_history)} responses"
    )
