/* ==================== BOUW-HUB (coördinator) ====================
   Volledige herbouw (2026-09-21) op verzoek van Paul: een écht dashboard
   i.p.v. een tabbalk, met de belangrijkste cijfers per bouw in één oogopslag,
   en een navigatie die nooit meer dan één stap terug hoeft te doen.

   Structuur (3 niveaus, elk met een eigen "‹ Terug"):
     Niveau 0 — Dashboard: aandacht-signalen, presentie, uitslagen & stand,
                één overlay-radar met alle teams, actuele uitleningen,
                daaronder de 4 tegels (Teams/Spelers/Uitleningen/Evaluaties).
     Niveau 1 — Tegel-scherm: Teams-lijst, Spelers-rooster, Uitleningen,
                Evaluaties-teamlijst (met voortgang + aantal metingen).
     Niveau 2 — Detail: Evaluaties-teamdetail (radar + heatmap) →
                spelerprofiel (groei-radar + tijdlijn).

   Verlaat je het paneel (Teams/Spelers → de échte teamhub), dan verschijnt
   een zwevend "↩ Terug naar {bouw}"-knopje dat blijft staan tot je 'm
   gebruikt — dat lost het "meerdere stappen terug"-probleem op zonder de
   router/hoofdnavigatie aan te raken.

   Alle data (spelers, wedstrijden, presentie, poulestand, beoordelingen)
   wordt ÉÉN keer per team opgehaald bij het openen en daarna door alle
   schermen hergebruikt (huidigeContext.data) — geen dubbele reads. */
import { S, esc, meld, openModal, sluitModal, isBeheerder } from './state.js?v=20260902d';
import {
  db, collection, doc, getDoc, getDocs, addDoc, query, where, documentId, serverTimestamp
} from './firebase.js?v=20260811a';
import { BOUWEN, bouwNaam, SKILLS } from './config.js?v=20260902d';
import { ico } from './icons.js?v=20260825b';
import { bouwLeenSnapshot, trekUitleningIn, definitiefOverzetten } from './teams-spelers.js?v=20260921c';
import { telGebruik } from './tracker.js?v=20260902d';
import { analyseWedstrijd } from './analyse.js?v=20260905a';
import { opkomstVoor, MIN_OPKOMST_TRAININGEN } from './opkomst.js?v=20260908a';

let laag = null;           // DOM-referentie naar het paneel, één instantie tegelijk
let huidigeContext = null; // {clubId, bouw, teams, data: Map(teamId -> {...}), uitleningen}
let terugPil = null;       // zwevend "↩ Terug naar {bouw}"-knopje, buiten het paneel

/* ==================== Paneel-skelet ==================== */
function bouwLaag(){
  if (laag) return laag;
  const el = document.createElement('div');
  el.className = 'wo-achter';
  el.id = 'bouwhubAchter';
  el.innerHTML = `
    <div class="wo-paneel" id="bouwhubPaneel">
      <div class="wo-topbar">
        <button class="terug" id="bouwhubTerugStap" style="display:none">‹</button>
        <h2 id="bouwhubTitel" style="flex:1">Bouw</h2>
        <button class="wo-sluit" id="bouwhubSluit" aria-label="Sluiten">${ico('navigation-close', 18) || '✕'}</button>
      </div>
      <div id="bouwhubInhoud"></div>
    </div>`;
  document.body.appendChild(el);
  el.addEventListener('click', e => { if (e.target === el) sluitBouwHub(); });
  el.querySelector('#bouwhubSluit').onclick = sluitBouwHub;
  laag = el;
  return el;
}
export function sluitBouwHub(){ if (laag) laag.classList.remove('open'); }
function verbergTijdelijk(){ if (laag) laag.classList.remove('open'); } // vlak vóór openModal() — zie onder
function toonWeerOp(){ if (laag) laag.classList.add('open'); }

/* Titel + terug-knop van het paneel zetten. `terugFn` is null op het
   dashboard (niveau 0, geen terug-knop nodig — sluiten kan altijd via ✕). */
function zetKop(titel, terugFn){
  const t = laag.querySelector('#bouwhubTitel'); t.textContent = titel;
  const b = laag.querySelector('#bouwhubTerugStap');
  if (terugFn){ b.style.display = ''; b.onclick = terugFn; }
  else { b.style.display = 'none'; b.onclick = null; }
}

/* ==================== Zwevende "terug naar bouw"-pil ====================
   Verschijnt zodra de coördinator het paneel verlaat om naar de échte
   teamhub te gaan; blijft staan tot hij 'm gebruikt of wegtikt, ongeacht
   waar hij verder navigeert. */
function toonTerugPil(){
  if (terugPil) return;
  const el = document.createElement('button');
  el.id = 'bouwhubTerugPil';
  el.style.cssText = 'position:fixed;left:50%;transform:translateX(-50%);bottom:calc(18px + env(safe-area-inset-bottom));'
    + 'z-index:40;background:var(--accent);color:#fff;border:none;border-radius:999px;padding:11px 18px;'
    + 'font-family:Inter,sans-serif;font-weight:600;font-size:calc(13px * var(--fs));box-shadow:0 8px 22px rgba(226,52,47,.35);'
    + 'display:flex;align-items:center;gap:8px;cursor:pointer;';
  el.innerHTML = `↩ Terug naar ${esc(bouwNaam(huidigeContext.bouw))} <span style="opacity:.7;font-weight:700;margin-left:2px" id="bouwhubPilSluit">✕</span>`;
  el.onclick = (e) => {
    if (e.target.id === 'bouwhubPilSluit'){ verbergTerugPil(); return; }
    verbergTerugPil();
    openBouwHub(huidigeContext.clubId, huidigeContext.bouw, true);
  };
  document.body.appendChild(el);
  terugPil = el;
}
function verbergTerugPil(){ if (terugPil){ terugPil.remove(); terugPil = null; } }

