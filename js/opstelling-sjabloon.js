/* ==================== OPSTELLING-SJABLONEN ====================
   Herbruikbare opstellingen per team. Een sjabloon bewaart voor alle kwarten
   een opstelling ({slotId: spelerId}) plus de formatie per kwart, zodat een
   coach een vaste standaardopstelling in één keer op een (nieuwe) wedstrijd kan
   leggen — inclusief dezelfde spelers.

   Opslag: teams/{teamId}/sjablonen/{id}
     { naam, format, formatie, kwarten:{ '1':{formatie, lineup}, ... },
       gemaakt, door }

   Toepassen kopieert per kwart de lineup, maar zet per slot alléén een speler
   neer die óók in de selectie van de doelwedstrijd zit (identiek aan de
   bestaande "opstelling vorige wedstrijd overnemen"). Spelers die niet in de
   selectie zitten worden overgeslagen; de coach hoort achteraf hoeveel.

   Twee ingangen om een sjabloon te máken:
   1. Vanuit een bestaande wedstrijd  → bewaarWedstrijdAlsSjabloon(w)
   2. Leeg opbouwen in de editor      → openSjabloonEditor()

   De module gebruikt dezelfde fullscreen-overlay-aanpak als training-weergave.js
   (met bewaakTerug/vangnet), los van de gedeelde modal-structuur. */

import { db, collection, doc, setDoc, deleteDoc, updateDoc, onSnapshot, serverTimestamp } from './firebase.js?v=20260811a';
import {
  S, esc, meld, speler, spelerNaam, spelerNr,
  bewaakTerug, vangnetStilTerugAlsNodig
} from './state.js?v=20260828d';
import {
  FORMATIES, bouwSlots, LIJN_NAAM, parseFormatie,
  formatieBestaat, formatieNamen
} from './config.js?v=20260828d';
import { telGebruik, telNav } from './tracker.js?v=20260828d';

/* ---------- helpers ---------- */

function eigenFormaties(){ return (S.team && S.team.eigenFormaties) || {}; }

/* Eerste (default) formatie voor een format. */
function defaultFormatie(format){
  const namen = formatieNamen(format, eigenFormaties());
  return namen[0] || Object.keys(FORMATIES[format] || {})[0] || '';
}

/* Aantal kwarten dat de app standaard aanhoudt (wedstrijden hebben periodes,
   sjablonen zijn niet aan één wedstrijd gebonden, dus we houden 4 aan — de
   verreweg gangbaarste indeling in de jeugd). */
const SJ_KWARTEN = ['1', '2', '3', '4'];

/* Tel hoeveel spelers in totaal in een sjabloon zijn opgesteld (over alle
   kwarten, uniek). */
function sjabloonSpelers(sj){
  const set = new Set();
  for (const k of SJ_KWARTEN){
    const lu = sj.kwarten?.[k]?.lineup || {};
    for (const pid of Object.values(lu)) set.add(pid);
  }
  return set;
}

/* Korte samenvatting van de formaties per kwart voor de kaartweergave. */
function kwartFormaties(sj){
  return SJ_KWARTEN.map(k => sj.kwarten?.[k]?.formatie || sj.formatie || '—');
}

/* ==================== FIRESTORE ==================== */

async function opslaanSjabloon(data, id){
  const ref = id
    ? doc(db, 'teams', S.teamId, 'sjablonen', id)
    : doc(collection(db, 'teams', S.teamId, 'sjablonen'));
  const payload = {
    naam: data.naam,
    format: data.format,
    formatie: data.formatie,
    kwarten: data.kwarten,
    door: S.user?.displayName || S.user?.email || '',
  };
  if (!id) payload.gemaakt = serverTimestamp();
  await setDoc(ref, payload, { merge: true });
  telGebruik('sjabloon_opslaan');
  return ref.id;
}

async function verwijderSjabloon(id){
  await deleteDoc(doc(db, 'teams', S.teamId, 'sjablonen', id));
}

async function hernoemSjabloon(id, naam){
  await updateDoc(doc(db, 'teams', S.teamId, 'sjablonen', id), { naam });
}

/* ==================== OVERLAY-INFRA ==================== */

let _ov = null;

