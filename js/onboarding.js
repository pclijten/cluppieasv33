/* ==================== ONBOARDING / INTERACTIEVE RONDLEIDING ====================
   Een interactieve coach-mark-tour BOVENOP de echte app. Geen losse
   demoschermen: elke stap licht een bestaand element uit, geeft korte uitleg
   en wacht tot de coach de opdracht daadwerkelijk uitvoert (echte klik, echte
   tab-wissel). Zo heeft de gebruiker na afloop alles één keer zelf gedaan.

   Ontwerpprincipes (afgestemd op Cluppie, niet op de generieke prompt):
   - Cluppie is een vanilla-JS PWA, GEEN Flutter-app. De tour is dus een
     los ES-module zonder framework, in dezelfde stijl als de rest van js/.
   - De app heeft geen chat/taken/mededelingen/blessure-modules (blessure is
     bewust verwijderd i.v.m. AVG). De hoofdstukken volgen de ECHTE structuur:
     Wedstrijden · Spelers · Training · Video · Meer(Planning/Documenten/Stats)
     · Teaminstellingen · Help · (Clubbeheer voor admins).
   - Rol-adaptief: een 'speler/ouder' krijgt alleen lezen-hoofdstukken, een
     'coach/trainer' de volledige set, een 'beheerder' extra het clubdashboard.
   - Voortgang wordt opgeslagen (Firestore per gebruiker + localStorage-cache),
     dus je kunt afsluiten en later hervatten waar je was.

   Publieke API (aan te roepen vanuit teams.js / main.js):
     startOnboardingIndienNodig()  -> toont intro alleen bij eerste keer
     startOnboarding(force=true)   -> handmatig (her)starten vanuit Help
     onboardingActief()            -> bool, of de tour nu loopt
     onboardingHerstartBlok()      -> HTML-blokje voor in Help/Instellingen
     koppelOnboardingHerstart(root)-> knop in dat blokje activeren

   De stap-definities staan in ONBOARDING_STAPPEN hieronder. Nieuwe
   hoofdstukken toevoegen = een object aan die lijst toevoegen; er hoeft
   verder niets aan de engine te veranderen (zie beheeromgeving-notities
   onderaan). */

import { db, doc, getDoc, setDoc } from './firebase.js?v=20260727';
import { S, $, $$, esc, meld } from './state.js?v=20260727';

/* ---------- Rollen ----------
   Iedere rol krijgt alleen hoofdstukken waarvan de 'rollen'-set de rol bevat.
   'coach' is de brede default (trainer/leider/coördinator draaien in dezelfde
   schermen); 'kijker' is speler/ouder/vrijwilliger (alleen-lezen); 'beheerder'
   krijgt daarbovenop het clubdashboard. */
export const ONBOARDING_ROLLEN = [
  { id:'coach',     emoji:'📋', naam:'Coach / trainer', desc:'Opstelling, training, beoordelen' },
  { id:'leider',    emoji:'🧭', naam:'Teamleider',      desc:'Planning & communicatie' },
  { id:'kijker',    emoji:'👀', naam:'Speler / ouder',  desc:'Meekijken & voorbereiden' },
  { id:'beheerder', emoji:'🏛', naam:'Clubbeheerder',   desc:'Teams, coaches & content' },
];
/* leider valt qua schermen samen met coach; kijker = alleen-lezen subset. */
function rolSet(rol){
  if (rol === 'kijker')    return new Set(['kijker']);
  if (rol === 'beheerder') return new Set(['kijker','coach','beheerder']);
  return new Set(['kijker','coach']); // coach + leider
}

/* ==================== STAP-DEFINITIES ====================
   Elke stap:
     hfd      : hoofdstuk-id (voor voortgang/badges)
     hfdNaam  : leesbare hoofdstuknaam
     emoji    : icoon in de bubbel
     titel    : korte titel
     tekst    : HTML-uitleg (kort!)
     opdracht : (optioneel) korte doe-instructie onder de tekst
     wist     : (optioneel) "wist je dat?"-verdieping
     rollen   : array van rollen die deze stap zien
     doel     : () => Element | null   — welk element uitlichten
     wacht    : (klaar) => stopfn|void — luister op de ECHTE actie; roep
                klaar() als de coach de opdracht heeft uitgevoerd. Ontbreekt
                dit, dan is de stap 'lees & druk Volgende'.
     voor     : (optioneel) () => void — app in juiste stand zetten vóór tonen
                (bv. naar de juiste tab schakelen), zodat het doel bestaat.
   Alle doel/voor-functies praten met de ECHTE app-DOM en state (S). */

/* Helpers om de app te besturen tijdens de tour ---------------------------- */
function tabKnop(tab){ return document.querySelector(`.onderbalk button[data-tab="${tab}"]`); }
function meerTegel(sub){ return document.querySelector(`[data-meer-open="${sub}"]`); }
function huidigeTeamTab(){ return S.teamTab; }
function inTeamView(){ return !!document.querySelector('#view-team.actief'); }

/* Schakel programmatisch naar een team-tab en wacht tot de render klaar is. */
function naarTab(tab){
  return new Promise(res => {
    if (S.teamTab === tab && inTeamView()){ res(); return; }
    const b = tabKnop(tab);
    if (b){ b.click(); }
    else { S.teamTab = tab; import('./teams.js?v=20260727').then(m => m.renderTeam?.()); }
    requestAnimationFrame(() => requestAnimationFrame(res));
  });
}
/* Wacht tot een element bestaat (na een render), max ~2s. */
function wachtOpElement(getter, timeout = 2000){
  return new Promise(res => {
    const t0 = performance.now();
    (function tik(){
      const el = getter();
      if (el) return res(el);
      if (performance.now() - t0 > timeout) return res(null);
      requestAnimationFrame(tik);
    })();
  });
}
/* Luister één keer op een klik binnen de app die aan 'test' voldoet. */
function bijKlik(test, klaar){
  const h = e => { if (test(e)){ document.removeEventListener('click', h, true); klaar(); } };
  document.addEventListener('click', h, true);
  return () => document.removeEventListener('click', h, true);
}
/* Luister tot de team-tab verandert naar 'tab'. */
function bijTabWissel(tab, klaar){
  let stop = false;
  (function poll(){
    if (stop) return;
    if (S.teamTab === tab){ klaar(); return; }
    requestAnimationFrame(poll);
  })();
  return () => { stop = true; };
}
/* Luister tot aan een voorwaarde is voldaan (algemene poll). */
function bijVoorwaarde(test, klaar){
  let stop = false;
  (function poll(){
    if (stop) return;
    if (test()){ klaar(); return; }
    requestAnimationFrame(poll);
  })();
  return () => { stop = true; };
}

