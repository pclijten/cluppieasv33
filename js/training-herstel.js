/* ==================== TRAINING-HERSTEL (plaatjes) ====================
   Eenmalig herstel voor trainingen die elkaars plaatjes kregen.

   Achtergrond: tot 23-10-2026 was de opslagmap van een upload alleen
   Date.now(). De uploadwachtrij verwerkt drie trainingen tegelijk, dus twee
   trainingen konden dezelfde map delen en elkaars diagram1…n.png overschrijven.
   De PDF's bleven goed (eigen bestandsnaam), alleen de plaatjes klopten niet.

   Aanpak: zoek trainingen waarvan de diagrammen in dezelfde map staan, haal van
   elk de EIGEN originele PDF op, maak de plaatjes opnieuw (zelfde code als bij
   een gewone upload) en zet ze in een nieuwe, unieke map. Daarna wijst alleen
   `diagramUrls` van die training naar de nieuwe plaatjes. PDF, tekst, oefeningen,
   video's en alle andere velden blijven onaangeroerd. Alleen voor beheerders.

   Eén training na de andere (zwaar werk voor de browser), met voortgang. */

import { db, doc, updateDoc } from './firebase.js?v=20260922c';

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));

const naamVan = t => t.titel || t.bestandsnaam || 'Training';

/* De map waarin de diagrammen van deze training staan, uit de download-URL
   (…/o/clubs%2F{club}%2Ftrainingen%2F{map}%2Fdiagram1.png?…). */
function diagramMap(t){
  for (const u of Object.values(t.diagramUrls || {})){
    if (!u) continue;
    let pad = String(u);
    try { pad = decodeURIComponent(pad); } catch(e){}
    const m = pad.match(/\/trainingen\/([^/?]+)\/diagram\d+/);
    if (m) return m[1];
  }
  return null;
}

/* Alle trainingen die hun diagrammenmap met minstens één andere training delen. */
export function getroffenTrainingen(trainingen){
  const perMap = new Map();
  for (const t of trainingen || []){
    const map = diagramMap(t);
    if (!map) continue;
    if (!perMap.has(map)) perMap.set(map, []);
    perMap.get(map).push(t);
  }
  return [...perMap.values()].filter(g => g.length > 1).flat();
}

export function htmlDiagramHerstel(trainingen, isBeheerder){
  if (!isBeheerder) return '';
  const getroffen = getroffenTrainingen(trainingen);
  if (!getroffen.length) return '';
  const items = getroffen.map(t =>
    `<li>${esc(naamVan(t))}${t.week ? ` <span style="opacity:.65">· ${esc(t.week)}</span>` : ''}</li>`).join('');
  return `
    <div class="kaart" id="dhKaart">
      <b>Plaatjes herstellen</b>
      <p style="margin:6px 0 8px">${getroffen.length} trainingen delen hun plaatjes met een andere training (een uploadfout van vóór 23 oktober). Daardoor staan er soms plaatjes van een andere training bij. Met deze knop worden de plaatjes opnieuw uit de originele PDF van elke training gemaakt. PDF, tekst en video's blijven zoals ze zijn.</p>
      <ul style="margin:0 0 10px;padding-left:20px">${items}</ul>
      <button class="knop vol" id="dhStart">Herstel ${getroffen.length} trainingen</button>
      <div id="dhVoortgang" style="margin-top:10px" aria-live="polite"></div>
    </div>`;
}

/* Eén training herstellen. Gooit een fout als er iets niet lukt; de oude
   diagramUrls blijven dan gewoon staan (er wordt pas geschreven na de upload). */
