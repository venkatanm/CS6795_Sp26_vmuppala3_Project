"""
Generic Cache Service for Redis-based caching.

Provides a simple interface for caching JSON-serializable data with TTL support.
"""
import json
import hashlib
import logging
from typing import Any, Optional

from src.core.redis import get_redis

logger = logging.getLogger(__name__)


class CacheService:
    """Generic cache service for storing and retrieving JSON data in Redis."""
    
    @staticmethod
    async def get(key: str) -> Optional[Any]:
        """
        Retrieve a value from cache by key.
        
        Args:
            key: Cache key
            
        Returns:
            Deserialized value if found, None otherwise (fail-safe)
        """
        try:
            redis = await get_redis()
            cached_value = await redis.get(key)
            
            if cached_value is None:
                return None
            
            # Deserialize JSON string
            return json.loads(cached_value)
        except json.JSONDecodeError as e:
            logger.warning(f"[CacheService] Failed to deserialize cache value for key '{key}': {e}")
            return None
        except Exception as e:
            logger.error(f"[CacheService] Error retrieving cache key '{key}': {e}")
            return None
    
    @staticmethod
    async def set(key: str, value: Any, ttl: int = 3600) -> bool:
        """
        Store a value in cache with TTL.
        
        Args:
            key: Cache key
            value: Value to cache (must be JSON-serializable)
            ttl: Time to live in seconds (default: 3600 = 1 hour)
            
        Returns:
            True on success, False on error (fail-safe)
        """
        try:
            redis = await get_redis()
            serialized_value = json.dumps(value)
            
            await redis.setex(key, ttl, serialized_value)
            return True
        except (TypeError, ValueError) as e:
            logger.warning(f"[CacheService] Failed to serialize value for key '{key}': {e}")
            return False
        except Exception as e:
            logger.error(f"[CacheService] Error setting cache key '{key}': {e}")
            return False
    
    @staticmethod
    def hash_key(*args) -> str:
        """
        Generate a stable MD5 hash from input arguments for use as a cache key.
        
        Args:
            *args: Variable arguments to hash (will be converted to strings)
            
        Returns:
            MD5 hash string (hexdigest)
            
        Example:
            >>> CacheService.hash_key("llm", "gemini-2.5-flash-lite", "prompt_text")
            'a1b2c3d4e5f6...'
        """
        # Convert all arguments to strings and join
        key_string = ":".join(str(arg) for arg in args)
        
        # Generate MD5 hash
        hash_obj = hashlib.md5(key_string.encode('utf-8'))
        return hash_obj.hexdigest()
