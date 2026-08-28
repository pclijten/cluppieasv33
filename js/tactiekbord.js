/* ==========================================================================
   tactiekbord.js — Fullscreen tactiekbord per wedstrijd/periode.

   Een coach opent vanuit een wedstrijd een tactiekbord: het veld met de
   spelers uit de opgeslagen opstelling van de gekozen periode. Daarop kan
   hij loopwegen, passes en vrije aantekeningen tekenen, tegenstanders en een
   bal plaatsen, en alles verslepen. Boards worden per wedstrijd bewaard in de
   subcollectie `tactieken`, zodat er meerdere per wedstrijd kunnen bestaan
   ("K1 omschakeling", "corner voor", ...). Een board kan als PNG gedeeld
   worden — die afbeelding wordt client-side op een <canvas> getekend, dus er
   gaat niets naar Storage.

   v1: statisch (geen animatie, geen live meekijken). Die staan als fase 2
   gepland en het datamodel hieronder is er al op voorbereid.

   Datamodel (Firestore doc in teams/{teamId}/wedstrijden/{wid}/tactieken):
     { naam, periode, format, formatie,
       objecten: [ {soort:'speler'|'tegen'|'bal', nr, naam, x, y} ],   // x,y in %
       tekeningen: [ {soort:'loopweg'|'potlood', kleur, punten:[[x,y],...]} ],   // x,y in %
       gemaaktDoor, gemaaktOp, gewijzigdOp }
   De subcollectie valt onder de bestaande `/{sub=**}` team-regel, dus er zijn
   geen nieuwe Firestore-rules nodig. Alle coaches van het team mogen maken en
   bewerken (zelfde recht als de rest van de wedstrijd).
   ========================================================================== */

import { db, collection, doc, addDoc, updateDoc, deleteDoc,
         onSnapshot, serverTimestamp } from './firebase.js?v=20260811a';
import { S, esc, meld, spelerNaam, spelerNr, bewaakTerug, vangnetStilTerugAlsNodig } from './state.js?v=20260828d';
import { bouwSlots } from './config.js?v=20260828d';
import { telNav } from './tracker.js?v=20260828d';

const NS = 'http://www.w3.org/2000/svg';

/* Kleuren voor de tekentools. Geel is de standaard-loopwegkleur, herkenbaar
   los van het rode clubaccent (dat spelers markeert). */
const KLEUREN = ['#F2C94C', '#FFFFFF', '#E20613', '#2B6FD6'];

/* Lopende board-state (alleen relevant zolang het bord open is). */
let B = null;   // { wid, tactiekId, naam, periode, format, formatie, objecten, tekeningen }
let tool = 'select';
let kleur = KLEUREN[0];
let volgAan = false;              // "volg-loopweg": sleep een speler, loopweg tekent mee
let undoStack = [];
let unsubLijst = null;
let _board = null;                // het fullscreen-overlay-element (of null)

/* ---------- helpers ---------- */
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

/* Spelers uit de opgeslagen opstelling van een periode als board-objecten. */
function objectenUitOpstelling(w, periodeNr){
  const k = (w.kwarten || {})[periodeNr];
  const formatie = (k && k.formatie) || w.formatie;
  const slots = bouwSlots(w.format, formatie);
  const lineup = (k && k.lineup) || {};
  const objs = [];
  for (const sl of slots){
    const pid = lineup[sl.id];
    if (!pid) continue;
    const nr = spelerNr(pid);
    objs.push({
      soort: 'speler',
      nr: nr === '·' ? '' : nr,
      naam: spelerNaam(pid) === '—' ? '' : spelerNaam(pid),
      keeper: sl.id === 'K',
      x: sl.x, y: sl.y,
    });
  }
  return objs;
}

/* ==================== OPSLAG ==================== */

function tactiekenRef(wid){
  return collection(db, 'teams', S.teamId, 'wedstrijden', wid, 'tactieken');
}

