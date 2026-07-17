import {
  db, collection, doc, addDoc, deleteDoc, updateDoc, deleteField,
  setDoc, getDocs, query, where, onSnapshot, serverTimestamp
} from './firebase.js';
import {
  S, $, $$, esc, meld, datumNL, teamCode, clubAfkorting, speler, isBeheerder,
  openModal, sluitModal, toon, stopUnsubs, bewaakTerug
} from './state.js';
import {
  CATEGORIEEN, CATEGORIEEN_MEIDEN, catInfo,
  KNVB_SEIZOEN, SEIZOEN_FALLBACK, knvbKalenderVoorTeam,
  kompasIndexVoorWeek
} from './config.js';
import { kompasTips, startContentListener } from './content.js';
import { analyseWedstrijd } from './analyse.js';
import { doSignOut, joinMetCode } from './auth.js';
import { tekenPwaBanner } from './pwa.js';
import {
  openWedstrijd, modalNieuweWedstrijd, renderWedstrijd
} from './wedstrijd.js';

/* ---------- Submodules (teams.js-modulaire split) ----------
   teams.js is de dunne hub: navigatie, dispatch (renderTeam/koppelTeamTab)
   en alles wat bij het teamsoverzicht/team-openen hoort. De tabbladinhoud
   zelf is verdeeld over onderstaande bestanden. Deze imports zijn bewust
   STATISCH (niet dynamisch): koppelTeamTab hieronder heeft ze allemaal
   nodig zodra een team geopend wordt, dus lazy loading zou hier geen
   winst opleveren en alleen complexiteit toevoegen.
   Let op: deze submodules importeren NOOIT statisch terug vanuit teams.js
   (dat zou een circulaire import geven) — voor de enkele keren dat zij
   toch iets uit de hub nodig hebben (bv. opnieuw renderen na een actie)
   gebruiken ze `import('./teams.js')` binnen de aanroepende functie,
   hetzelfde patroon dat club.js en wedstrijd.js al gebruikten. */
import {
  htmlSpelers, htmlLeenProfiel, htmlProfiel,
  modalSnelBeoordeling, startSnelRonde, modalVolledigeBeoordeling,
  modalLeerpunt, toggleLeerpunt, verwijderLeerpunt, modalSpeler,
  modalUitlenen, trekUitleningIn,
} from './teams-spelers.js';
import { htmlKompas, toonThemaInfo, toonKompasInfo } from './teams-leerlijn.js';
import { modalTeamEvaluatie, htmlStatsTab } from './teams-evaluatie.js';
import {
  htmlTeamTrainingen, htmlTeamVideos, htmlInstellingen,
  modalWijzigCode, modalMijnNaam, modalPresentie, modalEigenDag, modalPlanDag,
  afgelastDatumTekst, afgelastWhatsappTekst, afgelastGeldig,
} from './teams-training.js';
import { htmlHandleiding } from './teams-handleiding.js';

/* Publieke re-exports: consumenten van teams.js (main.js, wedstrijd.js, ...)
   importeren deze twee nog altijd via './teams.js' — ze wonen nu fysiek in
   een submodule, maar de buitenkant van de app verandert niet. */
export { afgelastDatumTekst, modalTeamEvaluatie };

/* club.js is alleen nodig voor club-admin-schermen — bewust dynamisch
   geladen zodat een gewone jeugdcoach dat scherm nooit hoeft te downloaden.
   Zelfde afweging als in main.js voor openClub/verlaatClubView. */

/* Strakke lijn-iconen voor de onderbalk (laatste layout) */
const NAV_ICON = {
  wedstrijden:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 7.2l4.2 3-1.6 4.9H9.4L7.8 10.2z"/><path d="M12 7.2 9.5 5M12 7.2 14.5 5M16.2 10.2l2.6-.6M14.6 15.1l1.7 2.1M9.4 15.1l-1.7 2.1M7.8 10.2l-2.6-.6"/></svg>',
  spelers:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="3.2"/><path d="M5.5 20a6.5 6.5 0 0 1 13 0"/></svg>',
  planning:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3.5" y="5" width="17" height="15" rx="2.5"/><path d="M3.5 9.5h17M8 3v4M16 3v4"/><circle cx="12" cy="14.5" r="1.4" fill="currentColor" stroke="none"/></svg>',
  trainingen:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="4.5" width="14" height="16" rx="2.2"/><path d="M9 3.2h6v3H9z"/><path d="M8.8 12.2l2.2 2.2 4.2-4.4"/></svg>',
  videos:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="6" width="13" height="12" rx="2.2"/><path d="M16 10l5-3v10l-5-3z"/></svg>',
  stats:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/></svg>',
  help:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M9.3 9.3a2.7 2.7 0 0 1 5.2 1c0 1.8-2.5 2.2-2.5 4"/><circle cx="12" cy="17.2" r="0.6" fill="currentColor" stroke="none"/></svg>',
};

/* ==================== TEAMS-OVERZICHT ==================== */
export function startTeams(){
  stopUnsubs('teams','clubs','gelezen');
  if (!S.unsub.content) S.unsub.content = startContentListener();
  const meldFout = (naam) => (err) => {
    console.error(`[Cluppie] Listener "${naam}" kon niet lezen:`, err.code, err.message);
    if (err.code === 'permission-denied') meld(`Geen toegang tot "${naam}" — controleer de Firestore-rules`);
  };
  const q1 = query(collection(db,'teams'), where('leden.'+S.user.uid, '==', true));
  S.unsub.teams = onSnapshot(q1, snap => {
    S.teams = snap.docs.map(d => ({id:d.id, ...d.data()}))
                       .sort((a,b) => (a.naam||'').localeCompare(b.naam||''));
    if (!S.teamId && !S.clubId) renderTeams();
    laadTrainingenVoorTeams();
    laadVideosVoorTeams();
  }, meldFout('teams'));
  const q2 = query(collection(db,'clubs'), where('admins.'+S.user.uid, '==', true));
  S.unsub.clubs = onSnapshot(q2, snap => {
    S.clubs = snap.docs.map(d => ({id:d.id, ...d.data()}))
                       .sort((a,b) => (a.naam||'').localeCompare(b.naam||''));
    if (!S.teamId && !S.clubId) renderTeams();
  }, meldFout('clubs'));
  const q3 = query(collection(db,'gebruikers',S.user.uid,'gelezen'));
  S.unsub.gelezen = onSnapshot(q3, snap => {
    S.trainingenGelezen = {};
    snap.docs.forEach(d => S.trainingenGelezen[d.id] = true);
    if (S.team) renderTeam();
  }, meldFout('gelezen'));
  renderTeams(); toon('teams');
}

/* trainingen voor de teams waar de coach lid van is */
let trainingenUnsubs = [];
function laadTrainingenVoorTeams(){
  trainingenUnsubs.forEach(u => u());
  trainingenUnsubs = [];
  const teamIds = S.teams.map(t => t.id);
  if (!teamIds.length){ S.trainingen = []; return; }
  const chunks = [];
  for (let i = 0; i < teamIds.length; i += 30) chunks.push(teamIds.slice(i, i+30));
  S.trainingen = [];
  chunks.forEach(c => {
    const q = query(collection(db,'trainingen'), where('teams','array-contains-any', c));
    const u = onSnapshot(q, snap => {
      const ids = new Set(snap.docs.map(d => d.id));
      S.trainingen = S.trainingen.filter(t => !c.some(tid => (t.teams||[]).includes(tid)) || ids.has(t.id));
      snap.docs.forEach(d => {
        const i = S.trainingen.findIndex(t => t.id === d.id);
        const data = {id:d.id, ...d.data()};
        if (i >= 0) S.trainingen[i] = data; else S.trainingen.push(data);
      });
      S.trainingen.sort((a,b) => (b.week||'').localeCompare(a.week||'') || (b.gemaakt?.seconds||0) - (a.gemaakt?.seconds||0));
      if (S.team) renderTeam();
    });
    trainingenUnsubs.push(u);
  });
}

