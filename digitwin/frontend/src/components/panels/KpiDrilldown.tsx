import { useMemo } from "react";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, ReferenceDot,
} from "recharts";
import { X } from "lucide-react";
import type { SimEvent } from "./SimAnalyticsPanel";

interface Props {
  kpiName: string;
  kpiLabel: string;
  values: number[];
  events: SimEvent[];
  labels: string[];
  onClose: () => void;
}

interface RoundAnalysis {
  round: number;
  label: string;
  value: number;
  delta: number;
  direction: "up" | "down" | "flat";
  actors: string[];
  decisions: string[];
  effects: string[];
  bottlenecks: string[];
}

export default function KpiDrilldown({ kpiName, kpiLabel, values, events, labels, onClose }: Props) {
  // Build per-round analysis
  const roundAnalysis: RoundAnalysis[] = useMemo(() => {
    return values.map((val, i) => {
      const prev = i > 0 ? values[i - 1] : val;
      const delta = val - prev;
      const round = i + 1;

      // Get agent actions for this round
      const roundActions = events.filter(
        (e) => e.type === "agent_action" && e.round === round
      );

      const actors = [...new Set(roundActions.map((a) => a.agent_name || "Unknown"))];
      const decisions = roundActions.map((a) => `${a.agent_name}: ${a.action}`);
      const effects = roundActions.flatMap((a) => a.effects || []);

      // Identify bottlenecks: agents whose actions have negative effects or who repeat
      const bottlenecks: string[] = [];
      for (const a of roundActions) {
        if (a.effects?.some((e) => e.toLowerCase().includes("delay") || e.toLowerCase().includes("block") || e.toLowerCase().includes("reduce"))) {
          bottlenecks.push(`${a.agent_name}: ${a.effects?.join(", ")}`);
        }
      }

      // Check for injected scenarios
      const injected = events.filter((e) => e.type === "scenario_injected" && e.round === round);
      if (injected.length > 0) {
        effects.push(...injected.map((e) => `[Scenario] ${e.event}`));
      }

      return {
        round,
        label: labels[i] ?? `R${round}`,
        value: val,
        delta,
        direction: Math.abs(delta) < 0.01 ? "flat" as const : delta > 0 ? "up" as const : "down" as const,
        actors,
        decisions: decisions.slice(0, 5),
        effects: effects.slice(0, 5),
        bottlenecks: bottlenecks.slice(0, 3),
      };
    });
  }, [values, events, labels]);

  const chartData = roundAnalysis.map((r) => ({
    label: r.label,
    value: Math.round(r.value * 10) / 10,
    round: r.round,
  }));

  // Detect significant changes for highlighting
  const significantRounds = roundAnalysis.filter((r) => Math.abs(r.delta) > (values[0] || 1) * 0.1);

  return (
    <div className="fixed inset-0 z-[100] bg-black/70 flex items-center justify-center p-8">
      <div className="bg-zinc-900 border border-zinc-700 rounded-xl shadow-2xl w-full max-w-4xl max-h-[90vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-800 shrink-0">
          <div>
            <h2 className="text-lg font-semibold text-zinc-100">{kpiLabel}</h2>
            <p className="text-xs text-zinc-500 mt-0.5">
              KPI: {kpiName} · {values.length} data points · Click on chart points for details
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-2 hover:bg-zinc-800 rounded-lg transition-colors"
          >
            <X className="w-5 h-5 text-zinc-400" />
          </button>
        </div>

        {/* Large chart */}
        <div className="px-6 pt-4 pb-2 shrink-0">
          <ResponsiveContainer width="100%" height={200}>
            <LineChart data={chartData} margin={{ top: 10, right: 20, bottom: 5, left: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
              <XAxis dataKey="label" tick={{ fontSize: 11, fill: "#a1a1aa" }} />
              <YAxis tick={{ fontSize: 11, fill: "#a1a1aa" }} />
              <Tooltip
                contentStyle={{ background: "#18181b", border: "1px solid #3f3f46", fontSize: 12 }}
              />
              <Line
                type="monotone" dataKey="value"
                stroke="#6366f1" strokeWidth={3} dot={{ fill: "#6366f1", r: 5 }}
                activeDot={{ r: 8, fill: "#818cf8" }}
              />
              {/* Highlight significant change points */}
              {significantRounds.map((r) => (
                <ReferenceDot
                  key={r.round}
                  x={r.label} y={Math.round(r.value * 10) / 10}
                  r={8}
                  fill={r.direction === "up" ? "#10b981" : "#ef4444"}
                  stroke="none"
                />
              ))}
            </LineChart>
          </ResponsiveContainer>
        </div>

        {/* Round-by-round breakdown */}
        <div className="flex-1 overflow-y-auto px-6 pb-6">
          <p className="text-xs font-semibold text-zinc-400 mb-3 mt-2">Round-by-Round Analysis</p>
          <div className="space-y-3">
            {roundAnalysis.map((r) => (
              <div
                key={r.round}
                className={`border rounded-lg px-4 py-3 ${
                  r.direction === "up"
                    ? "border-emerald-800/50 bg-emerald-950/20"
                    : r.direction === "down"
                    ? "border-red-800/50 bg-red-950/20"
                    : "border-zinc-800 bg-zinc-900/40"
                }`}
              >
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-medium text-zinc-200">
                    {r.label}
                  </span>
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-mono text-zinc-300">{r.value.toFixed(1)}</span>
                    {r.direction !== "flat" && (
                      <span className={`text-xs font-bold ${r.direction === "up" ? "text-green-400" : "text-red-400"}`}>
                        {r.direction === "up" ? "▲" : "▼"} {Math.abs(r.delta).toFixed(1)}
                      </span>
                    )}
                  </div>
                </div>

                {/* Key actors */}
                {r.actors.length > 0 && (
                  <div className="mb-1.5">
                    <span className="text-[10px] font-semibold text-zinc-500 uppercase">Actors: </span>
                    <span className="text-xs text-zinc-400">{r.actors.join(", ")}</span>
                  </div>
                )}

                {/* Key decisions */}
                {r.decisions.length > 0 && (
                  <div className="mb-1.5">
                    <span className="text-[10px] font-semibold text-zinc-500 uppercase">Decisions:</span>
                    <ul className="mt-1 space-y-0.5">
                      {r.decisions.map((d, di) => (
                        <li key={di} className="text-xs text-zinc-400 flex gap-1.5">
                          <span className="text-indigo-400 shrink-0">•</span> {d}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {/* Effects to watch */}
                {r.effects.length > 0 && (
                  <div className="mb-1.5">
                    <span className="text-[10px] font-semibold text-zinc-500 uppercase">Effects:</span>
                    <ul className="mt-1 space-y-0.5">
                      {r.effects.map((e, ei) => (
                        <li key={ei} className="text-xs text-amber-400/80 flex gap-1.5">
                          <span className="shrink-0">⚡</span> {e}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {/* Bottlenecks */}
                {r.bottlenecks.length > 0 && (
                  <div>
                    <span className="text-[10px] font-semibold text-red-400 uppercase">Bottlenecks:</span>
                    <ul className="mt-1 space-y-0.5">
                      {r.bottlenecks.map((b, bi) => (
                        <li key={bi} className="text-xs text-red-400/80 flex gap-1.5">
                          <span className="shrink-0">⚠</span> {b}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
