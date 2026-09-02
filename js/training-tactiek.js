/* ==================== TRAINING-TACTIEK ====================
   Koppelt per oefening (in de AI-trainingsweergave) een compact tactiekbord-
   icoontje. Zit visueel op één lijn met het video-uitleg-icoontje, net onder de
   oefening-titel en boven het diagram.

   - Elke coach ziet een klein tactiekbord-icoon per oefening.
   - Is er al een bord gekoppeld, dan kleurt het icoon rood met een vinkje.
   - Tik = het bord openen (bestaand bewerken of leeg beginnen).

   Opslag: het bord staat als veld op het trainingsdoc zelf, onder
   `oefeningTactiek.{oefIdx}` — precies zoals oefeningVideos. Zo zijn er GEEN
   nieuwe Firestore-rules nodig (schrijven naar het trainingsdoc werkt al) en
   hoeven we geen aparte subcollectie te lezen. tactiekbord.js schrijft het bord
   in één keer weg; deze module houdt alleen de lokale map + het icoon bij. */

let _ctx = null;

/* opties: { stage, trainingId, borden } waarbij borden = { [oefIdx]: bordData } */
export function initTrainingTactiek({ stage, trainingId, borden }){
  _ctx = {
    trainingId,
    borden: { ...(borden || {}) },
    stage,
    secties: [...stage.querySelectorAll('.trw-oef')],
  };
  tekenPerOefening();
}

export function resetTrainingTactiek(){
  _ctx = null;
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

    const bord = _ctx.borden[idx] || null;
    const gevuld = !!bord;

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
  const bord = _ctx.borden[oefIdx] || null;
  import('./tactiekbord.js?v=20260902d').then(m => {
    m.openOefeningBord({
      trainingId: _ctx.trainingId,
      oefIdx,
      bord,                 // volledige bord-data (of null) — geen extra read nodig
      oefTitel,
      onKoppel: (bordData) => {
        // net bewaard → lokaal onthouden en het icoon bijwerken
        _ctx.borden[oefIdx] = bordData;
        tekenPerOefening();
      },
    });
  });
}
