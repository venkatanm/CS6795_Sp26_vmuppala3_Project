#!/usr/bin/env python3
"""
Script to seed diagnostic exams in the backend database.

This script:
1. Lists all existing diagnostic exams in the database
2. Allows creating new diagnostic exams (DIAGNOSTIC_MATH and DIAGNOSTIC_RW)
3. Provides option to replace existing diagnostic exams

Usage:
    python scripts/seed_diagnostic_exam.py
    python scripts/seed_diagnostic_exam.py --replace
    python scripts/seed_diagnostic_exam.py --list-only
"""

import asyncio
import sys
import argparse
from pathlib import Path
from uuid import UUID
from typing import List, Dict, Any
from collections import defaultdict

# Add project root to path
project_root = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(project_root))

from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession
from sqlalchemy.orm import sessionmaker
from sqlalchemy import select, delete, func
from src.db.models import ExamDefinition
from src.services.exam_service import ExamService, ExamTypes
from src.core.config import settings


# Diagnostic exam UUIDs
# Frontend currently uses: 550e8400-e29b-41d4-a716-446655440000 for the diagnostic exam
# For backend, we can use separate UUIDs for MATH and RW, or use the same one
DIAGNOSTIC_MATH_UUID = UUID("550e8400-e29b-41d4-a716-446655440000")
DIAGNOSTIC_RW_UUID = UUID("550e8400-e29b-41d4-a716-446655440001")

# Note: If frontend needs to match, you can set DIAGNOSTIC_RW_UUID to the same as MATH
# For now, we use separate UUIDs to support both exam types in the backend


async def list_diagnostic_exams(db: AsyncSession, tenant_id: str = "public") -> List[Dict[str, Any]]:
    """
    List all diagnostic exams in the database.
    
    Args:
        db: Database session
        tenant_id: Tenant ID to filter by
        
    Returns:
        List of diagnostic exam dictionaries
    """
    # Query for exams with diagnostic in title or specific UUIDs
    stmt = select(ExamDefinition).where(
        ExamDefinition.tenant_id == tenant_id
    ).where(
        (ExamDefinition.title.ilike("%diagnostic%")) |
        (ExamDefinition.id.in_([DIAGNOSTIC_MATH_UUID, DIAGNOSTIC_RW_UUID]))
    )
    
    result = await db.execute(stmt)
    exams = result.scalars().all()
    
    exam_list = []
    for exam in exams:
        structure = exam.structure or {}
        metadata = structure.get("metadata", {})
        
        exam_list.append({
            "id": str(exam.id),
            "title": exam.title,
            "exam_type": metadata.get("exam_type", "UNKNOWN"),
            "total_questions": metadata.get("total_questions", 0),
            "is_active": exam.is_active,
            "created_at": getattr(exam, 'created_at', None)  # Include created_at if available
        })
    
    return exam_list


