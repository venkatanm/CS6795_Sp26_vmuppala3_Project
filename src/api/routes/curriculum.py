"""
Curriculum Graph API routes.

Provides endpoints for retrieving the curriculum knowledge graph
with student performance data.
"""
from typing import List, Dict, Any, Optional
from uuid import UUID
from fastapi import APIRouter, Depends, Request, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from pydantic import BaseModel

from src.db.session import get_db
from src.db.models import Domain, Skill, Item, Session

router = APIRouter()


class GraphNode(BaseModel):
    """Node in the curriculum graph."""
    id: str
    name: str
    type: str  # 'domain' or 'skill'
    color: str
    value: float  # Size/importance value
    accuracy: Optional[float] = None  # Only for skills
    total_attempts: Optional[int] = None  # Only for skills
    correct_attempts: Optional[int] = None  # Only for skills


class GraphLink(BaseModel):
    """Link in the curriculum graph (skill -> domain)."""
    source: str  # Skill ID
    target: str  # Domain ID


class CurriculumGraphResponse(BaseModel):
    """Response containing the curriculum graph."""
    nodes: List[GraphNode]
    links: List[GraphLink]


def get_skill_color(accuracy: Optional[float]) -> str:
    """
    Determine skill color based on accuracy.
    
    Args:
        accuracy: Accuracy percentage (0.0 to 1.0) or None if no attempts
        
    Returns:
        Hex color code
    """
    if accuracy is None:
        return "#4b5563"  # Gray - No attempts
    elif accuracy >= 0.85:
        return "#10b981"  # Green - High mastery
    elif accuracy >= 0.50:
        return "#f59e0b"  # Yellow - Moderate mastery
    elif accuracy > 0:
        return "#ef4444"  # Red - Low mastery
    else:
        return "#4b5563"  # Gray - No correct answers


@router.get("/graph", response_model=CurriculumGraphResponse)
async def get_curriculum_graph(
    request: Request,
    db: AsyncSession = Depends(get_db)
):
    """
    Get the curriculum knowledge graph with student performance data.
    
    Returns:
        Curriculum graph with nodes (domains and skills) and links (skill -> domain)
        Skills are color-coded based on student accuracy:
        - Green (#10b981): >= 85% accuracy
        - Yellow (#f59e0b): >= 50% accuracy
        - Red (#ef4444): > 0% accuracy
        - Gray (#4b5563): No attempts
    """
    # Get user_id from header
    user_id = request.headers.get("X-User-ID")
    if not user_id:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="X-User-ID header is required"
        )
    
    tenant_id = request.headers.get("X-Tenant-ID", "public")
    
    try:
        # Step 1: Fetch all domains
        domains_stmt = select(Domain)
        domains_result = await db.execute(domains_stmt)
        domains = domains_result.scalars().all()
        
        # Step 2: Fetch all skills
        skills_stmt = select(Skill)
        skills_result = await db.execute(skills_stmt)
        skills = skills_result.scalars().all()
        
        # Step 3: Fetch all completed sessions for this user
        sessions_stmt = select(Session).where(
            Session.user_id == user_id,
            Session.tenant_id == tenant_id,
            Session.status == "completed"
        )
        sessions_result = await db.execute(sessions_stmt)
        completed_sessions = sessions_result.scalars().all()
        
        # Step 4: Extract response history and calculate skill performance
        # Build a map of item_id -> skill_id from items
        # We'll need to query items to get skill_id mappings
        item_skill_map: Dict[str, UUID] = {}
        
        # Get all unique item IDs from response history
        all_item_ids = set()
        for session in completed_sessions:
            if session.response_history:
                for response in session.response_history:
                    if isinstance(response, dict):
                        item_id = response.get("item_id")
                        if item_id:
                            all_item_ids.add(item_id)
        
        # Query items to get skill_id mappings
        if all_item_ids:
            # Query by logical_id (most common)
            items_stmt = select(Item).where(
                Item.logical_id.in_(list(all_item_ids))
            ).where(Item.tenant_id == tenant_id)
            items_result = await db.execute(items_stmt)
            items = items_result.scalars().all()
            
            for item in items:
                item_key = item.logical_id or str(item.id)
                
                # Prefer skill_id (UUID reference), fallback to skill_tag lookup
                if item.skill_id:
                    item_skill_map[item_key] = item.skill_id
                elif item.skill_tag:
                    # Try to find skill by name/tag (fuzzy match)
                    skill_by_tag_stmt = select(Skill).where(
                        Skill.name.ilike(f"%{item.skill_tag}%")
                    )
                    skill_result = await db.execute(skill_by_tag_stmt)
                    skill = skill_result.scalar_one_or_none()
                    if skill:
                        item_skill_map[item_key] = skill.id
        
        # Step 5: Calculate skill performance
        skill_performance: Dict[UUID, Dict[str, Any]] = {}
        
        for session in completed_sessions:
            if not session.response_history:
                continue
                
            for response in session.response_history:
                if not isinstance(response, dict):
                    continue
                    
                item_id = response.get("item_id")
                is_correct = response.get("is_correct", False)
                
                if not item_id:
                    continue
                
                # Get skill_id for this item
                skill_id = item_skill_map.get(item_id)
                if not skill_id:
                    continue
                
                # Initialize skill performance if needed
                if skill_id not in skill_performance:
                    skill_performance[skill_id] = {
                        "total": 0,
                        "correct": 0
                    }
                
                skill_performance[skill_id]["total"] += 1
                if is_correct:
                    skill_performance[skill_id]["correct"] += 1
        
        # Step 6: Build graph nodes
        nodes: List[GraphNode] = []
        links: List[GraphLink] = []
        
        # Add domain nodes
        for domain in domains:
            nodes.append(GraphNode(
                id=str(domain.id),
                name=domain.name,
                type="domain",
                color="#3b82f6",  # Blue for domains
                value=domain.weight or 1.0,
                accuracy=None,
                total_attempts=None,
                correct_attempts=None
            ))
        
        # Add skill nodes with performance data
        for skill in skills:
            perf = skill_performance.get(skill.id, {})
            total = perf.get("total", 0)
            correct = perf.get("correct", 0)
            accuracy = (correct / total) if total > 0 else None
            
            nodes.append(GraphNode(
                id=str(skill.id),
                name=skill.name,
                type="skill",
                color=get_skill_color(accuracy),
                value=1.0,  # Fixed size for now, could be based on importance
                accuracy=accuracy,
                total_attempts=total if total > 0 else None,
                correct_attempts=correct if correct > 0 else None
            ))
            
            # Create link from skill to domain
            links.append(GraphLink(
                source=str(skill.id),
                target=str(skill.domain_id)
            ))
        
        # If no completed sessions or no response history, return empty graph
        # This is valid - student may have completed exams but data hasn't synced yet
        if len(completed_sessions) == 0:
            print(f"[Curriculum Graph] No completed sessions found for user {user_id}")
        elif not any(s.response_history for s in completed_sessions):
            print(f"[Curriculum Graph] Completed sessions found but no response_history data for user {user_id}")
            print(f"[Curriculum Graph] This may indicate sessions haven't been synced yet")
        
        return CurriculumGraphResponse(
            nodes=nodes,
            links=links
        )
        
    except Exception as e:
        import traceback
        print(f"[Curriculum Graph] Error: {e}")
        print(traceback.format_exc())
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to generate curriculum graph: {str(e)}"
        )
