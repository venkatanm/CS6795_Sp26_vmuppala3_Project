"""
Retrieval Service for RAG

This service queries the vector database to retrieve relevant curriculum chunks
based on concept and student history.
"""
import json
from typing import List, Dict, Any, Optional
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.sql import text
from src.db.models import CurriculumChunk, Concept
from src.core.config import settings
from src.services.cache_service import CacheService
from openai import OpenAI

# Initialize OpenAI client for query embeddings
openai_client: Optional[OpenAI] = None
if settings.OPENAI_API_KEY:
    openai_client = OpenAI(api_key=settings.OPENAI_API_KEY)


async def generate_query_embedding(query_text: str) -> Optional[List[float]]:
    """
    Generate embedding for a query string.
    
    Args:
        query_text: The query text to embed
        
    Returns:
        Embedding vector (1536 dimensions) or None if API call fails
    """
    if not openai_client:
        return None
    
    try:
        response = openai_client.embeddings.create(
            model="text-embedding-3-small",
            input=query_text
        )
        return response.data[0].embedding
    except Exception as e:
        print(f"Error generating query embedding: {e}")
        return None


async def query(
    concept: Optional[str] = None,
    student_history: Optional[List[Dict[str, Any]]] = None,
    query_text: Optional[str] = None,
    difficulty: Optional[str] = None,
    top_k: int = 3,
    db: Optional[AsyncSession] = None
) -> List[Dict[str, Any]]:
    """
    Query the vector database for relevant curriculum chunks.
    
    Args:
        concept: Concept name to filter by (optional)
        student_history: List of student's past performance (optional)
            Format: [{"concept": "Linear Equations", "score": 0.7}, ...]
        query_text: Free-form query text for semantic search (optional)
        difficulty: Filter by difficulty level (optional)
        top_k: Number of results to return (default: 3)
        db: Database session (optional, will create if not provided)
        
    Returns:
        List of relevant chunk dictionaries with:
        - content: The text content
        - concept_name: Associated concept
        - difficulty: Difficulty level
        - source: Source document
        - similarity: Cosine similarity score
        - metadata: Additional metadata
    """
    from src.db.base import AsyncSessionLocal
    
    # Build cache key from query parameters
    # Include all parameters that affect results: query_text, concept, top_k, difficulty
    # Hash student_history if present (it can be large)
    cache_key_parts = ["rag_search"]
    if query_text:
        cache_key_parts.append(query_text)
    elif concept:
        cache_key_parts.append(f"concept:{concept}")
    cache_key_parts.append(str(top_k))
    if difficulty:
        cache_key_parts.append(f"difficulty:{difficulty}")
    if student_history:
        # Hash student_history to keep key manageable
        history_str = json.dumps(student_history, sort_keys=True)
        cache_key_parts.append(CacheService.hash_key(history_str))
    
    cache_key = f"rag:{CacheService.hash_key(*cache_key_parts)}"
    
    # Check cache
    cached_results = await CacheService.get(cache_key)
    if cached_results is not None:
        return cached_results
    
    # Use provided session or create new one
    should_close = False
    if db is None:
        db = AsyncSessionLocal()
        should_close = True
    
    try:
        # Build query based on available information
        query_embedding = None
        
        # If query_text is provided, generate embedding for semantic search
        if query_text:
            query_embedding = await generate_query_embedding(query_text)
        
        # If concept is provided but no query_text, use concept name as query
        elif concept:
            # Try to find concept in database and use its description
            result = await db.execute(
                select(Concept).where(Concept.name == concept)
            )
            concept_obj = result.scalar_one_or_none()
            if concept_obj and concept_obj.description:
                query_text = f"{concept}: {concept_obj.description}"
            else:
                query_text = concept
            
            query_embedding = await generate_query_embedding(query_text)
        
        # If we have student_history, enhance the query
        if student_history and query_embedding:
            # Build a query that emphasizes concepts the student struggled with
            weak_concepts = [
                h.get("concept") for h in student_history 
                if h.get("score", 1.0) < 0.7  # Score below 70%
            ]
            if weak_concepts:
                enhanced_query = f"{query_text}. Focus on: {', '.join(weak_concepts)}"
                query_embedding = await generate_query_embedding(enhanced_query)
        
        if not query_embedding:
            # Fallback: return chunks filtered by concept/difficulty only
            chunks = await _query_by_filters(concept, difficulty, top_k, db)
            # Store results in cache (24 hours TTL)
            await CacheService.set(cache_key, chunks, ttl=86400)
            return chunks
        
        # Convert embedding list to PostgreSQL array format, then to vector
        embedding_array = "[" + ",".join(map(str, query_embedding)) + "]"
        
        # Build filter conditions
        filters = ["embedding IS NOT NULL"]
        params = {"embedding": embedding_array, "top_k": top_k}
        
        if concept:
            filters.append("concept_name = :concept")
            params["concept"] = concept
        if difficulty:
            filters.append("difficulty = :difficulty")
            params["difficulty"] = difficulty
        
        # Build the SQL query with filters
        filter_clause = " AND ".join(filters)
        
        # Use raw SQL for pgvector cosine similarity search
        # pgvector uses the <=> operator for cosine distance
        sql_query = text(f"""
            SELECT 
                id, content, concept_id, concept_name, difficulty, source, metadata, created_at,
                1 - (embedding <=> CAST(:embedding AS vector(1536))) AS similarity
            FROM curriculum_chunks
            WHERE {filter_clause}
            ORDER BY embedding <=> CAST(:embedding AS vector(1536))
            LIMIT :top_k
        """)
        
        result = await db.execute(sql_query, params)
        rows = result.all()
        
        # Format results
        chunks = []
        for row in rows:
            chunks.append({
                "content": row[1],  # content
                "concept_id": str(row[2]) if row[2] else None,  # concept_id
                "concept_name": row[3],  # concept_name
                "difficulty": row[4],  # difficulty
                "source": row[5],  # source
                "metadata": row[6] or {},  # metadata
                "similarity": float(row[8]) if row[8] else 0.0  # similarity
            })
        
        # Store results in cache (24 hours TTL)
        await CacheService.set(cache_key, chunks, ttl=86400)
        
        return chunks
        
    finally:
        if should_close:
            await db.close()


