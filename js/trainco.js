/* ==================== TRAININGSCOÖRDINATOR ====================
   Eigen, alleen-lezen scherm voor de trainingscoördinator. Menu:
     • Weekplanning  — per dag: welk team traint wanneer, met welke training
     • Overzicht     — tabel team × dag per week; laat zien waar een training ontbreekt
     • Trainingen    — alle trainingen per week; detail met inhoudsopgave,
                       oefenvormen (diagrammen), de uitgewerkte training en de PDF
     • Video's       — de video's die de club aan teams heeft gekoppeld

   Bewust een los scherm naast de coach-app (eigen container #tc-app): het
   raakt de teamnavigatie en state.js niet. Hij ziet GEEN spelersnamen — die
   worden hier niet eens opgehaald. Het aantal spelers komt uit het getal
   `spelersAantal` op het teamdocument (zie teams.js). De opmaak gebruikt de
   onderdelen van de app zelf (kaart, knop, segment, sectie-kop, zijbalk-stijl).

   Datamodel (Firestore: clubs/{clubId}):
     trainingscoordinatoren:     { uid: true, … }   ← rechtenbron (door de beheerder gezet)
     trainingscoordinatorenInfo: { uid: {naam} }    ← alleen voor weergave

   Rechten staan in firestore.rules (zie TRAININGSCOORDINATOR-RULES.md); dit
   bestand levert alleen de weergave. */
import { auth, db, signOut, collection, query, where, onSnapshot, getDocs } from './firebase.js?v=20260922c';
import { S, esc, bewaakTerug } from './state.js?v=20261103e';
import { BOUWEN, isoWeek, youtubeId, youtubeThumb, youtubeWatch } from './config.js?v=20261103e';
import { bouwVanTeam, eigenBouwenVanTeam, ALLEEN_EIGEN } from './bouw-indeling.js?v=20261103e';
import { oefHtml, bronHtml, diagramVoorOefening, openLightbox } from './training-weergave.js?v=20261103e';
import { ico } from './icons.js?v=20260922c';
import { momentenVanTeam, DAGEN_LANG, DAGEN_KORT } from './trainingsmomenten.js?v=20261103e';

const T = {
  club: null, teams: [], trainingen: [], videos: [], laden: { teams: true, trainingen: true }, fout: '',
  pagina: 'week',         // 'week' | 'overzicht' | 'trainingen' | 'videos'
  bouw: 'alle',           // 'alle' | bouw-id | eigen-bouw-id
  weekOffset: 0,          // weken t.o.v. nu, voor de weekplanning
  detail: null,           // trainingId
  voorbeeld: false,       // beheerder kijkt mee
  unsub: [],
  el: null,
};

/* ---------- rol vaststellen ---------- */
export async function zoekTraincoRol(user){
  if (!user) return null;
  try {
    const snap = await getDocs(query(collection(db, 'clubs'), where(`trainingscoordinatoren.${user.uid}`, '==', true)));
    return snap.empty ? null : { id: snap.docs[0].id, ...snap.docs[0].data() };
  } catch(e){ return null; }          // geen rechten/offline = gewone coach-app
}
/* Aangeroepen vanuit teams.js zodra een ingelogde gebruiker géén teams heeft. */
export async function probeerTrainco(){
  if (T.el || !S.user) return false;
  const club = await zoekTraincoRol(S.user);
  if (!club || club.admins?.[S.user.uid]) return false;   // beheerders gebruiken ?trainco=1
  bootTrainco(club, false);
  return true;
}
/* Beheerder bekijkt het scherm zoals de coördinator het ziet (?trainco=1). */
export async function bootVoorbeeld(user){
  S.user = S.user || user;
  try {
    const snap = await getDocs(query(collection(db, 'clubs'), where(`admins.${user.uid}`, '==', true)));
    if (snap.empty) return false;
    bootTrainco({ id: snap.docs[0].id, ...snap.docs[0].data() }, true);
    return true;
  } catch(e){ return false; }
}

/* ---------- boot ---------- */
/* Trainer die óók trainingscoördinator is: opent het scherm vanuit de
   coach-app (menu-item), met een knop terug naar zijn team. */
