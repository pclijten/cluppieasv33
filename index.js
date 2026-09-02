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

/* ==================== 3. GEBRUIKSSTATISTIEK-AGGREGATIE ====================
   Rolt navpaden (+ de gebruik-tellers) op tot ÉÉN samenvattingsdocument per club:
   gebruikstats/{clubId}. Handmatig aangeroepen via de sync-knop in de Inzicht-
   subhub (club.js). Het dashboard, de in-app rapporten en de export lezen daarna
   alleen dit ene document i.p.v. de hele navpaden-collectie — snel en goedkoop,
   ook als navpaden over het seizoen groeit.

   AVG: dit betreft coach-gedrag (welk scherm wanneer), nooit spelergegevens.  */

// Nederlandse tijd: zomer (laatste zo maart t/m laatste zo oktober) = UTC+2, anders +1.
function nlOffsetMs(epochMs){
  const d = new Date(epochMs);
  const jaar = d.getUTCFullYear();
  const laatsteZondag = (maand) => {
    const l = new Date(Date.UTC(jaar, maand + 1, 0));
    return new Date(Date.UTC(jaar, maand, l.getUTCDate() - ((l.getUTCDay() + 7) % 7)));
  };
  const zomer = d >= laatsteZondag(2) && d < laatsteZondag(9);
  return (zomer ? 2 : 1) * 3600 * 1000;
}

const STAT_MAX_MS = 10 * 60 * 1000;   // > 10 min = app op achtergrond, negeren
const STAT_MIN_MS = 300;              // < 0,3 s = doorklik/rerender, negeren

function statPct(arr, p){
  if (!arr.length) return 0;
  const s = [...arr].sort((a, b) => a - b);
  const i = (s.length - 1) * p, lo = Math.floor(i), hi = Math.ceil(i);
  return lo === hi ? s[lo] : s[lo] + (s[hi] - s[lo]) * (i - lo);
}
const statSom = (arr) => arr.reduce((a, b) => a + b, 0);

function statCategorie(s){
  if (['team:hub', 'club:hub', 'teams'].includes(s)) return 'Navigatie';
  if (/training/.test(s)) return 'Trainingen';
  if (/^wedstrijd/.test(s) || ['team:preswedstrijd', 'team:wedstrijden', 'team:poule'].includes(s)) return 'Wedstrijden';
  if (['spelerprofiel', 'team:spelers', 'team:evaluatie', 'team:stats', 'team:leerlijnoverzicht', 'team:historie'].includes(s)) return 'Spelers';
  if (['team:videos', 'team:documenten'].includes(s)) return 'Media';
  if (/^club/.test(s)) return 'Clubbeheer';
  return 'Overig';
}
function statProfiel(cat){
  const inh = ['Trainingen', 'Wedstrijden', 'Spelers', 'Media', 'Clubbeheer', 'Overig']
    .reduce((a, k) => a + (cat[k] || 0), 0) || 1;
  const tr = (cat.Trainingen || 0) / inh, we = (cat.Wedstrijden || 0) / inh;
  if (tr >= 0.5) return 'Trainingsgericht';
  if (we >= 0.5) return 'Wedstrijdgericht';
  if (tr + we >= 0.6) return 'Training & wedstrijd';
  return 'Breed gebruik';
}

