"""Update items table for question ingestion

Revision ID: f1a2b3c4d5e6
Revises: afe30ea3fd53
Create Date: 2026-01-27 12:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = 'f1a2b3c4d5e6'
down_revision: Union[str, None] = 'a1b2c3d4e5f6'  # Point to current head
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Change correct_answer from Float to String to support A/B/C/D format
    # Step 1: Convert column type to text first (using postgresql_using)
    op.alter_column('items', 'correct_answer',
                    existing_type=sa.Float(),
                    type_=sa.String(),
                    nullable=False,
                    postgresql_using='correct_answer::text')
    
    # Step 2: Now update text values to convert 0/1/2/3 to A/B/C/D
    op.execute("""
        UPDATE items 
        SET correct_answer = CASE 
            WHEN correct_answer = '0' THEN 'A'
            WHEN correct_answer = '1' THEN 'B'
            WHEN correct_answer = '2' THEN 'C'
            WHEN correct_answer = '3' THEN 'D'
            ELSE correct_answer
        END
        WHERE correct_answer IN ('0', '1', '2', '3')
    """)
    
    # Ensure question_text can handle longer HTML content
    op.alter_column('items', 'question_text',
                    existing_type=sa.String(),
                    type_=sa.Text(),
                    existing_nullable=False)
    
    # Ensure solution_text can handle longer HTML content
    op.alter_column('items', 'solution_text',
                    existing_type=sa.String(),
                    type_=sa.Text(),
                    existing_nullable=True)


def downgrade() -> None:
    # Revert question_text and solution_text back to String
    op.alter_column('items', 'solution_text',
                    existing_type=sa.Text(),
                    type_=sa.String(),
                    existing_nullable=True)
    
    op.alter_column('items', 'question_text',
                    existing_type=sa.Text(),
                    type_=sa.String(),
                    existing_nullable=False)
    
    # Revert correct_answer back to Float
    # Step 1: Convert A/B/C/D back to 0/1/2/3
    op.execute("""
        UPDATE items 
        SET correct_answer = CASE 
            WHEN correct_answer = 'A' THEN '0'
            WHEN correct_answer = 'B' THEN '1'
            WHEN correct_answer = 'C' THEN '2'
            WHEN correct_answer = 'D' THEN '3'
            ELSE '0'
        END
        WHERE correct_answer IS NOT NULL
    """)
    
    # Step 2: Convert column type from String to Float
    op.alter_column('items', 'correct_answer',
                    existing_type=sa.String(),
                    type_=sa.Float(),
                    nullable=False,
                    postgresql_using='correct_answer::float')
