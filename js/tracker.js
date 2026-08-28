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
import { S } from './state.js?v=20260828c';

const LS_BUFFER = 'cluppie_gebruik_buffer';   // {datum, tellingen:{ev:n}}
const FLUSH_INTERVAL_MS = 2 * 60 * 1000;

/* --- navigatiepad-buffer (klikgedrag/schermvolgorde) ---
   Aparte, nieuwe buffer náást de teller-buffer hierboven. Legt per sessie een
   geordend pad van schermovergangen vast, zodat de admin kan zien HOE coaches
   door de app bewegen (top-routes, overgangsmatrix, uitstappunten). Net zo
   zuinig als de teller: bufferen in sessionStorage, gebundeld wegschrijven.
   AVG: alleen schermnaam + tijdstempel + aanleiding (tab/tegel/terug/open/
   sluit). NOOIT speler- of persoonsgegevens. */
const LS_NAVPAD  = 'cluppie_navpad_buffer';   // {sid, start, stappen:[{s,t,h}]}
const NAVPAD_CAP = 200;                       // max stappen per sessie (buffer + write klein houden)

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

/* ==================== NAVIGATIEPAD (klikgedrag) ====================
   Legt per sessie een geordend pad van schermovergangen vast. Zelfde zuinigheid
   als de teller hierboven: alles in sessionStorage, gebundeld wegschrijven.
   Eén document per sessie: navpaden/{uid}_{sessieId}, met merge zodat een sessie
   die over meerdere flushes loopt netjes wordt aangevuld i.p.v. overschreven.

   Elke stap: { s: schermnaam, t: ms-offset sinds sessiestart, h: aanleiding }.
   Aanleiding (h): 'tab' | 'tegel' | 'terug' | 'open' | 'sluit'. Zo is zichtbaar
   of iemand bewust ergens heen ging (tab/tegel) of MOEST terugklikken (terug).
   AVG: nooit speler- of persoonsdata — alleen schermnaam + tijd + aanleiding. */

/* sessie-id: één per browser-sessie (leeft in sessionStorage, verdwijnt bij
   sluiten van de tab). Puur een willekeurige sleutel om stappen te groeperen —
   geen persoonsgegeven. */
function sessieId(){
  try {
    let sid = sessionStorage.getItem('cluppie_navpad_sid');
    if (!sid){
      sid = Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
      sessionStorage.setItem('cluppie_navpad_sid', sid);
    }
    return sid;
  } catch(e){ return 'sid0'; }
}

function leesNavpad(){
  try {
    const ruw = sessionStorage.getItem(LS_NAVPAD);
    if (ruw){
      const b = JSON.parse(ruw);
      if (b && b.sid && Array.isArray(b.stappen)) return b;
    }
  } catch(e){}
  return { sid: sessieId(), start: Date.now(), stappen: [] };
}
function schrijfNavpad(b){
  try { sessionStorage.setItem(LS_NAVPAD, JSON.stringify(b)); } catch(e){}
}

/* Publieke API: registreer één schermovergang. Nooit blokkerend, faalt stil.
   scherm = fijnmazige naam (bv. 'team:spelers', 'wedstrijd:kwart').
   hoe    = aanleiding ('tab'|'tegel'|'terug'|'open'|'sluit'), default 'tegel'. */
export function telNav(scherm, hoe = 'tegel'){
  if (!scherm || !S.user) return;
  try {
    const b = leesNavpad();
    // dubbele opeenvolgende stap naar hetzelfde scherm negeren (rerenders e.d.)
    const laatste = b.stappen[b.stappen.length - 1];
    if (laatste && laatste.s === scherm && laatste.h === hoe) return;
    b.stappen.push({ s: String(scherm).slice(0, 40), t: Date.now() - b.start, h: hoe });
    // cap: buffer en write klein houden; oudste stappen vallen weg
    if (b.stappen.length > NAVPAD_CAP) b.stappen = b.stappen.slice(-NAVPAD_CAP);
    schrijfNavpad(b);
    zorgVoorFlushLus();
  } catch(e){ /* tracking mag de app nooit breken */ }
}

/* Schrijf het opgespaarde pad gebundeld weg. Merge op sessie-document zodat
   losse flushes binnen dezelfde sessie elkaar aanvullen. De buffer blijft staan
   (geen reset): het pad is cumulatief per sessie en de cap houdt hem begrensd. */
export async function flushNav(){
  const b = leesNavpad();
  if (!b.stappen.length || !S.user) return;
  try {
    await setDoc(doc(db, 'navpaden', `${S.user.uid}_${b.sid}`), {
      uid: S.user.uid,
      sid: b.sid,
      datum: vandaag(),
      clubId: S.clubId || S.team?.club || null,
      teamId: S.teamId || null,
      start: b.start,
      laatste: serverTimestamp(),
      aantal: b.stappen.length,
      stappen: b.stappen,
    }, { merge: true });
  } catch(e){
    console.warn('[tracker] navpad-flush mislukt:', e?.code || e?.message);
  }
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
  flushTimer = setInterval(() => { flushGebruik(); flushNav(); }, FLUSH_INTERVAL_MS);
}

/* Eenmalig opzetten van de flush-triggers bij het verbergen/sluiten van de app. */
export function startTracker(){
  if (luistertAl) return;
  luistertAl = true;
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden'){ flushGebruik(); flushNav(); }
  });
  window.addEventListener('pagehide', () => { flushGebruik(); flushNav(); });
}
