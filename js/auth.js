import {
  auth, db, GoogleAuthProvider, signInWithPopup, signOut,
  signInWithEmailAndPassword, createUserWithEmailAndPassword, sendPasswordResetEmail,
  collection, doc, addDoc, setDoc, getDocs, updateDoc, query, where, serverTimestamp, increment
} from './firebase.js';
import { S, $, meld } from './state.js';

/* ====================================================================
   AANMELD-FLOW — Google of e-mail+wachtwoord.

   - Alle drie geven een STABIELE identiteit (vaste uid), dus opnieuw
     inloggen maakt geen dubbele coach meer aan.
   - E-mail+wachtwoord: bestaat het account nog niet, dan wordt het bij de
     eerste keer automatisch aangemaakt (registreren = eerste login).
   - Een uitnodigingslink (?team=CODE) bepaalt bij welk team je komt. De
     teamcode bewaren we in localStorage zodat hij een eventuele
     redirect/herlaad overleeft.
   - Alleen accounts in BEHEERDERS (state.js) mogen clubs/teams aanmaken;
     dat wordt in de UI verborgen én in de Firestore-regels afgedwongen.
==================================================================== */

const LS_CODE = 'opstelling_join_code';   // teamcode die na login gekoppeld moet worden

let pendingTeamInfo = null;   // {code, teamNaam} uit de uitnodigingslink
let deeplinkVerwerkt = false;

export function getPendingTeamInfo(){ return pendingTeamInfo; }

function bewaarCode(){
  if (pendingTeamInfo){ try { localStorage.setItem(LS_CODE, pendingTeamInfo.code); } catch(e){} }
}
/* ---------- knoppen koppelen (één keer, bij opstart) ---------- */
export function initAuthUI(){
  // ===== Inlogscherm =====
  $('#googleLogin').addEventListener('click', async () => {
    try { await signInWithPopup(auth, new GoogleAuthProvider()); }
    catch(e){ meldLoginFout(e); }
  });
  // e-mail + wachtwoord (form-submit vangt klik én Enter af)
  $('#mailLoginForm').addEventListener('submit', e => {
    e.preventDefault();
    wachtwoordLogin($('#loginEmail').value, $('#loginWachtwoord').value, $('#wwLoginOk'));
  });
  $('#wwVergeten').addEventListener('click', e => {
    e.preventDefault();
    wachtwoordVergeten($('#loginEmail').value);
  });

  // ===== Uitnodigingsscherm =====
  $('#uitnodigGoogle').addEventListener('click', async () => {
    bewaarCode();
    try { await signInWithPopup(auth, new GoogleAuthProvider()); }
    catch(e){ meldLoginFout(e); }
  });
  $('#uitnodigForm').addEventListener('submit', e => {
    e.preventDefault();
    bewaarCode();
    wachtwoordLogin($('#uitnodigEmail').value, $('#uitnodigWachtwoord').value, $('#uitnodigWwOk'));
  });

  $('#uitnodigAnders').addEventListener('click', () => {
    $('#uitnodiging').style.display = 'none';
    $('#login').style.display = '';
    $('#loginEmail').focus();
  });
}

/* nette foutmelding bij social login (popup gesloten = geen melding nodig) */
function meldLoginFout(e){
  if (e.code === 'auth/popup-closed-by-user' || e.code === 'auth/cancelled-popup-request') return;
  if (e.code === 'auth/account-exists-with-different-credential'){
    meld('Dit e-mailadres is al gekoppeld aan een andere inlogmethode. Gebruik die methode om in te loggen.');
    return;
  }
  meld('Inloggen mislukt: ' + (e.code || e.message));
}

/* Log in met e-mail + wachtwoord. Bestaat het account nog niet, dan wordt het
   automatisch aangemaakt met dit wachtwoord. */
