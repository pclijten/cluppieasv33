/* ==================== CLUB-INZICHT: TRAININGEN ====================
   Tab "Trainingen" onder Club → Inzicht. Per team per ISO-week:
   - Presentie ingevuld: hoeveel geplande trainingen hebben presentie in Cluppie,
     en wanneer is die vastgelegd (tijdens training / zelfde dag erna / later).
   - Oefenstof geopend: is de oefenstof van die training vooraf geopend, en hoe
     ver vooruit (2+ dagen / dag ervoor / dag zelf / pas erna / niet).

   Bronnen (alleen gelezen als deze tab opent):
   - teams/{id}/presentie            (datum, gemaakt, gewijzigd)
   - teams/{id}/trainingGeopend      (momenten per training; zie training-log.js)
   - trainingen (club)               (welke oefenstof hoort bij welke week/dag)
   - clubs/{clubId}/afgelastingen    (afgelaste dagen tellen niet mee)
   Geplande trainingen komen uit de huidige trainingsmomenten van het team.

   AVG: alleen teamniveau. Geen spelers- of coachnamen in dit scherm.
   ====================================================================== */

import { db, collection, getDocs, query, where, functions, httpsCallable } from './firebase.js?v=20261106r';
import { S, esc } from './state.js?v=20261111g';
import { momentenVanTeam } from './trainingsmomenten.js?v=20261111g';
import { bouwGroepen } from './bouw-indeling.js?v=20261111g';

const DAG = ['', 'Ma', 'Di', 'Wo', 'Do', 'Vr', 'Za', 'Zo'];
const DAG_MS = 86400000;
const CACHE_MS = 2 * 60 * 1000;

/* ---------- datum-hulpjes (lokale tijd) ---------- */
const pad = n => String(n).padStart(2, '0');
const isoVan = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const datumVan = iso => { const [j, m, d] = iso.split('-').map(Number); return new Date(j, m - 1, d, 12); };
const maandagVan = d => { const x = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 12); x.setDate(x.getDate() - ((x.getDay() + 6) % 7)); return x; };
const plusDagen = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
const dagNr = iso => ((datumVan(iso).getDay() + 6) % 7) + 1;     // 1 = ma … 7 = zo
const dagVerschil = (a, b) => Math.round((datumVan(a) - datumVan(b)) / DAG_MS);
function isoWeekNr(d){
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  x.setDate(x.getDate() + 3 - ((x.getDay() + 6) % 7));
  const w1 = new Date(x.getFullYear(), 0, 4);
  return 1 + Math.round(((x - w1) / DAG_MS - 3 + ((w1.getDay() + 6) % 7)) / 7);
}
const naarMs = ts => ts?.toMillis ? ts.toMillis() : (ts?.seconds ? ts.seconds * 1000 : (typeof ts === 'number' ? ts : null));
const minVan = ms => { const d = new Date(ms); return d.getHours() * 60 + d.getMinutes(); };
const tijdVan = ms => { const d = new Date(ms); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; };
const naarMin = t => { const [u, m] = String(t).split(':').map(Number); return u * 60 + m; };
const weekNrUit = s => { const m = String(s || '').match(/\b([1-9]|[1-4]\d|5[0-3])\b/); return m ? +m[1] : null; };
function kortDatum(iso){
  return datumVan(iso).toLocaleDateString('nl-NL', { weekday:'short', day:'numeric', month:'short' }).replace(/\./g, '');
}

/* ---------- module-staat (alleen dit scherm) ---------- */
const staat = { weken: 4, modus: 'pres', bouw: 'alle', gekozen: null };
let cache = null;   // { tijd, sleutel, ruw }

