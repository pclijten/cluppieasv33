/* ==================== TOERNOOITJE (teams/{teamId}/toernooitjes) ====================
   [20261117e] Onderling toernooitje met het eigen team en eventueel gastspelers:
   planner, klok, score per veldje en stand. Goedgekeurde mockup 17 nov.

   Bewust "toernooitje": het wedstrijdtype 'toernooi' (een officieel toernooi in
   de wedstrijdenlijst) bestaat al en is iets anders. Uitslagen hier tellen NIET
   mee in speelminuten, Stats of presentie.

   Twee vormen:
     'vast'   vaste teams, iedereen tegen iedereen (enkel of dubbel), stand per
              team, optioneel een finaleronde (1 tegen 2, en 3 tegen 4).
     'wissel' elke ronde nieuwe teams (2 per veldje), elke speler spaart punten.

   Datamodel — één document per toernooitje:
     { datum, status:'bezig'|'klaar', seizoen, gemaaktDoor, gemaaktMs, bijgewerktMs,
       cfg:{ vorm, teams, velden, rondes, dubbel, finale, tijdModus, totaalMin,
             perMin, wisselMin, scorers },
       deelnemers:{ [id]: { naam, nr, gast } }       (voornamen, momentopname)
       teams:[{ id, naam, kleur, spelers:[id] }]      (alleen bij 'vast')
       rondes:[{ type:'groep'|'finale'|'wissel', rust:[teamId], teams?:[…],
                 wedstrijden:[{ id, veld, a, b, plek? }] }],
       uitslag:{ [wedId]: { sa, sb, st:'open'|'bezig'|'klaar' } },
       goals:{ [wedId]: [{ t:'a'|'b', sp:id|null }] },
       ri, duurSec, gestartMs, klok:{ fase, eindMs, restMs } }
   Uitslagen schrijven we per wedstrijd met een veldpad (uitslag.<wedId>), zodat
   twee coaches elk een eigen veldje kunnen bijhouden zonder elkaars score te
   overschrijven. De klok is een eindtijd (eindMs): elk toestel rekent zelf de
   resterende tijd uit, dus de klok loopt overal gelijk en overleeft een
   vergrendeld scherm of een herlaadde pagina. De bestaande
   /teams/{teamId}/{sub=**}-rule dekt deze subcollectie; geen rules-wijziging.

   De opzet (wie doet er mee, vorm, tijd, teams) is een lokaal concept in
   S._toernConcept en wordt pas bij "Start" een document.

   "Eerlijk verdelen" gebruikt alleen de beoordelingen die het hele team ziet;
   de privé-rondebeoordelingen (prive:true) blijven erbuiten en het niveau wordt
   nergens getoond of opgeslagen.

   Tabbladen: 'toernooitjes' (overzicht) en 'toernooitje' (opzet, live of
   eindstand van S._toernOpen). Dit bestand importeert NIET uit teams.js (geen
   circulaire import): teams.js geeft zetTeamTab/renderTeam mee aan
   koppelToernooi(). */
import { db, doc, collection, setDoc, updateDoc, deleteDoc, onSnapshot } from './firebase.js?v=20261106r';
import { S, $, $$, esc, meld, openModal, sluitModal, terugLaag } from './state.js?v=20261111g';
import { SEIZOEN_FALLBACK } from './config.js?v=20261111g';
import { ico } from './icons.js?v=20261106r';

/* ---------- Vaste gegevens ---------- */
/* Hesjeskleuren: bewust vaste kleuren, ze kantelen niet mee met het thema. */
const KLEUREN = [
  { naam:'Rood', k:'#e5484d' }, { naam:'Geel', k:'#f5c400' }, { naam:'Blauw', k:'#4f9dff' }, { naam:'Groen', k:'#35c47a' },
  { naam:'Oranje', k:'#f2a33c' }, { naam:'Wit', k:'#f5f6f8' }, { naam:'Paars', k:'#c9a0ff' }, { naam:'Roze', k:'#ff8fb8' },
];
const CFG_STD = { vorm:'vast', teams:4, velden:2, rondes:5, dubbel:false, finale:true, tijdModus:'totaal', totaalMin:45, perMin:8, wisselMin:1, scorers:false };
/* [min, max, stap] per instelbaar getal */
const GRENS = { velden:[1, 4, 1], teams:[2, 8, 1], rondes:[2, 12, 1], totaalMin:[10, 120, 5], perMin:[2, 20, 1], wisselMin:[0, 5, 1] };
const LS_CFG = 'cluppie_toern_cfg', LS_OPEN = 'cluppie_toern_open';
const MIN_ICO = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true" focusable="false"><path d="M5 12h14"/></svg>';
const SLOT_ICO = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><rect x="4.6" y="10.4" width="14.8" height="9.8" rx="2.4"/><path d="M8 10.4V8a4 4 0 0 1 8 0v2.4"/><circle cx="12" cy="15.2" r="1.4" fill="currentColor" stroke="none"/></svg>';

