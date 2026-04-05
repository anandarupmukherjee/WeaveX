"""Simulation control API routes."""

import asyncio
import uuid

import structlog
from fastapi import APIRouter, BackgroundTasks, HTTPException
from pydantic import BaseModel

from ..api.extraction import _extractions, _jobs
from ..api.websocket import broadcast_event
from ..services.simulation.engine import SimulationEngine

router = APIRouter()
logger = structlog.get_logger()

# Active simulation engines
_simulations: dict[str, SimulationEngine] = {}


class StartSimRequest(BaseModel):
    extraction_id: str
    rounds: int = 10
    time_step_minutes: int = 60


class InjectEventRequest(BaseModel):
    event: str


def _get_twin_spec(extraction_id: str):
    # Check completed jobs first
    job = _jobs.get(extraction_id)
    if job and job["status"] == "complete":
        from ..models.twin_spec import TwinSpec
        return TwinSpec(**job["result"])
    # Fall back to legacy store
    spec = _extractions.get(extraction_id)
    if spec:
        return spec
    raise HTTPException(404, f"Extraction '{extraction_id}' not found or not complete")


async def _run_sim(sim_id: str):
    engine = _simulations.get(sim_id)
    if not engine:
        return
    async def emit(event):
        await broadcast_event(sim_id, event)
    engine.on_event = emit
    await engine.run()


@router.post("/start")
async def start_simulation(req: StartSimRequest, background_tasks: BackgroundTasks):
    twin_spec = _get_twin_spec(req.extraction_id)
    sim_id = f"sim_{uuid.uuid4().hex[:10]}"
    engine = SimulationEngine(
        sim_id=sim_id,
        twin_spec=twin_spec,
        rounds=min(req.rounds, 20),  # cap at 20 rounds
    )
    _simulations[sim_id] = engine
    background_tasks.add_task(_run_sim, sim_id)
    logger.info("Simulation started", sim_id=sim_id, rounds=req.rounds)
    return {"success": True, "simulation_id": sim_id, "rounds": req.rounds}


@router.post("/{sim_id}/pause")
async def pause_simulation(sim_id: str):
    engine = _simulations.get(sim_id)
    if not engine:
        raise HTTPException(404, "Simulation not found")
    engine.pause()
    return {"success": True, "status": "paused"}


@router.post("/{sim_id}/resume")
async def resume_simulation(sim_id: str):
    engine = _simulations.get(sim_id)
    if not engine:
        raise HTTPException(404, "Simulation not found")
    engine.resume()
    return {"success": True, "status": "running"}


@router.post("/{sim_id}/stop")
async def stop_simulation(sim_id: str):
    engine = _simulations.get(sim_id)
    if not engine:
        raise HTTPException(404, "Simulation not found")
    engine.stop()
    return {"success": True, "status": "stopped"}


@router.post("/{sim_id}/inject-event")
async def inject_event(sim_id: str, req: InjectEventRequest):
    engine = _simulations.get(sim_id)
    if not engine:
        raise HTTPException(404, "Simulation not found")
    await engine.inject_scenario(req.event)
    return {"success": True, "event": req.event}


@router.get("/{sim_id}/status")
async def simulation_status(sim_id: str):
    engine = _simulations.get(sim_id)
    if not engine:
        raise HTTPException(404, "Simulation not found")
    return {
        "sim_id": sim_id,
        "running": engine.running,
        "paused": engine.paused,
        "round": engine.round_num,
        "total_rounds": engine.rounds,
        "kpi_history": engine.kpi_history,
        "world_state": engine.world_state,
    }


@router.get("/{sim_id}/log")
async def simulation_log(sim_id: str):
    engine = _simulations.get(sim_id)
    if not engine:
        raise HTTPException(404, "Simulation not found")
    return {"events": engine.event_log[-100:]}