/* ---------- ophalen ---------- */
async function ophalen(teams){
  const sleutel = teams.map(t => t.id).join(',');
  if (cache && cache.sleutel === sleutel && Date.now() - cache.tijd < CACHE_MS) return cache.ruw;
  const seizoenFilter = S.huidigSeizoen ? [where('seizoen', '==', S.huidigSeizoen)] : [];
  const veilig = p => p.catch(e => { console.warn('[Cluppie] trainingsgebruik:', e?.code || e?.message); return null; });
  const [stofSnap, aflSnap, perTeam] = await Promise.all([
    veilig(getDocs(query(collection(db, 'trainingen'), where('club', '==', S.clubId)))),
    veilig(getDocs(collection(db, 'clubs', S.clubId, 'afgelastingen'))),
    Promise.all(teams.map(async t => {
      const [p, o] = await Promise.all([
        veilig(getDocs(query(collection(db, 'teams', t.id, 'presentie'), ...seizoenFilter))),
        veilig(getDocs(collection(db, 'teams', t.id, 'trainingGeopend'))),
      ]);
      return {
        team: t,
        presentie: p ? p.docs.map(d => d.data()).filter(x => x.datum) : [],
        geopend: o ? o.docs.map(d => ({ id: d.id, ...d.data() })) : [],
      };
    })),
  ]);
  const ruw = {
    stof: stofSnap ? stofSnap.docs.map(d => ({ id: d.id, ...d.data() })) : [],
    afgelast: new Set(aflSnap ? aflSnap.docs.map(d => d.data().datum).filter(Boolean) : []),
    perTeam,
  };
  cache = { tijd: Date.now(), sleutel, ruw };
  return ruw;
}

/* ---------- welke oefenstof hoort bij een trainingsdatum ----------
   Zelfde regel als het teamscherm: de trainingen van die ISO-week, op volgorde
   van uploaden; training 1 hoort bij de eerste trainingsdag, enz. Een vaste
   trainingsdag op de training gaat voor. */
function stofVoor(stofTeam, iso, dagen){
  const wk = isoWeekNr(datumVan(iso));
  const lijst = stofTeam.filter(t => weekNrUit(t.week) === wk)
    .sort((a, b) => (naarMs(a.gemaakt) || 0) - (naarMs(b.gemaakt) || 0));
  if (!lijst.length) return null;
  const dag = dagNr(iso);
  const vast = lijst.find(t => Number(t.trainingsdag) === dag);
  if (vast) return vast;
  const vrij = lijst.filter(t => !t.trainingsdag);
  if (!vrij.length) return null;
  const idx = Math.max(0, dagen.indexOf(dag));
  return vrij[Math.min(idx, vrij.length - 1)];
}

/* ---------- per team de trainingen in kaart brengen ----------
   presentie-code: t tijdens (t/m 30 min na einde), z zelfde dag erna, n later
                   nagetypt, d dag zelf (geen trainingstijd bekend), v vastgelegd
                   (tijdstip onbekend), x niet vastgelegd, - afgelast
   open-code:      3 twee+ dagen vooruit, 1 dag ervoor, 0 dag zelf, l pas na de
                   training, x niet geopend, g geen oefenstof voor deze training */
