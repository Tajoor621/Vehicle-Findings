import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { normalizeVin, isValidFormat, checkDigitValid, originFromVin, vinBreakdown, compareVinEvidence } from '../src/vin.js';
import { regionalEvidence } from '../public/lib/evidence.js';
import { lookupPublicData } from '../src/nhtsa.js';
import { normalizeRecord } from '../public/lib/records.js';
import { ar, en } from '../public/lib/strings.js';
import { normalizeInsurance, normalizeAccidents } from '../src/connectors.js';
import { createApp } from '../src/server.js';

const vin = '1M8GDM9AXKP042788';
const record = { type: 'service', date: '2026-01-15', mileage: 42000, note: 'Oil change' };
const decode = { Results: [{ Make: 'BMW', Model: 'X3', ModelYear: '2011', EngineCylinders: '6' }] };
const json = data => Response.json(data);

async function start(t, options = {}) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'vehicle-test-'));
  const dataFile = path.join(directory, 'records.json');
  const server = createApp({ dataFile, ...options });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => {
    await new Promise(resolve => server.close(resolve));
    await rm(directory, { recursive: true, force: true });
  });
  return { base: `http://127.0.0.1:${server.address().port}`, dataFile };
}

test('normalization handles copied spaces and Arabic digits without converting invalid letters', () => {
  assert.equal(normalizeVin(' ١m٨gdm٩axkp ٠٤٢٧٨٨ '), vin);
  assert.ok(isValidFormat(vin));
  assert.ok(checkDigitValid(vin));
  assert.ok(!checkDigitValid('1M8GDM9A1KP042788'));
  assert.ok(!isValidFormat('1M8GDM9AXKP04278O'));
  assert.ok(!isValidFormat(normalizeVin('1M8GDM9AßKP042788')));
  assert.equal(originFromVin('JTDKN3DU0A0123456').country, 'Japan');
  assert.equal(originFromVin('WBA3A5C50CF256985').region, 'Europe');
  assert.equal(originFromVin('bad').region, null);
});

test('records require a real calendar date and whole, non-negative kilometres', () => {
  assert.equal(normalizeRecord({ ...record, date: '2026-02-30' }), null);
  assert.equal(normalizeRecord({ ...record, mileage: 'Infinity' }), null);
  assert.equal(normalizeRecord({ ...record, type: 'mileage', mileage: '' }), null);
  assert.equal(normalizeRecord({ ...record, mileage: -1 }), null);
  assert.equal(normalizeRecord({ ...record, mileage: '0' }).mileage, 0);
});

test('recalls distinguish a zero result, a failed source and a missing vehicle match', async () => {
  const successful = await lookupPublicData(vin, { fetchImpl: async url => json(url.includes('DecodeVin') ? decode : { results: [] }) });
  assert.equal(successful.vehicle.components.engine.cylinders, '6');
  assert.deepEqual(successful.recalls, []);
  const outage = await lookupPublicData(vin, { fetchImpl: async url => json(url.includes('DecodeVin') ? decode : {}) });
  assert.equal(outage.recalls, null);
  assert.deepEqual(outage.warnings, ['recalls_unavailable']);
  const noMatch = await lookupPublicData(vin, { fetchImpl: async url => {
    assert.match(url, /DecodeVin/);
    return json({ Results: [{}] });
  } });
  assert.equal(noMatch.recalls, null);
  assert.deepEqual(noMatch.warnings, []);
});

test('static entry and modules are compatible with project Pages, and English and Arabic have matching labels', async t => {
  const { base } = await start(t);
  const html = await (await fetch(base)).text();
  assert.match(html, /\.\/public\/app.js/);
  for (const key of html.matchAll(/data-t="([^"]+)"/g)) assert.ok(en[key[1]], key[1]);
  assert.deepEqual(Object.keys(en).sort(), Object.keys(ar).sort());
  for (const asset of ['app.js', 'styles.css', 'lib/vin.js', 'lib/nhtsa.js', 'lib/evidence.js', 'lib/records.js', 'lib/strings.js']) {
    assert.equal((await fetch(`${base}/public/${asset}`)).status, 200);
  }
  assert.equal((await fetch(`${base}/src/server.js`)).status, 404);
});

test('API validates VINs and bodies, authorizes writes and keeps concurrent records', async t => {
  const { base, dataFile } = await start(t, { writeToken: 'test-token' });
  const url = `${base}/api/vin/${vin}/records`;
  const headers = { 'content-type': 'application/json', authorization: 'Bearer test-token' };
  const post = (body, requestHeaders = headers) => fetch(url, { method: 'POST', headers: requestHeaders, body });
  assert.equal((await fetch(`${base}/api/health`)).status, 200);
  assert.equal((await fetch(`${base}/api/vin/%E0`)).status, 400);
  assert.equal((await fetch(`${base}/api/vin/ABC`)).status, 400);
  assert.equal((await fetch(url, { method: 'DELETE' })).status, 405);
  assert.equal((await post(JSON.stringify(record), {})).status, 401);
  assert.equal((await post('{')).status, 400);
  assert.equal((await post(' '.repeat(11000))).status, 413);
  const writes = await Promise.all(['Oil change', 'Tyres'].map(note => post(JSON.stringify({ ...record, note }))));
  assert.deepEqual(writes.map(r => r.status), [201, 201]);
  const records = await (await fetch(url)).json();
  assert.deepEqual(records.map(row => row.note).sort(), ['Oil change', 'Tyres']);
  assert.deepEqual(JSON.parse(await readFile(dataFile))[vin], records);
});

