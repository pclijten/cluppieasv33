/* ==================== TRAINING-AI ====================
   De AI-laag rond het uploaden van oefenstof-PDF's. Bij het uploaden van een
   training zet dit:
     1. de originele PDF naar Storage (blijft altijd bewaard, "bekijk origineel");
     2. elke pagina als PNG-diagram naar Storage;
     3. de ruwe PDF-tekst per pagina naar de Cloud Function 'structureerTraining',
        die er een gestructureerde, scrolbare layout van maakt (JSON).

   Belangrijk — de AI mag ALLEEN de layout bepalen, niet de tekst herschrijven.
   Daarom controleert dit bestand na afloop WOORD-VOOR-WOORD (programmatisch, geen
   AI) hoeveel van de originele tekst behouden bleef en hoeveel woorden de AI
   toevoegde. Die score toont de admin in het preview-scherm.

   pdf.js wordt hergebruikt uit pdf-viewer.js (zelfde lazy-loaded library). */

import {
  storage, sRef, uploadBytes, getDownloadURL,
  functions, httpsCallable
} from './firebase.js?v=20260811a';
import { laadPdfJs } from './pdf-viewer.js?v=20260818c';

/* ---------- PDF → tekst per pagina + diagram-PNG's ---------- */

/* Leest de PDF één keer in en levert:
   - paginas: [{ pagina, tekst }]  (ruwe tekst voor de AI)
   - diagramBlobs: [{ pagina, blob }]  (PNG per pagina voor Storage)
   - bytes: de originele PDF-bytes (voor de PDF-upload) */
/* Haalt het ingebedde veld-diagram uit één PDF-pagina en geeft een PNG-blob
   terug (of null). Zo ziet de coach alleen het veldje, niet de PDF-tekst.

   Drie strategieën achter elkaar, want in de browser (met PDF.js-worker) is
   de ingebedde bitmap niet altijd direct beschikbaar:
     1. de ingebedde afbeelding-bitmap rechtstreeks uitlezen (page.objs);
     2. als dat niet lukt: de pagina renderen en het beeldgebied uitknippen
        (positie bepaald uit de transformatie-matrix);
     3. lukt niets → null + een console-waarschuwing (faalt niet stil). */
async function veldDiagramBlob(page){
  const OPS = window.pdfjsLib.OPS;
  const vp = page.getViewport({ scale: 1 });
  let ops;
  try { ops = await page.getOperatorList(); }
  catch(e){ console.warn('[training-ai] getOperatorList faalde:', e); return null; }

  // Vind de eerste geschilderde afbeelding + de transformatie-matrix ervoor,
  // zodat we zowel de naam (voor strategie 1) als de positie (strategie 2) hebben.
  let naam = null, rect = null;
  let ctm = [1,0,0,1,0,0];
  const stack = [];
  for (let i = 0; i < ops.fnArray.length; i++){
    const fn = ops.fnArray[i], args = ops.argsArray[i];
    if (fn === OPS.save){ stack.push(ctm.slice()); }
    else if (fn === OPS.restore){ ctm = stack.pop() || [1,0,0,1,0,0]; }
    else if (fn === OPS.transform){
      const [a,b,c,d,e,f] = args;
      const [A,B,C,D,E,F] = ctm;
      ctm = [A*a+C*b, B*a+D*b, A*c+C*d, B*c+D*d, A*e+C*f+E, B*e+D*f+F];
    }
    else if (fn === OPS.paintImageXObject || fn === OPS.paintInlineImageXObject || fn === OPS.paintJpegXObject){
      naam = args[0];
      const x0 = ctm[4], y0 = ctm[5];
      const x1 = ctm[0]+ctm[2]+ctm[4], y1 = ctm[1]+ctm[3]+ctm[5];
      const bx = Math.min(x0,x1), bw = Math.abs(x1-x0), bh = Math.abs(y1-y0);
      const topY = vp.height - (Math.min(y0,y1) + bh);
      rect = { x: bx, y: topY, w: bw, h: bh };
      break;
    }
  }
  if (!naam && !rect){ console.warn('[training-ai] geen afbeelding op pagina gevonden'); return null; }

  // --- Strategie 1: ingebedde bitmap rechtstreeks ---
  if (naam){
    try {
      const img = await new Promise((res) => {
        let klaar = false;
        const geef = (v) => { if (!klaar){ klaar = true; res(v); } };
        try { if (page.objs.has(naam)) return geef(page.objs.get(naam)); } catch(e){}
        try { page.objs.get(naam, geef); } catch(e){ geef(null); }
        // veiligheids-timeout: als de worker niets teruggeeft, ga door naar strategie 2
        setTimeout(() => geef(null), 3000);
      });
      const blob = img && bitmapNaarBlob(img);
      if (blob) return await blob;
    } catch(e){ console.warn('[training-ai] bitmap-extractie faalde, val terug op bijsnijden:', e); }
  }

  // --- Strategie 2: pagina renderen en het beeldgebied uitknippen ---
  if (rect && rect.w > 20 && rect.h > 20){
    try {
      const schaal = 1000 / vp.width;               // scherp genoeg
      const vp2 = page.getViewport({ scale: schaal });
      const vol = document.createElement('canvas');
      vol.width = Math.ceil(vp2.width); vol.height = Math.ceil(vp2.height);
      await page.render({ canvasContext: vol.getContext('2d'), viewport: vp2 }).promise;
      const crop = document.createElement('canvas');
      crop.width = Math.round(rect.w * schaal);
      crop.height = Math.round(rect.h * schaal);
      crop.getContext('2d').drawImage(
        vol,
        Math.round(rect.x * schaal), Math.round(rect.y * schaal),
        crop.width, crop.height,
        0, 0, crop.width, crop.height
      );
      return await new Promise(res => crop.toBlob(res, 'image/png', 0.92));
    } catch(e){ console.warn('[training-ai] bijsnijden faalde:', e); }
  }

  console.warn('[training-ai] kon geen diagram maken voor deze pagina');
  return null;
}