/* ---- Toestand-detectie van de echte app (voor conditionele stappen) ---- */
function wedstrijdOpen(){ return !!document.querySelector('#view-wedstrijd.actief'); }
function heeftWedstrijden(){ return (S.wedstrijden||[]).length > 0; }
function heeftSpelers(){ return (S.spelers||[]).length > 0; }
/* Open (indien mogelijk) de eerste bestaande wedstrijd, zodat de opstel-stappen
   een echt veld kunnen uitlichten. Lukt dat niet (nog geen wedstrijden), dan
   blijven we op de wedstrijden-tab en tonen we de "maak er een aan"-variant. */
async function zorgWedstrijdOpen(){
  if (wedstrijdOpen()) return true;
  await naarTab('wedstrijden');
  if (!heeftWedstrijden()) return false;
  const eersteId = (S.wedstrijden[0]||{}).id;
  if (!eersteId) return false;
  const m = await import('./wedstrijd.js?v=20260727');
  m.openWedstrijd?.(eersteId);
  await wachtOpElement(() => document.querySelector('#view-wedstrijd.actief'), 2000);
  return wedstrijdOpen();
}
/* Terug van het wedstrijdscherm naar de team-tabs (voor stappen ná de opstelling). */
async function verlaatWedstrijd(){
  if (!wedstrijdOpen()) return;
  const terug = document.querySelector('#view-wedstrijd #naarTeam');
  if (terug){ terug.click(); await wachtOpElement(() => document.querySelector('#view-team.actief'), 1500); }
}

/* De volledige rondleiding voor COACHES: alle schermen én acties die een coach
   in de app kan uitvoeren. Alleen de rol 'coach' (dekt ook trainer/leider) is
   hier van belang — de kijker- en beheerder-varianten zijn voor deze opdracht
   niet nodig, maar het rollen-veld blijft staan zodat de engine ongewijzigd
   werkt en de tour later uitgebreid kan worden. */
