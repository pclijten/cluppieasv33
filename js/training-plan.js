/* ==================== BLOKPLANNING: TRAININGEN IN BULK ====================
   [20261013a] De club krijgt oefenstof per blok aangeleverd (een zip of een
   stapel PDF's met namen als "Blok 2 - Week 1 - Training 1.pdf", plus losse
   "… - Overzicht.pdf"-bladen die niet mee hoeven). Deze module:

   1. leest de bestanden (een zip pakken we in de browser uit met JSZip, dat
      pas wordt geladen als er echt een zip komt),
   2. herkent blok, blokweek en trainingnummer uit de bestandsnaam,
   3. laat de admin één keer de teams of trainingsgroep kiezen, de kalender-
      week waarin blokweek 1 valt, eventuele vrije weken en het moment waarop
      de trainingen zichtbaar worden,
   4. zet alles in de uploadwachtrij (upload-wachtrij.js, [20261013b]), die
      op de achtergrond verwerkt en automatisch deelt wat de AI-controle
      goedkeurt; afwijkers wachten bovenaan Trainingen op een blik,
   5. en biedt daarna een "Plannen"-weergave waarin je een week kunt laten
      vervallen: alle latere trainingen schuiven dan een week op, inclusief
      titel ("Week 47 - training 1" → "Week 48 - training 1") en zichtbaarheid.
      [20261123a] In die weergave sleep je ook een week naar een andere week:
      alle trainingen van die week gaan in één keer mee (zie onderaan).

   De gewone upload (één PDF, of meerdere PDF's verdelen per groep) blijft
   ongewijzigd; deze flow start alleen bij een zip of bij meerdere PDF's met
   blok-namen. Alle extra velden op een training zijn optioneel:
     plan { id, naam, blok, start, vrij[], zichtbaar, weken, eerste?, groep? }
       [20261116a] eerste = laagste blokweek in de upload (alleen als die niet
       1 is). `start` is de week van díé blokweek, niet van blokweek 1.
     blokWeek, trainingNr, weekStart (maandag, 'YYYY-MM-DD'),
     zichtbaarVanaf ('YYYY-MM-DD' of null = meteen)
   Trainingen zonder deze velden gedragen zich precies zoals voorheen.

   club.js levert via `ctx` wat hier nodig is maar daar woont (groepen,
   bouwen, het preview-scherm, renderClub), zodat er geen kringimport ontstaat. */
import { db, doc, writeBatch } from './firebase.js?v=20261106r';
import { S, $, esc, meld, openModal, sluitModal } from './state.js?v=20261111g';
import {
  voegToeAanWachtrij, voegConceptToe, bewaarConcept, conceptNaarRij, verwijderJob, bestandenVanJob, htmlModelKeuze
} from './upload-wachtrij.js?v=20261111g';

/* ---------- Datums (lokaal; 12:00 als anker tegen zomertijd-randgevallen) ---------- */
const pad2 = n => String(n).padStart(2, '0');
const isoVan = d => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
const datumVan = iso => new Date(iso + 'T12:00');
export const vandaagIso = () => isoVan(new Date());
export function plusDagen(iso, n){ const d = datumVan(iso); d.setDate(d.getDate() + n); return isoVan(d); }
export function maandagVan(iso){ const d = datumVan(iso); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return isoVan(d); }
export function isoWeekNr(iso){
  const d = datumVan(iso); d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + 3 - (d.getDay() + 6) % 7);
  const w1 = new Date(d.getFullYear(), 0, 4);
  return 1 + Math.round(((d - w1) / 86400000 - 3 + (w1.getDay() + 6) % 7) / 7);
}
/* jaar waar de ISO-week bij hoort (de donderdag van die week beslist) */
export const isoJaar = iso => datumVan(plusDagen(maandagVan(iso), 3)).getFullYear();
export function kortDatum(iso){
  return datumVan(iso).toLocaleDateString('nl-NL', { weekday:'short', day:'numeric', month:'short' }).replace(/\./g, '');
}

/* ---------- Zichtbaarheid: één keuze per blok ----------
   offset = aantal dagen t.o.v. de maandag van de trainingsweek. Beide (alle)
   trainingen van een week worden op hetzelfde moment zichtbaar. */
export const ZICHTBAAR_OPTIES = [
  { id:'vr',     label:'Vrijdag ervoor',   offset:-3 },
  { id:'za',     label:'Zaterdag ervoor',  offset:-2 },
  { id:'zo',     label:'Zondag ervoor',    offset:-1 },
  { id:'ma',     label:'Maandag',          offset:0 },
  { id:'di',     label:'Dinsdag',          offset:1 },
  { id:'wo',     label:'Woensdag',         offset:2 },
  { id:'do',     label:'Donderdag',        offset:3 },
  { id:'meteen', label:'Meteen',           offset:null },
];
const zichtbaarOptie = id => ZICHTBAAR_OPTIES.find(o => o.id === id) || ZICHTBAAR_OPTIES[2];
export function zichtbaarDatum(weekStart, optie){
  const o = zichtbaarOptie(optie);
  return o.offset == null ? null : plusDagen(weekStart, o.offset);
}
/* Mag een coach deze training nu zien? Zonder veld: altijd (oud gedrag). */
export function zichtbaarNu(t, vandaag = vandaagIso()){
  return !t?.zichtbaarVanaf || t.zichtbaarVanaf <= vandaag;
}
/* Label voor de beheerlijst: '' als de training al zichtbaar is. */
export function zichtbaarLabel(t){
  return zichtbaarNu(t) ? '' : `zichtbaar vanaf ${kortDatum(t.zichtbaarVanaf)}`;
}

/* ---------- Planning: blokweek → kalenderweek ----------
   Blokweek 1 valt in de week van `start` (een maandag); elke volgende
   blokweek in de eerstvolgende week die niet als vrij is gemarkeerd. */
export function planWeken(start, vrij, aantal){
  const v = new Set(vrij || []);
  const uit = [];
  let m = start;
  for (let i = 0; uit.length < aantal && i < 200; i++){
    if (!v.has(m)) uit.push(m);
    m = plusDagen(m, 7);
  }
  return uit;
}
/* [20261116a] Een upload hoeft niet bij blokweek 1 te beginnen ("Week 9" t/m
   "Week 14" als vervolg op een eerdere reeks). De startweek hoort dan bij de
   láágste blokweek uit de upload; anders schoof alles (laagste - 1) weken op. */
const eersteVan = st => Math.min(...st.a.items.map(i => i.week));
const spanVan = st => Math.max(1, st.weken - eersteVan(st) + 1);

/* [20261116a] Het weeklabel van een ingeplande training is met de hand aangepast
   ("Week 1" -> "Week 46"): geef de maandag die bij dat weeknummer hoort, zo
   dicht mogelijk bij de oude weekStart (zo kiest het vanzelf het goede jaar).
   Zonder herkenbaar "week NN" (of alleen een getal) blijft de oude weekStart. */
