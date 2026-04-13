#!/usr/bin/env python3
"""
Script to create full-length simulation exam definitions in the database.

Creates two ExamDefinition records:
  - Math Full-Length Simulation (UUID: 550e8400-e29b-41d4-a716-446655440002)
  - Reading & Writing Full-Length Simulation (UUID: 550e8400-e29b-41d4-a716-446655440003)

Digital SAT structure:
  RW:   2 modules x 27 questions, 32 min each  (54 total)
  Math: 2 modules x 22 questions, 35 min each  (44 total)

Adaptive routing: Module 1 score >= 0.58 -> Hard, else -> Easy
"""

import asyncio
import sys
import argparse
from pathlib import Path
from uuid import UUID
from typing import List, Dict, Any

project_root = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(project_root))

from sqlalchemy import select, delete
from src.db.base import AsyncSessionLocal
from src.db.models import ExamDefinition, Item

SIMULATION_MATH_UUID = UUID("550e8400-e29b-41d4-a716-446655440002")
SIMULATION_RW_UUID   = UUID("550e8400-e29b-41d4-a716-446655440003")

TENANT_ID = "public"

# ---------------------------------------------------------------------------
# Item selection helpers
# ---------------------------------------------------------------------------

async def fetch_item_ids(
    db,
    section: str,          # 'Math' or '' (RW)
    difficulties: List[str],  # e.g. ['E','M','H']
    count: int,
    exclude_ids: set = None,
) -> List[str]:
    """
    Return up to `count` item UUIDs matching section + difficulty list.
    Items already used (exclude_ids) are skipped to avoid duplication.
    """
    from sqlalchemy import text

    # Build a query that selects items by section and difficulty
    # section stored in variables->>'section'; difficulty in variables->>'difficulty'
    difficulty_list = ", ".join(f"'{d}'" for d in difficulties)
    section_clause = (
        "variables->>'section' = 'Math'"
        if section == "Math"
        else "variables->>'section' = '' OR variables->>'section' IS NULL"
    )

    # For RW we need to exclude pure Math items (those with question_type like '%Math%' when section is empty)
    if section != "Math":
        type_clause = "(variables->>'question_type' ILIKE '%RW%' OR variables->>'question_type' NOT ILIKE '%Math%')"
    else:
        type_clause = "1=1"

    query = text(f"""
        SELECT id FROM items
        WHERE tenant_id = :tenant_id
          AND ({section_clause})
          AND variables->>'difficulty' IN ({difficulty_list})
          AND {type_clause}
        ORDER BY id
    """)
    result = await db.execute(query, {"tenant_id": TENANT_ID})
    all_ids = [str(row[0]) for row in result.fetchall()]

    # Exclude already-used ids
    if exclude_ids:
        all_ids = [i for i in all_ids if i not in exclude_ids]

    # Evenly sample across difficulty buckets if possible
    if len(all_ids) <= count:
        return all_ids

    # Simple stride-based selection for even distribution
    step = len(all_ids) / count
    selected = []
    for i in range(count):
        idx = int(i * step)
        selected.append(all_ids[idx])
    return selected


def build_item_refs(item_ids: List[str]) -> List[Dict[str, Any]]:
    return [{"item_id": iid, "points": 1.0} for iid in item_ids]


# ---------------------------------------------------------------------------
# Exam structure builders
# ---------------------------------------------------------------------------

async def build_math_structure(db) -> Dict[str, Any]:
    used: set = set()

    # Module 1: mix of all difficulties (approx equal E/M/H)
    m1_ids = await fetch_item_ids(db, "Math", ["E", "M", "H"], 22, used)
    used.update(m1_ids)

    # Module 2 Hard: harder items (H, then M fallback)
    m2h_ids = await fetch_item_ids(db, "Math", ["H", "M"], 22, used)
    used.update(m2h_ids)

    # Module 2 Easy: easier items (E, then M fallback)
    m2e_ids = await fetch_item_ids(db, "Math", ["E", "M"], 22, used)
    used.update(m2e_ids)

    print(f"  math_module_1:      {len(m1_ids)} items")
    print(f"  math_module_2_hard: {len(m2h_ids)} items")
    print(f"  math_module_2_easy: {len(m2e_ids)} items")

    return {
        "id": "sim_math_root",
        "type": "test",
        "flow_strategy": "linear",
        "items": [],
        "routing_rules": [],
        "metadata": {
            "exam_type": "SIMULATION_MATH",
            "total_questions": 44,
            "duration_seconds": 4200,   # 35 min x 2 modules = 70 min total
            "routing_threshold": 0.58,
        },
        "children": [
            {
                "id": "sim_math_module_1",
                "type": "module",
                "flow_strategy": "adaptive_stage",
                "items": build_item_refs(m1_ids),
                "routing_rules": [
                    {"condition": "score < 0.58", "destination_id": "sim_math_module_2_easy"},
                    {"condition": "score >= 0.58", "destination_id": "sim_math_module_2_hard"},
                ],
                "metadata": {
                    "stage": 1,
                    "difficulty": "Mixed",
                    "total_questions": 22,
                    "time_limit_seconds": 2100,   # 35 min
                    "routing_threshold": 0.58,
                    "section": "Math",
                    "calculator_allowed": True,
                },
                "children": [],
            },
            {
                "id": "sim_math_module_2_easy",
                "type": "module",
                "flow_strategy": "linear",
                "items": build_item_refs(m2e_ids),
                "routing_rules": [],
                "metadata": {
                    "stage": 2,
                    "difficulty": "Easy",
                    "total_questions": 22,
                    "time_limit_seconds": 2100,
                    "section": "Math",
                    "calculator_allowed": True,
                },
                "children": [],
            },
            {
                "id": "sim_math_module_2_hard",
                "type": "module",
                "flow_strategy": "linear",
                "items": build_item_refs(m2h_ids),
                "routing_rules": [],
                "metadata": {
                    "stage": 2,
                    "difficulty": "Hard",
                    "total_questions": 22,
                    "time_limit_seconds": 2100,
                    "section": "Math",
                    "calculator_allowed": True,
                },
                "children": [],
            },
        ],
    }