export const ONBOARDING_STAPPEN = [
  /* ══════════════ 0. WELKOM ══════════════ */
  {
    hfd:'welkom', hfdNaam:'Welkom', emoji:'👋', rollen:['coach'],
    titel:'Welkom bij Cluppie',
    tekst:'Ik loop met je mee langs <b>alles</b> wat je als coach kunt doen. Je blijft steeds in de echte app en voert elke stap zelf uit — na afloop ken je de hele app.',
    wist:'Alles werkt <b>realtime</b>: wat jij aanpast, zien je mede-coaches meteen.',
    doel:() => null, midden:true,
  },

  /* ══════════════ 1. TEAM OPENEN ══════════════ */
  {
    hfd:'team', hfdNaam:'Je team', emoji:'⚽', rollen:['coach'],
    titel:'Open je team',
    tekst:'Dit is je startscherm met de teams waar je coach van bent. Tik op een team om te beginnen.',
    opdracht:'Open een team',
    voor:async () => {
      if (!document.querySelector('#view-teams.actief')){
        const t = await import('./teams.js?v=20260727'); t.startTeams?.();
        await wachtOpElement(() => document.querySelector('#view-teams.actief'));
      }
    },
    doel:() => document.querySelector('#view-teams .lijst-item, #view-teams [data-team]'),
    wacht:(klaar) => bijKlik(
      e => e.target.closest('#view-teams .lijst-item, #view-teams [data-team]'),
      () => wachtOpElement(() => document.querySelector('#view-team.actief')).then(klaar)
    ),
  },

  /* ══════════════ 2. WEDSTRIJDEN ══════════════ */
  {
    hfd:'wedstrijden', hfdNaam:'Wedstrijden', emoji:'📋', rollen:['coach'],
    titel:'De Wedstrijden-tab',
    tekst:'Hier staan alle wedstrijden van je team. Vanaf hier open je een wedstrijd om de opstelling te maken.',
    opdracht:'Tik op de tab “Wedstr.” onderin',
    voor:() => naarTab('spelers'),
    doel:() => tabKnop('wedstrijden'),
    wacht:(klaar) => bijTabWissel('wedstrijden', klaar),
  },
  {
    hfd:'wedstrijden', hfdNaam:'Wedstrijden', emoji:'➕', rollen:['coach'],
    titel:'Nieuwe wedstrijd',
    tekst:'Met deze knop zet je een wedstrijd klaar: datum, tegenstander en thuis/uit. Competitiewedstrijden staan er vaak al automatisch in.',
    wist:'De KNVB-kalender wordt <b>elke nacht</b> uit voetbal.nl opgehaald — zodra de poule bekend is, staan de wedstrijden er vanzelf.',
    voor:() => naarTab('wedstrijden'),
    doel:() => document.querySelector('#view-team .opzet-knop, #view-team button.knop.fluo'),
  },

  /* ══════════════ 3. OPSTELLING MAKEN (het hart van de app) ══════════════ */
  {
    hfd:'opstelling', hfdNaam:'Opstelling', emoji:'🎽', rollen:['coach'],
    titel:'Open een wedstrijd',
    tekst:'Tik op een wedstrijd in de lijst om het wedstrijdscherm te openen. Daar maak je de opstelling en houd je de wedstrijd bij.',
    opdracht:'Open een wedstrijd uit de lijst',
    voor:() => naarTab('wedstrijden'),
    doel:() => document.querySelector('#view-team .lijst-item, #view-team [data-wid], #view-team .wedstrijd-rij'),
    wacht:(klaar) => bijVoorwaarde(() => wedstrijdOpen(), klaar),
    optioneelAls:() => !heeftWedstrijden(), // sla over als er nog geen wedstrijd is
  },
  {
    hfd:'opstelling', hfdNaam:'Opstelling', emoji:'🔢', rollen:['coach'],
    titel:'Per kwart',
    tekst:'Bovenin kies je het <b>kwart</b> (of de helft). Elke periode heeft zijn eigen opstelling, zodat je speeltijd eerlijk kunt verdelen.',
    voor:async () => { await zorgWedstrijdOpen(); },
    doel:() => document.querySelector('#view-wedstrijd .kwarten button[data-kwart]'),
    optioneelAls:() => !wedstrijdOpen(),
  },
  {
    hfd:'opstelling', hfdNaam:'Opstelling', emoji:'👆', rollen:['coach'],
    titel:'Speler op het veld zetten',
    tekst:'Zo werkt de opstelling: <b>tik een speler</b> op de bank (hij licht op) en <b>tik dan een lege plek</b> op het veld. Nog een keer tikken wisselt spelers om.',
    opdracht:'Tik een speler en zet hem op een positie',
    voor:async () => { await zorgWedstrijdOpen(); },
    doel:() => document.querySelector('#view-wedstrijd #bank .chip, #view-wedstrijd #veld .slot'),
    optioneelAls:() => !wedstrijdOpen(),
  },
  {
    hfd:'opstelling', hfdNaam:'Opstelling', emoji:'🪑', rollen:['coach'],
    titel:'De bank & selectie',
    tekst:'Onder het veld staat de <b>bank</b>. Spelers met de minste speeltijd staan bovenaan. Via “selectie” bepaal je wie er bij deze wedstrijd hoort.',
    voor:async () => { await zorgWedstrijdOpen(); },
    doel:() => document.querySelector('#view-wedstrijd #bank'),
    optioneelAls:() => !wedstrijdOpen(),
  },
  {
    hfd:'opstelling', hfdNaam:'Wedstrijd', emoji:'⏱', rollen:['coach'],
    titel:'De wedstrijdklok',
    tekst:'Start de klok bij het fluitsignaal. De app telt de <b>speeltijd per speler</b> automatisch mee, zodat je precies ziet wie hoeveel speelt.',
    voor:async () => { await zorgWedstrijdOpen(); },
    doel:() => document.querySelector('#view-wedstrijd #klokStart'),
    optioneelAls:() => !wedstrijdOpen(),
  },
  {
    hfd:'opstelling', hfdNaam:'Wedstrijd', emoji:'⚽', rollen:['coach'],
    titel:'Doelpunten & kaarten',
    tekst:'Tik op het bal-icoon in het scorebord om een <b>doelpunt</b> te loggen, of op het kaart-icoon voor een kaart. Alles komt in het wedstrijdverslag.',
    voor:async () => { await zorgWedstrijdOpen(); },
    doel:() => document.querySelector('#view-wedstrijd .scorebord'),
    optioneelAls:() => !wedstrijdOpen(),
  },
  {
    hfd:'opstelling', hfdNaam:'Wedstrijd', emoji:'🔄', rollen:['coach'],
    titel:'Wissel plannen',
    tekst:'Plan vooraf een wissel in: “speler X erin voor Y na 10 minuten”. Op het juiste moment krijg je een seintje — handig langs de lijn.',
    voor:async () => { await zorgWedstrijdOpen(); },
    doel:() => document.querySelector('#view-wedstrijd #planWissel'),
    optioneelAls:() => !wedstrijdOpen(),
  },
  {
    hfd:'opstelling', hfdNaam:'Wedstrijd', emoji:'📋', rollen:['coach'],
    titel:'Wedstrijdverslag',
    tekst:'Na afloop zie je hier een compleet <b>verslag</b>: uitslag, doelpunten, speeltijd per speler en de opstelling per kwart.',
    voor:async () => { await zorgWedstrijdOpen(); },
    doel:() => document.querySelector('#view-wedstrijd #toonVerslag'),
    optioneelAls:() => !wedstrijdOpen(),
  },
  {
    hfd:'opstelling', hfdNaam:'Wedstrijd', emoji:'📈', rollen:['coach'],
    titel:'Team evalueren',
    tekst:'Direct na de wedstrijd leg je kort vast wat goed ging en wat aandacht vraagt. Deze teamevaluaties verzamelen zich onder <b>Stats</b>.',
    wist:'Deze knop verschijnt alleen als de clubbeheerder <b>evaluaties</b> voor je team heeft aangezet.',
    voor:async () => { await zorgWedstrijdOpen(); },
    doel:() => document.querySelector('#view-wedstrijd #teamEvalKnop'),
    optioneelAls:() => !wedstrijdOpen() || !document.querySelector('#view-wedstrijd #teamEvalKnop'),
  },

  /* ══════════════ 4. SPELERS ══════════════ */
  {
    hfd:'spelers', hfdNaam:'Spelers', emoji:'👥', rollen:['coach'],
    titel:'Je selectie',
    tekst:'Onder <b>Spelers</b> beheer je de selectie: namen, rugnummers, beoordelingen en leerpunten.',
    opdracht:'Open de tab “Spelers”',
    voor:async () => { await verlaatWedstrijd(); await naarTab('wedstrijden'); },
    doel:() => tabKnop('spelers'),
    wacht:(klaar) => bijTabWissel('spelers', klaar),
  },
  {
    hfd:'spelers', hfdNaam:'Spelers', emoji:'➕', rollen:['coach'],
    titel:'Speler toevoegen',
    tekst:'Nieuwe speler erbij? Eén naam en rugnummer is genoeg. Zo bouw je in een minuut je hele selectie op.',
    voor:() => naarTab('spelers'),
    doel:() => document.querySelector('#view-team #nieuweSpeler'),
  },
  {
    hfd:'spelers', hfdNaam:'Spelers', emoji:'👤', rollen:['coach'],
    titel:'Open een spelersprofiel',
    tekst:'Tik op een speler om zijn profiel te openen. Daar vind je overzicht, leerlijn en historie.',
    opdracht:'Open een speler',
    voor:() => naarTab('spelers'),
    doel:() => document.querySelector('#view-team .speler-rij[data-open-profiel]'),
    wacht:(klaar) => bijVoorwaarde(() => !!S._beoordeelProfiel, klaar),
    optioneelAls:() => !heeftSpelers(),
  },
  {
    hfd:'spelers', hfdNaam:'Beoordelen', emoji:'⭐', rollen:['coach'],
    titel:'Beoordelen & leerpunten',
    tekst:'In het profiel leg je korte <b>beoordelingen</b> vast op vijf domeinen (TE·TA·FY·ME·GE) en formuleer je concrete <b>leerpunten</b> die over meerdere metingen doorlopen.',
    wist:'Beoordelingen zijn alleen zichtbaar voor coaches — spelers en ouders zien ze niet.',
    voor:() => { /* profiel-tabs staan al in beeld als een profiel open is */ },
    doel:() => document.querySelector('#view-team #profielTabs, #view-team .speler-rij[data-open-profiel]'),
    optioneelAls:() => !heeftSpelers(),
  },

  /* ══════════════ 5. TRAINING ══════════════ */
  {
    hfd:'training', hfdNaam:'Training', emoji:'📄', rollen:['coach'],
    titel:'Trainingen',
    tekst:'Onder <b>Training</b> vind je de oefenstof (PDF) voor de komende week. Een <b>🔴 rood stipje</b> op de tab betekent iets nieuws.',
    opdracht:'Open de tab “Training”',
    voor:async () => { S._beoordeelProfiel = null; await naarTab('spelers'); },
    doel:() => tabKnop('trainingen'),
    wacht:(klaar) => bijTabWissel('trainingen', klaar),
  },
  {
    hfd:'training', hfdNaam:'Presentie', emoji:'✅', rollen:['coach'],
    titel:'Presentie bijhouden',
    tekst:'Met “Wie is er vandaag?” vink je in één scherm de aanwezigheid af. Zo bouw je een beeld op van wie er vaak traint.',
    voor:() => naarTab('trainingen'),
    doel:() => document.querySelector('#view-team #presentieVandaag, #view-team .presentie-rij'),
  },
  {
    hfd:'training', hfdNaam:'ASV-kompas', emoji:'🧭', rollen:['coach'],
    titel:'Het ASV-kompas',
    tekst:'Bovenaan de Training-tab staat de wekelijkse <b>ASV-kompas</b>-tip: een pedagogisch thema uit het jeugdbeleidsplan om je training richting te geven.',
    wist:'De clubbeheerder kan het kompas per team aan- of uitzetten.',
    voor:() => naarTab('trainingen'),
    doel:() => document.querySelector('#view-team .kompas'),
    optioneelAls:() => !document.querySelector('#view-team .kompas'),
  },

  /* ══════════════ 6. VIDEO ══════════════ */
  {
    hfd:'video', hfdNaam:'Video', emoji:'🎬', rollen:['coach'],
    titel:'Video’s',
    tekst:'Onder <b>Video</b> staan YouTube-links met oefeningen of beelden om je training mee voor te bereiden.',
    opdracht:'Open de tab “Video”',
    voor:() => naarTab('trainingen'),
    doel:() => tabKnop('videos'),
    wacht:(klaar) => bijTabWissel('videos', klaar),
  },

  /* ══════════════ 7. MEER-menu ══════════════ */
  {
    hfd:'meer', hfdNaam:'Meer', emoji:'⋯', rollen:['coach'],
    titel:'Het “Meer”-menu',
    tekst:'Niet alles past in de balk. Onder <b>Meer</b> vind je Planning, Documenten, Stats en de Handleiding.',
    opdracht:'Open “Meer”',
    voor:() => naarTab('videos'),
    doel:() => tabKnop('meer'),
    wacht:(klaar) => bijTabWissel('meer', klaar),
  },

  /* ══════════════ 8. PLANNING ══════════════ */
  {
    hfd:'planning', hfdNaam:'Planning', emoji:'📅', rollen:['coach'],
    titel:'Seizoensplanning',
    tekst:'De <b>Planning</b> toont de hele seizoenskalender per maand. Echte wedstrijden verschijnen automatisch met een ⚽-stip.',
    opdracht:'Open “Planning”',
    voor:() => naarTab('meer'),
    doel:() => meerTegel('planning'),
    wacht:(klaar) => bijTabWissel('planning', klaar),
  },
  {
    hfd:'planning', hfdNaam:'Planning', emoji:'🔎', rollen:['coach'],
    titel:'Filteren & eigen dag',
    tekst:'Met de filterchips bekijk je gericht wedstrijden, speeldagen of vrije dagen. Met <b>“+ Eigen dag”</b> voeg je zelf een toernooi of vrije dag toe.',
    voor:() => naarTab('planning'),
    doel:() => document.querySelector('#view-team #planEigenDag, #view-team [data-planfilter]'),
    optioneelAls:() => !document.querySelector('#view-team [data-planfilter], #view-team #planEigenDag'),
  },

  /* ══════════════ 9. DOCUMENTEN ══════════════ */
  {
    hfd:'documenten', hfdNaam:'Documenten', emoji:'📂', rollen:['coach'],
    titel:'Documenten',
    tekst:'Onder <b>Documenten</b> staan gedeelde bestanden: draaiboeken, protocollen en clubinfo — als PDF, direct in de app te lezen.',
    opdracht:'Open “Documenten”',
    voor:() => naarTab('meer'),
    doel:() => meerTegel('documenten'),
    wacht:(klaar) => bijTabWissel('documenten', klaar),
  },

  /* ══════════════ 10. STATS ══════════════ */
  {
    hfd:'stats', hfdNaam:'Stats', emoji:'📊', rollen:['coach'],
    titel:'Stats & speeltijd',
    tekst:'Onder <b>Stats</b> zie je per speler de opgebouwde speeltijd en — via de segment-knoppen — de teamevaluaties over het seizoen.',
    opdracht:'Open “Stats”',
    voor:() => naarTab('meer'),
    doel:() => meerTegel('stats'),
    wacht:(klaar) => bijTabWissel('stats', klaar),
    optioneelAls:() => !meerTegel('stats'),
  },
  {
    hfd:'stats', hfdNaam:'Stats', emoji:'🗓', rollen:['coach'],
    titel:'Spelers, team & seizoen',
    tekst:'Wissel tussen <b>Spelers</b> en <b>Team</b>, en filter op seizoen. Zo vergelijk je ontwikkeling door het jaar heen.',
    voor:() => naarTab('stats'),
    doel:() => document.querySelector('#view-team #statsModus, #view-team #statsSeizoen'),
    optioneelAls:() => !document.querySelector('#view-team #statsModus'),
  },

  /* ══════════════ 11. TEAMINSTELLINGEN ══════════════ */
  {
    hfd:'instellingen', hfdNaam:'Instellingen', emoji:'⚙️', rollen:['coach'],
    titel:'Teaminstellingen',
    tekst:'Via het <b>⚙️ tandwiel</b> rechtsboven regel je de teamnaam, de speelcategorie en je eigen weergavenaam.',
    opdracht:'Open de teaminstellingen (⚙️)',
    voor:() => naarTab('wedstrijden'),
    doel:() => document.querySelector('#view-team #teamInstel'),
    wacht:(klaar) => bijVoorwaarde(() => S.teamTab === 'instellingen', klaar),
  },
  {
    hfd:'instellingen', hfdNaam:'Uitnodigen', emoji:'📲', rollen:['coach'],
    titel:'Coaches uitnodigen',
    tekst:'Hier vind je de <b>teamcode</b> en een <b>uitnodigingslink</b>. Deel die via WhatsApp en collega-coaches sluiten met één tik aan.',
    voor:async () => { S.teamTab = 'instellingen'; const m = await import('./teams.js?v=20260727'); m.renderTeam?.();
      await wachtOpElement(() => document.querySelector('#view-team #deelLink, #view-team #deelCode')); },
    doel:() => document.querySelector('#view-team #deelLink, #view-team #deelCode'),
    optioneelAls:() => !document.querySelector('#view-team #deelLink, #view-team #deelCode'),
  },

  /* ══════════════ 12. HANDLEIDING ══════════════ */
  {
    hfd:'help', hfdNaam:'Handleiding', emoji:'📖', rollen:['coach'],
    titel:'Altijd hulp bij de hand',
    tekst:'Onder <b>Meer → Handleiding</b> staat alles nog eens rustig uitgelegd, met een zoekbalk. En deze rondleiding kun je daar altijd opnieuw starten.',
    opdracht:'Open de Handleiding',
    voor:() => naarTab('meer'),
    doel:() => meerTegel('help'),
    wacht:(klaar) => bijTabWissel('help', klaar),
  },
];