export function weekStartBijLabel(label, oud){
  if (!/^\d{4}-\d{2}-\d{2}$/.test(oud || '')) return oud || null;
  const m = String(label || '').match(/\b(?:week|wk)\.?\s*(\d{1,2})\b/i) || String(label || '').match(/^\s*(\d{1,2})\s*$/);
  const nr = m ? Number(m[1]) : 0;
  if (!(nr >= 1 && nr <= 53) || isoWeekNr(oud) === nr) return oud;
  const j = isoJaar(oud);
  const afstand = ws => Math.abs(datumVan(ws) - datumVan(oud));
  return [j - 1, j, j + 1]
    .map(jaar => plusDagen(maandagVan(`${jaar}-01-04`), (nr - 1) * 7))
    .filter(ws => isoWeekNr(ws) === nr)                 // week 53 bestaat niet elk jaar
    .sort((a, b) => afstand(a) - afstand(b))[0] || oud;
}

/* Benaming sluit aan bij de bestaande lijst: "Week 42 - training 1". */
export const weekLabel = weekStart => `Week ${isoWeekNr(weekStart)}`;
export const titelVoor = (weekStart, nr) => `${weekLabel(weekStart)} - training ${nr}`;

/* ---------- Bestanden herkennen ---------- */
/* [20261013e] "Blok N" is optioneel en tussen week en training mag een thema
   staan: "Blok 2 - Week 1 - Training 1", "JO7 - Week 2 - Bal = Vriend - Training 1"
   en "Week 6 - Behendigheid - Training 2" worden alle drie herkend. */
const SCHEIDING = '[-–_.,: ]+';
const BLOK_RE = new RegExp(`(?:blok\\s*(\\d+)\\s*${SCHEIDING})?\\bweek\\s*(\\d+)\\s*${SCHEIDING}(?:(.*?)\\s*${SCHEIDING})?training\\s*(\\d+)`, 'i');
const isPdf = f => f?.type === 'application/pdf' || /\.pdf$/i.test(f?.name || '');
export const isZip = f => /\.zip$/i.test(f?.name || '') || /zip/i.test(f?.type || '');
/* Deze flow bij een zip, of bij PDF's met blok-namen die over minstens twee
   weken gaan (een echt blok). Het wekelijkse setje voor meerdere groepen (alles
   dezelfde week) en één losse PDF gaan zoals altijd via de gewone upload. */
export function isBlokUpload(files){
  if (files.some(isZip)) return true;
  const weken = new Set(files.filter(isPdf).map(f => herkenNaam(f.name)).filter(h => h && !h.overzicht).map(h => h.week));
  return weken.size >= 2;
}
export function herkenNaam(naam){
  const kaal = String(naam || '').replace(/^.*[\\/]/, '');
  if (!/\.pdf$/i.test(kaal)) return null;
  if (/overzicht/i.test(kaal)) return { overzicht:true };
  const m = kaal.match(BLOK_RE);
  if (!m) return null;
  const voor = kaal.slice(0, m.index).replace(/[\s\-–_]+$/, '').trim();   // bv. "JO 8&9" of "JO7"
  return { blok: m[1] ? +m[1] : 0, week:+m[2], nr:+m[4], voor, thema:(m[3] || '').trim() };
}

/* JSZip pas laden als er een zip binnenkomt (zelfde patroon als ExcelJS/pdf.js). */
let jszipBelofte = null;
function laadJSZip(){
  if (window.JSZip) return Promise.resolve(window.JSZip);
  if (!jszipBelofte) jszipBelofte = new Promise((ok, nok) => {
    const s = document.createElement('script');
    s.src = 'https://cdn.jsdelivr.net/npm/jszip@3.10.1/dist/jszip.min.js';
    s.onload = () => window.JSZip ? ok(window.JSZip) : nok(new Error('JSZip niet beschikbaar'));
    s.onerror = () => { jszipBelofte = null; nok(new Error('JSZip laden mislukt')); };
    document.head.appendChild(s);
  });
  return jszipBelofte;
}