/* video's voor de teams waar de coach lid van is */
let videoUnsubs = [];
function laadVideosVoorTeams(){
  videoUnsubs.forEach(u => u());
  videoUnsubs = [];
  const teamIds = S.teams.map(t => t.id);
  if (!teamIds.length){ S.videos = []; return; }
  const chunks = [];
  for (let i = 0; i < teamIds.length; i += 30) chunks.push(teamIds.slice(i, i+30));
  S.videos = [];
  chunks.forEach(c => {
    const q = query(collection(db,'videos'), where('teams','array-contains-any', c));
    const u = onSnapshot(q, snap => {
      const ids = new Set(snap.docs.map(d => d.id));
      S.videos = S.videos.filter(t => !c.some(tid => (t.teams||[]).includes(tid)) || ids.has(t.id));
      snap.docs.forEach(d => {
        const i = S.videos.findIndex(t => t.id === d.id);
        const data = {id:d.id, ...d.data()};
        if (i >= 0) S.videos[i] = data; else S.videos.push(data);
      });
      S.videos.sort((a,b) => (b.gemaakt?.seconds||0) - (a.gemaakt?.seconds||0));
      if (S.team) renderTeam();
    });
    videoUnsubs.push(u);
  });
}

/* ==================== WELKOM-STRIP ====================
   Klein, dagelijks wisselend blokje in de rode kop van het startscherm:
   weer bij Aarle-Rixtel (Open-Meteo, geen API-key nodig), de eerstvolgende
   wedstrijd uit al je eigen teams, en een Cruijff-citaat van de dag.
   Weer + wedstrijd worden 30 minuten gecachet (S._welkomCache) zodat een
   her-render door een Firestore-listener niet steeds opnieuw gaat fetchen. */
const CRUIJFF_QUOTES = [
  'Voetbal is simpel, maar het moeilijkste wat er is, is simpel voetballen.',
  'Elk nadeel heb z\'n voordeel.',
  'Je gaat het pas zien als je het doorhebt.',
  'Als je niet wint, is het logisch dat je verliest.',
  'Voordat ik een fout maak, maak ik die fout niet.',
  'Kwaliteit zonder snelheid is geen kwaliteit. Snelheid zonder kwaliteit is ook geen kwaliteit.',
  'Een goede trainer wordt geacht een fout op tijd te zien aankomen, en die dus te voorkomen.',
  'Zonder bal kun je niet winnen.',
  'Elke tijd heeft zijn eigen wijsheid.',
  'Waarom moeilijk doen als het makkelijk kan?',
  'Je moet schieten, anders kun je niet scoren.',
  'Ieder team dat wint, is een goed team; discussies komen daarna wel.',
  'Als je zelf de bal hebt, kan de tegenstander niet scoren.',
  'Ik heb nog nooit een club gezien die met geld op de bank kampioen is geworden.',
  'Voetballen is heel simpel, maar het simpelste is het moeilijkste wat er is.',
];
function cruijffVanVandaag(){
  const nu = new Date();
  const start = new Date(nu.getFullYear(), 0, 0);
  const dagVanJaar = Math.floor((nu - start) / 86400000);
  return CRUIJFF_QUOTES[dagVanJaar % CRUIJFF_QUOTES.length];
}

/* WMO-weercode -> emoji + kort label (Open-Meteo) */
function weerIcoon(code){
  if (code === 0) return ['☀️','helder'];
  if ([1,2].includes(code)) return ['🌤️','licht bewolkt'];
  if (code === 3) return ['☁️','bewolkt'];
  if ([45,48].includes(code)) return ['🌫️','mist'];
  if ([51,53,55,56,57].includes(code)) return ['🌦️','motregen'];
  if ([61,63,65].includes(code)) return ['🌧️','regen'];
  if ([66,67].includes(code)) return ['🌧️','ijzel'];
  if ([71,73,75,77].includes(code)) return ['❄️','sneeuw'];
  if ([80,81,82].includes(code)) return ['🌦️','buien'];
  if ([85,86].includes(code)) return ['🌨️','sneeuwbuien'];
  if ([95,96,99].includes(code)) return ['⛈️','onweer'];
  return ['🌡️',''];
}

async function weerOphalen(){
  try {
    // Aarle-Rixtel
    const url = 'https://api.open-meteo.com/v1/forecast?latitude=51.52&longitude=5.62&current=temperature_2m,weather_code&timezone=Europe%2FAmsterdam';
    const res = await fetch(url);
    const data = await res.json();
    const temp = Math.round(data.current.temperature_2m);
    const [ico] = weerIcoon(data.current.weather_code);
    return `${ico} ${temp}°`;
  } catch(e){ return null; }
}

async function eerstvolgendeWedstrijd(){
  const vandaag = new Date().toISOString().slice(0,10);
  let beste = null;
  for (const t of S.teams){
    try {
      const snap = await getDocs(query(collection(db,'teams',t.id,'wedstrijden'), where('datum','>=',vandaag)));
      snap.docs.forEach(d => {
        const w = d.data();
        if (!w.datum) return;
        if (!beste || w.datum < beste.datum) beste = { ...w, teamNaam: t.naam };
      });
    } catch(e){ /* geen toegang o.i.d., negeren */ }
  }
  if (!beste) return null;
  const thuisuit = beste.thuis ? 'thuis vs' : 'uit bij';
  return `⚽ ${datumNL(beste.datum)} · ${thuisuit} ${esc(beste.tegenstander || 'onbekend')}`;
}

function welkomStripInhoud(cache){
  const delen = [cache.weer, cache.wedstrijd].filter(Boolean);
  return `${delen.length ? `<div class="welkom-strip">${delen.map(d => `<span class="ws-item">${d}</span>`).join('')}</div>` : ''}
    <div class="welkom-cruijff">“${esc(cache.quote)}” <span>— Johan Cruijff</span></div>`;
}
function welkomStripHtml(){
  const vers = 30*60*1000;
  if (S._welkomCache && (Date.now() - S._welkomCache.tijd) < vers) return welkomStripInhoud(S._welkomCache);
  return `<div class="welkom-cruijff">“${esc(cruijffVanVandaag())}” <span>— Johan Cruijff</span></div>`;
}

async function welkomStripVullen(){
  const vers = 30*60*1000; // 30 minuten
  if (S._welkomCache && (Date.now() - S._welkomCache.tijd) < vers) return; // al vers genoeg, niets doen
  const [weer, wedstrijd] = await Promise.all([weerOphalen(), eerstvolgendeWedstrijd()]);
  S._welkomCache = { tijd: Date.now(), weer, wedstrijd, quote: S._welkomCache?.quote || cruijffVanVandaag() };
  const el = document.getElementById('welkomExtra');
  if (el) el.innerHTML = welkomStripInhoud(S._welkomCache);
}

/* ==================== NOG TE EVALUEREN ====================
   Tegel op het startscherm met gespeelde wedstrijden (over al je teams heen)
   die nog geen teamevaluatie hebben. Zelfde cache-aanpak als de welkom-strip:
   15 minuten geldig, plus meteen lokaal bijgewerkt na "negeren" zodat dat niet
   op een nieuwe fetch hoeft te wachten. */
async function nogTeEvaluerenOphalen(){
  const vandaag = new Date().toISOString().slice(0,10);
  const open = [];
  for (const t of S.teams){
    try {
      const [wSnap, eSnap] = await Promise.all([
        getDocs(query(collection(db,'teams',t.id,'wedstrijden'), where('datum','<=',vandaag))),
        getDocs(collection(db,'teams',t.id,'teamevaluaties')),
      ]);
      const geevalueerd = new Set(eSnap.docs.map(d => d.data().wedstrijdId));
      wSnap.docs.forEach(d => {
        const w = {id:d.id, ...d.data()};
        if (w.evaluatieGenegeerd || geevalueerd.has(w.id)) return;
        const gespeeld = (w.goals||[]).length || analyseWedstrijd(w).kwarten;
        if (!gespeeld) return;
        open.push({...w, teamId:t.id, teamNaam:t.naam});
      });
    } catch(e){ /* geen toegang o.i.d., dit team overslaan */ }
  }
  open.sort((a,b) => (b.datum||'').localeCompare(a.datum||''));
  return open;
}

