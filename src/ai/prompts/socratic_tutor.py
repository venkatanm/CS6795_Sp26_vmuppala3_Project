"""
Python version of Socratic Tutor System Prompt

This is a Python implementation for backend use.
The TypeScript version (socratic_tutor.ts) is the primary implementation.
"""

from typing import Optional, List, Dict, Any
from dataclasses import dataclass


@dataclass
class StudentMisconception:
    """The student's misconception."""
    concept: str
    wrong_answer: str
    description: Optional[str] = None


@dataclass
class ReferenceMaterial:
    """Reference material from RAG pipeline."""
    content: str
    source: Optional[str] = None
    concept: Optional[str] = None


@dataclass
class ConversationTurn:
    """A turn in the conversation."""
    role: str  # 'student' or 'tutor'
    content: str
    timestamp: Optional[str] = None


@dataclass
class SocraticTutorContext:
    """Context for building the Socratic tutor prompt."""
    student_misconception: Optional[StudentMisconception] = None
    reference_material: Optional[List[ReferenceMaterial]] = None
    conversation_history: Optional[List[ConversationTurn]] = None
    current_question: Optional[str] = None
    concept: Optional[str] = None


PRIME_DIRECTIVE = """You are a Socratic Tutor. Your role is to guide students through discovery, not to solve problems for them.

CRITICAL RULES (NEVER VIOLATE):
1. NEVER give the answer, even if the student explicitly asks for it
2. NEVER show complete solutions or step-by-step calculations
3. NEVER confirm if a student's answer is correct or incorrect directly
4. ALWAYS respond with guiding questions that lead the student to discover the answer
5. If asked "What's the answer?", respond: "I can't give you the answer, but I can help you think through it. What do you think the first step should be?"
6. If asked "Is this correct?", respond: "Let's check your reasoning. Can you explain why you chose that approach?"
7. If asked "Just tell me", respond: "I understand you want the answer, but you'll learn more by working through it. What part are you stuck on?"

Your goal is to help students develop problem-solving skills through guided discovery, not to provide shortcuts."""


CHAIN_OF_THOUGHT_TEMPLATE = """Before responding, you MUST think through the following (this is hidden from the student):

1. IDENTIFY THE MISCONCEPTION:
   - What specific error is the student making?
   - What knowledge gap does this reveal?
   - What concept do they need to understand better?

2. SELECT REFERENCE MATERIAL:
   - Which reference material is most relevant to address this misconception?
   - What key points from the reference should guide your questions?

3. DESIGN THE GUIDING QUESTION:
   - What question will help the student discover their error?
   - What question will lead them to the correct approach?
   - Is this question too leading (giving away the answer)? If yes, make it more open-ended.

4. CHECK FOR ANSWER LEAKAGE:
   - Does your response contain any part of the answer?
   - Does it confirm or deny correctness?
   - Does it show calculations or steps that reveal the solution?
   - If YES to any, rewrite to be more guiding and less revealing.

5. ENSURE SOCRATIC METHOD:
   - Does your question encourage the student to think?
   - Does it build on what they already know?
   - Does it lead them to discover rather than memorize?

ONLY AFTER completing this chain of thought should you generate your response to the student."""


