import { createHash } from "node:crypto";

import {
  normalizePlanItems,
  normalizePcoTitle,
  resolveElement,
  type TaxonomyConfig,
} from "@/lib/pco/normalize";
import { isNonProductionName } from "@/lib/pco/non-production";
import type { PCO_CAMPUSES } from "@/lib/pco/campuses";
import type {
  PcoItem,
  PcoItemTime,
  PcoPlan,
  PcoPlanTime,
  PcoRelationship,
} from "@/lib/pco/types";

export type PcoCampus = (typeof PCO_CAMPUSES)[number];

export type IngestionIncidentKind =
  | "slot_resolution"
  | "missing_live_bounds"
  | "zero_live_window"
  | "zero_allotment"
  | "timer_bleed"
  | "missing_item_end"
  | "bundle_overlap"
  | "reconciliation_gap";

export type IngestionIncident = {
  kind: IngestionIncidentKind;
  planTimeId: string | null;
  slotLabel: string | null;
  itemIds: string[];
  sourceFingerprint: string;
  detail: string;
  evidence: unknown;
};

export type TaxonomyReviewReason =
  | "rollup_review"
  | "combined_title"
  | "section_mismatch"
  | "missing_section"
  | "missing_alias";

export type PlanBundle = {
  plan: PcoPlan;
  planTimes: PcoPlanTime[];
  items: PcoItem[];
  itemTimes: PcoItemTime[];
};

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }

  if (value && typeof value === "object") {
    const object = value as Record<string, unknown>;
    return `{${Object.keys(object)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(object[key])}`)
      .join(",")}}`;
  }

  return JSON.stringify(value);
}

export function sourceFingerprint(value: unknown) {
  return createHash("sha256").update(canonicalJson(value)).digest("hex");
}

function durationSeconds(start: string | null, end: string | null) {
  if (!start || !end) return null;

  const seconds = (Date.parse(end) - Date.parse(start)) / 1_000;
  return Number.isFinite(seconds) ? seconds : null;
}

function relationshipId(relationship?: PcoRelationship) {
  if (!relationship?.data || Array.isArray(relationship.data)) return null;
  return relationship.data.id;
}

function localParts(timestamp: string, timezone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(timestamp));
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((candidate) => candidate.type === type)?.value ?? "";

  return {
    date: `${part("year")}-${part("month")}-${part("day")}`,
    minutes: Number(part("hour")) * 60 + Number(part("minute")),
  };
}

function slotMinutes(localStart: string) {
  const [hours, minutes] = localStart.split(":").map(Number);
  return hours * 60 + minutes;
}

function minuteDistance(left: number, right: number) {
  const distance = Math.abs(left - right);
  return Math.min(distance, 24 * 60 - distance);
}

function incident(
  kind: IngestionIncidentKind,
  detail: string,
  options: {
    planTimeId?: string | null;
    slotLabel?: string | null;
    itemIds?: string[];
    evidence: unknown;
  },
): IngestionIncident {
  return {
    kind,
    planTimeId: options.planTimeId ?? null,
    slotLabel: options.slotLabel ?? null,
    itemIds: options.itemIds ?? [],
    sourceFingerprint: sourceFingerprint(options.evidence),
    detail,
    evidence: options.evidence,
  };
}

function isNonProductionPlanTime(planTime: Pick<PcoPlanTime, "attributes">) {
  return (
    planTime.attributes.time_type === "rehearsal" ||
    isNonProductionName(planTime.attributes.name)
  );
}

function assignSlots(campus: PcoCampus, planTimes: PcoPlanTime[]) {
  const assignments = new Map<string, string>();
  const incidents: IngestionIncident[] = [];
  const productionCandidates = planTimes.filter(
    (planTime) => !isNonProductionPlanTime(planTime),
  );

  for (const slot of campus.slots) {
    const expectedMinutes = slotMinutes(slot.localStart);
    const candidates = productionCandidates.filter(({ attributes }) => {
      if (!attributes.starts_at) return false;
      const { minutes } = localParts(attributes.starts_at, campus.timezone);
      return minuteDistance(minutes, expectedMinutes) <= slot.toleranceMinutes;
    });

    if (candidates.length === 1) {
      assignments.set(candidates[0].id, slot.label);
      continue;
    }

    incidents.push(
      incident(
        "slot_resolution",
        candidates.length === 0
          ? `No PlanTime matched the ${slot.label} production slot.`
          : `${candidates.length} PlanTimes matched the ${slot.label} production slot.`,
        {
          slotLabel: slot.label,
          itemIds: [],
          evidence: {
            slot,
            candidatePlanTimeIds: candidates.map(({ id }) => id).sort(),
          },
        },
      ),
    );
  }

  for (const planTime of planTimes) {
    if (assignments.has(planTime.id)) continue;
    if (isNonProductionPlanTime(planTime)) continue;
    const actualSeconds = durationSeconds(
      planTime.attributes.live_starts_at,
      planTime.attributes.live_ends_at,
    );
    if (
      planTime.attributes.time_type !== "service" &&
      !planTime.attributes.recorded &&
      actualSeconds === null
    ) {
      continue;
    }

    incidents.push(
      incident(
        "slot_resolution",
        "PlanTime did not resolve to a configured production slot.",
        {
          planTimeId: planTime.id,
          evidence: planTime,
        },
      ),
    );
  }

  return { assignments, incidents };
}

function analyzeTimedBundles(
  items: PcoItem[],
  normalizedById: Map<string, { elementKey: string | null }>,
  assignments: Map<string, string>,
  campus: PcoCampus,
) {
  const ordered = [...items].sort(
    (left, right) => left.attributes.sequence - right.attributes.sequence,
  );
  const rollupChildIds = new Set<string>();
  const detachedWorshipSongIds = new Set<string>();
  const incidents: IngestionIncident[] = [];

  for (const [index, parent] of ordered.entries()) {
    if (
      parent.attributes.item_type === "song" ||
      parent.attributes.length <= 0 ||
      !/bundle|worship/i.test(parent.attributes.title)
    ) {
      continue;
    }

    const isWorshipBundle = normalizedById.get(parent.id)?.elementKey === "worship.open";
    const children: PcoItem[] = [];
    let sawCommunion = false;
    for (let childIndex = index + 1; childIndex < ordered.length; childIndex += 1) {
      const child = ordered[childIndex];
      if (child.attributes.item_type === "header") break;
      const childElementKey = normalizedById.get(child.id)?.elementKey;
      if (
        childElementKey === "worship.communion" ||
        /communion/i.test(child.attributes.title)
      ) {
        sawCommunion = true;
        continue;
      }
      // A child that resolved to a non-worship element (offering, greet,
      // announcements, …) means the service moved past the worship set.
      // Without this boundary, header-less plans (LV) would sweep every
      // later song — including response songs — into the bundle rollup.
      if (childElementKey && !childElementKey.startsWith("worship.")) {
        break;
      }
      if (child.attributes.item_type === "song") {
        if (campus.isBroadcastOrigin && sawCommunion) {
          detachedWorshipSongIds.add(child.id);
          continue;
        }
        if (isWorshipBundle || child.attributes.length > 0) {
          children.push(child);
        }
      }
    }
    if (children.length === 0) continue;

    if (isWorshipBundle) {
      for (const child of children) {
        rollupChildIds.add(child.id);
      }
      continue;
    }

    // Only actual bundles can double-count plan time. Titles that merely
    // mention worship ("Host Pastor//Close Worship") are regular timed items
    // followed by unrelated songs — flagging them is pure noise.
    if (!/bundle/i.test(parent.attributes.title)) {
      continue;
    }

    incidents.push(
      ...[...assignments].map(([planTimeId, slotLabel]) =>
        incident(
          "bundle_overlap",
          "Timed parent and following songs may represent overlapping planned time.",
          {
            planTimeId,
            slotLabel,
            itemIds: [parent.id, ...children.map(({ id }) => id)],
            evidence: {
              planTimeId,
              parent: { id: parent.id, length: parent.attributes.length },
              children: children.map(({ id, attributes }) => ({
                id,
                length: attributes.length,
              })),
            },
          },
        ),
      ),
    );
  }

  return { rollupChildIds, detachedWorshipSongIds, incidents };
}

function buildTaxonomyReview(
  items: Array<{
    pcoItemId: string;
    rawTitle: string;
    itemType: PcoItem["attributes"]["item_type"];
    plannedSeconds: number;
    sectionKey: string | null;
    elementKey: string | null;
  }>,
  campusCode: string,
  taxonomy: TaxonomyConfig,
  ignoredItemIds: ReadonlySet<string> = new Set(),
) {
  const sectionKeys = [
    ...new Set(taxonomy.elementAliases.map(({ sectionKey }) => sectionKey)),
  ];

  return items.flatMap((item) => {
    if (ignoredItemIds.has(item.pcoItemId)) {
      return [];
    }

    if (
      item.itemType === "header" ||
      item.elementKey !== null ||
      item.rawTitle.length === 0 ||
      item.plannedSeconds <= 0
    ) {
      return [];
    }

    let reason: TaxonomyReviewReason;
    let suggestedSectionKey: string | null = null;
    let suggestedElementKey: string | null = null;
    const combinedTitleRule = taxonomy.combinedTitleRules?.find(
      (rule) =>
        (rule.campusCode === null || rule.campusCode === campusCode) &&
        rule.rawTitleNormalized === normalizePcoTitle(item.rawTitle),
    );

    if (item.itemType === "song") {
      reason = "rollup_review";
    } else if (combinedTitleRule || /\/{1,2}/.test(item.rawTitle)) {
      reason = "combined_title";
      suggestedSectionKey = combinedTitleRule?.suggestedSectionKey ?? null;
    } else if (item.sectionKey === null) {
      reason = "missing_section";
    } else {
      for (const sectionKey of sectionKeys) {
        if (sectionKey === item.sectionKey) continue;
        const elementKey = resolveElement(
          item.rawTitle,
          campusCode,
          sectionKey,
          taxonomy.elementAliases,
        );
        if (!elementKey) continue;
        suggestedSectionKey = sectionKey;
        suggestedElementKey = elementKey;
        break;
      }

      reason = suggestedElementKey ? "section_mismatch" : "missing_alias";
    }

    return [
      {
        pcoItemId: item.pcoItemId,
        rawTitle: item.rawTitle,
        itemType: item.itemType,
        plannedSeconds: item.plannedSeconds,
        currentSectionKey: item.sectionKey,
        reason,
        suggestedSectionKey,
        suggestedElementKey,
      },
    ];
  });
}

function applyCombinedTitleOverrides(
  items: ReturnType<typeof normalizePlanItems>,
  campusCode: string,
  taxonomy: TaxonomyConfig,
) {
  return items.map((item) => {
    if (item.itemType === "header" || item.elementKey !== null) {
      return item;
    }

    const combinedTitleRule = taxonomy.combinedTitleRules?.find(
      (rule) =>
        (rule.campusCode === null || rule.campusCode === campusCode) &&
        rule.rawTitleNormalized === item.rawTitleNormalized,
    );
    if (!combinedTitleRule?.suggestedSectionKey) {
      return item;
    }

    const suggestedElementKey = resolveElement(
      item.title,
      campusCode,
      combinedTitleRule.suggestedSectionKey,
      taxonomy.elementAliases,
    );
    if (!suggestedElementKey) {
      return item;
    }

    return {
      ...item,
      sectionKey: combinedTitleRule.suggestedSectionKey,
      elementKey: suggestedElementKey,
      resolutionSource: "alias" as const,
    };
  });
}

export function buildIngestionPlan(
  campus: PcoCampus,
  bundle: PlanBundle,
  taxonomy: TaxonomyConfig,
) {
  const { assignments, incidents: slotIncidents } = assignSlots(
    campus,
    bundle.planTimes,
  );
  const incidents: IngestionIncident[] = [...slotIncidents];
  const normalizedItems = applyCombinedTitleOverrides(
    normalizePlanItems(
      bundle.items.map(({ id, attributes }) => ({
        id,
        sequence: attributes.sequence,
        title: attributes.title,
        itemType: attributes.item_type,
        servicePosition: attributes.service_position,
      })),
      campus.code,
      taxonomy,
    ),
    campus.code,
    taxonomy,
  );
  const normalizedById = new Map(normalizedItems.map((item) => [item.id, item]));
  const {
    rollupChildIds,
    detachedWorshipSongIds,
    incidents: bundleIncidents,
  } = analyzeTimedBundles(
    bundle.items,
    normalizedById,
    assignments,
    campus,
  );
  incidents.push(...bundleIncidents);

  const planTimes = bundle.planTimes.map(({ id, attributes }) => {
    const actualSeconds = durationSeconds(
      attributes.live_starts_at,
      attributes.live_ends_at,
    );
    const detectedSlotLabel = assignments.get(id) ?? null;
    const needsLiveReview =
      detectedSlotLabel !== null &&
      (!attributes.live_starts_at ||
        !attributes.live_ends_at ||
        (actualSeconds !== null && actualSeconds <= 0));

    if (detectedSlotLabel && (!attributes.live_starts_at || !attributes.live_ends_at)) {
      incidents.push(
        incident("missing_live_bounds", "Mapped production slot has incomplete LIVE bounds.", {
          planTimeId: id,
          slotLabel: detectedSlotLabel,
          evidence: { id, attributes },
        }),
      );
    } else if (detectedSlotLabel && actualSeconds !== null && actualSeconds <= 0) {
      incidents.push(
        incident("zero_live_window", "Mapped production slot has a zero-length LIVE window.", {
          planTimeId: id,
          slotLabel: detectedSlotLabel,
          evidence: { id, attributes },
        }),
      );
    }

    return {
      pcoPlanTimeId: id,
      pcoPlanId: bundle.plan.id,
      detectedSlotLabel,
      slotResolutionState:
        detectedSlotLabel && !needsLiveReview
          ? ("auto" as const)
          : ("review" as const),
      pcoName: attributes.name,
      timeType: attributes.time_type,
      startsAt: attributes.starts_at,
      endsAt: attributes.ends_at,
      liveStartsAt: attributes.live_starts_at,
      liveEndsAt: attributes.live_ends_at,
      recorded: attributes.recorded,
      plannedTargetSeconds: durationSeconds(attributes.starts_at, attributes.ends_at),
      actualServiceSeconds: actualSeconds,
    };
  });

  const items = bundle.items
    .map(({ id, attributes }) => {
      const normalized = normalizedById.get(id);
      if (!normalized) throw new Error(`Normalized item ${id} was not found`);

      const isDetachedWorshipSong = detachedWorshipSongIds.has(id);

      return {
        pcoItemId: id,
        pcoPlanId: bundle.plan.id,
        sequence: attributes.sequence,
        rawTitle: attributes.title,
        rawTitleNormalized: normalized.rawTitleNormalized,
        itemType: attributes.item_type,
        servicePosition: attributes.service_position,
        sectionKey: isDetachedWorshipSong ? "worship_open" : normalized.sectionKey,
        elementKey: isDetachedWorshipSong ? "worship.open" : normalized.elementKey,
        plannedSeconds: attributes.length,
        isRollupChild: !isDetachedWorshipSong && rollupChildIds.has(id),
        resolutionSource: isDetachedWorshipSong
          ? ("alias" as const)
          : normalized.resolutionSource,
      };
    })
    .sort((left, right) => left.sequence - right.sequence);

  const allItemTimes = bundle.itemTimes.flatMap(({ id, attributes, relationships }) => {
    const pcoItemId = relationshipId(relationships.item);
    const pcoPlanTimeId = relationshipId(relationships.plan_time);
    if (!pcoItemId || !pcoPlanTimeId) return [];

    const actualSeconds = durationSeconds(
      attributes.live_start_at,
      attributes.live_end_at,
    );
    const evidence = {
      id,
      pcoItemId,
      pcoPlanTimeId,
      attributes,
    };

    if (attributes.live_start_at && !attributes.live_end_at) {
      incidents.push(
        incident("missing_item_end", "Item timer started without a LIVE end.", {
          planTimeId: pcoPlanTimeId,
          itemIds: [pcoItemId],
          evidence,
        }),
      );
    }
    if (actualSeconds !== null && attributes.length === 0 && actualSeconds > 3) {
      incidents.push(
        incident("zero_allotment", "Item ran over three seconds with a zero allotment.", {
          planTimeId: pcoPlanTimeId,
          itemIds: [pcoItemId],
          evidence,
        }),
      );
    }
    if (
      actualSeconds !== null &&
      actualSeconds >= 600 &&
      actualSeconds >= Math.max(1, attributes.length) * 4
    ) {
      incidents.push(
        incident("timer_bleed", "Item duration is a possible timer bleed.", {
          planTimeId: pcoPlanTimeId,
          itemIds: [pcoItemId],
          evidence,
        }),
      );
    }

    return [
      {
        pcoItemTimeId: id,
        pcoItemId,
        pcoPlanTimeId,
        pcoLengthSeconds: attributes.length,
        lengthOffsetSeconds: attributes.length_offset,
        liveStartAt: attributes.live_start_at,
        liveEndAt: attributes.live_end_at,
        pcoExclude: attributes.exclude,
        actualSeconds,
        sourceFingerprint: sourceFingerprint(evidence),
      },
    ];
  });

  // PCO occasionally carries two ItemTime rows for the same item + plan_time
  // (e.g. a restarted timer). The DB enforces one per pair — keep the most
  // complete: a finished timer beats an open one, a later end beats an
  // earlier one, and the higher PCO id is the stable tiebreak.
  const bestItemTimeByPair = new Map<string, (typeof allItemTimes)[number]>();
  for (const candidate of allItemTimes) {
    const key = `${candidate.pcoItemId}:${candidate.pcoPlanTimeId}`;
    const current = bestItemTimeByPair.get(key);
    if (!current) {
      bestItemTimeByPair.set(key, candidate);
      continue;
    }
    const candidateWins =
      (candidate.actualSeconds !== null) !== (current.actualSeconds !== null)
        ? candidate.actualSeconds !== null
        : (candidate.liveEndAt ?? "") !== (current.liveEndAt ?? "")
          ? (candidate.liveEndAt ?? "") > (current.liveEndAt ?? "")
          : candidate.pcoItemTimeId > current.pcoItemTimeId;
    if (candidateWins) bestItemTimeByPair.set(key, candidate);
  }
  const itemTimes = [...bestItemTimeByPair.values()];

  for (const planTime of planTimes.filter(({ detectedSlotLabel }) => detectedSlotLabel)) {
    if (planTime.actualServiceSeconds === null) continue;
    const matching = itemTimes.filter(
      ({ pcoPlanTimeId }) => pcoPlanTimeId === planTime.pcoPlanTimeId,
    );
    const completed = matching.filter(({ actualSeconds }) => actualSeconds !== null);
    const summedActualSeconds = completed.reduce(
      (total, { actualSeconds }) => total + (actualSeconds ?? 0),
      0,
    );
    const gapSeconds = planTime.actualServiceSeconds - summedActualSeconds;

    if (Math.abs(gapSeconds) > 1) {
      incidents.push(
        incident("reconciliation_gap", "Item timers do not reconcile to the PlanTime LIVE window.", {
          planTimeId: planTime.pcoPlanTimeId,
          slotLabel: planTime.detectedSlotLabel,
          itemIds: matching.map(({ pcoItemId }) => pcoItemId),
          evidence: {
            actualServiceSeconds: planTime.actualServiceSeconds,
            itemTimeCount: matching.length,
            completedItemTimeCount: completed.length,
            summedActualSeconds,
            gapSeconds,
          },
        }),
      );
    }
  }

  const taxonomyReview = buildTaxonomyReview(
    items,
    campus.code,
    taxonomy,
    rollupChildIds,
  );
  const taxonomyReviewByReason = Object.fromEntries(
    [...new Set(taxonomyReview.map(({ reason }) => reason))]
      .sort()
      .map((reason) => [
        reason,
        taxonomyReview.filter((candidate) => candidate.reason === reason).length,
      ]),
  );

  return {
    campus: campus.code,
    dryRun: true,
    plan: {
      pcoPlanId: bundle.plan.id,
      campusCode: campus.code,
      serviceDate: localParts(bundle.plan.attributes.sort_date, campus.timezone).date,
      sortDate: bundle.plan.attributes.sort_date,
      seriesTitle: bundle.plan.attributes.series_title,
      title: bundle.plan.attributes.title,
      pcoTotalLengthSeconds: bundle.plan.attributes.total_length,
      sourceUpdatedAt: bundle.plan.attributes.updated_at ?? null,
    },
    planTimes,
    items,
    itemTimes,
    incidents: incidents.sort((left, right) =>
      `${left.kind}:${left.planTimeId}:${left.slotLabel}`.localeCompare(
        `${right.kind}:${right.planTimeId}:${right.slotLabel}`,
      ),
    ),
    taxonomyReview,
    summary: {
      productionSlotCount: campus.slots.length,
      matchedSlotCount: assignments.size,
      autoResolvedSlotCount: planTimes.filter(
        ({ slotResolutionState }) => slotResolutionState === "auto",
      ).length,
      planTimeCount: planTimes.length,
      itemCount: items.length,
      itemTimeCount: itemTimes.length,
      unmappedItemCount: items.filter(
        ({ itemType, elementKey, plannedSeconds }) =>
          itemType !== "header" && elementKey === null && plannedSeconds > 0,
      ).length,
      taxonomyReviewByReason,
      incidentCount: incidents.length,
    },
  };
}

export type IngestionPlan = ReturnType<typeof buildIngestionPlan>;
