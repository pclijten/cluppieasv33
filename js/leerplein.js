/* ==========================================================================
   leerplein.js — Het Leerplein: de app legt een speelprincipe uit.

   Route: wedstrijd → Tactiekbord → Leerplein. De coach kiest een leerthema en
   krijgt op één scherm: het principe, waarom het ertoe doet, hoe je het aan
   spelers uitlegt, coachpunten, en voorbeeld-loopacties die zichzelf op het
   veld tekenen. Bedoeld om aan spelers uit te leggen op het scherm van de coach
   (niet iets dat spelers zelf op hun device doen).

   De inhoud komt uit leerinhoud.js (vaste, aanpasbare tekst — geen AI per keer).
   Een voorbeeld kan met "Overnemen op kladbord" op een bewerkbaar tactiekbord
   worden gezet, waar de coach het kan aanpassen en zelf verder tekenen.

   Zichtbaarheid: alleen als de module 'leerplein' aanstaat voor het team
   (beheerder regelt dit in het clubdashboard, net als de andere modules).

   Afgestemd op JO12/JO13-niveau.
   ========================================================================== */

import { esc, spelerNr, bewaakTerug, vangnetStilTerugAlsNodig } from './state.js?v=20260828d';
import { LEERCURVE, bouwSlots } from './config.js?v=20260828d';
import { LEERINHOUD } from './leerinhoud.js?v=20260828d';
import { telNav } from './tracker.js?v=20260828d';

const NS = 'http://www.w3.org/2000/svg';

/* domein-kleur per thema, afgeleid uit de leercurve */
function domeinVan(thema){
  const t = LEERCURVE.find(x => x.thema === thema);
  return t ? t.domein : 'TA';
}
const DOMEIN_KLEUR = { TE:'#3b82f6', TA:'#a855f7', FY:'#f59e0b', ME:'#10b981', GE:'#ef4444' };

let _host = null;           // overlay-element (of null)
let _w = null;              // huidige wedstrijd-context
let _thema = null;          // gekozen thema-naam
let _vbNu = 0;              // index van het getoonde voorbeeld
let _extra = null;          // ingevoegde opstelling-spelers (context, grijs)

/* ==================== INGANG ==================== */

export function openLeerplein(w){
  _w = w; _thema = null; _vbNu = 0; _extra = null;
  telNav('tactiek:leerplein', 'open');
  _host = document.createElement('div');
  _host.className = 'lp-scherm';
  document.body.appendChild(_host);
  bewaakTerug();
  toonThemaKeuze();
}

export function sluitLeerplein(){
  const wasOpen = !!_host;
  if (_host){ _host.remove(); _host = null; }
  _thema = null; _extra = null;
  vangnetStilTerugAlsNodig(wasOpen);
}

/* ==================== THEMA-KEUZE ==================== */

function toonThemaKeuze(){
  const themas = Object.keys(LEERINHOUD);
  const rijen = themas.map(naam => {
    const dom = domeinVan(naam);
    const kleur = DOMEIN_KLEUR[dom] || '#a855f7';
    const principeKort = (LEERINHOUD[naam].principe || '').split(':')[0];
    return `
      <button class="lp-thema" data-thema="${esc(naam)}">
        <span class="lp-stip" style="background:${kleur}"></span>
        <span class="lp-thema-tekst">
          <strong>${esc(naam)}</strong>
          <span>${esc(principeKort)}</span>
        </span>
        <span class="lp-klaar">● klaar</span>
      </button>`;
  }).join('');

  _host.innerHTML = `
    <div class="lp-top">
      <button class="lp-top-btn ghost" id="lpTerug" aria-label="Terug">‹</button>
      <div class="lp-titel">Leerplein</div>
    </div>
    <div class="lp-inhoud">
      <div class="lp-groep-kop">Kies een leerthema</div>
      ${rijen || '<div class="lp-leeg">Er is nog geen leerinhoud beschikbaar.</div>'}
      <p class="lp-voet">De app laat per thema zien hoe je het aan je spelers uitlegt, met voorbeeld-loopacties op het veld.</p>
    </div>`;

  _host.querySelector('#lpTerug').onclick = () => sluitLeerplein();
  _host.querySelectorAll('.lp-thema').forEach(b => {
    b.onclick = () => { _thema = b.dataset.thema; _vbNu = 0; _extra = null;
      telNav('leerplein:thema', 'open'); toonThema(); };
  });
}

