/* ==================== UPLOADWACHTRIJ (achtergrond) ====================
   [20261013b] Trainingen worden niet meer in een venster verwerkt waar je
   niet uit weg mag klikken, maar in een wachtrij die op de achtergrond loopt:

   - Elke upload (één PDF, meerdere PDF's per groep, of een heel blok) wordt
     een "job" met items. Na het instellen sluit het venster en loopt de rest
     vanzelf, terwijl de admin gewoon verder klikt in de app.
   - Items worden met drie tegelijk verwerkt (PDF lezen → origineel + diagrammen
     opslaan → AI → score). Keurt de AI-controle het goed (training-ai.js
     scoreGoed), dan wordt de training meteen gedeeld; anders blijft hij als
     "afwijker" in de rij staan tot de admin hem bekijkt.
   - Jobs, bestanden en AI-resultaten staan ook in IndexedDB op dit apparaat.
     Wordt de pagina ververst of de app gesloten, dan staat de rij er bij
     terugkomst nog ("onderbroken – verder gaan"). Een blok dat nog wordt
     ingesteld bewaren we als concept.
   - Voortgang: een blok bovenaan Clubbeheer → Trainingen (#uqPaneel) en een
     klein label rechtsonder dat overal in de app zichtbaar is.

   club.js geeft via initWachtrij() de schermen mee die daar wonen (preview,
   alleen-PDF, navigatie, concept hervatten), zodat er geen kringimport is.
   Geen wijziging aan het Firestore-model: een gedeelde training is exact
   hetzelfde document als via de oude flow. */
import {
  db, storage, collection, addDoc, serverTimestamp, sRef, uploadBytes, getDownloadURL, deleteObject
} from './firebase.js?v=20260922c';
import { S, esc, meld, openModal, sluitModal } from './state.js?v=20261023a';
import { telGebruik } from './tracker.js?v=20261023a';

/* [20261013c] AI-model per upload. Alleen een sleutel; de Cloud Function
   structureerTraining koppelt die aan een model (whitelist). */
export const AI_MODELLEN = [
  { id:'standaard',  label:'Standaard (snel en goedkoop)' },
  { id:'nauwkeurig', label:'Nauwkeuriger (trager, ongeveer 3× duurder)' },
];
export function htmlModelKeuze(id, gekozen = 'standaard'){
  return `<div class="veldgroep"><label for="${id}">AI-model</label>
    <select class="invoer" id="${id}">${AI_MODELLEN.map(m =>
      `<option value="${m.id}" ${m.id === gekozen ? 'selected' : ''}>${m.label}</option>`).join('')}</select>
    <p class="bp-hint">Geldt alleen voor deze upload. De volgende keer staat het weer op standaard.</p></div>`;
}

let ctx = {};
const jobs = [];                       // in geheugen, oudste eerst
const bestandCache = new Map();        // `${jobId}:${idx}` → File
const luisteraars = new Set();
let geladen = null;
let loopt = false;

/* ---------- IndexedDB (best effort: zonder IDB werkt alles, alleen niet na herladen) ---------- */
const DB_NAAM = 'cluppie-uploads';
let dbBelofte = null;
function idb(){
  if (!('indexedDB' in window)) return Promise.reject(new Error('geen IndexedDB'));
  if (!dbBelofte) dbBelofte = new Promise((ok, nok) => {
    const r = indexedDB.open(DB_NAAM, 1);
    r.onupgradeneeded = () => {
      const d = r.result;
      if (!d.objectStoreNames.contains('jobs')) d.createObjectStore('jobs', { keyPath:'id' });
      if (!d.objectStoreNames.contains('bestanden')) d.createObjectStore('bestanden');
    };
    r.onsuccess = () => ok(r.result);
    r.onerror = () => { dbBelofte = null; nok(r.error); };
  });
  return dbBelofte;
}
async function opslag(store, mode, fn){
  try {
    const d = await idb();
    return await new Promise((ok, nok) => {
      const t = d.transaction(store, mode);
      const req = fn(t.objectStore(store));
      t.oncomplete = () => ok(req ? req.result : undefined);
      t.onerror = () => nok(t.error);
      t.onabort = () => nok(t.error);
    });
  } catch(e){
    if (!opslag._gemeld){ opslag._gemeld = true; console.warn('[wachtrij] opslag op dit apparaat niet gelukt; de rij werkt alleen tot herladen', e); }
    return undefined;
  }
}
const sleutel = (jobId, idx) => `${jobId}:${idx}`;
function bewaarJob(job){
  return opslag('jobs', 'readwrite', s => s.put(job));
}
async function bewaarBestand(jobId, idx, file){
  bestandCache.set(sleutel(jobId, idx), file);
  await opslag('bestanden', 'readwrite', s => s.put(file, sleutel(jobId, idx)));
}
export async function leesBestand(jobId, idx, naam){
  const k = sleutel(jobId, idx);
  if (bestandCache.has(k)) return bestandCache.get(k);
  const blob = await opslag('bestanden', 'readonly', s => s.get(k));
  if (!blob) return null;
  const file = blob instanceof File ? blob : new File([blob], naam || 'training.pdf', { type:'application/pdf' });
  bestandCache.set(k, file);
  return file;
}
async function wisBestand(jobId, idx){
  bestandCache.delete(sleutel(jobId, idx));
  await opslag('bestanden', 'readwrite', s => s.delete(sleutel(jobId, idx)));
}
async function wisJob(job){
  const i = jobs.indexOf(job); if (i >= 0) jobs.splice(i, 1);
  await Promise.all((job.items || []).map(it => wisBestand(job.id, it.idx)));
  await opslag('jobs', 'readwrite', s => s.delete(job.id));
}

