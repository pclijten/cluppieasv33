/* ==================== NU-SCHERM (team-hub) ====================
   Bovenaan de team-hub: wat een coach op dit moment als eerste nodig heeft.
   De keuze (training, wedstrijddag, live, na afloop, avond ervoor, rust)
   komt uit nu-context.js; dit bestand vertaalt de echte teamdata daarheen
   en tekent de kaart plus een uitklapbare "Daarna"-lijst.

   Bronnen (alleen lezen, niets wordt hier opgeslagen):
     S.team            trainingsmomenten, vasteAfmeldingen, afgelast
     S.wedstrijden     datum, aftrap, tegenstander, thuis, periodes, kwartduur,
                       kwarten{n:{klok,lineup}}, goals[], selectie, afwezigRedenen, telaat
     S.presentie       records per trainingsdatum {datum, afwezig[], telaat[], afwezigRedenen{}}
     S.trainingen      oefenstof met plan{naam,blok,weken}, blokWeek, trainingNr, weekStart, doelen[]
   Acties gaan naar de bestaande schermen: het presentievenster van
   teams-training.js, de wedstrijdpresentie in de hub en de wedstrijd zelf.
   Geen locatie/GPS: dat vraagt toestemming en hoort niet ongevraagd in de app.
   Wel de wedstrijdplek: sportpark met routelink (uit), veld en kleedkamer. */
import { S, esc } from './state.js?v=20261106r';
import { ico } from './icons.js?v=20261106r';
import { afwezigRedenInfo, isoWeek } from './config.js?v=20261106r';
import { bepaalNu, evenementen } from './nu-context.js?v=20261106r';
import { momentenVanTeam } from './trainingsmomenten.js?v=20261106r';
import { vastePrefill } from './vaste-afmeldingen.js?v=20261106r';
import { doelTeksten, samenvattingNu, haalSamenvatting } from './doel-samenvatting.js?v=20261106r';

const p2 = n => String(n).padStart(2, '0');
const isoVan = d => `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`;
const hhmm = d => `${p2(d.getHours())}:${p2(d.getMinutes())}`;
const DAG_LANG = ['zondag', 'maandag', 'dinsdag', 'woensdag', 'donderdag', 'vrijdag', 'zaterdag'];
const DAG_KORT = ['zo', 'ma', 'di', 'wo', 'do', 'vr', 'za'];
const hoofd = s => s.charAt(0).toUpperCase() + s.slice(1);

function over(min){
  if (min <= 0) return 'nu';
  if (min < 60) return `over ${min} min`;
  if (min < 48 * 60){ const u = Math.floor(min / 60), m = min % 60; return m ? `over ${u} u ${m} min` : `over ${u} uur`; }
  return `over ${Math.round(min / 1440)} dagen`;
}
function dagLabel(datum, nu){
  const d = new Date(datum + 'T12:00');
  if (datum === isoVan(nu)) return 'Vandaag';
  if (datum === isoVan(new Date(nu.getFullYear(), nu.getMonth(), nu.getDate() + 1, 12))) return 'Morgen';
  return `${hoofd(DAG_KORT[d.getDay()])} ${d.getDate()}/${d.getMonth() + 1}`;
}
const naamVan = pid => S.spelers.find(p => p.id === pid)?.naam || null;