function teamAnalyse(td, ruw, vandaag){
  const t = td.team;
  const momenten = momentenVanTeam(t);
  const dagen = momenten.map(m => m.dag);
  const presPer = new Map(td.presentie.map(p => [p.datum, p]));
  const openPer = new Map(td.geopend.map(g => {
    const ms = Object.keys(g.momenten || {}).map(Number).filter(Boolean).sort((a, b) => a - b);
    return [g.id, { eerste: ms[0] || null, aantal: g.aantal || ms.length, momenten: ms }];
  }));
  const stofTeam = ruw.stof.filter(s => (s.teams || []).includes(t.id));

  const trainingen = [];   // { iso, dag, start, eind, pres, presMs, open, openMs, aantal, stof }
  const gezien = new Set();
  const voegToe = (iso, m, extra) => {
    if (gezien.has(iso)) return;
    gezien.add(iso);
    const p = presPer.get(iso);
    if (!p && iso >= vandaag) return;   // nog niet geweest (of vandaag nog niets): niet meetellen
    const afgelast = ruw.afgelast.has(iso);
    let pres, presMs = null;
    if (!p) pres = afgelast ? '-' : 'x';
    else {
      presMs = naarMs(p.gemaakt) || naarMs(p.gewijzigd);
      if (!presMs) pres = 'v';
      else {
        const vastIso = isoVan(new Date(presMs));
        if (vastIso < iso) pres = 't';
        else if (vastIso > iso) pres = 'n';
        else if (m?.eind) pres = minVan(presMs) <= naarMin(m.eind) + 30 ? 't' : 'z';
        else pres = 'd';
      }
    }
    const stof = pres === '-' ? null : stofVoor(stofTeam, iso, dagen);
    let open = 'g', openMs = null, aantal = 0;
    if (stof){
      const info = openPer.get(stof.id);
      if (!info || !info.eerste) open = 'x';
      else {
        openMs = info.eerste; aantal = info.aantal;
        const vooruit = dagVerschil(iso, isoVan(new Date(openMs)));
        open = vooruit >= 2 ? '3' : vooruit === 1 ? '1' : vooruit === 0 ? '0' : 'l';
      }
    }
    trainingen.push({ iso, dag: dagNr(iso), start: m?.start || '', eind: m?.eind || '', extra: !!extra,
      pres, presMs, open, openMs, aantal, stof });
  };
  return { team: t, momenten, trainingen, voegToe, presPer };
}

function bouwData(ruw, teams){
  const vandaag = isoVan(new Date());
  const nuMaandag = maandagVan(new Date());
  // weekbereik
  let startMaandag;
  if (staat.weken > 0) startMaandag = plusDagen(nuMaandag, -7 * (staat.weken - 1));
  else {
    const eerste = ruw.perTeam.flatMap(x => x.presentie.map(p => p.datum)).sort()[0];
    const nu = new Date();
    const seizoenStart = new Date(nu.getMonth() >= 6 ? nu.getFullYear() : nu.getFullYear() - 1, 7, 1, 12);
    startMaandag = maandagVan(eerste ? datumVan(eerste) : seizoenStart);
    if (startMaandag < maandagVan(seizoenStart)) startMaandag = maandagVan(seizoenStart);
  }
  const weken = [];
  for (let m = new Date(startMaandag); m <= nuMaandag; m = plusDagen(m, 7)) weken.push({ maandag: new Date(m), nr: isoWeekNr(m) });

  const idSet = new Set(teams.map(t => t.id));
  const rijen = ruw.perTeam.filter(x => idSet.has(x.team.id)).map(td => {
    const a = teamAnalyse(td, ruw, vandaag);
    const perWeek = weken.map(w => {
      const vanIso = isoVan(w.maandag), totIso = isoVan(plusDagen(w.maandag, 6));
      const voor = a.trainingen.length;
      a.momenten.forEach(m => a.voegToe(isoVan(plusDagen(w.maandag, m.dag - 1)), m, false));
      // presentie op een dag zonder vast trainingsmoment telt ook als training
      [...a.presPer.keys()].filter(iso => iso >= vanIso && iso <= totIso).sort()
        .forEach(iso => a.voegToe(iso, a.momenten.find(m => m.dag === dagNr(iso)) || null, true));
      return a.trainingen.slice(voor).sort((x, y) => x.iso.localeCompare(y.iso));
    });
    return { team: td.team, momenten: a.momenten, perWeek };
  }).sort((x, y) => (x.team.naam || '').localeCompare(y.team.naam || '', 'nl', { numeric: true }));
  return { weken, rijen };
}

/* ---------- tellingen ---------- */
const PRES_OK = new Set(['t', 'z', 'n', 'd', 'v']);
const OPEN_OK = new Set(['3', '1', '0']);
function telCel(trs){
  if (staat.modus === 'pres'){
    const gep = trs.filter(x => x.pres !== '-');
    return { gep: gep.length, vl: gep.filter(x => PRES_OK.has(x.pres)).length };
  }
  const gep = trs.filter(x => x.pres !== '-' && x.open !== 'g');
  return { gep: gep.length, vl: gep.filter(x => OPEN_OK.has(x.open)).length };
}
const klasse = (gep, vl) => !gep ? 'geen' : vl === gep ? 'vol' : vl ? 'deel' : 'nul';
const pctKleur = p => p >= 80 ? 'var(--ok)' : p >= 50 ? 'var(--warn)' : 'var(--accent)';

