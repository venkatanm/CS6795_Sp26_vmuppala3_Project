"""
RAG (Retrieval-Augmented Generation) API routes.
"""
from typing import List, Optional
from fastapi import APIRouter, Depends, Request, HTTPException, status
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from src.db.session import get_db
from src.services.retrieval_service import query, query_by_concept_id

router = APIRouter()


class StudentHistoryItem(BaseModel):
    """Student performance history item."""
    concept: str
    score: float  # 0.0 to 1.0


class QueryRequest(BaseModel):
    """RAG query request."""
    concept: Optional[str] = None
    student_history: Optional[List[StudentHistoryItem]] = None
    query_text: Optional[str] = None
    difficulty: Optional[str] = None
    top_k: int = 3


class QueryResponse(BaseModel):
    """RAG query response."""
    chunks: List[dict]


@router.post("/query", response_model=QueryResponse)
async def query_rag(
    request: QueryRequest,
    db: AsyncSession = Depends(get_db)
):
    """
    Query the RAG database for relevant curriculum chunks.
    
    Args:
        request: Query parameters including concept, student history, etc.
        db: Database session
        
    Returns:
        QueryResponse with top K most relevant chunks
    """
    try:
        # Convert student_history to dict format if provided
        student_history_dict = None
        if request.student_history:
            student_history_dict = [
                {"concept": item.concept, "score": item.score}
                for item in request.student_history
            ]
        
        chunks = await query(
            concept=request.concept,
            student_history=student_history_dict,
            query_text=request.query_text,
            difficulty=request.difficulty,
            top_k=request.top_k,
            db=db
        )
        
        return QueryResponse(chunks=chunks)
        
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Error querying RAG database: {str(e)}"
        )


@router.get("/concept/{concept_id}")
async def query_by_concept(
    concept_id: str,
    difficulty: Optional[str] = None,
    top_k: int = 3,
    db: AsyncSession = Depends(get_db)
):
    """
    Query chunks by concept ID.
    
    Args:
        concept_id: UUID of the concept
        difficulty: Optional difficulty filter
        top_k: Number of results to return
        
    Returns:
        List of relevant chunks
    """
    try:
        chunks = await query_by_concept_id(
            concept_id=concept_id,
            difficulty=difficulty,
            top_k=top_k,
            db=db
        )
        
        return QueryResponse(chunks=chunks)
        
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Error querying by concept: {str(e)}"
        )