function nogTeEvaluerenHtml(){
  const items = S._evalCache?.items;
  if (!items || !items.length) return '';
  return `
    <div class="sectie-kop" style="margin-top:4px">📝 Nog te evalueren</div>
    ${items.map(w => `
      <div class="lijst-item" data-eval-open="${w.id}" data-eval-team="${w.teamId}" style="cursor:pointer">
        <div class="team-shirt">⚽</div>
        <div class="li-tekst"><div class="titel">${esc(w.teamNaam)} – ${esc(w.tegenstander)}</div>
        <div class="meta">${datumNL(w.datum)}</div></div>
        <button data-eval-negeer="${w.id}" data-eval-negeer-team="${w.teamId}" title="Negeren" style="background:none;color:var(--ink-2);font-size:18px;padding:6px;flex-shrink:0">✕</button>
      </div>`).join('')}`;
}

async function nogTeEvaluerenVullen(){
  const vers = 15*60*1000;
  if (S._evalCache && (Date.now() - S._evalCache.tijd) < vers) return;
  const items = await nogTeEvaluerenOphalen();
  S._evalCache = { tijd: Date.now(), items };
  const el = document.getElementById('nogTeEvalueren');
  if (el){ el.innerHTML = nogTeEvaluerenHtml(); koppelNogTeEvalueren(el); }
}
function koppelNogTeEvalueren(el){
  el.querySelectorAll('[data-eval-open]').forEach(r => r.onclick = () => {
    S._pendingOpenWedstrijd = r.dataset.evalOpen;
    openTeam(r.dataset.evalTeam, 'wedstrijden');
  });
  el.querySelectorAll('[data-eval-negeer]').forEach(b => b.onclick = async (e) => {
    e.stopPropagation();
    const wid = b.dataset.evalNegeer, tid = b.dataset.evalNegeerTeam;
    try { await updateDoc(doc(db,'teams',tid,'wedstrijden',wid), {evaluatieGenegeerd:true}); }
    catch(err){ meld('Negeren mislukt: '+(err.code||err.message)); return; }
    if (S._evalCache) S._evalCache.items = S._evalCache.items.filter(w => w.id !== wid);
    const wrap = document.getElementById('nogTeEvalueren');
    if (wrap){ wrap.innerHTML = nogTeEvaluerenHtml(); koppelNogTeEvalueren(wrap); }
  });
}

export function renderTeams(){
  const v = $('#view-teams');
  const aantalOngelezen = S.trainingen.filter(t =>
    (t.teams||[]).some(tid => S.teams.find(x => x.id === tid)) && !S.trainingenGelezen[t.id]).length;

  // Persoonlijke begroeting: voornaam + datum van vandaag, voluit in het Nederlands
  // De naam die de coach zelf instelde staat in ledenInfo van zijn teams/clubs;
  // die heeft voorrang op de Google-naam of het e-mailadres.
  let ingesteldeNaam = '';
  for (const t of S.teams){ const n = t.ledenInfo?.[S.user.uid]?.naam; if (n){ ingesteldeNaam = n; break; } }
  if (!ingesteldeNaam) for (const c of S.clubs){ const n = c.ledenInfo?.[S.user.uid]?.naam; if (n){ ingesteldeNaam = n; break; } }
  const naam = (ingesteldeNaam || S.user.displayName || S.user.email || '').trim();
  const voornaam = naam ? naam.split(/[ @.]/)[0] : '';
  const voornaamMooi = voornaam ? voornaam.charAt(0).toUpperCase() + voornaam.slice(1) : '';
  let vandaag = '';
  try { vandaag = new Date().toLocaleDateString('nl-NL',{weekday:'long',day:'numeric',month:'long'}); } catch(e){}
  vandaag = vandaag.charAt(0).toUpperCase() + vandaag.slice(1);

  // Overzichtsblokjes tonen we alleen aan gewone coaches met minstens één team
  const toonOverzicht = S.teams.length > 0;

  v.innerHTML = `
    <div class="welkom-kop">
      <div class="welkom-tekst">
        <div class="welkom-datum">${esc(vandaag)}</div>
        <h1 class="welkom-groet">Hoi ${esc(voornaamMooi || 'coach')} 👋</h1>
        <div id="welkomExtra">${welkomStripHtml()}</div>
      </div>
      <button class="uitlog-knop" id="uitloggen" title="Uitloggen"><span>⏻</span></button>
    </div>

    <div id="pwaBanner"></div>

    ${toonOverzicht ? `
    <div class="overzicht-blokjes">
      <button class="ov-blok ${aantalOngelezen ? 'ov-actief' : ''}" id="ovTrainingen">
        <div class="ov-getal">${aantalOngelezen || '📄'}</div>
        <div class="ov-label">${aantalOngelezen ? `nieuwe training${aantalOngelezen>1?'en':''}` : 'trainingen'}</div>
      </button>
      <button class="ov-blok ov-wedstrijden" id="ovWedstrijden">
        <div class="ov-getal">📋</div>
        <div class="ov-label">wedstrijden</div>
      </button>
    </div>` : ''}

    <div id="nogTeEvalueren">${nogTeEvaluerenHtml()}</div>

    ${S.clubs.length ? `<div class="sectie-kop" style="margin-top:4px">Clubs die je beheert</div>
      ${S.clubs.map(c => `
        <button class="lijst-item" data-open-club="${c.id}">
          <div class="club-shirt">🏛</div>
          <div class="li-tekst"><div class="titel">${esc(c.naam)} <span class="club-badge">admin</span></div>
          <div class="meta">${Object.keys(c.teams||{}).length} teams</div></div>
          <span class="pijl">›</span>
        </button>`).join('')}` : ''}

    ${S.teams.length ? `<div class="sectie-kop">Mijn teams</div>
      ${S.teams.map(t => `
        <button class="lijst-item" data-open-team="${t.id}">
          <div class="team-shirt">${esc(t.format)}<small>v${esc(t.format)}</small></div>
          <div class="li-tekst"><div class="titel">${esc(t.naam)}${t.club ? ' <span class="club-badge licht">'+esc(t.clubNaam||'club')+'</span>' : ''}</div>
          <div class="meta">${Object.keys(t.leden||{}).length} coach(es) · code ${esc(t.code)}</div></div>
          <span class="pijl">›</span>
        </button>`).join('')}`
      : !S.clubs.length ? `<div class="kaart leeg">Nog geen teams.<br>${isBeheerder()
          ? '<b>Maak een team aan</b>, sluit je aan met een teamcode, of <b>start een club</b> om meerdere teams te beheren.'
          : 'Vraag je hoofdtrainer om een uitnodigingslink, of sluit je aan met een teamcode die je hebt gekregen.'}</div>` : ''}

    ${isBeheerder() ? `
    <div class="rij" style="margin-top:14px">
      <button class="knop vol" id="nieuwTeam">+ Nieuw team</button>
      <button class="knop licht vol" id="joinTeam">Code invoeren</button>
    </div>
    <button class="knop club-knop vol" id="nieuwClub" style="margin-top:8px">🏛 Nieuwe club aanmaken</button>`
    : `
    <button class="knop licht vol" id="joinTeam" style="margin-top:14px">Aansluiten met teamcode</button>`}`;

  v.querySelector('#uitloggen').onclick = () => doSignOut();
  v.querySelectorAll('[data-open-team]').forEach(b => b.onclick = () => openTeam(b.dataset.openTeam));
  v.querySelectorAll('[data-open-club]').forEach(b => b.onclick = () => import('./club.js').then(m => m.openClub(b.dataset.openClub)));
  const nt = v.querySelector('#nieuwTeam'); if (nt) nt.onclick = () => modalNieuwTeam();
  v.querySelector('#joinTeam').onclick = modalJoinTeam;
  const nc = v.querySelector('#nieuwClub'); if (nc) nc.onclick = () => import('./club.js').then(m => m.modalNieuwClub());

  // Overzichtsblokjes
  const ovT = v.querySelector('#ovTrainingen');
  if (ovT) ovT.onclick = () => {
    // open het eerste team met een ongelezen training; anders gewoon het eerste team op het training-tabblad
    let doel = S.teams[0];
    for (const t of S.teams){
      if (S.trainingen.some(tr => (tr.teams||[]).includes(t.id) && !S.trainingenGelezen[tr.id])){ doel = t; break; }
    }
    if (doel) openTeam(doel.id, 'trainingen');
  };
  const ovW = v.querySelector('#ovWedstrijden');
  if (ovW) ovW.onclick = () => {
    if (S.teams.length) openTeam(S.teams[0].id, 'wedstrijden');
  };

  const nogTeEvaluerenEl = v.querySelector('#nogTeEvalueren');
  if (nogTeEvaluerenEl) koppelNogTeEvalueren(nogTeEvaluerenEl);

  tekenPwaBanner();
  welkomStripVullen();
  nogTeEvaluerenVullen();
}

