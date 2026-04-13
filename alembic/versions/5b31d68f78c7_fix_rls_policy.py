"""fix_rls_policy

Revision ID: 5b31d68f78c7
Revises: f1664ab6724b
Create Date: 2026-01-27 06:39:07.076638

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '5b31d68f78c7'
down_revision: Union[str, None] = 'f1664ab6724b'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("ALTER TABLE exam_definitions ENABLE ROW LEVEL SECURITY")
    op.execute("DROP POLICY IF EXISTS tenant_isolation_policy ON exam_definitions")
    op.execute("CREATE POLICY tenant_isolation_policy ON exam_definitions USING (tenant_id = current_setting('app.current_tenant', true))")
    op.execute("ALTER TABLE exam_definitions FORCE ROW LEVEL SECURITY")


def downgrade() -> None:
    pass
