/* ==================== TRAINING-VIDEO ====================
   Video-uitleg per oefening (trainingsvorm).

   Twee kanten:
   1. AFSPELEN (coach-facing, in training-weergave.js): een 🎬-knop in de balk die
      meebeweegt met de zichtbare oefening + een afspeeltegel per oefening met
      video. Géén upload/beheer hier — coaches kunnen alleen kijken.
   2. BEHEER (admin-only, in training-bewerken.js → clubbeheer): per oefening een
      upload-/vervang-/verwijder-regel. Alleen daar, waar de beheerder de
      oefenstof beheert. Trainers komen daar niet.

   Opslag:
     Firestore: trainingen/{trainingId}.oefeningVideos = {
       '<oefIndex>': { url, path, naam, grootte }
     }
     Storage:   clubs/{clubId}/trainingvideos/{trainingId}/oef<idx>.<ext>

   AVG: dit is uitleg van de trainingsvorm (tactiekbord / voordoen). Er gaan geen
   speler- of persoonsgegevens naar de AI of naar een export. */

import { db, doc, updateDoc, storage, sRef, uploadBytes, getDownloadURL, deleteObject } from './firebase.js?v=20260811a';
import { esc, meld, bewaakTerug, vangnetStilTerugAlsNodig } from './state.js?v=20260828d';

const MAX_BYTES = 100 * 1024 * 1024;   // 100 MB (gelijk aan de Storage-rule)
const TOEGESTAAN = ['video/mp4', 'video/quicktime', 'video/webm'];

/* ==================== GEDEELDE STORAGE-LOGICA ==================== */

/* Upload één oefening-video. Retourneert de nieuwe metadata of gooit een fout.
   Ruimt een eventuele oude video op een ander pad op. */
export async function uploadOefVideo({ trainingId, clubId, idx, file, huidige }){
  if (file.size >= MAX_BYTES){
    const mb = (file.size / 1024 / 1024).toFixed(0);
    throw new Error(`Filmpje is te groot (${mb} MB). Maximaal 100 MB.`);
  }
  if (file.type && !TOEGESTAAN.includes(file.type)){
    throw new Error('Alleen MP4-, MOV- of WEBM-video wordt ondersteund.');
  }
  const ext = (file.name.split('.').pop() || 'mp4').toLowerCase().replace(/[^a-z0-9]/g, '') || 'mp4';
  const clubDeel = clubId ? `clubs/${clubId}/` : '';
  const path = `${clubDeel}trainingvideos/${trainingId}/oef${idx}.${ext}`;

  const ref = sRef(storage, path);
  await uploadBytes(ref, file, { contentType: file.type || 'video/mp4' });
  const url = await getDownloadURL(ref);

  if (huidige && huidige.path && huidige.path !== path){
    try { await deleteObject(sRef(storage, huidige.path)); } catch(e){}
  }

  const meta = { url, path, naam: file.name, grootte: file.size };
  await updateDoc(doc(db, 'trainingen', trainingId), { [`oefeningVideos.${idx}`]: meta });
  return meta;
}

/* Verwijder één oefening-video (Storage + Firestore-veld op null). */
export async function verwijderOefVideo({ trainingId, idx, huidige }){
  if (huidige && huidige.path){ try { await deleteObject(sRef(storage, huidige.path)); } catch(e){} }
  await updateDoc(doc(db, 'trainingen', trainingId), { [`oefeningVideos.${idx}`]: null });
}

function kiesBestand(cb){
  const inp = document.createElement('input');
  inp.type = 'file';
  inp.accept = 'video/mp4,video/quicktime,video/webm,.mp4,.mov,.webm';
  inp.onchange = () => { const f = inp.files && inp.files[0]; if (f) cb(f); };
  inp.click();
}

/* ==================== BEHEER-REGEL (voor training-bewerken.js) ====================
   Bouwt een zelfstandig DOM-element voor één oefening met upload/vervangen/
   verwijderen. onWijzig(nieuweVideoOfNull) wordt aangeroepen na een geslaagde
   actie zodat de aanroeper zijn lokale kopie kan bijwerken.
   opties: { trainingId, clubId, idx, video } */