/* ---------- wedstrijden: van het echte document naar de vorm van nu-context ---------- */
const periodeNrs = w => Array.from({ length: Math.max(1, Number(w.periodes) || 4) }, (_, i) => String(i + 1));
function klokStaat(w){
  const nrs = periodeNrs(w), duur = (Number(w.kwartduur) || 0) * 60;
  const kl = nrs.map(n => w.kwarten?.[n]?.klok).filter(Boolean);
  const gestart = kl.some(k => k.running || (k.base || 0) > 0);
  const laatste = w.kwarten?.[nrs[nrs.length - 1]]?.klok;
  const klaar = !!(laatste && !laatste.running && duur && (laatste.base || 0) >= duur);
  const bezigNr = nrs.find(n => w.kwarten?.[n]?.klok?.running) || null;
  return { gestart, klaar, bezigNr };
}
function stand(w){
  const g = Array.isArray(w.goals) ? w.goals : [];
  const voor = g.filter(x => x && x.type !== 'tegen').length, tegen = g.filter(x => x && x.type === 'tegen').length;
  return w.thuis ? [voor, tegen] : [tegen, voor];
}
export function opstellingKlaar(w){
  const nrs = periodeNrs(w);
  return { klaar: nrs.filter(n => Object.keys(w.kwarten?.[n]?.lineup || {}).length).length, totaal: nrs.length };
}
function selectieVan(w){
  if (Array.isArray(w.selectie) && w.selectie.length) return new Set(w.selectie);
  return new Set(S.spelers.map(p => p.id));
}
function naarContext(w, vandaag, nu){
  const st = klokStaat(w);
  let duur = Math.round((Number(w.periodes) || 4) * (Number(w.kwartduur) || 0)) + 10;
  if (duur <= 10) duur = 70;
  /* Uitgespeeld vandaag (laatste periode vol)? Dan telt de wedstrijd als net
     afgelopen, ook als dat eerder is dan de geplande eindtijd: de kaart springt
     van "Live" naar "Wedstrijd afgelopen". */
  if (st.klaar && w.datum === vandaag && w.aftrap){
    const [u, m] = w.aftrap.split(':').map(Number);
    const sinds = Math.round((nu - new Date(nu.getFullYear(), nu.getMonth(), nu.getDate(), u, m)) / 60000);
    if (sinds > 1) duur = Math.min(duur, sinds - 1);
  }
  return { id: w.id, datum: w.datum, aftrap: w.aftrap || '', tegenstander: w.tegenstander || 'Tegenstander',
    thuis: !!w.thuis, duur, gestart: st.gestart && !st.klaar, afgerond: w.datum < vandaag, _w: w };
}

/* ---------- presentie: training (record of vaste afmeldingen) en wedstrijd ---------- */
function presentieTraining(datum){
  const rec = S.presentie.find(p => p.datum === datum) || null;
  const ids = S.spelers.map(p => p.id);
  let afwezig, redenen, laat, vast = false;
  if (rec){ afwezig = rec.afwezig || []; redenen = rec.afwezigRedenen || {}; laat = rec.telaat || []; }
  else { const pf = vastePrefill(S.team, datum, ids); afwezig = pf.afwezig; redenen = pf.redenen; laat = []; vast = afwezig.length > 0; }
  return { rec, afwezig, redenen, laat, vast, totaal: ids.length };
}
export function presentieWedstrijd(w){
  const sel = selectieVan(w), redenen = w.afwezigRedenen || {};
  const afwezig = S.spelers.filter(p => !sel.has(p.id) && redenen[p.id]).map(p => p.id);
  const nietMeeIds = S.spelers.filter(p => !sel.has(p.id) && !redenen[p.id]).map(p => p.id);
  return { afwezig, redenen, laat: (w.telaat || []).filter(id => sel.has(id)), ja: sel.size, totaal: S.spelers.length, nietMee: nietMeeIds.length, nietMeeIds };
}
function nietMeeTekst(p){
  const namen = (p.nietMeeIds || []).map(naamVan).filter(Boolean).map(esc);
  return namen.length ? `Niet in de selectie: ${namen.join(', ')}` : `${p.nietMee} niet in de selectie`;
}
export function afwezigTekst(afwezig, redenen){
  return afwezig.map(id => { const n = naamVan(id); if (!n) return null; const i = afwezigRedenInfo(redenen[id]);
    return esc(n) + (i ? ` (${esc(i.label.toLowerCase())})` : ''); }).filter(Boolean).join(', ');
}

