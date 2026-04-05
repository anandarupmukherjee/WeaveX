/* Core types matching backend TwinSpec models */

export interface IntentSpec {
  domain: string;
  domain_description: string;
  model_type: "process" | "organisation" | "market" | "system" | "custom";
  optimisation_targets: string[];
  scenario_seeds: string[];
  constraints: string[];
}

export interface EntityType {
  name: string;
  description: string;
  attributes: { name: string; type: string; description: string }[];
  examples: string[];
}

export interface RelationType {
  name: string;
  description: string;
  source_type: string;
  target_type: string;
}

export interface Ontology {
  entity_types: EntityType[];
  relation_types: RelationType[];
  analysis_summary: string;
}

export interface BehaviourParams {
  activity_level: number;
  response_latency: number;
  risk_tolerance: number;
  compliance: number;
  creativity: number;
}

export interface AgentRelationship {
  target_agent_id: string;
  relation_type: string;
  description: string;
  weight: number;
}

export interface AgentSpec {
  id: string;
  name: string;
  entity_type: string;
  persona: string;
  goals: string[];
  constraints: string[];
  tool_names: string[];
  behaviour: BehaviourParams;
  relationships: AgentRelationship[];
  properties: Record<string, unknown>;
}

export interface InteractionStep {
  actor: string;
  action: string;
  tools_used: string[];
  produces: string;
}

export interface InteractionProtocol {
  id: string;
  name: string;
  description: string;
  trigger: string;
  participants: string[];
  steps: InteractionStep[];
  frequency: string;
}

export interface ToolSpec {
  name: string;
  description: string;
  parameters: { name: string; type: string; description: string; required: boolean }[];
  domain: string;
  side_effects: string[];
}

export interface ObjectiveSpec {
  name: string;
  description: string;
  kpi: string;
  target_direction: string;
  collection_point: string;
  time_horizon?: string;
}

export interface TwinSpec {
  intent: IntentSpec;
  ontology: Ontology;
  agents: AgentSpec[];
  interactions: InteractionProtocol[];
  tools: ToolSpec[];
  objectives: ObjectiveSpec[];
}

/* Canvas node types for React Flow */
export interface AgentNodeData {
  agent: AgentSpec;
  isSelected: boolean;
  onTuneBehaviour: (agentId: string, params: Partial<BehaviourParams>) => void;
}
