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
import { S, $, esc, speler, modAan } from './state.js?v=20260922c';
import { db, doc, setDoc, serverTimestamp } from './firebase.js?v=20260922c';
import { SKILLS, NIVEAUS, LEERCURVE, leercurveRelevant, bouwSlots, periodeNrs, isoWeek } from './config.js?v=20260922c';
import { analyseWedstrijd, speeltijdReserve, kwartGespeeld } from './analyse.js?v=20260922c';
import { teltMee } from './opkomst.js?v=20260922c';
import { ico } from './icons.js?v=20260922c';
import { renderTeam, zetTeamTab, modalTeamEvaluatie } from './teams.js?v=20260922e';
import { evaluatieOpen } from './teams-hub.js?v=20260922c';
import { ongelezenBerichten } from './berichten.js?v=20260922c';
import { contentVoorThema } from './content.js?v=20260922c';

const TABS = new Set(['hub', 'spelers', 'wedstrijden', 'presentietraining', 'leerlijnoverzicht']);
let klassiekTab = null;          // tabblad waarvoor de coach "Gewone weergave" koos
let klassiekProfiel = null;      // speler-id waarvoor het volledige (oude) profiel open staat
let laatsteSig = '';
let selWedstrijd = null, selTraining = null, selThema = null, spFilter = 'Alle';

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
const volledigeNaam = p => [p?.naam, p?.achternaam].filter(Boolean).join(' ');
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
  const trend = volledigen(p.id).slice(0, 6).reverse()
    .map(b => { const s = SKILLS.map(d => Number(b.scores?.[d.id])).filter(Boolean); return s.length ? cijfer(gem(s)) : null; })
    .filter(x => x != null);
  return { niv, nivVorig, ovr, ovrVorig, stijging: ovr != null && ovrVorig != null ? ovr - ovrVorig : 0, trend, laatste };
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
  const minuten = seizoensMinuten();
  const laag = [...S.spelers].sort((a, b) => (minuten[a.id] || 0) - (minuten[b.id] || 0)).slice(0, 8);
  const maxMin = Math.max(1, ...Object.values(minuten));
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
        ${laag.length ? laag.map(p => `<div class="dk-balk ${(minuten[p.id] || 0) < maxMin * 0.6 ? 'laag' : ''}"><span>${esc(voornaam(p))}</span><i><b style="width:${(minuten[p.id] || 0) / maxMin * 100}%"></b></i><em>${minuten[p.id] || 0}\u2032</em></div>`).join('') : '<p class="dk-leeg">Nog geen gespeelde wedstrijden.</p>'}</div>
      <div class="dk-blok dk-opk"><h3>${ico('attendance-overview', 18)}Opkomst training<span>laatste ${ses.length}</span></h3>
        ${ses.length ? `<div class="dk-heat" style="grid-template-columns:70px repeat(${ses.length},1fr)"><span></span>${ses.map(s => `<span class="kh">${esc(datumMooi(s.datum, { weekday:'short' }).slice(0, 2).toLowerCase())}</span>`).join('')}
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
function htmlSelectie(){
  const posities = ['Alle', ...new Set(S.spelers.map(p => p.positie).filter(Boolean))];
  if (!posities.includes(spFilter)) spFilter = 'Alle';
  const lijst = [...S.spelers].filter(p => spFilter === 'Alle' || p.positie === spFilter)
    .sort((a, b) => (Number(a.nummer) || 99) - (Number(b.nummer) || 99) || (a.naam || '').localeCompare(b.naam || ''));
  const kaartHtml = p => {
    const k = kaart(p);
    return `<button class="dk-fk ${k.stijging >= 5 ? 'vorm' : ''}" data-dk="profiel" data-id="${esc(p.id)}">
      <span class="dk-fk-rug">${esc(p.nummer ?? '')}</span>${k.stijging >= 5 ? `<span class="dk-pill rood dk-fk-tag">+${k.stijging}</span>` : ''}
      <span class="dk-fk-ovr">${k.ovr ?? '–'}</span><span class="dk-fk-pos">${esc((p.positie || '').slice(0, 3).toUpperCase())}</span>
      <span class="dk-fk-naam">${esc(voornaam(p))}</span>
      <span class="dk-fk-st">${SKILLS.map((d, i) => `<span><b>${k.niv[i] ? cijfer(k.niv[i]) : '–'}</b><small style="color:${d.kleur}">${d.id}</small></span>`).join('')}</span></button>`;
  };
  return `<div class="dk-scherm dk-selectie">
    ${kop('Selectie', `${knop('Beoordelingsronde', 'snelronde', '', 'action-check')}${knop('Speler toevoegen', 'nieuwsp', 'rood', 'team-player-add')}`)}
    <div class="dk-sel-body">
      <div class="dk-filter">${posities.map(f => `<button class="${f === spFilter ? 'actief' : ''}" data-dk="filter" data-f="${esc(f)}">${esc(f)}</button>`).join('')}
        <span class="dk-filter-uitleg">Cijfer = laatste volledige beoordeling (Aandacht 40 \u2026 Uitblinker 96). Rood = gestegen sinds de vorige.</span></div>
      ${lijst.length ? `<div class="dk-kaarten">${lijst.map(kaartHtml).join('')}</div>` : '<p class="dk-leeg">Nog geen spelers in dit team.</p>'}
    </div></div>`;
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
    ${kop(volledigeNaam(p), `${knop('Selectie', 'terugsel', '', 'navigation-back')}${knop('Beoordelen', 'beoordeel', '', 'action-check')}${knop('Volledig profiel', 'volprofiel', 'rood', 'team-player')}`)}
    <div class="dk-drie dk-drie-pas">
      <aside class="dk-kol dk-lijstkol">${lijst.map(s => { const ks = kaart(s); return `<button class="dk-sp ${s.id === p.id ? 'actief' : ''}" data-dk="profiel" data-id="${esc(s.id)}"><span class="dk-sp-nr">${esc(s.nummer ?? '')}</span><span class="dk-sp-t"><b>${esc(volledigeNaam(s))}</b><small>${esc(s.positie || 'Speler')}${ks.ovr != null ? ' \u00b7 ' + ks.ovr : ''}</small></span>${sparkline(ks.trend)}</button>`; }).join('')}</aside>
      <section class="dk-kol dk-hart"><div class="dk-spook dk-spook-rug">${esc(p.nummer ?? '')}</div>
        <h1 class="dk-groot dk-naam">${esc(p.naam || '')}<span class="dk-omlijnd">${esc(p.achternaam || '')}</span></h1>
        <div class="dk-pills">${p.nummer != null && p.nummer !== '' ? `<span class="dk-pill">#${esc(p.nummer)}${p.positie ? ' \u00b7 ' + esc(p.positie) : ''}</span>` : p.positie ? `<span class="dk-pill">${esc(p.positie)}</span>` : ''}
          ${k.ovr != null ? `<span class="dk-pill ${k.stijging >= 5 ? 'rood' : 'groen'}">Kaart ${k.ovr}${k.stijging ? ` (${k.stijging > 0 ? '+' : ''}${k.stijging})` : ''}</span>` : '<span class="dk-pill">Nog geen volledige beoordeling</span>'}
          <span class="dk-pill">${min}\u2032 dit seizoen</span><span class="dk-pill">Stippellijn = teamgemiddelde</span></div>
        <div class="dk-radar">${radarSvg(k.niv, tg)}
          <div class="dk-legenda">${SKILLS.map((d, i) => `<div><b style="color:${d.kleur}">${k.niv[i] ? cijfer(k.niv[i]) : '–'}</b><span><strong>${esc(d.kort)}</strong>${k.niv[i] ? esc(NIVEAUS[k.niv[i]]?.label || '') : 'niet beoordeeld'}${k.niv[i] && k.nivVorig[i] && k.niv[i] > k.nivVorig[i] ? ' \u00b7 gestegen' : ''}</span></div>`).join('')}</div></div>
      </section>
      <aside class="dk-kol dk-zijkol">
        <div><h3 class="dk-label">Leerpunten<span>${open} open \u00b7 ${klaar} afgerond</span></h3>
          ${lps.length ? lps.slice(0, 8).map(l => `<div class="dk-lp ${l.klaar ? 'klaar' : ''}"><i style="background:${SKILLS.find(d => d.id === l.domein)?.kleur || 'var(--ink-2)'}"></i><div><b>${esc(l.tekst)}</b><small>${l.klaar ? 'Afgerond' + (l.klaarOp ? ' op ' + esc(datumMooi(l.klaarOp, { day:'numeric', month:'short' })) : '') : 'Sinds ' + esc(datumMooi(l.sinds, { day:'numeric', month:'short' }))}</small></div></div>`).join('') : '<p class="dk-leeg">Nog geen leerpunten.</p>'}
          <button class="dk-link" data-dk="leerpunt">+ Leerpunt toevoegen</button></div>
        <div><h3 class="dk-label">Laatste momenten<span>alleen voor coaches</span></h3>
          ${momenten.length ? momenten.slice(0, 4).map(([d, t]) => `<div class="dk-moment"><span>${esc(datumMooi(d, { day:'numeric' }))}<small>${esc(datumMooi(d, { month:'short' }))}</small></span><p>${t}</p></div>`).join('') : '<p class="dk-leeg">Nog niets vastgelegd.</p>'}</div>
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
      <aside class="dk-kol dk-lijstkol">${kom.length ? `<h5>Komend</h5>${kom.map(item).join('')}` : ''}${afg.length ? `<h5>Gespeeld</h5>${afg.map(item).join('')}` : ''}${!alle.length ? '<p class="dk-leeg">Nog geen wedstrijden.</p>' : ''}</aside>
      <section class="dk-kol dk-hart">${w ? (gespeeld(w) ? wedGespeeld(w) : wedKomend(w)) : '<p class="dk-leeg">Kies een wedstrijd.</p>'}</section>
      <aside class="dk-kol dk-zijkol">${w ? (gespeeld(w) ? zijGespeeld(w) : zijKomend(w)) : ''}</aside>
    </div></div>`;
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
  const minuten = seizoensMinuten();
  const laag = [...S.spelers].sort((a, b) => (minuten[a.id] || 0) - (minuten[b.id] || 0)).slice(0, 8);
  const mx = Math.max(1, ...Object.values(minuten));
  const sel = (w.selectie || []).filter(pid => speler(pid)).length;
  return `<div><h3 class="dk-label">Selectie<span>${sel ? sel + ' spelers' : 'nog niet gekozen'}</span></h3>
      ${sel ? (w.selectie || []).filter(pid => speler(pid)).slice(0, 16).map(pid => `<span class="dk-chip">${esc(voornaam(speler(pid)))}</span>`).join('') : '<p class="dk-leeg">Kies de selectie in de wedstrijd.</p>'}</div>
    <div><h3 class="dk-label">Seizoensminuten<span>laagste eerst</span></h3>
      ${laag.map(p => `<div class="dk-balk ${(minuten[p.id] || 0) < mx * 0.6 ? 'laag' : ''}"><span>${esc(voornaam(p))}</span><i><b style="width:${(minuten[p.id] || 0) / mx * 100}%"></b></i><em>${minuten[p.id] || 0}\u2032</em></div>`).join('')}</div>`;
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

/* ==================== TRAININGEN (presentietraining) ==================== */
function htmlTrainingen(){
  const kom = komendeTrainingsdagen(3);
  const ses = sessies().slice(0, 10);
  const sleutels = [...kom.map(d => 'd:' + d), ...ses.map(s => 's:' + s.id)];
  if (!sleutels.includes(selTraining)) selTraining = sleutels[0] || null;
  const isSessie = selTraining?.startsWith('s:');
  const sessie = isSessie ? ses.find(s => 's:' + s.id === selTraining) : null;
  const datum = sessie ? sessie.datum : selTraining?.slice(2);
  const stof = datum ? oefenstofVoorDatum(datum) : null;
  const item = (sl, iso, sub, tel) => `<button class="dk-li ${sl === selTraining ? 'actief' : ''}" data-dk="seltr" data-id="${esc(sl)}">
      <span class="dk-li-dt">${esc(String(Number(iso.slice(8, 10))))}<small>${esc(datumMooi(iso, { weekday:'short', month:'short' }).replace('.', ''))}</small></span>
      <span class="dk-li-t"><b>${esc(oefenstofVoorDatum(iso)?.titel || 'Training')}</b><small>${esc(sub)}</small></span>
      ${tel ? `<span class="dk-trtel"><em>${tel[0]}/${tel[1]}</em><i><b style="width:${tel[1] ? tel[0] / tel[1] * 100 : 0}%"></b></i></span>` : ''}</button>`;
  const oef = stof && Array.isArray(stof.oefeningen) ? stof.oefeningen : [];
  const kleuren = SKILLS.map(d => d.kleur);
  return `<div class="dk-scherm">
    ${kop('Trainingen', knop('Presentie vandaag', 'presentie', 'rood', 'attendance-present'))}
    <div class="dk-drie">
      <aside class="dk-kol dk-lijstkol">${kom.length ? `<h5>Gepland</h5>${kom.map(d => item('d:' + d, d, 'nog in te vullen', null)).join('')}` : ''}
        ${ses.length ? `<h5>Geweest</h5>${ses.map(s => item('s:' + s.id, s.datum, 'presentie ingevuld', [aanwezigTel(s), meetellers(s)])).join('')}` : ''}
        ${!kom.length && !ses.length ? '<p class="dk-leeg">Nog geen trainingen. Stel trainingsdagen in bij Instellingen of vul presentie in.</p>' : ''}</aside>
      <section class="dk-kol dk-hart">${datum ? `<div class="dk-spook">${esc(String(Number(datum.slice(8, 10))))}</div>
        <h1 class="dk-groot">${esc(datumMooi(datum, { weekday:'long', day:'numeric', month:'short' }))}<span class="dk-omlijnd dk-klein">${esc(stof?.titel || 'Geen oefenstof gekoppeld')}</span></h1>
        <div class="dk-pills"><span class="dk-pill">Week ${isoWeekVan(datum)}</span>${sessie ? `<span class="dk-pill groen">${aanwezigTel(sessie)} van ${meetellers(sessie)} aanwezig</span>` : '<span class="dk-pill oranje">Presentie nog niet ingevuld</span>'}</div>
        <div><h3 class="dk-label">Opbouw<span>${oef.length ? oef.length + ' oefeningen' : stof ? 'PDF-training' : ''}</span></h3>
          ${oef.length ? `<div class="dk-blokken">${oef.map((o, i) => `<button class="dk-oefblok" style="--c:${kleuren[i % kleuren.length]}" data-dk="stof" data-id="${esc(stof.id)}"><span class="nr">${i + 1}</span><b>${esc(o.titel || 'Oefening ' + (i + 1))}</b></button>`).join('')}</div>`
            : stof ? stofRij(stof) : '<p class="dk-leeg">Voor deze week staat nog geen oefenstof klaar voor dit team.</p>'}</div>
        <div><h3 class="dk-label">Aanwezigheid<span>${sessie ? 'ingevuld' : 'nog niet ingevuld'}</span></h3>
          <div class="dk-aanw">${[...S.spelers].sort((a, b) => (Number(a.nummer) || 99) - (Number(b.nummer) || 99)).map(p => {
            const st = !sessie ? '' : !teltMee(sessie, p) ? 'nvt' : (sessie.afwezig || []).includes(p.id) ? 'n' : 'j';
            return `<span class="dk-aw ${st}"><i>${esc(p.nummer ?? voornaam(p).charAt(0))}</i>${esc(voornaam(p))}</span>`; }).join('')}</div>
          <div class="dk-rij-knoppen">${knop(sessie ? 'Presentie wijzigen' : 'Presentie invullen', sessie ? 'presentiewijzig' : (datum === vandaagISO() ? 'presentie' : 'presentieander'), sessie ? '' : 'rood', 'attendance-present').replace(/data-dk="(presentiewijzig)"/, `data-dk="$1" data-id="${esc(sessie?.id || '')}"`)}</div></div>` : '<p class="dk-leeg">Kies een training.</p>'}
      </section>
      <aside class="dk-kol dk-zijkol">
        <div><h3 class="dk-label">Oefenstof deze week<span>week ${isoWeek()}</span></h3>${oefenstofWeek().map(stofRij).join('') || '<p class="dk-leeg">Nog niets voor deze week.</p>'}
          <button class="dk-link" data-dk="tab" data-tab="trainingen">Alle oefenstof \u203a</button></div>
        <div><h3 class="dk-label">Video\u2019s<span>${(S.videos || []).filter(v => (v.teams || []).includes(S.teamId)).length}</span></h3>
          <button class="dk-link" data-dk="tab" data-tab="videos">Naar de video\u2019s \u203a</button></div>
        <div><h3 class="dk-label">Opkomst<span>laatste ${Math.min(4, ses.length)}</span></h3>
          ${ses.slice(0, 4).map(s => `<div class="dk-balk"><span>${esc(datumMooi(s.datum, { weekday:'short', day:'numeric' }))}</span><i><b class="in" style="width:${meetellers(s) ? aanwezigTel(s) / meetellers(s) * 100 : 0}%"></b></i><em>${aanwezigTel(s)}/${meetellers(s)}</em></div>`).join('') || '<p class="dk-leeg">Nog geen presentie.</p>'}</div>
      </aside>
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
  if (a === 'openw'){ const m = await import('./wedstrijd.js?v=20260922e'); m.openWedstrijd(id); return; }
  if (a === 'nieuwew'){ const m = await import('./wedstrijd.js?v=20260922e'); m.modalNieuweWedstrijd(); return; }
  if (a === 'evalueer'){ modalTeamEvaluatie(id); return; }
  if (a === 'presentie'){ const m = await import('./teams-training.js?v=20260922c'); m.modalPresentie(); return; }
  if (a === 'presentieander'){ const m = await import('./teams-training.js?v=20260922c'); m.modalPresentie(null, { startAnder:true }); return; }
  if (a === 'presentiewijzig'){ const s = (S.presentie || []).find(x => x.id === id); const m = await import('./teams-training.js?v=20260922c'); m.modalPresentie(s || null); return; }
  if (a === 'stof'){ openOefenstof(id); return; }
  if (a === 'profiel'){ klassiekProfiel = null; S._beoordeelProfiel = id; if (S.teamTab !== 'spelers') zetTeamTab('spelers'); else renderTeam(); return; }
  if (a === 'terugsel'){ S._beoordeelProfiel = null; renderTeam(); return; }
  if (a === 'volprofiel'){ klassiekProfiel = S._beoordeelProfiel; renderTeam(); return; }
  if (a === 'beoordeel'){ const m = await import('./teams-spelers.js?v=20260922e'); m.modalVolledigeBeoordeling(S._beoordeelProfiel); return; }
  if (a === 'leerpunt'){ const m = await import('./teams-spelers.js?v=20260922e'); m.modalLeerpunt(S._beoordeelProfiel); return; }
  if (a === 'lpthema'){ const m = await import('./teams-spelers.js?v=20260922e'); m.modalLeerpunt(id, selThema); return; }
  if (a === 'snelronde'){ const m = await import('./teams-spelers.js?v=20260922e'); m.startSnelRonde(); return; }
  if (a === 'nieuwsp'){ const m = await import('./teams-spelers.js?v=20260922e'); m.modalSpeler(null); return; }
  if (a === 'filter'){ spFilter = b.dataset.f; renderTeam(); return; }
  if (a === 'selw'){ selWedstrijd = id; renderTeam(); return; }
  if (a === 'seltr'){ selTraining = id; renderTeam(); return; }
  if (a === 'selth'){ selThema = LEERCURVE[Number(b.dataset.i)]?.thema || selThema; renderTeam(); return; }
}
function koppel(v){
  v.onclick = e => {
    const b = e.target.closest('[data-dk]');
    if (!b || !v.contains(b)) return;
    actie(b).catch(err => console.warn('[Cluppie] desktop-actie mislukt', err));
  };
  tikAftel();
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
    ].join('#');
  } catch(e){ return ''; }
}
function wachter(){
  if (!isDesk() || !S.team || S.wedstrijdId) return;
  if (!document.querySelector('#view-team.actief > .dk-scherm')) return;
  if (sig() !== laatsteSig) renderTeam();
}

