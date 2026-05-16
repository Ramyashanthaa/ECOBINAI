import { useEffect, useRef, useState } from "react";
import { ClassificationResult } from "../types";

const THINKING_PHRASES = [
  { verb: "Sniffing",        desc: "for traces of contamination" },
  { verb: "Interrogating",   desc: "the container's past life" },
  { verb: "Consulting",      desc: "the compost oracle" },
  { verb: "Calculating",     desc: "decomposition rates" },
  { verb: "Pondering",       desc: "the lifecycle of plastics" },
  { verb: "Detecting",       desc: "hidden food residue" },
  { verb: "Classifying",     desc: "polymer chains and organic matter" },
  { verb: "Weighing",        desc: "environmental consequences" },
  { verb: "Triangulating",   desc: "optimal bin assignment" },
  { verb: "Debating",        desc: "landfill vs. compost philosophy" },
  { verb: "Communing",       desc: "with the recycling gods" },
  { verb: "Scanning",        desc: "for hazardous materials" },
  { verb: "Philosophizing",  desc: "about waste and civilisation" },
  { verb: "Noodling",        desc: "over contamination thresholds" },
  { verb: "Percolating",     desc: "through waste taxonomies" },
  { verb: "Synthesizing",    desc: "environmental impact data" },
  { verb: "Investigating",   desc: "suspicious residue patterns" },
  { verb: "Cross-referencing", desc: "municipal recycling guidelines" },
  { verb: "Inspecting",      desc: "the molecular structure" },
  { verb: "Deliberating",    desc: "the carbon footprint implications" },
];

function ThinkingPhrase() {
  const [index, setIndex] = useState(() => Math.floor(Math.random() * THINKING_PHRASES.length));
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    const id = setInterval(() => {
      setVisible(false);
      setTimeout(() => {
        setIndex((i) => (i + 1) % THINKING_PHRASES.length);
        setVisible(true);
      }, 350);
    }, 1800);
    return () => clearInterval(id);
  }, []);

  const { verb, desc } = THINKING_PHRASES[index];

  return (
    <div
      className="flex flex-col items-center justify-center gap-1 py-3 select-none
                 transition-opacity duration-300"
      style={{ opacity: visible ? 1 : 0 }}
    >
      <span className="text-xl font-bold text-emerald-300 tracking-tight">
        {verb}…
      </span>
      <span className="text-xs text-gray-500">{desc}</span>
    </div>
  );
}

interface Props {
  result: ClassificationResult | null;
  isLoading: boolean;
  isPartial?: boolean;
  thinkingText?: string;
  onConfirm?: (isClean: boolean) => void;
  onReplay?: () => void;
  isMuted?: boolean;
  onToggleMute?: () => void;
  isListening?: boolean;
}

function ReasoningPanel({ thinkingText, isStreaming, defaultExpanded = true }: { thinkingText: string; isStreaming: boolean; defaultExpanded?: boolean }) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const bodyRef = useRef<HTMLDivElement>(null);

  // Only display text that came before the JSON block — the human-readable reasoning
  const displayText = thinkingText.includes("{")
    ? thinkingText.slice(0, thinkingText.indexOf("{")).trim()
    : thinkingText.trim();

  useEffect(() => {
    if (bodyRef.current && expanded) {
      bodyRef.current.scrollTop = bodyRef.current.scrollHeight;
    }
  }, [displayText, expanded]);

  return (
    <div className="w-full rounded-xl border border-emerald-900/40 overflow-hidden">
      {/* Header */}
      <button
        onClick={() => setExpanded((e) => !e)}
        className="w-full flex items-center justify-between px-4 py-2.5
                   bg-emerald-950/50 hover:bg-emerald-950/70 transition-colors text-left"
      >
        <div className="flex items-center gap-2.5">
          <span className="text-[11px] font-bold text-emerald-400 uppercase tracking-widest">
            Gemma 4's Reasoning
          </span>
          {isStreaming && (
            <span className="flex items-center gap-0.5">
              {[0, 150, 300].map((delay) => (
                <span
                  key={delay}
                  className="w-1 h-1 rounded-full bg-emerald-400 animate-bounce"
                  style={{ animationDelay: `${delay}ms` }}
                />
              ))}
            </span>
          )}
        </div>
        <span className="text-gray-500 text-xs">{expanded ? "▲" : "▼"}</span>
      </button>

      {/* Body */}
      {expanded && (
        <div
          ref={bodyRef}
          className="max-h-44 overflow-y-auto px-4 py-3 bg-black/40
                     font-mono text-sm leading-relaxed text-left"
        >
          {displayText ? (
            <span className="text-emerald-300/90">
              {displayText}
              {isStreaming && (
                <span className="animate-pulse text-emerald-400 ml-0.5">▌</span>
              )}
            </span>
          ) : isStreaming ? (
            <ThinkingPhrase />
          ) : (
            <span className="text-gray-600 italic text-xs">No reasoning captured.</span>
          )}
        </div>
      )}
    </div>
  );
}

