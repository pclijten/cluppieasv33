/* ==================== BOUWEN & TEAMS (standaardbouwen indelen) ====================
   [20260925b] Onder-, Midden- en Bovenbouw werden altijd automatisch op categorie
   bepaald (bouwVanCategorie). Hier kan de clubbeheerder per bouw zien welke
   teams erbij horen en daarvan afwijken.
   Opslag: op het teamdocument zelf —
     bouw:           'onder' | 'midden' | 'boven'   (bestond al; bron voor de
                     bouw-queries, coördinator-rechten en de zijbalk)
     bouwHandmatig:  true als de beheerder afwijkt van de categorie. Dan laat
                     een categoriewijziging door de coach de bouw met rust
                     (zie teams.js, #iCategorie).
   Een team zit in precies één standaardbouw; eigen bouwen (eigen-bouwen.js)
   blijven daarnaast werken zoals ze werkten.
   Getekend in Club → Instellingen, boven de eigen bouwen.
======================================================== */
import { S, esc, meld } from './state.js?v=20260922c';
import { db, doc, updateDoc } from './firebase.js?v=20260922c';
import { BOUWEN, bouwVanCategorie } from './config.js?v=20260922c';

const KLEUR = { onder:'#35c47a', midden:'#3b82f6', boven:'#a855f7' };
const KORT  = Object.fromEntries(BOUWEN.map(b => [b.id, b.kort]));

/* Standaardbouw van een team: het opgeslagen veld, anders afgeleid van de
   categorie (oude teams zonder bouw-veld). */
export function bouwVanTeam(t){
  return (t?.bouw && BOUWEN.some(b => b.id === t.bouw)) ? t.bouw : bouwVanCategorie(t?.categorie);
}
const autoBouw = t => bouwVanCategorie(t?.categorie);

let open = null;      // id van de bouw die in bewerking is
let concept = null;   // { teamId: bouwId } tijdens bewerken

function sorteer(teams){ return [...teams].sort((a, b) => (a.naam || '').localeCompare(b.naam || '', 'nl', { numeric:true })); }

function coordNamen(bouwId){
  const info = S.club?.bouwCoordinatorenInfo || {};
  return Object.keys(S.club?.bouwCoordinatoren?.[bouwId] || {})
    .filter(u => S.club.bouwCoordinatoren[bouwId][u] === true)
    .map(u => (info[u]?.naam || 'Coach').split('@')[0]);
}

function binnen(teams){
  const kaarten = BOUWEN.map(b => {
    const inBouw = sorteer(teams.filter(t => bouwVanTeam(t) === b.id));
    const hand = inBouw.filter(t => bouwVanTeam(t) !== autoBouw(t)).length;
    const coords = coordNamen(b.id);
    if (open === b.id) return editor(b, teams);
    return `
      <div class="kaart bi-kaart">
        <div class="eb-kop"><span class="eb-kleur" style="background:${KLEUR[b.id]}"></span>
          <div class="eb-naam">${esc(b.naam)}<small>${inBouw.length} team${inBouw.length === 1 ? '' : 's'}${hand ? ` · ${hand} handmatig` : ''}</small></div>
          <button class="knop licht klein" data-bi-open="${b.id}" ${open ? 'disabled' : ''}>Teams indelen</button></div>
        <div class="eb-tags bi-tags">${inBouw.map(t => {
          const h = bouwVanTeam(t) !== autoBouw(t);
          return `<span class="${h ? 'hand' : ''}" ${h ? `title="Handmatig ingedeeld — op categorie: ${esc(KORT[autoBouw(t)] || '')}bouw"` : ''}>${esc(t.naam || '?')}${h ? ' ✎' : ''}</span>`;
        }).join('') || '<em>Nog geen teams</em>'}</div>
        <div class="bi-coord">Coördinator: ${coords.length ? `<b>${coords.map(esc).join(', ')}</b>` : '— nog niemand'}</div>
      </div>`;
  }).join('');

  return `
    <div class="sectie-kop" style="font-size:calc(13px * var(--fs))">Bouwen &amp; teams</div>
    <p class="bi-intro">Per bouw zie je welke teams erbij horen. Standaard deelt Cluppie in op categorie (JO7–11 onder, JO12–15 midden, JO16+ boven). Wijk je daarvan af, klik dan op <b>Teams indelen</b>. Een team zit altijd in één standaardbouw, en mag daarnaast in eigen bouwen zitten.</p>
    <div class="bi-grid">${kaarten}</div>`;
}

