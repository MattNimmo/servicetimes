import "server-only";

type SupabaseEnvName =
  | "NEXT_PUBLIC_SUPABASE_URL"
  | "SUPABASE_SERVICE_ROLE_KEY";

export function requireSupabaseEnv(name: SupabaseEnvName) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required server environment variable: ${name}`);
  return value;
}

export async function readRows<T>(
  table: string,
  params: Record<string, string>,
) {
  const supabaseUrl = requireSupabaseEnv("NEXT_PUBLIC_SUPABASE_URL");
  const serviceRoleKey = requireSupabaseEnv("SUPABASE_SERVICE_ROLE_KEY");
  const url = new URL(`/rest/v1/${table}`, supabaseUrl);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);

  const response = await fetch(url, {
    headers: {
      apikey: serviceRoleKey,
      Authorization: `Bearer ${serviceRoleKey}`,
    },
    cache: "no-store",
    signal: AbortSignal.timeout(30_000),
  });

  if (!response.ok) {
    throw new Error(`Supabase read failed for ${table} (${response.status})`);
  }

  return (await response.json()) as T[];
}
