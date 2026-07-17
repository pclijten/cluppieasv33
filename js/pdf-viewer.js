/* ==================== PDF-VIEWER ====================
   Fullscreen in-app viewer voor gedeelde trainingen (oefenstof-PDF's).
   Vervangt window.open(url,'_blank') — dat opende de PDF in de native
   viewer van de telefoon op ware grootte, waardoor je moest inzoomen en
   heen-en-weer scrollen. Deze viewer rendert elke pagina met pdf.js op
   canvas, geschaald op de breedte van het scherm ("fit to width"), zodat
   er standaard niet meer horizontaal gescrold hoeft te worden. Inzoomen
   op details kan nog gewoon met pinch/dubbeltik (browser-native, werkt
   op een <canvas> zoals op elke andere afbeelding).

   pdf.js wordt lazy geladen (zelfde patroon als ExcelJS in
   club-evaluaties.js) — de rest van de app heeft deze library nooit
   nodig, dus pas ophalen op het moment dat een trainer echt een
   training opent. */
import { meld } from './state.js';

const PDFJS_VERSIE = '3.11.174';
const PDFJS_BASE = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${PDFJS_VERSIE}/`;

let _pdfjsLoad = null;
function laadPdfJs(){
  if (window.pdfjsLib) return Promise.resolve();
  if (_pdfjsLoad) return _pdfjsLoad;
  _pdfjsLoad = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = PDFJS_BASE + 'pdf.min.js';
    script.onload = () => {
      window.pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS_BASE + 'pdf.worker.min.js';
      resolve();
    };
    script.onerror = () => { _pdfjsLoad = null; reject(new Error('Kon PDF-library niet laden — controleer je internetverbinding')); };
    document.head.appendChild(script);
  });
  return _pdfjsLoad;
}

let _overlay = null;
function bouwOverlay(){
  if (_overlay) return _overlay;
  const el = document.createElement('div');
  el.className = 'pdfv-achter';
  el.innerHTML = `
    <div class="pdfv-kop">
      <button class="pdfv-sluit" aria-label="Sluiten">✕</button>
      <div class="pdfv-titelblok">
        <div class="pdfv-titel"></div>
        <div class="pdfv-meta"></div>
      </div>
      <div class="pdfv-teller"></div>
    </div>
    <div class="pdfv-stage"></div>
    <div class="pdfv-footer">🔍 dubbeltik of pinch om in te zoomen · scroll omlaag voor volgende pagina</div>`;
  document.body.appendChild(el);
  el.querySelector('.pdfv-sluit').onclick = () => sluitPdfViewer();
  _overlay = el;
  return el;
}

export function sluitPdfViewer(){
  if (_overlay) _overlay.classList.remove('open');
}

/* openPdfViewer({url, titel, meta}) — url moet cross-origin ophaalbaar zijn
   (Firebase Storage-downloadURL's zijn dat standaard). */
export async function openPdfViewer({ url, titel, meta }){
  const el = bouwOverlay();
  el.querySelector('.pdfv-titel').textContent = titel || 'Training';
  el.querySelector('.pdfv-meta').textContent = meta || '';
  const teller = el.querySelector('.pdfv-teller');
  const stage = el.querySelector('.pdfv-stage');
  teller.textContent = '';
  stage.innerHTML = `<div class="pdfv-laad"><div class="pdfv-spinner"></div>Oefenstof laden…</div>`;
  el.classList.add('open');

  try {
    await laadPdfJs();
    const resp = await fetch(url);
    if (!resp.ok) throw new Error('Download mislukt (' + resp.status + ')');
    const bytes = new Uint8Array(await resp.arrayBuffer());
    const pdfDoc = await window.pdfjsLib.getDocument({ data: bytes }).promise;

    teller.textContent = '1 / ' + pdfDoc.numPages;
    stage.innerHTML = '';

    const beschikbareBreedte = Math.min(stage.clientWidth, 540) - 20;
    for (let n = 1; n <= pdfDoc.numPages; n++){
      const page = await pdfDoc.getPage(n);
      const ongeschaald = page.getViewport({ scale: 1 });
      const schaal = (beschikbareBreedte / ongeschaald.width) * (window.devicePixelRatio || 1);
      const viewport = page.getViewport({ scale: schaal });

      const canvas = document.createElement('canvas');
      canvas.width = Math.ceil(viewport.width);
      canvas.height = Math.ceil(viewport.height);
      canvas.style.width = (viewport.width / (window.devicePixelRatio || 1)) + 'px';
      const ctx = canvas.getContext('2d');
      await page.render({ canvasContext: ctx, viewport }).promise;

      const wrap = document.createElement('div');
      wrap.className = 'pdfv-pagina';
      wrap.appendChild(canvas);
      stage.appendChild(wrap);
    }

    if (pdfDoc.numPages > 1){
      const wraps = [...stage.querySelectorAll('.pdfv-pagina')];
      stage.onscroll = () => {
        let dichtsbij = 0, kleinsteAfstand = Infinity;
        wraps.forEach((w, i) => {
          const afstand = Math.abs(w.getBoundingClientRect().top - stage.getBoundingClientRect().top);
          if (afstand < kleinsteAfstand){ kleinsteAfstand = afstand; dichtsbij = i; }
        });
        teller.textContent = (dichtsbij + 1) + ' / ' + pdfDoc.numPages;
      };
    }
  } catch (err){
    stage.innerHTML = `<div class="pdfv-laad">⚠️ Kon de PDF niet laden.<br><span style="font-size:11.5px;opacity:.7">Open 'm evt. rechtstreeks via de link.</span></div>`;
    meld('PDF laden mislukt');
    console.error('PDF-viewer fout:', err);
  }
}
