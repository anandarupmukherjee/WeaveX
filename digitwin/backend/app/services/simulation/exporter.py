"""
Standalone Twin Exporter — Generates a self-contained Docker package.

Produces a .tar.gz containing:
- standalone FastAPI app with rule engine (no LLM needed)
- built React frontend
- twin_spec + distilled rules as data
- Dockerfile + docker-compose.yml
- requirements.txt

User just runs: docker compose up → opens localhost:8080
"""

import io
import json
import tarfile
import textwrap

import structlog

logger = structlog.get_logger()


def build_export_archive(package: dict) -> bytes:
    """Build a .tar.gz archive containing the standalone digital twin."""

    buf = io.BytesIO()
    meta = package.get("metadata", {})
    domain = meta.get("domain", "digital_twin")
    domain_label = domain.replace("_", " ").title()

    with tarfile.open(fileobj=buf, mode="w:gz") as tar:

        def add_file(name: str, content: str):
            data = content.encode("utf-8")
            info = tarfile.TarInfo(name=f"twin-{domain}/{name}")
            info.size = len(data)
            tar.addfile(info, io.BytesIO(data))

        # --- Data ---
        add_file("data/package.json", json.dumps(package, indent=2, default=str))

        # --- Rule Engine (copied) ---
        add_file("engine/rule_engine.py", _RULE_ENGINE_SRC)

        # --- Backend App ---
        add_file("app.py", _build_backend(domain_label))

        # --- Frontend ---
        add_file("static/index.html", _build_frontend(domain_label, package))

        # --- Dockerfile ---
        add_file("Dockerfile", textwrap.dedent("""\
            FROM python:3.12-slim
            WORKDIR /app
            COPY requirements.txt .
            RUN pip install --no-cache-dir -r requirements.txt
            COPY . .
            EXPOSE 8080
            CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "8080"]
        """))

        # --- docker-compose.yml ---
        add_file("docker-compose.yml", textwrap.dedent(f"""\
            services:
              twin:
                build: .
                ports:
                  - "8080:8080"
                restart: unless-stopped
        """))

        # --- requirements.txt ---
        add_file("requirements.txt", textwrap.dedent("""\
            fastapi==0.115.12
            uvicorn[standard]==0.34.2
        """))

        # --- README ---
        add_file("README.md", textwrap.dedent(f"""\
            # {domain_label} — Standalone Digital Twin

            Self-contained simulation exported from WeaveX.
            Runs without any LLM — uses distilled rules from the original simulation.

            ## Quick Start

            ```bash
            docker compose up --build
            ```

            Open http://localhost:8080

            ## Features
            - Adjust agent behaviour parameters
            - Edit/add/remove decision rules
            - Inject scenario events
            - Run instant simulations (milliseconds, no LLM)
            - View KPI charts and analytics

            ## Without Docker

            ```bash
            pip install -r requirements.txt
            uvicorn app:app --port 8080
            ```

            ## Data

            All twin data is in `data/package.json`:
            - `twin_spec`: agents, objectives, interactions, tools
            - `distilled_rules`: agent decision rules + KPI formulas
            - `metadata`: domain info

            Rules are editable JSON — tweak thresholds, add rules, change KPI formulas.
        """))

    buf.seek(0)
    return buf.read()


