"""
Seed concepts into the DB and link items to concepts via question_concepts.

Steps:
  1. Seed all Math concepts from seed_concepts.py (CONCEPTS_DATA + prerequisites + misconceptions)
  2. Seed RW concepts based on actual skill_tags found in the items table
  3. Link items to concepts via question_concepts using skill_tag -> concept name mapping
  4. Report row counts

Run from project root:
  python scripts/seed_concepts_and_links.py
"""

import asyncio
import sys
import os

# Ensure project root is on path
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession
from src.db.base import AsyncSessionLocal
from src.db.models import (
    Concept, QuestionConcept, Item,
    Misconception, ConceptPrerequisite, ConceptMisconception
)

# ─────────────────────────────────────────────
# Math concepts come from seed_concepts.py
# ─────────────────────────────────────────────
from src.graph.seed_concepts import (
    CONCEPTS_DATA, PREREQUISITES, MISCONCEPTIONS_DATA
)

# ─────────────────────────────────────────────
# RW concepts (based on actual Digital SAT skill_tags for Reading & Writing)
# ─────────────────────────────────────────────
RW_CONCEPTS_DATA = [
    # Top-level domain
    {"name": "Reading and Writing", "category": "Reading and Writing", "level": 1,
     "description": "SAT Reading and Writing section skills"},

    # Craft and Structure
    {"name": "Words in Context", "category": "Craft and Structure", "level": 2,
     "description": "Determining meaning of words and phrases in context"},
    {"name": "Text Structure and Purpose", "category": "Craft and Structure", "level": 2,
     "description": "Analyzing how authors structure texts and why"},
    {"name": "Cross-Text Connections", "category": "Craft and Structure", "level": 2,
     "description": "Comparing and synthesizing information across multiple texts"},

    # Information and Ideas
    {"name": "Central Ideas and Details", "category": "Information and Ideas", "level": 2,
     "description": "Identifying central ideas and supporting details"},
    {"name": "Command of Evidence", "category": "Information and Ideas", "level": 2,
     "description": "Using textual or quantitative evidence to support claims"},
    {"name": "Inferences", "category": "Information and Ideas", "level": 2,
     "description": "Drawing logical inferences from text"},

    # Standard English Conventions
    {"name": "Boundaries", "category": "Standard English Conventions", "level": 2,
     "description": "Sentence boundaries: punctuation and run-ons"},
    {"name": "Form, Structure, and Sense", "category": "Standard English Conventions", "level": 2,
     "description": "Grammar: verb form, pronoun agreement, modifier placement"},

    # Expression of Ideas
    {"name": "Rhetorical Synthesis", "category": "Expression of Ideas", "level": 2,
     "description": "Combining information from notes to accomplish rhetorical goals"},
    {"name": "Transitions", "category": "Expression of Ideas", "level": 2,
     "description": "Using transitional words and phrases effectively"},
]

# ─────────────────────────────────────────────
# Skill_tag -> concept name mapping
# Keys are exact skill_tag strings from the DB; values are concept names already in CONCEPTS_DATA or RW_CONCEPTS_DATA
# ─────────────────────────────────────────────
SKILL_TAG_TO_CONCEPT = {
    # ── Math ──
    "Linear equations in one variable":                                          "Linear Equations in One Variable",
    "Linear equations in two variables":                                         "Linear Functions",
    "Systems of two linear equations in two variables":                          "Systems of Linear Equations",
    "Linear functions":                                                          "Linear Functions",
    "Linear inequalities in one or two variables":                               "Linear Inequalities",
    "Nonlinear functions":                                                       "Quadratic Equations",   # best umbrella concept
    "Nonlinear equations in one variable and systems of equations in two variables ": "Quadratic Equations",
    "Equivalent expressions":                                                    "Polynomial Operations",
    "Ratios, rates, proportional relationships, and units":                      "Ratios and Proportions",
    "Percentages":                                                               "Percentages",
    "One-variable data: Distributions and measures of center and spread":        "Mean, Median, Mode",
    "Two-variable data: Models and scatterplots":                                "Scatterplots",
    "Probability and conditional probability":                                   "Probability",
    "Inference from sample statistics and margin of error ":                     "Range and Standard Deviation",
    "Evaluating statistical claims: Observational studies and experiments ":     "Range and Standard Deviation",
    "Area and volume":                                                           "Area and Perimeter",
    "Lines, angles, and triangles":                                              "Triangles",
    "Right triangles and trigonometry":                                          "Right Triangle Trigonometry",
    "Circles":                                                                   "Circles",

    # ── Reading & Writing ──
    "Command of Evidence":     "Command of Evidence",
    "Words in Context":        "Words in Context",
    "Rhetorical Synthesis":    "Rhetorical Synthesis",
    "Boundaries":              "Boundaries",
    "Form, Structure, and Sense": "Form, Structure, and Sense",
    "Transitions":             "Transitions",
    "Text Structure and Purpose": "Text Structure and Purpose",
    "Inferences":              "Inferences",
    "Central Ideas and Details": "Central Ideas and Details",
    "Cross-Text Connections":  "Cross-Text Connections",
    "Cross-text Connections":  "Cross-Text Connections",   # alternate casing
}


