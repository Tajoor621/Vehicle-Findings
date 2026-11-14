import { normalizeVin, isValidFormat, checkDigitValid, originFromVin, vinBreakdown, compareVinEvidence } from './lib/vin.js';
import { lookupPublicData } from './lib/nhtsa.js';
import { normalizeRecord } from './lib/records.js';
import { en, ar } from './lib/strings.js';

const $ = id => document.getElementById(id);
const words = { en, ar };
const messages = new Map();
const maxRecords = 500;
let lang = navigator.language?.startsWith('ar') ? 'ar' : 'en';
try {
  const previous = localStorage.getItem('lang');
  if (previous === 'ar' || previous === 'en') lang = previous;
} catch {}
const t = key => words[lang][key] ?? key;
let vin;
let report;
let controller;
let serviceAvailable = false;
let camera;
let photo;
let ocrRead;
let photoUrl;
let photoRotation = 0;
let libraryPromise;

function el(tag, text, className) {
  const element = document.createElement(tag);
  if (text != null) element.textContent = text;
  if (className) element.className = className;
  return element;
}

function status(id, key, error = false) {
  messages.set(id, { key, error });
  const node = $(id);
  node.hidden = !key;
  node.className = error ? 'msg err' : 'quiet';
  node.textContent = key ? t(key) : '';
}

function updateLanguage() {
  document.documentElement.lang = lang;
  document.documentElement.dir = lang === 'ar' ? 'rtl' : 'ltr';
  for (const node of document.querySelectorAll('[data-t]')) node.textContent = t(node.dataset.t);
  $('lang').textContent = lang === 'en' ? 'العربية' : 'English';
  $('lang').lang = lang === 'en' ? 'ar' : 'en';
  $('moi').href = `https://portal.moi.gov.ae/eservices/PublicServices/AccidentsInquiry.aspx?Culture=${lang}`;
  $('toyotaRecallLink').href = `https://www.toyota.ae/${lang}/articles/recall-takata/`;
  $('scan').textContent = t(camera ? 'stopScan' : 'scan');
  if (report) renderReport();
  if (vin) renderLog();
  for (const [id, { key, error }] of messages) status(id, key, error);
}

function section(title, ...nodes) {
  const box = el('section');
  box.append(el('h2', t(title)), ...nodes);
  return box;
}

function fields(values) {
  const list = el('dl');
  for (const [key, value] of Object.entries(values)) {
    if (value == null || value === '') continue;
    const field = el('dd', value);
    field.dir = 'auto';
    list.append(el('dt', t(key)), field);
  }
  return list;
}

function entry(heading, ...nodes) {
  const item = el('div', null, 'item');
  item.dir = 'auto';
  item.append(el('b', heading), ...nodes);
  return item;
}

function paragraphs(values) {
  return Object.entries(values).filter(([, value]) => value).map(([key, value]) => el('p', `${t(key)}: ${value}`));
}

function connectedSections(data) {
  if (!data.records) return [];
  const sections = [];
  if (data.records.length) {
    sections.push(section('workshopRecords', ...data.records.map(record => entry(recordTitle(record), el('span', record.note), ...paragraphs({ source: record.source })))));
  }
  const { insurance, accidents } = data;
  if (insurance && insurance.status !== 'not_connected') {
    const { status: state, insurer, policyType, expiry } = insurance;
    sections.push(section('insurance', state === 'error' ? el('p', t('sourceError')) : fields({ status: t(state), insurer, policyType, expiry })));
  }
  if (accidents && (accidents.status !== 'not_connected' || accidents.items.length)) {
    const items = accidents.items.map(item => entry(item.date ?? t('unknown'), el('span', item.description), ...paragraphs({
      severity: item.severity, totalLoss: t(item.totalLoss == null ? 'unknown' : item.totalLoss ? 'yes' : 'no'), source: item.source,
    })));
    if (accidents.status !== 'ok') items.unshift(el('p', t(accidents.status === 'error' ? 'sourceError' : 'sourceNotConnected')));
    if (!items.length) items.push(el('p', t('connectedEmpty')));
    sections.push(section('accidents', ...items));
  }
  for (const provider of data.providers || []) {
    const box = el('section');
    box.append(el('h2', provider.name), provider.ok ? el('pre', JSON.stringify(provider.data, null, 2)) : el('p', t('sourceError')));
    sections.push(box);
  }
  return sections;
}

