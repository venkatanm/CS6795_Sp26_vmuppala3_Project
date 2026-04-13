#!/usr/bin/env python3
"""
Script to hydrate AI explanations for questions using RAG and Gemini.

This script:
1. Processes questions by ID or random sample
2. Retrieves curriculum context using RAG
3. Generates explanations using Gemini with JSON output
4. Saves ai_explanation, distractor_analysis, and hint_sequence to the database

Usage:
    # Process a specific question
    python scripts/hydrate_explanations.py --id <question_id>
    
    # Process 10 random questions
    python scripts/hydrate_explanations.py --random 10
    
    # Dry run (generate but don't save)
    python scripts/hydrate_explanations.py --id <question_id> --dry-run
    python scripts/hydrate_explanations.py --random 5 --dry-run
"""

import asyncio
import io
import json
import random
import re
import sys
from pathlib import Path
from typing import List, Dict, Any, Optional
from uuid import UUID

# Force UTF-8 encoding for stdout/stderr to handle emojis on Windows
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')
sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding='utf-8')

# Add project root to path
project_root = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(project_root))

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from src.db.base import AsyncSessionLocal
from src.db.models import Item
from src.services.retrieval_service import query
from src.core.config import settings


def format_options(options: Any) -> str:
    """Format item options for display."""
    if isinstance(options, dict):
        return "\n".join([f"  {key}: {value}" for key, value in options.items()])
    elif isinstance(options, list):
        return "\n".join([f"  {chr(65+i)}: {opt}" for i, opt in enumerate(options)])
    else:
        return str(options)


def clean_and_parse_json(text: str) -> Dict[str, Any]:
    """
    Clean and parse JSON response, handling LaTeX escape issues and trailing commas.
    
    Args:
        text: Raw JSON text from Gemini response
        
    Returns:
        Parsed JSON dictionary
        
    Raises:
        json.JSONDecodeError: If JSON cannot be parsed even after repair attempts
    """
    # Strip Markdown code blocks if present
    text = text.strip()
    if text.startswith("```json"):
        text = text[7:]
    elif text.startswith("```"):
        text = text[3:]
    if text.endswith("```"):
        text = text[:-3]
    text = text.strip()
    
    # Remove trailing commas in objects and arrays (common in gemini-2.5-flash output)
    # Matches a comma followed by whitespace and a closing brace/bracket
    text = re.sub(r',(\s*})', r'\1', text)
    text = re.sub(r',(\s*])', r'\1', text)
    
    # Try parsing directly first
    try:
        return json.loads(text)
        except json.JSONDecodeError:
            # Fallback: Try to fix common LaTeX escape issues
            # Common patterns: \frac, \sqrt, \pi, etc. need to be double-escaped in JSON strings
            # We'll try a simple approach: fix common LaTeX backslash patterns
            try:
                # Fix common LaTeX patterns that might not be escaped
                # Pattern: backslash followed by letter (LaTeX command) that's not already escaped
                # We'll double-escape standalone LaTeX commands
                text_fixed = re.sub(r'(?<!\\)\\([a-zA-Z]+)', r'\\\\\1', text)
                # Remove trailing commas again after LaTeX fix
                text_fixed = re.sub(r',(\s*})', r'\1', text_fixed)
                text_fixed = re.sub(r',(\s*])', r'\1', text_fixed)
                return json.loads(text_fixed)
            except json.JSONDecodeError:
                # If that still fails, try one more time with a more aggressive fix
                # This is a blind fix - replace \ with \\ but be careful with already escaped ones
                try:
                    # Simple approach: escape backslashes that aren't already escaped
                    # This handles cases like \frac -> \\frac in JSON strings
                    text_fixed = text.replace('\\', '\\\\').replace('\\\\\\\\', '\\\\')
                    # Remove trailing commas again after LaTeX fix
                    text_fixed = re.sub(r',(\s*})', r'\1', text_fixed)
                    text_fixed = re.sub(r',(\s*])', r'\1', text_fixed)
                    return json.loads(text_fixed)
            except json.JSONDecodeError as e:
                # Give up and raise the original error with context
                raise json.JSONDecodeError(
                    f"Failed to parse JSON even after LaTeX escape repair attempts. Original error: {e.msg}",
                    e.doc,
                    e.pos
                ) from e