export function modalNieuwTeam(clubId = null){
  const clubT = clubId ? S.clubs.find(c => c.id === clubId) : null;
  const subOpties = Array.from({length:12}, (_,i) => `<option value="${i+1}">${i+1}</option>`).join('');
  openModal(`
    <h2>${clubT ? 'Nieuw team voor '+esc(clubT.naam) : 'Nieuw team'}</h2>
    <div class="veldgroep"><label>Jongens of meiden</label>
      <div class="segment" id="mTeamGeslacht">
        <button data-g="j" class="actief">Jongens (JO)</button>
        <button data-g="m">Meiden (MO)</button>
      </div></div>
    <div class="rij">
      <div class="veldgroep" style="flex:2"><label>Categorie</label>
        <select class="invoer" id="mTeamCat"></select></div>
      <div class="veldgroep" style="flex:1"><label>Team</label>
        <select class="invoer" id="mTeamSub">${subOpties}</select></div>
    </div>
    <div class="veldgroep"><label>Teamnaam</label>
      <input class="invoer" id="mTeamNaam" autocomplete="off"></div>
    <div class="kaart" style="margin-bottom:14px"><p style="font-size:13px;color:var(--ink-2)" id="mTeamKnvb"></p></div>
    <button class="knop vol" id="mTeamOk">Team aanmaken</button>`);
  let geslacht = 'j';
  const vulCategorieen = () => {
    const lijst = geslacht === 'j' ? CATEGORIEEN : CATEGORIEEN_MEIDEN;
    $('#mTeamCat').innerHTML = Object.keys(lijst).map(c => `<option value="${c}">${c}</option>`).join('');
  };
  const werkBij = () => {
    const cat = $('#mTeamCat').value;
    const c = catInfo(cat);
    const sub = $('#mTeamSub').value;
    $('#mTeamNaam').value =
      cat === 'Senioren' ? (sub === '1' ? 'Eerste elftal' : 'Senioren '+sub) :
      cat === 'Vrouwen'  ? (sub === '1' ? 'Vrouwen 1' : 'Vrouwen '+sub) :
      cat + '-' + sub;
    $('#mTeamKnvb').innerHTML = `<b>KNVB ${esc(cat)}:</b> ${esc(c.knvb)}<br>De app stelt automatisch ${c.periodes === 2 ? '2 helften' : '4 kwarten'} van ${String(c.duur).replace('.',',')} minuten in. Per wedstrijd aan te passen.`;
  };
  $$('#mTeamGeslacht button').forEach(b => b.onclick = () => {
    $$('#mTeamGeslacht button').forEach(x=>x.classList.remove('actief')); b.classList.add('actief');
    geslacht = b.dataset.g; vulCategorieen(); werkBij();
  });
  $('#mTeamCat').onchange = werkBij;
  $('#mTeamSub').onchange = werkBij;
  vulCategorieen(); werkBij();
  $('#mTeamOk').onclick = async () => {
    const naam = $('#mTeamNaam').value.trim();
    if (!naam) return meld('Geef het team een naam');
    const cat = $('#mTeamCat').value;
    const afk = clubT ? clubAfkorting(clubT.naam) : '';
    const bestaande = [...S.teams.map(t => t.code), ...(S.clubTeams||[]).map(t => t.code)].filter(Boolean);
    const data = {
      naam, categorie: cat, geslacht, format: catInfo(cat).format,
      code: teamCode(naam, afk, bestaande),
      leden: {[S.user.uid]: true},
      ledenInfo: {[S.user.uid]: {naam: S.user.displayName || S.user.email}},
      gemaakt: serverTimestamp(),
    };
    if (clubT){ data.club = clubT.id; data.clubNaam = clubT.naam; }
    const ref = await addDoc(collection(db,'teams'), data);
    if (clubT) await updateDoc(doc(db,'clubs',clubT.id), {['teams.'+ref.id]: true});
    sluitModal();
    if (clubT) import('./club.js').then(m => m.openClub(clubT.id));
    else openTeam(ref.id);
  };
}

function modalJoinTeam(){
  openModal(`
    <h2>Aansluiten bij team</h2>
    <p style="font-size:13.5px;color:var(--ink-2);margin-bottom:12px">Vraag de teamcode aan een coach van het team (te vinden onder het tabblad Team).</p>
    <div class="veldgroep"><input class="invoer" id="mCode" placeholder="ASVJO11-1" maxlength="20"
      style="text-transform:uppercase;text-align:center;font-family:'Barlow Condensed';font-size:22px;letter-spacing:2px"></div>
    <button class="knop vol" id="mCodeOk">Aansluiten</button>`);
  $('#mCodeOk').onclick = async () => {
    const code = $('#mCode').value.trim().toUpperCase();
    if (code.length < 4) return meld('Vul een geldige teamcode in');
    const t = await joinMetCode(code);
    if (t){ sluitModal(); meld('Aangesloten bij ' + t.data().naam); openTeam(t.id); }
  };
}

/* ==================== TEAM OPENEN ==================== */
export function openTeam(teamId, beginTab = 'trainingen', opties = {}){
  S.teamId = teamId; S.teamTab = beginTab;
  S._pendingNieuweWedstrijd = !!opties.nieuweWedstrijd;
  // presentie altijd ingeklapt openen bij elke teamopening (alle maanden dicht)
  S._presentieOpen = new Set();
  S._presentieToonAlles = new Set();
  stopUnsubs('team','spelers','wedstrijden','presentie','planning','beoordelingen','teamevaluaties','seizoen');
  const luisterfout = (naam) => (err) => {
    console.error(`[Cluppie] Listener "${naam}" kon niet lezen (teamId=${teamId}):`, err.code, err.message);
    if (err.code === 'permission-denied') meld(`Geen toegang tot "${naam}" — controleer de Firestore-rules`);
  };
  S.unsub.team = onSnapshot(doc(db,'teams',teamId), snap => {
    if (!snap.exists()){ verlaatTeamView(); return; }
    S.team = {id:snap.id, ...snap.data()};
    if (S.team.club && !S.unsub.uitleningen) startUitleningenListener(teamId);
    if (S.team.club && !S.unsub.seizoen) startSeizoenListener(teamId);
    if (!S.team.club) S.huidigSeizoen = SEIZOEN_FALLBACK; // los team zonder club: geen seizoenbeheer
    if (!S.wedstrijdId) renderTeam();
  }, luisterfout('team'));
  S.unsub.spelers = onSnapshot(collection(db,'teams',teamId,'spelers'), snap => {
    S.spelers = snap.docs.map(d => ({id:d.id, ...d.data()}))
      .sort((a,b) => (a.nummer ?? 999) - (b.nummer ?? 999) || a.naam.localeCompare(b.naam));
    if (!S.wedstrijdId) renderTeam(); else renderWedstrijd();
  }, luisterfout('spelers'));
  S.unsub.wedstrijden = onSnapshot(collection(db,'teams',teamId,'wedstrijden'), snap => {
    S.wedstrijden = snap.docs.map(d => ({id:d.id, ...d.data()}))
      .sort((a,b) => (b.datum||'').localeCompare(a.datum||''));
    if (!S.wedstrijdId) renderTeam();
    // gevraagd om meteen een nieuwe wedstrijd te starten? Doe dat zodra alles geladen is.
    if (S._pendingNieuweWedstrijd){
      S._pendingNieuweWedstrijd = false;
      modalNieuweWedstrijd();
    }
    // vanaf de "nog te evalueren"-tegel op het startscherm: direct naar de
    // juiste wedstrijd + evaluatiemodal zodra de wedstrijddata geladen is.
    if (S._pendingOpenWedstrijd){
      const wid = S._pendingOpenWedstrijd; S._pendingOpenWedstrijd = null;
      if (S.wedstrijden.some(w => w.id === wid)){
        openWedstrijd(wid);
        modalTeamEvaluatie(wid);
      }
    }
  }, luisterfout('wedstrijden'));
  S.unsub.presentie = onSnapshot(collection(db,'teams',teamId,'presentie'), snap => {
    S.presentie = snap.docs.map(d => ({id:d.id, ...d.data()}))
      .sort((a,b) => (b.datum||'').localeCompare(a.datum||''));
    if (!S.wedstrijdId && S.teamTab === 'trainingen') renderTeam();
  }, luisterfout('presentie'));
  S.unsub.planning = onSnapshot(collection(db,'teams',teamId,'planning'), snap => {
    S.planning = snap.docs.map(d => ({id:d.id, ...d.data()}));
    if (!S.wedstrijdId && S.teamTab === 'planning') renderTeam();
  }, luisterfout('planning'));
  // Eigen listener voor beoordelingen — los van de wedstrijd-listener, zodat
  // updates van een andere coach niet wegvallen (zie listener-architectuur).
  S.unsub.beoordelingen = onSnapshot(collection(db,'teams',teamId,'beoordelingen'), snap => {
    S.beoordelingen = snap.docs.map(d => ({id:d.id, ...d.data()}))
      .sort((a,b) => (b.datum||'').localeCompare(a.datum||'') || (b.gemaaktMs||0) - (a.gemaaktMs||0));
    if (!S.wedstrijdId && (S.teamTab === 'spelers' || S._beoordeelProfiel)) renderTeam();
  }, luisterfout('beoordelingen'));
  // Teamevaluaties (na de wedstrijd) — eigen listener, zodat het dashboard in
  // de Stats-tab en de "team evalueren"-knop op het wedstrijdscherm beide
  // realtime dezelfde data zien, ook als een collega-coach 'm net invulde.
  S.unsub.teamevaluaties = onSnapshot(collection(db,'teams',teamId,'teamevaluaties'), snap => {
    S.teamEvaluaties = snap.docs.map(d => ({id:d.id, ...d.data()}))
      .sort((a,b) => (a.datum||'').localeCompare(b.datum||''));
    if (!S.wedstrijdId && S.teamTab === 'stats') renderTeam();
  }, luisterfout('teamevaluaties'));
  toon('team');
}