def build_socratic_tutor_prompt(context: SocraticTutorContext) -> str:
    """
    Build the Socratic tutor system prompt with context.
    
    Args:
        context: The tutoring context including misconceptions, reference material, etc.
        
    Returns:
        The complete system prompt string
    """
    parts = []
    
    # Prime Directive
    parts.append(PRIME_DIRECTIVE)
    parts.append('')
    
    # Chain of Thought Requirement
    parts.append('## THINKING PROCESS (Hidden from Student)')
    parts.append(CHAIN_OF_THOUGHT_TEMPLATE)
    parts.append('')
    
    # Context: Student Misconception
    if context.student_misconception:
        parts.append('## STUDENT MISCONCEPTION')
        parts.append(f"The student is struggling with: {context.student_misconception.concept}")
        parts.append(f"Their incorrect approach/answer: {context.student_misconception.wrong_answer}")
        if context.student_misconception.description:
            parts.append(f"Why this is a misconception: {context.student_misconception.description}")
        parts.append('')
        parts.append('Your task: Design questions that help them identify and correct this misconception WITHOUT revealing the correct answer.')
        parts.append('')
    
    # Context: Reference Material
    if context.reference_material:
        parts.append('## REFERENCE MATERIAL (Use to Guide Your Questions)')
        for idx, ref in enumerate(context.reference_material, 1):
            parts.append(f'\n[Reference {idx}]')
            if ref.concept:
                parts.append(f'Concept: {ref.concept}')
            if ref.source:
                parts.append(f'Source: {ref.source}')
            parts.append(f'Content: {ref.content}')
            parts.append('')
        parts.append('Use this material to inform your guiding questions, but DO NOT quote it directly or reveal information that gives away the answer.')
        parts.append('')
    
    # Context: Current Question
    if context.current_question:
        parts.append('## CURRENT QUESTION')
        parts.append(context.current_question)
        parts.append('')
        parts.append('Remember: You cannot solve this for the student. Guide them through understanding what the question is asking and how to approach it.')
        parts.append('')
    
    # Context: Conversation History
    if context.conversation_history:
        parts.append('## CONVERSATION HISTORY (Last 5 Turns)')
        recent_history = context.conversation_history[-5:]
        for turn in recent_history:
            parts.append(f"{turn.role.upper()}: {turn.content}")
        parts.append('')
        parts.append('Build on this conversation. If the student is repeating questions, acknowledge their frustration but continue guiding rather than giving answers.')
        parts.append('')
    
    # Final Instructions
    parts.append('## YOUR RESPONSE')
    parts.append('Generate your response following these steps:')
    parts.append('1. Complete the Chain of Thought process above (hidden)')
    parts.append('2. Check that your response contains NO answers, solutions, or confirmations')
    parts.append('3. Ask 1-2 guiding questions that help the student discover the next step')
    parts.append('4. Acknowledge their effort and encourage continued thinking')
    parts.append('5. If they ask for the answer, politely refuse and redirect with a question')
    parts.append('')
    parts.append('Remember: A good Socratic tutor helps students think, not think for them.')
    
    return '\n'.join(parts)


def validate_response(response: str, correct_answer: Optional[str] = None) -> Dict[str, Any]:
    """
    Validate that a response doesn't violate guardrails.
    
    Args:
        response: The tutor's response
        correct_answer: Optional correct answer to check against
        
    Returns:
        Dictionary with validation results
    """
    violations = []
    warnings = []
    
    # Check for direct answer patterns
    answer_patterns = [
        r'the answer is',
        r'the solution is',
        r'the correct answer',
        r'you should get',
        r'equals to',
        r'which is',
        r'result is',
    ]
    
    import re
    for pattern in answer_patterns:
        if re.search(pattern, response, re.IGNORECASE):
            # But allow if it's in a question
            if not re.search(r'(is|are|does|do|can|will).*\?', response, re.IGNORECASE):
                violations.append('Response contains direct answer')
                break
    
    # Check for confirmation patterns
    confirmation_patterns = [
        r"that's correct",
        r"you're right",
        r'exactly right',
        r'that is correct',
        r'correct!',
        r"yes, that's",
        r'perfect!',
    ]
    
    for pattern in confirmation_patterns:
        if re.search(pattern, response, re.IGNORECASE):
            violations.append('Response confirms correctness directly')
            break
    
    # Check for solution patterns
    solution_patterns = [
        r'step 1:',
        r'first, ',
        r'then, ',
        r'finally, ',
        r'the solution:',
        r"here's how",
        r'let me solve',
    ]
    
    matches = sum(1 for pattern in solution_patterns if re.search(pattern, response, re.IGNORECASE))
    if matches >= 3:
        violations.append('Response shows step-by-step solution')
    
    # Check for guiding questions
    question_count = len(re.findall(r'\?', response))
    if question_count < 1:
        warnings.append('Response may lack guiding questions')
    
    # Check if answer is present
    if correct_answer and str(correct_answer) in response:
        if not re.search(r'(is|are|does|do|can|will).*\?', response, re.IGNORECASE):
            violations.append('Response contains the correct answer')
    
    # Calculate score
    score = 100
    score -= len(violations) * 30
    score -= len(warnings) * 10
    score = max(0, score)
    
    return {
        'is_valid': len(violations) == 0,
        'violations': violations,
        'warnings': warnings,
        'score': score,
    }
