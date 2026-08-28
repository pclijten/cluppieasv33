/* ==========================================================================
   leerinhoud.js — Didactische inhoud per leercurve-thema (CONCEPT, AI-opgesteld)

   Eénmalig door AI aangeleverd als startset; Paul/Arnoud passen aan waar nodig.
   Deze inhoud is bewust VAST (geen AI per keer): het gaat om leerinhoud die aan
   jeugdspelers wordt overgebracht en die moet kloppen met het jeugdbeleidsplan
   en de 4Skills-methodiek.

   Structuur per thema:
     principe   – de kern in één zin (wat wil je aanleren)
     waarom     – waarom dit ertoe doet voor de jeugdspeler
     uitleg     – hoe je het aan spelers uitlegt (coach-taal, kort, concreet)
     coachpunten– waar je op let / wat je benoemt tijdens het uitleggen
     voorbeelden– loopacties die de app op het veld tekent. Elk voorbeeld:
                   { naam, toelichting,
                     spelers:[{nr,x,y, kant?}],   // kant:'tegen' = tegenstander (blauw); anders eigen speler (rood)
                     lijnen:[{soort:'loopweg'|'pass', punten:[[x,y],...]}],
                     bal:[x,y]|null }
                  Coördinaten in % (0–100), zelfde systeem als het tactiekbord.
                  Veld-oriëntatie: y=0 is de aanvalshelft (diep/naar voren),
                  y=100 is het eigen doel.
   ========================================================================== */