/* ==================== VOORTGANG (opslag) ====================
   localStorage voor snelle offline-cache; Firestore zodat de status
   meereist naar een ander toestel. Firestore is optioneel — faalt dat
   (rechten/offline), dan werkt localStorage prima door. */
const LS_KEY = 'cluppieOnboarding_v1';
function lokaalLees(){ try { return JSON.parse(localStorage.getItem(LS_KEY) || '{}'); } catch { return {}; } }
function lokaalSchrijf(o){ try { localStorage.setItem(LS_KEY, JSON.stringify(o)); } catch {} }

async function voortgangLees(){
  const lok = lokaalLees();
  if (!S.user){ return lok; }
  try {
    const snap = await getDoc(doc(db, 'gebruikers', S.user.uid, 'meta', 'onboarding'));
    if (snap.exists()){ const d = snap.data(); lokaalSchrijf(d); return d; }
  } catch(e){ /* stil: localStorage blijft leidend */ }
  return lok;
}
async function voortgangSchrijf(o){
  lokaalSchrijf(o);
  if (!S.user) return;
  try { await setDoc(doc(db, 'gebruikers', S.user.uid, 'meta', 'onboarding'), o, { merge:true }); }
  catch(e){ /* stil */ }
}

/* ==================== ENGINE ==================== */
const st = {
  actief:false, rol:'coach', stappen:[], i:0, stopWacht:null, klaarGezet:new Set(),
};