/* ---------- oefenstof van een trainingsdatum: dezelfde regel als Oefenstof ---------- */
function weekNrUit(s){ const m = String(s || '').match(/\b([1-9]|[1-4]\d|5[0-3])\b/); return m ? +m[1] : null; }
function trainingVan(datum){
  const d = new Date(datum + 'T12:00'), wk = isoWeek(d);
  const maandag = isoVan(new Date(d.getFullYear(), d.getMonth(), d.getDate() - ((d.getDay() + 6) % 7), 12));
  const items = (S.trainingen || []).filter(t => (t.teams || []).includes(S.teamId))
    .filter(t => /^\d{4}-\d{2}-\d{2}$/.test(t.weekStart || '') ? t.weekStart === maandag : weekNrUit(t.week) === wk)
    .sort((a, b) => ((a.plan?.id && a.plan.id === b.plan?.id) ? (a.trainingNr || 0) - (b.trainingNr || 0) : 0) || (a.gemaakt?.seconds || 0) - (b.gemaakt?.seconds || 0));
  if (!items.length) return null;
  const dagen = momentenVanTeam(S.team).map(m => m.dag);
  const idx = Math.max(0, dagen.indexOf(((d.getDay() + 6) % 7) + 1));
  return items[Math.min(idx, items.length - 1)];
}

/* Knop naar de oefenstof: opent direct de training van die dag; zonder training de lijst. */
function stofKnop(datum, label, primair){
  const t = trainingVan(datum);
  return knop(label, 'training-plan', t ? `data-nu-training="${esc(t.id)}"` : 'data-nu-tab="trainingen"', primair);
}

/* ---------- bouwstenen ---------- */
const rij = (l, w) => `<div class="nu-rij"><dt>${esc(l)}</dt><dd>${w}</dd></div>`;
const feiten = (...r) => { const h = r.filter(Boolean).join(''); return h ? `<dl class="nu-feiten">${h}</dl>` : ''; };
const meta = (...d) => `<p class="nu-meta">${d.filter(Boolean).map(x => `<span>${x}</span>`).join('')}</p>`;
const tag = (t, soort) => `<span class="nu-tag nu-tag-${soort}" role="status">${esc(t)}</span>`;
const kop = (...d) => `<div class="nu-kaart-kop">${d.join('')}</div>`;
const titel = t => `<h2 class="nu-titel">${t}</h2>`;
const acties = (...k) => `<div class="nu-acties">${k.filter(Boolean).join('')}</div>`;
const knop = (tekst, icoon, attr, primair) =>
  `<button type="button" class="knop vol ${primair ? 'fluo' : 'licht'}" ${attr}>${icoon ? ico(icoon, 20) : ''}${esc(tekst)}</button>`;
/* [20261106t] Wedstrijdkaarten: twee rustige knoppen naast elkaar, voorbereiding
   (wedstrijd-voorbereiding.js) en opstelling (de wedstrijd zelf). */
const wedKnoppen = w => `<div class="nu-acties nu-acties-duo">${
  knop('Voorbereiding', 'match-opponent', `data-nu-voorbereiding="${esc(w.id)}"`, false)}${
  knop('Opstelling', 'football-lineup', `data-nu-wedstrijd="${esc(w.id)}"`, false)}</div>`;
/* Waar speelt het team: sportpark met route (uit), plus veld en kleedkamer (thuis en uit).
   Locatie, plaats, veld (slVeld) en kleedkamer (slKleedkamer) komen uit Sportlink; wat de coach
   bij Wijzig opzet invult (adres, veld, kleedkamer) gaat voor. */
