/* ==================== BOUW-HUB (coördinator) ====================
   Volledig scherm-overlay, geen eigen router-"view" — bewust, om de
   view-switching/terugknop-machinerie in main.js/teams.js niet aan te
   raken. Gebruikt uitsluitend bestaande CSS-klassen (.wo-achter/.wo-paneel
   voor het paneel, .segment voor tabs, .lijst-item voor rijen, .kaart,
   .avg-balk) — geen nieuwe stijlen nodig.

   FASE 1  : Teams-tab — tik op een team opent de ECHTE, bestaande teamhub.
   FASE 1c : Uitleningen-tab — overzicht van actieve uitleningen in de bouw
             + een speler cross-team uitlenen initiëren. Terugzetten en
             definitief overzetten kunnen nu ook rechtstreeks vanuit deze
             lijst (trekUitleningIn/definitiefOverzetten in teams-spelers.js
             zijn gegeneraliseerd om buiten teamcontext te werken).
   FASE 1d : Spelers-tab — rooster over alle teams in de bouw, met meest
             gespeelde posities + groei/daling-pijl (laatste 5 wedstrijden
             t.o.v. de rest). Tik op een speler → opent de ECHTE teamhub op
             zijn eigen profiel (via een nieuwe optionele parameter op
             openTeam() in teams.js).
   FASE 1e : Evaluaties-tab (dit deel) — voortgang van de officiële
             halfjaarevaluatie per team, plus teamprofiel (radar,
             gemiddelde) en een heatmap per speler. Tik op een speler voor
             het groei-profiel: de officiële meting met de voorgaande meting
             als gestippelde laag erachter, en de volledige tijdlijn.

   BESLIST (2026-09-18): Inzicht blijft beheerder-only. De onderliggende
   collecties (logins/gebruik/navpaden/gebruikstats) zijn niet per bouw
   in te delen zonder herstructurering, dus geen Inzicht-tab voor
   coördinatoren — geen rules-wijziging nodig, geen tab hier gebouwd. */
import { S, esc, meld, openModal, sluitModal, isBeheerder } from './state.js?v=20260902d';
import {
  db, collection, doc, getDoc, getDocs, addDoc, query, where, documentId, serverTimestamp
} from './firebase.js?v=20260811a';
import { BOUWEN, bouwNaam, SKILLS } from './config.js?v=20260902d';
import { ico } from './icons.js?v=20260825b';
import { bouwLeenSnapshot, trekUitleningIn, definitiefOverzetten } from './teams-spelers.js?v=20260918a';
import { telGebruik } from './tracker.js?v=20260902d';
import { analyseWedstrijd } from './analyse.js?v=20260905a';

let laag = null;          // DOM-referentie naar de overlay, één instantie tegelijk
let huidigeContext = null; // {clubId, bouw, teams} — cache zodat tab-switches niet steeds opnieuw ophalen

function bouwLaag(){
  if (laag) return laag;
  const el = document.createElement('div');
  el.className = 'wo-achter';
  el.id = 'bouwhubAchter';
  el.innerHTML = `
    <div class="wo-paneel" id="bouwhubPaneel">
      <div class="wo-topbar">
        <h2 id="bouwhubTitel">Bouw</h2>
        <button class="wo-sluit" id="bouwhubSluit" aria-label="Sluiten">${ico('navigation-close', 18) || '✕'}</button>
      </div>
      <div class="segment" id="bouwhubTabs">
        <button class="actief" data-bhtab="teams">Teams</button>
        <button data-bhtab="spelers">Spelers</button>
        <button data-bhtab="uitleningen">Uitleningen</button>
        <button data-bhtab="evaluaties">Evaluaties</button>
      </div>
      <div id="bouwhubInhoud"></div>
    </div>`;
  document.body.appendChild(el);
  el.addEventListener('click', e => { if (e.target === el) sluitBouwHub(); });
  el.querySelector('#bouwhubSluit').onclick = sluitBouwHub;
  el.querySelectorAll('#bouwhubTabs button').forEach(b => {
    b.onclick = () => {
      el.querySelectorAll('#bouwhubTabs button').forEach(x => x.classList.remove('actief'));
      b.classList.add('actief');
      renderTab(b.dataset.bhtab);
    };
  });
  laag = el;
  return el;
}

