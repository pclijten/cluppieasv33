import {
  db, collection, doc, addDoc, deleteDoc, updateDoc, deleteField,
  setDoc, getDocs, query, where, onSnapshot, serverTimestamp
} from './firebase.js?v=20260811a';
import {
  S, $, $$, esc, meld, datumNL, teamCode, clubAfkorting, speler, isBeheerder,
  openModal, sluitModal, toon, stopUnsubs, bewaakTerug, modAan,
  bewaarPositie, leesPositie, wisPositie
} from './state.js?v=20260825e';
import {
  CATEGORIEEN, CATEGORIEEN_MEIDEN, catInfo,
  KNVB_SEIZOEN, SEIZOEN_FALLBACK, knvbKalenderVoorTeam,
  kompasIndexVoorWeek, afwezigRedenInfo
} from './config.js?v=20260825e';
import { kompasTips, startContentListener } from './content.js?v=20260825e';
import { ico } from './icons.js?v=20260825b';

import { analyseWedstrijd } from './analyse.js?v=20260825e';
import { telGebruik, telNav } from './tracker.js?v=20260825e';
import { doSignOut, joinMetCode, zorgClubLidmaatschap } from './auth.js?v=20260825e';
import { tekenPwaBanner } from './pwa.js?v=20260811a';
import {
  openWedstrijd, modalNieuweWedstrijd, renderWedstrijd, koppelStatsBlad, exportStatsExcel
} from './wedstrijd.js?v=20260825i';

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
   gebruiken ze `import('./teams.js?v=20260825i')` binnen de aanroepende functie,
   hetzelfde patroon dat club.js en wedstrijd.js al gebruikten. */
import {
  htmlSpelers, htmlLeenProfiel, htmlProfiel,
  modalSnelBeoordeling, startSnelRonde, modalVolledigeBeoordeling,
  modalLeerpunt, toggleLeerpunt, verwijderLeerpunt, modalSpeler,
  modalUitlenen, trekUitleningIn, modalNotitie,
} from './teams-spelers.js?v=20260825i';
import { htmlKompas, toonThemaInfo, toonKompasInfo, kompasItems, kompasStartIndex } from './teams-leerlijn.js?v=20260825e';
import { modalTeamEvaluatie, htmlStatsTab, htmlTeamEvaluatieDashboard, htmlSeizoenFilter } from './teams-evaluatie.js?v=20260825i';
import {
  htmlTeamTrainingen, htmlPresentieTraining, htmlTeamVideos, htmlInstellingen,
  modalWijzigCode, modalMijnNaam, modalPresentie, modalEigenDag, modalPlanDag,
  afgelastDatumTekst, afgelastWhatsappTekst, afgelastGeldig,
} from './teams-training.js?v=20260825f';
import { htmlTeamDocumenten } from './teams-documenten.js?v=20260825e';
import {
  htmlHub, htmlPresWedstrijd, presWedstrijdKeuzeHtml, presWedstrijdBewaar,
  htmlEvaluatieLijst, htmlLeerlijnOverzicht, htmlHistorieLijst,
} from './teams-hub.js?v=20260825e';
import { htmlHandleiding } from './teams-handleiding.js?v=20260825i';
import { koppelOnboardingHerstart } from './onboarding.js?v=20260825i';
import { htmlBerichtBalk, koppelBerichtBalk, htmlBerichtenArchief, ongelezenBerichten } from './berichten.js?v=20260825e';
import { zetClubModus, kiesEigenThema, zetLettergrootte } from './thema.js?v=20260818e';

/* Publieke re-exports: consumenten van teams.js (main.js, wedstrijd.js, ...)
   importeren deze twee nog altijd via './teams.js?v=20260825i' — ze wonen nu fysiek in
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
  hulpchat:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 5.5h16a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H9l-4 3.2V16.5H4a1 1 0 0 1-1-1v-9a1 1 0 0 1 1-1z"/><path d="M8 9.5h8M8 12.5h5"/></svg>',
  documenten:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3.5 8.2 6 4.8h5.6l2 3.4H20a.7.7 0 0 1 .7.7v9.3a1 1 0 0 1-1 1H4.3a1 1 0 0 1-1-1V8.9a.7.7 0 0 1 .2-.7z"/></svg>',
  meer:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3.5" y="3.5" width="7" height="7" rx="1.6"/><rect x="13.5" y="3.5" width="7" height="7" rx="1.6"/><rect x="3.5" y="13.5" width="7" height="7" rx="1.6"/><rect x="13.5" y="13.5" width="7" height="7" rx="1.6"/></svg>',
  poule:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/></svg>',
  updates:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3.5l2.1 4.7 4.9.5-3.7 3.3 1.1 4.9L12 14.8l-4.5 2.6 1.1-4.9L4.9 8.7l4.9-.5z"/></svg>',
};

/* Team-tabs die niet meer rechtstreeks in de onderbalk staan, maar via de
   verzameltegel "Meer" bereikt worden (zie htmlMeer() verderop). */
const MEER_GROEP = ['planning', 'poule', 'documenten', 'stats', 'help', 'updates'];

/* ==================== TAB-GESCHIEDENIS (voor de terugknop) ====================
   De telefoon-terugknop moet binnen een team één tabblad terug gaan (bv. van
   Planning terug naar Meer, of van een sub-tab terug naar Wedstrijden) i.p.v.
   meteen naar de teamkeuze te springen. We houden daarvoor een kleine stack bij
   van bezochte tabbladen. zetTeamTab() legt het huidige tabblad op de stack en
   schakelt over; teamTabTerug() (aangeroepen door de terugknop via state.js)
   haalt het vorige tabblad er weer af. */
export function zetTeamTab(nieuwTab){
  if (S.teamTab === nieuwTab){ renderTeam(); return; }
  // vaste beginstand per tabblad (voorheen deed de onderbalk-klik dit):
  // oefenstof met een vers kompas-item, presentie met alle maanden dicht
  if (nieuwTab === 'trainingen'){ S._kompasIdx = kompasStartIndex(kompasItems().length); }
  if (nieuwTab === 'presentietraining'){
    // huidige maand direct opengeklapt zodat vandaag meteen zichtbaar is
    S._presentieOpen = new Set([new Date().toISOString().slice(0,7)]);
    S._presentieToonAlles = new Set();
  }
  (S._teamTabStack ||= []).push(S.teamTab);
  // stack begrenzen zodat hij niet oneindig groeit bij veel heen-en-weer tikken
  if (S._teamTabStack.length > 20) S._teamTabStack.shift();
  S.teamTab = nieuwTab;
  telNav('team:' + nieuwTab, 'tab');
  bewaarPositie();
  renderTeam();
}
/* Eén tabblad terug. true = er was historie en we zijn teruggegaan;
   false = geen historie meer, de terugknop mag het team verlaten. */
export function teamTabTerug(){
  const stack = S._teamTabStack || [];
  if (!stack.length) return false;
  const vorige = stack.pop();
  // vaste beginstand bij terugkeren: vers kompas-item op Oefenstof,
  // presentie-maanden dicht op Presentie training
  if (vorige === 'trainingen'){ S._kompasIdx = kompasStartIndex(kompasItems().length); }
  if (vorige === 'presentietraining'){
    S._presentieOpen = new Set([new Date().toISOString().slice(0,7)]);
    S._presentieToonAlles = new Set();
  }
  S._beoordeelProfiel = null; S._leenProfiel = null;
  S.teamTab = vorige;
  telNav('team:' + vorige, 'terug');
  bewaarPositie();
  renderTeam();
  return true;
}

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
    /* Auto-open / herstel na refresh: een coach landt na inloggen weer op de
       plek waar hij was — team, tabblad én een eventueel geopende wedstrijd.
       Zonder bewaarde positie valt hij terug op de hub van zijn laatst geopende
       (of enige) team. Eén keer per sessie; deep-links en uitnodigingen
       (main.js) openen daarna gewoon hun eigen doel. Beheerders zonder teams
       houden het teamsoverzicht. */
    if (!S._autoTeamGeprobeerd && !S.teamId && !S.clubId && S.teams.length){
      S._autoTeamGeprobeerd = true;
      const positie = leesPositie();
      let bewaard = positie?.teamId || null;
      if (!bewaard){ try { bewaard = localStorage.getItem('cluppie_laatste_team'); } catch(e){} }
      const doelTeam = S.teams.find(t => t.id === bewaard) || S.teams[0];
      // alleen het tabblad herstellen als de bewaarde positie ook bij DIT team
      // hoort én het een "stabiel" tabblad is (geen tijdelijke deelweergave als
      // een open spelerprofiel); anders gewoon de hub.
      const HERSTELBARE_TABS = new Set([
        'hub','wedstrijden','trainingen','presentietraining','spelers','stats',
        'planning','poule','evaluatie','historie','videos','documenten',
        'berichten','leerlijnoverzicht','meer','help','updates','instellingen',
      ]);
      const bewaardeTab = positie && positie.teamId === doelTeam.id ? (positie.teamTab || 'hub') : 'hub';
      const herstelTab = HERSTELBARE_TABS.has(bewaardeTab) ? bewaardeTab : 'hub';
      openTeam(doelTeam.id, herstelTab);
      // een openstaande wedstrijd herstellen (indien die bij dit team hoort)
      if (positie && positie.teamId === doelTeam.id && positie.wedstrijdId){
        import('./wedstrijd.js?v=20260825i').then(m => m.openWedstrijd(positie.wedstrijdId));
      }
    }
    if (!S.teamId && !S.clubId) renderTeams();
    laadTrainingenVoorTeams();
    laadVideosVoorTeams();
    laadBerichtenVoorTeams();
    laadDocumentenVoorTeams();
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

/* Stopt ALLE actieve Firestore-listeners, over alle modules heen (S.unsub
   is gedeelde state, dus dit pakt ook club.js-listeners mee) plus de losse
   trainingen/video/documenten-arrays van het teamoverzicht. Wordt vóór
   signOut() aangeroepen: zonder dit blijven listeners nog even actief
   terwijl de auth-status al is ingetrokken, wat een reeks onschuldige maar
   verwarrende permission-denied-meldingen in de console geeft. */
export function stopAlleListeners(){
  trainingenUnsubs.forEach(u => u()); trainingenUnsubs = [];
  videoUnsubs.forEach(u => u()); videoUnsubs = [];
  documentenUnsubs.forEach(u => u()); documentenUnsubs = [];
  stopUnsubs(...Object.keys(S.unsub));
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
    }, (err) => {
      console.error(`[Cluppie] Listener "trainingen" kon niet lezen (teams=${c.join(',')}):`, err.code, err.message);
      if (err.code === 'permission-denied') meld('Geen toegang tot trainingen — controleer de Firestore-rules');
    });
    trainingenUnsubs.push(u);
  });
}

