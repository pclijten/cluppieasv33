/* ==================== UITGELICHTE VIDEO [20261124a] ====================
   Een clubbeheerder kan een video "uitlichten" (videos/{id}.uitgelicht = true, zie
   modalBewerkVideo in club.js). Zo'n video staat bovenaan het Nu-scherm van elk team
   waarmee hij gedeeld is, tot de coach hem één keer heeft geopend. Daarna blijft er
   een kleine regel onder de Nu-kaart staan om hem terug te vinden; hij staat ook
   gewoon bij Video's. Bedoeld voor de uitlegvideo per blok.

   Wat een coach al gezien heeft staat per gebruiker in
     gebruikers/{uid}/meta/onboarding.videoGezien = { '<videoId>': <tijd in ms> }
   met een kopie in localStorage, zodat de kaart ook zonder bereik wegblijft.
   Dit bestand heeft geen vaste imports: de keuze hieronder is daardoor los te testen. */

const LS_KEY = 'cluppieVideoGezien_v1';
const FIREBASE = './firebase.js?v=20261106r';

/* De uitgelichte video's van dit team, nieuwste eerst. */
export function uitgelichtVoorTeam(videos, teamId){
  const tijd = v => v?.uitgelichtOp?.seconds || v?.gemaakt?.seconds || 0;
  return (videos || [])
    .filter(v => v && v.uitgelicht === true && v.url && (v.teams || []).includes(teamId))
    .sort((a, b) => tijd(b) - tijd(a) || String(a.id).localeCompare(String(b.id)));
}

/* Wat het Nu-scherm toont: één nieuwe video groot bovenaan (nieuw), de rest klein (terug).
   - gezien:  { id: tijd } van deze gebruiker
   - geladen: false zolang we nog niet weten wat er op een ander toestel al gezien is;
              dan tonen we niets groots, zodat de kaart niet even opflitst
   - later:   Set met id's die deze sessie zijn weggetikt ("Later") */
export function kiesUitgelicht({ videos, teamId, gezien = {}, geladen = true, later = null }){
  const lijst = uitgelichtVoorTeam(videos, teamId);
  const open = lijst.filter(v => !gezien[v.id]);
  const nieuw = geladen ? (open.find(v => !(later && later.has(v.id))) || null) : null;
  return { nieuw, terug: lijst.filter(v => v !== nieuw).slice(0, 2) };
}

function lokaalLees(){ try { return JSON.parse(localStorage.getItem(LS_KEY) || '{}') || {}; } catch { return {}; } }
function lokaalSchrijf(o){ try { localStorage.setItem(LS_KEY, JSON.stringify(o)); } catch {} }

let _gezien = null, _geladenVoor = null, _laden = null;
export function gezienNu(){ return _gezien || (_gezien = lokaalLees()); }
export function gezienGeladen(uid){ return !uid || _geladenVoor === uid; }

/* Haalt één keer per sessie op wat deze gebruiker elders al gezien heeft. Lukt dat niet
   (geen bereik), dan geldt wat er lokaal staat. Geeft true terug zodra het bekend is. */
export function laadGezien(uid){
  if (!uid || _geladenVoor === uid) return Promise.resolve(false);
  if (_laden) return _laden;
  _laden = (async () => {
    try {
      const { db, doc, getDoc } = await import(FIREBASE);
      const snap = await getDoc(doc(db, 'gebruikers', uid, 'meta', 'onboarding'));
      const server = (snap.exists() && snap.data().videoGezien) || {};
      _gezien = { ...server, ...gezienNu() }; lokaalSchrijf(_gezien);
    } catch (err) { console.warn('[video] gezien-lijst niet opgehaald', err); }
    _geladenVoor = uid; _laden = null;
    return true;
  })();
  return _laden;
}

/* Onthoud dat deze gebruiker de video geopend heeft: meteen lokaal, daarna in Firestore. */
export async function markeerGezien(uid, videoId){
  if (!videoId || gezienNu()[videoId]) return;
  const nu = Date.now();
  _gezien = { ...gezienNu(), [videoId]: nu }; lokaalSchrijf(_gezien);
  if (!uid) return;
  try {
    const { db, doc, setDoc } = await import(FIREBASE);
    await setDoc(doc(db, 'gebruikers', uid, 'meta', 'onboarding'), { videoGezien: { [videoId]: nu } }, { merge: true });
  } catch (err) { console.warn('[video] gezien niet bewaard', err); }
}
