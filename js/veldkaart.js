/* ==================== VELDKAART ====================
   [20261120e] Waar ligt het veld waarop we spelen? Goedgekeurde mockup
   "Veldkaart bij wedstrijden" (20 nov), inclusief deelvelden en fout melden.

   Wat de coach ziet
     • Het veld-label bij een wedstrijd (Nu-kaart, wedstrijdvoorbereiding) is
       een knop met een kaarticoon. Die opent een luchtfoto van het sportpark
       met het veld (of het deelveld, bv. "2a voor") rood gemarkeerd.
     • Praktisch in de wedstrijdvoorbereiding toont dezelfde kaart klein.
     • Uitwedstrijd en het veld is nog niet bekend: de coach tikt de plek aan
       op de luchtfoto. Dat geldt daarna voor alle teams van de club.
     • "Klopt er iets niet?" stuurt een melding naar clubbeheer.
   Wat clubbeheer ziet (Club → Sportpark)
     • Het eigen sportpark: velden als rechthoek op de luchtfoto (verschuiven,
       draaien, maat), per veld een indeling heel / in tweeën / in vieren met
       eigen namen, en een controle welke veldnamen Sportlink gebruikt.
     • Meldingen van coaches, met "Opgelost" (optioneel bericht aan het team).

   Opslag (altijd merge / eigen document)
     clubs/{clubId}/sportparken/{parkId}
        parkId 'eigen' = eigen sportpark (alleen clubbeheer schrijft),
        anders 'p-<naam-plaats>' voor sportparken van tegenstanders.
        { naam, adres, plaats, lat, lon, zoom, eigen, velden:[{ id, naam, lat, lon,
          lengte?, breedte?, hoek?, indeling?, delen?, door?, ms }], bijgewerktMs }
     clubs/{clubId}/veldmeldingen/{auto}
        { park, parkNaam, veld, reden, toelichting, datum, tegenstander, wid,
          teamId, teamNaam, door, ms, status, opgelostMs? }
   Regels: zie VELDKAART-RULES.md.

   Externe diensten (geen sleutel, geen persoonsgegevens):
     luchtfoto  PDOK / Beeldmateriaal Nederland (CC BY 4.0), tegels EPSG:3857
     adres      PDOK Locatieserver (alleen het adres van het sportpark)
   Geen GPS of locatie van de gebruiker. */
import { db, doc, getDoc, setDoc, addDoc, updateDoc, collection, getDocs, query, where, serverTimestamp } from './firebase.js?v=20261106r';
import { S, esc, meld, isBeheerder } from './state.js?v=20261111g';
import { ico } from './icons.js?v=20261106r';
import { telGebruik } from './tracker.js?v=20261111g';

/* ---------- kaartwiskunde (web-mercator, tegels van 256 px) ---------- */
const TS = 256, ZMIN = 15, ZMAX = 20;
const TEGEL = (laag, z, x, y) => `https://service.pdok.nl/hwh/luchtfotorgb/wmts/v1_0/${laag}/EPSG:3857/${z}/${x}/${y}.jpeg`;
function naarPx(lat, lon, z){
  const n = TS * 2 ** z, s = Math.sin(lat * Math.PI / 180);
  return { x:(lon + 180) / 360 * n, y:(0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * n };
}
function naarLL(x, y, z){
  const n = TS * 2 ** z, m = Math.PI - 2 * Math.PI * y / n;
  return { lat:180 / Math.PI * Math.atan(Math.sinh(m)), lon:x / n * 360 - 180 };
}
const mpp = (lat, z) => 156543.03392 * Math.cos(lat * Math.PI / 180) / 2 ** z;
const RAD = Math.PI / 180;
/* verschil tussen twee punten in meters op het scherm (x oost, y zuid) */
function meterVerschil(a, b){
  return { x:(b.lon - a.lon) * 111320 * Math.cos(a.lat * RAD), y:-(b.lat - a.lat) * 110540 };
}
function verschuif(p, dx, dy){
  return { lat:p.lat - dy / 110540, lon:p.lon + dx / (111320 * Math.cos(p.lat * RAD)) };
}
const rond = (n, d = 6) => Math.round(n * 10 ** d) / 10 ** d;

/* ---------- veldnamen ---------- */
/* "Veld 2A voor", "2a-voor" en "2 a voor" zijn allemaal "2avoor". */
export const veldNorm = s => String(s || '').toLowerCase().replace(/veld/g, '').replace(/[^a-z0-9]+/g, '');
const metVeld = t => { const s = String(t || '').trim(); return !s ? '' : /^\d/.test(s) ? `Veld ${s}` : s.charAt(0).toUpperCase() + s.slice(1); };
const nrVan = v => String(v?.naam || '').replace(/^\s*veld\s*/i, '').trim() || '?';
/* [sleutel, x, y, b, h] als fractie van het veld (x langs de lengte) */
export const INDELING = {
  heel: [],
  twee: [['a', 0, 0, .5, 1], ['b', .5, 0, .5, 1]],
  vier: [['a voor', 0, 0, .5, .5], ['b voor', .5, 0, .5, .5], ['a achter', 0, .5, .5, .5], ['b achter', .5, .5, .5, .5]],
};
const delenVan = v => INDELING[v?.indeling] || [];
const deelNaam = (v, k) => String(v?.delen?.[k] || `${nrVan(v)}${k}`).trim();

/* Welk (deel)veld bedoelt Sportlink of de coach? Exacte naam eerst, dan een
   deelnaam, dan alleen het nummer (dan weten we het veld, niet het deel). */
export function zoekDoel(park, veldTekst){
  const n = veldNorm(veldTekst), velden = park?.velden || [];
  if (!n || !velden.length) return null;
  for (const v of velden) if (veldNorm(v.naam) === n) return { veld:v };
  for (const v of velden) for (const [k] of delenVan(v)) if (veldNorm(deelNaam(v, k)) === n) return { veld:v, deel:k };
  const nr = (n.match(/^\d+/) || [])[0];
  if (nr) for (const v of velden) if (veldNorm(v.naam) === nr) return { veld:v, deelOnbekend:true };
  return null;
}
/* Middelpunt van een (deel)veld in lat/lon. */
function middenVan(v, deel){
  const d = deel ? delenVan(v).find(([k]) => k === deel) : null;
  if (!d || !v.lengte) return { lat:v.lat, lon:v.lon };
  const lx = (d[1] + d[3] / 2 - .5) * v.lengte, ly = (d[2] + d[4] / 2 - .5) * v.breedte, h = (v.hoek || 0) * RAD;
  return verschuif(v, lx * Math.cos(h) - ly * Math.sin(h), lx * Math.sin(h) + ly * Math.cos(h));
}
function binnenVeld(v, p){
  if (!v.lengte) { const d = meterVerschil(v, p); return Math.hypot(d.x, d.y) < 15; }
  const d = meterVerschil(v, p), h = (v.hoek || 0) * RAD;
  const u = d.x * Math.cos(h) + d.y * Math.sin(h), w = -d.x * Math.sin(h) + d.y * Math.cos(h);
  return Math.abs(u) <= v.lengte / 2 && Math.abs(w) <= v.breedte / 2;
}

/* ---------- wedstrijd → kaartinfo ---------- */
function parkSleutel(w){
  if (w.thuis) return 'eigen';
  const acc = w.slAccommodatie || {};
  const basis = acc.naam ? `${acc.naam} ${acc.plaats || ''}`
    : (w.adres || acc.adres) ? `${w.adres || acc.adres} ${acc.plaats || ''}`
    : w.locatie ? `${w.locatie} ${w.plaats || ''}` : '';
  const k = basis.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80);
  return k ? 'p-' + k : '';
}
export function infoVan(w, team){
  const acc = w?.slAccommodatie || {}, t = team || S.team || {};
  return {
    club:t.club || S.team?.club || S.clubId || '', park:parkSleutel(w || {}), thuis:!!w?.thuis,
    veld:String(w?.veld || w?.slVeld || '').trim(), kleed:String(w?.kleedkamer || w?.slKleedkamer || '').trim(),
    naam:String(acc.naam || w?.locatie || '').trim(), adres:String(w?.adres || [acc.adres, acc.plaats].filter(Boolean).join(', ')).trim(),
    plaats:String(acc.plaats || w?.plaats || '').trim(), datum:w?.datum || '', tegen:w?.tegenstander || '',
    wid:w?.id || '', teamId:t.id || S.teamId || '', team:t.naam || S.team?.naam || '',
  };
}
const kanKaart = i => !!(i.club && i.park);
/* Het veld-label als knop (plekHtml in nu-scherm.js). Zonder club of sportpark
   blijft het een gewoon label. */
