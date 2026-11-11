/* ==================== STATE & HELPERS ==================== */
import { onSnapshot } from './firebase.js?v=20261106r';

/* Alleen deze accounts mogen clubs en teams aanmaken. Iedereen anders is een
   gewone coach die meedraait in teams waarvoor hij is uitgenodigd.
   Let op: dit verbergt alleen de knoppen — de echte afdwinging staat in de
   Firestore-beveiligingsregels (zie het stappenplan). */
export const BEHEERDERS = ['pclijten@gmail.com'];
export function isBeheerder(){
  const e = (S.user?.email || '').toLowerCase();
  return BEHEERDERS.map(x => x.toLowerCase()).includes(e);
}

export const S = {
  user:null, teams:[], team:null, teamId:null,
  spelers:[], wedstrijden:[],
  wedstrijd:null, wedstrijdId:null, kwart:'1',
  teamTab:'wedstrijden', _teamTabStack:[], geselecteerd:null,
  clubs:[], club:null, clubId:null, clubTab:'hub', clubTrainBouw:'onder', clubDocCategorie:'alle', clubDashSort:'desc', clubDashPeriode:'dag', clubDashModus:'overzicht', clubEvalModus:'teams', clubTeams:[], clubTrainingen:[], clubDocumenten:[],
  trainingen:[], trainingenGelezen:{}, videos:[], documenten:[], presentie:[], berichten:[],
  beoordelingen:[], _beoordeelProfiel:null, _profielTab:'overzicht',
  teamEvaluaties:[], statsSubTab:'spelers', huidigSeizoen:null, statsSeizoen:null,
  planning:[], _planningFilter:'alles', _planningDichteMaanden:null, _planningToonEerder:false,
  uitleningenUit:[], uitleningenIn:[], _leenProfiel:null,
  unsub:{}, klokInterval:null, saveTimer:null, lokaalTot:0,
};

export const $  = s => document.querySelector(s);
export const $$ = s => [...document.querySelectorAll(s)];
export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

export function meld(t){
  const m = $('#melding'); m.textContent = t; m.classList.add('zichtbaar');
  clearTimeout(meld._t); meld._t = setTimeout(()=>m.classList.remove('zichtbaar'), 2600);
}
export function mmss(sec){
  sec = Math.max(0, Math.round(sec));
  return String(Math.floor(sec/60)).padStart(2,'0') + ':' + String(sec%60).padStart(2,'0');
}
export function uurMin(sec){
  const m = Math.round(sec/60);
  return m >= 60 ? Math.floor(m/60)+'u'+String(m%60).padStart(2,'0') : m+' min';
}
export function datumNL(d){
  try { return new Date(d+'T12:00').toLocaleDateString('nl-NL',{weekday:'short',day:'numeric',month:'short'}); }
  catch { return d; }
}
export function nieuweCode(){
  const t = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return Array.from({length:6}, () => t[Math.floor(Math.random()*t.length)]).join('');
}
/* Leesbare teamcode op basis van de teamnaam, bijv. "JO11-1" → "ASVJO11-1".
   - clubAfkorting wordt vooraan geplakt (bijv. ASV) zodat codes clubbreed uniek zijn.
   - alles naar hoofdletters; alleen letters, cijfers en streepjes blijven over.
   - bestaandeCodes (array) voorkomt dubbele codes: bij botsing komt er -2, -3, ... achter. */
export function teamCode(teamnaam, clubAfkorting = '', bestaandeCodes = []){
  const opschonen = s => String(s||'')
    .toUpperCase()
    .replace(/[^A-Z0-9-]+/g, '')      // spaties en rare tekens eruit
    .replace(/-+/g, '-')               // dubbele streepjes samenvoegen
    .replace(/^-|-$/g, '');            // streepje aan begin/eind weg
  const pre = opschonen(clubAfkorting);
  let basis = (pre ? pre : '') + opschonen(teamnaam);
  if (!basis) basis = nieuweCode();
  const bestaand = new Set(bestaandeCodes.map(c => String(c).toUpperCase()));
  if (!bestaand.has(basis)) return basis;
  for (let i = 2; i < 100; i++){
    const kandidaat = basis + '-' + i;
    if (!bestaand.has(kandidaat)) return kandidaat;
  }
  return basis + '-' + nieuweCode();
}
export function speler(pid){ return S.spelers.find(p => p.id === pid); }
export function spelerNaam(pid){ const p = speler(pid); return p ? p.naam : '—'; }
export function spelerNr(pid){ const p = speler(pid); return p && p.nummer != null && p.nummer !== '' ? p.nummer : '·'; }
export function initialen(naam){ return String(naam||'?').trim().slice(0,1).toUpperCase() || '?'; }
/* Per-team modules aan/uit (admin regelt dit in het clubdashboard).
   Ontbreekt het veld of staat het niet expliciet op false, dan is de module AAN
   — zo merken bestaande teams niets en wist "uit" nooit data. Sleutels:
   'evaluaties' (Stats-tab + na-wedstrijd-evaluatie), 'leerlijn' (thema-koppeling
   + leerpunten), 'kompas' (wekelijkse ASV-kompas-tip op de Training-tab). */