function evidenceLinks(...sources) {
  const list = el('ul', null, 'links');
  for (const { label, url } of sources) {
    const link = el('a', label);
    link.href = url;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    const item = el('li');
    item.append(link);
    list.append(item);
  }
  return list;
}

function breakdownSection() {
  const parts = vinBreakdown(vin);
  const origin = originFromVin(vin);
  return section('breakdown', el('p', t('structureScope'), 'quiet'), fields({
    wmi: parts.wmi, lowVolumeWmi: parts.lowVolumeWmi, region: origin.region, country: origin.country,
    descriptor: parts.descriptor, checkCharacter: parts.checkCharacter, expected: parts.expectedCheckDigit,
    digit: t(checkDigitValid(vin) ? 'digitYes' : 'digitNo'),
    structureYear: parts.yearCode, yearCandidates: parts.candidateYears.join(' / ') || t('noYearCode'),
    plantCode: parts.plantCode, sequence: parts.sequence, maskedVin: parts.masked,
  }), el('p', t('yearScope'), 'quiet'), evidenceLinks({
    label: t('vinRules'), url: 'https://www.law.cornell.edu/cfr/text/49/565.25',
  }));
}

function renderReport() {
  const { vehicle, recalls, warnings, regional, wmiEvidence } = report;
  const { make, model, year, trim, body, manufacturer, vehicleType, plantCountry, plantCity, plantState, plantCompany, ...details } = vehicle || {};
  const identification = section('vehicle', fields({ vin }));
  for (const warning of warnings || []) identification.append(el('p', t(warning), 'msg'));
  const facts = fields({ make, model, year, trim, body, manufacturer, vehicleType, plantCountry, plantCity, plantState, plantCompany });
  if (facts.children.length) {
    identification.append(facts, evidenceLinks({ label: t('officialDecode'), url: 'https://vpic.nhtsa.dot.gov/decoder/' }));
  }
  if (vehicle && !(make && model)) identification.append(el('p', t('unknownVehicle')));
  if (details.decodeStatus && details.decodeCode?.split(',').some(code => code.trim() !== '0')) {
    const warning = el('p', t('uncertain'), 'msg');
    warning.append(el('small', details.decodeStatus));
    identification.append(warning);
  }
  identification.append(el('p', t('decodeScope'), 'quiet'));

  const evidence = [];
  if (wmiEvidence) {
    const { country, ...wmi } = wmiEvidence;
    evidence.push(section('vpicWmi', fields({ ...wmi, manufacturerCountry: country }),
      evidenceLinks({ label: t('vpicWmi'), url: 'https://vpic.nhtsa.dot.gov/mid/home' })));
  }
  if (regional?.manufacturer) {
    const { country, sources, ...wmi } = regional.manufacturer;
    evidence.push(section('regionalWmi', fields({ ...wmi, manufacturerCountry: country }), evidenceLinks(...sources)));
  }
  if (regional?.pattern) {
    const { sources, masked, ...pattern } = regional.pattern;
    const lead = section('listingLead', fields({ ...pattern, maskedVin: masked }), el('p', t('listingScope'), 'msg'));
    if (regional.context) lead.append(el('p', t('productionContext')));
    lead.append(evidenceLinks(...sources));
    evidence.push(lead);
  }
  const prefix = vinBreakdown(vin).masked.slice(0, 11);
  const query = new URLSearchParams({ q: `"${prefix}" VIN auction` });
  $('searchPrefix').href = `https://www.google.com/search?${query}`;
  $('listingSearch').hidden = false;
  $('toyotaRecall').hidden = ![make, wmiEvidence?.make, regional?.manufacturer?.make]
    .some(value => value?.toLowerCase() === 'toyota');

  const specs = report.components || details.components || {};
  const components = [];
  for (const [key, values] of Object.entries(specs)) {
    const list = fields(values);
    if (list.children.length) components.push(el('h3', t(key)), list);
  }
  const missing = Object.entries({
    make: make || wmiEvidence?.make || regional?.manufacturer?.make, model, year, body, engineSize: specs.engine?.displacementL, fuelType: specs.engine?.fuel,
    transmissionType: specs.transmission?.style, assemblyPlant: plantCity || plantCompany,
  }).filter(([, value]) => !value).map(([key]) => t(key));
  const missingSection = missing.length ? [section('missingSpecs', el('p', missing.join(' · ')), el('p', t('missingSpecsScope'), 'quiet'))] : [];
  const campaigns = recalls?.length
    ? recalls.map(item => entry(item.component ?? t('campaign'), el('span', item.summary), ...paragraphs({
      campaign: item.campaign, date: item.date, consequence: item.consequence, remedy: item.remedy,
    })))
    : [el('p', t(recalls ? 'noRecalls' : 'recallUnavailable'))];
  const history = section('historyStatus', fields(Object.fromEntries(
    ['historyAccident', 'historyOdometer', 'historyGcc', 'historyInsurance'].map(key => [key, t('separateCheck')])
  )));
  $('report').replaceChildren(identification, ...evidence, breakdownSection(),
    ...(components.length ? [section('components', ...components)] : []), ...missingSection,
    section('recalls', el('p', t('recallScope'), 'quiet'), ...campaigns), history, ...connectedSections(report));
}