/* ==================== Data ophalen (één keer per team) ==================== */
async function haalTeamData(team){
  const [ssnap, wsnap, psnap, poulesnap, bsnap] = await Promise.all([
    getDocs(collection(db,'teams',team.id,'spelers')),
    getDocs(collection(db,'teams',team.id,'wedstrijden')),
    getDocs(collection(db,'teams',team.id,'presentie')),
    getDoc(doc(db,'teams',team.id,'poule','stand')),
    getDocs(collection(db,'teams',team.id,'beoordelingen')),
  ]);
  const spelers = ssnap.docs.map(d => ({id:d.id, ...d.data()})).filter(p => !p.gast && !p._ingeleend);
  const wedstrijden = wsnap.docs.map(d => d.data()).filter(w => w.datum).sort((a,b) => a.datum.localeCompare(b.datum));
  const presentie = psnap.docs.map(d => d.data()).filter(s => s.datum);
  const stand = poulesnap.exists() ? poulesnap.data() : null;
  const beoordelingen = bsnap.docs.map(d => d.data()).filter(b => b.soort === 'volledig' && b.spelerId && b.scores);
  return { spelers, wedstrijden, presentie, stand, beoordelingen };
}

export async function openBouwHub(clubId, bouw, isHerbezoek){
  const el = bouwLaag();
  el.classList.add('open');
  verbergTerugPil();

  // Herbezoek via de terug-pil met dezelfde bouw → cache hergebruiken, geen herfetch.
  if (isHerbezoek && huidigeContext && huidigeContext.clubId === clubId && huidigeContext.bouw === bouw){
    renderDashboard();
    return;
  }

  zetKop(bouwNaam(bouw), null);
  const inhoud = el.querySelector('#bouwhubInhoud');
  inhoud.innerHTML = `<p style="font-size:calc(13px * var(--fs));color:var(--ink-2);text-align:center;padding:30px 0">Dashboard laden…</p>`;

  let teams = [];
  try {
    const snap = await getDocs(query(collection(db,'teams'), where('club','==',clubId), where('bouw','==',bouw)));
    teams = snap.docs.map(d => ({id:d.id, ...d.data()})).sort((a,b) => (a.naam||'').localeCompare(b.naam||''));
  } catch(e){
    inhoud.innerHTML = `<p style="font-size:calc(13px * var(--fs));color:var(--uit);text-align:center;padding:30px 0">Teams ophalen mislukt: ${esc(e.code||e.message)}</p>`;
    return;
  }
  if (!teams.length){
    inhoud.innerHTML = `<div class="kaart leeg">Nog geen teams met dit bouw-veld gevonden.<br>Bestaande teams hebben mogelijk nog geen <code>bouw</code>-veld — zie de migratienotitie.</div>`;
    huidigeContext = {clubId, bouw, teams: [], data: new Map(), uitleningen: []};
    return;
  }

  try {
    const dataLijst = await Promise.all(teams.map(t => haalTeamData(t)));
    const data = new Map(teams.map((t,i) => [t.id, dataLijst[i]]));
    const teamIds = new Set(teams.map(t => t.id));
    const usnap = await getDocs(collection(db,'clubs',clubId,'uitleningen'));
    const uitleningen = usnap.docs.map(d => ({id:d.id, ...d.data()})).filter(u => teamIds.has(u.vanTeam) || teamIds.has(u.naarTeam));
    huidigeContext = {clubId, bouw, teams, data, uitleningen};
  } catch(e){
    inhoud.innerHTML = `<p style="font-size:calc(13px * var(--fs));color:var(--uit);text-align:center;padding:30px 0">Gegevens ophalen mislukt: ${esc(e.code||e.message)}</p>`;
    return;
  }
  renderDashboard();
}

/* ==================== Berekeningen op de cache ==================== */
function teamNaam(id){ return huidigeContext.teams.find(t => t.id === id)?.naam || '?'; }

function presentiePctTeam(team){
  const d = huidigeContext.data.get(team.id);
  if (!d.presentie.length || !d.spelers.length) return null;
  const pcts = d.spelers.map(p => opkomstVoor(p, d.presentie)).filter(o => o.totaal >= MIN_OPKOMST_TRAININGEN).map(o => o.pct);
  if (!pcts.length) return null;
  return Math.round(pcts.reduce((s,x) => s+x, 0) / pcts.length);
}

function uitslagenTeam(team){
  const d = huidigeContext.data.get(team.id);
  const gespeeld = d.wedstrijden.filter(w => { const a = analyseWedstrijd(w); return a.kwarten > 0 && Array.isArray(w.goals); });
  let w=0, g=0, v=0, voor=0, tegen=0, laatste=null;
  for (const wed of gespeeld){
    const vv = (wed.goals||[]).filter(x => x.type==='voor').length;
    const tt = (wed.goals||[]).filter(x => x.type==='tegen').length;
    voor += vv; tegen += tt;
    if (vv>tt) w++; else if (vv<tt) v++; else g++;
    laatste = {tegenstander: wed.tegenstander||'?', voor:vv, tegen:tt, datum:wed.datum};
  }
  const eigenRij = d.stand?.rijen?.find(r => r.eigen) || null;
  return { w, g, v, voor, tegen, gespeeld: gespeeld.length, laatste, stand: eigenRij, totaalTeams: d.stand?.rijen?.length || null };
}

const DOM = SKILLS.map(s => s.id);
const DOM_LABEL = Object.fromEntries(SKILLS.map(s => [s.id, s.kort]));

function teamRadarGemiddelde(team){
  const d = huidigeContext.data.get(team.id);
  const perSpeler = {}; // spelerId -> laatste officiële meting
  d.beoordelingen.forEach(b => { if (b.officieel) perSpeler[b.spelerId] = b; });
  const metingen = Object.values(perSpeler);
  if (!metingen.length) return null;
  return DOM.map(dom => metingen.reduce((s,m) => s + (m.scores[dom]||0), 0) / metingen.length);
}

function uitgeleendeSpelersBouw(){
  return huidigeContext.uitleningen.map(u => ({
    naam: u.snapshot?.naam || 'Speler', van: u.vanTeamNaam||'?', naar: u.naarTeamNaam||'?',
  }));
}

