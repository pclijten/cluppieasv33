/* ==================== DEEL-BOOT (kant van de ouder) ====================
   [20260921] Wordt aangeroepen door main.js zodra de URL een ?deel=<id>
   bevat — vóór/los van de normale login-flow. Logt automatisch anoniem in,
   wisselt de link in voor een smal begrensd toegangsbewijs (zie
   firestore.rules: trainingDeel + trainingToegang), en toont een sterk
   vereenvoudigde pagina: alleen de gedeelde training + de presentie ervan.
   Geen navigatie, geen toegang tot iets anders — dat is met opzet, dit
   scherm is voor een niet-ingelogde ouder die soms meehelpt.
   [20260922] Op verzoek van Paul: de presentie is hier ALLEEN-LEZEN — een
   ouder mag zien wie er is, maar niet zelf iets aanvinken (dat blijft aan
   de coach). De sectie staat bovendien standaard ingeklapt; tikken toont de
   lijst. firestore.rules staat schrijven op presentie voor een
   trainingToegang-sessie dan ook niet meer toe. */
import { auth, db, signInAnonymously, doc, getDoc, setDoc,
         collection, getDocs, query, where } from './firebase.js?v=20261106n';
import { esc } from './state.js?v=20261106n';
import { afwezigRedenInfo } from './config.js?v=20261106n';
import { oefHtml, bronHtml } from './training-weergave.js?v=20261106n';

function schermHtml(inhoud){
  return `<div style="max-width:var(--app-w,540px);margin:0 auto;min-height:100%;padding:20px 16px calc(40px + env(safe-area-inset-bottom));box-sizing:border-box">${inhoud}</div>`;
}
function laadHtml(tekst){
  return schermHtml(`<div class="u-tc u-zacht u-t-md" style="padding:60px 0">${esc(tekst||'Bezig met laden…')}</div>`);
}
function foutHtml(tekst){
  return schermHtml(`
    <div class="u-tc" style="padding:60px 20px">
      <div class="u-t-6xl u-mb-sm"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><rect x="4.6" y="10.4" width="14.8" height="9.8" rx="2.4"/><path d="M8 10.4V8a4 4 0 0 1 8 0v2.4"/><circle cx="12" cy="15.2" r="1.4" fill="currentColor" stroke="none"/></svg></div>
      <h1 class="u-t-xl u-mb-xs">Deze link werkt niet (meer)</h1>
      <p class="u-zacht u-t-md u-lh-ruim">${esc(tekst)}</p>
    </div>`);
}

export async function bootDeelPagina(deelId){
  const el = document.getElementById('deel');
  if (!el) return;
  el.style.display = 'block';
  el.innerHTML = laadHtml();

  // 1) Anoniem inloggen — alleen als er nog geen enkele sessie is. Is er al
  // een ECHTE coach ingelogd (deze link per ongeluk/expres in eigen browser
  // geopend), dan gebruiken we gewoon die sessie; die heeft toch al bredere
  // rechten, dus dit toegangsbewijs is voor hem overbodig maar onschadelijk.
  try {
    if (!auth.currentUser) await signInAnonymously(auth);
  } catch(e){
    el.innerHTML = foutHtml('Inloggen is niet gelukt. Probeer de pagina te verversen.');
    return;
  }

  // 2) De deel-link zelf lezen.
  let deel;
  try {
    const snap = await getDoc(doc(db,'trainingDeel',deelId));
    if (!snap.exists()){ el.innerHTML = foutHtml('Deze link bestaat niet meer.'); return; }
    deel = snap.data();
  } catch(e){
    el.innerHTML = foutHtml('Kon de link niet laden: ' + (e.code||e.message));
    return;
  }
  const vervaltMs = deel.vervaltOp?.toMillis ? deel.vervaltOp.toMillis() : 0;
  if (!vervaltMs || vervaltMs <= Date.now()){
    el.innerHTML = foutHtml('Deze link is verlopen. Vraag de coach om een nieuwe link.');
    return;
  }

  // 3) Toegangsbewijs inwisselen (upsert — zie firestore.rules: create/update
  // delen dezelfde voorwaarde, zodat een latere, andere deel-link het oude
  // bewijs gewoon overschrijft i.p.v. vast te lopen).
  try {
    const uid = auth.currentUser.uid;
    const toegangRef = doc(db,'trainingToegang',uid);
    const bestaand = await getDoc(toegangRef).catch(() => null);
    if (!bestaand?.exists() || bestaand.data().deelId !== deelId){
      await setDoc(toegangRef, { deelId, teamId: deel.teamId, trainingId: deel.trainingId, vervaltOp: deel.vervaltOp });
    }
  } catch(e){
    el.innerHTML = foutHtml('Kon geen toegang verlenen: ' + (e.code||e.message));
    return;
  }

  // 4) Trainingsinhoud + spelerslijst ophalen.
  let training, spelers;
  try {
    const [tsnap, ssnap] = await Promise.all([
      getDoc(doc(db,'trainingen',deel.trainingId)),
      getDocs(collection(db,'teams',deel.teamId,'spelers')),
    ]);
    if (!tsnap.exists()){ el.innerHTML = foutHtml('Deze training is niet meer beschikbaar.'); return; }
    training = tsnap.data();
    spelers = ssnap.docs.map(d => ({id:d.id, ...d.data()})).filter(p => !p.gast && !p._ingeleend && !p.gearchiveerd)
      .sort((a,b) => (a.naam||'').localeCompare(b.naam||''));
  } catch(e){
    el.innerHTML = foutHtml('Ophalen mislukt: ' + (e.code||e.message));
    return;
  }

  // 5) Bestaande presentie van vandaag (indien de coach al iets invulde) —
  // puur om te TONEN; de ouder kan hier niets meer in wijzigen.
  const vandaag = new Date().toISOString().slice(0,10);
  let presentieDoc = null;
  try {
    const psnap = await getDocs(query(collection(db,'teams',deel.teamId,'presentie'), where('datum','==',vandaag)));
    if (!psnap.empty) presentieDoc = { id: psnap.docs[0].id, ...psnap.docs[0].data() };
  } catch(e){ /* niet fataal — presentie toont dan gewoon "nog niet ingevuld" */ }

  renderDeelPagina(el, { deel, training, spelers, presentieDoc, vandaag, teamId: deel.teamId });
}

