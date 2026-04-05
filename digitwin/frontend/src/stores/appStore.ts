import { create } from "zustand";
import type { TwinSpec, AgentSpec, BehaviourParams } from "../types";

type AppPhase = "upload" | "analysing" | "review" | "canvas" | "simulating";

interface AppState {
  phase: AppPhase;
  setPhase: (p: AppPhase) => void;

  // Extraction
  extractionId: string | null;
  twinSpec: TwinSpec | null;
  setExtraction: (id: string, spec: TwinSpec) => void;

  // Canvas
  selectedAgentId: string | null;
  selectAgent: (id: string | null) => void;

  // Behaviour tuning (local overrides before sending to backend)
  behaviourOverrides: Record<string, Partial<BehaviourParams>>;
  tuneBehaviour: (agentId: string, params: Partial<BehaviourParams>) => void;

  // Analysis progress
  analysisStage: string;
  analysisDetail: string;
  activeJobId: string | null;
  setAnalysisProgress: (stage: string, detail: string) => void;
  setActiveJobId: (id: string | null) => void;

  // Live ontology graph during extraction
  liveGraph: { entity_types: any[]; relation_types: any[]; agents: any[] } | null;
  setLiveGraph: (g: { entity_types: any[]; relation_types: any[]; agents: any[] } | null) => void;

  // --- Simulation-time active agents (for blinking) ---
  activeAgentIds: Set<string>;
  setActiveAgent: (id: string) => void;
  clearActiveAgents: () => void;

  // --- Agent management (keep/delete/merge before sim) ---
  removeAgent: (id: string) => void;
  mergeAgents: (keepId: string, mergeIds: string[]) => void;

  // --- Timeline configuration ---
  simTimeline: string;
  setSimTimeline: (t: string) => void;
}

export const useAppStore = create<AppState>((set, get) => ({
  phase: "upload",
  setPhase: (p) => set({ phase: p }),

  extractionId: null,
  twinSpec: null,
  setExtraction: (id, spec) =>
    set({ extractionId: id, twinSpec: spec, phase: "review" }),

  selectedAgentId: null,
  selectAgent: (id) => set({ selectedAgentId: id }),

  behaviourOverrides: {},
  tuneBehaviour: (agentId, params) =>
    set((s) => ({
      behaviourOverrides: {
        ...s.behaviourOverrides,
        [agentId]: { ...(s.behaviourOverrides[agentId] || {}), ...params },
      },
    })),

  analysisStage: "",
  analysisDetail: "",
  activeJobId: null,
  setAnalysisProgress: (stage, detail) =>
    set({ analysisStage: stage, analysisDetail: detail }),
  setActiveJobId: (id) => set({ activeJobId: id }),

  liveGraph: null,
  setLiveGraph: (g) => set({ liveGraph: g }),

  // Active agents — blink on canvas when they act
  activeAgentIds: new Set(),
  setActiveAgent: (id) =>
    set((s) => {
      const next = new Set(s.activeAgentIds);
      next.add(id);
      // Auto-clear after 1.5s
      setTimeout(() => {
        set((s2) => {
          const n = new Set(s2.activeAgentIds);
          n.delete(id);
          return { activeAgentIds: n };
        });
      }, 1500);
      return { activeAgentIds: next };
    }),
  clearActiveAgents: () => set({ activeAgentIds: new Set() }),

  // Agent management
  removeAgent: (id) =>
    set((s) => {
      if (!s.twinSpec) return {};
      const agents = s.twinSpec.agents.filter((a) => a.id !== id);
      // Also remove from interactions
      const interactions = s.twinSpec.interactions.map((p) => ({
        ...p,
        participants: p.participants.filter((pid) => pid !== id),
      }));
      return { twinSpec: { ...s.twinSpec, agents, interactions } };
    }),
  mergeAgents: (keepId, mergeIds) =>
    set((s) => {
      if (!s.twinSpec) return {};
      const keep = s.twinSpec.agents.find((a) => a.id === keepId);
      if (!keep) return {};
      const toMerge = s.twinSpec.agents.filter((a) => mergeIds.includes(a.id));
      // Merge goals, constraints, tools, relationships from merged agents
      const mergedGoals = [...new Set([...keep.goals, ...toMerge.flatMap((a) => a.goals)])];
      const mergedConstraints = [...new Set([...keep.constraints, ...toMerge.flatMap((a) => a.constraints)])];
      const mergedTools = [...new Set([...keep.tool_names, ...toMerge.flatMap((a) => a.tool_names)])];
      const mergedRels = [...keep.relationships, ...toMerge.flatMap((a) => a.relationships)]
        .filter((r) => r.target_agent_id !== keepId && !mergeIds.includes(r.target_agent_id));
      const updated: AgentSpec = {
        ...keep,
        goals: mergedGoals,
        constraints: mergedConstraints,
        tool_names: mergedTools,
        relationships: mergedRels,
      };
      const agents = s.twinSpec.agents
        .filter((a) => !mergeIds.includes(a.id))
        .map((a) => (a.id === keepId ? updated : a));
      // Rewrite relationship targets that pointed to merged agents
      for (const agent of agents) {
        for (const rel of agent.relationships) {
          if (mergeIds.includes(rel.target_agent_id)) {
            rel.target_agent_id = keepId;
          }
        }
      }
      return { twinSpec: { ...s.twinSpec, agents } };
    }),

  simTimeline: "",
  setSimTimeline: (t) => set({ simTimeline: t }),
}));