/* ---------- Hulpjes ---------- */
let API = { zetTeamTab(){}, renderTeam(){} };
const alle = () => S._toernooitjes || [];
const vind = id => alle().find(t => t.id === id);
const huidig = () => vind(S._toernOpen);
const concept = () => S._toernConcept || null;
const ref = id => doc(db, 'teams', S.teamId, 'toernooitjes', id);
const vandaagIso = () => { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };
function datumKort(iso){
  if (!iso) return '';
  try { return new Date(iso + 'T12:00').toLocaleDateString('nl-NL', { weekday:'short', day:'numeric', month:'short' }).replace(/\./g, ''); }
  catch(e){ return iso; }
}
function datumLang(iso){
  try { return new Date((iso || vandaagIso()) + 'T12:00').toLocaleDateString('nl-NL', { weekday:'long', day:'numeric', month:'long' }); }
  catch(e){ return iso || ''; }
}
const mmss = ms => { const s = Math.max(0, Math.ceil(ms / 1000)); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); };
const duurTxt = sec => sec % 60 === 0 ? (sec / 60) + ' min' : Math.floor(sec / 60) + ':' + String(sec % 60).padStart(2, '0') + ' min';
const klokUur = ms => new Date(ms).toLocaleTimeString('nl-NL', { hour:'2-digit', minute:'2-digit' });
const schud = a => { a = a.slice(); for (let i = a.length - 1; i > 0; i--){ const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const bib = k => `<span class="tn-bib" style="background:${esc(k)}"></span>`;
const veldjes = n => n + (n === 1 ? ' veldje' : ' veldjes');
const nieuwEerst = (a, b) => (b.gemaaktMs || 0) - (a.gemaaktMs || 0);
export function toernooiBezig(){ try { return alle().some(t => t.status === 'bezig'); } catch(e){ return false; } }

/* Een "x" is het concept (x.spelers, met mee-vinkje) of een opgeslagen
   toernooitje (x.deelnemers). Deze twee hulpjes maken de rest gelijk. */
const deelnemer = (x, id) => x.spelers ? x.spelers.find(p => p.id === id) || null : (x.deelnemers?.[id] ? { id, ...x.deelnemers[id] } : null);
const meedoenIds = x => x.spelers ? x.spelers.filter(p => p.mee).map(p => p.id) : Object.keys(x.deelnemers || {});
const naamVan = (x, id) => deelnemer(x, id)?.naam || '?';

/* ==================== SCHEMA: IEDEREEN TEGEN IEDEREEN ==================== */
function rondeRobin(ids){
  const a = ids.slice(); if (a.length % 2) a.push(null);
  const n = a.length, rondes = [];
  for (let r = 0; r < n - 1; r++){
    const paren = [];
    for (let i = 0; i < n / 2; i++){ const x = a[i], y = a[n - 1 - i]; if (x != null && y != null) paren.push(r % 2 ? [y, x] : [x, y]); }
    rondes.push(paren);
    a.splice(1, 0, a.pop());
  }
  return rondes;
}
/* Verdeelt de wedstrijden over rondes van maximaal `velden` wedstrijden. Past het
   aantal veldjes, dan blijven de rondes van het competitieschema heel; anders
   vullen we de rondes zo dat teams die het langst stilstaan eerst weer spelen. */
function maakSchema(ids, velden, dubbel){
  let rr = rondeRobin(ids);
  if (dubbel) rr = rr.concat(rr.map(r => r.map(([x, y]) => [y, x])));
  const perRonde = Math.floor(ids.length / 2), slots = [];
  const zet = (paren, s) => ({
    wedstrijden: paren.map((p, k) => ({ a:p[0], b:p[1], veld:((k + s) % paren.length) + 1 })).sort((x, y) => x.veld - y.veld),
    rust: ids.filter(i => !paren.some(p => p[0] === i || p[1] === i)),
  });
  if (velden >= perRonde){ rr.forEach((paren, s) => slots.push(zet(paren, s))); return slots; }
  const open = rr.flat().map((p, i) => ({ p, i }));
  const gespeeld = Object.fromEntries(ids.map(i => [i, 0]));
  const laatst = Object.fromEntries(ids.map(i => [i, -9]));
  while (open.length){
    const s = slots.length, bezet = new Set(), kies = [];
    const kand = open.slice().sort((m, n) =>
      (gespeeld[m.p[0]] + gespeeld[m.p[1]]) - (gespeeld[n.p[0]] + gespeeld[n.p[1]]) ||
      (laatst[m.p[0]] + laatst[m.p[1]]) - (laatst[n.p[0]] + laatst[n.p[1]]) || m.i - n.i);
    for (const m of kand){
      if (kies.length >= velden) break;
      if (bezet.has(m.p[0]) || bezet.has(m.p[1])) continue;
      kies.push(m); bezet.add(m.p[0]); bezet.add(m.p[1]);
    }
    kies.forEach(m => { open.splice(open.indexOf(m), 1); gespeeld[m.p[0]]++; gespeeld[m.p[1]]++; laatst[m.p[0]] = s; laatst[m.p[1]] = s; });
    slots.push(zet(kies.map(m => m.p), s));
  }
  return slots;
}

/* ==================== PLANNING UIT DE INSTELLINGEN ==================== */
const aantalTeams = cfg => cfg.vorm === 'wissel' ? cfg.velden * 2 : cfg.teams;
const finaleKan = cfg => cfg.vorm === 'vast' && cfg.finale && cfg.teams >= 3;
function plan(x){
  const c = x.cfg, n = meedoenIds(x).length, nT = aantalTeams(c);
  let slots, wed, perTeamWed = 0;
  if (c.vorm === 'wissel'){ slots = c.rondes; wed = slots * c.velden; }
  else {
    const s = maakSchema([...Array(nT).keys()], c.velden, c.dubbel);
    slots = s.length; wed = s.reduce((t, r) => t + r.wedstrijden.length, 0);
    perTeamWed = (nT - 1) * (c.dubbel ? 2 : 1);
    if (finaleKan(c)){ slots++; wed += (c.velden >= 2 && nT >= 4) ? 2 : 1; }
  }
  const wisselSec = c.wisselMin * 60;
  let duurSec;
  if (c.tijdModus === 'totaal') duurSec = Math.floor((c.totaalMin * 60 - (slots - 1) * wisselSec) / slots / 30) * 30;
  else duurSec = c.perMin * 60;
  const totaalSec = slots * duurSec + (slots - 1) * wisselSec;
  const klein = Math.floor(n / nT), over = n % nT;
  let fout = '';
  if (n < nT * 2) fout = `Met ${n} spelers heb je te weinig voor ${nT} teams. Kies minder ${c.vorm === 'wissel' ? 'veldjes' : 'teams'}.`;
  else if (duurSec < 120) fout = 'De wedstrijden worden korter dan 2 minuten. Kies meer tijd, meer veldjes of minder ' + (c.vorm === 'wissel' ? 'rondes.' : 'teams.');
  return { nT, slots, wed, perTeamWed, duurSec, totaalSec, klein, over, fout };
}
const teamGrootte = p => p.over ? `${p.klein} of ${p.klein + 1} spelers per team` : `${p.klein} spelers per team`;

/* ==================== TEAMS VERDELEN ==================== */
const legeTeams = n => Array.from({ length:n }, (_, i) => ({ id:'t' + i, naam:KLEUREN[i].naam, kleur:KLEUREN[i].k, spelers:[] }));
/* Niveau (1–5) uit de nieuwste beoordeling die het hele team mag zien. Privé-
   rondebeoordelingen tellen niet mee. null = nog niet beoordeeld (of gast). */
function niveauVan(pid){
  for (const b of (S.beoordelingen || [])){
    if (b.spelerId !== pid || b.prive) continue;
    if (b.soort === 'snel' && Number(b.niveau) >= 1) return Number(b.niveau);
    if (b.soort === 'volledig'){
      const s = Object.values(b.scores || {}).map(Number).filter(v => v >= 1);
      if (s.length) return s.reduce((a, v) => a + v, 0) / s.length;
    }
  }
  return null;
}
const sigVan = c => c.cfg.teams + '|' + meedoenIds(c).join(',');
/* 'hussel' = willekeurig; 'eerlijk' = op niveau gesorteerd en om-en-om (slang)
   uitgedeeld. Geeft false terug als er nog niets te wegen viel. */
function verdeel(c, hoe){
  const nT = c.cfg.teams, teams = legeTeams(nT);
  let rij = schud(c.spelers.filter(p => p.mee)), gewogen = false;
  if (hoe === 'eerlijk'){
    const niv = Object.fromEntries(rij.map(p => [p.id, p.gast ? null : niveauVan(p.id)]));
    gewogen = Object.values(niv).some(v => v != null);
    if (gewogen) rij.sort((a, b) => (niv[b.id] ?? 3) - (niv[a.id] ?? 3));
  }
  rij.forEach((p, i) => { const ronde = Math.floor(i / nT), pos = i % nT; teams[gewogen && ronde % 2 ? nT - 1 - pos : pos].spelers.push(p.id); });
  c.teams = teams; c.teamSig = sigVan(c);
  return gewogen;
}
const nieuweWed = (id, veld, a, b, extra = {}) => ({ id, veld, a, b, sa:0, sb:0, st:'open', goals:[], ...extra });
const teamVan = (x, r, id) => ((r && r.teams) || x.teams || []).find(t => t.id === id) || null;
const namenVan = (x, t) => t ? t.spelers.map(id => deelnemer(x, id)?.naam).filter(Boolean).join(', ') : '';
/* Wisselende teams: uit 40 husselingen die met de minste herhaling van teamgenoten. */
function trekWissel(t, i){
  const nT = t.cfg.velden * 2, ids = meedoenIds(t), tel = {};
  t.rondes.forEach((r, k) => { if (k !== i) (r.teams || []).forEach(tm => tm.spelers.forEach(a => tm.spelers.forEach(b => { if (a < b) tel[a + '|' + b] = (tel[a + '|' + b] || 0) + 1; }))); });
  let beste = null, besteScore = Infinity;
  for (let poging = 0; poging < 40; poging++){
    const teams = legeTeams(nT); schud(ids).forEach((id, k) => teams[k % nT].spelers.push(id));
    let sc = 0; teams.forEach(tm => tm.spelers.forEach(a => tm.spelers.forEach(b => { if (a < b) sc += tel[a + '|' + b] || 0; })));
    if (sc < besteScore){ besteScore = sc; beste = teams; }
  }
  const r = t.rondes[i];
  r.teams = beste;
  r.wedstrijden = Array.from({ length:t.cfg.velden }, (_, k) => nieuweWed(`r${i}m${k}`, k + 1, beste[k * 2].id, beste[k * 2 + 1].id));
}
/* De rondes zoals ze het document in gaan: zonder de uitslag-velden die we er
   bij het inlezen bij zetten (die staan in uitslag/goals), en zonder undefined. */
const kaalRondes = t => t.rondes.map(r => ({
  type:r.type, rust:[...(r.rust || [])],
  ...(r.teams ? { teams:r.teams.map(tm => ({ id:tm.id, naam:tm.naam, kleur:tm.kleur, spelers:[...tm.spelers] })) } : {}),
  wedstrijden:(r.wedstrijden || []).map(m => ({ id:m.id, veld:m.veld, a:m.a ?? null, b:m.b ?? null, ...(m.plek ? { plek:m.plek } : {}) })),
}));
function bouwRondes(x){
  const c = x.cfg;
  if (c.vorm === 'vast'){
    const s = maakSchema(x.teams.map(t => t.id), c.velden, c.dubbel);
    x.rondes = s.map((r, i) => ({ type:'groep', rust:r.rust, wedstrijden:r.wedstrijden.map((m, k) => nieuweWed(`r${i}m${k}`, m.veld, m.a, m.b)) }));
    if (finaleKan(c)){
      const w = [nieuweWed('fin', 1, null, null, { plek:1 })];
      if (c.velden >= 2 && c.teams >= 4) w.push(nieuweWed('p3', 2, null, null, { plek:3 }));
      x.rondes.push({ type:'finale', rust:[], wedstrijden:w });
    }
  } else {
    x.rondes = Array.from({ length:c.rondes }, () => ({ type:'wissel', rust:[], wedstrijden:[] }));
    trekWissel(x, 0);
  }
}

/* ==================== STAND ==================== */
function telWed(rij, voor, tegen){ rij.g++; rij.dv += voor; rij.dt += tegen; if (voor > tegen){ rij.w++; rij.pnt += 3; } else if (voor === tegen){ rij.gl++; rij.pnt += 1; } else rij.v++; }
const leegRij = (id, naam, extra = {}) => ({ id, naam, g:0, w:0, gl:0, v:0, dv:0, dt:0, pnt:0, ...extra });
const sorteer = rijen => rijen.sort((x, y) => y.pnt - x.pnt || (y.dv - y.dt) - (x.dv - x.dt) || y.dv - x.dv || String(x.naam).localeCompare(String(y.naam), 'nl'));
function standTeams(t){
  const rij = Object.fromEntries((t.teams || []).map(tm => [tm.id, leegRij(tm.id, tm.naam, { kleur:tm.kleur })]));
  t.rondes.forEach(r => { if (r.type === 'groep') r.wedstrijden.forEach(m => { if (m.st !== 'open' && rij[m.a] && rij[m.b]){ telWed(rij[m.a], m.sa, m.sb); telWed(rij[m.b], m.sb, m.sa); } }); });
  return sorteer(Object.values(rij));
}
function standSpelers(t){
  const rij = {};
  const zorg = id => { const p = deelnemer(t, id); if (p && !rij[id]) rij[id] = leegRij(id, p.naam, { gast:!!p.gast }); return rij[id]; };
  t.rondes.forEach(r => r.wedstrijden.forEach(m => {
    if (m.st === 'open') return;
    [['a', m.sa, m.sb], ['b', m.sb, m.sa]].forEach(([kant, voor, tegen]) => (teamVan(t, r, m[kant])?.spelers || []).forEach(id => { const x = zorg(id); if (x) telWed(x, voor, tegen); }));
  }));
  meedoenIds(t).forEach(zorg);
  return sorteer(Object.values(rij));
}
function topscorers(t){
  const tel = {};
  t.rondes.forEach(r => r.wedstrijden.forEach(m => (m.goals || []).forEach(g => { if (g.sp) tel[g.sp] = (tel[g.sp] || 0) + 1; })));
  return Object.entries(tel).map(([id, n]) => ({ naam:naamVan(t, id), n })).sort((a, b) => b.n - a.n || a.naam.localeCompare(b.naam, 'nl'));
}
/* Eindstand vaste teams: de finale (en de wedstrijd om plek 3) bepalen de top;
   bij gelijkspel beslist de poulestand (team a is de hoger geëindigde). */
function eindstandTeams(t){
  const st = standTeams(t), fin = t.rondes.find(r => r.type === 'finale');
  if (!fin) return st;
  const vast = [];
  fin.wedstrijden.forEach(m => { if (m.st !== 'open' && m.a && m.b){ const [w, v] = m.sb > m.sa ? [m.b, m.a] : [m.a, m.b]; vast.push(w, v); } });
  return [...vast.map(id => st.find(x => x.id === id)).filter(Boolean), ...st.filter(x => !vast.includes(x.id))];
}
const eindRijen = t => t.cfg.vorm === 'vast' ? eindstandTeams(t) : standSpelers(t);
const omschrijving = t => (t.cfg.vorm === 'vast' ? `${t.cfg.teams} teams` : 'Wisselende teams') + ` · ${veldjes(t.cfg.velden)}`;

/* ==================== FIRESTORE ==================== */
/* Uitslag en doelpunten bij de wedstrijden zetten, zodat de rest van de code
   gewoon m.sa / m.sb / m.st / m.goals kan lezen. */
function hydrateer(t){
  t.cfg = { ...CFG_STD, ...(t.cfg || {}) };
  t.rondes = Array.isArray(t.rondes) ? t.rondes : [];
  t.ri = Math.min(Math.max(0, Number(t.ri) || 0), Math.max(0, t.rondes.length - 1));
  t.klok = t.klok || { fase:'klaar', eindMs:0, restMs:(t.duurSec || 0) * 1000 };
  t.rondes.forEach(r => {
    r.rust = r.rust || []; r.wedstrijden = r.wedstrijden || [];
    r.wedstrijden.forEach(m => { const u = t.uitslag?.[m.id] || {}; m.sa = Number(u.sa) || 0; m.sb = Number(u.sb) || 0; m.st = u.st || 'open'; m.goals = Array.isArray(t.goals?.[m.id]) ? t.goals[m.id] : []; });
  });
  return t;
}
/* herteken(bezigGewijzigd): teams.js tekent de hub alleen opnieuw als het
   stipje op de tegel verandert, niet bij elk doelpunt. */
export function luisterToernooitjes(teamId, herteken, fout){
  S._toernooitjes = []; S._toernGeladen = false;
  return onSnapshot(collection(db, 'teams', teamId, 'toernooitjes'), snap => {
    const was = toernooiBezig();
    S._toernooitjes = snap.docs.map(d => hydrateer({ id:d.id, ...d.data() }));
    S._toernGeladen = true;
    // tijdens de opzet (lokaal concept) niet opnieuw tekenen: daar hangt niets van de documenten af
    if (S.teamTab === 'toernooitje' && S._toernOpen === 'nieuw' && concept()) return;
    herteken(was !== toernooiBezig());
  }, fout);
}
/* Nieuw document met een vooraf gemaakt id en zonder op de server te wachten:
   langs het veld is het bereik vaak slecht, en de offline-opslag van Firestore
   stuurt het document vanzelf door zodra er weer verbinding is. */
function maakDoc(data){
  const nw = doc(collection(db, 'teams', S.teamId, 'toernooitjes'));
  setDoc(nw, data).catch(e => { console.error('[Cluppie] toernooitje aanmaken', e); meld('Opslaan mislukt: ' + (e.code || e.message)); });
  if (!vind(nw.id)) S._toernooitjes = [...alle(), hydrateer({ id:nw.id, ...JSON.parse(JSON.stringify(data)) })];
  return nw.id;
}
async function schrijf(t, velden){
  try { await updateDoc(ref(t.id), { ...velden, bijgewerktMs:Date.now() }); return true; }
  catch(e){ console.error('[Cluppie] toernooitje opslaan', e); meld('Opslaan mislukt: ' + (e.code || e.message)); return false; }
}
const uitslagVeld = m => ({ sa:m.sa, sb:m.sb, st:m.st });

/* ==================== OPZET (lokaal concept) ==================== */
function leesCfg(){
  try { const c = JSON.parse(localStorage.getItem(LS_CFG) || 'null'); if (c && typeof c === 'object') return { ...CFG_STD, ...c }; } catch(e){}
  return { ...CFG_STD };
}
function bewaarCfg(c){ try { localStorage.setItem(LS_CFG, JSON.stringify(c)); } catch(e){} }
/* Voornaam; bij twee dezelfde voornamen de eerste letter van de achternaam erbij. */
function voornamen(spelers){
  const eerste = n => String(n || '').trim().split(/\s+/)[0] || 'Speler';
  const tel = {}; spelers.forEach(p => { const v = eerste(p.naam).toLowerCase(); tel[v] = (tel[v] || 0) + 1; });
  return Object.fromEntries(spelers.map(p => {
    const delen = String(p.naam || '').trim().split(/\s+/), v = eerste(p.naam);
    const extra = tel[v.toLowerCase()] > 1 && delen.length > 1 ? ' ' + delen[delen.length - 1][0].toUpperCase() + '.' : '';
    return [p.id, v + extra];
  }));
}
function nieuwConcept(){
  const bron = (S.spelers || []).slice().sort((a, b) => (Number(a.nummer) || 99) - (Number(b.nummer) || 99) || String(a.naam).localeCompare(String(b.naam), 'nl'));
  const vn = voornamen(bron);
  S._toernConcept = {
    stap:'wie', gastInvoer:'',
    spelers: bron.map(p => ({ id:p.id, naam:vn[p.id], nr:p.nummer ?? '', gast:false, mee:true })),
    cfg: leesCfg(), teams:[], teamSig:'',
  };
  S._toernOpen = 'nieuw';
  try { localStorage.removeItem(LS_OPEN); } catch(e){}
}
function presentieVandaag(){ return (S.presentie || []).find(p => p.datum === vandaagIso()) || null; }
function startToernooi(c){
  const p = plan(c);
  if (p.fout) return meld(p.fout);
  const x = { cfg:{ ...c.cfg }, spelers:c.spelers, teams:c.cfg.vorm === 'vast' ? c.teams : [], rondes:[] };
  bouwRondes(x);
  const data = {
    datum:vandaagIso(), status:'bezig', seizoen:S.huidigSeizoen || SEIZOEN_FALLBACK,
    gemaaktDoor:S.user?.uid || null, gemaaktMs:Date.now(), bijgewerktMs:Date.now(),
    cfg:x.cfg,
    deelnemers:Object.fromEntries(c.spelers.filter(s => s.mee).map(s => [s.id, { naam:s.naam, nr:s.nr ?? '', gast:!!s.gast }])),
    teams:x.teams.map(tm => ({ id:tm.id, naam:tm.naam, kleur:tm.kleur, spelers:[...tm.spelers] })),
    rondes:kaalRondes(x), uitslag:{}, goals:{},
    ri:0, duurSec:p.duurSec, gestartMs:0, klok:{ fase:'klaar', eindMs:0, restMs:p.duurSec * 1000 },
  };
  bewaarCfg(c.cfg);
  const id = maakDoc(data);
  S._toernConcept = null; S._toernTab = 'nu';
  zetOpen(id);
  window.scrollTo(0, 0);
  API.renderTeam();
}
function zetOpen(id){
  S._toernOpen = id;
  try { localStorage.setItem(LS_OPEN, JSON.stringify({ teamId:S.teamId, id })); } catch(e){}
}

/* ==================== KLOK ==================== */
let _ac = null, _wake = null, _wakeBezig = false, _tik = null;
function geluidAan(){ try { _ac = _ac || new (window.AudioContext || window.webkitAudioContext)(); if (_ac.state === 'suspended') _ac.resume(); } catch(e){} }
function signaal(n){
  try { if (navigator.vibrate) navigator.vibrate(n > 1 ? [300, 120, 300, 120, 300] : 200); } catch(e){}
  if (!_ac) return;
  try {
    for (let i = 0; i < n; i++){
      const o = _ac.createOscillator(), g = _ac.createGain(), t = _ac.currentTime + i * 0.55;
      o.type = 'square'; o.frequency.value = n > 1 ? 880 : 660;
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.35, t + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.4);
      o.connect(g); g.connect(_ac.destination); o.start(t); o.stop(t + 0.45);
    }
  } catch(e){}
}
/* Scherm aan houden zolang de klok loopt (waar het toestel dat toestaat). */
function schermAan(){
  try {
    if (!navigator.wakeLock || _wake || _wakeBezig || document.visibilityState !== 'visible') return;
    _wakeBezig = true;
    navigator.wakeLock.request('screen').then(w => { _wake = w; w.addEventListener('release', () => { if (_wake === w) _wake = null; }); })
      .catch(() => {}).finally(() => { _wakeBezig = false; });
  } catch(e){}
}
function schermLos(){ try { if (_wake) _wake.release(); } catch(e){} _wake = null; }
const loopt = t => t.klok.fase === 'spel' || t.klok.fase === 'wissel';
const klokRest = t => loopt(t) ? Math.max(0, t.klok.eindMs - Date.now()) : (t.klok.restMs || 0);
const klokTotaal = t => Math.max(1, (t.klok.fase === 'wissel' ? t.cfg.wisselMin * 60 : t.duurSec) * 1000);
function tik(){
  const w = document.querySelector('#view-team.actief #tnWortel[data-tn-live]');
  const t = w && S.teamTab === 'toernooitje' ? huidig() : null;
  if (!t || t.status !== 'bezig'){ clearInterval(_tik); _tik = null; schermLos(); return; }
  if (!loopt(t)) return;
  const rest = t.klok.eindMs - Date.now();
  if (rest <= 0){
    // elk toestel dat meekijkt schrijft dezelfde nieuwe stand; dat is onschuldig
    if (t.klok.fase === 'spel'){ t.klok = { fase:'tijd', eindMs:0, restMs:0 }; signaal(3); }
    else { t.klok = { fase:'klaar', eindMs:0, restMs:t.duurSec * 1000 }; signaal(1); }
    schrijf(t, { klok:t.klok });
    API.renderTeam(); return;
  }
  schermAan();
  w.querySelectorAll('[data-tn-klok]').forEach(el => { el.textContent = mmss(rest); });
  const b = w.querySelector('#tnKlokBalk'); if (b) b.style.width = (100 - rest / klokTotaal(t) * 100) + '%';
}

/* ==================== ACTIES TIJDENS HET TOERNOOITJE ==================== */
function startRonde(t){
  geluidAan(); schermAan();
  const upd = {};
  t.rondes[t.ri].wedstrijden.forEach(m => { m.st = 'bezig'; upd[`uitslag.${m.id}`] = uitslagVeld(m); });
  if (!t.gestartMs){ t.gestartMs = Date.now(); upd.gestartMs = t.gestartMs; }
  t.klok = { fase:'spel', eindMs:Date.now() + t.duurSec * 1000, restMs:t.duurSec * 1000 }; upd.klok = t.klok;
  API.renderTeam(); schrijf(t, upd);
}
function naarVolgende(t){
  const r = t.rondes[t.ri], upd = {};
  r.wedstrijden.forEach(m => { m.st = 'klaar'; upd[`uitslag.${m.id}`] = uitslagVeld(m); });
  if (t.ri >= t.rondes.length - 1){
    t.status = 'klaar'; t.klok = { fase:'klaar', eindMs:0, restMs:0 };
    Object.assign(upd, { status:'klaar', klok:t.klok, klaarMs:Date.now() });
  } else {
    t.ri++;
    const nw = t.rondes[t.ri];
    if (nw.type === 'wissel') trekWissel(t, t.ri);
    if (nw.type === 'finale'){
      const st = standTeams(t);
      nw.wedstrijden.forEach(m => { m.a = st[m.plek - 1]?.id ?? null; m.b = st[m.plek]?.id ?? null; });
      nw.rust = st.map(x => x.id).filter(id => !nw.wedstrijden.some(m => m.a === id || m.b === id));
    }
    const w = t.cfg.wisselMin * 60000;
    t.klok = w > 0 ? { fase:'wissel', eindMs:Date.now() + w, restMs:w } : { fase:'klaar', eindMs:0, restMs:t.duurSec * 1000 };
    Object.assign(upd, { ri:t.ri, klok:t.klok, rondes:kaalRondes(t) });
  }
  S._toernTab = 'nu';
  window.scrollTo(0, 0);
  API.renderTeam(); schrijf(t, upd);
}
function vindWed(t, id){ for (const r of t.rondes) for (const m of r.wedstrijden) if (m.id === id) return { r, m }; return null; }
function zetGoal(t, m, kant, d, sp){
  const k = kant === 'a' ? 'sa' : 'sb';
  if (d > 0){ m[k]++; m.goals = [...(m.goals || []), { t:kant, sp:sp || null }]; }
  else if (m[k] > 0){
    m[k]--;
    const g = (m.goals || []).slice();
    for (let i = g.length - 1; i >= 0; i--) if (g[i].t === kant){ g.splice(i, 1); break; }
    m.goals = g;
  } else return;
  try { if (navigator.vibrate) navigator.vibrate(40); } catch(e){}
  schrijf(t, { [`uitslag.${m.id}`]: uitslagVeld(m), [`goals.${m.id}`]: m.goals });
}
function terugNaarOverzicht(){
  if (S.teamTab !== 'toernooitje') return;
  const stack = S._teamTabStack || [];
  if (stack[stack.length - 1] === 'toernooitjes' && S._navTeamTabTerug?.()) return;
  API.zetTeamTab('toernooitjes');
}

/* ==================== OVERZICHT ==================== */
export function htmlToernooitjes(){
  const bezig = alle().filter(t => t.status === 'bezig').sort(nieuwEerst);
  const klaar = alle().filter(t => t.status !== 'bezig').sort(nieuwEerst).slice(0, 40);
  const rij = t => {
    const live = t.status === 'bezig', wed = t.rondes.reduce((n, r) => n + r.wedstrijden.length, 0);
    const winnaar = live ? '' : (eindRijen(t)[0]?.naam || '');
    const titel = live ? `Ronde ${t.ri + 1} van ${t.rondes.length}` : datumKort(t.datum) + (winnaar ? ` · winnaar ${winnaar}` : '');
    const meta = live ? `${datumKort(t.datum)} · ${omschrijving(t)}` : `${omschrijving(t)} · ${wed} wedstrijden`;
    return `<button class="lj-item" data-tn="open" data-a="${esc(t.id)}">
      <span class="lj-ico">${ico(live ? 'football-whistle' : 'football-tournament', 24)}</span>
      <span class="lj-t"><span class="lj-titel">${esc(titel)}</span><span class="lj-meta">${esc(meta)}</span></span>
      <span class="lj-pijl">›</span></button>`;
  };
  return `<div class="tn" id="tnWortel">
    <p class="lj-intro">Een onderling toernooitje met je eigen spelers en gastspelers. De uitslagen tellen niet mee in de speelminuten en Stats.</p>
    <button class="knop fluo vol tn-nieuw" data-tn="nieuw">${ico('action-add', 20)} Nieuw toernooitje</button>
    ${bezig.length ? `<div class="tn-kop">Bezig</div>${bezig.map(rij).join('')}` : ''}
    ${klaar.length ? `<div class="tn-kop">Eerder gespeeld</div>${klaar.map(rij).join('')}`
      : (bezig.length ? '' : `<div class="kaart leeg">Nog geen toernooitjes.<br>Kies wie er meedoet, hoeveel veldjes je hebt en hoeveel tijd, dan maakt Cluppie het schema.</div>`)}
  </div>`;
}

/* ==================== OPZET: SCHERMEN ==================== */
const wrap = (inhoud, live) => `<div class="tn" id="tnWortel"${live ? ' data-tn-live="1"' : ''}>${inhoud}</div>`;
const stappen = n => `<div class="tn-stappen" aria-label="Stap ${n} van 3">${[1, 2, 3].map(i => `<i class="${i <= n ? 'aan' : ''}"></i>`).join('')}<span>Stap ${n} van 3</span><button class="tn-vorige" data-tn="vorige">${ico('navigation-back', 16)} Vorige</button></div>`;
function hWie(c){
  const n = c.spelers.filter(p => p.mee).length;
  const eigen = c.spelers.filter(p => !p.gast), gasten = c.spelers.filter(p => p.gast);
  const knop = p => `<button class="tn-sp ${p.mee ? 'mee' : ''}" data-tn="speler" data-a="${esc(p.id)}" aria-pressed="${p.mee}">
      <span class="nr">${p.gast ? ico('team-player', 18) : esc(p.nr)}</span><span class="nm">${esc(p.naam)}</span>${p.gast ? '<span class="gast">gast</span>' : ''}<span class="vink">${ico('action-check', 14)}</span></button>`;
  return stappen(1) + `
    ${presentieVandaag() ? `<button class="knop klein" data-tn="presentie">${ico('attendance-present', 16)} Neem presentie van vandaag over</button>` : ''}
    <div class="tn-kop">Selectie <span class="tel">${eigen.filter(p => p.mee).length} van ${eigen.length}</span></div>
    ${eigen.length ? `<div class="tn-spelers">${eigen.map(knop).join('')}</div>` : '<p class="tn-uitleg">Dit team heeft nog geen spelers. Voeg ze toe bij Spelers, of werk hier met gastspelers.</p>'}
    <div class="tn-kop">Gastspelers <span class="tel">${gasten.filter(p => p.mee).length}</span></div>
    ${gasten.length ? `<div class="tn-spelers">${gasten.map(knop).join('')}</div>` : '<p class="tn-uitleg">Vriendje, broertje of speler van een ander team erbij? Voeg alleen de voornaam toe.</p>'}
    <div class="tn-gastrij"><input class="invoer" id="tnGastNaam" type="text" maxlength="20" placeholder="Voornaam gastspeler" autocomplete="off" aria-label="Voornaam gastspeler" value="${esc(c.gastInvoer || '')}">
      <button class="knop" data-tn="gast">${ico('team-player-add', 18)} Voeg toe</button></div>
    <div class="tn-voet"><button class="knop fluo vol" data-tn="stapnaar" data-a="opzet" ${n < 4 ? 'disabled' : ''}>${n < 4 ? 'Kies minstens 4 spelers' : `Verder met ${n} spelers`}</button></div>`;
}
function hOpzet(c){
  const k = c.cfg, p = plan(c), vast = k.vorm === 'vast';
  const stap = (sleutel, eenheid = '') => { const [min, max] = GRENS[sleutel]; return `<div class="tn-stap">
      <button data-tn="stap" data-a="${sleutel}" data-b="-1" ${k[sleutel] <= min ? 'disabled' : ''} aria-label="Minder">&minus;</button>
      <span class="w">${k[sleutel]}${eenheid ? `<small>${eenheid}</small>` : ''}</span>
      <button data-tn="stap" data-a="${sleutel}" data-b="1" ${k[sleutel] >= max ? 'disabled' : ''} aria-label="Meer">+</button></div>`; };
  const schuif = sleutel => `<button class="tn-schuif ${k[sleutel] ? 'aan' : ''}" data-tn="schuif" data-a="${sleutel}" role="switch" aria-checked="${!!k[sleutel]}" aria-label="Aan of uit"></button>`;
  return stappen(2) + `
    <div class="tn-vormen">
      <button class="tn-vorm ${vast ? 'aan' : ''}" data-tn="vorm" data-a="vast" aria-pressed="${vast}"><b>Vaste teams</b><span>Teams blijven bij elkaar en spelen tegen elkaar. Stand per team.</span></button>
      <button class="tn-vorm ${!vast ? 'aan' : ''}" data-tn="vorm" data-a="wissel" aria-pressed="${!vast}"><b>Wisselende teams</b><span>Elke ronde nieuwe teams. Elke speler spaart zijn eigen punten.</span></button>
    </div>
    <div class="tn-kop">Veldjes en teams</div>
    <div class="kaart tn-kaart">
      <div class="tn-rij"><span class="lab">Veldjes<small>Zoveel wedstrijden tegelijk</small></span>${stap('velden')}</div>
      ${vast ? `
      <div class="tn-rij"><span class="lab">Teams<small>${teamGrootte(p)}</small></span>${stap('teams')}</div>
      <div class="tn-rij"><span class="lab">Twee keer tegen elkaar<small>Dubbele competitie</small></span>${schuif('dubbel')}</div>
      ${k.teams >= 3 ? `<div class="tn-rij"><span class="lab">Finale na de poule<small>Nummer 1 tegen 2${k.velden >= 2 && k.teams >= 4 ? ', en 3 tegen 4' : ''}</small></span>${schuif('finale')}</div>` : ''}` : `
      <div class="tn-rij"><span class="lab">Rondes<small>${p.nT} teams per ronde · ${teamGrootte(p)}</small></span>${stap('rondes')}</div>`}
    </div>
    <div class="tn-kop">Tijd</div>
    <div class="segment u-mb-sm">
      <button type="button" class="${k.tijdModus === 'totaal' ? 'actief' : ''}" data-tn="tijdmodus" data-a="totaal">Ik weet de totale tijd</button>
      <button type="button" class="${k.tijdModus === 'per' ? 'actief' : ''}" data-tn="tijdmodus" data-a="per">Ik kies de wedstrijdduur</button>
    </div>
    <div class="kaart tn-kaart">
      ${k.tijdModus === 'totaal'
        ? `<div class="tn-rij"><span class="lab">We hebben<small>Van eerste fluitsignaal tot einde</small></span>${stap('totaalMin', 'min')}</div>`
        : `<div class="tn-rij"><span class="lab">Een wedstrijd duurt</span>${stap('perMin', 'min')}</div>`}
      <div class="tn-rij"><span class="lab">Wisseltijd<small>Tussen twee rondes</small></span>${stap('wisselMin', 'min')}</div>
    </div>
    <div class="tn-kop">Extra</div>
    <div class="kaart tn-kaart">
      <div class="tn-rij"><span class="lab">Doelpuntenmakers bijhouden<small>Na elke goal tik je aan wie scoorde. Geeft een topscorerslijst.</small></span>${schuif('scorers')}</div>
    </div>
    <div class="tn-kop">Zo ziet het eruit</div>
    <div class="kaart tn-plan">
      <div class="groot">${p.slots} rondes van ${duurTxt(Math.max(0, p.duurSec))}</div>
      <ul>
        <li>${ico('football-pitch', 16)}<span>${p.wed} wedstrijden op ${veldjes(k.velden)}${vast ? `, elk team speelt ${p.perTeamWed} keer${finaleKan(k) ? ' plus de finaleronde' : ''}` : ', iedereen speelt elke ronde'}</span></li>
        <li>${ico('training-duration', 16)}<span>${Math.max(0, Math.round(p.totaalSec / 60))} minuten in totaal, klaar rond ${klokUur(Date.now() + Math.max(0, p.totaalSec) * 1000)} als je nu start</span></li>
        <li>${ico('football-competition', 16)}<span>Winst 3 punten, gelijk 1. Bij gelijke stand telt het doelsaldo.</span></li>
      </ul>
      ${p.fout ? `<div class="tn-fout">${ico('action-warning', 18)}<span>${esc(p.fout)}</span></div>` : ''}
    </div>
    <div class="tn-voet"><button class="knop fluo vol" data-tn="${vast ? 'stapnaar' : 'start'}" data-a="teams" ${p.fout ? 'disabled' : ''}>${vast ? 'Teams maken' : 'Start: husselen voor ronde 1'}</button></div>`;
}
function teamKaarten(x, teams, tikbaar){
  return teams.map(t => `<div class="kaart tn-team" style="--tk:${esc(t.kleur)}">
      <div class="tn-team-kop">${bib(t.kleur)}<b>${esc(t.naam)}</b><span class="aantal">${t.spelers.length} spelers</span></div>
      <div class="tn-chips">${t.spelers.map(id => { const p = deelnemer(x, id); if (!p) return ''; const inh = esc(p.naam) + (p.gast ? ' <i>gast</i>' : '');
        return tikbaar ? `<button class="tn-chip" data-tn="verplaats" data-a="${esc(id)}">${inh}</button>` : `<span class="tn-chip vast">${inh}</span>`; }).join('') || '<span class="tn-uitleg">Nog geen spelers</span>'}</div>
    </div>`).join('');
}
function hTeams(c){
  return stappen(3) + `
    <p class="tn-uitleg">Tik op een speler om hem naar een ander team te verplaatsen.</p>
    <div class="rij u-mb-sm">
      <button class="knop klein tn-half" data-tn="verdeel" data-a="hussel">${ico('action-sort', 16)} Husselen</button>
      <button class="knop klein tn-half" data-tn="verdeel" data-a="eerlijk">${ico('action-check', 16)} Eerlijk verdelen</button>
    </div>
    ${teamKaarten(c, c.teams, true)}
    <p class="tn-uitleg">Eerlijk verdelen maakt de teams even sterk met de beoordelingen die het hele team ziet. De niveaus zelf komen nergens in beeld en worden niet bewaard.</p>
    <div class="tn-voet"><button class="knop fluo vol" data-tn="start">${ico('football-whistle', 20)} Start toernooitje</button></div>`;
}

/* ==================== LIVE: SCHERMEN ==================== */
const rondeNaam = (r, i) => r.type === 'finale' ? 'Finale' : `Ronde ${i + 1}`;
function tmLabel(t, r, id, fallback){
  const tm = teamVan(t, r, id);
  return tm ? `<span class="tn-tm">${bib(tm.kleur)}${esc(tm.naam)}</span>` : `<span class="tn-tm stil">${esc(fallback || '')}</span>`;
}
function hLive(t){
  const tab = S._toernTab || 'nu', r = t.rondes[t.ri];
  const tabs = [['nu', 'Nu'], ['schema', 'Schema'], ['stand', 'Stand'], ['teams', 'Teams']];
  let inhoud = '';
  if (tab === 'nu') inhoud = hNu(t);
  if (tab === 'schema') inhoud = hSchema(t);
  if (tab === 'stand') inhoud = hStand(t);
  if (tab === 'teams') inhoud = t.cfg.vorm === 'vast'
    ? `<p class="tn-uitleg">Komt er iemand later of valt er iemand uit? Tik op een speler om hem te verplaatsen.</p>` + teamKaarten(t, t.teams, true)
    : `<p class="tn-uitleg">De teams van ${rondeNaam(r, t.ri).toLowerCase()}. Elke ronde wordt er opnieuw gehusseld.</p>` + teamKaarten(t, r.teams || [], false);
  return `
    <div class="tn-balkje"><span class="info">${esc(omschrijving(t))} · ${duurTxt(t.duurSec)}</span>
      ${tab !== 'nu' ? `<span class="tn-klokmini" data-tn-klok>${mmss(klokRest(t))}</span>` : ''}
      <button class="lj-menu" data-tn="menu" aria-label="Meer opties">${ico('action-more', 20)}</button></div>
    <div class="segment tn-tabs">${tabs.map(([id, naam]) => `<button type="button" class="${tab === id ? 'actief' : ''}" data-tn="tab" data-a="${id}">${naam}</button>`).join('')}</div>
    ${inhoud}`;
}
function hNu(t){
  const r = t.rondes[t.ri], k = t.klok, laatste = t.ri >= t.rondes.length - 1, rest = klokRest(t);
  const pil = { klaar:['wacht', 'Klaar om te starten'], spel:['loopt', 'Loopt'], pauze:['wacht', 'Gepauzeerd'], tijd:['tijd', 'Tijd!'], wissel:['wacht', 'Wisselen'] }[k.fase] || ['wacht', ''];
  const speelbaar = ['spel', 'pauze', 'tijd'].includes(k.fase);
  const volgendeTxt = laatste ? 'Afsluiten en eindstand' : t.rondes[t.ri + 1].type === 'finale' ? 'Naar de finale' : `Naar ronde ${t.ri + 2}`;
  let knoppen = '';
  if (k.fase === 'klaar' || k.fase === 'wissel') knoppen = `<button class="knop fluo vol" data-tn="klok-start">${ico('training-start', 20)} Start ${rondeNaam(r, t.ri).toLowerCase()}</button>`;
  if (k.fase === 'spel') knoppen = `<div class="rij"><button class="knop tn-half" data-tn="klok-pauze">Pauze</button><button class="knop tn-half" data-tn="eerder">Eerder afsluiten</button></div>`;
  if (k.fase === 'pauze') knoppen = `<div class="rij"><button class="knop fluo tn-half" data-tn="klok-verder">Verder</button><button class="knop tn-half" data-tn="eerder">Eerder afsluiten</button></div>`;
  if (k.fase === 'tijd') knoppen = `<button class="knop fluo vol" data-tn="volgende">${volgendeTxt}</button>`;
  const kant = (m, z) => {
    const tm = teamVan(t, r, m[z]), s = z === 'a' ? m.sa : m.sb;
    if (!tm) return '';
    return `<div class="tn-kant"><div class="wie"><b>${bib(tm.kleur)}${esc(tm.naam)}</b><small>${esc(namenVan(t, tm))}</small></div>
      <button class="tn-min" data-tn="goal" data-a="${esc(m.id)}" data-b="${z}" data-c="-1" ${!speelbaar || s < 1 ? 'disabled' : ''} aria-label="Doelpunt eraf bij ${esc(tm.naam)}">${MIN_ICO}</button>
      <span class="tn-score" aria-label="Score ${esc(tm.naam)}">${s}</span>
      <button class="tn-plus" data-tn="goal" data-a="${esc(m.id)}" data-b="${z}" data-c="1" ${!speelbaar ? 'disabled' : ''} aria-label="Doelpunt voor ${esc(tm.naam)}">${ico('action-add', 26)}</button></div>`;
  };
  const velden = r.wedstrijden.map(m => `<div class="kaart tn-veld">
      <div class="tn-veld-kop">${ico('football-pitch', 18)} Veld ${m.veld}${m.plek ? `<span class="extra">${m.plek === 1 ? 'Finale' : 'Om plek 3'}</span>` : ''}</div>
      ${kant(m, 'a')}${kant(m, 'b')}</div>`).join('');
  const rust = r.rust.length ? `<div class="tn-bijregel">Rust deze ronde: ${r.rust.map(id => tmLabel(t, r, id)).join(' ')}</div>` : '';
  let hierna = '';
  const nw = t.rondes[t.ri + 1];
  if (nw){
    const regels = nw.type === 'wissel' ? `<p class="tn-uitleg">Nieuwe teams, er wordt opnieuw gehusseld.</p>`
      : nw.wedstrijden.map(m => `<div class="hr"><span class="v">Veld ${m.veld}</span>${tmLabel(t, nw, m.a, 'Nr ' + m.plek)} <span class="tegen">tegen</span> ${tmLabel(t, nw, m.b, 'Nr ' + ((m.plek || 0) + 1))}</div>`).join('');
    hierna = `<div class="tn-kop">Hierna · ${rondeNaam(nw, t.ri + 1)}</div><div class="kaart tn-hierna">${regels}</div>`;
  }
  const husselKnop = r.type === 'wissel' && (k.fase === 'klaar' || k.fase === 'wissel') ? `<button class="knop klein vol u-mb-sm" data-tn="hussel-ronde">${ico('action-sort', 16)} Opnieuw husselen voor deze ronde</button>` : '';
  const gelijkFinale = k.fase === 'tijd' && r.type === 'finale' && r.wedstrijden.some(m => m.sa === m.sb)
    ? `<div class="tn-fout los">${ico('action-info', 18)}<span>Gelijk in de finaleronde? Neem strafschoppen en tel de winnende goal erbij, anders beslist de poulestand.</span></div>` : '';
  return `
    <div class="kaart tn-klok ${esc(k.fase)}">
      <div class="top"><span class="ronde">${rondeNaam(r, t.ri)}${r.type !== 'finale' ? ` van ${t.rondes.length}` : ''}</span><span class="tn-pil ${pil[0]}">${pil[1]}</span></div>
      <div class="tijd" data-tn-klok>${mmss(rest)}</div>
      <div class="balk"><i id="tnKlokBalk" style="width:${k.fase === 'klaar' ? 0 : Math.min(100, 100 - rest / klokTotaal(t) * 100)}%"></i></div>
      ${knoppen}
    </div>
    ${gelijkFinale}${husselKnop}${velden}${rust}${hierna}`;
}
function hSchema(t, kopje){
  const stapMs = (t.duurSec + t.cfg.wisselMin * 60) * 1000, basis = t.gestartMs || Date.now(), klaar = t.status !== 'bezig';
  return (kopje || '') + `<p class="tn-uitleg">Tik op een gespeelde wedstrijd om de uitslag te verbeteren.</p>` + t.rondes.map((r, i) => {
    // afgesloten: rondes die nooit begonnen zijn (eerder gestopt) laten we weg
    if (klaar && !r.wedstrijden.some(m => m.st !== 'open')) return '';
    const st = klaar || i < t.ri ? ['', 'Gespeeld'] : i === t.ri ? (t.klok.fase === 'klaar' || t.klok.fase === 'wissel' ? ['wacht', 'Nu aan de beurt'] : ['loopt', 'Bezig']) : ['', 'Straks'];
    const wed = r.wedstrijden.length ? r.wedstrijden.map(m => {
      const gespeeld = m.st !== 'open';
      return `<button class="tn-wed ${!klaar && i === t.ri ? 'nu' : ''}" ${gespeeld ? `data-tn="corr" data-a="${esc(m.id)}"` : 'disabled'}>
        <span class="v">V${m.veld}</span><span class="a">${tmLabel(t, r, m.a, 'Nr ' + m.plek)}</span>
        <span class="u ${gespeeld ? '' : 'leeg'}">${gespeeld ? m.sa + ' – ' + m.sb : 'tegen'}</span><span class="b">${tmLabel(t, r, m.b, 'Nr ' + ((m.plek || 0) + 1))}</span></button>`;
    }).join('') : `<p class="tn-uitleg">De teams worden gehusseld zodra deze ronde aan de beurt is.</p>`;
    const rust = r.rust.length && r.type !== 'finale' ? `<div class="tn-bijregel">Rust: ${r.rust.map(id => tmLabel(t, r, id)).join(' ')}</div>` : '';
    return `<div class="tn-ronde-kop">${rondeNaam(r, i)} <time>${klokUur(basis + i * stapMs)}</time><span class="tn-pil ${st[0]}">${st[1]}</span></div>${wed}${rust}`;
  }).join('');
}
function standTabel(rijen, soort){
  const team = soort === 'team';
  return `<div class="tn-tabel"><table>
    <thead><tr><th>#</th><th>${team ? 'Team' : 'Speler'}</th><th>G</th><th>W</th>${team ? '<th>GL</th><th>V</th>' : ''}<th>DS</th><th>Pnt</th></tr></thead>
    <tbody>${rijen.map((x, i) => `<tr class="${i === 0 && x.g ? 'top' : ''}"><td>${i + 1}</td><td><span class="tn-tm">${team ? bib(x.kleur) : ''}${esc(x.naam)}${x.gast ? ' <i class="tn-gast">gast</i>' : ''}</span></td>
      <td>${x.g}</td><td>${x.w}</td>${team ? `<td>${x.gl}</td><td>${x.v}</td>` : ''}<td>${x.dv - x.dt > 0 ? '+' : ''}${x.dv - x.dt}</td><td class="pnt">${x.pnt}</td></tr>`).join('')}</tbody></table></div>`;
}
function hTopscorers(t){
  if (!t.cfg.scorers) return '';
  const top = topscorers(t);
  return `<div class="tn-kop">Topscorers</div>` + (top.length
    ? `<div class="tn-tabel"><table><tbody>${top.slice(0, 8).map((x, i) => `<tr><td>${i + 1}</td><td>${esc(x.naam)}</td><td class="pnt">${x.n}</td></tr>`).join('')}</tbody></table></div>`
    : `<p class="tn-uitleg">Nog geen doelpunten met een naam erbij.</p>`);
}
function hStand(t){
  const vast = t.cfg.vorm === 'vast';
  const live = t.rondes[t.ri].wedstrijden.some(m => m.st === 'bezig');
  return `${live ? `<p class="tn-uitleg"><span class="tn-pil loopt">Live</span> De lopende wedstrijden tellen al mee.</p>` : ''}
    ${vast ? standTabel(standTeams(t), 'team') : standTabel(standSpelers(t), 'speler')}
    <p class="tn-uitleg tn-legenda">G gespeeld · W winst${vast ? ' · GL gelijk · V verlies' : ''} · DS doelsaldo${vast && finaleKan(t.cfg) ? '. De finaleronde bepaalt de eindstand.' : ''}</p>
    ${hTopscorers(t)}`;
}

/* ==================== EINDSTAND ==================== */
function hEind(t){
  const vast = t.cfg.vorm === 'vast', rijen = eindRijen(t);
  const metFinale = vast && t.rondes.some(r => r.type === 'finale');
  const trede = (x, plek) => x ? `<div class="tn-trede p${plek}" style="--tk:${esc(x.kleur || 'var(--ink-2)')}">${plek === 1 ? ico('football-tournament', 34) : ''}<span class="plek">${plek}</span><b>${esc(x.naam)}</b>
      <small>${vast ? esc(namenVan(t, (t.teams || []).find(tm => tm.id === x.id))) : x.pnt + ' punten'}</small></div>` : '<div></div>';
  return `
    <div class="tn-balkje"><span class="info">${esc(datumLang(t.datum))} · ${esc(omschrijving(t))}</span>
      <button class="lj-menu" data-tn="menu" aria-label="Meer opties">${ico('action-more', 20)}</button></div>
    <div class="tn-podium">${trede(rijen[1], 2)}${trede(rijen[0], 1)}${trede(rijen[2], 3)}</div>
    ${standTabel(rijen, vast ? 'team' : 'speler')}
    ${metFinale ? `<p class="tn-uitleg tn-legenda">Volgorde na de finaleronde; de punten komen uit de poule.</p>` : ''}
    ${hTopscorers(t)}
    <div class="tn-acties">
      <button class="knop vol" data-tn="deel">${ico('action-whatsapp', 20)} Deel de uitslag via WhatsApp</button>
      <button class="knop vol" data-tn="opnieuw">${ico('football-whistle', 20)} Nog een keer met dezelfde ${vast ? 'teams' : 'spelers'}</button>
      <button class="knop fluo vol" data-tn="overzicht">Klaar</button>
    </div>
    ${hSchema(t, '<div class="tn-kop">Alle uitslagen</div>')}`;
}
function deelTekst(t){
  const vast = t.cfg.vorm === 'vast', rijen = eindRijen(t), top = topscorers(t);
  const metFinale = vast && t.rondes.some(r => r.type === 'finale');
  let s = `*Toernooitje${S.team?.naam ? ' ' + S.team.naam : ''}*\n${datumLang(t.datum)}\n\n`;
  rijen.forEach((x, i) => { s += `${i + 1}. ${x.naam}` + (vast ? ` (${namenVan(t, (t.teams || []).find(tm => tm.id === x.id))})` : '') + (metFinale ? '' : `, ${x.pnt} pnt`) + '\n'; });
  if (t.cfg.scorers && top.length) s += `\nTopscorer: ${top[0].naam} (${top[0].n})\n`;
  return s.trim();
}

/* ==================== TABBLAD 'toernooitje' ==================== */
export function htmlToernooitje(){
  if (S._toernOpen === 'nieuw' && concept()){
    const c = concept();
    return wrap(c.stap === 'opzet' ? hOpzet(c) : c.stap === 'teams' ? hTeams(c) : hWie(c));
  }
  if (!S._toernOpen || S._toernOpen === 'nieuw'){
    // na herladen: het laatst geopende toernooitje van dit team terugzetten
    S._toernOpen = null;
    try { const o = JSON.parse(localStorage.getItem(LS_OPEN) || 'null'); if (o && o.teamId === S.teamId && o.id) S._toernOpen = o.id; } catch(e){}
  }
  const t = huidig();
  if (!t) return S._toernGeladen ? htmlToernooitjes() : wrap('<div class="kaart leeg">Toernooitje laden…</div>');
  return t.status === 'bezig' && t.rondes.length ? wrap(hLive(t), true) : wrap(hEind(t));
}
export function toernooiTitel(){
  const c = concept();
  if (S._toernOpen === 'nieuw' && c) return ({ wie:'Wie doet er mee?', opzet:'Opzet', teams:'Teams' })[c.stap] || 'Toernooitje';
  const t = huidig();
  return t && t.status !== 'bezig' ? 'Eindstand' : 'Toernooitje';
}

/* ==================== KOPPELEN ==================== */
const OPZET_ACTIES = {
  speler(c, a){ const p = c.spelers.find(x => x.id === a); if (p) p.mee = !p.mee; },
  presentie(c){
    const rec = presentieVandaag(); if (!rec) return meld('Voor vandaag is nog geen presentie ingevuld');
    const afw = new Set(rec.afwezig || []);
    c.spelers.forEach(p => { if (!p.gast) p.mee = !afw.has(p.id); });
    meld(`Presentie overgenomen: ${afw.size} afwezig`);
  },
  gast(c){
    const naam = String($('#tnGastNaam')?.value || '').trim().split(/\s+/)[0];
    if (!naam) return meld('Vul een voornaam in');
    c.spelers.push({ id:'g' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5), naam:naam.slice(0, 20), nr:'', gast:true, mee:true });
    c.gastInvoer = '';
    setTimeout(() => $('#tnGastNaam')?.focus(), 30);
  },
  stapnaar(c, a){
    if (a === 'teams' && c.teamSig !== sigVan(c)) verdeel(c, 'eerlijk');
    c.stap = a; bewaarCfg(c.cfg); window.scrollTo(0, 0);
  },
  vorige(c){
    if (c.stap === 'wie'){ terugNaarOverzicht(); return false; }
    c.stap = c.stap === 'teams' ? 'opzet' : 'wie'; window.scrollTo(0, 0);
  },
  vorm(c, a){ c.cfg.vorm = a; },
  stap(c, a, b){ const g = GRENS[a]; if (!g) return; c.cfg[a] = Math.min(g[1], Math.max(g[0], (Number(c.cfg[a]) || 0) + Number(b) * g[2])); },
  schuif(c, a){ c.cfg[a] = !c.cfg[a]; },
  tijdmodus(c, a){ c.cfg.tijdModus = a; },
  verdeel(c, a){
    const gewogen = verdeel(c, a);
    meld(a === 'hussel' ? 'Teams gehusseld' : gewogen ? 'Teams eerlijk verdeeld' : 'Nog geen beoordelingen: de teams zijn gehusseld');
  },
  verplaats(c, a){ modalVerplaats(a); return false; },
  start(c){
    if (c.cfg.vorm === 'vast' && c.teamSig !== sigVan(c)) verdeel(c, 'eerlijk');
    startToernooi(c); return false;
  },
};
const LIVE_ACTIES = {
  tab(t, a){ S._toernTab = a; window.scrollTo(0, 0); },
  menu(t){ modalMenu(t.id); return false; },
  'klok-start'(t){ startRonde(t); return false; },
  'klok-pauze'(t){ t.klok = { fase:'pauze', eindMs:0, restMs:klokRest(t) }; schrijf(t, { klok:t.klok }); },
  'klok-verder'(t){ geluidAan(); schermAan(); t.klok = { fase:'spel', eindMs:Date.now() + (t.klok.restMs || 0), restMs:t.klok.restMs || 0 }; schrijf(t, { klok:t.klok }); },
  eerder(t){ if (!confirm('Deze ronde nu al afsluiten? De klok stopt en de uitslagen tellen zoals ze nu staan.')) return false; naarVolgende(t); return false; },
  volgende(t){ naarVolgende(t); return false; },
  'hussel-ronde'(t){ trekWissel(t, t.ri); schrijf(t, { rondes:kaalRondes(t) }); meld('Nieuwe teams voor deze ronde'); },
  goal(t, a, b, c){
    const w = vindWed(t, a); if (!w) return false;
    if (Number(c) > 0 && t.cfg.scorers){ modalScoorder(t.id, a, b); return false; }
    zetGoal(t, w.m, b, Number(c));
  },
  verplaats(t, a){ modalVerplaats(a); return false; },
  corr(t, a){ modalCorr(t.id, a); return false; },
  deel(t){ modalDelen(t.id); return false; },
  opnieuw(t){ nogEenKeer(t); return false; },
};
export function koppelToernooi(v, tab, api){
  API = api || API;
  const w = v.querySelector('#tnWortel'); if (!w) return;
  w.onclick = e => {
    const el = e.target.closest('[data-tn]');
    if (!el || el.disabled || !w.contains(el)) return;
    geluidAan();
    const { tn:actie, a, b, c } = el.dataset;
    if (actie === 'nieuw'){ nieuwConcept(); window.scrollTo(0, 0); API.zetTeamTab('toernooitje'); return; }
    if (actie === 'open'){ S._toernConcept = null; S._toernTab = 'nu'; zetOpen(a); window.scrollTo(0, 0); API.zetTeamTab('toernooitje'); return; }
    if (actie === 'overzicht'){ terugNaarOverzicht(); return; }
    const cpt = S._toernOpen === 'nieuw' ? concept() : null, t = cpt ? null : huidig();
    const f = cpt ? OPZET_ACTIES[actie] : t ? LIVE_ACTIES[actie] : null;
    if (!f) return;
    if (f(cpt || t, a, b, c) !== false) API.renderTeam();
  };
  const gast = w.querySelector('#tnGastNaam');
  if (gast){
    gast.oninput = () => { const c = concept(); if (c) c.gastInvoer = gast.value; };
    gast.onkeydown = e => { if (e.key === 'Enter'){ e.preventDefault(); const c = concept(); if (c){ OPZET_ACTIES.gast(c); API.renderTeam(); } } };
  }
  /* Terugknop (toestel én de ‹ in de kop): binnen de opzet eerst één stap terug. */
  terugLaag('toernOpzet', {
    z:1,
    open: () => S.teamTab === 'toernooitje' && S._toernOpen === 'nieuw' && !!concept() && concept().stap !== 'wie'
      && !!document.querySelector('#view-team.actief #tnWortel'),
    sluit: () => { const c = concept(); if (!c) return; c.stap = c.stap === 'teams' ? 'opzet' : 'wie'; window.scrollTo(0, 0); API.renderTeam(); },
  });
  if (w.hasAttribute('data-tn-live')){
    if (!_tik) _tik = setInterval(tik, 250);
    const t = huidig(); if (t && t.klok.fase === 'spel') schermAan();
  }
}

