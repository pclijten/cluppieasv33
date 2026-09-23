/* ==================== DESKTOP-BOUWOMGEVING ====================
   [20260923c] Alleen op desktop (geladen door desktop.js). Per bouw van een
   club: een dashboard met alle teams, een overzicht van de uitleningen en per
   team Selectie / Evaluatie spelers / Evaluatie wedstrijden / Stats.
   Gegevens: dezelfde als het bestaande bouw-dashboard (bouw-hub.js →
   laadBouwData), dus geen nieuwe Firestore-toegang. Teams waar je geen coach
   van bent bekijk je alleen-lezen (htmlMeekijk in desktop-schermen.js); je
   eigen teams opent desktop.js in de gewone teamschermen.
   Tekent in een eigen view (#view-dkbouw) binnen #app.
=============================================================== */
import { S, $, esc, meld, isBeheerder, toon } from './state.js?v=20260922c';
import { BOUWEN, NIVEAUS, niveauKleur, bouwVanCategorie } from './config.js?v=20260922c';
import { ico } from './icons.js?v=20260922c';
import { analyseWedstrijd } from './analyse.js?v=20260922c';
import { laadBouwData, zetBouwContext, presentiePctTeam, presentiePctWedstrijdTeam, uitslagenTeam, modalNieuweUitleningVanuitBouw } from './bouw-hub.js?v=20260923g';
import { trekUitleningIn, definitiefOverzetten } from './teams-spelers.js?v=20260923g';
import { htmlMeekijk } from './desktop-schermen.js?v=20260923g';

const cache = new Map();          // 'clubId|bouw' → context uit laadBouwData
const bezig = new Map();          // lopende laadacties
let huidig = null;                // { clubId, bouw, scherm:'dash'|'uit'|'sel'|'evs'|'evw'|'stat', teamId, keuze:{} }
let herteken = () => {};

export function zetHerteken(f){ herteken = f || (() => {}); }
export function bouwHuidig(){ return huidig && document.querySelector('#view-dkbouw.actief') ? huidig : null; }
export function bouwTeams(clubId, bouw){ return cache.get(clubId + '|' + bouw)?.teams || null; }

const vandaag = () => new Date().toISOString().slice(0, 10);
const bouwNaamVan = id => BOUWEN.find(b => b.id === id)?.naam
  || S.clubs.flatMap(c => Array.isArray(c.eigenBouwen) ? c.eigenBouwen : []).find(b => b.id === id)?.naam || id;
const clubNaamVan = id => S.clubs.find(c => c.id === id)?.naam || (S.coordinatorBouwen || []).find(b => b.clubId === id)?.clubNaam || 'Club';
function datumKort(iso){ try { return new Date(iso + 'T12:00').toLocaleDateString('nl-NL', { weekday:'short', day:'numeric', month:'short' }); } catch(e){ return iso || ''; } }

export async function laadBouw(clubId, bouw, opnieuw = false){
  const k = clubId + '|' + bouw;
  if (!opnieuw && cache.has(k)){ zetBouwContext(cache.get(k)); return cache.get(k); }
  if (bezig.has(k)) return bezig.get(k);
  const p = laadBouwData(clubId, bouw).then(ctx => { cache.set(k, ctx); bezig.delete(k); herteken(); return ctx; })
    .catch(e => { bezig.delete(k); throw e; });
  bezig.set(k, p);
  return p;
}

function view(){
  let v = $('#view-dkbouw');
  if (!v){
    v = document.createElement('div');
    v.id = 'view-dkbouw'; v.className = 'view';
    $('#app').appendChild(v);
    v.addEventListener('click', klik);
  }
  return v;
}