export function veldPilHtml(w, label){
  const i = infoVan(w);
  if (!label) return '';
  if (!kanKaart(i)) return `<span class="nu-plek-pil">${esc(label)}</span>`;
  return `<button type="button" class="nu-plek-pil vk-pil" data-vk="${esc(JSON.stringify(i))}" aria-label="${esc(label)}, toon op de kaart">${esc(label)}${ico('match-location', 14)}</button>`;
}

/* ---------- Firestore ---------- */
const parkRef = (club, id) => doc(db, 'clubs', club, 'sportparken', id);
const meldCol = club => collection(db, 'clubs', club, 'veldmeldingen');
const _park = new Map();
function laadPark(club, id, vers){
  const k = club + '/' + id;
  if (!vers && _park.has(k)) return _park.get(k);
  const p = getDoc(parkRef(club, id)).then(s => s.exists() ? { id, ...s.data() } : null)
    .catch(e => { console.warn('[veldkaart] sportpark laden', e); _park.delete(k); return { fout:e?.code || 'fout' }; });
  _park.set(k, p);
  return p;
}
async function bewaarPark(club, id, data){
  const k = club + '/' + id, volledig = { ...data, bijgewerktMs:Date.now() };
  try {
    await setDoc(parkRef(club, id), volledig, { merge:true });
    const oud = await (_park.get(k) || Promise.resolve(null));
    _park.set(k, Promise.resolve({ ...(oud && !oud.fout ? oud : {}), id, ...volledig }));
    return true;
  } catch (e){
    console.error('[veldkaart] opslaan', e);
    meld(e?.code === 'permission-denied' ? 'Opslaan mislukt: geen rechten. Zijn de Firestore-regels voor de veldkaart gepubliceerd?' : 'Opslaan mislukt, geen verbinding. Probeer het zo opnieuw.');
    return false;
  }
}
const _club = new Map();
function laadClub(club){
  if (S.club?.id === club) return Promise.resolve(S.club);
  if (!_club.has(club)) _club.set(club, getDoc(doc(db, 'clubs', club)).then(s => s.exists() ? { id:club, ...s.data() } : null).catch(() => null));
  return _club.get(club);
}
async function isClubAdmin(club){
  if (isBeheerder()) return true;
  const c = await laadClub(club);
  return c?.admins?.[S.user?.uid] === true;
}

/* ---------- adres → coördinaat (PDOK Locatieserver) ---------- */
const _geo = new Map();
function zoekAdres(q){
  q = String(q || '').trim();
  if (!q) return Promise.resolve(null);
  if (_geo.has(q)) return _geo.get(q);
  const p = fetch(`https://api.pdok.nl/bzk/locatieserver/search/v3_1/free?q=${encodeURIComponent(q)}&rows=1&fl=centroide_ll,weergavenaam`)
    .then(r => r.json()).then(j => {
      const d = j?.response?.docs?.[0], m = /POINT\(([-\d.]+) ([-\d.]+)\)/.exec(d?.centroide_ll || '');
      return m ? { lat:+m[2], lon:+m[1], naam:d.weergavenaam || q } : null;
    }).catch(e => { console.warn('[veldkaart] adres zoeken', e); _geo.delete(q); return null; });
  _geo.set(q, p);
  return p;
}

