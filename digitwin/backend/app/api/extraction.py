"""Document analysis / extraction API routes."""

import json
import uuid
from pathlib import Path
from typing import Literal

import structlog
from fastapi import APIRouter, BackgroundTasks, File, Form, HTTPException, UploadFile

from ..config import settings
from ..models.twin_spec import TwinSpec
from ..services.extractors.document_parser import SUPPORTED_EXTENSIONS, parse_multiple
from ..services.extractors.domain_analyser import DomainAnalyser
from ..utils.graph_client import Neo4jClient

router = APIRouter()
logger = structlog.get_logger()

# In-memory stores
_extractions: dict[str, TwinSpec] = {}

JobStatus = Literal["pending", "running", "complete", "failed"]
_jobs: dict[str, dict] = {}

# Persistence directory
_PERSIST_DIR = Path("./data/extractions")
_PERSIST_DIR.mkdir(parents=True, exist_ok=True)


def _persist(job_id: str, result: dict):
    """Save extraction result to disk."""
    try:
        (_PERSIST_DIR / f"{job_id}.json").write_text(json.dumps(result), encoding="utf-8")
    except Exception as e:
        logger.warning("Failed to persist extraction", job_id=job_id, error=str(e))


def _load_persisted(job_id: str) -> dict | None:
    """Load a previously saved extraction from disk."""
    path = _PERSIST_DIR / f"{job_id}.json"
    if path.exists():
        try:
            return json.loads(path.read_text(encoding="utf-8"))
        except Exception:
            return None
    return None


def _load_all_persisted():
    """On startup, reload all saved extractions into _jobs."""
    for path in _PERSIST_DIR.glob("*.json"):
        job_id = path.stem
        try:
            result = json.loads(path.read_text(encoding="utf-8"))
            _jobs[job_id] = {
                "status": "complete",
                "stage": "done",
                "detail": "Loaded from disk",
                "result": result,
                "error": None,
            }
        except Exception:
            pass


# Load persisted extractions on import
_load_all_persisted()


async def _write_to_neo4j(job_id: str, twin_spec: TwinSpec):
    """Write agents and relationships to the Neo4j knowledge graph."""
    try:
        neo = Neo4jClient()
        if not await neo.verify():
            logger.warning("Neo4j not reachable, skipping graph write", job_id=job_id)
            return

        # Map agent id → neo4j element id
        neo_ids: dict[str, str] = {}
        for agent in twin_spec.agents:
            props = {
                "persona": agent.persona,
                "goals": ", ".join(agent.goals),
                "constraints": ", ".join(agent.constraints),
                "activity_level": agent.behaviour.activity_level,
                "compliance": agent.behaviour.compliance,
                "job_id": job_id,
            }
            neo_id = await neo.create_entity(
                entity_type=agent.entity_type.replace(" ", "_") or "Agent",
                name=agent.name,
                properties=props,
                project_id=job_id,
            )
            neo_ids[agent.id] = neo_id

        # Write relationships
        for agent in twin_spec.agents:
            for rel in agent.relationships:
                src = neo_ids.get(agent.id)
                tgt = neo_ids.get(rel.target_agent_id)
                if src and tgt:
                    await neo.create_relationship(
                        source_id=src,
                        target_id=tgt,
                        rel_type=rel.relation_type.upper().replace(" ", "_") or "INTERACTS_WITH",
                        properties={"description": rel.description, "weight": rel.weight},
                    )

        await neo.close()
        logger.info("Graph written to Neo4j",
                    job_id=job_id,
                    nodes=len(neo_ids),
                    agents=len(twin_spec.agents))
    except Exception as e:
        logger.warning("Neo4j write failed (non-fatal)", job_id=job_id, error=str(e))


async def _run_extraction(job_id: str, saved_paths: list[str], description: str):
    """Background task: parse docs and run the LLM pipeline."""
    _jobs[job_id]["status"] = "running"
    _jobs[job_id]["stage"] = "parsing"
    _jobs[job_id]["detail"] = "Parsing documents..."

    try:
        documents = parse_multiple(saved_paths)
        logger.info("Parsed documents", count=len(documents), total_chars=sum(len(d) for d in documents))

        _jobs[job_id]["stage"] = "analysing"
        _jobs[job_id]["detail"] = "Running LLM extraction pipeline..."

        analyser = DomainAnalyser()
        twin_spec = await analyser.analyse(
            documents=documents,
            user_description=description,
            on_progress=lambda stage, detail: _update_progress(job_id, stage, detail),
        )

        result_dict = twin_spec.model_dump()
        _extractions[job_id] = twin_spec
        _jobs[job_id]["status"] = "complete"
        _jobs[job_id]["stage"] = "done"
        _jobs[job_id]["detail"] = "Extraction complete"
        _jobs[job_id]["result"] = result_dict
        _persist(job_id, result_dict)  # save to disk — survives restarts
        logger.info("Extraction complete", job_id=job_id)

        # Write to Neo4j knowledge graph (non-blocking, errors are warnings)
        await _write_to_neo4j(job_id, twin_spec)

    except Exception as e:
        logger.error("Extraction failed", job_id=job_id, error=str(e))
        _jobs[job_id]["status"] = "failed"
        _jobs[job_id]["error"] = str(e)


