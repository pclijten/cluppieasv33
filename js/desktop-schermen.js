/* ==================== DESKTOP-SCHERMEN (paspoortstijl) ====================
   [20260922e] Stap 2 t/m 6 van de desktop-herinrichting (goedgekeurde mockup
   "zijbalk + paspoortstijl"). Alleen actief als html.desk aan staat (≥ 1100 ×
   520 px, zie desktop.js). Tekent eigen weergaven voor vijf team-tabbladen:
     hub               → Dashboard
     spelers           → Selectie (kaarten) en, met S._beoordeelProfiel, het paspoort
     wedstrijden       → lijst + detail
     presentietraining → Trainingen (lijst, opbouw, aanwezigheid, oefenstof)
     leerlijnoverzicht → Leerlijn per thema (nog niet / werkt eraan / afgerond)
   Werking: renderTeam() in teams.js vraagt eerst S._deskRenderTeam(v, tab).
   Geeft die false terug (smal scherm, ander tabblad, "Gewone weergave"
   gekozen, of een fout tijdens het tekenen), dan tekent teams.js gewoon zijn
   eigen scherm. Er wordt hier NIETS naar Firestore geschreven behalve het
   gelezen-vinkje bij het openen van oefenstof (zelfde als de oefenstof-tab);
   alle wijzigingen lopen via de bestaande modals.
   Cijfers op kaarten: niveau 1–5 → 40 + (n−1) × 14 (Aandacht 40 … Uitblinker 96),
   afgeleid uit de laatste volledige beoordeling. Alleen zichtbaar voor coaches.
========================================================================== */
import { S, $, esc, speler, modAan, meld } from './state.js?v=20260922c';
import { db, doc, setDoc, addDoc, updateDoc, deleteDoc, collection, serverTimestamp } from './firebase.js?v=20260922c';
import { SKILLS, NIVEAUS, niveauKleur, LEERCURVE, leercurveRelevant, bouwSlots, periodeNrs, isoWeek,
  TEAM_CATEGORIEEN, TEAM_TAGS, AFWEZIG_REDENEN, afwezigRedenInfo, SEIZOEN_FALLBACK, POSITIE_GROEPEN } from './config.js?v=20260922c';
import { analyseWedstrijd, speeltijdReserve, kwartGespeeld } from './analyse.js?v=20260922c';
import { teltMee } from './opkomst.js?v=20260922c';
import { ico } from './icons.js?v=20260922c';
import { renderTeam, zetTeamTab, modalTeamEvaluatie, planningItems } from './teams.js?v=20260924b';
import { evaluatieOpen, presWedstrijdKeuzes } from './teams-hub.js?v=20260924b';
import { spelerStats, meestGespeeldePosities } from './teams-spelers.js?v=20260924b';
import { bewaarTeamEvaluatie } from './teams-evaluatie.js?v=20260924b';
import { oefHtml } from './training-weergave.js?v=20260922c';
import { laadPdfJs } from './pdf-viewer.js?v=20260922c';
import { ongelezenBerichten } from './berichten.js?v=20260922c';
import { contentVoorThema } from './content.js?v=20260922c';

const TABS = new Set(['hub', 'spelers', 'wedstrijden', 'presentietraining', 'leerlijnoverzicht', 'evaluatie', 'stats', 'documenten', 'planning']);
let klassiekTab = null;          // tabblad waarvoor de coach "Gewone weergave" koos
let klassiekProfiel = null;      // speler-id waarvoor het volledige (oude) profiel open staat
let laatsteSig = '';
let selWedstrijd = null, selTraining = null, selThema = null, spFilter = 'Alle';
let spPositie = { pid:null, pos:'' };
let selDoc = null, evSel = null, evConcept = null, awOpen = null, planMaand = null, planFilter = 'alles';

/* ---------- algemene hulpjes ---------- */
/* analyseWedstrijd/speeltijdReserve rekenen met klokstanden. Een wedstrijd
   met een vooraf ingevulde opstelling maar zonder klok (nog nooit geopend)
   mag het desktopscherm nooit laten omvallen: dan telt hij gewoon als 0. */
const LEEG_ANALYSE = { tijd:{}, keeper:{}, lijn:{}, kwarten:0, matchduur:0 };
function analyse(w){ try { return analyseWedstrijd(w); } catch(e){ return LEEG_ANALYSE; } }
const isDesk = () => document.documentElement.classList.contains('desk');
const vandaagISO = () => new Date().toISOString().slice(0, 10);
const cijfer = n => Math.round(40 + (n - 1) * 14);
const gem = a => a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0;
const voornaam = p => (p?.naam || '').trim().split(' ')[0] || 'Speler';
/* [20260923a] Achternamen worden in Cluppie nergens getoond (zie modalSpeler) —
   ook niet op desktop. Deze helper geeft daarom alleen de roepnaam. */
const volledigeNaam = p => (p?.naam || '').trim() || 'Speler';
function datumMooi(iso, opt = { weekday:'long', day:'numeric', month:'short' }){
  if (!iso) return '';
  try { const s = new Date(iso + 'T12:00').toLocaleDateString('nl-NL', opt); return s.charAt(0).toUpperCase() + s.slice(1); }
  catch(e){ return iso; }
}
function kop(titel, acties = ''){
  return `<div class="dk-kop"><div class="dk-kruim">${esc(S.team?.naam || '')} / <b>${esc(titel)}</b></div>
    <div class="dk-acties">${acties}<button class="dk-knop dk-stil" data-dk="klassiek" title="Toon het gewone scherm van dit onderdeel, met alle opties">Gewone weergave</button></div></div>`;
}
const knop = (label, dk, extra = '', icoon = '') =>
  `<button class="dk-knop ${extra}" data-dk="${dk}">${icoon ? ico(icoon, 18) : ''}${esc(label)}</button>`;

/* ---------- beoordelingen → cijfers ---------- */
function volledigen(pid){ return S.beoordelingen.filter(b => b.spelerId === pid && b.soort === 'volledig'); }
function kaart(p){
  const [laatste, vorige] = volledigen(p.id);
  const niv = SKILLS.map(d => Number(laatste?.scores?.[d.id]) || null);
  const nivVorig = SKILLS.map(d => Number(vorige?.scores?.[d.id]) || null);
  const geldig = niv.filter(Boolean);
  const ovr = geldig.length ? cijfer(gem(geldig)) : null;
  const gv = nivVorig.filter(Boolean);
  const ovrVorig = gv.length ? cijfer(gem(gv)) : null;
  /* [20260923a] Geen volledige beoordeling? Dan telt het niveau van de laatste
     snelle beoordeling als kaartcijfer (label "snel"); de domeinen blijven leeg. */
  const snel = geldig.length ? null : laatsteSnel(p.id);
  const trend = volledigen(p.id).slice(0, 6).reverse()
    .map(b => { const s = SKILLS.map(d => Number(b.scores?.[d.id])).filter(Boolean); return s.length ? cijfer(gem(s)) : null; })
    .filter(x => x != null);
  return { niv, nivVorig, ovr: ovr ?? (snel ? cijfer(Number(snel.niveau)) : null), snel: !!snel, snelLabel: snel ? (NIVEAUS[Number(snel.niveau)]?.label || '') : '',
    ovrVorig, stijging: ovr != null && ovrVorig != null ? ovr - ovrVorig : 0, trend, laatste };
}
function laatsteSnel(pid){
  return S.beoordelingen.filter(b => b.spelerId === pid && b.soort === 'snel' && Number(b.niveau) >= 1)
    .sort((a, b) => (b.datum || '').localeCompare(a.datum || '') || (b.gemaaktMs || 0) - (a.gemaaktMs || 0))[0] || null;
}
const LEEG_STATS = { wedstrijden:0, goals:0, pctSpeeltijd:null, pctReserve:null, opkomst:null };
function statsVan(pid){ try { return spelerStats(pid) || LEEG_STATS; } catch(e){ return LEEG_STATS; } }
function sbBalk(naam, st, metNaam = true){
  const g = st.pctSpeeltijd, y = st.pctReserve;
  return `<div class="dk-sb ${metNaam ? '' : 'zonder'}">${metNaam ? `<span>${esc(naam)}</span>` : ''}<i>${g != null ? `<b class="g" style="width:${g}%"></b><b class="y" style="width:${y}%"></b>` : ''}</i>
    <em>${g != null ? `<b>${g}%</b> \u00b7 ${y}%` : 'nog niet'}</em></div>`;
}
const SB_LEGENDA = '<div class="dk-heat-leg"><span><i class="j"></i>gespeeld</span><span><i class="y"></i>reserve</span><span style="margin-left:auto">% van speelbare tijd</span></div>';
function statTegels(st, smal = false){
  return `<div class="dk-tegels ${smal ? 'smal' : ''}"><div><b>${st.wedstrijden}</b><small>Wedstr.</small></div>
    <div><b>${st.pctSpeeltijd != null ? st.pctSpeeltijd + '%' : '\u2013'}</b><small>Speeltijd</small><em>van speelbaar</em></div>
    <div><b>${st.pctReserve != null ? st.pctReserve + '%' : '\u2013'}</b><small>Reserve</small><em>van speelbaar</em></div>
    <div><b>${st.goals}</b><small>Goals</small></div></div>`;
}
function teamGemiddelde(){
  return SKILLS.map((d, i) => {
    const w = S.spelers.map(p => kaart(p).niv[i]).filter(Boolean);
    return w.length ? gem(w) : null;
  });
}
function seizoensMinuten(){
  let r = {};
  try { r = speeltijdReserve(S.wedstrijden || []); }
  catch(e){ try { r = speeltijdReserve((S.wedstrijden || []).filter(w => { try { analyseWedstrijd(w); return true; } catch(x){ return false; } })); } catch(x){ r = {}; } }
  const uit = {};
  for (const p of S.spelers) uit[p.id] = Math.round((r[p.id]?.speeltijd || 0) / 60);
  return uit;
}

/* ---------- wedstrijden ---------- */
function gespeeld(w){
  if ((w.goals || []).length) return true;
  if (w.datum && w.datum < vandaagISO()) return true;
  return w.datum === vandaagISO() && analyse(w).kwarten > 0;   // vandaag al begonnen
}
function komende(){ return S.wedstrijden.filter(w => !gespeeld(w) && w.datum).sort((a, b) => (a.datum + (a.aftrap||'')).localeCompare(b.datum + (b.aftrap||''))); }
function afgelopen(){ return S.wedstrijden.filter(gespeeld).sort((a, b) => (b.datum || '').localeCompare(a.datum || '')); }
function stand(w){
  const voor = (w.goals || []).filter(g => g.type === 'voor').length;
  const tegen = (w.goals || []).filter(g => g.type === 'tegen').length;
  return { voor, tegen, links: w.thuis ? voor : tegen, rechts: w.thuis ? tegen : voor };
}
function aftrapMs(w){
  const t = /^\d{1,2}:\d{2}$/.test(w.aftrap || '') ? w.aftrap : '12:00';
  return Date.parse(w.datum + 'T' + t.padStart(5, '0') + ':00');
}
function lineupKwart1(w){
  const nr = periodeNrs(w)[0];
  const k = w.kwarten?.[nr] || {};
  const slots = bouwSlots(String(w.format || S.team?.format || 8), k.formatie || w.formatie);
  return slots.map(s => ({ ...s, pid: (k.lineup || {})[s.id] || null }));
}
function kwartenKlaar(w){
  const nrs = periodeNrs(w);
  return { klaar: nrs.filter(n => Object.keys(w.kwarten?.[n]?.lineup || {}).length).length, totaal: nrs.length };
}

/* ---------- oefenstof ---------- */
function weekNrUit(t){ const m = String(t || '').match(/\b([1-9]|[1-4]\d|5[0-3])\b/); return m ? parseInt(m[1], 10) : null; }
function oefenstofTeam(){ return (S.trainingen || []).filter(t => (t.teams || []).includes(S.teamId)); }
function oefenstofWeek(week = isoWeek()){
  return oefenstofTeam().filter(t => weekNrUit(t.week) === week)
    .sort((a, b) => (a.gemaakt?.seconds || 0) - (b.gemaakt?.seconds || 0));
}
async function openOefenstof(id){
  const t = S.trainingen.find(x => x.id === id); if (!t) return;
  const datum = t.gemaakt?.seconds ? new Date(t.gemaakt.seconds * 1000).toLocaleDateString('nl-NL', { day:'numeric', month:'short' }) : '';
  const titel = t.titel || t.bestandsnaam || 'Training';
  const meta = [t.week, datum].filter(Boolean).join(' \u00b7 ');
  const origineel = async () => { const { openPdfViewer } = await import('./pdf-viewer.js?v=20260922c'); openPdfViewer({ url: t.url, titel, meta }); };
  if (Array.isArray(t.oefeningen) && t.oefeningen.length){
    const { openTrainingWeergave } = await import('./training-weergave.js?v=20260922c');
    openTrainingWeergave({ titel, meta, oefeningen: t.oefeningen, diagramUrls: t.diagramUrls || {},
      onOrigineel: t.url ? origineel : null, trainingId: id, oefeningVideos: t.oefeningVideos || {},
      oefeningTactiek: t.oefeningTactiek || {}, trainingClub: t.club || null, teamId: S.teamId,
      teamNaam: S.team?.naam || '', clubNaam: S.team?.clubNaam || '' });
  } else if (t.url) await origineel();
  if (!S.trainingenGelezen?.[id]){ try { await setDoc(doc(db, 'gebruikers', S.user.uid, 'gelezen', id), { tijd: serverTimestamp() }); } catch(e){} }
}
function stofRij(t){
  const nieuw = !S.trainingenGelezen?.[t.id];
  const ai = Array.isArray(t.oefeningen) && t.oefeningen.length;
  return `<button class="dk-stof" data-dk="stof" data-id="${esc(t.id)}"><span class="dk-stof-ico">${ai ? ico('training-exercise', 20) : 'PDF'}</span>
    <span class="dk-stof-tekst"><b>${esc(t.titel || t.bestandsnaam || 'Training')}</b><small>${esc([t.week, ai ? t.oefeningen.length + ' oefeningen' : 'PDF'].filter(Boolean).join(' \u00b7 '))}</small></span>
    ${nieuw ? '<span class="dk-pill rood">nieuw</span>' : ''}</button>`;
}

/* ---------- presentie ---------- */
function sessies(){ return [...(S.presentie || [])].filter(s => s.datum).sort((a, b) => b.datum.localeCompare(a.datum)); }
function aanwezigTel(s){ return S.spelers.filter(p => teltMee(s, p) && !(s.afwezig || []).includes(p.id)).length; }
function meetellers(s){ return S.spelers.filter(p => teltMee(s, p)).length; }
function komendeTrainingsdagen(n = 3){
  const dagen = Array.isArray(S.team?.trainingsdagen) ? S.team.trainingsdagen : [];
  const uit = []; if (!dagen.length) return uit;
  const d = new Date(); d.setHours(12, 0, 0, 0);
  for (let i = 0; i < 21 && uit.length < n; i++){
    const iso = d.toISOString().slice(0, 10);
    const dag = ((d.getDay() + 6) % 7) + 1;            // 1 = ma … 7 = zo
    if (dagen.includes(dag) && !(S.presentie || []).some(s => s.datum === iso)) uit.push(iso);
    d.setDate(d.getDate() + 1);
  }
  return uit;
}
function isoWeekVan(iso){ return isoWeek(new Date(iso + 'T12:00')); }
function oefenstofVoorDatum(iso){
  const lijst = oefenstofWeek(isoWeekVan(iso));
  if (!lijst.length) return null;
  const dagen = (Array.isArray(S.team?.trainingsdagen) ? S.team.trainingsdagen : []).slice().sort();
  const dag = ((new Date(iso + 'T12:00').getDay() + 6) % 7) + 1;
  const idx = Math.max(0, dagen.indexOf(dag));
  return lijst[Math.min(idx, lijst.length - 1)];
}

