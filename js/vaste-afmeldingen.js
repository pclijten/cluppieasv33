/* ==================== VASTE AFMELDINGEN — terugkerende afwezigheid ====================
   [20261012] Een coach kan een speler in één keer afmelden voor een vaste
   trainingsdag over meerdere weken (bv. elke maandag, 10 weken).

   Bewust GEEN vooraf aangemaakte presentie-records: opkomstVoor() (opkomst.js)
   telt elk record meteen mee, ook in de toekomst. Tien records vooruit zouden
   de speler tien gemiste trainingen geven en de rest van het team tien keer
   "aanwezig" voor trainingen die nog niet gespeeld zijn — en een afgelaste
   training bleef dan ook staan.

   In plaats daarvan staat er een regel op het teamdocument:
     teams/{teamId}.vasteAfmeldingen = [{ id, spelerId, dag (1=ma … 7=zo),
       van, tot (YYYY-MM-DD, beide op die weekdag), reden, notitie, door, gemaakt }]
   Wie de presentie opent voor een datum zonder record, ziet de speler al op
   afwezig staan (prefill). Pas als de coach die dag de presentie vastlegt
   ontstaat er een record. Bestond er al een record voor een toekomstige datum,
   dan zet modalVasteAfmelding de speler daar éénmalig bij.

   In het reden-object op een record markeert `vast: <regel-id>` dat de afwezigheid
   uit een vaste afmelding komt (label 🔁 + opruimen bij stoppen).
   afwezigRedenInfo() negeert dat extra veld.

   Eigen module zonder imports (zelfde reden als opkomst.js): zowel
   teams-training.js als desktop-schermen.js gebruiken dit, zonder dat de
   een de ander hoeft te importeren. */

export const MAX_WEKEN = 40;

/* 1 = ma … 7 = zo voor een ISO-datum */
export function weekdagVan(iso){
  return ((new Date(iso + 'T12:00').getDay() + 6) % 7) + 1;
}

/* ISO + n dagen */
export function plusDagen(iso, n){
  const d = new Date(iso + 'T12:00');
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}

/* Eerste datum op of na `iso` die op weekdag `dag` valt. */
export function eersteOpDag(iso, dag){
  for (let i = 0; i < 7; i++){
    const d = plusDagen(iso, i);
    if (weekdagVan(d) === dag) return d;
  }
  return iso;
}

/* Alle datums van een regel, oplopend. */
export function regelDatums(r){
  const uit = [];
  if (!r || !r.van || !r.tot) return uit;
  for (let d = r.van, i = 0; d <= r.tot && i < MAX_WEKEN + 1; d = plusDagen(d, 7), i++) uit.push(d);
  return uit;
}

/* Regels die nog niet voorbij zijn, op volgorde van startdatum. */
export function actieveRegels(team, vandaag){
  const lijst = Array.isArray(team?.vasteAfmeldingen) ? team.vasteAfmeldingen : [];
  return lijst.filter(r => r && r.spelerId && r.tot && r.tot >= vandaag)
    .sort((a, b) => (a.van || '').localeCompare(b.van || ''));
}

/* Valt deze datum onder deze regel? */
export function regelGeldtOp(r, datum){
  return !!(r && datum && r.van && r.tot && datum >= r.van && datum <= r.tot && weekdagVan(datum) === Number(r.dag));
}

/* Map spelerId → regel voor één datum. `spelerIds` beperkt tot spelers die nu
   in het team zitten (een vertrokken speler krijgt geen afmelding meer). */
export function vastOp(team, datum, spelerIds){
  const uit = new Map();
  const ids = spelerIds ? new Set(spelerIds) : null;
  const lijst = Array.isArray(team?.vasteAfmeldingen) ? team.vasteAfmeldingen : [];
  for (const r of lijst){
    if (!regelGeldtOp(r, datum)) continue;
    if (ids && !ids.has(r.spelerId)) continue;
    if (!uit.has(r.spelerId)) uit.set(r.spelerId, r);
  }
  return uit;
}

/* Reden-object zoals dat in afwezigRedenen op een record komt. */
export function redenVanRegel(r){
  return { type: r.reden || 'anders', notitie: r.notitie || '', vast: r.id };
}

/* Beginstand voor een datum zonder presentie-record. */
export function vastePrefill(team, datum, spelerIds){
  const afwezig = [], redenen = {};
  for (const [pid, r] of vastOp(team, datum, spelerIds)){
    afwezig.push(pid);
    redenen[pid] = redenVanRegel(r);
  }
  return { afwezig, redenen };
}
