/* ==================== WEDSTRIJDVOORBEREIDING ====================
   Schermvullend venster (openModal, vorm 'scherm') vanuit het Nu-blok op de
   team-hub. Drie tabs, conform de goedgekeurde mockup (6 nov):
     • Tegenstander  stand in de poule, vorm (laatste 5), doelpunten voor/tegen,
                     vorige ontmoeting (met wedstrijddoel, notitie en de notitie
                     "na afloop" van toen)
     • Praktisch     weer rond de aanvang (Open-Meteo), plek met route, veld,
                     kleedkamer, en delen in de groepsapp
     • Plan          beschikbaarheid, wedstrijddoel, aandachtspunten, opstelling
                     en een notitie na afloop

   Bronnen (lezen): S.wedstrijden, S.spelers, S.pouleStand, S.pouleUitslagen,
   S.pouleProgramma (Sportlink-sync), S.team.
   Opslag (schrijven, altijd merge):
     teams/{teamId}/wedstrijden/{wid}.voorbereiding = { punten:[string], naAfloop:string }
     teams/{teamId}.weerPlaats   (alleen als de thuisplaats nergens uit af te leiden is)

   AVG: naar de weerdienst gaat alleen een plaatsnaam en coördinaten, geen
   spelers- of teamgegevens. Spelersnamen staan alleen op het scherm van de
   coach en nooit in de deeltekst. */
import { db, doc, setDoc, updateDoc, functions, httpsCallable } from './firebase.js?v=20261106r';
import { S, esc, meld, openModal, sluitModal } from './state.js?v=20261107e';
import { ico } from './icons.js?v=20261106r';
import { telGebruik, telNav } from './tracker.js?v=20261107e';
import { plekHtml, routeUrl, presentieWedstrijd, afwezigTekst, opstellingKlaar } from './nu-scherm.js?v=20261111e';

const p2 = n => String(n).padStart(2, '0');
const isoVan = d => `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`;
const DAG_LANG = ['zondag', 'maandag', 'dinsdag', 'woensdag', 'donderdag', 'vrijdag', 'zaterdag'];
const MAAND = ['januari', 'februari', 'maart', 'april', 'mei', 'juni', 'juli', 'augustus', 'september', 'oktober', 'november', 'december'];
const hoofd = s => s.charAt(0).toUpperCase() + s.slice(1);
function datumLang(datum){
  const d = new Date(datum + 'T12:00');
  return `${DAG_LANG[d.getDay()]} ${d.getDate()} ${MAAND[d.getMonth()]}`;
}
function dagenTot(datum){
  const nu = new Date(), vandaag = new Date(nu.getFullYear(), nu.getMonth(), nu.getDate(), 12);
  return Math.round((new Date(datum + 'T12:00') - vandaag) / 86400000);
}
function wanneer(datum){
  const n = dagenTot(datum);
  return n === 0 ? 'Vandaag' : n === 1 ? 'Morgen' : n > 1 ? `Over ${n} dagen` : 'Gespeeld';
}

/* ---------- tegenstander herkennen in Sportlink-regels ----------
   Sportlink schrijft "Bavos JO12-3", de app soms "Bavos O12-3". Vergelijken op
   alleen letters/cijfers, met JO/MO gelijkgetrokken. */
const norm = s => String(s || '').toLowerCase().replace(/[jm]o(?=\d)/g, 'o').replace(/[^a-z0-9]+/g, '');
function zelfdeTeam(a, b){
  const x = norm(a), y = norm(b);
  if (!x || !y) return false;
  if (x === y) return true;
  return x.length > 5 && y.length > 5 && (x.endsWith(y) || y.endsWith(x));
}

/* Alle gespeelde poule-wedstrijden (uitslagen + programma), ontdubbeld. */
function pouleGespeeld(){
  const rijen = [...(S.pouleUitslagen?.rijen || []), ...(S.pouleProgramma?.rijen || [])];
  const gezien = new Map();
  for (const r of rijen){
    if (!r || !r.uitslag || !r.datum) continue;
    /* Sportlink schrijft de score met wisselende streepjes (-, – of −) en soms
       spaties; daarom op de twee getallen matchen in plaats van op één teken. */
    const m = String(r.uitslag).match(/(\d+)\D+?(\d+)/);
    const [a, b] = m ? [+m[1], +m[2]] : [NaN, NaN];
    if (!Number.isFinite(a) || !Number.isFinite(b)) continue;
    const k = `${r.datum}|${norm(r.thuis)}|${norm(r.uit)}`;
    if (!gezien.has(k)) gezien.set(k, { datum: r.datum, thuis: r.thuis, uit: r.uit, a, b });
  }
  return [...gezien.values()].sort((x, y) => x.datum.localeCompare(y.datum));
}
/* Resultaten vanuit het perspectief van één team. */
function resultatenVan(naam){
  return pouleGespeeld().map(r => {
    const thuis = zelfdeTeam(r.thuis, naam), uit = !thuis && zelfdeTeam(r.uit, naam);
    if (!thuis && !uit) return null;
    const voor = thuis ? r.a : r.b, tegen = thuis ? r.b : r.a;
    return { datum: r.datum, tegen: thuis ? r.uit : r.thuis, voor, tegenGoals: tegen, res: voor > tegen ? 'W' : voor < tegen ? 'V' : 'G' };
  }).filter(Boolean);
}

/* ---------- vorige ontmoeting (uit de app zelf) ---------- */
function isGespeeld(w){
  if (Array.isArray(w.goals) && w.goals.length) return true;
  for (const k of Object.values(w.kwarten || {})) if (Object.keys(k.lineup || {}).length) return true;
  return false;
}
function vorigeOntmoeting(w){
  return (S.wedstrijden || [])
    .filter(v => v.id !== w.id && v.type !== 'toernooi' && (v.datum || '') < (w.datum || '9999') && zelfdeTeam(v.tegenstander, w.tegenstander) && isGespeeld(v))
    .sort((a, b) => (b.datum || '').localeCompare(a.datum || ''))[0] || null;
}

/* ---------- bouwstenen (zelfde klassen als het Nu-blok) ---------- */
const rij = (l, w) => `<div class="nu-rij"><dt>${esc(l)}</dt><dd>${w}</dd></div>`;
const feiten = (...r) => { const h = r.filter(Boolean).join(''); return h ? `<dl class="nu-feiten">${h}</dl>` : ''; };
const kaart = (kop, inhoud) => `<section class="nu-kaart vb-kaart"><h3 class="vb-kop">${esc(kop)}</h3>${inhoud}</section>`;
const leeg = t => `<p class="vb-leeg">${t}</p>`;
const knop = (tekst, icoon, attr) =>
  `<button type="button" class="knop vol licht" ${attr}>${icoon ? ico(icoon, 20) : ''}${esc(tekst)}</button>`;
