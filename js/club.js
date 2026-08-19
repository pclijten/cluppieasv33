import {
  db, storage, collection, doc, addDoc, deleteDoc, updateDoc, deleteField, getDoc, setDoc, getDocs,
  query, where, onSnapshot, serverTimestamp, documentId, writeBatch,
  sRef, uploadBytes, getDownloadURL, deleteObject,
  functions, httpsCallable
} from './firebase.js?v=20260811a';
import {
  S, $, $$, esc, meld, nieuweCode, teamCode, clubAfkorting, openModal, sluitModal, toon, stopUnsubs, initialen, isBeheerder
} from './state.js?v=20260819c';
import { CATEGORIEEN, CATEGORIEEN_MEIDEN, catInfo, BOUWEN, bouwVanCategorie, bouwNaam, youtubeId, youtubeThumb, youtubeWatch, SEIZOEN_FALLBACK, GEBRUIK_CATEGORIEEN, gebruikEventLabel } from './config.js?v=20260819c';
import { analyseWedstrijd } from './analyse.js?v=20260819c';
import { clubEvaluatiesOphalen, htmlClubEvaluaties, koppelClubEvaluaties } from './club-evaluaties.js?v=20260819c';
import { startClubContentListener, htmlClubContent, koppelClubContent } from './club-content.js?v=20260819c';
import { telGebruik, telNav } from './tracker.js?v=20260819c';
import { ico } from './icons.js?v=20260818e';

/* drempels voor het clubdashboard ("aandacht nodig") */
const DASH_DAGEN_INACTIEF = 14;
const DASH_OPKOMST_LAAG = 50;

/* categorieën voor het documenten-tabblad — bewust geen bouw-indeling zoals
   bij trainingen/video's: documenten (beleid, formulieren) zijn doorgaans
   niet leeftijdsgebonden maar wel van verschillend type. */
const DOC_CATEGORIEN = [
  {id:'knvb',       naam:'KNVB'},
  {id:'beleid',     naam:'Beleid'},
  {id:'overig',     naam:'Overig'},
];

/* openTeam en modalNieuwTeam komen uit teams.js; om kringverwijzing te
   vermijden importeren we ze lui binnen de functies die ze nodig hebben. */
async function teamsModule(){ return await import('./teams.js?v=20260819c'); }

/* ==================== CLUB AANMAKEN ==================== */
export function modalNieuwClub(){
  openModal(`
    <h2>🏛 Nieuwe club</h2>
    <p style="font-size:calc(13px * var(--fs));color:var(--ink-2);margin-bottom:12px">Als club-admin maak jij teams aan en deel je trainingen voor alle teams. Coaches nodig je uit met een persoonlijke teamlink.</p>
    <div class="veldgroep"><label>Clubnaam</label>
      <input class="invoer" id="mClubNaam" placeholder="Bijv. RKVV Mifano" autocomplete="off"></div>
    <button class="knop vol" id="mClubOk">Club aanmaken</button>`);
  $('#mClubOk').onclick = async () => {
    const naam = $('#mClubNaam').value.trim();
    if (!naam) return meld('Vul een clubnaam in');
    const ref = await addDoc(collection(db,'clubs'), {
      naam, code: nieuweCode(),
      admins: {[S.user.uid]: true},
      adminsInfo: {[S.user.uid]: {naam: S.user.displayName || S.user.email}},
      leden: {[S.user.uid]: true},
      teams: {},
      gemaakt: serverTimestamp(),
    });
    sluitModal(); openClub(ref.id);
  };
}

export function openClub(clubId){
  S.clubId = clubId; S.clubTab = 'hub'; S.teamId = null;
  S.clubTrainBouw = S.clubTrainBouw || 'onder';
  stopUnsubs('club');
  S.unsub.club = onSnapshot(doc(db,'clubs',clubId), snap => {
    if (!snap.exists()){ verlaatClubView(); return; }
    S.club = {id:snap.id, ...snap.data()};
    renderClub();
  }, (err) => {
    console.error(`[Cluppie] Listener "club" kon niet lezen (clubId=${clubId}):`, err.code, err.message);
    if (err.code === 'permission-denied') meld('Geen toegang tot deze club — controleer de Firestore-rules');
  });
  toon('club');
  telNav('club:hub', 'open');
}

export function verlaatClubView(){
  stopUnsubs('club', 'clubContent');
  S.clubId = null; S.club = null;
  import('./teams.js?v=20260819c').then(m => { m.renderTeams(); toon('teams'); });
}

async function clubTeamsOphalen(){
  const ids = Object.keys(S.club.teams || {});
  if (!ids.length) return [];
  const result = [];
  for (let i = 0; i < ids.length; i += 30){
    const chunk = ids.slice(i, i+30);
    const snap = await getDocs(query(collection(db,'teams'), where(documentId(), 'in', chunk)));
    snap.docs.forEach(d => result.push({id:d.id, ...d.data()}));
  }
  return result.sort((a,b) => (a.naam||'').localeCompare(b.naam||''));
}

async function clubTrainingenOphalen(){
  const snap = await getDocs(query(collection(db,'trainingen'), where('club','==',S.clubId)));
  return snap.docs.map(d => ({id:d.id, ...d.data()}))
    .sort((a,b) => (b.week||'').localeCompare(a.week||'') || (b.gemaakt?.seconds||0) - (a.gemaakt?.seconds||0));
}

async function clubVideosOphalen(){
  const snap = await getDocs(query(collection(db,'videos'), where('club','==',S.clubId)));
  return snap.docs.map(d => ({id:d.id, ...d.data()}))
    .sort((a,b) => (b.gemaakt?.seconds||0) - (a.gemaakt?.seconds||0));
}

async function clubDocumentenOphalen(){
  const snap = await getDocs(query(collection(db,'documenten'), where('club','==',S.clubId)));
  return snap.docs.map(d => ({id:d.id, ...d.data()}))
    .sort((a,b) => (b.gemaakt?.seconds||0) - (a.gemaakt?.seconds||0));
}

/* berichten van de club (admin-weergave), nieuw → oud */
async function clubBerichtenOphalen(){
  const snap = await getDocs(query(collection(db,'berichten'), where('club','==',S.clubId)));
  return snap.docs.map(d => ({id:d.id, ...d.data()}))
    .sort((a,b) => (b.gemaakt?.seconds||0) - (a.gemaakt?.seconds||0));
}

/* afgelast-historie: centrale lijst onder clubs/{clubId}/afgelastingen (nieuw → oud) */
async function clubAfgelastingenOphalen(){
  const snap = await getDocs(collection(db,'clubs',S.clubId,'afgelastingen'));
  return snap.docs.map(d => ({id:d.id, ...d.data()}))
    .sort((a,b) => (b.datum||'').localeCompare(a.datum||''));
}

/* Sportlink-syncstatus per team uit clubs/{clubId}/geheim/{teamId}.
   Het geheim-doc is sinds de Club.Dataservice-koppeling puur een status/cache-
   store (geen tokens meer): we lezen of het team bij de laatste sync op naam
   gematcht is, plus de statusvelden. */
async function clubSyncStatusOphalen(teams){
  const status = {};
  await Promise.all(teams.map(async t => {
    try {
      const snap = await getDoc(doc(db,'clubs',S.clubId,'geheim',t.id));
      if (snap.exists()){
        const d = snap.data();
        status[t.id] = {
          gematcht: !!d.gematcht,
          laatsteSync: d.laatsteSync || null,
          laatsteAantal: d.laatsteAantal ?? null,
          laatsteFout: d.laatsteFout || null,
        };
      } else {
        status[t.id] = { gematcht: false };
      }
    } catch(e){
      status[t.id] = { gematcht: false };
    }
  }));
  return status;
}

/* 'YYYY-MM-DD' -> 'do 25 jun' (kort, voor de statslijst) */
function afgKort(datum){
  try { return new Date(datum+'T12:00').toLocaleDateString('nl-NL',{weekday:'short',day:'numeric',month:'short'}); }
  catch { return datum; }
}

/* ==================== CLUBDASHBOARD ====================
   Eén leesactie per team voor spelers/wedstrijden/presentie — alleen
   uitgevoerd als het dashboard-tabblad ook echt open staat (zie renderClub),
   net als de voetbal.nl-syncstatus die ook alleen op de instel-tab leest. */
function dagenSinds(datum){
  try { return Math.floor((Date.now() - new Date(datum+'T12:00').getTime()) / 86400000); }
  catch { return null; }
}
function dashActiviteitTekst(dagen){
  if (dagen === 0) return 'Vandaag';
  if (dagen === 1) return 'Gisteren';
  return `${dagen} dagen geleden`;
}
function dashOpkomstKlasse(p){ return p>=80?'goed':p>=DASH_OPKOMST_LAAG?'matig':'laag'; }

async function clubDashboardOphalen(teams){
  // Alleen het huidige seizoen — anders groeit deze leesactie elk seizoen mee
  // met de volledige clubhistorie, ook al gaat het dashboard over "nu".
  // Spelers blijven ongefilterd (geen seizoen-veld, en de huidige selectie
  // is altijd relevant).
  const seizoenFilter = S.huidigSeizoen ? [where('seizoen','==',S.huidigSeizoen)] : [];
  return Promise.all(teams.map(async t => {
    const [spelersSnap, wedstrijdenSnap, presentieSnap] = await Promise.all([
      getDocs(collection(db,'teams',t.id,'spelers')),
      getDocs(query(collection(db,'teams',t.id,'wedstrijden'), ...seizoenFilter)),
      getDocs(query(collection(db,'teams',t.id,'presentie'), ...seizoenFilter)),
    ]);
    const spelersAantal = spelersSnap.size;
    const wedstrijden = wedstrijdenSnap.docs.map(d => d.data());
    const presentie = presentieSnap.docs.map(d => d.data());

    let opkomstPct = null;
    if (presentie.length && spelersAantal){
      let totAanwezig = 0;
      for (const p of presentie) totAanwezig += spelersAantal - (p.afwezig||[]).length;
      opkomstPct = Math.round((totAanwezig / (presentie.length * spelersAantal)) * 100);
    }

    const activiteiten = [];
    for (const w of wedstrijden){
      if (!w.datum) continue;
      const heeftUitslag = (w.goals||[]).length || analyseWedstrijd(w).kwarten;
      if (!heeftUitslag) continue;
      const voor = (w.goals||[]).filter(g => g.type==='voor').length;
      const tegen = (w.goals||[]).filter(g => g.type==='tegen').length;
      const ww = voor > tegen ? `won met ${voor}-${tegen} van` : voor < tegen ? `verloor met ${voor}-${tegen} van` : `speelde ${voor}-${tegen} gelijk tegen`;
      activiteiten.push({
        soort:'wedstrijd', datum:w.datum,
        tekst: `${ww} ${w.tegenstander||'onbekend'}`,
      });
    }
    for (const p of presentie){
      if (!p.datum) continue;
      const aanwezig = spelersAantal - (p.afwezig||[]).length;
      activiteiten.push({ soort:'presentie', datum:p.datum, tekst:`presentie: ${aanwezig}/${spelersAantal} aanwezig` });
    }
    const laatsteDatum = activiteiten.length ? activiteiten.map(a => a.datum).sort().at(-1) : null;

    return {
      team:t, spelersAantal, coachesAantal: Object.keys(t.leden||{}).length,
      wedstrijdenAantal: wedstrijden.length, opkomstPct, laatsteDatum, activiteiten,
      heeftCategorie: !!t.categorie,
    };
  }));
}

/* Bereken de aandacht-signalen (gedeeld door de Aandacht-badge én -scherm). */
function clubSignalen(dash){
  const signalen = [];
  for (const d of dash){
    const dagen = d.laatsteDatum ? dagenSinds(d.laatsteDatum) : null;
    if (dagen === null || dagen > DASH_DAGEN_INACTIEF){
      signalen.push({ team:d.team.naam, ernstig:true,
        reden: dagen === null ? 'Nog geen presentie of wedstrijd geregistreerd' : `Geen presentie of wedstrijd sinds ${dagen} dagen` });
    }
    if (!d.heeftCategorie){
      signalen.push({ team:d.team.naam, ernstig:false, reden:'Geen categorie ingesteld — speeltijden kloppen mogelijk niet' });
    }
    if (d.opkomstPct != null && d.opkomstPct < DASH_OPKOMST_LAAG){
      signalen.push({ team:d.team.naam, ernstig:false, reden:`Trainingsopkomst ${d.opkomstPct}% — laag` });
    }
  }
  signalen.sort((a,b) => (b.ernstig?1:0) - (a.ernstig?1:0));
  return signalen;
}

/* Dashboard-scherm 1: Overzicht — KPI-blokjes, teams-tabel, recente activiteit. */
function htmlDashOverzicht(teams, dash){
  if (!teams.length) return `<div class="kaart leeg">Nog geen teams in deze club.<br>Zodra er teams, wedstrijden en trainingen zijn, verschijnt hier een overzicht.</div>`;

  const totSpelers = dash.reduce((s,d) => s + d.spelersAantal, 0);
  const totCoaches = dash.reduce((s,d) => s + d.coachesAantal, 0);
  const wedstrijdenWeek = dash.reduce((s,d) => s + d.activiteiten.filter(a => a.soort==='wedstrijd' && dagenSinds(a.datum) <= 7).length, 0);

  const sortDesc = (S.clubDashSort ?? 'desc') === 'desc';
  const gesorteerd = dash.map(d => ({...d, dagen: d.laatsteDatum ? dagenSinds(d.laatsteDatum) : Infinity}))
    .sort((a,b) => sortDesc ? b.dagen - a.dagen : a.dagen - b.dagen);

  const feed = dash.flatMap(d => d.activiteiten.map(a => ({...a, team:d.team.naam})))
    .sort((a,b) => b.datum.localeCompare(a.datum)).slice(0,8);

  return `
    <div class="overzicht-blokjes">
      <div class="ov-blok"><div class="ov-getal">${teams.length}</div><div class="ov-label">teams</div></div>
      <div class="ov-blok"><div class="ov-getal">${totSpelers}</div><div class="ov-label">spelers</div></div>
      <div class="ov-blok"><div class="ov-getal">${totCoaches}</div><div class="ov-label">coaches</div></div>
      <div class="ov-blok ov-wedstrijden"><div class="ov-getal">${wedstrijdenWeek}</div><div class="ov-label">wedstr. 7 dgn</div></div>
    </div>

    <div class="kaart">
      <div class="sectie-kop" style="margin-top:0">
        Teams
        <button class="actie" id="dashSort" style="margin-left:auto;font-size:calc(11px * var(--fs));font-weight:700;color:var(--ink-2);text-transform:uppercase;letter-spacing:.3px">Activiteit ${sortDesc?'↓':'↑'}</button>
      </div>
      <table class="stat-tabel">
        <thead><tr><th>Team</th><th>Activiteit</th><th>Opkomst</th><th>Spelers</th></tr></thead>
        <tbody>${gesorteerd.map(d => `
          <tr data-dash-team="${d.team.id}" style="cursor:pointer">
            <td class="naam-cel">${esc(d.team.naam)}</td>
            <td style="${d.dagen !== Infinity && d.dagen > DASH_DAGEN_INACTIEF ? 'color:var(--uit)' : ''}">${d.laatsteDatum ? dashActiviteitTekst(d.dagen) : '—'}</td>
            <td class="opkomst-cel ${d.opkomstPct==null?'':dashOpkomstKlasse(d.opkomstPct)}">${d.opkomstPct==null?'—':d.opkomstPct+'%'}</td>
            <td>${d.spelersAantal}</td>
          </tr>`).join('')}</tbody>
      </table>
    </div>

    <div class="kaart">
      <div class="sectie-kop" style="margin-top:0">Recente activiteit</div>
      ${feed.length ? feed.map(a => `
        <div class="training-rij">
          <div class="ico">${a.soort==='wedstrijd'?'⚽':'📋'}</div>
          <div class="t"><div class="t-titel">${esc(a.team)}</div>
            <div class="t-meta">${esc(a.tekst)} · ${esc(afgKort(a.datum))}</div></div>
        </div>`).join('') : `<p style="font-size:calc(13px * var(--fs));color:var(--ink-2)">Nog geen wedstrijden of presentie geregistreerd.</p>`}
    </div>`;
}

/* Dashboard-scherm 2: Aandacht — de signalen als lijst. */
function htmlDashAandacht(dash){
  const signalen = clubSignalen(dash);
  return `
    <div class="kaart">
      ${signalen.length ? `
        <div class="caf-historie">
          ${signalen.map(s => `
            <div class="caf-rij">
              <span class="caf-rij-datum" style="${s.ernstig?'color:var(--uit)':''}">${esc(s.team)}</span>
              <span class="caf-rij-reden">${esc(s.reden)}</span>
            </div>`).join('')}
        </div>` : `<p style="font-size:calc(13px * var(--fs));color:var(--ink-2)">✅ Alle teams zijn actief en up-to-date.</p>`}
    </div>`;
}

/* Dashboard-scherm 3: Gebruik — logins + functiegebruik. */
function htmlDashGebruik(gebruik){
  return htmlClubGebruik(gebruik) + htmlClubFunctiegebruik(gebruik);
}

/* ==================== GEBRUIKSSTATISTIEKEN (logins) ====================
   Wie hoort bij deze club? Coaches van alle teams + club-admins. Alleen
   logins van die uid's tellen mee, zodat het overzicht per club klopt. */
function clubRelevanteUids(teams){
  const set = new Set(Object.keys(S.club.admins || {}));
  for (const t of teams) for (const uid of Object.keys(t.leden||{})) set.add(uid);
  return set;
}

/* logins van de laatste ~26 weken in één keer ophalen (dekt dag/week/maand-
   weergave zonder opnieuw te hoeven lezen bij het wisselen van periode),
   plus de gebruikers-samenvatting (naam, laatste login, totaal aantal). */
async function clubGebruikOphalen(teams){
  const relevantUids = clubRelevanteUids(teams);
  if (!relevantUids.size) return { logins:[], gebruikers:[] };

  const vanaf = new Date(Date.now() - 185*24*3600*1000).toISOString().slice(0,10);
  const loginsSnap = await getDocs(query(collection(db,'logins'), where('datum','>=',vanaf)));
  const logins = loginsSnap.docs.map(d => d.data()).filter(l => relevantUids.has(l.uid));

  const ids = [...relevantUids];
  const gebruikers = [];
  for (let i = 0; i < ids.length; i += 30){
    const chunk = ids.slice(i, i+30);
    const snap = await getDocs(query(collection(db,'gebruikers'), where(documentId(), 'in', chunk)));
    snap.docs.forEach(d => gebruikers.push({id:d.id, ...d.data()}));
  }
  gebruikers.sort((a,b) => (b.aantalLogins||0) - (a.aantalLogins||0));

  // Functiegebruik: documenten gebruik/{uid}_{datum} met per-event tellingen,
  // over hetzelfde venster. Op datum gefilterd, daarna op relevante uid.
  const gebruikSnap = await getDocs(query(collection(db,'gebruik'), where('datum','>=',vanaf)));
  const gebruikDocs = gebruikSnap.docs.map(d => d.data()).filter(g => relevantUids.has(g.uid));
  const naamPerUid = {};
  gebruikers.forEach(g => { naamPerUid[g.id] = g.naam || g.email || 'Onbekend'; });

  // Navigatiepaden: documenten navpaden/{uid}_{sessieId} met geordende stappen.
  // Zelfde datum-venster; daarna op relevante uid. Faalt zacht — een dashboard
  // zonder navpad-data toont gewoon een lege staat i.p.v. te breken.
  let navpaden = [];
  try {
    const navSnap = await getDocs(query(collection(db,'navpaden'), where('datum','>=',vanaf)));
    navpaden = navSnap.docs.map(d => d.data()).filter(n => relevantUids.has(n.uid));
  } catch(e){ console.warn('[club] navpaden ophalen mislukt:', e?.code || e?.message); }

  return { logins, gebruikers, gebruikDocs, naamPerUid, navpaden };
}