function bouwOverlay(){
  if (_ov) return _ov;
  const el = document.createElement('div');
  el.className = 'sj-overlay';
  el.innerHTML = `
    <div class="sj-balk">
      <button class="sj-terug" aria-label="Sluiten">‹</button>
      <div class="sj-kop"><div class="sj-titel"></div><div class="sj-sub"></div></div>
      <button class="sj-balk-actie" style="display:none"></button>
    </div>
    <div class="sj-stage"></div>`;
  document.body.appendChild(el);
  el.querySelector('.sj-terug').onclick = () => sluitOverlay();
  _ov = el;
  return el;
}

function sluitOverlay(){
  if (!_ov) return;
  const wasOpen = _ov.classList.contains('open');
  _ov.classList.remove('open');
  _ov.querySelector('.sj-stage').innerHTML = '';
  const actie = _ov.querySelector('.sj-balk-actie');
  if (actie){ actie.style.display = 'none'; actie.onclick = null; }
  vangnetStilTerugAlsNodig(wasOpen);
}
export { sluitOverlay as sluitSjabloonScherm };

function zetKop(titel, sub){
  const el = bouwOverlay();
  el.querySelector('.sj-titel').textContent = titel || '';
  el.querySelector('.sj-sub').textContent = sub || '';
}

function zetBalkActie(label, fn){
  const el = bouwOverlay();
  const b = el.querySelector('.sj-balk-actie');
  if (!label){ b.style.display = 'none'; b.onclick = null; return; }
  b.textContent = label;
  b.style.display = '';
  b.onclick = fn;
}

/* ==================== BEHEERSCHERM ==================== */

export function openSjabloonScherm(){
  const el = bouwOverlay();
  zetKop('Opstelling-sjablonen', S.team?.naam || '');
  zetBalkActie(null);
  tekenBeheer();
  el.classList.add('open');
  bewaakTerug();
  telNav('sjabloon:beheer', 'open');
}

function tekenBeheer(){
  const el = bouwOverlay();
  const stage = el.querySelector('.sj-stage');
  const lijst = (S.sjablonen || []);

  const kaarten = lijst.length ? lijst.map(sj => {
    const aantal = sjabloonSpelers(sj).size;
    const fs = kwartFormaties(sj);
    return `
      <div class="sj-kaart">
        <div class="sj-kaart-top">
          <div class="sj-kaart-ico">${esc((sj.formatie || fs[0] || '').slice(0, 5) || '—')}</div>
          <div class="sj-kaart-info">
            <div class="sj-kaart-naam">${esc(sj.naam || 'Sjabloon')}</div>
            <div class="sj-kaart-meta">${esc(sj.format)}×${esc(sj.format)} · ${aantal} speler${aantal===1?'':'s'}</div>
          </div>
          <div class="sj-kaart-acties">
            <button data-sj-bewerk="${sj.id}" title="Bewerken">✎</button>
            <button data-sj-hernoem="${sj.id}" title="Hernoemen">Aa</button>
            <button data-sj-weg="${sj.id}" title="Verwijderen" class="weg">🗑</button>
          </div>
        </div>
        <div class="sj-kaart-kwarten">
          ${SJ_KWARTEN.map((k, i) => `
            <div class="sj-kw"><div class="sj-kw-l">K${k}</div><div class="sj-kw-f">${esc(fs[i])}</div></div>`).join('')}
        </div>
        <button class="sj-kaart-toepas" data-sj-toepas="${sj.id}">Toepassen op een wedstrijd →</button>
      </div>`;
  }).join('') : `
    <div class="sj-leeg">
      Nog geen sjablonen voor dit team.<br>
      Maak een standaardopstelling die je later in één keer op een wedstrijd legt.
    </div>`;

  stage.innerHTML = `
    <button class="sj-groot-knop" id="sjNieuw">
      <span class="ico">＋</span>
      <span class="tk"><span class="tt">Nieuwe standaardopstelling</span>
        <span class="ts">Bouw een opstelling voor alle kwarten op</span></span>
      <span class="pijl">›</span>
    </button>
    <div class="sj-sectiekop">Opgeslagen sjablonen</div>
    ${kaarten}`;

  stage.querySelector('#sjNieuw').onclick = () => openSjabloonEditor();
  stage.querySelectorAll('[data-sj-bewerk]').forEach(b =>
    b.onclick = () => { const sj = lijst.find(x => x.id === b.dataset.sjBewerk); if (sj) openSjabloonEditor(sj); });
  stage.querySelectorAll('[data-sj-hernoem]').forEach(b =>
    b.onclick = () => hernoemDialoog(lijst.find(x => x.id === b.dataset.sjHernoem)));
  stage.querySelectorAll('[data-sj-weg]').forEach(b =>
    b.onclick = () => wegDialoog(lijst.find(x => x.id === b.dataset.sjWeg)));
  stage.querySelectorAll('[data-sj-toepas]').forEach(b =>
    b.onclick = () => toepasKiezer(lijst.find(x => x.id === b.dataset.sjToepas)));
}

