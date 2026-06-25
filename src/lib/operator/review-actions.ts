"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { requireRole } from "@/lib/auth/server";
import { postRpc } from "@/lib/supabase/rest";
import { parseDurationInput } from "@/lib/variance/format";

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

export async function correctPlanTimeIncidentAction(formData: FormData) {
  const session = await requireRole("operator");
  const incidentId = Number(formData.get("incidentId"));
  const redirectTo = safeRedirectPath(formData.get("redirectTo"));
  const correctedActual = formData.get("correctedActual");

  if (!Number.isInteger(incidentId) || incidentId <= 0) {
    throw new Error("Invalid review incident.");
  }
  if (typeof correctedActual !== "string") {
    throw new Error("Corrected duration is required.");
  }

  const correctedActualSeconds = parseDurationInput(correctedActual);
  if (correctedActualSeconds === null) {
    throw new Error("Corrected duration must be m:ss or h:mm:ss.");
  }

  await postRpc<{
    ok: boolean;
    incident_id: number;
    correction_set_id: number;
    status: string;
  }>("correct_plan_time_incident", {
    p_incident_id: incidentId,
    p_corrected_actual_seconds: correctedActualSeconds,
    p_actor: session.role,
  });

  revalidatePath("/operator/review");
  revalidatePath("/variance");
  redirect(redirectTo);
}