/* ---------- HTML ---------- */
function htmlFilters(groepen){
  const chip = (attr, waarde, label, aan) =>
    `<button class="tg-chip${aan ? ' aan' : ''}" ${attr}="${esc(waarde)}">${esc(label)}</button>`;
  return `<div class="tg-filters">
      ${chip('data-tgweken', '4', '4 weken', staat.weken === 4)}
      ${chip('data-tgweken', '8', '8 weken', staat.weken === 8)}
      ${chip('data-tgweken', '0', 'Hele seizoen', staat.weken === 0)}
    </div>
    ${groepen.length > 1 ? `<div class="tg-filters">
      ${chip('data-tgbouw', 'alle', 'Alle teams', staat.bouw === 'alle')}
      ${groepen.map(g => chip('data-tgbouw', g.id, g.naam, staat.bouw === g.id)).join('')}
    </div>` : ''}`;
}

function htmlKpis(data){
  let gep = 0, vl = 0, snel = 0, ogep = 0, ovl = 0;
  for (const r of data.rijen) for (const trs of r.perWeek) for (const x of trs){
    if (x.pres === '-') continue;
    gep++;
    if (PRES_OK.has(x.pres)) vl++;
    if (x.pres === 't' || x.pres === 'z' || x.pres === 'd') snel++;
    if (x.open !== 'g'){ ogep++; if (OPEN_OK.has(x.open)) ovl++; }
  }
  const pct = (a, b) => b ? Math.round(100 * a / b) + '%' : '—';
  const kpi = (g, l) => `<div class="inz-kpi"><div class="g">${g}</div><div class="l">${l}</div></div>`;
  return `<div class="inz-kpis">
    ${kpi(`${vl}<small>/${gep}</small>`, 'trainingen met presentie')}
    ${kpi(pct(ovl, ogep), 'oefenstof vooraf of op de dag geopend')}
    ${kpi(pct(snel, vl), 'presentie op de trainingsdag zelf')}
  </div>`;
}

function htmlRooster(data){
  if (!data.rijen.length) return '<div class="inz-sub">Geen teams in deze selectie.</div>';
  const huidig = data.weken.length - 1;
  const kop = `<tr><th class="tg-tn">Team</th>${data.weken.map((w, i) =>
    `<th class="${i === huidig ? 'huidig' : ''}">wk ${w.nr}</th>`).join('')}<th>%</th></tr>`;
  const rijen = data.rijen.map((r, ri) => {
    let g = 0, v = 0;
    const cellen = r.perWeek.map((trs, wi) => {
      const { gep, vl } = telCel(trs); g += gep; v += vl;
      const sel = staat.gekozen && staat.gekozen[0] === r.team.id && staat.gekozen[1] === wi;
      return `<td><button class="tg-cel ${klasse(gep, vl)}${sel ? ' gekozen' : ''}" data-tgcel="${ri}|${wi}"
        aria-label="${esc(r.team.naam || '')} week ${data.weken[wi].nr}: ${vl} van ${gep}">${gep ? `${vl}/${gep}` : '—'}</button></td>`;
    }).join('');
    const p = g ? Math.round(100 * v / g) : null;
    const sub = r.momenten.length ? r.momenten.map(m => DAG[m.dag]).join(' + ') + (r.momenten[0].start ? ` · ${r.momenten[0].start}` : '') : 'geen trainingsdagen';
    return `<tr><td class="tg-tn">${esc(r.team.naam || 'Team')}<span>${esc(sub)}</span></td>${cellen}
      <td class="tg-pct" style="color:${p == null ? 'var(--ink-2)' : pctKleur(p)}">${p == null ? '—' : p + '%'}</td></tr>`;
  }).join('');
  return `<div class="tg-rooster"><table class="tg-tab"><thead>${kop}</thead><tbody>${rijen}</tbody></table></div>`;
}