export function openVanuitApp(){
  const club = (S.traincoClubs || [])[0];
  if (club) bootTrainco(club, false, true);
}
export function bootTrainco(club, voorbeeld, vanuitApp = false){
  if (T.el) return;
  T.club = club; T.voorbeeld = !!voorbeeld; T.vanuitApp = !!vanuitApp;
  T.laden = { teams: true, trainingen: true }; T.fout = ''; T.detail = null; T.pagina = 'week'; T.weekOffset = 0;
  T.stapel = [];
  /* Terugknop van de telefoon: één stap terug binnen dit scherm (training →
     lijst, pagina → vorige pagina). Vanuit de coach-app geopend en niets meer
     terug te gaan → terug naar het team. Zie bewaakTerug() in state.js. */
  S._traincoTerug = {
    kan: () => T.stapel.length > 0 || T.vanuitApp,
    stap: () => {
      const vorige = T.stapel.pop();
      if (vorige){ Object.assign(T, vorige); teken(); naarBoven(); return true; }
      if (T.vanuitApp){ sluitTrainco(); return true; }
      return false;
    },
  };
  // bouwVanTeam() leest de club-indeling uit S.club; de coach-app krijgt zijn
  // eigen waarden terug bij sluitTrainco().
  T.oud = { club: S.club, clubId: S.clubId };
  S.club = club; S.clubId = club.id;
  for (const id of (vanuitApp ? ['app'] : ['app', 'login', 'uitnodiging', 'opstart'])){
    const e = document.getElementById(id); if (e){ e.style.display = 'none'; if (id === 'opstart') e.remove(); }
  }
  const el = document.createElement('div');
  el.id = 'tc-app'; el.className = 'tc-app';
  document.body.appendChild(el);
  T.el = el;
  el.addEventListener('click', klik);

  const fout = naam => err => {
    console.error(`[Cluppie] trainingscoördinator: "${naam}" niet leesbaar:`, err.code, err.message);
    T.fout = err.code === 'permission-denied'
      ? 'Je hebt nog geen toegang tot deze gegevens. Vraag de beheerder om je toegang te controleren.'
      : 'Laden mislukt. Controleer je verbinding.';
    T.laden = { teams: false, trainingen: false }; teken();
  };
  T.unsub.push(onSnapshot(query(collection(db, 'teams'), where('club', '==', club.id)), snap => {
    T.teams = snap.docs.map(d => ({ id: d.id, ...d.data() })).sort((a, b) => (a.naam || '').localeCompare(b.naam || '', 'nl', { numeric: true }));
    T.laden.teams = false; teken();
  }, fout('teams')));
  T.unsub.push(onSnapshot(query(collection(db, 'trainingen'), where('club', '==', club.id)), snap => {
    T.trainingen = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    T.laden.trainingen = false; teken();
  }, fout('trainingen')));
  T.unsub.push(onSnapshot(query(collection(db, 'videos'), where('club', '==', club.id)), snap => {
    T.videos = snap.docs.map(d => ({ id: d.id, ...d.data() })).sort((a, b) => (b.gemaakt?.seconds || 0) - (a.gemaakt?.seconds || 0));
    if (T.pagina === 'videos') teken();
  }, err => console.warn('[Cluppie] trainingscoördinator: video\'s niet leesbaar:', err.code)));
  teken();
}

/* ---------- week- en datumhulp (gelijk aan teams-training.js) ---------- */
function weekNrUit(tekst){
  const m = String(tekst || '').match(/\b([1-9]|[1-4]\d|5[0-3])\b/);
  return m ? parseInt(m[1], 10) : null;
}
function jaarVoorWeek(weekNr, sec){
  const nu = sec ? new Date(sec * 1000) : new Date();
  let jaar = nu.getFullYear(); const maand = nu.getMonth();
  if (maand === 0 && weekNr >= 50) jaar -= 1;
  if (maand === 11 && weekNr <= 2) jaar += 1;
  return jaar;
}
function maandagVan(weekNr, jaar){
  const vierJan = new Date(jaar, 0, 4, 12);
  const m1 = new Date(vierJan); m1.setDate(vierJan.getDate() - ((vierJan.getDay() + 6) % 7));
  const m = new Date(m1); m.setDate(m1.getDate() + (weekNr - 1) * 7); return m;
}
function weekVan(tr){
  const ws = /^\d{4}-\d{2}-\d{2}$/.test(tr.weekStart || '') ? new Date(tr.weekStart + 'T12:00') : null;
  const nr = ws ? isoWeek(ws) : weekNrUit(tr.week);
  if (!nr) return null;
  const jaar = ws ? new Date(ws.getTime() + 3 * 86400000).getFullYear() : jaarVoorWeek(nr, tr.gemaakt?.seconds);
  return { nr, jaar, key: `${jaar}-${String(nr).padStart(2, '0')}` };
}
const lokaleDatumTekst = d => { const s = d.toLocaleDateString('nl-NL', { weekday: 'short', day: 'numeric', month: 'short' }).replace('.', ''); return s.charAt(0).toUpperCase() + s.slice(1); };
const kortDatum = d => d.toLocaleDateString('nl-NL', { day: 'numeric', month: 'short' }).replace('.', '');
const ymd = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/* ---------- planning: elke (training, team) met datum en tijd ---------- */
function planning(){
  const uit = [];
  for (const team of T.teams){
    const mo = momentenVanTeam(team);
    const perWeek = new Map();
    for (const tr of T.trainingen){
      if (!(tr.teams || []).includes(team.id)) continue;
      const w = weekVan(tr); const key = w ? w.key : 'onbekend';
      if (!perWeek.has(key)) perWeek.set(key, { w, items: [] });
      perWeek.get(key).items.push(tr);
    }
    for (const g of perWeek.values()){
      g.items.sort((a, b) => ((a.plan?.id && a.plan.id === b.plan?.id) ? (a.trainingNr || 0) - (b.trainingNr || 0) : 0)
        || (a.gemaakt?.seconds || 0) - (b.gemaakt?.seconds || 0));
      g.items.forEach((tr, i) => {
        let moment = null, datum = null;
        if (g.w){
          moment = tr.trainingsdag ? (mo.find(m => m.dag === tr.trainingsdag) || { dag: tr.trainingsdag, start: '', eind: '' }) : (mo[i] || null);
          if (moment){ datum = maandagVan(g.w.nr, g.w.jaar); datum.setDate(datum.getDate() + moment.dag - 1); }
        }
        uit.push({ tr, team, week: g.w, moment, datum });
      });
    }
  }
  return uit;
}