/* berichten (clubadmin → teams) voor de teams waar de coach lid van is.
   Zelfde toewijzingspatroon als trainingen: filter op teams array-contains-any. */
let berichtenUnsubs = [];
function laadBerichtenVoorTeams(){
  berichtenUnsubs.forEach(u => u());
  berichtenUnsubs = [];
  const teamIds = S.teams.map(t => t.id);
  if (!teamIds.length){ S.berichten = []; return; }
  const chunks = [];
  for (let i = 0; i < teamIds.length; i += 30) chunks.push(teamIds.slice(i, i+30));
  S.berichten = [];
  chunks.forEach(c => {
    const q = query(collection(db,'berichten'), where('teams','array-contains-any', c));
    const u = onSnapshot(q, snap => {
      S.berichten = S.berichten.filter(b => !c.some(tid => (b.teams||[]).includes(tid)) || snap.docs.some(d => d.id === b.id));
      snap.docs.forEach(d => {
        const i = S.berichten.findIndex(b => b.id === d.id);
        const data = {id:d.id, ...d.data()};
        if (i >= 0) S.berichten[i] = data; else S.berichten.push(data);
      });
      if (S.team) renderTeam();
    }, (err) => {
      console.error(`[Cluppie] Listener "berichten" kon niet lezen (teams=${c.join(',')}):`, err.code, err.message);
      if (err.code === 'permission-denied') meld('Geen toegang tot berichten — controleer de Firestore-rules');
    });
    berichtenUnsubs.push(u);
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
    }, (err) => {
      console.error(`[Cluppie] Listener "videos" kon niet lezen (teams=${c.join(',')}):`, err.code, err.message);
      if (err.code === 'permission-denied') meld('Geen toegang tot video\'s — controleer de Firestore-rules');
    });
    videoUnsubs.push(u);
  });
}

