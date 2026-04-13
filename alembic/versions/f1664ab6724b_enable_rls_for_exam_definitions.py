"""enable_rls_for_exam_definitions

Revision ID: f1664ab6724b
Revises: 4e5df7a55708
Create Date: 2026-01-27 06:37:38.632108

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'f1664ab6724b'
down_revision: Union[str, None] = '4e5df7a55708'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Enable Row Level Security on the table
    op.execute("ALTER TABLE exam_definitions ENABLE ROW LEVEL SECURITY")
    
    # Drop policy if it exists (for idempotency)
    op.execute("DROP POLICY IF EXISTS tenant_isolation_policy ON exam_definitions")
    
    # Create the tenant isolation policy
    # The "true" in current_setting means "return NULL if variable is missing, don't crash"
    op.execute("""
        CREATE POLICY tenant_isolation_policy ON exam_definitions
            USING (tenant_id = current_setting('app.current_tenant', true))
    """)
    
    # Force RLS even for the table owner (CRITICAL for security)
    op.execute("ALTER TABLE exam_definitions FORCE ROW LEVEL SECURITY")


def downgrade() -> None:
    # Drop the policy
    op.execute("DROP POLICY IF EXISTS tenant_isolation_policy ON exam_definitions")
    
    # Disable RLS
    op.execute("ALTER TABLE exam_definitions DISABLE ROW LEVEL SECURITY")
    
    # Remove FORCE RLS (this is implicit when RLS is disabled, but explicit for clarity)
    op.execute("ALTER TABLE exam_definitions NO FORCE ROW LEVEL SECURITY")
