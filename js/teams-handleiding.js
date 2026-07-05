/* ==================== HANDLEIDING (help-tab) ====================
   Onderdeel van de teams.js-modulaire split. Puur statische help-tekst —
   geen Firestore/state-afhankelijkheden, dus geen imports nodig behalve
   wat hierboven al in dit bestand staat. De zoekfunctionaliteit
   (#helpZoek) wordt door de hub (teams.js/koppelTeamTab) aangesloten,
   want die werkt direct op het gerenderde DOM-element. */
export function htmlHandleiding(){
  return `<div class="hl">
    <div class="hl-zoekbalk">
      <span class="hl-zoek-ico">🔍</span>
      <input type="search" id="helpZoek" class="hl-zoek-input" placeholder="Zoek in de handleiding…" autocomplete="off" autocapitalize="none" spellcheck="false">
      <button class="hl-zoek-wis" id="helpZoekWis" title="Wissen" aria-label="Wissen">✕</button>
    </div>
    <div class="hl-geen" id="helpGeen" hidden>Geen onderdeel gevonden voor <b id="helpGeenTerm"></b>. Probeer een ander woord.</div>

    <div class="hl-hoofdstukken" id="helpHoofdstukken">
      ${[['starten','🚀 Starten'],['plannen','📅 Trainen & plannen'],['wedstrijddag','⚽ Op de wedstrijddag'],['club','🏛 Club & team beheren'],['beoordelen','📈 Beoordelen & evalueren'],['tips','💡 Tips & privacy']]
        .map(([id,naam]) => `<button data-hlh="${id}">${naam}</button>`).join('')}
    </div>

    <h4 class="hl-hoofdstuk" id="hlh-starten">🚀 Starten</h4>
    <section class="hl-sec" data-zoek="👋 welkom bij cluppie een app om voor je voetbalteam de opstelling te maken, wissels te beheren, speeltijd eerlijk te verdelen en de wedstrijd te loggen. alles werkt realtime, dus collega-coaches zien direct dezelfde informatie.">
    <h3>👋 Welkom bij Cluppie</h3>
    <p>Een app om voor je voetbalteam de opstelling te maken, wissels te beheren, speeltijd eerlijk te verdelen en de wedstrijd te loggen. Alles werkt realtime, dus collega-coaches zien direct dezelfde informatie.</p>
    </section>

    <section class="hl-sec" data-zoek="🔑 de eerste keer inloggen je hoeft niets te installeren. je opent de app gewoon in je browser en logt in op de manier die jij prettig vindt: met google — één tik en je bent binnen. met e-mail en wachtwoord — vul je e-mailadres en een zelfgekozen wachtwoord in. bestaat je account nog niet? dan wordt het automatisch aangemaakt. de volgende keer kom je met diezelfde gegevens direct terug als dezelfde coach. wachtwoord vergeten? tik op "wachtwoord vergeten?" onder de inlogknop — je krijgt dan een mailtje om een nieuw wachtwoord in te stellen.">
    <h3>🔑 De eerste keer inloggen</h3>
    <p>Je hoeft niets te installeren. Je opent de app gewoon in je browser en logt in op de manier die jij prettig vindt:</p>
    <ul>
      <li><b>Met Google</b> — één tik en je bent binnen.</li>
      <li><b>Met e-mail en wachtwoord</b> — vul je e-mailadres en een zelfgekozen wachtwoord in. Bestaat je account nog niet? Dan wordt het automatisch aangemaakt. De volgende keer kom je met diezelfde gegevens direct terug als dezelfde coach.</li>
    </ul>
    <div class="tip"><b>Wachtwoord vergeten?</b> Tik op "Wachtwoord vergeten?" onder de inlogknop — je krijgt dan een mailtje om een nieuw wachtwoord in te stellen.</div>
    </section>

    <section class="hl-sec" data-zoek="🔗 aansluiten bij je team je coach of de clubbeheerder stuurt je een persoonlijke uitnodigingslink (vaak via whatsapp). zo werkt het: tik op de link. je ziet een welkomstscherm met de naam van je team. log in (google of e-mail) — en je zit meteen in het juiste team. geen link gekregen? vraag je coach om de teamcode (bijv. asvjo11-1) en vul die in op het inlogscherm.">
    <h3>🔗 Aansluiten bij je team</h3>
    <p>Je coach of de clubbeheerder stuurt je een <b>persoonlijke uitnodigingslink</b> (vaak via WhatsApp). Zo werkt het:</p>
    <ul>
      <li>Tik op de link. Je ziet een welkomstscherm met de naam van je team.</li>
      <li>Log in (Google of e-mail) — en je zit meteen in het juiste team.</li>
      <li>Geen link gekregen? Vraag je coach om de <b>teamcode</b> (bijv. ASVJO11-1) en vul die in op het inlogscherm.</li>
    </ul>
    </section>

    <section class="hl-sec" data-zoek="📱 zet de app op je beginscherm voor een echt app-gevoel: open het menu van je browser en kies "toevoegen aan beginscherm" . dan staat cluppie als icoontje tussen je apps en open je hem met één tik — geen browser meer nodig.">
    <h3>📱 Zet de app op je beginscherm</h3>
    <p>Voor een echt app-gevoel: open het menu van je browser en kies <b>"Toevoegen aan beginscherm"</b>. Dan staat Cluppie als icoontje tussen je apps en open je hem met één tik — geen browser meer nodig.</p>
    </section>

    <h4 class="hl-hoofdstuk" id="hlh-plannen">📅 Trainen &amp; plannen</h4>
    <section class="hl-sec" data-zoek="📄 trainingen & 🎬 video's onder het tabblad training vind je de oefenstof voor je team, gedeeld als pdf. onder video staan youtube-links met oefeningen of beelden. elke zondag worden hier de trainingen voor de komende week en eventuele video's klaargezet — kijk er dus aan het begin van de week even in. een 🔴 rood stipje op het tabblad laat zien dat er iets nieuws is.">
    <h3>📄 Trainingen & 🎬 video's</h3>
    <p>Onder het tabblad <b>Training</b> vind je de oefenstof voor je team, gedeeld als PDF. Onder <b>Video</b> staan YouTube-links met oefeningen of beelden.</p>
    <div class="tip"><b>Elke zondag</b> worden hier de trainingen voor de komende week en eventuele video's klaargezet — kijk er dus aan het begin van de week even in. Een <b>🔴 rood stipje</b> op het tabblad laat zien dat er iets nieuws is.</div>
    </section>

    <section class="hl-sec" data-zoek="📅 seizoensplanning het tabblad planning toont de hele seizoenskalender van je team in één lijst, per maand gegroepeerd. verleden maanden staan ingeklapt; de huidige en komende maanden staan open. echte wedstrijden uit voetbal.nl verschijnen hier automatisch met een ⚽-stip. de app haalt ze 's nachts op uit de officiële knvb-kalender, dus zodra de competitie-indeling bekend is staat alles klaar — thuis/uit, datum en tegenstander. op een dag met een echte wedstrijd wordt de algemene wd (wedstrijddag) onderdrukt, zodat je geen dubbele regels ziet. tik op een wedstrijd-regel om die wedstrijd direct te openen en de opstelling klaar te zetten. met de filterknoppen bovenaan ( alles , wedstrijden , speeldagen , beker , vrij ) bekijk je gericht één soort dag. + eigen dag : voeg zelf een toernooi, vriendschappelijke wedstrijd of vrije dag toe. die staat dan met een eigen markering tussen de officiële dagen. tip: verschijnen er nog geen wedstrijden? dan is de knvb-kalender voor jouw team nog niet gepubliceerd. zodra dat gebeurt, vullen ze zichzelf aan — je hoeft niets te doen.">
    <h3>📅 Seizoensplanning</h3>
    <p>Het tabblad <b>Planning</b> toont de hele seizoenskalender van je team in één lijst, per maand gegroepeerd. Verleden maanden staan ingeklapt; de huidige en komende maanden staan open.</p>
    <ul>
      <li><b>Echte wedstrijden uit voetbal.nl</b> verschijnen hier automatisch met een ⚽-stip. De app haalt ze 's nachts op uit de officiële KNVB-kalender, dus zodra de competitie-indeling bekend is staat alles klaar — thuis/uit, datum en tegenstander.</li>
      <li>Op een dag met een echte wedstrijd wordt de algemene <kbd>WD</kbd> (wedstrijddag) onderdrukt, zodat je geen dubbele regels ziet.</li>
      <li>Tik op een wedstrijd-regel om die wedstrijd direct te openen en de opstelling klaar te zetten.</li>
      <li>Met de filterknoppen bovenaan (<kbd>Alles</kbd>, <kbd>Wedstrijden</kbd>, <kbd>Speeldagen</kbd>, <kbd>Beker</kbd>, <kbd>Vrij</kbd>) bekijk je gericht één soort dag.</li>
      <li><b>+ Eigen dag</b>: voeg zelf een toernooi, vriendschappelijke wedstrijd of vrije dag toe. Die staat dan met een eigen markering tussen de officiële dagen.</li>
    </ul>
    <div class="tip"><b>Tip:</b> verschijnen er nog geen wedstrijden? Dan is de KNVB-kalender voor jouw team nog niet gepubliceerd. Zodra dat gebeurt, vullen ze zichzelf aan — je hoeft niets te doen.</div>
    </section>

    <section class="hl-sec" data-zoek="✏️ je eigen naam instellen onder ⚙️ team kun je via "mijn weergavenaam wijzigen" instellen hoe je in de coachlijst verschijnt. handig zodat je teamgenoten zien wie wie is.">
    <h3>✏️ Je eigen naam instellen</h3>
    <p>Onder ⚙️ <b>Team</b> kun je via <b>"Mijn weergavenaam wijzigen"</b> instellen hoe je in de coachlijst verschijnt. Handig zodat je teamgenoten zien wie wie is.</p>
    </section>

    <h4 class="hl-hoofdstuk" id="hlh-wedstrijddag">⚽ Op de wedstrijddag</h4>
    <section class="hl-sec" data-zoek="🚀 snel beginnen voeg je spelers toe onder het tabblad 👕 — naam en rugnummer is genoeg. maak een nieuwe wedstrijd aan onder 📋. kies competitie of toernooi. sleep spelers van de bank naar het veld of tik ze aan en tik daarna een positie. start de klok ▶ zodra de wedstrijd begint. wissels tijdens het spel worden automatisch gelogd met tijdstip.">
    <h3>🚀 Snel beginnen</h3>
    <ul>
      <li>Voeg je <b>spelers</b> toe onder het tabblad 👕 — naam en rugnummer is genoeg.</li>
      <li>Maak een <b>nieuwe wedstrijd</b> aan onder 📋. Kies competitie of toernooi.</li>
      <li>Sleep spelers van de bank naar het veld of tik ze aan en tik daarna een positie.</li>
      <li>Start de klok ▶ zodra de wedstrijd begint. Wissels tijdens het spel worden automatisch gelogd met tijdstip.</li>
    </ul>
    </section>

    <section class="hl-sec" data-zoek="⚽ spelers slepen & wisselen op het veld werk je met spelersbolletjes (de chips ): slepen : houd een speler vast en sleep hem naar een andere positie, een lege plek, of naar de bank. tikken : één tik selecteert (gele rand). tik daarna een doel om de speler daar neer te zetten. positie ruilen : sleep een veldspeler naar een andere veldspeler — ze wisselen van positie. loopt de klok? dan wordt elke bank→veld of veld→bank actie geregistreerd als wissel met tijdstip in het log. tip: de bank is gesorteerd op minste speeltijd — wie aan de beurt is, staat vooraan.">
    <h3>⚽ Spelers slepen & wisselen</h3>
    <p>Op het veld werk je met spelersbolletjes (de <b>chips</b>):</p>
    <ul>
      <li><b>Slepen</b>: houd een speler vast en sleep hem naar een andere positie, een lege plek, of naar de bank.</li>
      <li><b>Tikken</b>: één tik selecteert (gele rand). Tik daarna een doel om de speler daar neer te zetten.</li>
      <li><b>Positie ruilen</b>: sleep een veldspeler naar een andere veldspeler — ze wisselen van positie.</li>
      <li><b>Loopt de klok?</b> Dan wordt elke bank→veld of veld→bank actie geregistreerd als wissel met tijdstip in het log.</li>
    </ul>
    <div class="tip"><b>Tip:</b> de bank is gesorteerd op minste speeltijd — wie aan de beurt is, staat vooraan.</div>
    </section>

    <section class="hl-sec" data-zoek="🟢 stippen onder spelers onder elke chip verschijnen vanaf het tweede kwart kleine stippen — één per eerder kwart: groen = die periode gespeeld. rood = die periode op de bank. zo zie je in één oogopslag wie er nu echt aan de beurt is.">
    <h3>🟢 Stippen onder spelers</h3>
    <p>Onder elke chip verschijnen vanaf het tweede kwart kleine stippen — één per eerder kwart:</p>
    <ul>
      <li><b>Groen</b> = die periode gespeeld.</li>
      <li><b>Rood</b> = die periode op de bank.</li>
    </ul>
    <p>Zo zie je in één oogopslag wie er nu echt aan de beurt is.</p>
    </section>

    <section class="hl-sec" data-zoek="⏱ kwarten, helften & klok de app stelt het juiste aantal periodes en de speeltijd in op basis van de knvb-categorie van je team. tik op een periode-tab ( k1 , k2 ... of h1 , h2 ) om eraan te werken. de klok stopt automatisch op de maximale speeltijd — je kunt hem dus niet vergeten. open je een leeg kwart, dan wordt de eindopstelling van het vorige kwart automatisch overgenomen. met ↺ zet je de klok terug op nul; wissels blijven staan.">
    <h3>⏱ Kwarten, helften & klok</h3>
    <ul>
      <li>De app stelt het juiste aantal periodes en de speeltijd in op basis van de KNVB-categorie van je team.</li>
      <li>Tik op een periode-tab (<kbd>K1</kbd>, <kbd>K2</kbd> ... of <kbd>H1</kbd>, <kbd>H2</kbd>) om eraan te werken.</li>
      <li>De klok stopt <b>automatisch</b> op de maximale speeltijd — je kunt hem dus niet vergeten.</li>
      <li>Open je een leeg kwart, dan wordt de eindopstelling van het vorige kwart automatisch overgenomen.</li>
      <li>Met ↺ zet je de klok terug op nul; wissels blijven staan.</li>
    </ul>
    </section>

    <section class="hl-sec" data-zoek="📋 opstelling van vorige wedstrijd bij een nieuwe wedstrijd kun je de optie "begin met opstelling van vorige wedstrijd" aanvinken. het eerste kwart wordt dan gevuld met de startopstelling van je laatste wedstrijd in hetzelfde format — zo hoef je niet elke keer opnieuw te beginnen, en pas je alleen aan wie er deze keer ontbreekt.">
    <h3>📋 Opstelling van vorige wedstrijd</h3>
    <p>Bij een nieuwe wedstrijd kun je de optie <b>"Begin met opstelling van vorige wedstrijd"</b> aanvinken. Het eerste kwart wordt dan gevuld met de startopstelling van je laatste wedstrijd in hetzelfde format — zo hoef je niet elke keer opnieuw te beginnen, en pas je alleen aan wie er deze keer ontbreekt.</p>
    </section>

    <section class="hl-sec" data-zoek="↩︎ vorige confrontatie open je een wedstrijd tegen een tegenstander waar je dit seizoen al eens tegen speelde, dan verschijnt bovenin een regeltje "vorige keer:" met datum, thuis/uit en de uitslag (groen = gewonnen, rood = verloren, grijs = gelijk). tik erop om het paneel uit te klappen: je ziet de volledige uitslag en — als je die had ingevuld — het wedstrijddoel en je notitie van toen. met → bekijk deze wedstrijd spring je direct naar de oude wedstrijd om de opstelling van destijds terug te zien. slim: de naamvergelijking negeert hoofdletters, spaties en het eigen clubvoorvoegsel, zodat dezelfde tegenstander altijd herkend wordt — ook als de schrijfwijze net iets verschilt.">
    <h3>↩︎ Vorige confrontatie</h3>
    <p>Open je een wedstrijd tegen een tegenstander waar je dit seizoen al eens tegen speelde, dan verschijnt bovenin een regeltje <b>"Vorige keer:"</b> met datum, thuis/uit en de uitslag (groen = gewonnen, rood = verloren, grijs = gelijk).</p>
    <ul>
      <li>Tik erop om het paneel uit te klappen: je ziet de volledige uitslag en — als je die had ingevuld — het wedstrijddoel en je notitie van toen.</li>
      <li>Met <b>→ Bekijk deze wedstrijd</b> spring je direct naar de oude wedstrijd om de opstelling van destijds terug te zien.</li>
    </ul>
    <div class="tip"><b>Slim:</b> de naamvergelijking negeert hoofdletters, spaties en het eigen clubvoorvoegsel, zodat dezelfde tegenstander altijd herkend wordt — ook als de schrijfwijze net iets verschilt.</div>
    </section>

    <section class="hl-sec" data-zoek="📅 wissels vooraf plannen onder het wisselvak staat + wissel plannen : kies wie erin, wie eruit en na hoeveel minuten. zodra de klok dat moment passeert, knippert de geplande wissel en trilt je telefoon. tik op ✓ om hem door te voeren.">
    <h3>📅 Wissels vooraf plannen</h3>
    <p>Onder het wisselvak staat <b>+ Wissel plannen</b>: kies wie erin, wie eruit en na hoeveel minuten. Zodra de klok dat moment passeert, knippert de geplande wissel en trilt je telefoon. Tik op <kbd>✓</kbd> om hem door te voeren.</p>
    </section>

    <section class="hl-sec" data-zoek="⚽ doelpunten registreren & corrigeren tik op de ⚽-knop aan jouw kant van het scorebord en kies de speler die scoorde. tegendoelpunt: één tik op de andere ⚽-knop. verkeerd getikt? tik op het doelpunt in het gebeurtenissen-log. je kunt dan de juiste scorer kiezen, de kant omdraaien (voor ↔ tegen) of het doelpunt verwijderen. doelpunten verschijnen in het log en in de seizoenstatistieken (topscorer).">
    <h3>⚽ Doelpunten registreren & corrigeren</h3>
    <ul>
      <li>Tik op de <b>⚽-knop</b> aan jouw kant van het scorebord en kies de speler die scoorde.</li>
      <li>Tegendoelpunt: één tik op de andere ⚽-knop.</li>
      <li><b>Verkeerd getikt?</b> Tik op het doelpunt in het gebeurtenissen-log. Je kunt dan de juiste scorer kiezen, de kant omdraaien (voor ↔ tegen) of het doelpunt verwijderen.</li>
      <li>Doelpunten verschijnen in het log en in de seizoenstatistieken (topscorer).</li>
    </ul>
    </section>

    <section class="hl-sec" data-zoek="🟨 kaarten & straffen de gele knop naast het scorebord opent het kaartenmenu. kies de speler en het type: 🟨 geel — waarschuwing. een tweede gele in dezelfde wedstrijd geeft automatisch rood . ⏱ tijdstraf — 5 minuten voor pupillen (t/m jo/mo15), 10 minuten voor jo/mo16+ en senioren. 🟥 rood — de speler wordt direct van het veld gehaald. verkeerde kaart? tik erop in het log om de speler te wijzigen of de kaart te verwijderen.">
    <h3>🟨 Kaarten & straffen</h3>
    <p>De gele knop naast het scorebord opent het kaartenmenu. Kies de speler en het type:</p>
    <ul>
      <li><b>🟨 Geel</b> — waarschuwing. Een tweede gele in dezelfde wedstrijd geeft <b>automatisch rood</b>.</li>
      <li><b>⏱ Tijdstraf</b> — 5 minuten voor pupillen (t/m JO/MO15), 10 minuten voor JO/MO16+ en senioren.</li>
      <li><b>🟥 Rood</b> — de speler wordt direct van het veld gehaald.</li>
      <li>Verkeerde kaart? Tik erop in het log om de speler te wijzigen of de kaart te verwijderen.</li>
    </ul>
    </section>

    <section class="hl-sec" data-zoek="👑 aanvoerder onder ⚙️ in de wedstrijd kies je per wedstrijd de aanvoerder. hij krijgt een geel c -bandje op zijn shirt. in de statistieken zie je hoe vaak iemand aanvoerder is geweest — handig om te rouleren.">
    <h3>👑 Aanvoerder</h3>
    <p>Onder ⚙️ in de wedstrijd kies je per wedstrijd de aanvoerder. Hij krijgt een geel <b>C</b>-bandje op zijn shirt. In de statistieken zie je hoe vaak iemand aanvoerder is geweest — handig om te rouleren.</p>
    </section>

    <section class="hl-sec" data-zoek="🏆 toernooien bij een nieuwe wedstrijd kies je toernooi . geef het aantal wedstrijden op en het aantal helften per wedstrijd. de tabs worden dan w1 , w2 ... de tegenstander per wedstrijd vul je in door op de naam in het scorebord te tikken (gestippeld onderstreept). op één scherm: alle wissels en speeltijden lopen over het hele toernooi door, zodat je in wedstrijd 4 ziet wie er bij wedstrijd 1, 2 en 3 al heeft gespeeld.">
    <h3>🏆 Toernooien</h3>
    <p>Bij een nieuwe wedstrijd kies je <b>Toernooi</b>. Geef het aantal wedstrijden op en het aantal helften per wedstrijd. De tabs worden dan <kbd>W1</kbd>, <kbd>W2</kbd> ... De tegenstander per wedstrijd vul je in door op de naam in het scorebord te tikken (gestippeld onderstreept).</p>
    <div class="tip"><b>Op één scherm:</b> alle wissels en speeltijden lopen over het hele toernooi door, zodat je in wedstrijd 4 ziet wie er bij wedstrijd 1, 2 en 3 al heeft gespeeld.</div>
    </section>

    <h4 class="hl-hoofdstuk" id="hlh-club">🏛 Club &amp; team beheren</h4>
    <section class="hl-sec" data-zoek="🏛 clubs & trainingen delen werk je als hoofdtrainer voor meerdere teams? maak op het startscherm een club aan. daarmee kun je: teams aanmaken die bij jouw club horen (de coaches ervan komen direct in het juiste team). 📥 pdf importeren : upload een pdf met de teamindeling en de app leest de teams en spelers automatisch uit. controleer in de preview, klik "aanmaken" en alle teams + spelers staan klaar. coaches uitnodigen met een persoonlijke link (via whatsapp), zodat ze niet eerst een teamcode hoeven te krijgen. met 🔗 alle uitnodigingen krijg je in één overzicht alle links voor alle teams. pdf-trainingen uploaden en aangeven voor welke teams ze beschikbaar zijn. de trainers zien ze in het 📄 training-tabblad van hun team. met ✏️ pas je de titel, week of de gekoppelde teams later aan, zonder het bestand opnieuw te uploaden. een 🔴 stip op het training-tabblad waarschuwt coaches voor nieuwe, ongelezen trainingen.">
    <h3>🏛 Clubs & trainingen delen</h3>
    <p>Werk je als hoofdtrainer voor meerdere teams? Maak op het startscherm een <b>club</b> aan. Daarmee kun je:</p>
    <ul>
      <li>Teams aanmaken die bij jouw club horen (de coaches ervan komen direct in het juiste team).</li>
      <li><b>📥 PDF importeren</b>: upload een PDF met de teamindeling en de app leest de teams en spelers automatisch uit. Controleer in de preview, klik "Aanmaken" en alle teams + spelers staan klaar.</li>
      <li>Coaches uitnodigen met een persoonlijke link (via WhatsApp), zodat ze niet eerst een teamcode hoeven te krijgen. Met <b>🔗 Alle uitnodigingen</b> krijg je in één overzicht alle links voor alle teams.</li>
      <li>PDF-trainingen uploaden en aangeven voor welke teams ze beschikbaar zijn. De trainers zien ze in het 📄 Training-tabblad van hun team. Met ✏️ pas je de titel, week of de gekoppelde teams later aan, zonder het bestand opnieuw te uploaden.</li>
      <li>Een 🔴 stip op het training-tabblad waarschuwt coaches voor nieuwe, ongelezen trainingen.</li>
    </ul>
    </section>

    <section class="hl-sec" data-zoek="👥 meerdere coaches & rommel opruimen onder ⚙️ team vind je de teamcode (bijv. asvjo11-1) en de lijst coaches . deel de code of een uitnodigingslink met collega-coaches: ze openen de link en loggen in met hun e-mailadres of google. daarna zitten ze direct in het team — en komen ze later met dezelfde login terug als dezelfde coach. staat er iemand verkeerd of dubbel in de lijst? tik op het 🗑 naast een coach om die te verwijderen uit het team. wijzigingen lopen realtime door — handig als de assistent-coach langs de lijn de wissels bijhoudt en de hoofdcoach de score.">
    <h3>👥 Meerdere coaches & rommel opruimen</h3>
    <p>Onder ⚙️ <b>Team</b> vind je de <b>teamcode</b> (bijv. ASVJO11-1) en de lijst <b>coaches</b>. Deel de code of een uitnodigingslink met collega-coaches:</p>
    <ul>
      <li>Ze openen de link en loggen in met hun e-mailadres of Google. Daarna zitten ze direct in het team — en komen ze later met dezelfde login terug als dezelfde coach.</li>
      <li>Staat er iemand verkeerd of dubbel in de lijst? Tik op het 🗑 naast een coach om die te verwijderen uit het team.</li>
      <li>Wijzigingen lopen realtime door — handig als de assistent-coach langs de lijn de wissels bijhoudt en de hoofdcoach de score.</li>
    </ul>
    </section>

    <section class="hl-sec" data-zoek="📐 format en formatie wijzigen onder ⚙️ in een wedstrijd pas je het format (6×6, 8×8, 9×9, 11×11, 4×4) en de formatie aan. spelers blijven zoveel mogelijk op hun plek staan; slots die wegvallen worden netjes opgeschoond.">
    <h3>📐 Format en formatie wijzigen</h3>
    <p>Onder ⚙️ in een wedstrijd pas je het format (6×6, 8×8, 9×9, 11×11, 4×4) en de formatie aan. Spelers blijven zoveel mogelijk op hun plek staan; slots die wegvallen worden netjes opgeschoond.</p>
    </section>

    <section class="hl-sec" data-zoek="📊 statistieken onder ⏱ vind je het seizoensoverzicht: speeltijd, doelpunten, aanvoerdersbeurten, keeperbeurten en kaarten per speler. sorteert vanzelf op meeste speeltijd.">
    <h3>📊 Statistieken</h3>
    <p>Onder ⏱ vind je het seizoensoverzicht: speeltijd, doelpunten, aanvoerdersbeurten, keeperbeurten en kaarten per speler. Sorteert vanzelf op meeste speeltijd.</p>
    </section>

    <h4 class="hl-hoofdstuk" id="hlh-beoordelen">📈 Beoordelen &amp; evalueren</h4>
    <section class="hl-sec" data-zoek="📋 spelers beoordelen per speler leg je de ontwikkeling vast. open een speler (tab spelers → tik op de speler) en je vindt daar het ontwikkelprofiel met twee manieren om te beoordelen: ⚡ snel beoordelen — een paar tikken na een wedstrijd of training: een algemeen niveau plus optionele "opvallend"-tags. ideaal om er een gewoonte van te maken. 📋 volledige beoordeling — een periodieke, diepere meting op de vijf ontwikkeldomeinen. hieruit komt het ontwikkelprofiel met balkjes. de vijf domeinen (gebaseerd op het asv'33-jeugdbeleidsplan): te — technisch : balbeheersing, traptechniek, 1v1. ta — tactisch : inzicht, positiespel, keuzes maken. fy — fysiek : snelheid, actiesnelheid, duelkracht. me — mentaal : zelfvertrouwen, spelen onder weerstand. ge — gedrag & beleving : inzet, teamgevoel, plezier. een score loopt van 1 (aandacht) via 3 (prima) tot 5 (uitblinker) . leerpunten (tab leerlijn in het profiel): concrete, observeerbare ontwikkeldoelen die over meerdere wedstrijden doorlopen. vink ze af zodra ze beheerst zijn. de app stelt leerpunten voor die passen bij de leeftijd van het team. historie : een tijdlijn met al je eerdere beoordelingen. tik een item aan om het te bekijken of bij te werken. privacy: beoordelingen en leerpunten zijn coach-only . spelers en ouders zien deze nooit. verwijder je een speler, dan gaan zijn beoordelingen mee weg.">
    <h3>📋 Spelers beoordelen</h3>
    <p>Per speler leg je de ontwikkeling vast. Open een speler (tab <b>Spelers</b> → tik op de speler) en je vindt daar het ontwikkelprofiel met twee manieren om te beoordelen:</p>
    <ul>
      <li><b>⚡ Snel beoordelen</b> — een paar tikken na een wedstrijd of training: een algemeen niveau plus optionele "opvallend"-tags. Ideaal om er een gewoonte van te maken.</li>
      <li><b>📋 Volledige beoordeling</b> — een periodieke, diepere meting op de vijf ontwikkeldomeinen. Hieruit komt het ontwikkelprofiel met balkjes.</li>
    </ul>
    <p>De vijf domeinen (gebaseerd op het ASV'33-jeugdbeleidsplan):</p>
    <ul>
      <li><b>TE — Technisch</b>: balbeheersing, traptechniek, 1v1.</li>
      <li><b>TA — Tactisch</b>: inzicht, positiespel, keuzes maken.</li>
      <li><b>FY — Fysiek</b>: snelheid, actiesnelheid, duelkracht.</li>
      <li><b>ME — Mentaal</b>: zelfvertrouwen, spelen onder weerstand.</li>
      <li><b>GE — Gedrag &amp; beleving</b>: inzet, teamgevoel, plezier.</li>
    </ul>
    <p>Een score loopt van <b>1 (Aandacht)</b> via <b>3 (Prima)</b> tot <b>5 (Uitblinker)</b>.</p>
    <ul>
      <li><b>Leerpunten</b> (tab Leerlijn in het profiel): concrete, observeerbare ontwikkeldoelen die over meerdere wedstrijden doorlopen. Vink ze af zodra ze beheerst zijn. De app stelt leerpunten voor die passen bij de leeftijd van het team.</li>
      <li><b>Historie</b>: een tijdlijn met al je eerdere beoordelingen. Tik een item aan om het te bekijken of bij te werken.</li>
    </ul>
    <div class="tip"><b>Privacy:</b> beoordelingen en leerpunten zijn <b>coach-only</b>. Spelers en ouders zien deze nooit. Verwijder je een speler, dan gaan zijn beoordelingen mee weg.</div>
    </section>

    <section class="hl-sec" data-zoek="📈 team evalueren na de wedstrijd naast de beoordeling per speler kun je na elke wedstrijd ook het hele team evalueren. onderaan het wedstrijdscherm, onder het wedstrijdverslag, staat de knop 📈 team evalueren . al een keer ingevuld voor deze wedstrijd? dan heet de knop ✓ teamevaluatie bijwerken en pas je 'm gewoon aan. acht korte vragen, elk met dezelfde kleurbalk als bij spelers (1 aandacht t/m 5 uitblinker): inzet & concentratie, samenwerking & communicatie, taakuitvoering per linie, opbouw van achteruit, omschakeling bij balverlies/-winst, druk zetten & veroveren, spelplezier, coachbaarheid. daarna eventueel een paar tags aantikken (goede samenwerking, veel plezier, afspraken niet nagekomen, enzovoort) en twee optionele tekstvelden: wat ging het beste, en wat is het aandachtspunt voor de volgende training. drie tot vijf minuten werk, alles op één scherm, niets is verplicht behalve de acht kleurbalken.">
    <h3>📈 Team evalueren na de wedstrijd</h3>
    <p>Naast de beoordeling per speler kun je na elke wedstrijd ook het <b>hele team</b> evalueren. Onderaan het wedstrijdscherm, onder het wedstrijdverslag, staat de knop <b>📈 Team evalueren</b>.</p>
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
    <div class="tip"><b>3–5 minuten werk:</b> alles staat op één scherm, tikken in plaats van typen. Niets is verplicht behalve de acht kleurbalken — de tags en tekstvelden mag je overslaan.</div>
    </section>

    <section class="hl-sec" data-zoek="📊 teamevaluatie-dashboard bekijk je onder het tabblad stats , via het segment 📈 teamevaluatie naast spelers . vier onderdelen: groeicurve — een lijn met de gemiddelde teamontwikkelscore per wedstrijd, zodat je in één oogopslag ziet of het team groeit. categorieën — de acht onderdelen met hun gemiddelde over de laatste vijf wedstrijden, inclusief een pijltje omhoog, gelijk of omlaag. terugkerende aandachtspunten — automatisch signalen zodra hetzelfde onderdeel meerdere wedstrijden op rij het laagst scoort. voorgesteld trainingsthema — een suggestie voor de volgende training, gebaseerd op het onderdeel dat de meeste aandacht vraagt; sluit waar mogelijk aan bij een leercurve-thema uit het jeugdbeleidsplan. tip: na 1 evaluatie zie je alleen een cijfer, vanaf 2 verschijnt de lijn, en de terugkerende aandachtspunten worden pas zichtbaar na een paar wedstrijden — zo voorkom je dat één mindere wedstrijd meteen als patroon wordt gezien.">
    <h3>📊 Teamevaluatie-dashboard lezen</h3>
    <p>Alle ingevulde teamevaluaties komen samen onder het tabblad <b>Stats</b>, via het segment <b>📈 Teamevaluatie</b> naast Spelers. Vier onderdelen:</p>
    <ul>
      <li><b>Groeicurve</b> — een lijn met de gemiddelde teamontwikkelscore per wedstrijd, zodat je in één oogopslag ziet of het team groeit.</li>
      <li><b>Categorieën</b> — de acht onderdelen met hun gemiddelde over de laatste vijf wedstrijden, inclusief een pijltje ↗ ↘ → voor de trend.</li>
      <li><b>Terugkerende aandachtspunten</b> — verschijnt automatisch zodra hetzelfde onderdeel meerdere wedstrijden op rij het laagst scoort.</li>
      <li><b>Voorgesteld trainingsthema</b> — een suggestie voor de volgende training, gebaseerd op het onderdeel dat nu de meeste aandacht vraagt. Sluit waar mogelijk aan bij een leercurve-thema uit het jeugdbeleidsplan.</li>
    </ul>
    <div class="tip"><b>Even geduld bij de start:</b> na 1 evaluatie zie je alleen een cijfer, vanaf 2 verschijnt de lijn. De terugkerende aandachtspunten worden pas zichtbaar na een paar wedstrijden — zo voorkom je dat één mindere wedstrijd meteen als patroon wordt gezien.</div>
    </section>

    <h4 class="hl-hoofdstuk" id="hlh-tips">💡 Tips &amp; privacy</h4>
    <section class="hl-sec" data-zoek="💡 praktische tips voeg de app als snelkoppeling op je startscherm toe (browsermenu → "toevoegen aan beginscherm") voor app-gevoel. werkt zonder problemen als de telefoon op slot gaat — de klok loopt door op de juiste tijd. slecht bereik langs de lijn? geen probleem: de app werkt offline door en synchroniseert je wijzigingen automatisch zodra er weer verbinding is. met een powerbank langs de lijn ben je verzekerd van een hele wedstrijd.">
    <h3>💡 Praktische tips</h3>
    <ul>
      <li>Voeg de app als <b>snelkoppeling op je startscherm</b> toe (browsermenu → "Toevoegen aan beginscherm") voor app-gevoel.</li>
      <li>Werkt zonder problemen als de telefoon op slot gaat — de klok loopt door op de juiste tijd.</li>
      <li><b>Slecht bereik langs de lijn?</b> Geen probleem: de app werkt offline door en synchroniseert je wijzigingen automatisch zodra er weer verbinding is.</li>
      <li>Met een powerbank langs de lijn ben je verzekerd van een hele wedstrijd.</li>
    </ul>
    </section>


    <section class="hl-sec" data-zoek="⇄ spelers uitlenen speelt een speler een keer mee met een ander team binnen de club? open zijn profiel (tab spelers → tik op de speler) en kies ⇄ uitlenen aan ander team . je kiest het ontvangende team en de wedstrijddag. de andere coach ziet de speler automatisch vanaf 3 dagen vóór tot 3 dagen ná die dag, onder het kopje "geleend" — daarna verdwijnt hij vanzelf. de ontvangende coach ziet alleen voornaam + voorletter (bijv. "tim b."), de voorkeurspositie, de statistieken en het ontwikkelprofiel. alles read-only. je kunt een uitlening op elk moment intrekken vanaf het spelerprofiel.">
    <h3>⇄ Spelers uitlenen</h3>
    <p>Speelt een speler een keer mee met een ander team binnen de club? Open zijn profiel (tab Spelers → tik op de speler) en kies <b>⇄ Uitlenen aan ander team</b>. Je kiest het ontvangende team en de wedstrijddag.</p>
    <ul>
      <li>De andere coach ziet de speler automatisch vanaf <b>3 dagen vóór</b> tot <b>3 dagen ná</b> die dag, onder het kopje "Geleend" — daarna verdwijnt hij vanzelf.</li>
      <li>De ontvangende coach ziet alleen <b>voornaam + voorletter</b> (bijv. "Tim B."), de voorkeurspositie, de statistieken en het ontwikkelprofiel. Alles read-only.</li>
      <li>Je kunt een uitlening op elk moment <b>intrekken</b> vanaf het spelerprofiel.</li>
    </ul>
    </section>

    <section class="hl-sec" data-zoek="🔒 privacy & namen cluppie gaat zorgvuldig om met de gegevens van (vaak minderjarige) spelers: in de app zie je standaard alleen voornamen . de achternaam wordt wél opgeslagen, maar nergens in de app getoond. de achternaam blijft binnen je eigen team en is alleen zichtbaar voor de coaches van dat team. leen je een speler uit, dan ziet de andere coach alleen de voorletter. beoordelingen en leerpunten zijn coach-only : spelers en ouders zien deze niet. verwijder je een speler, dan worden zijn gegevens (inclusief beoordelingen en leerpunten) verwijderd. deel gegevens uit spelersprofielen niet buiten het technisch kader. heb je vragen over privacy binnen de club? stem af met je hoofdcoach of clubbeheerder.">
    <h3>🔒 Privacy &amp; namen</h3>
    <p>Cluppie gaat zorgvuldig om met de gegevens van (vaak minderjarige) spelers:</p>
    <ul>
      <li>In de app zie je standaard alleen <b>voornamen</b>. De achternaam wordt wél opgeslagen, maar nergens in de app getoond.</li>
      <li>De achternaam blijft <b>binnen je eigen team</b> en is alleen zichtbaar voor de coaches van dat team. Leen je een speler uit, dan ziet de andere coach alleen de voorletter.</li>
      <li>Beoordelingen en leerpunten zijn <b>coach-only</b>: spelers en ouders zien deze niet.</li>
      <li>Verwijder je een speler, dan worden zijn gegevens (inclusief beoordelingen en leerpunten) verwijderd.</li>
    </ul>
    <div class="tip">Deel gegevens uit spelersprofielen niet buiten het technisch kader. Heb je vragen over privacy binnen de club? Stem af met je hoofdcoach of clubbeheerder.</div>

    
    </section>

    <p style="font-size:12.5px;color:var(--ink-2);text-align:center;margin-top:20px;padding-top:14px;border-top:1px solid var(--hair)">
      Vragen of ideeën? Geef ze door aan je hoofdcoach.<br>Veel succes langs de lijn! ⚽
    </p>
  </div>`;
}