/* documenten voor de teams waar de coach lid van is */
let documentenUnsubs = [];
function laadDocumentenVoorTeams(){
  documentenUnsubs.forEach(u => u());
  documentenUnsubs = [];
  const teamIds = S.teams.map(t => t.id);
  if (!teamIds.length){ S.documenten = []; return; }
  const chunks = [];
  for (let i = 0; i < teamIds.length; i += 30) chunks.push(teamIds.slice(i, i+30));
  S.documenten = [];
  chunks.forEach(c => {
    const q = query(collection(db,'documenten'), where('teams','array-contains-any', c));
    const u = onSnapshot(q, snap => {
      const ids = new Set(snap.docs.map(d => d.id));
      S.documenten = S.documenten.filter(t => !c.some(tid => (t.teams||[]).includes(tid)) || ids.has(t.id));
      snap.docs.forEach(d => {
        const i = S.documenten.findIndex(t => t.id === d.id);
        const data = {id:d.id, ...d.data()};
        if (i >= 0) S.documenten[i] = data; else S.documenten.push(data);
      });
      S.documenten.sort((a,b) => (b.gemaakt?.seconds||0) - (a.gemaakt?.seconds||0));
      if (S.team) renderTeam();
    }, (err) => {
      console.error(`[Cluppie] Listener "documenten" kon niet lezen (teams=${c.join(',')}):`, err.code, err.message);
      if (err.code === 'permission-denied') meld('Geen toegang tot documenten — controleer de Firestore-rules');
    });
    documentenUnsubs.push(u);
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
    // Team met uitgeschakelde evaluaties-module niet aan de "nog te evalueren"-
    // herinnering laten meedoen.
    if (!modAan('evaluaties', t)) continue;
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
        <button data-eval-negeer="${w.id}" data-eval-negeer-team="${w.teamId}" title="Negeren" style="background:none;color:var(--ink-2);font-size:calc(18px * var(--fs));padding:6px;flex-shrink:0">✕</button>
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
      <div class="asv-streep" aria-hidden="true"></div>
      <img src="icons/asv-schild.png" alt="ASV'33" class="welkom-schild">
      <div class="welkom-tekst">
        <div class="welkom-datum">${esc(vandaag)}</div>
        <h1 class="welkom-groet">Hoi <span class="groet-naam">${esc(voornaamMooi || 'coach')}</span></h1>
        <div id="welkomExtra">${welkomStripHtml()}</div>
      </div>
      <button class="uitlog-knop" id="uitloggen" title="Uitloggen"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M15 17l5-5-5-5"/><path d="M20 12H9"/><path d="M9 4H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h3"/></svg></button>
    </div>

    <div id="pwaBanner"></div>

    <div id="berichtBalk">${htmlBerichtBalk()}</div>

    ${toonOverzicht ? `
    <div class="overzicht-blokjes">
      <button class="ov-blok ${aantalOngelezen ? 'ov-actief' : ''}" id="ovTrainingen">
        <div class="ov-getal">${aantalOngelezen || ico('admin-document',26)}</div>
        <div class="ov-label">${aantalOngelezen ? `nieuwe training` : 'training'}</div>
      </button>
      <button class="ov-blok ov-wedstrijden" id="ovWedstrijden">
        <div class="ov-getal">${ico('admin-protocol',26)}</div>
        <div class="ov-label">wedstrijden</div>
      </button>
      <button class="ov-blok ov-berichten" id="ovBerichten">
        <div class="ov-getal">${ongelezenBerichten() || ico('communication-announcement',26)}</div>
        <div class="ov-label">berichten</div>
      </button>
    </div>` : ''}

    <div id="nogTeEvalueren">${nogTeEvaluerenHtml()}</div>

    ${S.clubs.length ? `<div class="sectie-kop" style="margin-top:4px">Clubs die je beheert</div>
      ${S.clubs.map(c => `
        <button class="lijst-item" data-open-club="${c.id}">
          <div class="club-shirt"><img src="icons/asv-schild.png" alt="" class="club-schild"></div>
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

  v.querySelector('#uitloggen').onclick = () => { stopAlleListeners(); doSignOut(); };
  v.querySelectorAll('[data-open-team]').forEach(b => b.onclick = () => openTeam(b.dataset.openTeam));
  v.querySelectorAll('[data-open-club]').forEach(b => b.onclick = () => import('./club.js?v=20260825i').then(m => m.openClub(b.dataset.openClub)));
  const nt = v.querySelector('#nieuwTeam'); if (nt) nt.onclick = () => modalNieuwTeam();
  v.querySelector('#joinTeam').onclick = modalJoinTeam;
  const nc = v.querySelector('#nieuwClub'); if (nc) nc.onclick = () => import('./club.js?v=20260825i').then(m => m.modalNieuwClub());

  // Overzichtsblokjes. Bij één team openen ze direct; bij meerdere teams
  // laten ze eerst een teamkeuze zien, zodat een coach met meerdere teams niet
  // ongewild in het bovenste team belandt.
  const ovT = v.querySelector('#ovTrainingen');
  if (ovT) ovT.onclick = () => {
    if (S.teams.length <= 1){
      const doel = S.teams[0]; if (doel) openTeam(doel.id, 'trainingen');
      return;
    }
    // meerdere teams: kies eerst, met het eerste team met ongelezen oefenstof bovenaan gemarkeerd
    modalTeamKeuze('trainingen', 'Naar oefenstof');
  };
  const ovW = v.querySelector('#ovWedstrijden');
  if (ovW) ovW.onclick = () => {
    if (S.teams.length <= 1){
      if (S.teams.length) openTeam(S.teams[0].id, 'wedstrijden');
      return;
    }
    modalTeamKeuze('wedstrijden', 'Naar wedstrijden');
  };
  const ovB = v.querySelector('#ovBerichten');
  if (ovB) ovB.onclick = () => modalBerichtenArchief();

  // ✕ op een berichtbalk: per apparaat wegklikken, daarna alleen de balk +
  // het tegel-getal opnieuw tekenen (geen volledige herrender nodig).
  const bb = v.querySelector('#berichtBalk');
  const herkoppelBalk = () => {
    bb.innerHTML = htmlBerichtBalk();
    koppelBerichtBalk(bb, herkoppelBalk);
    const getal = v.querySelector('#ovBerichten .ov-getal');
    if (getal){ const n = ongelezenBerichten(); getal.innerHTML = n ? String(n) : ico('communication-announcement',26); }
  };
  if (bb) koppelBerichtBalk(bb, herkoppelBalk);

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
    <div class="kaart" style="margin-bottom:14px"><p style="font-size:calc(13px * var(--fs));color:var(--ink-2)" id="mTeamKnvb"></p></div>
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
    if (clubT) import('./club.js?v=20260825i').then(m => m.openClub(clubT.id));
    else openTeam(ref.id);
  };
}

/* Teamkeuze voor de overzichtstegels (oefenstof / wedstrijden) wanneer een
   coach meerdere teams heeft. Opent het gekozen team op het juiste tabblad.
   Bij 'trainingen' tonen we een stipje bij teams met ongelezen oefenstof. */
function modalTeamKeuze(beginTab, titel){
  const rijen = S.teams.map(t => {
    const ongelezen = beginTab === 'trainingen'
      && S.trainingen.some(tr => (tr.teams||[]).includes(t.id) && !S.trainingenGelezen[tr.id]);
    return `<button class="lijst-item" data-keuze-team="${t.id}" style="margin-bottom:8px">
      <div class="team-shirt">${esc(t.format)}<small>v${esc(t.format)}</small></div>
      <div class="li-tekst"><div class="titel">${esc(t.naam)}${ongelezen ? ' <span class="nieuw-stip" title="Nieuwe oefenstof"></span>' : ''}${t.club ? ' <span class="club-badge licht">'+esc(t.clubNaam||'club')+'</span>' : ''}</div>
      <div class="meta">${Object.keys(t.leden||{}).length} coach(es)</div></div>
      <span class="pijl">›</span>
    </button>`;
  }).join('');
  openModal(`
    <h2>${esc(titel)}</h2>
    <p style="font-size:calc(13.5px * var(--fs));color:var(--ink-2);margin-bottom:12px">Je hebt meerdere teams. Kies voor welk team je verder wilt.</p>
    ${rijen}`);
  $$('#modalInhoud [data-keuze-team]').forEach(b => b.onclick = () => {
    sluitModal();
    openTeam(b.dataset.keuzeTeam, beginTab);
  });
}

/* Archief van alle berichten (actief + verlopen) voor de teams van de coach.
   Geopend via de berichten-tegel. Leesweergave — plaatsen/beheren doet de admin
   in het clubdashboard. */
function modalBerichtenArchief(){
  openModal(`
    <h2>Berichten</h2>
    <p style="font-size:calc(13px * var(--fs));color:var(--ink-2);margin-bottom:12px">Berichten van je clubadmin voor jouw team(s).</p>
    ${htmlBerichtenArchief()}`);
}

/* ---------- Tab: Berichten (hub-tegel onder Meer) ----------
   Bovenaan de actieve berichten als wegklikbare balken (zelfde ✕-gedrag als
   op het teamsoverzicht), daaronder het volledige archief. */
function htmlBerichtenTab(){
  const balk = htmlBerichtBalk();
  return `
    ${balk ? `<div id="berichtBalkTab">${balk}</div>` : ''}
    <p style="font-size:calc(13px * var(--fs));color:var(--ink-2);margin-bottom:12px;line-height:1.5">Berichten van je clubadmin voor dit team. Wegklikken (✕) verbergt de balk alleen op dit apparaat; alles blijft hieronder terug te lezen.</p>
    ${htmlBerichtenArchief()}`;
}

function modalJoinTeam(){
  openModal(`
    <h2>Aansluiten bij team</h2>
    <p style="font-size:calc(13.5px * var(--fs));color:var(--ink-2);margin-bottom:12px">Vraag de teamcode aan een coach van het team (te vinden onder het tabblad Team).</p>
    <div class="veldgroep"><input class="invoer" id="mCode" placeholder="ASVJO11-1" maxlength="20"
      style="text-transform:uppercase;text-align:center;font-family:'Barlow Condensed';font-size:calc(22px * var(--fs));letter-spacing:2px"></div>
    <button class="knop vol" id="mCodeOk">Aansluiten</button>`);
  $('#mCodeOk').onclick = async () => {
    const code = $('#mCode').value.trim().toUpperCase();
    if (code.length < 4) return meld('Vul een geldige teamcode in');
    const t = await joinMetCode(code);
    if (t){ sluitModal(); meld('Aangesloten bij ' + t.data().naam); openTeam(t.id); }
  };
}

/* ==================== TEAM OPENEN ==================== */
export function openTeam(teamId, beginTab = 'hub', opties = {}){
  S.teamId = teamId; S.teamTab = beginTab;
  // wie direct in een tabblad binnenkomt (bv. via een overzichtstegel of
  // deep-link) krijgt de hub als terug-bestemming op de stack
  S._teamTabStack = beginTab === 'hub' ? [] : ['hub'];
  S._presWedstrijdId = null;   // presentie-wedstrijd kiezer terug naar eerstvolgende
  // onthoud het laatst geopende team zodat we daar bij de volgende start
  // meteen kunnen landen (zie auto-open in startTeams)
  try { localStorage.setItem('cluppie_laatste_team', teamId); } catch(e){}
  bewaarPositie();
  S._pendingNieuweWedstrijd = !!opties.nieuweWedstrijd;
  S._kompasIdx = null; // vers willekeurig startpunt voor het leerlijn-blok
  // presentie altijd ingeklapt openen bij elke teamopening (alle maanden dicht)
  S._presentieOpen = new Set();
  S._presentieToonAlles = new Set();
  stopUnsubs('team','spelers','wedstrijden','presentie','planning','poule','beoordelingen','teamevaluaties','seizoen');
  const luisterfout = (naam) => (err) => {
    console.error(`[Cluppie] Listener "${naam}" kon niet lezen (teamId=${teamId}):`, err.code, err.message);
    if (err.code === 'permission-denied') meld(`Geen toegang tot "${naam}" — controleer de Firestore-rules`);
  };
  S.unsub.team = onSnapshot(doc(db,'teams',teamId), snap => {
    if (!snap.exists()){
      // Een lege snapshot kan óók een tijdelijke cache-miss zijn (bij laden of
      // herverbinden), niet per se een verwijderd team. Alleen als de SERVER
      // bevestigt dat het document weg is (fromCache === false) verlaten we het
      // team. Anders wachten we op de server-bevestigde snapshot — zo wordt
      // teamId niet onterecht geleegd terwijl de wedstrijdlijst nog op het
      // scherm staat (voorkomt de null-teamId crash in openWedstrijd).
      if (!snap.metadata.fromCache){ verlaatTeamView(); }
      return;
    }
    S.team = {id:snap.id, ...snap.data()};
    if (S.team.club && !S.unsub.uitleningen) startUitleningenListener(teamId);
    if (S.team.club && !S.unsub.seizoen) startSeizoenListener(teamId);
    if (S.team.club) zorgClubLidmaatschap(S.team.club);
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
    if (!S.wedstrijdId && (S.teamTab === 'trainingen' || S.teamTab === 'presentietraining')) renderTeam();
  }, luisterfout('presentie'));
  S.unsub.planning = onSnapshot(collection(db,'teams',teamId,'planning'), snap => {
    S.planning = snap.docs.map(d => ({id:d.id, ...d.data()}));
    if (!S.wedstrijdId && S.teamTab === 'planning') renderTeam();
  }, luisterfout('planning'));
  // Poulestand + poule-uitslagen (via Sportlink-sync geschreven naar
  // teams/{id}/poule/{stand,uitslagen}). Los van wedstrijden: dit is de aparte
  // "Stand & Poule"-tegel onder Meer, met óók de uitslagen van de andere teams.
  S.unsub.poule = onSnapshot(collection(db,'teams',teamId,'poule'), snap => {
    S.pouleStand = null; S.pouleUitslagen = null; S.pouleProgramma = null;
    snap.docs.forEach(d => {
      if (d.id === 'stand') S.pouleStand = d.data();
      else if (d.id === 'uitslagen') S.pouleUitslagen = d.data();
      else if (d.id === 'programma') S.pouleProgramma = d.data();
    });
    // Nieuw team/poule geladen → speelronde-index resetten zodat htmlPoule
    // opnieuw op de eerstvolgende ronde opent.
    S._pouleRondeIdx = null;
    if (!S.wedstrijdId && S.teamTab === 'poule') renderTeam();
  }, luisterfout('poule'));
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
  telNav('team:' + (S.teamTab || 'hub'), 'open');
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
    const d = snap.data();
    S.huidigSeizoen = d?.huidigSeizoen || SEIZOEN_FALLBACK;
    /* thema-dwang van de club toepassen op deze coach (clubdwang overschrijft
       de persoonlijke voorkeur; ontbreekt het veld dan mag de coach kiezen) */
    zetClubModus(d?.themaModus);
  }, (err) => {
    console.error(`[Cluppie] Listener "seizoen" kon niet lezen (clubId=${clubId}):`, err.code, err.message);
    if (err.code === 'permission-denied') meld('Kon seizoensinstelling niet laden — controleer de Firestore-rules');
  });
}
function startUitleningenListener(teamId){
  const clubId = S.team?.club;
  if (!clubId){ return; }              // los team zonder club: geen uitleningen
  if (S.unsub.uitleningen){ S.unsub.uitleningen(); delete S.unsub.uitleningen; }
  if (S.unsub.uitleningenIn){ S.unsub.uitleningenIn(); delete S.unsub.uitleningenIn; }
  const herteken = () => { if (!S.wedstrijdId && (S.teamTab === 'spelers' || S._beoordeelProfiel)) renderTeam(); };
  const foutmelding = (err) => {
    console.error(`[Cluppie] Listener "uitleningen" kon niet lezen (clubId=${clubId}):`, err.code, err.message);
    if (err.code === 'permission-denied') meld('Kon uitleningen niet laden — controleer de Firestore-rules');
  };
  /* Twee losse, where()-gefilterde queries i.p.v. één ongefilterde collection-
     listener: de Firestore-rule voor uitleningen toetst per document op
     vanTeam/naarTeam. Zo'n rule vereist een overeenkomstige where()-filter in
     de query — zonder filter kan Firestore niet bewijzen dat élk mogelijk
     resultaat aan de regel voldoet, en wijst hij de HELE lijst-aanvraag af. */
  S.unsub.uitleningen = onSnapshot(
    query(collection(db,'clubs',clubId,'uitleningen'), where('vanTeam','==',teamId)),
    snap => { S.uitleningenUit = snap.docs.map(d => ({id:d.id, ...d.data()})); herteken(); },
    foutmelding
  );
  S.unsub.uitleningenIn = onSnapshot(
    query(collection(db,'clubs',clubId,'uitleningen'), where('naarTeam','==',teamId)),
    snap => { S.uitleningenIn = snap.docs.map(d => ({id:d.id, ...d.data()})); herteken(); },
    foutmelding
  );
}
export function verlaatTeamView(){
  stopUnsubs('team','spelers','wedstrijden','presentie','planning','poule','beoordelingen','uitleningen','uitleningenIn','teamevaluaties','seizoen');
  S._teamTabStack = [];
  S.teamId = null; S.team = null; S.spelers = []; S.wedstrijden = []; S.planning = [];
  S._planningToonEerder = false; S._planningDichteMaanden = null;
  S.uitleningenUit = []; S.uitleningenIn = []; S.teamEvaluaties = [];
  wisPositie();
  renderTeams(); toon('teams');
}

/* Tegelmenu "Meer" — verzamelt de minder tijdkritische tabbladen (Planning,
   Documenten, Stats, Help) zodat de onderbalk zelf niet overvol raakt.
   Wedstrijden/Spelers/Training/Video's blijven rechtstreeks bereikbaar,
   want dat zijn de onderdelen die een coach tijdens training/wedstrijd
   het vaakst nodig heeft. Zie ook MEER_GROEP hierboven. */
/* ---------- Tab: Updates (changelog voor coaches) ----------
   Coach-vriendelijk overzicht van wat er nieuw is in de app. Nieuwste bovenaan.
   Voeg een nieuwe release toe door bovenaan UPDATES een item te plaatsen. */
