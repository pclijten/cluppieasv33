/* ==================== TRAININGSMOMENTEN ====================
   Per team: op welke dag EN welk tijdstip (begin + eigen eindtijd) er getraind wordt.

   Bewust een eigen, klein bestand — niet toegevoegd aan state.js, want elke
   state.js-wijziging triggert een dure transitieve versie-bump.

   Datamodel (Firestore: teams/{id}):
     trainingsmomenten: [{ dag: 1..7, start: 'HH:MM', eind: 'HH:MM' }, …]   ← nieuw
     trainingsdagen:    [1..7] oplopend                                      ← bestaand

   `trainingsdagen` blijft ALTIJD gelijk aan de unieke, oplopende dagen uit
   `trainingsmomenten`. Zo blijft alle bestaande code (presentie, planning,
   Oefenstof "training 1 op de eerste dag", Vaste afmelding, desktop) werken
   zonder dat die bestanden hoeven te veranderen. Een team met alleen
   `trainingsdagen` (nog zonder tijden) toont zijn dagen met lege tijdvelden
   en kan ze hier aanvullen.

   Per dag maximaal één moment (training 1 → eerste dag, training 2 → tweede). */
import { db, doc, updateDoc } from './firebase.js?v=20261106m';
import { S, esc, meld } from './state.js?v=20261106m';
import { ico } from './icons.js?v=20261106m';

export const DAGEN_LANG = ['Maandag','Dinsdag','Woensdag','Donderdag','Vrijdag','Zaterdag','Zondag'];
export const DAGEN_KORT = ['ma','di','wo','do','vr','za','zo'];

const TIJD_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
export const isTijd = s => TIJD_RE.test(String(s || ''));

/* Normaliseer: altijd een oplopende lijst {dag,start,eind}. Valt terug op de
   losse trainingsdagen (zonder tijden) voor teams van vóór deze functie. */
export function momentenVanTeam(t){
  const rij = Array.isArray(t?.trainingsmomenten) ? t.trainingsmomenten : null;
  if (rij && rij.length){
    return rij
      .map(m => ({ dag: Number(m.dag), start: isTijd(m.start) ? m.start : '', eind: isTijd(m.eind) ? m.eind : '' }))
      .filter(m => m.dag >= 1 && m.dag <= 7)
      .sort((a, b) => a.dag - b.dag);
  }
  const dagen = Array.isArray(t?.trainingsdagen) ? t.trainingsdagen : [];
  return [...new Set(dagen.map(Number))].filter(d => d >= 1 && d <= 7).sort((a, b) => a - b)
    .map(dag => ({ dag, start: '', eind: '' }));
}

/* '18:30–19:45', of leeg als er (nog) geen tijden zijn. */
export function tijdTekst(m){
  return m && m.start && m.eind ? `${m.start}–${m.eind}` : (m && m.start ? `${m.start}` : '');
}

/* Optelling in minuten voor de standaard eindtijd (75 min na begin). */
function plusMin(tijd, min){
  if (!isTijd(tijd)) return '';
  const [u, m] = tijd.split(':').map(Number);
  const tot = Math.min(23 * 60 + 59, u * 60 + m + min);
  return String(Math.floor(tot / 60)).padStart(2, '0') + ':' + String(tot % 60).padStart(2, '0');
}
const naarMin = tijd => { const [u, m] = tijd.split(':').map(Number); return u * 60 + m; };

/* Concept dat de beheerder aan het bewerken is, per team (blijft staan bij herteken). */
function concept(t){
  if (!S._cbMomenten || S._cbMomenten.teamId !== t.id){
    S._cbMomenten = { teamId: t.id, lijst: momentenVanTeam(t).map(m => ({ ...m })), gewijzigd: false };
  }
  return S._cbMomenten;
}

/* Foutmelding of null. Alleen voor opslaan. */
export function valideerMomenten(lijst){
  const gezien = new Set();
  for (const m of lijst){
    if (!(m.dag >= 1 && m.dag <= 7)) return 'Kies bij elk moment een dag.';
    if (gezien.has(m.dag)) return `${DAGEN_LANG[m.dag - 1]} staat er twee keer in. Per dag kan één trainingsmoment.`;
    gezien.add(m.dag);
    if (!isTijd(m.start)) return `Vul de begintijd in voor ${DAGEN_LANG[m.dag - 1].toLowerCase()}.`;
    if (!isTijd(m.eind)) return `Vul de eindtijd in voor ${DAGEN_LANG[m.dag - 1].toLowerCase()}.`;
    if (naarMin(m.eind) <= naarMin(m.start)) return `De eindtijd van ${DAGEN_LANG[m.dag - 1].toLowerCase()} moet na de begintijd liggen.`;
  }
  return null;
}