/* ---------- kleine dialogen (hernoemen / verwijderen) ---------- */

function hernoemDialoog(sj){
  if (!sj) return;
  const naam = prompt('Nieuwe naam voor dit sjabloon:', sj.naam || '');
  if (naam == null) return;
  const schoon = naam.trim();
  if (!schoon) return;
  hernoemSjabloon(sj.id, schoon).then(() => meld('Naam gewijzigd')).catch(e => meld('Mislukt: ' + (e.code || e.message)));
}

function wegDialoog(sj){
  if (!sj) return;
  if (!confirm(`Sjabloon "${sj.naam || 'Sjabloon'}" verwijderen?`)) return;
  verwijderSjabloon(sj.id).then(() => { meld('Sjabloon verwijderd'); }).catch(e => meld('Mislukt: ' + (e.code || e.message)));
}

/* ==================== EDITOR (leeg opbouwen of bestaande bewerken) ==================== */

let _ed = null;   // {naam, format, kwarten:{k:{formatie, lineup}}, actiefKwart, actiefSlot, id}

export function openSjabloonEditor(bestaand){
  const format = bestaand?.format || S.team?.laatsteFormat || '8';
  const dflt = defaultFormatie(format);
  const kwarten = {};
  for (const k of SJ_KWARTEN){
    const bron = bestaand?.kwarten?.[k];
    kwarten[k] = {
      formatie: bron?.formatie || bestaand?.formatie || dflt,
      lineup: { ...(bron?.lineup || {}) },
    };
  }
  _ed = {
    id: bestaand?.id || null,
    naam: bestaand?.naam || '',
    format,
    kwarten,
    actiefKwart: '1',
    actiefSlot: null,
  };

  const el = bouwOverlay();
  zetKop(bestaand ? 'Sjabloon bewerken' : 'Nieuw sjabloon', S.team?.naam || '');
  zetBalkActie('Opslaan', bewaarEditor);
  el.classList.add('open');
  bewaakTerug();
  tekenEditor();
  telNav('sjabloon:editor', 'open');
}

