/* ==================== NU-TESTAPP ====================
   Standalone testpagina voor het "Nu-scherm". Gebruikt de echte styles.css,
   icons.js en hub-opzet van Cluppie, maar draait op nepdata en een simuleerbare
   klok/locatie, dus zonder Firebase of login. Logica: js/nu-context.js. */
import { ico } from './icons.js?v=20260922c';
import { bepaalNu, afstandMeter, VENSTER } from './nu-context.js?v=20261105a';

/* ---------- Instellingen (pas aan voor echte GPS-test) ---------- */
const CLUB = { lat: 51.5006, lng: 5.7177, straal: 300 };   // ASV'33 sportpark — controleer de coördinaten voor echt gebruik

/* ---------- Helpers ---------- */
const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const p2 = n => String(n).padStart(2, '0');
const isoDatum = d => `${d.getFullYear()}-${p2(d.getMonth()+1)}-${p2(d.getDate())}`;
const hhmm = d => `${p2(d.getHours())}:${p2(d.getMinutes())}`;
const DAG_LANG = ['zondag','maandag','dinsdag','woensdag','donderdag','vrijdag','zaterdag'];
const DAG_KORT = ['zo','ma','di','wo','do','vr','za'];
const hoofd = s => s.charAt(0).toUpperCase() + s.slice(1);

function over(min){
  if (min <= 0) return 'nu';
  if (min < 60) return `over ${min} min`;
  const u = Math.floor(min / 60), m = min % 60;
  return m ? `over ${u} u ${m} min` : `over ${u} uur`;
}
function dagLabel(datum, nu){
  const d = new Date(datum + 'T12:00:00'), v = isoDatum(nu);
  const m = new Date(nu.getFullYear(), nu.getMonth(), nu.getDate() + 1, 12);
  if (datum === v) return 'Vandaag';
  if (datum === isoDatum(m)) return 'Morgen';
  return hoofd(DAG_KORT[d.getDay()]) + ' ' + d.getDate() + '/' + (d.getMonth() + 1);
}

/* ---------- Nepdata, relatief aan de huidige week ---------- */
function ankerMaandag(){
  const n = new Date(); n.setHours(12, 0, 0, 0);
  const wd = (n.getDay() + 6) % 7;                       // ma=0
  n.setDate(n.getDate() - wd + (wd === 6 ? 7 : 0));      // zondag → volgende week
  return n;
}
const MA = ankerMaandag();
const dagVan = (plus, u = 12, m = 0) => new Date(MA.getFullYear(), MA.getMonth(), MA.getDate() + plus, u, m);

const TEAM = { naam: 'JO12-1', categorie: 'O12', format: '8',
  trainingsmomenten: [{ dag: 2, start: '18:30', eind: '19:45' }, { dag: 4, start: '18:30', eind: '19:45' }] };

const state = {
  sim: null,                // Date of null = echte tijd
  plek: 'onbekend',         // 'club' | 'elders' | 'onbekend'
  gps: false, gpsMeter: null, gpsFout: '',
  opstellingGedeeld: false,
  zaThuis: false,
  thema: 'donker',
};

function wedstrijden(){
  const za = isoDatum(dagVan(5)), zaVolgend = isoDatum(dagVan(12)), zaVorig = isoDatum(dagVan(-2));
  return [
    { id: 'w0', datum: zaVorig, aftrap: '10:00', tegenstander: 'Rood-Wit ’88', thuis: true, afgerond: true, uitslag: '3 – 1' },
    { id: 'w1', datum: za, aftrap: '09:30', tegenstander: 'Boerdonk JO12-2', thuis: state.zaThuis,
      locatie: state.zaThuis ? 'Sportpark ASV’33, veld 1' : 'Sportpark De Eik, Boerdonk', adres: state.zaThuis ? 'Sportlaan 1, Aarle-Rixtel' : 'De Eik 3, Boerdonk',
      reistijd: 22, kleedkamer: state.zaThuis ? 'Kleedkamer 2' : null,
      opstellingGedeeld: state.opstellingGedeeld, formatie: '3-3-1', beschikbaar: { ja: 11, totaal: 12 } },
    { id: 'w2', datum: zaVolgend, aftrap: '10:00', tegenstander: 'Gemert JO12-1', thuis: true,
      locatie: 'Sportpark ASV’33, veld 1', opstellingGedeeld: false, formatie: '3-3-1', beschikbaar: { ja: 0, totaal: 12 } },
  ];
}
const PRESENTIE = { };

