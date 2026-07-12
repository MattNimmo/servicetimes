import { generateKeyPairSync, sign } from "node:crypto";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { authorizeGitHubIngestWatchdog } from "@/lib/auth/github-actions-oidc";

const { privateKey, publicKey } = generateKeyPairSync("rsa", {
  modulusLength: 2048,
});
const kid = "test-key";
const nowSeconds = Date.parse("2026-07-12T21:00:00Z") / 1_000;

function token(overrides: Record<string, unknown> = {}) {
  const header = Buffer.from(
    JSON.stringify({ alg: "RS256", kid, typ: "JWT" }),
  ).toString("base64url");
  const claims = Buffer.from(
    JSON.stringify({
      iss: "https://token.actions.githubusercontent.com",
      aud: "servicetimes-ingest-watchdog",
      repository: "MattNimmo/servicetimes",
      repository_id: "1277984980",
      ref: "refs/heads/main",
      workflow_ref:
        "MattNimmo/servicetimes/.github/workflows/ingest-watchdog.yml@refs/heads/main",
      event_name: "schedule",
      iat: nowSeconds - 30,
      nbf: nowSeconds - 30,
      exp: nowSeconds + 300,
      ...overrides,
    }),
  ).toString("base64url");
  const signature = sign(
    "RSA-SHA256",
    Buffer.from(`${header}.${claims}`),
    privateKey,
  ).toString("base64url");
  return `${header}.${claims}.${signature}`;
}

function request(value: string) {
  return new Request("https://servicetimes.example/api/pco/ingest/watchdog", {
    method: "POST",
    headers: { Authorization: `Bearer ${value}` },
  });
}

describe("authorizeGitHubIngestWatchdog", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(nowSeconds * 1_000));
    const jwk = publicKey.export({ format: "jwk" });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({ keys: [{ ...jwk, kid, use: "sig", alg: "RS256" }] }),
      ),
    );
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("accepts a signed token from the main-branch watchdog workflow", async () => {
    await expect(authorizeGitHubIngestWatchdog(request(token()))).resolves.toBe(
      true,
    );
  });

  it("rejects tokens from another repository or workflow ref", async () => {
    await expect(
      authorizeGitHubIngestWatchdog(
        request(token({ repository_id: "999", repository: "attacker/fork" })),
      ),
    ).resolves.toBe(false);
    await expect(
      authorizeGitHubIngestWatchdog(
        request(
          token({
            workflow_ref:
              "MattNimmo/servicetimes/.github/workflows/other.yml@refs/heads/main",
          }),
        ),
      ),
    ).resolves.toBe(false);
  });

  it("rejects expired or incorrectly scoped tokens", async () => {
    await expect(
      authorizeGitHubIngestWatchdog(
        request(token({ exp: nowSeconds - 1, aud: "wrong-audience" })),
      ),
    ).resolves.toBe(false);
  });
});
