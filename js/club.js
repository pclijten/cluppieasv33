import {
  db, storage, collection, doc, addDoc, deleteDoc, updateDoc, deleteField, getDoc, setDoc, getDocs,
  query, where, onSnapshot, serverTimestamp, documentId, writeBatch,
  sRef, uploadBytes, getDownloadURL, deleteObject,
  functions, httpsCallable
} from './firebase.js?v=20260719';
import {
  S, $, $$, esc, meld, nieuweCode, teamCode, clubAfkorting, openModal, sluitModal, toon, stopUnsubs, initialen, isBeheerder
} from './state.js?v=20260719';
import { CATEGORIEEN, CATEGORIEEN_MEIDEN, catInfo, BOUWEN, bouwVanCategorie, bouwNaam, youtubeId, youtubeThumb, youtubeWatch, SEIZOEN_FALLBACK } from './config.js?v=20260719';
import { analyseWedstrijd } from './analyse.js?v=20260719';
import { clubEvaluatiesOphalen, htmlClubEvaluaties, koppelClubEvaluaties } from './club-evaluaties.js?v=20260719';
import { startClubContentListener, htmlClubContent, koppelClubContent } from './club-content.js?v=20260719';

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
async function teamsModule(){ return await import('./teams.js?v=20260719'); }