function renderDeelPagina(el, ctx){
  const { deel, training, spelers, presentieDoc } = ctx;
  const afwezig = new Set(presentieDoc?.afwezig || []);
  const redenen = presentieDoc?.afwezigRedenen || {};
  const vervaltTekst = new Date(deel.vervaltOp.toMillis()).toLocaleString('nl-NL', {weekday:'long', day:'numeric', month:'long', hour:'2-digit', minute:'2-digit'});
  const oefeningen = Array.isArray(training.oefeningen) ? training.oefeningen : [];
  const aantalAanwezig = spelers.length - afwezig.size;

  const speciaal = (p) => {
    const isAfw = afwezig.has(p.id);
    const info = redenen[p.id] ? afwezigRedenInfo(redenen[p.id]) : null;
    return `
    <div class="pres-speler ${isAfw?'afwezig':'aanwezig'}" style="cursor:default">
      <div class="pres-speler-kop" style="cursor:default">
        <span class="pres-shirt">${esc(p.nummer ?? '·')}</span>
        <span class="pres-naam">${esc(p.naam)}</span>
        <span class="pres-status">${isAfw?(info?`Afwezig, ${esc(info.label)}`:'Afwezig'):'Aanwezig'}</span>
      </div>
      ${isAfw && redenen[p.id]?.notitie ? `<p class="u-zacht u-t-xs" style="margin:var(--space-3xs) 0 0 44px">“${esc(redenen[p.id].notitie)}”</p>` : ''}
    </div>`;
  };

  el.innerHTML = schermHtml(`
    <div class="kop u-mb-2xs"><h1 class="u-t-2xl">${esc(deel.teamNaam || 'Training')}</h1></div>
    <p class="u-zacht u-t-sm" style="margin-bottom:20px">
      ${esc(deel.clubNaam||'')}${deel.clubNaam?'<span class="sep" aria-hidden="true"></span>':''}gedeeld door je coach<span class="sep" aria-hidden="true"></span>geldig tot ${esc(vervaltTekst)}
    </p>

    <div class="kaart" style="margin-bottom:20px">
      <div class="sectie-kop" style="margin:0 0 var(--space-2xs)">${ico_placeholder()} ${esc(deel.titel||'Training')}</div>
      ${oefeningen.length ? `<p class="u-zacht u-t-sm">${oefeningen.length} oefening${oefeningen.length===1?'':'en'} — scrol naar beneden voor de details.</p>` : `<p class="u-zacht u-t-sm">Nog geen gestructureerde oefenstof bij deze training.</p>`}
    </div>

    <button type="button" class="lijst-item u-mb-0" id="deelPresToggle" >
      <div class="li-tekst">
        <div class="titel">Presentie: vandaag</div>
        <div class="meta">${presentieDoc ? `${aantalAanwezig} van ${spelers.length} aanwezig` : 'Nog niet ingevuld door de coach'}</div>
      </div>
      <span class="pijl" id="deelPresPijl">›</span>
    </button>
    <div class="pres-lijst" id="deelPresLijst" style="display:none;margin-top:10px;margin-bottom:28px">${spelers.map(speciaal).join('')}</div>

    ${oefeningen.length ? `<div class="hl">${oefeningen.map((o,i) => oefHtml(i+1, o, training.diagramUrls||{})).join('')}</div>${bronHtml()}` : ''}
  `);

  const lijst = el.querySelector('#deelPresLijst');
  const pijl = el.querySelector('#deelPresPijl');
  el.querySelector('#deelPresToggle').onclick = () => {
    const open = lijst.style.display !== 'none';
    lijst.style.display = open ? 'none' : '';
    pijl.style.transform = open ? '' : 'rotate(90deg)';
  };
}

// Klein, plaatsonafhankelijk icoontje zonder afhankelijkheid van icons.js
// (die module is opgebouwd rond SVG-sprites die in deze losstaande pagina
// niet per se geladen zijn) — gewoon een emoji, functioneel identiek.
function ico_placeholder(){ return '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><rect x="5" y="4.5" width="14" height="16" rx="2.2"/><path d="M9 3.2h6v3H9z"/><path d="M8.8 11.4h6.4"/><path d="M8.8 15.4h4"/></svg>'; }
