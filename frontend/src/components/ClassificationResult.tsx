import React from "react";
import { ClassificationResult } from "../types";

interface Props {
  result: ClassificationResult | null;
  isLoading: boolean;
  isPartial?: boolean;
  onConfirm?: (isClean: boolean) => void;
  onReplay?: () => void;
  isMuted?: boolean;
  onToggleMute?: () => void;
  isListening?: boolean;
}

export default function ClassificationResultPanel({ result, isLoading, isPartial, onConfirm, onReplay, isMuted, onToggleMute, isListening }: Props) {
  if (isLoading) {
    return (
      <div className="glass-card p-6 flex flex-col items-center justify-center gap-4 min-h-48">
        <div className="w-10 h-10 border-4 border-emerald-500 border-t-transparent rounded-full animate-spin" />
        <p className="text-sm text-gray-400 animate-pulse">
          Gemma 4 is analyzing your waste item…
        </p>
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
            {result.confirmation_question || "Is this container empty and free of food residue inside?"}
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
            ✅ Yes, it's clean
          </button>
          <button
            onClick={() => onConfirm?.(false)}
            className="flex-1 py-3 rounded-xl font-semibold text-sm transition-all
                       hover:scale-105 active:scale-95"
            style={{ backgroundColor: "#6b728033", color: "#9ca3af", border: "1px solid #6b728066" }}
          >
            🗑️ No, it's dirty
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
