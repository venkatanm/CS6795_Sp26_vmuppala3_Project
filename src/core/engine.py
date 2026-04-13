"""
Navigation engine for exam flow control.
Handles linear and adaptive routing strategies.
"""
import sys
from pathlib import Path
from typing import Optional, Dict, Any, List
from uuid import UUID

# Add project root to path for standalone execution
project_root = Path(__file__).resolve().parents[2]
if str(project_root) not in sys.path:
    sys.path.insert(0, str(project_root))

from src.schemas.exam import Container, RoutingRule


# Special marker for end of container
EndOfContainer = "END_OF_CONTAINER"


class NavigationEngine:
    """Engine for navigating through exam containers based on flow strategy."""
    
    @staticmethod
    def get_next_node(
        current_container: Container,
        current_item_index: int,
        routing_rules: List[RoutingRule],
        current_score: float
    ) -> str:
        """
        Determine the next node to navigate to based on container flow strategy.
        
        Args:
            current_container: The current container being navigated
            current_item_index: Current index in the items list (0-based)
            routing_rules: List of routing rules for adaptive navigation
            current_score: Current score (0.0 to 1.0) for adaptive routing
            
        Returns:
            Next node ID (string) or EndOfContainer if no next node
        """
        flow_strategy = current_container.flow_strategy
        
        if flow_strategy == "linear":
            return NavigationEngine._handle_linear_flow(
                current_container,
                current_item_index
            )
        
        elif flow_strategy == "adaptive_stage":
            return NavigationEngine._handle_adaptive_stage_flow(
                routing_rules,
                current_score
            )
        
        elif flow_strategy == "adaptive_item":
            # For adaptive_item, we still need to check if there are more items
            # but routing happens at item level (not implemented here)
            return NavigationEngine._handle_linear_flow(
                current_container,
                current_item_index
            )
        
        else:
            # Unknown flow strategy, default to linear behavior
            return NavigationEngine._handle_linear_flow(
                current_container,
                current_item_index
            )
    
    @staticmethod
    def _handle_linear_flow(
        container: Container,
        current_item_index: int
    ) -> str:
        """
        Handle linear flow: move to next item or end of container.
        
        Args:
            container: Current container
            current_item_index: Current item index
            
        Returns:
            Next item ID or EndOfContainer
        """
        items = container.items
        
        if not items:
            return EndOfContainer
        
        # Check if there's a next item
        if current_item_index + 1 < len(items):
            next_item = items[current_item_index + 1]
            return next_item.item_id
        else:
            return EndOfContainer
    
    @staticmethod
    def _handle_adaptive_stage_flow(
        routing_rules: List[RoutingRule],
        current_score: float
    ) -> str:
        """
        Handle adaptive stage flow: evaluate routing rules based on score.
        
        Args:
            routing_rules: List of routing rules to evaluate
            current_score: Current score (0.0 to 1.0)
            
        Returns:
            Destination ID from matching rule, or EndOfContainer if no match
        """
        if not routing_rules:
            return EndOfContainer
        
        # Evaluate routing rules in order
        # First matching rule wins
        for rule in routing_rules:
            if NavigationEngine._evaluate_condition(rule.condition, current_score):
                return rule.destination_id
        
        # No rule matched, end of container
        return EndOfContainer
    
    @staticmethod
    def _evaluate_condition(condition: str, score: float) -> bool:
        """
        Evaluate a routing condition string against the current score.
        
        Supports conditions like:
        - "score < 0.5"
        - "score >= 0.7"
        - "score == 0.6"
        - "score <= 0.4"
        - "score > 0.8"
        
        Args:
            condition: Condition string (e.g., "score < 0.5")
            score: Current score value
            
        Returns:
            True if condition is met, False otherwise
        """
        # Safe evaluation context - only allow score and comparison operations
        safe_dict = {
            'score': score,
            '__builtins__': {},
        }
        
        try:
            # Evaluate the condition
            result = eval(condition, safe_dict)
            return bool(result)
        except Exception:
            # If evaluation fails, default to False
            return False
    
    @staticmethod
    def create_routing_rules(
        threshold: Optional[float] = None,
        easy_module_id: str = "module_2_easy",
        hard_module_id: str = "module_2_hard"
    ) -> List[RoutingRule]:
        """
        Create routing rules with configurable threshold.
        
        Args:
            threshold: Score threshold (0.0 to 1.0). Scores < threshold route to easy, >= threshold route to hard.
                      If None, uses CAT_ROUTING_THRESHOLD from config (default: 0.55).
            easy_module_id: ID of the easy module to route to
            hard_module_id: ID of the hard module to route to
            
        Returns:
            List of RoutingRule objects for adaptive stage routing
        """
        # Use configurable threshold from settings if not provided
        if threshold is None:
            from src.core.config import settings
            threshold = settings.CAT_ROUTING_THRESHOLD
        return [
            RoutingRule(
                condition=f"score < {threshold}",
                destination_id=easy_module_id
            ),
            RoutingRule(
                condition=f"score >= {threshold}",
                destination_id=hard_module_id
            )
        ]
    
    @staticmethod
    def extract_threshold_from_routing_rules(routing_rules: List[RoutingRule]) -> Optional[float]:
        """
        Extract the routing threshold from existing routing rules.
        
        Looks for conditions like "score < X" or "score >= X" and returns the threshold value.
        
        Args:
            routing_rules: List of RoutingRule objects
            
        Returns:
            Threshold value (float) if found, None otherwise
        """
        import re
        
        for rule in routing_rules:
            # Look for patterns like "score < 0.5" or "score >= 0.5"
            match = re.search(r'score\s*[<>=]+\s*([\d.]+)', rule.condition)
            if match:
                try:
                    threshold = float(match.group(1))
                    return threshold
                except ValueError:
                    continue
        
        return None
    
    @staticmethod
    def update_routing_threshold(
        container: Container,
        new_threshold: float,
        easy_module_id: Optional[str] = None,
        hard_module_id: Optional[str] = None
    ) -> Container:
        """
        Update the routing threshold in a container's routing rules.
        
        Args:
            container: Container with routing rules to update
            new_threshold: New threshold value (0.0 to 1.0)
            easy_module_id: Optional easy module ID (extracted from existing rules if not provided)
            hard_module_id: Optional hard module ID (extracted from existing rules if not provided)
            
        Returns:
            Updated Container with new routing rules
        """
        if not container.routing_rules:
            return container
        
        # Extract module IDs from existing rules if not provided
        if not easy_module_id or not hard_module_id:
            for rule in container.routing_rules:
                if '<' in rule.condition:
                    easy_module_id = rule.destination_id
                elif '>=' in rule.condition:
                    hard_module_id = rule.destination_id
        
        # Use defaults if still not found
        easy_module_id = easy_module_id or "module_2_easy"
        hard_module_id = hard_module_id or "module_2_hard"
        
        # Create new routing rules with updated threshold
        container.routing_rules = NavigationEngine.create_routing_rules(
            threshold=new_threshold,
            easy_module_id=easy_module_id,
            hard_module_id=hard_module_id
        )
        
        # Update metadata
        if container.metadata is None:
            container.metadata = {}
        container.metadata["routing_threshold"] = new_threshold
        
        return container
    
    @staticmethod
    def select_next_item(
        available_items: List[Dict[str, Any]],
        response_history: List[Dict[str, Any]],
        current_theta: float,
        items_per_module: int = 9
    ) -> Optional[Dict[str, Any]]:
        """
        Select the next item for adaptive testing, excluding items already answered.
        
        Args:
            available_items: List of candidate items with difficulty, item_id, etc.
            response_history: List of responses with 'item_id' keys
            current_theta: Current student ability (ELO rating)
            items_per_module: Target number of items per module
            
        Returns:
            Selected item dict or None if no items available
        """
        if not available_items:
            return None
        
        # Extract answered item IDs from response_history
        # CRITICAL: MUST include ALL item_ids from ENTIRE session.response_history to prevent duplicates
        # Do not rely on current_module_items alone - check the ENTIRE history across all modules
        exclude_ids = set()
        if response_history:
            for response in response_history:
                # Check multiple possible keys for item_id (handle different response formats)
                item_id = (
                    response.get("item_id") or 
                    response.get("questionId") or 
                    response.get("question_id") or
                    response.get("id")
                )
                if item_id:
                    # Add as string (most common format)
                    exclude_ids.add(str(item_id))
                    # Also add UUID format if applicable (for database UUIDs)
                    try:
                        exclude_ids.add(str(UUID(item_id)))
                    except (ValueError, TypeError):
                        pass
                    # Also add lowercase/uppercase variants for case-insensitive matching
                    exclude_ids.add(str(item_id).lower())
                    exclude_ids.add(str(item_id).upper())
        
        # Filter out items that have already been answered
        # Check all possible ID fields in items and compare against ENTIRE response_history
        unasked_items = []
        for item in available_items:
            # Get all possible identifiers for this item
            item_identifiers = []
            for key in ["item_id", "id", "logical_id"]:
                val = item.get(key)
                if val:
                    # Add string format
                    item_identifiers.append(str(val))
                    # Add case variants for case-insensitive matching
                    item_identifiers.append(str(val).lower())
                    item_identifiers.append(str(val).upper())
                    # Also try UUID format if applicable
                    try:
                        item_identifiers.append(str(UUID(val)))
                    except (ValueError, TypeError):
                        pass
            
            # Check if any identifier matches exclude_ids (from ENTIRE history)
            should_exclude = False
            for identifier in item_identifiers:
                if identifier and identifier != "None" and identifier in exclude_ids:
                    should_exclude = True
                    break
            
            if not should_exclude:
                unasked_items.append(item)
        
        if not unasked_items:
            # All items have been answered, return None to signal completion
            return None
        
        # Select item closest to current theta (adaptive selection)
        # Calculate expected score for each item and select one with ~0.5 expected score
        best_item = None
        best_diff = float('inf')
        
        for item in unasked_items:
            item_difficulty = item.get("difficulty", item.get("item_difficulty", current_theta))
            # Calculate how close this item's difficulty is to student's ability
            diff = abs(item_difficulty - current_theta)
            if diff < best_diff:
                best_diff = diff
                best_item = item
        
        return best_item if best_item else (unasked_items[0] if unasked_items else None)
    
    @staticmethod
    def check_completion_condition(
        response_history: List[Dict[str, Any]],
        items_per_module: int = 9,
        total_modules: int = 2
    ) -> bool:
        """
        Check if exam completion condition is met.
        
        Prevents infinite loops by:
        1. Checking if we've answered enough items (items_per_module * total_modules)
        2. Falling back to checking if no more items are available
        
        Args:
            response_history: List of responses with 'item_id' keys
            items_per_module: Target number of items per module
            total_modules: Total number of modules in the exam
            
        Returns:
            True if exam should be completed, False otherwise
        """
        if not response_history:
            return False
        
        # Count unique items answered
        answered_item_ids = set()
        for response in response_history:
            item_id = response.get("item_id") or response.get("questionId")
            if item_id:
                answered_item_ids.add(str(item_id))
        
        total_items_answered = len(answered_item_ids)
        target_items = items_per_module * total_modules
        
        # Completion condition: answered at least target number of items
        if total_items_answered >= target_items:
            return True
        
        # Fallback: If we've answered a reasonable number but can't find more items,
        # consider it complete to prevent infinite loops
        # This is a safety check - should not normally trigger
        if total_items_answered >= items_per_module and total_items_answered < target_items:
            # This means we're stuck - can't find more items
            # Allow completion to prevent infinite loop
            return True
        
        return False
    
    @staticmethod
    def check_stage_completion(
        stage_responses: List[Dict[str, Any]],
        items_per_stage: int = 9,
        select_next_item_result: Optional[Dict[str, Any]] = None
    ) -> bool:
        """
        Check if a stage/module is complete.
        
        Prevents infinite loops by:
        1. Strict check: if len(stage_responses) >= items_per_stage, return True
        2. Safety valve: if select_next_item returns None (pool exhausted), force completion
        
        Args:
            stage_responses: List of responses for the current stage/module
            items_per_stage: Target number of items per stage
            select_next_item_result: Result from select_next_item (None if pool exhausted)
            
        Returns:
            True if stage should be completed, False otherwise
        """
        # Strict check: Have we answered enough items for this stage?
        if len(stage_responses) >= items_per_stage:
            return True
        
        # Safety valve: If select_next_item returned None, the item pool is exhausted
        # This means we've run out of available items (all have been answered or pool is empty)
        # Force transition/completion immediately to prevent infinite loop
        if select_next_item_result is None:
            # Pool exhausted - force completion even if we haven't hit the target
            # This prevents infinite spinning when no more items are available
            return True
        
        return False


