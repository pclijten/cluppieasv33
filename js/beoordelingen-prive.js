/* ==================== Privé-rondebeoordelingen ophalen ====================
   [20261113v] Beoordelingen die bij een evaluatieronde van de club horen
   (winter, lente) staan in de top-level collectie `beoordelingenPrive`, niet
   in teams/{id}/beoordelingen. Alleen leesbaar voor wie in `zichtbaarVoor`
   staat (de schrijver, de coördinatoren van de bouw en de clubbeheerders),
   afgedwongen in de Firestore-rules. Daarom filtert elke query op
   zichtbaarVoor array-contains <eigen uid>: de rules weigeren anders de hele
   query. Fout of nog geen rules? Dan een lege lijst, zodat de rest gewoon werkt. */
import { db, collection, getDocs, query, where } from './firebase.js?v=20261106r';
import { S } from './state.js?v=20261111g';

export async function priveBeoordelingenVan(teamId){
  if (!teamId || !S.user?.uid) return [];
  try {
    const snap = await getDocs(query(collection(db, 'beoordelingenPrive'),
      where('teamId', '==', teamId), where('zichtbaarVoor', 'array-contains', S.user.uid)));
    return snap.docs.map(d => ({ id: d.id, ...d.data(), prive: true }));
  } catch(e){
    console.warn('[Cluppie] privé-beoordelingen niet gelezen voor team', teamId, e.code || e.message);
    return [];
  }
}