/* Nieuw leeg board op basis van de huidige opstelling; nog niet opgeslagen. */
function nieuwBoard(w, periodeNr, naam){
  return {
    wid: S.wedstrijdId,
    tactiekId: null,
    naam: naam || ('Tactiek ' + (periodeLabelKort(w, periodeNr))),
    periode: String(periodeNr),
    format: w.format,
    formatie: ((w.kwarten||{})[periodeNr]||{}).formatie || w.formatie,
    objecten: objectenUitOpstelling(w, periodeNr),
    tekeningen: [],
  };
}

function periodeLabelKort(w, nr){
  const p = Number(w.periodes || 4);
  return (p === 2 ? 'H' : 'K') + nr;
}

/* Board naar Firestore. Nieuw board -> addDoc, bestaand -> updateDoc. */
async function bewaarBoard(){
  if (!B) return;
  const data = {
    naam: B.naam,
    periode: B.periode,
    format: B.format,
    formatie: B.formatie,
    objecten: B.objecten,
    tekeningen: B.tekeningen,
    gewijzigdOp: serverTimestamp(),
  };
  try {
    if (B.tactiekId){
      await updateDoc(doc(tactiekenRef(B.wid), B.tactiekId), data);
    } else {
      data.gemaaktDoor = (S.user && S.user.uid) || null;
      data.gemaaktOp = serverTimestamp();
      const ref = await addDoc(tactiekenRef(B.wid), data);
      B.tactiekId = ref.id;
    }
    meld('Tactiek bewaard');
  } catch (e){
    meld('Bewaren mislukt — probeer opnieuw');
  }
}

async function verwijderBoard(wid, tactiekId){
  try { await deleteDoc(doc(tactiekenRef(wid), tactiekId)); meld('Tactiek verwijderd'); }
  catch(e){ meld('Verwijderen mislukt'); }
}

/* ==================== LIJST (overzicht per wedstrijd) ==================== */

/* Toont de tactieken van een wedstrijd als sheet met "nieuw" + bestaande. */
export function openTactiekLijst(w){
  telNav('wedstrijd:tactiek', 'open');
  const host = document.createElement('div');
  host.className = 'tb-sheet-bg';
  host.innerHTML = `
    <div class="tb-sheet">
      <div class="tb-sheet-kop">
        <h3>Tactiekborden</h3>
        <button class="tb-sluit" aria-label="Sluiten">✕</button>
      </div>
      <button class="tb-nieuw" id="tbNieuw">
        <span class="tb-nieuw-ico">✎</span>
        <span><strong>Nieuw tactiekbord</strong><br>
          <span class="tb-sub">Op basis van de huidige opstelling</span></span>
      </button>
      <div class="tb-lijst" id="tbLijst">
        <div class="tb-laden">Laden…</div>
      </div>
    </div>`;
  document.body.appendChild(host);

  const sluit = () => { if (unsubLijst){ unsubLijst(); unsubLijst = null; } host.remove(); };
  host.querySelector('.tb-sluit').onclick = sluit;
  host.onclick = e => { if (e.target === host) sluit(); };

  host.querySelector('#tbNieuw').onclick = () => {
    sluit();
    kiesPeriodeEnOpen(w);
  };

  const lijstEl = host.querySelector('#tbLijst');
  unsubLijst = onSnapshot(tactiekenRef(S.wedstrijdId), snap => {
    const items = [];
    snap.forEach(d => items.push({ id: d.id, ...d.data() }));
    items.sort((a,b) => (a.periode||'').localeCompare(b.periode||'') || (a.naam||'').localeCompare(b.naam||''));
    if (!items.length){
      lijstEl.innerHTML = `<div class="tb-leeg">Nog geen tactiekborden voor deze wedstrijd.</div>`;
      return;
    }
    lijstEl.innerHTML = items.map(it => `
      <div class="tb-rij" data-id="${esc(it.id)}">
        <div class="tb-rij-mini">${miniVeldSvg(it)}</div>
        <div class="tb-rij-tekst">
          <div class="tb-rij-naam">${esc(it.naam || 'Tactiek')}</div>
          <div class="tb-rij-meta">${esc(periodeLabelKort(w, it.periode))} · ${(it.tekeningen||[]).length} tekening${(it.tekeningen||[]).length===1?'':'en'}</div>
        </div>
        <button class="tb-rij-verwijder" data-verwijder="${esc(it.id)}" aria-label="Verwijderen">🗑</button>
      </div>`).join('');
    lijstEl.querySelectorAll('.tb-rij').forEach(rij => {
      rij.querySelector('.tb-rij-tekst').onclick = () => {
        const it = items.find(x => x.id === rij.dataset.id);
        sluit();
        openBoard(w, it);
      };
      rij.querySelector('.tb-rij-mini').onclick = () => {
        const it = items.find(x => x.id === rij.dataset.id);
        sluit();
        openBoard(w, it);
      };
    });
    lijstEl.querySelectorAll('[data-verwijder]').forEach(b => {
      b.onclick = () => {
        if (confirm('Dit tactiekbord verwijderen?')) verwijderBoard(S.wedstrijdId, b.dataset.verwijder);
      };
    });
  });
}