const UPDATES = [
  { datum:'2026-08-25', titel:'Zie meteen wat er nieuw is', punten:[
      'Zodra er updates zijn die je nog niet hebt bekeken, verschijnt er bovenaan je startscherm — net onder de teamnaam — een duidelijke melding met een NIEUW-label, het aantal nieuwe updates en de titel van de nieuwste. Eén tik erop opent dit updates-overzicht.',
      'Wil je de melding even wegklikken? Tik op het kruisje rechtsboven in het balkje; hij blijft dan weg tot je de app opnieuw opent. De updates gelden pas als gelezen zodra je dit overzicht echt hebt geopend.',
      'Ook de regel “Wat is er nieuw?” onderaan het startscherm laat nu met een stipje en een teller zien hoeveel updates er nog voor je klaarstaan. Heb je alles bekeken, dan wordt het weer een rustige, gewone link.',
    ]},
  { datum:'2026-08-25', titel:'Spelersscherm: eigen iconen', punten:[
      'Het spelersscherm sluit nu aan op de frissere look van de rest van de app: de knoppen Snel beoordelen, Volledige beoordeling en Speler bewerken hebben eigen iconen gekregen in plaats van emoji.',
      'De notitie-knop bij een speler is een strak icoonknopje geworden (een potlood als er al een notitie staat, een plusje om er een toe te voegen). De werking blijft precies hetzelfde.',
    ]},
  { datum:'2026-08-24', titel:'Coach-notitie per speler', punten:[
      'Bij elke speler kun je nu een vrije notitie kwijt — bijzonderheden, afspraken of aandachtspunten. Bijvoorbeeld: ‘is de eerste van de maand afwezig voor werk’ of ‘vindt het fijn om extra complimenten te krijgen’.',
      'Je vindt het veld bovenaan het spelersprofiel onder “Notitie”. Tik op Toevoegen of Bewerken om ’m te vullen of aan te passen.',
      'Zodra een speler een notitie heeft, verschijnt er een amberkleurig uitroepteken achter de naam in de spelerslijst — zo zie je in één oogopslag bij wie iets staat.',
      'De notitie is coach-only: spelers en ouders zien ’m niet. Zet er geen gevoelige (medische) gegevens in.',
    ]},
  { datum:'2026-08-23', titel:'Eigen aantekeningen bij de oefenstof', punten:[
      'Je kunt nu je eigen aantekeningen bij een training maken zonder dat het origineel verandert. Open een AI-training en tik rechtsboven op het potlood ✎ om de notitie-laag aan te zetten.',
      'Tik daarna op een regel om ’m te markeren als aandachtspunt (amber), er een opmerking bij te typen, of een YouTube-filmpje te koppelen. Een genummerd bolletje achter de regel brengt je naar je opmerking en weer terug.',
      'Alles wat je toevoegt is zichtbaar voor alle trainers van jouw team — handig om ervaringen te delen. Je eigen opmerkingen en filmpjes kun je altijd weer weghalen; het origineel blijft sowieso bewaard.',
      'Voor de clubadmin: bij elke AI-training staat nu een notitie-knop 💬 die laat zien waar coaches op reageren — met de drukste plekken bovenaan — zodat je de oefenstof gericht kunt verbeteren.',
    ]},
  { datum:'2026-08-22', titel:'Stats: eerlijke speeltijd in één blik', punten:[
      'Bovenaan de Stats-tab staat nu een eerlijkheidsmeter: één rapportcijfer (0–100) dat laat zien hoe gelijk de speeltijd over je selectie verdeeld is. Hoe dichter iedereen bij elkaar zit, hoe hoger — met de speler die het minst aan bod komt er meteen bij.',
      'Nieuw blad ‘Aandacht’, helemaal vooraan: de app haalt automatisch de spelers naar boven die een gesprek verdienen — op basis van weinig speeltijd, lage trainingsopkomst of een disciplinaire reservebeurt. Puur ter signalering, geen oordeel. Tik op een speler voor het volledige profiel.',
      'Daaronder een korte kern-strip met het aantal wedstrijden, doelpunten en de gemiddelde opkomst van het team.',
      'De bestaande bladen (Speelminuten, Wedstrijd, Training) blijven precies zoals je ze kent.',
    ]},
  { datum:'2026-08-19', titel:'Eigen speelwijzen & inzoombare tekeningen', punten:[
      'Je kunt nu je eigen speelwijze samenstellen: typ een linie-indeling (bijvoorbeeld 4-2-1-3) en de app plaatst de spelers automatisch netjes op het veld en bewaart ’m bij je team. Daarna kies je ’m gewoon naast de vaste formaties.',
      'Twee formaties toegevoegd: 3-1-3 voor 8-tegen-8 en 4-2-1-3 voor 11-tegen-11.',
      'Veldtekeningen bij de oefenstof kun je nu schermvullend openen en met twee vingers (of dubbeltik) inzoomen — handig voor de details langs het veld. De telefoon-terugknop sluit de tekening weer.',
    ]},
  { datum:'2026-08-18', titel:'Nieuw startscherm: alles op één plek', punten:[
      'Na het inloggen land je nu direct op het startscherm van je team, met overzichtelijke tegels per onderwerp: Oefenstof, Presentie, Wedstrijden, Spelers en Meer. De balk onderin is verdwenen.',
      'Heb je meerdere teams? Tik op de teamnaam bovenaan om te wisselen.',
      'Presentie voor wedstrijden heeft een eigen scherm: de eerstvolgende wedstrijd staat klaar, je vinkt per speler aan wie meespeelt (met reden bij afwezigheid), en via de kiezer pak je elke andere wedstrijd erbij.',
      'Nieuw onder Spelers: Leerlijn toont alle leerpunten van het hele team in één overzicht, en via Historie open je per speler de ontwikkeling over de tijd.',
      'De tegel Evaluatie verzamelt de gespeelde wedstrijden die je nog moet evalueren — met een teller zodat je niets vergeet.',
      'Berichten van je clubadmin vind je voortaan onder Meer → Berichten, met een rood bolletje als er iets nieuws is.',
    ]},
  { datum:'2026-08-17', titel:'Speelwijze per kwart of helft', punten:[
      'Je kunt nu per kwart (of helft) een eigen speelwijze kiezen — bijvoorbeeld 1e kwart 1-3-3 en 2e kwart 2-3-2 — zonder dat de andere periodes meeveranderen.',
      'Linksboven in het veld zie je welk kwart en welke speelwijze je bekijkt. Tik rechtsboven in het veld op de knop ‘Speelwijze’ (of op de onderstreepte formatie onder de titel) om ’m aan te passen.',
      'Wijzig je de speelwijze, dan blijven de opgestelde spelers zoveel mogelijk op hun plek: verdedigers bij de verdediging, middenvelders op het middenveld, aanvallers voorin.',
      'De startformatie die je bij ‘Wijzig opzet’ kiest, geldt als beginwaarde voor nog lege kwarten.',
    ]},
  { datum:'2026-08-17', titel:'Poule-programma per speelronde', punten:[
      'Het tabblad Stand & Poule heeft nu naast de Stand een tweede tabje: Programma.',
      'Daar zie je alle wedstrijden binnen je poule — ook die van de andere teams, en ook de nog te spelen wedstrijden.',
      'Blader met de pijltjes ‹ / › per speelronde. Gespeelde wedstrijden tonen de uitslag, komende de aftraptijd. Je eigen team staat gemarkeerd.',
    ]},
  { datum:'2026-08-17', titel:'Kies je eigen weergave: licht/ donker of groot of klein lettertype', punten:[
      'De app heeft er een licht thema bij. Handig als je op een fel verlicht veld of in de zon op je scherm kijkt.',
      'Heb je iets minder goede ogen? Dan pas je het lettertype aan.',
      'Coaches stellen dit zelf in via Meer → Instellingen → Weergave. Je keuze wordt op je eigen toestel onthouden.',
      'Clubbeheerders kiezen onder Club → instellingen of coaches zelf mogen kiezen, of stellen één vaste weergave in voor de hele club.',
      'Het scorebord, de klok en de bank blijven altijd donker — witte cijfers op een donkere achtergrond lezen langs de lijn nu eenmaal het beste.',
    ]},
  { datum:'2026-08-16', titel:'Frisse, moderne look', punten:[
      'De hele app heeft een strakkere, rustigere uitstraling gekregen.',
      'Nieuw ASV\'33-tintje op het startscherm: het clublogo en de clubkleuren.',
      'Overal nieuwe, eigen iconen in plaats van emoji.',
    ]},
  { datum:'2026-08-15', titel:'Sneller en stabieler', punten:[
      'Een storing opgelost waardoor een wedstrijd soms niet opende.',
      'Kleine verbeteringen aan de spelers- en trainingsschermen.',
    ]},
  { datum:'2026-08-14', titel:'AI-wedstrijdverslag & wisselreden', punten:[
      'Na afloop maakt de app automatisch een leesbaar wedstrijdverslag op basis van wat je hebt gelogd. Spelersnamen gaan nooit naar de AI — dat gebeurt volledig privacyproof (AVG).',
      'Bij een wissel kun je nu een reden aangeven (Blessure, Tactisch, Gedrag, Trainingsopkomst), zichtbaar en aanpasbaar in het logboek.',
      'Speeltijd wordt in de teamstatistieken getoond als percentage gespeeld en reserve, zodat je in één oogopslag ziet of iedereen eerlijk aan bod komt.',
    ]},
  { datum:'2026-08-12', titel:'Overzichtelijker wedstrijdscherm', punten:[
      'Het scorebord is opgeschoond: doelknoppen en stand op één rij, teamnamen leesbaar eronder.',
      'Bij geplande wissels kun je kiezen voor "volgende in rotatie", zodat de speler met de minste speeltijd vooraan staat.',
      'De app start nu met een net laadscherm in plaats van een zwart scherm.',
    ]},
  { datum:'2026-08-05', titel:'Stand & Poule', punten:[
      'Nieuw tabblad onder Meer: de actuele poulestand én de uitslagen van álle teams in je poule.',
      'Wordt automatisch bijgewerkt via de nachtelijke sync. Je eigen team staat gemarkeerd.',
    ]},
  { datum:'2026-08-02', titel:'Video\'s uploaden & slimmere oefenstof', punten:[
      'Naast YouTube-links kun je nu ook eigen videoclips (MP4) rechtstreeks in de app zetten.',
      'Upload je een oefenstof-PDF, dan haalt de app de veldtekeningen eruit en zet de oefeningen om in een prettig scrollbaar schema voor langs het veld.',
    ]},
  { datum:'2026-08-01', titel:'Hulpchat: je vraagbaak in de app', punten:[
      'Een ingebouwde assistent die je vragen over de app beantwoordt.',
      'Weet je even niet waar iets staat of hoe iets werkt? Tik op Hulpchat en je krijgt meteen uitleg.',
    ]},
  { datum:'2026-07-27', titel:'Rondleiding voor nieuwe coaches', punten:[
      'Een interactieve rondleiding die je stap voor stap door alle schermen leidt — van je team openen tot een wedstrijd draaien.',
      'Later opnieuw te starten via Help.',
    ]},
  { datum:'2026-07-15', titel:'Teamevaluatie & dashboard', punten:[
      'Beoordeel je team na een wedstrijd op meerdere categorieën.',
      'Een dashboard laat de groeicurve, aandachtspunten en een trainingsadvies zien.',
      'Op het startscherm verschijnt een herinnering voor wedstrijden die nog geëvalueerd moeten worden.',
    ]},
  { datum:'2026-07-06', titel:'Wedstrijd-opzet in stappen', punten:[
      'Bij een nieuwe wedstrijd loop je vier korte stappen door: aanvoerder, aantal spelers, speelwijze en wedstrijddoel.',
      'Geen tijd? Overslaan kan altijd, en later aanpassen via "Wijzig opzet".',
    ]},
  { datum:'2026-07-04', titel:'Seizoenen & ASV-kompas', punten:[
      'Alle wedstrijden, trainingen en beoordelingen worden nu per seizoen bewaard, zodat de historie netjes gescheiden blijft.',
      'Bovenaan de Training-tab verschijnt wekelijks een ASV-kompas-tip uit het jeugdbeleidsplan.',
      'Bij de leercurve-thema\'s en wedstrijddoelen kun je doortikken naar achtergrond en concrete oefentips.',
    ]},
  { datum:'2026-06-28', titel:'Seizoensplanning', punten:[
      'Het tabblad Planning toont de hele seizoenskalender per maand: officiële KNVB-speeldagen, je eigen wedstrijden en zelf toegevoegde dagen (toernooi, vriendschappelijk, vrij).',
      'Met filters per soort dag.',
      'Op het veld werk je nu met tikken in plaats van slepen, zodat je makkelijk kunt scrollen tijdens de wedstrijd.',
    ]},
  { datum:'2026-06-20', titel:'Cluppie op je beginscherm', punten:[
      'De app heet voortaan Cluppie en kun je op je telefoon-beginscherm zetten — open hem met één tik, ook zonder browser.',
      'Wedstrijden worden automatisch ingeladen vanuit de KNVB-kalender (thuis/uit, datum, tegenstander).',
    ]},
  { datum:'2026-06-12', titel:'De eerste versie', punten:[
      'Zet je spelers op het veld, start de wedstrijdklok per kwart of helft, en wissel tijdens het spel — elke wissel wordt automatisch met tijdstip gelogd.',
      'Registreer doelpunten en kaarten volgens de KNVB-regels; de bank staat op volgorde van minste speeltijd, zodat je ziet wie aan de beurt is.',
      'Houd spelers en trainingsopkomst bij, bekijk oefenstof en video\'s, en nodig als beheerder coaches uit via een persoonlijke link.',
    ]},
];