function bouwLagen(){
  if (document.getElementById('obOverlay')) return;
  const wrap = document.createElement('div');
  wrap.innerHTML = `
    <div class="ob-overlay" id="obOverlay">
      <div class="ob-waas" id="obWaasT"></div><div class="ob-waas" id="obWaasB"></div>
      <div class="ob-waas" id="obWaasL"></div><div class="ob-waas" id="obWaasR"></div>
    </div>
    <div class="ob-ring" id="obRing" style="display:none"></div>
    <div class="ob-bubbel" id="obBubbel" style="display:none"></div>
    <div class="ob-hud" id="obHud" style="display:none">
      <button class="ob-hud-knop coach" id="obCoachKnop" title="Vraag de coach">💬</button>
      <div class="ob-voortgang"><div class="ob-voortgang-vul" id="obVul"></div></div>
      <span class="ob-hud-badge" id="obBadge">0/0</span>
      <button class="ob-hud-knop" id="obSluit" title="Later hervatten">✕</button>
    </div>
    <canvas class="ob-vier" id="obVier" style="display:none"></canvas>`;
  document.body.appendChild(wrap);
  document.getElementById('obCoachKnop').onclick = openCoach;
  document.getElementById('obSluit').onclick = () => stopTour(false);
}

/* Positioneer spotlight (vier waas-panelen + ring + pijl) rond een element. */
function plaatsSpotlight(el){
  const ov = document.getElementById('obOverlay');
  const ring = document.getElementById('obRing');
  ov.classList.add('aan');
  if (!el){ // gecentreerde stap zonder doel: volledige waas, geen ring
    ['obWaasT','obWaasB','obWaasL','obWaasR'].forEach((id,idx) => {
      const p = document.getElementById(id);
      p.style.cssText = idx===0 ? 'inset:0' : 'display:none';
    });
    ring.style.display = 'none';
    return;
  }
  const r = el.getBoundingClientRect();
  const pad = 8, vw = innerWidth, vh = innerHeight;
  const top = Math.max(0, r.top - pad), bot = Math.min(vh, r.bottom + pad);
  const lef = Math.max(0, r.left - pad), rig = Math.min(vw, r.right + pad);
  const S_ = document.getElementById.bind(document);
  Object.assign(S_('obWaasT').style, { display:'block', left:'0', top:'0', width:vw+'px', height:top+'px' });
  Object.assign(S_('obWaasB').style, { display:'block', left:'0', top:bot+'px', width:vw+'px', height:(vh-bot)+'px' });
  Object.assign(S_('obWaasL').style, { display:'block', left:'0', top:top+'px', width:lef+'px', height:(bot-top)+'px' });
  Object.assign(S_('obWaasR').style, { display:'block', left:rig+'px', top:top+'px', width:(vw-rig)+'px', height:(bot-top)+'px' });
  ring.style.display = 'block';
  ring.classList.add('puls');
  Object.assign(ring.style, { left:lef+'px', top:top+'px', width:(rig-lef)+'px', height:(bot-top)+'px' });
}

