import "server-only";

import { PCO_CAMPUSES } from "@/lib/pco/campuses";
import { PCO_SERVICES_VERSION } from "@/lib/pco/client";
import { fetchLatestCompletedPlan } from "@/lib/pco/fetch-plan";
import type {
  PcoItem,
  PcoPlanTime,
  PcoRelationship,
} from "@/lib/pco/types";

function durationSeconds(start: string | null, end: string | null) {
  if (!start || !end) return null;

  const duration = (Date.parse(end) - Date.parse(start)) / 1_000;
  return Number.isFinite(duration) ? duration : null;
}

function relationshipId(relationship?: PcoRelationship) {
  if (!relationship || !relationship.data || Array.isArray(relationship.data)) {
    return null;
  }

  return relationship.data.id;
}

function countBy<T extends string>(values: T[]) {
  return values.reduce<Record<string, number>>((counts, value) => {
    counts[value] = (counts[value] ?? 0) + 1;
    return counts;
  }, {});
}

function summarizePlanTime(planTime: PcoPlanTime) {
  const attributes = planTime.attributes;
  const plannedDurationSeconds = durationSeconds(
    attributes.starts_at,
    attributes.ends_at,
  );
  const actualDurationSeconds = durationSeconds(
    attributes.live_starts_at,
    attributes.live_ends_at,
  );
  const scheduledStartDeviationSeconds =
    attributes.starts_at && attributes.live_starts_at
      ? Math.abs(
          (Date.parse(attributes.live_starts_at) -
            Date.parse(attributes.starts_at)) /
            1_000,
        )
      : null;
  const selectionWarnings: string[] = [];

  if (attributes.name && /rehears|run.?through|dress/i.test(attributes.name)) {
    selectionWarnings.push("name_looks_like_run_through");
  }
  if (actualDurationSeconds === 0) {
    selectionWarnings.push("zero_second_live_window");
  }
  if (
    actualDurationSeconds !== null &&
    plannedDurationSeconds !== null &&
    actualDurationSeconds < plannedDurationSeconds * 0.5
  ) {
    selectionWarnings.push("live_window_under_half_of_plan");
  }
  if (
    scheduledStartDeviationSeconds !== null &&
    scheduledStartDeviationSeconds > 45 * 60
  ) {
    selectionWarnings.push("live_start_over_45_minutes_from_plan");
  }

  return {
    id: planTime.id,
    name: attributes.name,
    timeType: attributes.time_type,
    recorded: attributes.recorded,
    plannedStart: attributes.starts_at,
    plannedEnd: attributes.ends_at,
    plannedDurationSeconds,
    liveStart: attributes.live_starts_at,
    liveEnd: attributes.live_ends_at,
    actualDurationSeconds,
    scheduledStartDeviationSeconds,
    recordedServiceCandidate:
      attributes.time_type === "service" &&
      attributes.recorded &&
      actualDurationSeconds !== null,
    selectionWarnings,
  };
}

function bundleCandidates(items: PcoItem[]) {
  const ordered = [...items].sort(
    (left, right) => left.attributes.sequence - right.attributes.sequence,
  );

  return ordered.flatMap((item, index) => {
    const looksLikeTimedParent =
      item.attributes.item_type !== "song" &&
      item.attributes.length > 0 &&
      /bundle|worship/i.test(item.attributes.title);

    if (!looksLikeTimedParent) {
      return [];
    }

    const children: PcoItem[] = [];
    for (let childIndex = index + 1; childIndex < ordered.length; childIndex += 1) {
      const child = ordered[childIndex];
      if (child.attributes.item_type === "header") break;
      children.push(child);
    }

    const positiveChildren = children.filter(
      (child) =>
        child.attributes.item_type === "song" && child.attributes.length > 0,
    );
    if (positiveChildren.length === 0) return [];

    return [
      {
        parentItemId: item.id,
        parentItemTitle: item.attributes.title,
        parentLengthSeconds: item.attributes.length,
        childCount: positiveChildren.length,
        childLengthSeconds: positiveChildren.reduce(
          (total, child) => total + child.attributes.length,
          0,
        ),
        note: "Review whether the timed parent and timed songs overlap.",
      },
    ];
  });
}