/* Signalen die op het dashboard bovenaan komen — combineert wat eerder los
   in Uitleningen/Evaluaties zat tot één overzicht, want dát is precies waar
   een coördinator als eerste naar wil kijken. */
function aandachtSignalen(){
  const signalen = [];
  for (const t of huidigeContext.teams){
    const d = huidigeContext.data.get(t.id);
    const officieelCount = new Set(d.beoordelingen.filter(b=>b.officieel).map(b=>b.spelerId)).size;
    if (d.spelers.length && officieelCount === 0){
      signalen.push({ernst:2, tekst: `<b>${esc(t.naam)}</b> heeft nog geen enkele officiële halfjaarevaluatie.`});
    }
    const pct = presentiePctTeam(t);
    if (pct != null && pct < 70){
      signalen.push({ernst:1, tekst: `<b>${esc(t.naam)}</b> zit op ${pct}% presentie dit seizoen.`});
    }
  }
  const teamIds = new Set(huidigeContext.teams.map(t=>t.id));
  const uitPerTeam = {}, inPerTeam = {};
  huidigeContext.uitleningen.forEach(u => {
    if (teamIds.has(u.vanTeam)) uitPerTeam[u.vanTeam] = (uitPerTeam[u.vanTeam]||0)+1;
    if (teamIds.has(u.naarTeam)) inPerTeam[u.naarTeam] = (inPerTeam[u.naarTeam]||0)+1;
  });
  Object.entries(uitPerTeam).filter(([tid,n]) => n>=2 && !inPerTeam[tid]).forEach(([tid,n]) => {
    signalen.push({ernst:1, tekst: `<b>${esc(teamNaam(tid))}</b> leende dit seizoen ${n}× uit en ontving nog niet terug.`});
  });
  return signalen.sort((a,b) => b.ernst-a.ernst).slice(0,5);
}

/* ==================== Radar (gedeeld door dashboard + evaluaties) ==================== */
const RADAR_KLEUREN = ['var(--accent)','var(--ok)','var(--warn)','#5B8DEF','#B47CE5','#E56CA5'];
function radarSVG(values, {size=150, labels=true, color='var(--accent)', compare=null, compareColor='var(--ink-2)', gestippeld=true} = {}){
  const R = size/2 - (labels?26:4), cx=size/2, cy=size/2;
  const pt=(i,f)=>{ const a=(-90+i*(360/DOM.length))*Math.PI/180; return [cx+R*f*Math.cos(a), cy+R*f*Math.sin(a)]; };
  let grid = '';
  [0.33,0.66,1].forEach(f => { grid += `<polygon points="${DOM.map((_,i)=>pt(i,f).join(',')).join(' ')}" fill="none" stroke="var(--line-d)" stroke-width="1"/>`; });
  DOM.forEach((_,i) => { const [x,y]=pt(i,1); grid += `<line x1="${cx}" y1="${cy}" x2="${x}" y2="${y}" stroke="var(--line-d)" stroke-width="1"/>`; });
  let lab = '';
  if (labels) DOM.forEach((d,i) => { const [x,y]=pt(i,1.18); lab += `<text x="${x}" y="${y}" text-anchor="middle" dominant-baseline="middle" font-size="10" font-weight="700" fill="var(--ink-2)">${esc(DOM_LABEL[d])}</text>`; });
  let compareLaag = '';
  if (compare){
    const cpts = compare.map((v,i) => pt(i,v/5).join(',')).join(' ');
    compareLaag = `<polygon points="${cpts}" fill="${compareColor}" fill-opacity=".12" stroke="${compareColor}" stroke-width="1.6" ${gestippeld?'stroke-dasharray="4 3"':''}/>`;
  }
  const data = values.map((v,i) => pt(i,v/5).join(',')).join(' ');
  return `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">${grid}${compareLaag}<polygon points="${data}" fill="${color}" fill-opacity=".35" stroke="${color}" stroke-width="2"/>${lab}</svg>`;
}
function radarLegende(a, b){
  return `<div style="display:flex;justify-content:center;gap:16px;font-size:calc(11px * var(--fs));color:var(--ink-2);margin-top:-2px">
    <span><span style="display:inline-block;width:10px;height:10px;border-radius:3px;background:var(--accent);margin-right:5px"></span>${esc(a)}</span>
    <span><span style="display:inline-block;width:10px;height:10px;border-radius:3px;border:1.6px dashed var(--ink-2);margin-right:5px"></span>${esc(b)}</span>
  </div>`;
}
/* Overlay-radar: alle teams in één chart, elk in een eigen kleur, i.p.v. losse
   radartjes per team — zo vergelijk je in één oogopslag waar de bouw sterk/
   zwak staat. */
function radarOverlaySVG(reeksen, {size=190} = {}){
  const R = size/2 - 30, cx=size/2, cy=size/2;
  const pt=(i,f)=>{ const a=(-90+i*(360/DOM.length))*Math.PI/180; return [cx+R*f*Math.cos(a), cy+R*f*Math.sin(a)]; };
  let grid = '';
  [0.33,0.66,1].forEach(f => { grid += `<polygon points="${DOM.map((_,i)=>pt(i,f).join(',')).join(' ')}" fill="none" stroke="var(--line-d)" stroke-width="1"/>`; });
  DOM.forEach((_,i) => { const [x,y]=pt(i,1); grid += `<line x1="${cx}" y1="${cy}" x2="${x}" y2="${y}" stroke="var(--line-d)" stroke-width="1"/>`; });
  let lab = '';
  DOM.forEach((d,i) => { const [x,y]=pt(i,1.16); lab += `<text x="${x}" y="${y}" text-anchor="middle" dominant-baseline="middle" font-size="10" font-weight="700" fill="var(--ink-2)">${esc(DOM_LABEL[d])}</text>`; });
  let lagen = '';
  reeksen.forEach((r,i) => {
    const kleur = RADAR_KLEUREN[i % RADAR_KLEUREN.length];
    const data = r.waarden.map((v,j) => pt(j,v/5).join(',')).join(' ');
    lagen += `<polygon points="${data}" fill="${kleur}" fill-opacity=".08" stroke="${kleur}" stroke-width="2"/>`;
  });
  return `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">${grid}${lagen}${lab}</svg>`;
}

