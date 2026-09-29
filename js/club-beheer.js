/* ==================== CLUBBEHEER: TEAMS · TEAMBEHEER · COACHES ====================
   [20260929a] Herindeling van het admin-deel van de club. Voorheen één teamlijst
   met vier losse icoonknoppen (dagen / modules / Sportlink / uitnodigen) en
   geen zicht op coaches of op welke onderdelen aan of uit stonden.
   Nu:
     • Teams — overzicht per bouw met coaches bij naam en status-labels
       (trainingsdagen, Sportlink, onderdelen uit), filters per bouw en
       "Aandacht"; plus een tabel Onderdelen (alle teams × alle onderdelen).
     • Teambeheer — alles van één team op één scherm.
     • Coaches — alle coaches met hun teams en rollen.
   Opslag: niets nieuws. Onderdelen worden nu per sleutel geschreven
   (modules.<sleutel>), zodat een onderdeel dat hier niet getoond wordt nooit
   per ongeluk wordt overschreven. Dit bestand importeert niets uit club.js
   (geen kringimport): club.js geeft een api-object mee. */
import { db, doc, updateDoc } from './firebase.js?v=20260922c';
import { S, esc, meld } from './state.js?v=20260922c';
import { BOUWEN } from './config.js?v=20260922c';
import { ico } from './icons.js?v=20260922c';
import { eigenBouwenVanTeam, bouwVanTeam, ALLEEN_EIGEN } from './bouw-indeling.js?v=20260929a';

/* [sleutel, naam, kort, icoon, uitleg] — 'lijstjes' was eerder niet door de beheerder te regelen */
export const MODULE_DEFS = [
  ['evaluaties', 'Evaluaties', 'Eval',  'stats-bars',        'Stats-tabblad en de teamevaluatie na de wedstrijd.'],
  ['leerlijn',   'Leerlijn',   'Leer',  'football-training', 'Leerlijn-tabblad bij spelers, met thema-achtergrond en leerpunten.'],
  ['kompas',     'ASV-kompas', 'Tip',   'map',               'Wekelijkse beleidsplan-tip op de Training-tab. Aanbevolen om aan te laten.'],
  ['leerplein',  'Leerplein',  'Plein', 'football-tactics',  'Uitleg en voorbeeld-loopacties per leerthema op het tactiekbord.'],
  ['lijstjes',   'Lijstjes',   'Lijst', 'attendance-fill',   'Lijstjes voor aanwezigheid, kledingmaten en ouderhulp.'],
];
const DAG_KORT = ['Ma','Di','Wo','Do','Vr','Za','Zo'];
const DAG_LANG = ['maandag','dinsdag','woensdag','donderdag','vrijdag','zaterdag','zondag'];
export const BOUW_KLEUR = { onder:'#35c47a', midden:'#3b82f6', boven:'#a855f7' };

const aan = (t, k) => t?.modules?.[k] !== false;
const naamKort = n => String(n || 'Coach').split('@')[0];
export function twee(n){ const w = String(n || '?').trim().split(/\s+/).filter(Boolean); return ((w[0]?.[0] || '?') + (w.length > 1 ? w[w.length - 1][0] : '')).toUpperCase(); }
export function coachesVanTeam(t){
  return Object.keys(t?.leden || {}).filter(u => t.leden[u] === true)
    .map(u => ({ uid:u, naam: naamKort(t.ledenInfo?.[u]?.naam) }))
    .sort((a, b) => a.naam.localeCompare(b.naam, 'nl'));
}
function eigenBouwen(){ return Array.isArray(S.club?.eigenBouwen) ? S.club.eigenBouwen.filter(b => b && b.id) : []; }
function sorteer(teams){ return [...teams].sort((a, b) => (a.naam || '').localeCompare(b.naam || '', 'nl', { numeric:true })); }

/* Sportlink-status van één team: 'ok' | 'nee' (niet gevonden) | 'fout' | 'nog' (nog niet gesynct) | 'geen' (club niet gekoppeld) */
export function slStatus(t, sync){
  if (!S.club?.sportlinkClientId) return 'geen';
  const st = sync?.[t.id];
  if (!st) return 'nog';
  if (st.laatsteFout) return 'fout';
  if (st.gematcht) return 'ok';
  return st.laatsteSync ? 'nee' : 'nog';
}
/* Heeft dit team aandacht nodig? (geen coach, geen trainingsdagen, Sportlink niet gevonden) */
export function aandachtRedenen(t, sync){
  const r = [];
  if (!coachesVanTeam(t).length) r.push('geen coach');
  if (!(Array.isArray(t.trainingsdagen) && t.trainingsdagen.length)) r.push('geen trainingsdagen');
  const s = sync ? slStatus(t, sync) : 'ok';
  if (s === 'nee' || s === 'fout') r.push('Sportlink');
  return r;
}

