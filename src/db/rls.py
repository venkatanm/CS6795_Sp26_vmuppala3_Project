"""
Row Level Security (RLS) utilities for tenant isolation.

This module provides utilities to set the tenant context in database sessions
so that RLS policies can filter rows based on the current tenant.
"""
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import text


async def set_tenant_context(session: AsyncSession, tenant_id: str) -> None:
    """
    Set the tenant context for the current database session.
    
    This sets the PostgreSQL session variable 'app.current_tenant' which is used
    by the RLS policy to filter rows by tenant_id.
    
    Args:
        session: The async database session
        tenant_id: The tenant ID to set as the current tenant context
        
    Example:
        ```python
        async with AsyncSessionLocal() as session:
            await set_tenant_context(session, "tenant_123")
            # Now all queries will only return rows where tenant_id = "tenant_123"
            result = await session.execute(select(ExamDefinition))
        ```
    """
    await session.execute(
        text("SET app.current_tenant = :tenant_id"),
        {"tenant_id": tenant_id}
    )


async def clear_tenant_context(session: AsyncSession) -> None:
    """
    Clear the tenant context from the current database session.
    
    This resets the PostgreSQL session variable 'app.current_tenant'.
    After clearing, RLS policies will not match any rows (since tenant_id won't match).
    
    Args:
        session: The async database session
    """
    await session.execute(text("RESET app.current_tenant"))
