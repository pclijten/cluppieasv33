/* ==================== DESKTOP-SCHIL (≥ 1100 × 520 px) ====================
   [20260922d] Stap 1 van de desktop-herinrichting (sinds [20260922e] met eigen
   schermen in desktop-schermen.js; de zijbalk hieronder is ongewijzigd) (goedgekeurde mockup
   "zijbalk + paspoortstijl"). Deze module:
     • wordt ALLEEN geladen door main.js als het scherm breed genoeg is — een
       telefoon downloadt/parset dit bestand nooit;
     • tekent een vaste zijbalk links (teamwissel, zoeken, menu per ruimte);
     • stuurt alle klikken door naar de BESTAANDE navigatie (openTeam,
       zetTeamTab, openClub, openWedstrijd, …). De zijbalk tekent zelf geen
       schermen; vijf team-tabbladen krijgen een eigen desktopweergave via
       desktop-schermen.js, de rest draait ongewijzigd rechts van de zijbalk.
   Bewust géén wijziging in state.js of teams.js: de zijbalk leest S en volgt
   de DOM (MutationObserver op #app) om te weten welk scherm actief is.
   Stijl: blok "DESKTOP-SCHIL" achteraan in styles.css (html.desk).
========================================================================== */
import { S, $, esc, modAan, isBeheerder, stopUnsubs, meld } from './state.js?v=20260922c';
import { ico } from './icons.js?v=20260922c';
import { BOUWEN } from './config.js?v=20260922c';
import { openTeam, zetTeamTab, verlaatTeamView, updatesInfo, renderTeam } from './teams.js?v=20260923d';
import { initSchermen, ruimOp } from './desktop-schermen.js?v=20260923d';
import { openBouw, bouwTeams, bouwHuidig, zetHerteken } from './desktop-bouw.js?v=20260923d';
import { ongelezenBerichten } from './berichten.js?v=20260922c';
import { evaluatieOpen } from './teams-hub.js?v=20260922c';
import { telNav } from './tracker.js?v=20260922c';

const K_KLEIN = 'cluppie_zijbalk_klein';
let openBouwSleutel = null, openBouwTeam = null;
let mq = null, zij = null, pal = null, laatsteHtml = '', gepland = false, teamKeuzeOpen = false, wasDesk = null;

/* ---------- hulpjes ---------- */
const probeer = (f, dflt) => { try { return f(); } catch(e){ return dflt; } };
const huidigeView = () => ($('.view.actief')?.id || '').replace('view-', '');
function laatsteTeamId(){
  const l = probeer(() => localStorage.getItem('cluppie_laatste_team'), null);
  if (l && S.teams.some(t => t.id === l)) return l;
  return S.teams[0]?.id || null;
}
function coachNaam(){
  let n = '';
  for (const t of S.teams){ n = t.ledenInfo?.[S.user?.uid]?.naam || ''; if (n) break; }
  if (!n) for (const c of S.clubs){ n = c.ledenInfo?.[S.user?.uid]?.naam || ''; if (n) break; }
  n = (n || S.user?.displayName || S.user?.email || '').trim();
  const v = n ? n.split(/[ @.]/)[0] : 'coach';
  return v.charAt(0).toUpperCase() + v.slice(1);
}
function rolNaam(){
  if (isBeheerder() || S.clubs.length) return 'Beheerder';
  if ((S.coordinatorBouwen || []).length) return 'Coördinator';
  return 'Coach';
}

/* Een geopende wedstrijd netjes sluiten vóór een team-/clubwissel.
   sluitWedstrijd() rendert via een dynamische import het team opnieuw; door
   daarna zelf ook op die (al geladen) module te wachten en één frame te geven
   loopt onze vervolgstap gegarandeerd ná die render. */