/* ==================== NIVEAU 0 — Dashboard ==================== */
function renderDashboard(){
  zetKop(bouwNaam(huidigeContext.bouw), null);
  const inhoud = laag.querySelector('#bouwhubInhoud');
  const { teams } = huidigeContext;

  const signalen = aandachtSignalen();
  const aandachtHtml = signalen.length ? `
    <div class="sectie-kop" style="margin-top:0">${ico('action-warning',15)||''} Aandacht nodig</div>
    <div class="kaart">
      ${signalen.map(s => `
        <div class="aandacht-kaart" style="cursor:default">
          <span class="stip" style="background:${s.ernst>=2?'var(--uit)':'var(--warn)'}"></span>
          <div class="aandacht-body">
            <div class="aandacht-reden">${s.tekst}</div>
          </div>
        </div>`).join('')}
    </div>` : '';

  const presentieHtml = `
    <div class="sectie-kop">Presentie</div>
    <div class="kaart">
      ${teams.map(t => {
        const pct = presentiePctTeam(t);
        const kleur = pct==null ? 'var(--ink-2)' : pct>=85 ? 'var(--ok)' : pct>=70 ? 'var(--warn)' : 'var(--uit)';
        return `<div style="margin-bottom:10px">
          <div style="display:flex;justify-content:space-between;font-size:calc(13px * var(--fs));margin-bottom:4px">
            <b>${esc(t.naam)}</b><span style="color:${kleur};font-weight:700">${pct==null?'–':pct+'%'}</span>
          </div>
          ${pct!=null ? `<div style="height:7px;background:var(--surface-2);border-radius:4px;overflow:hidden">
            <div style="height:100%;width:${pct}%;background:${kleur};border-radius:4px"></div></div>` : ''}
        </div>`;
      }).join('')}
    </div>`;

  const uitslagenHtml = `
    <div class="sectie-kop">Uitslagen & stand</div>
    ${teams.map(t => {
      const u = uitslagenTeam(t);
      const positie = u.stand ? `${u.stand.positie}${u.totaalTeams?' van '+u.totaalTeams:''}` : 'nog geen stand';
      const laatsteTxt = u.laatste ? `Laatst: vs ${esc(u.laatste.tegenstander)} ${u.laatste.voor}-${u.laatste.tegen}` : 'Nog geen wedstrijd gelogd';
      return `<div class="kaart" style="margin-bottom:8px">
        <div style="display:flex;justify-content:space-between;align-items:baseline">
          <b style="font-size:calc(14px * var(--fs))">${esc(t.naam)}</b>
          <span style="font-family:'Barlow Condensed';font-weight:700;font-size:calc(16px * var(--fs));color:var(--accent)">${esc(positie)}</span>
        </div>
        <div style="font-size:calc(12px * var(--fs));color:var(--ink-2);margin-top:4px">
          ${u.gespeeld} gespeeld · ${u.w}W ${u.g}G ${u.v}V · ${u.voor}-${u.tegen} doelpunten (gelogd)
        </div>
        <div style="font-size:calc(12px * var(--fs));color:var(--ink-2);margin-top:2px">${esc(laatsteTxt)}</div>
      </div>`;
    }).join('')}`;

  const reeksen = teams.map(t => ({naam:t.naam, waarden: teamRadarGemiddelde(t)})).filter(r => r.waarden);
  const radarHtml = `
    <div class="sectie-kop">Ontwikkeling — alle teams</div>
    <div class="kaart" style="text-align:center">
      ${reeksen.length ? `
        ${radarOverlaySVG(reeksen)}
        <div style="display:flex;flex-wrap:wrap;justify-content:center;gap:10px;margin-top:8px">
          ${reeksen.map((r,i) => `<span style="font-size:calc(11px * var(--fs));color:var(--ink-2)"><span style="display:inline-block;width:9px;height:9px;border-radius:3px;background:${RADAR_KLEUREN[i%RADAR_KLEUREN.length]};margin-right:4px"></span>${esc(r.naam)}</span>`).join('')}
        </div>`
      : `<div style="color:var(--ink-2);font-size:calc(13px * var(--fs));padding:14px 0">Nog geen officiële evaluaties in deze bouw.</div>`}
    </div>`;

  const uitgeleend = uitgeleendeSpelersBouw();
  const uitleenHtml = `
    <div class="sectie-kop">Actuele uitleningen</div>
    <div class="kaart">
      ${uitgeleend.length ? uitgeleend.map(u => `<div style="margin-bottom:6px;font-size:calc(13px * var(--fs))"><b>${esc(u.naam)}</b><span style="color:var(--ink-2);font-size:calc(12px * var(--fs))"> · ${esc(u.van)} → ${esc(u.naar)}</span></div>`).join('')
        : `<span style="color:var(--ink-2);font-size:calc(13px * var(--fs))">Niemand momenteel uitgeleend.</span>`}
    </div>`;

  const tegelsHtml = `
    <div class="sectie-kop">Beheren</div>
    <div class="hub-grid">
      <button class="hub-tegel" data-bh-open="teams">${ico('team-team',34)}<span class="hub-tnaam">Teams</span></button>
      <button class="hub-tegel" data-bh-open="spelers">${ico('team-members',34)}<span class="hub-tnaam">Spelers</span></button>
      <button class="hub-tegel" data-bh-open="uitleningen">${ico('football-substitution',34)}<span class="hub-tnaam">Uitleningen</span>${uitgeleend.length?`<span class="hub-badge">${uitgeleend.length}</span>`:''}</button>
      <button class="hub-tegel" data-bh-open="evaluaties">${ico('attendance-evaluatie',34)}<span class="hub-tnaam">Evaluaties</span></button>
    </div>`;

  inhoud.innerHTML = aandachtHtml + presentieHtml + uitslagenHtml + radarHtml + uitleenHtml + tegelsHtml;

  inhoud.querySelectorAll('[data-bh-open]').forEach(b => {
    b.onclick = () => {
      const tab = b.dataset.bhOpen;
      if (tab === 'teams') renderTeamsScherm();
      else if (tab === 'spelers') renderSpelersScherm();
      else if (tab === 'uitleningen') renderUitleningenScherm();
      else renderEvaluatiesScherm();
    };
  });
}