/* ---------- weken ---------- */
function maandagNu(offset){
  const d = new Date(); d.setHours(12, 0, 0, 0);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7) + offset * 7);
  return d;
}
const plusDagen = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };

/* ---------- groepen (bouwen) ---------- */
function teamInFilter(team){
  if (T.bouw === 'alle') return true;
  if (BOUWEN.some(b => b.id === T.bouw)) return bouwVanTeam(team) === T.bouw;
  return eigenBouwenVanTeam(team).some(b => b.id === T.bouw);
}
function bouwNaamVan(team){
  const b = bouwVanTeam(team);
  if (b === ALLEEN_EIGEN) return eigenBouwenVanTeam(team)[0]?.naam || 'Overig';
  return BOUWEN.find(x => x.id === b)?.naam || 'Overig';
}
/* Filteropties met aantallen. Basis = de teams die op deze pagina meetellen. */
function filterOpties(teams){
  const std = BOUWEN.map(b => ({ id: b.id, naam: b.naam, n: teams.filter(t => bouwVanTeam(t) === b.id).length }));
  const eigen = (Array.isArray(T.club.eigenBouwen) ? T.club.eigenBouwen : []).filter(b => b?.id)
    .map(b => ({ id: b.id, naam: b.naam || 'Bouw', n: teams.filter(t => eigenBouwenVanTeam(t).some(x => x.id === b.id)).length }));
  return [{ id: 'alle', naam: 'Alle teams', n: teams.length }, ...std, ...eigen].filter(o => o.id === 'alle' || o.n);
}
const sorteerTeams = l => [...l].sort((a, b) => (a.naam || '').localeCompare(b.naam || '', 'nl', { numeric: true }));

/* ---------- kleine onderdelen ---------- */
const spelersTekst = team => Number.isFinite(team.spelersAantal) ? `${team.spelersAantal} spelers` : 'aantal onbekend';
const tijdVan = m => m && m.start ? (m.eind ? `${m.start}–${m.eind}` : m.start) : '';
const trTitel = tr => tr.titel || tr.bestandsnaam || 'Training';

function kop(meta, titel, extra = ''){
  return `<div class="tc-kop"><div><div class="tc-meta">${meta}</div><h1 class="cond tc-h1">${esc(titel)}</h1></div>${extra}</div>`;
}
function filterBalk(teams){
  const opties = filterOpties(teams);
  if (!opties.some(o => o.id === T.bouw)) T.bouw = 'alle';
  return `<div class="tc-filters" role="tablist" aria-label="Kies een groep">${opties.map(o =>
    `<button class="tc-filter${T.bouw === o.id ? ' actief' : ''}" data-tc-bouw="${esc(o.id)}" role="tab" aria-selected="${T.bouw === o.id}">${esc(o.naam)}<span>${o.n}</span></button>`).join('')}</div>`;
}
function weekNav(){
  const ma = maandagNu(T.weekOffset), zo = plusDagen(ma, 6);
  const nr = isoWeek(plusDagen(ma, 3));
  return `<div class="tc-weeknav">
    <button class="knop licht tc-rond" data-tc-week="-1" aria-label="Vorige week">${ico('navigation-back', 20)}</button>
    <div class="tc-weektitel"><b class="cond">Week ${nr}</b><small>${esc(kortDatum(ma))} – ${esc(kortDatum(zo))}${T.weekOffset === 0 ? ' · deze week' : ''}</small></div>
    <button class="knop licht tc-rond" data-tc-week="1" aria-label="Volgende week">${ico('navigation-forward', 20)}</button>
    ${T.weekOffset !== 0 ? '<button class="knop licht klein tc-vandaag" data-tc-week="0">Deze week</button>' : ''}
  </div>`;
}
function teamRij(p){
  return `<div class="tc-teamrij">
    <b class="cond">${esc(p.team.naam)}</b>
    <span>${p.datum ? esc(lokaleDatumTekst(p.datum)) + (tijdVan(p.moment) ? ' · ' + esc(tijdVan(p.moment)) : ' · <em>tijd nog niet ingesteld</em>') : '<em>dag nog niet bekend</em>'}</span>
    <small>${ico('team-members', 15)}${esc(spelersTekst(p.team))}</small>
  </div>`;
}
function vanafLabel(tr){
  const v = tr.zichtbaarVanaf;
  return v && /^\d{4}-\d{2}-\d{2}$/.test(v) && v > ymd(new Date()) ? `<span class="tc-label wacht">Voor coaches zichtbaar vanaf ${esc(kortDatum(new Date(v + 'T12:00')))}</span>` : '';
}

