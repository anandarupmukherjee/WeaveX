"""DigiTwin — FastAPI application entry point."""

from contextlib import asynccontextmanager

import structlog
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .config import settings
from .utils.llm_client import OllamaClient
from .utils.graph_client import Neo4jClient
from .api import projects, extraction, simulation, websocket, debug

logger = structlog.get_logger()


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Startup and shutdown events."""
    # --- Startup ---
    logger.info("Starting DigiTwin", model=settings.llm_model)

    # Verify Ollama is reachable and model is available
    llm = OllamaClient()
    available = await llm.check_model()
    if not available:
        logger.error(
            "Ollama model not found. Run: ollama pull %s",
            settings.ollama_model,
        )
    else:
        logger.info("Ollama model ready", model=settings.llm_model)

    # Verify Neo4j is reachable
    graph = Neo4jClient()
    neo4j_ok = await graph.verify()
    if neo4j_ok:
        logger.info("Neo4j connected")
    else:
        logger.warning("Neo4j not reachable — run: docker compose up -d")

    yield

    # --- Shutdown ---
    await graph.close()
    logger.info("DigiTwin stopped")


app = FastAPI(
    title="DigiTwin API",
    description="AI-Powered Digital Twin Platform",
    version="0.1.0",
    lifespan=lifespan,
)

# CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Routers
app.include_router(projects.router, prefix="/api/projects", tags=["projects"])
app.include_router(extraction.router, prefix="/api/extract", tags=["extraction"])
app.include_router(simulation.router, prefix="/api/simulation", tags=["simulation"])
app.include_router(websocket.router, prefix="/ws", tags=["websocket"])
app.include_router(debug.router, prefix="/api/debug", tags=["debug"])


@app.get("/health")
async def health():
    return {
        "status": "ok",
        "model": settings.llm_model,
        "ollama": settings.ollama_base_url,
    }
