import { memo } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";

interface AgentNodeData {
  agent: {
    id: string;
    name: string;
    entity_type: string;
    goals: string[];
    tool_names: string[];
    persona?: string;
    constraints?: string[];
    relationships?: { target_agent_id: string; relation_type: string; description: string }[];
  };
  color: string;
  isActive?: boolean;
  kpiTrend?: "up" | "down" | "neutral";
}

function AgentNode({ data }: NodeProps) {
  const { agent, color, isActive, kpiTrend } = data as unknown as AgentNodeData;

  return (
    <div
      className={`rounded-xl border-2 bg-zinc-900 shadow-lg cursor-pointer transition-all hover:scale-105 hover:shadow-xl min-w-[140px] max-w-[200px] ${isActive ? "agent-blink" : ""}`}
      style={{ borderColor: isActive ? "#3b82f6" : color }}
      onClick={(e) => { e.stopPropagation(); e.preventDefault(); }}
    >
      <Handle type="target" position={Position.Top} className="!bg-zinc-600" />

      <div className="px-3 py-2">
        {/* Type badge + KPI trend */}
        <div className="flex items-center justify-between mb-1">
          <div
            className="text-[10px] font-medium rounded px-1.5 py-0.5 inline-block"
            style={{ background: color + "22", color }}
          >
            {agent.entity_type}
          </div>
          {kpiTrend && kpiTrend !== "neutral" && (
            <span className={`text-sm font-bold ${kpiTrend === "up" ? "text-green-400" : "text-red-400"}`}>
              {kpiTrend === "up" ? "▲" : "▼"}
            </span>
          )}
        </div>

        {/* Name */}
        <p className="text-sm font-semibold text-zinc-100 truncate">
          {agent.name}
        </p>

        {/* Quick stats */}
        <div className="flex gap-2 mt-1.5 text-[10px] text-zinc-500">
          {agent.goals.length > 0 && (
            <span>{agent.goals.length} goals</span>
          )}
          {agent.tool_names.length > 0 && (
            <span>{agent.tool_names.length} tools</span>
          )}
        </div>
      </div>

      <Handle type="source" position={Position.Bottom} className="!bg-zinc-600" />

      {/* CSS for blink animation */}
      <style>{`
        .agent-blink {
          animation: agentBlink 0.6s ease-in-out 3;
        }
        @keyframes agentBlink {
          0%, 100% { box-shadow: 0 0 0 0 rgba(59, 130, 246, 0); }
          50% { box-shadow: 0 0 20px 6px rgba(59, 130, 246, 0.6); }
        }
      `}</style>
    </div>
  );
}

export default memo(AgentNode);
