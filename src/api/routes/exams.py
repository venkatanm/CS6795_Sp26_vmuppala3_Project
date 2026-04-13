import json
from uuid import UUID
from typing import Optional
from fastapi import APIRouter, Depends, Request, status, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from src.db.session import get_db
from src.db.models import ExamDefinition
from src.schemas.exam import ExamSchema, Container, ItemRef

router = APIRouter()


class AddItemRequest(BaseModel):
    """Request body for adding an item to an exam."""
    item_id: str


@router.get("")
async def list_exams(
    request: Request,
    db: AsyncSession = Depends(get_db),
    active_only: Optional[bool] = Query(
        default=None,
        description="If true, only return exams that are active OR have > 0 items"
    )
):
    """
    List all exam definitions for the current tenant.
    
    Returns: List of exams with id, title, description, question_count, and time_limit_seconds.
    
    Query Parameters:
    - active_only: If true, only return exams that are marked 'active' or have > 0 items
    """
    from sqlalchemy import select
    
    # Extract tenant_id from request headers
    tenant_id = request.headers.get("X-Tenant-ID", "public")
    
    # Query exams for this tenant
    result = await db.execute(
        select(ExamDefinition).where(ExamDefinition.tenant_id == tenant_id)
    )
    exams = result.scalars().all()
    
    exam_list = []
    
    for exam in exams:
        # Extract data from structure
        structure = exam.structure or {}
        
        # Get description from metadata or structure
        description = None
        if isinstance(structure, dict):
            metadata = structure.get("metadata", {})
            description = metadata.get("description") or structure.get("description")
        
        # Count questions in the exam structure
        def count_items(container):
            """Recursively count items in the structure."""
            count = 0
            if isinstance(container, dict):
                # Count items in this container
                items = container.get("items", [])
                if isinstance(items, list):
                    count += len(items)
                # Recursively count in children
                children = container.get("children", [])
                if isinstance(children, list):
                    for child in children:
                        count += count_items(child)
            return count
        
        question_count = count_items(structure)
        
        # Get time_limit_seconds from metadata
        time_limit_seconds = None
        if isinstance(structure, dict):
            metadata = structure.get("metadata", {})
            time_limit_seconds = metadata.get("duration_seconds") or metadata.get("time_limit_seconds")
        
        # Apply filtering if active_only is requested
        if active_only:
            # Only include if: is_active OR has items > 0
            if not (exam.is_active or question_count > 0):
                continue
        
        exam_list.append({
            "id": str(exam.id),
            "title": exam.title,
            "description": description,
            "question_count": question_count,
            "time_limit_seconds": time_limit_seconds
        })
    
    return exam_list


@router.get("/statistics")
async def get_exam_statistics(
    request: Request,
    db: AsyncSession = Depends(get_db)
):
    """
    Get statistics for all exams for the current tenant.
    
    Returns: List of exams with detailed statistics including:
    - Number of attempts (total and completed)
    - Average score
    - Number of questions in exam
    - Date created
    """
    from sqlalchemy import select, func, case
    from src.db.models import ExamDefinition, Session
    
    # Extract tenant_id from request headers
    tenant_id = request.headers.get("X-Tenant-ID", "public")
    
    # Query all exams for this tenant
    exams_result = await db.execute(
        select(ExamDefinition).where(ExamDefinition.tenant_id == tenant_id)
    )
    exams = exams_result.scalars().all()
    
    exam_stats = []
    
    for exam in exams:
        # Count total sessions for this exam
        total_sessions_result = await db.execute(
            select(func.count(Session.id)).where(
                Session.exam_id == exam.id,
                Session.tenant_id == tenant_id
            )
        )
        total_attempts = total_sessions_result.scalar() or 0
        
        # Count completed sessions
        completed_sessions_result = await db.execute(
            select(func.count(Session.id)).where(
                Session.exam_id == exam.id,
                Session.tenant_id == tenant_id,
                Session.status == "completed"
            )
        )
        completed_attempts = completed_sessions_result.scalar() or 0
        
        # Calculate average score (student_theta) for completed sessions
        avg_score_result = await db.execute(
            select(func.avg(Session.student_theta)).where(
                Session.exam_id == exam.id,
                Session.tenant_id == tenant_id,
                Session.status == "completed",
                Session.student_theta.isnot(None)
            )
        )
        avg_score = avg_score_result.scalar()
        
        # Count number of questions in exam structure
        structure = exam.structure or {}
        items = structure.get("items", [])
        num_questions = len(items) if isinstance(items, list) else 0
        
        # Get creation date (if available in structure metadata or use created_at if we add it)
        # For now, we'll use a placeholder
        
        exam_stats.append({
            "id": str(exam.id),
            "title": exam.title,
            "is_active": exam.is_active,
            "total_attempts": total_attempts,
            "completed_attempts": completed_attempts,
            "average_score": round(avg_score, 2) if avg_score is not None else None,
            "num_questions": num_questions,
        })
    
    return exam_stats


