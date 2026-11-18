/* ==================== TRAININGSHULP (Lijstjes) ====================
   [20261118a] Vijfde startpunt in Lijstjes: per training een aantal helpers,
   waar ouders zich via een link zelf voor inschrijven (zonder account).

   Datamodel — twee plekken:
   1) teams/{teamId}/lijsten/{id}: alleen de "kaart" in Lijstjes
        { naam, sjabloon:'trainingshulp', rijen:'trainingen', hulpDeelId,
          gearchiveerd, seizoen, gemaaktDoor, gemaaktMs, bijgewerktMs }
   2) hulpDeel/{deelId}: alles wat een ouder via de link mag zien
        { teamId, lijstId, teamNaam, titel, open, standaard,
          momenten:{ d20261123:{ datum:'2026-11-23', start, eind, nodig } },
          gemaaktDoor, gemaaktMs, bijgewerktMs }
      hulpDeel/{deelId}/aanmeldingen/{id}: één helper bij één training
        { uid, rij:'d20261123', naam, ms, door:'ouder'|'coach' }
      Een ouder schrijft onder het vaste id <uid>_<rij> (één aanmelding per
      training per toestel); de staf schrijft met een automatisch id.

   Er is dus één bron: de staf en de ouder lezen dezelfde documenten. Staat de
   link uit (open:false), dan laten de Firestore-rules alleen de staf erbij.
   De rules staan niet in deze repo: zie TRAININGSHULP-RULES.md.

   AVG: op de pagina van de ouder staan alleen trainingsdata en voornamen van
   helpers. Geen spelers, geen andere lijstjes.

   Dit bestand importeert niet uit teams-lijsten.js (geen circulaire import):
   teams-lijsten.js roept de functies hieronder aan en geeft renderTeam mee. */
import { db, doc, collection, setDoc, addDoc, updateDoc, deleteDoc, deleteField, getDocs, writeBatch, onSnapshot } from './firebase.js?v=20261106r';
import { S, $, $$, esc, meld, openModal, sluitModal } from './state.js?v=20261111g';
import { SEIZOEN_FALLBACK } from './config.js?v=20261111g';
import { ico } from './icons.js?v=20261106r';
import { momentenVanTeam, DAGEN_LANG, DAGEN_KORT } from './trainingsmomenten.js?v=20261111g';

const MAX_HELPERS = 6;
const MAX_TRAININGEN = 120;
const NAAM_MAX = 24;

export const isHulp = l => !!l && l.rijen === 'trainingen';

/* ---------- Datums (lokale tijd, geen UTC-verschuiving rond middernacht) ---------- */
const isoLokaal = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const vandaag = () => isoLokaal(new Date());
const datumObj = iso => new Date(iso + 'T12:00');
const rijId = iso => 'd' + String(iso).replace(/-/g, '');
function plusDagen(iso, n){ const d = datumObj(iso); d.setDate(d.getDate() + n); return isoLokaal(d); }
const weekdagNr = iso => (datumObj(iso).getDay() + 6) % 7 + 1;   // 1 = maandag … 7 = zondag
const tijdTekst = m => m.start && m.eind ? `${m.start}–${m.eind}` : (m.start || '');
function datumKort(iso){
  try { return datumObj(iso).toLocaleDateString('nl-NL', { weekday:'short', day:'numeric', month:'short' }).replace(/\./g, ''); }
  catch(e){ return iso; }
}
const meerv = (n, een, meer) => `${n} ${n === 1 ? een : meer}`;

/* ---------- Iconen (lijn 1.8–2, currentColor) ---------- */
const svg = (pad, maat = 16, dikte = 2) => `<svg width="${maat}" height="${maat}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${dikte}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${pad}</svg>`;
const I_MIN = svg('<path d="M6 12h12"/>');
const I_PLUS = svg('<path d="M6 12h12M12 6v12"/>');
const I_X = svg('<path d="M6 6l12 12M18 6L6 18"/>');
const I_LINK = svg('<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>', 18, 1.8);
const I_SLOT = svg('<rect x="4.6" y="10.4" width="14.8" height="9.8" rx="2.4"/><path d="M8 10.4V8a4 4 0 0 1 8 0v2.4"/><circle cx="12" cy="15.2" r="1.4" fill="currentColor" stroke="none"/>', 20, 1.8);
const AVG_LINK = 'Wie de link heeft, ziet alleen de trainingsdata en de voornamen van helpers. Geen spelers, geen andere lijstjes.';

