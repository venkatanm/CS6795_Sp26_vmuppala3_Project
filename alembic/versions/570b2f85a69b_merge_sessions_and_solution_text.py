"""merge_sessions_and_solution_text

Revision ID: 570b2f85a69b
Revises: 38fdba4f7e57, b1c2d3e4f5a6
Create Date: 2026-01-27 15:18:32.771454

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '570b2f85a69b'
down_revision: Union[str, None] = ('38fdba4f7e57', 'b1c2d3e4f5a6')
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