function editor(b, teams){
  return `
    <div class="kaart bi-kaart open">
      <div class="eb-kop"><span class="eb-kleur" style="background:${KLEUR[b.id]}"></span>
        <div class="eb-naam">${esc(b.naam)}<small>${Object.values(concept).filter(x => x === b.id).length} teams geselecteerd</small></div></div>
      <div class="veldlabel">Teams in ${esc(b.naam)} <span style="font-weight:500;text-transform:none;letter-spacing:0">· klik om toe te voegen of weg te halen</span></div>
      <div class="eb-chips">${sorteer(teams).map(t => {
        const nu = concept[t.id], aan = nu === b.id, auto = autoBouw(t);
        const sub = !aan ? `nu ${KORT[nu] || '?'}` : (auto !== b.id ? `handmatig · cat. ${KORT[auto]}` : 'op categorie');
        return `<button type="button" class="eb-chip bi-chip ${aan ? 'aan' : ''}" data-bi-team="${esc(t.id)}">${esc(t.naam || '?')}<small>${esc(sub)}</small></button>`;
      }).join('') || '<span style="color:var(--ink-2)">Nog geen teams in de club.</span>'}</div>
      <p class="bi-uitleg">Voeg je een team toe dat nu in een andere bouw zit, dan <b>verhuist</b> het, inclusief de toegang van de coördinator. Haal je een handmatig team weg, dan gaat het terug naar de bouw van zijn categorie. Een team dat op categorie hier hoort, verplaats je door het in de andere bouw aan te klikken.</p>
      <div class="eb-knoppen"><button class="knop fluo" id="biOpslaan">Opslaan</button><button class="knop licht" id="biAnnuleer">Annuleren</button>
        <button class="link bi-reset" id="biReset">Alles in deze bouw terug naar automatisch</button></div>
    </div>`;
}

export function htmlBouwIndeling(teams){
  if (open && !concept) open = null;
  return `<div id="bouwIndelingBlok">${binnen(teams || [])}</div>`;
}

export function koppelBouwIndeling(v, teams){
  const blok = v.querySelector('#bouwIndelingBlok'); if (!blok) return;
  teams = teams || [];
  const teken = () => { blok.innerHTML = binnen(teams); koppelBouwIndeling(v, teams); };

  blok.querySelectorAll('[data-bi-open]').forEach(b => b.addEventListener('click', () => {
    open = b.dataset.biOpen;
    concept = Object.fromEntries(teams.map(t => [t.id, bouwVanTeam(t)]));
    teken();
  }));
  blok.querySelectorAll('[data-bi-team]').forEach(b => b.addEventListener('click', () => {
    const t = teams.find(x => x.id === b.dataset.biTeam); if (!t) return;
    if (concept[t.id] !== open) concept[t.id] = open;            // erbij → verhuist hierheen
    else if (autoBouw(t) !== open) concept[t.id] = autoBouw(t);  // weg → terug naar categorie
    else { meld(`${t.naam} hoort op categorie hier — klik hem aan in de andere bouw om te verplaatsen`); return; }
    teken();
  }));
  blok.querySelector('#biReset')?.addEventListener('click', () => {
    for (const t of teams) if (concept[t.id] === open || autoBouw(t) === open) concept[t.id] = autoBouw(t);
    teken();
  });
  blok.querySelector('#biAnnuleer')?.addEventListener('click', () => { open = null; concept = null; teken(); });
  blok.querySelector('#biOpslaan')?.addEventListener('click', async () => {
    const knop = blok.querySelector('#biOpslaan');
    // alleen teams waarvan de (effectieve) bouw of de handmatig-vlag echt verandert
    const wijzig = teams.filter(t => concept[t.id] && (concept[t.id] !== bouwVanTeam(t) || !!t.bouwHandmatig !== (concept[t.id] !== autoBouw(t))));
    if (!wijzig.length){ open = null; concept = null; teken(); return; }
    knop.disabled = true; knop.textContent = 'Opslaan…';
    const fouten = [];
    await Promise.all(wijzig.map(async t => {
      const bouw = concept[t.id], handmatig = bouw !== autoBouw(t);
      try {
        await updateDoc(doc(db, 'teams', t.id), { bouw, bouwHandmatig: handmatig });
        t.bouw = bouw; t.bouwHandmatig = handmatig;
      } catch(e){ fouten.push(`${t.naam}: ${e.code || e.message}`); }
    }));
    // bouw-dashboards en zijbalk hebben de teamlijsten per bouw gecachet
    try { window.dispatchEvent(new CustomEvent('cluppie:bouwen-gewijzigd')); } catch(e){}
    if (fouten.length){
      console.error('[Cluppie] bouw-indeling:', fouten);
      meld(`${wijzig.length - fouten.length} van ${wijzig.length} teams opgeslagen — ${fouten[0]}`);
      knop.disabled = false; knop.textContent = 'Opslaan';
      return;
    }
    meld(`Indeling opgeslagen (${wijzig.length} team${wijzig.length === 1 ? '' : 's'})`);
    open = null; concept = null; teken();
  });
}