/* ---------- Tijd en locatie ---------- */
const nuTijd = () => state.sim ? new Date(state.sim) : new Date();

function huidigePlek(){
  if (state.gps) return state.gpsMeter == null ? 'onbekend' : (state.gpsMeter <= CLUB.straal ? 'club' : 'elders');
  return state.plek;
}

/* ---------- Opbouw Nu-kaart ---------- */
function rij(l, w){ return `<div class="nu-rij"><span>${esc(l)}</span><span>${w}</span></div>`; }
function tag(t, soort){ return `<span class="nu-tag nu-tag-${soort}">${esc(t)}</span>`; }
function knop(tekst, icoon, doel, primair){
  return `<button class="knop vol ${primair ? 'fluo' : 'licht'} nu-knop" data-doel="${doel}">${icoon ? ico(icoon, 20) : ''}${esc(tekst)}</button>`;
}

function kaartHtml(c, nu){
  const e = c.event, w = e?.w;
  const tot = e ? Math.round((e.start - nu) / 60000) : 0;
  const pl = c.opLocatie ? `<div class="nu-plek">${ico('match-location', 14)} Je bent bij de club</div>` : '';
  const pres = e && e.type === 'training' ? (PRESENTIE[e.datum] || { ja: 10, totaal: 12 }) : null;

  if (c.soort === 'live'){
    const sec = Math.max(0, Math.round((nu - e.start) / 1000));
    const mm = p2(Math.floor(sec / 60)), ss = p2(sec % 60);
    const helft = sec < 35 * 60 ? '1e helft' : '2e helft';
    const thuis = w.thuis, voor = 1, tegen = 0;
    const links = thuis ? 'ASV’33' : w.tegenstander, rechts = thuis ? w.tegenstander : 'ASV’33';
    return `${tag('Live', 'live')}
      <div class="nu-klok"><div class="nu-klok-sub">${helft}</div><div class="nu-klok-tijd cond">${mm}:${ss}</div>
        <div class="nu-stand">${esc(links)} ${thuis ? voor : tegen} – ${thuis ? tegen : voor} ${esc(rechts)}</div></div>
      ${rij('Volgende wissel', 'over 2:30')}${rij('Minste speeltijd', 'Lars · 8 min')}
      ${knop('Wissel doorvoeren', 'football-substitution', 'wedstrijden', true)}${knop('Doelpunt registreren', 'football-goal', 'wedstrijden')}`;
  }

  if (c.soort === 'na'){
    return `${tag('Wedstrijd afgelopen', 'ok')}
      <div class="nu-titel">Eindstand 3 – 1</div><div class="nu-sub">${esc(w.thuis ? 'ASV’33' : w.tegenstander)} – ${esc(w.thuis ? w.tegenstander : 'ASV’33')}</div>
      ${rij('Uitslag', 'Opgeslagen')}${rij('Speeltijd', 'Gelijk verdeeld')}${rij('Speler van de dag', 'Nog kiezen')}
      ${knop('Evaluatie invullen', 'attendance-evaluatie', 'evaluatie', true)}${knop('Verslag delen met ouders', 'communication-group-message', 'berichten')}`;
  }

  if (c.soort === 'wedstrijd'){
    const vertrek = new Date(e.start.getTime() - (w.reistijd ? (w.reistijd + 40) : 60) * 60000);
    const hoofdKnop = c.fase === 'opclub'
      ? knop('Start wedstrijdmodus', 'training-start', 'wedstrijden', true)
      : (w.thuis ? knop('Opstelling bekijken', 'football-lineup', 'wedstrijden', true) : knop('Route openen', 'match-location', 'wedstrijden', true));
    const tweede = c.fase === 'opclub' || !w.thuis ? knop('Opstelling bekijken', 'football-lineup', 'wedstrijden') : knop('Aanwezigheid bekijken', 'attendance-present', 'preswedstrijd');
    return `${pl}${tag(c.fase === 'verzamelen' ? 'Verzamelen' : 'Wedstrijddag', c.fase === 'opclub' ? 'accent' : 'warn')}
      <div class="nu-titel">${esc(w.tegenstander)}</div>
      <div class="nu-sub">Aanvang ${esc(w.aftrap)} · ${w.thuis ? 'thuis' : 'uit'} · ${esc(over(tot))}</div>
      ${w.thuis ? '' : rij('Vertrek', `<b>${hhmm(vertrek)}</b> · ${w.reistijd} min reizen`)}
      ${rij('Locatie', esc(w.locatie))}${w.kleedkamer ? rij('Kleedkamer', esc(w.kleedkamer)) : ''}
      ${rij('Opstelling', w.opstellingGedeeld ? `${esc(w.formatie)} · gedeeld` : '<span class="nu-let">Nog niet gedeeld</span>')}
      ${rij('Beschikbaar', `${w.beschikbaar.ja} van ${w.beschikbaar.totaal}`)}
      ${hoofdKnop}${tweede}`;
  }

  if (c.soort === 'dagervoor'){
    return `${tag('Morgen wedstrijd', 'warn')}
      <div class="nu-titel">${esc(w.tegenstander)}</div>
      <div class="nu-sub">${esc(dagLabel(e.datum, nu))} ${esc(w.aftrap)} · ${w.thuis ? 'thuis' : 'uit'}</div>
      ${rij('Beschikbaar', `${w.beschikbaar.ja} van ${w.beschikbaar.totaal}`)}
      ${rij('Opstelling', w.opstellingGedeeld ? `${esc(w.formatie)} · gedeeld` : '<span class="nu-let">Nog niet gedeeld</span>')}
      ${w.thuis ? '' : rij('Vertrek', `${hhmm(new Date(e.start.getTime() - (w.reistijd + 40) * 60000))}`)}
      ${knop(w.opstellingGedeeld ? 'Opstelling bekijken' : 'Opstelling maken', 'football-lineup', 'wedstrijden', true)}
      ${knop('Beschikbaarheid bekijken', 'attendance-present', 'preswedstrijd')}`;
  }

  if (c.soort === 'training'){
    const t = `${hhmm(e.start)}–${hhmm(e.eind)}`;
    if (c.fase === 'na') return `${tag('Training afgelopen', 'ok')}
      <div class="nu-titel">Presentie afronden</div><div class="nu-sub">Training van ${t}</div>
      ${rij('Aanwezig', `${pres.ja} van ${pres.totaal}`)}${rij('Presentie', '<span class="nu-let">Nog niet afgerond</span>')}
      ${knop('Presentie afronden', 'attendance-fill', 'presentietraining', true)}${knop('Notitie voor volgende keer', 'communication-message', 'trainingen')}`;
    const sub = c.fase === 'bezig' ? 'Bezig nu' : esc(over(tot));
    const hoofdKnop = (c.fase === 'opclub' || c.fase === 'bezig')
      ? knop(c.fase === 'bezig' ? 'Open trainingsplan' : 'Start training', 'training-start', 'trainingen', true)
      : knop('Bekijk trainingsplan', 'training-plan', 'trainingen', true);
    return `${pl}${tag(c.fase === 'bezig' ? 'Training bezig' : 'Trainingsdag', c.fase === 'opclub' || c.fase === 'bezig' ? 'accent' : 'warn')}
      <div class="nu-titel">Training ${esc(hhmm(e.start))}</div>
      <div class="nu-sub">${t} · ${sub}</div>
      ${rij('Thema', 'Positiespel 4 tegen 2')}${rij('Aanwezig', `${pres.ja} van ${pres.totaal}`)}${rij('Afwezig', 'Daan, Sem')}
      ${hoofdKnop}${knop('Aanwezigheid afvinken', 'attendance-fill', 'presentietraining')}`;
  }

  /* rust */
  if (!e) return `${tag('Rustig', 'ok')}<div class="nu-titel">Niets gepland</div><div class="nu-sub">Stel trainingsdagen in bij Instellingen.</div>${knop('Planning openen', 'planning-calendar', 'planning')}`;
  const soortNaam = e.type === 'training' ? 'Training' : 'Wedstrijd';
  return `${tag('Geen activiteit nu', 'ok')}
    <div class="nu-titel">Volgende: ${esc(soortNaam.toLowerCase())}</div>
    <div class="nu-sub">${esc(dagLabel(e.datum, nu))} ${esc(hhmm(e.start))}${w ? ' · ' + esc(w.tegenstander) : ''}</div>
    ${w ? rij('Beschikbaar', `${w.beschikbaar.ja} van ${w.beschikbaar.totaal}`) : rij('Thema', 'Positiespel 4 tegen 2')}
    ${knop(w ? 'Wedstrijd voorbereiden' : 'Trainingsplan voorbereiden', w ? 'football-lineup' : 'training-plan', w ? 'wedstrijden' : 'trainingen', true)}
    ${knop('Planning openen', 'planning-calendar', 'planning')}`;
}