/* ---------- Firestore ---------- */
const deelRef = id => doc(db, 'hulpDeel', id);
const aanmCol = id => collection(db, 'hulpDeel', id, 'aanmeldingen');
const hulpVan = l => (S._hulp || {})[l?.hulpDeelId] || null;
const foutTekst = e => e?.code === 'permission-denied'
  ? 'geen toegang. De Firestore-rules voor Trainingshulp zijn waarschijnlijk nog niet gepubliceerd.'
  : (e?.code || e?.message || 'onbekende fout');

async function schrijfDeel(id, velden){
  try { await updateDoc(deelRef(id), { ...velden, bijgewerktMs:Date.now() }); return true; }
  catch(e){ console.error('[Cluppie] trainingshulp opslaan', e); meld('Opslaan mislukt: ' + foutTekst(e)); return false; }
}

/* Luisteraars per trainingshulp-lijst: het deel-document en de aanmeldingen.
   Wordt bij elke wijziging van de lijsten opnieuw aangeroepen; bestaande
   luisteraars blijven staan, verdwenen lijsten worden opgeruimd. */
let _unsubs = {};
function stop(id){
  (_unsubs[id] || []).forEach(u => { try { u(); } catch(e){ /* al gestopt */ } });
  delete _unsubs[id];
  if (S._hulp) delete S._hulp[id];
}
export function hulpSync(lijsten, herteken){
  const nodig = new Set((lijsten || []).filter(l => isHulp(l) && l.hulpDeelId).map(l => l.hulpDeelId));
  for (const id of Object.keys(_unsubs)) if (!nodig.has(id)) stop(id);
  S._hulp ||= {};
  for (const id of nodig){
    if (_unsubs[id]) continue;
    S._hulp[id] = { deel:null, aanm:[], geladen:false, fout:'' };
    const fout = e => {
      const h = S._hulp?.[id]; if (!h) return;
      console.error('[Cluppie] trainingshulp laden', e);
      h.fout = e?.code || 'fout'; h.geladen = true; herteken();
    };
    _unsubs[id] = [
      onSnapshot(deelRef(id), snap => {
        const h = S._hulp?.[id]; if (!h) return;
        h.deel = snap.exists() ? snap.data() : null; h.geladen = true;
        h.fout = snap.exists() ? '' : 'weg';
        herteken();
      }, fout),
      onSnapshot(aanmCol(id), snap => {
        const h = S._hulp?.[id]; if (!h) return;
        h.aanm = snap.docs.map(d => ({ id:d.id, ...d.data() }));
        herteken();
      }, fout),
    ];
  }
}
export function hulpStop(){
  for (const id of Object.keys(_unsubs)) stop(id);
  _unsubs = {}; S._hulp = {};
}

/* ---------- Rijen ---------- */
function rijen(l, metEerder = true){
  const h = hulpVan(l);
  const m = h?.deel?.momenten || {};
  const nu = vandaag();
  return Object.entries(m)
    .filter(([, x]) => x && x.datum)
    .map(([id, x]) => ({
      id, datum:String(x.datum), start:x.start || '', eind:x.eind || '',
      nodig:Math.max(0, Number(x.nodig) || 0),
      helpers:(h.aanm || []).filter(a => a.rij === id && a.naam).sort((a, b) => (a.ms || 0) - (b.ms || 0)),
      verleden:String(x.datum) < nu,
    }))
    .filter(r => metEerder || !r.verleden)
    .sort((a, b) => a.datum.localeCompare(b.datum));
}
const openPlekken = r => Math.max(0, r.nodig - r.helpers.length);

/* Voortgang op de kaart in het overzicht: komende trainingen met genoeg hulp. */
export function hulpVoortgang(l){
  const rs = rijen(l, false);
  return { c:rs.filter(r => !openPlekken(r)).length, t:rs.length };
}
/* Badge op de hub-tegel: alleen trainingen in de komende 7 dagen zonder genoeg
   hulp. Een lijst van acht weken zou de badge anders wekenlang hoog houden. */
export function hulpOpenBinnenkort(l){
  if (!hulpVan(l)?.deel) return 0;
  const tot = plusDagen(vandaag(), 7);
  return rijen(l, false).filter(r => r.datum <= tot && openPlekken(r)).length;
}

