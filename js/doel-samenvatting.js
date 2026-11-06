/* ==================== DOEL-SAMENVATTING ====================
   Eén regel die alle trainingsdoelen van een training samenvat, voor de
   Nu-kaart op de team-hub. De AI (Cloud Function 'vatDoelenSamen') krijgt
   ALLEEN de doeltekst uit de oefenstof: geen spelers, geen teamgegevens.

   Zuinig: per training wordt het maar één keer gevraagd.
     1. staat de samenvatting al op het trainingsdocument (doelSamenvatting)? Dan klaar.
     2. anders uit de lokale cache (zelfde doelen = zelfde hash);
     3. anders de Cloud Function; het resultaat gaat in de cache en wordt
        (als de coach schrijfrechten heeft) op het document bewaard zodat
        andere coaches niet opnieuw hoeven te vragen.
   Faalt de AI, dan blijft de eerste doelregel staan: de kaart breekt nooit. */
import { functions, httpsCallable, db, doc, updateDoc } from './firebase.js?v=20261106n';

const MAX_TEKENS = 90;
const geheugen = new Map();      // id+hash -> tekst (deze sessie)
const bezig = new Map();         // id+hash -> Promise

export const doelTeksten = t => (Array.isArray(t?.doelen) ? t.doelen : [])
  .map(d => String(d?.tekst ?? d ?? '').trim()).filter(Boolean);

function hash(lijst){
  let h = 5381; const s = lijst.join('\n');
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}
const opschonen = s => String(s || '').replace(/\s+/g, ' ').replace(/^["'“”\-•\s]+|["'“”\s.]+$/g, '').trim();

/* Direct (synchroon) beschikbare tekst, of '' als die er nog niet is. */
export function samenvattingNu(t){
  const doelen = doelTeksten(t);
  if (doelen.length < 2) return doelen[0] || '';
  const h = hash(doelen), sleutel = t.id + ':' + h;
  if (t.doelSamenvatting?.hash === h && t.doelSamenvatting?.tekst) return t.doelSamenvatting.tekst;
  if (geheugen.has(sleutel)) return geheugen.get(sleutel);
  try { const c = localStorage.getItem('cluppie-doelsam:' + sleutel); if (c){ geheugen.set(sleutel, c); return c; } } catch(e){}
  return '';
}

/* Vraagt de AI (eenmalig per training) en geeft de tekst terug, of '' bij falen. */
export function haalSamenvatting(t){
  const doelen = doelTeksten(t);
  if (doelen.length < 2) return Promise.resolve(doelen[0] || '');
  const h = hash(doelen), sleutel = t.id + ':' + h;
  const al = samenvattingNu(t);
  if (al) return Promise.resolve(al);
  if (bezig.has(sleutel)) return bezig.get(sleutel);
  const p = (async () => {
    try {
      const res = await httpsCallable(functions, 'vatDoelenSamen')({ doelen });
      const tekst = opschonen(res?.data?.tekst);
      if (!tekst || tekst.length > MAX_TEKENS + 30) return '';
      geheugen.set(sleutel, tekst);
      try { localStorage.setItem('cluppie-doelsam:' + sleutel, tekst); } catch(e){}
      try { await updateDoc(doc(db, 'trainingen', t.id), { doelSamenvatting: { tekst, hash: h } }); } catch(e){ /* geen schrijfrechten: cache volstaat */ }
      return tekst;
    } catch(err){
      console.warn('[doel-samenvatting] AI niet beschikbaar, eerste doel blijft staan', err?.code || err);
      return '';
    } finally { bezig.delete(sleutel); }
  })();
  bezig.set(sleutel, p);
  return p;
}