/* ==================== CLUB AANMAKEN ==================== */
export function modalNieuwClub(){
  openModal(`
    <h2>🏛 Nieuwe club</h2>
    <p style="font-size:13px;color:var(--ink-2);margin-bottom:12px">Als club-admin maak jij teams aan en deel je trainingen voor alle teams. Coaches nodig je uit met een persoonlijke teamlink.</p>
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
  S.clubId = clubId; S.clubTab = 'teams'; S.teamId = null;
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
}

export function verlaatClubView(){
  stopUnsubs('club', 'clubContent');
  S.clubId = null; S.club = null;
  import('./teams.js?v=20260719').then(m => { m.renderTeams(); toon('teams'); });
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

/* haalt de token uit een geplakte voetbal.nl-link.
   Accepteert de hele URL (…ical-team?token=XXXX) of een kale token. */
/* herkent wat er geplakt is en geeft terug wat we moeten opslaan:
   - een Sportlink-token  → { veld:'icalToken', waarde: token }
   - een volledige iCal-URL (bv. Google Agenda, of de hele Sportlink-link)
       → { veld:'icalUrl', waarde: url }
   geeft null bij onherkenbare invoer. */
function herkenKoppeling(ruw){
  const s = ruw.trim();
  // 1) Sportlink-link met ?token=... → alleen de token bewaren (compact + veilig)
  const m = s.match(/[?&]token=([A-Za-z0-9]+)/);
  if (m) return { veld: 'icalToken', waarde: m[1] };
  // 2) een andere volledige URL (https://...) → als icalUrl bewaren
  if (/^https?:\/\/.+/i.test(s)) return { veld: 'icalUrl', waarde: s };
  // 3) een kale Sportlink-token (alleen letters/cijfers, redelijke lengte)
  if (/^[A-Za-z0-9]{15,}$/.test(s)) return { veld: 'icalToken', waarde: s };
  return null;
}

/* afgelast-historie: centrale lijst onder clubs/{clubId}/afgelastingen (nieuw → oud) */
async function clubAfgelastingenOphalen(){
  const snap = await getDocs(collection(db,'clubs',S.clubId,'afgelastingen'));
  return snap.docs.map(d => ({id:d.id, ...d.data()}))
    .sort((a,b) => (b.datum||'').localeCompare(a.datum||''));
}

/* voetbal.nl-syncstatus per team uit clubs/{clubId}/geheim/{teamId}.
   We lezen alleen de statusvelden (laatsteSync, laatsteAantal, laatsteFout) en
   of er een token staat — de token-waarde zelf tonen we nooit. */
async function clubSyncStatusOphalen(teams){
  const status = {};
  await Promise.all(teams.map(async t => {
    try {
      const snap = await getDoc(doc(db,'clubs',S.clubId,'geheim',t.id));
      if (snap.exists()){
        const d = snap.data();
        status[t.id] = {
          gekoppeld: !!(d.icalToken || d.icalUrl),
          laatsteSync: d.laatsteSync || null,
          laatsteAantal: d.laatsteAantal ?? null,
          laatsteFout: d.laatsteFout || null,
        };
      } else {
        status[t.id] = { gekoppeld: false };
      }
    } catch(e){
      status[t.id] = { gekoppeld: false };
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

function htmlClubDashboard(teams, dash, gebruik){
  if (!teams.length) return `<div class="kaart leeg">Nog geen teams in deze club.<br>Zodra er teams, wedstrijden en trainingen zijn, verschijnt hier een overzicht.</div>`;

  const totSpelers = dash.reduce((s,d) => s + d.spelersAantal, 0);
  const totCoaches = dash.reduce((s,d) => s + d.coachesAantal, 0);
  const wedstrijdenWeek = dash.reduce((s,d) => s + d.activiteiten.filter(a => a.soort==='wedstrijd' && dagenSinds(a.datum) <= 7).length, 0);

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
      <div class="sectie-kop" style="margin-top:0">⚠️ Aandacht nodig</div>
      ${signalen.length ? `
        <div class="caf-historie">
          ${signalen.slice(0,8).map(s => `
            <div class="caf-rij">
              <span class="caf-rij-datum" style="${s.ernstig?'color:var(--uit)':''}">${esc(s.team)}</span>
              <span class="caf-rij-reden">${esc(s.reden)}</span>
            </div>`).join('')}
        </div>` : `<p style="font-size:13px;color:var(--ink-2)">✅ Alle teams zijn actief en up-to-date.</p>`}
    </div>

    <div class="kaart">
      <div class="sectie-kop" style="margin-top:0">
        Teams
        <button class="actie" id="dashSort" style="margin-left:auto;font-size:11px;font-weight:700;color:var(--ink-2);text-transform:uppercase;letter-spacing:.3px">Activiteit ${sortDesc?'↓':'↑'}</button>
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
        </div>`).join('') : `<p style="font-size:13px;color:var(--ink-2)">Nog geen wedstrijden of presentie geregistreerd.</p>`}
    </div>

    ${htmlClubGebruik(gebruik)}`;
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

  return { logins, gebruikers };
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
        <div style="display:flex;align-items:center;gap:10px;padding:5px 0;font-size:12.5px">
          <span style="width:56px;flex-shrink:0;color:var(--ink-2)">${esc(d.label)}</span>
          <span style="flex:1;height:14px;background:var(--surface-2);border-radius:7px;overflow:hidden">
            <span style="display:block;height:100%;width:${Math.round((d.n/max)*100)}%;background:var(--accent);border-radius:7px"></span>
          </span>
          <span style="width:22px;text-align:right;font-weight:700">${d.n}</span>
        </div>`).join('')}
      <p style="font-size:11px;color:var(--ink-2);margin-top:8px">Aantal unieke coaches dat inlogde per ${periode==='dag'?'dag':periode==='week'?'week':'maand'}.</p>
    </div>

    <div class="kaart">
      <div class="sectie-kop" style="margin-top:0">Meest actieve gebruikers</div>
      ${gebruik.gebruikers.length ? gebruik.gebruikers.slice(0,10).map(g => `
        <div class="lid-rij">
          <div class="lid-avatar">${esc(initialen(g.naam || g.email || '?'))}</div>
          <div class="lid-naam">${esc(g.naam || g.email || 'Onbekend')}
            <div style="font-size:12px;color:var(--ink-2);font-weight:500;margin-top:1px">${g.email?esc(g.email)+' · ':''}laatst: ${dashTijdKort(g.laatsteLogin)}</div>
          </div>
          <div style="font-family:'Barlow Condensed';font-weight:700;font-size:18px;color:var(--accent);flex-shrink:0">${g.aantalLogins||0}</div>
        </div>`).join('') : `<p style="font-size:13px;color:var(--ink-2)">Nog geen logins geregistreerd.</p>`}
    </div>`;
}

async function renderClub(){
  if (!S.club) return;
  const v = $('#view-club');
  const teams = await clubTeamsOphalen();
  S.clubTeams = teams;
  const trainingen = await clubTrainingenOphalen();
  S.clubTrainingen = trainingen;
  const videos = await clubVideosOphalen();
  S.clubVideos = videos;
  const documenten = await clubDocumentenOphalen();
  S.clubDocumenten = documenten;
  const afgelastingen = await clubAfgelastingenOphalen();
  S.clubAfgelastingen = afgelastingen;
  const tab = S.clubTab;
  // syncstatus per team ophalen (alleen nodig op de instel-tab, om reads te sparen)
  let syncStatus = {};
  if (tab === 'instel'){
    syncStatus = await clubSyncStatusOphalen(teams);
  }
  let inhoud = '';
  if (tab === 'teams')      inhoud = htmlClubTeams(teams, afgelastingen);
  if (tab === 'trainingen') inhoud = htmlClubTrainingen(teams, trainingen);
  if (tab === 'videos')     inhoud = htmlClubVideos(teams, videos);
  if (tab === 'documenten') inhoud = htmlClubDocumenten(teams, documenten);
  let clubEvalData = null;
  if (tab === 'dashboard'){
    const dashModus = S.clubDashModus || 'overzicht';
    const segment = `
      <div class="segment" id="clubDashModus" style="margin-bottom:14px">
        <button data-dashmodus="overzicht" class="${dashModus==='overzicht'?'actief':''}">Overzicht</button>
        <button data-dashmodus="evaluaties" class="${dashModus==='evaluaties'?'actief':''}">📈 Evaluaties</button>
      </div>`;
    if (dashModus === 'evaluaties'){
      clubEvalData = await clubEvaluatiesOphalen(teams);
      inhoud = segment + htmlClubEvaluaties(clubEvalData);
    } else {
      const dash = await clubDashboardOphalen(teams);
      const gebruik = await clubGebruikOphalen(teams);
      inhoud = segment + htmlClubDashboard(teams, dash, gebruik);
    }
  }
  if (tab === 'instel')     inhoud = htmlClubInstel(teams, syncStatus);
  let contentLijst = null;
  if (tab === 'content' && isBeheerder()){
    stopUnsubs('clubContent');
    await new Promise(resolve => {
      let opgelost = false;
      S.unsub.clubContent = startClubContentListener(lijst => {
        contentLijst = lijst;
        if (!opgelost){ opgelost = true; resolve(); }
        else if (S.clubTab === 'content') renderClub(); // latere wijziging: live herrenderen
      });
    });
    inhoud = htmlClubContent(contentLijst);
  }
  v.innerHTML = `
    <div class="kop"><button class="terug" id="naarTeams">‹</button>
      <h1>🏛 ${esc(S.club.naam)}<span class="sub">${Object.keys(S.club.teams||{}).length} teams · clubcode ${esc(S.club.code)}</span></h1></div>
    ${inhoud}
    <nav class="onderbalk">
      ${[['teams','<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="8" r="2.8"/><path d="M3.5 19a5.5 5.5 0 0 1 11 0"/><circle cx="17" cy="8.5" r="2.3"/><path d="M15.5 13.4A4.8 4.8 0 0 1 20.5 18"/></svg>','Teams'],['trainingen','<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="4.5" width="14" height="16" rx="2.2"/><path d="M9 3.2h6v3H9z"/><path d="M8.8 12.2l2.2 2.2 4.2-4.4"/></svg>','Training'],['videos','<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="6" width="13" height="12" rx="2.2"/><path d="M16 10l5-3v10l-5-3z"/></svg>','Videos'],['documenten','<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3.5 8.2 6 4.8h5.6l2 3.4H20a.7.7 0 0 1 .7.7v9.3a1 1 0 0 1-1 1H4.3a1 1 0 0 1-1-1V8.9a.7.7 0 0 1 .2-.7z"/></svg>','Documenten'],['dashboard','<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 19V10"/><path d="M11 19V5"/><path d="M18 19v-7"/></svg>','Dashboard'],
        ...(isBeheerder() ? [['content','<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M6 3h9l4 4v14H6z"/><path d="M9 11h8M9 15h8M9 7h3"/></svg>','Content']] : []),
        ['instel','<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 13a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-2.7.6 1.6 1.6 0 0 0-1.1 1.5V20a2 2 0 1 1-4 0v-.1a1.6 1.6 0 0 0-1-1.5 1.6 1.6 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.6 1.6 0 0 0 .3-1.8 1.6 1.6 0 0 0-1.5-1H4a2 2 0 1 1 0-4h.1a1.6 1.6 0 0 0 1.5-1 1.6 1.6 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.6 1.6 0 0 0 1.8.3H10a1.6 1.6 0 0 0 1-1.5V4a2 2 0 1 1 4 0v.1a1.6 1.6 0 0 0 1 1.5 1.6 1.6 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0-.3 1.8V10a1.6 1.6 0 0 0 1.5 1H20a2 2 0 1 1 0 4h-.1a1.6 1.6 0 0 0-1.5 1z"/></svg>','Club']]
        .map(([id,ico,naam]) => `<button data-ctab="${id}" class="${tab===id?'actief':''}"><span class="ico">${ico}</span>${naam}</button>`).join('')}
    </nav>`;
  v.querySelector('#naarTeams').onclick = () => history.back();
  v.querySelectorAll('[data-ctab]').forEach(b => b.onclick = () => { S.clubTab = b.dataset.ctab; renderClub(); });
  v.querySelectorAll('[data-dashmodus]').forEach(b => b.onclick = () => { S.clubDashModus = b.dataset.dashmodus; renderClub(); });
  if (tab === 'content' && contentLijst){
    koppelClubContent(v);
  }
  if (tab === 'dashboard' && S.clubDashModus === 'evaluaties' && clubEvalData){
    koppelClubEvaluaties(v, clubEvalData, () => renderClub());
  }
  koppelClubTab(v, tab, teams, trainingen, videos, documenten);
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
        <div class="mini-shirt" style="width:40px;height:40px;border-radius:50%;background:var(--grass);color:#fff;display:flex;align-items:center;justify-content:center;font-family:'Barlow Condensed';font-weight:700;font-size:16px">${esc(t.format)}v${esc(t.format)}</div>
        <div><div class="titel">${esc(t.naam)}</div>
        <div class="meta">${esc(t.categorie || '—')} · ${Object.keys(t.leden||{}).length} coach(es)</div></div>
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
    return `
      <div class="training-rij">
        <div class="ico">PDF</div>
        <div class="t"><div class="t-titel">${esc(t.titel || t.bestandsnaam)}</div>
          <div class="t-meta">${esc(t.week || '')}${t.week?' · ':''}${esc(teamNamen)}</div></div>
        <div class="acties">
          <button data-tdownload="${esc(t.url)}" title="Openen">↗</button>
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
    const id = youtubeId(vid.url);
    return `
      <div class="video-rij">
        <a class="thumb" href="${esc(youtubeWatch(id) || vid.url)}" target="_blank" rel="noopener">
          ${id ? `<img src="${esc(youtubeThumb(id))}" alt="" loading="lazy"><span class="play">▶</span>` : '<span class="play">▶</span>'}
        </a>
        <div class="v"><div class="v-titel">${esc(vid.titel || 'Video')}</div>
          <div class="v-meta">${esc(teamNamen || '—')}</div></div>
        <div class="acties">
          <button data-vbewerk="${vid.id}" title="Teams en titel wijzigen">✏️</button>
          <button data-vshare="${vid.id}" title="Delen naar WhatsApp">📤</button>
          <button data-vweg="${vid.id}" title="Verwijderen" style="color:var(--uit)">🗑</button>
        </div>
      </div>`;
  }).join('')
  : `<div class="kaart leeg">Nog geen video's voor de ${esc(bouwNaam(actief).toLowerCase())}.<br>Plak een YouTube-link en koppel hem aan een team uit deze bouw.</div>`;

  return `
    <button class="upload-knop" id="videoToevoegen">🎬 YouTube-video toevoegen voor één of meer teams</button>
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
  const tokenRijen = teams.length ? teams.map(t => {
    const st = syncStatus[t.id] || {};
    const badge = st.gekoppeld
      ? `<span class="tok-status gekoppeld">Gekoppeld</span>`
      : `<span class="tok-status leeg">Geen link</span>`;
    let onderregel = '';
    if (st.laatsteFout){
      onderregel = `<div class="tok-laatste" style="color:var(--uit)">Laatste sync mislukt: ${esc(st.laatsteFout)}</div>`;
    } else if (st.laatsteSync){
      const aantal = st.laatsteAantal != null ? `${st.laatsteAantal} wedstrijd${st.laatsteAantal===1?'':'en'}` : '';
      onderregel = `<div class="tok-laatste">Laatste sync: <b>${esc(syncTijd(st.laatsteSync))}</b>${aantal?' · '+aantal:''}</div>`;
    }
    return `
      <div class="tok-rij">
        <div class="tok-kop"><span class="tok-team">${esc(t.naam)}</span>${badge}</div>
        <div class="tok-invoer">
          <input type="${st.gekoppeld?'password':'text'}" data-token-team="${t.id}"
                 placeholder="Plak hier de voetbal.nl-link"
                 value="${st.gekoppeld?'••••••••••••••••':''}" autocomplete="off">
          <button data-token-opslaan="${t.id}">Opslaan</button>
        </div>
        ${onderregel}
      </div>`;
  }).join('') : `<p style="font-size:13px;color:var(--ink-2)">Maak eerst teams aan om ze te koppelen.</p>`;

  const voetbalBlok = `
    <div class="sectie-kop">⚽ voetbal.nl-koppeling</div>
    <div class="kaart">
      <p class="uitleg" style="font-size:13px;color:var(--ink-2);line-height:1.5;margin-bottom:6px">Plak per team de kalenderlink uit voetbal.nl. De wedstrijden worden dan automatisch in de app gezet, klaar om opstellingen te maken. De link koop je in de voetbal.nl-app (teamkalender) en ziet eruit als <code style="font-size:11px">data.sportlink.com/ical-team?token=…</code></p>
    </div>
    <div class="waarschuwing" style="background:#fff8e6;border:1px solid #f0d894;border-radius:11px;padding:11px 12px;font-size:12.5px;color:#7a5d00;line-height:1.5;margin-bottom:12px">
      <b>Let op:</b> de kalenderlink is per team persoonlijk en verloopt elk halfseizoen. Vernieuw de link wanneer de sync stopt met werken.
    </div>
    <div class="kaart">${tokenRijen}</div>
    <button class="knop vol" id="syncNu" style="margin-bottom:4px">🔄 Sync nu alle teams</button>
    <p style="font-size:11.5px;color:var(--ink-2);text-align:center;margin:8px 0 4px">De sync draait sowieso elke nacht automatisch.</p>`;

  return `
    <div class="kaart">
      <div class="sectie-kop" style="margin-top:0">📅 Seizoen</div>
      <div style="display:flex;align-items:center;gap:12px">
        <div style="flex:1">
          <div style="font-size:11px;color:var(--ink-2);margin-bottom:2px">Huidig seizoen</div>
          <div class="cond" style="font-weight:700;font-size:22px">${esc(huidigSeizoen)}</div>
        </div>
        <button class="knop fluo" id="btnNieuwSeizoen">Nieuw seizoen starten →</button>
      </div>
      <p style="font-size:12px;color:var(--ink-2);line-height:1.5;margin-top:10px">Nieuwe wedstrijden, trainingen, beoordelingen en teamevaluaties van alle teams tellen vanaf dat moment mee voor het nieuwe seizoen. Oude data blijft bewaard en is terug te zien via het seizoenfilter in de statistieken (⏱).</p>
      <button class="knop licht vol" id="migreerSeizoen" style="margin-top:10px">🗂️ Migreer bestaande data naar dit seizoen</button>
    </div>
    <div class="kaart">
      <div class="sectie-kop" style="margin-top:0">Club-uitnodiging</div>
      <p style="font-size:13.5px;color:var(--ink-2)">Stuur deze link naar mede-admins. Zij worden dan ook beheerder van de club.</p>
      <div class="uitnodig-link" id="clubLink">${esc(location.origin + location.pathname + '?club=' + S.club.code)}</div>
      <button class="knop licht vol" id="kopieerClubLink" style="margin-top:8px">Link kopiëren</button>
    </div>
    <div class="kaart">
      <div class="sectie-kop" style="margin-top:0">Club-admins</div>
      <p style="font-size:14px">${admins || '—'}</p>
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
    <p style="font-size:13px;color:var(--ink-2);margin-bottom:14px">Je huidige seizoen is <b>${esc(huidig)}</b>. Vanaf bevestigen loggen nieuwe wedstrijden, trainingen, beoordelingen en teamevaluaties van alle teams onder het nieuwe seizoen. Oude data blijft gewoon bewaard en is terug te zien via het seizoenfilter in de statistieken.</p>
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
    <p style="font-size:13px;color:var(--ink-2);margin-bottom:14px">Dit last de training af voor <b>alle ${teams.length} teams</b> van de club. Elke trainer kan het bericht daarna doorsturen in zijn eigen WhatsApp-groep.</p>
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
      if (e.target.closest('[data-uitnodig-team]')) return;
      (await teamsModule()).openTeam(b.dataset.openTeam);
    });
    v.querySelectorAll('[data-uitnodig-team]').forEach(b => b.onclick = e => {
      e.stopPropagation();
      const team = teams.find(t => t.id === b.dataset.uitnodigTeam);
      modalUitnodig(team);
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
  if (tab === 'dashboard'){
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
  }
  if (tab === 'instel'){
    const nieuwSeizoenBtn = v.querySelector('#btnNieuwSeizoen');
    if (nieuwSeizoenBtn) nieuwSeizoenBtn.onclick = () => modalNieuwSeizoen();
    const migreerBtn = v.querySelector('#migreerSeizoen');
    if (migreerBtn) migreerBtn.onclick = () => migreerSeizoenData(teams);
    v.querySelector('#kopieerClubLink').onclick = async () => {
      try { await navigator.clipboard.writeText($('#clubLink').textContent); meld('Link gekopieerd'); }
      catch { meld('Link: ' + $('#clubLink').textContent); }
    };
    // voetbal.nl-token per team opslaan
    v.querySelectorAll('[data-token-opslaan]').forEach(b => b.onclick = async () => {
      const teamId = b.dataset.tokenOpslaan;
      const input = v.querySelector(`[data-token-team="${teamId}"]`);
      const ruw = (input.value || '').trim();
      if (!ruw || ruw.startsWith('••••')) return meld('Plak eerst een nieuwe link');
      // herken token of volledige iCal-URL
      const k = herkenKoppeling(ruw);
      if (!k) return meld('Geen geldige link of token herkend');
      b.disabled = true; b.textContent = '...';
      // schrijf het juiste veld weg en wis het andere (voorkomt dat beide blijven staan)
      const data = k.veld === 'icalToken'
        ? { icalToken: k.waarde, icalUrl: deleteField() }
        : { icalUrl: k.waarde, icalToken: deleteField() };
      try {
        await setDoc(doc(db,'clubs',S.clubId,'geheim',teamId), data, { merge: true });
        meld('Koppeling opgeslagen');
        renderClub();
      } catch(e){
        b.disabled = false; b.textContent = 'Opslaan';
        meld('Opslaan mislukt: ' + (e.code || e.message));
      }
    });
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
    <p style="font-size:13.5px;color:var(--ink-2);margin-bottom:12px">Stuur deze persoonlijke link naar de coach. Hij of zij klikt erop, logt in met e-mail of Google en zit direct in dit team.</p>
    <div class="uitnodig-link" id="uitnodigLink">${esc(link)}</div>
    <div class="rij" style="margin-top:12px">
      <button class="knop vol" id="mUitnodigKopieer">Link kopiëren</button>
      <button class="knop fluo vol" id="mUitnodigWa">📲 WhatsApp</button>
    </div>
    <p style="font-size:12px;color:var(--ink-2);margin-top:12px">Of geef de teamcode mondeling door: <b>${esc(team.code)}</b></p>`);
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
    <p style="font-size:13px;color:var(--ink-2);margin-bottom:14px">Per team kun je hier snel de uitnodiging delen. Aantal gekoppelde coaches staat erbij.</p>
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
    <p style="font-size:13px;color:var(--ink-2);margin-bottom:12px">Upload een PDF met de teamindeling. De app leest de teamnamen en spelersnamen uit, daarna kun je alles controleren voordat je de teams aanmaakt.</p>
    <label class="upload-knop" for="mPDFFile">📄 Kies PDF-bestand
      <input type="file" id="mPDFFile" accept="application/pdf" style="display:none"></label>
    <div id="mPDFStatus" style="font-size:13px;color:var(--ink-2);text-align:center"></div>`);
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
    <p style="font-size:13px;color:var(--ink-2)">Vink teams uit die je niet wilt aanmaken, klik op een naam om aan te passen, en let op de <span style="color:var(--uit);font-weight:600">rood gekleurde</span> dubbele voornamen.</p>
    <div id="mPrevSamenvat" style="font-size:12.5px;font-weight:600;color:var(--grass);text-align:center;margin:10px 0"></div>
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
      <div style="font-size:11.5px;font-weight:700;letter-spacing:.5px;text-transform:uppercase;color:var(--ink-2);margin:10px 0 6px">${esc(b.naam)}</div>
      <div class="team-chip-kies">
        ${lijst.map(t => {
          const aan = voorBouw ? b.id === voorBouw : false;
          return `<label data-pid="${t.id}" class="${aan?'aan':''}"><input type="checkbox" data-tid="${t.id}" ${aan?'checked':''}><span>${esc(t.naam)}</span></label>`;
        }).join('')}
      </div>`;
  }).join('');
  openModal(`
    <h2>Training uploaden</h2>
    <p style="font-size:13px;color:var(--ink-2);margin-bottom:12px">Bestand: <b>${esc(file.name)}</b> (${(file.size/1024).toFixed(0)} KB)</p>
    <div class="veldgroep"><label>Titel</label>
      <input class="invoer" id="mTrTitel" value="Week ${weekNr} - training 1" autocomplete="off"></div>
    <div class="veldgroep"><label>Week / periode</label>
      <input class="invoer" id="mTrWeek" value="Week ${weekNr}" autocomplete="off"></div>
    <div class="veldgroep"><label>Voor welke teams?</label>
      <div id="mTrTeams">
        ${teams.length ? groepHtml : '<p style="font-size:13px;color:var(--ink-2)">Maak eerst teams aan in deze club.</p>'}
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
    const knop = $('.upload-knop');
    if (knop){ knop.classList.add('bezig'); knop.textContent = 'Uploaden...'; }
    sluitModal();
    try {
      const ts = Date.now();
      const veiligeNaam = file.name.replace(/[^a-zA-Z0-9._-]/g,'_');
      const path = `clubs/${S.clubId}/trainingen/${ts}_${veiligeNaam}`;
      const r = sRef(storage, path);
      await uploadBytes(r, file, {contentType:'application/pdf'});
      const url = await getDownloadURL(r);
      await addDoc(collection(db,'trainingen'), {
        club: S.clubId, clubNaam: S.club.naam,
        titel, week, bestandsnaam: file.name, path, url,
        teams: gekozen,
        gemaakt: serverTimestamp(),
        door: S.user.displayName || S.user.email || '',
      });
      meld('Training geüpload'); renderClub();
    } catch(e){
      console.error(e); meld('Upload mislukt — staat Firebase Storage aan?');
      if (knop){ knop.classList.remove('bezig'); knop.textContent = '📄 PDF-training toevoegen voor één of meer teams'; }
    }
  };
}

