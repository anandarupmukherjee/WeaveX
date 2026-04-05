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
  setAnalysisProgress: (stage: string, detail: string) => void;
}

export const useAppStore = create<AppState>((set) => ({
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
  setAnalysisProgress: (stage, detail) =>
    set({ analysisStage: stage, analysisDetail: detail }),
}));
