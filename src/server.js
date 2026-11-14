import http from 'node:http';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID, timingSafeEqual } from 'node:crypto';
import { normalizeVin, isValidFormat, checkDigitValid, originFromVin, vinBreakdown } from './vin.js';
import { lookupPublicData } from './nhtsa.js';
import { normalizeRecord } from '../public/lib/records.js';
import { runProviders } from './providers.js';
import { runConnectors } from './connectors.js';
import { readPlate } from './plate.js';

const appRoot = fileURLToPath(new URL('../', import.meta.url));
const assets = new Map([
  ['/', ['index.html', 'text/html']],
  ['/index.html', ['index.html', 'text/html']],
  ['/public/app.js', ['public/app.js', 'text/javascript']],
  ['/public/styles.css', ['public/styles.css', 'text/css']],
  ...['vin', 'nhtsa', 'records', 'strings', 'evidence'].map(name =>
    [`/public/lib/${name}.js`, [`public/lib/${name}.js`, 'text/javascript']]),
]);

function send(res, status, body, headers) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers });
  res.end(JSON.stringify(body));
}

class RequestError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function authorized(req, token) {
  if (!token) return false;
  const sent = Buffer.from(req.headers.authorization || '');
  const expected = Buffer.from(`Bearer ${token}`);
  return sent.length === expected.length && timingSafeEqual(sent, expected);
}

