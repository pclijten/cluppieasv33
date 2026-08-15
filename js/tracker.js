/* ==================== FUNCTIEGEBRUIK-TRACKER ====================
   Telt hoe vaak coaches functies gebruiken, zuinig en AVG-proof.

   Filosofie (zelfde zuinigheid als de login-teller in auth.js):
   - Tellen gebeurt lokaal in het geheugen + sessionStorage — kosteloos, geen
     merkbare vertraging, ongeacht hoeveel verschillende functies er zijn.
   - Wegschrijven gebeurt GEBUNDELD: één document per gebruiker per dag
     (gebruik/{uid}_{datum}), met increment() per event-naam. Zo blijft het bij
     een handvol writes per dag i.p.v. één per tik — het schrijfvolume schaalt
     met gebruikers×dagen, niet met het aantal functies of tikken.
   - Er gaan NOOIT speler- of persoonsgegevens mee. Alleen event-naam + teller,
     plus uid/clubId/teamId zodat de admin per club kan aggregeren. De uid staat
     al in de login-collectie; dit voegt geen nieuwe categorie persoonsdata toe.

   Flush-momenten: bij het verbergen/sluiten van de app (visibilitychange →
   hidden, en pagehide) en als veiligheidsnet elke ~2 minuten. */

import { db, doc, setDoc, increment, serverTimestamp } from './firebase.js?v=20260811a';
import { S } from './state.js?v=20260815b';

const LS_BUFFER = 'cluppie_gebruik_buffer';   // {datum, tellingen:{ev:n}}
const FLUSH_INTERVAL_MS = 2 * 60 * 1000;

let flushTimer = null;
let luistertAl = false;

function vandaag(){ return new Date().toISOString().slice(0,10); }

/* buffer lezen; reset automatisch bij een nieuwe dag (dan hoort de oude buffer
   allang geflusht te zijn — maar mocht dat door een crash niet gelukt zijn, dan
   gaat er hooguit één dag telwerk verloren, nooit persoonsdata). */
function leesBuffer(){
  try {
    const ruw = sessionStorage.getItem(LS_BUFFER);
    if (ruw){
      const b = JSON.parse(ruw);
      if (b && b.datum === vandaag() && b.tellingen) return b;
    }
  } catch(e){}
  return { datum: vandaag(), tellingen: {} };
}
function schrijfBuffer(b){
  try { sessionStorage.setItem(LS_BUFFER, JSON.stringify(b)); } catch(e){}
}

/* Publieke API: registreer één gebruik van een functie. Nooit blokkerend,
   nooit een bron van fouten voor de aanroeper — bij twijfel gewoon stil falen. */
export function telGebruik(ev){
  if (!ev || !S.user) return;
  try {
    const b = leesBuffer();
    b.tellingen[ev] = (b.tellingen[ev] || 0) + 1;
    schrijfBuffer(b);
    zorgVoorFlushLus();
  } catch(e){ /* tellen mag nooit de app breken */ }
}

/* Schrijf de opgespaarde tellingen gebundeld weg en leeg de buffer.
   Eén document per gebruiker per dag; increment() per event zodat parallelle
   sessies/tabs elkaar niet overschrijven. */
export async function flushGebruik(){
  const b = leesBuffer();
  const events = Object.keys(b.tellingen || {});
  if (!events.length || !S.user) return;

  // buffer meteen legen (optimistisch) zodat gelijktijdige flushes niet dubbel tellen
  schrijfBuffer({ datum: vandaag(), tellingen: {} });

  const payload = {
    uid: S.user.uid,
    datum: b.datum,
    clubId: S.clubId || S.team?.club || null,
    teamId: S.teamId || null,
    laatste: serverTimestamp(),
    tellingen: {},
  };
  for (const ev of events) payload.tellingen[ev] = increment(b.tellingen[ev]);

  try {
    await setDoc(doc(db, 'gebruik', `${S.user.uid}_${b.datum}`), payload, { merge: true });
  } catch(e){
    // mislukt: leg de tellingen terug in de buffer zodat ze bij een volgende poging meegaan
    try {
      const huidig = leesBuffer();
      for (const ev of events) huidig.tellingen[ev] = (huidig.tellingen[ev] || 0) + b.tellingen[ev];
      schrijfBuffer(huidig);
    } catch(_){}
    console.warn('[tracker] flush mislukt, tellingen bewaard voor volgende poging:', e?.code || e?.message);
  }
}

function zorgVoorFlushLus(){
  if (flushTimer) return;
  flushTimer = setInterval(() => { flushGebruik(); }, FLUSH_INTERVAL_MS);
}

/* Eenmalig opzetten van de flush-triggers bij het verbergen/sluiten van de app. */
export function startTracker(){
  if (luistertAl) return;
  luistertAl = true;
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flushGebruik();
  });
  window.addEventListener('pagehide', () => { flushGebruik(); });
}
