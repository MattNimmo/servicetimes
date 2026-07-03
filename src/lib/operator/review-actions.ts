"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { requireRole } from "@/lib/auth/server";
import { postRpc } from "@/lib/supabase/rest";
import { parseDurationInput } from "@/lib/variance/format";

function safeRedirectPath(value: FormDataEntryValue | null) {
  if (typeof value !== "string" || !value.startsWith("/instrument")) {
    return "/instrument/triage";
  }
  return value;
}

function withToast(path: string, msg: string) {
  const sep = path.includes("?") ? "&" : "?";
  return `${path}${sep}toast=${encodeURIComponent(msg)}`;
}

// Row-level triage actions return state (for useActionState) instead of
// redirecting, so the page refreshes in place without losing scroll position.
export type InlineActionState = { message: string; ts: number } | null;

export async function resolveReviewIncidentAction(
  _prev: InlineActionState,
  formData: FormData,
): Promise<InlineActionState> {
  const session = await requireRole("operator");
  const incidentId = Number(formData.get("incidentId"));
  const resolution = formData.get("resolution");

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


  revalidatePath("/instrument");
  return { message: resolution === "kept" ? "Kept" : "Excluded", ts: Date.now() };
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


  revalidatePath("/instrument");
  revalidatePath("/variance");
  redirect(withToast(redirectTo, "Correction saved"));
}

export async function resolveSlotResolutionIncidentAction(formData: FormData) {
  const session = await requireRole("operator");
  const incidentId = Number(formData.get("incidentId"));
  const redirectTo = safeRedirectPath(formData.get("redirectTo"));
  const resolutionAction = formData.get("slotResolutionAction");
  const slotIdRaw = formData.get("slotId");

  if (!Number.isInteger(incidentId) || incidentId <= 0) {
    throw new Error("Invalid review incident.");
  }
  if (resolutionAction !== "map" && resolutionAction !== "exclude") {
    throw new Error("Invalid slot resolution action.");
  }

  let slotId: number | null = null;
  if (resolutionAction === "map") {
    slotId = Number(slotIdRaw);
    if (!Number.isInteger(slotId) || slotId <= 0) {
      throw new Error("A production slot is required.");
    }
  }

  await postRpc<{
    ok: boolean;
    incident_id: number;
    resolution_id: number;
    status: string;
  }>("resolve_slot_resolution_incident", {
    p_incident_id: incidentId,
    p_action: resolutionAction,
    p_slot_id: slotId,
    p_actor: session.role,
  });


  revalidatePath("/instrument");
  revalidatePath("/variance");
  redirect(withToast(redirectTo, "Slot resolved"));
}

export async function mapItemToElementAction(
  _prev: InlineActionState,
  formData: FormData,
): Promise<InlineActionState> {
  const session = await requireRole("operator");
  const itemId = Number(formData.get("itemId"));
  const elementWithSection = formData.get("elementWithSection");

  if (!Number.isInteger(itemId) || itemId <= 0) {
    throw new Error("Invalid item.");
  }
  if (typeof elementWithSection !== "string" || !elementWithSection) {
    throw new Error("Element selection is required.");
  }

  const pipeIdx = elementWithSection.lastIndexOf("|");
  if (pipeIdx === -1) {
    throw new Error("Invalid element selection format.");
  }
  const elementKey = elementWithSection.slice(0, pipeIdx);
  const sectionKey = elementWithSection.slice(pipeIdx + 1);

  if (!elementKey || !sectionKey) {
    throw new Error("Element key and section key are required.");
  }

  await postRpc<{ ok: boolean; override_id: number; item_id: number; element_key: string }>(
    "map_item_to_element",
    {
      p_item_id: itemId,
      p_element_key: elementKey,
      p_section_key: sectionKey,
      p_actor: session.role,
    },
  );


  revalidatePath("/instrument");
  revalidatePath("/variance");
  return { message: "Mapped", ts: Date.now() };
}

export async function reopenReviewIncidentAction(
  _prev: InlineActionState,
  formData: FormData,
): Promise<InlineActionState> {
  const session = await requireRole("operator");
  const incidentId = Number(formData.get("incidentId"));

  if (!Number.isInteger(incidentId) || incidentId <= 0) {
    throw new Error("Invalid review incident.");
  }

  await postRpc<{ ok: boolean; incident_id: number; status: string }>("reopen_review_incident", {
    p_incident_id: incidentId,
    p_actor: session.role,
  });


  revalidatePath("/instrument");
  revalidatePath("/variance");
  return { message: "Reopened", ts: Date.now() };
}