test('API gives a partial report during upstream outages and requires explicit write configuration', async t => {
  const { base } = await start(t, { writeToken: '', fetchImpl: async () => { throw new Error('offline'); } });
  const url = `${base}/api/vin/${vin}`;
  const result = await (await fetch(url)).json();
  assert.equal(result.checks.checkDigit, true);
  assert.equal(result.vehicle, null);
  assert.equal(result.recalls, null);
  assert.equal(result.spec.gccSpec, 'unknown');
  assert.deepEqual(result.warnings, ['decoder_unavailable']);
  assert.equal((await fetch(`${url}/records`, { method: 'POST' })).status, 503);
});

test('connector data distinguishes unknown from a confirmed false', () => {
  assert.equal(normalizeInsurance({ expiry: 'invalid' }).status, 'unknown');
  assert.equal(normalizeAccidents([{ totalLoss: 'false' }])[0].totalLoss, null);
  assert.equal(normalizeAccidents([{ totalLoss: false }])[0].totalLoss, false);
  assert.throws(() => normalizeAccidents({ unexpected: [] }));
});

const screenshotVin = 'RKLBB9HE5E5020250';

test('screenshot VIN exposes its actual characters and a repeating year code', () => {
  assert.deepEqual(vinBreakdown(screenshotVin, 2050), {
    wmi: 'RKL', descriptor: 'BB9HE', checkCharacter: '5', expectedCheckDigit: '5',
    yearCode: 'E', candidateYears: [1984, 2014, 2044], plantCode: '5',
    sequence: '020250', masked: 'RKLBB9HE5E5******', lowVolumeWmi: null,
  });
  assert.equal(vinBreakdown('RKLBB9HE5U5020250').candidateYears.length, 0);
  assert.equal(vinBreakdown('RKLBB9HE5E502025O'), null);
  assert.equal(vinBreakdown('1T9131RX8SC123456').lowVolumeWmi, '1T9123');
});

test('listing comparison distinguishes prefix, exact match, and a conflicting VIN', () => {
  assert.equal(compareVinEvidence(screenshotVin, 'rklbb9he5e5******'), 'maskedMatch');
  assert.equal(compareVinEvidence(screenshotVin, 'RKLBB9HE5E5••••••'), 'maskedMatch');
  assert.equal(compareVinEvidence(screenshotVin, screenshotVin), 'fullMatch');
  assert.equal(compareVinEvidence(screenshotVin, 'RKLBB9HE5E5020251'), 'differentVin');
  assert.equal(compareVinEvidence(screenshotVin, 'RKLBB9HE5F5******'), 'differentVin');
  assert.equal(compareVinEvidence(screenshotVin, '*****************'), 'invalidEvidence');
});

test('regional evidence remains a lead and never generates an exact VIN spec, recall or history result', async () => {
  assert.equal(regionalEvidence(screenshotVin).manufacturer.country, 'Taiwan');
  assert.equal(regionalEvidence(screenshotVin).pattern.model, 'Corolla');
  assert.equal(regionalEvidence('RKLBB9HE5F5020250').pattern, null);
  assert.equal(regionalEvidence('RKLBB9HE4E5020250').pattern, null);
  const report = await lookupPublicData(screenshotVin, { fetchImpl: async url => {
    assert.match(url, /DecodeVinValues/);
    return json({ Results: [{ ErrorCode: '7', ErrorText: 'No US manufacturer record' }] });
  } });
  assert.equal(report.vehicle.make, null);
  assert.equal(report.vehicle.components.engine.displacementL, null);
  assert.equal(report.vehicle.plantCity, null);
  assert.equal(report.recalls, null);
  assert.equal(report.regional.pattern.masked, 'RKLBB9HE5E5******');
});

test('WMI fallback identifies the manufacturer separately from unverified vehicle specs', async () => {
  const report = await lookupPublicData(vin, { fetchImpl: async url => url.includes('DecodeWMI/1M8')
    ? json({ Results: [{ ManufacturerName: 'Example Manufacturer', Make: 'Example' }] })
    : json({ Results: [{}] }) });
  assert.equal(report.wmiEvidence.manufacturer, 'Example Manufacturer');
  assert.equal(report.vehicle.model, null);
  assert.equal(report.recalls, null);
});