async def validate_question_availability(
    db: AsyncSession,
    exam_type: str,
    tenant_id: str = "public"
) -> Dict[str, Any]:
    """
    Validate that sufficient questions are available for the diagnostic exam.
    
    Args:
        db: Database session
        exam_type: "DIAGNOSTIC_MATH" or "DIAGNOSTIC_RW"
        tenant_id: Tenant ID
        
    Returns:
        Dictionary with validation results
    """
    from sqlalchemy import text
    from collections import defaultdict
    
    # Determine expected question types
    if exam_type == ExamTypes.DIAGNOSTIC_MATH:
        expected_types = ["MCQ Math", "SPR Math"]
        domain_name = "Math"
        skill_categories = [
            "Algebra",
            "Advanced Math",
            "Problem-Solving and Data Analysis",
            "Geometry and Trigonometry"
        ]
    else:  # DIAGNOSTIC_RW
        expected_types = ["MCQ RW"]
        domain_name = "Reading & Writing"
        skill_categories = [
            "Craft and Structure",
            "Information and Ideas",
            "Standard English Conventions",
            "Expression of Ideas"
        ]
    
    # Query all items for the tenant (we'll filter by question_type in Python)
    # This avoids SQL injection concerns and handles JSONB querying more safely
    query = text("""
        SELECT 
            id, question_text, correct_answer, options, variables, 
            skill_tag, logical_id
        FROM items
        WHERE tenant_id = :tenant_id
    """)
    
    result = await db.execute(query, {"tenant_id": tenant_id})
    all_rows = result.fetchall()
    
    # Filter rows by question type in Python
    rows = []
    for row in all_rows:
        # Check if question matches expected types
        matches = False
        if row.variables:
            q_type = row.variables.get("question_type", "")
            section = row.variables.get("section", "")
            
            # Match by question_type
            if q_type in expected_types:
                matches = True
            # Match by section as fallback
            elif section == domain_name:
                matches = True
        
        if matches:
            rows.append(row)
    
    # Analyze questions
    # First pass: Identify questions with critical issues (cannot be used in exams)
    questions_with_issues = []
    usable_rows = []
    
    for row in rows:
        # Check for data quality issues
        issues = []
        has_critical_issue = False
        
        if not row.question_text or len(str(row.question_text).strip()) == 0:
            issues.append("missing_question_text")
            has_critical_issue = True
        
        if not row.correct_answer or len(str(row.correct_answer).strip()) == 0:
            issues.append("missing_correct_answer")
            has_critical_issue = True  # Critical: cannot grade without correct answer
        
        if row.options is None:
            issues.append("missing_options")
            # Only critical for MCQ questions
            if row.variables and row.variables.get("question_type") != "SPR Math":
                has_critical_issue = True
        elif isinstance(row.options, list) and len(row.options) == 0:
            # SPR Math questions should have empty options, which is OK
            if row.variables and row.variables.get("question_type") != "SPR Math":
                issues.append("empty_options")
                has_critical_issue = True
        
        if issues:
            questions_with_issues.append({
                "logical_id": row.logical_id or str(row.id),
                "issues": issues,
                "has_critical_issue": has_critical_issue
            })
        
        # Only count questions without critical issues as "usable"
        if not has_critical_issue:
            usable_rows.append(row)
    
    # Second pass: Count usable questions only
    total_questions = len(usable_rows)  # Count only usable questions
    questions_by_type = defaultdict(int)
    questions_by_category = defaultdict(int)
    
    for row in usable_rows:
        # Count by question type
        if row.variables and row.variables.get("question_type"):
            q_type = row.variables.get("question_type")
            questions_by_type[q_type] += 1
        else:
            questions_by_type["Unknown"] += 1
        
        # Count by category
        # Priority: 1) primary_class, 2) category, 3) skill_tag
        primary_class = row.variables.get("primary_class") if row.variables else None
        category = row.variables.get("category") if row.variables else None
        skill_tag = row.skill_tag or ""
        
        categorized = False
        for cat in skill_categories:
            # Check primary_class first (most reliable)
            if primary_class and cat.lower() == primary_class.lower():
                questions_by_category[cat] += 1
                categorized = True
                break
            # Check category in variables (fallback)
            elif category and cat.lower() in str(category).lower():
                questions_by_category[cat] += 1
                categorized = True
                break
            # Check skill_tag (last resort - detailed descriptions)
            elif cat.lower() in skill_tag.lower():
                questions_by_category[cat] += 1
                categorized = True
                break
        
        if not categorized:
            questions_by_category["Uncategorized"] += 1
        
        # Exclude questions with critical issues from the usable count
        if has_critical_issue:
            # Don't count this question as available
            return None
    
    # Minimum requirements
    min_questions_per_module = 9
    min_total_questions = min_questions_per_module * 3  # Module 1 + Module 2 Easy + Module 2 Hard
    min_questions_per_category = 2  # At least 2 questions per category for good distribution
    
    validation_result = {
        "valid": True,
        "total_questions": total_questions,
        "questions_by_type": dict(questions_by_type),
        "questions_by_category": dict(questions_by_category),
        "questions_with_issues": questions_with_issues,
        "warnings": [],
        "errors": []
    }
    
    # Validation checks
    if total_questions < min_total_questions:
        validation_result["valid"] = False
        validation_result["errors"].append(
            f"Insufficient questions: Found {total_questions}, need at least {min_total_questions} "
            f"({min_questions_per_module} per module × 3 modules)"
        )
    
    # Check category distribution
    for cat in skill_categories:
        count = questions_by_category.get(cat, 0)
        if count < min_questions_per_category:
            validation_result["warnings"].append(
                f"Category '{cat}' has only {count} questions (recommended: {min_questions_per_category}+)"
            )
    
    # Check question type distribution
    for expected_type in expected_types:
        count = questions_by_type.get(expected_type, 0)
        if count == 0:
            validation_result["warnings"].append(
                f"No questions found with type '{expected_type}'"
            )
    
    # Check data quality
    if questions_with_issues:
        issue_count = len(questions_with_issues)
        critical_count = sum(1 for q in questions_with_issues if q.get("has_critical_issue", False))
        non_critical_count = issue_count - critical_count
        
        if critical_count > 0:
            validation_result["warnings"].append(
                f"{critical_count} question(s) have critical issues (missing correct_answer or question_text) and will be excluded from exam generation"
            )
        if non_critical_count > 0:
            validation_result["warnings"].append(
                f"{non_critical_count} question(s) have non-critical data quality issues"
            )
    
    return validation_result


