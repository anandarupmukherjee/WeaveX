import { memo } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";

interface AgentNodeData {
  agent: {
    id: string;
    name: string;
    entity_type: string;
    goals: string[];
    tool_names: string[];
  };
  color: string;
}

function AgentNode({ data }: NodeProps) {
  const { agent, color } = data as unknown as AgentNodeData;

  return (
    <div
      className="rounded-xl border-2 bg-zinc-900 shadow-lg cursor-pointer transition-all hover:scale-105 hover:shadow-xl min-w-[140px] max-w-[200px]"
      style={{ borderColor: color }}
      onClick={(e) => { e.stopPropagation(); e.preventDefault(); }}
    >
      <Handle type="target" position={Position.Top} className="!bg-zinc-600" />

      <div className="px-3 py-2">
        {/* Type badge */}
        <div
          className="text-[10px] font-medium rounded px-1.5 py-0.5 inline-block mb-1"
          style={{ background: color + "22", color }}
        >
          {agent.entity_type}
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
    </div>
  );
}

export default memo(AgentNode);