/* ==================== ÉÉN LIJST ==================== */
function samenvatting(l){
  const rs = rijen(l, false);
  const tot = rs.reduce((n, r) => n + r.nodig, 0);
  const gevuld = rs.reduce((n, r) => n + Math.min(r.nodig, r.helpers.length), 0);
  const open = rs.filter(r => openPlekken(r)).length;
  const viaLink = rs.reduce((n, r) => n + r.helpers.filter(a => a.door === 'ouder').length, 0);
  const aan = hulpVan(l)?.deel?.open === true;
  return `<div class="lj-samen"><div class="lj-samen-top"><span class="lj-getal">${gevuld}<small>/${tot}</small></span><span class="lj-lbl">plekken gevuld</span></div>
    <div class="lj-samen-rij"><div class="lj-samen-k"><span class="lj-tel">Compleet<b>${rs.length - open}</b></span>${open ? `<span class="lj-tel open">Nog hulp nodig <b>${open}</b></span>` : ''}</div></div>
    <div class="lh-link ${aan ? 'aan' : ''}">${I_LINK}<span>${aan
      ? `Inschrijven via de link staat aan. <b>${viaLink}</b> ${viaLink === 1 ? 'aanmelding kwam' : 'aanmeldingen kwamen'} van ouders zelf.`
      : 'De inschrijflink staat uit. Alleen de staf vult namen in.'}</span></div></div>`;
}

function rijHtml(r, bewerkbaar){
  const d = datumObj(r.datum);
  const mnd = d.toLocaleDateString('nl-NL', { month:'short' }).replace('.', '');
  const dagNaam = DAGEN_LANG[weekdagNr(r.datum) - 1];
  const open = openPlekken(r);
  const status = r.nodig === 0 && !r.helpers.length ? ['geen', 'Geen hulp nodig']
    : open ? ['open', `Nog ${open} nodig`] : ['ok', 'Compleet'];
  const tijd = tijdTekst(r);
  const kanBewerken = bewerkbaar && !r.verleden;
  const helpers = r.helpers.map(a => `<span class="lh-helper"><span class="lh-hn"><b>${esc(a.naam)}</b>${a.door === 'ouder' ? '<small>via link</small>' : ''}</span>${bewerkbaar
    ? `<button data-lh-weg="${esc(a.id)}" aria-label="${esc(a.naam)} weghalen" title="Weghalen">${I_X}</button>` : ''}</span>`).join('');
  const leeg = kanBewerken ? Array.from({ length:open }, () =>
    `<input class="lh-inv" type="text" data-lh-nieuw="${esc(r.id)}" placeholder="Naam ouder…" maxlength="${NAAM_MAX}" autocomplete="off" aria-label="Naam ouder invullen voor ${esc(dagNaam.toLowerCase())} ${d.getDate()} ${esc(mnd)}">`).join('') : '';
  const teller = kanBewerken ? `<span class="lh-tel" role="group" aria-label="Aantal helpers">
      <button data-lh-min="${esc(r.id)}" aria-label="Een helper minder" ${r.nodig <= 0 ? 'disabled' : ''}>${I_MIN}</button><b>${r.nodig}</b><button data-lh-plus="${esc(r.id)}" aria-label="Een helper meer" ${r.nodig >= MAX_HELPERS ? 'disabled' : ''}>${I_PLUS}</button></span>` : '';
  return `<div class="lj-rk lh-rk ${open && !r.verleden ? 'open' : ''} ${r.verleden ? 'verleden' : ''}">
    <div class="lj-rk-kop"><span class="lj-dag"><b>${d.getDate()}</b><small>${esc(mnd)}</small></span>
      <span class="lj-naam">${esc(dagNaam)}${tijd ? ` <span class="lh-tijd">${esc(tijd)}</span>` : ''}<small class="lh-status ${status[0]}">${status[1]}</small></span>${teller}</div>
    ${helpers || leeg ? `<div class="lh-plekken">${helpers}${leeg}</div>` : ''}</div>`;
}

const leegKaart = tekst => `<div class="kaart leeg">${tekst}</div>`;
const menuKnop = '<button class="lj-menu" id="ljMenu" title="Meer">⋯</button>';

/* o: { breed, filter:'alle'|'open', toonEerder } — de filterstand leeft in
   teams-lijsten.js (S._ljFilter / S._ljToonEerder), net als bij andere lijsten. */
