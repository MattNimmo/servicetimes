import "server-only";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import {
  SESSION_COOKIE,
  SESSION_MAX_AGE_SECONDS,
  safePasswordEqual,
  signSessionToken,
  verifySessionToken,
  type AppRole,
} from "@/lib/auth/session";

type AuthConfig = {
  secret: string;
  viewerPassword: string;
  operatorPassword: string;
};

function authConfig(): AuthConfig | null {
  const secret = process.env.AUTH_SESSION_SECRET ?? "";
  const viewerPassword = process.env.VIEWER_PASSWORD ?? "";
  const operatorPassword = process.env.OPERATOR_PASSWORD ?? "";
  if (
    secret.length < 32 ||
    viewerPassword.length < 16 ||
    operatorPassword.length < 16 ||
    safePasswordEqual(viewerPassword, operatorPassword)
  ) {
    return null;
  }
  return { secret, viewerPassword, operatorPassword };
}

export async function getSession() {
  const config = authConfig();
  if (!config) return null;
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  return verifySessionToken(token, config.secret);
}

export async function requireRole(required: AppRole) {
  const session = await getSession();
  if (!session) redirect("/login");
  if (required === "operator" && session.role !== "operator") {
    throw new Error("Forbidden");
  }
  return session;
}

export async function loginAction(formData: FormData) {
  "use server";

  const config = authConfig();
  if (!config) redirect("/login?error=config");
  const candidate = formData.get("password");
  if (typeof candidate !== "string") redirect("/login?error=invalid");

  let role: AppRole | null = null;
  if (safePasswordEqual(candidate, config.operatorPassword)) role = "operator";
  else if (safePasswordEqual(candidate, config.viewerPassword)) role = "viewer";
  if (!role) redirect("/login?error=invalid");

  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE, signSessionToken(role, config.secret), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_MAX_AGE_SECONDS,
  });
  redirect("/");
}

export async function logoutAction() {
  "use server";

  (await cookies()).delete(SESSION_COOKIE);
  redirect("/login");
}
