import { useMemo } from "react";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, BarChart, Bar, Legend,
} from "recharts";
import type { TwinSpec } from "../../types";

export interface SimEvent {
  type: string;
  ts: string;
  round?: number;
  agent_name?: string;
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

const PRIORITY_STYLES: Record<string, string> = {
  high: "border-red-700 bg-red-950/30",
  medium: "border-amber-700 bg-amber-950/20",
  low: "border-zinc-700 bg-zinc-900/40",
};
const PRIORITY_DOT: Record<string, string> = {
  high: "bg-red-400",
  medium: "bg-amber-400",
  low: "bg-zinc-500",
};

/**
 * Build time-based labels for rounds given a time_horizon string.
 * E.g. "Q1-Q4 2025" with 4 rounds → ["Q1 2025","Q2 2025","Q3 2025","Q4 2025"]
 * Falls back to "Round N" if no recognised pattern.
 */
function buildTimeLabels(timeHorizon: string, totalRounds: number): string[] {
  if (!timeHorizon) return Array.from({ length: totalRounds }, (_, i) => `R${i + 1}`);

  const h = timeHorizon.toLowerCase();

  // Detect quarters pattern (e.g. "Q1-Q4 2025", "Q1 2025")
  const quarterMatch = h.match(/q(\d)-?q?(\d)?\s*(\d{4})?/);
  if (quarterMatch) {
    const startQ = parseInt(quarterMatch[1]);
    const endQ = quarterMatch[2] ? parseInt(quarterMatch[2]) : startQ + totalRounds - 1;
    const year = quarterMatch[3] ? parseInt(quarterMatch[3]) : new Date().getFullYear();
    const labels: string[] = [];
    let q = startQ;
    let y = year;
    for (let i = 0; i < totalRounds; i++) {
      labels.push(`Q${q} ${y}`);
      q++;
      if (q > 4) { q = 1; y++; }
    }
    return labels;
  }

  // Detect year-range (e.g. "2024-2029", "5-year", "5 year")
  const yearRangeMatch = h.match(/(\d{4})\s*[-–]\s*(\d{4})/);
  if (yearRangeMatch) {
    const startY = parseInt(yearRangeMatch[1]);
    return Array.from({ length: totalRounds }, (_, i) => `${startY + i}`);
  }
  const nYearMatch = h.match(/(\d+)[-\s]?year/);
  if (nYearMatch) {
    const startY = new Date().getFullYear();
    return Array.from({ length: totalRounds }, (_, i) => `Y${i + 1}`);
  }

  // Monthly
  if (h.includes("month")) {
    const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
    const startM = new Date().getMonth();
    return Array.from({ length: totalRounds }, (_, i) => months[(startM + i) % 12]);
  }

  // Weekly
  if (h.includes("week")) {
    return Array.from({ length: totalRounds }, (_, i) => `Wk${i + 1}`);
  }

  // Annual / yearly
  if (h.includes("annual") || h.includes("year")) {
    const startY = new Date().getFullYear();
    return Array.from({ length: totalRounds }, (_, i) => `${startY + i}`);
  }

  return Array.from({ length: totalRounds }, (_, i) => `R${i + 1}`);
}

export default function SimAnalyticsPanel({
  twinSpec, events, kpiHistory, insights, round, totalRounds, running,
}: Props) {

  // Build per-round KPI data for line chart with time-based labels
  const kpiChartData = useMemo(() => {
    const maxRounds = Math.max(...Object.values(kpiHistory).map((v) => v.length), 0);
    // Use the first objective's time_horizon for labeling
    const timeHorizon = twinSpec.objectives[0]?.time_horizon ?? "";
    const labels = buildTimeLabels(timeHorizon, Math.max(maxRounds, totalRounds));
    return Array.from({ length: maxRounds }, (_, i) => {
      const pt: Record<string, number | string> = { label: labels[i] ?? `R${i + 1}` };
      for (const [k, vals] of Object.entries(kpiHistory)) {
        if (vals[i] !== undefined) pt[k] = Math.round(vals[i] * 10) / 10;
      }
      return pt;
    });
  }, [kpiHistory, twinSpec.objectives, totalRounds]);

  // Action count per agent
  const agentActionCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const ev of events) {
      if (ev.type === "agent_action" && ev.agent_name) {
        counts[ev.agent_name] = (counts[ev.agent_name] ?? 0) + 1;
      }
    }
    return Object.entries(counts)
      .sort((a, b) => b[1] - a[1])
      .map(([name, count]) => ({ name: name.length > 18 ? name.slice(0, 16) + "…" : name, count }));
  }, [events]);

  // Recent action events only
  const recentActions = useMemo(() =>
    events.filter((e) => e.type === "agent_action").slice(-8).reverse(),
    [events]
  );

  const kpiKeys = Object.keys(kpiHistory);
  const hasData = kpiChartData.length > 0;

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

      {/* KPI line charts */}
      {hasData && (
        <div className="px-4 pt-4 pb-2 shrink-0">
          <p className="text-xs font-semibold text-zinc-400 mb-3">KPI Trends</p>
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
                <div key={obj.kpi}>
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
                      <Tooltip
                        contentStyle={{ background: "#18181b", border: "1px solid #3f3f46", fontSize: 11 }}
                      />
                      <Line
                        type="monotone" dataKey={obj.kpi}
                        stroke={color} strokeWidth={2} dot={false}
                      />
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
            <BarChart
              data={agentActionCounts}
              layout="vertical"
              margin={{ top: 0, right: 20, bottom: 0, left: 0 }}
            >
              <CartesianGrid strokeDasharray="3 3" stroke="#27272a" horizontal={false} />
              <XAxis type="number" tick={{ fontSize: 9, fill: "#52525b" }} />
              <YAxis type="category" dataKey="name" tick={{ fontSize: 9, fill: "#a1a1aa" }} width={100} />
              <Tooltip
                contentStyle={{ background: "#18181b", border: "1px solid #3f3f46", fontSize: 11 }}
              />
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

      {/* Insights — recommendations + trends + outlook */}
      {insights && (
        <div className="px-4 pt-3 pb-6 border-t border-zinc-800">
          {/* Summary */}
          <div className="mb-4">
            <p className="text-xs font-semibold text-indigo-400 mb-1.5">Summary</p>
            <p className="text-xs text-zinc-300 leading-relaxed">{insights.summary}</p>
          </div>

          {/* Trends */}
          {insights.trends?.length > 0 && (
            <div className="mb-4">
              <p className="text-xs font-semibold text-emerald-400 mb-1.5">Trends Observed</p>
              <ul className="space-y-1.5">
                {insights.trends.map((t, i) => (
                  <li key={i} className="flex gap-2 text-xs text-zinc-300">
                    <span className="text-emerald-500 shrink-0 mt-0.5">↗</span>
                    {t}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Recommendations */}
          {insights.recommendations?.length > 0 && (
            <div className="mb-4">
              <p className="text-xs font-semibold text-amber-400 mb-1.5">Recommendations</p>
              <div className="space-y-2">
                {insights.recommendations.map((r, i) => (
                  <div key={i} className={`rounded border px-3 py-2 ${PRIORITY_STYLES[r.priority] ?? PRIORITY_STYLES.low}`}>
                    <div className="flex items-center gap-1.5 mb-1">
                      <div className={`w-1.5 h-1.5 rounded-full shrink-0 ${PRIORITY_DOT[r.priority] ?? PRIORITY_DOT.low}`} />
                      <span className="text-xs font-medium text-zinc-200">{r.title}</span>
                    </div>
                    <p className="text-xs text-zinc-400 leading-relaxed">{r.detail}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Outlook */}
          {insights.outlook && (
            <div>
              <p className="text-xs font-semibold text-blue-400 mb-1.5">Outlook</p>
              <p className="text-xs text-zinc-300 leading-relaxed bg-zinc-900 border border-zinc-800 rounded px-3 py-2">
                {insights.outlook}
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