/* Minivoorbeeldje van een board voor in de lijst (klein statisch svg'tje). */
function miniVeldSvg(it){
  const punten = (it.tekeningen||[]).map(t =>
    `<polyline points="${(t.punten||[]).map(p=>`${p[0]},${p[1]*0.75}`).join(' ')}"
      fill="none" stroke="${esc(t.kleur||'#F2C94C')}" stroke-width="2"
      ${t.soort==='loopweg'?'stroke-dasharray="4 3"':''}/>`).join('');
  const stippen = (it.objecten||[]).slice(0,12).map(o =>
    `<circle cx="${o.x}" cy="${o.y*0.75}" r="3.2"
      fill="${o.soort==='tegen'?'#2B6FD6':(o.soort==='bal'?'#fff':'#E20613')}"/>`).join('');
  return `<svg viewBox="0 0 100 75" preserveAspectRatio="none" class="tb-mini-svg">
    <rect width="100" height="75" fill="#2E7D46"/>
    <line x1="0" y1="37.5" x2="100" y2="37.5" stroke="rgba(255,255,255,.4)" stroke-width="1"/>
    <circle cx="50" cy="37.5" r="9" fill="none" stroke="rgba(255,255,255,.4)" stroke-width="1"/>
    ${punten}${stippen}
  </svg>`;
}

/* ==================== PERIODE KIEZEN ==================== */

function kiesPeriodeEnOpen(w){
  const nrs = [];
  const aantal = Number(w.periodes || 4);
  for (let i = 1; i <= aantal; i++) nrs.push(i);
  // periodes met een niet-lege opstelling zijn nuttig; toon ze allemaal maar
  // markeer welke een opstelling hebben.
  const heeft = nr => Object.keys(((w.kwarten||{})[nr]||{}).lineup || {}).length > 0;
  const host = document.createElement('div');
  host.className = 'tb-sheet-bg';
  host.innerHTML = `
    <div class="tb-sheet">
      <div class="tb-sheet-kop"><h3>Welke opstelling?</h3>
        <button class="tb-sluit" aria-label="Sluiten">✕</button></div>
      <div class="tb-periodes">
        ${nrs.map(nr => `
          <button class="tb-periode ${heeft(nr)?'':'leeg'}" data-nr="${nr}">
            <strong>${periodeLabelKort(w, nr)}</strong>
            <span>${heeft(nr) ? 'opstelling klaar' : 'nog geen opstelling'}</span>
          </button>`).join('')}
      </div>
    </div>`;
  document.body.appendChild(host);
  const sluit = () => host.remove();
  host.querySelector('.tb-sluit').onclick = sluit;
  host.onclick = e => { if (e.target === host) sluit(); };
  host.querySelectorAll('.tb-periode').forEach(b => {
    b.onclick = () => { sluit(); openBoard(w, null, Number(b.dataset.nr)); };
  });
}

/* ==================== BOARD (fullscreen editor) ==================== */

/* Opent het fullscreen tactiekbord. Bestaand board (it != null) of nieuw
   (periodeNr gegeven). */
