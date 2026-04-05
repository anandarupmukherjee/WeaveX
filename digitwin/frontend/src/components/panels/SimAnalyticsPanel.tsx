import { useMemo, useState } from "react";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, BarChart, Bar,
} from "recharts";
import type { TwinSpec } from "../../types";
import KpiDrilldown from "./KpiDrilldown";

export interface SimEvent {
  type: string;
  ts: string;
  round?: number;
  agent_name?: string;
  agent_id?: string;
  entity_type?: string;
  action?: string;
  reasoning?: string;
  effects?: string[];
  kpis?: Record<string, number>;
  event?: string;
}

export interface Recommendation {
  title: string;
  detail: string;
  priority: "high" | "medium" | "low";
}

export interface SimInsights {
  summary: string;
  trends: string[];
  recommendations: Recommendation[];
  outlook: string;
}

interface Props {
  twinSpec: TwinSpec;
  events: SimEvent[];
  kpiHistory: Record<string, number[]>;
  insights: SimInsights | null;
  round: number;
  totalRounds: number;
  running: boolean;
}

const KPI_COLORS = ["#6366f1", "#10b981", "#f59e0b", "#ec4899", "#06b6d4"];

function buildTimeLabels(timeHorizon: string, totalRounds: number): string[] {
  if (!timeHorizon) return Array.from({ length: totalRounds }, (_, i) => `R${i + 1}`);
  const h = timeHorizon.toLowerCase();

  const quarterMatch = h.match(/q(\d)-?q?(\d)?\s*(\d{4})?/);
  if (quarterMatch) {
    const startQ = parseInt(quarterMatch[1]);
    const year = quarterMatch[3] ? parseInt(quarterMatch[3]) : new Date().getFullYear();
    const labels: string[] = [];
    let q = startQ, y = year;
    for (let i = 0; i < totalRounds; i++) {
      labels.push(`Q${q} ${y}`); q++; if (q > 4) { q = 1; y++; }
    }
    return labels;
  }

  const yearRangeMatch = h.match(/(\d{4})\s*[-–]\s*(\d{4})/);
  if (yearRangeMatch) {
    const startY = parseInt(yearRangeMatch[1]);
    return Array.from({ length: totalRounds }, (_, i) => `${startY + i}`);
  }
  if (h.match(/(\d+)[-\s]?year/)) return Array.from({ length: totalRounds }, (_, i) => `Y${i + 1}`);
  if (h.includes("month")) {
    const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
    const startM = new Date().getMonth();
    return Array.from({ length: totalRounds }, (_, i) => months[(startM + i) % 12]);
  }
  if (h.includes("week")) return Array.from({ length: totalRounds }, (_, i) => `Wk${i + 1}`);
  if (h.includes("annual") || h.includes("year")) {
    const startY = new Date().getFullYear();
    return Array.from({ length: totalRounds }, (_, i) => `${startY + i}`);
  }
  return Array.from({ length: totalRounds }, (_, i) => `R${i + 1}`);
}