function tekenEditor(){
  const el = bouwOverlay();
  const stage = el.querySelector('.sj-stage');
  const ed = _ed;
  const k = ed.kwarten[ed.actiefKwart];
  const formaties = formatieNamen(ed.format, eigenFormaties());
  const slots = bouwSlots(ed.format, k.formatie);
  const opgesteld = Object.keys(k.lineup).length;

  stage.innerHTML = `
    <div class="sj-veldgroep">
      <label>Naam sjabloon</label>
      <input class="sj-invoer" id="sjNaam" value="${esc(ed.naam)}" placeholder="Bijv. Basisopstelling seizoen" autocomplete="off">
    </div>

    <div class="sj-veldgroep">
      <label>Aantal spelers</label>
      <div class="sj-segment" id="sjFormat">
        ${['4','6','8','9','11'].map(f => `<button data-f="${f}" class="${ed.format===f?'actief':''}">${f}×${f}</button>`).join('')}
      </div>
    </div>

    <div class="sj-veldgroep">
      <label>Formatie kwart ${ed.actiefKwart} (excl. keeper)</label>
      <div class="sj-segment formaties" id="sjFormatie">
        ${formaties.map(f => `<button data-fm="${esc(f)}" class="${k.formatie===f?'actief':''}">${esc(f)}</button>`).join('')}
      </div>
    </div>

    <div class="sj-kwarttabs" id="sjKwarttabs">
      ${SJ_KWARTEN.map(kw => {
        const vol = Object.keys(ed.kwarten[kw].lineup).length > 0;
        return `<button data-k="${kw}" class="${ed.actiefKwart===kw?'actief':''}">K${kw}${vol?'<span class="bol">●</span>':''}</button>`;
      }).join('')}
    </div>

    <div class="sj-kwartbalk">
      <span class="kb">Kwart ${ed.actiefKwart} · ${opgesteld}/${slots.length} opgesteld</span>
      ${Number(ed.actiefKwart) < 4 ? `<button id="sjKopieer">⧉ Naar K${Number(ed.actiefKwart)+1}</button>` : ''}
    </div>

    <div class="sj-veld-wrap">
      <div class="sj-veld" id="sjVeld">
        <div class="sj-lijn midden"></div>
        <div class="sj-lijn cirkel"></div>
        <div class="sj-lijn zestien-b"></div>
        <div class="sj-lijn zestien-o"></div>
        ${slots.map(sl => slotHtml(sl, k.lineup, ed.actiefSlot)).join('')}
      </div>
    </div>

    <p class="sj-hint">Tik een plek om een speler te kiezen. Tik een geplaatste speler om te verplaatsen of weg te halen.</p>

    <div class="sj-lade">
      <div class="sj-lade-kop">Nog niet opgesteld</div>
      <div class="sj-lade-chips">${ladeHtml(k.lineup)}</div>
    </div>`;

  // naam bijhouden
  stage.querySelector('#sjNaam').oninput = e => { ed.naam = e.target.value; };

  // format wisselen
  stage.querySelectorAll('#sjFormat button').forEach(b => b.onclick = () => {
    const nf = b.dataset.f;
    if (nf === ed.format) return;
    ed.format = nf;
    const dflt = defaultFormatie(nf);
    // alle kwarten: formatie terug naar default van het nieuwe format, lineups
    // leegmaken (slots komen niet meer overeen).
    for (const kw of SJ_KWARTEN){ ed.kwarten[kw].formatie = dflt; ed.kwarten[kw].lineup = {}; }
    ed.actiefSlot = null;
    tekenEditor();
  });

  // formatie wisselen (alleen dit kwart). Bij het eerste kwart nemen lege
  // volgende kwarten de nieuwe formatie mee als default (afgesproken gedrag).
  stage.querySelectorAll('#sjFormatie button').forEach(b => b.onclick = () => {
    const nfm = b.dataset.fm;
    herplaatsBijFormatie(ed.actiefKwart, nfm);
    if (ed.actiefKwart === '1'){
      for (const kw of SJ_KWARTEN){
        if (kw !== '1' && Object.keys(ed.kwarten[kw].lineup).length === 0) ed.kwarten[kw].formatie = nfm;
      }
    }
    ed.actiefSlot = null;
    tekenEditor();
  });

  // kwart-tabs
  stage.querySelectorAll('#sjKwarttabs button').forEach(b => b.onclick = () => {
    ed.actiefKwart = b.dataset.k; ed.actiefSlot = null; tekenEditor();
  });

  // kopieer naar volgend kwart
  const kop = stage.querySelector('#sjKopieer');
  if (kop) kop.onclick = () => {
    const cur = Number(ed.actiefKwart);
    const volg = String(cur + 1);
    ed.kwarten[volg] = { formatie: ed.kwarten[ed.actiefKwart].formatie, lineup: { ...ed.kwarten[ed.actiefKwart].lineup } };
    meld(`K${cur} gekopieerd naar K${volg}`);
    tekenEditor();
  };

  // slot-kliks
  stage.querySelectorAll('.sj-slot').forEach(s => s.onclick = () => {
    const slotId = s.dataset.slot;
    ed.actiefSlot = slotId;
    kiesSpelerSheet(slotId);
  });
}

/* Herplaats de opstelling van een kwart naar een nieuwe formatie: spelers per
   lijn (K/V/M/A) zoveel mogelijk behouden op de nieuwe slots van dezelfde lijn. */
function herplaatsBijFormatie(kw, nieuweFormatie){
  const ed = _ed;
  const oude = bouwSlots(ed.format, ed.kwarten[kw].formatie);
  const nieuw = bouwSlots(ed.format, nieuweFormatie);
  const oudeLineup = ed.kwarten[kw].lineup;

  // groepeer bezette spelers per lijn (in slot-volgorde)
  const perLijn = {};
  for (const sl of oude){
    const pid = oudeLineup[sl.id];
    if (pid){ (perLijn[sl.lijn] ||= []).push(pid); }
  }
  const nieuweLineup = {};
  const teller = {};
  for (const sl of nieuw){
    const lijn = sl.lijn;
    teller[lijn] = teller[lijn] || 0;
    const rij = perLijn[lijn] || [];
    if (teller[lijn] < rij.length){
      nieuweLineup[sl.id] = rij[teller[lijn]];
      teller[lijn]++;
    }
  }
  ed.kwarten[kw].formatie = nieuweFormatie;
  ed.kwarten[kw].lineup = nieuweLineup;
}