/* ---------- Opstarten ---------- */
export function initWachtrij(c){
  ctx = c || {};
  if (!geladen) geladen = laadOpgeslagen();
  if (!initWachtrij._klik){
    initWachtrij._klik = true;
    document.addEventListener('click', klik);
  }
  return geladen;
}
async function laadOpgeslagen(){
  const opgeslagen = await opslag('jobs', 'readonly', s => s.getAll()) || [];
  for (const job of opgeslagen.sort((a, b) => (a.gemaakt || 0) - (b.gemaakt || 0))){
    if (jobs.some(j => j.id === job.id)) continue;
    (job.items || []).forEach(it => { if (it.status === 'bezig') it.status = 'wacht'; });
    if (!job.concept && job.items.some(it => it.status === 'wacht')) job.gepauzeerd = true;
    if (!job.concept && !openstaand(job)){ await opslag('jobs', 'readwrite', s => s.delete(job.id)); continue; }
    jobs.push(job);
  }
  wijziging();
}

/* ---------- Publieke API voor de uploadroutes ---------- */
const nieuwId = () => 'u' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
const basisJob = (o) => ({
  id: nieuwId(), gemaakt: Date.now(),
  clubId: S.clubId, clubNaam: S.club?.naam || '',
  door: S.user?.displayName || S.user?.email || '',
  soort: o.soort || 'los', naam: o.naam || 'Upload', teamsTxt: o.teamsTxt || '',
});

/* items: [{ file, titel, week, teams[], trainingsdag?, extra?, status? }] */
export async function voegToeAanWachtrij(o){
  await (geladen || initWachtrij(ctx));
  const job = { ...basisJob(o), items: [] };
  o.items.forEach((x, idx) => job.items.push({
    idx, naam: x.file.name, titel: x.titel, week: x.week, teams: x.teams,
    ...(x.trainingsdag ? { trainingsdag: x.trainingsdag } : {}),
    ...(x.extra ? { extra: x.extra } : {}),
    ...(x.aiModel && x.aiModel !== 'standaard' ? { aiModel: x.aiModel } : {}),
    status: x.status === 'skip' ? 'skip' : 'wacht',
  }));
  jobs.push(job);
  await Promise.all(o.items.map((x, idx) => job.items[idx].status === 'skip' ? null : bewaarBestand(job.id, idx, x.file)));
  await bewaarJob(job);
  wijziging();
  draai();
  return job;
}

