// Insurance and accident data connectors. Each source is a licensed API you configure via env vars;
// responses are normalised so any provider (insurer, traffic authority, aggregator) can plug in.
async function getJson(url, key, vin, fetchImpl) {
  const r = await fetchImpl(url.replace('{vin}', encodeURIComponent(vin)), {
    headers: key ? { Authorization: `Bearer ${key}` } : {}, signal: AbortSignal.timeout(15000),
  });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}

export function normalizeInsurance(d) {
  if (!d || typeof d !== 'object') return { status: 'unknown' };
  const expiry = d.expiry || d.expiryDate || null;
  const expiryTime = typeof expiry === 'string' ? Date.parse(expiry) : NaN;
  const today = new Date().toISOString().slice(0, 10);
  let status = d.status;
  if (!['active', 'expired', 'none'].includes(status)) status = Number.isFinite(expiryTime) ? (expiryTime >= Date.parse(today) ? 'active' : 'expired') : 'unknown';
  return { status, insurer: d.insurer || null, policyType: d.policyType || d.coverage || null, expiry };
}

export function normalizeAccidents(d) {
  const arr = Array.isArray(d) ? d : d?.accidents || [];
  if (!Array.isArray(arr) || (!Array.isArray(d) && !Array.isArray(d?.accidents))) throw new Error('Invalid accidents response');
  return arr.filter(a => a && typeof a === 'object').map((a) => ({ date: a.date || null, severity: a.severity || null, totalLoss: typeof a.totalLoss === 'boolean' ? a.totalLoss : null,
    description: String(a.description || '').slice(0, 500), source: a.source || null }));
}

export async function runConnectors(vin, userRecords = [], { env = process.env, fetchImpl = fetch } = {}) {
  const out = { insurance: { status: 'not_connected' }, accidents: { status: 'not_connected', items: [] } };
  if (env.INSURANCE_API_URL) {
    try { out.insurance = normalizeInsurance(await getJson(env.INSURANCE_API_URL, env.INSURANCE_API_KEY, vin, fetchImpl)); }
    catch (e) { out.insurance = { status: 'error', error: e.message }; }
  }
  if (env.ACCIDENTS_API_URL) {
    try { out.accidents = { status: 'ok', items: normalizeAccidents(await getJson(env.ACCIDENTS_API_URL, env.ACCIDENTS_API_KEY, vin, fetchImpl)) }; }
    catch (e) { out.accidents = { status: 'error', error: e.message, items: [] }; }
  }
  const own = userRecords.filter((r) => r.type === 'accident')
    .map((r) => ({ date: r.date, severity: null, totalLoss: null, description: r.note, source: `Reported by ${r.source}` }));
  out.accidents.items = [...out.accidents.items, ...own];
  return out;
}