def print_audit(
    item_id: str,
    skill_tag: Optional[str],
    question_text: str,
    correct_answer: str,
    options: Any,
    explanation_data: Dict[str, Any],
    dry_run: bool = False,
    is_rw: bool = False,
    has_passage: bool = False,
    passage_text: str = ""
):
    """
    Print audit information with colorful formatting.
    
    Args:
        item_id: The item ID (as string to avoid async context issues)
        skill_tag: The skill tag
        question_text: The question text (extracted string)
        correct_answer: The correct answer (extracted string)
        options: The options (extracted value)
        explanation_data: The generated explanation data
        dry_run: Whether this is a dry run
        is_rw: Whether this is a Reading & Writing question
        has_passage: Whether a passage was included
        passage_text: The passage/stimulus text (extracted string to avoid async context issues)
    """
    print("\n" + "=" * 80)
    if dry_run:
        print("DRY RUN MODE - No changes will be saved")
    print("=" * 80)
    print(f"\nQUESTION ID: {item_id}")
    print(f"SKILL TAG: {skill_tag or 'N/A'}")
    print(f"QUESTION TYPE: {'Reading & Writing' if is_rw else 'Math'}")
    if has_passage:
        print(f"PASSAGE: Included ({'Yes' if has_passage else 'No'})")
    print(f"CORRECT ANSWER: {correct_answer}")
    
    # Display passage if available
    if passage_text and passage_text.strip():
        print("\n" + "-" * 80)
        print("📖 PASSAGE:")
        print("-" * 80)
        # Truncate long passages for display
        passage_display = passage_text[:800] + "..." if len(passage_text) > 800 else passage_text
        print(passage_display)
    
    print("\n" + "-" * 80)
    print("📖 QUESTION TEXT:")
    print("-" * 80)
    # Truncate long questions for display
    question_display = question_text[:500] + "..." if len(question_text) > 500 else question_text
    print(question_display)
    
    if options:
        print("\n" + "-" * 80)
        print("📋 OPTIONS:")
        print("-" * 80)
        print(format_options(options))
    
    print("\n" + "-" * 80)
    print("🧠 GENERATED DERIVATION:")
    print("-" * 80)
    derivation = explanation_data.get("derivation", "")
    # Truncate very long derivations for display
    derivation_display = derivation[:800] + "..." if len(derivation) > 800 else derivation
    print(derivation_display)
    
    print("\n" + "-" * 80)
    print("❌ DISTRACTOR ANALYSIS:")
    print("-" * 80)
    distractor_analysis = explanation_data.get("distractor_analysis", {})
    if isinstance(distractor_analysis, dict):
        for key, value in distractor_analysis.items():
            print(f"  {key}: {value[:200]}{'...' if len(value) > 200 else ''}")
    
    print("\n" + "-" * 80)
    print("💡 HINTS:")
    print("-" * 80)
    hints = explanation_data.get("hints", [])
    for i, hint in enumerate(hints, 1):
        print(f"  {i}. {hint}")
    
    print("\n" + "=" * 80)


