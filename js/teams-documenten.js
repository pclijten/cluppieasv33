/* ==================== DOCUMENTEN (teams.js-split) ====================
   Onderdeel van de teams.js-modulaire split. Leesweergave voor een team van
   club-brede documenten (KNVB, beleid, overig) — het uploaden en toewijzen
   aan teams gebeurt door de clubbeheerder op het clubscherm
   (zie club.js: htmlClubDocumenten / modalNieuwDocument).

   Gegroepeerd onder kopjes per categorie (zelfde volgorde en namen als het
   clubscherm: KNVB · Beleid · Overig) — geen aparte filter-UI nodig, een
   team heeft doorgaans maar een handvol documenten per categorie. */
import { S, esc } from './state.js?v=20260719';

const CATEGORIE_ICOON = { beleid: 'PDF', knvb: 'KNVB', overig: 'DOC' };
const CATEGORIE_KLASSE = { beleid: '', knvb: 'knvb', overig: 'overig' };
const CATEGORIE_VOLGORDE = [
  { id: 'knvb',   naam: 'KNVB' },
  { id: 'beleid', naam: 'Beleid' },
  { id: 'overig', naam: 'Overig' },
];

function docRij(d){
  const ongelezen = !S.trainingenGelezen[d.id];   // gedeelde "gelezen"-set met trainingen (zie teams.js)
  const datum = d.gemaakt?.seconds ? new Date(d.gemaakt.seconds*1000).toLocaleDateString('nl-NL',{day:'numeric',month:'short'}) : '';
  return `
    <div class="training-rij ${ongelezen?'ongelezen':''}" data-open-document="${d.id}" data-url="${esc(d.url)}" style="cursor:pointer">
      <div class="ico ${CATEGORIE_KLASSE[d.categorie]||''}">${CATEGORIE_ICOON[d.categorie]||'DOC'}</div>
      <div class="t"><div class="t-titel">${esc(d.titel || d.bestandsnaam)}</div>
        <div class="t-meta">${datum?esc(datum):''}</div></div>
      <div class="acties"><button title="Openen">↗</button></div>
    </div>`;
}

export function htmlTeamDocumenten(){
  const lijst = S.documenten.filter(d => (d.teams||[]).includes(S.teamId));
  if (!lijst.length){
    return `<div class="kaart leeg">Nog geen documenten voor dit team.<br>Je clubadmin kan hier beleidsstukken, KNVB-stukken en ander leesmateriaal delen.</div>`;
  }
  return CATEGORIE_VOLGORDE.map(({id, naam}) => {
    const groep = lijst.filter(d => (d.categorie || 'overig') === id)
      .sort((a,b) => (b.gemaakt?.seconds||0) - (a.gemaakt?.seconds||0));
    if (!groep.length) return '';
    return `<div class="sectie-kop">${naam}</div>${groep.map(docRij).join('')}`;
  }).join('');
}