export function htmlHulpLijst(l, o){
  const h = hulpVan(l);
  if (!l.hulpDeelId || (h && h.geladen && !h.deel)){
    const waarom = h?.fout === 'permission-denied'
      ? 'Geen toegang tot deze trainingshulp. De Firestore-rules voor Trainingshulp zijn waarschijnlijk nog niet gepubliceerd.'
      : 'De gegevens van deze lijst zijn niet gevonden. Verwijder de lijst via ⋯ en maak een nieuwe.';
    return `<div class="lj-balkje"><span class="lj-bron">Trainingshulp</span>${menuKnop}</div>${leegKaart(waarom)}`;
  }
  if (!h || !h.geladen) return leegKaart('Bezig met laden…');

  const alle = rijen(l, true);
  const komend = alle.filter(r => !r.verleden);
  const eerder = alle.length - komend.length;
  const openN = komend.filter(r => openPlekken(r)).length;
  const filter = o.filter === 'open' ? 'open' : 'alle';
  let toon = o.toonEerder ? alle : komend;
  if (filter === 'open') toon = toon.filter(r => !r.verleden && openPlekken(r));
  const bewerkbaar = !l.gearchiveerd;
  const aan = h.deel.open === true;
  const std = Math.max(0, Number(h.deel.standaard) || 0);

  const lijf = !alle.length ? leegKaart('Nog geen trainingen in deze lijst. Voeg ze toe via ⋯ en dan Trainingen beheren.')
    : toon.length ? `<div class="lh-rijen">${toon.map(r => rijHtml(r, bewerkbaar)).join('')}</div>`
    : leegKaart(filter === 'open' ? 'Elke training heeft genoeg hulp.' : 'Alle trainingen in deze lijst zijn geweest.');
  const inhoud = `
    <div class="lj-balkje">
      <span class="lj-bron">Rijen = trainingen<span class="sep" aria-hidden="true"></span>standaard ${meerv(std, 'helper', 'helpers')}, per training aan te passen</span>
      ${bewerkbaar ? `<button class="lj-datumchip ${aan ? '' : 'leeg'}" id="lhLink">${I_LINK} Inschrijflink ${aan ? '<span class="pl">aan</span>' : 'uit'}</button>` : ''}
      ${menuKnop}
    </div>
    ${l.gearchiveerd ? `<div class="lj-archbalk">Gearchiveerd <button id="ljHerstel">Terugzetten</button></div>` : ''}
    ${o.breed ? '' : samenvatting(l)}
    <div class="lj-filters">
      <button class="${filter === 'alle' ? 'aan' : ''}" data-lj-filter="alle">Alle</button>
      <button class="${filter === 'open' ? 'aan' : ''}" data-lj-filter="open">Nog hulp nodig (${openN})</button>
      ${eerder ? `<button class="${o.toonEerder ? 'aan' : ''}" id="ljEerder">${o.toonEerder ? 'Verberg' : 'Toon'} geweest (${eerder})</button>` : ''}
    </div>
    ${lijf}`;
  const knop = !bewerkbaar ? ''
    : aan ? `<button class="knop fluo vol lj-deel" id="lhDeel">${ico('action-whatsapp', 18)} Inschrijflink delen</button>`
    : `<button class="knop vol lj-deel" id="lhAan">Inschrijflink aanzetten</button>`;
  if (o.breed) return `<div class="lj-desk"><div class="lj-desk-hoofd">${inhoud}</div><aside class="lj-desk-zij">${samenvatting(l)}${knop}</aside></div>`;
  return inhoud + (knop ? `<div class="lj-onder">${knop}</div>` : '');
}

export async function hulpZetOpen(l, aan){
  const h = hulpVan(l); if (!l?.hulpDeelId) return false;
  const ok = await schrijfDeel(l.hulpDeelId, { open:!!aan });
  if (ok && h?.deel) h.deel.open = !!aan;
  return ok;
}
/* Naam van de lijst gewijzigd: de titel op de pagina van de ouder gaat mee. */
export function hulpZetTitel(l, titel){
  if (!l?.hulpDeelId) return;
  updateDoc(deelRef(l.hulpDeelId), { titel:String(titel || '').slice(0, 60), bijgewerktMs:Date.now() }).catch(() => {});
}