async def generate_explanation(
    item: Item,
    rag_chunks: List[Dict[str, Any]],
    gemini_client: Any,
    passage_text: str = "",
    is_rw: bool = False
) -> Optional[Dict[str, Any]]:
    """
    Generate AI explanation using Gemini with RAG context.
    
    Args:
        item: The Item model instance
        rag_chunks: List of curriculum chunks from RAG
        gemini_client: Initialized Gemini client
        passage_text: Passage/stimulus text (for RW questions)
        is_rw: Whether this is a Reading & Writing question
        
    Returns:
        Dictionary with 'derivation', 'distractor_analysis', and 'hints' keys, or None on error
    """
    
    # Format RAG context with better structure (increased limits for batch processing)
    context_parts = []
    if rag_chunks:
        # Use top 5 chunks (increased from 2 for better context)
        for i, chunk in enumerate(rag_chunks[:5], 1):
            content = chunk.get("content", "")
            concept_name = chunk.get("concept_name", "")
            similarity = chunk.get("similarity", 0.0)
            
            if content:
                # Relaxed truncation limits for batch processing
                # Math: 2000 chars (increased from 500), RW: 3000 chars (increased from 800)
                max_length = 3000 if is_rw else 2000
                if len(content) > max_length:
                    content = content[:max_length] + "..."
                
                # Include similarity score for quality indication
                similarity_str = f" (relevance: {similarity:.2f})" if similarity > 0 else ""
                context_parts.append(
                    f"CONCEPT {i}: {concept_name if concept_name else 'Theory'}{similarity_str}\n"
                    f"CONTENT: {content}"
                )
    
    # Join with clear dividers
    context_text = "\n---\n".join(context_parts) if context_parts else ""
    
    # Format options
    options_text = format_options(item.options)
    
    # Build system prompt with appropriate instructions for Math vs RW
    question_type_instruction = ""
    if is_rw:
        question_type_instruction = """
**QUESTION TYPE:** Reading & Writing
**INSTRUCTIONS:**
- Carefully read and analyze the passage provided.
- The passage contains the context needed to answer the question.
- Pay attention to tone, style, grammar rules, and rhetorical strategies.
- For grammar questions, identify the specific rule being tested.
- For reading comprehension, cite specific evidence from the passage."""
    else:
        question_type_instruction = """
**QUESTION TYPE:** Math
**INSTRUCTIONS:**
- Show all mathematical steps clearly.
- Use proper mathematical notation.
- Explain the reasoning behind each step.
- For word problems, identify the key information and translate it into equations."""
    
    # Build system prompt
    prompt = f"""You are an expert SAT Tutor.

{question_type_instruction}

**CURRICULUM CONTEXT:**
{context_text if context_text else "No curriculum context available. Use your expert knowledge."}

**IMPORTANT RULES:**
1. If the provided CONTEXT is generic metadata (e.g., book prefaces, general introductions) and not relevant to the specific math/grammar rules needed to solve this question, IGNORE the context and solve using your internal expert knowledge.
2. JSON/LaTeX Rule: If you use LaTeX math notation (like \\frac, \\sqrt, \\pi), you MUST double-escape backslashes (e.g., \\\\frac) so the output is valid JSON. For example, use "\\\\frac{{1}}{{2}}" instead of "\\frac{{1}}{{2}}" in your JSON strings.
3. For Reading & Writing questions, ALWAYS reference specific parts of the passage when explaining your reasoning.

{f"**PASSAGE:**\n{passage_text}\n" if passage_text else ""}**QUESTION:**
{item.question_text}

**CORRECT ANSWER:** {item.correct_answer}

**OPTIONS:**
{options_text}

**TASK:**
1. Solve the problem step-by-step using the CONTEXT concepts (if relevant) or your expert knowledge.
2. Analyze why each WRONG option is incorrect.
3. Create 3 progressive hints.

**OUTPUT JSON:**
{{
    "derivation": "A detailed, step-by-step explanation of how to solve this problem. Show all reasoning and calculations. Remember to double-escape LaTeX backslashes (e.g., \\\\frac instead of \\frac).",
    "distractor_analysis": {{
        "A": "Specific error diagnosis for why choice A is incorrect",
        "B": "Specific error diagnosis for why choice B is incorrect",
        "C": "Specific error diagnosis for why choice C is incorrect",
        "D": "Specific error diagnosis for why choice D is incorrect"
    }},
    "hints": [
        "First progressive hint that guides without giving away the answer",
        "Second progressive hint that provides more direction",
        "Third progressive hint that is more specific but still requires thinking"
    ]
}}"""

    response_text = None
    try:
        # Call Gemini with JSON response format
        # Try with config parameter for JSON response (if supported by the API)
        try:
            response = gemini_client.models.generate_content(
                model=settings.GEMINI_MODEL,
                contents=[{"parts": [{"text": prompt}]}],
                config={
                    "response_mime_type": "application/json"
                }
            )
        except (TypeError, AttributeError, Exception) as config_error:
            # Fallback: if config parameter not supported, use standard call
            print(f"  [WARN] JSON response_mime_type not supported, using standard call: {config_error}")
            response = gemini_client.models.generate_content(
                model=settings.GEMINI_MODEL,
                contents=[{"parts": [{"text": prompt}]}]
            )
        
        # Extract text response
        response_text = getattr(response, "text", None)
        if not response_text or not isinstance(response_text, str):
            print(f"  [ERROR] Invalid response format for item {item.id}")
            return None
        
        # Clean and parse JSON (handles LaTeX escape issues)
        explanation_data = clean_and_parse_json(response_text)
        
        # Validate structure
        if not isinstance(explanation_data, dict):
            print(f"  [ERROR] Response is not a dictionary for item {item.id}")
            return None
        
        required_keys = ["derivation", "distractor_analysis", "hints"]
        if not all(key in explanation_data for key in required_keys):
            print(f"  [ERROR] Missing required keys in response for item {item.id}")
            print(f"     Found keys: {list(explanation_data.keys())}")
            return None
        
        # Validate hints is a list with 3 items
        if not isinstance(explanation_data["hints"], list) or len(explanation_data["hints"]) != 3:
            print(f"  [ERROR] Hints must be a list of 3 strings for item {item.id}")
            print(f"     Found: {explanation_data['hints']}")
            return None
        
        # Validate distractor_analysis is a dict
        if not isinstance(explanation_data["distractor_analysis"], dict):
            print(f"  [ERROR] distractor_analysis must be a dictionary for item {item.id}")
            return None
        
        return explanation_data
        
    except json.JSONDecodeError as e:
        print(f"  ❌ JSON decode error for item {item.id}: {e}")
        if response_text:
            print(f"     Response text: {response_text[:300]}...")
        return None
    except Exception as e:
        print(f"  ❌ Error generating explanation for item {item.id}: {e}")
        import traceback
        traceback.print_exc()
        return None