exports.aggregeerGebruik = onCall(
  { region: REGIO, cors: true, timeoutSeconds: 300, memory: '512MiB' },
  async (request) => {
    if (!request.auth){
      throw new HttpsError('unauthenticated', 'Log in om te synchroniseren.');
    }
    const clubId = request.data?.clubId;
    if (!clubId){
      throw new HttpsError('invalid-argument', 'clubId ontbreekt.');
    }

    const db = getFirestore();

    // Teamnamen + trainingsdagen ophalen via de club.teams-map (zelfde model als syncClub).
    const teamNamen = new Map();
    const teamDagen = new Map();
    try {
      const clubSnap = await db.collection('clubs').doc(String(clubId)).get();
      const teamIds = Object.keys(clubSnap.data()?.teams || {});
      await Promise.all(teamIds.map(async (tid) => {
        const t = await db.collection('teams').doc(tid).get();
        const x = t.data();
        if (x?.naam) teamNamen.set(tid, x.naam);
        if (Array.isArray(x?.trainingsdagen)) teamDagen.set(tid, x.trainingsdagen.slice().sort((a, b) => a - b));
      }));
    } catch (e){
      console.warn('[aggregeerGebruik] teams ophalen mislukt:', e.message);
    }

    // Coach-namen (optioneel, voor de beheerders-weergave).
    const coachNaam = new Map();
    try {
      const g = await db.collection('gebruikers').get();
      g.forEach(d => { const x = d.data(); if (x?.naam) coachNaam.set(d.id, x.naam); });
    } catch (e){ /* namen optioneel */ }

    // navpaden voor deze club.
    const snap = await db.collection('navpaden').where('clubId', '==', String(clubId)).get();

    const perScherm = new Map(), perTeam = new Map(), perGebruiker = new Map();
    const dag = new Array(7).fill(0);
    const dagTeams = Array.from({ length: 7 }, () => new Set());
    const uur = new Array(24).fill(0);
    const heatmap = new Array(7 * 24).fill(0);   // plat: index = dag*24 + uur (Firestore staat geen geneste arrays toe)
    const voorb = { zelf: 0, dag1: 0, dag2: 0, dag3: 0, dag4plus: 0, uur: new Array(24).fill(0), och: 0, mid: 0, avo: 0 };
    const wed = { opstelling: 0, live: 0, aanwezigheid: 0, liveDag: new Array(7).fill(0), liveUur: new Array(24).fill(0) };
    let sessies = 0, weergaves = 0, genegeerd = 0, datumMin = null, datumMax = null;

    snap.forEach(docSnap => {
      const d = docSnap.data();
      const stappen = Array.isArray(d.stappen) ? d.stappen : [];
      if (stappen.length < 2) return;
      stappen.sort((a, b) => (a.t || 0) - (b.t || 0));
      sessies++;
      const tid = d.teamId || '';
      const datum = d.datum || '';
      if (datum){ if (!datumMin || datum < datumMin) datumMin = datum; if (!datumMax || datum > datumMax) datumMax = datum; }

      if (!perGebruiker.has(d.uid)) perGebruiker.set(d.uid, { tijden: [], sessies: new Set() });
      perGebruiker.get(d.uid).sessies.add(d.sid || docSnap.id);
      if (!perTeam.has(tid)) perTeam.set(tid, { tijden: [], sessies: new Set(), coaches: new Set(), scherm: new Map() });
      const gt = perTeam.get(tid);
      gt.sessies.add(d.sid || docSnap.id); gt.coaches.add(d.uid);

      for (let i = 0; i < stappen.length - 1; i++){
        const scherm = stappen[i].s;
        const duur = (stappen[i + 1].t || 0) - (stappen[i].t || 0);
        weergaves++;
        if (duur < STAT_MIN_MS || duur > STAT_MAX_MS){ genegeerd++; continue; }
        if (!perScherm.has(scherm)) perScherm.set(scherm, []);
        perScherm.get(scherm).push(duur);
        perGebruiker.get(d.uid).tijden.push(duur);
        gt.tijden.push(duur);
        if (!gt.scherm.has(scherm)) gt.scherm.set(scherm, []);
        gt.scherm.get(scherm).push(duur);
      }

      const start = typeof d.start === 'number' ? d.start : null;
      if (start){
        for (const st of stappen){
          const nl = new Date(start + (st.t || 0) + nlOffsetMs(start + (st.t || 0)));
          const wd = (nl.getUTCDay() + 6) % 7, u = nl.getUTCHours();
          dag[wd]++; dagTeams[wd].add(tid); uur[u]++; heatmap[wd * 24 + u]++;

          if (st.s === 'team:trainingen'){
            const dagen = teamDagen.get(tid);
            if (dagen && dagen.length){
              const vandaag = wd + 1;
              let best = 99;
              for (const td of dagen){ let diff = td - vandaag; if (diff < 0) diff += 7; if (diff < best) best = diff; }
              if (best === 0) voorb.zelf++; else if (best === 1) voorb.dag1++;
              else if (best === 2) voorb.dag2++; else if (best === 3) voorb.dag3++; else voorb.dag4plus++;
            }
            voorb.uur[u]++;
            if (u >= 6 && u < 12) voorb.och++; else if (u >= 12 && u < 17) voorb.mid++; else if (u >= 17 && u < 23) voorb.avo++;
          }
          if (st.s === 'wedstrijd:opstelling') wed.opstelling++;
          else if (st.s === 'team:preswedstrijd') wed.aanwezigheid++;
          else if (/^wedstrijd:kwart/.test(st.s)){ wed.live++; wed.liveDag[wd]++; wed.liveUur[u]++; }
        }
      }
    });

    const paginas = [...perScherm.entries()].map(([s, t]) => ({
      s, n: t.length,
      med: Math.round(statPct(t, 0.50)), p25: Math.round(statPct(t, 0.25)),
      p75: Math.round(statPct(t, 0.75)), p90: Math.round(statPct(t, 0.90)),
      gem: Math.round(statSom(t) / t.length), tot: Math.round(statSom(t)),
    })).sort((a, b) => b.tot - a.tot);

    const teams = [...perTeam.entries()].map(([tid, gt]) => {
      const cat = {};
      for (const [s, t] of gt.scherm){ const c = statCategorie(s); cat[c] = (cat[c] || 0) + statSom(t); }
      Object.keys(cat).forEach(k => cat[k] = Math.round(cat[k]));
      return {
        teamId: tid, naam: teamNamen.get(tid) || (tid ? tid.slice(0, 8) : '(geen team)'),
        coaches: gt.coaches.size, ses: gt.sessies.size, bezoeken: gt.tijden.length,
        tot: Math.round(statSom(gt.tijden)), med: Math.round(statPct(gt.tijden, 0.50)),
        cat, profiel: statProfiel(cat),
      };
    }).filter(t => t.teamId).sort((a, b) => b.ses - a.ses);

    const coaches = [...perGebruiker.entries()].map(([u, gu]) => ({
      uid: u, naam: coachNaam.get(u) || null,
      ses: gu.sessies.size, n: gu.tijden.length, tot: Math.round(statSom(gu.tijden)),
    })).sort((a, b) => b.tot - a.tot);

    // events uit de gebruik-collectie (functie-tellers).
    const events = {};
    try {
      const gSnap = await db.collection('gebruik').where('clubId', '==', String(clubId)).get();
      gSnap.forEach(docSnap => {
        const tell = docSnap.data()?.tellingen || {};
        for (const [ev, n] of Object.entries(tell)) events[ev] = (events[ev] || 0) + (typeof n === 'number' ? n : 0);
      });
    } catch (e){ /* events optioneel */ }

    const dagenGemeten = (datumMin && datumMax)
      ? Math.round((new Date(datumMax) - new Date(datumMin)) / 86400000) + 1 : 0;

    const resultaat = {
      clubId: String(clubId),
      gegenereerd: new Date().toISOString(),
      periodeVan: datumMin, periodeTot: datumMax, dagenGemeten,
      bron: { sessies, schermweergaves: weergaves, genegeerd, coaches: perGebruiker.size, teams: teams.length },
      paginas, teams, coaches,
      dag, dagTeams: dagTeams.map(s => s.size), uur, heatmap,
      voorbereiding: {
        zelf: voorb.zelf, dag1: voorb.dag1, dag2: voorb.dag2, dag3: voorb.dag3, dag4plus: voorb.dag4plus,
        uur: voorb.uur, dagdeel: { och: voorb.och, mid: voorb.mid, avo: voorb.avo },
      },
      wedstrijd: {
        opstelling_n: wed.opstelling, live_n: wed.live, aanwezigheid_n: wed.aanwezigheid,
        liveDag: wed.liveDag, liveUur: wed.liveUur,
      },
      events,
      bijgewerkt: FieldValue.serverTimestamp(),
    };

    await db.collection('gebruikstats').doc(String(clubId)).set(resultaat);

    return { ok: true, sessies, dagen: dagenGemeten, teams: teams.length, coaches: perGebruiker.size, gegenereerd: resultaat.gegenereerd };
  }
);

