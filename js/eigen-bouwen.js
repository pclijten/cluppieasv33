/* ==================== EIGEN BOUWEN ====================
   [20260923d] Naast de drie standaardbouwen (onder/midden/boven, automatisch
   op categorie) kan een clubbeheerder eigen bouwen maken, bijvoorbeeld een
   Meidenbouw, en daar teams aan koppelen. Een team mag in meerdere bouwen
   tegelijk zitten.
   Opslag: alleen op het clubdocument, veld
     eigenBouwen: [{ id, naam, kleur, teams:[teamId, …] }]
   Het team zelf verandert niet: zijn `bouw`-veld (standaardbouw) blijft de
   bron voor oefenstof en de standaard-coördinatoren.
   [20260923e] Een eigen bouw kan gekoppelde coaches hebben (eb.coaches =
   {uid:true}). Die krijgen dezelfde rechten als een bouwcoördinator. Daarvoor
   houdt de club twee afgeleide velden bij, altijd samen herberekend:
     eigenBouwToegang: { teamId: { uid:true } }  → gelezen door de Firestore-rules
     eigenBouwCoaches: [uid, …]                  → array-contains-query bij inloggen
   plus eigenBouwCoachesInfo: { uid:{naam} } voor de weergave.
   Alleen een clubadmin mag het clubdocument wijzigen (rules), dus een coach
   kan zichzelf geen toegang geven.
   Getekend in Club → Bouwen (sinds 20260929a), onder de standaardbouwen.
======================================================== */
import { S, esc, meld } from './state.js?v=20260922c';
import { db, doc, updateDoc } from './firebase.js?v=20260922c';
import { BOUWEN, bouwVanCategorie } from './config.js?v=20260922c';

const KLEUREN = ['#ec4899', '#3b82f6', '#10b981', '#f59e0b', '#a855f7', '#ef4444'];
let concept = null;           // { id, naam, kleur, teams:[], coaches:{}, selectie:bool|null, nieuw:bool } — de bouw die open staat
/* [20260928f] Selectie (1e + 2e): eb.selectie === true, of nog niet ingesteld en de naam bevat
   "selectie". Dan krijgt het bouw-dashboard radars per team en de tegel Selectie maken
   (selectie-bouw.js). Het eerste team op naam is het 1e elftal. */
const isSelectie = b => b?.selectie === true || (b?.selectie == null && /selectie/i.test(b?.naam || ''));

export function eigenBouwenVan(club){ return Array.isArray(club?.eigenBouwen) ? club.eigenBouwen.filter(b => b && b.id) : []; }

/* Alle coaches van de club: leden van de teams (met naam uit ledenInfo), plus jijzelf. */
function coachesVan(teams){
  const m = new Map();
  for (const t of teams){
    const info = t.ledenInfo || {};
    for (const uid of Object.keys(t.leden || {})){
      if (t.leden[uid] !== true) continue;
      const e = m.get(uid) || { uid, naam: info[uid]?.naam || '', teams: [] };
      if (!e.naam && info[uid]?.naam) e.naam = info[uid].naam;
      e.teams.push(t.naam || '');
      m.set(uid, e);
    }
  }
  if (S.user?.uid && !m.has(S.user.uid)) m.set(S.user.uid, { uid:S.user.uid, naam: S.user.displayName || S.user.email || 'Ik', teams:[] });
  return [...m.values()].map(e => ({ ...e, naam: (e.naam || 'Coach').split(/[@]/)[0] }))
    .sort((a, b) => a.naam.localeCompare(b.naam, 'nl'));
}
/* Afgeleide velden voor rules en inlog-query, uit de complete lijst eigen bouwen. */
function afgeleid(lijst, teams){
  const toegang = {}, coaches = new Set(), info = {};
  const alle = coachesVan(teams);
  for (const b of lijst){
    const uids = Object.keys(b.coaches || {}).filter(u => b.coaches[u] === true);
    uids.forEach(u => { coaches.add(u); const c = alle.find(x => x.uid === u); if (c) info[u] = { naam: c.naam }; });
    for (const tid of (b.teams || [])){ toegang[tid] = toegang[tid] || {}; uids.forEach(u => { toegang[tid][u] = true; }); }
  }
  return { eigenBouwToegang: toegang, eigenBouwCoaches: [...coaches], eigenBouwCoachesInfo: info };
}
async function bewaar(lijst, teams){
  await updateDoc(doc(db, 'clubs', S.clubId), { eigenBouwen: lijst, ...afgeleid(lijst, teams) });
  /* [20260925d] Een team dat 'alleen in eigen bouw' stond (bouw:'eigen', zie
     bouw-indeling.js) en nu in geen enkele eigen bouw meer zit, gaat terug
     naar de standaardbouw van zijn categorie — anders valt het overal buiten. */
  const inEigen = new Set(lijst.flatMap(b => b.teams || []));
  const wees = teams.filter(t => t.bouw === 'eigen' && !inEigen.has(t.id));
  await Promise.all(wees.map(async t => {
    const bouw = bouwVanCategorie(t.categorie);
    try { await updateDoc(doc(db, 'teams', t.id), { bouw, bouwHandmatig: false }); t.bouw = bouw; t.bouwHandmatig = false; }
    catch(e){ console.error('[Cluppie] eigen-bouwen: team terugzetten mislukt', t.id, e.code || e.message); }
  }));
  try { window.dispatchEvent(new CustomEvent('cluppie:bouwen-gewijzigd')); } catch(e){}
  return wees.length ? ` \u2014 ${wees.map(t => t.naam).join(', ')} staat weer in de standaardbouw van zijn categorie` : '';
}

