"""
Student API routes for daily practice and student-specific features.
"""
from datetime import date
from uuid import UUID
from fastapi import APIRouter, Depends, Request, HTTPException, status, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, text
from src.db.session import get_db
from src.core.redis import get_redis
from src.db.models import ExamDefinition, Session
from src.services.session import SessionManager
from src.services.daily_test_service import generate_daily_test, get_student_profile, get_concepts_for_review

router = APIRouter()


@router.post("/daily-practice")
async def start_daily_practice(
    request: Request,
    db: AsyncSession = Depends(get_db),
    redis=Depends(get_redis),
    domain: str | None = Query(None, description="Math or RW for domain-specific daily test")
):
    """
    Start a daily practice session with personalized questions.
    
    Generates a personalized 10-question daily test based on:
    - Student's review queue (spaced repetition)
    - Recent misconceptions
    - Maintenance review concepts
    
    Returns the exam packet and session_id for navigation.
    """
    user_id = request.headers.get("X-User-ID")
    if not user_id:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="X-User-ID header is required"
        )
    
    try:
        tenant_id = request.headers.get("X-Tenant-ID", "public")
        
        # Generate personalized daily test packet (per-user, never reuse)
        domain_label = "Math" if domain == "Math" else ("RW" if domain == "RW" else None)
        print(f"[Daily Practice] Generating personalized daily test for user {user_id} domain={domain or 'mixed'}")
        exam_packet = await generate_daily_test(db, user_id, tenant_id, domain=domain)
        
        # Always create a new exam definition per user (fixes rendering + ensures correct questions)
        import uuid
        exam_uuid = uuid.uuid4()
        today = date.today().isoformat()
        title = f"Daily {domain_label} - {today}" if domain_label else f"Daily Practice - {today}"
        
        from src.schemas.exam import Container, ItemRef
        question_order = exam_packet.get("modules", [{}])[0].get("question_order", [])
        exam_structure = Container(
            id=str(exam_uuid),
            type="test",
            flow_strategy="linear",
            children=[
                Container(
                    id="daily_module",
                    type="module",
                    flow_strategy="linear",
                    items=[
                        ItemRef(item_id=qid, points=1.0)
                        for qid in question_order
                    ],
                    metadata={"time_limit": 850}
                )
            ],
            metadata={
                "title": title,
                "duration_seconds": 850
            }
        )
        
        exam = ExamDefinition(
            id=exam_uuid,
            tenant_id=tenant_id,
            title=title,
            structure=exam_structure.model_dump(),
            is_active=True
        )
        db.add(exam)
        await db.flush()
        
        # Create session (SessionManager sets current_module_id from structure)
        session_manager = SessionManager(redis, db)
        session_id = await session_manager.create_session(
            exam.id,
            user_id,
            tenant_id
        )
        
        # Commit all changes
        await db.commit()
        
        return {
            "session_id": str(session_id),
            "exam_id": str(exam.id),
            "exam_packet": exam_packet,  # Return the personalized exam packet
            "message": "Daily practice session started"
        }
        
    except HTTPException:
        raise
    except Exception as e:
        import traceback
        error_trace = traceback.format_exc()
        print(f"[Daily Practice] Error: {str(e)}")
        print(f"[Daily Practice] Traceback: {error_trace}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to start daily practice: {str(e)}"
        )


@router.get("/recommendations")
async def get_study_recommendations(
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    """
    Get personalized study recommendations for the dashboard.

    Returns top concepts to study today based on student profile,
    plus performance summary if diagnostics are complete.
    """
    user_id = request.headers.get("X-User-ID")
    if not user_id:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="X-User-ID header is required"
        )

    tenant_id = request.headers.get("X-Tenant-ID", "public")

    try:
        profile = await get_student_profile(db, user_id, tenant_id)

        if not profile:
            return {
                "has_profile": False,
                "top_concepts": [],
                "message": "Complete a diagnostic to get personalized recommendations",
                "daily_focus": None,
            }

        review_concepts = get_concepts_for_review(profile)
        mastery = profile.get("concept_mastery") or {}

        # Build top 5 weak concepts to study
        top_concepts = []
        for concept in review_concepts[:5]:
            concept_name = concept.get("conceptId") or concept.get("concept")
            if not concept_name:
                continue
            mastery_data = mastery.get(concept_name, {})
            total = mastery_data.get("total", 0)
            correct = mastery_data.get("correct", 0)
            accuracy = round(correct / total * 100) if total > 0 else 0
            top_concepts.append({
                "concept": concept_name,
                "accuracy": accuracy,
                "total_questions": total,
                "priority": concept.get("priority", 0),
            })

        # Sort by accuracy ascending (weakest first)
        top_concepts.sort(key=lambda x: x["accuracy"])

        daily_focus = profile.get("next_session_focus")
        if not daily_focus and top_concepts:
            daily_focus = top_concepts[0]["concept"]

        return {
            "has_profile": True,
            "top_concepts": top_concepts,
            "daily_focus": daily_focus,
            "message": f"Focus on {daily_focus} today" if daily_focus else "Start a diagnostic to personalize your study plan",
            "total_sessions": profile.get("total_sessions", 0),
        }

    except Exception as e:
        print(f"[Recommendations] Error: {e}")
        return {
            "has_profile": False,
            "top_concepts": [],
            "message": "Unable to load recommendations",
            "daily_focus": None,
        }