export function maakVideoBeheerRij({ trainingId, clubId, idx, video }, onWijzig){
  const wrap = document.createElement('div');
  wrap.className = 'trb-video';
  let huidige = video || null;

  function teken(){
    if (huidige){
      wrap.innerHTML = `
        <div class="trb-video-tegel" data-actie="speel">
          <div class="tv-thumb">🎬</div>
          <div class="tv-t"><div class="tv-titel">Video-uitleg</div>
            <div class="tv-sub">${esc(huidige.naam || 'Filmpje')}</div></div>
          <span class="tv-play">▶</span>
        </div>
        <div class="trb-video-acties">
          <button data-actie="vervang">Vervangen</button>
          <button data-actie="weg" class="weg">Verwijderen</button>
        </div>`;
      wrap.querySelector('[data-actie="speel"]').onclick = () => speelPopup(huidige, 'Oefening ' + idx);
      wrap.querySelector('[data-actie="vervang"]').onclick = doeUpload;
      wrap.querySelector('[data-actie="weg"]').onclick = doeVerwijder;
    } else {
      wrap.innerHTML = `<button class="trb-video-toevoegen" data-actie="add">＋ Video-uitleg toevoegen</button>`;
      wrap.querySelector('[data-actie="add"]').onclick = doeUpload;
    }
  }

  function toonBezig(aan){
    if (aan){
      wrap.innerHTML = `<div class="trb-video-voortgang bezig"><div class="tvv-balk"><div class="tvv-vul"></div></div><div class="tvv-tekst">Uploaden…</div></div>`;
    } else {
      teken();
    }
  }

  function doeUpload(){
    kiesBestand(async (file) => {
      toonBezig(true);
      try {
        const meta = await uploadOefVideo({ trainingId, clubId, idx, file, huidige });
        huidige = meta;
        meld('Video toegevoegd');
        if (onWijzig) onWijzig(meta);
      } catch(e){
        meld(e.message || ('Uploaden mislukt: ' + (e.code || '')));
      } finally {
        toonBezig(false);
      }
    });
  }

  function doeVerwijder(){
    if (!confirm('Video-uitleg bij deze oefening verwijderen?')) return;
    (async () => {
      try {
        await verwijderOefVideo({ trainingId, idx, huidige });
        huidige = null;
        meld('Video verwijderd');
        if (onWijzig) onWijzig(null);
      } catch(e){
        meld('Verwijderen mislukt: ' + (e.code || e.message));
      }
      teken();
    })();
  }

  teken();
  return wrap;
}

/* ==================== AFSPELEN (coach-facing, training-weergave.js) ==================== */

let _ctx = null;   // { trainingId, videos, stage, balk, secties, videoKnop }

export function initTrainingVideos({ stage, balk, trainingId, videos }){
  _ctx = {
    trainingId,
    videos: { ...(videos || {}) },
    stage, balk,
    secties: [...stage.querySelectorAll('.trw-oef')],
    videoKnop: null,
  };
  zetBalkKnop();
  tekenPerOefening();
  koppelScrollWaarnemer();
}

export function resetTrainingVideos(){
  if (_ctx?.videoKnop) _ctx.videoKnop.remove();
  if (_ctx?._io) _ctx._io.disconnect();
  _ctx = null;
  sluitPopup();
}

function zetBalkKnop(){
  const balk = _ctx.balk;
  let knop = balk.querySelector('.trw-video-knop');
  if (!knop){
    knop = document.createElement('button');
    knop.className = 'trw-video-knop';
    knop.setAttribute('aria-label', 'Video-uitleg');
    knop.innerHTML = '🎬<span class="stip"></span>';
    const nb = balk.querySelector('.trw-notitie-knop');
    if (nb) balk.insertBefore(knop, nb); else balk.appendChild(knop);
  }
  knop.onclick = () => {
    const idx = _ctx._zichtbareOef;
    if (idx != null && _ctx.videos[idx]) speelPopup(_ctx.videos[idx], titelVanOef(idx));
  };
  _ctx.videoKnop = knop;
}

