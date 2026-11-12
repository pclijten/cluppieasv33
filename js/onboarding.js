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

import { db, doc, getDoc, setDoc } from './firebase.js?v=20261106r';
import { S, $, $$, esc, meld, modAan, toon, terugLaag } from './state.js?v=20261111g';

/* ---------- Rollen ----------
   Iedere rol krijgt alleen hoofdstukken waarvan de 'rollen'-set de rol bevat.
   'coach' is de brede default (trainer/leider/coördinator draaien in dezelfde
   schermen); 'kijker' is speler/ouder/vrijwilliger (alleen-lezen); 'beheerder'
   krijgt daarbovenop het clubdashboard. */
export const ONBOARDING_ROLLEN = [
  { id:'coach',     emoji:'<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><rect x="5" y="4.5" width="14" height="16" rx="2.2"/><path d="M9 3.2h6v3H9z"/><path d="M8.8 11.4h6.4"/><path d="M8.8 15.4h4"/></svg>', naam:'Coach / trainer', desc:'Opstelling, training, beoordelen' },
];
/* Er is nog maar één rol: coach/trainer (dekt ook leider). Het rollen-veld op de
   stappen blijft staan zodat de engine ongewijzigd werkt en de tour later weer
   uitgebreid kan worden, maar de rolSet levert altijd de coach-set. */
