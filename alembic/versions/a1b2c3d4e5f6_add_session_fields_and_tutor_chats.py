"""add_session_fields_and_tutor_chats

Revision ID: a1b2c3d4e5f6
Revises: 570b2f85a69b, f3a4b5c6d7e8
Create Date: 2026-01-27 17:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = 'a1b2c3d4e5f6'
down_revision: Union[str, None] = ('570b2f85a69b', 'f3a4b5c6d7e8')  # Merge both heads
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Add new columns to sessions table
    op.add_column('sessions', sa.Column('performance_profile', postgresql.JSONB(astext_type=sa.Text()), nullable=True))
    op.add_column('sessions', sa.Column('current_module_id', sa.String(), nullable=True))
    op.add_column('sessions', sa.Column('current_question_index', sa.Integer(), nullable=True))
    
    # Create indexes for the new columns
    op.create_index(op.f('ix_sessions_current_module_id'), 'sessions', ['current_module_id'], unique=False)
    
    # Create tutor_chats table for storing Socratic responses
    op.create_table('tutor_chats',
        sa.Column('id', postgresql.UUID(as_uuid=True), server_default=sa.text('gen_random_uuid()'), nullable=False),
        sa.Column('session_id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('question_id', sa.String(), nullable=False),
        sa.Column('tenant_id', sa.String(), nullable=False),
        sa.Column('messages', postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column('student_answer', sa.String(), nullable=True),
        sa.Column('correct_answer', sa.String(), nullable=True),
        sa.Column('question_stem', sa.Text(), nullable=True),
        sa.Column('passage_text', sa.Text(), nullable=True),
        sa.Column('category', sa.String(), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.ForeignKeyConstraint(['session_id'], ['sessions.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id')
    )
    
    # Create indexes for tutor_chats
    op.create_index(op.f('ix_tutor_chats_session_id'), 'tutor_chats', ['session_id'], unique=False)
    op.create_index(op.f('ix_tutor_chats_question_id'), 'tutor_chats', ['question_id'], unique=False)
    op.create_index(op.f('ix_tutor_chats_tenant_id'), 'tutor_chats', ['tenant_id'], unique=False)
    # Composite unique index to prevent duplicate chats for same question+session
    op.create_index('ix_tutor_chats_session_question', 'tutor_chats', ['session_id', 'question_id'], unique=True)


def downgrade() -> None:
    # Drop tutor_chats table and indexes
    op.drop_index('ix_tutor_chats_session_question', table_name='tutor_chats')
    op.drop_index(op.f('ix_tutor_chats_tenant_id'), table_name='tutor_chats')
    op.drop_index(op.f('ix_tutor_chats_question_id'), table_name='tutor_chats')
    op.drop_index(op.f('ix_tutor_chats_session_id'), table_name='tutor_chats')
    op.drop_table('tutor_chats')
    
    # Drop indexes and columns from sessions
    op.drop_index(op.f('ix_sessions_current_module_id'), table_name='sessions')
    op.drop_column('sessions', 'current_question_index')
    op.drop_column('sessions', 'current_module_id')
    op.drop_column('sessions', 'performance_profile')