async def process_item(
    item: Item,
    db: AsyncSession,
    gemini_client: Any,
    dry_run: bool = False
) -> bool:
    """
    Process a single item.
    
    Returns:
        True if successful, False otherwise
    """
    try:
        print(f"\n[PROCESSING] Item {item.id}...")
        
        # Extract passage/stimulus text while still in async context
        # Try direct attribute first, then fall back to variables JSONB
        passage_text = ""
        if hasattr(item, 'stimulus') and item.stimulus:
            passage_text = item.stimulus
        
        # Parse variables if needed (for both passage extraction and question type)
        variables = item.variables
        if isinstance(variables, str):
            try:
                variables = json.loads(variables)
            except:
                variables = {}
        elif not isinstance(variables, dict):
            variables = {}
        
        # Extract passage from variables JSONB if not already found
        if not passage_text and variables:
            passage_text = (
                variables.get("stimulus") or 
                variables.get("passageText") or 
                variables.get("passage") or 
                ""
            )
        
        # Determine question type
        question_type = variables.get("question_type", "") if isinstance(variables, dict) else ""
        is_rw = "RW" in question_type or "Reading" in question_type or "Writing" in question_type
        is_math = "Math" in question_type
        
        # Build enhanced query for RAG retrieval
        # For RW questions, include passage + question + skill
        # For Math questions, include question + skill
        rag_query_parts = []
        
        if is_rw and passage_text:
            # For RW: passage is critical context
            # Truncate passage if too long (keep first 1000 chars for query)
            passage_for_query = passage_text[:1000] + "..." if len(passage_text) > 1000 else passage_text
            rag_query_parts.append(passage_for_query)
        
        if item.question_text:
            # Truncate question if too long
            question_for_query = item.question_text[:500] + "..." if len(item.question_text) > 500 else item.question_text
            rag_query_parts.append(question_for_query)
        
        if item.skill_tag:
            # Include skill tag for better context matching
            rag_query_parts.append(item.skill_tag)
        
        # Combine into query text
        rag_query_text = " ".join(rag_query_parts) if rag_query_parts else item.question_text or ""
        
        # Retrieve curriculum chunks using enhanced query (increased to top 5 for batch processing)
        rag_chunks = []
        if rag_query_text:
            try:
                rag_chunks = await query(
                    query_text=rag_query_text,
                    top_k=5,  # Increased from 2 to 5 for better context
                    db=db
                )
                print(f"  [OK] Retrieved {len(rag_chunks)} RAG chunks")
                if is_rw and passage_text:
                    print(f"  [INFO] Included passage in RAG query ({len(passage_text)} chars)")
            except Exception as e:
                print(f"  [WARN] RAG retrieval failed: {e}")
                # Continue without RAG context
        
        # Generate explanation
        explanation_data = await generate_explanation(
            item, 
            rag_chunks, 
            gemini_client,
            passage_text=passage_text,
            is_rw=is_rw
        )
        
        if explanation_data:
            # Extract all data needed for print_audit BEFORE calling it
            # This prevents MissingGreenlet errors by ensuring all data is loaded in async context
            item_id_str = str(item.id)
            skill_tag_str = item.skill_tag
            question_text_str = item.question_text or ""
            correct_answer_str = item.correct_answer or ""
            options_value = item.options  # This is already a JSONB value, should be safe
            
            # Print audit information (using extracted data, not item object)
            print_audit(
                item_id=item_id_str,
                skill_tag=skill_tag_str,
                question_text=question_text_str,
                correct_answer=correct_answer_str,
                options=options_value,
                explanation_data=explanation_data,
                dry_run=dry_run,
                is_rw=is_rw,
                has_passage=bool(passage_text),
                passage_text=passage_text
            )
            
            if not dry_run:
                # Update item
                item.ai_explanation = explanation_data.get("derivation", "")
                item.distractor_analysis = explanation_data.get("distractor_analysis", {})
                item.hint_sequence = explanation_data.get("hints", [])
                
                # Commit to database
                await db.commit()
                await db.refresh(item)
                
                print(f"  [OK] Saved explanation for item {item.id}")
            else:
                print(f"  [DRY RUN] Would save explanation for item {item.id}")
            
            return True
        else:
            print(f"  [ERROR] Failed to generate explanation for item {item.id}")
            return False
            
    except Exception as e:
        print(f"  [ERROR] Error processing item {item.id}: {e}")
        import traceback
        traceback.print_exc()
        await db.rollback()
        return False