/* Concept (een blok dat nog wordt ingesteld): bestanden + instellingen bewaren. */
export async function voegConceptToe(o, files){
  await (geladen || initWachtrij(ctx));
  const job = { ...basisJob(o), concept: true, blok: o.blok, items: files.map((f, idx) => ({ idx, naam: f.name, status:'concept' })) };
  jobs.push(job);
  await Promise.all(files.map((f, idx) => bewaarBestand(job.id, idx, f)));
  await bewaarJob(job);
  wijziging();
  return job;
}
export function bewaarConcept(jobId, blok, naam, teamsTxt){
  const job = jobs.find(j => j.id === jobId); if (!job) return;
  job.blok = blok; if (naam) job.naam = naam; if (teamsTxt != null) job.teamsTxt = teamsTxt;
  bewaarJob(job);
  wijziging();
}
/* Concept → in de rij. items: [{ idx, titel, week, teams, extra, status }] */
export async function conceptNaarRij(jobId, items, naam, teamsTxt){
  const job = jobs.find(j => j.id === jobId); if (!job) return null;
  job.concept = false; delete job.blok;
  job.naam = naam || job.naam; job.teamsTxt = teamsTxt || job.teamsTxt;
  job.items = items.map(x => ({
    idx: x.idx, naam: x.naam, titel: x.titel, week: x.week, teams: x.teams,
    ...(x.extra ? { extra: x.extra } : {}),
    ...(x.aiModel && x.aiModel !== 'standaard' ? { aiModel: x.aiModel } : {}),
    status: x.status === 'skip' ? 'skip' : 'wacht',
  }));
  await Promise.all(job.items.filter(i => i.status === 'skip').map(i => wisBestand(job.id, i.idx)));
  await bewaarJob(job);
  wijziging();
  draai();
  return job;
}
export async function verwijderJob(jobId){
  const job = jobs.find(j => j.id === jobId); if (!job) return;
  await wisJob(job);
  wijziging();
}
export async function bestandenVanJob(jobId){
  const job = jobs.find(j => j.id === jobId); if (!job) return [];
  return Promise.all(job.items.map(it => leesBestand(job.id, it.idx, it.naam)));
}

/* ---------- Status ---------- */
function openstaand(job){
  return job.items.some(it => ['wacht', 'bezig', 'check', 'fout'].includes(it.status));
}
function telling(job){
  const t = { totaal: 0, klaar: 0, ok: 0, check: 0, wacht: 0, bezig: 0 };
  for (const it of job.items){
    if (it.status === 'skip' || it.status === 'weg') continue;
    t.totaal++;
    if (it.status === 'ok') { t.ok++; t.klaar++; }
    else if (it.status === 'check' || it.status === 'fout') { t.check++; t.klaar++; }
    else if (it.status === 'bezig') t.bezig++;
    else if (it.status === 'wacht') t.wacht++;
  }
  return t;
}

/* ---------- Verwerken ---------- */
const waarschuw = e => { e.preventDefault(); e.returnValue = ''; };

/* [20261013c] Drie items tegelijk (over alle uploads heen, oudste eerst).
   Meer raden we af i.v.m. de limieten van het Anthropic-account. */
const MAX_TEGELIJK = 3;
let actief = 0;
let aiBelofte = null;
const aiModule = () => (aiBelofte ||= import('./training-ai.js?v=20261023a'));

function volgende(){
  for (const job of jobs){
    if (job.concept || job.gepauzeerd) continue;
    const it = job.items.find(i => i.status === 'wacht');
    if (it) return { job, it };
  }
  return null;
}

function draai(){
  let v;
  while (actief < MAX_TEGELIJK && (v = volgende())){
    const { job, it } = v;
    it.status = 'bezig';                    // meteen claimen: niet dubbel oppakken
    if (actief++ === 0){ loopt = true; window.addEventListener('beforeunload', waarschuw); }
    verwerkEnBewaar(job, it).finally(() => {
      if (--actief === 0){ loopt = false; window.removeEventListener('beforeunload', waarschuw); }
      wijziging();
      draai();
    });
  }
  wijziging();
}

async function verwerkEnBewaar(job, it){
  try {
    await verwerkItem(job, it, await aiModule());
  } catch(e){
    console.error('[wachtrij] verwerken mislukt', it.naam, e);
    it.status = 'fout';
  }
  if (it.status === 'ok') await wisBestand(job.id, it.idx);
  await bewaarJob(job);
  if (!job.items.some(i => i.status === 'wacht' || i.status === 'bezig')) await jobKlaar(job);
}

async function jobKlaar(job){
  const t = telling(job);
  meld(t.check ? `${job.naam}: ${t.ok} gedeeld · ${t.check} wacht op jouw blik` : `${job.naam}: ${t.ok} training${t.ok === 1 ? '' : 'en'} gedeeld`);
  if (!t.check){
    job.afgerond = true;                       // in beeld tot "Sluiten" of herladen
    await opslag('jobs', 'readwrite', s => s.delete(job.id));
  }
  ctx.trainingenGewijzigd?.();
}

