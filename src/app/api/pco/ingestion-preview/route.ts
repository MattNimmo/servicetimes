import { previewLatestPcoIngestion } from "@/lib/pco/ingestion-preview";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  if (process.env.NODE_ENV === "production") {
    return Response.json({ error: "Not found" }, { status: 404 });
  }

  try {
    return Response.json(await previewLatestPcoIngestion());
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown ingestion preview error";

    return Response.json({ ok: false, dryRun: true, error: message }, { status: 502 });
  }
}
