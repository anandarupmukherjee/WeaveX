import { useState } from "react";
import { Trash2, GitMerge, Check } from "lucide-react";
import type { AgentSpec } from "../../types";
import { useAppStore } from "../../stores/appStore";

interface Props {
  agents: AgentSpec[];
}

export default function AgentManagePanel({ agents }: Props) {
  const removeAgent = useAppStore((s) => s.removeAgent);
  const mergeAgents = useAppStore((s) => s.mergeAgents);

  const [mergeMode, setMergeMode] = useState(false);
  const [mergeSelected, setMergeSelected] = useState<Set<string>>(new Set());
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  const toggleMerge = (id: string) => {
    const next = new Set(mergeSelected);
    if (next.has(id)) next.delete(id); else next.add(id);
    setMergeSelected(next);
  };

  const handleMerge = () => {
    const ids = [...mergeSelected];
    if (ids.length < 2) return;
    // Keep the first selected, merge the rest into it
    mergeAgents(ids[0], ids.slice(1));
    setMergeSelected(new Set());
    setMergeMode(false);
  };

  const handleDelete = (id: string) => {
    removeAgent(id);
    setConfirmDelete(null);
  };

  // Group agents by entity_type
  const grouped: Record<string, AgentSpec[]> = {};
  for (const a of agents) {
    (grouped[a.entity_type] ??= []).push(a);
  }

  return (
    <div className="h-full flex flex-col bg-zinc-950 overflow-hidden">
      {/* Header */}
      <div className="px-4 py-3 border-b border-zinc-800 shrink-0">
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-sm font-semibold text-zinc-200">
            Manage Agents ({agents.length})
          </h3>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => { setMergeMode(!mergeMode); setMergeSelected(new Set()); }}
            className={`flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg transition-colors ${mergeMode ? "bg-indigo-600 text-white" : "bg-zinc-800 text-zinc-300 hover:bg-zinc-700"}`}
          >
            <GitMerge className="w-3 h-3" />
            {mergeMode ? "Cancel merge" : "Merge similar"}
          </button>
          {mergeMode && mergeSelected.size >= 2 && (
            <button
              onClick={handleMerge}
              className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg bg-emerald-700 hover:bg-emerald-600 text-white transition-colors"
            >
              <Check className="w-3 h-3" />
              Merge {mergeSelected.size} agents
            </button>
          )}
        </div>
        {mergeMode && (
          <p className="text-[10px] text-zinc-500 mt-2">
            Select 2+ agents to merge. The first selected becomes the primary agent; others are absorbed.
          </p>
        )}
      </div>

      {/* Agent list */}
      <div className="flex-1 overflow-y-auto p-3 space-y-3">
        {Object.entries(grouped).map(([type, agentsOfType]) => (
          <div key={type}>
            <p className="text-[10px] font-semibold text-zinc-500 uppercase tracking-wider mb-1.5 px-1">
              {type} ({agentsOfType.length})
            </p>
            <div className="space-y-1">
              {agentsOfType.map((a) => {
                const isSelected = mergeSelected.has(a.id);
                const isPrimary = mergeMode && [...mergeSelected][0] === a.id;
                return (
                  <div
                    key={a.id}
                    className={`flex items-center gap-2 px-3 py-2 rounded-lg text-xs transition-colors border ${
                      isSelected
                        ? isPrimary
                          ? "border-emerald-600 bg-emerald-950/30"
                          : "border-indigo-600 bg-indigo-950/30"
                        : "border-zinc-800 bg-zinc-900/50 hover:bg-zinc-800/50"
                    }`}
                  >
                    {mergeMode && (
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => toggleMerge(a.id)}
                        className="accent-indigo-500 shrink-0"
                      />
                    )}
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-zinc-200 truncate">{a.name}</p>
                      <p className="text-zinc-500 truncate mt-0.5">
                        {a.goals[0] || a.persona?.slice(0, 60)}
                      </p>
                    </div>
                    {isPrimary && (
                      <span className="text-[9px] text-emerald-400 font-medium shrink-0">PRIMARY</span>
                    )}
                    {!mergeMode && (
                      <>
                        {confirmDelete === a.id ? (
                          <div className="flex gap-1 shrink-0">
                            <button
                              onClick={() => handleDelete(a.id)}
                              className="text-[10px] px-2 py-1 bg-red-700 hover:bg-red-600 rounded text-white transition-colors"
                            >
                              Confirm
                            </button>
                            <button
                              onClick={() => setConfirmDelete(null)}
                              className="text-[10px] px-2 py-1 bg-zinc-700 hover:bg-zinc-600 rounded text-zinc-300 transition-colors"
                            >
                              No
                            </button>
                          </div>
                        ) : (
                          <button
                            onClick={() => setConfirmDelete(a.id)}
                            className="p-1 hover:bg-zinc-700 rounded transition-colors shrink-0 text-zinc-500 hover:text-red-400"
                            title="Remove agent"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
