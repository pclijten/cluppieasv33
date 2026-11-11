/* ==================== HANDLEIDING (help-tab) ====================
   Onderdeel van de teams.js-modulaire split. Puur statische help-tekst —
   geen Firestore/state-afhankelijkheden, dus geen imports nodig behalve
   wat hierboven al in dit bestand staat. De zoekfunctionaliteit
   (#helpZoek) wordt door de hub (teams.js/koppelTeamTab) aangesloten,
   want die werkt direct op het gerenderde DOM-element. */
import { onboardingHerstartBlok } from './onboarding.js?v=20261111c';

export function htmlHandleiding(){
  return `<div class="hl">
    ${onboardingHerstartBlok()}
    <div class="hl-zoekbalk">
      <span class="hl-zoek-ico"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><circle cx="10.5" cy="10.5" r="6.5"/><path d="M15.3 15.3 20 20"/></svg></span>
      <input type="search" id="helpZoek" class="hl-zoek-input" placeholder="Zoek in de handleiding…" autocomplete="off" autocapitalize="none" spellcheck="false">
      <button class="hl-zoek-wis" id="helpZoekWis" title="Wissen" aria-label="Wissen">✕</button>
    </div>
    <div class="hl-geen" id="helpGeen" hidden>Geen onderdeel gevonden voor <b id="helpGeenTerm"></b>. Probeer een ander woord.</div>

    <div class="hl-hoofdstukken" id="helpHoofdstukken">
      ${[['starten','Starten'],['plannen','Trainen & plannen'],['wedstrijddag','Op de wedstrijddag'],['club','Club & team beheren'],['beoordelen','Beoordelen & evalueren'],['tips','Tips & privacy']]
        .map(([id,naam]) => `<button data-hlh="${id}">${naam}</button>`).join('')}
    </div>

    <h4 class="hl-hoofdstuk" id="hlh-starten">Starten</h4>
    <section class="hl-sec" data-zoek="welkom bij cluppie een app om voor je voetbalteam de opstelling te maken, wissels te beheren, speeltijd eerlijk te verdelen en de wedstrijd te loggen. alles werkt realtime, dus collega-coaches zien direct dezelfde informatie.">
    <h3>Welkom bij Cluppie</h3>
    <p>Een app om voor je voetbalteam de opstelling te maken, wissels te beheren, speeltijd eerlijk te verdelen en de wedstrijd te loggen. Alles werkt realtime, dus collega-coaches zien direct dezelfde informatie.</p>
    </section>

    <section class="hl-sec" data-zoek="de eerste keer inloggen je hoeft niets te installeren. je opent de app gewoon in je browser en logt in op de manier die jij prettig vindt: met google: één tik en je bent binnen. met e-mail en wachtwoord: vul je e-mailadres en een zelfgekozen wachtwoord in. bestaat je account nog niet? dan wordt het automatisch aangemaakt. de volgende keer kom je met diezelfde gegevens direct terug als dezelfde coach. wachtwoord vergeten? tik op "wachtwoord vergeten?" onder de inlogknop, je krijgt dan een mailtje om een nieuw wachtwoord in te stellen.">
    <h3><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><rect x="4.6" y="10.4" width="14.8" height="9.8" rx="2.4"/><path d="M8 10.4V8a4 4 0 0 1 8 0v2.4"/><circle cx="12" cy="15.2" r="1.4" fill="currentColor" stroke="none"/></svg> De eerste keer inloggen</h3>
    <p>Je hoeft niets te installeren. Je opent de app gewoon in je browser en logt in op de manier die jij prettig vindt:</p>
    <ul>
      <li><b>Met Google</b>: één tik en je bent binnen.</li>
      <li><b>Met e-mail en wachtwoord</b>: vul je e-mailadres en een zelfgekozen wachtwoord in. Bestaat je account nog niet? Dan wordt het automatisch aangemaakt. De volgende keer kom je met diezelfde gegevens direct terug als dezelfde coach.</li>
    </ul>
    <div class="tip"><b>Wachtwoord vergeten?</b> Tik op "Wachtwoord vergeten?" onder de inlogknop, je krijgt dan een mailtje om een nieuw wachtwoord in te stellen.</div>
    </section>

    <section class="hl-sec" data-zoek="aansluiten bij je team je coach of de clubbeheerder stuurt je een persoonlijke uitnodigingslink (vaak via whatsapp). zo werkt het: tik op de link. je ziet een welkomstscherm met de naam van je team. log in (google of e-mail), en je zit meteen in het juiste team. geen link gekregen? vraag je coach om de teamcode (bijv. asvjo11-1) en vul die in op het inlogscherm.">
    <h3><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><circle cx="17.8" cy="6" r="2.6"/><circle cx="6.2" cy="12" r="2.6"/><circle cx="17.8" cy="18" r="2.6"/><path d="M15.4 7.2 8.6 10.8"/><path d="M8.6 13.2 15.4 16.8"/></svg> Aansluiten bij je team</h3>
    <p>Je coach of de clubbeheerder stuurt je een <b>persoonlijke uitnodigingslink</b> (vaak via WhatsApp). Zo werkt het:</p>
    <ul>
      <li>Tik op de link. Je ziet een welkomstscherm met de naam van je team.</li>
      <li>Log in (Google of e-mail), en je zit meteen in het juiste team.</li>
      <li>Geen link gekregen? Vraag je coach om de <b>teamcode</b> (bijv. ASVJO11-1) en vul die in op het inlogscherm.</li>
    </ul>
    </section>

    <section class="hl-sec" data-zoek="zet de app op je beginscherm voor een echt app-gevoel: open het menu van je browser en kies "toevoegen aan beginscherm" . dan staat cluppie als icoontje tussen je apps en open je hem met één tik, geen browser meer nodig.">
    <h3>Zet de app op je beginscherm</h3>
    <p>Voor een echt app-gevoel: open het menu van je browser en kies <b>"Toevoegen aan beginscherm"</b>. Dan staat Cluppie als icoontje tussen je apps en open je hem met één tik, geen browser meer nodig.</p>
    </section>

    <h4 class="hl-hoofdstuk" id="hlh-plannen"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><rect x="3.5" y="5" width="17" height="15" rx="2.5"/><path d="M3.5 9.5h17M8 3v4M16 3v4"/><circle cx="12" cy="14.5" r="1.4" fill="currentColor" stroke="none"/></svg> Trainen &amp; plannen</h4>
    <section class="hl-sec" data-zoek="trainingen & video's onder het tabblad training vind je de oefenstof voor je team, gedeeld als pdf. onder video staan youtube-links met oefeningen of beelden. elke zondag worden hier de trainingen voor de komende week en eventuele video's klaargezet, kijk er dus aan het begin van de week even in. een rood stipje op het tabblad laat zien dat er iets nieuws is.">
    <h3><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M6.6 3.4h7L18.6 8.4v12.2h-12z"/><path d="M13.6 3.4V8.4h5"/></svg> Trainingen & <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><rect x="3" y="6" width="13" height="12" rx="2.2"/><path d="M16 10l5-3v10l-5-3z"/></svg> video's</h3>
    <p>Onder het tabblad <b>Training</b> vind je de oefenstof voor je team, gedeeld als PDF. Onder <b>Video</b> staan YouTube-links met oefeningen of beelden.</p>
    <div class="tip"><b>Elke zondag</b> worden hier de trainingen voor de komende week en eventuele video's klaargezet, kijk er dus aan het begin van de week even in. Een <b>rood stipje</b> op het tabblad laat zien dat er iets nieuws is.</div>
    </section>

    <section class="hl-sec" data-zoek="seizoensplanning het tabblad planning toont de hele seizoenskalender van je team in één lijst, per maand gegroepeerd. verleden maanden staan ingeklapt; de huidige en komende maanden staan open. echte wedstrijden uit voetbal.nl verschijnen hier automatisch met een-stip. de app haalt ze 's nachts op uit de officiële knvb-kalender, dus zodra de competitie-indeling bekend is staat alles klaar, thuis/uit, datum en tegenstander. op een dag met een echte wedstrijd wordt de algemene wd (wedstrijddag) onderdrukt, zodat je geen dubbele regels ziet. tik op een wedstrijd-regel om die wedstrijd direct te openen en de opstelling klaar te zetten. met de filterknoppen bovenaan ( alles , wedstrijden , speeldagen , beker , vrij ) bekijk je gericht één soort dag. + eigen dag : voeg zelf een toernooi, vriendschappelijke wedstrijd of vrije dag toe. die staat dan met een eigen markering tussen de officiële dagen. tip: verschijnen er nog geen wedstrijden? dan is de knvb-kalender voor jouw team nog niet gepubliceerd. zodra dat gebeurt, vullen ze zichzelf aan, je hoeft niets te doen.">
    <h3><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><rect x="3.5" y="5" width="17" height="15" rx="2.5"/><path d="M3.5 9.5h17M8 3v4M16 3v4"/><circle cx="12" cy="14.5" r="1.4" fill="currentColor" stroke="none"/></svg> Seizoensplanning</h3>
    <p>Het tabblad <b>Planning</b> toont de hele seizoenskalender van je team in één lijst, per maand gegroepeerd. Verleden maanden staan ingeklapt; de huidige en komende maanden staan open.</p>
    <ul>
      <li><b>Echte wedstrijden uit voetbal.nl</b> verschijnen hier automatisch met een <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><rect x="3.2" y="4.6" width="17.6" height="14.8" rx="2.4"/><path d="M12 4.6v14.8"/><circle cx="12" cy="12" r="2.8"/></svg>-stip. De app haalt ze 's nachts op uit de officiële KNVB-kalender, dus zodra de competitie-indeling bekend is staat alles klaar, thuis/uit, datum en tegenstander.</li>
      <li>Op een dag met een echte wedstrijd wordt de algemene <kbd>WD</kbd> (wedstrijddag) onderdrukt, zodat je geen dubbele regels ziet.</li>
      <li>Tik op een wedstrijd-regel om die wedstrijd direct te openen en de opstelling klaar te zetten.</li>
      <li>Met de filterknoppen bovenaan (<kbd>Alles</kbd>, <kbd>Wedstrijden</kbd>, <kbd>Speeldagen</kbd>, <kbd>Beker</kbd>, <kbd>Vrij</kbd>) bekijk je gericht één soort dag.</li>
      <li><b>+ Eigen dag</b>: voeg zelf een toernooi, vriendschappelijke wedstrijd of vrije dag toe. Die staat dan met een eigen markering tussen de officiële dagen.</li>
    </ul>
    <div class="tip"><b>Tip:</b> verschijnen er nog geen wedstrijden? Dan is de KNVB-kalender voor jouw team nog niet gepubliceerd. Zodra dat gebeurt, vullen ze zichzelf aan, je hoeft niets te doen.</div>
    </section>

    <section class="hl-sec" data-zoek="je eigen naam instellen onder team kun je via "mijn weergavenaam wijzigen" instellen hoe je in de coachlijst verschijnt. handig zodat je teamgenoten zien wie wie is.">
    <h3><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M15.4 4.8 19.2 8.6 9 18.8l-4 1.2 1.2-4z"/><path d="M13.4 6.8 17.2 10.6"/></svg> Je eigen naam instellen</h3>
    <p>Onder <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><circle cx="12" cy="12" r="3.1"/><path d="M12 3.2 13.6 5.4l2.6-.6 1 2.5 2.6.7-.5 2.6L21 12l-1.7 1.4.5 2.6-2.6.7-1 2.5-2.6-.6L12 20.8l-1.6-2.2-2.6.6-1-2.5-2.6-.7.5-2.6L3 12l1.7-1.4-.5-2.6 2.6-.7 1-2.5 2.6.6z"/></svg> <b>Team</b> kun je via <b>"Mijn weergavenaam wijzigen"</b> instellen hoe je in de coachlijst verschijnt. Handig zodat je teamgenoten zien wie wie is.</p>
    </section>

    <h4 class="hl-hoofdstuk" id="hlh-wedstrijddag"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><rect x="3.2" y="4.6" width="17.6" height="14.8" rx="2.4"/><path d="M12 4.6v14.8"/><circle cx="12" cy="12" r="2.8"/></svg> Op de wedstrijddag</h4>
    <section class="hl-sec" data-zoek="snel beginnen voeg je spelers toe onder het tabblad: naam en rugnummer is genoeg. maak een nieuwe wedstrijd aan onder. kies competitie of toernooi. sleep spelers van de bank naar het veld of tik ze aan en tik daarna een positie. start de klok ▶ zodra de wedstrijd begint. wissels tijdens het spel worden automatisch gelogd met tijdstip.">
    <h3>Snel beginnen</h3>
    <ul>
      <li>Voeg je <b>spelers</b> toe onder het tabblad <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M9.2 4.5 6 6.2v4l2.2-.7v10h7.6v-10l2.2.7v-4l-3.2-1.7a2.9 2.9 0 0 1-5.6 0z"/></svg>: naam en rugnummer is genoeg.</li>
      <li>Maak een <b>nieuwe wedstrijd</b> aan onder <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><rect x="5" y="4.5" width="14" height="16" rx="2.2"/><path d="M9 3.2h6v3H9z"/><path d="M8.8 11.4h6.4"/><path d="M8.8 15.4h4"/></svg>. Kies competitie of toernooi.</li>
      <li>Sleep spelers van de bank naar het veld of tik ze aan en tik daarna een positie.</li>
      <li>Start de klok ▶ zodra de wedstrijd begint. Wissels tijdens het spel worden automatisch gelogd met tijdstip.</li>
    </ul>
    </section>

    <section class="hl-sec" data-zoek="wedstrijd opzetten bij een gloednieuwe wedstrijd doorloop je automatisch vier korte stappen: aanvoerder, aantal spelers, speelwijze en wedstrijddoel. geen tijd of zin? tik op overslaan: alles is later nog aan te passen via wijzig opzet rechtsboven in het wedstrijdscherm.">
    <h3><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="3.5"/><circle cx="12" cy="12" r="0.6" fill="currentColor" stroke="none"/><path d="M12 3.5v3M12 17.5v3M3.5 12h3M17.5 12h3"/></svg> Wedstrijd opzetten</h3>
    <p>Bij een gloednieuwe wedstrijd doorloop je automatisch vier korte stappen: <b>aanvoerder</b>, <b>aantal spelers</b>, <b>speelwijze</b> en <b>wedstrijddoel</b>. Geen tijd of zin? Tik op <b>Overslaan</b>: alles is later nog aan te passen via <b>Wijzig opzet</b> rechtsboven in het wedstrijdscherm.</p>
    </section>

    <section class="hl-sec" data-zoek="spelers slepen & wisselen op het veld werk je met spelersbolletjes (de chips ): slepen : houd een speler vast en sleep hem naar een andere positie, een lege plek, of naar de bank. tikken : één tik selecteert (gele rand). tik daarna een doel om de speler daar neer te zetten. positie ruilen : sleep een veldspeler naar een andere veldspeler, ze wisselen van positie. loopt de klok? dan wordt elke bank→veld of veld→bank actie geregistreerd als wissel met tijdstip in het log. tip: de bank is gesorteerd op minste speeltijd, wie aan de beurt is, staat vooraan.">
    <h3><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><rect x="3.2" y="4.6" width="17.6" height="14.8" rx="2.4"/><path d="M12 4.6v14.8"/><circle cx="12" cy="12" r="2.8"/></svg> Spelers slepen & wisselen</h3>
    <p>Op het veld werk je met spelersbolletjes (de <b>chips</b>):</p>
    <ul>
      <li><b>Slepen</b>: houd een speler vast en sleep hem naar een andere positie, een lege plek, of naar de bank.</li>
      <li><b>Tikken</b>: één tik selecteert (gele rand). Tik daarna een doel om de speler daar neer te zetten.</li>
      <li><b>Positie ruilen</b>: sleep een veldspeler naar een andere veldspeler, ze wisselen van positie.</li>
      <li><b>Loopt de klok?</b> Dan wordt elke bank→veld of veld→bank actie geregistreerd als wissel met tijdstip in het log.</li>
    </ul>
    <div class="tip"><b>Tip:</b> de bank is gesorteerd op minste speeltijd, wie aan de beurt is, staat vooraan.</div>
    </section>

    <section class="hl-sec" data-zoek="stippen onder spelers onder elke chip verschijnen vanaf het tweede kwart kleine stippen, één per eerder kwart: groen = die periode gespeeld. rood = die periode op de bank. zo zie je in één oogopslag wie er nu echt aan de beurt is.">
    <h3>Stippen onder spelers</h3>
    <p>Onder elke chip verschijnen vanaf het tweede kwart kleine stippen, één per eerder kwart:</p>
    <ul>
      <li><b>Groen</b> = die periode gespeeld.</li>
      <li><b>Rood</b> = die periode op de bank.</li>
    </ul>
    <p>Zo zie je in één oogopslag wie er nu echt aan de beurt is.</p>
    </section>

    <section class="hl-sec" data-zoek="kwarten, helften & klok de app stelt het juiste aantal periodes en de speeltijd in op basis van de knvb-categorie van je team. tik op een periode-tab ( k1 , k2 ... of h1 , h2 ) om eraan te werken. de klok stopt automatisch op de maximale speeltijd, je kunt hem dus niet vergeten. open je een leeg kwart, dan wordt de eindopstelling van het vorige kwart automatisch overgenomen. met ↺ zet je de klok terug op nul; wissels blijven staan.">
    <h3><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><circle cx="12" cy="12" r="8.6"/><path d="M12 7.2V12l3.4 2.2"/></svg> Kwarten, helften & klok</h3>
    <ul>
      <li>De app stelt het juiste aantal periodes en de speeltijd in op basis van de KNVB-categorie van je team.</li>
      <li>Tik op een periode-tab (<kbd>K1</kbd>, <kbd>K2</kbd> ... of <kbd>H1</kbd>, <kbd>H2</kbd>) om eraan te werken.</li>
      <li>De klok stopt <b>automatisch</b> op de maximale speeltijd: je kunt hem dus niet vergeten.</li>
      <li>Open je een leeg kwart, dan wordt de eindopstelling van het vorige kwart automatisch overgenomen.</li>
      <li>Met ↺ zet je de klok terug op nul; wissels blijven staan.</li>
    </ul>
    </section>

    <section class="hl-sec" data-zoek="opstelling van vorige wedstrijd bij een nieuwe wedstrijd kun je de optie "begin met opstelling van vorige wedstrijd" aanvinken. het eerste kwart wordt dan gevuld met de startopstelling van je laatste wedstrijd in hetzelfde format, zo hoef je niet elke keer opnieuw te beginnen, en pas je alleen aan wie er deze keer ontbreekt.">
    <h3><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><rect x="5" y="4.5" width="14" height="16" rx="2.2"/><path d="M9 3.2h6v3H9z"/><path d="M8.8 11.4h6.4"/><path d="M8.8 15.4h4"/></svg> Opstelling van vorige wedstrijd</h3>
    <p>Bij een nieuwe wedstrijd kun je de optie <b>"Begin met opstelling van vorige wedstrijd"</b> aanvinken. Het eerste kwart wordt dan gevuld met de startopstelling van je laatste wedstrijd in hetzelfde format, zo hoef je niet elke keer opnieuw te beginnen, en pas je alleen aan wie er deze keer ontbreekt.</p>
    </section>

    <section class="hl-sec" data-zoek="↩︎ vorige confrontatie open je een wedstrijd tegen een tegenstander waar je dit seizoen al eens tegen speelde, dan verschijnt bovenin een regeltje "vorige keer:" met datum, thuis/uit en de uitslag (groen = gewonnen, rood = verloren, grijs = gelijk). tik erop om het paneel uit te klappen: je ziet de volledige uitslag en, als je die had ingevuld, het wedstrijddoel en je notitie van toen. met → bekijk deze wedstrijd spring je direct naar de oude wedstrijd om de opstelling van destijds terug te zien. slim: de naamvergelijking negeert hoofdletters, spaties en het eigen clubvoorvoegsel, zodat dezelfde tegenstander altijd herkend wordt, ook als de schrijfwijze net iets verschilt.">
    <h3>↩︎ Vorige confrontatie</h3>
    <p>Open je een wedstrijd tegen een tegenstander waar je dit seizoen al eens tegen speelde, dan verschijnt bovenin een regeltje <b>"Vorige keer:"</b> met datum, thuis/uit en de uitslag (groen = gewonnen, rood = verloren, grijs = gelijk).</p>
    <ul>
      <li>Tik erop om het paneel uit te klappen: je ziet de volledige uitslag en, als je die had ingevuld, het wedstrijddoel en je notitie van toen.</li>
      <li>Met <b>→ Bekijk deze wedstrijd</b> spring je direct naar de oude wedstrijd om de opstelling van destijds terug te zien.</li>
    </ul>
    <div class="tip"><b>Slim:</b> de naamvergelijking negeert hoofdletters, spaties en het eigen clubvoorvoegsel, zodat dezelfde tegenstander altijd herkend wordt, ook als de schrijfwijze net iets verschilt.</div>
    </section>

    <section class="hl-sec" data-zoek="wissels vooraf plannen onder het wisselvak staat + wissel plannen : kies wie erin, wie eruit en na hoeveel minuten. zodra de klok dat moment passeert, knippert de geplande wissel en trilt je telefoon. tik op ✓ om hem door te voeren. wie aan de beurt is minst gespeeld: in plaats van een vaste speler kun je bij erin kiezen voor wie aan de beurt is. de app brengt dan op het wisselmoment automatisch de speler met de minste speeltijd van de bank in, zodat de speeltijd eerlijk verdeeld blijft. in speeltijd deze wedstrijd zie je wat de speeltijd wordt als je geplande wissels doorgaan: ~6:00, met uit en in in dezelfde kleur per wissel. dit is alleen een verwachting en telt niet mee in de statistieken; met de schakelaar zet je hem uit.">
    <h3><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><rect x="3.5" y="5" width="17" height="15" rx="2.5"/><path d="M3.5 9.5h17M8 3v4M16 3v4"/><circle cx="12" cy="14.5" r="1.4" fill="currentColor" stroke="none"/></svg> Wissels vooraf plannen</h3>
    <p>Onder het wisselvak staat <b>+ Wissel plannen</b>: kies wie erin, wie eruit en na hoeveel minuten. Zodra de klok dat moment passeert, knippert de geplande wissel en trilt je telefoon. Tik op <kbd>✓</kbd> om hem door te voeren.</p>
    <div class="tip"><b>★ Wie aan de beurt is:</b> in plaats van een vaste speler kies je bij <b>Erin</b> voor <b>“wie aan de beurt is (minst gespeeld)”</b>. De app brengt dan op het wisselmoment automatisch de bankspeler met de minste speeltijd in, zo verdeel je de speeltijd eerlijk zonder vooraf te rekenen.</div>
    <p>In <b>Speeltijd deze wedstrijd</b> zie je wat de speeltijd wordt als je geplande wissels doorgaan: <i>~6:00</i>, met <b>uit</b> en <b>in</b> in dezelfde kleur per wissel. Dit is alleen een verwachting en telt niet mee in de statistieken; met de schakelaar zet je hem uit.</p>
    </section>

    <section class="hl-sec" data-zoek="doelpunten registreren & corrigeren tik op de-knop aan jouw kant van het scorebord en kies de speler die scoorde. tegendoelpunt: één tik op de andere-knop. verkeerd getikt? tik op het doelpunt in het gebeurtenissen-log. je kunt dan de juiste scorer kiezen, de kant omdraaien (voor ↔ tegen) of het doelpunt verwijderen. doelpunten verschijnen in het log en in de seizoenstatistieken (topscorer).">
    <h3><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><rect x="3.2" y="4.6" width="17.6" height="14.8" rx="2.4"/><path d="M12 4.6v14.8"/><circle cx="12" cy="12" r="2.8"/></svg> Doelpunten registreren & corrigeren</h3>
    <ul>
      <li>Tik op de <b><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><rect x="3.2" y="4.6" width="17.6" height="14.8" rx="2.4"/><path d="M12 4.6v14.8"/><circle cx="12" cy="12" r="2.8"/></svg>-knop</b> aan jouw kant van het scorebord en kies de speler die scoorde.</li>
      <li>Tegendoelpunt: één tik op de andere <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><rect x="3.2" y="4.6" width="17.6" height="14.8" rx="2.4"/><path d="M12 4.6v14.8"/><circle cx="12" cy="12" r="2.8"/></svg>-knop.</li>
      <li><b>Verkeerd getikt?</b> Tik op het doelpunt in het gebeurtenissen-log. Je kunt dan de juiste scorer kiezen, de kant omdraaien (voor ↔ tegen) of het doelpunt verwijderen.</li>
      <li>Doelpunten verschijnen in het log en in de seizoenstatistieken (topscorer).</li>
    </ul>
    </section>

    <section class="hl-sec" data-zoek="kaarten & straffen de gele knop bij de klok opent het kaartenmenu. kies de speler en het type: geel: waarschuwing. een tweede gele in dezelfde wedstrijd geeft automatisch rood . tijdstraf: 5 minuten voor pupillen (t/m jo/mo15), 10 minuten voor jo/mo16+ en senioren. rood: de speler wordt direct van het veld gehaald. verkeerde kaart? tik erop in het log om de speler te wijzigen of de kaart te verwijderen.">
    <h3><span class="kaartje geel" aria-hidden="true"></span> Kaarten & straffen</h3>
    <p>De gele knop bij de klok opent het kaartenmenu. Kies de speler en het type:</p>
    <ul>
      <li><b><span class="kaartje geel" aria-hidden="true"></span> Geel</b>: waarschuwing. Een tweede gele in dezelfde wedstrijd geeft <b>automatisch rood</b>.</li>
      <li><b><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><circle cx="12" cy="12" r="8.6"/><path d="M12 7.2V12l3.4 2.2"/></svg> Tijdstraf</b>: 5 minuten voor pupillen (t/m JO/MO15), 10 minuten voor JO/MO16+ en senioren.</li>
      <li><b><span class="kaartje rood" aria-hidden="true"></span> Rood</b>: de speler wordt direct van het veld gehaald.</li>
      <li>Verkeerde kaart? Tik erop in het log om de speler te wijzigen of de kaart te verwijderen.</li>
    </ul>
    </section>

    <section class="hl-sec" data-zoek="aanvoerder onder wijzig opzet in de wedstrijd kies je per wedstrijd de aanvoerder. hij krijgt een geel c -bandje op zijn shirt. in de statistieken zie je hoe vaak iemand aanvoerder is geweest, handig om te rouleren.">
    <h3>Aanvoerder</h3>
    <p>Onder <b>Wijzig opzet</b> in de wedstrijd kies je per wedstrijd de aanvoerder. Hij krijgt een geel <b>C</b>-bandje op zijn shirt. In de statistieken zie je hoe vaak iemand aanvoerder is geweest, handig om te rouleren.</p>
    </section>

    <section class="hl-sec" data-zoek="toernooien bij een nieuwe wedstrijd kies je toernooi . geef het aantal wedstrijden op en het aantal helften per wedstrijd. de tabs worden dan w1 , w2 ... de tegenstander per wedstrijd vul je in door op de naam in het scorebord te tikken (gestippeld onderstreept). op één scherm: alle wissels en speeltijden lopen over het hele toernooi door, zodat je in wedstrijd 4 ziet wie er bij wedstrijd 1, 2 en 3 al heeft gespeeld.">
    <h3><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M8.4 4h7.2v3.6a3.6 3.6 0 0 1-7.2 0z"/><path d="M8.4 5.4H5.8a2.4 2.4 0 0 0 2.6 3.2"/><path d="M15.6 5.4h2.6a2.4 2.4 0 0 1-2.6 3.2"/><path d="M12 11.2v3"/><path d="M9.2 19.8h5.6l-.7-3.6h-4.2z"/></svg> Toernooien</h3>
    <p>Bij een nieuwe wedstrijd kies je <b>Toernooi</b>. Geef het aantal wedstrijden op en het aantal helften per wedstrijd. De tabs worden dan <kbd>W1</kbd>, <kbd>W2</kbd> ... De tegenstander per wedstrijd vul je in door op de naam in het scorebord te tikken (gestippeld onderstreept).</p>
    <div class="tip"><b>Op één scherm:</b> alle wissels en speeltijden lopen over het hele toernooi door, zodat je in wedstrijd 4 ziet wie er bij wedstrijd 1, 2 en 3 al heeft gespeeld.</div>
    </section>

    <h4 class="hl-hoofdstuk" id="hlh-club"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M12 3 20 6.5V11c0 4.5-3.1 8.7-8 10-4.9-1.3-8-5.5-8-10V6.5z"/><circle cx="12" cy="10.4" r="2.1"/><path d="M8.8 16.2a3.6 3.6 0 0 1 6.4 0"/></svg> Club &amp; team beheren</h4>
    <section class="hl-sec" data-zoek="clubs & trainingen delen werk je als hoofdtrainer voor meerdere teams? maak op het startscherm een club aan. daarmee kun je: teams aanmaken die bij jouw club horen (de coaches ervan komen direct in het juiste team). pdf importeren : upload een pdf met de teamindeling en de app leest de teams en spelers automatisch uit. controleer in de preview, klik "aanmaken" en alle teams + spelers staan klaar. coaches uitnodigen met een persoonlijke link (via whatsapp), zodat ze niet eerst een teamcode hoeven te krijgen. met alle uitnodigingen krijg je in één overzicht alle links voor alle teams. pdf-trainingen uploaden en aangeven voor welke teams ze beschikbaar zijn. de trainers zien ze in het training-tabblad van hun team. met pas je de titel, week of de gekoppelde teams later aan, zonder het bestand opnieuw te uploaden. een stip op het training-tabblad waarschuwt coaches voor nieuwe, ongelezen trainingen.">
    <h3><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M12 3 20 6.5V11c0 4.5-3.1 8.7-8 10-4.9-1.3-8-5.5-8-10V6.5z"/><circle cx="12" cy="10.4" r="2.1"/><path d="M8.8 16.2a3.6 3.6 0 0 1 6.4 0"/></svg> Clubs & trainingen delen</h3>
    <p>Werk je als hoofdtrainer voor meerdere teams? Maak op het startscherm een <b>club</b> aan. Daarmee kun je:</p>
    <ul>
      <li>Teams aanmaken die bij jouw club horen (de coaches ervan komen direct in het juiste team).</li>
      <li><b><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M12 3v12"/><path d="m7 10 5 5 5-5"/><path d="M5 21h14"/></svg> PDF importeren</b>: upload een PDF met de teamindeling en de app leest de teams en spelers automatisch uit. Controleer in de preview, klik "Aanmaken" en alle teams + spelers staan klaar.</li>
      <li>Coaches uitnodigen met een persoonlijke link (via WhatsApp), zodat ze niet eerst een teamcode hoeven te krijgen. Met <b><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><circle cx="17.8" cy="6" r="2.6"/><circle cx="6.2" cy="12" r="2.6"/><circle cx="17.8" cy="18" r="2.6"/><path d="M15.4 7.2 8.6 10.8"/><path d="M8.6 13.2 15.4 16.8"/></svg> Alle uitnodigingen</b> krijg je in één overzicht alle links voor alle teams.</li>
      <li>PDF-trainingen uploaden en aangeven voor welke teams ze beschikbaar zijn. De trainers zien ze in het <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M6.6 3.4h7L18.6 8.4v12.2h-12z"/><path d="M13.6 3.4V8.4h5"/></svg> Training-tabblad van hun team. Met <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M15.4 4.8 19.2 8.6 9 18.8l-4 1.2 1.2-4z"/><path d="M13.4 6.8 17.2 10.6"/></svg> pas je de titel, week of de gekoppelde teams later aan, zonder het bestand opnieuw te uploaden.</li>
      <li>Een stip op het training-tabblad waarschuwt coaches voor nieuwe, ongelezen trainingen.</li>
    </ul>
    </section>

    <section class="hl-sec" data-zoek="meerdere coaches & rommel opruimen onder team vind je de teamcode (bijv. asvjo11-1) en de lijst coaches . deel de code of een uitnodigingslink met collega-coaches: ze openen de link en loggen in met hun e-mailadres of google. daarna zitten ze direct in het team, en komen ze later met dezelfde login terug als dezelfde coach. staat er iemand verkeerd of dubbel in de lijst? tik op het naast een coach om die te verwijderen uit het team. wijzigingen lopen realtime door: handig als de assistent-coach langs de lijn de wissels bijhoudt en de hoofdcoach de score.">
    <h3><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><circle cx="9" cy="8" r="2.8"/><path d="M3.5 19a5.5 5.5 0 0 1 11 0"/><circle cx="17" cy="8.5" r="2.3"/><path d="M15.5 13.4A4.8 4.8 0 0 1 20.5 18"/></svg> Meerdere coaches & rommel opruimen</h3>
    <p>Onder <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><circle cx="12" cy="12" r="3.1"/><path d="M12 3.2 13.6 5.4l2.6-.6 1 2.5 2.6.7-.5 2.6L21 12l-1.7 1.4.5 2.6-2.6.7-1 2.5-2.6-.6L12 20.8l-1.6-2.2-2.6.6-1-2.5-2.6-.7.5-2.6L3 12l1.7-1.4-.5-2.6 2.6-.7 1-2.5 2.6.6z"/></svg> <b>Team</b> vind je de <b>teamcode</b> (bijv. ASVJO11-1) en de lijst <b>coaches</b>. Deel de code of een uitnodigingslink met collega-coaches:</p>
    <ul>
      <li>Ze openen de link en loggen in met hun e-mailadres of Google. Daarna zitten ze direct in het team, en komen ze later met dezelfde login terug als dezelfde coach.</li>
      <li>Staat er iemand verkeerd of dubbel in de lijst? Tik op het <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M5.4 7.4h13.2"/><path d="M7.4 7.4 8.3 20h7.4l.9-12.6"/><path d="M9.6 4.4h4.8l.6 3H9z"/><path d="M10.6 11v5.4M13.4 11v5.4"/></svg> naast een coach om die te verwijderen uit het team.</li>
      <li>Wijzigingen lopen realtime door: handig als de assistent-coach langs de lijn de wissels bijhoudt en de hoofdcoach de score.</li>
    </ul>
    </section>

    <section class="hl-sec" data-zoek="format en formatie wijzigen onder wijzig opzet in een wedstrijd pas je het format (6×6, 8×8, 9×9, 11×11, 4×4) en de formatie aan. spelers blijven zoveel mogelijk op hun plek staan; slots die wegvallen worden netjes opgeschoond.">
    <h3>Format en formatie wijzigen</h3>
    <p>Onder <b>Wijzig opzet</b> in een wedstrijd pas je het format (6×6, 8×8, 9×9, 11×11, 4×4) en de formatie aan. Spelers blijven zoveel mogelijk op hun plek staan; slots die wegvallen worden netjes opgeschoond.</p>
    </section>

    <section class="hl-sec" data-zoek="statistieken onder vind je het seizoensoverzicht: speeltijd, doelpunten, aanvoerdersbeurten, keeperbeurten en kaarten per speler. sorteert vanzelf op meeste speeltijd.">
    <h3><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M4 19V10"/><path d="M11 19V5"/><path d="M18 19v-7"/></svg> Statistieken</h3>
    <p>Onder <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><circle cx="12" cy="12" r="8.6"/><path d="M12 7.2V12l3.4 2.2"/></svg> vind je het seizoensoverzicht: speeltijd, doelpunten, aanvoerdersbeurten, keeperbeurten en kaarten per speler. Sorteert vanzelf op meeste speeltijd.</p>
    </section>

    <h4 class="hl-hoofdstuk" id="hlh-beoordelen"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/></svg> Beoordelen &amp; evalueren</h4>
    <section class="hl-sec" data-zoek="spelers beoordelen per speler leg je de ontwikkeling vast. open een speler (tab spelers → tik op de speler) en je vindt daar het ontwikkelprofiel met twee manieren om te beoordelen: snel beoordelen: een paar tikken na een wedstrijd of training: een algemeen niveau plus optionele "opvallend"-tags. ideaal om er een gewoonte van te maken. volledige beoordeling: een periodieke, diepere meting op de vijf ontwikkeldomeinen. hieruit komt het ontwikkelprofiel met balkjes. de vijf domeinen (gebaseerd op het asv'33-jeugdbeleidsplan): techniek : balbeheersing, traptechniek, 1v1. tactiek : inzicht, positiespel, keuzes maken. fysiek : snelheid, actiesnelheid, duelkracht. mentaal : zelfvertrouwen, spelen onder weerstand. gedrag & beleving : inzet, teamgevoel, plezier. een score loopt van 1 (aandacht) via 3 (prima) tot 5 (uitblinker) . leerpunten (tab leerlijn in het profiel): concrete, observeerbare ontwikkeldoelen die over meerdere wedstrijden doorlopen. kies een domein (techniek, tactiek, fysiek, mentaal of gedrag) en eventueel een thema uit de leerlijn. vink ze af zodra ze beheerst zijn. de app stelt leerpunten voor die passen bij de leeftijd van het team. historie : een tijdlijn met al je eerdere beoordelingen. tik een item aan om het te bekijken of bij te werken. privacy: beoordelingen en leerpunten zijn coach-only . spelers en ouders zien deze nooit. verwijder je een speler, dan gaan zijn beoordelingen mee weg.">
    <h3><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><rect x="5" y="4.5" width="14" height="16" rx="2.2"/><path d="M9 3.2h6v3H9z"/><path d="M8.8 11.4h6.4"/><path d="M8.8 15.4h4"/></svg> Spelers beoordelen</h3>
    <p>Per speler leg je de ontwikkeling vast. Open een speler (tab <b>Spelers</b> → tik op de speler) en je vindt daar het ontwikkelprofiel met twee manieren om te beoordelen:</p>
    <ul>
      <li><b>Snel beoordelen</b>: een paar tikken na een wedstrijd of training: een algemeen niveau plus optionele "opvallend"-tags. Ideaal om er een gewoonte van te maken.</li>
      <li><b><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><rect x="5" y="4.5" width="14" height="16" rx="2.2"/><path d="M9 3.2h6v3H9z"/><path d="M8.8 11.4h6.4"/><path d="M8.8 15.4h4"/></svg> Volledige beoordeling</b>: een periodieke, diepere meting op de vijf ontwikkeldomeinen. Hieruit komt het ontwikkelprofiel met balkjes.</li>
    </ul>
    <p>De vijf domeinen (gebaseerd op het ASV'33-jeugdbeleidsplan):</p>
    <ul>
      <li><b><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><rect x="3.2" y="4.6" width="17.6" height="14.8" rx="2.4"/><path d="M12 4.6v14.8"/><circle cx="12" cy="12" r="2.8"/></svg> Techniek</b>: balbeheersing, traptechniek, 1v1.</li>
      <li><b><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><circle cx="12" cy="12" r="3.2"/><path d="M12 4v2M12 18v2M4 12h2M18 12h2M6.3 6.3l1.5 1.5M16.2 16.2l1.5 1.5M17.7 6.3l-1.5 1.5M7.8 16.2l-1.5 1.5"/></svg> Tactiek</b>: inzicht, positiespel, keuzes maken.</li>
      <li><b>Fysiek</b>: snelheid, actiesnelheid, duelkracht.</li>
      <li><b><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M13 3 5 13h5l-1 8 8-10h-5l1-8Z"/></svg> Mentaal</b>: zelfvertrouwen, spelen onder weerstand.</li>
      <li><b><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="m11 6-5 4v5l3 2.5 3-2.5"/><path d="M13 7.5 16 6l4 4v4l-2.5 2"/><path d="M12 12.5 14 14M10 14l1.5 1.4M8.5 15.5l1.3 1.2"/></svg> Gedrag &amp; beleving</b>: inzet, teamgevoel, plezier.</li>
    </ul>
    <p>Een score loopt van <b>1 (Aandacht)</b> via <b>3 (Prima)</b> tot <b>5 (Uitblinker)</b>.</p>
    <ul>
      <li><b>Leerpunten</b> (tab Leerlijn in het profiel): concrete, observeerbare ontwikkeldoelen die over meerdere wedstrijden doorlopen. Kies bij het toevoegen een <b>domein</b> (Techniek, Tactiek, Fysiek, Mentaal of Gedrag) en eventueel een thema uit de leerlijn. Vink ze af zodra ze beheerst zijn. De app stelt leerpunten voor die passen bij de leeftijd van het team.</li>
      <li><b>Historie</b>: een tijdlijn met al je eerdere beoordelingen. Tik een item aan om het te bekijken of bij te werken.</li>
    </ul>
    <div class="tip"><b>Privacy:</b> beoordelingen en leerpunten zijn <b>coach-only</b>. Spelers en ouders zien deze nooit. Verwijder je een speler, dan gaan zijn beoordelingen mee weg.</div>
    </section>

    <section class="hl-sec" data-zoek="team evalueren na de wedstrijd naast de beoordeling per speler kun je na elke wedstrijd ook het hele team evalueren. onderaan het wedstrijdscherm, onder het wedstrijdverslag, staat de knop team evalueren . al een keer ingevuld voor deze wedstrijd? dan heet de knop ✓ teamevaluatie bijwerken en pas je 'm gewoon aan. acht korte vragen, elk met dezelfde kleurbalk als bij spelers (1 aandacht t/m 5 uitblinker): inzet & concentratie, samenwerking & communicatie, taakuitvoering per linie, opbouw van achteruit, omschakeling bij balverlies/-winst, druk zetten & veroveren, spelplezier, coachbaarheid. daarna eventueel een paar tags aantikken (goede samenwerking, veel plezier, afspraken niet nagekomen, enzovoort) en twee optionele tekstvelden: wat ging het beste, en wat is het aandachtspunt voor de volgende training. drie tot vijf minuten werk, alles op één scherm, niets is verplicht behalve de acht kleurbalken.">
    <h3><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/></svg> Team evalueren na de wedstrijd</h3>
    <p>Naast de beoordeling per speler kun je na elke wedstrijd ook het <b>hele team</b> evalueren. Onderaan het wedstrijdscherm, onder het wedstrijdverslag, staat de knop <b><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/></svg> Team evalueren</b>.</p>
    <p>Al een keer ingevuld voor deze wedstrijd? Dan heet de knop <b>✓ Teamevaluatie bijwerken</b> en pas je 'm gewoon aan.</p>
    <p>Acht korte vragen, elk met dezelfde kleurbalk als bij spelers (1 Aandacht t/m 5 Uitblinker):</p>
    <ul>
      <li>Inzet &amp; concentratie</li>
      <li>Samenwerking &amp; communicatie</li>
      <li>Taakuitvoering per linie</li>
      <li>Opbouw van achteruit</li>
      <li>Omschakeling bij balverlies/-winst</li>
      <li>Druk zetten &amp; veroveren</li>
      <li>Spelplezier</li>
      <li>Coachbaarheid</li>
    </ul>
    <p>Daarna eventueel een paar <b>tags</b> aantikken (goede samenwerking, veel plezier, afspraken niet nagekomen, enzovoort) en twee optionele tekstvelden: <b>wat ging het beste</b>, en <b>wat is het aandachtspunt voor de volgende training</b>.</p>
    <div class="tip"><b>3–5 minuten werk:</b> alles staat op één scherm, tikken in plaats van typen. Niets is verplicht behalve de acht kleurbalken, de tags en tekstvelden mag je overslaan.</div>
    </section>

    <section class="hl-sec" data-zoek="teamevaluatie-dashboard bekijk je onder het tabblad stats , via het segment teamevaluatie naast spelers . vier onderdelen: groeicurve: een lijn met de gemiddelde teamontwikkelscore per wedstrijd, zodat je in één oogopslag ziet of het team groeit. categorieën: de acht onderdelen met hun gemiddelde over de laatste vijf wedstrijden, inclusief een pijltje omhoog, gelijk of omlaag. terugkerende aandachtspunten: automatisch signalen zodra hetzelfde onderdeel meerdere wedstrijden op rij het laagst scoort. voorgesteld trainingsthema: een suggestie voor de volgende training, gebaseerd op het onderdeel dat de meeste aandacht vraagt; sluit waar mogelijk aan bij een leercurve-thema uit het jeugdbeleidsplan. tip: na 1 evaluatie zie je alleen een cijfer, vanaf 2 verschijnt de lijn, en de terugkerende aandachtspunten worden pas zichtbaar na een paar wedstrijden, zo voorkom je dat één mindere wedstrijd meteen als patroon wordt gezien.">
    <h3><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M4 19V10"/><path d="M11 19V5"/><path d="M18 19v-7"/></svg> Teamevaluatie-dashboard lezen</h3>
    <p>Alle ingevulde teamevaluaties komen samen onder het tabblad <b>Stats</b>, via het segment <b><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/></svg> Teamevaluatie</b> naast Spelers. Vier onderdelen:</p>
    <ul>
      <li><b>Groeicurve</b>: een lijn met de gemiddelde teamontwikkelscore per wedstrijd, zodat je in één oogopslag ziet of het team groeit.</li>
      <li><b>Categorieën</b>: de acht onderdelen met hun gemiddelde over de laatste vijf wedstrijden, inclusief een pijltje ↗ ↘ → voor de trend.</li>
      <li><b>Terugkerende aandachtspunten</b>: verschijnt automatisch zodra hetzelfde onderdeel meerdere wedstrijden op rij het laagst scoort.</li>
      <li><b>Voorgesteld trainingsthema</b>: een suggestie voor de volgende training, gebaseerd op het onderdeel dat nu de meeste aandacht vraagt. Sluit waar mogelijk aan bij een leercurve-thema uit het jeugdbeleidsplan.</li>
    </ul>
    <div class="tip"><b>Even geduld bij de start:</b> na 1 evaluatie zie je alleen een cijfer, vanaf 2 verschijnt de lijn. De terugkerende aandachtspunten worden pas zichtbaar na een paar wedstrijden, zo voorkom je dat één mindere wedstrijd meteen als patroon wordt gezien.</div>
    </section>

    <h4 class="hl-hoofdstuk" id="hlh-tips"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><circle cx="12" cy="12" r="3.2"/><path d="M12 4v2M12 18v2M4 12h2M18 12h2M6.3 6.3l1.5 1.5M16.2 16.2l1.5 1.5M17.7 6.3l-1.5 1.5M7.8 16.2l-1.5 1.5"/></svg> Tips &amp; privacy</h4>
    <section class="hl-sec" data-zoek="praktische tips voeg de app als snelkoppeling op je startscherm toe (browsermenu → "toevoegen aan beginscherm") voor app-gevoel. werkt zonder problemen als de telefoon op slot gaat, de klok loopt door op de juiste tijd. slecht bereik langs de lijn? geen probleem: de app werkt offline door en synchroniseert je wijzigingen automatisch zodra er weer verbinding is. met een powerbank langs de lijn ben je verzekerd van een hele wedstrijd.">
    <h3><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><circle cx="12" cy="12" r="3.2"/><path d="M12 4v2M12 18v2M4 12h2M18 12h2M6.3 6.3l1.5 1.5M16.2 16.2l1.5 1.5M17.7 6.3l-1.5 1.5M7.8 16.2l-1.5 1.5"/></svg> Praktische tips</h3>
    <ul>
      <li>Voeg de app als <b>snelkoppeling op je startscherm</b> toe (browsermenu → "Toevoegen aan beginscherm") voor app-gevoel.</li>
      <li>Werkt zonder problemen als de telefoon op slot gaat, de klok loopt door op de juiste tijd.</li>
      <li><b>Slecht bereik langs de lijn?</b> Geen probleem: de app werkt offline door en synchroniseert je wijzigingen automatisch zodra er weer verbinding is.</li>
      <li>Met een powerbank langs de lijn ben je verzekerd van een hele wedstrijd.</li>
    </ul>
    </section>


    <section class="hl-sec" data-zoek="⇄ spelers uitlenen een speler laten meespelen of meetrainen bij een ander team van de club regelt de coördinator van de bouw. kies een wedstrijd voor één keer, of uitgebreid: wedstrijden, meetrainen of allebei, vanaf en tot een datum, een aantal wedstrijden of zelf aangevinkte wedstrijden, en per trainingsdag bij welk team. twee wedstrijden op één dag: de coördinator kiest allebei of één team. na de einddatum is de uitlening vanzelf voorbij. presentie: op dagen bij het eigen team vult de eigen trainer de presentie in, op dagen bij het andere team staat de speler grijs en telt hij niet mee. een uitgeleende speler staat meteen in de selectie van de wedstrijd. wijzigen, verlengen en beëindigen via bouw uitleningen.">
    <h3>⇄ Spelers uitlenen</h3>
    <p>Een speler laten meespelen of meetrainen bij een ander team van de club regelt de <b>coördinator van de bouw</b>, via Bouw › Uitleningen of het spelersprofiel.</p>
    <ul>
      <li><b>Eén wedstrijd</b>: kies de wedstrijd. Daarna is de uitlening vanzelf voorbij, terugzetten is niet nodig.</li>
      <li><b>Uitgebreid</b>: wedstrijden, meetrainen of allebei. Kies een einddatum, een aantal wedstrijden of vink de wedstrijden aan, en per trainingsdag bij welk team de speler traint.</li>
      <li>Spelen beide teams op dezelfde dag (bijv. 9:00 en 15:00)? Dan kiest de coördinator: allebei of één van de twee.</li>
      <li><b>Presentie</b>: op dagen bij het eigen team vult de eigen trainer de presentie gewoon in. Op dagen bij het andere team staat de speler grijs met dat team erbij en telt hij niet mee in de opkomst.</li>
      <li>Een uitgeleende speler staat meteen in de selectie van de wedstrijd, ook op het startscherm.</li>
      <li>De ontvangende coach ziet alleen <b>voornaam + voorletter</b>, de voorkeurspositie en de open leerpunten.</li>
    </ul>
    </section>

    <section class="hl-sec" data-zoek="privacy & namen cluppie gaat zorgvuldig om met de gegevens van (vaak minderjarige) spelers: in de app zie je standaard alleen voornamen . de achternaam wordt wél opgeslagen, maar nergens in de app getoond. de achternaam blijft binnen je eigen team en is alleen zichtbaar voor de coaches van dat team. leen je een speler uit, dan ziet de andere coach alleen de voorletter. beoordelingen en leerpunten zijn coach-only : spelers en ouders zien deze niet. verwijder je een speler, dan worden zijn gegevens (inclusief beoordelingen en leerpunten) verwijderd. deel gegevens uit spelersprofielen niet buiten het technisch kader. heb je vragen over privacy binnen de club? stem af met je hoofdcoach of clubbeheerder.">
    <h3><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><rect x="4.6" y="10.4" width="14.8" height="9.8" rx="2.4"/><path d="M8 10.4V8a4 4 0 0 1 8 0v2.4"/><circle cx="12" cy="15.2" r="1.4" fill="currentColor" stroke="none"/></svg> Privacy &amp; namen</h3>
    <p>Cluppie gaat zorgvuldig om met de gegevens van (vaak minderjarige) spelers:</p>
    <ul>
      <li>In de app zie je standaard alleen <b>voornamen</b>. De achternaam wordt wél opgeslagen, maar nergens in de app getoond.</li>
      <li>De achternaam blijft <b>binnen je eigen team</b> en is alleen zichtbaar voor de coaches van dat team. Leen je een speler uit, dan ziet de andere coach alleen de voorletter.</li>
      <li>Beoordelingen en leerpunten zijn <b>coach-only</b>: spelers en ouders zien deze niet.</li>
      <li>Verwijder je een speler, dan worden zijn gegevens (inclusief beoordelingen en leerpunten) verwijderd.</li>
    </ul>
    <div class="tip">Deel gegevens uit spelersprofielen niet buiten het technisch kader. Heb je vragen over privacy binnen de club? Stem af met je hoofdcoach of clubbeheerder.</div>

    
    </section>

    <section class="hl-sec" data-zoek="↩︎ navigeren & de terugknop de terugknop van je telefoon gaat binnen de app steeds één stap terug: van een sub-tabblad (planning, stand, documenten, stats, help) terug naar meer, en van de hoofdtabbladen terug naar de teamkeuze. een open venster of de wedstrijd sluit je er ook mee. je springt dus niet meer in één keer helemaal terug naar het teamkeuzescherm.">
    <h3>↩︎ Navigeren &amp; de terugknop</h3>
    <p>De <b>terugknop van je telefoon</b> gaat binnen de app steeds <b>één stap terug</b>:</p>
    <ul>
      <li>Vanuit een onderdeel onder <b>Meer</b> (Planning, Stand &amp; Poule, Documenten, Stats, Help) terug naar het <b>Meer</b>-menu.</li>
      <li>Een geopend venster of de wedstrijd sluit je er ook mee.</li>
      <li>Pas vanaf een hoofdtabblad ga je terug naar de <b>teamkeuze</b>, je springt dus niet meer in één keer helemaal terug.</li>
    </ul>
    </section>

    <p class="u-t-sm u-zacht u-tc" style="margin-top:20px;padding-top:var(--space-md);border-top:1px solid var(--hair)">
      Vragen of ideeën? Geef ze door aan je hoofdcoach.<br>Veel succes langs de lijn! <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><rect x="3.2" y="4.6" width="17.6" height="14.8" rx="2.4"/><path d="M12 4.6v14.8"/><circle cx="12" cy="12" r="2.8"/></svg>
    </p>
  </div>`;
}