async function readBody(req, limit) {
  const reader = req.iterator({ destroyOnReturn: false });
  const chunks = [];
  let size = 0;
  for await (const chunk of reader) {
    size += chunk.length;
    if (size > limit) {
      // Drain the request while sending the rejection so the client gets a 413.
      req.resume();
      throw new RequestError(413, 'Request body is too large.');
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

function parseJson(body) {
  try { return JSON.parse(body.toString('utf8')); }
  catch { throw new RequestError(400, 'Invalid JSON body.'); }
}

function methodAllowed(res, method, allowed) {
  if (allowed.includes(method)) return true;
  send(res, 405, { error: 'Method not allowed.' }, { allow: allowed.join(', ') });
  return false;
}

export function createApp({
  dataFile = process.env.DATA_FILE || path.join(appRoot, 'data', 'records.json'),
  writeToken = process.env.WRITE_TOKEN || '',
  fetchImpl = fetch,
} = {}) {
  const cache = new Map();
  const pending = new Map();
  const hits = new Map();
  let lastPrune = 0;
  let records;
  let writes = Promise.resolve();

  function limited(ip) {
    const now = Date.now();
    if (now - lastPrune >= 60000) {
      for (const [key, entry] of hits) if (entry.until <= now) hits.delete(key);
      lastPrune = now;
    }
    let entry = hits.get(ip);
    if (!entry || entry.until <= now) {
      if (!hits.has(ip) && hits.size >= 10000) return true;
      entry = { count: 0, until: now + 60000 };
      hits.set(ip, entry);
    }
    return ++entry.count > 30;
  }

  async function loadRecords() {
    records ??= readFile(dataFile, 'utf8').then(text => {
      const db = JSON.parse(text);
      if (!db || typeof db !== 'object' || Array.isArray(db)) throw new Error('Invalid record store.');
      return db;
    }).catch(error => {
      if (error.code === 'ENOENT') return {};
      records = undefined;
      throw error;
    });
    return records;
  }

  function addRecord(vin, record) {
    const write = writes.then(async () => {
      const db = await loadRecords();
      const updated = { ...db, [vin]: [...(db[vin] ?? []), record] };
      const temporary = `${dataFile}.${randomUUID()}.tmp`;
      await mkdir(path.dirname(dataFile), { recursive: true });
      try {
        await writeFile(temporary, JSON.stringify(updated, null, 2), { mode: 0o600, flag: 'wx' });
        await rename(temporary, dataFile);
        records = Promise.resolve(updated);
      } finally {
        await rm(temporary, { force: true });
      }
    });
    writes = write.catch(() => {});
    return write;
  }

  function publicLookup(vin) {
    const cached = cache.get(vin);
    if (cached?.until > Date.now()) return cached.report;
    if (!pending.has(vin)) {
      pending.set(vin, lookupPublicData(vin, { fetchImpl }).then(report => {
        if (report.vehicle?.make && !report.warnings.length) {
          if (cache.size >= 500) cache.delete(cache.keys().next().value);
          cache.set(vin, { report, until: Date.now() + 86400000 });
        }
        return report;
      }).finally(() => pending.delete(vin)));
    }
    return pending.get(vin);
  }

  return http.createServer({
    requestTimeout: 30000,
    headersTimeout: 10000,
  }, async (req, res) => {
    res.setHeader('x-content-type-options', 'nosniff');
    try {
      const url = new URL(req.url, 'http://localhost');
      const asset = assets.get(url.pathname);
      if (asset) {
        if (!methodAllowed(res, req.method, ['GET', 'HEAD'])) return;
        const [file, type] = asset;
        const body = await readFile(path.join(appRoot, file));
        res.writeHead(200, { 'content-type': `${type}; charset=utf-8`, 'content-length': body.length });
        return res.end(req.method === 'HEAD' ? undefined : body);
      }
      if (url.pathname === '/api/health') {
        if (!methodAllowed(res, req.method, ['GET'])) return;
        return send(res, 200, { ok: true });
      }
      const match = url.pathname.match(/^\/api\/vin\/([^/]+)(\/records)?$/);
      const plate = url.pathname === '/api/plate';
      if (!match && !plate) return send(res, 404, { error: 'Not found.' });
      if (limited(req.socket.remoteAddress)) {
        res.setHeader('retry-after', '60');
        return send(res, 429, { error: 'Too many requests. Try again in a minute.' });
      }
      if (plate) {
        if (!methodAllowed(res, req.method, ['POST'])) return;
        if (!process.env.ANTHROPIC_API_KEY) return send(res, 501, { error: 'Hosted photo reading is disabled. Use the browser photo tools.' });
        if (!authorized(req, writeToken)) return send(res, 401, { error: 'Missing or wrong token.' });
        const type = req.headers['content-type'] || '';
        const raw = await readBody(req, 6_000_000);
        let input;
        if (/^multipart\/form-data\b/i.test(type)) {
          try {
            const photo = (await new Response(raw, { headers: { 'content-type': type } }).formData()).get('image');
            if (!photo || typeof photo === 'string') throw new Error();
            input = { image: Buffer.from(await photo.arrayBuffer()).toString('base64'), mediaType: photo.type };
          } catch {
            throw new RequestError(400, 'Upload an image in the image field.');
          }
        } else if (/^application\/json\b/i.test(type)) {
          input = parseJson(raw);
        } else {
          return send(res, 415, { error: 'Use multipart form data or JSON.' });
        }
        const result = await readPlate(input?.image, input?.mediaType, { fetchImpl });
        return send(res, result.status ?? 200, result);
      }
      let vin;
      try { vin = normalizeVin(decodeURIComponent(match[1])); }
      catch { throw new RequestError(400, 'Invalid VIN encoding.'); }
      if (!isValidFormat(vin)) return send(res, 400, { error: 'VIN must be 17 letters and digits, excluding I, O and Q.' });
      if (!methodAllowed(res, req.method, match[2] ? ['GET', 'POST'] : ['GET'])) return;

      if (req.method === 'POST') {
        if (!writeToken) return send(res, 503, { error: 'Record writes are disabled until WRITE_TOKEN is set.' });
        if (!authorized(req, writeToken)) return send(res, 401, { error: 'Missing or wrong token.' });
        const record = normalizeRecord(parseJson(await readBody(req, 10000)));
        if (!record) return send(res, 400, { error: 'Provide a supported record type, a valid date, and whole non-negative kilometres when required.' });
        await addRecord(vin, record);
        return send(res, 201, record);
      }

      const db = await loadRecords();
      const vehicleRecords = db[vin] || [];
      if (match[2]) return send(res, 200, vehicleRecords);
      const [{ vehicle, recalls, warnings, regional, wmiEvidence }, providers, connectors] = await Promise.all([
        publicLookup(vin), runProviders(vin, { fetchImpl }), runConnectors(vin, vehicleRecords, { fetchImpl }),
      ]);
      const { components, ...specs } = vehicle || {};
      return send(res, 200, {
        vin, checks: { format: true, checkDigit: checkDigitValid(vin) }, origin: originFromVin(vin),
        vehicle: vehicle ? specs : null, components: components ?? null, recalls, records: vehicleRecords,
        providers, ...connectors, spec: { gccSpec: 'unknown', note: 'Confirm GCC specification from the vehicle label or manufacturer.' },
        breakdown: vinBreakdown(vin), regional, wmiEvidence, warnings, generatedAt: new Date().toISOString(),
      });
    } catch (error) {
      if (res.headersSent || res.destroyed) return;
      if (!(error instanceof RequestError)) console.error(error);
      send(res, error.status || 500, { error: error instanceof RequestError ? error.message : 'The request could not be completed.' });
    }
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT || 3000);
  createApp().listen(port, process.env.HOST || '127.0.0.1', () => console.log(`Vehicle Findings listening on port ${port}`));
}
