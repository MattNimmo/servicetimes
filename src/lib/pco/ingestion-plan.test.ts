import { describe, expect, it } from "vitest";

import { PCO_CAMPUSES } from "@/lib/pco/campuses";
import {
  buildIngestionPlan,
  sourceFingerprint,
} from "@/lib/pco/ingestion-plan";
import { PCO_TAXONOMY } from "@/lib/pco/taxonomy";
import type {
  PcoItem,
  PcoItemTime,
  PcoPlan,
  PcoPlanTime,
} from "@/lib/pco/types";

const campus = PCO_CAMPUSES.find(({ code }) => code === "LV")!;
const slpCampus = PCO_CAMPUSES.find(({ code }) => code === "SLP")!;
const elkCampus = PCO_CAMPUSES.find(({ code }) => code === "ELK")!;

const plan: PcoPlan = {
  type: "Plan",
  id: "plan-1",
  attributes: {
    title: "Weekend Service",
    series_title: "Test Series",
    sort_date: "2026-06-21T15:00:00Z",
    total_length: 4500,
    updated_at: "2026-06-22T12:00:00Z",
  },
};

function planTime(
  id: string,
  startsAt: string,
  options: Partial<PcoPlanTime["attributes"]> = {},
): PcoPlanTime {
  return {
    type: "PlanTime",
    id,
    attributes: {
      starts_at: startsAt,
      ends_at: new Date(Date.parse(startsAt) + 75 * 60 * 1_000).toISOString(),
      live_starts_at: startsAt,
      live_ends_at: new Date(Date.parse(startsAt) + 70 * 60 * 1_000).toISOString(),
      name: "Service",
      recorded: true,
      time_type: "service",
      ...options,
    },
  };
}

function pcoItem(
  id: string,
  sequence: number,
  title: string,
  itemType: PcoItem["attributes"]["item_type"],
  length: number,
): PcoItem {
  return {
    type: "Item",
    id,
    attributes: {
      title,
      item_type: itemType,
      length,
      sequence,
      service_position: "during",
    },
  };
}

function itemTime(
  id: string,
  pcoItemId: string,
  pcoPlanTimeId: string,
  length: number,
  liveStartAt: string | null,
  liveEndAt: string | null,
): PcoItemTime {
  return {
    type: "ItemTime",
    id,
    attributes: {
      exclude: false,
      length,
      length_offset: 0,
      live_start_at: liveStartAt,
      live_end_at: liveEndAt,
    },
    relationships: {
      item: { data: { type: "Item", id: pcoItemId } },
      plan_time: { data: { type: "PlanTime", id: pcoPlanTimeId } },
      plan: { data: { type: "Plan", id: plan.id } },
    },
  };
}

const productionTime = planTime("time-production", "2026-06-21T15:00:00Z");
const runThroughTime = planTime("time-run-through", "2026-06-21T13:00:00Z", {
  name: "Run Through",
  live_ends_at: "2026-06-21T13:20:00Z",
});
const items = [
  pcoItem("header-live", 1, "Live Time", "header", 0),
  pcoItem("message", 2, "Message", "item", 3600),
  pcoItem("header-local", 3, "Local Response", "header", 0),
  pcoItem("final-prayer", 4, "Final Prayer", "item", 600),
];
const completeItemTimes = [
  itemTime(
    "item-time-message",
    "message",
    productionTime.id,
    3600,
    "2026-06-21T15:00:00Z",
    "2026-06-21T16:00:00Z",
  ),
  itemTime(
    "item-time-prayer",
    "final-prayer",
    productionTime.id,
    600,
    "2026-06-21T16:00:00Z",
    "2026-06-21T16:10:00Z",
  ),
];

describe("sourceFingerprint", () => {
  it("is stable across object key order", () => {
    expect(sourceFingerprint({ b: 2, a: 1 })).toBe(
      sourceFingerprint({ a: 1, b: 2 }),
    );
  });
});

