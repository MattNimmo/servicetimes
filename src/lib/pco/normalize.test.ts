import { describe, expect, it } from "vitest";

import {
  normalizePcoTitle,
  normalizePlanItems,
  resolveElement,
  resolveSection,
  type ElementAlias,
  type NormalizableItem,
  type SectionAlias,
} from "@/lib/pco/normalize";
import { PCO_TAXONOMY } from "@/lib/pco/taxonomy";

const sectionAliases: SectionAlias[] = [
  {
    campusCode: null,
    rawTitleNormalized: "pre service",
    matchType: "exact",
    priority: 10,
    sectionKey: "pre_service",
  },
  {
    campusCode: null,
    rawTitleNormalized: "^praise (&|and) worship$",
    matchType: "regex",
    priority: 20,
    sectionKey: "worship_open",
  },
  {
    campusCode: null,
    rawTitleNormalized: "^mid[- ]?service$",
    matchType: "regex",
    priority: 30,
    sectionKey: "mid_service",
  },
  {
    campusCode: null,
    rawTitleNormalized: "^live( stream| time| message.*)?$",
    matchType: "regex",
    priority: 40,
    sectionKey: "live",
  },
  {
    campusCode: null,
    rawTitleNormalized:
      "^(local|local response|location disconnect|live response)$",
    matchType: "regex",
    priority: 50,
    sectionKey: "local",
  },
];

const elementAliases: ElementAlias[] = [
  {
    campusCode: null,
    sectionKey: "pre_service",
    rawTitleNormalized: "countdown video",
    matchType: "exact",
    priority: 10,
    elementKey: "pre.countdown",
  },
  {
    campusCode: null,
    sectionKey: "worship_open",
    rawTitleNormalized: "communion",
    matchType: "exact",
    priority: 10,
    elementKey: "worship.communion",
  },
  {
    campusCode: null,
    sectionKey: "worship_open",
    rawTitleNormalized: "worship bundle",
    matchType: "exact",
    priority: 10,
    elementKey: "worship.open",
  },
  {
    campusCode: null,
    sectionKey: "mid_service",
    rawTitleNormalized: "meet & greet",
    matchType: "exact",
    priority: 10,
    elementKey: "mid.greet",
  },
  {
    campusCode: null,
    sectionKey: "live",
    rawTitleNormalized: "bumper video",
    matchType: "exact",
    priority: 10,
    elementKey: "live.bumper",
  },
  {
    campusCode: null,
    sectionKey: "local",
    rawTitleNormalized: "worship response song",
    matchType: "exact",
    priority: 10,
    elementKey: "local.worship_response",
  },
];

function item(
  sequence: number,
  title: string,
  itemType: NormalizableItem["itemType"] = "item",
): NormalizableItem {
  return {
    id: `item-${sequence}`,
    sequence,
    title,
    itemType,
    servicePosition: itemType === "header" ? "during" : null,
  };
}

describe("normalizePcoTitle", () => {
  it("normalizes Unicode, whitespace, case, and dash variants", () => {
    expect(normalizePcoTitle("  MID\u00a0—\u00a0SERVICE  ")).toBe("mid-service");
  });
});

describe("taxonomy resolution", () => {
  it.each([
    ["Pre Service", "pre_service"],
    ["Praise & Worship", "worship_open"],
    ["MID-SERVICE", "mid_service"],
    ["Live Time", "live"],
    ["Local Response", "local"],
  ])("maps the section heading %s", (title, expected) => {
    expect(resolveSection(title, "ELK", sectionAliases)).toBe(expected);
  });

  it("prefers a campus-specific alias over a global alias", () => {
    expect(
      resolveElement("Hosted Moment", "LV", "mid_service", [
        {
          campusCode: null,
          sectionKey: "mid_service",
          rawTitleNormalized: "hosted moment",
          matchType: "exact",
          priority: 1,
          elementKey: "mid.hosted_moment",
        },
        {
          campusCode: "LV",
          sectionKey: "mid_service",
          rawTitleNormalized: "hosted moment",
          matchType: "exact",
          priority: 100,
          elementKey: "mid.5spot",
        },
      ]),
    ).toBe("mid.5spot");
  });

  it("uses priority to break ties within the same scope", () => {
    expect(
      resolveSection("Live", "SLP", [
        {
          campusCode: null,
          rawTitleNormalized: "^live$",
          matchType: "regex",
          priority: 50,
          sectionKey: "local",
        },
        {
          campusCode: null,
          rawTitleNormalized: "live",
          matchType: "exact",
          priority: 10,
          sectionKey: "live",
        },
      ]),
    ).toBe("live");
  });
});

