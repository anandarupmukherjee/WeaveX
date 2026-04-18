import { useEffect, useRef, useState, useCallback, useMemo } from "react";
import { useAppStore } from "./stores/appStore";
import UploadPanel from "./components/panels/UploadPanel";
import TwinCanvas from "./components/canvas/TwinCanvas";
import LiveOntologyGraph from "./components/canvas/LiveOntologyGraph";
import LLMDebugPanel from "./components/panels/LLMDebugPanel";
import AgentListPanel from "./components/panels/AgentListPanel";
import AgentManagePanel from "./components/panels/AgentManagePanel";
import SimulationPanel from "./components/panels/SimulationPanel";
import SimAnalyticsPanel from "./components/panels/SimAnalyticsPanel";
import type { SimEvent, SimInsights } from "./components/panels/SimAnalyticsPanel";
import { pollJobStatus, fetchExtractionResult } from "./api/client";
import toast from "react-hot-toast";

export default function App() {
  const phase = useAppStore((s) => s.phase);
  const activeJobId = useAppStore((s) => s.activeJobId);

  // If URL has ?job=<id>, set it as active job
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const jobId = params.get("job");
    if (!jobId || phase !== "upload") return;
    const { setPhase, setAnalysisProgress, setActiveJobId } = useAppStore.getState();
    setActiveJobId(jobId);
    setPhase("analysing");
    setAnalysisProgress("connecting", "Reconnecting to running job...");
  }, []);

  // Central polling — runs whenever we're analysing and have a jobId
  useEffect(() => {
    if (phase !== "analysing" || !activeJobId) return;

    const { setAnalysisProgress, setExtraction, setLiveGraph, setPhase, setActiveJobId } = useAppStore.getState();

    const interval = setInterval(async () => {
      try {
        const status = await pollJobStatus(activeJobId);
        setAnalysisProgress(status.stage ?? "", status.detail ?? "Processing...");

        // Live graph update
        if ((status as any).live_graph) {
          setLiveGraph((status as any).live_graph);
        }

        if (status.status === "complete") {
          clearInterval(interval);
          setLiveGraph(null);
          setActiveJobId(null);
          const result = await fetchExtractionResult(activeJobId);
          setExtraction(result.extraction_id, result.data);
          toast.success(`Extracted ${result.data.agents.length} agents`);
          window.history.replaceState({}, "", "/");
        } else if (status.status === "failed") {
          clearInterval(interval);
          setLiveGraph(null);
          setActiveJobId(null);
          toast.error(status.error || "Extraction failed");
          setPhase("upload");
        }
      } catch (err: any) {
        if (err?.response?.status === 404 || err?.response?.status === 422) {
          clearInterval(interval);
          setLiveGraph(null);
          setActiveJobId(null);
          window.history.replaceState({}, "", "/");
          setPhase("upload");
          toast.error("Job not found — please re-upload your document.");
        }
        console.error("Poll error:", err);
      }
    }, 3_000);

    return () => clearInterval(interval);
  }, [phase, activeJobId]);

  const twinSpec = useAppStore((s) => s.twinSpec);
  const analysisStage = useAppStore((s) => s.analysisStage);
  const analysisDetail = useAppStore((s) => s.analysisDetail);
  const liveGraph = useAppStore((s) => s.liveGraph);

  // Simulation state shared between SimulationPanel and SimAnalyticsPanel
  const [simEvents, setSimEvents] = useState<SimEvent[]>([]);
  const [simKpi, setSimKpi] = useState<Record<string, number[]>>({});
  const [simInsights, setSimInsights] = useState<SimInsights | null>(null);
  const [simRound, setSimRound] = useState(0);
  const [simTotal, setSimTotal] = useState(10);
  const [simRunning, setSimRunning] = useState(false);

  // Review tab state
  const [reviewTab, setReviewTab] = useState<"list" | "manage">("list");

  // Feature 5: resizable left panel
  const [leftWidth, setLeftWidth] = useState(320);
  const resizingRef = useRef(false);
  const handleMouseDown = useCallback(() => {
    resizingRef.current = true;
    const onMove = (e: MouseEvent) => {
      if (!resizingRef.current) return;
      setLeftWidth(Math.max(200, Math.min(600, e.clientX)));
    };
    const onUp = () => {
      resizingRef.current = false;
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }, []);

  // Feature 2: compute per-agent KPI trends from events
  const agentKpiTrends = useMemo(() => {
    if (!simEvents.length || !twinSpec) return {};
    const trends: Record<string, "up" | "down" | "neutral"> = {};

    // Track which agents were active in last 2 rounds
    const lastRound = simRound;
    const prevRound = lastRound - 1;
    const kpiVals = Object.values(simKpi);
    if (kpiVals.length === 0 || kpiVals[0].length < 2) return {};

    // Overall KPI direction this round
    let overallUp = 0;
    let overallDown = 0;
    for (const vals of kpiVals) {
      if (vals.length >= 2) {
        const delta = vals[vals.length - 1] - vals[vals.length - 2];
        if (delta > 0) overallUp++; else if (delta < 0) overallDown++;
      }
    }
    const kpiDirection = overallUp > overallDown ? "up" : overallDown > overallUp ? "down" : "neutral";

    // Agents active in last round get the KPI direction arrow
    const lastRoundAgents = simEvents.filter(
      (e) => e.type === "agent_action" && e.round === lastRound
    );
    for (const e of lastRoundAgents) {
      if (e.agent_id) {
        // Check if this agent's effects mention improvement or worsening
        const effects = (e.effects || []).join(" ").toLowerCase();
        if (effects.includes("improv") || effects.includes("increas") || effects.includes("grow") || effects.includes("boost")) {
          trends[e.agent_id] = "up";
        } else if (effects.includes("declin") || effects.includes("reduc") || effects.includes("delay") || effects.includes("drop")) {
          trends[e.agent_id] = "down";
        } else {
          trends[e.agent_id] = kpiDirection as "up" | "down" | "neutral";
        }
      }
    }
    return trends;
  }, [simEvents, simKpi, simRound, twinSpec]);

  return (
    <div className="h-screen w-screen flex flex-col bg-zinc-950 text-zinc-100">
      {/* Header */}
      <header className="flex items-center justify-between px-6 py-3 border-b border-zinc-800 shrink-0">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-indigo-600 flex items-center justify-center text-sm font-bold">
            DT
          </div>
          <h1 className="text-lg font-semibold">DigiTwin</h1>
        </div>
        <div className="flex items-center gap-4 text-sm text-zinc-400">
          <span className={phase === "upload" ? "text-indigo-400 font-medium" : ""}>
            1. Upload
          </span>
          <span className="text-zinc-600">→</span>
          <span className={phase === "analysing" ? "text-indigo-400 font-medium" : ""}>
            2. Analyse
          </span>
          <span className="text-zinc-600">→</span>
          <span className={phase === "review" ? "text-indigo-400 font-medium" : ""}>
            3. Review
          </span>
          <span className="text-zinc-600">→</span>
          <span className={phase === "canvas" || phase === "simulating" ? "text-indigo-400 font-medium" : ""}>
            4. Sandbox
          </span>
        </div>
      </header>

      {/* LLM Debug Panel — always visible, bottom-right */}
      <LLMDebugPanel />

      {/* Main content */}
      <main className="flex-1 overflow-hidden min-h-0">
        {phase === "upload" && <UploadPanel />}

        {phase === "analysing" && (
          <div className="h-full flex flex-col">
            {/* Status bar */}
            <div className="flex items-center gap-4 px-6 py-3 border-b border-zinc-800 shrink-0">
              <div className="w-6 h-6 border-3 border-indigo-500 border-t-transparent rounded-full animate-spin shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium">Analysing documents...</p>
                <p className="text-xs text-zinc-400 truncate">
                  {analysisStage && `${analysisStage}: `}
                  {analysisDetail}
                </p>
              </div>
              {liveGraph && (
                <div className="text-xs text-zinc-500 shrink-0">
                  {liveGraph.entity_types.length} types · {liveGraph.relation_types.length} relations
                  {liveGraph.agents.length > 0 && ` · ${liveGraph.agents.length} agents`}
                </div>
              )}
            </div>
            {/* Live graph or placeholder */}
            <div className="flex-1">
              {liveGraph && (liveGraph.entity_types.length > 0 || liveGraph.agents.length > 0) ? (
                <LiveOntologyGraph data={liveGraph} stage={analysisStage} />
              ) : (
                <div className="flex flex-col items-center justify-center h-full gap-4">
                  <div className="w-12 h-12 border-4 border-indigo-500 border-t-transparent rounded-full animate-spin" />
                  <p className="text-sm text-zinc-400">Waiting for ontology data...</p>
                  <p className="text-xs text-zinc-500">
                    The graph will appear as entities and relationships are discovered
                  </p>
                </div>
              )}
            </div>
          </div>
        )}

        {phase === "review" && twinSpec && (
          <div className="h-full flex">
            {/* Main review area */}
            <div className="flex-1 flex flex-col min-w-0">
              <div className="p-6 border-b border-zinc-800 flex items-center justify-between shrink-0">
                <div>
                  <h2 className="text-xl font-semibold">
                    Extraction complete — {twinSpec.intent.domain}
                  </h2>
                  <p className="text-sm text-zinc-400 mt-1">
                    {twinSpec.agents.length} agents ·{" "}
                    {twinSpec.interactions.length} interactions ·{" "}
                    {twinSpec.tools.length} tools ·{" "}
                    {twinSpec.objectives.length} objectives
                  </p>
                </div>
                <button
                  onClick={() => useAppStore.getState().setPhase("canvas")}
                  className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 rounded-lg font-medium transition-colors"
                >
                  Open sandbox →
                </button>
              </div>
              <div className="flex-1 overflow-auto p-6">
                <pre className="text-xs text-zinc-300 bg-zinc-900 rounded-lg p-4 overflow-auto max-h-[70vh]">
                  {JSON.stringify(twinSpec, null, 2)}
                </pre>
              </div>
            </div>
            {/* Right panel — tabs for list vs manage (feature 3) */}
            <div className="w-80 border-l border-zinc-800 shrink-0 overflow-hidden flex flex-col">
              <div className="flex border-b border-zinc-800 shrink-0">
                <button
                  onClick={() => setReviewTab("list")}
                  className={`flex-1 py-2 text-xs font-medium transition-colors ${reviewTab === "list" ? "text-indigo-400 border-b-2 border-indigo-400" : "text-zinc-500 hover:text-zinc-300"}`}
                >
                  Agent List
                </button>
                <button
                  onClick={() => setReviewTab("manage")}
                  className={`flex-1 py-2 text-xs font-medium transition-colors ${reviewTab === "manage" ? "text-indigo-400 border-b-2 border-indigo-400" : "text-zinc-500 hover:text-zinc-300"}`}
                >
                  Manage
                </button>
              </div>
              {reviewTab === "list" ? (
                <AgentListPanel
                  agents={twinSpec.agents}
                  selectedId={useAppStore.getState().selectedAgentId}
                  onSelect={useAppStore.getState().selectAgent}
                />
              ) : (
                <AgentManagePanel agents={twinSpec.agents} />
              )}
            </div>
          </div>
        )}

        {(phase === "canvas" || phase === "simulating") && twinSpec && (
          <div className="h-full flex" style={{ height: "100%" }}>
            {/* Left: Analytics panel — resizable (feature 5) */}
            <div
              className="border-r border-zinc-800 shrink-0 overflow-hidden"
              style={{ width: leftWidth }}
            >
              <SimAnalyticsPanel
                twinSpec={twinSpec}
                events={simEvents}
                kpiHistory={simKpi}
                insights={simInsights}
                round={simRound}
                totalRounds={simTotal}
                running={simRunning}
              />
            </div>
            {/* Resize handle (feature 5) */}
            <div
              className="w-1 bg-zinc-800 hover:bg-indigo-600 cursor-col-resize transition-colors shrink-0"
              onMouseDown={handleMouseDown}
            />
            {/* Centre: Canvas — with insights overlay (feature 6) */}
            <div className="flex-1 min-w-0 h-full">
              <TwinCanvas
                twinSpec={twinSpec}
                insights={!simRunning ? simInsights : null}
                agentKpiTrends={agentKpiTrends}
              />
            </div>
            {/* Right: Simulation controls */}
            <div className="w-64 border-l border-zinc-800 shrink-0 overflow-hidden flex flex-col">
              <SimulationPanel
                twinSpec={twinSpec}
                extractionId={useAppStore.getState().extractionId ?? ""}
                onEventsChange={setSimEvents}
                onKpiChange={setSimKpi}
                onInsights={(i) => { setSimInsights(i); }}
                onRoundChange={(r, t) => { setSimRound(r); setSimTotal(t); }}
                onRunningChange={setSimRunning}
              />
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
