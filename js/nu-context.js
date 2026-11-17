/* ==================== NU-CONTEXT (testversie) ====================
   Bepaalt welke informatie een coach NU als eerste moet zien.
   Pure functie: geen import uit state.js (dus geen versie-cascade), geen
   Firestore, geen DOM. Krijgt alles als argument en geeft een beschrijving
   terug waar de UI van het "Nu-scherm" op bouwt.

   Invoer (zelfde vorm als de echte data):
     nu         Date
     team       { trainingsmomenten:[{dag 1-7 (ma=1), start:'18:30', eind:'19:45'}] }
     wedstrijden[{ id, datum:'YYYY-MM-DD', aftrap:'09:30', tegenstander, thuis:bool,
                   locatie, duur (min, standaard 70), gestart:bool, afgerond:bool,
                   selectie:[], opstellingGedeeld:bool, beschikbaar:{ja,totaal} }]
     presentie  { 'YYYY-MM-DD': { ja, totaal, afgerond:bool } }
     plek       'club' | 'elders' | 'onbekend'      (afgeleid uit GPS, zie nu-test.js)

   Uitvoer: { soort, fase, event, daarna[], reden, opLocatie }
   soort:  'live' | 'na' | 'wedstrijd' | 'dagervoor' | 'training' | 'rust'
   fase:   per soort, zie onderaan                                           */

export const VENSTER = {
  trainingVoor: 180,        // min voor start: training komt bovenaan
  trainingNa: 60,           // min na einde: presentie nog afronden
  wedstrijdNa: 180,         // min na einde: uitslag/afronden
  dagErvoorVanaf: 17,       // uur: avond voor de wedstrijd
  clubAanloop: 45,          // min voor start: locatie telt mee
  verzamelVoor: 60,         // min voor aftrap: verzamelen
  standaardDuur: 70,        // wedstrijdduur als w.duur ontbreekt
};

const MIN = 60 * 1000;