async def build_rw_structure(db) -> Dict[str, Any]:
    used: set = set()

    m1_ids  = await fetch_item_ids(db, "", ["E", "M", "H"], 27, used)
    used.update(m1_ids)

    m2h_ids = await fetch_item_ids(db, "", ["H", "M"], 27, used)
    used.update(m2h_ids)

    m2e_ids = await fetch_item_ids(db, "", ["E", "M"], 27, used)
    used.update(m2e_ids)

    print(f"  rw_module_1:      {len(m1_ids)} items")
    print(f"  rw_module_2_hard: {len(m2h_ids)} items")
    print(f"  rw_module_2_easy: {len(m2e_ids)} items")

    return {
        "id": "sim_rw_root",
        "type": "test",
        "flow_strategy": "linear",
        "items": [],
        "routing_rules": [],
        "metadata": {
            "exam_type": "SIMULATION_RW",
            "total_questions": 54,
            "duration_seconds": 3840,   # 32 min x 2 modules = 64 min total
            "routing_threshold": 0.58,
        },
        "children": [
            {
                "id": "sim_rw_module_1",
                "type": "module",
                "flow_strategy": "adaptive_stage",
                "items": build_item_refs(m1_ids),
                "routing_rules": [
                    {"condition": "score < 0.58", "destination_id": "sim_rw_module_2_easy"},
                    {"condition": "score >= 0.58", "destination_id": "sim_rw_module_2_hard"},
                ],
                "metadata": {
                    "stage": 1,
                    "difficulty": "Mixed",
                    "total_questions": 27,
                    "time_limit_seconds": 1920,   # 32 min
                    "routing_threshold": 0.58,
                    "section": "Reading and Writing",
                },
                "children": [],
            },
            {
                "id": "sim_rw_module_2_easy",
                "type": "module",
                "flow_strategy": "linear",
                "items": build_item_refs(m2e_ids),
                "routing_rules": [],
                "metadata": {
                    "stage": 2,
                    "difficulty": "Easy",
                    "total_questions": 27,
                    "time_limit_seconds": 1920,
                    "section": "Reading and Writing",
                },
                "children": [],
            },
            {
                "id": "sim_rw_module_2_hard",
                "type": "module",
                "flow_strategy": "linear",
                "items": build_item_refs(m2h_ids),
                "routing_rules": [],
                "metadata": {
                    "stage": 2,
                    "difficulty": "Hard",
                    "total_questions": 27,
                    "time_limit_seconds": 1920,
                    "section": "Reading and Writing",
                },
                "children": [],
            },
        ],
    }


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

async def create_simulation_exams(replace: bool = False):
    async with AsyncSessionLocal() as db:
        # Check / delete existing
        for uuid, label in [
            (SIMULATION_MATH_UUID, "Simulation Math"),
            (SIMULATION_RW_UUID,   "Simulation RW"),
        ]:
            result = await db.execute(
                select(ExamDefinition).where(ExamDefinition.id == uuid)
            )
            existing = result.scalar_one_or_none()
            if existing:
                if replace:
                    print(f"Replacing existing {label} exam ({uuid})...")
                    await db.execute(
                        delete(ExamDefinition).where(ExamDefinition.id == uuid)
                    )
                else:
                    print(f"Exam {label} ({uuid}) already exists. Use --replace to overwrite.")
                    return

        # Build structures
        print("\nBuilding Math simulation structure...")
        math_structure = await build_math_structure(db)

        print("\nBuilding RW simulation structure...")
        rw_structure = await build_rw_structure(db)

        # Insert Math exam
        math_exam = ExamDefinition(
            id=SIMULATION_MATH_UUID,
            tenant_id=TENANT_ID,
            title="Full-Length Math Simulation",
            structure=math_structure,
            is_active=True,
        )
        db.add(math_exam)

        # Insert RW exam
        rw_exam = ExamDefinition(
            id=SIMULATION_RW_UUID,
            tenant_id=TENANT_ID,
            title="Full-Length Reading & Writing Simulation",
            structure=rw_structure,
            is_active=True,
        )
        db.add(rw_exam)

        await db.commit()

        print(f"\nCreated Math simulation exam: {SIMULATION_MATH_UUID}")
        print(f"Created RW simulation exam:   {SIMULATION_RW_UUID}")
        print("\nDone.")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Create full-length simulation exam definitions.")
    parser.add_argument("--replace", action="store_true", help="Replace existing simulation exams if they exist.")
    args = parser.parse_args()

    asyncio.run(create_simulation_exams(replace=args.replace))