/* Info voor de update-melding op de hub (banner + onder-link). Leest dezelfde
   'gezien'-sleutel als htmlUpdates() en telt de nog niet geziene releases.
   Wordt geëxporteerd zodat teams-hub.js het kan gebruiken zonder circulaire
   import (UPDATES woont hier). */
export function updatesInfo(){
  const laatstGezien = (() => { try { return localStorage.getItem('cluppie_updates_gezien') || ''; } catch(e){ return ''; } })();
  const ongelezen = UPDATES.filter(u => u.datum > laatstGezien).length;
  return { ongelezen, nieuwsteTitel: UPDATES[0]?.titel || '' };
}

function htmlUpdates(){
  try { localStorage.setItem('cluppie_updates_gezien', UPDATES[0]?.datum || ''); } catch(e){}
  const maand = ['jan','feb','mrt','apr','mei','jun','jul','aug','sep','okt','nov','dec'];
  const datumMooi = (iso) => { const d = new Date(iso); return `${d.getDate()} ${maand[d.getMonth()]} ${d.getFullYear()}`; };
  return `<div class="updates-lijst">
    ${UPDATES.map(u => `
      <div class="kaart update-kaart">
        <div class="update-datum">${datumMooi(u.datum)}</div>
        <div class="update-titel">${esc(u.titel)}</div>
        <ul class="update-punten">${u.punten.map(p => `<li>${esc(p)}</li>`).join('')}</ul>
      </div>`).join('')}
  </div>`;
}

function htmlMeer(){
  const documentenOngelezen = S.documenten
    .filter(d => (d.teams||[]).includes(S.teamId) && !S.trainingenGelezen[d.id]).length;
  const laatstGezien = (() => { try { return localStorage.getItem('cluppie_updates_gezien') || ''; } catch(e){ return ''; } })();
  const updatesOngelezen = UPDATES.filter(u => u.datum > laatstGezien).length;
  const tegels = [
    ['planning',   'Planning',   'Seizoenskalender'],
    ['poule',      'Stand & Poule', 'Poulestand + programma'],
    ['documenten', 'Documenten', 'Beleid & formulieren', documentenOngelezen],
    ['stats', 'Stats', modAan('evaluaties') ? 'Speeltijd & cijfers' : 'Speeltijd'],
    ['help',       'Help',       'Handleiding'],
    ['updates',    'Updates',    'Wat is er nieuw?', updatesOngelezen],
    ['hulpchat',   'Hulpchat',   'Stel je vraag over de app', null, true],
  ];
  return `<div class="tegel-grid">
    ${tegels.map(([id, naam, meta, badge, chat]) => `
      <button class="tegel" ${chat ? 'data-open-hulpchat="1"' : `data-meer-open="${id}"`}>
        ${badge ? `<span class="stip">${badge} nieuw</span>` : ''}
        <div class="ico">${NAV_ICON[id]}</div>
        <div class="naam">${naam}</div>
        <div class="meta">${meta}</div>
      </button>`).join('')}
  </div>`;
}

/* ---------- Tab: Stand & Poule ----------
   Toont de poulestand en het volledige poule-programma (ook van de overige
   teams). Data komt uit teams/{id}/poule/{stand,programma}, gevuld door de
   nachtelijke Sportlink-sync. Twee subtabs: Stand / Programma.

   Het programma bladert per speelronde (= per datum): gespeelde wedstrijden
   tonen de uitslag, komende wedstrijden de aftraptijd. Standaard opent de
   eerstvolgende ronde die nog niet (helemaal) gespeeld is. */

/* Bouwt de per-datum gegroepeerde speelronden uit de programmaregels.
   Valt terug op het oude uitslagen-document zolang de sync nog geen
   programma-doc heeft geschreven (dan zonder toekomstige wedstrijden). */
function pouleRonden(){
  const prog = S.pouleProgramma;
  let rijen = (prog && Array.isArray(prog.rijen)) ? prog.rijen : null;
  if (!rijen){
    // Fallback: oude uitslagen (alleen gespeeld) — voorkomt lege tab vóór eerste
    // programma-sync.
    const u = S.pouleUitslagen;
    rijen = (u && Array.isArray(u.rijen)) ? u.rijen.filter(r => r.uitslag) : [];
  }
  const perDatum = new Map();
  for (const r of rijen){
    if (!r.datum) continue;
    if (!perDatum.has(r.datum)) perDatum.set(r.datum, []);
    perDatum.get(r.datum).push(r);
  }
  // Chronologisch, binnen een dag op tijd.
  const ronden = [...perDatum.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([datum, items]) => ({
      datum,
      items: items.sort((x, y) => (x.tijd || '').localeCompare(y.tijd || '')),
    }));
  return ronden;
}

/* Eerstvolgende ronde-index: de eerste ronde met minstens één nog te spelen
   wedstrijd; anders de laatste (alles gespeeld → toon meest recente). */
function pouleStartRonde(ronden){
  const vandaag = new Date().toISOString().slice(0, 10);
  for (let i = 0; i < ronden.length; i++){
    if (ronden[i].datum >= vandaag) return i;
  }
  return Math.max(0, ronden.length - 1);
}

function htmlPoule(){
  const sub = S._pouleTab || 'stand';
  const stand = S.pouleStand;

  const subtabs = `
    <div class="subtabs">
      <button class="subtab ${sub==='stand'?'actief':''}" data-pouletab="stand">Stand</button>
      <button class="subtab ${sub==='programma'?'actief':''}" data-pouletab="programma">Programma</button>
    </div>`;

  // --- Stand ---
  let standHtml;
  if (stand && Array.isArray(stand.rijen) && stand.rijen.length){
    const rijen = stand.rijen.map(r => `
      <tr class="${r.eigen?'eigen':''}">
        <td class="pos">${r.positie||''}</td>
        <td>${esc(r.team||'')}</td>
        <td>${r.gespeeld||0}</td>
        <td>${r.gewonnen||0}</td>
        <td>${r.gelijk||0}</td>
        <td>${r.verloren||0}</td>
        <td>${r.saldo>0?'+':''}${r.saldo||0}</td>
        <td class="pnt">${r.punten||0}</td>
      </tr>`).join('');
    standHtml = `
      ${stand.klassepoule ? `<div class="poule-titel">${esc(stand.klassepoule)}</div>` : ''}
      <div class="stand">
        <table>
          <thead><tr><th>#</th><th>Team</th><th>G</th><th>W</th><th>GL</th><th>V</th><th>DS</th><th>Ptn</th></tr></thead>
          <tbody>${rijen}</tbody>
        </table>
      </div>
      <p class="poule-hint">Jouw team staat gemarkeerd. Ververst automatisch met de nachtelijke sync.</p>`;
  } else {
    standHtml = `<div class="kaart leeg">Nog geen poulestand beschikbaar.<br>De stand verschijnt zodra de competitie-indeling bekend is en de sync heeft gedraaid.</div>`;
  }

  // --- Programma (per speelronde, met ‹ / › navigatie) ---
  let progHtml;
  const ronden = pouleRonden();
  if (ronden.length){
    // Index vasthouden in state; clampen; standaard op eerstvolgende ronde.
    if (S._pouleRondeIdx == null || S._pouleRondeIdx < 0 || S._pouleRondeIdx >= ronden.length){
      S._pouleRondeIdx = pouleStartRonde(ronden);
    }
    const idx = S._pouleRondeIdx;
    const ronde = ronden[idx];
    const eersteWeek = idx === 0;
    const laatsteWeek = idx === ronden.length - 1;

    const regels = ronde.items.map(r => {
      const heeftUitslag = !!r.uitslag;
      const rechts = heeftUitslag
        ? `<span class="u">${esc(r.uitslag)}</span>`
        : `<span class="u komt">nog te spelen</span>`;
      const tijd = (!heeftUitslag && r.tijd)
        ? `<span class="tijd">Aftrap ${esc(r.tijd)}</span>` : '';
      return `
        <div class="wregel ${(r.eigenErin)?'eigen':''}">
          <span class="teams"><b>${esc(r.thuis)}</b> – ${esc(r.uit)}${tijd}</span>
          ${rechts}
        </div>`;
    }).join('');

    progHtml = `
      <div class="weekbalk">
        <button class="weekpijl" data-pouleronde="prev" ${eersteWeek?'disabled':''} aria-label="Vorige speelronde">‹</button>
        <div class="weeklabel">
          <div class="wk">Speelronde ${idx + 1}</div>
          <div class="wsub">${esc(datumNL(ronde.datum))}</div>
        </div>
        <button class="weekpijl" data-pouleronde="next" ${laatsteWeek?'disabled':''} aria-label="Volgende speelronde">›</button>
      </div>
      ${regels}
      <p class="poule-hint">Alle wedstrijden binnen de poule. Blader per speelronde. Ververst automatisch met de nachtelijke sync.</p>`;
  } else {
    progHtml = `<div class="kaart leeg">Nog geen programma beschikbaar.<br>Zodra de competitie-indeling bekend is en de sync heeft gedraaid, verschijnt hier het volledige poule-programma — ook van de andere teams.</div>`;
  }

  return subtabs + (sub==='stand' ? standHtml : progHtml);
}

