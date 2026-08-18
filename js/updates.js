// updates.js — "Updates" (changelog) voor coaches
// ================================================================
// Toont de volledige releasegeschiedenis van Cluppie op één plek,
// in coach-taal (geen technische details). Nieuwste bovenaan,
// gegroepeerd per maand. Puur statische inhoud — geen Firestore,
// geen externe imports — zodat dit bestand nooit een versie-bump
// van andere modules nodig heeft.
//
// Bij een nieuwe release: voeg bovenaan RELEASES een nieuw maand-blok
// toe (of een item aan het bovenste blok). Zet 'nieuw:true' op de paar
// items die je wilt uitlichten met een groene NIEUW-badge.
//
// Icoon-sleutels verwijzen naar ico() uit icons.js; valt een naam weg,
// dan tonen we een neutraal 'ster'-icoon.
// ================================================================

import { ico } from './icons.js?v=20260818c';

/* Elke release: { maand, tag?, items:[ [icoon, titel, categorie, nieuw, tekst], ... ] }
   - icoon:     naam uit icons.js (bv. 'wedstrijd', 'training', 'grafiek')
   - categorie: kort label rechtsboven de kaart (WEDSTRIJD, TRAINING, ...)
   - nieuw:     true → groene NIEUW-badge (spaarzaam gebruiken)
   - tekst:     coach-uitleg, 1–3 zinnen */
