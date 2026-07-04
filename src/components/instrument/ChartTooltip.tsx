"use client";

import { useCallback, useState } from "react";

export type ChartTip = {
  // Percentage coordinates within the chart wrapper (0–100).
  xPct: number;
  yPct: number;
  lines: string[];
} | null;

/** Pointer-driven tooltip state for an SVG chart. */
export function useChartTip() {
  const [tip, setTip] = useState<ChartTip>(null);
  const clear = useCallback(() => setTip(null), []);
  return { tip, setTip, clear };
}

/**
 * Styled tooltip rendered inside a `position: relative` chart wrapper.
 * Replaces native SVG <title> tooltips, which are slow to appear and
 * inconsistent across browsers.
 */
export function ChartTipBox({ tip }: { tip: ChartTip }) {
  if (!tip) return null;
  const flipBelow = tip.yPct < 30;
  return (
    <div
      style={{
        position: "absolute",
        left: `${Math.min(88, Math.max(12, tip.xPct))}%`,
        top: `${tip.yPct}%`,
        transform: flipBelow ? "translate(-50%, 14px)" : "translate(-50%, calc(-100% - 12px))",
        background: "var(--ink)",
        color: "rgba(255,255,255,0.94)",
        borderRadius: 10,
        padding: "7px 10px",
        fontSize: 11,
        lineHeight: 1.45,
        whiteSpace: "nowrap",
        pointerEvents: "none",
        boxShadow: "0 8px 22px rgba(28,32,48,0.28)",
        zIndex: 5,
      }}
    >
      {tip.lines.map((line, i) => (
        <div key={i} style={i === 0 ? { fontWeight: 700 } : undefined}>
          {line}
        </div>
      ))}
    </div>
  );
}