const RES_LABEL = { W: 'winst', G: 'gelijk', V: 'verlies' };

/* ==================== TAB: TEGENSTANDER ==================== */
function tabTegenstander(w){
  const stand = S.pouleStand?.rijen || [];
  const hun = stand.find(r => zelfdeTeam(r.team, w.tegenstander));
  const eigen = stand.find(r => r.eigen);
  const standHtml = hun
    ? `<div class="vb-stand" role="table" aria-label="Stand van ${esc(w.tegenstander)}">
        <div role="row" class="vb-stand-kop"><span role="columnheader">Pos</span><span role="columnheader">G</span><span role="columnheader">W</span><span role="columnheader">GL</span><span role="columnheader">V</span><span role="columnheader">Ptn</span></div>
        <div role="row" class="vb-stand-rij"><b role="cell">${esc(hun.positie ?? '')}</b><b role="cell">${hun.gespeeld || 0}</b><b role="cell">${hun.gewonnen || 0}</b><b role="cell">${hun.gelijk || 0}</b><b role="cell">${hun.verloren || 0}</b><b role="cell">${hun.punten || 0}</b></div>
      </div>
      ${feiten(rij('Doelsaldo', `<span class="${hun.saldo > 0 ? 'vb-ok' : hun.saldo < 0 ? 'vb-bad' : ''}">${hun.saldo > 0 ? '+' : ''}${hun.saldo || 0}</span>`),
        eigen ? rij(S.team?.naam || 'Wij', `${esc(eigen.positie ?? '')}e met ${eigen.punten || 0} punten`) : '')}
      <div class="nu-acties">${knop('Hele stand', 'stats-bars', 'data-vb-tab-team="poule"')}</div>`
    : leeg(stand.length ? `${esc(w.tegenstander)} staat niet in jullie poulestand. Dit is waarschijnlijk een beker- of oefenwedstrijd.` : 'Nog geen poulestand. Die verschijnt na de nachtelijke Sportlink-sync.');

  const res = resultatenVan(w.tegenstander);
  const laatste = res.slice(-5);
  const gem = (k) => res.length ? (res.reduce((s, r) => s + r[k], 0) / res.length).toFixed(1).replace('.', ',') : '0';
  const maxGem = Math.max(1, ...res.map(r => Math.max(r.voor, r.tegenGoals)));
  const balk = (label, waarde) => {
    const pct = Math.min(100, Math.round(parseFloat(waarde.replace(',', '.')) / maxGem * 100));
    return `<div class="vb-balk"><span class="vb-balk-l">${label}</span><span class="vb-balk-spoor"><span style="width:${pct}%"></span></span><span class="vb-balk-w">${waarde} per wedstrijd</span></div>`;
  };
  const vormHtml = laatste.length
    ? `<ol class="vb-vorm" aria-label="Laatste ${laatste.length} uitslagen, oud naar nieuw">${laatste.map(r =>
        `<li class="vb-res vb-res-${r.res}" title="${esc(r.datum)}: ${r.voor}-${r.tegenGoals} tegen ${esc(r.tegen)}"><span aria-hidden="true">${r.res}</span><span class="visually-hidden">${RES_LABEL[r.res]} ${r.voor}-${r.tegenGoals} tegen ${esc(r.tegen)}</span></li>`).join('')}</ol>
      <ul class="vb-uitslagen">${laatste.slice().reverse().map(r => `<li><span>${esc(r.tegen)}</span><b>${r.voor}-${r.tegenGoals}</b></li>`).join('')}</ul>
      ${balk('Gescoord', gem('voor'))}${balk('Tegen', gem('tegenGoals'))}
      <p class="vb-bron">Over ${res.length} gespeelde poulewedstrijd${res.length === 1 ? '' : 'en'}.</p>`
    : leeg('Nog geen uitslagen van deze tegenstander in jullie poule.');

  const v = vorigeOntmoeting(w);
  let vorigeHtml;
  if (v){
    const goals = Array.isArray(v.goals) ? v.goals : [];
    const voor = goals.filter(g => g && g.type !== 'tegen').length, tegen = goals.filter(g => g && g.type === 'tegen').length;
    const uitslag = !goals.length ? null : voor > tegen ? ['Winst', 'ok'] : voor < tegen ? ['Verlies', 'warn'] : ['Gelijk', 'accent'];
    const scorers = goals.filter(g => g && g.type !== 'tegen' && g.pid).reduce((m, g) => m.set(g.pid, (m.get(g.pid) || 0) + 1), new Map());
    const namen = [...scorers].map(([pid, n]) => { const p = S.spelers.find(x => x.id === pid); return p ? `${esc(p.naam.split(' ')[0])}${n > 1 ? ' ' + n : ''}` : null; }).filter(Boolean);
    vorigeHtml = `<div class="vb-vorige">
        <div><b>${esc(hoofd(datumLang(v.datum)))}</b><span class="vb-zacht">${v.thuis ? 'Thuis' : 'Uit'}</span></div>
        ${goals.length ? `<span class="vb-score">${voor}-${tegen}</span>` : ''}
        ${uitslag ? `<span class="nu-tag nu-tag-${uitslag[1]}">${uitslag[0]}</span>` : ''}
      </div>
      ${feiten(namen.length ? rij('Doelpunten', namen.join(', ')) : '',
        v.doel ? rij('Wedstrijddoel', esc(v.doel)) : '',
        v.notitie ? rij('Notitie', esc(v.notitie)) : '',
        v.voorbereiding?.naAfloop ? rij('Na afloop', esc(v.voorbereiding.naAfloop)) : '')}
      <div class="nu-acties">${knop('Bekijk deze wedstrijd', 'football-match', `data-vb-wedstrijd="${esc(v.id)}"`)}</div>`;
  } else {
    vorigeHtml = leeg('Nog niet eerder tegen deze tegenstander gespeeld in Cluppie.');
  }

  const bron = S.pouleStand?.bijgewerkt || S.pouleProgramma?.bijgewerkt;
  /* [20261107d] Teams zonder Scouting-tab krijgen hier de volledige Sportlink-
     analyse (zonder AI), opgehaald via de functie scoutTegenstander. */
  const slAnalyse = isEersteElftal(S.team) ? '' : sportlinkAnalyseHtml(w);
  return `${slAnalyse}${kaart('Stand in de poule', standHtml)}
    ${kaart('Vorm, laatste 5 (oud naar nieuw)', vormHtml)}
    ${kaart('Vorige ontmoeting', vorigeHtml)}
    <p class="vb-bron">${ico('action-info', 16)}Stand en uitslagen uit Sportlink${bron ? '' : ', ververst met de nachtelijke sync'}.</p>`;
}