/* ==================== KAART (eigen kleine tegelviewer) ==================== */
class Kaart {
  constructor(el, o){
    Object.assign(this, { el, lat:o.lat, lon:o.lon, z:o.z || 17, interactief:!!o.interactief, onTik:o.onTik || null, lagen:o.lagen || (() => '') });
    el.classList.add('vk-kaart');
    el.classList.toggle('vk-vast', !this.interactief);
    el.innerHTML = `<div class="vk-schuif"><div class="vk-tegels"></div><div class="vk-lagen"></div></div>
      ${this.interactief ? `<div class="vk-zoom"><button type="button" data-vk-z="1" aria-label="Inzoomen">+</button><button type="button" data-vk-z="-1" aria-label="Uitzoomen">−</button></div>` : ''}
      <span class="vk-bron">Luchtfoto: Beeldmateriaal.nl / PDOK</span>`;
    this.schuif = el.querySelector('.vk-schuif');
    this.tegels = el.querySelector('.vk-tegels');
    this.lagenEl = el.querySelector('.vk-lagen');
    /* HR-laag eerst; ontbreekt een tegel, dan de 25 cm-laag */
    this.tegels.addEventListener('error', e => {
      const i = e.target;
      if (i.tagName !== 'IMG') return;
      if (i.dataset.alt && !i.dataset.f){ i.dataset.f = '1'; i.src = i.dataset.alt; }
      else i.style.visibility = 'hidden';   /* geen beeld: liever leeg dan een kapot-icoon */
    }, true);
    if (this.interactief) this.bindInteractie();
    if (typeof ResizeObserver !== 'undefined'){
      this._ro = new ResizeObserver(() => { if (this.el.isConnected) this.teken(); else this._ro.disconnect(); });
      this._ro.observe(el);
    }
    this.teken();
  }
  bindInteractie(){
    const el = this.el;
    el.querySelectorAll('[data-vk-z]').forEach(b => b.onclick = e => { e.stopPropagation(); this.zoom(+b.dataset.vkZ); });
    let start = null;
    el.addEventListener('pointerdown', e => {
      if (e.target.closest('button')) return;
      start = { x:e.clientX, y:e.clientY, id:e.pointerId, bewogen:false };
      try { el.setPointerCapture(e.pointerId); } catch {}
    });
    el.addEventListener('pointermove', e => {
      if (!start || e.pointerId !== start.id) return;
      const dx = e.clientX - start.x, dy = e.clientY - start.y;
      if (!start.bewogen && Math.hypot(dx, dy) < 6) return;
      start.bewogen = true;
      this.schuif.style.transform = `translate(${dx}px,${dy}px)`;
    });
    const eind = e => {
      if (!start || e.pointerId !== start.id) return;
      const s = start; start = null;
      this.schuif.style.transform = '';
      if (s.bewogen){
        const c = naarPx(this.lat, this.lon, this.z), n = naarLL(c.x - (e.clientX - s.x), c.y - (e.clientY - s.y), this.z);
        this.lat = n.lat; this.lon = n.lon; this.teken();
      } else if (e.type === 'pointerup' && this.onTik){
        const r = el.getBoundingClientRect();
        this.onTik(this.ll(e.clientX - r.left, e.clientY - r.top));
      }
    };
    el.addEventListener('pointerup', eind);
    el.addEventListener('pointercancel', eind);
    let wielTijd = 0;
    el.addEventListener('wheel', e => {
      e.preventDefault();
      const nu = Date.now(); if (nu - wielTijd < 250) return; wielTijd = nu;
      this.zoom(e.deltaY < 0 ? 1 : -1);
    }, { passive:false });
  }
  zoom(d){ const z = Math.min(ZMAX, Math.max(ZMIN, this.z + d)); if (z !== this.z){ this.z = z; this.teken(); } }
  centreer(p, z){ this.lat = p.lat; this.lon = p.lon; if (z) this.z = z; this.teken(); }
  px(lat, lon){ const p = naarPx(lat, lon, this.z); return { x:p.x - this.x0, y:p.y - this.y0 }; }
  ll(x, y){ return naarLL(this.x0 + x, this.y0 + y, this.z); }
  m2px(m){ return m / mpp(this.lat, this.z); }
  teken(){
    const W = this.el.clientWidth, H = this.el.clientHeight;
    if (!W || !H) return;
    const c = naarPx(this.lat, this.lon, this.z);
    this.x0 = c.x - W / 2; this.y0 = c.y - H / 2;
    const max = 2 ** this.z, t = [];
    for (let tx = Math.floor(this.x0 / TS); tx <= Math.floor((this.x0 + W) / TS); tx++){
      for (let ty = Math.floor(this.y0 / TS); ty <= Math.floor((this.y0 + H) / TS); ty++){
        if (ty < 0 || ty >= max) continue;
        const x = ((tx % max) + max) % max;
        t.push(`<img alt="" draggable="false" src="${TEGEL('Actueel_orthoHR', this.z, x, ty)}" data-alt="${TEGEL('Actueel_ortho25', this.z, x, ty)}" style="left:${Math.round(tx * TS - this.x0)}px;top:${Math.round(ty * TS - this.y0)}px">`);
      }
    }
    this.tegels.innerHTML = t.join('');
    this.tekenLagen();
  }
  tekenLagen(){ if (this.x0 != null) this.lagenEl.innerHTML = this.lagen(this); }
}

/* Velden als laag op de kaart. doel = { veld, deel } of null. */
function veldenLaag(k, velden, o = {}){
  const { doel = null, gekozen = null, labels = true } = o;
  const uit = [];
  for (const v of velden || []){
    if (v.lat == null) continue;
    const isDoel = doel?.veld?.id === v.id, p = k.px(v.lat, v.lon);
    const klas = [isDoel && !doel.deel ? 'doel' : '', doel && !isDoel ? 'dim' : '', gekozen === v.id ? 'gekozen' : ''].filter(Boolean).join(' ');
    if (!v.lengte){
      if (!isDoel) uit.push(`<div class="vk-stip ${klas}" style="left:${p.x}px;top:${p.y}px"><span>${esc(metVeld(v.naam))}</span></div>`);
      continue;
    }
    const h = v.hoek || 0, tegen = `transform:rotate(${-h}deg)`;
    const delen = delenVan(v).map(([key, x, y, b, hh]) => {
      const dd = isDoel && doel.deel === key;
      return `<div class="vk-deel${dd ? ' doel' : ''}${isDoel && doel.deel && !dd ? ' dim' : ''}" style="left:${x * 100}%;top:${y * 100}%;width:${b * 100}%;height:${hh * 100}%">${labels && !dd ? `<span style="${tegen}">${esc(deelNaam(v, key))}</span>` : ''}</div>`;
    }).join('');
    uit.push(`<div class="vk-veld ${klas}" style="left:${p.x}px;top:${p.y}px;width:${k.m2px(v.lengte)}px;height:${k.m2px(v.breedte)}px;transform:translate(-50%,-50%) rotate(${h}deg)">
      <i class="vk-l-rand"></i><i class="vk-l-mid"></i><i class="vk-l-cirkel"></i>${delen}
      ${labels && !delenVan(v).length ? `<span class="vk-veld-naam" style="${tegen}">${esc(metVeld(v.naam))}</span>` : ''}</div>`);
  }
  if (doel?.veld?.lat != null){
    const m = middenVan(doel.veld, doel.deel), p = k.px(m.lat, m.lon);
    const naam = doel.deel ? deelNaam(doel.veld, doel.deel) : doel.veld.naam;
    uit.push(`<div class="vk-wijzer" style="left:${p.x}px;top:${p.y}px"><span>${ico('match-location', 14)}${esc(metVeld(naam))}</span></div>`);
  }
  return uit.join('');
}

/* ==================== LAAG (eigen venster boven alles) ==================== */
function laag(){
  let el = document.getElementById('vkLaag');
  if (el) return el;
  el = document.createElement('div');
  el.id = 'vkLaag'; el.className = 'vk-laag';
  el.innerHTML = `<div class="vk-doos" role="dialog" aria-modal="true" aria-labelledby="vkTitel">
    <div class="vk-kop"><h2 id="vkTitel"></h2><button type="button" class="vk-sluit" aria-label="Sluiten">${ico('navigation-close', 22)}</button></div>
    <div class="vk-body"></div></div>`;
  document.body.appendChild(el);
  el.addEventListener('click', e => { if (e.target === el || e.target.closest('.vk-sluit')) sluitLaag(); });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && el.classList.contains('toon')){ e.stopPropagation(); sluitLaag(); }
  }, true);
  return el;
}
function toonLaag(titel, html, groot){
  const el = laag();
  el.classList.toggle('groot', !!groot);
  el.querySelector('#vkTitel').textContent = titel;
  const body = el.querySelector('.vk-body');
  body.innerHTML = html;
  body.scrollTop = 0;
  el.classList.add('toon');
  return body;
}
export function sluitLaag(){
  const el = document.getElementById('vkLaag');
  if (el){ el.classList.remove('toon'); el.querySelector('.vk-body').innerHTML = ''; }
}
const I_GROOT = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M15 3h6v6"/><path d="M9 21H3v-6"/><path d="M21 3l-7 7"/><path d="M3 21l7-7"/></svg>';
const laden = t => `<p class="vk-zacht">${ico('action-loading', 16)}${esc(t)}</p>`;

