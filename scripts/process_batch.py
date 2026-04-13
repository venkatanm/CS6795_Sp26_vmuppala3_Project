#!/usr/bin/env python3
"""
Script to submit batch jobs to Gemini batch API.

This script:
1. Selects the appropriate JSONL file (test or full)
2. Uploads the file to Gemini
3. Submits a batch job
4. Saves the batch ID for tracking

Usage:
    # Submit test batch
    python scripts/process_batch.py --test
    
    # Submit full production batch
    python scripts/process_batch.py
"""

import os
import sys
from pathlib import Path
from typing import Optional

# Add project root to path
project_root = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(project_root))

from src.core.config import settings


def main(test_mode: bool = False, chunk_index: Optional[int] = None):
    """
    Main function to submit batch job.
    
    Args:
        test_mode: If True, use test file. If False, use full production file.
        chunk_index: If specified, process only this chunk number (1-indexed). If None, process all chunks.
    """
    print("=" * 80)
    print("Gemini Batch Job Submission")
    print("=" * 80)
    
    # Select file pattern and display name
    if test_mode:
        input_file_pattern = "batch_jobs/input_test.jsonl"
        display_name_pattern = "sat_test_run"
        print("[MODE] Test mode")
        files_to_process = [input_file_pattern] if os.path.exists(input_file_pattern) else []
    else:
        input_file_pattern = "batch_jobs/input_full_{:04d}.jsonl"
        display_name_pattern = "sat_production_run_{:04d}"
        print("[MODE] Production mode")
        
        # Find all chunk files
        batch_jobs_dir = Path("batch_jobs")
        if chunk_index is not None:
            # Process specific chunk
            input_file = input_file_pattern.format(chunk_index)
            if os.path.exists(input_file):
                files_to_process = [(input_file, chunk_index)]
            else:
                print(f"[ERROR] Chunk file not found: {input_file}")
                sys.exit(1)
        else:
            # Process all chunks
            files_to_process = []
            chunk_num = 1
            while True:
                chunk_file = input_file_pattern.format(chunk_num)
                if os.path.exists(chunk_file):
                    files_to_process.append((chunk_file, chunk_num))
                    chunk_num += 1
                else:
                    break
            
            if not files_to_process:
                print(f"[ERROR] No chunk files found matching pattern: {input_file_pattern}")
                print("[INFO] Run 'python scripts/prepare_batch.py' first to generate the batch files")
                sys.exit(1)
    
    print(f"[INFO] Found {len(files_to_process)} file(s) to process")
    
    # Check Gemini API key
    if not settings.GEMINI_API_KEY:
        print("[ERROR] GEMINI_API_KEY not configured in settings")
        sys.exit(1)
    
    # Initialize Gemini client
    try:
        import google.genai as genai  # type: ignore
        client = genai.Client(api_key=settings.GEMINI_API_KEY)
        print("[OK] Initialized Gemini client")
    except ImportError:
        print("[ERROR] google.genai not available. Install with: pip install google-genai")
        sys.exit(1)
    except Exception as e:
        print(f"[ERROR] Failed to initialize Gemini client: {e}")
        sys.exit(1)
    
    # Process each file
    batch_ids = []
    
    for file_info in files_to_process:
        if isinstance(file_info, tuple):
            input_file, chunk_num = file_info
            display_name = display_name_pattern.format(chunk_num) if not test_mode else display_name_pattern
        else:
            input_file = file_info
            chunk_num = None
            display_name = display_name_pattern
        
        try:
            # Check file size
            file_size = os.path.getsize(input_file)
            print(f"\n[FILE] Processing: {input_file}")
            print(f"  File size: {file_size / 1024:.2f} KB")
            if chunk_num:
                print(f"  Chunk: {chunk_num}")
            
            # Upload file
            print(f"  [UPLOADING] Uploading {input_file}...")
            uploaded_file = client.files.upload(
                file=input_file,
                config={'mime_type': 'application/json'}
            )
            print(f"  [OK] File uploaded successfully")
            print(f"    File name: {uploaded_file.name}")
            print(f"    File URI: {uploaded_file.uri}")
            
            # Submit batch job
            print(f"  [SUBMITTING] Creating batch job...")
            print(f"    Display name: {display_name}")
            print(f"    Model: gemini-2.5-flash")
            
            batch = client.batches.create(
                src=uploaded_file.name,
                model='gemini-2.5-flash',
                config={'display_name': display_name}
            )
            
            print(f"  [OK] Batch job submitted successfully")
            print(f"    Batch name: {batch.name}")
            print(f"    Batch state: {batch.state}")
            
            batch_ids.append((chunk_num, batch.name, display_name))
            
        except Exception as e:
            print(f"  [ERROR] Failed to submit batch job for {input_file}: {e}")
            import traceback
            traceback.print_exc()
            continue
    
    # Save batch IDs to file
    if batch_ids:
        batch_id_file = "batch_jobs/current_batch_ids.txt"
        os.makedirs("batch_jobs", exist_ok=True)
        
        with open(batch_id_file, 'w', encoding='utf-8') as f:
            for chunk_num, batch_name, display_name in batch_ids:
                if chunk_num:
                    f.write(f"{chunk_num}:{batch_name}:{display_name}\n")
                else:
                    f.write(f"{batch_name}:{display_name}\n")
        
        print(f"\n[SAVED] Batch IDs saved to {batch_id_file}")
        print(f"  Total batches submitted: {len(batch_ids)}")
        for chunk_num, batch_name, display_name in batch_ids:
            if chunk_num:
                print(f"    Chunk {chunk_num}: {batch_name}")
            else:
                print(f"    {batch_name}")
        
        print("\n" + "=" * 80)
        print("All jobs submitted! IDs saved. Check back in 30 mins.")
        print("=" * 80)
        print(f"\nTo check status, use:")
        print(f"  python scripts/check_and_ingest.py")
        print(f"  (or check the batch IDs in Google Cloud Console)")
    else:
        print("\n[ERROR] No batch jobs were successfully submitted")
        sys.exit(1)


if __name__ == "__main__":
    import argparse
    
    parser = argparse.ArgumentParser(
        description="Submit batch jobs to Gemini batch API",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  # Submit test batch
  python scripts/process_batch.py --test
  
  # Submit full production batch
  python scripts/process_batch.py
        """
    )
    
    parser.add_argument(
        '--test',
        action='store_true',
        help='Submit test batch (uses batch_jobs/input_test.jsonl)'
    )
    
    parser.add_argument(
        '--chunk',
        type=int,
        metavar='N',
        help='Process only chunk number N (1-indexed). If not specified, process all chunks.'
    )
    
    args = parser.parse_args()
    
    main(test_mode=args.test, chunk_index=args.chunk)