/* ==================== WEER (Open-Meteo, geen sleutel nodig) ==================== */
const WMO = [[0, 'Helder'], [1, 'Overwegend helder'], [2, 'Half bewolkt'], [3, 'Bewolkt'], [48, 'Mist'], [57, 'Motregen'], [63, 'Regen'], [67, 'Zware regen'], [77, 'Sneeuw'], [82, 'Buien'], [86, 'Sneeuwbuien'], [99, 'Onweer']];
const weerTekst = c => (WMO.find(([max]) => c <= max) || [0, 'Onbekend'])[1];
const BFT = [1, 6, 12, 20, 29, 39, 50, 62, 75, 89, 103, 118];
const bft = kmh => { const i = BFT.findIndex(g => kmh < g); return i < 0 ? 12 : i; };
const RICHTING = ['N', 'NO', 'O', 'ZO', 'Z', 'ZW', 'W', 'NW'];
const richting = gr => RICHTING[Math.round(((gr % 360) + 360) % 360 / 45) % 8];

/* Thuis: plaats uit Sportlink (w.plaats), anders de meest voorkomende plaats van
   eerdere thuiswedstrijden, anders wat de coach eenmalig invulde (team.weerPlaats).
   Uit: adres of plaats uit Sportlink, anders de clubnaam van de tegenstander. */
function weerPlaats(w){
  const uitAdres = s => { const d = String(s || '').split(',').map(x => x.trim()).filter(Boolean); return d.length > 1 ? d[d.length - 1].replace(/^\d{4}\s?[a-z]{2}\s*/i, '') : ''; };
  if (w.plaats) return String(w.plaats).trim();
  if (w.adres && uitAdres(w.adres)) return uitAdres(w.adres);
  if (w.thuis){
    const tel = new Map();
    for (const x of S.wedstrijden || []) if (x.thuis && x.plaats) tel.set(x.plaats, (tel.get(x.plaats) || 0) + 1);
    const vaak = [...tel].sort((a, b) => b[1] - a[1])[0]?.[0];
    return vaak || S.team?.weerPlaats || '';
  }
  return String(w.tegenstander || '').replace(/\s+(JO|MO|O)\d.*$/i, '').trim();
}

const _weer = new Map();   // sleutel plaats|datum → Promise
function haalWeer(plaats, datum){
  const k = `${plaats}|${datum}`;
  if (_weer.has(k)) return _weer.get(k);
  const p = (async () => {
    const g = await fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(plaats)}&count=1&language=nl&countryCode=NL`).then(r => r.json());
    const loc = g?.results?.[0];
    if (!loc) return { fout: 'plaats' };
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${loc.latitude}&longitude=${loc.longitude}`
      + '&hourly=temperature_2m,apparent_temperature,precipitation,precipitation_probability,weather_code,wind_speed_10m,wind_direction_10m'
      + `&timezone=Europe%2FAmsterdam&start_date=${datum}&end_date=${datum}`;
    const f = await fetch(url).then(r => r.json());
    if (!f?.hourly?.time) return { fout: 'weer' };
    return { plaats: loc.name, uren: f.hourly.time.map((t, i) => ({
      uur: +t.slice(11, 13), temp: f.hourly.temperature_2m[i], gevoel: f.hourly.apparent_temperature[i],
      mm: f.hourly.precipitation[i], kans: f.hourly.precipitation_probability?.[i] ?? null,
      code: f.hourly.weather_code[i], wind: f.hourly.wind_speed_10m[i], richting: f.hourly.wind_direction_10m[i],
    })) };
  })().catch(e => { console.warn('[voorbereiding] weer ophalen mislukt', e); _weer.delete(k); return { fout: 'net' }; });
  _weer.set(k, p);
  return p;
}

function adviesVan(u, regenTijdens){
  const a = [];
  if (regenTijdens) a.push('Regenjas mee, en een droge trui voor de wissels');
  if (u.gevoel <= 5) a.push('Koud langs de lijn: lange mouwen of handschoenen voor wie op de bank zit');
  else if (u.gevoel <= 9 && !regenTijdens) a.push('Fris: een trainingsjack voor de wissels');
  if (u.temp >= 25) a.push('Warm: extra water mee en vaker wisselen');
  if (bft(u.wind) >= 6) a.push('Harde wind: lange ballen en hoge voorzetten worden lastig');
  return a;
}

function weerHtml(w, r){
  const aftrapUur = parseInt((w.aftrap || '').slice(0, 2), 10);
  if (!r || r.fout){
    const tekst = r?.fout === 'plaats' ? `Plaats "${esc(weerPlaats(w))}" niet gevonden bij de weerdienst.` : 'De weersverwachting kon niet worden opgehaald. Controleer je verbinding.';
    return leeg(tekst);
  }
  const uren = r.uren;
  const u = uren.find(x => x.uur === aftrapUur) || uren[12];
  const blok = uren.filter(x => x.uur >= aftrapUur - 1 && x.uur <= aftrapUur + 3);
  const regenTijdens = blok.some(x => x.mm >= 0.3 || (x.kans ?? 0) >= 50);
  const mm = blok.filter(x => x.uur >= aftrapUur && x.uur < aftrapUur + 2).reduce((s, x) => s + x.mm, 0);
  const maxMm = Math.max(0.5, ...blok.map(x => x.mm));
  const advies = adviesVan(u, regenTijdens);
  return `<div class="vb-weer-kop">
      <span class="vb-temp">${Math.round(u.temp)}°</span>
      <span class="vb-weer-tekst"><b>${weerTekst(u.code)}</b><span class="vb-zacht">${esc(r.plaats)} om ${p2(u.uur)}:00</span></span>
    </div>
    <div class="vb-weer-grid">
      <div><span>Wind</span><b>${bft(u.wind)} Bft ${richting(u.richting)}</b></div>
      <div><span>Neerslag</span><b>${mm.toFixed(1).replace('.', ',')} mm</b></div>
      <div><span>Gevoel</span><b>${Math.round(u.gevoel)}°</b></div>
    </div>
    <ol class="vb-uren" aria-label="Neerslag per uur">${blok.map(x => `<li${x.uur === aftrapUur ? ' class="nu"' : ''}>
      <span>${Math.round(x.temp)}°</span><span class="vb-uur-spoor"><span style="height:${Math.max(4, Math.round(x.mm / maxMm * 40))}px"></span></span><span>${p2(x.uur)} u</span>
      <span class="visually-hidden">${x.mm.toFixed(1)} mm</span></li>`).join('')}</ol>
    ${advies.length ? `<div class="vb-advies">${ico('action-info', 20)}<ul>${advies.map(t => `<li>${esc(t)}</li>`).join('')}</ul></div>` : ''}
    <p class="vb-bron">Verwachting van Open-Meteo, bijgewerkt bij openen.</p>`;
}