/* Alle PDF's uit de invoer (zip's uitgepakt), met het pad binnen de zip. */
async function bestandenUitInvoer(files){
  const uit = [];
  for (const f of files){
    if (isZip(f)){
      const JSZip = await laadJSZip();
      const zip = await JSZip.loadAsync(f);
      const entries = Object.values(zip.files)
        .filter(e => !e.dir && /\.pdf$/i.test(e.name) && !/(^|\/)__MACOSX\//.test(e.name) && !/(^|\/)\._/.test(e.name));
      for (const e of entries){
        const blob = await e.async('blob');
        const naam = e.name.split('/').pop();
        uit.push({ file: new File([blob], naam, { type:'application/pdf' }), pad: e.name });
      }
    } else if (isPdf(f)){
      uit.push({ file: f, pad: f.name });
    }
  }
  return uit;
}

function analyseer(invoer){
  const items = [], onbekend = [];
  let overzichtAantal = 0, thema = '';
  for (const x of invoer){
    const h = herkenNaam(x.file.name);
    if (!h){ onbekend.push(x); continue; }
    if (h.overzicht){ overzichtAantal++; continue; }
    items.push({ ...x, ...h, naam: x.file.name });
    // thema uit de mapnaam in de zip: "Blok 2 - Omschakeling balbezit naar balverlies/…"
    if (!thema){
      const map = x.pad.split('/').slice(-2, -1)[0] || '';
      const tm = map.match(/blok\s*\d+\s*[-–:]\s*(.+)$/i);
      if (tm) thema = tm[1].trim();
    }
  }
  items.sort((a, b) => a.blok - b.blok || a.week - b.week || a.nr - b.nr);
  // dubbele namen (zelfde blok/week/training) maar één keer
  const gezien = new Set();
  const uniek = items.filter(i => { const k = `${i.blok}-${i.week}-${i.nr}`; if (gezien.has(k)) return false; gezien.add(k); return true; });
  uniek.forEach((it, idx) => { it.idx = idx; });
  const blokken = [...new Set(uniek.map(i => i.blok))];
  const voor = uniek.find(i => i.voor)?.voor || '';
  return { items: uniek, overzichtAantal, onbekend, onbekendNamen: onbekend.map(x => x.file.name), blokken, thema, voor };
}

function planNaam(a){
  const delen = [a.blokken[0] ? `Blok ${a.blokken[0]}` : '', a.voor, a.thema].filter(Boolean);
  return delen.length ? delen.join(', ') : 'Trainingsreeks';
}
/* thema per blokweek uit de bestandsnamen ("Week 2 - Bal = Vriend - …") */
function weekThema(a, week){
  return a.items.find(i => i.week === week && i.thema)?.thema || '';
}

/* Wat van de instellingen in het concept (IndexedDB) wordt bewaard. */
function conceptVan(st){
  const a = st.a;
  return {
    stap: st.stap, teams: [...st.teams], groepId: st.groepId, losOpen: st.losOpen,
    start: st.start, vrij: st.vrij, zichtbaar: st.zichtbaar, weken: st.weken,
    a: {
      items: a.items.map(({ file, pad, ...rest }) => rest),
      overzichtAantal: a.overzichtAantal, onbekendNamen: a.onbekendNamen,
      blokken: a.blokken, thema: a.thema, voor: a.voor,
    },
  };
}

/* ==================== De upload-flow ==================== */
export async function startBlokUpload(files, ctx){
  openModal(`<h2>Trainingen uploaden</h2><div id="bpRoot"><div class="tr-verwerk"><div class="tr-spin"></div><p>Bestanden lezen…</p></div></div>`);
  let invoer;
  try {
    invoer = await bestandenUitInvoer(files);
  } catch(e){
    console.error('[blokplan] zip lezen mislukt', e);
    sluitModal();
    return meld('De zip kon niet worden gelezen. Pak hem uit en kies de PDF’s zelf.');
  }
  const a = analyseer(invoer);
  if (!a.items.length){
    // niets herkend: gewoon de bestaande flow met de (niet-overzicht) PDF's
    sluitModal();
    const pdfs = a.onbekend.map(x => x.file);
    if (!pdfs.length) return meld('Geen trainingen gevonden in deze bestanden');
    return ctx.oudeFlow(pdfs);
  }
  const st = {
    a, stap:'teams', teams:new Set(), groepId:null, losOpen:false,
    start: plusDagen(maandagVan(vandaagIso()), 7),     // standaard: volgende week
    vrij: [], zichtbaar:'zo',
    weken: Math.max(...a.items.map(i => i.week)),
  };
  // [20261013b] meteen als concept bewaren: per ongeluk wegklikken kost niets meer
  const job = await voegConceptToe({ soort:'blok', naam: planNaam(a), blok: conceptVan(st) }, a.items.map(i => i.file));
  st.conceptId = job.id;
  teken(st, ctx);
}

/* Een concept uit de wachtrij weer openen ("Verder instellen"). */
export async function hervatBlokUpload(job, ctx){
  const c = job.blok; if (!c) return;
  const files = await bestandenVanJob(job.id);
  if (files.some(f => !f)){ meld('Niet alle bestanden staan nog op dit apparaat. Upload het blok opnieuw.'); return; }
  const a = { ...c.a, onbekend: [], items: c.a.items.map(it => ({ ...it, file: files[it.idx] })) };
  const st = {
    a, stap: c.stap === 'planning' ? 'planning' : 'teams',
    teams: new Set(c.teams || []), groepId: c.groepId || null, losOpen: !!c.losOpen,
    start: c.start, vrij: c.vrij || [], zichtbaar: c.zichtbaar || 'zo', weken: c.weken,
    conceptId: job.id,
  };
  openModal(`<h2>Trainingen uploaden</h2><div id="bpRoot"></div>`);
  teken(st, ctx);
}

const TITELS = { teams:'Trainingen uploaden', planning:'Planning' };

function teken(st, ctx){
  const root = document.getElementById('bpRoot');
  if (!root) return;
  const h = document.querySelector('#modalInhoud .modal-kop h2');
  if (h) h.textContent = TITELS[st.stap];
  root.innerHTML = st.stap === 'teams' ? htmlTeams(st, ctx) : htmlPlanning(st, ctx);
  koppel(st, ctx, root);
  if (st.conceptId) bewaarConcept(st.conceptId, conceptVan(st), planNaam(st.a), st.teams.size ? teamsTekst(st, ctx) : '');
}

function teamsTekst(st, ctx){
  const g = st.groepId ? (ctx.groepen || []).find(x => x.id === st.groepId) : null;
  if (g) return `${g.naam || ('Groep ' + g.id)}, ${st.teams.size} team${st.teams.size === 1 ? '' : 's'}`;
  if (st.teams.size <= 3) return [...st.teams].map(id => ctx.teams.find(t => t.id === id)?.naam || '?').join(', ');
  return `${st.teams.size} teams`;
}

/* ---------- Stap 1: herkend + teams ---------- */
function htmlTeams(st, ctx){
  const { a } = st;
  const perWeek = Math.max(...a.items.map(i => i.nr));
  const meerBlok = a.blokken.length > 1;
  const teamIds = new Set(ctx.teams.map(t => t.id));
  const groepen = ctx.groepen || [];
  const groepChips = groepen.length ? `<div class="tr-groep-rij">${groepen.map(g => {
    const n = (g.teams || []).filter(id => teamIds.has(id)).length;
    return `<button type="button" class="tr-groep-chip ${st.groepId === g.id ? 'aan' : ''}" data-bp-groep="${esc(g.id)}" title="${esc(g.naam || ('Groep ' + g.id))}">
      <span class="letter">${esc(g.id)}</span><span class="telling">${n} team${n === 1 ? '' : 's'}</span></button>`;
  }).join('')}</div>` : '';
  const losseTeams = (ctx.bouwGroepen || []).map(b => `
    <div class="bp-bouw">${esc(b.naam)}</div>
    <div class="team-chip-kies">${b.teams.map(t =>
      `<label class="${st.teams.has(t.id) ? 'aan' : ''}"><input type="checkbox" data-bp-team="${esc(t.id)}" ${st.teams.has(t.id) ? 'checked' : ''}><span>${esc(t.naam)}</span></label>`).join('')}</div>`).join('');
  const onb = a.onbekendNamen || [];
  const onbekendTekst = onb.slice(0, 4).map(esc).join(', ') + (onb.length > 4 ? ` en ${onb.length - 4} meer` : '');
  const ov = a.overzichtAantal || 0;
  return `
    <div class="bp-blok">
      <div class="bp-bloknr">${a.blokken.some(Boolean) ? `Blok ${a.blokken.filter(Boolean).map(Number).join(' + ')}` : esc(a.voor || 'Trainingsreeks')}</div>
      ${a.thema || (a.voor && a.blokken.some(Boolean)) ? `<div class="bp-thema">${esc([a.blokken.some(Boolean) ? a.voor : '', a.thema].filter(Boolean).join(', '))}</div>` : ''}
      <div class="bp-tellers">
        <div><b>${spanVan(st)}</b><span>weken</span></div>
        <div><b>${perWeek}</b><span>per week</span></div>
        <div><b class="acc">${a.items.length}</b><span>trainingen</span></div>
      </div>
      <ul class="bp-check">
        <li class="ok">Blok, week en training herkend uit de bestandsnamen</li>
        ${ov ? `<li>${ov} overzichtsblad${ov === 1 ? '' : 'en'} (… Overzicht.pdf) sla${ov === 1 ? '' : 'an'} we over</li>` : ''}
        ${onb.length ? `<li class="let">Niet herkend en niet meegenomen: ${onbekendTekst}</li>` : ''}
      </ul>
    </div>
    ${meerBlok ? `<div class="mm-samenv warn">Er zitten meerdere blokken in deze upload. Upload één blok tegelijk, dan kun je elk blok apart inplannen.</div>` : ''}
    <div class="veldgroep"><label>Voor welke teams?</label>
      ${groepen.length ? `<div class="tr-groep-uitleg">Tik op een groep om alle teams in één keer te kiezen, of vink hieronder losse teams aan.</div>${groepChips}` : ''}
      <details class="bp-los" ${st.losOpen || !groepen.length ? 'open' : ''}>
        <summary>Losse teams aanvinken${st.teams.size ? `, ${st.teams.size} gekozen` : ''}</summary>
        ${losseTeams || '<p class="bp-hint">Maak eerst teams aan in deze club.</p>'}
      </details>
      <p class="bp-hint">Elk team krijgt zijn eigen trainingsdagen: training 1 op de eerste dag, training 2 op de tweede. Zo werkt Cluppie nu ook al.</p>
    </div>
    <button class="knop vol" id="bpVerder" ${!st.teams.size || meerBlok ? 'disabled' : ''}>Verder naar planning</button>
    <button class="link" id="bpOud" style="display:block;margin:var(--space-sm) auto 0">Toch zoals nu verdelen (zonder planning)</button>
    <p class="bp-hint u-tc">Wegklikken mag: je vindt deze upload terug bovenaan Trainingen.</p>`;
}

/* ---------- Stap 2: planning ---------- */
function dubbeleItems(st, ctx){
  return st.a.items.filter(it => (ctx.trainingen || []).some(t =>
    t.bestandsnaam === it.naam && (t.teams || []).some(id => st.teams.has(id))));
}

function htmlPlanning(st, ctx){
  const eersteWk = eersteVan(st);
  const map = planWeken(st.start, st.vrij, spanVan(st));
  const laatste = map[map.length - 1];
  const strip = [];
  for (let m = st.start; m <= plusDagen(laatste, 7); m = plusDagen(m, 7)) strip.push(m);
  const chips = strip.map(m => {
    const k = map.indexOf(m);
    const vrij = st.vrij.includes(m);
    const cls = vrij ? 'vrij' : k >= 0 ? 'plan' : 'leeg';
    const sub = vrij ? 'vrij' : k >= 0 ? `week ${k + eersteWk}` : 'leeg';
    return `<button type="button" class="bp-wk ${cls}" data-bp-wk="${m}" ${cls === 'leeg' ? 'disabled' : ''} aria-pressed="${vrij}" title="${esc(kortDatum(m))}"><b>${isoWeekNr(m)}</b><span>${sub}</span></button>`;
  }).join('');
  const rijen = map.map((m, i) => {
    const zv = zichtbaarDatum(m, st.zichtbaar);
    const th = weekThema(st.a, i + eersteWk);
    return `<tr><td class="bp-bw">Week ${i + eersteWk}${th ? `<small>${esc(th)}</small>` : ''}</td><td>wk ${isoWeekNr(m)}<span class="sep" aria-hidden="true"></span>${esc(kortDatum(m))}</td><td class="bp-zv">${zv ? esc(kortDatum(zv)) : 'meteen'}</td></tr>`;
  }).join('');
  const dubbel = dubbeleItems(st, ctx);
  const aantal = st.a.items.length - dubbel.length;
  const eerste = st.a.items[0];
  return `
    <div class="bp-sub">${esc(planNaam(st.a))}<span class="sep" aria-hidden="true"></span>${esc(teamsTekst(st, ctx))}</div>
    <div class="bp-start">
      <button type="button" class="bp-pijl" data-bp-start="-7" aria-label="Een week eerder">${pijl('l')}</button>
      <div class="bp-start-m"><small>Blokweek ${eersteWk} wordt</small><b>Week ${isoWeekNr(st.start)}<span class="sep" aria-hidden="true"></span>vanaf ${esc(kortDatum(st.start))}</b></div>
      <button type="button" class="bp-pijl" data-bp-start="7" aria-label="Een week later">${pijl('r')}</button>
    </div>
    <p class="bp-hint">Tik een week aan om hem over te slaan, bijvoorbeeld bij vakantie. De rest schuift mee.</p>
    <div class="bp-weken">${chips}</div>
    <div class="veldgroep u-mt-md"><label for="bpZicht">Zichtbaar voor coaches</label>
      <select class="invoer" id="bpZicht">${ZICHTBAAR_OPTIES.map(o => `<option value="${o.id}" ${o.id === st.zichtbaar ? 'selected' : ''}>${o.label}</option>`).join('')}</select>
      <p class="bp-hint">Eén keuze voor het hele blok: alle trainingen van een week worden tegelijk zichtbaar.</p>
    </div>
    <table class="bp-tabel"><thead><tr><th>Blok</th><th>Week</th><th>Zichtbaar vanaf</th></tr></thead><tbody>${rijen}</tbody></table>
    ${htmlModelKeuze('bpModel', st.aiModel || 'standaard')}
    <div class="bp-voorbeeld"><small>Zo staat het in de lijst</small><b>${esc(titelVoor(map[eerste.week - eersteWk], eerste.nr))}</b><span>${esc(eerste.naam)}</span></div>
    ${dubbel.length ? `<div class="mm-samenv warn">${dubbel.length} training${dubbel.length === 1 ? ' staat' : 'en staan'} al bij deze teams en ${dubbel.length === 1 ? 'wordt' : 'worden'} overgeslagen.</div>` : ''}
    <button class="knop vol" id="bpStart" ${aantal ? '' : 'disabled'}>Verwerk ${aantal} training${aantal === 1 ? '' : 'en'}</button>
    <p class="bp-hint u-tc">Het verwerken loopt op de achtergrond; je kunt meteen verder.</p>
    <button class="link" id="bpTerug" style="display:block;margin:var(--space-sm) auto 0">Terug</button>`;
}

const pijl = r => `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${r === 'l' ? 'M15 18l-6-6 6-6' : 'M9 6l6 6-6 6'}"/></svg>`;

/* ---------- Events ---------- */
function koppel(st, ctx, root){
  const q = s => [...root.querySelectorAll(s)];
  if (st.stap === 'teams'){
    q('[data-bp-groep]').forEach(b => b.onclick = () => {
      const g = (ctx.groepen || []).find(x => x.id === b.dataset.bpGroep); if (!g) return;
      const geldig = new Set(ctx.teams.map(t => t.id));
      st.teams = new Set((g.teams || []).filter(id => geldig.has(id)));
      st.groepId = g.id;
      teken(st, ctx);
    });
    q('[data-bp-team]').forEach(c => c.onchange = () => {
      c.checked ? st.teams.add(c.dataset.bpTeam) : st.teams.delete(c.dataset.bpTeam);
      st.groepId = null; st.losOpen = true;
      teken(st, ctx);
    });
    q('details.bp-los').forEach(d => d.addEventListener('toggle', () => { st.losOpen = d.open; }));
    const verder = root.querySelector('#bpVerder');
    if (verder) verder.onclick = () => { st.stap = 'planning'; teken(st, ctx); };
    const oud = root.querySelector('#bpOud');
    if (oud) oud.onclick = async () => {
      const files = st.a.items.map(i => i.file);
      if (st.conceptId) await verwijderJob(st.conceptId);
      sluitModal(); ctx.oudeFlow(files);
    };
    return;
  }
  q('[data-bp-start]').forEach(b => b.onclick = () => { st.start = plusDagen(st.start, Number(b.dataset.bpStart)); st.vrij = st.vrij.filter(m => m > st.start); teken(st, ctx); });
  q('[data-bp-wk]').forEach(b => b.onclick = () => {
    const m = b.dataset.bpWk;
    if (m === st.start && !st.vrij.includes(m)){ st.start = plusDagen(st.start, 7); }   // eerste week vrij = later beginnen
    else st.vrij = st.vrij.includes(m) ? st.vrij.filter(x => x !== m) : [...st.vrij, m].sort();
    teken(st, ctx);
  });
  const z = root.querySelector('#bpZicht');
  if (z) z.onchange = () => { st.zichtbaar = z.value; teken(st, ctx); };
  const mdl = root.querySelector('#bpModel');
  if (mdl) mdl.onchange = () => { st.aiModel = mdl.value; };
  const terug = root.querySelector('#bpTerug');
  if (terug) terug.onclick = () => { st.stap = 'teams'; teken(st, ctx); };
  const start = root.querySelector('#bpStart');
  if (start) start.onclick = () => naarWachtrij(st, ctx);
}

/* ---------- Naar de wachtrij ---------- */
async function naarWachtrij(st, ctx){
  const eersteWk = eersteVan(st);
  const map = planWeken(st.start, st.vrij, spanVan(st));
  const dubbel = new Set(dubbeleItems(st, ctx));
  const teams = [...st.teams];
  const plan = {
    id: 'p' + Date.now().toString(36),
    naam: planNaam(st.a),
    blok: st.a.blokken[0],
    start: st.start,
    vrij: [...st.vrij].sort(),
    zichtbaar: st.zichtbaar,
    weken: st.weken,
    ...(eersteWk > 1 ? { eerste: eersteWk } : {}),
    ...(st.groepId ? { groep: st.groepId } : {}),
  };
  const items = st.a.items.map(it => {
    const ws = map[it.week - eersteWk];
    return {
      idx: it.idx, naam: it.naam, file: it.file,
      titel: titelVoor(ws, it.nr), week: weekLabel(ws), teams, aiModel: st.aiModel || 'standaard',
      extra: { plan, blokWeek: it.week, trainingNr: it.nr, weekStart: ws, zichtbaarVanaf: zichtbaarDatum(ws, st.zichtbaar) || null },
      status: dubbel.has(it) ? 'skip' : 'wacht',
    };
  });
  const knop = document.getElementById('bpStart'); if (knop){ knop.disabled = true; knop.textContent = 'Bezig…'; }
  const naam = planNaam(st.a), teamsTxt = teamsTekst(st, ctx);
  if (st.conceptId) await conceptNaarRij(st.conceptId, items, naam, teamsTxt);
  else await voegToeAanWachtrij({ soort:'blok', naam, teamsTxt, items });
  sluitModal();
  const n = items.filter(i => i.status !== 'skip').length;
  meld(`${n} training${n === 1 ? '' : 'en'} in de wachtrij, voortgang bovenaan Trainingen`);
  ctx.renderClub?.();
}

/* ==================== Plannen-weergave (clubbeheer → Trainingen) ====================
   [20261123a] De strook leest de week uit de trainingen zelf (weekStart) in
   plaats van hem uit plan.start + plan.vrij te rekenen. Daardoor kan een week
   los worden versleept (naar een lege of vrije week, of wisselen met een
   bezette week) en klopt de strook ook nadat een weeklabel met de hand is
   aangepast.
   - slepen: muis direct, vinger na even vasthouden (pointer events). Elke
     week met trainingen is op te pakken, ook een voorbije.
   - tikken: week laten vervallen of terugzetten, zoals voorheen (alleen deze
     week en later).
   Vrije weken (plan.vrij) tellen niet als plek: wat meeschuift slaat ze over,
   zodat een training niet in een vakantieweek belandt. */
const WS_RE = /^\d{4}-\d{2}-\d{2}$/;
const wsVan = t => WS_RE.test(t?.weekStart || '') ? maandagVan(t.weekStart) : null;
const hoofd = s => s.charAt(0).toUpperCase() + s.slice(1);
const nTr = n => `${n} training${n === 1 ? '' : 'en'}`;
const LEEG_VOOR = 3, LEEG_NA = 2;      // lege weken vóór en ná de reeks, als plek om naartoe te slepen

function plannenUit(trainingen){
  const plannen = new Map();
  for (const t of trainingen){
    const id = t.plan?.id; if (!id) continue;
    if (!plannen.has(id)) plannen.set(id, { plan: t.plan, items: [] });
    plannen.get(id).items.push(t);
  }
  return plannen;
}

/* ---------- Rekenregels (zonder Firestore, los te testen) ---------- */
/* Per kalenderweek (maandag): welke blokweken er staan en hoeveel trainingen. */
export function planStand(items){
  const m = new Map();
  for (const t of items){
    const ws = wsVan(t); if (!ws) continue;
    if (!m.has(ws)) m.set(ws, { bws: new Set(), n: 0 });
    const c = m.get(ws);
    if (Number(t.blokWeek)) c.bws.add(Number(t.blokWeek));
    c.n++;
  }
  return m;
}
const bwTekst = c => c.bws.size ? 'week ' + [...c.bws].sort((a, b) => a - b).join('+') : 'training';
/* één plek verder (dir 1) of terug (dir -1); vrije weken V slaan we over */
const stap = (m, dir, V) => { do { m = plusDagen(m, 7 * dir); } while (V.has(m)); return m; };
const schuif = (m, n, V) => { for (let i = 0; i < Math.abs(n); i++) m = stap(m, Math.sign(n), V); return m; };
function plekAfstand(van, naar, V){
  const dir = naar > van ? 1 : -1;
  let n = 0, m = van;
  while (m !== naar && Math.abs(n) < 200){
    m = stap(m, dir, V); n += dir;
    if (dir > 0 ? m > naar : m < naar) break;
  }
  return n;
}
/* Slepen van week `van` naar week `naar`. Staat daar al iets, dan wisselen de
   twee. Anders verhuist alleen deze week ('een') of schuift alles erna even-
   veel plekken mee ('rest'). Geeft { zet: Map(oud → nieuw), botsing, vrij, st }. */
export function rekenSleep(items, vrij, van, naar, modus){
  const st = planStand(items);
  const V = new Set((vrij || []).filter(m => !st.has(m) && m !== naar));
  const zet = new Map();
  if (st.has(naar)){ zet.set(van, naar); zet.set(naar, van); }
  else {
    zet.set(van, naar);
    if (modus === 'rest'){
      const n = plekAfstand(van, naar, V);
      [...st.keys()].filter(c => c > van).forEach(c => zet.set(c, schuif(c, n, V)));
    }
  }
  return rond(st, zet, V);
}
/* Tikken op week m: staat er iets, dan wordt de week vrij en schuift alles
   vanaf daar één plek op; is hij vrij, dan komt alles erna één plek terug. */
export function rekenVrij(items, vrij, m){
  const st = planStand(items);
  const V = new Set((vrij || []).filter(x => !st.has(x)));
  const zet = new Map();
  const wordtVrij = st.has(m);
  if (wordtVrij){ V.add(m); [...st.keys()].filter(c => c >= m).forEach(c => zet.set(c, stap(c, 1, V))); }
  else { V.delete(m); [...st.keys()].filter(c => c > m).forEach(c => zet.set(c, stap(c, -1, V))); }
  return { ...rond(st, zet, V), wordtVrij };
}
function rond(st, zet, V){
  for (const [oud, nieuw] of [...zet]) if (oud === nieuw) zet.delete(oud);
  const blijft = new Set([...st.keys()].filter(c => !zet.has(c)));
  const botsing = [...zet.values()].find(n => blijft.has(n)) || null;
  const straks = [...new Set([...blijft, ...zet.values()])].sort();
  const eerste = straks[0], laatste = straks[straks.length - 1];
  const bezet = new Set(straks);
  // vrije weken buiten de reeks hebben geen betekenis meer
  const vrij = [...V].filter(m => !bezet.has(m) && m > eerste && m < laatste).sort();
  return { zet, botsing, vrij, st, eerste };
}

/* ---------- Tekenen ---------- */
/* wat koppelPlannen en de vensters nodig hebben; gevuld bij elke render */
const pl = { trainingen: [], teams: [], ctx: null, v: null };
const GRIP = `<svg class="bp-grip" viewBox="0 0 6 10" fill="currentColor" aria-hidden="true"><circle cx="1.2" cy="1.2" r="1.2"/><circle cx="4.8" cy="1.2" r="1.2"/><circle cx="1.2" cy="5" r="1.2"/><circle cx="4.8" cy="5" r="1.2"/><circle cx="1.2" cy="8.8" r="1.2"/><circle cx="4.8" cy="8.8" r="1.2"/></svg>`;
const WAARSCHUW = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3l9.5 17h-19z"/><path d="M12 10v4M12 17.5v.5"/></svg>`;

export function htmlPlannen(trainingen, teams, groepen = []){
  pl.teams = teams || [];
  const plannen = plannenUit(trainingen);
  if (!plannen.size){
    return `<div class="kaart leeg">Nog geen ingeplande blokken.<br>Upload een zip, of meerdere PDF's met namen als "Blok 2 - Week 1 - Training 1", en je plant het hele blok in één keer in.</div>`;
  }
  const nuMa = maandagVan(vandaagIso());
  return [...plannen.values()]
    .map(p => { const st = planStand(p.items); return { ...p, st, ks: [...st.keys()].sort() }; })
    .sort((x, y) => (y.ks[0] || y.plan.start || '').localeCompare(x.ks[0] || x.plan.start || ''))
    .map(({ plan, items, st, ks }) => {
      const ids = items[0].teams || [];
      const g = plan.groep ? groepen.find(x => x.id === plan.groep) : null;
      const teamsTxt = g ? `${g.naam || ('Groep ' + g.id)}, ${ids.length} team${ids.length === 1 ? '' : 's'}`
        : ids.length <= 3 ? ids.map(id => teams.find(t => t.id === id)?.naam || '?').join(', ') : `${ids.length} teams`;
      const zo = zichtbaarOptie(plan.zichtbaar);
      const kop = extra => `<div class="bp-plan-kop"><b>${esc(plan.naam || ('Blok ' + (plan.blok || '')))}</b>
            <span>${esc(teamsTxt)}<span class="sep" aria-hidden="true"></span>${nTr(items.length)}${extra}<span class="sep" aria-hidden="true"></span>zichtbaar: ${esc(zo.label.toLowerCase())}</span></div>`;
      if (!ks.length){
        return `<div class="kaart bp-plan">${kop('')}<p class="bp-hint">Deze trainingen staan niet meer in een week. Pas de week aan via de lijst.</p></div>`;
      }
      const eerste = ks[0], laatste = ks[ks.length - 1];
      const V = new Set(plan.vrij || []);
      const strook = [];
      for (let m = plusDagen(eerste, -7 * LEEG_VOOR); m <= plusDagen(laatste, 7 * LEEG_NA); m = plusDagen(m, 7)) strook.push(m);
      const chips = strook.map(m => {
        const c = st.get(m);
        const voorbij = m < nuMa, nu = m === nuMa;
        const vrij = !c && V.has(m);
        const cls = c ? 'plan' : vrij ? 'vrij' : 'leeg';
        const sub = c ? bwTekst(c) : vrij ? 'vrij' : 'leeg';
        const tik = !voorbij && (c || vrij);
        const label = `Week ${isoWeekNr(m)}, ${kortDatum(m)}: ${c ? `blok${bwTekst(c)}, ${nTr(c.n)}${voorbij ? ', al geweest' : ''}` : sub}${nu ? ', deze week' : ''}`;
        return `<button type="button" class="bp-wk ${cls}${voorbij ? ' voorbij' : ''}${nu ? ' nu' : ''}" data-bp-plan="${esc(plan.id)}" data-bp-m="${m}"${c ? ' data-bp-pak' : ''}${tik ? ' data-bp-tik' : ' aria-disabled="true"'} title="${esc(kortDatum(m))}${nu ? ', deze week' : ''}" aria-label="${esc(label)}">${c ? GRIP : ''}<b>${isoWeekNr(m)}</b><span>${voorbij && c ? '✓ ' : ''}${sub}</span></button>`;
      }).join('');
      return `
        <div class="kaart bp-plan">
          ${kop(`<span class="sep" aria-hidden="true"></span>wk ${isoWeekNr(eerste)} t/m ${isoWeekNr(laatste)}`)}
          <p class="bp-hint"><span class="bp-fijn">Sleep een week naar een andere week om de trainingen te verplaatsen.</span><span class="bp-grof">Houd een week even vast en sleep hem naar een andere week.</span> Valt er een week uit? Tik die week aan: alles daarna schuift een week op.</p>
          <div class="bp-weken">${chips}</div>
        </div>`;
    }).join('');
}

/* ---------- Slepen en tikken ---------- */
let sleep = null, sleepKlaar = 0, vensterGekoppeld = false;

export function koppelPlannen(v, trainingen, ctx){
  pl.v = v; pl.trainingen = trainingen; pl.ctx = ctx;
  const bak = v.querySelector('.bp-plannen');
  if (!bak || bak.dataset.bpGekoppeld) return;
  bak.dataset.bpGekoppeld = '1';
  bak.addEventListener('pointerdown', e => {
    const chip = e.target.closest('.bp-wk[data-bp-pak]');
    if (!chip || e.button > 0 || sleep) return;
    sleep = { chip, plan: chip.dataset.bpPlan, van: chip.dataset.bpM, x0: e.clientX, y0: e.clientY,
      pid: e.pointerId, vinger: e.pointerType !== 'mouse', actief: false, doel: null };
    // vinger: pas na even vasthouden, zodat gewoon scrollen blijft werken
    if (sleep.vinger) sleep.timer = setTimeout(() => sleep && beginSleep(sleep.x0, sleep.y0), 280);
  });
  bak.addEventListener('click', e => {
    const chip = e.target.closest('.bp-wk[data-bp-tik]');
    if (!chip || performance.now() - sleepKlaar < 450) return;    // net losgelaten na slepen: geen tik
    openZet({ soort: 'vrij', planId: chip.dataset.bpPlan, m: chip.dataset.bpM });
  });
  bak.addEventListener('contextmenu', e => { if (e.target.closest('.bp-wk')) e.preventDefault(); });
  koppelVenster();
}

function koppelVenster(){
  if (vensterGekoppeld) return;
  vensterGekoppeld = true;
  window.addEventListener('pointermove', e => {
    if (!sleep || e.pointerId !== sleep.pid) return;
    if (!sleep.actief){
      const d = Math.hypot(e.clientX - sleep.x0, e.clientY - sleep.y0);
      if (sleep.vinger){ if (d > 10) stopSleep(); return; }       // bewegen vóór het vasthouden = scrollen
      if (d < 6) return;
      beginSleep(e.clientX, e.clientY);
    }
    beweegSleep(e.clientX, e.clientY);
  });
  window.addEventListener('pointerup', e => {
    if (!sleep || e.pointerId !== sleep.pid) return;
    const s = sleep, doel = s.actief ? s.doel : null;
    if (s.actief) sleepKlaar = performance.now();
    stopSleep();
    if (doel) openZet({ soort: 'sleep', planId: s.plan, van: s.van, naar: doel.dataset.bpM, modus: 'rest' });
  });
  window.addEventListener('pointercancel', e => { if (sleep && e.pointerId === sleep.pid) stopSleep(); });
  document.addEventListener('touchmove', e => { if (sleep?.actief) e.preventDefault(); }, { passive: false });
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && sleep) stopSleep(); });
}