async function sluitOpenWedstrijd(){
  if (huidigeView() !== 'wedstrijd' && !S.wedstrijdId) return;
  const w = await import('./wedstrijd.js?v=20260923d');
  w.sluitWedstrijd();
  await import('./teams.js?v=20260923d');
  await new Promise(r => requestAnimationFrame(() => r()));
}
/* Club-view verlaten zónder terug te springen naar het teamoverzicht
   (verlaatClubView doet dat asynchroon en zou onze vervolgstap overschrijven). */
function verlaatClubStil(){
  if (huidigeView() !== 'club') return;
  stopUnsubs('club', 'clubContent');
  S.clubId = null; S.club = null;
}

/* ---------- navigatie ---------- */
async function gaNaarTab(tab, opties = {}){
  telNav('desk:' + tab, 'zijbalk');
  const view = huidigeView();
  if (view === 'wedstrijd'){
    const w = await import('./wedstrijd.js?v=20260923d');
    if (opties.profiel) S._beoordeelProfiel = opties.profiel;
    w.sluitWedstrijd(tab);
    return;
  }
  verlaatClubStil();
  const tid = S.teamId || laatsteTeamId();
  if (!tid){ meld('Maak eerst een team aan of sluit je aan bij een team'); return; }
  if (!S.teamId || view !== 'team'){
    openTeam(tid, tab, opties.profiel ? { beoordeelProfiel: opties.profiel } : {});
    return;
  }
  S._beoordeelProfiel = opties.profiel || null;
  zetTeamTab(tab);
}
async function wisselTeam(id){
  teamKeuzeOpen = false;
  if (id === S.teamId && huidigeView() === 'team'){ plan(); return; }
  await sluitOpenWedstrijd();
  verlaatClubStil();
  openTeam(id);
}
async function naarOverzicht(){
  teamKeuzeOpen = false;
  await sluitOpenWedstrijd();
  if (S.teamId){ verlaatTeamView(); return; }
  if (huidigeView() === 'club'){ const c = await import('./club.js?v=20260923d'); c.verlaatClubView(); }
}
async function openClubDesk(id){
  await sluitOpenWedstrijd();
  if (S.teamId) verlaatTeamView();
  const c = await import('./club.js?v=20260923d');
  c.openClub(id);
}
async function openBouwDesk(clubId, bouw){
  const b = await import('./bouw-hub.js?v=20260923d');
  b.openBouwHub(clubId, bouw);
}
/* Bouw-omgeving openen: eerst een open wedstrijd/club/team netjes verlaten. */
async function naarBouw(clubId, bouw, scherm, teamId = null){
  telNav('desk:bouw:' + scherm, 'zijbalk');
  await sluitOpenWedstrijd();
  verlaatClubStil();
  if (S.teamId){ try { verlaatTeamView(); } catch(e){} }
  await openBouw(clubId, bouw, scherm, teamId);
}
/* Eigen team → gewone teamschermen (bewerkbaar); ander team → meekijken. */
async function naarBouwPag(clubId, bouw, teamId, pag){
  if ((S.teams || []).some(t => t.id === teamId)){
    const tab = { sel:'spelers', evs:'spelers', evw:'evaluatie', stat:'stats' }[pag] || 'hub';
    S._dkModus = pag === 'evs' ? 'evaluatie' : null;
    await sluitOpenWedstrijd(); verlaatClubStil();
    if (S.teamId !== teamId || huidigeView() !== 'team'){ openTeam(teamId, tab); return; }
    S._beoordeelProfiel = null; zetTeamTab(tab); return;
  }
  return naarBouw(clubId, bouw, pag, teamId);
}
async function voerActieUit(actie, data = {}){
  if (actie === 'tab')        return gaNaarTab(data.tab);
  if (actie === 'team')       return wisselTeam(data.id);
  if (actie === 'overzicht')  return naarOverzicht();
  if (actie === 'club')       return openClubDesk(data.id);
  if (actie === 'bouw')       return openBouwDesk(data.club, data.bouw);
  if (actie === 'niets')      return;
  if (actie === 'bouwtoggle'){
    const k = data.club + '|' + data.bouw;
    if (openBouwSleutel === k){ openBouwSleutel = null; openBouwTeam = null; plan(); return; }
    openBouwSleutel = k; openBouwTeam = null;
    return naarBouw(data.club, data.bouw, 'dash');
  }
  if (actie === 'bteam'){
    openBouwTeam = openBouwTeam === data.team ? null : data.team;
    if (!openBouwTeam){ plan(); return; }
    return naarBouwPag(data.club, data.bouw, data.team, 'sel');
  }
  if (actie === 'bpag'){
    if (data.pag === 'dash' || data.pag === 'uit') return naarBouw(data.club, data.bouw, data.pag);
    return naarBouwPag(data.club, data.bouw, data.team, data.pag);
  }
  if (actie === 'coordbeheer'){
    await openClubDesk(data.id);
    S.clubTab = 'instel';          // eerste render (bij binnenkomst van de clubdata) toont Instellingen met Coördinatoren
    return;
  }
  if (actie === 'chat')       return import('./chatbot.js?v=20260923d').then(m => m.openChatbot());
  if (actie === 'tactiek'){
    if (!S.teamId){ const tid = laatsteTeamId(); if (tid) openTeam(tid); }
    return import('./tactiekbord.js?v=20260922c').then(m => m.openTactiekBibliotheek());
  }
  if (actie === 'speler'){ S._dkModus = null; S._profielTab = 'overzicht'; return gaNaarTab('spelers', { profiel: data.id }); }
  if (actie === 'selectie'){ S._dkModus = null; return gaNaarTab('spelers'); }
  if (actie === 'spev' || actie === 'sphis'){
    const eerste = [...S.spelers].sort((a, b) => (Number(a.nummer) || 99) - (Number(b.nummer) || 99))[0]?.id || null;
    S._dkModus = actie === 'spev' ? 'evaluatie' : null;
    if (actie === 'sphis') S._profielTab = 'historie';
    return gaNaarTab('spelers', { profiel: S._beoordeelProfiel || eerste });
  }
  if (actie === 'wedstrijd'){
    if (huidigeView() !== 'team' && huidigeView() !== 'wedstrijd') return;
    return import('./wedstrijd.js?v=20260923d').then(m => m.openWedstrijd(data.id));
  }
}

