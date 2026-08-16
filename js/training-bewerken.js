/* ==================== TRAINING BEWERKEN ====================
   Admin-only scherm om een AI-gestructureerde training na te kijken en te
   corrigeren. Twee standen:
     • Verschillen — toont de AI-tekst met wijzigingen t.o.v. de originele
       PDF-tekst gemarkeerd (groen = toegevoegd, rood doorgestreept = weggehaald,
       stippellijn = alleen leesteken/hoofdletter).
     • Bewerken — elk tekstblok wordt bewerkbaar; typen/enteren mag. Opslaan
       schrijft de aangepaste oefeningen terug naar Firestore.

   De originele PDF-tekst per pagina (training.paginas) is nodig voor de diff;
   ontbreekt die (oudere training), dan tonen we alleen de bewerk-stand.

   Zelfde overlay-aanpak en terug-bewaking als de andere fullscreen-weergaven. */

import { db, doc, updateDoc } from './firebase.js?v=20260811a';
import { bewaakTerug, vangnetStilTerugAlsNodig, esc, meld } from './state.js?v=20260815c';

let _overlay = null;
let _ctx = null;   // { trainingId, oefeningen, origPerPagina }

function bouwOverlay(){
  if (_overlay) return _overlay;
  const el = document.createElement('div');
  el.className = 'trb-overlay';
  el.innerHTML = `
    <div class="trb-balk">
      <button class="trb-terug" aria-label="Sluiten">‹</button>
      <div class="trb-kop"><div class="trb-titel"></div><div class="trb-meta"></div></div>
    </div>
    <div class="trb-modus">
      <button data-modus="diff" class="aan">Verschillen</button>
      <button data-modus="edit">Bewerken</button>
    </div>
    <div class="trb-stage"></div>`;
  document.body.appendChild(el);
  el.querySelector('.trb-terug').onclick = () => sluitTrainingBewerken();
  el.querySelectorAll('.trb-modus button').forEach(b =>
    b.onclick = () => zetModus(b.dataset.modus));
  _overlay = el;
  return el;
}

export function sluitTrainingBewerken(){
  if (!_overlay) return;
  const wasOpen = _overlay.classList.contains('open');
  _overlay.classList.remove('open');
  _overlay.querySelector('.trb-stage').innerHTML = '';
  _ctx = null;
  vangnetStilTerugAlsNodig(wasOpen);
}

/* ---------- woord-diff ---------- */

function normWoord(w){ return w.toLowerCase().replace(/[^a-z0-9\u00e0-\u00ff]/g, ''); }

