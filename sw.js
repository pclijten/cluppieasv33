/* sw.js van cluppieasv33.nl na de verhuizing naar cluppie.io.
   De oude app had hier een service worker die de app offline bewaarde. Deze versie ruimt dat op:
   alle bewaarde bestanden weg, zichzelf uitschrijven, en open vensters opnieuw laden zodat ze de
   doorverwijspagina krijgen. Hij vangt geen verzoeken af. */
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil((async () => {
  try { for (const k of await caches.keys()) await caches.delete(k); } catch (x) {}
  try { await self.registration.unregister(); } catch (x) {}
  try { for (const c of await self.clients.matchAll({ type: 'window' })) c.navigate(c.url).catch(() => {}); } catch (x) {}
})()));