/* ---------- pagina: weekplanning (per dag) ---------- */
function htmlWeek(alle){
  const ma = maandagNu(T.weekOffset), zo = plusDagen(ma, 6);
  const rijen = alle.filter(p => teamInFilter(p.team) && p.datum && ymd(p.datum) >= ymd(ma) && ymd(p.datum) <= ymd(zo));
  const dagen = [0, 1, 2, 3, 4, 5, 6].map(i => ({ d: plusDagen(ma, i), items: rijen.filter(p => ymd(p.datum) === ymd(plusDagen(ma, i))) }))
    .filter((x, i) => i < 5 || x.items.length);
  const slot = p => `<button class="tc-slot" data-tc-open="${esc(p.tr.id)}">
      <span class="tc-slot-tijd">${tijdVan(p.moment) ? esc(tijdVan(p.moment)) : '<em>tijd?</em>'}</span>
      <span class="tc-slot-tekst"><b class="cond">${esc(p.team.naam)}</b><span>${esc(trTitel(p.tr))}</span><small>${ico('team-members', 14)}${esc(spelersTekst(p.team))}</small></span>
      <span class="tc-slot-pijl">${ico('navigation-forward', 18)}</span>
    </button>`;
  return `
    ${kop(esc(T.club.naam || '') + ' · trainingscoördinator', 'Weekplanning')}
    ${filterBalk([...new Map(alle.map(p => [p.team.id, p.team])).values()])}
    ${weekNav()}
    <div class="tc-dagen">${dagen.map(x => `<section class="kaart tc-dag">
      <div class="tc-dag-kop"><b class="cond">${DAGEN_LANG[(x.d.getDay() + 6) % 7]}</b><span>${esc(kortDatum(x.d))}</span><span class="tc-dag-tel">${x.items.length || ''}</span></div>
      ${x.items.length ? x.items.sort((a, b) => (a.moment?.start || '99').localeCompare(b.moment?.start || '99') || a.team.naam.localeCompare(b.team.naam, 'nl', { numeric: true })).map(slot).join('') : '<div class="tc-leeg-klein">Geen trainingen</div>'}
    </section>`).join('')}</div>`;
}