/* Longest Common Subsequence op woordniveau → lijst met {type, tekst}. */
function woordDiff(orig, ai){
  const a = (orig || '').split(/\s+/).filter(Boolean);
  const b = (ai   || '').split(/\s+/).filter(Boolean);
  const n = a.length, m = b.length;
  // LCS-tabel
  const dp = Array.from({ length: n + 1 }, () => new Int32Array(m + 1));
  for (let i = n - 1; i >= 0; i--){
    for (let j = m - 1; j >= 0; j--){
      dp[i][j] = normWoord(a[i]) === normWoord(b[j])
        ? dp[i + 1][j + 1] + 1
        : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const uit = [];
  let i = 0, j = 0;
  while (i < n && j < m){
    if (normWoord(a[i]) === normWoord(b[j])){
      // gelijk qua woord; verschilt alleen leesteken/hoofdletter? → 'minor'
      uit.push({ type: a[i] === b[j] ? 'gelijk' : 'minor', tekst: b[j] });
      i++; j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]){
      uit.push({ type: 'verwijderd', tekst: a[i] }); i++;
    } else {
      uit.push({ type: 'toegevoegd', tekst: b[j] }); j++;
    }
  }
  while (i < n){ uit.push({ type: 'verwijderd', tekst: a[i] }); i++; }
  while (j < m){ uit.push({ type: 'toegevoegd', tekst: b[j] }); j++; }
  return uit;
}

function diffHtml(orig, ai){
  return woordDiff(orig, ai).map(d => {
    const t = esc(d.tekst);
    if (d.type === 'toegevoegd') return `<ins>${t}</ins>`;
    if (d.type === 'verwijderd') return `<del>${t}</del>`;
    if (d.type === 'minor')      return `<span class="minor">${t}</span>`;
    return t;
  }).join(' ');
}


/* ---------- per-blok koppeling met de originele PDF-tekst ----------
   De PDF-tekst komt binnen als één lange sliert per pagina (met kop-rommel als
   "Category", "Difficulty", de naam van de maker). Om een SCHONE diff te tonen
   koppelen we elk AI-blok aan het stukje originele tekst dat er het best mee
   overeenkomt, en diffen we alleen tegen dát stukje — niet tegen de hele pagina.
   Zo verdwijnt de ruis van herordende/kop-tekst. */

function tokenize(tekst){
  return (tekst || '').split(/\s+/).filter(Boolean);
}

/* Vind in de originele woordenlijst het bereik [start,eind) dat het best bij de
   AI-blok-woorden past. Gebruikt de matchende blokken van SequenceMatcher. */
function vindOrigineelBereik(origNorm, aiNorm){
  if (!aiNorm.length || !origNorm.length) return null;
  const blokken = matchingBlocks(origNorm, aiNorm).filter(b => b.size > 0);
  if (!blokken.length) return null;
  const start = Math.min(...blokken.map(b => b.a));
  const eind  = Math.max(...blokken.map(b => b.a + b.size));
  return [start, eind];
}

/* Lichte JS-variant van Python's difflib.SequenceMatcher.get_matching_blocks:
   vindt de langste gemeenschappelijke stukken tussen twee woordenlijsten a en b.
   Voldoende voor onze koppeling (a = origineel, b = AI-blok). */
function matchingBlocks(a, b){
  const resultaat = [];
  // index van elk woord in b, voor snelle lookup
  const b2j = new Map();
  b.forEach((w, j) => { if (!b2j.has(w)) b2j.set(w, []); b2j.get(w).push(j); });

  function langsteMatch(alo, ahi, blo, bhi){
    let besti = alo, bestj = blo, bestsize = 0;
    let j2len = new Map();
    for (let i = alo; i < ahi; i++){
      const nieuw = new Map();
      const js = b2j.get(a[i]) || [];
      for (const j of js){
        if (j < blo) continue;
        if (j >= bhi) break;
        const k = (j2len.get(j - 1) || 0) + 1;
        nieuw.set(j, k);
        if (k > bestsize){ besti = i - k + 1; bestj = j - k + 1; bestsize = k; }
      }
      j2len = nieuw;
    }
    return { a: besti, b: bestj, size: bestsize };
  }

  const stack = [[0, a.length, 0, b.length]];
  while (stack.length){
    const [alo, ahi, blo, bhi] = stack.pop();
    const m = langsteMatch(alo, ahi, blo, bhi);
    if (m.size > 0){
      resultaat.push(m);
      if (alo < m.a && blo < m.b) stack.push([alo, m.a, blo, m.b]);
      if (m.a + m.size < ahi && m.b + m.size < bhi)
        stack.push([m.a + m.size, ahi, m.b + m.size, bhi]);
    }
  }
  return resultaat;
}

/* ---------- rendering per stand ---------- */


function renderDiff(){
  const el = _overlay.querySelector('.trb-stage');
  const heeftOrig = _ctx.origPerPagina && Object.keys(_ctx.origPerPagina).length;

  if (!heeftOrig){
    el.innerHTML = `<div class="trb-uitleg">Voor deze training is de originele PDF-tekst niet bewaard, dus de verschillen kunnen niet getoond worden. Je kunt de tekst wel bewerken.</div>`;
    return;
  }

  el.innerHTML = `
    <div class="trb-uitleg">De AI heeft de PDF-tekst opgemaakt. <b>Groen</b> = door AI toegevoegd, <b class="del-b">rood doorgestreept</b> = weggelaten, <span class="minor-b">stippellijn</span> = alleen leesteken of hoofdletter. Let vooral op <b>groene</b> stukken: dat is tekst die niet letterlijk in de PDF stond.</div>
    ${_ctx.oefeningen.map((oef, i) => {
      // Originele paginatekst voor deze oefening.
      const paginaKey = (oef.diagramPagina != null) ? oef.diagramPagina : (i + 1);
      const origPagina = _ctx.origPerPagina[paginaKey] || _ctx.origPerPagina[String(paginaKey)] || '';
      const origWoorden = tokenize(origPagina);
      const origNorm = origWoorden.map(normWoord);

      const blokken = (oef.blokken || []).map(b => {
        const kop = b.kop ? `<h3>${esc(b.kop)}</h3>` : '';
        const aiTekst = (b.type === 'lijst' && Array.isArray(b.items)) ? b.items.join(' ') : (b.tekst || '');
        const aiWoorden = tokenize(aiTekst);
        const aiNorm = aiWoorden.map(normWoord);

        // Zoek het stukje originele tekst dat bij dit blok hoort, en diff daar
        // alleen tegen. Zo geen ruis van kop-tekst of herordende blokken.
        const bereik = vindOrigineelBereik(origNorm, aiNorm);
        const origStuk = bereik ? origWoorden.slice(bereik[0], bereik[1]).join(' ') : '';
        return `${kop}<p class="trb-diff">${diffHtml(origStuk, aiTekst)}</p>`;
      }).join('');

      return `<section class="trb-oef">
        <div class="trb-oef-kop"><span class="trb-oef-nr">${i + 1}</span><h2>${esc(oef.titel || 'Oefening ' + (i + 1))}</h2></div>
        <div class="hl">${blokken}</div>
      </section>`;
    }).join('')}`;
}

function renderEdit(){
  const el = _overlay.querySelector('.trb-stage');
  el.innerHTML = `
    <div class="trb-uitleg">Tik in een tekstvak om te typen of te enteren. Bij een lijst staat elk item op een eigen regel. Klaar? Tik op <b>Opslaan</b>.</div>
    ${_ctx.oefeningen.map((oef, i) => {
      const blokken = (oef.blokken || []).map((b, bi) => {
        const kop = b.kop ? `<h3>${esc(b.kop)}</h3>` : '';
        const waarde = (b.type === 'lijst' && Array.isArray(b.items))
          ? b.items.join('\n')
          : (b.tekst || '');
        return `${kop}<div class="trb-bewerk" contenteditable="true" data-oef="${i}" data-blok="${bi}">${esc(waarde)}</div>`;
      }).join('');
      return `<section class="trb-oef">
        <div class="trb-oef-kop"><span class="trb-oef-nr">${i + 1}</span><h2>${esc(oef.titel || 'Oefening ' + (i + 1))}</h2></div>
        <div class="hl">${blokken}</div>
      </section>`;
    }).join('')}
    <div class="trb-opslaan">
      <button class="trb-knop grijs" data-actie="annuleer">Annuleren</button>
      <button class="trb-knop vol" data-actie="opslaan">✓ Opslaan</button>
    </div>`;

  el.querySelector('[data-actie="annuleer"]').onclick = () => zetModus('diff');
  el.querySelector('[data-actie="opslaan"]').onclick = () => bewaarBewerkingen();
}

let _modus = 'diff';
function zetModus(m){
  _modus = m;
  _overlay.querySelectorAll('.trb-modus button').forEach(b =>
    b.classList.toggle('aan', b.dataset.modus === m));
  if (m === 'diff') renderDiff(); else renderEdit();
  _overlay.querySelector('.trb-stage').scrollTop = 0;
}

/* Leest de bewerkte velden uit en schrijft ze terug naar de oefeningen + Firestore. */
async function bewaarBewerkingen(){
  const velden = _overlay.querySelectorAll('.trb-bewerk');
  // maak een diepe kopie zodat we niet half opslaan bij een fout
  const nieuw = JSON.parse(JSON.stringify(_ctx.oefeningen));
  velden.forEach(v => {
    const oi = Number(v.dataset.oef), bi = Number(v.dataset.blok);
    const blok = nieuw[oi]?.blokken?.[bi];
    if (!blok) return;
    // innerText behoudt regeleinden (enters) die de gebruiker typte
    const tekst = v.innerText.replace(/\u00a0/g, ' ').replace(/\s+\n/g, '\n').trim();
    if (blok.type === 'lijst'){
      blok.items = tekst.split('\n').map(s => s.trim()).filter(Boolean);
    } else {
      blok.tekst = tekst;
    }
  });

  const knop = _overlay.querySelector('[data-actie="opslaan"]');
  if (knop){ knop.disabled = true; knop.textContent = 'Opslaan…'; }

  // Preview-modus: nog geen Firestore-doc → geef de tekst terug via callback.
  if (_ctx.opslaanLokaal){
    _ctx.opslaanLokaal(nieuw);
    sluitTrainingBewerken();
    return;
  }

  try {
    await updateDoc(doc(db, 'trainingen', _ctx.trainingId), { oefeningen: nieuw });
    _ctx.oefeningen = nieuw;
    meld('Wijzigingen opgeslagen');
    zetModus('diff');
    if (typeof _ctx.onOpgeslagen === 'function') _ctx.onOpgeslagen(nieuw);
  } catch(e){
    console.error('[training-bewerken] opslaan mislukt', e);
    meld('Opslaan mislukt');
    if (knop){ knop.disabled = false; knop.textContent = '✓ Opslaan'; }
  }
}

/* openTrainingBewerken({ trainingId, titel, meta, oefeningen, paginas, onOpgeslagen, opslaanLokaal }) */
export function openTrainingBewerken({ trainingId, titel, meta, oefeningen, paginas, onOpgeslagen, opslaanLokaal }){
  const el = bouwOverlay();
  // originele tekst per pagina in een map { 1: "...", 2: "..." }
  const origPerPagina = {};
  (paginas || []).forEach(p => { if (p && p.pagina != null) origPerPagina[p.pagina] = p.tekst || ''; });

  _ctx = {
    trainingId,
    oefeningen: JSON.parse(JSON.stringify(oefeningen || [])),
    origPerPagina,
    onOpgeslagen,
    opslaanLokaal,
  };
  el.querySelector('.trb-titel').textContent = titel || 'Training bewerken';
  el.querySelector('.trb-meta').textContent = meta || '';

  // geen originele tekst → start meteen in bewerk-stand
  _modus = origPerPagina && Object.keys(origPerPagina).length ? 'diff' : 'edit';
  el.querySelectorAll('.trb-modus button').forEach(b =>
    b.classList.toggle('aan', b.dataset.modus === _modus));
  if (_modus === 'diff') renderDiff(); else renderEdit();

  el.classList.add('open');
  bewaakTerug();
}