/* Houdt S.huidigSeizoen synchroon met clubs/{clubId}.huidigSeizoen, zodat elk
   nieuw document (wedstrijd, presentie, beoordeling, teamevaluatie) bij het
   aanmaken automatisch het juiste seizoen-label krijgt. Zonder veld (nog geen
   "Nieuw seizoen starten" gebruikt) valt terug op SEIZOEN_FALLBACK. */
function startSeizoenListener(teamId){
  const clubId = S.team?.club;
  if (!clubId){ S.huidigSeizoen = SEIZOEN_FALLBACK; return; }
  if (S.unsub.seizoen){ S.unsub.seizoen(); delete S.unsub.seizoen; }
  S.unsub.seizoen = onSnapshot(doc(db,'clubs',clubId), snap => {
    S.huidigSeizoen = snap.data()?.huidigSeizoen || SEIZOEN_FALLBACK;
  }, (err) => {
    console.error(`[Cluppie] Listener "seizoen" kon niet lezen (clubId=${clubId}):`, err.code, err.message);
    if (err.code === 'permission-denied') meld('Kon seizoensinstelling niet laden — controleer de Firestore-rules');
  });
}
function startUitleningenListener(teamId){
  const clubId = S.team?.club;
  if (!clubId){ return; }              // los team zonder club: geen uitleningen
  if (S.unsub.uitleningen){ S.unsub.uitleningen(); delete S.unsub.uitleningen; }
  S.unsub.uitleningen = onSnapshot(collection(db,'clubs',clubId,'uitleningen'), snap => {
    const alle = snap.docs.map(d => ({id:d.id, ...d.data()}));
    S.uitleningenUit = alle.filter(u => u.vanTeam === teamId);
    S.uitleningenIn  = alle.filter(u => u.naarTeam === teamId);
    if (!S.wedstrijdId && (S.teamTab === 'spelers' || S._beoordeelProfiel)) renderTeam();
  }, (err) => {
    console.error(`[Cluppie] Listener "uitleningen" kon niet lezen (clubId=${clubId}):`, err.code, err.message);
    if (err.code === 'permission-denied') meld('Kon uitleningen niet laden — controleer de Firestore-rules');
  });
}
export function verlaatTeamView(){
  stopUnsubs('team','spelers','wedstrijden','presentie','planning','beoordelingen','uitleningen','teamevaluaties','seizoen');
  S.teamId = null; S.team = null; S.spelers = []; S.wedstrijden = []; S.planning = [];
  S.uitleningenUit = []; S.uitleningenIn = []; S.teamEvaluaties = [];
  renderTeams(); toon('teams');
}

export function renderTeam(){
  if (!S.team) return;
  const v = $('#view-team');
  const tab = S.teamTab;
  let inhoud = '';
  if (tab === 'wedstrijden') inhoud = htmlWedstrijden();
  if (tab === 'spelers')     inhoud = S._leenProfiel ? htmlLeenProfiel() : (S._beoordeelProfiel ? htmlProfiel() : htmlSpelers());
  if (tab === 'planning')    inhoud = htmlPlanning();
  if (tab === 'stats')       inhoud = htmlStatsTab();
  if (tab === 'trainingen')  inhoud = htmlTeamTrainingen();
  if (tab === 'videos')      inhoud = htmlTeamVideos();
  if (tab === 'instellingen')inhoud = htmlInstellingen();
  if (tab === 'help')        inhoud = htmlHandleiding();

  const teamTrainingen = S.trainingen.filter(t => (t.teams||[]).includes(S.teamId));
  const ongelezen = teamTrainingen.filter(t => !S.trainingenGelezen[t.id]).length;

  const profielOpen = (tab === 'spelers' && (S._beoordeelProfiel || S._leenProfiel));
  v.innerHTML = `
    ${profielOpen ? '' : `<div class="kop"><button class="terug" id="naarTeams">‹</button>
      <h1>${esc(S.team.naam)}<span class="sub">${S.team.categorie ? esc(S.team.categorie)+' · ' : ''}${esc(S.team.format)} tegen ${esc(S.team.format)}</span></h1>
      <button class="terug" id="teamInstel" title="Teaminstellingen">⚙️</button></div>`}
    ${inhoud}
    <nav class="onderbalk">
      ${[['wedstrijden','Wedstr.'],['spelers','Spelers'],['planning','Planning'],['trainingen','Training'],['videos','Video'],['stats','Stats'],['help','Help']]
        .map(([id,naam]) => `<button data-tab="${id}" class="${tab===id?'actief':''}"><span class="ico">${NAV_ICON[id]}</span><span class="tablabel">${naam}${id==='trainingen' && ongelezen ? '<span class="puntje"></span>' : ''}</span></button>`).join('')}
    </nav>`;

  const naarTeamsBtn = v.querySelector('#naarTeams');
  if (naarTeamsBtn) naarTeamsBtn.onclick = () => history.back();
  const teamInstelBtn = v.querySelector('#teamInstel');
  if (teamInstelBtn) teamInstelBtn.onclick = () => { S.teamTab = 'instellingen'; renderTeam(); };
  v.querySelectorAll('[data-tab]').forEach(b => b.onclick = () => {
    S._beoordeelProfiel = null; S._leenProfiel = null;
    // presentie altijd ingeklapt tonen zodra je (terug) op de Trainingen-tab klikt
    if (b.dataset.tab === 'trainingen'){ S._presentieOpen = new Set(); S._presentieToonAlles = new Set(); S._kompasIdx = null; }
    S.teamTab = b.dataset.tab; renderTeam();
  });
  koppelTeamTab(v, tab);
}

