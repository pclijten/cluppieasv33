/* ==================== BERICHTEN (clubadmin → teams) ====================
   Clubadmin plaatst een bericht voor één of meer teams (toewijzing exact zoals
   bij trainingen: een `teams: [...]`-array). Coaches zien actieve berichten als
   een balk boven het teamscherm, met een ✕ om ze per apparaat weg te klikken.
   Alle berichten (actief + verlopen) zijn terug te lezen via de tegel.

   Firestore: top-level collectie `berichten`, document:
     { club, clubNaam, titel, body, teams:[teamId,...],
       gemaakt: serverTimestamp(), zichtbaarTot: <ms epoch> | null }
   zichtbaarTot === null betekent "tot de admin het verwijdert".

   Weggeklikt wordt lokaal onthouden in localStorage onder 'cluppie_bericht_weg'. */

import { S, esc, datumNL } from './state.js?v=20260819c';
import { ico } from './icons.js?v=20260818e';

const WEG_KEY = 'cluppie_bericht_weg';

function weggeklikt(){
  try { return new Set(JSON.parse(localStorage.getItem(WEG_KEY) || '[]')); }
  catch { return new Set(); }
}
function markeerWeg(id){
  const s = weggeklikt(); s.add(id);
  try { localStorage.setItem(WEG_KEY, JSON.stringify([...s])); } catch {}
}

/* Bericht hoort bij het huidige team (als er één open is) of bij één van de
   teams van de coach (op het overzichtsscherm). */
function relevantVoorMij(b){
  if (S.teamId) return (b.teams || []).includes(S.teamId);
  const mijn = new Set((S.teams || []).map(t => t.id));
  return (b.teams || []).some(tid => mijn.has(tid));
}

/* Alle berichten voor het huidige team, nieuwste eerst. */
export function berichtenVoorTeam(){
  const nu = Date.now();
  return (S.berichten || [])
    .filter(relevantVoorMij)
    .map(b => ({ ...b, verlopen: b.zichtbaarTot != null && b.zichtbaarTot < nu }))
    .sort((a,b) => (b.gemaakt?.seconds || 0) - (a.gemaakt?.seconds || 0));
}

/* Actieve, niet-weggeklikte berichten — voor de balk. */
export function actieveBerichten(){
  const weg = weggeklikt();
  return berichtenVoorTeam().filter(b => !b.verlopen && !weg.has(b.id));
}

/* Aantal ongelezen (= actief en niet weggeklikt), voor het tegel-badge. */
export function ongelezenBerichten(){
  return actieveBerichten().length;
}

/* HTML voor de berichtenbalk(en) boven het teamscherm. Leeg als er niets is. */
export function htmlBerichtBalk(){
  const lijst = actieveBerichten();
  if (!lijst.length) return '';
  return lijst.map(b => {
    const rest = restTekst(b.zichtbaarTot);
    return `
    <div class="bericht-balk" data-bericht="${b.id}">
      <div class="bericht-ico">${ico('communication-announcement',18)}</div>
      <div class="bericht-tekst">
        <div class="bericht-titel">${esc(b.titel)}</div>
        <div class="bericht-body">${esc(b.body || '')}</div>
        <div class="bericht-meta">Van ${esc(b.clubNaam || 'clubadmin')} · ${datumNL(b.gemaakt)}${rest ? ' · ' + rest : ''}</div>
      </div>
      <button class="bericht-x" data-bericht-weg="${b.id}" title="Wegklikken">✕</button>
    </div>`;
  }).join('');
}

/* Koppel de ✕-knoppen. `herteken` wordt aangeroepen na wegklikken. */
export function koppelBerichtBalk(root, herteken){
  root.querySelectorAll('[data-bericht-weg]').forEach(b => b.onclick = () => {
    markeerWeg(b.dataset.berichtWeg);
    herteken();
  });
}

/* HTML voor het berichten-archief (tegel-inhoud): alle berichten, actief + verlopen. */
export function htmlBerichtenArchief(){
  const lijst = berichtenVoorTeam();
  if (!lijst.length){
    return `<div class="kaart leeg">Nog geen berichten voor dit team.</div>`;
  }
  return lijst.map(b => `
    <div class="arch-item ${b.verlopen ? 'arch-verlopen' : ''}">
      <div class="arch-kop">
        <span class="arch-titel">${esc(b.titel)}</span>
        <span class="arch-badge ${b.verlopen ? 'weg' : ''}">${b.verlopen ? 'Verlopen' : 'Actief'}</span>
      </div>
      <div class="arch-datum">${datumNL(b.gemaakt)} · ${esc(b.clubNaam || 'clubadmin')}</div>
      <div class="arch-body">${esc(b.body || '')}</div>
    </div>`).join('');
}

/* "nog X dagen zichtbaar" / "nog vandaag" / "" (bij geen einddatum). */
function restTekst(zichtbaarTot){
  if (zichtbaarTot == null) return '';
  const restMs = zichtbaarTot - Date.now();
  if (restMs <= 0) return '';
  const dagen = Math.ceil(restMs / 86400000);
  if (dagen <= 1) return 'nog vandaag zichtbaar';
  return `nog ${dagen} dagen zichtbaar`;
}
