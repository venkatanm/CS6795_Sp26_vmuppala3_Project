from typing import List, Optional
import logging
import sys

import asyncio
from fastapi import APIRouter, Depends, Request, status, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from src.db.session import get_db
from src.db.models import Item

# Set up logging
logging.basicConfig(level=logging.DEBUG, force=True)
logger = logging.getLogger(__name__)

# Use the new prompt-template-based generation for variety
from src.services.content_generator import generate_questions
from pathlib import Path
import random


router = APIRouter()


@router.get("/debug")
async def debug_content_generator():
    """Debug endpoint to check if content_generator is loaded correctly."""
    import os
    from src.services.content_generator import GEMINI_AVAILABLE, GEMINI_API_KEY_SET, genai_client
    
    # Try to re-initialize if needed
    api_key_from_env = os.getenv('GEMINI_API_KEY')
    
    return {
        "GEMINI_AVAILABLE": GEMINI_AVAILABLE,
        "GEMINI_API_KEY_SET": GEMINI_API_KEY_SET,
        "genai_client_is_none": genai_client is None,
        "genai_client_type": str(type(genai_client)) if genai_client else "None",
        "api_key_in_env": "SET" if api_key_from_env else "NOT SET",
        "api_key_length": len(api_key_from_env) if api_key_from_env else 0,
        "code_version": "v2.1",
        "cwd": os.getcwd(),
        "env_file_exists": os.path.exists('.env')
    }


class ItemSchema(BaseModel):
    """Schema for creating a single item manually."""

    text: str
    options: List[float]
    correct_id: int = Field(ge=0, description="Index of the correct option in the options array")
    difficulty: float
    domain: str
    solution_text: Optional[str] = None
    skill_tag: Optional[str] = None


class GenerateRequest(BaseModel):
    """Schema for triggering AI-based item generation."""

    topic: str
    count: int = Field(default=1, ge=1, le=20)
    difficulty: float


@router.get("/items")
async def list_items(
    request: Request,
    db: AsyncSession = Depends(get_db),
    limit: int = 100,
    skip: int = 0,
):
    """
    List existing items for the current tenant (Question Bank).
    """
    from sqlalchemy import select
    import traceback

    try:
        tenant_id = request.headers.get("X-Tenant-ID", "public")

        result = await db.execute(
            select(Item)
            .where(Item.tenant_id == tenant_id)
            .offset(skip)
            .limit(limit)
        )
        items = result.scalars().all()

        return [
            {
                "id": str(item.id),
                "question_text": item.question_text,
                "context_type": item.context_type,
                "variables": item.variables,
            }
            for item in items
        ]
    except Exception as e:
        # Log the full error for debugging
        error_trace = traceback.format_exc()
        print(f"Error in list_items: {e}")
        print(f"Traceback: {error_trace}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to fetch items: {str(e)}"
        )


@router.get("/items/{item_id}")
async def get_item(
    item_id: str,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    """
    Get a single item by ID.
    """
    from sqlalchemy import select
    import traceback

    try:
        tenant_id = request.headers.get("X-Tenant-ID", "public")

        result = await db.execute(
            select(Item)
            .where(Item.id == item_id)
            .where(Item.tenant_id == tenant_id)
        )
        item = result.scalar_one_or_none()

        if not item:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Item {item_id} not found"
            )

        return {
            "id": str(item.id),
            "question_text": item.question_text,
            "context_type": item.context_type,
            "variables": item.variables,
        }
    except HTTPException:
        raise
    except Exception as e:
        error_trace = traceback.format_exc()
        print(f"Error in get_item: {e}")
        print(f"Traceback: {error_trace}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to fetch item: {str(e)}"
        )