@router.delete("/{exam_id}", status_code=status.HTTP_200_OK)
async def delete_exam(
    exam_id: str,
    request: Request,
    db: AsyncSession = Depends(get_db)
):
    """
    Delete a single exam by ID.
    
    WARNING: This will permanently delete the exam. Use with caution!
    """
    from sqlalchemy import select, delete
    from src.db.models import Session
    
    # Extract tenant_id from request headers
    tenant_id = request.headers.get("X-Tenant-ID", "public")
    
    # Parse exam_id to UUID
    try:
        exam_uuid = UUID(exam_id)
    except ValueError:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Invalid exam_id format: {exam_id}"
        )
    
    # Verify exam exists and belongs to tenant
    result = await db.execute(
        select(ExamDefinition).where(
            ExamDefinition.id == exam_uuid,
            ExamDefinition.tenant_id == tenant_id
        )
    )
    exam = result.scalar_one_or_none()
    
    if not exam:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Exam {exam_id} not found"
        )
    
    exam_title = exam.title
    
    # Delete the exam
    await db.execute(
        delete(ExamDefinition).where(
            ExamDefinition.id == exam_uuid,
            ExamDefinition.tenant_id == tenant_id
        )
    )
    
    await db.flush()
    
    return {
        "message": f"Successfully deleted exam '{exam_title}'",
        "deleted_exam_id": exam_id
    }


@router.delete("", status_code=status.HTTP_200_OK)
async def delete_all_exams(
    request: Request,
    db: AsyncSession = Depends(get_db)
):
    """
    Delete all exams for the current tenant.
    
    WARNING: This will permanently delete all exams. Use with caution!
    """
    from sqlalchemy import select, delete
    
    # Extract tenant_id from request headers
    tenant_id = request.headers.get("X-Tenant-ID", "public")
    
    # First, count how many exams will be deleted
    result = await db.execute(
        select(ExamDefinition).where(ExamDefinition.tenant_id == tenant_id)
    )
    exams = result.scalars().all()
    count = len(exams)
    
    # Delete all exams for this tenant
    await db.execute(
        delete(ExamDefinition).where(ExamDefinition.tenant_id == tenant_id)
    )
    
    await db.flush()
    
    return {
        "message": f"Successfully deleted {count} exam(s)",
        "deleted_count": count
    }


@router.get("/{exam_id}")
async def get_exam(
    exam_id: str,
    request: Request,
    db: AsyncSession = Depends(get_db)
):
    """
    Get a single exam definition by ID.
    
    Returns: Exam with id, title, and structure
    """
    # Extract tenant_id from request headers
    tenant_id = request.headers.get("X-Tenant-ID", "public")
    
    try:
        # Convert exam_id to UUID if it's a string
        exam_uuid = UUID(exam_id) if isinstance(exam_id, str) else exam_id
    except ValueError:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Invalid exam ID format: {exam_id}"
        )
    
    # Query exam for this tenant
    result = await db.execute(
        select(ExamDefinition)
        .where(ExamDefinition.id == exam_uuid)
        .where(ExamDefinition.tenant_id == tenant_id)
    )
    exam = result.scalar_one_or_none()
    
    if not exam:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Exam {exam_id} not found"
        )
    
    return {
        "id": str(exam.id),
        "title": exam.title,
        "structure": exam.structure or {},
        "is_active": exam.is_active
    }