/* Zet een pdf.js-bitmap (page.objs) om naar een PNG-blob, of null bij onbekend formaat. */
function bitmapNaarBlob(img){
  if (!img || !img.width || !img.height || !img.data) return null;
  const { width, height, data, kind } = img;
  const canvas = document.createElement('canvas');
  canvas.width = width; canvas.height = height;
  const ctx = canvas.getContext('2d');
  const out = ctx.createImageData(width, height);
  if (kind === 3 || data.length === width*height*4){
    out.data.set(data);
  } else if (kind === 2 || data.length === width*height*3){
    for (let i=0, j=0; i<data.length; i+=3, j+=4){
      out.data[j]=data[i]; out.data[j+1]=data[i+1]; out.data[j+2]=data[i+2]; out.data[j+3]=255;
    }
  } else if (kind === 1 || data.length === width*height){
    for (let i=0, j=0; i<data.length; i++, j+=4){
      out.data[j]=out.data[j+1]=out.data[j+2]=data[i]; out.data[j+3]=255;
    }
  } else {
    return null;
  }
  ctx.putImageData(out, 0, 0);
  return new Promise(res => canvas.toBlob(res, 'image/png', 0.92));
}

export async function leesPdf(file){
  await laadPdfJs();
  const bytes = new Uint8Array(await file.arrayBuffer());
  const pdfDoc = await window.pdfjsLib.getDocument({ data: bytes.slice() }).promise;

  const paginas = [];
  const diagramBlobs = [];

  for (let n = 1; n <= pdfDoc.numPages; n++){
    const page = await pdfDoc.getPage(n);

    // --- tekst ---
    const content = await page.getTextContent();
    const tekst = content.items.map(it => it.str).join(' ')
      .replace(/\s+/g, ' ')
      .trim();
    paginas.push({ pagina: n, tekst });

    // --- diagram: ALLEEN het ingebedde veldje, niet de hele pagina ---
    // De oefenstof-PDF's bevatten per pagina precies één ingebedde afbeelding:
    // het groene veld-diagram. We halen die bitmap eruit (getOperatorList →
    // paintImageXObject → page.objs) i.p.v. de pagina met tekst te renderen.
    const blob = await veldDiagramBlob(page);
    diagramBlobs.push({ pagina: n, blob });
  }

  return { paginas, diagramBlobs, bytes, aantalPaginas: pdfDoc.numPages };
}