const backend = !location.hostname.endsWith('.github.io')
  ? fetch('./api/health', { signal: AbortSignal.timeout(2500) }).then(async response => {
    if (response.ok && response.headers.get('content-type')?.startsWith('application/json')) {
      serviceAvailable = (await response.json()).ok === true;
    }
  }).catch(() => {})
  : Promise.resolve();

$('lookup').addEventListener('submit', async event => {
  event.preventDefault();
  controller?.abort();
  const next = normalizeVin($('vin').value);
  $('results').hidden = true;
  report = null;
  vin = undefined;
  $('addRecord').reset();
  $('compareEvidence').reset();
  $('toyotaRecall').hidden = true;
  $('listingSearch').hidden = true;
  status('evidenceStatus', null);
  status('recordStatus', null);
  if (!isValidFormat(next)) {
    $('vin').setAttribute('aria-invalid', 'true');
    status('lookupStatus', 'invalidVin', true);
    $('vin').focus();
    return;
  }
  $('vin').removeAttribute('aria-invalid');
  $('vin').value = next;
  stopCamera();
  const current = new AbortController();
  controller = current;
  status('lookupStatus', 'loading');
  await backend;
  if (current.signal.aborted) return;
  let result;
  if (serviceAvailable) {
    try {
      const response = await fetch(`./api/vin/${next}`, { signal: AbortSignal.any([current.signal, AbortSignal.timeout(23000)]) });
      if (response.ok) result = await response.json();
    } catch {}
  }
  if (current.signal.aborted) return;
  result ??= await lookupPublicData(next, { signal: current.signal });
  if (current.signal.aborted) return;
  vin = next;
  report = result;
  renderReport();
  renderLog();
  $('results').hidden = false;
  status('lookupStatus', result.vehicle?.make && result.vehicle.model && result.vehicle.year ? 'ready' : 'partial');
});

$('compareEvidence').addEventListener('submit', event => {
  event.preventDefault();
  if (!vin) return;
  const comparison = compareVinEvidence(vin, $('evidenceVin').value);
  status('evidenceStatus', comparison, comparison === 'differentVin' || comparison === 'invalidEvidence');
});

