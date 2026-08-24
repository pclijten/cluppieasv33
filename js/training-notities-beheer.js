/* ==================== TRAINING-NOTITIES BEHEER ====================
   Beheerdersoverzicht van de aantekeningen die coaches bij één training hebben
   gemaakt — bereikbaar vanuit de oefenstof-/upload-lijst op het clubscherm.

   Twee weergaven via een schakelaar:
     - Drukste plekken : per blok-id geaggregeerd, gesorteerd op aantal notities,
                         met tellers per type (opmerking/aandacht/filmpje).
     - Hele training   : de oefeningen met alle coach-notities gegroepeerd per blok.

   Toont ALLE notities van ALLE teams (de beheerder ziet clubbreed), in
   tegenstelling tot de coach-weergave die op één team filtert. Puur Firestore-
   aggregatie; de AI-samenvatting per hotspot is een latere Cloud-Function-laag.

   Notities worden verzameld over alle teams die deze training in bezit hebben.
   Omdat notities onder teams/{teamId}/trainingAantekeningen leven met een
   trainingId-veld, halen we ze op via een collectionGroup-query en filteren op
   trainingId. */

import {
  db, collection, doc, query, where, getDocs, getDoc, setDoc, serverTimestamp,
  functions, httpsCallable
} from './firebase.js?v=20260811a';
import { S, esc, isBeheerder, bewaakTerug, vangnetStilTerugAlsNodig } from './state.js?v=20260823a';
import { blokId } from './training-aantekeningen.js?v=20260823a';

let _overlay = null;

function bouwOverlay(){
  if (_overlay) return _overlay;
  const el = document.createElement('div');
  el.className = 'tnb-overlay';
  el.innerHTML = `
    <div class="tnb-balk">
      <button class="tnb-terug" aria-label="Sluiten">‹</button>
      <div class="tnb-kop">
        <div class="tnb-eyebrow">Notities bij training</div>
        <div class="tnb-titel"></div>
      </div>
    </div>
    <div class="tnb-schakel">
      <button data-w="hotspots" class="actief">Drukste plekken</button>
      <button data-w="volledig">Hele training</button>
    </div>
    <div class="tnb-stage"></div>`;
  document.body.appendChild(el);
  el.querySelector('.tnb-terug').onclick = () => sluitBeheerNotities();
  el.querySelectorAll('.tnb-schakel button').forEach(b => {
    b.onclick = () => {
      el.querySelectorAll('.tnb-schakel button').forEach(x => x.classList.remove('actief'));
      b.classList.add('actief');
      el._toon(b.dataset.w);
    };
  });
  _overlay = el;
  return el;
}

export function sluitBeheerNotities(){
  if (!_overlay) return;
  const wasOpen = _overlay.classList.contains('open');
  _overlay.classList.remove('open');
  _overlay.querySelector('.tnb-stage').innerHTML = '';
  vangnetStilTerugAlsNodig(wasOpen);
}

async function haalNotities(trainingId){
  // Per team van de club de subcollectie queryen en filteren op trainingId.
  // (collectionGroup wordt niet door firebase.js geëxporteerd; firebase.js is pinned.)
  const teams = S.clubTeams || [];
  const uit = [];
  for (const team of teams){
    try {
      const q = query(collection(db, 'teams', team.id, 'trainingAantekeningen'), where('trainingId', '==', trainingId));
      const snap = await getDocs(q);
      snap.forEach(d => uit.push({ id: d.id, teamId: team.id, teamNaam: team.naam || '', ...d.data() }));
    } catch(e){ /* team zonder notities of geen toegang: overslaan */ }
  }
  return uit;
}

/* Bouwt een index blokId -> { tekst, oefTitel } uit de AI-structuur, zodat we
   bij elke notitie het bijbehorende citaat en de oefening kunnen tonen. */
function blokIndex(oefeningen){
  const idx = {};
  (oefeningen || []).forEach((oef, oIdx) => {
    let blokIdx = 0;
    (oef.blokken || []).forEach(blok => {
      if (blok.type === 'lijst' && Array.isArray(blok.items)){
        blok.items.forEach((it, iIdx) => {
          idx[blokId(oIdx, blokIdx, iIdx)] = { tekst: it, oefTitel: oef.titel || ('Oefening ' + (oIdx+1)) };
        });
      } else {
        idx[blokId(oIdx, blokIdx)] = { tekst: blok.tekst || (blok.kop || ''), oefTitel: oef.titel || ('Oefening ' + (oIdx+1)) };
      }
      blokIdx++;
    });
  });
  return idx;
}

const TYPE_LBL = { opmerking:'Opmerking', aandacht:'Aandacht', filmpje:'Filmpje' };