/* ==================== NIVEAU 1 — Teams ==================== */
function renderTeamsScherm(){
  zetKop('Teams', renderDashboard);
  const inhoud = laag.querySelector('#bouwhubInhoud');
  const { teams } = huidigeContext;
  inhoud.innerHTML = `
    <div class="sectie-kop" style="margin-top:0">${teams.length} team${teams.length===1?'':'s'}</div>
    ${teams.map(t => `
      <button class="lijst-item" data-bh-open-team="${t.id}">
        <div class="team-shirt">${esc(t.format||'?')}<small>v${esc(t.format||'?')}</small></div>
        <div class="li-tekst">
          <div class="titel">${esc(t.naam)}</div>
          <div class="meta">${esc(t.categorie||'—')} · ${Object.keys(t.leden||{}).length} coach(es)</div>
        </div>
        <span class="pijl">›</span>
      </button>`).join('')}`;
  inhoud.querySelectorAll('[data-bh-open-team]').forEach(b => {
    b.onclick = async () => {
      sluitBouwHub(); toonTerugPil();
      const m = await import('./teams.js?v=20260921c');
      m.openTeam(b.dataset.bhOpenTeam);
    };
  });
}

/* ==================== NIVEAU 1 — Spelers ==================== */
function posititiesPerTeam(team){
  const d = huidigeContext.data.get(team.id);
  const RECENT_N = 5;
  const wedstrijden = d.wedstrijden;
  const ouder = wedstrijden.slice(0, Math.max(0, wedstrijden.length - RECENT_N));
  const recent = wedstrijden.slice(Math.max(0, wedstrijden.length - RECENT_N));
  const tel = (lijst) => {
    const per = {}; let matches = 0;
    for (const w of lijst){
      const a = analyseWedstrijd(w);
      if (!a.kwarten) continue;
      matches++;
      for (const [pid, l] of Object.entries(a.lijn)){
        per[pid] ||= {};
        for (const [naam, n] of Object.entries(l)) per[pid][naam] = (per[pid][naam]||0) + n;
      }
    }
    return {per, matches};
  };
  const totaal = tel(wedstrijden), tOuder = tel(ouder), tRecent = tel(recent);
  const resultaat = {};
  for (const [pid, posities] of Object.entries(totaal.per)){
    const gesorteerd = Object.entries(posities).sort((a,b) => b[1]-a[1]).slice(0,2).map(([naam]) => naam);
    resultaat[pid] = gesorteerd.map(naam => {
      let trend = null;
      if (wedstrijden.length >= RECENT_N && tOuder.matches && tRecent.matches){
        const rOuder = (tOuder.per[pid]?.[naam] || 0) / tOuder.matches;
        const rRecent = (tRecent.per[pid]?.[naam] || 0) / tRecent.matches;
        if (rRecent > rOuder * 1.3) trend = 'up';
        else if (rRecent < rOuder * 0.7 && rOuder > 0) trend = 'down';
      }
      return {naam, trend};
    });
  }
  return resultaat;
}
function trendPijl(t){
  if (t==='up') return ' <span style="color:var(--ok);font-weight:700">↑</span>';
  if (t==='down') return ' <span style="color:var(--uit);font-weight:700">↓</span>';
  return '';
}
function renderSpelersScherm(){
  zetKop('Spelers', renderDashboard);
  const { teams } = huidigeContext;
  if (!huidigeContext.spelersLijst){
    const alles = [];
    for (const t of teams){
      const posities = posititiesPerTeam(t);
      const d = huidigeContext.data.get(t.id);
      d.spelers.forEach(p => {
        const top = posities[p.id] || (p.positie ? [{naam:p.positie, trend:null}] : []);
        alles.push({...p, teamId:t.id, teamNaam:t.naam, topPosities:top});
      });
    }
    alles.sort((a,b) => (a.naam||'').localeCompare(b.naam||''));
    huidigeContext.spelersLijst = alles;
  }
  tekenSpelersLijst('alle');
}
function tekenSpelersLijst(filterTeamId){
  const inhoud = laag.querySelector('#bouwhubInhoud');
  const { teams, spelersLijst } = huidigeContext;
  const items = filterTeamId === 'alle' ? spelersLijst : spelersLijst.filter(p => p.teamId === filterTeamId);
  inhoud.innerHTML = `
    <div style="display:flex;gap:8px;overflow-x:auto;margin-bottom:12px">
      <button class="knop klein ${filterTeamId==='alle'?'vol':'licht'}" data-bh-filter="alle" style="white-space:nowrap">Alle teams</button>
      ${teams.map(t => `<button class="knop klein ${filterTeamId===t.id?'vol':'licht'}" data-bh-filter="${t.id}" style="white-space:nowrap">${esc(t.naam)}</button>`).join('')}
    </div>
    ${items.length ? items.map(p => `
      <button class="lijst-item" data-bh-open-speler="${p.id}" data-bh-team="${p.teamId}">
        <div class="team-shirt">${p.nummer!=null&&p.nummer!==''?esc(String(p.nummer)):'?'}</div>
        <div class="li-tekst">
          <div class="titel">${esc(p.naam)}</div>
          <div class="meta">${esc(p.teamNaam)}${p.topPosities.length ? ' · ' + p.topPosities.map(x => esc(x.naam) + trendPijl(x.trend)).join(', ') : ''}</div>
        </div>
        <span class="pijl">›</span>
      </button>`).join('') : `<div class="kaart leeg">Geen spelers gevonden.</div>`}`;
  inhoud.querySelectorAll('[data-bh-filter]').forEach(b => b.onclick = () => tekenSpelersLijst(b.dataset.bhFilter));
  inhoud.querySelectorAll('[data-bh-open-speler]').forEach(b => {
    b.onclick = async () => {
      sluitBouwHub(); toonTerugPil();
      const m = await import('./teams.js?v=20260921c');
      m.openTeam(b.dataset.bhTeam, 'spelers', {beoordeelProfiel: b.dataset.bhOpenSpeler});
    };
  });
}

