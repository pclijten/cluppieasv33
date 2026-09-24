/* ==================== LIJSTJES (teams/{teamId}/lijsten) ====================
   [20260924a] Flexibele teamlijstjes: wie gaat mee naar het toernooi, welke
   kledingmaat, welke ouder rijdt. Eén generiek model in plaats van losse
   functies: rijen (de selectie óf de wedstrijden van dit seizoen) × kolommen
   (✓/✗, keuze, tekst, datum).

   Datamodel — één document per lijst:
     { naam, sjabloon, rijen:'spelers'|'wedstrijden',
       kolommen:[{id, naam, type:'check'|'keuze'|'tekst'|'datum', opties?, alleenUit?, optioneel?}],
       waarden:{ [rijId]: { [kolomId]: waarde } },
       datum?, tijd?, inPlanning, gearchiveerd, seizoen, gemaaktDoor, gemaaktMs, bijgewerktMs }
   Losse cellen schrijven we met een veldpad (waarden.<rij>.<kolom>), zodat
   twee coaches tegelijk verschillende cellen kunnen invullen zonder elkaars
   wijziging te overschrijven. De bestaande /teams/{teamId}/{sub=**}-rule dekt
   deze subcollectie; er zijn geen rules-wijzigingen nodig.

   Tabbladen: 'lijstjes' (overzicht) en 'lijst' (één lijst, S._lijstOpen).
   Dit bestand importeert NIET uit teams.js (geen circulaire import): teams.js
   geeft zetTeamTab/renderTeam mee aan koppelLijstjes().

   Lijsten met een datum verschijnen via lijstPlanningItems() in de Planning;
   de datum leeft alleen in de lijst, dus er is geen tweede item om bij te
   houden. Delen via WhatsApp: alleen voornamen, vrije tekstkolommen staan
   standaard uit (AVG — zie de melding in het deelscherm). */
import { db, doc, collection, addDoc, updateDoc, deleteDoc, deleteField, onSnapshot } from './firebase.js?v=20260922c';
import { S, $, $$, esc, meld, openModal, sluitModal } from './state.js?v=20260922c';
import { SEIZOEN_FALLBACK } from './config.js?v=20260922c';
import { ico } from './icons.js?v=20260922c';

/* ---------- Sjablonen ---------- */
export const MATEN_STANDAARD = ['116','128','140','152','164','S','M','L','XL'];
const SOKMATEN = ['27–30','31–34','35–38','39–42','43–46'];

const SJABLONEN = {
  aanwezig: {
    naam:'Aanwezigheid', sub:'Toernooi, uitje, teamfoto — wie gaat mee?', ico:'attendance-present',
    rijen:'spelers', datumVerplicht:true,
    kolommen:[
      { id:'mee', naam:'Gaat mee', type:'check' },
      { id:'opm', naam:'Opmerking', type:'tekst', optioneel:true },
    ],
  },
  maten: {
    naam:'Kledingmaten', sub:'Shirt, broek, sokken — met bestel-telling', ico:'training-bibs',
    rijen:'spelers',
    kolommen:[
      { id:'shirt', naam:'Shirt',  type:'keuze', opties:MATEN_STANDAARD },
      { id:'broek', naam:'Broek',  type:'keuze', opties:MATEN_STANDAARD },
      { id:'sok',   naam:'Sokken', type:'keuze', opties:SOKMATEN },
      { id:'opm',   naam:'Opmerking', type:'tekst', optioneel:true },
    ],
  },
  hulp: {
    naam:'Ouderhulp', sub:'Rijden & wassen per wedstrijd', ico:'match-departure',
    rijen:'wedstrijden',
    kolommen:[
      { id:'r1',  naam:'Rijder 1', type:'tekst', alleenUit:true },
      { id:'r2',  naam:'Rijder 2', type:'tekst', alleenUit:true },
      { id:'r3',  naam:'Rijder 3', type:'tekst', alleenUit:true },
      { id:'was', naam:'Wassen',   type:'tekst' },
    ],
  },
  leeg: { naam:'Leeg', sub:'Zelf kolommen kiezen', ico:'attendance-fill', rijen:'spelers', kolommen:[] },
};
const TYPE_NAAM = { check:'✓/✗', keuze:'Keuze', tekst:'Tekst', datum:'Datum' };
const GEVOELIG = /allerg|medic|medisch|ziek|astma|diabet|epilep|blessure|diagnos|pijn|adhd|autis|gezondheid/i;
const AVG_HINT = 'Geen medische gegevens (allergieën, medicijnen, blessures) — dit zijn bijzondere persoonsgegevens van minderjarigen.';
const AVG_STERK = '<b>Dit lijkt op gezondheidsinformatie.</b> Medische gegevens van kinderen horen niet in Cluppie — spreek dit met de ouders af buiten de app.';

/* ---------- Hulpjes ---------- */
const nieuwId = () => 'k' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
const vandaagIso = () => new Date().toISOString().slice(0, 10);
const isBreed = () => document.documentElement.classList.contains('desk');
function datumKort(iso){
  if (!iso) return '';
  try { return new Date(iso + 'T12:00').toLocaleDateString('nl-NL', { weekday:'short', day:'numeric', month:'short' }).replace(/\./g, ''); }
  catch(e){ return iso; }
}
const voornaam = n => String(n || '').trim().split(/\s+/)[0] || '';
function lijstRef(id){ return doc(db, 'teams', S.teamId, 'lijsten', id); }
export function alleLijsten(){ return (S._lijsten || []); }
function lijst(id){ return alleLijsten().find(l => l.id === id); }
function actieveLijsten(){
  return alleLijsten().filter(l => !l.gearchiveerd)
    .sort((a, b) => (b.gemaaktMs || 0) - (a.gemaaktMs || 0));
}