/* Groepen voor lijsten: elke standaardbouw, dan elke eigen bouw met de teams die alléén daar staan.
   Voor de filters telt elk lidmaatschap (een MO11 in Onderbouw én Meidenbouw staat in beide filters). */
export function groepen(teams){
  const std = BOUWEN.map(b => ({ id:b.id, naam:b.naam, kleur:BOUW_KLEUR[b.id], teams: sorteer(teams.filter(t => bouwVanTeam(t) === b.id)) }));
  const eigen = eigenBouwen().map(eb => ({ id:eb.id, naam:eb.naam || 'Eigen bouw', kleur:eb.kleur || 'var(--ink-2)',
    teams: sorteer(teams.filter(t => bouwVanTeam(t) === ALLEEN_EIGEN && eigenBouwenVanTeam(t)[0]?.id === eb.id)) }));
  return [...std, ...eigen].filter(g => g.teams.length);
}
function inFilter(t, filter, sync){
  if (!filter || filter === 'alle') return true;
  if (filter === 'aandacht') return aandachtRedenen(t, sync).length > 0;
  if (BOUWEN.some(b => b.id === filter)) return bouwVanTeam(t) === filter;
  return eigenBouwenVanTeam(t).some(b => b.id === filter);
}
function filterBalk(teams, sync){
  const f = S._cbFilter || 'alle';
  const knop = (id, naam, n, kleur) => `<button class="cb-filter ${f === id ? 'aan' : ''}" data-cb-filter="${esc(id)}">${kleur ? `<i style="background:${esc(kleur)}"></i>` : ''}${esc(naam)} <em>${n}</em></button>`;
  const aand = teams.filter(t => aandachtRedenen(t, sync).length).length;
  const std = BOUWEN.map(b => [b.id, b.naam.replace(/bouw$/i, ''), teams.filter(t => bouwVanTeam(t) === b.id).length, BOUW_KLEUR[b.id]]);
  const eig = eigenBouwen().map(b => [b.id, b.naam, teams.filter(t => (b.teams || []).includes(t.id)).length, b.kleur]);
  return `<div class="cb-filters">${knop('alle', 'Alle', teams.length)}${aand ? knop('aandacht', '⚠ Aandacht', aand) : ''}${[...std, ...eig].filter(x => x[2]).map(x => knop(...x)).join('')}</div>`;
}

