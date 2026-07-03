import type { TaxonomyConfig } from "@/lib/pco/normalize";

export const PCO_TAXONOMY = {
  sectionAliases: [
    ["pre service", "exact", 10, "pre_service"],
    ["^praise (&|and) worship$", "regex", 20, "worship_open"],
    ["^mid[- ]?service$", "regex", 30, "mid_service"],
    ["^live( stream| time| message.*)?$", "regex", 40, "live"],
    [
      "^(local|local response|location disconnect|live response)$",
      "regex",
      50,
      "local",
    ],
    ["online disconnect", "exact", 60, "post_service"],
  ].map(([rawTitleNormalized, matchType, priority, sectionKey]) => ({
    campusCode: null,
    rawTitleNormalized: rawTitleNormalized as string,
    matchType: matchType as "exact" | "regex",
    priority: priority as number,
    sectionKey: sectionKey as string,
  })),
  elementAliases: [
    ...[
      ["pre_service", "countdown video", "pre.countdown"],
      ["worship_open", "worship bundle", "worship.open"],
      ["worship_open", "musical worship bundle", "worship.open"],
      ["worship_open", "communion", "worship.communion"],
      ["mid_service", "close worship", "mid.close_worship"],
      ["mid_service", "greet and seat", "mid.greet"],
      ["mid_service", "meet & greet", "mid.greet"],
      ["mid_service", "greeting groove", "mid.greet"],
      ["mid_service", "announcements", "mid.announcements.general"],
      ["mid_service", "offering", "mid.offering.general"],
      ["mid_service", "miracle offering", "mid.offering.campaign"],
      ["mid_service", "hosted moment", "mid.hosted_moment"],
      ["mid_service", "kb moment", "mid.hosted_moment"],
      ["mid_service", "host pastor//new guest", "mid.hosted_moment"],
      ["mid_service", "host pastor/new guest", "mid.hosted_moment"],
      ["live", "bumper", "live.bumper"],
      ["live", "bumper video", "live.bumper"],
      ["live", "message", "live.message"],
      // LV plans one combined block for the broadcast message + bumper.
      ["live", "message/bumper", "live.message"],
      ["local", "worship response", "local.worship_response"],
      ["local", "worship response song", "local.worship_response"],
      ["local", "response song", "local.worship_response"],
      ["local", "salvation response", "local.salvation"],
      ["local", "salvation response cc", "local.salvation"],
      ["local", "salvation response connect card", "local.salvation"],
      ["local", "salvation response / connect card", "local.salvation"],
      ["local", "salvation response//connect card", "local.salvation"],
      ["local", "final prayer", "local.final_prayer"],
      ["local", "closing prayer", "local.final_prayer"],
    ].map(([sectionKey, rawTitleNormalized, elementKey]) => ({
      campusCode: null,
      sectionKey,
      rawTitleNormalized,
      matchType: "exact" as const,
      priority: 10,
      elementKey,
    })),
    // Regex aliases for recurring historical title families. Titles are
    // normalized before matching (lowercased, " - " collapsed to "-").
    ...[
      // "Host Pastor//Close Worship", "Close Worship/Welcome NG", …
      ["mid_service", "close worship", "mid.close_worship"],
      // "KB 5 Spot", "5 Spot - Hetlands"
      ["mid_service", "^(kb )?5 spot", "mid.5spot"],
      // "Child Dedication", "Child Dedications"
      ["mid_service", "^child dedication", "mid.hosted_moment"],
      // "Worship Response - Trust In God", "Response - Watch And See"
      ["local", "^(worship )?response-", "local.worship_response"],
      // "Salvation Response/Next steps", "… & Next Steps", "… + Communion"
      ["local", "^salvation response", "local.salvation"],
      // "Final Prayer/Dismissal", "Final Prayer Over Women"
      ["local", "^final prayer", "local.final_prayer"],
    ].map(([sectionKey, rawTitleNormalized, elementKey]) => ({
      campusCode: null,
      sectionKey,
      rawTitleNormalized,
      matchType: "regex" as const,
      priority: 20,
      elementKey,
    })),
  ],
  combinedTitleRules: [
    "salvation response cc",
    "salvation response connect card",
    "salvation response / connect card",
    "salvation response//connect card",
  ].map((rawTitleNormalized) => ({
    campusCode: null,
    rawTitleNormalized,
    suggestedSectionKey: "local",
  })),
} satisfies TaxonomyConfig;
