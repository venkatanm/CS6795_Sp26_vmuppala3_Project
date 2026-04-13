"""add_student_profiles

Revision ID: f3a4b5c6d7e8
Revises: e8f9a0b1c2d3
Create Date: 2026-01-27 16:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = 'f3a4b5c6d7e8'
down_revision: Union[str, None] = 'e8f9a0b1c2d3'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Check if tables already exist (database may have been created manually)
    from sqlalchemy import inspect
    conn = op.get_bind()
    inspector = inspect(conn)
    existing_tables = inspector.get_table_names()
    
    # Create student_profiles table
    if 'student_profiles' not in existing_tables:
        op.create_table('student_profiles',
        sa.Column('id', postgresql.UUID(as_uuid=True), server_default=sa.text('gen_random_uuid()'), nullable=False),
        sa.Column('user_id', sa.String(), nullable=False),
        sa.Column('tenant_id', sa.String(), nullable=False),
        sa.Column('concept_mastery', postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column('unlocked_concepts', postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column('locked_concepts', postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column('review_queue', postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column('next_session_focus', sa.String(), nullable=True),
        sa.Column('total_sessions', sa.Integer(), nullable=False, server_default=sa.text('0')),
        sa.Column('last_session_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.PrimaryKeyConstraint('id')
        )
        op.create_index(op.f('ix_student_profiles_user_id'), 'student_profiles', ['user_id'], unique=True)
        op.create_index(op.f('ix_student_profiles_tenant_id'), 'student_profiles', ['tenant_id'], unique=False)

    # Create concept_mastery table (normalized approach)
    if 'concept_mastery' not in existing_tables:
        op.create_table('concept_mastery',
        sa.Column('id', postgresql.UUID(as_uuid=True), server_default=sa.text('gen_random_uuid()'), nullable=False),
        sa.Column('user_id', sa.String(), nullable=False),
        sa.Column('concept_id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('mastery_level', sa.Float(), nullable=False, server_default=sa.text('0.0')),
        sa.Column('status', sa.String(), nullable=False, server_default=sa.text("'locked'")),
        sa.Column('times_practiced', sa.Integer(), nullable=False, server_default=sa.text('0')),
        sa.Column('times_correct', sa.Integer(), nullable=False, server_default=sa.text('0')),
        sa.Column('last_practiced_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('next_review_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.ForeignKeyConstraint(['concept_id'], ['concepts.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id')
        )
        op.create_index(op.f('ix_concept_mastery_user_id'), 'concept_mastery', ['user_id'], unique=False)
        op.create_index(op.f('ix_concept_mastery_concept_id'), 'concept_mastery', ['concept_id'], unique=False)
        op.create_index('ix_concept_mastery_user_concept', 'concept_mastery', ['user_id', 'concept_id'], unique=True)


def downgrade() -> None:
    op.drop_index('ix_concept_mastery_user_concept', table_name='concept_mastery')
    op.drop_index(op.f('ix_concept_mastery_concept_id'), table_name='concept_mastery')
    op.drop_index(op.f('ix_concept_mastery_user_id'), table_name='concept_mastery')
    op.drop_table('concept_mastery')
    
    op.drop_index(op.f('ix_student_profiles_tenant_id'), table_name='student_profiles')
    op.drop_index(op.f('ix_student_profiles_user_id'), table_name='student_profiles')
    op.drop_table('student_profiles')