/* api: { renderTeam } */
export function koppelHulpLijst(v, l, api){
  const h = hulpVan(l); if (!h?.deel) return;
  const id = l.hulpDeelId;
  const q = s => v.querySelector(s);
  for (const b of [q('#lhDeel'), q('#lhLink')]) if (b) b.onclick = () => modalLink(l, api);
  const aanKnop = q('#lhAan');
  if (aanKnop) aanKnop.onclick = async () => { if (await hulpZetOpen(l, true)){ meld('Inschrijflink staat aan'); api.renderTeam(); } };

  // − / +: aantal helpers voor die ene training
  v.querySelectorAll('[data-lh-min],[data-lh-plus]').forEach(b => b.onclick = () => {
    const plus = b.hasAttribute('data-lh-plus');
    const rid = plus ? b.dataset.lhPlus : b.dataset.lhMin;
    const m = h.deel.momenten?.[rid]; if (!m) return;
    const n = Math.min(MAX_HELPERS, Math.max(0, (Number(m.nodig) || 0) + (plus ? 1 : -1)));
    if (n === (Number(m.nodig) || 0)) return;
    m.nodig = n;                                   // lokaal meteen, de luisteraar volgt
    schrijfDeel(id, { [`momenten.${rid}.nodig`]: n });
    api.renderTeam();
  });

  // ✕: helper weghalen (ook een ouder die zichzelf inschreef)
  v.querySelectorAll('[data-lh-weg]').forEach(b => b.onclick = async () => {
    const a = h.aanm.find(x => x.id === b.dataset.lhWeg); if (!a) return;
    const m = h.deel.momenten?.[a.rij];
    if (!confirm(`${a.naam} weghalen${m?.datum ? ' bij ' + datumKort(m.datum) : ''}?`)) return;
    try {
      await deleteDoc(doc(aanmCol(id), a.id));
      h.aanm = h.aanm.filter(x => x.id !== a.id); api.renderTeam();
    } catch(e){ meld('Weghalen mislukt: ' + foutTekst(e)); }
  });

  // Open plek: de coach vult zelf een naam in
  v.querySelectorAll('[data-lh-nieuw]').forEach(inp => {
    inp.onchange = async () => {
      const naam = inp.value.trim().slice(0, NAAM_MAX); if (!naam) return;
      inp.disabled = true;
      try { await addDoc(aanmCol(id), { uid:S.user?.uid || '', rij:inp.dataset.lhNieuw, naam, ms:Date.now(), door:'coach' }); }
      catch(e){ inp.disabled = false; meld('Opslaan mislukt: ' + foutTekst(e)); }
    };
    inp.onkeydown = e => { if (e.key === 'Enter') inp.blur(); };
    // teams-lijsten.js stelt hertekenen uit zolang de coach hier typt
    inp.onblur = () => { if (S._ljUitgesteld){ S._ljUitgesteld = false; setTimeout(() => api.renderTeam(), 0); } };
  });
}

/* ==================== MODALS ==================== */
function linkUrl(deelId){ return `${location.origin}${location.pathname}?hulp=${deelId}`; }
function waTekst(l){
  const team = S.team?.naam || '';
  const open = rijen(l, false).filter(r => openPlekken(r));
  const data = open.slice(0, 6).map(r => datumKort(r.datum)).join(', ');
  return `*${l.naam}${team ? ' ' + team : ''}*\n`
    + 'We zoeken ouders die meehelpen bij de training. Schrijf je in via deze link, je kiest zelf de dagen:\n'
    + linkUrl(l.hulpDeelId)
    + (open.length ? `\n\nNog hulp nodig op: ${data}${open.length > 6 ? ' en verder' : ''}.` : '');
}

function modalLink(l, api){
  const h = hulpVan(l); if (!h?.deel) return;
  if (h.deel.open !== true){
    openModal(`<h2>Inschrijflink</h2>
      <p class="lj-msub">De inschrijflink staat uit. Ouders kunnen de lijst niet openen, alleen de staf vult namen in.</p>
      <button class="knop fluo vol" id="lhMAan">Inschrijflink aanzetten</button>`);
    $('#lhMAan').onclick = async () => { if (await hulpZetOpen(l, true)){ api.renderTeam(); modalLink(l, api); } };
    return;
  }
  const tekst = waTekst(l);
  openModal(`<h2>Inschrijflink</h2>
    <p class="lj-msub">Ouders schrijven zich hiermee zelf in, zonder account. Plak het bericht in de groepsapp.</p>
    <div class="lj-watekst">${esc(tekst)}</div>
    <div class="avg-balk"><span class="slot">${I_SLOT}</span><span>${AVG_LINK}</span></div>
    <div class="rij u-mt-sm"><button class="knop fluo" id="lhWaOpen">${ico('action-whatsapp', 18)} Open WhatsApp</button><button class="knop" id="lhWaKop">${ico('action-copy', 18)} Kopieer</button></div>
    <button class="knop vol u-mt-xs" id="lhMUit">Inschrijflink uitzetten</button>`);
  $('#lhWaOpen').onclick = () => { window.open('https://wa.me/?text=' + encodeURIComponent(tekst), '_blank'); };
  $('#lhWaKop').onclick = async () => {
    try { await navigator.clipboard.writeText(tekst); meld('Gekopieerd: plak in WhatsApp'); }
    catch(e){ meld('Kopiëren lukt niet op dit toestel, gebruik "Open WhatsApp"'); }
  };
  $('#lhMUit').onclick = async () => {
    if (!confirm('Inschrijflink uitzetten? Ouders kunnen de lijst dan niet meer openen. De namen blijven staan.')) return;
    if (await hulpZetOpen(l, false)){ sluitModal(); api.renderTeam(); meld('Inschrijflink staat uit'); }
  };
}