/* Groepeer de functiegebruik-documenten per periode (dag/week/maand), en bereken
   per event het clubtotaal + de uitsplitsing per gebruiker. Alleen documenten
   binnen de gekozen periode tellen mee. */
function gebruikAggregeer(gebruikDocs, naamPerUid, periode){
  const nu = new Date();
  let vanafDatum;
  if (periode === 'dag') vanafDatum = new Date(nu.getTime() - 1*86400000);
  else if (periode === 'week') vanafDatum = new Date(nu.getTime() - 7*86400000);
  else vanafDatum = new Date(nu.getFullYear(), nu.getMonth()-1, nu.getDate());
  const grens = vanafDatum.toISOString().slice(0,10);

  const perEvent = {};       // ev -> totaal
  const perEventGebr = {};   // ev -> {uid: n}
  for (const g of gebruikDocs){
    if (!g.datum || g.datum < grens) continue;
    const t = g.tellingen || {};
    for (const [ev, n] of Object.entries(t)){
      if (typeof n !== 'number') continue;
      perEvent[ev] = (perEvent[ev]||0) + n;
      (perEventGebr[ev] ||= {});
      perEventGebr[ev][g.uid] = (perEventGebr[ev][g.uid]||0) + n;
    }
  }
  return { perEvent, perEventGebr };
}

function htmlClubFunctiegebruik(gebruik){
  const periode = S.clubGebruikPeriode || 'week';
  const { perEvent, perEventGebr } = gebruikAggregeer(gebruik.gebruikDocs || [], gebruik.naamPerUid || {}, periode);
  const totaalAlles = Object.values(perEvent).reduce((a,b)=>a+b, 0);

  const catBlok = (cat) => {
    // events van deze categorie met een telling > 0, aflopend
    const rijen = cat.events
      .map(e => ({ev:e.ev, label:e.label, n:perEvent[e.ev]||0}))
      .filter(r => r.n > 0)
      .sort((a,b) => b.n - a.n);
    if (!rijen.length) return '';
    const catTot = rijen.reduce((a,r)=>a+r.n, 0);
    const maxN = Math.max(1, ...rijen.map(r => r.n));
    const LIMIET = 5;
    const zichtbaar = rijen.slice(0, LIMIET);
    const rest = rijen.length - zichtbaar.length;

    const funcRij = (r) => {
      const gebr = Object.entries(perEventGebr[r.ev] || {})
        .map(([uid,n]) => ({naam: gebruik.naamPerUid?.[uid] || 'Onbekend', n}))
        .sort((a,b) => b.n - a.n);
      return `
      <div class="gebruik-func" data-func="${esc(r.ev)}">
        <div class="gebruik-func-rij">
          <span class="fnaam">${esc(r.label)}</span>
          <span class="fbar"><span style="width:${Math.round((r.n/maxN)*100)}%"></span></span>
          <span class="fn">${r.n}</span>
          ${gebr.length ? `<span class="fwie" data-gebruik-wie="${esc(r.ev)}">wie</span>` : ''}
        </div>
        <div class="gebruik-func-split">
          ${gebr.map(g => `
            <div class="gebruik-gebr-rij">
              <span class="gav">${esc(initialen(g.naam))}</span>
              <span class="gnaam">${esc(g.naam)}</span>
              <span class="gn">${g.n}</span>
            </div>`).join('')}
        </div>
      </div>`;
    };

    return `
      <div class="gebruik-cat">
        <div class="gebruik-cat-kop" data-gebruik-cat="${esc(cat.id)}">
          <span class="cnaam">${esc(cat.naam)}</span>
          <span class="ctot">${catTot}</span>
          <span class="cpijl">›</span>
        </div>
        <div class="gebruik-cat-inhoud">
          ${zichtbaar.map(funcRij).join('')}
          ${rest > 0 ? `<button class="gebruik-toon-alles" data-gebruik-meer="${esc(cat.id)}">+ Toon alle ${rijen.length} functies</button>
          <div class="gebruik-cat-rest" style="display:none">${rijen.slice(LIMIET).map(funcRij).join('')}</div>` : ''}
        </div>
      </div>`;
  };

  const blokken = GEBRUIK_CATEGORIEEN.map(catBlok).filter(Boolean).join('');

  return `
    <div class="kaart">
      <div class="sectie-kop" style="margin-top:0">Functiegebruik</div>
      <div class="segment" id="gebruikFunctiePeriode" style="margin-bottom:14px">
        ${[['dag','Dag'],['week','Week'],['maand','Maand']].map(([id,naam]) =>
          `<button data-functieperiode="${id}" class="${periode===id?'actief':''}">${naam}</button>`).join('')}
      </div>
      ${totaalAlles ? blokken : `<p style="font-size:calc(13px * var(--fs));color:var(--ink-2)">Nog geen functiegebruik geregistreerd in deze periode.</p>`}
      <p style="font-size:calc(11px * var(--fs));color:var(--ink-2);margin-top:8px;line-height:1.5">Alle functies worden geteld; per categorie staan de drukste bovenaan. Tik een categorie open, of "wie" voor de uitsplitsing per coach. Alleen tellingen — geen speler- of persoonsgegevens.</p>
    </div>`;
}

/* ==================== NAVIGATIE-INZICHT (klikgedrag) ====================
   Aggregeert de navpaden/{uid}_{sid}-documenten tot drie weergaves:
   1. Top-routes    — vaakst voorkomende schermvolgordes per sessie
   2. Overgangsmatrix — van elk scherm: waar men daarna heen ging (+ terug-kolom)
   3. Uitstappunten  — vanaf welk scherm men de sessie beëindigde
   Werkt uitsluitend op schermnaam + aanleiding — geen persoonsdata. */

/* Leesbare labels voor de fijnmazige schermnamen. */
const NAV_LABELS = {
  'teams':'Teams', 'team:hub':'Team · hub', 'team:spelers':'Spelers',
  'team:trainingen':'Trainingen', 'team:presentietraining':'Presentie',
  'team:planning':'Planning', 'team:poule':'Poule', 'team:stats':'Stats',
  'team:instellingen':'Instellingen', 'spelerprofiel':'Spelerprofiel',
  'wedstrijd:opstelling':'Wedstrijd · opstelling',
  'club:teams':'Club · teams', 'club:content':'Club · content',
};
function navLabel(s){
  if (NAV_LABELS[s]) return NAV_LABELS[s];
  if (/^wedstrijd:kwart/.test(s)) return 'Wedstrijd · ' + s.replace('wedstrijd:','');
  return s;
}
/* Grove groep voor kleurcodering (teams/team/wedstrijd/club/overig). */
function navGroep(s){
  if (s === 'teams') return 'teams';
  if (s.startsWith('team:')) return 'team';
  if (s.startsWith('wedstrijd:')) return 'wedstrijd';
  if (s.startsWith('club:')) return 'club';
  return 'overig';
}

/* Kernaggregatie: loop één keer door alle sessies en bouw tegelijk de
   route-tellingen, de overgangsmatrix (incl. terug) en de uitstap-tellingen. */
function navAggregeer(navpaden){
  const routes = new Map();        // pad-signatuur → {aantal, stappen}
  const matrix = new Map();        // van → Map(naar → n), plus van → {_terug, _sluit}
  const bezoek = new Map();        // scherm → hoe vaak bezocht
  const exit   = new Map();        // scherm → hoe vaak laatste stap van sessie
  const exitMidden = new Map();    // scherm → aantal keer dat exit "middenin" was (na vooruit, niet na taak-af)
  let sessies = 0, totStappen = 0, terugStappen = 0;

  for (const doc of navpaden){
    const stappen = Array.isArray(doc.stappen) ? doc.stappen : [];
    if (!stappen.length) continue;
    sessies++;
    totStappen += stappen.length;

    // route-signatuur: alleen de schermnamen (compact, max 6 voor leesbaarheid)
    const namen = stappen.map(s => s.s);
    const sig = namen.slice(0, 8).join(' → ');
    const r = routes.get(sig) || { aantal:0, stappen: namen.slice(0,8) };
    r.aantal++; routes.set(sig, r);

    for (let i = 0; i < stappen.length; i++){
      const st = stappen[i];
      bezoek.set(st.s, (bezoek.get(st.s)||0) + 1);
      if (st.h === 'terug') terugStappen++;

      if (i < stappen.length - 1){
        const van = st.s, naar = stappen[i+1].s, hoe = stappen[i+1].h;
        const rij = matrix.get(van) || new Map();
        if (hoe === 'terug'){ rij.set('_terug', (rij.get('_terug')||0) + 1); }
        else { rij.set(naar, (rij.get(naar)||0) + 1); }
        matrix.set(van, rij);
      } else {
        // laatste stap = uitstappunt
        exit.set(st.s, (exit.get(st.s)||0) + 1);
        // "middenin" = de sessie eindigde direct na een vooruit-stap die geen
        // natuurlijk eindpunt is (ruwe heuristiek: eindigde op een profiel- of
        // bewerk-scherm i.p.v. op een overzicht/kwart).
        const rij2 = matrix.get(st.s);
        // exit telt als 'sluit' in de matrix-rij van dat scherm
        const rijS = matrix.get(st.s) || new Map();
        rijS.set('_sluit', (rijS.get('_sluit')||0) + 1);
        matrix.set(st.s, rijS);
      }
    }
  }

  // routes aflopend op aantal
  const topRoutes = [...routes.entries()]
    .map(([sig, r]) => ({sig, ...r}))
    .sort((a,b) => b.aantal - a.aantal)
    .slice(0, 6);

  return { sessies, totStappen, terugStappen, topRoutes, matrix, bezoek, exit };
}

function htmlClubNavigatie(gebruik){
  const navpaden = gebruik.navpaden || [];
  const A = navAggregeer(navpaden);
  const modus = S.clubNavModus || 'routes';

  if (!A.sessies){
    return `
      <div class="kaart">
        <div class="sectie-kop" style="margin-top:0">Navigatie-inzicht</div>
        <p style="font-size:calc(13px * var(--fs));color:var(--ink-2)">Nog geen navigatiedata verzameld. Zodra coaches door de app bewegen, verschijnen hier de meest gelopen routes, de overgangen tussen schermen en de uitstappunten.</p>
      </div>`;
  }

  const gemStappen = A.sessies ? (A.totStappen / A.sessies) : 0;
  const terugPct = A.totStappen ? Math.round((A.terugStappen / A.totStappen) * 100) : 0;

  // --- kpi-rijtje ---
  const kpis = `
    <div class="nav-kpis">
      <div class="nav-kpi"><div class="n">${A.sessies}</div><div class="l">sessies</div></div>
      <div class="nav-kpi"><div class="n">${gemStappen.toFixed(1)}</div><div class="l">schermen/sessie</div></div>
      <div class="nav-kpi"><div class="n" style="color:${terugPct>=25?'var(--keeper)':'var(--ink)'}">${terugPct}%</div><div class="l">"moest terug"</div></div>
    </div>`;

  const segment = `
    <div class="segment" id="clubNavModus" style="margin-bottom:14px">
      ${[['routes','Top-routes'],['matrix','Overgangen'],['exit','Uitstappunten']].map(([id,naam]) =>
        `<button data-navmodus="${id}" class="${modus===id?'actief':''}">${naam}</button>`).join('')}
    </div>`;

  let inhoud = '';

  if (modus === 'routes'){
    const maxAantal = Math.max(1, ...A.topRoutes.map(r => r.aantal));
    inhoud = A.topRoutes.map((r, idx) => {
      const nodes = r.stappen.map((s,i) => {
        const g = navGroep(s);
        return `${i>0?'<span class="nav-pijl">→</span>':''}<span class="nav-node ${g}">${esc(navLabel(s))}</span>`;
      }).join('');
      const pct = Math.round((r.aantal / A.sessies) * 100);
      return `
        <div class="nav-route">
          <div class="nav-route-kop">
            <span class="nav-route-rang ${idx===0?'top':''}">${idx+1}</span>
            <span class="nav-route-stat">${pct}% · ${r.aantal}×</span>
          </div>
          <div class="nav-flow">${nodes}</div>
          <div class="nav-balk"><i style="width:${Math.round((r.aantal/maxAantal)*100)}%"></i></div>
        </div>`;
    }).join('');
    inhoud += `<p class="nav-duiding">Elke rij is een veelvoorkomende schermvolgorde binnen één sessie. Percentage = aandeel van alle sessies dat zo begon.</p>`;
  }

  else if (modus === 'matrix'){
    // kolommen: de drukst bezochte schermen (max 6) + terug + sluit
    const drukste = [...A.bezoek.entries()].sort((a,b)=>b[1]-a[1]).slice(0,6).map(([s])=>s);
    const rijen = drukste;   // symmetrisch: rijen = kolommen (de drukste schermen)
    const kleurCel = (v, max) => {
      if (!v) return 'background:var(--surface-2);color:var(--ink-2)';
      const t = v/max;
      const bg = t<.2?'#3a1a1c':t<.4?'#6e2225':t<.6?'#a82c30':'var(--accent)';
      return `background:${bg};color:${t>=.4?'#fff':'#e6b0b2'}`;
    };
    // maxima per context voor kleurschaal
    let maxVooruit = 1, maxTerug = 1;
    for (const van of rijen){
      const rij = A.matrix.get(van); if (!rij) continue;
      for (const naar of drukste) if (naar!==van) maxVooruit = Math.max(maxVooruit, rij.get(naar)||0);
      maxTerug = Math.max(maxTerug, rij.get('_terug')||0);
    }
    const kop = `<tr><th class="nav-hoek">van ↓ / naar →</th>${drukste.map(s=>`<th>${esc(navLabel(s))}</th>`).join('')}<th style="color:var(--keeper)">↩ terug</th><th>⨯ sluit</th></tr>`;
    const body = rijen.map(van => {
      const rij = A.matrix.get(van) || new Map();
      const totVan = [...rij.values()].reduce((a,b)=>a+b,0) || 1;
      const cellen = drukste.map(naar => {
        if (naar === van) return `<td><div class="nav-cel" style="background:var(--surface-2);color:var(--ink-2)">—</div></td>`;
        const v = rij.get(naar)||0; const pct = Math.round((v/totVan)*100);
        return `<td><div class="nav-cel" style="${kleurCel(v,maxVooruit)}">${v?pct+'%':'·'}</div></td>`;
      }).join('');
      const vT = rij.get('_terug')||0, pctT = Math.round((vT/totVan)*100);
      const tT = vT? (vT/maxTerug):0;
      const bgT = !vT?'background:var(--surface-2);color:var(--ink-2)':`background:${tT<.34?'#4a3a1a':tT<.67?'#8a6420':'var(--keeper)'};color:${tT>=.34?'#1a1200':'#e0c07d'}`;
      const vS = rij.get('_sluit')||0, pctS = Math.round((vS/totVan)*100);
      return `<tr><th>${esc(navLabel(van))}</th>${cellen}<td><div class="nav-cel" style="${bgT}">${vT?pctT+'%':'·'}</div></td><td><div class="nav-cel" style="font-style:italic;color:var(--ink-2)">${vS?pctS+'%':'·'}</div></td></tr>`;
    }).join('');
    inhoud = `<div class="nav-matrix-scroll"><table class="nav-matrix">${kop}${body}</table></div>
      <p class="nav-duiding">Lees per rij: vanaf dat scherm, waar ging men daarna heen. De gele <b style="color:var(--keeper)">↩ terug</b>-kolom toont het aandeel dat via de terugknop ging — daar kún je nergens rechtstreeks heen. Rood = veel vooruit-verkeer.</p>`;
  }

  else { // exit
    const totExit = [...A.exit.values()].reduce((a,b)=>a+b,0) || 1;
    const rijen = [...A.exit.entries()]
      .map(([s,n]) => ({s, n, bezoek: A.bezoek.get(s)||n}))
      .map(r => ({...r, pct: Math.round((r.n / r.bezoek) * 100)}))
      .sort((a,b) => b.n - a.n)
      .slice(0, 8);
    const maxN = Math.max(1, ...rijen.map(r => r.n));
    inhoud = rijen.map(r => {
      // natuurlijke eindpunten (taak af) vs. mogelijke knelpunten
      const natuurlijk = /kwart|poule|stats|opstelling/.test(r.s);
      const knelpunt = /spelerprofiel|bewerk/.test(r.s);
      const vlag = knelpunt ? '<span class="nav-vlag hoog">mogelijk knelpunt</span>'
                 : natuurlijk ? '<span class="nav-vlag norm">verwacht einde</span>'
                 : '';
      return `
        <div class="nav-exit">
          <div class="nav-exit-naam">${esc(navLabel(r.s))} ${vlag}</div>
          <div class="nav-exit-stat">
            <span class="nav-exit-pct">${r.pct}%</span>
            <span class="nav-exit-cnt">${r.n}× laatste stap</span>
          </div>
          <div class="nav-balk"><i style="width:${Math.round((r.n/maxN)*100)}%;${knelpunt?'background:linear-gradient(90deg,var(--uit),#a82c30)':''}"></i></div>
        </div>`;
    }).join('');
    inhoud += `<p class="nav-duiding">Percentage = aandeel van de bezoeken aan dat scherm dat eindigde in het sluiten van de app. Hoog op een taak-af-scherm (kwart, poule) is normaal; hoog middenin een flow (spelerprofiel) is een aandachtspunt.</p>`;
  }

  return `
    <div class="kaart">
      <div class="sectie-kop" style="margin-top:0">Navigatie-inzicht</div>
      ${kpis}
      ${segment}
      ${inhoud}
      <p style="font-size:calc(11px * var(--fs));color:var(--ink-2);margin-top:8px;line-height:1.5">Toont hoe coaches door de app bewegen — alleen schermnaam, tijd en aanleiding (tab/tegel/terug). Geen speler- of persoonsgegevens.</p>
    </div>`;
}

/* ISO-weeknummer als sleutel 'YYYY-Www' */
function isoWeekKey(datumStr){
  const d = new Date(datumStr+'T12:00');
  d.setDate(d.getDate() + 4 - (d.getDay()||7));
  const jan1 = new Date(d.getFullYear(),0,1);
  const week = Math.ceil((((d - jan1) / 86400000) + 1)/7);
  return `${d.getFullYear()}-W${String(week).padStart(2,'0')}`;
}
function maandKey(datumStr){ return datumStr.slice(0,7); }

