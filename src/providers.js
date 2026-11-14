// Plug in a paid history provider (accidents, salvage, odometer) via env vars.
// The provider's JSON is passed through untouched under `providers` in the report.
export async function runProviders(vin, { fetchImpl = fetch } = {}) {
  const url = process.env.HISTORY_API_URL;
  if (!url) return [];
  const name = process.env.HISTORY_API_NAME || 'history-provider';
  try {
    const headers = process.env.HISTORY_API_KEY ? { Authorization: `Bearer ${process.env.HISTORY_API_KEY}` } : {};
    const r = await fetchImpl(url.replace('{vin}', encodeURIComponent(vin)), { headers, signal: AbortSignal.timeout(15000) });
    return [{ name, ok: r.ok, data: r.ok ? await r.json() : null }];
  } catch (e) {
    return [{ name, ok: false, error: e.message }];
  }
}