/* ==================== VELDKAART VOOR EEN WEDSTRIJD ==================== */
const routeNaar = i => i.adres || i.naam ? 'https://www.google.com/maps/dir/?api=1&destination=' + encodeURIComponent(i.adres || `${i.naam} ${i.plaats}`) : '';
const datumKort = ms => ms ? new Date(ms).toLocaleDateString('nl-NL', { day:'numeric', month:'short' }) : '';

/* Bepaalt park, doel en middelpunt. Nooit een fout naar boven: zonder alles → { geen:true }. */
async function bepaal(i){
  const park = await laadPark(i.club, i.park);
  const fout = park?.fout || '';
  const p = fout ? null : park;
  const doel = p ? zoekDoel(p, i.veld) : null;
  let midden = doel ? middenVan(doel.veld, doel.deel) : p?.lat != null ? { lat:p.lat, lon:p.lon } : null;
  if (!midden && !i.thuis) midden = await zoekAdres(i.adres || `${i.naam} ${i.plaats}`);
  if (!midden && i.thuis){ const e = await laadPark(i.club, 'eigen'); if (e?.lat != null) midden = { lat:e.lat, lon:e.lon }; }
  return { park:p, doel, midden, fout, zoom:doel ? 18 : (p?.zoom || 17) };
}

function bronHtml(i, b, admin){
  const veld = metVeld(i.veld) || 'het veld';
  if (b.fout === 'permission-denied') return `<p class="vk-let">${ico('action-warning', 18)}<span>De kaart kon niet laden: geen rechten. De Firestore-regels voor de veldkaart zijn waarschijnlijk nog niet gepubliceerd.</span></p>`;
  if (b.doel?.deelOnbekend) return `<p class="vk-let">${ico('action-info', 18)}<span>${esc(metVeld(b.doel.veld.naam))} staat op de kaart, maar niet hoe het is opgedeeld. ${admin && i.thuis ? 'Deel het veld op bij Sportpark.' : 'Clubbeheer kan dat aanvullen.'}</span></p>`;
  if (b.doel){
    const v = b.doel.veld;
    if (i.thuis || b.park?.eigen) return `<p class="vk-ok">${ico('action-check', 16)}Plattegrond van het eigen sportpark, ingesteld door clubbeheer</p>`;
    return `<p class="vk-ok">${ico('action-check', 16)}Aangewezen door ${esc(v.door?.team || 'een coach')}${v.ms ? ` · ${esc(datumKort(v.ms))}` : ''}</p>`;
  }
  if (!i.veld) return `<p class="vk-zacht">Het veldnummer is nog niet bekend. Sportlink vult het meestal een paar dagen voor de wedstrijd in.</p>`;
  if (i.thuis) return `<p class="vk-let">${ico('action-info', 18)}<span>${esc(veld)} staat nog niet op de plattegrond van het eigen sportpark.${admin ? ' Zet het erop bij Club → Sportpark.' : ' Meld het, dan zet clubbeheer het erop.'}</span></p>`;
  return `<div class="vk-let">${ico('action-info', 18)}<span>We weten nog niet waar ${esc(veld)} ligt. Ben je er geweest? Wijs het aan, dan ziet iedereen het de volgende keer.</span></div>`;
}

export async function openVeldkaart(i){
  if (!kanKaart(i)) return;
  telGebruik('veldkaart');
  const kop = [i.veld ? `<span class="nu-plek-pil">${esc(metVeld(i.veld))}</span>` : '', i.kleed ? `<span class="nu-plek-pil">${esc(/^\d/.test(i.kleed) ? 'Kleedkamer ' + i.kleed : i.kleed)}</span>` : ''].join('');
  const body = toonLaag(i.thuis ? 'Waar spelen we' : (i.naam || 'Waar spelen we'), `${kop ? `<div class="vk-pillen">${kop}</div>` : ''}<div class="vk-kaart-groot" data-vk-kaart></div><div data-vk-onder>${laden('Kaart laden…')}</div>`);
  const [b, admin] = await Promise.all([bepaal(i), isClubAdmin(i.club)]);
  if (!body.isConnected) return;
  const vak = body.querySelector('[data-vk-kaart]'), onder = body.querySelector('[data-vk-onder]');
  if (b.midden) new Kaart(vak, { ...b.midden, z:b.zoom, interactief:true, lagen:k => veldenLaag(k, b.park?.velden, { doel:b.doel }) });
  else vak.outerHTML = `<p class="vk-let">${ico('action-info', 18)}<span>${i.thuis ? 'Het eigen sportpark staat nog niet op de kaart.' : 'Het adres van dit sportpark is (nog) niet bekend, dus er is geen luchtfoto.'}</span></p>`;
  const route = !i.thuis ? routeNaar(i) : '';
  const magAanwijzen = !i.thuis && i.veld && b.midden && b.fout !== 'permission-denied';
  onder.innerHTML = `${bronHtml(i, b, admin)}
    <div class="vk-acties">
      ${route ? `<a class="knop vol fluo" href="${esc(route)}" target="_blank" rel="noopener">${ico('match-departure', 20)}Navigeer</a>` : ''}
      ${magAanwijzen ? `<button type="button" class="knop vol licht" data-vk-aanwijzen>${ico('admin-edit', 20)}${b.doel && !b.doel.deelOnbekend ? 'Opnieuw aanwijzen' : 'Veld aanwijzen'}</button>` : ''}
      ${i.thuis && admin ? `<button type="button" class="knop vol licht" data-vk-beheer>${ico('navigation-settings', 20)}Sportpark inrichten</button>` : ''}
    </div>
    <button type="button" class="vk-meld-link" data-vk-melden>${ico('action-warning', 16)}Klopt er iets niet? Meld het</button>`;
  onder.querySelector('[data-vk-aanwijzen]')?.addEventListener('click', () => openAanwijzen(i, b));
  onder.querySelector('[data-vk-beheer]')?.addEventListener('click', () => openSportparkBeheer(i.club));
  onder.querySelector('[data-vk-melden]').addEventListener('click', () => openMelden(i));
}

/* ---------- klein in Praktisch (wedstrijd-voorbereiding.js) ---------- */
export function veldkaartInlineHtml(w){
  const i = infoVan(w);
  if (!kanKaart(i)) return '';
  return `<div class="vk-inline" data-vk-inline="${esc(JSON.stringify(i))}"><div class="vk-kaart-klein" data-vk-klein></div><div data-vk-klein-onder>${laden('Kaart laden…')}</div></div>`;
}
export async function vulVeldkaarten(root){
  for (const el of root.querySelectorAll('[data-vk-inline]')){
    let i; try { i = JSON.parse(el.dataset.vkInline); } catch { continue; }
    const b = await bepaal(i);
    if (!el.isConnected) continue;
    const vak = el.querySelector('[data-vk-klein]'), onder = el.querySelector('[data-vk-klein-onder]');
    if (!b.midden){ el.remove(); continue; }
    new Kaart(vak, { ...b.midden, z:b.zoom, lagen:k => veldenLaag(k, b.park?.velden, { doel:b.doel, labels:false }) });
    const admin = await isClubAdmin(i.club);
    onder.innerHTML = `${bronHtml(i, b, admin)}
      <div class="vk-acties"><button type="button" class="knop vol licht" data-vk="${esc(JSON.stringify(i))}">${I_GROOT}Vergroot de kaart</button></div>
      <button type="button" class="vk-meld-link" data-vk-melden>${ico('action-warning', 16)}Klopt er iets niet? Meld het</button>`;
    onder.querySelector('[data-vk-melden]').addEventListener('click', () => openMelden(i));
  }
}