const OPEN_LABEL = { '3':['ok','2+ dagen vooruit'], '1':['ok','dag ervoor'], '0':['warn','dag zelf'], 'l':['warn','pas na de training'], 'x':['mis','niet geopend'], 'g':['grijs','geen oefenstof'] };
const PRES_TEKST = { t:'tijdens de training', z:'na de training', n:'later nagetypt', d:'op de dag zelf', v:'vastgelegd' };

function htmlDetail(data){
  if (!staat.gekozen) return `<div class="inz-sub tg-hint">Tik een vak om per training te zien welke oefenstof wanneer is geopend en wanneer de presentie is ingevuld.</div>`;
  const [teamId, wi] = staat.gekozen;
  const r = data.rijen.find(x => x.team.id === teamId);
  const w = data.weken[wi];
  if (!r || !w) return '';
  const trs = r.perWeek[wi] || [];
  const regels = trs.map(x => {
    const kop = `<div class="tg-dt">${esc(kortDatum(x.iso))}${x.start ? `<small>${esc(x.start)}${x.eind ? '–' + esc(x.eind) : ''}</small>` : ''}</div>`;
    if (x.pres === '-') return `<div class="tg-tr">${kop}<div class="tg-m">Afgelast</div><span class="tg-pil grijs">vrij</span></div>`;
    const titel = x.stof ? esc(x.stof.titel || x.stof.bestandsnaam || 'Training') : 'Geen oefenstof voor deze training';
    const openTxt = x.open === 'g' ? '' : x.openMs
      ? `Oefenstof eerst geopend ${esc(kortDatum(isoVan(new Date(x.openMs))))} ${tijdVan(x.openMs)}${x.aantal > 1 ? ` · ${x.aantal}× geopend` : ''}`
      : 'Oefenstof niet geopend';
    const presTxt = PRES_OK.has(x.pres)
      ? `Presentie ${PRES_TEKST[x.pres]}${x.presMs ? ` (${x.pres === 'n' ? esc(kortDatum(isoVan(new Date(x.presMs)))) + ' ' : ''}${tijdVan(x.presMs)})` : ''}`
      : 'Geen presentie ingevuld';
    const [kl, lab] = OPEN_LABEL[x.open];
    return `<div class="tg-tr">${kop}<div class="tg-m"><b>${titel}</b>${x.extra ? ' <span class="tg-extra">extra training</span>' : ''}
      ${openTxt ? `<span>${openTxt}</span>` : ''}<span class="${PRES_OK.has(x.pres) ? '' : 'mis'}">${presTxt}</span></div>
      <span class="tg-pil ${kl}">${lab}</span></div>`;
  }).join('');
  return `<h4 class="tg-dkop">${esc(r.team.naam || 'Team')} · week ${w.nr}</h4>${regels || '<div class="inz-sub">Geen trainingen in deze week.</div>'}`;
}