/* Zelfde stappen als startTrainingVerwerking in club.js, zonder scherm. */
async function verwerkItem(job, it, ai){
  const file = await leesBestand(job.id, it.idx, it.naam);
  if (!file) throw new Error('bestand niet meer beschikbaar op dit apparaat');
  // Uniek per training: tot nu toe was dit alleen Date.now(). Omdat er drie
  // trainingen tegelijk verwerkt worden, konden er twee binnen dezelfde
  // milliseconde starten en dezelfde map delen; hun diagram1…n.png overschreven
  // elkaar, waardoor trainingen elkaars plaatjes kregen. Daarom + willekeurig deel.
  const mapId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const veiligeNaam = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
  const pdfPath = `clubs/${job.clubId}/trainingen/${mapId}/${veiligeNaam}`;

  const { paginas, diagramBlobs, bytes } = await ai.leesPdf(file);
  const pdfRef = sRef(storage, pdfPath);
  await uploadBytes(pdfRef, new Blob([bytes], { type:'application/pdf' }), { contentType:'application/pdf' });
  const pdfUrl = await getDownloadURL(pdfRef);
  const diagramUrls = await ai.uploadDiagrammen(job.clubId, mapId, diagramBlobs);

  let oefeningen = null, doelen = [];
  for (let poging = 0; poging < 2 && !oefeningen; poging++){
    try { ({ oefeningen, doelen } = await ai.structureer(paginas, it.aiModel || 'standaard')); }
    catch(e){ console.warn('[wachtrij] AI-poging', poging + 1, 'mislukt', e); }
  }
  if (!oefeningen){
    it.status = 'fout';
    it.aiCtx = { mapId, pdfPath, pdfUrl };
    return;
  }
  telGebruik('training_upload');
  const score = ai.berekenScore(paginas.map(p => p.tekst).join(' '), oefeningen);
  if (!ai.scoreGoed(score)){
    it.status = 'check';
    it.aiCtx = { mapId, pdfPath, pdfUrl, diagramUrls, oefeningen, doelen, score, paginas };
    return;
  }
  const doelLijst = (Array.isArray(doelen) ? doelen : [])
    .map(d => String(d || '').replace(/\s+/g, ' ').trim()).filter(Boolean).slice(0, 4);
  await addDoc(collection(db, 'trainingen'), {
    club: job.clubId, clubNaam: job.clubNaam,
    titel: it.titel, week: it.week, bestandsnaam: it.naam,
    ...(it.trainingsdag ? { trainingsdag: it.trainingsdag } : {}),
    ...(it.extra || {}),
    path: pdfPath, url: pdfUrl, mapId,
    oefeningen, diagramUrls, doelen: doelLijst,
    paginas: paginas.map(p => ({ pagina: p.pagina, tekst: p.tekst })),
    aiScore: { dekking: score.dekkingPct, verzonnen: score.verzonnenAantal },
    teams: it.teams,
    gemaakt: serverTimestamp(),
    door: job.door,
  });
  it.status = 'ok';
}

/* Afwijker bekijken: het gewone preview-scherm (club.js), daarna terug. */
async function bekijk(job, it){
  if (!it.aiCtx){                                   // mislukt vóór opslaan: opnieuw in de rij
    it.status = 'wacht'; job.gepauzeerd = false;
    await bewaarJob(job); wijziging(); draai();
    return;
  }
  const file = await leesBestand(job.id, it.idx, it.naam);
  if (!file){ meld('Het bestand staat niet meer op dit apparaat'); return; }
  const meta = {
    titel: it.titel, week: it.week, teams: it.teams,
    ...(it.trainingsdag ? { trainingsdag: it.trainingsdag } : {}),
    extra: it.extra || {},
    onKlaar: async () => {
      it.status = 'ok'; delete it.aiCtx;
      sluitModal();
      await wisBestand(job.id, it.idx);
      await bewaarJob(job);
      if (!openstaand(job)) await jobKlaar(job);
      else ctx.trainingenGewijzigd?.();
      wijziging();
    },
  };
  openModal('<h2>Training bekijken</h2><div class="tr-verwerk"><div class="tr-spin"></div></div>');
  if (it.status === 'check') ctx.toonPreview?.(file, meta, it.aiCtx);
  else ctx.toonAlleenPdf?.(file, meta, it.aiCtx, 'De automatische opmaak lukte niet. Je kunt de training als PDF delen of het opnieuw proberen.');
}

/* ---------- Weergave ---------- */
export function wijziging(){
  const el = document.getElementById('uqPaneel');
  if (el) el.innerHTML = htmlUploadPaneelInhoud();
  tekenLabel();
  luisteraars.forEach(f => { try { f(); } catch(e){} });
}
export function onWachtrijWijziging(fn){ luisteraars.add(fn); return () => luisteraars.delete(fn); }