/* ==================== AANWIJZEN (coach, sportpark van de tegenstander) ==================== */
function openAanwijzen(i, b){
  const naam = metVeld(i.veld);
  let gekozen = null;
  const body = toonLaag('Veld aanwijzen', `<p class="vk-uitleg"><b>Waar ligt ${esc(naam)}?</b> Tik op het midden van het veld. Sleep om de kaart te verschuiven.</p>
    <div class="vk-kaart-groot" data-vk-kaart></div><div data-vk-keuze></div>`);
  const andere = (b.park?.velden || []).filter(v => veldNorm(v.naam) !== veldNorm(i.veld));
  const keuze = body.querySelector('[data-vk-keuze]');
  const tekenKeuze = () => {
    keuze.innerHTML = gekozen
      ? `<p class="vk-zacht">Dit geldt voor alle teams van de club die hier spelen. Je kunt het later altijd aanpassen.</p>
         <div class="vk-acties"><button type="button" class="knop vol fluo" data-vk-opslaan>${ico('action-check', 20)}Opslaan als ${esc(naam)}</button></div>`
      : `<p class="vk-zacht">${ico('action-info', 16)}Nog geen plek gekozen</p>`;
    keuze.querySelector('[data-vk-opslaan]')?.addEventListener('click', bewaar);
  };
  const k = new Kaart(body.querySelector('[data-vk-kaart]'), {
    ...b.midden, z:Math.max(17, b.zoom), interactief:true,
    onTik:p => { gekozen = p; k.tekenLagen(); tekenKeuze(); },
    lagen:kk => veldenLaag(kk, andere, {}) + (gekozen ? (() => { const p = kk.px(gekozen.lat, gekozen.lon); return `<div class="vk-wijzer" style="left:${p.x}px;top:${p.y}px"><span>${ico('match-location', 14)}${esc(naam)}</span></div>`; })() : ''),
  });
  tekenKeuze();
  async function bewaar(){
    const knop = keuze.querySelector('[data-vk-opslaan]'); if (knop) knop.disabled = true;
    const veld = { id:'v' + Date.now().toString(36), naam:i.veld, lat:rond(gekozen.lat), lon:rond(gekozen.lon), door:{ uid:S.user?.uid || '', team:i.team || '' }, ms:Date.now() };
    const velden = [...andere, veld];
    const basis = b.park ? {} : { naam:i.naam, adres:i.adres, plaats:i.plaats, lat:rond(b.midden.lat), lon:rond(b.midden.lon), zoom:17, eigen:false };
    if (await bewaarPark(i.club, i.park, { ...basis, velden })){
      telGebruik('veldkaart_aanwijzen');
      meld(`${naam} opgeslagen`);
      openVeldkaart(i);
    } else if (knop) knop.disabled = false;
  }
}

/* ==================== FOUT MELDEN ==================== */
const REDENEN = [
  ['veld', 'Verkeerd veld aangewezen'], ['indeling', 'Veld is anders ingedeeld'],
  ['plek', 'Sportpark ligt ergens anders'], ['kleedkamer', 'Kleedkamer klopt niet'], ['anders', 'Iets anders'],
];
export const redenTekst = r => (REDENEN.find(([k]) => k === r) || [, 'Melding'])[1];
async function adminMail(club){
  const c = await laadClub(club);
  for (const uid of Object.keys(c?.admins || {})){
    const m = c?.ledenInfo?.[uid]?.email || (/@/.test(c?.adminsInfo?.[uid]?.naam || '') ? c.adminsInfo[uid].naam : '');
    if (m) return m;
  }
  return '';
}
async function openMelden(i){
  let reden = '';
  const plek = `${metVeld(i.veld) || 'Het veld'} · ${i.thuis ? 'eigen sportpark' : (i.naam || 'sportpark tegenstander')}`;
  const body = toonLaag('Wat klopt er niet?', `<p class="vk-uitleg">Over ${esc(plek)}. Je melding gaat naar clubbeheer.</p>
    <div class="vk-redenen" role="radiogroup" aria-label="Wat klopt er niet">${REDENEN.map(([k, t]) =>
      `<button type="button" role="radio" aria-checked="false" class="vk-reden" data-vk-reden="${k}"><span class="vk-radio"></span>${esc(t)}</button>`).join('')}</div>
    <label class="vk-label" for="vkToel">Toelichting (optioneel)</label>
    <textarea id="vkToel" class="invoer" rows="2" maxlength="500" placeholder="Bijvoorbeeld: we speelden op het achterste deel"></textarea>
    <p class="vk-zacht">${ico('map', 16)}De wedstrijd en het veld gaan automatisch mee.</p>
    <div class="vk-acties"><button type="button" class="knop vol fluo" data-vk-stuur disabled>Kies eerst wat er niet klopt</button></div>
    <div data-vk-mail></div>`);
  body.querySelectorAll('[data-vk-reden]').forEach(b => b.onclick = () => {
    reden = b.dataset.vkReden;
    body.querySelectorAll('[data-vk-reden]').forEach(x => { const aan = x === b; x.classList.toggle('aan', aan); x.setAttribute('aria-checked', String(aan)); });
    const s = body.querySelector('[data-vk-stuur]'); s.disabled = false; s.innerHTML = `${ico('communication-message', 20)}Melding versturen`;
  });
  adminMail(i.club).then(m => {
    const vak = body.querySelector('[data-vk-mail]');
    if (m && vak) vak.innerHTML = `<a class="vk-meld-link" href="mailto:${esc(m)}?subject=${encodeURIComponent('Veldkaart: ' + plek)}">${ico('communication-mail', 16)}Liever mailen? Mail clubbeheer</a>`;
  });
  body.querySelector('[data-vk-stuur]').onclick = async e => {
    if (!reden) return;
    e.currentTarget.disabled = true;
    try {
      await addDoc(meldCol(i.club), {
        park:i.park, parkNaam:i.thuis ? 'Eigen sportpark' : (i.naam || i.adres || ''), thuis:i.thuis, veld:i.veld, reden,
        toelichting:String(body.querySelector('#vkToel').value || '').trim().slice(0, 500),
        datum:i.datum, tegenstander:i.tegen, wid:i.wid, teamId:i.teamId, teamNaam:i.team,
        door:S.user?.uid || '', ms:Date.now(), status:'open',
      });
      telGebruik('veldkaart_melding');
      body.innerHTML = `<div class="vk-bedankt">${ico('action-check', 32)}<h3>Melding verstuurd</h3>
        <p>Clubbeheer kijkt ernaar. Is het aangepast, dan krijgt ${esc(i.team || 'je team')} daar een bericht over in Cluppie.</p>
        <button type="button" class="knop vol licht" data-vk-terug>Terug naar de kaart</button></div>`;
      body.querySelector('[data-vk-terug]').onclick = () => openVeldkaart(i);
    } catch (err){
      console.error('[veldkaart] melden', err);
      meld(err?.code === 'permission-denied' ? 'Versturen mislukt: geen rechten (Firestore-regels).' : 'Versturen mislukt, geen verbinding. Probeer het zo opnieuw.');
      e.currentTarget.disabled = false;
    }
  };
}