/* ---------- Tab: wedstrijden ---------- */
function htmlWedstrijden(){
  return `
    <button class="knop vol" id="nieuweWedstrijd" style="margin-bottom:14px">+ Nieuwe wedstrijd</button>
    ${S.wedstrijden.length ? S.wedstrijden.map(w => {
      const voor = (w.goals||[]).filter(g => g.type==='voor').length;
      const tegen = (w.goals||[]).filter(g => g.type==='tegen').length;
      const uitslag = (w.goals||[]).length || analyseWedstrijd(w).kwarten
        ? (w.thuis ? `${voor}–${tegen}` : `${tegen}–${voor}`) : '';
      const titel = w.type === 'toernooi'
        ? '🏆 ' + esc(w.tegenstander)
        : (w.thuis ? esc(S.team.naam)+' – '+esc(w.tegenstander) : esc(w.tegenstander)+' – '+esc(S.team.naam));
      const meta = w.type === 'toernooi'
        ? `${datumNL(w.datum)} · ${w.toernooi.wedstrijden} wedstrijden · ${esc(w.format)}v${esc(w.format)}`
        : `${datumNL(w.datum)} · ${esc(w.format)}v${esc(w.format)} · ${esc(w.formatie)}`;
      return `
      <button class="lijst-item" data-open-w="${w.id}">
        <div class="li-tekst"><div class="titel">${titel}</div>
        <div class="meta">${meta}</div></div>
        ${uitslag ? `<span class="badge" style="font-family:'Barlow Condensed';font-size:15px;font-weight:700">${uitslag}</span>` : ''}
        <span class="pijl">›</span></button>`;
    }).join('')
    : `<div class="kaart leeg">Nog geen wedstrijden.<br>Maak je eerste wedstrijd aan en zet de opstelling per kwart klaar.</div>`}`;
}

/* ---------- Tab: spelers ---------- */
/* ---------- Tab: seizoensplanning ----------
   PLAN_TYPE/PLAN_FILTERS/PLAN_MAANDEN horen hier (i.p.v. in teams-spelers.js)
   omdat ze uitsluitend door planningItems()/htmlPlanning() hieronder gebruikt
   worden. */
const PLAN_TYPE = {
  wedstrijd: {kort:'⚽', klas:'wedstrijd', naam:'Wedstrijd'},
  wd:     {kort:'WD',   klas:'wd',     naam:'Wedstrijddag'},
  beker:  {kort:'BEK',  klas:'beker',  naam:'Beker'},
  inhaal: {kort:'INH',  klas:'inhaal', naam:'Inhaal'},
  vrij:   {kort:'VRIJ', klas:'vrij',   naam:'Vrij'},
  eigen:  {kort:'',     klas:'eigen',  naam:'Eigen dag'},
};
const PLAN_FILTERS = [
  ['alles','Alles'], ['wedstrijd','Wedstrijden'], ['wd','Speeldagen'], ['beker','Beker'], ['vrij','Vrij'],
];
const PLAN_MAANDEN = ['januari','februari','maart','april','mei','juni','juli','augustus','september','oktober','november','december'];

/* combineer KNVB-kalender + Firestore-aanpassingen + eigen dagen tot één gesorteerde lijst.
   Override-docs hebben id 'knvb_<datum>' en kunnen {verborgen:true} of een nieuw label/type zetten.
   Eigen dagen zijn losse docs met bron:'eigen'. */
function planningItems(){
  const team = S.team;
  if (!team) return [];
  const knvb = knvbKalenderVoorTeam(team);
  const overrides = {};
  const eigen = [];
  for (const p of (S.planning||[])){
    if (p.bron === 'eigen') eigen.push(p);
    else if (p.id && p.id.startsWith('knvb_')) overrides[p.datum] = p;
  }
  // echte wedstrijden (geïmporteerd + zelf aangemaakt) — datums waarop er één staat
  const wedstrijdDatums = new Set((S.wedstrijden||[]).map(w => w.datum).filter(Boolean));

  const items = [];
  for (const k of knvb){
    const ov = overrides[k.d];
    if (ov && ov.verborgen) continue;
    // echte wedstrijd vervangt de generieke KNVB-wedstrijddag op dezelfde datum
    if (k.t === 'wd' && wedstrijdDatums.has(k.d) && !(ov && ov.aangepast)) continue;
    items.push({
      bron: 'knvb',
      docId: ov ? ov.id : null,
      datum: k.d,
      type: (ov && ov.type) || k.t,
      label: (ov && ov.label) || k.l,
      opmerking: ov && 'opmerking' in ov ? ov.opmerking : (k.n || ''),
      aangepast: !!ov,
    });
  }
  for (const e of eigen){
    items.push({
      bron: 'eigen', docId: e.id, datum: e.datum,
      type: e.type || 'eigen', label: e.label || 'Eigen dag',
      opmerking: e.opmerking || '', aangepast: false,
    });
  }
  for (const w of (S.wedstrijden||[])){
    if (!w.datum) continue;
    const voor = (w.goals||[]).filter(g => g.type==='voor').length;
    const tegen = (w.goals||[]).filter(g => g.type==='tegen').length;
    const heeftUitslag = (w.goals||[]).length > 0;
    const uitslag = heeftUitslag ? (w.thuis ? `${voor}–${tegen}` : `${tegen}–${voor}`) : '';
    const eigen = team.naam || 'ASV\'33';
    const tegenstander = w.tegenstander || '?';
    // thuis kan bij een nog niet geopende geïmporteerde wedstrijd ontbreken;
    // standaard tonen we eigen team links (thuis), zodat 'wie tegen wie' altijd in beeld is.
    const label = w.type === 'toernooi'
      ? '🏆 ' + (w.tegenstander || 'Toernooi')
      : (w.thuis === false ? `${tegenstander} – ${eigen}` : `${eigen} – ${tegenstander}`);
    const sub = [w.tijd || '', uitslag].filter(Boolean).join(' · ');
    items.push({
      bron: 'wedstrijd', docId: w.id, datum: w.datum,
      type: 'wedstrijd', label, opmerking: sub, aangepast: false,
      wedstrijdId: w.id,
    });
  }
  return items.sort((a,b) =>
    a.datum.localeCompare(b.datum) || (a.bron==='wedstrijd'?-1:1) - (b.bron==='wedstrijd'?-1:1));
}

function htmlPlanning(){
  const filter = S._planningFilter || 'alles';
  let items = planningItems();
  if (filter !== 'alles'){
    items = items.filter(it => it.type === filter);
  }
  // standaard: verleden maanden ingeklapt. _planningDichteMaanden = expliciet gesloten set;
  // bij eerste render vullen we 'm met alle maanden vóór de huidige.
  if (S._planningDichteMaanden === null){
    S._planningDichteMaanden = new Set();
    const nu = new Date().toISOString().slice(0,7);
    for (const it of items){
      const ym = it.datum.slice(0,7);
      if (ym < nu) S._planningDichteMaanden.add(ym);
    }
  }
  const dicht = S._planningDichteMaanden;

  const chips = PLAN_FILTERS.map(([id,lbl]) =>
    `<button class="plan-chip ${filter===id?'aan':''}" data-planfilter="${id}">${lbl}</button>`).join('');

  let body = '';
  if (!items.length){
    body = `<div class="kaart leeg">Geen speeldagen voor dit filter.</div>`;
  } else {
    // groepeer per maand (jaar-maand)
    const perMaand = {};
    for (const it of items){
      const ym = it.datum.slice(0,7);
      (perMaand[ym] ||= []).push(it);
    }
    const nu = new Date().toISOString().slice(0,10);
    body = Object.keys(perMaand).sort().map(ym => {
      const [jr,mn] = ym.split('-');
      const maandNaam = PLAN_MAANDEN[Number(mn)-1];
      const open = !dicht.has(ym);
      const rijen = perMaand[ym].map(it => {
        const ti = PLAN_TYPE[it.type] || PLAN_TYPE.eigen;
        const dt = new Date(it.datum+'T12:00');
        const dag = dt.getDate();
        const wdag = dt.toLocaleDateString('nl-NL',{weekday:'short'}).replace('.','');
        const isVerleden = it.datum < nu;
        const badge = ti.kort ? `<span class="plan-badge ${ti.klas}">${ti.kort}</span>` : `<span class="plan-bewerk">✎</span>`;
        const opm = it.opmerking ? `<div class="plan-sub">${esc(it.opmerking)}</div>`
          : (it.bron === 'eigen' ? `<div class="plan-sub eigen">Eigen dag</div>` : '');
        return `
          <button class="plan-rij ${ti.klas} ${isVerleden?'verleden':''}" data-plandag="${it.datum}" data-planbron="${it.bron}" data-plandoc="${it.docId||''}">
            <div class="plan-datum"><span class="d">${dag}</span><span class="w">${wdag}</span></div>
            <div class="plan-tekst"><div class="plan-titel">${esc(it.label)}${it.aangepast?' <span class="plan-mark">·aangepast</span>':''}</div>${opm}</div>
            ${badge}
          </button>`;
      }).join('');
      return `
        <div class="plan-maand">
          <button class="plan-maand-kop" data-planmaand="${ym}">
            <span>${maandNaam} ${jr}</span>
            <span class="plan-aantal">${perMaand[ym].length}</span>
            <span class="plan-pijl">${open?'▾':'▸'}</span>
          </button>
          ${open ? `<div class="plan-lijst">${rijen}</div>` : ''}
        </div>`;
    }).join('');
  }

  return `
    <div class="plan-kop">
      <div class="plan-seizoen">Seizoen ${esc(KNVB_SEIZOEN)}</div>
      <button class="knop vol klein" id="planEigenDag">+ Eigen dag</button>
    </div>
    <div class="plan-chips">${chips}</div>
    ${body}`;
}

