/* ==================== CLUPPIE CLOUD FUNCTIONS ====================
   Regio: europe-west1 (zelfde als de rest van het project).

   Functies in dit bestand:
     • chatHulp          – hulp-chatbot: beantwoordt vragen over het GEBRUIK van
                           de app op basis van de handleiding-kennisbank. Kan aan
                           het eind naar een specifiek rondleiding-hoofdstuk
                           verwijzen met een [[TOUR:x]]-marker.
     • genereerVerslagAI – schrijft een levendig wedstrijdverslag op basis van
                           GEANONIMISEERDE wedstrijddata (labels "Speler 1" …).

   AVG / privacy:
     Er gaan NOOIT namen of andere herleidbare gegevens van (minderjarige)
     spelers naar het taalmodel. De client stuurt uitsluitend neutrale labels;
     de echte namen worden pas ná het antwoord, client-side, teruggezet.

   Kosten:
     Beide functies gebruiken Claude Haiku met prompt-caching op het vaste
     systeemdeel (kennisbank / instructies), zodat herhaalvragen goedkoop zijn.

   Secret:
     ANTHROPIC_API_KEY moet als Firebase-secret zijn gezet:
       firebase functions:secrets:set ANTHROPIC_API_KEY
   ================================================================ */

const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { defineSecret } = require('firebase-functions/params');
const { KENNIS_TEKST } = require('./kennis');

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