/* ---------- Teams ---------- */
function statusChips(t, sync){
  const s = [];
  const d = Array.isArray(t.trainingsdagen) ? [...t.trainingsdagen].sort((a, b) => a - b) : [];
  s.push(d.length ? `<span class="cb-st">${ico('planning-calendar', 12)} ${d.map(n => DAG_KORT[n - 1]).filter(Boolean).join(' + ')}</span>`
                  : `<span class="cb-st let">${ico('planning-calendar', 12)} Geen trainingsdagen</span>`);
  const st = slStatus(t, sync), slNaam = String(t.sportlinkNaam || '').trim();
  if (st === 'ok') s.push(`<span class="cb-st ok">${ico('action-check', 12)} Sportlink${slNaam ? ' ↔ ' + esc(slNaam) : ''}</span>`);
  else if (st === 'nee') s.push(`<span class="cb-st let">${ico('action-warning', 12)} Sportlink niet gevonden</span>`);
  else if (st === 'fout') s.push(`<span class="cb-st let">${ico('action-warning', 12)} Sportlink-fout</span>`);
  else if (st === 'nog') s.push(`<span class="cb-st">Sportlink nog niet gesynct</span>`);
  const uit = MODULE_DEFS.filter(([k]) => !aan(t, k)).length;
  if (uit) s.push(`<span class="cb-st">${uit} onderde${uit === 1 ? 'el' : 'len'} uit</span>`);
  return s.join('');
}
function teamKaart(t, sync){
  const co = coachesVanTeam(t);
  const ook = bouwVanTeam(t) !== ALLEEN_EIGEN ? eigenBouwenVanTeam(t).map(b => b.naam) : [];
  return `<button class="cb-team" data-cb-team="${esc(t.id)}">
    <div class="cb-team-kop"><div class="cb-fmt">${esc(t.format || '?')}v${esc(t.format || '?')}</div>
      <div class="cb-team-naam">${esc(t.naam)}<small>${esc(t.categorie || '—')}${ook.length ? ' · ook in ' + esc(ook.join(', ')) : ''}</small></div>
      <span class="cb-pijl">${ico('navigation-forward', 18)}</span></div>
    <div class="cb-coaches${co.length ? '' : ' geen'}">${ico('team-coach', 15)} ${co.length ? esc(co.map(c => c.naam).join(', ')) : 'Nog geen coach — nodig iemand uit'}</div>
    <div class="cb-status">${statusChips(t, sync)}</div>
  </button>`;
}
export function htmlTeamsBeheer(teams, sync){
  const weergave = S._cbWeergave || 'overzicht';
  const lijst = teams.filter(t => inFilter(t, S._cbFilter, sync));
  const seg = `<div class="segment" style="margin-bottom:12px">
      <button class="${weergave === 'overzicht' ? 'actief' : ''}" data-cb-weergave="overzicht">${ico('team-members', 16)} Overzicht</button>
      <button class="${weergave === 'onderdelen' ? 'actief' : ''}" data-cb-weergave="onderdelen">${ico('admin-permissions', 16)} Onderdelen</button></div>`;
  if (!teams.length) return `${seg}<div class="cb-acties">${actieKnoppen(false)}</div>
    <div class="kaart leeg">Nog geen teams in deze club.<br>Maak een eerste team aan, of importeer een PDF met de teamindeling.</div>`;
  const g = groepen(lijst);
  let inhoud;
  if (weergave === 'overzicht'){
    inhoud = g.map(x => `<div class="cb-groep"><i style="background:${esc(x.kleur)}"></i><b>${esc(x.naam)}</b><span>${x.teams.length} team${x.teams.length === 1 ? '' : 's'}</span></div>
      ${x.teams.map(t => teamKaart(t, sync)).join('')}`).join('') || '<div class="kaart leeg">Geen teams in deze selectie.</div>';
  } else {
    const kop = `<div class="cb-mrij cb-mkop"><div class="cb-mnaam cb-mkoptekst">Team</div>
      ${MODULE_DEFS.map(([k, naam, kort, i]) => `<button class="cb-mkol" data-cb-kol="${k}" title="${esc(naam)}: tik om voor alle getoonde teams aan of uit te zetten">${ico(i, 18)}${esc(kort)}<span class="cb-telling">${lijst.filter(t => aan(t, k)).length}/${lijst.length}</span></button>`).join('')}</div>`;
    const rijen = g.map(x => `<div class="cb-mrij bouw"><div style="grid-column:1/-1"><i style="background:${esc(x.kleur)}"></i>${esc(x.naam)}</div></div>
      ${x.teams.map(t => `<div class="cb-mrij"><button class="cb-mnaam" data-cb-team="${esc(t.id)}">${esc(t.naam)}</button>
        ${MODULE_DEFS.map(([k, naam]) => `<button class="cb-mcel ${aan(t, k) ? 'aan' : ''}" data-cb-cel="${esc(t.id)}|${k}" aria-label="${esc(naam)} ${aan(t, k) ? 'aan' : 'uit'} voor ${esc(t.naam)}"><span></span></button>`).join('')}</div>`).join('')}`).join('');
    inhoud = `<p class="cb-legenda">Tik een vakje om een onderdeel voor dat team aan of uit te zetten; het wordt direct opgeslagen. Tik een kolomkop om het voor alle getoonde teams te doen. Uitzetten verbergt alleen de knoppen, gegevens blijven bewaard.</p>
      <div class="cb-legenda cb-legenda-iconen">${MODULE_DEFS.map(([, naam, kort]) => `<span><b>${esc(kort)}</b> ${esc(naam)}</span>`).join('')}</div>
      ${lijst.length ? `<div class="cb-matrix">${kop}${rijen}</div>` : '<div class="kaart leeg">Geen teams in deze selectie.</div>'}`;
  }
  return `${seg}${weergave === 'overzicht' ? `<div class="cb-acties">${actieKnoppen(true)}</div>` : ''}${filterBalk(teams, sync)}${inhoud}`;
}
function actieKnoppen(links){
  return `<button class="knop fluo klein" id="clubNieuwTeam">${ico('action-add', 16)} Team</button>
    <button class="knop licht klein" id="clubImporteerPDF">${ico('admin-upload', 16)} PDF</button>
    ${links ? `<button class="knop licht klein" id="clubAlleLinks">${ico('action-share', 16)} Links</button>` : ''}`;
}