function beginSleep(x, y){
  const s = sleep; if (!s) return;
  clearTimeout(s.timer);
  const kaart = s.chip.closest('.bp-plan');
  if (!s.chip.isConnected || !kaart){ sleep = null; return; }
  s.actief = true;
  const r = s.chip.getBoundingClientRect();
  s.dx = x - r.left; s.dy = y - r.top;
  s.spook = s.chip.cloneNode(true);
  s.spook.classList.add('bp-spook');
  s.spook.removeAttribute('data-bp-pak'); s.spook.removeAttribute('data-bp-tik');
  s.spook.style.width = r.width + 'px'; s.spook.style.height = r.height + 'px';
  document.body.appendChild(s.spook);
  document.body.classList.add('bp-sleept');
  kaart.classList.add('bp-bron');
  s.chip.classList.add('bp-vast');
  kaart.querySelectorAll('.bp-wk').forEach(c => { if (c !== s.chip) c.classList.add('bp-doel'); });
  navigator.vibrate?.(10);
  beweegSleep(x, y);
}
function beweegSleep(x, y){
  const s = sleep;
  s.spook.style.transform = `translate(${x - s.dx}px, ${y - s.dy}px) rotate(-3deg) scale(1.06)`;
  const el = document.elementFromPoint(x, y)?.closest?.('.bp-wk.bp-doel') || null;
  const doel = el && el.dataset.bpPlan === s.plan ? el : null;
  if (doel === s.doel) return;
  zetDoel(s.doel, false); zetDoel(doel, true); s.doel = doel;
}
function zetDoel(c, aan){
  if (!c) return;
  const span = c.querySelector('span');
  c.classList.toggle('bp-op', aan);
  if (aan){ c.dataset.bpSub = span.textContent; span.textContent = c.hasAttribute('data-bp-pak') ? 'wissel' : 'hierheen'; }
  else if (c.dataset.bpSub != null){ span.textContent = c.dataset.bpSub; delete c.dataset.bpSub; }
}
function stopSleep(){
  const s = sleep; if (!s) return;
  clearTimeout(s.timer);
  zetDoel(s.doel, false);
  s.spook?.remove();
  document.body.classList.remove('bp-sleept');
  document.querySelectorAll('.bp-bron,.bp-vast,.bp-doel').forEach(el => el.classList.remove('bp-bron', 'bp-vast', 'bp-doel'));
  sleep = null;
}

