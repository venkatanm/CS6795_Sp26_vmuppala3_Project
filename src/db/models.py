from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy import Column, String, Boolean, Float, Integer, DateTime, Text, ForeignKey, text, Index
from sqlalchemy.orm import relationship
from datetime import datetime
from src.db.base import Base # Assuming you have a declarative base

class ExamDefinition(Base):
    __tablename__ = "exam_definitions"

    id = Column(UUID(as_uuid=True), primary_key=True, server_default=text("gen_random_uuid()"))
    tenant_id = Column(String, nullable=False, index=True) # Critical for SaaS
    title = Column(String, nullable=False)
    
    # This stores the entire Pydantic 'Container' tree
    structure = Column(JSONB, nullable=False) 
    
    is_active = Column(Boolean, default=True)


class Session(Base):
    """Exam session model for tracking student exam attempts."""
    __tablename__ = "sessions"

    id = Column(UUID(as_uuid=True), primary_key=True, server_default=text("gen_random_uuid()"))
    tenant_id = Column(String, nullable=False, index=True)
    exam_id = Column(UUID(as_uuid=True), nullable=False, index=True)
    user_id = Column(String, nullable=False, index=True)
    status = Column(String, nullable=False)  # "active", "completed", etc.
    student_theta = Column(Float, nullable=True)  # IRT theta (ability score) — combined/legacy
    math_theta = Column(Float, nullable=True)  # Math-specific theta
    rw_theta = Column(Float, nullable=True)  # Reading & Writing-specific theta
    section_score = Column(Float, nullable=True)  # Final SAT score (200-800)
    start_time = Column(DateTime(timezone=True), nullable=False, server_default=text("now()"))
    end_time = Column(DateTime(timezone=True), nullable=True)
    expires_at = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime(timezone=True), nullable=False, server_default=text("now()"))
    updated_at = Column(DateTime(timezone=True), nullable=False, server_default=text("now()"))
    response_history = Column(JSONB, nullable=True)  # List of submitted responses
    performance_profile = Column(JSONB, nullable=True)  # Performance breakdown by category
    current_module_id = Column(String, nullable=True, index=True)
    current_question_index = Column(Integer, nullable=True)


class Item(Base):
    """Question/item model for storing exam questions."""
    __tablename__ = "items"

    id = Column(UUID(as_uuid=True), primary_key=True, server_default=text("gen_random_uuid()"))
    tenant_id = Column(String, nullable=False, index=True)
    question_text = Column(Text, nullable=False)  # Changed to Text for HTML content
    correct_answer = Column(String, nullable=False)  # Changed to String to support A/B/C/D format
    options = Column(JSONB, nullable=False)  # Array of answer options
    template_id = Column(String, nullable=True, index=True)
    context_type = Column(String, nullable=True)
    variables = Column(JSONB, nullable=True)  # Metadata and variables (includes image_paths)
    logical_id = Column(String, nullable=True, index=True)  # External question ID
    solution_text = Column(Text, nullable=True)  # Changed to Text for HTML content
    skill_tag = Column(String, nullable=True)
    skill_id = Column(UUID(as_uuid=True), ForeignKey("skills.id", ondelete="SET NULL"), nullable=True, index=True)
    ai_explanation = Column(Text, nullable=True)  # Pre-generated detailed explanation
    distractor_analysis = Column(JSONB, nullable=True)  # Analysis of wrong answers
    hint_sequence = Column(JSONB, nullable=True)  # Progressive hints


class Concept(Base):
    """Concept model for knowledge graph."""
    __tablename__ = "concepts"

    id = Column(UUID(as_uuid=True), primary_key=True, server_default=text("gen_random_uuid()"))
    name = Column(String, nullable=False, unique=True, index=True)
    description = Column(String, nullable=True)
    category = Column(String, nullable=True, index=True)
    level = Column(Integer, nullable=True)
    created_at = Column(DateTime(timezone=True), nullable=False, server_default=text("now()"))


class QuestionConcept(Base):
    """Junction table linking questions to concepts (TESTS edge)."""
    __tablename__ = "question_concepts"

    id = Column(UUID(as_uuid=True), primary_key=True, server_default=text("gen_random_uuid()"))
    question_id = Column(UUID(as_uuid=True), ForeignKey("items.id", ondelete="CASCADE"), nullable=False, index=True)
    concept_id = Column(UUID(as_uuid=True), ForeignKey("concepts.id", ondelete="CASCADE"), nullable=False, index=True)
    weight = Column(Float, nullable=True, server_default=text("1.0"))
    created_at = Column(DateTime(timezone=True), nullable=False, server_default=text("now()"))