/* ---------- menu-inhoud (alleen bestaande tabbladen) ---------- */
function groepen(){
  const tid = S.teamId;
  const docsNieuw = tid ? (S.documenten || []).filter(d => (d.teams||[]).includes(tid) && !S.trainingenGelezen?.[d.id]).length : 0;
  const stofNieuw = tid ? (S.trainingen || []).filter(t => (t.teams||[]).includes(tid) && !S.trainingenGelezen?.[t.id]).length : 0;
  const evalOpen  = tid && S.team ? probeer(() => evaluatieOpen().length, 0) : 0;
  const g = [
    ['Team', [
      { tab:'hub',        ico:'navigation-dashboard',        naam:'Dashboard' },
      { tab:'berichten',  ico:'communication-announcement',  naam:'Berichten',  badge: probeer(ongelezenBerichten, 0) },
      { tab:'documenten', ico:'admin-document',              naam:'Documenten', badge: docsNieuw },
    ]],
    ['Wedstrijd', [
      { tab:'wedstrijden',   ico:'football-lineup',      naam:'Wedstrijden', live: !!S.wedstrijdId },
      { tab:'preswedstrijd', ico:'match-selection',      naam:'Aanwezigheid' },
      { tab:'poule',         ico:'football-competition', naam:'Poule' },
      ...(modAan('evaluaties') ? [{ tab:'evaluatie', ico:'attendance-evaluatie', naam:'Evaluatie', badge: evalOpen }] : []),
    ]],
    ['Training', [
      { tab:'presentietraining', ico:'attendance-present', naam:'Trainingen', badge: stofNieuw },
      { tab:'planning',          ico:'planning-calendar',  naam:'Planning' },
      /* [20260923a] Oefenstof zit op desktop in Trainingen; het tabblad blijft
         bereikbaar via zoeken (Ctrl K) en op de telefoon ongewijzigd. */
      { tab:'videos',            ico:'training-video',     naam:'Video\u2019s' },
      { actie:'tactiek',         ico:'football-tactics',   naam:'Tactiek' },
    ]],
    ['Spelers', [
      { actie:'selectie', ico:'team-members',         naam:'Selectie', tel: tid ? S.spelers.length : 0 },
      { actie:'spev',     ico:'attendance-evaluatie', naam:'Evaluatie' },
      { actie:'sphis',    ico:'attendance-overview',  naam:'Historie' },
      { tab:'stats',    ico:'stats-bars',          naam:'Stats' },
    ]],
  ];
  if (modAan('leerlijn')) g.push(['Ontwikkeling', [
    { tab:'leerlijnoverzicht', ico:'football-training', naam:'Leerlijn' },
  ]]);
  /* [20260923c] Bouw-omgeving als uitklapbare boom:
       club → bouw → Dashboard / Uitleningen / teams → Selectie, Evaluatie
       spelers, Evaluatie wedstrijden, Stats.
     Clubbeheerders zien alle bouwen van hun club(s); coördinatoren zonder
     beheerrecht alleen de bouw(en) die ze coördineren. Er staat telkens één
     bouw en één team open. */
  const beheer = [];
  const bouwItems = (clubId, bouwId, naam, kleur = null) => {
    const open = openBouwSleutel === clubId + '|' + bouwId;
    beheer.push({ actie:'bouwtoggle', club:clubId, bouw:bouwId, ico:'admin-roles', naam, sub:1, kleur, pijl: open ? '\u25be' : '\u25b8' });
    if (!open) return;
    beheer.push({ actie:'bpag', club:clubId, bouw:bouwId, pag:'dash', ico:'navigation-dashboard', naam:'Dashboard', sub:2 });
    beheer.push({ actie:'bpag', club:clubId, bouw:bouwId, pag:'uit', ico:'football-substitution', naam:'Uitleningen', sub:2 });
    const teams = bouwTeams(clubId, bouwId);
    if (!teams){ beheer.push({ actie:'niets', ico:'team-team', naam:'Teams laden\u2026', sub:2 }); return; }
    for (const t of teams){
      const topen = openBouwTeam === t.id;
      const eigen = (S.teams || []).some(x => x.id === t.id);
      beheer.push({ actie:'bteam', club:clubId, bouw:bouwId, team:t.id, ico:'team-team', naam: t.naam + (eigen ? ' \u2605' : ''), sub:2, pijl: topen ? '\u25be' : '\u25b8' });
      if (topen) for (const [pag, nm] of [['sel', 'Selectie'], ['evs', 'Evaluatie spelers'], ['evw', 'Evaluatie wedstrijden'], ['stat', 'Stats']])
        beheer.push({ actie:'bpag', club:clubId, bouw:bouwId, team:t.id, pag, ico:null, naam:nm, sub:3 });
    }
  };
  for (const c of S.clubs){
    beheer.push({ actie:'club', id:c.id, ico:'admin-admin', naam:c.naam });
    for (const b of BOUWEN) bouwItems(c.id, b.id, b.naam);
    /* [20260923d] eigen bouwen van de club (alleen beheerders) */
    for (const eb of (Array.isArray(c.eigenBouwen) ? c.eigenBouwen : [])) if (eb?.id) bouwItems(c.id, eb.id, eb.naam || 'Bouw', eb.kleur);
    beheer.push({ actie:'coordbeheer', id:c.id, ico:'team-members', naam:'Coördinatoren & bouwen', sub:1 });
  }
  for (const b of (S.coordinatorBouwen || []))
    if (!S.clubs.some(c => c.id === b.clubId)) bouwItems(b.clubId, b.bouw, b.bouwNaam + (b.clubNaam ? ' \u00b7 ' + b.clubNaam : ''));
  if (beheer.length) g.push(['Club \u00b7 beheer', beheer]);
  return g;
}
function sleutel(it){
  if (it.tab) return 'tab:' + it.tab;
  if (it.actie === 'bpag') return 'b:' + it.club + '|' + it.bouw + ':' + it.pag + ':' + (it.team || '');
  if (it.actie === 'club') return 'club:' + it.id;
  return 'actie:' + it.actie;
}
function actieveSleutel(){
  const v = huidigeView();
  if (v === 'wedstrijd') return 'tab:wedstrijden';
  if (v === 'team' && S.teamTab === 'spelers')
    return S._dkModus === 'evaluatie' ? 'actie:spev' : (S._beoordeelProfiel && S._profielTab === 'historie') ? 'actie:sphis' : 'actie:selectie';
  if (v === 'team' && S.teamTab === 'historie') return 'actie:sphis';
  if (v === 'team' && S.teamTab === 'trainingen') return 'tab:presentietraining';
  if (v === 'team')      return 'tab:' + (S.teamTab || 'hub');
  if (v === 'club')      return 'club:' + S.clubId;
  if (v === 'teams')     return 'overzicht';
  if (v === 'dkbouw'){ const h = bouwHuidig(); if (h) return 'b:' + h.clubId + '|' + h.bouw + ':' + h.scherm + ':' + (['dash', 'uit'].includes(h.scherm) ? '' : h.teamId || ''); }
  return '';
}
function dataAttr(it){
  if (it.tab) return `data-actie="tab" data-tab="${esc(it.tab)}"`;
  if (it.actie === 'club') return `data-actie="club" data-id="${esc(it.id)}"`;
  if (it.actie === 'bouw') return `data-actie="bouw" data-club="${esc(it.club)}" data-bouw="${esc(it.bouw)}"`;
  if (it.actie === 'coordbeheer') return `data-actie="coordbeheer" data-id="${esc(it.id)}"`;
  if (['bouwtoggle', 'bteam', 'bpag'].includes(it.actie))
    return `data-actie="${it.actie}" data-club="${esc(it.club)}" data-bouw="${esc(it.bouw)}"${it.team ? ` data-team="${esc(it.team)}"` : ''}${it.pag ? ` data-pag="${esc(it.pag)}"` : ''}`;
  return `data-actie="${esc(it.actie)}"`;
}
function linkHtml(it, actief){
  const extra = it.live ? '<span class="zb-live" title="Wedstrijd geopend"></span>'
    : it.badge ? `<span class="zb-badge">${it.badge}</span>`
    : it.tel ? `<span class="zb-tel">${it.tel}</span>` : '';
  const pijl = it.pijl ? `<span class="zb-pijltje">${it.pijl}</span>` : '';
  return `<button class="zb-link ${it.sub ? 'zb-sub zb-sub' + it.sub : ''} ${sleutel(it) === actief ? 'actief' : ''}" ${dataAttr(it)} title="${esc(it.naam)}">${it.ico ? (it.kleur ? `<span class="zb-ickleur" style="color:${esc(it.kleur)}">${ico(it.ico, it.sub > 1 ? 17 : 20)}</span>` : ico(it.ico, it.sub > 1 ? 17 : 20)) : '<span class="zb-stip-leeg"></span>'}<span class="zb-tekst">${esc(it.naam)}</span>${extra}${pijl}</button>`;
}