function plaatsBubbel(el){
  const b = document.getElementById('obBubbel');
  b.classList.remove('midden');
  requestAnimationFrame(() => {
    const bw = b.offsetWidth, bh = b.offsetHeight, vw = innerWidth, vh = innerHeight, m = 12;
    if (!el){ b.classList.add('midden'); return; }
    const r = el.getBoundingClientRect();
    let top, left = Math.min(Math.max(m, r.left + r.width/2 - bw/2), vw - bw - m);
    const onder = r.bottom + 14, boven = r.top - bh - 14;
    /* onder het doel als het past, anders erboven */
    top = (onder + bh < vh - m) ? onder : Math.max(m, boven);
    b.style.left = left + 'px'; b.style.top = top + 'px';
  });
}

function zichtbareStappen(){
  const rs = rolSet(st.rol);
  return ONBOARDING_STAPPEN.filter(s => s.rollen.some(r => rs.has(r)));
}

async function toonStap(){
  const stap = st.stappen[st.i];
  if (!stap){ voltooien(); return; }
  if (st.stopWacht){ st.stopWacht(); st.stopWacht = null; }

  if (stap.voor){ try { await stap.voor(); } catch(e){ console.warn('[ob] voor() faalde', e); } }
  const el = await wachtOpElement(() => stap.doel?.() || null, 1500);

  /* Conditionele stap: hoort alleen thuis als er echte data/knoppen zijn
     (bv. opstelling-stappen vereisen een geopende wedstrijd). Ontbreekt het
     doel én zegt optioneelAls() dat het mag, sla dan stil over — zo krijgt een
     kersvers account met nog geen wedstrijden/spelers geen dood scherm. */
  if (!el && stap.optioneelAls?.()){
    const richting = st._richting || 1;
    st.i += richting;
    if (st.i < 0) st.i = 0;
    return toonStap();
  }

  plaatsSpotlight(el);
  const b = document.getElementById('obBubbel');
  const totaal = st.stappen.length;
  const heeftOpdr = !!stap.wacht;
  b.innerHTML = `
    <div class="ob-b-kop">
      <span class="ob-b-emoji">${stap.emoji||'💡'}</span>
      <span class="ob-b-titel">${esc(stap.titel)}</span>
      <span class="ob-b-stap">${st.i+1}/${totaal}</span>
    </div>
    <div class="ob-b-tekst">${stap.tekst}</div>
    ${stap.opdracht ? `<div class="ob-b-opdr"><span class="ob-pijltje">➜</span>${esc(stap.opdracht)}</div>` : ''}
    ${stap.wist ? `<div class="ob-b-wist">💡 <b>Wist je dat?</b> ${stap.wist}</div>` : ''}
    <div class="ob-b-voet">
      <div class="ob-links">
        <button class="ob-knop sec mini" id="obVorig" ${st.i===0?'disabled':''}>‹ Vorige</button>
        <button class="ob-knop sec mini" id="obOversla">Overslaan</button>
      </div>
      <button class="ob-knop prim ${heeftOpdr?'wacht':''}" id="obVolgend">
        ${heeftOpdr ? '<span class="ob-sp"></span> Doe dit even' : (st.i===totaal-1 ? 'Afronden ✓' : 'Volgende ›')}
      </button>
    </div>`;
  b.style.display = 'block';
  requestAnimationFrame(() => b.classList.add('aan'));
  plaatsBubbel(el);

  document.getElementById('obVul').style.width = ((st.i)/totaal*100) + '%';
  document.getElementById('obBadge').textContent = `${st.i+1}/${totaal}`;

  document.getElementById('obVorig').onclick = () => gaNaar(st.i - 1);
  document.getElementById('obOversla').onclick = () => gaNaar(st.i + 1);
  const vBtn = document.getElementById('obVolgend');
  if (heeftOpdr){
    vBtn.disabled = true; // pas actief na échte actie
    st.stopWacht = stap.wacht(() => {
      vBtn.classList.remove('wacht'); vBtn.disabled = false;
      vBtn.innerHTML = (st.i===totaal-1 ? 'Afronden ✓' : 'Gelukt! Volgende ›');
      st.klaarGezet.add(st.i);
      // korte bevestiging + auto-door na een tik
      meld('✓ Gelukt!');
      vBtn.onclick = () => gaNaar(st.i + 1);
      // herpositioneer op de (mogelijk) nieuwe layout
      setTimeout(() => { const e2 = stap.doel?.(); plaatsSpotlight(e2||null); plaatsBubbel(e2||null); }, 60);
    });
    vBtn.onclick = () => { if (!vBtn.disabled) gaNaar(st.i + 1); };
  } else {
    vBtn.onclick = () => gaNaar(st.i + 1);
  }
}

function gaNaar(n){
  const b = document.getElementById('obBubbel');
  b.classList.remove('aan');
  st._richting = (n < st.i) ? -1 : 1;   // onthoud richting voor het overslaan van lege optionele stappen
  st.i = Math.max(0, Math.min(n, st.stappen.length));
  const hfd = st.stappen[Math.min(st.i, st.stappen.length-1)]?.hfd;
  voortgangSchrijf({ rol:st.rol, laatsteIndex:st.i, laatsteHfd:hfd, gestart:true });
  setTimeout(toonStap, 180);
}

