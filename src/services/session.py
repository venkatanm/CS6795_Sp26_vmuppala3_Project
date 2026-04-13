import json
import uuid
from datetime import datetime, timezone, timedelta
from typing import Dict, Optional, Any
from uuid import UUID

from fastapi import HTTPException, status
from redis.asyncio import Redis
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from src.db.models import ExamDefinition, Session
from sqlalchemy import desc


class SessionManager:
    """Manages exam session state in Redis with database validation."""
    
    def __init__(self, redis_client: Redis, db_session: AsyncSession):
        """
        Initialize SessionManager with Redis and database session.
        
        Args:
            redis_client: Async Redis client for session storage
            db_session: Async SQLAlchemy session for database queries
        """
        self.redis = redis_client
        self.db = db_session
    
    async def get_student_current_ability(self, user_id: str) -> float:
        """
        Get the student's current ability score from their most recent completed session.
        This creates a cumulative rating system where ability carries over across exams.
        
        Args:
            user_id: User identifier
            
        Returns:
            Current ability score (student_theta) from most recent completed session,
            or 1200.0 (default ELO starting point) if no previous sessions exist.
        """
        # Query for the most recent completed session for this user
        stmt = (
            select(Session.student_theta)
            .where(
                Session.user_id == user_id,
                Session.status == "completed",
                Session.student_theta.isnot(None)
            )
            .order_by(desc(Session.created_at))
            .limit(1)
        )
        
        result = await self.db.execute(stmt)
        most_recent_theta = result.scalar_one_or_none()
        
        # If no previous completed session exists, return default starting score
        if most_recent_theta is None:
            return 1200.0
        
        return float(most_recent_theta)
    
    async def create_session(self, exam_id: UUID, user_id: str, tenant_id: str = "public") -> str:
        """
        Create a new exam session with cumulative ability scoring.
        
        The student's starting ability score is based on their most recent completed exam,
        creating a progressive rating system that reflects overall skill development.
        
        Args:
            exam_id: UUID of the exam definition
            user_id: User identifier
            tenant_id: Tenant identifier (default: "public")
            
        Returns:
            session_id: UUID string of the created session
            
        Raises:
            HTTPException: 404 if exam not found
        """
        # Fetch ExamDefinition from Postgres by ID
        result = await self.db.execute(
            select(ExamDefinition).where(ExamDefinition.id == exam_id)
        )
        exam = result.scalar_one_or_none()
        
        if exam is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Exam with id {exam_id} not found"
            )
        
        # Generate session_id (UUID)
        session_id = str(uuid.uuid4())
        
        # Get the first child's ID from the exam structure
        structure = exam.structure
        current_node_id = None
        
        # Navigate to the first child in the structure
        if isinstance(structure, dict):
            # If structure has children, get the first child's ID
            children = structure.get("children", [])
            if isinstance(children, list) and len(children) > 0:
                first_child = children[0]
                if isinstance(first_child, dict):
                    current_node_id = first_child.get("id")
            # If no children but structure itself has an id, use that as fallback
            if current_node_id is None and "id" in structure:
                current_node_id = structure["id"]
        
        # Get duration_seconds from exam structure metadata or default to 3600
        duration_seconds = 3600  # Default
        if isinstance(structure, dict):
            # Check if duration is in the root container's metadata
            metadata = structure.get("metadata", {})
            duration_seconds = metadata.get("duration_seconds", 3600)
        
        # Calculate expires_at = now() + duration_seconds
        now = datetime.now(timezone.utc)
        expires_at = now + timedelta(seconds=duration_seconds)
        
        # Get student's current ability score from previous exams (cumulative rating)
        initial_student_theta = await self.get_student_current_ability(user_id)
        
        # Create SessionState dictionary with initial ability score
        session_state: Dict[str, Any] = {
            "exam_id": str(exam_id),
            "user_id": user_id,
            "current_node_id": current_node_id,
            "start_time": now.isoformat(),
            "expires_at": expires_at.isoformat(),  # Store expiration time
            "status": "active",
            "student_theta": initial_student_theta  # Initialize with cumulative ability score
        }
        
        # Save to Redis as JSON string with 24-hour TTL
        redis_key = f"session:{session_id}"
        await self.redis.setex(
            redis_key,
            86400,  # 24 hours in seconds
            json.dumps(session_state)
        )
        
        # Also save to database (set current_module_id for daily tests / first module)
        db_session = Session(
            id=UUID(session_id),
            tenant_id=tenant_id,
            exam_id=exam_id,
            user_id=user_id,
            status="active",
            start_time=now,
            expires_at=expires_at,
            current_module_id=current_node_id
        )
        self.db.add(db_session)
        await self.db.flush()  # Flush to get the ID without committing
        
        return session_id
    
    async def get_session(self, session_id: str) -> Optional[Dict]:
        """
        Retrieve session state from Redis.
        
        Args:
            session_id: UUID string of the session
            
        Returns:
            Session state dictionary or None if not found
        """
        redis_key = f"session:{session_id}"
        session_data = await self.redis.get(redis_key)
        
        if session_data is None:
            return None
        
        # Parse JSON string back to dictionary
        return json.loads(session_data)