async function wachtwoordLogin(adresRuw, wachtwoord, knop){
  const adres = (adresRuw||'').trim();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(adres)) return meld('Vul een geldig e-mailadres in');
  if ((wachtwoord||'').length < 6) return meld('Wachtwoord moet minstens 6 tekens zijn');
  const oudeTekst = knop ? knop.textContent : '';
  if (knop){ knop.disabled = true; knop.textContent = 'Bezig...'; }
  try {
    await signInWithEmailAndPassword(auth, adres, wachtwoord);
  } catch(e){
    // Firebase geeft bij een onbekend account tegenwoordig vaak 'invalid-credential'
    // i.p.v. 'user-not-found'. We kunnen vooraf niet betrouwbaar weten of het account
    // bestaat, dus: probeer het account aan te maken. Lukt dat → nieuwe gebruiker.
    // Bestaat het al ('email-already-in-use') → dan was het écht een fout wachtwoord.
    if (e.code === 'auth/user-not-found' || e.code === 'auth/invalid-credential'
        || e.code === 'auth/invalid-login-credentials'){
      try {
        await createUserWithEmailAndPassword(auth, adres, wachtwoord);
      } catch(e2){
        if (e2.code === 'auth/email-already-in-use')
          meld('Onjuist wachtwoord voor dit account. Probeer opnieuw of gebruik "wachtwoord vergeten".');
        else if (e2.code === 'auth/weak-password')
          meld('Kies een wachtwoord van minstens 6 tekens');
        else if (e2.code === 'auth/operation-not-allowed')
          meld('E-mail/wachtwoord-login staat nog uit in Firebase. Zet de provider aan in de Console.');
        else
          meld('Aanmelden mislukt: ' + (e2.code||e2.message));
      }
    } else if (e.code === 'auth/wrong-password'){
      meld('Onjuist wachtwoord. Probeer opnieuw of gebruik "wachtwoord vergeten".');
    } else if (e.code === 'auth/operation-not-allowed'){
      meld('E-mail/wachtwoord-login staat nog uit in Firebase. Zet de provider aan in de Console.');
    } else {
      meld('Inloggen mislukt: ' + (e.code||e.message));
    }
  } finally {
    if (knop){ knop.disabled = false; knop.textContent = oudeTekst; }
  }
}

/* stuur een wachtwoord-reset-mail */
async function wachtwoordVergeten(adresRuw){
  const adres = (adresRuw||'').trim();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(adres)) return meld('Vul eerst je e-mailadres in');
  try {
    await sendPasswordResetEmail(auth, adres);
    meld('Reset-link gestuurd naar ' + adres + ' (check ook je spam)');
  } catch(e){
    if (e.code === 'auth/user-not-found')
      meld('Geen account met dit e-mailadres gevonden');
    else
      meld('Kon geen reset-mail sturen: ' + (e.code||e.message));
  }
}

export function doSignOut(){ signOut(auth); }

/* ====================================================================
   LOGIN-REGISTRATIE — voor het gebruiksoverzicht op het clubdashboard.
   Schrijft hooguit één keer per kalenderdag per apparaat (via localStorage,
   dus geen extra Firestore-read nodig om te bepalen of het al gebeurd is).
   - logins/{autoId}: één document per gebruiker per dag dat hij inlogt
   - gebruikers/{uid}: samenvatting (naam, laatste login, totaal aantal logins)
     voor het "meest actieve gebruikers"-lijstje, zonder de hele logins-
     collectie te hoeven doorlezen.
==================================================================== */
const LS_LOGINLOG = 'opstelling_login_log_datum';

export async function registreerLogin(){
  if (!S.user) return;
  const vandaag = new Date().toISOString().slice(0,10);
  try { if (localStorage.getItem(LS_LOGINLOG) === vandaag) return; } catch(e){}
  const naam = S.user.displayName || (S.user.email ? S.user.email.split('@')[0] : '') || 'Coach';
  const email = S.user.email || '';
  try {
    await addDoc(collection(db,'logins'), {
      uid: S.user.uid, naam, email, datum: vandaag, tijd: serverTimestamp(),
    });
    await setDoc(doc(db,'gebruikers',S.user.uid), {
      naam, email, laatsteLogin: serverTimestamp(), aantalLogins: increment(1),
    }, { merge: true });
    try { localStorage.setItem(LS_LOGINLOG, vandaag); } catch(e){}
  } catch(e){
    console.warn('Login registreren mislukt:', e);
  }
}