/* ---------- Rijen ---------- */
function spelerRijen(){
  return (S.spelers || [])
    .filter(p => !p._gast && !p._ingeleend)
    .map(p => ({ id:p.id, soort:'speler', nr:p.nummer ?? '', naam:p.naam || 'Speler' }))
    .sort((a, b) => (Number(a.nr) || 99) - (Number(b.nr) || 99) || a.naam.localeCompare(b.naam, 'nl'));
}
function wedstrijdRijen(metEerder){
  const seizoen = S.huidigSeizoen || SEIZOEN_FALLBACK;
  const vandaag = vandaagIso();
  return (S.wedstrijden || [])
    .filter(w => w.datum && (!w.seizoen || w.seizoen === seizoen))
    .filter(w => metEerder || w.datum >= vandaag)
    .map(w => ({ id:w.id, soort:'wedstrijd', datum:w.datum, tegen:w.type === 'toernooi' ? (w.tegenstander || 'Toernooi') : (w.tegenstander || 'Tegenstander'),
      thuis:w.thuis === true, tijd:w.aftrap || w.tijd || '', verleden:w.datum < vandaag }))
    .sort((a, b) => a.datum.localeCompare(b.datum));
}
function rijenVan(l, metEerder = true){ return l.rijen === 'wedstrijden' ? wedstrijdRijen(metEerder) : spelerRijen(); }
function kolommenVan(l){ return Array.isArray(l.kolommen) ? l.kolommen : []; }
/* Weergavevolgorde: optionele kolommen (opmerking) altijd achteraan, zodat de
   brede opmerkingsregel onderaan de kaart staat. */
function weergaveKolommen(l){ const k = kolommenVan(l); return [...k.filter(x => !x.optioneel), ...k.filter(x => x.optioneel)]; }
function kolommenVoor(l, r){ return weergaveKolommen(l).filter(k => !(k.alleenUit && r.thuis)); }
/* Nieuwe kolom vóór de optionele (opmerking) invoegen. */
function metNieuweKolom(kols, kol){ const i = kols.findIndex(x => x.optioneel); return i < 0 ? [...kols, kol] : [...kols.slice(0, i), kol, ...kols.slice(i)]; }
function waarde(l, rijId, kolId){ return l.waarden?.[rijId]?.[kolId]; }
function rijCompleet(l, r){
  const kols = kolommenVoor(l, r).filter(k => !k.optioneel);
  if (!kols.length) return true;
  return kols.every(k => { const v = waarde(l, r.id, k.id); return k.type === 'check' ? v === true || v === false : !!v; });
}
function voortgang(l){
  const rijen = rijenVan(l, l.rijen !== 'wedstrijden');
  const c = rijen.filter(r => rijCompleet(l, r)).length;
  return { c, t:rijen.length };
}
/* Badge op de hub-tegel: aantal nog open invullingen over alle actieve lijsten. */
export function lijstjesOpenTotaal(){
  try { return actieveLijsten().reduce((n, l) => { const v = voortgang(l); return n + (v.t - v.c); }, 0); }
  catch(e){ return 0; }
}

/* ---------- Firestore ---------- */
export function luisterLijsten(teamId, herteken, fout){
  S._lijsten = [];
  return onSnapshot(collection(db, 'teams', teamId, 'lijsten'), snap => {
    S._lijsten = snap.docs.map(d => ({ id:d.id, ...d.data() }));
    // niet opnieuw tekenen terwijl de coach in een tekstveld van een lijst typt;
    // bij het verlaten van dat veld tekenen we alsnog (zie koppelLijstjes)
    if (document.activeElement?.matches?.('#view-team [data-lj-tekst]')){ S._ljUitgesteld = true; return; }
    herteken();
  }, fout);
}
async function schrijf(id, velden){
  try { await updateDoc(lijstRef(id), { ...velden, bijgewerktMs:Date.now() }); return true; }
  catch(e){ console.error('[Cluppie] lijst opslaan', e); meld('Opslaan mislukt: ' + (e.code || e.message)); return false; }
}
/* Eén cel: veldpad, zodat gelijktijdige invullingen elkaar niet overschrijven.
   Lokaal meteen bijwerken, zodat het scherm direct klopt (de listener volgt). */
function zetCel(l, rijId, kolId, v){
  l.waarden ||= {}; l.waarden[rijId] ||= {};
  const leeg = v === undefined || v === null || v === '';
  if (leeg) delete l.waarden[rijId][kolId]; else l.waarden[rijId][kolId] = v;
  return schrijf(l.id, { [`waarden.${rijId}.${kolId}`]: leeg ? deleteField() : v });
}

/* ==================== OVERZICHT ==================== */
export function htmlLijstjes(){
  const act = actieveLijsten();
  const arch = alleLijsten().filter(l => l.gearchiveerd);
  const kaart = l => {
    const v = voortgang(l);
    const pct = v.t ? Math.round(v.c / v.t * 100) : 100;
    const sj = SJABLONEN[l.sjabloon] || SJABLONEN.leeg;
    return `<button class="lj-item ${l.gearchiveerd ? 'arch' : ''}" data-lj-open="${esc(l.id)}">
      <span class="lj-ico">${ico(sj.ico, 24)}</span>
      <span class="lj-t"><span class="lj-titel">${esc(l.naam)}</span>
        <span class="lj-meta">${l.datum ? '📅 ' + esc(datumKort(l.datum)) + ' · ' : ''}${v.c} van ${v.t} ${l.rijen === 'wedstrijden' ? 'wedstrijden rond' : 'ingevuld'}</span>
        <span class="lj-balk"><i style="width:${pct}%"></i></span></span>
      <span class="lj-pijl">›</span></button>`;
  };
  return `
    <p class="lj-intro">Alleen zichtbaar voor de staf van dit team.</p>
    ${act.length ? act.map(kaart).join('') : `<div class="kaart leeg">Nog geen lijstjes.<br>Maak er een voor een toernooi, kledingbestelling of rijschema.</div>`}
    <button class="lj-nieuw" id="ljNieuw">+ Nieuwe lijst</button>
    ${arch.length ? `<button class="lj-archknop" id="ljArchToggle">${S._ljToonArchief ? 'Verberg' : 'Toon'} ${arch.length} gearchiveerd${arch.length === 1 ? 'e' : 'e'} lijst${arch.length === 1 ? '' : 'en'}</button>
      ${S._ljToonArchief ? arch.map(kaart).join('') : ''}` : ''}`;
}

/* ==================== ÉÉN LIJST ==================== */
export function lijstTitel(){ return lijst(S._lijstOpen)?.naam || 'Lijst'; }