function koppelScrollWaarnemer(){
  const stage = _ctx.stage;
  const io = new IntersectionObserver(entries => {
    let beste = null, besteRatio = 0;
    for (const e of entries){
      if (e.intersectionRatio > besteRatio){ besteRatio = e.intersectionRatio; beste = e.target; }
    }
    if (!beste) return;
    const idx = _ctx.secties.indexOf(beste);
    if (idx < 0) return;
    _ctx._zichtbareOef = idx + 1;
    werkBalkKnopBij();
  }, { root: stage, threshold: [0.25, 0.5, 0.75] });
  _ctx.secties.forEach(s => io.observe(s));
  _ctx._io = io;
  _ctx._zichtbareOef = 1;
  werkBalkKnopBij();
}

function werkBalkKnopBij(){
  const knop = _ctx.videoKnop;
  if (!knop) return;
  const idx = _ctx._zichtbareOef;
  const heeft = idx != null && !!_ctx.videos[idx];
  knop.classList.toggle('zichtbaar', heeft);
  knop.classList.toggle('aan', heeft);
}

function titelVanOef(idx){
  const sectie = _ctx.secties[idx - 1];
  return sectie?.querySelector('.trw-oef-kop h2')?.textContent || ('Oefening ' + idx);
}

/* Alleen de afspeeltegel bij oefeningen mét video (geen upload/beheer). */
function tekenPerOefening(){
  _ctx.secties.forEach((sectie, i) => {
    const idx = i + 1;
    sectie.querySelectorAll('.trw-video-tegel').forEach(el => el.remove());
    const vid = _ctx.videos[idx];
    if (!vid) return;
    const kop = sectie.querySelector('.trw-oef-kop');
    const tegel = document.createElement('div');
    tegel.className = 'trw-video-tegel';
    tegel.innerHTML = `
      <div class="tv-thumb">🎬</div>
      <div class="tv-t"><div class="tv-titel">Video-uitleg bekijken</div>
        <div class="tv-sub">${esc(vid.naam || 'Filmpje')}</div></div>
      <span class="tv-play">▶</span>`;
    tegel.onclick = () => speelPopup(vid, titelVanOef(idx));
    kop.insertAdjacentElement('afterend', tegel);
  });
}

/* ==================== AFSPEEL-POPUP (gedeeld) ==================== */

let _pop = null;

function bouwPopup(){
  if (_pop) return _pop;
  const el = document.createElement('div');
  el.className = 'trw-vpop-overlay';
  el.innerHTML = `
    <div class="trw-vpop">
      <div class="trw-vpop-kop">
        <span class="trw-vpop-badge">🎬 UITLEG</span>
        <div class="trw-vpop-titel"></div>
        <button class="trw-vpop-sluit" aria-label="Sluiten">✕</button>
      </div>
      <div class="trw-vpop-speler"><video controls playsinline preload="metadata"></video></div>
      <div class="trw-vpop-voet"></div>
    </div>`;
  document.body.appendChild(el);
  el.querySelector('.trw-vpop-sluit').onclick = () => sluitPopup();
  el.addEventListener('click', e => { if (e.target === el) sluitPopup(); });
  _pop = el;
  return el;
}

function speelPopup(vid, titel){
  if (!vid) return;
  const el = bouwPopup();
  el.querySelector('.trw-vpop-titel').textContent = titel || '';
  el.querySelector('.trw-vpop-voet').textContent = vid.naam || '';
  const video = el.querySelector('video');
  video.src = vid.url;
  el.classList.add('open');
  bewaakTerug();
  video.play().catch(() => {});
}

export function sluitPopup(){
  if (!_pop) return;
  const wasOpen = _pop.classList.contains('open');
  const video = _pop.querySelector('video');
  try { video.pause(); video.removeAttribute('src'); video.load(); } catch(e){}
  _pop.classList.remove('open');
  vangnetStilTerugAlsNodig(wasOpen);
}