/* ==================== 4. SPORTLINK CLUB.DATASERVICE-SYNC ====================
   Vervangt de oude iCal-token-sync. Haalt nu voor de HELE club data op bij de
   Sportlink Club.Dataservice REST-API (één client_id per club), en verdeelt die
   over de teams:

     • Eigen wedstrijden  → teams/{teamId}/wedstrijden   (voor opstellingen)
     • Poulestand + alle  → teams/{teamId}/poule/stand
       uitslagen v/d poule   teams/{teamId}/poule/uitslagen   (aparte "Meer"-tegel)

   API-contract (uit de officiële Club.Dataservice, zie support.sportlink.nl):
     Basis   : https://data.sportlink.com/{endpoint}?client_id={CLIENT_ID}
     programma?aantaldagen=..&eigenwedstrijden=ja&sorteervolgorde=datum-team-tijd
     uitslagen?aantaldagen=..&eigenwedstrijden=ja
     poulestand?poulecode=..
   Antwoord = JSON-array van objecten. Veldnamen zijn Nederlands en volgen exact
   de API (thuisteam, uitteam, wedstrijddatum, aanvangstijd, uitslag, thuisteamclubrelatiecode,
   poulecode, klassepoule, wedstrijdcode, thuisteamid, uitteamid, …).

   Firestore-model:
     clubs/{clubId}                     → { sportlinkClientId, huidigSeizoen }
     clubs/{clubId}/geheim/{teamId}     → { laatsteSync, laatsteAantal, laatsteFout,
                                            sportlinkTeamcode?, poulecode? }  (cache)
     teams/{teamId}                     → { naam }  (wordt met de Sportlink-naam gematcht)
     teams/{teamId}/wedstrijden/{id}    → wedstrijd-document (merge, opstelling blijft)
     teams/{teamId}/poule/stand         → { rijen[], klassepoule, bijgewerkt }
     teams/{teamId}/poule/uitslagen     → { rijen[], bijgewerkt }

   Team-matching (meest robuuste optie, gekozen):
     De club-feed bevat álle ASV'33-teams. We normaliseren de Cluppie-teamnaam
     ("JO11-2" → "jo112") en matchen die tegen de ASV'33-kant van elke
     programma-/uitslagregel. Zo is geen handmatige teamcode nodig en overleeft
     het schrijfvarianten. De gevonden teamcode + poulecode cachen we per team.

   AVG: dit betreft uitsluitend club-/wedstrijd-/standdata (geen spelersnamen van
   minderjarigen), dus geen taalmodel en geen privacygevoelige velden.
   =========================================================================== */

