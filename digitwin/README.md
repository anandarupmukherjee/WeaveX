# DigiTwin — AI-Powered Digital Twin Platform

Upload reference documents → LLM extracts domain, roles, relationships, tools →
Digital twin generated with agents and interactions → Visual drag-drop sandbox.

**LLM Backend:** Local Ollama with Gemma 4

---

## Prerequisites

| Tool | Version | Install |
|------|---------|---------|
| **Python** | ≥3.11 | https://python.org |
| **Node.js** | ≥20 | https://nodejs.org |
| **Ollama** | Latest | https://ollama.com/download |
| **Docker** | Latest | https://docker.com (for Neo4j & Redis) |
| **VS Code** | Latest | https://code.visualstudio.com |

### Hardware recommendations

| Gemma 4 variant | VRAM / RAM needed | Best for |
|---|---|---|
| `gemma4:e4b` (default) | 6GB VRAM or 12GB RAM | Dev/testing, lightweight domains |
| `gemma4:26b` | 18GB+ VRAM/RAM | Production extraction, complex domains |
| `gemma4:31b` | 20GB+ VRAM/RAM | Best quality, needs beefy GPU |

---

## Quick Start

### 1. Clone and open in VS Code

```bash
git init digitwin && cd digitwin
# Copy all project files here
code .
```

### 2. Install Ollama and pull Gemma 4

```bash
# Install Ollama (macOS/Linux)
curl -fsSL https://ollama.com/install.sh | sh

# Pull your chosen Gemma 4 variant
ollama pull gemma4:26b          # Recommended: 26B MoE (18GB)
# OR
ollama pull gemma4              # Default: E4B (9.6GB, lighter)

# Verify it's running
ollama list
curl http://localhost:11434/api/tags
```

### 3. Start infrastructure (Neo4j + Redis)

```bash
docker compose up -d
```

This starts:
- **Neo4j** on `bolt://localhost:7687` (browser: http://localhost:7474)
- **Redis** on `localhost:6379`

### 4. Set up the backend

```bash
cd backend

# Create virtual environment
python -m venv .venv
source .venv/bin/activate        # Linux/macOS
# .venv\Scripts\activate         # Windows

# Install dependencies
pip install -r requirements.txt

# Copy env file and configure
cp .env.example .env
# Edit .env — defaults should work for local Ollama

# Run the backend
uvicorn app.main:app --reload --port 5001
```

### 5. Set up the frontend

```bash
cd frontend

npm install
npm run dev
# → http://localhost:5173
```

### 6. Verify everything

```bash
# Test Ollama is reachable
curl http://localhost:11434/api/chat -d '{
  "model": "gemma4:26b",
  "messages": [{"role": "user", "content": "Hello"}],
  "stream": false
}'

# Test backend health
curl http://localhost:5001/health

# Test Neo4j
curl http://localhost:7474

# Open frontend
open http://localhost:5173
```

---

## VS Code Recommended Extensions

Install these from the Extensions panel (Ctrl+Shift+X):

```
# Python
ms-python.python
ms-python.vscode-pylance
ms-python.debugpy

# Frontend
dbaeumer.vscode-eslint
esbenp.prettier-vscode
Vue.volar                        # If using Vue
dsznajder.es7-react-js-snippets # If using React

# Infrastructure
ms-azuretools.vscode-docker
mtxr.sqltools
mechatroner.rainbow-csv

# Productivity
eamodio.gitlens
usernamehw.errorlens
bradlc.vscode-tailwindcss
```

---

## VS Code Workspace Settings

Save as `.vscode/settings.json` in the project root — already included in the scaffold.

---

## Project Structure

```
digitwin/
├── backend/
│   ├── app/
│   │   ├── main.py                    # FastAPI app entry
│   │   ├── config.py                  # Settings & env vars
│   │   ├── api/
│   │   │   ├── projects.py            # Project CRUD endpoints
│   │   │   ├── extraction.py          # Document analysis endpoints
│   │   │   ├── simulation.py          # Sim control endpoints
│   │   │   └── websocket.py           # Real-time sim streaming
│   │   ├── services/
│   │   │   ├── extractors/
│   │   │   │   ├── document_parser.py # PDF/DOCX ingestion
│   │   │   │   ├── domain_analyser.py # Multi-pass LLM extraction
│   │   │   │   ├── ontology_gen.py    # Domain ontology generation
│   │   │   │   └── tool_mapper.py     # Agent tool assignment
│   │   │   ├── agents/
│   │   │   │   ├── agent_factory.py   # Creates agent instances
│   │   │   │   ├── agent_runtime.py   # Agent execution loop
│   │   │   │   └── memory.py          # Agent memory management
│   │   │   ├── simulation/
│   │   │   │   ├── engine.py          # Simulation loop
│   │   │   │   ├── scheduler.py       # Agent activation scheduling
│   │   │   │   └── checkpoint.py      # Save/restore sim state
│   │   │   └── tools/
│   │   │       ├── registry.py        # Tool plugin registry
│   │   │       ├── builtin.py         # Built-in tool implementations
│   │   │       └── domain_tools.py    # Domain-specific tool templates
│   │   ├── models/
│   │   │   ├── project.py             # Project data model
│   │   │   ├── twin_spec.py           # Digital twin specification
│   │   │   └── agent_spec.py          # Agent specification
│   │   └── utils/
│   │       ├── llm_client.py          # Ollama client wrapper
│   │       ├── graph_client.py        # Neo4j client wrapper
│   │       └── logger.py              # Structured logging
│   ├── requirements.txt
│   ├── .env.example
│   └── tests/
├── frontend/
│   ├── src/
│   │   ├── App.tsx
│   │   ├── main.tsx
│   │   ├── components/
│   │   │   ├── canvas/
│   │   │   │   ├── AgentNode.tsx      # React Flow agent node
│   │   │   │   ├── RelationEdge.tsx   # React Flow custom edge
│   │   │   │   └── TwinCanvas.tsx     # Main canvas component
│   │   │   ├── panels/
│   │   │   │   ├── UploadPanel.tsx    # Document upload
│   │   │   │   ├── AgentPanel.tsx     # Agent detail/tuning
│   │   │   │   ├── ScenarioPanel.tsx  # Scenario injection
│   │   │   │   └── TelemetryPanel.tsx # Live KPI dashboard
│   │   │   └── common/
│   │   ├── views/
│   │   ├── stores/
│   │   ├── api/
│   │   └── types/
│   ├── package.json
│   ├── vite.config.ts
│   ├── tailwind.config.js
│   └── tsconfig.json
├── docker-compose.yml
├── .vscode/
│   ├── settings.json
│   ├── launch.json
│   └── extensions.json
├── scripts/
│   └── seed_test.py                   # Test with sample documents
└── README.md
```