function daarnaHtml(c, nu){
  if (!c.daarna.length) return '';
  return `<div class="nu-daarna-kop">Daarna</div><div class="nu-daarna">` + c.daarna.map(e => `
    <div class="nu-rij nu-rij-d"><span>${esc(dagLabel(e.datum, nu))}</span>
    <span>${e.type === 'training' ? 'Training' : 'Wedstrijd' + (e.w ? ' ' + esc(e.w.tegenstander) : '')} · ${esc(hhmm(e.start))}</span></div>`).join('') + `</div>`;
}

/* ---------- Hub (uit de echte opzet, statisch) ---------- */
function tegel(tab, naam, icoon){ return `<button class="hub-tegel" data-hub-open="${tab}">${ico(icoon, 40)}<span class="hub-tnaam">${esc(naam)}</span></button>`; }
function hubHtml(){
  const secties = [
    ['Oefenstof', [tegel('trainingen','Oefenstof','training-cones'), tegel('tactiek','Tactiek','football-tactics'), tegel('videos','Video’s','training-video')]],
    ['Presentie', [tegel('presentietraining','Training','training-cones'), tegel('preswedstrijd','Wedstrijd','football-whistle'), tegel('stats','Stats','stats-bars')]],
    ['Wedstrijden', [tegel('wedstrijden','Wedstrijden','football-lineup'), tegel('evaluatie','Evaluatie','attendance-evaluatie'), tegel('poule','Poule','football-competition')]],
    ['Meer', [tegel('planning','Planning','planning-calendar'), tegel('documenten','Documenten','admin-document'), tegel('berichten','Berichten','communication-announcement')]],
  ];
  return secties.map(([k, t]) => `<section class="hub-sectie"><div class="hub-sectie-kop">${esc(k)}</div><div class="hub-grid">${t.join('')}</div></section>`).join('');
}