/* Na opslaan tekent clubbeheer het scherm opnieuw: zet de scrollstand terug,
   zodat je door kunt slepen zonder elke keer naar boven te springen. */
function onthoudScroll(){
  const y = window.scrollY, lijst = [];
  for (let n = pl.v; n; n = n.parentElement) if (n.scrollTop) lijst.push([n, n.scrollTop]);
  return () => { window.scrollTo(0, y); lijst.forEach(([n, top]) => { if (n.isConnected) n.scrollTop = top; }); };
}

/* Teams die door de verplaatsing in één week twee keer hetzelfde training-
   nummer krijgen, omdat ze daar ook een training uit een andere reeks hebben. */
function dubbelNaZet(planId, items, zet){
  const uit = new Map(), gezien = new Set();
  for (const t of items){
    const oud = wsVan(t), ws = oud ? zet.get(oud) : null, nr = Number(t.trainingNr) || 0;
    if (!ws || !nr) continue;
    for (const o of pl.trainingen){
      if (o.id === t.id || o.plan?.id === planId) continue;
      if (wsVan(o) !== ws || (Number(o.trainingNr) || 0) !== nr) continue;
      for (const tid of (t.teams || [])){
        const k = `${tid}|${ws}|${nr}`;
        if (!(o.teams || []).includes(tid) || gezien.has(k)) continue;
        gezien.add(k);
        const gk = `${tid}|${ws}`;
        if (!uit.has(gk)) uit.set(gk, { naam: pl.teams.find(x => x.id === tid)?.naam || 'Een team', ws, nrs: [] });
        uit.get(gk).nrs.push(nr);
      }
    }
  }
  return [...uit.values()].map(d => ({ ...d, nrs: d.nrs.sort((a, b) => a - b) }));
}