/* ---------- mini-veld ---------- */
function miniVeld(w, metKaart = false){
  const slots = w ? lineupKwart1(w) : [];
  const gevuld = slots.filter(s => s.pid && speler(s.pid));
  if (!gevuld.length) return `<div class="dk-veld dk-veld-leeg"><span>Nog geen opstelling voor ${esc(periodeNrs(w || {})[0] ? 'de eerste periode' : 'deze wedstrijd')}</span></div>`;
  return `<div class="dk-veld ${metKaart ? 'dk-veld-breed' : ''}">${gevuld.map(s => {
    const p = speler(s.pid), k = metKaart ? kaart(p) : null;
    const [x, y] = metKaart ? [100 - s.y, s.x] : [s.x, s.y];
    return metKaart
      ? `<div class="dk-mt ${s.lijn === 'K' ? 'k' : ''}" style="left:${x}%;top:${y}%"><b>${k.ovr ?? '–'}</b><span>${esc(voornaam(p))}</span><small>${esc(p.nummer ?? '')}</small></div>`
      : `<div class="dk-p ${s.lijn === 'K' ? 'k' : ''}" style="left:${x}%;top:${y}%"><b>${esc(p.nummer ?? voornaam(p).charAt(0))}</b><small>${esc(voornaam(p))}</small></div>`;
  }).join('')}</div>`;
}

/* ==================== DASHBOARD (hub) ==================== */
function htmlDashboard(){
  const w = komende()[0] || null;
  const stats = Object.fromEntries(S.spelers.map(p => [p.id, statsVan(p.id)]));
  const pctLijst = S.spelers.filter(p => stats[p.id].pctSpeeltijd != null)
    .sort((a, b) => stats[a.id].pctSpeeltijd - stats[b.id].pctSpeeltijd).slice(0, 9);
  const ses = sessies().slice(0, 8).reverse();
  const opkSp = [...S.spelers].sort((a, b) => (Number(a.nummer) || 99) - (Number(b.nummer) || 99)).slice(0, 10);
  const stof = oefenstofWeek();
  const taken = takenLijst(w);
  const kk = w ? kwartenKlaar(w) : null;
  const titel = w ? `${datumMooi(w.datum, { weekday:'long' })} ${w.thuis ? 'thuis tegen' : 'uit bij'}` : 'Geen wedstrijd gepland';
  const tegen = w ? (w.tegenstander || '').replace(/\s+(J|M)O\d+.*$/i, '') || w.tegenstander : '';
  const dagen = w ? Math.max(0, Math.round((aftrapMs(w) - Date.now()) / 86400000)) : 0;

  return `<div class="dk-scherm dk-dash">
    ${kop('Dashboard', `${knop('Presentie vandaag', 'presentie', '', 'attendance-present')}${w ? knop('Start wedstrijd', 'openw', 'rood', 'training-start').replace('data-dk="openw"', `data-dk="openw" data-id="${esc(w.id)}"`) : knop('Nieuwe wedstrijd', 'nieuwew', 'rood', 'action-add')}`)}
    <div class="dk-dash-body"><div class="dk-spook">${w ? esc(String(Number(w.datum.slice(8, 10)))) : '33'}</div>
      <div class="dk-hallo"><div><h1 class="dk-groot">${esc(titel)} ${tegen ? `<span class="dk-omlijnd">${esc(tegen)}</span>` : ''}</h1>
        <p>${w ? `Nog ${dagen === 0 ? 'vandaag' : dagen === 1 ? '1 dag' : dagen + ' dagen'}. De opstelling staat voor ${kk.klaar} van de ${kk.totaal} ${kk.totaal === 2 ? 'helften' : 'periodes'} klaar.` : 'Voeg een wedstrijd toe of wacht op de volgende Sportlink-sync.'}</p></div></div>
      ${w ? `<div class="dk-blok dk-wed">
        <div><h3>${ico('planning-calendar', 18)}Volgende wedstrijd</h3>
          <div class="dk-vs">${esc(S.team.naam)}<span>tegen</span><span class="dk-omlijnd">${esc(w.tegenstander || '')}</span></div>
          <div class="dk-pills"><span class="dk-pill">${esc(datumMooi(w.datum, { weekday:'short', day:'numeric', month:'short' }))}${w.aftrap ? ' \u00b7 ' + esc(w.aftrap) : ''}</span><span class="dk-pill">${w.thuis ? 'Thuis' : 'Uit'}</span>${w.format ? `<span class="dk-pill">${esc(w.format)} tegen ${esc(w.format)}</span>` : ''}</div>
          <div class="dk-aftel" data-dk-aftel="${aftrapMs(w)}"></div></div>
        <button class="dk-veld-knop" data-dk="openw" data-id="${esc(w.id)}" title="Wedstrijd openen">${miniVeld(w)}</button>
      </div>` : ''}
      <div class="dk-blok dk-speel"><h3>${ico('stats-bars', 18)}Speeltijd tot nu toe<span>minst gespeeld eerst</span></h3>
        ${pctLijst.length ? pctLijst.map(p => sbBalk(voornaam(p), stats[p.id])).join('') + SB_LEGENDA : '<p class="dk-leeg">Nog geen gespeelde wedstrijden met een selectie.</p>'}</div>
      <div class="dk-blok dk-opk"><h3>${ico('attendance-overview', 18)}Opkomst training<span>laatste ${ses.length}</span></h3>
        ${ses.length ? `<div class="dk-heat" style="grid-template-columns:70px repeat(${ses.length},1fr)"><span></span>${ses.map(s => `<span class="kh">${esc(datumMooi(s.datum, { weekday:'short' }).slice(0, 2).toLowerCase())}<b>${esc(s.datum.slice(8, 10) + '/' + s.datum.slice(5, 7))}</b></span>`).join('')}
          ${opkSp.map(p => `<span>${esc(voornaam(p))}</span>${ses.map(s => `<i class="${!teltMee(s, p) ? '' : (s.afwezig || []).includes(p.id) ? 'n' : 'j'}"></i>`).join('')}`).join('')}</div>
          <div class="dk-heat-leg"><span><i class="j"></i>aanwezig</span><span><i class="n"></i>afwezig</span><span><i></i>telt niet mee</span></div>` : '<p class="dk-leeg">Nog geen presentie ingevuld.</p>'}</div>
      <div class="dk-blok dk-stofblok"><h3>${ico('training-cones', 18)}Oefenstof deze week<span>week ${isoWeek()}</span></h3>
        ${stof.length ? stof.map(stofRij).join('') : `<p class="dk-leeg">Nog geen oefenstof voor week ${isoWeek()}.</p><button class="dk-link" data-dk="tab" data-tab="trainingen">Alle oefenstof \u203a</button>`}</div>
      <div class="dk-blok dk-taken"><h3>${ico('action-check', 18)}Te doen<span>${taken.length || ''}</span></h3>
        ${taken.length ? taken.map(t => `<button class="dk-taak" ${t.attr}><span class="dk-taak-ico">${ico(t.ico, 16)}</span><span>${esc(t.tekst)}<small>${esc(t.sub)}</small></span></button>`).join('') : '<p class="dk-leeg">Niets open. Mooi zo.</p>'}</div>
    </div></div>`;
}
function takenLijst(w){
  const t = [];
  if (w){
    const kk = kwartenKlaar(w);
    if (kk.klaar < kk.totaal) t.push({ ico:'football-lineup', tekst:`Opstelling afmaken tegen ${w.tegenstander || 'tegenstander'}`, sub:`${kk.klaar} van ${kk.totaal} klaar`, attr:`data-dk="openw" data-id="${esc(w.id)}"` });
  }
  const ev = modAan('evaluaties') ? (() => { try { return evaluatieOpen().length; } catch(e){ return 0; } })() : 0;
  if (ev) t.push({ ico:'attendance-evaluatie', tekst:`${ev} wedstrijd${ev === 1 ? '' : 'en'} nog evalueren`, sub:'Evaluatie', attr:'data-dk="tab" data-tab="evaluatie"' });
  const zonder = S.spelers.filter(p => !volledigen(p.id).length).length;
  if (S.spelers.length && zonder) t.push({ ico:'team-members', tekst:`Beoordeling: ${S.spelers.length - zonder} van ${S.spelers.length} spelers klaar`, sub:'Selectie', attr:'data-dk="tab" data-tab="spelers"' });
  const ber = (() => { try { return ongelezenBerichten(); } catch(e){ return 0; } })();
  if (ber) t.push({ ico:'communication-announcement', tekst:`${ber} ongelezen bericht${ber === 1 ? '' : 'en'}`, sub:'Berichten', attr:'data-dk="tab" data-tab="berichten"' });
  const stofNieuw = oefenstofTeam().filter(x => !S.trainingenGelezen?.[x.id]).length;
  if (stofNieuw) t.push({ ico:'training-cones', tekst:`${stofNieuw} nieuwe oefenstof`, sub:'Oefenstof', attr:'data-dk="tab" data-tab="trainingen"' });
  return t;
}

/* ==================== SELECTIE (spelers) ==================== */
/* [20260923e] Staf van het team: de coaches met toegang (leden + naam uit ledenInfo). */
function stafHtml(){
  const t = S.team || {}, info = t.ledenInfo || {};
  const uids = Object.keys(t.leden || {}).filter(u => t.leden[u] === true);
  if (!uids.length) return '';
  const naamVan = u => String(info[u]?.naam || 'Coach').split('@')[0];
  const lijst = uids.map(u => ({ u, n: naamVan(u) })).sort((a, b) => a.n.localeCompare(b.n, 'nl'));
  return `<div class="dk-staf"><b>Staf</b>${lijst.map(({ u, n }) => `<span class="dk-staf-p"><i>${esc(n.charAt(0).toUpperCase())}</i>${esc(n)}${u === S.user?.uid ? ' <small>(jij)</small>' : ''}</span>`).join('')}
    <span class="dk-staf-uitleg">coaches met toegang tot dit team</span></div>`;
}
function htmlSelectie(){
  const posities = ['Alle', ...new Set(S.spelers.map(p => p.positie).filter(Boolean))];
  if (!posities.includes(spFilter)) spFilter = 'Alle';
  const lijst = [...S.spelers].filter(p => spFilter === 'Alle' || p.positie === spFilter)
    .sort((a, b) => (Number(a.nummer) || 99) - (Number(b.nummer) || 99) || (a.naam || '').localeCompare(b.naam || ''));
  const kaartHtml = p => {
    const k = kaart(p), st = statsVan(p.id);
    return `<button class="dk-fk ${k.stijging >= 5 ? 'vorm' : ''}" data-dk="openprofiel" data-id="${esc(p.id)}" title="Profiel van ${esc(voornaam(p))} openen">
      <span class="dk-fk-rug">${esc(p.nummer ?? '')}</span>${k.stijging >= 5 ? `<span class="dk-pill rood dk-fk-tag">+${k.stijging}</span>` : ''}
      <span class="dk-fk-ovr">${k.ovr ?? '\u2013'}${k.snel ? '<small>snel</small>' : ''}</span><span class="dk-fk-pos">${esc((p.positie || '').slice(0, 3).toUpperCase())}</span>
      <span class="dk-fk-naam">${esc(voornaam(p))}</span>
      <span class="dk-fk-st">${SKILLS.map((d, i) => `<span><b>${k.niv[i] ? cijfer(k.niv[i]) : '\u2013'}</b><small style="color:${d.kleur}">${d.id}</small></span>`).join('')}</span>
      <span class="dk-fk-ms"><span><b>${st.wedstrijden}</b><small>WEDSTR</small></span><span><b class="g">${st.pctSpeeltijd != null ? st.pctSpeeltijd + '%' : '\u2013'}</b><small>SPEEL</small></span>
        <span><b class="y">${st.pctReserve != null ? st.pctReserve + '%' : '\u2013'}</b><small>RES</small></span><span><b>${st.goals}</b><small>GOALS</small></span></span></button>`;
  };
  return `<div class="dk-scherm dk-selectie">
    ${kop('Selectie', `${knop('Evaluatie', 'evmodus', '', 'attendance-evaluatie')}${knop('Beoordelingsronde', 'snelronde', '', 'action-check')}${knop('Speler toevoegen', 'nieuwsp', 'rood', 'team-player-add')}`)}
    <div class="dk-sel-body">
      ${stafHtml()}
      <div class="dk-filter">${posities.map(f => `<button class="${f === spFilter ? 'actief' : ''}" data-dk="filter" data-f="${esc(f)}">${esc(f)}</button>`).join('')}
        <span class="dk-filter-uitleg">Klik een kaart om de speler te bewerken. Cijfer = laatste volledige beoordeling (Aandacht 40 \u2026 Uitblinker 96); \u201csnel\u201d = uit de laatste snelle beoordeling. Speeltijd en reserve in % van speelbare tijd.</span></div>
      ${lijst.length ? `<div class="dk-kaarten">${lijst.map(kaartHtml).join('')}</div>` : '<p class="dk-leeg">Nog geen spelers in dit team.</p>'}
    </div></div>`;
}

/* ==================== SPELER BEWERKEN ====================
   [20260923c] Klik op een kaart in Selectie: gegevens (zoals modalSpeler),
   voorkeurspositie met meest gespeelde positie, notitie en uitlenen direct in
   de pagina. Opslaan schrijft dezelfde velden als modalSpeler + modalNotitie. */