function samenvatting(l){
  const rijen = rijenVan(l, l.rijen !== 'wedstrijden');
  const v = voortgang(l);
  const kols = kolommenVan(l);
  if (l.rijen === 'wedstrijden'){
    const uit = rijen.filter(r => !r.thuis);
    const uitRond = uit.filter(r => rijCompleet(l, r)).length;
    const openTekst = kols.filter(k => !k.alleenUit && !k.optioneel).map(k => {
      const n = rijen.filter(r => !waarde(l, r.id, k.id)).length;
      return n ? `<span class="lj-tel open">${esc(k.naam)} nog open <b>${n}</b></span>` : `<span class="lj-tel">${esc(k.naam)} rond ✓</span>`;
    }).join('');
    return `<div class="lj-samen"><div class="lj-samen-top"><span class="lj-getal">${uitRond}<small>/${uit.length}</small></span><span class="lj-lbl">uitwedstrijden met genoeg rijders</span></div>
      ${openTekst ? `<div class="lj-samen-rij"><div class="lj-samen-k">${openTekst}</div></div>` : ''}</div>`;
  }
  const checks = kols.filter(k => k.type === 'check');
  const keuzes = kols.filter(k => k.type === 'keuze');
  let top, rijHtml = '';
  if (checks.length){
    const [eerste, ...rest] = checks;
    const n = k => rijen.filter(r => waarde(l, r.id, k.id) === true).length;
    const onb = rijen.filter(r => waarde(l, r.id, eerste.id) === undefined).length;
    top = `<span class="lj-getal">${n(eerste)}<small>/${rijen.length}</small></span><span class="lj-lbl">${esc(eerste.naam.toLowerCase())}</span>`;
    const chips = rest.map(k => `<span class="lj-tel">${esc(k.naam)}<b>${n(k)}</b></span>`).join('')
      + (onb ? `<span class="lj-tel open">Nog geen antwoord <b>${onb}</b></span>` : '');
    if (chips) rijHtml += `<div class="lj-samen-k">${chips}</div>`;
  } else {
    top = `<span class="lj-getal">${v.c}<small>/${v.t}</small></span><span class="lj-lbl">${keuzes.length ? 'spelers volledig ingevuld' : 'ingevuld'}</span>`;
  }
  for (const k of keuzes){
    const tel = {}; let open = 0;
    rijen.forEach(r => { const x = waarde(l, r.id, k.id); x ? tel[x] = (tel[x] || 0) + 1 : open++; });
    const opts = [...(k.opties || []), ...Object.keys(tel).filter(x => !(k.opties || []).includes(x))];
    rijHtml += `<div class="lj-samen-k"><span class="lj-kn">${esc(k.naam)}</span>${opts.filter(o => tel[o]).map(o => `<span class="lj-tel">${esc(o)}<b>×${tel[o]}</b></span>`).join('')}${open ? `<span class="lj-tel open">? <b>×${open}</b></span>` : ''}</div>`;
  }
  return `<div class="lj-samen"><div class="lj-samen-top">${top}</div>${rijHtml ? `<div class="lj-samen-rij">${rijHtml}</div>` : ''}</div>`;
}

function celData(l, r, k){ return `data-lj-rij="${esc(r.id)}" data-lj-kol="${esc(k.id)}"`; }
function veldHtml(l, r, k){
  const v = waarde(l, r.id, k.id);
  const d = celData(l, r, k);
  if (k.type === 'check'){
    const cls = v === true ? 'ja' : v === false ? 'nee' : '';
    return `<button class="lj-veld ${cls}" data-lj-check ${d}><span class="lj-vl">${esc(k.naam)}</span><span class="lj-vw ${v === undefined ? 'leeg' : ''}">${v === true ? '✓ Ja' : v === false ? '✗ Nee' : '—'}</span></button>`;
  }
  if (k.type === 'keuze'){
    return `<button class="lj-veld" data-lj-keuze ${d}><span class="lj-vl">${esc(k.naam)}</span><span class="lj-vw ${v ? '' : 'leeg'}">${v ? esc(v) : '—'}</span></button>`;
  }
  if (k.type === 'datum'){
    return `<label class="lj-veld lj-tekst"><span class="lj-vl">${esc(k.naam)}</span><input type="date" value="${esc(v || '')}" data-lj-tekst ${d}></label>`;
  }
  const ph = l.rijen === 'wedstrijden' ? 'Naam ouder…' : '…';
  return `<label class="lj-veld lj-tekst ${k.optioneel ? 'breed' : ''}"><span class="lj-vl">${esc(k.naam)}</span><input type="text" value="${esc(v || '')}" placeholder="${ph}" data-lj-tekst ${d} autocomplete="off"></label>`;
}

function rijKop(r){
  if (r.soort === 'speler') return `<span class="lj-shirt">${esc(r.nr)}</span><span class="lj-naam">${esc(r.naam)}</span>`;
  const dt = new Date(r.datum + 'T12:00');
  const mnd = dt.toLocaleDateString('nl-NL', { month:'short' }).replace('.', '');
  return `<span class="lj-dag"><b>${dt.getDate()}</b><small>${esc(mnd)}</small></span>
    <span class="lj-naam">${esc(r.tegen)}<small>${esc(datumKort(r.datum).split(' ')[0])}${r.tijd ? ' ' + esc(r.tijd) : ''}</small></span>
    <span class="lj-thuis ${r.thuis ? '' : 'uit'}">${r.thuis ? 'Thuis' : 'Uit'}</span>`;
}

function htmlKaarten(l, rijen){
  return rijen.map(r => {
    const open = !rijCompleet(l, r);
    const kols = kolommenVoor(l, r);
    return `<div class="lj-rk ${open ? 'open' : ''} ${r.verleden ? 'verleden' : ''}"><div class="lj-rk-kop">${rijKop(r)}</div>
      ${kols.length ? `<div class="lj-velden">${kols.map(k => veldHtml(l, r, k)).join('')}</div>` : ''}
      ${r.soort === 'wedstrijd' && r.thuis && kolommenVan(l).some(k => k.alleenUit) ? '<div class="lj-thuis-tekst">Thuis — geen vervoer nodig</div>' : ''}</div>`;
  }).join('');
}

