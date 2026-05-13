import React, { useCallback, useEffect, useRef, useState } from "react";
import BinDisplay from "./components/BinDisplay";
import CameraFeed from "./components/CameraFeed";
import ClassificationResultPanel from "./components/ClassificationResult";
import StatsPanel from "./components/StatsPanel";
import { useSpeech } from "./hooks/useSpeech";
import { useSpeechRecognition } from "./hooks/useSpeechRecognition";
import { ClassificationResult, LidStates, StatsData, WasteEvent } from "./types";

type InputMode = "camera" | "upload";

const API_BASE = "/api";
const WS_URL = `${window.location.protocol === "https:" ? "wss" : "ws"}://${window.location.host}/api/classify/ws/lid-states`;

const DEFAULT_LID_STATES: LidStates = {
  RECYCLABLE: false,
  COMPOST: false,
  TRASH: false,
  HAZARDOUS: false,
};

const LID_OPEN_MS = 5000; // keep lid open 5 s after classification

// Maps the bin_action string from the API to the lidStates key
const BIN_ACTION_MAP: Record<string, keyof LidStates> = {
  OPEN_RECYCLABLE: "RECYCLABLE",
  OPEN_COMPOST:    "COMPOST",
  OPEN_TRASH:      "TRASH",
  OPEN_HAZARDOUS:  "HAZARDOUS",
};

function buildSpeechText(r: ClassificationResult): string {
  if (r.category === "HUMAN") return r.pun || "Hello there! I sort waste, not people!";
  if (r.category === "PENDING") return r.confirmation_question || "Can you confirm if this container is clean inside?";
  const parts = [
    `I identified this as ${r.item_identified}.`,
    `It goes in the ${r.category.toLowerCase()} bin.`,
    r.reasoning,
  ];
  if (r.is_contaminated && r.contamination_details) parts.push(r.contamination_details);
  if (r.education_tip) parts.push(r.education_tip);
  return parts.join(" ");
}