/* api: { teams, herteken(), openBeheer(id), nieuwTeam(), importPdf(), alleLinks() } */
export function koppelTeamsBeheer(v, api){
  v.querySelectorAll('[data-cb-weergave]').forEach(b => b.onclick = () => { S._cbWeergave = b.dataset.cbWeergave; api.herteken(); });
  v.querySelectorAll('[data-cb-filter]').forEach(b => b.onclick = () => { S._cbFilter = b.dataset.cbFilter; api.herteken(); });
  v.querySelectorAll('[data-cb-team]').forEach(b => b.onclick = () => api.openBeheer(b.dataset.cbTeam));
  v.querySelector('#clubNieuwTeam')?.addEventListener('click', api.nieuwTeam);
  v.querySelector('#clubImporteerPDF')?.addEventListener('click', api.importPdf);
  v.querySelector('#clubAlleLinks')?.addEventListener('click', api.alleLinks);
  v.querySelectorAll('[data-cb-cel]').forEach(b => b.onclick = async () => {
    const [id, k] = b.dataset.cbCel.split('|');
    const t = api.teams.find(x => x.id === id); if (!t) return;
    const nieuw = !aan(t, k);
    b.classList.toggle('aan', nieuw); b.disabled = true;
    try { await zetModule(t, k, nieuw); meld(`${t.naam}: ${MODULE_DEFS.find(m => m[0] === k)[1]} ${nieuw ? 'aan' : 'uit'}`); api.herteken(); }
    catch(e){ b.classList.toggle('aan', !nieuw); b.disabled = false; meld('Opslaan mislukt: ' + (e.code || e.message)); }
  });
  v.querySelectorAll('[data-cb-kol]').forEach(b => b.onclick = async () => {
    const k = b.dataset.cbKol, naam = MODULE_DEFS.find(m => m[0] === k)[1];
    const lijst = api.teams.filter(t => inFilter(t, S._cbFilter, S._clubSyncStatus));
    if (!lijst.length) return;
    const nieuw = !lijst.every(t => aan(t, k));
    const wijzig = lijst.filter(t => aan(t, k) !== nieuw);
    if (!confirm(`${naam} ${nieuw ? 'aanzetten' : 'uitzetten'} voor ${wijzig.length} team${wijzig.length === 1 ? '' : 's'}?`)) return;
    const fouten = [];
    await Promise.all(wijzig.map(t => zetModule(t, k, nieuw).catch(e => fouten.push(t.naam + ': ' + (e.code || e.message)))));
    meld(fouten.length ? `${wijzig.length - fouten.length} van ${wijzig.length} opgeslagen — ${fouten[0]}` : `${naam} ${nieuw ? 'aan' : 'uit'} voor ${wijzig.length} team${wijzig.length === 1 ? '' : 's'}`);
    api.herteken();
  });
}
async function zetModule(t, k, waarde){
  await updateDoc(doc(db, 'teams', t.id), { [`modules.${k}`]: waarde });
  t.modules = { ...(t.modules || {}), [k]: waarde };
}

