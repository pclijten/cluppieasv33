/* ==================== CLUPPIE CLOUD FUNCTIONS ====================
   Regio: europe-west1 (zelfde als de rest van het project).

   Functies in dit bestand:
     • chatHulp          – hulp-chatbot: beantwoordt vragen over het GEBRUIK van
                           de app op basis van de handleiding-kennisbank. Kan aan
                           het eind naar een specifiek rondleiding-hoofdstuk
                           verwijzen met een [[TOUR:x]]-marker.
     • genereerVerslagAI – schrijft een levendig wedstrijdverslag op basis van
                           GEANONIMISEERDE wedstrijddata (labels "Speler 1" …).
     • syncNu            – handmatige voetbal.nl-sync (callable, knop in club.js).
     • syncVoetbalNl     – nachtelijke voetbal.nl-sync (scheduled, 03:30 NL).

   AVG / privacy:
     Er gaan NOOIT namen of andere herleidbare gegevens van (minderjarige)
     spelers naar het taalmodel. De client stuurt uitsluitend neutrale labels;
     de echte namen worden pas ná het antwoord, client-side, teruggezet.

   Kosten:
     Beide AI-functies gebruiken Claude Haiku met prompt-caching op het vaste
     systeemdeel (kennisbank / instructies), zodat herhaalvragen goedkoop zijn.

   Secret:
     ANTHROPIC_API_KEY moet als Firebase-secret zijn gezet:
       firebase functions:secrets:set ANTHROPIC_API_KEY
   ================================================================ */

const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { onSchedule } = require('firebase-functions/v2/scheduler');
const { defineSecret } = require('firebase-functions/params');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');
const admin = require('firebase-admin');
const { KENNIS_TEKST } = require('./kennis');

if (!admin.apps.length) admin.initializeApp();

const ANTHROPIC_API_KEY = defineSecret('ANTHROPIC_API_KEY');

const MODEL = 'claude-haiku-4-5-20251001';
const API_URL = 'https://api.anthropic.com/v1/messages';
const REGIO = 'europe-west1';

/* Geldige rondleiding-hoofdstukken waar de chatbot naar mag verwijzen.
   Moet gelijk lopen met de hfd-waarden in onboarding.js. */
const TOUR_HOOFDSTUKKEN = [
  'team', 'wedstrijden', 'opstelling', 'spelers', 'training',
  'video', 'planning', 'documenten', 'stats', 'instellingen', 'meer',
];

/* Kleine helper: roept de Anthropic-API aan en geeft de platte tekst terug.
   `system` mag een array van blokken zijn (voor cache_control). */
async function claude({ apiKey, system, messages, maxTokens = 700, temperature = 0.4 }){
  const res = await fetch(API_URL, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({ model: MODEL, max_tokens: maxTokens, temperature, system, messages }),
  });

  if (!res.ok){
    const tekst = await res.text().catch(() => '');
    console.error('[claude] API-fout', res.status, tekst.slice(0, 500));
    throw new HttpsError('unavailable', 'Het taalmodel is even niet bereikbaar.');
  }
  const data = await res.json();
  return (data.content || [])
    .filter(b => b.type === 'text')
    .map(b => b.text)
    .join('')
    .trim();
}

/* ==================== 1. HULP-CHATBOT ==================== */