def _build_backend(domain_label: str) -> str:
    return textwrap.dedent(f'''\
        """Standalone Digital Twin — {domain_label}"""
        import json
        from pathlib import Path
        from fastapi import FastAPI
        from fastapi.staticfiles import StaticFiles
        from fastapi.responses import HTMLResponse, JSONResponse
        from pydantic import BaseModel
        from engine.rule_engine import RuleEngine

        app = FastAPI(title="{domain_label} Twin")

        # Load package
        _pkg = json.loads(Path("data/package.json").read_text())
        _engine = RuleEngine(_pkg)


        class RunRequest(BaseModel):
            rounds: int = 10
            scenario_events: dict[int, str] | None = None
            behaviour_overrides: dict[str, dict] | None = None


        class RuleUpdate(BaseModel):
            agent_name: str
            rules: list[dict]


        @app.get("/api/spec")
        def get_spec():
            return _pkg["twin_spec"]


        @app.get("/api/rules")
        def get_rules():
            return _pkg["distilled_rules"]


        @app.post("/api/rules/update")
        def update_rules(req: RuleUpdate):
            for ar in _pkg["distilled_rules"].get("agent_rules", []):
                if ar["agent_name"] == req.agent_name:
                    ar["rules"] = req.rules
                    break
            else:
                _pkg["distilled_rules"]["agent_rules"].append(
                    {{"agent_name": req.agent_name, "rules": req.rules}}
                )
            # Rebuild engine
            global _engine
            _engine = RuleEngine(_pkg)
            # Persist
            Path("data/package.json").write_text(json.dumps(_pkg, indent=2, default=str))
            return {{"success": True}}


        @app.post("/api/simulate")
        def run_simulation(req: RunRequest):
            # Apply behaviour overrides
            if req.behaviour_overrides:
                for agent in _pkg["twin_spec"]["agents"]:
                    overrides = req.behaviour_overrides.get(agent["id"])
                    if overrides:
                        agent["behaviour"].update(overrides)
                global _engine
                _engine = RuleEngine(_pkg)

            result = _engine.run(
                rounds=req.rounds,
                scenario_events=req.scenario_events,
            )
            return result


        @app.get("/api/metadata")
        def get_metadata():
            return _pkg.get("metadata", {{}})


        # Serve frontend
        app.mount("/static", StaticFiles(directory="static"), name="static")


        @app.get("/")
        def index():
            return HTMLResponse(Path("static/index.html").read_text())
    ''')