/* ---------- ingang ---------- */
export async function openBouw(clubId, bouw, scherm = 'dash', teamId = null, keuze = {}){
  huidig = { clubId, bouw, scherm, teamId, keuze };
  const v = view();
  toon('dkbouw');
  if (!cache.has(clubId + '|' + bouw)){
    v.innerHTML = `<div class="dk-scherm">${kop('Laden\u2026')}<p class="dk-leeg" style="padding:40px 28px">Gegevens van alle teams in de ${esc(bouwNaamVan(bouw).toLowerCase())} ophalen\u2026</p></div>`;
    try { await laadBouw(clubId, bouw); }
    catch(e){ v.innerHTML = `<div class="dk-scherm">${kop('Fout')}<p class="dk-leeg" style="padding:40px 28px">Gegevens ophalen mislukt: ${esc(e.code || e.message)}</p></div>`; return; }
    if (huidig?.clubId !== clubId || huidig?.bouw !== bouw) return;   // intussen elders heen geklikt
  } else zetBouwContext(cache.get(clubId + '|' + bouw));
  teken();
}

function kop(titel, acties = ''){
  return `<div class="dk-kop"><div class="dk-kruim">${esc(huidig ? clubNaamVan(huidig.clubId) + ' / ' + bouwNaamVan(huidig.bouw) : '')} / <b>${esc(titel)}</b></div><div class="dk-acties">${acties}</div></div>`;
}
const knop = (label, dk, extra = '', icoon = '', attr = '') => `<button class="dk-knop ${extra}" data-bk="${dk}" ${attr}>${icoon ? ico(icoon, 18) : ''}${esc(label)}</button>`;

function teken(){
  if (!huidig) return;
  const ctx = cache.get(huidig.clubId + '|' + huidig.bouw); if (!ctx) return;
  zetBouwContext(ctx);
  const v = view();
  let html = '';
  try {
    if (huidig.scherm === 'dash') html = htmlDashboard(ctx);
    else if (huidig.scherm === 'uit') html = htmlUitleningen(ctx);
    else {
      const team = ctx.teams.find(t => t.id === huidig.teamId);
      if (!team){ html = `<div class="dk-scherm">${kop('Team')}<p class="dk-leeg" style="padding:40px 28px">Team niet gevonden.</p></div>`; }
      else {
        const titel = { sel:'Selectie', evs:'Evaluatie spelers', evw:'Evaluatie wedstrijden', stat:'Stats' }[huidig.scherm];
        const binnen = htmlMeekijk(huidig.scherm, team, ctx.data.get(team.id) || {}, huidig.keuze || {});
        html = `<div class="dk-meekijk"><div class="dk-lees">Meekijken als coördinator bij <b>${esc(team.naam)}</b> \u00b7 alleen lezen. Aanpassen doet de coach van het team.</div>${binnen.replace(/<div class="dk-kruim">[^]*?<\/div>/, `<div class="dk-kruim">${esc(bouwNaamVan(huidig.bouw))} / ${esc(team.naam)} / <b>${esc(titel)}</b></div>`)}</div>`;
      }
    }
  } catch(e){
    console.warn('[Cluppie] bouw-omgeving tekenen mislukt', e);
    html = `<div class="dk-scherm">${kop('Fout')}<p class="dk-leeg" style="padding:40px 28px">Dit scherm kon niet getekend worden.</p></div>`;
  }
  v.innerHTML = html;
  herteken();
}