@router.get("/{exam_id}/packet")
async def get_exam_packet(
    exam_id: str,
    request: Request,
    db: AsyncSession = Depends(get_db)
):
    """
    Get exam as ExamPacket format (with content_bank).
    
    Converts ExamDefinition Container structure to ExamPacket format
    by fetching all referenced items and building the content_bank.
    """
    from src.schemas.exam import Container
    from src.db.models import Item
    from sqlalchemy import text
    import traceback
    
    tenant_id = request.headers.get("X-Tenant-ID", "public")
    
    try:
        exam_uuid = UUID(exam_id) if isinstance(exam_id, str) else exam_id
    except ValueError as e:
        print(f"[Get Exam Packet] Invalid UUID format: {exam_id}, error: {e}")
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Invalid exam ID format: {exam_id}"
        )
    
    # Get exam definition
    try:
        result = await db.execute(
            select(ExamDefinition)
            .where(ExamDefinition.id == exam_uuid)
            .where(ExamDefinition.tenant_id == tenant_id)
        )
        exam = result.scalar_one_or_none()
    except Exception as e:
        print(f"[Get Exam Packet] Error querying exam: {e}")
        import traceback
        traceback.print_exc()
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Error querying exam: {str(e)}"
        )
    
    if not exam:
        print(f"[Get Exam Packet] Exam {exam_id} not found for tenant {tenant_id}")
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Exam {exam_id} not found"
        )
    
    structure = exam.structure or {}
    if not structure:
        print(f"[Get Exam Packet] Exam {exam_id} has empty structure")
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Exam structure is empty"
        )
    
    print(f"[Get Exam Packet] Found exam {exam_id}, structure type: {type(structure)}")
    if isinstance(structure, dict):
        print(f"[Get Exam Packet] Structure keys: {list(structure.keys())}")
        print(f"[Get Exam Packet] Structure has 'children': {bool(structure.get('children'))}")
        if structure.get('children'):
            print(f"[Get Exam Packet] Number of children: {len(structure.get('children', []))}")
    
    # Extract all item_ids from Container structure recursively
    def extract_item_ids(container: dict) -> list:
        """Recursively extract item_ids from Container structure."""
        item_ids = []
        if isinstance(container, dict):
            # Get items from this container
            items = container.get("items", [])
            print(f"[Extract Items] Container {container.get('id', 'unknown')} has {len(items)} items")
            if isinstance(items, list):
                for i, item in enumerate(items):
                    print(f"[Extract Items] Item {i}: {type(item).__name__}, value: {item}")
                    if isinstance(item, dict):
                        item_id = item.get("item_id")
                        if item_id:
                            item_ids.append(item_id)
                            print(f"[Extract Items] Found item_id: {item_id}")
                    elif isinstance(item, str):
                        # Sometimes item_id might be stored directly as a string
                        item_ids.append(item)
                        print(f"[Extract Items] Found string item_id: {item}")
            # Recursively process children
            children = container.get("children", [])
            if isinstance(children, list):
                for child in children:
                    item_ids.extend(extract_item_ids(child))
        return item_ids
    
    item_ids = extract_item_ids(structure)
    print(f"[Get Exam Packet] Extracted {len(item_ids)} item_ids")
    if item_ids:
        print(f"[Get Exam Packet] First 5 item_ids: {item_ids[:5]}")
    
    if not item_ids:
        print(f"[Get Exam Packet] No item_ids found in structure")
        print(f"[Get Exam Packet] Structure keys: {list(structure.keys()) if isinstance(structure, dict) else 'Not a dict'}")
        if isinstance(structure, dict) and 'children' in structure:
            print(f"[Get Exam Packet] Number of children: {len(structure.get('children', []))}")
            for i, child in enumerate(structure.get('children', [])[:3]):
                if isinstance(child, dict):
                    print(f"[Get Exam Packet] Child {i} type: {child.get('type')}, has items: {bool(child.get('items'))}, items count: {len(child.get('items', []))}")
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Exam structure contains no items"
        )
    
    # Fetch all items from database using SQLAlchemy ORM to avoid asyncpg issues
    print(f"[Get Exam Packet] Fetching {len(item_ids)} items from database...")
    try:
        # Try to fetch items by logical_id first, then by id
        items_by_logical_id = []
        items_by_id = []
        
        # Split item_ids into those that look like UUIDs and those that don't
        uuid_item_ids = []
        string_item_ids = []
        for item_id in item_ids:
            try:
                UUID(item_id)
                uuid_item_ids.append(item_id)
            except ValueError:
                string_item_ids.append(item_id)
        
        print(f"[Get Exam Packet] UUID item_ids: {len(uuid_item_ids)}, String item_ids: {len(string_item_ids)}")
        
        # Query by logical_id (string) - use raw SQL to avoid asyncpg type 1043 issues
        if string_item_ids:
            # Use raw SQL with text() and proper PostgreSQL array casting
            # Build placeholders for IN clause to avoid ANY() array issues
            placeholders = ", ".join([f":item_id_{i}" for i in range(len(string_item_ids))])
            query = text(f"""
                SELECT id, question_text, correct_answer, options, 
                       solution_text, skill_tag, variables, logical_id
                FROM items
                WHERE logical_id IN ({placeholders})
                  AND tenant_id = :tenant_id
            """)
            params = {"tenant_id": tenant_id}
            for i, item_id in enumerate(string_item_ids):
                params[f"item_id_{i}"] = item_id
            
            result = await db.execute(query, params)
            rows = result.fetchall()
            # Convert rows to Item-like objects
            items_by_logical_id = []
            for row in rows:
                class ItemProxy:
                    def __init__(self, r):
                        self.id = r.id
                        self.logical_id = r.logical_id
                        self.question_text = r.question_text
                        self.correct_answer = r.correct_answer
                        self.options = r.options
                        self.solution_text = r.solution_text
                        self.skill_tag = r.skill_tag
                        self.variables = r.variables
                items_by_logical_id.append(ItemProxy(row))
            print(f"[Get Exam Packet] Found {len(items_by_logical_id)} items by logical_id")
        
        # Query by id (UUID) - use raw SQL to avoid asyncpg type issues
        if uuid_item_ids:
            uuid_list = [UUID(uid) for uid in uuid_item_ids]
            # Build placeholders for IN clause
            placeholders = ", ".join([f":item_id_{i}" for i in range(len(uuid_list))])
            query = text(f"""
                SELECT id, question_text, correct_answer, options, 
                       solution_text, skill_tag, variables, logical_id
                FROM items
                WHERE id IN ({placeholders})
                  AND tenant_id = :tenant_id
            """)
            params = {"tenant_id": tenant_id}
            for i, item_uuid in enumerate(uuid_list):
                params[f"item_id_{i}"] = item_uuid
            
            result = await db.execute(query, params)
            rows = result.fetchall()
            # Convert rows to Item-like objects
            items_by_id = []
            for row in rows:
                class ItemProxy:
                    def __init__(self, r):
                        self.id = r.id
                        self.logical_id = r.logical_id
                        self.question_text = r.question_text
                        self.correct_answer = r.correct_answer
                        self.options = r.options
                        self.solution_text = r.solution_text
                        self.skill_tag = r.skill_tag
                        self.variables = r.variables
                items_by_id.append(ItemProxy(row))
            print(f"[Get Exam Packet] Found {len(items_by_id)} items by id")
        
        # Combine results and remove duplicates
        seen_ids = set()
        all_items = []
        for item in list(items_by_logical_id) + list(items_by_id):
            if item.id not in seen_ids:
                seen_ids.add(item.id)
                all_items.append(item)
        
        print(f"[Get Exam Packet] Total unique items found: {len(all_items)}")
        
    except Exception as e:
        print(f"[Get Exam Packet] Error fetching items: {e}")
        import traceback
        traceback.print_exc()
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Error fetching items: {str(e)}"
        )
    
    # Build content_bank and question order
    content_bank = {}
    question_order_map = {}  # Maps item_id to question_id
    
    for item in all_items:
        # Use logical_id if available, otherwise use id as string
        item_id_from_db = item.logical_id or str(item.id)
        question_id = item_id_from_db  # Use item_id as question_id
        
        # Also map the original item_id from structure to this question_id
        # Try to match by logical_id first, then by id
        for original_item_id in item_ids:
            if (item.logical_id and item.logical_id == original_item_id) or str(item.id) == original_item_id:
                question_order_map[original_item_id] = question_id
                break
        
        # Parse variables if it's a string (JSON)
        variables = item.variables or {}
        if isinstance(variables, str):
            import json
            try:
                variables = json.loads(variables)
            except (json.JSONDecodeError, TypeError):
                variables = {}
        elif not isinstance(variables, dict):
            variables = {}
        
        # Extract image paths from variables
        image_paths = []
        if isinstance(variables, dict):
            image_paths = variables.get("image_paths", [])
            if not isinstance(image_paths, list):
                image_paths = []
        
        # Convert image paths to URLs
        assets = []
        base_url = str(request.base_url).rstrip("/")
        for img_path in image_paths:
            if img_path:
                # Remove leading slash if present
                img_path_clean = img_path.lstrip("/")
                assets.append(f"{base_url}/api/images/{img_path_clean}")
        
        # Determine if this is a Student-Produced Response (SPR) question
        question_type = variables.get("question_type", "")
        is_spr = (
            variables.get("is_spr") or
            variables.get("type") == "spr" or
            question_type in ["SPR Math", "SPR RW"] or
            (not item.options or len(item.options) == 0) and variables.get("section") == "Math"
        )
        
        # Determine domain
        # For diagnostic exams, check exam_type first, then fall back to section field
        exam_metadata = structure.get("metadata", {}) if structure else {}
        exam_type = exam_metadata.get("exam_type", "")
        
        # If this is a diagnostic math exam, set domain to Math
        if exam_type == "DIAGNOSTIC_MATH":
            domain = "Math"
        elif exam_type == "DIAGNOSTIC_RW":
            domain = "Reading and Writing"
        elif variables.get("section") == "Math":
            domain = "Math"
        else:
            domain = "Reading and Writing"
        
        # Determine category (primary_class from variables)
        category = variables.get("primary_class") or variables.get("category") or ""
        
        # Extract stimulus/passage text for RW questions
        # STANDARDIZED: Use stimulus as primary field
        # Fallback order: variables.stimulus -> variables.passageText -> variables.passage
        stimulus_text = None
        if isinstance(variables, dict):
            stimulus_text = (
                variables.get("stimulus") or 
                variables.get("passageText") or 
                variables.get("passage") or 
                None
            )
        
        # Convert options to choices format
        # Options can be stored as:
        # 1. Array of strings: ["choice A text", "choice B text", ...]
        # 2. Array of objects: [{"id": "A", "text": "..."}, ...]
        # 3. Empty array or None
        choices = []
        if item.options:
            if isinstance(item.options, list):
                for idx, opt in enumerate(item.options):
                    if isinstance(opt, str):
                        # String format: create object with ID
                        choices.append({
                            "id": chr(65 + idx),  # A, B, C, D
                            "text": opt
                        })
                    elif isinstance(opt, dict):
                        # Already in object format
                        choices.append({
                            "id": opt.get("id", chr(65 + idx)),
                            "text": opt.get("text", opt.get("content", str(opt)))
                        })
                    else:
                        # Fallback: convert to string
                        choices.append({
                            "id": chr(65 + idx),
                            "text": str(opt)
                        })
        
        # Convert to QuestionContent format
        content_bank[question_id] = {
            "question_id": question_id,
            "text": item.question_text,  # Use 'text' for consistency with frontend
            "stem": item.question_text,  # Keep 'stem' for backward compatibility
            "stimulus": stimulus_text or "",  # PRIMARY: Standardized on stimulus for RW questions
            "passageText": stimulus_text or "",  # DEPRECATED: Keep for backward compatibility
            "passage": stimulus_text or "",  # DEPRECATED: Keep for backward compatibility
            "choices": choices,
            "correct_answer": item.correct_answer,
            "solution": item.solution_text or "",
            "solution_text": item.solution_text or "",  # Also include solution_text
            "assets": assets,  # Include image URLs
            "is_spr": is_spr,  # Student-Produced Response flag
            "domain": domain,  # Math or Reading and Writing
            "category": category,  # Skill category
            "skill_tag": item.skill_tag,  # Detailed skill tag
            "skill": item.skill_tag or "",  # Skill name
            "difficulty_level": (
                1 if (variables.get("difficulty") or variables.get("difficulty_level") or "").upper() in ["E", "EASY"] else
                2 if (variables.get("difficulty") or variables.get("difficulty_level") or "").upper() in ["M", "MEDIUM"] else
                3 if (variables.get("difficulty") or variables.get("difficulty_level") or "").upper() in ["H", "HARD"] else
                2  # Default to Medium
            ),
            "metadata": {
                "skill_tag": item.skill_tag,
                "difficulty": variables.get("difficulty") or variables.get("difficulty_level") or 2,
            }
        }
    
    # Build modules from Container structure
    def build_modules(container: dict) -> list:
        """Recursively build modules from Container structure."""
        modules = []
        if isinstance(container, dict):
            container_type = container.get("type", "")
            container_id = container.get("id", "")
            
            # If it's a module, create a module entry
            if container_type == "module":
                question_order = []
                items = container.get("items", [])
                for item in items:
                    if isinstance(item, dict):
                        item_id = item.get("item_id")
                        # Map item_id to question_id
                        question_id = question_order_map.get(item_id, item_id)
                        # Check if question_id exists in content_bank, or try item_id directly
                        if question_id in content_bank:
                            question_order.append(question_id)
                        elif item_id in content_bank:
                            # Fallback: use item_id directly if it exists in content_bank
                            question_order.append(item_id)
                            question_order_map[item_id] = item_id  # Update map for consistency
                
                # Always include the module, even if question_order is empty (for routing purposes)
                # But log a warning if it's empty
                if not question_order:
                    print(f"[Get Exam Packet] WARNING: Module {container_id} has no questions in content_bank")
                
                modules.append({
                    "id": container_id or "module_1",
                    "type": container.get("flow_strategy", "fixed"),  # Preserve flow_strategy from structure
                    "question_order": question_order,
                    "metadata": container.get("metadata", {})  # Include module metadata
                })
            
            # Process children recursively
            children = container.get("children", [])
            for child in children:
                modules.extend(build_modules(child))
        
        return modules
    
    modules = build_modules(structure)
    
    # Get metadata from root container
    metadata = structure.get("metadata", {})
    duration_seconds = metadata.get("duration_seconds", 3600)
    
    # Extract routing threshold from metadata and convert to absolute number
    # Threshold is stored as a percentage (0.0 to 1.0), but frontend expects absolute number
    routing_threshold_percentage = metadata.get("routing_threshold", 0.55)  # Default 55%
    
    # Find Module 1 to get the number of questions
    module1 = None
    for module in modules:
        if module.get("id", "").endswith("_module_1"):
            module1 = module
            break
    
    # Calculate absolute threshold: percentage * number of questions in Module 1
    module1_question_count = len(module1.get("question_order", [])) if module1 else 9
    module_1_threshold_absolute = int(round(routing_threshold_percentage * module1_question_count))
    
    # Ensure threshold is at least 1 and at most the number of questions
    module_1_threshold_absolute = max(1, min(module_1_threshold_absolute, module1_question_count))
    
    # Build ExamPacket
    exam_packet = {
        "exam_id": str(exam.id),
        "config": {
            "total_time": duration_seconds,
            "allowed_tools": metadata.get("allowed_tools", ["calculator"]),
        },
        "routing_logic": {
            "module_1_threshold": module_1_threshold_absolute,  # Converted from percentage to absolute
        },
        "modules": modules if modules else [{
            "id": "module_1",
            "type": "fixed",
            "question_order": list(content_bank.keys())[:len(item_ids)]
        }],
        "content_bank": content_bank,
    }
    
    return exam_packet


