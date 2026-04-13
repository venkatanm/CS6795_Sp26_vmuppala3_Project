from typing import Dict, List
from pydantic import BaseModel


class LogicTemplate(BaseModel):
    """Represents an abstract math problem template."""
    
    template_id: str
    variables: Dict[str, str]  # e.g., {'x': 'random_int(1,10)', 'slope': 'random_int(2,5)'}
    question_text: str  # e.g., 'A line passes through origin with slope {slope}. What is y when x is {x}?'
    python_formula: str  # e.g., '{slope} * {x}'
    distractor_formulas: List[str] = []  # Formulas for generating wrong answers
    constraints: List[str]  # e.g., ['result < 100', 'result > 0']