function htmlTabel(l, rijen){
  const kols = weergaveKolommen(l);
  const cel = (r, k) => {
    if (k.alleenUit && r.thuis) return '<td class="lj-td-leeg">—</td>';
    const v = waarde(l, r.id, k.id), d = celData(l, r, k);
    if (k.type === 'check') return `<td><button class="lj-dcheck ${v === true ? 'ja' : v === false ? 'nee' : ''}" data-lj-check ${d}>${v === true ? '✓' : v === false ? '✗' : ''}</button></td>`;
    if (k.type === 'keuze'){
      const opts = [...(k.opties || [])]; if (v && !opts.includes(v)) opts.push(v);
      return `<td><select class="lj-dsel" data-lj-select ${d}><option value="">—</option>${opts.map(o => `<option ${o === v ? 'selected' : ''}>${esc(o)}</option>`).join('')}<option value="__eigen">+ Eigen…</option></select></td>`;
    }
    return `<td><input class="lj-dinv" type="${k.type === 'datum' ? 'date' : 'text'}" value="${esc(v || '')}" data-lj-tekst ${d} autocomplete="off"></td>`;
  };
  const eerste = r => r.soort === 'speler'
    ? `<td><span class="lj-dnaam"><span class="lj-shirt">${esc(r.nr)}</span>${esc(r.naam)}</span></td>`
    : `<td><span class="lj-dnaam">${esc(datumKort(r.datum))} · ${esc(r.tegen)} <span class="lj-thuis ${r.thuis ? '' : 'uit'}">${r.thuis ? 'Thuis' : 'Uit'}</span></span></td>`;
  return `<div class="lj-tabelwrap"><table class="lj-tabel"><thead><tr><th>${l.rijen === 'wedstrijden' ? 'Wedstrijd' : 'Speler'}</th>${kols.map(k => `<th>${esc(k.naam)}</th>`).join('')}</tr></thead>
    <tbody>${rijen.map(r => `<tr class="${rijCompleet(l, r) ? '' : 'open'} ${r.verleden ? 'verleden' : ''}">${eerste(r)}${kols.map(k => cel(r, k)).join('')}</tr>`).join('')}</tbody></table></div>`;
}

export function htmlLijst(){
  const l = lijst(S._lijstOpen);
  if (!l) return `<div class="kaart leeg">Deze lijst bestaat niet meer.</div>`;
  const wed = l.rijen === 'wedstrijden';
  let rijen = rijenVan(l, !wed || !!S._ljToonEerder);
  const eerderAantal = wed ? wedstrijdRijen(true).length - wedstrijdRijen(false).length : 0;
  const v = voortgang(l);
  const filter = S._ljFilter === 'open' ? 'open' : 'alle';
  if (filter === 'open') rijen = rijen.filter(r => !rijCompleet(l, r));
  const datumChip = wed ? '' : l.datum
    ? `<button class="lj-datumchip" id="ljDatum">📅 ${esc(datumKort(l.datum))}${l.tijd ? ' · ' + esc(l.tijd) : ''}${l.inPlanning !== false ? ' <span class="pl">· in Planning</span>' : ''} <span class="pen">✎</span></button>`
    : `<button class="lj-datumchip leeg" id="ljDatum">+ Datum</button>`;
  const breed = isBreed();
  const lijf = !rijenVan(l, true).length
    ? `<div class="kaart leeg">${wed ? 'Nog geen wedstrijden dit seizoen.' : 'Nog geen spelers in de selectie.'}</div>`
    : rijen.length ? (breed ? htmlTabel(l, rijen) : htmlKaarten(l, rijen))
    : `<div class="kaart leeg">Alles ingevuld 🎉</div>`;
  const inhoud = `
    <div class="lj-balkje">
      <span class="lj-bron">${wed ? 'Rijen = wedstrijden uit Sportlink' : `Rijen = selectie (${spelerRijen().length} spelers)`}</span>
      ${datumChip}
      <button class="lj-menu" id="ljMenu" title="Meer">⋯</button>
    </div>
    ${l.gearchiveerd ? `<div class="lj-archbalk">Gearchiveerd <button id="ljHerstel">Terugzetten</button></div>` : ''}
    ${breed ? '' : samenvatting(l)}
    <div class="lj-filters">
      <button class="${filter === 'alle' ? 'aan' : ''}" data-lj-filter="alle">Alle</button>
      <button class="${filter === 'open' ? 'aan' : ''}" data-lj-filter="open">Nog open (${v.t - v.c})</button>
      ${eerderAantal ? `<button class="${S._ljToonEerder ? 'aan' : ''}" id="ljEerder">${S._ljToonEerder ? 'Verberg' : 'Toon'} gespeeld (${eerderAantal})</button>` : ''}
    </div>
    ${lijf}`;
  const deel = `<button class="knop fluo vol lj-deel" id="ljDeel">${ico('action-whatsapp', 18)} Delen via WhatsApp</button>`;
  if (breed) return `<div class="lj-desk"><div class="lj-desk-hoofd">${inhoud}</div><aside class="lj-desk-zij">${samenvatting(l)}${deel}</aside></div>`;
  return inhoud + `<div class="lj-onder">${deel}</div>`;
}

/* ==================== KOPPELEN ==================== */
let API = { zetTeamTab:() => {}, renderTeam:() => {} };

/* Na archiveren/verwijderen terug naar het overzicht. Niet via history.back():
   sluitModal() doet zelf al een stille history-stap (vangnet in state.js). */
function terugNaarOverzicht(){
  if (S.teamTab !== 'lijst') return;
  const stack = S._teamTabStack || [];
  if (stack[stack.length - 1] === 'lijstjes' && S._navTeamTabTerug?.()) return;
  API.zetTeamTab('lijstjes');
}

export function openLijst(id, zetTeamTab){
  S._lijstOpen = id; S._ljFilter = 'alle'; S._ljToonEerder = false;
  (zetTeamTab || API.zetTeamTab)('lijst');
}

