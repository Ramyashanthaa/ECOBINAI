import { useEffect, useState } from "react";
import { BinCategory, LidStates } from "../types";

interface BinCfg {
  label: string;
  emoji: string;
  color: string;       // accent / border / glow / lid fill
  bodyTop: string;     // body gradient top
  bodyBottom: string;  // body gradient bottom
}

const BIN_CONFIG: Record<string, BinCfg> = {
  RECYCLABLE: {
    label: "Recycle",
    emoji: "♻️",
    color: "#22c55e",
    bodyTop: "#0e7c3b",
    bodyBottom: "#052e16",
  },
  COMPOST: {
    label: "Compost",
    emoji: "🌱",
    color: "#f97316",
    bodyTop: "#b54712",
    bodyBottom: "#431407",
  },
  TRASH: {
    label: "Trash",
    emoji: "🗑️",
    color: "#9ca3af",
    bodyTop: "#4b5563",
    bodyBottom: "#111827",
  },
  HAZARDOUS: {
    label: "Hazardous",
    emoji: "⚠️",
    color: "#ef4444",
    bodyTop: "#b91c1c",
    bodyBottom: "#450a0a",
  },
};

// Reference (desktop) sizing. On narrow viewports we scale all numbers
// down by `scale` so 4 bins always fit side-by-side without overflow.
const REF_BIN_W   = 96;
const REF_BIN_H   = 150;
const REF_LID_H   = 22;
const REF_TOP_PAD = 60;

interface BinProps {
  type: BinCategory;
  isOpen: boolean;
  scale: number;
}