/* ---------- Afgelasting (clubbreed) ----------
   De beheerder schrijft de afgelasting weg naar ALLE team-documenten van de club
   (zie modalClubAflasten in club.js). Elk team toont 'm hier zolang de datum geldig is.
   Geen naam in de banner of het WhatsApp-bericht. */
function koppelTeamTab(v, tab){
  if (tab === 'stats'){
    v.querySelectorAll('[data-statsmodus]').forEach(b => b.onclick = () => {
      S.statsSubTab = b.dataset.statsmodus; renderTeam();
    });
    v.querySelectorAll('[data-seizoenfilter]').forEach(b => b.onclick = () => {
      S.statsSeizoen = b.dataset.seizoenfilter; S._histAlles = false; renderTeam();
    });
    v.querySelectorAll('[data-thema-info]').forEach(el => el.onclick = () => toonThemaInfo(el.dataset.themaInfo));
    v.querySelectorAll('[data-open-teameval]').forEach(el => el.onclick = () => modalTeamEvaluatie(el.dataset.openTeameval));
    const histMeerBtn = v.querySelector('[data-hist-toon-meer]');
    if (histMeerBtn) histMeerBtn.onclick = () => { S._histAlles = true; renderTeam(); };
  }
  if (tab === 'planning'){
    const eigenBtn = v.querySelector('#planEigenDag');
    if (eigenBtn) eigenBtn.onclick = () => modalEigenDag();
    v.querySelectorAll('[data-planfilter]').forEach(b => b.onclick = () => {
      S._planningFilter = b.dataset.planfilter; renderTeam();
    });
    v.querySelectorAll('[data-planmaand]').forEach(b => b.onclick = () => {
      const ym = b.dataset.planmaand;
      if (S._planningDichteMaanden.has(ym)) S._planningDichteMaanden.delete(ym);
      else S._planningDichteMaanden.add(ym);
      renderTeam();
    });
    v.querySelectorAll('[data-plandag]').forEach(b => b.onclick = () => {
      const datum = b.dataset.plandag;
      const bron = b.dataset.planbron;
      if (bron === 'wedstrijd'){
        const wid = b.dataset.plandoc;
        if (wid) openWedstrijd(wid);
        return;
      }
      const it = planningItems().find(x => x.datum === datum && x.bron === bron);
      if (it) modalPlanDag(it);
    });
  }
  if (tab === 'trainingen'){
    // ASV-kompas: tik op de tekst voor achtergrond/tips
    const kompasTekst = v.querySelector('[data-kompas-info]');
    if (kompasTekst) kompasTekst.onclick = () => toonKompasInfo(S._kompasIdx ?? kompasIndexVoorWeek(kompasTips().length));
    // ASV-kompas: handmatig bladeren door de tips (blijft lokaal, reset bij heropenen tab)
    v.querySelectorAll('[data-kompas]').forEach(b => b.onclick = () => {
      const totaal = kompasTips().length;
      const huidig = S._kompasIdx ?? kompasIndexVoorWeek(totaal);
      S._kompasIdx = b.dataset.kompas === 'volgende'
        ? (huidig + 1) % totaal
        : (huidig - 1 + totaal) % totaal;
      renderTeam();
    });
    // afgelasting doorsturen naar eigen teamgroep
    const afgDeel = v.querySelector('#afgelastDeel');
    if (afgDeel) afgDeel.onclick = () => {
      const a = afgelastGeldig();
      if (!a) return;
      const tekst = encodeURIComponent(afgelastWhatsappTekst(a));
      window.open('https://wa.me/?text=' + tekst, '_blank');
    };
    v.querySelectorAll('[data-open-training]').forEach(r => r.onclick = async () => {
      const id = r.dataset.openTraining;
      const t = S.trainingen.find(x => x.id === id);
      const datum = t?.gemaakt?.seconds ? new Date(t.gemaakt.seconds*1000).toLocaleDateString('nl-NL',{day:'numeric',month:'short'}) : '';
      const { openPdfViewer } = await import('./pdf-viewer.js');
      openPdfViewer({
        url: r.dataset.url,
        titel: t?.titel || t?.bestandsnaam || 'Training',
        meta: [t?.week, datum].filter(Boolean).join(' · ')
      });
      if (!S.trainingenGelezen[id]){
        try { await setDoc(doc(db,'gebruikers',S.user.uid,'gelezen',id), {tijd: serverTimestamp()}); } catch(e){}
      }
    });
    const pv = v.querySelector('#presentieVandaag');
    if (pv) pv.onclick = () => modalPresentie();
    v.querySelectorAll('[data-presentie]').forEach(r => r.onclick = () => {
      const p = S.presentie.find(x => x.id === r.dataset.presentie);
      if (p) modalPresentie(p);
    });
    // maand in-/uitklappen (presentie)
    v.querySelectorAll('[data-maand]').forEach(b => b.onclick = () => {
      const ym = b.dataset.maand;
      if (S._presentieOpen.has(ym)){ S._presentieOpen.delete(ym); S._presentieToonAlles.delete(ym); }
      else S._presentieOpen.add(ym);
      renderTeam();
    });
    // alle trainingen van een maand tonen (presentie)
    v.querySelectorAll('[data-toonmeer]').forEach(b => b.onclick = (e) => {
      e.stopPropagation();
      S._presentieToonAlles.add(b.dataset.toonmeer);
      renderTeam();
    });
    // maand in-/uitklappen (PDF-trainingen)
    v.querySelectorAll('[data-pdfmaand]').forEach(b => b.onclick = () => {
      const ym = b.dataset.pdfmaand;
      const pijlOpen = b.querySelector('.maand-pijl').classList.contains('open');
      // bepaal of dit de standaard-open (nieuwste) maand is aan de huidige pijlstand
      if (pijlOpen){
        // nu open → dichtklappen
        S._pdfDicht.add(ym);              // voor standaard-open maand
        S._pdfDicht.delete('open:'+ym);   // voor handmatig geopende maand
        S._pdfToonAlles.delete(ym);
      } else {
        // nu dicht → openklappen
        S._pdfDicht.delete(ym);           // standaard-open maand weer open
        S._pdfDicht.add('open:'+ym);      // andere maand expliciet open
      }
      renderTeam();
    });
    // alle PDF-trainingen van een maand tonen
    v.querySelectorAll('[data-pdftoonmeer]').forEach(b => b.onclick = (e) => {
      e.stopPropagation();
      S._pdfToonAlles.add(b.dataset.pdftoonmeer);
      renderTeam();
    });
    return;
  }
  if (tab === 'videos'){
    v.querySelectorAll('[data-open-video]').forEach(r => r.onclick = () => {
      window.open(r.dataset.openVideo, '_blank');
    });
    return;
  }
  if (tab === 'wedstrijden'){
    v.querySelector('#nieuweWedstrijd').onclick = modalNieuweWedstrijd;
    v.querySelectorAll('[data-open-w]').forEach(b => b.onclick = () => openWedstrijd(b.dataset.openW));
  }
  if (tab === 'spelers' && S._leenProfiel){
    // --- read-only leen-profiel ---
    const t = v.querySelector('#leenTerug');
    if (t) t.onclick = () => history.back();
  }
  else if (tab === 'spelers' && S._beoordeelProfiel){
    // --- profielscherm ---
    v.querySelector('#profielTerug').onclick = () => history.back();
    v.querySelectorAll('[data-ptab]').forEach(b => b.onclick = () => { S._profielTab = b.dataset.ptab; renderTeam(); });
    v.querySelectorAll('[data-snel-speler]').forEach(b => b.onclick = () => modalSnelBeoordeling(b.dataset.snelSpeler));
    v.querySelectorAll('[data-volledig-speler]').forEach(b => b.onclick = () => modalVolledigeBeoordeling(b.dataset.volledigSpeler));
    v.querySelectorAll('[data-bewerk-speler]').forEach(b => b.onclick = () => modalSpeler(speler(b.dataset.bewerkSpeler)));
    v.querySelectorAll('[data-uitleen-speler]').forEach(b => b.onclick = () => modalUitlenen(b.dataset.uitleenSpeler));
    v.querySelectorAll('[data-uitleen-intrek]').forEach(b => b.onclick = () => trekUitleningIn(b.dataset.uitleenIntrek));
    v.querySelectorAll('[data-weg-speler]').forEach(b => b.onclick = async () => {
      const p = speler(b.dataset.wegSpeler);
      if (p && confirm(`${p.naam} verwijderen uit de selectie? Beoordelingen en leerpunten gaan ook verloren.`)){
        await deleteDoc(doc(db,'teams',S.teamId,'spelers',p.id));
        S._beoordeelProfiel = null; renderTeam();
      }
    });
    v.querySelectorAll('[data-lp-nieuw]').forEach(b => b.onclick = () => modalLeerpunt(b.dataset.lpNieuw));
    v.querySelectorAll('[data-lp-toggle]').forEach(b => b.onclick = () => toggleLeerpunt(b.dataset.lpToggle));
    v.querySelectorAll('[data-lp-weg]').forEach(b => b.onclick = () => verwijderLeerpunt(b.dataset.lpWeg));
    v.querySelectorAll('[data-thema-info]').forEach(el => el.onclick = () => toonThemaInfo(el.dataset.themaInfo));
    v.querySelectorAll('[data-open-beoordeling]').forEach(b => b.onclick = () => {
      const bo = S.beoordelingen.find(x => x.id === b.dataset.openBeoordeling);
      if (bo?.soort === 'volledig') modalVolledigeBeoordeling(bo.spelerId, bo);
      else if (bo) modalSnelBeoordeling(bo.spelerId, bo);
    });
  }
  else if (tab === 'spelers'){
    v.querySelector('#nieuweSpeler').onclick = () => modalSpeler();
    v.querySelectorAll('[data-open-profiel]').forEach(b => b.onclick = () => {
      S._beoordeelProfiel = b.dataset.openProfiel; S._profielTab = 'overzicht'; renderTeam();
    });
    v.querySelectorAll('[data-open-leen]').forEach(b => b.onclick = () => {
      S._leenProfiel = b.dataset.openLeen; renderTeam();
    });
    v.querySelectorAll('#spelersModus [data-modus]').forEach(b => b.onclick = () => {
      if (b.dataset.modus === 'snel') startSnelRonde();
    });
  }
  if (tab === 'instellingen'){
    v.querySelector('#deelCode').onclick = async () => {
      try { await navigator.clipboard.writeText(S.team.code); meld('Code gekopieerd'); }
      catch { meld('Code: ' + S.team.code); }
    };
    v.querySelector('#deelLink').onclick = () => import('./club.js').then(m => m.modalUitnodig(S.team));
    v.querySelector('#wijzigCode').onclick = () => modalWijzigCode();
    v.querySelector('#wijzigMijnNaam').onclick = () => modalMijnNaam();
    v.querySelector('#iNaamOk').onclick = async () => {
      const naam = $('#iTeamNaam').value.trim();
      if (!naam) return meld('Geef het team een naam');
      const codeMee = $('#iCodeVolgtNaam').checked;
      const knop = $('#iNaamOk');
      knop.disabled = true; knop.textContent = 'Opslaan...';
      const data = {naam};
      try {
        if (codeMee){
          const afk = S.team.clubNaam ? clubAfkorting(S.team.clubNaam) : '';
          // bestaande codes ophalen om botsing te vermijden (eigen code uitgezonderd)
          let bestaande = [];
          try {
            const snap = await getDocs(collection(db,'teams'));
            bestaande = snap.docs.map(d => d.data().code).filter(c => c && c !== S.team.code);
          } catch(e){ /* lukt het lezen niet, dan toch proberen met lokale kennis */
            bestaande = S.teams.map(t => t.code).filter(c => c && c !== S.team.code);
          }
          data.code = teamCode(naam, afk, bestaande);
        }
        await updateDoc(doc(db,'teams',S.teamId), data);
        meld(codeMee ? `Naam opgeslagen · code is nu ${data.code}` : 'Naam opgeslagen');
      } catch(e){
        meld('Opslaan mislukt: ' + (e.code || e.message));
      } finally {
        knop.disabled = false; knop.textContent = 'Naam opslaan';
      }
    };
    v.querySelectorAll('[data-lid-weg]').forEach(b => b.onclick = async () => {
      const uid = b.dataset.lidWeg;
      const naam = b.dataset.lidNaam;
      if (!confirm(`${naam} verwijderen als coach van dit team? Deze persoon heeft daarna geen toegang meer.`)) return;
      await updateDoc(doc(db,'teams',S.teamId), {
        ['leden.'+uid]: deleteField(),
        ['ledenInfo.'+uid]: deleteField(),
      });
      meld(naam + ' verwijderd');
    });
    v.querySelector('#iCategorie').onchange = async e => {
      const cat = e.target.value;
      const data = cat ? {categorie: cat, format: catInfo(cat).format} : {categorie: null};
      await updateDoc(doc(db,'teams',S.teamId), data);
      meld(cat ? cat + ' ingesteld' : 'Categorie verwijderd');
    };
    v.querySelector('#verlaatTeam').onclick = async () => {
      if (!confirm('Weet je zeker dat je dit team wilt verlaten?')) return;
      await updateDoc(doc(db,'teams',S.teamId), {
        ['leden.'+S.user.uid]: deleteField(),
        ['ledenInfo.'+S.user.uid]: deleteField(),
      });
      verlaatTeamView();
    };
  }
  if (tab === 'help'){
    const inp = v.querySelector('#helpZoek');
    const wis = v.querySelector('#helpZoekWis');
    const geen = v.querySelector('#helpGeen');
    const geenTerm = v.querySelector('#helpGeenTerm');
    const secties = [...v.querySelectorAll('.hl-sec')];
    const hoofdstukken = [...v.querySelectorAll('.hl-hoofdstuk')];
    const pasToe = () => {
      const term = (S._helpZoek || '').trim().toLowerCase();
      let raak = 0;
      for (const s of secties){
        const treffer = !term || (s.dataset.zoek || '').includes(term);
        s.hidden = !treffer;
        if (treffer) raak++;
      }
      // een hoofdstukkopje verbergen zodra geen van de secties erna (tot het
      // volgende kopje) nog zichtbaar is
      hoofdstukken.forEach(h => {
        let el = h.nextElementSibling, zichtbaar = false;
        while (el && !el.classList.contains('hl-hoofdstuk')){
          if (el.classList.contains('hl-sec') && !el.hidden){ zichtbaar = true; break; }
          el = el.nextElementSibling;
        }
        h.hidden = !zichtbaar;
      });
      if (wis) wis.hidden = !term;
      if (geen){
        geen.hidden = !(term && raak === 0);
        if (geenTerm) geenTerm.textContent = term;
      }
    };
    if (inp){
      inp.value = S._helpZoek || '';          // herstel na re-render
      inp.oninput = () => { S._helpZoek = inp.value; pasToe(); };
    }
    if (wis) wis.onclick = () => {
      S._helpZoek = '';
      if (inp){ inp.value = ''; inp.focus(); }
      pasToe();
    };
    pasToe();                                  // pas direct toe (ook bij herstelde term)
    v.querySelectorAll('[data-hlh]').forEach(b => b.onclick = () => {
      // eerst een eventuele zoekterm wissen, anders kan het hoofdstuk verborgen zijn
      if (S._helpZoek){ S._helpZoek = ''; if (inp) inp.value = ''; pasToe(); }
      v.querySelector('#hlh-'+b.dataset.hlh)?.scrollIntoView({behavior:'smooth', block:'start'});
    });
  }
  bewaakTerug();
}

/* ==================== BEOORDELING — ACTIES & MODALS ==================== */

/* gemeenschappelijke bron-opties: laatste wedstrijden + trainingen + los */