export function koppelLijstjes(v, tab, api){
  API = api || API;
  if (tab === 'lijstjes'){
    v.querySelectorAll('[data-lj-open]').forEach(b => b.onclick = () => openLijst(b.dataset.ljOpen));
    const nieuw = v.querySelector('#ljNieuw'); if (nieuw) nieuw.onclick = () => modalSjabloon();
    const arch = v.querySelector('#ljArchToggle'); if (arch) arch.onclick = () => { S._ljToonArchief = !S._ljToonArchief; API.renderTeam(); };
    return;
  }
  if (tab !== 'lijst') return;
  const l = lijst(S._lijstOpen); if (!l) return;
  v.querySelectorAll('[data-lj-filter]').forEach(b => b.onclick = () => { S._ljFilter = b.dataset.ljFilter; API.renderTeam(); });
  const eerder = v.querySelector('#ljEerder'); if (eerder) eerder.onclick = () => { S._ljToonEerder = !S._ljToonEerder; API.renderTeam(); };
  const dat = v.querySelector('#ljDatum'); if (dat) dat.onclick = () => modalDatum(l);
  const menu = v.querySelector('#ljMenu'); if (menu) menu.onclick = () => modalMenu(l);
  const deel = v.querySelector('#ljDeel'); if (deel) deel.onclick = () => modalDelen(l);
  const herstel = v.querySelector('#ljHerstel'); if (herstel) herstel.onclick = async () => { if (await schrijf(l.id, { gearchiveerd:false })) meld('Lijst teruggezet'); };
  // ✓/✗: leeg → ja → nee → leeg
  v.querySelectorAll('[data-lj-check]').forEach(b => b.onclick = () => {
    const { ljRij:rij, ljKol:kol } = b.dataset;
    const huidig = waarde(l, rij, kol);
    zetCel(l, rij, kol, huidig === undefined ? true : huidig === true ? false : undefined);
    API.renderTeam();
  });
  v.querySelectorAll('[data-lj-keuze]').forEach(b => b.onclick = () => modalKeuze(l, b.dataset.ljRij, b.dataset.ljKol));
  v.querySelectorAll('[data-lj-select]').forEach(s => s.onchange = () => {
    const { ljRij:rij, ljKol:kol } = s.dataset;
    if (s.value === '__eigen'){ s.value = waarde(l, rij, kol) || ''; modalKeuze(l, rij, kol, true); return; }
    zetCel(l, rij, kol, s.value || undefined);
  });
  v.querySelectorAll('[data-lj-tekst]').forEach(inp => {
    inp.onchange = () => zetCel(l, inp.dataset.ljRij, inp.dataset.ljKol, inp.value.trim() || undefined);
    inp.onblur = () => { if (S._ljUitgesteld){ S._ljUitgesteld = false; setTimeout(() => API.renderTeam(), 0); } };
  });
}

/* ==================== MODALS ==================== */
function modalKeuze(l, rij, kol, eigenFocus){
  const k = kolommenVan(l).find(x => x.id === kol); if (!k) return;
  const r = rijenVan(l).find(x => x.id === rij);
  const huidig = waarde(l, rij, kol);
  const opts = [...(k.opties || [])]; if (huidig && !opts.includes(huidig)) opts.push(huidig);
  openModal(`<h2>${esc(k.naam)}</h2>
    <p class="lj-msub">${r ? esc(r.naam || r.tegen) + (r.nr !== undefined && r.nr !== '' ? ' · #' + esc(r.nr) : '') : ''}</p>
    <div class="lj-opts">${opts.map(o => `<button class="lj-opt ${o === huidig ? 'gekozen' : ''}" data-lj-kies="${esc(o)}">${esc(o)}</button>`).join('')}
      <button class="lj-opt wis" data-lj-kies="">Wissen</button></div>
    <div class="lj-eigen"><input class="invoer" id="ljEigenOpt" placeholder="Eigen maat/optie, bv. 176 of XXL" autocomplete="off"><button class="knop klein" id="ljEigenOk">+ Toevoegen</button></div>
    <p class="lj-hint">Een eigen optie komt erbij voor de hele kolom, dus ook bij de andere ${l.rijen === 'wedstrijden' ? 'rijen' : 'spelers'}.</p>`);
  $$('#modalInhoud [data-lj-kies]').forEach(b => b.onclick = () => {
    zetCel(l, rij, kol, b.dataset.ljKies || undefined); sluitModal(); API.renderTeam();
  });
  const inp = $('#ljEigenOpt');
  const voegToe = async () => {
    const x = inp.value.trim().slice(0, 20);
    if (!x) return meld('Typ eerst een maat of optie');
    if (!(k.opties || []).includes(x)){
      const kolommen = kolommenVan(l).map(c => c.id === kol ? { ...c, opties:[...(c.opties || []), x] } : c);
      l.kolommen = kolommen;
      await schrijf(l.id, { kolommen });
    }
    zetCel(l, rij, kol, x); sluitModal(); API.renderTeam(); meld(`"${x}" toegevoegd`);
  };
  $('#ljEigenOk').onclick = voegToe;
  inp.onkeydown = e => { if (e.key === 'Enter') voegToe(); };
  if (eigenFocus) setTimeout(() => inp.focus(), 50);
}

/* ---------- Datum (bij het aanmaken én achteraf) ---------- */
function datumVeldenHtml(o, verplicht){
  return `<div class="rij">
      <div class="veldgroep" style="flex:1.4"><label>Datum${verplicht ? '' : ' (optioneel)'}</label><input type="date" class="invoer" id="ljDDatum" value="${esc(o.datum || '')}"></div>
      <div class="veldgroep" style="flex:1"><label>Tijd</label><input type="time" class="invoer" id="ljDTijd" value="${esc(o.tijd || '')}"></div></div>
    <div class="veldgroep"><button type="button" class="lj-toggle" id="ljDPlan"><span>Toon in Planning<small>Verschijnt als eigen regel in de seizoensplanning</small></span><span class="lj-schakel ${o.inPlanning !== false ? 'aan' : ''}"></span></button></div>`;
}
function koppelDatumVelden(o){
  const t = $('#ljDPlan'); if (!t) return;
  t.onclick = () => { o.inPlanning = o.inPlanning === false; t.querySelector('.lj-schakel').classList.toggle('aan', o.inPlanning !== false); };
}
function leesDatumVelden(o){ o.datum = $('#ljDDatum')?.value || ''; o.tijd = $('#ljDTijd')?.value || ''; }

function modalDatum(l){
  const o = { datum:l.datum || '', tijd:l.tijd || '', inPlanning:l.inPlanning !== false };
  const verplicht = l.sjabloon === 'aanwezig';
  openModal(`<h2>Datum</h2><p class="lj-msub">${esc(l.naam)}</p>${datumVeldenHtml(o, verplicht)}
    <button class="knop fluo vol" id="ljDOk">Opslaan</button>
    ${l.datum && !verplicht ? '<button class="knop vol" id="ljDWis" style="margin-top:8px">Datum weghalen</button>' : ''}`);
  koppelDatumVelden(o);
  $('#ljDOk').onclick = async () => {
    leesDatumVelden(o);
    if (verplicht && !o.datum) return meld('Vul een datum in');
    const ok = await schrijf(l.id, { datum:o.datum || deleteField(), tijd:o.tijd || deleteField(), inPlanning:o.inPlanning !== false });
    if (ok){ sluitModal(); meld(o.datum && o.inPlanning !== false ? 'Opgeslagen — staat in de Planning' : 'Opgeslagen'); }
  };
  const wis = $('#ljDWis');
  if (wis) wis.onclick = async () => { if (await schrijf(l.id, { datum:deleteField(), tijd:deleteField() })){ sluitModal(); meld('Datum weggehaald'); } };
}