export async function unmapItemAction(
  _prev: InlineActionState,
  formData: FormData,
): Promise<InlineActionState> {
  const session = await requireRole("operator");
  const itemId = Number(formData.get("itemId"));

  if (!Number.isInteger(itemId) || itemId <= 0) {
    throw new Error("Invalid item.");
  }

  await postRpc<{ ok: boolean; item_id: number; revoked: boolean }>("revoke_item_element_mapping", {
    p_item_id: itemId,
    p_actor: session.role,
  });


  revalidatePath("/instrument");
  revalidatePath("/variance");
  return { message: "Unmapped", ts: Date.now() };
}

export async function correctItemTimeIncidentAction(formData: FormData) {
  const session = await requireRole("operator");
  const incidentId = Number(formData.get("incidentId"));
  const redirectTo = safeRedirectPath(formData.get("redirectTo"));

  if (!Number.isInteger(incidentId) || incidentId <= 0) {
    throw new Error("Invalid review incident.");
  }

  const corrections: Array<{ item_time_id: number; corrected_actual_seconds: number }> = [];
  for (const [key, value] of formData.entries()) {
    if (!key.startsWith("itemTime:")) continue;
    if (typeof value !== "string" || value.trim() === "") continue;
    const itemTimeId = Number(key.slice("itemTime:".length));
    if (!Number.isInteger(itemTimeId) || itemTimeId <= 0) {
      throw new Error("Invalid item time correction target.");
    }
    const correctedActualSeconds = parseDurationInput(value);
    if (correctedActualSeconds === null) {
      throw new Error("Corrected duration must be m:ss or h:mm:ss.");
    }
    corrections.push({
      item_time_id: itemTimeId,
      corrected_actual_seconds: correctedActualSeconds,
    });
  }

  if (corrections.length === 0) {
    throw new Error("At least one corrected item duration is required.");
  }

  await postRpc<{
    ok: boolean;
    incident_id: number;
    correction_set_id: number;
    status: string;
  }>("correct_item_time_incident", {
    p_incident_id: incidentId,
    p_corrections: corrections,
    p_actor: session.role,
  });


  revalidatePath("/instrument");
  revalidatePath("/variance");
  redirect(withToast(redirectTo, "Correction saved"));
}

export async function generatePlanChangesAction(formData: FormData) {
  const session = await requireRole("operator");
  const campus = formData.get("campus");
  const serviceDate = formData.get("serviceDate");
  const redirectTo = safeRedirectPath(formData.get("redirectTo"));

  if (typeof campus !== "string" || campus.trim() === "") {
    throw new Error("Campus is required.");
  }
  if (typeof serviceDate !== "string" || serviceDate.trim() === "") {
    throw new Error("Service date is required.");
  }

  const result = await postRpc<{
    ok: boolean;
    campus: string;
    service_date: string;
    plan_id: number;
    inserted_count: number;
  }>("generate_planned_item_plan_changes", {
    p_campus_code: campus,
    p_service_date: serviceDate,
    p_actor: session.role,
    p_min_element_delta_seconds: 30,
  });

  revalidatePath("/instrument");
  redirect(withToast(redirectTo, `${result.inserted_count} recommendation${result.inserted_count === 1 ? "" : "s"} generated`));
}

export async function resolvePlanChangeAction(formData: FormData) {
  const session = await requireRole("operator");
  const planChangeId = Number(formData.get("planChangeId"));
  const resolution = formData.get("resolution");
  const redirectTo = safeRedirectPath(formData.get("redirectTo"));

  if (!Number.isInteger(planChangeId) || planChangeId <= 0) {
    throw new Error("Invalid recommendation.");
  }
  if (resolution !== "applied" && resolution !== "dismissed") {
    throw new Error("Invalid recommendation resolution.");
  }

  await postRpc<{
    ok: boolean;
    plan_change_id: number;
    status: string;
  }>("resolve_plan_change", {
    p_plan_change_id: planChangeId,
    p_resolution: resolution,
    p_actor: session.role,
  });

  revalidatePath("/instrument");
  redirect(withToast(redirectTo, resolution === "applied" ? "Recommendation applied" : "Recommendation dismissed"));
}