$('vin').addEventListener('input', () => $('vin').removeAttribute('aria-invalid'));
$('lang').addEventListener('click', () => {
  lang = lang === 'en' ? 'ar' : 'en';
  try { localStorage.setItem('lang', lang); } catch {}
  updateLanguage();
});

function logKey(forVin = vin) {
  return `vehicle-findings:records:${forVin}`;
}

function logEntries(forVin = vin) {
  const rows = JSON.parse(localStorage.getItem(logKey(forVin)) ?? '[]');
  if (!Array.isArray(rows) || rows.some(row => !normalizeRecord(row))) throw new Error('Invalid log');
  return rows.map(normalizeRecord);
}

function saveLog(rows, success) {
  if (rows.length > maxRecords) return status('recordStatus', 'maxRecords', true);
  try { localStorage.setItem(logKey(), JSON.stringify(rows)); }
  catch { return status('recordStatus', 'cannotWriteLog', true); }
  renderLog();
  status('recordStatus', success);
}

function recordTitle(record) {
  const km = record.mileage == null ? '' : ` · ${new Intl.NumberFormat(lang).format(record.mileage)} km`;
  return `${record.date} · ${t(record.type)}${km}`;
}

function renderLog() {
  const list = $('recordList');
  list.replaceChildren();
  $('recordEmpty').hidden = true;
  let rows;
  try { rows = logEntries(); }
  catch { return status('recordStatus', 'cannotReadLog', true); }
  $('recordEmpty').hidden = rows.length > 0;
  const ordered = rows.map((record, index) => ({ record, index })).sort((a, b) => b.record.date.localeCompare(a.record.date));
  for (const { record, index } of ordered) {
    const item = el('li', recordTitle(record));
    if (record.note) item.append(el('p', record.note, 'quiet'));
    const remove = el('button', t('remove'), 'lang');
    remove.type = 'button';
    remove.setAttribute('aria-label', `${t('remove')} ${recordTitle(record)}`);
    const displayedVin = vin;
    remove.addEventListener('click', () => {
      if (vin !== displayedVin) return;
      try {
        const current = logEntries();
        if (JSON.stringify(current[index]) === JSON.stringify(record)) {
          saveLog(current.filter((_, i) => i !== index), 'deleted');
        } else renderLog();
      } catch { status('recordStatus', 'cannotReadLog', true); }
    });
    item.append(remove);
    list.append(item);
  }
}

$('addRecord').addEventListener('submit', event => {
  event.preventDefault();
  if (!vin) return;
  const record = normalizeRecord(Object.fromEntries(new FormData(event.target)));
  if (!record) return status('recordStatus', 'invalidRecord', true);
  try { saveLog([...logEntries(), record], 'saved'); }
  catch { status('recordStatus', 'cannotReadLog', true); }
});

