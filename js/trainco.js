/* ==================== TRAININGSCOÖRDINATOR ====================
   Eigen, alleen-lezen startscherm voor de trainingscoördinator: wie traint
   wanneer, welke trainingen klaarstaan (per groep), en per training de
   AI-aangepaste versie, de PDF en de diagrammen.

   Bewust een los scherm naast de coach-app (eigen container #tc-app): het
   raakt de teamnavigatie en state.js niet. Hij ziet GEEN spelersnamen en GEEN
   video's — die gegevens worden hier niet eens opgehaald. Het aantal spelers
   komt uit het getal `spelersAantal` op het teamdocument (zie teams.js).

   Datamodel (Firestore: clubs/{clubId}):
     trainingscoordinatoren:     { uid: true, … }   ← rechtenbron (door de beheerder gezet)
     trainingscoordinatorenInfo: { uid: {naam} }    ← alleen voor weergave

   Rechten staan in firestore.rules (zie TRAININGSCOORDINATOR-RULES.md); dit
   bestand levert alleen de weergave. */
import { auth, db, signOut, collection, query, where, onSnapshot, getDocs } from './firebase.js?v=20260922c';
import { S, esc } from './state.js?v=20261023a';
import { BOUWEN, isoWeek } from './config.js?v=20261023a';
import { bouwVanTeam, eigenBouwenVanTeam, ALLEEN_EIGEN } from './bouw-indeling.js?v=20261023a';
import { oefHtml } from './training-weergave.js?v=20261023a';
import { momentenVanTeam, DAGEN_LANG, DAGEN_KORT } from './trainingsmomenten.js?v=20261102a';

