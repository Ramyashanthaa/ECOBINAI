import React, { useCallback, useEffect, useRef, useState } from "react";
import BinDisplay from "./components/BinDisplay";
import CameraFeed from "./components/CameraFeed";
import ClassificationResultPanel from "./components/ClassificationResult";
import StatsPanel from "./components/StatsPanel";
import { useSpeech } from "./hooks/useSpeech";
import { useSpeechRecognition } from "./hooks/useSpeechRecognition";
import { ClassificationResult, HealthInfo, ImpactStats, LidStates, StatsData, WasteEvent } from "./types";

type InputMode = "camera" | "upload";

const API_BASE = "/api";
const WS_URL = `${window.location.protocol === "https:" ? "wss" : "ws"}://${window.location.host}/api/classify/ws/lid-states`;

const DEFAULT_LID_STATES: LidStates = {
  RECYCLABLE: false,
  COMPOST: false,
  TRASH: false,
  HAZARDOUS: false,
};

const LID_OPEN_MS = 3600000; // keep lid open until the next item is scanned (resets on new classification)

// Maps the bin_action string from the API to the lidStates key
const BIN_ACTION_MAP: Record<string, keyof LidStates> = {
  OPEN_RECYCLABLE: "RECYCLABLE",
  OPEN_COMPOST:    "COMPOST",
  OPEN_TRASH:      "TRASH",
  OPEN_HAZARDOUS:  "HAZARDOUS",
};

const CATEGORY_COLORS: Record<string, string> = {
  RECYCLABLE: "#22c55e",
  COMPOST:    "#f97316",
  TRASH:      "#6b7280",
  HAZARDOUS:  "#ef4444",
};

const CATEGORY_ICONS: Record<string, string> = {
  RECYCLABLE: "♻️",
  COMPOST:    "🌱",
  TRASH:      "🗑️",
  HAZARDOUS:  "⚠️",
};

const CLEANING_SPEECH =
  "This item has food or liquid residue, so it can't be recycled as-is. " +
  "Here's how to make it recyclable: rinse out all food and grease with water, " +
  "clean the inside thoroughly, remove the lid and clean it separately, " +
  "then let it dry. Once it's clean and empty, it goes straight in the recycling bin. " +
  "Can you clean it right now?";

function buildSpeechText(r: ClassificationResult): string {
  if (r.category === "HUMAN") return r.pun || "Hello there! I sort waste, not people!";
  if (r.category === "PENDING") return r.confirmation_question || "Is this container empty, or does it still have liquid or food inside?";
  return [r.reasoning, r.education_tip, r.donatable ? r.donation_suggestion : ""]
    .filter(Boolean)
    .join(" ");
}

