from fastapi import APIRouter, Depends, Response, status
from sqlalchemy.ext.asyncio import AsyncSession
from redis.asyncio import Redis
from src.db.session import get_db
from src.core.redis import get_redis
from src.services.health_service import check_database_health, check_redis_health

router = APIRouter(prefix="/health", tags=["health"])


@router.get("")
async def health_check(
    response: Response,
    db: AsyncSession = Depends(get_db),
    redis: Redis = Depends(get_redis)
):
    """
    Health check endpoint that verifies database and Redis connectivity.
    """
    db_health = await check_database_health(db)
    redis_health = await check_redis_health(redis)
    
    overall_status = "healthy" if (
        db_health["status"] == "healthy" and redis_health["status"] == "healthy"
    ) else "unhealthy"
    
    if overall_status == "unhealthy":
        response.status_code = status.HTTP_503_SERVICE_UNAVAILABLE
    else:
        response.status_code = status.HTTP_200_OK
    
    return {
        "status": overall_status,
        "database": db_health,
        "redis": redis_health
    }