const T = {
  club: null, teams: [], trainingen: [], laden: { teams: true, trainingen: true }, fout: '',
  tab: 'training',        // 'training' | 'dag'
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
export function bootTrainco(club, voorbeeld){
  if (T.el) return;
  T.club = club; T.voorbeeld = !!voorbeeld;
  S.club = club; S.clubId = club.id;                // bouwVanTeam() leest de club-indeling hieruit
  for (const id of ['app', 'login', 'uitnodiging', 'opstart']){
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

/* Alle teams waar trainingen voor zijn geüpload, en het filter per groep. */
function teamInFilter(team){
  if (T.bouw === 'alle') return true;
  if (BOUWEN.some(b => b.id === T.bouw)) return bouwVanTeam(team) === T.bouw;
  return eigenBouwenVanTeam(team).some(b => b.id === T.bouw);
}
function filterOpties(metTrainingen){
  const heeft = new Set(metTrainingen.map(p => p.team.id));
  const teams = T.teams.filter(t => heeft.has(t.id));
  const std = BOUWEN.map(b => ({ id: b.id, naam: b.naam, n: teams.filter(t => bouwVanTeam(t) === b.id).length }));
  const eigen = (Array.isArray(T.club.eigenBouwen) ? T.club.eigenBouwen : []).filter(b => b?.id)
    .map(b => ({ id: b.id, naam: b.naam || 'Bouw', n: teams.filter(t => (b.teams || []).includes(t.id)).length }));
  return [{ id: 'alle', naam: 'Alle teams', n: teams.length }, ...std, ...eigen].filter(o => o.id === 'alle' || o.n);
}

/* ---------- onderdelen ---------- */
const ico = (naam) => ({
  mensen: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 4-6 8-6s8 2 8 6"/></svg>',
  terug: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M15 5l-7 7 7 7"/></svg>',
  vooruit: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M9 5l7 7-7 7"/></svg>',
}[naam] || '');

const spelersTekst = team => Number.isFinite(team.spelersAantal) ? `${team.spelersAantal} spelers` : 'aantal onbekend';
const tijdTekst = m => m ? (m.start && m.eind ? `${m.start}–${m.eind}` : (m.start || 'tijd nog niet ingesteld')) : '';
const momentTekst = p => p.datum ? `${lokaleDatumTekst(p.datum)}${p.moment && p.moment.start ? ' · ' + tijdTekst(p.moment) : ' · tijd nog niet ingesteld'}` : 'dag nog niet bekend';

function vanafBadge(tr){
  const v = tr.zichtbaarVanaf;
  return v && /^\d{4}-\d{2}-\d{2}$/.test(v) && v > ymd(new Date()) ? `<span class="tc-badge wacht">Zichtbaar voor coaches vanaf ${esc(kortDatum(new Date(v + 'T12:00')))}</span>` : '';
}
function chips(tr){
  const ai = Array.isArray(tr.oefeningen) && tr.oefeningen.length;
  const nd = Object.values(tr.diagramUrls || {}).filter(Boolean).length;
  return `<div class="tc-chips">${ai ? '<span class="tc-chip">AI-aangepast</span>' : ''}${tr.url ? '<span class="tc-chip">PDF</span>' : ''}${nd ? `<span class="tc-chip">${nd} diagram${nd === 1 ? '' : 'men'}</span>` : ''}</div>`;
}
function teamRij(p){
  return `<div class="tc-teamrij">
    <div class="tc-teamnaam">${esc(p.team.naam)}</div>
    <div class="tc-teammoment">${esc(momentTekst(p))}</div>
    <div class="tc-teamtal">${ico('mensen')}<span>${esc(spelersTekst(p.team))}</span></div>
  </div>`;
}

/* ---------- schermen ---------- */
function htmlOverzicht(alle){
  const nu = new Date(); const nuWeek = `${nu.getFullYear()}-${String(isoWeek(nu)).padStart(2, '0')}`;
  const metFilter = alle.filter(p => teamInFilter(p.team));
  // per training: de teams (alleen uit het gekozen filter), per week gegroepeerd
  const perTr = new Map();
  for (const p of metFilter){ if (!perTr.has(p.tr.id)) perTr.set(p.tr.id, { tr: p.tr, week: p.week, regels: [] }); perTr.get(p.tr.id).regels.push(p); }
  const perWeek = new Map();
  for (const g of perTr.values()){ const k = g.week ? g.week.key : 'onbekend'; if (!perWeek.has(k)) perWeek.set(k, { week: g.week, items: [] }); perWeek.get(k).items.push(g); }
  const keys = [...perWeek.keys()].filter(k => k !== 'onbekend');
  const komend = keys.filter(k => k >= nuWeek).sort(), eerder = keys.filter(k => k < nuWeek).sort().reverse().slice(0, 8);
  const volgorde = [...komend, ...eerder, ...(perWeek.has('onbekend') ? ['onbekend'] : [])];
  const aantalTeams = new Set(metFilter.map(p => p.team.id)).size;
  const aantalSpelers = [...new Map(metFilter.map(p => [p.team.id, p.team.spelersAantal])).values()].reduce((s, n) => s + (Number.isFinite(n) ? n : 0), 0);

  const kaart = g => {
    g.regels.sort((a, b) => (a.datum?.getTime() || 9e15) - (b.datum?.getTime() || 9e15) || (a.moment?.start || '').localeCompare(b.moment?.start || '') || a.team.naam.localeCompare(b.team.naam, 'nl', { numeric: true }));
    const gb = g.regels.map(r => bouwNaamVan(r.team)).filter((v, i, a) => v && a.indexOf(v) === i).join(' · ');
    return `<article class="tc-kaart">
      <div class="tc-kaartkop">
        <div><div class="tc-meta">${esc(gb)}${g.tr.week ? ' · ' + esc(g.tr.week) : ''}</div>
          <h2 class="tc-titel">${esc(g.tr.titel || g.tr.bestandsnaam || 'Training')}</h2></div>
        <span class="tc-badge klaar">Klaar</span>
      </div>
      ${vanafBadge(g.tr)}${chips(g.tr)}
      <div class="tc-teams">${g.regels.map(teamRij).join('')}</div>
      <button class="tc-knop" data-tc-open="${esc(g.tr.id)}">Bekijk training</button>
    </article>`;
  };
  const weekKop = k => {
    const w = perWeek.get(k).week;
    if (!w) return '<h3 class="tc-weekkop">Zonder week</h3>';
    const ma = maandagVan(w.nr, w.jaar), zo = new Date(ma); zo.setDate(ma.getDate() + 6);
    return `<h3 class="tc-weekkop">Week ${w.nr}<span>${esc(kortDatum(ma))} – ${esc(kortDatum(zo))}${w.key === nuWeek ? ' · deze week' : ''}</span></h3>`;
  };
  return `
    <div class="tc-samenv">
      <div><b>${perTr.size}</b><span>trainingen klaar</span></div>
      <div><b>${aantalTeams}</b><span>teams</span></div>
      <div><b>${aantalSpelers}</b><span>spelers</span></div>
    </div>
    ${volgorde.length ? volgorde.map(k => `<section>${weekKop(k)}<div class="tc-raster">${perWeek.get(k).items.map(kaart).join('')}</div></section>`).join('')
      : '<div class="tc-leeg">Voor deze groep staan nog geen trainingen klaar.</div>'}`;
}

function bouwNaamVan(team){
  const b = bouwVanTeam(team);
  if (b === ALLEEN_EIGEN) return eigenBouwenVanTeam(team)[0]?.naam || '';
  return BOUWEN.find(x => x.id === b)?.naam || '';
}

function htmlWeek(alle){
  const nu = new Date(); const ma = maandagVan(isoWeek(nu), nu.getFullYear()); ma.setDate(ma.getDate() + T.weekOffset * 7);
  const zo = new Date(ma); zo.setDate(ma.getDate() + 6);
  const nr = isoWeek(new Date(ma.getTime() + 3 * 86400000));
  const rijen = alle.filter(p => teamInFilter(p.team) && p.datum && ymd(p.datum) >= ymd(ma) && ymd(p.datum) <= ymd(zo));
  const dagen = [0, 1, 2, 3, 4, 5, 6].map(i => { const d = new Date(ma); d.setDate(ma.getDate() + i); return { d, items: rijen.filter(p => ymd(p.datum) === ymd(d)) }; })
    .filter((x, i) => i < 5 || x.items.length);
  const slot = p => `<button class="tc-slot" data-tc-open="${esc(p.tr.id)}">
      <span class="tc-slottijd">${esc(p.moment && p.moment.start ? tijdTekst(p.moment) : 'tijd nog niet ingesteld')}</span>
      <span class="tc-slotteam">${esc(p.team.naam)}</span>
      <span class="tc-slottr">${esc(p.tr.titel || p.tr.bestandsnaam || 'Training')}</span>
      <span class="tc-slottal">${ico('mensen')}<span>${esc(spelersTekst(p.team))}</span></span>
    </button>`;
  return `
    <div class="tc-weeknav">
      <button class="tc-ronde" data-tc-week="-1" aria-label="Vorige week">${ico('terug')}</button>
      <div class="tc-weektitel">Week ${nr} · ${esc(kortDatum(ma))} – ${esc(kortDatum(zo))}${T.weekOffset === 0 ? '<small>deze week</small>' : ''}</div>
      <button class="tc-ronde" data-tc-week="1" aria-label="Volgende week">${ico('vooruit')}</button>
    </div>
    <div class="tc-dagen">${dagen.map(x => `<section class="tc-dag">
      <div class="tc-dagkop"><b>${DAGEN_LANG[(x.d.getDay() + 6) % 7]}</b><span>${esc(kortDatum(x.d))}</span></div>
      ${x.items.length ? x.items.sort((a, b) => (a.moment?.start || '99').localeCompare(b.moment?.start || '99') || a.team.naam.localeCompare(b.team.naam, 'nl', { numeric: true })).map(slot).join('') : '<div class="tc-dagleeg">Geen trainingen</div>'}
    </section>`).join('')}</div>
    ${alle.filter(p => teamInFilter(p.team) && !p.datum).length ? `<p class="tc-voet">Sommige trainingen hebben nog geen dag, omdat het team geen trainingsmoment heeft of de week onbekend is.</p>` : ''}`;
}

function htmlDetail(alle){
  const tr = T.trainingen.find(x => x.id === T.detail);
  if (!tr) return `<button class="tc-terug" data-tc-terug>${ico('terug')} Terug</button><div class="tc-leeg">Deze training bestaat niet meer.</div>`;
  const regels = alle.filter(p => p.tr.id === tr.id).sort((a, b) => (a.datum?.getTime() || 9e15) - (b.datum?.getTime() || 9e15) || a.team.naam.localeCompare(b.team.naam, 'nl', { numeric: true }));
  const oef = Array.isArray(tr.oefeningen) ? tr.oefeningen : [];
  const diagrammen = Object.entries(tr.diagramUrls || {}).filter(([, u]) => u).sort((a, b) => Number(a[0]) - Number(b[0]));
  const gb = regels.map(r => bouwNaamVan(r.team)).filter((v, i, a) => v && a.indexOf(v) === i).join(' · ');
  return `
    <button class="tc-terug" data-tc-terug>${ico('terug')} Terug naar overzicht</button>
    <div class="tc-detailkop">
      <div class="tc-meta">${esc(gb)}${tr.week ? ' · ' + esc(tr.week) : ''}</div>
      <h1 class="tc-grootTitel">${esc(tr.titel || tr.bestandsnaam || 'Training')}</h1>
      ${vanafBadge(tr)}
    </div>
    <div class="tc-detailraster">
      <div class="tc-detailhoofd">
        <section id="tc-ai"><h2 class="tc-sectiekop">AI-aangepaste training</h2>
          ${oef.length ? `<div class="tc-ai">${oef.map((o, i) => oefHtml(i + 1, o, tr.diagramUrls)).join('')}</div>`
            : '<div class="tc-leeg">Voor deze training is geen AI-aangepaste versie gemaakt. Er is alleen de PDF.</div>'}
        </section>
        <section id="tc-diagrammen"><h2 class="tc-sectiekop">Diagrammen</h2>
          ${diagrammen.length ? `<div class="tc-diagrammen">${diagrammen.map(([k, u], i) => `<a class="tc-diagram" href="${esc(u)}" target="_blank" rel="noopener"><img src="${esc(u)}" alt="Diagram ${i + 1}" loading="lazy"><span>Diagram ${i + 1}</span></a>`).join('')}</div>`
            : '<div class="tc-leeg">Bij deze training zijn geen diagrammen opgeslagen.</div>'}
        </section>
      </div>
      <aside class="tc-detailzij">
        <div class="tc-blok"><div class="tc-blokkop">Wie traint wanneer</div>${regels.map(teamRij).join('') || '<div class="tc-dagleeg">Nog niet aan een team gekoppeld</div>'}</div>
        <div class="tc-blok" id="tc-pdf"><div class="tc-blokkop">PDF</div>
          ${tr.url ? `<div class="tc-pdf"><div class="tc-pdfico">PDF</div><div><div class="tc-pdfnaam">${esc(tr.bestandsnaam || tr.titel || 'Training')}</div></div></div>
            <a class="tc-knop" href="${esc(tr.url)}" target="_blank" rel="noopener">PDF openen</a>` : '<div class="tc-dagleeg">Geen PDF beschikbaar</div>'}
        </div>
      </aside>
    </div>`;
}

/* ---------- tekenen ---------- */
function teken(){
  if (!T.el) return;
  const klaar = !T.laden.teams && !T.laden.trainingen;
  const alle = klaar ? planning() : [];
  const opties = klaar ? filterOpties(alle) : [];
  if (klaar && !opties.some(o => o.id === T.bouw)) T.bouw = 'alle';
  const naam = (S.user?.displayName || S.user?.email || '').split('@')[0];
  const kop = T.tab === 'dag' ? 'Weekplanning' : 'Trainingen';
  let inhoud;
  if (T.fout) inhoud = `<div class="tc-leeg">${esc(T.fout)}</div>`;
  else if (!klaar) inhoud = '<div class="tc-leeg">Bezig met laden…</div>';
  else if (T.detail) inhoud = htmlDetail(alle);
  else inhoud = `
    <div class="tc-kopblok"><div class="tc-meta">${esc(T.club.naam || '')} · alleen lezen</div><h1 class="tc-grootTitel">${kop}</h1></div>
    <div class="tc-filters" role="tablist">${opties.map(o => `<button class="tc-filter${T.bouw === o.id ? ' aan' : ''}" data-tc-bouw="${esc(o.id)}">${esc(o.naam)} <em>${o.n}</em></button>`).join('')}</div>
    <div class="tc-segment"><button class="${T.tab === 'training' ? 'aan' : ''}" data-tc-tab="training">Per training</button><button class="${T.tab === 'dag' ? 'aan' : ''}" data-tc-tab="dag">Per dag</button></div>
    ${T.tab === 'dag' ? htmlWeek(alle) : htmlOverzicht(alle)}`;
  const y = window.scrollY;
  T.el.innerHTML = `
    ${T.voorbeeld ? '<div class="tc-voorbeeld">Voorbeeld: zo ziet de trainingscoördinator het. <button data-tc-sluitvoorbeeld>Terug naar Cluppie</button></div>' : ''}
    <div class="tc-schil">
      <aside class="tc-zij">
        <div class="tc-merk"><i></i><b>CLUPPIE</b></div>
        <nav>
          <button class="${!T.detail && T.tab === 'training' ? 'aan' : ''}" data-tc-nav="training">Trainingen</button>
          <button class="${!T.detail && T.tab === 'dag' ? 'aan' : ''}" data-tc-nav="dag">Weekplanning</button>
        </nav>
        <div class="tc-gebruiker"><b>Trainingscoördinator</b><small>${esc(naam || '')}</small><button data-tc-uitloggen>Uitloggen</button></div>
      </aside>
      <main class="tc-hoofd">
        <header class="tc-balk"><div class="tc-merk"><i></i><b>CLUPPIE</b></div><button class="tc-uit" data-tc-uitloggen>Uitloggen</button></header>
        <div class="tc-inhoud">${inhoud}</div>
      </main>
    </div>`;
  window.scrollTo(0, y);
}

function klik(e){
  const b = e.target.closest('button,a'); if (!b || !T.el.contains(b)) return;
  const d = b.dataset;
  if (d.tcBouw){ T.bouw = d.tcBouw; teken(); }
  else if (d.tcTab){ T.tab = d.tcTab; T.weekOffset = 0; teken(); }
  else if (d.tcNav){ T.tab = d.tcNav; T.detail = null; T.weekOffset = 0; teken(); window.scrollTo(0, 0); }
  else if (d.tcWeek){ T.weekOffset += Number(d.tcWeek); teken(); }
  else if (d.tcOpen){ T.detail = d.tcOpen; teken(); window.scrollTo(0, 0); }
  else if (b.hasAttribute('data-tc-terug')){ T.detail = null; teken(); }
  else if (b.hasAttribute('data-tc-uitloggen')){
    T.unsub.forEach(u => { try { u(); } catch(err){} }); T.unsub = [];
    signOut(auth).catch(() => {}).finally(() => location.reload());
  }
  else if (b.hasAttribute('data-tc-sluitvoorbeeld')){ location.href = location.pathname; }
}
