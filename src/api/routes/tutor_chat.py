"""
Tutor Chat API routes for streaming AI tutor conversations.
"""
from fastapi import APIRouter, Depends, Request, HTTPException, status
from fastapi.responses import StreamingResponse
from sqlalchemy.ext.asyncio import AsyncSession
from pydantic import BaseModel
from typing import List, Optional, Dict, Any
import json
import asyncio
import base64

from src.db.session import get_db
from src.services.retrieval_service import query
from src.services.cache_service import CacheService
from src.db.models import Item, Concept, QuestionConcept, TutorChat, Session
from sqlalchemy import select, func
from uuid import UUID
from src.core.config import settings

router = APIRouter()


class InitializeSessionRequest(BaseModel):
    """Request to initialize a tutor session."""
    questionId: str
    sessionId: str
    studentAnswer: Optional[str] = None


class InitializeSessionResponse(BaseModel):
    """Response from session initialization."""
    initialMessage: Optional[str] = None
    success: bool


class ChatMessage(BaseModel):
    """A chat message."""
    role: str  # 'student' or 'tutor'
    content: str
    timestamp: Optional[int] = None


class ChatStreamRequest(BaseModel):
    """Request for streaming chat."""
    questionId: str
    sessionId: str
    message: str
    conversationHistory: Optional[List[Dict[str, Any]]] = None
    image: Optional[str] = None  # Base64-encoded image (optionally a data URL)


def _decode_base64_image(image_b64: str) -> tuple[bytes, str]:
    """
    Decode a base64 image string.

    Supports either:
    - raw base64 payload
    - data URL: data:image/png;base64,<payload>

    Returns: (image_bytes, mime_type)
    """
    if not image_b64 or not image_b64.strip():
        raise ValueError("Empty image payload")

    raw = image_b64.strip()
    mime_type = "image/jpeg"  # default

    if raw.startswith("data:"):
        # Example: data:image/png;base64,AAAA...
        header, _, payload = raw.partition(",")
        if not payload:
            raise ValueError("Invalid data URL: missing payload")
        # header: data:image/png;base64
        try:
            meta = header.split(":", 1)[1]
            mime_type = meta.split(";", 1)[0] or mime_type
        except Exception:
            mime_type = "image/jpeg"
        raw = payload

    try:
        return base64.b64decode(raw, validate=True), mime_type
    except Exception:
        # Some clients include newlines/spaces; be permissive as fallback.
        cleaned = "".join(raw.split())
        return base64.b64decode(cleaned), mime_type


def _build_multimodal_contents(prompt_text: str, image_bytes: bytes, mime_type: str) -> list[dict]:
    """
    Build Gemini multimodal "contents" payload in a tool/library-agnostic dict form.
    """
    return [
        {
            "role": "user",
            "parts": [
                {"text": prompt_text},
                {"inline_data": {"mime_type": mime_type, "data": image_bytes}},
            ],
        }
    ]


async def _gemini_generate_multimodal(prompt_text: str, image_b64: str) -> str:
    """
    Call Gemini with a multimodal prompt (text + inline image bytes).

    Uses google-genai client if available (consistent with other backend code).
    Caches responses in Redis to improve latency for repeated queries.
    """
    # Build cache key from prompt and image data
    # Hash the image data to keep key manageable
    image_hash = CacheService.hash_key(image_b64)
    cache_key = f"tutor:{CacheService.hash_key('tutor', prompt_text, image_hash)}"
    
    # Check cache
    cached_response = await CacheService.get(cache_key)
    if cached_response is not None:
        print(f"[Tutor Chat]  Cache hit for multimodal query")
        return cached_response
    
    try:
        import google.genai as genai  # type: ignore
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Gemini client not available (install google-genai). Error: {e}",
        )

    api_key = settings.GEMINI_API_KEY or None
    if not api_key:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="GEMINI_API_KEY not configured",
        )

    image_bytes, mime_type = _decode_base64_image(image_b64)

    contents = _build_multimodal_contents(prompt_text, image_bytes, mime_type)
    client = genai.Client(api_key=api_key)
    try:
        resp = client.models.generate_content(
            model=settings.GEMINI_MODEL,
            contents=contents,
        )
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Gemini image analysis failed: {e}",
        )

    text = getattr(resp, "text", None)
    if isinstance(text, str) and text.strip():
        response_text = text.strip()
        # Store in cache (1 hour TTL)
        await CacheService.set(cache_key, response_text, ttl=3600)
        return response_text
    # Fallback: attempt to stringify response
    response_text = str(resp)
    await CacheService.set(cache_key, response_text, ttl=3600)
    return response_text


