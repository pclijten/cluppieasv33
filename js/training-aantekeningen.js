/* ==================== TRAINING-AANTEKENINGEN ====================
   Persoonlijke aantekeningen-laag die een coach over een geüploade training legt,
   zonder het origineel aan te raken. Drie soorten notities:
     - aandacht  : een blok-item markeren als aandachtspunt (amber highlight)
     - opmerking : vrije tekst bij een blok-item
     - filmpje   : een YouTube-link bij een blok-item (inline afspeelkaartje)

   Zichtbaarheid: elke notitie is zichtbaar voor ALLE coaches van hetzelfde team
   (geen privé-niveau). Opslag in een subcollectie onder het team-document, zodat
   Firestore-rules op teamniveau kunnen filteren. De beheerder ziet alles apart.

   Koppeling aan de tekst gebeurt via een STABIELE regel-id (blokId) die bij het
   renderen wordt toegekend op basis van oefening-index + blok-index + item-index.
   Zolang de AI-structuur van een training niet verandert, blijven die id's gelijk
   en blijven notities dus op hun plek. (Diff-based id-toekenning bij het bewerken
   van het origineel is een aparte, latere stap.)

   Deze module is ADDITIEF: trainingen zonder notities werken exact als voorheen.
   De notitie-knop verschijnt in de balk van training-weergave.js; als de laag uit
   staat, wordt er niets aan de weergave veranderd. */

import {
  db, collection, doc, addDoc, deleteDoc, query, where, getDocs, serverTimestamp
} from './firebase.js?v=20260811a';
import { S, esc, meld } from './state.js?v=20260828d';

/* Interne toestand voor de op dit moment geopende training. */
let _actief = null;   // { teamId, trainingId, stage, laagAan, notities:[], actiefItem, veldRefs }

/* Bouwt een stabiele blok-id uit posities in de AI-structuur.
   Formaat: "o{oef}-b{blok}-i{item}" of "o{oef}-b{blok}" voor tekstblokken. */
export function blokId(oefIdx, blokIdx, itemIdx){
  let id = `o${oefIdx}-b${blokIdx}`;
  if (itemIdx != null) id += `-i${itemIdx}`;
  return id;
}

/* ---- Firestore ----
   Pad: teams/{teamId}/trainingAantekeningen
   Elk doc: { trainingId, blokId, type, tekst, youtubeUrl, auteurUid, auteurNaam, aangemaaktOp }
   We filteren client-side op trainingId zodat één simpele query per team volstaat. */
function colRef(teamId){
  return collection(db, 'teams', teamId, 'trainingAantekeningen');
}

async function laadNotities(teamId, trainingId){
  const q = query(colRef(teamId), where('trainingId', '==', trainingId));
  const snap = await getDocs(q);
  const uit = [];
  snap.forEach(d => uit.push({ id: d.id, ...d.data() }));
  return uit;
}

async function bewaarNotitie(teamId, data){
  const ref = await addDoc(colRef(teamId), {
    ...data,
    auteurUid: S.user?.uid || null,
    auteurNaam: S.gebruikersnaam || S.user?.displayName || S.user?.email || 'Coach',
    aangemaaktOp: serverTimestamp(),
  });
  return ref.id;
}

async function verwijderNotitie(teamId, notitieId){
  await deleteDoc(doc(db, 'teams', teamId, 'trainingAantekeningen', notitieId));
}

/* ---- Publieke init: aangeroepen door training-weergave.js na het renderen ----
   Params:
     stage      : het .trw-stage element met de gerenderde oefeningen
     balk       : de .trw-balk waar de notitie-knop in komt
     trainingId : id van de training (voor koppeling van notities)
   Bestaande blok-items/tekstblokken krijgen hier hun data-blok-id en worden
   klaargezet om aan te tikken zodra de laag aan gaat. */