export default function SimAnalyticsPanel({
  twinSpec, events, kpiHistory, insights, round, totalRounds, running,
}: Props) {
  const [drilldownKpi, setDrilldownKpi] = useState<string | null>(null);

  const timeHorizon = twinSpec.objectives[0]?.time_horizon ?? "";
  const timeLabels = useMemo(
    () => buildTimeLabels(timeHorizon, Math.max(Object.values(kpiHistory).reduce((m, v) => Math.max(m, v.length), 0), totalRounds)),
    [timeHorizon, kpiHistory, totalRounds]
  );

  const kpiChartData = useMemo(() => {
    const maxRounds = Math.max(...Object.values(kpiHistory).map((v) => v.length), 0);
    return Array.from({ length: maxRounds }, (_, i) => {
      const pt: Record<string, number | string> = { label: timeLabels[i] ?? `R${i + 1}` };
      for (const [k, vals] of Object.entries(kpiHistory)) {
        if (vals[i] !== undefined) pt[k] = Math.round(vals[i] * 10) / 10;
      }
      return pt;
    });
  }, [kpiHistory, timeLabels]);

  const agentActionCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const ev of events) {
      if (ev.type === "agent_action" && ev.agent_name)
        counts[ev.agent_name] = (counts[ev.agent_name] ?? 0) + 1;
    }
    return Object.entries(counts)
      .sort((a, b) => b[1] - a[1])
      .map(([name, count]) => ({ name: name.length > 18 ? name.slice(0, 16) + "…" : name, count }));
  }, [events]);

  const recentActions = useMemo(() =>
    events.filter((e) => e.type === "agent_action").slice(-8).reverse(),
    [events]
  );

  const hasData = kpiChartData.length > 0;

  // Find the objective for the drilldown KPI
  const drilldownObj = drilldownKpi ? twinSpec.objectives.find((o) => o.kpi === drilldownKpi) : null;

  return (
    <div className="h-full flex flex-col overflow-y-auto bg-zinc-950 text-zinc-200">
      {/* Header */}
      <div className="px-4 py-3 border-b border-zinc-800 shrink-0">
        <h3 className="text-sm font-semibold">Analytics</h3>
        {running && (
          <p className="text-xs text-zinc-500 mt-0.5">
            Round {round} / {totalRounds} — live
          </p>
        )}
      </div>

      {!hasData && !insights && (
        <p className="text-xs text-zinc-600 text-center p-8">
          Run the simulation to see analytics here.
        </p>
      )}

      {/* KPI line charts — clickable (feature 8) */}
      {hasData && (
        <div className="px-4 pt-4 pb-2 shrink-0">
          <p className="text-xs font-semibold text-zinc-400 mb-3">
            KPI Trends
            {!running && hasData && <span className="text-zinc-600 font-normal ml-2">click chart to drill down</span>}
          </p>
          <div className="space-y-4">
            {twinSpec.objectives.map((obj, oi) => {
              const vals = kpiHistory[obj.kpi];
              if (!vals || vals.length === 0) return null;
              const color = KPI_COLORS[oi % KPI_COLORS.length];
              const latest = vals[vals.length - 1];
              const first = vals[0];
              const delta = latest - first;
              const better = obj.target_direction === "minimize" ? delta < 0 : delta > 0;
              return (
                <div
                  key={obj.kpi}
                  onClick={() => !running && setDrilldownKpi(obj.kpi)}
                  className={!running ? "cursor-pointer hover:bg-zinc-900/50 rounded-lg p-1 -m-1 transition-colors" : ""}
                >
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs text-zinc-300 truncate max-w-[160px]">{obj.name}</span>
                    <span className={`text-xs font-mono ${better ? "text-green-400" : "text-red-400"}`}>
                      {latest.toFixed(1)} {delta >= 0 ? "▲" : "▼"}{Math.abs(delta).toFixed(1)}
                    </span>
                  </div>
                  <ResponsiveContainer width="100%" height={60}>
                    <LineChart data={kpiChartData} margin={{ top: 2, right: 4, bottom: 0, left: -28 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
                      <XAxis dataKey="label" tick={{ fontSize: 9, fill: "#52525b" }} />
                      <YAxis tick={{ fontSize: 9, fill: "#52525b" }} />
                      <Tooltip contentStyle={{ background: "#18181b", border: "1px solid #3f3f46", fontSize: 11 }} />
                      <Line type="monotone" dataKey={obj.kpi} stroke={color} strokeWidth={2} dot={false} />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Agent activity bar chart */}
      {agentActionCounts.length > 0 && (
        <div className="px-4 pt-3 pb-2 border-t border-zinc-800 shrink-0">
          <p className="text-xs font-semibold text-zinc-400 mb-3">Agent Activity</p>
          <ResponsiveContainer width="100%" height={Math.max(80, agentActionCounts.length * 22)}>
            <BarChart data={agentActionCounts} layout="vertical" margin={{ top: 0, right: 20, bottom: 0, left: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#27272a" horizontal={false} />
              <XAxis type="number" tick={{ fontSize: 9, fill: "#52525b" }} />
              <YAxis type="category" dataKey="name" tick={{ fontSize: 9, fill: "#a1a1aa" }} width={100} />
              <Tooltip contentStyle={{ background: "#18181b", border: "1px solid #3f3f46", fontSize: 11 }} />
              <Bar dataKey="count" fill="#6366f1" radius={[0, 3, 3, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Recent actions feed */}
      {recentActions.length > 0 && (
        <div className="px-4 pt-3 pb-2 border-t border-zinc-800 shrink-0">
          <p className="text-xs font-semibold text-zinc-400 mb-2">Recent Actions</p>
          <div className="space-y-2">
            {recentActions.map((ev, i) => (
              <div key={i} className="border border-zinc-800 rounded px-2.5 py-2 bg-zinc-900/50">
                <div className="flex items-center gap-1.5 mb-0.5">
                  <div className="w-1.5 h-1.5 rounded-full bg-indigo-400 shrink-0" />
                  <span className="text-xs font-medium text-zinc-200 truncate">{ev.agent_name}</span>
                  <span className="text-xs text-zinc-600 ml-auto shrink-0">R{ev.round}</span>
                </div>
                <p className="text-xs text-zinc-400 leading-relaxed">{ev.action}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* KPI Drilldown modal (feature 8) */}
      {drilldownKpi && drilldownObj && kpiHistory[drilldownKpi] && (
        <KpiDrilldown
          kpiName={drilldownKpi}
          kpiLabel={drilldownObj.name}
          values={kpiHistory[drilldownKpi]}
          events={events}
          labels={timeLabels}
          onClose={() => setDrilldownKpi(null)}
        />
      )}
    </div>
  );
}
