"""Project management API routes."""

import uuid
from datetime import datetime

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from ..models.twin_spec import Project, ProjectStatus

router = APIRouter()

# In-memory store for dev — replace with Postgres in production
_projects: dict[str, Project] = {}


class CreateProjectRequest(BaseModel):
    name: str
    description: str = ""


@router.post("/")
async def create_project(req: CreateProjectRequest):
    project = Project(
        id=f"proj_{uuid.uuid4().hex[:12]}",
        name=req.name,
    )
    _projects[project.id] = project
    return {"success": True, "data": project.model_dump()}


@router.get("/")
async def list_projects():
    return {
        "success": True,
        "data": [p.model_dump() for p in _projects.values()],
    }


@router.get("/{project_id}")
async def get_project(project_id: str):
    project = _projects.get(project_id)
    if not project:
        raise HTTPException(404, f"Project {project_id} not found")
    return {"success": True, "data": project.model_dump()}


@router.delete("/{project_id}")
async def delete_project(project_id: str):
    if project_id not in _projects:
        raise HTTPException(404, f"Project {project_id} not found")
    del _projects[project_id]
    return {"success": True}