/* ==================== TAB: PRAKTISCH ==================== */
function tabPraktisch(w){
  const n = dagenTot(w.datum), plaats = weerPlaats(w);
  let weer;
  if (n < 0) weer = leeg('Deze wedstrijd is al gespeeld.');
  else if (!w.aftrap) weer = leeg('Nog geen aanvangstijd bekend. Vul die in bij Wijzig opzet.');
  else if (n > 14) weer = leeg(`De weersverwachting verschijnt vanaf twee weken voor de wedstrijd.`);
  else if (!plaats) weer = `${leeg('In welke plaats speel je thuis? Dan halen we het weer daar op.')}
      <form class="vb-invoer" data-vb-weerplaats><label class="visually-hidden" for="vbWeerPlaats">Thuisplaats</label>
      <input class="invoer" id="vbWeerPlaats" placeholder="Plaatsnaam" autocomplete="address-level2">
      <button type="submit" class="knop licht">Opslaan</button></form>`;
  else weer = `<div class="vb-weer" data-vb-weer><p class="vb-leeg">Weer ophalen voor ${esc(plaats)}…</p></div>`;

  const plek = plekHtml(w);
  const veldInfo = feiten(rij('Aanvang', w.aftrap ? `<b>${esc(w.aftrap)}</b>` : 'Nog onbekend'), rij('Thuis of uit', w.thuis ? 'Thuis' : 'Uit'));
  return `${kaart('Weer bij aanvang', weer)}
    ${kaart('Waar en wanneer', `${veldInfo}${plek || leeg('Nog geen locatie, veld of kleedkamer bekend. Vul die in bij Wijzig opzet.')}`)}
    <div class="nu-acties">${knop('Deel in de groepsapp', 'action-whatsapp', 'data-vb-deel')}</div>
    <p class="vb-bron">Zonder spelersnamen: alleen datum, tijd, plek en weer.</p>`;
}

/* ==================== TAB: PLAN ==================== */
function tabPlan(w){
  const p = presentieWedstrijd(w), ok = opstellingKlaar(w);
  const pct = p.totaal ? Math.round(p.ja / p.totaal * 100) : 0;
  const pres = `<p class="vb-groot"><b>${p.ja}</b> van ${p.totaal} spelers spelen mee</p>
    <span class="vb-spoor" role="img" aria-label="${pct} procent"><span style="width:${pct}%"></span></span>
    ${p.afwezig.length ? `<p class="vb-afwezig">Afwezig: ${afwezigTekst(p.afwezig, p.redenen)}</p>` : ''}
    ${p.nietMee && !p.afwezig.length ? `<p class="vb-zacht">${p.nietMee} niet in de selectie</p>` : ''}
    <div class="nu-acties">${knop('Presentie aanpassen', 'attendance-fill', 'data-vb-pres')}</div>`;

  const punten = w.voorbereiding?.punten || [];
  const plan = `${w.doel ? feiten(rij('Wedstrijddoel', esc(w.doel))) : ''}
    ${punten.length ? `<ol class="vb-punten">${punten.map((t, i) => `<li><span class="vb-nr">${i + 1}</span><span class="vb-punt">${esc(t)}</span>
      <button type="button" class="vb-weg" data-vb-weg="${i}" aria-label="Punt ${i + 1} verwijderen">${ico('navigation-close', 18)}</button></li>`).join('')}</ol>`
      : leeg('Nog geen aandachtspunten. Wat wil je het team meegeven?')}
    ${punten.length < 5 ? `<form class="vb-invoer" data-vb-punt><label class="visually-hidden" for="vbPunt">Nieuw aandachtspunt</label>
      <input class="invoer" id="vbPunt" maxlength="120" placeholder="Bijv. hoog druk zetten" autocomplete="off">
      <button type="submit" class="knop licht">Toevoegen</button></form>` : ''}`;

  const opst = feiten(rij('Ingevuld', ok.klaar === ok.totaal ? 'Alle periodes' : `<span class="nu-let">${ok.klaar} van ${ok.totaal} periodes</span>`),
    w.formatie ? rij('Formatie', esc(w.formatie)) : '');
  const na = `<label class="visually-hidden" for="vbNa">Notitie na afloop</label>
    <textarea class="invoer vb-na" id="vbNa" rows="3" placeholder="Wat ging goed, wat pakken we op in de training?">${esc(w.voorbereiding?.naAfloop || '')}</textarea>
    <p class="vb-bron">Bewaard bij deze wedstrijd. De volgende keer tegen deze tegenstander zie je hem terug onder Vorige ontmoeting.</p>`;

  return `${kaart('Beschikbaarheid', pres)}
    ${kaart('Aandachtspunten', plan)}
    ${kaart('Opstelling', `${opst}<div class="nu-acties">${knop('Opstelling', 'football-lineup', `data-vb-wedstrijd="${esc(w.id)}"`)}</div>`)}
    ${kaart('Na afloop', na)}`;
}

/* ==================== TAB: SCOUTING (alleen eerste elftal) ====================
   [20261106] Rapport van de Cloud Function scoutTegenstander (functions/scouting.js),
   opgeslagen in teams/{id}/wedstrijden/{wid}/scouting/laatste. Elke donderdag
   20:00 automatisch, of via de knop "Nu zoeken" (max. eens per 6 uur). */