# ─────────────────────────────────────────────
# Helpers
# ─────────────────────────────────────────────

async def upsert_concepts(db: AsyncSession, concepts_data: list) -> dict:
    """Insert concepts that don't already exist. Returns name->Concept map."""
    concept_map: dict = {}
    created = 0

    for data in concepts_data:
        result = await db.execute(select(Concept).where(Concept.name == data["name"]))
        existing = result.scalar_one_or_none()
        if existing:
            concept_map[data["name"]] = existing
        else:
            concept = Concept(
                name=data["name"],
                description=data.get("description"),
                category=data.get("category"),
                level=data.get("level"),
            )
            db.add(concept)
            await db.flush()
            concept_map[data["name"]] = concept
            created += 1

    await db.commit()
    return concept_map, created


async def upsert_misconceptions(db: AsyncSession) -> dict:
    """Insert misconceptions that don't already exist."""
    mis_map: dict = {}
    created = 0

    for _, mis_name, mis_desc in MISCONCEPTIONS_DATA:
        result = await db.execute(select(Misconception).where(Misconception.name == mis_name))
        existing = result.scalar_one_or_none()
        if existing:
            mis_map[mis_name] = existing
        else:
            m = Misconception(name=mis_name, description=mis_desc)
            db.add(m)
            await db.flush()
            mis_map[mis_name] = m
            created += 1

    await db.commit()
    return mis_map, created


async def upsert_prerequisites(db: AsyncSession, concept_map: dict) -> int:
    created = 0
    for prereq_name, dep_name in PREREQUISITES:
        if prereq_name not in concept_map or dep_name not in concept_map:
            print(f"  [WARN] Missing concept for prereq: {prereq_name} -> {dep_name}")
            continue
        result = await db.execute(
            select(ConceptPrerequisite).where(
                ConceptPrerequisite.prerequisite_id == concept_map[prereq_name].id,
                ConceptPrerequisite.dependent_id == concept_map[dep_name].id,
            )
        )
        if result.scalar_one_or_none():
            continue
        db.add(ConceptPrerequisite(
            prerequisite_id=concept_map[prereq_name].id,
            dependent_id=concept_map[dep_name].id,
        ))
        created += 1
    await db.commit()
    return created


async def upsert_concept_misconceptions(db: AsyncSession, concept_map: dict, mis_map: dict) -> int:
    created = 0
    for concept_name, mis_name, _ in MISCONCEPTIONS_DATA:
        if concept_name not in concept_map or mis_name not in mis_map:
            continue
        result = await db.execute(
            select(ConceptMisconception).where(
                ConceptMisconception.concept_id == concept_map[concept_name].id,
                ConceptMisconception.misconception_id == mis_map[mis_name].id,
            )
        )
        if result.scalar_one_or_none():
            continue
        db.add(ConceptMisconception(
            concept_id=concept_map[concept_name].id,
            misconception_id=mis_map[mis_name].id,
        ))
        created += 1
    await db.commit()
    return created


