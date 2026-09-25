/* ==================== MOBIELE BOUW-OMGEVING ====================
   [20260923f] De bouw-omgeving op de telefoon, in lijn met de desktop:
   tabbalk onderin (Dashboard · Teams · Uitleningen) en per team een
   schuifbalk (Selectie · Evaluatie spelers · Evaluatie wedstrijden · Stats).
   Instap: "Bouwen die je coördineert" → bouw-hub.openBouwHub, die op een
   smal scherm hierheen doorstuurt. Gegevens: dezelfde als de desktop
   (desktop-bouw.laadBouw → bouw-hub.laadBouwData). Eigen teams openen de
   gewone (bewerkbare) teamschermen; andere teams alleen lezen.
   Tekent in een eigen view (#view-mbouw) binnen #app.
================================================================= */
import { S, $, esc, meld, toon } from './state.js?v=20260922c';
import { BOUWEN } from './config.js?v=20260922c';
import { laadBouw, teamRijen, richting } from './desktop-bouw.js?v=20260925b';
import { zetBouwContext, modalNieuweUitleningVanuitBouw } from './bouw-hub.js?v=20260925b';
import { trekUitleningIn } from './teams-spelers.js?v=20260925b';
import { htmlMobielTeam } from './desktop-schermen.js?v=20260925b';

let st = null;   // { clubId, bouw, tab:'dash'|'teams'|'uit', teamId, pag:'sel'|'evs'|'evw'|'stat', keuze:{} }
let cache = null;