/* Uploadt de diagram-PNG's naar Storage onder een vaste map per training.
   Geeft een map { pagina: downloadURL } terug. */
export async function uploadDiagrammen(clubId, mapId, diagramBlobs){
  const urls = {};
  for (const { pagina, blob } of diagramBlobs){
    if (!blob) continue;
    const path = `clubs/${clubId}/trainingen/${mapId}/diagram${pagina}.png`;
    const r = sRef(storage, path);
    await uploadBytes(r, blob, { contentType: 'image/png' });
    urls[pagina] = await getDownloadURL(r);
  }
  return urls;
}

/* ---------- AI-structurering ---------- */

/* Roept de Cloud Function aan. Geeft { oefeningen } terug. */
export async function structureer(paginas){
  const fn = httpsCallable(functions, 'structureerTraining');
  const res = await fn({ paginas });
  const oefeningen = res?.data?.oefeningen;
  if (!Array.isArray(oefeningen) || !oefeningen.length){
    throw new Error('AI leverde geen oefeningen op');
  }
  return oefeningen;
}

/* ---------- Overeenkomst-score (programmatisch, geen AI) ---------- */

/* Splitst tekst in genormaliseerde woorden. Korte functiewoorden (<=2 letters)
   negeren we — die zeggen niets over of de AI de inhoud trouw overnam. */
function woorden(s){
  return (s || '')
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')   // accenten weg voor de vergelijking
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 2);
}

/* Verzamelt alle tekst uit de AI-oefeningen (koppen + tekst + lijstitems). */
function aiTekst(oefeningen){
  const stukken = [];
  for (const oef of oefeningen){
    if (oef.titel) stukken.push(oef.titel);
    for (const blok of (oef.blokken || [])){
      if (blok.kop) stukken.push(blok.kop);
      if (blok.type === 'lijst' && Array.isArray(blok.items)) stukken.push(blok.items.join(' '));
      else if (blok.tekst) stukken.push(blok.tekst);
    }
  }
  return stukken.join(' ');
}

/* Vergelijkt de originele PDF-tekst met de AI-versie.
   - dekking:  % van de unieke originele woorden dat terugkomt in de AI-versie
   - verzonnen: aantal unieke AI-woorden dat NIET in het origineel voorkomt
   Kleine samenvoegingen ("door ontwikkelen" -> "doorontwikkelen") vangen we op
   door ook te kijken of een AI-woord als deel van twee originele woorden bestaat. */
export function berekenScore(origineleTekst, oefeningen){
  const wo = woorden(origineleTekst);
  const wa = woorden(aiTekst(oefeningen));

  const setO = new Set(wo);
  const setA = new Set(wa);

  // samengevoegde originele woorden toestaan: "doorontwikkelen" telt als bekend
  // als het de aaneenschakeling is van twee opeenvolgende originele woorden.
  const samengevoegd = new Set();
  for (let i = 0; i < wo.length - 1; i++){
    samengevoegd.add(wo[i] + wo[i + 1]);
  }
  const bekend = (w) => setO.has(w) || samengevoegd.has(w) ||
    // of het AI-woord is zelf een samenstelling die als losse delen in origineel zit
    [...setO].some(o => o.length > 3 && w.startsWith(o));

  let behouden = 0;
  for (const w of setO) if (setA.has(w)) behouden++;
  const dekking = setO.size ? Math.round((behouden / setO.size) * 100) : 0;

  const verzonnen = [];
  for (const w of setA) if (!bekend(w)) verzonnen.push(w);

  return {
    dekkingPct: dekking,
    verzonnenAantal: verzonnen.length,
    verzonnenVoorbeelden: verzonnen.slice(0, 10),
    origWoorden: setO.size,
  };
}

/* Beoordeelt of de score "goed genoeg" is om standaard te delen.
   Drempels bewust streng: layout-only output haalt in de praktijk >90% dekking
   met (vrijwel) 0 verzonnen woorden. */
export function scoreGoed(score){
  return score.dekkingPct >= 90 && score.verzonnenAantal <= 3;
}
