import axios from "axios";
import type { TwinSpec } from "../types";

const api = axios.create({
  baseURL: "/api",
  timeout: 7_200_000, // 2 hours — local Gemma 4 can take 30-40 min per extraction
});

/* --- Extraction --- */

export async function submitExtractionJob(
  files: File[],
  description: string,
  projectId?: string
): Promise<{ job_id: string; status: string }> {
  const form = new FormData();
  files.forEach((f) => form.append("files", f));
  form.append("description", description);
  if (projectId) form.append("project_id", projectId);

  const res = await api.post("/extract/upload-and-analyse", form, {
    headers: { "Content-Type": "multipart/form-data" },
    timeout: 30_000, // just for the upload, not the extraction
  });
  return res.data;
}

export async function pollJobStatus(jobId: string): Promise<{
  job_id: string;
  status: string;
  stage: string | null;
  detail: string | null;
  error: string | null;
}> {
  const res = await api.get(`/extract/${jobId}/status`, { timeout: 10_000 });
  return res.data;
}

export async function fetchExtractionResult(
  jobId: string
): Promise<{ extraction_id: string; data: TwinSpec }> {
  const res = await api.get(`/extract/${jobId}`, { timeout: 10_000 });
  return res.data;
}

/** @deprecated use submitExtractionJob + pollJobStatus instead */
export async function uploadAndAnalyse(
  files: File[],
  description: string,
  projectId?: string
): Promise<{ extraction_id: string; data: TwinSpec }> {
  const { job_id } = await submitExtractionJob(files, description, projectId);
  // Poll until done
  while (true) {
    await new Promise((r) => setTimeout(r, 5_000));
    const status = await pollJobStatus(job_id);
    if (status.status === "complete") return fetchExtractionResult(job_id);
    if (status.status === "failed") throw new Error(status.error || "Extraction failed");
  }
}

export async function analyseText(
  text: string,
  description: string
): Promise<{ extraction_id: string; data: TwinSpec }> {
  const form = new FormData();
  form.append("text", text);
  form.append("description", description);
  const res = await api.post("/extract/analyse-text", form);
  return res.data;
}

export async function getExtraction(
  id: string
): Promise<{ data: TwinSpec }> {
  const res = await api.get(`/extract/${id}`);
  return res.data;
}

/* --- Projects --- */

export async function createProject(name: string) {
  const res = await api.post("/projects/", { name });
  return res.data;
}

export async function listProjects() {
  const res = await api.get("/projects/");
  return res.data;
}

/* --- Simulation --- */

export async function startSimulation(extractionId: string, rounds = 50) {
  const res = await api.post("/simulation/start", {
    extraction_id: extractionId,
    rounds,
  });
  return res.data;
}

/* --- WebSocket --- */

export function connectSimulationWS(
  simId: string,
  onMessage: (event: Record<string, unknown>) => void
): WebSocket {
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  const ws = new WebSocket(`${protocol}//${window.location.host}/ws/simulation/${simId}`);

  ws.onmessage = (e) => {
    try {
      const data = JSON.parse(e.data);
      onMessage(data);
    } catch {
      console.warn("Non-JSON WS message:", e.data);
    }
  };

  ws.onerror = (e) => console.error("WS error:", e);
  return ws;
}

export default api;
