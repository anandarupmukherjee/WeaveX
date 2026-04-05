# DigiTwin — VS Code build instructions (step by step)

## What you're building

A platform where you upload reference PDFs/docs, an LLM (Gemma 4 running locally
on Ollama) analyses them to extract domain, roles, relationships, interactions,
agents, optimisation targets, and tools — then assembles a digital twin with a
drag-and-drop visual canvas for playing with agent behaviours.

**Stack:** FastAPI (Python) + React + React Flow + Tailwind + Ollama + Neo4j + Redis

---

## Step 0 — Install prerequisites

### 0a. Install Ollama and pull Gemma 4

```bash
# macOS / Linux
curl -fsSL https://ollama.com/install.sh | sh

# Windows — download installer from https://ollama.com/download

# Pull Gemma 4 (choose ONE based on your hardware)
ollama pull gemma4:26b     # 18GB — recommended, best quality for extraction
ollama pull gemma4          # 9.6GB — default E4B, works on 12GB+ RAM
ollama pull gemma4:e2b      # 7.2GB — lightest, 8GB RAM minimum

# Verify
ollama list
# Should show: gemma4:26b    <hash>    18 GB

# Quick test
ollama run gemma4:26b "What are you?"
# Should respond identifying itself as Gemma
```

Ollama runs a server on `http://localhost:11434` automatically. It also exposes
an OpenAI-compatible API at `http://localhost:11434/v1` — this is what our
backend uses, so you can swap to any OpenAI-compatible provider later.

### 0b. Install Docker (for Neo4j and Redis)

Download from https://docker.com and ensure `docker compose` works:

```bash
docker compose version
# Docker Compose version v2.x.x
```

### 0c. Install Python 3.11+ and Node.js 20+

```bash
python3 --version   # Should be 3.11+
node --version      # Should be 20+
npm --version       # Should be 10+
```

### 0d. Install VS Code extensions

Open VS Code, press `Ctrl+Shift+X`, and install:

- **Python** (ms-python.python)
- **Pylance** (ms-python.vscode-pylance)
- **ESLint** (dbaeumer.vscode-eslint)
- **Prettier** (esbenp.prettier-vscode)
- **Tailwind CSS IntelliSense** (bradlc.vscode-tailwindcss)
- **Docker** (ms-azuretools.vscode-docker)
- **Error Lens** (usernamehw.errorlens) — shows errors inline

Or just open the project folder — VS Code will prompt to install recommended
extensions from `.vscode/extensions.json`.

---

## Step 1 — Set up the project

### 1a. Unzip and open in VS Code

```bash
unzip digitwin-scaffold.zip
cd digitwin
code .
```

### 1b. Start infrastructure

Open a terminal in VS Code (`Ctrl+`` `) and run:

```bash
docker compose up -d
```

This starts Neo4j (graph database) and Redis (cache + pub/sub). Verify:

```bash
# Neo4j browser — should load a login page
open http://localhost:7474
# Login: neo4j / digitwin_dev

# Redis — should respond PONG
docker exec -it digitwin-redis-1 redis-cli ping
```

### 1c. Configure environment

```bash
cd backend
cp .env.example .env
```

Edit `.env` if needed. The defaults work for local Ollama. If you pulled
a different model size, update `OLLAMA_MODEL` and `LLM_MODEL`:

```env
OLLAMA_MODEL=gemma4:26b
LLM_MODEL=gemma4:26b
```

---

## Step 2 — Set up the backend

### 2a. Create virtual environment

In VS Code terminal:

```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate     # Linux/macOS
# .venv\Scripts\activate      # Windows PowerShell
```

VS Code should detect the venv and ask to select it as the interpreter. Say yes.
If not, press `Ctrl+Shift+P` → "Python: Select Interpreter" → choose
`./backend/.venv/bin/python`.

### 2b. Install dependencies

```bash
pip install -r requirements.txt
```