export function modAan(sleutel, team = S.team){ return team?.modules?.[sleutel] !== false; }
/* korte afkorting uit een clubnaam.
   "ASV'33" → "ASV", "RKVV Mifano" → "RKVV", "SV Brandevoort" → "SV".
   Aanpak: pak het eerste woord; bestaat dat (vooral) uit hoofdletters, dan is
   dat al de clubafkorting. Anders initialen van de woorden. */
export function clubAfkorting(clubnaam){
  const ruw = String(clubnaam||'').trim();
  if (!ruw) return '';
  const woorden = ruw.split(/[\s'’.\-]+/).filter(Boolean);
  const eerste = (woorden[0]||'').replace(/[^A-Za-zÀ-ÿ0-9]/g,'');
  // eerste woord is een afkorting als het ≥2 letters heeft en grotendeels hoofdletters is
  const letters = eerste.replace(/[^A-Za-z]/g,'');
  const hoofdletters = eerste.replace(/[^A-Z]/g,'');
  if (letters.length >= 2 && hoofdletters.length >= letters.length - 1){
    return eerste.toUpperCase().slice(0,6);
  }
  // anders: initialen van alle woorden
  const af = woorden.map(w => {
    const h = w.replace(/[^A-Za-zÀ-ÿ0-9]/g,'');
    return h ? h[0].toUpperCase() : '';
  }).join('');
  return af.slice(0,6);
}

/* ---------- Modal ----------
   Twee vormen, gestuurd via opties.vorm:
   - 'scherm' (default): full-screen overlay met vaste kopbalk (titel + kruisje).
       De titel wordt uit de eerste <h2> van de html gehaald; die <h2> wordt
       dan uit de body verwijderd zodat hij niet dubbel verschijnt. Zo hoeven
       de ~61 bestaande aanroepen niet aangepast te worden.
   - 'dialoog': compacte, gecentreerde dialoog voor korte ja/nee-bevestigingen.
       Geen kopbalk/kruisje — de dialoog heeft z'n eigen knoppen. */
export function openModal(html, opties){
  const vorm = (opties && opties.vorm) || 'scherm';
  const achter = $('#modalAchter');
  const inhoud = $('#modalInhoud');
  achter.setAttribute('data-vorm', vorm);

  if (vorm === 'dialoog'){
    inhoud.innerHTML = html;
  } else {
    // titel uit eerste <h2> lichten voor de vaste kopbalk
    let titel = '';
    const body = html.replace(/<h2[^>]*>([\s\S]*?)<\/h2>/, (m, t) => { titel = t; return ''; });
    const kruis = '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M6.5 6.5l11 11"/><path d="M17.5 6.5l-11 11"/></svg>';
    inhoud.innerHTML =
      '<div class="modal-kop"><h2>' + titel + '</h2>' +
      '<button type="button" class="modal-sluit" id="modalSluitBtn" aria-label="Sluiten">' + kruis + '</button></div>' +
      '<div class="modal-body">' + body + '</div>';
    const btn = $('#modalSluitBtn');
    if (btn) btn.onclick = () => sluitModal();
  }
  achter.classList.add('open');
  bewaakTerug();
}
export function sluitModal(){
  $('#modalAchter').classList.remove('open');
  // Inhoud leegmaken zodat een eventueel <video>/<audio>-element wordt
  // verwijderd en het geluid direct stopt — ook bij klik op de achtergrond of
  // de terugknop (voorheen speelde het geluid door tot de volgende openModal).
  const inhoud = $('#modalInhoud');
  if (inhoud){
    inhoud.querySelectorAll('video, audio').forEach(m => { try { m.pause(); } catch {} });
    inhoud.innerHTML = '';
  }
}

/* ---------- Laatst bekeken positie (herstel na refresh) ----------
   Coaches (en hun kinderen) verversen langs de lijn regelmatig per ongeluk de
   pagina. Zonder dit landden ze dan altijd terug op de team-hub. We bewaren de
   huidige plek — team, tabblad en een eventueel geopende wedstrijd — in
   localStorage, zodat startTeams() (teams.js) daar bij het opstarten weer op
   kan landen i.p.v. op de hub. Bewust klein en tolerant: mislukt lezen/schrijven
   (privémodus, vol quota), dan valt de app gewoon terug op het oude gedrag. */
const LS_POSITIE = 'cluppie_laatste_positie';
export function bewaarPositie(){
  try {
    if (!S.teamId){ localStorage.removeItem(LS_POSITIE); return; }
    localStorage.setItem(LS_POSITIE, JSON.stringify({
      teamId: S.teamId,
      teamTab: S.teamTab || 'hub',
      wedstrijdId: S.wedstrijdId || null,
    }));
  } catch(e){}
}
export function leesPositie(){
  try { return JSON.parse(localStorage.getItem(LS_POSITIE) || 'null'); }
  catch(e){ return null; }
}
export function wisPositie(){
  try { localStorage.removeItem(LS_POSITIE); } catch(e){}
}

/* ---------- Navigatie ---------- */
export function toon(viewId){
  $$('.view').forEach(v => v.classList.remove('actief'));
  $('#view-'+viewId).classList.add('actief');
  window.scrollTo(0,0);
  bewaakTerug();
}
export function stopUnsubs(...keys){
  for (const k of keys){ if (S.unsub[k]){ S.unsub[k](); delete S.unsub[k]; } }
}

/* ---------- Realtime listeners met foutafhandeling ----------
   Standaardpatroon voor onSnapshot: bij een leesfout (rechten, netwerk,
   offline) verdween dit voorheen stilzwijgend — de gebruiker zag een leeg
   scherm zonder te weten waarom. listenMet() zorgt dat elke listener-fout
   altijd zichtbaar wordt gemeld én in de console terechtkomt.
   label: korte, leesbare naam voor de melding (bv. 'spelers', 'wedstrijden').
   onError: optionele extra afhandeling (bv. state opruimen). */
export function listenMet(ref, onData, label, onError){
  return onSnapshot(ref, onData, err => {
    console.error(`[Cluppie] Listener "${label}" faalde:`, err.code, err.message);
    const reden = err.code === 'permission-denied' ? 'geen toegang' : 'verbindingsprobleem';
    meld(`Kon ${label} niet laden (${reden}). Probeer het later opnieuw.`);
    if (onError) onError(err);
  });
}

/* ---------- Globale foutvang ----------
   Vangt onverwachte fouten op die nergens anders zijn afgehandeld (bugs,
   ontbrekende velden in oudere documenten, etc.), zodat de gebruiker een
   nette melding krijgt in plaats van een scherm dat stil vastloopt.
   Eenmalig aanroepen vanuit main.js bij opstart. */
export function initGlobaleFoutafhandeling(){
  window.addEventListener('error', e => {
    console.error('[Cluppie] Onverwachte fout:', e.error || e.message);
    meld('Er ging iets onverwachts mis. Herlaad de pagina als het scherm vastloopt.');
  });
  window.addEventListener('unhandledrejection', e => {
    console.error('[Cluppie] Onverwachte fout (promise):', e.reason);
    meld('Er ging iets onverwachts mis. Herlaad de pagina als het scherm vastloopt.');
  });
}

/* ==================== TERUGKNOP / GESCHIEDENIS ====================
   Doel: de hardware-terugknop van Android (en de veeg-terug) sluit niet
   meteen de hele app, maar gaat precies één stap terug binnen de app.

   Model: zodra een gebruiker is ingelogd én de pagina minstens één keer is
   aangeraakt, ligt er altijd één extra history-entry bovenop de basis: het
   "vangnet". Drukt de gebruiker op terug, dan vangt onze popstate-listener
   dat op en voert hij één terug-stap uit (zie stapTerug). Daarna leggen we
   het vangnet meteen opnieuw. Zo hoeft geen enkel scherm zich om history te
   bekommeren: een scherm hoeft alleen te zeggen hoe je er één stap uit gaat.

   Waarom ALTIJD een vangnet (ook op het hoofdscherm)? Zonder vangnet sluit de
   eerste terugtik op het hoofdscherm de app meteen, en de melding "Tik nog een
   keer op terug om af te sluiten" kwam nooit in beeld. Nu vangt het vangnet de
   eerste tik op; pas een tweede tik binnen 2 seconden sluit de app.

   Waarom pas na een aanraking? Chrome op Android slaat history-entries over
   die zonder gebruikersinteractie zijn toegevoegd ("history manipulation
   intervention"). Bij een herstart met automatisch geopend team zou het
   vangnet dus onzichtbaar zijn en sloot de app bij de eerste terugtik. Daarom
   leggen we het vangnet pas zodra de pagina is aangeraakt.

   Drie manieren om een scherm aan te sluiten:
   1. terugLaag(sleutel, {z, open, sluit}) voor overlays, sheets en panelen.
      De bovenste open laag (hoogste z, bij gelijke z de laatst geopende)
      wordt als eerste gesloten. Een laag die niet meer open is ruimt zichzelf
      op, dus vergeten uitschrijven is niet erg. z = het z-index uit styles.css.
   2. terugView(viewId, fn) voor een heel scherm met eigen niveaus. fn doet
      één stap omhoog en geeft true terug als dat gelukt is.
   3. doeTerug() voor een zichtbare terugknop in de UI. Gebruik dit i.p.v.
      history.back(): het werkt ook als het vangnet er (nog) niet ligt. */

function actieveView(){
  const v = document.querySelector('.view.actief');
  return v ? v.id.replace('view-','') : 'teams';
}
function modalOpen(){
  return !!document.querySelector('#modalAchter')?.classList.contains('open');
}
/* PDF-viewer (pdf-viewer.js) is een losse fullscreen-overlay bovenop alles
   (ook bovenop een open modal, zie z-index in styles.css) en checkt via de
   DOM i.p.v. een import, om een circulaire import met pdf-viewer.js te
   vermijden — zelfde patroon als modalOpen() hierboven. */
function pdfViewerOpen(){
  return !!document.querySelector('.pdfv-achter')?.classList.contains('open');
}
/* Diagram-lightbox (training-weergave.js) is net als de pdf-viewer een losse
   fullscreen-overlay bovenop alles; ook hier checken we via de DOM i.p.v. een
   import om een circulaire import te vermijden. */
function lightboxOpen(){
  return !!document.querySelector('.trw-lb')?.classList.contains('open');
}
/* Tactiekbord (tactiekbord.js) is een fullscreen-overlay bovenop alles — ook
   bovenop een wedstrijd-modal — en checkt via de DOM i.p.v. een import om een
   circulaire import te vermijden. Zelfde patroon als de pdf-viewer/lightbox. */
function tactiekbordOpen(){
  return !!document.querySelector('.tb-board');
}
/* Leerplein (leerplein.js) is een fullscreen-overlay onder het tactiekbord.
   Zelfde DOM-check-patroon om circulaire imports te vermijden. */
function leerpleinOpen(){
  return !!document.querySelector('.lp-scherm');
}

let _vangnetActief = false;   // ligt het vangnet op de history-stack?
let _afsluitGewapend = false; // eerste terugtik op hoofdscherm gehad?
let _terugBezig = false;      // voorkomt herentry tijdens afhandeling
let _terugWacht = false;      // doeTerug() wacht op de popstate van zijn history.back()

/* ---------- Lagen die state.js zelf kent (via DOM, i.v.m. circulaire imports) ---------- */
const STATISCHE_LAGEN = [
  { z:1200, open: tactiekbordOpen, sluit: () => { import('./tactiekbord.js?v=20261111g').then(m => m.sluitTactiekbord()); } },
  /* Leerplein heeft twee niveaus (themakeuze → voorbeeld): de ‹-knop weet welke stap hoort. */
  { z:1180, open: leerpleinOpen,   sluit: () => {
      const knop = document.querySelector('.lp-scherm #lpTerug');
      if (knop) knop.click(); else import('./leerplein.js?v=20261111g').then(m => m.sluitLeerplein());
  } },
  { z:65,   open: lightboxOpen,    sluit: () => { import('./training-weergave.js?v=20261111g').then(m => m.sluitLightbox()); } },
  { z:60,   open: pdfViewerOpen,   sluit: () => { import('./pdf-viewer.js?v=20261111g').then(m => m.sluitPdfViewer()); } },
  { z:50,   open: modalOpen,       sluit: () => sluitModal() },
];

/* ---------- Lagen die modules zelf aanmelden ---------- */
const _lagen = new Map();     // sleutel -> { z, open, sluit }  (oudste eerst)

/* Meld een overlay/sheet/paneel aan. Aanroepen op het moment van openen.
   Dezelfde sleutel nogmaals aanmelden vervangt de oude en zet hem bovenaan.
   vast:true = een overlay die één keer in de DOM wordt gezet en daarna alleen
   getoond/verborgen wordt: aanmelden bij het aanmaken volstaat, hij wordt dan
   niet opgeruimd als open() even false geeft. */
export function terugLaag(sleutel, { z = 50, open, sluit, vast = false }){
  _lagen.delete(sleutel);
  _lagen.set(sleutel, { sleutel, z, open, sluit, vast });
  bewaakTerug();
}
/* Optioneel afmelden bij sluiten; een laag waarvan open() false geeft wordt
   sowieso vanzelf opgeruimd. */
export function terugLaagWeg(sleutel){ _lagen.delete(sleutel); }

function bovensteLaag(){
  let beste = null;
  for (const [sleutel, l] of _lagen){
    let open = true;
    try { open = l.open ? !!l.open() : true; } catch(e){ open = false; }
    if (!open){ if (!l.vast) _lagen.delete(sleutel); continue; }
    if (!beste || l.z >= beste.z) beste = l;
  }
  for (const l of STATISCHE_LAGEN){
    let open = false;
    try { open = !!l.open(); } catch(e){}
    if (open && (!beste || l.z > beste.z)) beste = l;
  }
  return beste;
}

/* ---------- Schermen met eigen niveaus ---------- */
const _viewTerug = {};        // viewId -> () => boolean
export function terugView(viewId, fn){ _viewTerug[viewId] = fn; }

/* ---------- Het vangnet ---------- */
/* Chrome (Android) slaat history-entries over die zijn toegevoegd zonder dat
   de pagina ooit is aangeraakt. Browsers zonder userActivation-API: nemen we
   gewoon aan dat het goed is. */
function isAangeraakt(){
  try { const ua = navigator.userActivation; return !ua || ua.hasBeenActive; }
  catch(e){ return true; }
}
let _wachtOpAanraking = false;
function wachtOpAanraking(){
  if (_wachtOpAanraking) return;
  _wachtOpAanraking = true;
  const evs = ['pointerup', 'touchend', 'click', 'keydown'];
  const fn = () => {
    evs.forEach(e => window.removeEventListener(e, fn, true));
    _wachtOpAanraking = false;
    bewaakTerug();                 // legt het vangnet; of wacht opnieuw als dit nog niet telde
  };
  evs.forEach(e => window.addEventListener(e, fn, true));
}

/* Zorgt dat het vangnet er ligt. Aanroepen na elke navigatie/render/modalwissel
   (toon() en openModal() doen dat al). Goedkoop en veilig om vaker aan te roepen. */
export function bewaakTerug(){
  if (!S.user || _vangnetActief) return;
  if (!isAangeraakt()){ wachtOpAanraking(); return; }
  _vangnetActief = true;
  history.pushState({ cluppie:true, vangnet:true }, '');
}

/* Bleef in gebruik bij de overlays die dit al aanriepen. Het vangnet blijft nu
   altijd liggen, dus er valt niets meer weg te halen; de functie bestaat alleen
   nog zodat bestaande aanroepen blijven werken. */
export function vangnetStilTerugAlsNodig(/* wasOpen */){}

/* Circulair-veilig navpad loggen vanuit state.js (tracker importeert state.js,
   dus geen top-level import terug — zelfde patroon als pdf-viewer hierboven). */
function _navTerug(scherm){
  import('./tracker.js?v=20261111g').then(m => m.telNav?.(scherm, 'terug')).catch(()=>{});
}

/* Eén terug-stap volgens prioriteit. true = afgehandeld (app blijft open). */
function stapTerug(){
  /* 1. Bovenste overlay/sheet/modal. */
  const laag = bovensteLaag();
  if (laag){
    try { laag.sluit(); }
    catch(e){
      console.error('[Cluppie] Terug: laag sluiten mislukte', e);
      if (laag.sleutel) _lagen.delete(laag.sleutel);   // een kapotte laag mag de terugknop niet blokkeren
    }
    return true;
  }
  /* 2. [20261103] Trainingscoördinator-scherm (trainco.js) legt zijn eigen
     terug-stappen hier neer; zo hoeft state.js trainco.js niet te importeren. */
  if (S._traincoTerug) return S._traincoTerug.stap();
  /* 3. Een heel scherm, van binnen naar buiten. */
  const view = actieveView();
  if (view === 'team' && (S._beoordeelProfiel || S._leenProfiel)){
    S._beoordeelProfiel = null; S._leenProfiel = null; S._profielTab = 'overzicht';
    _navTerug('team:' + (S.teamTab || 'hub'));
    S._navRerender?.();
    return true;
  }
  if (view === 'wedstrijd'){ _navTerug('team:' + (S.teamTab || 'hub')); S._navTerugWedstrijd?.(); return true; }
  if (view === 'club'){
    /* Stap eerst één niveau omhoog binnen de club-hub (dash-scherm → inzicht →
       hub). Alleen vanaf de hub zelf verlaten we de club richting teams.
       _navClubTerug logt zijn eigen terug-stap. */
    if (S.clubTab && S.clubTab !== 'hub'){ S._navClubTerug?.(); return true; }
    _navTerug('teams'); S._navVerlaatClub?.(); return true;
  }
  if (view === 'team'){
    /* Eerst één tabblad terug binnen het team (bv. van Planning → Meer, of van
       Stats → het tabblad waar je vandaan kwam). Pas als er geen tab-historie
       meer is, verlaten we het team richting de teamkeuze. _navTeamTabTerug
       logt zijn eigen terug-stap; het team verlaten loggen we hier. */
    if (S._navTeamTabTerug?.()) return true;
    _navTerug('teams');
    S._navVerlaatTeam?.();
    return true;
  }
  /* 4. Schermen die zichzelf aanmelden (bouw-omgeving e.d.). */
  const vh = _viewTerug[view];
  if (vh){
    try { if (vh()) return true; }
    catch(e){ console.error('[Cluppie] Terug: scherm-stap mislukte', e); return true; }
  }
  return false; // hoofdscherm: niets meer
}

/* Voor zichtbare terugknoppen in de UI: doet hetzelfde als de hardware-knop,
   ook als het vangnet er (nog) niet ligt. Dubbeltikken wordt genegeerd. */
export function doeTerug(){
  if (_terugWacht) return;
  if (_vangnetActief){
    _terugWacht = true;
    setTimeout(() => { _terugWacht = false; }, 600);
    history.back();                    // popstate doet de eigenlijke stap
    return;
  }
  _terugBezig = true;
  let afgehandeld = false;
  try { afgehandeld = stapTerug(); } finally { _terugBezig = false; }
  if (afgehandeld){ _afsluitGewapend = false; bewaakTerug(); }
}

/* Eén keer registreren (vanuit main.js). */
export function initTerugknop(){
  history.replaceState({ cluppie:true, basis:true }, '');
  window.addEventListener('popstate', () => {
    _vangnetActief = false;            // het vangnet is zojuist verbruikt
    _terugWacht = false;
    if (!S.user) return;               // niet ingelogd: de browser doet zijn gewone ding
    _terugBezig = true;
    let afgehandeld = false;
    try { afgehandeld = stapTerug(); }
    catch(e){ console.error('[Cluppie] Terug-stap mislukte', e); afgehandeld = true; }
    _terugBezig = false;
    if (afgehandeld){
      _afsluitGewapend = false;
      bewaakTerug();                   // nieuw vangnet voor de volgende tik
      return;
    }
    /* Hoofdscherm: dubbeltik om af te sluiten. De eerste tik toont alleen een
       melding. We leggen het vangnet bewust NIET meteen terug: de tweede tik
       valt dan op de basis-entry en sluit de app zoals Android dat gewend is.
       Pas na 2 seconden (of zodra de coach ergens heen navigeert) ligt het
       vangnet er weer. */
    if (_afsluitGewapend) return;
    _afsluitGewapend = true;
    meld('Tik nog een keer op terug om af te sluiten');
    setTimeout(() => { _afsluitGewapend = false; bewaakTerug(); }, 2000);
  });
}

/* modal sluiten bij klik op de achtergrond — één keer registreren */
export function initModalSluiten(){
  $('#modalAchter').addEventListener('click', e => { if (e.target.id === 'modalAchter') sluitModal(); });
}
