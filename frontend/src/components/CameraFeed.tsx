import { useCallback, useEffect, useRef, useState } from "react";

const AUTO_SCAN_INTERVAL_MS = 1500;
// Scene-change detection: downsample current frame to 32x32 grayscale and
// compare with the last classified frame. Skip auto-capture if mean absolute
// pixel diff is below this threshold (0–255 scale).
const SCENE_DIFF_THRESHOLD = 12;
const THUMB_SIZE = 32;

interface Props {
  onCapture: (file: File) => void;
  isClassifying: boolean;
  isSpeaking?: boolean;
  resultColor?: string;
}

export default function CameraFeed({ onCapture, isClassifying, isSpeaking = false, resultColor }: Props) {
  const videoRef        = useRef<HTMLVideoElement>(null);
  const streamRef       = useRef<MediaStream | null>(null);
  const isClassifyingRef = useRef(isClassifying);
  const isSpeakingRef    = useRef(isSpeaking);
  const lastThumbRef    = useRef<Uint8ClampedArray | null>(null);

  const [isActive,    setIsActive]    = useState(false);
  const [isReady,     setIsReady]     = useState(false); // true once video is playing
  const [isAutoScan,  setIsAutoScan]  = useState(false);
  const [flash,       setFlash]       = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  // Prefer the rear ("environment") camera by default — better for photographing
  // waste items, and matches user expectation on phones.
  const [facingMode,  setFacingMode]  = useState<"user" | "environment">("environment");

  // Keep refs in sync so the interval callback never reads stale state
  useEffect(() => { isClassifyingRef.current = isClassifying; }, [isClassifying]);
  useEffect(() => { isSpeakingRef.current    = isSpeaking; },    [isSpeaking]);

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

  // Compute a small grayscale thumbnail of the current video frame, used for
  // cheap scene-change detection in auto-scan mode.
  const getThumbnail = useCallback((): Uint8ClampedArray | null => {
    const video = videoRef.current;
    if (!video || video.readyState < 2) return null;
    const thumb = document.createElement("canvas");
    thumb.width = THUMB_SIZE;
    thumb.height = THUMB_SIZE;
    const tctx = thumb.getContext("2d");
    if (!tctx) return null;
    tctx.drawImage(video, 0, 0, THUMB_SIZE, THUMB_SIZE);
    const { data } = tctx.getImageData(0, 0, THUMB_SIZE, THUMB_SIZE);
    // Convert RGBA → single grayscale byte per pixel for fast diffing
    const gray = new Uint8ClampedArray(THUMB_SIZE * THUMB_SIZE);
    for (let i = 0, j = 0; i < data.length; i += 4, j++) {
      gray[j] = (data[i] + data[i + 1] + data[i + 2]) / 3;
    }
    return gray;
  }, []);

  const meanAbsDiff = (a: Uint8ClampedArray, b: Uint8ClampedArray): number => {
    let sum = 0;
    for (let i = 0; i < a.length; i++) sum += Math.abs(a[i] - b[i]);
    return sum / a.length;
  };

  const captureFrame = useCallback(() => {
    const video = videoRef.current;
    if (!video || video.readyState < 2) return;

    // Remember this frame's thumbnail so auto-scan can detect scene changes
    lastThumbRef.current = getThumbnail();

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
  }, [onCapture, getThumbnail]);

  const requestStream = useCallback(async (mode: "user" | "environment"): Promise<MediaStream> => {
    // Try the preferred camera first; fall back to the other side if unavailable
    // (e.g. laptops have no rear cam — environment will fail there).
    try {
      return await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: mode }, width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: false,
      });
    } catch {
      return await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: false,
      });
    }
  }, []);

  const startCamera = useCallback(async () => {
    setCameraError(null);
    setIsReady(false);
    try {
      const stream = await requestStream(facingMode);
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
  }, [facingMode, requestStream]);

  const flipCamera = useCallback(async () => {
    const next = facingMode === "environment" ? "user" : "environment";
    setFacingMode(next);
    if (!isActive) return;
    // Swap the active stream in place without unmounting the <video>
    setIsReady(false);
    streamRef.current?.getTracks().forEach((t) => t.stop());
    try {
      const stream = await requestStream(next);
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.play().catch(() => {});
      }
      lastThumbRef.current = null;       // reset baseline so auto-scan re-fires
    } catch (err) {
      setCameraError("Could not switch camera: " + (err as Error).message);
    }
  }, [facingMode, isActive, requestStream]);

  const stopCamera = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    setIsActive(false);
    setIsReady(false);
    setIsAutoScan(false);
    lastThumbRef.current = null;
  }, []);

  // Auto-scan — only fires when the scene has changed meaningfully since
  // the last classified frame. Prevents re-analyzing the same waste item
  // (or the same person standing in front of the camera) over and over.
  useEffect(() => {
    if (!isAutoScan || !isActive) return;
    // First capture: always fire so we have a baseline thumbnail
    if (!isClassifyingRef.current && lastThumbRef.current === null) captureFrame();

    const id = setInterval(() => {
      // Wait until the previous classification AND its voiceover have finished
      if (isClassifyingRef.current || isSpeakingRef.current) return;
      const current = getThumbnail();
      if (!current) return;
      const baseline = lastThumbRef.current;
      if (baseline && meanAbsDiff(current, baseline) < SCENE_DIFF_THRESHOLD) return;
      captureFrame();
    }, AUTO_SCAN_INTERVAL_MS);
    return () => clearInterval(id);
  }, [isAutoScan, isActive, captureFrame, getThumbnail]);

  // Reset baseline thumbnail when auto-scan is turned off so toggling it back
  // on will fire a fresh first capture rather than waiting on a stale diff.
  useEffect(() => {
    if (!isAutoScan) lastThumbRef.current = null;
  }, [isAutoScan]);

  // Stop camera tracks when the component unmounts
  useEffect(() => () => { streamRef.current?.getTracks().forEach((t) => t.stop()); }, []);

  const accentColor = resultColor ?? "#22c55e";

  // ── Idle (camera not yet started) ──────────────────────────────────────────
  if (!isActive) {
    return (
      <div>
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
      </div>
    );
  }

  // ── Live camera view ────────────────────────────────────────────────────────
  return (
    <div className="relative rounded-2xl overflow-hidden bg-black select-none">

      {/* Live video — mirror only the front (user) camera so selfies feel
          natural; rear camera should show the real-world orientation. */}
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted
        onCanPlay={() => setIsReady(true)}
        className="w-full block"
        style={{
          transform: facingMode === "user" ? "scaleX(-1)" : "none",
          minHeight: 280,
        }}
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
            EcoBin AI is analyzing…
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
              title="Auto-scan: only re-analyzes when the scene changes"
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

            {/* Flip camera (front ↔ back) — iOS-style circular icon button */}
            <button
              onClick={flipCamera}
              aria-label={`Switch to ${facingMode === "environment" ? "front" : "back"} camera`}
              title={`Switch to ${facingMode === "environment" ? "front" : "back"} camera`}
              className="w-11 h-11 rounded-full flex items-center justify-center
                         bg-white/10 hover:bg-white/20 active:bg-white/30
                         backdrop-blur-md border border-white/15
                         transition-all duration-200 active:scale-90"
            >
              <svg
                width="22" height="22" viewBox="0 0 24 24" fill="none"
                stroke="white" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"
              >
                <path d="M3.5 8.5h4l1.2-2h6.6l1.2 2h4v11h-17z" />
                <circle cx="12" cy="13.5" r="3.2" />
                <path d="M9.5 13.5a2.5 2.5 0 0 1 4.5-1.5M14.5 13.5a2.5 2.5 0 0 1-4.5 1.5" />
                <path d="M14 12l1-1.2M10 15l-1 1.2" />
              </svg>
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