export function isEersteElftal(team){
  const naam = String(team?.sportlinkNaam || '').trim() || String(team?.naam || '');
  let s = naam.toLowerCase().replace(/asv['’`]?\s*33/g, ' ');
  if (S.club?.naam) s = s.split(String(S.club.naam).toLowerCase()).join(' ');
  s = s.replace(/\(?\s*(zon|zat)[a-z]*\s*\)?/g, ' ').replace(/[^a-z0-9]+/g, '');
  return s === '1';
}
const _scout = new Map();   // wid → { laden, data, fout, zoekt }
function laadScout(wid, opnieuw){
  const st = _scout.get(wid);
  if (st && !opnieuw) return;
  /* Bij herladen het vorige rapport en een eventuele foutmelding laten staan (geen flikkering). */
  _scout.set(wid, { laden: !st?.data, data: st?.data, fout: st?.fout });
  /* Via de functie lezen (Firestore-regels geven de client geen leesrecht op de
     subcollectie scouting; de functie controleert de toegang zelf). */
  httpsCallable(functions, 'scoutTegenstander', { timeout: 30000 })({ teamId: S.teamId, wedstrijdId: wid, lezen: true })
    .then(res => {
      const data = res.data || null;
      _scout.set(wid, { data, fout: _scout.get(wid)?.fout });
      /* Loopt er een zoektocht (ook als het scherm tussendoor dicht was)? Elke
         20 s opnieuw kijken tot het rapport er is. Max. 20 minuten. */
      if (data?.bezig && Date.now() - (data.bezigSinds || 0) < 20 * 60e3)
        setTimeout(() => { if (_wid === wid && S._vbTab === 'scouting' && !_scout.get(wid)?.zoekt) laadScout(wid, true); }, 20000);
    })
    .catch(e => { console.warn('[scouting] laden mislukt', e?.code, e?.message); _scout.set(wid, { fout: `Het rapport kon niet worden geladen (${String(e?.code || 'onbekend').replace(/^functions\//, '')}). Controleer je verbinding.` }); })
    .finally(() => { if (_wid === wid && S._vbTab === 'scouting') teken(); });
}
const bronRef = nrs => (nrs || []).map(n => n === 'cijfers'
  ? '<span class="vb-bronref vb-bronref-c" title="Uit de cijfers van Sportlink en Cluppie">[cijfers]</span>'
  : `<a class="vb-bronref" href="#vbBron${n}" aria-label="Bron ${n}">[${n}]</a>`).join(' ');
function gemaaktTekst(d){
  if (!d?.gemaaktMs) return '';
  const t = new Date(d.gemaaktMs);
  return `${hoofd(DAG_LANG[t.getDay()].slice(0, 2))} ${t.getDate()} ${MAAND[t.getMonth()].slice(0, 3)}, ${p2(t.getHours())}:${p2(t.getMinutes())}`;
}
const RES_KLASSE = { W: 'vb-res-W', G: 'vb-res-G', V: 'vb-res-V' };
function cijfersHtml(c){
  if (!c) return '';
  const regel = (l, x) => x && x.gespeeld ? rij(l, `<span class="vb-num">${x.w}W ${x.g}G ${x.v}V · ${x.voor}-${x.tegen}</span>`) : '';
  const t = c.totaal || {};
  const tegels = t.gespeeld ? `<div class="vb-tegels">
      <div><b>${c.stand ? esc(String(c.stand.positie)) + 'e' : '–'}</b><span>Stand</span></div>
      <div><b>${(t.voor / t.gespeeld).toFixed(1).replace('.', ',')}</b><span>Goals p/w</span></div>
      <div><b>${(t.tegen / t.gespeeld).toFixed(1).replace('.', ',')}</b><span>Tegen p/w</span></div>
      <div><b>${t.nul}</b><span>De nul</span></div></div>` : '';
  const reeks = c.reeks ? rij('Reeks', `${c.reeks.aantal}x ${RES_LABEL[c.reeks.res]} op rij${c.reeks.ongeslagen > 1 ? `, ${c.reeks.ongeslagen} duels ongeslagen` : ''}`) : '';
  const gem = (c.gemeenschappelijk || []).length ? `<h4 class="vb-subkop">Zelfde tegenstanders, zij en wij</h4>
    <ul class="vb-uitslagen">${c.gemeenschappelijk.map(g => `<li><span>${esc(g.tegen)}</span><b><span class="${RES_KLASSE[g.zijRes] || ''}-t">${esc(g.zij)}</span> · <span class="${RES_KLASSE[g.wijRes] || ''}-t">wij ${esc(g.wij)}</span></b></li>`).join('')}</ul>` : '';
  /* Sportlink (wedstrijd-historische-resultaten) gaat over alle seizoenen; anders Cluppie zelf. */
  const sl = c.sportlink || {};
  const hist = (sl.onderling || []).length ? `<h4 class="vb-subkop">Alle onderlinge duels (Sportlink)</h4>
    <ul class="vb-uitslagen">${sl.onderling.map(h => `<li><span>${esc(h.seizoen || h.datum.slice(0, 4))} · ${esc(h.wedstrijd)}</span><b>${esc(h.uitslag || '–')}</b></li>`).join('')}</ul>`
    : (c.historie || []).length ? `<h4 class="vb-subkop">Eerdere onderlinge duels</h4>
    <ul class="vb-uitslagen">${c.historie.map(h => `<li><span>${esc(hoofd(datumLang(h.datum)))} · ${h.thuis ? 'thuis' : 'uit'}</span><b>${esc(h.score || 'onbekend')}</b></li>`).join('')}</ul>` : '';
  const cs = sl.clubstat;
  const clubRij = (x) => x && (x.thuis || x.uit) ? rij(x.naam, `${esc(x.thuis || '–')} thuis · ${esc(x.uit || '–')} uit`) : '';
  const clubHist = cs ? `<h4 class="vb-subkop">Winstpercentage club, alle jaren</h4>${feiten(clubRij(cs.tegenstander), clubRij(cs.eigen))}` : '';
  return kaart('Cijfers (Sportlink en Cluppie)', `${tegels}
    ${feiten(regel('Thuis', c.thuis), regel('Uit', c.uit), regel('Tegen bovenste helft', c.tegenTop), regel('Tegen onderste helft', c.tegenOnder), reeks,
      c.grootsteWinst ? rij('Grootste winst', `${esc(c.grootsteWinst.score)} tegen ${esc(c.grootsteWinst.tegen)}`) : '',
      c.grootsteVerlies ? rij('Grootste verlies', `${esc(c.grootsteVerlies.score)} tegen ${esc(c.grootsteVerlies.tegen)}`) : '',
      sl.scheidsrechter ? rij('Scheidsrechter', esc(sl.scheidsrechter)) : '')}
    ${gem}${hist}${clubHist}`);
}
const itemLijst = arr => (arr || []).length ? `<ul class="vb-lijst">${arr.map(x => `<li>${esc(x.tekst)} ${bronRef(x.bronnen)}</li>`).join('')}</ul>` : '';
function tabScouting(w){
  if (!_scout.has(w.id)) laadScout(w.id);
  const st = _scout.get(w.id) || {};
  const zoekKnop = (label) => `<button type="button" class="knop licht" data-vb-scout ${st.zoekt ? 'disabled' : ''}>${st.zoekt ? 'Zoeken…' : esc(label)}</button>`;
  if (st.laden) return kaart('Scouting', leeg('Rapport laden…'));
  const d = st.data;
  const bezigOpServer = d?.bezig && Date.now() - (d.bezigSinds || 0) < 20 * 60e3;
  if (st.zoekt || bezigOpServer) return kaart('Scouting', leeg(`De scout leest nu verslagen en nieuws over ${esc(w.tegenstander)} en maakt een analyse. Dit duurt drie tot vijf minuten; je kunt het scherm gerust sluiten en later terugkomen.`));
  const foutTekst = st.fout || d?.laatsteFout || '';
  const fout = foutTekst ? `<p class="vb-afwezig" role="alert">${esc(foutTekst)}</p>` : '';
  if (!d || !d.status){
    return kaart('Scouting', `${leeg('Nog geen scoutingrapport voor deze wedstrijd. Het rapport wordt elke donderdagavond automatisch gemaakt voor de eerstvolgende wedstrijd.')}
      ${fout}<div class="nu-acties">${zoekKnop('Nu zoeken')}</div>`);
  }
  const oud = d.versie !== 2;
  const status = `<div class="vb-scoutstatus">${ico(d.status === 'klaar' ? 'action-check' : 'action-info', 20)}
      <div><b>Gezocht ${esc(gemaaktTekst(d))}</b><span class="vb-zacht">${d.bronnen?.length || 0} bronnen${d.gelezen ? `, ${d.gelezen} volledig gelezen` : ''} · elke donderdag automatisch</span></div>
      ${zoekKnop('Opnieuw')}</div>
      ${oud ? '<p class="vb-afwezig">Dit is een kort rapport van de eerste versie. Tik op Opnieuw voor de uitgebreide analyse.</p>' : ''}`;
  if (d.status !== 'klaar') return `${status}${fout}<h3 class="vb-deelkop">Feiten uit Sportlink en Cluppie</h3>${cijfersHtml(d.cijfers)}<h3 class="vb-deelkop">AI-analyse</h3>${kaart('In het kort', leeg('Er is weinig openbare informatie gevonden over deze tegenstander.'))}`;
  const blok = (kop, html) => html ? kaart(kop, html) : '';
  const b = d.betrouwbaarheid;
  const spelers = (d.spelers || []).length ? `<ul class="vb-spelers">${d.spelers.map(x => `<li><span class="vb-nr vb-nr-zacht">${x.rugnummer ?? '·'}</span>
      <div><b>${esc(x.naam)}</b><span class="vb-zacht">${esc([x.rol, x.tekst].filter(Boolean).join(', '))} ${bronRef(x.bronnen)}</span></div></li>`).join('')}</ul>
      <p class="vb-bron">Alleen wat in openbare wedstrijdverslagen staat. Geen sociale media.</p>` : '';
  const nieuws = (d.nieuws || []).length ? `<ul class="vb-nieuws">${d.nieuws.map(x => `<li>${x.datum ? `<span class="vb-zacht">${esc(datumLang(x.datum))}</span>` : ''}<span>${esc(x.tekst)} ${bronRef(x.bronnen)}</span></li>`).join('')}</ul>` : '';
  const plan = (d.plan || []).length ? `<ol class="vb-punten">${d.plan.map((x, i) => `<li><span class="vb-nr">${i + 1}</span><span class="vb-punt">${esc(x.tekst)}</span></li>`).join('')}</ol>
      <p class="vb-bron">Afgeleid uit de analyse hierboven. Neem over in je Aandachtspunten onder Plan als je het eens bent.</p>` : '';
  /* Bronnen met datum vooraan, zodat de coach direct ziet hoe actueel de analyse is. */
  const datumKort = iso => { const t = new Date(iso + 'T12:00'); return `${t.getDate()} ${MAAND[t.getMonth()].slice(0, 3)} ${t.getFullYear()}`; };
  const bronnen = (d.bronnen || []).length ? `<ol class="vb-bronnen vb-bronnen-datum">${d.bronnen.map(x => `<li id="vbBron${x.nr}">
      <span class="vb-bron-nr">[${x.nr}]</span>
      <span class="vb-bron-tekst"><span class="vb-bron-datum">${x.datum ? esc(datumKort(x.datum)) : 'datum onbekend'}</span>
        <a href="${esc(x.url)}" target="_blank" rel="noopener noreferrer">${esc(x.titel)}</a>
        <span class="vb-zacht">${esc(x.site)}</span></span></li>`).join('')}</ol>` : leeg('Geen bevestigde bronnen gevonden.');
  /* [20261107c] Volgorde op verzoek: eerst de feiten (Sportlink en Cluppie),
     dan een duidelijke disclaimer, dan de gebruikte bronnen met datum, en pas
     daaronder de AI-analyse. */
  const niveauTekst = { hoog: 'hoog', middel: 'middel', laag: 'laag' }[b?.niveau] || 'onbekend';
  const disclaimer = `<section class="vb-disclaimer" role="note" aria-labelledby="vbDiscKop">
      <div class="vb-disc-kop">${ico('action-info', 20)}<h3 id="vbDiscKop">Vanaf hier: AI-analyse, niet gecontroleerd</h3></div>
      <p>Dit deel is automatisch gemaakt door AI uit openbare wedstrijdverslagen en nieuws. Het kan fouten bevatten, verouderd zijn of informatie over een ander team of seizoen door elkaar halen. Gebruik het als startpunt, niet als feit, en controleer belangrijke punten via de bronnen hieronder.</p>
      <p class="vb-disc-niveau">Betrouwbaarheid volgens de scout: <b>${esc(niveauTekst)}</b>${b?.tekst ? `. ${esc(b.tekst)}` : ''}</p>
    </section>`;
  return `${status}${fout}
    <h3 class="vb-deelkop">Feiten uit Sportlink en Cluppie</h3>
    ${cijfersHtml(d.cijfers)}
    ${disclaimer}
    <h3 class="vb-deelkop">AI-analyse</h3>
    ${kaart('Gebruikte bronnen', bronnen)}
    ${blok('In het kort', d.kort ? `<p class="vb-tekst">${esc(d.kort)} ${bronRef(d.kortBronnen)}</p>` : '')}
    ${blok('Wedstrijdplan', plan)}
    ${blok('Systeem en vaste spelers', d.systeem ? `<p class="vb-tekst">${esc(d.systeem.tekst)} ${bronRef(d.systeem.bronnen)}</p>` : '')}
    ${blok('In balbezit', itemLijst(d.inBalbezit))}
    ${blok('Tegen balbezit', itemLijst(d.tegenBalbezit))}
    ${blok('Omschakelen', itemLijst(d.omschakelen))}
    ${blok('Standaardsituaties', itemLijst(d.standaards))}
    ${blok('Sterke punten', itemLijst(d.sterk))}
    ${blok('Zwakke punten', itemLijst(d.zwak))}
    ${blok('Patronen in wedstrijden', itemLijst(d.patronen))}
    ${blok(oud ? 'Speelwijze volgens verslagen' : '', oud ? itemLijst(d.speelwijze) : '')}
    ${blok('Opvallende spelers in de verslagen', spelers)}
    ${blok('Nieuws rond de club', nieuws)}`;
}

const _cijfers = new Map();   // wid → { laden, data, fout }
function sportlinkAnalyseHtml(w){
  if (!_cijfers.has(w.id)){
    _cijfers.set(w.id, { laden: true });
    httpsCallable(functions, 'scoutTegenstander', { timeout: 60000 })({ teamId: S.teamId, wedstrijdId: w.id, cijfers: true })
      .then(res => _cijfers.set(w.id, { data: res.data || null }))
      .catch(e => { console.warn('[sportlink-analyse]', e?.code, e?.message); _cijfers.set(w.id, { fout: true }); })
      .finally(() => { if (_wid === w.id && (S._vbTab || 'tegenstander') === 'tegenstander') teken(); });
  }
  const st = _cijfers.get(w.id);
  if (st.laden) return kaart('Sportlink-analyse', leeg('Cijfers ophalen…'));
  if (st.fout) return kaart('Sportlink-analyse', leeg('De Sportlink-analyse kon niet worden opgehaald. Probeer het later opnieuw.'));
  if (!st.data || !st.data.totaal?.gespeeld) return '';
  return cijfersHtml(st.data);
}

async function startScout(w){
  const st = _scout.get(w.id) || {};
  _scout.set(w.id, { ...st, zoekt: true, fout: null });
  teken();
  telGebruik('scouting_zoeken');
  try {
    const res = await httpsCallable(functions, 'scoutTegenstander', { timeout: 3600000 })({ teamId: S.teamId, wedstrijdId: w.id });
    _scout.set(w.id, { data: { ...res.data, gemaaktMs: res.data?.gemaaktMs || Date.now() } });
  } catch (e){
    /* Toon de melding van de server; alleen bij een kale technische code een eigen tekst (met code, voor het log). */
    const m = String(e?.message || '').trim(), code = String(e?.code || '').replace(/^functions\//, '');
    const kaal = !m || /^(internal|deadline-exceeded|unavailable|unknown)$/i.test(m);
    _scout.set(w.id, { ...st, zoekt: false, fout: kaal
      ? `Zoeken mislukt (${code || 'onbekend'}). Kijk over een paar minuten of het rapport er toch is, of probeer het opnieuw.`
      : m });
    laadScout(w.id, true);   // misschien is het rapport op de server wel gelukt
  }
  if (_wid === w.id && S._vbTab === 'scouting') teken();
}

/* ==================== VENSTER ==================== */
const TABS_BASIS = [['tegenstander', 'Tegenstander'], ['praktisch', 'Praktisch'], ['plan', 'Plan']];
const tabsVoorTeam = () => isEersteElftal(S.team) ? [TABS_BASIS[0], ['scouting', 'Scouting'], TABS_BASIS[1], TABS_BASIS[2]] : TABS_BASIS;
let _ctx = null, _wid = null;
const huidig = () => (S.wedstrijden || []).find(x => x.id === _wid) || null;

function kopHtml(w){
  return `<div class="vb-wedkop">
      <div class="nu-kaart-kop"><span class="nu-tag nu-tag-warn">${esc(wanneer(w.datum))}</span>
        <span class="vb-zacht">${w.thuis ? 'Thuis' : 'Uit'}${w.aftrap ? ` · ${esc(w.aftrap)}` : ''}</span></div>
      <p class="nu-titel">${esc(w.tegenstander || 'Wedstrijd')}</p>
      <p class="nu-meta"><span>${esc(hoofd(datumLang(w.datum)))}</span></p>
    </div>
    <div class="segment vb-tabs${tabsVoorTeam().length > 3 ? ' vb-tabs-4' : ''}" role="tablist" aria-label="Onderdelen">${tabsVoorTeam().map(([id, naam]) =>
      `<button type="button" role="tab" id="vbTab-${id}" aria-selected="${S._vbTab === id}" aria-controls="vbPaneel" class="${S._vbTab === id ? 'actief' : ''}" data-vb-tab="${id}">${naam}</button>`).join('')}</div>`;
}

function teken(){
  const body = document.querySelector('#modalInhoud .modal-body');
  const w = huidig();
  if (!body) return;
  if (!w){ sluitModal(); return; }
  if (!tabsVoorTeam().some(([id]) => id === S._vbTab)) S._vbTab = 'tegenstander';
  const tab = S._vbTab;
  const inhoud = tab === 'praktisch' ? tabPraktisch(w) : tab === 'plan' ? tabPlan(w) : tab === 'scouting' ? tabScouting(w) : tabTegenstander(w);
  body.innerHTML = `${kopHtml(w)}<div id="vbPaneel" role="tabpanel" aria-labelledby="vbTab-${tab}" class="vb-paneel">${inhoud}</div>`;
  if (tab === 'praktisch'){
    const vak = body.querySelector('[data-vb-weer]');
    if (vak){
      haalWeer(weerPlaats(w), w.datum).then(r => {
        const nu = document.querySelector('#modalInhoud [data-vb-weer]');
        if (nu && S._vbTab === 'praktisch' && _wid === w.id) nu.innerHTML = weerHtml(w, r);
      });
    }
  }
}

async function bewaar(w, deel){
  /* Lokaal meteen bijwerken zodat het scherm direct klopt; de snapshot volgt. */
  w.voorbereiding = { ...(w.voorbereiding || {}), ...deel };
  try {
    await setDoc(doc(db, 'teams', S.teamId, 'wedstrijden', w.id), { voorbereiding: deel }, { merge: true });
    return true;
  } catch (e){
    meld('Opslaan mislukt, geen verbinding. Probeer het zo opnieuw.');
    console.warn('[voorbereiding] opslaan mislukt', e);
    return false;
  }
}

async function deelTekst(w){
  const regels = [`Wedstrijd ${datumLang(w.datum)}: ${S.team?.naam || ''} ${w.thuis ? 'thuis tegen' : 'uit bij'} ${w.tegenstander || ''}`.replace(/\s+/g, ' ').trim()];
  if (w.aftrap) regels.push(`Aanvang ${w.aftrap}`);
  const plek = [w.thuis ? '' : (w.locatie || w.adres || ''), w.veld || w.slVeld ? `veld ${String(w.veld || w.slVeld).replace(/^veld\s*/i, '')}` : '', w.kleedkamer || w.slKleedkamer ? `kleedkamer ${String(w.kleedkamer || w.slKleedkamer).replace(/^kleedkamer\s*/i, '')}` : ''].filter(Boolean);
  if (plek.length) regels.push(hoofd(plek.join(', ')));
  const route = !w.thuis ? routeUrl(w) : '';
  if (route) regels.push(`Route: ${route}`);
  const plaats = weerPlaats(w), n = dagenTot(w.datum);
  if (plaats && w.aftrap && n >= 0 && n <= 14){
    const r = await haalWeer(plaats, w.datum);
    if (r && !r.fout){
      const uur = parseInt(w.aftrap.slice(0, 2), 10), u = r.uren.find(x => x.uur === uur);
      if (u){
        const blok = r.uren.filter(x => x.uur >= uur - 1 && x.uur <= uur + 3);
        const regen = blok.some(x => x.mm >= 0.3 || (x.kans ?? 0) >= 50);
        regels.push(`Weer: ${Math.round(u.temp)}°, ${weerTekst(u.code).toLowerCase()}, wind ${bft(u.wind)} Bft.`);
        const adv = adviesVan(u, regen);
        if (adv.length) regels.push(adv[0] + '.');
      }
    }
  }
  return regels.join('\n');
}

function koppel(body){
  body.addEventListener('click', async ev => {
    const t = ev.target.closest('[data-vb-tab]');
    if (t){ S._vbTab = t.dataset.vbTab; teken(); telNav('wedstrijd:voorbereiding:' + S._vbTab, 'tab'); return; }
    const w = huidig();
    if (!w) return;
    const wd = ev.target.closest('[data-vb-wedstrijd]');
    if (wd){
      const id = wd.dataset.vbWedstrijd;
      sluitModal();
      const m = await import('./wedstrijd.js?v=20261111e');
      m.openWedstrijd(id);
      return;
    }
    const tt = ev.target.closest('[data-vb-tab-team]');
    if (tt){ sluitModal(); _ctx?.zetTeamTab?.(tt.dataset.vbTabTeam); return; }
    if (ev.target.closest('[data-vb-scout]')){ startScout(w); return; }
    const br = ev.target.closest('.vb-bronref');
    if (br){ ev.preventDefault(); document.querySelector(br.getAttribute('href'))?.scrollIntoView({ behavior: 'smooth', block: 'center' }); return; }
    if (ev.target.closest('[data-vb-pres]')){ S._presWedstrijdId = w.id; sluitModal(); _ctx?.zetTeamTab?.('preswedstrijd'); return; }
    const weg = ev.target.closest('[data-vb-weg]');
    if (weg){
      const punten = (w.voorbereiding?.punten || []).filter((_, i) => i !== +weg.dataset.vbWeg);
      await bewaar(w, { punten });
      teken();
      return;
    }
    if (ev.target.closest('[data-vb-deel]')){
      const tekst = await deelTekst(w);
      telGebruik('voorbereiding_delen');
      if (navigator.share){
        try { await navigator.share({ text: tekst }); return; }
        catch (e){ if (e && e.name === 'AbortError') return; }
      }
      window.open('https://wa.me/?text=' + encodeURIComponent(tekst), '_blank');
    }
  });
  body.addEventListener('submit', async ev => {
    ev.preventDefault();
    const w = huidig();
    if (!w) return;
    if (ev.target.matches('[data-vb-punt]')){
      const inp = ev.target.querySelector('input'), tekst = inp.value.trim();
      if (!tekst){ inp.focus(); return; }
      const punten = [...(w.voorbereiding?.punten || []), tekst].slice(0, 5);
      if (await bewaar(w, { punten })){ teken(); document.getElementById('vbPunt')?.focus(); }
      return;
    }
    if (ev.target.matches('[data-vb-weerplaats]')){
      const plaats = ev.target.querySelector('input').value.trim();
      if (!plaats) return;
      try {
        await updateDoc(doc(db, 'teams', S.teamId), { weerPlaats: plaats });
        if (S.team) S.team.weerPlaats = plaats;
        teken();
      } catch (e){ meld('Opslaan mislukt, geen verbinding. Probeer het zo opnieuw.'); }
    }
  });
  body.addEventListener('change', async ev => {
    if (ev.target.id !== 'vbNa') return;
    const w = huidig();
    if (!w) return;
    const tekst = ev.target.value.trim();
    if (tekst === (w.voorbereiding?.naAfloop || '')) return;
    if (await bewaar(w, { naAfloop: tekst })) meld('Notitie opgeslagen');
  });
}

/* Openen vanuit het Nu-blok. ctx = { zetTeamTab } uit teams.js. */
export function openVoorbereiding(wid, ctx){
  const w = (S.wedstrijden || []).find(x => x.id === wid);
  if (!w) return meld('Wedstrijd niet gevonden');
  _ctx = ctx || null; _wid = wid;
  if (S._vbWid !== wid){ S._vbTab = 'tegenstander'; S._vbWid = wid; }
  S._vbTab ||= 'tegenstander';
  openModal('<h2>Wedstrijdvoorbereiding</h2><div></div>');
  const body = document.querySelector('#modalInhoud .modal-body');
  if (!body) return;
  body.classList.add('vb-body');
  koppel(body);
  teken();
  telNav('wedstrijd:voorbereiding', 'open');
  telGebruik('voorbereiding');
  /* teams.js roept dit aan na elke wedstrijden-snapshot (runtime-hook op S,
     zodat state.js niet hoeft te veranderen). */
  S._vbVerversen = verversVoorbereiding;
}

/* Na een snapshot van de wedstrijden (bv. een mede-coach voegt een punt toe)
   opnieuw tekenen, maar niet terwijl iemand aan het typen is. */
export function verversVoorbereiding(){
  const open = document.querySelector('#modalAchter.open #modalInhoud .vb-body');
  if (!open) return;
  if (open.contains(document.activeElement) && /^(INPUT|TEXTAREA)$/.test(document.activeElement.tagName)) return;
  teken();
}