function sorteer(teams){ return [...teams].sort((a, b) => (a.naam || '').localeCompare(b.naam || '', 'nl', { numeric:true })); }
const isMeiden = t => /^MO\d/i.test(String(t.categorie || t.naam || ''));

function binnen(teams){
  const lijst = eigenBouwenVan(S.club);
  /* [20260929a] zelfde kaart als de standaardbouwen (Club → Bouwen): teams + gekoppelde coaches */
  const alleCoaches = coachesVan(teams);
  const coachNaam = uid => S.club?.eigenBouwCoachesInfo?.[uid]?.naam || alleCoaches.find(c => c.uid === uid)?.naam || 'Coach';
  const twee = n => { const w = String(n || '?').trim().split(/\s+/).filter(Boolean); return ((w[0]?.[0] || '?') + (w.length > 1 ? w[w.length - 1][0] : '')).toUpperCase(); };
  const rij = b => {
    const uids = Object.keys(b.coaches || {}).filter(u => b.coaches[u] === true);
    const bt = sorteer(teams.filter(t => (b.teams || []).includes(t.id)));
    return `
    <div class="cb-bouw" style="--kl:${esc(b.kleur || KLEUREN[0])}">
      <div class="cb-bouw-kop"><div class="eb-naam">${esc(b.naam)}<small>${bt.length} team${bt.length === 1 ? '' : 's'} \u00b7 ${uids.length} gekoppelde coach${uids.length === 1 ? '' : 'es'}</small></div>
        <span class="cb-soort">${isSelectie(b) ? 'Selectie 1e + 2e' : 'Eigen bouw'}</span></div>
      <div class="cb-bouw-sub">
        <div class="cb-bouw-lbl">Teams <button class="cb-link" data-eb-bewerk="${esc(b.id)}">Bewerken</button></div>
        <div class="eb-tags" style="margin-top:0">${bt.map(t => `<span>${esc(t.naam)}</span>`).join('') || '<em>Nog geen teams</em>'}</div>
      </div>
      <div class="cb-bouw-sub">
        <div class="cb-bouw-lbl">Gekoppelde coaches <button class="cb-link" data-eb-bewerk="${esc(b.id)}">+ Toevoegen</button></div>
        ${uids.length ? uids.map(u => ({ u, n: coachNaam(u) })).sort((x, y) => x.n.localeCompare(y.n, 'nl')).map(({ u, n }) => `<div class="cb-persoon"><div class="cb-av">${esc(twee(n))}</div><div class="cb-persoon-n">${esc(n)}${u === S.user?.uid ? ' <small class="cb-inline">jij</small>' : ''}</div><button class="lid-weg cb-weg" data-eb-coachweg="${esc(b.id)}|${esc(u)}" aria-label="${esc(n)} ontkoppelen">✕</button></div>`).join('')
          : '<span class="cb-tag geen">Nog niemand</span>'}
      </div>
    </div>`;
  };
  const editor = () => {
    const c = concept;
    return `
    <div class="kaart eb-editor" style="margin-bottom:10px">
      <div class="veldlabel" style="margin-top:0">${c.nieuw ? 'Nieuwe bouw' : 'Bouw bewerken'}</div>
      <input class="invoer" id="ebNaam" value="${esc(c.naam)}" placeholder="Naam, bijv. Meidenbouw" autocomplete="off">
      <div class="veldlabel">Kleur</div>
      <div class="eb-kleuren">${KLEUREN.map(k => `<button type="button" class="eb-kleurknop ${k === c.kleur ? 'aan' : ''}" data-eb-kleur="${k}" style="background:${k}" aria-label="Kleur ${k}"></button>`).join('')}</div>
      <div class="veldlabel">Teams <span style="font-weight:500;text-transform:none;letter-spacing:0">\u00b7 tik om te koppelen of los te maken \u2014 een team mag in meerdere bouwen</span></div>
      <div class="eb-chips">${sorteer(teams).map(t => `<button type="button" class="eb-chip ${c.teams.includes(t.id) ? 'aan' : ''}" data-eb-team="${esc(t.id)}">${esc(t.naam)}</button>`).join('') || '<span style="color:var(--ink-2)">Nog geen teams in de club.</span>'}</div>
      <div class="eb-snel"><button type="button" class="knop licht klein" data-eb-snel="mo">Alle MO-teams</button><button type="button" class="knop licht klein" data-eb-snel="leeg">Niets</button></div>
      <div class="veldlabel">Gekoppelde coaches <span style="font-weight:500;text-transform:none;letter-spacing:0">\u00b7 krijgen dezelfde rechten als een bouwcoördinator</span></div>
      <div class="eb-chips">${coachesVan(teams).map(co => `<button type="button" class="eb-chip ${c.coaches[co.uid] ? 'aan' : ''}" data-eb-coach="${esc(co.uid)}">${esc(co.naam)}${co.uid === S.user?.uid ? ' <small>(jij)</small>' : co.teams.length ? ` <small>${esc(co.teams.slice(0, 2).join(', '))}</small>` : ''}</button>`).join('')}</div>
      <div class="veldlabel">Soort bouw</div>
      <div class="eb-chips"><button type="button" class="eb-chip ${isSelectie(c) ? 'aan' : ''}" data-eb-selectie="1">Selectie met 1e en 2e elftal</button></div>
      <p style="font-size:calc(12px * var(--fs));color:var(--ink-2);line-height:1.45;margin:6px 0 0">Aan: het dashboard toont per team de evaluatie-radar en de tegel Selectie maken, waar je per speler 1e, 2e of beide kiest. Het eerste team op naam is het 1e elftal.</p>
      <p style="font-size:calc(12px * var(--fs));color:var(--ink-2);line-height:1.45;margin:8px 0 0">Zij zien deze bouw in hun menu (dashboard, uitleningen, alle teams) en mogen de teams in deze bouw bekijken en aanpassen. Koppel jezelf om het dashboard van deze bouw zelf te kunnen zien.</p>
      <div class="eb-knoppen"><button class="knop fluo" id="ebOpslaan">Opslaan</button><button class="knop licht" id="ebAnnuleer">Annuleren</button>
        ${c.nieuw ? '' : '<button class="knop licht" id="ebWeg" style="color:var(--uit)">Verwijderen</button>'}</div>
    </div>`;
  };
  return `
    <div class="sectie-kop">Eigen bouwen</div>
    <p class="cb-legenda">Maak zelf bouwen, zoals een Meidenbouw of Selectie. Een team mag in meerdere bouwen zitten. Oefenstof blijft bij de standaardbouw; gekoppelde coaches krijgen dezelfde rechten als een bouwcoördinator.</p>
    ${lijst.map(b => concept && !concept.nieuw && concept.id === b.id ? editor() : rij(b)).join('')}
    ${concept?.nieuw ? editor() : ''}
    ${concept ? '' : `<div class="cb-acties"><button class="knop licht klein" id="ebNieuw">+ Nieuwe bouw</button>${lijst.some(b => /meiden/i.test(b.naam)) ? '' : '<button class="knop licht klein" id="ebMeiden">+ Meidenbouw met alle MO-teams</button>'}</div>`}`;
}