/* ---------- tekenen ---------- */
function teken(){
  gepland = false;
  if (!zij) return;
  const zichtbaar = mq?.matches && $('#app') && $('#app').style.display !== 'none';
  document.documentElement.classList.toggle('desk', !!zichtbaar);
  /* Wisselt het venster tussen smal en breed terwijl een team open staat,
     teken het team dan opnieuw zodat de juiste weergave (desktop of gewoon)
     verschijnt. */
  if (wasDesk !== null && wasDesk !== !!zichtbaar && S.team && huidigeView() === 'team'){ ruimOp(); renderTeam(); }
  wasDesk = !!zichtbaar;
  if (!zichtbaar) return;

  const actief = actieveSleutel();
  const team = S.team && S.teamId ? S.team : S.teams.find(t => t.id === laatsteTeamId());
  const upd = probeer(updatesInfo, { ongelezen:0 });
  const naam = coachNaam();
  const html = `
    <div class="zb-teamwrap">
      <button class="zb-team" data-actie="teamkeuze" title="Wissel van team">
        <img src="icons/asv-schild.png" alt="" class="zb-schild">
        <span class="zb-tekst"><b>${esc(team?.naam || 'Cluppie')}</b><small>${team ? esc([team.categorie, team.format ? team.format+' tegen '+team.format : ''].filter(Boolean).join(' \u00b7 ')) : 'Kies een team'}</small></span>
        <svg class="zb-pijl" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M8 9l4 4 4-4"/></svg>
      </button>
      <div class="zb-teamkeuze ${teamKeuzeOpen ? 'open' : ''}">
        ${S.teams.map(t => `<button data-actie="team" data-id="${esc(t.id)}" class="${t.id === S.teamId ? 'actief' : ''}">${esc(t.naam)}<span>${esc(t.format || '')}${t.format ? 'v'+esc(t.format) : ''}</span></button>`).join('')}
        <button data-actie="overzicht" class="zb-overzicht">Alle teams &amp; beheer<span>\u203a</span></button>
      </div>
    </div>
    <button class="zb-zoek" data-actie="zoek" title="Zoek of spring naar (Ctrl K)">${ico('navigation-search', 18)}<span class="zb-tekst">Zoek of spring naar\u2026</span><span class="zb-kbd">Ctrl K</span></button>
    <nav class="zb-nav" aria-label="Hoofdmenu">
      ${groepen().map(([kop, items]) => `<div class="zb-groep"><div class="zb-kop"><span>${esc(kop)}</span></div>${items.map(it => linkHtml(it, actief)).join('')}</div>`).join('')}
    </nav>
    <div class="zb-voet">
      <div class="zb-iconen">
        <button class="zb-ic ${actief === 'tab:updates' ? 'actief' : ''}" data-actie="tab" data-tab="updates" title="Wat is er nieuw">${ico('communication-push', 20)}${upd.ongelezen ? '<i class="zb-stip"></i>' : ''}</button>
        <button class="zb-ic" data-actie="chat" title="Hulpchat">${ico('communication-chat', 20)}</button>
        <button class="zb-ic ${actief === 'tab:help' ? 'actief' : ''}" data-actie="tab" data-tab="help" title="Help">${ico('navigation-help', 20)}</button>
        <button class="zb-ic ${actief === 'tab:instellingen' ? 'actief' : ''}" data-actie="tab" data-tab="instellingen" title="Instellingen">${ico('navigation-settings', 20)}</button>
      </div>
      <div class="zb-ik">
        <span class="zb-avatar">${esc(naam.charAt(0))}</span>
        <span class="zb-tekst"><b>${esc(naam)}</b><small>${rolNaam()}</small></span>
        <button class="zb-ic zb-inklap" data-actie="inklap" title="${document.documentElement.classList.contains('zij-klein') ? 'Zijbalk uitklappen' : 'Zijbalk inklappen'}">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="20" height="20"><path d="M15 6l-6 6 6 6"/></svg></button>
      </div>
    </div>`;
  if (html === laatsteHtml) return;         // niets veranderd → DOM met rust laten
  laatsteHtml = html;
  const scroll = zij.querySelector('.zb-nav')?.scrollTop || 0;
  zij.innerHTML = html;
  const nav = zij.querySelector('.zb-nav'); if (nav) nav.scrollTop = scroll;
}
function plan(){ if (!gepland){ gepland = true; requestAnimationFrame(teken); } }