const metVoorvoegsel = (v, woord) => { const t = String(v || '').trim().replace(/\s+/g, ' '); return !t ? '' : /^\d+\s?[a-z]?$/i.test(t) ? `${woord} ${t}` : t.charAt(0).toUpperCase() + t.slice(1); };
const plaatsNaam = p => String(p || '').trim().toLowerCase().replace(/(^|[\s-])\S/g, m => m.toUpperCase());
export function routeUrl(w){
  const club = String(w.tegenstander || '').replace(/\s+(JO|MO|O)\d.*$/i, '').trim();
  const doel = (w.adres || '').trim() || [w.locatie, plaatsNaam(w.plaats) || club].map(x => String(x || '').trim()).filter(Boolean).join(' ');
  return doel ? 'https://www.google.com/maps/dir/?api=1&destination=' + encodeURIComponent(doel) : '';
}
export function plekHtml(w){
  if (!w) return '';
  const veld = metVoorvoegsel(w.veld || w.slVeld, 'Veld'), kleed = metVoorvoegsel(w.kleedkamer || w.slKleedkamer, 'Kleedkamer');
  const naam = !w.thuis ? String(w.adres || w.locatie || '').trim() ? String(w.locatie || w.adres).trim() : '' : '';
  if (!naam && !veld && !kleed) return '';
  const url = !w.thuis ? routeUrl(w) : '';
  const pillen = [veld, kleed].filter(Boolean).map(x => `<span class="nu-plek-pil">${esc(x)}</span>`).join('');
  return `<div class="nu-plek${naam ? '' : ' alleen-pillen'}">
      <span class="nu-plek-ico">${ico('match-location', 20)}</span>
      <span class="nu-plek-tekst">${naam ? `<span class="nu-plek-naam">${esc(naam)}${w.plaats && !w.adres ? `<span class="nu-plek-plaats">${esc(plaatsNaam(w.plaats))}</span>` : ''}</span>` : ''}${pillen ? `<span class="nu-plek-pillen">${pillen}</span>` : ''}</span>
      ${url ? `<a class="nu-route" href="${esc(url)}" target="_blank" rel="noopener" aria-label="Route naar ${esc(naam)} openen in je kaarten-app">Route<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7 17L17 7"/><path d="M9 7h8v8"/></svg></a>` : ''}
    </div>`;
}
const bord = (links, rechts, a, b, klok) => `<div class="nu-bord">${klok || ''}
  <div class="nu-stand"><span class="nu-ploeg">${esc(links)}</span><b class="nu-score">${a}</b><b class="nu-score">${b}</b><span class="nu-ploeg">${esc(rechts)}</span></div></div>`;

function presKnopTraining(datum){
  const p = presentieTraining(datum), ja = p.totaal - p.afwezig.length;
  return `<button type="button" class="nu-pres" data-nu-pres-training="${datum}">
    <span class="nu-pres-getal"><b>${ja}</b> van ${p.totaal} aanwezig${p.rec ? '' : ' <span class="nu-zacht">(nog niet ingevuld)</span>'}</span>
    <span class="nu-pres-af">${p.afwezig.length ? (p.vast ? 'Vast afgemeld: ' : 'Afwezig: ') + afwezigTekst(p.afwezig, p.redenen) : (p.rec ? 'Iedereen is er' : 'Nog geen afmeldingen')}${
      p.laat.length ? `<span class="nu-pres-laat">Te laat: ${p.laat.map(naamVan).filter(Boolean).map(esc).join(', ')}</span>` : ''}</span>
    <span class="nu-pres-pijl">${ico('attendance-fill', 20)}</span></button>`;
}
function presKnopWedstrijd(w){
  const p = presentieWedstrijd(w);
  return `<button type="button" class="nu-pres" data-nu-pres-wedstrijd="${esc(w.id)}">
    <span class="nu-pres-getal"><b>${p.ja}</b> van ${p.totaal} spelen mee</span>
    <span class="nu-pres-af">${p.afwezig.length ? 'Afwezig: ' + afwezigTekst(p.afwezig, p.redenen) : (p.nietMee ? nietMeeTekst(p) : 'Iedereen kan')}${
      p.laat.length ? `<span class="nu-pres-laat">Komt later: ${p.laat.map(naamVan).filter(Boolean).map(esc).join(', ')}</span>` : ''}</span>
    <span class="nu-pres-pijl">${ico('attendance-fill', 20)}</span></button>`;
}
function oefenstofBlok(datum){
  const t = trainingVan(datum);
  if (!t) return '';
  const pl = t.plan || {};
  const wk = Number(t.blokWeek) || null, wks = Number(pl.weken) || null;
  const segs = wk && wks && wks <= 16 ? `<div class="nu-blok-balk" role="img" aria-label="Week ${wk} van ${wks}" style="--n:${wks}">${
    Array.from({ length: wks }, (_, i) => `<span class="${i + 1 < wk ? 'af' : i + 1 === wk ? 'nu' : ''}"></span>`).join('')}</div>` : '';
  const kopTekst = pl.naam ? esc(pl.naam) : pl.blok ? `Blok ${esc(pl.blok)}` : 'Oefenstof';
  const sub = [wk && wks ? `week ${wk} van ${wks}` : '', t.trainingNr ? `training ${esc(t.trainingNr)}` : ''].filter(Boolean).join(', ');
  const doelen = doelTeksten(t);
  return `<div class="nu-blok">
      <div class="nu-blok-kop"><span class="nu-blok-naam">${kopTekst}</span>${sub ? `<span class="nu-blok-wk">${sub}</span>` : ''}</div>
      ${segs}
    </div>
    ${feiten(rij('Training', `<b>${esc(t.titel || t.bestandsnaam || 'Oefenstof')}</b>`))}
    ${doelenHtml(t, doelen)}`;
}
/* Eén allesomvattend doel (AI) als regel; tik klapt de lijst met alle doelen van de training uit. */
function doelenHtml(t, doelen){
  if (!doelen.length) return '';
  const icoon = ico('football-training', 18);
  if (doelen.length === 1) return `<p class="nu-doel">${icoon}<span>${esc(doelen[0])}</span></p>`;
  const sam = samenvattingNu(t);
  if (!sam) haalSamenvatting(t).then(tekst => {
    if (!tekst) return;
    document.querySelectorAll(`[data-nu-sam="${t.id}"]`).forEach(el => { el.textContent = tekst; el.classList.remove('wacht'); });
  });
  const sleutel = 'd-' + t.id, open = (S._nuDoelOpen ||= new Set()).has(sleutel);
  return `<div class="nu-doelblok${open ? ' open' : ''}">
    <button type="button" class="nu-doel nu-doel-knop" data-nu-doel="${esc(sleutel)}" aria-expanded="${open}">
      ${icoon}<span class="nu-doel-tekst${sam ? '' : ' wacht'}" data-nu-sam="${esc(t.id)}">${esc(sam || doelen[0])}</span>
      <span class="nu-doel-pijl">${PIJL}</span></button>
    <ul class="nu-doel-lijst"${open ? '' : ' hidden'} aria-label="Alle doelen van deze training">${doelen.map(d => `<li>${esc(d)}</li>`).join('')}</ul>
  </div>`;
}
const afgelastOp = datum => { const a = S.team?.afgelast; return a && a.datum === datum ? a : null; };

/* ---------- de kaart ---------- */
function kaartHtml(c, nu){
  const e = c.event, w = e?.w?._w;
  const tot = e ? Math.round((e.start - nu) / 60000) : 0;

  if (c.soort === 'live'){
    const st = klokStaat(w), [a, b] = stand(w);
    const links = w.thuis ? S.team.naam : w.tegenstander, rechts = w.thuis ? w.tegenstander : S.team.naam;
    const klok = `<p class="nu-klok"><span class="nu-klok-sub">${st.bezigNr ? `Periode ${st.bezigNr} loopt` : st.gestart ? 'Klok staat stil' : 'Nog niet gestart'}</span></p>`;
    return `${kop(tag('Live', 'live'))}${titel(esc(w.tegenstander || 'Wedstrijd'))}
      ${bord(links, rechts, a, b, klok)}
      ${acties(knop('Open de wedstrijd', 'football-substitution', `data-nu-wedstrijd="${esc(w.id)}"`, true))}`;
  }
  if (c.soort === 'na'){
    const [a, b] = stand(w);
    return `${kop(tag('Wedstrijd afgelopen', 'ok'))}${titel('Eindstand')}
      ${bord(w.thuis ? S.team.naam : w.tegenstander, w.thuis ? w.tegenstander : S.team.naam, a, b)}
      ${acties(c.evaluatie ? knop('Evaluatie invullen', 'attendance-evaluatie', 'data-nu-tab="evaluatie"', true) : '',
        knop('Open de wedstrijd', 'football-lineup', `data-nu-wedstrijd="${esc(w.id)}"`, !c.evaluatie))}`;
  }
  if (c.soort === 'wedstrijd' || c.soort === 'dagervoor'){
    const ok = opstellingKlaar(w);
    const opst = ok.klaar === ok.totaal ? 'Klaar' : `<span class="nu-let">${ok.klaar} van ${ok.totaal} periodes</span>`;
    const label = c.soort === 'dagervoor' ? 'Morgen wedstrijd' : c.fase === 'verzamelen' ? 'Verzamelen' : 'Wedstrijddag';
    return `${kop(tag(label, 'warn'))}${titel(esc(w.tegenstander || 'Wedstrijd'))}
      ${meta(c.soort === 'dagervoor' ? `${esc(dagLabel(w.datum, nu))} ${esc(w.aftrap || '')}`.trim() : (w.aftrap ? `Aanvang ${esc(w.aftrap)}` : 'Vandaag'),
        w.thuis ? 'thuis' : 'uit', c.soort === 'wedstrijd' && w.aftrap ? `<b>${esc(over(tot))}</b>` : '')}
      ${plekHtml(w)}
      ${feiten(rij('Opstelling', opst))}
      ${presKnopWedstrijd(w)}
      ${wedKnoppen(w)}`;
  }
  if (c.soort === 'training'){
    const t = `${hhmm(e.start)} tot ${hhmm(e.eind)}`;
    if (afgelastOp(e.datum)) return `${kop(tag('Afgelast', 'warn'))}${titel(`Training ${hhmm(e.start)}`)}${meta('Deze training gaat niet door.')}
      ${acties(knop('Bekijk de melding', 'communication-announcement', 'data-nu-tab="trainingen"', false))}`;
    const label = c.fase === 'na' ? 'Training afgelopen' : c.fase === 'bezig' ? 'Training bezig' : 'Trainingsdag';
    const heeftStof = !!trainingVan(e.datum);
    return `${kop(tag(label, c.fase === 'na' ? 'ok' : c.fase === 'bezig' ? 'accent' : 'warn'))}
      ${titel(c.fase === 'na' ? 'Presentie afronden' : `Training ${hhmm(e.start)}`)}
      ${meta(t, c.fase === 'voor' ? `<b>${esc(over(tot))}</b>` : c.fase === 'bezig' ? '<b>Bezig nu</b>' : '')}
      ${oefenstofBlok(e.datum)}
      ${presKnopTraining(e.datum)}
      ${acties(c.fase === 'na'
        ? knop('Presentie afronden', 'attendance-fill', `data-nu-pres-training="${e.datum}"`, true)
        : stofKnop(e.datum, heeftStof ? 'Bekijk de oefenstof' : 'Naar oefenstof', true))}`;
  }
  /* rust: de eerstvolgende activiteit */
  if (!e){
    const zonderTijd = momentenVanTeam(S.team).some(m => !m.start);
    return `${kop(tag('Rustig', 'ok'))}${titel('Niets gepland')}
      ${meta(zonderTijd ? 'Vul de trainingstijden in bij Instellingen, dan verschijnen trainingen hier.' : 'Geen training of wedstrijd in de komende tien dagen.')}
      ${acties(knop('Planning openen', 'planning-calendar', 'data-nu-tab="planning"', false))}`;
  }
  if (e.type === 'wedstrijd'){
    const v = e.w._w;
    return `${kop(tag('Geen activiteit nu', 'ok'))}${titel('Volgende: wedstrijd')}
      ${meta(`${esc(dagLabel(v.datum, nu))} ${esc(v.aftrap || '')}`.trim(), esc(v.tegenstander || ''), v.thuis ? 'thuis' : 'uit')}
      ${plekHtml(v)}
      ${presKnopWedstrijd(v)}
      ${wedKnoppen(v)}`;
  }
  return `${kop(tag('Geen activiteit nu', 'ok'))}${titel('Volgende: training')}
    ${meta(`${esc(dagLabel(e.datum, nu))} ${hhmm(e.start)} tot ${hhmm(e.eind)}`)}
    ${oefenstofBlok(e.datum)}
    ${presKnopTraining(e.datum)}
    ${acties(stofKnop(e.datum, 'Oefenstof voorbereiden', true))}`;
}

/* ---------- Daarna: uitklapbare rijen met hetzelfde blok als op de dag zelf ---------- */
const PIJL = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M6 9l6 6 6-6"/></svg>';
function daarnaItem(e, nu){
  const sleutel = e.type === 'training' ? 't-' + e.datum : 'w-' + e.id;
  const open = (S._nuOpen ||= new Set()).has(sleutel);
  let wat, tel, inhoud;
  if (e.type === 'training'){
    const p = presentieTraining(e.datum);
    wat = afgelastOp(e.datum) ? 'Training (afgelast)' : 'Training';
    tel = `${p.totaal - p.afwezig.length}/${p.totaal}<span class="visually-hidden"> aanwezig</span>`;
    inhoud = afgelastOp(e.datum) ? meta('Deze training gaat niet door.') : `${meta(`${hhmm(e.start)} tot ${hhmm(e.eind)}`)}${oefenstofBlok(e.datum)}${presKnopTraining(e.datum)}
      ${acties(stofKnop(e.datum, 'Naar oefenstof', false))}`;
  } else {
    const w = e.w._w, p = presentieWedstrijd(w), ok = opstellingKlaar(w);
    wat = `Wedstrijd ${esc(w.tegenstander || '').replace(/-/g, '‑')}`;
    tel = `${p.ja}/${p.totaal}<span class="visually-hidden"> spelen mee</span>`;
    inhoud = `${meta(w.aftrap ? `Aanvang ${esc(w.aftrap)}` : '', w.thuis ? 'thuis' : 'uit')}
      ${plekHtml(w)}
      ${feiten(rij('Opstelling', ok.klaar === ok.totaal ? 'Klaar' : `<span class="nu-let">${ok.klaar} van ${ok.totaal} periodes</span>`))}
      ${presKnopWedstrijd(w)}
      ${wedKnoppen(w)}`;
  }
  return `<div class="nu-d-item${open ? ' open' : ''}">
    <button type="button" class="nu-rij-d" data-nu-daarna="${sleutel}" aria-expanded="${open}" aria-controls="nuD-${sleutel}">
      <span class="nu-d-dag">${esc(dagLabel(e.datum, nu))}</span><span class="nu-d-wat">${wat}</span>
      <span class="nu-d-tijd">${hhmm(e.start)}</span><span class="nu-d-tel">${tel}</span><span class="nu-d-pijl">${PIJL}</span>
    </button>
    <div class="nu-d-paneel" id="nuD-${sleutel}"><div class="nu-d-in"${open ? '' : ' hidden'}><div class="nu-d-blok">${inhoud}</div></div></div>
  </div>`;
}

/* ---------- publiek ---------- */
export function htmlNu(opties = {}){
  if (!S.team) return '';
  const nu = new Date(), vandaag = isoVan(nu);
  const team = { trainingsmomenten: momentenVanTeam(S.team).filter(m => m.start) };
  const wedstrijden = (S.wedstrijden || []).filter(w => w.datum && w.aftrap).map(w => naarContext(w, vandaag, nu));
  const presentie = Object.fromEntries((S.presentie || []).map(p => [p.datum, { afgerond: true }]));
  let c;
  try { c = bepaalNu({ nu, team, wedstrijden, presentie, plek: 'onbekend' }); }
  catch (err) { console.warn('[nu] kon de kaart niet bepalen', err); return ''; }
  c.evaluatie = !!opties.evaluatie;
  const live = c.soort === 'live' || (c.soort === 'wedstrijd' && c.fase === 'verzamelen');
  return `<section class="nu-blokje" aria-label="Nu">
    <div class="nu-kaart${live ? ' nu-s-live' : ''}">${kaartHtml(c, nu)}</div>
    ${c.daarna.length ? `<h2 class="nu-sectiekop">Daarna</h2><div class="nu-daarna">${c.daarna.map(e => daarnaItem(e, nu)).join('')}</div>` : ''}
  </section>`;
}

/* Klikken in het Nu-blok. ctx levert wat in teams.js woont (tabwissel, opnieuw tekenen). */
export function koppelNu(v, ctx){
  const blok = v.querySelector('.nu-blokje');
  if (!blok) return;
  blok.addEventListener('click', async ev => {
    const dk = ev.target.closest('[data-nu-doel]');
    if (dk){
      const sl = dk.dataset.nuDoel, open = !(S._nuDoelOpen ||= new Set()).has(sl);
      open ? S._nuDoelOpen.add(sl) : S._nuDoelOpen.delete(sl);
      blok.querySelectorAll('[data-nu-doel]').forEach(b => {
        if (b.dataset.nuDoel !== sl) return;
        b.setAttribute('aria-expanded', String(open));
        const bl = b.closest('.nu-doelblok'); bl.classList.toggle('open', open); bl.querySelector('.nu-doel-lijst').hidden = !open;
      });
      return;
    }
    const d = ev.target.closest('[data-nu-daarna]');
    if (d){
      const item = d.closest('.nu-d-item'), inhoud = item.querySelector('.nu-d-in'), paneel = item.querySelector('.nu-d-paneel');
      const open = !S._nuOpen.has(d.dataset.nuDaarna);
      open ? S._nuOpen.add(d.dataset.nuDaarna) : S._nuOpen.delete(d.dataset.nuDaarna);
      d.setAttribute('aria-expanded', String(open));
      clearTimeout(item._dicht);
      if (open){ inhoud.hidden = false; void paneel.offsetHeight; item.classList.add('open'); }
      else { item.classList.remove('open'); item._dicht = setTimeout(() => { if (!S._nuOpen.has(d.dataset.nuDaarna)) inhoud.hidden = true; }, 320); }
      return;
    }
    const pt = ev.target.closest('[data-nu-pres-training]');
    if (pt){
      const datum = pt.dataset.nuPresTraining, rec = S.presentie.find(p => p.datum === datum) || null;
      const m = await import('./teams-training.js?v=20261106r');
      m.modalPresentie(rec, rec ? {} : { datum });
      return;
    }
    const pw = ev.target.closest('[data-nu-pres-wedstrijd]');
    if (pw){ S._presWedstrijdId = pw.dataset.nuPresWedstrijd; ctx.zetTeamTab('preswedstrijd'); return; }
    const vb = ev.target.closest('[data-nu-voorbereiding]');
    if (vb){ const m = await import('./wedstrijd-voorbereiding.js?v=20261106u'); m.openVoorbereiding(vb.dataset.nuVoorbereiding, ctx); return; }
    const w = ev.target.closest('[data-nu-wedstrijd]');
    if (w){ const m = await import('./wedstrijd.js?v=20261106u'); m.openWedstrijd(w.dataset.nuWedstrijd); return; }
    const tr = ev.target.closest('[data-nu-training]');
    if (tr){
      const gelukt = ctx.openTraining ? await ctx.openTraining(tr.dataset.nuTraining) : false;
      if (!gelukt) ctx.zetTeamTab('trainingen');
      return;
    }
    const t = ev.target.closest('[data-nu-tab]');
    if (t){ ctx.zetTeamTab(t.dataset.nuTab); }
  });
  /* Elke minuut bijwerken zolang de hub open staat (aftellen, live, fase). */
  clearInterval(S._nuTik);
  S._nuTik = setInterval(() => {
    const oud = document.querySelector('.nu-blokje');
    if (!oud || S.teamTab !== 'hub'){ clearInterval(S._nuTik); return; }
    if (oud.contains(document.activeElement)) return;   // niet onder iemands vinger verversen
    const tmp = document.createElement('div'); tmp.innerHTML = htmlNu({ evaluatie: ctx.evaluatie });
    const nieuw = tmp.firstElementChild; if (!nieuw) return;
    oud.replaceWith(nieuw); koppelNu(nieuw.parentElement, ctx);
  }, 60000);
}