async def link_items_to_concepts(db: AsyncSession, concept_map: dict) -> tuple:
    """
    For every item whose skill_tag maps to a concept, insert a question_concepts row
    (if one doesn't already exist).
    """
    linked = 0
    skipped_no_map = 0
    skipped_no_concept = 0
    skipped_existing = 0

    # Fetch all items that have a skill_tag we care about
    result = await db.execute(
        select(Item.id, Item.skill_tag).where(Item.skill_tag.isnot(None))
    )
    items = result.fetchall()

    # Pre-fetch existing question_concept pairs to avoid per-row round-trips
    existing_pairs = set()
    existing_result = await db.execute(
        select(QuestionConcept.question_id, QuestionConcept.concept_id)
    )
    for q_id, c_id in existing_result.fetchall():
        existing_pairs.add((str(q_id), str(c_id)))

    batch = []
    for item_id, skill_tag in items:
        concept_name = SKILL_TAG_TO_CONCEPT.get(skill_tag)
        if not concept_name:
            skipped_no_map += 1
            continue
        concept = concept_map.get(concept_name)
        if not concept:
            skipped_no_concept += 1
            continue
        pair = (str(item_id), str(concept.id))
        if pair in existing_pairs:
            skipped_existing += 1
            continue
        batch.append(QuestionConcept(question_id=item_id, concept_id=concept.id, weight=1.0))
        existing_pairs.add(pair)
        linked += 1

    # Bulk insert
    if batch:
        for qc in batch:
            db.add(qc)
        await db.commit()

    return linked, skipped_no_map, skipped_no_concept, skipped_existing


async def get_row_counts(db: AsyncSession) -> dict:
    counts = {}
    for table in ("concepts", "question_concepts", "misconceptions",
                  "concept_prerequisites", "concept_misconceptions"):
        r = await db.execute(text(f"SELECT COUNT(*) FROM {table}"))
        counts[table] = r.scalar()
    return counts


# ─────────────────────────────────────────────
# Main
# ─────────────────────────────────────────────

async def main():
    print("=" * 65)
    print("  Seeding concepts and linking items  (P1-4 fix)")
    print("=" * 65)
    print()

    all_concepts_data = CONCEPTS_DATA + RW_CONCEPTS_DATA

    async with AsyncSessionLocal() as db:
        # 1. Concepts
        print(f"[1/5] Upserting {len(all_concepts_data)} concepts ...")
        concept_map, concepts_created = await upsert_concepts(db, all_concepts_data)
        print(f"      Created: {concepts_created}  |  Total in map: {len(concept_map)}")

        # 2. Misconceptions
        print(f"[2/5] Upserting misconceptions ...")
        mis_map, mis_created = await upsert_misconceptions(db)
        print(f"      Created: {mis_created}  |  Total in map: {len(mis_map)}")

        # 3. Prerequisites
        print(f"[3/5] Upserting prerequisite relationships ...")
        prereqs_created = await upsert_prerequisites(db, concept_map)
        print(f"      Created: {prereqs_created}")

        # 4. Concept-misconception links
        print(f"[4/5] Upserting concept-misconception links ...")
        cm_created = await upsert_concept_misconceptions(db, concept_map, mis_map)
        print(f"      Created: {cm_created}")

        # 5. Link items -> concepts
        print(f"[5/5] Linking items to concepts via skill_tag ...")
        linked, no_map, no_concept, existing = await link_items_to_concepts(db, concept_map)
        print(f"      Linked (new):           {linked}")
        print(f"      Skipped (no mapping):   {no_map}")
        print(f"      Skipped (no concept):   {no_concept}")
        print(f"      Skipped (already exist):{existing}")

        # Final counts
        print()
        print("-" * 65)
        print("  Final row counts")
        print("-" * 65)
        counts = await get_row_counts(db)
        for table, count in counts.items():
            print(f"  {table:<30} {count:>6} rows")

    print()
    print("Done.")


if __name__ == "__main__":
    asyncio.run(main())
