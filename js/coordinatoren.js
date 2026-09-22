/* ==================== BOUWCOÖRDINATOREN ====================
   Bewust een eigen, klein bestand — niet toegevoegd aan state.js, want
   elke state.js-wijziging triggert een dure transitieve versie-bump over
   tientallen bestanden. Dit module importeert alleen wat het nodig heeft
   uit de bestaande state.js/config.js, zonder die te wijzigen.

   Datamodel (Firestore: clubs/{clubId}):
     bouwCoordinatoren:     { onder: {uid:true,...}, midden: {...}, boven: {...} }
     bouwCoordinatorenInfo: { uid: {naam} }   — alleen voor weergave, geen
                                                 rechtenbron (die is bouwCoordinatoren)

   Rechten: een bouwcoördinator is voor ELK team in zijn bouw gelijk aan een
   gewone coach (zie firestore.rules: isTeamMember() telt coördinatoren nu
   mee). Dit bestand levert alleen de CLIENT-SIDE zichtbaarheidscheck —
   welke knoppen/schermen tonen we — de eigenlijke afdwinging staat in de
   rules. Een coördinator die ook zelf coach is, blijft dat gewoon; beide
   rollen tellen los van elkaar mee. */
import { S, esc, meld, openModal, sluitModal, initialen } from './state.js?v=20260922c';
import { db, doc, updateDoc, deleteField } from './firebase.js?v=20260922c';
import { BOUWEN, bouwNaam } from './config.js?v=20260922c';

/* ---------- Rechten-check (zelfde patroon als isBeheerder() in state.js) ---------- */
export function isBouwCoordinator(bouw){
  if (!bouw || !S.user || !S.club) return false;
  return !!(S.club.bouwCoordinatoren?.[bouw]?.[S.user.uid]);
}
/* Alle bouwen waar de ingelogde gebruiker coördinator van is (meestal 0 of 1,
   maar niets belet iemand coördinator van meerdere bouwen te maken). */
export function bouwenVanCoordinator(){
  if (!S.user || !S.club?.bouwCoordinatoren) return [];
  return BOUWEN.map(b => b.id).filter(id => isBouwCoordinator(id));
}
export function isCoordinatorEnigeBouw(){ return bouwenVanCoordinator().length > 0; }

/* ---------- Admin-scherm: coördinatoren aanwijzen ----------
   Wordt gerenderd binnen htmlClubInstel() in club.js. `teams` is dezelfde
   lijst die club.js daar al doorgeeft (S.clubTeams), gebruikt om de
   kandidatenlijst (alle coaches in de club) op te bouwen. */
function kandidaten(teams){
  const map = new Map(); // uid -> naam
  for (const t of (teams || [])){
    for (const [uid, info] of Object.entries(t.ledenInfo || {})){
      if (!map.has(uid)) map.set(uid, info?.naam || '(onbekend)');
    }
  }
  return [...map.entries()].map(([uid, naam]) => ({uid, naam})).sort((a,b) => a.naam.localeCompare(b.naam));
}

export function htmlCoordinatorenBeheer(teams){
  const info = S.club.bouwCoordinatorenInfo || {};
  const blok = (b) => {
    const uids = Object.keys(S.club.bouwCoordinatoren?.[b.id] || {});
    return `
      <div class="kaart" style="margin-bottom:10px">
        <div class="veldlabel" style="margin-top:0">${esc(b.naam)}</div>
        ${uids.length ? uids.map(uid => `
          <div class="lid-rij" data-coord-rij="${b.id}|${uid}">
            <div class="lid-avatar">${esc(initialen(info[uid]?.naam || '?'))}</div>
            <div class="lid-naam">${esc(info[uid]?.naam || 'Onbekende coach')}</div>
            <button class="lid-weg" data-coord-weg="${b.id}|${uid}" aria-label="Verwijderen als coördinator">✕</button>
          </div>`).join('')
        : `<p style="font-size:calc(12.5px * var(--fs));color:var(--ink-2);margin:2px 0 8px">Nog geen coördinator aangewezen.</p>`}
        <button class="knop licht klein" data-coord-toevoegen="${b.id}" style="margin-top:4px">+ Coördinator toevoegen</button>
      </div>`;
  };
  return `
    <div class="sectie-kop" style="font-size:calc(13px * var(--fs))">🧭 Bouwcoördinatoren</div>
    <p style="font-size:calc(12.5px * var(--fs));color:var(--ink-2);line-height:1.5;margin:0 0 10px">Een coördinator ziet en beheert alle teams binnen zijn bouw — precies als een coach, inclusief beoordelingen en notities. Iemand kan daarnaast gewoon coach van een eigen team blijven.</p>
    ${BOUWEN.map(blok).join('')}`;
}

export function koppelCoordinatorenBeheer(v, teams){
  v.querySelectorAll('[data-coord-toevoegen]').forEach(btn => {
    btn.onclick = () => modalCoordinatorToevoegen(btn.dataset.coordToevoegen, teams);
  });
  v.querySelectorAll('[data-coord-weg]').forEach(btn => {
    btn.onclick = async () => {
      const [bouw, uid] = btn.dataset.coordWeg.split('|');
      const naam = btn.closest('[data-coord-rij]')?.querySelector('.lid-naam')?.textContent || 'deze coach';
      if (!confirm(`${naam} niet langer coördinator van ${bouwNaam(bouw)}?`)) return;
      await updateDoc(doc(db, 'clubs', S.clubId), {
        [`bouwCoordinatoren.${bouw}.${uid}`]: deleteField(),
      });
      meld(`${naam} is geen coördinator meer van ${bouwNaam(bouw)}`);
    };
  });
}

function modalCoordinatorToevoegen(bouw, teams){
  const bestaand = new Set(Object.keys(S.club.bouwCoordinatoren?.[bouw] || {}));
  const opties = kandidaten(teams).filter(k => !bestaand.has(k.uid));
  openModal(`
    <h2>Coördinator · ${esc(bouwNaam(bouw))}</h2>
    <p style="font-size:calc(13px * var(--fs));color:var(--ink-2);margin-bottom:10px">Kies een coach die al bij de club bekend is.</p>
    ${opties.length ? opties.map(k => `
      <button class="knop licht" data-coord-kies="${k.uid}" style="text-align:left;justify-content:flex-start">${esc(k.naam)}</button>`).join('')
    : `<p style="font-size:calc(13px * var(--fs));color:var(--ink-2)">Geen kandidaten gevonden — er moet eerst iemand als coach bij een team staan.</p>`}
    <button class="knop licht vol" id="coordToevoegenAnnuleer" style="margin-top:10px">Annuleren</button>`);
  document.getElementById('coordToevoegenAnnuleer').onclick = sluitModal;
  document.querySelectorAll('[data-coord-kies]').forEach(btn => {
    btn.onclick = async () => {
      const uid = btn.dataset.coordKies;
      const naam = btn.textContent;
      await updateDoc(doc(db, 'clubs', S.clubId), {
        [`bouwCoordinatoren.${bouw}.${uid}`]: true,
        [`bouwCoordinatorenInfo.${uid}`]: {naam},
      });
      sluitModal();
      meld(`${naam} is coördinator van ${bouwNaam(bouw)}`);
    };
  });
}