export default function App() {
  const [activeMode, setActiveMode] = useState<InputMode>("camera");
  const [result, setResult] = useState<ClassificationResult | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [lidStates, setLidStates] = useState<LidStates>(DEFAULT_LID_STATES);
  const [stats, setStats] = useState<StatsData | null>(null);
  const [impact, setImpact] = useState<ImpactStats | null>(null);
  const [recentEvents, setRecentEvents] = useState<WasteEvent[]>([]);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const lidTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [usbCameraEnabled, setUsbCameraEnabled] = useState(false);

  const { speak, cancel, isSpeaking } = useSpeech();
  const lastSpokenKeyRef = useRef<string>("");

  const { start: startListening, stop: stopListening, isListening } = useSpeechRecognition({
    onAnswer: (answer) => {
      if (answer === "yes") handleConfirmation(true);
      else if (answer === "no") handleConfirmation(false);
      // "unclear" — keep buttons visible, do nothing (user can try again or tap)
    },
  });

  // Fetch backend health once to discover usb_camera_enabled
  useEffect(() => {
    fetch(`${API_BASE}/health`)
      .then((r) => r.json())
      .then((h: HealthInfo) => setUsbCameraEnabled(h.usb_camera_enabled))
      .catch(() => {});
  }, []);

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

  // Stop the mic and dismiss cleaning guidance when a new scan starts.
  useEffect(() => {
    if (isLoading) {
      stopListening();
      setShowCleaningGuidance(false);
      lastSpokenKeyRef.current = "";
    }
  }, [isLoading, stopListening]);

  // Reset state when switching between camera and upload modes
  const switchMode = useCallback((mode: InputMode) => {
    if (lidTimerRef.current) clearTimeout(lidTimerRef.current);
    setActiveMode(mode);
    setResult(null);
    setError(null);
    setPreviewUrl(null);
    setLidStates(DEFAULT_LID_STATES);
    setShowCleaningGuidance(false);
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
        // Intentionally ignore "init" — every page load should start neutral,
        // not inherit a still-open lid from a previous session.
        if (data.type === "lid_open") {
          setLidStates({ ...DEFAULT_LID_STATES, [data.bin]: true });
        } else if (data.type === "lid_close") {
          setLidStates((prev) => ({ ...prev, [data.bin]: false }));
        } else if (data.type === "classification") {
          // USB-camera auto-scan result — update result card + trigger voice,
          // exactly as if the user had uploaded the image from the browser.
          const r = data.result as ClassificationResult;
          setResult(r);
          setIsLoading(false);
          setIsPartial(false);
          setThinkingText("");
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
        const [statsRes, eventsRes, impactRes] = await Promise.all([
          fetch(`${API_BASE}/stats/`),
          fetch(`${API_BASE}/stats/recent?limit=10`),
          fetch(`${API_BASE}/stats/impact`),
        ]);
        if (statsRes.ok) setStats(await statsRes.json());
        if (eventsRes.ok) setRecentEvents(await eventsRes.json());
        if (impactRes.ok) setImpact(await impactRes.json());
      } catch {
        // silently ignore — stats are non-critical
      }
    }
    fetchStats();
    const id = setInterval(fetchStats, 5000);
    return () => clearInterval(id);
  }, [result]);

  const handleConfirmation = useCallback((isEmpty: boolean) => {
    if (isEmpty) {
      // Empty and clean — open the recycling bin immediately
      const chosen = (result?.yes_category?.toUpperCase() || "RECYCLABLE") as keyof LidStates;
      fetch(`${API_BASE}/classify/open-bin/${chosen}`, { method: "POST" }).catch(() => {});
      fetch(`${API_BASE}/classify/resume-scan`, { method: "POST" }).catch(() => {});
      if (lidTimerRef.current) clearTimeout(lidTimerRef.current);
      setLidStates({ ...DEFAULT_LID_STATES, [chosen]: true });
      lidTimerRef.current = setTimeout(
        () => setLidStates((prev) => ({ ...prev, [chosen]: false })),
        LID_OPEN_MS,
      );
      setResult((prev) =>
        prev ? {
          ...prev,
          category: chosen as ClassificationResult["category"],
          bin_action: `OPEN_${chosen}`,
          color: CATEGORY_COLORS[chosen] ?? "#6b7280",
          icon:  CATEGORY_ICONS[chosen]  ?? "♻️",
          needs_confirmation: false,
          reasoning:     "it's already clean and empty — perfect for recycling.",
          education_tip: "Rinse containers before recycling to keep the stream uncontaminated. Remove the lid if attached and recycle it separately.",
        } : prev
      );
    } else {
      // Has residue — guide the user through cleaning before deciding
      stopListening();
      setResult((prev) => prev ? { ...prev, needs_confirmation: false } : prev);
      setShowCleaningGuidance(true);
      speak(CLEANING_SPEECH);
    }
  }, [result, speak, stopListening]);

  // Called from the cleaning guidance panel after the user decides
  const handleCleaningDecision = useCallback((canClean: boolean) => {
    setShowCleaningGuidance(false);
    const chosen = (canClean ? "RECYCLABLE" : "TRASH") as keyof LidStates;
    fetch(`${API_BASE}/classify/open-bin/${chosen}`, { method: "POST" }).catch(() => {});
    fetch(`${API_BASE}/classify/resume-scan`, { method: "POST" }).catch(() => {});
    if (lidTimerRef.current) clearTimeout(lidTimerRef.current);
    setLidStates({ ...DEFAULT_LID_STATES, [chosen]: true });
    lidTimerRef.current = setTimeout(
      () => setLidStates((prev) => ({ ...prev, [chosen]: false })),
      LID_OPEN_MS,
    );
    setResult((prev) =>
      prev ? {
        ...prev,
        category: chosen as ClassificationResult["category"],
        bin_action: `OPEN_${chosen}`,
        color: CATEGORY_COLORS[chosen] ?? "#6b7280",
        icon:  CATEGORY_ICONS[chosen]  ?? "🗑️",
        reasoning: canClean
          ? "you cleaned it out — now it's ready for the recycling bin."
          : "it still has residue and can't be cleaned right now, so it goes in the trash to prevent contamination.",
        education_tip: canClean
          ? "Great job! Clean packaging re-enters the material cycle instead of going to landfill."
          : "Contaminated items can ruin entire batches of recyclables. When in doubt, choose trash.",
      } : prev
    );
  }, []);

  const [isPartial, setIsPartial] = useState(false);
  const [thinkingText, setThinkingText] = useState("");
  const [showCleaningGuidance, setShowCleaningGuidance] = useState(false);

  const classifyImage = useCallback(async (file: File) => {
    setIsLoading(true);
    setIsPartial(false);
    setThinkingText("");
    setError(null);
    setResult(null);

    if (lidTimerRef.current) clearTimeout(lidTimerRef.current);
    // Keep the previous bin's highlight on screen during analysis so the user
    // still sees the last decision until the new result lands. The backend will
    // close the prior lid and open the new one once classification completes.

    const url = URL.createObjectURL(file);
    setPreviewUrl(url);

    const formData = new FormData();
    formData.append("file", file);

    try {
      const res = await fetch(`${API_BASE}/classify/image/stream`, {
        method: "POST",
        body: formData,
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.detail ?? `HTTP ${res.status}`);
      }

      const reader = res.body!.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";          // keep incomplete last line

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          let event: Record<string, unknown>;
          try {
            event = JSON.parse(line.slice(6));
          } catch {
            continue;
          }

          if (event.status === "thinking") {
            setThinkingText((prev) => prev + (event.text as string));
          } else if (event.status === "partial") {
            // Show the category card immediately — don't wait for the full result
            const partial: ClassificationResult = {
              item_identified: (event.item_identified as string) ?? "Analyzing…",
              category: event.category as ClassificationResult["category"],
              confidence: 0,
              is_contaminated: false,
              contamination_details: "",
              reasoning: "",
              bin_action: `OPEN_${event.category as string}`,
              education_tip: "",
              color: (event.color as string) ?? "#6b7280",
              icon: (event.icon as string) ?? "🗑️",
              timestamp: new Date().toISOString(),
              processing_time_ms: 0,
              unified_description: "",
              needs_confirmation: false,
              confirmation_question: "",
            };
            setResult(partial);
            setIsPartial(true);
            setIsLoading(false);
          } else if (event.status === "complete") {
            const data = event.result as ClassificationResult;
            setResult(data);
            setIsPartial(false);
            setIsLoading(false);

            const binKey = BIN_ACTION_MAP[data.bin_action];
            if (binKey) {
              setLidStates({ ...DEFAULT_LID_STATES, [binKey]: true });
              lidTimerRef.current = setTimeout(() => {
                setLidStates((prev) => ({ ...prev, [binKey]: false }));
              }, LID_OPEN_MS);
            }
          } else if (event.status === "error") {
            throw new Error((event.message as string) ?? "Classification failed");
          }
        }
      }
    } catch (err: unknown) {
      setError((err as Error).message ?? "Classification failed");
      setIsLoading(false);
      setIsPartial(false);
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
          <img src="/logo.png" alt="EcoBinAI logo" className="h-16 w-16 object-contain rounded-xl" />
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
              isSpeaking={isSpeaking}
              resultColor={result?.color}
              usbCameraEnabled={usbCameraEnabled}
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
            isPartial={isPartial}
            thinkingText={thinkingText}
            onConfirm={handleConfirmation}
            onReplay={() => result && speak(buildSpeechText(result))}
            isMuted={isMuted}
            onToggleMute={() => { setIsMuted((m) => { if (!m) cancel(); return !m; }); }}
            isListening={isListening}
            showCleaningGuidance={showCleaningGuidance}
            onCleaningDecision={handleCleaningDecision}
          />

          {/* ── Bin display ───────────────────────────────────────────────── */}
          <BinDisplay lidStates={lidStates} />
        </div>

        {/* ── Right column: stats ──────────────────────────────────────────── */}
        <div className="space-y-4">
          <h2 className="text-sm font-semibold uppercase tracking-widest text-gray-400">
            Waste Analytics
          </h2>
          <StatsPanel stats={stats} impact={impact} recentEvents={recentEvents} />

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
