"""
RAG Ingestion Pipeline

This script ingests curriculum text into a vector database for RAG retrieval.
It chunks text by concept, generates embeddings using OpenAI, and stores them in PostgreSQL with pgvector.

Usage:
    python -m src.ai.rag_pipeline --input curriculum.txt --concept "Linear Equations" --difficulty "medium"
    python -m src.ai.rag_pipeline --input-dir ./curriculum --batch-size 100
"""
import asyncio
import os
import sys
import argparse
from pathlib import Path
from typing import List, Dict, Any, Optional
import tiktoken

# Add project root to path
project_root = Path(__file__).parent.parent.parent
sys.path.insert(0, str(project_root))

from openai import OpenAI
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from src.db.base import AsyncSessionLocal
from src.db.models import CurriculumChunk, Concept
from src.core.config import settings


# Initialize OpenAI client
openai_client: Optional[OpenAI] = None
if settings.OPENAI_API_KEY:
    openai_client = OpenAI(api_key=settings.OPENAI_API_KEY)
else:
    print("Warning: OPENAI_API_KEY not set. Embedding generation will fail.")


# Tokenizer for chunking
encoding = tiktoken.get_encoding("cl100k_base")  # Used by text-embedding-3-small


def chunk_text_by_concept(
    text: str,
    concept_name: Optional[str] = None,
    chunk_size: int = 500,
    chunk_overlap: int = 50
) -> List[Dict[str, Any]]:
    """
    Chunk text into smaller pieces, optionally by concept.
    
    Args:
        text: The text to chunk
        concept_name: Optional concept name to associate with chunks
        chunk_size: Target chunk size in tokens
        chunk_overlap: Number of tokens to overlap between chunks
        
    Returns:
        List of chunk dictionaries with 'text', 'concept_name', and 'index'
    """
    # Tokenize the text
    tokens = encoding.encode(text)
    
    chunks = []
    start_idx = 0
    
    while start_idx < len(tokens):
        # Get chunk tokens
        end_idx = min(start_idx + chunk_size, len(tokens))
        chunk_tokens = tokens[start_idx:end_idx]
        
        # Decode back to text
        chunk_text = encoding.decode(chunk_tokens)
        
        chunks.append({
            'text': chunk_text.strip(),
            'concept_name': concept_name,
            'index': len(chunks)
        })
        
        # Move start index forward (with overlap)
        start_idx = end_idx - chunk_overlap
        
        # If we're at the end, break
        if end_idx >= len(tokens):
            break
    
    return chunks


def chunk_text_by_sections(text: str, concept_name: Optional[str] = None) -> List[Dict[str, Any]]:
    """
    Chunk text by natural sections (paragraphs, headings, etc.).
    This is a simpler approach that preserves semantic boundaries.
    
    Args:
        text: The text to chunk
        concept_name: Optional concept name to associate with chunks
        
    Returns:
        List of chunk dictionaries
    """
    # Split by double newlines (paragraphs) or single newline followed by heading-like text
    sections = []
    
    # Try to split by paragraphs first
    paragraphs = text.split('\n\n')
    
    for idx, para in enumerate(paragraphs):
        para = para.strip()
        if para:
            # If paragraph is too long, split it further
            if len(encoding.encode(para)) > 1000:
                # Split by sentences
                sentences = para.split('. ')
                current_chunk = ""
                chunk_idx = 0
                
                for sentence in sentences:
                    if len(encoding.encode(current_chunk + sentence)) < 800:
                        current_chunk += sentence + ". "
                    else:
                        if current_chunk:
                            sections.append({
                                'text': current_chunk.strip(),
                                'concept_name': concept_name,
                                'index': len(sections)
                            })
                        current_chunk = sentence + ". "
                        chunk_idx += 1
                
                if current_chunk:
                    sections.append({
                        'text': current_chunk.strip(),
                        'concept_name': concept_name,
                        'index': len(sections)
                    })
            else:
                sections.append({
                    'text': para,
                    'concept_name': concept_name,
                    'index': len(sections)
                })
    
    return sections if sections else [{'text': text, 'concept_name': concept_name, 'index': 0}]


async def generate_embedding(text: str) -> Optional[List[float]]:
    """
    Generate embedding for text using OpenAI's text-embedding-3-small.
    
    Args:
        text: Text to embed
        
    Returns:
        Embedding vector (1536 dimensions) or None if API call fails
    """
    if not openai_client:
        print("Error: OpenAI client not initialized. Set OPENAI_API_KEY environment variable.")
        return None
    
    try:
        response = openai_client.embeddings.create(
            model="text-embedding-3-small",
            input=text
        )
        return response.data[0].embedding
    except Exception as e:
        print(f"Error generating embedding: {e}")
        return None


