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

type TaxonomyConfig = {
  sectionAliases: SectionAlias[];
  elementAliases: ElementAlias[];
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
  aliases: T[],
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
  aliases: SectionAlias[],
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
  aliases: ElementAlias[],
) {
  const sectionAliases = aliases.filter(
    (alias) => alias.sectionKey === sectionKey,
  );

  return (
    findAlias(sectionAliases, normalizePcoTitle(rawTitle), campusCode)
      ?.elementKey ?? null
  );
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

      const elementKey = activeSectionKey
        ? resolveElement(
            item.title,
            campusCode,
            activeSectionKey,
            config.elementAliases,
          )
        : null;

      return {
        ...item,
        rawTitleNormalized,
        sectionKey: activeSectionKey,
        elementKey,
        resolutionSource: elementKey ? "alias" : "unmapped",
      };
    });
}