function slotHtml(sl, lineup, actiefSlot){
  const pid = lineup[sl.id];
  const doelwit = actiefSlot === sl.id ? ' doelwit' : '';
  if (pid){
    const keeper = sl.lijn === 'K' ? ' keeper' : '';
    return `<div class="sj-slot${doelwit}" data-slot="${sl.id}" style="left:${sl.x}%;top:${sl.y}%">
      <div class="sj-chip${keeper}"><div class="sj-shirt">${esc(spelerNr(pid))}</div>
      <div class="sj-naam">${esc(spelerNaam(pid))}</div></div></div>`;
  }
  return `<div class="sj-slot${doelwit}" data-slot="${sl.id}" style="left:${sl.x}%;top:${sl.y}%">
    <div class="sj-ring">${esc(sl.lijn)}</div></div>`;
}

function ladeHtml(lineup){
  const opgesteld = new Set(Object.values(lineup));
  const rest = (S.spelers || []).filter(p => !opgesteld.has(p.id));
  if (!rest.length) return '<span class="sj-lade-leeg">Iedereen opgesteld</span>';
  return rest.map(p =>
    `<div class="sj-chip"><div class="sj-shirt">${esc(spelerNr(p.id))}</div><div class="sj-naam">${esc(p.naam)}</div></div>`
  ).join('');
}

/* ---------- speler-keuze sheet (in de editor) ---------- */

function kiesSpelerSheet(slotId){
  const ed = _ed;
  const k = ed.kwarten[ed.actiefKwart];
  const slots = bouwSlots(ed.format, k.formatie);
  const slot = slots.find(s => s.id === slotId);
  if (!slot) return;

  const lu = k.lineup;
  const bezetDoor = {};
  for (const [sid, pid] of Object.entries(lu)) bezetDoor[pid] = sid;

  const lijst = (S.spelers || []).map(p => {
    const bezet = bezetDoor[p.id] && bezetDoor[p.id] !== slotId;
    return `<div class="sj-kies-rij${bezet ? ' bezet' : ''}" ${bezet ? '' : `data-pid="${p.id}"`}>
      <div class="sj-kies-nr">${esc(spelerNr(p.id))}</div>
      <div class="sj-kies-nm">${esc(p.naam)}</div>
      ${bezet ? `<span class="sj-kies-bz">al opgesteld</span>` : ''}</div>`;
  }).join('');

  const el = bouwSheet();
  el.querySelector('.sj-sheet-titel').textContent = slot.lijn === 'K' ? 'Keeper kiezen' : 'Speler voor deze plek';
  el.querySelector('.sj-sheet-sub').textContent = `${LIJN_NAAM[slot.lijn] || ''} · Kwart ${ed.actiefKwart}`;
  el.querySelector('.sj-sheet-lijst').innerHTML = lijst || '<div class="sj-leeg">Geen spelers in de selectie.</div>';
  const leegBtn = el.querySelector('.sj-sheet-leeg');
  leegBtn.style.display = lu[slotId] ? '' : 'none';
  leegBtn.onclick = () => { delete lu[slotId]; ed.actiefSlot = null; sluitSheet(); tekenEditor(); };

  el.querySelectorAll('[data-pid]').forEach(r => r.onclick = () => {
    lu[slotId] = r.dataset.pid;
    ed.actiefSlot = null;
    sluitSheet();
    tekenEditor();
  });

  el.classList.add('open');
}

/* ---------- opslaan editor ---------- */

async function bewaarEditor(){
  const ed = _ed;
  const naam = (ed.naam || '').trim();
  if (!naam) return meld('Geef het sjabloon een naam');
  const heeftIets = SJ_KWARTEN.some(k => Object.keys(ed.kwarten[k].lineup).length > 0);
  if (!heeftIets) return meld('Zet minstens in één kwart een opstelling neer');

  // gebruik de formatie van kwart 1 als wedstrijdbrede formatie
  const formatie = ed.kwarten['1'].formatie;
  const kwarten = {};
  for (const k of SJ_KWARTEN){
    kwarten[k] = { formatie: ed.kwarten[k].formatie, lineup: { ...ed.kwarten[k].lineup } };
  }

  try {
    await opslaanSjabloon({ naam, format: ed.format, formatie, kwarten }, ed.id);
    meld(ed.id ? 'Sjabloon bijgewerkt' : 'Sjabloon opgeslagen');
    // terug naar het beheerscherm
    openSjabloonScherm();
  } catch(e){
    meld('Opslaan mislukt: ' + (e.code || e.message));
  }
}