async def store_chunks(
    chunks: List[Dict[str, Any]],
    concept_id: Optional[str] = None,
    difficulty: Optional[str] = None,
    source: Optional[str] = None,
    metadata: Optional[Dict[str, Any]] = None
) -> int:
    """
    Store chunks in the database with embeddings.
    
    Args:
        chunks: List of chunk dictionaries
        concept_id: Optional UUID of the concept
        difficulty: Optional difficulty level
        source: Optional source document name
        metadata: Optional additional metadata
        
    Returns:
        Number of chunks successfully stored
    """
    async with AsyncSessionLocal() as db:
        stored_count = 0
        
        for chunk in chunks:
            # Generate embedding
            embedding = await generate_embedding(chunk['text'])
            if not embedding:
                print(f"Warning: Failed to generate embedding for chunk {chunk['index']}, skipping...")
                continue
            
            # Look up concept_id if concept_name is provided
            concept_uuid = concept_id
            if chunk.get('concept_name') and not concept_uuid:
                result = await db.execute(
                    select(Concept).where(Concept.name == chunk['concept_name'])
                )
                concept = result.scalar_one_or_none()
                if concept:
                    concept_uuid = str(concept.id)
            
            # Create chunk record
            chunk_record = CurriculumChunk(
                content=chunk['text'],
                embedding=embedding,  # pgvector will handle the conversion
                concept_id=concept_uuid,
                concept_name=chunk.get('concept_name'),
                difficulty=difficulty,
                source=source,
                chunk_index=chunk.get('index'),
                metadata=metadata
            )
            
            db.add(chunk_record)
            stored_count += 1
        
        await db.commit()
        return stored_count


async def ingest_file(
    file_path: Path,
    concept_name: Optional[str] = None,
    difficulty: Optional[str] = None,
    source: Optional[str] = None,
    chunk_method: str = "sections"
) -> int:
    """
    Ingest a single file into the vector database.
    
    Args:
        file_path: Path to the text file
        concept_name: Optional concept name
        difficulty: Optional difficulty level
        source: Optional source name (defaults to filename)
        chunk_method: "sections" or "tokens"
        
    Returns:
        Number of chunks stored
    """
    if not file_path.exists():
        print(f"Error: File not found: {file_path}")
        return 0
    
    print(f"Reading file: {file_path}")
    with open(file_path, 'r', encoding='utf-8') as f:
        text = f.read()
    
    if not text.strip():
        print(f"Warning: File {file_path} is empty")
        return 0
    
    # Chunk the text
    if chunk_method == "sections":
        chunks = chunk_text_by_sections(text, concept_name)
    else:
        chunks = chunk_text_by_concept(text, concept_name)
    
    print(f"Created {len(chunks)} chunks from {file_path}")
    
    # Store chunks
    source_name = source or file_path.name
    stored = await store_chunks(chunks, difficulty=difficulty, source=source_name)
    
    print(f"Stored {stored} chunks from {file_path}")
    return stored


async def ingest_directory(
    dir_path: Path,
    difficulty: Optional[str] = None,
    batch_size: int = 100
) -> int:
    """
    Ingest all text files in a directory.
    
    Args:
        dir_path: Directory containing text files
        difficulty: Optional difficulty level for all files
        batch_size: Process files in batches
        
    Returns:
        Total number of chunks stored
    """
    if not dir_path.exists() or not dir_path.is_dir():
        print(f"Error: Directory not found: {dir_path}")
        return 0
    
    text_files = list(dir_path.glob("*.txt")) + list(dir_path.glob("*.md"))
    
    if not text_files:
        print(f"Warning: No text files found in {dir_path}")
        return 0
    
    print(f"Found {len(text_files)} text files")
    
    total_stored = 0
    for i, file_path in enumerate(text_files, 1):
        print(f"\n[{i}/{len(text_files)}] Processing {file_path.name}...")
        stored = await ingest_file(file_path, difficulty=difficulty)
        total_stored += stored
        
        # Small delay to avoid rate limiting
        if i % batch_size == 0:
            print("Batch complete, pausing...")
            await asyncio.sleep(1)
    
    return total_stored


async def main():
    """Main entry point for the RAG pipeline."""
    parser = argparse.ArgumentParser(description="RAG Ingestion Pipeline")
    parser.add_argument("--input", type=str, help="Input text file path")
    parser.add_argument("--input-dir", type=str, help="Input directory containing text files")
    parser.add_argument("--concept", type=str, help="Concept name to associate with chunks")
    parser.add_argument("--concept-id", type=str, help="Concept UUID to associate with chunks")
    parser.add_argument("--difficulty", type=str, choices=["easy", "medium", "hard"], help="Difficulty level")
    parser.add_argument("--source", type=str, help="Source document name (e.g., 'Official SAT Study Guide')")
    parser.add_argument("--chunk-method", type=str, choices=["sections", "tokens"], default="sections",
                       help="Chunking method: 'sections' (by paragraphs) or 'tokens' (by token count)")
    parser.add_argument("--batch-size", type=int, default=100, help="Batch size for directory processing")
    
    args = parser.parse_args()
    
    if not args.input and not args.input_dir:
        parser.error("Either --input or --input-dir must be provided")
    
    if not settings.OPENAI_API_KEY:
        print("Error: OPENAI_API_KEY not set in environment variables")
        print("Please set it in your .env file or environment")
        return
    
    print("=" * 60)
    print("RAG Ingestion Pipeline")
    print("=" * 60)
    print()
    
    total_stored = 0
    
    if args.input:
        # Ingest single file
        file_path = Path(args.input)
        total_stored = await ingest_file(
            file_path,
            concept_name=args.concept,
            difficulty=args.difficulty,
            source=args.source,
            chunk_method=args.chunk_method
        )
    elif args.input_dir:
        # Ingest directory
        dir_path = Path(args.input_dir)
        total_stored = await ingest_directory(
            dir_path,
            difficulty=args.difficulty,
            batch_size=args.batch_size
        )
    
    print()
    print("=" * 60)
    print(f" Ingestion complete! Stored {total_stored} chunks.")
    print("=" * 60)


if __name__ == "__main__":
    asyncio.run(main())