/* ---------- Intro + rolkeuze ---------- */
function toonIntro(bekendeRol){
  bouwLagen();
  const intro = document.createElement('div');
  intro.className = 'ob-intro'; intro.id = 'obIntro';
  intro.innerHTML = `
    <img class="ob-intro-logo" src="icons/icon-192.png" alt="Cluppie" onerror="this.onerror=null;this.style.background='var(--accent)';this.removeAttribute('src')">
    <h1>Even samen<br>rondkijken</h1>
    <p>In een paar minuten leer je de hele app kennen — en je doet alles meteen zelf. Voor wie ben jij hier?</p>
    <div class="ob-rollen" id="obRollen">
      ${ONBOARDING_ROLLEN.map(r => `
        <button class="ob-rol ${r.id===bekendeRol?'gekozen':''}" data-rol="${r.id}">
          <span class="ob-rol-emoji">${r.emoji}</span>
          <span class="ob-rol-naam">${esc(r.naam)}</span>
          <span class="ob-rol-desc">${esc(r.desc)}</span>
        </button>`).join('')}
    </div>
    <button class="ob-intro-start" id="obStart" ${bekendeRol?'':'disabled'}>Start de rondleiding</button>
    <button class="ob-intro-skip" id="obSkip">Overslaan, ik red me wel</button>`;
  document.body.appendChild(intro);
  requestAnimationFrame(() => intro.classList.add('aan'));

  let gekozen = bekendeRol || null;
  intro.querySelectorAll('[data-rol]').forEach(btn => btn.onclick = () => {
    gekozen = btn.dataset.rol;
    intro.querySelectorAll('.ob-rol').forEach(x => x.classList.toggle('gekozen', x===btn));
    document.getElementById('obStart').disabled = false;
  });
  document.getElementById('obStart').onclick = () => {
    intro.classList.remove('aan');
    setTimeout(() => intro.remove(), 400);
    beginTour(gekozen || 'coach', 0);
  };
  document.getElementById('obSkip').onclick = () => {
    intro.classList.remove('aan'); setTimeout(() => intro.remove(), 400);
    voortgangSchrijf({ overgeslagen:true, gestart:true });
  };
}

function beginTour(rol, startIndex){
  st.rol = rol; st.stappen = zichtbareStappen();
  st.i = Math.max(0, Math.min(startIndex||0, st.stappen.length-1));
  st.actief = true;
  document.getElementById('obHud').style.display = 'flex';
  voortgangSchrijf({ rol, laatsteIndex:st.i, gestart:true });
  toonStap();
}

function stopTour(voltooid){
  st.actief = false;
  if (st.stopWacht){ st.stopWacht(); st.stopWacht = null; }
  ['obOverlay','obRing','obBubbel','obHud'].forEach(id => {
    const e = document.getElementById(id); if (e){ e.classList?.remove('aan'); e.style.display = 'none'; }
  });
  document.getElementById('obOverlay')?.classList.remove('aan');
  if (!voltooid){ meld('Onboarding gepauzeerd — hervat later via Meer → Handleiding'); }
}

/* ---------- Afronden + confetti + badges ---------- */
function voltooien(){
  voortgangSchrijf({ rol:st.rol, voltooid:true, gestart:true, laatsteIndex:st.stappen.length });
  stopTour(true);
  const scherm = document.createElement('div');
  scherm.className = 'ob-klaar'; scherm.id = 'obKlaar';
  const behaalde = [...new Set(st.stappen.map(s => s.hfd))];
  const badgeEmoji = { welkom:'👋', team:'⚽', wedstrijden:'📋', spelers:'👥',
    training:'📄', video:'🎬', meer:'⋯', planning:'📅', documenten:'📂',
    stats:'📊', instellingen:'⚙️', help:'📖', clubbeheer:'🏛' };
  const top = behaalde.slice(0, 6);
  scherm.innerHTML = `
    <div class="ob-klaar-emoji">🎉</div>
    <h1>Je bent er klaar voor!</h1>
    <p>Je hebt alle belangrijke schermen van Cluppie nu zelf gebruikt. Vanaf hier ben je zelfstandig — en je kunt alles nog eens nalezen in de handleiding.</p>
    <div class="ob-badges">
      ${top.map(h => `<div class="ob-badge">
        <div class="ob-badge-cirkel">${badgeEmoji[h]||'⭐'}</div>
        <div class="ob-badge-naam">${esc((st.stappen.find(s=>s.hfd===h)||{}).hfdNaam || h)}</div>
      </div>`).join('')}
    </div>
    <button class="ob-intro-start" id="obKlaarOk">Aan de slag ⚽</button>`;
  document.body.appendChild(scherm);
  requestAnimationFrame(() => scherm.classList.add('aan'));
  confetti();
  document.getElementById('obKlaarOk').onclick = () => {
    scherm.classList.remove('aan'); setTimeout(() => scherm.remove(), 400);
  };
}

function confetti(){
  const c = document.getElementById('obVier'); if (!c) return;
  c.style.display = 'block'; c.width = innerWidth; c.height = innerHeight;
  const ctx = c.getContext('2d');
  const kleuren = ['#e2342f','#ff6a55','#f5b13d','#35c47a','#ffffff'];
  const stukjes = Array.from({length:120}, () => ({
    x:Math.random()*c.width, y:-20-Math.random()*c.height*0.5,
    r:4+Math.random()*5, vy:2+Math.random()*3.5, vx:-1.5+Math.random()*3,
    rot:Math.random()*6.28, vr:-0.2+Math.random()*0.4,
    kl:kleuren[Math.floor(Math.random()*kleuren.length)] }));
  const t0 = performance.now();
  (function tik(nu){
    ctx.clearRect(0,0,c.width,c.height);
    stukjes.forEach(p => {
      p.y += p.vy; p.x += p.vx; p.rot += p.vr;
      ctx.save(); ctx.translate(p.x,p.y); ctx.rotate(p.rot);
      ctx.fillStyle = p.kl; ctx.fillRect(-p.r,-p.r/2,p.r*2,p.r);
      ctx.restore();
    });
    if (nu - t0 < 2800) requestAnimationFrame(tik);
    else { c.style.display = 'none'; ctx.clearRect(0,0,c.width,c.height); }
  })(t0);
}

/* ==================== AI-COACH ====================
   Een lichte, ingebouwde hulp-assistent. In de PWA praat deze bij voorkeur
   met een bestaande Cloud Function (zelfde Firebase-project). Is die er niet,
   dan valt hij terug op een slimme FAQ op basis van de handleiding-onderwerpen,
   zodat de coach nooit met een dood scherm blijft zitten. */
