const VPIC = 'https://vpic.nhtsa.dot.gov/api/vehicles';

async function getJson(url, fetchImpl, signal) {
  const r = await fetchImpl(url, { signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(10000)]) : AbortSignal.timeout(10000) });
  if (!r.ok) throw new Error(`upstream ${r.status}`);
  return r.json();
}

export async function decodeVin(vin, { fetchImpl = fetch, signal } = {}) {
  const j = await getJson(`${VPIC}/DecodeVinValues/${encodeURIComponent(vin)}?format=json`, fetchImpl, signal);
  const r = j.Results?.[0];
  if (!r || typeof r !== 'object') throw new Error('Invalid decoder response');
  const v = (k) => (r[k] != null && String(r[k]).trim() !== '' ? String(r[k]).trim() : null);
  return {
    make: v('Make'), model: v('Model'), year: v('ModelYear'), trim: v('Trim'),
    body: v('BodyClass'), plantCountry: v('PlantCountry'), decodeStatus: v('ErrorText'), decodeCode: v('ErrorCode'),
    components: {
      engine: { cylinders: v('EngineCylinders'), displacementL: v('DisplacementL'), hp: v('EngineHP'), fuel: v('FuelTypePrimary'), model: v('EngineModel') },
      transmission: { style: v('TransmissionStyle'), speeds: v('TransmissionSpeeds') },
      drivetrain: { driveType: v('DriveType') },
      brakes: { system: v('BrakeSystemType'), abs: v('ABS') },
      safety: { esc: v('ESC'), tpms: v('TPMS'), airbagsFront: v('AirBagLocFront'), airbagsSide: v('AirBagLocSide'), airbagsCurtain: v('AirBagLocCurtain'), airbagsKnee: v('AirBagLocKnee') },
    },
  };
}

export async function getRecalls({ make, model, year }, { fetchImpl = fetch, signal } = {}) {
  if (!make || !model || !/^\d{4}$/.test(year)) return null;
  const q = new URLSearchParams({ make, model, modelYear: year });
  const j = await getJson(`https://api.nhtsa.gov/recalls/recallsByVehicle?${q}`, fetchImpl, signal);
  if (!Array.isArray(j.results)) throw new Error('Invalid recall response');
  return j.results.map((x) => ({
    campaign: x.NHTSACampaignNumber, component: x.Component, summary: x.Summary,
    consequence: x.Consequence, remedy: x.Remedy, date: x.ReportReceivedDate,
  }));
}

export async function lookupPublicData(vin, options) {
  let vehicle;
  try {
    vehicle = await decodeVin(vin, options);
  } catch {
    return { vehicle: null, recalls: null, warnings: ['decoder_unavailable'] };
  }
  try {
    return { vehicle, recalls: await getRecalls(vehicle, options), warnings: [] };
  } catch {
    return { vehicle, recalls: null, warnings: ['recalls_unavailable'] };
  }
}
