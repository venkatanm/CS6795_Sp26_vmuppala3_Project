"""add_math_rw_theta

Revision ID: h3i4j5k6l7m8
Revises: g2h3i4j5k6l7
Create Date: 2026-03-27 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = 'h3i4j5k6l7m8'
down_revision: Union[str, None] = 'g2h3i4j5k6l7'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('sessions', sa.Column('math_theta', sa.Float(), nullable=True))
    op.add_column('sessions', sa.Column('rw_theta', sa.Float(), nullable=True))


def downgrade() -> None:
    op.drop_column('sessions', 'rw_theta')
    op.drop_column('sessions', 'math_theta')
