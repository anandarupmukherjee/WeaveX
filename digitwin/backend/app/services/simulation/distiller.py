"""
Rule Distiller — Converts LLM simulation event logs into parameterized rules.

After a simulation completes, one final LLM call extracts each agent's
decision patterns into structured rules. These rules can be executed by
the RuleEngine without any LLM calls.
"""

import structlog
from ...utils.llm_client import OllamaClient
from ...models.twin_spec import TwinSpec

logger = structlog.get_logger()


async def distill_rules(twin_spec: TwinSpec, event_log: list[dict], kpi_history: dict) -> dict:
    """
    Use LLM to analyze simulation event log and extract parameterized rules.
    Returns a complete distilled simulation package.
    """
    llm = OllamaClient()

    # Build a summary of agent actions grouped by agent
    agent_actions: dict[str, list[str]] = {}
    for ev in event_log:
        if ev.get("type") == "agent_action":
            name = ev.get("agent_name", "?")
            action_str = f"R{ev.get('round', '?')}: {ev.get('action', '')} (effects: {ev.get('effects', [])})"
            agent_actions.setdefault(name, []).append(action_str)

    # Build agent summaries for the prompt
    agent_summaries = []
    for agent in twin_spec.agents:
        actions = agent_actions.get(agent.name, [])
        agent_summaries.append(
            f"Agent: {agent.name} ({agent.entity_type})\n"
            f"  Goals: {', '.join(agent.goals[:3])}\n"
            f"  Actions taken:\n" +
            "\n".join(f"    {a}" for a in actions[:8])
        )

    # KPI summary
    kpi_summary = []
    for kpi, vals in kpi_history.items():
        if len(vals) >= 2:
            kpi_summary.append(f"- {kpi}: {vals[0]:.1f} → {vals[-1]:.1f}")

    # Distill rules via LLM
    system = f"""You are a simulation compiler. Analyze the agent behavior patterns from this {twin_spec.intent.domain} simulation and extract parameterized decision rules.

For each agent, extract 3-6 rules that capture their decision patterns.
Also extract KPI formulas that compute KPI values from world state.

Respond with ONLY this JSON:
{{
  "agent_rules": [
    {{
      "agent_name": "Agent Name",
      "rules": [
        {{
          "id": "rule_1",
          "description": "what this rule does",
          "condition": {{
            "type": "threshold|event|always|random",
            "field": "world_state_key or kpi_name",
            "operator": "gt|lt|eq|contains|any",
            "value": 50
          }},
          "action": "what the agent does",
          "effects": [{{"target": "world_state_key", "operation": "set|add|multiply", "value": "new_value"}}],
          "probability": 0.8
        }}
      ]
    }}
  ],
  "kpi_formulas": [
    {{
      "kpi": "kpi_name",
      "formula_type": "weighted_sum|average|trend",
      "inputs": ["world_state_key1", "world_state_key2"],
      "weights": [0.6, 0.4],
      "base_value": 50.0,
      "noise": 2.0
    }}
  ],
  "initial_world_state": {{"key": "value"}}
}}"""

    user = f"""Simulation: {twin_spec.intent.domain}
Ran for {len(kpi_history.get(list(kpi_history.keys())[0], [])) if kpi_history else 0} rounds.

KPI trends:
{chr(10).join(kpi_summary) or 'No KPI data'}

Agent behavior patterns:
{chr(10).join(agent_summaries[:15])}

Extract parameterized rules that would reproduce this simulation without an LLM."""

    try:
        rules = await llm.chat_json(
            [{"role": "system", "content": system}, {"role": "user", "content": user}],
            temperature=0.2,
            max_tokens=4096,
        )
    except Exception as e:
        logger.error("Rule distillation failed", error=str(e))
        rules = {"agent_rules": [], "kpi_formulas": [], "initial_world_state": {}}

    # Build the complete package — include kpi_history inside twin_spec for fallback formulas
    spec_data = twin_spec.model_dump()
    spec_data["_kpi_history"] = kpi_history
    package = {
        "twin_spec": spec_data,
        "distilled_rules": rules,
        "kpi_history": kpi_history,
        "metadata": {
            "domain": twin_spec.intent.domain,
            "domain_description": twin_spec.intent.domain_description,
            "model_type": twin_spec.intent.model_type,
            "agent_count": len(twin_spec.agents),
            "objective_count": len(twin_spec.objectives),
        },
    }

    logger.info("Rules distilled",
                agent_rules=len(rules.get("agent_rules", [])),
                kpi_formulas=len(rules.get("kpi_formulas", [])))

    return package
