# WeaveX — AI-Powered Digital Twin Platform

WeaveX is an AI-powered digital twin builder. Upload PDF, DOCX, or text documents describing a domain, and the platform uses LLM-driven extraction to automatically discover agents, relationships, interaction protocols, tools, and KPI objectives. The extracted digital twin can then be visualised on an interactive canvas and run through multi-agent simulations with real-time analytics, scenario injection, and post-simulation insights.

---

## Table of Contents

- [Architecture Overview](#architecture-overview)
- [Container Structure](#container-structure)
- [End-to-End Workflow](#end-to-end-workflow)
- [LLM Extraction Pipeline](#llm-extraction-pipeline)
- [Simulation Engine](#simulation-engine)
- [Data Flow](#data-flow)
- [Frontend Component Tree](#frontend-component-tree)
- [API Reference](#api-reference)
- [Tech Stack](#tech-stack)
- [Getting Started](#getting-started)
- [Configuration](#configuration)
- [Project Structure](#project-structure)

---

## Architecture Overview

```mermaid
graph TB
    subgraph Frontend["Frontend (React + Vite)"]
        UI[App Shell]
        UP[Upload Panel]
        CV[Twin Canvas<br/>React Flow]
        SP[Simulation Panel]
        AP[Analytics Panel]
        DP[LLM Debug Panel]
        AL[Agent List Panel]
    end

    subgraph Backend["Backend (FastAPI)"]
        API[REST API Layer]
        WS[WebSocket Server]
        EX[Extraction Service]
        SIM[Simulation Engine]
        DA[Domain Analyser<br/>Multi-Pass LLM Pipeline]
        DP2[Document Parser]
    end

    subgraph External["External Services"]
        OL[Ollama / LLM<br/>deepseek-v3.1:671b-cloud]
        N4J[(Neo4j<br/>Knowledge Graph)]
        RD[(Redis<br/>Cache)]
    end

    subgraph Storage["Persistent Storage"]
        FS[(/app/data<br/>Uploads + Extractions)]
    end

    UI --> API
    UI --> WS
    UP -->|Upload docs| API
    SP -->|Start/Pause/Stop| API
    SP -->|Live events| WS
    AP -->|KPI + Insights| WS

    API --> EX
    API --> SIM
    EX --> DP2
    EX --> DA
    DA -->|LLM calls| OL
    SIM -->|Agent decisions| OL
    SIM -->|Stream events| WS
    EX -->|Write graph| N4J
    EX -->|Persist JSON| FS
```

---

## Container Structure

```mermaid
graph LR
    subgraph Docker["Docker Compose Network"]
        subgraph FE["frontend :80"]
            NG[Nginx Alpine]
            RA[React SPA<br/>Static Build]
        end

        subgraph BE["backend :5001"]
            UV[Uvicorn]
            FA[FastAPI App]
        end

        subgraph DB["neo4j :7474 :7687"]
            N4[Neo4j 5 Community]
        end

        subgraph RD["redis :6379"]
            RE[Redis 7 Alpine]
        end
    end

    HOST[Host Machine<br/>Ollama :11434]

    NG -->|/api/* proxy| FA
    NG -->|/ws/* proxy| FA
    FA -->|bolt://neo4j:7687| N4
    FA -->|redis://redis:6379| RE
    FA -->|host.docker.internal:11434| HOST

    USER((User<br/>Browser)) -->|http://localhost| NG

    style Docker fill:#1e1e2e,stroke:#6366f1,color:#cdd6f4
    style FE fill:#1e3a5f,stroke:#06b6d4,color:#cdd6f4
    style BE fill:#1e3a2f,stroke:#10b981,color:#cdd6f4
    style DB fill:#3a1e2f,stroke:#ec4899,color:#cdd6f4
    style RD fill:#3a2f1e,stroke:#f59e0b,color:#cdd6f4
```

| Container | Image | Port | Role |
|-----------|-------|------|------|
| `frontend` | Node 20 build + Nginx Alpine | 80 | Serves React SPA, proxies API/WS to backend |
| `backend` | Python 3.12-slim | 5001 | FastAPI server, LLM pipeline, simulation engine |
| `neo4j` | Neo4j 5 Community | 7474, 7687 | Knowledge graph storage for agents & relationships |
| `redis` | Redis 7 Alpine | 6379 | Cache and pub/sub (future use) |

---

## End-to-End Workflow

```mermaid
sequenceDiagram
    actor User
    participant FE as Frontend
    participant API as Backend API
    participant LLM as Ollama LLM
    participant Neo as Neo4j
    participant WS as WebSocket

    Note over User,WS: Phase 1 — Upload & Extraction
    User->>FE: Upload PDF/DOCX + description
    FE->>API: POST /api/extract/upload-and-analyse
    API-->>FE: {job_id, status: "pending"}
    
    loop Poll every 5s
        FE->>API: GET /api/extract/{job_id}/status
        API-->>FE: {stage: "ontology", detail: "..."}
    end

    Note over API,LLM: Multi-pass extraction (see pipeline)
    API->>LLM: Pass 0: Intent classification
    LLM-->>API: {domain, model_type, targets}
    API->>LLM: Pass 1: Ontology (per chunk)
    LLM-->>API: {entity_types, relation_types}
    API->>LLM: Pass 2: Agents (per chunk)
    LLM-->>API: {agents: [...]}
    API->>LLM: Pass 3: Interactions
    LLM-->>API: {interactions: [...]}
    API->>LLM: Pass 4: Tools + Objectives
    LLM-->>API: {tools, objectives}

    API->>Neo: Write agents & relationships
    API->>API: Persist to data/extractions/

    FE->>API: GET /api/extract/{job_id}
    API-->>FE: Complete TwinSpec

    Note over User,WS: Phase 2 — Review
    User->>FE: Review agents, ontology, interactions
    User->>FE: Click "Open Sandbox"

    Note over User,WS: Phase 3 — Simulation
    User->>FE: Configure rounds, click Run
    FE->>API: POST /api/simulation/start
    API-->>FE: {simulation_id}
    FE->>WS: Connect WS /ws/simulation/{id}

    loop Each Round
        API->>LLM: Agent decision prompt
        LLM-->>API: {action, reasoning, effects}
        API->>WS: agent_action event
        API->>LLM: Compute KPIs
        LLM-->>API: {kpi_values}
        API->>WS: kpi_update event
        WS-->>FE: Live events stream
    end

    opt Scenario Injection
        User->>FE: Inject scenario event
        FE->>API: POST /simulation/{id}/inject-event
        API->>WS: scenario_injected event
    end

    API->>LLM: Generate insights
    LLM-->>API: {summary, trends, recommendations}
    API->>WS: sim_complete + insights
    WS-->>FE: Display analytics
```

---

## LLM Extraction Pipeline

The domain analyser processes uploaded documents through a multi-pass LLM pipeline. Documents are split into overlapping chunks (8,000 chars with 500 char overlap) to ensure full coverage.

```mermaid
flowchart TD
    DOC[Uploaded Documents<br/>PDF / DOCX / TXT] --> PARSE[Document Parser<br/>PyMuPDF + python-docx]
    PARSE --> CHUNK[Text Chunking<br/>8000 chars, 500 overlap]
    CHUNK --> P0

    subgraph Pipeline["Multi-Pass LLM Extraction"]
        P0[Pass 0: Intent Classification<br/>domain, model_type, targets<br/>constraints, scenario_seeds]
        P1[Pass 1: Ontology Extraction<br/>entity_types, relation_types<br/>Per-chunk with deduplication]
        P2[Pass 2: Agent Extraction<br/>8-15 agents per chunk<br/>personas, goals, behaviours]
        P3[Pass 3: Interaction Protocols<br/>triggers, participants<br/>steps, frequency]
        P4A[Pass 4a: Tool Mapping<br/>parameters, side_effects]
        P4B[Pass 4b: Objective Mapping<br/>KPIs, target_direction<br/>time_horizon]

        P0 --> P1 --> P2 --> P3 --> P4A & P4B
    end

    P4A & P4B --> SPEC[TwinSpec<br/>Complete Digital Twin Specification]

    SPEC --> DISK[(Disk Persistence<br/>data/extractions/)]
    SPEC --> NEO[(Neo4j Graph<br/>Agents + Relationships)]
    SPEC --> FE[Frontend Review]

    style Pipeline fill:#1a1a2e,stroke:#6366f1,color:#e2e8f0
```

### Chunking Strategy

```mermaid
graph LR
    subgraph Document["Full Document Text"]
        C1[Chunk 1<br/>0 — 8000]
        C2[Chunk 2<br/>7500 — 15500]
        C3[Chunk 3<br/>15000 — 23000]
        C4[Chunk N<br/>...]
    end

    C1 -->|500 char overlap| C2
    C2 -->|500 char overlap| C3
    C3 -->|500 char overlap| C4

    C1 --> LLM1[LLM Call]
    C2 --> LLM2[LLM Call]
    C3 --> LLM3[LLM Call]

    LLM1 --> MERGE[Merge & Deduplicate<br/>by entity/agent name]
    LLM2 --> MERGE
    LLM3 --> MERGE

    style Document fill:#1e293b,stroke:#94a3b8,color:#e2e8f0
```

---

## Simulation Engine

```mermaid
flowchart TD
    START[Start Simulation] --> INIT[Initialise World State<br/>from TwinSpec]
    INIT --> ROUND

    subgraph ROUND["Per-Round Loop"]
        RS[Round Start Event] --> AGENT_LOOP

        subgraph AGENT_LOOP["For Each Agent"]
            PROMPT[Build Agent Prompt<br/>Persona + Goals + World State]
            PROMPT --> LLM_CALL[LLM: Decide Action]
            LLM_CALL --> ACTION[Parse Action<br/>reasoning, effects, tools]
            ACTION --> EMIT_ACT[Emit agent_action Event]
            EMIT_ACT --> UPDATE[Update World State]
        end

        AGENT_LOOP --> KPI[LLM: Compute KPIs<br/>against objectives]
        KPI --> EMIT_KPI[Emit kpi_update Event]
        EMIT_KPI --> RC[Round Complete Event]
    end

    RC -->|More rounds?| ROUND
    RC -->|Done| INSIGHTS

    INSIGHTS[LLM: Generate Insights<br/>Summary, Trends,<br/>Recommendations, Outlook]
    INSIGHTS --> COMPLETE[Emit sim_complete<br/>with Insights]

    INJECT[Scenario Injection<br/>by User] -.->|Mid-simulation| UPDATE
    PAUSE[Pause / Resume] -.->|Control| ROUND
    TUNE[Tune Agent Behaviour<br/>via WebSocket] -.->|Adjust params| PROMPT

    style ROUND fill:#1a1a2e,stroke:#6366f1,color:#e2e8f0
    style AGENT_LOOP fill:#1e293b,stroke:#10b981,color:#e2e8f0
```

### Simulation Controls

| Action | Endpoint | Description |
|--------|----------|-------------|
| Start | `POST /api/simulation/start` | Begin simulation with extraction data |
| Pause | `POST /api/simulation/{id}/pause` | Pause after current round |
| Resume | `POST /api/simulation/{id}/resume` | Resume paused simulation |
| Stop | `POST /api/simulation/{id}/stop` | Stop simulation immediately |
| Inject | `POST /api/simulation/{id}/inject-event` | Inject a scenario mid-run |

### WebSocket Event Types

| Event | Direction | Payload |
|-------|-----------|---------|
| `sim_started` | Server → Client | `total_rounds` |
| `round_start` | Server → Client | `round` number |
| `agent_action` | Server → Client | `agent_name`, `action`, `reasoning`, `effects` |
| `kpi_update` | Server → Client | `kpis: {name: value}` |
| `round_complete` | Server → Client | `world_state` snapshot |
| `scenario_injected` | Server → Client | `event` description |
| `sim_complete` | Server → Client | `insights` (summary, trends, recommendations) |
| `tune_behaviour` | Client → Server | `agent_id`, `params` |
| `inject_event` | Client → Server | `event` description |

---

## Data Flow

```mermaid
flowchart LR
    subgraph Input
        PDF[PDF]
        DOCX[DOCX]
        TXT[TXT / MD / CSV]
    end

    subgraph Extraction["Extraction Pipeline"]
        PARSE[Parse Documents]
        CHUNK[Chunk Text]
        LLM_EX[LLM Multi-Pass<br/>Extraction]
    end

    subgraph TwinSpec["TwinSpec Output"]
        INT[IntentSpec<br/>domain, model_type, targets]
        ONT[Ontology<br/>entity_types, relation_types]
        AGT[AgentSpec[N]<br/>persona, goals, behaviour]
        IPR[InteractionProtocol[N]<br/>trigger, steps, frequency]
        TLS[ToolSpec[N]<br/>params, side_effects]
        OBJ[ObjectiveSpec[N]<br/>kpi, direction, time_horizon]
    end

    subgraph Persistence
        DISK[(JSON on Disk)]
        NEO[(Neo4j Graph)]
    end

    subgraph Simulation
        ENG[Simulation Engine]
        KPI[KPI Charts]
        INS[Insights &<br/>Recommendations]
    end

    PDF & DOCX & TXT --> PARSE --> CHUNK --> LLM_EX
    LLM_EX --> INT & ONT & AGT & IPR & TLS & OBJ
    AGT --> DISK & NEO
    INT & ONT & AGT & IPR & TLS & OBJ --> ENG
    ENG --> KPI & INS
```

---

## Frontend Component Tree

```mermaid
graph TD
    APP[App.tsx<br/>Phase Router]

    APP -->|phase: upload| UP[UploadPanel<br/>Drag & drop files<br/>Description input]
    APP -->|phase: analysing| AN[Analysing View<br/>Spinner + stage info]
    APP -->|phase: review| REV[Review Layout]
    APP -->|phase: canvas / simulating| SIM[Sandbox Layout]

    REV --> REV_MAIN[Extraction Summary<br/>JSON Preview]
    REV --> ALP[AgentListPanel<br/>Expandable agent cards]

    SIM --> SAP[SimAnalyticsPanel<br/>KPI charts, activity,<br/>actions, insights]
    SIM --> TC[TwinCanvas<br/>React Flow graph]
    SIM --> SMP[SimulationPanel<br/>Run/Pause/Stop<br/>Scenario injection]

    TC --> AN2[AgentNode<br/>Entity type badge<br/>Name, goals, tools]

    APP --> DBG[LLMDebugPanel<br/>Floating, always visible<br/>Request/response log]

    subgraph State["Zustand Store"]
        ST[appStore<br/>phase, twinSpec,<br/>selectedAgentId,<br/>behaviourOverrides]
    end

    APP -.-> ST

    style APP fill:#312e81,stroke:#6366f1,color:#e2e8f0
    style State fill:#1e293b,stroke:#94a3b8,color:#e2e8f0
```

### Application Phases

```mermaid
stateDiagram-v2
    [*] --> Upload
    Upload --> Analysing: Submit documents
    Analysing --> Review: Extraction complete
    Analysing --> Upload: Extraction failed
    Review --> Canvas: Open sandbox
    Canvas --> Simulating: Run simulation
    Simulating --> Canvas: Simulation ends
```

---

## API Reference

### Extraction

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/extract/upload-and-analyse` | Upload files + start extraction job |
| `POST` | `/api/extract/analyse-text` | Analyse raw text input |
| `GET` | `/api/extract/list` | List all completed extractions |
| `GET` | `/api/extract/{job_id}/status` | Poll extraction progress |
| `GET` | `/api/extract/{job_id}` | Get completed extraction result |

### Simulation

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/simulation/start` | Start a new simulation |
| `POST` | `/api/simulation/{id}/pause` | Pause running simulation |
| `POST` | `/api/simulation/{id}/resume` | Resume paused simulation |
| `POST` | `/api/simulation/{id}/stop` | Stop simulation |
| `POST` | `/api/simulation/{id}/inject-event` | Inject scenario event |
| `GET` | `/api/simulation/{id}/status` | Get simulation state |
| `GET` | `/api/simulation/{id}/log` | Get event log (last 100) |

### Projects

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/projects/` | Create project |
| `GET` | `/api/projects/` | List projects |
| `GET` | `/api/projects/{id}` | Get project |
| `DELETE` | `/api/projects/{id}` | Delete project |

### Debug & Health

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/health` | API health check |
| `GET` | `/api/debug/llm-log` | Last 50 LLM request/response events |
| `WS` | `/ws/simulation/{id}` | Real-time simulation event stream |

---

## Tech Stack

| Layer | Technology |
|-------|------------|
| Frontend | React 19, TypeScript, Vite 6, TailwindCSS 4 |
| State Management | Zustand |
| Graph Visualisation | React Flow (@xyflow/react) |
| Charts | Recharts |
| Backend | Python 3.12, FastAPI, Uvicorn |
| LLM | Ollama (OpenAI-compatible API) |
| Knowledge Graph | Neo4j 5 |
| Cache | Redis 7 |
| Document Parsing | PyMuPDF, python-docx |
| Data Validation | Pydantic v2 |
| Containerisation | Docker, Docker Compose |

---

## Getting Started

### Prerequisites

- [Docker](https://docs.docker.com/get-docker/) and Docker Compose
- [Ollama](https://ollama.ai/) running on the host machine
- An Ollama model pulled (e.g. `ollama pull deepseek-v3.1:671b-cloud` or `ollama pull gemma4:latest`)

### Run with Docker Compose

```bash
cd digitwin

# Start all services (builds on first run)
docker compose up --build -d

# Check status
docker compose ps
```

The platform will be available at **http://localhost**.

| Service | URL |
|---------|-----|
| Frontend | http://localhost |
| Backend API | http://localhost:5001 |
| API Docs (Swagger) | http://localhost:5001/docs |
| Neo4j Browser | http://localhost:7474 |

### Run for Development

```bash
cd digitwin

# Start infrastructure only
docker compose up -d neo4j redis

# Backend
cd backend
python -m venv .venv
source .venv/bin/activate  # or .venv\Scripts\activate on Windows
pip install -r requirements.txt
uvicorn app.main:app --host 0.0.0.0 --port 5001

# Frontend (separate terminal)
cd frontend
npm install
npm run dev
```

Development frontend runs at **http://localhost:5173** with API proxy to the backend.

---

## Configuration

All backend configuration is via environment variables (see `backend/.env`):

| Variable | Default | Description |
|----------|---------|-------------|
| `LLM_BASE_URL` | `http://localhost:11434/v1` | Ollama API endpoint |
| `LLM_MODEL` | `gemma4:26b` | LLM model name |
| `LLM_API_KEY` | `ollama` | API key (Ollama ignores this) |
| `NEO4J_URI` | `bolt://localhost:7687` | Neo4j connection URI |
| `NEO4J_USER` | `neo4j` | Neo4j username |
| `NEO4J_PASSWORD` | `digitwin_dev` | Neo4j password |
| `REDIS_URL` | `redis://localhost:6379/0` | Redis connection URL |
| `UPLOAD_DIR` | `./data/uploads` | File upload directory |
| `PORT` | `5001` | Backend server port |
| `CORS_ORIGINS` | `http://localhost:5173` | Allowed CORS origins |

When running in Docker, the compose file overrides `NEO4J_URI`, `REDIS_URL`, `OLLAMA_BASE_URL`, and `LLM_BASE_URL` to use container networking and `host.docker.internal`.

---

## Project Structure

```
digitwin/
├── docker-compose.yml              # All 4 services
│
├── backend/
│   ├── Dockerfile
│   ├── .dockerignore
│   ├── .env                        # Environment config
│   ├── requirements.txt
│   └── app/
│       ├── main.py                 # FastAPI entry point
│       ├── config.py               # Pydantic settings
│       ├── api/
│       │   ├── extraction.py       # Document upload & analysis
│       │   ├── simulation.py       # Simulation control
│       │   ├── websocket.py        # Real-time event streaming
│       │   ├── projects.py         # Project CRUD
│       │   └── debug.py            # LLM request/response log
│       ├── services/
│       │   ├── extractors/
│       │   │   ├── document_parser.py   # PDF/DOCX/TXT parsing
│       │   │   └── domain_analyser.py   # Multi-pass LLM pipeline
│       │   └── simulation/
│       │       └── engine.py            # Multi-agent simulation
│       ├── models/
│       │   └── twin_spec.py        # Pydantic data models
│       └── utils/
│           ├── llm_client.py       # Ollama / OpenAI client
│           └── graph_client.py     # Neo4j async client
│
├── frontend/
│   ├── Dockerfile
│   ├── .dockerignore
│   ├── nginx.conf                  # Reverse proxy config
│   ├── package.json
│   ├── vite.config.ts
│   └── src/
│       ├── App.tsx                  # Root component & phase router
│       ├── main.tsx                 # React entry point
│       ├── api/
│       │   └── client.ts           # Axios HTTP + polling helpers
│       ├── stores/
│       │   └── appStore.ts         # Zustand global state
│       ├── types/
│       │   └── index.ts            # TypeScript interfaces
│       └── components/
│           ├── canvas/
│           │   ├── TwinCanvas.tsx   # React Flow agent graph
│           │   └── AgentNode.tsx    # Agent node component
│           └── panels/
│               ├── UploadPanel.tsx       # File upload UI
│               ├── AgentListPanel.tsx    # Agent sidebar
│               ├── AgentPanel.tsx        # Agent detail view
│               ├── SimulationPanel.tsx   # Simulation controls
│               ├── SimAnalyticsPanel.tsx # KPI charts & insights
│               └── LLMDebugPanel.tsx     # LLM debug overlay
│
└── scripts/
    └── seed_test.py                # E2E pipeline smoke test
```
