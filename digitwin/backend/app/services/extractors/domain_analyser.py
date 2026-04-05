"""
Domain Analyser — Multi-pass LLM extraction pipeline.

Each pass runs over chunked document text so the full document is covered,
not just the first few thousand characters.
"""

import json
import uuid
import structlog

from ...config import settings
from ...utils.llm_client import OllamaClient
from ...models.twin_spec import (
    IntentSpec, Ontology, EntityType, RelationType, EntityAttribute,
    AgentSpec, BehaviourParams, Relationship,
    InteractionProtocol, InteractionStep,
    ToolSpec, ToolParameter,
    ObjectiveSpec,
    TwinSpec,
)

logger = structlog.get_logger()

# Chunk size for document processing — fits comfortably in deepseek/claude context
CHUNK_CHARS = 8_000
CHUNK_OVERLAP = 500


def _chunks(text: str, size: int = CHUNK_CHARS, overlap: int = CHUNK_OVERLAP) -> list[str]:
    """Split text into overlapping chunks."""
    if len(text) <= size:
        return [text]
    result = []
    start = 0
    while start < len(text):
        result.append(text[start:start + size])
        start += size - overlap
    return result


class DomainAnalyser:
    def __init__(self, llm: OllamaClient | None = None):
        self.llm = llm or OllamaClient()

    async def analyse(
        self,
        documents: list[str],
        user_description: str,
        on_progress: callable = None,
        on_graph_update: callable = None,
    ) -> TwinSpec:
        combined_text = "\n\n---\n\n".join(documents)
        chunks = _chunks(combined_text)
        logger.info("Document chunked", total_chars=len(combined_text), chunks=len(chunks))

        # --- Pass 0: Intent (first chunk sufficient) ---
        if on_progress:
            on_progress("intent", "Classifying domain and intent...")
        intent = await self._extract_intent(chunks[0], user_description)
        logger.info("Intent extracted", domain=intent.domain, model_type=intent.model_type)

        # --- Pass 1: Ontology (all chunks, merge) ---
        if on_progress:
            on_progress("ontology", "Extracting domain ontology...")
        ontology = await self._extract_ontology_chunked(chunks, intent, on_graph_update)
        logger.info("Ontology extracted",
                    entity_types=len(ontology.entity_types),
                    relation_types=len(ontology.relation_types))

        # --- Pass 2: Agents (all chunks, merge) ---
        if on_progress:
            on_progress("agents", "Identifying agents and personas...")
        agents = await self._extract_agents_chunked(chunks, intent, ontology, on_graph_update)
        logger.info("Agents extracted", count=len(agents))

        # --- Pass 3: Interactions ---
        if on_progress:
            on_progress("interactions", "Mapping interaction protocols...")
        interactions = await self._extract_interactions(chunks[0], intent, agents)
        logger.info("Interactions extracted", count=len(interactions))

        # --- Pass 4: Tools & Objectives ---
        if on_progress:
            on_progress("tools", "Assigning tools and objectives...")
        tools = await self._map_tools(intent, agents, interactions)
        objectives = await self._map_objectives(intent, agents, interactions, chunks[0])
        logger.info("Tools mapped", tools=len(tools), objectives=len(objectives))

        return TwinSpec(
            intent=intent,
            ontology=ontology,
            agents=agents,
            interactions=interactions,
            tools=tools,
            objectives=objectives,
        )

    # ================================================================
    # Pass 0: Intent Classification
    # ================================================================

    async def _extract_intent(self, text: str, user_desc: str) -> IntentSpec:
        messages = [
            {
                "role": "system",
                "content": """Classify a digital twin domain from user description and document excerpt.
Respond with ONLY this JSON (no extra text):
{"domain":"snake_case","domain_description":"one sentence","model_type":"market","optimisation_targets":["target1"],"scenario_seeds":["scenario1"],"constraints":["constraint1"]}
model_type must be one of: process, organisation, market, system"""
            },
            {
                "role": "user",
                "content": f"User: {user_desc}\n\nDoc excerpt: {text[:6000]}"
            },
        ]
        result = await self.llm.chat_json(messages, temperature=0.2, max_tokens=512)
        return IntentSpec(**result)

    # ================================================================
    # Pass 1: Ontology (chunked)
    # ================================================================

    async def _extract_ontology_chunked(self, chunks: list[str], intent: IntentSpec, on_graph_update: callable = None) -> Ontology:
        all_entity_types: dict[str, EntityType] = {}
        all_relation_types: dict[str, RelationType] = {}
        summary = ""

        for i, chunk in enumerate(chunks):
            logger.debug("Ontology pass", chunk=i + 1, total=len(chunks))
            messages = [
                {
                    "role": "system",
                    "content": f"""Design a concise ontology for a {intent.model_type} digital twin in domain: {intent.domain}.
Respond with ONLY this JSON structure (5-8 entity types, 4-6 relation types):
{{"entity_types":[{{"name":"PascalCase","description":"what it is","attributes":[{{"name":"attr","type":"text","description":"desc"}}],"examples":["ex1"]}}],"relation_types":[{{"name":"VERB_NOUN","description":"meaning","source_type":"A","target_type":"B"}}],"analysis_summary":"brief summary"}}
Entities must be concrete actors/objects. No abstract concepts."""
                },
                {
                    "role": "user",
                    "content": f"Domain: {intent.domain}. Targets: {', '.join(intent.optimisation_targets)}.\nDoc chunk {i+1}/{len(chunks)}: {chunk}"
                },
            ]
            try:
                result = await self.llm.chat_json(messages, temperature=0.3, max_tokens=1500)
                for et in result.get("entity_types", []):
                    name = et.get("name", "")
                    if name and name not in all_entity_types:
                        all_entity_types[name] = EntityType(**et)
                for rt in result.get("relation_types", []):
                    name = rt.get("name", "")
                    if name and name not in all_relation_types:
                        all_relation_types[name] = RelationType(**rt)
                if not summary:
                    summary = result.get("analysis_summary", "")
                # Emit live graph update
                if on_graph_update:
                    on_graph_update({
                        "entity_types": [
                            {"name": et.name, "description": et.description}
                            for et in all_entity_types.values()
                        ],
                        "relation_types": [
                            {"name": rt.name, "source_type": rt.source_type, "target_type": rt.target_type}
                            for rt in all_relation_types.values()
                        ],
                        "agents": [],
                    })
            except Exception as e:
                logger.warning("Ontology chunk failed", chunk=i, error=str(e))

        return Ontology(
            entity_types=list(all_entity_types.values()),
            relation_types=list(all_relation_types.values()),
            analysis_summary=summary,
        )

    # ================================================================
    # Pass 2: Agent Extraction (chunked)
    # ================================================================

    async def _extract_agents_chunked(
        self, chunks: list[str], intent: IntentSpec, ontology: Ontology,
        on_graph_update: callable = None,
    ) -> list[AgentSpec]:
        entity_type_names = [et.name for et in ontology.entity_types]
        all_raw_agents: dict[str, dict] = {}  # name → raw dict, dedup by name

        for i, chunk in enumerate(chunks):
            logger.debug("Agents pass", chunk=i + 1, total=len(chunks))
            messages = [
                {
                    "role": "system",
                    "content": f"""Extract 8-15 agents for a {intent.domain} digital twin simulation.
Scale agent count to document complexity — use more agents for richer, multi-stakeholder documents.
Entity types available: {', '.join(entity_type_names)}
Each agent must be a distinct real-world actor with a unique name and role.
Respond with ONLY valid JSON:
{{"agents":[{{"name":"Name","entity_type":"Type","persona":"2 sentence description of who they are and what they do","goals":["g1","g2"],"constraints":["c1"],"tool_names":["t1"],"behaviour":{{"activity_level":0.7,"response_latency":0.3,"risk_tolerance":0.5,"compliance":0.8,"creativity":0.4}},"relationships":[{{"target_agent_name":"Other","relation_type":"REL","description":"d","weight":0.8}}],"properties":{{}}}}]}}"""
                },
                {
                    "role": "user",
                    "content": f"Targets: {', '.join(intent.optimisation_targets)}.\nDoc chunk {i+1}/{len(chunks)}: {chunk}"
                },
            ]
            try:
                result = await self.llm.chat_json(messages, temperature=0.4, max_tokens=4096)
                for raw in result.get("agents", []):
                    name = raw.get("name", "")
                    if name and name not in all_raw_agents:
                        all_raw_agents[name] = raw
                # Emit live graph with agents so far
                if on_graph_update:
                    on_graph_update({
                        "entity_types": [
                            {"name": et.name, "description": et.description}
                            for et in ontology.entity_types
                        ],
                        "relation_types": [
                            {"name": rt.name, "source_type": rt.source_type, "target_type": rt.target_type}
                            for rt in ontology.relation_types
                        ],
                        "agents": [
                            {
                                "name": raw.get("name", ""),
                                "entity_type": raw.get("entity_type", ""),
                                "relationships": [
                                    {"target": r.get("target_agent_name", ""), "type": r.get("relation_type", "")}
                                    for r in raw.get("relationships", [])
                                ],
                            }
                            for raw in all_raw_agents.values()
                        ],
                    })
            except Exception as e:
                logger.warning("Agents chunk failed", chunk=i, error=str(e))

        # Build AgentSpec objects
        agents = []
        name_to_id: dict[str, str] = {}

        def _ensure_list(val) -> list:
            """Coerce a value to a list — LLM sometimes returns a string."""
            if isinstance(val, list):
                return val
            if isinstance(val, str) and val:
                return [val]
            return []

        for raw in all_raw_agents.values():
            try:
                agent_id = f"agent_{uuid.uuid4().hex[:8]}"
                name_to_id[raw["name"]] = agent_id
                rels_raw = raw.get("relationships", [])
                if not isinstance(rels_raw, list):
                    rels_raw = []
                relationships = [
                    Relationship(
                        target_agent_id=rel.get("target_agent_name", ""),
                        relation_type=rel.get("relation_type", "INTERACTS_WITH"),
                        description=rel.get("description", ""),
                        weight=float(rel.get("weight", 1.0)),
                    )
                    for rel in rels_raw
                    if isinstance(rel, dict)
                ]
                beh_raw = raw.get("behaviour", {})
                if not isinstance(beh_raw, dict):
                    beh_raw = {}
                agents.append(AgentSpec(
                    id=agent_id,
                    name=raw["name"],
                    entity_type=raw.get("entity_type", "Unknown"),
                    persona=raw.get("persona", "") if isinstance(raw.get("persona"), str) else "",
                    goals=_ensure_list(raw.get("goals")),
                    constraints=_ensure_list(raw.get("constraints")),
                    tool_names=_ensure_list(raw.get("tool_names")),
                    behaviour=BehaviourParams(**beh_raw),
                    relationships=relationships,
                    properties=raw.get("properties", {}) if isinstance(raw.get("properties"), dict) else {},
                ))
            except Exception as e:
                logger.warning("Skipping malformed agent", name=raw.get("name"), error=str(e))

        # Resolve relationship target names → IDs
        for agent in agents:
            for rel in agent.relationships:
                if rel.target_agent_id in name_to_id:
                    rel.target_agent_id = name_to_id[rel.target_agent_id]

        return agents

    # ================================================================
    # Pass 3: Interaction Protocols
    # ================================================================

    async def _extract_interactions(
        self, text: str, intent: IntentSpec, agents: list[AgentSpec]
    ) -> list[InteractionProtocol]:
        agent_summary = "\n".join(
            f"- {a.name} ({a.entity_type}): {a.goals[0] if a.goals else 'general'}"
            for a in agents[:15]
        )
        messages = [
            {
                "role": "system",
                "content": f"""Design 5-10 interaction protocols for a {intent.domain} simulation.
Agents: {agent_summary}
Respond with ONLY this JSON:
{{"interactions":[{{"name":"Protocol Name","description":"what happens","trigger":"event","participant_names":["Agent1","Agent2"],"steps":[{{"actor":"Agent1","action":"does something","tools_used":["tool1"],"produces":"output"}}],"frequency":"per_event"}}]}}
frequency: per_event, hourly, daily, weekly, continuous"""
            },
            {
                "role": "user",
                "content": f"Doc: {text[:6000]}"
            },
        ]
        result = await self.llm.chat_json(messages, temperature=0.3, max_tokens=2048)

        name_to_id = {a.name: a.id for a in agents}
        interactions = []
        for raw in result.get("interactions", []):
            participant_ids = [name_to_id.get(n, n) for n in raw.get("participant_names", [])]
            steps = [InteractionStep(**s) for s in raw.get("steps", [])]
            interactions.append(InteractionProtocol(
                id=f"proto_{uuid.uuid4().hex[:8]}",
                name=raw["name"],
                description=raw.get("description", ""),
                trigger=raw.get("trigger", ""),
                participants=participant_ids,
                steps=steps,
                frequency=raw.get("frequency", "per_event"),
            ))
        return interactions

    # ================================================================
    # Pass 4a: Tool Mapping
    # ================================================================

    async def _map_tools(
        self, intent: IntentSpec, agents: list[AgentSpec],
        interactions: list[InteractionProtocol],
    ) -> list[ToolSpec]:
        all_tool_names: set[str] = set()
        for a in agents:
            all_tool_names.update(a.tool_names)
        for proto in interactions:
            for step in proto.steps:
                all_tool_names.update(step.tools_used)

        messages = [
            {
                "role": "system",
                "content": f"""Define tool specs for a {intent.domain} simulation.
Tools needed: {', '.join(sorted(all_tool_names)) or 'none specified'}
Respond with ONLY this JSON:
{{"tools":[{{"name":"tool_name","description":"what it does","parameters":[{{"name":"param","type":"string","description":"desc","required":true}}],"domain":"{intent.domain}","side_effects":["effect1"]}}]}}"""
            },
            {"role": "user", "content": "Generate tool specs."},
        ]
        result = await self.llm.chat_json(messages, temperature=0.2, max_tokens=1500)
        return [
            ToolSpec(
                name=t["name"],
                description=t.get("description", ""),
                parameters=[ToolParameter(**p) for p in t.get("parameters", [])],
                domain=t.get("domain", intent.domain),
                side_effects=t.get("side_effects", []),
            )
            for t in result.get("tools", [])
        ]

    # ================================================================
    # Pass 4b: Objective Mapping
    # ================================================================

    async def _map_objectives(
        self, intent: IntentSpec, agents: list[AgentSpec],
        interactions: list[InteractionProtocol],
        doc_text: str = "",
    ) -> list[ObjectiveSpec]:
        messages = [
            {
                "role": "system",
                "content": f"""Define 3-5 KPI objectives for a {intent.domain} simulation.
Optimise: {', '.join(intent.optimisation_targets)}
Also extract the time horizon from the document (e.g. "annual", "Q1-Q4 2025", "5-year projection", "monthly").
Respond with ONLY this JSON:
{{"objectives":[{{"name":"Objective Name","description":"what to measure","kpi":"kpi_name","target_direction":"minimize","collection_point":"when measured","time_horizon":"e.g. annual or Q1 2025"}}]}}
target_direction: minimize or maximize. time_horizon: derive from the document context."""
            },
            {
                "role": "user",
                "content": f"Define objectives.\nDoc context: {doc_text[:3000]}"
            },
        ]
        result = await self.llm.chat_json(messages, temperature=0.2, max_tokens=800)
        return [ObjectiveSpec(**obj) for obj in result.get("objectives", [])]