/* ---------- Render ---------- */
function render(){
  const nu = nuTijd();
  const c = bepaalNu({ nu, team: TEAM, wedstrijden: wedstrijden(), presentie: PRESENTIE, plek: huidigePlek() });
  const d = nu;
  $('#nuDatum').textContent = hoofd(DAG_LANG[d.getDay()]) + ' ' + d.getDate() + ' ' + d.toLocaleDateString('nl-NL', { month: 'long' });
  $('#nuKaart').className = 'nu-kaart nu-s-' + c.soort + (c.opLocatie ? ' nu-opclub' : '');
  $('#nuKaart').innerHTML = kaartHtml(c, nu);
  $('#nuDaarna').innerHTML = daarnaHtml(c, nu);
  $('#nuWaarom').innerHTML = `${ico('tag-insight', 14)}<span>${esc(c.reden)}</span>`;
  $('#nuHub').innerHTML = hubHtml();
  $('#nuDebug').textContent = `soort=${c.soort} · fase=${c.fase} · plek=${huidigePlek()}`;
  $('#nuKlokTekst').textContent = `${hoofd(DAG_KORT[d.getDay()])} ${hhmm(d)}${state.sim ? ' (simulatie)' : ' (echt)'}`;
  document.documentElement.setAttribute('data-thema', state.thema);
  document.querySelectorAll('[data-plek]').forEach(b => b.classList.toggle('actief', !state.gps && b.dataset.plek === state.plek));
  $('#nuGps').classList.toggle('actief', state.gps);
  $('#nuGpsTekst').textContent = state.gps ? (state.gpsFout || (state.gpsMeter == null ? 'zoeken…' : `${state.gpsMeter} m van de club`)) : 'uit';
  $('#nuOpstelling').classList.toggle('actief', state.opstellingGedeeld);
  $('#nuThuisUit').textContent = state.zaThuis ? 'Zaterdag: thuis' : 'Zaterdag: uit';
  const lokaal = `${d.getFullYear()}-${p2(d.getMonth()+1)}-${p2(d.getDate())}T${hhmm(d)}`;
  if ($('#nuTijdInvoer') !== document.activeElement) $('#nuTijdInvoer').value = lokaal;
}