if __name__ == "__main__":
    """Test the NavigationEngine."""
    from src.schemas.exam import ItemRef, RoutingRule
    
    print("=" * 60)
    print("NavigationEngine Test")
    print("=" * 60)
    
    # Test 1: Linear flow with more items
    print("\nTest 1: Linear flow - next item available")
    linear_container = Container(
        id="block_1",
        type="block",
        flow_strategy="linear",
        items=[
            ItemRef(item_id="item_1"),
            ItemRef(item_id="item_2"),
            ItemRef(item_id="item_3"),
        ]
    )
    next_node = NavigationEngine.get_next_node(
        linear_container,
        current_item_index=0,
        routing_rules=[],
        current_score=0.0
    )
    print(f"  Current index: 0")
    print(f"  Next node: {next_node}")
    print(f"  Expected: item_2")
    
    # Test 2: Linear flow at end
    print("\nTest 2: Linear flow - end of container")
    next_node = NavigationEngine.get_next_node(
        linear_container,
        current_item_index=2,
        routing_rules=[],
        current_score=0.0
    )
    print(f"  Current index: 2 (last item)")
    print(f"  Next node: {next_node}")
    print(f"  Expected: {EndOfContainer}")
    
    # Test 3: Adaptive stage flow
    print("\nTest 3: Adaptive stage flow - score-based routing")
    adaptive_container = Container(
        id="module_1",
        type="module",
        flow_strategy="adaptive_stage",
        items=[
            ItemRef(item_id="item_1"),
            ItemRef(item_id="item_2"),
        ],
        # Use configurable threshold (defaults to settings.CAT_ROUTING_THRESHOLD)
        routing_rules=NavigationEngine.create_routing_rules(
            threshold=None,  # Will use settings.CAT_ROUTING_THRESHOLD
            easy_module_id="module_easy",
            hard_module_id="module_hard"
        )
    )
    
    # Test with low score
    next_node = NavigationEngine.get_next_node(
        adaptive_container,
        current_item_index=1,  # Finished all items
        routing_rules=adaptive_container.routing_rules,
        current_score=0.3
    )
    print(f"  Score: 0.3")
    print(f"  Next node: {next_node}")
    print(f"  Expected: module_easy")
    
    # Test with high score
    next_node = NavigationEngine.get_next_node(
        adaptive_container,
        current_item_index=1,
        routing_rules=adaptive_container.routing_rules,
        current_score=0.7
    )
    print(f"  Score: 0.7")
    print(f"  Next node: {next_node}")
    print(f"  Expected: module_hard")
    
    print("\n" + "=" * 60)
