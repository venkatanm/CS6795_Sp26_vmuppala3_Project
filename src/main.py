from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from src.core.config import settings
from src.core.redis import get_redis, close_redis
from src.api import health
from src.api.routes import (
    debug,
    exams,
    admin,
    content,
    tutor,
    sync,
    rag,
    tutor_chat,
    images,
)

# Import routes that may or may not exist
try:
    from src.api.routes import sessions
except ImportError:
    sessions = None

try:
    from src.api.routes import student
except ImportError:
    student = None

try:
    from src.api.routes import curriculum
except ImportError:
    curriculum = None

try:
    from src.api.routes import exam_sessions
except ImportError:
    exam_sessions = None


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Lifespan context manager for startup and shutdown events."""
    # Startup
    print("[Startup] Initializing application...")
    
    # Initialize PDF generator (lazy initialization - will initialize on first use)
    # Note: On Windows, Playwright may have issues with the default event loop.
    # The PDF generator will initialize lazily when actually needed.
    # Skip initialization at startup to avoid blocking the server
    print("[PDFGenerator] PDF generator will initialize lazily on first use")
    
    # Initialize Redis connection
    await get_redis()
    print("[Startup] Redis connection initialized")
    
    yield
    
    # Shutdown
    print("[Shutdown] Closing connections...")
    await close_redis()
    print("[Shutdown] Application closed")


app = FastAPI(
    title=settings.APP_NAME,
    description="FastAPI Production Application",
    version="1.0.0",
    lifespan=lifespan,
)

# CORS middleware
allowed_origins = [o.strip() for o in settings.ALLOWED_ORIGINS.split(",") if o.strip()]
app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Include routers
app.include_router(health.router)
app.include_router(debug.router, prefix="/api", tags=["debug"])
app.include_router(exams.router, prefix="/exams", tags=["exams"])
app.include_router(admin.router, prefix="/api/admin", tags=["admin"])
app.include_router(content.router, prefix="/api/content", tags=["content"])
app.include_router(tutor.router, prefix="/api/tutor", tags=["tutor"])
app.include_router(sync.router, prefix="/api/sync", tags=["sync"])
app.include_router(rag.router, prefix="/api/rag", tags=["rag"])
app.include_router(tutor_chat.router, prefix="/api/tutor-chat", tags=["tutor-chat"])
app.include_router(images.router, prefix="/api", tags=["images"])

# Include optional routers if they exist
# Sessions router - now it exists
if sessions and hasattr(sessions, 'router'):
    app.include_router(sessions.router, prefix="/sessions", tags=["sessions"])

# Student router - now it exists
if student and hasattr(student, 'router'):
    app.include_router(student.router, prefix="/student", tags=["student"])

if curriculum and hasattr(curriculum, 'router'):
    app.include_router(curriculum.router, prefix="/api/curriculum", tags=["curriculum"])

# Exam sessions router for module-based fetching
if exam_sessions and hasattr(exam_sessions, 'router'):
    app.include_router(exam_sessions.router, prefix="/api/exam", tags=["exam-sessions"])


@app.get("/")
async def root():
    """Root endpoint with API information."""
    return {
        "message": f"Welcome to {settings.APP_NAME}",
        "version": "1.0.0",
        "docs": "/docs",
        "health": "/health"
    }