/* ---------- Teambeheer (één team) ---------- */
export function htmlTeamBeheer(t, sync, teams){
  if (!t) return '<div class="kaart leeg">Dit team bestaat niet meer.</div>';
  const co = coachesVanTeam(t);
  const link = location.origin + location.pathname + '?team=' + (t.code || '');
  const dagen = Array.isArray(t.trainingsdagen) ? [...t.trainingsdagen].sort((a, b) => a - b) : [];
  const st = slStatus(t, sync), s = sync?.[t.id] || {};
  const slNaam = String(t.sportlinkNaam || '').trim();
  const bouwTags = [
    ...(bouwVanTeam(t) !== ALLEEN_EIGEN ? [{ naam: BOUWEN.find(b => b.id === bouwVanTeam(t))?.naam || '?', kleur: BOUW_KLEUR[bouwVanTeam(t)] }] : []),
    ...eigenBouwenVanTeam(t).map(b => ({ naam:b.naam, kleur:b.kleur })),
  ];
  const viaBouw = (() => {
    const m = new Map();
    const std = bouwVanTeam(t);
    if (std !== ALLEEN_EIGEN) for (const u of Object.keys(S.club?.bouwCoordinatoren?.[std] || {})) if (S.club.bouwCoordinatoren[std][u] === true) m.set(u, naamKort(S.club.bouwCoordinatorenInfo?.[u]?.naam));
    for (const b of eigenBouwenVanTeam(t)) for (const u of Object.keys(b.coaches || {})) if (b.coaches[u] === true) m.set(u, naamKort(S.club.eigenBouwCoachesInfo?.[u]?.naam));
    co.forEach(c => m.delete(c.uid));
    return [...m.values()].filter(Boolean);
  })();
  const slRegel = st === 'ok' ? `<span class="cb-st ok">✓ Gematcht${s.laatsteAantal != null ? ' · ' + s.laatsteAantal + ' wedstrijd' + (s.laatsteAantal === 1 ? '' : 'en') : ''}</span>`
    : st === 'nee' ? '<span class="cb-st let">Niet gevonden in Sportlink</span>'
    : st === 'fout' ? `<span class="cb-st let">Laatste sync mislukt</span>`
    : st === 'geen' ? '<span class="cb-st">Club nog niet gekoppeld</span>' : '<span class="cb-st">Nog niet gesynct</span>';
  return `
    <div class="cb-kopblok"><div class="cb-fmt">${esc(t.format || '?')}v${esc(t.format || '?')}</div>
      <div class="cb-team-naam">${esc(t.naam)}<small>${esc(t.categorie || '—')} · teamcode ${esc(t.code || '—')}</small></div>
      <button class="knop licht klein" id="cbTeamOpenen">Team openen ›</button></div>

    <div class="cb-kaart">
      <div class="cb-kaart-kop">${ico('team-coach', 18)}<b>Coaches</b><span class="cb-telling">${co.length}</span></div>
      ${co.length ? co.map(c => `<div class="cb-persoon"><div class="cb-av">${esc(twee(c.naam))}</div><div class="cb-persoon-n">${esc(c.naam)}${c.uid === S.user?.uid ? ' <small>jij</small>' : ''}</div></div>`).join('')
        : '<p class="cb-waarschuwing">Dit team heeft nog geen coach.</p>'}
      <button class="knop licht vol klein" id="cbUitnodig" style="margin-top:10px">${ico('team-player-add', 16)} Coach uitnodigen</button>
      ${S._cbUitnodig === t.id ? `<div style="margin-top:10px"><p class="cb-uitleg" style="margin:0 0 6px">Stuur deze link naar de coach. Hij logt in met e-mail of Google en zit direct in dit team.</p>
        <div class="uitnodig-link" id="cbLink">${esc(link)}</div>
        <div class="cb-acties" style="margin:8px 0 0"><button class="knop licht klein" id="cbKopieer">${ico('action-copy', 15)} Kopiëren</button><button class="knop licht klein" id="cbWhatsapp">${ico('action-whatsapp', 15)} WhatsApp</button></div></div>` : ''}
      ${viaBouw.length ? `<p class="cb-uitleg">Ook toegang via de bouw: ${esc(viaBouw.join(', '))}.</p>` : ''}
    </div>

    <div class="cb-kaart">
      <div class="cb-kaart-kop">${ico('football-competition', 18)}<b>Naam &amp; Sportlink</b><button class="cb-link" id="cbSportlink">Wijzigen</button></div>
      <div class="cb-regel"><span class="cb-lbl">Naam in Cluppie</span><span class="cb-val">${esc(t.naam)}</span></div>
      <div class="cb-regel"><span class="cb-lbl">Sportlink-team</span><span class="cb-val">${slNaam ? esc(slNaam) : 'Automatisch op naam'}</span></div>
      <div class="cb-regel"><span class="cb-lbl">Status</span><span class="cb-val">${slRegel}</span></div>
    </div>

    <div class="cb-kaart">
      <div class="cb-kaart-kop">${ico('planning-calendar', 18)}<b>Trainingsdagen</b></div>
      <div class="dag-opties">${DAG_KORT.map((d, i) => `<button type="button" class="dag-opt ${dagen.includes(i + 1) ? 'aan' : ''}" data-cb-dag="${i + 1}">${d}</button>`).join('')}</div>
      <p class="cb-uitleg">${dagen.length ? dagen.map((d, i) => `Training ${i + 1} → ${DAG_LANG[d - 1]}`).join(' · ') + '. ' : 'Nog geen vaste dagen; oefenstof krijgt dan geen dag. '}Wordt direct opgeslagen. Coaches kunnen dit niet zelf wijzigen.</p>
    </div>

    <div class="cb-kaart">
      <div class="cb-kaart-kop">${ico('admin-permissions', 18)}<b>Onderdelen voor coaches</b></div>
      ${MODULE_DEFS.map(([k, naam, , i, uitleg]) => `<button type="button" class="cb-schakelrij" data-cb-mod="${k}">${ico(i, 20)}<div class="cb-persoon-n">${esc(naam)}<small>${esc(uitleg)}</small></div><span class="lj-schakel ${aan(t, k) ? 'aan' : ''}"></span></button>`).join('')}
      <p class="cb-uitleg">Uitzetten verbergt alleen de knoppen. Gegevens blijven bewaard en komen terug zodra je het weer aanzet.</p>
    </div>

    <div class="cb-kaart">
      <div class="cb-kaart-kop">${ico('admin-roles', 18)}<b>Bouw</b><button class="cb-link" id="cbNaarBouwen">Indelen</button></div>
      <div class="cb-tags">${bouwTags.map(b => `<span class="cb-tag"><i style="background:${esc(b.kleur || 'var(--ink-2)')}"></i>${esc(b.naam)}</span>`).join('') || '<span class="cb-tag geen">Geen bouw</span>'}</div>
      ${bouwVanTeam(t) === ALLEEN_EIGEN ? '<p class="cb-uitleg">Staat alleen in een eigen bouw, niet in Onder-, Midden- of Bovenbouw.</p>' : ''}
    </div>`;
}

