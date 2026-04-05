"""WebSocket endpoint for real-time simulation events."""

from fastapi import APIRouter, WebSocket, WebSocketDisconnect
import structlog

router = APIRouter()
logger = structlog.get_logger()

# Connected clients per simulation
_connections: dict[str, list[WebSocket]] = {}


@router.websocket("/simulation/{sim_id}")
async def simulation_ws(websocket: WebSocket, sim_id: str):
    """
    WebSocket for streaming simulation events to the frontend canvas.

    The frontend connects here when a simulation starts. Events streamed:
    - agent_action: An agent performed an action
    - round_complete: A simulation round finished
    - kpi_update: KPI metrics updated
    - scenario_event: An injected event was triggered
    """
    await websocket.accept()
    logger.info("WebSocket connected", sim_id=sim_id)

    if sim_id not in _connections:
        _connections[sim_id] = []
    _connections[sim_id].append(websocket)

    try:
        while True:
            # Receive messages from frontend (e.g., behaviour tuning, event injection)
            data = await websocket.receive_json()
            msg_type = data.get("type", "")

            if msg_type == "tune_behaviour":
                # Forward to simulation engine if available
                from ..api.simulation import _simulations
                engine = _simulations.get(sim_id)
                if engine:
                    agent_id = data.get("agent_id", "")
                    params = data.get("params", {})
                    agent = engine.agent_by_id.get(agent_id)
                    if agent:
                        for k, v in params.items():
                            if hasattr(agent.behaviour, k):
                                setattr(agent.behaviour, k, float(v))
                await websocket.send_json({
                    "type": "ack",
                    "message": f"Behaviour update received for agent {data.get('agent_id')}",
                })
            elif msg_type == "inject_event":
                from ..api.simulation import _simulations
                engine = _simulations.get(sim_id)
                if engine:
                    await engine.inject_scenario(data.get("event", ""))
                await websocket.send_json({
                    "type": "ack",
                    "message": "Event injection received",
                })
            else:
                await websocket.send_json({
                    "type": "error",
                    "message": f"Unknown message type: {msg_type}",
                })

    except WebSocketDisconnect:
        _connections[sim_id].remove(websocket)
        logger.info("WebSocket disconnected", sim_id=sim_id)


async def broadcast_event(sim_id: str, event: dict):
    """Broadcast a simulation event to all connected clients."""
    if sim_id not in _connections:
        return
    dead = []
    for ws in _connections[sim_id]:
        try:
            await ws.send_json(event)
        except Exception:
            dead.append(ws)
    for ws in dead:
        _connections[sim_id].remove(ws)