const RELEASES = [
  { maand: 'Augustus 2026', tag: 'Nieuwste', items: [
    ['instel', 'Lettergrootte zelf instellen', 'DESIGN', true,
      'Vind je de tekst te klein (of juist te groot)? Onder Meer \u2192 Instellingen \u2192 Weergave kies je nu zelf Klein, Normaal of Groot. De keuze geldt op je eigen toestel en wordt onthouden \u2014 handig als je langs de lijn snel iets wilt kunnen lezen.'],
    ['admin-edit', 'Overzichtelijker & sneller clubdashboard', 'DESIGN', true,
      'Het clubdashboard is opgeruimd: "Aandacht nodig" is nu inklapbaar met een teller, en de gebruiksstatistieken (app-gebruik, actiefste coaches, functiegebruik) zitten gebundeld onder rrn uitklapbare sectie onderaan. Zo blijft het overzicht bovenaan rustig. Daarnaast opent het dashboard merkbaar sneller, doordat het alleen nog de gegevens ophaalt die het betreffende tabblad echt nodig heeft.'],
     ['admin-edit', 'Nieuwe look & eigen iconen', 'DESIGN', true,
      'De hele app heeft een frissere, rustigere uitstraling gekregen: strakkere kaarten, een eigen icoonset in plaats van emoji, en duidelijkere koppen. De domeinkiezer (Techniek, Tactiek, Fysiek, Mentaal, Gedrag) heeft nu icoon + label in plaats van losse letters.'],
    ['football-match', 'AI-wedstrijdverslag', 'WEDSTRIJD', true,
      'Na afloop maakt de app automatisch een leesbaar wedstrijdverslag op basis van wat je hebt gelogd. Spelersnamen worden nooit naar het AI-model gestuurd — dat gebeurt volledig privacyproof (AVG); de namen worden pas bij jou in beeld weer ingevuld.'],
    ['football-substitution', 'Wisselreden vastleggen', 'WEDSTRIJD', true,
      'Bij een wissel kun je nu een reden aangeven (Blessure, Tactisch, Gedrag, Trainingsopkomst). Die zie je terug in het logboek en kun je later nog aanpassen.'],
    ['match-score', 'Slimmer scorebord & rotatie', 'WEDSTRIJD', false,
      'Het scorebord is overzichtelijker: doelknoppen en stand op één rij, teamnamen leesbaar eronder. Bij geplande wissels kun je kiezen voor "volgende in rotatie", zodat de speler met de minste speeltijd vooraan staat.'],
    ['training-video', 'Video\u2019s uploaden', 'TRAINING', false,
      'Naast YouTube-links kun je nu ook eigen videoclips (MP4) rechtstreeks in de app zetten. Handig voor korte eigen beelden bij een oefening.'],
    ['football-training', 'Oefenstof automatisch verwerkt', 'TRAINING', false,
      'Upload je een oefenstof-PDF, dan haalt de app de veldtekeningen eruit en zet de oefeningen om in een prettig scrollbaar schema voor langs het veld. De originele PDF blijft altijd bewaard.'],
    ['stats-bars', 'Speeltijd in percentages', 'STATS', false,
      'De teamstatistieken tonen speeltijd nu als percentage gespeeld en percentage reserve, zodat je in \u00e9\u00e9n oogopslag ziet of iedereen eerlijk aan bod komt. In het spelerprofiel blijven de exacte minuten zichtbaar.'],
    ['football-competition', 'Stand & Poule', 'SYNC', false,
      'Nieuw tabblad onder Meer: de actuele poulestand \u00e9n de uitslagen van \u00e1lle teams in je poule, automatisch bijgewerkt via de nachtelijke sync. Je eigen team staat gemarkeerd.'],
    ['planning-calendar', 'Wedstrijden uit voetbal.nl', 'SYNC', false,
      'De KNVB-kalender wordt \u2019s nachts opgehaald, dus zodra de competitie-indeling bekend is staan je wedstrijden (thuis/uit, datum, tegenstander) vanzelf klaar. Een sync-fout waardoor sommige teams geen wedstrijden zagen, is opgelost.'],
    ['stats-bars', 'Statistieken altijd zichtbaar', 'STATS', false,
      'De Stats-tegel is nu voor iedere coach beschikbaar. Zonder evaluatiemodule zie je de speeltijdverdeling; met module ook de cijfers.'],
    ['communication-chat', 'Hulpchat & vlottere start', 'ALGEMEEN', false,
      'Stel via de Hulpchat je vraag over de app en krijg direct antwoord. De app start nu met een net laadscherm in plaats van een zwart scherm, en de telefoon-terugknop gaat \u00e9\u00e9n tabblad terug in plaats van meteen naar het beginscherm.'],
  ]},

  { maand: 'Juli 2026', items: [
    ['communication-chat', 'Hulpchat: je vraagbaak in de app', 'ALGEMEEN', false,
      'Een ingebouwde assistent die je vragen over de app beantwoordt. Weet je even niet waar iets staat of hoe iets werkt? Tik op Hulpchat en je krijgt meteen uitleg, met een verwijzing naar de rondleiding als dat handiger is.'],
    ['football-tactics', 'Rondleiding voor nieuwe coaches', 'ALGEMEEN', false,
      'Een interactieve rondleiding die je stap voor stap door alle schermen leidt — van je team openen tot een wedstrijd draaien, spelers beoordelen en de planning bekijken. Later opnieuw te starten via Help.'],
    ['stats-bars', 'Teamevaluatie & dashboard', 'STATS', false,
      'Na een wedstrijd je team beoordelen op meerdere categorie\u00ebn, met een dashboard dat de groeicurve, aandachtspunten en een trainingsadvies laat zien. Op het startscherm verschijnt een herinnering voor wedstrijden die nog ge\u00ebvalueerd moeten worden.'],
    ['football-lineup', 'Wedstrijd-opzet in vier stappen', 'WEDSTRIJD', false,
      'Bij een nieuwe wedstrijd loop je automatisch vier korte stappen door: aanvoerder, aantal spelers, speelwijze en wedstrijddoel. Geen tijd? Overslaan kan altijd, en later aanpassen via "Wijzig opzet".'],
    ['football-tactics', 'ASV-kompas & leercurve', 'TRAINING', false,
      'Bovenaan de Training-tab verschijnt wekelijks een ASV-kompas-tip uit het jeugdbeleidsplan. Bij de leercurve-thema\u2019s en wedstrijddoelen kun je doortikken naar achtergrond en concrete oefentips per thema.'],
    ['planning-calendar', 'Seizoensplanning', 'PLANNING', false,
      'Het tabblad Planning toont de hele seizoenskalender per maand: offici\u00eble KNVB-speeldagen, je eigen wedstrijden en zelf toegevoegde dagen (toernooi, vriendschappelijk, vrij). Met filters per soort dag.'],
    ['training-favorite', 'Seizoenen', 'ALGEMEEN', false,
      'Alle wedstrijden, trainingen en beoordelingen worden nu per seizoen bewaard. Bij een nieuw seizoen blijft de historie netjes gescheiden, zodat je terug kunt kijken zonder dat het huidige beeld vertroebelt.'],
    ['football-substitution', 'Wissels plannen verfijnd', 'WEDSTRIJD', false,
      'Bij het vooraf plannen van meerdere wissels kan dezelfde speler niet meer dubbel gekozen worden. Ook is slepen op het veld vervangen door tikken, zodat je makkelijk kunt scrollen tijdens de wedstrijd.'],
    ['training-favorite', 'Altijd de nieuwste versie', 'ALGEMEEN', false,
      'Onder de motorkap zorgt een versiesysteem ervoor dat je na een update altijd de nieuwste versie in beeld krijgt — geen vastzittende oude schermen meer.'],
  ]},

  { maand: 'Juni 2026', tag: 'Start', items: [
    ['training-favorite', 'Cluppie is er!', 'ALGEMEEN', true,
      'De app werd geboren als hulpmiddel om langs de lijn je opstelling en wissels te beheren, en groeide uit tot Cluppie: \u00e9\u00e9n plek voor je hele team. Je installeert hem op je beginscherm en opent hem met \u00e9\u00e9n tik, ook zonder browser.'],
    ['football-match', 'Opstelling, klok & wissels', 'WEDSTRIJD', false,
      'Zet je spelers op het veld, start de wedstrijdklok per kwart of helft, en wissel tijdens het spel. Elke wissel wordt automatisch met tijdstip gelogd. De klok stopt vanzelf op de maximale speeltijd.'],
    ['match-score', 'Doelpunten & kaarten', 'WEDSTRIJD', false,
      'Registreer doelpunten met de maker, en kaarten of tijdstraffen volgens de KNVB-regels per leeftijdscategorie. Verkeerd getikt? Corrigeer het rechtstreeks in het gebeurtenissen-log.'],
    ['stats-bars', 'Speeltijd eerlijk verdeeld', 'STATS', false,
      'De app houdt per speler bij hoeveel die speelt en zet de bank op volgorde van minste speeltijd — zo zie je in \u00e9\u00e9n oogopslag wie aan de beurt is. Aan het eind maakt de app automatisch een wedstrijdverslag.'],
    ['team-members', 'Spelers & presentie', 'SPELERS', false,
      'Voeg spelers toe met naam en rugnummer, en houd de trainingsopkomst bij. Alles werkt realtime, dus collega-coaches zien direct dezelfde informatie.'],
    ['football-training', 'Oefenstof & video\u2019s', 'TRAINING', false,
      'Bekijk de oefenstof voor je team als PDF en vind onder Video de klaargezette clips. Een rood stipje laat zien wanneer er iets nieuws voor je klaarstaat.'],
    ['admin-document', 'Clublaag & uitnodigingen', 'ALGEMEEN', false,
      'Beheerders kunnen meerdere teams beheren, oefenstof verdelen, teams aanmaken en coaches uitnodigen via een persoonlijke link (handig via WhatsApp). De teamindeling kon zelfs uit een PDF worden ingelezen.'],
  ]},
];