/* ==================== SHEET-INFRA (keuzelijsten) ==================== */

let _sheet = null;

function bouwSheet(){
  if (_sheet) return _sheet;
  const el = document.createElement('div');
  el.className = 'sj-sheet-overlay';
  el.innerHTML = `
    <div class="sj-sheet">
      <div class="sj-sheet-kop">
        <div><div class="sj-sheet-titel"></div><div class="sj-sheet-sub"></div></div>
        <button class="sj-sheet-sluit" aria-label="Sluiten">✕</button>
      </div>
      <div class="sj-sheet-lijst"></div>
      <button class="sj-sheet-leeg">Plek leegmaken</button>
    </div>`;
  document.body.appendChild(el);
  el.querySelector('.sj-sheet-sluit').onclick = () => sluitSheet();
  el.addEventListener('click', e => { if (e.target === el) sluitSheet(); });
  _sheet = el;
  return el;
}

function sluitSheet(){
  if (!_sheet) return;
  _sheet.classList.remove('open');
  if (_ed) _ed.actiefSlot = null;
}

/* ==================== TOEPASSEN ==================== */

/* Kernbewerking: leg de kwart-opstellingen van een bron (sjabloon of
   wedstrijd) op een doelwedstrijd. Per slot alleen spelers die in de selectie
   van de doelwedstrijd zitten. Retourneert {gezet, overgeslagen}. */
function pasBronToe(doelWed, bronKwarten, bronFormatie){
  const selectie = new Set(doelWed.selectie || []);
  let gezet = 0, overgeslagen = 0;

  for (const k of SJ_KWARTEN){
    const bron = bronKwarten?.[k];
    if (!bron || !bron.lineup) continue;
    if (!doelWed.kwarten[k]) doelWed.kwarten[k] = { lineup: {}, events: [], plan: [], correcties: {}, klok: { base: 0, running: false, start: 0 } };
    const nieuw = {};
    for (const [slot, pid] of Object.entries(bron.lineup)){
      if (selectie.has(pid) && speler(pid)){ nieuw[slot] = pid; gezet++; }
      else overgeslagen++;
    }
    doelWed.kwarten[k].lineup = nieuw;
    // formatie per kwart overnemen als geldig voor dit format
    if (bron.formatie && (formatieBestaat(doelWed.format, bron.formatie, eigenFormaties()) || parseFormatie(bron.formatie, doelWed.format))){
      doelWed.kwarten[k].formatie = bron.formatie;
    }
  }
  // wedstrijdbrede formatie
  if (bronFormatie && (formatieBestaat(doelWed.format, bronFormatie, eigenFormaties()) || parseFormatie(bronFormatie, doelWed.format))){
    doelWed.formatie = bronFormatie;
  }
  return { gezet, overgeslagen };
}

/* Kiezer: op welke wedstrijd leg ik dit sjabloon? Toont komende/lege
   wedstrijden bovenaan. */
function toepasKiezer(sj){
  if (!sj) return;
  const kandidaten = wedstrijdKandidaten(sj.format);
  if (!kandidaten.length){
    meld(`Geen wedstrijden met ${sj.format}×${sj.format} om op toe te passen`);
    return;
  }
  const el = bouwSheet();
  el.querySelector('.sj-sheet-titel').textContent = 'Sjabloon toepassen';
  el.querySelector('.sj-sheet-sub').textContent = `"${sj.naam || 'Sjabloon'}" op welke wedstrijd?`;
  el.querySelector('.sj-sheet-lijst').innerHTML = kandidaten.map(w => wedKeuzeHtml(w)).join('');
  el.querySelector('.sj-sheet-leeg').style.display = 'none';
  el.querySelectorAll('[data-wid]').forEach(r => r.onclick = () => {
    sluitSheet();
    bevestigToepassen(sj, r.dataset.wid);
  });
  el.classList.add('open');
}