export default function ClassificationResultPanel({ result, isLoading, isPartial, thinkingText, onConfirm, onReplay, isMuted, onToggleMute, isListening }: Props) {
  if (isLoading) {
    return (
      <div className="glass-card p-6 space-y-4">
        <div className="flex items-center gap-3">
          <div className="w-5 h-5 border-[3px] border-emerald-500 border-t-transparent rounded-full animate-spin flex-shrink-0" />
          <p className="text-sm text-emerald-400 font-medium">Gemma 4 is analyzing…</p>
        </div>
        <ReasoningPanel thinkingText={thinkingText ?? ""} isStreaming={true} />
      </div>
    );
  }

  if (!result) {
    return null;
  }

  // ── Human detected ────────────────────────────────────────────────────────
  if (result.category === "HUMAN") {
    return (
      <div className="glass-card p-6 animate-slide-up space-y-4 text-center">
        <span className="text-6xl block">🙅</span>
        <h3 className="text-xl font-bold text-white">Not quite waste!</h3>
        <p
          className="text-lg font-medium px-4 py-3 rounded-xl"
          style={{ backgroundColor: "#a78bfa22", color: "#a78bfa", border: "1px solid #a78bfa66" }}
        >
          {result.pun || "You're clearly not garbage — though you do produce a fair amount of it! 😏"}
        </p>
        <VoiceBar onReplay={onReplay} isMuted={isMuted} onToggleMute={onToggleMute} ms={result.processing_time_ms} />
      </div>
    );
  }

  // ── Pending confirmation (opaque container) ───────────────────────────────
  if (result.category === "PENDING") {
    return (
      <div className="glass-card p-6 animate-slide-up space-y-4">
        <div className="flex items-center gap-3">
          <span className="text-4xl">❓</span>
          <div>
            <p className="text-xs text-gray-500 uppercase tracking-widest">One quick question</p>
            <h3 className="text-xl font-bold text-white">{result.item_identified}</h3>
          </div>
        </div>

        <div
          className="rounded-xl p-4"
          style={{ backgroundColor: "#facc1522", border: "1px solid #facc1566" }}
        >
          <p className="text-yellow-300 text-sm font-medium">
            {result.confirmation_question || "Is this container empty, or does it still have liquid or food inside?"}
          </p>
        </div>

        {/* Voice listening indicator */}
        {isListening ? (
          <div className="flex flex-col items-center gap-2 py-1">
            <div className="relative flex items-center justify-center">
              <span
                className="absolute inline-flex h-14 w-14 rounded-full opacity-30 animate-ping"
                style={{ backgroundColor: "#facc15" }}
              />
              <span className="relative text-3xl">🎤</span>
            </div>
            <p className="text-yellow-300 text-sm font-semibold animate-pulse">
              Listening… say "Yes" or "No"
            </p>
          </div>
        ) : (
          <p className="text-center text-gray-500 text-xs">🎤 Speak your answer, or tap below</p>
        )}

        {/* Fallback tap buttons */}
        <div className="flex gap-3">
          <button
            onClick={() => onConfirm?.(true)}
            className="flex-1 py-3 rounded-xl font-semibold text-sm transition-all
                       hover:scale-105 active:scale-95"
            style={{ backgroundColor: "#22c55e33", color: "#22c55e", border: "1px solid #22c55e66" }}
          >
            ✅ Yes, it's empty
          </button>
          <button
            onClick={() => onConfirm?.(false)}
            className="flex-1 py-3 rounded-xl font-semibold text-sm transition-all
                       hover:scale-105 active:scale-95"
            style={{ backgroundColor: "#6b728033", color: "#9ca3af", border: "1px solid #6b728066" }}
          >
            🥤 No, it has liquid/food
          </button>
        </div>

        <VoiceBar onReplay={onReplay} isMuted={isMuted} onToggleMute={onToggleMute} ms={result.processing_time_ms} />
      </div>
    );
  }

  // ── Normal waste classification ───────────────────────────────────────────
  const confidencePct = Math.round(result.confidence * 100);

  return (
    <div className="glass-card p-6 animate-slide-up space-y-4">
      {/* Header with icon and category */}
      <div className="flex items-center gap-3">
        <span className="text-4xl">{result.icon}</span>
        <span
          className="px-3 py-1 rounded-full text-sm font-bold uppercase"
          style={{ backgroundColor: result.color + "33", color: result.color, border: `1px solid ${result.color}` }}
        >
          {result.category}
        </span>
        {isPartial && (
          <span className="flex items-center gap-1.5 text-xs text-gray-400 animate-pulse ml-auto">
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-ping inline-block" />
            Refining…
          </span>
        )}
      </div>

      {/* Unified Description / partial placeholder */}
      {isPartial ? (
        <div
          className="rounded-xl p-4 text-center border-l-4 font-medium text-base leading-relaxed"
          style={{ backgroundColor: result.color + "15", color: result.color, borderColor: result.color }}
        >
          <span className="animate-pulse">{result.item_identified} detected — Gemma 4 is analyzing…</span>
        </div>
      ) : (
        <div
          className="rounded-xl p-4 text-center border-l-4 font-medium text-base leading-relaxed"
          style={{ backgroundColor: result.color + "15", color: result.color, borderColor: result.color }}
        >
          {result.unified_description || `${result.item_identified} — ${result.category.toLowerCase()} because ${result.reasoning}`}
        </div>
      )}

      {/* Confidence bar */}
      <div>
        <div className="flex justify-between text-xs text-gray-400 mb-1">
          <span>Confidence</span>
          {isPartial
            ? <span className="animate-pulse text-gray-500">Calculating…</span>
            : <span className="font-semibold" style={{ color: result.color }}>{confidencePct}%</span>
          }
        </div>
        <div className="w-full h-2 bg-gray-800 rounded-full overflow-hidden">
          <div
            className="h-full rounded-full confidence-bar transition-all duration-700"
            style={{
              width: isPartial ? "100%" : `${confidencePct}%`,
              backgroundColor: isPartial ? "#374151" : result.color,
              backgroundImage: isPartial ? "linear-gradient(90deg, #374151 25%, #4b5563 50%, #374151 75%)" : undefined,
              backgroundSize: isPartial ? "200% 100%" : undefined,
              animation: isPartial ? "shimmer 1.5s infinite" : undefined,
            }}
          />
        </div>
      </div>

      {/* Contamination alert — only once full result is in */}
      {!isPartial && result.is_contaminated && (
        <div className="flex items-start gap-2 bg-yellow-900/30 border border-yellow-600/50 rounded-xl p-3">
          <span className="text-yellow-400 text-lg">⚠️</span>
          <div>
            <p className="text-yellow-400 text-sm font-semibold">Contamination Detected</p>
            <p className="text-yellow-300/80 text-xs mt-0.5">{result.contamination_details}</p>
          </div>
        </div>
      )}

      {/* Collapsible reasoning panel — shows what Gemma 4 said during analysis */}
      {thinkingText && (
        <ReasoningPanel thinkingText={thinkingText} isStreaming={!!isPartial} defaultExpanded={false} />
      )}

      {/* Footer */}
      <VoiceBar
        onReplay={onReplay}
        isMuted={isMuted}
        onToggleMute={onToggleMute}
        ms={result.processing_time_ms}
        timestamp={isPartial ? undefined : result.timestamp}
        isPartial={isPartial}
      />
    </div>
  );
}

