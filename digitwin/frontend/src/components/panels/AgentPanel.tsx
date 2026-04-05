import { X, Wrench, Target, Shield } from "lucide-react";
import type { AgentSpec, ToolSpec, BehaviourParams } from "../../types";
import { useAppStore } from "../../stores/appStore";

interface Props {
  agent: AgentSpec;
  tools: ToolSpec[];
  onClose: () => void;
}

const BEHAVIOUR_LABELS: Record<keyof BehaviourParams, { label: string; low: string; high: string }> = {
  activity_level: { label: "Activity level", low: "Passive", high: "Hyperactive" },
  response_latency: { label: "Response speed", low: "Instant", high: "Deliberate" },
  risk_tolerance: { label: "Risk tolerance", low: "Cautious", high: "Bold" },
  compliance: { label: "Compliance", low: "Rebellious", high: "Rule-follower" },
  creativity: { label: "Creativity", low: "By the book", high: "Improviser" },
};

export default function AgentPanel({ agent, tools, onClose }: Props) {
  const tuneBehaviour = useAppStore((s) => s.tuneBehaviour);
  const overrides = useAppStore((s) => s.behaviourOverrides[agent.id] || {});

  const effectiveBehaviour = { ...agent.behaviour, ...overrides };

  return (
    <div className="absolute right-0 top-0 h-full w-96 bg-zinc-900 border-l border-zinc-800 shadow-2xl overflow-y-auto z-50">
      {/* Header */}
      <div className="sticky top-0 bg-zinc-900/95 backdrop-blur-sm border-b border-zinc-800 px-5 py-4 flex items-start justify-between">
        <div>
          <p className="text-xs text-indigo-400 font-medium mb-1">
            {agent.entity_type}
          </p>
          <h3 className="text-lg font-semibold">{agent.name}</h3>
        </div>
        <button
          onClick={onClose}
          className="p-1 hover:bg-zinc-800 rounded-lg transition-colors"
        >
          <X className="w-5 h-5 text-zinc-400" />
        </button>
      </div>

      <div className="px-5 py-4 space-y-6">
        {/* Persona */}
        <section>
          <h4 className="text-xs font-semibold text-zinc-400 uppercase tracking-wider mb-2">
            Persona
          </h4>
          <p className="text-sm text-zinc-300 leading-relaxed">
            {agent.persona}
          </p>
        </section>

        {/* Goals */}
        <section>
          <h4 className="text-xs font-semibold text-zinc-400 uppercase tracking-wider mb-2 flex items-center gap-1.5">
            <Target className="w-3 h-3" /> Goals
          </h4>
          <ul className="space-y-1">
            {agent.goals.map((g, i) => (
              <li key={i} className="text-sm text-zinc-300 flex items-start gap-2">
                <span className="text-indigo-400 mt-0.5">•</span> {g}
              </li>
            ))}
          </ul>
        </section>

        {/* Constraints */}
        {agent.constraints.length > 0 && (
          <section>
            <h4 className="text-xs font-semibold text-zinc-400 uppercase tracking-wider mb-2 flex items-center gap-1.5">
              <Shield className="w-3 h-3" /> Constraints
            </h4>
            <ul className="space-y-1">
              {agent.constraints.map((c, i) => (
                <li key={i} className="text-sm text-zinc-300 flex items-start gap-2">
                  <span className="text-amber-400 mt-0.5">•</span> {c}
                </li>
              ))}
            </ul>
          </section>
        )}

        {/* Tools */}
        <section>
          <h4 className="text-xs font-semibold text-zinc-400 uppercase tracking-wider mb-2 flex items-center gap-1.5">
            <Wrench className="w-3 h-3" /> Tools ({tools.length})
          </h4>
          <div className="space-y-2">
            {tools.map((t) => (
              <div
                key={t.name}
                className="bg-zinc-800 rounded-lg px-3 py-2 text-sm"
              >
                <p className="font-mono text-indigo-300 text-xs">{t.name}</p>
                <p className="text-zinc-400 text-xs mt-0.5">{t.description}</p>
              </div>
            ))}
            {tools.length === 0 && (
              <p className="text-xs text-zinc-500">No tools assigned</p>
            )}
          </div>
        </section>

        {/* Behaviour sliders */}
        <section>
          <h4 className="text-xs font-semibold text-zinc-400 uppercase tracking-wider mb-3">
            Behaviour tuning
          </h4>
          <div className="space-y-4">
            {(Object.keys(BEHAVIOUR_LABELS) as (keyof BehaviourParams)[]).map(
              (key) => {
                const { label, low, high } = BEHAVIOUR_LABELS[key];
                const value = effectiveBehaviour[key];
                return (
                  <div key={key}>
                    <div className="flex justify-between text-xs mb-1">
                      <span className="text-zinc-300">{label}</span>
                      <span className="text-zinc-500">
                        {(value * 100).toFixed(0)}%
                      </span>
                    </div>
                    <input
                      type="range"
                      min={0}
                      max={100}
                      value={value * 100}
                      onChange={(e) =>
                        tuneBehaviour(agent.id, {
                          [key]: Number(e.target.value) / 100,
                        })
                      }
                      className="w-full h-1.5 bg-zinc-700 rounded-full appearance-none cursor-pointer accent-indigo-500"
                    />
                    <div className="flex justify-between text-[10px] text-zinc-600 mt-0.5">
                      <span>{low}</span>
                      <span>{high}</span>
                    </div>
                  </div>
                );
              }
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
