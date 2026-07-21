/* sw.js — Cluppie service worker
   ================================================================
   Doel: de app-schil (HTML/CSS/JS/iconen) offline beschikbaar maken,
   zodat Cluppie ook langs de lijn zonder bereik opstart. De wedstrijd-
   en teamdata zelf worden al offline afgehandeld door de Firestore-
   persistence in firebase.js — deze worker raakt die verzoeken niet aan.

   Strategie: NETWORK-FIRST.
   • Online → altijd vers van het net halen en een kopie in de cache
     leggen. Je ziet dus nooit een verouderde versie zolang er bereik is.
   • Offline → terugvallen op de laatst gecachte versie.
   Dit is bewust géén cache-first: dat gaf in het verleden hardnekkige
   problemen met verouderde bestanden na een deploy.

   Bij een nieuwe release: verhoog CACHE_VERSIE hieronder. De oude cache
   wordt dan bij activatie automatisch opgeruimd. skipWaiting() +
   clients.claim() zorgen dat de nieuwe worker direct het stuur overneemt,
   zonder dat de coach alle tabbladen hoeft te sluiten.
   ================================================================ */

const CACHE_VERSIE = 'cluppie-v20260721';

/* Minimale schil die we bij installatie alvast klaarzetten. De overige
   bestanden (JS-modules, iconen, fonts van gstatic) worden vanzelf
   gecachet zodra ze één keer online zijn opgevraagd — zo hoeft deze
   lijst niet in sync te blijven met elke ?v=-versiewijziging. */
const SCHIL = [
  './',
  'index.html',
  'manifest.webmanifest',
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE_VERSIE)
      .then(cache => cache.addAll(SCHIL))
      .catch(() => {})          // installatie mag nooit stranden op één bestand
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys.filter(k => k.startsWith('cluppie-') && k !== CACHE_VERSIE)
            .map(k => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

/* Bepaalt of een verzoek door deze worker gecachet mag worden.
   Alleen GET-verzoeken naar de eigen site of naar de Firebase-SDK op
   www.gstatic.com. Al het andere (Firestore-data, Auth, Cloud Functions,
   Open-Meteo, YouTube-thumbnails, …) laten we volledig met rust. */
function cachebaar(req){
  if (req.method !== 'GET') return false;
  const url = new URL(req.url);
  if (url.origin === self.location.origin) return true;
  if (url.hostname === 'www.gstatic.com' && url.pathname.startsWith('/firebasejs/')) return true;
  return false;
}

self.addEventListener('fetch', (e) => {
  if (!cachebaar(e.request)) return;   // niet afhandelen → browser doet z'n gewone werk

  e.respondWith(
    fetch(e.request)
      .then(antwoord => {
        // Alleen volwaardige antwoorden bewaren (geen fouten of opaque redirects)
        if (antwoord && antwoord.ok){
          const kopie = antwoord.clone();
          caches.open(CACHE_VERSIE).then(cache => cache.put(e.request, kopie)).catch(() => {});
        }
        return antwoord;
      })
      .catch(async () => {
        // Offline: pak de laatst bekende versie uit de cache.
        const uitCache = await caches.match(e.request, { ignoreSearch: false });
        if (uitCache) return uitCache;
        // Navigatie zonder cache-hit (bv. diepe link): val terug op de schil.
        if (e.request.mode === 'navigate'){
          const schil = await caches.match('index.html') || await caches.match('./');
          if (schil) return schil;
        }
        return new Response('Offline en niet in cache', { status: 503, statusText: 'Offline' });
      })
  );
});
