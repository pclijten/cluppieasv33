/* ==================== STATE & HELPERS ==================== */
import { onSnapshot } from './firebase.js?v=20260811a';

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
  const wasOpen = $('#modalAchter').classList.contains('open');
  $('#modalAchter').classList.remove('open');
  // Inhoud leegmaken zodat een eventueel <video>/<audio>-element wordt
  // verwijderd en het geluid direct stopt — ook bij klik op de achtergrond of
  // de terugknop (voorheen speelde het geluid door tot de volgende openModal).
  const inhoud = $('#modalInhoud');
  if (inhoud){
    inhoud.querySelectorAll('video, audio').forEach(m => { try { m.pause(); } catch {} });
    inhoud.innerHTML = '';
  }
  vangnetStilTerugAlsNodig(wasOpen);
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
   Doel: de hardware-terugknop van de telefoon sluit niet meteen de hele app,
   maar gaat één stap terug binnen de app.

   Model (robuust en simpel): zodra de app "ergens binnen" zit (niet op het
   teamsoverzicht én geen modal open), houden we precies één extra
   history-entry vast — een "vangnet". Drukt de gebruiker op terug, dan vangt
   onze popstate-listener dat op en voert hij één terug-stap uit volgens de
   prioriteit hieronder. Daarna zetten we het vangnet opnieuw als er nóg iets
   terug te gaan valt. Zo hoeven openModal/sluitModal en de losse views zich
   nergens om history te bekommeren — alles loopt via bewaakTerug(). */

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

/* Zit de app op dit moment "ergens binnen", d.w.z. valt er iets terug te gaan? */
function kanTerug(){
  if (!S.user) return false;
  if (tactiekbordOpen()) return true;
  if (leerpleinOpen()) return true;
  if (lightboxOpen()) return true;
  if (pdfViewerOpen()) return true;
  if (modalOpen()) return true;
  const view = actieveView();
  if (view !== 'teams') return true;          // team / wedstrijd / club
  return false;                                // op het hoofdscherm
}

let _vangnetActief = false;   // ligt het vangnet op de history-stack?
let _afsluitGewapend = false; // eerste terugtik op hoofdscherm gehad?
let _stilTerug = false;       // history.back() zonder navigatiestap (modal-knop)
let _terugBezig = false;      // voorkomt herentry tijdens afhandeling

/* Herbruikbare 'stille terug' voor overlays die net als de modal het vangnet
   mogen verbruiken zonder een zichtbare navigatiestap te veroorzaken.
   wasOpen = stond de overlay nog open vlak vóór het sluiten?
   Bij sluiten via de eigen kruisknop (niet via de terugknop): als er nu géén
   dieper niveau meer is dat het vangnet rechtvaardigt, halen we het vangnet
   weg zodat de eerstvolgende terugtik niet een extra niveau "opeet".
   Bij sluiten via de terugknop is het vangnet al verbruikt en is dit een
   no-op (_terugBezig voorkomt dubbel werk). */
export function vangnetStilTerugAlsNodig(wasOpen){
  if (wasOpen && _vangnetActief && !_terugBezig){
    _stilTerug = true;
    history.back();
  }
}

/* Zorg dat het vangnet de juiste status heeft voor de huidige UI-stand.
   Aanroepen na elke navigatie/render/modalwissel. */
export function bewaakTerug(){
  if (!S.user) return;
  if (kanTerug() && !_vangnetActief){
    _vangnetActief = true;
    history.pushState({ cluppie:true, vangnet:true }, '');
  }
  /* Als er niets meer terug te gaan valt laten we het vangnet liggen tot de
     gebruiker daadwerkelijk terug drukt; opruimen hoeft niet en voorkomt
     races met gelijktijdige navigatie. */
}

/* Circulair-veilig navpad loggen vanuit state.js (tracker importeert state.js,
   dus geen top-level import terug — zelfde patroon als pdf-viewer hierboven). */
function _navTerug(scherm){
  import('./tracker.js?v=20260902d').then(m => m.telNav?.(scherm, 'terug')).catch(()=>{});
}

/* Eén terug-stap volgens prioriteit. true = afgehandeld (app blijft open). */
function stapTerug(){
  if (tactiekbordOpen()){
    import('./tactiekbord.js?v=20260902d').then(m => m.sluitTactiekbord());
    return true;
  }
  if (leerpleinOpen()){
    import('./leerplein.js?v=20260902d').then(m => m.sluitLeerplein());
    return true;
  }
  if (lightboxOpen()){
    import('./training-weergave.js?v=20260902d').then(m => m.sluitLightbox());
    return true;
  }
  if (pdfViewerOpen()){
    import('./pdf-viewer.js?v=20260902d').then(m => m.sluitPdfViewer());
    return true;
  }
  if (modalOpen()){ sluitModal(); return true; }
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
  return false; // hoofdscherm: niets meer
}

/* Eén keer registreren (vanuit main.js). */
export function initTerugknop(){
  history.replaceState({ cluppie:true, basis:true }, '');
  window.addEventListener('popstate', () => {
    _vangnetActief = false;            // het vangnet is zojuist verbruikt
    /* Stille terughaal na modal-knop: geen navigatiestap, alleen vangnet
       opnieuw afstemmen op de huidige (ondiepere) stand. */
    if (_stilTerug){
      _stilTerug = false;
      bewaakTerug();
      return;
    }
    _terugBezig = true;
    const afgehandeld = stapTerug();
    _terugBezig = false;
    if (afgehandeld){
      _afsluitGewapend = false;
      bewaakTerug();                   // leg een nieuw vangnet als er nog dieper-zit
      return;
    }
    // Hoofdscherm. 1A: dubbeltik om af te sluiten.
    if (_afsluitGewapend){
      history.back();                  // tweede tik: verlaat de pagina echt
    } else {
      _afsluitGewapend = true;
      meld('Tik nog een keer op terug om af te sluiten');
      history.pushState({ cluppie:true, basis:true }, '');
      setTimeout(() => { _afsluitGewapend = false; }, 2000);
    }
  });
}

/* modal sluiten bij klik op de achtergrond — één keer registreren */
export function initModalSluiten(){
  $('#modalAchter').addEventListener('click', e => { if (e.target.id === 'modalAchter') sluitModal(); });
}