@router.post("", status_code=status.HTTP_201_CREATED)
async def create_exam(
    payload: ExamSchema,
    request: Request,
    db: AsyncSession = Depends(get_db)
):
    """
    Create a new exam definition.
    
    Input: ExamSchema with title and structure (Container)
    """
    # Extract tenant_id from request headers
    tenant_id = request.headers.get("X-Tenant-ID", "public")
    
    # Get structure and add duration_seconds to root container metadata if not present
    structure_dict = json.loads(payload.structure.model_dump_json())
    if isinstance(structure_dict, dict):
        # Ensure metadata exists
        if "metadata" not in structure_dict:
            structure_dict["metadata"] = {}
        # Store duration_seconds in metadata if provided
        if payload.duration_seconds is not None:
            structure_dict["metadata"]["duration_seconds"] = payload.duration_seconds
    
    # Create a new ExamDefinition model instance
    exam = ExamDefinition(
        tenant_id=tenant_id,
        title=payload.title,
        structure=structure_dict
    )
    
    # Add to session
    db.add(exam)
    await db.flush()  # Flush to get the ID generated by the database
    
    # Store the ID before the transaction commits
    exam_id = str(exam.id)
    exam_title = exam.title
    
    # The transaction will auto-commit when the session.begin() context exits
    return {
        "id": exam_id,
        "title": exam_title
    }