/* Toewijzing (titel, week, teams) van een bestaande training achteraf aanpassen
   — zonder het PDF-bestand opnieuw te uploaden. */
function modalBewerkTraining(t, teams){
  const huidig = new Set(t.teams || []);
  openModal(`
    <h2>Training aanpassen</h2>
    <p style="font-size:13px;color:var(--ink-2);margin-bottom:12px">Bestand: <b>${esc(t.bestandsnaam || t.titel)}</b>${t.url ? ` · <a href="${esc(t.url)}" target="_blank" style="color:var(--grass);font-weight:600">openen ↗</a>` : ''}<br>Het PDF-bestand zelf blijft ongewijzigd.</p>
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
            <div style="font-size:11.5px;font-weight:700;letter-spacing:.5px;text-transform:uppercase;color:var(--ink-2);margin:10px 0 6px">${esc(b.naam)}</div>
            <div class="team-chip-kies">
              ${lijst.map(team => `<label data-pid="${team.id}" class="${huidig.has(team.id)?'aan':''}"><input type="checkbox" data-tid="${team.id}" ${huidig.has(team.id)?'checked':''}><span>${esc(team.naam)}</span></label>`).join('')}
            </div>`;
        }).join('')
        : '<p style="font-size:13px;color:var(--ink-2)">Geen teams in deze club.</p>'}
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
      <div style="font-size:11.5px;font-weight:700;letter-spacing:.5px;text-transform:uppercase;color:var(--ink-2);margin:10px 0 6px">${esc(b.naam)}</div>
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
      <div id="mVdTeams">${teams.length ? teamKeuzePerBouw(teams, voor) : '<p style="font-size:13px;color:var(--ink-2)">Maak eerst teams aan in deze club.</p>'}</div>
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
  openModal(`
    <h2>Video aanpassen</h2>
    <div class="veldgroep"><label>YouTube-link</label>
      <input class="invoer" id="mVbUrl" value="${esc(vid.url || '')}" autocomplete="off"></div>
    <div class="veldgroep"><label>Titel</label>
      <input class="invoer" id="mVbTitel" value="${esc(vid.titel || '')}" autocomplete="off"></div>
    <div class="veldgroep"><label>Voor welke teams?</label>
      <div id="mVbTeams">${teams.length ? teamKeuzePerBouw(teams, huidig) : '<p style="font-size:13px;color:var(--ink-2)">Geen teams in deze club.</p>'}</div>
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
    const url = $('#mVbUrl').value.trim();
    if (!youtubeId(url)) return meld('Plak een geldige YouTube-link');
    const gekozen = $$('#mVbTeams input').filter(c => c.checked).map(c => c.dataset.tid);
    if (!gekozen.length) return meld('Kies minstens één team');
    const titel = $('#mVbTitel').value.trim() || 'Video';
    sluitModal();
    try {
      await updateDoc(doc(db,'videos',vid.id), {url, titel, teams: gekozen});
      meld('Video bijgewerkt'); renderClub();
    } catch(e){
      meld('Opslaan mislukt: ' + (e.code || e.message));
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
    <p style="font-size:13px;color:var(--ink-2);margin-bottom:12px">Bestand: <b>${esc(file.name)}</b> (${(file.size/1024).toFixed(0)} KB)</p>
    <div class="veldgroep"><label>Titel</label>
      <input class="invoer" id="mDoTitel" value="${esc(file.name.replace(/\.pdf$/i,''))}" autocomplete="off"></div>
    <div class="veldgroep"><label>Categorie</label>
      <select class="invoer" id="mDoCategorie">
        ${DOC_CATEGORIEN.map(c => `<option value="${c.id}" ${voorCategorie===c.id?'selected':''}>${c.naam}</option>`).join('')}
      </select></div>
    <div class="veldgroep"><label>Voor welke teams?</label>
      <div id="mDoTeams">${teams.length ? teamKeuzePerBouw(teams, new Set()) : '<p style="font-size:13px;color:var(--ink-2)">Maak eerst teams aan in deze club.</p>'}</div>
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
    <p style="font-size:13px;color:var(--ink-2);margin-bottom:12px">Bestand: <b>${esc(d.bestandsnaam || d.titel)}</b>${d.url ? ` · <a href="${esc(d.url)}" target="_blank" style="color:var(--grass);font-weight:600">openen ↗</a>` : ''}<br>Het PDF-bestand zelf blijft ongewijzigd.</p>
    <div class="veldgroep"><label>Titel</label>
      <input class="invoer" id="mDbTitel" value="${esc(d.titel || '')}" autocomplete="off"></div>
    <div class="veldgroep"><label>Categorie</label>
      <select class="invoer" id="mDbCategorie">
        ${DOC_CATEGORIEN.map(c => `<option value="${c.id}" ${d.categorie===c.id?'selected':''}>${c.naam}</option>`).join('')}
      </select></div>
    <div class="veldgroep"><label>Voor welke teams?</label>
      <div id="mDbTeams">${teams.length ? teamKeuzePerBouw(teams, huidig) : '<p style="font-size:13px;color:var(--ink-2)">Geen teams in deze club.</p>'}</div>
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