function iso(d){
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
function metTijd(datum, hhmm){
  const [j, m, d] = datum.split('-').map(Number);
  const [u, mi] = (hhmm || '00:00').split(':').map(Number);
  return new Date(j, m - 1, d, u, mi, 0, 0);
}
function isoWeekdag(d){ return ((d.getDay() + 6) % 7) + 1; }   // ma=1 … zo=7

/* Alle evenementen (trainingen + wedstrijden) rond "nu", gesorteerd op start. */
export function evenementen(nu, team, wedstrijden, dagenVooruit = 10){
  const ev = [];
  const moments = Array.isArray(team?.trainingsmomenten) ? team.trainingsmomenten : [];
  for (let i = -1; i <= dagenVooruit; i++){
    const dag = new Date(nu.getFullYear(), nu.getMonth(), nu.getDate() + i, 12);
    const wd = isoWeekdag(dag);
    for (const m of moments){
      if (Number(m.dag) !== wd || !m.start) continue;
      const datum = iso(dag);
      const start = metTijd(datum, m.start);
      const eind = m.eind ? metTijd(datum, m.eind) : new Date(start.getTime() + 75 * MIN);
      ev.push({ type: 'training', id: 't-' + datum, datum, start, eind });
    }
  }
  for (const w of (wedstrijden || [])){
    if (!w.datum || !w.aftrap) continue;
    const start = metTijd(w.datum, w.aftrap);
    const eind = new Date(start.getTime() + (w.duur || VENSTER.standaardDuur) * MIN);
    ev.push({ type: 'wedstrijd', id: w.id, datum: w.datum, start, eind, w });
  }
  return ev.sort((a, b) => a.start - b.start);
}

const minuten = (a, b) => Math.round((b - a) / MIN);          // b - a in minuten

export function bepaalNu({ nu, team, wedstrijden, presentie, plek }){
  const ev = evenementen(nu, team, wedstrijden);
  const vandaag = iso(nu);
  const morgen = iso(new Date(nu.getFullYear(), nu.getMonth(), nu.getDate() + 1, 12));
  const opClub = plek === 'club';
  const rest = (hoofd) => ev.filter(e => e.start > nu && e !== hoofd && e.id !== hoofd?.id).slice(0, 3);
  const uit = (o) => ({ opLocatie: false, ...o });

  /* 1. Wedstrijd bezig (gestart-vlag, of binnen de speeltijd) */
  const bezig = ev.find(e => e.type === 'wedstrijd' && !e.w.afgerond &&
    (e.w.gestart || (nu >= e.start && nu <= e.eind)));
  if (bezig){
    return uit({ soort: 'live', fase: 'bezig', event: bezig, daarna: rest(bezig),
      opLocatie: opClub, reden: 'Er loopt een wedstrijd: alleen klok, wissels en doelpunten.' });
  }

  /* 2. Wedstrijd net afgelopen */
  const afgelopen = ev.filter(e => e.type === 'wedstrijd' && !e.w.afgerond &&
    nu > e.eind && minuten(e.eind, nu) <= VENSTER.wedstrijdNa).pop();
  if (afgelopen){
    return uit({ soort: 'na', fase: 'afronden', event: afgelopen, daarna: rest(afgelopen), opLocatie: opClub,
      reden: `De wedstrijd is ${minuten(afgelopen.eind, nu)} min geleden afgelopen: nu afronden.` });
  }

  /* 3. Wedstrijddag, voor aanvang */
  const wedVandaag = ev.find(e => e.type === 'wedstrijd' && e.datum === vandaag && e.start > nu);
  if (wedVandaag){
    const totStart = minuten(nu, wedVandaag.start);
    const fase = opClub && totStart <= VENSTER.clubAanloop ? 'opclub'
               : totStart <= VENSTER.verzamelVoor ? 'verzamelen' : 'voor';
    return uit({ soort: 'wedstrijd', fase, event: wedVandaag, daarna: rest(wedVandaag), opLocatie: opClub && fase === 'opclub',
      reden: fase === 'opclub' ? 'Wedstrijddag en je bent op de club: klaar voor wedstrijdmodus.'
           : 'Wedstrijddag: tijden, route en opstelling in één blik.' });
  }

  /* 4. Avond voor de wedstrijd */
  const wedMorgen = ev.find(e => e.type === 'wedstrijd' && e.datum === morgen);
  if (wedMorgen && nu.getHours() >= VENSTER.dagErvoorVanaf){
    return uit({ soort: 'dagervoor', fase: wedMorgen.w.opstellingGedeeld ? 'klaar' : 'open', event: wedMorgen, daarna: rest(wedMorgen),
      reden: 'Het is de avond voor de wedstrijd: opstelling klaarzetten en delen.' });
  }

  /* 5. Trainingsdag (van 3 uur voor start tot 1 uur na einde) */
  const tr = ev.find(e => e.type === 'training' && e.datum === vandaag &&
    minuten(nu, e.start) <= VENSTER.trainingVoor && minuten(e.eind, nu) <= VENSTER.trainingNa);
  if (tr){
    const p = presentie?.[tr.datum];
    let fase;
    if (nu >= tr.eind) fase = 'na';
    else if (nu >= tr.start) fase = 'bezig';
    else if (opClub && minuten(nu, tr.start) <= VENSTER.clubAanloop) fase = 'opclub';
    else fase = 'voor';
    if (fase === 'na' && p?.afgerond){ /* presentie al klaar: geen reden meer om dit te tonen */ }
    else return uit({ soort: 'training', fase, event: tr, daarna: rest(tr), opLocatie: opClub && (fase === 'opclub' || fase === 'bezig'),
      reden: fase === 'opclub' ? 'Trainingsdag en je bent bij de club: direct starten of afvinken.'
           : fase === 'na' ? 'Training is net afgelopen: presentie afronden.'
           : 'Trainingsdag: het plan staat bovenaan.' });
  }

  /* 6. Anders: de eerstvolgende activiteit */
  const volgende = ev.find(e => e.start > nu);
  return uit({ soort: 'rust', fase: 'wacht', event: volgende || null, daarna: volgende ? rest(volgende) : [],
    reden: 'Geen training of wedstrijd nu: je ziet wat er het eerst aankomt.' });
}

/* ==================== DAARNA (17 nov) ====================
   Wat er onder de kaart staat, in volgorde van belang:
     1  de eerstvolgende activiteit van de ANDERE soort dan de kaart (kaart =
        training: de eerstvolgende wedstrijd, en omgekeerd). Die staat er altijd.
     2  één bijzondere dag uit de Planning binnen `dagenPlanning` dagen: een
        eigen dag, een clubactiviteit uit Sportlink (ledenvergadering, clubavond),
        of een KNVB-dag vrij / beker / inhaal waarvoor in dat weekend nog geen
        echte wedstrijd staat. Het is er één: de eerstvolgende.
     3  wat er verder aankomt, tot `max` regels in totaal.
   De regels komen op datum terug, elk met `prio`; het passend startscherm
   (pasHubAan) laat bij ruimtegebrek eerst prio 3 en dan prio 2 vallen.

   Invoer:
     events     uit evenementen(): trainingen en wedstrijden mét tijd
     losse      uit losseEvenementen(): activiteiten zonder tijd (alleen een dag)
     planning   uit planningItems() in teams.js: {bron, type, datum, knvbDatum, label, opmerking}
     wedstrijdDatums  alle datums waarop het team een wedstrijd heeft
     afgelast   functie(event) -> true als de activiteit niet doorgaat; zo'n
                activiteit telt niet als "de eerstvolgende" zolang er een andere is */
const BIJZONDER = ['vrij', 'beker', 'inhaal', 'eigen'];
export function kiesDaarna({ nu, hoofd, events, losse, planning, wedstrijdDatums, afgelast, dagenPlanning = 14, max = 4 }){
  const vandaag = iso(nu);
  const eind = iso(new Date(nu.getFullYear(), nu.getMonth(), nu.getDate() + dagenPlanning, 12));
  const isHoofd = e => !!hoofd && (e === hoofd || e.id === hoofd.id);
  const p2 = n => String(n).padStart(2, '0');
  /* binnen een dag: eerst dagen zonder tijd, dan alles met een tijd op volgorde, dan activiteiten zonder tijd */
  const dagTijd = r => { const m = /^(\d{1,2}):(\d{2})/.exec(r.item?.tijd || ''); return m ? ` 1${p2(m[1])}:${m[2]}` : ' 0'; };
  const sleutel = r => r.datum + (r.type === 'dag' ? dagTijd(r) : r.zonderTijd ? ' 2' : ` 1${p2(r.start.getHours())}:${p2(r.start.getMinutes())}`);
  const alle = [
    ...(events || []).filter(e => e.start > nu && !isHoofd(e)),
    ...(losse || []).filter(e => e.datum >= vandaag && !isHoofd(e)),
  ].sort((a, b) => sleutel(a).localeCompare(sleutel(b)));

  const gekozen = new Map();                       // event/dag -> prio
  const soorten = hoofd ? [hoofd.type === 'training' ? 'wedstrijd' : 'training'] : ['wedstrijd', 'training'];
  const gaatDoor = e => !(typeof afgelast === 'function' && afgelast(e));
  for (const s of soorten){ const e = alle.find(x => x.type === s && gaatDoor(x)) || alle.find(x => x.type === s); if (e) gekozen.set(e, 1); }

  const datums = wedstrijdDatums instanceof Set ? wedstrijdDatums : new Set(wedstrijdDatums || []);
  const dag = (planning || [])
    .filter(it => it && it.datum >= vandaag && it.datum <= eind)
    /* [20261117c] ook clubactiviteiten (bron 'club') tellen als bijzondere dag */
    .filter(it => it.bron === 'eigen' || it.bron === 'club' || (it.bron === 'knvb' && BIJZONDER.includes(it.type)))
    .filter(it => it.bron !== 'knvb' || !(datums.has(it.datum) || datums.has(it.knvbDatum)))
    .sort((a, b) => a.datum.localeCompare(b.datum))[0];
  if (dag) gekozen.set({ type: 'dag', id: 'dag-' + dag.datum, datum: dag.datum, item: dag }, 2);

  for (const e of alle){ if (gekozen.size >= max) break; if (!gekozen.has(e)) gekozen.set(e, 3); }
  return [...gekozen].map(([e, prio]) => ({ ...e, prio })).sort((a, b) => sleutel(a).localeCompare(sleutel(b)));
}

/* Activiteiten waarvan alleen de dag bekend is: een wedstrijd zonder aanvangstijd
   en een training op een trainingsdag zonder ingestelde tijd. Ze staan niet in
   evenementen() (daar is een tijd nodig om "nu" te bepalen), wel onder Daarna. */
export function losseEvenementen(nu, team, wedstrijden, dagenVooruit = 10){
  const vandaag = iso(nu), ev = [];
  const moments = (Array.isArray(team?.trainingsmomenten) ? team.trainingsmomenten : []).filter(m => !m.start);
  for (let i = 0; i <= dagenVooruit && moments.length; i++){
    const dag = new Date(nu.getFullYear(), nu.getMonth(), nu.getDate() + i, 12);
    if (moments.some(m => Number(m.dag) === isoWeekdag(dag))) ev.push({ type: 'training', id: 't-' + iso(dag), datum: iso(dag), zonderTijd: true });
  }
  for (const w of (wedstrijden || [])){
    if (!w.datum || w.aftrap || w.datum < vandaag) continue;
    ev.push({ type: 'wedstrijd', id: w.id, datum: w.datum, zonderTijd: true, w });
  }
  return ev;
}

/* Afstand in meter (haversine), voor de echte GPS-variant. */
export function afstandMeter(a, b){
  const R = 6371000, r = x => x * Math.PI / 180;
  const dLat = r(b.lat - a.lat), dLng = r(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(r(a.lat)) * Math.cos(r(b.lat)) * Math.sin(dLng / 2) ** 2;
  return Math.round(2 * R * Math.asin(Math.sqrt(h)));
}