export async function initAantekeningen({ stage, balk, trainingId }){
  const teamId = S.teamId;
  if (!teamId || !trainingId || !stage || !balk) return;

  // Markeer elk annoteerbaar element met een stabiele blok-id.
  const oefeningen = [...stage.querySelectorAll('.trw-oef')];
  oefeningen.forEach((sectie, oIdx) => {
    const hlBlokken = [...sectie.querySelectorAll('.hl > *')];
    let blokIdx = 0;
    hlBlokken.forEach(node => {
      if (node.tagName === 'UL' || node.tagName === 'OL'){
        [...node.children].forEach((li, iIdx) => {
          li.dataset.blok = blokId(oIdx, blokIdx, iIdx);
          li.classList.add('trw-ann-item');
        });
      } else if (node.tagName === 'P'){
        node.dataset.blok = blokId(oIdx, blokIdx);
        node.classList.add('trw-ann-item');
      }
      blokIdx++;
    });
  });

  const notities = await laadNotities(teamId, trainingId);

  _actief = { teamId, trainingId, stage, laagAan: false, notities, actiefItem: null };

  // Knop in de balk
  const knop = document.createElement('button');
  knop.className = 'trw-notitie-knop';
  knop.setAttribute('aria-label', 'Notities');
  knop.innerHTML = `✎<span class="trw-nb-badge" hidden></span>`;
  knop.onclick = () => wisselLaag(knop);
  balk.appendChild(knop);
  _actief.knop = knop;

  // Reeds bestaande notities meteen tonen (markeringen + blokken), ook met laag uit?
  // Nee: conform ontwerp tonen we de laag pas als de coach 'm aanzet. Wel het
  // badge-getal vast bijwerken zodat de coach ziet dát er notities zijn.
  werkBadgeBij();
}

function werkBadgeBij(){
  if (!_actief?.knop) return;
  const n = _actief.notities.length;
  const b = _actief.knop.querySelector('.trw-nb-badge');
  if (n > 0){ b.textContent = n; b.hidden = false; }
  else b.hidden = true;
}

function wisselLaag(knop){
  if (!_actief) return;
  _actief.laagAan = !_actief.laagAan;
  knop.classList.toggle('aan', _actief.laagAan);
  _actief.stage.classList.toggle('trw-laag-aan', _actief.laagAan);
  if (_actief.laagAan){
    toonNotities();
    meld('Notities aan — tik op een regel');
  } else {
    verbergNotities();
    sluitMenu();
  }
}

/* Rendert alle opgeslagen notities in de weergave (markeringen + blokken + pins). */
function toonNotities(){
  const { stage, notities } = _actief;
  let pinNr = 0;
  // groepeer per blokId
  const perBlok = {};
  notities.forEach(n => { (perBlok[n.blokId] ||= []).push(n); });

  Object.entries(perBlok).forEach(([bid, lijst]) => {
    const item = stage.querySelector(`[data-blok="${CSS.escape(bid)}"]`);
    if (!item) return;
    lijst.forEach(n => {
      if (n.type === 'aandacht'){
        item.classList.add('trw-gemarkeerd');
      } else if (n.type === 'opmerking'){
        pinNr++;
        plaatsPin(item, n, pinNr);
      } else if (n.type === 'filmpje'){
        plaatsFilmpje(item, n);
      }
    });
  });
}

function verbergNotities(){
  const { stage } = _actief;
  stage.querySelectorAll('.trw-gemarkeerd').forEach(e => e.classList.remove('trw-gemarkeerd'));
  stage.querySelectorAll('.trw-pin, .trw-notitieblok, .trw-filmblok, .trw-regelmenu').forEach(e => e.remove());
}

function plaatsPin(item, notitie, nr){
  const pin = document.createElement('span');
  pin.className = 'trw-pin';
  pin.textContent = nr;
  const eigen = notitie.auteurUid === S.user?.uid;
  if (!eigen) pin.classList.add('andermans');
  pin.onclick = (e) => { e.stopPropagation(); const b = document.getElementById('trwblk-'+notitie.id); if (b){ b.scrollIntoView({behavior:'smooth',block:'center'}); flits(b); } };
  item.appendChild(pin);

  const blok = document.createElement('div');
  blok.className = 'trw-notitieblok' + (eigen ? '' : ' andermans');
  blok.id = 'trwblk-' + notitie.id;
  const wisKnop = eigen
    ? `<button class="trw-wis" data-id="${notitie.id}" aria-label="Verwijderen">🗑</button>` : '';
  blok.innerHTML = `
    <div class="trw-nb-rij">
      <span class="trw-nb-pinref">${nr}</span>
      <span class="trw-nb-lbl">Opmerking</span>
      <span class="trw-nb-auteur">— ${esc(notitie.auteurNaam || 'Coach')}</span>
      <button class="trw-naar-regel" data-blok="${esc(notitie.blokId)}" aria-label="Naar regel">↑</button>
      ${wisKnop}
    </div>
    <div class="trw-nb-body">${esc(notitie.tekst || '')}</div>`;
  // plaats na de dichtstbijzijnde <li> of <p>
  const anker = item.closest('li') ? item : item;
  anker.after(blok);

  blok.querySelector('.trw-naar-regel').onclick = (e) => {
    e.stopPropagation();
    const t = _actief.stage.querySelector(`[data-blok="${CSS.escape(notitie.blokId)}"]`);
    if (t){ t.scrollIntoView({behavior:'smooth',block:'center'}); flits(t); }
  };
  const wb = blok.querySelector('.trw-wis');
  if (wb) wb.onclick = (e) => { e.stopPropagation(); wisNotitie(notitie.id); };
}

