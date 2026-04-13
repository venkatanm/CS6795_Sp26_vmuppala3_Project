# FastAPI Production Application

A production-grade FastAPI application with async SQLAlchemy 2.0, Pydantic v2, Redis, and Alembic migrations.

## Tech Stack

- **FastAPI** - Modern, fast web framework
- **SQLAlchemy 2.0** - Async ORM
- **Pydantic v2** - Data validation
- **Redis** (aioredis) - Caching and session storage
- **Alembic** - Database migrations
- **PostgreSQL 16** - Database
- **Docker & Docker Compose** - Containerization

## Project Structure

```
.
├── src/
│   ├── api/           # API routes
│   │   └── health.py  # Health check endpoint
│   ├── core/          # Core configuration
│   │   ├── config.py  # Settings (pydantic-settings)
│   │   ├── redis.py   # Redis client
│   │   └── security.py # Security utilities
│   ├── db/            # Database layer
│   │   ├── base.py    # Database engine and session
│   │   └── models.py  # SQLAlchemy models
│   ├── services/      # Business logic
│   │   └── health_service.py
│   └── main.py        # FastAPI application
├── alembic/           # Migration scripts
├── docker-compose.yml # Docker services
├── Dockerfile         # Application container
├── requirements.txt   # Python dependencies
└── .env.example       # Environment variables template
```

## Quick Start

### Prerequisites

- Docker and Docker Compose
- Python 3.11+ (for local development)

### Using Docker Compose (Recommended)

1. **Clone and navigate to the project:**
   ```bash
   cd Standard_Tests
   ```

2. **Create environment file:**
   ```bash
   cp .env.example .env
   ```

3. **Start services:**
   ```bash
   docker-compose up -d
   ```

4. **Run migrations:**
   ```bash
   docker-compose exec app alembic upgrade head
   ```

5. **Access the application:**
   - API: http://localhost:8000
   - API Docs: http://localhost:8000/docs
   - Health Check: http://localhost:8000/health

### Local Development

1. **Create virtual environment:**
   ```bash
   python -m venv venv
   source venv/bin/activate  # On Windows: venv\Scripts\activate
   ```

2. **Install dependencies:**
   ```bash
   pip install -r requirements.txt
   ```

3. **Set up environment variables:**
   ```bash
   cp .env.example .env
   # Edit .env with your local database and Redis URLs
   ```

4. **Start PostgreSQL and Redis** (using Docker Compose):
   ```bash
   docker-compose up -d db redis
   ```

5. **Run migrations:**
   ```bash
   alembic upgrade head
   ```

6. **Start the application:**
   ```bash
   uvicorn src.main:app --reload
   ```

## Database Migrations

### Create a new migration:
```bash
alembic revision --autogenerate -m "Description of changes"
```

### Apply migrations:
```bash
alembic upgrade head
```

### Rollback migration:
```bash
alembic downgrade -1
```

## API Endpoints

### Health Check
- **GET** `/health` - Checks database and Redis connectivity

### Root
- **GET** `/` - Welcome message and API information

### Interactive API Documentation
- **GET** `/docs` - Swagger UI
- **GET** `/redoc` - ReDoc

## Environment Variables

See `.env.example` for all available configuration options:

- `DATABASE_URL` - PostgreSQL connection string (asyncpg format)
- `REDIS_URL` - Redis connection string
- `APP_NAME` - Application name
- `DEBUG` - Debug mode (True/False)
- `LOG_LEVEL` - Logging level

## Development

### Adding New Routes

1. Create a new router in `src/api/`
2. Include it in `src/main.py`:
   ```python
   from src.api import your_router
   app.include_router(your_router.router)
   ```

### Adding New Models

1. Create models in `src/db/models.py` (or separate files)
2. Import them in `src/db/__init__.py` if needed
3. Generate migration: `alembic revision --autogenerate -m "Add new model"`

## License

MIT
