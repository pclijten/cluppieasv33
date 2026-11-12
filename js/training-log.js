/* ==================== TRAINING-OPENINGEN LOGGEN ====================
   Legt vast wanneer een team oefenstof (een training uit 'trainingen') opent,
   zodat Club → Inzicht → Trainingen per team kan tonen welke training wanneer
   is bekeken t.o.v. de trainingsdag.

   Eén document per team per training: teams/{teamId}/trainingGeopend/{trainingId}
     { trainingId, aantal, laatste, momenten: { <epoch-ms>: 1, ... } }
   Valt onder de bestaande /teams/{teamId}/{sub=**}-regel; geen rules-wijziging.

   AVG: teamniveau. Geen uid, geen naam: alleen tijdstippen en een teller.
   Zuinig: dezelfde training binnen 10 minuten opnieuw openen telt niet opnieuw. */

import { db, doc, setDoc, increment, serverTimestamp } from './firebase.js?v=20261106r';

const DREMPEL_MS = 10 * 60 * 1000;
const recent = new Map();   // `${teamId}|${trainingId}` -> laatst gelogd (ms)

export function logTrainingGeopend(teamId, trainingId){
  if (!teamId || !trainingId) return;
  const sleutel = `${teamId}|${trainingId}`;
  const nu = Date.now();
  if (nu - (recent.get(sleutel) || 0) < DREMPEL_MS) return;
  recent.set(sleutel, nu);
  // fire-and-forget: loggen mag het openen nooit vertragen of breken
  setDoc(doc(db, 'teams', teamId, 'trainingGeopend', trainingId), {
    trainingId,
    aantal: increment(1),
    laatste: serverTimestamp(),
    momenten: { [String(nu)]: 1 },
  }, { merge: true }).catch(e => console.warn('[Cluppie] training-openen niet gelogd:', e?.code || e?.message));
}
