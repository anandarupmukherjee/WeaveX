import { useState, useRef, useCallback } from "react";
import type { TwinSpec } from "../../types";
import type { SimEvent, SimInsights } from "./SimAnalyticsPanel";
import { useAppStore } from "../../stores/appStore";
import api from "../../api/client";

interface KpiHistory {
  [kpi: string]: number[];
}

interface Props {
  twinSpec: TwinSpec;
  extractionId: string;
  onEventsChange: (events: SimEvent[]) => void;
  onKpiChange: (kpi: KpiHistory) => void;
  onInsights: (insights: SimInsights) => void;
  onRoundChange: (round: number, total: number) => void;
  onRunningChange: (running: boolean) => void;
}

const TIMELINE_PRESETS = [
  { label: "Quarterly", value: "Q1-Q4" },
  { label: "Monthly", value: "monthly" },
  { label: "Weekly", value: "weekly" },
  { label: "Annual", value: "annual" },
  { label: "5-Year", value: "5-year" },
];

export default function SimulationPanel({
  twinSpec, extractionId,
  onEventsChange, onKpiChange, onInsights, onRoundChange, onRunningChange,
}: Props) {
  const [simId, setSimId] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [paused, setPaused] = useState(false);
  const [round, setRound] = useState(0);
  const [totalRounds, setTotalRounds] = useState(10);
  const [scenarioInput, setScenarioInput] = useState("");
  const [showScenario, setShowScenario] = useState(false);
  const [showTimeline, setShowTimeline] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);
  const eventsRef = useRef<SimEvent[]>([]);
  const kpiRef = useRef<KpiHistory>({});

  const simTimeline = useAppStore((s) => s.simTimeline);
  const setSimTimeline = useAppStore((s) => s.setSimTimeline);
  const setActiveAgent = useAppStore((s) => s.setActiveAgent);

  const setRunningState = (r: boolean) => {
    setRunning(r);
    onRunningChange(r);
  };

  const connectWs = useCallback((id: string, total: number) => {
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const ws = new WebSocket(`${protocol}//${window.location.host}/ws/simulation/${id}`);
    wsRef.current = ws;

    ws.onmessage = (e) => {
      const ev: SimEvent & { insights?: SimInsights } = JSON.parse(e.data);

      if (ev.type === "round_start") {
        setRound(ev.round ?? 0);
        onRoundChange(ev.round ?? 0, total);
      }

      // Feature 1: blink agent on canvas when it acts
      if (ev.type === "agent_action" && ev.agent_id) {
        setActiveAgent(ev.agent_id);
      }

      if (ev.type === "kpi_update" && ev.kpis) {
        const next = { ...kpiRef.current };
        for (const [k, v] of Object.entries(ev.kpis)) {
          next[k] = [...(next[k] ?? []), v as number];
        }
        kpiRef.current = next;
        onKpiChange({ ...next });
      }

      if (ev.type === "sim_complete") {
        setRunningState(false);
        setPaused(false);
        if (ev.insights) onInsights(ev.insights);
      }

      if (["agent_action", "scenario_injected", "round_complete", "sim_started", "sim_complete"].includes(ev.type)) {
        eventsRef.current = [...eventsRef.current.slice(-199), ev];
        onEventsChange([...eventsRef.current]);
      }
    };

    ws.onerror = () => setRunningState(false);
  }, []);

  const handleStart = async () => {
    try {
      const res = await api.post("/simulation/start", {
        extraction_id: extractionId,
        rounds: totalRounds,
        timeline: simTimeline || undefined,
      });
      const id = res.data.simulation_id;
      setSimId(id);
      eventsRef.current = [];
      kpiRef.current = {};
      onEventsChange([]);
      onKpiChange({});
      setRound(0);
      onRoundChange(0, totalRounds);
      setRunningState(true);
      setPaused(false);
      connectWs(id, totalRounds);
    } catch (err) {
      console.error("Failed to start simulation", err);
    }
  };

  const handlePause = async () => {
    if (!simId) return;
    await api.post(`/simulation/${simId}/pause`);
    setPaused(true);
  };

  const handleResume = async () => {
    if (!simId) return;
    await api.post(`/simulation/${simId}/resume`);
    setPaused(false);
  };

  const handleStop = async () => {
    if (!simId) return;
    await api.post(`/simulation/${simId}/stop`);
    setRunningState(false);
    wsRef.current?.close();
  };

  // Feature 4: fix inject — use correct API path
  const handleInject = async () => {
    if (!simId || !scenarioInput.trim()) return;
    try {
      await api.post(`/simulation/${simId}/inject-event`, { event: scenarioInput });
      setScenarioInput("");
      setShowScenario(false);
    } catch (err) {
      console.error("Inject failed:", err);
    }
  };

  return (
    <div className="flex flex-col h-full bg-zinc-950">
      {/* Header */}
      <div className="px-4 py-3 border-b border-zinc-800 shrink-0">
        <div className="flex items-center justify-between mb-3">
          <div>
            <h3 className="text-sm font-semibold text-zinc-200">Simulation</h3>
            {running && (
              <p className="text-xs text-zinc-500 mt-0.5">Round {round} / {totalRounds}</p>
            )}
          </div>
          {!running && (
            <div className="flex items-center gap-2 text-xs text-zinc-400">
              <span>Rounds:</span>
              <input
                type="range" min={3} max={20} value={totalRounds}
                onChange={(e) => setTotalRounds(Number(e.target.value))}
                className="w-16 accent-indigo-500"
              />
              <span className="w-4">{totalRounds}</span>
            </div>
          )}
        </div>

        {/* Timeline selector (feature 7) */}
        {!running && (
          <div className="mb-3">
            <button
              onClick={() => setShowTimeline(!showTimeline)}
              className="text-xs text-zinc-400 hover:text-zinc-200 transition-colors flex items-center gap-1"
            >
              <span>Timeline: {simTimeline || "auto (from document)"}</span>
              <span className="text-zinc-600">{showTimeline ? "▲" : "▼"}</span>
            </button>
            {showTimeline && (
              <div className="mt-2 space-y-2">
                <div className="flex flex-wrap gap-1.5">
                  {TIMELINE_PRESETS.map((p) => (
                    <button
                      key={p.value}
                      onClick={() => setSimTimeline(p.value)}
                      className={`text-[10px] px-2 py-1 rounded transition-colors ${
                        simTimeline === p.value
                          ? "bg-indigo-600 text-white"
                          : "bg-zinc-800 text-zinc-400 hover:bg-zinc-700"
                      }`}
                    >
                      {p.label}
                    </button>
                  ))}
                </div>
                <input
                  value={simTimeline}
                  onChange={(e) => setSimTimeline(e.target.value)}
                  placeholder="Custom: e.g. Q1-Q4 2025, 2024-2029..."
                  className="w-full text-xs bg-zinc-800 border border-zinc-700 rounded px-2 py-1.5 focus:outline-none focus:border-indigo-500 placeholder-zinc-600"
                />
              </div>
            )}
          </div>
        )}

        {running && (
          <div className="w-full bg-zinc-800 rounded-full h-1 mb-3">
            <div
              className="bg-indigo-500 h-1 rounded-full transition-all duration-300"
              style={{ width: `${(round / totalRounds) * 100}%` }}
            />
          </div>
        )}

        <div className="flex gap-2">
          {!running && (
            <button onClick={handleStart}
              className="flex-1 py-1.5 text-xs bg-indigo-600 hover:bg-indigo-500 rounded-lg font-medium transition-colors">
              ▶ Run simulation
            </button>
          )}
          {running && !paused && (
            <button onClick={handlePause}
              className="flex-1 py-1.5 text-xs bg-zinc-700 hover:bg-zinc-600 rounded-lg transition-colors">
              ⏸ Pause
            </button>
          )}
          {running && paused && (
            <button onClick={handleResume}
              className="flex-1 py-1.5 text-xs bg-indigo-600 hover:bg-indigo-500 rounded-lg transition-colors">
              ▶ Resume
            </button>
          )}
          {running && (
            <button onClick={handleStop}
              className="py-1.5 px-3 text-xs bg-red-900/60 hover:bg-red-800 rounded-lg transition-colors">
              ■
            </button>
          )}
          {running && (
            <button onClick={() => setShowScenario((s) => !s)}
              className="py-1.5 px-3 text-xs bg-amber-900/60 hover:bg-amber-800 rounded-lg transition-colors"
              title="Inject scenario">
              ⚡
            </button>
          )}
        </div>

        {showScenario && (
          <div className="mt-2 flex gap-2">
            <input
              value={scenarioInput}
              onChange={(e) => setScenarioInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleInject()}
              placeholder="Describe a scenario event..."
              className="flex-1 text-xs bg-zinc-800 border border-zinc-700 rounded px-2 py-1.5 focus:outline-none focus:border-amber-500 placeholder-zinc-600"
            />
            <button onClick={handleInject}
              className="text-xs bg-amber-700 hover:bg-amber-600 rounded px-2 py-1.5 transition-colors">
              Inject
            </button>
          </div>
        )}
      </div>

      {/* Live event feed */}
      <div className="flex-1 overflow-y-auto p-3 space-y-1.5">
        {eventsRef.current.length === 0 && (
          <p className="text-xs text-zinc-600 text-center pt-8">
            {running ? "Waiting for agents…" : "Press Run to start."}
          </p>
        )}
      </div>
    </div>
  );
}