async def create_diagnostic_exam(
    db: AsyncSession,
    exam_type: str,
    tenant_id: str = "public",
    replace: bool = False,
    skip_validation: bool = False
) -> Dict[str, Any]:
    """
    Create a diagnostic exam in the database with comprehensive validation.
    
    Args:
        db: Database session
        exam_type: "DIAGNOSTIC_MATH" or "DIAGNOSTIC_RW"
        tenant_id: Tenant ID
        replace: If True, delete existing exam before creating new one
        skip_validation: If True, skip pre-generation validation (not recommended)
        
    Returns:
        Dictionary with exam creation result
    """
    if exam_type == ExamTypes.DIAGNOSTIC_MATH:
        exam_uuid = DIAGNOSTIC_MATH_UUID
        title = "Diagnostic Math Exam"
    elif exam_type == ExamTypes.DIAGNOSTIC_RW:
        exam_uuid = DIAGNOSTIC_RW_UUID
        title = "Diagnostic Reading & Writing Exam"
    else:
        raise ValueError(f"Invalid exam type: {exam_type}")
    
    # Check if exam already exists
    existing_stmt = select(ExamDefinition).where(
        ExamDefinition.id == exam_uuid,
        ExamDefinition.tenant_id == tenant_id
    )
    existing_result = await db.execute(existing_stmt)
    existing_exam = existing_result.scalar_one_or_none()
    
    if existing_exam:
        if not replace:
            return {
                "success": False,
                "message": f"Diagnostic exam {exam_type} already exists. Use --replace to replace it.",
                "exam_id": str(exam_uuid)
            }
        else:
            # Delete existing exam
            print(f"[INFO] Deleting existing {exam_type} exam...")
            await db.execute(
                delete(ExamDefinition).where(
                    ExamDefinition.id == exam_uuid,
                    ExamDefinition.tenant_id == tenant_id
                )
            )
            await db.flush()
            print(f"[OK] Deleted existing exam")
    
    # Pre-generation validation
    if not skip_validation:
        print(f"[INFO] Validating question availability for {exam_type}...")
        validation = await validate_question_availability(db, exam_type, tenant_id)
        
        print(f"\n[VALIDATION] Question Availability Report:")
        print(f"  Total questions: {validation['total_questions']}")
        print(f"\n  By question type:")
        for q_type, count in sorted(validation['questions_by_type'].items()):
            print(f"    {q_type}: {count}")
        print(f"\n  By category:")
        for cat, count in sorted(validation['questions_by_category'].items()):
            print(f"    {cat}: {count}")
        
        if validation['warnings']:
            print(f"\n  [WARNINGS]:")
            for warning in validation['warnings']:
                print(f"    - {warning}")
        
        if validation['questions_with_issues']:
            print(f"\n  [DATA QUALITY]: {len(validation['questions_with_issues'])} question(s) with issues")
            if len(validation['questions_with_issues']) <= 10:
                for q in validation['questions_with_issues'][:10]:
                    print(f"    - ID: {q['logical_id']}, Issues: {', '.join(q['issues'])}")
        
        if validation['errors']:
            print(f"\n  [ERRORS]:")
            for error in validation['errors']:
                print(f"    - {error}")
            print(f"\n[ERROR] Validation failed. Cannot create diagnostic exam.")
            print(f"[INFO] Please ensure sufficient questions are available in the database.")
            return {
                "success": False,
                "message": "Validation failed: " + "; ".join(validation['errors']),
                "exam_id": str(exam_uuid),
                "validation": validation
            }
        
        if validation['warnings']:
            print(f"\n[WARNING] Validation passed with warnings. Continuing...")
        else:
            print(f"\n[OK] Validation passed!")
    
    # Generate exam structure using ExamService
    print(f"\n[INFO] Generating {exam_type} exam structure...")
    try:
        exam_container = await ExamService.generate_diagnostic_exam(
            db=db,
            exam_type=exam_type,
            tenant_id=tenant_id
        )
        
        # Check if exam has items
        def count_items_in_container(container):
            count = len(container.items) if container.items else 0
            for child in container.children:
                count += count_items_in_container(child)
            return count
        
        def get_module_breakdown(container):
            """Get breakdown of items by module."""
            breakdown = {}
            if container.items:
                breakdown["root"] = len(container.items)
            for child in container.children:
                if hasattr(child, 'id') and hasattr(child, 'items'):
                    module_name = child.id or "unknown"
                    item_count = len(child.items) if child.items else 0
                    breakdown[module_name] = item_count
                    # Recursively check nested children
                    nested = get_module_breakdown(child)
                    breakdown.update(nested)
            return breakdown
        
        total_items = count_items_in_container(exam_container)
        module_breakdown = get_module_breakdown(exam_container)
        
        print(f"[INFO] Generated exam structure with {total_items} total items")
        if module_breakdown:
            print(f"[INFO] Module breakdown:")
            for module_name, count in sorted(module_breakdown.items()):
                print(f"    {module_name}: {count} questions")
        
        if total_items == 0:
            error_msg = (
                "Exam structure has no items! This will cause the /packet endpoint to fail.\n"
                "Possible causes:\n"
                "  1. Items in database don't have proper skill_tag or category values\n"
                "  2. Items don't match expected question types\n"
                "  3. Items are missing required fields (question_text, correct_answer, options)"
            )
            print(f"[ERROR] {error_msg}")
            return {
                "success": False,
                "message": "Generated exam has no items",
                "exam_id": str(exam_uuid)
            }
        
        # Validate expected structure
        expected_modules = ["module_1", "module_2_easy", "module_2_hard"]
        domain = "math" if exam_type == ExamTypes.DIAGNOSTIC_MATH else "rw"
        expected_module_ids = [
            f"{domain}_module_1",
            f"{domain}_module_2_easy",
            f"{domain}_module_2_hard"
        ]
        
        missing_modules = []
        for expected_id in expected_module_ids:
            if expected_id not in module_breakdown:
                missing_modules.append(expected_id)
        
        if missing_modules:
            print(f"[WARNING] Missing expected modules: {missing_modules}")
        
        # Convert Container to dict for storage
        structure_dict = exam_container.model_dump()
    except Exception as e:
        print(f"[ERROR] Failed to generate exam structure: {e}")
        import traceback
        traceback.print_exc()
        return {
            "success": False,
            "message": f"Failed to generate exam structure: {str(e)}",
            "exam_id": str(exam_uuid)
        }
    
    # Create ExamDefinition
    new_exam = ExamDefinition(
        id=exam_uuid,
        tenant_id=tenant_id,
        title=title,
        structure=structure_dict,
        is_active=True
    )
    
    db.add(new_exam)
    await db.flush()
    
    metadata = structure_dict.get("metadata", {})
    
    return {
        "success": True,
        "message": f"Successfully created {exam_type} exam",
        "exam_id": str(exam_uuid),
        "title": title,
        "total_questions": metadata.get("total_questions", 0),
        "total_time_seconds": metadata.get("total_time_seconds", 0),
        "routing_threshold": metadata.get("routing_threshold", 0.55)
    }


