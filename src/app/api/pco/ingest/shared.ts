import { randomUUID, timingSafeEqual } from "node:crypto";

type IngestResult = {
  ok: boolean;
  writesPerformed?: number;
};

function authorized(request: Request, secret: string) {
  const actual = Buffer.from(request.headers.get("authorization") ?? "");
  const expected = Buffer.from(`Bearer ${secret}`);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export async function runSecuredPcoIngest(
  request: Request,
  label: string,
  run: () => Promise<IngestResult>,
  options: {
    additionalAuthorization?: (request: Request) => Promise<boolean>;
  } = {},
) {
  const requestId = randomUUID();
  const startedAt = Date.now();
  const schedule = request.headers.get("x-vercel-cron-schedule");
  const trigger = schedule ? "vercel-cron" : request.method === "POST" ? "manual" : "direct";
  const respond = (body: Record<string, unknown>, status: number) =>
    Response.json(body, {
      status,
      headers: {
        "Cache-Control": "no-store",
        "X-Ingest-Request-Id": requestId,
      },
    });

  console.info(
    `[${label}] start: requestId=${requestId} trigger=${trigger} schedule=${schedule ?? "none"}`,
  );

  const secret = process.env.CRON_SECRET;
  if (!secret || secret.length < 16) {
    console.error(
      `[${label}] aborted: requestId=${requestId} CRON_SECRET missing or < 16 chars`,
    );
    return respond({ ok: false, error: "Cron authentication is not configured" }, 503);
  }
  const hasSharedSecret = authorized(request, secret);
  const hasAdditionalAuthorization =
    !hasSharedSecret && options.additionalAuthorization
      ? await options.additionalAuthorization(request)
      : false;
  if (!hasSharedSecret && !hasAdditionalAuthorization) {
    console.warn(
      `[${label}] aborted: requestId=${requestId} unauthorized request (bearer token mismatch)`,
    );
    return respond({ ok: false, error: "Unauthorized" }, 401);
  }
  if (process.env.ENABLE_PCO_INGESTION_WRITES !== "true") {
    console.error(
      `[${label}] aborted: requestId=${requestId} ENABLE_PCO_INGESTION_WRITES is not "true"`,
    );
    return respond({ ok: false, error: "Database ingestion is disabled" }, 503);
  }

  try {
    const result = await run();
    console.info(
      `[${label}] complete: requestId=${requestId} ok=${result.ok} writesPerformed=${result.writesPerformed ?? 0} durationMs=${Date.now() - startedAt}`,
    );
    return respond(result, result.ok ? 200 : 502);
  } catch (error) {
    console.error(
      `[${label}] threw: requestId=${requestId} durationMs=${Date.now() - startedAt}`,
      error instanceof Error ? error.message : "unknown",
    );
    return respond(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Unknown recurring ingestion error",
      },
      502,
    );
  }
}
