"use client";

import { useEffect, useRef, useState } from "react";

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
  const dialogRef = useRef<HTMLDialogElement>(null);

  // Native <dialog> provides the modal semantics: focus trap, Esc-to-cancel,
  // top layer, and aria-modal behavior for screen readers.
  useEffect(() => {
    dialogRef.current?.showModal();
  }, []);

  const isItemTime = payload.itemTimeId !== null;
  const action = isItemTime
    ? correctItemTimeIncidentAction
    : correctPlanTimeIncidentAction;

  return (
    <dialog
      ref={dialogRef}
      className="correct-dialog"
      aria-labelledby="correct-dialog-title"
      onClose={onClose}
      onClick={(e) => {
        // A click on the dialog element itself (not its children) is a
        // click on the backdrop area.
        if (e.target === dialogRef.current) onClose();
      }}
      style={{
        background: "var(--glass-card)",
        backdropFilter: "var(--glass-filter)",
        WebkitBackdropFilter: "var(--glass-filter)",
        border: "1px solid var(--glass-border)",
        boxShadow: "var(--glass-shadow)",
        borderRadius: "var(--r-glance)",
        padding: "24px 24px 20px",
        width: "100%",
        maxWidth: 420,
        color: "var(--ink)",
      }}
    >
      <p
        id="correct-dialog-title"
        style={{
          margin: "0 0 16px",
          fontSize: "var(--type-caption)",
          fontWeight: 600,
          color: "var(--accent-text)",
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
              fontSize: "var(--type-caption)",
              fontWeight: 600,
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
              fontSize: "var(--type-caption)",
              fontWeight: 600,
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
          fontWeight: 600,
          color: "var(--ink-70)",
        }}
      >
        {(() => {
          const raw = payload.kind.replace(/_/g, " ");
          return raw.charAt(0).toUpperCase() + raw.slice(1);
        })()}
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
          htmlFor="corrected-actual-input"
          style={{
            display: "block",
            fontSize: "var(--type-caption)",
            fontWeight: 600,
            color: "var(--ink-70)",
            marginBottom: 6,
          }}
        >
          Corrected M:SS
        </label>
        <input
          id="corrected-actual-input"
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
          <button type="button" onClick={onClose} className="btn btn--ghost">
            Cancel
          </button>
          <button type="submit" className="btn btn--primary">
            Save · human-adjusted
          </button>
        </div>
      </form>
    </dialog>
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

  // key forces remount (fresh input state + showModal) when incident changes
  return <ModalPanel key={payload.incidentId} payload={payload} onClose={onClose} />;
}
