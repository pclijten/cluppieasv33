/* ==================== TRAINING-WEERGAVE ====================
   Fullscreen, verticaal scrolbare weergave van een AI-gestructureerde training.
   Toont per oefening: nummer, titel, diagram (uit Storage) en de tekstblokken in
   de vertrouwde handleiding-stijl (.hl). Bovenaan een knop naar het ORIGINELE
   PDF (opent de bestaande pdf-viewer), zodat de coach altijd terug kan naar de
   bron.

   Gebruikt dezelfde overlay-aanpak en terug-bewaking als pdf-viewer.js, zodat de
   Android-terugknop / veeg-terug de weergave sluit i.p.v. de app te verlaten. */

import { bewaakTerug, vangnetStilTerugAlsNodig, esc } from './state.js?v=20260828d';

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
  // notitie-knop uit de balk verwijderen zodat een volgende training schoon start
  const nb = _overlay.querySelector('.trw-notitie-knop');
  if (nb) nb.remove();
  import('./training-aantekeningen.js?v=20260828d').then(m => m.resetAantekeningen()).catch(() => {});
  import('./training-video.js?v=20260828d').then(m => m.resetTrainingVideos()).catch(() => {});
  vangnetStilTerugAlsNodig(wasOpen);
}

/* ---- Diagram-lightbox: schermvullende weergave met pinch/dubbeltik-zoom ----
   De app zet globaal user-scalable=no; net als in pdf-viewer.js zetten we de
   viewport tijdelijk zoombaar zolang de lightbox open staat, zodat de coach
   met knijpen of dubbeltikken op het diagram kan inzoomen. */
let _lb = null, _viewportOrigineel = null;

function zetViewportZoombaar(aan){
  const meta = document.querySelector('meta[name="viewport"]');
  if (!meta) return;
  if (_viewportOrigineel === null) _viewportOrigineel = meta.getAttribute('content');
  meta.setAttribute('content', aan
    ? 'width=device-width, initial-scale=1, maximum-scale=5, user-scalable=yes'
    : _viewportOrigineel);
}

function bouwLightbox(){
  if (_lb) return _lb;
  const el = document.createElement('div');
  el.className = 'trw-lb';
  el.innerHTML = `
    <div class="trw-lb-balk">
      <div class="trw-lb-titel"></div>
      <button class="trw-lb-sluit" aria-label="Sluiten">✕</button>
    </div>
    <div class="trw-lb-canvas"><img alt=""></div>
    <div class="trw-lb-voet">🔍 knijp of dubbeltik om in te zoomen</div>`;
  document.body.appendChild(el);
  el.querySelector('.trw-lb-sluit').onclick = () => sluitLightbox();
  el.addEventListener('click', e => { if (e.target === el) sluitLightbox(); });
  _lb = el;
  return el;
}

function openLightbox(url, titel){
  const el = bouwLightbox();
  el.querySelector('.trw-lb-titel').textContent = titel || 'Diagram';
  el.querySelector('.trw-lb-canvas img').src = url;
  zetViewportZoombaar(true);
  el.classList.add('open');
  bewaakTerug();
}

export function sluitLightbox(){
  if (!_lb) return;
  const wasOpen = _lb.classList.contains('open');
  _lb.classList.remove('open');
  _lb.querySelector('.trw-lb-canvas img').src = '';
  zetViewportZoombaar(false);
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
  // Koppel diagram aan oefening. Nieuwe trainingen: diagrammen zijn doorlopend
  // genummerd (diagram1,2,3…) zodat oefening N ↔ diagram N — dus de index is
  // leidend. Oudere trainingen waren per pagina genummerd; als de index niets
  // oplevert, vallen we terug op diagramPagina (indien meegegeven door de AI).
  const D = diagramUrls || {};
  const url = D[idx] || D[String(idx)] ||
    (oef.diagramPagina != null ? (D[oef.diagramPagina] || D[String(oef.diagramPagina)]) : null);
  const diagram = url
    ? `<figure class="trw-diagram" data-zoom="${esc(url)}" data-zoomtitel="${esc(oef.titel || 'Oefening ' + idx)}"><img src="${esc(url)}" alt="" loading="lazy"><span class="trw-zoomhint">🔍 tik om te vergroten</span></figure>`
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
export function openTrainingWeergave({ titel, meta, oefeningen, diagramUrls, onOrigineel, trainingId, oefeningVideos, trainingClub }){
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

  // diagram → schermvullende lightbox met zoom
  stage.querySelectorAll('.trw-diagram[data-zoom]').forEach(fig => {
    fig.onclick = () => openLightbox(fig.dataset.zoom, fig.dataset.zoomtitel);
  });

  stage.scrollTop = 0;
  el.classList.add('open');
  bewaakTerug();

  // Aantekeningen-laag (additief): notitie-knop in de balk + tik-op-regel.
  // Alleen als er een trainingId is om notities aan te koppelen.
  if (trainingId){
    import('./training-aantekeningen.js?v=20260828d').then(mod => {
      const balk = el.querySelector('.trw-balk');
      mod.initAantekeningen({ stage, balk, trainingId });
      mod.bindItemKlik(stage);
    }).catch(() => {});

    // Video-uitleg-laag (additief): 🎬-knop in de balk die de zichtbare oefening
    // volgt + afspeeltegel per oefening; beheerder kan uploaden/vervangen/wissen.
    import('./training-video.js?v=20260828d').then(mod => {
      const balk = el.querySelector('.trw-balk');
      mod.initTrainingVideos({ stage, balk, trainingId, videos: oefeningVideos || {} });
    }).catch(() => {});
  }
}
