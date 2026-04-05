import { useMemo } from "react";
import {
  ReactFlow,
  Background,
  Controls,
  type Node,
  type Edge,
  Panel,
} from "@xyflow/react";

interface EntityType {
  name: string;
  description: string;
}

interface RelationType {
  name: string;
  source_type: string;
  target_type: string;
}

interface LiveAgent {
  name: string;
  entity_type: string;
  relationships: { target: string; type: string }[];
}

interface LiveGraphData {
  entity_types: EntityType[];
  relation_types: RelationType[];
  agents: LiveAgent[];
}

interface Props {
  data: LiveGraphData;
  stage: string;
}

const COLORS = [
  "#6366f1", "#10b981", "#f59e0b", "#ec4899", "#06b6d4",
  "#8b5cf6", "#f97316", "#14b8a6", "#e11d48", "#84cc16",
];

export default function LiveOntologyGraph({ data, stage }: Props) {
  const colorMap = useMemo(() => {
    const map: Record<string, string> = {};
    data.entity_types.forEach((et, i) => {
      map[et.name] = COLORS[i % COLORS.length];
    });
    return map;
  }, [data.entity_types]);

  const { nodes, edges } = useMemo(() => {
    const allNodes: Node[] = [];
    const allEdges: Edge[] = [];

    if (data.agents.length > 0) {
      // Show agents as nodes
      const count = data.agents.length;
      const radius = Math.max(200, count * 25);
      const cx = 400, cy = 300;

      const agentNameSet = new Set(data.agents.map((a) => a.name));

      data.agents.forEach((agent, i) => {
        const angle = (2 * Math.PI * i) / count - Math.PI / 2;
        const color = colorMap[agent.entity_type] || "#6366f1";
        allNodes.push({
          id: `agent-${agent.name}`,
          position: { x: cx + radius * Math.cos(angle), y: cy + radius * Math.sin(angle) },
          data: { label: agent.name },
          style: {
            background: "#18181b",
            border: `2px solid ${color}`,
            borderRadius: 12,
            padding: "8px 12px",
            fontSize: 11,
            color: "#e4e4e7",
            minWidth: 100,
            textAlign: "center" as const,
          },
        });

        // Edges from relationships
        for (const rel of agent.relationships) {
          if (agentNameSet.has(rel.target)) {
            allEdges.push({
              id: `e-${agent.name}-${rel.target}-${rel.type}`,
              source: `agent-${agent.name}`,
              target: `agent-${rel.target}`,
              label: rel.type.replace(/_/g, " ").toLowerCase(),
              animated: true,
              style: { stroke: "#3f3f46", strokeWidth: 1.5 },
              labelStyle: { fontSize: 8, fill: "#52525b" },
            });
          }
        }
      });
    } else {
      // Show entity types as nodes with relation edges
      const count = data.entity_types.length;
      const radius = Math.max(150, count * 40);
      const cx = 400, cy = 300;

      data.entity_types.forEach((et, i) => {
        const angle = (2 * Math.PI * i) / count - Math.PI / 2;
        const color = colorMap[et.name] || "#6366f1";
        allNodes.push({
          id: `et-${et.name}`,
          position: { x: cx + radius * Math.cos(angle), y: cy + radius * Math.sin(angle) },
          data: { label: et.name },
          style: {
            background: color + "20",
            border: `2px solid ${color}`,
            borderRadius: 12,
            padding: "10px 16px",
            fontSize: 13,
            fontWeight: 600,
            color: "#e4e4e7",
            minWidth: 120,
            textAlign: "center" as const,
          },
        });
      });

      const etNames = new Set(data.entity_types.map((et) => et.name));
      data.relation_types.forEach((rt) => {
        if (etNames.has(rt.source_type) && etNames.has(rt.target_type)) {
          allEdges.push({
            id: `rel-${rt.name}`,
            source: `et-${rt.source_type}`,
            target: `et-${rt.target_type}`,
            label: rt.name.replace(/_/g, " ").toLowerCase(),
            animated: true,
            style: { stroke: "#4f46e5", strokeWidth: 2 },
            labelStyle: { fontSize: 9, fill: "#818cf8" },
          });
        }
      });
    }

    return { nodes: allNodes, edges: allEdges };
  }, [data, colorMap]);

  const entityCount = data.entity_types.length;
  const relationCount = data.relation_types.length;
  const agentCount = data.agents.length;

  return (
    <div className="w-full h-full">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        fitView
        minZoom={0.3}
        maxZoom={1.5}
        proOptions={{ hideAttribution: true }}
        nodesDraggable={false}
        nodesConnectable={false}
      >
        <Background color="#1e1b2e" gap={25} />
        <Controls position="bottom-left" showInteractive={false} />

        <Panel position="top-left">
          <div className="bg-zinc-900/90 backdrop-blur-sm rounded-lg px-4 py-3 border border-zinc-800 text-xs space-y-1">
            <p className="text-zinc-200 font-medium">
              {stage === "ontology" ? "Building Ontology..." : stage === "agents" ? "Discovering Agents..." : "Extracting..."}
            </p>
            <p className="text-zinc-500">
              {entityCount} entity types · {relationCount} relations
              {agentCount > 0 && ` · ${agentCount} agents`}
            </p>
          </div>
        </Panel>

        {/* Legend */}
        <Panel position="top-right">
          <div className="bg-zinc-900/90 backdrop-blur-sm rounded-lg px-3 py-2 border border-zinc-800 text-[10px] space-y-1 max-h-[40vh] overflow-y-auto">
            {data.entity_types.map((et) => (
              <div key={et.name} className="flex items-center gap-2">
                <div className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: colorMap[et.name] }} />
                <span className="text-zinc-300 truncate max-w-[120px]">{et.name}</span>
              </div>
            ))}
          </div>
        </Panel>
      </ReactFlow>
    </div>
  );
}