function Bin({ type, isOpen, scale }: BinProps) {
  const cfg = BIN_CONFIG[type];
  const gradientId = `bin-grad-${type}`;
  const lidGradientId = `lid-grad-${type}`;

  const BIN_W   = REF_BIN_W * scale;
  const BIN_H   = REF_BIN_H * scale;
  const LID_H   = REF_LID_H * scale;
  const TOP_PAD = REF_TOP_PAD * scale;

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 8,
        transform: isOpen ? "scale(1.18) translateY(-6px)" : "scale(1)",
        transition: "transform 0.4s cubic-bezier(0.34, 1.3, 0.64, 1)",
        zIndex: isOpen ? 10 : 1,
        position: "relative",
      }}
    >
      <div style={{ position: "relative", width: BIN_W, paddingTop: TOP_PAD }}>

        {/* OPEN badge — large, pulsing, clearly visible above the bin */}
        {isOpen && (
          <div
            style={{
              position: "absolute",
              top: -8,
              left: "50%",
              transform: "translateX(-50%)",
              backgroundColor: cfg.color,
              color: "#fff",
              fontSize: scale < 0.7 ? 10 : 13,
              fontWeight: 800,
              padding: scale < 0.7 ? "4px 8px" : "6px 14px",
              borderRadius: 999,
              letterSpacing: "0.1em",
              animation: "badgeBounce 0.7s ease infinite alternate",
              whiteSpace: "nowrap",
              boxShadow: `0 0 0 4px ${cfg.color}33, 0 8px 24px ${cfg.color}cc`,
              textTransform: "uppercase",
            }}
          >
            ▼ Drop It In
          </div>
        )}

        {/* Pulsing glow ring under the bin when open */}
        {isOpen && (
          <div
            style={{
              position: "absolute",
              bottom: -10,
              left: "50%",
              transform: "translateX(-50%)",
              width: BIN_W + 24,
              height: 18,
              borderRadius: "50%",
              backgroundColor: cfg.color,
              opacity: 0.45,
              filter: "blur(10px)",
              animation: "ringPulse 1.2s ease-in-out infinite",
            }}
          />
        )}

        {/* Hinged lid — perspective on parent so rotateX looks 3-D */}
        <div
          style={{
            position: "absolute",
            top: TOP_PAD - LID_H + 2,
            left: 0,
            width: BIN_W,
            perspective: 320,
          }}
        >
          <svg
            width={BIN_W}
            height={LID_H + 6}
            viewBox={`0 0 ${BIN_W} ${LID_H + 6}`}
            style={{
              display: "block",
              transformOrigin: "bottom center",
              transform: isOpen ? "rotateX(-78deg)" : "rotateX(0deg)",
              transition: "transform 0.45s cubic-bezier(0.34, 1.3, 0.64, 1), filter 0.3s",
              filter: isOpen ? `drop-shadow(0 -6px 14px ${cfg.color}aa)` : "none",
            }}
          >
            <defs>
              <linearGradient id={lidGradientId} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={cfg.color} stopOpacity="1" />
                <stop offset="100%" stopColor={cfg.color} stopOpacity="0.75" />
              </linearGradient>
            </defs>
            {/* Lid body — wider at the back to suggest a real bin lid */}
            <path
              d={`M ${4 * scale} ${LID_H + 2 * scale}
                  L ${2 * scale} ${6 * scale}
                  Q ${2 * scale} ${2 * scale} ${6 * scale} ${2 * scale}
                  L ${BIN_W - 6 * scale} ${2 * scale}
                  Q ${BIN_W - 2 * scale} ${2 * scale} ${BIN_W - 2 * scale} ${6 * scale}
                  L ${BIN_W - 4 * scale} ${LID_H + 2 * scale} Z`}
              fill={`url(#${lidGradientId})`}
              stroke={cfg.color}
              strokeWidth={1.5 * scale}
            />
            {/* Hinge line at the back */}
            <line
              x1={8 * scale} y1={3.5 * scale} x2={BIN_W - 8 * scale} y2={3.5 * scale}
              stroke="rgba(0,0,0,0.35)" strokeWidth={1 * scale}
            />
            {/* Front handle ridge */}
            <rect
              x={BIN_W / 2 - 14 * scale} y={LID_H - 4 * scale}
              width={28 * scale} height={4 * scale} rx={2 * scale}
              fill="rgba(0,0,0,0.35)"
            />
          </svg>
        </div>

        {/* Bin body — trapezoidal, gradient-shaded with ribs */}
        <svg
          width={BIN_W}
          height={BIN_H}
          viewBox={`0 0 ${BIN_W} ${BIN_H}`}
          style={{
            display: "block",
            filter: isOpen ? `drop-shadow(0 0 18px ${cfg.color}66)` : "drop-shadow(0 4px 6px rgba(0,0,0,0.4))",
            transition: "filter 0.35s ease",
          }}
        >
          <defs>
            <linearGradient id={gradientId} x1="0" y1="0" x2="1" y2="0">
              <stop offset="0%" stopColor={cfg.bodyBottom} />
              <stop offset="45%" stopColor={cfg.bodyTop} />
              <stop offset="100%" stopColor={cfg.bodyBottom} />
            </linearGradient>
          </defs>

          {/* Body trapezoid — slightly narrower at the bottom, rounded bottom corners */}
          <path
            d={`M ${6 * scale} ${4 * scale}
                L ${BIN_W - 6 * scale} ${4 * scale}
                L ${BIN_W - 10 * scale} ${BIN_H - 18 * scale}
                Q ${BIN_W - 10 * scale} ${BIN_H - 8 * scale} ${BIN_W - 20 * scale} ${BIN_H - 8 * scale}
                L ${20 * scale} ${BIN_H - 8 * scale}
                Q ${10 * scale} ${BIN_H - 8 * scale} ${10 * scale} ${BIN_H - 18 * scale} Z`}
            fill={`url(#${gradientId})`}
            stroke={cfg.color}
            strokeWidth={1.8 * scale}
          />

          {/* Vertical ribs — give it a textured plastic-bin look */}
          {[0.28, 0.5, 0.72].map((p, i) => (
            <line
              key={i}
              x1={BIN_W * p}
              y1={10 * scale}
              x2={BIN_W * p - 4 * scale}
              y2={BIN_H - 16 * scale}
              stroke="rgba(255,255,255,0.08)"
              strokeWidth={1.5 * scale}
            />
          ))}

          {/* Highlight on left edge */}
          <path
            d={`M ${9 * scale} ${8 * scale} L ${13 * scale} ${BIN_H - 18 * scale}`}
            stroke="rgba(255,255,255,0.15)"
            strokeWidth={2 * scale}
            fill="none"
          />

          {/* Wheels */}
          <circle cx={18 * scale} cy={BIN_H - 6 * scale} r={6 * scale} fill="#1f2937" stroke="rgba(255,255,255,0.15)" strokeWidth="1" />
          <circle cx={18 * scale} cy={BIN_H - 6 * scale} r={2 * scale} fill="rgba(255,255,255,0.2)" />
          <circle cx={BIN_W - 18 * scale} cy={BIN_H - 6 * scale} r={6 * scale} fill="#1f2937" stroke="rgba(255,255,255,0.15)" strokeWidth="1" />
          <circle cx={BIN_W - 18 * scale} cy={BIN_H - 6 * scale} r={2 * scale} fill="rgba(255,255,255,0.2)" />

          {/* Category emoji centered on the body */}
          <text
            x={BIN_W / 2}
            y={BIN_H / 2 + 6 * scale}
            textAnchor="middle"
            fontSize={30 * scale}
            style={{ userSelect: "none" }}
          >
            {cfg.emoji}
          </text>
        </svg>
      </div>

      <p
        style={{
          margin: 0,
          fontSize: scale < 0.7 ? (isOpen ? 11 : 9) : (isOpen ? 14 : 11),
          fontWeight: isOpen ? 800 : 700,
          letterSpacing: "0.12em",
          textTransform: "uppercase",
          color: isOpen ? cfg.color : "#9ca3af",
          textShadow: isOpen ? `0 0 12px ${cfg.color}99` : "none",
          transition: "color 0.3s, font-size 0.3s, font-weight 0.3s",
        }}
      >
        {cfg.label}
      </p>
    </div>
  );
}