/* Bevestigen en opslaan. v = { soort:'sleep', planId, van, naar, modus } of
   { soort:'vrij', planId, m }. */
function openZet(v){
  const items = pl.trainingen.filter(t => t.plan?.id === v.planId);
  if (!items.length) return;
  const plan = items[0].plan;
  const st0 = planStand(items);
  const nuMa = maandagVan(vandaagIso());
  const sleepVrij = v.soort === 'sleep' && !st0.has(v.naar);
  if (v.soort === 'sleep' && (!st0.has(v.van) || v.van === v.naar)) return;
  const titel = v.soort === 'vrij' ? (st0.has(v.m) ? 'Week laten vervallen' : 'Week terugzetten')
    : sleepVrij ? `${hoofd(bwTekst(st0.get(v.van)))} verplaatsen` : 'Weken wisselen';
  const zetScrollTerug = onthoudScroll();
  const aantal = r => [...r.zet.keys()].reduce((s, m) => s + (st0.get(m)?.n || 0), 0);

  openModal(`<h2>${esc(titel)}</h2><div id="bpZet"></div>`);
  const teken = () => {
    const root = document.getElementById('bpZet'); if (!root) return;
    let r, zin, knop, keuze = '', meldTekst;
    if (v.soort === 'vrij'){
      r = rekenVrij(items, plan.vrij, v.m);
      const n = aantal(r);
      zin = `Week ${isoWeekNr(v.m)} (vanaf ${esc(kortDatum(v.m))}) wordt ${r.wordtVrij ? '<b>vrij</b>' : 'weer een <b>trainingsweek</b>'}.
        ${n ? `${hoofd(nTr(n))} ${n === 1 ? 'schuift' : 'schuiven'} een week ${r.wordtVrij ? 'op' : 'terug'}, met titel en zichtbaarheid.` : 'Er hoeven geen trainingen te verschuiven.'}`;
      knop = n ? (r.wordtVrij ? `Schuif ${n} op` : `Zet ${n} terug`) : 'Opslaan';
      meldTekst = r.wordtVrij ? `Week ${isoWeekNr(v.m)} vrij, ${n} verschoven` : `Week ${isoWeekNr(v.m)} teruggezet`;
    } else if (!sleepVrij){
      r = rekenSleep(items, plan.vrij, v.van, v.naar, 'een');
      zin = `<b>${esc(hoofd(bwTekst(st0.get(v.van))))}</b> en <b>${esc(bwTekst(st0.get(v.naar)))}</b> wisselen van plek. De andere weken blijven staan.`;
      knop = `Wissel ${nTr(aantal(r))}`;
      meldTekst = 'Weken gewisseld';
    } else {
      const erna = [...st0.keys()].filter(c => c > v.van).length;
      const rest = erna ? rekenSleep(items, plan.vrij, v.van, v.naar, 'rest') : null;
      if (!rest || rest.botsing) v.modus = 'een';
      r = v.modus === 'rest' ? rest : rekenSleep(items, plan.vrij, v.van, v.naar, 'een');
      zin = `<b>${esc(hoofd(bwTekst(st0.get(v.van))))}</b> gaat van week ${isoWeekNr(v.van)} naar <b>week ${isoWeekNr(v.naar)}</b> (vanaf ${esc(kortDatum(v.naar))}).`
        + (v.modus === 'rest' ? ` De ${erna === 1 ? 'week' : erna + ' weken'} erna ${erna === 1 ? 'schuift' : 'schuiven'} mee.` : erna ? ' De andere weken blijven staan.' : '');
      if (erna) keuze = `
        <div class="bp-keuze">
          <div class="segment" role="group" aria-label="Wat verplaats je?">
            <button type="button" data-bp-modus="rest" class="${v.modus === 'rest' ? 'actief' : ''}" aria-pressed="${v.modus === 'rest'}"${rest.botsing ? ' aria-disabled="true"' : ''}>Deze week en alles erna</button>
            <button type="button" data-bp-modus="een" class="${v.modus === 'een' ? 'actief' : ''}" aria-pressed="${v.modus === 'een'}">Alleen deze week</button>
          </div>
          ${rest.botsing ? `<p class="bp-hint">Alles erna meeschuiven kan hier niet: week ${isoWeekNr(rest.botsing)} is al bezet.</p>` : ''}
        </div>`;
      const n = aantal(r);
      knop = `Verplaats ${nTr(n)}`;
      meldTekst = `${hoofd(nTr(n))} verplaatst`;
    }
    const rijen = [...r.zet].sort((a, b) => a[1].localeCompare(b[1])).map(([oud, nieuw]) => {
      const c = st0.get(oud), zv = zichtbaarDatum(nieuw, plan.zichtbaar);
      return `<tr><td class="bp-bw">${esc(hoofd(bwTekst(c)))}<small>${nTr(c.n)}</small></td><td>wk ${isoWeekNr(oud)} → <b>wk ${isoWeekNr(nieuw)}</b></td><td class="bp-zv">${zv ? esc(kortDatum(zv)) : 'meteen'}</td></tr>`;
    }).join('');
    const verleden = [...new Set([...r.zet.values()].filter(m => m < nuMa))].sort();
    const dubbel = dubbelNaZet(plan.id, items, r.zet);
    root.innerHTML = `
      <p class="bp-uitleg">${zin}</p>
      ${keuze}
      ${rijen ? `<table class="bp-tabel"><thead><tr><th>Blok</th><th>Wordt</th><th>Zichtbaar vanaf</th></tr></thead><tbody>${rijen}</tbody></table>` : ''}
      ${verleden.length ? `<div class="mm-samenv warn bp-let">${WAARSCHUW}<span>Let op: week ${verleden.map(isoWeekNr).join(' en ')} is al voorbij. Je kunt de trainingen daarna gewoon weer verslepen.</span></div>` : ''}
      ${dubbel.length ? `<div class="mm-samenv warn bp-let">${WAARSCHUW}<span>${dubbel.slice(0, 3).map(d => `<b>${esc(d.naam)}</b> heeft in week ${isoWeekNr(d.ws)} al training ${d.nrs.join(' en ')} uit een andere reeks`).join('. ')}${dubbel.length > 3 ? `, en dat geldt voor nog ${dubbel.length - 3} ${dubbel.length - 3 === 1 ? 'week of team' : 'weken of teams'}` : ''}. Die training staat er dan dubbel.</span></div>` : ''}
      ${r.zet.size ? `<p class="bp-hint">Heb je een titel van een van deze trainingen met de hand aangepast, dan wordt die weer "Week … - training …".</p>` : ''}
      <button class="knop fluo vol u-mt-xs" id="bpSchuif">${knop}</button>
      <button class="knop licht vol u-mt-xs" id="bpAnnuleer">Annuleren</button>`;
    root.querySelectorAll('[data-bp-modus]').forEach(b => b.onclick = () => {
      if (b.getAttribute('aria-disabled') === 'true') return;
      v.modus = b.dataset.bpModus; teken();
      document.querySelector(`#bpZet [data-bp-modus="${v.modus}"]`)?.focus();
    });
    $('#bpAnnuleer').onclick = () => sluitModal();
    $('#bpSchuif').onclick = () => bewaarZet(plan, items, r, meldTekst, zetScrollTerug);
  };
  teken();
}

