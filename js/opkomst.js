/* ==================== OPKOMST — wie telt mee voor welke training? ====================
   Een presentie-record legt alleen vast wie AFWEZIG was; iedereen die niet in
   die lijst staat gold als aanwezig. Voor een speler die later instroomde
   (gast, inleen, nieuwe aanwinst) leverde dat met terugwerkende kracht 100%
   op over trainingen waar hij nog niet bij het team was: hij was er simpelweg
   niet om afwezig gezet te worden.

   Twee mechanismen lossen dat op:

     1. `selectie` — sinds 2026-09-08 schrijft teams-training.js de spelers-id's
        van dat moment mee in elk presentie-record. Wie er niet in staat telt
        niet mee: noch in de teller, noch in de noemer. Dit gaat vanzelf en
        vraagt niets van de coach.

     2. `meetelVanaf` — een optionele datum (YYYY-MM-DD) op de speler, voor de
        records van vóór die release, en als vangnet wanneer een speler eerder
        is aangemaakt dan dat hij daadwerkelijk begon. Bij een ingeleende
        speler zonder eigen spelerdocument staat de datum op
        `overlay.meetelVanaf` van het leen-record; herbouwSpelers() in teams.js
        zet hem op het samengestelde speler-object.

   Beide werken samen: `meetelVanaf` snijdt ook door een `selectie` heen, want
   een speler kan best in de selectie staan terwijl hij pas later begon.

   Bewust een eigen module zonder imports. De helpers worden gebruikt door
   wedstrijd.js (stats), teams-spelers.js (spelersprofiel) én club.js
   (clubdashboard); onderbrengen in config.js zou een versie-bump over 34
   bestanden kosten in plaats van 11. */

/* Minimum aantal meetellende trainingen voordat een opkomstpercentage een
   aandacht-signaal mag opleveren. Zonder deze ondergrens rolt een speler die
   net binnen is en zijn eerste training mist meteen op 0% in de lijst — een
   oordeel op één meting. */
export const MIN_OPKOMST_TRAININGEN = 3;

/* Telt deze presentie-sessie mee voor deze speler?
   `speler` mag ook een plat spelerdocument uit Firestore zijn (club.js leest
   rauw); alleen `id` en `meetelVanaf` worden gebruikt. */
export function teltMee(sessie, speler){
  if (!sessie || !speler) return false;
  const vanaf = speler.meetelVanaf;
  if (vanaf && sessie.datum && sessie.datum < vanaf) return false;
  // Oudere records (vóór 2026-09-08) hebben geen selectie; daar valt de
  // beoordeling terug op meetelVanaf alleen.
  if (Array.isArray(sessie.selectie)) return sessie.selectie.includes(speler.id);
  return true;
}

/* Opkomst van één speler over een lijst presentie-sessies.
   → {aanwezig, totaal, pct, overgeslagen}; pct is null als er geen enkele
   meetellende sessie is. `overgeslagen` is hoeveel sessies buiten zijn
   telling vielen — bruikbaar om dat in de UI uit te leggen. */
export function opkomstVoor(speler, sessies){
  const lijst = sessies || [];
  let aanwezig = 0, totaal = 0;
  for (const ses of lijst){
    if (!teltMee(ses, speler)) continue;
    totaal++;
    if (!(ses.afwezig || []).includes(speler.id)) aanwezig++;
  }
  return {
    aanwezig, totaal,
    pct: totaal ? Math.round((aanwezig / totaal) * 100) : null,
    overgeslagen: lijst.length - totaal,
  };
}
