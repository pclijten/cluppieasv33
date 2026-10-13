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

   De gewone upload (één PDF, of meerdere PDF's verdelen per groep) blijft
   ongewijzigd; deze flow start alleen bij een zip of bij meerdere PDF's met
   blok-namen. Alle extra velden op een training zijn optioneel:
     plan { id, naam, blok, start, vrij[], zichtbaar, weken, groep? }
     blokWeek, trainingNr, weekStart (maandag, 'YYYY-MM-DD'),
     zichtbaarVanaf ('YYYY-MM-DD' of null = meteen)
   Trainingen zonder deze velden gedragen zich precies zoals voorheen.

   club.js levert via `ctx` wat hier nodig is maar daar woont (groepen,
   bouwen, het preview-scherm, renderClub), zodat er geen kringimport ontstaat. */
import { db, doc, writeBatch } from './firebase.js?v=20260922c';
import { S, $, esc, meld, openModal, sluitModal } from './state.js?v=20260922c';
import {
  voegToeAanWachtrij, voegConceptToe, bewaarConcept, conceptNaarRij, verwijderJob, bestandenVanJob, htmlModelKeuze
} from './upload-wachtrij.js?v=20261013d';

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
  return delen.length ? delen.join(' · ') : 'Trainingsreeks';
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
  if (g) return `${g.naam || ('Groep ' + g.id)} · ${st.teams.size} team${st.teams.size === 1 ? '' : 's'}`;
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
      ${a.thema || (a.voor && a.blokken.some(Boolean)) ? `<div class="bp-thema">${esc([a.blokken.some(Boolean) ? a.voor : '', a.thema].filter(Boolean).join(' · '))}</div>` : ''}
      <div class="bp-tellers">
        <div><b>${st.weken}</b><span>weken</span></div>
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
        <summary>Losse teams aanvinken${st.teams.size ? ` · ${st.teams.size} gekozen` : ''}</summary>
        ${losseTeams || '<p class="bp-hint">Maak eerst teams aan in deze club.</p>'}
      </details>
      <p class="bp-hint">Elk team krijgt zijn eigen trainingsdagen: training 1 op de eerste dag, training 2 op de tweede. Zo werkt Cluppie nu ook al.</p>
    </div>
    <button class="knop vol" id="bpVerder" ${!st.teams.size || meerBlok ? 'disabled' : ''}>Verder naar planning</button>
    <button class="link" id="bpOud" style="display:block;margin:12px auto 0">Toch zoals nu verdelen (zonder planning)</button>
    <p class="bp-hint" style="text-align:center">Wegklikken mag: je vindt deze upload terug bovenaan Trainingen.</p>`;
}

/* ---------- Stap 2: planning ---------- */
function dubbeleItems(st, ctx){
  return st.a.items.filter(it => (ctx.trainingen || []).some(t =>
    t.bestandsnaam === it.naam && (t.teams || []).some(id => st.teams.has(id))));
}

function htmlPlanning(st, ctx){
  const map = planWeken(st.start, st.vrij, st.weken);
  const laatste = map[map.length - 1];
  const strip = [];
  for (let m = st.start; m <= plusDagen(laatste, 7); m = plusDagen(m, 7)) strip.push(m);
  const chips = strip.map(m => {
    const k = map.indexOf(m);
    const vrij = st.vrij.includes(m);
    const cls = vrij ? 'vrij' : k >= 0 ? 'plan' : 'leeg';
    const sub = vrij ? 'vrij' : k >= 0 ? `week ${k + 1}` : 'leeg';
    return `<button type="button" class="bp-wk ${cls}" data-bp-wk="${m}" ${cls === 'leeg' ? 'disabled' : ''} aria-pressed="${vrij}" title="${esc(kortDatum(m))}"><b>${isoWeekNr(m)}</b><span>${sub}</span></button>`;
  }).join('');
  const rijen = map.map((m, i) => {
    const zv = zichtbaarDatum(m, st.zichtbaar);
    const th = weekThema(st.a, i + 1);
    return `<tr><td class="bp-bw">Week ${i + 1}${th ? `<small>${esc(th)}</small>` : ''}</td><td>wk ${isoWeekNr(m)} · ${esc(kortDatum(m))}</td><td class="bp-zv">${zv ? esc(kortDatum(zv)) : 'meteen'}</td></tr>`;
  }).join('');
  const dubbel = dubbeleItems(st, ctx);
  const aantal = st.a.items.length - dubbel.length;
  const eerste = st.a.items[0];
  return `
    <div class="bp-sub">${esc(planNaam(st.a))} · ${esc(teamsTekst(st, ctx))}</div>
    <div class="bp-start">
      <button type="button" class="bp-pijl" data-bp-start="-7" aria-label="Een week eerder">${pijl('l')}</button>
      <div class="bp-start-m"><small>Blokweek 1 wordt</small><b>Week ${isoWeekNr(st.start)} · vanaf ${esc(kortDatum(st.start))}</b></div>
      <button type="button" class="bp-pijl" data-bp-start="7" aria-label="Een week later">${pijl('r')}</button>
    </div>
    <p class="bp-hint">Tik een week aan om hem over te slaan, bijvoorbeeld bij vakantie. De rest schuift mee.</p>
    <div class="bp-weken">${chips}</div>
    <div class="veldgroep" style="margin-top:14px"><label for="bpZicht">Zichtbaar voor coaches</label>
      <select class="invoer" id="bpZicht">${ZICHTBAAR_OPTIES.map(o => `<option value="${o.id}" ${o.id === st.zichtbaar ? 'selected' : ''}>${o.label}</option>`).join('')}</select>
      <p class="bp-hint">Eén keuze voor het hele blok: alle trainingen van een week worden tegelijk zichtbaar.</p>
    </div>
    <table class="bp-tabel"><thead><tr><th>Blok</th><th>Week</th><th>Zichtbaar vanaf</th></tr></thead><tbody>${rijen}</tbody></table>
    ${htmlModelKeuze('bpModel', st.aiModel || 'standaard')}
    <div class="bp-voorbeeld"><small>Zo staat het in de lijst</small><b>${esc(titelVoor(map[eerste.week - 1], eerste.nr))}</b><span>${esc(eerste.naam)}</span></div>
    ${dubbel.length ? `<div class="mm-samenv warn">${dubbel.length} training${dubbel.length === 1 ? ' staat' : 'en staan'} al bij deze teams en ${dubbel.length === 1 ? 'wordt' : 'worden'} overgeslagen.</div>` : ''}
    <button class="knop vol" id="bpStart" ${aantal ? '' : 'disabled'}>Verwerk ${aantal} training${aantal === 1 ? '' : 'en'}</button>
    <p class="bp-hint" style="text-align:center">Het verwerken loopt op de achtergrond; je kunt meteen verder.</p>
    <button class="link" id="bpTerug" style="display:block;margin:10px auto 0">Terug</button>`;
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
  const map = planWeken(st.start, st.vrij, st.weken);
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
    ...(st.groepId ? { groep: st.groepId } : {}),
  };
  const items = st.a.items.map(it => {
    const ws = map[it.week - 1];
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
  meld(`${n} training${n === 1 ? '' : 'en'} in de wachtrij · voortgang bovenaan Trainingen`);
  ctx.renderClub?.();
}

/* ==================== Plannen-weergave (clubbeheer → Trainingen) ==================== */
function plannenUit(trainingen){
  const plannen = new Map();
  for (const t of trainingen){
    const id = t.plan?.id; if (!id) continue;
    if (!plannen.has(id)) plannen.set(id, { plan: t.plan, items: [] });
    plannen.get(id).items.push(t);
  }
  return plannen;
}

export function htmlPlannen(trainingen, teams, groepen = []){
  const plannen = plannenUit(trainingen);
  if (!plannen.size){
    return `<div class="kaart leeg">Nog geen ingeplande blokken.<br>Upload een zip, of meerdere PDF's met namen als "Blok 2 - Week 1 - Training 1", en je plant het hele blok in één keer in.</div>`;
  }
  const nuMa = maandagVan(vandaagIso());
  return [...plannen.values()]
    .sort((x, y) => (y.plan.start || '').localeCompare(x.plan.start || ''))
    .map(({ plan, items }) => {
      const aantal = plan.weken || Math.max(...items.map(i => i.blokWeek || 1));
      const map = planWeken(plan.start, plan.vrij, aantal);
      const laatste = map[map.length - 1];
      const strip = [];
      for (let m = plan.start; m <= plusDagen(laatste, 7); m = plusDagen(m, 7)) strip.push(m);
      const chips = strip.map(m => {
        const k = map.indexOf(m);
        const vrij = (plan.vrij || []).includes(m);
        const voorbij = m <= nuMa;
        const cls = vrij ? 'vrij' : k >= 0 ? 'plan' : 'leeg';
        const sub = vrij ? 'vrij' : k >= 0 ? `week ${k + 1}` : 'leeg';
        const uit = voorbij || cls === 'leeg';
        return `<button type="button" class="bp-wk ${cls}${voorbij ? ' voorbij' : ''}" data-bp-pwk="${m}" data-bp-plan="${esc(plan.id)}" ${uit ? 'disabled' : ''} aria-pressed="${vrij}" title="${esc(kortDatum(m))}"><b>${isoWeekNr(m)}</b><span>${voorbij && k >= 0 ? '✓ ' : ''}${sub}</span></button>`;
      }).join('');
      const ids = items[0].teams || [];
      const g = plan.groep ? groepen.find(x => x.id === plan.groep) : null;
      const teamsTxt = g ? `${g.naam || ('Groep ' + g.id)} · ${ids.length} team${ids.length === 1 ? '' : 's'}`
        : ids.length <= 3 ? ids.map(id => teams.find(t => t.id === id)?.naam || '?').join(', ') : `${ids.length} teams`;
      const zo = zichtbaarOptie(plan.zichtbaar);
      return `
        <div class="kaart bp-plan">
          <div class="bp-plan-kop"><b>${esc(plan.naam || ('Blok ' + (plan.blok || '')))}</b>
            <span>${esc(teamsTxt)} · ${items.length} training${items.length === 1 ? '' : 'en'} · wk ${isoWeekNr(map[0])} t/m ${isoWeekNr(laatste)} · zichtbaar: ${esc(zo.label.toLowerCase())}</span></div>
          <p class="bp-hint">Valt er een week uit? Tik die week aan: alle trainingen daarna schuiven een week op, met titel en zichtbaarheid. Nog een keer tikken zet het terug.</p>
          <div class="bp-weken">${chips}</div>
        </div>`;
    }).join('');
}

