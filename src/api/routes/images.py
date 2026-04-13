"""
Image serving routes for question images.
"""
from pathlib import Path
from fastapi import APIRouter, HTTPException, status
from fastapi.responses import FileResponse
import os

router = APIRouter()

# Path to extracted_images directory (relative to project root)
# Images are stored in frontend/public/extracted_images
IMAGES_DIR = Path("frontend/public/extracted_images")


@router.get("/images/{image_name:path}")
async def get_image(image_name: str):
    """
    Serve images from the extracted_images directory.
    
    Args:
        image_name: Name of the image file (e.g., "12bd5b75_1.png")
        
    Returns:
        Image file response
    """
    # Security: Prevent directory traversal
    if ".." in image_name or "/" in image_name or "\\" in image_name:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid image name"
        )
    
    image_path = IMAGES_DIR / image_name
    
    if not image_path.exists():
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Image {image_name} not found"
        )
    
    # Verify it's actually in the images directory (security check)
    try:
        image_path.resolve().relative_to(IMAGES_DIR.resolve())
    except ValueError:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid image path"
        )
    
    return FileResponse(
        image_path,
        media_type="image/png",
        headers={
            "Cache-Control": "public, max-age=31536000"  # Cache for 1 year
        }
    )