@router.post("/initialize", response_model=InitializeSessionResponse)
async def initialize_tutor_session(
    request: InitializeSessionRequest,
    db: AsyncSession = Depends(get_db)
):
    """
    Initialize a tutor session for a specific question.
    
    This endpoint:
    1. Identifies the concept(s) tested by the question
    2. Retrieves relevant reference material from RAG
    3. Identifies student misconceptions from wrong answer
    4. Returns an initial guiding message (optional)
    """
    try:
        # Get the question/item
        result = await db.execute(
            select(Item).where(Item.id == request.questionId)
        )
        item = result.scalar_one_or_none()
        
        if not item:
            # Try by logical_id
            result = await db.execute(
                select(Item).where(Item.logical_id == request.questionId)
            )
            item = result.scalar_one_or_none()
        
        if not item:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Question {request.questionId} not found"
            )
        
        # Get concepts tested by this question
        result = await db.execute(
            select(QuestionConcept, Concept).join(
                Concept, QuestionConcept.concept_id == Concept.id
            ).where(QuestionConcept.question_id == item.id)
        )
        concept_relations = result.all()
        
        concepts = [rel[1] for rel in concept_relations] if concept_relations else []
        concept_names = [c.name for c in concepts if c] if concepts else []
        
        # Get reference material from RAG
        reference_material = []
        if concept_names:
            for concept_name in concept_names[:2]:  # Limit to 2 concepts
                chunks = await query(
                    concept=concept_name,
                    top_k=2,
                    db=db
                )
                reference_material.extend(chunks)
        
        # Identify misconception if wrong answer provided
        misconception = None
        if request.studentAnswer:
            # This is a simplified misconception detection
            # In production, you'd use more sophisticated logic
            misconception = {
                "concept": concept_names[0] if concept_names else "General",
                "wrongAnswer": str(request.studentAnswer),
                "description": f"Student selected {request.studentAnswer} which is incorrect"
            }
        
        # Generate initial message (optional - can be empty to let student ask first)
        initial_message = None
        if misconception and concept_names:
            initial_message = (
                f"I see you're working on a question about {concept_names[0]}. "
                f"I'm here to help guide you through it. What part are you finding challenging?"
            )
        
        return InitializeSessionResponse(
            initialMessage=initial_message,
            success=True
        )
        
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Error initializing tutor session: {str(e)}"
        )


async def get_cached_tutor_chat(
    session_id: str,
    question_id: str,
    db: AsyncSession
) -> Optional[TutorChat]:
    """
    Check if there's a cached tutor chat for this question+session.
    Returns the cached chat if found, None otherwise.
    """
    try:
        session_uuid = UUID(session_id)
        result = await db.execute(
            select(TutorChat).where(
                TutorChat.session_id == session_uuid,
                TutorChat.question_id == question_id
            )
        )
        return result.scalar_one_or_none()
    except (ValueError, Exception) as e:
        print(f"[Tutor Chat] Error checking cache: {e}")
        return None