function dashGebruikGroepen(logins){
  const perDag = {}, perWeek = {}, perMaand = {};
  for (const l of logins){
    if (!l.datum || !l.uid) continue;
    (perDag[l.datum] ||= new Set()).add(l.uid);
    (perWeek[isoWeekKey(l.datum)] ||= new Set()).add(l.uid);
    (perMaand[maandKey(l.datum)] ||= new Set()).add(l.uid);
  }
  return { perDag, perWeek, perMaand };
}

function laatsteDagen(n){
  const out = [];
  for (let i=n-1;i>=0;i--) out.push(new Date(Date.now()-i*86400000).toISOString().slice(0,10));
  return out;
}
function laatsteWeken(n){
  const nu = new Date();
  const dag = (nu.getDay()+6)%7; // maandag = 0
  const maandagDeze = new Date(nu); maandagDeze.setDate(nu.getDate()-dag);
  const out = [];
  for (let i=n-1;i>=0;i--){
    const maandag = new Date(maandagDeze); maandag.setDate(maandagDeze.getDate()-i*7);
    out.push(isoWeekKey(maandag.toISOString().slice(0,10)));
  }
  return out;
}
function laatsteMaanden(n){
  const nu = new Date(); const out = [];
  for (let i=n-1;i>=0;i--){
    const d = new Date(nu.getFullYear(), nu.getMonth()-i, 1);
    out.push(`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`);
  }
  return out;
}
function dashTijdKort(ts){
  if (!ts) return '—';
  try {
    const d = ts.seconds ? new Date(ts.seconds*1000) : new Date(ts);
    return afgKort(d.toISOString().slice(0,10));
  } catch { return '—'; }
}

function htmlClubGebruik(gebruik){
  const { perDag, perWeek, perMaand } = dashGebruikGroepen(gebruik.logins);
  const periode = S.clubDashPeriode || 'dag';
  const data = periode === 'dag'
    ? laatsteDagen(14).map(k => ({ label: afgKort(k), n: perDag[k]?.size || 0 }))
    : periode === 'week'
    ? laatsteWeken(8).map(k => ({ label: k.slice(5), n: perWeek[k]?.size || 0 }))
    : laatsteMaanden(6).map(k => ({ label: new Date(k+'-01T12:00').toLocaleDateString('nl-NL',{month:'short',year:'2-digit'}), n: perMaand[k]?.size || 0 }));
  const max = Math.max(1, ...data.map(d => d.n));

  return `
    <div class="kaart">
      <div class="sectie-kop" style="margin-top:0">Gebruik van de app</div>
      <div class="segment" id="gebruikPeriodeTabs" style="margin-bottom:14px">
        ${[['dag','Dag'],['week','Week'],['maand','Maand']].map(([id,naam]) =>
          `<button data-periode="${id}" class="${periode===id?'actief':''}">${naam}</button>`).join('')}
      </div>
      ${data.map(d => `
        <div style="display:flex;align-items:center;gap:10px;padding:5px 0;font-size:calc(12.5px * var(--fs))">
          <span style="width:56px;flex-shrink:0;color:var(--ink-2)">${esc(d.label)}</span>
          <span style="flex:1;height:14px;background:var(--surface-2);border-radius:7px;overflow:hidden">
            <span style="display:block;height:100%;width:${Math.round((d.n/max)*100)}%;background:var(--accent);border-radius:7px"></span>
          </span>
          <span style="width:22px;text-align:right;font-weight:700">${d.n}</span>
        </div>`).join('')}
      <p style="font-size:calc(11px * var(--fs));color:var(--ink-2);margin-top:8px">Aantal unieke coaches dat inlogde per ${periode==='dag'?'dag':periode==='week'?'week':'maand'}.</p>
    </div>

    <div class="kaart">
      <div class="sectie-kop" style="margin-top:0">Meest actieve gebruikers</div>
      ${gebruik.gebruikers.length ? `${(S.clubAlleGebruikersOpen ? gebruik.gebruikers : gebruik.gebruikers.slice(0,10)).map(g => `
        <div class="lid-rij">
          <div class="lid-avatar">${esc(initialen(g.naam || g.email || '?'))}</div>
          <div class="lid-naam">${esc(g.naam || g.email || 'Onbekend')}
            <div style="font-size:calc(12px * var(--fs));color:var(--ink-2);font-weight:500;margin-top:1px">${g.email?esc(g.email)+' · ':''}laatst: ${dashTijdKort(g.laatsteLogin)}</div>
          </div>
          <div style="font-family:'Barlow Condensed';font-weight:700;font-size:calc(18px * var(--fs));color:var(--accent);flex-shrink:0">${g.aantalLogins||0}</div>
        </div>`).join('')}
      ${gebruik.gebruikers.length > 10 ? `<button class="knop licht vol" id="btnAlleGebruikers" style="margin-top:10px;font-size:calc(13px * var(--fs))">${S.clubAlleGebruikersOpen ? 'Toon minder' : `Alle ${gebruik.gebruikers.length} gebruikers tonen`}</button>` : ''}`
      : `<p style="font-size:calc(13px * var(--fs));color:var(--ink-2)">Nog geen logins geregistreerd.</p>`}
    </div>`;
}

/* ==================== CLUB-HUB (tegel-startscherm) ====================
   Vervangt de onderbalk. Dezelfde tegel-opmaak als de coaches-hub: secties met
   een kop, elk met tegels (icoon + naam, optioneel een badge/dot). Terug gaat
   één niveau: leaf → hub → teams, en dashboard-subs → inzicht → hub. */

/* Eén club-tegel. data-club-open="<tab>" wordt in renderClub gekoppeld. */
function clubTegel(tab, naam, icoNaam, badge){
  const mark = badge === true ? '<span class="hub-dot"></span>'
             : badge ? `<span class="hub-badge">${badge}</span>` : '';
  return `<button class="hub-tegel" data-club-open="${tab}">${mark}${ico(icoNaam, 40)}<span class="hub-tnaam">${esc(naam)}</span></button>`;
}
/* Tegel met warn-badge (geel) — voor aandacht-signalen. */
function clubTegelWarn(tab, naam, icoNaam, aantal){
  const mark = aantal ? `<span class="hub-badge warn">${aantal}</span>` : '';
  return `<button class="hub-tegel" data-club-open="${tab}">${mark}${ico(icoNaam, 40)}<span class="hub-tnaam">${esc(naam)}</span></button>`;
}

function htmlClubHub(teams){
  const admin = isBeheerder();
  const ongelezenBer = (S.clubBerichten || []).filter(b => b && b._ongelezen).length || 0;

  const secties = [];
  secties.push(['Beheer', [
    clubTegel('teams',      'Teams',      'team-members'),
    clubTegel('trainingen', 'Trainingen', 'training-cones'),
    clubTegel('videos',     'Video\u2019s','training-video'),
    clubTegel('documenten', 'Documenten', 'admin-document'),
  ]]);
  const comm = [];
  if (admin) comm.push(clubTegel('berichten', 'Berichten', 'communication-announcement', ongelezenBer || null));
  if (admin) comm.push(clubTegel('content',   'Content',   'admin-file'));
  if (comm.length) secties.push(['Communicatie', comm]);
  secties.push(['Inzicht', [
    clubTegel('inzicht',  'Inzicht',      'navigation-dashboard'),
    clubTegel('instel',   'Instellingen', 'navigation-settings'),
  ]]);

  return secties.map(([kop, tegels]) => `
    <section class="hub-sectie">
      <div class="hub-sectie-kop">${esc(kop)}</div>
      <div class="hub-grid">${tegels.join('')}</div>
    </section>`).join('');
}

/* De Inzicht-sub-hub: het voormalige dashboard opgesplitst in losse tegels.
   'signalen' = aantal aandachtspunten (voor de warn-badge op de Aandacht-tegel). */
function htmlClubInzicht(signalenAantal){
  return `
    <section class="hub-sectie" style="margin-top:6px">
      <div class="hub-grid">
        ${clubTegel('dash-overzicht',   'Overzicht',  'navigation-dashboard')}
        ${clubTegelWarn('dash-aandacht','Aandacht',   'action-warning', signalenAantal || null)}
        ${clubTegel('dash-gebruik',     'Gebruik',    'stats-bars')}
        ${clubTegel('dash-navigatie',   'Navigatie',  'football-competition')}
        ${clubTegel('dash-evaluaties',  'Evaluaties', 'attendance-evaluatie')}
      </div>
    </section>`;
}

async function renderClub(){
  if (!S.club) return;
  const v = $('#view-club');
  const tab = S.clubTab;

  // Teams zijn altijd nodig (voor de onderbalk en elke tab). De rest halen we
  // alleen op als de open tab hem echt toont — en parallel i.p.v. serieel, zodat
  // het dashboard niet eerst op trainingen/video's/documenten hoeft te wachten.
  const teams = await clubTeamsOphalen();
  S.clubTeams = teams;

  const wilTrainingen = tab === 'trainingen';
  const wilVideos     = tab === 'videos';
  const wilDocumenten = tab === 'documenten';
  const wilAfgelast   = tab === 'teams';

  const [trainingen, videos, documenten, afgelastingen] = await Promise.all([
    wilTrainingen ? clubTrainingenOphalen()  : Promise.resolve(S.clubTrainingen  || []),
    wilVideos     ? clubVideosOphalen()       : Promise.resolve(S.clubVideos      || []),
    wilDocumenten ? clubDocumentenOphalen()   : Promise.resolve(S.clubDocumenten  || []),
    wilAfgelast   ? clubAfgelastingenOphalen(): Promise.resolve(S.clubAfgelastingen || []),
  ]);
  S.clubTrainingen  = trainingen;
  S.clubVideos      = videos;
  S.clubDocumenten  = documenten;
  S.clubAfgelastingen = afgelastingen;

  // syncstatus per team ophalen (alleen nodig op de instel-tab, om reads te sparen)
  let syncStatus = {};
  if (tab === 'instel'){
    syncStatus = await clubSyncStatusOphalen(teams);
  }

  // Navigatieniveau: hub (tegels) → inzicht (sub-hub) → leaf/dashboard-scherm.
  // 'terug' hieronder verwijst naar één niveau omhoog; op de hub verlaat je de club.
  const dashSubs = ['dash-overzicht','dash-aandacht','dash-gebruik','dash-navigatie','dash-evaluaties'];
  const isHub     = tab === 'hub';
  const isInzicht = tab === 'inzicht';
  const isDashSub = dashSubs.includes(tab);

  // titel + terug-doel per scherm
  const SCHERM_TITELS = {
    'teams':'Teams', 'trainingen':'Trainingen', 'videos':"Video's", 'documenten':'Documenten',
    'berichten':'Berichten', 'content':'Content', 'instel':'Instellingen', 'inzicht':'Inzicht',
    'dash-overzicht':'Overzicht', 'dash-aandacht':'Aandacht nodig', 'dash-gebruik':'Gebruik',
    'dash-navigatie':'Navigatie', 'dash-evaluaties':'Evaluaties',
  };

  let inhoud = '';
  let clubEvalData = null;
  let contentLijst = null;

  if (isHub){
    // hub heeft de berichten alvast nodig voor de ongelezen-badge (goedkoop; klein)
    if (isBeheerder() && !S.clubBerichten){
      try { S.clubBerichten = await clubBerichtenOphalen(); } catch(e){}
    }
    inhoud = htmlClubHub(teams);
  }
  else if (isInzicht){
    // aandacht-signalen voor de warn-badge op de Aandacht-tegel
    const dash = await clubDashboardOphalen(teams);
    S._clubDashCache = dash;   // hergebruik bij het openen van een dash-scherm
    inhoud = htmlClubInzicht(clubSignalen(dash).length);
  }
  else if (isDashSub){
    if (tab === 'dash-evaluaties'){
      clubEvalData = await clubEvaluatiesOphalen(teams);
      inhoud = htmlClubEvaluaties(clubEvalData);
    } else if (tab === 'dash-overzicht' || tab === 'dash-aandacht'){
      const dash = S._clubDashCache || await clubDashboardOphalen(teams);
      inhoud = tab === 'dash-overzicht' ? htmlDashOverzicht(teams, dash) : htmlDashAandacht(dash);
    } else { // gebruik of navigatie
      const gebruik = await clubGebruikOphalen(teams);
      inhoud = tab === 'dash-gebruik' ? htmlDashGebruik(gebruik) : htmlClubNavigatie(gebruik);
    }
  }
  else if (tab === 'teams')      inhoud = htmlClubTeams(teams, afgelastingen);
  else if (tab === 'trainingen') inhoud = htmlClubTrainingen(teams, trainingen);
  else if (tab === 'videos')     inhoud = htmlClubVideos(teams, videos);
  else if (tab === 'documenten') inhoud = htmlClubDocumenten(teams, documenten);
  else if (tab === 'berichten'){
    const berichten = await clubBerichtenOphalen();
    S.clubBerichten = berichten;
    inhoud = htmlClubBerichten(teams, berichten);
  }
  else if (tab === 'instel')     inhoud = htmlClubInstel(teams, syncStatus);
  else if (tab === 'content' && isBeheerder()){
    stopUnsubs('clubContent');
    await new Promise(resolve => {
      let opgelost = false;
      S.unsub.clubContent = startClubContentListener(lijst => {
        contentLijst = lijst;
        if (!opgelost){ opgelost = true; resolve(); }
        else if (S.clubTab === 'content') renderClub(); // live herrenderen
      });
    });
    inhoud = htmlClubContent(contentLijst);
  }

  // --- kop: op de hub de club-titel met veld-look; op subschermen een terug-kop ---
  let kop;
  if (isHub){
    kop = `
      <div class="welkom-kop hub-kop">
        <button class="terug" id="clubTerug">‹</button>
        <h1>🏛 ${esc(S.club.naam)}<span class="sub">${Object.keys(S.club.teams||{}).length} teams · clubcode ${esc(S.club.code)}</span></h1>
      </div>`;
  } else {
    kop = `
      <div class="kop"><button class="terug" id="clubTerug">‹</button>
        <h1>${esc(SCHERM_TITELS[tab] || S.club.naam)}</h1></div>`;
  }

  v.innerHTML = `${kop}${inhoud}`;

  // terug-knop: één niveau omhoog volgens het huidige niveau
  v.querySelector('#clubTerug').onclick = () => clubTerugEen();

  // hub-tegels koppelen
  v.querySelectorAll('[data-club-open]').forEach(b => b.onclick = () => {
    const doel = b.dataset.clubOpen;
    S.clubTab = doel;
    telNav('club:' + doel, 'tegel');
    renderClub();
  });

  if (tab === 'content' && contentLijst) koppelClubContent(v);
  if (tab === 'dash-evaluaties' && clubEvalData) koppelClubEvaluaties(v, clubEvalData, () => renderClub());
  koppelClubTab(v, tab, teams, trainingen, videos, documenten);
}

/* Eén niveau terug in de club-hub: leaf/dash-scherm → hub of inzicht, hub → club uit. */
export function clubTerugEen(){
  const tab = S.clubTab;
  const dashSubs = ['dash-overzicht','dash-aandacht','dash-gebruik','dash-navigatie','dash-evaluaties'];
  if (dashSubs.includes(tab)){ S.clubTab = 'inzicht'; telNav('club:inzicht','terug'); renderClub(); return true; }
  if (tab === 'inzicht' || tab === 'teams' || tab === 'trainingen' || tab === 'videos'
      || tab === 'documenten' || tab === 'berichten' || tab === 'content' || tab === 'instel'){
    S.clubTab = 'hub'; telNav('club:hub','terug'); renderClub(); return true;
  }
  // op de hub: verlaat de club
  return false;
}

/* ==================== TEAMMODULES (admin, per team) ====================
   De admin kan per team bepalen welke onderdelen coaches zien. De vlaggen staan
   op het team-document onder `modules`. Ontbreekt een vlag of staat hij niet
   expliciet op false, dan is de module AAN — bestaande teams merken dus niets
   en "uit" wist nooit data (alleen de UI verdwijnt).
   Let op: de ASV-kompas-tip staat bewust los van de leerlijn, zodat het
   beleidsplan standaard bij elke coach blijft terugkomen op de Training-tab. */
const MODULE_DEFS = [
  ['evaluaties', '📈', 'Evaluaties', 'Stats-tabblad & de teamevaluatie na de wedstrijd.'],
  ['leerlijn',   '🧭', 'Leerlijn',   'Leerlijn-tabblad bij spelers, met thema-achtergrond & leerpunten.'],
  ['kompas',     '🎯', 'ASV-kompas tips', 'Wekelijkse beleidsplan-tip op de Training-tab. Aanbevolen om aan te laten.'],
];

/* korte samenvatting van uitgeschakelde modules, getoond in de teamrij */
function modulesMeta(t){
  const uit = MODULE_DEFS.filter(([k]) => t.modules?.[k] === false).map(([,,naam]) => naam);
  return uit.length ? ` · <span style="color:var(--uit)">${esc(uit.join(', '))} uit</span>` : '';
}

function modalTeamModules(team){
  if (!team) return;
  const m = team.modules || {};
  const rijen = MODULE_DEFS.map(([k, ico, naam, uitleg]) => {
    const aan = m[k] !== false;
    return `
      <label class="lid-rij" style="cursor:pointer;align-items:flex-start;gap:12px;padding:12px 0">
        <input type="checkbox" data-mod="${k}" ${aan?'checked':''} style="width:20px;height:20px;accent-color:var(--grass);flex-shrink:0;margin-top:2px">
        <div class="lid-naam" style="font-weight:600">${ico} ${esc(naam)}
          <span style="display:block;font-size:calc(12px * var(--fs));color:var(--ink-2);font-weight:400;margin-top:2px">${esc(uitleg)}</span></div>
      </label>`;
  }).join('<div style="border-top:1px solid var(--line-d)"></div>');

  openModal(`
    <h2>Modules · ${esc(team.naam)}</h2>
    <p style="font-size:calc(13px * var(--fs));color:var(--ink-2);margin-bottom:6px">Bepaal wat coaches van dit team zien. Uitzetten verbergt alleen de knoppen — bestaande gegevens blijven bewaard en komen terug zodra je het weer aanzet.</p>
    <div class="kaart" style="padding:2px 14px">${rijen}</div>
    <button class="knop vol" id="mModulesOk" style="margin-top:14px">Opslaan</button>`);

  const okBtn = $('#mModulesOk');
  if (okBtn) okBtn.onclick = async () => {
    const modules = {};
    document.querySelectorAll('[data-mod]').forEach(c => { modules[c.dataset.mod] = c.checked; });
    try {
      await updateDoc(doc(db,'teams',team.id), { modules });
      team.modules = modules; // lokaal bijwerken zodat de teamrij meteen klopt
      sluitModal();
      renderClub();
      meld('Modules opgeslagen');
    } catch(e){ meld('Opslaan mislukt — probeer opnieuw'); }
  };
}

