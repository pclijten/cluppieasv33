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
import { laadPdfJs } from './pdf-viewer.js?v=20260828a';

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
/* Haalt ALLE veld-diagrammen uit één PDF-pagina en geeft een array PNG-blobs
   terug (leeg als er geen zijn). Zo ziet de coach alleen de veldjes, niet de
   PDF-tekst. Sommige pagina's bevatten meerdere oefeningen met elk een eigen
   veld (bv. Schiettechniek + Partijvorm op één pagina) — die willen we allemaal.

   Aanpak: verzamel alle geschilderde afbeeldingen met hun positie en oppervlak,
   gooi te kleine weg (logo/avatar-icoontjes), sorteer op leesvolgorde (van boven
   naar beneden) en extraheer elk veldje. Extractie per afbeelding gaat via twee
   strategieën, want in de browser is de ingebedde bitmap niet altijd direct
   beschikbaar:
     1. de ingebedde afbeelding-bitmap rechtstreeks uitlezen (page.objs);
     2. lukt dat niet: de pagina renderen en het beeldgebied uitknippen
        (positie uit de transformatie-matrix). */
async function veldDiagramBlobs(page){
  const OPS = window.pdfjsLib.OPS;
  const vp = page.getViewport({ scale: 1 });
  let ops;
  try { ops = await page.getOperatorList(); }
  catch(e){ console.warn('[training-ai] getOperatorList faalde:', e); return []; }

  const kandidaten = [];
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
      const x0 = ctm[4], y0 = ctm[5];
      const x1 = ctm[0]+ctm[2]+ctm[4], y1 = ctm[1]+ctm[3]+ctm[5];
      const bx = Math.min(x0,x1), bw = Math.abs(x1-x0), bh = Math.abs(y1-y0);
      const topY = vp.height - (Math.min(y0,y1) + bh);
      kandidaten.push({ naam: args[0], rect: { x: bx, y: topY, w: bw, h: bh }, opp: bw * bh });
    }
  }
  if (!kandidaten.length){ console.warn('[training-ai] geen afbeelding op pagina gevonden'); return []; }

  // Kleine afbeeldingen (logo/avatar) wegfilteren. Drempel relatief t.o.v. de
  // grootste afbeelding op de pagina: velden zijn fors, iconen zijn nietig.
  const maxOpp = Math.max(...kandidaten.map(k => k.opp));
  const drempel = Math.max(2500, maxOpp * 0.15);   // absoluut vangnet + relatief
  const velden = kandidaten
    .filter(k => k.opp >= drempel)
    .sort((a, b) => a.rect.y - b.rect.y);            // leesvolgorde: boven → onder

  const blobs = [];
  for (const v of velden){
    const blob = await extraheerAfbeelding(page, vp, v.naam, v.rect);
    if (blob) blobs.push(blob);
  }
  if (!blobs.length) console.warn('[training-ai] kon geen diagram maken voor deze pagina');
  return blobs;
}