/* ==================== CLUBBEHEER: SPORTPARK ==================== */
let B = null;   // { club, park, sel, modus, kaart, tab, slNamen }
const nieuwId = () => 'v' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
const kopie = o => JSON.parse(JSON.stringify(o));

export async function openSportparkBeheer(club, tab){
  if (!club) return;
  if (!(await isClubAdmin(club))) return meld('Alleen clubbeheer kan het sportpark inrichten.');
  const body = toonLaag('Sportpark', laden('Sportpark laden…'), true);
  const p = await laadPark(club, 'eigen', true);
  if (!body.isConnected) return;
  const c = await laadClub(club);
  B = { club, park:p && !p.fout ? kopie(p) : { naam:c?.naam ? `Sportpark ${c.naam}` : 'Eigen sportpark', velden:[], eigen:true }, sel:null, modus:'kijk', tab:tab || 'velden', slNamen:null, fout:p?.fout || '' };
  B.park.velden ||= [];
  tekenBeheer();
}
function tekenBeheer(){
  const el = document.querySelector('#vkLaag .vk-body');
  if (!el || !B) return;
  const seg = `<div class="segment vk-seg" role="tablist">${[['velden', 'Velden'], ['meldingen', 'Meldingen']].map(([id, n]) =>
    `<button type="button" role="tab" aria-selected="${B.tab === id}" class="${B.tab === id ? 'actief' : ''}" data-vk-tab="${id}">${n}<span data-vk-tel="${id}"></span></button>`).join('')}</div>`;
  el.innerHTML = seg + `<div data-vk-paneel></div>`;
  el.querySelectorAll('[data-vk-tab]').forEach(b => b.onclick = () => { B.tab = b.dataset.vkTab; tekenBeheer(); });
  telMeldingen(B.club).then(n => { const t = el.querySelector('[data-vk-tel="meldingen"]'); if (t && n) t.innerHTML = ` <em class="vk-tel">${n}</em>`; });
  const paneel = el.querySelector('[data-vk-paneel]');
  if (B.tab === 'meldingen') return tekenMeldingen(paneel);
  if (B.fout === 'permission-denied') paneel.insertAdjacentHTML('beforeend', `<p class="vk-let">${ico('action-warning', 18)}<span>Geen rechten om het sportpark te lezen. Publiceer eerst de Firestore-regels uit VELDKAART-RULES.md.</span></p>`);
  if (B.park.lat == null){
    paneel.insertAdjacentHTML('beforeend', `<p class="vk-uitleg"><b>Zoek het sportpark.</b> Typ het adres, daarna zet je de velden op de luchtfoto.</p>
      <form class="vk-zoek" data-vk-zoek><label class="visually-hidden" for="vkZoek">Adres van het sportpark</label>
      <input id="vkZoek" class="invoer" placeholder="Bijv. Sportlaan 1, Aarle-Rixtel" autocomplete="street-address" value="${esc(B.park.adres || '')}">
      <button type="submit" class="knop fluo">Zoek</button></form>`);
    paneel.querySelector('[data-vk-zoek]').onsubmit = async e => {
      e.preventDefault();
      const q = paneel.querySelector('#vkZoek').value.trim();
      const r = await zoekAdres(q);
      if (!r) return meld('Adres niet gevonden. Probeer straat, huisnummer en plaats.');
      Object.assign(B.park, { adres:q, lat:rond(r.lat), lon:rond(r.lon), zoom:17 });
      tekenBeheer();
    };
    return;
  }
  paneel.insertAdjacentHTML('beforeend', `<div class="vk-beheer">
      <div class="vk-beheer-kaart"><div class="vk-kaart-groot" data-vk-kaart></div><p class="vk-hint" data-vk-hint></p></div>
      <div class="vk-beheer-zij" data-vk-zij></div></div>`);
  B.kaart = new Kaart(paneel.querySelector('[data-vk-kaart]'), {
    lat:B.park.lat, lon:B.park.lon, z:B.park.zoom || 17, interactief:true, onTik:tikBeheer,
    lagen:k => veldenLaag(k, B.park.velden, { gekozen:B.sel }),
  });
  tekenZij();
}
function hint(){
  return B.modus === 'plaats' ? 'Tik op het midden van het nieuwe veld.'
    : B.modus === 'verplaats' ? 'Tik op de nieuwe plek van het midden.'
    : B.park.velden.length ? 'Tik op een veld om het aan te passen. Sleep om te verschuiven.' : 'Kies Veld toevoegen en tik op het midden van een veld.';
}
function tikBeheer(p){
  const v = B.park.velden.find(x => x.id === B.sel);
  if (B.modus === 'plaats'){
    const nrs = B.park.velden.map(x => parseInt(nrVan(x), 10)).filter(n => !isNaN(n));
    const nieuw = { id:nieuwId(), naam:`Veld ${(nrs.length ? Math.max(...nrs) : 0) + 1}`, lat:rond(p.lat), lon:rond(p.lon), lengte:100, breedte:64, hoek:0, indeling:'heel' };
    B.park.velden.push(nieuw); B.sel = nieuw.id; B.modus = 'kijk';
  } else if (B.modus === 'verplaats' && v){
    v.lat = rond(p.lat); v.lon = rond(p.lon); B.modus = 'kijk';
  } else {
    const raak = [...B.park.velden].reverse().find(x => binnenVeld(x, p));
    B.sel = raak ? raak.id : null;
  }
  B.kaart.tekenLagen(); tekenZij();
}
function miniVeld(soort){
  const lijn = soort === 'heel' ? '' : `<path d="M20 3v18"/>${soort === 'vier' ? '<path d="M3 12h34"/>' : ''}`;
  return `<svg width="40" height="24" viewBox="0 0 40 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-dasharray="${soort === 'heel' ? '0' : '3 2'}" aria-hidden="true"><rect x="3" y="3" width="34" height="18" rx="2" stroke-dasharray="0"/>${lijn}</svg>`;
}
function tekenZij(){
  const zij = document.querySelector('#vkLaag [data-vk-zij]');
  const h = document.querySelector('#vkLaag [data-vk-hint]');
  if (h) h.textContent = hint();
  if (!zij) return;
  const v = B.park.velden.find(x => x.id === B.sel);
  const lijst = B.park.velden.length ? `<div class="vk-veldlijst">${B.park.velden.map(x =>
    `<button type="button" class="vk-chip${x.id === B.sel ? ' aan' : ''}" data-vk-kies="${esc(x.id)}">${esc(metVeld(x.naam))}${x.lengte ? '' : ' (stip)'}</button>`).join('')}</div>` : '';
  let editor = '';
  if (v){
    const ind = v.indeling || 'heel';
    editor = `<div class="vk-editor">
      <label class="vk-label" for="vkNaam">Naam</label><input id="vkNaam" class="invoer" value="${esc(v.naam)}" maxlength="30">
      ${v.lengte ? `
      <label class="vk-label" for="vkHoek">Draaien <span data-vk-w="hoek">${v.hoek || 0}°</span></label><input id="vkHoek" type="range" min="-90" max="90" step="1" value="${v.hoek || 0}">
      <label class="vk-label" for="vkLengte">Lengte <span data-vk-w="lengte">${v.lengte} m</span></label><input id="vkLengte" type="range" min="30" max="120" step="1" value="${v.lengte}">
      <label class="vk-label" for="vkBreedte">Breedte <span data-vk-w="breedte">${v.breedte} m</span></label><input id="vkBreedte" type="range" min="20" max="80" step="1" value="${v.breedte}">
      <div class="vk-label">Opdelen voor kleinere wedstrijden</div>
      <div class="vk-indeling" role="radiogroup" aria-label="Opdelen">${[['heel', 'Heel veld'], ['twee', 'In tweeën'], ['vier', 'In vieren']].map(([k, t]) =>
        `<button type="button" role="radio" aria-checked="${ind === k}" class="vk-ind${ind === k ? ' aan' : ''}" data-vk-ind="${k}">${miniVeld(k)}${t}</button>`).join('')}</div>
      ${delenVan(v).length ? `<div class="vk-delen">${delenVan(v).map(([k]) =>
        `<label><span>${esc(k)}</span><input class="invoer" data-vk-deel="${esc(k)}" value="${esc(deelNaam(v, k))}" maxlength="20" aria-label="Naam van deel ${esc(k)}"></label>`).join('')}</div>
        ${ind === 'vier' ? '<p class="vk-zacht">"Voor" is de kant aan de bovenkant van de kaart. Klopt dat niet, pas de namen dan aan.</p>' : ''}` : ''}` : `<p class="vk-zacht">Dit veld is als stip aangewezen. Verwijder het en voeg het opnieuw toe als rechthoek.</p>`}
      <div class="vk-acties vk-rij">
        <button type="button" class="knop licht klein" data-vk-verplaats>${ico('match-location', 16)}Verplaatsen</button>
        <button type="button" class="knop gevaar klein" data-vk-weg>${ico('admin-delete', 16)}Verwijderen</button></div>
    </div>`;
  }
  zij.innerHTML = `${lijst}
    <div class="vk-acties vk-rij"><button type="button" class="knop licht${B.modus === 'plaats' ? ' aan' : ''}" data-vk-nieuw>${ico('action-add', 20)}Veld toevoegen</button></div>
    ${editor}
    <div class="vk-acties"><button type="button" class="knop vol fluo" data-vk-bewaar>${ico('admin-save', 20)}Sportpark opslaan</button></div>
    <div class="vk-sl" data-vk-sl></div>`;
  zij.querySelectorAll('[data-vk-kies]').forEach(b => b.onclick = () => {
    B.sel = b.dataset.vkKies; B.modus = 'kijk';
    const x = B.park.velden.find(y => y.id === B.sel); if (x) B.kaart.centreer(x);
    tekenZij();
  });
  zij.querySelector('[data-vk-nieuw]').onclick = () => { B.modus = B.modus === 'plaats' ? 'kijk' : 'plaats'; tekenZij(); };
  zij.querySelector('[data-vk-bewaar]').onclick = bewaarBeheer;
  if (v){
    const opnieuw = () => { B.kaart.tekenLagen(); tekenSl(); };
    zij.querySelector('#vkNaam').oninput = e => { v.naam = e.target.value; opnieuw(); };
    [['#vkHoek', 'hoek', '°'], ['#vkLengte', 'lengte', ' m'], ['#vkBreedte', 'breedte', ' m']].forEach(([sel, veld, eenheid]) => {
      const inp = zij.querySelector(sel); if (!inp) return;
      inp.oninput = () => { v[veld] = +inp.value; zij.querySelector(`[data-vk-w="${veld}"]`).textContent = inp.value + eenheid; B.kaart.tekenLagen(); };
    });
    zij.querySelectorAll('[data-vk-ind]').forEach(b => b.onclick = () => { v.indeling = b.dataset.vkInd; B.kaart.tekenLagen(); tekenZij(); });
    zij.querySelectorAll('[data-vk-deel]').forEach(inp => inp.oninput = () => {
      v.delen = { ...(v.delen || {}), [inp.dataset.vkDeel]:inp.value.trim() }; opnieuw();
    });
    zij.querySelector('[data-vk-verplaats]').onclick = () => { B.modus = 'verplaats'; tekenZij(); };
    zij.querySelector('[data-vk-weg]').onclick = () => {
      if (!confirm(`${metVeld(v.naam)} verwijderen van de kaart?`)) return;
      B.park.velden = B.park.velden.filter(x => x.id !== v.id); B.sel = null; B.kaart.tekenLagen(); tekenZij();
    };
  }
  tekenSl();
}
async function bewaarBeheer(){
  const velden = B.park.velden.map(v => {
    const x = { id:v.id, naam:String(v.naam || '').trim() || 'Veld', lat:v.lat, lon:v.lon };
    if (v.lengte){ Object.assign(x, { lengte:v.lengte, breedte:v.breedte, hoek:v.hoek || 0, indeling:v.indeling || 'heel' });
      const d = {}; for (const [k] of delenVan(v)) if (v.delen?.[k]) d[k] = v.delen[k]; x.delen = d; }
    if (v.door) x.door = v.door;
    if (v.ms) x.ms = v.ms;
    return x;
  });
  const c = B.kaart ? { lat:rond(B.kaart.lat), lon:rond(B.kaart.lon), zoom:B.kaart.z } : {};
  if (await bewaarPark(B.club, 'eigen', { naam:B.park.naam || 'Eigen sportpark', adres:B.park.adres || '', eigen:true, ...c, velden })){
    telGebruik('veldkaart_sportpark');
    meld('Sportpark opgeslagen');
  }
}