function htmlClubTeams(teams, afgelastingen = []){
  // is er nu een geldige (vandaag of toekomstige) afgelasting actief?
  const vandaag = new Date().toISOString().slice(0,10);
  const actief = afgelastingen.find(a => a.datum >= vandaag);

  // stats: tel afgelastingen in het lopende seizoen-jaar (laatste 12 mnd is simpel en duidelijk)
  const grens = new Date(Date.now() - 365*24*3600*1000).toISOString().slice(0,10);
  const recent = afgelastingen.filter(a => a.datum >= grens);
  const laatste5 = afgelastingen.slice(0, 5);

  const afgelastBlok = `
    <div class="club-afgelast-blok">
      ${actief
        ? `<div class="caf-actief">
             <div class="caf-actief-kop"><span>⛔</span><b>Training afgelast — ${esc(afgKort(actief.datum))}</b></div>
             ${actief.reden ? `<div class="caf-actief-reden">${esc(actief.reden)}</div>` : ''}
             <button class="knop licht vol caf-op" id="clubAfgelastOpheffen">Afgelasting opheffen</button>
           </div>`
        : `<button class="knop vol caf-aflast" id="clubAflast">⛔ Training afgelasten (clubbreed)</button>`}
      <div class="caf-stats">
        <div class="caf-stat"><span class="caf-getal">${recent.length}</span><span class="caf-label">laatste 12 mnd</span></div>
        <div class="caf-stat"><span class="caf-getal">${afgelastingen.length}</span><span class="caf-label">totaal</span></div>
      </div>
      ${laatste5.length ? `
        <div class="caf-historie">
          <div class="caf-historie-kop">Recente afgelastingen</div>
          ${laatste5.map(a => `
            <div class="caf-rij">
              <span class="caf-rij-datum">${esc(afgKort(a.datum))}</span>
              <span class="caf-rij-reden">${a.reden ? esc(a.reden) : '—'}</span>
            </div>`).join('')}
        </div>` : ''}
    </div>`;

  return `
    ${afgelastBlok}
    <button class="knop vol" id="clubNieuwTeam" style="margin-bottom:8px">+ Team aanmaken voor deze club</button>
    <div class="rij" style="margin-bottom:14px">
      <button class="knop licht vol" id="clubImporteerPDF">📥 Importeren uit PDF</button>
      ${teams.length ? `<button class="knop licht vol" id="clubAlleLinks">🔗 Alle uitnodigingen</button>` : ''}
    </div>
    ${teams.length ? teams.map(t => `
      <button class="lijst-item" data-open-team="${t.id}">
        <div class="mini-shirt" style="width:40px;height:40px;border-radius:50%;background:var(--grass);color:#fff;display:flex;align-items:center;justify-content:center;font-family:'Barlow Condensed';font-weight:700;font-size:calc(16px * var(--fs))">${esc(t.format)}v${esc(t.format)}</div>
        <div><div class="titel">${esc(t.naam)}</div>
        <div class="meta">${esc(t.categorie || '—')} · ${Object.keys(t.leden||{}).length} coach(es)${modulesMeta(t)}</div></div>
        <button class="actie" data-modules-team="${t.id}" title="Modules aan/uit">🎛️</button>
        <button class="actie" data-uitnodig-team="${t.id}" title="Coach uitnodigen">📨</button>
        <span class="pijl">›</span>
      </button>`).join('')
    : `<div class="kaart leeg">Nog geen teams in deze club.<br>Maak een eerste team aan, of importeer een PDF met de teamindeling.</div>`}`;
}

/* in welke bouwen valt een training? (op basis van de gekoppelde teams) */
function bouwenVanTraining(t, teams){
  const set = new Set();
  for (const tid of (t.teams||[])){
    const team = teams.find(x => x.id === tid);
    set.add(bouwVanCategorie(team?.categorie));
  }
  return set;
}

