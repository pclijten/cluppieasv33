/* ==================== STATE & HELPERS ==================== */
import { onSnapshot } from './firebase.js';

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
  teamTab:'wedstrijden', geselecteerd:null,
  clubs:[], club:null, clubId:null, clubTab:'teams', clubTrainBouw:'onder', clubDocCategorie:'alle', clubDashSort:'desc', clubDashPeriode:'dag', clubDashModus:'overzicht', clubEvalModus:'teams', clubTeams:[], clubTrainingen:[], clubDocumenten:[],
  trainingen:[], trainingenGelezen:{}, videos:[], documenten:[], presentie:[],
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

/* ---------- Modal ---------- */
export function openModal(html){
  $('#modalInhoud').innerHTML = '<div class="sluitbalk"></div>' + html;
  $('#modalAchter').classList.add('open');
  bewaakTerug();
}
export function sluitModal(){
  const wasOpen = $('#modalAchter').classList.contains('open');
  $('#modalAchter').classList.remove('open');
  vangnetStilTerugAlsNodig(wasOpen);
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

/* Zit de app op dit moment "ergens binnen", d.w.z. valt er iets terug te gaan? */
function kanTerug(){
  if (!S.user) return false;
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

/* Eén terug-stap volgens prioriteit. true = afgehandeld (app blijft open). */
function stapTerug(){
  if (pdfViewerOpen()){
    import('./pdf-viewer.js').then(m => m.sluitPdfViewer());
    return true;
  }
  if (modalOpen()){ sluitModal(); return true; }
  const view = actieveView();
  if (view === 'team' && (S._beoordeelProfiel || S._leenProfiel)){
    S._beoordeelProfiel = null; S._leenProfiel = null; S._profielTab = 'overzicht';
    S._navRerender?.();
    return true;
  }
  if (view === 'wedstrijd'){ S._navTerugWedstrijd?.(); return true; }
  if (view === 'club'){      S._navVerlaatClub?.();    return true; }
  if (view === 'team'){      S._navVerlaatTeam?.();    return true; }
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
