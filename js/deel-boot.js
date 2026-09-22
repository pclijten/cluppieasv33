/* ==================== DEEL-BOOT (kant van de ouder) ====================
   [20260921] Wordt aangeroepen door main.js zodra de URL een ?deel=<id>
   bevat — vóór/los van de normale login-flow. Logt automatisch anoniem in,
   wisselt de link in voor een smal begrensd toegangsbewijs (zie
   firestore.rules: trainingDeel + trainingToegang), en toont een sterk
   vereenvoudigde pagina: alleen de gedeelde training + de presentie ervan.
   Geen navigatie, geen toegang tot iets anders — dat is met opzet, dit
   scherm is voor een niet-ingelogde ouder die soms meehelpt. */
import { auth, db, signInAnonymously, doc, getDoc, setDoc, addDoc, updateDoc,
         collection, getDocs, query, where, serverTimestamp } from './firebase.js?v=20260922a';
import { esc } from './state.js?v=20260922a';
import { AFWEZIG_REDENEN, afwezigRedenInfo } from './config.js?v=20260922a';
import { oefHtml } from './training-weergave.js?v=20260922a';

function schermHtml(inhoud){
  return `<div style="max-width:var(--app-w,540px);margin:0 auto;min-height:100%;padding:20px 16px calc(40px + env(safe-area-inset-bottom));box-sizing:border-box">${inhoud}</div>`;
}
function laadHtml(tekst){
  return schermHtml(`<div style="text-align:center;padding:60px 0;color:var(--ink-2);font-size:calc(14px * var(--fs))">${esc(tekst||'Bezig met laden…')}</div>`);
}
function foutHtml(tekst){
  return schermHtml(`
    <div style="text-align:center;padding:60px 20px">
      <div style="font-size:38px;margin-bottom:12px">🔒</div>
      <h1 style="font-size:calc(18px * var(--fs));margin-bottom:8px">Deze link werkt niet (meer)</h1>
      <p style="color:var(--ink-2);font-size:calc(13.5px * var(--fs));line-height:1.5">${esc(tekst)}</p>
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
    spelers = ssnap.docs.map(d => ({id:d.id, ...d.data()})).filter(p => !p.gast && !p._ingeleend)
      .sort((a,b) => (a.naam||'').localeCompare(b.naam||''));
  } catch(e){
    el.innerHTML = foutHtml('Ophalen mislukt: ' + (e.code||e.message));
    return;
  }

  // 5) Bestaande presentie van vandaag (indien de coach al iets invulde).
  const vandaag = new Date().toISOString().slice(0,10);
  let presentieDoc = null;
  try {
    const psnap = await getDocs(query(collection(db,'teams',deel.teamId,'presentie'), where('datum','==',vandaag)));
    if (!psnap.empty) presentieDoc = { id: psnap.docs[0].id, ...psnap.docs[0].data() };
  } catch(e){ /* niet fataal — presentie start dan gewoon leeg */ }

  renderDeelPagina(el, { deel, training, spelers, presentieDoc, vandaag, teamId: deel.teamId });
}

function renderDeelPagina(el, ctx){
  const { deel, training, spelers, vandaag } = ctx;
  const afwezig = new Set(ctx.presentieDoc?.afwezig || []);
  const redenen = ctx.presentieDoc ? JSON.parse(JSON.stringify(ctx.presentieDoc.afwezigRedenen || {})) : {};
  const vervaltTekst = new Date(deel.vervaltOp.toMillis()).toLocaleString('nl-NL', {weekday:'long', day:'numeric', month:'long', hour:'2-digit', minute:'2-digit'});
  const oefeningen = Array.isArray(training.oefeningen) ? training.oefeningen : [];

  const speciaal = (p) => {
    const isAfw = afwezig.has(p.id);
    const info = redenen[p.id] ? afwezigRedenInfo(redenen[p.id]) : null;
    return `
    <div class="pres-speler ${isAfw?'afwezig':'aanwezig'}" data-deel-speler="${p.id}">
      <button type="button" class="pres-speler-kop" data-deel-toggle="${p.id}">
        <span class="pres-shirt">${esc(p.nummer ?? '·')}</span>
        <span class="pres-naam">${esc(p.naam)}</span>
        <span class="pres-status">${isAfw?'Afwezig':'Aanwezig'}</span>
      </button>
      ${isAfw ? `
      <div class="pres-reden-rij">${AFWEZIG_REDENEN.map(r =>
        `<button type="button" class="pres-reden-chip ${info?.id===r.id?'actief':''}" data-deel-reden="${r.id}" data-deel-pid="${p.id}">${r.emoji} ${r.label}</button>`).join('')}</div>
      ${info ? `<input class="invoer pres-reden-notitie" data-deel-notitie="${p.id}" placeholder="Toelichting (optioneel)" value="${esc(redenen[p.id]?.notitie||'')}">` : ''}
      ` : ''}
    </div>`;
  };

  el.innerHTML = schermHtml(`
    <div class="kop" style="margin-bottom:4px"><h1 style="font-size:calc(19px * var(--fs))">${esc(deel.teamNaam || 'Training')}</h1></div>
    <p style="color:var(--ink-2);font-size:calc(12.5px * var(--fs));margin-bottom:20px">
      ${esc(deel.clubNaam||'')}${deel.clubNaam?' · ':''}gedeeld door je coach · geldig tot ${esc(vervaltTekst)}
    </p>

    <div class="kaart" style="margin-bottom:20px">
      <div class="sectie-kop" style="margin:0 0 4px">${ico_placeholder()} ${esc(deel.titel||'Training')}</div>
      ${oefeningen.length ? `<p style="color:var(--ink-2);font-size:calc(12.5px * var(--fs))">${oefeningen.length} oefening${oefeningen.length===1?'':'en'} — scrol naar beneden voor de details.</p>` : `<p style="color:var(--ink-2);font-size:calc(13px * var(--fs))">Nog geen gestructureerde oefenstof bij deze training.</p>`}
    </div>

    <div class="sectie-kop">Presentie — vandaag</div>
    <p style="color:var(--ink-2);font-size:calc(12.5px * var(--fs));margin-bottom:10px">Iedereen staat op <b>aanwezig</b>. Tik op een naam om iemand als afwezig te markeren.</p>
    <div class="pres-lijst" id="deelPresLijst">${spelers.map(speciaal).join('')}</div>
    <div class="pres-opslag rust" id="deelPresOpslag" style="margin-top:10px" aria-live="polite">
      <span class="pres-opslag-stip"></span><span id="deelPresOpslagTekst">Nog niet opgeslagen</span>
    </div>
    <button class="knop vol" id="deelPresOpslaan" style="margin-top:10px;margin-bottom:28px">Presentie opslaan</button>

    ${oefeningen.length ? `<div class="hl">${oefeningen.map((o,i) => oefHtml(i+1, o, training.diagramUrls||{})).join('')}</div>` : ''}
  `);

  const lijst = el.querySelector('#deelPresLijst');
  lijst.querySelectorAll('[data-deel-toggle]').forEach(b => b.onclick = () => {
    const id = b.dataset.deelToggle;
    if (afwezig.has(id)){ afwezig.delete(id); delete redenen[id]; }
    else afwezig.add(id);
    herteken();
  });
  const koppelRedenKnoppen = () => {
    lijst.querySelectorAll('[data-deel-reden]').forEach(b => b.onclick = () => {
      const id = b.dataset.deelPid, type = b.dataset.deelReden;
      const huidig = redenen[id];
      if (huidig && afwezigRedenInfo(huidig).id === type) delete redenen[id];
      else redenen[id] = { type, notitie: huidig?.notitie || '' };
      herteken();
    });
    lijst.querySelectorAll('[data-deel-notitie]').forEach(inp => inp.oninput = () => {
      const id = inp.dataset.deelNotitie;
      if (redenen[id]) redenen[id].notitie = inp.value;
    });
  };
  function herteken(){
    lijst.innerHTML = spelers.map(speciaal).join('');
    lijst.querySelectorAll('[data-deel-toggle]').forEach(b => b.onclick = () => {
      const id = b.dataset.deelToggle;
      if (afwezig.has(id)){ afwezig.delete(id); delete redenen[id]; }
      else afwezig.add(id);
      herteken();
    });
    koppelRedenKnoppen();
  }
  koppelRedenKnoppen();

  const zetStatus = (klasse, tekst) => {
    const b = el.querySelector('#deelPresOpslag'); if (!b) return;
    b.className = 'pres-opslag ' + klasse;
    el.querySelector('#deelPresOpslagTekst').textContent = tekst;
  };

  el.querySelector('#deelPresOpslaan').onclick = async () => {
    const knop = el.querySelector('#deelPresOpslaan');
    knop.disabled = true;
    zetStatus('bezig', 'Bewaren…');
    const data = {
      datum: vandaag,
      afwezig: Array.from(afwezig),
      telaat: [],
      afwezigRedenen: redenen,
      selectie: spelers.map(p => p.id),
      aantalAanwezig: spelers.length - afwezig.size,
      aantalTeLaat: 0,
      aantalSpelers: spelers.length,
      door: 'Ouder (gedeelde training)',
      gewijzigd: serverTimestamp(),
    };
    try {
      if (ctx.presentieDoc){
        await updateDoc(doc(db,'teams',ctx.teamId,'presentie',ctx.presentieDoc.id), data);
      } else {
        const ref = await addDoc(collection(db,'teams',ctx.teamId,'presentie'), { ...data, gemaakt: serverTimestamp() });
        ctx.presentieDoc = { id: ref.id };
      }
      zetStatus('klaar', 'Bewaard — bedankt!');
    } catch(e){
      zetStatus('fout', 'Bewaren mislukt: ' + (e.code||e.message));
    } finally {
      knop.disabled = false;
    }
  };
}

// Klein, plaatsonafhankelijk icoontje zonder afhankelijkheid van icons.js
// (die module is opgebouwd rond SVG-sprites die in deze losstaande pagina
// niet per se geladen zijn) — gewoon een emoji, functioneel identiek.
function ico_placeholder(){ return '📋'; }
