import "server-only";

import type { PcoCollection } from "@/lib/pco/types";

const PCO_BASE_URL = "https://api.planningcenteronline.com";
export const PCO_SERVICES_VERSION = "2018-11-01";

export class PcoRequestError extends Error {
  constructor(
    public readonly status: number,
    public readonly requestId: string | null,
  ) {
    super(`Planning Center request failed with status ${status}`);
    this.name = "PcoRequestError";
  }
}

function requireEnv(name: "PCO_CLIENT_ID" | "PCO_CLIENT_SECRET") {
  const value = process.env[name];

  if (!value) {
    throw new Error(`Missing required server environment variable: ${name}`);
  }

  return value;
}

function getUserAgent() {
  return (
    process.env.PCO_USER_AGENT ??
    "ECC Service Times v2 (communications@emmanuelcc.org)"
  );
}

/**
 * The only Planning Center transport exposed by this application.
 * It intentionally supports GET requests only.
 */
export async function pcoGet<T>(path: string): Promise<T> {
  if (!path.startsWith("/services/v2/")) {
    throw new Error("PCO requests must target a Services v2 path");
  }

  const credentials = Buffer.from(
    `${requireEnv("PCO_CLIENT_ID")}:${requireEnv("PCO_CLIENT_SECRET")}`,
  ).toString("base64");

  const response = await fetch(new URL(path, PCO_BASE_URL), {
    method: "GET",
    headers: {
      Accept: "application/vnd.api+json",
      Authorization: `Basic ${credentials}`,
      "User-Agent": getUserAgent(),
      "X-PCO-API-Version": PCO_SERVICES_VERSION,
    },
    cache: "no-store",
    signal: AbortSignal.timeout(15_000),
  });

  if (!response.ok) {
    throw new PcoRequestError(
      response.status,
      response.headers.get("x-request-id"),
    );
  }

  return (await response.json()) as T;
}

export function normalizeNextPath(next: string) {
  const url = new URL(next, PCO_BASE_URL);

  if (url.origin !== PCO_BASE_URL || !url.pathname.startsWith("/services/v2/")) {
    throw new Error("PCO pagination left the Services v2 API boundary");
  }

  return `${url.pathname}${url.search}`;
}

export async function pcoGetAll<T, I = never>(
  path: string,
): Promise<PcoCollection<T, I>> {
  const data: T[] = [];
  const included = new Map<string, I>();
  let next: string | null = path;
  let pages = 0;

  while (next) {
    if (pages >= 25) {
      throw new Error("PCO pagination exceeded the 25-page safety limit");
    }

    const page: PcoCollection<T, I> = await pcoGet(next);
    data.push(...page.data);

    for (const resource of page.included ?? []) {
      const identifiable = resource as { type?: string; id?: string };
      const key = `${identifiable.type ?? "unknown"}:${identifiable.id ?? included.size}`;
      included.set(key, resource);
    }

    next = page.links?.next ? normalizeNextPath(page.links.next) : null;
    pages += 1;
  }

  return {
    data,
    included: [...included.values()],
    meta: { count: data.length, total_count: data.length },
  };
}
