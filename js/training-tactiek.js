/* ==================== TRAINING-TACTIEK ====================
   Koppelt per oefening (in de AI-trainingsweergave) een compact tactiekbord-
   icoontje. Zit visueel op één lijn met het video-uitleg-icoontje, net onder de
   oefening-titel en boven het diagram.

   - Elke coach ziet een klein tactiekbord-icoon per oefening.
   - Is er al een bord gekoppeld, dan kleurt het icoon rood met een vinkje.
   - Tik = het bord openen (bestaand bewerken of leeg beginnen).
   - Het bord wordt bewaard in trainingen/{trainingId}/tactiekborden en de
     koppeling (oefIdx → bordId) staat in het trainingsdoc onder
     `tactiekborden` zodat de weergave weet welk bord bij welke oefening hoort.

   Deze module hangt bewust NIET aan de brede video-tegel: hij plaatst een eigen
   compacte icoon-rij (`.trw-oef-acties`) direct na de oefening-kop. Als
   training-video.js later óók een compacte icoon-variant krijgt, kan die in
   dezelfde rij landen. Voor nu blijft de video-UI ongemoeid. */

import { db, doc, getDoc, setDoc } from './firebase.js?v=20260811a';
import { meld } from './state.js?v=20260902b';

let _ctx = null;

/* opties: { stage, trainingId, koppelingen } waarbij koppelingen = { [oefIdx]: bordId } */
export function initTrainingTactiek({ stage, trainingId, koppelingen }){
  _ctx = {
    trainingId,
    koppelingen: { ...(koppelingen || {}) },
    stage,
    secties: [...stage.querySelectorAll('.trw-oef')],
  };
  tekenPerOefening();
}

export function resetTrainingTactiek(){
  _ctx = null;
}

/* De koppeling oefIdx → bordId in het trainingsdoc bijwerken. We bewaren dit als
   map `tactiekborden` op het trainingsdoc (klein, één veld). */
async function bewaarKoppeling(oefIdx, bordId){
  _ctx.koppelingen[oefIdx] = bordId;
  try {
    await setDoc(doc(db, 'trainingen', _ctx.trainingId),
      { tactiekborden: { [oefIdx]: bordId } }, { merge: true });
  } catch(e){
    meld('Koppeling bewaren mislukt');
  }
}

function tekenPerOefening(){
  _ctx.secties.forEach((sectie, i) => {
    const idx = i + 1;
    // bestaande rij weghalen bij hertekenen
    sectie.querySelectorAll('.trw-oef-acties').forEach(el => el.remove());

    const kop = sectie.querySelector('.trw-oef-kop');
    if (!kop) return;
    const titel = kop.querySelector('h2')?.textContent || ('Oefening ' + idx);

    const rij = document.createElement('div');
    rij.className = 'trw-oef-acties';

    const bordId = _ctx.koppelingen[idx] || null;
    const gevuld = !!bordId;

    const tegel = document.createElement('button');
    tegel.className = 'trw-oef-tegel tactiek' + (gevuld ? ' gevuld' : '');
    tegel.setAttribute('aria-label', 'Tactiekbord');
    tegel.title = gevuld ? 'Tactiekbord openen' : 'Tactiekbord toevoegen';
    tegel.innerHTML = `
      ${gevuld ? '<span class="tot-vink">✓</span>' : ''}
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"
           stroke-linecap="round" stroke-linejoin="round">
        <rect x="3" y="5" width="18" height="14" rx="2"/>
        <path d="M8 12l6-3M14 9l2 6"/>
        <circle cx="8" cy="12" r="1.3" fill="currentColor" stroke="none"/>
        <circle cx="14" cy="9" r="1.3" fill="currentColor" stroke="none"/>
        <circle cx="16" cy="15" r="1.3" fill="currentColor" stroke="none"/>
      </svg>`;
    tegel.onclick = () => openBord(idx, titel);
    rij.appendChild(tegel);

    kop.insertAdjacentElement('afterend', rij);
  });
}

function openBord(oefIdx, oefTitel){
  const bordId = _ctx.koppelingen[oefIdx] || null;
  import('./tactiekbord.js?v=20260902b').then(m => {
    m.openOefeningBord({
      trainingId: _ctx.trainingId,
      oefIdx,
      bordId,
      oefTitel,
      onKoppel: (nieuwId) => {
        // eerste keer bewaren → koppeling onthouden en het icoon bijwerken
        bewaarKoppeling(oefIdx, nieuwId).then(() => tekenPerOefening());
      },
    });
  });
}