async def main():
    """Main function to run the diagnostic exam seeding script."""
    parser = argparse.ArgumentParser(
        description="Seed diagnostic exams in the backend database"
    )
    parser.add_argument(
        "--replace",
        action="store_true",
        help="Replace existing diagnostic exams if they exist"
    )
    parser.add_argument(
        "--list-only",
        action="store_true",
        help="Only list existing diagnostic exams, don't create new ones"
    )
    parser.add_argument(
        "--type",
        choices=["MATH", "RW", "BOTH"],
        default="BOTH",
        help="Which diagnostic exam type to create (default: BOTH)"
    )
    parser.add_argument(
        "--tenant-id",
        default="public",
        help="Tenant ID (default: public)"
    )
    parser.add_argument(
        "--confirm",
        action="store_true",
        help="Skip confirmation prompts (useful for automation)"
    )
    parser.add_argument(
        "--skip-validation",
        action="store_true",
        help="Skip pre-generation validation (not recommended)"
    )
    
    args = parser.parse_args()
    
    # Get database URL from settings
    db_url = settings.DATABASE_URL
    
    print("=" * 60)
    print("Diagnostic Exam Seeding Script")
    print("=" * 60)
    print(f"Database: {db_url.split('@')[-1] if '@' in db_url else 'local'}")
    print(f"Tenant ID: {args.tenant_id}")
    print()
    
    # Create database engine
    engine = create_async_engine(db_url, echo=False)
    AsyncSessionLocal = sessionmaker(
        engine,
        class_=AsyncSession,
        expire_on_commit=False
    )
    
    try:
        async with AsyncSessionLocal() as session:
            # List existing diagnostic exams
            print("[INFO] Listing existing diagnostic exams...")
            existing_exams = await list_diagnostic_exams(session, args.tenant_id)
            
            if existing_exams:
                print(f"\n[INFO] Found {len(existing_exams)} existing diagnostic exam(s):")
                print("-" * 60)
                for exam in existing_exams:
                    print(f"  ID: {exam['id']}")
                    print(f"  Title: {exam['title']}")
                    print(f"  Type: {exam['exam_type']}")
                    print(f"  Questions: {exam['total_questions']}")
                    print(f"  Active: {exam['is_active']}")
                    if exam.get('created_at'):
                        print(f"  Created: {exam['created_at']}")
                    print()
            else:
                print("[INFO] No existing diagnostic exams found")
                print()
            
            if args.list_only:
                print("[OK] List-only mode - exiting without creating exams")
                return
            
            # Determine which exams to create
            exams_to_create = []
            if args.type == "BOTH":
                exams_to_create = [ExamTypes.DIAGNOSTIC_MATH, ExamTypes.DIAGNOSTIC_RW]
            elif args.type == "MATH":
                exams_to_create = [ExamTypes.DIAGNOSTIC_MATH]
            else:  # RW
                exams_to_create = [ExamTypes.DIAGNOSTIC_RW]
            
            # Confirm before creating
            if not args.confirm:
                print(f"[INFO] Will create {len(exams_to_create)} diagnostic exam(s):")
                for exam_type in exams_to_create:
                    print(f"  - {exam_type}")
                print()
                
                # Check if any exams exist and will be replaced
                if args.replace and existing_exams:
                    print("[WARNING] --replace flag is set. Existing exams will be deleted!")
                    print()
                
                response = input("Continue? (yes/no): ").strip().lower()
                if response not in ["yes", "y"]:
                    print("[INFO] Cancelled by user")
                    return
            
            # Create exams
            results = []
            for exam_type in exams_to_create:
                print(f"\n{'=' * 60}")
                print(f"[INFO] Creating {exam_type} exam...")
                print(f"{'=' * 60}")
                result = await create_diagnostic_exam(
                    db=session,
                    exam_type=exam_type,
                    tenant_id=args.tenant_id,
                    replace=args.replace,
                    skip_validation=args.skip_validation
                )
                results.append(result)
                
                if result["success"]:
                    print(f"[OK] {result['message']}")
                    print(f"     Exam ID: {result['exam_id']}")
                    print(f"     Questions: {result['total_questions']}")
                    print(f"     Time: {result['total_time_seconds']} seconds ({result['total_time_seconds'] // 60} minutes)")
                    print(f"     Routing Threshold: {result['routing_threshold']}")
                else:
                    print(f"[ERROR] {result['message']}")
                    if "validation" in result:
                        print(f"[INFO] Run with --skip-validation to bypass validation (not recommended)")
            
            # Commit all changes
            await session.commit()
            
            print("\n" + "=" * 60)
            print("[SUCCESS] Diagnostic exam seeding completed!")
            print("=" * 60)
            
            # List final state
            print("\n[INFO] Final diagnostic exam list:")
            final_exams = await list_diagnostic_exams(session, args.tenant_id)
            if final_exams:
                for exam in final_exams:
                    print(f"  - {exam['title']} ({exam['exam_type']}): {exam['total_questions']} questions")
            else:
                print("  (none)")
            
    except Exception as e:
        print(f"\n[ERROR] Error during diagnostic exam seeding: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)
    finally:
        await engine.dispose()


if __name__ == "__main__":
    asyncio.run(main())
