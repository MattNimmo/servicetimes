import { runPcoDataShapeProbe } from "@/lib/pco/probe";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  if (process.env.NODE_ENV === "production") {
    return Response.json({ error: "Not found" }, { status: 404 });
  }

  try {
    return Response.json(await runPcoDataShapeProbe());
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown Planning Center error";

    return Response.json({ ok: false, error: message }, { status: 502 });
  }
}
