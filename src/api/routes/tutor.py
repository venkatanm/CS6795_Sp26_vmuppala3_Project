"""
Tutor API routes for study plan generation.
"""
from fastapi import APIRouter, Depends, Request, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from src.db.session import get_db
from src.services.tutor import generate_study_plan

router = APIRouter()


@router.get("/study-plan/{session_id}")
async def get_study_plan(
    session_id: str,
    request: Request,
    db: AsyncSession = Depends(get_db)
):
    """
    Get a personalized study plan for a completed session.
    
    Analyzes wrong answers and provides recommendations based on skill_tag weaknesses.
    Only includes tags with >= 1 mistake.
    
    Returns:
        List of recommendation objects with format:
        [
            {
                "topic": "Algebra",
                "mistakes": 2,
                "message": "Review Linear Equations"
            },
            ...
        ]
        Or [{"message": "Great job! No specific weaknesses found."}] if no mistakes.
    """
    try:
        recommendations = await generate_study_plan(session_id, db)
        return recommendations
    except HTTPException:
        # Re-raise HTTP exceptions (404, 400, etc.)
        raise
    except Exception as e:
        # Handle any other unexpected errors
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Error generating study plan: {str(e)}"
        )
