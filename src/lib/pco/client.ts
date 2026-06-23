import "server-only";

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
