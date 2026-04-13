"""add_offline_rag_columns

Revision ID: g2h3i4j5k6l7
Revises: f1a2b3c4d5e6
Create Date: 2026-01-27 16:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = 'g2h3i4j5k6l7'
down_revision: Union[str, None] = 'f1a2b3c4d5e6'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Add AI explanation columns for Offline RAG
    op.add_column('items', sa.Column('ai_explanation', sa.Text(), nullable=True))
    op.add_column('items', sa.Column('distractor_analysis', postgresql.JSONB(astext_type=sa.Text()), nullable=True))
    op.add_column('items', sa.Column('hint_sequence', postgresql.JSONB(astext_type=sa.Text()), nullable=True))


def downgrade() -> None:
    # Remove AI explanation columns
    op.drop_column('items', 'hint_sequence')
    op.drop_column('items', 'distractor_analysis')
    op.drop_column('items', 'ai_explanation')