describe("buildIngestionPlan", () => {
  it("resolves the production slot and emits row-shaped normalized data", () => {
    const result = buildIngestionPlan(
      campus,
      {
        plan,
        planTimes: [runThroughTime, productionTime],
        items,
        itemTimes: completeItemTimes,
      },
      PCO_TAXONOMY,
    );

    expect(result.dryRun).toBe(true);
    expect(result.plan.serviceDate).toBe("2026-06-21");
    expect(result.summary).toMatchObject({
      productionSlotCount: 1,
      matchedSlotCount: 1,
      autoResolvedSlotCount: 1,
      unmappedItemCount: 0,
    });
    expect(
      result.planTimes.find(
        ({ pcoPlanTimeId }) => pcoPlanTimeId === productionTime.id,
      ),
    ).toMatchObject({
      detectedSlotLabel: "10am",
      slotResolutionState: "auto",
      actualServiceSeconds: 4200,
    });
    expect(
      result.items.find(({ pcoItemId }) => pcoItemId === "message"),
    ).toMatchObject({
      sectionKey: "live",
      elementKey: "live.message",
      resolutionSource: "alias",
    });
    expect(
      result.incidents.filter(({ kind }) => kind === "reconciliation_gap"),
    ).toHaveLength(0);
    expect(
      result.incidents.some(
        ({ kind, planTimeId }) =>
          kind === "slot_resolution" && planTimeId === runThroughTime.id,
      ),
    ).toBe(false);
    expect(result.itemTimes[0].sourceFingerprint).toMatch(/^[a-f0-9]{64}$/);
  });

  it("refuses to guess when multiple PlanTimes match one production slot", () => {
    const duplicate = planTime("time-duplicate", "2026-06-21T15:05:00Z");
    const result = buildIngestionPlan(
      campus,
      {
        plan,
        planTimes: [productionTime, duplicate],
        items: [],
        itemTimes: [],
      },
      PCO_TAXONOMY,
    );

    expect(result.summary.autoResolvedSlotCount).toBe(0);
    expect(result.planTimes.every(({ detectedSlotLabel }) => !detectedSlotLabel)).toBe(
      true,
    );
    expect(result.incidents).toContainEqual(
      expect.objectContaining({
        kind: "slot_resolution",
        slotLabel: "10am",
        detail: "2 PlanTimes matched the 10am production slot.",
      }),
    );
  });

  it("keeps a matched zero-window slot in review state", () => {
    const zeroWindow = planTime("time-zero", "2026-06-21T15:00:00Z", {
      live_ends_at: "2026-06-21T15:00:00Z",
    });
    const result = buildIngestionPlan(
      campus,
      { plan, planTimes: [zeroWindow], items: [], itemTimes: [] },
      PCO_TAXONOMY,
    );

    expect(result.summary).toMatchObject({
      matchedSlotCount: 1,
      autoResolvedSlotCount: 0,
    });
    expect(result.planTimes[0]).toMatchObject({
      detectedSlotLabel: "10am",
      slotResolutionState: "review",
    });
    expect(result.incidents).toContainEqual(
      expect.objectContaining({ kind: "zero_live_window" }),
    );
  });

  it("keeps non-production plan times out of production slot matching and review", () => {
    const rehearsalTime = planTime("time-rehearsal", "2026-06-21T15:00:00Z", {
      name: "Dress Rehearsal Service",
      time_type: "service",
    });
    const techTeamTime = planTime("time-tech-team", "2026-06-21T15:05:00Z", {
      name: "Tech Team",
      time_type: "service",
    });
    const result = buildIngestionPlan(
      campus,
      {
        plan,
        planTimes: [rehearsalTime, techTeamTime, productionTime],
        items: [],
        itemTimes: [],
      },
      PCO_TAXONOMY,
    );

    expect(
      result.planTimes.find(
        ({ pcoPlanTimeId }) => pcoPlanTimeId === productionTime.id,
      ),
    ).toMatchObject({
      detectedSlotLabel: "10am",
      slotResolutionState: "auto",
    });
    expect(
      result.planTimes.find(
        ({ pcoPlanTimeId }) => pcoPlanTimeId === rehearsalTime.id,
      ),
    ).toMatchObject({
      detectedSlotLabel: null,
      slotResolutionState: "review",
    });
    expect(
      result.planTimes.find(
        ({ pcoPlanTimeId }) => pcoPlanTimeId === techTeamTime.id,
      ),
    ).toMatchObject({
      detectedSlotLabel: null,
      slotResolutionState: "review",
    });
    expect(
      result.incidents.some(
        ({ kind, planTimeId }) =>
          kind === "slot_resolution" && planTimeId === rehearsalTime.id,
      ),
    ).toBe(false);
    expect(
      result.incidents.some(
        ({ kind, planTimeId }) =>
          kind === "slot_resolution" && planTimeId === techTeamTime.id,
      ),
    ).toBe(false);
    expect(
      result.incidents.some(
        ({ kind, detail }) =>
          kind === "slot_resolution" &&
          detail === "3 PlanTimes matched the 10am production slot.",
      ),
    ).toBe(false);
  });

  it("flags bad timer evidence and a reconciliation gap", () => {
    const anomalousItems = [
      pcoItem("header-live", 1, "Live", "header", 0),
      pcoItem("bad-timer", 2, "Message", "item", 0),
      pcoItem("open-timer", 3, "Bumper", "media", 30),
    ];
    const anomalousTimes = [
      itemTime(
        "bad-item-time",
        "bad-timer",
        productionTime.id,
        0,
        "2026-06-21T15:00:00Z",
        "2026-06-21T15:11:40Z",
      ),
      itemTime(
        "open-item-time",
        "open-timer",
        productionTime.id,
        30,
        "2026-06-21T15:11:40Z",
        null,
      ),
    ];
    const result = buildIngestionPlan(
      campus,
      {
        plan,
        planTimes: [productionTime],
        items: anomalousItems,
        itemTimes: anomalousTimes,
      },
      PCO_TAXONOMY,
    );

    expect(new Set(result.incidents.map(({ kind }) => kind))).toEqual(
      new Set([
        "missing_item_end",
        "reconciliation_gap",
        "timer_bleed",
        "zero_allotment",
      ]),
    );
  });

  it("marks approved worship-bundle child songs as rollup children instead of review incidents", () => {
    const result = buildIngestionPlan(
      campus,
      {
        plan,
        planTimes: [productionTime],
        items: [
          pcoItem("header-worship", 1, "Praise & Worship", "header", 0),
          pcoItem("worship-bundle", 2, "Worship Bundle", "item", 1200),
          pcoItem("song-1", 3, "Song One", "song", 300),
          pcoItem("song-2", 4, "Song Two", "song", 360),
        ],
        itemTimes: [],
      },
      PCO_TAXONOMY,
    );

    expect(
      result.incidents.some(({ kind }) => kind === "bundle_overlap"),
    ).toBe(false);
    expect(
      result.items.filter(({ isRollupChild }) => isRollupChild).map(({ pcoItemId }) => pcoItemId),
    ).toEqual(["song-1", "song-2"]);
  });

  it("keeps post-communion SLP worship songs out of the bundle rollup", () => {
    const result = buildIngestionPlan(
      slpCampus,
      {
        plan,
        planTimes: [planTime("slp-time", "2026-06-21T14:00:00Z")],
        items: [
          pcoItem("header-worship", 1, "Praise & Worship", "header", 0),
          pcoItem("worship-bundle", 2, "Worship Bundle", "item", 600),
          pcoItem("song-1", 3, "Song One", "song", 0),
          pcoItem("song-2", 4, "Song Two", "song", 0),
          pcoItem("communion", 5, "Communion", "item", 180),
          pcoItem("holy-forever", 6, "Holy Forever", "song", 360),
        ],
        itemTimes: [],
      },
      PCO_TAXONOMY,
    );

    expect(result.items.find(({ pcoItemId }) => pcoItemId === "song-1")).toMatchObject({
      isRollupChild: true,
    });
    expect(result.items.find(({ pcoItemId }) => pcoItemId === "song-2")).toMatchObject({
      isRollupChild: true,
    });
    expect(result.items.find(({ pcoItemId }) => pcoItemId === "holy-forever")).toMatchObject({
      sectionKey: "worship_open",
      elementKey: "worship.open",
      isRollupChild: false,
    });
  });

  it("continues rolling up post-communion worship songs for non-broadcast campuses", () => {
    const result = buildIngestionPlan(
      elkCampus,
      {
        plan,
        planTimes: [planTime("elk-time", "2026-06-21T14:00:00Z")],
        items: [
          pcoItem("header-worship", 1, "Praise & Worship", "header", 0),
          pcoItem("worship-bundle", 2, "Worship Bundle", "item", 600),
          pcoItem("communion", 3, "Communion", "item", 180),
          pcoItem("holy-forever", 4, "Holy Forever", "song", 360),
        ],
        itemTimes: [],
      },
      PCO_TAXONOMY,
    );

    expect(result.items.find(({ pcoItemId }) => pcoItemId === "holy-forever")).toMatchObject({
      isRollupChild: true,
    });
  });

  it("continues rolling up all worship-bundle songs when communion is absent", () => {
    const result = buildIngestionPlan(
      slpCampus,
      {
        plan,
        planTimes: [planTime("slp-time", "2026-06-21T14:00:00Z")],
        items: [
          pcoItem("header-worship", 1, "Praise & Worship", "header", 0),
          pcoItem("worship-bundle", 2, "Worship Bundle", "item", 600),
          pcoItem("song-1", 3, "Song One", "song", 300),
          pcoItem("song-2", 4, "Song Two", "song", 360),
        ],
        itemTimes: [],
      },
      PCO_TAXONOMY,
    );

    expect(
      result.items.filter(({ isRollupChild }) => isRollupChild).map(({ pcoItemId }) => pcoItemId),
    ).toEqual(["song-1", "song-2"]);
  });

  it("does not flag bundle overlap for timed items that merely mention worship", () => {
    const result = buildIngestionPlan(
      campus,
      {
        plan,
        planTimes: [productionTime],
        items: [
          pcoItem("header-mid", 1, "Mid-Service", "header", 0),
          pcoItem("host-pastor", 2, "Host Pastor//Close Worship", "item", 60),
          pcoItem("close-worship-song", 3, "Close Worship Song", "song", 240),
        ],
        itemTimes: [],
      },
      PCO_TAXONOMY,
    );

    expect(result.incidents.some(({ kind }) => kind === "bundle_overlap")).toBe(false);
  });

  it("still flags bundle overlap for timed bundles that do not resolve to worship.open", () => {
    const result = buildIngestionPlan(
      campus,
      {
        plan,
        planTimes: [productionTime],
        items: [
          pcoItem("band-bundle", 1, "Band Bundle", "item", 600),
          pcoItem("timed-song", 2, "Song One", "song", 300),
        ],
        itemTimes: [],
      },
      PCO_TAXONOMY,
    );

    expect(result.incidents.some(({ kind }) => kind === "bundle_overlap")).toBe(true);
  });

  it("classifies unmapped taxonomy rows without silently assigning them", () => {
    const result = buildIngestionPlan(
      campus,
      {
        plan,
        planTimes: [productionTime],
        items: [
          pcoItem("header-worship", 1, "Praise & Worship", "header", 0),
          pcoItem("song", 2, "Worthy", "song", 300),
          pcoItem("close-worship", 3, "Close Worship", "item", 60),
          pcoItem("header-local", 4, "Local", "header", 0),
          pcoItem(
            "combined",
            5,
            "Salvation Response//Connect Card",
            "item",
            120,
          ),
          pcoItem("unknown", 6, "Campus Prayer", "item", 60),
          pcoItem("unknown-header", 7, "Campus Custom", "header", 0),
          pcoItem("orphan", 8, "Pastor Moment", "item", 60),
        ],
        itemTimes: [],
      },
      PCO_TAXONOMY,
    );

    expect(result.taxonomyReview).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          pcoItemId: "song",
          reason: "rollup_review",
        }),
        expect.objectContaining({
          pcoItemId: "close-worship",
          reason: "section_mismatch",
          suggestedSectionKey: "mid_service",
          suggestedElementKey: "mid.close_worship",
        }),
        expect.objectContaining({
          pcoItemId: "unknown",
          reason: "missing_alias",
        }),
        expect.objectContaining({
          pcoItemId: "orphan",
          reason: "missing_section",
        }),
      ]),
    );
    expect(
      result.items.find(({ pcoItemId }) => pcoItemId === "combined"),
    ).toMatchObject({
      sectionKey: "local",
      elementKey: "local.salvation",
      resolutionSource: "alias",
    });
    expect(result.summary.taxonomyReviewByReason).toMatchObject({
      missing_alias: 1,
      missing_section: 1,
      rollup_review: 1,
      section_mismatch: 1,
    });
  });

  it("maps Closing Prayer to the approved Final Prayer element", () => {
    const result = buildIngestionPlan(
      campus,
      {
        plan,
        planTimes: [productionTime],
        items: [
          pcoItem("header-local", 1, "Local", "header", 0),
          pcoItem("closing-prayer", 2, "Closing Prayer", "item", 60),
        ],
        itemTimes: [],
      },
      PCO_TAXONOMY,
    );

    expect(result.items[1]).toMatchObject({
      sectionKey: "local",
      elementKey: "local.final_prayer",
      resolutionSource: "alias",
    });
  });

  it("maps salvation response connect-card variants into local salvation", () => {
    const elk = PCO_CAMPUSES.find(({ code }) => code === "ELK")!;
    const result = buildIngestionPlan(
      elk,
      {
        plan,
        planTimes: [planTime("elk-time", "2026-06-21T14:00:00Z")],
        items: [
          pcoItem("header-live", 1, "Live", "header", 0),
          pcoItem(
            "salvation-connect-card",
            2,
            "Salvation Response//Connect Card",
            "item",
            120,
          ),
        ],
        itemTimes: [],
      },
      PCO_TAXONOMY,
    );

    expect(result.items[1]).toMatchObject({
      sectionKey: "local",
      elementKey: "local.salvation",
      resolutionSource: "alias",
    });
    expect(
      result.taxonomyReview.some(
        ({ pcoItemId }) => pcoItemId === "salvation-connect-card",
      ),
    ).toBe(false);
  });

  it("maps KB Moment into mid-service hosted moment", () => {
    const result = buildIngestionPlan(
      campus,
      {
        plan,
        planTimes: [productionTime],
        items: [
          pcoItem("header-mid", 1, "Mid-Service", "header", 0),
          pcoItem("kb-moment", 2, "KB Moment", "item", 90),
        ],
        itemTimes: [],
      },
      PCO_TAXONOMY,
    );

    expect(result.items[1]).toMatchObject({
      sectionKey: "mid_service",
      elementKey: "mid.hosted_moment",
      resolutionSource: "alias",
    });
  });
});
