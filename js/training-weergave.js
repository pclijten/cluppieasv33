/* ==================== TRAINING-WEERGAVE ====================
   Fullscreen, verticaal scrolbare weergave van een AI-gestructureerde training.
   Toont per oefening: nummer, titel, diagram (uit Storage) en de tekstblokken in
   de vertrouwde handleiding-stijl (.hl). Bovenaan een knop naar het ORIGINELE
   PDF (opent de bestaande pdf-viewer), zodat de coach altijd terug kan naar de
   bron.

   Gebruikt dezelfde overlay-aanpak en terug-bewaking als pdf-viewer.js, zodat de
   Android-terugknop / veeg-terug de weergave sluit i.p.v. de app te verlaten. */

import { bewaakTerug, vangnetStilTerugAlsNodig, esc } from './state.js?v=20260818e';

let _overlay = null;

function bouwOverlay(){
  if (_overlay) return _overlay;
  const el = document.createElement('div');
  el.className = 'trw-overlay';
  el.innerHTML = `
    <div class="trw-balk">
      <button class="trw-terug" aria-label="Sluiten">‹</button>
      <div class="trw-kop">
        <div class="trw-titel"></div>
        <div class="trw-meta"></div>
      </div>
    </div>
    <div class="trw-stage"></div>`;
  document.body.appendChild(el);
  el.querySelector('.trw-terug').onclick = () => sluitTrainingWeergave();
  _overlay = el;
  return el;
}

export function sluitTrainingWeergave(){
  if (!_overlay) return;
  const wasOpen = _overlay.classList.contains('open');
  _overlay.classList.remove('open');
  _overlay.querySelector('.trw-stage').innerHTML = '';
  vangnetStilTerugAlsNodig(wasOpen);
}

function blokHtml(blok){
  const kop = blok.kop ? `<h3>${esc(blok.kop)}</h3>` : '';
  if (blok.type === 'lijst' && Array.isArray(blok.items)){
    const items = blok.items.map(x => `<li>${esc(x)}</li>`).join('');
    return `${kop}<ul>${items}</ul>`;
  }
  return `${kop}<p>${esc(blok.tekst || '')}</p>`;
}

function oefHtml(idx, oef, diagramUrls){
  // Koppel diagram aan oefening: gebruik diagramPagina als de AI die gaf,
  // val anders terug op de oefening-index (oefening N ↔ pagina N). Zo werkt het
  // ook als het AI-veld ontbreekt of als string binnenkomt.
  const paginaKey = (oef.diagramPagina != null) ? oef.diagramPagina : idx;
  const url = (diagramUrls || {})[paginaKey] || (diagramUrls || {})[String(paginaKey)] || (diagramUrls || {})[idx];
  const diagram = url
    ? `<figure class="trw-diagram"><img src="${esc(url)}" alt="" loading="lazy"></figure>`
    : '';
  const blokken = (oef.blokken || []).map(blokHtml).join('');
  return `
    <section class="trw-oef">
      <div class="trw-oef-kop">
        <span class="trw-oef-nr">${idx}</span>
        <h2>${esc(oef.titel || 'Oefening ' + idx)}</h2>
      </div>
      ${diagram}
      <div class="hl">${blokken}</div>
    </section>`;
}

/* openTrainingWeergave({ training, diagramUrls, oefeningen, onOrigineel })
   - training: het Firestore-doc (voor titel/meta)
   - diagramUrls: { pagina: url }
   - oefeningen: de AI-structuur
   - onOrigineel: callback die de PDF-viewer opent */
export function openTrainingWeergave({ titel, meta, oefeningen, diagramUrls, onOrigineel }){
  const el = bouwOverlay();
  el.querySelector('.trw-titel').textContent = titel || 'Training';
  el.querySelector('.trw-meta').textContent = meta || '';
  const stage = el.querySelector('.trw-stage');

  const navChips = oefeningen.map((o, i) =>
    `<a class="trw-chip" data-naar="${i}">${i + 1}. ${esc((o.titel || 'Oefening ' + (i+1)).slice(0, 22))}</a>`
  ).join('');

  const origKnop = onOrigineel
    ? `<button class="trw-orig"><span class="trw-pdftag">PDF</span> Origineel bekijken</button>`
    : '';

  stage.innerHTML = `
    ${origKnop}
    <nav class="trw-nav">${navChips}</nav>
    ${oefeningen.map((o, i) => oefHtml(i + 1, o, diagramUrls)).join('')}`;

  // origineel-knop → PDF-viewer
  const ob = stage.querySelector('.trw-orig');
  if (ob && onOrigineel) ob.onclick = () => onOrigineel();

  // snelnavigatie: scroll naar oefening
  const secties = [...stage.querySelectorAll('.trw-oef')];
  stage.querySelectorAll('.trw-chip').forEach(chip => {
    chip.onclick = () => {
      const i = Number(chip.dataset.naar);
      if (secties[i]) secties[i].scrollIntoView({ behavior: 'smooth', block: 'start' });
    };
  });

  stage.scrollTop = 0;
  el.classList.add('open');
  bewaakTerug();
}
