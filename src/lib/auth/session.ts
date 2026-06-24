import { createHmac, timingSafeEqual } from "node:crypto";

export type AppRole = "viewer" | "operator";

export type AppSession = {
  role: AppRole;
  exp: number;
};

export const SESSION_COOKIE = "st_session";
export const SESSION_MAX_AGE_SECONDS = 7 * 24 * 60 * 60;

function signature(value: string, secret: string) {
  return createHmac("sha256", secret).update(value).digest("base64url");
}

function safeEqual(left: string, right: string) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return (
    leftBuffer.length === rightBuffer.length &&
    timingSafeEqual(leftBuffer, rightBuffer)
  );
}

export function signSessionToken(
  role: AppRole,
  secret: string,
  options: { nowSeconds?: number; ttlSeconds?: number } = {},
) {
  const nowSeconds = options.nowSeconds ?? Math.floor(Date.now() / 1000);
  const payload: AppSession = {
    role,
    exp: nowSeconds + (options.ttlSeconds ?? SESSION_MAX_AGE_SECONDS),
  };
  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const unsigned = `v1.${encoded}`;
  return `${unsigned}.${signature(unsigned, secret)}`;
}

export function verifySessionToken(
  token: string | null | undefined,
  secret: string,
  nowSeconds = Math.floor(Date.now() / 1000),
): AppSession | null {
  if (!token || token.length > 2048) return null;
  const parts = token.split(".");
  if (parts.length !== 3 || parts[0] !== "v1") return null;
  const unsigned = `${parts[0]}.${parts[1]}`;
  if (!safeEqual(signature(unsigned, secret), parts[2])) return null;

  try {
    const payload = JSON.parse(
      Buffer.from(parts[1], "base64url").toString("utf8"),
    ) as Partial<AppSession>;
    if (
      (payload.role !== "viewer" && payload.role !== "operator") ||
      !Number.isSafeInteger(payload.exp) ||
      (payload.exp ?? 0) <= nowSeconds
    ) {
      return null;
    }
    return payload as AppSession;
  } catch {
    return null;
  }
}

export function safePasswordEqual(candidate: string, expected: string) {
  return safeEqual(candidate, expected);
}
