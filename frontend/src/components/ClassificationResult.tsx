import React from "react";
import { ClassificationResult } from "../types";

interface Props {
  result: ClassificationResult | null;
  isLoading: boolean;
  onConfirm?: (isClean: boolean) => void;
  onReplay?: () => void;
  isMuted?: boolean;
  onToggleMute?: () => void;
  isListening?: boolean;
}

export default function ClassificationResultPanel({ result, isLoading, onConfirm, onReplay, isMuted, onToggleMute, isListening }: Props) {
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
    return (
      <div className="glass-card p-6 flex flex-col items-center justify-center gap-3 min-h-48 text-center">
        <span className="text-5xl">📸</span>
        <p className="text-gray-400 text-sm">
          Upload an image of a waste item to get started
        </p>
        <p className="text-gray-600 text-xs">
          Supports JPEG · PNG · WebP — max 10 MB
        </p>
      </div>
    );
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
      {/* Header */}
      <div className="flex items-center gap-3">
        <span className="text-4xl">{result.icon}</span>
        <div>
          <p className="text-xs text-gray-500 uppercase tracking-widest">Identified as</p>
          <h3 className="text-xl font-bold text-white">{result.item_identified}</h3>
        </div>
        <span
          className="ml-auto px-3 py-1 rounded-full text-sm font-bold uppercase"
          style={{ backgroundColor: result.color + "33", color: result.color, border: `1px solid ${result.color}` }}
        >
          {result.category}
        </span>
      </div>

      {/* Confidence bar */}
      <div>
        <div className="flex justify-between text-xs text-gray-400 mb-1">
          <span>Confidence</span>
          <span className="font-semibold" style={{ color: result.color }}>{confidencePct}%</span>
        </div>
        <div className="w-full h-2 bg-gray-800 rounded-full overflow-hidden">
          <div
            className="h-full rounded-full confidence-bar transition-all duration-700"
            style={{
              width: `${confidencePct}%`,
              backgroundColor: result.color,
              ["--pct" as string]: `${confidencePct}%`,
            }}
          />
        </div>
      </div>

      {/* Contamination alert */}
      {result.is_contaminated && (
        <div className="flex items-start gap-2 bg-yellow-900/30 border border-yellow-600/50 rounded-xl p-3">
          <span className="text-yellow-400 text-lg">⚠️</span>
          <div>
            <p className="text-yellow-400 text-sm font-semibold">Contamination Detected</p>
            <p className="text-yellow-300/80 text-xs mt-0.5">{result.contamination_details}</p>
          </div>
        </div>
      )}

      {/* Reasoning */}
      <div className="bg-gray-900/50 rounded-xl p-3">
        <p className="text-xs text-gray-500 uppercase tracking-widest mb-1">AI Reasoning</p>
        <p className="text-gray-300 text-sm">{result.reasoning}</p>
      </div>

      {/* Appreciation Message */}
      {result.appreciation_message && (
        <div 
          className="rounded-xl p-4 text-center border-l-4 font-medium text-sm"
          style={{
            backgroundColor: result.color + "15",
            color: result.color,
            borderColor: result.color,
          }}
        >
          {result.appreciation_message}
        </div>
      )}

      {/* Education tip */}
      {result.education_tip && (
        <div className="bg-emerald-900/20 border border-emerald-700/30 rounded-xl p-3">
          <p className="text-xs text-emerald-400 uppercase tracking-widest mb-1">Eco Tip</p>
          <p className="text-emerald-300/90 text-sm">{result.education_tip}</p>
        </div>
      )}

      {/* Footer: voice controls + metadata */}
      <VoiceBar
        onReplay={onReplay}
        isMuted={isMuted}
        onToggleMute={onToggleMute}
        ms={result.processing_time_ms}
        timestamp={result.timestamp}
      />
    </div>
  );
}

// ── Shared voice control bar ──────────────────────────────────────────────────
function VoiceBar({
  onReplay, isMuted, onToggleMute, ms, timestamp,
}: {
  onReplay?: () => void;
  isMuted?: boolean;
  onToggleMute?: () => void;
  ms: number;
  timestamp?: string;
}) {
  return (
    <div className="flex items-center justify-between pt-1 border-t border-white/5">
      <span className="text-xs text-gray-600">
        Gemma 4 · {ms}ms{timestamp ? ` · ${new Date(timestamp).toLocaleTimeString()}` : ""}
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
