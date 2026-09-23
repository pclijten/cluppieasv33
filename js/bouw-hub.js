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
import { S, esc, meld, openModal, sluitModal, isBeheerder } from './state.js?v=20260922c';
import {
  db, collection, doc, getDoc, getDocs, addDoc, query, where, documentId, serverTimestamp
} from './firebase.js?v=20260922c';
import { BOUWEN, bouwNaam, SKILLS, SEIZOEN_FALLBACK, TEAM_CATEGORIEEN, niveauKleur } from './config.js?v=20260922c';
import { ico } from './icons.js?v=20260922c';
import { bouwLeenSnapshot, trekUitleningIn, definitiefOverzetten } from './teams-spelers.js?v=20260923d';
import { telGebruik } from './tracker.js?v=20260922c';
import { analyseWedstrijd } from './analyse.js?v=20260922c';
import { opkomstVoor, MIN_OPKOMST_TRAININGEN } from './opkomst.js?v=20260922c';

let laag = null;           // DOM-referentie naar de pagina, één instantie tegelijk
let huidigeContext = null; // {clubId, bouw, teams, data: Map(teamId -> {...}), uitleningen}
let terugPil = null;       // zwevend "↩ Terug naar {bouw}"-knopje, buiten de pagina

/* ==================== Paginaskelet ====================
   [20260921] Op verzoek van Paul geen "popup" meer (dim-achtergrond + los
   zwevend paneel), maar een echte volledige pagina — zelfde opmaak als
   club-hub/teamhub (.kop/.terug, effen achtergrond, volle hoogte). Eigen,
   bij body geplaatst element (geen router-integratie nodig), maar visueel
   niet meer te onderscheiden van een "echt" scherm. z-index bewust ONDER
   .modal-achter (50) — zo stapelt een normale openModal()-sheet (bv. bij
   het uitlenen) daar vanzelf overheen, zonder trucjes. */
function bouwLaag(){
  if (laag) return laag;
  const el = document.createElement('div');
  el.id = 'bouwhubPagina';
  el.style.cssText = 'position:fixed;inset:0;z-index:45;background:var(--bg);display:none;overflow-y:auto;-webkit-overflow-scrolling:touch;';
  el.innerHTML = `
    <div style="max-width:var(--app-w,540px);margin:0 auto;min-height:100%;padding:16px 16px 96px;box-sizing:border-box;">
      <div class="kop">
        <button class="terug" id="bouwhubTerugStap">‹</button>
        <h1 id="bouwhubTitel">Bouw</h1>
        <button class="terug" id="bouwhubInstellingen" style="display:none" aria-label="Dashboard-onderdelen">${ico('navigation-settings',19)}</button>
      </div>
      <div id="bouwhubInhoud"></div>
    </div>`;
  document.body.appendChild(el);
  laag = el;
  return el;
}
export function sluitBouwHub(){ if (laag) laag.style.display = 'none'; }

/* Titel + terug-knop. Op het dashboard (niveau 0) gaat de terug-knop naar
   de teamsoverzicht-pagina zelf (de pagina volledig sluiten) — overal
   daaronder gaat hij naar het opgegeven scherm. Het instellingen-tandwiel
   rechts is alleen zichtbaar op het dashboard zelf (toonInstellingen=true). */
function zetKop(titel, terugFn, toonInstellingen){
  laag.querySelector('#bouwhubTitel').textContent = titel;
  laag.querySelector('#bouwhubTerugStap').onclick = terugFn || sluitBouwHub;
  const instelKnop = laag.querySelector('#bouwhubInstellingen');
  instelKnop.style.display = toonInstellingen ? '' : 'none';
  instelKnop.onclick = toonInstellingen ? openWidgetInstellingen : null;
}

/* ==================== Instellingen: welke onderdelen op de teamkaart ====================
   [20260922] Op verzoek van Paul: zelf kunnen kiezen welke onderdelen op
   elke teamkaart staan. Puur een weergavevoorkeur (geen teamdata), dus
   bewust in localStorage i.p.v. Firestore — geldt per toestel, geen
   rules/sync nodig. Alles staat standaard AAN. */
