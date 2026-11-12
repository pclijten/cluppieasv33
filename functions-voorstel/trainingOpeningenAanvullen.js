/* Cloud Function voor Club → Inzicht → Trainingen: eenmalig de eerdere
   training-openingen aanvullen vanuit de bestaande gelezen-markeringen.

   Plak dit in functions/index.js (onderaan, na de bestaande require's van
   firebase-admin en initializeApp()) en deploy alleen deze functie:
     firebase deploy --only functions:trainingOpeningenAanvullen
   (nooit --only functions: dat verwijdert andere functies).

   Wat het doet
   - Alleen een clubadmin (clubs/{clubId}.admins[uid] === true) mag dit starten.
   - Per team van de club: neemt de coaches (team.leden[uid] === true), leest
     per coach gebruikers/{uid}/gelezen en houdt de trainingen over die aan dit
     team zijn toegewezen.
   - Schrijft per team per training het moment van eerste openen naar
     teams/{teamId}/trainingGeopend/{trainingId} (zelfde vorm als training-log.js:
     momenten.{epoch-ms} = 1). Bestaande momenten blijven staan; opnieuw
     draaien levert geen dubbelingen op.
   - Zet clubs/{clubId}.trainingOpeningenAangevuld zodat de knop in de app
     verdwijnt.

   Beperkingen (komen uit de bron, niet te herstellen)
   - Per coach is alleen de eerste keer openen bekend, geen herhalingen.
   - Een coach van meerdere teams telt mee bij elk team waar die training aan
     is toegewezen.

   AVG: er gaat geen uid of naam mee naar het teamdocument, alleen tijdstippen. */
const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');

exports.trainingOpeningenAanvullen = onCall(
  { region: 'europe-west1', timeoutSeconds: 300, memory: '512MiB', maxInstances: 1 },
  async (req) => {
    if (!req.auth) throw new HttpsError('unauthenticated', 'Inloggen vereist');
    const clubId = String(req.data?.clubId || '');
    if (!clubId) throw new HttpsError('invalid-argument', 'clubId ontbreekt');

    const db = getFirestore();
    const clubRef = db.doc(`clubs/${clubId}`);
    const club = await clubRef.get();
    if (!club.exists) throw new HttpsError('not-found', 'Club niet gevonden');
    if ((club.get('admins') || {})[req.auth.uid] !== true) {
      throw new HttpsError('permission-denied', 'Alleen een clubbeheerder kan dit starten');
    }

    // welke oefenstof hoort bij welk team
    const trSnap = await db.collection('trainingen').where('club', '==', clubId).get();
    const stofPerTeam = new Map();
    trSnap.forEach(d => (d.get('teams') || []).forEach(t => {
      if (!stofPerTeam.has(t)) stofPerTeam.set(t, new Set());
      stofPerTeam.get(t).add(d.id);
    }));

    // gelezen-markeringen per coach (één keer lezen, ook bij meerdere teams)
    const gelezenCache = new Map();
    async function gelezenVan(uid) {
      if (gelezenCache.has(uid)) return gelezenCache.get(uid);
      const m = new Map();
      try {
        const snap = await db.collection(`gebruikers/${uid}/gelezen`).get();
        snap.forEach(d => { const ts = d.get('tijd'); if (ts && ts.toMillis) m.set(d.id, ts.toMillis()); });
      } catch (e) { /* één coach zonder leesbare data mag de rest niet stoppen */ }
      gelezenCache.set(uid, m);
      return m;
    }

    const schrijver = db.bulkWriter();
    let teams = 0, trainingen = 0, momenten = 0;
    for (const teamId of Object.keys(club.get('teams') || {})) {
      const stof = stofPerTeam.get(teamId);
      if (!stof || !stof.size) continue;
      const teamDoc = await db.doc(`teams/${teamId}`).get();
      if (!teamDoc.exists) continue;
      const coaches = Object.entries(teamDoc.get('leden') || {}).filter(([, v]) => v === true).map(([u]) => u);

      const perTraining = new Map();   // trainingId -> Set(ms)
      for (const uid of coaches) {
        for (const [tid, ms] of await gelezenVan(uid)) {
          if (!stof.has(tid)) continue;
          if (!perTraining.has(tid)) perTraining.set(tid, new Set());
          perTraining.get(tid).add(ms);
        }
      }
      if (!perTraining.size) continue;
      teams++;

      for (const [tid, set] of perTraining) {
        const ref = db.doc(`teams/${teamId}/trainingGeopend/${tid}`);
        const bestaand = await ref.get();
        const oud = bestaand.exists ? Object.keys(bestaand.get('momenten') || {}) : [];
        const nieuw = {};
        set.forEach(ms => { nieuw[String(ms)] = 1; });
        const alle = new Set([...oud, ...Object.keys(nieuw)]);
        const aantal = Math.max(bestaand.exists ? (bestaand.get('aantal') || 0) : 0, alle.size);
        schrijver.set(ref, { trainingId: tid, momenten: nieuw, aantal, aangevuld: true }, { merge: true });
        trainingen++;
        momenten += set.size;
      }
    }
    await schrijver.close();
    await clubRef.set({ trainingOpeningenAangevuld: FieldValue.serverTimestamp() }, { merge: true });
    return { teams, trainingen, momenten };
  });
