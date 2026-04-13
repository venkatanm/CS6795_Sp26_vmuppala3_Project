from fastapi import APIRouter, Depends, Query, Request, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, desc, text
from src.db.session import get_db
from src.db.models import Session
from src.core.config import settings

router = APIRouter()


def require_admin(request: Request) -> str:
    """Verify the request comes from an authorized admin user."""
    user_id = request.headers.get("X-User-ID")
    if not user_id:
        raise HTTPException(status_code=401, detail="Authentication required")

    allowed = [uid.strip() for uid in settings.ADMIN_USER_IDS.split(",") if uid.strip()]
    if not allowed:
        raise HTTPException(status_code=503, detail="Admin access not configured")
    if user_id not in allowed:
        raise HTTPException(status_code=403, detail="Admin privileges required")

    return user_id


@router.get("/admin/sessions")
async def list_sessions(
    request: Request,
    limit: int = Query(default=50, ge=1, le=100, description="Maximum number of sessions to return"),
    skip: int = Query(default=0, ge=0, description="Number of sessions to skip"),
    db: AsyncSession = Depends(get_db),
    _admin: str = Depends(require_admin),
):
    """
    List exam sessions with pagination.
    
    Returns a list of sessions ordered by created_at DESC.
    """
    # Query sessions with ordering and pagination
    stmt = (
        select(Session)
        .order_by(desc(Session.created_at))
        .limit(limit)
        .offset(skip)
    )
    
    result = await db.execute(stmt)
    sessions = result.scalars().all()
    
    # Format response
    session_list = []
    for session in sessions:
        # Calculate time_taken if end_time exists
        time_taken = None
        if session.end_time and session.start_time:
            delta = session.end_time - session.start_time
            time_taken = int(delta.total_seconds())  # Time in seconds
        
        session_list.append({
            "id": str(session.id),
            "user_id": session.user_id,
            "status": session.status,
            "score": session.student_theta,  # Final theta (ELO score)
            "created_at": session.created_at.isoformat() if session.created_at else None,
            "time_taken": time_taken  # Optional: seconds taken to complete
        })
    
    return session_list


@router.get("/admin/analytics")
async def get_analytics(
    request: Request,
    db: AsyncSession = Depends(get_db),
    _admin: str = Depends(require_admin),
):
    """
    Get analytics data including score distribution and hardest items.
    
    Returns:
    - score_distribution: Count of completed sessions by score ranges
    - hardest_items: Top 5 items with lowest pass rates
    """
    # Metric 1: Score Distribution
    # Query all completed sessions and bucket final_theta scores
    completed_sessions_stmt = (
        select(Session.student_theta)
        .where(Session.status == "completed")
        .where(Session.student_theta.isnot(None))
    )
    
    result = await db.execute(completed_sessions_stmt)
    sessions = result.scalars().all()
    
    # Bucket the scores
    score_buckets = {
        "<800": 0,
        "800-1000": 0,
        "1000-1200": 0,
        ">1200": 0
    }
    
    for theta in sessions:
        if theta < 800:
            score_buckets["<800"] += 1
        elif theta < 1000:
            score_buckets["800-1000"] += 1
        elif theta <= 1200:
            score_buckets["1000-1200"] += 1
        else:
            score_buckets[">1200"] += 1
    
    score_distribution = [
        {"range": range_name, "count": count}
        for range_name, count in score_buckets.items()
    ]
    
    # Metric 2: Hardest Items
    # Use PostgreSQL JSONB functions to extract and aggregate response_history
    # Query to unnest response_history and calculate pass rates
    # This uses PostgreSQL's jsonb_array_elements to expand the array
    hardest_items_query = text("""
        WITH response_data AS (
            SELECT 
                session.id as session_id,
                jsonb_array_elements(session.response_history) as response
            FROM sessions session
            WHERE session.status = 'completed'
                AND session.response_history IS NOT NULL
                AND jsonb_array_length(session.response_history) > 0
        ),
        item_stats AS (
            SELECT 
                (response->>'item_id')::uuid as item_id,
                COUNT(*) as total_attempts,
                SUM(CASE WHEN (response->>'is_correct')::boolean = true THEN 1 ELSE 0 END) as correct_count,
                CAST(SUM(CASE WHEN (response->>'is_correct')::boolean = true THEN 1 ELSE 0 END) AS FLOAT) / COUNT(*) as pass_rate
            FROM response_data
            WHERE response->>'item_id' IS NOT NULL
            GROUP BY (response->>'item_id')::uuid
            HAVING COUNT(*) > 0
        )
        SELECT 
            item_stats.item_id,
            item_stats.total_attempts,
            item_stats.correct_count,
            item_stats.pass_rate,
            LEFT(items.question_text, 100) as question_text_snippet
        FROM item_stats
        JOIN items items ON items.id = item_stats.item_id
        ORDER BY item_stats.pass_rate ASC
        LIMIT 5
    """)
    
    result = await db.execute(hardest_items_query)
    rows = result.fetchall()
    
    hardest_items = []
    for row in rows:
        hardest_items.append({
            "item_id": str(row[0]),
            "total_attempts": row[1],
            "correct_count": row[2],
            "pass_rate": float(row[3]),
            "question_text_snippet": row[4] if row[4] else ""
        })
    
    return {
        "score_distribution": score_distribution,
        "hardest_items": hardest_items
    }
