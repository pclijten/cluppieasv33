/* ==================== CONTENTBEHEER (admin-only tabblad) ====================
   UI voor het clubdashboard-tabblad "Content": lijst + bewerken/toevoegen/
   verwijderen van leercurve-teksten, ASV-kompas-tips en gouden regels.
   Puur beheer — de daadwerkelijke opslag/lees-logica staat in content.js.
   Alleen zichtbaar voor isBeheerder() (zie koppeling in club.js), en ook de
   Firestore-rules staan schrijven alleen aan de hoofdbeheerder toe — dit
   tabblad is dus decoratief-veilig: zelfs een geknoei aan de UI kan niet
   ongeautoriseerd schrijven. */
import { S, esc, meld, openModal, sluitModal } from './state.js?v=20261106m';
import {
  startContentAdminListener, opslaanContent, verwijderContent, seedContentNaarFirestore
} from './content.js?v=20261106m';

const CATEGORIE_LABEL = {
  leercurve: 'Leerlijn-thema',
  kompas: 'ASV-kompas-tip',
  'gouden-regel': 'Gouden regel',
};

let _huidigeLijst = [];

export function startClubContentListener(onData){
  return startContentAdminListener(lijst => { _huidigeLijst = lijst; onData(lijst); });
}

export function htmlClubContent(lijst){
  const groepen = ['leercurve', 'kompas', 'gouden-regel'];
  return `
    <div class="kaart u-mb-md">
      <p class="u-t-sm u-zacht u-lh-ruim u-mb-sm">
        Teksten uit het jeugdbeleidsplan: leerlijn-uitleg, ASV-kompas-tips en gouden
        regels. Wijzigingen zijn direct zichtbaar voor alle coaches, zonder dat er
        iets geüpload hoeft te worden. Status <b>concept</b> houdt een tekst verborgen
        voor coaches totdat je hem op <b>gepubliceerd</b> zet.
      </p>
      <button class="knop licht vol" id="btnContentNieuw">+ Nieuwe tekst</button>
      ${lijst.length === 0 ? `<button class="knop licht vol u-mt-xs" id="btnContentSeed" ><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M12 3v12"/><path d="m7 10 5 5 5-5"/><path d="M5 21h14"/></svg> Seed content vanuit jeugdbeleidsplan</button>` : ''}
    </div>
    ${groepen.map(cat => {
      const items = lijst.filter(c => c.categorie === cat).sort((a,b) => (a.volgorde||0)-(b.volgorde||0));
      if (!items.length) return '';
      return `
        <div class="kaart u-mb-md">
          <h3 class="u-mb-xs">${CATEGORIE_LABEL[cat] || cat}</h3>
          ${items.map(c => `
            <div class="lijst-item" data-content-open="${c.id}" style="cursor:pointer">
              <div class="u-flex-1" style="min-width:0">
                <div class="u-fw-6 u-t-md">${esc(c.titel || '(geen titel)')}</div>
                <div class="u-t-xs u-zacht">
                  #${c.volgorde ?? '·'}<span class="sep" aria-hidden="true"></span>${c.status === 'gepubliceerd' ? '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M4.6 12.4 9.6 17.4 19.6 6.6"/></svg> gepubliceerd' : '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M15.4 4.8 19.2 8.6 9 18.8l-4 1.2 1.2-4z"/><path d="M13.4 6.8 17.2 10.6"/></svg> concept'}
                  ${(c.tags||[]).length ? '<span class="sep" aria-hidden="true"></span>' + c.tags.map(esc).join(', ') : ''}
                </div>
              </div>
            </div>`).join('')}
        </div>`;
    }).join('')}
  `;
}

function modalContentBewerk(item){
  const isNieuw = !item;
  const c = item || { categorie:'leercurve', tags:[], volgorde:1, status:'concept', titel:'', achtergrond:'', tips:[] };
  openModal(`
    <h2>${isNieuw ? '+ Nieuwe tekst' : '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M15.4 4.8 19.2 8.6 9 18.8l-4 1.2 1.2-4z"/><path d="M13.4 6.8 17.2 10.6"/></svg> ' + esc(c.titel || '')}</h2>
    <div class="veldgroep"><label>Categorie</label>
      <select class="invoer" id="cCategorie">
        <option value="leercurve" ${c.categorie==='leercurve'?'selected':''}>Leerlijn-thema</option>
        <option value="kompas" ${c.categorie==='kompas'?'selected':''}>ASV-kompas-tip</option>
        <option value="gouden-regel" ${c.categorie==='gouden-regel'?'selected':''}>Gouden regel</option>
      </select></div>
    <div class="veldgroep"><label>Titel ${c.categorie==='leercurve' ? '(= themanaam, moet exact overeenkomen met de leerlijn)' : ''}</label>
      <input class="invoer" id="cTitel" value="${esc(c.titel||'')}"></div>
    <div class="veldgroep"><label>Achtergrond</label>
      <textarea class="invoer" id="cAchtergrond" rows="4">${esc(c.achtergrond||'')}</textarea></div>
    <div class="veldgroep"><label>Tips (één per regel)</label>
      <textarea class="invoer" id="cTips" rows="4">${(c.tips||[]).map(esc).join('\n')}</textarea></div>
    <div class="veldgroep"><label>Tags (komma-gescheiden)</label>
      <input class="invoer" id="cTags" value="${esc((c.tags||[]).join(', '))}"></div>
    <div class="veldgroep"><label>Volgorde</label>
      <input class="invoer" id="cVolgorde" type="number" value="${c.volgorde ?? 1}"></div>
    <div class="veldgroep"><label>Status</label>
      <select class="invoer" id="cStatus">
        <option value="concept" ${c.status==='concept'?'selected':''}>Concept (verborgen)</option>
        <option value="gepubliceerd" ${c.status==='gepubliceerd'?'selected':''}>Gepubliceerd</option>
      </select></div>
    <button class="knop vol" id="cOpslaan">Opslaan</button>
    ${!isNieuw ? `<button class="knop licht vol u-mt-xs" id="cVerwijderen" ><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M5.4 7.4h13.2"/><path d="M7.4 7.4 8.3 20h7.4l.9-12.6"/><path d="M9.6 4.4h4.8l.6 3H9z"/><path d="M10.6 11v5.4M13.4 11v5.4"/></svg> Verwijderen</button>` : ''}
  `);
  document.getElementById('cOpslaan').onclick = async () => {
    const titel = document.getElementById('cTitel').value.trim();
    if (!titel) return meld('Vul een titel in');
    const data = {
      categorie: document.getElementById('cCategorie').value,
      titel,
      achtergrond: document.getElementById('cAchtergrond').value.trim(),
      tips: document.getElementById('cTips').value.split('\n').map(s => s.trim()).filter(Boolean),
      tags: document.getElementById('cTags').value.split(',').map(s => s.trim()).filter(Boolean),
      volgorde: Number(document.getElementById('cVolgorde').value) || 1,
      status: document.getElementById('cStatus').value,
    };
    if (data.categorie === 'leercurve') data.thema = titel;
    const id = isNieuw
      ? (data.categorie + '-' + titel.toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/(^-|-$)/g,'')) || ('content-' + Date.now())
      : c.id;
    try {
      await opslaanContent(id, data);
      meld('Opgeslagen');
      sluitModal();
    } catch(e){
      meld('Opslaan mislukt: ' + (e.code || e.message));
    }
  };
  const verwijderKnop = document.getElementById('cVerwijderen');
  if (verwijderKnop){
    verwijderKnop.onclick = async () => {
      if (!confirm(`"${c.titel}" verwijderen? Dit kan niet ongedaan worden gemaakt.`)) return;
      try { await verwijderContent(c.id); meld('Verwijderd'); sluitModal(); }
      catch(e){ meld('Verwijderen mislukt: ' + (e.code || e.message)); }
    };
  }
}

export function koppelClubContent(v){
  v.querySelector('#btnContentNieuw')?.addEventListener('click', () => modalContentBewerk(null));
  v.querySelector('#btnContentSeed')?.addEventListener('click', async () => {
    meld('Bezig met seeden…');
    try {
      const { geschreven, overgeslagen } = await seedContentNaarFirestore();
      meld(`${geschreven} teksten toegevoegd, ${overgeslagen} bestonden al`);
    } catch(e){
      meld('Seeden mislukt: ' + (e.code || e.message));
    }
  });
  v.querySelectorAll('[data-content-open]').forEach(el => {
    el.addEventListener('click', () => {
      const item = _huidigeLijst.find(c => c.id === el.dataset.contentOpen);
      if (item) modalContentBewerk(item);
    });
  });
}
