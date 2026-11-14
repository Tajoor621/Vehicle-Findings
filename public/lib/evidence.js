import { vinBreakdown } from './vin.js';

const sources = {
  rkl: { label: 'RKL WMI directory', url: 'https://dot.report/wmi/RKL' },
  toyota: { label: 'Toyota Global · Kuozui', url: 'https://www.toyota-global.com/company/history_of_toyota/75years/data/automotive_business/production/production/overseas/overview/asia.html' },
  listing: { label: 'PLC Group · masked listing', url: 'https://plc.ua/autos/uae/lot/toyota-corolla-2014-vin-rklbb9he5e5-cm-76113086/' },
  family: { label: 'UAE Auto Auction · descriptor examples', url: 'https://www.uaeautoauction.com/automobile/toyota/corolla/2018' },
};

const manufacturers = {
  RKL: { manufacturer: 'Kuozui Motors, Ltd. (Toyota)', make: 'Toyota', country: 'Taiwan', sources: [sources.rkl, sources.toyota] },
};

// Curated leads describe the visible pattern only. They never populate decoded specifications or history.
const patterns = {
  'RKLBB9HE5E5': { make: 'Toyota', model: 'Corolla', year: '2014', sources: [sources.listing, sources.family] },
};

export function regionalEvidence(vin) {
  const breakdown = vinBreakdown(vin);
  if (!breakdown) return { manufacturer: null, pattern: null, context: null };
  const { wmi, masked } = breakdown;
  const matched = patterns[masked.slice(0, 11)];
  return {
    manufacturer: manufacturers[wmi] ?? null,
    pattern: matched ? { ...matched, masked } : null,
    context: matched && wmi === 'RKL' ? { sources: [sources.toyota] } : null,
  };
}
