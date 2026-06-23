import { pcoGet, PCO_SERVICES_VERSION } from "@/lib/pco/client";
import type { PcoCollection, PcoServiceType } from "@/lib/pco/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  if (process.env.NODE_ENV === "production") {
    return Response.json({ error: "Not found" }, { status: 404 });
  }

  try {
    const response = await pcoGet<PcoCollection<PcoServiceType>>(
      "/services/v2/service_types?per_page=100&order=sequence",
    );

    const serviceTypes = response.data
      .filter(({ attributes }) => attributes.archived_at === null)
      .map(({ id, attributes }) => ({
        id,
        name: attributes.name,
        permissions: attributes.permissions,
      }));

    return Response.json({
      ok: true,
      apiVersion: PCO_SERVICES_VERSION,
      serviceTypeCount: serviceTypes.length,
      serviceTypes,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown Planning Center error";

    return Response.json({ ok: false, error: message }, { status: 502 });
  }
}
