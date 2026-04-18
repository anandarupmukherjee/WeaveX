"""
Rule Engine — Executes distilled rules without LLM calls.

Evaluates conditions against world state, fires matching rules,
computes KPIs via extracted formulas. Millisecond rounds.
"""

import random
from datetime import datetime


def evaluate_condition(condition: dict, world_state: dict, kpi_values: dict) -> bool:
    """Evaluate a rule condition against current state."""
    cond_type = condition.get("type", "always")

    if cond_type == "always":
        return True

    if cond_type == "random":
        return random.random() < condition.get("value", 0.5)

    field = condition.get("field", "")
    operator = condition.get("operator", "any")
    value = condition.get("value")

    # Look up the field value from world_state or kpi_values
    actual = world_state.get(field, kpi_values.get(field))
    if actual is None:
        return cond_type == "event" and field in world_state

    try:
        actual_num = float(actual) if not isinstance(actual, (int, float)) else actual
        value_num = float(value) if value is not None else 0
    except (ValueError, TypeError):
        actual_num = 0
        value_num = 0

    if operator == "gt":
        return actual_num > value_num
    elif operator == "lt":
        return actual_num < value_num
    elif operator == "eq":
        return str(actual) == str(value)
    elif operator == "contains":
        return str(value).lower() in str(actual).lower()
    elif operator == "any":
        return actual is not None

    return False


def apply_effects(effects: list[dict], world_state: dict):
    """Apply rule effects to world state."""
    for effect in effects:
        target = effect.get("target", "")
        operation = effect.get("operation", "set")
        value = effect.get("value", "")

        if operation == "set":
            world_state[target] = value
        elif operation == "add":
            try:
                current = float(world_state.get(target, 0))
                world_state[target] = str(current + float(value))
            except (ValueError, TypeError):
                world_state[target] = value
        elif operation == "multiply":
            try:
                current = float(world_state.get(target, 1))
                world_state[target] = str(current * float(value))
            except (ValueError, TypeError):
                pass


def compute_kpi(formula: dict, world_state: dict, round_num: int, prev_value: float | None) -> float:
    """Compute a KPI value from a formula."""
    formula_type = formula.get("formula_type", "weighted_sum")
    base = float(formula.get("base_value", 50.0))
    noise = float(formula.get("noise", 2.0))
    inputs = formula.get("inputs", [])
    weights = formula.get("weights", [])

    if formula_type == "weighted_sum":
        total = base
        for i, inp in enumerate(inputs):
            val = world_state.get(inp)
            if val is not None:
                try:
                    w = weights[i] if i < len(weights) else 1.0
                    total += float(val) * float(w)
                except (ValueError, TypeError):
                    pass
        return total + random.uniform(-noise, noise)

    elif formula_type == "trend":
        # Continue from previous value with small random walk
        drift_bias = float(formula.get("_drift", 0))
        if prev_value is not None:
            drift = random.uniform(-noise, noise) + drift_bias * 0.5
            # Check if any inputs changed
            for inp in inputs:
                if inp in world_state:
                    drift += random.uniform(-1, 1)
            return prev_value + drift
        return base + random.uniform(-noise, noise)

    elif formula_type == "average":
        vals = []
        for inp in inputs:
            v = world_state.get(inp)
            if v is not None:
                try:
                    vals.append(float(v))
                except (ValueError, TypeError):
                    pass
        if vals:
            return sum(vals) / len(vals) + random.uniform(-noise, noise)
        return base + random.uniform(-noise, noise)

    return base + random.uniform(-noise, noise)


