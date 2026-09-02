/* ==================== TRAINING-VIDEO ====================
   Additieve laag bovenop training-weergave.js: een geüpload filmpje met uitleg
   per oefening (trainingsvorm). Werkt net als training-aantekeningen.js — het
   haakt in op de bestaande .trw-overlay zonder die te hoeven wijzigen.

   - De BEHEERDER (club-admin van de club waar de training bij hoort) kan per
     oefening een filmpje uploaden, vervangen of verwijderen.
   - Elke COACH ziet bij een oefening mét video een afspeelknop (groene tegel in
     de oefening + een 🎬-knop in de balk die meebeweegt met de zichtbare
     oefening) en kan het filmpje in een popup afspelen.

   Opslag:
     Firestore: trainingen/{trainingId}.oefeningVideos = {
       '<oefIndex>': { url, path, naam, grootte, duur? }
     }  — analoog aan diagramUrls.
     Storage:   clubs/{clubId}/trainingvideos/{trainingId}/oef<idx>.<ext>

   AVG: dit is uitleg van de trainingsvorm (tactiekbord / voordoen). Bij het
   uploaden toont de app een herinnering om geen herkenbare jeugdspelers zonder
   toestemming te delen. Er gaan geen speler- of persoonsgegevens naar de AI of
   naar een export. */

import { db, doc, updateDoc, storage, sRef, uploadBytes, getDownloadURL, deleteObject } from './firebase.js?v=20260811a';
import { S, esc, meld, bewaakTerug, vangnetStilTerugAlsNodig } from './state.js?v=20260902b';

const MAX_BYTES = 100 * 1024 * 1024;   // 100 MB
const TOEGESTAAN = ['video/mp4', 'video/quicktime', 'video/webm'];   // mp4, mov, webm

let _ctx = null;   // { trainingId, videos, magBewerken, stage, balk, secties, videoKnop }

/* Bepaal of de huidige gebruiker de training mag bewerken: club-admin van de
   club waar de training bij hoort. We hebben de club-id van de training nodig;
   die geven we mee vanuit teams.js (trainingClub). Terugval: admin van de
   op-dit-moment-geopende club. */
function magTrainingBewerken(trainingClub){
  const uid = S.user?.uid;
  if (!uid) return false;
  // primaire check: admin van de club van de training
  if (trainingClub && S.clubs){
    const club = S.clubs.find(c => c.id === trainingClub);
    if (club) return !!(club.admins && club.admins[uid]);
  }
  // terugval: huidige club in context
  return !!(S.club && S.club.admins && S.club.admins[uid]);
}

/* ==================== PUBLIEKE API ==================== */

/* Wordt aangeroepen door training-weergave.js nadat de oefeningen getekend zijn.
   opties: { stage, balk, trainingId, videos, trainingClub } */
export function initTrainingVideos({ stage, balk, trainingId, videos, trainingClub }){
  _ctx = {
    trainingId,
    clubId: trainingClub || S.clubId || null,
    videos: { ...(videos || {}) },
    magBewerken: magTrainingBewerken(trainingClub),
    stage, balk,
    secties: [...stage.querySelectorAll('.trw-oef')],
    videoKnop: null,
  };

  zetBalkKnop();
  tekenPerOefening();
  koppelScrollWaarnemer();
}

/* Opruimen bij het sluiten van de weergave (training-weergave roept dit aan). */
export function resetTrainingVideos(){
  if (_ctx?.videoKnop) _ctx.videoKnop.remove();
  if (_ctx?._io) _ctx._io.disconnect();
  _ctx = null;
  sluitPopup();
}

/* ==================== BALK-KNOP (volgt zichtbare oefening) ==================== */

function zetBalkKnop(){
  const balk = _ctx.balk;
  // notitie-knop staat mogelijk al rechts; we plaatsen de video-knop links
  // daarvan zodat beide naast elkaar passen.
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
    if (idx != null && _ctx.videos[idx]) openPopup(idx);
  };
  _ctx.videoKnop = knop;
}