/* ---------- dashboard ---------- */
function gespeeld(w){ return w.datum && (w.datum < vandaag() || (w.goals || []).length > 0); }
function gemKaart(d){
  const per = (d.spelers || []).map(p => {
    const b = [...(d.beoordelingen || [])].filter(x => x.spelerId === p.id).sort((a, c) => (c.datum || '').localeCompare(a.datum || ''))[0];
    if (!b) return null;
    if (b.scores){ const v = Object.values(b.scores).map(Number).filter(Boolean); return v.length ? v.reduce((a, c) => a + c, 0) / v.length : null; }
    return Number(b.niveau) || null;
  }).filter(Boolean);
  return per.length ? Math.round(40 + (per.reduce((a, c) => a + c, 0) / per.length - 1) * 14) : null;
}
function openEvaluaties(d){
  const ge = new Set((d.teamevaluaties || []).map(e => e.wedstrijdId));
  return (d.wedstrijden || []).filter(w => gespeeld(w) && (analyseWedstrijd(w).kwarten || 0) > 0 && !ge.has(w.id)).length;
}
/* [20260923f] Gedeeld met de mobiele bouw-omgeving (mobiel-bouw.js). */
export function teamRijen(ctx){
  return ctx.teams.map(t => {
    const d = ctx.data.get(t.id) || {};
    const u = (() => { try { return uitslagenTeam(t); } catch(e){ return {}; } })();
    const kom = (d.wedstrijden || []).filter(w => !gespeeld(w)).sort((a, b) => (a.datum + (a.aftrap || '')).localeCompare(b.datum + (b.aftrap || '')))[0] || null;
    return { t, d, u, kom, tr: (() => { try { return presentiePctTeam(t); } catch(e){ return null; } })(),
      wd: (() => { try { return presentiePctWedstrijdTeam(t); } catch(e){ return null; } })(), kaart: gemKaart(d), open: openEvaluaties(d) };
  });
}
function htmlDashboard(ctx){
  const teams = ctx.teams;
  const rij = teamRijen(ctx);
  const spelers = rij.reduce((a, r) => a + (r.d.spelers || []).length, 0);
  const trGem = rij.filter(r => r.tr != null); const trPct = trGem.length ? Math.round(trGem.reduce((a, r) => a + r.tr, 0) / trGem.length) : null;
  const eigen = new Set((S.teams || []).map(t => t.id));
  return `<div class="dk-scherm">
    ${kop('Dashboard', knop('Nieuwe uitlening', 'nieuwleen', 'rood', 'football-substitution'))}
    <div class="dkb-body">
      <div class="dkb-hallo"><h1 class="dk-groot">${esc(bouwNaamVan(ctx.bouw))} <span class="dk-omlijnd" style="display:inline">${esc(clubNaamVan(ctx.clubId))}</span></h1>
        <div class="dk-pills"><span class="dk-pill">${teams.length} teams \u00b7 ${spelers} spelers</span>${trPct != null ? `<span class="dk-pill groen">Opkomst training ${trPct}%</span>` : ''}<button class="dk-pill" data-bk="ververs">Verversen</button></div></div>
      <div class="dk-blok dkb-half"><h3>${ico('football-match', 18)}Vorige uitslagen<span>laatst bekend</span></h3>
        ${rij.map(r => { const l = r.u?.laatste; const kl = l ? (l.voor > l.tegen ? 'groen' : l.voor < l.tegen ? 'rood' : '') : '';
          return `<div class="dkb-rij"><b>${esc(r.t.naam)}</b><span>${l ? 'tegen ' + esc(l.tegenstander || '') + (l.bron === 'app' ? ' \u00b7 app' : '') : (r.u?.knvbVerborgen ? 'geen KNVB-uitslagen (O10 en jonger)' : 'nog geen uitslag')}</span>${l ? `<span class="dk-pill ${kl}">${l.voor}\u2013${l.tegen}</span>` : ''}</div>`; }).join('') || '<p class="dk-leeg">Geen teams.</p>'}</div>
      <div class="dk-blok dkb-half"><h3>${ico('planning-calendar', 18)}Komende wedstrijden</h3>
        ${rij.map(r => `<div class="dkb-rij"><b>${esc(r.t.naam)}</b><span>${r.kom ? esc(datumKort(r.kom.datum)) + (r.kom.aftrap ? ' \u00b7 ' + esc(r.kom.aftrap) : '') + ' \u00b7 ' + (r.kom.thuis ? 'thuis' : 'uit') + ' ' + esc(r.kom.tegenstander || '') : 'niets gepland'}</span></div>`).join('')}</div>
      <div class="dkb-tegels">${rij.map(r => `<button class="dkb-tegel ${eigen.has(r.t.id) ? 'eigen' : ''}" data-bk="team" data-id="${esc(r.t.id)}">
          <div class="dkb-tkop"><div><b>${esc(r.t.naam)}</b><small>${eigen.has(r.t.id) ? 'jouw team' : esc(Object.values(r.t.ledenInfo || {}).map(x => x?.naam).filter(Boolean)[0] || '')}</small></div>
            <div class="dkb-vorm">${(r.u?.vorm || []).map(x => `<i class="${x}">${x.toUpperCase()}</i>`).join('')}</div></div>
          <div class="dkb-cijfers"><span><b>${(r.d.spelers || []).length}</b><small>SPELERS</small></span><span><b class="g">${r.tr != null ? r.tr + '%' : '\u2013'}</b><small>TRAINING</small></span>
            <span><b class="bl">${r.wd != null ? r.wd + '%' : '\u2013'}</b><small>WEDSTR.</small></span><span><b>${r.kaart ?? '\u2013'}</b><small>GEM. KAART</small></span></div>
          <div class="dk-pills">${r.open ? `<span class="dk-pill oranje">${r.open} evaluatie${r.open === 1 ? '' : 's'} open</span>` : '<span class="dk-pill groen">evaluaties bij</span>'}${r.u?.stand?.positie ? `<span class="dk-pill">${esc(String(r.u.stand.positie))}e in de poule</span>` : ''}</div></button>`).join('')}</div>
      <div class="dk-blok dkb-opk"><h3>${ico('attendance-overview', 18)}Opkomst per team<span>dit seizoen</span></h3>
        ${rij.map(r => `<div class="dkb-opkrij"><b>${esc(r.t.naam)}</b><i><em class="g" style="width:${r.tr ?? 0}%"></em></i><i><em class="bl" style="width:${r.wd ?? 0}%"></em></i><span>${r.tr != null ? r.tr + '%' : '\u2013'} \u00b7 ${r.wd != null ? r.wd + '%' : '\u2013'}</span></div>`).join('')}
        <div class="dk-heat-leg"><span><i class="j"></i>training</span><span><i class="bl"></i>wedstrijd</span></div></div>
      <div class="dk-blok dkb-leen"><h3>${ico('football-substitution', 18)}Uitleningen<span>${ctx.uitleningen.length}</span></h3>
        ${ctx.uitleningen.slice(0, 6).map(u => `<div class="dkb-rij"><b>${esc(u.snapshot?.naam || 'Speler')}</b><span>${esc(u.vanTeamNaam || '?')} \u2192 ${esc(u.naarTeamNaam || '?')}</span>${richting(u, ctx)}</div>`).join('') || '<p class="dk-leeg">Geen actieve uitleningen.</p>'}
        <div class="dk-rij-knoppen">${knop('Nieuwe uitlening', 'nieuwleen', 'rood', 'action-add')}${knop('Alle uitleningen', 'naaruit')}</div></div>
    </div></div>`;
}

