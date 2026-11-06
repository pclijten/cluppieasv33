/* Voorstel voor de Cloud Function die de Nu-kaart gebruikt (js/doel-samenvatting.js).
   Plak dit in functions/index.js naast structureerTraining en pas de secret-naam,
   regio en het model aan zoals daar. Deploy met:
     firebase deploy --only functions:vatDoelenSamen
   (nooit --only functions: dat verwijdert andere functies).

   AVG: de client stuurt alleen de doelteksten uit de oefenstof. Geen namen,
   geen spelers, geen teamgegevens. */
const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { defineSecret } = require('firebase-functions/params');
const ANTHROPIC_KEY = defineSecret('ANTHROPIC_API_KEY');   // zelfde secret als structureerTraining

exports.vatDoelenSamen = onCall(
  { region: 'europe-west1', secrets: [ANTHROPIC_KEY], maxInstances: 5, timeoutSeconds: 30 },
  async (req) => {
    if (!req.auth) throw new HttpsError('unauthenticated', 'Inloggen vereist');
    const doelen = Array.isArray(req.data?.doelen) ? req.data.doelen : [];
    const schoon = doelen.map(d => String(d || '').trim().slice(0, 160)).filter(Boolean).slice(0, 12);
    if (schoon.length < 2) throw new HttpsError('invalid-argument', 'Minstens twee doelen');

    const antwoord = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': ANTHROPIC_KEY.value(), 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model: 'claude-haiku-4-5',                       // zelfde model als de andere functies
        max_tokens: 80,
        system: 'Je vat trainingsdoelen van een jeugdvoetbaltraining samen tot één allesomvattend doel. ' +
                'Schrijf maximaal één korte regel (circa 60 tekens, nooit meer dan 90), in het Nederlands, ' +
                'zonder punt aan het eind, zonder aanhalingstekens en zonder opsomming. Geef alleen die regel.',
        messages: [{ role: 'user', content: schoon.map(d => '- ' + d).join('\n') }],
      }),
    });
    if (!antwoord.ok) throw new HttpsError('unavailable', 'AI tijdelijk niet beschikbaar');
    const json = await antwoord.json();
    let tekst = String(json?.content?.[0]?.text || '').split('\n')[0].replace(/^["'\-•\s]+|["'.\s]+$/g, '').trim();
    if (tekst.length > 90) tekst = tekst.slice(0, 89).replace(/\s+\S*$/, '') + '…';
    if (!tekst) throw new HttpsError('internal', 'Lege samenvatting');
    return { tekst };
  });