async def save_tutor_chat(
    session_id: str,
    question_id: str,
    messages: List[Dict[str, Any]],
    tenant_id: str,
    student_answer: Optional[str] = None,
    correct_answer: Optional[str] = None,
    question_stem: Optional[str] = None,
    passage_text: Optional[str] = None,
    category: Optional[str] = None,
    db: AsyncSession = None
) -> TutorChat:
    """
    Save or update a tutor chat in PostgreSQL.
    """
    try:
        session_uuid = UUID(session_id)
        
        # Check if chat already exists
        result = await db.execute(
            select(TutorChat).where(
                TutorChat.session_id == session_uuid,
                TutorChat.question_id == question_id
            )
        )
        existing_chat = result.scalar_one_or_none()
        
        if existing_chat:
            # Update existing chat
            existing_chat.messages = messages
            existing_chat.updated_at = func.now()
            if student_answer is not None:
                existing_chat.student_answer = student_answer
            if correct_answer is not None:
                existing_chat.correct_answer = correct_answer
            if question_stem is not None:
                existing_chat.question_stem = question_stem
            if passage_text is not None:
                existing_chat.passage_text = passage_text
            if category is not None:
                existing_chat.category = category
            await db.commit()
            await db.refresh(existing_chat)
            print(f"[Tutor Chat]  Updated cached chat for question {question_id}")
            return existing_chat
        else:
            # Create new chat
            new_chat = TutorChat(
                session_id=session_uuid,
                question_id=question_id,
                tenant_id=tenant_id,
                messages=messages,
                student_answer=student_answer,
                correct_answer=correct_answer,
                question_stem=question_stem,
                passage_text=passage_text,
                category=category
            )
            db.add(new_chat)
            await db.commit()
            await db.refresh(new_chat)
            print(f"[Tutor Chat]  Saved new chat to database for question {question_id}")
            return new_chat
    except Exception as e:
        print(f"[Tutor Chat]  Error saving chat: {e}")
        import traceback
        print(traceback.format_exc())
        await db.rollback()
        raise


