const VPIC = 'https://vpic.nhtsa.dot.gov/api/vehicles';

async function getJson(url) {
  const r = await fetch(url, { signal: AbortSignal.timeout(10000) });
  if (!r.ok) throw new Error(`upstream ${r.status}`);
  return r.json();
}

export async function decodeVin(vin) {
  const j = await getJson(`${VPIC}/DecodeVinValues/${vin}?format=json`);
  const r = j.Results?.[0] || {};
  const v = (k) => (r[k] != null && String(r[k]).trim() !== '' ? String(r[k]).trim() : null);
  return {
    make: v('Make'), model: v('Model'), year: v('ModelYear'), trim: v('Trim'),
    body: v('BodyClass'), plantCountry: v('PlantCountry'), decodeStatus: v('ErrorText'),
    components: {
      engine: { cylinders: v('EngineCylinders'), displacementL: v('DisplacementL'), hp: v('EngineHP'), fuel: v('FuelTypePrimary'), model: v('EngineModel') },
      transmission: { style: v('TransmissionStyle'), speeds: v('TransmissionSpeeds') },
      drivetrain: { driveType: v('DriveType') },
      brakes: { system: v('BrakeSystemType'), abs: v('ABS') },
      safety: { esc: v('ESC'), tpms: v('TPMS'), airbagsFront: v('AirBagLocFront'), airbagsSide: v('AirBagLocSide'), airbagsCurtain: v('AirBagLocCurtain'), airbagsKnee: v('AirBagLocKnee') },
    },
  };
}

export async function getRecalls({ make, model, year }) {
  if (!make || !model || !year) return [];
  const q = new URLSearchParams({ make, model, modelYear: year });
  const j = await getJson(`https://api.nhtsa.gov/recalls/recallsByVehicle?${q}`);
  return (j.results || []).map((x) => ({
    campaign: x.NHTSACampaignNumber, component: x.Component, summary: x.Summary,
    consequence: x.Consequence, remedy: x.Remedy, date: x.ReportReceivedDate,
  }));
}
