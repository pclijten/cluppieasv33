/* ==================== UITLEEN-REGELS ====================
   [20261111] Een uitlening is geen verhuizing meer maar een afspraak met een
   geldigheid. De speler blijft lid van zijn eigen team; deze module bepaalt
   per activiteit (training op een datum, of een wedstrijd) bij welk team hij
   hoort.

   Bewust een eigen module ZONDER imports (pure functies): wordt gebruikt door
   teams.js, teams-training.js, wedstrijd.js, nu-scherm.js, teams-hub.js,
   desktop-schermen.js, bouw-hub.js en uitleen-form.js. Geen state.js-wijziging
   nodig.

   Recordvorm (clubs/{club}/uitleningen/{id}), naast de bestaande velden
   spelerId/vanTeam/vanTeamNaam/naarTeam/naarTeamNaam/overlay/snapshot/door/gemaakt:

     soort:  ontbreekt  → oud record: geldt overal, geen einddatum (gedrag van vóór 20261111)
             'wedstrijd' → één wedstrijd:  wedstrijd:{id,datum,aftrap,tegenstander}
             'periode'   → uitgebreid:
                 wat:        'w' wedstrijden | 't' meetrainen | 'b' allebei
                 vanaf:      'YYYY-MM-DD'
                 wedstrijden:[{id,datum,aftrap,tegenstander}] | null   (null = alle in de periode)
                 trainNaar:  [1..7]  dagen waarop hij bij het ontvangende team traint
                 trainVan:   [1..7]  dagen waarop hij bij het eigen team blijft trainen
                 trainVanNiet:[1..7] eigen trainingsdagen die de coördinator op Niet zette
     tot:        'YYYY-MM-DD' | null   laatste dag waarop de uitlening geldt
                                       (één wedstrijd: de wedstrijddatum)
     conflicten: { 'YYYY-MM-DD': 'beide' | 'naar' | 'van' }
                 per datum waarop beide teams een wedstrijd hebben; de
                 coördinator kiest. 'naar' = alleen bij het ontvangende team,
                 'van' = alleen bij het eigen team.

   Na `tot` is de uitlening voorbij. Het record blijft bestaan (historie); het
   telt alleen niet meer mee. Spelers dragen hun uitlening(en) mee als
   `_leen` (ingeleend, één record) of `_leningenUit` (uitgeleend, lijst). */

export const DAG_NAMEN = ['', 'ma', 'di', 'wo', 'do', 'vr', 'za', 'zo'];

