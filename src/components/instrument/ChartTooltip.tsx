"use client";

import { useCallback, useRef, useState, type RefObject } from "react";

export type ChartTip = {
  // Percentage coordinates within the chart wrapper (0–100).
  xPct: number;
  yPct: number;
  lines: string[];
} | null;

/**
 * Pointer-driven tooltip state for an SVG chart.
 *
 * Positions are measured from the hovered element's rendered DOM rect, not
 * from viewBox coordinates — the SVGs render with width:100% and a fixed
 * height, so preserveAspectRatio letterboxes the drawing and viewBox-based
 * percentages drift away from the pointer.
 */
export function useChartTip(): {
  wrapperRef: RefObject<HTMLDivElement | null>;
  tip: ChartTip;
  showTip: (event: React.PointerEvent<Element>, lines: string[]) => void;
  clear: () => void;
} {
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const [tip, setTip] = useState<ChartTip>(null);

  const showTip = useCallback((event: React.PointerEvent<Element>, lines: string[]) => {
    const wrapper = wrapperRef.current;
    if (!wrapper) return;
    const target = event.currentTarget.getBoundingClientRect();
    const box = wrapper.getBoundingClientRect();
    if (box.width === 0 || box.height === 0) return;
    setTip({
      xPct: ((target.left + target.width / 2 - box.left) / box.width) * 100,
      yPct: ((target.top + target.height / 2 - box.top) / box.height) * 100,
      lines,
    });
  }, []);

  const clear = useCallback(() => setTip(null), []);
  return { wrapperRef, tip, showTip, clear };
}

/** Styled tooltip rendered inside the `position: relative` chart wrapper. */
export function ChartTipBox({ tip }: { tip: ChartTip }) {
  if (!tip) return null;
  const flipBelow = tip.yPct < 32;
  return (
    <div
      style={{
        position: "absolute",
        left: `${Math.min(94, Math.max(6, tip.xPct))}%`,
        top: `${tip.yPct}%`,
        transform: flipBelow ? "translate(-50%, 14px)" : "translate(-50%, calc(-100% - 12px))",
        background: "var(--ink)",
        color: "rgba(255,255,255,0.94)",
        borderRadius: "var(--r-sm)",
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
