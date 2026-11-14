const TRANSLIT = { A:1,B:2,C:3,D:4,E:5,F:6,G:7,H:8,J:1,K:2,L:3,M:4,N:5,P:7,R:9,S:2,T:3,U:4,V:5,W:6,X:7,Y:8,Z:9 };
const WEIGHTS = [8,7,6,5,4,3,2,10,0,9,8,7,6,5,4,3,2];

export const normalizeVin = (v) => String(v || '').trim().toUpperCase().replace(/\s+/g, '');
export const isValidFormat = (vin) => /^[A-HJ-NPR-Z0-9]{17}$/.test(vin);

// Check digit is mandatory for North American VINs only; others may legitimately fail it.
export function checkDigitValid(vin) {
  let sum = 0;
  for (let i = 0; i < 17; i++) {
    const c = vin[i];
    sum += (/\d/.test(c) ? Number(c) : TRANSLIT[c]) * WEIGHTS[i];
  }
  const r = sum % 11;
  return vin[8] === (r === 10 ? 'X' : String(r));
}

const COUNTRY = { J:'Japan', K:'South Korea', L:'China', W:'Germany', Z:'Italy', S:'United Kingdom',
  '1':'United States', '4':'United States', '5':'United States', '2':'Canada', '3':'Mexico',
  '6':'Australia', V:'France/Spain', Y:'Sweden/Finland', T:'Czechia/Hungary/Switzerland', M:'India/Thailand/Indonesia', R:'Taiwan/UAE' };

// Approximate: first VIN character identifies the manufacturing region/country.
export function originFromVin(vin) {
  const c = vin[0];
  const region = /[1-5]/.test(c) ? 'North America' : /[67]/.test(c) ? 'Oceania' : /[89]/.test(c) ? 'South America'
    : /[A-H]/.test(c) ? 'Africa' : /[J-R]/.test(c) ? 'Asia' : 'Europe';
  return { country: COUNTRY[c] || null, region, wmi: vin.slice(0, 3), accuracy: 'approximate' };
}
