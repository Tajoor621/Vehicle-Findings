import { normalizeVin, isValidFormat, checkDigitValid } from './vin.js';

const PROMPT = `This is a vehicle manufacturer spec plate (it may be rotated and may contain Arabic).
Return ONLY a JSON object, no other text, with these keys (use null when absent or unreadable):
vin, manufacturer, madeIn, productionDate (YYYY-MM), model, engine, displacementCc (number), plant, colorTrim, transmission, bodyType,
gccSpec (true if the Arabic text states conformity to GCC/Gulf standards, false if clearly absent, null if unclear),
unclear (array of printed values you could not interpret).
Copy characters exactly and never guess. A VIN has 17 characters and never contains I, O or Q.`;

export function parsePlateJson(text) {
  const m = String(text).match(/\{[\s\S]*\}/);
  if (!m) throw new Error('No data found in the plate reading.');
  const fields = JSON.parse(m[0]);
  if (!fields || typeof fields !== 'object' || Array.isArray(fields)) throw new Error('Invalid plate output.');
  return fields;
}

export async function readPlate(image, mediaType = 'image/jpeg', { apiKey = process.env.ANTHROPIC_API_KEY, model = process.env.ANTHROPIC_MODEL || 'claude-sonnet-5-5', fetchImpl = fetch } = {}) {
  if (!apiKey) return { status: 501, error: 'Plate reading is not configured. Set ANTHROPIC_API_KEY on the server.' };
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(mediaType)) return { status: 400, error: 'Use a JPEG, PNG or WebP photo.' };
  if (typeof image !== 'string' || !/^[A-Za-z0-9+/]+={0,2}$/.test(image) || image.length % 4 !== 0 || image.length > 5_500_000) return { status: 400, error: 'Image must be base64 without the data: prefix.' };
  let r;
  try {
    r = await fetchImpl('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({ model, max_tokens: 1000, messages: [{ role: 'user', content: [
        { type: 'image', source: { type: 'base64', media_type: mediaType, data: image } },
        { type: 'text', text: PROMPT }] }] }),
      signal: AbortSignal.timeout(45000),
    });
  } catch (e) { return { status: 502, error: `Reading service unreachable: ${e.message}` }; }
  if (!r.ok) return { status: 502, error: `Reading service error ${r.status}.` };
  let fields;
  try { fields = parsePlateJson((await r.json()).content?.find((c) => c.type === 'text')?.text); }
  catch (e) { return { status: 502, error: 'Could not understand the plate photo. Try a sharper, closer photo.' }; }

  const warnings = [];
  const vin = fields.vin ? normalizeVin(fields.vin) : null;
  const vinValid = !!vin && isValidFormat(vin);
  if (!vin) warnings.push('No VIN found on the photo. Type it manually.');
  else if (!vinValid) warnings.push('The VIN read from the photo is not a valid 17-character VIN. Check it against the car.');
  else if (!checkDigitValid(vin)) warnings.push('The VIN check digit does not match. Re-check the VIN on the car (this is common for non-US cars).');
  if (Array.isArray(fields.unclear) && fields.unclear.length) warnings.push(`Not interpreted: ${fields.unclear.join(', ')}`);
  return { vin, vinValid, fields: { ...fields, vin }, warnings };
}