/* api: { team, teams, herteken(), openTeam(id), sportlink(team), naarBouwen() } */
export function koppelTeamBeheer(v, api){
  const t = api.team; if (!t) return;
  v.querySelector('#cbTeamOpenen')?.addEventListener('click', () => api.openTeam(t.id));
  v.querySelector('#cbSportlink')?.addEventListener('click', () => api.sportlink(t));
  v.querySelector('#cbNaarBouwen')?.addEventListener('click', api.naarBouwen);
  v.querySelector('#cbUitnodig')?.addEventListener('click', () => { S._cbUitnodig = S._cbUitnodig === t.id ? null : t.id; api.herteken(); });
  v.querySelector('#cbKopieer')?.addEventListener('click', async () => {
    const tekst = v.querySelector('#cbLink')?.textContent || '';
    try { await navigator.clipboard.writeText(tekst); meld('Link gekopieerd'); } catch(e){ meld('Link: ' + tekst); }
  });
  v.querySelector('#cbWhatsapp')?.addEventListener('click', () => {
    const tekst = `Hoi! Je bent uitgenodigd als coach van ${t.naam} in Cluppie. Open deze link en log in:\n${v.querySelector('#cbLink')?.textContent || ''}`;
    window.open('https://wa.me/?text=' + encodeURIComponent(tekst), '_blank');
  });
  v.querySelectorAll('[data-cb-dag]').forEach(b => b.onclick = async () => {
    const nr = Number(b.dataset.cbDag);
    const huidig = Array.isArray(t.trainingsdagen) ? t.trainingsdagen : [];
    const dagen = (huidig.includes(nr) ? huidig.filter(x => x !== nr) : [...huidig, nr]).sort((a, c) => a - c);
    b.classList.toggle('aan');
    try { await updateDoc(doc(db, 'teams', t.id), { trainingsdagen: dagen }); t.trainingsdagen = dagen; meld('Trainingsdagen opgeslagen'); api.herteken(); }
    catch(e){ b.classList.toggle('aan'); meld('Opslaan mislukt: ' + (e.code || e.message)); }
  });
  v.querySelectorAll('[data-cb-mod]').forEach(b => b.onclick = async () => {
    const k = b.dataset.cbMod, nieuw = !aan(t, k);
    b.querySelector('.lj-schakel')?.classList.toggle('aan', nieuw);
    try { await zetModule(t, k, nieuw); meld(`${MODULE_DEFS.find(m => m[0] === k)[1]} ${nieuw ? 'aan' : 'uit'}`); }
    catch(e){ b.querySelector('.lj-schakel')?.classList.toggle('aan', !nieuw); meld('Opslaan mislukt: ' + (e.code || e.message)); }
  });
}