function balk(tel, volgorde){
  const tot = volgorde.reduce((a, [k]) => a + (tel[k] || 0), 0);
  if (!tot) return '<div class="tg-balk leeg"><span>geen data</span></div>';
  return `<div class="tg-balk">${volgorde.map(([k, kl]) => tel[k]
    ? `<div class="${kl}" style="width:${100 * tel[k] / tot}%">${Math.round(100 * tel[k] / tot)}%</div>` : '').join('')}</div>`;
}
function htmlVerdeling(data){
  const open = data.rijen.map(r => {
    const c = {}; r.perWeek.flat().forEach(x => { if (x.pres !== '-' && x.open !== 'g'){ const k = x.open === 'l' ? 'x' : x.open; c[k] = (c[k] || 0) + 1; } });
    return `<div class="tg-vrij"><div class="tg-vn">${esc(r.team.naam || 'Team')}</div>${balk(c, [['3','s1'],['1','s2'],['0','s3'],['x','s4']])}</div>`;
  }).join('');
  const pres = data.rijen.map(r => {
    const c = {}; r.perWeek.flat().forEach(x => { const k = x.pres === 'd' ? 't' : x.pres; if (k !== '-') c[k] = (c[k] || 0) + 1; });
    return `<div class="tg-vrij"><div class="tg-vn">${esc(r.team.naam || 'Team')}</div>${balk(c, [['t','s1'],['z','s2'],['n','s3'],['x','s4']])}</div>`;
  }).join('');
  const leg = items => `<div class="inz-legenda">${items.map(([kl, l]) => `<span><i class="tg-${kl}"></i>${l}</span>`).join('')}</div>`;
  return `
    <div class="kaart">
      <div class="sectie-kop">Wanneer openen ze de oefenstof?</div>
      <div class="inz-sub">Eerste keer geopend, t.o.v. de trainingsdag waar de training bij hoort</div>
      ${open}
      ${leg([['s1','2+ dagen vooruit'],['s2','de dag ervoor'],['s3','op de dag zelf'],['s4','pas erna of niet']])}
    </div>
    <div class="kaart">
      <div class="sectie-kop">Wanneer vullen ze presentie in?</div>
      <div class="inz-sub">Moment van vastleggen t.o.v. de trainingstijd uit teambeheer</div>
      ${pres}
      ${leg([['s1','op de trainingsdag, tijdens'],['s2','zelfde dag erna'],['s3','later nagetypt'],['s4','niet ingevuld']])}
    </div>`;
}

/* Eenmalig: eerdere openingen aanvullen uit de gelezen-markeringen per coach
   (Cloud Function trainingOpeningenAanvullen). Alleen voor clubadmins, en
   alleen zolang het nog niet gedaan is. */
const magAanvullen = () => S.club?.admins?.[S.user?.uid] === true && !S.club?.trainingOpeningenAangevuld;
function htmlAanvullen(){
  if (!magAanvullen()) return '';
  return `<div class="kaart tg-aanvul">
    <div class="sectie-kop">Eerdere openingen aanvullen</div>
    <div class="inz-sub">Openingen worden per team bijgehouden sinds 12 november 2026. Van daarvoor weet Cluppie per coach alleen wanneer hij een training voor het eerst opende. Vul die eenmalig aan, dan zie je ook de afgelopen weken. Herhaald openen is van daarvoor niet bekend.</div>
    <button class="knop" id="tgAanvul">Openingen aanvullen</button>
    <div class="inz-sub tg-aanvul-status" id="tgAanvulStatus" hidden></div>
  </div>`;
}

function htmlTab(data, groepen){
  const legenda = staat.modus === 'pres'
    ? [['vol','alles ingevuld'],['deel','deels'],['nul','niets ingevuld'],['geen','geen training']]
    : [['vol','alle oefenstof geopend'],['deel','deels'],['nul','niets geopend'],['geen','geen oefenstof']];
  return `
    ${htmlAanvullen()}
    ${htmlFilters(groepen)}
    ${htmlKpis(data)}
    <div class="kaart">
      <div class="sectie-kop">Per week</div>
      <div class="segment segment-sub tg-modus">
        <button data-tgmodus="pres" class="${staat.modus === 'pres' ? 'actief' : ''}">Presentie ingevuld</button>
        <button data-tgmodus="open" class="${staat.modus === 'open' ? 'actief' : ''}">Oefenstof geopend</button>
      </div>
      <div class="inz-sub tg-uitleg">${staat.modus === 'pres'
        ? 'Trainingen met presentie in Cluppie, t.o.v. de trainingsdagen van het team.'
        : 'Trainingen waarvan de oefenstof vóór of op de trainingsdag is geopend.'}</div>
      ${htmlRooster(data)}
      <div class="inz-legenda">${legenda.map(([k, l]) => `<span><i class="tg-c-${k}"></i>${l}</span>`).join('')}</div>
      <div class="tg-detail">${htmlDetail(data)}</div>
    </div>
    ${htmlVerdeling(data)}
    <div class="inz-sub tg-voet">Alleen teamniveau, zonder namen. Oefenstof-openingen worden bijgehouden sinds 12 november 2026; afgelaste dagen tellen niet mee.</div>`;
}