/* ==================== NIVEAU 1 — Uitleningen ==================== */
function renderUitleningenScherm(){
  zetKop('Uitleningen', renderDashboard);
  const inhoud = laag.querySelector('#bouwhubInhoud');
  const { clubId, teams, uitleningen } = huidigeContext;
  const teamIds = new Set(teams.map(t => t.id));
  const bouwPerTeam = Object.fromEntries(teams.map(t => [t.id, t.bouw]));

  const render = async () => {
    const onbekend = [...new Set(uitleningen.flatMap(u => [u.vanTeam, u.naarTeam]))].filter(id => id && !(id in bouwPerTeam));
    for (let i=0; i<onbekend.length; i+=30){
      const chunk = onbekend.slice(i, i+30);
      try {
        const tsnap = await getDocs(query(collection(db,'teams'), where(documentId(),'in',chunk)));
        tsnap.docs.forEach(d => { bouwPerTeam[d.id] = d.data().bouw || null; });
      } catch(e){}
    }
    const eigenTeamIds = new Set((S.teams||[]).map(t => t.id));
    const coordBouwen = new Set((S.coordinatorBouwen||[]).map(b => b.bouw));
    const magTeam = (teamId) => isBeheerder() || eigenTeamIds.has(teamId) || coordBouwen.has(bouwPerTeam[teamId]);

    inhoud.innerHTML = `
      <button class="knop vol" id="bhNieuweUitlening" style="margin-top:2px">+ Speler uitlenen</button>
      <div class="sectie-kop">Actief · ${uitleningen.length}</div>
      ${uitleningen.length ? uitleningen.map(u => {
        const magDefinitief = magTeam(u.vanTeam) && magTeam(u.naarTeam);
        return `
        <div class="lijst-item" style="cursor:default;flex-wrap:wrap">
          <div class="team-shirt">${ico('football-substitution',20) || '⇄'}</div>
          <div class="li-tekst">
            <div class="titel">${esc(u.snapshot?.naam || 'Speler')}</div>
            <div class="meta">${esc(u.vanTeamNaam||'?')} → ${esc(u.naarTeamNaam||'?')}</div>
          </div>
          <div style="display:flex;gap:6px;width:100%;margin-top:8px">
            <button class="knop licht klein" data-bh-terug="${u.id}" style="flex:1">Terugzetten</button>
            ${magDefinitief ? `<button class="knop gevaar klein" data-bh-definitief="${u.id}" style="flex:1">Definitief</button>`
              : `<button class="knop licht klein" disabled title="Vereist rechten op beide teams" style="flex:1;opacity:.5">Definitief</button>`}
          </div>
        </div>`;
      }).join('') : `<div class="kaart leeg">Geen actieve uitleningen in deze bouw.</div>`}`;

    inhoud.querySelectorAll('[data-bh-terug]').forEach(b => {
      b.onclick = async () => {
        const u = uitleningen.find(x => x.id === b.dataset.bhTerug);
        const ok = await trekUitleningIn(u, clubId);
        if (ok){ huidigeContext.uitleningen = uitleningen.filter(x => x.id !== u.id); render(); }
      };
    });
    inhoud.querySelectorAll('[data-bh-definitief]').forEach(b => {
      b.onclick = async () => {
        const u = uitleningen.find(x => x.id === b.dataset.bhDefinitief);
        const ok = await definitiefOverzetten(u, clubId, huidigeContext.bouw);
        if (ok){
          huidigeContext.uitleningen = uitleningen.filter(x => x.id !== u.id);
          delete huidigeContext.spelersLijst;
          render();
        }
      };
    });
    inhoud.querySelector('#bhNieuweUitlening').onclick = () => modalNieuweUitleningVanuitBouw(render);
  };
  render();
}