async def generate_tutor_response(
    question_id: str,
    student_message: str,
    conversation_history: List[Dict[str, Any]],
    db: AsyncSession,
    session_id: Optional[str] = None,
    tenant_id: str = "public",
    image_b64: Optional[str] = None,
) -> str:
    """
    Generate a tutor response using the Socratic method with Critic Agent validation.
    
    This function:
    1. Checks Redis cache for LLM responses (fast)
    2. Checks PostgreSQL cache for session history
    3. If cache miss, calls Gemini/LLM
    4. Saves response to both Redis (LLM cache) and PostgreSQL (session history)
    
    This integrates with:
    1. Socratic tutor prompt system
    2. RAG retrieval for reference material
    3. Critic Agent for quality control
    4. LLM (OpenAI/Gemini) for response generation
    
    The orchestrator handles the tutor-critic loop with retry logic.
    """
    # Build cache key for LLM response
    # For generic math definitions, exclude user_id (shared cache)
    # For personalized responses, include user_id if needed
    cache_key_parts = ["tutor", student_message]
    if image_b64:
        # Hash image data to keep key manageable
        image_hash = CacheService.hash_key(image_b64)
        cache_key_parts.append(image_hash)
    
    cache_key = f"tutor:{CacheService.hash_key(*cache_key_parts)}"
    
    # Check Redis cache for LLM response
    cached_response = await CacheService.get(cache_key)
    if cached_response is not None:
        print(f"[Tutor Chat]  Redis cache hit for LLM response")
        return cached_response
    
    # Snap & Solve path: if an image is provided, analyze and solve it via Gemini multimodal.
    if image_b64:
        multimodal_prompt = (
            "Here is an image of a math problem. Analyze any geometry/graphs carefully and solve it. "
            "Show clear step-by-step reasoning and give the final answer."
        )
        response = await _gemini_generate_multimodal(multimodal_prompt, image_b64)
        # Cache is already handled in _gemini_generate_multimodal
        return response

    # Check cache first if session_id is provided
    if session_id:
        cached_chat = await get_cached_tutor_chat(session_id, question_id, db)
        if cached_chat and cached_chat.messages:
            # Return the last tutor message from cache
            tutor_messages = [msg for msg in cached_chat.messages if msg.get("role") == "tutor"]
            if tutor_messages:
                print(f"[Tutor Chat]  Cache hit for question {question_id}")
                return tutor_messages[-1].get("content", "")
    
    # Cache miss - generate new response
    print(f"[Tutor Chat]  Cache miss - generating new response for question {question_id}")
    
    # Get question context
    result = await db.execute(
        select(Item).where(Item.id == question_id)
    )
    item = result.scalar_one_or_none()
    
    if not item:
        result = await db.execute(
            select(Item).where(Item.logical_id == question_id)
        )
        item = result.scalar_one_or_none()
    
    if not item:
        return "I apologize, but I couldn't find the question. Please try again."
    
    # Retrieve "Ground Truth" - exact question record
    correct_answer = str(item.correct_answer)
    official_explanation = item.solution_text or ""
    
    # === OPTIMIZATION: Check for Offline RAG Data ===
    has_offline_rag = item.ai_explanation is not None and item.ai_explanation.strip()
    
    if has_offline_rag:
        # Case A: Use pre-computed Offline RAG data (Preferred - Fast & Cost-Effective)
        print(f"[Tutor Chat]  Using Offline RAG data for question {question_id}")
        
        # Format distractor analysis
        distractor_text = ""
        if item.distractor_analysis:
            distractor_dict = item.distractor_analysis if isinstance(item.distractor_analysis, dict) else {}
            distractor_text = "\n".join([f"  * **{key}:** {value}" for key, value in distractor_dict.items()])
        
        # Format hint sequence
        hints_text = ""
        if item.hint_sequence:
            hints_list = item.hint_sequence if isinstance(item.hint_sequence, list) else []
            hints_text = "\n".join([f"  {i+1}. {hint}" for i, hint in enumerate(hints_list)])
        
        # Build system prompt with Offline RAG data
        system_prompt = f"""You are an SAT Tutor.

**TEACHER'S GUIDE (Hidden from student):**
* **Correct Logic:** {item.ai_explanation}
* **Traps:** 
{distractor_text if distractor_text else "  (No distractor analysis available)"}
* **Hints:** 
{hints_text if hints_text else "  (No hints available)"}

**INSTRUCTION:** 
Use the Guide to help the student. If they made a specific mistake (e.g., chose A), check the 'Traps' data for A and explain the misconception. Do not reveal the answer immediately. Use the Socratic method to guide them.

**STUDENT'S MESSAGE:**
{student_message}

**CONVERSATION HISTORY:**
{json.dumps(conversation_history[-5:], indent=2) if conversation_history else "No previous conversation."}

Now, provide a helpful, guiding response that helps the student think through the problem without giving away the answer."""
    
    else:
        # Case B: Fallback to Real-Time RAG (when offline data is missing)
        print(f"[Tutor Chat]  Offline RAG data not available, using real-time RAG for question {question_id}")
        
        # 1. Extract skill from question (skill_tag or from concepts)
        skill = item.skill_tag
        concepts = []
        if not skill:
            # Try to get skill from concepts
            result = await db.execute(
                select(QuestionConcept, Concept).join(
                    Concept, QuestionConcept.concept_id == Concept.id
                ).where(QuestionConcept.question_id == item.id)
            )
            concept_relations = result.all()
            concepts = [rel[1] for rel in concept_relations] if concept_relations else []
            if concepts:
                skill = concepts[0].name  # Use first concept name as skill
        
        # 2. Retrieve "Similar Knowledge" from RAG using skill + student context
        reference_material = []
        if skill:
            try:
                # Build enhanced query: combine skill with student's question/confusion
                # Extract key terms from student message for better semantic matching
                student_query_terms = ""
                if student_message:
                    # Use first 100 chars of student message to understand their confusion
                    student_query_terms = student_message[:100]
                
                # Combine skill with student's specific question for better retrieval
                enhanced_query = f"{skill}"
                if student_query_terms:
                    enhanced_query = f"{skill}. {student_query_terms}"
                
                # Try query_text first (semantic search)
                chunks = await query(
                    query_text=enhanced_query,
                    top_k=4,  # Increased from 2 to 4 for better coverage
                    db=db
                )
                
                # Fallback: If no results or low similarity, try concept-based search
                if not chunks or (chunks and all(c.get("similarity", 0) < 0.7 for c in chunks)):
                    if concepts:
                        # Try concept-based retrieval as fallback
                        concept_chunks = await query(
                            concept=skill,
                            top_k=3,
                            db=db
                        )
                        if concept_chunks:
                            chunks = concept_chunks
                            print(f"[Tutor Chat]  Using concept-based fallback for {skill}")
                
                reference_material = chunks
                print(f"[Tutor Chat]  Retrieved {len(chunks)} RAG chunks for skill: {skill}, query: {enhanced_query[:50]}...")
            except Exception as e:
                print(f"[Tutor Chat]  RAG retrieval failed: {e}")
                reference_material = []
        
        # 3. Construct System Prompt with all context
        # Format reference material for prompt (prioritize high-similarity chunks)
        rag_context = ""
        if reference_material:
            # Sort by similarity (highest first) and take top 3
            sorted_chunks = sorted(
                reference_material, 
                key=lambda x: x.get("similarity", 0), 
                reverse=True
            )[:3]
            
            rag_context = "\n\n**BACKGROUND THEORY FROM CURRICULUM:**\n"
            for i, chunk in enumerate(sorted_chunks, 1):
                content = chunk.get("content", "")
                concept_name = chunk.get("concept_name", "")
                similarity = chunk.get("similarity", 0)
                
                if content:
                    # Truncate very long chunks to avoid token limits
                    max_length = 500
                    if len(content) > max_length:
                        content = content[:max_length] + "..."
                    
                    rag_context += f"\n[{i}] {concept_name if concept_name else 'Theory'} (relevance: {similarity:.2f}):\n{content}\n"
        
        # Build the system prompt (Fallback mode)
        system_prompt = f"""You are an expert SAT Tutor using the Socratic method. Your goal is to guide the student to discover the answer themselves through thoughtful questions, NOT to give away the answer directly.

**TEACHER'S GUIDE (DO NOT REVEAL TO STUDENT):**
- The student is working on this question: {item.question_text[:500]}
- The correct answer is: {correct_answer}
- Official explanation: {official_explanation[:500] if official_explanation else "No explanation available."}
{rag_context}

**CRITICAL RULES:**
1. DO NOT reveal the correct answer directly
2. DO NOT say "the answer is X" or "the correct answer is Y"
3. Ask guiding questions to help them find the first step
4. Use the Socratic method: ask questions that lead them to discover the solution
5. If they're stuck, provide hints about the approach, not the answer
6. Reference the background theory naturally in your guidance, but don't quote it verbatim
7. Be encouraging and supportive

**STUDENT'S MESSAGE:**
{student_message}

**CONVERSATION HISTORY:**
{json.dumps(conversation_history[-5:], indent=2) if conversation_history else "No previous conversation."}

Now, provide a helpful, guiding response that helps the student think through the problem without giving away the answer."""
    
    # 5. Generate response using Gemini
    try:
        import google.genai as genai  # type: ignore
        api_key = settings.GEMINI_API_KEY
        if not api_key:
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="GEMINI_API_KEY not configured"
            )
        
        client = genai.Client(api_key=api_key)
        
        # Build contents for Gemini API
        # Include conversation history if available
        contents = []
        
        # Add conversation history (last 5 messages for context)
        if conversation_history:
            for msg in conversation_history[-5:]:
                role = msg.get("role", "user")
                content = msg.get("content", "")
                if role == "student" or role == "user":
                    contents.append({
                        "role": "user",
                        "parts": [{"text": content}]
                    })
                elif role == "tutor" or role == "assistant":
                    contents.append({
                        "role": "model",
                        "parts": [{"text": content}]
                    })
        
        # Add system prompt and current student message
        full_prompt = f"{system_prompt}\n\nStudent: {student_message}"
        contents.append({
            "role": "user",
            "parts": [{"text": full_prompt}]
        })
        
        # Generate response
        resp = client.models.generate_content(
            model=settings.GEMINI_MODEL,
            contents=contents,
        )
        
        response = getattr(resp, "text", None)
        if isinstance(response, str) and response.strip():
            response = response.strip()
        else:
            # Fallback response
            response = (
                "That's a great question! Let me help you think through this. "
                "What information do you have in the problem? "
                "What's the first step you think you should take?"
            )
    except Exception as e:
        print(f"[Tutor Chat]  Error calling Gemini: {e}")
        import traceback
        print(traceback.format_exc())
        # Fallback response
        response = (
            "That's a great question! Let me help you think through this. "
            "What information do you have in the problem? "
            "What's the first step you think you should take?"
        )
    
    # NOTE: In production, this should call:
    # from src.ai.orchestrator import orchestrateTutorResponse
    # result = await orchestrateTutorResponse({
    #     studentInput: student_message,
    #     tutorContext: {...},
    #     correctAnswer: item.correct_answer,
    # }, {
    #     tutorLLMCall: ...,
    #     criticLLMCall: ...,
    # })
    # response = result.response
    
    # Store LLM response in Redis cache (1 hour TTL)
    await CacheService.set(cache_key, response, ttl=3600)
    
    # Save to PostgreSQL cache if session_id is provided
    if session_id:
        import time
        now = int(time.time() * 1000)  # milliseconds
        messages = conversation_history + [
            {"role": "student", "content": student_message, "timestamp": now},
            {"role": "tutor", "content": response, "timestamp": now + 100}
        ]
        try:
            await save_tutor_chat(
                session_id=session_id,
                question_id=question_id,
                messages=messages,
                tenant_id=tenant_id,
                question_stem=item.question_text,
                correct_answer=str(item.correct_answer),
                db=db
            )
        except Exception as e:
            print(f"[Tutor Chat]  Failed to save to cache (non-fatal): {e}")
    
    return response


