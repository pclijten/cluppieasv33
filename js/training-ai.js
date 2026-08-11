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
import { laadPdfJs } from './pdf-viewer.js?v=20260811a';

/* ---------- PDF → tekst per pagina + diagram-PNG's ---------- */

/* Leest de PDF één keer in en levert:
   - paginas: [{ pagina, tekst }]  (ruwe tekst voor de AI)
   - diagramBlobs: [{ pagina, blob }]  (PNG per pagina voor Storage)
   - bytes: de originele PDF-bytes (voor de PDF-upload) */
/* Haalt de ingebedde veld-afbeelding uit één PDF-pagina en geeft een PNG-blob
   terug (of null als er geen ingebedde afbeelding is). Zo krijgt de coach alleen
   het veldje te zien, niet de PDF-tekst als plaatje. */
async function veldDiagramBlob(page){
  const OPS = window.pdfjsLib.OPS;
  const ops = await page.getOperatorList();

  // zoek de eerste geschilderde afbeelding op de pagina
  let naam = null;
  for (let i = 0; i < ops.fnArray.length; i++){
    if (ops.fnArray[i] === OPS.paintImageXObject || ops.fnArray[i] === OPS.paintJpegXObject){
      naam = ops.argsArray[i][0];
      break;
    }
  }
  if (!naam) return null;

  // bitmap ophalen (kan in page.objs of commonObjs zitten)
  const img = await new Promise((res) => {
    try {
      if (page.objs.has(naam)) return res(page.objs.get(naam));
    } catch(e){}
    try { return page.objs.get(naam, res); } catch(e){ res(null); }
  });
  if (!img || !img.width || !img.height) return null;

  const { width, height, data, kind } = img;
  const canvas = document.createElement('canvas');
  canvas.width = width; canvas.height = height;
  const ctx = canvas.getContext('2d');
  const out = ctx.createImageData(width, height);

  // kind: 1=grayscale, 2=RGB, 3=RGBA (pdf.js ImageKind)
  if (kind === 3 || (data && data.length === width*height*4)){
    out.data.set(data);
  } else if (kind === 2 || (data && data.length === width*height*3)){
    for (let i=0, j=0; i<data.length; i+=3, j+=4){
      out.data[j]=data[i]; out.data[j+1]=data[i+1]; out.data[j+2]=data[i+2]; out.data[j+3]=255;
    }
  } else if (kind === 1 || (data && data.length === width*height)){
    for (let i=0, j=0; i<data.length; i++, j+=4){
      out.data[j]=out.data[j+1]=out.data[j+2]=data[i]; out.data[j+3]=255;
    }
  } else {
    return null;   // onbekend formaat → liever geen diagram dan een verkeerd
  }
  ctx.putImageData(out, 0, 0);
  return await new Promise(res => canvas.toBlob(res, 'image/png', 0.92));
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