export function sluitBouwHub(){
  if (laag) laag.classList.remove('open');
}
/* Even wegklappen zonder de state te verliezen — gebruikt vlak vóór een
   openModal()-flow, want .modal-achter (z-index 50) zit ONDER .wo-achter
   (z-index 52): zonder dit zou de modal achter het paneel verdwijnen. */
function verbergTijdelijk(){ if (laag) laag.classList.remove('open'); }
function toonWeerOp(){ if (laag) laag.classList.add('open'); }

export async function openBouwHub(clubId, bouw){
  const el = bouwLaag();
  el.classList.add('open');
  el.querySelector('#bouwhubTitel').textContent = bouwNaam(bouw);
  el.querySelectorAll('#bouwhubTabs button').forEach(b => b.classList.toggle('actief', b.dataset.bhtab === 'teams'));

  const inhoud = el.querySelector('#bouwhubInhoud');
  inhoud.innerHTML = `<p style="font-size:calc(13px * var(--fs));color:var(--ink-2);text-align:center;padding:30px 0">Teams laden…</p>`;

  let teams = [];
  try {
    const snap = await getDocs(query(collection(db,'teams'), where('club','==',clubId), where('bouw','==',bouw)));
    teams = snap.docs.map(d => ({id:d.id, ...d.data()})).sort((a,b) => (a.naam||'').localeCompare(b.naam||''));
  } catch(e){
    inhoud.innerHTML = `<p style="font-size:calc(13px * var(--fs));color:var(--uit);text-align:center;padding:30px 0">Teams ophalen mislukt: ${esc(e.code||e.message)}</p>`;
    return;
  }
  huidigeContext = {clubId, bouw, teams};

  if (!teams.length){
    inhoud.innerHTML = `<div class="kaart leeg">Nog geen teams met dit bouw-veld gevonden.<br>Bestaande teams hebben mogelijk nog geen <code>bouw</code>-veld — zie de migratienotitie.</div>`;
    return;
  }
  renderTab('teams');
}

function renderTab(tab){
  if (!huidigeContext) return;
  if (tab === 'teams') renderTeamsTab();
  else if (tab === 'spelers') renderSpelersTab();
  else if (tab === 'evaluaties') renderEvaluatiesTab();
  else renderUitleningenTab();
}

/* ---------- Teams-tab ---------- */
function renderTeamsTab(){
  const { teams } = huidigeContext;
  const inhoud = laag.querySelector('#bouwhubInhoud');
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
      sluitBouwHub();
      const m = await import('./teams.js?v=20260918a');
      m.openTeam(b.dataset.bhOpenTeam);
    };
  });
}

/* ---------- Spelers-tab ---------- */
/* Posities komen uit dezelfde bron als spelerStats()/meestGespeeldePositie()
   in teams-spelers.js (analyseWedstrijd → lijn-tellingen), hier alleen
   over alle spelers van een team in één keer berekend i.p.v. per speler —
   dat scheelt N keer dezelfde wedstrijden ophalen. Trend: laatste 5
   wedstrijden vs. de rest, vergeleken op de belangrijkste positie. Bij
   minder dan 5 wedstrijden totaal wordt geen trend getoond (te weinig data
   om iets zinnigs over te zeggen). */