$('exportLog').addEventListener('click', () => {
  if (!vin) return;
  try {
    const blob = new Blob([JSON.stringify({ version: 1, vin, records: logEntries() }, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = el('a');
    link.href = url;
    link.download = `vehicle-${vin}.json`;
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
  } catch { status('recordStatus', 'cannotReadLog', true); }
});

$('importLog').addEventListener('click', () => $('logFile').click());
$('logFile').addEventListener('change', async event => {
  const file = event.target.files[0];
  const importingVin = vin;
  event.target.value = '';
  if (!file || !importingVin) return;
  let incoming;
  try {
    if (file.size > 2_000_000) throw new Error();
    const data = JSON.parse(await file.text());
    if (data.version !== 1 || data.vin !== importingVin || !Array.isArray(data.records) || data.records.length > maxRecords) throw new Error();
    incoming = data.records.map(normalizeRecord);
    if (incoming.includes(null)) throw new Error();
  } catch {
    if (vin === importingVin) status('recordStatus', 'invalidImport', true);
    return;
  }
  if (vin !== importingVin) return;
  try {
    const all = new Map([...logEntries(), ...incoming].map(record => [JSON.stringify(record), record]));
    saveLog([...all.values()], 'imported');
  } catch { status('recordStatus', 'cannotReadLog', true); }
});

window.addEventListener('storage', event => {
  if (vin && (event.key === null || event.key === logKey())) renderLog();
});

function stopCamera() {
  if (!camera) return;
  clearTimeout(camera.timer);
  camera.stream?.getTracks().forEach(track => track.stop());
  camera = undefined;
  $('cam').srcObject = null;
  $('cam').hidden = true;
  $('scan').textContent = t('scan');
  status('inputStatus', null);
}

function vinFromText(text) {
  const normalized = text.toUpperCase().replace(/[٠-٩۰-۹]/g, digit => String(digit.charCodeAt(0) & 15));
  const candidates = new Set([...normalized.matchAll(/(?:^|[^A-Z0-9])([A-HJ-NPR-Z0-9]{17})(?![A-Z0-9])/g)].map(match => match[1]));
  const compact = normalizeVin(text);
  if (isValidFormat(compact)) candidates.add(compact);
  return candidates.size === 1 ? [...candidates][0] : null;
}

$('scan').addEventListener('click', async () => {
  if (camera) return stopCamera();
  if (!window.BarcodeDetector || !navigator.mediaDevices?.getUserMedia) return status('inputStatus', 'cameraUnavailable', true);
  closePhoto();
  const session = {};
  camera = session;
  $('scan').textContent = t('stopScan');
  try {
    const formats = (await BarcodeDetector.getSupportedFormats()).filter(format => ['code_39', 'code_128', 'data_matrix', 'qr_code'].includes(format));
    if (camera !== session) return;
    if (!formats.length) throw new Error();
    const detector = new BarcodeDetector({ formats });
    const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } } });
    if (camera !== session) return stream.getTracks().forEach(track => track.stop());
    session.stream = stream;
    const video = $('cam');
    video.srcObject = stream;
    video.hidden = false;
    await video.play();
    if (camera !== session) return;
    status('inputStatus', 'scanning');
    const scanFrame = async () => {
      if (camera !== session) return;
      try {
        for (const code of await detector.detect(video)) {
          if (camera !== session) return;
          const match = vinFromText(code.rawValue);
          if (!match) continue;
          $('vin').value = match;
          stopCamera();
          $('lookup').requestSubmit();
          return;
        }
      } catch {
        if (camera !== session) return;
      }
      session.timer = setTimeout(scanFrame, 350);
    };
    await scanFrame();
  } catch {
    if (camera !== session) return;
    stopCamera();
    status('inputStatus', 'cameraUnavailable', true);
  }
});

const ocrBase = 'https://cdn.jsdelivr.net/npm/tesseract.js@6.0.1/dist';
function ocrLibrary() {
  libraryPromise ??= new Promise((resolve, reject) => {
    const script = el('script');
    script.src = `${ocrBase}/tesseract.min.js`;
    script.crossOrigin = 'anonymous';
    script.referrerPolicy = 'no-referrer';
    const timer = setTimeout(reject, 20000);
    script.onload = () => { clearTimeout(timer); resolve(window.Tesseract); };
    script.onerror = () => { clearTimeout(timer); reject(); };
    document.head.append(script);
  }).catch(error => {
    libraryPromise = undefined;
    throw error;
  });
  return libraryPromise;
}

function cancelOcr() {
  const read = ocrRead;
  ocrRead = undefined;
  read?.cancel();
  if (read?.worker) void read.worker.terminate().catch(() => {});
}

function closePhoto() {
  cancelOcr();
  if (photoUrl) URL.revokeObjectURL(photoUrl);
  photoUrl = undefined;
  photo = undefined;
  $('preview').removeAttribute('src');
  $('preview').hidden = true;
  $('photoPanel').hidden = true;
  $('plateText').value = '';
  status('inputStatus', null);
}

