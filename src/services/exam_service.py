"""
Exam Service for generating diagnostic exams and managing exam configurations.
"""
from typing import List, Dict, Any, Optional, Literal
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, and_, or_, func, cast, String, text
from src.db.models import Item, ExamDefinition
from src.schemas.exam import Container, ItemRef, RoutingRule
from src.core.config import settings


class ExamTypes:
    """Enum for exam types."""
    DIAGNOSTIC_MATH = "DIAGNOSTIC_MATH"
    DIAGNOSTIC_RW = "DIAGNOSTIC_RW"
    SIMULATION_RW = "SIMULATION_RW"
    SIMULATION_MATH = "SIMULATION_MATH"
    FULL_LENGTH = "FULL_LENGTH"
    PRACTICE = "PRACTICE"


class ExamService:
    """Service for generating and managing exams."""
    
    @staticmethod
    async def get_diagnostic_items(
        db: AsyncSession,
        domain: Literal["math", "rw"],
        count: int = 9,
        tenant_id: str = "public"
    ) -> List[Dict[str, Any]]:
        """
        Get diagnostic items using "sampler platter" strategy.
        
        Groups items by skill/domain and round-robins to maximize coverage.
        
        Args:
            db: Database session
            domain: "math" or "rw"
            count: Number of items to return (default: 9)
            tenant_id: Tenant ID for multi-tenancy
            
        Returns:
            List of item dictionaries with item_id, difficulty, skill_tag, etc.
        """
        # Map domain to skill categories
        if domain == "math":
            skill_categories = [
                "Algebra",
                "Advanced Math",
                "Problem-Solving and Data Analysis",
                "Geometry and Trigonometry"
            ]
        else:  # rw
            skill_categories = [
                "Craft and Structure",
                "Information and Ideas",
                "Standard English Conventions",
                "Expression of Ideas"
            ]
        
        # Query items for the domain
        # Items are categorized by skill_tag or category field
        # Build OR conditions for skill_tag matches
        # Use raw SQL to avoid asyncpg type 1043 (VARCHAR) issues with ORM mapping
        # We'll filter by both skill_tag and category in Python after fetching
        raw_query = text("""
            SELECT id, tenant_id, question_text, correct_answer, options, 
                   variables, skill_tag, logical_id, solution_text, template_id, 
                   context_type, skill_id
            FROM items
            WHERE tenant_id = :tenant_id
        """)
        
        result = await db.execute(raw_query, {"tenant_id": tenant_id})
        rows = result.fetchall()
        
        # Convert rows to dict-like objects for compatibility
        class ItemProxy:
            def __init__(self, row):
                self.id = row.id
                self.tenant_id = row.tenant_id
                self.question_text = row.question_text
                self.correct_answer = row.correct_answer
                self.options = row.options
                self.variables = row.variables
                self.skill_tag = row.skill_tag
                self.logical_id = row.logical_id
                self.solution_text = row.solution_text
                self.template_id = row.template_id
                self.context_type = row.context_type
                self.skill_id = row.skill_id
        
        all_items = [ItemProxy(row) for row in rows]
        
        # Filter by category in Python (avoids asyncpg type casting issues)
        if all_items:
            category_filtered_items = []
            for item in all_items:
                # Check primary_class first (most reliable - contains high-level categories)
                primary_class = item.variables.get("primary_class") if item.variables else None
                primary_class_match = False
                if primary_class:
                    primary_class_match = any(cat.lower() == primary_class.lower() for cat in skill_categories)
                
                # Check skill_tag match (detailed descriptions - fallback)
                skill_match = any(cat.lower() in (item.skill_tag or "").lower() for cat in skill_categories)
                
                # Check category match in variables (fallback)
                category_match = False
                if item.variables and item.variables.get("category"):
                    category_val = str(item.variables.get("category", "")).lower()
                    category_match = any(cat.lower() in category_val for cat in skill_categories)
                
                if primary_class_match or skill_match or category_match:
                    category_filtered_items.append(item)
            
            all_items = category_filtered_items
        
        if not all_items:
            return []
        
        # Group items by skill category
        items_by_category: Dict[str, List[Dict[str, Any]]] = {}
        misc_items: List[Dict[str, Any]] = []
        
        for item in all_items:
            # Skip items with missing critical fields (cannot be used in exams)
            if not item.question_text or len(str(item.question_text).strip()) == 0:
                continue  # Skip items without question text
            if not item.correct_answer or len(str(item.correct_answer).strip()) == 0:
                continue  # Skip items without correct answer (cannot grade)
            
            item_dict = {
                "id": str(item.id),
                "item_id": item.logical_id or str(item.id),
                "difficulty": getattr(item, 'difficulty', 1200.0),
                "skill_tag": item.skill_tag,
                "category": item.variables.get("category") if item.variables else None,
                "question_text": item.question_text,
                "correct_answer": item.correct_answer,
                "options": item.options
            }
            
            # Try to categorize by primary_class, category, or skill_tag
            # Priority: 1) primary_class, 2) category, 3) skill_tag
            categorized = False
            for cat in skill_categories:
                # Check primary_class first (most reliable)
                primary_class = item.variables.get("primary_class") if item.variables else None
                if primary_class and cat.lower() == primary_class.lower():
                    if cat not in items_by_category:
                        items_by_category[cat] = []
                    items_by_category[cat].append(item_dict)
                    categorized = True
                    break
                # Check category in variables (fallback)
                elif item.variables and item.variables.get("category"):
                    cat_val = item.variables.get("category", "")
                    if cat.lower() in str(cat_val).lower():
                        if cat not in items_by_category:
                            items_by_category[cat] = []
                        items_by_category[cat].append(item_dict)
                        categorized = True
                        break
                # Check skill_tag (last resort - detailed descriptions)
                elif item.skill_tag and cat.lower() in item.skill_tag.lower():
                    if cat not in items_by_category:
                        items_by_category[cat] = []
                    items_by_category[cat].append(item_dict)
                    categorized = True
                    break
            
            if not categorized:
                misc_items.append(item_dict)
        
        # Round-robin selection from each category
        selected_items: List[Dict[str, Any]] = []
        category_indices = {cat: 0 for cat in skill_categories}
        
        # Target distribution: ~2 per category + 1 random
        items_per_category = count // len(skill_categories)  # Usually 2
        remaining = count - (items_per_category * len(skill_categories))  # Usually 1
        
        # Round-robin select from each category
        # Continue until we have enough items or run out of items
        while len(selected_items) < count:
            made_progress = False
            
            for cat in skill_categories:
                if len(selected_items) >= count:
                    break
                
                # Count how many items from this category we've already selected
                category_count = sum(
                    1 for item in selected_items
                    if (item.get("skill_tag") and cat.lower() in item["skill_tag"].lower()) or
                       (item.get("category") and cat.lower() in str(item["category"]).lower())
                )
                
                # If we haven't reached target per category and have items available
                if category_count < items_per_category:
                    if cat in items_by_category and category_indices[cat] < len(items_by_category[cat]):
                        item = items_by_category[cat][category_indices[cat]]
                        selected_items.append(item)
                        category_indices[cat] += 1
                        made_progress = True
            
            # If we couldn't add any items, break to avoid infinite loop
            if not made_progress:
                break
        
        # Fill remaining slots with misc items or from any category
        while len(selected_items) < count and remaining > 0:
            # Try misc items first
            if misc_items:
                selected_items.append(misc_items.pop(0))
                remaining -= 1
            else:
                # Get from any category that still has items
                for cat in skill_categories:
                    if cat in items_by_category and category_indices[cat] < len(items_by_category[cat]):
                        item = items_by_category[cat][category_indices[cat]]
                        selected_items.append(item)
                        category_indices[cat] += 1
                        remaining -= 1
                        break
                else:
                    # No more items available
                    break
        
        return selected_items[:count]
    
    @staticmethod
    async def generate_diagnostic_stage(
        db: AsyncSession,
        exam_type: Literal["DIAGNOSTIC_MATH", "DIAGNOSTIC_RW"],
        stage: int,
        difficulty: Literal["Easy", "Medium", "Hard"],
        tenant_id: str = "public",
        exclude_item_ids: Optional[set] = None
    ) -> List[Dict[str, Any]]:
        """
        Generate items for a diagnostic stage using "Blueprint" strategy.
        
        The "Sampler Platter" Logic:
        - Define domain buckets (Math: Algebra, Advanced Math, Problem Solving, Geometry)
        - Query items by stage and difficulty
        - Group by domain_id
        - Round-robin select 1 item from each domain until we hit 9 items
        - Fallback: If a domain runs dry, pick from any domain
        
        Args:
            db: Database session
            exam_type: "DIAGNOSTIC_MATH" or "DIAGNOSTIC_RW"
            stage: Stage number (1 or 2)
            difficulty: "Easy", "Medium", or "Hard"
            tenant_id: Tenant ID for multi-tenancy
            exclude_item_ids: Set of item IDs to exclude (to prevent duplicates across modules)
            
        Returns:
            List of 12 item dictionaries with item_id, difficulty, domain_id, etc.
        """
        domain = "math" if exam_type == ExamTypes.DIAGNOSTIC_MATH else "rw"
        
        # Define domain buckets
        if domain == "math":
            domain_buckets = [
                "Algebra",
                "Advanced Math",
                "Problem-Solving and Data Analysis",
                "Geometry and Trigonometry"
            ]
        else:  # rw
            domain_buckets = [
                "Craft and Structure",
                "Information and Ideas",
                "Standard English Conventions",
                "Expression of Ideas"
            ]
        
        # Query items for the stage and difficulty
        # For Module 1 (Medium): Mix of Easy/Med/Hard
        # For Module 2 Easy: Mostly Easy + Medium
        # For Module 2 Hard: Mostly Hard + Medium
        
        difficulty_filters = []
        if difficulty == "Medium":
            # Module 1: Mix of all difficulties
            difficulty_filters = ["Easy", "Medium", "Hard"]
        elif difficulty == "Easy":
            # Module 2 Easy: Mostly Easy + Medium
            difficulty_filters = ["Easy", "Medium"]
        else:  # Hard
            # Module 2 Hard: Mostly Hard + Medium
            difficulty_filters = ["Hard", "Medium"]
        
        # Build query for items matching domain
        # Use raw SQL to avoid asyncpg type 1043 (VARCHAR) issues with ORM mapping
        # We'll filter by both skill_tag and category in Python after fetching
        raw_query = text("""
            SELECT id, tenant_id, question_text, correct_answer, options, 
                   variables, skill_tag, logical_id, solution_text, template_id, 
                   context_type, skill_id
            FROM items
            WHERE tenant_id = :tenant_id
        """)
        
        result = await db.execute(raw_query, {"tenant_id": tenant_id})
        rows = result.fetchall()
        
        # Convert rows to dict-like objects for compatibility
        class ItemProxy:
            def __init__(self, row):
                self.id = row.id
                self.tenant_id = row.tenant_id
                self.question_text = row.question_text
                self.correct_answer = row.correct_answer
                self.options = row.options
                self.variables = row.variables
                self.skill_tag = row.skill_tag
                self.logical_id = row.logical_id
                self.solution_text = row.solution_text
                self.template_id = row.template_id
                self.context_type = row.context_type
                self.skill_id = row.skill_id
        
        all_items = [ItemProxy(row) for row in rows]
        
        # Filter by domain in Python (avoids asyncpg type 1043 VARCHAR issues)
        # If no items match domain, use all items as fallback
        # Also exclude items that have already been used in other modules
        domain_filtered_items = []
        exclude_set = exclude_item_ids or set()
        for item in all_items:
            # Skip items that are in the exclusion list
            item_id = item.logical_id or str(item.id)
            if item_id in exclude_set:
                continue
            # Check primary_class in variables (this is the high-level category)
            # primary_class contains: "Algebra", "Advanced Math", "Information and Ideas", etc.
            primary_class = None
            if item.variables:
                primary_class = item.variables.get("primary_class") or item.variables.get("category")
            
            # Check if primary_class matches any domain bucket
            primary_class_match = False
            if primary_class:
                primary_class_match = any(domain_name.lower() == primary_class.lower() for domain_name in domain_buckets)
            
            # Check skill_tag match (detailed description - fallback)
            skill_match = any(domain_name.lower() in (item.skill_tag or "").lower() for domain_name in domain_buckets)
            
            # Check category match in variables (fallback)
            category_match = False
            if item.variables and item.variables.get("category"):
                category_val = str(item.variables.get("category", "")).lower()
                category_match = any(domain_name.lower() in category_val for domain_name in domain_buckets)
            
            if primary_class_match or skill_match or category_match:
                domain_filtered_items.append(item)
        
        # If we found domain-matched items, use them; otherwise use all items as fallback
        if domain_filtered_items:
            all_items = domain_filtered_items
            print(f"[Generate Diagnostic Stage] Filtered to {len(all_items)} items matching domain buckets")
        else:
            print(f"[Generate Diagnostic Stage] No items matched domain buckets, using all {len(all_items)} items as fallback")
        
        if not all_items:
            print(f"[Generate Diagnostic Stage] No items available in database for tenant {tenant_id}")
            return []
        
        print(f"[Generate Diagnostic Stage] Found {len(all_items)} items, filtering by domain and difficulty...")
        
        # Filter by difficulty and group by domain
        items_by_domain: Dict[str, List[Dict[str, Any]]] = {}
        misc_items: List[Dict[str, Any]] = []
        items_without_difficulty: List[Dict[str, Any]] = []
        
        for item in all_items:
            # Skip items with missing critical fields (cannot be used in exams)
            if not item.question_text or len(str(item.question_text).strip()) == 0:
                continue  # Skip items without question text
            if not item.correct_answer or len(str(item.correct_answer).strip()) == 0:
                continue  # Skip items without correct answer (cannot grade)
            
            # Check if item matches difficulty filter
            item_difficulty = None
            if item.variables:
                item_difficulty = item.variables.get("difficulty") or item.variables.get("difficulty_level")
            
            # Map single-letter difficulty codes to full words
            difficulty_map = {
                "E": "Easy",
                "M": "Medium", 
                "H": "Hard",
                "Easy": "Easy",
                "Medium": "Medium",
                "Hard": "Hard"
            }
            
            if item_difficulty:
                item_difficulty = difficulty_map.get(str(item_difficulty).strip(), item_difficulty)
            
            # If no difficulty in variables, default to Medium (will be included in misc)
            if not item_difficulty:
                item_difficulty = "Medium"
                items_without_difficulty.append(item)
            
            # Check if item matches our difficulty filters
            # If it doesn't match, we'll still include it in misc_items as a fallback
            difficulty_matches = item_difficulty in difficulty_filters
            
            item_dict = {
                "id": str(item.id),
                "item_id": item.logical_id or str(item.id),
                "difficulty": item_difficulty,
                "skill_tag": item.skill_tag,
                "category": item.variables.get("category") if item.variables else None,
                "domain_id": None,  # Will be set based on categorization
                "question_text": item.question_text,
                "correct_answer": item.correct_answer,
                "options": item.options
            }
            
            # Categorize by domain FIRST (regardless of difficulty)
            # Priority: 1) primary_class, 2) category, 3) skill_tag
            categorized = False
            matched_domain = None
            
            for domain_name in domain_buckets:
                # Check primary_class first (most reliable)
                primary_class = item.variables.get("primary_class") if item.variables else None
                if primary_class and domain_name.lower() == primary_class.lower():
                    matched_domain = domain_name
                    categorized = True
                    break
                # Check category in variables (fallback)
                elif item.variables and item.variables.get("category"):
                    cat_val = item.variables.get("category", "")
                    if domain_name.lower() in str(cat_val).lower():
                        matched_domain = domain_name
                        categorized = True
                        break
                # Check skill_tag (last resort - detailed descriptions)
                elif item.skill_tag and domain_name.lower() in item.skill_tag.lower():
                    matched_domain = domain_name
                    categorized = True
                    break
            
            # Add to appropriate bucket based on domain and difficulty
            if categorized and matched_domain:
                if matched_domain not in items_by_domain:
                    items_by_domain[matched_domain] = []
                item_dict["domain_id"] = matched_domain
                
                # Add to domain bucket if difficulty matches, otherwise to misc as fallback
                # But we'll still track it by domain for better distribution
                if difficulty_matches:
                    items_by_domain[matched_domain].append(item_dict)
                else:
                    # Item matches domain but not difficulty - add to misc but keep domain_id
                    misc_items.append(item_dict)
            else:
                # Not categorized - add to misc_items as fallback
                misc_items.append(item_dict)
        
        # Organize misc_items by domain_id for better distribution
        misc_by_domain: Dict[str, List[Dict[str, Any]]] = {}
        misc_no_domain: List[Dict[str, Any]] = []
        
        for item in misc_items:
            domain_id = item.get("domain_id")
            if domain_id:
                if domain_id not in misc_by_domain:
                    misc_by_domain[domain_id] = []
                misc_by_domain[domain_id].append(item)
            else:
                misc_no_domain.append(item)
        
        # Domain-weighted selection: RW = 3 per domain, Math = 4-4-2-2
        QUESTIONS_PER_MODULE = 12
        if domain == "math":
            domain_weights = {
                "Algebra": 4,
                "Advanced Math": 4,
                "Problem-Solving and Data Analysis": 2,
                "Geometry and Trigonometry": 2,
            }
        else:
            domain_weights = {
                "Craft and Structure": 3,
                "Information and Ideas": 3,
                "Standard English Conventions": 3,
                "Expression of Ideas": 3,
            }
        
        selected_items: List[Dict[str, Any]] = []
        target_count = QUESTIONS_PER_MODULE
        
        # Module 1 difficulty ladder: 3 Easy, 6 Medium, 3 Hard (exact slots per domain)
        if stage == 1 and difficulty == "Medium":
            if domain == "rw":
                domain_difficulty_slots = {
                    "Craft and Structure": [("Easy", 1), ("Medium", 2), ("Hard", 0)],
                    "Information and Ideas": [("Easy", 1), ("Medium", 2), ("Hard", 0)],
                    "Standard English Conventions": [("Easy", 1), ("Medium", 1), ("Hard", 1)],
                    "Expression of Ideas": [("Easy", 0), ("Medium", 1), ("Hard", 2)],
                }
            else:
                domain_difficulty_slots = {
                    "Algebra": [("Easy", 1), ("Medium", 2), ("Hard", 1)],
                    "Advanced Math": [("Easy", 1), ("Medium", 2), ("Hard", 1)],
                    "Problem-Solving and Data Analysis": [("Easy", 0), ("Medium", 1), ("Hard", 1)],
                    "Geometry and Trigonometry": [("Easy", 1), ("Medium", 1), ("Hard", 0)],
                }
        else:
            domain_difficulty_slots = None
        
        print(f"[Generate Diagnostic Stage] Items by domain: {[(k, len(v)) for k, v in items_by_domain.items()]}")
        print(f"[Generate Diagnostic Stage] Misc items by domain: {[(k, len(v)) for k, v in misc_by_domain.items()]}")
        print(f"[Generate Diagnostic Stage] Misc items (no domain): {len(misc_no_domain)}")
        
        used_item_ids_local: set = set()
        
        def pick_from_domain(dom: str, prefer_difficulty: Optional[str] = None) -> Optional[Dict[str, Any]]:
            """Pick item from domain; prefer matching difficulty if specified."""
            for pool in [items_by_domain, misc_by_domain]:
                if dom not in pool:
                    continue
                # First try: matching difficulty
                if prefer_difficulty:
                    for item in pool[dom]:
                        if item.get("item_id") in used_item_ids_local:
                            continue
                        if item.get("difficulty") == prefer_difficulty:
                            used_item_ids_local.add(item.get("item_id"))
                            return item
                # Second: any unused item
                for item in pool[dom]:
                    if item.get("item_id") in used_item_ids_local:
                        continue
                    used_item_ids_local.add(item.get("item_id"))
                    return item
            return None
        
        def pick_any_from_domain(dom: str) -> Optional[Dict[str, Any]]:
            """Pick any unused item from domain."""
            return pick_from_domain(dom, prefer_difficulty=None)
        
        # Fill slots: domain weights + (for Module 1) difficulty ladder
        for dom in domain_buckets:
            n_needed = domain_weights.get(dom, 1)
            if domain_difficulty_slots and dom in domain_difficulty_slots:
                for diff, count in domain_difficulty_slots[dom]:
                    for _ in range(count):
                        item = pick_from_domain(dom, diff)
                        if not item:
                            item = pick_any_from_domain(dom)
                        if item:
                            selected_items.append(item)
            else:
                for _ in range(n_needed):
                    item = pick_from_domain(dom)
                    if not item:
                        item = pick_any_from_domain(dom)
                    if item:
                        selected_items.append(item)
        
        while len(selected_items) < target_count and misc_no_domain:
            selected_items.append(misc_no_domain.pop(0))
        
        result_count = len(selected_items[:target_count])
        print(f"[Generate Diagnostic Stage] Selected {result_count} items (target: {target_count})")
        
        if result_count == 0:
            print(f"[Generate Diagnostic Stage] WARNING: No items selected! This will cause the exam to have no questions.")
            print(f"[Generate Diagnostic Stage] Consider checking item skill_tag and category values in the database.")
        
        return selected_items[:target_count]
    
    @staticmethod
    async def generate_diagnostic_exam(
        db: AsyncSession,
        exam_type: Literal["DIAGNOSTIC_MATH", "DIAGNOSTIC_RW"],
        tenant_id: str = "public",
        routing_threshold: Optional[float] = None
    ) -> Container:
        """
        Generate a diagnostic exam structure.
        
        Structure: 2 Modules (Module 1 -> Module 2)
        Length: 12 questions per module (24 total)
        Time: 2.5 minutes per question (~60 mins total)
        Scoring: Mod 1 Score < threshold -> Easy Mod 2; else Hard Mod 2
        
        Args:
            db: Database session
            exam_type: "DIAGNOSTIC_MATH" or "DIAGNOSTIC_RW"
            tenant_id: Tenant ID for multi-tenancy
            routing_threshold: Score threshold (0.0 to 1.0) for routing to hard module. 
                              If None, uses CAT_ROUTING_THRESHOLD from config (default: 0.55)
            
        Returns:
            Container structure representing the exam
        """
        # Use provided threshold or fall back to config default
        if routing_threshold is None:
            routing_threshold = settings.CAT_ROUTING_THRESHOLD
        
        domain = "math" if exam_type == ExamTypes.DIAGNOSTIC_MATH else "rw"
        
        # Track used item IDs to prevent duplicates across modules
        used_item_ids = set()
        
        # Use Blueprint Generator for each stage
        # Module 1: Difficulty "Medium" (Mix of Easy/Med/Hard)
        module1_items = await ExamService.generate_diagnostic_stage(
            db, exam_type, stage=1, difficulty="Medium", tenant_id=tenant_id, exclude_item_ids=used_item_ids
        )
        # Track Module 1 items as used
        for item in module1_items:
            used_item_ids.add(item["item_id"])
        
        # Module 2 Easy: Difficulty "Easy" (mostly Easy + Medium)
        # Exclude items already used in Module 1
        module2_easy_items = await ExamService.generate_diagnostic_stage(
            db, exam_type, stage=2, difficulty="Easy", tenant_id=tenant_id, exclude_item_ids=used_item_ids
        )
        # Track Module 2 Easy items as used
        for item in module2_easy_items:
            used_item_ids.add(item["item_id"])
        
        # Module 2 Hard: Difficulty "Hard" (mostly Hard + Medium)
        # Exclude items already used in Module 1 and Module 2 Easy
        module2_hard_items = await ExamService.generate_diagnostic_stage(
            db, exam_type, stage=2, difficulty="Hard", tenant_id=tenant_id, exclude_item_ids=used_item_ids
        )
        
        # Convert to ItemRef objects
        module1_item_refs = [ItemRef(item_id=item["item_id"]) for item in module1_items]
        module2_easy_item_refs = [ItemRef(item_id=item["item_id"]) for item in module2_easy_items]
        module2_hard_item_refs = [ItemRef(item_id=item["item_id"]) for item in module2_hard_items]
        
        # Create Module 2 Easy
        module2_easy = Container(
            id=f"{domain}_module_2_easy",
            type="module",
            flow_strategy="linear",
            items=module2_easy_item_refs,
            metadata={
                "time_per_question_seconds": 150,  # 2.5 minutes (2.5 * 60 = 150)
                "total_questions": 12,
                "difficulty": "Easy",
                "stage": 2
            }
        )
        
        # Create Module 2 Hard
        module2_hard = Container(
            id=f"{domain}_module_2_hard",
            type="module",
            flow_strategy="linear",
            items=module2_hard_item_refs,
            metadata={
                "time_per_question_seconds": 150,  # 2.5 minutes
                "total_questions": 12,
                "difficulty": "Hard",
                "stage": 2
            }
        )
        
        # Create Module 1 with adaptive routing using configurable threshold
        from src.core.engine import NavigationEngine
        
        module1_routing_rules = NavigationEngine.create_routing_rules(
            threshold=routing_threshold,
            easy_module_id=f"{domain}_module_2_easy",
            hard_module_id=f"{domain}_module_2_hard"
        )
        
        module1 = Container(
            id=f"{domain}_module_1",
            type="module",
            flow_strategy="adaptive_stage",
            items=module1_item_refs,
            routing_rules=module1_routing_rules,
            metadata={
                "time_per_question_seconds": 150,  # 2.5 minutes
                "total_questions": 12,
                "routing_threshold": routing_threshold,  # Store threshold in metadata for reference
                "difficulty": "Medium",
                "stage": 1
            }
        )
        
        # Create root exam container
        exam_container = Container(
            id=f"{exam_type.lower()}_root",
            type="test",
            flow_strategy="linear",
            children=[module1, module2_easy, module2_hard],
            metadata={
                "exam_type": exam_type,
                "total_questions": 24,  # 12 per module
                "total_time_seconds": 3600,  # 24 questions * 150 seconds = 60 minutes
                "time_per_question_seconds": 150,  # 2.5 minutes per question
                "routing_threshold": routing_threshold,  # Store threshold at root level for easy access
                "duration_seconds": 3600  # For SessionManager compatibility
            }
        )
        
        return exam_container