function htmlSpelerBewerk(){
  const p = speler(S._beoordeelProfiel);
  if (!p) return null;
  if (spPositie.pid !== p.id) spPositie = { pid: p.id, pos: p.positie || '' };
  const top = (() => { try { return meestGespeeldePosities(p.id); } catch(e){ return []; } })();
  const st = statsVan(p.id);
  const lijst = [...S.spelers].sort((a, b) => (Number(a.nummer) || 99) - (Number(b.nummer) || 99));
  const uit = (S.uitleningenUit || []).find(u => u.spelerId === p.id) || null;
  const ingeleend = !!p._ingeleend;
  return `<div class="dk-scherm dk-bewerk">
    ${kop(voornaam(p), `${knop('Selectie', 'terugsel', '', 'navigation-back')}${knop('Evaluatie', 'evmodus', '', 'attendance-evaluatie')}${ingeleend ? '' : knop('Opslaan', 'spopslaan', 'rood', 'action-check')}`)}
    <div class="dk-drie dk-drie-pas">
      <aside class="dk-kol dk-lijstkol">${lijst.map(x => `<button class="dk-sp ${x.id === p.id ? 'actief' : ''}" data-dk="profiel" data-id="${esc(x.id)}"><span class="dk-sp-nr">${esc(x.nummer ?? '')}</span><span class="dk-sp-t"><b>${esc(voornaam(x))}</b><small>${esc(x.positie || '')}</small></span></button>`).join('')}</aside>
      <section class="dk-kol dk-hart dk-scroll"><div class="dk-spook dk-spook-rug">${esc(p.nummer ?? '')}</div>
        <h1 class="dk-groot dk-naam">${esc(voornaam(p))}<span class="dk-omlijnd dk-klein">${p.nummer != null && p.nummer !== '' ? '#' + esc(p.nummer) : ''}${spPositie.pos ? ' \u00b7 ' + esc(spPositie.pos) : ''}</span></h1>
        ${ingeleend ? `<div class="dk-blok dk-meld">Ingeleende speler${p._ingeleendVan ? ' van ' + esc(p._ingeleendVan) : ''}. Gegevens pas je aan bij het eigen team van deze speler.</div>` : `
        <div class="dk-blok"><h3 class="dk-label">Gegevens</h3>
          <div class="dk-form"><label class="dk-veld3">Voornaam<input id="dkSpNaam" value="${esc(p.naam || '')}" autocomplete="off"></label>
            <label>Nr.<input id="dkSpNr" value="${esc(p.nummer ?? '')}" inputmode="numeric"></label>
            <label class="dk-veldvol">Achternaam<input id="dkSpAchter" value="${esc(p.achternaam || '')}" placeholder="Achternaam" autocomplete="off"></label></div>
          <p class="dk-avg">De achternaam blijft binnen je eigen team en wordt nergens in de app getoond. Leen je deze speler uit, dan ziet de andere coach alleen de voorletter.</p></div>
        <div class="dk-blok"><h3 class="dk-label">Voorkeurspositie</h3>
          ${top.length ? `<div class="dk-meest"><span>Meest gespeeld dit seizoen:</span>${top.slice(0, 3).map((t, i) => `<span class="dk-pill ${i ? '' : 'rood'}">${esc(t.naam)} ${t.n}\u00d7</span>`).join('')}
            ${top[0].naam !== spPositie.pos ? knop('Overnemen: ' + top[0].naam, 'sppos', 'rood').replace('data-dk="sppos"', `data-dk="sppos" data-pos="${esc(top[0].naam)}"`) : ''}</div>` : ''}
          ${POSITIE_GROEPEN.map(g => `<div class="dk-posgroep"><small>${esc(g.naam)}</small><div class="dk-posrij" style="grid-template-columns:repeat(${g.posities.length},1fr)">${g.posities.map(x => `<button class="${x === spPositie.pos ? 'aan' : ''}" data-dk="sppos" data-pos="${esc(x)}">${esc(x)}</button>`).join('')}</div></div>`).join('')}</div>
        <div class="dk-blok"><h3 class="dk-label">Notitie<span>alleen voor coaches</span></h3>
          <textarea class="dk-ta" id="dkSpNotitie" rows="3" placeholder="Bijv. is altijd op de eerste van de maand afwezig voor werk \u00b7 vindt het fijn om extra complimenten te krijgen">${esc(p.notitie || '')}</textarea></div>`}
        <div class="dk-blok"><h3 class="dk-label">Uitlenen<span>${uit ? '1 lopend' : ''}</span></h3>
          ${uit ? `<div class="dk-leen">${ico('football-substitution', 18)}<div><b>Uitgeleend aan ${esc(uit.naarTeamNaam || 'ander team')}</b></div>${knop('Terugzetten', 'spterug', '').replace('data-dk="spterug"', `data-dk="spterug" data-id="${esc(uit.id)}"`)}</div>`
            : `<p class="dk-leeg">Nu niet uitgeleend.</p>`}
          ${ingeleend ? '' : `<div class="dk-rij-knoppen">${knop('Uitlenen aan ander team', 'spuitleen', '', 'football-substitution')}</div>`}</div>
        ${ingeleend ? '' : `<div class="dk-rij-knoppen">${knop('Opslaan', 'spopslaan', 'rood', 'action-check')}${knop('Verwijderen', 'spweg', 'dk-gevaar', '')}</div>`}
      </section>
      <aside class="dk-kol dk-zijkol">${statTegels(st, true)}
        <div class="dk-blok dk-sbblok"><h3 class="dk-label">Verhouding speeltijd / bank</h3>${sbBalk('', st, false)}${SB_LEGENDA}</div>
        <div class="dk-blok"><h3 class="dk-label">Ook bij ${esc(voornaam(p))}</h3>
          <div class="dk-rij-knoppen" style="margin-top:0">${knop('Evaluatie en radar', 'evmodus', '', 'attendance-evaluatie')}${knop('Historie', 'sphis', '', 'attendance-overview')}</div></div>
      </aside>
    </div></div>`;
}
async function bewaarSpelerDesk(){
  const p = speler(S._beoordeelProfiel); if (!p) return;
  const naam = ($('#dkSpNaam')?.value || '').trim();
  if (!naam) return meld('Vul een naam in');
  const nr = ($('#dkSpNr')?.value || '').trim();
  if (nr !== '' && !Number.isFinite(Number(nr))) return meld('Het nummer moet een getal zijn');
  /* zelfde velden als modalSpeler (bewerken) + modalNotitie in teams-spelers.js */
  const data = { naam, achternaam: ($('#dkSpAchter')?.value || '').trim() || null, nummer: nr === '' ? null : Number(nr),
    positie: spPositie.pos || null, notitie: ($('#dkSpNotitie')?.value || '').trim() || null };
  try { await updateDoc(doc(db, 'teams', S.teamId, 'spelers', p.id), data); meld(`${naam} opgeslagen`); }
  catch(e){ meld('Opslaan mislukt: ' + (e.code || e.message)); }
}

/* ==================== MOBIELE TEAMSCHERMEN (bouw-omgeving) ====================
   [20260923f] Zelfde gegevens en helpers als de desktop, maar opgemaakt voor
   de telefoon (klassen mb-*, styling in styles.css buiten de desktop-query).
   Gebruikt door mobiel-bouw.js; zelfde S-wissel als htmlMeekijk. */
export function htmlMobielTeam(soort, team, d, keuze = {}){
  const bewaar = { team:S.team, teamId:S.teamId, spelers:S.spelers, wedstrijden:S.wedstrijden, presentie:S.presentie, beoordelingen:S.beoordelingen, teamEvaluaties:S.teamEvaluaties };
  try {
    S.team = team; S.teamId = team.id; S.spelers = d.spelers || []; S.wedstrijden = d.wedstrijden || []; S.presentie = d.presentie || [];
    S.beoordelingen = [...(d.beoordelingen || [])].sort((a, b) => (b.datum || '').localeCompare(a.datum || '') || (b.gemaaktMs || 0) - (a.gemaaktMs || 0));
    S.teamEvaluaties = d.teamevaluaties || [];
    const spelers = [...S.spelers].filter(p => !p.gast).sort((a, b) => (Number(a.nummer) || 99) - (Number(b.nummer) || 99));
    if (soort === 'sel'){
      const info = team.ledenInfo || {};
      const staf = Object.keys(team.leden || {}).filter(u => team.leden[u] === true).map(u => String(info[u]?.naam || 'Coach').split('@')[0]);
      return `${staf.length ? `<div class="mb-kaart"><div class="mb-lbl">Staf</div><div class="mb-staf">${staf.map(n => `<span><i>${esc(n.charAt(0).toUpperCase())}</i>${esc(n)}</span>`).join('')}</div></div>` : ''}
        <div class="mb-fkgrid">${spelers.map(p => { const k = kaart(p), st = statsVan(p.id);
          return `<button class="mb-fk" data-mb="speler" data-id="${esc(p.id)}"><span class="mb-rug">${esc(p.nummer ?? '')}</span><span class="mb-o">${k.ovr ?? '\u2013'}${k.snel ? '<small>snel</small>' : ''}</span>
            <span class="mb-n">${esc(voornaam(p))}</span><span class="mb-ms"><span><b>${st.wedstrijden}</b><small>WED</small></span><span><b class="g">${st.pctSpeeltijd != null ? st.pctSpeeltijd + '%' : '\u2013'}</b><small>SPEEL</small></span>
            <span><b class="y">${st.pctReserve != null ? st.pctReserve + '%' : '\u2013'}</b><small>RES</small></span><span><b>${st.goals}</b><small>GOAL</small></span></span></button>`; }).join('') || '<p class="mb-leeg">Nog geen spelers.</p>'}</div>`;
    }
    if (soort === 'evs'){
      const pid = keuze.speler && spelers.some(p => p.id === keuze.speler) ? keuze.speler : spelers[0]?.id;
      const p = spelers.find(x => x.id === pid);
      if (!p) return '<p class="mb-leeg">Nog geen spelers.</p>';
      const k = kaart(p), st = statsVan(p.id), tg = teamGemiddelde();
      return `<div class="mb-strook">${spelers.map(x => `<button class="mb-chip ${x.id === pid ? 'aan' : ''}" data-mb="speler" data-id="${esc(x.id)}">${esc(x.nummer ?? '')} ${esc(voornaam(x))}</button>`).join('')}</div>
        <div class="mb-kaart mb-pas"><div class="mb-groot">${esc(voornaam(p))}<small>${k.ovr != null ? 'Kaart ' + k.ovr + (k.snel ? ' \u00b7 snel' : '') : 'nog niet beoordeeld'}</small></div>
          ${k.niv.some(Boolean) ? `<div class="mb-radar">${radarSvg(k.niv, tg)}</div>
            <div class="mb-dom">${SKILLS.map((dm, i) => `<span><b style="color:${dm.kleur}">${k.niv[i] ? cijfer(k.niv[i]) : '\u2013'}</b><small>${dm.id}</small></span>`).join('')}</div>`
            : `<p class="mb-leeg">${k.snel ? 'Alleen een snelle beoordeling (' + esc(k.snelLabel) + '). Voor de radar per domein is een volledige beoordeling nodig.' : 'Nog geen beoordeling.'}</p>`}</div>
        <div class="mb-tegels"><span><b>${st.wedstrijden}</b><small>WEDSTR.</small></span><span><b>${st.pctSpeeltijd != null ? st.pctSpeeltijd + '%' : '\u2013'}</b><small>SPEELTIJD</small></span><span><b>${st.pctReserve != null ? st.pctReserve + '%' : '\u2013'}</b><small>RESERVE</small></span><span><b>${st.goals}</b><small>GOALS</small></span></div>
        <div class="mb-kaart"><div class="mb-lbl">Alle evaluaties<span>${evaluatiesVan(p.id).length}</span></div>
          ${evaluatiesVan(p.id).slice(0, 8).map(b => `<div class="mb-r"><span>${b.soort === 'volledig' ? 'Volledige beoordeling' : 'Snel' + (b.bron?.label ? ' \u00b7 ' + esc(b.bron.label) : '')}<small>${esc(datumMooi(b.datum, { day:'numeric', month:'short' }))}</small></span><em class="mb-niv" style="--n:${niveauKleur(evNiveau(b))}">${esc(NIVEAUS[evNiveau(b)]?.label || '\u2013')}</em></div>`).join('') || '<p class="mb-leeg">Nog geen evaluaties.</p>'}</div>`;
    }
    if (soort === 'evw'){
      const lijst = afgelopen();
      const wid = keuze.wedstrijd && lijst.some(w => w.id === keuze.wedstrijd) ? keuze.wedstrijd : lijst[0]?.id;
      const w = lijst.find(x => x.id === wid);
      if (!w) return '<p class="mb-leeg">Nog geen gespeelde wedstrijden.</p>';
      const e = S.teamEvaluaties.find(x => x.wedstrijdId === w.id);
      const vals = Object.values(e?.scores || {}).map(Number).filter(Boolean);
      const pct = vals.length ? Math.round(gem(vals) / 5 * 100) : null;
      return `<div class="mb-strook">${lijst.map(x => { const st = stand(x); return `<button class="mb-wl ${x.id === wid ? 'aan' : ''}" data-mb="wedstrijd" data-id="${esc(x.id)}"><b>${esc(String(Number((x.datum || '').slice(8, 10)) || ''))}<small>${esc(datumMooi(x.datum, { month:'short' }))}</small></b><span>${esc(x.tegenstander || '')}<small>${st.links}\u2013${st.rechts}</small></span></button>`; }).join('')}</div>
        <div class="mb-kaart mb-evkop"><div class="mb-ring" style="--p:${pct ?? 0}"><span>${pct ?? '\u2013'}</span></div><p>${e ? `Teamscore ${esc(w.tegenstander || '')} ${stand(w).links}\u2013${stand(w).rechts}.` : 'Deze wedstrijd is nog niet ge\u00ebvalueerd.'}</p></div>
        ${(() => {
          /* [20260923g] Radar: seizoensgemiddelde van alle geëvalueerde wedstrijden
             (grijze stippellijn) met de gekozen wedstrijd in kleur. */
          const evals = S.teamEvaluaties.filter(x => x.scores);
          if (!evals.length) return '';
          const gemVals = TEAM_CATEGORIEEN.map(c => { const v = evals.map(x => Number(x.scores[c.id])).filter(Boolean); return v.length ? gem(v) : 0; });
          const huidig = TEAM_CATEGORIEEN.map(c => Number(e?.scores?.[c.id]) || 0);
          const kort = c => ({ 'Inzet & concentratie':'Inzet', 'Samenwerking & communicatie':'Samenwerking', 'Taakuitvoering per linie':'Taken', 'Opbouw van achteruit':'Opbouw',
            'Omschakeling bij balverlies/-winst':'Omschakelen', 'Druk zetten & veroveren':'Druk zetten', 'Spelplezier':'Plezier', 'Coachbaarheid':'Coachbaar' }[c.naam] || c.naam.split(/[ &\/]/)[0]);
          return `<div class="mb-kaart"><div class="mb-lbl">Radar<span>${evals.length} geëvalueerde wedstrijd${evals.length === 1 ? '' : 'en'}</span></div>
            <div class="mb-radar mb-radar-ev">${radarN(e ? huidig : gemVals, e ? gemVals : null, TEAM_CATEGORIEEN.map(kort), TEAM_CATEGORIEEN.map((c, i) => e && huidig[i] ? niveauKleur(huidig[i]) : 'var(--ink-2)'))}</div>
            <div class="mb-leg"><span><i style="background:#e2342f"></i>${e ? esc(w.tegenstander || 'deze wedstrijd') : 'seizoensgemiddelde'}</span>${e ? '<span><i style="background:transparent;border:1.5px dashed var(--ink-2)"></i>gemiddelde alle wedstrijden</span>' : ''}</div></div>`;
        })()}
        ${e ? `<div class="mb-kaart">${TEAM_CATEGORIEEN.map(c => { const v = Number(e.scores?.[c.id]) || 0;
          return `<div class="mb-cat">${esc(c.naam)}</div><div class="mb-kb">${NIVEAUS.slice(1).map(n => `<span style="${v === n.n ? 'background:' + niveauKleur(n.n) + ';color:#161a1f' : ''}">${esc(n.label.slice(0, 6))}</span>`).join('')}</div>`; }).join('')}
          ${(e.tags || []).length ? `<div class="mb-tags">${e.tags.map(tid => { const t = TEAM_TAGS.find(x => x.id === tid); return t ? `<span>${esc(t.label)}</span>` : ''; }).join('')}</div>` : ''}
          ${e.notitieGoed ? `<p class="mb-noot"><b>Ging goed:</b> ${esc(e.notitieGoed)}</p>` : ''}${e.notitieAandacht ? `<p class="mb-noot"><b>Aandacht:</b> ${esc(e.notitieAandacht)}</p>` : ''}</div>` : ''}`;
    }
    if (soort === 'stat'){
      const rij = spelers.map(p => ({ p, st: statsVan(p.id) }));
      return `<div class="mb-kaart">${rij.map(({ p, st }) => `<div class="mb-statrij"><b>${esc(p.nummer ?? '')}</b><span>${esc(voornaam(p))}</span>
          <i>${st.pctSpeeltijd != null ? `<em class="g" style="width:${st.pctSpeeltijd}%"></em><em class="y" style="width:${st.pctReserve}%"></em>` : ''}</i>
          <small>${st.pctSpeeltijd != null ? st.pctSpeeltijd + '%' : '\u2013'}</small><small>${st.goals} \u26bd</small></div>`).join('') || '<p class="mb-leeg">Nog geen spelers.</p>'}
        <div class="mb-leg"><span><i class="g"></i>gespeeld</span><span><i class="y"></i>reserve</span><span>% van speelbare tijd</span></div></div>`;
    }
    return '';
  } finally {
    S.team = bewaar.team; S.teamId = bewaar.teamId; S.spelers = bewaar.spelers; S.wedstrijden = bewaar.wedstrijden; S.presentie = bewaar.presentie;
    S.beoordelingen = bewaar.beoordelingen; S.teamEvaluaties = bewaar.teamEvaluaties;
  }
}