function klik(e){
  const b = e.target.closest('[data-actie]'); if (!b) return;
  const a = b.dataset.actie;
  if (a === 'teamkeuze'){ teamKeuzeOpen = !teamKeuzeOpen; plan(); return; }
  if (a === 'zoek'){ openPalet(); return; }
  if (a === 'inklap'){
    const klein = document.documentElement.classList.toggle('zij-klein');
    try { localStorage.setItem(K_KLEIN, klein ? '1' : ''); } catch(e){}
    teamKeuzeOpen = false; plan(); return;
  }
  teamKeuzeOpen = false;
  voerActieUit(a, { ...b.dataset });
  plan();
}

/* ---------- zoek-alles (Ctrl K of /) ---------- */
let palSel = 0, palZicht = [];
function palItems(){
  const uit = [];
  for (const [kop, items] of groepen()) for (const it of items)
    uit.push({ groep:'Pagina\u2019s', ico:it.ico, naam:it.naam, sub:kop, actie: it.tab ? 'tab' : it.actie, data:{ tab:it.tab, id:it.id, club:it.club, bouw:it.bouw } });
  uit.push({ groep:'Pagina\u2019s', ico:'communication-push', naam:'Wat is er nieuw', sub:'Updates', actie:'tab', data:{ tab:'updates' } });
  uit.push({ groep:'Pagina\u2019s', ico:'navigation-settings', naam:'Instellingen', sub:'Team', actie:'tab', data:{ tab:'instellingen' } });
  uit.push({ groep:'Pagina\u2019s', ico:'training-cones', naam:'Oefenstof (alle)', sub:'Training', actie:'tab', data:{ tab:'trainingen' } });
  uit.push({ groep:'Pagina\u2019s', ico:'navigation-help', naam:'Help en handleiding', sub:'', actie:'tab', data:{ tab:'help' } });
  if (S.teams.length > 1) for (const t of S.teams)
    uit.push({ groep:'Teams', ico:'team-team', naam:t.naam, sub: t.id === S.teamId ? 'huidig team' : '', actie:'team', data:{ id:t.id } });
  if (S.teamId){
    for (const p of S.spelers)
      uit.push({ groep:'Spelers', ico:'team-player', naam:p.naam || '', sub: p.nummer != null && p.nummer !== '' ? '#'+p.nummer : '', actie:'speler', data:{ id:p.id } });
    const nu = new Date().toISOString().slice(0,10);
    const wed = [...S.wedstrijden].sort((a,b) => Math.abs(Date.parse(a.datum||nu) - Date.parse(nu)) - Math.abs(Date.parse(b.datum||nu) - Date.parse(nu))).slice(0, 12);
    for (const w of wed)
      uit.push({ groep:'Wedstrijden', ico:'football-match', naam:(w.thuis === false ? 'uit bij ' : 'thuis tegen ') + (w.tegenstander || 'tegenstander'), sub: w.datum ? probeer(() => new Date(w.datum+'T12:00').toLocaleDateString('nl-NL',{day:'numeric',month:'short'}), w.datum) : '', actie:'wedstrijd', data:{ id:w.id } });
  }
  return uit;
}
function tekenPalet(){
  const q = pal.querySelector('input').value.trim().toLowerCase();
  let items = palItems();
  items = q ? items.filter(i => (i.naam + ' ' + i.sub + ' ' + i.groep).toLowerCase().includes(q))
            : items.filter(i => i.groep === 'Pagina\u2019s' || i.groep === 'Teams');
  palZicht = items.slice(0, 40);
  if (palSel >= palZicht.length) palSel = 0;
  let h = '', g = '';
  palZicht.forEach((it, i) => {
    if (it.groep !== g){ g = it.groep; h += `<div class="zp-kop">${esc(g)}</div>`; }
    h += `<button class="zp-item ${i === palSel ? 'sel' : ''}" data-i="${i}">${ico(it.ico, 18)}<span>${esc(it.naam)}</span><small>${esc(it.sub || '')}</small></button>`;
  });
  pal.querySelector('.zp-lijst').innerHTML = h || '<p class="zp-leeg">Niets gevonden. Probeer een spelersnaam, een tegenstander of \u201ctraining\u201d.</p>';
  pal.querySelector('.zp-item.sel')?.scrollIntoView({ block:'nearest' });
}
function openPalet(){
  if (!pal){
    pal = document.createElement('div');
    pal.className = 'zp-achter';
    pal.innerHTML = `<div class="zp" role="dialog" aria-label="Zoek of spring naar">
      <div class="zp-in">${ico('navigation-search', 20)}<input type="text" placeholder="Typ een speler, wedstrijd of pagina\u2026" autocomplete="off" spellcheck="false"><span class="zb-kbd">Esc</span></div>
      <div class="zp-lijst"></div>
      <div class="zp-voet"><span>\u2191\u2193 kiezen</span><span>\u21b5 openen</span><span>Esc sluiten</span></div></div>`;
    document.body.appendChild(pal);
    const inp = pal.querySelector('input');
    pal.addEventListener('mousedown', e => { if (e.target === pal) sluitPalet(); });
    pal.querySelector('.zp-lijst').addEventListener('click', e => { const b = e.target.closest('.zp-item'); if (b) kiesPalet(+b.dataset.i); });
    inp.addEventListener('input', () => { palSel = 0; tekenPalet(); });
    inp.addEventListener('keydown', e => {
      if (e.key === 'ArrowDown'){ palSel = Math.min(palSel + 1, palZicht.length - 1); tekenPalet(); e.preventDefault(); }
      else if (e.key === 'ArrowUp'){ palSel = Math.max(palSel - 1, 0); tekenPalet(); e.preventDefault(); }
      else if (e.key === 'Enter'){ kiesPalet(palSel); e.preventDefault(); }
      else if (e.key === 'Escape'){ sluitPalet(); e.preventDefault(); }
    });
  }
  pal.querySelector('input').value = ''; palSel = 0;
  pal.classList.add('open'); tekenPalet();
  setTimeout(() => pal.querySelector('input').focus(), 20);
  telNav('desk:zoek', 'open');
}
function sluitPalet(){ pal?.classList.remove('open'); }
function kiesPalet(i){
  const it = palZicht[i]; if (!it) return;
  sluitPalet();
  voerActieUit(it.actie, it.data);
}
function sneltoets(e){
  if (!document.documentElement.classList.contains('desk')) return;
  const doel = e.target, typt = doel && (doel.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(doel.tagName));
  if ((e.ctrlKey || e.metaKey) && !e.altKey && e.key.toLowerCase() === 'k'){ e.preventDefault(); openPalet(); return; }
  if (e.key === '/' && !typt && !e.ctrlKey && !e.metaKey && !e.altKey){ e.preventDefault(); openPalet(); }
}