export function renderTeam(){
  if (!S.team) return;
  const v = $('#view-team');
  // Uitgeschakelde module? Val terug op een veilig tabblad (bv. admin zette
  // Stats uit terwijl een coach nog op dat tabblad stond).
  const tab = S.teamTab;

  /* De hub is het startscherm van een team: eigen kop (begroeting + team-
     dropdown) en tegels — géén standaard team-kop en géén onderbalk. */
  if (tab === 'hub'){
    v.innerHTML = htmlHub(updatesInfo());
    koppelTeamTab(v, tab);
    return;
  }

  let inhoud = '';
  if (tab === 'wedstrijden') inhoud = htmlWedstrijden();
  if (tab === 'spelers')     inhoud = S._leenProfiel ? htmlLeenProfiel() : (S._beoordeelProfiel ? htmlProfiel() : htmlSpelers());
  if (tab === 'trainingen')  inhoud = htmlTeamTrainingen();
  if (tab === 'presentietraining') inhoud = htmlPresentieTraining();
  if (tab === 'preswedstrijd') inhoud = htmlPresWedstrijd();
  if (tab === 'evaluatie')   { inhoud = htmlEvaluatieLijst()
    + `<div class="sectie-kop" style="margin-top:22px">📈 Teamevaluatie</div>`
    + htmlSeizoenFilter() + htmlTeamEvaluatieDashboard(); telGebruik('stats_bekeken'); }
  if (tab === 'leerlijnoverzicht') { inhoud = htmlLeerlijnOverzicht(); telGebruik('leerlijn'); }
  if (tab === 'historie')    inhoud = htmlHistorieLijst();
  if (tab === 'videos')      inhoud = htmlTeamVideos();
  if (tab === 'meer')        inhoud = htmlMeer();
  if (tab === 'poule')       inhoud = htmlPoule();
  if (tab === 'planning')    inhoud = htmlPlanning();
  if (tab === 'documenten')  inhoud = htmlTeamDocumenten();
  if (tab === 'berichten')   inhoud = htmlBerichtenTab();
  if (tab === 'stats')       { inhoud = htmlStatsTab(); telGebruik('stats_bekeken'); }
  if (tab === 'instellingen')inhoud = htmlInstellingen();
  if (tab === 'help')        { inhoud = htmlHandleiding(); telGebruik('handleiding'); }
  if (tab === 'updates')     { inhoud = htmlUpdates(); telGebruik('updates_bekeken'); }

  /* Titel per tabblad in de kop, zodat de coach altijd ziet waar hij is
     (voorheen deed de actieve onderbalk-knop dat). */
  const TAB_TITEL = {
    wedstrijden:'Wedstrijden', spelers:'Spelers', trainingen:'Oefenstof',
    presentietraining:'Presentie training', preswedstrijd:'Presentie wedstrijd',
    evaluatie:'Evaluatie', leerlijnoverzicht:'Leerlijn', historie:'Historie',
    videos:'Video’s', meer:'Meer', poule:'Stand & poule', planning:'Planning',
    documenten:'Documenten', berichten:'Berichten', stats:'Stats', instellingen:'Instellingen',
    help:'Help', updates:'Updates',
  };

  const profielOpen = (tab === 'spelers' && (S._beoordeelProfiel || S._leenProfiel));
  v.innerHTML = `
    ${profielOpen ? '' : `<div class="kop"><button class="terug" id="naarTeams">‹</button>
      <h1>${esc(TAB_TITEL[tab] || S.team.naam)}<span class="sub">${esc(S.team.naam)}</span></h1>
      <button class="terug" id="teamInstel" title="Teaminstellingen">⚙️</button></div>`}
    ${inhoud}`;

  const naarTeamsBtn = v.querySelector('#naarTeams');
  if (naarTeamsBtn) naarTeamsBtn.onclick = () => history.back();
  const teamInstelBtn = v.querySelector('#teamInstel');
  if (teamInstelBtn) teamInstelBtn.onclick = () => zetTeamTab('instellingen');
  koppelTeamTab(v, tab);
}

/* ---------- Tab: wedstrijden ---------- */
/* Eén wedstrijd-regel bouwen (gedeeld door komende + afgelopen lijst). */
function wedstrijdRegel(w){
  const voor = (w.goals||[]).filter(g => g.type==='voor').length;
  const tegen = (w.goals||[]).filter(g => g.type==='tegen').length;
  const uitslag = (w.goals||[]).length || analyseWedstrijd(w).kwarten
    ? (w.thuis ? `${voor}–${tegen}` : `${tegen}–${voor}`) : '';
  const titel = w.type === 'toernooi'
    ? '🏆 ' + esc(w.tegenstander)
    : (w.thuis ? esc(S.team.naam)+' – '+esc(w.tegenstander) : esc(w.tegenstander)+' – '+esc(S.team.naam));
  // Onderdelen alleen tonen als ze bestaan: geïmporteerde wedstrijden hebben
  // nog geen format/formatie tot de coach de wedstrijd opent (normaliseerWedstrijd).
  const metaDelen = [datumNL(w.datum)];
  if (w.aftrap) metaDelen.push(esc(w.aftrap));
  if (w.type === 'toernooi'){
    metaDelen.push(`${w.toernooi.wedstrijden} wedstrijden`);
    if (w.format) metaDelen.push(`${esc(w.format)}v${esc(w.format)}`);
  } else {
    if (w.format) metaDelen.push(`${esc(w.format)}v${esc(w.format)}`);
    if (w.formatie) metaDelen.push(esc(w.formatie));
  }
  const meta = metaDelen.join(' · ');
  return `
    <button class="lijst-item" data-open-w="${w.id}">
      <div class="li-tekst"><div class="titel">${titel}</div>
      <div class="meta">${meta}</div></div>
      ${uitslag ? `<span class="badge" style="font-family:'Barlow Condensed';font-size:calc(15px * var(--fs));font-weight:700">${uitslag}</span>` : ''}
      <span class="pijl">›</span></button>`;
}