/* ==================== MEEKIJKEN (coördinator, alleen lezen) ====================
   [20260923c] Tekent Selectie / Evaluatie spelers / Evaluatie wedstrijden /
   Stats voor een team uit de bouw met de gegevens die de bouw-omgeving al
   ophaalde. We zetten de S-velden heel even op die gegevens, tekenen de
   bestaande sjablonen en zetten alles direct terug (synchroon). */
export function htmlMeekijk(soort, team, d, keuze = {}){
  const bewaar = { team:S.team, teamId:S.teamId, spelers:S.spelers, wedstrijden:S.wedstrijden, presentie:S.presentie, beoordelingen:S.beoordelingen,
    teamEvaluaties:S.teamEvaluaties, profiel:S._beoordeelProfiel, modus:S._dkModus, uitUit:S.uitleningenUit, evSel, evConcept, spFilter };
  try {
    S.team = team; S.teamId = team.id; S.spelers = d.spelers || []; S.wedstrijden = d.wedstrijden || []; S.presentie = d.presentie || [];
    S.beoordelingen = [...(d.beoordelingen || [])].sort((a, b) => (b.datum || '').localeCompare(a.datum || '') || (b.gemaaktMs || 0) - (a.gemaaktMs || 0));
    S.teamEvaluaties = d.teamevaluaties || []; S.uitleningenUit = []; spFilter = 'Alle';
    let html = null;
    if (soort === 'sel') html = htmlSelectie();
    if (soort === 'evs'){ S._beoordeelProfiel = keuze.speler && speler(keuze.speler) ? keuze.speler : eersteSpeler(); S._dkModus = 'evaluatie'; html = S._beoordeelProfiel ? htmlPaspoort() : '<p class="dk-leeg">Nog geen spelers.</p>'; }
    if (soort === 'evw'){ evSel = keuze.wedstrijd || null; evConcept = null; html = htmlEvaluatie() || '<p class="dk-leeg">Evaluaties staan uit voor dit team.</p>'; }
    if (soort === 'stat') html = htmlStats();
    return String(html || '').replaceAll('<textarea ', '<textarea readonly ');
  } finally {
    S.team = bewaar.team; S.teamId = bewaar.teamId; S.spelers = bewaar.spelers; S.wedstrijden = bewaar.wedstrijden; S.presentie = bewaar.presentie;
    S.beoordelingen = bewaar.beoordelingen; S.teamEvaluaties = bewaar.teamEvaluaties; S._beoordeelProfiel = bewaar.profiel; S._dkModus = bewaar.modus;
    S.uitleningenUit = bewaar.uitUit; evSel = bewaar.evSel; evConcept = bewaar.evConcept; spFilter = bewaar.spFilter;
  }
}