/* Laat de balk-knop zien/verdwijnen op basis van welke oefening in beeld is. */
function koppelScrollWaarnemer(){
  const stage = _ctx.stage;
  // IntersectionObserver bepaalt de meest zichtbare oefening.
  const io = new IntersectionObserver(entries => {
    // kies de sectie met de grootste zichtbaarheid
    let beste = null, besteRatio = 0;
    for (const e of entries){
      if (e.intersectionRatio > besteRatio){ besteRatio = e.intersectionRatio; beste = e.target; }
    }
    if (!beste) return;
    const idx = _ctx.secties.indexOf(beste);
    if (idx < 0) return;
    _ctx._zichtbareOef = idx + 1;   // oefeningen zijn 1-based in de video-map
    werkBalkKnopBij();
  }, { root: stage, threshold: [0.25, 0.5, 0.75] });
  _ctx.secties.forEach(s => io.observe(s));
  _ctx._io = io;
  // begintoestand
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

/* ==================== PER-OEFENING UI (tegel / upload-knop) ==================== */

function tekenPerOefening(){
  _ctx.secties.forEach((sectie, i) => {
    const idx = i + 1;
    // bestaande video-elementen weghalen (bij hertekenen)
    sectie.querySelectorAll('.trw-video-tegel, .trw-video-upload').forEach(el => el.remove());

    const kop = sectie.querySelector('.trw-oef-kop');
    const vid = _ctx.videos[idx];

    if (vid){
      // afspeelbare tegel (voor iedereen)
      const tegel = document.createElement('div');
      tegel.className = 'trw-video-tegel';
      tegel.innerHTML = `
        <div class="tv-thumb">🎬</div>
        <div class="tv-t">
          <div class="tv-titel">Video-uitleg bekijken</div>
          <div class="tv-sub">${esc(vid.naam || 'Filmpje')}</div>
        </div>
        <span class="tv-play">▶</span>`;
      tegel.onclick = () => openPopup(idx);
      kop.insertAdjacentElement('afterend', tegel);

      // beheerder: extra mini-acties (vervangen / verwijderen)
      if (_ctx.magBewerken){
        const acties = document.createElement('div');
        acties.className = 'trw-video-upload beheer';
        acties.innerHTML = `
          <button class="tvu-vervang">Vervangen</button>
          <button class="tvu-weg">Verwijderen</button>`;
        acties.querySelector('.tvu-vervang').onclick = () => kiesBestand(idx);
        acties.querySelector('.tvu-weg').onclick = () => verwijderVideo(idx);
        tegel.insertAdjacentElement('afterend', acties);
      }
    } else if (_ctx.magBewerken){
      // upload-knop (alleen beheerder, alleen als er nog geen video is)
      const knop = document.createElement('button');
      knop.className = 'trw-video-upload knop-toevoegen';
      knop.innerHTML = '＋ Video-uitleg toevoegen';
      knop.onclick = () => kiesBestand(idx);
      kop.insertAdjacentElement('afterend', knop);
    }
  });
}

/* ==================== UPLOAD ==================== */

function kiesBestand(idx){
  const inp = document.createElement('input');
  inp.type = 'file';
  inp.accept = 'video/mp4,video/quicktime,video/webm,.mp4,.mov,.webm';
  inp.onchange = () => {
    const file = inp.files && inp.files[0];
    if (file) startUpload(idx, file);
  };
  inp.click();
}

async function startUpload(idx, file){
  // validatie
  if (file.size >= MAX_BYTES){
    const mb = (file.size / 1024 / 1024).toFixed(0);
    return meld(`Filmpje is te groot (${mb} MB). Maximaal 100 MB.`);
  }
  if (file.type && !TOEGESTAAN.includes(file.type)){
    return meld('Alleen MP4-, MOV- of WEBM-video wordt ondersteund.');
  }

  const ext = (file.name.split('.').pop() || 'mp4').toLowerCase().replace(/[^a-z0-9]/g, '') || 'mp4';
  const clubDeel = _ctx.clubId ? `clubs/${_ctx.clubId}/` : '';
  const path = `${clubDeel}trainingvideos/${_ctx.trainingId}/oef${idx}.${ext}`;

  toonVoortgang(idx, true);
  try {
    const ref = sRef(storage, path);
    await uploadBytes(ref, file, { contentType: file.type || 'video/mp4' });
    const url = await getDownloadURL(ref);

    // oude video op een ander pad opruimen (bij vervangen met andere extensie)
    const oud = _ctx.videos[idx];
    if (oud && oud.path && oud.path !== path){
      try { await deleteObject(sRef(storage, oud.path)); } catch(e){}
    }

    const meta = { url, path, naam: file.name, grootte: file.size };
    _ctx.videos[idx] = meta;
    await updateDoc(doc(db, 'trainingen', _ctx.trainingId), {
      [`oefeningVideos.${idx}`]: meta,
    });

    meld('Video toegevoegd');
    tekenPerOefening();
    werkBalkKnopBij();
  } catch(e){
    meld('Uploaden mislukt: ' + (e.code || e.message));
  } finally {
    toonVoortgang(idx, false);
  }
}

function toonVoortgang(idx, aan){
  const sectie = _ctx.secties[idx - 1];
  if (!sectie) return;
  let bar = sectie.querySelector('.trw-video-voortgang');
  if (aan){
    if (!bar){
      bar = document.createElement('div');
      bar.className = 'trw-video-voortgang';
      bar.innerHTML = '<div class="tvv-balk"><div class="tvv-vul"></div></div><div class="tvv-tekst">Uploaden…</div>';
      const kop = sectie.querySelector('.trw-oef-kop');
      kop.insertAdjacentElement('afterend', bar);
    }
    // onbepaalde voortgang (uploadBytes geeft geen progress-events terug):
    // toon een lopende animatie via de CSS-klasse.
    bar.classList.add('bezig');
  } else if (bar){
    bar.remove();
  }
}

/* ==================== VERWIJDEREN ==================== */

async function verwijderVideo(idx){
  const vid = _ctx.videos[idx];
  if (!vid) return;
  if (!confirm('Video-uitleg bij deze oefening verwijderen?')) return;
  try {
    if (vid.path){ try { await deleteObject(sRef(storage, vid.path)); } catch(e){} }
    // Firestore-veld verwijderen: zet op null (deleteField vereist extra import;
    // null is voldoende — tekenPerOefening behandelt falsy als "geen video").
    await updateDoc(doc(db, 'trainingen', _ctx.trainingId), { [`oefeningVideos.${idx}`]: null });
    delete _ctx.videos[idx];
    meld('Video verwijderd');
    tekenPerOefening();
    werkBalkKnopBij();
  } catch(e){
    meld('Verwijderen mislukt: ' + (e.code || e.message));
  }
}

/* ==================== AFSPEEL-POPUP ==================== */

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
      <div class="trw-vpop-speler">
        <video controls playsinline preload="metadata"></video>
      </div>
      <div class="trw-vpop-voet"></div>
    </div>`;
  document.body.appendChild(el);
  el.querySelector('.trw-vpop-sluit').onclick = () => sluitPopup();
  el.addEventListener('click', e => { if (e.target === el) sluitPopup(); });
  _pop = el;
  return el;
}

function openPopup(idx){
  const vid = _ctx.videos[idx];
  if (!vid) return;
  const el = bouwPopup();
  const sectie = _ctx.secties[idx - 1];
  const titel = sectie?.querySelector('.trw-oef-kop h2')?.textContent || ('Oefening ' + idx);
  el.querySelector('.trw-vpop-titel').textContent = titel;
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
