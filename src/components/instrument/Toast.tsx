"use client";

import { useEffect } from "react";

export default function Toast({
  message,
  onDismiss,
}: {
  message: string | null;
  onDismiss: () => void;
}) {
  useEffect(() => {
    if (!message) return;
    const id = setTimeout(onDismiss, 4000);
    return () => clearTimeout(id);
  }, [message, onDismiss]);

  if (!message) return null;

  return (
    <div
      style={{
        position: "fixed",
        bottom: 24,
        left: "50%",
        transform: "translateX(-50%)",
        zIndex: 200,
        display: "flex",
        alignItems: "center",
        gap: 12,
        padding: "10px 18px",
        borderRadius: 999,
        background: "rgba(255,255,255,0.82)",
        backdropFilter: "blur(20px)",
        WebkitBackdropFilter: "blur(20px)",
        boxShadow: "var(--glass-shadow)",
        border: "1px solid rgba(255,255,255,0.8)",
        whiteSpace: "nowrap",
      }}
    >
      <span
        style={{
          fontSize: 13,
          fontWeight: 600,
          color: "var(--under)",
        }}
      >
        ✓
      </span>
      <span style={{ fontSize: 12, fontWeight: 600, color: "var(--ink)" }}>
        {message}
      </span>
      <button
        type="button"
        onClick={onDismiss}
        style={{
          marginLeft: 4,
          fontSize: "var(--type-caption)",
          fontWeight: 700,
          letterSpacing: "0.12em",
          textTransform: "uppercase",
          color: "var(--ink-55)",
          background: "transparent",
          border: "none",
          cursor: "pointer",
          padding: 0,
        }}
      >
        Dismiss
      </button>
    </div>
  );
}