/* Alle aanmeldingen van één training (of van de hele lijst) verwijderen. */
async function wisAanmeldingen(deelId, rij){
  const snap = await getDocs(aanmCol(deelId));
  const weg = snap.docs.filter(d => !rij || d.data().rij === rij);
  for (let i = 0; i < weg.length; i += 400){
    const batch = writeBatch(db);
    weg.slice(i, i + 400).forEach(d => batch.delete(d.ref));
    await batch.commit();
  }
}

/* ⋯ → Trainingen beheren: een training weghalen of een losse training toevoegen. */
function modalTrainingen(l, api){
  const h = hulpVan(l); if (!h?.deel) return;
  const id = l.hulpDeelId;
  const komend = rijen(l, false);
  openModal(`<h2>Trainingen</h2><p class="lj-msub">Weghalen wist ook wie zich voor die training heeft ingeschreven.</p>
    <div class="lj-kollijst">${komend.length ? komend.map(r => `<div class="lj-kol"><span class="lj-kol-n">${esc(datumKort(r.datum))}${tijdTekst(r) ? '<span class="sep" aria-hidden="true"></span>' + esc(tijdTekst(r)) : ''}</span><span class="lj-kt">${r.helpers.length}/${r.nodig}</span><button data-lh-tweg="${esc(r.id)}" title="Weghalen" aria-label="${esc(datumKort(r.datum))} weghalen">✕</button></div>`).join('') : '<div class="lj-kol leeg">Geen komende trainingen</div>'}</div>
    <div class="rij">
      <div class="veldgroep" style="flex:1.4"><label for="lhTDatum">Training toevoegen</label><input type="date" class="invoer" id="lhTDatum" min="${vandaag()}"></div>
      <div class="veldgroep u-flex-1"><label for="lhTTijd">Tijd</label><input type="time" class="invoer" id="lhTTijd"></div></div>
    <button class="knop klein" id="lhTPlus">+ Toevoegen</button>`);
  $$('#modalInhoud [data-lh-tweg]').forEach(b => b.onclick = async () => {
    const r = komend.find(x => x.id === b.dataset.lhTweg); if (!r) return;
    if (r.helpers.length && !confirm(`${datumKort(r.datum)} weghalen? ${meerv(r.helpers.length, 'aanmelding gaat', 'aanmeldingen gaan')} verloren.`)) return;
    try {
      if (r.helpers.length) await wisAanmeldingen(id, r.id);
      await updateDoc(deelRef(id), { [`momenten.${r.id}`]: deleteField(), bijgewerktMs:Date.now() });
      if (h.deel.momenten) delete h.deel.momenten[r.id];
      h.aanm = h.aanm.filter(a => a.rij !== r.id);
      modalTrainingen(l, api); api.renderTeam();
    } catch(e){ meld('Weghalen mislukt: ' + foutTekst(e)); }
  });
  $('#lhTPlus').onclick = async () => {
    const datum = $('#lhTDatum').value, tijd = $('#lhTTijd').value;
    if (!datum) return meld('Kies een datum');
    const rid = rijId(datum);
    if (h.deel.momenten?.[rid]) return meld('Die training staat al in de lijst');
    if (Object.keys(h.deel.momenten || {}).length >= MAX_TRAININGEN) return meld(`Een lijst kan maximaal ${MAX_TRAININGEN} trainingen bevatten`);
    const vast = momentenVanTeam(S.team).find(x => x.dag === weekdagNr(datum));
    const moment = { datum, start:tijd || vast?.start || '', eind:tijd ? '' : (vast?.eind || ''), nodig:Math.max(0, Number(h.deel.standaard) || 0) };
    if (await schrijfDeel(id, { [`momenten.${rid}`]: moment })){
      h.deel.momenten = { ...(h.deel.momenten || {}), [rid]:moment };
      modalTrainingen(l, api); api.renderTeam(); meld('Training toegevoegd');
    }
  };
}