function htmlWedstrijden(){
  const knop = `<button class="knop vol" id="nieuweWedstrijd" style="margin-bottom:14px">+ Nieuwe wedstrijd</button>`;

  if (!S.wedstrijden.length){
    return knop + `<div class="kaart leeg">Nog geen wedstrijden.<br>Maak je eerste wedstrijd aan en zet de opstelling per kwart klaar.</div>`;
  }

  // "Afgelopen" = wedstrijd waarvan de datum vóór vandaag ligt. Zo verdwijnt een
  // gespeelde wedstrijd automatisch onder het ingeklapte blok (zoals presentie),
  // en staat de eerstvolgende bovenaan met de rest oplopend eronder.
  const vandaag = new Date().toISOString().slice(0, 10);
  const komend = [];
  const afgelopen = [];
  for (const w of S.wedstrijden){        // S.wedstrijden is nieuw → oud
    if ((w.datum || '') < vandaag) afgelopen.push(w);
    else komend.push(w);
  }
  // komend: oplopend (eerstvolgende bovenaan). afgelopen: aflopend (recentste eerst).
  komend.sort((a, b) => (a.datum||'').localeCompare(b.datum||'') || (a.aftrap||'').localeCompare(b.aftrap||''));

  // Eerstvolgende wedstrijd bovenaan met een "Eerstvolgend"-label; rest oplopend.
  const komendRegels = komend.map((w, i) => {
    if (i === 0){
      const r = wedstrijdRegel(w).replace(
        '<button class="lijst-item" data-open-w=',
        '<button class="lijst-item eerstvolgend" data-open-w=');
      return r.replace('<div class="li-tekst">',
        '<span class="vlag">Eerstvolgend</span><div class="li-tekst">');
    }
    return wedstrijdRegel(w);
  }).join('');

  const komendBlok = komend.length
    ? komendRegels
    : `<div class="kaart leeg" style="margin-bottom:12px">Geen komende wedstrijden gepland.</div>`;

  let afgelopenBlok = '';
  if (afgelopen.length){
    const open = S._afgelopenOpen;
    afgelopenBlok = `
      <div class="maand-groep" style="margin-top:16px">
        <button class="maand-kop" data-afgelopen>
          <span class="maand-naam">Afgelopen</span>
          <span class="maand-tel">${afgelopen.length} wedstrijd${afgelopen.length===1?'':'en'}</span>
          <span class="maand-pijl ${open?'open':''}">▾</span>
        </button>
        ${open ? `<div class="maand-inhoud">${afgelopen.map(wedstrijdRegel).join('')}</div>` : ''}
      </div>`;
  }

  return knop + komendBlok + afgelopenBlok;
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

  // Voorgaande dágen (niet alleen -maanden) staan standaard helemaal niet in
  // de lijst — pas na een klik op "Eerder" komen ze terug. Dit is dus een
  // aparte, grovere stap vóór de bestaande per-maand inklap-logica hieronder.
  const nuDatum = new Date().toISOString().slice(0,10);
  const verledenItems = items.filter(it => it.datum < nuDatum);
  if (!S._planningToonEerder) items = items.filter(it => it.datum >= nuDatum);

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

  const eerderKnop = verledenItems.length
    ? `<button class="knop licht klein" id="planEerder" style="margin-bottom:12px;width:100%">
        ${S._planningToonEerder ? '↑ Verberg eerdere speeldagen' : `← ${verledenItems.length} eerdere speeldag${verledenItems.length===1?'':'en'} bekijken`}
      </button>`
    : '';

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
    ${eerderKnop}
    ${body}`;
}

/* ---------- Video delen (WhatsApp e.d.) ----------
   Gebruikt de native deel-sheet (navigator.share) zodat WhatsApp, mail, enz.
   automatisch tussen de opties staan. Volgorde van proberen:
   1. Bij een geüploade mp4: het bestand zélf delen (mooiste resultaat) als de
      browser file-sharing ondersteunt en het bestand vlot op te halen is.
   2. Anders de link delen via de deel-sheet.
   3. Kan de browser geen van beide? Dan de link naar het klembord kopiëren.
   Geen spelersnamen of andere gevoelige data — enkel titel + URL. */
async function deelVideo(url, titel, type, knop){
  telGebruik('video_deel');
  const tekst = `🎬 ${titel}`;

  // 1. Probeer het mp4-bestand zelf te delen (alleen bij eigen uploads).
  if (type === 'upload' && navigator.canShare){
    const oudeInhoud = knop ? knop.innerHTML : '';
    try {
      if (knop){ knop.disabled = true; knop.textContent = 'Video ophalen…'; }
      const res  = await fetch(url);
      const blob = await res.blob();
      const naam = (titel.replace(/[^\w\- ]+/g,'').trim() || 'video') + '.mp4';
      const file = new File([blob], naam, { type: blob.type || 'video/mp4' });
      if (knop){ knop.disabled = false; knop.innerHTML = oudeInhoud; }
      if (navigator.canShare({ files: [file] })){
        await navigator.share({ files: [file], title: titel, text: tekst });
        return;
      }
    } catch (e){
      if (knop){ knop.disabled = false; knop.innerHTML = oudeInhoud; }
      // Bewust doorvallen naar link delen hieronder (bv. gebruiker annuleerde,
      // bestand te groot, of geen file-sharing). Een echte 'AbortError' door
      // annuleren negeren we stilletjes.
      if (e && e.name === 'AbortError') return;
    }
  }

  // 2. Deel de link via de native deel-sheet.
  if (navigator.share){
    try {
      await navigator.share({ title: titel, text: tekst, url });
      return;
    } catch (e){
      if (e && e.name === 'AbortError') return;
    }
  }

  // 3. Fallback: link naar klembord.
  try {
    await navigator.clipboard.writeText(url);
    meld('Link gekopieerd — plak \'m in WhatsApp');
  } catch {
    window.open(url, '_blank');
  }
}

/* ---------- Document delen via WhatsApp ----------
   Deelt titel + link naar de PDF (documenten onder de tegel "Documenten").
   Bewust géén spelernamen of andere gevoelige data — alleen wat de coach zelf
   mag doorsturen naar zijn teamgroep. Zelfde volgorde als deelVideo: native
   deel-sheet (WhatsApp/mail staan er dan tussen), anders link naar het klembord,
   anders in een nieuw tabblad openen. */
async function deelDocument(d){
  if (!d) return;
  telGebruik('document_deel');
  const titel = d.titel || d.bestandsnaam || 'Document';
  const url = d.url || '';

  // Link IN de tekst i.p.v. een los url-veld: bij navigator.share({text,url})
  // hangt WhatsApp de kale URL los onderaan het bericht. Door de link met een
  // begeleidende zin in de tekst te zetten (en géén url-veld mee te geven),
  // ziet de ontvanger nette context met de link erin.
  const bericht = url
    ? `📄 *${titel}*\nBekijk of download hier:\n${url}`
    : `📄 *${titel}*`;

  if (navigator.share){
    try {
      await navigator.share({ title: titel, text: bericht });
      return;
    } catch (e){
      if (e && e.name === 'AbortError') return;   // gebruiker annuleerde
    }
  }
  // fallback: WhatsApp-webintent met hetzelfde bericht
  try {
    window.open('https://wa.me/?text=' + encodeURIComponent(bericht), '_blank');
  } catch {
    try { await navigator.clipboard.writeText(bericht); meld('Gekopieerd — plak \'m in WhatsApp'); }
    catch { if (url) window.open(url, '_blank'); }
  }
}

/* ---------- Afgelasting (clubbreed) ----------
   De beheerder schrijft de afgelasting weg naar ALLE team-documenten van de club
   (zie modalClubAflasten in club.js). Elk team toont 'm hier zolang de datum geldig is.
   Geen naam in de banner of het WhatsApp-bericht. */
function koppelTeamTab(v, tab){
  if (tab === 'hub'){
    // tegels → tabbladen (zetTeamTab regelt de vaste beginstand per tab)
    v.querySelectorAll('[data-hub-open]').forEach(b => b.onclick = () => {
      S._beoordeelProfiel = null; S._leenProfiel = null;
      zetTeamTab(b.dataset.hubOpen);
    });
    const chatKnop = v.querySelector('[data-open-hulpchat]');
    if (chatKnop) chatKnop.onclick = () =>
      import('./chatbot.js?v=20260825i').then(m => m.openChatbot());
    // teamkeuze-dropdown (bij meerdere teams) + doorlink naar het overzicht
    const teamKnop = v.querySelector('#hubTeamKnop');
    const keuze = v.querySelector('#hubTeamKeuze');
    if (teamKnop && keuze) teamKnop.onclick = () => {
      keuze.classList.toggle('open');
      teamKnop.classList.toggle('open');
    };
    v.querySelectorAll('[data-hub-team]').forEach(b => b.onclick = () => {
      const id = b.dataset.hubTeam;
      if (id !== S.teamId) openTeam(id);
      else { keuze?.classList.remove('open'); teamKnop?.classList.remove('open'); }
    });
    const naarOverzicht = v.querySelector('[data-hub-overzicht]');
    if (naarOverzicht) naarOverzicht.onclick = () => verlaatTeamView();
    const uitKnop = v.querySelector('#hubUitloggen');
    if (uitKnop) uitKnop.onclick = () => { stopAlleListeners(); doSignOut(); };
    // update-banner wegtikken (per sessie): verbergt de banner zonder de
    // updates als gezien te markeren, zodat de onder-link zijn teller houdt.
    const bannerSluit = v.querySelector('#updBannerSluit');
    if (bannerSluit) bannerSluit.onclick = (e) => {
      e.stopPropagation(); e.preventDefault();
      S._updBannerWeg = true; renderTeam();
    };
    return;
  }
  if (tab === 'preswedstrijd'){
    // wedstrijd-kiezer: eerstvolgende staat er al; tik opent de keuzelijst
    const kiezer = v.querySelector('#pwKiezer');
    if (kiezer) kiezer.onclick = () => {
      openModal(presWedstrijdKeuzeHtml());
      // let op: de modal-inhoud leeft in #modalInhoud (zie openModal in state.js)
      $$('#modalInhoud [data-pw-kies]').forEach(b => b.onclick = () => {
        S._presWedstrijdId = b.dataset.pwKies;
        sluitModal(); renderTeam();
      });
    };
    // erbij ↔ afwezig (direct bewaard; de wedstrijden-listener rendert opnieuw)
    v.querySelectorAll('[data-pw-toggle]').forEach(b => b.onclick = () => {
      const pid = b.dataset.pwToggle;
      presWedstrijdBewaar((sel, redenen) => {
        if (sel.has(pid)) sel.delete(pid);
        else { sel.add(pid); delete redenen[pid]; }
      });
    });
    v.querySelectorAll('[data-pw-reden]').forEach(b => b.onclick = () => {
      const pid = b.dataset.pid, type = b.dataset.pwReden;
      presWedstrijdBewaar((sel, redenen) => {
        const huidig = redenen[pid];
        if (huidig && afwezigRedenInfo(huidig).id === type) delete redenen[pid];
        else redenen[pid] = {type, notitie: huidig?.notitie || ''};
      });
    });
    v.querySelectorAll('[data-pw-notitie]').forEach(inp => inp.onchange = () => {
      const pid = inp.dataset.pwNotitie;
      presWedstrijdBewaar((sel, redenen) => {
        if (redenen[pid]) redenen[pid].notitie = inp.value;
      });
    });
    return;
  }
  if (tab === 'evaluatie'){
    // openstaande evaluaties: tik = evaluatie invullen
    v.querySelectorAll('[data-eval-w]').forEach(b => b.onclick = () => {
      modalTeamEvaluatie(b.dataset.evalW);
    });
    // dashboard-handlers (voorheen op de Stats-tab): seizoensfilter,
    // historie-item openen, "toon eerdere", leercurve-thema-info
    v.querySelectorAll('[data-seizoenfilter]').forEach(b => b.onclick = () => {
      S.statsSeizoen = b.dataset.seizoenfilter; S._histAlles = false; renderTeam();
    });
    v.querySelectorAll('[data-open-teameval]').forEach(el => el.onclick = () => modalTeamEvaluatie(el.dataset.openTeameval));
    v.querySelectorAll('[data-thema-info]').forEach(el => el.onclick = () => toonThemaInfo(el.dataset.themaInfo));
    const histMeerBtn = v.querySelector('[data-hist-toon-meer]');
    if (histMeerBtn) histMeerBtn.onclick = () => { S._histAlles = true; renderTeam(); };
    return;
  }
  if (tab === 'leerlijnoverzicht'){
    // tik op een speler → profiel met het Leerlijn-tabblad open
    v.querySelectorAll('[data-lp-profiel]').forEach(b => b.onclick = () => {
      S._beoordeelProfiel = b.dataset.lpProfiel;
      S._profielTab = 'leerlijn';
      zetTeamTab('spelers');
    });
    return;
  }
  if (tab === 'historie'){
    // tik op een speler → profiel met het Historie-tabblad open
    v.querySelectorAll('[data-hist-profiel]').forEach(b => b.onclick = () => {
      S._beoordeelProfiel = b.dataset.histProfiel;
      S._profielTab = 'historie';
      zetTeamTab('spelers');
    });
    return;
  }
  if (tab === 'berichten'){
    // ✕ op een actieve berichtbalk: per apparaat wegklikken, daarna het
    // tabblad opnieuw tekenen (badge op de hub-tegel loopt vanzelf mee).
    const bb = v.querySelector('#berichtBalkTab');
    if (bb) koppelBerichtBalk(bb, () => renderTeam());
    return;
  }
  if (tab === 'meer'){
    v.querySelectorAll('[data-meer-open]').forEach(b => b.onclick = () => {
      zetTeamTab(b.dataset.meerOpen);
    });
    const chatKnop = v.querySelector('[data-open-hulpchat]');
    if (chatKnop) chatKnop.onclick = () =>
      import('./chatbot.js?v=20260825i').then(m => m.openChatbot());
    return;
  }
  if (tab === 'documenten'){
    v.querySelectorAll('[data-open-document]').forEach(r => r.onclick = async () => {
      const id = r.dataset.openDocument;
      const d = S.documenten.find(x => x.id === id);
      const { openPdfViewer } = await import('./pdf-viewer.js?v=20260825e');
      openPdfViewer({
        url: r.dataset.url,
        titel: d?.titel || d?.bestandsnaam || 'Document',
        meta: d?.categorie === 'beleid' ? 'Beleid' : d?.categorie === 'knvb' ? 'KNVB' : 'Overig'
      });
      if (!S.trainingenGelezen[id]){
        try { await setDoc(doc(db,'gebruikers',S.user.uid,'gelezen',id), {tijd: serverTimestamp()}); } catch(e){}
      }
    });
    // WhatsApp-deelknop op een documentrij (stopt de klik zodat de PDF niet opent)
    v.querySelectorAll('[data-deel-document]').forEach(b => b.onclick = (e) => {
      e.stopPropagation();
      const d = S.documenten.find(x => x.id === b.dataset.deelDocument);
      deelDocument(d);
    });
    return;
  }
  if (tab === 'stats'){
    koppelStatsBlad(v);
    // Klik op een spelernaam in de stats-tabel opent het spelersprofiel.
    // Via zetTeamTab('spelers') zodat de terugknop terugkeert naar Stats.
    v.querySelectorAll('[data-statsprofiel]').forEach(b => b.onclick = () => {
      S._beoordeelProfiel = b.dataset.statsprofiel;
      S._profielTab = 'overzicht';
      zetTeamTab('spelers');
    });
    v.querySelectorAll('[data-seizoenfilter]').forEach(b => b.onclick = () => {
      S.statsSeizoen = b.dataset.seizoenfilter; S._histAlles = false; renderTeam();
    });
    v.querySelectorAll('[data-thema-info]').forEach(el => el.onclick = () => toonThemaInfo(el.dataset.themaInfo));
    v.querySelectorAll('[data-open-teameval]').forEach(el => el.onclick = () => modalTeamEvaluatie(el.dataset.openTeameval));
    const histMeerBtn = v.querySelector('[data-hist-toon-meer]');
    if (histMeerBtn) histMeerBtn.onclick = () => { S._histAlles = true; renderTeam(); };
    const excelBtn = v.querySelector('#statsExcelExport');
    if (excelBtn) excelBtn.onclick = () => exportStatsExcel(excelBtn);
  }
  if (tab === 'planning'){
    const eigenBtn = v.querySelector('#planEigenDag');
    if (eigenBtn) eigenBtn.onclick = () => modalEigenDag();
    const eerderBtn = v.querySelector('#planEerder');
    if (eerderBtn) eerderBtn.onclick = () => {
      S._planningToonEerder = !S._planningToonEerder;
      if (S._planningToonEerder) S._planningDichteMaanden = null;  // opnieuw seeden zodat vers-getoonde verleden maanden weer ingeklapt starten
      renderTeam();
    };
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
  if (tab === 'trainingen' || tab === 'presentietraining'){
    // Oefenstof en Presentie training delen hun handlers: de selectors van het
    // andere tabblad matchen simpelweg niets (kompas/pdf op Oefenstof,
    // presentie-knoppen op Presentie training).
    // Leerlijn-blok (kompas + leerlijn): tik op de tekst opent het juiste info-blad
    // — een kompas-tip of een leercurve-thema, afhankelijk van het huidige item.
    const kompasTekst = v.querySelector('[data-kompas-info]');
    if (kompasTekst) kompasTekst.onclick = () => {
      const items = kompasItems();
      if (!items.length) return;
      const idx = ((S._kompasIdx ?? 0) % items.length + items.length) % items.length;
      const it = items[idx];
      if (it.soort === 'leer') toonThemaInfo(it.thema);
      else toonKompasInfo(kompasTips().findIndex(t => t.titel === it.titel));
    };
    // Handmatig bladeren door de gecombineerde reeks (blijft lokaal, reset bij heropenen tab)
    v.querySelectorAll('[data-kompas]').forEach(b => b.onclick = () => {
      const totaal = kompasItems().length;
      if (!totaal) return;
      const huidig = ((S._kompasIdx ?? 0) % totaal + totaal) % totaal;
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
      const titel = t?.titel || t?.bestandsnaam || 'Training';
      const meta  = [t?.week, datum].filter(Boolean).join(' · ');

      const openOrigineel = async () => {
        telGebruik('document_open');
        const { openPdfViewer } = await import('./pdf-viewer.js?v=20260825e');
        openPdfViewer({ url: r.dataset.url, titel, meta });
      };

      // AI-gestructureerde training → scrolbare weergave; anders de PDF-viewer.
      if (Array.isArray(t?.oefeningen) && t.oefeningen.length){
        const { openTrainingWeergave } = await import('./training-weergave.js?v=20260825e');
        openTrainingWeergave({
          titel, meta,
          oefeningen: t.oefeningen,
          diagramUrls: t.diagramUrls || {},
          onOrigineel: t.url ? openOrigineel : null,
          trainingId: id,
        });
      } else {
        await openOrigineel();
      }

      if (!S.trainingenGelezen[id]){
        try { await setDoc(doc(db,'gebruikers',S.user.uid,'gelezen',id), {tijd: serverTimestamp()}); } catch(e){}
      }
    });
    const pv = v.querySelector('#presentieVandaag');
    if (pv) pv.onclick = () => modalPresentie();
    const pad = v.querySelector('#presentieAndereDatum');
    if (pad) pad.onclick = () => modalPresentie(null, {startAnder:true});
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
      telGebruik('video_open');
      if (r.dataset.videoType === 'upload'){
        const titel = r.dataset.videoTitel || 'Video';
        const url   = r.dataset.openVideo;
        openModal(`
          <h2 style="margin-bottom:12px">${esc(titel)}</h2>
          <video src="${esc(url)}" controls autoplay playsinline preload="metadata"
                 style="width:100%;max-height:70vh;border-radius:12px;background:#000;display:block"></video>
          <button class="knop fluo vol" id="videoDeelKnop" style="margin-top:12px;display:flex;align-items:center;justify-content:center;gap:7px">${ico('action-whatsapp',18)}<span>Delen via WhatsApp</span></button>`);
        const dk = v.ownerDocument.getElementById('videoDeelKnop');
        if (dk) dk.onclick = () => deelVideo(url, titel, 'upload', dk);
      } else {
        window.open(r.dataset.openVideo, '_blank');
      }
    });
    v.querySelectorAll('[data-deel-video]').forEach(b => b.onclick = (e) => {
      e.stopPropagation();
      deelVideo(b.dataset.deelVideo, b.dataset.deelTitel || 'Video', b.dataset.deelType, b);
    });
    return;
  }
  if (tab === 'wedstrijden'){
    v.querySelector('#nieuweWedstrijd').onclick = modalNieuweWedstrijd;
    v.querySelectorAll('[data-open-w]').forEach(b => b.onclick = () => openWedstrijd(b.dataset.openW));
    const afgBtn = v.querySelector('[data-afgelopen]');
    if (afgBtn) afgBtn.onclick = () => { S._afgelopenOpen = !S._afgelopenOpen; renderTeam(); };
  }
  if (tab === 'poule'){
    v.querySelectorAll('[data-pouletab]').forEach(b => b.onclick = () => {
      // Bij (terug)wisselen naar Programma: op de eerstvolgende ronde openen.
      if (b.dataset.pouletab === 'programma') S._pouleRondeIdx = null;
      S._pouleTab = b.dataset.pouletab; renderTeam();
    });
    v.querySelectorAll('[data-pouleronde]').forEach(b => b.onclick = () => {
      const stap = b.dataset.pouleronde === 'next' ? 1 : -1;
      S._pouleRondeIdx = (S._pouleRondeIdx || 0) + stap;
      renderTeam();
    });
  }
  if (tab === 'spelers' && S._leenProfiel){
    // --- read-only leen-profiel ---
    const t = v.querySelector('#leenTerug');
    if (t) t.onclick = () => history.back();
  }
  else if (tab === 'spelers' && S._beoordeelProfiel){
    // --- profielscherm ---
    v.querySelector('#profielTerug').onclick = () => history.back();
    v.querySelectorAll('[data-ptab]').forEach(b => b.onclick = () => { S._profielTab = b.dataset.ptab; if (b.dataset.ptab === 'leerlijn') telGebruik('leerlijn'); renderTeam(); });
    v.querySelectorAll('[data-snel-speler]').forEach(b => b.onclick = () => modalSnelBeoordeling(b.dataset.snelSpeler));
    v.querySelectorAll('[data-volledig-speler]').forEach(b => b.onclick = () => modalVolledigeBeoordeling(b.dataset.volledigSpeler));
    v.querySelectorAll('[data-bewerk-speler]').forEach(b => b.onclick = () => modalSpeler(speler(b.dataset.bewerkSpeler)));
    v.querySelectorAll('[data-notitie]').forEach(b => b.onclick = () => modalNotitie(b.dataset.notitie));
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
      S._beoordeelProfiel = b.dataset.openProfiel; S._profielTab = 'overzicht'; telNav('spelerprofiel', 'tegel'); renderTeam();
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
    v.querySelector('#deelLink').onclick = () => import('./club.js?v=20260825i').then(m => m.modalUitnodig(S.team));
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
    v.querySelectorAll('#iWedstrijdvorm [data-vorm]').forEach(b => b.onclick = async () => {
      const vorm = b.dataset.vorm;
      if (String(S.team.format) === vorm) return;
      await updateDoc(doc(db,'teams',S.teamId), {format: vorm});
      meld('Wedstrijdvorm: ' + vorm + ' tegen ' + vorm);
    });
    v.querySelectorAll('#themaKeuze [data-thema-kies]').forEach(b => b.onclick = () => {
      kiesEigenThema(b.dataset.themaKies);
      v.querySelectorAll('#themaKeuze [data-thema-kies]').forEach(x =>
        x.classList.toggle('actief', x === b));
    });
    v.querySelectorAll('#grootteKeuze [data-grootte]').forEach(b => b.onclick = () => {
      zetLettergrootte(b.dataset.grootte);
      v.querySelectorAll('#grootteKeuze [data-grootte]').forEach(x =>
        x.classList.toggle('actief', x === b));
    });
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
    koppelOnboardingHerstart(v);
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