function rolSet(){
  return new Set(['kijker','coach']);
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
/* Sinds de hub-navigatie zijn de "tab-knoppen" de hub-tegels; de oude
   onderbalk-selector blijft als vangnet staan. Ontbreekt het doel (bv. de
   coach zit al in een tabblad), dan pakt naarTab() de directe fallback. */
function tabKnop(tab){ return document.querySelector(`#view-team [data-hub-open="${tab}"], .onderbalk button[data-tab="${tab}"]`); }
function meerTegel(sub){ return document.querySelector(`[data-meer-open="${sub}"], #view-team [data-hub-open="${sub}"]`); }
function huidigeTeamTab(){ return S.teamTab; }
function inTeamView(){ return !!document.querySelector('#view-team.actief'); }

/* Schakel programmatisch naar een team-tab en wacht tot de wissel écht rond is.
   Niet slechts twee frames: trage renders (of een dynamische import in de
   fallback) kregen vroeger te weinig tijd, waardoor de volgende stap zijn doel
   niet vond en onterecht werd overgeslagen of gecentreerd verscheen. */
function naarTab(tab){
  return new Promise(res => {
    if (S.teamTab === tab && inTeamView()){ res(); return; }
    const b = tabKnop(tab);
    if (b){ b.click(); }
    else {
      // Onderbalk niet in beeld (bv. wedstrijdscherm of teamsoverzicht):
      // zet de tab direct, render en toon de team-view expliciet.
      S.teamTab = tab;
      import('./teams.js?v=20261112b').then(m => { m.renderTeam?.(); toon('team'); });
    }
    const t0 = performance.now();
    (function wacht(){
      if (S.teamTab === tab && inTeamView()){
        requestAnimationFrame(() => res());        // nog één frame voor layout
        return;
      }
      if (performance.now() - t0 > 1800) return res(); // vangnet: nooit blijven hangen
      requestAnimationFrame(wacht);
    })();
  });
}
/* Wacht tot een element bestaat (na een render), max ~2s. */
function zichtbaarGelayout(el){
  if (!el) return false;
  const r = el.getBoundingClientRect();
  // element moet echte afmetingen hebben én binnen (of net buiten) het scherm liggen;
  // een nog-niet-gelayout element geeft 0×0 op {0,0} en zou de spotlight naar de hoek schieten.
  return r.width > 0 && r.height > 0;
}
function wachtOpElement(getter, timeout = 2000, eisLayout = false){
  return new Promise(res => {
    const t0 = performance.now();
    (function tik(){
      const el = getter();
      if (el && (!eisLayout || zichtbaarGelayout(el))) return res(el);
      if (performance.now() - t0 > timeout) return res(el || null); // fallback: geef terug wat er is
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
  let m;
  try { m = await import('./wedstrijd.js?v=20261112b'); }
  catch(e){ console.warn('[ob] kon wedstrijd.js niet laden', e); return false; }
  m.openWedstrijd?.(eersteId);
  await wachtOpElement(() => document.querySelector('#view-wedstrijd.actief'), 2000);
  return wedstrijdOpen();
}
/* Terug van het wedstrijdscherm naar de team-tabs (voor stappen ná de opstelling).
   Via sluitWedstrijd() i.p.v. history.back(): dat laatste was afhankelijk van de
   browsergeschiedenis en kon de tour op een onverwacht scherm laten belanden. */
async function verlaatWedstrijd(){
  if (!wedstrijdOpen()) return;
  try {
    const m = await import('./wedstrijd.js?v=20261112b');
    m.sluitWedstrijd?.('wedstrijden');
  } catch(e){
    console.warn('[ob] sluitWedstrijd faalde, val terug op terugknop', e);
    document.querySelector('#view-wedstrijd #naarTeam')?.click();
  }
  await wachtOpElement(() => document.querySelector('#view-team.actief'), 1500);
}

/* De volledige rondleiding voor COACHES: alle schermen én acties die een coach
   in de app kan uitvoeren. Alleen de rol 'coach' (dekt ook trainer/leider) is
   hier van belang — de kijker- en beheerder-varianten zijn voor deze opdracht
   niet nodig, maar het rollen-veld blijft staan zodat de engine ongewijzigd
   werkt en de tour later uitgebreid kan worden. */
export const ONBOARDING_STAPPEN = [
  /* ══════════════ 0. WELKOM ══════════════ */
  {
    hfd:'welkom', hfdNaam:'Welkom', emoji:'<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><circle cx="9" cy="7.6" r="2.9"/><path d="M3.4 19a5.6 5.6 0 0 1 11.2 0"/><rect x="16" y="8.6" width="5" height="6.6" rx="1.6"/><path d="M17.6 11.4h1.8"/></svg>', rollen:['coach'],
    titel:'Welkom bij Cluppie',
    tekst:'Ik loop met je mee langs <b>alles</b> wat je als coach kunt doen. Je blijft steeds in de echte app en voert elke stap zelf uit, na afloop ken je de hele app.',
    wist:'Alles werkt <b>realtime</b>: wat jij aanpast, zien je mede-coaches meteen.',
    doel:() => null, midden:true,
  },

  /* ══════════════ 1. TEAM OPENEN ══════════════ */
  {
    hfd:'team', hfdNaam:'Je team', emoji:'<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><rect x="3.2" y="4.6" width="17.6" height="14.8" rx="2.4"/><path d="M12 4.6v14.8"/><circle cx="12" cy="12" r="2.8"/></svg>', rollen:['coach'],
    titel:'Open je team',
    tekst:'Dit is je startscherm met de teams waar je coach van bent. Tik op een team om te beginnen.',
    opdracht:'Open een team',
    voor:async () => {
      if (!document.querySelector('#view-teams.actief')){
        try { const t = await import('./teams.js?v=20261112b'); t.startTeams?.(); } catch(e){ console.warn('[ob] teams.js laadfout', e); }
        await wachtOpElement(() => document.querySelector('#view-teams.actief'));
      }
    },
    doel:() => document.querySelector('#view-teams [data-open-team]'),
    wacht:(klaar) => bijKlik(
      e => e.target.closest('#view-teams [data-open-team]'),
      () => wachtOpElement(() => document.querySelector('#view-team.actief')).then(klaar)
    ),
  },

  /* ══════════════ 2. WEDSTRIJDEN ══════════════ */
  {
    hfd:'wedstrijden', hfdNaam:'Wedstrijden', emoji:'<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><rect x="5" y="4.5" width="14" height="16" rx="2.2"/><path d="M9 3.2h6v3H9z"/><path d="M8.8 11.4h6.4"/><path d="M8.8 15.4h4"/></svg>', rollen:['coach'],
    titel:'De Wedstrijden-tab',
    tekst:'Hier staan alle wedstrijden van je team. Vanaf hier open je een wedstrijd om de opstelling te maken.',
    opdracht:'Tik op de tab “Wedstr.” onderin',
    voor:() => naarTab('spelers'),
    doel:() => tabKnop('wedstrijden'),
    wacht:(klaar) => bijTabWissel('wedstrijden', klaar),
  },
  {
    hfd:'wedstrijden', hfdNaam:'Wedstrijden', emoji:'<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M12 5v14"/><path d="M5 12h14"/></svg>', rollen:['coach'],
    titel:'Nieuwe wedstrijd',
    tekst:'Met deze knop zet je een wedstrijd klaar: datum, tegenstander en thuis/uit. Competitiewedstrijden staan er vaak al automatisch in.',
    wist:'De KNVB-kalender wordt <b>elke nacht</b> uit voetbal.nl opgehaald: zodra de poule bekend is, staan de wedstrijden er vanzelf.',
    voor:() => naarTab('wedstrijden'),
    doel:() => document.querySelector('#view-team #nieuweWedstrijd'),
  },

  /* ══════════════ 3. OPSTELLING MAKEN (het hart van de app) ══════════════ */
  {
    hfd:'opstelling', hfdNaam:'Opstelling', emoji:'<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M9.2 4.5 6 6.2v4l2.2-.7v10h7.6v-10l2.2.7v-4l-3.2-1.7a2.9 2.9 0 0 1-5.6 0z"/></svg>', rollen:['coach'],
    titel:'Open een wedstrijd',
    tekst:'Tik op een wedstrijd in de lijst om het wedstrijdscherm te openen. Daar maak je de opstelling en houd je de wedstrijd bij.',
    opdracht:'Open een wedstrijd uit de lijst',
    voor:() => naarTab('wedstrijden'),
    doel:() => document.querySelector('#view-team [data-open-w]'),
    wacht:(klaar) => bijVoorwaarde(() => wedstrijdOpen(), klaar),
    optioneelAls:() => !heeftWedstrijden(), // sla over als er nog geen wedstrijd is
  },
  {
    hfd:'opstelling', hfdNaam:'Opstelling', emoji:'<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><rect x="3.2" y="4.6" width="17.6" height="14.8" rx="2.4"/><path d="M3.2 12h17.6"/><circle cx="12" cy="12" r="3.2"/><path d="M12 6.4v2.4M12 15.2v2.4"/></svg>', rollen:['coach'],
    titel:'Per kwart',
    tekst:'Bovenin kies je het <b>kwart</b> (of de helft). Elke periode heeft zijn eigen opstelling, zodat je speeltijd eerlijk kunt verdelen.',
    voor:async () => { await zorgWedstrijdOpen(); },
    doel:() => document.querySelector('#view-wedstrijd .kwarten button[data-kwart]'),
    optioneelAls:() => !wedstrijdOpen(),
  },
  {
    hfd:'opstelling', hfdNaam:'Opstelling', emoji:'<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><rect x="3.2" y="3.4" width="17.6" height="17.2" rx="2.4"/><path d="M3.2 12h17.6"/><circle cx="8" cy="7.4" r="1.5" fill="currentColor" stroke="none"/><circle cx="16" cy="7.4" r="1.5" fill="currentColor" stroke="none"/><circle cx="8" cy="16.6" r="1.5" fill="currentColor" stroke="none"/><circle cx="16" cy="16.6" r="1.5" fill="currentColor" stroke="none"/></svg>', rollen:['coach'],
    titel:'Speler op het veld zetten',
    tekst:'Zo werkt de opstelling: <b>tik een speler</b> op de bank (hij licht op) en <b>tik dan een lege plek</b> op het veld. Nog een keer tikken wisselt spelers om.',
    opdracht:'Tik een speler en zet hem op een positie',
    voor:async () => { await zorgWedstrijdOpen(); },
    doel:() => document.querySelector('#view-wedstrijd #bank .chip, #view-wedstrijd #veld .slot'),
    optioneelAls:() => !wedstrijdOpen(),
  },
  {
    hfd:'opstelling', hfdNaam:'Opstelling', emoji:'<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M4 8.8h13"/><path d="M13.6 5.4 17 8.8l-3.4 3.4"/><path d="M20 15.2H7"/><path d="M10.4 11.8 7 15.2l3.4 3.4"/></svg>', rollen:['coach'],
    titel:'De bank & selectie',
    tekst:'Onder het veld staat de <b>bank</b>. Spelers met de minste speeltijd staan bovenaan. Via “selectie” bepaal je wie er bij deze wedstrijd hoort.',
    voor:async () => { await zorgWedstrijdOpen(); },
    doel:() => document.querySelector('#view-wedstrijd #bank'),
    optioneelAls:() => !wedstrijdOpen(),
  },
  {
    hfd:'opstelling', hfdNaam:'Wedstrijd', emoji:'<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><circle cx="12" cy="12" r="8.6"/><path d="M12 7.2V12l3.4 2.2"/></svg>', rollen:['coach'],
    titel:'De wedstrijdklok',
    tekst:'Start de klok bij het fluitsignaal. De app telt de <b>speeltijd per speler</b> automatisch mee, zodat je precies ziet wie hoeveel speelt.',
    voor:async () => { await zorgWedstrijdOpen(); },
    doel:() => document.querySelector('#view-wedstrijd #klokStart'),
    optioneelAls:() => !wedstrijdOpen(),
  },
  {
    hfd:'opstelling', hfdNaam:'Wedstrijd', emoji:'<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><rect x="3.2" y="4.6" width="17.6" height="14.8" rx="2.4"/><path d="M12 4.6v14.8"/><circle cx="12" cy="12" r="2.8"/></svg>', rollen:['coach'],
    titel:'Doelpunten & kaarten',
    tekst:'Tik op het bal-icoon in het scorebord om een <b>doelpunt</b> te loggen, of op de gele knop bij de klok voor een kaart. Alles komt in het wedstrijdverslag.',
    voor:async () => { await zorgWedstrijdOpen(); },
    doel:() => document.querySelector('#view-wedstrijd .scorebord'),
    optioneelAls:() => !wedstrijdOpen(),
  },
  {
    hfd:'opstelling', hfdNaam:'Wedstrijd', emoji:'<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M4 8.8h13"/><path d="M13.6 5.4 17 8.8l-3.4 3.4"/><path d="M20 15.2H7"/><path d="M10.4 11.8 7 15.2l3.4 3.4"/></svg>', rollen:['coach'],
    titel:'Wissel plannen',
    tekst:'Plan vooraf een wissel in: “speler X erin voor Y na 10 minuten”. Op het juiste moment krijg je een seintje, handig langs de lijn.',
    voor:async () => { await zorgWedstrijdOpen(); },
    doel:() => document.querySelector('#view-wedstrijd #planWissel'),
    optioneelAls:() => !wedstrijdOpen(),
  },
  {
    hfd:'opstelling', hfdNaam:'Wedstrijd', emoji:'<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><rect x="5" y="4.5" width="14" height="16" rx="2.2"/><path d="M9 3.2h6v3H9z"/><path d="M8.8 11.4h6.4"/><path d="M8.8 15.4h4"/></svg>', rollen:['coach'],
    titel:'Wedstrijdverslag',
    tekst:'Na afloop zie je hier een compleet <b>verslag</b>: uitslag, doelpunten, speeltijd per speler en de opstelling per kwart.',
    voor:async () => { await zorgWedstrijdOpen(); },
    doel:() => document.querySelector('#view-wedstrijd #toonVerslag'),
    optioneelAls:() => !wedstrijdOpen(),
  },
  {
    hfd:'opstelling', hfdNaam:'Wedstrijd', emoji:'<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/></svg>', rollen:['coach'], modKey:'evaluaties',
    titel:'Team evalueren',
    tekst:'Direct na de wedstrijd leg je kort vast wat goed ging en wat aandacht vraagt. Deze teamevaluaties verzamelen zich onder <b>Stats</b>.',
    voor:async () => { await zorgWedstrijdOpen(); },
    doel:() => document.querySelector('#view-wedstrijd #teamEvalKnop'),
    optioneelAls:() => !wedstrijdOpen() || !document.querySelector('#view-wedstrijd #teamEvalKnop'),
  },

  /* ══════════════ 4. SPELERS ══════════════ */
  {
    hfd:'spelers', hfdNaam:'Spelers', emoji:'<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><circle cx="9" cy="8" r="2.8"/><path d="M3.5 19a5.5 5.5 0 0 1 11 0"/><circle cx="17" cy="8.5" r="2.3"/><path d="M15.5 13.4A4.8 4.8 0 0 1 20.5 18"/></svg>', rollen:['coach'],
    titel:'Je selectie',
    tekst:'Onder <b>Spelers</b> beheer je de selectie: namen, rugnummers, beoordelingen en leerpunten.',
    opdracht:'Open de tab “Spelers”',
    voor:async () => { await verlaatWedstrijd(); await naarTab('wedstrijden'); },
    doel:() => tabKnop('spelers'),
    wacht:(klaar) => bijTabWissel('spelers', klaar),
  },
  {
    hfd:'spelers', hfdNaam:'Spelers', emoji:'<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M12 5v14"/><path d="M5 12h14"/></svg>', rollen:['coach'],
    titel:'Speler toevoegen',
    tekst:'Nieuwe speler erbij? Eén naam en rugnummer is genoeg. Zo bouw je in een minuut je hele selectie op.',
    voor:() => naarTab('spelers'),
    doel:() => document.querySelector('#view-team #nieuweSpeler'),
  },
  {
    hfd:'spelers', hfdNaam:'Spelers', emoji:'<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><circle cx="12" cy="8" r="3.2"/><path d="M5.5 20a6.5 6.5 0 0 1 13 0"/></svg>', rollen:['coach'],
    titel:'Open een spelersprofiel',
    tekst:'Tik op een speler om zijn profiel te openen. Daar vind je overzicht, leerlijn en historie.',
    opdracht:'Open een speler',
    voor:() => naarTab('spelers'),
    doel:() => document.querySelector('#view-team .speler-rij[data-open-profiel]'),
    wacht:(klaar) => bijVoorwaarde(() => !!S._beoordeelProfiel, klaar),
    optioneelAls:() => !heeftSpelers(),
  },
  {
    hfd:'spelers', hfdNaam:'Beoordelen', emoji:'<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M12 4.2 14.5 9.4l5.5.8-4 4 1 5.6L12 17.2l-5 2.6 1-5.6-4-4 5.5-.8z"/></svg>', rollen:['coach'], modKey:'leerlijn',
    titel:'Beoordelen & leerpunten',
    tekst:'In het profiel leg je korte <b>beoordelingen</b> vast op vijf domeinen (TE·TA·FY·ME·GE) en formuleer je concrete <b>leerpunten</b> die over meerdere metingen doorlopen.',
    wist:'Beoordelingen zijn alleen zichtbaar voor coaches, spelers en ouders zien ze niet.',
    voor:() => { /* profiel-tabs staan al in beeld als een profiel open is */ },
    doel:() => document.querySelector('#view-team #profielTabs, #view-team .speler-rij[data-open-profiel]'),
    optioneelAls:() => !heeftSpelers(),
  },

  /* ══════════════ 5. TRAINING ══════════════ */
  {
    hfd:'training', hfdNaam:'Training', emoji:'<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M6.6 3.4h7L18.6 8.4v12.2h-12z"/><path d="M13.6 3.4V8.4h5"/></svg>', rollen:['coach'],
    titel:'Trainingen',
    tekst:'Onder <b>Training</b> vind je de oefenstof (PDF) voor de komende week. Een <b>rood stipje</b> op de tab betekent iets nieuws.',
    opdracht:'Open de tab “Training”',
    voor:async () => { S._beoordeelProfiel = null; await naarTab('spelers'); },
    doel:() => tabKnop('trainingen'),
    wacht:(klaar) => bijTabWissel('trainingen', klaar),
  },
  {
    hfd:'training', hfdNaam:'Presentie', emoji:'<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><circle cx="12" cy="12" r="9"/><path d="M8 12.2 11 15.2 16.2 9.4"/></svg>', rollen:['coach'],
    titel:'Presentie bijhouden',
    tekst:'Met “Wie is er vandaag?” vink je in één scherm de aanwezigheid af. Zo bouw je een beeld op van wie er vaak traint.',
    voor:() => naarTab('trainingen'),
    doel:() => document.querySelector('#view-team #presentieVandaag, #view-team .presentie-rij'),
  },
  {
    hfd:'training', hfdNaam:'ASV-kompas', emoji:'<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M3.5 8.2 6 4.8h5.6l2 3.4H20a.7.7 0 0 1 .7.7v9.3a1 1 0 0 1-1 1H4.3a1 1 0 0 1-1-1V8.9a.7.7 0 0 1 .2-.7z"/></svg>', rollen:['coach'], modKey:'kompas',
    titel:'Het ASV-kompas',
    tekst:'Bovenaan de Training-tab staat de wekelijkse <b>ASV-kompas</b>-tip: een pedagogisch thema uit het jeugdbeleidsplan om je training richting te geven.',
    voor:() => naarTab('trainingen'),
    doel:() => document.querySelector('#view-team .kompas'),
    optioneelAls:() => !document.querySelector('#view-team .kompas'),
  },

  /* ══════════════ 6. VIDEO ══════════════ */
  {
    hfd:'video', hfdNaam:'Video', emoji:'<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><rect x="3" y="6" width="13" height="12" rx="2.2"/><path d="M16 10l5-3v10l-5-3z"/></svg>', rollen:['coach'],
    titel:'Video’s',
    tekst:'Onder <b>Video</b> staan YouTube-links met oefeningen of beelden om je training mee voor te bereiden.',
    opdracht:'Open de tab “Video”',
    voor:() => naarTab('trainingen'),
    doel:() => tabKnop('videos'),
    wacht:(klaar) => bijTabWissel('videos', klaar),
  },

  /* ══════════════ 7. MEER-menu ══════════════ */
  {
    hfd:'meer', hfdNaam:'Meer', emoji:'<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><circle cx="5.6" cy="12" r="1.6" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.6" fill="currentColor" stroke="none"/><circle cx="18.4" cy="12" r="1.6" fill="currentColor" stroke="none"/></svg>', rollen:['coach'],
    titel:'Het “Meer”-menu',
    tekst:'Niet alles past in de balk. Onder <b>Meer</b> vind je Planning, Documenten, Stats en de Handleiding.',
    opdracht:'Open “Meer”',
    voor:() => naarTab('videos'),
    doel:() => tabKnop('meer'),
    wacht:(klaar) => bijTabWissel('meer', klaar),
  },

  /* ══════════════ 8. PLANNING ══════════════ */
  {
    hfd:'planning', hfdNaam:'Planning', emoji:'<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><rect x="3.5" y="5" width="17" height="15" rx="2.5"/><path d="M3.5 9.5h17M8 3v4M16 3v4"/><circle cx="12" cy="14.5" r="1.4" fill="currentColor" stroke="none"/></svg>', rollen:['coach'],
    titel:'Seizoensplanning',
    tekst:'De <b>Planning</b> toont de hele seizoenskalender per maand. Echte wedstrijden verschijnen automatisch met een <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><rect x="3.2" y="4.6" width="17.6" height="14.8" rx="2.4"/><path d="M12 4.6v14.8"/><circle cx="12" cy="12" r="2.8"/></svg>-stip.',
    opdracht:'Open “Planning”',
    voor:() => naarTab('meer'),
    doel:() => meerTegel('planning'),
    wacht:(klaar) => bijTabWissel('planning', klaar),
  },
  {
    hfd:'planning', hfdNaam:'Planning', emoji:'<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><circle cx="10.5" cy="10.5" r="6.5"/><path d="M15.3 15.3 20 20"/></svg>', rollen:['coach'],
    titel:'Filteren & eigen dag',
    tekst:'Met de filterchips bekijk je gericht wedstrijden, speeldagen of vrije dagen. Met <b>“+ Eigen dag”</b> voeg je zelf een toernooi of vrije dag toe.',
    voor:() => naarTab('planning'),
    doel:() => document.querySelector('#view-team #planEigenDag, #view-team [data-planfilter]'),
    optioneelAls:() => !document.querySelector('#view-team [data-planfilter], #view-team #planEigenDag'),
  },

  /* ══════════════ 9. DOCUMENTEN ══════════════ */
  {
    hfd:'documenten', hfdNaam:'Documenten', emoji:'<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><rect x="3.4" y="4.6" width="17.2" height="4.4" rx="1.8"/><path d="M5.2 9v10.4h13.6V9"/><path d="M10 13h4"/></svg>', rollen:['coach'],
    titel:'Documenten',
    tekst:'Onder <b>Documenten</b> staan gedeelde bestanden: draaiboeken, protocollen en clubinfo: als PDF, direct in de app te lezen.',
    opdracht:'Open “Documenten”',
    voor:() => naarTab('meer'),
    doel:() => meerTegel('documenten'),
    wacht:(klaar) => bijTabWissel('documenten', klaar),
  },

  /* ══════════════ 10. STATS ══════════════ */
  {
    hfd:'stats', hfdNaam:'Stats', emoji:'<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M4 19V10"/><path d="M11 19V5"/><path d="M18 19v-7"/></svg>', rollen:['coach'], modKey:'evaluaties',
    titel:'Stats & speeltijd',
    tekst:'Onder <b>Stats</b> zie je per speler de opgebouwde speeltijd en, via de segment-knoppen, de teamevaluaties over het seizoen.',
    opdracht:'Open “Stats”',
    voor:() => naarTab('meer'),
    doel:() => meerTegel('stats'),
    wacht:(klaar) => bijTabWissel('stats', klaar),
    optioneelAls:() => !meerTegel('stats'),
  },
  {
    hfd:'stats', hfdNaam:'Stats', emoji:'<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><rect x="3.5" y="5" width="17" height="15" rx="2.5"/><path d="M3.5 9.5h17M8 3v4M16 3v4"/><path d="M3.5 14.6h17"/><circle cx="7.6" cy="12.1" r="1.2" fill="currentColor" stroke="none"/><circle cx="12" cy="12.1" r="1.2" fill="currentColor" stroke="none"/><circle cx="16.4" cy="12.1" r="1.2" fill="currentColor" stroke="none"/></svg>', rollen:['coach'], modKey:'evaluaties',
    titel:'Spelers, team & seizoen',
    tekst:'Wissel tussen <b>Spelers</b> en <b>Team</b>, en filter op seizoen. Zo vergelijk je ontwikkeling door het jaar heen.',
    voor:() => naarTab('stats'),
    doel:() => document.querySelector('#view-team #statsModus, #view-team #statsSeizoen'),
    optioneelAls:() => !document.querySelector('#view-team #statsModus'),
  },

  /* ══════════════ 11. TEAMINSTELLINGEN ══════════════ */
  {
    hfd:'instellingen', hfdNaam:'Instellingen', emoji:'<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><circle cx="12" cy="12" r="3.1"/><path d="M12 3.2 13.6 5.4l2.6-.6 1 2.5 2.6.7-.5 2.6L21 12l-1.7 1.4.5 2.6-2.6.7-1 2.5-2.6-.6L12 20.8l-1.6-2.2-2.6.6-1-2.5-2.6-.7.5-2.6L3 12l1.7-1.4-.5-2.6 2.6-.7 1-2.5 2.6.6z"/></svg>', rollen:['coach'],
    titel:'Teaminstellingen',
    tekst:'Via de tegel <b>Instellingen</b> (onder Meer) regel je de teamnaam, de speelcategorie en je eigen weergavenaam.',
    opdracht:'Open Instellingen',
    voor:() => naarTab('meer'),
    doel:() => meerTegel('instellingen'),
    wacht:(klaar) => bijTabWissel('instellingen', klaar),
  },
  {
    hfd:'instellingen', hfdNaam:'Uitnodigen', emoji:'📲', rollen:['coach'],
    titel:'Coaches uitnodigen',
    tekst:'Hier vind je de <b>teamcode</b> en een <b>uitnodigingslink</b>. Deel die via WhatsApp en collega-coaches sluiten met één tik aan.',
    voor:async () => { S.teamTab = 'instellingen'; const m = await import('./teams.js?v=20261112b'); m.renderTeam?.();
      await wachtOpElement(() => document.querySelector('#view-team #deelLink, #view-team #deelCode')); },
    doel:() => document.querySelector('#view-team #deelLink, #view-team #deelCode'),
    optioneelAls:() => !document.querySelector('#view-team #deelLink, #view-team #deelCode'),
  },

  /* ══════════════ 12. HANDLEIDING ══════════════ */
  {
    hfd:'help', hfdNaam:'Handleiding', emoji:'<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M4.4 5.6a2.2 2.2 0 0 1 2.2-2.2h13v17.2H6.6a2.2 2.2 0 0 0-2.2 2.2z"/><path d="M8.4 8.4h7"/><path d="M8.4 12h4.6"/></svg>', rollen:['coach'],
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
  beurt:0,   // stap-token: verouderde async-callbacks (van een vórige stap) negeren
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
      <button class="ob-hud-knop coach" id="obCoachKnop" title="Vraag de coach"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M4 5.5h16a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H9l-4 3.2V16.5H4a1 1 0 0 1-1-1v-9a1 1 0 0 1 1-1z"/><path d="M8 9.5h8M8 12.5h5"/></svg></button>
      <div class="ob-voortgang"><div class="ob-voortgang-vul" id="obVul"></div></div>
      <span class="ob-hud-badge" id="obBadge">0/0</span>
      <button class="ob-hud-knop" id="obSluit" title="Later hervatten">✕</button>
    </div>
    <canvas class="ob-vier" id="obVier" style="display:none"></canvas>`;
  document.body.appendChild(wrap);
  document.getElementById('obCoachKnop').onclick = openCoach;
  document.getElementById('obSluit').onclick = () => stopTour(false);

  /* De spotlight en bubbel staan op vaste pixels. Alles wat de layout verandert
     — scrollen, draaien, toetsenbord, of een tik die de app laat her-renderen
     (de waas laat kliks door!) — zette ze vroeger scheef. Daarom: bij elk van
     die signalen het doel opnieuw opzoeken en alles herpositioneren. */
  window.addEventListener('resize', herpositioneer);
  window.addEventListener('orientationchange', herpositioneer);
  window.addEventListener('scroll', herpositioneer, true);
  if (window.visualViewport) window.visualViewport.addEventListener('resize', herpositioneer);
  document.addEventListener('click', () => {
    if (st.actief) setTimeout(herpositioneer, 0);   // ná de (synchrone) app-render
  }, true);
}

/* Zoek het doel van de huidige stap opnieuw op en zet spotlight, bubbel en
   HUD-ontwijking er weer strak omheen. RAF-gedempt zodat scroll-events niet
   elke pixel opnieuw rekenen. */
let _herposGepland = false;
function herpositioneer(){
  if (!st.actief || _herposGepland) return;
  _herposGepland = true;
  requestAnimationFrame(() => {
    _herposGepland = false;
    if (!st.actief) return;
    const stap = st.stappen[st.i]; if (!stap) return;
    const el = stap.doel?.() || null;
    plaatsSpotlight(el);
    ontwijkHud(el);
    if (!st._versleept) plaatsBubbel(el);
  });
}

/* Scroll het doel netjes (gecentreerd) in beeld als het buiten de bruikbare
   zone valt — veel doelen (verslag-knop, presentielijst, bank) staan onder de
   vouw. Zonder dit rekende de spotlight met een rechthoek buiten het scherm
   en leek de stap 'nergens' te wijzen. */
async function zorgInBeeld(el){
  if (!el || !zichtbaarGelayout(el)) return;
  const r = el.getBoundingClientRect();
  const bovenM = 64, onderM = 84;   // vrij van de HUD-balk (boven) en onderbalk
  if (r.top >= bovenM && r.bottom <= innerHeight - onderM) return;
  try { el.scrollIntoView({ block:'center', behavior:'instant' }); }
  catch { el.scrollIntoView(); }
  await new Promise(res => requestAnimationFrame(() => requestAnimationFrame(res)));
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
  if (r.width === 0 || r.height === 0){ // ontaard element: behandel als doelloze (gecentreerde) stap
    ['obWaasT','obWaasB','obWaasL','obWaasR'].forEach((id,idx) => {
      const p = document.getElementById(id);
      p.style.cssText = idx===0 ? 'inset:0' : 'display:none';
    });
    ring.style.display = 'none';
    return;
  }
  const pad = 8, vw = innerWidth, vh = innerHeight;
  const top = Math.max(0, r.top - pad), bot = Math.max(top, Math.min(vh, r.bottom + pad));
  const lef = Math.max(0, r.left - pad), rig = Math.max(lef, Math.min(vw, r.right + pad));
  const S_ = document.getElementById.bind(document);
  Object.assign(S_('obWaasT').style, { display:'block', left:'0', top:'0', width:vw+'px', height:top+'px' });
  Object.assign(S_('obWaasB').style, { display:'block', left:'0', top:bot+'px', width:vw+'px', height:Math.max(0, vh-bot)+'px' });
  Object.assign(S_('obWaasL').style, { display:'block', left:'0', top:top+'px', width:lef+'px', height:Math.max(0, bot-top)+'px' });
  Object.assign(S_('obWaasR').style, { display:'block', left:rig+'px', top:top+'px', width:Math.max(0, vw-rig)+'px', height:Math.max(0, bot-top)+'px' });
  ring.style.display = 'block';
  ring.classList.add('puls');
  Object.assign(ring.style, { left:lef+'px', top:top+'px', width:(rig-lef)+'px', height:(bot-top)+'px' });
}

/* Als het uitgelichte doel (bv. een knop rechtsboven) onder de HUD-balk
   valt, dan zit de ✕-sluitknop van de voortgangsbalk er precies bovenop en vangt
   die de tik op i.p.v. het doel. In dat geval zetten we de HUD-knoppen voor deze
   stap opzij, zodat de tik het echte element bereikt. */
function rechthoekenRaken(a, b, marge = 6){
  return !(a.right < b.left - marge || a.left > b.right + marge ||
           a.bottom < b.top - marge || a.top > b.bottom + marge);
}
function ontwijkHud(el){
  const hud = document.getElementById('obHud');
  if (!hud) return;
  hud.classList.remove('ob-hud-wijk');
  if (!el) return;
  const sluit = document.getElementById('obSluit');
  if (!sluit) return;
  const dr = el.getBoundingClientRect();
  if (dr.width === 0 || dr.height === 0) return;
  const kr = sluit.getBoundingClientRect();
  if (rechthoekenRaken(dr, kr)) hud.classList.add('ob-hud-wijk');
}

function plaatsBubbel(el){
  const b = document.getElementById('obBubbel');
  if (st._versleept) return;   // gebruiker heeft de bubbel zelf verplaatst: laat staan
  if (!el){
    // geen doel: gecentreerd tonen, inline positie wissen zodat CSS .midden werkt
    b.style.left = ''; b.style.top = '';
    b.classList.add('midden');
    return;
  }
  b.classList.remove('midden');
  b.style.left = ''; b.style.top = ''; // wis eerst, zodat offsetWidth de echte (max 330px) breedte meet
  const r = el.getBoundingClientRect();
  if (r.width === 0 || r.height === 0){ b.classList.add('midden'); return; } // ontaard doel: centreer
  void b.offsetWidth; // forceer reflow ná het wissen van .midden + inline stijlen
  const bw = b.offsetWidth, bh = b.offsetHeight, vw = innerWidth, vh = innerHeight, m = 12;
  // horizontaal centreren op doel, maar altijd binnen [m, vw - bw - m] houden.
  const maxLeft = Math.max(m, vw - bw - m);
  const left = Math.min(Math.max(m, r.left + r.width/2 - bw/2), maxLeft);
  // verticaal: onder het doel als het past, anders erboven, anders in de grootste
  // vrije zone geklemd binnen [m, vh - bh - m] — nooit half buiten beeld.
  const onder = r.bottom + 14, boven = r.top - bh - 14;
  const maxTop = Math.max(m, vh - bh - m);
  let top;
  if (onder + bh < vh - m) top = onder;              // past onder het doel
  else if (boven >= m)     top = boven;               // past boven het doel
  else {                                              // past nergens netjes: kies grootste ruimte
    const ruimteOnder = vh - r.bottom, ruimteBoven = r.top;
    top = ruimteOnder >= ruimteBoven ? r.bottom + 14 : r.top - bh - 14;
  }
  top = Math.min(Math.max(m, top), maxTop);
  b.style.left = left + 'px'; b.style.top = top + 'px';
}

/* Maak de uitleg-bubbel versleepbaar (touch + muis). Zo kan de coach het
   venster opzij schuiven om achter de popup te kijken — en komt het nooit
   in de weg te zitten van een knop die hij moet indrukken (bv. de ✕ van de
   teaminstellingen). Slepen begint alleen op de kop, niet op de knoppen. */
const _sleep = { bezig:false, dx:0, dy:0 };
function maakSleepbaar(b){
  const greep = b.querySelector('#obSleepGreep');
  if (!greep) return;

  const start = e => {
    if (e.target.closest('button')) return;   // knop-tik is geen sleep
    const p = e.touches ? e.touches[0] : e;
    const r = b.getBoundingClientRect();
    b.classList.remove('midden');             // van .midden/transform naar harde pixels
    b.style.left = r.left + 'px';
    b.style.top  = r.top  + 'px';
    _sleep.dx = p.clientX - r.left;
    _sleep.dy = p.clientY - r.top;
    _sleep.bezig = true;
    b.classList.add('sleept');
    if (e.cancelable) e.preventDefault();
  };
  greep.addEventListener('mousedown', start);
  greep.addEventListener('touchstart', start, { passive:false });

  // De document-brede beweeg/stop-handlers hoeven maar één keer te bestaan; ze
  // werken op de vaste bubbel-node en gedeelde _sleep-state, dus we koppelen ze
  // niet opnieuw bij elke stap.
  if (!b._sleepDocGekoppeld){
    b._sleepDocGekoppeld = true;
    const beweeg = e => {
      if (!_sleep.bezig) return;
      const p = e.touches ? e.touches[0] : e;
      const bw = b.offsetWidth, bh = b.offsetHeight, m = 6;
      let left = p.clientX - _sleep.dx, top = p.clientY - _sleep.dy;
      left = Math.min(Math.max(m, left), Math.max(m, innerWidth  - bw - m));
      top  = Math.min(Math.max(m, top),  Math.max(m, innerHeight - bh - m));
      b.style.left = left + 'px';
      b.style.top  = top  + 'px';
      st._versleept = true;   // vanaf nu niet meer automatisch herpositioneren
      if (e.cancelable) e.preventDefault();
    };
    const stop = () => { _sleep.bezig = false; b.classList.remove('sleept'); };
    document.addEventListener('mousemove', beweeg);
    document.addEventListener('touchmove', beweeg, { passive:false });
    document.addEventListener('mouseup', stop);
    document.addEventListener('touchend', stop);
  }
}

function zichtbareStappen(){
  const rs = rolSet(st.rol);
  return ONBOARDING_STAPPEN.filter(s => {
    if (!s.rollen.some(r => rs.has(r))) return false;
    // Module-adaptief: stappen die aan een uitgeschakelde teammodule hangen,
    // laten we helemaal weg. Zo krijgt een team zonder evaluaties/leerlijn/kompas
    // ook geen uitleg over knoppen die het niet ziet.
    if (s.modKey && !modAan(s.modKey)) return false;
    // Onderwerp-adaptief: als de tour vanuit de hulpchat op één hoofdstuk is
    // gestart (bv. alleen "opstelling"), toon dan uitsluitend dat hoofdstuk.
    if (st.hfdFilter && s.hfd !== st.hfdFilter) return false;
    return true;
  });
}

async function toonStap(){
  const stap = st.stappen[st.i];
  if (!stap){ voltooien(); return; }
  if (st.stopWacht){ st.stopWacht(); st.stopWacht = null; }
  const beurt = ++st.beurt;   // alles wat hierna async terugkomt voor een OUDE beurt wordt genegeerd

  if (stap.voor){ try { await stap.voor(); } catch(e){ console.warn('[ob] voor() faalde', e); } }
  if (beurt !== st.beurt || !st.actief) return;

  /* Doel opzoeken met een tweetrapswachttijd:
     1) kort (500ms) — dekt de normale render na een tab-wissel;
     2) bestaat het doel dan nog niet én zegt optioneelAls() dat overslaan mag
        (geen wedstrijden/spelers, module uit), sla dan METEEN over — zo blijft
        een leeg account vlot;
     3) hoort het doel er wél te zijn, wacht dan geduldig langer (3s extra) —
        trage lijsten/listeners sloegen vroeger stappen onterecht over. */
  let el = null;
  const wilDoel = !stap.midden && !!stap.doel;
  if (wilDoel){
    el = await wachtOpElement(() => stap.doel?.() || null, 500, true);
    if (beurt !== st.beurt || !st.actief) return;
    const bestaat = !!(stap.doel?.() || null);
    if (!bestaat){
      if (stap.optioneelAls?.()){
        const richting = st._richting || 1;
        st.i += richting;
        if (st.i < 0) st.i = 0;
        if (st.i >= st.stappen.length){ voltooien(); return; } // vangnet tegen eindeloze recursie
        return toonStap();
      }
      el = await wachtOpElement(() => stap.doel?.() || null, 3000, true);
      if (beurt !== st.beurt || !st.actief) return;
    }
  }

  /* Doel buiten beeld? Eerst netjes centreren in de viewport, dán meten. */
  await zorgInBeeld(el);
  if (beurt !== st.beurt || !st.actief) return;

  plaatsSpotlight(el);
  ontwijkHud(el);
  const b = document.getElementById('obBubbel');
  const totaal = st.stappen.length;
  const heeftOpdr = !!stap.wacht;
  b.innerHTML = `
    <div class="ob-b-label"><span class="ob-b-label-dot"></span>Uitleg</div>
    <div class="ob-b-kop" id="obSleepGreep" title="Versleep om het venster te verplaatsen">
      <span class="ob-b-emoji">${stap.emoji||'<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><circle cx="12" cy="12" r="3.2"/><path d="M12 4v2M12 18v2M4 12h2M18 12h2M6.3 6.3l1.5 1.5M16.2 16.2l1.5 1.5M17.7 6.3l-1.5 1.5M7.8 16.2l-1.5 1.5"/></svg>'}</span>
      <span class="ob-b-titel">${esc(stap.titel)}</span>
      <span class="ob-b-stap">${st.i+1}/${totaal}</span>
      <span class="ob-b-greep" aria-hidden="true">⠿</span>
    </div>
    <div class="ob-b-tekst">${stap.tekst}</div>
    ${stap.opdracht ? `<div class="ob-b-opdr"><span class="ob-pijltje">➜</span>${esc(stap.opdracht)}</div>` : ''}
    ${stap.wist ? `<div class="ob-b-wist"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><circle cx="12" cy="12" r="3.2"/><path d="M12 4v2M12 18v2M4 12h2M18 12h2M6.3 6.3l1.5 1.5M16.2 16.2l1.5 1.5M17.7 6.3l-1.5 1.5M7.8 16.2l-1.5 1.5"/></svg> <b>Wist je dat?</b> ${stap.wist}</div>` : ''}
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
  st._versleept = false;               // nieuwe stap: bubbel weer automatisch plaatsen
  plaatsBubbel(el);
  maakSleepbaar(b);
  requestAnimationFrame(() => b.classList.add('aan'));

  document.getElementById('obVul').style.width = ((st.i)/totaal*100) + '%';
  document.getElementById('obBadge').textContent = `${st.i+1}/${totaal}`;

  document.getElementById('obVorig').onclick = () => gaNaar(st.i - 1);
  document.getElementById('obOversla').onclick = () => gaNaar(st.i + 1);
  const vBtn = document.getElementById('obVolgend');
  if (heeftOpdr){
    vBtn.disabled = true; // pas actief na échte actie
    st.stopWacht = stap.wacht(() => {
      if (beurt !== st.beurt || !st.actief) return;   // actie kwam binnen voor een oude stap
      vBtn.classList.remove('wacht'); vBtn.disabled = false;
      vBtn.innerHTML = (st.i===totaal-1 ? 'Afronden ✓' : 'Gelukt! Volgende ›');
      st.klaarGezet.add(st.i);
      // korte bevestiging + auto-door na een tik
      meld('✓ Gelukt!');
      vBtn.onclick = () => gaNaar(st.i + 1);
      // herpositioneer zodra het (mogelijk nieuwe) doel echt gelayout is —
      // maar alleen als we intussen niet al naar een volgende stap zijn gegaan
      wachtOpElement(() => stap.doel?.() || null, 1200).then(async e2 => {
        if (beurt !== st.beurt || !st.actief) return;
        await zorgInBeeld(e2);
        if (beurt !== st.beurt || !st.actief) return;
        plaatsSpotlight(e2||null); ontwijkHud(e2||null);
        if (!st._versleept) plaatsBubbel(e2||null);
      });
    });
    vBtn.onclick = () => { if (!vBtn.disabled) gaNaar(st.i + 1); };
  } else {
    vBtn.onclick = () => gaNaar(st.i + 1);
  }
}

function gaNaar(n){
  const b = document.getElementById('obBubbel');
  b.classList.remove('aan');
  st.beurt++;                                          // vorige stap direct ongeldig
  if (st.stopWacht){ st.stopWacht(); st.stopWacht = null; }
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
    <p>In een paar minuten leer je de hele app kennen als coach, en je doet alles meteen zelf. Elk uitlegvenster kun je <b>verslepen</b> om achter het scherm te kijken.</p>
    <button class="ob-intro-start" id="obStart">Start de rondleiding</button>
    <button class="ob-intro-skip" id="obSkip">Overslaan, ik red me wel</button>`;
  document.body.appendChild(intro);
  requestAnimationFrame(() => intro.classList.add('aan'));
  /* Hardware-terug op het introscherm = "later": weg zonder te onthouden dat de rondleiding is overgeslagen. */
  terugLaag('ob-intro', { z:4006, open: () => intro.isConnected && intro.classList.contains('aan'),
    sluit: () => { intro.classList.remove('aan'); setTimeout(() => intro.remove(), 400); } });

  document.getElementById('obStart').onclick = () => {
    intro.classList.remove('aan');
    setTimeout(() => intro.remove(), 400);
    beginTour('coach', 0);
  };
  document.getElementById('obSkip').onclick = () => {
    intro.classList.remove('aan'); setTimeout(() => intro.remove(), 400);
    voortgangSchrijf({ overgeslagen:true, gestart:true });
  };
}

function beginTour(rol, startIndex, hfdFilter){
  st.rol = rol;
  st.hfdFilter = hfdFilter || null;
  st.stappen = zichtbareStappen();
  st.i = Math.max(0, Math.min(startIndex||0, st.stappen.length-1));
  st.actief = true;
  document.getElementById('obHud').style.display = 'flex';
  // Bij een deel-rondleiding (één hoofdstuk vanuit de hulpchat) laten we de
  // opgeslagen voortgang van de volledige tour ongemoeid.
  if (!st.hfdFilter) voortgangSchrijf({ rol, laatsteIndex:st.i, gestart:true });
  toonStap();
}

function stopTour(voltooid){
  st.actief = false;
  st.beurt++;              // lopende async-callbacks van de laatste stap doodleggen
  st._versleept = false;
  if (st.stopWacht){ st.stopWacht(); st.stopWacht = null; }
  ['obOverlay','obRing','obBubbel','obHud'].forEach(id => {
    const e = document.getElementById(id); if (e){ e.classList?.remove('aan'); e.style.display = 'none'; }
  });
  document.getElementById('obOverlay')?.classList.remove('aan');
  if (!voltooid && !st.hfdFilter){
    // Coach stopt tussendoor: de rondleiding niet meer automatisch aanbieden
    // bij een volgende keer inloggen. Hij blijft altijd zelf te starten via
    // Meer → Handleiding (knop "Rondleiding opnieuw").
    voortgangSchrijf({ rol:st.rol, overgeslagen:true, gestart:true, laatsteIndex:st.i });
    meld('Rondleiding gestopt: opnieuw starten kan via Meer → Handleiding');
  }
  st.hfdFilter = null;
}

/* ---------- Afronden + confetti + badges ---------- */
function voltooien(){
  // Deel-rondleiding (één hoofdstuk): geen badges/confetti, geen overschrijven
  // van de voortgang van de volledige tour. Gewoon netjes afsluiten.
  if (st.hfdFilter){
    stopTour(true);
    meld('Klaar! Je kunt de hele rondleiding altijd starten via Meer → Handleiding');
    return;
  }
  voortgangSchrijf({ rol:st.rol, voltooid:true, gestart:true, laatsteIndex:st.stappen.length });
  stopTour(true);
  const scherm = document.createElement('div');
  scherm.className = 'ob-klaar'; scherm.id = 'obKlaar';
  const behaalde = [...new Set(st.stappen.map(s => s.hfd))];
  const badgeEmoji = { welkom:'<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><circle cx="9" cy="7.6" r="2.9"/><path d="M3.4 19a5.6 5.6 0 0 1 11.2 0"/><rect x="16" y="8.6" width="5" height="6.6" rx="1.6"/><path d="M17.6 11.4h1.8"/></svg>', team:'<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><rect x="3.2" y="4.6" width="17.6" height="14.8" rx="2.4"/><path d="M12 4.6v14.8"/><circle cx="12" cy="12" r="2.8"/></svg>', wedstrijden:'<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><rect x="5" y="4.5" width="14" height="16" rx="2.2"/><path d="M9 3.2h6v3H9z"/><path d="M8.8 11.4h6.4"/><path d="M8.8 15.4h4"/></svg>', spelers:'<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><circle cx="9" cy="8" r="2.8"/><path d="M3.5 19a5.5 5.5 0 0 1 11 0"/><circle cx="17" cy="8.5" r="2.3"/><path d="M15.5 13.4A4.8 4.8 0 0 1 20.5 18"/></svg>',
    training:'<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M6.6 3.4h7L18.6 8.4v12.2h-12z"/><path d="M13.6 3.4V8.4h5"/></svg>', video:'<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><rect x="3" y="6" width="13" height="12" rx="2.2"/><path d="M16 10l5-3v10l-5-3z"/></svg>', meer:'<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><circle cx="5.6" cy="12" r="1.6" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.6" fill="currentColor" stroke="none"/><circle cx="18.4" cy="12" r="1.6" fill="currentColor" stroke="none"/></svg>', planning:'<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><rect x="3.5" y="5" width="17" height="15" rx="2.5"/><path d="M3.5 9.5h17M8 3v4M16 3v4"/><circle cx="12" cy="14.5" r="1.4" fill="currentColor" stroke="none"/></svg>', documenten:'<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><rect x="3.4" y="4.6" width="17.2" height="4.4" rx="1.8"/><path d="M5.2 9v10.4h13.6V9"/><path d="M10 13h4"/></svg>',
    stats:'<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M4 19V10"/><path d="M11 19V5"/><path d="M18 19v-7"/></svg>', instellingen:'<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><circle cx="12" cy="12" r="3.1"/><path d="M12 3.2 13.6 5.4l2.6-.6 1 2.5 2.6.7-.5 2.6L21 12l-1.7 1.4.5 2.6-2.6.7-1 2.5-2.6-.6L12 20.8l-1.6-2.2-2.6.6-1-2.5-2.6-.7.5-2.6L3 12l1.7-1.4-.5-2.6 2.6-.7 1-2.5 2.6.6z"/></svg>', help:'<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M4.4 5.6a2.2 2.2 0 0 1 2.2-2.2h13v17.2H6.6a2.2 2.2 0 0 0-2.2 2.2z"/><path d="M8.4 8.4h7"/><path d="M8.4 12h4.6"/></svg>', clubbeheer:'<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M12 3 20 6.5V11c0 4.5-3.1 8.7-8 10-4.9-1.3-8-5.5-8-10V6.5z"/><circle cx="12" cy="10.4" r="2.1"/><path d="M8.8 16.2a3.6 3.6 0 0 1 6.4 0"/></svg>' };
  const top = behaalde.slice(0, 6);
  scherm.innerHTML = `
    <div class="ob-klaar-emoji"></div>
    <h1>Je bent er klaar voor!</h1>
    <p>Je hebt alle belangrijke schermen van Cluppie nu zelf gebruikt. Vanaf hier ben je zelfstandig, en je kunt alles nog eens nalezen in de handleiding.</p>
    <div class="ob-badges">
      ${top.map(h => `<div class="ob-badge">
        <div class="ob-badge-cirkel">${badgeEmoji[h]||'<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M12 4.2 14.5 9.4l5.5.8-4 4 1 5.6L12 17.2l-5 2.6 1-5.6-4-4 5.5-.8z"/></svg>'}</div>
        <div class="ob-badge-naam">${esc((st.stappen.find(s=>s.hfd===h)||{}).hfdNaam || h)}</div>
      </div>`).join('')}
    </div>
    <button class="ob-intro-start" id="obKlaarOk">Aan de slag <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><rect x="3.2" y="4.6" width="17.6" height="14.8" rx="2.4"/><path d="M12 4.6v14.8"/><circle cx="12" cy="12" r="2.8"/></svg></button>`;
  document.body.appendChild(scherm);
  requestAnimationFrame(() => scherm.classList.add('aan'));
  terugLaag('ob-klaar', { z:4008, open: () => scherm.isConnected && scherm.classList.contains('aan'),
    sluit: () => document.getElementById('obKlaarOk')?.click() });
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
  { v:/uitnodig|code|coach toevoeg/i, a:'Ga naar <b><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><circle cx="12" cy="12" r="3.1"/><path d="M12 3.2 13.6 5.4l2.6-.6 1 2.5 2.6.7-.5 2.6L21 12l-1.7 1.4.5 2.6-2.6.7-1 2.5-2.6-.6L12 20.8l-1.6-2.2-2.6.6-1-2.5-2.6-.7.5-2.6L3 12l1.7-1.4-.5-2.6 2.6-.7 1-2.5 2.6.6z"/></svg> Teaminstellingen</b>. Daar vind je de teamcode en een uitnodigingslink die je via WhatsApp kunt delen.' },
  { v:/training|pdf|oefen/i, a:'Onder de tab <b>Training</b> staan de PDF-oefeningen; een rood stipje betekent iets nieuws. Video-oefeningen staan onder <b>Video</b>.' },
  { v:/beoordel|profiel|leerpunt/i, a:'Tik onder <b>Spelers</b> op een naam om het profiel te openen. Daar leg je korte beoordelingen (TE·TA·FY·ME·GE) en leerpunten vast.' },
  { v:/planning|kalender|voetbal\.?nl/i, a:'De <b>Planning</b> (via Meer) toont de seizoenskalender. Competitiewedstrijden komen automatisch uit voetbal.nl; eigen dagen voeg je met “+ Eigen dag” toe.' },
  { v:/verder|kwijt|vast|hoe nu/i, a:'Geen zorgen: tik op <b>Volgende</b> in de bubbel, of op <b>Overslaan</b>. Je kunt de rondleiding later hervatten via Meer → Handleiding.' },
];
function coachAntwoord(vraag){
  const hit = COACH_FAQ.find(f => f.v.test(vraag));
  return hit ? hit.a : 'Goede vraag! Kijk gerust rond: en in de <b>Handleiding</b> (Meer-menu) staat alles stap voor stap. Zal ik verdergaan met de rondleiding?';
}
function openCoach(){
  let achter = document.getElementById('obCoachAchter');
  if (!achter){
    achter = document.createElement('div');
    achter.className = 'ob-coach-achter'; achter.id = 'obCoachAchter';
    achter.innerHTML = `
      <div class="ob-coach">
        <div class="ob-coach-kop">
          <div class="ob-coach-avatar"></div>
          <div><div class="ob-coach-naam">Coach Cluppie</div>
            <div class="ob-coach-sub">Vraag me alles over de app</div></div>
          <button class="ob-coach-x" id="obCoachX">✕</button>
        </div>
        <div class="ob-coach-lijf" id="obCoachLijf">
          <div class="ob-msg bot">Hoi! Ik help je op weg. Waar loop je tegenaan?</div>
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
  terugLaag('ob-coach', { z:4010, open: () => achter.classList.contains('open'), sluit: sluitCoach });
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

/* Bestaat er een hoofdstuk met dit id in de rondleiding? (voor de hulpchat) */
export function heeftOnboardingHoofdstuk(hfd){
  return ONBOARDING_STAPPEN.some(s => s.hfd === hfd);
}

/* Start meteen een MINI-rondleiding van één hoofdstuk (bv. alleen "opstelling"),
   zonder introscherm, badges of confetti. Wordt aangeroepen vanuit de hulpchat
   wanneer een antwoord naar een specifiek onderdeel verwijst. */
export function startOnboardingHoofdstuk(hfd){
  if (!heeftOnboardingHoofdstuk(hfd)) return startOnboarding(true);
  if (st.actief) stopTour(true);
  bouwLagen();                 // HUD/overlay-lagen bestaan niet zonder introscherm
  beginTour('coach', 0, hfd);
}

/* HTML-blokje voor onderaan de Handleiding of Instellingen. */
export function onboardingHerstartBlok(){
  return `<div class="ob-herstart-blok" id="obHerstartBlok">
    <span class="ob-hb-emoji"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><circle cx="12" cy="12" r="9"/><path d="M9.3 9.3a2.7 2.7 0 0 1 5.2 1c0 1.8-2.5 2.2-2.5 4"/><circle cx="12" cy="17.2" r="0.6" fill="currentColor" stroke="none"/></svg></span>
    <div class="ob-hb-txt"><b>Rondleiding opnieuw</b>
      <span>Loop stap voor stap door de app, je doet alles zelf.</span></div>
    <button class="ob-knop prim mini" id="obHerstartKnop">Start</button>
  </div>`;
}
export function koppelOnboardingHerstart(root = document){
  const k = root.querySelector?.('#obHerstartKnop') || document.getElementById('obHerstartKnop');
  if (k) k.onclick = () => startOnboarding(true);
}