const HULP_SYSTEEM = `Je bent "Cluppie-hulp", de vriendelijke ingebouwde assistent van Cluppie —
een web-app waarmee jeugdvoetbalcoaches de opstelling maken, wissels en speeltijd bijhouden,
de wedstrijd loggen, spelers beoordelen en trainingen delen.

Je BEANTWOORDT ALLEEN vragen over het GEBRUIK van de app. Gebruik uitsluitend de
onderstaande kennisbank. Verzin geen knoppen, schermen of functies die er niet in staan.
Weet je iets niet zeker op basis van de kennisbank, zeg dat dan eerlijk en verwijs naar
"Meer → Handleiding".

Stijl:
- Schrijf in het Nederlands, warm en to-the-point. Tutoyeer ("je").
- Kort: meestal 2–5 zinnen. Noem concrete tabbladen/knoppen ("het tabblad 📋", "Wijzig opzet").
- Geen medische, juridische of voetbaltechnische/pedagogische adviezen — alleen app-gebruik.
- Vraag NOOIT om namen van spelers of andere persoonsgegevens, en herhaal die ook niet.

Rondleiding-verwijzing (belangrijk):
Als jouw antwoord over één specifiek onderdeel van de app gaat én een korte interactieve
rondleiding de coach zou helpen, sluit je af met EXACT één marker op een eigen regel:
[[TOUR:x]]
waarbij x precies één van deze hoofdstukken is:
${TOUR_HOOFDSTUKKEN.join(', ')}.
Kies het hoofdstuk dat het beste bij de vraag past (bv. een vraag over de opstelling → [[TOUR:opstelling]],
over het uitnodigen van een coach of teaminstellingen → [[TOUR:instellingen]]).
Voeg de marker alleen toe als hij echt past; laat hem anders weg. Schrijf zelf NOOIT letterlijk
"[[TOUR:..." in je zichtbare zin — de marker staat los, onderaan.

KENNISBANK:
${KENNIS_TEKST}`;

exports.chatHulp = onCall(
  { region: REGIO, secrets: [ANTHROPIC_API_KEY], cors: true },
  async (request) => {
    if (!request.auth){
      throw new HttpsError('unauthenticated', 'Log in om de hulp te gebruiken.');
    }

    const berichten = Array.isArray(request.data?.berichten) ? request.data.berichten : [];
    if (!berichten.length){
      throw new HttpsError('invalid-argument', 'Geen vraag ontvangen.');
    }

    // Alleen rol + tekst doorlaten, lengte begrenzen, laatste ~10 beurten houden.
    const messages = berichten
      .filter(b => b && (b.role === 'user' || b.role === 'assistant') && typeof b.content === 'string')
      .slice(-10)
      .map(b => ({ role: b.role, content: String(b.content).slice(0, 2000) }));

    if (!messages.length || messages[messages.length - 1].role !== 'user'){
      throw new HttpsError('invalid-argument', 'Laatste bericht moet een vraag zijn.');
    }

    // Systeemblok met cache_control → wordt hergebruikt over vragen heen (goedkoper).
    const system = [
      { type: 'text', text: HULP_SYSTEEM, cache_control: { type: 'ephemeral' } },
    ];

    const antwoord = await claude({
      apiKey: ANTHROPIC_API_KEY.value(),
      system,
      messages,
      maxTokens: 600,
      temperature: 0.3,
    });

    return { antwoord: antwoord || 'Sorry, ik heb hier geen antwoord op.' };
  }
);

/* ==================== 2. AI-WEDSTRIJDVERSLAG ==================== */

const VERSLAG_SYSTEEM = `Je schrijft korte, levendige wedstrijdverslagen voor een jeugdvoetbalteam,
bedoeld om te delen met ouders en spelers (bv. via WhatsApp). Toon: enthousiast, warm,
positief en sportief — het gaat om kinderen, dus nooit afkraken, altijd de inzet vieren.

Regels:
- Schrijf in het Nederlands, in vloeiende alinea's (geen opsomming, geen kopjes).
- Lengte: ongeveer 120–200 woorden.
- Gebruik ALLEEN de aangeleverde gegevens. Verzin geen doelpunten, namen, minuten of gebeurtenissen.
- De spelers heten in de data neutraal "Speler 1", "Speler 2", enzovoort. Neem die labels
  LETTERLIJK over zoals ze zijn — verander ze niet en verzin er geen echte namen bij.
- Noem de eindstand en of er gewonnen, verloren of gelijkgespeeld is. Bij verlies of gelijkspel:
  blijf positief en opbouwend.
- Als er een wedstrijddoel is meegegeven, verwijs daar kort naar.
- Benoem doelpuntenmakers als die er zijn. Speeltijd hoef je niet uitputtend op te sommen;
  gebruik het hooguit voor een sfeerzin.
- Geen emoji-overdaad (een enkele mag), geen hashtags, geen aanhalingstekens rond de tekst.
- Lever alleen de verslagtekst zelf — geen inleiding als "Hier is het verslag".`;