function plaatsFilmpje(item, notitie){
  const eigen = notitie.auteurUid === S.user?.uid;
  const blok = document.createElement('div');
  blok.className = 'trw-filmblok';
  const wisKnop = eigen
    ? `<button class="trw-wis" data-id="${notitie.id}" aria-label="Verwijderen">🗑</button>` : '';
  const vid = youtubeId(notitie.youtubeUrl);
  const thumb = vid ? `https://img.youtube.com/vi/${vid}/mqdefault.jpg` : '';
  blok.innerHTML = `
    <a class="trw-film-thumb" href="${esc(notitie.youtubeUrl)}" target="_blank" rel="noopener" style="${thumb ? `background-image:url('${thumb}')` : ''}">
      <span class="trw-film-play">▶</span>
    </a>
    <div class="trw-film-txt">
      <strong>Filmpje</strong>
      <span class="trw-nb-auteur">— ${esc(notitie.auteurNaam || 'Coach')}</span>
      ${wisKnop}
    </div>`;
  item.after(blok);
  const wb = blok.querySelector('.trw-wis');
  if (wb) wb.onclick = (e) => { e.stopPropagation(); wisNotitie(notitie.id); };
}

/* ---- Tik-op-item → menu ---- */
export function bindItemKlik(stage){
  stage.addEventListener('click', (e) => {
    if (!_actief?.laagAan) return;
    const item = e.target.closest('.trw-ann-item');
    // klik buiten een item (maar binnen stage) sluit het menu
    if (!item){ sluitMenu(); return; }
    // klik op pin/knop niet als item-klik behandelen
    if (e.target.closest('.trw-pin, .trw-wis, .trw-naar-regel, a')) return;
    e.stopPropagation();
    if (_actief.actiefItem === item){ sluitMenu(); return; }
    sluitMenu();
    openMenu(item);
  });
}

function openMenu(item){
  _actief.actiefItem = item;
  item.classList.add('trw-item-actief');
  const menu = document.createElement('div');
  menu.className = 'trw-regelmenu';
  const isG = item.classList.contains('trw-gemarkeerd');
  menu.innerHTML = `
    <button data-a="markeer"><span class="trw-rm-ico mrk">▮</span>${isG ? 'Weghalen' : 'Aandacht'}</button>
    <button data-a="opmerking"><span class="trw-rm-ico">💬</span>Opmerking</button>
    <button data-a="filmpje"><span class="trw-rm-ico">▶</span>Filmpje</button>`;
  // plaats menu na de <li> of <p>
  const na = item.closest('li') || item;
  na.after(menu);
  menu.querySelectorAll('button').forEach(b => {
    b.onclick = (e) => { e.stopPropagation(); menuActie(b.dataset.a, item); };
  });
}

function sluitMenu(){
  if (!_actief) return;
  _actief.stage.querySelectorAll('.trw-regelmenu').forEach(m => m.remove());
  _actief.stage.querySelectorAll('.trw-item-actief').forEach(i => i.classList.remove('trw-item-actief'));
  _actief.actiefItem = null;
}

async function menuActie(actie, item){
  const bid = item.dataset.blok;
  if (actie === 'markeer'){
    const isG = item.classList.contains('trw-gemarkeerd');
    if (isG){
      // verwijder de aandacht-notitie van deze gebruiker bij dit blok
      const n = _actief.notities.find(x => x.blokId === bid && x.type === 'aandacht' && x.auteurUid === S.user?.uid);
      item.classList.remove('trw-gemarkeerd');
      if (n){ await verwijderNotitie(_actief.teamId, n.id); _actief.notities = _actief.notities.filter(x => x.id !== n.id); }
      meld('Markering weg');
    } else {
      item.classList.add('trw-gemarkeerd');
      const id = await bewaarNotitie(_actief.teamId, { trainingId: _actief.trainingId, blokId: bid, type: 'aandacht', tekst: '' });
      _actief.notities.push({ id, blokId: bid, type: 'aandacht', tekst: '', auteurUid: S.user?.uid, auteurNaam: 'Jij' });
      meld('Gemarkeerd als aandachtspunt');
    }
    werkBadgeBij();
    sluitMenu();
  } else if (actie === 'opmerking'){
    sluitMenu();
    openInvoer('opmerking', item);
  } else if (actie === 'filmpje'){
    sluitMenu();
    openInvoer('filmpje', item);
  }
}

