"""
Content generator service that uses LLM to generate question items with solution_text and skill_tag.
"""
import json
import os
import logging
from pathlib import Path
from typing import Dict, Any, Optional, List
from dotenv import load_dotenv

# Set up logging
logging.basicConfig(
    level=logging.DEBUG,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
    force=True  # Force reconfiguration
)
logger = logging.getLogger(__name__)
logger.setLevel(logging.DEBUG)

# Load environment variables from .env file
# Try multiple locations: current directory, project root, and parent directories
env_paths = [
    Path('.env'),  # Current directory
    Path(__file__).parent.parent.parent / '.env',  # Project root (from src/services/content_generator.py)
    Path.cwd() / '.env',  # Current working directory
]

env_loaded = False
for env_path in env_paths:
    if env_path.exists():
        load_dotenv(dotenv_path=env_path, override=True)
        env_loaded = True
        print(f"[DEBUG] Loaded .env from: {env_path.absolute()}")
        break

if not env_loaded:
    # Try default load_dotenv() as fallback
    load_dotenv()
    print(f"[DEBUG] Attempted to load .env from default location (current dir: {os.getcwd()})")

try:
    import google.genai as genai
    GEMINI_AVAILABLE = True
    
    # Configure API key from environment variable (now loaded from .env)
    api_key = os.getenv('GEMINI_API_KEY')
    if api_key:
        try:
            # Initialize client with API key
            genai_client = genai.Client(api_key=api_key)
            GEMINI_API_KEY_SET = True
            print(f"[DEBUG] GEMINI_API_KEY loaded successfully (length: {len(api_key)})")
            logger.info(f"[DEBUG] GEMINI_API_KEY loaded successfully (length: {len(api_key)})")
        except Exception as e:
            GEMINI_API_KEY_SET = False
            genai_client = None
            print(f"[ERROR] Failed to initialize genai_client: {e}")
            logger.error(f"[ERROR] Failed to initialize genai_client: {e}")
    else:
        GEMINI_API_KEY_SET = False
        genai_client = None
        print("Warning: GEMINI_API_KEY not found in environment variables. AI generation will fail.")
        print(f"[DEBUG] Current working directory: {os.getcwd()}")
        print(f"[DEBUG] .env file exists: {os.path.exists('.env')}")
        logger.warning("GEMINI_API_KEY not found in environment variables")
        logger.debug(f"Current working directory: {os.getcwd()}")
        logger.debug(f".env file exists: {os.path.exists('.env')}")
except ImportError as e:
    GEMINI_AVAILABLE = False
    GEMINI_API_KEY_SET = False
    genai_client = None
    print(f"Warning: google.genai not available. Install with: pip install google-genai. Error: {e}")
    logger.error(f"google.genai not available. Install with: pip install google-genai. Error: {e}")
except Exception as e:
    GEMINI_AVAILABLE = False
    GEMINI_API_KEY_SET = False
    genai_client = None
    print(f"[ERROR] Unexpected error initializing Gemini: {e}")
    logger.error(f"Unexpected error initializing Gemini: {e}")
    import traceback
    logger.error(traceback.format_exc())

from src.services.prompt_templates import get_random_template