def _update_progress(job_id: str, stage: str, detail: str):
    if job_id in _jobs:
        _jobs[job_id]["stage"] = stage
        _jobs[job_id]["detail"] = detail


@router.post("/upload-and-analyse")
async def upload_and_analyse(
    background_tasks: BackgroundTasks,
    files: list[UploadFile] = File(...),
    description: str = Form(...),
    project_id: str = Form(""),
):
    """
    Upload documents and start the extraction pipeline in the background.
    Returns a job_id immediately. Poll GET /extract/{job_id}/status for progress.
    """
    if not files:
        raise HTTPException(400, "No files uploaded")

    job_id = f"ext_{uuid.uuid4().hex[:12]}"
    upload_dir = settings.upload_path / job_id
    upload_dir.mkdir(parents=True, exist_ok=True)

    saved_paths = []
    for f in files:
        ext = Path(f.filename).suffix.lower()
        if ext not in SUPPORTED_EXTENSIONS:
            logger.warning("Skipping unsupported file", filename=f.filename, ext=ext)
            continue
        dest = upload_dir / f.filename
        content = await f.read()
        dest.write_bytes(content)
        saved_paths.append(str(dest))
        logger.info("Saved upload", filename=f.filename, size=len(content))

    if not saved_paths:
        raise HTTPException(400, "No supported files found in upload")

    _jobs[job_id] = {"status": "pending", "stage": "queued", "detail": "Job queued", "result": None, "error": None}
    background_tasks.add_task(_run_extraction, job_id, saved_paths, description)

    return {"job_id": job_id, "status": "pending"}


@router.get("/list")
async def list_extractions():
    """Return all completed extractions (from disk + memory)."""
    results = []
    for job_id, job in _jobs.items():
        if job["status"] == "complete" and job.get("result"):
            intent = job["result"].get("intent", {})
            results.append({
                "job_id": job_id,
                "domain": intent.get("domain", "unknown"),
                "domain_description": intent.get("domain_description", ""),
                "agents": len(job["result"].get("agents", [])),
            })
    return {"extractions": results}


@router.get("/{job_id}/status")
async def get_job_status(job_id: str):
    """Poll this endpoint to track extraction progress."""
    job = _jobs.get(job_id)
    if not job:
        raise HTTPException(404, "Job not found")
    return {
        "job_id": job_id,
        "status": job["status"],
        "stage": job.get("stage"),
        "detail": job.get("detail"),
        "error": job.get("error"),
    }


@router.get("/{job_id}")
async def get_extraction(job_id: str):
    """Retrieve a completed extraction result."""
    job = _jobs.get(job_id)
    if not job:
        # Legacy: check old extractions store
        spec = _extractions.get(job_id)
        if not spec:
            raise HTTPException(404, "Extraction not found")
        return {"success": True, "extraction_id": job_id, "data": spec.model_dump()}

    if job["status"] == "failed":
        raise HTTPException(500, f"Extraction failed: {job.get('error')}")
    if job["status"] != "complete":
        raise HTTPException(202, "Extraction still in progress")

    return {"success": True, "extraction_id": job_id, "data": job["result"]}


@router.post("/analyse-text")
async def analyse_text(
    background_tasks: BackgroundTasks,
    text: str = Form(...),
    description: str = Form(...),
):
    """Analyse raw text. Returns job_id — poll status endpoint for progress."""
    job_id = f"ext_{uuid.uuid4().hex[:12]}"
    upload_dir = settings.upload_path / job_id
    upload_dir.mkdir(parents=True, exist_ok=True)
    text_file = upload_dir / "input.txt"
    text_file.write_text(text, encoding="utf-8")

    _jobs[job_id] = {"status": "pending", "stage": "queued", "detail": "Job queued", "result": None, "error": None}
    background_tasks.add_task(_run_extraction, job_id, [str(text_file)], description)

    return {"job_id": job_id, "status": "pending"}