/* ---------- pagina: overzicht (tabel team × dag) ---------- */
function htmlOverzicht(alle){
  const ma = maandagNu(T.weekOffset), zo = plusDagen(ma, 6);
  const teams = sorteerTeams(T.teams.filter(teamInFilter));
  const inWeek = alle.filter(p => p.week && ymd(maandagVan(p.week.nr, p.week.jaar)) === ymd(ma));
  // welke dagen tonen: ma–vr altijd, za/zo alleen als iemand dan traint of een training heeft
  const gebruikt = new Set([1, 2, 3, 4, 5]);
  for (const t of teams) for (const m of momentenVanTeam(t)) gebruikt.add(m.dag);
  for (const p of inWeek) if (p.datum) gebruikt.add((p.datum.getDay() + 6) % 7 + 1);
  const dagen = [...gebruikt].sort((a, b) => a - b);
  let mist = 0, gepland = 0;
  const cel = (team, dag) => {
    const datum = plusDagen(ma, dag - 1);
    const hier = inWeek.filter(p => p.team.id === team.id && p.datum && ymd(p.datum) === ymd(datum));
    const traintDan = momentenVanTeam(team).find(m => m.dag === dag);
    if (hier.length){
      gepland += hier.length;
      return `<td class="tc-cel c-ok">${hier.map(p => `<button data-tc-open="${esc(p.tr.id)}" title="${esc(trTitel(p.tr))}"><b>${esc(trTitel(p.tr))}</b>${tijdVan(p.moment) ? `<small>${esc(tijdVan(p.moment))}</small>` : ''}</button>`).join('')}</td>`;
    }
    if (traintDan){
      mist++;
      return `<td class="tc-cel c-mist"><span><b>Ontbreekt</b>${tijdVan(traintDan) ? `<small>${esc(tijdVan(traintDan))}</small>` : ''}</span></td>`;
    }
    return '<td class="tc-cel c-leeg"><span>–</span></td>';
  };
  const zonderDag = team => {
    const l = inWeek.filter(p => p.team.id === team.id && !p.datum);
    if (!l.length) return '';
    gepland += l.length;
    return l.map(p => `<button class="tc-zonderdag" data-tc-open="${esc(p.tr.id)}">${esc(trTitel(p.tr))} · geen dag</button>`).join('');
  };
  // groeperen per bouw
  const groepen = new Map();
  for (const t of teams){ const g = bouwNaamVan(t); if (!groepen.has(g)) groepen.set(g, []); groepen.get(g).push(t); }
  const rij = t => {
    const mo = momentenVanTeam(t);
    const cellen = dagen.map(d => cel(t, d)).join('');
    return `<tr>
      <th scope="row" class="tc-teamcel"><b class="cond">${esc(t.naam)}</b><small>${esc(spelersTekst(t))}${mo.length ? '' : ' · <em>geen trainingsdag</em>'}</small>${zonderDag(t)}</th>
      ${cellen}</tr>`;
  };
  const body = [...groepen.entries()].map(([g, l]) =>
    `<tr class="tc-groeprij"><th colspan="${dagen.length + 1}">${esc(g)}</th></tr>${l.map(rij).join('')}`).join('');
  const tabel = `<div class="tc-tabelwrap"><table class="tc-tabel">
      <thead><tr><th scope="col" class="tc-teamcel">Team</th>${dagen.map(d => `<th scope="col">${DAGEN_KORT[d - 1]}<small>${esc(kortDatum(plusDagen(ma, d - 1)))}</small></th>`).join('')}</tr></thead>
      <tbody>${body}</tbody></table></div>`;
  return `
    ${kop(esc(T.club.naam || '') + ' · trainingscoördinator', 'Overzicht')}
    ${filterBalk(T.teams)}
    ${weekNav()}
    ${teams.length ? `
    <div class="tc-samenvatting">
      <div class="kaart"><b class="cond">${gepland}</b><span>trainingen gekoppeld</span></div>
      <div class="kaart ${mist ? 's-mist' : ''}"><b class="cond">${mist}</b><span>trainingen ontbreken</span></div>
      <div class="kaart"><b class="cond">${teams.length}</b><span>teams</span></div>
    </div>
    <div class="tc-legenda"><span class="l-ok">Training gekoppeld</span><span class="l-mist">Team traint, maar heeft geen training</span><span class="l-leeg">Geen training op die dag</span></div>
    ${tabel}` : '<div class="kaart tc-leeg">Geen teams in deze groep.</div>'}`;
}

/* ---------- pagina: alle trainingen ---------- */
function htmlTrainingen(alle){
  const nu = maandagNu(0); const nuKey = `${nu.getFullYear()}-${String(isoWeek(plusDagen(nu, 3))).padStart(2, '0')}`;
  const metFilter = alle.filter(p => teamInFilter(p.team));
  const perTr = new Map();
  for (const p of metFilter){ if (!perTr.has(p.tr.id)) perTr.set(p.tr.id, { tr: p.tr, week: p.week, regels: [] }); perTr.get(p.tr.id).regels.push(p); }
  const perWeek = new Map();
  for (const g of perTr.values()){ const k = g.week ? g.week.key : 'onbekend'; if (!perWeek.has(k)) perWeek.set(k, { week: g.week, items: [] }); perWeek.get(k).items.push(g); }
  const keys = [...perWeek.keys()].filter(k => k !== 'onbekend');
  const volgorde = [...keys.filter(k => k >= nuKey).sort(), ...keys.filter(k => k < nuKey).sort().reverse().slice(0, 8), ...(perWeek.has('onbekend') ? ['onbekend'] : [])];
  const kaart = g => {
    g.regels.sort((a, b) => (a.datum?.getTime() || 9e15) - (b.datum?.getTime() || 9e15) || a.team.naam.localeCompare(b.team.naam, 'nl', { numeric: true }));
    const nd = Object.values(g.tr.diagramUrls || {}).filter(Boolean).length;
    const groepen = g.regels.map(r => bouwNaamVan(r.team)).filter((v, i, a) => a.indexOf(v) === i).join(' · ');
    return `<article class="kaart tc-trkaart">
      <div class="tc-meta">${esc(groepen)}</div>
      <h2 class="cond tc-h2">${esc(trTitel(g.tr))}</h2>
      <div class="tc-labels">${nd ? `<span class="tc-label">${nd} oefenvorm${nd === 1 ? '' : 'en'}</span>` : ''}${g.tr.url ? '<span class="tc-label">PDF</span>' : ''}${vanafLabel(g.tr)}</div>
      <div class="tc-teams">${g.regels.map(teamRij).join('')}</div>
      <button class="knop tc-knop-vol" data-tc-open="${esc(g.tr.id)}">Bekijk training</button>
    </article>`;
  };
  const weekKop = k => {
    const w = perWeek.get(k).week;
    if (!w) return '<div class="sectie-kop">Zonder week</div>';
    const ma = maandagVan(w.nr, w.jaar);
    return `<div class="sectie-kop">Week ${w.nr} · ${esc(kortDatum(ma))} – ${esc(kortDatum(plusDagen(ma, 6)))}${k === nuKey ? ' · deze week' : ''}</div>`;
  };
  return `
    ${kop(esc(T.club.naam || '') + ' · trainingscoördinator', 'Trainingen')}
    ${filterBalk([...new Map(alle.map(p => [p.team.id, p.team])).values()])}
    ${volgorde.length ? volgorde.map(k => `<section>${weekKop(k)}<div class="tc-raster">${perWeek.get(k).items.map(kaart).join('')}</div></section>`).join('')
      : '<div class="kaart tc-leeg">Voor deze groep staan nog geen trainingen klaar.</div>'}`;
}

