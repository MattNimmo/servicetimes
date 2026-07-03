export type AliasMatchType = "exact" | "regex";

export type SectionAlias = {
  campusCode: string | null;
  rawTitleNormalized: string;
  matchType: AliasMatchType;
  priority: number;
  sectionKey: string;
};

export type ElementAlias = {
  campusCode: string | null;
  sectionKey: string;
  rawTitleNormalized: string;
  matchType: AliasMatchType;
  priority: number;
  elementKey: string;
};

export type CombinedTitleRule = {
  campusCode: string | null;
  rawTitleNormalized: string;
  suggestedSectionKey: string | null;
};

export type NormalizableItem = {
  id: string;
  sequence: number;
  title: string;
  itemType: "song" | "header" | "media" | "item";
  servicePosition: "pre" | "during" | "post" | null;
};

export type NormalizedItem = NormalizableItem & {
  rawTitleNormalized: string;
  sectionKey: string | null;
  elementKey: string | null;
  resolutionSource: "alias" | "structural" | "unmapped";
};

export type TaxonomyConfig = {
  sectionAliases: readonly SectionAlias[];
  elementAliases: readonly ElementAlias[];
  combinedTitleRules?: readonly CombinedTitleRule[];
};

type AliasBase = {
  campusCode: string | null;
  rawTitleNormalized: string;
  matchType: AliasMatchType;
  priority: number;
};

export function normalizePcoTitle(title: string) {
  return title
    .normalize("NFKC")
    .replace(/[\u2010-\u2015]/g, "-")
    .replace(/\s+/g, " ")
    .replace(/\s*-\s*/g, "-")
    .trim()
    .toLocaleLowerCase("en-US");
}

function aliasMatches(alias: AliasBase, normalizedTitle: string) {
  if (alias.matchType === "exact") {
    return alias.rawTitleNormalized === normalizedTitle;
  }

  return new RegExp(alias.rawTitleNormalized, "u").test(normalizedTitle);
}

function findAlias<T extends AliasBase>(
  aliases: readonly T[],
  normalizedTitle: string,
  campusCode: string,
) {
  return aliases
    .filter(
      (alias) =>
        (alias.campusCode === null || alias.campusCode === campusCode) &&
        aliasMatches(alias, normalizedTitle),
    )
    .sort((left, right) => {
      const campusSpecificity =
        Number(right.campusCode !== null) - Number(left.campusCode !== null);

      return campusSpecificity || left.priority - right.priority;
    })[0];
}

export function resolveSection(
  rawTitle: string,
  campusCode: string,
  aliases: readonly SectionAlias[],
) {
  return (
    findAlias(aliases, normalizePcoTitle(rawTitle), campusCode)?.sectionKey ??
    null
  );
}

export function resolveElement(
  rawTitle: string,
  campusCode: string,
  sectionKey: string,
  aliases: readonly ElementAlias[],
) {
  const sectionAliases = aliases.filter(
    (alias) => alias.sectionKey === sectionKey,
  );

  return (
    findAlias(sectionAliases, normalizePcoTitle(rawTitle), campusCode)
      ?.elementKey ?? null
  );
}

/**
 * Cross-section fallback: when section-scoped resolution fails (item has no
 * section header, or sits under a stale one — both endemic in historical
 * plans), match against ALL element aliases and accept the result only when
 * every match agrees on a single element. Ambiguous titles stay unmapped.
 */
export function resolveElementGlobally(
  rawTitle: string,
  campusCode: string,
  aliases: readonly ElementAlias[],
): { elementKey: string; sectionKey: string } | null {
  const normalized = normalizePcoTitle(rawTitle);
  const matched = aliases.filter(
    (alias) =>
      (alias.campusCode === null || alias.campusCode === campusCode) &&
      (alias.matchType === "exact"
        ? alias.rawTitleNormalized === normalized
        : new RegExp(alias.rawTitleNormalized, "u").test(normalized)),
  );

  const elementKeys = [...new Set(matched.map(({ elementKey }) => elementKey))];
  if (elementKeys.length !== 1) return null;
  // The item also adopts the alias's home section, so a stale or missing
  // header doesn't leave it displayed under the wrong part of the service.
  return { elementKey: elementKeys[0], sectionKey: matched[0].sectionKey };
}

export function normalizePlanItems(
  items: NormalizableItem[],
  campusCode: string,
  config: TaxonomyConfig,
) {
  let activeSectionKey: string | null = null;

  return [...items]
    .sort((left, right) => left.sequence - right.sequence)
    .map<NormalizedItem>((item) => {
      const rawTitleNormalized = normalizePcoTitle(item.title);

      if (item.itemType === "header") {
        activeSectionKey = resolveSection(
          item.title,
          campusCode,
          config.sectionAliases,
        );

        return {
          ...item,
          rawTitleNormalized,
          sectionKey: activeSectionKey,
          elementKey: null,
          resolutionSource: activeSectionKey ? "structural" : "unmapped",
        };
      }

      const sectionScoped = activeSectionKey
        ? resolveElement(
            item.title,
            campusCode,
            activeSectionKey,
            config.elementAliases,
          )
        : null;

      // Historical plans frequently lack headers (or carry stale ones), so a
      // section-scoped miss falls back to an unambiguous global alias match,
      // adopting the alias's home section.
      const fallback = sectionScoped
        ? null
        : resolveElementGlobally(item.title, campusCode, config.elementAliases);

      // Last resort: an unresolved *song* inside the local section is, by
      // structure, the worship response song.
      const structural =
        !sectionScoped && !fallback && item.itemType === "song" && activeSectionKey === "local"
          ? "local.worship_response"
          : null;

      const elementKey = sectionScoped ?? fallback?.elementKey ?? structural;

      return {
        ...item,
        rawTitleNormalized,
        sectionKey: fallback?.sectionKey ?? activeSectionKey,
        elementKey,
        resolutionSource: structural
          ? "structural"
          : elementKey
            ? "alias"
            : "unmapped",
      };
    });
}