async function modalNieuweUitleningVanuitBouw(verversScherm){
  const { clubId, teams } = huidigeContext;
  verbergTijdelijk();

  openModal(`
    <h2>Speler uitlenen</h2>
    <div class="veldgroep"><label>Stap 1 — vanuit welk team (in deze bouw)?</label>
      <select class="invoer" id="bhUlVanTeam"><option value="">Kies een team…</option>
        ${teams.map(t => `<option value="${t.id}">${esc(t.naam)}</option>`).join('')}
      </select></div>
    <div class="veldgroep"><label>Stap 2 — welke speler?</label>
      <select class="invoer" id="bhUlSpeler" disabled><option value="">Kies eerst een team…</option></select></div>
    <div class="veldgroep"><label>Stap 3 — naar welk team wordt hij uitgeleend?</label>
      <select class="invoer" id="bhUlNaarTeam" disabled><option value="">Kies eerst een speler…</option></select></div>
    <div class="avg-balk">${ico('action-info',17) || ''}<span>De speler doet vanaf nu volwaardig mee bij het gekozen team. Bij het bronteam blijft hij ook gewoon bruikbaar. Geen einddatum — een van beide coaches (of jij) zet hem later terug.</span></div>
    <button class="knop vol" id="bhUlOk" disabled>Uitlenen bevestigen</button>
    <button class="knop licht vol" id="bhUlAnnuleer" style="margin-top:8px">Annuleren</button>`);

  const $ = sel => document.getElementById(sel);
  $('bhUlAnnuleer').onclick = () => { sluitModal(); toonWeerOp(); };
  const check = () => { $('bhUlOk').disabled = !($('bhUlVanTeam').value && $('bhUlSpeler').value && $('bhUlNaarTeam').value); };

  $('bhUlVanTeam').onchange = async () => {
    const vanTeam = $('bhUlVanTeam').value;
    const spelerSel = $('bhUlSpeler'), naarSel = $('bhUlNaarTeam');
    spelerSel.disabled = true; naarSel.disabled = true; naarSel.innerHTML = '<option value="">Kies eerst een speler…</option>';
    spelerSel.innerHTML = '<option value="">Spelers laden…</option>';
    if (!vanTeam){ spelerSel.innerHTML = '<option value="">Kies eerst een team…</option>'; check(); return; }
    try {
      // Team binnen deze bouw? Spelers zijn al gecached — anders alsnog ophalen.
      const d = huidigeContext.data.get(vanTeam);
      const spelers = d ? d.spelers : (await getDocs(collection(db,'teams',vanTeam,'spelers'))).docs.map(x => ({id:x.id, ...x.data()})).filter(p=>!p.gast&&!p._ingeleend);
      const gesorteerd = [...spelers].sort((a,b) => (a.naam||'').localeCompare(b.naam||''));
      spelerSel.innerHTML = gesorteerd.length
        ? '<option value="">Kies een speler…</option>' + gesorteerd.map(p => `<option value="${p.id}">${esc(p.naam)}${p.nummer!=null&&p.nummer!==''?' · #'+esc(p.nummer):''}</option>`).join('')
        : '<option value="">Geen spelers gevonden</option>';
      spelerSel.disabled = !gesorteerd.length;
    } catch(e){ spelerSel.innerHTML = '<option value="">Ophalen mislukt</option>'; }
    check();
  };

  $('bhUlSpeler').onchange = async () => {
    const naarSel = $('bhUlNaarTeam');
    naarSel.disabled = true; naarSel.innerHTML = '<option value="">Teams laden…</option>';
    if (!$('bhUlSpeler').value){ naarSel.innerHTML = '<option value="">Kies eerst een speler…</option>'; check(); return; }
    try {
      const csnap = await getDoc(doc(db,'clubs',clubId));
      const ids = (csnap.exists() ? Object.keys(csnap.data().teams || {}) : []).filter(id => id !== $('bhUlVanTeam').value);
      let doelTeams = [];
      for (let i=0;i<ids.length;i+=30){
        const chunk = ids.slice(i,i+30);
        if (!chunk.length) break;
        const tsnap = await getDocs(query(collection(db,'teams'), where(documentId(),'in',chunk)));
        tsnap.docs.forEach(d => doelTeams.push({id:d.id, naam:d.data().naam||'?', bouw:d.data().bouw||null}));
      }
      doelTeams.sort((a,b) => a.naam.localeCompare(b.naam));
      const eigenBouw = huidigeContext.bouw;
      naarSel.innerHTML = doelTeams.length
        ? '<option value="">Kies een team…</option>' + doelTeams.map(t => `<option value="${t.id}|${esc(t.naam)}">${esc(t.naam)}${t.bouw && t.bouw!==eigenBouw ? ' ('+esc(bouwNaam(t.bouw))+')' : ''}</option>`).join('')
        : '<option value="">Geen andere teams gevonden</option>';
      naarSel.disabled = !doelTeams.length;
    } catch(e){ naarSel.innerHTML = '<option value="">Ophalen mislukt</option>'; }
    check();
  };
  $('bhUlNaarTeam').onchange = check;

  $('bhUlOk').onclick = async () => {
    const vanTeam = $('bhUlVanTeam').value;
    const vanTeamNaam = $('bhUlVanTeam').selectedOptions[0].textContent;
    const spelerId = $('bhUlSpeler').value;
    const [naarTeam, naarTeamNaam] = $('bhUlNaarTeam').value.split('|');
    const okBtn = $('bhUlOk');
    okBtn.disabled = true; okBtn.textContent = 'Bezig…';
    try {
      const psnap = await getDoc(doc(db,'teams',vanTeam,'spelers',spelerId));
      if (!psnap.exists()) throw new Error('Speler niet gevonden');
      const p = {id:psnap.id, ...psnap.data()};
      telGebruik('uitlenen');
      const nieuweRef = await addDoc(collection(db,'clubs',clubId,'uitleningen'), {
        spelerId: p.id, vanTeam, vanTeamNaam, naarTeam, naarTeamNaam,
        overlay: {}, snapshot: bouwLeenSnapshot(p),
        door: S.user?.uid || null, gemaakt: serverTimestamp(),
      });
      huidigeContext.uitleningen.push({id:nieuweRef.id, spelerId:p.id, vanTeam, vanTeamNaam, naarTeam, naarTeamNaam, snapshot:bouwLeenSnapshot(p)});
      sluitModal(); toonWeerOp();
      meld(`${p.naam} uitgeleend aan ${naarTeamNaam}`);
      if (verversScherm) verversScherm();
    } catch(e){
      okBtn.disabled = false; okBtn.textContent = 'Uitlenen bevestigen';
      meld('Uitlenen mislukt: ' + (e.code||e.message));
    }
  };
}

/* ==================== NIVEAU 1 → 2 — Evaluaties ==================== */
function pinned(p){ return p.metingen.find(m => m.officieel) || null; }
function vorigeMeting(p, meting){ const i = p.metingen.indexOf(meting); return i > 0 ? p.metingen[i-1] : null; }