@router.post("/{exam_id}/items", status_code=status.HTTP_200_OK)
async def add_item_to_exam(
    exam_id: str,
    payload: AddItemRequest,
    request: Request,
    db: AsyncSession = Depends(get_db)
):
    """
    Add an item to an exam.
    
    Body: { item_id: str }
    Logic:
    - Fetch the Exam from the DB
    - Add the item_id to the Exam's structure (append to the first container's items list)
    - Ensure order is preserved (append to end)
    - Return the updated Exam
    """
    # Extract tenant_id from request headers
    tenant_id = request.headers.get("X-Tenant-ID", "public")
    
    # Parse exam_id to UUID
    try:
        exam_uuid = UUID(exam_id)
    except ValueError:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Invalid exam_id format: {exam_id}"
        )
    
    # Fetch the exam
    result = await db.execute(
        select(ExamDefinition).where(
            ExamDefinition.id == exam_uuid,
            ExamDefinition.tenant_id == tenant_id
        )
    )
    exam = result.scalar_one_or_none()
    
    if not exam:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Exam {exam_id} not found"
        )
    
    # Get structure as dict
    structure_dict = exam.structure if isinstance(exam.structure, dict) else {}
    
    # Helper function to check if item exists anywhere in the structure
    def item_exists_in_structure(structure, item_id):
        """Recursively check if item_id exists in any container's items list."""
        if isinstance(structure, dict):
            # Check items in this container
            items = structure.get("items", [])
            for item in items:
                if (isinstance(item, dict) and item.get("item_id") == item_id) or \
                   (isinstance(item, str) and item == item_id):
                    return True
            # Check children recursively
            for child in structure.get("children", []):
                if item_exists_in_structure(child, item_id):
                    return True
        return False
    
    # Check if item_id already exists anywhere in the exam
    if item_exists_in_structure(structure_dict, payload.item_id):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Item {payload.item_id} already exists in this exam"
        )
    
    # Helper function to find the first container that can hold items (or root)
    def find_or_create_items_container(structure):
        """Find the first container with items, or create items list in root."""
        if isinstance(structure, dict):
            # If this container has an items list, use it
            if "items" in structure:
                return structure
            # Otherwise, check children
            for child in structure.get("children", []):
                found = find_or_create_items_container(child)
                if found:
                    return found
            # If no children have items, initialize items in this container
            if "items" not in structure:
                structure["items"] = []
            return structure
        return None
    
    # Find or create the items container
    items_container = find_or_create_items_container(structure_dict)
    
    if not items_container:
        # Fallback: use root structure
        items_container = structure_dict
        if "items" not in items_container:
            items_container["items"] = []
    
    # Append the new item to the end (preserve order)
    new_item_ref = {"item_id": payload.item_id, "points": 1.0}
    items_container["items"].append(new_item_ref)
    
    # Update the exam structure - need to reassign to trigger SQLAlchemy change detection
    # For JSONB fields, SQLAlchemy needs to see a new object reference
    import copy
    exam.structure = copy.deepcopy(structure_dict)
    
    # Mark the field as modified to ensure SQLAlchemy detects the change
    from sqlalchemy.orm.attributes import flag_modified
    flag_modified(exam, "structure")
    
    await db.flush()
    
    return {
        "id": str(exam.id),
        "title": exam.title,
        "structure": exam.structure
    }


