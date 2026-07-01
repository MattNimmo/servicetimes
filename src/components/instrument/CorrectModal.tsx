"use client";

import { useEffect, useState } from "react";

import {
  correctItemTimeIncidentAction,
  correctPlanTimeIncidentAction,
} from "@/lib/operator/review-actions";
import { formatDuration } from "@/lib/variance/format";

export type CorrectModalPayload = {
  incidentId: number;
  kind: string;
  rawActualSeconds: number | null;
  plannedSeconds: number | null;
  itemTimeId: number | null;
  redirectTo: string;
};

function secondsToInput(seconds: number | null): string {
  if (seconds === null) return "";
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

// Inner component — mounted fresh for each new payload via `key` in CorrectModal.
function ModalPanel({
  payload,
  onClose,
}: {
  payload: CorrectModalPayload;
  onClose: () => void;
}) {
  const [value, setValue] = useState(() => secondsToInput(payload.rawActualSeconds));

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const isItemTime = payload.itemTimeId !== null;
  const action = isItemTime
    ? correctItemTimeIncidentAction
    : correctPlanTimeIncidentAction;

  return (
    <div
      style={{
        background: "var(--glass-card)",
        backdropFilter: "blur(var(--glass-blur))",
        WebkitBackdropFilter: "blur(var(--glass-blur))",
        border: "1px solid var(--glass-border)",
        boxShadow: "var(--glass-shadow)",
        borderRadius: 18,
        padding: "24px 24px 20px",
        width: "100%",
        maxWidth: 420,
      }}
      onClick={(e) => e.stopPropagation()}
    >
      <p
        style={{
          margin: "0 0 16px",
          fontSize: "var(--type-micro)",
          fontWeight: 700,
          letterSpacing: "0.2em",
          textTransform: "uppercase",
          color: "var(--accent)",
        }}
      >
        Correct actual
      </p>

      {/* Info row */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: 12,
          marginBottom: 20,
        }}
      >
        <div>
          <p
            style={{
              margin: "0 0 4px",
              fontSize: "var(--type-micro)",
              fontWeight: 700,
              letterSpacing: "0.18em",
              textTransform: "uppercase",
              color: "var(--ink-70)",
            }}
          >
            Raw actual
          </p>
          <p
            className="tabular"
            style={{ margin: 0, fontSize: 18, fontWeight: 700, color: "var(--over)" }}
          >
            {formatDuration(payload.rawActualSeconds)}
          </p>
        </div>
        <div>
          <p
            style={{
              margin: "0 0 4px",
              fontSize: "var(--type-micro)",
              fontWeight: 700,
              letterSpacing: "0.18em",
              textTransform: "uppercase",
              color: "var(--ink-70)",
            }}
          >
            Plan
          </p>
          <p
            className="tabular"
            style={{ margin: 0, fontSize: 18, fontWeight: 700 }}
          >
            {formatDuration(payload.plannedSeconds)}
          </p>
        </div>
      </div>

      <p
        style={{
          margin: "0 0 16px",
          fontSize: "var(--type-caption)",
          fontWeight: 700,
          letterSpacing: "0.14em",
          textTransform: "uppercase",
          color: "var(--ink-70)",
        }}
      >
        {payload.kind.replace(/_/g, " ")}
      </p>

      <form action={action}>
        <input type="hidden" name="incidentId" value={String(payload.incidentId)} />
        <input type="hidden" name="redirectTo" value={payload.redirectTo} />
        {isItemTime ? (
          <input
            type="hidden"
            name={`itemTime:${payload.itemTimeId}`}
            value={value}
          />
        ) : (
          <input type="hidden" name="correctedActual" value={value} />
        )}

        <label
          style={{
            display: "block",
            fontSize: 11,
            fontWeight: 700,
            letterSpacing: "0.14em",
            textTransform: "uppercase",
            color: "var(--ink-70)",
            marginBottom: 6,
          }}
        >
          Corrected M:SS
        </label>
        <input
          type="text"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="e.g. 42:30"
          pattern="\d+:\d{2}"
          required
          className="glass-input"
          style={{
            fontSize: 16,
            fontWeight: 600,
            fontVariantNumeric: "tabular-nums",
          }}
        />

        <div
          style={{
            display: "flex",
            gap: 10,
            marginTop: 20,
            justifyContent: "flex-end",
          }}
        >
          <button
            type="button"
            onClick={onClose}
            style={{
              padding: "9px 18px",
              borderRadius: 999,
              border: "1px solid var(--ink-line-strong)",
              background: "transparent",
              fontSize: 11,
              fontWeight: 700,
              cursor: "pointer",
              color: "var(--ink-70)",
            }}
          >
            Cancel
          </button>
          <button
            type="submit"
            style={{
              padding: "9px 18px",
              borderRadius: 999,
              border: "none",
              background: "var(--accent)",
              color: "white",
              fontSize: 11,
              fontWeight: 700,
              letterSpacing: "0.12em",
              textTransform: "uppercase",
              cursor: "pointer",
            }}
          >
            Save · human-adjusted
          </button>
        </div>
      </form>
    </div>
  );
}

export default function CorrectModal({
  payload,
  onClose,
}: {
  payload: CorrectModalPayload | null;
  onClose: () => void;
}) {
  if (!payload) return null;

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(40,42,80,0.32)",
        backdropFilter: "blur(5px)",
        WebkitBackdropFilter: "blur(5px)",
        zIndex: 100,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 16,
      }}
      onClick={onClose}
    >
      {/* key forces remount (fresh input state) when incident changes */}
      <ModalPanel key={payload.incidentId} payload={payload} onClose={onClose} />
    </div>
  );
}