/* ---------- pagina: video's ---------- */
function htmlVideos(){
  const teamNaam = new Map(T.teams.map(t => [t.id, t]));
  const lijst = T.videos.filter(v => (v.teams || []).some(id => teamNaam.has(id) && teamInFilter(teamNaam.get(id))));
  const basisTeams = T.teams.filter(t => T.videos.some(v => (v.teams || []).includes(t.id)));
  const kaart = v => {
    const yid = v.bron === 'upload' ? null : youtubeId(v.url);
    const link = yid ? youtubeWatch(yid) : v.url;
    const teams = (v.teams || []).map(id => teamNaam.get(id)).filter(t => t && teamInFilter(t));
    const datum = v.gemaakt?.seconds ? kortDatum(new Date(v.gemaakt.seconds * 1000)) : '';
    return `<a class="kaart tc-video" href="${esc(link || '#')}" target="_blank" rel="noopener">
      <span class="tc-video-beeld">${yid ? `<img src="${esc(youtubeThumb(yid))}" alt="" loading="lazy">` : ico('training-video', 34)}<i>▶</i></span>
      <span class="tc-video-tekst"><b>${esc(v.titel || 'Video')}</b>
        <small>${esc(sorteerTeams(teams).map(t => t.naam).join(', '))}${datum ? ' · ' + esc(datum) : ''}</small></span>
    </a>`;
  };
  return `
    ${kop(esc(T.club.naam || '') + ' · trainingscoördinator', 'Video’s')}
    ${filterBalk(basisTeams)}
    ${lijst.length ? `<div class="tc-videos">${lijst.map(kaart).join('')}</div>` : '<div class="kaart tc-leeg">Voor deze groep zijn nog geen video’s gedeeld.</div>'}`;
}