function wedstrijdKandidaten(format){
  const vandaag = new Date().toISOString().slice(0, 10);
  return (S.wedstrijden || [])
    .filter(w => w.format === format)
    .sort((a, b) => {
      // lege/komende eerst, dan op datum oplopend
      const aLeeg = !heeftOpstelling(a), bLeeg = !heeftOpstelling(b);
      if (aLeeg !== bLeeg) return aLeeg ? -1 : 1;
      return (a.datum || '').localeCompare(b.datum || '');
    });
}

function heeftOpstelling(w){
  for (const k of Object.values(w.kwarten || {}))
    if (Object.keys(k.lineup || {}).length) return true;
  return false;
}

function wedKeuzeHtml(w){
  const leeg = !heeftOpstelling(w);
  const naam = w.tegenstander || 'Wedstrijd';
  const datum = w.datum || '';
  return `<div class="sj-kies-rij" data-wid="${w.id}">
    <div class="sj-kies-nr">⚽</div>
    <div class="sj-kies-nm">${esc(naam)}<div class="sj-kies-sub">${esc(datum)}${leeg ? ' · nog leeg' : ' · heeft opstelling'}</div></div>
    ${leeg ? '' : '<span class="sj-kies-bz">wordt overschreven</span>'}</div>`;
}

function bevestigToepassen(sj, wid){
  const w = (S.wedstrijden || []).find(x => x.id === wid);
  if (!w) return meld('Wedstrijd niet gevonden');
  const overschrijft = heeftOpstelling(w);
  if (overschrijft && !confirm('De bestaande opstellingen van deze wedstrijd worden vervangen. Doorgaan?')) return;

  const res = pasBronToe(w, sj.kwarten, sj.formatie);
  bewaarWedstrijdDoc(wid, w).then(() => {
    let msg = `Sjabloon toegepast — ${res.gezet} speler${res.gezet===1?'':'s'} geplaatst`;
    if (res.overgeslagen) msg += `, ${res.overgeslagen} overgeslagen (niet in selectie)`;
    meld(msg);
    telGebruik('sjabloon_toepassen');
    // sluit het sjabloonscherm zodat de coach de bijgewerkte wedstrijd ziet
    sluitOverlay();
    // open de wedstrijd zodat het resultaat direct zichtbaar is
    import('./wedstrijd.js?v=20260830b').then(m => m.openWedstrijd(wid)).catch(() => {});
  }).catch(e => meld('Opslaan mislukt: ' + (e.code || e.message)));
}

/* Wedstrijddoc opslaan. Als het de open wedstrijd is, laat wedstrijd.js het via
   zijn eigen debounce doen; anders schrijven we direct. */
function bewaarWedstrijdDoc(wid, w){
  return setDoc(doc(db, 'teams', S.teamId, 'wedstrijden', wid), w, { merge: true });
}

/* ==================== VANUIT WEDSTRIJD: OPSLAAN ALS SJABLOON ==================== */

export function bewaarWedstrijdAlsSjabloon(w){
  if (!w) return;
  const naam = prompt('Naam voor dit sjabloon:', w.tegenstander ? `Opstelling tegen ${w.tegenstander}` : 'Nieuw sjabloon');
  if (naam == null) return;
  const schoon = naam.trim();
  if (!schoon) return meld('Geef het sjabloon een naam');

  const kwarten = {};
  let iets = false;
  for (const k of SJ_KWARTEN){
    const bron = w.kwarten?.[k];
    const lineup = {};
    for (const [slot, pid] of Object.entries(bron?.lineup || {})){
      if (speler(pid)) lineup[slot] = pid;
    }
    if (Object.keys(lineup).length) iets = true;
    kwarten[k] = { formatie: bron?.formatie || w.formatie, lineup };
  }
  if (!iets) return meld('Deze wedstrijd heeft nog geen opstelling om te bewaren');

  opslaanSjabloon({ naam: schoon, format: w.format, formatie: w.formatie, kwarten })
    .then(() => meld('Opgeslagen als sjabloon'))
    .catch(e => meld('Opslaan mislukt: ' + (e.code || e.message)));
}

/* ==================== VANUIT WEDSTRIJD: OPSTELLING INVOEGEN ==================== */

/* Snelknop-sheet in het wedstrijdscherm: kies een sjabloon óf een vorige
   wedstrijd, en vul in één keer alle kwarten. */