export function koppelPlannen(v, trainingen, ctx){
  v.querySelectorAll('[data-bp-pwk]').forEach(b => b.onclick = () =>
    wijzigVrijeWeek(b.dataset.bpPlan, b.dataset.bpPwk, trainingen, ctx));
}

function wijzigVrijeWeek(planId, maandag, trainingen, ctx){
  const items = trainingen.filter(t => t.plan?.id === planId);
  if (!items.length) return;
  const plan = items[0].plan;
  const vrij = new Set(plan.vrij || []);
  const wordtVrij = !vrij.has(maandag);
  wordtVrij ? vrij.add(maandag) : vrij.delete(maandag);
  const nieuweVrij = [...vrij].sort();
  const aantal = plan.weken || Math.max(...items.map(i => i.blokWeek || 1));
  const map = planWeken(plan.start, nieuweVrij, aantal);
  const nuMa = maandagVan(vandaagIso());
  // alleen toekomstige weken verschuiven; wat in deze of een eerdere week valt blijft staan
  const wijzig = items.map(t => {
    const ws = map[(t.blokWeek || 1) - 1];
    if (!ws || ws === t.weekStart || (t.weekStart || '') <= nuMa) return null;
    return { t, ws };
  }).filter(Boolean);

  const perBlokweek = new Map();
  wijzig.forEach(w => { if (!perBlokweek.has(w.t.blokWeek)) perBlokweek.set(w.t.blokWeek, w); });
  const rijen = [...perBlokweek.entries()].sort((a, b) => a[0] - b[0]).map(([bw, w]) =>
    `<tr><td class="bp-bw">Week ${bw}</td><td>${esc(weekLabel(w.t.weekStart))} → <b>${esc(weekLabel(w.ws))}</b></td></tr>`).join('');

  openModal(`
    <h2>${wordtVrij ? 'Week laten vervallen' : 'Week terugzetten'}</h2>
    <p class="bp-uitleg">Week ${isoWeekNr(maandag)} (vanaf ${esc(kortDatum(maandag))}) wordt ${wordtVrij ? '<b>vrij</b>' : 'weer een <b>trainingsweek</b>'}.
      ${wijzig.length ? `${wijzig.length} training${wijzig.length === 1 ? ' schuift' : 'en schuiven'} een week ${wordtVrij ? 'op' : 'terug'}, met titel en zichtbaarheid.` : 'Er hoeven geen trainingen te verschuiven.'}</p>
    ${rijen ? `<table class="bp-tabel"><thead><tr><th>Blok</th><th>Wordt</th></tr></thead><tbody>${rijen}</tbody></table>` : ''}
    <p class="bp-hint">Heb je een titel van een van deze trainingen met de hand aangepast, dan wordt die weer "Week … - training …".</p>
    <button class="knop vol" id="bpSchuif">${wijzig.length ? (wordtVrij ? `Schuif ${wijzig.length} op` : `Zet ${wijzig.length} terug`) : 'Opslaan'}</button>
    <button class="knop licht vol" id="bpAnnuleer" style="margin-top:8px">Annuleren</button>`);
  $('#bpAnnuleer').onclick = () => sluitModal();
  $('#bpSchuif').onclick = async () => {
    const knop = $('#bpSchuif'); knop.disabled = true; knop.textContent = 'Bezig…';
    try {
      const batch = writeBatch(db);
      const gewijzigd = new Map(wijzig.map(w => [w.t.id, w.ws]));
      for (const t of items){
        const upd = { 'plan.vrij': nieuweVrij };
        const ws = gewijzigd.get(t.id);
        if (ws){
          upd.weekStart = ws;
          upd.week = weekLabel(ws);
          upd.titel = titelVoor(ws, t.trainingNr || 1);
          upd.zichtbaarVanaf = zichtbaarDatum(ws, plan.zichtbaar);
        }
        batch.update(doc(db, 'trainingen', t.id), upd);
      }
      await batch.commit();
      sluitModal();
      meld(wordtVrij ? `Week ${isoWeekNr(maandag)} vrij · ${wijzig.length} verschoven` : `Week ${isoWeekNr(maandag)} teruggezet`);
      ctx.renderClub?.();
    } catch(e){
      console.error('[blokplan] verschuiven mislukt', e);
      meld('Opslaan mislukt: ' + (e.code || e.message));
      knop.disabled = false; knop.textContent = 'Opnieuw proberen';
    }
  };
}