async def stream_tutor_response(
    question_id: str,
    student_message: str,
    conversation_history: List[Dict[str, Any]],
    db: AsyncSession,
    session_id: str = None,
    user_id: str = None,
    tenant_id: str = "public",
    image_b64: Optional[str] = None,
):
    """
    Stream tutor response token by token with thinking state updates.
    
    Yields JSON objects with:
    - 'status': Thinking state ('analyzing', 'generating', 'reviewing', 'checking')
    - 'content': Response tokens
    
    Also triggers Architect Agent in background (non-blocking).
    """
    import time
    start_time = time.time()
    latency_target = 3.0  # 3 seconds
    filler_message = "That's an interesting thought, let me check..."
    filler_emitted = False
    
    try:
        # Emit initial thinking state
        yield f"data: {json.dumps({'status': 'analyzing'})}\n\n"
        await asyncio.sleep(0.01)  # Small delay for UI update
        
        # Emit generating state
        yield f"data: {json.dumps({'status': 'generating'})}\n\n"
        await asyncio.sleep(0.01)
        
        # Check if we should emit filler message
        elapsed = time.time() - start_time
        if elapsed > latency_target and not filler_emitted:
            yield f"data: {json.dumps({'content': filler_message + ' '})}\n\n"
            filler_emitted = True
            await asyncio.sleep(0.01)
        
        # Generate response (in production, this would stream from LLM)
        # For now, we'll simulate with status updates
        yield f"data: {json.dumps({'status': 'reviewing'})}\n\n"
        await asyncio.sleep(0.01)
        
        # Get tenant_id from request if available
        tenant_id = "public"  # Default
        try:
            from fastapi import Request
            # If request is available, extract tenant_id
            # For now, use default
            pass
        except:
            pass
        
        response = await generate_tutor_response(
            question_id,
            student_message,
            conversation_history,
            db,
            session_id=session_id,
            tenant_id=tenant_id,
            image_b64=image_b64,
        )
        
        yield f"data: {json.dumps({'status': 'checking'})}\n\n"
        await asyncio.sleep(0.01)
        
        # Start Architect Agent in background (non-blocking)
        if session_id and user_id:
            asyncio.create_task(
                update_curriculum_background(session_id, user_id, db)
            )
        
        # Stream response tokens
        words = response.split(' ')
        for i, word in enumerate(words):
            content = word + (' ' if i < len(words) - 1 else '')
            
            yield f"data: {json.dumps({'content': content})}\n\n"
            
            # Small delay to simulate streaming (remove in production)
            await asyncio.sleep(0.05)
        
        # Signal completion
        yield f"data: {json.dumps({'status': 'complete'})}\n\n"
        yield "data: [DONE]\n\n"
        
    except Exception as e:
        yield f"data: {json.dumps({'status': 'error', 'error': str(e)})}\n\n"
        yield "data: [DONE]\n\n"


