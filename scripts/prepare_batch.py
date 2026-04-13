#!/usr/bin/env python3
"""
Script to prepare batch jobs for Gemini batch API.

This script:
1. Fetches items where ai_explanation IS NULL
2. Retrieves RAG context for each item
3. Constructs Few-Shot prompts using the golden examples
4. Creates batch job objects in JSONL format for Gemini batch API
5. Writes to batch_jobs/input_test.jsonl (--test) or batch_jobs/input_full.jsonl

Usage:
    # Generate test batch (10 random items)
    python scripts/prepare_batch.py --test
    
    # Generate full batch (all items with NULL ai_explanation)
    python scripts/prepare_batch.py
"""

import asyncio
import io
import json
import os
import random
import sys
from pathlib import Path
from typing import List, Dict, Any, Optional

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

# Few-Shot Examples for pedagogical quality improvement (copied from compare_shots.py)
FEW_SHOT_EXAMPLES = """
**EXAMPLE 1 (Math - Calculation Focus):**
Question: If 5x - 3 = 12, what is the value of x?
Teacher's Guide: {
  "derivation": "Step 1: Add 3 to both sides to get 5x = 15.\\nStep 2: Divide by 5 to find x = 3.",
  "distractor_analysis": {
    "A": "This answer comes from subtracting 3 instead of adding.",
    "B": "This result happens if you divide by 3 instead of 5."
  },
  "hints": ["Isolate the x term first.", "Add 3 to both sides.", "Divide by 5."]
}

**EXAMPLE 2 (Reading - Evidence Focus):**
Passage: The research team discovered that the bees prefer blue flowers...
Question: What is the main finding?
Teacher's Guide: {
  "derivation": "The passage explicitly states in the second sentence that 'bees prefer blue flowers'. Option C matches this.",
  "distractor_analysis": {
    "A": "This contradicts the third sentence.",
    "B": "This is a minor detail, not the main finding."
  },
  "hints": ["Look for the sentence describing the team's discovery.", "Focus on the primary preference mentioned."]
}
"""


def format_options(options: Any) -> str:
    """Format item options for display."""
    if isinstance(options, dict):
        return "\n".join([f"  {key}: {value}" for key, value in options.items()])
    elif isinstance(options, list):
        return "\n".join([f"  {chr(65+i)}: {opt}" for i, opt in enumerate(options)])
    else:
        return str(options)