function hotspotsHtml(notities, bidx){
  const perBlok = {};
  notities.forEach(n => { (perBlok[n.blokId] ||= { opmerking:0, aandacht:0, filmpje:0, items:[] }); perBlok[n.blokId][n.type]++; perBlok[n.blokId].items.push(n); });
  const rijen = Object.entries(perBlok)
    .map(([bid, t]) => ({ bid, t, totaal: t.opmerking + t.aandacht + t.filmpje }))
    .sort((a,b) => b.totaal - a.totaal);

  if (!rijen.length) return `<div class="tnb-leeg">Nog geen notities bij deze training.</div>`;

  return rijen.map(({bid, t}) => {
    const info = bidx[bid] || { tekst:'(regel niet meer in training)', oefTitel:'' };
    const tellers = [];
    if (t.opmerking) tellers.push(`<span class="tnb-t"><span class="tnb-dot opm"></span><b>${t.opmerking}</b> opmerking${t.opmerking>1?'en':''}</span>`);
    if (t.aandacht)  tellers.push(`<span class="tnb-t"><span class="tnb-dot mrk"></span><b>${t.aandacht}</b> markering${t.aandacht>1?'en':''}</span>`);
    if (t.filmpje)   tellers.push(`<span class="tnb-t"><span class="tnb-dot film"></span><b>${t.filmpje}</b> filmpje${t.filmpje>1?'s':''}</span>`);
    // AI-samenvatting alleen aanbieden bij 2+ opmerkingen (anders geen rode draad).
    const aantalOpm = t.opmerking;
    const aiBlok = aantalOpm >= 2
      ? `<div class="tnb-ai" data-blok="${esc(bid)}">
           <button class="tnb-ai-knop" data-blok="${esc(bid)}">✦ Vat samen wat coaches hier schrijven</button>
         </div>`
      : '';
    return `
      <div class="tnb-hotspot">
        <div class="tnb-hs-fase">${esc(info.oefTitel)}</div>
        <div class="tnb-hs-citaat">"${esc(String(info.tekst).slice(0,120))}"</div>
        <div class="tnb-hs-tellers">${tellers.join('')}</div>
        ${aiBlok}
      </div>`;
  }).join('');
}

function volledigHtml(oefeningen, notities, bidx){
  const perBlok = {};
  notities.forEach(n => { (perBlok[n.blokId] ||= []).push(n); });

  return (oefeningen || []).map((oef, oIdx) => {
    let blokIdx = 0;
    const blokkenHtml = (oef.blokken || []).map(blok => {
      let stukken = '';
      const maakRegel = (tekst, bid) => {
        const lijst = perBlok[bid] || [];
        const teller = lijst.length
          ? `<span class="tnb-regel-teller">${lijst.length}</span>` : '';
        let notitiesHtml = '';
        if (lijst.length){
          notitiesHtml = `<div class="tnb-groeplabel">notities bij deze regel</div>` +
            lijst.map(n => {
              const cls = n.type === 'aandacht' ? 'mrk' : (n.type === 'filmpje' ? 'film' : 'opm');
              const body = n.type === 'filmpje'
                ? `<div class="tnb-film-chip">▶ ${esc(n.youtubeUrl||'')}</div>`
                : (n.type === 'aandacht' ? `<div class="tnb-note-body"><i>Gemarkeerd als aandachtspunt</i></div>` : `<div class="tnb-note-body">${esc(n.tekst||'')}</div>`);
              return `
                <div class="tnb-note ${cls}">
                  <div class="tnb-note-rij">
                    <span class="tnb-note-type ${cls}">${TYPE_LBL[n.type]||n.type}</span>
                    <span class="tnb-note-auteur">${esc(n.auteurNaam||'Coach')}</span>
                  </div>${body}
                </div>`;
            }).join('');
        }
        return `<div class="tnb-regel ${lijst.length?'heeft':''}">${esc(tekst)}${teller}</div>${notitiesHtml}`;
      };

      if (blok.type === 'lijst' && Array.isArray(blok.items)){
        stukken = blok.items.map((it, iIdx) => maakRegel(it, blokId(oIdx, blokIdx, iIdx))).join('');
      } else {
        stukken = maakRegel(blok.tekst || blok.kop || '', blokId(oIdx, blokIdx));
      }
      blokIdx++;
      return (blok.kop ? `<div class="tnb-blokkop">${esc(blok.kop)}</div>` : '') + stukken;
    }).join('');

    return `
      <div class="tnb-oef">
        <div class="tnb-oef-kop"><span class="tnb-oef-nr">${oIdx+1}</span><h2>${esc(oef.titel || 'Oefening '+(oIdx+1))}</h2></div>
        ${blokkenHtml}
      </div>`;
  }).join('');
}

/* Simpele hash over de opmerkingteksten, om te bepalen of een gecachete
   samenvatting nog actueel is (regenereren zodra er nieuwe opmerkingen zijn). */
function bronHash(teksten){
  const s = teksten.join('\u0001');
  let h = 0;
  for (let i = 0; i < s.length; i++){ h = (h * 31 + s.charCodeAt(i)) | 0; }
  return String(h);
}