/* ==================== THEMA-DETAIL (veld + uitleg) ==================== */

function toonThema(){
  const th = LEERINHOUD[_thema];
  const dom = domeinVan(_thema);
  const kleur = DOMEIN_KLEUR[dom] || '#a855f7';
  _host.innerHTML = `
    <div class="lp-top">
      <button class="lp-top-btn ghost" id="lpTerug" aria-label="Terug">‹</button>
      <div class="lp-titel">${esc(_thema)}</div>
      <div class="lp-dom" style="background:${kleur}">${esc(dom)}</div>
    </div>

    <div class="lp-stage">
      <div class="lp-veld-wrap" id="lpVeldWrap">
        <div class="lp-veld"></div>
        <div class="lp-lijn lp-midden"></div>
        <div class="lp-lijn lp-cirkel"></div>
        <svg class="lp-teken" id="lpTeken" viewBox="0 0 100 100" preserveAspectRatio="none">
          <defs>
            <marker id="lpLoop" markerWidth="7" markerHeight="7" refX="5.5" refY="3" orient="auto"><path d="M0,0 L6,3 L0,6 Z" fill="var(--loop,#F2C94C)"/></marker>
            <marker id="lpPass" markerWidth="7" markerHeight="7" refX="5.5" refY="3" orient="auto"><path d="M0,0 L6,3 L0,6 Z" fill="#fff"/></marker>
          </defs>
        </svg>
        <div class="lp-objecten" id="lpObjecten"></div>
        <button class="lp-veld-actie" id="lpOpstelling">+ Opstelling invoegen</button>
        <div class="lp-legenda">
          <div class="lp-rij"><span class="lp-sample" style="border-color:var(--loop,#F2C94C);border-top-style:dashed"></span> loopactie</div>
          <div class="lp-rij"><span class="lp-sample" style="border-color:#fff"></span> pass</div>
          <div class="lp-rij"><span class="lp-dot" style="background:#E20613"></span> eigen speler</div>
          <div class="lp-rij"><span class="lp-dot" style="background:#2B6FD6"></span> tegenstander</div>
        </div>
      </div>
    </div>

    <div class="lp-paneel" id="lpPaneel"></div>`;

  _host.querySelector('#lpTerug').onclick = () => { _thema = null; toonThemaKeuze(); };
  _host.querySelector('#lpOpstelling').onclick = () => openOpstellingKiezer();
  toonVoorbeeld(true);
}

