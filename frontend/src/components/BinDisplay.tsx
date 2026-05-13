import { BinCategory, LidStates } from "../types";

interface BinCfg {
  label: string;
  emoji: string;
  color: string;       // accent / border / glow
  bodyBg: string;      // bin body fill
  lidBg: string;       // lid fill (slightly lighter)
}

const BIN_CONFIG: Record<string, BinCfg> = {
  RECYCLABLE: {
    label: "Recycle",
    emoji: "♻️",
    color: "#22c55e",
    bodyBg: "#052e16",
    lidBg: "#14532d",
  },
  COMPOST: {
    label: "Compost",
    emoji: "🌱",
    color: "#f97316",
    bodyBg: "#431407",
    lidBg: "#7c2d12",
  },
  TRASH: {
    label: "Trash",
    emoji: "🗑️",
    color: "#9ca3af",
    bodyBg: "#1c1c1e",
    lidBg: "#374151",
  },
  HAZARDOUS: {
    label: "Hazardous",
    emoji: "⚠️",
    color: "#ef4444",
    bodyBg: "#450a0a",
    lidBg: "#7f1d1d",
  },
};

const BIN_W = 88;   // px — bin body width
const LID_H = 28;   // px — lid height
const BODY_H = 116; // px — bin body height
const TOP_PAD = 48; // px — space above body for lid + badge

interface BinProps {
  type: BinCategory;
  isOpen: boolean;
}

function Bin({ type, isOpen }: BinProps) {
  const cfg = BIN_CONFIG[type];

  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 8 }}>

      {/* ── Bin visual: lid sits directly above body ─────────────────────── */}
      <div style={{ position: "relative", paddingTop: TOP_PAD }}>

        {/* "OPEN" badge — appears above the lid, bouncing */}
        {isOpen && (
          <div
            style={{
              position: "absolute",
              top: 0,
              left: "50%",
              transform: "translateX(-50%)",
              backgroundColor: cfg.color,
              color: "#fff",
              fontSize: 10,
              fontWeight: 700,
              padding: "2px 8px",
              borderRadius: 999,
              letterSpacing: "0.08em",
              animation: "badgeBounce 0.7s ease infinite alternate",
              whiteSpace: "nowrap",
            }}
          >
            ▲ OPEN
          </div>
        )}

        {/*
          Lid — perspective is applied here so rotateX looks 3-D.
          transform-origin: bottom center  →  hinge at the bottom edge of the lid
                                              (= top edge of the bin opening)
          rotateX(-80deg) on OPEN:
            bottom stays put, top swings TOWARD viewer then backward over the bin
            → looks exactly like a real bin lid opening backward
        */}
        <div
          style={{
            position: "absolute",
            top: TOP_PAD - LID_H,       // flush against the top of the bin body
            left: 0,
            width: BIN_W,
            perspective: 280,           // ← required for rotateX to look 3-D
          }}
        >
          <div
            style={{
              width: "100%",
              height: LID_H,
              backgroundColor: isOpen ? cfg.color + "cc" : cfg.lidBg,
              border: `2px solid ${cfg.color}`,
              borderRadius: "8px 8px 2px 2px",
              /* Hinge at bottom (= top of the bin opening) */
              transformOrigin: "bottom center",
              transform: isOpen ? "rotateX(-80deg)" : "rotateX(0deg)",
              transition: "transform 0.45s cubic-bezier(0.34, 1.3, 0.64, 1), background-color 0.3s",
              boxShadow: isOpen ? `0 -6px 18px ${cfg.color}88` : "none",
              display: "flex",
              alignItems: "flex-end",
              justifyContent: "center",
              paddingBottom: 4,
            }}
          >
            {/* Handle knob on lid */}
            <div
              style={{
                width: 20,
                height: 5,
                backgroundColor: cfg.color,
                borderRadius: 3,
                opacity: 0.9,
              }}
            />
          </div>
        </div>

        {/* ── Bin body ─────────────────────────────────────────────────── */}
        <div
          style={{
            width: BIN_W,
            height: BODY_H,
            backgroundColor: cfg.bodyBg,
            /* No top border — the lid covers the top opening */
            border: `2px solid ${cfg.color}`,
            borderTop: "none",
            borderRadius: "0 0 14px 14px",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            transition: "box-shadow 0.35s ease",
            boxShadow: isOpen
              ? `0 0 28px ${cfg.color}55, inset 0 0 24px ${cfg.color}22`
              : "none",
          }}
        >
          <span style={{ fontSize: 32, lineHeight: 1, userSelect: "none" }}>
            {cfg.emoji}
          </span>
        </div>
      </div>

      {/* ── Label — always BELOW the bin, never overlapping ──────────────── */}
      <p
        style={{
          margin: 0,
          fontSize: 11,
          fontWeight: 700,
          letterSpacing: "0.12em",
          textTransform: "uppercase",
          color: isOpen ? cfg.color : "#6b7280",
          transition: "color 0.3s",
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

export default function BinDisplay({ lidStates }: BinDisplayProps) {
  return (
    <div className="glass-card p-6">
      <h2 className="text-sm font-semibold uppercase tracking-widest text-gray-400 mb-8 text-center">
        Smart Bin Station
      </h2>
      <div
        style={{
          display: "flex",
          justifyContent: "space-around",
          alignItems: "flex-end",
          gap: 16,
          paddingBottom: 8,
        }}
      >
        {(Object.keys(lidStates) as Array<keyof LidStates>).map((bin) => (
          <Bin key={bin} type={bin} isOpen={lidStates[bin]} />
        ))}
      </div>
    </div>
  );
}