/* Welke veldnamen gebruikt Sportlink bij thuiswedstrijden (laatste 60 dagen en
   komend)? Per naam: herkend als (deel)veld of niet. */
async function sportlinkNamen(club){
  const grens = new Date(Date.now() - 60 * 864e5).toISOString().slice(0, 10);
  const teams = (S.clubTeams || []).filter(t => !t.club || t.club === club).slice(0, 60);
  const tel = new Map();
  await Promise.all(teams.map(async t => {
    try {
      const snap = await getDocs(query(collection(db, 'teams', t.id, 'wedstrijden'), where('datum', '>=', grens)));
      snap.forEach(d => { const w = d.data(); const n = String(w.slVeld || w.veld || '').trim(); if (w.thuis && n) tel.set(n, (tel.get(n) || 0) + 1); });
    } catch { /* geen leesrecht op dit team: overslaan */ }
  }));
  const perNorm = new Map();
  for (const [n, k] of tel){ const key = veldNorm(n); const o = perNorm.get(key); if (o) o.keer += k; else perNorm.set(key, { naam:n, keer:k }); }
  return [...perNorm.values()].sort((a, b) => a.naam.localeCompare(b.naam, 'nl', { numeric:true }));
}
function tekenSl(){
  const vak = document.querySelector('#vkLaag [data-vk-sl]');
  if (!vak) return;
  if (!B.slNamen){
    vak.innerHTML = laden('Veldnamen uit Sportlink ophalen…');
    B.slNamen = sportlinkNamen(B.club);
  }
  B.slNamen.then(namen => {
    const nu = document.querySelector('#vkLaag [data-vk-sl]');
    if (!nu || !B) return;
    if (!namen.length){ nu.innerHTML = `<div class="vk-label">Zo noemt Sportlink de velden</div><p class="vk-zacht">Nog geen thuiswedstrijden met een veldnaam gevonden.</p>`; return; }
    nu.innerHTML = `<div class="vk-label">Zo noemt Sportlink de velden</div>${namen.map(x => {
      const d = zoekDoel(B.park, x.naam), ok = d && !d.deelOnbekend;
      return `<div class="vk-sl-rij"><span class="${ok ? 'vk-c-ok' : 'vk-c-let'}">${ico(ok ? 'action-check' : 'action-warning', 16)}</span><b>${esc(metVeld(x.naam))}</b><span class="vk-zacht">${x.keer}×</span>${ok ? '' : `<span class="vk-c-let">${d?.deelOnbekend ? 'deel niet ingedeeld' : 'niet op de kaart'}</span>`}</div>`;
    }).join('')}`;
  });
}