async def update_curriculum_background(
    session_id: str,
    user_id: str,
    db: AsyncSession
):
    """
    Background task to update curriculum using Architect Agent.
    Runs asynchronously and doesn't block the chat response.
    """
    try:
        from src.services.curriculum_service import analyze_session_and_update_curriculum
        
        # Wait a bit to ensure session is complete
        await asyncio.sleep(1)
        
        # Analyze session and update curriculum (non-blocking)
        await analyze_session_and_update_curriculum(
            session_id=session_id,
            user_id=user_id,
            tenant_id="default",
            db=db,
        )
        
        # Log success (in production, use proper logging)
        print(f"[Background] Curriculum updated for session {session_id}")
        
    except Exception as e:
        # Log error but don't fail (this is background task)
        print(f"[Background] Error updating curriculum: {e}")


@router.post("/chat/stream")
async def stream_chat(
    request: ChatStreamRequest,
    db: AsyncSession = Depends(get_db)
):
    """
    Stream tutor chat response with thinking state updates.
    
    Returns Server-Sent Events (SSE) stream with:
    - Status updates: 'analyzing', 'generating', 'reviewing', 'checking'
    - Content tokens: Response text
    - Background curriculum updates via Architect Agent
    
    Also triggers Architect Agent in background (non-blocking).
    """
    try:
        # Get user_id from session if available
        from uuid import UUID
        from src.db.models import Session
        
        session_id = request.sessionId
        user_id = None
        
        tenant_id = "public"  # Default, could be extracted from headers
        try:
            result = await db.execute(
                select(Session).where(Session.id == UUID(session_id))
            )
            session = result.scalar_one_or_none()
            if session:
                user_id = session.user_id
                tenant_id = session.tenant_id
        except Exception:
            pass  # Session lookup failed, continue without user_id
        
        return StreamingResponse(
            stream_tutor_response(
                request.questionId,
                request.message,
                request.conversationHistory or [],
                db,
                session_id=session_id,
                user_id=user_id,
                tenant_id=tenant_id,
                image_b64=request.image,
            ),
            media_type="text/event-stream",
            headers={
                "Cache-Control": "no-cache",
                "Connection": "keep-alive",
                "X-Accel-Buffering": "no",  # Disable nginx buffering
            }
        )
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Error streaming chat: {str(e)}"
        )