const COACH_FAQ = [
  { v:/opstelling|kwart|wissel/i, a:'Open een wedstrijd en kies bovenaan een <b>kwart</b>. Sleep spelers vanaf de bank het veld in; de speeltijd telt automatisch mee.' },
  { v:/uitnodig|code|coach toevoeg/i, a:'Ga naar <b>⚙️ Teaminstellingen</b>. Daar vind je de teamcode en een uitnodigingslink die je via WhatsApp kunt delen.' },
  { v:/training|pdf|oefen/i, a:'Onder de tab <b>Training</b> staan de PDF-oefeningen; een rood stipje betekent iets nieuws. Video-oefeningen staan onder <b>Video</b>.' },
  { v:/beoordel|profiel|leerpunt/i, a:'Tik onder <b>Spelers</b> op een naam om het profiel te openen. Daar leg je korte beoordelingen (TE·TA·FY·ME·GE) en leerpunten vast.' },
  { v:/planning|kalender|voetbal\.?nl/i, a:'De <b>Planning</b> (via Meer) toont de seizoenskalender. Competitiewedstrijden komen automatisch uit voetbal.nl; eigen dagen voeg je met “+ Eigen dag” toe.' },
  { v:/verder|kwijt|vast|hoe nu/i, a:'Geen zorgen — tik op <b>Volgende</b> in de bubbel, of op <b>Overslaan</b>. Je kunt de rondleiding later hervatten via Meer → Handleiding.' },
];
function coachAntwoord(vraag){
  const hit = COACH_FAQ.find(f => f.v.test(vraag));
  return hit ? hit.a : 'Goede vraag! Kijk gerust rond — en in de <b>Handleiding</b> (Meer-menu) staat alles stap voor stap. Zal ik verdergaan met de rondleiding?';
}
function openCoach(){
  let achter = document.getElementById('obCoachAchter');
  if (!achter){
    achter = document.createElement('div');
    achter.className = 'ob-coach-achter'; achter.id = 'obCoachAchter';
    achter.innerHTML = `
      <div class="ob-coach">
        <div class="ob-coach-kop">
          <div class="ob-coach-avatar">🐝</div>
          <div><div class="ob-coach-naam">Coach Cluppie</div>
            <div class="ob-coach-sub">Vraag me alles over de app</div></div>
          <button class="ob-coach-x" id="obCoachX">✕</button>
        </div>
        <div class="ob-coach-lijf" id="obCoachLijf">
          <div class="ob-msg bot">Hoi! Ik help je op weg. Waar loop je tegenaan? 👇</div>
        </div>
        <div class="ob-coach-chips" id="obCoachChips">
          ${['Hoe maak ik een opstelling?','Hoe nodig ik een coach uit?','Waar staan de trainingen?','Ga verder met de tour']
            .map(c => `<button class="ob-chip">${c}</button>`).join('')}
        </div>
        <div class="ob-coach-invoer">
          <input id="obCoachInput" placeholder="Typ je vraag…" autocomplete="off">
          <button class="ob-coach-stuur" id="obCoachStuur">➤</button>
        </div>
      </div>`;
    document.body.appendChild(achter);
    achter.addEventListener('click', e => { if (e.target===achter) sluitCoach(); });
    document.getElementById('obCoachX').onclick = sluitCoach;
    const stuur = () => {
      const inp = document.getElementById('obCoachInput');
      const v = inp.value.trim(); if (!v) return; inp.value = '';
      coachMsg(v, 'ik');
      if (/ga verder|verder met de tour/i.test(v)){ sluitCoach(); return; }
      tikIndicator(true);
      setTimeout(() => { tikIndicator(false); coachMsg(coachAntwoord(v), 'bot'); }, 550);
    };
    document.getElementById('obCoachStuur').onclick = stuur;
    document.getElementById('obCoachInput').addEventListener('keydown', e => { if (e.key==='Enter') stuur(); });
    document.getElementById('obCoachChips').addEventListener('click', e => {
      const b = e.target.closest('.ob-chip'); if (!b) return;
      const v = b.textContent;
      if (/ga verder/i.test(v)){ sluitCoach(); return; }
      coachMsg(v, 'ik'); tikIndicator(true);
      setTimeout(() => { tikIndicator(false); coachMsg(coachAntwoord(v), 'bot'); }, 500);
    });
  }
  requestAnimationFrame(() => achter.classList.add('open'));
}
function sluitCoach(){ document.getElementById('obCoachAchter')?.classList.remove('open'); }
function coachMsg(html, wie){
  const lijf = document.getElementById('obCoachLijf'); if (!lijf) return;
  const m = document.createElement('div'); m.className = 'ob-msg ' + wie; m.innerHTML = html;
  lijf.appendChild(m); lijf.scrollTop = lijf.scrollHeight;
}
function tikIndicator(aan){
  const lijf = document.getElementById('obCoachLijf'); if (!lijf) return;
  let t = document.getElementById('obTik');
  if (aan && !t){ t = document.createElement('div'); t.id='obTik'; t.className='ob-msg bot ob-tik';
    t.innerHTML='<span></span><span></span><span></span>'; lijf.appendChild(t); lijf.scrollTop=lijf.scrollHeight; }
  if (!aan && t){ t.remove(); }
}

/* ==================== PUBLIEKE API ==================== */
export function onboardingActief(){ return st.actief; }

export async function startOnboardingIndienNodig(){
  const vg = await voortgangLees();
  if (vg.voltooid || vg.overgeslagen) return;      // al gehad
  if (vg.gestart && typeof vg.laatsteIndex === 'number'){
    // hervatten aanbieden: kleine melding + directe intro met bekende rol
    toonIntro(vg.rol);
    // spring bij Start meteen naar laatste index:
    const start = document.getElementById('obStart');
    if (start){ const orig = start.onclick; start.onclick = () => {
      document.getElementById('obIntro')?.classList.remove('aan');
      setTimeout(() => document.getElementById('obIntro')?.remove(), 400);
      beginTour(vg.rol || 'coach', vg.laatsteIndex || 0);
    }; }
    return;
  }
  toonIntro(vg.rol || null);
}

export async function startOnboarding(force = true){
  const vg = await voortgangLees();
  toonIntro(vg.rol || null);
}

/* HTML-blokje voor onderaan de Handleiding of Instellingen. */
export function onboardingHerstartBlok(){
  return `<div class="ob-herstart-blok" id="obHerstartBlok">
    <span class="ob-hb-emoji">🎓</span>
    <div class="ob-hb-txt"><b>Rondleiding opnieuw</b>
      <span>Loop stap voor stap door de app — je doet alles zelf.</span></div>
    <button class="ob-knop prim mini" id="obHerstartKnop">Start</button>
  </div>`;
}
export function koppelOnboardingHerstart(root = document){
  const k = root.querySelector?.('#obHerstartKnop') || document.getElementById('obHerstartKnop');
  if (k) k.onclick = () => startOnboarding(true);
}