async def main(
    question_id: Optional[str] = None,
    random_count: Optional[int] = None,
    dry_run: bool = False
):
    """
    Main function to hydrate explanations.
    
    Args:
        question_id: Specific question ID to process (UUID or string)
        random_count: Number of random questions to process
        dry_run: If True, generate but don't save to database
    """
    print("=" * 80)
    print("Starting Explanation Hydration Pipeline")
    print("=" * 80)
    
    if dry_run:
        print("DRY RUN MODE - No changes will be saved to database")
    
    # Validate arguments
    if question_id and random_count:
        print("[ERROR] Cannot specify both --id and --random")
        sys.exit(1)
    
    if not question_id and not random_count:
        print("[ERROR] Must specify either --id <question_id> or --random <N>")
        sys.exit(1)
    
    # Check Gemini API key
    if not settings.GEMINI_API_KEY:
        print("[ERROR] GEMINI_API_KEY not configured in settings")
        sys.exit(1)
    
    # Initialize Gemini client
    try:
        import google.genai as genai  # type: ignore
        gemini_client = genai.Client(api_key=settings.GEMINI_API_KEY)
        print(f"[OK] Initialized Gemini client with model: {settings.GEMINI_MODEL}")
    except Exception as e:
        print(f"[ERROR] Failed to initialize Gemini client: {e}")
        sys.exit(1)
    
    # Initialize database session
    async with AsyncSessionLocal() as db:
        try:
            items_to_process: List[Item] = []
            
            if question_id:
                # Case 1: Process specific question by ID
                print(f"\n[SEARCH] Looking for question with ID: {question_id}")
                
                # Try UUID first
                try:
                    question_uuid = UUID(question_id)
                    result = await db.execute(
                        select(Item).where(Item.id == question_uuid)
                    )
                    item = result.scalar_one_or_none()
                except ValueError:
                    # Not a valid UUID, try as string (logical_id)
                    result = await db.execute(
                        select(Item).where(Item.logical_id == question_id)
                    )
                    item = result.scalar_one_or_none()
                
                if not item:
                    print(f"[ERROR] Question with ID '{question_id}' not found")
                    sys.exit(1)
                
                items_to_process = [item]
                print(f"[OK] Found question: {item.id}")
            
            elif random_count:
                # Case 2: Process random sample
                print(f"\n[RANDOM] Selecting {random_count} random questions...")
                
                # Get all items where ai_explanation IS NULL
                result = await db.execute(
                    select(Item.id).where(Item.ai_explanation.is_(None))
                )
                all_ids = [row[0] for row in result.all()]
                
                if not all_ids:
                    print("[OK] No items found that need explanations. All items are already hydrated!")
                    return
                
                if len(all_ids) < random_count:
                    print(f"[WARN] Only {len(all_ids)} items available, processing all of them")
                    random_count = len(all_ids)
                
                # Sample random IDs
                sampled_ids = random.sample(all_ids, random_count)
                
                # Fetch the actual items
                result = await db.execute(
                    select(Item).where(Item.id.in_(sampled_ids))
                )
                items_to_process = result.scalars().all()
                
                print(f"[OK] Selected {len(items_to_process)} random questions")
            
            # Process items
            total_items = len(items_to_process)
            success_count = 0
            error_count = 0
            
            for i, item in enumerate(items_to_process, 1):
                print(f"\n[{i}/{total_items}] Processing item {item.id}...")
                success = await process_item(item, db, gemini_client, dry_run=dry_run)
                
                if success:
                    success_count += 1
                else:
                    error_count += 1
                
                # Small delay between items to avoid rate limits
                if i < total_items:
                    await asyncio.sleep(0.5)
            
            # Summary
            print("\n" + "=" * 80)
            print("Summary")
            print("=" * 80)
            print(f"[OK] Successfully processed: {success_count} items")
            print(f"[ERROR] Errors: {error_count} items")
            if total_items > 0:
                print(f"Success rate: {(success_count / total_items * 100):.1f}%")
            if dry_run:
                print("DRY RUN MODE - No changes were saved")
            print("=" * 80)
            
        except Exception as e:
            print(f"[ERROR] Fatal error: {e}")
            import traceback
            traceback.print_exc()
            sys.exit(1)


if __name__ == "__main__":
    import argparse
    
    parser = argparse.ArgumentParser(
        description="Hydrate AI explanations for questions using RAG and Gemini",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  # Process a specific question
  python scripts/hydrate_explanations.py --id 550e8400-e29b-41d4-a716-446655440000
  
  # Process 10 random questions
  python scripts/hydrate_explanations.py --random 10
  
  # Dry run (generate but don't save)
  python scripts/hydrate_explanations.py --id <question_id> --dry-run
  python scripts/hydrate_explanations.py --random 5 --dry-run
        """
    )
    
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument(
        "--id",
        type=str,
        help="Process a specific question by ID (UUID or logical_id)"
    )
    group.add_argument(
        "--random",
        type=int,
        metavar="N",
        help="Process N random questions that have ai_explanation IS NULL"
    )
    
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Generate explanations but do not save to database"
    )
    
    args = parser.parse_args()
    
    asyncio.run(main(
        question_id=args.id,
        random_count=args.random,
        dry_run=args.dry_run
    ))
