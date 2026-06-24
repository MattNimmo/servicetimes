import { describe, expect, it } from "vitest";

import { signSessionToken, verifySessionToken } from "@/lib/auth/session";

const secret = "a-secure-session-secret-with-32-chars";

describe("signed sessions", () => {
  it("verifies viewer and operator tokens", () => {
    expect(
      verifySessionToken(signSessionToken("viewer", secret, { nowSeconds: 100 }), secret, 101),
    ).toMatchObject({ role: "viewer" });
    expect(
      verifySessionToken(signSessionToken("operator", secret, { nowSeconds: 100 }), secret, 101),
    ).toMatchObject({ role: "operator" });
  });

  it("rejects a tampered role or expiry", () => {
    const token = signSessionToken("viewer", secret, { nowSeconds: 100 });
    const [, encoded, mac] = token.split(".");
    const payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
    payload.role = "operator";
    const tampered = `v1.${Buffer.from(JSON.stringify(payload)).toString("base64url")}.${mac}`;
    expect(verifySessionToken(tampered, secret, 101)).toBeNull();
  });

  it("rejects expired and malformed tokens", () => {
    const expired = signSessionToken("viewer", secret, {
      nowSeconds: 100,
      ttlSeconds: 1,
    });
    expect(verifySessionToken(expired, secret, 101)).toBeNull();
    expect(verifySessionToken("garbage", secret, 101)).toBeNull();
  });
});
