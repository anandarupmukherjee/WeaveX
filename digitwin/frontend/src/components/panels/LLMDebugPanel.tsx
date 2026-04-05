import { useEffect, useRef, useState } from "react";

interface LLMEvent {
  type: "request" | "response";
  ts: number;
  model?: string;
  system?: string;
  user?: string;
  max_tokens?: number;
  elapsed_s?: number;
  finish_reason?: string;
  tokens?: number | string;
  response?: string;
}

export default function LLMDebugPanel() {
  const [events, setEvents] = useState<LLMEvent[]>([]);
  const [minimised, setMinimised] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const poll = setInterval(async () => {
      try {
        const res = await fetch("/api/debug/llm-log");
        const data = await res.json();
        setEvents(data.events ?? []);
      } catch {}
    }, 2000);
    return () => clearInterval(poll);
  }, []);

  useEffect(() => {
    if (scrollRef.current && !minimised) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [events, minimised]);

  const fmt = (ts: number) =>
    new Date(ts * 1000).toLocaleTimeString("en-GB", { hour12: false });

  return (
    <div
      style={{
        position: "fixed",
        bottom: 16,
        right: 16,
        width: 420,
        zIndex: 9999,
        fontFamily: "monospace",
        fontSize: 11,
      }}
    >
      {/* Title bar */}
      <div
        onClick={() => setMinimised((m) => !m)}
        style={{
          background: "#1e1e2e",
          border: "1px solid #444",
          borderBottom: minimised ? "1px solid #444" : "none",
          borderRadius: minimised ? 6 : "6px 6px 0 0",
          padding: "4px 10px",
          cursor: "pointer",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          color: "#cdd6f4",
        }}
      >
        <span>
          🤖 LLM Debug — {events.length} event{events.length !== 1 ? "s" : ""}
        </span>
        <span style={{ color: "#888" }}>{minimised ? "▲" : "▼"}</span>
      </div>

      {!minimised && (
        <div
          ref={scrollRef}
          style={{
            background: "#11111b",
            border: "1px solid #444",
            borderRadius: "0 0 6px 6px",
            maxHeight: 340,
            overflowY: "auto",
            padding: 8,
            display: "flex",
            flexDirection: "column",
            gap: 6,
          }}
        >
          {events.length === 0 && (
            <div style={{ color: "#585b70", padding: "8px 0" }}>
              No LLM activity yet…
            </div>
          )}
          {events.map((ev, i) => (
            <div
              key={i}
              style={{
                background: ev.type === "request" ? "#1e1e2e" : "#1a2a1a",
                border: `1px solid ${ev.type === "request" ? "#313244" : "#2d4a2d"}`,
                borderRadius: 4,
                padding: "5px 8px",
              }}
            >
              {ev.type === "request" ? (
                <>
                  <div style={{ color: "#89b4fa", marginBottom: 3 }}>
                    ▶ REQUEST {fmt(ev.ts)} · max_tokens={ev.max_tokens}
                  </div>
                  <div style={{ color: "#a6adc8" }}>
                    <span style={{ color: "#f38ba8" }}>SYS: </span>
                    {ev.system}
                    {(ev.system?.length ?? 0) >= 300 ? "…" : ""}
                  </div>
                  <div style={{ color: "#a6adc8", marginTop: 2 }}>
                    <span style={{ color: "#fab387" }}>USR: </span>
                    {ev.user}
                    {(ev.user?.length ?? 0) >= 300 ? "…" : ""}
                  </div>
                </>
              ) : (
                <>
                  <div style={{ color: "#a6e3a1", marginBottom: 3 }}>
                    ✓ RESPONSE {fmt(ev.ts)} · {ev.elapsed_s}s · {ev.tokens} tokens · {ev.finish_reason}
                  </div>
                  <div
                    style={{
                      color: "#cdd6f4",
                      whiteSpace: "pre-wrap",
                      wordBreak: "break-word",
                    }}
                  >
                    {ev.response}
                    {(ev.response?.length ?? 0) >= 600 ? "…" : ""}
                  </div>
                </>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