class RuleEngine:
    """Lightweight simulation engine that runs distilled rules without LLM."""

    def __init__(self, package: dict):
        self.twin_spec = package["twin_spec"]
        self.rules_data = package.get("distilled_rules", {})
        self.agent_rules = self.rules_data.get("agent_rules", [])
        self.kpi_formulas = self.rules_data.get("kpi_formulas", [])
        self.initial_world_state = self.rules_data.get("initial_world_state", {})

        # Build agent lookup
        self.agents = self.twin_spec.get("agents", [])
        self.objectives = self.twin_spec.get("objectives", [])
        self.agent_by_name = {a["name"]: a for a in self.agents}

        # Build rules lookup by agent name
        self.rules_by_agent: dict[str, list[dict]] = {}
        for ar in self.agent_rules:
            name = ar.get("agent_name", "")
            self.rules_by_agent[name] = ar.get("rules", [])

        # Auto-generate fallback rules if distillation returned empty
        if not self.agent_rules:
            self._generate_fallback_rules()
        if not self.kpi_formulas:
            self._generate_fallback_kpi_formulas()

    def _generate_fallback_rules(self):
        """Generate basic rules from agent spec when distillation is empty."""
        for agent in self.agents:
            name = agent["name"]
            goals = agent.get("goals", [])
            beh = agent.get("behaviour", {})
            activity = beh.get("activity_level", 0.5)
            risk = beh.get("risk_tolerance", 0.5)

            rules = []
            for i, goal in enumerate(goals[:3]):
                # Create a rule per goal
                rules.append({
                    "id": f"auto_{i}",
                    "description": goal[:80],
                    "condition": {"type": "random", "value": min(0.95, activity + 0.2)},
                    "action": f"{name} works towards: {goal[:60]}",
                    "effects": [{"target": f"{name}_progress", "operation": "add", "value": str(round(random.uniform(0.5, 2.0), 1))}],
                    "probability": min(0.95, activity + 0.1),
                })

            # Risk-based disruption rule
            if risk > 0.5:
                rules.append({
                    "id": "auto_risk",
                    "description": "Takes a bold strategic move",
                    "condition": {"type": "random", "value": risk * 0.3},
                    "action": f"{name} takes a calculated risk to accelerate progress.",
                    "effects": [{"target": f"{name}_impact", "operation": "set", "value": "high"}],
                    "probability": risk * 0.4,
                })

            self.rules_by_agent[name] = rules

    def _generate_fallback_kpi_formulas(self):
        """Generate trend-based KPI formulas from historical data or objectives."""
        kpi_hist = self.twin_spec.get("_kpi_history") or {}

        for obj in self.objectives:
            kpi = obj.get("kpi", "")
            direction = obj.get("target_direction", "maximize")

            # Use historical data if available
            hist = kpi_hist.get(kpi, [])
            base = hist[0] if hist else 50.0
            noise = 3.0

            # Drift towards improvement
            drift_dir = 1.0 if direction == "maximize" else -1.0

            self.kpi_formulas.append({
                "kpi": kpi,
                "formula_type": "trend",
                "inputs": [],
                "weights": [],
                "base_value": base,
                "noise": noise,
                "_drift": drift_dir,
            })

    def run(self, rounds: int = 10, scenario_events: dict[int, str] | None = None) -> dict:
        """
        Run the simulation for N rounds. Returns event log, KPI history, world state.
        scenario_events: {round_number: "event description"} for injecting scenarios.
        """
        world_state = dict(self.initial_world_state)
        kpi_history: dict[str, list[float]] = {o["kpi"]: [] for o in self.objectives}
        event_log: list[dict] = []
        scenario_events = scenario_events or {}

        event_log.append({
            "type": "sim_started",
            "total_rounds": rounds,
            "ts": datetime.utcnow().isoformat(),
        })

        for rnd in range(1, rounds + 1):
            event_log.append({"type": "round_start", "round": rnd, "ts": datetime.utcnow().isoformat()})

            # Inject scenario if present
            if rnd in scenario_events:
                world_state["injected_event"] = scenario_events[rnd]
                event_log.append({
                    "type": "scenario_injected",
                    "round": rnd,
                    "event": scenario_events[rnd],
                    "ts": datetime.utcnow().isoformat(),
                })

            # Current KPI values for condition evaluation
            current_kpis = {
                kpi: vals[-1] if vals else 50.0
                for kpi, vals in kpi_history.items()
            }

            # Each agent evaluates rules
            for agent in self.agents:
                agent_name = agent["name"]
                rules = self.rules_by_agent.get(agent_name, [])

                fired_action = None
                for rule in rules:
                    # Check probability
                    prob = rule.get("probability", 1.0)
                    if random.random() > prob:
                        continue

                    condition = rule.get("condition", {"type": "always"})
                    if evaluate_condition(condition, world_state, current_kpis):
                        fired_action = rule
                        break

                if fired_action:
                    # Apply effects
                    apply_effects(fired_action.get("effects", []), world_state)
                    event_log.append({
                        "type": "agent_action",
                        "round": rnd,
                        "agent_id": agent.get("id", ""),
                        "agent_name": agent_name,
                        "entity_type": agent.get("entity_type", ""),
                        "action": fired_action.get("action", "Took action"),
                        "reasoning": fired_action.get("description", ""),
                        "effects": [e.get("target", "") for e in fired_action.get("effects", [])],
                        "rule_id": fired_action.get("id", ""),
                        "ts": datetime.utcnow().isoformat(),
                    })
                else:
                    event_log.append({
                        "type": "agent_action",
                        "round": rnd,
                        "agent_id": agent.get("id", ""),
                        "agent_name": agent_name,
                        "entity_type": agent.get("entity_type", ""),
                        "action": f"{agent_name} maintains current operations.",
                        "reasoning": "No matching rule triggered.",
                        "effects": [],
                        "rule_id": None,
                        "ts": datetime.utcnow().isoformat(),
                    })

            # Compute KPIs
            kpi_values = {}
            for formula in self.kpi_formulas:
                kpi_name = formula.get("kpi", "")
                prev = kpi_history[kpi_name][-1] if kpi_name in kpi_history and kpi_history[kpi_name] else None
                val = compute_kpi(formula, world_state, rnd, prev)
                kpi_values[kpi_name] = round(val, 2)
                if kpi_name in kpi_history:
                    kpi_history[kpi_name].append(val)

            event_log.append({
                "type": "kpi_update",
                "round": rnd,
                "kpis": kpi_values,
                "ts": datetime.utcnow().isoformat(),
            })

            # Clear injected event after it's been processed
            world_state.pop("injected_event", None)

            event_log.append({
                "type": "round_complete",
                "round": rnd,
                "ts": datetime.utcnow().isoformat(),
            })

        event_log.append({
            "type": "sim_complete",
            "rounds_run": rounds,
            "ts": datetime.utcnow().isoformat(),
        })

        return {
            "event_log": event_log,
            "kpi_history": kpi_history,
            "world_state": world_state,
        }
