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

/* [20260925d] Een team dat in een eigen bouw zit (bijv. Meidenbouw) mag uit
   de standaardbouwen: dan staat op het team bouw:'eigen'. Zit het team in géén
   eigen bouw (meer), dan valt het terug op de categorie. */
export const ALLEEN_EIGEN = 'eigen';
function eigenBouwenLijst(){ return Array.isArray(S.club?.eigenBouwen) ? S.club.eigenBouwen.filter(b => b && b.id) : []; }
export function eigenBouwenVanTeam(t){ return t ? eigenBouwenLijst().filter(b => (b.teams || []).includes(t.id)) : []; }

/* Standaardbouw van een team: het opgeslagen veld, anders afgeleid van de
   categorie (oude teams zonder bouw-veld). 'eigen' = alleen in eigen bouw. */
export function bouwVanTeam(t){
  if (t?.bouw === ALLEEN_EIGEN && eigenBouwenVanTeam(t).length) return ALLEEN_EIGEN;
  return (t?.bouw && BOUWEN.some(b => b.id === t.bouw)) ? t.bouw : bouwVanCategorie(t?.categorie);
}
/* Voor oefenstof/video's per standaardbouw: een 'alleen eigen'-team telt mee
   bij de bouw van zijn categorie, anders verdwijnt zijn materiaal uit beeld. */
export function standaardBouwVoorStof(t){
  const b = bouwVanTeam(t);
  return b === ALLEEN_EIGEN ? bouwVanCategorie(t?.categorie) : b;
}
/* Teamkiezers (PDF-upload, video's): groepen per standaardbouw, plus één groep
   per eigen bouw voor de teams die alleen daar zitten. */
export function bouwGroepen(teams){
  const std = BOUWEN.map(b => ({ id:b.id, naam:b.naam, teams: teams.filter(t => bouwVanTeam(t) === b.id) }));
  const eigen = eigenBouwenLijst().map(eb => ({ id:eb.id, naam:eb.naam || 'Eigen bouw',
    teams: teams.filter(t => bouwVanTeam(t) === ALLEEN_EIGEN && eigenBouwenVanTeam(t)[0]?.id === eb.id) }));
  return [...std, ...eigen].filter(g => g.teams.length);
}
const autoBouw = t => bouwVanCategorie(t?.categorie);

