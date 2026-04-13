from typing import Optional, List, Dict, Any
from datetime import datetime
from pydantic import BaseModel, Field, field_serializer


class SessionState(BaseModel):
    """Schema for session state response."""
    exam_id: str
    user_id: str
    current_node_id: Optional[str] = None
    current_item_id: Optional[str] = None
    current_item_index: Optional[int] = None
    start_time: str  # ISO format timestamp
    expires_at: Optional[datetime] = Field(None, description="Session expiration timestamp (None for legacy sessions)")
    status: str  # "active", "completed", etc.
    student_theta: Optional[float] = Field(None, description="Current student ELO rating")
    response_history: Optional[List[Dict[str, Any]]] = Field(None, description="List of submitted responses")
    
    @field_serializer('expires_at')
    def serialize_expires_at(self, value: Optional[datetime]) -> Optional[str]:
        """Serialize datetime to ISO format string."""
        if value is None:
            return None
        return value.isoformat()
