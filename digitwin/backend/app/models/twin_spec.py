"""Core data models for the digital twin specification."""

from datetime import datetime
from enum import Enum

from pydantic import BaseModel, Field


# ---- Intent & Domain ----

class ModelType(str, Enum):
    PROCESS = "process"
    ORGANISATION = "organisation"
    MARKET = "market"
    SYSTEM = "system"
    CUSTOM = "custom"


class IntentSpec(BaseModel):
    """What the user wants to model, extracted from their description."""
    domain: str = Field(description="Detected domain, e.g. 'hospital_operations'")
    domain_description: str = Field(description="Brief description of the domain")
    model_type: ModelType = Field(description="What kind of thing is being modelled")
    optimisation_targets: list[str] = Field(
        default_factory=list,
        description="What to optimise, e.g. ['patient_wait_time', 'bed_utilisation']",
    )
    scenario_seeds: list[str] = Field(
        default_factory=list,
        description="Scenarios to explore, e.g. ['flu_season_surge']",
    )
    constraints: list[str] = Field(
        default_factory=list,
        description="Constraints, e.g. ['budget_cap_500k']",
    )


# ---- Ontology ----

class EntityAttribute(BaseModel):
    name: str
    type: str = "text"
    description: str = ""


class EntityType(BaseModel):
    name: str = Field(description="PascalCase type name, e.g. 'Doctor'")
    description: str
    attributes: list[EntityAttribute] = Field(default_factory=list)
    examples: list[str] = Field(default_factory=list)


class RelationType(BaseModel):
    name: str = Field(description="UPPER_SNAKE_CASE, e.g. 'REPORTS_TO'")
    description: str = ""
    source_type: str = ""
    target_type: str = ""
    attributes: list[EntityAttribute] = Field(default_factory=list)


class Ontology(BaseModel):
    entity_types: list[EntityType]
    relation_types: list[RelationType]
    analysis_summary: str = ""


# ---- Agents ----

class BehaviourParams(BaseModel):
    """Tunable parameters for an agent's behaviour. Exposed as sliders in the UI."""
    activity_level: float = Field(0.5, ge=0.0, le=1.0, description="How active the agent is")
    response_latency: float = Field(0.5, ge=0.0, le=1.0, description="How fast they respond")
    risk_tolerance: float = Field(0.5, ge=0.0, le=1.0, description="Willingness to take risks")
    compliance: float = Field(0.5, ge=0.0, le=1.0, description="How closely they follow rules")
    creativity: float = Field(0.5, ge=0.0, le=1.0, description="Deviation from standard procedure")


class Relationship(BaseModel):
    target_agent_id: str
    relation_type: str
    description: str = ""
    weight: float = 1.0


class AgentSpec(BaseModel):
    """Specification for a single agent in the digital twin."""
    id: str
    name: str
    entity_type: str
    persona: str = Field(description="Detailed persona prompt")
    goals: list[str] = Field(default_factory=list)
    constraints: list[str] = Field(default_factory=list)
    tool_names: list[str] = Field(default_factory=list)
    behaviour: BehaviourParams = Field(default_factory=BehaviourParams)
    relationships: list[Relationship] = Field(default_factory=list)
    properties: dict = Field(default_factory=dict)


# ---- Interaction Protocols ----

class InteractionStep(BaseModel):
    actor: str = Field(description="Agent ID or role that performs this step")
    action: str = Field(description="What they do")
    tools_used: list[str] = Field(default_factory=list)
    produces: str = Field(default="", description="What data/outcome this step produces")


class InteractionProtocol(BaseModel):
    """A defined pattern of interaction between agents."""
    id: str
    name: str
    description: str
    trigger: str = Field(description="What event or condition starts this interaction")
    participants: list[str] = Field(description="Agent IDs involved")
    steps: list[InteractionStep] = Field(default_factory=list)
    frequency: str = Field(default="on_demand", description="How often this happens")


# ---- Tools ----

class ToolParameter(BaseModel):
    name: str
    type: str = "string"
    description: str = ""
    required: bool = True


class ToolSpec(BaseModel):
    """Specification for a tool available to agents."""
    name: str
    description: str
    parameters: list[ToolParameter] = Field(default_factory=list)
    domain: str = ""
    side_effects: list[str] = Field(default_factory=list)


# ---- Objectives ----

class ObjectiveSpec(BaseModel):
    """An optimisation objective with measurable KPIs."""
    name: str
    description: str
    kpi: str = Field(description="Metric to measure")
    target_direction: str = Field(default="minimize", description="minimize or maximize")
    collection_point: str = Field(
        default="",
        description="Where in the simulation this metric is collected",
    )
    time_horizon: str = Field(
        default="",
        description="Time period from the document, e.g. 'Q1-Q4 2025', 'annual', '5-year'",
    )


# ---- Full Twin Specification ----

class TwinSpec(BaseModel):
    """The complete specification for a digital twin, output of Phase 2."""
    intent: IntentSpec
    ontology: Ontology
    agents: list[AgentSpec] = Field(default_factory=list)
    interactions: list[InteractionProtocol] = Field(default_factory=list)
    tools: list[ToolSpec] = Field(default_factory=list)
    objectives: list[ObjectiveSpec] = Field(default_factory=list)


# ---- Project ----

class ProjectStatus(str, Enum):
    CREATED = "created"
    UPLOADING = "uploading"
    ANALYSING = "analysing"
    BUILDING = "building"
    READY = "ready"
    SIMULATING = "simulating"
    COMPLETED = "completed"
    FAILED = "failed"


class Project(BaseModel):
    id: str
    name: str
    status: ProjectStatus = ProjectStatus.CREATED
    intent: IntentSpec | None = None
    twin_spec: TwinSpec | None = None
    uploaded_files: list[str] = Field(default_factory=list)
    created_at: datetime = Field(default_factory=datetime.now)
    updated_at: datetime = Field(default_factory=datetime.now)
