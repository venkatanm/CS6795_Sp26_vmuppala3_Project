from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Application settings loaded from environment variables."""
    
    # Database
    DATABASE_URL: str
    
    # Redis
    REDIS_URL: str
    
    # OpenAI (for embeddings)
    OPENAI_API_KEY: str = ""

    # Gemini
    GEMINI_API_KEY: str = ""
    GEMINI_MODEL: str = "gemini-2.5-flash-lite"
    
    # Application
    APP_NAME: str = "FastAPI Production App"
    DEBUG: bool = False
    LOG_LEVEL: str = "INFO"

    # CORS - comma-separated list of allowed origins
    # Example: "https://myapp.com,https://www.myapp.com"
    ALLOWED_ORIGINS: str = "http://localhost:3000"

    # Admin - comma-separated list of Clerk user IDs allowed to access admin routes
    # Example: "user_abc123,user_def456"
    ADMIN_USER_IDS: str = ""
    
    # CAT Routing
    CAT_ROUTING_THRESHOLD: float = 0.58  # 58% = 7/12 correct to route to hard module
    
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=True,
        extra="ignore"
    )


settings = Settings()