def generate_item_with_ai(
    base_text: str,
    context_type: str,
    variables: Dict[str, Any],
    correct_answer: float
) -> Dict[str, Any]:
    """
    Generate a complete question item using AI with JSON response format.
    
    Args:
        base_text: The original math problem text
        context_type: One of ['finance', 'physics', 'construction', 'pure_math']
        variables: Dictionary of variable values to preserve
        correct_answer: The correct answer value
        
    Returns:
        Dictionary with:
        - question_text: Rephrased question text
        - solution_text: Step-by-step solution in LaTeX format
        - skill_tag: Standardized topic tag (e.g., 'Algebra', 'Geometry', 'Problem Solving')
    """
    valid_contexts = ['finance', 'physics', 'construction', 'pure_math']
    if context_type not in valid_contexts:
        raise ValueError(f"context_type must be one of {valid_contexts}")
    
    # Format variables for the prompt
    variables_str = ", ".join([f"{k}={v}" for k, v in variables.items()])
    
    # System prompt that instructs LLM to return JSON
    system_prompt = """You are an SAT math item writer and tutor. When given a math problem, you must respond with a JSON object containing:
1. question_text: Rewrite the problem as a word problem in the given context, using the EXACT numbers provided.
2. solution_text: A detailed, step-by-step explanation in LaTeX format. Use LaTeX notation for mathematical expressions (e.g., $x^2$, $\\frac{a}{b}$, $\\sqrt{x}$). Format as a numbered list of steps.
3. skill_tag: A standardized topic tag. Choose ONE from: 'Algebra', 'Geometry', 'Data Analysis', 'Problem Solving', 'Advanced Math', 'Number Operations'.

Respond ONLY with valid JSON, no additional text before or after."""

    user_prompt = (
        f'Base math problem: "{base_text}"\n\n'
        f'Context: {context_type}\n'
        f'Variables used: {variables_str}\n'
        f'Correct answer: {correct_answer}\n\n'
        f'Generate the question_text, solution_text, and skill_tag as specified.'
    )
    
    # Use Gemini 2.5 Flash Lite if available, otherwise fall back to mock
    if not GEMINI_AVAILABLE:
        print(f"\n[MOCK AI CALL - Gemini not available]")
        print(f"Context: {context_type}")
        print(f"Original: {base_text}")
        return {
            "question_text": f"[{context_type.upper()}] {base_text}",
            "solution_text": f"Step 1: Substitute the given values into the formula.\nStep 2: Calculate the result.\nStep 3: The answer is ${correct_answer}$.",
            "skill_tag": "Problem Solving"
        }
    
    try:
        # Generate content using the new API
        # Combine system and user prompts
        full_prompt = f"{system_prompt}\n\n{user_prompt}"
        
        # Generate the response using the new API
        response = genai_client.models.generate_content(
            model='gemini-2.5-flash-lite',
            contents=full_prompt,
            config={
                "temperature": 0.7,
                "top_p": 0.9,
            }
        )
        
        # Extract text from response (new API structure)
        response_text = response.text.strip()
        
        # Parse JSON from response
        # Try to extract JSON if it's wrapped in markdown code blocks
        if "```json" in response_text:
            # Extract JSON from markdown code block
            start = response_text.find("```json") + 7
            end = response_text.find("```", start)
            if end != -1:
                response_text = response_text[start:end].strip()
        elif "```" in response_text:
            # Extract from generic code block
            start = response_text.find("```") + 3
            end = response_text.find("```", start)
            if end != -1:
                response_text = response_text[start:end].strip()
        
        # Parse the JSON
        try:
            parsed_response = json.loads(response_text)
        except json.JSONDecodeError as e:
            print(f"Warning: Failed to parse JSON response: {e}")
            print(f"Response text: {response_text[:200]}...")
            # Fallback: try to extract fields manually or use defaults
            return {
                "question_text": f"[{context_type.upper()}] {base_text}",
                "solution_text": f"Step 1: Substitute the given values.\nStep 2: Calculate the result.\nStep 3: The answer is ${correct_answer}$.",
                "skill_tag": "Problem Solving"
            }
        
        # Validate and extract fields
        question_text = parsed_response.get("question_text", f"[{context_type.upper()}] {base_text}")
        solution_text = parsed_response.get("solution_text", f"Step 1: Substitute the given values.\nStep 2: Calculate the result.\nStep 3: The answer is ${correct_answer}$.")
        skill_tag = parsed_response.get("skill_tag", "Problem Solving")
        
        # Validate skill_tag is one of the allowed values
        valid_skill_tags = ['Algebra', 'Geometry', 'Data Analysis', 'Problem Solving', 'Advanced Math', 'Number Operations']
        if skill_tag not in valid_skill_tags:
            print(f"Warning: Invalid skill_tag '{skill_tag}', defaulting to 'Problem Solving'")
            skill_tag = "Problem Solving"
        
        return {
            "question_text": question_text,
            "solution_text": solution_text,
            "skill_tag": skill_tag
        }
        
    except Exception as e:
        # Handle case where model refuses the prompt or other errors
        error_str = str(e).lower()
        if 'blocked' in error_str or 'safety' in error_str:
            print(f"Warning: Gemini blocked generation for context '{context_type}': {e}")
        else:
            print(f"Warning: Gemini API error for context '{context_type}': {e}")
        print(f"Falling back to default values.")
        return {
            "question_text": f"[{context_type.upper()}] {base_text}",
            "solution_text": f"Step 1: Substitute the given values.\nStep 2: Calculate the result.\nStep 3: The answer is ${correct_answer}$.",
            "skill_tag": "Problem Solving"
        }
    except Exception as e:
        # Fallback on any other error
        print(f"Error calling Gemini API: {e}")
        print(f"Falling back to default values.")
        return {
            "question_text": f"[{context_type.upper()}] {base_text}",
            "solution_text": f"Step 1: Substitute the given values.\nStep 2: Calculate the result.\nStep 3: The answer is ${correct_answer}$.",
            "skill_tag": "Problem Solving"
        }