export const LEERINHOUD = {

  "Dieptespel opbouw": {
    principe: "Diepte vóór breedte: zoek eerst de bal naar voren te spelen, pas als dat niet kan speel je breed.",
    waarom: "Jeugdspelers spelen van nature de veilige bal opzij. Door ze te leren éérst diep te kijken, komen ze sneller in scorende posities en leren ze vooruit voetballen in plaats van de bal rond te tikken.",
    uitleg: "Leg uit met een simpel beeld: “De snelste weg naar het doel is recht vooruit, niet opzij.” Laat op het bord zien dat één diepe pass twee tegenstanders uitschakelt, terwijl een brede pass niemand voorbij is. De vuistregel voor de speler: kijk eerst naar voren, kun je niet diep? Dán pas breed.",
    coachpunten: [
      "Laat de spits eerst bewegen (aanbieden) vóór de pass — timing van de loopactie is de sleutel.",
      "Benoem het moment: “nu kán het diep” versus “nu moet het breed”.",
      "Beloon de poging tot diepte, ook als de bal wordt onderschept — de keuze is goed.",
      "Koppel aan omschakeling: diep spelen kan direct na balverovering het gevaarlijkst zijn.",
    ],
    voorbeelden: [
      {
        naam: "De spits vraagt de diepte",
        toelichting: "Nummer 8 (spits) beweegt eerst naar de bal toe om zijn tegenstander mee te lokken, draait dan weg in de diepte. Nummer 6 (middenvelder) speelt de diepe bal in de ruimte die ontstaat.",
        spelers: [
          { nr: 6, x: 42, y: 58 },
          { nr: 8, x: 46, y: 34 },
        ],
        bal: [42, 58],
        lijnen: [
          { soort: "loopweg", punten: [[46,34],[44,46],[66,20]] },   // spits: naar bal toe, dan diep wegdraaien naar rechts
          { soort: "pass",    punten: [[42,58],[64,22]] },            // diepe pass in de ruimte rechts
        ],
      },
      {
        naam: "Diep kan niet? Dan pas breed",
        toelichting: "De diepe lijn is dicht: een tegenstander (blauw) staat vóór nummer 8, dus de bal naar voren kan niet. Nummer 6 kaatst dan breed op nummer 4, die meteen weer naar voren kijkt. Breedte is hier het middel, niet het doel.",
        spelers: [
          { nr: 4, x: 80, y: 52 },
          { nr: 6, x: 50, y: 55 },
          { nr: 8, x: 50, y: 28 },
          { nr: 5, x: 50, y: 41, kant:'tegen' },   // tegenstander houdt de diepe lijn dicht
        ],
        bal: [50, 55],
        lijnen: [
          { soort: "pass", punten: [[50,55],[78,52]] },   // breed als diep niet kan
          { soort: "loopweg", punten: [[80,52],[80,34]] },// nummer 4 neemt mee naar voren
        ],
      },
      {
        naam: "Diepte na balverovering",
        toelichting: "Direct na balwinst is de tegenstander nog niet georganiseerd. Nummer 6 zoekt meteen de diepe bal op de doorgebroken spits — het gevaarlijkste moment om diep te spelen.",
        spelers: [
          { nr: 6, x: 46, y: 58 },
          { nr: 8, x: 54, y: 26 },
        ],
        bal: [46, 58],
        lijnen: [
          { soort: "loopweg", punten: [[54,26],[56,12]] },// spits breekt door
          { soort: "pass",    punten: [[46,58],[55,14]] },// diepe bal meteen na verovering
        ],
      },
    ],
  },

  "Storen en veroveren": {
    principe: "Samen druk zetten: jaag met het hele team dezelfde kant op, zodat de tegenstander geen uitweg heeft en jij de bal verovert.",
    waarom: "Spelers van 11-13 jagen vaak alleen en te wild — één rent erop af, de rest kijkt toe, en de tegenstander speelt er zo omheen. Als ze leren sámen en op het juiste moment druk te zetten, veroveren ze de bal hoger op het veld en dichter bij de goal van de tegenstander.",
    uitleg: "Gebruik een simpel beeld: “we jagen als een roedel, niet als losse honden.” De speler dichtbij de bal zet druk (de jager), de rest schuift mee die kant op en houdt de korte pass dicht. Belangrijk: de jager loopt gebogen, niet recht — zo stuurt hij de tegenstander naar de zijlijn, waar minder ruimte is. De onthoud-zin: druk zetten doe je met z'n allen, naar één kant.",
    coachpunten: [
      "Eén jaagt, de rest schuift mee — benoem wie de baldrager aanjaagt en wie de korte pass dichthoudt.",
      "Laat de jager gebogen aanlopen (in een boog), zodat de tegenstander naar de zijlijn wordt gestuurd.",
      "Timing: druk zetten op het moment dat de bal onderweg is (de slechte controle), niet als de tegenstander al goed staat.",
      "De zijlijn is je vriend — daar kan de tegenstander maar twee kanten op, dus daar verover je de bal.",
      "Veroverd? Denk meteen aan diepte (link met het thema 'Dieptespel opbouw') — vlak na balwinst is de tegenstander kwetsbaar.",
    ],
    voorbeelden: [
      {
        naam: "De jager stuurt naar de zijlijn",
        toelichting: "Nummer 7 zet druk op de baldrager, maar loopt in een boog aan zodat de tegenstander alleen nog naar de zijlijn kan. Zo maak je het veld voor de tegenstander klein.",
        spelers: [
          { nr: 7, x: 55, y: 40 },   // onze jager
          { nr: 11, x: 70, y: 22, kant:'tegen' },  // tegenstander met bal (hoger op het veld = lage y)
        ],
        bal: [70, 22],
        lijnen: [
          { soort: "loopweg", punten: [[55,40],[64,34],[72,30]] }, // gebogen aanloop naar buiten
        ],
      },
      {
        naam: "Meeschuiven en de pass dichthouden",
        toelichting: "Terwijl nummer 7 jaagt, schuift nummer 8 mee dezelfde kant op en gaat vóór de dichtstbijzijnde medespeler van de tegenstander staan. De korte, makkelijke pass is nu dicht — de tegenstander moet risico nemen.",
        spelers: [
          { nr: 7, x: 68, y: 30 },   // jager al bij de baldrager
          { nr: 8, x: 40, y: 48 },   // schuift mee
          { nr: 11, x: 76, y: 22, kant:'tegen' },  // baldrager tegenstander
          { nr: 9, x: 48, y: 28, kant:'tegen' },   // medespeler tegenstander die de bal wil ontvangen
        ],
        bal: [76, 22],
        lijnen: [
          { soort: "loopweg", punten: [[40,48],[50,34]] },        // nummer 8 schuift mee, vóór nr 9 langs
          { soort: "pass",    punten: [[76,22],[50,28]] },        // de pass die we willen dichthouden
        ],
      },
      {
        naam: "Veroveren en meteen diep",
        toelichting: "Door de druk speelt de tegenstander een slechte bal. Nummer 8 onderschept en zoekt meteen de diepte — precies op het moment dat de tegenstander nog vooruit staat. Zo wordt verdedigen meteen aanvallen.",
        spelers: [
          { nr: 8, x: 52, y: 38 },   // onderschept
          { nr: 10, x: 48, y: 16 },  // onze spits die diep gaat
        ],
        bal: [52, 38],
        lijnen: [
          { soort: "loopweg", punten: [[48,16],[46,6]] },         // spits breekt door na balwinst
          { soort: "pass",    punten: [[52,38],[47,8]] },         // meteen diep na de verovering
        ],
      },
    ],
  },

};

/* Vind de inhoud voor een thema (of null als er nog geen inhoud is). */
export function leerinhoudVoor(thema){ return LEERINHOUD[thema] || null; }