/* ---------- kaart in het teambeheer (vervangt de losse dag-knoppen) ---------- */
export function htmlMomentenKaart(t){
  const c = concept(t);
  const rijen = c.lijst.map((m, i) => `
    <div class="tmo-rij" data-tmo-rij="${i}">
      <select class="invoer tmo-dag" data-tmo-dag="${i}" aria-label="Dag">
        ${DAGEN_LANG.map((n, k) => `<option value="${k + 1}" ${m.dag === k + 1 ? 'selected' : ''}>${n}</option>`).join('')}
      </select>
      <input class="invoer tmo-tijd" type="time" step="300" value="${esc(m.start)}" data-tmo-start="${i}" aria-label="Begintijd ${DAGEN_LANG[m.dag - 1] || ''}">
      <span class="tmo-tot">tot</span>
      <input class="invoer tmo-tijd" type="time" step="300" value="${esc(m.eind)}" data-tmo-eind="${i}" aria-label="Eindtijd ${DAGEN_LANG[m.dag - 1] || ''}">
      <button type="button" class="tmo-weg" data-tmo-weg="${i}" aria-label="Moment verwijderen">✕</button>
    </div>`).join('');
  const ontbreekt = c.lijst.some(m => !m.start || !m.eind);
  return `
    <div class="cb-kaart" id="cbMomentenKaart">
      <div class="cb-kaart-kop">${ico('planning-calendar', 18)}<b>Trainingsmomenten</b></div>
      ${c.lijst.length ? `<div class="tmo-lijst">${rijen}</div>` : '<p class="cb-uitleg u-mt-0">Nog geen vaste momenten. Oefenstof krijgt dan geen dag.</p>'}
      ${ontbreekt && !c.gewijzigd ? '<p class="cb-uitleg tmo-let">Voor deze dagen ontbreekt nog een tijd. Vul begin- en eindtijd in en tik Opslaan.</p>' : ''}
      <div class="cb-acties" style="margin:var(--space-sm) 0 0">
        <button type="button" class="knop licht klein" id="tmoToevoegen">${ico('action-add', 15)} Moment toevoegen</button>
        <button type="button" class="knop klein" id="tmoOpslaan" ${c.gewijzigd || ontbreekt ? '' : 'disabled'}>Opslaan</button>
      </div>
      <p class="cb-uitleg">Training 1 valt op het eerste moment van de week, training 2 op het tweede. Coaches en de trainingscoördinator zien dit direct. Coaches kunnen dit niet zelf wijzigen.</p>
    </div>`;
}

/* api: { herteken() } — zelfde api als koppelTeamBeheer */
export function koppelMomentenKaart(v, t, api){
  const kaart = v.querySelector('#cbMomentenKaart'); if (!kaart) return;
  const c = concept(t);
  const markeer = () => {
    c.gewijzigd = true;
    const knop = kaart.querySelector('#tmoOpslaan'); if (knop) knop.disabled = false;
    kaart.querySelector('.tmo-let')?.remove();
  };
  kaart.querySelectorAll('[data-tmo-dag]').forEach(el => el.onchange = () => { c.lijst[+el.dataset.tmoDag].dag = Number(el.value); markeer(); });
  kaart.querySelectorAll('[data-tmo-start]').forEach(el => el.onchange = () => {
    const m = c.lijst[+el.dataset.tmoStart];
    const oud = m.start; m.start = el.value;
    /* Eindtijd is altijd zelf in te vullen. Is hij nog leeg of liep hij precies
       mee met de oude begintijd (standaard 75 min), dan schuift hij mee. */
    const eindEl = kaart.querySelector(`[data-tmo-eind="${el.dataset.tmoStart}"]`);
    if (isTijd(m.start) && (!m.eind || (isTijd(oud) && m.eind === plusMin(oud, 75)))){
      m.eind = plusMin(m.start, 75); if (eindEl) eindEl.value = m.eind;
    }
    markeer();
  });
  kaart.querySelectorAll('[data-tmo-eind]').forEach(el => el.onchange = () => { c.lijst[+el.dataset.tmoEind].eind = el.value; markeer(); });
  kaart.querySelectorAll('[data-tmo-weg]').forEach(el => el.onclick = () => { c.lijst.splice(+el.dataset.tmoWeg, 1); c.gewijzigd = true; api.herteken(); });
  kaart.querySelector('#tmoToevoegen').onclick = () => {
    const bezet = new Set(c.lijst.map(m => m.dag));
    const dag = [1, 2, 3, 4, 5, 6, 7].find(d => !bezet.has(d));
    if (!dag) return meld('Alle dagen van de week zijn al gekozen');
    c.lijst.push({ dag, start: '18:00', eind: plusMin('18:00', 75) }); c.gewijzigd = true; api.herteken();
  };
  kaart.querySelector('#tmoOpslaan').onclick = async () => {
    const fout = valideerMomenten(c.lijst);
    if (fout) return meld(fout);
    const lijst = c.lijst.map(m => ({ dag: m.dag, start: m.start, eind: m.eind })).sort((a, b) => a.dag - b.dag);
    const dagen = lijst.map(m => m.dag);
    const knop = kaart.querySelector('#tmoOpslaan'); knop.disabled = true;
    try {
      await updateDoc(doc(db, 'teams', t.id), { trainingsmomenten: lijst, trainingsdagen: dagen });
      t.trainingsmomenten = lijst; t.trainingsdagen = dagen;
      S._cbMomenten = null;
      meld('Trainingsmomenten opgeslagen');
      api.herteken();
    } catch(e){
      knop.disabled = false;
      meld('Opslaan mislukt: ' + (e.code || e.message));
    }
  };
}