async def _query_by_filters(
    concept: Optional[str],
    difficulty: Optional[str],
    top_k: int,
    db: AsyncSession
) -> List[Dict[str, Any]]:
    """
    Fallback query method using only filters (no semantic search).
    
    Args:
        concept: Concept name filter
        difficulty: Difficulty filter
        top_k: Number of results
        db: Database session
        
    Returns:
        List of chunk dictionaries
    """
    query = select(CurriculumChunk)
    
    if concept:
        query = query.where(CurriculumChunk.concept_name == concept)
    if difficulty:
        query = query.where(CurriculumChunk.difficulty == difficulty)
    
    query = query.limit(top_k)
    
    result = await db.execute(query)
    chunks = result.scalars().all()
    
    return [
        {
            "content": chunk.content,
            "concept_name": chunk.concept_name,
            "concept_id": str(chunk.concept_id) if chunk.concept_id else None,
            "difficulty": chunk.difficulty,
            "source": chunk.source,
            "similarity": 0.0,  # No similarity score available
            "metadata": chunk.chunk_metadata or {}
        }
        for chunk in chunks
    ]


async def query_by_concept_id(
    concept_id: str,
    top_k: int = 3,
    difficulty: Optional[str] = None,
    db: Optional[AsyncSession] = None
) -> List[Dict[str, Any]]:
    """
    Query chunks by concept ID.
    
    Args:
        concept_id: UUID of the concept
        top_k: Number of results to return
        difficulty: Optional difficulty filter
        db: Database session (optional)
        
    Returns:
        List of relevant chunk dictionaries
    """
    from src.db.base import AsyncSessionLocal
    
    should_close = False
    if db is None:
        db = AsyncSessionLocal()
        should_close = True
    
    try:
        query = select(CurriculumChunk).where(
            CurriculumChunk.concept_id == concept_id
        )
        
        if difficulty:
            query = query.where(CurriculumChunk.difficulty == difficulty)
        
        query = query.limit(top_k)
        
        result = await db.execute(query)
        chunks = result.scalars().all()
        
        return [
            {
                "content": chunk.content,
                "concept_name": chunk.concept_name,
                "concept_id": str(chunk.concept_id) if chunk.concept_id else None,
                "difficulty": chunk.difficulty,
                "source": chunk.source,
                "similarity": 1.0,  # Direct match
                "metadata": chunk.chunk_metadata or {}
            }
            for chunk in chunks
        ]
    finally:
        if should_close:
            await db.close()