/* Extra regels in het ⋯-menu van teams-lijsten.js (data-lj-m="lh-…"). */
export function hulpMenuHtml(l){
  if (!hulpVan(l)?.deel || l.gearchiveerd) return '';
  return `<button class="lj-mopt" data-lj-m="lh-trainingen"><span>${ico('planning-calendar', 20)}</span>Trainingen beheren</button>
    <button class="lj-mopt" data-lj-m="lh-link"><span>${I_LINK}</span>Inschrijflink</button>`;
}
export function hulpMenuActie(l, m, api){
  if (m === 'lh-trainingen'){ modalTrainingen(l, api); return true; }
  if (m === 'lh-link'){ modalLink(l, api); return true; }
  return false;
}

/* Lijst verwijderd: ook het deel-document en de aanmeldingen opruimen. Mislukt
   dat (geen verbinding, rules), dan gaat het verwijderen van de lijst zelf door. */
export async function hulpOpruimen(l){
  if (!l?.hulpDeelId) return;
  try { await wisAanmeldingen(l.hulpDeelId); await deleteDoc(deelRef(l.hulpDeelId)); }
  catch(e){ console.error('[Cluppie] trainingshulp opruimen', e); }
}

/* ---------- Nieuwe lijst ----------
   api: { klaar(lijstId, data) } — teams-lijsten.js opent daarna de lijst. */