function htmlClubTrainingen(teams, trainingen){
  const actief = S.clubTrainBouw || 'onder';
  // tellingen per bouw voor de badges
  const telPerBouw = {onder:0, midden:0, boven:0};
  for (const t of trainingen)
    for (const b of bouwenVanTraining(t, teams)) telPerBouw[b]++;

  const zichtbaar = trainingen.filter(t => bouwenVanTraining(t, teams).has(actief));

  const segment = `
    <div class="segment" id="bouwTabs" style="margin-bottom:14px">
      ${BOUWEN.map(b => `<button data-bouw="${b.id}" class="${actief===b.id?'actief':''}">${b.kort}${telPerBouw[b.id]?` <span style="opacity:.6">(${telPerBouw[b.id]})</span>`:''}</button>`).join('')}
    </div>`;

  const lijst = zichtbaar.length ? zichtbaar.map(t => {
    const teamNamen = (t.teams||[]).map(tid => (teams.find(x => x.id === tid)?.naam) || '?').join(', ');
    const heeftAi = Array.isArray(t.oefeningen) && t.oefeningen.length;
    const tekstKnop = heeftAi
      ? `<button data-ttekst="${t.id}" title="Tekst controleren en bewerken">📝</button>`
      : '';
    return `
      <div class="training-rij">
        <div class="ico${heeftAi?' ai':''}">${heeftAi?`<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M10.2 5.2 6 18h12L13.8 5.2a1.9 1.9 0 0 0-3.6 0Z"/><path d="M8.3 11.5h7.4"/><path d="M4.5 18h15"/></svg>`:'PDF'}</div>
        <div class="t"><div class="t-titel">${esc(t.titel || t.bestandsnaam)}</div>
          <div class="t-meta">${esc(t.week || '')}${t.week?' · ':''}${esc(teamNamen)}</div></div>
        <div class="acties">
          <button data-tdownload="${esc(t.url)}" title="Openen">↗</button>
          ${tekstKnop}
          <button data-tbewerk="${t.id}" title="Teams en titel wijzigen">✏️</button>
          <button data-tshare="${t.id}" title="Delen naar WhatsApp">📤</button>
          <button data-tweg="${t.id}" title="Verwijderen" style="color:var(--uit)">🗑</button>
        </div>
      </div>`;
  }).join('')
  : `<div class="kaart leeg">Nog geen trainingen voor de ${esc(bouwNaam(actief).toLowerCase())}.<br>Upload een PDF en koppel hem aan een team uit deze bouw.</div>`;

  return `
    <button class="upload-knop" id="trainingUpload">📄 PDF-training toevoegen voor één of meer teams
      <input type="file" id="trainingFile" accept="application/pdf" style="display:none"></button>
    ${segment}
    ${lijst}`;
}

function htmlClubVideos(teams, videos){
  const actief = S.clubVideoBouw || 'onder';
  const telPerBouw = {onder:0, midden:0, boven:0};
  for (const vid of videos)
    for (const b of bouwenVanTraining(vid, teams)) telPerBouw[b]++;
  const zichtbaar = videos.filter(vid => bouwenVanTraining(vid, teams).has(actief));

  const segment = `
    <div class="segment" id="videoBouwTabs" style="margin-bottom:14px">
      ${BOUWEN.map(b => `<button data-vbouw="${b.id}" class="${actief===b.id?'actief':''}">${b.kort}${telPerBouw[b.id]?` <span style="opacity:.6">(${telPerBouw[b.id]})</span>`:''}</button>`).join('')}
    </div>`;

  const lijst = zichtbaar.length ? zichtbaar.map(vid => {
    const teamNamen = (vid.teams||[]).map(tid => (teams.find(x => x.id === tid)?.naam) || '?').join(', ');
    const upload = vid.bron === 'upload';
    const id = upload ? null : youtubeId(vid.url);
    const href = upload ? vid.url : (youtubeWatch(id) || vid.url);
    const thumbInner = id
      ? `<img src="${esc(youtubeThumb(id))}" alt="" loading="lazy"><span class="play">▶</span>`
      : `<span class="play">▶</span>${upload ? '<span style="position:absolute;bottom:2px;right:3px;font-size:calc(8px * var(--fs));font-weight:700;letter-spacing:.5px;color:#fff;background:rgba(0,0,0,.55);padding:1px 3px;border-radius:3px;line-height:1">MP4</span>' : ''}`;
    return `
      <div class="video-rij">
        <a class="thumb" href="${esc(href)}" target="_blank" rel="noopener">${thumbInner}</a>
        <div class="v"><div class="v-titel">${esc(vid.titel || 'Video')}</div>
          <div class="v-meta">${esc(teamNamen || '—')}${upload ? ' · geüpload' : ''}</div></div>
        <div class="acties">
          <button data-vbewerk="${vid.id}" title="Teams en titel wijzigen">✏️</button>
          <button data-vshare="${vid.id}" title="Delen naar WhatsApp">📤</button>
          <button data-vweg="${vid.id}" title="Verwijderen" style="color:var(--uit)">🗑</button>
        </div>
      </div>`;
  }).join('')
  : `<div class="kaart leeg">Nog geen video's voor de ${esc(bouwNaam(actief).toLowerCase())}.<br>Plak een YouTube-link of upload een eigen clip en koppel hem aan een team.</div>`;

  return `
    <button class="upload-knop" id="videoToevoegen">🎬 YouTube-video toevoegen voor één of meer teams</button>
    <button class="upload-knop" id="videoUpload" style="margin-top:8px">⬆️ Eigen video uploaden (mp4) voor één of meer teams
      <input type="file" id="videoFile" accept="video/mp4,video/*" style="display:none"></button>
    ${segment}
    ${lijst}`;
}

function htmlClubDocumenten(teams, documenten){
  const actief = S.clubDocCategorie || 'alle';
  const telPerCat = {knvb:0, beleid:0, overig:0};
  for (const d of documenten) telPerCat[d.categorie] = (telPerCat[d.categorie]||0) + 1;

  const segment = `
    <div class="segment" id="docCatTabs" style="margin-bottom:14px">
      <button data-doccat="alle" class="${actief==='alle'?'actief':''}">Alle</button>
      ${DOC_CATEGORIEN.map(c => `<button data-doccat="${c.id}" class="${actief===c.id?'actief':''}">${c.naam}${telPerCat[c.id]?` <span style="opacity:.6">(${telPerCat[c.id]})</span>`:''}</button>`).join('')}
    </div>`;

  const zichtbaar = actief === 'alle' ? documenten : documenten.filter(d => d.categorie === actief);
  const icoonPerCat = {beleid:'PDF', knvb:'KNVB', overig:'DOC'};

  const lijst = zichtbaar.length ? zichtbaar.map(d => {
    const teamNamen = (d.teams||[]).map(tid => (teams.find(x => x.id === tid)?.naam) || '?').join(', ');
    const catNaam = DOC_CATEGORIEN.find(c => c.id === d.categorie)?.naam || 'Overig';
    return `
      <div class="training-rij">
        <div class="ico ${d.categorie==='knvb'?'knvb':d.categorie==='overig'?'overig':''}">${icoonPerCat[d.categorie] || 'DOC'}</div>
        <div class="t"><div class="t-titel">${esc(d.titel || d.bestandsnaam)}</div>
          <div class="t-meta">${esc(catNaam)} · ${esc(teamNamen)}</div></div>
        <div class="acties">
          <button data-ddownload="${esc(d.url)}" title="Openen">↗</button>
          <button data-dbewerk="${d.id}" title="Titel, categorie en teams wijzigen">✏️</button>
          <button data-dshare="${d.id}" title="Delen naar WhatsApp">📤</button>
          <button data-dweg="${d.id}" title="Verwijderen" style="color:var(--uit)">🗑</button>
        </div>
      </div>`;
  }).join('')
  : `<div class="kaart leeg">Nog geen documenten${actief!=='alle' ? ' in deze categorie' : ''}.<br>Upload een PDF en koppel 'm aan één of meer teams.</div>`;

  return `
    <button class="upload-knop" id="documentUpload">📄 Document toevoegen voor één of meer teams
      <input type="file" id="documentFile" accept="application/pdf" style="display:none"></button>
    ${segment}
    ${lijst}`;
}

/* ---------- BERICHTEN (admin) ---------- */
const BERICHT_DUUR = [
  {id:'3d',   label:'3 dagen',  ms: 3*86400000},
  {id:'1w',   label:'1 week',   ms: 7*86400000},
  {id:'2w',   label:'2 weken',  ms: 14*86400000},
  {id:'1m',   label:'1 maand',  ms: 30*86400000},
  {id:'perm', label:"Tot ik 'm verwijder", ms: null},
];

function htmlClubBerichten(teams, berichten){
  const nu = Date.now();
  const lijst = berichten.length ? berichten.map(b => {
    const teamNamen = (b.teams||[]).map(tid => (teams.find(x => x.id === tid)?.naam) || '?').join(', ');
    const verlopen = b.zichtbaarTot != null && b.zichtbaarTot < nu;
    return `
      <div class="training-rij ${verlopen ? 'verlopen' : ''}">
        <div class="ico">📣</div>
        <div class="t"><div class="t-titel">${esc(b.titel)}</div>
          <div class="t-meta">${esc(teamNamen)} · ${verlopen ? 'verlopen' : (b.zichtbaarTot == null ? 'blijft staan' : 'actief')}</div></div>
        <div class="acties">
          <button data-bewerk-bericht="${b.id}" title="Aanpassen">✏️</button>
          <button data-verwijder-bericht="${b.id}" title="Verwijderen" style="color:var(--uit)">🗑</button>
        </div>
      </div>`;
  }).join('')
  : `<div class="kaart leeg">Nog geen berichten.<br>Plaats een bericht voor één of meer teams — coaches zien het als een balk bij het openen van hun team.</div>`;

  return `
    <button class="upload-knop" id="nieuwBericht">📣 Nieuw bericht voor één of meer teams</button>
    ${lijst}`;
}

/* Bericht opstellen of aanpassen. Toewijzing via dezelfde team-picker als
   trainingen/documenten (teamKeuzePerBouw). */
function modalNieuwBericht(teams, bestaand = null){
  const huidig = new Set(bestaand?.teams || []);
  // bij een bestaand bericht de duur-keuze niet terug-afleiden; default 'perm'
  // als het bericht al liep, anders 1 week voor een nieuw bericht.
  const duurStart = bestaand ? 'perm' : '1w';
  openModal(`
    <h2>${bestaand ? 'Bericht aanpassen' : 'Nieuw bericht'}</h2>
    <div class="veldgroep"><label>Titel</label>
      <input class="invoer" id="mBerTitel" value="${esc(bestaand?.titel || '')}" placeholder="Bijv. Nieuwe veldverdeling" autocomplete="off"></div>
    <div class="veldgroep"><label>Bericht</label>
      <textarea class="invoer" id="mBerBody" rows="3" placeholder="Wat moeten de coaches weten?">${esc(bestaand?.body || '')}</textarea></div>
    <div class="veldgroep"><label>Voor welke teams?</label>
      <div id="mBerTeams">${teams.length ? teamKeuzePerBouw(teams, huidig) : '<p style="font-size:calc(13px * var(--fs));color:var(--ink-2)">Geen teams in deze club.</p>'}</div>
      <div class="rij" style="margin-top:8px">
        <button class="knop licht klein" id="mBerAlle">Alle teams</button>
        <button class="knop licht klein" id="mBerGeen">Geen</button>
      </div>
    </div>
    <div class="veldgroep"><label>Hoe lang zichtbaar?</label>
      <div class="duur-rij" id="mBerDuur">
        ${BERICHT_DUUR.map(d => `<button type="button" class="duur-opt ${d.id===duurStart?'aan':''}" data-duur="${d.id}">${esc(d.label)}</button>`).join('')}
      </div>
    </div>
    <button class="knop vol" id="mBerOk">${bestaand ? 'Wijzigingen opslaan' : 'Bericht plaatsen'}</button>`);

  const sync = () => $$('#mBerTeams label').forEach(l => l.classList.toggle('aan', l.querySelector('input').checked));
  $$('#mBerTeams input').forEach(c => c.onchange = sync);
  $('#mBerAlle').onclick = () => { $$('#mBerTeams input').forEach(c => c.checked = true); sync(); };
  $('#mBerGeen').onclick = () => { $$('#mBerTeams input').forEach(c => c.checked = false); sync(); };
  let duur = duurStart;
  $$('#mBerDuur [data-duur]').forEach(b => b.onclick = () => {
    duur = b.dataset.duur;
    $$('#mBerDuur [data-duur]').forEach(x => x.classList.toggle('aan', x.dataset.duur === duur));
  });
  $('#mBerOk').onclick = async () => {
    const gekozen = $$('#mBerTeams input').filter(c => c.checked).map(c => c.dataset.tid);
    if (!gekozen.length) return meld('Kies minstens één team');
    const titel = $('#mBerTitel').value.trim();
    if (!titel) return meld('Geef het bericht een titel');
    const body = $('#mBerBody').value.trim();
    const duurDef = BERICHT_DUUR.find(d => d.id === duur) || BERICHT_DUUR[1];
    const zichtbaarTot = duurDef.ms == null ? null : Date.now() + duurDef.ms;
    sluitModal();
    try {
      if (bestaand){
        await updateDoc(doc(db,'berichten',bestaand.id), {titel, body, teams: gekozen, zichtbaarTot});
        meld('Bericht bijgewerkt');
      } else {
        await addDoc(collection(db,'berichten'), {
          club: S.clubId, clubNaam: S.club.naam,
          titel, body, teams: gekozen,
          zichtbaarTot,
          gemaakt: serverTimestamp(),
          door: S.user.displayName || S.user.email || '',
        });
        meld('Bericht geplaatst');
      }
      renderClub();
    } catch(e){
      console.error(e); meld('Opslaan mislukt: ' + (e.code || e.message));
    }
  };
}

function htmlClubInstel(teams = [], syncStatus = {}){
  const admins = Object.values(S.club.adminsInfo || {}).map(a => esc(a.naam)).join(', ');
  const huidigSeizoen = S.club.huidigSeizoen || SEIZOEN_FALLBACK;

  // --- voetbal.nl-koppeling: token per team ---
  const syncTijd = (ts) => {
    if (!ts) return '';
    try {
      const d = ts.seconds ? new Date(ts.seconds*1000) : new Date(ts);
      return d.toLocaleDateString('nl-NL',{day:'numeric',month:'short'}) + ' ' +
             d.toLocaleTimeString('nl-NL',{hour:'2-digit',minute:'2-digit'});
    } catch { return ''; }
  };
  const clientId = S.club.sportlinkClientId || '';
  const gekoppeld = !!clientId;

  // Per-team status: is dit team automatisch op naam gematcht bij de laatste sync?
  const teamRijen = teams.length ? teams.map(t => {
    const st = syncStatus[t.id] || {};
    let badge, onderregel = '';
    if (!gekoppeld){
      badge = `<span class="tok-status leeg">Wacht op koppeling</span>`;
    } else if (st.laatsteFout){
      badge = `<span class="tok-status leeg">Fout</span>`;
      onderregel = `<div class="tok-laatste" style="color:var(--uit)">Laatste sync mislukt: ${esc(st.laatsteFout)}</div>`;
    } else if (st.gematcht){
      badge = `<span class="tok-status gekoppeld">Gematcht</span>`;
      const aantal = st.laatsteAantal != null ? `${st.laatsteAantal} wedstrijd${st.laatsteAantal===1?'':'en'}` : '';
      onderregel = `<div class="tok-laatste">Laatste sync: <b>${esc(syncTijd(st.laatsteSync))}</b>${aantal?' · '+aantal:''}</div>`;
    } else if (st.laatsteSync){
      badge = `<span class="tok-status leeg">Niet gevonden</span>`;
      onderregel = `<div class="tok-laatste" style="color:var(--ink-2)">Teamnaam “${esc(t.naam)}” niet in Sportlink gevonden — controleer of de naam overeenkomt.</div>`;
    } else {
      badge = `<span class="tok-status leeg">Nog niet gesynct</span>`;
    }
    return `
      <div class="tok-rij">
        <div class="tok-kop"><span class="tok-team">${esc(t.naam)}</span>${badge}</div>
        ${onderregel}
      </div>`;
  }).join('') : `<p style="font-size:calc(13px * var(--fs));color:var(--ink-2)">Maak eerst teams aan.</p>`;

  const voetbalBlok = `
    <div class="sectie-kop">⚽ Sportlink-koppeling</div>
    <div class="kaart">
      <p class="uitleg" style="font-size:calc(13px * var(--fs));color:var(--ink-2);line-height:1.5;margin-bottom:8px">Vul één keer de <b>Client ID</b> van jullie Sportlink Club.Dataservice in. De app haalt daarmee automatisch het volledige programma, de uitslagen en de poulestanden op voor <b>alle</b> teams — teams worden op naam gekoppeld, dus per team hoef je niets meer te doen. De Client ID krijg je bij het afnemen van Club.Dataservice via Sportlink.</p>
      <div class="tok-invoer">
        <input type="text" id="clientIdInput"
               placeholder="Bijv. oEGJY6X0n9"
               value="${esc(clientId)}" autocomplete="off" spellcheck="false">
        <button id="clientIdOpslaan">Opslaan</button>
      </div>
      ${gekoppeld ? `<p style="font-size:calc(11.5px * var(--fs));color:var(--in);margin:8px 0 0">✓ Gekoppeld met Client ID <code style="font-size:calc(11px * var(--fs))">${esc(clientId)}</code></p>` : ''}
    </div>
    <div class="sectie-kop" style="font-size:calc(13px * var(--fs))">Teamstatus</div>
    <div class="kaart">${teamRijen}</div>
    <button class="knop vol" id="syncNu" style="margin-bottom:4px"${gekoppeld?'':' disabled'}>🔄 Sync nu alle teams</button>
    <p style="font-size:calc(11.5px * var(--fs));color:var(--ink-2);text-align:center;margin:8px 0 4px">De sync draait sowieso elke nacht automatisch.</p>`;

  return `
    <div class="kaart">
      <div class="sectie-kop" style="margin-top:0">📅 Seizoen</div>
      <div style="display:flex;align-items:center;gap:12px">
        <div style="flex:1">
          <div style="font-size:calc(11px * var(--fs));color:var(--ink-2);margin-bottom:2px">Huidig seizoen</div>
          <div class="cond" style="font-weight:700;font-size:calc(22px * var(--fs))">${esc(huidigSeizoen)}</div>
        </div>
        <button class="knop fluo" id="btnNieuwSeizoen">Nieuw seizoen starten →</button>
      </div>
      <p style="font-size:calc(12px * var(--fs));color:var(--ink-2);line-height:1.5;margin-top:10px">Nieuwe wedstrijden, trainingen, beoordelingen en teamevaluaties van alle teams tellen vanaf dat moment mee voor het nieuwe seizoen. Oude data blijft bewaard en is terug te zien via het seizoenfilter in de statistieken (⏱).</p>
      <button class="knop licht vol" id="migreerSeizoen" style="margin-top:10px">🗂️ Migreer bestaande data naar dit seizoen</button>
    </div>
    ${(() => {
      const modus = S.club.themaModus || 'coachKiest';
      const opt = (waarde, titel, sub) => `
        <button class="thema-optie ${modus===waarde?'gekozen':''}" data-thema-modus="${waarde}">
          <span class="tk-radio"></span>
          <span class="tk-body">
            <span class="tk-titel">${titel}</span>
            <span class="tk-sub">${sub}</span>
          </span>
        </button>`;
      return `
      <div class="kaart">
        <div class="sectie-kop" style="margin-top:0">🎨 Weergave &amp; thema</div>
        <p style="font-size:calc(12.5px * var(--fs));color:var(--ink-2);margin-bottom:12px">Bepaal het thema voor de hele club. Een geforceerde stand overschrijft de persoonlijke voorkeur van elke coach.</p>
        <div class="thema-modus" id="clubThemaModus">
          ${opt('donker','🌙 Alleen donker','Iedereen zit vast op donker. Coaches zien geen keuze.')}
          ${opt('licht','☀️ Alleen licht','Iedereen zit vast op licht. Coaches zien geen keuze.')}
          ${opt('lichtDefault','☀️ Standaard licht','Nieuwe coaches beginnen in het licht, maar kunnen zelf naar donker wisselen. Wie al bewust donker koos, houdt dat.')}
          ${opt('coachKiest','⚙️ Coach mag kiezen','Elke coach kiest zelf, opgeslagen op zijn eigen toestel. Zonder keuze volgt de app het toestel.')}
        </div>
      </div>`;
    })()}
    <div class="kaart">
      <div class="sectie-kop" style="margin-top:0">Club-uitnodiging</div>
      <p style="font-size:calc(13.5px * var(--fs));color:var(--ink-2)">Stuur deze link naar mede-admins. Zij worden dan ook beheerder van de club.</p>
      <div class="uitnodig-link" id="clubLink">${esc(location.origin + location.pathname + '?club=' + S.club.code)}</div>
      <button class="knop licht vol" id="kopieerClubLink" style="margin-top:8px">Link kopiëren</button>
    </div>
    <div class="kaart">
      <div class="sectie-kop" style="margin-top:0">Club-admins</div>
      <p style="font-size:calc(14px * var(--fs))">${admins || '—'}</p>
    </div>
    ${voetbalBlok}
    <button class="knop gevaar vol" id="verwijderClub">Club opheffen</button>`;
}

/* Stelt op basis van het huidige seizoen-label (bijv. "2025/'26") het
   volgende seizoen voor (bijv. "2026/'27"), als startpunt in de modal. */
function volgendSeizoen(huidig){
  const m = /^(\d{4})/.exec(huidig || '');
  const jaar = m ? Number(m[1]) + 1 : new Date().getFullYear();
  return `${jaar}/'${String(jaar+1).slice(-2)}`;
}

/* ---------- Nieuw seizoen starten ----------
   Alleen clubs/{clubId}.huidigSeizoen wordt bijgewerkt. Nieuwe documenten
   (wedstrijden, presentie, beoordelingen, teamevaluaties) van alle teams
   krijgen dit label vanaf hun eerstvolgende aanmaak-moment (zie teams.js/
   wedstrijd.js: die lezen S.huidigSeizoen, dat live meeluistert met dit veld).
   Bestaande data verandert hier niet — daarvoor is de migratieknop. */
function modalNieuwSeizoen(){
  const huidig = S.club.huidigSeizoen || SEIZOEN_FALLBACK;
  const voorstel = volgendSeizoen(huidig);
  openModal(`
    <h2>Nieuw seizoen starten</h2>
    <p style="font-size:calc(13px * var(--fs));color:var(--ink-2);margin-bottom:14px">Je huidige seizoen is <b>${esc(huidig)}</b>. Vanaf bevestigen loggen nieuwe wedstrijden, trainingen, beoordelingen en teamevaluaties van alle teams onder het nieuwe seizoen. Oude data blijft gewoon bewaard en is terug te zien via het seizoenfilter in de statistieken.</p>
    <div class="veldgroep"><label>Nieuw seizoen</label>
      <input class="invoer" id="mSeizoenNaam" value="${esc(voorstel)}" autocomplete="off" style="text-align:center;font-weight:700"></div>
    <div class="rij" style="margin-top:6px">
      <button class="knop licht vol" id="mSeizoenAnnuleer">Annuleren</button>
      <button class="knop vol" id="mSeizoenOk">Bevestigen</button>
    </div>`);
  $('#mSeizoenAnnuleer').onclick = () => sluitModal();
  $('#mSeizoenOk').onclick = async () => {
    const nieuw = $('#mSeizoenNaam').value.trim();
    if (!nieuw) return meld('Vul een seizoensnaam in');
    const knop = $('#mSeizoenOk'); knop.disabled = true; knop.textContent = 'Bezig...';
    try {
      await updateDoc(doc(db,'clubs',S.clubId), { huidigSeizoen: nieuw });
      sluitModal();
      meld(`Seizoen ${nieuw} gestart ✓`);
      renderClub();
    } catch(e){
      knop.disabled = false; knop.textContent = 'Bevestigen';
      meld('Opslaan mislukt: ' + (e.code || e.message));
    }
  };
}

/* ---------- Eenmalige migratie: bestaande data labelen ----------
   Loopt over wedstrijden/presentie/beoordelingen/teamevaluaties van alle
   teams van de club en zet seizoen = huidig clubseizoen op elk document dat
   nog geen seizoen-veld heeft. Documenten die al een label hebben (van ná
   deze feature) worden overgeslagen. Mag zo vaak gedraaid worden als nodig. */
async function migreerSeizoenData(teams){
  if (!teams.length) return meld('Geen teams om te migreren');
  const doel = S.club.huidigSeizoen || SEIZOEN_FALLBACK;
  if (!confirm(`Alle bestaande wedstrijden, trainingen, beoordelingen en teamevaluaties zonder seizoen-label worden gelabeld als "${doel}". Doorgaan?`)) return;
  const knop = $('#migreerSeizoen');
  const origTekst = knop ? knop.textContent : '';
  if (knop){ knop.disabled = true; knop.textContent = 'Bezig met migreren...'; }
  const subcollecties = ['wedstrijden','presentie','beoordelingen','teamevaluaties'];
  let batch = writeBatch(db);
  let inBatch = 0, totaal = 0;
  try {
    for (const t of teams){
      for (const sub of subcollecties){
        const snap = await getDocs(collection(db,'teams',t.id,sub));
        for (const d of snap.docs){
          if (d.data().seizoen) continue;
          batch.update(d.ref, { seizoen: doel });
          inBatch++; totaal++;
          if (inBatch >= 450){ await batch.commit(); batch = writeBatch(db); inBatch = 0; }
        }
      }
    }
    if (inBatch > 0) await batch.commit();
    meld(totaal ? `${totaal} bestaande items gelabeld als ${doel}` : 'Alles was al gelabeld');
  } catch(e){
    meld('Migreren mislukt: ' + (e.code || e.message));
  } finally {
    if (knop){ knop.disabled = false; knop.textContent = origTekst || '🗂️ Migreer bestaande data naar dit seizoen'; }
  }
}

/* ---------- Clubbrede afgelasting ---------- */
/* Schrijft het afgelast-veld naar ALLE team-documenten van de club tegelijk (Optie B),
   plus één centraal historie-record onder clubs/{clubId}/afgelastingen voor de stats.
   Geen naam in de afgelasting. Alleen de beheerder ziet/gebruikt deze knop. */
function modalClubAflasten(teams){
  const vandaag = new Date().toISOString().slice(0,10);
  openModal(`
    <h2>Training afgelasten</h2>
    <p style="font-size:calc(13px * var(--fs));color:var(--ink-2);margin-bottom:14px">Dit last de training af voor <b>alle ${teams.length} teams</b> van de club. Elke trainer kan het bericht daarna doorsturen in zijn eigen WhatsApp-groep.</p>
    <div class="veldgroep"><label>Welke dag?</label>
      <input class="invoer" id="mAflasDatum" type="date" value="${vandaag}" min="${vandaag}"></div>
    <div class="veldgroep"><label>Reden (optioneel)</label>
      <input class="invoer" id="mAflasReden" placeholder="Bijv. slecht weer, velden onbespeelbaar" autocomplete="off" maxlength="140"></div>
    <div class="rij" style="margin-top:6px">
      <button class="knop licht vol" id="mAflasAnnuleer">Annuleren</button>
      <button class="knop vol" id="mAflasOk">Aflasten voor hele club</button>
    </div>`);

  $('#mAflasAnnuleer').onclick = () => sluitModal();
  $('#mAflasOk').onclick = async () => {
    const datum = $('#mAflasDatum').value;
    if (!datum) return meld('Kies eerst een dag');
    const reden = ($('#mAflasReden').value || '').trim();
    const knop = $('#mAflasOk'); knop.disabled = true; knop.textContent = 'Aflasten...';
    const data = { datum, reden, tijd: serverTimestamp() };
    try {
      // 1) naar alle team-documenten van de club (Optie B)
      await Promise.all(teams.map(t =>
        updateDoc(doc(db,'teams',t.id), { afgelast: data })
      ));
      // 2) één centraal historie-record voor de stats
      await addDoc(collection(db,'clubs',S.clubId,'afgelastingen'), data);
      telGebruik('afgelasting');
      sluitModal();
      meld(`Training afgelast voor ${teams.length} teams`);
      renderClub();
    } catch(e){
      knop.disabled = false; knop.textContent = 'Aflasten voor hele club';
      meld('Aflasten mislukt: ' + (e.code || e.message));
    }
  };
}

async function clubAfgelastOpheffen(teams){
  if (!confirm('Afgelasting opheffen? De trainingen gaan dan weer gewoon door.')) return;
  try {
    // 1) wis het afgelast-veld op alle team-documenten (verbergt de banner)
    await Promise.all(teams.map(t =>
      updateDoc(doc(db,'teams',t.id), { afgelast: deleteField() })
    ));
    // 2) verwijder de actieve (vandaag/toekomstige) historie-records, zodat een
    //    per ongeluk ingestelde afgelasting de stats niet vervuilt en het clubscherm
    //    niet langer 'actief' toont. Opheffen = correctie van een vergissing.
    const vandaag = new Date().toISOString().slice(0,10);
    const actieve = (S.clubAfgelastingen || []).filter(a => a.datum >= vandaag);
    await Promise.all(actieve.map(a =>
      deleteDoc(doc(db,'clubs',S.clubId,'afgelastingen',a.id))
    ));
    meld('Afgelasting opgeheven');
    renderClub();
  } catch(e){
    meld('Opheffen mislukt: ' + (e.code || e.message));
  }
}

function koppelClubTab(v, tab, teams, trainingen, videos, documenten){
  if (tab === 'teams'){
    const aflastBtn = v.querySelector('#clubAflast');
    if (aflastBtn) aflastBtn.onclick = () => modalClubAflasten(teams);
    const opheffenBtn = v.querySelector('#clubAfgelastOpheffen');
    if (opheffenBtn) opheffenBtn.onclick = () => clubAfgelastOpheffen(teams);
    v.querySelector('#clubNieuwTeam').onclick = async () => (await teamsModule()).modalNieuwTeam(S.clubId);
    const impBtn = v.querySelector('#clubImporteerPDF');
    if (impBtn) impBtn.onclick = modalImporteerPDF;
    const linkBtn = v.querySelector('#clubAlleLinks');
    if (linkBtn) linkBtn.onclick = () => modalAlleLinks(teams);
    v.querySelectorAll('[data-open-team]').forEach(b => b.onclick = async e => {
      if (e.target.closest('[data-uitnodig-team]') || e.target.closest('[data-modules-team]')) return;
      (await teamsModule()).openTeam(b.dataset.openTeam);
    });
    v.querySelectorAll('[data-uitnodig-team]').forEach(b => b.onclick = e => {
      e.stopPropagation();
      const team = teams.find(t => t.id === b.dataset.uitnodigTeam);
      modalUitnodig(team);
    });
    v.querySelectorAll('[data-modules-team]').forEach(b => b.onclick = e => {
      e.stopPropagation();
      const team = teams.find(t => t.id === b.dataset.modulesTeam);
      modalTeamModules(team);
    });
  }
  if (tab === 'trainingen'){
    v.querySelectorAll('[data-bouw]').forEach(b => b.onclick = () => {
      S.clubTrainBouw = b.dataset.bouw; renderClub();
    });
    const knop = v.querySelector('#trainingUpload');
    const input = v.querySelector('#trainingFile');
    knop.onclick = () => input.click();
    input.onchange = e => {
      const file = e.target.files[0]; if (!file) return;
      modalNieuweTraining(file, teams, S.clubTrainBouw);
    };
    v.querySelectorAll('[data-tdownload]').forEach(b => b.onclick = () => window.open(b.dataset.tdownload, '_blank'));
    v.querySelectorAll('[data-ttekst]').forEach(b => b.onclick = async () => {
      const t = trainingen.find(x => x.id === b.dataset.ttekst);
      if (!t) return;
      const datum = t.gemaakt?.seconds ? new Date(t.gemaakt.seconds*1000).toLocaleDateString('nl-NL',{day:'numeric',month:'short'}) : '';
      const { openTrainingBewerken } = await import('./training-bewerken.js?v=20260819c');
      openTrainingBewerken({
        trainingId: t.id,
        titel: t.titel || t.bestandsnaam || 'Training',
        meta: [t.week, datum].filter(Boolean).join(' · '),
        oefeningen: t.oefeningen || [],
        paginas: t.paginas || [],
        onOpgeslagen: (nieuw) => { t.oefeningen = nieuw; },
      });
    });
    v.querySelectorAll('[data-tbewerk]').forEach(b => b.onclick = () => {
      const t = trainingen.find(x => x.id === b.dataset.tbewerk);
      modalBewerkTraining(t, teams);
    });
    v.querySelectorAll('[data-tshare]').forEach(b => b.onclick = () => {
      const t = trainingen.find(x => x.id === b.dataset.tshare);
      const tekst = `📄 Training ${t.titel || ''}\n${t.week || ''}\n${t.url}`;
      window.open('https://wa.me/?text=' + encodeURIComponent(tekst), '_blank');
    });
    v.querySelectorAll('[data-tweg]').forEach(b => b.onclick = async () => {
      const t = trainingen.find(x => x.id === b.dataset.tweg);
      if (!confirm(`Training "${t.titel || t.bestandsnaam}" verwijderen?`)) return;
      try { if (t.path) await deleteObject(sRef(storage, t.path)); } catch(e){}
      await deleteDoc(doc(db,'trainingen',t.id));
      meld('Training verwijderd'); renderClub();
    });
  }
  if (tab === 'videos'){
    v.querySelectorAll('[data-vbouw]').forEach(b => b.onclick = () => {
      S.clubVideoBouw = b.dataset.vbouw; renderClub();
    });
    v.querySelector('#videoToevoegen').onclick = () => modalNieuweVideo(teams, S.clubVideoBouw);
    const vUpKnop = v.querySelector('#videoUpload');
    const vUpInput = v.querySelector('#videoFile');
    if (vUpKnop && vUpInput){
      vUpKnop.onclick = () => vUpInput.click();
      vUpInput.onchange = e => {
        const file = e.target.files[0]; if (!file) return;
        modalUploadVideo(file, teams, S.clubVideoBouw);
      };
    }
    v.querySelectorAll('[data-vbewerk]').forEach(b => b.onclick = () => {
      const vid = videos.find(x => x.id === b.dataset.vbewerk);
      modalBewerkVideo(vid, teams);
    });
    v.querySelectorAll('[data-vshare]').forEach(b => b.onclick = () => {
      const vid = videos.find(x => x.id === b.dataset.vshare);
      const tekst = `🎬 ${vid.titel || 'Video'}\n${vid.url}`;
      window.open('https://wa.me/?text=' + encodeURIComponent(tekst), '_blank');
    });
    v.querySelectorAll('[data-vweg]').forEach(b => b.onclick = async () => {
      const vid = videos.find(x => x.id === b.dataset.vweg);
      if (!confirm(`Video "${vid.titel || ''}" verwijderen?`)) return;
      try { if (vid.path) await deleteObject(sRef(storage, vid.path)); } catch(e){}
      await deleteDoc(doc(db,'videos',vid.id));
      meld('Video verwijderd'); renderClub();
    });
  }
  if (tab === 'documenten'){
    v.querySelectorAll('[data-doccat]').forEach(b => b.onclick = () => {
      S.clubDocCategorie = b.dataset.doccat; renderClub();
    });
    const knop = v.querySelector('#documentUpload');
    const input = v.querySelector('#documentFile');
    knop.onclick = () => input.click();
    input.onchange = e => {
      const file = e.target.files[0]; if (!file) return;
      modalNieuwDocument(file, teams, S.clubDocCategorie);
    };
    v.querySelectorAll('[data-ddownload]').forEach(b => b.onclick = () => window.open(b.dataset.ddownload, '_blank'));
    v.querySelectorAll('[data-dbewerk]').forEach(b => b.onclick = () => {
      const d = documenten.find(x => x.id === b.dataset.dbewerk);
      modalBewerkDocument(d, teams);
    });
    v.querySelectorAll('[data-dshare]').forEach(b => b.onclick = () => {
      const d = documenten.find(x => x.id === b.dataset.dshare);
      const tekst = `📄 ${d.titel || 'Document'}\n${d.url}`;
      window.open('https://wa.me/?text=' + encodeURIComponent(tekst), '_blank');
    });
    v.querySelectorAll('[data-dweg]').forEach(b => b.onclick = async () => {
      const d = documenten.find(x => x.id === b.dataset.dweg);
      if (!confirm(`Document "${d.titel || d.bestandsnaam}" verwijderen?`)) return;
      try { if (d.path) await deleteObject(sRef(storage, d.path)); } catch(e){}
      await deleteDoc(doc(db,'documenten',d.id));
      meld('Document verwijderd'); renderClub();
    });
  }
  if (tab === 'berichten'){
    const knop = v.querySelector('#nieuwBericht');
    if (knop) knop.onclick = () => modalNieuwBericht(teams);
    v.querySelectorAll('[data-bewerk-bericht]').forEach(b => b.onclick = () => {
      const ber = (S.clubBerichten||[]).find(x => x.id === b.dataset.bewerkBericht);
      modalNieuwBericht(teams, ber);
    });
    v.querySelectorAll('[data-verwijder-bericht]').forEach(b => b.onclick = async () => {
      const ber = (S.clubBerichten||[]).find(x => x.id === b.dataset.verwijderBericht);
      if (!confirm(`Bericht "${ber?.titel || ''}" verwijderen?`)) return;
      await deleteDoc(doc(db,'berichten',b.dataset.verwijderBericht));
      meld('Bericht verwijderd'); renderClub();
    });
  }
  if (tab === 'dash-overzicht' || tab === 'dash-gebruik' || tab === 'dash-navigatie'){
    const sortBtn = v.querySelector('#dashSort');
    if (sortBtn) sortBtn.onclick = () => {
      S.clubDashSort = (S.clubDashSort ?? 'desc') === 'desc' ? 'asc' : 'desc';
      renderClub();
    };
    v.querySelectorAll('[data-dash-team]').forEach(tr => tr.onclick = async () => {
      (await teamsModule()).openTeam(tr.dataset.dashTeam);
    });
    v.querySelectorAll('[data-periode]').forEach(b => b.onclick = () => {
      S.clubDashPeriode = b.dataset.periode; renderClub();
    });
    v.querySelectorAll('[data-functieperiode]').forEach(b => b.onclick = () => {
      S.clubGebruikPeriode = b.dataset.functieperiode; renderClub();
    });
    v.querySelectorAll('[data-gebruik-cat]').forEach(kop => kop.onclick = () => {
      kop.closest('.gebruik-cat').classList.toggle('open');
    });
    v.querySelectorAll('[data-gebruik-wie]').forEach(t => t.onclick = e => {
      e.stopPropagation();
      const func = t.closest('.gebruik-func');
      const open = func.classList.toggle('open');
      t.textContent = open ? 'sluit' : 'wie';
    });
    v.querySelectorAll('[data-gebruik-meer]').forEach(b => b.onclick = () => {
      const rest = b.parentElement.querySelector('.gebruik-cat-rest');
      if (rest){ rest.style.display = 'block'; b.style.display = 'none'; }
    });
    // inklapbare dashboard-secties (aandacht, statistieken) — puur CSS-toggle,
    // stand onthouden zodat een re-render (periode wisselen) hem niet dichtklapt
    v.querySelectorAll('[data-dash-inklap]').forEach(kop => kop.onclick = () => {
      const blok = kop.closest('.dash-inklap');
      const open = blok.classList.toggle('open');
      blok.classList.toggle('dicht', !open);
      if (kop.dataset.dashInklap === 'aandacht') S.clubAandachtOpen = open;
      if (kop.dataset.dashInklap === 'stats')    S.clubStatsOpen = open;
      if (kop.dataset.dashInklap === 'nav')      S.clubNavOpen = open;
    });
    v.querySelectorAll('[data-navmodus]').forEach(b => b.onclick = () => { S.clubNavModus = b.dataset.navmodus; renderClub(); });
    const btnAlleGebr = v.querySelector('#btnAlleGebruikers');
    if (btnAlleGebr) btnAlleGebr.onclick = () => { S.clubAlleGebruikersOpen = !S.clubAlleGebruikersOpen; renderClub(); };
  }
  if (tab === 'instel'){
    const nieuwSeizoenBtn = v.querySelector('#btnNieuwSeizoen');
    if (nieuwSeizoenBtn) nieuwSeizoenBtn.onclick = () => modalNieuwSeizoen();
    const migreerBtn = v.querySelector('#migreerSeizoen');
    if (migreerBtn) migreerBtn.onclick = () => migreerSeizoenData(teams);
    // Clubbreed thema: 'donker'|'licht' forceren, of 'coachKiest' vrijlaten.
    // Wegschrijven naar het clubdocument; de seizoen-listener bij elke coach
    // pikt de wijziging live op en past het thema toe (clubdwang overschrijft
    // de persoonlijke voorkeur). De admin ziet direct het resultaat via de
    // eigen listener → renderClub.
    v.querySelectorAll('#clubThemaModus [data-thema-modus]').forEach(b => b.onclick = async () => {
      const modus = b.dataset.themaModus;
      if (S.club.themaModus === modus || (!S.club.themaModus && modus === 'coachKiest')){
        // al actief — alleen visueel bevestigen
        v.querySelectorAll('#clubThemaModus [data-thema-modus]').forEach(x =>
          x.classList.toggle('gekozen', x === b));
        return;
      }
      v.querySelectorAll('#clubThemaModus [data-thema-modus]').forEach(x =>
        x.classList.toggle('gekozen', x === b));
      try {
        await updateDoc(doc(db,'clubs',S.clubId), { themaModus: modus });
        S.club.themaModus = modus;
        const naam = modus === 'donker' ? 'Alleen donker'
                   : modus === 'licht'  ? 'Alleen licht'
                   : modus === 'lichtDefault' ? 'Standaard licht'
                   : 'Coach mag kiezen';
        meld('Thema voor de hele club: ' + naam);
      } catch(e){
        meld('Opslaan mislukt: ' + (e.code || e.message));
      }
    });
    v.querySelector('#kopieerClubLink').onclick = async () => {
      try { await navigator.clipboard.writeText($('#clubLink').textContent); meld('Link gekopieerd'); }
      catch { meld('Link: ' + $('#clubLink').textContent); }
    };
    // Sportlink Client ID (clubbreed) opslaan
    const clientIdBtn = v.querySelector('#clientIdOpslaan');
    if (clientIdBtn) clientIdBtn.onclick = async () => {
      const input = v.querySelector('#clientIdInput');
      const waarde = (input.value || '').trim();
      if (!waarde) return meld('Vul eerst een Client ID in');
      // Client ID's zijn korte alfanumerieke codes (bv. oEGJY6X0n9).
      if (!/^[A-Za-z0-9]{6,}$/.test(waarde)) return meld('Dat lijkt geen geldige Client ID');
      clientIdBtn.disabled = true; clientIdBtn.textContent = '...';
      try {
        await updateDoc(doc(db,'clubs',S.clubId), { sportlinkClientId: waarde });
        S.club.sportlinkClientId = waarde;
        meld('Client ID opgeslagen — klik op “Sync nu” om op te halen');
        renderClub();
      } catch(e){
        clientIdBtn.disabled = false; clientIdBtn.textContent = 'Opslaan';
        meld('Opslaan mislukt: ' + (e.code || e.message));
      }
    };
    // handmatige sync nu
    const syncBtn = v.querySelector('#syncNu');
    if (syncBtn) syncBtn.onclick = async () => {
      syncBtn.disabled = true; const orig = syncBtn.textContent; syncBtn.textContent = '🔄 Bezig met synchroniseren...';
      try {
        const fn = httpsCallable(functions, 'syncNu');
        const res = await fn({ clubId: S.clubId });
        const n = res.data?.totaalWedstrijden ?? 0;
        meld(`Sync klaar — ${n} wedstrijd${n===1?'':'en'} verwerkt`);
        renderClub();
      } catch(e){
        syncBtn.disabled = false; syncBtn.textContent = orig;
        meld('Sync mislukt: ' + (e.message || e.code || 'onbekende fout'));
      }
    };
    v.querySelector('#verwijderClub').onclick = async () => {
      if (!confirm('Club opheffen? Teams en trainingen blijven bestaan, maar zijn niet meer aan deze club gekoppeld.')) return;
      await deleteDoc(doc(db,'clubs',S.clubId));
      verlaatClubView();
    };
  }
}

/* ==================== UITNODIGEN ==================== */
export function modalUitnodig(team){
  const link = location.origin + location.pathname + '?team=' + team.code;
  openModal(`
    <h2>Coach uitnodigen voor ${esc(team.naam)}</h2>
    <p style="font-size:calc(13.5px * var(--fs));color:var(--ink-2);margin-bottom:12px">Stuur deze persoonlijke link naar de coach. Hij of zij klikt erop, logt in met e-mail of Google en zit direct in dit team.</p>
    <div class="uitnodig-link" id="uitnodigLink">${esc(link)}</div>
    <div class="rij" style="margin-top:12px">
      <button class="knop vol" id="mUitnodigKopieer">Link kopiëren</button>
      <button class="knop fluo vol" id="mUitnodigWa">📲 WhatsApp</button>
    </div>
    <p style="font-size:calc(12px * var(--fs));color:var(--ink-2);margin-top:12px">Of geef de teamcode mondeling door: <b>${esc(team.code)}</b></p>`);
  $('#mUitnodigKopieer').onclick = async () => {
    try { await navigator.clipboard.writeText(link); meld('Link gekopieerd'); }
    catch { meld('Link: ' + link); }
  };
  $('#mUitnodigWa').onclick = () => {
    const tekst = `Je bent uitgenodigd als coach voor ${team.naam}. Open deze link en log in met e-mail of Google:\n${link}`;
    window.open('https://wa.me/?text=' + encodeURIComponent(tekst), '_blank');
  };
}

function modalAlleLinks(teams){
  const link = t => location.origin + location.pathname + '?team=' + t.code;
  openModal(`
    <h2>🔗 Alle uitnodigingslinks</h2>
    <p style="font-size:calc(13px * var(--fs));color:var(--ink-2);margin-bottom:14px">Per team kun je hier snel de uitnodiging delen. Aantal gekoppelde coaches staat erbij.</p>
    <div style="max-height:60vh;overflow-y:auto;margin-bottom:14px">
      ${teams.map(t => `
        <div class="link-rij">
          <div class="link-rij-kop">
            <div><div class="titel">${esc(t.naam)}</div>
              <div class="meta">${Object.keys(t.leden||{}).length} coach(es) · code ${esc(t.code)}</div></div>
          </div>
          <div class="uitnodig-link">${esc(link(t))}</div>
          <div class="link-actie" style="margin-top:8px">
            <button data-kopieer="${esc(link(t))}">Kopieer</button>
            <button class="wa" data-wa="${t.id}">📲 WhatsApp</button>
          </div>
        </div>`).join('')}
    </div>
    <button class="knop vol" id="mLinksKopieerAlle">📋 Kopieer alles als lijst</button>`);
  $$('#modalInhoud [data-kopieer]').forEach(b => b.onclick = async () => {
    try { await navigator.clipboard.writeText(b.dataset.kopieer); meld('Link gekopieerd'); }
    catch { meld('Kon niet kopiëren'); }
  });
  $$('#modalInhoud [data-wa]').forEach(b => b.onclick = () => {
    const t = teams.find(x => x.id === b.dataset.wa);
    const tekst = `Je bent uitgenodigd als coach voor ${t.naam}. Open deze link en log in met e-mail of Google:\n${link(t)}`;
    window.open('https://wa.me/?text=' + encodeURIComponent(tekst), '_blank');
  });
  $('#mLinksKopieerAlle').onclick = async () => {
    const tekst = teams.map(t => `${t.naam}: ${link(t)}`).join('\n');
    try { await navigator.clipboard.writeText(tekst); meld('Alle links gekopieerd'); }
    catch { meld('Kon niet kopiëren'); }
  };
}

/* ==================== PDF-IMPORT TEAMS ==================== */
function detecteerCategorie(teamnaam){
  const m = teamnaam.toUpperCase().match(/^(JO|MO)(\d+)/);
  if (!m) return null;
  const cat = m[1] + m[2];
  return catInfo(cat) ? cat : null;
}
function voornaam(volledig){ return volledig.trim().split(/\s+/)[0]; }

async function parseTeamsUitPDF(file){
  const url = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.min.mjs';
  const workerUrl = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.worker.min.mjs';
  const pdfjs = await import(url);
  pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
  const buf = await file.arrayBuffer();
  const pdf = await pdfjs.getDocument({data: buf}).promise;

  const teams = [];
  const teamRegex = /^(JO|MO)\d+(-\d+)?(JM)?$/i;
  const skipRegex = /^(UITLEG|COÖRDINATOREN|MINI'S|JEUGD|2025|2026)$/i;

  for (let p = 1; p <= pdf.numPages; p++){
    const page = await pdf.getPage(p);
    const tc = await page.getTextContent();
    const items = tc.items.filter(it => it.str.trim()).map(it => ({
      str: it.str, x: it.transform[4], y: it.transform[5], w: it.width || 0,
    }));
    const headers = items.filter(it => teamRegex.test(it.str.trim()));

    for (const h of headers){
      const kolom = items.filter(it => Math.abs(it.x - h.x) < 60 && it.y < h.y && it.y > 30);
      const perRegel = {};
      for (const it of kolom){
        const k = Math.round(it.y);
        (perRegel[k] ||= []).push(it);
      }
      const regels = Object.keys(perRegel).map(Number).sort((a,b) => b - a);
      const spelers = [];
      for (const y of regels){
        const stk = perRegel[y].sort((a,b) => a.x - b.x);
        let s = '';
        for (let i = 0; i < stk.length; i++){
          if (i > 0){
            const vorigEnd = stk[i-1].x + stk[i-1].w;
            const gap = stk[i].x - vorigEnd;
            s += gap > 1.5 ? ' ' : '';
          }
          s += stk[i].str;
        }
        s = s.trim();
        if (/BEGELEIDING|VACATURE/i.test(s)) break;
        if (teamRegex.test(s)) break;
        if (s.length < 2) continue;
        if (skipRegex.test(s)) continue;
        spelers.push(s);
      }
      if (spelers.length){
        teams.push({
          naam: h.str.trim().toUpperCase(),
          categorie: detecteerCategorie(h.str),
          spelers: spelers.map(voornaam),
        });
      }
    }
  }
  return teams;
}

function modalImporteerPDF(){
  openModal(`
    <h2>📥 Teams importeren uit PDF</h2>
    <p style="font-size:calc(13px * var(--fs));color:var(--ink-2);margin-bottom:12px">Upload een PDF met de teamindeling. De app leest de teamnamen en spelersnamen uit, daarna kun je alles controleren voordat je de teams aanmaakt.</p>
    <label class="upload-knop" for="mPDFFile">📄 Kies PDF-bestand
      <input type="file" id="mPDFFile" accept="application/pdf" style="display:none"></label>
    <div id="mPDFStatus" style="font-size:calc(13px * var(--fs));color:var(--ink-2);text-align:center"></div>`);
  $('#mPDFFile').onchange = async e => {
    const file = e.target.files[0]; if (!file) return;
    $('#mPDFStatus').textContent = '⏳ PDF wordt gelezen, even geduld...';
    try {
      const teams = await parseTeamsUitPDF(file);
      if (!teams.length){
        $('#mPDFStatus').textContent = '❌ Geen teams gevonden in deze PDF. Controleer of de teamnamen in de vorm JO11-1, MO13-1 e.d. erin staan.';
        return;
      }
      sluitModal();
      modalImportPreview(teams);
    } catch (err) {
      console.error(err);
      $('#mPDFStatus').textContent = '❌ Kon de PDF niet lezen: ' + err.message;
    }
  };
}

function modalImportPreview(geparseerd){
  const teams = geparseerd.map(t => ({...t, aan: true, spelers: [...t.spelers]}));
  const render = () => {
    const blokjes = teams.map((t, ti) => {
      const tellingen = {};
      t.spelers.forEach(s => tellingen[s.toLowerCase()] = (tellingen[s.toLowerCase()]||0) + 1);
      return `
        <div class="preview-team ${t.aan?'':'uit'}" data-ti="${ti}">
          <div class="preview-team-kop">
            <input type="checkbox" data-aan="${ti}" ${t.aan?'checked':''}>
            <span class="naam">${esc(t.naam)}</span>
            <span class="meta">${t.categorie ? esc(t.categorie) : 'GEEN CAT.'}</span>
            <span class="meta">${t.spelers.length}</span>
          </div>
          <div class="preview-spelers">
            ${t.spelers.map((s,si) => `
              <span class="speler ${tellingen[s.toLowerCase()]>1?'dubbel':''}" title="${tellingen[s.toLowerCase()]>1?'Dubbele voornaam — pas aan om uniek te maken':''}">
                <input data-ti="${ti}" data-si="${si}" value="${esc(s)}" size="${Math.max(s.length, 5)}">
                <button data-weg="${ti}-${si}" title="Verwijderen">✕</button>
              </span>`).join('')}
            <span class="speler toevoeg" data-toevoeg="${ti}">+ Speler</span>
          </div>
        </div>`;
    }).join('');
    $('#mPrevInhoud').innerHTML = blokjes;
    const aantalAan = teams.filter(t => t.aan).length;
    const aantalSp  = teams.filter(t => t.aan).reduce((a,t) => a + t.spelers.length, 0);
    $('#mPrevSamenvat').textContent = `${aantalAan} team${aantalAan===1?'':'s'} · ${aantalSp} speler${aantalSp===1?'':'s'} worden aangemaakt`;
    koppelPreview();
  };
  const koppelPreview = () => {
    $$('[data-aan]').forEach(c => c.onchange = () => { teams[Number(c.dataset.aan)].aan = c.checked; render(); });
    $$('.preview-spelers input').forEach(i => i.oninput = () => {
      teams[Number(i.dataset.ti)].spelers[Number(i.dataset.si)] = i.value;
    });
    $$('.preview-spelers input').forEach(i => i.onblur = () => { i.size = Math.max(i.value.length, 5); });
    $$('[data-weg]').forEach(b => b.onclick = () => {
      const [ti, si] = b.dataset.weg.split('-').map(Number);
      teams[ti].spelers.splice(si,1); render();
    });
    $$('[data-toevoeg]').forEach(b => b.onclick = () => {
      const ti = Number(b.dataset.toevoeg);
      const naam = prompt('Voornaam:');
      if (naam && naam.trim()){ teams[ti].spelers.push(naam.trim()); render(); }
    });
  };
  openModal(`
    <h2>Controleren & aanpassen</h2>
    <p style="font-size:calc(13px * var(--fs));color:var(--ink-2)">Vink teams uit die je niet wilt aanmaken, klik op een naam om aan te passen, en let op de <span style="color:var(--uit);font-weight:600">rood gekleurde</span> dubbele voornamen.</p>
    <div id="mPrevSamenvat" style="font-size:calc(12.5px * var(--fs));font-weight:600;color:var(--grass);text-align:center;margin:10px 0"></div>
    <div id="mPrevInhoud" style="max-height:50vh;overflow-y:auto;margin-bottom:14px"></div>
    <button class="knop vol" id="mPrevOk">✓ Teams aanmaken</button>
    <button class="knop licht vol" id="mPrevAnnuleer" style="margin-top:8px">Annuleren</button>`);
  render();
  $('#mPrevAnnuleer').onclick = sluitModal;
  $('#mPrevOk').onclick = async () => {
    const teLijken = teams.filter(t => t.aan && t.spelers.length);
    if (!teLijken.length) return meld('Geen teams om aan te maken');
    $('#mPrevOk').disabled = true;
    $('#mPrevOk').textContent = 'Bezig...';
    let aangemaakt = 0;
    const afk = clubAfkorting(S.club.naam);
    const gebruikt = [...(S.clubTeams||[]).map(t => t.code)].filter(Boolean);
    for (const t of teLijken){
      const cat = t.categorie || 'JO11';
      const format = catInfo(cat).format;
      const geslacht = cat.startsWith('M') ? 'm' : 'j';
      const code = teamCode(t.naam, afk, gebruikt);
      gebruikt.push(code);
      const teamRef = await addDoc(collection(db,'teams'), {
        naam: t.naam, categorie: cat, geslacht, format, code,
        club: S.clubId, clubNaam: S.club.naam,
        leden: {[S.user.uid]: true},
        ledenInfo: {[S.user.uid]: {naam: S.user.displayName || S.user.email}},
        gemaakt: serverTimestamp(),
      });
      await updateDoc(doc(db,'clubs',S.clubId), {['teams.'+teamRef.id]: true});
      for (let i = 0; i < t.spelers.length; i++){
        await addDoc(collection(db,'teams',teamRef.id,'spelers'), {naam: t.spelers[i], nummer: i+1});
      }
      aangemaakt++;
    }
    sluitModal();
    meld(`✓ ${aangemaakt} team${aangemaakt===1?'':'s'} aangemaakt`);
    renderClub();
  };
}

/* ==================== TRAININGEN ==================== */
function isoWeek(d){
  const date = new Date(d.getTime());
  date.setHours(0,0,0,0);
  date.setDate(date.getDate() + 3 - (date.getDay() + 6) % 7);
  const week1 = new Date(date.getFullYear(), 0, 4);
  return 1 + Math.round(((date - week1) / 86400000 - 3 + (week1.getDay() + 6) % 7) / 7);
}

function modalNieuweTraining(file, teams, voorBouw = null){
  const weekNr = isoWeek(new Date());
  // teams groeperen per bouw
  const perBouw = {onder:[], midden:[], boven:[]};
  for (const t of teams) perBouw[bouwVanCategorie(t.categorie)].push(t);
  const groepHtml = BOUWEN.map(b => {
    const lijst = perBouw[b.id];
    if (!lijst.length) return '';
    return `
      <div style="font-size:calc(11.5px * var(--fs));font-weight:700;letter-spacing:.5px;text-transform:uppercase;color:var(--ink-2);margin:10px 0 6px">${esc(b.naam)}</div>
      <div class="team-chip-kies">
        ${lijst.map(t => {
          const aan = voorBouw ? b.id === voorBouw : false;
          return `<label data-pid="${t.id}" class="${aan?'aan':''}"><input type="checkbox" data-tid="${t.id}" ${aan?'checked':''}><span>${esc(t.naam)}</span></label>`;
        }).join('')}
      </div>`;
  }).join('');
  openModal(`
    <h2>Training uploaden</h2>
    <p style="font-size:calc(13px * var(--fs));color:var(--ink-2);margin-bottom:12px">Bestand: <b>${esc(file.name)}</b> (${(file.size/1024).toFixed(0)} KB)</p>
    <div class="veldgroep"><label>Titel</label>
      <input class="invoer" id="mTrTitel" value="Week ${weekNr} - training 1" autocomplete="off"></div>
    <div class="veldgroep"><label>Week / periode</label>
      <input class="invoer" id="mTrWeek" value="Week ${weekNr}" autocomplete="off"></div>
    <div class="veldgroep"><label>Voor welke teams?</label>
      <div id="mTrTeams">
        ${teams.length ? groepHtml : '<p style="font-size:calc(13px * var(--fs));color:var(--ink-2)">Maak eerst teams aan in deze club.</p>'}
      </div>
      <div class="rij" style="margin-top:8px">
        <button class="knop licht klein" id="mTrAlle">Alle teams</button>
        <button class="knop licht klein" id="mTrGeen">Geen</button>
      </div>
    </div>
    <button class="knop vol" id="mTrOk">Uploaden en delen</button>`);
  const sync = () => $$('#mTrTeams label').forEach(l => l.classList.toggle('aan', l.querySelector('input').checked));
  $$('#mTrTeams input').forEach(c => c.onchange = sync);
  $('#mTrAlle').onclick = () => { $$('#mTrTeams input').forEach(c => c.checked = true); sync(); };
  $('#mTrGeen').onclick = () => { $$('#mTrTeams input').forEach(c => c.checked = false); sync(); };
  $('#mTrOk').onclick = async () => {
    const gekozen = $$('#mTrTeams input').filter(c => c.checked).map(c => c.dataset.tid);
    if (!gekozen.length) return meld('Kies minstens één team');
    const titel = $('#mTrTitel').value.trim() || file.name;
    const week  = $('#mTrWeek').value.trim();
    startTrainingVerwerking(file, { titel, week, teams: gekozen });
  };
}

/* ---------- AI-verwerking van een training-PDF ----------
   Draait binnen dezelfde modal: upload PDF + diagrammen naar Storage, laat de
   AI de tekst structureren, bereken de overeenkomst-score, en toon een preview
   met de keuze: zo delen / opnieuw genereren / alleen als PDF delen.
   De originele PDF wordt ALTIJD bewaard, ongeacht de keuze. */
async function startTrainingVerwerking(file, meta){
  const mod = $('.modal'); if (!mod) return;
  const ts = Date.now();
  const mapId = String(ts);
  const veiligeNaam = file.name.replace(/[^a-zA-Z0-9._-]/g,'_');
  const pdfPath = `clubs/${S.clubId}/trainingen/${mapId}/${veiligeNaam}`;

  const toonVerwerk = (stapjesHtml) => {
    mod.innerHTML = `
      <div class="tr-verwerk">
        <div class="tr-spin"></div>
        <h2>Training omzetten</h2>
        <p>De app leest de PDF en maakt er een makkelijk leesbare weergave van voor je coaches.</p>
        <div class="tr-stapjes">${stapjesHtml}</div>
      </div>`;
  };
  const stap = (klaar, actief, rest) =>
    klaar.map(t=>`<div class="klaar">${t}</div>`).join('') +
    (actief?`<div class="actief">${actief}</div>`:'') +
    rest.map(t=>`<div>${t}</div>`).join('');

  try {
    const ai = await import('./training-ai.js?v=20260819c');

    toonVerwerk(stap([], 'PDF inlezen…', ['Diagrammen opslaan','Oefeningen structureren','Controleren']));
    const { paginas, diagramBlobs, bytes, aantalPaginas } = await ai.leesPdf(file);

    // originele PDF bewaren
    toonVerwerk(stap(['PDF ingelezen ('+aantalPaginas+' pagina’s)'], 'Origineel + diagrammen opslaan…', ['Oefeningen structureren','Controleren']));
    const pdfRef = sRef(storage, pdfPath);
    await uploadBytes(pdfRef, new Blob([bytes], {type:'application/pdf'}), {contentType:'application/pdf'});
    const pdfUrl = await getDownloadURL(pdfRef);
    const diagramUrls = await ai.uploadDiagrammen(S.clubId, mapId, diagramBlobs);

    // AI-structurering
    toonVerwerk(stap(['PDF ingelezen','Origineel + diagrammen opgeslagen'], 'Oefeningen structureren met AI…', ['Controleren']));
    let oefeningen;
    try {
      oefeningen = await ai.structureer(paginas);
      telGebruik('training_upload');
    } catch(e){
      console.error('[training-ai] structureren mislukt', e);
      return toonAlleenPdfKeuze(file, meta, { mapId, pdfPath, pdfUrl }, 'De automatische opmaak lukte niet. Je kunt de training wel gewoon als PDF delen.');
    }

    // overeenkomst-score (programmatisch)
    const origineleTekst = paginas.map(p=>p.tekst).join(' ');
    const score = ai.berekenScore(origineleTekst, oefeningen);

    toonPreview(file, meta, { mapId, pdfPath, pdfUrl, diagramUrls, oefeningen, score, paginas });
  } catch(e){
    console.error('[training-ai] verwerking mislukt', e);
    meld('Verwerking mislukt — staat Firebase Storage aan?');
    sluitModal();
  }
}

/* Preview-scherm met score + de drie keuzes. */
function toonPreview(file, meta, ctx){
  const mod = $('.modal'); if (!mod) return;
  const { score, oefeningen, diagramUrls } = ctx;
  const goed = score.dekkingPct >= 90 && score.verzonnenAantal <= 3;

  const scoreKaart = `
    <div class="tr-score ${goed?'goed':'fout'}">
      <div class="tr-score-kop">
        <span class="tr-badge ${goed?'goed-b':'fout-b'}">${goed?'✓':'!'}</span>
        <b>${goed?'Tekstcontrole geslaagd':'Tekstcontrole — let op'}</b>
      </div>
      <table class="tr-tabel">
        <tr><td>Tekst behouden uit PDF</td><td class="v ${goed?'goed-t':'fout-t'}">${score.dekkingPct}%</td></tr>
        <tr><td>Woorden door AI verzonnen</td><td class="v ${goed?'goed-t':'fout-t'}">${score.verzonnenAantal}</td></tr>
      </table>
      <p class="tr-score-uitleg">${goed
        ? 'De app heeft woord-voor-woord vergeleken: de AI paste alleen de <b>layout</b> aan, niet de tekst zelf.'
        : 'De AI week te veel af van de originele tekst. <b>Genereer opnieuw</b>, of deel de training alleen als PDF.'}</p>
      ${(!goed && score.verzonnenVoorbeelden.length)
        ? `<div class="tr-verzonnen"><span>Toegevoegde woorden:</span> ${esc(score.verzonnenVoorbeelden.join(', '))}…</div>` : ''}
    </div>`;

  const oefHtml = oefeningen.map((o,i)=>{
    const paginaKey = (o.diagramPagina != null) ? o.diagramPagina : (i+1);
    const url = (diagramUrls||{})[paginaKey] || (diagramUrls||{})[String(paginaKey)] || (diagramUrls||{})[i+1];
    const diagram = url ? `<figure class="trw-diagram"><img src="${esc(url)}" alt=""></figure>` : '';
    const blokken = (o.blokken||[]).map(b=>{
      const kop = b.kop?`<h3>${esc(b.kop)}</h3>`:'';
      if (b.type==='lijst' && Array.isArray(b.items))
        return kop+'<ul>'+b.items.map(x=>`<li>${esc(x)}</li>`).join('')+'</ul>';
      return kop+`<p>${esc(b.tekst||'')}</p>`;
    }).join('');
    return `<div class="trw-oef"><div class="trw-oef-kop"><span class="trw-oef-nr">${i+1}</span><h2>${esc(o.titel||'Oefening '+(i+1))}</h2></div>${diagram}<div class="hl">${blokken}</div></div>`;
  }).join('');

  const acties = `
    <div class="tr-preview-acties"><button class="knop vol" id="trDeel">✓ Zo delen</button></div>
    <div class="tr-preview-acties2">
      <button class="knop licht" id="trTekst">📝 Tekst controleren/bewerken</button>
    </div>
    <div class="tr-preview-acties2">
      <button class="knop licht" id="trOpnieuw">🔄 Opnieuw genereren</button>
      <button class="knop grijs" id="trPdfOnly">Alleen als PDF</button>
    </div>`;

  mod.innerHTML = `
    <h2>Controleer</h2>
    ${scoreKaart}
    <div style="font-size:calc(13px * var(--fs));color:var(--ink-2);margin-bottom:12px;line-height:1.45">Zo zien je coaches de training straks.${goed?' Klopt de opmaak? Deel hem.':''}</div>
    ${acties}
    ${oefHtml}
    ${acties}`;

  const deel = async () => {
    const b = $('#trDeel'); if (b){ b.disabled = true; b.textContent = 'Delen…'; }
    try {
      await addDoc(collection(db,'trainingen'), {
        club: S.clubId, clubNaam: S.club.naam,
        titel: meta.titel, week: meta.week, bestandsnaam: file.name,
        path: ctx.pdfPath, url: ctx.pdfUrl,
        mapId: ctx.mapId,
        oefeningen, diagramUrls,
        paginas: (ctx.paginas || []).map(p => ({ pagina: p.pagina, tekst: p.tekst })),
        aiScore: { dekking: score.dekkingPct, verzonnen: score.verzonnenAantal },
        teams: meta.teams,
        gemaakt: serverTimestamp(),
        door: S.user.displayName || S.user.email || '',
      });
      sluitModal(); meld('Training gedeeld'); renderClub();
    } catch(e){
      console.error(e); const bb = $('#trDeel'); if (bb){ bb.disabled = false; bb.textContent = '✓ Zo delen'; }
      meld('Delen mislukt');
    }
  };

  $$('#trDeel').forEach(b => b.onclick = deel);
  $$('#trPdfOnly').forEach(b => b.onclick = () => deelAlleenPdf(file, meta, ctx));
  $$('#trOpnieuw').forEach(b => b.onclick = () => startTrainingHerstructureer(file, meta, ctx));
  $$('#trTekst').forEach(b => b.onclick = async () => {
    const { openTrainingBewerken } = await import('./training-bewerken.js?v=20260819c');
    openTrainingBewerken({
      titel: meta.titel || file.name,
      meta: meta.week || '',
      oefeningen: ctx.oefeningen,
      paginas: ctx.paginas || [],
      // In de preview is er nog geen Firestore-doc: sla lokaal op en herteken
      // de preview met de aangepaste tekst.
      opslaanLokaal: (nieuw) => {
        ctx.oefeningen = nieuw;
        const score = ctx.score;  // score herberekenen is niet nodig voor bewerkte tekst
        toonPreview(file, meta, ctx);
      },
    });
  });
}

/* Alleen de AI opnieuw draaien (PDF + diagrammen bestaan al in Storage). */
async function startTrainingHerstructureer(file, meta, ctx){
  const mod = $('.modal'); if (!mod) return;
  mod.innerHTML = `<div class="tr-verwerk"><div class="tr-spin"></div><h2>Opnieuw genereren</h2><p>De AI probeert de opmaak nog een keer.</p></div>`;
  try {
    const ai = await import('./training-ai.js?v=20260819c');
    const { paginas } = await ai.leesPdf(file);
    const oefeningen = await ai.structureer(paginas);
    const origineleTekst = paginas.map(p=>p.tekst).join(' ');
    const score = ai.berekenScore(origineleTekst, oefeningen);
    toonPreview(file, meta, { ...ctx, oefeningen, score });
  } catch(e){
    console.error('[training-ai] opnieuw mislukt', e);
    toonAlleenPdfKeuze(file, meta, ctx, 'Opnieuw genereren lukte niet. Je kunt de training als PDF delen.');
  }
}

/* Training opslaan zonder AI-layout — alleen als PDF (bestaand gedrag). */
async function deelAlleenPdf(file, meta, ctx){
  const btn = $('#trPdfOnly'); if (btn){ btn.disabled = true; btn.textContent = 'Delen…'; }
  try {
    await addDoc(collection(db,'trainingen'), {
      club: S.clubId, clubNaam: S.club.naam,
      titel: meta.titel, week: meta.week, bestandsnaam: file.name,
      path: ctx.pdfPath, url: ctx.pdfUrl,
      teams: meta.teams,
      gemaakt: serverTimestamp(),
      door: S.user.displayName || S.user.email || '',
    });
    sluitModal(); meld('Training gedeeld (als PDF)'); renderClub();
  } catch(e){
    console.error(e); meld('Delen mislukt');
    if (btn){ btn.disabled = false; btn.textContent = 'Alleen als PDF'; }
  }
}

/* Fallback-scherm als de AI helemaal niet lukte: alleen-PDF aanbieden. */
function toonAlleenPdfKeuze(file, meta, ctx, boodschap){
  const mod = $('.modal'); if (!mod) return;
  mod.innerHTML = `
    <h2>Training delen</h2>
    <div class="tr-score fout" style="margin-top:4px">
      <div class="tr-score-kop"><span class="tr-badge fout-b">!</span><b>Automatische opmaak niet gelukt</b></div>
      <p class="tr-score-uitleg">${esc(boodschap||'')}</p>
    </div>
    <div class="tr-preview-acties"><button class="knop vol" id="trPdfOnly">Als PDF delen</button></div>
    <div class="tr-preview-acties2"><button class="knop grijs" id="trOpnieuw2">🔄 Opnieuw proberen</button></div>`;
  $('#trPdfOnly').onclick = () => deelAlleenPdf(file, meta, ctx);
  $('#trOpnieuw2').onclick = () => startTrainingHerstructureer(file, meta, ctx);
}

/* Toewijzing (titel, week, teams) van een bestaande training achteraf aanpassen
   — zonder het PDF-bestand opnieuw te uploaden. */
function modalBewerkTraining(t, teams){
  const huidig = new Set(t.teams || []);
  openModal(`
    <h2>Training aanpassen</h2>
    <p style="font-size:calc(13px * var(--fs));color:var(--ink-2);margin-bottom:12px">Bestand: <b>${esc(t.bestandsnaam || t.titel)}</b>${t.url ? ` · <a href="${esc(t.url)}" target="_blank" style="color:var(--grass);font-weight:600">openen ↗</a>` : ''}<br>Het PDF-bestand zelf blijft ongewijzigd.</p>
    <div class="veldgroep"><label>Titel</label>
      <input class="invoer" id="mTbTitel" value="${esc(t.titel || '')}" autocomplete="off"></div>
    <div class="veldgroep"><label>Week / periode</label>
      <input class="invoer" id="mTbWeek" value="${esc(t.week || '')}" autocomplete="off"></div>
    <div class="veldgroep"><label>Voor welke teams?</label>
      <div id="mTbTeams">
        ${teams.length ? BOUWEN.map(b => {
          const lijst = teams.filter(team => bouwVanCategorie(team.categorie) === b.id);
          if (!lijst.length) return '';
          return `
            <div style="font-size:calc(11.5px * var(--fs));font-weight:700;letter-spacing:.5px;text-transform:uppercase;color:var(--ink-2);margin:10px 0 6px">${esc(b.naam)}</div>
            <div class="team-chip-kies">
              ${lijst.map(team => `<label data-pid="${team.id}" class="${huidig.has(team.id)?'aan':''}"><input type="checkbox" data-tid="${team.id}" ${huidig.has(team.id)?'checked':''}><span>${esc(team.naam)}</span></label>`).join('')}
            </div>`;
        }).join('')
        : '<p style="font-size:calc(13px * var(--fs));color:var(--ink-2)">Geen teams in deze club.</p>'}
      </div>
      <div class="rij" style="margin-top:8px">
        <button class="knop licht klein" id="mTbAlle">Alle teams</button>
        <button class="knop licht klein" id="mTbGeen">Geen</button>
      </div>
    </div>
    <button class="knop vol" id="mTbOk">Wijzigingen opslaan</button>`);
  const sync = () => $$('#mTbTeams label').forEach(l => l.classList.toggle('aan', l.querySelector('input').checked));
  $$('#mTbTeams input').forEach(c => c.onchange = sync);
  $('#mTbAlle').onclick = () => { $$('#mTbTeams input').forEach(c => c.checked = true); sync(); };
  $('#mTbGeen').onclick = () => { $$('#mTbTeams input').forEach(c => c.checked = false); sync(); };
  $('#mTbOk').onclick = async () => {
    const gekozen = $$('#mTbTeams input').filter(c => c.checked).map(c => c.dataset.tid);
    if (!gekozen.length) return meld('Kies minstens één team');
    const titel = $('#mTbTitel').value.trim() || t.bestandsnaam || 'Training';
    const week  = $('#mTbWeek').value.trim();
    sluitModal();
    try {
      await updateDoc(doc(db,'trainingen',t.id), {teams: gekozen, titel, week});
      meld('Training bijgewerkt'); renderClub();
    } catch(e){
      console.error(e); meld('Opslaan mislukt: ' + (e.code || e.message));
    }
  };
}

/* ==================== VIDEO'S (YouTube-links) ==================== */
/* teams gegroepeerd per bouw als selecteerbare chips; voorvink = set met team-id's */
function teamKeuzePerBouw(teams, voorgevinkt){
  const vink = voorgevinkt instanceof Set ? voorgevinkt : new Set(voorgevinkt || []);
  return BOUWEN.map(b => {
    const lijst = teams.filter(t => bouwVanCategorie(t.categorie) === b.id);
    if (!lijst.length) return '';
    return `
      <div style="font-size:calc(11.5px * var(--fs));font-weight:700;letter-spacing:.5px;text-transform:uppercase;color:var(--ink-2);margin:10px 0 6px">${esc(b.naam)}</div>
      <div class="team-chip-kies">
        ${lijst.map(t => `<label data-pid="${t.id}" class="${vink.has(t.id)?'aan':''}"><input type="checkbox" data-tid="${t.id}" ${vink.has(t.id)?'checked':''}><span>${esc(t.naam)}</span></label>`).join('')}
      </div>`;
  }).join('');
}

function modalNieuweVideo(teams, voorBouw = null){
  const voor = voorBouw ? new Set(teams.filter(t => bouwVanCategorie(t.categorie) === voorBouw).map(t => t.id)) : new Set();
  openModal(`
    <h2>YouTube-video toevoegen</h2>
    <div class="veldgroep"><label>YouTube-link</label>
      <input class="invoer" id="mVdUrl" placeholder="https://www.youtube.com/watch?v=..." autocomplete="off"></div>
    <div class="veldgroep"><label>Titel</label>
      <input class="invoer" id="mVdTitel" placeholder="Bijv. Passing-oefening 3-hoek" autocomplete="off"></div>
    <div class="veldgroep"><label>Voor welke teams?</label>
      <div id="mVdTeams">${teams.length ? teamKeuzePerBouw(teams, voor) : '<p style="font-size:calc(13px * var(--fs));color:var(--ink-2)">Maak eerst teams aan in deze club.</p>'}</div>
      <div class="rij" style="margin-top:8px">
        <button class="knop licht klein" id="mVdAlle">Alle teams</button>
        <button class="knop licht klein" id="mVdGeen">Geen</button>
      </div>
    </div>
    <button class="knop vol" id="mVdOk">Toevoegen</button>`);
  const sync = () => $$('#mVdTeams label').forEach(l => l.classList.toggle('aan', l.querySelector('input').checked));
  $$('#mVdTeams input').forEach(c => c.onchange = sync);
  $('#mVdAlle').onclick = () => { $$('#mVdTeams input').forEach(c => c.checked = true); sync(); };
  $('#mVdGeen').onclick = () => { $$('#mVdTeams input').forEach(c => c.checked = false); sync(); };
  $('#mVdOk').onclick = async () => {
    const url = $('#mVdUrl').value.trim();
    if (!youtubeId(url)) return meld('Plak een geldige YouTube-link');
    const gekozen = $$('#mVdTeams input').filter(c => c.checked).map(c => c.dataset.tid);
    if (!gekozen.length) return meld('Kies minstens één team');
    const titel = $('#mVdTitel').value.trim() || 'Video';
    $('#mVdOk').disabled = true; $('#mVdOk').textContent = 'Bezig...';
    try {
      await addDoc(collection(db,'videos'), {
        club: S.clubId, clubNaam: S.club.naam,
        url, titel, teams: gekozen,
        gemaakt: serverTimestamp(),
        door: S.user.displayName || S.user.email || '',
      });
      sluitModal(); meld('Video toegevoegd'); renderClub();
    } catch(e){
      $('#mVdOk').disabled = false; $('#mVdOk').textContent = 'Toevoegen';
      meld('Opslaan mislukt: ' + (e.code || e.message));
    }
  };
}

function modalBewerkVideo(vid, teams){
  const huidig = new Set(vid.teams || []);
  const upload = vid.bron === 'upload';
  openModal(`
    <h2>Video aanpassen</h2>
    ${upload
      ? `<p style="font-size:calc(13px * var(--fs));color:var(--ink-2);margin-bottom:12px">Geüploade video: <b>${esc(vid.bestandsnaam || vid.titel || 'clip.mp4')}</b>${vid.url ? ` · <a href="${esc(vid.url)}" target="_blank" style="color:var(--grass);font-weight:600">openen ↗</a>` : ''}<br>Het videobestand zelf blijft ongewijzigd.</p>`
      : `<div class="veldgroep"><label>YouTube-link</label>
      <input class="invoer" id="mVbUrl" value="${esc(vid.url || '')}" autocomplete="off"></div>`}
    <div class="veldgroep"><label>Titel</label>
      <input class="invoer" id="mVbTitel" value="${esc(vid.titel || '')}" autocomplete="off"></div>
    <div class="veldgroep"><label>Voor welke teams?</label>
      <div id="mVbTeams">${teams.length ? teamKeuzePerBouw(teams, huidig) : '<p style="font-size:calc(13px * var(--fs));color:var(--ink-2)">Geen teams in deze club.</p>'}</div>
      <div class="rij" style="margin-top:8px">
        <button class="knop licht klein" id="mVbAlle">Alle teams</button>
        <button class="knop licht klein" id="mVbGeen">Geen</button>
      </div>
    </div>
    <button class="knop vol" id="mVbOk">Wijzigingen opslaan</button>`);
  const sync = () => $$('#mVbTeams label').forEach(l => l.classList.toggle('aan', l.querySelector('input').checked));
  $$('#mVbTeams input').forEach(c => c.onchange = sync);
  $('#mVbAlle').onclick = () => { $$('#mVbTeams input').forEach(c => c.checked = true); sync(); };
  $('#mVbGeen').onclick = () => { $$('#mVbTeams input').forEach(c => c.checked = false); sync(); };
  $('#mVbOk').onclick = async () => {
    const gekozen = $$('#mVbTeams input').filter(c => c.checked).map(c => c.dataset.tid);
    if (!gekozen.length) return meld('Kies minstens één team');
    const titel = $('#mVbTitel').value.trim() || 'Video';
    const wijziging = {titel, teams: gekozen};
    if (!upload){
      const url = $('#mVbUrl').value.trim();
      if (!youtubeId(url)) return meld('Plak een geldige YouTube-link');
      wijziging.url = url;
    }
    sluitModal();
    try {
      await updateDoc(doc(db,'videos',vid.id), wijziging);
      meld('Video bijgewerkt'); renderClub();
    } catch(e){
      meld('Opslaan mislukt: ' + (e.code || e.message));
    }
  };
}

/* Eigen videobestand (mp4) uploaden naar Storage en delen — zelfde patroon als
   de document-/training-upload, maar naar clubs/{clubId}/videos/ en met
   bron:'upload' zodat de weergave 'm inline afspeelt i.p.v. via YouTube. */
const MAX_VIDEO_MB = 100;
function modalUploadVideo(file, teams, voorBouw = null){
  if (file.size > MAX_VIDEO_MB * 1024 * 1024)
    return meld(`Bestand is te groot (max ${MAX_VIDEO_MB} MB). Comprimeer de clip eerst.`);
  const voor = voorBouw ? new Set(teams.filter(t => bouwVanCategorie(t.categorie) === voorBouw).map(t => t.id)) : new Set();
  openModal(`
    <h2>Video uploaden</h2>
    <p style="font-size:calc(13px * var(--fs));color:var(--ink-2);margin-bottom:12px">Bestand: <b>${esc(file.name)}</b> (${(file.size/1024/1024).toFixed(1)} MB)</p>
    <div class="veldgroep"><label>Titel</label>
      <input class="invoer" id="mVuTitel" value="${esc(file.name.replace(/\.[^.]+$/,''))}" autocomplete="off"></div>
    <div class="veldgroep"><label>Voor welke teams?</label>
      <div id="mVuTeams">${teams.length ? teamKeuzePerBouw(teams, voor) : '<p style="font-size:calc(13px * var(--fs));color:var(--ink-2)">Maak eerst teams aan in deze club.</p>'}</div>
      <div class="rij" style="margin-top:8px">
        <button class="knop licht klein" id="mVuAlle">Alle teams</button>
        <button class="knop licht klein" id="mVuGeen">Geen</button>
      </div>
    </div>
    <button class="knop vol" id="mVuOk">Uploaden en delen</button>`);
  const sync = () => $$('#mVuTeams label').forEach(l => l.classList.toggle('aan', l.querySelector('input').checked));
  $$('#mVuTeams input').forEach(c => c.onchange = sync);
  $('#mVuAlle').onclick = () => { $$('#mVuTeams input').forEach(c => c.checked = true); sync(); };
  $('#mVuGeen').onclick = () => { $$('#mVuTeams input').forEach(c => c.checked = false); sync(); };
  $('#mVuOk').onclick = async () => {
    const gekozen = $$('#mVuTeams input').filter(c => c.checked).map(c => c.dataset.tid);
    if (!gekozen.length) return meld('Kies minstens één team');
    const titel = $('#mVuTitel').value.trim() || file.name;
    const knop = $('.upload-knop');
    if (knop){ knop.classList.add('bezig'); knop.textContent = 'Uploaden...'; }
    sluitModal();
    try {
      const ts = Date.now();
      const veiligeNaam = file.name.replace(/[^a-zA-Z0-9._-]/g,'_');
      const path = `clubs/${S.clubId}/videos/${ts}_${veiligeNaam}`;
      const r = sRef(storage, path);
      await uploadBytes(r, file, {contentType: file.type || 'video/mp4'});
      const url = await getDownloadURL(r);
      await addDoc(collection(db,'videos'), {
        club: S.clubId, clubNaam: S.club.naam,
        bron: 'upload', url, path,
        titel, bestandsnaam: file.name, grootte: file.size,
        teams: gekozen,
        gemaakt: serverTimestamp(),
        door: S.user.displayName || S.user.email || '',
      });
      meld('Video geüpload'); renderClub();
    } catch(e){
      console.error(e); meld('Upload mislukt — staat Firebase Storage aan?');
      if (knop){ knop.classList.remove('bezig'); knop.textContent = '⬆️ Eigen video uploaden (mp4) voor één of meer teams'; }
    }
  };
}

/* ==================== DOCUMENTEN (KNVB, beleid, overig) ====================
   Zelfde upload-patroon als trainingen (PDF naar Storage), maar met een
   categorie-veld i.p.v. week/periode. De teamkeuze hergebruikt bewust de
   bestaande per-bouw-indeling (teamKeuzePerBouw) — niet omdat een document
   leeftijdsgebonden is, maar omdat het gewoon de handigste manier is om snel
   teams terug te vinden in een lange lijst. */
function modalNieuwDocument(file, teams, voorCategorie = null){
  openModal(`
    <h2>Document uploaden</h2>
    <p style="font-size:calc(13px * var(--fs));color:var(--ink-2);margin-bottom:12px">Bestand: <b>${esc(file.name)}</b> (${(file.size/1024).toFixed(0)} KB)</p>
    <div class="veldgroep"><label>Titel</label>
      <input class="invoer" id="mDoTitel" value="${esc(file.name.replace(/\.pdf$/i,''))}" autocomplete="off"></div>
    <div class="veldgroep"><label>Categorie</label>
      <select class="invoer" id="mDoCategorie">
        ${DOC_CATEGORIEN.map(c => `<option value="${c.id}" ${voorCategorie===c.id?'selected':''}>${c.naam}</option>`).join('')}
      </select></div>
    <div class="veldgroep"><label>Voor welke teams?</label>
      <div id="mDoTeams">${teams.length ? teamKeuzePerBouw(teams, new Set()) : '<p style="font-size:calc(13px * var(--fs));color:var(--ink-2)">Maak eerst teams aan in deze club.</p>'}</div>
      <div class="rij" style="margin-top:8px">
        <button class="knop licht klein" id="mDoAlle">Alle teams</button>
        <button class="knop licht klein" id="mDoGeen">Geen</button>
      </div>
    </div>
    <button class="knop vol" id="mDoOk">Uploaden en delen</button>`);
  const sync = () => $$('#mDoTeams label').forEach(l => l.classList.toggle('aan', l.querySelector('input').checked));
  $$('#mDoTeams input').forEach(c => c.onchange = sync);
  $('#mDoAlle').onclick = () => { $$('#mDoTeams input').forEach(c => c.checked = true); sync(); };
  $('#mDoGeen').onclick = () => { $$('#mDoTeams input').forEach(c => c.checked = false); sync(); };
  $('#mDoOk').onclick = async () => {
    const gekozen = $$('#mDoTeams input').filter(c => c.checked).map(c => c.dataset.tid);
    if (!gekozen.length) return meld('Kies minstens één team');
    const titel = $('#mDoTitel').value.trim() || file.name;
    const categorie = $('#mDoCategorie').value;
    const knop = $('.upload-knop');
    if (knop){ knop.classList.add('bezig'); knop.textContent = 'Uploaden...'; }
    sluitModal();
    try {
      const ts = Date.now();
      const veiligeNaam = file.name.replace(/[^a-zA-Z0-9._-]/g,'_');
      const path = `clubs/${S.clubId}/documenten/${ts}_${veiligeNaam}`;
      const r = sRef(storage, path);
      await uploadBytes(r, file, {contentType:'application/pdf'});
      const url = await getDownloadURL(r);
      await addDoc(collection(db,'documenten'), {
        club: S.clubId, clubNaam: S.club.naam,
        titel, categorie, bestandsnaam: file.name, path, url,
        teams: gekozen,
        gemaakt: serverTimestamp(),
        door: S.user.displayName || S.user.email || '',
      });
      meld('Document geüpload'); renderClub();
    } catch(e){
      console.error(e); meld('Upload mislukt — staat Firebase Storage aan?');
      if (knop){ knop.classList.remove('bezig'); knop.textContent = '📄 Document toevoegen voor één of meer teams'; }
    }
  };
}

/* Toewijzing (titel, categorie, teams) van een bestaand document achteraf
   aanpassen — zonder het PDF-bestand opnieuw te uploaden. */
function modalBewerkDocument(d, teams){
  const huidig = new Set(d.teams || []);
  openModal(`
    <h2>Document aanpassen</h2>
    <p style="font-size:calc(13px * var(--fs));color:var(--ink-2);margin-bottom:12px">Bestand: <b>${esc(d.bestandsnaam || d.titel)}</b>${d.url ? ` · <a href="${esc(d.url)}" target="_blank" style="color:var(--grass);font-weight:600">openen ↗</a>` : ''}<br>Het PDF-bestand zelf blijft ongewijzigd.</p>
    <div class="veldgroep"><label>Titel</label>
      <input class="invoer" id="mDbTitel" value="${esc(d.titel || '')}" autocomplete="off"></div>
    <div class="veldgroep"><label>Categorie</label>
      <select class="invoer" id="mDbCategorie">
        ${DOC_CATEGORIEN.map(c => `<option value="${c.id}" ${d.categorie===c.id?'selected':''}>${c.naam}</option>`).join('')}
      </select></div>
    <div class="veldgroep"><label>Voor welke teams?</label>
      <div id="mDbTeams">${teams.length ? teamKeuzePerBouw(teams, huidig) : '<p style="font-size:calc(13px * var(--fs));color:var(--ink-2)">Geen teams in deze club.</p>'}</div>
      <div class="rij" style="margin-top:8px">
        <button class="knop licht klein" id="mDbAlle">Alle teams</button>
        <button class="knop licht klein" id="mDbGeen">Geen</button>
      </div>
    </div>
    <button class="knop vol" id="mDbOk">Wijzigingen opslaan</button>`);
  const sync = () => $$('#mDbTeams label').forEach(l => l.classList.toggle('aan', l.querySelector('input').checked));
  $$('#mDbTeams input').forEach(c => c.onchange = sync);
  $('#mDbAlle').onclick = () => { $$('#mDbTeams input').forEach(c => c.checked = true); sync(); };
  $('#mDbGeen').onclick = () => { $$('#mDbTeams input').forEach(c => c.checked = false); sync(); };
  $('#mDbOk').onclick = async () => {
    const gekozen = $$('#mDbTeams input').filter(c => c.checked).map(c => c.dataset.tid);
    if (!gekozen.length) return meld('Kies minstens één team');
    const titel = $('#mDbTitel').value.trim() || d.bestandsnaam || 'Document';
    const categorie = $('#mDbCategorie').value;
    sluitModal();
    try {
      await updateDoc(doc(db,'documenten',d.id), {teams: gekozen, titel, categorie});
      meld('Document bijgewerkt'); renderClub();
    } catch(e){
      console.error(e); meld('Opslaan mislukt: ' + (e.code || e.message));
    }
  };
}
