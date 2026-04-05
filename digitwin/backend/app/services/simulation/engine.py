"""
Simulation Engine — LLM-driven multi-agent simulation.

Each round:
1. Build a shared world state summary
2. For each active agent, ask the LLM: "given the world state and your persona, what do you do?"
3. Collect all actions, update world state
4. Compute KPI metrics
5. Broadcast events to WebSocket clients
"""

import asyncio
import uuid
from datetime import datetime
from typing import Callable

import structlog

from ...models.twin_spec import AgentSpec, ObjectiveSpec, TwinSpec
from ...utils.llm_client import OllamaClient

logger = structlog.get_logger()


class SimulationEngine:
    def __init__(
        self,
        sim_id: str,
        twin_spec: TwinSpec,
        rounds: int = 10,
        on_event: Callable[[dict], None] | None = None,
    ):
        self.sim_id = sim_id
        self.twin_spec = twin_spec
        self.rounds = rounds
        self.on_event = on_event  # async callback for streaming events
        self.llm = OllamaClient()

        # World state — starts empty, agents write to it
        self.world_state: dict[str, str] = {}
        self.round_num = 0
        self.running = False
        self.paused = False

        # KPI tracking: {kpi_name: [value_per_round]}
        self.kpi_history: dict[str, list[float]] = {
            obj.kpi: [] for obj in twin_spec.objectives
        }

        # Agent-level event log
        self.event_log: list[dict] = []

        # Build agent name→id lookup
        self.agent_by_id = {a.id: a for a in twin_spec.agents}
        self.agent_by_name = {a.name: a for a in twin_spec.agents}

    async def run(self):
        self.running = True
        await self._emit({"type": "sim_started", "sim_id": self.sim_id, "total_rounds": self.rounds})

        for rnd in range(1, self.rounds + 1):
            if not self.running:
                break

            # Pause support
            while self.paused and self.running:
                await asyncio.sleep(0.5)

            self.round_num = rnd
            await self._emit({"type": "round_start", "round": rnd, "total": self.rounds})

            # Each agent acts
            actions = []
            for agent in self.twin_spec.agents:
                if not self.running:
                    break
                action = await self._agent_act(agent, rnd)
                actions.append(action)
                await self._emit({
                    "type": "agent_action",
                    "round": rnd,
                    "agent_id": agent.id,
                    "agent_name": agent.name,
                    "entity_type": agent.entity_type,
                    "action": action["action"],
                    "reasoning": action["reasoning"],
                    "effects": action["effects"],
                    "tools_used": action.get("tools_used", []),
                })

            # Update world state from this round's actions
            for action in actions:
                for k, v in action.get("state_updates", {}).items():
                    self.world_state[k] = v

            # Compute KPIs
            kpis = await self._compute_kpis(rnd, actions)
            await self._emit({"type": "kpi_update", "round": rnd, "kpis": kpis})

            await self._emit({"type": "round_complete", "round": rnd, "world_state": self.world_state})

            # Small delay between rounds so frontend can render
            await asyncio.sleep(0.3)

        self.running = False
        # Generate insights
        insights = await self._generate_insights()
        await self._emit({
            "type": "sim_complete",
            "sim_id": self.sim_id,
            "rounds_run": self.round_num,
            "insights": insights,
        })

    async def inject_scenario(self, event_description: str):
        """Inject an external event into the world state mid-simulation."""
        self.world_state["injected_event"] = event_description
        await self._emit({
            "type": "scenario_injected",
            "round": self.round_num,
            "event": event_description,
        })
        logger.info("Scenario injected", event=event_description)

    def pause(self):
        self.paused = True

    def resume(self):
        self.paused = False

    def stop(self):
        self.running = False

    # ----------------------------------------------------------------
    # Internal helpers
    # ----------------------------------------------------------------

    async def _agent_act(self, agent: AgentSpec, round_num: int) -> dict:
        """Ask the LLM what this agent does this round."""
        # Build context about this agent's relationships
        related = []
        for rel in agent.relationships[:3]:
            peer = self.agent_by_id.get(rel.target_agent_id)
            if peer:
                related.append(f"{peer.name} ({rel.relation_type})")

        world_summary = "\n".join(
            f"- {k}: {v}" for k, v in list(self.world_state.items())[-8:]
        ) or "No events yet — simulation just started."

        system = f"""You are simulating an agent in a {self.twin_spec.intent.domain} digital twin.
Agent: {agent.name} ({agent.entity_type})
Persona: {agent.persona}
Goals: {', '.join(agent.goals[:2])}
Constraints: {', '.join(agent.constraints[:2])}
Activity level: {agent.behaviour.activity_level:.1f}, Risk tolerance: {agent.behaviour.risk_tolerance:.1f}

Respond with ONLY this JSON:
{{"action":"what the agent does this round in 1-2 sentences","reasoning":"why (1 sentence)","effects":["effect on world1","effect on world2"],"tools_used":["tool_name"],"state_updates":{{"key":"value"}}}}"""

        user = f"""Round {round_num} of {self.rounds}.
Related agents: {', '.join(related) or 'none'}

Current world state:
{world_summary}

What does {agent.name} do this round?"""

        try:
            result = await self.llm.chat_json(
                [{"role": "system", "content": system}, {"role": "user", "content": user}],
                temperature=0.7,
                max_tokens=400,
            )
            result["agent_id"] = agent.id
            return result
        except Exception as e:
            logger.warning("Agent action failed", agent=agent.name, error=str(e))
            return {
                "agent_id": agent.id,
                "action": f"{agent.name} maintains current operations.",
                "reasoning": "No significant change this round.",
                "effects": [],
                "tools_used": [],
                "state_updates": {},
            }

    async def _compute_kpis(self, round_num: int, actions: list[dict]) -> dict:
        """Use LLM to estimate KPI values from this round's actions."""
        if not self.twin_spec.objectives:
            return {}

        obj_list = "\n".join(
            f"- {o.kpi}: {o.description} ({o.target_direction})"
            for o in self.twin_spec.objectives
        )
        actions_summary = "\n".join(
            f"- {a.get('agent_id','?')}: {a.get('action','')}" for a in actions[:5]
        )

        system = f"""Estimate KPI values for a {self.twin_spec.intent.domain} simulation round.
KPIs to estimate:
{obj_list}

Respond with ONLY JSON: {{"kpi_name": numeric_value}}
Values should be realistic for the domain. Use 0-100 scale unless the KPI implies otherwise."""

        user = f"Round {round_num}. Actions this round:\n{actions_summary}"

        try:
            result = await self.llm.chat_json(
                [{"role": "system", "content": system}, {"role": "user", "content": user}],
                temperature=0.3,
                max_tokens=200,
            )
            # Store history
            for kpi, val in result.items():
                if kpi not in self.kpi_history:
                    self.kpi_history[kpi] = []
                if isinstance(val, (int, float)):
                    self.kpi_history[kpi].append(float(val))
            return result
        except Exception:
            return {}

    async def _generate_insights(self) -> dict:
        """Ask the LLM for recommendations, trends, and outlook from the simulation."""
        kpi_summary = "\n".join(
            f"- {k}: {vals[0]:.1f} → {vals[-1]:.1f} ({'improved' if vals[-1] < vals[0] else 'worsened'})"
            for k, vals in self.kpi_history.items() if len(vals) >= 2
        ) or "No KPI data."

        agent_actions = "\n".join(
            f"- {e.get('agent_name','?')}: {e.get('action','')}"
            for e in self.event_log
            if e.get("type") == "agent_action"
        )[-2000:]  # last 2000 chars

        world_final = "\n".join(f"- {k}: {v}" for k, v in self.world_state.items()) or "No state changes."

        system = f"""You are an expert analyst reviewing a completed {self.twin_spec.intent.domain} simulation.
Respond with ONLY this JSON:
{{"summary":"2-3 sentence overview of what happened","trends":["trend1","trend2","trend3"],"recommendations":[{{"title":"short title","detail":"1-2 sentence actionable recommendation","priority":"high|medium|low"}}],"outlook":"2 sentence forward-looking statement"}}
Provide 3-5 trends and 3-4 recommendations."""

        user = f"""Simulation ran for {self.round_num} rounds.

KPI changes:
{kpi_summary}

Final world state:
{world_final}

Key agent actions (sample):
{agent_actions[:1500]}

Provide analysis, trends, recommendations, and outlook."""

        try:
            result = await self.llm.chat_json(
                [{"role": "system", "content": system}, {"role": "user", "content": user}],
                temperature=0.4,
                max_tokens=800,
            )
            return result
        except Exception as e:
            logger.warning("Insights generation failed", error=str(e))
            return {
                "summary": "Simulation completed.",
                "trends": [],
                "recommendations": [],
                "outlook": "Review the event log for details.",
            }

    async def _emit(self, event: dict):
        event["ts"] = datetime.utcnow().isoformat()
        self.event_log.append(event)
        if self.on_event:
            await self.on_event(event)