function openBoard(w, it, periodeNr){
  if (it){
    B = {
      wid: S.wedstrijdId, tactiekId: it.id, naam: it.naam || 'Tactiek',
      periode: it.periode, format: it.format || w.format,
      formatie: it.formatie || w.formatie,
      objecten: (it.objecten || []).map(o => ({...o})),
      tekeningen: (it.tekeningen || []).map(t => ({...t, punten: (t.punten||[]).map(p => [...p])})),
    };
  } else {
    B = nieuwBoard(w, periodeNr, null);
  }
  tool = 'select'; volgAan = false; kleur = KLEUREN[0]; undoStack = [];
  telNav('tactiek:bord', it ? 'open' : 'nieuw');
  tekenBoard(w);
}

function tekenBoard(w){
  const host = document.createElement('div');
  host.className = 'tb-board';
  host.innerHTML = `
    <div class="tb-top">
      <button class="tb-top-btn ghost" id="tbTerug" aria-label="Terug">‹</button>
      <div class="tb-titel-wrap">
        <input class="tb-naam" id="tbNaam" value="${esc(B.naam)}" maxlength="40">
        <div class="tb-sub2">${esc(periodeLabelKort(w, B.periode))} · ${esc(B.formatie)}</div>
      </div>
      <button class="tb-top-btn" id="tbUndo" aria-label="Ongedaan maken">↶</button>
      <button class="tb-top-btn" id="tbDeel" aria-label="Delen">⇪</button>
      <button class="tb-top-btn primary" id="tbBewaar">Bewaren</button>
    </div>

    <div class="tb-stage">
      <div class="tb-veld-wrap" id="tbVeldWrap">
        <div class="tb-veld"></div>
        <div class="tb-lijn tb-midden"></div>
        <div class="tb-lijn tb-cirkel"></div>
        <div class="tb-lijn tb-zestien-o"></div>
        <div class="tb-lijn tb-vijf-o"></div>
        <div class="tb-lijn tb-zestien-b"></div>
        <div class="tb-lijn tb-vijf-b"></div>
        <svg class="tb-tekenlaag" id="tbTeken" viewBox="0 0 100 100" preserveAspectRatio="none">
          <defs>
            <marker id="tbPijl" markerWidth="7" markerHeight="7" refX="5.5" refY="3" orient="auto">
              <path d="M0,0 L6,3 L0,6 Z" fill="var(--tb-pijl)"/>
            </marker>
          </defs>
        </svg>
        <div class="tb-objecten" id="tbObjecten"></div>
        <div class="tb-hint weg" id="tbHint"></div>
      </div>
    </div>

    <div class="tb-tools" id="tbTools">
      <button class="tb-tool actief" data-tool="select">◈<span>Verplaats</span></button>
      <button class="tb-tool" data-tool="volg" id="tbVolg">↝<span>Volg-loopweg</span></button>
      <button class="tb-tool" data-tool="potlood">✎<span>Potlood</span></button>
      <button class="tb-tool" data-tool="gum">⌫<span>Gum</span></button>
      <span class="tb-verdeler"></span>
      <button class="tb-tool" data-add="tegen">◉<span>Tegenstander</span></button>
      <button class="tb-tool" data-add="bal">⚪<span>Bal</span></button>
      <span class="tb-verdeler"></span>
      <span class="tb-kleuren" id="tbKleuren">
        ${KLEUREN.map((c,i)=>`<button class="tb-kleur ${i===0?'actief':''}" style="background:${c}" data-kleur="${c}"></button>`).join('')}
      </span>
      <span class="tb-verdeler"></span>
      <button class="tb-tool" data-tool="wis">✕<span>Wissen</span></button>
    </div>`;
  document.body.appendChild(host);
  _board = host;

  const veldWrap = host.querySelector('#tbVeldWrap');
  const objLaag  = host.querySelector('#tbObjecten');
  const teken    = host.querySelector('#tbTeken');
  const hintEl   = host.querySelector('#tbHint');

  // Sluiten via de kruisknop/‹ links: verbruikt het history-vangnet stil, net
  // als de pdf-viewer. De hardware-terugknop komt via stapTerug() in state.js
  // bij sluitTactiekbord() terecht — daar staat het bord bovenaan de prioriteit.
  const sluit = () => sluitTactiekbord();
  // Leg het history-vangnet zodat de eerstvolgende terugtik het bord sluit
  // i.p.v. de onderliggende wedstrijd te verlaten.
  bewaakTerug();

  function hint(t){
    hintEl.textContent = t; hintEl.classList.remove('weg');
    clearTimeout(hint._t); hint._t = setTimeout(() => hintEl.classList.add('weg'), 2200);
  }
  function pushUndo(){
    undoStack.push(JSON.stringify({ objecten: B.objecten, tekeningen: B.tekeningen }));
    if (undoStack.length > 40) undoStack.shift();
  }
  pushUndo();

  /* ---------- render objecten & tekeningen uit B ---------- */
  function renderObjecten(){
    objLaag.innerHTML = B.objecten.map((o, i) => {
      if (o.soort === 'bal'){
        return `<div class="tb-obj" data-i="${i}" style="left:${o.x}%;top:${o.y}%"><div class="tb-bal"></div></div>`;
      }
      const cls = o.soort === 'tegen' ? 'tegen' : (o.keeper ? 'keeper' : 'eigen');
      return `<div class="tb-obj" data-i="${i}" style="left:${o.x}%;top:${o.y}%">
        <div class="tb-chip ${cls}">${esc(String(o.nr ?? ''))}</div>
        ${o.naam ? `<div class="tb-chip-naam">${esc(o.naam)}</div>` : ''}</div>`;
    }).join('');
    objLaag.querySelectorAll('.tb-obj').forEach(el => koppelSleep(el));
  }
  function stijlPad(path, t){
    path.setAttribute('stroke', t.kleur || '#F2C94C');
    path.setAttribute('stroke-width', '3');
    path.setAttribute('fill', 'none');
    path.setAttribute('stroke-linecap', 'round');
    path.setAttribute('stroke-linejoin', 'round');
    // Houd de lijndikte constant in pixels ondanks de niet-uniforme uitrekking
    // van het 100×100-viewBox (anders wordt 'ie de ene richting dik, de andere dun).
    path.setAttribute('vector-effect', 'non-scaling-stroke');
    if (t.soort === 'loopweg'){
      path.setAttribute('stroke-dasharray', '7 5');
      path.setAttribute('marker-end', 'url(#tbPijl)');
    }
  }
  function renderTekeningen(){
    // verwijder alle bestaande paths (behoud <defs>)
    teken.querySelectorAll('path').forEach(p => p.remove());
    for (const t of B.tekeningen){
      const path = document.createElementNS(NS, 'path');
      path.setAttribute('d', 'M' + (t.punten||[]).map(p => p.join(' ')).join(' L'));
      stijlPad(path, t);
      teken.appendChild(path);
    }
  }
  renderObjecten(); renderTekeningen();

  /* ---------- coördinaten ----------
     Eén systeem overal: percentages 0–100 op beide assen, gemeten tegen de
     veld-wrap (het echte veldvak). Zowel de tekenlaag (svg, 0–100 viewBox) als
     de objectenlaag vullen exact deze wrap, dus chip én lijn volgen de vinger
     1-op-1 zonder offset. */
  function pos(clientX, clientY){
    const r = veldWrap.getBoundingClientRect();
    return { x: clamp((clientX - r.left) / r.width  * 100, 0, 100),
             y: clamp((clientY - r.top)  / r.height * 100, 0, 100) };
  }

  /* ---------- objecten slepen (+ volg-loopweg) ---------- */
  function koppelSleep(el){
    let actief = false, volgPunten = null;
    el.addEventListener('pointerdown', e => {
      const i = +el.dataset.i;
      if (tool === 'gum'){ B.objecten.splice(i,1); renderObjecten(); pushUndo(); e.stopPropagation(); return; }
      if (tool !== 'select' && tool !== 'volg') return;
      actief = true; el.classList.add('pak'); el.setPointerCapture(e.pointerId);
      if (volgAan && B.objecten[i] && B.objecten[i].soort !== 'bal'){
        // Begin de loopweg exact op het middelpunt van de speler, niet op de
        // (mogelijk iets naast de chip liggende) vingerpositie. Zo loopt de lijn
        // netjes vanaf de speler mee.
        volgPunten = [[+B.objecten[i].x.toFixed(1), +B.objecten[i].y.toFixed(1)]];
      }
      e.stopPropagation();
    });
    el.addEventListener('pointermove', e => {
      if (!actief) return;
      const i = +el.dataset.i;
      const p = pos(e.clientX, e.clientY);
      el.style.left = p.x + '%'; el.style.top = p.y + '%';
      B.objecten[i].x = +p.x.toFixed(1); B.objecten[i].y = +p.y.toFixed(1);
      if (volgPunten){
        const l = volgPunten[volgPunten.length-1];
        // kleinere drempel = vloeiender en nauwkeuriger spoor
        if (Math.hypot(p.x-l[0], p.y-l[1]) > 1.2){
          volgPunten.push([+p.x.toFixed(1), +p.y.toFixed(1)]);
        }
      }
    });
    el.addEventListener('pointerup', () => {
      actief = false; el.classList.remove('pak');
      if (volgPunten){
        // eindpunt exact op de neergelegde positie
        const i = +el.dataset.i;
        volgPunten.push([+B.objecten[i].x.toFixed(1), +B.objecten[i].y.toFixed(1)]);
        const lengte = volgPunten.reduce((t,p,idx) => idx ? t+Math.hypot(p[0]-volgPunten[idx-1][0], p[1]-volgPunten[idx-1][1]) : 0, 0);
        if (lengte >= 5){
          B.tekeningen.push({ soort:'loopweg', kleur, punten: volgPunten });
          renderTekeningen();
        }
        volgPunten = null;
      }
      pushUndo();
    });
  }

  /* ---------- vrij tekenen (alleen potlood) ---------- */
  let bezig = null, tijdelijk = null;
  veldWrap.addEventListener('pointerdown', e => {
    if (tool !== 'potlood') return;
    const s = pos(e.clientX, e.clientY);
    bezig = { soort: 'potlood', kleur, punten: [[+s.x.toFixed(1), +s.y.toFixed(1)]] };
    tijdelijk = document.createElementNS(NS, 'path');
    stijlPad(tijdelijk, bezig);
    teken.appendChild(tijdelijk);
    veldWrap.setPointerCapture(e.pointerId);
  });
  veldWrap.addEventListener('pointermove', e => {
    if (!bezig) return;
    const s = pos(e.clientX, e.clientY);
    const l = bezig.punten[bezig.punten.length-1];
    if (Math.hypot(s.x-l[0], s.y-l[1]) > 1) bezig.punten.push([+s.x.toFixed(1), +s.y.toFixed(1)]);
    tijdelijk.setAttribute('d', 'M' + bezig.punten.map(p => p.join(' ')).join(' L'));
  });
  veldWrap.addEventListener('pointerup', () => {
    if (!bezig) return;
    const lengte = bezig.punten.reduce((t,p,i) => i ? t+Math.hypot(p[0]-bezig.punten[i-1][0], p[1]-bezig.punten[i-1][1]) : 0, 0);
    if (lengte >= 2){ B.tekeningen.push(bezig); }
    else if (tijdelijk){ tijdelijk.remove(); }
    bezig = null; tijdelijk = null;
    pushUndo();
  });

  /* ---------- tools ---------- */
  function zetTeken(aan){ teken.style.pointerEvents = aan ? 'auto' : 'none'; }
  zetTeken(false);

  host.querySelectorAll('.tb-tool[data-tool]').forEach(b => {
    b.onclick = () => {
      const t = b.dataset.tool;
      if (t === 'wis'){
        if (B.tekeningen.length && confirm('Alle tekeningen wissen?')){
          B.tekeningen = []; renderTekeningen(); pushUndo();
        }
        return;
      }
      if (t === 'volg'){
        volgAan = !volgAan;
        b.classList.toggle('aan', volgAan);
        if (volgAan){
          tool = 'select';
          host.querySelectorAll('.tb-tool[data-tool]').forEach(x => x.classList.toggle('actief', x.dataset.tool === 'select'));
          zetTeken(false);
          hint('Volg-loopweg aan — sleep een speler, de loopweg tekent mee');
        } else hint('Volg-loopweg uit');
        return;
      }
      volgAan = false; host.querySelector('#tbVolg').classList.remove('aan');
      tool = t;
      host.querySelectorAll('.tb-tool[data-tool]').forEach(x => x.classList.toggle('actief', x === b));
      zetTeken(t === 'potlood');
      const tk = { select:'Sleep spelers om ze te verplaatsen',
        potlood:'Teken vrij met je vinger',
        gum:'Tik een object om het te verwijderen' };
      if (tk[t]) hint(tk[t]);
    };
  });
  host.querySelectorAll('.tb-tool[data-add]').forEach(b => {
    b.onclick = () => {
      if (b.dataset.add === 'bal'){
        B.objecten.push({ soort:'bal', x:50, y:50 }); renderObjecten(); pushUndo();
        hint('Bal geplaatst — sleep hem waar je wilt');
      } else {
        // Tegenstander wordt meteen neergezet als effen pion, zonder rugnummer
        // te hoeven kiezen. Meerdere tikken = meerdere pionnen, licht gespreid.
        const n = B.objecten.filter(o => o.soort === 'tegen').length;
        B.objecten.push({ soort:'tegen', nr:'', x: 38 + (n%4)*8, y: 30 + Math.floor(n/4)*10 });
        renderObjecten(); pushUndo(); hint('Tegenstander geplaatst — sleep hem waar je wilt');
      }
    };
  });
  host.querySelectorAll('.tb-kleur').forEach(k => {
    k.onclick = () => { kleur = k.dataset.kleur;
      host.querySelectorAll('.tb-kleur').forEach(x => x.classList.toggle('actief', x === k)); };
  });

  /* ---------- top-acties ---------- */
  host.querySelector('#tbNaam').onchange = e => { B.naam = e.target.value.trim() || 'Tactiek'; };
  host.querySelector('#tbTerug').onclick = sluit;
  host.querySelector('#tbUndo').onclick = () => {
    if (undoStack.length < 2) return;
    undoStack.pop();
    const s = JSON.parse(undoStack[undoStack.length-1]);
    B.objecten = s.objecten; B.tekeningen = s.tekeningen;
    renderObjecten(); renderTekeningen();
  };
  const bewaarBtn = host.querySelector('#tbBewaar');
  bewaarBtn.onclick = async () => {
    bewaarBtn.disabled = true; bewaarBtn.textContent = '…';
    await bewaarBoard();
    bewaarBtn.disabled = false; bewaarBtn.textContent = 'Bewaren';
  };
  host.querySelector('#tbDeel').onclick = () => deelAlsAfbeelding(w);
}