/* ---- Invoer-vel (opmerking / filmpje) ---- */
function openInvoer(type, item){
  const bid = item.dataset.blok;
  const citaat = (item.textContent || '').trim().slice(0, 120);
  const overlay = document.createElement('div');
  overlay.className = 'trw-vel-overlay open';
  const isFilm = type === 'filmpje';
  overlay.innerHTML = `
    <div class="trw-vel">
      <h3>${isFilm ? 'Filmpje koppelen' : 'Opmerking toevoegen'}</h3>
      <div class="trw-vel-cite">"${esc(citaat)}"</div>
      ${isFilm
        ? `<input class="trw-vel-in" type="url" placeholder="Plak een YouTube-link…" value="https://youtu.be/">`
        : `<textarea class="trw-vel-in" placeholder="Bijv. 'Voordoen met 2 spelers werkt beter'…"></textarea>`}
      <div class="trw-vel-deel"><span class="trw-vel-punt"></span>Zichtbaar voor alle trainers van dit team</div>
      <div class="trw-vel-knoppen">
        <button class="trw-vel-annuleer">Annuleren</button>
        <button class="trw-vel-opslaan">${isFilm ? 'Koppelen' : 'Bewaren'}</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);
  const inv = overlay.querySelector('.trw-vel-in');
  setTimeout(() => inv.focus(), 100);
  const sluit = () => overlay.remove();
  overlay.querySelector('.trw-vel-annuleer').onclick = sluit;
  overlay.addEventListener('click', e => { if (e.target === overlay) sluit(); });
  overlay.querySelector('.trw-vel-opslaan').onclick = async () => {
    const waarde = inv.value.trim();
    if (isFilm){
      if (!youtubeId(waarde)){ meld('Geen geldige YouTube-link'); return; }
      const id = await bewaarNotitie(_actief.teamId, { trainingId: _actief.trainingId, blokId: bid, type: 'filmpje', tekst: '', youtubeUrl: waarde });
      const n = { id, blokId: bid, type: 'filmpje', youtubeUrl: waarde, auteurUid: S.user?.uid, auteurNaam: 'Jij' };
      _actief.notities.push(n);
      plaatsFilmpje(item, n);
      meld('Filmpje gedeeld met het team');
    } else {
      if (!waarde){ sluit(); return; }
      const id = await bewaarNotitie(_actief.teamId, { trainingId: _actief.trainingId, blokId: bid, type: 'opmerking', tekst: waarde });
      const n = { id, blokId: bid, type: 'opmerking', tekst: waarde, auteurUid: S.user?.uid, auteurNaam: 'Jij' };
      _actief.notities.push(n);
      // hertel pins door opnieuw te tonen
      verbergNotities(); toonNotities();
      meld('Opmerking gedeeld met het team');
    }
    werkBadgeBij();
    sluit();
  };
}

async function wisNotitie(notitieId){
  if (!confirm('Deze notitie verwijderen?')) return;
  await verwijderNotitie(_actief.teamId, notitieId);
  _actief.notities = _actief.notities.filter(n => n.id !== notitieId);
  verbergNotities(); toonNotities();
  werkBadgeBij();
  meld('Notitie verwijderd');
}

/* ---- Herstel eigen laag: wist alle EIGEN notities bij deze training ---- */
export async function herstelEigenLaag(){
  if (!_actief) return;
  const eigen = _actief.notities.filter(n => n.auteurUid === S.user?.uid);
  if (!eigen.length){ meld('Je hebt geen eigen notities'); return; }
  if (!confirm('Al jouw notities bij deze training wissen? Het origineel en notities van collega\'s blijven bewaard.')) return;
  for (const n of eigen){ try { await verwijderNotitie(_actief.teamId, n.id); } catch(e){} }
  _actief.notities = _actief.notities.filter(n => n.auteurUid !== S.user?.uid);
  verbergNotities(); toonNotities();
  werkBadgeBij();
  meld('Jouw laag hersteld');
}

/* ---- Opruimen bij sluiten van de training-weergave ---- */
export function resetAantekeningen(){
  _actief = null;
}

/* ---- Hulp ---- */
function flits(el){
  el.classList.remove('trw-flits'); void el.offsetWidth; el.classList.add('trw-flits');
}
function youtubeId(url){
  if (!url) return null;
  const m = String(url).match(/(?:youtu\.be\/|youtube\.com\/(?:watch\?v=|embed\/|shorts\/))([A-Za-z0-9_-]{11})/);
  return m ? m[1] : null;
}
