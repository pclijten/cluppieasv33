/* ══════════════════════════════════════════════════════════════════
   thema.js — licht/donker-thema, met clubdwang die de persoonlijke
   voorkeur overschrijft.

   Bronnen, in volgorde van dwang:
     1. clubdocument themaModus: 'donker' | 'licht' | 'coachKiest'
        - 'donker'/'licht'  → geforceerd, coach ziet geen keuze
        - 'coachKiest'      → coach kiest zelf (default als veld ontbreekt)
     2. persoonlijke voorkeur (localStorage 'cluppieThemaEigen'), alleen
        relevant bij 'coachKiest'
     3. systeemvoorkeur (prefers-color-scheme), als er nog niks gekozen is

   De index.html-gate zet vóór paint al een thema o.b.v. de gecachete
   stand in localStorage; dit module corrigeert zodra het echte
   clubdocument binnen is en onthoudt de nieuwe stand voor de volgende keer.
================================================================== */

const HTML = document.documentElement;
const K_DWANG = 'cluppieThemaDwang';   // gecachete clubdwang: 'donker'|'licht'|'' (leeg=coachKiest)
const K_EIGEN = 'cluppieThemaEigen';   // persoonlijke keuze: 'donker'|'licht'

/* huidige clubmodus, in het geheugen gehouden zodat de coach-toggle weet
   of hij zichtbaar mag zijn */
let clubModus = null;   // 'donker' | 'licht' | 'coachKiest' | null (nog onbekend)

function systeemThema(){
  return (window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches) ? 'licht' : 'donker';
}

/* het thema dat NU getoond moet worden, gegeven club + eigen voorkeur */
export function effectiefThema(){
  if (clubModus === 'donker' || clubModus === 'licht') return clubModus;   // dwang wint
  const eigen = localStorage.getItem(K_EIGEN);
  if (eigen === 'donker' || eigen === 'licht') return eigen;
  return systeemThema();
}

/* mag de coach zelf kiezen? (bepaalt of de toggle in instellingen verschijnt) */
export function coachMagKiezen(){
  return clubModus === 'coachKiest' || clubModus === null;
}

/* pas het thema toe op <html> + de PWA theme-color-metatag */
function pasToe(thema){
  HTML.setAttribute('data-thema', thema);
  const mc = document.querySelector('meta[name="theme-color"]');
  if (mc) mc.setAttribute('content', thema === 'licht' ? '#f4f6f8' : '#0e1116');
}

/* herbereken en toon; cache de stand voor de pre-paint gate van de volgende sessie */
export function pasThemaToe(){
  const t = effectiefThema();
  pasToe(t);
  // cache voor de anti-flash gate
  try {
    localStorage.setItem(K_DWANG,
      (clubModus === 'donker' || clubModus === 'licht') ? clubModus : '');
  } catch(e){}
  return t;
}

/* aangeroepen door de clublistener zodra het clubdocument (opnieuw) binnenkomt.
   themaModus kan ontbreken bij oude clubs → dan 'coachKiest' (coach kiest,
   default donker via systeem/voorkeur). */
export function zetClubModus(modus){
  clubModus = (modus === 'donker' || modus === 'licht' || modus === 'coachKiest')
    ? modus : 'coachKiest';
  pasThemaToe();
}

/* de coach kiest zelf (alleen effectief bij coachKiest); onthoudt en past toe */
export function kiesEigenThema(thema){
  if (thema !== 'donker' && thema !== 'licht') return;
  try { localStorage.setItem(K_EIGEN, thema); } catch(e){}
  pasThemaToe();
}

/* huidige eigen voorkeur (voor de toggle-stand); valt terug op systeem */
export function eigenVoorkeur(){
  const e = localStorage.getItem(K_EIGEN);
  return (e === 'donker' || e === 'licht') ? e : systeemThema();
}

/* ── Lettergrootte ──────────────────────────────────────────────────
   Puur persoonlijk (geen clubdwang), per toestel. Eén schaalfactor --fs
   op <html>; alle app-tekst hangt via calc(Npx * var(--fs)) hieraan.
   Toegestane standen: 0.9 (klein) · 1 (normaal) · 1.15 (groot).
   De pre-paint gate in index.html zet --fs al vóór paint; deze functies
   wijzigen en onthouden de keuze. */
const K_GROOTTE = 'cluppieLettergrootte';
const GROOTTES = ['0.9', '1', '1.15'];

/* huidige stand (voor de segmented control); default '1' */
export function huidigeLettergrootte(){
  const g = localStorage.getItem(K_GROOTTE);
  return GROOTTES.includes(g) ? g : '1';
}

/* zet en onthoud de lettergrootte; past direct toe op <html> */
export function zetLettergrootte(schaal){
  const s = String(schaal);
  if (!GROOTTES.includes(s)) return;
  try { localStorage.setItem(K_GROOTTE, s); } catch(e){}
  HTML.style.setProperty('--fs', s);
}

/* pas de opgeslagen lettergrootte toe (voor het geval de gate niet liep) */
export function pasLettergrootteToe(){
  HTML.style.setProperty('--fs', huidigeLettergrootte());
}

/* volg live systeemwissels zolang de coach nog niks koos en er geen dwang is */
if (window.matchMedia){
  const mq = window.matchMedia('(prefers-color-scheme: light)');
  const luister = () => {
    if (coachMagKiezen() && !localStorage.getItem(K_EIGEN)) pasThemaToe();
  };
  if (mq.addEventListener) mq.addEventListener('change', luister);
  else if (mq.addListener) mq.addListener(luister);
}
