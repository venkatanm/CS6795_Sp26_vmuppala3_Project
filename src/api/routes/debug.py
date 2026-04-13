from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import text
from src.db.session import get_db

router = APIRouter()


@router.get("/debug/whoami")
async def whoami(db: AsyncSession = Depends(get_db)):
    """
    Debug endpoint to check which tenant ID is currently set in the database session.
    """
    result = await db.execute(text("SELECT current_setting('app.current_tenant', true)"))
    tenant_value = result.scalar()
    
    return {"tenant_seen_by_db": tenant_value}