async function herstelEen(t, ai, clubId){
  if (!t.url) throw new Error('geen PDF-link bij deze training');
  const resp = await fetch(t.url);
  if (!resp.ok) throw new Error('PDF ophalen mislukt (' + resp.status + ')');
  const blob = await resp.blob();
  const file = new File([blob], t.bestandsnaam || 'training.pdf', { type: 'application/pdf' });

  const { diagramBlobs } = await ai.leesPdf(file);
  if (!diagramBlobs.length) throw new Error('geen plaatjes in de PDF gevonden');

  const mapId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const urls = await ai.uploadDiagrammen(clubId, mapId, diagramBlobs);
  if (!Object.keys(urls).length) throw new Error('plaatjes uploaden mislukt');

  await updateDoc(doc(db, 'trainingen', t.id), { diagramUrls: urls });
  t.diagramUrls = urls;   // lokale kopie bijwerken, zodat de kaart verdwijnt
  return { diagrammen: Object.keys(urls).length, oefeningen: (t.oefeningen || []).length };
}

export function koppelDiagramHerstel(v, trainingen, api){
  const knop = v.querySelector('#dhStart');
  if (!knop) return;
  let bezig = false;
  // Vaste lijst op het moment dat de kaart getekend is. Hersteld = eruit; wat mislukt
  // blijft staan voor "Opnieuw proberen", ook als de partner-training al hersteld is
  // (dan deelt hij zijn map niet meer en zou hij anders niet meer opgespoord worden).
  const rest = getroffenTrainingen(trainingen);

  knop.onclick = async () => {
    if (bezig) return;
    const lijst = rest.slice();
    if (!lijst.length) return;
    if (!confirm(`${lijst.length} trainingen krijgen opnieuw gemaakte plaatjes uit hun eigen PDF. Dit kan een paar minuten duren; houd deze pagina open. Doorgaan?`)) return;

    bezig = true;
    knop.disabled = true;
    const uit = v.querySelector('#dhVoortgang');
    const toon = tekst => { if (uit) uit.textContent = tekst; };

    let ai;
    try { ai = await import('./training-ai.js?v=20261023a'); }
    catch(e){
      console.error('[herstel] training-ai laden mislukt', e);
      toon('Laden mislukt. Ververs de pagina en probeer het opnieuw.');
      bezig = false; knop.disabled = false;
      return;
    }

    let ok = 0;
    const fouten = [], controleren = [];
    for (let i = 0; i < lijst.length; i++){
      const t = lijst[i];
      toon(`Bezig: ${i + 1} van ${lijst.length} — ${naamVan(t)}…`);
      try {
        const r = await herstelEen(t, ai, api.clubId);
        ok++;
        rest.splice(rest.indexOf(t), 1);
        if (r.diagrammen !== r.oefeningen)
          controleren.push(`${naamVan(t)} (${r.diagrammen} plaatjes, ${r.oefeningen} oefeningen)`);
      } catch(e){
        console.error('[herstel]', t.id, e);
        fouten.push(`${naamVan(t)}: ${e.message || e}`);
      }
    }

    bezig = false;
    if (!fouten.length && !controleren.length){
      api.meld?.(`${ok} trainingen hersteld`);
      api.herteken?.();
      return;
    }
    // Er is iets om te melden: laat het staan (geen herteken, anders is het weg).
    if (uit){
      uit.innerHTML =
        `<b>${ok} van ${lijst.length} hersteld.</b>` +
        (controleren.length ? `<p style="margin:6px 0 0">Controleer even (aantal plaatjes wijkt af van het aantal oefeningen):</p><ul style="margin:4px 0 0;padding-left:20px">${controleren.map(x => `<li>${esc(x)}</li>`).join('')}</ul>` : '') +
        (fouten.length ? `<p style="margin:6px 0 0">Niet gelukt:</p><ul style="margin:4px 0 0;padding-left:20px">${fouten.map(x => `<li>${esc(x)}</li>`).join('')}</ul>` : '');
    }
    knop.disabled = !fouten.length;   // opnieuw proberen kan alleen als er iets mislukte
    if (fouten.length) knop.textContent = 'Opnieuw proberen';
  };
}