/* ---------- publiek: vul de tab-container ---------- */
export async function vulTrainingsgebruik(bak, alleTeams){
  if (!bak) return;
  const teams = (alleTeams || []).filter(t => t && t.id && !/test/i.test(t.naam || ''));
  bak.innerHTML = '<div class="kaart u-tc"><div class="inz-sub" style="margin:0">Trainingsgebruik laden…</div></div>';
  let ruw;
  try { ruw = await ophalen(teams); }
  catch(e){
    bak.innerHTML = `<div class="kaart"><div class="inz-sub" style="margin:0">Laden mislukt: ${esc(e?.code || e?.message || 'onbekende fout')}. Probeer het later opnieuw.</div></div>`;
    return;
  }
  if (!bak.isConnected) return;
  const groepen = bouwGroepen(teams);
  const teken = () => {
    const groep = groepen.find(g => g.id === staat.bouw);
    if (!groep) staat.bouw = 'alle';
    const zicht = groep ? groep.teams : teams;
    const data = bouwData(ruw, zicht);
    bak.innerHTML = htmlTab(data, groepen);
    bak.querySelectorAll('[data-tgweken]').forEach(b => b.onclick = () => { staat.weken = +b.dataset.tgweken; staat.gekozen = null; teken(); });
    bak.querySelectorAll('[data-tgbouw]').forEach(b => b.onclick = () => { staat.bouw = b.dataset.tgbouw; staat.gekozen = null; teken(); });
    bak.querySelectorAll('[data-tgmodus]').forEach(b => b.onclick = () => { staat.modus = b.dataset.tgmodus; teken(); });
    const aanvul = bak.querySelector('#tgAanvul');
    if (aanvul) aanvul.onclick = async () => {
      const status = bak.querySelector('#tgAanvulStatus');
      aanvul.disabled = true; aanvul.textContent = 'Bezig met aanvullen…';
      try {
        const res = await httpsCallable(functions, 'trainingOpeningenAanvullen')({ clubId: S.clubId });
        const r = res?.data || {};
        cache = null;
        ruw = await ophalen(teams);
        if (S.club) S.club.trainingOpeningenAangevuld = true;
        teken();
        const melding = bak.querySelector('.tg-voet');
        if (melding) melding.textContent = `Aangevuld: ${r.trainingen || 0} trainingen bij ${r.teams || 0} teams. Alleen teamniveau, zonder namen; afgelaste dagen tellen niet mee.`;
      } catch (e) {
        aanvul.disabled = false; aanvul.textContent = 'Openingen aanvullen';
        const code = e?.code || '';
        status.hidden = false;
        status.textContent = code.includes('not-found') || code.includes('internal') || code.includes('unavailable')
          ? 'Aanvullen lukt nog niet: de functie trainingOpeningenAanvullen staat nog niet online (zie functions-voorstel in de repo).'
          : code.includes('permission-denied') ? 'Alleen een clubbeheerder kan dit starten.'
          : `Aanvullen mislukt: ${e?.message || code || 'onbekende fout'}`;
      }
    };
    bak.querySelectorAll('[data-tgcel]').forEach(b => b.onclick = () => {
      const [ri, wi] = b.dataset.tgcel.split('|').map(Number);
      const id = data.rijen[ri]?.team.id;
      staat.gekozen = (staat.gekozen && staat.gekozen[0] === id && staat.gekozen[1] === wi) ? null : [id, wi];
      bak.querySelectorAll('.tg-cel.gekozen').forEach(c => c.classList.remove('gekozen'));
      if (staat.gekozen) b.classList.add('gekozen');
      const det = bak.querySelector('.tg-detail');
      if (det){ det.innerHTML = htmlDetail(data); if (staat.gekozen) det.scrollIntoView({ block:'nearest', behavior:'smooth' }); }
    });
  };
  teken();
}