exports.genereerVerslagAI = onCall(
  { region: REGIO, secrets: [ANTHROPIC_API_KEY], cors: true },
  async (request) => {
    if (!request.auth){
      throw new HttpsError('unauthenticated', 'Log in om een verslag te genereren.');
    }

    const d = request.data?.data;
    if (!d || typeof d !== 'object'){
      throw new HttpsError('invalid-argument', 'Geen wedstrijdgegevens ontvangen.');
    }

    // Veiligheidsnet: controleer dat er geen echte namen in de payload zitten.
    // Spelers horen labels als "Speler 1" te zijn; alles behalve tegenstander/team/doel
    // wordt hieronder als neutrale data doorgegeven.
    const veiligLabel = (v) => (typeof v === 'string' && /^Speler \d+$/.test(v)) ? v : null;

    const doelpunten = Array.isArray(d.doelpunten)
      ? d.doelpunten
          .map(g => ({ speler: veiligLabel(g?.speler), aantal: Number(g?.aantal) || 1 }))
          .filter(g => g.speler)
      : [];

    const speeltijd = Array.isArray(d.speeltijd)
      ? d.speeltijd
          .map(s => ({ speler: veiligLabel(s?.speler), minuten: Number(s?.minuten) || 0 }))
          .filter(s => s.speler)
      : [];

    // Bouw een compacte, neutrale feitenlijst voor het model.
    const feiten = {
      team: String(d.team || 'ons team').slice(0, 60),
      tegenstander: String(d.tegenstander || 'de tegenstander').slice(0, 60),
      thuisOfUit: d.thuis ? 'thuis' : 'uit',
      soort: d.toernooi ? 'toernooiwedstrijd' : 'wedstrijd',
      doelpuntenVoor: Number(d.doelBin) || 0,
      doelpuntenTegen: Number(d.doelTegen) || 0,
      resultaat: ['gewonnen', 'verloren', 'gelijkgespeeld'].includes(d.resultaat) ? d.resultaat : null,
      wedstrijddoel: d.doel ? String(d.doel).slice(0, 200) : null,
      aanvoerder: veiligLabel(d.aanvoerder),
      doelpuntenmakers: doelpunten,
      aantalSpelers: speeltijd.length,
    };

    const vraag = `Schrijf het wedstrijdverslag op basis van deze gegevens (JSON):\n\n` +
      JSON.stringify(feiten, null, 2);

    const system = [
      { type: 'text', text: VERSLAG_SYSTEEM, cache_control: { type: 'ephemeral' } },
    ];

    const verslag = await claude({
      apiKey: ANTHROPIC_API_KEY.value(),
      system,
      messages: [{ role: 'user', content: vraag }],
      maxTokens: 700,
      temperature: 0.7,
    });

    if (!verslag){
      throw new HttpsError('internal', 'Kon geen verslag genereren.');
    }
    return { verslag };
  }
);

/* ==================== 3. VOETBAL.NL / SPORTLINK iCAL-SYNC ====================
   Haalt per gekoppeld team de teamkalender op bij data.sportlink.com en zet de
   wedstrijden in teams/{teamId}/wedstrijden. Getest tegen een echte voetbal.nl-feed.

   Firestore-model (bestaand):
     clubs/{clubId}/geheim/{teamId}  → { icalToken | icalUrl, laatsteSync,
                                         laatsteAantal, laatsteFout }
     teams/{teamId}/wedstrijden/{id} → wedstrijd-document
     teamId in 'geheim' == document-ID in top-level 'teams'-collectie.

   Dedup:
     Elk wedstrijd-document krijgt een stabiel doc-ID afgeleid van de iCal-UID.
     Een re-sync overschrijft (merge:true) dezelfde wedstrijd i.p.v. te dupliceren;
     handmatig ingevulde velden (opstelling, goals, kwarten) blijven behouden.
   =========================================================================== */

