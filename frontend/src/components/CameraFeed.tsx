import { useCallback, useEffect, useRef, useState } from "react";

const AUTO_SCAN_INTERVAL_MS = 4000;

interface Props {
  onCapture: (file: File) => void;
  isClassifying: boolean;
  resultColor?: string;
}

export default function CameraFeed({ onCapture, isClassifying, resultColor }: Props) {
  const videoRef        = useRef<HTMLVideoElement>(null);
  const streamRef       = useRef<MediaStream | null>(null);
  const isClassifyingRef = useRef(isClassifying);

  const [isActive,    setIsActive]    = useState(false);
  const [isReady,     setIsReady]     = useState(false); // true once video is playing
  const [isAutoScan,  setIsAutoScan]  = useState(false);
  const [flash,       setFlash]       = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);

  // Keep ref in sync so the interval callback never reads stale state
  useEffect(() => { isClassifyingRef.current = isClassifying; }, [isClassifying]);

  // ── THE KEY FIX ────────────────────────────────────────────────────────────
  // The <video> element only exists in the DOM after isActive → true.
  // We must attach the stream in a useEffect that runs after that render,
  // NOT inside startCamera() where videoRef.current is still null.
  useEffect(() => {
    if (isActive && videoRef.current && streamRef.current) {
      videoRef.current.srcObject = streamRef.current;
      videoRef.current.play().catch(() => {/* autoplay policy — muted video always works */});
    }
  }, [isActive]);
  // ──────────────────────────────────────────────────────────────────────────

  const captureFrame = useCallback(() => {
    const video = videoRef.current;
    if (!video || video.readyState < 2) return;

    // Brief white flash so the user knows a frame was captured
    setFlash(true);
    setTimeout(() => setFlash(false), 120);

    const canvas = document.createElement("canvas");
    canvas.width  = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    // Draw raw frame — mirroring is only a CSS display trick, AI gets correct orientation
    ctx.drawImage(video, 0, 0);

    canvas.toBlob(
      (blob) => {
        if (!blob) return;
        onCapture(new File([blob], `scan-${Date.now()}.jpg`, { type: "image/jpeg" }));
      },
      "image/jpeg",
      0.92
    );
  }, [onCapture]);

  const startCamera = useCallback(async () => {
    setCameraError(null);
    setIsReady(false);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: false,
      });
      streamRef.current = stream;
      setIsActive(true);        // ← render <video> first …
      // … then the useEffect above attaches streamRef to videoRef
    } catch (err) {
      const name = (err as Error).name;
      setCameraError(
        name === "NotAllowedError"  ? "Camera access denied — click the camera icon in your browser address bar and allow access." :
        name === "NotFoundError"    ? "No camera found — make sure your webcam is connected." :
                                      "Could not start camera: " + (err as Error).message
      );
    }
  }, []);

  const stopCamera = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    setIsActive(false);
    setIsReady(false);
    setIsAutoScan(false);
  }, []);

  // Auto-scan — fires every AUTO_SCAN_INTERVAL_MS while active, skips if busy
  useEffect(() => {
    if (!isAutoScan || !isActive) return;
    if (!isClassifyingRef.current) captureFrame();
    const id = setInterval(() => {
      if (!isClassifyingRef.current) captureFrame();
    }, AUTO_SCAN_INTERVAL_MS);
    return () => clearInterval(id);
  }, [isAutoScan, isActive, captureFrame]);

  // Stop camera tracks when the component unmounts
  useEffect(() => () => { streamRef.current?.getTracks().forEach((t) => t.stop()); }, []);

  const accentColor = resultColor ?? "#22c55e";

  // ── Idle (camera not yet started) ──────────────────────────────────────────
  if (!isActive) {
    return (
      <div
        onClick={startCamera}
        className="border-2 border-dashed border-gray-700 rounded-2xl p-10
                   text-center cursor-pointer select-none
                   hover:border-emerald-500 hover:bg-emerald-900/10 transition-all"
      >
        <div className="space-y-4">
          <span className="text-6xl block">📷</span>
          <p className="text-white font-semibold text-lg">Click to start camera</p>
          <p className="text-gray-500 text-sm">
            Hold a waste item in front of your webcam, then press the shutter button
          </p>
          {cameraError && (
            <p className="text-red-400 text-sm bg-red-900/20 border border-red-700/40
                          rounded-xl px-4 py-2 mt-2">
              {cameraError}
            </p>
          )}
        </div>
      </div>
    );
  }

  // ── Live camera view ────────────────────────────────────────────────────────
  return (
    <div className="relative rounded-2xl overflow-hidden bg-black select-none">

      {/* Live video — mirror display for natural selfie orientation */}
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted
        onCanPlay={() => setIsReady(true)}
        className="w-full block"
        style={{ transform: "scaleX(-1)", minHeight: 280 }}
      />

      {/* Spinner shown while stream is attaching (usually < 500 ms) */}
      {!isReady && (
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-gray-900 gap-3">
          <div className="w-10 h-10 border-4 border-emerald-500 border-t-transparent rounded-full animate-spin" />
          <p className="text-gray-400 text-sm">Starting camera…</p>
        </div>
      )}

      {/* Viewfinder corner brackets */}
      {isReady && (
        <div className="absolute inset-0 pointer-events-none">
          {[
            "top-4 left-4 border-t-2 border-l-2 rounded-tl-lg",
            "top-4 right-4 border-t-2 border-r-2 rounded-tr-lg",
            "bottom-24 left-4 border-b-2 border-l-2 rounded-bl-lg",
            "bottom-24 right-4 border-b-2 border-r-2 rounded-br-lg",
          ].map((cls, i) => (
            <div
              key={i}
              className={`absolute w-8 h-8 transition-colors duration-500 ${cls}`}
              style={{ borderColor: accentColor }}
            />
          ))}
        </div>
      )}

      {/* Capture flash */}
      {flash && <div className="absolute inset-0 bg-white/50 pointer-events-none" />}

      {/* Analyzing overlay */}
      {isClassifying && (
        <div className="absolute inset-0 bg-black/65 flex flex-col items-center
                        justify-center gap-4 pointer-events-none">
          <div
            className="w-16 h-16 rounded-full border-[5px] border-t-transparent animate-spin"
            style={{ borderColor: `${accentColor} transparent ${accentColor} ${accentColor}` }}
          />
          <p className="text-white text-sm font-semibold tracking-wide">
            Gemma 4 analyzing…
          </p>
        </div>
      )}

      {/* Auto-scan live pulse */}
      {isAutoScan && !isClassifying && (
        <div className="absolute top-3 left-3 flex items-center gap-1.5 pointer-events-none">
          <span className="relative flex h-3 w-3">
            <span
              className="animate-ping absolute inline-flex h-full w-full rounded-full opacity-75"
              style={{ backgroundColor: accentColor }}
            />
            <span
              className="relative inline-flex rounded-full h-3 w-3"
              style={{ backgroundColor: accentColor }}
            />
          </span>
          <span className="text-xs font-bold text-white/80 tracking-widest uppercase">
            Auto Scan
          </span>
        </div>
      )}

      {/* ── Bottom control bar (only shown once video is ready) ────────────── */}
      {isReady && (
        <div className="absolute bottom-0 left-0 right-0
                        bg-gradient-to-t from-black/95 via-black/70 to-transparent
                        pt-10 pb-5 px-8">
          <div className="flex items-center justify-between">

            {/* Auto-scan toggle */}
            <button
              onClick={() => setIsAutoScan((p) => !p)}
              className="flex flex-col items-center gap-1.5 group"
              title="Auto scan every 4 seconds"
            >
              <div
                className={`w-12 h-6 rounded-full relative transition-all duration-300
                  ${isAutoScan ? "bg-emerald-500" : "bg-gray-600"}`}
              >
                <div
                  className={`absolute top-0.5 w-5 h-5 bg-white rounded-full shadow
                    transition-all duration-300
                    ${isAutoScan ? "left-6" : "left-0.5"}`}
                />
              </div>
              <span className="text-xs text-gray-400 group-hover:text-white transition-colors">
                {isAutoScan ? "Auto: On" : "Auto"}
              </span>
            </button>

            {/* Shutter button */}
            <button
              onClick={captureFrame}
              disabled={isClassifying}
              title="Scan now"
              className="relative flex items-center justify-center w-18 h-18 rounded-full
                         border-4 transition-all duration-150
                         active:scale-90 hover:scale-105
                         disabled:opacity-40 disabled:cursor-not-allowed"
              style={{
                width: 72, height: 72,
                borderColor: accentColor,
                backgroundColor: accentColor + "22",
              }}
            >
              <div
                className="w-12 h-12 rounded-full transition-colors duration-300"
                style={{ backgroundColor: isClassifying ? "#6b7280" : accentColor }}
              />
            </button>

            {/* Stop camera */}
            <button
              onClick={stopCamera}
              className="flex flex-col items-center gap-1.5 group"
              title="Stop camera"
            >
              <div className="w-12 h-6 flex items-center justify-center">
                <span className="text-xl text-gray-400 group-hover:text-white transition-colors">
                  ✕
                </span>
              </div>
              <span className="text-xs text-gray-400 group-hover:text-white transition-colors">
                Stop
              </span>
            </button>

          </div>
        </div>
      )}
    </div>
  );
}
