import { vinBreakdown } from './vin.js?v=2';
import { regionalEvidence } from './evidence.js';

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
  const v = key => {
    const value = r[key];
    return typeof value === 'string' || typeof value === 'number' ? String(value).trim() || null : null;
  };
  return {
    make: v('Make'), model: v('Model'), year: v('ModelYear'), trim: v('Trim'),
    body: v('BodyClass'), manufacturer: v('Manufacturer'), vehicleType: v('VehicleType'),
    plantCountry: v('PlantCountry'), plantCity: v('PlantCity'), plantState: v('PlantState'), plantCompany: v('PlantCompanyName'), decodeStatus: v('ErrorText'), decodeCode: v('ErrorCode'),
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

async function lookupManufacturer(vin, { fetchImpl = fetch, signal } = {}) {
  const breakdown = vinBreakdown(vin);
  if (!breakdown) return null;
  const wmi = breakdown.lowVolumeWmi || breakdown.wmi;
  const data = await getJson(`${VPIC}/DecodeWMI/${wmi}?format=json`, fetchImpl, signal);
  const entries = Array.isArray(data.Results) ? data.Results : [];
  function unique(key) {
    const values = new Set(entries.map(row => row?.[key]).filter(value => typeof value === 'string' && value.trim()).map(value => value.trim()));
    return values.size === 1 ? [...values][0] : null;
  }
  const manufacturer = unique('ManufacturerName');
  if (!manufacturer) return null;
  return { manufacturer, make: unique('Make'), country: unique('Country'), vehicleType: unique('VehicleType') };
}

export async function lookupPublicData(vin, options) {
  let vehicle = null;
  const warnings = [];
  const regional = regionalEvidence(vin);
  try {
    vehicle = await decodeVin(vin, options);
  } catch {
    warnings.push('decoder_unavailable');
  }
  if (options?.signal?.aborted) return { vehicle, recalls: null, warnings, regional, wmiEvidence: null };
  const [wmiEvidence, recalls] = await Promise.all([
    vehicle?.manufacturer || regional.manufacturer ? null : lookupManufacturer(vin, options).catch(() => null),
    vehicle ? getRecalls(vehicle, options).catch(() => {
      warnings.push('recalls_unavailable');
      return null;
    }) : null,
  ]);
  return { vehicle, recalls, warnings, regional, wmiEvidence };
}