const ICO = {
  dash:'<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
  teams:'<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c.8-3.6 3.4-5.5 6.5-5.5s5.7 1.9 6.5 5.5"/><path d="M16 4.5a3.5 3.5 0 0 1 0 7M18 14.8c1.8.7 3 2.4 3.5 5.2"/>',
  uit:'<path d="M7 7h13l-3-3M17 17H4l3 3"/>',
};
const svg = n => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICO[n]}</svg>`;

function bouwen(){
  const lijst = [];
  for (const c of S.clubs || []){
    for (const b of BOUWEN) lijst.push({ clubId:c.id, bouw:b.id, naam:b.naam, club:c.naam });
    for (const e of (Array.isArray(c.eigenBouwen) ? c.eigenBouwen : [])) if (e?.id) lijst.push({ clubId:c.id, bouw:e.id, naam:e.naam, club:c.naam, kleur:e.kleur });
  }
  for (const b of S.coordinatorBouwen || [])
    if (!lijst.some(x => x.clubId === b.clubId && x.bouw === b.bouw)) lijst.push({ clubId:b.clubId, bouw:b.bouw, naam:b.bouwNaam, club:b.clubNaam });
  return lijst;
}
const huidigeBouw = () => bouwen().find(b => b.clubId === st.clubId && b.bouw === st.bouw) || { naam: st.bouw, club:'' };
const vandaag = () => new Date().toISOString().slice(0, 10);
const datumKort = iso => { try { return new Date(iso + 'T12:00').toLocaleDateString('nl-NL', { weekday:'short', day:'numeric', month:'short' }); } catch(e){ return iso || ''; } };

function view(){
  let v = $('#view-mbouw');
  if (!v){
    v = document.createElement('div');
    v.id = 'view-mbouw'; v.className = 'view';
    $('#app').appendChild(v);
    v.addEventListener('click', klik);
    v.addEventListener('change', e => { if (e.target.id === 'mbKiezer'){ const [c, b] = e.target.value.split('|'); openMobielBouw(c, b); } });
  }
  return v;
}

export async function openMobielBouw(clubId, bouw){
  st = { clubId, bouw, tab:'dash', teamId:null, pag:'sel', keuze:{} };
  const v = view(); toon('mbouw');
  v.innerHTML = `<div class="mb-scherm">${kop()}<p class="mb-leeg" style="padding:40px 4px">Gegevens van alle teams ophalen\u2026</p></div>`;
  try { cache = await laadBouw(clubId, bouw); }
  catch(e){ v.innerHTML = `<div class="mb-scherm">${kop()}<p class="mb-leeg" style="padding:40px 4px">Ophalen mislukt: ${esc(e.code || e.message)}</p></div>`; return; }
  if (st.clubId !== clubId || st.bouw !== bouw) return;
  teken();
}

function kop(){
  const b = huidigeBouw();
  const titel = st.teamId ? (cache?.teams.find(t => t.id === st.teamId)?.naam || 'Team') : { dash:b.naam, teams:'Teams', uit:'Uitleningen' }[st.tab];
  const sub = st.teamId ? b.naam : `${b.club || ''}${cache ? ' \u00b7 ' + cache.teams.length + ' teams' : ''}`;
  const keuzes = bouwen();
  return `<div class="mb-kop"><button class="mb-terug" data-mb="terug" aria-label="Terug">\u2039</button>
    <div class="mb-titel"><b>${esc(titel)}</b><small>${esc(sub)}</small></div>
    ${!st.teamId && keuzes.length > 1 ? `<select class="mb-kiezer" id="mbKiezer" aria-label="Kies een bouw">${keuzes.map(k => `<option value="${esc(k.clubId + '|' + k.bouw)}" ${k.clubId === st.clubId && k.bouw === st.bouw ? 'selected' : ''}>${esc(k.naam)}${S.clubs.length > 1 ? ' \u00b7 ' + esc(k.club || '') : ''}</option>`).join('')}</select>` : ''}</div>`;
}
function tabs(){
  return `<nav class="mb-tabs">${[['dash', 'Dashboard'], ['teams', 'Teams'], ['uit', 'Uitleningen']].map(([k, l]) => `<button class="${!st.teamId && st.tab === k ? 'aan' : ''} ${st.teamId && k === 'teams' ? 'aan' : ''}" data-mb="tab" data-id="${k}">${svg(k)}${l}</button>`).join('')}</nav>`;
}

function teken(){
  if (!st || !cache) return;
  zetBouwContext(cache);
  const v = view();
  let binnen = '';
  try {
    if (st.teamId){
      const t = cache.teams.find(x => x.id === st.teamId);
      const eigen = (S.teams || []).some(x => x.id === st.teamId);
      binnen = `<div class="mb-segtab">${[['sel', 'Selectie'], ['evs', 'Evaluatie spelers'], ['evw', 'Evaluatie wedstr.'], ['stat', 'Stats']].map(([k, l]) => `<button class="${st.pag === k ? 'aan' : ''}" data-mb="pag" data-id="${k}">${l}</button>`).join('')}</div>
        <div class="mb-inhoud">${eigen ? `<button class="mb-lees mb-eigen" data-mb="eigen">Dit is jouw team \u2014 tik om het te openen en te bewerken \u203a</button>` : '<div class="mb-lees">Meekijken als coördinator \u00b7 alleen lezen. Aanpassen doet de coach van het team.</div>'}
          ${t ? htmlMobielTeam(st.pag, t, cache.data.get(t.id) || {}, st.keuze) : '<p class="mb-leeg">Team niet gevonden.</p>'}</div>`;
    } else if (st.tab === 'dash') binnen = `<div class="mb-inhoud">${dashboard()}</div>`;
    else if (st.tab === 'teams') binnen = `<div class="mb-inhoud">${teamsLijst()}</div>`;
    else binnen = `<div class="mb-inhoud">${uitleningen()}</div>`;
  } catch(e){ console.warn('[Cluppie] mobiele bouw', e); binnen = '<p class="mb-leeg">Dit scherm kon niet getekend worden.</p>'; }
  v.innerHTML = `<div class="mb-scherm">${kop()}${binnen}${tabs()}</div>`;
}

function dashboard(){
  const rij = teamRijen(cache);
  const spelers = rij.reduce((a, r) => a + (r.d.spelers || []).length, 0);
  const tr = rij.filter(r => r.tr != null); const trPct = tr.length ? Math.round(tr.reduce((a, r) => a + r.tr, 0) / tr.length) : null;
  const eigen = new Set((S.teams || []).map(t => t.id));
  return `<h1 class="mb-groot">${esc(huidigeBouw().naam)} <span>dashboard</span></h1>
    <div class="mb-pills"><span class="mb-pill">${rij.length} teams \u00b7 ${spelers} spelers</span>${trPct != null ? `<span class="mb-pill groen">Opkomst training ${trPct}%</span>` : ''}</div>
    <div class="mb-kaart"><div class="mb-lbl">Laatste uitslagen</div>${rij.map(r => { const l = r.u?.laatste; const k = l ? (l.voor > l.tegen ? 'groen' : l.voor < l.tegen ? 'rood' : '') : '';
      return `<div class="mb-r"><b>${esc(r.t.naam)}</b><span>${l ? 'tegen ' + esc(l.tegenstander || '') + (l.bron === 'app' ? ' \u00b7 app' : '') : (r.u?.knvbVerborgen ? 'geen KNVB-uitslagen (O10 en jonger)' : 'nog geen uitslag')}</span>${l ? `<em class="mb-pill ${k}">${l.voor}\u2013${l.tegen}</em>` : ''}</div>`; }).join('') || '<p class="mb-leeg">Geen teams.</p>'}</div>
    <div class="mb-kaart"><div class="mb-lbl">Komende wedstrijden</div>${rij.map(r => `<div class="mb-r"><b>${esc(r.t.naam)}</b><span>${r.kom ? esc(datumKort(r.kom.datum)) + (r.kom.aftrap ? ' \u00b7 ' + esc(r.kom.aftrap) : '') + ' \u00b7 ' + (r.kom.thuis ? 'thuis' : 'uit') + ' ' + esc(r.kom.tegenstander || '') : 'niets gepland'}</span></div>`).join('')}</div>
    <div class="mb-lbl mb-lbl-los">Teams<span>veeg opzij \u2192</span></div>
    <div class="mb-swipe">${rij.map(r => `<button class="mb-tt ${eigen.has(r.t.id) ? 'eigen' : ''}" data-mb="team" data-id="${esc(r.t.id)}">
        <span class="mb-ttkop"><span><b>${esc(r.t.naam)}</b><small>${eigen.has(r.t.id) ? 'jouw team' : esc(Object.values(r.t.ledenInfo || {}).map(x => x?.naam).filter(Boolean)[0] || '')}</small></span>
          <span class="mb-vorm">${(r.u?.vorm || []).map(x => `<i class="${x}">${x.toUpperCase()}</i>`).join('')}</span></span>
        <span class="mb-cijfers"><span><b>${(r.d.spelers || []).length}</b><small>SPELERS</small></span><span><b class="g">${r.tr != null ? r.tr + '%' : '\u2013'}</b><small>TRAINING</small></span>
          <span><b class="bl">${r.wd != null ? r.wd + '%' : '\u2013'}</b><small>WEDSTR.</small></span><span><b>${r.kaart ?? '\u2013'}</b><small>GEM. KAART</small></span></span>
        <span class="mb-pills">${r.open ? `<em class="mb-pill geel">${r.open} evaluatie${r.open === 1 ? '' : 's'} open</em>` : '<em class="mb-pill groen">evaluaties bij</em>'}</span></button>`).join('')}</div>
    <div class="mb-kaart"><div class="mb-lbl">Opkomst per team<span>seizoen</span></div>${rij.map(r => `<div class="mb-opk"><b>${esc(r.t.naam)}</b><i><em class="g" style="width:${r.tr ?? 0}%"></em></i><i><em class="bl" style="width:${r.wd ?? 0}%"></em></i></div>`).join('')}
      <div class="mb-leg"><span><i class="g"></i>training</span><span><i class="bl"></i>wedstrijd</span></div></div>
    <div class="mb-kaart"><div class="mb-lbl">Uitleningen<span>${cache.uitleningen.length}</span></div>
      ${cache.uitleningen.slice(0, 5).map(u => `<div class="mb-r"><b>${esc(u.snapshot?.naam || 'Speler')}</b><span>${esc(u.vanTeamNaam || '?')} \u2192 ${esc(u.naarTeamNaam || '?')}</span></div>`).join('') || '<p class="mb-leeg">Geen actieve uitleningen.</p>'}
      <button class="mb-knop" data-mb="tab" data-id="uit">Alle uitleningen \u203a</button></div>`;
}

function teamsLijst(){
  const rij = teamRijen(cache);
  const eigen = new Set((S.teams || []).map(t => t.id));
  return rij.map(r => `<button class="mb-kaart mb-teamrij ${eigen.has(r.t.id) ? 'eigen' : ''}" data-mb="team" data-id="${esc(r.t.id)}">
      <span class="mb-tr-t"><b>${esc(r.t.naam)}${eigen.has(r.t.id) ? ' \u2605' : ''}</b><small>${eigen.has(r.t.id) ? 'jouw team \u00b7 bewerken' : esc((Object.values(r.t.ledenInfo || {}).map(x => x?.naam).filter(Boolean)[0] || 'coach') + ' \u00b7 meekijken')}</small>
        <span class="mb-pills"><em class="mb-pill">${(r.d.spelers || []).length} spelers</em>${r.tr != null ? `<em class="mb-pill groen">${r.tr}%</em>` : ''}</span></span>
      <span class="mb-vorm">${(r.u?.vorm || []).slice(-3).map(x => `<i class="${x}">${x.toUpperCase()}</i>`).join('')}</span><span class="mb-pijl">\u203a</span></button>`).join('') || '<p class="mb-leeg">Geen teams in deze bouw.</p>';
}

function uitleningen(){
  return `${cache.uitleningen.map(u => `<div class="mb-kaart"><div class="mb-leenkop"><b>${esc(u.snapshot?.naam || 'Speler')}</b><span>${esc(u.vanTeamNaam || '?')} \u2192 ${esc(u.naarTeamNaam || '?')}</span></div>
      <div class="mb-leenvoet">${richting(u, cache)}<button class="mb-pill" data-mb="terug-leen" data-id="${esc(u.id)}">Terugzetten</button></div></div>`).join('') || '<p class="mb-leeg">Geen actieve uitleningen in deze bouw.</p>'}
    <button class="mb-knop rood" data-mb="nieuwleen">+ Nieuwe uitlening</button>`;
}

async function klik(e){
  const b = e.target.closest('[data-mb]'); if (!b || !st) return;
  const a = b.dataset.mb, id = b.dataset.id;
  if (a === 'terug'){
    if (st.teamId){ st.teamId = null; st.keuze = {}; teken(); return; }
    const m = await import('./teams.js?v=20260925b'); m.renderTeams(); toon('teams'); return;
  }
  if (a === 'tab'){ st.tab = id; st.teamId = null; st.keuze = {}; teken(); window.scrollTo(0, 0); return; }
  if (a === 'team'){ st.teamId = id; st.pag = 'sel'; st.keuze = {}; teken(); window.scrollTo(0, 0); return; }
  if (a === 'pag'){ st.pag = id; st.keuze = {}; teken(); return; }
  if (a === 'speler'){ st.pag = 'evs'; st.keuze = { speler:id }; teken(); return; }
  if (a === 'wedstrijd'){ st.keuze = { wedstrijd:id }; teken(); return; }
  if (a === 'eigen'){ const m = await import('./teams.js?v=20260925b'); m.openTeam(st.teamId, { sel:'spelers', evs:'spelers', evw:'evaluatie', stat:'stats' }[st.pag] || 'hub'); return; }
  if (a === 'nieuwleen'){ zetBouwContext(cache); modalNieuweUitleningVanuitBouw(() => teken()); return; }
  if (a === 'terug-leen'){ const u = cache.uitleningen.find(x => x.id === id); if (!u) return;
    try { if (await trekUitleningIn(u, st.clubId)){ cache.uitleningen = cache.uitleningen.filter(x => x.id !== id); teken(); } }
    catch(err){ meld('Terugzetten mislukt: ' + (err.code || err.message)); }
    return; }
}
