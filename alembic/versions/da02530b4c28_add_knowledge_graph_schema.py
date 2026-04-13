"""add_knowledge_graph_schema

Revision ID: da02530b4c28
Revises: b1c2d3e4f5a6
Create Date: 2026-01-27 14:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = 'da02530b4c28'
down_revision: Union[str, None] = 'b1c2d3e4f5a6'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Check if tables already exist (database may have been created manually)
    from sqlalchemy import inspect
    conn = op.get_bind()
    inspector = inspect(conn)
    existing_tables = inspector.get_table_names()
    
    # Create concepts table
    if 'concepts' not in existing_tables:
        op.create_table('concepts',
        sa.Column('id', postgresql.UUID(as_uuid=True), server_default=sa.text('gen_random_uuid()'), nullable=False),
        sa.Column('name', sa.String(), nullable=False),
        sa.Column('description', sa.String(), nullable=True),
        sa.Column('category', sa.String(), nullable=True),
        sa.Column('level', sa.Integer(), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.PrimaryKeyConstraint('id')
        )
        op.create_index(op.f('ix_concepts_name'), 'concepts', ['name'], unique=True)
        op.create_index(op.f('ix_concepts_category'), 'concepts', ['category'], unique=False)

    # Create misconceptions table
    if 'misconceptions' not in existing_tables:
        op.create_table('misconceptions',
        sa.Column('id', postgresql.UUID(as_uuid=True), server_default=sa.text('gen_random_uuid()'), nullable=False),
        sa.Column('name', sa.String(), nullable=False),
        sa.Column('description', sa.String(), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.PrimaryKeyConstraint('id')
        )
        op.create_index(op.f('ix_misconceptions_name'), 'misconceptions', ['name'], unique=True)

    # Create question_concepts table (TESTS edge: Question -> Concept)
    if 'question_concepts' not in existing_tables:
        op.create_table('question_concepts',
        sa.Column('id', postgresql.UUID(as_uuid=True), server_default=sa.text('gen_random_uuid()'), nullable=False),
        sa.Column('question_id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('concept_id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('weight', sa.Float(), nullable=True, server_default=sa.text('1.0')),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.ForeignKeyConstraint(['question_id'], ['items.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['concept_id'], ['concepts.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id')
        )
        op.create_index(op.f('ix_question_concepts_question_id'), 'question_concepts', ['question_id'], unique=False)
        op.create_index(op.f('ix_question_concepts_concept_id'), 'question_concepts', ['concept_id'], unique=False)

    # Create concept_prerequisites table (PREREQUISITE_OF edge: Concept -> Concept)
    if 'concept_prerequisites' not in existing_tables:
        op.create_table('concept_prerequisites',
        sa.Column('id', postgresql.UUID(as_uuid=True), server_default=sa.text('gen_random_uuid()'), nullable=False),
        sa.Column('prerequisite_id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('dependent_id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('strength', sa.Float(), nullable=True, server_default=sa.text('1.0')),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.ForeignKeyConstraint(['prerequisite_id'], ['concepts.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['dependent_id'], ['concepts.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id')
        )
        op.create_index(op.f('ix_concept_prerequisites_prerequisite_id'), 'concept_prerequisites', ['prerequisite_id'], unique=False)
        op.create_index(op.f('ix_concept_prerequisites_dependent_id'), 'concept_prerequisites', ['dependent_id'], unique=False)

    # Create concept_misconceptions table (COMMONLY_CONFUSED_WITH edge: Concept -> Misconception)
    if 'concept_misconceptions' not in existing_tables:
        op.create_table('concept_misconceptions',
        sa.Column('id', postgresql.UUID(as_uuid=True), server_default=sa.text('gen_random_uuid()'), nullable=False),
        sa.Column('concept_id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('misconception_id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('frequency', sa.Float(), nullable=True, server_default=sa.text('1.0')),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.ForeignKeyConstraint(['concept_id'], ['concepts.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['misconception_id'], ['misconceptions.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id')
        )
        op.create_index(op.f('ix_concept_misconceptions_concept_id'), 'concept_misconceptions', ['concept_id'], unique=False)
        op.create_index(op.f('ix_concept_misconceptions_misconception_id'), 'concept_misconceptions', ['misconception_id'], unique=False)


def downgrade() -> None:
    # Drop tables in reverse order
    op.drop_index(op.f('ix_concept_misconceptions_misconception_id'), table_name='concept_misconceptions')
    op.drop_index(op.f('ix_concept_misconceptions_concept_id'), table_name='concept_misconceptions')
    op.drop_table('concept_misconceptions')
    
    op.drop_index(op.f('ix_concept_prerequisites_dependent_id'), table_name='concept_prerequisites')
    op.drop_index(op.f('ix_concept_prerequisites_prerequisite_id'), table_name='concept_prerequisites')
    op.drop_table('concept_prerequisites')
    
    op.drop_index(op.f('ix_question_concepts_concept_id'), table_name='question_concepts')
    op.drop_index(op.f('ix_question_concepts_question_id'), table_name='question_concepts')
    op.drop_table('question_concepts')
    
    op.drop_index(op.f('ix_misconceptions_name'), table_name='misconceptions')
    op.drop_table('misconceptions')
    
    op.drop_index(op.f('ix_concepts_category'), table_name='concepts')
    op.drop_index(op.f('ix_concepts_name'), table_name='concepts')
    op.drop_table('concepts')