interface BinDisplayProps {
  lidStates: LidStates;
}

// Pick a scale that fits 4 bins + gaps + the +18% open-bin scale-up + card
// padding inside the available viewport width. Recomputes on resize/rotate.
function useBinScale(): number {
  const compute = () => {
    if (typeof window === "undefined") return 1;
    const vw = window.innerWidth;
    // Account for outer page padding (px-4 on <main> = 16px each side) +
    // glass-card p-4/p-6 internal padding + a small safety margin.
    const cardPaddingX = vw < 640 ? 32 : 48;
    const available = Math.min(vw, 1280) - cardPaddingX - 16;
    // Width consumed by 4 bins + 3 gaps, biggest bin scaled 1.18 when open
    const gap = vw < 640 ? 8 : 16;
    const naturalRowWidth = 4 * REF_BIN_W * 1.18 + 3 * gap;
    return Math.min(1, available / naturalRowWidth);
  };
  const [scale, setScale] = useState<number>(compute);
  useEffect(() => {
    const onResize = () => setScale(compute());
    window.addEventListener("resize", onResize);
    window.addEventListener("orientationchange", onResize);
    return () => {
      window.removeEventListener("resize", onResize);
      window.removeEventListener("orientationchange", onResize);
    };
  }, []);
  return scale;
}

export default function BinDisplay({ lidStates }: BinDisplayProps) {
  const scale = useBinScale();
  const isCompact = scale < 0.85;
  return (
    <div className="glass-card p-4 sm:p-6">
      <h2 className="text-sm font-semibold uppercase tracking-widest text-gray-400 mb-4 text-center">
        Smart Bin Station
      </h2>
      <div
        style={{
          display: "flex",
          justifyContent: "space-around",
          alignItems: "flex-end",
          gap: isCompact ? 6 : 16,
          paddingTop: 40 * scale, // room for the "DROP IT IN" badge above an open bin
          paddingBottom: 8,
        }}
      >
        {(Object.keys(lidStates) as Array<keyof LidStates>).map((bin) => (
          <Bin key={bin} type={bin} isOpen={lidStates[bin]} scale={scale} />
        ))}
      </div>
    </div>
  );
}