const SPORTLINK_BASIS = 'https://data.sportlink.com';
/* Hoe ver vooruit/terug het programma/uitslagen opgehaald worden (dagen). */
const PROGRAMMA_DAGEN = 120;
const UITSLAGEN_DAGEN  = 120;
/* Eigen club-herkenning in teamnamen (voor thuis/uit + matching). */
const EIGEN_CLUB_RE = /asv['’`]?\s*33/i;

/* --- generieke helpers ------------------------------------------------- */

/* Normaliseert een naam tot vergelijkbare sleutel: lowercase, alleen a-z0-9. */
function normSleutel(s){
  return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
}

/* Normaliseert de teamaanduiding binnen een clubnaam tot een vergelijkbare
   sleutel, ONAFHANKELIJK van hoe de leeftijdscategorie geschreven is. Cluppie/
   KNVB schrijft "JO11-2" of "ASV JO11-3"; Sportlink schrijft "ASV'33 O11-2" en
   soms met suffix "O8-1JM". Meiden houden een aparte 'm'-vlag zodat MO15 nooit
   met O15 matcht.
     "ASV JO11-3"      → "o11-3"
     "ASV'33 O8-1JM"   → "o8-1"
     "ASV'33 MO15-1"   → "mo15-1"
     "ASV'33 2"        → "sen2"   (senioren/reserve-elftal) */
function teamSleutel(naam){
  let s = String(naam || '').toLowerCase();
  s = s.replace(EIGEN_CLUB_RE, ' ');          // eigen club "ASV'33" eruit
  s = s.replace(/\basv\b/g, ' ');             // los "asv" (app schrijft "ASV JO11-3")
  // (M)(J)O<leeftijd>-<nummer> met optioneel JM/J/M-suffix (jongens-markering).
  const m = s.match(/\b(m)?j?o\s*(\d{1,2})\s*[-\s]\s*(\d+)\s*(?:jm|j|m)?\b/i);
  if (m){
    const meiden = m[1] ? 'm' : '';
    return meiden + 'o' + m[2] + '-' + m[3];
  }
  // Senioren/reserve-elftallen: "ASV'33 2" → "sen2".
  const sr = s.match(/\b(\d{1,2})\b/);
  if (sr) return 'sen' + sr[1];
  return s.replace(/[^a-z0-9]+/g, '');
}

/* Is dit een ASV'33-team (bevat het eigen clubvoorvoegsel)? */
function isEigenClub(naam){
  return EIGEN_CLUB_RE.test(String(naam || ''));
}

/* Datum "DD-MM-YYYY" of "YYYY-MM-DD" (Sportlink levert doorgaans DD-MM-YYYY)
   → genormaliseerd "YYYY-MM-DD". Geeft null bij onbruikbare invoer. */
function normDatum(d){
  const s = String(d || '').trim();
  let m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = /^(\d{2})-(\d{2})-(\d{4})/.exec(s);
  if (m) return `${m[3]}-${m[2]}-${m[1]}`;
  return null;
}

/* Tijd "HH:MM(:SS)" → "HH:MM"; leeg/ongeldig → null. */
function normTijd(t){
  const m = /^(\d{1,2}):(\d{2})/.exec(String(t || '').trim());
  if (!m) return null;
  return `${String(m[1]).padStart(2, '0')}:${m[2]}`;
}

/* Parseert een uitslag-string "3 - 1" / "3-1" naar {voor,tegen} vanuit het
   perspectief van de THUISploeg. Geeft null als er (nog) geen uitslag is. */
function parseUitslag(u){
  const m = /(\d+)\s*[-–]\s*(\d+)/.exec(String(u || ''));
  if (!m) return null;
  return { thuisDoelpunten: Number(m[1]), uitDoelpunten: Number(m[2]) };
}

/* Roept een Club.Dataservice-endpoint aan en geeft een JSON-array terug.
   Gooit bij netwerk-/statusfouten; lege/onbekende body → []. */
async function sportlinkCall(clientId, endpoint, params = {}){
  const qs = new URLSearchParams({ client_id: clientId, ...params }).toString();
  const url = `${SPORTLINK_BASIS}/${endpoint}?${qs}`;
  const resp = await fetch(url, {
    headers: { 'User-Agent': 'Cluppie/1.0', 'Accept': 'application/json, text/plain, */*' },
  });
  if (!resp.ok) throw new Error(`Sportlink gaf status ${resp.status} op ${endpoint}`);
  const tekst = await resp.text();
  if (!tekst.trim()) return [];
  let data;
  try { data = JSON.parse(tekst); }
  catch { throw new Error(`Sportlink gaf geen geldige JSON op ${endpoint}`); }
  return Array.isArray(data) ? data : (data ? [data] : []);
}

/* Haalt de echte poulecode op via wedstrijd-informatie. Het programma-antwoord
   bevat die niet (alleen een volgnummer in 'poule'), maar poulestand/uitslagen
   hebben de unieke poulecode nodig. */
async function poulecodeVoorWedstrijd(clientId, wedstrijdcode){
  if (!wedstrijdcode) return null;
  try {
    const info = await sportlinkCall(clientId, 'wedstrijd-informatie', { wedstrijdcode });
    // Antwoord kan een object of een array-met-één-object zijn.
    const eerste = Array.isArray(info) ? info[0] : info;
    const wi = eerste?.wedstrijdinformatie || eerste;
    const code = wi && (wi.poulecode || wi.pouleCode);
    return code ? String(code).trim() : null;
  } catch (e){
    console.warn(`[sync] poulecode-lookup ${wedstrijdcode} mislukt: ${e.message}`);
    return null;
  }
}

/* Uit één programma-/uitslagregel de thuis/uit-namen halen. De Club.Dataservice
   gebruikt niet overal identieke veldnamen; we proberen de gangbare varianten. */
function regelTeams(r){
  const thuis = r.thuisteam || r.teamThuis || r.thuis || '';
  const uit   = r.uitteam   || r.teamUit   || r.uit   || '';
  return { thuis: String(thuis).trim(), uit: String(uit).trim() };
}
function regelDatum(r){
  return normDatum(r.wedstrijddatum || r.datum || r.speeldatum || '');
}
function regelTijd(r){
  return normTijd(r.aanvangstijd || r.tijd || r.aanvang || '');
}

/* Stabiel document-ID voor een gesynchte wedstrijd. Bij voorkeur op de
   Sportlink-wedstrijdcode (uniek + blijvend), anders op datum+tegenstander. */
function wedstrijdDocId(r, tegenstander, datum){
  const code = String(r.wedstrijdcode || r.wedstrijdnummer || '').trim();
  if (code) return 'sl_' + code.replace(/[^A-Za-z0-9]+/g, '');
  return 'sl_' + normSleutel(datum + '_' + tegenstander).slice(0, 120);
}

/* =========================================================================
   syncTeam: verwerkt de al opgehaalde club-brede programma-/uitslagenlijsten
   voor één specifiek Cluppie-team.
   ========================================================================= */

/* Zoekt in de club-brede lijst de regels waarin dít team (ASV'33-kant) speelt.
   Geeft ook een representatieve wedstrijdcode terug van een REGULIERE
   competitiewedstrijd — daarmee halen we later de echte poulecode op via
   wedstrijd-informatie (het programma-antwoord zelf bevat geen poulecode, alleen
   een volgnummer in 'poule'). Bekerwedstrijden slaan we voor de poule over. */
function eigenRegels(regels, teamNaam){
  const doel = teamSleutel(teamNaam);
  const raak = [];
  let pouleWedstrijdcode = null;
  for (const r of regels){
    const { thuis, uit } = regelTeams(r);
    let kant = null;
    if (isEigenClub(thuis) && teamSleutel(thuis) === doel){ kant = 'thuis'; }
    else if (isEigenClub(uit) && teamSleutel(uit) === doel){ kant = 'uit'; }
    if (!kant) continue;
    if (!pouleWedstrijdcode && String(r.competitiesoort || '').toLowerCase() === 'regulier'){
      pouleWedstrijdcode = String(r.wedstrijdcode || '').trim() || null;
    }
    raak.push({ r, kant, thuis, uit });
  }
  return { raak, pouleWedstrijdcode };
}

/* Zet de eigen-programmaregels om naar wedstrijd-documenten (merge:true).
   Behoudt handmatig ingevulde velden (opstelling, kwarten, goals). */
async function schrijfEigenWedstrijden(db, teamId, eigen, seizoen){
  if (!eigen.length) return 0;
  const batch = db.batch();
  let aantal = 0;
  for (const { r, kant, thuis, uit } of eigen){
    const datum = regelDatum(r);
    if (!datum) continue;
    const thuisPloeg = kant === 'thuis';
    const tegenstander = (thuisPloeg ? uit : thuis) || 'Tegenstander';
    const docId = wedstrijdDocId(r, tegenstander, datum);

    const doc = {
      type: 'normaal',
      tegenstander,
      thuis: thuisPloeg,
      datum,
      aftrap: regelTijd(r),
      klasse: String(r.klassepoule || r.klasse || '').trim() || null,
      locatie: String(r.accommodatie || r.locatie || r.veld || '').trim() || null,
      seizoen,
      bron: 'sportlink',
      sportlinkCode: String(r.wedstrijdcode || r.wedstrijdnummer || '').trim() || null,
      // opzetGedaan bewust NIET zetten → normaliseerWedstrijd() vult format/kwarten
      // aan zodra de coach de wedstrijd opent.
    };
    // Uitslag mee-syncen als die er is (uit het uitslagen-endpoint kan die er al zijn).
    const u = parseUitslag(r.uitslag);
    if (u){
      const voor  = thuisPloeg ? u.thuisDoelpunten : u.uitDoelpunten;
      const tegen = thuisPloeg ? u.uitDoelpunten : u.thuisDoelpunten;
      doc.sportlinkUitslag = { voor, tegen };
    }

    const ref = db.collection('teams').doc(teamId).collection('wedstrijden').doc(docId);
    batch.set(ref, doc, { merge: true });
    aantal++;
  }
  await batch.commit();
  return aantal;
}

/* Zet de poulestand-array om naar nette rijen en schrijft teams/{id}/poule/stand.
   Markeert de eigen ploeg zodat de app die kan highlighten. */
function standRij(s, positie){
  const naam = String(s.team || s.teamnaam || s.naam || '').trim();
  const num = (v) => Number(String(v ?? '').replace(/[^\d-]/g, '')) || 0;
  return {
    positie: num(s.positie || s.rang || positie),
    team: naam,
    eigen: isEigenClub(naam),
    gespeeld:  num(s.gespeeld || s.aantalgespeeld || s.wedstrijden),
    gewonnen:  num(s.gewonnen || s.winst),
    gelijk:    num(s.gelijk || s.gelijkspel),
    verloren:  num(s.verloren || s.verlies),
    punten:    num(s.punten),
    voor:      num(s.doelpuntenvoor || s.voor),
    tegen:     num(s.doelpuntentegen || s.tegen),
    saldo:     num(s.doelsaldo ?? ((num(s.doelpuntenvoor||s.voor)) - (num(s.doelpuntentegen||s.tegen)))),
  };
}

async function schrijfPoule(db, teamId, poulecode, clientId){
  if (!poulecode) return null;
  let stand = [];
  try { stand = await sportlinkCall(clientId, 'poulestand', { poulecode }); }
  catch (e){ console.warn(`[sync] poulestand ${poulecode} mislukt: ${e.message}`); }

  if (stand.length){
    const rijen = stand
      .map((s, i) => standRij(s, i + 1))
      .sort((a, b) => a.positie - b.positie);
    const klassepoule = String(stand[0]?.klassepoule || stand[0]?.poule || '').trim() || null;
    await db.collection('teams').doc(teamId).collection('poule').doc('stand').set({
      rijen, klassepoule, poulecode,
      bijgewerkt: FieldValue.serverTimestamp(),
    }, { merge: true });
    // Geef de genormaliseerde teamnamen van deze poule terug. Daarmee kan het
    // poule-programma betrouwbaar tot deze poule gefilterd worden (het endpoint
    // zelf levert immers geen poulecode/klasse per regel).
    return new Set(rijen.map(r => normSleutel(r.team)).filter(Boolean));
  }
  return null;
}

/* Alle uitslagen binnen de poule (dus óók de overige teams) → poule/uitslagen. */
function pouleUitslagRij(r){
  const { thuis, uit } = regelTeams(r);
  const datum = regelDatum(r);
  const u = parseUitslag(r.uitslag);
  return {
    datum,
    tijd: regelTijd(r),
    thuis, uit,
    uitslag: u ? `${u.thuisDoelpunten}–${u.uitDoelpunten}` : null,
    eigenErin: isEigenClub(thuis) || isEigenClub(uit),
  };
}

async function schrijfPouleUitslagen(db, teamId, poulecode, pouleRegels, pouleTeams){
  if (!poulecode) return;
  // Met eigenwedstrijden=NEE kan de uitslagenlijst breder zijn dan één poule
  // (net als het programma-endpoint). Filter daarom op de poulestand-teams:
  // een wedstrijd hoort erbij als BEIDE teams in de poule zitten. Zonder
  // poulestand (pouleTeams leeg) val terug op alles, zodat de tab nooit leeg is.
  const inPoule = (r) => {
    if (!pouleTeams || !pouleTeams.size) return true;
    return pouleTeams.has(normSleutel(r.thuis)) && pouleTeams.has(normSleutel(r.uit));
  };
  const rijen = (pouleRegels || [])
    .map(pouleUitslagRij)
    .filter(r => r.datum && r.uitslag)
    .filter(inPoule)
    .sort((a, b) => (b.datum || '').localeCompare(a.datum || '') || (b.tijd || '').localeCompare(a.tijd || ''));
  await db.collection('teams').doc(teamId).collection('poule').doc('uitslagen').set({
    rijen, poulecode,
    bijgewerkt: FieldValue.serverTimestamp(),
  }, { merge: true });
}

/* =========================================================================
   POULE-PROGRAMMA (het volledige programma van de HELE poule, ook de andere
   clubs onderling, ook nog te spelen wedstrijden).

   Sleutel: de 'poule-programma'-service mét eigenwedstrijden=NEE geeft ALLE
   wedstrijden van de poule terug. Zonder die parameter (of met JA) krijg je
   alleen je eigen wedstrijden. Bewezen op de echte feed (aug 2026): 28 regels
   waarvan 21 onderlinge duels van andere clubs. Dit is dezelfde aanroep die
   o.a. de KNVB-widget en clubsites (Mariahout e.a.) gebruiken.

   De uitslagen komen apart via 'uitslagen?poulecode' en worden erin gemerged,
   omdat het programma-antwoord zelf geen score bevat.
   ========================================================================= */

/* Haalt het volledige poule-programma op (alle teams, alle ronden).
   We geven een expliciete startdatum (seizoensbegin) mee zodat óók de al
   gespeelde wedstrijden van de andere teams worden teruggegeven — zonder
   datumvan kijkt het endpoint alleen vooruit vanaf vandaag, waardoor eerdere
   speelronden van poulegenoten (met hun uitslag) ontbraken. */
async function heelPouleProgramma(clientId, poulecode){
  if (!poulecode) return [];
  // Startdatum: 1 juli van het lopende seizoen (een seizoen loopt jul→jun).
  const nu = new Date();
  const seizoenStartJaar = nu.getMonth() >= 6 ? nu.getFullYear() : nu.getFullYear() - 1;
  const datumvan = `${seizoenStartJaar}-07-01`;
  try {
    return await sportlinkCall(clientId, 'poule-programma', {
      poulecode, eigenwedstrijden: 'NEE', datumvan, aantaldagen: 400,
    });
  } catch (e){
    console.warn(`[sync] poule-programma ${poulecode} mislukt: ${e.message}`);
    return [];
  }
}

/* Eén poule-programmaregel → nette rij (zelfde vorm als de uitslagen-rijen).
   Het poule-programma-antwoord bevat voor ALLE pouleteams ook de score van al
   gespeelde wedstrijden (het uitslagen-endpoint geeft met eigenwedstrijden=NEE
   alleen de eigen club terug). We lezen de uitslag daarom hier rechtstreeks. */
function pouleProgrammaRij(r){
  const { thuis, uit } = regelTeams(r);
  const u = parseUitslag(r.uitslag);
  return {
    datum: regelDatum(r),
    tijd: regelTijd(r),
    thuis, uit,
    uitslag: u ? `${u.thuisDoelpunten}–${u.uitDoelpunten}` : null,
    eigenErin: isEigenClub(thuis) || isEigenClub(uit),
    wedstrijdcode: String(r.wedstrijdcode || r.wedstrijdnummer || '').trim() || null,
  };
}

/* Schrijft teams/{id}/poule/programma: het volledige poule-programma van dit
   team. Combineert het programma (toekomst + heden) met de al bekende
   poule-uitslagen (voor de scores van gespeelde wedstrijden).

   BELANGRIJK: de 'poule-programma'-service met eigenwedstrijden=NEE geeft in de
   praktijk ALLE verenigingswedstrijden terug (door meerdere poules heen) en
   levert geen poulecode/klasse per regel. We filteren daarom op de teamnamen uit
   de poulestand: een wedstrijd hoort bij deze poule als BEIDE teams in de poule
   zitten. `pouleTeams` is een Set van genormaliseerde teamnamen (uit schrijfPoule). */
async function schrijfPouleProgramma(db, teamId, poulecode, programmaRegels, pouleUitslagRegels, pouleTeams){
  const inPoule = (r) => {
    if (!pouleTeams || !pouleTeams.size) return null;      // geen filtersignaal
    const t = normSleutel(r.thuis), u = normSleutel(r.uit);
    return pouleTeams.has(t) && pouleTeams.has(u);
  };

  // 1) programmaregels (nog zonder score), gefilterd op de eigen poule.
  const alleProgramma = (programmaRegels || [])
    .map(pouleProgrammaRij)
    .filter(r => r.datum);
  const beslisbaar = alleProgramma.filter(r => inPoule(r) !== null);
  const uitProgramma = beslisbaar.length
    ? alleProgramma.filter(r => inPoule(r) === true)
    : alleProgramma;   // geen poulestand → val terug op alles (nooit lege tab)

  if (beslisbaar.length){
    console.log(`[sync] poule-programma team ${teamId}: ${alleProgramma.length} regels, ` +
      `${uitProgramma.length} in eigen poule (${alleProgramma.length - uitProgramma.length} weg), ` +
      `poulecode=${poulecode}`);
  } else {
    console.warn(`[sync] poule-programma team ${teamId}: geen poulestand-teams om op ` +
      `te filteren — ${alleProgramma.length} regels ongefilterd weggeschreven.`);
  }

  // 2) uitslagen van deze poule (leveren de scores voor gespeelde wedstrijden).
  //    Komen van 'uitslagen?poulecode=…' en zijn dus al poule-scoped; we passen
  //    voor de zekerheid dezelfde teamfilter toe.
  const uitUitslagen = (pouleUitslagRegels || [])
    .map(pouleUitslagRij)
    .filter(r => r.datum)
    .filter(r => inPoule(r) !== false);

  // 3) samenvoegen op natuurlijke sleutel (datum + genormaliseerde teams);
  //    een regel MET uitslag vult de score aan op de programmaregel.
  const sleutel = (r) => `${r.datum}__${normSleutel(r.thuis)}__${normSleutel(r.uit)}`;
  const merged = new Map();
  // eerst het programma (basis: datum, tijd, teams), dan uitslagen erin mergen
  for (const r of uitProgramma){
    if (!r.datum) continue;
    merged.set(sleutel(r), r);
  }
  for (const r of uitUitslagen){
    if (!r.datum) continue;
    const k = sleutel(r);
    const bestaand = merged.get(k);
    if (bestaand){
      // score toevoegen aan bestaande programmaregel
      if (r.uitslag) bestaand.uitslag = r.uitslag;
    } else {
      // uitslag zonder bijbehorende programmaregel (bv. al gespeeld en uit het
      // programma-venster gevallen) — als losse rij toevoegen
      merged.set(k, r);
    }
  }

  const rijen = [...merged.values()]
    .sort((a, b) => (a.datum || '').localeCompare(b.datum || '')
      || (a.tijd || '').localeCompare(b.tijd || ''));

  await db.collection('teams').doc(teamId).collection('poule').doc('programma').set({
    rijen, poulecode,
    bijgewerkt: FieldValue.serverTimestamp(),
  }, { merge: true });
}

/* =========================================================================
   syncClub: haalt de club-brede lijsten één keer op en verdeelt ze over de
   gekoppelde teams. "Gekoppeld" = er is een clubs/{clubId}/geheim/{teamId}-doc.
   ========================================================================= */
async function syncClub(clubId){
  const db = getFirestore();

  const clubSnap = await db.collection('clubs').doc(clubId).get();
  if (!clubSnap.exists) return { totaalWedstrijden: 0, teams: 0 };
  const club = clubSnap.data() || {};
  const clientId = club.sportlinkClientId || club.clientId || null;
  const seizoen  = club.huidigSeizoen || "2025/'26";

  // Geen client_id → deze club is niet (meer) via Club.Dataservice gekoppeld.
  if (!clientId) return { totaalWedstrijden: 0, teams: 0, geenClientId: true };

  // Eén keer per club: het volledige programma + alle uitslagen ophalen.
  // eigenwedstrijden=ja beperkt tot wedstrijden waarin een clubteam speelt,
  // maar de poulestand/-uitslagen halen we per poule apart (bevat ook anderen).
  const [programma, uitslagen] = await Promise.all([
    sportlinkCall(clientId, 'programma', {
      aantaldagen: PROGRAMMA_DAGEN, eigenwedstrijden: 'ja',
      sorteervolgorde: 'datum-team-tijd', weekoffset: 0,
    }).catch(e => { console.warn(`[sync] programma mislukt: ${e.message}`); return []; }),
    sportlinkCall(clientId, 'uitslagen', {
      aantaldagen: UITSLAGEN_DAGEN, eigenwedstrijden: 'ja',
    }).catch(e => { console.warn(`[sync] uitslagen mislukt: ${e.message}`); return []; }),
  ]);

  // Programma + uitslagen samenvoegen voor de eigen-wedstrijd-schrijfstap
  // (uitslagen leveren de score voor al gespeelde wedstrijden).
  const eigenBron = [...programma, ...uitslagen];

  // Voor de poule-uitslagen willen we ALLE poulewedstrijden (ook andere teams).
  // eigenwedstrijden=ja beperkt dat; daarom halen we per poule apart de volledige
  // uitslagen op (zie volledigePouleUitslagen hieronder).
  //
  // Sinds de Club.Dataservice-koppeling loopt de sync over ALLE teams van de club
  // (club.teams-map) — teams worden automatisch op naam gematcht, dus er is geen
  // per-team koppeling meer nodig. Het geheim-doc is nog slechts status/cache.
  const teamIds = Object.keys(club.teams || {});
  let totaalWedstrijden = 0;
  let teamsVerwerkt = 0;

  // poulecode → volledige uitslagenlijst (cache binnen deze run, 1 call per poule)
  const pouleUitslagenCache = new Map();
  async function volledigePouleUitslagen(poulecode){
    if (pouleUitslagenCache.has(poulecode)) return pouleUitslagenCache.get(poulecode);
    let lijst = [];
    try {
      // eigenwedstrijden=NEE: net als bij het poule-programma opent dit de
      // volledige poule (uitslagen van ALLE teams, niet alleen de eigen club).
      lijst = await sportlinkCall(clientId, 'uitslagen', {
        poulecode, eigenwedstrijden: 'NEE', aantaldagen: UITSLAGEN_DAGEN,
      });
    } catch (e){
      console.warn(`[sync] poule-uitslagen ${poulecode} mislukt: ${e.message}`);
    }
    pouleUitslagenCache.set(poulecode, lijst);
    return lijst;
  }

  for (const teamId of teamIds){
    const geheimRef = db.collection('clubs').doc(clubId).collection('geheim').doc(teamId);
    try {
      const teamSnap = await db.collection('teams').doc(teamId).get();
      if (!teamSnap.exists) continue;
      const teamNaam = teamSnap.data()?.naam || '';
      if (!teamNaam) continue;

      const { raak, pouleWedstrijdcode } = eigenRegels(eigenBron, teamNaam);

      // 1) eigen wedstrijden schrijven
      const aantal = await schrijfEigenWedstrijden(db, teamId, raak, seizoen);
      totaalWedstrijden += aantal;

      // 2) poule: eerst de echte poulecode ophalen (staat niet in het programma-
      //    antwoord), dan stand + alle uitslagen binnen die poule (ook andere teams).
      const poulecode = await poulecodeVoorWedstrijd(clientId, pouleWedstrijdcode);
      let pouleUitslagRegels = [];
      if (poulecode){
        // schrijfPoule geeft de set genormaliseerde teamnamen van deze poule
        // terug; die gebruiken we om het poule-programma tot deze poule te filteren.
        const pouleTeams = await schrijfPoule(db, teamId, poulecode, clientId);
        pouleUitslagRegels = await volledigePouleUitslagen(poulecode);
        await schrijfPouleUitslagen(db, teamId, poulecode, pouleUitslagRegels, pouleTeams);

        // 2b) poule-PROGRAMMA: het programma van de eigen poule (alle clubs
        //     onderling, ook nog te spelen). Via poule-programma met
        //     eigenwedstrijden=NEE; dit levert breder dan één poule en zonder
        //     poulecode per regel, daarom filtert schrijfPouleProgramma op de
        //     teamnamen uit de poulestand. Scores komen uit de uitslagen-merge.
        const programmaRegels = await heelPouleProgramma(clientId, poulecode);
        await schrijfPouleProgramma(db, teamId, poulecode, programmaRegels, pouleUitslagRegels, pouleTeams);
      }

      // 3) cache + statusregel (geheim-doc dient nog slechts als status/cache)
      await geheimRef.set({
        laatsteSync: FieldValue.serverTimestamp(),
        laatsteAantal: aantal,
        gematcht: raak.length > 0,
        poulecode: poulecode || FieldValue.delete(),
        laatsteFout: FieldValue.delete(),
      }, { merge: true });
      teamsVerwerkt++;
    } catch (e){
      await geheimRef.set({
        laatsteSync: FieldValue.serverTimestamp(),
        laatsteFout: String(e.message || e).slice(0, 200),
      }, { merge: true });
    }
  }
  return { totaalWedstrijden, teams: teamsVerwerkt };
}

/* Handmatige sync — knop "Sync nu alle teams" in club.js. */
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
        const { totaalWedstrijden, teams } = await syncClub(c.id);
        console.log(`[syncVoetbalNl] club ${c.id}: ${totaalWedstrijden} wedstrijden, ${teams} teams`);
      } catch (e){
        console.error(`[syncVoetbalNl] club ${c.id} mislukt:`, e);
      }
    }
  }
);