export function modalNieuwHulp(api){
  const vast = momentenVanTeam(S.team);
  const dagOpties = vast.length ? vast : [1, 2, 3, 4, 5, 6, 7].map(dag => ({ dag, start:'', eind:'' }));
  const c = { naam:'Trainingshulp', van:vandaag(), tm:plusDagen(vandaag(), 55), nodig:2, open:true, dagen:new Set(vast.map(m => m.dag)) };
  const datums = () => {
    const uit = [];
    if (!c.van || !c.tm || c.tm < c.van) return uit;
    for (let iso = c.van, i = 0; iso <= c.tm && i < 800; iso = plusDagen(iso, 1), i++) if (c.dagen.has(weekdagNr(iso))) uit.push(iso);
    return uit;
  };
  const bewaar = () => {
    if ($('#lhNNaam')) c.naam = $('#lhNNaam').value;
    if ($('#lhNVan')) c.van = $('#lhNVan').value;
    if ($('#lhNTm')) c.tm = $('#lhNTm').value;
  };
  const teken = () => {
    const n = datums().length;
    openModal(`<h2>Trainingshulp</h2>
      <p class="lj-msub">${vast.length
        ? 'Rijen: de trainingen van je team in de gekozen periode. De dagen en tijden komen uit de trainingstijden van het team.'
        : 'Rijen: de trainingen in de gekozen periode. Dit team heeft nog geen trainingstijden, kies daarom zelf de dagen.'}</p>
      <div class="veldgroep"><label for="lhNNaam">Naam</label><input class="invoer" id="lhNNaam" value="${esc(c.naam)}" maxlength="60" autocomplete="off"></div>
      <div class="rij">
        <div class="veldgroep u-flex-1"><label for="lhNVan">Van</label><input type="date" class="invoer" id="lhNVan" value="${esc(c.van)}"></div>
        <div class="veldgroep u-flex-1"><label for="lhNTm">Tot en met</label><input type="date" class="invoer" id="lhNTm" value="${esc(c.tm)}"></div></div>
      <div class="veldgroep"><label>Voor welke trainingen</label>
        <div class="lh-dagen">${dagOpties.map(m => `<button type="button" class="lh-dag ${c.dagen.has(m.dag) ? 'aan' : ''}" data-lh-dag="${m.dag}" aria-pressed="${c.dagen.has(m.dag)}">${esc(DAGEN_KORT[m.dag - 1])}${m.start ? ' ' + esc(m.start) : ''}</button>`).join('')}</div></div>
      <div class="veldgroep lh-aantal"><span>Helpers per training<small>Standaard, per training aan te passen</small></span>
        <span class="lh-tel" role="group" aria-label="Helpers per training"><button type="button" id="lhNMin" aria-label="Een helper minder" ${c.nodig <= 1 ? 'disabled' : ''}>${I_MIN}</button><b>${c.nodig}</b><button type="button" id="lhNPlus" aria-label="Een helper meer" ${c.nodig >= MAX_HELPERS ? 'disabled' : ''}>${I_PLUS}</button></span></div>
      <div class="veldgroep"><button type="button" class="lj-toggle" id="lhNOpen" aria-pressed="${c.open}"><span>Ouders schrijven zichzelf in<small>Via een link in de groepsapp, zonder account</small></span><span class="lj-schakel ${c.open ? 'aan' : ''}"></span></button></div>
      ${c.open
        ? `<div class="avg-balk"><span class="slot">${I_SLOT}</span><span>${AVG_LINK}</span></div>`
        : '<p class="lj-hint lh-uit">Zonder link vul je de namen zelf in. De lijst blijft dan alleen zichtbaar voor de staf.</p>'}
      <p class="lh-telling">${n ? `${meerv(n, 'training', 'trainingen')}, ${meerv(n * c.nodig, 'plek', 'plekken')} om te vullen` : 'Kies minstens één trainingsdag binnen de periode'}</p>
      <button class="knop fluo vol" id="lhNOk">Lijst maken</button>`);
    const opnieuw = fn => () => { bewaar(); fn(); teken(); };
    $('#lhNVan').onchange = opnieuw(() => {});
    $('#lhNTm').onchange = opnieuw(() => {});
    $$('#modalInhoud [data-lh-dag]').forEach(b => b.onclick = opnieuw(() => { const d = Number(b.dataset.lhDag); c.dagen.has(d) ? c.dagen.delete(d) : c.dagen.add(d); }));
    $('#lhNMin').onclick = opnieuw(() => { c.nodig = Math.max(1, c.nodig - 1); });
    $('#lhNPlus').onclick = opnieuw(() => { c.nodig = Math.min(MAX_HELPERS, c.nodig + 1); });
    $('#lhNOpen').onclick = opnieuw(() => { c.open = !c.open; });
    $('#lhNOk').onclick = maak;
  };
  let bezig = false;
  const maak = async () => {
    if (bezig) return;
    bewaar();
    if (c.van && c.tm && c.tm < c.van) return meld('De einddatum ligt vóór de begindatum');
    const ds = datums();
    if (!ds.length) return meld('Kies minstens één trainingsdag binnen de periode');
    if (ds.length > MAX_TRAININGEN) return meld(`Dat zijn ${ds.length} trainingen. Kies een kortere periode (maximaal ${MAX_TRAININGEN}).`);
    const naam = c.naam.trim().slice(0, 60) || 'Trainingshulp';
    const momenten = {};
    ds.forEach(iso => {
      const m = vast.find(x => x.dag === weekdagNr(iso));
      momenten[rijId(iso)] = { datum:iso, start:m?.start || '', eind:m?.eind || '', nodig:c.nodig };
    });
    const lijstRef = doc(collection(db, 'teams', S.teamId, 'lijsten'));
    const dRef = doc(collection(db, 'hulpDeel'));
    const nu = Date.now(), uid = S.user?.uid || '';
    bezig = true;
    try {
      await setDoc(dRef, { teamId:S.teamId, lijstId:lijstRef.id, teamNaam:S.team?.naam || '', titel:naam, open:!!c.open,
        standaard:c.nodig, momenten, gemaaktDoor:uid, gemaaktMs:nu, bijgewerktMs:nu });
    } catch(e){
      bezig = false;
      return meld(e?.code === 'permission-denied'
        ? 'Trainingshulp is nog niet beschikbaar: de clubbeheerder moet eerst de nieuwe Firestore-rules publiceren.'
        : 'Aanmaken mislukt: ' + (e?.code || e?.message));
    }
    const data = { naam, sjabloon:'trainingshulp', rijen:'trainingen', hulpDeelId:dRef.id, kolommen:[], waarden:{},
      inPlanning:false, gearchiveerd:false, seizoen:S.huidigSeizoen || SEIZOEN_FALLBACK, gemaaktDoor:uid, gemaaktMs:nu, bijgewerktMs:nu };
    try { await setDoc(lijstRef, data); }
    catch(e){
      bezig = false;
      deleteDoc(dRef).catch(() => {});
      return meld('Aanmaken mislukt: ' + (e?.code || e?.message));
    }
    bezig = false;
    api.klaar(lijstRef.id, data);
  };
  teken();
}