export default function App() {
  const [activeMode, setActiveMode] = useState<InputMode>("camera");
  const [result, setResult] = useState<ClassificationResult | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [lidStates, setLidStates] = useState<LidStates>(DEFAULT_LID_STATES);
  const [stats, setStats] = useState<StatsData | null>(null);
  const [recentEvents, setRecentEvents] = useState<WasteEvent[]>([]);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const lidTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const { speak, cancel } = useSpeech();
  const lastSpokenKeyRef = useRef<string>("");

  const { start: startListening, stop: stopListening, isListening } = useSpeechRecognition({
    onAnswer: (answer) => {
      if (answer === "yes") handleConfirmation(true);
      else if (answer === "no") handleConfirmation(false);
      // "unclear" — keep buttons visible, do nothing (user can try again or tap)
    },
  });

  // Auto-speak when a new result arrives; skip if same text was just spoken
  useEffect(() => {
    if (!result || isMuted) return;
    const text = buildSpeechText(result);
    const timer = setTimeout(() => {
      if (text === lastSpokenKeyRef.current) return;
      lastSpokenKeyRef.current = text;
      if (result.category === "PENDING") {
        speak(text, () => startListening());
      } else {
        speak(text);
      }
    }, 400);
    return () => clearTimeout(timer);
  }, [result, isMuted, speak, startListening]);

  // Cancel speech and mic when a new scan starts; reset so next result always speaks
  useEffect(() => {
    if (isLoading) {
      cancel();
      stopListening();
      lastSpokenKeyRef.current = "";
    }
  }, [isLoading, cancel, stopListening]);

  // Reset state when switching between camera and upload modes
  const switchMode = useCallback((mode: InputMode) => {
    if (lidTimerRef.current) clearTimeout(lidTimerRef.current);
    setActiveMode(mode);
    setResult(null);
    setError(null);
    setPreviewUrl(null);
    setLidStates(DEFAULT_LID_STATES);
  }, []);

  // WebSocket for real-time lid state updates
  useEffect(() => {
    let destroyed = false;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;

    function connect() {
      if (destroyed) return;
      const ws = new WebSocket(WS_URL);
      wsRef.current = ws;

      ws.onmessage = (ev) => {
        const data = JSON.parse(ev.data);
        if (data.type === "init") {
          setLidStates(data.states);
        } else if (data.type === "lid_open") {
          setLidStates((prev) => ({ ...prev, [data.bin]: true }));
        } else if (data.type === "lid_close") {
          setLidStates((prev) => ({ ...prev, [data.bin]: false }));
        }
      };

      ws.onclose = () => {
        if (!destroyed) retryTimer = setTimeout(connect, 2000);
      };
    }

    connect();
    return () => {
      destroyed = true;
      if (retryTimer) clearTimeout(retryTimer);
      wsRef.current?.close();
    };
  }, []);

  // Poll stats every 5 seconds
  useEffect(() => {
    async function fetchStats() {
      try {
        const [statsRes, eventsRes] = await Promise.all([
          fetch(`${API_BASE}/stats/`),
          fetch(`${API_BASE}/stats/recent?limit=10`),
        ]);
        if (statsRes.ok) setStats(await statsRes.json());
        if (eventsRes.ok) setRecentEvents(await eventsRes.json());
      } catch {
        // silently ignore — stats are non-critical
      }
    }
    fetchStats();
    const id = setInterval(fetchStats, 5000);
    return () => clearInterval(id);
  }, [result]);

  const handleConfirmation = useCallback((isClean: boolean) => {
    const binKey = isClean ? "RECYCLABLE" : "TRASH";
    if (lidTimerRef.current) clearTimeout(lidTimerRef.current);
    setLidStates((prev) => ({ ...prev, [binKey]: true }));
    lidTimerRef.current = setTimeout(() => {
      setLidStates((prev) => ({ ...prev, [binKey]: false }));
    }, LID_OPEN_MS);
    // Update the displayed result so the UI reflects the final decision
    setResult((prev) =>
      prev
        ? {
            ...prev,
            category: isClean ? "RECYCLABLE" : "TRASH",
            bin_action: isClean ? "OPEN_RECYCLABLE" : "OPEN_TRASH",
            color: isClean ? "#22c55e" : "#6b7280",
            icon: isClean ? "♻️" : "🗑️",
            needs_confirmation: false,
          }
        : prev
    );
  }, []);

  const classifyImage = useCallback(async (file: File) => {
    setIsLoading(true);
    setError(null);
    setResult(null);

    // Cancel any previous auto-close timer and shut all lids
    if (lidTimerRef.current) clearTimeout(lidTimerRef.current);
    setLidStates(DEFAULT_LID_STATES);

    const url = URL.createObjectURL(file);
    setPreviewUrl(url);

    const formData = new FormData();
    formData.append("file", file);

    try {
      const res = await fetch(`${API_BASE}/classify/image`, {
        method: "POST",
        body: formData,
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.detail ?? `HTTP ${res.status}`);
      }
      const data: ClassificationResult = await res.json();
      setResult(data);

      // ── Lid animation driven directly from the API response ──────────────
      // bin_action is e.g. "OPEN_RECYCLABLE" → open only that lid
      const binKey = BIN_ACTION_MAP[data.bin_action];
      if (binKey) {
        setLidStates((prev) => ({ ...prev, [binKey]: true }));

        // Auto-close after LID_OPEN_MS; cancel if next classification starts first
        lidTimerRef.current = setTimeout(() => {
          setLidStates((prev) => ({ ...prev, [binKey]: false }));
        }, LID_OPEN_MS);
      }
    } catch (err: unknown) {
      setError((err as Error).message ?? "Classification failed");
    } finally {
      setIsLoading(false);
    }
  }, []);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) classifyImage(file);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file && file.type.startsWith("image/")) classifyImage(file);
  };

  return (
    <div className="min-h-screen bg-gray-950 text-white">

      {/* ── Header ──────────────────────────────────────────────────────────── */}
      <header className="border-b border-white/10 px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className="text-3xl">🌍</span>
          <div>
            <h1 className="text-xl font-bold tracking-tight">EcoBinAI</h1>
            <p className="text-xs text-gray-500">Gemma 4 · Smart Waste Sorting</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
          <span className="text-xs text-gray-400">Live</span>
        </div>
      </header>

      {/* ── Main layout ──────────────────────────────────────────────────────── */}
      <main className="max-w-7xl mx-auto px-4 py-6 grid grid-cols-1 lg:grid-cols-3 gap-6">

        {/* Left column */}
        <div className="lg:col-span-2 space-y-5">

          {/* ── Mode switcher tabs ─────────────────────────────────────────── */}
          <div className="flex gap-2 p-1 bg-gray-900/60 rounded-xl border border-white/10">
            <button
              onClick={() => switchMode("camera")}
              className={`flex-1 flex items-center justify-center gap-2 py-2.5 px-4 rounded-lg
                          text-sm font-semibold transition-all duration-200
                          ${activeMode === "camera"
                            ? "bg-emerald-600 text-white shadow-lg shadow-emerald-900/50"
                            : "text-gray-400 hover:text-white hover:bg-white/5"}`}
            >
              <span>📷</span> Live Camera
            </button>
            <button
              onClick={() => switchMode("upload")}
              className={`flex-1 flex items-center justify-center gap-2 py-2.5 px-4 rounded-lg
                          text-sm font-semibold transition-all duration-200
                          ${activeMode === "upload"
                            ? "bg-gray-700 text-white shadow"
                            : "text-gray-400 hover:text-white hover:bg-white/5"}`}
            >
              <span>📁</span> Upload Photo
            </button>
          </div>

          {/* ── Input area (camera or upload) ─────────────────────────────── */}
          {activeMode === "camera" ? (
            <CameraFeed
              onCapture={classifyImage}
              isClassifying={isLoading}
              resultColor={result?.color}
            />
          ) : (
            /* Upload / drag-drop zone */
            <div
              className={`border-2 border-dashed rounded-2xl p-8 text-center cursor-pointer transition-all
                ${isDragging
                  ? "border-emerald-400 bg-emerald-900/20"
                  : "border-gray-700 hover:border-gray-500 bg-gray-900/30"}`}
              onClick={() => fileInputRef.current?.click()}
              onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
              onDragLeave={() => setIsDragging(false)}
              onDrop={handleDrop}
            >
              <input
                ref={fileInputRef}
                type="file"
                accept="image/jpeg,image/png,image/webp"
                className="hidden"
                onChange={handleFileChange}
              />
              {previewUrl ? (
                <div className="flex flex-col items-center gap-4">
                  <img
                    src={previewUrl}
                    alt="Waste item preview"
                    className="max-h-48 rounded-xl object-contain border border-white/10"
                  />
                  <p className="text-sm text-gray-400">Click or drop a new image to re-classify</p>
                </div>
              ) : (
                <div className="space-y-3">
                  <span className="text-5xl block">📁</span>
                  <p className="text-gray-300 font-medium">Drop an image here or click to upload</p>
                  <p className="text-xs text-gray-600">Supports JPEG · PNG · WebP — max 10 MB</p>
                </div>
              )}
            </div>
          )}

          {/* ── Error ─────────────────────────────────────────────────────── */}
          {error && (
            <div className="bg-red-900/30 border border-red-600/50 rounded-xl p-4 text-red-400 text-sm">
              ⚠️ {error}
            </div>
          )}

          {/* ── Classification result ─────────────────────────────────────── */}
          <ClassificationResultPanel
            result={result}
            isLoading={isLoading}
            onConfirm={handleConfirmation}
            onReplay={() => result && speak(buildSpeechText(result))}
            isMuted={isMuted}
            onToggleMute={() => { setIsMuted((m) => { if (!m) cancel(); return !m; }); }}
            isListening={isListening}
          />

          {/* ── Bin display ───────────────────────────────────────────────── */}
          <BinDisplay lidStates={lidStates} />
        </div>

        {/* ── Right column: stats ──────────────────────────────────────────── */}
        <div className="space-y-4">
          <h2 className="text-sm font-semibold uppercase tracking-widest text-gray-400">
            Waste Analytics
          </h2>
          <StatsPanel stats={stats} recentEvents={recentEvents} />

          <div className="glass-card p-4 text-center space-y-1">
            <p className="text-xs text-gray-500 uppercase tracking-widest">Powered by</p>
            <p className="font-bold text-lg bg-gradient-to-r from-blue-400 to-emerald-400 bg-clip-text text-transparent">
              Gemma 4
            </p>
            <p className="text-xs text-gray-600">
              Multimodal Vision · Native Function Calling · Edge-Ready
            </p>
          </div>
        </div>
      </main>
    </div>
  );
}