describe("normalizePlanItems golden taxonomy", () => {
  it("maps representative headings and elements in sequence", () => {
    const normalized = normalizePlanItems(
      [
        item(1, "Pre Service", "header"),
        item(2, "Countdown Video", "media"),
        item(3, "Praise & Worship", "header"),
        item(4, "Worship Bundle"),
        item(5, "Communion"),
        item(6, "Mid-Service", "header"),
        item(7, "Meet & Greet"),
        item(8, "Live Time", "header"),
        item(9, "Bumper Video", "media"),
        item(10, "Local Response", "header"),
        item(11, "Worship Response Song", "song"),
      ],
      "ELK",
      { sectionAliases, elementAliases },
    );

    expect(
      normalized
        .filter(({ itemType }) => itemType !== "header")
        .map(({ sectionKey, elementKey, resolutionSource }) => ({
          sectionKey,
          elementKey,
          resolutionSource,
        })),
    ).toEqual([
      {
        sectionKey: "pre_service",
        elementKey: "pre.countdown",
        resolutionSource: "alias",
      },
      {
        sectionKey: "worship_open",
        elementKey: "worship.open",
        resolutionSource: "alias",
      },
      {
        sectionKey: "worship_open",
        elementKey: "worship.communion",
        resolutionSource: "alias",
      },
      {
        sectionKey: "mid_service",
        elementKey: "mid.greet",
        resolutionSource: "alias",
      },
      {
        sectionKey: "live",
        elementKey: "live.bumper",
        resolutionSource: "alias",
      },
      {
        sectionKey: "local",
        elementKey: "local.worship_response",
        resolutionSource: "alias",
      },
    ]);
  });

  it("clears section context at an unknown header to prevent bucket bleed", () => {
    const normalized = normalizePlanItems(
      [
        item(1, "Live", "header"),
        item(2, "Bumper Video", "media"),
        item(3, "Unmapped Campus Moment", "header"),
        item(4, "Bumper Video", "media"),
        item(5, "Campus Prayer", "item"),
      ],
      "MG",
      { sectionAliases, elementAliases },
    );

    // The unknown header clears the live-section context; the item resolves
    // via the global fallback (adopting the alias's section), NOT by
    // inheriting the previous header's section.
    expect(normalized[3]).toMatchObject({
      sectionKey: "live",
      elementKey: "live.bumper",
      resolutionSource: "alias",
    });
    // A title with no alias anywhere stays unmapped with no section bleed.
    expect(normalized[4]).toMatchObject({
      sectionKey: null,
      elementKey: null,
      resolutionSource: "unmapped",
    });
  });

  it("sorts PCO items by sequence before carrying section context", () => {
    const normalized = normalizePlanItems(
      [item(2, "Bumper Video", "media"), item(1, "Live", "header")],
      "SLP",
      { sectionAliases, elementAliases },
    );

    expect(normalized.map(({ sequence }) => sequence)).toEqual([1, 2]);
    expect(normalized[1].elementKey).toBe("live.bumper");
  });

  it("maps communion under a worship header to the worship communion element", () => {
    const normalized = normalizePlanItems(
      [item(1, "Praise & Worship", "header"), item(2, "Communion")],
      "SLP",
      { sectionAliases, elementAliases },
    );

    expect(normalized[1]).toMatchObject({
      sectionKey: "worship_open",
      elementKey: "worship.communion",
      resolutionSource: "alias",
    });
  });

  it("maps communion via the unambiguous global fallback when no section resolves", () => {
    const normalized = normalizePlanItems(
      [item(1, "Communion")],
      "SLP",
      { sectionAliases, elementAliases },
    );

    // "communion" exists in exactly one section's aliases, so the
    // cross-section fallback resolves it even without a header — and the
    // item adopts the alias's home section.
    expect(normalized[0]).toMatchObject({
      sectionKey: "worship_open",
      elementKey: "worship.communion",
      resolutionSource: "alias",
    });
  });

  it("falls back to a global alias for unsectioned and wrong-section items", () => {
    const normalized = normalizePlanItems(
      [
        item(1, "Offering"), // no header at all
        item(2, "Praise & Worship", "header"),
        item(3, "Close Worship"), // stale worship section; alias lives in mid
      ],
      "ELK",
      { sectionAliases: PCO_TAXONOMY.sectionAliases, elementAliases: PCO_TAXONOMY.elementAliases },
    );

    expect(normalized[0]).toMatchObject({
      sectionKey: "mid_service",
      elementKey: "mid.offering.general",
      resolutionSource: "alias",
    });
    expect(normalized[2]).toMatchObject({
      sectionKey: "mid_service",
      elementKey: "mid.close_worship",
      resolutionSource: "alias",
    });
  });

  it("leaves ambiguous global fallback titles unmapped", () => {
    const ambiguous: ElementAlias[] = [
      ...elementAliases,
      {
        campusCode: null,
        sectionKey: "mid_service",
        rawTitleNormalized: "communion",
        matchType: "exact",
        priority: 10,
        elementKey: "mid.communion",
      },
    ];
    const normalized = normalizePlanItems(
      [item(1, "Communion")],
      "SLP",
      { sectionAliases, elementAliases: ambiguous },
    );

    expect(normalized[0]).toMatchObject({
      elementKey: null,
      resolutionSource: "unmapped",
    });
  });

  it("structurally maps unresolved songs in the local section to worship response", () => {
    const normalized = normalizePlanItems(
      [item(1, "Local Response", "header"), item(2, "Center", "song")],
      "MG",
      { sectionAliases, elementAliases },
    );

    expect(normalized[1]).toMatchObject({
      sectionKey: "local",
      elementKey: "local.worship_response",
      resolutionSource: "structural",
    });
  });

  it("maps historical title families via regex aliases", () => {
    const normalized = normalizePlanItems(
      [
        item(1, "Local Response", "header"),
        item(2, "Worship Response - Trust In God", "song"),
        item(3, "Salvation Response/Next steps"),
        item(4, "Final Prayer/Dismissal"),
        item(5, "Host Pastor//Close Worship"),
        item(6, "Message/Bumper"),
      ],
      "LV",
      { sectionAliases: PCO_TAXONOMY.sectionAliases, elementAliases: PCO_TAXONOMY.elementAliases },
    );

    expect(normalized[1].elementKey).toBe("local.worship_response");
    expect(normalized[2].elementKey).toBe("local.salvation");
    expect(normalized[3].elementKey).toBe("local.final_prayer");
    expect(normalized[4].elementKey).toBe("mid.close_worship");
    expect(normalized[5].elementKey).toBe("live.message");
  });
});
