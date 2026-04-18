# WeaveX — AI-Powered Digital Twin Platform

WeaveX is an AI-powered digital twin builder. Upload PDF, DOCX, or text documents describing a domain, and the platform uses LLM-driven extraction to automatically discover agents, relationships, interaction protocols, tools, and KPI objectives. The extracted digital twin can be visualised on an interactive canvas, run through multi-agent LLM simulations with real-time analytics, and **exported as a standalone Docker container** that runs instant rule-based simulations with no LLM dependency.

---

## Table of Contents

- [Architecture Overview](#architecture-overview)
- [Container Structure](#container-structure)
- [End-to-End Workflow](#end-to-end-workflow)
- [LLM Extraction Pipeline](#llm-extraction-pipeline)
- [Live Ontology Graph](#live-ontology-graph)
- [Review & Agent Management](#review--agent-management)
- [Sandbox & Simulation](#sandbox--simulation)
- [Rule Distillation & Standalone Export](#rule-distillation--standalone-export)
- [Rule Engine Execution](#rule-engine-execution)
- [Data Flow](#data-flow)
- [Frontend Component Tree](#frontend-component-tree)
- [State Machine](#state-machine)
- [API Reference](#api-reference)
- [Tech Stack](#tech-stack)
- [Getting Started](#getting-started)
- [Configuration](#configuration)
- [Project Structure](#project-structure)

---

## Architecture Overview

```mermaid
graph TB
    subgraph Frontend["Frontend (React + Vite + Nginx)"]
        UI[App Shell — phase router]
        UP[Upload Panel]
        LOG[Live Ontology Graph]
        AL[Agent List Panel]
        AM[Agent Manage Panel]
        CV[Twin Canvas — React Flow]
        SP[Simulation Panel]
        AP[Analytics Panel]
        KD[KPI Drilldown]
        DP[LLM Debug Panel]
    end

    subgraph Backend["Backend (FastAPI)"]
        API[REST API Layer]
        WS[WebSocket Server]
        EX[Extraction Service]
        SIM[LLM Simulation Engine]
        DIST[Rule Distiller]
        EXP[Standalone Exporter]
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
        DL[(Downloads<br/>.tar.gz exports)]
    end

    UI --> API
    UI --> WS
    UP -->|Upload docs| API
    LOG -->|Poll live graph| API
    AM -->|Keep/Delete/Merge| UI
    SP -->|Start/Pause/Stop/Inject| API
    SP -->|Live events| WS
    SP -->|Distill + Export| API
    AP -->|KPI + Insights| WS
    KD -->|Drill into KPI| AP

    API --> EX
    API --> SIM
    API --> DIST
    API --> EXP
    EX --> DP2
    EX --> DA
    DA -->|Chunked LLM calls| OL
    SIM -->|Agent decisions| OL
    SIM -->|Stream events| WS
    DIST -->|Distill rules| OL
    EXP -->|.tar.gz| DL
    EX -->|Write graph| N4J
    EX -->|Persist JSON| FS

    style Frontend fill:#1e1b4b,stroke:#6366f1,color:#e0e7ff
    style Backend fill:#064e3b,stroke:#10b981,color:#d1fae5
    style External fill:#581c87,stroke:#a855f7,color:#f3e8ff
    style Storage fill:#7c2d12,stroke:#f97316,color:#ffedd5
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

    subgraph Standalone["Exported Standalone Twin :8080"]
        ST[FastAPI + Rule Engine<br/>No LLM, No DB]
    end

    NG -->|/api/* proxy| FA
    NG -->|/ws/* proxy| FA
    FA -->|bolt://neo4j:7687| N4
    FA -->|redis://redis:6379| RE
    FA -->|host.docker.internal:11434| HOST

    USER((User<br/>Browser)) -->|http://localhost| NG
    USER -.->|Downloads .tar.gz| ST
    USER -.->|http://localhost:8080| ST

    style Docker fill:#1e1e2e,stroke:#6366f1,color:#cdd6f4
    style FE fill:#1e3a5f,stroke:#06b6d4,color:#cdd6f4
    style BE fill:#1e3a2f,stroke:#10b981,color:#cdd6f4
    style DB fill:#3a1e2f,stroke:#ec4899,color:#cdd6f4
    style RD fill:#3a2f1e,stroke:#f59e0b,color:#cdd6f4
    style Standalone fill:#2f1e3a,stroke:#a855f7,color:#cdd6f4
```

| Container | Image | Port | Role |
|-----------|-------|------|------|
| `frontend` | Node 20 build + Nginx Alpine | 80 | Serves React SPA, proxies API/WS to backend |
| `backend` | Python 3.12-slim | 5001 | FastAPI server, LLM pipeline, simulation engine |
| `neo4j` | Neo4j 5 Community | 7474, 7687 | Knowledge graph storage for agents & relationships |
| `redis` | Redis 7 Alpine | 6379 | Cache and pub/sub (future use) |
| `twin-{domain}` (exported) | Python 3.12-slim | 8080 | Standalone rule-based simulation, self-contained |

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
    participant FS as File System

    Note over User,FS: Phase 1 — Upload & Live Extraction
    User->>FE: Upload PDF/DOCX + description
    FE->>API: POST /api/extract/upload-and-analyse
    API-->>FE: {job_id, status: "pending"}

    loop Poll every 3s
        FE->>API: GET /api/extract/{job_id}/status
        API-->>FE: {stage, detail, live_graph}
        FE->>FE: Render live ontology graph
    end

    Note over API,LLM: Multi-pass chunked extraction
    API->>LLM: Pass 0: Intent classification
    API->>LLM: Pass 1: Ontology per chunk → dedup
    API->>LLM: Pass 2: Agents per chunk → dedup
    API->>LLM: Pass 3: Interactions
    API->>LLM: Pass 4: Tools + Objectives

    API->>Neo: Write agents & relationships
    API->>FS: Persist extraction to disk

    FE->>API: GET /api/extract/{job_id}
    API-->>FE: Complete TwinSpec

    Note over User,FS: Phase 2 — Review & Agent Management
    User->>FE: Review / Delete / Merge agents
    User->>FE: Click "Open Sandbox"

    Note over User,FS: Phase 3 — LLM Simulation
    User->>FE: Configure rounds, timeline, click Run
    FE->>API: POST /api/simulation/start
    FE->>WS: Connect WS /ws/simulation/{id}

    loop Each Round
        API->>LLM: Agent decision prompt (per agent)
        LLM-->>API: {action, reasoning, effects}
        API->>WS: agent_action event
        FE->>FE: Blink agent on canvas
        API->>LLM: Compute KPIs
        LLM-->>API: {kpi_values}
        API->>WS: kpi_update event
    end

    opt Scenario Injection
        User->>FE: Inject scenario event
        FE->>API: POST /simulation/{id}/inject-event
        API->>WS: scenario_injected
    end

    API->>LLM: Generate insights
    API->>WS: sim_complete + insights
    FE->>FE: Show insight cards on canvas

    Note over User,FS: Phase 4 — Distill & Export
    User->>FE: Click "Save & Export as Container"
    FE->>API: POST /simulation/{id}/distill
    API->>LLM: Extract rules from event log
    LLM-->>API: {agent_rules, kpi_formulas}
    FE->>API: GET /simulation/{id}/export
    API->>API: Build .tar.gz package
    API-->>FE: Binary download
    FE->>User: Download twin-{domain}.tar.gz

    Note over User,FS: Phase 5 — Standalone Twin
    User->>User: docker compose up
    User->>User: Instant simulations, no LLM
```

---

## LLM Extraction Pipeline

The domain analyser processes uploaded documents through a multi-pass LLM pipeline. Documents are split into overlapping 8,000-char chunks with 500-char overlap to ensure full coverage.

```mermaid
flowchart TD
    DOC[Uploaded Documents<br/>PDF / DOCX / TXT / MD / CSV] --> PARSE[Document Parser<br/>PyMuPDF + python-docx]
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

    P1 -.->|on_graph_update| LIVE[Live Graph Stream<br/>entity_types + relation_types]
    P2 -.->|on_graph_update| LIVE2[Live Graph Stream<br/>+ agents]

    P4A & P4B --> COERCE[Defensive Coercion<br/>string → list<br/>per-agent try/except]
    COERCE --> SPEC[TwinSpec<br/>Complete Digital Twin Specification]

    SPEC --> DISK[(Disk Persistence<br/>data/extractions/)]
    SPEC --> NEO[(Neo4j Graph<br/>Agents + Relationships)]
    SPEC --> FE[Frontend Review Phase]

    style Pipeline fill:#1a1a2e,stroke:#6366f1,color:#e2e8f0
    style LIVE fill:#064e3b,stroke:#10b981,color:#d1fae5
    style LIVE2 fill:#064e3b,stroke:#10b981,color:#d1fae5
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

    C1 --> LLM1[LLM Call<br/>entities + agents]
    C2 --> LLM2[LLM Call<br/>entities + agents]
    C3 --> LLM3[LLM Call<br/>entities + agents]

    LLM1 --> MERGE[Merge & Deduplicate<br/>by entity/agent name]
    LLM2 --> MERGE
    LLM3 --> MERGE

    MERGE --> FINAL[Final Ontology<br/>+ All Agents]

    style Document fill:#1e293b,stroke:#94a3b8,color:#e2e8f0
    style MERGE fill:#312e81,stroke:#6366f1,color:#e0e7ff
```

---

## Live Ontology Graph

As the extraction pipeline processes each chunk, discovered entity types, relation types, and agents are streamed to the frontend. The analyse page shows a React Flow graph that grows in real-time.

```mermaid
sequenceDiagram
    participant FE as Frontend
    participant API as Backend API
    participant DA as Domain Analyser
    participant LLM as Ollama

    FE->>API: POST /extract/upload-and-analyse
    API-->>FE: {job_id: "ext_abc"}
    FE->>FE: setActiveJobId("ext_abc")<br/>setPhase("analysing")

    Note over FE,LLM: Polling loop starts in App.tsx useEffect
    loop Every 3 seconds
        FE->>API: GET /extract/ext_abc/status
        API-->>FE: {stage, detail, live_graph?}
        FE->>FE: Update LiveOntologyGraph

        Note over DA: Ontology chunk completes
        DA->>API: on_graph_update({entity_types, relation_types})
        API->>API: Store in _jobs[job_id]["live_graph"]

        Note over DA: Agent chunk completes
        DA->>API: on_graph_update({..., agents})
        API->>API: Update _jobs[job_id]["live_graph"]
    end

    Note over FE: Graph visualisation
    FE->>FE: Entity types as nodes (Phase 1-2)
    FE->>FE: Agents as nodes (Phase 3+)
    FE->>FE: Edges animate to show new connections
```

---

## Review & Agent Management

After extraction, users can review the digital twin and clean up duplicate agents before running simulations.

```mermaid
flowchart TD
    REVIEW[Review Phase<br/>TwinSpec loaded] --> TAB{Select Tab}

    TAB -->|List| LIST[Agent List Panel<br/>Expandable cards with<br/>persona, goals, tools]
    TAB -->|Manage| MANAGE[Agent Manage Panel]

    MANAGE --> GROUP[Group by entity_type]
    GROUP --> ACTION{User Action}

    ACTION -->|Delete single agent| CONFIRM1[Confirm delete]
    CONFIRM1 -->|Yes| REMOVE[removeAgent id]
    REMOVE --> UPDATE1[Remove from agents<br/>Remove from interactions]

    ACTION -->|Merge similar agents| SELECT[Select 2+ agents<br/>First = Primary]
    SELECT --> MERGE[mergeAgents keep, merge ids]
    MERGE --> COMBINE[Combine goals, constraints,<br/>tools, relationships<br/>Rewrite rel targets to primary]

    UPDATE1 --> STORE[Zustand twinSpec updated]
    COMBINE --> STORE

    STORE --> SANDBOX[Click Open Sandbox →]
    SANDBOX --> CANVAS[Canvas Phase]

    style REVIEW fill:#1e293b,stroke:#94a3b8,color:#e2e8f0
    style STORE fill:#312e81,stroke:#6366f1,color:#e0e7ff
    style CANVAS fill:#064e3b,stroke:#10b981,color:#d1fae5
```

---

## Sandbox & Simulation

The sandbox has a three-panel layout: resizable analytics on the left, React Flow canvas in the centre, simulation controls on the right.

```mermaid
flowchart TD
    SANDBOX[Sandbox Layout] --> LEFT[Left Panel<br/>Resizable 200-600px]
    SANDBOX --> CENTER[Centre: TwinCanvas]
    SANDBOX --> RIGHT[Right Panel<br/>SimulationPanel]

    LEFT --> ANALYTICS[SimAnalyticsPanel<br/>KPI charts, agent activity,<br/>recent actions, insights]
    ANALYTICS -->|Click KPI chart| DRILL[KPI Drilldown Modal<br/>Round-by-round analysis]

    CENTER --> CANVAS[React Flow Graph<br/>Agents as nodes<br/>Relationships as edges]
    CANVAS -->|Click agent| PANEL[Agent Detail Panel<br/>Persona, goals, tools,<br/>connections in/out]
    CANVAS -->|Post-sim| CARDS[Insight Cards Overlay<br/>Summary, recommendations,<br/>outlook on canvas]

    RIGHT --> CONTROLS[Sim Controls]
    CONTROLS --> TL[Timeline selector<br/>Q1-Q4, monthly, yearly]
    CONTROLS --> RUN[Run / Pause / Resume / Stop]
    CONTROLS --> INJECT[Scenario Injection]
    CONTROLS --> EXPORT[Save & Export<br/>as Container]

    RUN -.->|WebSocket| CANVAS
    CANVAS -.->|Agent acts| BLINK[Blue blink animation<br/>on active agent]
    CANVAS -.->|KPI impact| ARROW[Green/red arrows<br/>on agent nodes]

    style SANDBOX fill:#1e293b,stroke:#94a3b8,color:#e2e8f0
    style CENTER fill:#312e81,stroke:#6366f1,color:#e0e7ff
    style EXPORT fill:#064e3b,stroke:#10b981,color:#d1fae5
```

### Simulation Round Flow

```mermaid
flowchart TD
    START[Start Simulation] --> INIT[Initialise World State<br/>from TwinSpec]
    INIT --> ROUND

    subgraph ROUND["Per-Round Loop"]
        RS[Round Start Event<br/>→ WebSocket broadcast]
        RS --> AGENT_LOOP

        subgraph AGENT_LOOP["For Each Agent"]
            PROMPT[Build Agent Prompt<br/>Persona + Goals + World State +<br/>Related Agents]
            PROMPT --> LLM_CALL[LLM: Decide Action]
            LLM_CALL --> PARSE[Parse Action JSON<br/>action, reasoning, effects,<br/>state_updates, tools_used]
            PARSE --> EMIT_ACT[Emit agent_action Event]
            EMIT_ACT --> UPDATE[Update World State<br/>from state_updates]
        end

        AGENT_LOOP --> KPI_COMPUTE[LLM: Compute KPIs<br/>against objectives]
        KPI_COMPUTE --> EMIT_KPI[Emit kpi_update Event]
        EMIT_KPI --> RC[Round Complete Event]
    end

    RC -->|More rounds?| ROUND
    RC -->|Done| INSIGHTS

    INSIGHTS[LLM: Generate Insights<br/>Summary, Trends,<br/>Recommendations, Outlook]
    INSIGHTS --> COMPLETE[Emit sim_complete<br/>with Insights]
    COMPLETE --> EXPORT_READY[Export button enabled]

    INJECT[Scenario Injection<br/>by User] -.->|Mid-simulation| UPDATE
    PAUSE[Pause / Resume] -.->|Control| ROUND
    TUNE[Tune Agent Behaviour<br/>via WebSocket] -.->|Adjust params| PROMPT

    style ROUND fill:#1a1a2e,stroke:#6366f1,color:#e2e8f0
    style AGENT_LOOP fill:#1e293b,stroke:#10b981,color:#e2e8f0
    style EXPORT_READY fill:#064e3b,stroke:#10b981,color:#d1fae5
```

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

## Rule Distillation & Standalone Export

After a simulation completes, users can convert the LLM-driven twin into a parameterised, portable rule engine — exported as a self-contained Docker container.

```mermaid
flowchart TD
    SIM_DONE[Simulation Complete<br/>event_log + kpi_history + twin_spec] --> BUTTON[User clicks<br/>Save & Export as Container]

    BUTTON --> PHASE1

    subgraph PHASE1["Phase 1: Distillation (one LLM call)"]
        SUMMARIZE[Summarise agent actions<br/>grouped by agent name]
        SUMMARIZE --> KPI_SUM[Summarise KPI trends<br/>first → last values]
        KPI_SUM --> LLM_DIST[LLM: Extract parameterised rules]
        LLM_DIST --> RULES_JSON[agent_rules + kpi_formulas +<br/>initial_world_state]
    end

    PHASE1 --> FALLBACK{Distilled rules<br/>non-empty?}
    FALLBACK -->|No| AUTO_RULES[Generate fallback rules<br/>from agent spec + goals +<br/>behaviour params]
    FALLBACK -->|Yes| PACKAGE
    AUTO_RULES --> PACKAGE

    PACKAGE[Build Package Dict<br/>twin_spec + distilled_rules +<br/>kpi_history + metadata]

    PACKAGE --> PHASE2

    subgraph PHASE2["Phase 2: Archive Build"]
        BACKEND_GEN[Generate app.py<br/>FastAPI with rule engine]
        FRONTEND_GEN[Generate static/index.html<br/>Tailwind + Chart.js UI]
        COPY_ENGINE[Copy rule_engine.py]
        DATA[Write data/package.json]
        DOCKER[Write Dockerfile +<br/>docker-compose.yml +<br/>requirements.txt + README]

        BACKEND_GEN --> TAR[Build .tar.gz archive]
        FRONTEND_GEN --> TAR
        COPY_ENGINE --> TAR
        DATA --> TAR
        DOCKER --> TAR
    end

    TAR --> DOWNLOAD[StreamingResponse<br/>twin-domain.tar.gz]
    DOWNLOAD --> USER[User downloads file]

    USER --> DEPLOY

    subgraph DEPLOY["Phase 3: Standalone Deployment"]
        EXTRACT[tar -xzf twin-domain.tar.gz]
        EXTRACT --> RUN_IT[docker compose up --build]
        RUN_IT --> PORT[Opens on :8080]
    end

    PORT --> TEST[Instant simulations<br/>No LLM needed]

    style PHASE1 fill:#1a1a2e,stroke:#6366f1,color:#e2e8f0
    style PHASE2 fill:#064e3b,stroke:#10b981,color:#d1fae5
    style DEPLOY fill:#2f1e3a,stroke:#a855f7,color:#f3e8ff
```

### Distilled Rule Structure

```mermaid
graph LR
    subgraph Package["package.json"]
        TS[twin_spec<br/>agents + objectives + ...]
        DR[distilled_rules<br/>agent_rules + kpi_formulas]
        KH[kpi_history<br/>original LLM sim data]
        MD[metadata<br/>domain, counts]
    end

    DR --> AR[agent_rules array]
    DR --> KF[kpi_formulas array]
    DR --> IWS[initial_world_state]

    AR --> RULE

    subgraph RULE["Single Rule"]
        ID[id: rule_1]
        DESC[description]
        COND[condition<br/>type, field, op, value]
        ACT[action string]
        EFF[effects<br/>target, operation, value]
        PROB[probability 0-1]
    end

    KF --> FORMULA

    subgraph FORMULA["KPI Formula"]
        KPI[kpi name]
        FT[formula_type<br/>weighted_sum / trend / average]
        INP[inputs: world_state keys]
        WT[weights]
        BASE[base_value]
        NS[noise]
    end

    style Package fill:#1e293b,stroke:#94a3b8,color:#e2e8f0
    style RULE fill:#312e81,stroke:#6366f1,color:#e0e7ff
    style FORMULA fill:#064e3b,stroke:#10b981,color:#d1fae5
```

---

## Rule Engine Execution

The standalone rule engine runs simulations in milliseconds — no LLM calls. Each agent evaluates its rules against world state, fires the first matching rule, applies effects, and KPI formulas compute values.

```mermaid
flowchart TD
    INIT[Load package.json] --> BUILD[Build RuleEngine<br/>rules_by_agent lookup]
    BUILD --> CHECK{Distilled rules<br/>empty?}
    CHECK -->|Yes| AUTOGEN[Auto-generate fallback rules<br/>from agent goals + behaviour]
    CHECK -->|No| START
    AUTOGEN --> START

    START[Initialise world_state<br/>from initial_world_state] --> ROUND

    subgraph ROUND["Per-Round Loop"]
        RS[Round Start]
        RS --> INJECT{Scenario<br/>injected?}
        INJECT -->|Yes| ADD_EV[Add to world_state<br/>injected_event]
        INJECT -->|No| KPI_SNAP
        ADD_EV --> KPI_SNAP

        KPI_SNAP[Snapshot current KPIs] --> AGENTS

        subgraph AGENTS["For Each Agent"]
            GETRULES[Get rules for agent]
            GETRULES --> EVAL

            subgraph EVAL["Evaluate Rules In Order"]
                PROBCHECK[Check probability<br/>random < prob]
                PROBCHECK -->|Fail| NEXT[Next rule]
                PROBCHECK -->|Pass| EVALCOND[Evaluate condition<br/>type + field + operator]
                EVALCOND -->|False| NEXT
                EVALCOND -->|True| FIRE[Fire rule]
            end

            FIRE --> APPLY[Apply effects<br/>set / add / multiply<br/>to world_state]
            APPLY --> LOG_ACT[Log agent_action event]
        end

        AGENTS --> KPI_COMPUTE

        subgraph KPI_COMPUTE["For Each KPI Formula"]
            FT{formula_type}
            FT -->|weighted_sum| WS[sum inputs * weights<br/>+ base + noise]
            FT -->|trend| TR[prev_value + drift<br/>+ random walk]
            FT -->|average| AV[mean of inputs + noise]
        end

        KPI_COMPUTE --> LOG_KPI[Log kpi_update event]
        LOG_KPI --> CLEAR[Clear injected_event]
    end

    CLEAR -->|Next round| ROUND
    CLEAR -->|Done| DONE[Return event_log +<br/>kpi_history + world_state]

    style AUTOGEN fill:#7c2d12,stroke:#f97316,color:#ffedd5
    style AGENTS fill:#1e293b,stroke:#10b981,color:#e2e8f0
    style KPI_COMPUTE fill:#312e81,stroke:#6366f1,color:#e0e7ff
```

### Condition Operators

| Operator | Behaviour |
|----------|-----------|
| `gt` | `actual > value` |
| `lt` | `actual < value` |
| `eq` | `str(actual) == str(value)` |
| `contains` | Substring match (case-insensitive) |
| `any` | `actual is not None` |
| `always` | Always true |
| `random` | `random.random() < probability` |

### Effect Operations

| Operation | Behaviour |
|-----------|-----------|
| `set` | `world_state[target] = value` |
| `add` | Numeric addition to current value |
| `multiply` | Numeric multiplication |

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
        AGT[AgentSpec N<br/>persona, goals, behaviour]
        IPR[InteractionProtocol N<br/>trigger, steps, frequency]
        TLS[ToolSpec N<br/>params, side_effects]
        OBJ[ObjectiveSpec N<br/>kpi, direction, time_horizon]
    end

    subgraph Persistence
        DISK[(JSON on Disk)]
        NEO[(Neo4j Graph)]
    end

    subgraph LLMSim["LLM Simulation"]
        ENG[Sim Engine<br/>per-agent LLM calls]
        KPI[KPI Charts]
        INS[Insights &<br/>Recommendations]
    end

    subgraph Distilled["Rule Distillation"]
        DIST[Distiller<br/>1 LLM call]
        RULES[agent_rules +<br/>kpi_formulas]
    end

    subgraph Exported["Standalone Twin"]
        PKG[package.json]
        RE[Rule Engine]
        STATIC[Static UI]
        INSTANT[Instant Rounds<br/>No LLM]
    end

    PDF & DOCX & TXT --> PARSE --> CHUNK --> LLM_EX
    LLM_EX --> INT & ONT & AGT & IPR & TLS & OBJ
    AGT --> DISK & NEO
    INT & ONT & AGT & IPR & TLS & OBJ --> ENG
    ENG --> KPI & INS
    ENG --> DIST
    DIST --> RULES
    RULES --> PKG
    PKG --> RE --> INSTANT
    PKG --> STATIC
```

---

## Frontend Component Tree

```mermaid
graph TD
    APP[App.tsx<br/>Phase Router + Central Polling]

    APP -->|phase: upload| UP[UploadPanel<br/>Drag & drop files<br/>Description input]
    APP -->|phase: analysing| AN[Analysing View]
    APP -->|phase: review| REV[Review Layout]
    APP -->|phase: canvas / simulating| SIM[Sandbox Layout]

    AN --> STATUS[Status Bar<br/>Spinner + stage + counts]
    AN --> LOG[LiveOntologyGraph<br/>React Flow - grows live]

    REV --> REV_MAIN[Extraction Summary<br/>JSON Preview]
    REV --> REV_TABS{Tabs}
    REV_TABS -->|list| ALP[AgentListPanel<br/>Expandable cards]
    REV_TABS -->|manage| AMP[AgentManagePanel<br/>Delete + Merge]

    SIM --> SAP[SimAnalyticsPanel<br/>KPI charts, activity,<br/>recent actions, insights]
    SIM --> TC[TwinCanvas<br/>React Flow graph]
    SIM --> SMP[SimulationPanel<br/>Run/Pause/Stop<br/>Scenario + Timeline<br/>Export button]

    SAP -->|Click KPI| KD[KpiDrilldown Modal<br/>Round-by-round analysis]
    TC --> AN2[AgentNode<br/>Blink on activation<br/>KPI trend arrows]
    TC -->|Click| AGP[AgentPanel<br/>Details + Connections<br/>Behaviour sliders]
    TC -.->|Post-sim| CARDS[Insight Cards overlay]

    APP --> DBG[LLMDebugPanel<br/>Floating, bottom-right<br/>Request/response log]

    subgraph State["Zustand Store"]
        ST[appStore<br/>phase, twinSpec,<br/>activeJobId, liveGraph,<br/>selectedAgentId,<br/>activeAgentIds,<br/>simTimeline,<br/>behaviourOverrides]
    end

    APP -.-> ST
    UP -.-> ST
    AMP -.-> ST
    AGP -.-> ST
    TC -.-> ST
    SMP -.-> ST

    style APP fill:#312e81,stroke:#6366f1,color:#e0e7ff
    style State fill:#1e293b,stroke:#94a3b8,color:#e2e8f0
    style SIM fill:#064e3b,stroke:#10b981,color:#d1fae5
```

---

## State Machine

```mermaid
stateDiagram-v2
    [*] --> Upload

    Upload --> Analysing: submitExtractionJob<br/>setActiveJobId
    Analysing --> Analysing: poll live_graph every 3s
    Analysing --> Upload: 404 / failed
    Analysing --> Review: status = complete<br/>setExtraction

    Review --> Review: delete / merge agent
    Review --> Canvas: Click Open Sandbox
    Review --> Upload: back to start

    Canvas --> Simulating: Click Run<br/>startSimulation + WS
    Simulating --> Simulating: receive agent_action,<br/>kpi_update, scenario_injected
    Simulating --> Canvas: sim_complete /<br/>stop
    Canvas --> Exported: Distill + Export<br/>download .tar.gz

    Exported --> [*]: docker compose up<br/>separate container
```

---

## API Reference

### Extraction

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/extract/upload-and-analyse` | Upload files + start extraction job |
| `POST` | `/api/extract/analyse-text` | Analyse raw text input |
| `GET` | `/api/extract/list` | List all completed extractions |
| `GET` | `/api/extract/{job_id}/status` | Poll extraction progress (includes `live_graph`) |
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
| `POST` | `/api/simulation/{id}/distill` | Distill simulation into rule package |
| `GET` | `/api/simulation/{id}/export` | Download standalone Docker package (`.tar.gz`) |

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

### Standalone Twin (Exported)

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/spec` | Get twin spec |
| `GET` | `/api/rules` | Get distilled rules |
| `POST` | `/api/rules/update` | Update rules for an agent |
| `POST` | `/api/simulate` | Run simulation (rounds + scenario_events + behaviour_overrides) |
| `GET` | `/api/metadata` | Get domain metadata |

---

## Tech Stack

| Layer | Technology |
|-------|------------|
| Frontend | React 19, TypeScript, Vite 6, TailwindCSS 4 |
| State Management | Zustand |
| Graph Visualisation | React Flow (@xyflow/react) |
| Charts | Recharts (main), Chart.js (standalone export) |
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
- An Ollama model pulled (e.g. `ollama pull deepseek-v3.1:671b-cloud`)

### Run with Docker Compose

```bash
cd digitwin
docker compose up --build -d
docker compose ps
```

The platform will be available at **http://localhost**.

| Service | URL |
|---------|-----|
| Frontend | http://localhost |
| Backend API | http://localhost:5001 |
| API Docs (Swagger) | http://localhost:5001/docs |
| Neo4j Browser | http://localhost:7474 |

### Run an Exported Standalone Twin

```bash
tar -xzf twin-{domain}.tar.gz
cd twin-{domain}
docker compose up --build
```

Open **http://localhost:8080** — no Ollama or other services needed.

### Run for Development

```bash
cd digitwin
docker compose up -d neo4j redis

# Backend
cd backend
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --host 0.0.0.0 --port 5001

# Frontend (separate terminal)
cd frontend && npm install && npm run dev
```

Development frontend runs at **http://localhost:5173** with API proxy to the backend.

---

## Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `LLM_BASE_URL` | `http://localhost:11434/v1` | Ollama API endpoint |
| `LLM_MODEL` | `deepseek-v3.1:671b-cloud` | LLM model name |
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
│   ├── .env                        # Environment config
│   ├── requirements.txt
│   └── app/
│       ├── main.py                 # FastAPI entry point
│       ├── config.py               # Pydantic settings
│       ├── api/
│       │   ├── extraction.py       # Document upload & live graph
│       │   ├── simulation.py       # Sim control + distill + export
│       │   ├── websocket.py        # Real-time event streaming
│       │   ├── projects.py         # Project CRUD
│       │   └── debug.py            # LLM request/response log
│       ├── services/
│       │   ├── extractors/
│       │   │   ├── document_parser.py      # PDF/DOCX/TXT parsing
│       │   │   └── domain_analyser.py      # Multi-pass chunked LLM pipeline
│       │   └── simulation/
│       │       ├── engine.py               # LLM-driven multi-agent sim
│       │       ├── distiller.py            # Extract rules from event log
│       │       ├── rule_engine.py          # Standalone rule executor
│       │       └── exporter.py             # Build .tar.gz package
│       ├── models/
│       │   └── twin_spec.py        # Pydantic data models
│       └── utils/
│           ├── llm_client.py       # Ollama / OpenAI client
│           └── graph_client.py     # Neo4j async client
│
├── frontend/
│   ├── Dockerfile
│   ├── nginx.conf                  # Reverse proxy config
│   ├── package.json
│   └── src/
│       ├── App.tsx                  # Root component & phase router + central polling
│       ├── main.tsx                 # React entry point
│       ├── api/
│       │   └── client.ts           # Axios HTTP + polling helpers
│       ├── stores/
│       │   └── appStore.ts         # Zustand global state
│       ├── types/
│       │   └── index.ts            # TypeScript interfaces
│       └── components/
│           ├── canvas/
│           │   ├── TwinCanvas.tsx            # React Flow agent graph
│           │   ├── AgentNode.tsx             # Agent node (blink + KPI arrows)
│           │   └── LiveOntologyGraph.tsx     # Live extraction graph
│           └── panels/
│               ├── UploadPanel.tsx           # File upload UI
│               ├── AgentListPanel.tsx        # Agent sidebar (expandable cards)
│               ├── AgentManagePanel.tsx      # Delete / merge agents
│               ├── AgentPanel.tsx            # Agent detail + connections
│               ├── SimulationPanel.tsx       # Controls + timeline + export
│               ├── SimAnalyticsPanel.tsx     # KPI charts & insights
│               ├── KpiDrilldown.tsx          # Round-by-round KPI modal
│               └── LLMDebugPanel.tsx         # LLM debug overlay
│
└── scripts/
    └── seed_test.py                # E2E pipeline smoke test
```
