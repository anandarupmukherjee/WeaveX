import { useMemo, useCallback } from "react";
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  useNodesState,
  useEdgesState,
  type Node,
  type Edge,
  type NodeTypes,
  Panel,
} from "@xyflow/react";
import type { TwinSpec } from "../../types";
import { useAppStore } from "../../stores/appStore";
import AgentNode from "./AgentNode";
import AgentPanel from "../panels/AgentPanel";

const nodeTypes: NodeTypes = {
  agent: AgentNode,
};

// Colour map for entity types
const TYPE_COLORS: Record<string, string> = {
  Doctor: "#6366f1",
  Nurse: "#8b5cf6",
  Patient: "#06b6d4",
  Administrator: "#f59e0b",
  Supplier: "#10b981",
  Warehouse: "#f97316",
  Machine: "#64748b",
  Manager: "#ec4899",
};

function getColor(entityType: string): string {
  return TYPE_COLORS[entityType] || "#6366f1";
}

interface Props {
  twinSpec: TwinSpec;
}

export default function TwinCanvas({ twinSpec }: Props) {
  const selectedAgentId = useAppStore((s) => s.selectedAgentId);
  const selectAgent = useAppStore((s) => s.selectAgent);
  const selectedAgent = twinSpec.agents.find((a) => a.id === selectedAgentId);

  // Convert agents to React Flow nodes — arrange in a circle
  const initialNodes: Node[] = useMemo(() => {
    const count = twinSpec.agents.length;
    const radius = Math.max(300, count * 30);
    const cx = 500;
    const cy = 400;

    return twinSpec.agents.map((agent, i) => {
      const angle = (2 * Math.PI * i) / count - Math.PI / 2;
      return {
        id: agent.id,
        type: "agent",
        position: {
          x: cx + radius * Math.cos(angle),
          y: cy + radius * Math.sin(angle),
        },
        data: {
          agent,
          color: getColor(agent.entity_type),
        },
      };
    });
  }, [twinSpec.agents]);

  // Convert relationships to edges
  const initialEdges: Edge[] = useMemo(() => {
    const edges: Edge[] = [];
    const agentIds = new Set(twinSpec.agents.map((a) => a.id));

    for (const agent of twinSpec.agents) {
      for (const rel of agent.relationships) {
        if (agentIds.has(rel.target_agent_id)) {
          edges.push({
            id: `${agent.id}-${rel.target_agent_id}-${rel.relation_type}`,
            source: agent.id,
            target: rel.target_agent_id,
            label: rel.relation_type.replace(/_/g, " ").toLowerCase(),
            animated: false,
            style: {
              stroke: "#3f3f46",
              strokeWidth: Math.max(1, rel.weight * 2),
            },
            labelStyle: { fontSize: 10, fill: "#71717a" },
          });
        }
      }
    }
    return edges;
  }, [twinSpec.agents]);

  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);

  const onNodeClick = useCallback(
    (_: React.MouseEvent, node: Node) => {
      selectAgent(node.id);
    },
    [selectAgent]
  );

  const onPaneClick = useCallback(() => {
    selectAgent(null);
  }, [selectAgent]);

  return (
    <div className="h-full w-full relative">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onNodeClick={onNodeClick}
        onPaneClick={onPaneClick}
        fitView
        minZoom={0.1}
        maxZoom={2}
        proOptions={{ hideAttribution: true }}
      >
        <Background color="#27272a" gap={20} />
        <Controls position="bottom-left" />
        <MiniMap
          nodeColor={(n) => (n.data as any)?.color || "#6366f1"}
          style={{ background: "#18181b" }}
        />

        {/* Top info panel */}
        <Panel position="top-left">
          <div className="bg-zinc-900/90 backdrop-blur-sm rounded-lg px-4 py-3 border border-zinc-800 text-sm">
            <p className="font-medium text-zinc-100">
              {twinSpec.intent.domain.replace(/_/g, " ")}
            </p>
            <p className="text-zinc-400 text-xs mt-1">
              {twinSpec.agents.length} agents · drag to rearrange · click to inspect
            </p>
          </div>
        </Panel>

        {/* Legend */}
        <Panel position="top-right">
          <div className="bg-zinc-900/90 backdrop-blur-sm rounded-lg px-4 py-3 border border-zinc-800 text-xs space-y-1">
            {[...new Set(twinSpec.agents.map((a) => a.entity_type))].map(
              (type) => (
                <div key={type} className="flex items-center gap-2">
                  <div
                    className="w-3 h-3 rounded-full"
                    style={{ background: getColor(type) }}
                  />
                  <span className="text-zinc-300">{type}</span>
                </div>
              )
            )}
          </div>
        </Panel>
      </ReactFlow>

      {/* Agent detail panel (slides in from right) */}
      {selectedAgent && (
        <AgentPanel
          agent={selectedAgent}
          tools={twinSpec.tools.filter((t) =>
            selectedAgent.tool_names.includes(t.name)
          )}
          onClose={() => selectAgent(null)}
        />
      )}
    </div>
  );
}