/* ---------- opstart ---------- */
export function initDesktop(mediaQuery){
  mq = mediaQuery;
  if (zij){ plan(); return; }                      // al actief: alleen bijwerken
  initSchermen();
  if (probeer(() => localStorage.getItem(K_KLEIN), '') === '1') document.documentElement.classList.add('zij-klein');
  zij = document.createElement('aside');
  zij.id = 'zijbalk';
  zij.setAttribute('aria-label', 'Navigatie');
  zij.addEventListener('click', klik);
  document.body.appendChild(zij);
  document.addEventListener('keydown', sneltoets);
  document.addEventListener('click', e => { if (teamKeuzeOpen && !e.target.closest('.zb-teamwrap')){ teamKeuzeOpen = false; plan(); } });
  const app = $('#app');
  if (app) new MutationObserver(plan).observe(app, { subtree:true, childList:true, attributes:true, attributeFilter:['class','style'] });
  mq.addEventListener?.('change', plan);
  zetHerteken((soort, id) => {
    if (soort === 'eigen'){ naarBouwPag(null, null, id, 'sel'); return; }
    plan();
  });
  teken();
  /* Stond er al een team open vóór deze module laadde (trage verbinding),
     teken het dan opnieuw in de desktopweergave. */
  if (S.team && huidigeView() === 'team' && document.documentElement.classList.contains('desk')) renderTeam();
}