def _map_topic_to_domain(topic: str) -> str:
    """
    Map user-friendly topic names to prompt template domain keys.
    
    Args:
        topic: Topic name like 'Algebra', 'Geometry', etc.
        
    Returns:
        Domain key for prompt_templates (e.g., 'algebra_linear', 'geometry')
    """
    topic_lower = topic.lower()
    
    # Map topics to domains
    if 'algebra' in topic_lower:
        # Randomly choose between linear and quadratics for variety
        import random
        return random.choice(['algebra_linear', 'algebra_quadratics'])
    elif 'geometry' in topic_lower:
        return 'geometry'
    elif 'data' in topic_lower or 'analysis' in topic_lower:
        return 'data_analysis'
    else:
        # Default to algebra_linear
        return 'algebra_linear'


def _generate_single_question_from_template(template: str, topic: str) -> Dict[str, Any]:
    """
    Generate a single question using a specific template pattern.
    
    Args:
        template: The template pattern string from prompt_templates
        topic: The topic name (for skill_tag mapping)
        
    Returns:
        Dictionary with question_text, solution_text, and skill_tag
    """
    logger.error(f"[DEBUG v2.1] _generate_single_question_from_template called with template: {template[:50]}...")
    print(f"[DEBUG v2.1] _generate_single_question_from_template called with template: {template[:50]}...", flush=True)
    # System prompt that instructs LLM to return JSON
    system_prompt = """You are an SAT math item writer and tutor. Generate ONE multiple-choice SAT math question based on the specific pattern provided. You must respond with a JSON object containing:
1. question_text: The question text ONLY (without the answer options). Make it clear and complete.
2. options: An array of 4 numeric values [option1, option2, option3, option4] where one is the correct answer.
3. correct_answer: The numeric value that is the correct answer (must match one of the values in options).
4. solution_text: A detailed, step-by-step explanation in LaTeX format. Use LaTeX notation for mathematical expressions (e.g., $x^2$, $\\frac{a}{b}$, $\\sqrt{x}$). Format as a numbered list of steps.
5. skill_tag: A standardized topic tag. Choose ONE from: 'Algebra', 'Geometry', 'Data Analysis', 'Problem Solving', 'Advanced Math', 'Number Operations'.

IMPORTANT CONSTRAINTS:
- DO NOT reference figures, diagrams, images, graphs, charts, or visual aids. The question must be solvable using only the text and given information.
- For geometry questions, describe shapes and relationships in words rather than referring to a figure.
- For data analysis questions, provide all necessary data in the question text itself.
- Make the question self-contained and complete without any visual references.

Make the question diverse and interesting. Each question should test a different aspect of the topic.

Respond ONLY with valid JSON, no additional text before or after."""

    user_prompt = f"Generate ONE multiple-choice SAT math question based on this specific pattern: {template}. Include detailed LaTeX solution and skill_tag."

    # Use Gemini 2.5 Flash Lite if available, otherwise fall back to mock
    # Re-check API key and client initialization (in case module wasn't reloaded)
    global genai_client, GEMINI_AVAILABLE, GEMINI_API_KEY_SET
    
    if not GEMINI_AVAILABLE or genai_client is None:
        logger.error(f"[CRITICAL] genai_client is None or GEMINI_AVAILABLE is False. Attempting to re-initialize...")
        logger.error(f"GEMINI_AVAILABLE: {GEMINI_AVAILABLE}, genai_client is None: {genai_client is None}")
        print(f"[CRITICAL] genai_client is None or GEMINI_AVAILABLE is False. Attempting to re-initialize...", flush=True)
        print(f"GEMINI_AVAILABLE: {GEMINI_AVAILABLE}, genai_client is None: {genai_client is None}", flush=True)
        
        # Try to re-initialize the client
        try:
            import google.genai as genai
            GEMINI_AVAILABLE = True
            logger.info("Successfully imported google.genai during re-initialization")
            
            # Reload .env - try multiple paths
            env_paths = [
                Path('.env'),
                Path(__file__).parent.parent.parent / '.env',
                Path.cwd() / '.env',
            ]
            env_loaded = False
            for env_path in env_paths:
                if env_path.exists():
                    load_dotenv(dotenv_path=env_path, override=True)
                    env_loaded = True
                    logger.info(f"Loaded .env from: {env_path.absolute()}")
                    break
            
            if not env_loaded:
                load_dotenv(override=True)
                logger.warning("Used default load_dotenv()")
            
            api_key = os.getenv('GEMINI_API_KEY')
            logger.debug(f"API key from env: {'SET' if api_key else 'NOT SET'}")
            
            if api_key:
                genai_client = genai.Client(api_key=api_key)
                GEMINI_API_KEY_SET = True
                print(f"[DEBUG] Successfully re-initialized genai_client", flush=True)
                logger.info(f"Successfully re-initialized genai_client (API key length: {len(api_key)})")
            else:
                print(f"[DEBUG] GEMINI_API_KEY not found in environment", flush=True)
                logger.warning("GEMINI_API_KEY not found in environment")
                genai_client = None
                GEMINI_API_KEY_SET = False
        except ImportError as e:
            print(f"[DEBUG] google.genai not available: {e}", flush=True)
            logger.error(f"google.genai not available: {e}", exc_info=True)
            GEMINI_AVAILABLE = False
            genai_client = None
        except Exception as e:
            print(f"[DEBUG] Failed to re-initialize genai_client: {e}", flush=True)
            logger.error(f"Failed to re-initialize genai_client: {e}", exc_info=True)
            genai_client = None
    
    if not GEMINI_AVAILABLE or genai_client is None:
        logger.error(f"\n[MOCK AI CALL - Gemini not available or client not initialized]")
        logger.error(f"GEMINI_AVAILABLE: {GEMINI_AVAILABLE}, genai_client is None: {genai_client is None}")
        logger.error(f"Template: {template}")
        print(f"\n[MOCK AI CALL - Gemini not available or client not initialized]", flush=True)
        print(f"GEMINI_AVAILABLE: {GEMINI_AVAILABLE}, genai_client is None: {genai_client is None}", flush=True)
        print(f"Template: {template}", flush=True)
        return {
            "question_text": f"[MOCK] {template}",
            "solution_text": f"Step 1: Apply the concept.\nStep 2: Calculate the result.\nStep 3: Verify the answer.",
            "skill_tag": topic if topic in ['Algebra', 'Geometry', 'Data Analysis', 'Problem Solving', 'Advanced Math', 'Number Operations'] else "Problem Solving",
            "correct_answer": 0.0,
            "options": [0.0, 1.0, 2.0, 3.0]
        }
    
    # Check if API key is set
    if not GEMINI_API_KEY_SET:
        print(f"Warning: GEMINI_API_KEY not configured. Cannot generate question for template: {template}")
        return {
            "question_text": f"Please configure GEMINI_API_KEY to generate questions. Template: {template}",
            "solution_text": f"Step 1: Configure GEMINI_API_KEY environment variable.\nStep 2: Restart the server.\nStep 3: Try generating again.",
            "skill_tag": topic if topic in ['Algebra', 'Geometry', 'Data Analysis', 'Problem Solving', 'Advanced Math', 'Number Operations'] else "Problem Solving",
            "correct_answer": 0.0,
            "options": [0.0, 1.0, 2.0, 3.0]
        }
    
    try:
        # Combine system and user prompts
        full_prompt = f"{system_prompt}\n\n{user_prompt}"
        
        # Generate the response using the new API
        try:
            response = genai_client.models.generate_content(
                model='gemini-2.5-flash-lite',
                contents=full_prompt,
                config={
                    "temperature": 0.8,
                    "top_p": 0.9,
                }
            )
            
            # Extract text from response (new API structure)
            response_text = response.text.strip()
            
            if not response_text:
                raise ValueError("Gemini API returned empty response text")
                
        except Exception as api_error:
            # Log the error and re-raise to be caught by outer exception handler
            error_msg = str(api_error)
            print(f"Gemini API call failed for template '{template[:50]}...': {error_msg}")
            
            # Check for common error types
            if 'api key' in error_msg.lower() or 'authentication' in error_msg.lower() or 'permission' in error_msg.lower():
                raise ValueError(f"API key authentication failed. Please check your GEMINI_API_KEY: {error_msg}")
            elif 'quota' in error_msg.lower() or 'rate limit' in error_msg.lower():
                raise ValueError(f"API quota or rate limit exceeded: {error_msg}")
            else:
                raise
        
        # Parse JSON from response
        # Try to extract JSON if it's wrapped in markdown code blocks
        if "```json" in response_text:
            start = response_text.find("```json") + 7
            end = response_text.find("```", start)
            if end != -1:
                response_text = response_text[start:end].strip()
        elif "```" in response_text:
            start = response_text.find("```") + 3
            end = response_text.find("```", start)
            if end != -1:
                response_text = response_text[start:end].strip()
        
        # Parse the JSON
        try:
            parsed_response = json.loads(response_text)
        except json.JSONDecodeError as e:
            print(f"Warning: Failed to parse JSON response: {e}")
            print(f"Response text (first 500 chars): {response_text[:500]}...")
            
            # Try to fix common JSON issues (unescaped backslashes in LaTeX)
            import re
            try:
                # The issue is often unescaped backslashes in LaTeX strings
                # Fix unescaped backslashes that aren't part of valid escape sequences
                # Pattern: backslash not followed by valid escape char or another backslash
                fixed_json = re.sub(r'\\(?!["\\/bfnrtu])', r'\\\\', response_text)
                parsed_response = json.loads(fixed_json)
                print("Successfully parsed JSON after fixing escape sequences")
            except (json.JSONDecodeError, Exception) as e2:
                print(f"Could not fix JSON parsing error: {e2}")
                # Try to extract fields manually using regex as last resort
                try:
                    # Extract question_text (handle escaped quotes and backslashes)
                    question_match = re.search(r'"question_text"\s*:\s*"((?:[^"\\]|\\.)*)"', response_text, re.DOTALL)
                    solution_match = re.search(r'"solution_text"\s*:\s*"((?:[^"\\]|\\.)*)"', response_text, re.DOTALL)
                    skill_tag_match = re.search(r'"skill_tag"\s*:\s*"([^"]+)"', response_text)
                    correct_answer_match = re.search(r'"correct_answer"\s*:\s*([0-9.]+)', response_text)
                    options_match = re.search(r'"options"\s*:\s*\[([^\]]+)\]', response_text)
                    
                    if question_match:
                        question_text = question_match.group(1).replace('\\"', '"').replace('\\\\', '\\').replace('\\n', '\n')
                        solution_text = solution_match.group(1).replace('\\"', '"').replace('\\\\', '\\').replace('\\n', '\n') if solution_match else "Step-by-step solution not available."
                        skill_tag = skill_tag_match.group(1) if skill_tag_match else topic
                        correct_answer = float(correct_answer_match.group(1)) if correct_answer_match else 0.0
                        
                        # Parse options
                        if options_match:
                            options_str = options_match.group(1)
                            options = [float(x.strip()) for x in options_str.split(',') if x.strip()]
                        else:
                            options = [correct_answer, correct_answer * 1.1, correct_answer * 0.9, correct_answer * 1.2]
                        
                        if len(options) < 4:
                            options = [correct_answer, correct_answer * 1.1, correct_answer * 0.9, correct_answer * 1.2]
                        
                        print("Successfully extracted fields using regex fallback")
                        return {
                            "question_text": question_text,
                            "solution_text": solution_text,
                            "skill_tag": skill_tag,
                            "correct_answer": correct_answer,
                            "options": options
                        }
                except Exception as e3:
                    print(f"Regex extraction also failed: {e3}")
                
                # Final fallback
                return {
                    "question_text": f"[FALLBACK] {template}",
                    "solution_text": f"Step 1: Apply the concept.\nStep 2: Calculate the result.\nStep 3: Verify the answer.",
                    "skill_tag": topic if topic in ['Algebra', 'Geometry', 'Data Analysis', 'Problem Solving', 'Advanced Math', 'Number Operations'] else "Problem Solving",
                    "correct_answer": 0.0,
                    "options": [0.0, 1.0, 2.0, 3.0]
                }
        
        # Validate and extract fields
        question_text = parsed_response.get("question_text", f"[GENERATED] {template}")
        solution_text = parsed_response.get("solution_text", f"Step 1: Apply the concept.\nStep 2: Calculate the result.\nStep 3: Verify the answer.")
        skill_tag = parsed_response.get("skill_tag", topic if topic in ['Algebra', 'Geometry', 'Data Analysis', 'Problem Solving', 'Advanced Math', 'Number Operations'] else "Problem Solving")
        correct_answer = parsed_response.get("correct_answer", 0.0)
        options = parsed_response.get("options", [])
        
        # Validate options array
        if not options or len(options) < 4:
            # Generate default options if not provided
            options = [correct_answer, correct_answer * 1.1, correct_answer * 0.9, correct_answer * 1.2]
            print(f"Warning: Invalid or missing options array, generated defaults")
        
        # Validate skill_tag is one of the allowed values
        valid_skill_tags = ['Algebra', 'Geometry', 'Data Analysis', 'Problem Solving', 'Advanced Math', 'Number Operations']
        if skill_tag not in valid_skill_tags:
            print(f"Warning: Invalid skill_tag '{skill_tag}', defaulting to '{topic}' or 'Problem Solving'")
            skill_tag = topic if topic in valid_skill_tags else "Problem Solving"
        
        return {
            "question_text": question_text,
            "solution_text": solution_text,
            "skill_tag": skill_tag,
            "correct_answer": correct_answer,
            "options": options
        }
        
    except Exception as e:
        import traceback
        error_trace = traceback.format_exc()
        error_str = str(e).lower()
        
        print(f"Error calling Gemini API for template '{template[:50]}...': {e}")
        print(f"Full traceback: {error_trace}")
        
        # Check for specific error types
        if 'blocked' in error_str or 'safety' in error_str:
            print(f"Warning: Gemini blocked generation for template '{template}': {e}")
        elif 'api key' in error_str or 'authentication' in error_str or 'permission' in error_str:
            print("ERROR: Gemini API key may be missing or invalid. Check your GEMINI_API_KEY environment variable.")
        elif 'quota' in error_str or 'rate limit' in error_str:
            print("ERROR: API quota or rate limit exceeded.")
        else:
            print(f"Warning: Gemini API error for template '{template}': {e}")
        
        # Return a fallback question
        return {
            "question_text": f"Solve the following problem: {template}",
            "solution_text": f"Step 1: Apply the concept from the template.\nStep 2: Calculate the result.\nStep 3: Verify the answer.",
            "skill_tag": topic if topic in ['Algebra', 'Geometry', 'Data Analysis', 'Problem Solving', 'Advanced Math', 'Number Operations'] else "Problem Solving",
            "correct_answer": 0.0,
            "options": [0.0, 1.0, 2.0, 3.0]
        }