async function posititiesPerTeam(teamId){
  const wsnap = await getDocs(collection(db,'teams',teamId,'wedstrijden'));
  const wedstrijden = wsnap.docs.map(d => d.data()).filter(w => w.datum)
    .sort((a,b) => a.datum.localeCompare(b.datum));
  const RECENT_N = 5;
  const ouder = wedstrijden.slice(0, Math.max(0, wedstrijden.length - RECENT_N));
  const recent = wedstrijden.slice(Math.max(0, wedstrijden.length - RECENT_N));

  const tel = (lijst) => {
    const per = {}; // pid -> {positieNaam: n}
    let matches = 0;
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

  const resultaat = {}; // pid -> [{naam, trend}]
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

async function renderSpelersTab(){
  const { teams } = huidigeContext;
  const inhoud = laag.querySelector('#bouwhubInhoud');

  if (!huidigeContext.spelersCache){
    inhoud.innerHTML = `<p style="font-size:calc(13px * var(--fs));color:var(--ink-2);text-align:center;padding:30px 0">Spelers laden…</p>`;
    try {
      const alles = [];
      for (const t of teams){
        const [ssnap, posities] = await Promise.all([
          getDocs(collection(db,'teams',t.id,'spelers')),
          posititiesPerTeam(t.id),
        ]);
        ssnap.docs.forEach(d => {
          const p = {id:d.id, ...d.data()};
          if (p.gast || p._ingeleend) return; // gasten/ingeleende spelers horen niet bij dit team
          const top = posities[p.id] || (p.positie ? [{naam:p.positie, trend:null}] : []);
          alles.push({...p, teamId:t.id, teamNaam:t.naam, topPosities:top});
        });
      }
      alles.sort((a,b) => (a.naam||'').localeCompare(b.naam||''));
      huidigeContext.spelersCache = alles;
    } catch(e){
      inhoud.innerHTML = `<p style="font-size:calc(13px * var(--fs));color:var(--uit);text-align:center;padding:30px 0">Spelers ophalen mislukt: ${esc(e.code||e.message)}</p>`;
      return;
    }
  }
  tekenSpelersLijst(huidigeContext.spelersFilter || 'alle');
}

function tekenSpelersLijst(filterTeamId){
  huidigeContext.spelersFilter = filterTeamId;
  const { teams, spelersCache } = huidigeContext;
  const inhoud = laag.querySelector('#bouwhubInhoud');
  const items = filterTeamId === 'alle' ? spelersCache : spelersCache.filter(p => p.teamId === filterTeamId);

  const trendTeken = (t) => t === 'up' ? '<span style="color:var(--ok);font-weight:700">↑</span>'
    : t === 'down' ? '<span style="color:var(--uit);font-weight:700">↓</span>' : '';

  inhoud.innerHTML = `
    <div class="chips" style="display:flex;gap:8px;overflow-x:auto;margin-bottom:12px">
      <button class="knop klein ${filterTeamId==='alle'?'vol':'licht'}" data-bh-filter="alle" style="white-space:nowrap">Alle teams</button>
      ${teams.map(t => `<button class="knop klein ${filterTeamId===t.id?'vol':'licht'}" data-bh-filter="${t.id}" style="white-space:nowrap">${esc(t.naam)}</button>`).join('')}
    </div>
    ${items.length ? items.map(p => `
      <button class="lijst-item" data-bh-open-speler="${p.id}" data-bh-team="${p.teamId}">
        <div class="team-shirt">${p.nummer!=null&&p.nummer!==''?esc(String(p.nummer)):'?'}</div>
        <div class="li-tekst">
          <div class="titel">${esc(p.naam)}</div>
          <div class="meta">${esc(p.teamNaam)}${p.topPosities.length ? ' · ' + p.topPosities.map(x => esc(x.naam) + trendTeken(x.trend)).join(', ') : ''}</div>
        </div>
        <span class="pijl">›</span>
      </button>`).join('') : `<div class="kaart leeg">Geen spelers gevonden.</div>`}`;

  inhoud.querySelectorAll('[data-bh-filter]').forEach(b => b.onclick = () => tekenSpelersLijst(b.dataset.bhFilter));
  inhoud.querySelectorAll('[data-bh-open-speler]').forEach(b => {
    b.onclick = async () => {
      sluitBouwHub();
      const m = await import('./teams.js?v=20260918a');
      m.openTeam(b.dataset.bhTeam, 'spelers', {beoordeelProfiel: b.dataset.bhOpenSpeler});
    };
  });
}

/* ---------- Evaluaties-tab ---------- */
const DOM = SKILLS.map(s => s.id); // ['TE','TA','FY','ME','GE'], vaste volgorde voor de radar
const DOM_LABEL = Object.fromEntries(SKILLS.map(s => [s.id, s.kort]));

function radarSVG(values, {size=150, labels=true, color='var(--accent)', compare=null, compareColor='var(--ink-2)'} = {}){
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
    compareLaag = `<polygon points="${cpts}" fill="${compareColor}" fill-opacity=".12" stroke="${compareColor}" stroke-width="1.6" stroke-dasharray="4 3"/>`;
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
const KLEUR = {1:'var(--uit)', 2:'#F59C4A', 3:'#F2C94C', 4:'#7DCB6A', 5:'var(--ok)'};

function pinned(p){ return p.metingen.find(m => m.officieel) || null; }
function vorigeMeting(p, meting){
  const i = p.metingen.indexOf(meting);
  return i > 0 ? p.metingen[i-1] : null;
}

async function haalEvaluatieData(){
  const { teams } = huidigeContext;
  const perTeam = [];
  for (const t of teams){
    const [ssnap, bsnap] = await Promise.all([
      getDocs(collection(db,'teams',t.id,'spelers')),
      getDocs(collection(db,'teams',t.id,'beoordelingen')),
    ]);
    const roster = ssnap.docs.map(d => ({id:d.id, ...d.data()})).filter(p => !p.gast && !p._ingeleend);
    const beoordelingen = bsnap.docs.map(d => d.data()).filter(b => b.soort === 'volledig' && b.spelerId && b.scores);
    const spelers = roster.map(p => ({
      id: p.id, naam: p.naam,
      metingen: beoordelingen.filter(b => b.spelerId === p.id).sort((a,b) => (a.datum||'').localeCompare(b.datum||'')),
    }));
    perTeam.push({teamId:t.id, teamNaam:t.naam, spelers});
  }
  return perTeam;
}

async function renderEvaluatiesTab(){
  const inhoud = laag.querySelector('#bouwhubInhoud');
  if (!huidigeContext.evalCache){
    inhoud.innerHTML = `<p style="font-size:calc(13px * var(--fs));color:var(--ink-2);text-align:center;padding:30px 0">Evaluaties laden…</p>`;
    try { huidigeContext.evalCache = await haalEvaluatieData(); }
    catch(e){
      inhoud.innerHTML = `<p style="font-size:calc(13px * var(--fs));color:var(--uit);text-align:center;padding:30px 0">Evaluaties ophalen mislukt: ${esc(e.code||e.message)}</p>`;
      return;
    }
  }
  tekenEvaluatiesSub('voortgang');
}

function tekenEvaluatiesSub(sub){
  const inhoud = laag.querySelector('#bouwhubInhoud');
  inhoud.innerHTML = `
    <div class="segment">
      <button class="${sub==='voortgang'?'actief':''}" data-bh-evalsub="voortgang">Voortgang</button>
      <button class="${sub==='profielen'?'actief':''}" data-bh-evalsub="profielen">Profielen</button>
    </div>
    <div id="bhEvalInhoud"></div>`;
  inhoud.querySelectorAll('[data-bh-evalsub]').forEach(b => b.onclick = () => tekenEvaluatiesSub(b.dataset.bhEvalsub));
  if (sub === 'voortgang') tekenVoortgang(); else tekenProfielenTeamkeuze();
}

function tekenVoortgang(){
  const el = laag.querySelector('#bhEvalInhoud');
  const rijen = huidigeContext.evalCache.map(t => {
    const officieel = t.spelers.filter(p => pinned(p)).length;
    return {teamNaam:t.teamNaam, officieel, totaal:t.spelers.length};
  }).sort((a,b) => (a.totaal ? a.officieel/a.totaal : 1) - (b.totaal ? b.officieel/b.totaal : 1));
  el.innerHTML = `
    <div class="sectie-kop" style="margin-top:0">Halfjaarevaluatie · per team</div>
    ${rijen.map(r => {
      const ratio = r.totaal ? r.officieel/r.totaal : 0;
      const kleur = ratio===1 ? 'var(--ok)' : ratio<0.5 ? 'var(--uit)' : '#F59C4A';
      return `<div class="lijst-item" style="cursor:default">
        <div class="team-shirt" style="background:${kleur};color:#12140f">${r.officieel}/${r.totaal}</div>
        <div class="li-tekst"><div class="titel">${esc(r.teamNaam)}</div><div class="meta">officiële evaluatie ingevuld</div></div>
      </div>`;
    }).join('')}`;
}

function tekenProfielenTeamkeuze(){
  const el = laag.querySelector('#bhEvalInhoud');
  const eersteTeam = huidigeContext.evalCache[0]?.teamId;
  el.innerHTML = `
    <div class="chips" style="display:flex;gap:8px;overflow-x:auto;margin-bottom:12px">
      ${huidigeContext.evalCache.map((t,i) => `<button class="knop klein ${i===0?'vol':'licht'}" data-bh-pteam="${t.teamId}" style="white-space:nowrap">${esc(t.teamNaam)}</button>`).join('')}
    </div>
    <div id="bhProfielInhoud"></div>`;
  el.querySelectorAll('[data-bh-pteam]').forEach(b => {
    b.onclick = () => {
      el.querySelectorAll('[data-bh-pteam]').forEach(x => x.classList.replace('vol','licht'));
      b.classList.replace('licht','vol');
      tekenTeamprofiel(b.dataset.bhPteam);
    };
  });
  if (eersteTeam) tekenTeamprofiel(eersteTeam);
}

function tekenTeamprofiel(teamId){
  const team = huidigeContext.evalCache.find(t => t.teamId === teamId);
  const el = laag.querySelector('#bhProfielInhoud');
  if (!team){ el.innerHTML = ''; return; }
  const metData = team.spelers.filter(p => pinned(p));
  let radar = `<div style="color:var(--ink-2);font-size:calc(13px * var(--fs));padding:24px 0;text-align:center">Nog geen evaluaties in dit team.</div>`;
  if (metData.length){
    const gem = DOM.map(d => metData.reduce((s,p) => s + (pinned(p).scores[d]||0), 0) / metData.length);
    radar = `<div style="text-align:center">${radarSVG(gem, {size:170})}</div>`;
  }
  el.innerHTML = `
    <div class="kaart">
      <div class="sectie-kop" style="margin:0 0 4px">Teamprofiel — halfjaarevaluatie</div>
      ${radar}
    </div>
    <div class="sectie-kop">Spelers</div>
    ${team.spelers.map(p => {
      const m = pinned(p);
      if (!m) return `<div class="lijst-item" style="cursor:default"><div class="li-tekst"><div class="titel">${esc(p.naam)}</div><div class="meta">nog niet geëvalueerd</div></div></div>`;
      const extra = p.metingen.length > 1 ? ` · ${p.metingen.length}×` : '';
      return `<button class="lijst-item" data-bh-open-profiel="${teamId}|${p.id}">
        <div class="li-tekst" style="flex:1">
          <div class="titel">${esc(p.naam)}${esc(extra)}</div>
          <div class="meta" style="display:flex;gap:5px;margin-top:4px">
            ${DOM.map(d => `<span class="cel" style="background:${KLEUR[m.scores[d]]};color:#12140f;border-radius:6px;padding:2px 6px;font-size:11px;font-weight:700">${m.scores[d]||'–'}</span>`).join('')}
          </div>
        </div>
        <span class="pijl">›</span>
      </button>`;
    }).join('')}`;
  el.querySelectorAll('[data-bh-open-profiel]').forEach(b => {
    b.onclick = () => {
      const [tid, pid] = b.dataset.bhOpenProfiel.split('|');
      tekenSpelerprofiel(tid, pid);
    };
  });
}

function tekenSpelerprofiel(teamId, pid, actieveMeting){
  const team = huidigeContext.evalCache.find(t => t.teamId === teamId);
  const p = team?.spelers.find(x => x.id === pid);
  const inhoud = laag.querySelector('#bouwhubInhoud');
  if (!p) return;
  const m = actieveMeting || pinned(p) || p.metingen[p.metingen.length-1];
  const v = vorigeMeting(p, m);
  const historie = [...p.metingen].reverse();

  inhoud.innerHTML = `
    <button class="knop licht klein" id="bhProfielTerug" style="margin-bottom:10px">‹ Terug</button>
    <div class="kaart" style="text-align:center">
      <div class="sectie-kop" style="margin:0 0 4px;text-align:left">${esc(p.naam)} — ${esc(m.bron?.label || 'meting')} · ${esc(m.datum||'')}</div>
      ${radarSVG(DOM.map(d => m.scores[d]||0), {size:170, compare: v ? DOM.map(d => v.scores[d]||0) : null})}
      ${v ? radarLegende(m.bron?.label||'huidig', v.bron?.label||'vorige') : ''}
    </div>
    ${historie.length > 1 ? `
      <div class="sectie-kop">Alle metingen dit seizoen</div>
      ${historie.map(x => `
        <div class="lijst-item" data-bh-meting="${p.metingen.indexOf(x)}" style="cursor:pointer${x===m?';border-left:3px solid var(--accent)':''}">
          <div class="li-tekst"><div class="titel">${esc(x.bron?.label||'Meting')}${x.officieel?' <span style="color:var(--accent);font-size:11px;font-weight:700">· HALFJAAR</span>':''}</div></div>
          <div class="meta">${esc(x.datum||'')}</div>
        </div>`).join('')}` : ''}`;

  inhoud.querySelector('#bhProfielTerug').onclick = () => tekenTeamprofiel(teamId);
  inhoud.querySelectorAll('[data-bh-meting]').forEach(row => {
    row.onclick = () => tekenSpelerprofiel(teamId, pid, p.metingen[Number(row.dataset.bhMeting)]);
  });
}

/* ---------- Uitleningen-tab ---------- */
async function renderUitleningenTab(){
  const { clubId, teams } = huidigeContext;
  const inhoud = laag.querySelector('#bouwhubInhoud');
  inhoud.innerHTML = `<p style="font-size:calc(13px * var(--fs));color:var(--ink-2);text-align:center;padding:30px 0">Uitleningen laden…</p>`;

  const teamIds = new Set(teams.map(t => t.id));
  const teamNaam = id => teams.find(t => t.id === id)?.naam || null;
  const bouwPerTeam = Object.fromEntries(teams.map(t => [t.id, t.bouw]));

  let leningen = [];
  try {
    // Geen where()-filter: de rules laten toch alleen leningen door waar de
    // coördinator (via isTeamMember) bij het bron- of doelteam mag — voor
    // een club van deze omvang is één ongefilterde read prima.
    const snap = await getDocs(collection(db,'clubs',clubId,'uitleningen'));
    leningen = snap.docs.map(d => ({id:d.id, ...d.data()}))
      .filter(u => teamIds.has(u.vanTeam) || teamIds.has(u.naarTeam));
  } catch(e){
    inhoud.innerHTML = `<p style="font-size:calc(13px * var(--fs));color:var(--uit);text-align:center;padding:30px 0">Uitleningen ophalen mislukt: ${esc(e.code||e.message)}</p>`;
    return;
  }

  // [20260919] Voor een betrouwbare "Definitief"-knop moeten we de bouw van
  // BEIDE teams kennen, niet alleen die van de huidige bouw-context — anders
  // bieden we een actie aan die serverside alsnog kan mislukken (cross-bouw,
  // coördinator van maar één kant). Teams buiten deze bouw ontbreken nog in
  // bouwPerTeam; die er in één keer bij fetchen.
  const onbekend = [...new Set(leningen.flatMap(u => [u.vanTeam, u.naarTeam]))].filter(id => id && !(id in bouwPerTeam));
  for (let i=0; i<onbekend.length; i+=30){
    const chunk = onbekend.slice(i, i+30);
    try {
      const tsnap = await getDocs(query(collection(db,'teams'), where(documentId(),'in',chunk)));
      tsnap.docs.forEach(d => { bouwPerTeam[d.id] = d.data().bouw || null; });
    } catch(e){ /* ontbrekend team → hieronder valt het terug op "geen toegang" */ }
  }
  const eigenTeamIds = new Set((S.teams||[]).map(t => t.id));
  const coordBouwen = new Set((S.coordinatorBouwen||[]).map(b => b.bouw));
  const magTeam = (teamId) => isBeheerder() || eigenTeamIds.has(teamId) || coordBouwen.has(bouwPerTeam[teamId]);

  // Signaal: een team dat binnen de bouw structureel uitleent zonder ooit
  // te ontvangen (of andersom) — vroeg opgemerkt is makkelijker bij te sturen.
  const uitPerTeam = {}, inPerTeam = {};
  leningen.forEach(u => {
    if (teamIds.has(u.vanTeam)) uitPerTeam[u.vanTeam] = (uitPerTeam[u.vanTeam]||0) + 1;
    if (teamIds.has(u.naarTeam)) inPerTeam[u.naarTeam] = (inPerTeam[u.naarTeam]||0) + 1;
  });
  const signalen = Object.entries(uitPerTeam)
    .filter(([tid,n]) => n >= 2 && !inPerTeam[tid])
    .map(([tid,n]) => `<b>${esc(teamNaam(tid)||'?')}</b> leende dit seizoen ${n}× uit en ontving nog niet terug.`);

  inhoud.innerHTML = `
    <button class="knop vol" id="bhNieuweUitlening" style="margin-top:2px">+ Speler uitlenen</button>
    ${signalen.length ? `<div class="avg-balk">${ico('action-info',17) || ''}<span>${signalen.join('<br>')}</span></div>` : ''}
    <div class="sectie-kop">Actief · ${leningen.length}</div>
    ${leningen.length ? leningen.map(u => {
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
      const u = leningen.find(x => x.id === b.dataset.bhTerug);
      const ok = await trekUitleningIn(u, clubId);
      if (ok) renderUitleningenTab();
    };
  });
  inhoud.querySelectorAll('[data-bh-definitief]').forEach(b => {
    b.onclick = async () => {
      const u = leningen.find(x => x.id === b.dataset.bhDefinitief);
      const ok = await definitiefOverzetten(u, clubId, huidigeContext.bouw);
      if (ok){ delete huidigeContext.spelersCache; delete huidigeContext.evalCache; renderUitleningenTab(); }
    };
  });

  inhoud.querySelector('#bhNieuweUitlening').onclick = () => modalNieuweUitleningVanuitBouw();
}

/* Cross-team uitleen-flow: in tegenstelling tot de reguliere modalUitlenen()
   (die uitgaat van "ik ben coach van het bronteam") kiest de coördinator
   hier zowel het bron- als het doelteam. Sluit het bouw-paneel eerst even
   weg (z-index van .modal-achter ligt onder .wo-achter). */
async function modalNieuweUitleningVanuitBouw(){
  const { clubId, teams } = huidigeContext;
  verbergTijdelijk();

  openModal(`
    <h2>Speler uitlenen</h2>
    <div class="veldgroep"><label>Vanuit welk team (in deze bouw)?</label>
      <select class="invoer" id="bhUlVanTeam"><option value="">Kies een team…</option>
        ${teams.map(t => `<option value="${t.id}">${esc(t.naam)}</option>`).join('')}
      </select></div>
    <div class="veldgroep"><label>Welke speler?</label>
      <select class="invoer" id="bhUlSpeler" disabled><option value="">Kies eerst een team…</option></select></div>
    <div class="veldgroep"><label>Aan welk team?</label>
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
      const snap = await getDocs(collection(db,'teams',vanTeam,'spelers'));
      const spelers = snap.docs.map(d => ({id:d.id, ...d.data()}))
        .filter(p => !p.gast && !p._ingeleend)
        .sort((a,b) => (a.naam||'').localeCompare(b.naam||''));
      spelerSel.innerHTML = spelers.length
        ? '<option value="">Kies een speler…</option>' + spelers.map(p => `<option value="${p.id}">${esc(p.naam)}${p.nummer!=null&&p.nummer!==''?' · #'+esc(p.nummer):''}</option>`).join('')
        : '<option value="">Geen spelers gevonden</option>';
      spelerSel.disabled = !spelers.length;
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
      await addDoc(collection(db,'clubs',clubId,'uitleningen'), {
        spelerId: p.id, vanTeam, vanTeamNaam, naarTeam, naarTeamNaam,
        overlay: {}, snapshot: bouwLeenSnapshot(p),
        door: S.user?.uid || null, gemaakt: serverTimestamp(),
      });
      sluitModal(); toonWeerOp();
      meld(`${p.naam} uitgeleend aan ${naarTeamNaam}`);
      renderUitleningenTab();
    } catch(e){
      okBtn.disabled = false; okBtn.textContent = 'Uitlenen bevestigen';
      meld('Uitlenen mislukt: ' + (e.code||e.message));
    }
  };
}