class TutorChat(Base):
    """Tutor chat model for storing Socratic tutor conversations."""
    __tablename__ = "tutor_chats"

    id = Column(UUID(as_uuid=True), primary_key=True, server_default=text("gen_random_uuid()"))
    session_id = Column(UUID(as_uuid=True), ForeignKey("sessions.id", ondelete="CASCADE"), nullable=False, index=True)
    question_id = Column(String, nullable=False, index=True)
    tenant_id = Column(String, nullable=False, index=True)
    messages = Column(JSONB, nullable=False)  # Array of chat messages
    student_answer = Column(String, nullable=True)
    correct_answer = Column(String, nullable=True)
    question_stem = Column(Text, nullable=True)
    passage_text = Column(Text, nullable=True)
    category = Column(String, nullable=True)
    created_at = Column(DateTime(timezone=True), nullable=False, server_default=text("now()"))
    updated_at = Column(DateTime(timezone=True), nullable=False, server_default=text("now()"))


class CurriculumChunk(Base):
    """Curriculum chunk model for RAG vector storage."""
    __tablename__ = "curriculum_chunks"

    id = Column(UUID(as_uuid=True), primary_key=True, server_default=text("gen_random_uuid()"))
    content = Column(Text, nullable=False)
    concept_id = Column(UUID(as_uuid=True), ForeignKey("concepts.id", ondelete="SET NULL"), nullable=True, index=True)
    concept_name = Column(String, nullable=True, index=True)
    difficulty = Column(String, nullable=True, index=True)
    source = Column(String, nullable=True)
    chunk_index = Column(Integer, nullable=True)
    chunk_metadata = Column("metadata", JSONB, nullable=True)  # Use "metadata" as column name, but chunk_metadata as attribute
    created_at = Column(DateTime(timezone=True), nullable=False, server_default=text("now()"))
    # Note: embedding column is added via raw SQL in migration, not defined here


# Stub models for Domain and Skill (may not have migrations yet, but referenced in code)
class Domain(Base):
    """Domain model for curriculum taxonomy."""
    __tablename__ = "domains"

    id = Column(UUID(as_uuid=True), primary_key=True, server_default=text("gen_random_uuid()"))
    name = Column(String, nullable=False, unique=True, index=True)
    weight = Column(Float, nullable=True, server_default=text("1.0"))
    created_at = Column(DateTime(timezone=True), nullable=False, server_default=text("now()"))


class Skill(Base):
    """Skill model for curriculum taxonomy."""
    __tablename__ = "skills"

    id = Column(UUID(as_uuid=True), primary_key=True, server_default=text("gen_random_uuid()"))
    domain_id = Column(UUID(as_uuid=True), ForeignKey("domains.id", ondelete="CASCADE"), nullable=True, index=True)
    name = Column(String, nullable=False, index=True)
    description = Column(String, nullable=True)
    bloom_level = Column(Integer, nullable=True)
    created_at = Column(DateTime(timezone=True), nullable=False, server_default=text("now()"))


class Misconception(Base):
    """Misconception model for knowledge graph."""
    __tablename__ = "misconceptions"

    id = Column(UUID(as_uuid=True), primary_key=True, server_default=text("gen_random_uuid()"))
    name = Column(String, nullable=False, unique=True, index=True)
    description = Column(String, nullable=True)
    created_at = Column(DateTime(timezone=True), nullable=False, server_default=text("now()"))


class ConceptPrerequisite(Base):
    """Junction table for concept prerequisites (PREREQUISITE_OF edge)."""
    __tablename__ = "concept_prerequisites"

    id = Column(UUID(as_uuid=True), primary_key=True, server_default=text("gen_random_uuid()"))
    prerequisite_id = Column(UUID(as_uuid=True), ForeignKey("concepts.id", ondelete="CASCADE"), nullable=False, index=True)
    dependent_id = Column(UUID(as_uuid=True), ForeignKey("concepts.id", ondelete="CASCADE"), nullable=False, index=True)
    strength = Column(Float, nullable=True, server_default=text("1.0"))
    created_at = Column(DateTime(timezone=True), nullable=False, server_default=text("now()"))


class ConceptMisconception(Base):
    """Junction table linking concepts to misconceptions (COMMONLY_CONFUSED_WITH edge)."""
    __tablename__ = "concept_misconceptions"

    id = Column(UUID(as_uuid=True), primary_key=True, server_default=text("gen_random_uuid()"))
    concept_id = Column(UUID(as_uuid=True), ForeignKey("concepts.id", ondelete="CASCADE"), nullable=False, index=True)
    misconception_id = Column(UUID(as_uuid=True), ForeignKey("misconceptions.id", ondelete="CASCADE"), nullable=False, index=True)
    frequency = Column(Float, nullable=True, server_default=text("1.0"))
    created_at = Column(DateTime(timezone=True), nullable=False, server_default=text("now()"))