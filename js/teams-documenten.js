/* ==================== DOCUMENTEN (teams.js-split) ====================
   Onderdeel van de teams.js-modulaire split. Leesweergave voor een team van
   club-brede documenten (beleid, formulieren, overig) — het uploaden en
   toewijzen aan teams gebeurt door de clubbeheerder op het clubscherm
   (zie club.js: htmlClubDocumenten / modalNieuweDocument).

   Zelfde opzet als video's: een simpele, platte lijst. Categorieën krijgen
   een eigen icoonkleur zodat je in één oogopslag ziet wat voor document het
   is, zonder dat er per se een aparte filter-UI nodig is (een team heeft
   doorgaans maar een handvol documenten, dus segment-tabs zoals op het
   clubscherm zijn hier niet nodig). */
import { S, esc } from './state.js';

const CATEGORIE_ICOON = { beleid: 'PDF', formulier: 'FRM', overig: 'DOC' };
const CATEGORIE_KLASSE = { beleid: '', formulier: 'formulier', overig: 'overig' };
const CATEGORIE_NAAM = { beleid: 'Beleid', formulier: 'Formulier', overig: 'Overig' };

export function htmlTeamDocumenten(){
  const lijst = S.documenten.filter(d => (d.teams||[]).includes(S.teamId));
  if (!lijst.length){
    return `<div class="kaart leeg">Nog geen documenten voor dit team.<br>Je clubadmin kan hier beleidsstukken, formulieren en ander leesmateriaal delen.</div>`;
  }
  const gesorteerd = [...lijst].sort((a,b) => (b.gemaakt?.seconds||0) - (a.gemaakt?.seconds||0));
  return gesorteerd.map(d => {
    const ongelezen = !S.trainingenGelezen[d.id];   // gedeelde "gelezen"-set met trainingen (zie teams.js)
    const datum = d.gemaakt?.seconds ? new Date(d.gemaakt.seconds*1000).toLocaleDateString('nl-NL',{day:'numeric',month:'short'}) : '';
    const cat = CATEGORIE_NAAM[d.categorie] || 'Overig';
    return `
      <div class="training-rij ${ongelezen?'ongelezen':''}" data-open-document="${d.id}" data-url="${esc(d.url)}" style="cursor:pointer">
        <div class="ico ${CATEGORIE_KLASSE[d.categorie]||''}">${CATEGORIE_ICOON[d.categorie]||'DOC'}</div>
        <div class="t"><div class="t-titel">${esc(d.titel || d.bestandsnaam)}</div>
          <div class="t-meta">${esc(cat)}${datum?' · '+esc(datum):''}</div></div>
        <div class="acties"><button title="Openen">↗</button></div>
      </div>`;
  }).join('');
}