/* ---------- training-detail ---------- */
function oefenvormen(tr){
  const oef = Array.isArray(tr.oefeningen) ? tr.oefeningen : [];
  if (oef.length){
    return oef.map((o, i) => ({ url: diagramVoorOefening(i + 1, tr.diagramUrls || {}), titel: `Oefenvorm ${i + 1}: ${o.titel || 'Oefening ' + (i + 1)}` })).filter(x => x.url);
  }
  return Object.entries(tr.diagramUrls || {}).filter(([, u]) => u).sort((a, b) => Number(a[0]) - Number(b[0]))
    .map(([, url], i) => ({ url, titel: `Oefenvorm ${i + 1}` }));
}
function htmlDetail(alle){
  const tr = T.trainingen.find(x => x.id === T.detail);
  const terug = `<button class="knop licht klein tc-terug" data-tc-terug>${ico('navigation-back', 18)} Terug</button>`;
  if (!tr) return `${terug}<div class="kaart tc-leeg">Deze training bestaat niet meer.</div>`;
  const regels = alle.filter(p => p.tr.id === tr.id).sort((a, b) => (a.datum?.getTime() || 9e15) - (b.datum?.getTime() || 9e15) || a.team.naam.localeCompare(b.team.naam, 'nl', { numeric: true }));
  const oef = Array.isArray(tr.oefeningen) ? tr.oefeningen : [];
  const vormen = oefenvormen(tr);
  const groepen = regels.map(r => bouwNaamVan(r.team)).filter((v, i, a) => a.indexOf(v) === i).join(' · ');
  // inhoudsopgave, zoals bij de coaches
  const inhoud = [
    vormen.length ? ['tc-vormen', 'Oefenvormen'] : null,
    ...oef.map((o, i) => [`tc-oef-${i}`, `${i + 1}. ${(o.titel || 'Oefening ' + (i + 1)).slice(0, 26)}`]),
    ['tc-wanneer', 'Wie traint wanneer'],
    tr.url ? ['tc-pdf', 'PDF'] : null,
  ].filter(Boolean);
  return `
    ${terug}
    <div class="tc-kop"><div><div class="tc-meta">${esc(groepen)}${tr.week ? ' · ' + esc(tr.week) : ''}</div><h1 class="cond tc-h1">${esc(trTitel(tr))}</h1>${vanafLabel(tr)}</div></div>
    <nav class="trw-nav tc-inhoud" aria-label="Inhoudsopgave">${inhoud.map(([id, n]) => `<a class="trw-chip" href="#${id}" data-tc-naar="${id}">${esc(n)}</a>`).join('')}</nav>
    <div class="tc-detail">
      <div class="tc-detail-hoofd">
        ${vormen.length ? `<section id="tc-vormen" class="tc-anker"><div class="sectie-kop">Oefenvormen</div>
          <div class="tc-vormen">${vormen.map(v => `<button class="kaart tc-vorm" data-tc-zoom="${esc(v.url)}" data-tc-zoomtitel="${esc(v.titel)}"><img src="${esc(v.url)}" alt="" loading="lazy"><span>${esc(v.titel)}</span></button>`).join('')}</div>
        </section>` : ''}
        ${oef.length ? `<section class="tc-anker"><div class="sectie-kop">Training</div>
          <div class="trw-inline tc-oefeningen">${oef.map((o, i) => oefHtml(i + 1, o, tr.diagramUrls || {}).replace('<section class="trw-oef">', `<section class="trw-oef tc-anker" id="tc-oef-${i}">`)).join('')}${bronHtml()}</div>
        </section>` : '<div class="kaart tc-leeg">Voor deze training is alleen de PDF beschikbaar.</div>'}
      </div>
      <aside class="tc-detail-zij">
        <section id="tc-wanneer" class="kaart tc-anker"><div class="sectie-kop" style="margin-top:0">Wie traint wanneer</div>
          ${regels.map(teamRij).join('') || '<div class="tc-leeg-klein">Nog niet aan een team gekoppeld</div>'}</section>
        ${tr.url ? `<section id="tc-pdf" class="kaart tc-anker"><div class="sectie-kop" style="margin-top:0">PDF</div>
          <p class="tc-pdfnaam">${esc(tr.bestandsnaam || trTitel(tr))}</p>
          <a class="knop tc-knop-vol" href="${esc(tr.url)}" target="_blank" rel="noopener">${ico('admin-document', 18)} PDF openen</a></section>` : ''}
      </aside>
    </div>`;
}