/* ---------- Coaches ---------- */
export function htmlCoaches(teams){
  const m = new Map();   // uid → { naam, teams:[], rollen:[] }
  const pak = (uid, naam) => { if (!m.has(uid)) m.set(uid, { uid, naam: naamKort(naam), teams:[], rollen:[] }); const e = m.get(uid); if ((!e.naam || e.naam === 'Coach') && naam) e.naam = naamKort(naam); return e; };
  for (const t of sorteer(teams)) for (const c of coachesVanTeam(t)) pak(c.uid, c.naam).teams.push(t);
  for (const [uid, a] of Object.entries(S.club?.adminsInfo || {})) pak(uid, a?.naam).rollen.push(['admin', 'Beheerder']);
  for (const b of BOUWEN) for (const uid of Object.keys(S.club?.bouwCoordinatoren?.[b.id] || {})) if (S.club.bouwCoordinatoren[b.id][uid] === true) pak(uid, S.club.bouwCoordinatorenInfo?.[uid]?.naam).rollen.push(['coord', 'Coörd. ' + b.naam]);
  for (const eb of eigenBouwen()) for (const uid of Object.keys(eb.coaches || {})) if (eb.coaches[uid] === true) pak(uid, S.club.eigenBouwCoachesInfo?.[uid]?.naam).rollen.push(['coord', eb.naam]);
  const zoek = String(S._cbZoek || '').trim().toLowerCase();
  const lijst = [...m.values()].filter(c => !zoek || c.naam.toLowerCase().includes(zoek) || c.teams.some(t => (t.naam || '').toLowerCase().includes(zoek)))
    .sort((a, b) => a.naam.localeCompare(b.naam, 'nl'));
  const zonder = sorteer(teams.filter(t => !coachesVanTeam(t).length));
  const kleurVan = t => { const b = bouwVanTeam(t); return b === ALLEEN_EIGEN ? (eigenBouwenVanTeam(t)[0]?.kleur || 'var(--ink-2)') : BOUW_KLEUR[b]; };
  return `
    ${zonder.length ? `<div class="cb-kaart cb-let">
      <div class="cb-kaart-kop" style="margin-bottom:6px"><span class="cb-let-ico">${ico('action-warning', 18)}</span><b>Teams zonder coach</b></div>
      <div class="cb-tags">${zonder.map(t => `<button class="cb-tag geen" data-cb-team="${esc(t.id)}">${esc(t.naam)} ›</button>`).join('')}</div></div>` : ''}
    <div class="cb-zoek">${ico('navigation-search', 17)}<input class="invoer" id="cbZoek" placeholder="Zoek op naam of team" value="${esc(S._cbZoek || '')}" autocomplete="off"></div>
    <div class="cb-legenda">${lijst.length} coach${lijst.length === 1 ? '' : 'es'} · tik een team om het te beheren</div>
    <div id="cbCoachLijst">${lijst.map(c => `<div class="cb-coachrij"><div class="cb-av">${esc(twee(c.naam))}</div>
      <div class="cb-persoon-n">${esc(c.naam)}${c.uid === S.user?.uid ? ' <small class="cb-inline">jij</small>' : ''} ${c.rollen.map(([k, r]) => `<span class="cb-rol ${k}">${esc(r)}</span>`).join(' ')}
        <div class="cb-tags">${c.teams.map(t => `<button class="cb-tag" data-cb-team="${esc(t.id)}"><i style="background:${esc(kleurVan(t))}"></i>${esc(t.naam)}</button>`).join('') || '<span class="cb-tag">Geen eigen team</span>'}</div></div></div>`).join('')
      || '<div class="kaart leeg">Geen coaches gevonden.</div>'}</div>`;
}
/* api: { herteken(), openBeheer(id) } */
export function koppelCoaches(v, api){
  v.querySelectorAll('[data-cb-team]').forEach(b => b.onclick = () => api.openBeheer(b.dataset.cbTeam));
  const z = v.querySelector('#cbZoek');
  if (z) z.oninput = () => {
    S._cbZoek = z.value;
    const pos = z.selectionStart;
    api.herteken();
    const n = v.querySelector('#cbZoek'); if (n){ n.focus(); try { n.setSelectionRange(pos, pos); } catch(e){} }
  };
}