export function htmlEigenBouwenBeheer(teams){
  return `<div id="eigenBouwenBlok">${binnen(teams || [])}</div>`;
}

export function koppelEigenBouwenBeheer(v, teams){
  const blok = v.querySelector('#eigenBouwenBlok'); if (!blok) return;
  teams = teams || [];
  const teken = () => { blok.innerHTML = binnen(teams); koppelEigenBouwenBeheer(v, teams); };
  const naamBijhouden = () => { const i = blok.querySelector('#ebNaam'); if (i && concept) concept.naam = i.value; };
  blok.querySelector('#ebNieuw')?.addEventListener('click', () => {
    concept = { id:'eb' + Date.now().toString(36), naam:'', kleur:KLEUREN[1], teams:[], coaches: S.user?.uid ? { [S.user.uid]:true } : {}, nieuw:true }; teken();
    blok.querySelector('#ebNaam')?.focus();
  });
  blok.querySelector('#ebMeiden')?.addEventListener('click', () => {
    concept = { id:'meiden', naam:'Meidenbouw', kleur:KLEUREN[0], teams: teams.filter(isMeiden).map(t => t.id), coaches: S.user?.uid ? { [S.user.uid]:true } : {}, nieuw:true }; teken();
  });
  blok.querySelectorAll('[data-eb-bewerk]').forEach(b => b.addEventListener('click', () => {
    const e = eigenBouwenVan(S.club).find(x => x.id === b.dataset.ebBewerk); if (!e) return;
    concept = { id:e.id, naam:e.naam || '', kleur:e.kleur || KLEUREN[0], teams:[...(e.teams || [])], coaches:{ ...(e.coaches || {}) }, selectie: e.selectie ?? null, nieuw:false }; teken();
  }));
  blok.querySelector('#ebNaam')?.addEventListener('input', naamBijhouden);
  blok.querySelectorAll('[data-eb-kleur]').forEach(b => b.addEventListener('click', () => { naamBijhouden(); concept.kleur = b.dataset.ebKleur; teken(); }));
  blok.querySelectorAll('[data-eb-team]').forEach(b => b.addEventListener('click', () => {
    naamBijhouden(); const id = b.dataset.ebTeam;
    concept.teams = concept.teams.includes(id) ? concept.teams.filter(x => x !== id) : [...concept.teams, id]; teken();
  }));
  blok.querySelectorAll('[data-eb-coach]').forEach(b => b.addEventListener('click', () => {
    naamBijhouden(); const uid = b.dataset.ebCoach;
    if (concept.coaches[uid]) delete concept.coaches[uid]; else concept.coaches[uid] = true; teken();
  }));
  blok.querySelector('[data-eb-selectie]')?.addEventListener('click', () => { naamBijhouden(); concept.selectie = !isSelectie(concept); teken(); });
  blok.querySelectorAll('[data-eb-snel]').forEach(b => b.addEventListener('click', () => {
    naamBijhouden(); concept.teams = b.dataset.ebSnel === 'mo' ? [...new Set([...concept.teams, ...teams.filter(isMeiden).map(t => t.id)])] : []; teken();
  }));
  blok.querySelector('#ebAnnuleer')?.addEventListener('click', () => { concept = null; teken(); });
  /* [20260929a] coach direct ontkoppelen vanaf de bouwkaart */
  blok.querySelectorAll('[data-eb-coachweg]').forEach(b => b.addEventListener('click', async () => {
    const [bid, uid] = b.dataset.ebCoachweg.split('|');
    const lijst = eigenBouwenVan(S.club); const e = lijst.find(x => x.id === bid); if (!e) return;
    const naam = b.closest('.cb-persoon')?.querySelector('.cb-persoon-n')?.firstChild?.textContent?.trim() || 'deze coach';
    if (!confirm(`${naam} ontkoppelen van ${e.naam}?`)) return;
    const coaches = { ...(e.coaches || {}) }; delete coaches[uid];
    const volgende = lijst.map(x => x.id === bid ? { ...x, coaches } : x);
    try { await bewaar(volgende, teams); if (S.club) S.club.eigenBouwen = volgende; meld(`${naam} ontkoppeld van ${e.naam}`); teken(); }
    catch(err){ meld('Opslaan mislukt: ' + (err.code || err.message)); }
  }));
  blok.querySelector('#ebOpslaan')?.addEventListener('click', async () => {
    naamBijhouden();
    const naam = (concept.naam || '').trim();
    if (!naam) return meld('Geef de bouw een naam');
    const lijst = eigenBouwenVan(S.club);
    const bezet = [...BOUWEN.map(b => b.naam), ...lijst.filter(b => b.id !== concept.id).map(b => b.naam)].some(n => n.toLowerCase() === naam.toLowerCase());
    if (bezet) return meld('Er bestaat al een bouw met die naam');
    let id = concept.id;
    if (concept.nieuw && (BOUWEN.some(b => b.id === id) || lijst.some(b => b.id === id))) id = 'eb' + Date.now().toString(36);
    const nieuw = { id, naam, kleur: concept.kleur, teams: concept.teams.filter(t => teams.some(x => x.id === t)), coaches: { ...concept.coaches } };
    if (concept.selectie != null) nieuw.selectie = concept.selectie === true;
    const volgende = concept.nieuw ? [...lijst, nieuw] : lijst.map(b => b.id === concept.id ? nieuw : b);
    try { const extra = await bewaar(volgende, teams); concept = null; meld(`${naam} opgeslagen${extra}`); if (S.club) S.club.eigenBouwen = volgende; teken(); }
    catch(e){ meld('Opslaan mislukt: ' + (e.code || e.message)); }
  });
  blok.querySelector('#ebWeg')?.addEventListener('click', async () => {
    const lijst = eigenBouwenVan(S.club); const e = lijst.find(b => b.id === concept.id); if (!e) return;
    if (!confirm(`${e.naam} verwijderen? De teams zelf blijven gewoon bestaan.`)) return;
    const volgende = lijst.filter(b => b.id !== e.id);
    try { const extra = await bewaar(volgende, teams); concept = null; meld(`${e.naam} verwijderd${extra}`); if (S.club) S.club.eigenBouwen = volgende; teken(); }
    catch(err){ meld('Verwijderen mislukt: ' + (err.code || err.message)); }
  });
}
