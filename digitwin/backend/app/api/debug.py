"""Debug endpoint — exposes recent LLM request/response events."""

from collections import deque
from fastapi import APIRouter

router = APIRouter()

# Ring buffer — last 50 events
_events: deque = deque(maxlen=50)


def push_event(event: dict):
    """Called by llm_client on every request/response."""
    _events.append(event)


@router.get("/llm-log")
async def llm_log():
    return {"events": list(_events)}