/* teken het huidige voorbeeld op het veld */
function toonVoorbeeld(animatie){
  const th = LEERINHOUD[_thema];
  const vb = th.voorbeelden[_vbNu];
  const teken = _host.querySelector('#lpTeken');
  const objLaag = _host.querySelector('#lpObjecten');
  teken.querySelectorAll('path').forEach(p => p.remove());
  objLaag.innerHTML = '';

  // ingevoegde opstelling als context (grijze pionnen), indien gekozen
  if (_extra){
    _extra.forEach(s => objLaag.appendChild(maakChip(s.nr, s.x, s.y, 'context')));
  }
  // spelers uit het voorbeeld
  vb.spelers.forEach(s => objLaag.appendChild(maakChip(s.nr, s.x, s.y, s.kant === 'tegen' ? 'tegen' : 'eigen')));
  // bal
  if (vb.bal){
    const b = document.createElement('div');
    b.className = 'lp-obj';
    b.style.left = vb.bal[0] + '%'; b.style.top = vb.bal[1] + '%';
    b.innerHTML = '<div class="lp-bal"></div>';
    objLaag.appendChild(b);
  }
  // lijnen (met kleine vertraging voor een "opbouw"-effect)
  vb.lijnen.forEach((ln, i) => {
    const draw = () => {
      const path = document.createElementNS(NS, 'path');
      path.setAttribute('d', 'M' + ln.punten.map(p => p.join(' ')).join(' L'));
      path.setAttribute('stroke', ln.soort === 'pass' ? '#fff' : 'var(--loop,#F2C94C)');
      path.setAttribute('stroke-width', '3');
      path.setAttribute('fill', 'none');
      path.setAttribute('stroke-linecap', 'round');
      path.setAttribute('stroke-linejoin', 'round');
      path.setAttribute('vector-effect', 'non-scaling-stroke');
      if (ln.soort === 'loopweg') path.setAttribute('stroke-dasharray', '7 5');
      path.setAttribute('marker-end', ln.soort === 'pass' ? 'url(#lpPass)' : 'url(#lpLoop)');
      if (animatie){ path.style.opacity = '0'; path.style.transition = 'opacity .4s'; requestAnimationFrame(() => path.style.opacity = '1'); }
      teken.appendChild(path);
    };
    animatie ? setTimeout(draw, i * 450) : draw();
  });

  renderPaneel();
}

function maakChip(nr, x, y, soort){
  const el = document.createElement('div');
  el.className = 'lp-obj';
  el.style.left = x + '%'; el.style.top = y + '%';
  el.innerHTML = `<div class="lp-chip ${soort}">${esc(String(nr ?? ''))}</div>`;
  return el;
}

function renderPaneel(){
  const th = LEERINHOUD[_thema];
  const vb = th.voorbeelden[_vbNu];
  const paneel = _host.querySelector('#lpPaneel');
  paneel.innerHTML = `
    <div class="lp-principe"><span class="lp-badge">PRINCIPE</span>${esc(th.principe)}</div>
    <div class="lp-blok"><h4>Waarom</h4><p>${esc(th.waarom)}</p></div>
    <div class="lp-blok"><h4>Zo leg je het uit</h4><p>${esc(th.uitleg)}</p></div>
    <div class="lp-blok"><h4>Let op tijdens het uitleggen</h4>
      <ul class="lp-coachpunten">${(th.coachpunten||[]).map(c => `<li>${esc(c)}</li>`).join('')}</ul></div>
    <div class="lp-blok">
      <div class="lp-vb-kop"><h4>Voorbeeld-loopacties</h4>
        <div class="lp-vb-nav"><button id="lpVorig" aria-label="Vorige">‹</button><button id="lpVolg" class="primary" aria-label="Volgende">›</button></div></div>
      <div class="lp-vb-kaart">
        <div class="lp-vb-naam">${esc(vb.naam)}</div>
        <div class="lp-vb-toel">${esc(vb.toelichting || '')}</div>
        <div class="lp-vb-teller">Voorbeeld ${_vbNu + 1} van ${th.voorbeelden.length}</div>
        <div class="lp-vb-acties">
          <button class="lp-btn-toon" id="lpToon">Opnieuw tonen</button>
          <button class="lp-btn-over" id="lpOver">Overnemen op kladbord</button>
        </div>
      </div>
    </div>`;

  paneel.querySelector('#lpVorig').onclick = () => { _vbNu = (_vbNu - 1 + th.voorbeelden.length) % th.voorbeelden.length; toonVoorbeeld(true); };
  paneel.querySelector('#lpVolg').onclick  = () => { _vbNu = (_vbNu + 1) % th.voorbeelden.length; toonVoorbeeld(true); };
  paneel.querySelector('#lpToon').onclick  = () => toonVoorbeeld(true);
  paneel.querySelector('#lpOver').onclick  = () => overnemenOpKladbord();
}

/* ==================== OPSTELLING INVOEGEN ==================== */

