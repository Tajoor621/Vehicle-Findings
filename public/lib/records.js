export const recordTypes = ['service', 'accident', 'inspection', 'mileage'];

export function normalizeRecord(record) {
  if (!record || !recordTypes.includes(record.type) || typeof record.date !== 'string' ||
      !/^\d{4}-\d{2}-\d{2}$/.test(record.date)) return null;
  const date = new Date(record.date);
  if (!Number.isFinite(date.valueOf()) || date.toISOString().slice(0, 10) !== record.date) return null;
  const mileage = record.mileage == null || record.mileage === '' ? null : Number(record.mileage);
  if ((mileage !== null && (!['string', 'number'].includes(typeof record.mileage) ||
      !String(record.mileage).trim() || !Number.isSafeInteger(mileage) || mileage < 0)) ||
      (record.type === 'mileage' && mileage === null)) return null;
  if ([record.note, record.source].some(value => value != null && typeof value !== 'string')) return null;
  return {
    type: record.type, date: record.date, mileage,
    note: (record.note ?? '').trim().slice(0, 500),
    source: (record.source ?? '').trim().slice(0, 80) || 'user',
  };
}