@router.delete("/items", status_code=status.HTTP_200_OK)
async def delete_all_items(
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    """
    Delete all items from the question bank for the current tenant.
    
    WARNING: This will permanently delete all items. Use with caution!
    """
    from sqlalchemy import select, delete
    
    try:
        tenant_id = request.headers.get("X-Tenant-ID", "public")
        
        # First, count how many items will be deleted
        result = await db.execute(
            select(Item).where(Item.tenant_id == tenant_id)
        )
        items = result.scalars().all()
        count = len(items)
        
        # Delete all items for this tenant
        await db.execute(
            delete(Item).where(Item.tenant_id == tenant_id)
        )
        
        await db.flush()
        
        return {
            "message": f"Successfully deleted {count} item(s) from the question bank",
            "deleted_count": count
        }
    except Exception as e:
        import traceback
        error_trace = traceback.format_exc()
        print(f"Error deleting items: {e}")
        print(f"Traceback: {error_trace}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to delete items: {str(e)}"
        )


@router.post("/items", status_code=status.HTTP_201_CREATED)
async def create_item(
    payload: ItemSchema,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    """
    Create a single item and store it in the items table.

    Input: ItemSchema (text, options, correct_id, difficulty, domain)
    Returns: The created item ID.
    """
    tenant_id = request.headers.get("X-Tenant-ID", "public")

    # Validate correct_id
    if payload.correct_id < 0 or payload.correct_id >= len(payload.options):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="correct_id must be a valid index into options",
        )

    correct_answer = payload.options[payload.correct_id]

    item = Item(
        tenant_id=tenant_id,
        question_text=payload.text,
        correct_answer=correct_answer,
        options=payload.options,
        # Store extra metadata in existing fields
        template_id=None,
        context_type=payload.domain,
        variables={
            "difficulty": payload.difficulty,
            "domain": payload.domain,
        },
        solution_text=payload.solution_text,
        skill_tag=payload.skill_tag,
    )

    db.add(item)
    await db.flush()

    return {"id": str(item.id)}


@router.post("/generate", status_code=status.HTTP_201_CREATED)
async def generate_items(
    payload: GenerateRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    """
    Trigger AI generation of items using the existing ContentGenerator logic.

    Input: { topic: string, count: int, difficulty: float }
    Action:
      - Use the Week 2 content generation pipeline to create items
      - Save them to the items table
    Returns: List of generated item IDs.

    Note: To keep this fast, the effective count is capped at 2 items per request.
    """
    import traceback
    
    try:
        tenant_id = request.headers.get("X-Tenant-ID", "public")
        # Force output to appear
        import sys
        sys.stdout.write(f"[CONTENT API] ===== STARTING GENERATION =====\n")
        sys.stdout.write(f"[CONTENT API] Topic: {payload.topic}, Count: {payload.count}\n")
        sys.stdout.flush()
        print(f"[CONTENT API] Starting item generation for topic: {payload.topic}, count: {payload.count}", flush=True)
        logger = __import__('logging').getLogger(__name__)
        logger.error(f"[CONTENT API] Starting item generation for topic: {payload.topic}, count: {payload.count}")

        # Cap the number of items to keep the endpoint responsive
        effective_count = min(max(payload.count, 1), 5)  # Increased limit since we're using prompt templates
        
        # Use the new generate_questions function that uses prompt templates for variety
        def generate_items_sync():
            """Wrapper function to call generate_questions with correct arguments."""
            try:
                print("=" * 80)
                print(f"[CONTENT API] Calling generate_questions with count={effective_count}, topic={payload.topic}")
                print("=" * 80)
                result = generate_questions(topic=payload.topic, count=effective_count)
                print("=" * 80)
                print(f"[CONTENT API] generate_questions returned {len(result) if result else 0} questions")
                if result:
                    for i, q in enumerate(result):
                        has_mock = '[MOCK]' in q.get('question_text', '')
                        print(f"[CONTENT API] Question {i+1}: Has MOCK={has_mock}, Text preview: {q.get('question_text', '')[:80]}...")
                print("=" * 80)
                return result
            except Exception as e:
                print("=" * 80)
                print(f"[CONTENT API ERROR] Error inside generate_items_sync: {e}")
                import traceback
                print(f"[CONTENT API ERROR] Traceback: {traceback.format_exc()}")
                print("=" * 80)
                raise

        # Run the (CPU-bound / I/O-bound) generation logic in a thread to avoid blocking the event loop
        try:
            print(f"[DEBUG] Starting async thread for item generation...")
            generated_questions = await asyncio.to_thread(generate_items_sync)
            print(f"[DEBUG] Received {len(generated_questions) if generated_questions else 0} questions from thread")
        except Exception as gen_error:
            error_trace = traceback.format_exc()
            print(f"[ERROR] Error in generate_questions: {gen_error}")
            print(f"[ERROR] Traceback: {error_trace}")
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail=f"Failed to generate items: {str(gen_error)}",
            )

        if not generated_questions:
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Item generation returned no items",
            )

        # Helper function to generate distractors from correct answer
        def generate_distractors(correct_answer: float, count: int = 3) -> List[float]:
            """Generate plausible distractors for a numeric answer."""
            distractors = []
            base = abs(correct_answer) if correct_answer != 0 else 1
            
            # Generate distractors with variations
            variations = [
                correct_answer * 0.5,
                correct_answer * 1.5,
                correct_answer + base * 0.1,
                correct_answer - base * 0.1,
                correct_answer * 2,
                correct_answer / 2,
            ]
            
            # Filter out duplicates and the correct answer
            for var in variations:
                if len(distractors) >= count:
                    break
                if abs(var - correct_answer) > 0.01 and var not in distractors:
                    distractors.append(round(var, 2))
            
            # Fill remaining slots with random variations
            while len(distractors) < count:
                random_var = correct_answer + random.uniform(-base * 0.5, base * 0.5)
                if abs(random_var - correct_answer) > 0.01 and random_var not in distractors:
                    distractors.append(round(random_var, 2))
            
            return distractors[:count]

        # Convert generated questions to items format
        generated_items = []
        for question in generated_questions:
            correct_answer = float(question.get("correct_answer", 0.0))
            
            # Use options from the question if provided, otherwise generate distractors
            options = question.get("options", [])
            if not options or len(options) < 4:
                # Generate distractors if options not provided
                distractors = generate_distractors(correct_answer, count=3)
                options = [correct_answer] + distractors
            else:
                # Ensure correct_answer is in options
                if correct_answer not in options:
                    options[0] = correct_answer
            
            # Shuffle options
            random.shuffle(options)
            
            generated_items.append({
                "question_text": question.get("question_text", ""),
                "correct_answer": correct_answer,
                "options": options,
                "solution_text": question.get("solution_text"),
                "skill_tag": question.get("skill_tag"),
                "template_id": None,  # Not using YAML templates anymore
                "context_type": "pure_math",  # Default context
                "variables": {
                    "requested_difficulty": payload.difficulty,
                    "topic": payload.topic,
                }
            })

        if not generated_items:
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Item generation returned no items",
            )

        created_ids: List[str] = []

        for generated in generated_items:
            try:
                # Each generated item already has question_text, correct_answer, options, etc.
                question_text = generated.get("question_text", "")
                if not question_text:
                    print(f"Warning: Generated item missing question_text, skipping")
                    continue
                    
                correct_answer = float(generated.get("correct_answer"))
                options = generated.get("options", [])
                template_id = generated.get("template_id")
                context_type = generated.get("context_type")
                variables = generated.get("variables", {}) or {}
                solution_text = generated.get("solution_text")
                skill_tag = generated.get("skill_tag")

                # Attach requested difficulty and topic for traceability
                variables.update(
                    {
                        "requested_difficulty": payload.difficulty,
                        "topic": payload.topic,
                    }
                )

                db_item = Item(
                    tenant_id=tenant_id,
                    question_text=question_text,
                    correct_answer=correct_answer,
                    options=options,
                    template_id=template_id,
                    context_type=context_type,
                    variables=variables,
                    solution_text=solution_text,
                    skill_tag=skill_tag,
                )
                db.add(db_item)
                await db.flush()
                created_ids.append(str(db_item.id))
            except Exception as item_error:
                error_trace = traceback.format_exc()
                print(f"Error saving generated item: {item_error}")
                print(f"Traceback: {error_trace}")
                # Continue with other items instead of failing completely
                continue

        if not created_ids:
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Failed to save any generated items to database",
            )

        return {"item_ids": created_ids}
        
    except HTTPException:
        # Re-raise HTTP exceptions as-is
        raise
    except Exception as e:
        # Catch any other unexpected errors
        error_trace = traceback.format_exc()
        print(f"Unexpected error in generate_items: {e}")
        print(f"Traceback: {error_trace}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Internal server error: {str(e)}",
        )