/* ---------- Testbediening ---------- */
const PRESETS = [
  ['Wo 12:00 · rust',        () => dagVan(2, 12, 0), 'onbekend'],
  ['Di 16:10 · training',    () => dagVan(1, 16, 10), 'elders'],
  ['Di 18:20 · op club',     () => dagVan(1, 18, 20), 'club'],
  ['Di 19:00 · bezig',       () => dagVan(1, 19, 0), 'club'],
  ['Di 20:05 · afgelopen',   () => dagVan(1, 20, 5), 'elders'],
  ['Vr 19:00 · dag ervoor',  () => dagVan(4, 19, 0), 'elders'],
  ['Za 08:15 · wedstrijddag',() => dagVan(5, 8, 15), 'elders'],
  ['Za 09:00 · op club',     () => dagVan(5, 9, 0), 'club'],
  ['Za 09:52 · live',        () => dagVan(5, 9, 52), 'club'],
  ['Za 11:05 · na afloop',   () => dagVan(5, 11, 5), 'elders'],
];

function toast(t){
  const el = $('#nuToast'); el.textContent = t; el.classList.add('zichtbaar');
  clearTimeout(toast._t); toast._t = setTimeout(() => el.classList.remove('zichtbaar'), 2600);
}

let watchId = null;
function gpsAan(){
  if (!navigator.geolocation){ state.gpsFout = 'geen GPS in deze browser'; render(); return; }
  state.gps = true; state.gpsMeter = null; state.gpsFout = ''; render();
  watchId = navigator.geolocation.watchPosition(
    pos => { state.gpsMeter = afstandMeter({ lat: pos.coords.latitude, lng: pos.coords.longitude }, CLUB); state.gpsFout = ''; render(); },
    err => { state.gpsFout = err.code === 1 ? 'toegang geweigerd' : 'locatie niet beschikbaar'; state.gpsMeter = null; render(); },
    { enableHighAccuracy: false, maximumAge: 30000, timeout: 15000 });
}
function gpsUit(){
  if (watchId != null) navigator.geolocation.clearWatch(watchId);
  watchId = null; state.gps = false; state.gpsMeter = null; state.gpsFout = ''; render();
}

function init(){
  $('#nuPresets').innerHTML = PRESETS.map((p, i) => `<button class="nu-chip" data-preset="${i}">${esc(p[0])}</button>`).join('');
  $('#nuPresets').addEventListener('click', ev => {
    const b = ev.target.closest('[data-preset]'); if (!b) return;
    const p = PRESETS[+b.dataset.preset];
    state.sim = p[1](); if (state.gps) gpsUit(); state.plek = p[2]; render();
  });
  document.querySelectorAll('[data-plek]').forEach(b => b.addEventListener('click', () => { if (state.gps) gpsUit(); state.plek = b.dataset.plek; render(); }));
  $('#nuGps').addEventListener('click', () => state.gps ? gpsUit() : gpsAan());
  $('#nuEcht').addEventListener('click', () => { state.sim = null; render(); });
  $('#nuTijdInvoer').addEventListener('change', e => { const v = e.target.value; if (v){ const [dd, tt] = v.split('T'); const [j, m, da] = dd.split('-').map(Number); const [u, mi] = tt.split(':').map(Number); state.sim = new Date(j, m - 1, da, u, mi); render(); } });
  $('#nuOpstelling').addEventListener('click', () => { state.opstellingGedeeld = !state.opstellingGedeeld; render(); });
  $('#nuThuisUit').addEventListener('click', () => { state.zaThuis = !state.zaThuis; render(); });
  $('#nuThema').addEventListener('click', () => { state.thema = state.thema === 'donker' ? 'licht' : 'donker'; render(); });
  document.addEventListener('click', ev => {
    const k = ev.target.closest('[data-doel]');
    if (k){ const doel = k.dataset.doel; toast('Opent: ' + doel + ' (testapp)'); const t = document.querySelector(`.hub-tegel[data-hub-open="${doel}"]`); if (t){ t.classList.add('nu-flits'); setTimeout(() => t.classList.remove('nu-flits'), 1400); t.scrollIntoView({ block: 'center', behavior: 'smooth' }); } return; }
    const h = ev.target.closest('.hub-tegel'); if (h) toast('Opent: ' + h.dataset.hubOpen + ' (testapp)');
  });
  setInterval(() => { if (!state.sim) render(); }, 20000);
  render();
}
init();
export { VENSTER };
