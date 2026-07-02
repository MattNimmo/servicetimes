"use client";

import { useCallback, useEffect, useState } from "react";

const STORAGE_KEY = "service-times.dashboard-guide.open";

const GUIDE_SECTIONS = [
  {
    title: "Daily scan",
    items: [
      "Start in Glance to compare campuses, slots, and the mid-service lever.",
      "Open campus cards with attention states before reading healthy campuses.",
      "Use recommendation rows as prompts, not automatic truth; they point to timing patterns worth reviewing.",
    ],
  },
  {
    title: "Triage",
    items: [
      "Use Triage when a slot, item, or mapping needs a decision before the numbers should be trusted.",
      "Correct raw timing only through the correction forms; the original Planning Center evidence stays intact.",
      "Resolve or reopen incidents from the row where the evidence appears, so the audit trail keeps its context.",
    ],
  },
  {
    title: "Workbench",
    items: [
      "Use Workbench for one campus and slot at a time when you need trend context and element-level detail.",
      "Compare planned time, actual time, and phase deltas before applying a recommendation.",
      "Generate, apply, or dismiss recommendations from the review panel; applied and dismissed rows are audited.",
    ],
  },
  {
    title: "Operating rhythm",
    items: [
      "After ingestion, scan Glance, clear Triage blockers, then use Workbench to review recurring timing levers.",
      "Treat provisional targets as context only; planned item times are the recommendation target for each service/location.",
      "If something looks off, prefer reopening or dismissing with context over editing around the evidence.",
    ],
  },
] as const;

export default function DashboardGuide() {
  const [isReady, setIsReady] = useState(false);
  const [isOpen, setIsOpen] = useState(true);

  useEffect(() => {
    const id = setTimeout(() => {
      const stored = window.localStorage.getItem(STORAGE_KEY);
      setIsOpen(stored === null ? true : stored === "true");
      setIsReady(true);
    }, 0);
    return () => clearTimeout(id);
  }, []);

  const setGuideOpen = useCallback((nextOpen: boolean) => {
    setIsOpen(nextOpen);
    window.localStorage.setItem(STORAGE_KEY, String(nextOpen));
  }, []);

  if (!isReady) return null;

  return (
    <section
      className={isOpen ? "dashboard-guide dashboard-guide--open" : "dashboard-guide"}
      aria-label="Dashboard guide"
    >
      <div className="dashboard-guide__shell glass-card">
        <div className="dashboard-guide__header">
          <div>
            <p className="instrument-eyebrow">Guide</p>
            <h2 className="dashboard-guide__title">Operate the dashboard</h2>
            <p className="dashboard-guide__summary">
              A quick field guide for reading the service timing flow, resolving review states,
              and applying recommendations with context.
            </p>
          </div>
          <button
            type="button"
            className="btn btn--ghost btn--compact dashboard-guide__toggle"
            onClick={() => setGuideOpen(!isOpen)}
            aria-expanded={isOpen}
            aria-controls="dashboard-guide-content"
          >
            {isOpen ? "Hide guide" : "Show guide"}
          </button>
        </div>

        {isOpen && (
          <div id="dashboard-guide-content" className="dashboard-guide__content">
            <div className="dashboard-guide__grid">
              {GUIDE_SECTIONS.map((section) => (
                <article key={section.title} className="dashboard-guide__section">
                  <h3>{section.title}</h3>
                  <ul>
                    {section.items.map((item) => (
                      <li key={item}>{item}</li>
                    ))}
                  </ul>
                </article>
              ))}
            </div>
            <p className="dashboard-guide__memory">
              This guide opens the first time by default. Hide or show it and the dashboard
              will remember that choice on this browser.
            </p>
          </div>
        )}
      </div>
    </section>
  );
}