// ── Shared voice control bar ──────────────────────────────────────────────────
function VoiceBar({
  onReplay, isMuted, onToggleMute, ms, timestamp, isPartial,
}: {
  onReplay?: () => void;
  isMuted?: boolean;
  onToggleMute?: () => void;
  ms: number;
  timestamp?: string;
  isPartial?: boolean;
}) {
  return (
    <div className="flex items-center justify-between pt-1 border-t border-white/5">
      <span className="text-xs text-gray-600">
        {isPartial
          ? <span className="animate-pulse">Gemma 4 · refining full analysis…</span>
          : <>Gemma 4 · {ms}ms{timestamp ? ` · ${new Date(timestamp).toLocaleTimeString()}` : ""}</>
        }
      </span>
      <div className="flex items-center gap-2">
        {/* Replay */}
        <button
          onClick={onReplay}
          title="Replay voice explanation"
          className="text-gray-500 hover:text-white transition-colors text-base leading-none"
        >
          🔊
        </button>
        {/* Mute toggle */}
        <button
          onClick={onToggleMute}
          title={isMuted ? "Unmute voice" : "Mute voice"}
          className="text-gray-500 hover:text-white transition-colors text-base leading-none"
        >
          {isMuted ? "🔇" : "🔉"}
        </button>
      </div>
    </div>
  );
}