async function bewaarZet(plan, items, r, meldTekst, zetScrollTerug){
  const knop = $('#bpSchuif'); knop.disabled = true; knop.textContent = 'Bezig…';
  try {
    const batch = writeBatch(db);
    for (const t of items){
      // plan.start blijft de week van de eerste training, zodat het plan zelf blijft kloppen
      const upd = { 'plan.vrij': r.vrij, 'plan.start': r.eerste };
      const oud = wsVan(t), ws = oud ? r.zet.get(oud) : null;
      if (ws){
        upd.weekStart = ws;
        upd.week = weekLabel(ws);
        upd.titel = titelVoor(ws, t.trainingNr || 1);
        upd.zichtbaarVanaf = zichtbaarDatum(ws, plan.zichtbaar);
      }
      batch.update(doc(db, 'trainingen', t.id), upd);
    }
    await batch.commit();
  } catch(e){
    console.error('[blokplan] verplaatsen mislukt', e);
    meld('Opslaan mislukt: ' + (e.code || e.message));
    knop.disabled = false; knop.textContent = 'Opnieuw proberen';
    return;
  }
  sluitModal();
  meld(meldTekst);
  try { await pl.ctx?.renderClub?.(); zetScrollTerug(); }
  catch(e){ console.error('[blokplan] hertekenen mislukt', e); }
}
