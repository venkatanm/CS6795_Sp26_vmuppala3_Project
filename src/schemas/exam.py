from typing import List, Optional, Literal, Dict, Any
from pydantic import BaseModel, Field

class RoutingRule(BaseModel):
    # e.g., "score < 5" -> "module_easy"
    condition: str 
    destination_id: str

class ItemRef(BaseModel):
    item_id: str
    points: float = 1.0

class Container(BaseModel):
    id: str
    # 'test' = Root, 'section' = Logical grouping, 'module' = Adaptive Unit
    type: Literal["test", "section", "module", "block"] 
    
    # "linear" = A->B->C
    # "adaptive_stage" = Complete all items -> Routing Rule -> Next Module
    # "adaptive_item" = Item -> Calc Theta -> Next Item
    flow_strategy: Literal["linear", "adaptive_stage", "adaptive_item"]
    
    # Recursive Children (The Magic)
    children: List['Container'] = []
    
    # If this is a leaf node (a block of questions), it has items
    items: List[ItemRef] = []
    
    # Logic to decide where to go next after this container
    routing_rules: List[RoutingRule] = []
    
    # Metadata (Time limits, Calculator allowed, etc.)
    metadata: Dict[str, Any] = {}

class ExamSchema(BaseModel):
    """Schema for creating/updating exam definitions."""
    title: str
    structure: Container  # The full exam structure as a Container tree
    duration_seconds: int = Field(default=3600, description="Exam duration in seconds (default: 3600 = 1 hour)")

# Rebuild model for recursion
Container.model_rebuild()