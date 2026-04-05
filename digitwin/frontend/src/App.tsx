import { useEffect, useRef, useState } from "react";
import { useAppStore } from "./stores/appStore";
import UploadPanel from "./components/panels/UploadPanel";
import TwinCanvas from "./components/canvas/TwinCanvas";
import LLMDebugPanel from "./components/panels/LLMDebugPanel";
import AgentListPanel from "./components/panels/AgentListPanel";
import SimulationPanel from "./components/panels/SimulationPanel";
import SimAnalyticsPanel from "./components/panels/SimAnalyticsPanel";
import type { SimEvent, SimInsights } from "./components/panels/SimAnalyticsPanel";
import { pollJobStatus, fetchExtractionResult } from "./api/client";
import toast from "react-hot-toast";

export default function App() {
  const phase = useAppStore((s) => s.phase);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // If URL has ?job=<id>, auto-start polling that job
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const jobId = params.get("job");
    if (!jobId || phase !== "upload") return;

    const { setPhase, setAnalysisProgress, setExtraction } = useAppStore.getState();
    setPhase("analysing");
    setAnalysisProgress("connecting", "Reconnecting to running job...");

    pollRef.current = setInterval(async () => {
      try {
        const status = await pollJobStatus(jobId);
        setAnalysisProgress(status.stage ?? "", status.detail ?? "Processing...");

        if (status.status === "complete") {
          clearInterval(pollRef.current!);
          const result = await fetchExtractionResult(jobId);
          setExtraction(result.extraction_id, result.data);
          toast.success(`Extracted ${result.data.agents.length} agents`);
          window.history.replaceState({}, "", "/");
        } else if (status.status === "failed") {
          clearInterval(pollRef.current!);
          toast.error(status.error || "Extraction failed");
          setPhase("upload");
        }
      } catch (err: any) {
        // 404 = job gone (backend restarted) — stop polling and go to upload
        if (err?.response?.status === 404 || err?.response?.status === 422) {
          clearInterval(pollRef.current!);
          window.history.replaceState({}, "", "/");
          setPhase("upload");
          toast.error("Job not found — please re-upload your document.");
        }
        console.error("Poll error:", err);
      }
    }, 5_000);

    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, []);

  const twinSpec = useAppStore((s) => s.twinSpec);
  const analysisStage = useAppStore((s) => s.analysisStage);
  const analysisDetail = useAppStore((s) => s.analysisDetail);

  // Simulation state shared between SimulationPanel and SimAnalyticsPanel
  const [simEvents, setSimEvents] = useState<SimEvent[]>([]);
  const [simKpi, setSimKpi] = useState<Record<string, number[]>>({});
  const [simInsights, setSimInsights] = useState<SimInsights | null>(null);
  const [simRound, setSimRound] = useState(0);
  const [simTotal, setSimTotal] = useState(10);
  const [simRunning, setSimRunning] = useState(false);

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
          <span
            className={
              phase === "upload" ? "text-indigo-400 font-medium" : ""
            }
          >
            1. Upload
          </span>
          <span className="text-zinc-600">→</span>
          <span
            className={
              phase === "analysing" ? "text-indigo-400 font-medium" : ""
            }
          >
            2. Analyse
          </span>
          <span className="text-zinc-600">→</span>
          <span
            className={
              phase === "review" ? "text-indigo-400 font-medium" : ""
            }
          >
            3. Review
          </span>
          <span className="text-zinc-600">→</span>
          <span
            className={
              phase === "canvas" || phase === "simulating"
                ? "text-indigo-400 font-medium"
                : ""
            }
          >
            4. Sandbox
          </span>
        </div>
      </header>

      {/* LLM Debug Panel — always visible, bottom-right */}
      <LLMDebugPanel />

      {/* Main content */}
      <main className="flex-1 overflow-hidden">
        {phase === "upload" && <UploadPanel />}

        {phase === "analysing" && (
          <div className="flex flex-col items-center justify-center h-full gap-4">
            <div className="w-12 h-12 border-4 border-indigo-500 border-t-transparent rounded-full animate-spin" />
            <p className="text-lg font-medium">Analysing documents...</p>
            <p className="text-sm text-zinc-400">
              {analysisStage && `${analysisStage}: `}
              {analysisDetail}
            </p>
            <p className="text-xs text-zinc-500 mt-2">
              This may take 1-3 minutes with a local Gemma 4 model
            </p>
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
            {/* Agent list panel — right side */}
            <div className="w-72 border-l border-zinc-800 shrink-0 overflow-hidden">
              <AgentListPanel
                agents={twinSpec.agents}
                selectedId={useAppStore.getState().selectedAgentId}
                onSelect={useAppStore.getState().selectAgent}
              />
            </div>
          </div>
        )}

        {(phase === "canvas" || phase === "simulating") && twinSpec && (
          <div className="h-full flex">
            {/* Left: Analytics panel */}
            <div className="w-80 border-r border-zinc-800 shrink-0 overflow-hidden">
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
            {/* Centre: Canvas */}
            <div className="flex-1 min-w-0">
              <TwinCanvas twinSpec={twinSpec} />
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
