import "server-only";

import { createPublicKey, verify, type JsonWebKey } from "node:crypto";

const ISSUER = "https://token.actions.githubusercontent.com";
const JWKS_URL = `${ISSUER}/.well-known/jwks`;
const AUDIENCE = "servicetimes-ingest-watchdog";
const REPOSITORY = "MattNimmo/servicetimes";
const REPOSITORY_ID = "1277984980";
const MAIN_REF = "refs/heads/main";
const WORKFLOW_REF = `${REPOSITORY}/.github/workflows/ingest-watchdog.yml@${MAIN_REF}`;

type JwtHeader = {
  alg?: string;
  kid?: string;
  typ?: string;
};

type JwtClaims = {
  aud?: string | string[];
  event_name?: string;
  exp?: number;
  iat?: number;
  iss?: string;
  nbf?: number;
  ref?: string;
  repository?: string;
  repository_id?: string;
  workflow_ref?: string;
};

type Jwks = {
  keys?: Array<JsonWebKey & { kid?: string; use?: string }>;
};

function decodePart<T>(part: string): T {
  return JSON.parse(Buffer.from(part, "base64url").toString("utf8")) as T;
}

function includesAudience(audience: JwtClaims["aud"]) {
  return Array.isArray(audience)
    ? audience.includes(AUDIENCE)
    : audience === AUDIENCE;
}

function validClaims(claims: JwtClaims, nowSeconds: number) {
  const allowedEvent =
    claims.event_name === "schedule" ||
    claims.event_name === "workflow_dispatch";

  return (
    claims.iss === ISSUER &&
    includesAudience(claims.aud) &&
    claims.repository === REPOSITORY &&
    claims.repository_id === REPOSITORY_ID &&
    claims.ref === MAIN_REF &&
    claims.workflow_ref === WORKFLOW_REF &&
    allowedEvent &&
    typeof claims.exp === "number" &&
    claims.exp >= nowSeconds &&
    (typeof claims.nbf !== "number" || claims.nbf <= nowSeconds + 30) &&
    (typeof claims.iat !== "number" || claims.iat <= nowSeconds + 30)
  );
}

export async function authorizeGitHubIngestWatchdog(request: Request) {
  try {
    const authorization = request.headers.get("authorization") ?? "";
    if (!authorization.startsWith("Bearer ")) return false;
    const token = authorization.slice("Bearer ".length);
    if (token.length === 0 || token.length > 16_384) return false;

    const parts = token.split(".");
    if (parts.length !== 3) return false;
    const [encodedHeader, encodedClaims, encodedSignature] = parts;
    const header = decodePart<JwtHeader>(encodedHeader);
    const claims = decodePart<JwtClaims>(encodedClaims);
    if (header.alg !== "RS256" || !header.kid) return false;
    if (!validClaims(claims, Math.floor(Date.now() / 1_000))) return false;

    const response = await fetch(JWKS_URL, {
      headers: { Accept: "application/json" },
      cache: "no-store",
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) return false;
    const jwks = (await response.json()) as Jwks;
    const jwk = jwks.keys?.find(
      (candidate) =>
        candidate.kid === header.kid &&
        candidate.kty === "RSA" &&
        (!candidate.use || candidate.use === "sig"),
    );
    if (!jwk) return false;

    return verify(
      "RSA-SHA256",
      Buffer.from(`${encodedHeader}.${encodedClaims}`),
      createPublicKey({ key: jwk, format: "jwk" }),
      Buffer.from(encodedSignature, "base64url"),
    );
  } catch (error) {
    console.warn(
      "[github-actions-oidc] token verification failed",
      error instanceof Error ? error.message : "unknown error",
    );
    return false;
  }
}
