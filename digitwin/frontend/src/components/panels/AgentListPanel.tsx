import { useState } from "react";
import type { AgentSpec } from "../../types";

interface Props {
  agents: AgentSpec[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
}

function AgentCard({ agent, isOpen, onToggle }: {
  agent: AgentSpec;
  isOpen: boolean;
  onToggle: () => void;
}) {
  const activityPct = Math.round((agent.behaviour?.activity_level ?? 0.5) * 100);
  const compliancePct = Math.round((agent.behaviour?.compliance ?? 0.5) * 100);
  const riskPct = Math.round((agent.behaviour?.risk_tolerance ?? 0.5) * 100);

  return (
    <div
      className={`rounded-lg border transition-colors cursor-pointer ${
        isOpen
          ? "border-indigo-500 bg-indigo-950/40"
          : "border-zinc-700 bg-zinc-900 hover:border-zinc-500"
      }`}
    >
      {/* Header — always visible */}
      <div
        className="flex items-center justify-between px-3 py-2 select-none"
        onClick={onToggle}
      >
        <div className="flex items-center gap-2 min-w-0">
          <div className="w-2 h-2 rounded-full bg-indigo-400 shrink-0" />
          <span className="text-sm font-medium truncate">{agent.name}</span>
          <span className="text-xs text-zinc-500 shrink-0">{agent.entity_type}</span>
        </div>
        <span className="text-zinc-500 text-xs ml-2">{isOpen ? "▲" : "▼"}</span>
      </div>

      {/* Expanded detail */}
      {isOpen && (
        <div className="px-3 pb-3 border-t border-zinc-700 mt-1 pt-2 space-y-3">
          {/* Persona */}
          <p className="text-xs text-zinc-300 leading-relaxed">{agent.persona}</p>

          {/* Goals */}
          {agent.goals?.length > 0 && (
            <div>
              <div className="text-xs font-semibold text-indigo-400 mb-1">Goals</div>
              <ul className="space-y-0.5">
                {agent.goals.map((g, i) => (
                  <li key={i} className="text-xs text-zinc-300 flex gap-1.5">
                    <span className="text-indigo-500 shrink-0">•</span>
                    {g}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Constraints */}
          {agent.constraints?.length > 0 && (
            <div>
              <div className="text-xs font-semibold text-amber-400 mb-1">Constraints</div>
              <ul className="space-y-0.5">
                {agent.constraints.map((c, i) => (
                  <li key={i} className="text-xs text-zinc-400 flex gap-1.5">
                    <span className="text-amber-500 shrink-0">⚠</span>
                    {c}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Tools */}
          {agent.tool_names?.length > 0 && (
            <div>
              <div className="text-xs font-semibold text-emerald-400 mb-1">Tools</div>
              <div className="flex flex-wrap gap-1">
                {agent.tool_names.map((t, i) => (
                  <span
                    key={i}
                    className="text-xs bg-emerald-900/40 text-emerald-300 border border-emerald-800 rounded px-1.5 py-0.5"
                  >
                    {t}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Behaviour bars */}
          <div>
            <div className="text-xs font-semibold text-zinc-400 mb-1.5">Behaviour</div>
            <div className="space-y-1.5">
              {[
                { label: "Activity", value: activityPct, color: "bg-blue-500" },
                { label: "Compliance", value: compliancePct, color: "bg-green-500" },
                { label: "Risk", value: riskPct, color: "bg-red-500" },
              ].map(({ label, value, color }) => (
                <div key={label} className="flex items-center gap-2">
                  <span className="text-xs text-zinc-500 w-16 shrink-0">{label}</span>
                  <div className="flex-1 bg-zinc-800 rounded-full h-1.5">
                    <div
                      className={`${color} h-1.5 rounded-full transition-all`}
                      style={{ width: `${value}%` }}
                    />
                  </div>
                  <span className="text-xs text-zinc-500 w-7 text-right">{value}%</span>
                </div>
              ))}
            </div>
          </div>

          {/* Relationships */}
          {agent.relationships?.length > 0 && (
            <div>
              <div className="text-xs font-semibold text-zinc-400 mb-1">Relationships</div>
              <ul className="space-y-0.5">
                {agent.relationships.slice(0, 3).map((r, i) => (
                  <li key={i} className="text-xs text-zinc-400 flex gap-1.5 items-start">
                    <span className="text-zinc-600 shrink-0">↔</span>
                    <span>
                      <span className="text-zinc-300">{r.relation_type}</span>
                      {r.description && <span className="text-zinc-500"> — {r.description}</span>}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function AgentListPanel({ agents, selectedId, onSelect }: Props) {
  const [openId, setOpenId] = useState<string | null>(null);

  const toggle = (id: string) => {
    const next = openId === id ? null : id;
    setOpenId(next);
    onSelect(next);
  };

  return (
    <div className="h-full flex flex-col">
      <div className="px-4 py-3 border-b border-zinc-800 shrink-0">
        <h3 className="text-sm font-semibold text-zinc-200">
          Agents
          <span className="ml-2 text-xs text-zinc-500 font-normal">
            {agents.length} extracted
          </span>
        </h3>
      </div>
      <div className="flex-1 overflow-y-auto p-3 space-y-2">
        {agents.length === 0 && (
          <p className="text-xs text-zinc-600 text-center pt-8">
            Agents will appear here as they are extracted…
          </p>
        )}
        {agents.map((a) => (
          <AgentCard
            key={a.id}
            agent={a}
            isOpen={openId === a.id}
            onToggle={() => toggle(a.id)}
          />
        ))}
      </div>
    </div>
  );
}