/* ---------- Nieuwe lijst ---------- */
function modalSjabloon(){
  openModal(`<h2>Nieuwe lijst</h2><p class="lj-msub">Kies een startpunt — kolommen pas je daarna aan.</p>
    <div class="lj-sjgrid">${Object.entries(SJABLONEN).map(([id, s]) => `<button class="lj-sj" data-lj-sj="${id}">${ico(s.ico, 26)}<span class="st">${esc(s.naam)}</span><span class="ss">${esc(s.sub)}</span></button>`).join('')}</div>`);
  $$('#modalInhoud [data-lj-sj]').forEach(b => b.onclick = () => {
    const s = SJABLONEN[b.dataset.ljSj];
    S._ljConcept = { sjabloon:b.dataset.ljSj, naam:s.naam === 'Leeg' ? '' : s.naam, rijen:s.rijen,
      kolommen:s.kolommen.map(k => ({ ...k, opties:k.opties ? [...k.opties] : undefined })), datum:'', tijd:'', inPlanning:true };
    modalNieuw();
  });
}
function kolLijstHtml(kols, metWeg){
  return kols.length
    ? kols.map((k, i) => `<div class="lj-kol"><span class="lj-kol-n">${esc(k.naam)}</span><span class="lj-kt">${TYPE_NAAM[k.type] || k.type}${k.opties ? ' · ' + k.opties.length : ''}${k.alleenUit ? ' · uit' : ''}</span>${metWeg ? `<button data-lj-kolweg="${i}" title="Weghalen">✕</button>` : ''}</div>`).join('')
    : '<div class="lj-kol leeg">Nog geen kolommen</div>';
}
function modalNieuw(){
  const c = S._ljConcept; if (!c) return;
  const s = SJABLONEN[c.sjabloon];
  openModal(`<h2>${esc(s.naam)}</h2>
    <p class="lj-msub">${c.rijen === 'wedstrijden' ? 'Rijen: alle wedstrijden van dit seizoen (Sportlink).' : 'Rijen: je hele selectie — nieuwe spelers komen er vanzelf bij.'}</p>
    <div class="veldgroep"><label>Naam</label><input class="invoer" id="ljNNaam" value="${esc(c.naam)}" placeholder="bv. Herfsttoernooi, Teamuitje" autocomplete="off" maxlength="60"></div>
    ${c.rijen === 'spelers' ? datumVeldenHtml(c, !!s.datumVerplicht) : ''}
    <div class="veldgroep"><label>Kolommen</label><div class="lj-kollijst">${kolLijstHtml(c.kolommen, true)}</div>
      <button class="knop klein" id="ljNKol">+ Kolom</button></div>
    <button class="knop fluo vol" id="ljNOk">Lijst maken</button>`);
  koppelDatumVelden(c);
  const bewaarConcept = () => { c.naam = $('#ljNNaam').value; leesDatumVelden(c); };
  $$('#modalInhoud [data-lj-kolweg]').forEach(b => b.onclick = () => { bewaarConcept(); c.kolommen.splice(Number(b.dataset.ljKolweg), 1); modalNieuw(); });
  $('#ljNKol').onclick = () => { bewaarConcept(); modalKolom(kol => { c.kolommen = metNieuweKolom(c.kolommen, kol); modalNieuw(); }, () => modalNieuw()); };
  $('#ljNOk').onclick = async () => {
    bewaarConcept();
    const naam = c.naam.trim() || s.naam;
    if (s.datumVerplicht && !c.datum) return meld('Vul een datum in');
    const data = {
      naam, sjabloon:c.sjabloon, rijen:c.rijen,
      kolommen:c.kolommen.map(k => Object.fromEntries(Object.entries(k).filter(([, x]) => x !== undefined))),
      waarden:{}, inPlanning:!!c.datum && c.inPlanning !== false, gearchiveerd:false,
      seizoen:S.huidigSeizoen || SEIZOEN_FALLBACK, gemaaktDoor:S.user?.uid || '', gemaaktMs:Date.now(), bijgewerktMs:Date.now(),
    };
    if (c.datum) data.datum = c.datum;
    if (c.datum && c.tijd) data.tijd = c.tijd;
    try {
      const ref = await addDoc(collection(db, 'teams', S.teamId, 'lijsten'), data);
      S._lijsten = [...alleLijsten().filter(x => x.id !== ref.id), { id:ref.id, ...data }];
      S._ljConcept = null; sluitModal(); meld('Lijst gemaakt');
      openLijst(ref.id);
    } catch(e){ meld('Aanmaken mislukt: ' + (e.code || e.message)); }
  };
}