export function htmlUploadPaneel(){
  return `<div id="uqPaneel" class="uq-paneel">${htmlUploadPaneelInhoud()}</div>`;
}

function htmlUploadPaneelInhoud(){
  const mijn = jobs.filter(j => !j.clubId || j.clubId === S.clubId);
  if (!mijn.length) return '';
  return `<div class="uq-kop">Uploads</div>${mijn.map(htmlJob).join('')}`;
}

function htmlJob(job){
  const knop = (actie, tekst, extra = '') => `<button type="button" class="uq-knop ${extra}" data-uq="${actie}" data-job="${esc(job.id)}">${tekst}</button>`;
  if (job.concept){
    return `<div class="uq-job concept">
      <div class="uq-titel"><b>${esc(job.naam)}</b>${job.teamsTxt ? `<span>${esc(job.teamsTxt)}</span>` : ''}</div>
      <div class="uq-status">Nog niet ingepland · ${job.items.length} training${job.items.length === 1 ? '' : 'en'}</div>
      <div class="uq-acties">${knop('hervat', 'Verder instellen', 'hoofd')}${knop('weg', 'Weggooien')}</div>
    </div>`;
  }
  const t = telling(job);
  const pct = t.totaal ? Math.round(t.klaar / t.totaal * 100) : 100;
  const actief = !job.gepauzeerd && (t.wacht || t.bezig);
  let status;
  if (job.gepauzeerd && t.wacht) status = `Onderbroken · nog ${t.wacht} te doen`;
  else if (t.bezig) status = `Bezig met ${t.bezig} training${t.bezig === 1 ? '' : 'en'} · nog ${t.wacht} in de rij`;
  else if (actief) status = `In de wachtrij · ${t.wacht} te doen`;
  else if (t.check) status = `${t.ok} gedeeld · ${t.check} wacht${t.check === 1 ? '' : 'en'} op jouw blik`;
  else status = `✓ Klaar · ${t.ok} training${t.ok === 1 ? '' : 'en'} gedeeld`;
  const afwijkers = job.items.filter(it => it.status === 'check' || it.status === 'fout').map(it => `
    <div class="uq-afwrij">
      <button type="button" class="uq-afw" data-uq="bekijk" data-job="${esc(job.id)}" data-idx="${it.idx}">
        <span>${esc(it.titel || it.naam)}</span><b>${it.status === 'check' ? 'Bekijken' : 'Mislukt · opnieuw'}</b></button>
      <button type="button" class="uq-weg" data-uq="afwijs" data-job="${esc(job.id)}" data-idx="${it.idx}" aria-label="${esc(it.titel || it.naam)} weggooien" title="Weggooien">✕</button>
    </div>`).join('');
  const aantalAfw = job.items.filter(it => it.status === 'check' || it.status === 'fout').length;
  const acties = [
    aantalAfw > 1 && !(t.wacht || t.bezig) ? knop('afwijsalle', `Alle ${aantalAfw} afwijkers weggooien`) : '',
    job.gepauzeerd && t.wacht ? knop('verder', 'Verder gaan', 'hoofd') : '',
    job.gepauzeerd && t.wacht ? knop('weg', 'Rest weggooien') : '',
    job.afgerond ? knop('sluit', 'Sluiten') : '',
  ].join('');
  return `<div class="uq-job ${t.check ? 'let' : ''}">
    <div class="uq-titel"><b>${esc(job.naam)}</b>${job.teamsTxt ? `<span>${esc(job.teamsTxt)}</span>` : ''}</div>
    <div class="uq-balkrij"><div class="uq-balk"><div style="width:${pct}%"></div></div><span>${t.klaar}/${t.totaal}</span></div>
    <div class="uq-status">${status}</div>
    ${afwijkers ? `<div class="uq-afwlijst">${afwijkers}</div>` : ''}
    ${acties ? `<div class="uq-acties">${acties}</div>` : ''}
  </div>`;
}

