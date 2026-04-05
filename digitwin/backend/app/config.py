"""Application configuration loaded from environment variables."""

from pathlib import Path
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    # --- Ollama / LLM ---
    ollama_base_url: str = "http://localhost:11434"
    ollama_model: str = "gemma4:26b"
    llm_base_url: str = "http://localhost:11434/v1"
    llm_model: str = "gemma4:26b"
    llm_api_key: str = "ollama"  # Ollama doesn't check this

    # --- Neo4j ---
    neo4j_uri: str = "bolt://localhost:7687"
    neo4j_user: str = "neo4j"
    neo4j_password: str = "digitwin_dev"

    # --- Redis ---
    redis_url: str = "redis://localhost:6379/0"

    # --- ChromaDB ---
    chroma_persist_dir: str = "./data/chroma"

    # --- File storage ---
    upload_dir: str = "./data/uploads"
    max_upload_size_mb: int = 50

    # --- Server ---
    host: str = "0.0.0.0"
    port: int = 5001
    debug: bool = True
    log_level: str = "DEBUG"

    # --- CORS ---
    cors_origins: str = "http://localhost:5173,http://localhost:3000"

    @property
    def cors_origin_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",")]

    @property
    def upload_path(self) -> Path:
        p = Path(self.upload_dir)
        p.mkdir(parents=True, exist_ok=True)
        return p

    @property
    def chroma_path(self) -> Path:
        p = Path(self.chroma_persist_dir)
        p.mkdir(parents=True, exist_ok=True)
        return p


settings = Settings()