/* ---------- uitleningen ---------- */
function magTeam(teamId, ctx){
  const eigenTeamIds = new Set((S.teams || []).map(t => t.id));
  const coord = new Set((S.coordinatorBouwen || []).map(b => b.bouw));
  const bouwVan = Object.fromEntries(ctx.teams.map(t => [t.id, t.bouw]));
  return isBeheerder() || S.clubs.some(c => c.id === ctx.clubId) || eigenTeamIds.has(teamId) || coord.has(bouwVan[teamId]);
}
/* [20260923e] Richting van een uitlening t.o.v. deze bouw. Het andere team
   hoort niet bij de geladen bouw; zijn standaardbouw leiden we af uit de
   teamnaam (JO13-1 → middenbouw), net als bouwVanCategorie dat doet. */
function bouwVanTeamNaam(naam){
  const id = bouwVanCategorie(String(naam || '').split(/[-\s]/)[0]);
  return BOUWEN.find(b => b.id === id)?.naam?.toLowerCase() || 'andere bouw';
}
export function richting(u, ctx){
  const ids = new Set(ctx.teams.map(t => t.id));
  const van = ids.has(u.vanTeam), naar = ids.has(u.naarTeam);
  if (van && naar) return '<span class="dk-pill">binnen de bouw</span>';
  if (van) return `<span class="dk-pill oranje">\u2197 uitgeleend aan ${esc(bouwVanTeamNaam(u.naarTeamNaam))}</span>`;
  return `<span class="dk-pill dkb-in">\u2199 ingeleend uit ${esc(bouwVanTeamNaam(u.vanTeamNaam))}</span>`;
}
function htmlUitleningen(ctx){
  const lijst = ctx.uitleningen;
  return `<div class="dk-scherm">
    ${kop('Uitleningen', knop('Nieuwe uitlening', 'nieuwleen', 'rood', 'action-add'))}
    <div class="dkb-body dkb-uitbody">
      <h1 class="dk-groot">Uitleningen <span class="dk-omlijnd" style="display:inline">${esc(bouwNaamVan(ctx.bouw))}</span></h1>
      <div class="dk-blok dk-tabelblok"><table class="dk-tabel"><thead><tr><th>Speler</th><th>Van</th><th>Naar</th><th>Richting</th><th></th></tr></thead><tbody>
        ${lijst.map(u => { const def = magTeam(u.vanTeam, ctx) && magTeam(u.naarTeam, ctx);
          return `<tr><td><b>${esc(u.snapshot?.naam || 'Speler')}</b></td><td>${esc(u.vanTeamNaam || '?')}</td><td>${esc(u.naarTeamNaam || '?')}</td><td>${richting(u, ctx)}</td>
          <td class="n"><span class="dkb-tabknoppen">${knop('Terugzetten', 'terug', '', '', `data-id="${esc(u.id)}"`)}${def ? knop('Definitief', 'definitief', 'dk-gevaar', '', `data-id="${esc(u.id)}"`) : ''}</span></td></tr>`; }).join('')
          || '<tr><td colspan="5" class="dk-leeg">Geen actieve uitleningen in deze bouw.</td></tr>'}
      </tbody></table></div>
      <p class="dk-leeg">Terugzetten beëindigt de uitlening. Definitief zet de speler over naar het andere team (alleen als je op beide teams rechten hebt).</p>
    </div></div>`;
}

