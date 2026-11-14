import { normalizeVin, isValidFormat, checkDigitValid } from './vin.js';

const PROMPT = `This is a vehicle manufacturer spec plate (it may be rotated and may contain Arabic).
Return ONLY a JSON object with these keys (use null when not readable):
vin, manufacturer, productionDate, engine, transmission, colour, trim, gccSpec (boolean if the Arabic GCC conformity statement is present), unclear (array of fields that were hard to read).
VIN is 17 alphanumeric characters. Prefer the stamped VIN over any other number.`;

export function parsePlateJson(text) {
  const m = String(text || '').match(/\{[\s\S]*\}/);
  if (!m) return null;
  try { return JSON.parse(m[0]); } catch { return null; }
}

export async function readPlate(base64, mime, { apiKey, model = process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-20250514', fetchImpl = fetch } = {}) {
  if (!apiKey) return { status: 501, error: 'ANTHROPIC_API_KEY not set' };
  if (!mime || !/^image\/(jpeg|png|webp)$/.test(mime)) return { status: 400, error: 'image/jpeg, image/png or image/webp required' };
  const body = {
    model,
    max_tokens: 1024,
    messages: [{
      role: 'user',
      content: [
        { type: 'image', source: { type: 'base64', media_type: mime, data: base64 } },
        { type: 'text', text: PROMPT },
      ],
    }],
  };
  const r = await fetchImpl('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(60000),
  });
  if (!r.ok) return { status: r.status, error: await r.text() };
  const j = await r.json();
  const text = (j.content || []).filter((c) => c.type === 'text').map((c) => c.text).join('');
  const fields = parsePlateJson(text) || {};
  let vin = normalizeVin(fields.vin || '');
  const vinValid = isValidFormat(vin) && checkDigitValid(vin);
  if (isValidFormat(vin) && !checkDigitValid(vin)) vin = vin; // keep it; check digit is NA-centric
  const warnings = [];
  if (Array.isArray(fields.unclear) && fields.unclear.length) warnings.push(`Unclear fields: ${fields.unclear.join(', ')}`);
  return { vin, vinValid, fields: { ...fields, vin }, warnings };
}