/* Sluit het fullscreen-tactiekbord. Aangeroepen door de kruisknop/‹ én door
   stapTerug() in state.js bij een hardware-terugtik. Het history-vangnet wordt
   stil verbruikt (zelfde patroon als sluitPdfViewer): bij sluiten via de eigen
   knop haalt vangnetStilTerugAlsNodig() het vangnet weg; bij de terugknop is
   het vangnet al verbruikt en is die aanroep een no-op. */
export function sluitTactiekbord(){
  const wasOpen = !!_board;
  if (_board){ _board.remove(); _board = null; }
  B = null; undoStack = [];
  vangnetStilTerugAlsNodig(wasOpen);
}

/* ==================== DELEN ALS AFBEELDING ====================
   Tekent het huidige board op een <canvas> en biedt het aan via de native
   share sheet (of downloadt het als er geen Web Share met bestanden is). Er
   gaat niets naar Storage — de afbeelding wordt ter plekke gegenereerd. */
async function deelAlsAfbeelding(w){
  const W = 900, H = 1200;                 // 3:4, zelfde als het veld
  const cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  const c = cv.getContext('2d');

  // gras (banen)
  for (let i = 0; i < 8; i++){
    c.fillStyle = i % 2 ? '#28713F' : '#2E7D46';
    c.fillRect(0, i*H/8, W, H/8);
  }
  // lijnen
  c.strokeStyle = 'rgba(255,255,255,.82)'; c.lineWidth = 3;
  c.beginPath(); c.moveTo(0, H/2); c.lineTo(W, H/2); c.stroke();               // middenlijn
  c.beginPath(); c.arc(W/2, H/2, W*0.12, 0, Math.PI*2); c.stroke();            // middencirkel
  const box = (yTop, hFrac, wFrac) => {
    const bw = W*wFrac, x = (W-bw)/2, bh = H*hFrac;
    c.strokeRect(x, yTop ? 0 : H-bh, bw, bh);
  };
  box(true, 0.13, 0.56); box(false, 0.13, 0.56);   // 16m
  box(true, 0.055, 0.28); box(false, 0.055, 0.28); // 5m

  // tekeningen
  const px = v => v/100*W, py = v => v/100*H;
  for (const t of B.tekeningen){
    if (!(t.punten||[]).length) continue;
    c.strokeStyle = t.kleur || '#F2C94C'; c.lineWidth = 4;
    c.setLineDash(t.soort === 'loopweg' ? [12,9] : []);
    c.beginPath();
    t.punten.forEach((p,i) => i ? c.lineTo(px(p[0]), py(p[1])) : c.moveTo(px(p[0]), py(p[1])));
    c.stroke();
    // pijlpunt
    if ((t.soort === 'loopweg' || t.soort === 'pass') && t.punten.length >= 2){
      const a = t.punten[t.punten.length-2], b = t.punten[t.punten.length-1];
      const ang = Math.atan2(py(b[1])-py(a[1]), px(b[0])-px(a[0]));
      c.setLineDash([]); c.fillStyle = t.kleur || '#F2C94C';
      c.beginPath();
      c.moveTo(px(b[0]), py(b[1]));
      c.lineTo(px(b[0])-14*Math.cos(ang-0.4), py(b[1])-14*Math.sin(ang-0.4));
      c.lineTo(px(b[0])-14*Math.cos(ang+0.4), py(b[1])-14*Math.sin(ang+0.4));
      c.closePath(); c.fill();
    }
  }
  c.setLineDash([]);

  // objecten
  const ox = v => v/100*W, oy = v => v/100*H;
  for (const o of B.objecten){
    const x = ox(o.x), y = oy(o.y);
    if (o.soort === 'bal'){
      c.fillStyle = '#f2f2f0'; c.strokeStyle = '#222'; c.lineWidth = 3;
      c.beginPath(); c.arc(x, y, 15, 0, Math.PI*2); c.fill(); c.stroke();
      continue;
    }
    c.fillStyle = o.soort === 'tegen' ? '#2B6FD6' : (o.keeper ? '#F2A33C' : '#E20613');
    c.strokeStyle = 'rgba(255,255,255,.9)'; c.lineWidth = 3;
    c.beginPath(); c.arc(x, y, 22, 0, Math.PI*2); c.fill(); c.stroke();
    c.fillStyle = '#fff'; c.font = 'bold 26px Inter, sans-serif';
    c.textAlign = 'center'; c.textBaseline = 'middle';
    c.fillText(String(o.nr ?? ''), x, y+1);
    if (o.naam){
      c.font = '600 18px Inter, sans-serif';
      c.fillStyle = '#fff'; c.strokeStyle = 'rgba(0,0,0,.7)'; c.lineWidth = 3;
      c.strokeText(o.naam, x, y+38); c.fillText(o.naam, x, y+38);
    }
  }

  cv.toBlob(async blob => {
    if (!blob){ meld('Afbeelding maken mislukt'); return; }
    const bestand = new File([blob], (B.naam || 'tactiek') + '.png', { type: 'image/png' });
    try {
      if (navigator.canShare && navigator.canShare({ files: [bestand] })){
        await navigator.share({ files: [bestand], title: B.naam || 'Tactiek' });
        return;
      }
    } catch(e){ /* gebruiker annuleerde of niet ondersteund → val terug op download */ }
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = bestand.name; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }, 'image/png');
}