/* ---------- klikken ---------- */
async function klik(e){
  const b = e.target.closest('[data-bk], [data-dk]'); if (!b || !huidig) return;
  const ctx = cache.get(huidig.clubId + '|' + huidig.bouw);
  const a = b.dataset.bk, id = b.dataset.id;
  if (a === 'ververs'){ await laadBouw(huidig.clubId, huidig.bouw, true); teken(); return; }
  if (a === 'naaruit'){ huidig.scherm = 'uit'; teken(); return; }
  if (a === 'nieuwleen'){ zetBouwContext(ctx); modalNieuweUitleningVanuitBouw(() => teken()); return; }
  if (a === 'team'){
    if ((S.teams || []).some(t => t.id === id)){ herteken('eigen', id); return; }
    huidig.scherm = 'sel'; huidig.teamId = id; huidig.keuze = {}; teken(); return; }
  if (a === 'terug'){ const u = ctx.uitleningen.find(x => x.id === id); if (!u) return;
    if (await trekUitleningIn(u, huidig.clubId)){ ctx.uitleningen = ctx.uitleningen.filter(x => x.id !== id); teken(); } return; }
  if (a === 'definitief'){ const u = ctx.uitleningen.find(x => x.id === id); if (!u) return;
    /* eigen bouw: de rechtencontrole gaat over de standaardbouw van het bronteam */
    if (await definitiefOverzetten(u, huidig.clubId, ctx.teams.find(t => t.id === u.vanTeam)?.bouw || huidig.bouw)){ ctx.uitleningen = ctx.uitleningen.filter(x => x.id !== id); await laadBouw(huidig.clubId, huidig.bouw, true); teken(); } return; }
  /* meekijk-schermen: alleen kiezen, niets wijzigen */
  const dk = b.dataset.dk;
  if (dk === 'openprofiel' || dk === 'profiel'){ huidig.scherm = 'evs'; huidig.keuze = { speler: id }; teken(); return; }
  if (dk === 'evsel'){ huidig.keuze = { wedstrijd: id }; teken(); return; }
  if (dk === 'terugsel'){ huidig.scherm = 'sel'; huidig.keuze = {}; teken(); return; }
}