/* ---------- meldingen ---------- */
async function haalMeldingen(club){
  const snap = await getDocs(meldCol(club));
  return snap.docs.map(d => ({ id:d.id, ...d.data() })).sort((a, b) => (b.ms || 0) - (a.ms || 0));
}
export async function telMeldingen(club){
  try { return (await haalMeldingen(club)).filter(m => m.status !== 'opgelost').length; } catch { return 0; }
}
export function vulMeldBadge(el, club){
  telMeldingen(club).then(n => { if (n && el.isConnected){ el.textContent = String(n); el.hidden = false; } });
}
async function tekenMeldingen(paneel){
  paneel.innerHTML = laden('Meldingen laden…');
  let lijst;
  try { lijst = await haalMeldingen(B.club); }
  catch (e){
    paneel.innerHTML = `<p class="vk-let">${ico('action-warning', 18)}<span>${e?.code === 'permission-denied' ? 'Geen rechten om meldingen te lezen. Publiceer eerst de Firestore-regels uit VELDKAART-RULES.md.' : 'Meldingen laden mislukt. Controleer je verbinding.'}</span></p>`;
    return;
  }
  const open = lijst.filter(m => m.status !== 'opgelost'), klaar = lijst.filter(m => m.status === 'opgelost').slice(0, 20);
  const kaart = m => `<div class="vk-melding">
      <div class="vk-melding-kop"><b>${esc(redenTekst(m.reden))}</b>${m.status === 'opgelost' ? `<span class="vk-c-ok">${ico('action-check', 14)}Opgelost</span>` : '<span class="vk-nieuw">Open</span>'}</div>
      <p>${esc(metVeld(m.veld) || 'Veld onbekend')} · ${esc(m.parkNaam || '')}${m.toelichting ? ` · “${esc(m.toelichting)}”` : ''}</p>
      <p class="vk-zacht">${esc(m.teamNaam || 'Coach')} · ${esc(datumKort(m.ms))}${m.tegenstander ? ` · ${m.thuis ? 'tegen' : 'bij'} ${esc(m.tegenstander)}` : ''}</p>
      ${m.status === 'opgelost' ? '' : `<div class="vk-acties vk-rij">
        <button type="button" class="knop licht klein" data-vk-bekijk="${esc(m.id)}">${ico('map', 16)}Bekijk op kaart</button>
        <button type="button" class="knop licht klein" data-vk-klaar="${esc(m.id)}">${ico('action-check', 16)}Opgelost</button></div>`}
    </div>`;
  paneel.innerHTML = `${open.length ? open.map(kaart).join('') : '<p class="vk-zacht">Geen open meldingen.</p>'}
    ${klaar.length ? `<div class="vk-label">Afgehandeld</div>${klaar.map(kaart).join('')}` : ''}`;
  paneel.querySelectorAll('[data-vk-bekijk]').forEach(b => b.onclick = () => {
    const m = lijst.find(x => x.id === b.dataset.vkBekijk); if (!m) return;
    if (m.park === 'eigen'){ B.tab = 'velden'; tekenBeheer(); return; }
    openVeldkaart({ club:B.club, park:m.park, thuis:false, veld:m.veld, kleed:'', naam:m.parkNaam, adres:'', plaats:'', datum:m.datum, tegen:m.tegenstander, wid:m.wid, teamId:m.teamId, team:m.teamNaam });
  });
  paneel.querySelectorAll('[data-vk-klaar]').forEach(b => b.onclick = () => {
    const m = lijst.find(x => x.id === b.dataset.vkKlaar); if (!m) return;
    const rij = b.parentElement;
    rij.innerHTML = `${m.teamId ? `<button type="button" class="knop fluo klein" data-vk-af="1">${ico('communication-message', 16)}Opgelost, bericht aan ${esc(m.teamNaam || 'team')}</button>` : ''}
      <button type="button" class="knop licht klein" data-vk-af="0">Opgelost zonder bericht</button>`;
    rij.querySelectorAll('[data-vk-af]').forEach(k => k.onclick = () => handelAf(m, k.dataset.vkAf === '1', k));
  });
}
async function handelAf(m, bericht, knop){
  knop.disabled = true;
  try {
    await updateDoc(doc(db, 'clubs', B.club, 'veldmeldingen', m.id), { status:'opgelost', opgelostMs:Date.now() });
    if (bericht){
      const c = await laadClub(B.club);
      await addDoc(collection(db, 'berichten'), {
        club:B.club, clubNaam:c?.naam || '', titel:'Veldkaart aangepast',
        body:`Jullie melding over ${metVeld(m.veld) || 'het veld'} (${m.parkNaam || 'sportpark'}) is bekeken en aangepast. Bedankt voor het doorgeven.`,
        teams:[m.teamId], zichtbaarTot:Date.now() + 7 * 864e5, gemaakt:serverTimestamp(),
        door:S.user?.displayName || S.user?.email || '',
      });
    }
    meld('Melding afgehandeld');
    tekenBeheer();
  } catch (e){
    console.error('[veldkaart] afhandelen', e);
    meld('Afhandelen mislukt: ' + (e?.code || e?.message || 'onbekende fout'));
    knop.disabled = false;
  }
}

/* ---------- één keer: klik op een veld-label opent de kaart ---------- */
if (typeof document !== 'undefined' && !window.__vkKlik){
  window.__vkKlik = true;
  document.addEventListener('click', e => {
    const b = e.target.closest?.('[data-vk]');
    if (!b) return;
    e.preventDefault(); e.stopPropagation();
    let i; try { i = JSON.parse(b.dataset.vk); } catch { return; }
    openVeldkaart(i);
  }, true);
}