let open = null;      // id van de bouw die in bewerking is
let concept = null;   // { teamId: bouwId } tijdens bewerken
let kiesVoor = null;  // [20260925c] team dat uit de open bouw weg moet → kies de nieuwe bouw

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
    <p class="bi-intro">Per bouw zie je welke teams erbij horen. Standaard deelt Cluppie in op categorie (JO7–11 onder, JO12–15 midden, JO16+ boven). Wijk je daarvan af, klik dan op <b>Teams indelen</b>. Een team zit in één standaardbouw en mag daarnaast in eigen bouwen zitten. Een team uit een eigen bouw (zoals de Meidenbouw) kan ook alléén daar staan.</p>
    <div class="bi-grid">${kaarten}${alleenEigen(teams)}</div>`;
}

function alleenEigen(teams){
  const lijst = sorteer(teams.filter(t => bouwVanTeam(t) === ALLEEN_EIGEN));
  if (!lijst.length) return '';
  return `
    <div class="kaart bi-kaart bi-eigen">
      <div class="eb-kop"><span class="eb-kleur" style="background:var(--ink-2)"></span>
        <div class="eb-naam">Alleen in eigen bouw<small>${lijst.length} team${lijst.length === 1 ? '' : 's'} \u00b7 in geen standaardbouw</small></div></div>
      <div class="eb-tags bi-tags">${lijst.map(t => `<span>${esc(t.naam || '?')} <em>\u00b7 ${esc(eigenBouwenVanTeam(t).map(b => b.naam).join(', '))}</em></span>`).join('')}</div>
      <div class="bi-coord">Zet een team terug door het in een standaardbouw aan te klikken.</div>
    </div>`;
}

function editor(b, teams){
  return `
    <div class="kaart bi-kaart open">
      <div class="eb-kop"><span class="eb-kleur" style="background:${KLEUR[b.id]}"></span>
        <div class="eb-naam">${esc(b.naam)}<small>${Object.values(concept).filter(x => x === b.id).length} teams geselecteerd</small></div></div>
      <div class="veldlabel">Teams in ${esc(b.naam)} <span style="font-weight:500;text-transform:none;letter-spacing:0">· klik om toe te voegen of weg te halen</span></div>
      <div class="eb-chips">${sorteer(teams).map(t => {
        const nu = concept[t.id], aan = nu === b.id, auto = autoBouw(t);
        const sub = !aan ? (nu === ALLEEN_EIGEN ? 'alleen eigen bouw' : `nu ${KORT[nu] || '?'}`) : (auto !== b.id ? `handmatig · cat. ${KORT[auto]}` : 'op categorie');
        return `<button type="button" class="eb-chip bi-chip ${aan ? 'aan' : ''}${kiesVoor === t.id ? ' kies' : ''}" data-bi-team="${esc(t.id)}">${esc(t.naam || '?')}<small>${esc(sub)}</small></button>`;
      }).join('') || '<span style="color:var(--ink-2)">Nog geen teams in de club.</span>'}</div>
      ${kiesVoor ? kiezer(b, teams.find(t => t.id === kiesVoor)) : ''}
      <p class="bi-uitleg">Voeg je een team toe dat nu in een andere bouw zit, dan <b>verhuist</b> het, inclusief de toegang van de coördinator. Haal je een team weg, dan kies je naar welke andere bouw het gaat. Zit het team in een eigen bouw (zoals de Meidenbouw), dan kan het ook alleen daar staan.</p>
      <div class="eb-knoppen"><button class="knop fluo" id="biOpslaan">Opslaan</button><button class="knop licht" id="biAnnuleer">Annuleren</button>
        <button class="link bi-reset" id="biReset">Alles in deze bouw terug naar automatisch</button></div>
    </div>`;
}

/* [20260925c] Weghalen = verplaatsen: kies de andere standaardbouw. */
function kiezer(b, t){
  if (!t) return '';
  const auto = autoBouw(t);
  const eigen = eigenBouwenVanTeam(t);
  return `
    <div class="bi-kiezer">
      <div class="bi-kiezer-t"><b>${esc(t.naam || '?')}</b> uit ${esc(b.naam)} halen — naar welke bouw?</div>
      <div class="bi-kiezer-k">${BOUWEN.filter(x => x.id !== b.id).map(x =>
        `<button type="button" class="knop licht klein" data-bi-naar="${x.id}">${esc(x.naam)}${x.id === auto ? ' <small>(categorie)</small>' : ''}</button>`).join('')}
        ${eigen.length ? `<button type="button" class="knop licht klein" data-bi-naar="${ALLEEN_EIGEN}">Alleen ${esc(eigen.map(e => e.naam).join(' + '))}</button>` : ''}
        <button type="button" class="bi-reset" data-bi-naar="">Niet verplaatsen</button></div>
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
    open = b.dataset.biOpen; kiesVoor = null;
    concept = Object.fromEntries(teams.map(t => [t.id, bouwVanTeam(t)]));
    teken();
  }));
  blok.querySelectorAll('[data-bi-team]').forEach(b => b.addEventListener('click', () => {
    const t = teams.find(x => x.id === b.dataset.biTeam); if (!t) return;
    if (concept[t.id] !== open){ concept[t.id] = open; kiesVoor = null; }   // erbij → verhuist hierheen
    else kiesVoor = kiesVoor === t.id ? null : t.id;                        // weg → kies de nieuwe bouw
    teken();
  }));
  blok.querySelectorAll('[data-bi-naar]').forEach(b => b.addEventListener('click', () => {
    if (kiesVoor && b.dataset.biNaar) concept[kiesVoor] = b.dataset.biNaar;
    kiesVoor = null; teken();
  }));
  blok.querySelector('#biReset')?.addEventListener('click', () => {
    kiesVoor = null;
    for (const t of teams) if (concept[t.id] === open || autoBouw(t) === open) concept[t.id] = autoBouw(t);
    teken();
  });
  blok.querySelector('#biAnnuleer')?.addEventListener('click', () => { open = null; concept = null; kiesVoor = null; teken(); });
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
    open = null; concept = null; kiesVoor = null; teken();
  });
}
