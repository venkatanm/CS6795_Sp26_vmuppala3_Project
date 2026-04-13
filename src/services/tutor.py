"""
Tutor service for generating personalized study plans.
"""
from typing import List, Dict, Any
from uuid import UUID
from fastapi import HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from src.db.models import Session


async def generate_study_plan(session_id: str, db: AsyncSession) -> List[Dict[str, Any]]:
    """
    Generate a personalized study plan for a completed session.
    
    Analyzes wrong answers and provides recommendations based on skill_tag weaknesses.
    Only includes tags with >= 1 mistake.
    
    Args:
        session_id: The session ID to analyze
        db: Database session
        
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
        # Parse session_id to UUID
        try:
            session_uuid = UUID(session_id)
        except ValueError:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Invalid session ID format: {session_id}"
            )
        
        # Get session from database
        stmt = select(Session).where(Session.id == session_uuid)
        result = await db.execute(stmt)
        session = result.scalar_one_or_none()
        
        if not session:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Session not found: {session_id}"
            )
        
        # Check if session is completed
        if session.status != "completed":
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Study plan can only be generated for completed sessions. Current status: {session.status}"
            )
        
        # Analyze response_history for mistakes
        if not session.response_history:
            return [{"message": "Great job! No specific weaknesses found."}]
        
        # Count mistakes by skill_tag
        skill_tag_mistakes: Dict[str, int] = {}
        
        for response in session.response_history:
            if isinstance(response, dict):
                is_correct = response.get("is_correct", False)
                skill_tag = response.get("skill_tag")
                
                if not is_correct and skill_tag:
                    skill_tag_mistakes[skill_tag] = skill_tag_mistakes.get(skill_tag, 0) + 1
        
        # If no mistakes found
        if not skill_tag_mistakes:
            return [{"message": "Great job! No specific weaknesses found."}]
        
        # Generate recommendations
        recommendations = []
        for skill_tag, mistake_count in skill_tag_mistakes.items():
            # Format skill_tag as topic name (capitalize, replace underscores)
            topic = skill_tag.replace("_", " ").title()
            
            # Generate recommendation message
            if mistake_count == 1:
                message = f"Review {topic} - you missed 1 question in this area."
            else:
                message = f"Focus on {topic} - you missed {mistake_count} questions in this area."
            
            recommendations.append({
                "topic": topic,
                "mistakes": mistake_count,
                "message": message
            })
        
        # Sort by number of mistakes (descending)
        recommendations.sort(key=lambda x: x["mistakes"], reverse=True)
        
        return recommendations
        
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Error generating study plan: {str(e)}"
        )