/* ==================== PASPOORT (spelerprofiel) ==================== */
function radarSvg(niv, teamGem){
  const cx = 210, cy = 200, R = 158;
  const pnt = w => w.map((v, i) => { const a = -Math.PI / 2 + i * 2 * Math.PI / 5, r = R * (v || 0) / 5; return [cx + r * Math.cos(a), cy + r * Math.sin(a)]; });
  const pp = a => a.map(p => p.map(n => n.toFixed(1)).join(',')).join(' ');
  return `<svg viewBox="0 0 420 400" class="dk-radar-svg" aria-hidden="true">
    ${[1, 2, 3, 4, 5].map(v => `<polygon points="${pp(pnt(Array(5).fill(v)))}" fill="none" style="stroke:var(--line-d)" ${v === 5 ? 'stroke-width="1.5"' : ''}/>`).join('')}
    ${pnt(Array(5).fill(5.85)).map(([x, y], i) => `<text x="${x.toFixed(1)}" y="${(y + 7).toFixed(1)}" text-anchor="middle" fill="${SKILLS[i].kleur}" font-family="Barlow Condensed,sans-serif" font-weight="800" font-size="22">${SKILLS[i].id}</text>`).join('')}
    ${teamGem.every(x => x) ? `<polygon points="${pp(pnt(teamGem))}" fill="none" style="stroke:var(--ink-2)" stroke-width="1.5" stroke-dasharray="4 4"/>` : ''}
    ${niv.some(Boolean) ? `<polygon points="${pp(pnt(niv))}" style="fill:color-mix(in srgb,var(--accent) 28%,transparent);stroke:var(--accent)" stroke-width="2.5" stroke-linejoin="round"/>
      ${pnt(niv).map(([x, y], i) => niv[i] ? `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="6.5" fill="${SKILLS[i].kleur}" style="stroke:var(--bg)" stroke-width="2.5"/>` : '').join('')}` : ''}
  </svg>`;
}
function sparkline(t){
  if (t.length < 2) return '<svg viewBox="0 0 64 24"></svg>';
  const mn = Math.min(...t) - 2, mx = Math.max(...t) + 2;
  return `<svg viewBox="0 0 64 24"><polyline points="${t.map((v, i) => `${(i / (t.length - 1) * 64).toFixed(1)},${(24 - (v - mn) / (mx - mn) * 24).toFixed(1)}`).join(' ')}" fill="none" style="stroke:var(--ink-2)" stroke-width="1.6" stroke-linejoin="round"/></svg>`;
}
function evaluatiesVan(pid){
  return S.beoordelingen.filter(b => b.spelerId === pid && (b.soort === 'snel' || b.soort === 'volledig'))
    .sort((a, b) => (b.datum || '').localeCompare(a.datum || '') || (b.gemaaktMs || 0) - (a.gemaaktMs || 0));
}
function evNiveau(b){
  if (b.soort === 'snel') return Number(b.niveau) || 0;
  const w = SKILLS.map(d => Number(b.scores?.[d.id])).filter(Boolean);
  return w.length ? Math.round(gem(w)) : 0;
}
function htmlPaspoort(){
  const p = speler(S._beoordeelProfiel);
  if (!p) return null;
  const k = kaart(p), tg = teamGemiddelde();
  const min = seizoensMinuten()[p.id] || 0;
  const lps = [...(p.leerpunten || [])].sort((a, b) => (a.klaar ? 1 : 0) - (b.klaar ? 1 : 0) || (b.sinds || '').localeCompare(a.sinds || ''));
  const open = lps.filter(l => !l.klaar).length, klaar = lps.length - open;
  const lijst = [...S.spelers].sort((a, b) => (Number(a.nummer) || 99) - (Number(b.nummer) || 99));
  const momenten = [];
  if (k.laatste) momenten.push([k.laatste.datum, `<b>Volledige beoordeling</b>${k.laatste.bron?.label ? ' \u00b7 ' + esc(k.laatste.bron.label) : ''}`]);
  const lw = afgelopen().find(w => (w.selectie || []).includes(p.id) && analyse(w).tijd[p.id]);
  if (lw) momenten.push([lw.datum, `<b>Wedstrijd</b> tegen ${esc(lw.tegenstander || '')}, ${Math.round(analyse(lw).tijd[p.id] / 60)} minuten gespeeld`]);
  const nl = [...(p.leerpunten || [])].sort((a, b) => (b.sinds || '').localeCompare(a.sinds || ''))[0];
  if (nl) momenten.push([nl.sinds, `<b>Leerpunt</b> toegevoegd: ${esc(nl.tekst)}`]);
  momenten.sort((a, b) => (b[0] || '').localeCompare(a[0] || ''));

  return `<div class="dk-scherm dk-paspoort">
    ${kop('Evaluatie \u00b7 ' + voornaam(p), `${knop('Selectie', 'terugsel', '', 'navigation-back')}${knop('Profiel', 'openprofiel', '', 'team-player').replace('data-dk="openprofiel"', `data-dk="openprofiel" data-id="${esc(p.id)}"`)}${knop('Snel beoordelen', 'snel', '', 'action-check')}${knop('Evalueren', 'beoordeel', 'rood', 'attendance-evaluatie')}`)}
    <div class="dk-drie dk-drie-pas">
      <aside class="dk-kol dk-lijstkol">${lijst.map(s => { const ks = kaart(s); return `<button class="dk-sp ${s.id === p.id ? 'actief' : ''}" data-dk="profiel" data-id="${esc(s.id)}"><span class="dk-sp-nr">${esc(s.nummer ?? '')}</span><span class="dk-sp-t"><b>${esc(volledigeNaam(s))}</b><small>${esc(s.positie || 'Speler')}${ks.ovr != null ? ' \u00b7 ' + ks.ovr : ''}</small></span>${sparkline(ks.trend)}</button>`; }).join('')}</aside>
      <section class="dk-kol dk-hart"><div class="dk-spook dk-spook-rug">${esc(p.nummer ?? '')}</div>
        <h1 class="dk-groot dk-naam">${esc(p.naam || '')}<span class="dk-omlijnd">${esc(p.nummer != null && p.nummer !== '' ? '#' + p.nummer : '')}${p.positie ? ' \u00b7 ' + esc(p.positie) : ''}</span></h1>
        <div class="dk-pills">${p.nummer != null && p.nummer !== '' ? `<span class="dk-pill">#${esc(p.nummer)}${p.positie ? ' \u00b7 ' + esc(p.positie) : ''}</span>` : p.positie ? `<span class="dk-pill">${esc(p.positie)}</span>` : ''}
          ${k.ovr != null ? `<span class="dk-pill ${k.stijging >= 5 ? 'rood' : 'groen'}">Kaart ${k.ovr}${k.stijging ? ` (${k.stijging > 0 ? '+' : ''}${k.stijging})` : ''}</span>` : '<span class="dk-pill">Nog geen volledige beoordeling</span>'}
          <span class="dk-pill">${min}\u2032 dit seizoen</span><span class="dk-pill">Stippellijn = teamgemiddelde</span></div>
        ${k.niv.some(Boolean) ? `<div class="dk-radar">${radarSvg(k.niv, tg)}
          <div class="dk-legenda">${SKILLS.map((d, i) => `<div><b style="color:${d.kleur}">${k.niv[i] ? cijfer(k.niv[i]) : '–'}</b><span><strong>${esc(d.kort)}</strong>${k.niv[i] ? esc(NIVEAUS[k.niv[i]]?.label || '') : 'niet beoordeeld'}${k.niv[i] && k.nivVorig[i] && k.niv[i] > k.nivVorig[i] ? ' \u00b7 gestegen' : ''}</span></div>`).join('')}</div></div>` : `<div class="dk-blok dk-geenradar"><b>${k.snel ? 'Alleen een snelle beoordeling: ' + esc(k.snelLabel) : 'Nog geen beoordeling'}</b>
          <p>${k.snel ? `Het kaartcijfer gebruikt dat niveau (${k.ovr}). Voor de radar per domein is een volledige beoordeling nodig.` : 'Vul een volledige beoordeling in om de radar per domein te zien.'}</p>
          ${knop('Volledige beoordeling', 'beoordeel', 'rood', 'attendance-evaluatie')}</div>`}
      </section>
      <aside class="dk-kol dk-zijkol">
        ${statTegels(statsVan(p.id), true)}
        <div class="dk-blok dk-sbblok"><h3 class="dk-label">Verhouding speeltijd / bank</h3>${sbBalk('', statsVan(p.id), false)}${SB_LEGENDA}</div>
        <div><h3 class="dk-label">Alle evaluaties<span>${evaluatiesVan(p.id).length}</span></h3>
          ${evaluatiesVan(p.id).slice(0, 8).map(b => `<button class="dk-evrij" data-dk="evopen" data-id="${esc(b.id)}"><span><b>${b.soort === 'volledig' ? 'Volledige beoordeling' : 'Snel' + (b.bron?.label ? ' \u00b7 ' + esc(b.bron.label) : '')}</b><small>${esc(datumMooi(b.datum, { day:'numeric', month:'short' }))}</small></span>
            <span class="dk-niv" style="--n:${niveauKleur(evNiveau(b))}">${esc(NIVEAUS[evNiveau(b)]?.label || '\u2013')}</span></button>`).join('') || '<p class="dk-leeg">Nog geen evaluaties.</p>'}</div>
        <div><h3 class="dk-label">Leerpunten<span>${open} open \u00b7 ${klaar} afgerond</span></h3>
          ${lps.filter(l => !l.klaar).slice(0, 4).map(l => `<div class="dk-lp"><i style="background:${SKILLS.find(d => d.id === l.domein)?.kleur || 'var(--ink-2)'}"></i><div><b>${esc(l.tekst)}</b></div></div>`).join('')}
          <button class="dk-link" data-dk="leerpunt">+ Leerpunt toevoegen</button></div>
      </aside>
    </div></div>`;
}

/* ==================== WEDSTRIJDEN ==================== */
function htmlWedstrijden(){
  const kom = komende(), afg = afgelopen();
  const alle = [...kom, ...afg];
  if (!alle.find(w => w.id === selWedstrijd)) selWedstrijd = (kom[0] || afg[0])?.id || null;
  const w = alle.find(x => x.id === selWedstrijd);
  const item = x => {
    const st = stand(x), isAfg = gespeeld(x);
    const cls = isAfg ? (st.voor > st.tegen ? 'w' : st.voor < st.tegen ? 'v' : 'g') : '';
    return `<button class="dk-li ${x.id === selWedstrijd ? 'actief' : ''}" data-dk="selw" data-id="${esc(x.id)}">
      <span class="dk-li-dt">${esc(String(Number((x.datum || '').slice(8, 10)) || '–'))}<small>${esc(datumMooi(x.datum, { month:'short' }))}</small></span>
      <span class="dk-li-t"><b>${esc(x.type === 'toernooi' ? '\ud83c\udfc6 ' + (x.tegenstander || 'Toernooi') : x.tegenstander || 'Tegenstander')}</b><small>${x.thuis ? 'thuis' : 'uit'}${x.aftrap ? ' \u00b7 ' + esc(x.aftrap) : ''}</small></span>
      ${isAfg && (x.goals || []).length + analyse(x).kwarten ? `<span class="dk-uitsl ${cls}">${st.links}\u2013${st.rechts}</span>` : x === kom[0] ? '<span class="dk-pill rood">volgende</span>' : ''}</button>`;
  };
  return `<div class="dk-scherm">
    ${kop('Wedstrijden', knop('Nieuwe wedstrijd', 'nieuwew', 'rood', 'action-add'))}
    <div class="dk-drie">
      <aside class="dk-kol dk-lijstkol">${kom.length ? volgendeKaart(kom[0]) + (kom.length > 1 ? `<h5>Daarna</h5>${kom.slice(1).map(item).join('')}` : '') : ''}${afg.length ? `<h5>Gespeeld</h5>${afg.map(item).join('')}` : ''}${!alle.length ? '<p class="dk-leeg">Nog geen wedstrijden.</p>' : ''}</aside>
      <section class="dk-kol dk-hart">${w ? (gespeeld(w) ? wedGespeeld(w) : wedKomend(w)) : '<p class="dk-leeg">Kies een wedstrijd.</p>'}</section>
      <aside class="dk-kol dk-zijkol">${w ? (gespeeld(w) ? zijGespeeld(w) : zijKomend(w)) : ''}</aside>
    </div></div>`;
}
function volgendeKaart(x){
  const dagen = Math.max(0, Math.round((aftrapMs(x) - Date.now()) / 86400000));
  const kk = kwartenKlaar(x);
  return `<button class="dk-volg ${x.id === selWedstrijd ? 'actief' : ''}" data-dk="selw" data-id="${esc(x.id)}">
    <span class="t">\u25cf Eerstvolgende \u00b7 ${dagen === 0 ? 'vandaag' : dagen === 1 ? 'morgen' : 'over ' + dagen + ' dagen'}</span>
    <b>${esc(x.tegenstander || 'Tegenstander')}</b>
    <span class="m">${esc(datumMooi(x.datum, { weekday:'short', day:'numeric', month:'short' }))}${x.aftrap ? ' \u00b7 ' + esc(x.aftrap) : ''} \u00b7 ${x.thuis ? 'thuis' : 'uit'} \u00b7 opstelling ${kk.klaar}/${kk.totaal}</span></button>`;
}
function wedKomend(w){
  const kk = kwartenKlaar(w);
  return `<div class="dk-spook">${esc(String(Number((w.datum || '').slice(8, 10)) || ''))}</div>
    <h1 class="dk-groot">${esc(w.tegenstander || 'Tegenstander')}<span class="dk-omlijnd dk-klein">${w.thuis ? 'thuis' : 'uit'} \u00b7 ${esc(datumMooi(w.datum, { weekday:'long', day:'numeric', month:'long' }))}</span></h1>
    <div class="dk-pills">${w.aftrap ? `<span class="dk-pill">Aftrap ${esc(w.aftrap)}</span>` : ''}${w.format ? `<span class="dk-pill">${esc(w.format)} tegen ${esc(w.format)}</span>` : ''}${w.formatie ? `<span class="dk-pill">${esc(w.formatie)}</span>` : ''}<span class="dk-pill ${kk.klaar < kk.totaal ? 'oranje' : 'groen'}">Opstelling ${kk.klaar}/${kk.totaal}</span></div>
    ${miniVeld(w, true)}
    <div class="dk-rij-knoppen">${knop('Wedstrijd openen', 'openw', 'rood', 'training-start').replace('data-dk="openw"', `data-dk="openw" data-id="${esc(w.id)}"`)}</div>`;
}
function zijKomend(w){
  const stats = Object.fromEntries(S.spelers.map(p => [p.id, statsVan(p.id)]));
  const laag = S.spelers.filter(p => stats[p.id].pctSpeeltijd != null).sort((a, b) => stats[a.id].pctSpeeltijd - stats[b.id].pctSpeeltijd).slice(0, 8);
  const sel = (w.selectie || []).filter(pid => speler(pid)).length;
  return `<div><h3 class="dk-label">Selectie<span>${sel ? sel + ' spelers' : 'nog niet gekozen'}</span></h3>
      ${sel ? (w.selectie || []).filter(pid => speler(pid)).slice(0, 16).map(pid => `<span class="dk-chip">${esc(voornaam(speler(pid)))}</span>`).join('') : '<p class="dk-leeg">Kies de selectie in de wedstrijd.</p>'}</div>
    <div><h3 class="dk-label">Speeltijd dit seizoen<span>minst gespeeld eerst</span></h3>
      ${laag.length ? laag.map(p => sbBalk(voornaam(p), stats[p.id])).join('') + SB_LEGENDA : '<p class="dk-leeg">Nog geen gespeelde wedstrijden.</p>'}</div>`;
}
function wedGespeeld(w){
  const st = stand(w), nrs = periodeNrs(w);
  const duur = (Number(w.kwartduur) || 15) * 60, totaal = duur * nrs.length;
  const goals = (w.goals || []).map(g => ({ ...g, t: (Math.max(0, nrs.indexOf(String(g.kwart))) * duur + (g.sec || 0)) }));
  const perKwart = nrs.map((nr, i) => {
    const tot = goals.filter(g => nrs.indexOf(String(g.kwart)) <= i);
    const v = tot.filter(g => g.type === 'voor').length, t = tot.filter(g => g.type === 'tegen').length;
    return w.thuis ? [v, t] : [t, v];
  });
  const uitslag = st.voor > st.tegen ? ['Gewonnen', 'groen'] : st.voor < st.tegen ? ['Verloren', 'rood'] : ['Gelijk', ''];
  const links = w.thuis ? S.team.naam : (w.tegenstander || ''), rechts = w.thuis ? (w.tegenstander || '') : S.team.naam;
  return `<div class="dk-spook">${st.links}${st.rechts}</div>
    <div class="dk-score"><div class="dk-score-p">${esc(links)}</div><div class="dk-score-c">${st.links}</div><div class="dk-score-c dim">\u2013</div><div class="dk-score-c">${st.rechts}</div><div class="dk-score-p r">${esc(rechts)}</div></div>
    <div class="dk-pills"><span class="dk-pill ${uitslag[1]}">${uitslag[0]}</span><span class="dk-pill">${esc(datumMooi(w.datum, { weekday:'short', day:'numeric', month:'short' }))}</span><span class="dk-pill">${w.thuis ? 'thuis' : 'uit'}</span></div>
    ${goals.length ? `<div><h3 class="dk-label">Verloop<span>${nrs.length} \u00d7 ${Math.round(duur / 60)} minuten</span></h3>
      <div class="dk-tijdlijn">${nrs.slice(1).map((_, i) => `<i class="kw" style="left:${(i + 1) / nrs.length * 100}%"></i>`).join('')}
        ${goals.sort((a, b) => a.t - b.t).map((g, i) => `<div class="e ${g.type === 'voor' ? 'g' : 't'}" style="left:${Math.min(98, g.t / totaal * 100)}%"><span class="${i % 2 ? 'boven' : ''}">${Math.floor(g.t / 60) + 1}\u2032 ${g.type === 'voor' ? esc(g.pid && speler(g.pid) ? voornaam(speler(g.pid)) : S.team.naam) : 'tegen'}</span></div>`).join('')}</div></div>` : ''}
    <div class="dk-kwarten">${perKwart.map((k, i) => `<div><small>na ${nrs.length === 2 ? 'helft' : 'periode'} ${i + 1}</small><b>${k[0]}\u2013${k[1]}</b></div>`).join('')}</div>
    <div class="dk-rij-knoppen">${knop('Wedstrijd openen', 'openw', 'rood', 'training-view').replace('data-dk="openw"', `data-dk="openw" data-id="${esc(w.id)}"`)}${modAan('evaluaties') ? knop('Evalueren', 'evalueer').replace('data-dk="evalueer"', `data-dk="evalueer" data-id="${esc(w.id)}"`) : ''}</div>`;
}
function zijGespeeld(w){
  const a = analyse(w);
  const rij = Object.entries(a.tijd).filter(([pid]) => speler(pid)).sort((x, y) => y[1] - x[1]);
  const mx = Math.max(1, ...rij.map(r => r[1]));
  return `<div><h3 class="dk-label">Speeltijd deze wedstrijd<span>minuten</span></h3>
    ${rij.length ? rij.map(([pid, s]) => `<div class="dk-balk ${s < mx * 0.6 ? 'laag' : ''}"><span>${esc(voornaam(speler(pid)))}</span><i><b style="width:${s / mx * 100}%"></b></i><em>${Math.round(s / 60)}\u2032</em></div>`).join('') : '<p class="dk-leeg">Geen speeltijd vastgelegd.</p>'}</div>`;
}

/* ==================== TRAININGEN (presentietraining) ====================
   [20260923a] Links de trainingen van deze week, midden de gekozen training
   (standaard vandaag of de eerstvolgende) met aanwezigheid (tik = afmelden
   met reden) en daaronder de oefenstof: PDF bovenaan, oefeningen uit het
   AI-gedeelte eronder. Rechts volgende week en voorgaande trainingen. */
function maandagVan(d){ const x = new Date(d); x.setHours(12, 0, 0, 0); x.setDate(x.getDate() - ((x.getDay() + 6) % 7)); return x; }
function trainingsdataWeek(offset = 0){
  const dagen = Array.isArray(S.team?.trainingsdagen) ? S.team.trainingsdagen : [];
  const ma = maandagVan(new Date()); ma.setDate(ma.getDate() + offset * 7);
  const van = ma.toISOString().slice(0, 10); const tot = new Date(ma); tot.setDate(tot.getDate() + 6);
  const totIso = tot.toISOString().slice(0, 10);
  const set = new Set();
  for (let i = 0; i < 7; i++){ const d = new Date(ma); d.setDate(d.getDate() + i); if (dagen.includes(i + 1)) set.add(d.toISOString().slice(0, 10)); }
  for (const s of (S.presentie || [])) if (s.datum >= van && s.datum <= totIso) set.add(s.datum);
  return [...set].sort();
}
const sessieOp = iso => (S.presentie || []).find(s => s.datum === iso) || null;
const kortDatum = iso => `${datumMooi(iso, { weekday:'short' }).slice(0, 2).toLowerCase()} ${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
function trItem(iso){
  const s = sessieOp(iso), vandaag = vandaagISO();
  const status = iso === vandaag ? 'vandaag' : iso < vandaag ? (s ? `${aanwezigTel(s)}/${meetellers(s)} aanwezig` : 'geen presentie') : 'gepland';
  return `<button class="dk-li ${iso === selTraining ? 'actief' : ''}" data-dk="seltr" data-id="${esc(iso)}">
    <span class="dk-li-dt">${esc(String(Number(iso.slice(8, 10))))}<small>${esc(datumMooi(iso, { weekday:'short' }).replace('.', ''))}</small></span>
    <span class="dk-li-t"><b>${esc(oefenstofVoorDatum(iso)?.titel || 'Training')}</b><small>${esc(status)}</small></span>
    ${iso === vandaag ? '<span class="dk-pill rood">vandaag</span>' : ''}</button>`;
}
async function zetPresentie(datum, pid, reden){
  const s = sessieOp(datum);
  const afwezig = new Set(s?.afwezig || []), telaat = new Set(s?.telaat || []);
  const redenen = JSON.parse(JSON.stringify(s?.afwezigRedenen || {}));
  if (reden){ afwezig.add(pid); telaat.delete(pid); redenen[pid] = { type: reden, notitie: redenen[pid]?.notitie || '' }; }
  else { afwezig.delete(pid); delete redenen[pid]; }
  /* zelfde documentvorm als modalPresentie in teams-training.js */
  const data = { datum, afwezig: [...afwezig], telaat: [...telaat], afwezigRedenen: redenen,
    selectie: S.spelers.map(p => p.id), aantalAanwezig: S.spelers.length - afwezig.size, aantalTeLaat: telaat.size,
    aantalSpelers: S.spelers.length, door: S.user?.displayName || S.user?.email || '', gewijzigd: serverTimestamp() };
  if (s) await updateDoc(doc(db, 'teams', S.teamId, 'presentie', s.id), data);
  else await addDoc(collection(db, 'teams', S.teamId, 'presentie'), { ...data, gemaakt: serverTimestamp(), seizoen: S.huidigSeizoen || SEIZOEN_FALLBACK });
}
function htmlTrainingen(){
  const deze = trainingsdataWeek(0), volgende = trainingsdataWeek(1);
  const vorige = sessies().filter(s => s.datum < (deze[0] || vandaagISO())).slice(0, 6);
  const alle = [...deze, ...volgende, ...vorige.map(s => s.datum)];
  if (!alle.includes(selTraining) && !/^\d{4}-\d{2}-\d{2}$/.test(selTraining || '')){
    const v = vandaagISO();
    selTraining = deze.find(d => d === v) || deze.find(d => d > v) || deze[deze.length - 1] || volgende[0] || vorige[0]?.datum || null;
  }
  const datum = selTraining, sessie = datum ? sessieOp(datum) : null;
  const stof = datum ? oefenstofVoorDatum(datum) : null;
  const oef = stof && Array.isArray(stof.oefeningen) ? stof.oefeningen : [];
  const spelers = [...S.spelers].sort((a, b) => (Number(a.nummer) || 99) - (Number(b.nummer) || 99));
  const tegel = p => {
    const telt = !sessie || teltMee(sessie, p);
    const af = sessie && (sessie.afwezig || []).includes(p.id);
    const info = af && sessie.afwezigRedenen?.[p.id] ? afwezigRedenInfo(sessie.afwezigRedenen[p.id]) : null;
    return `<div class="dk-awwrap"><button class="dk-at ${!telt ? 'nvt' : af ? 'n' : sessie ? 'j' : ''}" data-dk="awopen" data-id="${esc(p.id)}">
        <i>${esc(p.nummer ?? voornaam(p).charAt(0))}</i><span>${esc(voornaam(p))}<small>${!telt ? 'telt niet mee' : af ? esc(info?.label || 'afwezig') : sessie ? 'aanwezig' : 'nog niet bevestigd'}</small></span></button>
      ${awOpen === p.id ? `<div class="dk-reden">${af ? `<button data-dk="awzet" data-id="${esc(p.id)}" data-r="">\u2713 Weer aanwezig</button>` : ''}${AFWEZIG_REDENEN.map(r => `<button data-dk="awzet" data-id="${esc(p.id)}" data-r="${esc(r.id)}">${r.ico ? ico(r.ico, 16) : r.emoji} ${esc(r.label)}</button>`).join('')}</div>` : ''}</div>`;
  };
  const aanw = sessie ? aanwezigTel(sessie) : spelers.length, tel = sessie ? meetellers(sessie) : spelers.length;
  return `<div class="dk-scherm">
    ${kop('Trainingen', `${knop('Presentie invullen', datum === vandaagISO() ? 'presentie' : 'presentieander', '', 'attendance-present')}${knop('Training plannen', 'tab', 'rood', 'action-add').replace('data-dk="tab"', 'data-dk="tab" data-tab="planning"')}`)}
    <div class="dk-drie dk-drie-tr">
      <aside class="dk-kol dk-lijstkol"><h5>Deze week \u00b7 week ${isoWeek()}</h5>${deze.length ? deze.map(trItem).join('') : '<p class="dk-leeg">Geen trainingen deze week. Stel trainingsdagen in bij Instellingen.</p>'}</aside>
      <section class="dk-kol dk-hart dk-scroll">${datum ? `<div class="dk-spook">${esc(String(Number(datum.slice(8, 10))))}</div>
        <h1 class="dk-groot">${esc(datumMooi(datum, { weekday:'long' }))} ${esc(datum.slice(8, 10) + '/' + datum.slice(5, 7))}<span class="dk-omlijnd dk-klein">${esc(stof?.titel || 'Geen oefenstof gekoppeld')}</span></h1>
        <div class="dk-pills"><span class="dk-pill">Week ${isoWeekVan(datum)}</span>${sessie ? `<span class="dk-pill groen">${aanw} van ${tel} aanwezig</span>` : '<span class="dk-pill oranje">Presentie nog niet ingevuld</span>'}</div>
        <div><h3 class="dk-label">Aanwezigheid<span>${sessie ? `${aanw} van ${tel}` : 'iedereen aanwezig tot je iemand afmeldt'} \u00b7 tik om af te melden</span></h3>
          <div class="dk-aanwtegels">${spelers.map(tegel).join('')}</div></div>
        <div><h3 class="dk-label">Training van deze dag<span>${stof ? esc(stof.week || '') : ''}</span></h3>
          ${stof ? `<div class="dk-pdfbalk"><canvas class="dk-pdfthumb" data-pdf="${esc(stof.url || '')}"></canvas>
              <div><b>${esc(stof.titel || stof.bestandsnaam || 'Training')}</b><small>${esc([stof.week, oef.length ? oef.length + ' oefeningen' : 'PDF'].filter(Boolean).join(' \u00b7 '))}</small>
              <div class="dk-rij-knoppen">${stof.url ? knop('Origineel', 'stofpdf', '', 'admin-document').replace('data-dk="stofpdf"', `data-dk="stofpdf" data-id="${esc(stof.id)}"`) : ''}${knop('Volledig scherm', 'stof', '', 'training-view').replace('data-dk="stof"', `data-dk="stof" data-id="${esc(stof.id)}"`)}</div></div></div>
            ${oef.length ? `<div class="dk-oefeningen trw-inline">${oef.map((o, i) => oefHtml(i + 1, o, stof.diagramUrls || {})).join('')}</div>` : '<p class="dk-leeg">Deze oefenstof is (nog) niet uitgewerkt in oefeningen. Open het origineel voor de PDF.</p>'}`
          : '<p class="dk-leeg">Voor deze week staat nog geen oefenstof klaar voor dit team.</p>'}</div>` : '<p class="dk-leeg">Kies een training.</p>'}
      </section>
      <aside class="dk-kol dk-zijkol dk-scroll">
        <div><h3 class="dk-label">Volgende week<span>week ${isoWeek() + 1 > 53 ? 1 : isoWeek() + 1}</span></h3>${volgende.map(trItem).join('') || '<p class="dk-leeg">Niets gepland.</p>'}</div>
        <div><h3 class="dk-label">Voorgaande trainingen</h3>${vorige.map(s => trItem(s.datum)).join('') || '<p class="dk-leeg">Nog geen trainingen met presentie.</p>'}</div>
      </aside>
    </div></div>`;
}

/* PDF-voorvertoning (eerste pagina) in een canvas, via de pdf.js die de
   bestaande pdf-viewer ook gebruikt. Mislukt het, dan blijft het canvas leeg. */
async function tekenPdfs(v){
  const els = [...v.querySelectorAll('canvas[data-pdf]:not([data-klaar]), div[data-pdfvol]:not([data-klaar])')];
  if (!els.length) return;
  try { await laadPdfJs(); } catch(e){ return; }
  for (const el of els){
    el.dataset.klaar = '1';
    const url = el.dataset.pdf || el.dataset.pdfvol; if (!url) continue;
    try {
      const bytes = new Uint8Array(await (await fetch(url)).arrayBuffer());
      const pdf = await window.pdfjsLib.getDocument({ data: bytes }).promise;
      const paginas = el.dataset.pdfvol ? Math.min(pdf.numPages, 20) : 1;
      for (let n = 1; n <= paginas; n++){
        const page = await pdf.getPage(n);
        const breedte = el.dataset.pdfvol ? Math.max(300, el.clientWidth - 8) : 110;
        const vp0 = page.getViewport({ scale: 1 }), schaal = breedte / vp0.width * (window.devicePixelRatio || 1);
        const vp = page.getViewport({ scale: schaal });
        const c = el.tagName === 'CANVAS' ? el : el.appendChild(document.createElement('canvas'));
        c.width = Math.ceil(vp.width); c.height = Math.ceil(vp.height);
        c.style.width = breedte + 'px';
        await page.render({ canvasContext: c.getContext('2d'), viewport: vp }).promise;
      }
    } catch(e){ if (el.dataset.pdfvol) el.innerHTML = '<p class="dk-leeg">Dit document kan niet in de pagina getoond worden. Gebruik \u201cGroot openen\u201d.</p>'; }
  }
}

/* ==================== EVALUATIE (team, per wedstrijd) ==================== */
function evGemiddelde(scores){ const w = Object.values(scores || {}).map(Number).filter(Boolean); return w.length ? gem(w) : 0; }
function radarN(vals, gemVals, labels, kleuren){
  const n = vals.length, cx = 200, cy = 190, R = 140;
  const pt = (v, i) => { const a = -Math.PI / 2 + i * 2 * Math.PI / n, r = R * (v || 0) / 5; return [cx + r * Math.cos(a), cy + r * Math.sin(a)]; };
  const pp = a => a.map(p => p.map(x => x.toFixed(1)).join(',')).join(' ');
  return `<svg class="dk-radar-svg" viewBox="0 0 400 380">${[1, 2, 3, 4, 5].map(l => `<polygon points="${pp(vals.map((_, i) => pt(l, i)))}" fill="none" style="stroke:var(--line-d)"/>`).join('')}
    ${labels.map((l, i) => { const [x, y] = pt(6.2, i); return `<text x="${x.toFixed(1)}" y="${(y + 4).toFixed(1)}" text-anchor="middle" font-size="12" font-weight="700" style="fill:${kleuren[i]}">${esc(l)}</text>`; }).join('')}
    ${gemVals && gemVals.some(Boolean) ? `<polygon points="${pp(gemVals.map(pt))}" fill="none" style="stroke:var(--ink-2)" stroke-width="1.5" stroke-dasharray="4 4"/>` : ''}
    <polygon points="${pp(vals.map(pt))}" fill="rgba(226,52,47,.26)" stroke="#e2342f" stroke-width="2.4" stroke-linejoin="round"/>
    ${vals.map((v, i) => { const [x, y] = pt(v, i); return v ? `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="5" style="fill:${kleuren[i]}"/>` : ''; }).join('')}</svg>`;
}
function htmlEvaluatie(){
  if (!modAan('evaluaties')) return null;
  const lijst = afgelopen();
  if (!lijst.find(w => w.id === evSel)) evSel = (lijst.find(w => !(S.teamEvaluaties || []).some(e => e.wedstrijdId === w.id)) || lijst[0])?.id || null;
  const w = lijst.find(x => x.id === evSel);
  if (w && evConcept?.wid !== w.id){
    const b = (S.teamEvaluaties || []).find(e => e.wedstrijdId === w.id);
    evConcept = { wid: w.id, scores: { ...(b?.scores || {}) }, tags: new Set(b?.tags || []), goed: b?.notitieGoed || '', aandacht: b?.notitieAandacht || '', bestaat: !!b };
  }
  const evals = (S.teamEvaluaties || []).filter(e => e.scores);
  const seizoen = TEAM_CATEGORIEEN.map(c => { const v = evals.map(e => Number(e.scores[c.id])).filter(Boolean); return v.length ? gem(v) : 0; });
  const vals = TEAM_CATEGORIEEN.map(c => Number(evConcept?.scores[c.id]) || 0);
  const pct = Math.round(evGemiddelde(evConcept?.scores) / 5 * 100);
  const verloop = evals.filter(e => e.datum).sort((a, b) => a.datum.localeCompare(b.datum)).map(e => evGemiddelde(e.scores));
  const item = x => { const e = (S.teamEvaluaties || []).find(t => t.wedstrijdId === x.id), st = stand(x);
    return `<button class="dk-li ${x.id === evSel ? 'actief' : ''}" data-dk="evsel" data-id="${esc(x.id)}">
      <span class="dk-li-dt">${esc(String(Number((x.datum || '').slice(8, 10)) || ''))}<small>${esc(datumMooi(x.datum, { month:'short' }))}</small></span>
      <span class="dk-li-t"><b>${esc(x.tegenstander || 'Tegenstander')}</b><small>${st.links}\u2013${st.rechts} \u00b7 ${x.thuis ? 'thuis' : 'uit'}</small></span>
      ${e ? `<span class="dk-pill groen">${Math.round(evGemiddelde(e.scores) / 5 * 100)}%</span>` : '<span class="dk-pill rood">evalueren</span>'}</button>`; };
  return `<div class="dk-scherm">
    ${kop('Evaluatie wedstrijden', w ? knop(evConcept.bestaat ? 'Bijwerken' : 'Opslaan', 'evsave', 'rood', 'action-check') : '')}
    <div class="dk-drie dk-drie-ev">
      <aside class="dk-kol dk-lijstkol">${lijst.length ? lijst.map(item).join('') : '<p class="dk-leeg">Nog geen gespeelde wedstrijden.</p>'}</aside>
      <section class="dk-kol dk-scroll dk-evform">${w ? `<h3 class="dk-label">${esc(w.tegenstander || '')} \u00b7 ${stand(w).links}\u2013${stand(w).rechts}<span>tik een niveau; nog eens tikken = overslaan</span></h3>
        ${TEAM_CATEGORIEEN.map(c => `<div class="dk-evcat"><b>${esc(c.naam)}</b><div class="dk-kb">${NIVEAUS.slice(1).map(n => { const aan = Number(evConcept.scores[c.id]) === n.n;
          return `<button data-dk="evniv" data-id="${esc(c.id)}" data-n="${n.n}" class="${aan ? 'aan' : ''}" style="${aan ? 'background:' + niveauKleur(n.n) : ''}">${esc(n.label)}</button>`; }).join('')}</div></div>`).join('')}
        <div class="dk-evcat"><b>Opvallend</b><div class="dk-tags">${TEAM_TAGS.map(t => `<button data-dk="evtag" data-id="${esc(t.id)}" class="${evConcept.tags.has(t.id) ? 'aan' : ''}">${t.ico ? ico(t.ico, 15) : t.emoji} ${esc(t.label)}</button>`).join('')}</div></div>
        <textarea class="dk-ta" data-dkin="goed" rows="2" placeholder="Wat ging het beste? (optioneel)">${esc(evConcept.goed)}</textarea>
        <textarea class="dk-ta" data-dkin="aandacht" rows="2" placeholder="Aandachtspunt voor de volgende training (optioneel)">${esc(evConcept.aandacht)}</textarea>` : '<p class="dk-leeg">Kies een wedstrijd.</p>'}</section>
      <aside class="dk-kol dk-evradar">${w ? `<div class="dk-evkop"><div class="dk-ring" style="--p:${pct}"><span>${pct || '\u2013'}</span></div><p>Teamscore van deze wedstrijd.<br>Stippellijn = seizoensgemiddelde.</p></div>
        ${radarN(vals, seizoen, TEAM_CATEGORIEEN.map(c => c.naam.split(/[ &\/]/)[0]), TEAM_CATEGORIEEN.map(c => Number(evConcept.scores[c.id]) ? niveauKleur(Number(evConcept.scores[c.id])) : 'var(--ink-2)'))}
        ${verloop.length > 1 ? `<div class="dk-blok"><h3 class="dk-label">Seizoensverloop<span>${verloop.length} evaluaties</span></h3>${sparkGroot(verloop)}</div>` : ''}` : ''}</aside>
    </div></div>`;
}
function sparkGroot(t){
  const W = 300, H = 70, mn = 1, mx = 5;
  return `<svg viewBox="0 0 ${W} ${H}" class="dk-spark"><polyline points="${t.map((v, i) => `${(8 + i / (t.length - 1) * (W - 16)).toFixed(1)},${(H - 6 - (v - mn) / (mx - mn) * (H - 12)).toFixed(1)}`).join(' ')}" fill="none" style="stroke:var(--in)" stroke-width="3" stroke-linejoin="round"/></svg>`;
}

/* ==================== STATS ==================== */
function htmlStats(){
  const rij = [...S.spelers].sort((a, b) => (Number(a.nummer) || 99) - (Number(b.nummer) || 99)).map(p => ({ p, st: statsVan(p.id), k: kaart(p) }));
  const afg = afgelopen().filter(w => (w.goals || []).length || analyse(w).kwarten);
  let voor = 0, tegen = 0, punten = 0;
  for (const w of afg){ const st = stand(w); voor += st.voor; tegen += st.tegen; punten += st.voor > st.tegen ? 3 : st.voor === st.tegen ? 1 : 0; }
  const opk = sessies().length ? Math.round(gem(sessies().map(s => meetellers(s) ? aanwezigTel(s) / meetellers(s) * 100 : 0))) : null;
  const scorers = rij.filter(r => r.st.goals).sort((a, b) => b.st.goals - a.st.goals).slice(0, 6);
  const mxg = Math.max(1, ...scorers.map(r => r.st.goals));
  return `<div class="dk-scherm">
    ${kop('Stats')}
    <div class="dk-stats">
      <div class="dk-blok dk-tabelblok"><table class="dk-tabel"><thead><tr><th>#</th><th>Speler</th><th class="n">Wedstr.</th><th>Speeltijd / reserve</th><th class="n">Goals</th><th class="n">Opkomst</th><th class="n">Kaart</th></tr></thead><tbody>
        ${rij.map(({ p, st, k }) => `<tr data-dk="openprofiel" data-id="${esc(p.id)}"><td>${esc(p.nummer ?? '')}</td><td><b>${esc(voornaam(p))}</b></td><td class="n">${st.wedstrijden}</td><td>${sbBalk('', st, false)}</td><td class="n">${st.goals}</td><td class="n">${st.opkomst != null ? st.opkomst + '%' : '\u2013'}</td><td class="n"><b>${k.ovr ?? '\u2013'}</b>${k.snel ? '<small> snel</small>' : ''}</td></tr>`).join('')}
      </tbody></table></div>
      <div class="dk-statszij">
        <div class="dk-tegels smal"><div><b>${afg.length}</b><small>Wedstrijden</small></div><div><b>${voor}\u2013${tegen}</b><small>Doelsaldo</small></div>
          <div><b>${opk != null ? opk + '%' : '\u2013'}</b><small>Opkomst</small></div><div><b>${afg.length ? (punten / afg.length).toFixed(1).replace('.', ',') : '\u2013'}</b><small>Punten gem.</small></div></div>
        <div class="dk-blok"><h3 class="dk-label">Doelpunten per speler</h3>${scorers.map(r => `<div class="dk-sb zonder-leg"><span>${esc(voornaam(r.p))}</span><i><b class="r" style="width:${r.st.goals / mxg * 100}%"></b></i><em><b>${r.st.goals}</b></em></div>`).join('') || '<p class="dk-leeg">Nog geen doelpunten.</p>'}</div>
      </div></div></div>`;
}

/* ==================== PLANNING (maandkalender) ====================
   [20260923b] Maandkalender met speeldagen/wedstrijden uit planningItems()
   (dezelfde bron als de gewone planning) plus de vaste trainingsdagen van het
   team. Klik op een wedstrijd opent die, op een speeldag de bestaande
   dag-modal, op een training het scherm Trainingen op die datum. */
const PLAN_SOORT = { wedstrijd:['Wedstrijd', 'wed'], wd:['Wedstrijddag', 'wd'], beker:['Beker', 'bek'], inhaal:['Inhaal', 'inh'],
  vrij:['Vrij', 'vrij'], eigen:['Eigen dag', 'eig'], training:['Training', 'tr'], lijst:['Lijst', 'lijst'] };
const PLAN_KNOPPEN = [['alles', 'Alles'], ['wedstrijd', 'Wedstrijden'], ['training', 'Trainingen'], ['wd', 'Speeldagen'], ['beker', 'Beker'], ['vrij', 'Vrij']];
function planAlles(){
  let items = [];
  try { items = planningItems().map(it => ({ ...it })); } catch(e){ items = []; }
  const vrij = new Set(items.filter(it => it.type === 'vrij').map(it => it.datum));
  const dagen = Array.isArray(S.team?.trainingsdagen) ? S.team.trainingsdagen : [];
  if (dagen.length){
    const van = new Date(); van.setMonth(van.getMonth() - 3); van.setDate(1); van.setHours(12, 0, 0, 0);
    const tot = new Date(); tot.setMonth(tot.getMonth() + 9);
    for (const d = new Date(van); d <= tot; d.setDate(d.getDate() + 1)){
      const iso = d.toISOString().slice(0, 10), wd = ((d.getDay() + 6) % 7) + 1;
      if (dagen.includes(wd) && !vrij.has(iso)) items.push({ datum: iso, type: 'training', bron: 'training', label: oefenstofVoorDatum(iso)?.titel || 'Training' });
    }
  }
  for (const s of (S.presentie || [])) if (s.datum && !items.some(it => it.type === 'training' && it.datum === s.datum))
    items.push({ datum: s.datum, type: 'training', bron: 'training', label: 'Training' });
  return items.sort((a, b) => a.datum.localeCompare(b.datum) || (a.type === 'training' ? 1 : -1));
}
function planEvent(it){
  const [naam, klas] = PLAN_SOORT[it.type] || PLAN_SOORT.eigen;
  const w = it.bron === 'wedstrijd' ? (S.wedstrijden || []).find(x => x.id === it.docId) : null;
  const tijd = w?.aftrap ? w.aftrap + ' ' : '';
  return `<button class="dk-ev ${klas}" data-dk="plandag" data-datum="${esc(it.datum)}" data-bron="${esc(it.bron || '')}" data-doc="${esc(it.docId || '')}" title="${esc(naam + ': ' + (it.label || ''))}">${esc(tijd + (it.label || naam))}</button>`;
}
function htmlPlanning(){
  const vandaag = vandaagISO();
  if (!planMaand) planMaand = vandaag.slice(0, 7);
  const alles = planAlles();
  const items = planFilter === 'alles' ? alles : alles.filter(it => it.type === planFilter || (planFilter === 'wd' && it.type === 'inhaal'));
  const [jr, mn] = planMaand.split('-').map(Number);
  const eerste = new Date(jr, mn - 1, 1, 12), start = new Date(eerste); start.setDate(1 - ((eerste.getDay() + 6) % 7));
  const cellen = [];
  for (let i = 0; i < 42; i++){ const d = new Date(start); d.setDate(start.getDate() + i); cellen.push(d); if (i >= 34 && d.getMonth() !== mn - 1 && d.getDay() === 0) break; }
  const perDag = {}; for (const it of items) (perDag[it.datum] ||= []).push(it);
  const maandNaam = eerste.toLocaleDateString('nl-NL', { month:'long', year:'numeric' });
  const komend = items.filter(it => it.datum >= vandaag).slice(0, 12);
  return `<div class="dk-scherm">
    ${kop('Planning', knop('Eigen dag', 'eigendag', 'rood', 'action-add'))}
    <div class="dk-plan">
      <section class="dk-kol dk-plan-hart">
        <div class="dk-plan-kop"><h1 class="dk-groot">${esc(maandNaam)}</h1>
          <div class="dk-filter">${PLAN_KNOPPEN.map(([id, l]) => `<button class="${planFilter === id ? 'actief' : ''}" data-dk="planfilter" data-f="${id}">${l}</button>`).join('')}</div>
          <div class="dk-plan-nav"><button class="dk-knop" data-dk="planmaand" data-d="-1" title="Vorige maand">\u2039</button><button class="dk-knop" data-dk="planmaand" data-d="0">Vandaag</button><button class="dk-knop" data-dk="planmaand" data-d="1" title="Volgende maand">\u203a</button></div></div>
        <div class="dk-kal">${['ma', 'di', 'wo', 'do', 'vr', 'za', 'zo'].map(d => `<div class="dk-kal-dag">${d}</div>`).join('')}
          ${cellen.map(d => { const iso = new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10); const ev = perDag[iso] || [];
            return `<div class="dk-kal-cel ${d.getMonth() !== mn - 1 ? 'buiten' : ''} ${iso === vandaag ? 'vandaag' : ''} ${ev.some(e => e.type === 'vrij') ? 'vrij' : ''}"><b>${d.getDate()}</b>${ev.slice(0, 3).map(planEvent).join('')}${ev.length > 3 ? `<small>+${ev.length - 3} meer</small>` : ''}</div>`; }).join('')}</div>
        <div class="dk-plan-leg">${['wedstrijd', 'training', 'wd', 'beker', 'vrij', 'eigen', 'lijst'].map(t => `<span><i class="dk-ev ${PLAN_SOORT[t][1]}"></i>${PLAN_SOORT[t][0]}</span>`).join('')}</div>
      </section>
      <aside class="dk-kol dk-zijkol"><div><h3 class="dk-label">Komende activiteiten<span>${komend.length}</span></h3>
        ${komend.map(it => `<button class="dk-plan-rij" data-dk="plandag" data-datum="${esc(it.datum)}" data-bron="${esc(it.bron || '')}" data-doc="${esc(it.docId || '')}"><i class="dk-ev ${(PLAN_SOORT[it.type] || PLAN_SOORT.eigen)[1]}"></i>
          <span><b>${esc(it.label || (PLAN_SOORT[it.type] || PLAN_SOORT.eigen)[0])}</b><small>${esc(kortDatum(it.datum))}${it.opmerking ? ' \u00b7 ' + esc(it.opmerking) : ''}</small></span></button>`).join('') || '<p class="dk-leeg">Niets gepland.</p>'}
      </div></aside>
    </div></div>`;
}

/* ==================== DOCUMENTEN ==================== */
const DOC_CAT = [['knvb', 'KNVB'], ['beleid', 'Beleid'], ['overig', 'Overig']];
function htmlDocumenten(){
  const lijst = (S.documenten || []).filter(d => (d.teams || []).includes(S.teamId))
    .sort((a, b) => (b.gemaakt?.seconds || 0) - (a.gemaakt?.seconds || 0));
  if (!lijst.find(d => d.id === selDoc)) selDoc = lijst[0]?.id || null;
  const d = lijst.find(x => x.id === selDoc);
  const rij = x => `<button class="dk-li dk-docli ${x.id === selDoc ? 'actief' : ''}" data-dk="seldoc" data-id="${esc(x.id)}"><span class="dk-docico">${ico('admin-document', 18)}</span>
    <span class="dk-li-t"><b>${esc(x.titel || x.bestandsnaam || 'Document')}</b><small>${esc(x.gemaakt?.seconds ? new Date(x.gemaakt.seconds * 1000).toLocaleDateString('nl-NL', { day:'numeric', month:'short' }) : '')}</small></span>
    ${!S.trainingenGelezen?.[x.id] ? '<span class="dk-pill rood">nieuw</span>' : ''}</button>`;
  return `<div class="dk-scherm">
    ${kop('Documenten')}
    <div class="dk-docs">
      <aside class="dk-kol dk-lijstkol">${lijst.length ? DOC_CAT.map(([id, naam]) => { const g = lijst.filter(x => (x.categorie || 'overig') === id); return g.length ? `<h5>${naam}</h5>${g.map(rij).join('')}` : ''; }).join('') : '<p class="dk-leeg">Nog geen documenten voor dit team. Je clubadmin kan hier stukken delen.</p>'}</aside>
      <section class="dk-kol dk-docview">${d ? `<div class="dk-dockop"><b>${esc(d.titel || d.bestandsnaam || 'Document')}</b>
          <span class="dk-acties">${knop('Groot openen', 'docgroot', 'rood', 'training-view').replace('data-dk="docgroot"', `data-dk="docgroot" data-id="${esc(d.id)}"`)}</span></div>
        <div class="dk-docpaginas" data-pdfvol="${esc(d.url || '')}"></div>` : ''}</section>
    </div></div>`;
}

/* ==================== LEERLIJN (leerlijnoverzicht) ==================== */
function statusPerThema(thema){
  const uit = { niet:[], werkt:[], klaar:[], weken:{} };
  for (const p of S.spelers){
    const lp = (p.leerpunten || []).filter(l => l.tekst === thema);
    if (!lp.length){ uit.niet.push(p); continue; }
    if (lp.some(l => !l.klaar)) uit.werkt.push(p); else uit.klaar.push(p);
    for (const l of lp) if (l.klaar && l.klaarOp){ const wk = isoWeekVan(l.klaarOp); uit.weken[wk] = (uit.weken[wk] || 0) + 1; }
  }
  return uit;
}
function htmlLeerlijn(){
  const cat = S.team?.categorie;
  if (!LEERCURVE.find(t => t.thema === selThema)) selThema = (LEERCURVE.find(t => leercurveRelevant(t, cat) && statusPerThema(t.thema).werkt.length) || LEERCURVE.find(t => leercurveRelevant(t, cat)) || LEERCURVE[0]).thema;
  const t = LEERCURVE.find(x => x.thema === selThema), dom = SKILLS.find(d => d.id === t.domein);
  const st = statusPerThema(t.thema);
  const c = (() => { try { return contentVoorThema(t.thema); } catch(e){ return null; } })();
  const nu = isoWeek(); const weken = Array.from({ length: 8 }, (_, i) => ((nu - 7 + i - 1 + 52) % 52) + 1);
  const mx = Math.max(1, ...weken.map(w => st.weken[w] || 0));
  const eigen = S.spelers.reduce((n, p) => n + (p.leerpunten || []).filter(l => !LEERCURVE.some(x => x.thema === l.tekst)).length, 0);
  const kopje = (pp, dk) => pp.map(p => `<button class="dk-kopje" data-dk="${dk}" data-id="${esc(p.id)}" title="${dk === 'lpthema' ? 'Leerpunt toevoegen met dit thema' : 'Paspoort openen'}"><i>${esc(p.nummer ?? voornaam(p).charAt(0))}</i>${esc(voornaam(p))}</button>`).join('');
  return `<div class="dk-scherm">
    ${kop('Leerlijn')}
    <div class="dk-drie">
      <aside class="dk-kol dk-lijstkol"><h5>Leercurve \u00b7 jeugdbeleidsplan \u00a73.3</h5>
        ${LEERCURVE.map((x, i) => { const s = statusPerThema(x.thema), rel = leercurveRelevant(x, cat); const d = SKILLS.find(k => k.id === x.domein);
          return `<button class="dk-th ${x.thema === selThema ? 'actief' : ''} ${rel ? '' : 'later'}" data-dk="selth" data-i="${i}"><b><i style="background:${d?.kleur}"></i>${esc(x.thema)}</b><small>${esc(x.domein)} \u00b7 vanaf O${x.vanaf}</small>${rel ? `<span class="dk-th-tel"><span class="w" title="werkt eraan">${s.werkt.length}</span><span class="a" title="afgerond">${s.klaar.length}</span></span>` : ''}</button>`; }).join('')}
        ${eigen ? `<p class="dk-voetnoot">${eigen} leerpunt${eigen === 1 ? '' : 'en'} met een eigen tekst vallen buiten deze thema\u2019s.</p>` : ''}</aside>
      <section class="dk-kol dk-hart"><div class="dk-spook">${String(LEERCURVE.indexOf(t) + 1).padStart(2, '0')}</div>
        <h1 class="dk-groot">${esc(t.thema)}</h1>
        <div class="dk-pills"><span class="dk-pill" style="color:${dom?.kleur}"><i class="dk-stip" style="background:${dom?.kleur}"></i>${esc(dom?.kort || t.domein)}</span><span class="dk-pill">vanaf O${t.vanaf}</span>${leercurveRelevant(t, cat) ? '' : `<span class="dk-pill oranje">Nog niet aan de orde voor ${esc(cat || 'dit team')}</span>`}</div>
        <div class="dk-drie-kol">
          <div class="dk-status"><h4>Nog niet<em>${st.niet.length}</em></h4><p>Tik een speler om dit leerpunt toe te voegen</p><div>${kopje(st.niet, 'lpthema')}</div></div>
          <div class="dk-status w"><h4>Werkt eraan<em>${st.werkt.length}</em></h4><p>Open leerpunt</p><div>${kopje(st.werkt, 'profiel')}</div></div>
          <div class="dk-status a"><h4>Afgerond<em>${st.klaar.length}</em></h4><p>Leerpunt afgevinkt</p><div>${kopje(st.klaar, 'profiel')}</div></div>
        </div>
        <div class="dk-blok"><h3>Afgeronde leerpunten per week<span>laatste 8 weken</span></h3>
          <div class="dk-staven">${weken.map(w => `<div><i style="height:${Math.max(3, (st.weken[w] || 0) / mx * 64)}px" class="${st.weken[w] ? '' : 'nul'}"></i>wk ${w}</div>`).join('')}</div></div>
      </section>
      <aside class="dk-kol dk-zijkol"><div><h3 class="dk-label">${ico('action-info', 16)}ASV-kompas<span>bij dit thema</span></h3>
        ${c?.achtergrond ? `<div class="dk-tip"><p>${esc(c.achtergrond)}</p></div>` : ''}
        ${(c?.tips || []).slice(0, 4).map(tip => `<div class="dk-tip"><p>${esc(tip)}</p></div>`).join('') || (!c?.achtergrond ? '<p class="dk-leeg">Nog geen kompas-tekst voor dit thema.</p>' : '')}</div>
      </aside>
    </div></div>`;
}

/* ==================== koppelen ==================== */
async function actie(b){
  const a = b.dataset.dk, id = b.dataset.id;
  if (a === 'klassiek'){ klassiekTab = S.teamTab; if (S.teamTab === 'spelers' && S._beoordeelProfiel) klassiekProfiel = S._beoordeelProfiel; renderTeam(); return; }
  if (a === 'tab'){ S._beoordeelProfiel = null; zetTeamTab(b.dataset.tab); return; }
  if (a === 'openw'){ const m = await import('./wedstrijd.js?v=20260924b'); m.openWedstrijd(id); return; }
  if (a === 'nieuwew'){ const m = await import('./wedstrijd.js?v=20260924b'); m.modalNieuweWedstrijd(); return; }
  if (a === 'evalueer'){ modalTeamEvaluatie(id); return; }
  if (a === 'presentie'){ const m = await import('./teams-training.js?v=20260922c'); m.modalPresentie(); return; }
  if (a === 'presentieander'){ const m = await import('./teams-training.js?v=20260922c'); m.modalPresentie(null, { startAnder:true }); return; }
  if (a === 'presentiewijzig'){ const s = (S.presentie || []).find(x => x.id === id); const m = await import('./teams-training.js?v=20260922c'); m.modalPresentie(s || null); return; }
  if (a === 'stof'){ openOefenstof(id); return; }
  if (a === 'profiel'){ klassiekProfiel = null; S._beoordeelProfiel = id; if (S.teamTab !== 'spelers') zetTeamTab('spelers'); else renderTeam(); return; }
  if (a === 'terugsel'){ S._dkModus = null; S._beoordeelProfiel = null; renderTeam(); return; }
  if (a === 'volprofiel'){ klassiekProfiel = S._beoordeelProfiel; renderTeam(); return; }
  if (a === 'beoordeel'){ const m = await import('./teams-spelers.js?v=20260924b'); m.modalVolledigeBeoordeling(S._beoordeelProfiel); return; }
  if (a === 'leerpunt'){ const m = await import('./teams-spelers.js?v=20260924b'); m.modalLeerpunt(S._beoordeelProfiel); return; }
  if (a === 'lpthema'){ const m = await import('./teams-spelers.js?v=20260924b'); m.modalLeerpunt(id, selThema); return; }
  if (a === 'snelronde'){ const m = await import('./teams-spelers.js?v=20260924b'); m.startSnelRonde(); return; }
  if (a === 'nieuwsp'){ const m = await import('./teams-spelers.js?v=20260924b'); m.modalSpeler(null); return; }
  if (a === 'filter'){ spFilter = b.dataset.f; renderTeam(); return; }
  if (a === 'selw'){ selWedstrijd = id; renderTeam(); return; }
  if (a === 'seltr'){ selTraining = id; renderTeam(); return; }
  if (a === 'selth'){ selThema = LEERCURVE[Number(b.dataset.i)]?.thema || selThema; renderTeam(); return; }
  /* [20260923a] */
  if (a === 'openprofiel'){ S._dkModus = null; S._beoordeelProfiel = id; S._profielTab = 'overzicht'; if (S.teamTab !== 'spelers') zetTeamTab('spelers'); else renderTeam(); return; }
  if (a === 'evmodus'){ S._dkModus = 'evaluatie'; S._beoordeelProfiel = S._beoordeelProfiel || eersteSpeler(); renderTeam(); return; }
  if (a === 'snel'){ const m = await import('./teams-spelers.js?v=20260924b'); m.modalSnelBeoordeling(S._beoordeelProfiel); return; }
  if (a === 'evopen'){ const bo = S.beoordelingen.find(x => x.id === id); if (!bo) return; const m = await import('./teams-spelers.js?v=20260924b');
    if (bo.soort === 'snel') m.modalSnelBeoordeling(bo.spelerId, bo); else m.modalVolledigeBeoordeling(bo.spelerId, bo); return; }
  if (a === 'awopen'){ awOpen = awOpen === id ? null : id; renderTeam(); return; }
  if (a === 'awzet'){ const pid = id, reden = b.dataset.r || null; awOpen = null;
    try { await zetPresentie(selTraining, pid, reden); meld(reden ? `${voornaam(speler(pid))} afgemeld` : `${voornaam(speler(pid))} weer aanwezig`); }
    catch(e){ meld('Opslaan mislukt: ' + (e.code || e.message)); }
    renderTeam(); return; }
  if (a === 'stofpdf'){ const t = S.trainingen.find(x => x.id === id); if (!t?.url) return; const { openPdfViewer } = await import('./pdf-viewer.js?v=20260922c'); openPdfViewer({ url: t.url, titel: t.titel || 'Training', meta: t.week || '' }); return; }
  if (a === 'evsel'){ evSel = id; renderTeam(); return; }
  if (a === 'evniv'){ const n = Number(b.dataset.n); if (Number(evConcept.scores[id]) === n) delete evConcept.scores[id]; else evConcept.scores[id] = n; renderTeam(); return; }
  if (a === 'evtag'){ evConcept.tags.has(id) ? evConcept.tags.delete(id) : evConcept.tags.add(id); renderTeam(); return; }
  if (a === 'evsave'){ const ok = await bewaarTeamEvaluatie(evConcept.wid, { scores: evConcept.scores, tags: [...evConcept.tags], notitieGoed: evConcept.goed.trim(), notitieAandacht: evConcept.aandacht.trim() });
    if (ok){ evConcept.bestaat = true; setTimeout(() => renderTeam(), 400); } return; }
  if (a === 'sppos'){ spPositie.pos = spPositie.pos === b.dataset.pos && !b.textContent.startsWith('Overnemen') ? '' : b.dataset.pos;
    const bewaard = { naam: $('#dkSpNaam')?.value, nr: $('#dkSpNr')?.value, achter: $('#dkSpAchter')?.value, notitie: $('#dkSpNotitie')?.value };
    renderTeam();
    if ($('#dkSpNaam')){ $('#dkSpNaam').value = bewaard.naam ?? ''; $('#dkSpNr').value = bewaard.nr ?? ''; $('#dkSpAchter').value = bewaard.achter ?? ''; $('#dkSpNotitie').value = bewaard.notitie ?? ''; }
    return; }
  if (a === 'spopslaan'){ await bewaarSpelerDesk(); return; }
  if (a === 'spuitleen'){ const m = await import('./teams-spelers.js?v=20260924b'); m.modalUitlenen(S._beoordeelProfiel); return; }
  if (a === 'spterug'){ const m = await import('./teams-spelers.js?v=20260924b'); await m.trekUitleningIn(id); renderTeam(); return; }
  if (a === 'sphis'){ S._dkModus = null; S._profielTab = 'historie'; renderTeam(); return; }
  if (a === 'spweg'){ const p = speler(S._beoordeelProfiel); if (!p) return;
    if (p._ingeleend) return meld('Een ingeleende speler kun je niet verwijderen — zet hem terug naar het bronteam');
    if (!confirm(`${p.naam} verwijderen uit de selectie? Beoordelingen en leerpunten gaan ook verloren.`)) return;
    try { await deleteDoc(doc(db, 'teams', S.teamId, 'spelers', p.id)); S._beoordeelProfiel = null; renderTeam(); } catch(e){ meld('Verwijderen mislukt: ' + (e.code || e.message)); }
    return; }
  if (a === 'planfilter'){ planFilter = b.dataset.f; renderTeam(); return; }
  if (a === 'planmaand'){ const d = Number(b.dataset.d);
    if (!d) planMaand = vandaagISO().slice(0, 7);
    else { const [j, m] = planMaand.split('-').map(Number); const x = new Date(j, m - 1 + d, 1, 12); planMaand = x.getFullYear() + '-' + String(x.getMonth() + 1).padStart(2, '0'); }
    renderTeam(); return; }
  if (a === 'eigendag'){ const m = await import('./teams-training.js?v=20260922c'); m.modalEigenDag(); return; }
  if (a === 'plandag'){ const { datum, bron, doc: did } = b.dataset;
    if (bron === 'wedstrijd' && did){ const m = await import('./wedstrijd.js?v=20260924b'); m.openWedstrijd(did); return; }
    if (bron === 'training'){ selTraining = datum; zetTeamTab('presentietraining'); return; }
    if (bron === 'lijst' && did){ S._lijstOpen = did; S._ljFilter = 'alle'; S._ljToonEerder = false; zetTeamTab('lijst'); return; }
    const it = planningItems().find(x => x.datum === datum && x.bron === bron);
    if (it){ const m = await import('./teams-training.js?v=20260922c'); m.modalPlanDag(it); } return; }
  if (a === 'seldoc'){ selDoc = id; renderTeam(); markeerGelezen(id); return; }
  if (a === 'docgroot'){ const d = (S.documenten || []).find(x => x.id === id); if (!d?.url) return; const { openPdfViewer } = await import('./pdf-viewer.js?v=20260922c'); openPdfViewer({ url: d.url, titel: d.titel || 'Document', meta: '' }); markeerGelezen(id); return; }
}
function eersteSpeler(){ return [...S.spelers].sort((a, b) => (Number(a.nummer) || 99) - (Number(b.nummer) || 99))[0]?.id || null; }
async function markeerGelezen(id){ if (!id || S.trainingenGelezen?.[id]) return; try { await setDoc(doc(db, 'gebruikers', S.user.uid, 'gelezen', id), { tijd: serverTimestamp() }); } catch(e){} }
function koppel(v){
  v.onclick = e => {
    const b = e.target.closest('[data-dk]');
    if (!b || !v.contains(b)) return;
    actie(b).catch(err => console.warn('[Cluppie] desktop-actie mislukt', err));
  };
  v.oninput = e => { const t = e.target.closest('[data-dkin]'); if (t && evConcept) evConcept[t.dataset.dkin] = t.value; };
  tikAftel();
  tekenPdfs(v);
}

/* aftelklok (1× per seconde, alleen zolang het element bestaat) */
let aftelTimer = null;
function tikAftel(){
  const el = document.querySelector('[data-dk-aftel]');
  clearInterval(aftelTimer);
  if (!el) return;
  const doel = Number(el.dataset.dkAftel);
  const zet = () => {
    const e = document.querySelector('[data-dk-aftel]'); if (!e){ clearInterval(aftelTimer); return; }
    let s = Math.max(0, Math.floor((doel - Date.now()) / 1000));
    const d = Math.floor(s / 86400); s %= 86400; const u = Math.floor(s / 3600); s %= 3600; const m = Math.floor(s / 60); s %= 60;
    e.innerHTML = [[d, 'dagen'], [String(u).padStart(2, '0'), 'uur'], [String(m).padStart(2, '0'), 'min'], [String(s).padStart(2, '0'), 'sec']]
      .map(([n, l]) => `<div>${n}<small>${l}</small></div>`).join('');
  };
  zet(); aftelTimer = setInterval(zet, 1000);
}

/* ---------- data-wachter ----------
   De bestaande Firestore-listeners tekenen alleen opnieuw als "hun" tabblad
   open staat (bv. beoordelingen alleen op Spelers). Het dashboard toont data
   van overal, dus hier een goedkope vergelijking van een samenvatting van de
   relevante data; wijkt die af van wat we tekenden, dan tekenen we opnieuw. */
function sig(){
  try {
    return [S.teamId, S.teamTab, S._beoordeelProfiel || '', S.team?.categorie, (S.team?.trainingsdagen || []).join(),
      S.spelers.map(p => p.id + ':' + (p.nummer ?? '') + ':' + (p.positie || '') + ':' + (p.leerpunten || []).map(l => l.id + (l.klaar ? 1 : 0)).join('.')).join('|'),
      S.wedstrijden.map(w => w.id + ':' + (w.datum || '') + ':' + (w.aftrap || '') + ':' + (w.goals || []).length + ':' + (w.selectie || []).length + ':' + Object.values(w.kwarten || {}).map(k => Object.keys(k.lineup || {}).length + '.' + (k.events || []).length).join(',')).join('|'),
      (S.presentie || []).map(p => p.id + ':' + (p.afwezig || []).length).join('|'),
      S.beoordelingen.length + ':' + (S.beoordelingen[0]?.gemaaktMs || 0),
      (S.trainingen || []).length, (S.videos || []).length, Object.keys(S.trainingenGelezen || {}).length,
      (S.teamEvaluaties || []).map(e => e.id + ':' + (e.gemaaktMs || 0)).join('|'), (() => { try { return planningItems().map(i => i.datum + i.type + (i.label || '')).join(','); } catch(e){ return ''; } })(), (S.documenten || []).length, S._dkModus || '',
      (S.presentie || []).map(p => p.id + ':' + Object.keys(p.afwezigRedenen || {}).length).join('|'),
    ].join('#');
  } catch(e){ return ''; }
}
function wachter(){
  if (!isDesk() || !S.team || S.wedstrijdId) return;
  /* niet opnieuw tekenen terwijl de coach in een invoerveld van het desktopscherm typt */
  if (document.activeElement?.closest?.('#view-team .dk-scherm') && /^(INPUT|TEXTAREA)$/.test(document.activeElement.tagName)) return;
  if (!document.querySelector('#view-team.actief > .dk-scherm')) return;
  if (sig() !== laatsteSig) renderTeam();
}

/* ---------- ingang voor teams.js ---------- */
function renderDesk(v, tab){
  if (!isDesk() || !TABS.has(tab)) { klassiekTab = tab === klassiekTab ? klassiekTab : null; return false; }
  if (klassiekTab && klassiekTab !== tab) klassiekTab = null;
  if (klassiekTab === tab) return false;
  /* Profiel: het volledige (bestaande) profiel, door naRender in een desktop-
     indeling gezet. Alleen in de modus "Evaluatie" tekenen we het paspoort. */
  if (tab === 'spelers' && S._beoordeelProfiel && S._dkModus !== 'evaluatie' && S._profielTab === 'historie') return false;
  if (tab === 'spelers' && S._dkModus === 'evaluatie' && !S._beoordeelProfiel) S._beoordeelProfiel = eersteSpeler();
  try {
    const html = tab === 'hub' ? htmlDashboard()
      : tab === 'spelers' ? (S._beoordeelProfiel ? (S._dkModus === 'evaluatie' ? htmlPaspoort() : htmlSpelerBewerk()) : htmlSelectie())
      : tab === 'wedstrijden' ? htmlWedstrijden()
      : tab === 'presentietraining' ? htmlTrainingen()
      : tab === 'evaluatie' ? htmlEvaluatie()
      : tab === 'stats' ? htmlStats()
      : tab === 'documenten' ? htmlDocumenten()
      : tab === 'planning' ? htmlPlanning()
      : htmlLeerlijn();
    if (!html) return false;
    v.classList.remove(...[...v.classList].filter(c => c.startsWith('dk-na')));
    v.innerHTML = html;
    koppel(v);
    laatsteSig = sig();
    return true;
  } catch(e){
    console.warn('[Cluppie] desktopscherm "' + tab + '" kon niet getekend worden, terugval op het gewone scherm', e);
    v.onclick = null;
    return false;
  }
}
/* ---------- bestaande tabbladen in desktop-indeling ----------
   [20260923a] Na het normale tekenen (en koppelen) van een tabblad zonder eigen
   desktopscherm: klasse erop voor de CSS, desktop-kop bovenaan, en voor het
   spelerprofiel en de wedstrijd-aanwezigheid een keuzelijst links. We
   verplaatsen alleen bestaande DOM-knopen; hun klik-handlers blijven intact. */
const NA_TITEL = { spelers:'Speler', preswedstrijd:'Aanwezigheid wedstrijd', poule:'Poule', planning:'Planning', videos:'Video\u2019s',
  historie:'Historie', documenten:'Documenten', stats:'Stats', evaluatie:'Evaluatie', berichten:'Berichten', trainingen:'Oefenstof',
  instellingen:'Instellingen', help:'Help', updates:'Updates', leerlijnoverzicht:'Leerlijn', lijstjes:'Lijstjes', lijst:'Lijstjes' };
function naRender(v, tab){
  v.classList.remove(...[...v.classList].filter(c => c.startsWith('dk-na')));
  if (!isDesk() || v.querySelector(':scope > .dk-scherm')) return;
  v.classList.add('dk-na', 'dk-na-' + tab);
  const profiel = tab === 'spelers' && S._beoordeelProfiel;
  const p = profiel ? speler(S._beoordeelProfiel) : null;
  const kopEl = document.createElement('div');
  kopEl.className = 'dk-kop dk-nakop';
  kopEl.innerHTML = `<div class="dk-kruim">${esc(S.team?.naam || '')} / <b>${esc(p ? voornaam(p) : (NA_TITEL[tab] || ''))}</b></div><div class="dk-acties">${p
    ? `<button class="dk-knop" data-na="sel">${ico('navigation-back', 18)}Selectie</button><button class="dk-knop" data-na="ev">${ico('attendance-evaluatie', 18)}Evaluatie</button>` : ''}</div>`;
  kopEl.onclick = e => { const b = e.target.closest('[data-na]'); if (!b) return;
    if (b.dataset.na === 'sel'){ S._dkModus = null; S._beoordeelProfiel = null; renderTeam(); }
    if (b.dataset.na === 'ev'){ S._dkModus = 'evaluatie'; renderTeam(); } };
  if (profiel || tab === 'preswedstrijd'){
    const midden = document.createElement('section');
    midden.className = 'dk-kol dk-namidden';
    while (v.firstChild) midden.appendChild(v.firstChild);
    const links = document.createElement('aside');
    links.className = 'dk-kol dk-lijstkol';
    if (profiel){
      const lijst = [...S.spelers].sort((a, b) => (Number(a.nummer) || 99) - (Number(b.nummer) || 99));
      links.innerHTML = lijst.map(x => `<button class="dk-sp ${x.id === p?.id ? 'actief' : ''}" data-naid="${esc(x.id)}"><span class="dk-sp-nr">${esc(x.nummer ?? '')}</span><span class="dk-sp-t"><b>${esc(voornaam(x))}</b><small>${esc(x.positie || '')}</small></span></button>`).join('');
      links.onclick = e => { const b = e.target.closest('[data-naid]'); if (!b) return; S._beoordeelProfiel = b.dataset.naid; renderTeam(); };
    } else {
      const { komend, eerder } = presWedstrijdKeuzes();
      const huidig = S._presWedstrijdId || komend[0]?.id || eerder[0]?.id;
      const it = w => `<button class="dk-li ${w.id === huidig ? 'actief' : ''}" data-naid="${esc(w.id)}"><span class="dk-li-dt">${esc(String(Number((w.datum || '').slice(8, 10)) || ''))}<small>${esc(datumMooi(w.datum, { month:'short' }))}</small></span>
        <span class="dk-li-t"><b>${esc(w.tegenstander || 'Tegenstander')}</b><small>${w.thuis ? 'thuis' : 'uit'}${w.aftrap ? ' \u00b7 ' + esc(w.aftrap) : ''}</small></span></button>`;
      links.innerHTML = (komend.length ? `<h5>Komend</h5>${komend.map(it).join('')}` : '') + (eerder.length ? `<h5>Gespeeld</h5>${eerder.slice(0, 8).map(it).join('')}` : '');
      links.onclick = e => { const b = e.target.closest('[data-naid]'); if (!b) return; S._presWedstrijdId = b.dataset.naid; renderTeam(); };
    }
    const rij = document.createElement('div');
    rij.className = 'dk-narij' + (profiel ? ' profiel' : '');
    rij.append(links, midden);
    if (p){
      const rechts = document.createElement('aside');
      rechts.className = 'dk-kol dk-zijkol';
      const st = statsVan(p.id);
      rechts.innerHTML = `${statTegels(st, true)}<div class="dk-blok dk-sbblok"><h3 class="dk-label">Verhouding speeltijd / bank</h3>${sbBalk('', st, false)}${SB_LEGENDA}</div>`;
      rij.append(rechts);
    }
    v.append(kopEl, rij);
  } else {
    v.prepend(kopEl);
  }
}

let gestart = false;
export function initSchermen(){
  S._deskRenderTeam = renderDesk;
  S._deskNaRender = naRender;
  if (!gestart){ gestart = true; setInterval(wachter, 1500); }
}
/* Bij het wisselen tussen smal en breed: bestaand onclick van een eerder
   desktopscherm opruimen zodat het gewone scherm geen dubbele handlers krijgt. */
export function ruimOp(){ const v = $('#view-team'); if (v && !v.querySelector(':scope > .dk-scherm')) v.onclick = null; }