/* Klein label rechtsonder, overal in de app zichtbaar zolang er iets loopt of wacht. */
function tekenLabel(){
  let el = document.getElementById('uqLabel');
  const actief = jobs.filter(j => !j.concept);
  const t = actief.reduce((a, j) => { const x = telling(j); a.totaal += x.totaal; a.klaar += x.klaar; a.check += x.check; a.wacht += x.wacht; return a; }, { totaal:0, klaar:0, check:0, wacht:0 });
  const pauze = actief.some(j => j.gepauzeerd && telling(j).wacht);
  const concept = jobs.some(j => j.concept);
  let tekst = '';
  if (loopt) tekst = `Uploaden ${t.klaar}/${t.totaal}`;
  else if (t.check) tekst = `${t.check} training${t.check === 1 ? ' wacht' : 'en wachten'} op jou`;
  else if (pauze) tekst = 'Uploads onderbroken';
  else if (concept) tekst = 'Upload niet afgerond';
  if (!tekst){ if (el) el.remove(); return; }
  if (!el){
    el = document.createElement('button');
    el.id = 'uqLabel'; el.type = 'button'; el.className = 'uq-label';
    el.setAttribute('data-uq', 'naar');
    document.body.appendChild(el);
  }
  el.classList.toggle('loopt', loopt);
  el.textContent = tekst;
}

/* ---------- Klikken (één gedelegeerde handler) ---------- */
async function klik(e){
  const b = e.target.closest?.('[data-uq]'); if (!b) return;
  const actie = b.dataset.uq;
  if (actie === 'naar'){
    const j = jobs.find(x => x.concept || openstaand(x)) || jobs[0];
    ctx.naarTrainingen?.(j?.clubId || S.clubId);
    return;
  }
  const job = jobs.find(j => j.id === b.dataset.job); if (!job) return;
  if (actie === 'bekijk'){
    const it = job.items.find(i => i.idx === Number(b.dataset.idx));
    if (it) bekijk(job, it);
  } else if (actie === 'verder'){
    job.gepauzeerd = false; await bewaarJob(job); wijziging(); draai();
  } else if (actie === 'weg'){
    if (job.concept){ await wisJob(job); meld('Upload weggegooid'); wijziging(); return; }
    job.items.forEach(it => { if (it.status === 'wacht') it.status = 'skip'; });
    job.gepauzeerd = false;
    await Promise.all(job.items.filter(it => it.status === 'skip').map(it => wisBestand(job.id, it.idx)));
    if (openstaand(job)) await bewaarJob(job); else await wisJob(job);
    wijziging();
  } else if (actie === 'afwijs' || actie === 'afwijsalle'){
    const items = actie === 'afwijs'
      ? job.items.filter(i => i.idx === Number(b.dataset.idx))
      : job.items.filter(i => i.status === 'check' || i.status === 'fout');
    if (items.length) bevestigAfwijzen(job, items);
  } else if (actie === 'sluit'){
    await wisJob(job); wijziging();
  } else if (actie === 'hervat'){
    ctx.hervatConcept?.(job);
  }
}

/* ---------- Afwijzen (weggooien) ---------- [20261013d]
   Een afwijker die je niet wilt delen: de AI-versie vervalt, en de al
   geüploade PDF en diagrammen in Storage worden opgeruimd. Er is nog geen
   trainingsdocument, dus coaches merken er niets van. */
function bevestigAfwijzen(job, items){
  const een = items.length === 1;
  openModal(`
    <h2>${een ? 'Training weggooien?' : `${items.length} trainingen weggooien?`}</h2>
    <p style="font-size:calc(14px * var(--fs));line-height:1.5;margin:0 0 14px">${een
      ? `<b>${esc(items[0].titel || items[0].naam)}</b> wordt niet gedeeld. De AI-versie en de geüploade PDF worden verwijderd.`
      : `Deze trainingen worden niet gedeeld. De AI-versies en de geüploade PDF's worden verwijderd.`}</p>
    <div class="rij">
      <button class="knop licht vol" id="uqAfwNee">Annuleren</button>
      <button class="knop vol" id="uqAfwJa" style="background:var(--uit)">Weggooien</button>
    </div>`, { vorm:'dialoog' });
  document.getElementById('uqAfwNee').onclick = () => sluitModal();
  document.getElementById('uqAfwJa').onclick = async () => {
    sluitModal();
    for (const it of items) await afwijzen(job, it);
    await bewaarJob(job);
    if (!openstaand(job)) await jobKlaar(job);
    meld(een ? 'Training weggegooid' : `${items.length} trainingen weggegooid`);
    wijziging();
  };
}

async function afwijzen(job, it){
  const c = it.aiCtx;
  if (c?.pdfPath){
    const paden = [c.pdfPath, ...Object.keys(c.diagramUrls || {}).map(n => `clubs/${job.clubId}/trainingen/${c.mapId}/diagram${n}.png`)];
    await Promise.all(paden.map(p => deleteObject(sRef(storage, p)).catch(() => {})));
  }
  it.status = 'weg';
  delete it.aiCtx;
  await wisBestand(job.id, it.idx);
}