/* Bindt de "Vat samen"-knoppen. Per hotspot: eerst kijken of er een verse
   cache-samenvatting is (hotspotSamenvattingen/{blokId}); anders de Cloud
   Function aanroepen met UITSLUITEND de anonieme opmerkingteksten. */
function bindAiKnoppen(stage, trainingId, notities, bidx){
  stage.querySelectorAll('.tnb-ai-knop').forEach(knop => {
    const bid = knop.dataset.blok;
    const opmTeksten = notities
      .filter(n => n.blokId === bid && n.type === 'opmerking' && n.tekst)
      .map(n => n.tekst);
    const hash = bronHash(opmTeksten);
    const houder = knop.closest('.tnb-ai');

    const toon = (tekst, gecachet) => {
      houder.innerHTML = `
        <div class="tnb-ai-kaart">
          <div class="tnb-ai-kop"><span class="tnb-ai-badge">✦ AI-samenvatting</span><span class="tnb-ai-anoniem">anoniem${gecachet ? '' : ' · zojuist'}</span></div>
          <div class="tnb-ai-tekst">${esc(tekst)}</div>
        </div>`;
    };

    knop.onclick = async () => {
      knop.disabled = true;
      knop.textContent = '✦ Samenvatten…';
      const cacheRef = doc(db, 'trainingen', trainingId, 'hotspotSamenvattingen', bid.replace(/[^A-Za-z0-9_-]/g, '_'));
      // 1) cache checken
      try {
        const snap = await getDoc(cacheRef);
        if (snap.exists() && snap.data().bronHash === hash && snap.data().samenvatting){
          toon(snap.data().samenvatting, true);
          return;
        }
      } catch(e){ /* cache mag falen */ }
      // 2) Cloud Function
      try {
        const info = bidx[bid] || { tekst:'' };
        const fn = httpsCallable(functions, 'samenvatHotspot');
        const res = await fn({ regelTekst: String(info.tekst || '').slice(0,500), opmerkingen: opmTeksten });
        const tekst = res?.data?.samenvatting || '';
        if (!tekst){ houder.innerHTML = `<div class="tnb-ai-leeg">Geen samenvatting beschikbaar.</div>`; return; }
        toon(tekst, false);
        // 3) cachen
        try { await setDoc(cacheRef, { samenvatting: tekst, bronHash: hash, gegenereerdOp: serverTimestamp() }); } catch(e){}
      } catch(e){
        houder.innerHTML = `<div class="tnb-ai-leeg">Samenvatten lukte niet. Probeer later opnieuw.</div>`;
      }
    };
  });
}

/* openBeheerNotities({ trainingId, titel, oefeningen })
   Aangeroepen vanuit de oefenstof-lijst (club.js) via een notitie-knop. */
export async function openBeheerNotities({ trainingId, titel, oefeningen }){
  if (!isBeheerder()) return;
  const el = bouwOverlay();
  el.querySelector('.tnb-titel').textContent = titel || 'Training';
  const stage = el.querySelector('.tnb-stage');
  stage.innerHTML = `<div class="tnb-laden">Notities laden…</div>`;
  el.classList.add('open');
  bewaakTerug();

  let notities = [];
  try { notities = await haalNotities(trainingId); }
  catch(e){ stage.innerHTML = `<div class="tnb-leeg">Kon notities niet laden.</div>`; return; }

  const bidx = blokIndex(oefeningen);
  const totaal = notities.length;
  const coaches = new Set(notities.map(n => n.auteurUid)).size;
  const tOpm = notities.filter(n=>n.type==='opmerking').length;
  const tMrk = notities.filter(n=>n.type==='aandacht').length;
  const tFilm = notities.filter(n=>n.type==='filmpje').length;

  const kop = `
    <div class="tnb-samenvatting">
      <div class="tnb-stat"><div class="tnb-getal opm">${tOpm}</div><div class="tnb-lbl">Opmerkingen</div></div>
      <div class="tnb-stat"><div class="tnb-getal mrk">${tMrk}</div><div class="tnb-lbl">Aandacht</div></div>
      <div class="tnb-stat"><div class="tnb-getal film">${tFilm}</div><div class="tnb-lbl">Filmpjes</div></div>
    </div>
    <div class="tnb-coachteller">${coaches ? `<b>${coaches} coach${coaches>1?'es':''}</b> maakten notities bij deze training` : 'Nog geen notities'}</div>`;

  el._toon = (welke) => {
    stage.innerHTML = kop + (welke === 'hotspots'
      ? `<div class="tnb-sectiekop">Waar coaches op reageren</div>` + hotspotsHtml(notities, bidx)
      : volledigHtml(oefeningen, notities, bidx));
    stage.scrollTop = 0;
    if (welke === 'hotspots') bindAiKnoppen(stage, trainingId, notities, bidx);
  };
  el._toon('hotspots');
}