/* iCal line-unfolding: regels die met spatie/tab beginnen horen bij de vorige. */
function unfoldICal(text){
  return text.replace(/\r\n[ \t]/g, '').replace(/\n[ \t]/g, '').split(/\r\n|\n/);
}
function normNaam(s){
  return (s || '').toLowerCase().replace(/['’`]/g, '').replace(/\s+/g, ' ').trim();
}
function escapeRe(s){ return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

/* Detecteert automatisch het eigen team: de ploeg die in ELKE SUMMARY voorkomt
   (tegenstanders wisselen, het eigen team is constant). Zo hoeven we niet te
   vertrouwen op een exacte naam-match met het team-document. */
function detecteerEigenTeam(summaries){
  if (!summaries.length) return '';
  const nsums = summaries.map(normNaam);
  let best = '';
  const parts = summaries[0].split('-');
  for (let i = 1; i < parts.length; i++){
    const links  = parts.slice(0, i).join('-').trim();
    const rechts = parts.slice(i).join('-').trim();
    for (const cand of [links, rechts]){
      const nc = normNaam(cand);
      if (nc.length > best.length && nsums.every(s => s.includes(nc))) best = cand.trim();
    }
  }
  return best;
}

/* Zet één VEVENT-object om naar een genormaliseerde wedstrijd. */
function mapEvent(e, eigenTeam){
  if (!e.summary || !e.dtstart) return null;
  let thuis, tegenstander;

  if (eigenTeam){
    const re = new RegExp(escapeRe(eigenTeam), 'i');
    const mm = re.exec(e.summary);
    if (mm){
      const voor = e.summary.slice(0, mm.index);
      const na   = e.summary.slice(mm.index + mm[0].length);
      if (voor.replace(/[-\s]/g, '') === ''){
        // eigen team staat vooraan → thuis
        thuis = true;  tegenstander = na.replace(/^\s*-\s*/, '').trim();
      } else {
        // eigen team staat achteraan → uit
        thuis = false; tegenstander = voor.replace(/\s*-\s*$/, '').trim();
      }
    }
  }
  if (tegenstander === undefined){
    // fallback: locatie-heuristiek (thuis = bekende thuislocatie in Aarle-Rixtel)
    thuis = /aarle-rixtel|de hut/i.test(e.location || '');
    tegenstander = e.summary.trim();
  }

  const m = /(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2}))?/.exec(e.dtstart);
  if (!m) return null;
  const datum = `${m[1]}-${m[2]}-${m[3]}`;
  const tijd  = m[4] ? `${m[4]}:${m[5]}` : null;

  return {
    uid: e.uid || `${datum}-${normNaam(tegenstander)}`,
    datum, tijd, thuis,
    tegenstander: tegenstander || 'Tegenstander',
    klasse: (e.description || '').trim(),
    locatie: (e.location || '').trim(),
  };
}

/* Parseert volledige iCal-tekst naar { eigenTeam, wedstrijden[] }. */
function parseICal(text){
  const lines = unfoldICal(text);
  const events = []; let cur = null;
  for (const line of lines){
    if (line === 'BEGIN:VEVENT'){ cur = {}; continue; }
    if (line === 'END:VEVENT'){ if (cur) events.push(cur); cur = null; continue; }
    if (!cur) continue;
    const idx = line.indexOf(':'); if (idx < 0) continue;
    let key = line.slice(0, idx); const val = line.slice(idx + 1);
    const semi = key.indexOf(';'); if (semi >= 0) key = key.slice(0, semi);
    if (key === 'UID') cur.uid = val.trim();
    else if (key === 'SUMMARY') cur.summary = val.trim();
    else if (key === 'DTSTART') cur.dtstart = val.trim();
    else if (key === 'LOCATION') cur.location = val.trim();
    else if (key === 'DESCRIPTION') cur.description = val.trim();
  }
  const eigenTeam = detecteerEigenTeam(events.map(e => e.summary).filter(Boolean));
  return { eigenTeam, wedstrijden: events.map(e => mapEvent(e, eigenTeam)).filter(Boolean) };
}

/* Stabiel, deterministisch document-ID uit de iCal-UID. */
function wedstrijdDocId(uid){
  return 'ical_' + String(uid).replace(/[^A-Za-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 120);
}

/* Bouwt de op te halen URL uit het geheim-document. */
function bouwIcalUrl(geheim){
  if (geheim.icalUrl) return geheim.icalUrl;
  if (geheim.icalToken) return `https://data.sportlink.com/ical-team?token=${encodeURIComponent(geheim.icalToken)}`;
  return null;
}

/* Sync één team. Geeft { aantal, overgeslagen } terug. */
async function syncTeam(db, teamId, geheim, seizoen){
  const url = bouwIcalUrl(geheim);
  if (!url) return { aantal: 0, overgeslagen: true };

  const resp = await fetch(url, { headers: { 'User-Agent': 'Cluppie/1.0' } });
  if (!resp.ok) throw new Error(`voetbal.nl gaf status ${resp.status}`);
  const tekst = await resp.text();

  const { wedstrijden } = parseICal(tekst);

  let aantal = 0;
  const batch = db.batch();
  for (const w of wedstrijden){
    const ref = db.collection('teams').doc(teamId)
      .collection('wedstrijden').doc(wedstrijdDocId(w.uid));
    batch.set(ref, {
      type: 'normaal',
      tegenstander: w.tegenstander,
      thuis: w.thuis,
      datum: w.datum,
      aftrap: w.tijd || null,
      klasse: w.klasse || null,
      locatie: w.locatie || null,
      seizoen: seizoen,
      bron: 'voetbalnl',
      icalUid: w.uid,
      // opzetGedaan bewust NIET zetten → normaliseerWedstrijd() in de app vult
      // format/periodes/kwarten aan zodra de coach de wedstrijd opent.
    }, { merge: true });
    aantal++;
  }
  await batch.commit();
  return { aantal, overgeslagen: false };
}

/* Sync alle gekoppelde teams van één club. Geeft { totaalWedstrijden } terug. */
async function syncClub(clubId){
  const db = getFirestore();

  const clubSnap = await db.collection('clubs').doc(clubId).get();
  const seizoen = (clubSnap.exists && clubSnap.data().huidigSeizoen) || "2025/'26";

  const geheimSnap = await db.collection('clubs').doc(clubId).collection('geheim').get();
  let totaalWedstrijden = 0;

  for (const doc of geheimSnap.docs){
    const teamId = doc.id;
    const geheim = doc.data();
    if (!geheim.icalToken && !geheim.icalUrl) continue;

    try {
      const { aantal, overgeslagen } = await syncTeam(db, teamId, geheim, seizoen);
      if (overgeslagen) continue;
      totaalWedstrijden += aantal;
      await doc.ref.set({
        laatsteSync: FieldValue.serverTimestamp(),
        laatsteAantal: aantal,
        laatsteFout: FieldValue.delete(),
      }, { merge: true });
    } catch (e){
      await doc.ref.set({
        laatsteSync: FieldValue.serverTimestamp(),
        laatsteFout: String(e.message || e).slice(0, 200),
      }, { merge: true });
    }
  }
  return { totaalWedstrijden };
}

/* Handmatige sync — aangeroepen vanuit de knop "Sync nu alle teams" in club.js. */
exports.syncNu = onCall(
  { region: REGIO, cors: true },
  async (request) => {
    if (!request.auth){
      throw new HttpsError('unauthenticated', 'Log in om te synchroniseren.');
    }
    const clubId = request.data?.clubId;
    if (!clubId){
      throw new HttpsError('invalid-argument', 'clubId ontbreekt.');
    }
    try {
      return await syncClub(String(clubId));
    } catch (e){
      console.error('[syncNu] mislukt', e);
      throw new HttpsError('internal', String(e.message || e));
    }
  }
);

/* Nachtelijke sync — elke dag om 03:30 Europe/Amsterdam, alle clubs. */
exports.syncVoetbalNl = onSchedule(
  { region: REGIO, schedule: '30 3 * * *', timeZone: 'Europe/Amsterdam' },
  async () => {
    const db = getFirestore();
    const clubs = await db.collection('clubs').get();
    for (const c of clubs.docs){
      try {
        const { totaalWedstrijden } = await syncClub(c.id);
        console.log(`[syncVoetbalNl] club ${c.id}: ${totaalWedstrijden} wedstrijden`);
      } catch (e){
        console.error(`[syncVoetbalNl] club ${c.id} mislukt:`, e);
      }
    }
  }
);