def _build_frontend(domain_label: str, package: dict) -> str:
    """Build a self-contained HTML frontend with inline JS."""
    agents_json = json.dumps([
        {"id": a["id"], "name": a["name"], "entity_type": a["entity_type"],
         "goals": a.get("goals", []), "persona": a.get("persona", "")}
        for a in package["twin_spec"].get("agents", [])
    ])
    objectives_json = json.dumps(package["twin_spec"].get("objectives", []))

    return textwrap.dedent(f'''\
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>{domain_label} — Digital Twin</title>
<script src="https://cdn.tailwindcss.com"></script>
<script src="https://cdn.jsdelivr.net/npm/chart.js@4"></script>
<style>
  body {{ background: #09090b; color: #e4e4e7; font-family: system-ui; }}
  .card {{ background: #18181b; border: 1px solid #27272a; border-radius: 12px; padding: 16px; }}
</style>
</head>
<body class="min-h-screen">

<header class="flex items-center justify-between px-6 py-4 border-b border-zinc-800">
  <div class="flex items-center gap-3">
    <div class="w-8 h-8 rounded-lg bg-indigo-600 flex items-center justify-center text-sm font-bold">DT</div>
    <h1 class="text-lg font-semibold">{domain_label}</h1>
    <span class="text-xs text-zinc-500 ml-2">Standalone Twin</span>
  </div>
  <div class="flex gap-2" id="controls">
    <label class="text-xs text-zinc-400 flex items-center gap-2">
      Rounds: <input type="range" id="roundSlider" min="3" max="50" value="10" class="w-20 accent-indigo-500">
      <span id="roundLabel" class="w-6">10</span>
    </label>
    <input id="scenarioInput" placeholder="Inject scenario at round N: e.g. 5:tariff increase" class="text-xs bg-zinc-800 border border-zinc-700 rounded px-2 py-1 w-64 placeholder-zinc-600">
    <button onclick="runSim()" class="px-4 py-1.5 bg-indigo-600 hover:bg-indigo-500 rounded-lg text-sm font-medium transition-colors" id="runBtn">Run</button>
  </div>
</header>

<main class="flex h-[calc(100vh-65px)]">
  <!-- Left: KPI Charts -->
  <div class="w-1/3 border-r border-zinc-800 overflow-y-auto p-4 space-y-4" id="kpiPanel">
    <p class="text-xs text-zinc-500">Run simulation to see KPI trends</p>
  </div>

  <!-- Center: Agent cards -->
  <div class="flex-1 overflow-y-auto p-4">
    <div class="grid grid-cols-2 lg:grid-cols-3 gap-3" id="agentGrid"></div>
    <div id="eventFeed" class="mt-4 space-y-1"></div>
  </div>

  <!-- Right: Rules editor -->
  <div class="w-80 border-l border-zinc-800 overflow-y-auto p-4" id="rulesPanel">
    <h3 class="text-sm font-semibold mb-3">Decision Rules</h3>
    <p class="text-xs text-zinc-500">Select an agent to view/edit rules</p>
  </div>
</main>

<script>
const agents = {agents_json};
const objectives = {objectives_json};
let currentRules = null;
let selectedAgent = null;

// Render agent cards
const grid = document.getElementById('agentGrid');
agents.forEach(a => {{
  const card = document.createElement('div');
  card.className = 'card cursor-pointer hover:border-indigo-600 transition-colors';
  card.id = 'agent-' + a.id;
  card.innerHTML = `
    <div class="text-[10px] text-indigo-400 font-medium mb-1">${{a.entity_type}}</div>
    <div class="text-sm font-semibold truncate">${{a.name}}</div>
    <div class="text-[10px] text-zinc-500 mt-1">${{a.goals.length}} goals</div>
  `;
  card.onclick = () => selectAgent(a);
  grid.appendChild(card);
}});

document.getElementById('roundSlider').oninput = (e) => {{
  document.getElementById('roundLabel').textContent = e.target.value;
}};

async function selectAgent(agent) {{
  selectedAgent = agent;
  document.querySelectorAll('#agentGrid .card').forEach(c => c.style.borderColor = '#27272a');
  document.getElementById('agent-' + agent.id).style.borderColor = '#6366f1';

  if (!currentRules) {{
    const res = await fetch('/api/rules');
    currentRules = await res.json();
  }}

  const agentRules = currentRules.agent_rules?.find(ar => ar.agent_name === agent.name);
  const panel = document.getElementById('rulesPanel');
  panel.innerHTML = `
    <h3 class="text-sm font-semibold mb-1">${{agent.name}}</h3>
    <p class="text-xs text-zinc-400 mb-3">${{agent.persona || agent.entity_type}}</p>
    <h4 class="text-xs font-semibold text-zinc-400 mb-2">Rules</h4>
    <div class="space-y-2" id="rulesList"></div>
    <button onclick="addRule()" class="mt-3 text-xs px-3 py-1.5 bg-zinc-800 hover:bg-zinc-700 rounded transition-colors w-full">+ Add Rule</button>
  `;

  const rulesList = document.getElementById('rulesList');
  (agentRules?.rules || []).forEach((rule, i) => {{
    const div = document.createElement('div');
    div.className = 'card text-xs space-y-1';
    div.innerHTML = `
      <div class="flex justify-between items-center">
        <span class="font-medium text-zinc-200">${{rule.description || rule.id}}</span>
        <button onclick="deleteRule(${{i}})" class="text-red-400 hover:text-red-300 text-[10px]">delete</button>
      </div>
      <div class="text-zinc-500">Condition: ${{rule.condition?.type}} ${{rule.condition?.field || ''}} ${{rule.condition?.operator || ''}} ${{rule.condition?.value ?? ''}}</div>
      <div class="text-zinc-400">Action: ${{rule.action}}</div>
      <div class="text-zinc-500">Probability: ${{(rule.probability * 100).toFixed(0)}}%</div>
    `;
    rulesList.appendChild(div);
  }});
}}

async function deleteRule(index) {{
  if (!selectedAgent || !currentRules) return;
  const ar = currentRules.agent_rules?.find(a => a.agent_name === selectedAgent.name);
  if (ar) {{
    ar.rules.splice(index, 1);
    await fetch('/api/rules/update', {{
      method: 'POST', headers: {{'Content-Type': 'application/json'}},
      body: JSON.stringify({{ agent_name: selectedAgent.name, rules: ar.rules }})
    }});
    selectAgent(selectedAgent);
  }}
}}

async function addRule() {{
  if (!selectedAgent || !currentRules) return;
  let ar = currentRules.agent_rules?.find(a => a.agent_name === selectedAgent.name);
  if (!ar) {{
    ar = {{ agent_name: selectedAgent.name, rules: [] }};
    currentRules.agent_rules.push(ar);
  }}
  ar.rules.push({{
    id: 'rule_new_' + Date.now(),
    description: 'New rule',
    condition: {{ type: 'always' }},
    action: 'Takes default action',
    effects: [],
    probability: 0.8
  }});
  await fetch('/api/rules/update', {{
    method: 'POST', headers: {{'Content-Type': 'application/json'}},
    body: JSON.stringify({{ agent_name: selectedAgent.name, rules: ar.rules }})
  }});
  selectAgent(selectedAgent);
}}

async function runSim() {{
  const btn = document.getElementById('runBtn');
  btn.textContent = 'Running...';
  btn.disabled = true;

  const rounds = parseInt(document.getElementById('roundSlider').value);
  const scenarioRaw = document.getElementById('scenarioInput').value.trim();
  const scenarioEvents = {{}};
  if (scenarioRaw) {{
    scenarioRaw.split(',').forEach(s => {{
      const [r, ...desc] = s.trim().split(':');
      if (r && desc.length) scenarioEvents[parseInt(r)] = desc.join(':').trim();
    }});
  }}

  try {{
    const res = await fetch('/api/simulate', {{
      method: 'POST', headers: {{'Content-Type': 'application/json'}},
      body: JSON.stringify({{ rounds, scenario_events: Object.keys(scenarioEvents).length ? scenarioEvents : null }})
    }});
    const data = await res.json();
    renderResults(data, rounds);
  }} catch(e) {{
    console.error(e);
  }}

  btn.textContent = 'Run';
  btn.disabled = false;
}}

function renderResults(data, rounds) {{
  // KPI charts
  const panel = document.getElementById('kpiPanel');
  panel.innerHTML = '<p class="text-xs font-semibold text-zinc-400 mb-3">KPI Trends</p>';

  const colors = ['#6366f1','#10b981','#f59e0b','#ec4899','#06b6d4'];
  objectives.forEach((obj, oi) => {{
    const vals = data.kpi_history[obj.kpi];
    if (!vals || !vals.length) return;

    const wrapper = document.createElement('div');
    wrapper.className = 'card mb-3';
    const first = vals[0], last = vals[vals.length-1], delta = last - first;
    const better = obj.target_direction === 'minimize' ? delta < 0 : delta > 0;
    wrapper.innerHTML = `
      <div class="flex justify-between items-center mb-2">
        <span class="text-xs text-zinc-300">${{obj.name}}</span>
        <span class="text-xs font-mono ${{better ? 'text-green-400' : 'text-red-400'}}">${{last.toFixed(1)}} ${{delta >= 0 ? '\\u25B2' : '\\u25BC'}}${{Math.abs(delta).toFixed(1)}}</span>
      </div>
      <canvas id="kpi-${{oi}}" height="60"></canvas>
    `;
    panel.appendChild(wrapper);

    new Chart(document.getElementById('kpi-'+oi), {{
      type: 'line',
      data: {{
        labels: vals.map((_,i) => 'R'+(i+1)),
        datasets: [{{ data: vals, borderColor: colors[oi % colors.length], borderWidth: 2, pointRadius: 0, tension: 0.3 }}]
      }},
      options: {{
        plugins: {{ legend: {{ display: false }} }},
        scales: {{
          x: {{ ticks: {{ font: {{ size: 9 }}, color: '#52525b' }}, grid: {{ color: '#27272a' }} }},
          y: {{ ticks: {{ font: {{ size: 9 }}, color: '#52525b' }}, grid: {{ color: '#27272a' }} }}
        }}
      }}
    }});
  }});

  // Event feed — last 20 agent actions
  const feed = document.getElementById('eventFeed');
  feed.innerHTML = '<p class="text-xs font-semibold text-zinc-400 mb-2">Recent Actions</p>';
  const actions = data.event_log.filter(e => e.type === 'agent_action').slice(-20).reverse();
  actions.forEach(ev => {{
    const div = document.createElement('div');
    div.className = 'card text-xs py-2 px-3';
    div.innerHTML = `
      <div class="flex gap-2 items-center mb-0.5">
        <span class="w-1.5 h-1.5 rounded-full bg-indigo-400"></span>
        <span class="font-medium">${{ev.agent_name}}</span>
        <span class="text-zinc-600 ml-auto">R${{ev.round}}</span>
      </div>
      <div class="text-zinc-400">${{ev.action}}</div>
    `;
    feed.appendChild(div);
  }});

  // Flash agent cards that acted in last round
  const lastRound = data.event_log.filter(e => e.type === 'agent_action').pop()?.round;
  data.event_log.filter(e => e.type === 'agent_action' && e.round === lastRound).forEach(ev => {{
    const card = document.getElementById('agent-' + ev.agent_id);
    if (card) {{
      card.style.borderColor = '#3b82f6';
      setTimeout(() => card.style.borderColor = '#27272a', 2000);
    }}
  }});
}}
</script>
</body>
</html>
    ''')


# Inline the rule_engine source so the standalone package is self-contained
_RULE_ENGINE_SRC = open(
    __file__.replace("exporter.py", "rule_engine.py")
).read() if __file__ else ""

# Fallback: read at import time
import os as _os
_re_path = _os.path.join(_os.path.dirname(__file__), "rule_engine.py")
if _os.path.exists(_re_path):
    _RULE_ENGINE_SRC = open(_re_path).read()