@router.delete("/{exam_id}/items/{item_id}", status_code=status.HTTP_200_OK)
async def remove_item_from_exam(
    exam_id: str,
    item_id: str,
    request: Request,
    db: AsyncSession = Depends(get_db)
):
    """
    Remove an item from an exam.
    
    Logic:
    - Fetch the Exam from the DB
    - Remove the item_id from all containers' items lists
    - Return success
    """
    # Extract tenant_id from request headers
    tenant_id = request.headers.get("X-Tenant-ID", "public")
    
    # Parse exam_id to UUID
    try:
        exam_uuid = UUID(exam_id)
    except ValueError:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Invalid exam_id format: {exam_id}"
        )
    
    # Fetch the exam
    result = await db.execute(
        select(ExamDefinition).where(
            ExamDefinition.id == exam_uuid,
            ExamDefinition.tenant_id == tenant_id
        )
    )
    exam = result.scalar_one_or_none()
    
    if not exam:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Exam {exam_id} not found"
        )
    
    # Get structure as dict
    structure_dict = exam.structure if isinstance(exam.structure, dict) else {}
    
    # Helper function to recursively remove item from all containers
    def remove_item_from_structure(structure):
        """Recursively remove item_id from all containers' items lists."""
        if isinstance(structure, dict):
            # Remove item from this container's items list
            if "items" in structure:
                items = structure["items"]
                # Filter out the item with matching item_id
                structure["items"] = [
                    item for item in items
                    if not (
                        (isinstance(item, dict) and item.get("item_id") == item_id) or
                        (isinstance(item, str) and item == item_id)
                    )
                ]
            
            # Recursively process children
            for child in structure.get("children", []):
                remove_item_from_structure(child)
    
    # Remove the item from the structure
    remove_item_from_structure(structure_dict)
    
    # Update the exam structure - need to reassign to trigger SQLAlchemy change detection
    # For JSONB fields, SQLAlchemy needs to see a new object reference
    import copy
    exam.structure = copy.deepcopy(structure_dict)
    
    # Mark the field as modified to ensure SQLAlchemy detects the change
    from sqlalchemy.orm.attributes import flag_modified
    flag_modified(exam, "structure")
    
    await db.flush()
    
    return {
        "message": "Item removed successfully",
        "exam_id": str(exam.id),
        "item_id": item_id
    }