function openOpstellingKiezer(){
  const w = _w;
  const aantal = Number(w.periodes || 4);
  const heeft = nr => Object.keys(((w.kwarten||{})[nr]||{}).lineup || {}).length > 0;
  const periodes = [];
  for (let i = 1; i <= aantal; i++) if (heeft(i)) periodes.push(i);

  const sheet = document.createElement('div');
  sheet.className = 'lp-sheet-bg';
  sheet.innerHTML = `
    <div class="lp-sheet">
      <div class="lp-sheet-kop"><h3>Opstelling invoegen</h3><button class="lp-sluit" aria-label="Sluiten">✕</button></div>
      <div class="lp-sub">Zet de spelers van een opstelling op het veld (grijs), naast de voorbeeld-spelers.</div>
      ${periodes.length ? periodes.map(nr => `
        <button class="lp-opst" data-nr="${nr}"><strong>Opstelling ${periodeLabel(w, nr)}</strong>
          <span>${aantalSpelers(w, nr)} spelers</span></button>`).join('') :
        '<div class="lp-leeg">Deze wedstrijd heeft nog geen opstelling.</div>'}
      ${_extra ? '<button class="lp-opst lp-opst-weg" data-nr="weg"><strong>Voorbeeld-spelers alleen</strong><span>haal de ingevoegde opstelling weg</span></button>' : ''}
    </div>`;
  document.body.appendChild(sheet);
  const dicht = () => sheet.remove();
  sheet.querySelector('.lp-sluit').onclick = dicht;
  sheet.onclick = e => { if (e.target === sheet) dicht(); };
  sheet.querySelectorAll('.lp-opst').forEach(b => {
    b.onclick = () => {
      if (b.dataset.nr === 'weg'){ _extra = null; }
      else { _extra = opstellingSpelers(w, Number(b.dataset.nr)); }
      dicht(); toonVoorbeeld(false);
    };
  });
}

function periodeLabel(w, nr){
  const p = Number(w.periodes || 4);
  return (p === 2 ? 'helft ' : 'kwart ') + nr;
}
function aantalSpelers(w, nr){
  return Object.keys(((w.kwarten||{})[nr]||{}).lineup || {}).length;
}
/* Spelers van een periode als {nr,x,y} — posities uit bouwSlots, nummers via
   spelerNr. */
function opstellingSpelers(w, nr){
  const k = (w.kwarten || {})[nr] || {};
  const formatie = k.formatie || w.formatie;
  const slots = bouwSlots(w.format, formatie);
  const lineup = k.lineup || {};
  const out = [];
  for (const sl of slots){
    const pid = lineup[sl.id];
    if (!pid) continue;
    const n = spelerNr(pid);
    out.push({ nr: n === '·' ? '' : n, x: sl.x, y: sl.y });
  }
  return out;
}

/* ==================== OVERNEMEN OP KLADBORD ==================== */

function overnemenOpKladbord(){
  const th = LEERINHOUD[_thema];
  const vb = th.voorbeelden[_vbNu];
  // zet leerplein-format om naar tactiekbord-objecten
  const objecten = [];
  if (_extra){ _extra.forEach(s => objecten.push({ soort:'speler', nr:s.nr, naam:'', x:s.x, y:s.y })); }
  vb.spelers.forEach(s => objecten.push({
    soort: s.kant === 'tegen' ? 'tegen' : 'speler', nr: s.nr, naam:'', x: s.x, y: s.y,
  }));
  if (vb.bal){ objecten.push({ soort:'bal', x: vb.bal[0], y: vb.bal[1] }); }
  const tekeningen = (vb.lijnen || []).map(ln => ({
    soort: ln.soort, kleur: ln.soort === 'pass' ? '#FFFFFF' : '#F2C94C',
    punten: ln.punten.map(p => [...p]),
  }));
  const naam = _thema + ' — ' + vb.naam;
  telNav('leerplein:overnemen', 'tegel');
  const w = _w;
  sluitLeerplein();
  import('./tactiekbord.js?v=20260828d').then(m => m.openBordMet(w, objecten, tekeningen, naam));
}