/* ==================== DIALOGEN ==================== */
/* Dialogen zoeken het toernooitje en de wedstrijd bij elke tik opnieuw op: het
   document kan intussen door een andere coach zijn bijgewerkt. */
function modalVerplaats(spelerId){
  const x = S._toernOpen === 'nieuw' ? concept() : huidig(); if (!x) return;
  const p = deelnemer(x, spelerId); if (!p) return;
  const huidigTeam = (x.teams || []).find(tm => tm.spelers.includes(spelerId));
  openModal(`<div class="tn-dialoog"><h3>${esc(p.naam)}</h3><p class="lj-msub">Naar welk team?</p>
    <div class="tn-keuzes">${(x.teams || []).map(tm => `<button class="knop" data-tn-m="${esc(tm.id)}" ${tm === huidigTeam ? 'disabled' : ''}>${bib(tm.kleur)} ${esc(tm.naam)}</button>`).join('')}</div>
    <button class="knop vol" data-tn-m="">Annuleren</button></div>`, { vorm:'dialoog' });
  $$('#modalInhoud [data-tn-m]').forEach(b => b.onclick = () => {
    const naar = b.dataset.tnM;
    sluitModal();
    if (!naar) return;
    const y = S._toernOpen === 'nieuw' ? concept() : huidig(); if (!y) return;
    y.teams.forEach(tm => { tm.spelers = tm.spelers.filter(id => id !== spelerId); });
    const doel = y.teams.find(tm => tm.id === naar); if (doel) doel.spelers.push(spelerId);
    if (y.spelers) y.teamSig = sigVan(y);
    else schrijf(y, { teams:y.teams.map(tm => ({ id:tm.id, naam:tm.naam, kleur:tm.kleur, spelers:[...tm.spelers] })) });
    API.renderTeam();
  });
}
function modalScoorder(tid, wedId, kant){
  const t = vind(tid), w = t && vindWed(t, wedId); if (!w) return;
  const tm = teamVan(t, w.r, w.m[kant]); if (!tm) return;
  openModal(`<div class="tn-dialoog"><h3>${bib(tm.kleur)} Goal voor ${esc(tm.naam)}</h3><p class="lj-msub">Wie scoorde?</p>
    <div class="tn-keuzes">${tm.spelers.map(id => `<button class="knop" data-tn-m="${esc(id)}">${esc(naamVan(t, id))}</button>`).join('')}</div>
    <button class="knop vol u-mb-sm" data-tn-m="-">Weet ik niet of eigen goal</button>
    <button class="knop vol" data-tn-m="">Toch geen goal</button></div>`, { vorm:'dialoog' });
  $$('#modalInhoud [data-tn-m]').forEach(b => b.onclick = () => {
    const wie = b.dataset.tnM;
    sluitModal();
    if (!wie) return;
    const t2 = vind(tid), w2 = t2 && vindWed(t2, wedId); if (!w2) return;
    zetGoal(t2, w2.m, kant, 1, wie === '-' ? null : wie);
    API.renderTeam();
  });
}
function modalCorr(tid, wedId){
  const teken = () => {
    const t = vind(tid), w = t && vindWed(t, wedId); if (!w){ sluitModal(); return; }
    const rij = z => { const tm = teamVan(t, w.r, w.m[z]), s = z === 'a' ? w.m.sa : w.m.sb; return `<div class="tn-corr"><span class="wie">${tm ? bib(tm.kleur) + esc(tm.naam) : ''}</span>
      <button class="tn-min" data-tn-m="${z}|-1" ${s < 1 ? 'disabled' : ''} aria-label="Minder">${MIN_ICO}</button><span class="tn-score">${s}</span>
      <button class="tn-min" data-tn-m="${z}|1" aria-label="Meer">${ico('action-add', 18)}</button></div>`; };
    openModal(`<div class="tn-dialoog"><h3>Uitslag verbeteren</h3><p class="lj-msub">Veld ${w.m.veld}. De stand rekent meteen mee.</p>${rij('a')}${rij('b')}
      <button class="knop fluo vol u-mt-sm" data-tn-m="klaar">Klaar</button></div>`, { vorm:'dialoog' });
    $$('#modalInhoud [data-tn-m]').forEach(b => b.onclick = () => {
      if (b.dataset.tnM === 'klaar'){ sluitModal(); return; }
      const [z, d] = b.dataset.tnM.split('|');
      const t2 = vind(tid), w2 = t2 && vindWed(t2, wedId); if (!w2) return;
      zetGoal(t2, w2.m, z, Number(d));
      API.renderTeam(); teken();
    });
  };
  teken();
}
function modalDelen(tid){
  const t = vind(tid); if (!t) return;
  const tekst = deelTekst(t);
  openModal(`<h2>Delen via WhatsApp</h2><p class="lj-msub">De eindstand van dit toernooitje.</p>
    <div class="lj-watekst">${esc(tekst)}</div>
    <div class="avg-balk"><span class="slot">${SLOT_ICO}</span><span>Het bericht bevat voornamen van spelers en gaat buiten Cluppie. Deel het alleen in de teamgroep met ouders.</span></div>
    <div class="rij u-mt-sm"><button class="knop fluo" id="tnWaOpen">${ico('action-whatsapp', 18)} Open WhatsApp</button><button class="knop" id="tnWaKop">${ico('action-copy', 18)} Kopieer</button></div>`);
  $('#tnWaOpen').onclick = () => { window.open('https://wa.me/?text=' + encodeURIComponent(tekst), '_blank'); };
  $('#tnWaKop').onclick = async () => {
    try { await navigator.clipboard.writeText(tekst); meld('Gekopieerd: plak in WhatsApp'); }
    catch(e){ meld('Kopiëren lukt niet op dit toestel, gebruik "Open WhatsApp"'); }
  };
}
function modalMenu(tid){
  const t = vind(tid); if (!t) return;
  const live = t.status === 'bezig';
  openModal(`<h2>Toernooitje</h2>
    ${live ? `<button class="lj-mopt" data-tn-m="stop"><span>${ico('action-check', 20)}</span>Nu afsluiten en eindstand tonen</button>` : ''}
    <button class="lj-mopt gevaar" data-tn-m="weg"><span>${ico('admin-delete', 20)}</span>Toernooitje verwijderen</button>`);
  $$('#modalInhoud [data-tn-m]').forEach(b => b.onclick = async () => {
    const t2 = vind(tid); if (!t2){ sluitModal(); return; }
    if (b.dataset.tnM === 'stop'){
      if (!confirm('Het toernooitje nu afsluiten? Rondes die nog niet gespeeld zijn vervallen.')) return;
      const upd = { status:'klaar', klok:{ fase:'klaar', eindMs:0, restMs:0 }, klaarMs:Date.now() };
      t2.rondes[t2.ri]?.wedstrijden.forEach(m => { if (m.st === 'bezig'){ m.st = 'klaar'; upd[`uitslag.${m.id}`] = uitslagVeld(m); } });
      t2.status = 'klaar'; t2.klok = upd.klok;
      sluitModal(); window.scrollTo(0, 0); API.renderTeam();
      schrijf(t2, upd);
      return;
    }
    if (!confirm('Dit toernooitje definitief verwijderen? Alle uitslagen gaan verloren.')) return;
    try {
      await deleteDoc(ref(tid));
      S._toernooitjes = alle().filter(x => x.id !== tid);
      try { localStorage.removeItem(LS_OPEN); } catch(e){}
      S._toernOpen = null;
      sluitModal(); meld('Toernooitje verwijderd'); terugNaarOverzicht();
    } catch(e){ meld('Verwijderen mislukt: ' + (e.code || e.message)); }
  });
}
/* Nog een keer: dezelfde spelers en instellingen (en bij vaste teams dezelfde
   teams) in een nieuw document. */
function nogEenKeer(t){
  const x = { cfg:{ ...t.cfg }, deelnemers:t.deelnemers, teams:(t.teams || []).map(tm => ({ id:tm.id, naam:tm.naam, kleur:tm.kleur, spelers:[...tm.spelers] })), rondes:[] };
  bouwRondes(x);
  const data = {
    datum:vandaagIso(), status:'bezig', seizoen:S.huidigSeizoen || SEIZOEN_FALLBACK,
    gemaaktDoor:S.user?.uid || null, gemaaktMs:Date.now(), bijgewerktMs:Date.now(),
    cfg:x.cfg, deelnemers:{ ...(t.deelnemers || {}) }, teams:x.teams, rondes:kaalRondes(x), uitslag:{}, goals:{},
    ri:0, duurSec:t.duurSec, gestartMs:0, klok:{ fase:'klaar', eindMs:0, restMs:t.duurSec * 1000 },
  };
  S._toernTab = 'nu'; zetOpen(maakDoc(data));
  window.scrollTo(0, 0); API.renderTeam();
}
