"use client";

import { useCallback, useEffect, useState } from "react";

const STORAGE_KEY = "service-times.dashboard-guide.open";

type GuideSection = {
  title: string;
  operatorOnly?: boolean;
  items: readonly string[];
};

const GUIDE_SECTIONS: readonly GuideSection[] = [
  {
    title: "Glance",
    items: [
      "Start here Monday. Each card answers one question: did that Location land on plan?",
      "Open the cards with attention states first; healthy Locations can wait.",
      "Recommendations are prompts, not verdicts — they point at timing worth a look.",
    ],
  },
  {
    title: "Workbench",
    items: [
      "One Location, one service. Use it when you need trend context and element-level detail.",
      "Compare planned, actual, and the phase breakdown before changing anything in Planning Center.",
      "A confirmed trend usually means the plan is wrong, not the execution — update the planned time.",
    ],
  },
  {
    title: "Verify",
    operatorOnly: true,
    items: [
      "Use Verify when an item needs a decision before the numbers can be trusted.",
      "Correct raw timing only through the correction forms; the original Planning Center evidence stays intact.",
      "Resolve or reopen from the row where the evidence appears, so the audit trail keeps its context.",
    ],
  },
  {
    title: "Weekly rhythm",
    operatorOnly: true,
    items: [
      "After Sunday's ingest: scan Glance, clear Verify, then review recurring levers in Workbench.",
      "Working targets are context, not law; planned item times are what you actually calibrate.",
      "If something looks off, reopen or dismiss with context — don't edit around the evidence.",
    ],
  },
] as const;

export default function DashboardGuide({ isOperator }: { isOperator: boolean }) {
  const [isReady, setIsReady] = useState(false);
  const [isOpen, setIsOpen] = useState(true);

  useEffect(() => {
    const id = setTimeout(() => {
      const stored = window.localStorage.getItem(STORAGE_KEY);
      if (stored === null) {
        // True first run: show the guide once, then collapse on every later
        // visit unless the user reopens it. The verdict owns the first paint.
        setIsOpen(true);
        window.localStorage.setItem(STORAGE_KEY, "false");
      } else {
        setIsOpen(stored === "true");
      }
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
            <p className="tile-label">Guide</p>
            <h2 className="dashboard-guide__title">How to read this</h2>
            <p className="dashboard-guide__summary">
              A one-minute field guide to the views and what to do with what they show.
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
              {GUIDE_SECTIONS.filter(
                (section) => !section.operatorOnly || isOperator,
              ).map((section) => (
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
              This guide stays tucked away after your first visit — reopen it here anytime.
            </p>
          </div>
        )}
      </div>
    </section>
  );
}
