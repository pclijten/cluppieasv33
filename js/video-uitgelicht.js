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

/* ==================== WIE HEEFT EEN VIDEO BEKEKEN [20261124c] ====================
   Elke keer dat een trainer een video opent, tellen we dat in zijn eigen document
     gebruik/{uid}_video_{clubId} = { uid, clubId, soort:'video', videos: { <videoId>: { n, laatst } } }
   Dat document mag alleen de trainer zelf schrijven en alleen de clubbeheerder lezen (zelfde
   regels als de gebruiksteller). Zonder `datum`, zodat de bestaande tellingen het overslaan.
   We weten alleen dat de video geopend is, niet of hij is uitgekeken. */
export async function logBekeken(uid, clubId, videoId){
  if (!uid || !clubId || !videoId) return;
  try {
    const { db, doc, setDoc, increment, serverTimestamp } = await import(FIREBASE);
    await setDoc(doc(db, 'gebruik', `${uid}_video_${clubId}`), { uid, clubId, soort: 'video', laatste: serverTimestamp(),
      videos: { [videoId]: { n: increment(1), laatst: Date.now() } } }, { merge: true });
  } catch (err) { console.warn('[video] bekijken niet geteld', err); }
}

/* Voor de beheerder: { <videoId>: { <uid>: { n, laatst } } } van de hele club. */
export async function laadBekeken(clubId){
  const { db, collection, getDocs, query, where } = await import(FIREBASE);
  const snap = await getDocs(query(collection(db, 'gebruik'), where('soort', '==', 'video'), where('clubId', '==', clubId)));
  return bekekenPerVideo(snap.docs.map(d => d.data()));
}
export function bekekenPerVideo(docs){
  const uit = {};
  for (const d of docs || []){
    if (!d || !d.uid) continue;
    for (const [vid, k] of Object.entries(d.videos || {})){
      const n = Number(k?.n) || 0; if (n <= 0) continue;
      ((uit[vid] ||= {})[d.uid] = { n, laatst: Number(k.laatst) || 0 });
    }
  }
  return uit;
}

/* Overzicht van één video: per team de trainers met wel of niet bekeken, plus wie hem opende
   zonder trainer van een van die teams te zijn (beheerders, coördinatoren).
   teams: [{ id, naam, leden: { uid: true }, ledenInfo: { uid: { naam } } }], namen: { uid: naam } */
export function bekekenOverzicht(vid, teams, bekeken, namen = {}){
  const kijkers = (bekeken && bekeken[vid.id]) || {};
  const trainers = new Set();
  const perTeam = (vid.teams || []).map(tid => (teams || []).find(t => t.id === tid)).filter(Boolean).map(t => ({
    id: t.id, naam: t.naam || 'Team',
    trainers: Object.keys(t.leden || {}).filter(u => t.leden[u] === true).map(u => {
      trainers.add(u);
      return { uid: u, naam: t.ledenInfo?.[u]?.naam || namen[u] || 'Trainer', n: kijkers[u]?.n || 0, laatst: kijkers[u]?.laatst || 0 };
    }).sort((a, b) => (b.n > 0) - (a.n > 0) || a.naam.localeCompare(b.naam, 'nl')),
  }));
  const anderen = Object.keys(kijkers).filter(u => !trainers.has(u))
    .map(u => ({ uid: u, naam: namen[u] || 'Iemand anders van de club', n: kijkers[u].n, laatst: kijkers[u].laatst }))
    .sort((a, b) => a.naam.localeCompare(b.naam, 'nl'));
  return { perTeam, anderen, totaal: trainers.size, gezien: [...trainers].filter(u => kijkers[u]?.n > 0).length,
    keer: Object.values(kijkers).reduce((s, k) => s + k.n, 0) };
}