/* ---------- ingang voor teams.js ---------- */
function renderDesk(v, tab){
  if (!isDesk() || !TABS.has(tab)) { klassiekTab = tab === klassiekTab ? klassiekTab : null; return false; }
  if (klassiekTab && klassiekTab !== tab) klassiekTab = null;
  if (klassiekTab === tab) return false;
  if (tab === 'spelers' && S._beoordeelProfiel){
    if (klassiekProfiel === S._beoordeelProfiel) return false;
    klassiekProfiel = null;
  }
  try {
    const html = tab === 'hub' ? htmlDashboard()
      : tab === 'spelers' ? (S._beoordeelProfiel ? htmlPaspoort() : htmlSelectie())
      : tab === 'wedstrijden' ? htmlWedstrijden()
      : tab === 'presentietraining' ? htmlTrainingen()
      : htmlLeerlijn();
    if (!html) return false;
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
let gestart = false;
export function initSchermen(){
  S._deskRenderTeam = renderDesk;
  if (!gestart){ gestart = true; setInterval(wachter, 1500); }
}
/* Bij het wisselen tussen smal en breed: bestaand onclick van een eerder
   desktopscherm opruimen zodat het gewone scherm geen dubbele handlers krijgt. */
export function ruimOp(){ const v = $('#view-team'); if (v && !v.querySelector(':scope > .dk-scherm')) v.onclick = null; }