/* ---------- schil: zijbalk (desktop) en onderbalk (mobiel) ---------- */
const MENU = [
  ['week', 'Weekplanning', 'planning-calendar'],
  ['overzicht', 'Overzicht', 'attendance-overview'],
  ['trainingen', 'Trainingen', 'football-training'],
  ['videos', 'Video’s', 'training-video'],
];
function teken(){
  if (!T.el) return;
  const klaar = !T.laden.teams && !T.laden.trainingen;
  const alle = klaar ? planning() : [];
  const naam = String(S.user?.displayName || S.user?.email || '').split('@')[0];
  let inhoud;
  if (T.fout) inhoud = `<div class="kaart tc-leeg">${esc(T.fout)}</div>`;
  else if (!klaar) inhoud = '<div class="kaart tc-leeg">Bezig met laden…</div>';
  else if (T.detail) inhoud = htmlDetail(alle);
  else inhoud = ({ week: htmlWeek, overzicht: htmlOverzicht, trainingen: htmlTrainingen, videos: () => htmlVideos() })[T.pagina](alle);
  const sy = T.el.querySelector('.tc-hoofd')?.scrollTop || 0;
  T.el.innerHTML = `
    ${T.voorbeeld ? '<div class="tc-voorbeeld">Voorbeeld: zo ziet de trainingscoördinator het. <button class="knop licht klein" data-tc-sluitvoorbeeld>Terug naar Cluppie</button></div>' : ''}
    <div class="tc-schil">
      <aside class="tc-zij">
        <div class="tc-merk"><img src="icons/asv-schild.png" alt=""><span><b class="cond">${esc(T.club.naam || 'Cluppie')}</b><small>Trainingscoördinator</small></span></div>
        <nav class="tc-nav" aria-label="Menu">
          <div class="tc-navkop">Trainingen</div>
          ${MENU.slice(0, 3).map(([id, n, ic]) => `<button class="tc-link ${!T.detail && T.pagina === id ? 'actief' : ''}" data-tc-pagina="${id}">${ico(ic, 20)}<span>${n}</span></button>`).join('')}
          <div class="tc-navkop">Media</div>
          ${MENU.slice(3).map(([id, n, ic]) => `<button class="tc-link ${!T.detail && T.pagina === id ? 'actief' : ''}" data-tc-pagina="${id}">${ico(ic, 20)}<span>${n}</span></button>`).join('')}
        </nav>
        ${T.vanuitApp ? `<button class="tc-link tc-terugapp" data-tc-naarapp>${ico('navigation-back', 20)}<span>Terug naar mijn team</span></button>` : ''}
        <div class="tc-ik"><span class="tc-avatar">${esc((naam || '?').charAt(0).toUpperCase())}</span><span><b>${esc(naam)}</b><small>Alleen lezen</small></span>
          <button class="tc-uit" data-tc-uitloggen title="Uitloggen" aria-label="Uitloggen">${ico('team-leave', 20)}</button></div>
      </aside>
      <main class="tc-hoofd">
        <header class="tc-balk">${T.vanuitApp ? `<button class="tc-uit" data-tc-naarapp title="Terug naar mijn team" aria-label="Terug naar mijn team">${ico('navigation-back', 22)}</button>` : ''}<img src="icons/asv-schild.png" alt=""><span><b class="cond">${esc(T.club.naam || 'Cluppie')}</b><small>Trainingscoördinator</small></span>
          <button class="tc-uit" data-tc-uitloggen title="Uitloggen" aria-label="Uitloggen">${ico('team-leave', 20)}</button></header>
        <div class="tc-inhoud-wrap">${inhoud}</div>
      </main>
    </div>
    <nav class="tc-onder" aria-label="Menu">${MENU.map(([id, n, ic]) => `<button class="${!T.detail && T.pagina === id ? 'actief' : ''}" data-tc-pagina="${id}">${ico(ic, 22)}<span>${n}</span></button>`).join('')}</nav>`;
  const h = T.el.querySelector('.tc-hoofd'); if (h) h.scrollTop = sy;
  bewaakTerug();
}

function bewaar(){ T.stapel.push({ pagina: T.pagina, detail: T.detail }); if (T.stapel.length > 30) T.stapel.shift(); }
function naarBoven(){ const h = T.el?.querySelector('.tc-hoofd'); if (h) h.scrollTop = 0; }
function klik(e){
  const fig = e.target.closest('.trw-diagram[data-zoom]');
  if (fig && T.el.contains(fig)){ openLightbox(fig.dataset.zoom, fig.dataset.zoomtitel); return; }
  const b = e.target.closest('button,a'); if (!b || !T.el.contains(b)) return;
  const d = b.dataset;
  if (d.tcBouw){ T.bouw = d.tcBouw; teken(); }
  else if (d.tcPagina){ if (d.tcPagina === T.pagina && !T.detail) return; bewaar(); T.pagina = d.tcPagina; T.detail = null; teken(); naarBoven(); }
  else if (d.tcWeek !== undefined){ T.weekOffset = d.tcWeek === '0' ? 0 : T.weekOffset + Number(d.tcWeek); teken(); }
  else if (d.tcOpen){ bewaar(); T.detail = d.tcOpen; teken(); naarBoven(); }
  else if (d.tcNaar){ e.preventDefault(); T.el.querySelector('#' + d.tcNaar)?.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
  else if (d.tcZoom){ openLightbox(d.tcZoom, d.tcZoomtitel); }
  // Zelfde weg als de terugknop van de telefoon (vangnet in state.js), zodat
  // beide altijd precies één stap teruggaan.
  else if (b.hasAttribute('data-tc-terug')){ history.back(); }
  else if (b.hasAttribute('data-tc-naarapp')){ sluitTrainco(); }
  else if (b.hasAttribute('data-tc-uitloggen')){
    T.unsub.forEach(u => { try { u(); } catch(err){} }); T.unsub = [];
    signOut(auth).catch(() => {}).finally(() => location.reload());
  }
  else if (b.hasAttribute('data-tc-sluitvoorbeeld')){ location.href = location.pathname; }
}

/* Terug naar de coach-app: listeners stoppen, scherm weg, S herstellen. */
export function sluitTrainco(){
  if (!T.el) return;
  T.unsub.forEach(u => { try { u(); } catch(err){} }); T.unsub = [];
  T.el.remove(); T.el = null;
  if (T.oud){ S.club = T.oud.club; S.clubId = T.oud.clubId; T.oud = null; }
  S._traincoTerug = null; T.stapel = [];
  const app = document.getElementById('app'); if (app) app.style.display = '';
  bewaakTerug();
}