function renderEvaluatiesScherm(){
  zetKop('Evaluaties', renderDashboard);
  const inhoud = laag.querySelector('#bouwhubInhoud');
  const rijen = huidigeContext.teams.map(t => {
    const d = huidigeContext.data.get(t.id);
    const perSpeler = {};
    d.beoordelingen.forEach(b => { (perSpeler[b.spelerId] ||= []).push(b); });
    const spelersMetOfficieel = Object.values(perSpeler).filter(ms => ms.some(m=>m.officieel)).length;
    const totaalMetingen = d.beoordelingen.length;
    const extra = totaalMetingen - spelersMetOfficieel;
    return { team:t, officieel:spelersMetOfficieel, totaal:d.spelers.length, extra };
  }).sort((a,b) => (a.totaal ? a.officieel/a.totaal : 1) - (b.totaal ? b.officieel/b.totaal : 1));

  inhoud.innerHTML = `
    <div class="sectie-kop" style="margin-top:0">Halfjaarevaluatie · per team</div>
    ${rijen.map(r => {
      const ratio = r.totaal ? r.officieel/r.totaal : 0;
      const kleur = ratio===1 ? 'var(--ok)' : ratio<0.5 ? 'var(--uit)' : 'var(--warn)';
      return `<button class="lijst-item" data-bh-eval-team="${r.team.id}">
        <div class="team-shirt" style="background:${kleur};color:#12140f">${r.officieel}/${r.totaal}</div>
        <div class="li-tekst">
          <div class="titel">${esc(r.team.naam)}</div>
          <div class="meta">officiële evaluatie ingevuld${r.extra>0?` · +${r.extra} losse meting${r.extra===1?'':'en'}`:''}</div>
        </div>
        <span class="pijl">›</span>
      </button>`;
    }).join('')}`;
  inhoud.querySelectorAll('[data-bh-eval-team]').forEach(b => b.onclick = () => renderEvaluatieTeamDetail(b.dataset.bhEvalTeam));
}

function renderEvaluatieTeamDetail(teamId){
  const team = huidigeContext.teams.find(t => t.id === teamId);
  zetKop(team?.naam || 'Team', renderEvaluatiesScherm);
  const inhoud = laag.querySelector('#bouwhubInhoud');
  const d = huidigeContext.data.get(teamId);
  const perSpeler = {};
  d.beoordelingen.forEach(b => { (perSpeler[b.spelerId] ||= []).push(b); });
  const spelers = d.spelers.map(p => ({...p, metingen: (perSpeler[p.id]||[]).sort((a,b) => (a.datum||'').localeCompare(b.datum||''))}));

  const metData = spelers.filter(p => pinned(p));
  let radar = `<div style="color:var(--ink-2);font-size:calc(13px * var(--fs));padding:24px 0;text-align:center">Nog geen evaluaties in dit team.</div>`;
  if (metData.length){
    const gem = DOM.map(dom => metData.reduce((s,p) => s + (pinned(p).scores[dom]||0), 0) / metData.length);
    radar = `<div style="text-align:center">${radarSVG(gem, {size:170})}</div>`;
  }

  inhoud.innerHTML = `
    <div class="kaart">
      <div class="sectie-kop" style="margin:0 0 4px">Teamprofiel — halfjaarevaluatie</div>
      ${radar}
    </div>
    <div class="sectie-kop">Spelers</div>
    ${spelers.map(p => {
      const m = pinned(p);
      if (!m) return `<div class="lijst-item" style="cursor:default"><div class="li-tekst"><div class="titel">${esc(p.naam)}</div><div class="meta">nog niet geëvalueerd${p.metingen.length?` · ${p.metingen.length} losse meting${p.metingen.length===1?'':'en'}`:''}</div></div></div>`;
      const extra = p.metingen.length > 1 ? ` · ${p.metingen.length}×` : '';
      return `<button class="lijst-item" data-bh-open-profiel="${p.id}">
        <div class="li-tekst" style="flex:1">
          <div class="titel">${esc(p.naam)}${esc(extra)}</div>
          <div class="meta" style="display:flex;gap:5px;margin-top:4px">
            ${DOM.map(dom => `<span style="display:inline-flex;align-items:center;justify-content:center;background:${{1:'var(--uit)',2:'#F59C4A',3:'#F2C94C',4:'#7DCB6A',5:'var(--ok)'}[m.scores[dom]]||'var(--surface-2)'};color:#12140f;border-radius:6px;padding:2px 6px;font-size:11px;font-weight:700">${m.scores[dom]||'–'}</span>`).join('')}
          </div>
        </div>
        <span class="pijl">›</span>
      </button>`;
    }).join('')}`;
  inhoud.querySelectorAll('[data-bh-open-profiel]').forEach(b => {
    b.onclick = () => renderSpelerprofielScherm(teamId, spelers.find(x => x.id === b.dataset.bhOpenProfiel));
  });
}

function renderSpelerprofielScherm(teamId, p, actieveMeting){
  zetKop(p.naam, () => renderEvaluatieTeamDetail(teamId));
  const inhoud = laag.querySelector('#bouwhubInhoud');
  const m = actieveMeting || pinned(p) || p.metingen[p.metingen.length-1];
  const v = vorigeMeting(p, m);
  const historie = [...p.metingen].reverse();

  inhoud.innerHTML = `
    <div class="kaart" style="text-align:center">
      <div class="sectie-kop" style="margin:0 0 4px;text-align:left">${esc(m.bron?.label || 'meting')} · ${esc(m.datum||'')}</div>
      ${radarSVG(DOM.map(dom => m.scores[dom]||0), {size:170, compare: v ? DOM.map(dom => v.scores[dom]||0) : null})}
      ${v ? radarLegende(m.bron?.label||'huidig', v.bron?.label||'vorige') : ''}
    </div>
    ${historie.length > 1 ? `
      <div class="sectie-kop">Alle metingen dit seizoen</div>
      ${historie.map(x => `
        <div class="lijst-item" data-bh-meting="${p.metingen.indexOf(x)}" style="cursor:pointer${x===m?';border-left:3px solid var(--accent)':''}">
          <div class="li-tekst"><div class="titel">${esc(x.bron?.label||'Meting')}${x.officieel?' <span style="color:var(--accent);font-size:11px;font-weight:700">· HALFJAAR</span>':''}</div></div>
          <div class="meta">${esc(x.datum||'')}</div>
        </div>`).join('')}` : ''}`;

  inhoud.querySelectorAll('[data-bh-meting]').forEach(row => {
    row.onclick = () => renderSpelerprofielScherm(teamId, p, p.metingen[Number(row.dataset.bhMeting)]);
  });
}