async function probeCampus(campus: (typeof PCO_CAMPUSES)[number]) {
  const { plan, planTimes, items, itemTimes } =
    await fetchLatestCompletedPlan(campus.serviceTypeId);
  const itemById = new Map(items.map((item) => [item.id, item]));
  const planTimeById = new Map(planTimes.map((planTime) => [planTime.id, planTime]));

  const timingIssues = itemTimes.flatMap((itemTime) => {
    const itemId = relationshipId(itemTime.relationships.item);
    const planTimeId = relationshipId(itemTime.relationships.plan_time);
    const item = itemId ? itemById.get(itemId) : undefined;
    const planTime = planTimeId ? planTimeById.get(planTimeId) : undefined;
    const actualDurationSeconds = durationSeconds(
      itemTime.attributes.live_start_at,
      itemTime.attributes.live_end_at,
    );
    const allottedSeconds = itemTime.attributes.length;

    if (!item || !planTime || actualDurationSeconds === null) return [];

    const base = {
      itemId: item.id,
      itemTitle: item.attributes.title,
      planTimeId: planTime.id,
      planTimeName: planTime.attributes.name,
      allottedSeconds,
      actualDurationSeconds,
    };

    if (allottedSeconds === 0 && actualDurationSeconds > 3) {
      return [{ kind: "zero_allotment_over_3_seconds", ...base }];
    }

    if (
      actualDurationSeconds >= 600 &&
      actualDurationSeconds >= Math.max(1, allottedSeconds) * 4
    ) {
      return [{ kind: "possible_timer_bleed", ...base }];
    }

    return [];
  });

  const planTimeSummaries = planTimes.map(summarizePlanTime);
  const recordedServiceCandidates = planTimeSummaries.filter(
    (planTime) => planTime.recordedServiceCandidate,
  );
  const itemTimeCoverage = planTimes.map((planTime) => {
    const matching = itemTimes.filter(
      (itemTime) =>
        relationshipId(itemTime.relationships.plan_time) === planTime.id,
    );
    const actualDurations = matching
      .map((itemTime) =>
        durationSeconds(
          itemTime.attributes.live_start_at,
          itemTime.attributes.live_end_at,
        ),
      )
      .filter((duration): duration is number => duration !== null);

    return {
      planTimeId: planTime.id,
      planTimeName: planTime.attributes.name,
      planTimeType: planTime.attributes.time_type,
      itemTimeCount: matching.length,
      completedItemTimeCount: actualDurations.length,
      summedActualSeconds: actualDurations.reduce(
        (total, duration) => total + duration,
        0,
      ),
    };
  });
  const completeItemTimes = itemTimes.flatMap((itemTime) => {
    const timestampSeconds = durationSeconds(
      itemTime.attributes.live_start_at,
      itemTime.attributes.live_end_at,
    );
    if (timestampSeconds === null) return [];

    return [
      {
        timestampSeconds,
        lengthSeconds: itemTime.attributes.length,
        lengthOffsetSeconds: itemTime.attributes.length_offset,
      },
    ];
  });
  const itemTimeFieldAgreement = {
    completeCount: completeItemTimes.length,
    nonzeroLengthOffsetCount: completeItemTimes.filter(
      (itemTime) => itemTime.lengthOffsetSeconds !== 0,
    ).length,
    timestampEqualsLengthCount: completeItemTimes.filter(
      (itemTime) =>
        Math.abs(itemTime.timestampSeconds - itemTime.lengthSeconds) <= 1,
    ).length,
    timestampEqualsLengthPlusOffsetCount: completeItemTimes.filter(
      (itemTime) =>
        Math.abs(
          itemTime.timestampSeconds -
            (itemTime.lengthSeconds + itemTime.lengthOffsetSeconds),
        ) <= 1,
    ).length,
  };

  return {
    campus: {
      code: campus.code,
      name: campus.name,
      serviceTypeId: campus.serviceTypeId,
      serviceTypeName: campus.serviceTypeName,
    },
    plan: {
      id: plan.id,
      sortDate: plan.attributes.sort_date,
      title: plan.attributes.title,
      seriesTitle: plan.attributes.series_title,
      totalLengthSeconds: plan.attributes.total_length,
    },
    validation: {
      targetSource: "PlanTime starts_at to ends_at",
      actualSource: "PlanTime live_starts_at to live_ends_at",
      recordedServiceCandidateCount: recordedServiceCandidates.length,
      recordedServiceCandidates,
      slotSelectionConclusion:
        "PCO flags produce candidates only; campus slot mapping must identify production services.",
      nonServicePlanTimes: planTimeSummaries.filter(
        (planTime) => planTime.timeType !== "service",
      ),
      itemCount: items.length,
      itemTimeCount: itemTimes.length,
      itemTypes: countBy(items.map((item) => item.attributes.item_type)),
      servicePositions: countBy(
        items.map((item) => item.attributes.service_position ?? "null"),
      ),
      headers: items
        .filter((item) => item.attributes.item_type === "header")
        .sort(
          (left, right) =>
            left.attributes.sequence - right.attributes.sequence,
        )
        .map((item) => ({
          id: item.id,
          sequence: item.attributes.sequence,
          title: item.attributes.title,
          allottedSeconds: item.attributes.length,
        })),
      timedItems: items
        .filter((item) => item.attributes.length > 0)
        .sort(
          (left, right) =>
            left.attributes.sequence - right.attributes.sequence,
        )
        .map((item) => ({
          id: item.id,
          sequence: item.attributes.sequence,
          title: item.attributes.title,
          itemType: item.attributes.item_type,
          servicePosition: item.attributes.service_position,
          allottedSeconds: item.attributes.length,
        })),
      itemTimeCoverage,
      itemTimeFieldAgreement,
      bundleCandidates: bundleCandidates(items),
      timingIssues,
    },
  };
}

export async function runPcoDataShapeProbe() {
  const results = await Promise.allSettled(PCO_CAMPUSES.map(probeCampus));

  const campuses = results.map((result, index) => {
    if (result.status === "fulfilled") return result.value;

    return {
      campus: PCO_CAMPUSES[index],
      error:
        result.reason instanceof Error
          ? result.reason.message
          : "Unknown Planning Center error",
    };
  });

  return {
    ok: results.every((result) => result.status === "fulfilled"),
    generatedAt: new Date().toISOString(),
    apiVersion: PCO_SERVICES_VERSION,
    readOnly: true,
    campusCount: PCO_CAMPUSES.length,
    campuses,
  };
}
