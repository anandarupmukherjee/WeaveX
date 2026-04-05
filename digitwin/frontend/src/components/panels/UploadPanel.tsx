import { useState, useCallback } from "react";
import { useDropzone } from "react-dropzone";
import { Upload, FileText } from "lucide-react";
import toast from "react-hot-toast";
import { submitExtractionJob } from "../../api/client";
import { useAppStore } from "../../stores/appStore";

export default function UploadPanel() {
  const [files, setFiles] = useState<File[]>([]);
  const [description, setDescription] = useState("");
  const setPhase = useAppStore((s) => s.setPhase);
  const setAnalysisProgress = useAppStore((s) => s.setAnalysisProgress);
  const setActiveJobId = useAppStore((s) => s.setActiveJobId);

  const onDrop = useCallback((accepted: File[]) => {
    setFiles((prev) => [...prev, ...accepted]);
  }, []);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: {
      "application/pdf": [".pdf"],
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document": [".docx"],
      "text/plain": [".txt", ".md", ".csv"],
    },
  });

  const handleSubmit = async () => {
    if (!files.length) return toast.error("Upload at least one file");
    if (!description.trim()) return toast.error("Describe what you want to model");

    setAnalysisProgress("uploading", "Uploading documents...");
    setPhase("analysing");

    try {
      const job = await submitExtractionJob(files, description);
      setActiveJobId(job.job_id);
    } catch (err: any) {
      console.error(err);
      toast.error("Upload failed — is the backend running?");
      setPhase("upload");
    }
  };

  return (
    <div className="flex items-center justify-center h-full">
      <div className="w-full max-w-2xl px-6">
        <div className="text-center mb-8">
          <h2 className="text-3xl font-bold mb-2">Build a digital twin</h2>
          <p className="text-zinc-400">
            Upload reference documents and describe what you want to model.
            <br />
            The AI will extract agents, relationships, tools, and objectives.
          </p>
        </div>

        {/* Drop zone */}
        <div
          {...getRootProps()}
          className={`border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition-colors mb-6 ${
            isDragActive
              ? "border-indigo-500 bg-indigo-500/10"
              : "border-zinc-700 hover:border-zinc-500"
          }`}
        >
          <input {...getInputProps()} />
          <Upload className="w-10 h-10 mx-auto mb-3 text-zinc-500" />
          <p className="text-sm text-zinc-400">
            {isDragActive
              ? "Drop files here..."
              : "Drag & drop PDFs, DOCX, or text files — or click to browse"}
          </p>
        </div>

        {/* File list */}
        {files.length > 0 && (
          <div className="mb-6 space-y-2">
            {files.map((f, i) => (
              <div
                key={i}
                className="flex items-center gap-3 bg-zinc-900 rounded-lg px-4 py-2 text-sm"
              >
                <FileText className="w-4 h-4 text-indigo-400 shrink-0" />
                <span className="truncate flex-1">{f.name}</span>
                <span className="text-zinc-500 shrink-0">
                  {(f.size / 1024).toFixed(0)} KB
                </span>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    setFiles(files.filter((_, j) => j !== i));
                  }}
                  className="text-zinc-500 hover:text-red-400 transition-colors"
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        )}

        {/* Description */}
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Describe what you want to model...&#10;&#10;Example: I want to simulate a hospital emergency department to optimise patient wait times and bed utilisation. The reports describe current staffing levels, patient flow data, and triage protocols."
          rows={5}
          className="w-full bg-zinc-900 border border-zinc-700 rounded-xl px-4 py-3 text-sm placeholder-zinc-500 focus:outline-none focus:border-indigo-500 resize-none mb-6"
        />

        {/* Submit */}
        <button
          onClick={handleSubmit}
          disabled={!files.length || !description.trim()}
          className="w-full py-3 bg-indigo-600 hover:bg-indigo-500 disabled:bg-zinc-700 disabled:text-zinc-500 rounded-xl font-medium transition-colors"
        >
          Analyse & build twin
        </button>

        <p className="text-xs text-zinc-600 text-center mt-4">
          Powered by local Ollama · Gemma 4 · Your data stays on your machine
        </p>
      </div>
    </div>
  );
}