function plateCanvas(image) {
  const scale = Math.min(1, 1800 / Math.max(image.naturalWidth, image.naturalHeight));
  const width = Math.max(1, Math.round(image.naturalWidth * scale));
  const height = Math.max(1, Math.round(image.naturalHeight * scale));
  const canvas = document.createElement('canvas');
  const swap = photoRotation % 180 !== 0;
  canvas.width = swap ? height : width;
  canvas.height = swap ? width : height;
  const context = canvas.getContext('2d');
  context.fillStyle = 'white';
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.translate(canvas.width / 2, canvas.height / 2);
  context.rotate(photoRotation * Math.PI / 180);
  context.drawImage(image, -width / 2, -height / 2, width, height);
  return canvas;
}

async function readPhoto(languages) {
  if (!photo) return;
  cancelOcr();
  const read = {};
  ocrRead = read;
  let timer;
  const deadline = new Promise((_, reject) => {
    timer = setTimeout(reject, 60000);
    read.cancel = reject;
  });
  status('inputStatus', 'photoLoading');
  try {
    const library = await Promise.race([ocrLibrary(), deadline]);
    if (ocrRead !== read) return;
    const image = plateCanvas(photo);
    const starting = library.createWorker(languages, 1, {
      workerPath: `${ocrBase}/worker.min.js`,
      corePath: 'https://cdn.jsdelivr.net/npm/tesseract.js-core@6.0.0',
      langPath: 'https://tessdata.projectnaptha.com/4.0.0',
      errorHandler: error => read.cancel(error),
    }).then(worker => {
      if (ocrRead !== read) void worker.terminate().catch(() => {});
      else read.worker = worker;
      return worker;
    });
    const worker = await Promise.race([starting, deadline]);
    status('inputStatus', 'photoReading');
    const { data } = await Promise.race([worker.recognize(image), deadline]);
    if (ocrRead !== read) return;
    if (!data.text?.trim()) throw new Error();
    $('plateText').value = data.text.trim();
    status('inputStatus', 'photoReady');
  } catch {
    if (ocrRead === read) status('inputStatus', 'photoFailure', true);
  } finally {
    clearTimeout(timer);
    if (ocrRead === read) cancelOcr();
  }
}

$('photo').addEventListener('click', () => {
  stopCamera();
  if ($('photoPanel').hidden) $('photoFile').click();
  else $('plateText').focus();
});
$('choosePhoto').addEventListener('click', () => $('photoFile').click());
$('closePhoto').addEventListener('click', () => { closePhoto(); $('photo').focus(); });
$('rotate').addEventListener('click', () => {
  if (!photo) return;
  photoRotation = (photoRotation + 90) % 360;
  $('preview').src = plateCanvas(photo).toDataURL('image/jpeg', .85);
  void readPhoto('eng');
});
$('readArabic').addEventListener('click', () => void readPhoto(['eng', 'ara']));
$('photoFile').addEventListener('change', async event => {
  const file = event.target.files[0];
  event.target.value = '';
  if (!file) return;
  stopCamera();
  closePhoto();
  $('photoPanel').hidden = false;
  $('rotate').disabled = true;
  $('readArabic').disabled = true;
  if ((file.type && !file.type.startsWith('image/')) || file.size > 20_000_000) return status('inputStatus', 'photoInvalid', true);
  const url = URL.createObjectURL(file);
  photoUrl = url;
  const image = new Image();
  image.src = url;
  try { await image.decode(); }
  catch {
    if (photoUrl === url) status('inputStatus', 'photoFailure', true);
    return;
  }
  if (photoUrl !== url) return;
  photo = image;
  photoRotation = 0;
  $('preview').src = url;
  $('preview').hidden = false;
  $('rotate').disabled = false;
  $('readArabic').disabled = false;
  void readPhoto('eng');
});
$('usePhotoVin').addEventListener('click', () => {
  const match = vinFromText($('plateText').value);
  if (!match) return status('inputStatus', 'noPhotoVin', true);
  $('vin').value = match;
  $('vin').removeAttribute('aria-invalid');
  $('vin').focus();
});
window.addEventListener('pagehide', () => { stopCamera(); closePhoto(); });
updateLanguage();