const WIDGET_DEFS = [
  { id:'sportlink',         label:'Laatste Sportlink-uitslag + vorm' },
  { id:'presentieTraining', label:'Presentie — trainingen' },
  { id:'presentieWedstrijd',label:'Presentie — wedstrijden' },
  { id:'evalRadar',         label:'Evaluatie-radar (gemiddelde + laatste)' },
  { id:'evalVoortgang',     label:'Evaluatie-voortgang (najaar)' },
  { id:'teamEval',          label:'Teamevaluaties (na de wedstrijd)' },
  { id:'uitleningen',       label:'Uitleningen die dit team raken' },
];
const WIDGET_KEY = 'cluppieBouwhubWidgets';
function widgetVoorkeuren(){
  let opgeslagen = {};
  try { opgeslagen = JSON.parse(localStorage.getItem(WIDGET_KEY) || '{}'); } catch(e){ /* negeren, alles blijft aan */ }
  const v = {};
  WIDGET_DEFS.forEach(w => { v[w.id] = opgeslagen[w.id] !== false; });
  return v;
}
function openWidgetInstellingen(){
  const huidig = widgetVoorkeuren();
  openModal(`
    <h2>Dashboard-onderdelen</h2>
    <p style="font-size:calc(13px * var(--fs));color:var(--ink-2);margin-bottom:8px">Kies welke onderdelen je op elke teamkaart wilt zien. Geldt alleen op dit toestel.</p>
    ${WIDGET_DEFS.map(w => `
      <label style="display:flex;align-items:center;gap:11px;padding:11px 0;border-bottom:1px solid var(--surface-2)">
        <input type="checkbox" data-bh-w="${w.id}" ${huidig[w.id]?'checked':''} style="width:19px;height:19px;flex-shrink:0;accent-color:var(--accent)">
        <span style="font-size:calc(14px * var(--fs))">${esc(w.label)}</span>
      </label>`).join('')}
    <button class="knop vol" id="mWidgetOk" style="margin-top:16px">Klaar</button>`);
  document.getElementById('mWidgetOk').onclick = () => {
    const v = {};
    document.querySelectorAll('[data-bh-w]').forEach(cb => { v[cb.dataset.bhW] = cb.checked; });
    try { localStorage.setItem(WIDGET_KEY, JSON.stringify(v)); } catch(e){ /* privé-modus e.d. — negeren */ }
    sluitModal();
    renderDashboard();
  };
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

/* ==================== Data ophalen (één keer per team) ====================
   [20260921] Elke deel-fetch heeft nu zijn eigen catch die duidelijk logt
   WELK team en WELKE subcollectie faalde — zonder dat had de generieke
   "Gegevens ophalen mislukt"-melding geen aanknopingspunt in de console.
   [20260922] Wedstrijden/presentie/beoordelingen/teamevaluaties worden nu
   gefilterd op het HUIDIGE seizoen i.p.v. de volledige historie van het
   team op te halen — bij meerdere seizoenen scheelde dat flink in
   laadtijd. Ook teamevaluaties (na de wedstrijd, apart van de losse
   spelersbeoordelingen) worden nu meegenomen — die ontbraken volledig. */
async function haalTeamData(team, seizoen){
  const veilig = async (label, promise) => {
    try { return await promise; }
    catch(e){
      console.error(`[Cluppie] bouw-hub: "${label}" ophalen mislukt voor team ${team.naam} (${team.id}):`, e.code, e.message);
      throw e;
    }
  };
  const [ssnap, wsnap, psnap, poulesnap, uitslagensnap, bsnap, tesnap] = await Promise.all([
    veilig('spelers', getDocs(collection(db,'teams',team.id,'spelers'))),
    veilig('wedstrijden', getDocs(query(collection(db,'teams',team.id,'wedstrijden'), where('seizoen','==',seizoen)))),
    veilig('presentie', getDocs(query(collection(db,'teams',team.id,'presentie'), where('seizoen','==',seizoen)))),
    veilig('poule/stand', getDoc(doc(db,'teams',team.id,'poule','stand'))),
    veilig('poule/uitslagen', getDoc(doc(db,'teams',team.id,'poule','uitslagen'))),
    veilig('beoordelingen', getDocs(query(collection(db,'teams',team.id,'beoordelingen'), where('seizoen','==',seizoen)))),
    veilig('teamevaluaties', getDocs(query(collection(db,'teams',team.id,'teamevaluaties'), where('seizoen','==',seizoen)))),
  ]);
  const spelers = ssnap.docs.map(d => ({id:d.id, ...d.data()})).filter(p => !p.gast && !p._ingeleend);
  const wedstrijden = wsnap.docs.map(d => ({id:d.id, ...d.data()})).filter(w => w.datum).sort((a,b) => a.datum.localeCompare(b.datum));
  const presentie = psnap.docs.map(d => ({id:d.id, ...d.data()})).filter(s => s.datum);
  const stand = poulesnap.exists() ? poulesnap.data() : null;
  const uitslagen = uitslagensnap.exists() ? uitslagensnap.data() : null;
  // NIET meer filteren op soort==='volledig': een team kan ook "snelle"
  // beoordelingen hebben (tussendoor bij een wedstrijd/training, zonder de
  // 5-domeinen-structuur) — die moeten wél zichtbaar zijn in het
  // evaluatie-overzicht, ook al passen ze niet in de radar (die heeft de
  // domeinscores nodig en werkt dus verderop alsnog alleen met 'volledig').
  const beoordelingen = bsnap.docs.map(d => ({id:d.id, ...d.data()})).filter(b => b.spelerId && (b.scores || b.niveau != null));
  const teamevaluaties = tesnap.docs.map(d => ({id:d.id, ...d.data()})).filter(e => e.scores);
  return { spelers, wedstrijden, presentie, stand, uitslagen, beoordelingen, teamevaluaties };
}

export async function openBouwHub(clubId, bouw, isHerbezoek){
  const el = bouwLaag();
  el.style.display = 'block';
  verbergTerugPil();

  // Herbezoek via de terug-pil met dezelfde bouw → cache hergebruiken, geen herfetch.
  if (isHerbezoek && huidigeContext && huidigeContext.clubId === clubId && huidigeContext.bouw === bouw){
    renderDashboard();
    return;
  }

  zetKop(bouwNaam(bouw), null);
  const inhoud = el.querySelector('#bouwhubInhoud');
  inhoud.innerHTML = `<p style="font-size:calc(13px * var(--fs));color:var(--ink-2);text-align:center;padding:30px 0">Dashboard laden…</p>`;

  let teams = [], seizoen = SEIZOEN_FALLBACK;
  try {
    // Teams-query en het huidige seizoen van de club tegelijk ophalen i.p.v.
    // na elkaar — scheelt één rondje wachten bij elke keer openen.
    const [snap, clubSnap] = await Promise.all([
      getDocs(query(collection(db,'teams'), where('club','==',clubId), where('bouw','==',bouw))),
      getDoc(doc(db,'clubs',clubId)),
    ]);
    teams = snap.docs.map(d => ({id:d.id, ...d.data()})).sort((a,b) => (a.naam||'').localeCompare(b.naam||''));
    seizoen = clubSnap.exists() ? (clubSnap.data().huidigSeizoen || SEIZOEN_FALLBACK) : SEIZOEN_FALLBACK;
  } catch(e){
    console.error('[Cluppie] bouw-hub: teams ophalen mislukt:', e.code, e.message);
    inhoud.innerHTML = `<p style="font-size:calc(13px * var(--fs));color:var(--uit);text-align:center;padding:30px 0">Teams ophalen mislukt: ${esc(e.code||e.message)}</p>`;
    return;
  }
  if (!teams.length){
    inhoud.innerHTML = `<div class="kaart leeg">Nog geen teams met dit bouw-veld gevonden.<br>Bestaande teams hebben mogelijk nog geen <code>bouw</code>-veld — zie de migratienotitie.</div>`;
    huidigeContext = {clubId, bouw, teams: [], data: new Map(), uitleningen: []};
    return;
  }

  try {
    // Teamdata van alle teams ÉN de club-uitleningen tegelijk ophalen i.p.v.
    // de uitleningen pas na afloop van alle teamdata op te halen.
    const [dataLijst, usnap] = await Promise.all([
      Promise.all(teams.map(t => haalTeamData(t, seizoen))),
      getDocs(collection(db,'clubs',clubId,'uitleningen')),
    ]);
    const data = new Map(teams.map((t,i) => [t.id, dataLijst[i]]));
    const teamIds = new Set(teams.map(t => t.id));
    const uitleningen = usnap.docs.map(d => ({id:d.id, ...d.data()})).filter(u => teamIds.has(u.vanTeam) || teamIds.has(u.naarTeam));
    huidigeContext = {clubId, bouw, teams, data, uitleningen, seizoen};
  } catch(e){
    console.error('[Cluppie] bouw-hub: dashboard-data ophalen mislukt:', e.code, e.message);
    inhoud.innerHTML = `<p style="font-size:calc(13px * var(--fs));color:var(--uit);text-align:center;padding:30px 0">Gegevens ophalen mislukt: ${esc(e.code||e.message)}</p>`;
    return;
  }
  renderDashboard();
}

/* [20260923c] Zelfde gegevens als openBouwHub, maar zonder het overlay-scherm:
   voor de desktop-bouwomgeving (desktop-bouw.js). Zet huidigeContext, zodat de
   berekeningen hieronder en modalNieuweUitleningVanuitBouw gewoon werken. */
export async function laadBouwData(clubId, bouw){
  /* [20260923d] Eigen bouw (clubs/{id}.eigenBouwen): alle teams van de club
     ophalen en filteren op de gekoppelde team-id's. Standaardbouw: zoals voorheen. */
  const standaard = BOUWEN.some(b => b.id === bouw);
  const [snap, clubSnap] = await Promise.all([
    getDocs(standaard ? query(collection(db,'teams'), where('club','==',clubId), where('bouw','==',bouw))
                      : query(collection(db,'teams'), where('club','==',clubId))),
    getDoc(doc(db,'clubs',clubId)),
  ]);
  const eigen = standaard ? null : ((clubSnap.exists() ? clubSnap.data().eigenBouwen : null) || []).find(b => b.id === bouw);
  const teams = snap.docs.map(d => ({id:d.id, ...d.data()})).filter(t => standaard || (eigen?.teams || []).includes(t.id)).sort((a,b) => (a.naam||'').localeCompare(b.naam||'', 'nl', {numeric:true}));
  const seizoen = clubSnap.exists() ? (clubSnap.data().huidigSeizoen || SEIZOEN_FALLBACK) : SEIZOEN_FALLBACK;
  const [dataLijst, usnap] = await Promise.all([
    Promise.all(teams.map(t => haalTeamData(t, seizoen))),
    getDocs(collection(db,'clubs',clubId,'uitleningen')),
  ]);
  const data = new Map(teams.map((t,i) => [t.id, dataLijst[i]]));
  const teamIds = new Set(teams.map(t => t.id));
  const uitleningen = usnap.docs.map(d => ({id:d.id, ...d.data()})).filter(u => teamIds.has(u.vanTeam) || teamIds.has(u.naarTeam));
  huidigeContext = {clubId, bouw, teams, data, uitleningen, seizoen};
  return huidigeContext;
}
export function zetBouwContext(ctx){ huidigeContext = ctx; }

/* ==================== Berekeningen op de cache ==================== */
function teamNaam(id){ return huidigeContext.teams.find(t => t.id === id)?.naam || '?'; }

export function presentiePctTeam(team){
  const d = huidigeContext.data.get(team.id);
  if (!d.presentie.length || !d.spelers.length) return null;
  const pcts = d.spelers.map(p => opkomstVoor(p, d.presentie)).filter(o => o.totaal >= MIN_OPKOMST_TRAININGEN).map(o => o.pct);
  if (!pcts.length) return null;
  return Math.round(pcts.reduce((s,x) => s+x, 0) / pcts.length);
}

/* [20260922] Presentie bij WEDSTRIJDEN — een aparte metriek van
   trainingspresentie hierboven. Er is geen los "aanwezig/afwezig"-veld per
   wedstrijd; de selectie ZELF is dat al (een coach haalt een afwezige
   speler eruit). Percentage = gemiddeld over alle daadwerkelijk gespeelde
   wedstrijden (kwarten>0) van selectiegrootte t.o.v. het volledige team. */
export function presentiePctWedstrijdTeam(team){
  const d = huidigeContext.data.get(team.id);
  if (!d.spelers.length) return null;
  // Oudere wedstrijden hebben soms nog geen selectie-veld (van vóór die
  // functionaliteit) — die tellen niet mee als "0% aanwezig", maar worden
  // gewoon overgeslagen; er is dan simpelweg geen data voor die wedstrijd.
  const gespeeld = d.wedstrijden.filter(w => (analyseWedstrijd(w).kwarten||0) > 0 && Array.isArray(w.selectie));
  if (!gespeeld.length) return null;
  const pcts = gespeeld.map(w => Math.min(100, Math.round(w.selectie.length / d.spelers.length * 100)));
  return Math.round(pcts.reduce((s,x) => s+x, 0) / pcts.length);
}

/* [20260921] Herschreven om de ECHTE Sportlink-uitslagen te gebruiken
   (teams/{id}/poule/uitslagen) i.p.v. alleen wat er zelf in de app is
   gelogd — dat laatste dekte maar een deel van de wedstrijden en miste dus
   regelmatig doelpunten/uitslagen die Sportlink wél had. */
export function uitslagenTeam(team){
  const d = huidigeContext.data.get(team.id);
  const eigenRij = d.stand?.rijen?.find(r => r.eigen) || null;
  const eigenNaam = eigenRij?.team || null;
  const gespeeld = (d.uitslagen?.rijen || [])
    .filter(r => r.eigenErin && r.uitslag && eigenNaam)
    .map(r => {
      const [a, b] = String(r.uitslag).split('-').map(x => parseInt(x, 10));
      const thuis = r.thuis === eigenNaam;
      const voor = thuis ? a : b, tegen = thuis ? b : a;
      return { datum: r.datum, tegenstander: thuis ? r.uit : r.thuis, voor, tegen, thuis };
    })
    .filter(r => Number.isFinite(r.voor) && Number.isFinite(r.tegen))
    .sort((x,y) => (x.datum||'').localeCompare(y.datum||''));
  let w=0, g=0, v=0, voorTot=0, tegenTot=0;
  gespeeld.forEach(r => {
    voorTot += r.voor; tegenTot += r.tegen;
    if (r.voor > r.tegen) w++; else if (r.voor < r.tegen) v++; else g++;
  });
  const vorm = gespeeld.slice(-5).map(r => r.voor > r.tegen ? 'w' : r.voor < r.tegen ? 'v' : 'g');
  const laatste = gespeeld[gespeeld.length - 1] || null;
  // [20260922] "lijst" toegevoegd (naast het bestaande aantal) zodat een
  // apart scherm alle bekende uitslagen kan tonen i.p.v. alleen de laatste.
  return { w, g, v, voor: voorTot, tegen: tegenTot, gespeeld: gespeeld.length, laatste, vorm, lijst: gespeeld, stand: eigenRij, totaalTeams: d.stand?.rijen?.length || null };
}

/* Eén "cijfer" voor een meting, ongeacht het type: bij een volledige
   evaluatie het gemiddelde van de 5 domeinen, bij een snelle beoordeling
   gewoon het niveau (dezelfde 1–5-schaal, alleen zonder domein-uitsplitsing). */
function cijferVan(m){
  if (m.scores) return DOM.reduce((s,d) => s + (m.scores[d]||0), 0) / DOM.length;
  if (m.niveau != null) return m.niveau;
  return null;
}
/* Meest recente 2 metingen van een speler (volledig óf snel, door elkaar op
   datum gesorteerd) → cijfer + trend t.o.v. de voorgaande meting. */
function cijferSpeler(p, beoordelingen){
  const metingen = beoordelingen.filter(b => b.spelerId === p.id && cijferVan(b) != null)
    .sort((a,b) => (a.datum||'').localeCompare(b.datum||''));
  if (!metingen.length) return null;
  const laatste = metingen[metingen.length-1];
  const vorige = metingen[metingen.length-2];
  const cijfer = cijferVan(laatste);
  let trend = null;
  if (vorige){
    const vorigCijfer = cijferVan(vorige);
    if (cijfer > vorigCijfer + 0.15) trend = 'up';
    else if (cijfer < vorigCijfer - 0.15) trend = 'down';
  }
  return { cijfer: Math.round(cijfer*10)/10, trend };
}


const DOM = SKILLS.map(s => s.id);
const DOM_LABEL = Object.fromEntries(SKILLS.map(s => [s.id, s.kort]));

// [20260922] Gefixt: gebruikte alleen officiële (halfjaar)evaluaties, dus
// een team met uitsluitend losse-maar-wél-volledige (5-domeinen) metingen
// toonde hier "nog geen evaluaties" terwijl er gewoon data was. Nu: per
// speler zijn laatste VOLLEDIGE meting (met domeinscores), ongeacht of hij
// als officiële halfjaarevaluatie is aangevinkt.
function teamRadarGemiddelde(team){
  const d = huidigeContext.data.get(team.id);
  const perSpeler = {}; // spelerId -> laatste volledige meting (chronologisch)
  [...d.beoordelingen].filter(b => b.scores).sort((a,b) => (a.datum||'').localeCompare(b.datum||''))
    .forEach(b => { perSpeler[b.spelerId] = b; });
  const metingen = Object.values(perSpeler);
  if (!metingen.length) return null;
  return DOM.map(dom => metingen.reduce((s,m) => s + (m.scores[dom]||0), 0) / metingen.length);
}

/* [20260922] Teamevaluaties (na de wedstrijd, 8 categorieën) — een compleet
   ANDERE collectie dan de losse spelersbeoordelingen hierboven, die tot nu
   toe nergens in dit dashboard terugkwam. Geeft geen radar (andere
   assen/aantal categorieën dan de 5-domeinen speler-radar, en radarSVG is
   daar hard op gebouwd) maar wel een duidelijk cijfer + telling. */
export function teamEvalStatsTeam(team){
  const d = huidigeContext.data.get(team.id);
  const evals = d.teamevaluaties || [];
  if (!evals.length) return null;
  const laatste = [...evals].sort((a,b) => (a.datum||'').localeCompare(b.datum||'')).pop();
  const gemPerCat = TEAM_CATEGORIEEN.map(c => {
    const vals = evals.map(e => e.scores?.[c.id]).filter(v => v != null);
    return vals.length ? vals.reduce((s,x)=>s+x,0)/vals.length : null;
  }).filter(v => v != null);
  const gemiddeld = gemPerCat.length ? gemPerCat.reduce((s,x)=>s+x,0)/gemPerCat.length : null;
  const laatsteVals = Object.values(laatste.scores||{});
  const laatsteGem = laatsteVals.length ? laatsteVals.reduce((s,x)=>s+x,0)/laatsteVals.length : null;
  return { count: evals.length, gemiddeld, laatsteGem, laatsteTegenstander: laatste.tegenstander||'', laatsteDatum: laatste.datum||'' };
}

// Korte assenlabels voor de 8-categorieën teamevaluatie-radar — TEAM_CATEGORIEEN
// zelf heeft alleen de volledige naam (te lang voor 8 assen op een kleine radar).
const TEAM_CAT_KORT = {
  inzet:'Inzet', samenwerking:'Samen', taken:'Taken', opbouw:'Opbouw',
  omschakeling:'Omschak.', druk:'Druk', plezier:'Plezier', coachbaar:'Coachb.',
};
function teamEvalRadarWaarden(evals){
  return TEAM_CATEGORIEEN.map(c => {
    const vals = evals.map(e => e.scores?.[c.id]).filter(v => v != null);
    return vals.length ? vals.reduce((s,x)=>s+x,0)/vals.length : 0;
  });
}

function uitleningenVoorTeam(teamId){
  return huidigeContext.uitleningen.filter(u => u.vanTeam === teamId || u.naarTeam === teamId).map(u => ({
    naam: u.snapshot?.naam || 'Speler',
    richting: u.vanTeam === teamId ? 'uit' : 'in',
    ander: teamNaam(u.vanTeam === teamId ? u.naarTeam : u.vanTeam),
  }));
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
function radarSVGAssen(values, asLabels, {size=150, labels=true, color='var(--accent)', compare=null, compareColor='var(--ink-2)', gestippeld=true} = {}){
  const n = asLabels.length;
  const R = size/2 - (labels?26:4), cx=size/2, cy=size/2;
  const pt=(i,f)=>{ const a=(-90+i*(360/n))*Math.PI/180; return [cx+R*f*Math.cos(a), cy+R*f*Math.sin(a)]; };
  let grid = '';
  [0.33,0.66,1].forEach(f => { grid += `<polygon points="${asLabels.map((_,i)=>pt(i,f).join(',')).join(' ')}" fill="none" stroke="var(--line-d)" stroke-width="1"/>`; });
  asLabels.forEach((_,i) => { const [x,y]=pt(i,1); grid += `<line x1="${cx}" y1="${cy}" x2="${x}" y2="${y}" stroke="var(--line-d)" stroke-width="1"/>`; });
  let lab = '';
  if (labels) asLabels.forEach((d,i) => { const [x,y]=pt(i,1.18); lab += `<text x="${x}" y="${y}" text-anchor="middle" dominant-baseline="middle" font-size="9" font-weight="700" fill="var(--ink-2)">${esc(d)}</text>`; });
  let compareLaag = '';
  if (compare){
    const cpts = compare.map((v,i) => pt(i,v/5).join(',')).join(' ');
    compareLaag = `<polygon points="${cpts}" fill="${compareColor}" fill-opacity=".12" stroke="${compareColor}" stroke-width="1.6" ${gestippeld?'stroke-dasharray="4 3"':''}/>`;
  }
  const data = values.map((v,i) => pt(i,v/5).join(',')).join(' ');
  return `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">${grid}${compareLaag}<polygon points="${data}" fill="${color}" fill-opacity=".35" stroke="${color}" stroke-width="2"/>${lab}</svg>`;
}
// Bestaande 5-domeinen speler-radar blijft z'n eigen naam/aanroepvorm houden
// (overal elders al zo gebruikt) — is nu gewoon een dunne laag bovenop de
// generieke functie hierboven, die ook de 8-categorieën teamevaluatie-radar
// bedient (zie TEAM_CAT_KORT/radarTeamEval verderop).
function radarSVG(values, opts={}){
  return radarSVGAssen(values, DOM.map(d => DOM_LABEL[d]), opts);
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

/* Meest recente vólledige (dus radar-geschikte) evaluatie van het hele team,
   ongeacht welke speler — samen met teamRadarGemiddelde() hierboven vult dit
   de "gemiddelde licht, laatste donker"-radar op de teamkaart. */
function teamRadarLaatste(team){
  const d = huidigeContext.data.get(team.id);
  const vol = d.beoordelingen.filter(b => b.scores).sort((a,b) => (a.datum||'').localeCompare(b.datum||''));
  if (!vol.length) return null;
  const m = vol[vol.length-1];
  return DOM.map(dom => m.scores[dom]||0);
}

/* ==================== NIVEAU 0 — Dashboard ==================== */
/* [20260922] Teamkaart verder uitgebreid op verzoek van Paul: naast Sportlink
   + trainingspresentie nu ook wedstrijdpresentie, een compacte teamradar
   (gemiddelde vs. meest recente meting — incl. losse beoordelingen in de
   telling), en de uitleningen die dit specifieke team raken. Welke van deze
   blokken zichtbaar zijn is instelbaar via het tandwiel rechtsboven
   (widgetVoorkeuren(), per toestel in localStorage). De losse "Teams
   vergelijken"-overlay-radar is vervallen: elk team heeft nu zijn eigen
   radar in de kaart, dat maakte de aparte sectie overbodig. */
function renderDashboard(){
  zetKop(bouwNaam(huidigeContext.bouw), null, true);
  const inhoud = laag.querySelector('#bouwhubInhoud');
  const { teams } = huidigeContext;
  const w = widgetVoorkeuren();

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

  const VORMKLEUR = {w:'var(--ok)', g:'var(--warn)', v:'var(--uit)'};
  const VORMLETTER = {w:'W', g:'G', v:'V'};
  const balkje = (label, pct, kleur) => `
    <div style="flex:1;min-width:0">
      <div style="display:flex;justify-content:space-between;font-size:calc(11px * var(--fs));color:var(--ink-2);margin-bottom:3px">
        <span>${label}</span><span style="font-weight:700;color:${kleur}">${pct==null?'–':pct+'%'}</span>
      </div>
      <div style="height:6px;background:var(--surface-2);border-radius:3px;overflow:hidden">
        <div style="height:100%;width:${pct||0}%;background:${kleur};border-radius:3px"></div>
      </div>
    </div>`;

  const teamKaartenHtml = `
    <div class="sectie-kop" style="margin-top:0">Teams in het kort</div>
    ${teams.map(t => {
      const u = uitslagenTeam(t);
      const positie = u.stand ? `${u.stand.positie}${u.totaalTeams?'<span style="font-size:.6em;font-weight:600;opacity:.7"> / '+u.totaalTeams+'</span>':''}` : '–';
      const d = huidigeContext.data.get(t.id);

      const pctTraining = presentiePctTeam(t);
      const pctTrainingKleur = pctTraining==null ? 'var(--ink-2)' : pctTraining>=85 ? 'var(--ok)' : pctTraining>=70 ? 'var(--warn)' : 'var(--uit)';
      const pctWedstrijd = presentiePctWedstrijdTeam(t);
      const pctWedstrijdKleur = pctWedstrijd==null ? 'var(--ink-2)' : pctWedstrijd>=85 ? 'var(--ok)' : pctWedstrijd>=70 ? 'var(--warn)' : 'var(--uit)';

      const officieelCount = new Set(d.beoordelingen.filter(b=>b.officieel).map(b=>b.spelerId)).size;
      const losseCount = d.beoordelingen.filter(b => !b.officieel).length;
      const evalTotaal = d.spelers.length;
      const evalPct = evalTotaal ? Math.round(officieelCount/evalTotaal*100) : 0;
      const evalKleur = evalPct===100 ? 'var(--ok)' : evalPct>=50 ? 'var(--warn)' : 'var(--uit)';

      const vormDots = u.vorm.length
        ? `<div style="display:flex;gap:4px">${u.vorm.map(x => `<span style="width:9px;height:9px;border-radius:50%;background:${VORMKLEUR[x]}"></span>`).join('')}</div>`
        : '';
      const laatsteHtml = u.laatste
        ? (() => { const uitk = u.laatste.voor>u.laatste.tegen?'w':u.laatste.voor<u.laatste.tegen?'v':'g';
            return `<span style="display:inline-flex;align-items:center;gap:5px;font-size:calc(12.5px * var(--fs));color:var(--ink-2)">
              <span style="background:${VORMKLEUR[uitk]};color:#12140f;font-weight:800;font-size:10px;border-radius:5px;padding:1px 5px">${VORMLETTER[uitk]}</span>
              vs ${esc(u.laatste.tegenstander)} ${u.laatste.voor}-${u.laatste.tegen}</span>`; })()
        : `<span style="font-size:calc(12.5px * var(--fs));color:var(--ink-2)">Nog geen Sportlink-uitslag</span>`;

      const balkjesRij = [
        w.presentieTraining ? balkje('Training', pctTraining, pctTrainingKleur) : '',
        w.presentieWedstrijd ? balkje('Wedstrijd', pctWedstrijd, pctWedstrijdKleur) : '',
      ].filter(Boolean);

      const radarLaatste = w.evalRadar ? teamRadarLaatste(t) : null;
      const radarGem = w.evalRadar ? teamRadarGemiddelde(t) : null;
      const radarHtml = w.evalRadar ? (radarLaatste
        ? `<button type="button" data-bh-team-eval="${t.id}" style="display:block;width:100%;background:none;border:none;padding:0;cursor:pointer;text-align:center;margin-top:10px">${radarSVG(radarLaatste, {size:170, compare: radarGem})}</button>`
        : `<div style="text-align:center;color:var(--ink-2);font-size:calc(11.5px * var(--fs));padding:8px 0">Nog geen evaluaties met domeinscores</div>`) : '';

      const teStats = w.teamEval ? teamEvalStatsTeam(t) : null;
      const teKleur = teStats?.laatsteGem ? niveauKleur(Math.max(1, Math.round(teStats.laatsteGem))) : 'var(--surface-2)';
      const teamEvalHtml = w.teamEval ? (teStats ? `
        <button type="button" data-bh-team-eval="${t.id}" style="display:block;width:100%;text-align:left;background:none;border:none;padding:0;margin-top:10px;padding-top:10px;border-top:1px solid var(--surface-2);cursor:pointer">
          <div style="display:flex;justify-content:space-between;align-items:center">
            <span style="font-size:calc(11px * var(--fs));color:var(--ink-2)">Teamevaluaties · na de wedstrijd</span>
            <span style="font-size:calc(11px * var(--fs));color:var(--ink-2)">${teStats.count}× ›</span>
          </div>
          <div style="display:flex;align-items:center;gap:8px;margin-top:4px">
            <span style="display:inline-flex;align-items:center;justify-content:center;width:26px;height:26px;border-radius:8px;background:${teKleur};color:#12140f;font-weight:800;font-size:calc(12px * var(--fs))">${teStats.laatsteGem?teStats.laatsteGem.toFixed(1).replace('.',','):'–'}</span>
            <span style="font-size:calc(12px * var(--fs));color:var(--ink-2)">laatste${teStats.laatsteTegenstander?' vs '+esc(teStats.laatsteTegenstander):''}${teStats.gemiddeld?` · gemiddeld ${teStats.gemiddeld.toFixed(1).replace('.',',')}`:''}</span>
          </div>
        </button>` : `
        <div style="margin-top:10px;padding-top:10px;border-top:1px solid var(--surface-2);color:var(--ink-2);font-size:calc(11.5px * var(--fs))">Nog geen teamevaluaties na een wedstrijd</div>`) : '';

      const leningen = w.uitleningen ? uitleningenVoorTeam(t.id) : [];
      const leningHtml = (w.uitleningen && leningen.length) ? `
        <div style="margin-top:10px;padding-top:10px;border-top:1px solid var(--surface-2)">
          ${leningen.map(l => `<div style="font-size:calc(12px * var(--fs));color:var(--ink-2);margin-bottom:2px">
            <b style="color:var(--ink)">${esc(l.naam)}</b> ${l.richting==='uit'?'uitgeleend aan':'ingeleend van'} ${esc(l.ander)}
          </div>`).join('')}
        </div>` : '';

      return `<div class="kaart" style="margin-bottom:10px">
        <div style="display:flex;justify-content:space-between;align-items:center">
          <b style="font-size:calc(15px * var(--fs))">${esc(t.naam)}</b>
          <span style="font-family:'Barlow Condensed';font-weight:800;font-size:calc(19px * var(--fs));color:var(--accent);line-height:1">${positie}</span>
        </div>
        ${w.sportlink ? (u.gespeeld > 0
          ? `<button type="button" data-bh-uitslagen="${t.id}" style="display:flex;justify-content:space-between;align-items:center;width:100%;margin-top:6px;flex-wrap:wrap;gap:6px;background:none;border:none;padding:0;cursor:pointer;text-align:left">
              ${laatsteHtml}
              <span style="display:flex;align-items:center;gap:6px">${vormDots}<span class="pijl">›</span></span>
            </button>`
          : `<div style="display:flex;justify-content:space-between;align-items:center;margin-top:6px;flex-wrap:wrap;gap:6px">
              ${laatsteHtml}
              ${vormDots}
            </div>`) : ''}
        ${balkjesRij.length ? `<div style="display:flex;gap:14px;margin-top:12px">${balkjesRij.join('')}</div>` : ''}
        ${w.evalVoortgang ? `<div style="margin-top:${balkjesRij.length?'8':'12'}px">
          <div style="display:flex;justify-content:space-between;font-size:calc(11px * var(--fs));color:var(--ink-2);margin-bottom:3px">
            <span>Najaarsevaluatie${losseCount>0?` · +${losseCount} los`:''}</span><span style="font-weight:700;color:${evalKleur}">${officieelCount}/${evalTotaal}</span>
          </div>
          <div style="height:6px;background:var(--surface-2);border-radius:3px;overflow:hidden">
            <div style="height:100%;width:${evalPct}%;background:${evalKleur};border-radius:3px"></div>
          </div>
        </div>` : ''}
        ${radarHtml}
        ${teamEvalHtml}
        ${leningHtml}
      </div>`;
    }).join('')}`;

  const uitgeleend = uitgeleendeSpelersBouw();
  const uitleenHtml = `
    <div class="sectie-kop">Actuele uitleningen — hele bouw</div>
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

  inhoud.innerHTML = aandachtHtml + teamKaartenHtml + uitleenHtml + tegelsHtml;

  inhoud.querySelectorAll('[data-bh-open]').forEach(b => {
    b.onclick = () => {
      const tab = b.dataset.bhOpen;
      if (tab === 'teams') renderTeamsScherm();
      else if (tab === 'spelers') renderSpelersScherm();
      else if (tab === 'uitleningen') renderUitleningenScherm();
      else renderEvaluatiesScherm();
    };
  });
  inhoud.querySelectorAll('[data-bh-team-eval]').forEach(b => {
    b.onclick = () => renderEvaluatieTeamDetail(b.dataset.bhTeamEval);
  });
  inhoud.querySelectorAll('[data-bh-uitslagen]').forEach(b => {
    b.onclick = () => renderUitslagenScherm(b.dataset.bhUitslagen);
  });
}

/* [20260922] Op verzoek van Paul: niet alleen de laatste Sportlink-uitslag op
   de teamkaart, maar ook alle bekende uitslagen van dat team terug te vinden
   (tik op de uitslag-regel op het dashboard). Gebruikt dezelfde poule-data
   die al voor de teamkaart wordt opgehaald — geen extra Firestore-call. */
function renderUitslagenScherm(teamId){
  const team = huidigeContext.teams.find(t => t.id === teamId);
  zetKop(team?.naam || 'Uitslagen', renderDashboard);
  const inhoud = laag.querySelector('#bouwhubInhoud');
  const u = uitslagenTeam(team);
  const lijst = [...u.lijst].reverse();
  const VORMKLEUR = {w:'var(--ok)', g:'var(--warn)', v:'var(--uit)'};
  const VORMLETTER = {w:'W', g:'G', v:'V'};
  const uitkomst = r => r.voor > r.tegen ? 'w' : r.voor < r.tegen ? 'v' : 'g';

  inhoud.innerHTML = `
    <div class="sectie-kop" style="margin-top:0">${u.gespeeld} bekende uitslag${u.gespeeld===1?'':'en'}${u.stand ? ` · ${esc(String(u.stand.positie))}${u.totaalTeams?'/'+u.totaalTeams:''} in de poule` : ''}</div>
    <div class="kaart" style="display:flex;justify-content:space-around;text-align:center">
      <div><div style="font-size:calc(20px * var(--fs));font-weight:800;color:var(--ok)">${u.w}</div><div style="font-size:calc(11px * var(--fs));color:var(--ink-2)">W</div></div>
      <div><div style="font-size:calc(20px * var(--fs));font-weight:800;color:var(--warn)">${u.g}</div><div style="font-size:calc(11px * var(--fs));color:var(--ink-2)">G</div></div>
      <div><div style="font-size:calc(20px * var(--fs));font-weight:800;color:var(--uit)">${u.v}</div><div style="font-size:calc(11px * var(--fs));color:var(--ink-2)">V</div></div>
      <div><div style="font-size:calc(20px * var(--fs));font-weight:800">${u.voor}-${u.tegen}</div><div style="font-size:calc(11px * var(--fs));color:var(--ink-2)">doelpunten</div></div>
    </div>
    <div class="sectie-kop">Wedstrijden</div>
    ${lijst.length ? lijst.map(r => {
      const uitk = uitkomst(r);
      return `<div class="lijst-item" style="cursor:default">
        <div class="team-shirt" style="background:${VORMKLEUR[uitk]};color:#12140f">${VORMLETTER[uitk]}</div>
        <div class="li-tekst">
          <div class="titel">${esc(r.tegenstander)} <span style="color:var(--ink-2);font-weight:600">${r.voor}-${r.tegen}</span></div>
          <div class="meta">${r.thuis?'Thuis':'Uit'} · ${esc(r.datum||'')}</div>
        </div>
      </div>`;
    }).join('') : `<div class="kaart leeg">Nog geen bekende uitslagen.</div>`}`;
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
      const m = await import('./teams.js?v=20260923d');
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
        const opk = opkomstVoor(p, d.presentie);
        const opkomstPct = opk.totaal >= MIN_OPKOMST_TRAININGEN ? opk.pct : null;
        const cijfer = cijferSpeler(p, d.beoordelingen);
        alles.push({...p, teamId:t.id, teamNaam:t.naam, topPosities:top, opkomstPct, cijfer});
      });
    }
    alles.sort((a,b) => (a.naam||'').localeCompare(b.naam||''));
    huidigeContext.spelersLijst = alles;
  }
  tekenSpelersLijst('alle');
}
/* [20260921] Badge-rij per speler i.p.v. platte tekst: positie+trend,
   opkomst% (kleurgecodeerd) en evaluatiecijfer+trend — op verzoek van Paul,
   zodat je in één blik ziet waar een speler staat, hoe vaak hij er is en hoe
   hij scoort, i.p.v. dat apart te moeten opzoeken. */
function badgeRij(p){
  const stukjes = [];
  if (p.topPosities.length) stukjes.push(`<span>${esc(p.topPosities.map(x => x.naam).join(', '))}${trendPijl(p.topPosities[0]?.trend)}</span>`);
  if (p.opkomstPct != null){
    const kleur = p.opkomstPct>=85 ? 'var(--ok)' : p.opkomstPct>=70 ? 'var(--warn)' : 'var(--uit)';
    stukjes.push(`<span style="color:${kleur};font-weight:700">${p.opkomstPct}% opkomst</span>`);
  }
  if (p.cijfer){
    const kleur = p.cijfer.cijfer>=4 ? 'var(--ok)' : p.cijfer.cijfer>=2.5 ? 'var(--warn)' : 'var(--uit)';
    stukjes.push(`<span style="color:${kleur};font-weight:700">${p.cijfer.cijfer.toFixed(1)}${trendPijl(p.cijfer.trend)}</span>`);
  }
  return stukjes.length ? stukjes.join(' <span style="color:var(--line-d)">·</span> ') : 'Nog geen gegevens';
}
function tekenSpelersLijst(filterTeamId){
  const inhoud = laag.querySelector('#bouwhubInhoud');
  const { teams, spelersLijst } = huidigeContext;
  const items = filterTeamId === 'alle' ? spelersLijst : spelersLijst.filter(p => p.teamId === filterTeamId);
  inhoud.innerHTML = `
    <div style="display:flex;gap:8px;overflow-x:auto;margin-bottom:12px">
      <button class="knop klein" data-bh-filter="alle" style="white-space:nowrap${filterTeamId==='alle'?';background:var(--accent);color:#fff':';background:var(--card);color:var(--ink)'}">Alle teams</button>
      ${teams.map(t => `<button class="knop klein" data-bh-filter="${t.id}" style="white-space:nowrap${filterTeamId===t.id?';background:var(--accent);color:#fff':';background:var(--card);color:var(--ink)'}">${esc(t.naam)}</button>`).join('')}
    </div>
    ${items.length ? items.map(p => `
      <button class="lijst-item" data-bh-open-speler="${p.id}" data-bh-team="${p.teamId}">
        <div class="team-shirt">${p.nummer!=null&&p.nummer!==''?esc(String(p.nummer)):'?'}</div>
        <div class="li-tekst">
          <div class="titel">${esc(p.naam)} <span style="font-weight:400;color:var(--ink-2);font-size:.85em">· ${esc(p.teamNaam)}</span></div>
          <div class="meta" style="font-size:calc(12px * var(--fs));margin-top:3px">${badgeRij(p)}</div>
        </div>
        <span class="pijl">›</span>
      </button>`).join('') : `<div class="kaart leeg">Geen spelers gevonden.</div>`}`;
  inhoud.querySelectorAll('[data-bh-filter]').forEach(b => b.onclick = () => tekenSpelersLijst(b.dataset.bhFilter));
  inhoud.querySelectorAll('[data-bh-open-speler]').forEach(b => {
    b.onclick = () => renderSpelerCoordinatorProfiel(b.dataset.bhTeam, b.dataset.bhOpenSpeler);
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

export async function modalNieuweUitleningVanuitBouw(verversScherm){
  const { clubId, teams } = huidigeContext;

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
  $('bhUlAnnuleer').onclick = () => sluitModal();
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
      sluitModal();
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
// Alleen volledige evaluaties hebben domeinscores en kunnen dus ooit in een
// radar getoond worden — een snelle beoordeling (niveau, geen scores) niet.
function volledigeMetingen(p){ return p.metingen.filter(m => m.scores); }
function vorigeVolledigeMeting(p, meting){
  const vol = volledigeMetingen(p);
  const i = vol.indexOf(meting);
  return i > 0 ? vol[i-1] : null;
}
const KLEUR_CIJFER = {1:'var(--uit)', 2:'#F59C4A', 3:'#F2C94C', 4:'#7DCB6A', 5:'var(--ok)'};

function renderEvaluatiesScherm(){
  zetKop('Evaluaties', renderDashboard);
  const inhoud = laag.querySelector('#bouwhubInhoud');
  const rijen = huidigeContext.teams.map(t => {
    const d = huidigeContext.data.get(t.id);
    const perSpeler = {};
    d.beoordelingen.forEach(b => { (perSpeler[b.spelerId] ||= []).push(b); });
    const spelersMetOfficieel = Object.values(perSpeler).filter(ms => ms.some(m=>m.officieel)).length;
    const totaalMetingen = d.beoordelingen.length;
    const losseMetingen = d.beoordelingen.filter(b => !b.officieel).length;
    return { team:t, officieel:spelersMetOfficieel, totaal:d.spelers.length, totaalMetingen, losseMetingen };
  }).sort((a,b) => (a.totaal ? a.officieel/a.totaal : 1) - (b.totaal ? b.officieel/b.totaal : 1));

  inhoud.innerHTML = `
    <div class="sectie-kop" style="margin-top:0">Halfjaarevaluatie · per team</div>
    <p style="color:var(--ink-2);font-size:calc(12px * var(--fs));margin:-6px 0 12px">Inclusief losse beoordelingen tussendoor (bij wedstrijden/trainingen) — tik een team voor het volledige overzicht.</p>
    ${rijen.map(r => {
      const ratio = r.totaal ? r.officieel/r.totaal : 0;
      const kleur = ratio===1 ? 'var(--ok)' : ratio<0.5 ? 'var(--uit)' : 'var(--warn)';
      return `<button class="lijst-item" data-bh-eval-team="${r.team.id}">
        <div class="team-shirt" style="background:${kleur};color:#12140f">${r.officieel}/${r.totaal}</div>
        <div class="li-tekst">
          <div class="titel">${esc(r.team.naam)}</div>
          <div class="meta">officiële halfjaarevaluatie${r.losseMetingen>0?` · +${r.losseMetingen} losse beoordeling${r.losseMetingen===1?'':'en'}`:''}</div>
        </div>
        <span class="pijl">›</span>
      </button>`;
    }).join('')}`;
  inhoud.querySelectorAll('[data-bh-eval-team]').forEach(b => b.onclick = () => renderEvaluatieTeamDetail(b.dataset.bhEvalTeam));
}

function volledigLaatste(p){
  const vol = volledigeMetingen(p);
  return vol.length ? vol[vol.length-1] : null;
}

function renderEvaluatieTeamDetail(teamId){
  const team = huidigeContext.teams.find(t => t.id === teamId);
  zetKop(team?.naam || 'Team', renderEvaluatiesScherm);
  const inhoud = laag.querySelector('#bouwhubInhoud');
  const d = huidigeContext.data.get(teamId);
  const perSpeler = {};
  d.beoordelingen.forEach(b => { (perSpeler[b.spelerId] ||= []).push(b); });
  const spelers = d.spelers.map(p => ({...p, metingen: (perSpeler[p.id]||[]).sort((a,b) => (a.datum||'').localeCompare(b.datum||''))}));

  // [20260922] TWEE radars, zoals gevraagd: de gemiddelde individuele
  // evaluatie (ongeacht officieel/halfjaar of niet — elke meting mét
  // domeinscores telt mee) en de wedstrijd-teamevaluatie (8 categorieën,
  // andere assen dan de 5 speler-domeinen). Beide gemiddelde-licht +
  // laatste-donker, dezelfde vergelijkstijl als bij een spelerprofiel.
  const indivGem = teamRadarGemiddelde(team);
  const indivLaatste = teamRadarLaatste(team);
  const losseCijfers = spelers.map(p => cijferSpeler(p, p.metingen)).filter(Boolean);
  const losGem = losseCijfers.length ? (losseCijfers.reduce((s,c)=>s+c.cijfer,0)/losseCijfers.length).toFixed(1).replace('.',',') : null;
  const indivRadarHtml = indivLaatste
    ? `<div style="text-align:center">${radarSVG(indivLaatste, {size:170, compare:indivGem})}${indivGem?radarLegende('laatste meting','gemiddelde'):''}</div>`
    : `<div style="color:var(--ink-2);font-size:calc(13px * var(--fs));padding:20px 0;text-align:center">Nog geen volledige (5-domeinen) evaluatie in dit team.${losGem?`<br>Wel ${losseCijfers.length} losse beoordeling${losseCijfers.length===1?'':'en'}, gemiddeld cijfer ${losGem}.`:''}</div>`;

  const evals = d.teamevaluaties || [];
  const evalsChron = [...evals].sort((a,b) => (a.datum||'').localeCompare(b.datum||''));
  const teGem = evals.length ? teamEvalRadarWaarden(evals) : null;
  const teLaatste = evalsChron.length ? teamEvalRadarWaarden([evalsChron[evalsChron.length-1]]) : null;
  const teAsLabels = TEAM_CATEGORIEEN.map(c => TEAM_CAT_KORT[c.id] || c.naam.slice(0,6));
  const teRadarHtml = teLaatste
    ? `<div style="text-align:center">${radarSVGAssen(teLaatste, teAsLabels, {size:170, compare:teGem})}${radarLegende('laatste wedstrijd','gemiddelde')}</div>`
    : `<div style="color:var(--ink-2);font-size:calc(13px * var(--fs));padding:20px 0;text-align:center">Nog geen teamevaluatie na een wedstrijd.</div>`;
  const teHistorieHtml = evalsChron.length ? `
    <div class="sectie-kop">Historie — na de wedstrijd</div>
    ${[...evalsChron].reverse().map(ev => {
      const vals = Object.values(ev.scores||{});
      const gem = vals.length ? (vals.reduce((s,x)=>s+x,0)/vals.length) : null;
      return `<button class="lijst-item" data-bh-open-teameval="${ev.wedstrijdId||''}">
        <div class="team-shirt" style="background:${gem?niveauKleur(Math.round(gem)):'var(--surface-2)'};color:#12140f">${gem?gem.toFixed(1).replace('.',','):'–'}</div>
        <div class="li-tekst">
          <div class="titel">${esc(ev.tegenstander||'Onbekend')}</div>
          <div class="meta">${esc(ev.datum||'')}</div>
        </div>
        <span class="pijl">›</span>
      </button>`;
    }).join('')}` : '';

  inhoud.innerHTML = `
    <div class="kaart">
      <div class="sectie-kop" style="margin:0 0 4px">Teamprofiel — individuele evaluaties</div>
      ${indivRadarHtml}
    </div>
    <div class="kaart" style="margin-top:10px">
      <div class="sectie-kop" style="margin:0 0 4px">Teamprofiel — na de wedstrijd</div>
      ${teRadarHtml}
    </div>
    ${teHistorieHtml}
    <div class="sectie-kop">Spelers</div>
    ${spelers.map(p => {
      const m = volledigLaatste(p);
      if (m){
        const extra = p.metingen.length > 1 ? ` · ${p.metingen.length}×` : '';
        return `<button class="lijst-item" data-bh-open-profiel="${p.id}">
          <div class="li-tekst" style="flex:1">
            <div class="titel">${esc(p.naam)}${esc(extra)}${m.officieel?' <span style="color:var(--accent);font-size:11px;font-weight:700">· HALFJAAR</span>':''}</div>
            <div class="meta" style="display:flex;gap:5px;margin-top:4px">
              ${DOM.map(dom => `<span style="display:inline-flex;align-items:center;justify-content:center;background:${KLEUR_CIJFER[m.scores[dom]]||'var(--surface-2)'};color:#12140f;border-radius:6px;padding:2px 6px;font-size:11px;font-weight:700">${m.scores[dom]||'–'}</span>`).join('')}
            </div>
          </div>
          <span class="pijl">›</span>
        </button>`;
      }
      // Geen volledige (5-domeinen) evaluatie, maar mogelijk wel losse
      // beoordelingen tussendoor — die dan tonen i.p.v. stilzwijgend
      // "nog niet geëvalueerd" te zeggen terwijl er wel degelijk iets is.
      const cijfer = cijferSpeler(p, p.metingen);
      return `<button class="lijst-item" data-bh-open-profiel="${p.id}">
        <div class="li-tekst" style="flex:1">
          <div class="titel">${esc(p.naam)}</div>
          <div class="meta">${cijfer ? `Losse beoordeling: cijfer ${cijfer.cijfer}${trendPijl(cijfer.trend)} · ${p.metingen.length} meting${p.metingen.length===1?'':'en'}` : 'Nog niet geëvalueerd'}</div>
        </div>
        <span class="pijl">›</span>
      </button>`;
    }).join('')}`;
  inhoud.querySelectorAll('[data-bh-open-profiel]').forEach(b => {
    b.onclick = () => renderSpelerprofielScherm(teamId, spelers.find(x => x.id === b.dataset.bhOpenProfiel));
  });
  inhoud.querySelectorAll('[data-bh-open-teameval]').forEach(b => {
    b.onclick = () => renderTeamEvaluatieDetail(teamId, evals.find(e => e.wedstrijdId === b.dataset.bhOpenTeameval));
  });
}

/* Alleen-lezen detail van één teamevaluatie (na de wedstrijd): score per
   categorie, tags en de twee notitievelden. Bewust geen edit hier — dat
   blijft in de normale teamhub (modalTeamEvaluatie), dit is de
   coördinator-blik over meerdere teams heen. */
function renderTeamEvaluatieDetail(teamId, ev){
  zetKop(ev?.tegenstander || 'Teamevaluatie', () => renderEvaluatieTeamDetail(teamId));
  const inhoud = laag.querySelector('#bouwhubInhoud');
  if (!ev){ inhoud.innerHTML = `<div class="kaart leeg">Deze evaluatie kon niet gevonden worden.</div>`; return; }
  const vals = Object.values(ev.scores||{});
  const gem = vals.length ? (vals.reduce((s,x)=>s+x,0)/vals.length) : null;

  inhoud.innerHTML = `
    <div class="kaart">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">
        <div>
          <div style="font-weight:700;font-size:calc(15px * var(--fs))">${esc(ev.tegenstander||'Onbekend')}</div>
          <div style="color:var(--ink-2);font-size:calc(12px * var(--fs))">${esc(ev.datum||'')}</div>
        </div>
        <div style="display:inline-flex;align-items:center;justify-content:center;width:38px;height:38px;border-radius:10px;background:${gem?niveauKleur(Math.round(gem)):'var(--surface-2)'};color:#12140f;font-weight:800">${gem?gem.toFixed(1).replace('.',','):'–'}</div>
      </div>
    </div>
    <div class="sectie-kop">Per categorie</div>
    <div class="kaart">
      ${TEAM_CATEGORIEEN.map(c => {
        const s = ev.scores?.[c.id];
        return `<div style="display:flex;justify-content:space-between;align-items:center;padding:6px 0;border-bottom:1px solid var(--surface-2)">
          <span style="font-size:calc(13px * var(--fs))">${esc(c.naam)}</span>
          <span style="display:inline-flex;align-items:center;justify-content:center;min-width:26px;height:26px;border-radius:7px;background:${s?niveauKleur(s):'var(--surface-2)'};color:#12140f;font-weight:700;font-size:calc(12px * var(--fs))">${s||'–'}</span>
        </div>`;
      }).join('')}
    </div>
    ${ev.tags?.length ? `<div class="sectie-kop">Opvallend</div><div class="kaart" style="display:flex;flex-wrap:wrap;gap:6px">${ev.tags.map(t => `<span class="tag aan">${esc(t)}</span>`).join('')}</div>` : ''}
    ${ev.notitieGoed ? `<div class="sectie-kop">Wat ging het beste?</div><div class="kaart" style="font-size:calc(13px * var(--fs))">${esc(ev.notitieGoed)}</div>` : ''}
    ${ev.notitieAandacht ? `<div class="sectie-kop">Aandachtspunt</div><div class="kaart" style="font-size:calc(13px * var(--fs))">${esc(ev.notitieAandacht)}</div>` : ''}
  `;
}

function metingLabel(m){
  if (m.soort === 'snel') return `Losse beoordeling${m.bron?.label ? ' · '+esc(m.bron.label) : ''}`;
  return esc(m.bron?.label || 'Meting');
}

/* [20260922] "opties.overzicht"/"opties.terug" toegevoegd zodat dit scherm
   ook los van de Evaluaties-flow bruikbaar is: vanuit de Spelers-tegel wordt
   hier nu ook een basisoverzicht (positie/opkomst/cijfer) bovenaan getoond
   en gaat "terug" naar de spelerslijst i.p.v. het teamevaluatie-detail. */
function renderSpelerprofielScherm(teamId, p, actieveMeting, opties = {}){
  const terug = opties.terug || (() => renderEvaluatieTeamDetail(teamId));
  zetKop(p.naam, terug);
  const inhoud = laag.querySelector('#bouwhubInhoud');
  // Alleen een meting mét domeinscores kan ooit de radar vullen — bij een
  // losse (snelle) beoordeling valt terug op de laatst-bekende volledige
  // meting, of anders helemaal geen radar (wel de lijst met losse metingen).
  const vol = volledigeMetingen(p);
  const m = (actieveMeting?.scores ? actieveMeting : null) || pinned(p) || vol[vol.length-1] || null;
  const v = m ? vorigeVolledigeMeting(p, m) : null;
  const historie = [...p.metingen].reverse();

  const radarBlok = m ? `
    <div class="kaart" style="text-align:center">
      <div class="sectie-kop" style="margin:0 0 4px;text-align:left">${esc(m.bron?.label || 'meting')} · ${esc(m.datum||'')}</div>
      ${radarSVG(DOM.map(dom => m.scores[dom]||0), {size:170, compare: v ? DOM.map(dom => v.scores[dom]||0) : null})}
      ${v ? radarLegende(m.bron?.label||'huidig', v.bron?.label||'vorige') : ''}
    </div>`
    : `<div class="kaart" style="text-align:center;color:var(--ink-2);font-size:calc(13px * var(--fs));padding:24px 0">Nog geen volledige evaluatie — wel losse beoordeling(en) hieronder.</div>`;

  // [20260922] Bugfix: bij precies 1 losse (niet-volledige) meting toonde
  // "historie.length > 1" hier niets, terwijl de tekst hierboven al zegt
  // "wel losse beoordeling(en) hieronder" — die belofte klopte dan niet.
  // De radar toont zelf al 1 volledige meting (m), dus die mag hier
  // vervallen als het de énige is; een losse meting (geen radar, m===null)
  // moet altijd zichtbaar zijn, ook als het er maar 1 is.
  const toonHistorie = historie.length > (m ? 1 : 0);

  inhoud.innerHTML = `
    ${opties.overzicht ? spelerOverzichtHtml(p) : ''}
    ${radarBlok}
    ${toonHistorie ? `
      <div class="sectie-kop">Alle metingen dit seizoen</div>
      ${historie.map(x => {
        const isVolledig = !!x.scores;
        const klikbaar = isVolledig;
        return `<div class="lijst-item" ${klikbaar?`data-bh-meting="${p.metingen.indexOf(x)}"`:''} style="${klikbaar?'cursor:pointer':'cursor:default'}${x===m?';border-left:3px solid var(--accent)':''}">
          <div class="li-tekst">
            <div class="titel">${metingLabel(x)}${x.officieel?' <span style="color:var(--accent);font-size:11px;font-weight:700">· HALFJAAR</span>':''}</div>
            ${!isVolledig ? `<div class="meta">Cijfer ${x.niveau ?? '–'}${x.notities?.algemeen ? ' · “'+esc(x.notities.algemeen)+'”' : ''}</div>` : ''}
          </div>
          <div class="meta">${esc(x.datum||'')}</div>
        </div>`;
      }).join('')}` : ''}`;

  inhoud.querySelectorAll('[data-bh-meting]').forEach(row => {
    row.onclick = () => renderSpelerprofielScherm(teamId, p, p.metingen[Number(row.dataset.bhMeting)], opties);
  });
}

/* Compact basisoverzicht (positie, opkomst, evaluatiecijfer, open
   leerpunten) — dezelfde badges als in de spelerslijst, nu bovenaan het
   profiel zodat een coördinator niet naar de teamhub hoeft voor het geheel. */
function spelerOverzichtHtml(p){
  const leerpuntenOpen = ((p.leerpunten)||[]).filter(l => !l.klaar).length + ((p._bronLeerpunten)||[]).length;
  return `<div class="kaart">
    <div style="display:flex;justify-content:space-between;align-items:center">
      <div>
        <div style="color:var(--ink-2);font-size:calc(12px * var(--fs))">${esc(p.teamNaam||'')}${p.nummer!=null&&p.nummer!==''?' · #'+esc(String(p.nummer)):''}</div>
      </div>
      <div class="team-shirt">${p.nummer!=null&&p.nummer!==''?esc(String(p.nummer)):'?'}</div>
    </div>
    <div style="margin-top:8px;font-size:calc(13px * var(--fs))">${badgeRij(p)}</div>
    ${leerpuntenOpen>0 ? `<div style="margin-top:6px;font-size:calc(12px * var(--fs));color:var(--ink-2)">${leerpuntenOpen} open leerpunt${leerpuntenOpen===1?'':'en'}</div>` : ''}
  </div>`;
}

/* [20260922] Op verzoek van Paul: een klik op een speler vanuit de
   Spelers-tegel blijft nu binnen de coördinator-omgeving (alleen-lezen —
   bewerken blijft in de teamhub, zelfde afspraak als bij
   renderTeamEvaluatieDetail hierboven) i.p.v. dat teams.js werd geopend en
   "terug" je tussen teams kon laten verdwalen. */
function renderSpelerCoordinatorProfiel(teamId, spelerId){
  const d = huidigeContext.data.get(teamId);
  const item = (huidigeContext.spelersLijst || []).find(x => x.id === spelerId && x.teamId === teamId);
  const basis = item || {
    ...(d.spelers.find(x => x.id === spelerId) || {id: spelerId, naam: '?'}),
    teamId, teamNaam: huidigeContext.teams.find(t => t.id === teamId)?.naam || '',
    topPosities: [], opkomstPct: null, cijfer: null,
  };
  const metingen = d.beoordelingen.filter(b => b.spelerId === spelerId).sort((a,b) => (a.datum||'').localeCompare(b.datum||''));
  renderSpelerprofielScherm(teamId, {...basis, metingen}, null, {overzicht:true, terug: renderSpelersScherm});
}