async def prepare_batch_job(
    item: Item,
    db: AsyncSession,
    rag_context: List[Dict[str, Any]],
    passage_text: str = ""
) -> Dict[str, Any]:
    """
    Prepare a single batch job object for Gemini batch API.
    
    Args:
        item: The Item model instance
        db: Database session (for potential future use)
        rag_context: List of RAG chunks from retrieval service
        passage_text: Passage/stimulus text (for RW questions)
        
    Returns:
        Batch job object in Gemini batch API format
    """
    # Format RAG context (increased limits for batch processing)
    context_parts = []
    if rag_context:
        # Use top 5 chunks (increased from 2 for better context)
        for i, chunk in enumerate(rag_context[:5], 1):
            content = chunk.get("content", "")
            concept_name = chunk.get("concept_name", "")
            similarity = chunk.get("similarity", 0.0)
            
            if content:
                # Relaxed truncation limits for batch processing
                # Math: 2000 chars (increased from 500), RW: 3000 chars (increased from 800)
                max_length = 3000 if passage_text else 2000
                if len(content) > max_length:
                    content = content[:max_length] + "..."
                
                similarity_str = f" (relevance: {similarity:.2f})" if similarity > 0 else ""
                context_parts.append(
                    f"CONCEPT {i}: {concept_name if concept_name else 'Theory'}{similarity_str}\n"
                    f"CONTENT: {content}"
                )
    
    # Join with clear dividers
    context_text = "\n---\n".join(context_parts) if context_parts else ""
    
    # Format options
    options_text = format_options(item.options)
    
    # Parse variables JSONB (might be dict, string, or None)
    variables = {}
    if item.variables:
        if isinstance(item.variables, dict):
            variables = item.variables
        elif isinstance(item.variables, str):
            try:
                variables = json.loads(item.variables)
            except:
                variables = {}
    
    # 1. Prepare Official Solution Text (The "Teacher's Secret Note")
    solution_block = ""
    if item.solution_text and len(item.solution_text) > 10:
        solution_block = f"""
**OFFICIAL SOLUTION TEXT (Teacher's Reference):**
{item.solution_text}
(Use this logic to ensure accuracy, but rewrite it to be engaging and student-friendly. Do NOT just copy it.)
"""
    
    # 2. Extract metadata
    # Extract difficulty from variables
    difficulty_raw = variables.get("difficulty") or variables.get("difficulty_level") or ""
    # Map difficulty to number (1=Easy, 2=Medium, 3=Hard, 4=Very Hard)
    if isinstance(difficulty_raw, (int, float)):
        difficulty_level = int(difficulty_raw)
    elif isinstance(difficulty_raw, str):
        difficulty_upper = difficulty_raw.upper()
        if difficulty_upper in ["E", "EASY", "1"]:
            difficulty_level = 1
        elif difficulty_upper in ["M", "MEDIUM", "2"]:
            difficulty_level = 2
        elif difficulty_upper in ["H", "HARD", "3"]:
            difficulty_level = 3
        else:
            difficulty_level = 2  # Default to Medium
    else:
        difficulty_level = 2  # Default to Medium
    
    diff_map = {1: "Easy", 2: "Medium", 3: "Hard", 4: "Very Hard"}
    difficulty_str = diff_map.get(difficulty_level, "Unknown")
    
    # Extract domain from context_type or variables
    domain = item.context_type or variables.get("section") or ""
    if not domain:
        # Derive from question type
        question_type = variables.get("question_type", "")
        if "Math" in question_type or "RW" not in question_type:
            domain = "Math"
        else:
            domain = "Reading and Writing"
    
    # 3. Prepare Metadata Context
    meta_block = f"""
**METADATA:**
- Domain: {domain}
- Skill: {item.skill_tag or "N/A"}
- Difficulty: {difficulty_str}
"""
    
    # 4. Check for Images (Prevent Hallucination)
    image_warning = ""
    image_paths = variables.get("image_paths", [])
    if image_paths and isinstance(image_paths, list) and len(image_paths) > 0:
        image_warning = "\n[WARNING: This question contains an image/graph that is NOT visible to you. Focus your explanation on the text and mathematical principles provided.]\n"
    
    # Determine question type for instructions
    is_rw = bool(passage_text)
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
    
    # Build the full prompt using Few-Shot examples
    full_prompt = f"""You are an expert SAT Tutor.

{question_type_instruction}

**CURRICULUM CONTEXT:**
{context_text if context_text else "No curriculum context available. Use your expert knowledge."}

{meta_block}
{solution_block}
**IMPORTANT RULES:**
1. If the provided CONTEXT is generic metadata (e.g., book prefaces, general introductions) and not relevant to the specific math/grammar rules needed to solve this question, IGNORE the context and solve using your internal expert knowledge.
2. JSON/LaTeX Rule: If you use LaTeX math notation (like \\frac, \\sqrt, \\pi), you MUST double-escape backslashes (e.g., \\\\frac) so the output is valid JSON. For example, use "\\\\frac{{1}}{{2}}" instead of "\\frac{{1}}{{2}}" in your JSON strings.
3. For Reading & Writing questions, ALWAYS reference specific parts of the passage when explaining your reasoning.

**FEW-SHOT EXAMPLES (Learn from these patterns):**
{FEW_SHOT_EXAMPLES}

**NOW SOLVE THIS QUESTION:**
{f"**PASSAGE:**\n{passage_text}\n" if passage_text else ""}**QUESTION:**
{item.question_text}
{image_warning}
**CORRECT ANSWER:** {item.correct_answer}

**OPTIONS:**
{options_text}

**TASK:**
1. Solve the problem step-by-step using the CONTEXT concepts (if relevant) or your expert knowledge.
2. Analyze why each WRONG option is incorrect.
3. Create 3 progressive hints.

**OUTPUT JSON (Follow the format from the examples above):**
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

    # Create batch job object (Native Request Format)
    batch_job = {
        "custom_id": str(item.id),
        "request": {
            "contents": [{"parts": [{"text": full_prompt}]}],
            "generationConfig": {
                "response_mime_type": "application/json",
                "temperature": 0.2
            }
        }
    }
    
    return batch_job


async def main(test_mode: bool = False, chunk_size: int = 420):
    """
    Main function to prepare batch jobs.
    
    Args:
        test_mode: If True, process only 10 random items. If False, process all items with NULL ai_explanation.
        chunk_size: Maximum number of items per chunk file (default: 500).
    """
    print("=" * 80)
    print("Batch Job Preparation for Gemini Batch API")
    print("=" * 80)
    
    # Determine output filename pattern
    if test_mode:
        filename_pattern = "batch_jobs/input_test.jsonl"
        print("[MODE] Test mode - Processing 10 random items")
        chunk_size = 10  # Override chunk_size for test mode
    else:
        filename_pattern = "batch_jobs/input_full_{:04d}.jsonl"
        print(f"[MODE] Full mode - Processing all items with NULL ai_explanation")
        print(f"[INFO] Chunk size: {chunk_size} items per file")
    
    # Create batch_jobs directory if it doesn't exist
    os.makedirs("batch_jobs", exist_ok=True)
    
    async with AsyncSessionLocal() as db:
        try:
            # Query items where ai_explanation IS NULL
            if test_mode:
                # Get all IDs first, then sample
                result = await db.execute(
                    select(Item.id).where(Item.ai_explanation.is_(None))
                )
                all_ids = [row[0] for row in result.all()]
                
                if not all_ids:
                    print("[ERROR] No items found with NULL ai_explanation")
                    return
                
                if len(all_ids) < 10:
                    print(f"[WARN] Only {len(all_ids)} items available, processing all of them")
                    sampled_ids = all_ids
                else:
                    sampled_ids = random.sample(all_ids, 10)
                
                # Fetch the sampled items
                result = await db.execute(
                    select(Item).where(Item.id.in_(sampled_ids))
                )
                items_to_process = result.scalars().all()
            else:
                # Fetch all items with NULL ai_explanation
                result = await db.execute(
                    select(Item).where(Item.ai_explanation.is_(None))
                )
                items_to_process = result.scalars().all()
            
            total_items = len(items_to_process)
            print(f"[INFO] Found {total_items} items to process")
            
            if total_items == 0:
                print("[INFO] No items to process. All items already have AI explanations!")
                return
            
            # Calculate number of chunks needed
            num_chunks = (total_items + chunk_size - 1) // chunk_size  # Ceiling division
            print(f"[INFO] Will create {num_chunks} chunk file(s)")
            
            # Process items in chunks
            total_processed = 0
            chunk_num = 1
            
            for chunk_start in range(0, total_items, chunk_size):
                chunk_end = min(chunk_start + chunk_size, total_items)
                chunk_items = items_to_process[chunk_start:chunk_end]
                
                # Determine filename for this chunk
                if test_mode:
                    filename = filename_pattern
                else:
                    filename = filename_pattern.format(chunk_num)
                
                print(f"\n[CHUNK {chunk_num}/{num_chunks}] Processing items {chunk_start+1}-{chunk_end} of {total_items}...")
                
                # Process items in this chunk
                batch_jobs = []
                chunk_processed = 0
                
                for i, item in enumerate(chunk_items, 1):
                    global_index = chunk_start + i
                    print(f"  [{global_index}/{total_items}] Processing item {item.id}...")
                    
                    try:
                        # Extract passage/stimulus text while still in async context
                        passage_text = ""
                        if hasattr(item, 'stimulus') and item.stimulus:
                            passage_text = item.stimulus
                        
                        # Parse variables if needed
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
                        
                        # Build RAG query
                        rag_query_parts = []
                        
                        if passage_text:
                            passage_for_query = passage_text[:1000] + "..." if len(passage_text) > 1000 else passage_text
                            rag_query_parts.append(passage_for_query)
                        
                        if item.question_text:
                            question_for_query = item.question_text[:500] + "..." if len(item.question_text) > 500 else item.question_text
                            rag_query_parts.append(question_for_query)
                        
                        if item.skill_tag:
                            rag_query_parts.append(item.skill_tag)
                        
                        rag_query_text = " ".join(rag_query_parts) if rag_query_parts else item.question_text or ""
                        
                        # Retrieve RAG context (increased to top 5 for batch processing)
                        rag_context = []
                        if rag_query_text:
                            try:
                                rag_context = await query(
                                    query_text=rag_query_text,
                                    top_k=5,  # Increased from 2 to 5 for better context
                                    db=db
                                )
                                print(f"    [OK] Retrieved {len(rag_context)} RAG chunks")
                            except Exception as e:
                                print(f"    [WARN] RAG retrieval failed: {e}")
                                # Continue without RAG context
                        
                        # Prepare batch job
                        batch_job = await prepare_batch_job(
                            item,
                            db,
                            rag_context,
                            passage_text=passage_text
                        )
                        
                        batch_jobs.append(batch_job)
                        chunk_processed += 1
                        
                    except Exception as e:
                        print(f"    [ERROR] Failed to process item {item.id}: {e}")
                        import traceback
                        traceback.print_exc()
                        continue
                
                # Write chunk to JSONL file
                print(f"\n  [WRITING] Writing {chunk_processed} batch jobs to {filename}...")
                with open(filename, 'w', encoding='utf-8') as f:
                    for batch_job in batch_jobs:
                        f.write(json.dumps(batch_job, ensure_ascii=False) + '\n')
                
                file_size = os.path.getsize(filename) / 1024
                print(f"  [OK] Chunk {chunk_num} prepared: {chunk_processed} jobs in {filename}")
                print(f"  [INFO] File size: {file_size:.2f} KB")
                
                total_processed += chunk_processed
                chunk_num += 1
            
            # Summary
            print(f"\n[SUMMARY] Prepared {total_processed} jobs across {num_chunks} chunk file(s)")
            if not test_mode:
                print(f"[INFO] Chunk files:")
                for i in range(1, num_chunks + 1):
                    chunk_file = filename_pattern.format(i)
                    if os.path.exists(chunk_file):
                        size = os.path.getsize(chunk_file) / 1024
                        print(f"  - {chunk_file} ({size:.2f} KB)")
            print("=" * 80)
            
        except Exception as e:
            print(f"[ERROR] Fatal error: {e}")
            import traceback
            traceback.print_exc()
            sys.exit(1)


if __name__ == "__main__":
    import argparse
    
    parser = argparse.ArgumentParser(
        description="Prepare batch jobs for Gemini batch API",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  # Generate test batch (10 random items)
  python scripts/prepare_batch.py --test
  
  # Generate full batch (all items with NULL ai_explanation)
  python scripts/prepare_batch.py
        """
    )
    
    parser.add_argument(
        '--test',
        action='store_true',
        help='Generate only 10 random items for testing'
    )
    
    parser.add_argument(
        '--chunk-size',
        type=int,
        default=420,
        help='Maximum number of items per chunk file (default: 420)'
    )
    
    args = parser.parse_args()
    
    asyncio.run(main(test_mode=args.test, chunk_size=args.chunk_size))