/* Kleine helper: geef het ico() terug voor een naam, of een neutraal
   ster-icoon als de naam niet bestaat in icons.js. */
function relIco(naam){
  const svg = ico(naam, 18);
  // ico() geeft een lege string of een placeholder terug voor onbekende namen;
  // in dat geval vallen we terug op 'ster'.
  return (svg && svg.trim()) ? svg : ico('action-info', 18);
}

export function htmlUpdates(){
  const blokken = RELEASES.map(r => {
    const items = r.items.map(([icoon, titel, cat, nieuw, tekst]) => `
      <div class="upd-item${nieuw ? ' nieuw' : ''}">
        ${nieuw ? '<span class="upd-badge">NIEUW</span>' : ''}
        <div class="upd-kopregel">
          <div class="upd-ico">${relIco(icoon)}</div>
          <h3 class="upd-titel">${titel}</h3>
          <span class="upd-cat">${cat}</span>
        </div>
        <p class="upd-tekst">${tekst}</p>
      </div>`).join('');
    return `
      <div class="upd-maand">
        <span class="upd-datum">${r.maand}</span>
        ${r.tag ? `<span class="upd-tag">${r.tag}</span>` : ''}
        <span class="upd-lijn"></span>
      </div>
      ${items}`;
  }).join('');

  return `
    <div class="updates-wrap">
      <p class="upd-intro">De hele geschiedenis van Cluppie op \u00e9\u00e9n plek — van de allereerste versie tot de nieuwste functies. Nieuwste bovenaan. Je hoeft zelf niets te installeren; updates verschijnen vanzelf.</p>
      ${blokken}
    </div>`;
}