def generate_questions(topic: str, count: int) -> List[Dict[str, Any]]:
    """
    Generate multiple diverse questions using random prompt templates.
    
    Instead of using a single static system prompt, this function iterates count times,
    each time selecting a random template for the topic to ensure diversity.
    
    Args:
        topic: Topic name (e.g., 'Algebra', 'Geometry', 'Advanced Math')
        count: Number of questions to generate
        
    Returns:
        List of dictionaries, each containing:
        - question_text: The generated question
        - solution_text: Step-by-step solution in LaTeX
        - skill_tag: Standardized topic tag
        - correct_answer: Numeric value of correct answer
    """
    generated_questions = []
    
    # Map topic to domain for template selection
    domain = _map_topic_to_domain(topic)
    
    logger.error("=" * 80)
    logger.error(f"[GENERATE_QUESTIONS] Starting generation: {count} questions for topic '{topic}' using domain '{domain}'")
    logger.error("=" * 80)
    print("=" * 80, flush=True)
    print(f"[GENERATE_QUESTIONS] Starting generation: {count} questions for topic '{topic}' using domain '{domain}'", flush=True)
    print("=" * 80, flush=True)
    
    # Iterate count times to generate diverse questions
    for i in range(count):
        print(f"[GENERATE_QUESTIONS] Generating question {i+1}/{count}...")
        
        # Get a random template for this topic/domain
        template = get_random_template(domain)
        print(f"[GENERATE_QUESTIONS] Selected template: {template[:100]}...")
        
        # Generate a single question using this template
        question = _generate_single_question_from_template(template, topic)
        
        has_mock = '[MOCK]' in question.get('question_text', '')
        has_fallback = '[FALLBACK]' in question.get('question_text', '')
        print(f"[GENERATE_QUESTIONS] Question {i+1} result: Has MOCK={has_mock}, Has FALLBACK={has_fallback}, skill_tag={question.get('skill_tag')}")
        print(f"[GENERATE_QUESTIONS] Question text preview: {question.get('question_text', '')[:100]}...")
        
        generated_questions.append(question)
    
    print("=" * 80)
    print(f"[GENERATE_QUESTIONS] Completed generation of {len(generated_questions)} questions")
    print("=" * 80)
    
    return generated_questions