/* koppel de ingelogde gebruiker aan een team op basis van de teamcode */
export async function joinMetCode(code, naam = null){
  const snap = await getDocs(query(collection(db,'teams'), where('code','==',code)));
  if (snap.empty){ meld('Geen team gevonden met code ' + code); return null; }
  const t = snap.docs[0];
  const ledNaam = (naam && naam.trim())
    || S.user.displayName
    || (S.user.email ? S.user.email.split('@')[0] : '')
    || 'Coach';
  await updateDoc(t.ref, {
    ['leden.'+S.user.uid]: true,
    ['ledenInfo.'+S.user.uid]: {naam: ledNaam, email: S.user.email || ''},
  });
  return t;
}

/* uitnodigingslink herkennen en het uitnodigingsscherm voorbereiden */
export async function checkUitnodiging(){
  const p = new URLSearchParams(location.search);
  const code = (p.get('team') || '').toUpperCase();
  if (!code) return false;
  pendingTeamInfo = {code, teamNaam: ''};
  try {
    const snap = await getDocs(query(collection(db,'teams'), where('code','==',code)));
    if (snap.empty){
      $('#uitnodigTitel').textContent = 'Uitnodiging ongeldig';
      $('#uitnodigSubtitel').textContent = 'Deze link werkt niet meer. Controleer of je de volledige link hebt, of vraag een nieuwe aan je coach.';
      $('#uitnodigGoogle').style.display = 'none';
      $('#uitnodigForm').style.display = 'none';
      pendingTeamInfo = null;
    } else {
      const team = snap.docs[0].data();
      $('#uitnodigTitel').textContent = '🏟 ' + team.naam;
      $('#uitnodigSubtitel').textContent = team.clubNaam
        ? 'Je bent uitgenodigd als coach bij ' + team.clubNaam + '. Log in om aan te sluiten.'
        : 'Je bent uitgenodigd als coach. Log in om aan te sluiten.';
      pendingTeamInfo = {code, teamNaam: team.naam};
    }
  } catch(e){
    $('#uitnodigTitel').textContent = 'Welkom!';
    $('#uitnodigSubtitel').textContent = 'Log in om als coach aan te sluiten bij het team.';
  }
  return true;
}

/* na inloggen: openstaande teamkoppeling afhandelen (uit localStorage).
   Geeft het team-document terug als er net is aangesloten, anders null. */
export async function handelPendingJoin(){
  let code = '';
  if (pendingTeamInfo) code = pendingTeamInfo.code;
  if (!code){ try { code = localStorage.getItem(LS_CODE) || ''; } catch(e){} }
  if (!code) return null;
  try { localStorage.removeItem(LS_CODE); } catch(e){}
  if (S.teams.find(t => (t.code||'').toUpperCase() === code.toUpperCase())) return null;
  return await joinMetCode(code);
}

/* deep-links (?team= of ?club=) na inloggen verwerken */
export async function verwerkDeeplink(openTeam, openClub){
  if (deeplinkVerwerkt) return;
  const p = new URLSearchParams(location.search);
  const teamParam = p.get('team');
  const clubCode = p.get('club');
  if (teamParam){
    deeplinkVerwerkt = true;
    history.replaceState(null,'',location.pathname);
    const code = teamParam.toUpperCase();
    if (!S.teams.find(t => (t.code||'').toUpperCase() === code)){
      const t = await joinMetCode(code);
      if (t){ meld('Welkom bij ' + t.data().naam); openTeam(t.id); }
    }
  } else if (clubCode){
    deeplinkVerwerkt = true;
    history.replaceState(null,'',location.pathname);
    const snap = await getDocs(query(collection(db,'clubs'), where('code','==',clubCode.toUpperCase())));
    if (snap.empty) return meld('Clubcode niet gevonden');
    const c = snap.docs[0];
    await updateDoc(c.ref, {['leden.'+S.user.uid]: true,
      ['ledenInfo.'+S.user.uid]: {naam: S.user.displayName || S.user.email || 'Coach'}});
    meld('Gekoppeld aan ' + c.data().naam);
  }
}