/* Extraheert één afbeelding (bitmap of bijgesneden render) tot een PNG-blob. */
async function extraheerAfbeelding(page, vp, naam, rect){
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

/* Zet de losse tekstfragmenten van pdf.js om naar tekst MET regels, zodat de
   opmaak (koppen op eigen regel, "- " opsommingen) bewaard blijft voor de AI.

   Werkwijze: elk fragment heeft een transform-matrix; transform[5] is de
   Y-positie op de pagina en transform[4] de X. We groeperen fragmenten met
   (vrijwel) dezelfde Y op één regel — de regelhoogte schatten we uit de
   letterhoogte, zodat het ook klopt bij grotere/kleinere lettertypes. Binnen
   een regel sorteren we op X (links → rechts). pdf.js geeft in v3 ook 'hasEOL'
   mee; dat gebruiken we als extra hint voor een regeleinde. */
function regelsUitTekstItems(items){
  const frags = items
    .filter(it => it.str != null)
    .map(it => ({
      str: it.str,
      x: it.transform ? it.transform[4] : 0,
      y: it.transform ? it.transform[5] : 0,
      h: it.height || (it.transform ? Math.abs(it.transform[3]) : 10),
      eol: !!it.hasEOL,
    }));
  if (!frags.length) return '';

  // Sorteer van boven naar beneden (grote Y eerst in PDF-coördinaten), dan links→rechts.
  frags.sort((a, b) => (b.y - a.y) || (a.x - b.x));

  const regels = [];
  let huidig = [];
  let vorigeY = null;
  const drempel = () => {
    // halve regelhoogte als grens; minstens 2px zodat kleine ronding niet splitst
    const h = huidig.length ? huidig[huidig.length - 1].h : 10;
    return Math.max(2, h * 0.5);
  };

  for (const f of frags){
    if (vorigeY === null){ huidig.push(f); vorigeY = f.y; continue; }
    const nieuweRegel = Math.abs(f.y - vorigeY) > drempel();
    if (nieuweRegel){
      regels.push(huidig);
      huidig = [f];
    } else {
      huidig.push(f);
      // een expliciete EOL sluit de regel na dit fragment af
      if (f.eol){ regels.push(huidig); huidig = []; }
    }
    vorigeY = f.y;
  }
  if (huidig.length) regels.push(huidig);

  return regels
    .map(r => r.sort((a, b) => a.x - b.x).map(f => f.str).join(' ').replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .join('\n')
    .trim();
}

export async function leesPdf(file){
  await laadPdfJs();
  const bytes = new Uint8Array(await file.arrayBuffer());
  const pdfDoc = await window.pdfjsLib.getDocument({ data: bytes.slice() }).promise;

  const paginas = [];
  const diagramBlobs = [];
  let volgnr = 0;   // doorlopende teller over alle pagina's heen

  for (let n = 1; n <= pdfDoc.numPages; n++){
    const page = await pdfDoc.getPage(n);

    // --- tekst ---
    // Belangrijk: we bouwen de tekst REGEL VOOR REGEL op i.p.v. alle fragmenten
    // met een spatie aan elkaar te plakken. Anders smelt de PDF-opmaak samen tot
    // één lange regel en verliest de AI het onderscheid tussen koppen en
    // opsommingen (de "- " aan het begin van een regel verdwijnt in de brij).
    // pdf.js geeft per fragment een transform-matrix; index 5 is de Y-positie.
    // Fragmenten met (vrijwel) dezelfde Y horen op dezelfde regel; zakt de Y,
    // dan begint een nieuwe regel. Zo blijven bullets en kopjes op eigen regels.
    const content = await page.getTextContent();
    const tekst = regelsUitTekstItems(content.items);
    paginas.push({ pagina: n, tekst });

    // --- diagrammen: ALLE ingebedde veldjes op deze pagina, in leesvolgorde ---
    // Eén pagina kan meerdere oefeningen met elk een eigen veld bevatten. We
    // nummeren de diagrammen dóór (volgnr) zodat oefening N ↔ diagram N klopt,
    // ook als een eerdere pagina meerdere velden had. De pagina bewaren we mee
    // voor terugvalkoppeling.
    const blobs = await veldDiagramBlobs(page);
    for (const blob of blobs){
      volgnr++;
      diagramBlobs.push({ volgnr, pagina: n, blob });
    }
    // Ook pagina's zonder diagram tellen niet mee — de weergave koppelt op
    // volgnr/index, niet op paginanummer.
  }

  return { paginas, diagramBlobs, bytes, aantalPaginas: pdfDoc.numPages };
}

/* Uploadt de diagram-PNG's naar Storage onder een vaste map per training.
   Sleutel = doorlopend volgnummer (1,2,3,…) zodat oefening N ↔ diagram N.
   Geeft een map { volgnr: downloadURL } terug. */
export async function uploadDiagrammen(clubId, mapId, diagramBlobs){
  const urls = {};
  for (const { volgnr, blob } of diagramBlobs){
    if (!blob) continue;
    const path = `clubs/${clubId}/trainingen/${mapId}/diagram${volgnr}.png`;
    const r = sRef(storage, path);
    await uploadBytes(r, blob, { contentType: 'image/png' });
    urls[volgnr] = await getDownloadURL(r);
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
  const doelen = Array.isArray(res?.data?.doelen) ? res.data.doelen : [];
  return { oefeningen, doelen };
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