/* ---------- Kolom toevoegen ---------- */
function modalKolom(klaar, terug){
  const d = { naam:'', type:'check', opties:'' };
  const teken = () => {
    const gevoelig = GEVOELIG.test(d.naam);
    openModal(`<h2>Kolom toevoegen</h2>
      <div class="veldgroep"><label>Naam</label><input class="invoer" id="ljKNaam" value="${esc(d.naam)}" placeholder="bv. Rugnummer, Betaald, Shirt" autocomplete="off" maxlength="30"></div>
      <div class="veldgroep"><label>Type</label><div class="segment">${['check', 'keuze', 'tekst', 'datum'].map(t => `<button type="button" class="${d.type === t ? 'actief' : ''}" data-lj-ktype="${t}">${TYPE_NAAM[t]}</button>`).join('')}</div></div>
      ${d.type === 'keuze' ? `<div class="veldgroep"><label>Opties (met komma's)</label><input class="invoer" id="ljKOpt" value="${esc(d.opties)}" placeholder="bv. ${MATEN_STANDAARD.join(', ')}" autocomplete="off"></div>` : ''}
      <div class="avg-balk ${gevoelig ? 'lj-sterk' : ''}" id="ljAvg"><span class="slot">🔒</span><span>${gevoelig ? AVG_STERK : AVG_HINT}</span></div>
      <button class="knop fluo vol" id="ljKOk">Toevoegen</button>
      <button class="knop vol" id="ljKTerug" style="margin-top:8px">Annuleren</button>`);
    const naam = $('#ljKNaam');
    naam.oninput = () => { d.naam = naam.value; const g = GEVOELIG.test(d.naam); const a = $('#ljAvg');
      a.classList.toggle('lj-sterk', g); a.lastElementChild.innerHTML = g ? AVG_STERK : AVG_HINT; };
    $$('#modalInhoud [data-lj-ktype]').forEach(b => b.onclick = () => { d.naam = naam.value; if ($('#ljKOpt')) d.opties = $('#ljKOpt').value; d.type = b.dataset.ljKtype; teken(); });
    $('#ljKTerug').onclick = () => terug();
    $('#ljKOk').onclick = () => {
      d.naam = naam.value.trim(); if ($('#ljKOpt')) d.opties = $('#ljKOpt').value;
      if (!d.naam) return meld('Geef de kolom een naam');
      const kol = { id:nieuwId(), naam:d.naam.slice(0, 30), type:d.type };
      if (d.type === 'keuze'){
        kol.opties = [...new Set(d.opties.split(',').map(x => x.trim().slice(0, 20)).filter(Boolean))];
        if (!kol.opties.length) return meld('Geef minstens één optie');
      }
      klaar(kol);
    };
    setTimeout(() => naam.focus(), 50);
  };
  teken();
}

/* ---------- Menu ⋯ ---------- */
function modalMenu(l){
  openModal(`<h2>${esc(l.naam)}</h2>
    <button class="lj-mopt" data-lj-m="kolommen"><span>▦</span>Kolommen beheren</button>
    <button class="lj-mopt" data-lj-m="naam"><span>✎</span>Naam wijzigen</button>
    ${l.rijen === 'spelers' ? `<button class="lj-mopt" data-lj-m="datum"><span>📅</span>${l.datum ? 'Datum wijzigen' : 'Datum toevoegen'}</button>` : ''}
    <button class="lj-mopt" data-lj-m="arch"><span>🗄</span>${l.gearchiveerd ? 'Terugzetten uit archief' : 'Archiveren'}</button>
    <button class="lj-mopt gevaar" data-lj-m="weg"><span>🗑</span>Verwijderen</button>`);
  $$('#modalInhoud [data-lj-m]').forEach(b => b.onclick = async () => {
    const m = b.dataset.ljM;
    if (m === 'kolommen') return modalKolommen(l);
    if (m === 'naam') return modalNaam(l);
    if (m === 'datum') return modalDatum(l);
    if (m === 'arch'){
      const naar = !l.gearchiveerd;
      if (await schrijf(l.id, { gearchiveerd:naar })){ sluitModal(); meld(naar ? 'Gearchiveerd — terug te vinden onderaan Lijstjes' : 'Lijst teruggezet'); if (naar) terugNaarOverzicht(); }
      return;
    }
    if (m === 'weg'){
      if (!confirm(`"${l.naam}" definitief verwijderen? Alle ingevulde gegevens gaan verloren.`)) return;
      try { await deleteDoc(lijstRef(l.id)); S._lijsten = alleLijsten().filter(x => x.id !== l.id); sluitModal(); meld('Lijst verwijderd'); terugNaarOverzicht(); }
      catch(e){ meld('Verwijderen mislukt: ' + (e.code || e.message)); }
    }
  });
}
function modalNaam(l){
  openModal(`<h2>Naam wijzigen</h2><div class="veldgroep"><label>Naam</label><input class="invoer" id="ljNaamInv" value="${esc(l.naam)}" maxlength="60" autocomplete="off"></div>
    <button class="knop fluo vol" id="ljNaamOk">Opslaan</button>`);
  $('#ljNaamOk').onclick = async () => {
    const naam = $('#ljNaamInv').value.trim(); if (!naam) return meld('Geef een naam');
    if (await schrijf(l.id, { naam })){ l.naam = naam; sluitModal(); API.renderTeam(); }
  };
}
function modalKolommen(l){
  const kols = kolommenVan(l);
  openModal(`<h2>Kolommen</h2><p class="lj-msub">Weghalen wist ook wat er in die kolom is ingevuld.</p>
    <div class="lj-kollijst">${kolLijstHtml(kols, true)}</div>
    <button class="knop klein" id="ljKolPlus">+ Kolom</button>`);
  $$('#modalInhoud [data-lj-kolweg]').forEach(b => b.onclick = async () => {
    const k = kols[Number(b.dataset.ljKolweg)]; if (!k) return;
    if (!confirm(`Kolom "${k.naam}" weghalen? Wat er is ingevuld gaat verloren.`)) return;
    const kolommen = kols.filter(x => x.id !== k.id);
    const velden = { kolommen };
    for (const rij of Object.keys(l.waarden || {})) if (l.waarden[rij]?.[k.id] !== undefined) velden[`waarden.${rij}.${k.id}`] = deleteField();
    if (await schrijf(l.id, velden)){ l.kolommen = kolommen; modalKolommen(l); API.renderTeam(); }
  });
  $('#ljKolPlus').onclick = () => modalKolom(async kol => {
    const kolommen = metNieuweKolom(kolommenVan(l), kol);
    if (await schrijf(l.id, { kolommen })){ l.kolommen = kolommen; sluitModal(); API.renderTeam(); meld('Kolom toegevoegd'); }
  }, () => modalKolommen(l));
}

/* ---------- Delen via WhatsApp ---------- */
function waTekst(l, o){
  const team = S.team?.naam || '';
  const kop = `*${l.naam}${team ? ' — ' + team : ''}*` + (l.datum ? `\n📅 ${datumKort(l.datum)}${l.tijd ? ' · ' + l.tijd : ''}` : '');
  const kols = kolommenVan(l).filter(k => o.kol.has(k.id));
  if (l.rijen === 'wedstrijden'){
    const rijen = wedstrijdRijen(false);
    if (!rijen.length) return kop + '\n\nGeen komende wedstrijden.';
    const uitKols = kols.filter(k => k.alleenUit), overig = kols.filter(k => !k.alleenUit);
    return kop + '\n\n' + rijen.map(r => {
      const regel = [`*${datumKort(r.datum)}* – ${r.thuis ? 'thuis vs' : 'uit bij'} ${r.tegen}${r.tijd ? ' (' + r.tijd + ')' : ''}`];
      if (!r.thuis && uitKols.length){
        const namen = uitKols.map(k => waarde(l, r.id, k.id)).filter(Boolean);
        regel.push(`   🚗 ${namen.length ? namen.join(', ') : '❓'}${namen.length < uitKols.length ? ' · nog ' + (uitKols.length - namen.length) + ' nodig' : ''}`);
      }
      for (const k of overig) regel.push(`   ${k.naam}: ${waarde(l, r.id, k.id) || '❓ nog open'}`);
      return regel.join('\n');
    }).join('\n\n') + '\n\nKun je helpen? Laat het even weten!';
  }
  const rijen = spelerRijen();
  const checks = kols.filter(k => k.type === 'check'), keuzes = kols.filter(k => k.type === 'keuze');
  const teksten = kols.filter(k => k.type === 'tekst' || k.type === 'datum');
  const extra = r => { const t = teksten.map(k => waarde(l, r.id, k.id)).filter(Boolean); return t.length ? ` (${t.join('; ')})` : ''; };
  const delen = [kop];
  checks.forEach((k, i) => {
    const ja = rijen.filter(r => waarde(l, r.id, k.id) === true), nee = rijen.filter(r => waarde(l, r.id, k.id) === false),
      open = rijen.filter(r => waarde(l, r.id, k.id) === undefined);
    const nm = a => a.map(r => voornaam(r.naam) + (i === 0 ? extra(r) : '')).join(', ');
    delen.push(`*${k.naam}*\n✅ Ja (${ja.length}): ${nm(ja) || '—'}` + (nee.length ? `\n❌ Nee (${nee.length}): ${nm(nee)}` : '')
      + (open.length ? `\n${i === 0 ? '❓ Nog geen antwoord' : '⏳ Nog niet'} (${open.length}): ${nm(open)}` : ''));
  });
  if (keuzes.length){
    if (o.totalen){
      delen.push(keuzes.map(k => {
        const tel = {}; let op = 0;
        rijen.forEach(r => { const x = waarde(l, r.id, k.id); x ? tel[x] = (tel[x] || 0) + 1 : op++; });
        const opts = [...(k.opties || []), ...Object.keys(tel).filter(x => !(k.opties || []).includes(x))];
        return `*${k.naam}:* ` + (opts.filter(x => tel[x]).map(x => `${x} ×${tel[x]}`).join(', ') || '—') + (op ? ` · nog onbekend: ${op}` : '');
      }).join('\n'));
    } else {
      delen.push(rijen.map(r => `${voornaam(r.naam)}: ` + keuzes.map(k => `${k.naam.toLowerCase()} ${waarde(l, r.id, k.id) || '?'}`).join(' · ') + (checks.length ? '' : extra(r))).join('\n'));
    }
  }
  if (!checks.length && !keuzes.length && teksten.length)
    delen.push(rijen.map(r => `${voornaam(r.naam)}: ${teksten.map(k => waarde(l, r.id, k.id) || '—').join(' · ')}`).join('\n'));
  if (delen.length === 1) delen.push('(Kies hierboven minstens één kolom.)');
  return delen.join('\n\n');
}
function modalDelen(l){
  const o = S._ljDeel?.id === l.id ? S._ljDeel
    : { id:l.id, totalen:false, kol:new Set(kolommenVan(l).filter(k => l.rijen === 'wedstrijden' || !(k.type === 'tekst' || k.type === 'datum')).map(k => k.id)) };
  S._ljDeel = o;
  const spelers = l.rijen === 'spelers';
  const heeftKeuze = kolommenVan(l).some(k => k.type === 'keuze' && o.kol.has(k.id));
  const tekst = waTekst(l, o);
  openModal(`<h2>Delen via WhatsApp</h2><p class="lj-msub">Kies wat er in het bericht komt.</p>
    <div class="lj-wakies">${kolommenVan(l).map(k => `<button class="${o.kol.has(k.id) ? 'aan' : ''}" data-lj-wak="${esc(k.id)}">${o.kol.has(k.id) ? '✓ ' : ''}${esc(k.naam)}</button>`).join('')}</div>
    ${heeftKeuze ? `<div class="segment" style="margin-bottom:12px"><button type="button" class="${!o.totalen ? 'actief' : ''}" data-lj-tot="0">Per speler</button><button type="button" class="${o.totalen ? 'actief' : ''}" data-lj-tot="1">Alleen totalen</button></div>` : ''}
    <div class="lj-watekst">${esc(tekst)}</div>
    ${spelers ? `<div class="avg-balk"><span class="slot">🔒</span><span>Het bericht bevat voornamen van spelers en gaat buiten Cluppie. Deel het alleen in de teamgroep met ouders. Opmerkingen staan standaard uit.</span></div>` : ''}
    <div class="rij" style="margin-top:12px"><button class="knop fluo" id="ljWaOpen">${ico('action-whatsapp', 18)} Open WhatsApp</button><button class="knop" id="ljWaKop">${ico('action-copy', 18)} Kopieer</button></div>`);
  $$('#modalInhoud [data-lj-wak]').forEach(b => b.onclick = () => { const k = b.dataset.ljWak; o.kol.has(k) ? o.kol.delete(k) : o.kol.add(k); modalDelen(l); });
  $$('#modalInhoud [data-lj-tot]').forEach(b => b.onclick = () => { o.totalen = b.dataset.ljTot === '1'; modalDelen(l); });
  $('#ljWaOpen').onclick = () => { window.open('https://wa.me/?text=' + encodeURIComponent(tekst), '_blank'); };
  $('#ljWaKop').onclick = async () => {
    try { await navigator.clipboard.writeText(tekst); meld('Gekopieerd — plak in WhatsApp'); }
    catch(e){ meld('Kopiëren lukt niet op dit toestel — gebruik "Open WhatsApp"'); }
  };
}

/* ==================== PLANNING ==================== */
/* Lijsten met een datum (en "Toon in Planning" aan) als items voor
   planningItems() in teams.js — bron 'lijst', docId = lijst-id. */
export function lijstPlanningItems(){
  return actieveLijsten().filter(l => l.datum && l.inPlanning !== false).map(l => {
    const v = voortgang(l);
    const k = kolommenVan(l).find(x => x.type === 'check');
    const n = k ? spelerRijen().filter(r => waarde(l, r.id, k.id) === true).length : v.c;
    const stand = k ? `${n}/${v.t} ${k.naam.toLowerCase()}` : `${v.c}/${v.t} ingevuld`;
    return { bron:'lijst', docId:l.id, datum:l.datum, type:'lijst', label:'📋 ' + l.naam,
      opmerking:[l.tijd || '', stand].filter(Boolean).join(' · '), aangepast:false };
  });
}