This installs FastAPI, the OpenAI client (for Ollama's compatible API),
PyMuPDF (PDF parsing), python-docx, Neo4j driver, ChromaDB, Redis,
Celery, and other dependencies. Takes 2-3 minutes.

### 2c. Run the smoke test

This verifies Ollama is reachable, the model can produce JSON, and
the full 4-pass extraction pipeline works:

```bash
cd ..
python scripts/seed_test.py
```

Expected output (takes 1-3 minutes on first run):

```
STEP 1: Testing Ollama connection
  ✓ Model 'gemma4:26b' is available on Ollama
  ✓ Response: hello

STEP 2: Testing JSON output
  ✓ Got valid JSON: {"name": "example", "count": 42}

STEP 3: Running full extraction pipeline
  [intent] Classifying domain and intent...
  [ontology] Extracting domain ontology...
  [agents] Identifying agents and personas...
  [interactions] Mapping interaction protocols...
  [tools] Assigning tools and objectives...

  ✓ EXTRACTION COMPLETE
    Domain:       hospital_emergency
    Agents:       12
    Interactions: 7
    Tools:        15
    Objectives:   4

✅ ALL TESTS PASSED
```

If the model struggles with JSON output, try the 26b or 31b variant.
The E4B (default) works but may occasionally produce malformed JSON
that triggers a retry.

### 2d. Start the backend

```bash
cd backend
source .venv/bin/activate
uvicorn app.main:app --reload --port 5001
```

Or use the VS Code debugger: press `F5` and select "Backend: FastAPI".
This gives you breakpoints and variable inspection.

Verify:

```bash
curl http://localhost:5001/health
# {"status":"ok","model":"gemma4:26b","ollama":"http://localhost:11434"}
```

---

## Step 3 — Set up the frontend

Open a **second terminal** in VS Code (`Ctrl+Shift+`` `):

```bash
cd frontend
npm install
npm run dev
```

Output:

```
  VITE v6.x.x  ready in 500 ms

  ➜  Local:   http://localhost:5173/
  ➜  Network: http://192.168.x.x:5173/
```

The Vite dev server proxies `/api/*` to the backend at `:5001` and
`/ws/*` for WebSocket connections — no CORS issues in development.

Open **http://localhost:5173** in your browser.

---

## Step 4 — Test the full flow

1. **Upload panel** — drag-drop a PDF or DOCX file (any report will work — an
   operations manual, a business process document, an org chart, etc.)

2. **Describe your intent** — type what you want to model, e.g.:
   > "I want to simulate this hospital's emergency department to optimise
   > patient throughput and reduce wait times."

3. **Click "Analyse & build twin"** — the backend runs the 4-pass extraction:
   - Pass 0: Intent classification (domain, model type, targets)
   - Pass 1: Ontology extraction (entity types, relationships)
   - Pass 2: Agent extraction (specific agents with personas)
   - Pass 3: Interaction protocol extraction
   - Pass 4: Tool and objective mapping

   This takes 1-3 minutes with a local Gemma 4 model. The spinner shows progress.

4. **Review phase** — inspect the extracted TwinSpec JSON. Check that the
   agents, relationships, and tools make sense.

5. **Click "Open sandbox"** — the React Flow canvas renders all agents as
   draggable nodes with relationship edges. Click any agent to see the
   detail panel with behaviour tuning sliders.

---

## Step 5 — VS Code development workflow

### Running both backend + frontend together

Use the compound launch config: press `F5` → select **"Full Stack"**. This
starts both the FastAPI backend (with debugger) and the Vite frontend.

### Project layout in VS Code Explorer

```
digitwin/
├── .vscode/           ← Settings, debugger configs, extensions
├── backend/
│   ├── app/
│   │   ├── api/       ← FastAPI route handlers (start here for endpoints)
│   │   ├── services/
│   │   │   ├── extractors/  ← THE CORE: domain_analyser.py is the brain
│   │   │   ├── agents/      ← Agent runtime (milestone 3)
│   │   │   ├── simulation/  ← Sim engine (milestone 3)
│   │   │   └── tools/       ← Tool registry (milestone 2)
│   │   ├── models/    ← Pydantic data models (twin_spec.py)
│   │   └── utils/     ← LLM client, Neo4j client, logging
│   └── .env
├── frontend/
│   └── src/
│       ├── components/
│       │   ├── canvas/   ← React Flow components (TwinCanvas, AgentNode)
│       │   └── panels/   ← Side panels (Upload, AgentDetail, Scenario)
│       ├── stores/       ← Zustand state management
│       ├── api/          ← Backend API client
│       └── types/        ← TypeScript types matching backend models
├── docker-compose.yml    ← Neo4j + Redis
└── scripts/
    └── seed_test.py      ← Pipeline smoke test
```

### Key files to understand first

1. **`backend/app/services/extractors/domain_analyser.py`** — the 4-pass
   LLM extraction pipeline. This is the heart of the system. Read this first.

2. **`backend/app/utils/llm_client.py`** — the Ollama wrapper. Uses the
   OpenAI-compatible API so you can swap providers by changing the base URL.

3. **`backend/app/models/twin_spec.py`** — all data models (IntentSpec,
   Ontology, AgentSpec, TwinSpec, etc.). The frontend types mirror these.

4. **`frontend/src/components/canvas/TwinCanvas.tsx`** — the React Flow
   canvas that converts agents into draggable nodes.

5. **`frontend/src/components/panels/AgentPanel.tsx`** — the agent detail
   panel with behaviour tuning sliders.

### Adding a new extraction pass

To modify what the LLM extracts, edit `domain_analyser.py`:

1. Add a new method like `_extract_something()` following the pattern of
   the existing passes (system prompt + user message → `chat_json()`).
2. Call it from the `analyse()` orchestrator method.
3. Add corresponding data models in `twin_spec.py`.
4. Add matching TypeScript types in `frontend/src/types/index.ts`.

### Adding a new tool type

1. Define the tool in `backend/app/services/tools/` (see `builtin.py` stub).
2. Register it in the tool registry.
3. The domain analyser will automatically reference it if the LLM sees
   a need for it in the uploaded documents.

### Debugging LLM output

If Gemma 4 produces bad JSON or unexpected extractions:

1. Check the structlog output in the backend terminal — it logs all LLM
   requests and responses.
2. Set breakpoints in `domain_analyser.py` at each pass.
3. Inspect `raw` responses before JSON parsing to see what the model
   actually returned.
4. Adjust prompts — the system prompts in each `_extract_*` method are
   the most impactful thing to iterate on.
5. Try a larger model (`gemma4:31b`) if the smaller one struggles.

---

## What to build next (milestones)

### Milestone 2 — Knowledge graph + tool registry (next)

- Wire up Neo4j: after extraction, persist agents and relationships as
  graph nodes/edges. The `graph_client.py` is ready with CRUD methods.
- Build the tool registry in `services/tools/registry.py` — a plugin
  system where tools are registered by domain.
- Implement 5-10 built-in tool types (database_query, api_call,
  communicate, schedule, decide, calculate).

### Milestone 3 — Simulation engine

- Build the simulation loop in `services/simulation/engine.py`.
- Each round: select active agents → execute their actions → update state.
- Agents call tools, interact via protocols, and produce observable events.
- Stream events to the frontend via the WebSocket endpoint.

### Milestone 4 — Visual canvas enhancements

- Drag-drop edge rewiring (React Flow supports this natively).
- Scenario injection panel (`ScenarioPanel.tsx`).
- Live telemetry dashboard with Recharts (`TelemetryPanel.tsx`).
- Agent chat (click an agent → chat with it directly).

### Milestone 5 — Reports + checkpoints

- Build a ReACT report agent (similar to MiroFish's approach).
- Simulation checkpoints and "what if" branching.
- Export reports as PDF/DOCX.

---

## Troubleshooting

### "Ollama model not found"

```bash
ollama list                    # Check what's installed
ollama pull gemma4:26b         # Pull the model
curl http://localhost:11434/api/tags   # Verify API is responding
```

### "LLM did not return valid JSON"

Gemma 4 E4B occasionally wraps JSON in markdown fences. The `chat_json()`
method strips these, but if it still fails:

- Check the raw response in logs
- Add more explicit "JSON only" instructions to the system prompt
- Use `gemma4:26b` or `gemma4:31b` — larger models follow instructions better

### Neo4j connection refused

```bash
docker compose ps              # Check containers are running
docker compose logs neo4j      # Check for errors
docker compose up -d           # Restart if needed
```

### Frontend proxy errors

If API calls fail from the browser, check that the backend is running
on port 5001 and Vite's proxy config in `vite.config.ts` is correct.

### Python import errors

Make sure you're in the virtual environment:

```bash
which python    # Should show .venv/bin/python
source backend/.venv/bin/activate
```
