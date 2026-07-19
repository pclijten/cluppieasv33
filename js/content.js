/* ==================== CONTENT (leercurve-teksten, ASV-kompas, gouden regels) ====================
   Doel: teksten uit het jeugdbeleidsplan (achtergrond + tips per leerthema, de
   roterende ASV-kompas-tips, de gouden regels) staan niet langer hardcoded in
   config.js, maar in de Firestore-collectie 'content'. Zo kan een tekst worden
   aangepast via het clubdashboard-tabblad "Content" (zie club-content.js),
   zonder ooit JS te hoeven aanpassen, valideren of opnieuw te uploaden.

   Schema per document in 'content':
     {
       categorie: 'leercurve' | 'kompas' | 'gouden-regel',
       thema:     alleen bij 'leercurve' — koppelt aan LEERCURVE in config.js
       tags:      string[]   — vrij, voor latere filtering/zoeken
       volgorde:  number     — bepaalt de weergavevolgorde
       status:    'concept' | 'gepubliceerd'
       titel:     string     — thema-naam / kompas-tekst / gouden-regeltekst
       achtergrond: string
       tips:      string[]
     }

   'concept'-content wordt NERGENS getoond behalve in het admin-tabblad zelf —
   zo kun je een tekst rustig schrijven zonder hem meteen aan coaches te tonen.

   content/seed.json bevat de oorspronkelijke teksten uit het jeugdbeleidsplan.
   Dat bestand dient als:
     (a) fallback zodat de app blijft werken vóórdat er iets in Firestore staat
         (bijv. een gloednieuw Firebase-testproject), en
     (b) brondata voor de knop "Seed content naar Firestore" in het
         admin-tabblad — een eenmalige, veilige migratie (bestaande content
         wordt nooit overschreven). */

import {
  db, collection, doc, setDoc, deleteDoc, query, where, onSnapshot
} from './firebase.js?v=20260719';
import { listenMet } from './state.js?v=20260719';

let _gepubliceerd = [];   // wat coaches te zien krijgen
let _alles = [];          // incl. concepten — alleen gebruikt door het admin-tabblad
let _seedFallback = null; // lazy geladen content/seed.json, alleen als fallback

function sorteer(lijst){ return [...lijst].sort((a,b) => (a.volgorde||0) - (b.volgorde||0)); }

/* ---------- Live lezen (voor alle coaches) ---------- */
export function startContentListener(){
  return listenMet(
    query(collection(db,'content'), where('status','==','gepubliceerd')),
    snap => {
      _gepubliceerd = snap.docs.map(d => ({ id:d.id, ...d.data() }));
      // Zodra er echte content is geladen heeft de fallback geen functie meer.
    },
    'content'
  );
}

/* Fallback: alleen gebruikt als de Firestore-collectie nog leeg is (bv. een
   gloednieuw Firebase-project waar nog niemand op "Seed content" heeft
   gedrukt). Zo staat de app nooit met lege leerlijn-/kompasteksten. */
async function laadFallbackIndienNodig(){
  if (_gepubliceerd.length || _seedFallback) return;
  try {
    const res = await fetch('./content/seed.json');
    _seedFallback = await res.json();
  } catch(e){
    console.error('[Cluppie] Kon content/seed.json niet laden:', e);
    _seedFallback = [];
  }
}

function bron(){ return _gepubliceerd.length ? _gepubliceerd : (_seedFallback || []); }

export function contentVoorCategorie(categorie){
  laadFallbackIndienNodig();
  return sorteer(bron().filter(c => c.categorie === categorie));
}
export function contentVoorThema(thema){
  laadFallbackIndienNodig();
  return bron().find(c => c.categorie === 'leercurve' && c.thema === thema) || null;
}
export function kompasTips(){
  laadFallbackIndienNodig();
  return sorteer(bron().filter(c => c.categorie === 'kompas'));
}
export function goudenRegels(){
  laadFallbackIndienNodig();
  return sorteer(bron().filter(c => c.categorie === 'gouden-regel')).map(c => c.titel);
}

/* ---------- Admin-tabblad: alle content, incl. concepten ---------- */
export function startContentAdminListener(onData){
  return listenMet(collection(db,'content'), snap => {
    _alles = snap.docs.map(d => ({ id:d.id, ...d.data() }));
    onData(_alles);
  }, 'content (beheer)');
}

export async function opslaanContent(id, data){
  await setDoc(doc(db,'content', id), data, { merge:true });
}
export async function verwijderContent(id){
  await deleteDoc(doc(db,'content', id));
}

/* Eenmalige migratie: schrijft content/seed.json naar Firestore. Bestaande
   documenten (zelfde id) worden overgeslagen, dus dit kan zonder risico
   meerdere keren ingedrukt worden — handig bij een nieuw testproject. */
export async function seedContentNaarFirestore(){
  const res = await fetch('./content/seed.json');
  const seed = await res.json();
  let geschreven = 0, overgeslagen = 0;
  for (const item of seed){
    if (_alles.some(c => c.id === item.id)){ overgeslagen++; continue; }
    await setDoc(doc(db,'content', item.id), item);
    geschreven++;
  }
  return { geschreven, overgeslagen };
}
