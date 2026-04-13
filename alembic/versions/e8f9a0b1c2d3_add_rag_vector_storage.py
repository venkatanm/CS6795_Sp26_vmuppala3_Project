"""add_rag_vector_storage

Revision ID: e8f9a0b1c2d3
Revises: da02530b4c28
Create Date: 2026-01-27 15:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = 'e8f9a0b1c2d3'
down_revision: Union[str, None] = 'da02530b4c28'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Check if tables already exist (database may have been created manually)
    from sqlalchemy import inspect
    conn = op.get_bind()
    inspector = inspect(conn)
    existing_tables = inspector.get_table_names()
    
    # Enable pgvector extension
    op.execute("CREATE EXTENSION IF NOT EXISTS vector")
    
    # Create curriculum_chunks table for RAG vector storage
    # Note: We'll create the embedding column as a regular column first, then alter it
    if 'curriculum_chunks' not in existing_tables:
        op.create_table('curriculum_chunks',
        sa.Column('id', postgresql.UUID(as_uuid=True), server_default=sa.text('gen_random_uuid()'), nullable=False),
        sa.Column('content', sa.Text(), nullable=False),
        sa.Column('concept_id', postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column('concept_name', sa.String(), nullable=True),
        sa.Column('difficulty', sa.String(), nullable=True),
        sa.Column('source', sa.String(), nullable=True),
        sa.Column('chunk_index', sa.Integer(), nullable=True),
        sa.Column('metadata', postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.ForeignKeyConstraint(['concept_id'], ['concepts.id'], ondelete='SET NULL'),
        sa.PrimaryKeyConstraint('id')
        )
        
        # Add embedding column as vector type (1536 dimensions for OpenAI text-embedding-3-small)
        # Check if column already exists
        existing_columns = [col['name'] for col in inspector.get_columns('curriculum_chunks')]
        if 'embedding' not in existing_columns:
            op.execute("""
                ALTER TABLE curriculum_chunks 
                ADD COLUMN embedding vector(1536)
            """)
        
        # Create indexes
        op.create_index(op.f('ix_curriculum_chunks_concept_id'), 'curriculum_chunks', ['concept_id'], unique=False)
        op.create_index(op.f('ix_curriculum_chunks_concept_name'), 'curriculum_chunks', ['concept_name'], unique=False)
        op.create_index(op.f('ix_curriculum_chunks_difficulty'), 'curriculum_chunks', ['difficulty'], unique=False)
        
        # Create HNSW index for vector similarity search (optional but recommended for performance)
        op.execute("""
            CREATE INDEX IF NOT EXISTS curriculum_chunks_embedding_idx 
            ON curriculum_chunks 
            USING hnsw (embedding vector_cosine_ops)
        """)
    else:
        # Table exists, just ensure extension, embedding column, and indexes are there
        existing_columns = [col['name'] for col in inspector.get_columns('curriculum_chunks')]
        if 'embedding' not in existing_columns:
            op.execute("""
                ALTER TABLE curriculum_chunks 
                ADD COLUMN embedding vector(1536)
            """)
        op.execute("""
            CREATE INDEX IF NOT EXISTS curriculum_chunks_embedding_idx 
            ON curriculum_chunks 
            USING hnsw (embedding vector_cosine_ops)
        """)


def downgrade() -> None:
    # Drop indexes
    op.execute("DROP INDEX IF EXISTS curriculum_chunks_embedding_idx")
    op.drop_index(op.f('ix_curriculum_chunks_difficulty'), table_name='curriculum_chunks')
    op.drop_index(op.f('ix_curriculum_chunks_concept_name'), table_name='curriculum_chunks')
    op.drop_index(op.f('ix_curriculum_chunks_concept_id'), table_name='curriculum_chunks')
    
    # Drop table
    op.drop_table('curriculum_chunks')
    
    # Note: We don't drop the vector extension as it might be used elsewhere
