// pwa.js — "Zet Cluppie op je beginscherm"-banner
//
// Toont op het homescreen een nette banner die de coach uitnodigt om de app
// als PWA te installeren. Gedrag:
//   • Android/Chrome/Edge: vangt het beforeinstallprompt-event op en biedt een
//     knop die het echte installatievenster van het toestel opent.
//   • iPhone/Safari: kan technisch geen installatieknop tonen, dus we geven
//     een korte instructie (Deel → Zet op beginscherm).
//   • Al geïnstalleerd (app draait standalone): geen banner.
//   • Weggeklikt: onthouden; pas na 30 dagen weer tonen.
//
// De banner wordt in #pwaBanner gerenderd, dat teams.js bij elke render plaatst.

const WEGKLIK_KEY = 'cluppiePwaWeggeklikt';     // timestamp (ms) van laatste wegklik
const WEGKLIK_DAGEN = 30;                       // pas na zoveel dagen weer tonen

let deferredPrompt = null;                      // bewaarde beforeinstallprompt-event

// Registreer de service worker (vereist om installeerbaar te zijn op Android/
// Chrome). Faalt dit, dan werkt de app gewoon door — alleen de Android-knop
// verschijnt dan niet.
if ('serviceWorker' in navigator){
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  });
}

// Onthoud het install-event zodra de browser het aanbiedt, zodat we het later
// (bij een knopklik) kunnen afvuren.
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredPrompt = e;
  tekenPwaBanner();           // banner kan nu een werkende knop tonen
});

// Zodra de app daadwerkelijk is geïnstalleerd: banner weghalen.
window.addEventListener('appinstalled', () => {
  deferredPrompt = null;
  const el = document.getElementById('pwaBanner');
  if (el) el.innerHTML = '';
});

// Draait de app al als geïnstalleerde PWA (vanaf het beginscherm)?
function draaitAlsApp(){
  const standalone = window.matchMedia &&
    window.matchMedia('(display-mode: standalone)').matches;
  const iosStandalone = window.navigator.standalone === true; // Safari/iOS
  return standalone || iosStandalone;
}

// Is dit een iPhone/iPad/iPod? (Safari ondersteunt geen install-knop.)
function isIOS(){
  const ua = window.navigator.userAgent || '';
  const iOSToestel = /iphone|ipad|ipod/i.test(ua);
  // iPadOS doet zich soms voor als Mac; herken via touch.
  const iPadOSAlsMac = /macintosh/i.test(ua) && 'ontouchend' in document;
  return iOSToestel || iPadOSAlsMac;
}

// Heeft de coach de banner recent weggeklikt?
function recentWeggeklikt(){
  try {
    const t = parseInt(localStorage.getItem(WEGKLIK_KEY) || '0', 10);
    if (!t) return false;
    const dagen = (Date.now() - t) / (1000 * 60 * 60 * 24);
    return dagen < WEGKLIK_DAGEN;
  } catch { return false; }
}

function markeerWeggeklikt(){
  try { localStorage.setItem(WEGKLIK_KEY, String(Date.now())); } catch {}
}

// Rendert (of verwijdert) de banner in #pwaBanner.
export function tekenPwaBanner(){
  const el = document.getElementById('pwaBanner');
  if (!el) return;

  // Niet tonen als de app al is geïnstalleerd of recent is weggeklikt.
  if (draaitAlsApp() || recentWeggeklikt()){ el.innerHTML = ''; return; }

  const ios = isIOS();

  // Op niet-iOS zonder install-event valt er (nog) niets te installeren:
  // dan tonen we niets, want een knop zou niet werken.
  if (!ios && !deferredPrompt){ el.innerHTML = ''; return; }

  const actie = ios
    ? `<div class="pwa-uitleg">Tik op <b>&#x2191;&#xFE0E; Deel</b> onderin je scherm en kies <b>'Zet op beginscherm'</b>.</div>`
    : `<button class="pwa-knop" id="pwaInstalleer">Toevoegen aan beginscherm</button>`;

  el.innerHTML = `
    <div class="pwa-banner">
      <div class="pwa-icoon">📲</div>
      <div class="pwa-tekst">
        <div class="pwa-titel">Zet Cluppie op je beginscherm</div>
        <div class="pwa-sub">Open de app voortaan met één tik, ook zonder browser.</div>
        ${actie}
      </div>
      <button class="pwa-sluit" id="pwaSluit" title="Niet nu" aria-label="Banner sluiten">✕</button>
    </div>`;

  const sluit = el.querySelector('#pwaSluit');
  if (sluit) sluit.onclick = () => { markeerWeggeklikt(); el.innerHTML = ''; };

  const knop = el.querySelector('#pwaInstalleer');
  if (knop) knop.onclick = async () => {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    try { await deferredPrompt.userChoice; } catch {}
    deferredPrompt = null;
    el.innerHTML = '';        // venster is getoond; banner mag weg
  };
}
