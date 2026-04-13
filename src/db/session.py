from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import text
from fastapi import Request
from src.db.base import AsyncSessionLocal


async def get_db(request: Request) -> AsyncSession:
    """Dependency to get database session with tenant context."""
    # Extract tenant_id from request headers, default to "public"
    tenant_id = request.headers.get("X-Tenant-ID", "public")
    
    async with AsyncSessionLocal() as session:
        async with session.begin():
            # Set the tenant context in the PostgreSQL session
            # Using set_config with 'true' means it's transaction-local
            await session.execute(
                text("SELECT set_config('app.current_tenant', :tenant, true)"),
                {"tenant": tenant_id}
            )
            try:
                yield session
            finally:
                pass  # Transaction auto-commits when context exits
