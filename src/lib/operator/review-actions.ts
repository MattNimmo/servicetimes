"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { requireRole } from "@/lib/auth/server";
import { postRpc } from "@/lib/supabase/rest";

function safeRedirectPath(value: FormDataEntryValue | null) {
  if (typeof value !== "string" || !value.startsWith("/operator")) {
    return "/operator/review";
  }
  return value;
}

export async function resolveReviewIncidentAction(formData: FormData) {
  const session = await requireRole("operator");
  const incidentId = Number(formData.get("incidentId"));
  const resolution = formData.get("resolution");
  const redirectTo = safeRedirectPath(formData.get("redirectTo"));

  if (!Number.isInteger(incidentId) || incidentId <= 0) {
    throw new Error("Invalid review incident.");
  }
  if (resolution !== "kept" && resolution !== "excluded") {
    throw new Error("Invalid review resolution.");
  }

  await postRpc<{ ok: boolean; incident_id: number; status: string }>(
    "resolve_review_incident",
    {
      p_incident_id: incidentId,
      p_resolution: resolution,
      p_actor: session.role,
    },
  );

  revalidatePath("/operator/review");
  redirect(redirectTo);
}