export function openInvoegSheet(w){
  if (!w) return;
  const sjablonen = (S.sjablonen || []).filter(s => s.format === w.format);
  const vorige = (S.wedstrijden || [])
    .filter(x => x.id !== w.id && x.format === w.format && heeftOpstelling(x))
    .sort((a, b) => (b.datum || '').localeCompare(a.datum || ''))
    .slice(0, 8);

  const el = bouwSheet();
  el.querySelector('.sj-sheet-titel').textContent = 'Opstelling invoegen';
  el.querySelector('.sj-sheet-sub').textContent = 'Vult alle kwarten in één keer';
  el.querySelector('.sj-sheet-leeg').style.display = 'none';

  let html = '';
  if (sjablonen.length){
    html += '<div class="sj-sheet-groep">Sjablonen</div>';
    html += sjablonen.map(s => {
      const aantal = sjabloonSpelers(s).size;
      return `<div class="sj-kies-rij" data-sj="${s.id}">
        <div class="sj-kies-nr">📋</div>
        <div class="sj-kies-nm">${esc(s.naam || 'Sjabloon')}<div class="sj-kies-sub">${aantal} speler${aantal===1?'':'s'}</div></div></div>`;
    }).join('');
  }
  if (vorige.length){
    html += '<div class="sj-sheet-groep">Vorige wedstrijden</div>';
    html += vorige.map(x => `<div class="sj-kies-rij" data-wid="${x.id}">
      <div class="sj-kies-nr">⚽</div>
      <div class="sj-kies-nm">${esc(x.tegenstander || 'Wedstrijd')}<div class="sj-kies-sub">${esc(x.datum || '')}</div></div></div>`).join('');
  }
  if (!html) html = `<div class="sj-leeg">Nog geen sjablonen of eerdere ${w.format}×${w.format}-wedstrijden om over te nemen.</div>`;
  el.querySelector('.sj-sheet-lijst').innerHTML = html;

  el.querySelectorAll('[data-sj]').forEach(r => r.onclick = () => {
    const sj = (S.sjablonen || []).find(s => s.id === r.dataset.sj);
    if (sj){ sluitSheet(); toepassenOpHuidige(w, sj.kwarten, sj.formatie, `sjabloon "${sj.naam}"`); }
  });
  el.querySelectorAll('[data-wid]').forEach(r => r.onclick = () => {
    const bron = (S.wedstrijden || []).find(x => x.id === r.dataset.wid);
    if (bron){ sluitSheet(); toepassenOpHuidige(w, bron.kwarten, bron.formatie, `wedstrijd tegen ${bron.tegenstander || '?'}`); }
  });

  el.classList.add('open');
}

/* Toepassen op de op-dit-moment-open wedstrijd (S.wedstrijd). Vraagt wedstrijd.js
   om te hertekenen + op te slaan via de meegegeven callback. */
let _naToepassen = null;
export function zetNaToepassenCallback(fn){ _naToepassen = fn; }

function toepassenOpHuidige(w, bronKwarten, bronFormatie, bronLabel){
  const overschrijft = heeftOpstelling(w);
  if (overschrijft && !confirm('De huidige opstellingen van alle kwarten worden vervangen. Doorgaan?')) return;
  const res = pasBronToe(w, bronKwarten, bronFormatie);
  let msg = `Overgenomen uit ${bronLabel} — ${res.gezet} speler${res.gezet===1?'':'s'} geplaatst`;
  if (res.overgeslagen) msg += `, ${res.overgeslagen} overgeslagen`;
  meld(msg);
  telGebruik('opstelling_invoegen');
  if (_naToepassen) _naToepassen();   // wedstrijd.js: bewaarWedstrijd + renderWedstrijd
}

/* ==================== SUBSCRIPTION ==================== */

/* Wordt door teams.js (openTeam) aangeroepen om de sjablonen-listener te
   starten. Retourneert de unsubscribe-functie. */
export function luisterSjablonen(teamId, onUpdate){
  return onSnapshot(collection(db, 'teams', teamId, 'sjablonen'), snap => {
    S.sjablonen = snap.docs.map(d => ({ id: d.id, ...d.data() }))
      .sort((a, b) => (a.naam || '').localeCompare(b.naam || ''));
    // als het beheerscherm open staat, hertekenen
    if (_ov && _ov.classList.contains('open') && _ov.querySelector('.sj-titel')?.textContent === 'Opstelling-sjablonen'){
      tekenBeheer();
    }
    if (onUpdate) onUpdate();
  }, err => console.warn('[Cluppie] sjablonen-listener', err));
}