/* Vandaag in lokale tijd (niet UTC: rond middernacht scheelt dat een dag). */
export function vandaagLokaal(){
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
/* 1 = ma … 7 = zo, zelfde nummering als team.trainingsdagen. */
export function dagVan(iso){
  const g = new Date(String(iso) + 'T12:00').getDay();
  return ((g + 6) % 7) + 1;
}
export function plusDagen(iso, n){
  const d = new Date(String(iso) + 'T12:00'); d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

const isOud = u => !u || !u.soort;
const vanafVan = u => u?.soort === 'wedstrijd' ? (u.wedstrijd?.datum || null) : (u?.vanaf || null);

/* Loopt (of komt) de uitlening nog? Alleen een verstreken `tot` maakt hem voorbij. */
export function leenActief(u, vandaag = vandaagLokaal()){
  if (!u) return false;
  if (u.beeindigd) return false;
  return !u.tot || u.tot >= vandaag;
}
/* Valt deze datum binnen de periode van de uitlening? */
export function inPeriode(u, datum){
  if (isOud(u)) return true;
  if (!datum) return true;
  const v = vanafVan(u);
  if (v && datum < v) return false;
  if (u.tot && datum > u.tot) return false;
  return true;
}
const conflictKeuze = (u, datum) => (u?.conflicten || {})[datum] || 'beide';

/* ---------- Ontvangend team ---------- */
export function geldtVoorWedstrijdBijNaar(u, w){
  if (isOud(u)) return true;
  if (!w) return false;
  if (conflictKeuze(u, w.datum) === 'van') return false;
  if (u.soort === 'wedstrijd') return !!u.wedstrijd && u.wedstrijd.id === w.id;
  if (u.wat === 't') return false;
  if (!inPeriode(u, w.datum)) return false;
  if (Array.isArray(u.wedstrijden)) return u.wedstrijden.some(x => x.id === w.id);
  return true;
}
export function geldtVoorTrainingBijNaar(u, datum){
  if (isOud(u)) return true;
  if (u.soort === 'wedstrijd') return false;
  if (u.wat === 'w') return false;
  if (!inPeriode(u, datum)) return false;
  return (u.trainNaar || []).includes(dagVan(datum));
}

/* ---------- Eigen team (uitgaand) ---------- */
export function blijftBijEigenWedstrijd(u, w){
  if (isOud(u) || !w) return true;
  if (!inPeriode(u, w.datum)) return true;
  return conflictKeuze(u, w.datum) !== 'naar';
}
export function blijftBijEigenTraining(u, datum){
  if (isOud(u) || u.soort === 'wedstrijd') return true;
  if (u.wat === 'w') return true;
  if (!inPeriode(u, datum)) return true;
  if (!Array.isArray(u.trainVan)) return true;
  const dag = dagVan(datum);
  if (u.trainVan.includes(dag)) return true;
  /* Alleen weg bij het eigen team op een dag waarop hij bij het andere team
     traint, of op een eigen trainingsdag die de coördinator op Niet zette.
     Op andere dagen (bv. een extra training) blijft hij gewoon bij zijn team. */
  return !((u.trainNaar || []).includes(dag) || (u.trainVanNiet || []).includes(dag));
}

/* ---------- Spelerslijsten per activiteit ----------
   `spelers` is S.spelers (samengesteld in herbouwSpelers). Geeft de spelers
   die bij DEZE activiteit horen, plus wie er van het eigen team elders is
   (om grijs te tonen met het team erbij). */
function verdeel(spelers, hoortErbij){
  const lijst = [], elders = [];
  for (const p of (spelers || [])){
    const r = hoortErbij(p);
    if (r === true) lijst.push(p);
    else if (r) elders.push({ p, team: r });
  }
  return { lijst, elders };
}
export function spelersOpTraining(spelers, datum){
  return verdeel(spelers, p => {
    if (p._leen) return geldtVoorTrainingBijNaar(p._leen, datum) ? true : null;
    const weg = (p._leningenUit || []).find(u => !blijftBijEigenTraining(u, datum));
    return weg ? (weg.naarTeamNaam || 'ander team') : true;
  });
}
export function spelersOpWedstrijd(spelers, w){
  return verdeel(spelers, p => {
    if (p._leen) return geldtVoorWedstrijdBijNaar(p._leen, w) ? true : null;
    const weg = (p._leningenUit || []).find(u => !blijftBijEigenWedstrijd(u, w));
    return weg ? (weg.naarTeamNaam || 'ander team') : true;
  });
}

/* Ingeleende spelers die bij deze wedstrijd horen, maar nog niet in de
   opgeslagen selectie staan en ook niet bewust zijn weggehaald (w.leenErbij
   onthoudt wie al eens is aangevuld). Zonder dit verschijnt een net
   uitgeleende speler als "niet in de selectie" tot iemand de wedstrijd opent. */
export function ontbrekendeLeners(w, spelers){
  if (!w || !Array.isArray(w.selectie) || !w.selectie.length) return [];
  const gehad = new Set(Array.isArray(w.leenErbij) ? w.leenErbij : []);
  const sel = new Set(w.selectie);
  return (spelers || [])
    .filter(p => p._ingeleend && p._leen && !sel.has(p.id) && !gehad.has(p.id) && geldtVoorWedstrijdBijNaar(p._leen, w))
    .map(p => p.id);
}
/* Selectie zoals die getoond moet worden: opgeslagen selectie + ontbrekende
   leners, zolang de wedstrijd nog niet voorbij is. */
export function effectieveSelectie(w, spelers, vandaag = vandaagLokaal()){
  const basis = Array.isArray(w?.selectie) ? w.selectie : [];
  if (!basis.length) return basis;
  if (w.datum && w.datum < vandaag) return basis;
  const extra = ontbrekendeLeners(w, spelers);
  return extra.length ? [...basis, ...extra] : basis;
}
/* Na het bewaren van een selectie: alle leners van deze wedstrijd tellen als
   "afgehandeld", zodat een bewust weggehaalde speler niet terugkeert. */
export function leenErbijNa(w, spelers){
  const gehad = new Set(Array.isArray(w?.leenErbij) ? w.leenErbij : []);
  for (const p of (spelers || [])) if (p._ingeleend && p._leen && geldtVoorWedstrijdBijNaar(p._leen, w)) gehad.add(p.id);
  return [...gehad];
}

/* ---------- Tekst voor overzichten ---------- */
const kortDatum = iso => {
  if (!iso) return '';
  const d = new Date(iso + 'T12:00');
  return d.toLocaleDateString('nl-NL', { weekday: 'short', day: 'numeric', month: 'short' }).replace('.', '');
};
export { kortDatum as leenDatum };

export function leenSoortLabel(u){
  if (isOud(u)) return 'Doorlopend';
  if (u.soort === 'wedstrijd') return 'Eén wedstrijd';
  return { w: 'Wedstrijden', t: 'Meetrainen', b: 'Wedstrijden + training' }[u.wat] || 'Uitgebreid';
}
/* Eén regel: wanneer en wat. */
export function leenOmschrijving(u){
  if (isOud(u)) return 'Geen einddatum, tot iemand hem terugzet';
  if (u.soort === 'wedstrijd'){
    const w = u.wedstrijd || {};
    return `${kortDatum(w.datum)}${w.aftrap ? ' ' + w.aftrap : ''}${w.tegenstander ? ' · ' + w.tegenstander : ''}`;
  }
  const delen = [];
  const vanaf = u.vanaf && u.vanaf > vandaagLokaal() ? `vanaf ${kortDatum(u.vanaf)}` : '';
  if (u.tot) delen.push((vanaf ? vanaf + ' ' : '') + `t/m ${kortDatum(u.tot)}`);
  else delen.push(vanaf || 'geen einddatum');
  if (u.wat !== 't' && Array.isArray(u.wedstrijden)) delen.push(`${u.wedstrijden.length} wedstrijd${u.wedstrijden.length === 1 ? '' : 'en'}`);
  if (u.wat !== 'w' && (u.trainNaar || []).length) delen.push(`traint ${u.trainNaar.map(d => DAG_NAMEN[d]).join(' + ')} bij ${u.naarTeamNaam || 'ander team'}`);
  return delen.join(' · ');
}
/* Status-chip: {tekst, toon:'ok'|'warn'|'' , voorbij, voortgang 0..1|null} */
export function leenStatus(u, vandaag = vandaagLokaal()){
  if (!leenActief(u, vandaag)) return { tekst: 'Voorbij', toon: '', voorbij: true, voortgang: 1 };
  if (isOud(u)) return { tekst: 'Doorlopend', toon: '', voorbij: false, voortgang: null };
  const v = vanafVan(u);
  if (v && v > vandaag) return { tekst: `Start ${kortDatum(v)}`, toon: 'ok', voorbij: false, voortgang: 0 };
  let voortgang = null;
  if (u.soort === 'periode' && u.wat !== 't' && Array.isArray(u.wedstrijden) && u.wedstrijden.length){
    const gespeeld = u.wedstrijden.filter(x => x.datum && x.datum < vandaag).length;
    voortgang = gespeeld / u.wedstrijden.length;
  } else if (u.tot && v && u.tot > v){
    const dag = 86400000, a = new Date(v + 'T12:00'), b = new Date(u.tot + 'T12:00'), n = new Date(vandaag + 'T12:00');
    voortgang = Math.max(0, Math.min(1, (n - a) / (b - a || dag)));
  }
  if (u.tot){
    const dagen = Math.round((new Date(u.tot + 'T12:00') - new Date(vandaag + 'T12:00')) / 86400000);
    if (dagen <= 7) return { tekst: dagen <= 0 ? 'Laatste dag' : `Loopt af ${kortDatum(u.tot)}`, toon: 'warn', voorbij: false, voortgang };
  }
  return { tekst: 'Loopt', toon: 'ok', voorbij: false, voortgang };
}
