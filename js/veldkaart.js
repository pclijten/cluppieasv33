/* ==================== VELDKAART ====================
   [20261120e] Waar ligt het veld waarop we spelen? Goedgekeurde mockup
   "Veldkaart bij wedstrijden" (20 nov), inclusief deelvelden en fout melden.

   Wat de coach ziet
     • Het veld-label bij een wedstrijd (Nu-kaart, wedstrijdvoorbereiding) is
       een knop met een kaarticoon. Die opent een luchtfoto van het sportpark
       met het veld (of het deelveld, bv. "2a voor") rood gemarkeerd.
     • Praktisch in de wedstrijdvoorbereiding toont dezelfde kaart klein.
     • Uitwedstrijd en het veld is nog niet bekend: clubbeheer (of de
       eindbaas) wijst het aan. [20261120g] Coaches wijzen niets aan; zij
       sturen een melding.
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
          lengte?, breedte?, hoek?, splits?:{half,kwart}, delen?, door?, ms }],
          plekken:[{ id, soort, naam, lat, lon }], bijgewerktMs }
     clubs/{clubId}/veldmeldingen/{auto}
        { park, parkNaam, veld, reden, toelichting, datum, tegenstander, wid,
          teamId, teamNaam, door, ms, status, opgelostMs? }
   Regels: zie VELDKAART-RULES.md.

   [20261120f] Uitbreiding na de eerste versie:
     • Velden draaien, vergroten en verslepen op de kaart zelf (greepjes),
       niet alleen met schuifjes onder de kaart.
     • Plekken op het sportpark: kantine, kleedkamers, ingang, parkeren,
       overig (sportparken/eigen .plekken). De kleedkamer van de wedstrijd
       licht rood op ("Kleedkamers 1–4" bevat kleedkamer 3).
     • Knop "Mijn plek": de eigen locatie als blauwe stip, alleen na
       aantikken, alleen op het toestel (niet opgeslagen, niet verstuurd).
       Bij aanwijzen: "Ik sta nu op dit veld".
     • Zoeken op clubnaam of adres (PDOK Locatieserver + OpenStreetMap
       Nominatim; alleen de zoektekst gaat mee).

   Externe diensten (geen sleutel, geen persoonsgegevens):
     luchtfoto  PDOK / Beeldmateriaal Nederland (CC BY 4.0), tegels EPSG:3857
     adres      PDOK Locatieserver (alleen het adres van het sportpark)
     clubnaam   OpenStreetMap Nominatim (alleen de zoektekst, bij Zoek)
   Geen GPS of locatie van de gebruiker. */
import { db, doc, getDoc, setDoc, addDoc, updateDoc, deleteDoc, collection, getDocs, query, where, serverTimestamp } from './firebase.js?v=20261106r';
import { S, esc, meld, isBeheerder } from './state.js?v=20261111g';
import { ico } from './icons.js?v=20261106r';
import { telGebruik } from './tracker.js?v=20261111g';
import { catInfo } from './config.js?v=20261111g';

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
/* [20261120f] Eén veld kan tegelijk heel, in tweeën (half veld) en in vieren
   (kwart veld) gebruikt worden. Welke indeling je ziet hangt af van het team:
   11 en 9 tegen 9 → heel veld, 8 tegen 8 → half veld, 6 en 4 tegen 4 → kwart.
   [sleutel, x, y, b, h] als fractie van het veld (x langs de lengte). */
export const NIVEAUS = {
  half:  [['a', 0, 0, .5, 1], ['b', .5, 0, .5, 1]],
  kwart: [['a voor', 0, 0, .5, .5], ['b voor', .5, 0, .5, .5], ['a achter', 0, .5, .5, .5], ['b achter', .5, .5, .5, .5]],
};
export const NIVEAU_NAAM = { heel:'Heel veld', half:'Half veld', kwart:'Kwart veld' };
const NIVEAU_UITLEG = { heel:'11 en 9 tegen 9', half:'8 tegen 8', kwart:'6 en 4 tegen 4' };
/* oude velden (één 'indeling') blijven werken */
const splitsVan = v => v?.splits || { half:v?.indeling === 'twee', kwart:v?.indeling === 'vier' };
const delenVan = (v, niveau) => niveau && niveau !== 'heel' && splitsVan(v)[niveau] ? NIVEAUS[niveau] : [];
const deelNaam = (v, k) => String(v?.delen?.[k] || `${nrVan(v)}${k}`).trim();
export function niveauVanVorm(vorm){
  const n = parseInt(vorm, 10);
  return !n ? 'heel' : n <= 6 ? 'kwart' : n <= 8 ? 'half' : 'heel';
}

/* [20261120n] Sportlink-veldcodes: "veld 7 A", "veld 4 B1", "veld 1 A1a",
   "veld 3 A1 - kunstgras", "Veld 1 B2 - Hoofdveld". Na het nummer: A/B is de
   helft, 1/2 het kwart binnen die helft, a/b het achtste (telt als kwart).
   Wat na " - " staat (kunstgras, hoofdveld) is een omschrijving. */
export function ontleedVeld(tekst){
  const s = String(tekst || '').split(/\s+[-–]\s+/)[0].trim();
  const m = /^(?:veld\s*)?(\d+)\s*([ab])?\s*([12])?\s*([ab])?$/i.exec(s);
  if (!m) return null;
  return { nr:m[1], helft:(m[2] || '').toLowerCase(), kwart:m[3] || '', achtste:(m[4] || '').toLowerCase() };
}
/* De naam waaronder een veld uit Sportlink op de kaart hoort: "Veld 4" voor "veld 4 B1". */
export const veldBasis = t => { const c = ontleedVeld(t); return c ? `Veld ${c.nr}` : String(t || '').trim(); };
const KWART_CODE = { a1:'a voor', a2:'a achter', b1:'b voor', b2:'b achter' };

/* Welk (deel)veld bedoelt Sportlink of de coach? Exacte naam eerst, dan een
   deelnaam, dan de Sportlink-code (nummer + helft/kwart), dan alleen het nummer.
   niveau = waar het team op speelt (heel/half/kwart); leeg = volg de code. */
export function zoekDoel(park, veldTekst, niveau){
  const n = veldNorm(veldTekst), velden = park?.velden || [];
  if (!n || !velden.length) return null;
  for (const v of velden) if (veldNorm(v.naam) === n) return { veld:v, niveau:'heel' };
  for (const niv of ['half', 'kwart'])
    for (const v of velden) for (const [k] of delenVan(v, niv)) if (veldNorm(deelNaam(v, k)) === n) return { veld:v, deel:k, niveau:niv };
  const c = ontleedVeld(veldTekst);
  const nr = c?.nr || (n.match(/^\d+/) || [])[0];
  const v = nr ? velden.find(x => veldNorm(x.naam) === nr) : null;
  if (!v) return null;
  if (!c || !c.helft) return niveau && niveau !== 'heel' && !splitsVan(v)[niveau] ? { veld:v, deelOnbekend:true } : { veld:v, niveau:'heel' };
  /* hoe fijn de code is, begrensd door waar het team op speelt */
  const codeNiv = c.kwart ? 'kwart' : 'half';
  let niv = niveau || codeNiv;
  if (niv === 'kwart' && codeNiv === 'half') niv = 'half';
  if (niv === 'heel') return { veld:v, niveau:'heel' };
  const sp = splitsVan(v);
  if (niv === 'kwart' && !sp.kwart && sp.half) niv = 'half';
  if (!sp[niv]) return { veld:v, deelOnbekend:true };
  return { veld:v, deel:niv === 'half' ? c.helft : KWART_CODE[c.helft + c.kwart], niveau:niv };
}
/* Middelpunt van een (deel)veld in lat/lon. */
function middenVan(v, deel){
  const d = deel ? [...NIVEAUS.half, ...NIVEAUS.kwart].find(([k]) => k === deel) : null;
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

/* ---------- plekken op het sportpark ---------- */
const svgI = (pad, g = 16) => `<svg width="${g}" height="${g}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${pad}</svg>`;
export const PLEK = {
  kantine:   { naam:'Kantine',     pad:'<path d="M5 8h11v5a5 5 0 0 1-5 5h-1a5 5 0 0 1-5-5z"/><path d="M16 9h1.5a2.5 2.5 0 0 1 0 5H16"/><path d="M8 3.5v2M11 3.5v2"/>' },
  kleedkamer:{ naam:'Kleedkamers', pad:'<path d="M12 7.5a2 2 0 1 1 2-2"/><path d="M12 7.5V9l-8.4 6.3a1 1 0 0 0 .6 1.8h15.6a1 1 0 0 0 .6-1.8L12 9"/>' },
  ingang:    { naam:'Ingang',      pad:'<path d="M6 21V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v17"/><path d="M3.5 21h17"/><path d="M14.5 12v.5"/>' },
  parkeren:  { naam:'Parkeren',    pad:'<rect x="4" y="4" width="16" height="16" rx="3"/><path d="M10 16.5v-9h3a2.5 2.5 0 0 1 0 5h-3"/>' },
  overig:    { naam:'Plek',        pad:'<path d="M12 20.8s6.8-5.9 6.8-10.6a6.8 6.8 0 1 0-13.6 0C5.2 14.9 12 20.8 12 20.8z"/><circle cx="12" cy="10" r="2.6"/>' },
};
const plekIco = (soort, g) => svgI((PLEK[soort] || PLEK.overig).pad, g);
/* "Kleedkamers 1–4", "kleedkamer 5 en 6", "1 t/m 3" → {1,2,3,4} enz. */
export function kleedNummers(naam){
  const s = String(naam || '').toLowerCase().replace(/t\/m|tot en met|tot|[–—]/g, '-');
  const uit = new Set();
  for (const m of s.match(/\d+\s*-\s*\d+|\d+/g) || []){
    const r = m.split('-').map(x => parseInt(x, 10));
    if (r.length === 2 && r[1] >= r[0] && r[1] - r[0] < 40) for (let n = r[0]; n <= r[1]; n++) uit.add(n);
    else uit.add(r[0]);
  }
  return uit;
}
/* Welke plek hoort bij de kleedkamer uit Sportlink of Wijzig opzet? */
export function zoekKleedkamer(park, kleedTekst){
  const t = String(kleedTekst || '').trim();
  if (!t) return null;
  const kk = (park?.plekken || []).filter(p => p.soort === 'kleedkamer');
  const nr = parseInt((t.match(/\d+/) || [])[0], 10);
  if (!isNaN(nr)) return kk.find(p => kleedNummers(p.naam).has(nr)) || null;
  const n = t.toLowerCase().replace(/[^a-z0-9]+/g, '');
  return kk.find(p => String(p.naam).toLowerCase().replace(/[^a-z0-9]+/g, '') === n) || null;
}
function plekkenLaag(k, plekken, o = {}){
  const { doel = null, gekozen = null, greep = false, klein = false } = o;
  return (plekken || []).filter(p => p.lat != null).map(p => {
    const q = k.px(p.lat, p.lon), isDoel = doel?.id === p.id, kies = gekozen === p.id;
    /* [20261120h] een plek kan gedraaid staan, bv. langs een gebouw of weg */
    const h = p.hoek || 0, grepen = kies && greep;
    return `<div class="vk-plek${isDoel ? ' doel' : ''}${kies ? ' gekozen' : ''}${klein ? ' klein' : ''}" style="left:${q.x}px;top:${q.y}px;transform:translate(-50%,-50%) rotate(${h}deg)"${grepen ? ' data-vk-greep="sleep"' : ''}>${plekIco(p.soort, 14)}${klein && !isDoel ? '' : `<span>${esc(p.naam || PLEK[p.soort]?.naam || 'Plek')}</span>`}${
      grepen ? `<b class="vk-greep vk-greep-draai" data-vk-greep="draai" title="Sleep om te draaien">${svgI('<path d="M20 11a8 8 0 1 0-2.3 5.7"/><path d="M20 4v7h-7"/>', 18)}</b>` : ''}</div>`;
  }).join('');
}

/* ---------- wedstrijd → kaartinfo ---------- */
function parkSleutel(w){
  if (w.thuis) return 'eigen';
  const acc = w.slAccommodatie || {};
  const basis = acc.naam ? `${acc.naam} ${acc.plaats || ''}`
    : (w.adres || acc.adres) ? `${w.adres || acc.adres} ${acc.plaats || ''}`
    : w.locatie ? `${w.locatie} ${w.plaats || ''}`
    /* [20261120f] niets bekend: op de club van de tegenstander, zodat je hem kunt zoeken */
    : w.tegenstander ? `club ${String(w.tegenstander).replace(/\s+(JO|MO|O)\d.*$/i, '')}` : '';
  return sleutelVan(basis);
}
export function sleutelVan(tekst){
  const k = String(tekst || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80);
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
    vorm:String(w?.format || t.format || catInfo(t.categorie)?.format || ''),
  };
}
const kanKaart = i => !!(i.club && i.park);
/* Het veld-label als knop (plekHtml in nu-scherm.js). Zonder club of sportpark
   blijft het een gewoon label. */
export function veldPilHtml(w, label, klasse = 'nu-plek-pil'){
  const i = infoVan(w);
  if (!label) return '';
  if (!kanKaart(i)) return `<span class="${klasse}">${esc(label)}</span>`;
  return `<button type="button" class="${klasse} vk-pil" data-vk="${esc(JSON.stringify(i))}" aria-label="${esc(label)}, toon op de kaart">${esc(label)}${ico('match-location', 14)}</button>`;
}
/* [20261120f] Veld en kleedkamer als pillen, bv. voor de desktop-kaarten. */
export function plekPillenHtml(w, klasse = 'nu-plek-pil'){
  if (!w) return '';
  const t = (v, woord) => { const x = String(v || '').trim(); return !x ? '' : /^\d+\s?[a-z]?$/i.test(x) ? `${woord} ${x}` : x.charAt(0).toUpperCase() + x.slice(1); };
  const veld = t(w.veld || w.slVeld, 'Veld'), kleed = t(w.kleedkamer || w.slKleedkamer, 'Kleedkamer');
  return (veld ? veldPilHtml(w, veld, klasse) : '') + (kleed ? veldPilHtml(w, kleed, klasse) : '');
}

/* ---------- Firestore ---------- */
const parkRef = (club, id) => doc(db, 'clubs', club, 'sportparken', id);
const meldCol = club => collection(db, 'clubs', club, 'veldmeldingen');
const _park = new Map();
/* [20261120k] Nooit eeuwig "Kaart laden…": elke stap krijgt een tijdslimiet. */
function binnen(ms, belofte, wat){
  return Promise.race([belofte, new Promise((_, nee) => setTimeout(() => nee(Object.assign(new Error(`${wat} duurde te lang`), { code:'timeout' })), ms))]);
}
function laadPark(club, id, vers){
  const k = club + '/' + id;
  if (!vers && _park.has(k)) return _park.get(k);
  const p = binnen(10000, getDoc(parkRef(club, id)), 'Sportpark laden').then(s => s.exists() ? { id, ...s.data() } : null)
    .catch(e => { console.warn('[veldkaart] sportpark laden', e); _park.delete(k); return { fout:e?.code || 'fout' }; });
  _park.set(k, p);
  return p;
}
async function bewaarPark(club, id, data){
  const k = club + '/' + id, volledig = { ...data, bijgewerktMs:Date.now() };
  _alle.delete(club);
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
  if (!_club.has(club)) _club.set(club, binnen(10000, getDoc(doc(db, 'clubs', club)), 'Club laden').then(s => s.exists() ? { id:club, ...s.data() } : null).catch(() => null));
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
  const p = binnen(8000, fetch(`https://api.pdok.nl/bzk/locatieserver/search/v3_1/free?q=${encodeURIComponent(q)}&rows=1&fl=centroide_ll,weergavenaam`), 'Adres zoeken')
    .then(r => r.json()).then(j => {
      const d = j?.response?.docs?.[0], m = /POINT\(([-\d.]+) ([-\d.]+)\)/.exec(d?.centroide_ll || '');
      return m ? { lat:+m[2], lon:+m[1], naam:d.weergavenaam || q } : null;
    }).catch(e => { console.warn('[veldkaart] adres zoeken', e); _geo.delete(q); return null; });
  _geo.set(q, p);
  return p;
}

/* ---------- zoeken op clubnaam of adres ----------
   PDOK kent adressen en plaatsen, OpenStreetMap (Nominatim) ook sportparken
   en clubs. Beide tegelijk; alleen bij Zoek, nooit tijdens het typen. */
async function zoekPlekken(q){
  q = String(q || '').trim();
  if (q.length < 2) return [];
  const pdok = fetch(`https://api.pdok.nl/bzk/locatieserver/search/v3_1/free?q=${encodeURIComponent(q)}&rows=4&fl=centroide_ll,weergavenaam,type`)
    .then(r => r.json()).then(j => (j?.response?.docs || []).map(d => {
      const m = /POINT\(([-\d.]+) ([-\d.]+)\)/.exec(d.centroide_ll || '');
      return m ? { naam:d.weergavenaam, sub:d.type === 'adres' ? 'Adres' : d.type === 'woonplaats' ? 'Plaats' : 'Kaart', lat:+m[2], lon:+m[1] } : null;
    }).filter(Boolean)).catch(() => []);
  const osm = fetch(`https://nominatim.openstreetmap.org/search?format=jsonv2&countrycodes=nl&limit=5&accept-language=nl&q=${encodeURIComponent(q)}`)
    .then(r => r.json()).then(a => (a || []).map(d => {
      const delen = String(d.display_name || '').split(',').map(x => x.trim());
      return { naam:d.name || delen[0], sub:delen.slice(1, 4).join(', '), lat:+d.lat, lon:+d.lon };
    })).catch(() => []);
  const [a, b] = await Promise.all([osm, pdok]);
  const uit = [];
  for (const r of [...a, ...b]) if (r && !uit.some(x => Math.abs(x.lat - r.lat) < 1e-4 && Math.abs(x.lon - r.lon) < 1e-4)) uit.push(r);
  return uit.slice(0, 7);
}
function zoekHtml(id, waarde, plaatshouder){
  return `<form class="vk-zoek" data-vk-zoekform><label class="visually-hidden" for="${id}">Zoek op clubnaam of adres</label>
    <input id="${id}" class="invoer" placeholder="${esc(plaatshouder || 'Clubnaam, sportpark of adres')}" autocomplete="off" value="${esc(waarde || '')}">
    <button type="submit" class="knop fluo">Zoek</button></form><div class="vk-zoekres" data-vk-zoekres></div>`;
}
function koppelZoek(root, onKies){
  const form = root.querySelector('[data-vk-zoekform]'), res = root.querySelector('[data-vk-zoekres]');
  if (!form) return;
  form.onsubmit = async e => {
    e.preventDefault();
    const q = form.querySelector('input').value;
    res.innerHTML = laden('Zoeken…');
    const lijst = await zoekPlekken(q);
    if (!res.isConnected) return;
    res.innerHTML = lijst.length ? lijst.map((r, n) => `<button type="button" class="vk-zoekrij" data-vk-res="${n}">${ico('match-location', 18)}<span><b>${esc(r.naam)}</b><small>${esc(r.sub || '')}</small></span></button>`).join('')
      : '<p class="vk-zacht">Niets gevonden. Probeer de naam van het sportpark, of straat en plaats.</p>';
    res.querySelectorAll('[data-vk-res]').forEach(b => b.onclick = () => onKies(lijst[+b.dataset.vkRes]));
  };
}

/* ==================== KAART (eigen kleine tegelviewer) ==================== */
const I_MIJ = svgI('<circle cx="12" cy="12" r="7"/><circle cx="12" cy="12" r="2.5"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/>', 22);
const _kaarten = new Set();
class Kaart {
  constructor(el, o){
    Object.assign(this, { el, lat:o.lat, lon:o.lon, z:o.z || 17, interactief:!!o.interactief, onTik:o.onTik || null,
      lagen:o.lagen || (() => ''), grijp:o.grijp || null, mij:null, _watch:null });
    _kaarten.add(this);
    el.classList.add('vk-kaart');
    el.classList.toggle('vk-vast', !this.interactief);
    el.innerHTML = `<div class="vk-schuif"><div class="vk-tegels"></div><div class="vk-lagen"></div></div>
      ${this.interactief ? `<div class="vk-zoom"><button type="button" data-vk-z="1" aria-label="Inzoomen">+</button><button type="button" data-vk-z="-1" aria-label="Uitzoomen">−</button>
        ${o.locatieKnop && navigator.geolocation ? `<button type="button" class="vk-mij-knop" data-vk-mij aria-pressed="false" aria-label="Toon mijn plek">${I_MIJ}</button>` : ''}</div>` : ''}
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
      this._ro = new ResizeObserver(() => { if (this.el.isConnected) this.teken(); else this.opruimen(); });
      this._ro.observe(el);
    }
    this.teken();
  }
  bindInteractie(){
    const el = this.el;
    el.querySelectorAll('[data-vk-z]').forEach(b => b.onclick = e => { e.stopPropagation(); this.zoom(+b.dataset.vkZ); });
    const mijKnop = el.querySelector('[data-vk-mij]');
    if (mijKnop) mijKnop.onclick = e => { e.stopPropagation(); this.wisselLocatie(mijKnop); };
    /* [20261120g] Vingers: één vinger schuift (of pakt een greepje), twee
       vingers knijpen om te zoomen. Tijdens het knijpen schaalt de kaart
       vloeiend mee; bij loslaten springt hij naar het dichtstbijzijnde
       tegelniveau, met het punt tussen de vingers op dezelfde plek. */
    const vingers = new Map();               // pointerId → {x, y} in px binnen de kaart
    let start = null, knijp = null, naKnijp = false;
    const rel = e => { const r = el.getBoundingClientRect(); return { x:e.clientX - r.left, y:e.clientY - r.top }; };
    const llVan = e => { const p = rel(e); return this.ll(p.x, p.y); };
    const tweeVingers = () => { const [a, b] = [...vingers.values()]; return { d:Math.hypot(a.x - b.x, a.y - b.y) || 1, m:{ x:(a.x + b.x) / 2, y:(a.y + b.y) / 2 } }; };
    const stopKnijp = () => {
      if (!knijp) return;
      const k = knijp; knijp = null;
      this.schuif.style.transform = ''; this.schuif.style.transformOrigin = '';
      const dz = Math.max(ZMIN - this.z, Math.min(ZMAX - this.z, Math.round(Math.log2(k.s || 1))));
      /* het punt dat onder het begin-midden lag, komt onder het eind-midden */
      const punt = naarLL(this.x0 + k.m0.x, this.y0 + k.m0.y, this.z);
      const z = this.z + dz, p = naarPx(punt.lat, punt.lon, z);
      const W = el.clientWidth, H = el.clientHeight;
      const c = naarLL(p.x - k.m.x + W / 2, p.y - k.m.y + H / 2, z);
      this.lat = c.lat; this.lon = c.lon; this.z = z; this.teken();
    };
    el.addEventListener('pointerdown', e => {
      if (e.target.closest('button')) return;
      vingers.set(e.pointerId, rel(e));
      try { el.setPointerCapture(e.pointerId); } catch {}
      if (vingers.size === 2){
        /* tweede vinger: schuiven of greepje stoppen, knijpen begint */
        if (start?.greep) start.greep.eind(start.bewogen);
        start = null; this.schuif.style.transform = '';
        const t = tweeVingers();
        knijp = { d0:t.d, m0:t.m, m:t.m, s:1 };
        this.schuif.style.transformOrigin = `${t.m.x}px ${t.m.y}px`;
        naKnijp = true;
        return;
      }
      if (vingers.size > 2) return;
      naKnijp = false;
      /* greepjes (draaien, maat, verslepen) gaan voor het schuiven van de kaart */
      const g = this.grijp ? this.grijp(e, this) : null;
      if (g){
        e.preventDefault();
        start = { id:e.pointerId, greep:g, x:e.clientX, y:e.clientY, bewogen:false };
        return;
      }
      start = { x:e.clientX, y:e.clientY, id:e.pointerId, bewogen:false };
    });
    el.addEventListener('pointermove', e => {
      if (vingers.has(e.pointerId)) vingers.set(e.pointerId, rel(e));
      if (knijp && vingers.size >= 2){
        const t = tweeVingers();
        const sMin = 2 ** (ZMIN - this.z - 0.5), sMax = 2 ** (ZMAX - this.z + 0.5);
        knijp.s = Math.min(sMax, Math.max(sMin, t.d / knijp.d0)); knijp.m = t.m;
        this.schuif.style.transform = `translate(${t.m.x - knijp.m0.x}px,${t.m.y - knijp.m0.y}px) scale(${knijp.s})`;
        return;
      }
      if (!start || e.pointerId !== start.id) return;
      if (start.greep){
        if (!start.bewogen && Math.hypot(e.clientX - start.x, e.clientY - start.y) < 3) return;
        start.bewogen = true; start.greep.move(llVan(e)); return;
      }
      const dx = e.clientX - start.x, dy = e.clientY - start.y;
      if (!start.bewogen && Math.hypot(dx, dy) < 6) return;
      start.bewogen = true;
      this.schuif.style.transform = `translate(${dx}px,${dy}px)`;
    });
    const eind = e => {
      const had = vingers.delete(e.pointerId);
      if (knijp){ if (vingers.size < 2) stopKnijp(); return; }
      if (!had && !start) return;
      if (!start || e.pointerId !== start.id){ if (!vingers.size) naKnijp = false; return; }
      const s = start; start = null;
      if (s.greep){ s.greep.eind(s.bewogen); return; }
      this.schuif.style.transform = '';
      if (s.bewogen){
        const c = naarPx(this.lat, this.lon, this.z), n = naarLL(c.x - (e.clientX - s.x), c.y - (e.clientY - s.y), this.z);
        this.lat = n.lat; this.lon = n.lon; this.teken();
      } else if (e.type === 'pointerup' && this.onTik && !naKnijp){
        const p = rel(e);
        this.onTik(this.ll(p.x, p.y));
      }
      if (!vingers.size) naKnijp = false;
    };
    el.addEventListener('pointerup', eind);
    el.addEventListener('pointercancel', eind);
    /* muiswiel en knijpen op een touchpad (ctrl + wiel) */
    let wielTijd = 0;
    el.addEventListener('wheel', e => {
      e.preventDefault();
      const nu = Date.now(); if (nu - wielTijd < 250) return; wielTijd = nu;
      this.zoom(e.deltaY < 0 ? 1 : -1);
    }, { passive:false });
  }
  zoom(d){ const z = Math.min(ZMAX, Math.max(ZMIN, this.z + d)); if (z !== this.z){ this.z = z; this.teken(); } }
  centreer(p, z){ this.lat = p.lat; this.lon = p.lon; if (z) this.z = z; this.teken(); }
  /* [20261120n] zoom zo dat alle punten (met wat rand) in beeld zijn */
  pasIn(punten, rand = 60){
    if (!punten.length) return;
    const W = this.el.clientWidth || 360, H = this.el.clientHeight || 360;
    let z = ZMAX;
    for (; z > ZMIN; z--){
      const ps = punten.map(q => naarPx(q.lat, q.lon, z)), xs = ps.map(q => q.x), ys = ps.map(q => q.y);
      if (Math.max(...xs) - Math.min(...xs) + rand * 2 <= W && Math.max(...ys) - Math.min(...ys) + rand * 2 <= H) break;
    }
    const lat = punten.map(q => q.lat), lon = punten.map(q => q.lon);
    this.centreer({ lat:(Math.min(...lat) + Math.max(...lat)) / 2, lon:(Math.min(...lon) + Math.max(...lon)) / 2 }, Math.min(z, 18));
  }
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
  tekenLagen(){ if (this.x0 != null) this.lagenEl.innerHTML = this.lagen(this) + this.mijHtml(); }
  /* ---- mijn plek (alleen op het toestel, niets wordt opgeslagen) ---- */
  mijHtml(){
    if (!this.mij) return '';
    const p = this.px(this.mij.lat, this.mij.lon), r = Math.min(120, Math.max(8, this.m2px(this.mij.acc || 10)));
    return `<div class="vk-mij" style="left:${p.x}px;top:${p.y}px"><i style="width:${2 * r}px;height:${2 * r}px"></i><b></b></div>`;
  }
  wisselLocatie(knop){
    if (this._watch != null){ this.stopLocatie(); knop.setAttribute('aria-pressed', 'false'); knop.classList.remove('aan'); this.tekenLagen(); return; }
    knop.setAttribute('aria-pressed', 'true'); knop.classList.add('aan');
    let eerste = true;
    this._watch = navigator.geolocation.watchPosition(pos => {
      if (!this.el.isConnected) return this.opruimen();
      this.mij = { lat:pos.coords.latitude, lon:pos.coords.longitude, acc:pos.coords.accuracy };
      if (eerste){ eerste = false; this.toonBeide(this.mij); }
      this.tekenLagen();
    }, err => {
      this.stopLocatie(); knop.setAttribute('aria-pressed', 'false'); knop.classList.remove('aan');
      meld(err?.code === 1 ? 'Geen toestemming voor je locatie. Zet die aan in de instellingen van je browser.' : 'Je locatie is nu niet te bepalen.');
    }, { enableHighAccuracy:true, maximumAge:5000, timeout:20000 });
  }
  stopLocatie(){ if (this._watch != null){ try { navigator.geolocation.clearWatch(this._watch); } catch {} } this._watch = null; this.mij = null; }
  opruimen(){ this.stopLocatie(); try { this._ro?.disconnect(); } catch {} _kaarten.delete(this); }
  /* Zoom zo dat het sportpark én de gebruiker in beeld zijn; te ver weg: alleen melden. */
  toonBeide(p){
    const W = this.el.clientWidth, H = this.el.clientHeight;
    const q = this.px(p.lat, p.lon);
    if (q.x > 30 && q.y > 30 && q.x < W - 30 && q.y < H - 30) return;
    for (let z = this.z; z >= ZMIN; z--){
      const a = naarPx(this.lat, this.lon, z), b = naarPx(p.lat, p.lon, z);
      if (Math.abs(a.x - b.x) < W - 80 && Math.abs(a.y - b.y) < H - 80){
        const m = naarLL((a.x + b.x) / 2, (a.y + b.y) / 2, z);
        this.lat = m.lat; this.lon = m.lon; this.z = z; this.teken(); return;
      }
    }
    const d = meterVerschil(this, p), km = Math.hypot(d.x, d.y) / 1000;
    meld(`Je bent nog ${km < 10 ? km.toFixed(1).replace('.', ',') : Math.round(km)} km van het sportpark.`);
  }
  /* Eén keer de huidige positie (voor "Ik sta nu op dit veld"). */
  static positie(){
    return new Promise((ok, nee) => {
      if (!navigator.geolocation) return nee({ code:0 });
      navigator.geolocation.getCurrentPosition(p => ok({ lat:p.coords.latitude, lon:p.coords.longitude, acc:p.coords.accuracy }), nee, { enableHighAccuracy:true, maximumAge:0, timeout:20000 });
    });
  }
}

/* Velden als laag op de kaart. doel = { veld, deel } of null. */
function veldenLaag(k, velden, o = {}){
  const { doel = null, gekozen = null, labels = true, greep = false } = o;
  /* het niveau van het doel wint; anders dat van de kijker (team) */
  const niveau = doel?.niveau && doel.niveau !== 'heel' ? doel.niveau : (o.niveau || 'heel');
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
    const vd = delenVan(v, niveau);
    const delen = vd.map(([key, x, y, b, hh]) => {
      const dd = isDoel && doel.deel === key;
      return `<div class="vk-deel${dd ? ' doel' : ''}${isDoel && doel.deel && !dd ? ' dim' : ''}" style="left:${x * 100}%;top:${y * 100}%;width:${b * 100}%;height:${hh * 100}%">${labels && !dd ? `<span style="${tegen}">${esc(deelNaam(v, key))}</span>` : ''}</div>`;
    }).join('');
    const grepen = greep && gekozen === v.id;
    uit.push(`<div class="vk-veld ${klas}${grepen ? ' grijpbaar' : ''}" style="left:${p.x}px;top:${p.y}px;width:${k.m2px(v.lengte)}px;height:${k.m2px(v.breedte)}px;transform:translate(-50%,-50%) rotate(${h}deg)"${grepen ? ' data-vk-greep="sleep"' : ''}>
      <i class="vk-l-rand"></i><i class="vk-l-mid"></i><i class="vk-l-cirkel"></i>${delen}
      ${grepen ? `<b class="vk-greep vk-greep-draai" data-vk-greep="draai" title="Sleep om te draaien">${svgI('<path d="M20 11a8 8 0 1 0-2.3 5.7"/><path d="M20 4v7h-7"/>', 18)}</b>
        <b class="vk-greep vk-greep-maat" data-vk-greep="maat" title="Sleep om de maat te veranderen"></b>` : ''}
      ${labels && !vd.length ? `<span class="vk-veld-naam" style="${tegen}">${esc(metVeld(v.naam))}</span>` : ''}</div>`);
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
  for (const k of [..._kaarten]) if (k.el.closest?.('#vkLaag')) k.opruimen();
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
  for (const k of [..._kaarten]) if (!k.el.isConnected) k.opruimen();   /* locatie stopt bij sluiten */
}
const I_GROOT = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M15 3h6v6"/><path d="M9 21H3v-6"/><path d="M21 3l-7 7"/><path d="M3 21l7-7"/></svg>';
const laden = t => `<p class="vk-zacht">${ico('action-loading', 16)}${esc(t)}</p>`;

/* ==================== VELDKAART VOOR EEN WEDSTRIJD ==================== */
const routeNaar = i => i.adres || i.naam ? 'https://www.google.com/maps/dir/?api=1&destination=' + encodeURIComponent(i.adres || `${i.naam} ${i.plaats}`) : '';
const datumKort = ms => ms ? new Date(ms).toLocaleDateString('nl-NL', { day:'numeric', month:'short' }) : '';

/* Bepaalt park, doel en middelpunt. Nooit een fout naar boven: zonder alles → { geen:true }. */
/* [20261120i] Welk sportpark hoort bij deze wedstrijd? Eerst het vaste id
   ('eigen' of p-<naam-plaats>). Is dat leeg, dan het park dat clubbeheer als
   thuispark heeft gemarkeerd (thuis), of een park met dezelfde naam als in
   Sportlink, ook als de plaats anders is geschreven. */
const heeftInhoud = p => !!(p && !p.fout && ((p.velden || []).length || (p.plekken || []).length));
const parkNaamNorm = s => String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/sportpark|sportcomplex|sportvelden/g, '').replace(/[^a-z0-9]+/g, '');
/* [20261120m] "neul" past bij "Sportpark De Neul", "Bokt" bij "Sportpark Bokt Eindhoven".
   Het kortste deel moet minstens 4 tekens hebben, anders past alles op alles. */
export function naamPast(parkNaam, sportlinkNaam){
  const a = parkNaamNorm(parkNaam), b = parkNaamNorm(sportlinkNaam);
  if (!a || !b) return false;
  if (a === b) return true;
  return Math.min(a.length, b.length) >= 4 && (a.includes(b) || b.includes(a));
}
const _alle = new Map();
function alleParken(club){
  if (!_alle.has(club)) _alle.set(club, binnen(10000, haalParken(club), 'Sportparken laden').catch(e => { console.warn('[veldkaart] sportparken laden', e); _alle.delete(club); return []; }));
  return _alle.get(club);
}
async function zoekPark(i){
  /* [20261120j] Een gekozen thuispark gaat bij thuiswedstrijden altijd voor.
     Een park telt pas als ingetekend met velden of plekken; alleen een
     middelpunt (bv. na zoeken en opslaan van het eigen park) is niet genoeg. */
  if (i.thuis){
    const t = (await alleParken(i.club)).find(x => x.thuispark && heeftInhoud(x));
    if (t) return t;
  }
  const park = await laadPark(i.club, i.park);
  if (park?.fout || heeftInhoud(park)) return park;
  const alle = (await alleParken(i.club)).filter(heeftInhoud);
  const m = alle.find(x => parkNaamNorm(x.naam) === parkNaamNorm(i.naam)) || alle.find(x => naamPast(x.naam, i.naam));
  return m || park;
}
async function bepaal(i){
  const park = await zoekPark(i);
  const fout = park?.fout || '';
  const p = fout ? null : park;
  if (p?.id && p.id !== i.park) i.park = p.id;   /* aanwijzen, melden en inrichten gaan naar het gevonden park */
  const doel = p ? zoekDoel(p, i.veld, niveauVanVorm(i.vorm)) : null;
  const kleed = p ? zoekKleedkamer(p, i.kleed) : null;
  let midden = doel ? middenVan(doel.veld, doel.deel) : p?.lat != null ? { lat:p.lat, lon:p.lon } : null;
  if (!midden && !i.thuis && (i.adres || i.naam)) midden = await zoekAdres(i.adres || `${i.naam} ${i.plaats}`);
  return { park:p, doel, kleed, midden, fout, zoom:doel ? 18 : (p?.zoom || 17) };
}
/* Alles wat op de kaart van een wedstrijd staat: velden, plekken, de wijzer. */
function wedstrijdLagen(b, klein, niveau){
  return k => veldenLaag(k, b.park?.velden, { doel:b.doel, labels:!klein, niveau }) + plekkenLaag(k, b.park?.plekken, { doel:b.kleed, klein });
}

function bronHtml(i, b, admin){
  const veld = metVeld(i.veld) || 'het veld';
  if (b.fout === 'permission-denied') return `<p class="vk-let">${ico('action-warning', 18)}<span>De kaart kon niet laden: geen rechten. De Firestore-regels voor de veldkaart zijn waarschijnlijk nog niet gepubliceerd.</span></p>`;
  if (b.fout) return `<p class="vk-let">${ico('action-warning', 18)}<span>Het sportpark kon niet geladen worden (${esc(b.fout)}). Controleer je verbinding en open de kaart opnieuw.</span></p>`;
  if (b.doel?.deelOnbekend) return `<p class="vk-let">${ico('action-info', 18)}<span>${esc(metVeld(b.doel.veld.naam))} staat op de kaart, maar niet hoe het is opgedeeld. ${admin && i.thuis ? 'Deel het veld op bij Sportpark.' : 'Clubbeheer kan dat aanvullen.'}</span></p>`;
  const niv = niveauVanVorm(i.vorm);
  if (b.doel && !b.doel.deel && niv !== 'heel' && splitsVan(b.doel.veld)[niv])
    return `<p class="vk-let">${ico('action-info', 18)}<span>Jullie spelen op een ${niv === 'half' ? 'half' : 'kwart'} veld. Sportlink geeft alleen ${esc(metVeld(b.doel.veld.naam))}, niet welk deel. De delen staan op de kaart.</span></p>`;
  if (b.doel){
    const v = b.doel.veld;
    if (i.thuis || b.park?.eigen) return `<p class="vk-ok">${ico('action-check', 16)}Plattegrond van het eigen sportpark, ingesteld door clubbeheer</p>`;
    return `<p class="vk-ok">${ico('action-check', 16)}Ingetekend door clubbeheer${v.ms ? ` · ${esc(datumKort(v.ms))}` : ''}</p>`;
  }
  if (!i.veld) return `<p class="vk-zacht">Het veldnummer is nog niet bekend. Sportlink vult het meestal een paar dagen voor de wedstrijd in.</p>`;
  if (i.thuis) return `<p class="vk-let">${ico('action-info', 18)}<span>${esc(veld)} staat nog niet op de plattegrond van het eigen sportpark.${admin ? ' Zet het erop bij Club → Sportpark.' : ' Meld het, dan zet clubbeheer het erop.'}</span></p>`;
  return admin
    ? `<div class="vk-let">${ico('action-info', 18)}<span>${esc(veld)} staat nog niet op de kaart. Wijs het aan, dan ziet iedereen het de volgende keer.</span></div>`
    : `<div class="vk-let">${ico('action-info', 18)}<span>${esc(veld)} staat nog niet op de kaart. Weet jij waar het ligt? Laat het clubbeheer weten met "Meld het" hieronder.</span></div>`;
}

export async function openVeldkaart(i){
  if (!kanKaart(i)) return;
  telGebruik('veldkaart');
  const kop = [i.veld ? `<span class="nu-plek-pil">${esc(metVeld(i.veld))}</span>` : '', i.kleed ? `<span class="nu-plek-pil">${esc(/^\d/.test(i.kleed) ? 'Kleedkamer ' + i.kleed : i.kleed)}</span>` : ''].join('');
  const body = toonLaag(i.thuis ? 'Waar spelen we' : (i.naam || 'Waar spelen we'), `${kop ? `<div class="vk-pillen">${kop}</div>` : ''}<div class="vk-kaart-groot" data-vk-kaart></div><div data-vk-onder>${laden('Kaart laden…')}</div>`);
  let b, admin;
  try { [b, admin] = await Promise.all([bepaal(i), isClubAdmin(i.club)]); }
  catch (e){
    console.error('[veldkaart] kaart laden', e);
    if (body.isConnected) body.querySelector('[data-vk-onder]').innerHTML = `<p class="vk-let">${ico('action-warning', 18)}<span>De kaart kon niet laden: ${esc(e?.message || e?.code || 'onbekende fout')}. Probeer het zo opnieuw.</span></p>`;
    return;
  }
  if (!body.isConnected) return;
  const vak = body.querySelector('[data-vk-kaart]'), onder = body.querySelector('[data-vk-onder]');
  if (b.midden){
    try { new Kaart(vak, { ...b.midden, z:b.zoom, interactief:true, locatieKnop:true, lagen:wedstrijdLagen(b, false, niveauVanVorm(i.vorm)) }); }
    catch (e){ console.error('[veldkaart] kaart tekenen', e); vak.innerHTML = `<p class="vk-let">${ico('action-warning', 18)}<span>Kaart tekenen mislukt: ${esc(e?.message || 'onbekende fout')}</span></p>`; }
  }
  else if (i.thuis) vak.outerHTML = `<p class="vk-let">${ico('action-info', 18)}<span>Het eigen sportpark staat nog niet op de kaart.${admin ? '' : ' Clubbeheer kan het instellen bij Club → Sportpark.'}</span></p>`;
  else {
    /* [20261120f] Adres onbekend: zoek het sportpark op clubnaam. */
    const club = String(i.tegen || '').replace(/\s+(JO|MO|O)\d.*$/i, '').trim();
    /* [20261120g] alleen clubbeheer en eindbaas zetten iets op de kaart; een coach meldt het */
    vak.outerHTML = admin ? `<div class="vk-let">${ico('action-info', 18)}<span>Het adres van dit sportpark is niet bekend. Zoek het op clubnaam, dan staat het voortaan voor iedereen op de kaart.</span></div>
      <div data-vk-zoekvak>${zoekHtml('vkZoekUit', [club, i.plaats].filter(Boolean).join(' '))}</div>`
      : `<div class="vk-let">${ico('action-info', 18)}<span>Het adres van dit sportpark is (nog) niet bekend, dus er is geen luchtfoto. Clubbeheer kan het opzoeken; laat het weten met "Meld het" hieronder.</span></div>`;
    if (admin) koppelZoek(body.querySelector('[data-vk-zoekvak]'), async r => {
      if (await bewaarPark(i.club, i.park, { naam:i.naam || r.naam, adres:i.adres || '', plaats:i.plaats || '', lat:rond(r.lat), lon:rond(r.lon), zoom:17, eigen:false })) openVeldkaart(i);
    });
  }
  const route = !i.thuis ? routeNaar(i) : '';
  const magAanwijzen = admin && !i.thuis && i.veld && b.midden && b.fout !== 'permission-denied';
  const kleedRegel = i.kleed && b.kleed ? `<p class="vk-zacht">${plekIco('kleedkamer', 16)}${esc(/^\d/.test(i.kleed) ? 'Kleedkamer ' + i.kleed : i.kleed)} zit in ${esc(b.kleed.naam)} (rood op de kaart)</p>` : '';
  /* [20261120k] voor clubbeheer: welk park en welke Sportlink-namen er gebruikt worden */
  const beheerInfo = admin ? `<p class="vk-zacht vk-beheerinfo">${ico('action-info', 16)}<span>Kaart van <b>${esc(b.park ? (b.park.id === 'eigen' ? 'eigen sportpark' : b.park.naam || b.park.id) : 'geen ingetekend sportpark')}</b>${b.park ? ` (${(b.park.velden || []).length} velden)` : ''} · Sportlink: veld “${esc(i.veld || '–')}”${i.kleed ? `, kleedkamer “${esc(i.kleed)}”` : ''}${i.naam ? `, sportpark “${esc(i.naam)}”` : ''} · ${esc(NIVEAU_NAAM[niveauVanVorm(i.vorm)].toLowerCase())}</span></p>` : '';
  onder.innerHTML = `${bronHtml(i, b, admin)}${kleedRegel}${beheerInfo}
    ${b.midden && navigator.geolocation ? `<p class="vk-zacht">${svgI('<circle cx="12" cy="12" r="7"/><circle cx="12" cy="12" r="2.5"/>', 16)}Op het sportpark? Tik op het rondje rechtsboven om te zien waar je staat.</p>` : ''}
    <div class="vk-acties">
      ${route ? `<a class="knop vol fluo" href="${esc(route)}" target="_blank" rel="noopener">${ico('match-departure', 20)}Navigeer</a>` : ''}
      ${magAanwijzen ? `<button type="button" class="knop vol licht" data-vk-aanwijzen>${ico('admin-edit', 20)}${b.doel && !b.doel.deelOnbekend ? 'Opnieuw aanwijzen' : 'Veld aanwijzen'}</button>` : ''}
      ${admin ? `<button type="button" class="knop vol licht" data-vk-beheer>${ico('navigation-settings', 20)}Sportpark inrichten</button>` : ''}
    </div>
    <button type="button" class="vk-meld-link" data-vk-melden>${ico('action-warning', 16)}Klopt er iets niet? Meld het</button>`;
  onder.querySelector('[data-vk-aanwijzen]')?.addEventListener('click', () => openAanwijzen(i, b));
  onder.querySelector('[data-vk-beheer]')?.addEventListener('click', () => openSportparkBeheer(i.club, 'velden', i.park,
    i.thuis ? null : { naam:i.naam || `Sportpark van ${String(i.tegen || '').replace(/\s+(JO|MO|O)\d.*$/i, '')}`, plaats:i.plaats, adres:i.adres, ...(b.midden ? { lat:rond(b.midden.lat), lon:rond(b.midden.lon), zoom:17 } : {}) }));
  onder.querySelector('[data-vk-melden]').addEventListener('click', () => openMelden(i, !b.doel && i.veld ? 'ontbreekt' : ''));
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
    let b;
    try { b = await bepaal(i); } catch (e){ console.error('[veldkaart] kaart laden', e); el.remove(); continue; }
    if (!el.isConnected) continue;
    const vak = el.querySelector('[data-vk-klein]'), onder = el.querySelector('[data-vk-klein-onder]');
    if (!b.midden){ el.remove(); continue; }
    new Kaart(vak, { ...b.midden, z:b.zoom, lagen:wedstrijdLagen(b, true, niveauVanVorm(i.vorm)) });
    const admin = await isClubAdmin(i.club);
    onder.innerHTML = `${bronHtml(i, b, admin)}
      <div class="vk-acties"><button type="button" class="knop vol licht" data-vk="${esc(JSON.stringify(i))}">${I_GROOT}Vergroot de kaart</button></div>
      <button type="button" class="vk-meld-link" data-vk-melden>${ico('action-warning', 16)}Klopt er iets niet? Meld het</button>`;
    onder.querySelector('[data-vk-melden]').addEventListener('click', () => openMelden(i));
  }
}

/* ==================== AANWIJZEN (coach, sportpark van de tegenstander) ==================== */
async function openAanwijzen(i, b){
  if (!(await isClubAdmin(i.club))) return meld('Alleen clubbeheer kan velden aanwijzen. Stuur een melding als iets niet klopt.');
  const naam = metVeld(veldBasis(i.veld));   /* [20261120n] "veld 4 B1" → Veld 4 */
  let gekozen = null;
  let midden = { ...b.midden };
  const body = toonLaag('Veld aanwijzen', `<p class="vk-uitleg"><b>Waar ligt ${esc(naam)}?</b> Tik op het midden van het veld. Sleep om de kaart te verschuiven.</p>
    <div class="vk-kaart-groot" data-vk-kaart></div>
    ${navigator.geolocation ? `<div class="vk-acties"><button type="button" class="knop vol licht" data-vk-hier>${svgI('<circle cx="12" cy="12" r="7"/><circle cx="12" cy="12" r="2.5"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/>', 20)}Ik sta nu op ${esc(naam)}</button></div>` : ''}
    <div data-vk-keuze></div>
    <details class="vk-elders"><summary>Staat de kaart op de verkeerde plek? Zoek het sportpark</summary>${zoekHtml('vkZoekAanw', String(i.tegen || '').replace(/\s+(JO|MO|O)\d.*$/i, '').trim())}</details>`);
  const andere = (b.park?.velden || []).filter(v => veldNorm(v.naam) !== veldNorm(veldBasis(i.veld)));
  const keuze = body.querySelector('[data-vk-keuze]');
  const tekenKeuze = () => {
    keuze.innerHTML = gekozen
      ? `<p class="vk-zacht">Dit geldt voor alle teams van de club die hier spelen. Je kunt het later altijd aanpassen.</p>
         <div class="vk-acties"><button type="button" class="knop vol fluo" data-vk-opslaan>${ico('action-check', 20)}Opslaan als ${esc(naam)}</button></div>`
      : `<p class="vk-zacht">${ico('action-info', 16)}Nog geen plek gekozen</p>`;
    keuze.querySelector('[data-vk-opslaan]')?.addEventListener('click', bewaar);
  };
  const k = new Kaart(body.querySelector('[data-vk-kaart]'), {
    ...b.midden, z:Math.max(17, b.zoom), interactief:true, locatieKnop:true,
    onTik:p => { gekozen = p; k.tekenLagen(); tekenKeuze(); },
    lagen:kk => veldenLaag(kk, andere, {}) + (gekozen ? (() => { const p = kk.px(gekozen.lat, gekozen.lon); return `<div class="vk-wijzer" style="left:${p.x}px;top:${p.y}px"><span>${ico('match-location', 14)}${esc(naam)}</span></div>`; })() : ''),
  });
  tekenKeuze();
  body.querySelector('[data-vk-hier]')?.addEventListener('click', async e => {
    const knop = e.currentTarget; knop.disabled = true;
    try {
      const p = await Kaart.positie();
      gekozen = p; k.centreer(p, Math.max(k.z, 18)); tekenKeuze();
      if (p.acc > 40) meld(`Je locatie is op ${Math.round(p.acc)} m nauwkeurig. Controleer de plek op de kaart.`);
    } catch (err){
      meld(err?.code === 1 ? 'Geen toestemming voor je locatie. Zet die aan in de instellingen van je browser.' : 'Je locatie is nu niet te bepalen. Tik de plek zelf aan.');
    }
    knop.disabled = false;
  });
  koppelZoek(body.querySelector('.vk-elders'), r => { midden = { lat:r.lat, lon:r.lon }; gekozen = null; k.centreer(midden, 17); tekenKeuze(); body.querySelector('.vk-elders').open = false; });
  async function bewaar(){
    const knop = keuze.querySelector('[data-vk-opslaan]'); if (knop) knop.disabled = true;
    const veld = { id:'v' + Date.now().toString(36), naam:veldBasis(i.veld), lat:rond(gekozen.lat), lon:rond(gekozen.lon), door:{ uid:S.user?.uid || '', team:i.team || '' }, ms:Date.now() };
    const velden = [...andere, veld];
    const verplaatst = midden.lat !== b.midden.lat || midden.lon !== b.midden.lon;
    const basis = b.park && !verplaatst ? {} : { naam:i.naam || b.park?.naam || '', adres:i.adres, plaats:i.plaats, lat:rond(midden.lat), lon:rond(midden.lon), zoom:17, eigen:false };
    if (await bewaarPark(i.club, i.park, { ...basis, velden })){
      telGebruik('veldkaart_aanwijzen');
      meld(`${naam} opgeslagen`);
      openVeldkaart(i);
    } else if (knop) knop.disabled = false;
  }
}

/* ==================== FOUT MELDEN ==================== */
const REDENEN = [
  ['ontbreekt', 'Veld staat nog niet op de kaart'], ['veld', 'Verkeerd veld aangewezen'], ['indeling', 'Veld is anders ingedeeld'],
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
async function openMelden(i, voorkeur = ''){
  let reden = '';
  const plek = `${metVeld(i.veld) || 'Het veld'} · ${i.thuis ? 'eigen sportpark' : (i.naam || 'sportpark tegenstander')}`;
  const body = toonLaag('Wat klopt er niet?', `<p class="vk-uitleg">Over ${esc(plek)}. Je melding gaat naar clubbeheer.</p>
    <div class="vk-redenen" role="radiogroup" aria-label="Wat klopt er niet">${REDENEN.map(([k, t]) =>
      `<button type="button" role="radio" aria-checked="false" class="vk-reden" data-vk-reden="${k}"><span class="vk-radio"></span>${esc(t)}</button>`).join('')}</div>
    <label class="vk-label" for="vkToel">Toelichting (optioneel)</label>
    <textarea id="vkToel" class="invoer" rows="2" maxlength="500" placeholder="Bijvoorbeeld: we speelden op het achterste deel"></textarea>
    <p class="vk-zacht">${ico('match-location', 16)}De wedstrijd en het veld gaan automatisch mee.</p>
    <div class="vk-acties"><button type="button" class="knop vol fluo" data-vk-stuur disabled>Kies eerst wat er niet klopt</button></div>
    <div data-vk-mail></div>`);
  if (voorkeur) setTimeout(() => body.querySelector(`[data-vk-reden="${voorkeur}"]`)?.click(), 0);
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
    const knop = e.currentTarget;
    knop.disabled = true;
    try {
      await addDoc(meldCol(i.club), {
        park:i.park, parkNaam:i.thuis ? 'Eigen sportpark' : (i.naam || i.adres || ''), parkPlaats:i.plaats || '', parkAdres:i.adres || '', thuis:i.thuis, veld:i.veld, reden,
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
      knop.disabled = false;
    }
  };
}

/* ==================== CLUBBEHEER: SPORTPARK ==================== */
let B = null;   // { club, park, sel, modus, kaart, tab, slNamen, zoek }
const nieuwId = () => 'v' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
const kopie = o => JSON.parse(JSON.stringify(o));
const gekozenVeld = () => B.park.velden.find(x => x.id === B.sel) || null;
const gekozenPlek = () => B.park.plekken.find(x => x.id === B.sel) || null;

export async function openSportparkBeheer(club, tab, parkId = 'eigen', nieuw = null){
  if (!club) return;
  if (!(await isClubAdmin(club))) return meld('Alleen clubbeheer kan sportparken inrichten.');
  const body = toonLaag('Sportparken', laden('Sportpark laden…'), true);
  const p = await laadPark(club, parkId, true);
  if (!body.isConnected) return;
  const c = await laadClub(club);
  const leeg = parkId === 'eigen' ? { naam:c?.naam ? `Sportpark ${c.naam}` : 'Eigen sportpark', velden:[], eigen:true } : { naam:'', velden:[], eigen:false, ...(nieuw || {}) };
  B = { club, parkId, park:p && !p.fout ? kopie(p) : leeg, sel:null, modus:'kijk', tab:tab || 'velden', slNamen:B?.club === club ? B.slNamen : null,
        fout:p?.fout || '', zoek:false, niveau:'heel', clubNaam:c?.naam || '' };
  B.park.velden ||= [];
  B.park.plekken ||= [];
  tekenBeheer();
}
/* ---------- [20261120n] velden ophalen uit OpenStreetMap ----------
   Veel sportparken zijn in OpenStreetMap ingetekend (vorm, maat, stand),
   maar zonder veldnummers. We halen de voetbalvelden rond het midden van de
   kaart op, maken er rechthoeken van en laten clubbeheer de nummers aantikken. */
/* [20261120o] Bron: de OpenStreetMap-kaarttegels van OpenFreeMap (CDN, snel
   en altijd bereikbaar), niet meer de Overpass-servers die vaak overbelast zijn.
   Laag "landuse" class "pitch" = de vorm van elk sportveld; laag "poi" geeft
   per veld een punt met de sport, zodat tennis, hockey enz. eruit kunnen. */
const TEGEL_Z = 14;
let _tilejson = null;
function tegelUrl(){
  _tilejson ||= binnen(10000, fetch('https://tiles.openfreemap.org/planet'), 'Kaart ophalen').then(r => r.json()).then(j => j.tiles[0])
    .catch(e => { _tilejson = null; throw e; });
  return _tilejson;
}
/* minimale Mapbox-vectortegel-lezer (protobuf): alleen wat we nodig hebben */
function leesTegel(buf){
  const b = new Uint8Array(buf), td = new TextDecoder();
  let p = 0;
  const vi = () => { let r = 0, s = 0, x; do { x = b[p++]; r += (x & 0x7f) * 2 ** s; s += 7; } while (x & 0x80); return r; };
  const velden = (eind, cb) => { while (p < eind){ const k = vi(), f = k >> 3, t = k & 7;
    if (t === 2){ const l = vi(), e = p + l; cb(f, t, e); p = e; } else if (t === 0) cb(f, t, vi()); else if (t === 5) p += 4; else if (t === 1) p += 8; else return; } };
  const lagen = {};
  velden(b.length, (f, t, e) => {
    if (f !== 3) return;
    const L = { naam:'', feats:[], keys:[], vals:[], extent:4096 };
    velden(e, (f2, t2, e2) => {
      if (f2 === 1) L.naam = td.decode(b.subarray(p, e2));
      else if (f2 === 3) L.keys.push(td.decode(b.subarray(p, e2)));
      else if (f2 === 4){ let v = null; velden(e2, (f3, t3, e3) => { if (f3 === 1) v = td.decode(b.subarray(p, e3)); else if (t3 === 0) v = e3; }); L.vals.push(v); }
      else if (f2 === 5) L.extent = e2;
      else if (f2 === 2){ const F = { tags:[], geom:[], type:0 };
        velden(e2, (f3, t3, e3) => { if (f3 === 2 || f3 === 4){ const a = f3 === 2 ? F.tags : F.geom; while (p < e3) a.push(vi()); } else if (f3 === 3) F.type = e3; });
        L.feats.push(F); }
    });
    lagen[L.naam] = L;
  });
  return lagen;
}
function tagsVan(L, F){ const t = {}; for (let i = 0; i < F.tags.length; i += 2) t[L.keys[F.tags[i]]] = L.vals[F.tags[i + 1]]; return t; }
/* geometrie → ringen (polygoon) of punten, in lat/lon */
function geomVan(L, F, tx, ty){
  const ll = (gx, gy) => naarLL((tx + gx / L.extent) * TS, (ty + gy / L.extent) * TS, TEGEL_Z);
  const ringen = []; let x = 0, y = 0, ring = null, i = 0;
  const zz = v => (v >> 1) ^ -(v & 1);
  while (i < F.geom.length){
    const c = F.geom[i++], cmd = c & 7, aantal = c >> 3;
    if (cmd === 7){ if (ring) ringen.push(ring); ring = null; continue; }
    for (let k = 0; k < aantal; k++){
      x += zz(F.geom[i++]); y += zz(F.geom[i++]);
      if (cmd === 1){ if (ring && F.type !== 3) ringen.push(ring); ring = []; }
      ring.push(ll(x, y));
    }
  }
  if (ring) ringen.push(ring);
  return ringen;
}
/* kleinste omsluitende rechthoek (draaiende schuifmaat over de convexe schil) */
function rechthoekVan(punten){
  if (punten.length < 3) return null;
  const o = punten[0];
  const xy = punten.map(p => meterVerschil(o, p)).sort((a, b) => a.x - b.x || a.y - b.y);
  const kruis = (a, b, c) => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
  const onder = [], boven = [];
  for (const p of xy){ while (onder.length > 1 && kruis(onder.at(-2), onder.at(-1), p) <= 0) onder.pop(); onder.push(p); }
  for (const p of [...xy].reverse()){ while (boven.length > 1 && kruis(boven.at(-2), boven.at(-1), p) <= 0) boven.pop(); boven.push(p); }
  const schil = [...onder.slice(0, -1), ...boven.slice(0, -1)];
  if (schil.length < 3) return null;
  let best = null;
  for (let i = 0; i < schil.length; i++){
    const a = schil[i], b = schil[(i + 1) % schil.length], h = Math.atan2(b.y - a.y, b.x - a.x), c = Math.cos(h), s = Math.sin(h);
    let u0 = Infinity, u1 = -Infinity, w0 = Infinity, w1 = -Infinity;
    for (const p of schil){ const u = p.x * c + p.y * s, w = -p.x * s + p.y * c; u0 = Math.min(u0, u); u1 = Math.max(u1, u); w0 = Math.min(w0, w); w1 = Math.max(w1, w); }
    const opp = (u1 - u0) * (w1 - w0);
    if (!best || opp < best.opp) best = { opp, h, c, s, u:(u0 + u1) / 2, w:(w0 + w1) / 2, du:u1 - u0, dw:w1 - w0 };
  }
  const { h, c, s, u, w, du, dw } = best;
  const m = verschuif(o, u * c - w * s, u * s + w * c);
  let hoek = (du >= dw ? h : h + Math.PI / 2) / RAD;
  while (hoek > 90) hoek -= 180; while (hoek <= -90) hoek += 180;
  return { lat:rond(m.lat), lon:rond(m.lon), lengte:Math.round(Math.max(du, dw)), breedte:Math.round(Math.min(du, dw)), hoek:Math.round(hoek) };
}
const GEEN_VOETBAL = /^(tennis|padel|field_hockey|hockey|baseball|softball|basketball|volleyball|beachvolleyball|korfball|handball|athletics|running|equestrian|golf|cricket|skateboard|boules|petanque|bmx|cycling)$/;
async function haalOsmVelden(lat, lon, straal = 600){
  const url = await tegelUrl();
  /* alle tegels binnen de straal (meestal 1 tot 4) */
  const hoek1 = verschuif({ lat, lon }, -straal, -straal), hoek2 = verschuif({ lat, lon }, straal, straal);
  const t1 = naarPx(hoek1.lat, hoek1.lon, TEGEL_Z), t2 = naarPx(hoek2.lat, hoek2.lon, TEGEL_Z);
  const tegels = [];
  for (let tx = Math.floor(t1.x / TS); tx <= Math.floor(t2.x / TS); tx++)
    for (let ty = Math.floor(t1.y / TS); ty <= Math.floor(t2.y / TS); ty++) tegels.push([tx, ty]);
  const stukken = [], sporten = [];
  await Promise.all(tegels.map(async ([tx, ty]) => {
    const r = await binnen(15000, fetch(url.replace('{z}', TEGEL_Z).replace('{x}', tx).replace('{y}', ty)), 'Kaarttegel ophalen');
    if (!r.ok) throw new Error('kaarttegel HTTP ' + r.status);
    const L = leesTegel(await r.arrayBuffer());
    for (const F of L.landuse?.feats || []) if (F.type === 3 && tagsVan(L.landuse, F).class === 'pitch'){
      const ring = geomVan(L.landuse, F, tx, ty)[0];
      if (ring?.length > 2) stukken.push(ring);
    }
    for (const F of L.poi?.feats || []){ const t = tagsVan(L.poi, F); if (t.class === 'pitch' && F.type === 1) sporten.push({ ...geomVan(L.poi, F, tx, ty)[0][0], sport:t.subclass || '' }); }
  }));
  /* een veld op de rand van twee tegels staat in beide (afgeknipt): stukken die overlappen samenvoegen */
  const groepen = [];
  for (const ring of stukken){
    const r = rechthoekVan(ring);
    if (!r) continue;
    const krimp = v => ({ ...v, lengte:v.lengte - 2, breedte:v.breedte - 2 });
    const g = groepen.find(x => binnenVeld(x.r, r) || binnenVeld(r, x.r) || ring.some(q => binnenVeld(krimp(x.r), q)) || x.ring.some(q => binnenVeld(krimp(r), q)));
    if (g){ g.ring.push(...ring); g.r = rechthoekVan(g.ring); } else groepen.push({ ring:[...ring], r });
  }
  const uit = [];
  for (const { r } of groepen){
    if (!r || r.lengte < 45 || r.breedte < 25 || r.lengte > 130) continue;
    const d = meterVerschil({ lat, lon }, r);
    if (Math.hypot(d.x, d.y) > straal) continue;
    const hier = sporten.filter(s => binnenVeld(r, s)).map(s => s.sport);
    if (hier.length && !hier.some(s => /soccer|football|multi/.test(s)) && hier.every(s => GEEN_VOETBAL.test(s))) continue;
    uit.push({ ...r, naam:'?' });
  }
  return uit;
}
async function veldenOphalen(knop){
  if (!B?.kaart) return;
  knop.disabled = true; knop.innerHTML = `${ico('action-loading', 20)}Velden zoeken…`;
  try {
    const gevonden = await haalOsmVelden(B.kaart.lat, B.kaart.lon);
    if (!B) return;
    /* een aangewezen stip in een gevonden veld wordt een rechthoek met dezelfde naam */
    let beter = 0;
    for (const v of B.park.velden) if (!v.lengte){
      const g = gevonden.find(x => binnenVeld(x, v));
      if (g){ Object.assign(v, { lat:g.lat, lon:g.lon, lengte:g.lengte, breedte:g.breedte, hoek:g.hoek, splits:{ half:false, kwart:false } }); g.weg = true; beter++; }
    }
    const nieuw = gevonden.filter(g => !g.weg && !B.park.velden.some(v => binnenVeld(v, g)));
    for (const g of nieuw) B.park.velden.push({ id:nieuwId(), naam:g.naam, lat:g.lat, lon:g.lon, lengte:g.lengte, breedte:g.breedte, hoek:g.hoek, splits:{ half:false, kwart:false } });
    if (nieuw.length || beter) B.kaart.pasIn(B.park.velden.filter(v => v.lat != null).flatMap(v => { const r = (v.lengte || 20) / 2; return [verschuif(v, -r, -r), verschuif(v, r, r)]; }), 24);
    if (!gevonden.length) meld('Hier staan in OpenStreetMap geen voetbalvelden. Teken ze zelf met Veld toevoegen.');
    else if (!nieuw.length) meld(beter ? `${beter} aangewezen veld${beter === 1 ? '' : 'en'} kreeg de juiste vorm uit de kaart.` : 'Alle gevonden velden staan al op de kaart.');
    else {
      meld(`${nieuw.length} veld${nieuw.length === 1 ? '' : 'en'} toegevoegd. Tik ze nu aan in de volgorde van de nummers.`);
      if (nieuw.some(g => g.naam === '?')) startNummeren();
    }
    B.kaart.tekenLagen(); tekenZij();
  } catch (e){
    meld('Velden ophalen lukte niet (' + (e?.message || 'geen verbinding') + '). Probeer het zo opnieuw of teken ze zelf.');
    knop.disabled = false; knop.innerHTML = `${I_HAAL}Velden ophalen`;
  }
}
const I_HAAL = svgI('<path d="M12 4v11"/><path d="M7 10l5 5 5-5"/><path d="M5 20h14"/>', 20);
/* nummers aantikken: elke tik op een veld geeft het het volgende nummer */
function vrijNummer(n, behalve){
  const bezet = new Set(B.park.velden.filter(v => v !== behalve && v.naam !== '?').map(v => veldNorm(v.naam)));
  while (bezet.has(String(n))) n++;
  return n;
}
function startNummeren(){
  B.modus = 'nummer'; B.sel = null;
  B.volgende = vrijNummer(1);
}
/* ---------- [20261120g] alle sportparken (eigen + tegenstanders) ---------- */
async function haalParken(club){
  const snap = await getDocs(collection(db, 'clubs', club, 'sportparken'));
  return snap.docs.map(d => ({ id:d.id, ...d.data() }));
}
async function tekenParken(paneel){
  paneel.innerHTML = laden('Sportparken laden…');
  let parken = [];
  try { parken = await haalParken(B.club); }
  catch (e){ paneel.innerHTML = `<p class="vk-let">${ico('action-warning', 18)}<span>${e?.code === 'permission-denied' ? 'Geen rechten om sportparken te lezen (Firestore-regels).' : 'Sportparken laden mislukt. Controleer je verbinding.'}</span></p>`; return; }
  if (!B.slNamen) B.slNamen = sportlinkNamen(B.club);
  const { parken:uitProgramma } = await B.slNamen;
  if (!paneel.isConnected) return;
  const bekend = new Map(parken.map(p => [p.id, p]));
  const rijPark = p => {
    const v = (p.velden || []).length, pl = (p.plekken || []).length;
    return `<div class="vk-parkrij${p.id === B.parkId ? ' aan' : ''}">
      <button type="button" class="vk-parkrij-hoofd" data-vk-park="${esc(p.id)}">${ico('match-location', 20)}<span><b>${esc(p.id === 'eigen' ? (p.naam || 'Eigen sportpark') + ' (eigen)' : (p.naam || p.id) + (p.thuispark ? ' (thuispark)' : ''))}</b>
        <small>${esc([p.plaats, `${v} veld${v === 1 ? '' : 'en'}`, pl ? `${pl} plek${pl === 1 ? '' : 'ken'}` : ''].filter(Boolean).join(' · '))}${p.lat == null ? ' · nog niet op de kaart' : ''}</small></span></button>
      ${p.id === 'eigen' ? '' : `<button type="button" class="vk-chip${p.thuispark ? ' aan' : ''}" data-vk-thuis="${esc(p.id)}" aria-pressed="${!!p.thuispark}" title="Thuiswedstrijden gebruiken dit sportpark">${ico('navigation-home', 16)}Thuis</button>`}
      ${p.id === 'eigen' ? '' : `<button type="button" class="knop gevaar klein" data-vk-parkweg="${esc(p.id)}" aria-label="${esc(p.naam || p.id)} verwijderen">${ico('admin-delete', 16)}</button>`}</div>`;
  };
  const eigen = bekend.get('eigen') || { id:'eigen', naam:'Eigen sportpark', velden:[] };
  const anderen = parken.filter(p => p.id !== 'eigen').sort((a, b) => String(a.naam || '').localeCompare(String(b.naam || ''), 'nl'));
  /* al ingetekend onder een (iets) andere naam? dan niet nog eens aanbieden */
  const nieuwUit = uitProgramma.filter(x => !bekend.has(x.id) && !parken.some(p => p.id !== 'eigen' && naamPast(p.naam, x.naam)));
  paneel.innerHTML = `
    <div class="vk-label">Sportparken op de kaart</div>
    ${rijPark(eigen)}${anderen.map(rijPark).join('') || ''}
    ${nieuwUit.length ? `<div class="vk-label">Uit het wedstrijdprogramma, nog niet op de kaart</div>
      <p class="vk-zacht">Zo heten ze in Sportlink. Tik er een aan om de velden en plekken in te tekenen; bij die wedstrijden staat het dan meteen goed.</p>
      ${nieuwUit.map((x, n) => `<button type="button" class="vk-zoekrij" data-vk-uitprog="${n}">${ico('match-away', 18)}<span><b>${esc(x.naam)}</b><small>${esc([x.plaats, x.tegen, `${x.keer}× in het programma`].filter(Boolean).join(' · '))}</small></span></button>`).join('')}` : ''}
    <p class="vk-zacht">${ico('navigation-home', 16)}Met "Thuis" kies je welk sportpark bij thuiswedstrijden hoort, als dat niet het eigen sportpark bovenaan is.</p>
    <div class="vk-label">Zelf een sportpark toevoegen</div>
    <form class="vk-nieuwpark" data-vk-nieuwpark>
      <label class="vk-label" for="vkPnaam">Naam (zoals in Sportlink)</label><input id="vkPnaam" class="invoer" required maxlength="60" placeholder="Bijv. Sportpark De Hoef">
      <label class="vk-label" for="vkPplaats">Plaats</label><input id="vkPplaats" class="invoer" maxlength="40" placeholder="Bijv. Beek en Donk">
      <div class="vk-acties"><button type="submit" class="knop fluo">${ico('action-add', 20)}Toevoegen en intekenen</button></div>
    </form>`;
  paneel.querySelectorAll('[data-vk-park]').forEach(b => b.onclick = () => openSportparkBeheer(B.club, 'velden', b.dataset.vkPark));
  paneel.querySelectorAll('[data-vk-uitprog]').forEach(b => b.onclick = () => {
    const x = nieuwUit[+b.dataset.vkUitprog];
    openSportparkBeheer(B.club, 'velden', x.id, { naam:x.naam, plaats:x.plaats || '', adres:x.adres || '' });
  });
  paneel.querySelector('[data-vk-nieuwpark]').onsubmit = e => {
    e.preventDefault();
    const naam = paneel.querySelector('#vkPnaam').value.trim(), plaats = paneel.querySelector('#vkPplaats').value.trim();
    const id = sleutelVan(`${naam} ${plaats}`);
    if (!id || id === 'eigen') return meld('Vul de naam van het sportpark in.');
    if (bekend.has(id)) return openSportparkBeheer(B.club, 'velden', id);
    openSportparkBeheer(B.club, 'velden', id, { naam, plaats });
  };
  paneel.querySelectorAll('[data-vk-thuis]').forEach(b => b.onclick = async () => {
    const id = b.dataset.vkThuis, aan = !bekend.get(id)?.thuispark;
    b.disabled = true;
    try {
      for (const p of parken) if (p.id !== 'eigen' && (p.id === id ? aan !== !!p.thuispark : (aan && p.thuispark)))
        await setDoc(parkRef(B.club, p.id), { thuispark:p.id === id ? aan : false }, { merge:true });
      for (const p of parken) _park.delete(B.club + '/' + p.id);
      _alle.delete(B.club);
      meld(aan ? 'Thuiswedstrijden gebruiken nu dit sportpark' : 'Thuispark uitgezet');
      tekenParken(paneel);
    } catch (err){ meld('Opslaan mislukt: ' + (err?.code || err?.message || 'onbekende fout')); b.disabled = false; }
  });
  paneel.querySelectorAll('[data-vk-parkweg]').forEach(b => b.onclick = async () => {
    const p = bekend.get(b.dataset.vkParkweg);
    if (!p || !confirm(`${p.naam || 'Dit sportpark'} met alle velden en plekken verwijderen?`)) return;
    try {
      await deleteDoc(parkRef(B.club, p.id));
      _park.delete(B.club + '/' + p.id); _alle.delete(B.club);
      meld('Sportpark verwijderd');
      if (B.parkId === p.id) return openSportparkBeheer(B.club, 'parken');
      tekenParken(paneel);
    } catch (err){ meld('Verwijderen mislukt: ' + (err?.code || err?.message || 'onbekende fout')); }
  });
}
function tekenBeheer(){
  const el = document.querySelector('#vkLaag .vk-body');
  if (!el || !B) return;
  for (const k of [..._kaarten]) if (el.contains(k.el)) k.opruimen();
  const seg = `<div class="segment vk-seg" role="tablist">${[['velden', 'Velden en plekken'], ['parken', 'Sportparken'], ['meldingen', 'Meldingen']].map(([id, n]) =>
    `<button type="button" role="tab" aria-selected="${B.tab === id}" class="${B.tab === id ? 'actief' : ''}" data-vk-tab="${id}">${n}<span data-vk-tel="${id}"></span></button>`).join('')}</div>`;
  el.innerHTML = seg + `<div data-vk-paneel></div>`;
  el.querySelectorAll('[data-vk-tab]').forEach(b => b.onclick = () => { B.tab = b.dataset.vkTab; tekenBeheer(); });
  telMeldingen(B.club).then(n => { const t = el.querySelector('[data-vk-tel="meldingen"]'); if (t && n) t.innerHTML = ` <em class="vk-tel">${n}</em>`; });
  const paneel = el.querySelector('[data-vk-paneel]');
  if (B.tab === 'meldingen') return tekenMeldingen(paneel);
  if (B.tab === 'parken') return tekenParken(paneel);
  paneel.insertAdjacentHTML('beforeend', `<div class="vk-parkkop"><span>${ico('match-location', 18)}<b>${esc(B.parkId === 'eigen' ? 'Eigen sportpark' : B.park.naam || 'Sportpark')}</b>${B.park.plaats ? `<small>${esc(B.park.plaats)}</small>` : ''}</span>
    <button type="button" class="knop licht klein" data-vk-wissel>Ander sportpark</button></div>`);
  paneel.querySelector('[data-vk-wissel]').onclick = () => { B.tab = 'parken'; tekenBeheer(); };
  /* [20261120m] naam en plaats van een sportpark van een tegenstander aanpassen */
  if (B.parkId !== 'eigen'){
    paneel.insertAdjacentHTML('beforeend', `<div class="vk-parknaam">
      <label><span class="vk-label">Naam</span><input class="invoer" data-vk-pn="naam" value="${esc(B.park.naam || '')}" maxlength="60" placeholder="Bijv. Sportpark De Neul"></label>
      <label><span class="vk-label">Plaats</span><input class="invoer" data-vk-pn="plaats" value="${esc(B.park.plaats || '')}" maxlength="40" placeholder="Bijv. Rhode"></label>
      <p class="vk-zacht">Gebruik de naam zoals Sportlink hem noemt; dan vindt elke wedstrijd hier dit sportpark. Opslaan met Sportpark opslaan.</p></div>`);
    paneel.querySelectorAll('[data-vk-pn]').forEach(inp => inp.oninput = () => { B.park[inp.dataset.vkPn] = inp.value.trim(); });
  }
  if (B.fout === 'permission-denied') paneel.insertAdjacentHTML('beforeend', `<p class="vk-let">${ico('action-warning', 18)}<span>Geen rechten om het sportpark te lezen. Publiceer eerst de Firestore-regels uit VELDKAART-RULES.md.</span></p>`);
  if (B.park.lat == null){
    paneel.insertAdjacentHTML('beforeend', `<p class="vk-uitleg"><b>Zoek het sportpark.</b> Typ de clubnaam, de naam van het sportpark of het adres. Daarna zet je de velden op de luchtfoto.</p>
      <div data-vk-zoekvak>${zoekHtml('vkZoek', B.parkId === 'eigen' ? B.clubNaam : [B.park.adres || B.park.naam, B.park.plaats].filter(Boolean).join(' '), 'Bijv. clubnaam, sportpark of adres')}</div>`);
    koppelZoek(paneel.querySelector('[data-vk-zoekvak]'), r => { Object.assign(B.park, { lat:rond(r.lat), lon:rond(r.lon), zoom:17, adres:B.park.adres || r.naam }); tekenBeheer(); });
    return;
  }
  paneel.insertAdjacentHTML('beforeend', `<div class="vk-beheer">
      <div class="vk-beheer-kaart">
        <div class="segment vk-niv-seg" role="group" aria-label="Bekijk de velden als">${['heel', 'half', 'kwart'].map(n =>
          `<button type="button" class="${B.niveau === n ? 'actief' : ''}" aria-pressed="${B.niveau === n}" data-vk-niveau="${n}">${NIVEAU_NAAM[n]}</button>`).join('')}</div>
        <div class="vk-kaart-groot" data-vk-kaart></div><p class="vk-hint" data-vk-hint></p></div>
      <div class="vk-beheer-zij" data-vk-zij></div></div>`);
  B.kaart = new Kaart(paneel.querySelector('[data-vk-kaart]'), {
    lat:B.park.lat, lon:B.park.lon, z:B.park.zoom || 17, interactief:true, locatieKnop:true, onTik:tikBeheer, grijp:grijpBeheer,
    lagen:k => veldenLaag(k, B.park.velden, { gekozen:B.sel, greep:true, niveau:B.niveau }) + plekkenLaag(k, B.park.plekken, { gekozen:B.sel, greep:true }),
  });
  paneel.querySelectorAll('[data-vk-niveau]').forEach(b => b.onclick = () => { B.niveau = b.dataset.vkNiveau; B.kaart.tekenLagen(); werkNiveauBij(); });
  tekenZij();
}
function werkNiveauBij(){
  document.querySelectorAll('#vkLaag [data-vk-niveau]').forEach(b => { const aan = b.dataset.vkNiveau === B.niveau; b.classList.toggle('actief', aan); b.setAttribute('aria-pressed', String(aan)); });
}
function hint(){
  if (B.modus === 'plaats') return 'Tik op het midden van het nieuwe veld.';
  if (B.modus === 'nummer') return `Tik het veld aan dat Veld ${B.volgende} wordt. Verkeerd? Tik het opnieuw aan voor het volgende nummer, of begin opnieuw.`;
  if (B.modus.startsWith('plek:')) return `Tik op de plek van ${PLEK[B.modus.slice(5)]?.naam.toLowerCase() || 'de plek'}.`;
  if (gekozenVeld()?.lengte) return 'Sleep het veld om het te verplaatsen, het rondje om te draaien en de hoek rechtsonder om de maat te veranderen.';
  if (gekozenPlek()) return 'Sleep de plek om hem te verplaatsen en het rondje om hem te draaien.';
  return B.park.velden.length || B.park.plekken.length ? 'Tik op een veld of plek om het aan te passen. Sleep om de kaart te verschuiven.' : 'Kies Veld toevoegen en tik op het midden van een veld.';
}
/* Greepjes op het gekozen veld of de gekozen plek (zie Kaart.grijp). */
function grijpBeheer(e, k){
  const g = e.target.closest?.('[data-vk-greep]');
  if (!g) return null;
  const soort = g.dataset.vkGreep, v = gekozenVeld() || gekozenPlek();
  if (!v) return null;
  const r = k.el.getBoundingClientRect(), start = k.ll(e.clientX - r.left, e.clientY - r.top), basis = { lat:v.lat, lon:v.lon };
  return {
    move(p){
      if (soort === 'sleep'){ v.lat = rond(basis.lat + p.lat - start.lat); v.lon = rond(basis.lon + p.lon - start.lon); }
      else if (soort === 'draai'){
        const c = k.px(v.lat, v.lon), q = k.px(p.lat, p.lon);
        let h = Math.atan2(q.y - c.y, q.x - c.x) / RAD;
        if (h > 90) h -= 180; else if (h <= -90) h += 180;
        v.hoek = Math.round(h);
      } else if (soort === 'maat'){
        const d = meterVerschil(v, p), h = (v.hoek || 0) * RAD;
        const u = d.x * Math.cos(h) + d.y * Math.sin(h), w = -d.x * Math.sin(h) + d.y * Math.cos(h);
        v.lengte = Math.min(120, Math.max(20, Math.round(Math.abs(u) * 2)));
        v.breedte = Math.min(90, Math.max(15, Math.round(Math.abs(w) * 2)));
      }
      k.tekenLagen(); werkWaardenBij(v);
    },
    eind(){ tekenZij(); },
  };
}
function werkWaardenBij(v){
  const zij = document.querySelector('#vkLaag [data-vk-zij]');
  if (!zij) return;
  for (const [veld, eenheid] of [['hoek', '°'], ['lengte', ' m'], ['breedte', ' m']]){
    const inp = zij.querySelector(`[data-vk-r="${veld}"]`), lbl = zij.querySelector(`[data-vk-w="${veld}"]`);
    if (inp && v[veld] != null){ inp.value = v[veld]; if (lbl) lbl.textContent = v[veld] + eenheid; }
  }
}
function tikBeheer(p){
  if (B.modus === 'plaats'){
    const nrs = B.park.velden.map(x => parseInt(nrVan(x), 10)).filter(n => !isNaN(n));
    const nieuw = { id:nieuwId(), naam:`Veld ${(nrs.length ? Math.max(...nrs) : 0) + 1}`, lat:rond(p.lat), lon:rond(p.lon), lengte:100, breedte:64, hoek:0, splits:{ half:false, kwart:false } };
    B.park.velden.push(nieuw); B.sel = nieuw.id; B.modus = 'kijk';
  } else if (B.modus === 'nummer'){
    const veld = [...B.park.velden].reverse().find(x => binnenVeld(x, p));
    if (veld){ veld.naam = '?'; veld.naam = `Veld ${vrijNummer(B.volgende, veld)}`; B.volgende = vrijNummer(+nrVan(veld) + 1); B.sel = null; }
    if (!B.park.velden.some(v => v.naam === '?')){ B.modus = 'kijk'; meld('Alle velden hebben een nummer. Vergeet niet op te slaan.'); }
  } else if (B.modus.startsWith('plek:')){
    const soort = B.modus.slice(5);
    const nieuw = { id:nieuwId(), soort, naam:soort === 'kleedkamer' ? 'Kleedkamers 1–4' : PLEK[soort]?.naam || 'Plek', lat:rond(p.lat), lon:rond(p.lon) };
    B.park.plekken.push(nieuw); B.sel = nieuw.id; B.modus = 'kijk';
  } else {
    const q = B.kaart.px(p.lat, p.lon);
    const plek = [...B.park.plekken].reverse().find(x => { const a = B.kaart.px(x.lat, x.lon); return Math.hypot(a.x - q.x, a.y - q.y) < 24; });
    const veld = plek ? null : [...B.park.velden].reverse().find(x => binnenVeld(x, p));
    B.sel = plek?.id || veld?.id || null;
  }
  B.kaart.tekenLagen(); tekenZij();
}
function miniVeld(soort){
  const lijn = soort === 'heel' ? '' : `<path d="M20 3v18"/>${soort === 'vier' ? '<path d="M3 12h34"/>' : ''}`;
  return `<svg width="40" height="24" viewBox="0 0 40 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-dasharray="${soort === 'heel' ? '0' : '3 2'}" aria-hidden="true"><rect x="3" y="3" width="34" height="18" rx="2" stroke-dasharray="0"/>${lijn}</svg>`;
}
function veldEditor(v){
  const sp = splitsVan(v);
  const draaiKnoppen = `<div class="vk-draai-knoppen">${[[-5, '−5°'], [-1, '−1°'], [1, '+1°'], [5, '+5°'], [90, '90°']].map(([d, t]) =>
    `<button type="button" class="vk-chip" data-vk-draai="${d}" aria-label="Draai ${t}">${t}</button>`).join('')}</div>`;
  return `<div class="vk-editor">
    <label class="vk-label" for="vkNaam">Naam</label><input id="vkNaam" class="invoer" value="${esc(v.naam)}" maxlength="30">
    ${v.lengte ? `
    <label class="vk-label" for="vkHoek">Draaien <span data-vk-w="hoek">${v.hoek || 0}°</span></label>
    <input id="vkHoek" type="range" min="-90" max="90" step="1" value="${v.hoek || 0}" data-vk-r="hoek">${draaiKnoppen}
    <label class="vk-label" for="vkLengte">Lengte <span data-vk-w="lengte">${v.lengte} m</span></label><input id="vkLengte" type="range" min="20" max="120" step="1" value="${v.lengte}" data-vk-r="lengte">
    <label class="vk-label" for="vkBreedte">Breedte <span data-vk-w="breedte">${v.breedte} m</span></label><input id="vkBreedte" type="range" min="15" max="90" step="1" value="${v.breedte}" data-vk-r="breedte">
    <div class="vk-label">Ook gebruikt voor kleinere wedstrijden</div>
    ${['half', 'kwart'].map(niv => `<div class="vk-niveau${sp[niv] ? ' aan' : ''}">
      <button type="button" class="vk-schakel" data-vk-split="${niv}" aria-pressed="${!!sp[niv]}">${miniVeld(niv === 'half' ? 'twee' : 'vier')}
        <span><b>${NIVEAU_NAAM[niv]}</b><small>${NIVEAU_UITLEG[niv]}</small></span><span class="lj-schakel ${sp[niv] ? 'aan' : ''}"></span></button>
      ${sp[niv] ? `<div class="vk-delen">${NIVEAUS[niv].map(([k]) =>
        `<label><span>${esc(k)}</span><input class="invoer" data-vk-deel="${esc(k)}" data-vk-niv="${niv}" value="${esc(deelNaam(v, k))}" maxlength="20" aria-label="Naam van ${esc(NIVEAU_NAAM[niv].toLowerCase())} ${esc(k)}"></label>`).join('')}</div>
        ${niv === 'kwart' ? '<p class="vk-zacht">"Voor" is de kant aan de bovenkant van de kaart. Klopt dat niet, pas de namen dan aan.</p>' : ''}` : ''}
    </div>`).join('')}
` : `<p class="vk-zacht">Dit veld is als stip aangewezen. Verwijder het en voeg het opnieuw toe als rechthoek.</p>`}
    <div class="vk-acties vk-rij"><button type="button" class="knop gevaar klein" data-vk-weg>${ico('admin-delete', 16)}Verwijderen</button></div>
  </div>`;
}
function plekEditor(p){
  return `<div class="vk-editor">
    <div class="vk-label">Soort</div>
    <div class="vk-veldlijst">${Object.entries(PLEK).map(([k, d]) => `<button type="button" class="vk-chip${p.soort === k ? ' aan' : ''}" data-vk-soort="${k}">${plekIco(k, 16)}${esc(d.naam)}</button>`).join('')}</div>
    <label class="vk-label" for="vkPlekNaam">Naam</label><input id="vkPlekNaam" class="invoer" value="${esc(p.naam)}" maxlength="40">
    <label class="vk-label" for="vkPlekHoek">Draaien <span data-vk-w="hoek">${p.hoek || 0}°</span></label>
    <input id="vkPlekHoek" type="range" min="-90" max="90" step="1" value="${p.hoek || 0}" data-vk-r="hoek">
    <div class="vk-draai-knoppen">${[[-5, '−5°'], [-1, '−1°'], [1, '+1°'], [5, '+5°'], [90, '90°'], [0, 'Recht']].map(([d, t]) =>
      `<button type="button" class="vk-chip" data-vk-draai="${d}" aria-label="${d ? 'Draai ' + t : 'Zet recht'}">${t}</button>`).join('')}</div>
    ${p.soort === 'kleedkamer' ? '<p class="vk-zacht">Zet de nummers in de naam, bijvoorbeeld "Kleedkamers 1–4" of "Kleedkamer 5 en 6". Dan licht bij een wedstrijd de juiste kleedkamer op.</p>' : ''}
    <div class="vk-acties vk-rij"><button type="button" class="knop gevaar klein" data-vk-weg>${ico('admin-delete', 16)}Verwijderen</button></div>
  </div>`;
}
function tekenZij(){
  const zij = document.querySelector('#vkLaag [data-vk-zij]');
  const h = document.querySelector('#vkLaag [data-vk-hint]');
  if (h) h.textContent = hint();
  if (!zij) return;
  const v = gekozenVeld(), pl = v ? null : gekozenPlek();
  const items = [...B.park.velden.map(x => ({ id:x.id, t:metVeld(x.naam) + (x.lengte ? '' : ' (stip)'), i:'' })),
                 ...B.park.plekken.map(x => ({ id:x.id, t:x.naam || PLEK[x.soort]?.naam, i:plekIco(x.soort, 16) }))];
  const lijst = items.length ? `<div class="vk-veldlijst">${items.map(x =>
    `<button type="button" class="vk-chip${x.id === B.sel ? ' aan' : ''}" data-vk-kies="${esc(x.id)}">${x.i}${esc(x.t)}</button>`).join('')}</div>` : '';
  const plekKeuze = B.modus === 'kiesPlek' || B.modus.startsWith('plek:') ? `<div class="vk-veldlijst" role="group" aria-label="Soort plek">${Object.entries(PLEK).map(([k, d]) =>
    `<button type="button" class="vk-chip${B.modus === 'plek:' + k ? ' aan' : ''}" data-vk-nieuweplek="${k}">${plekIco(k, 16)}${esc(d.naam)}</button>`).join('')}</div>` : '';
  const zonderNr = B.park.velden.filter(x => x.naam === '?').length;
  const nummer = B.modus === 'nummer' ? `<div class="vk-nummer"><b>Nummers aantikken</b><span>Volgende: Veld ${B.volgende}${zonderNr ? ` · nog ${zonderNr} zonder nummer` : ''}</span>
      <div class="vk-rij"><button type="button" class="knop licht klein" data-vk-nropnieuw>Opnieuw bij 1</button><button type="button" class="knop fluo klein" data-vk-nrklaar>Klaar</button></div></div>` : '';
  zij.innerHTML = `${nummer}${lijst}
    <div class="vk-acties vk-rij">
      <button type="button" class="knop licht" data-vk-osm title="Voetbalvelden uit OpenStreetMap rond het midden van de kaart">${I_HAAL}Velden ophalen</button>
      ${B.park.velden.length ? `<button type="button" class="knop licht${B.modus === 'nummer' ? ' aan' : ''}" data-vk-nummer>${ico('admin-edit', 20)}Nummers aantikken</button>` : ''}</div>
    <div class="vk-acties vk-rij">
      <button type="button" class="knop licht${B.modus === 'plaats' ? ' aan' : ''}" data-vk-nieuw>${ico('action-add', 20)}Veld toevoegen</button>
      <button type="button" class="knop licht${B.modus === 'kiesPlek' || B.modus.startsWith('plek:') ? ' aan' : ''}" data-vk-plek>${plekIco('kantine', 20)}Plek toevoegen</button></div>
    ${plekKeuze}
    ${v ? veldEditor(v) : pl ? plekEditor(pl) : ''}
    <div class="vk-acties"><button type="button" class="knop vol fluo" data-vk-bewaar>${ico('admin-save', 20)}Sportpark opslaan</button></div>
    <details class="vk-elders"${B.zoek ? ' open' : ''}><summary>Kaart naar een andere plek? Zoek op clubnaam of adres</summary>${zoekHtml('vkZoekB', '', 'Clubnaam, sportpark of adres')}</details>
    <div class="vk-sl" data-vk-sl></div>`;
  zij.querySelectorAll('[data-vk-kies]').forEach(b => b.onclick = () => {
    B.sel = b.dataset.vkKies; B.modus = 'kijk';
    const x = gekozenVeld() || gekozenPlek(); if (x) B.kaart.centreer(x);
    tekenZij();
  });
  zij.querySelector('[data-vk-osm]').onclick = e => veldenOphalen(e.currentTarget);
  zij.querySelector('[data-vk-nummer]')?.addEventListener('click', () => { if (B.modus === 'nummer') B.modus = 'kijk'; else startNummeren(); B.kaart.tekenLagen(); tekenZij(); });
  zij.querySelector('[data-vk-nrklaar]')?.addEventListener('click', () => { B.modus = 'kijk'; tekenZij(); });
  zij.querySelector('[data-vk-nropnieuw]')?.addEventListener('click', () => { if (!confirm('Alle veldnummers wissen en opnieuw beginnen bij Veld 1?')) return; for (const v of B.park.velden) v.naam = '?'; B.volgende = 1; B.sel = null; B.kaart.tekenLagen(); tekenZij(); });
  zij.querySelector('[data-vk-nieuw]').onclick = () => { B.modus = B.modus === 'plaats' ? 'kijk' : 'plaats'; B.sel = null; B.kaart.tekenLagen(); tekenZij(); };
  zij.querySelector('[data-vk-plek]').onclick = () => { B.modus = B.modus === 'kiesPlek' || B.modus.startsWith('plek:') ? 'kijk' : 'kiesPlek'; B.sel = null; B.kaart.tekenLagen(); tekenZij(); };
  zij.querySelectorAll('[data-vk-nieuweplek]').forEach(b => b.onclick = () => { B.modus = 'plek:' + b.dataset.vkNieuweplek; tekenZij(); });
  zij.querySelector('[data-vk-bewaar]').onclick = bewaarBeheer;
  const elders = zij.querySelector('.vk-elders');
  elders.ontoggle = () => { B.zoek = elders.open; };
  koppelZoek(elders, r => { B.kaart.centreer({ lat:r.lat, lon:r.lon }, 17); B.zoek = false; elders.open = false; });
  const weg = zij.querySelector('[data-vk-weg]');
  if (v){
    const opnieuw = () => { B.kaart.tekenLagen(); tekenSl(); };
    zij.querySelector('#vkNaam').oninput = e => { v.naam = e.target.value; opnieuw(); };
    zij.querySelectorAll('[data-vk-r]').forEach(inp => {
      inp.oninput = () => { v[inp.dataset.vkR] = +inp.value; werkWaardenBij(v); B.kaart.tekenLagen(); };
    });
    zij.querySelectorAll('[data-vk-draai]').forEach(b => b.onclick = () => {
      let h = (v.hoek || 0) + Number(b.dataset.vkDraai);
      while (h > 90) h -= 180; while (h <= -90) h += 180;
      v.hoek = h; werkWaardenBij(v); B.kaart.tekenLagen();
    });
    zij.querySelectorAll('[data-vk-split]').forEach(b => b.onclick = () => {
      const niv = b.dataset.vkSplit, sp = { ...splitsVan(v) };
      sp[niv] = !sp[niv]; v.splits = sp; delete v.indeling;
      B.niveau = sp[niv] ? niv : 'heel';
      B.kaart.tekenLagen(); tekenZij();
    });
    zij.querySelectorAll('[data-vk-deel]').forEach(inp => inp.onfocus = () => { if (B.niveau !== inp.dataset.vkNiv){ B.niveau = inp.dataset.vkNiv; B.kaart.tekenLagen(); werkNiveauBij(); } });
    zij.querySelectorAll('[data-vk-deel]').forEach(inp => inp.oninput = () => {
      v.delen = { ...(v.delen || {}), [inp.dataset.vkDeel]:inp.value.trim() }; opnieuw();
    });
    weg.onclick = () => {
      if (!confirm(`${metVeld(v.naam)} verwijderen van de kaart?`)) return;
      B.park.velden = B.park.velden.filter(x => x.id !== v.id); B.sel = null; B.kaart.tekenLagen(); tekenZij();
    };
  } else if (pl){
    zij.querySelector('#vkPlekNaam').oninput = e => { pl.naam = e.target.value; B.kaart.tekenLagen(); tekenSl(); };
    zij.querySelector('#vkPlekHoek').oninput = e => { pl.hoek = +e.target.value; werkWaardenBij(pl); B.kaart.tekenLagen(); };
    zij.querySelectorAll('[data-vk-draai]').forEach(b => b.onclick = () => {
      const d = Number(b.dataset.vkDraai);
      let h = d === 0 ? 0 : (pl.hoek || 0) + d;
      while (h > 90) h -= 180; while (h <= -90) h += 180;
      pl.hoek = h; werkWaardenBij(pl); B.kaart.tekenLagen();
    });
    zij.querySelectorAll('[data-vk-soort]').forEach(b => b.onclick = () => {
      const oud = PLEK[pl.soort]?.naam;
      pl.soort = b.dataset.vkSoort;
      if (!pl.naam || pl.naam === oud) pl.naam = pl.soort === 'kleedkamer' ? 'Kleedkamers 1–4' : PLEK[pl.soort].naam;
      B.kaart.tekenLagen(); tekenZij();
    });
    weg.onclick = () => {
      if (!confirm(`${pl.naam || 'Deze plek'} verwijderen van de kaart?`)) return;
      B.park.plekken = B.park.plekken.filter(x => x.id !== pl.id); B.sel = null; B.kaart.tekenLagen(); tekenZij();
    };
  }
  tekenSl();
}
async function bewaarBeheer(){
  const zonderNr = B.park.velden.filter(v => v.naam === '?').length;
  if (zonderNr && !confirm(`${zonderNr} veld${zonderNr === 1 ? ' heeft' : 'en hebben'} nog geen nummer. Toch opslaan?`)) return;
  if (B.modus === 'nummer') B.modus = 'kijk';
  const velden = B.park.velden.map(v => {
    const x = { id:v.id, naam:String(v.naam || '').trim() || 'Veld', lat:v.lat, lon:v.lon };
    if (v.lengte){
      const sp = splitsVan(v);
      Object.assign(x, { lengte:v.lengte, breedte:v.breedte, hoek:v.hoek || 0, splits:{ half:!!sp.half, kwart:!!sp.kwart } });
      const d = {}; for (const niv of ['half', 'kwart']) for (const [k] of delenVan(v, niv)) if (v.delen?.[k]) d[k] = v.delen[k]; x.delen = d; }
    if (v.door) x.door = v.door;
    if (v.ms) x.ms = v.ms;
    return x;
  });
  const plekken = B.park.plekken.map(p => ({ id:p.id, soort:PLEK[p.soort] ? p.soort : 'overig', naam:String(p.naam || '').trim().slice(0, 40) || PLEK[p.soort]?.naam || 'Plek', lat:p.lat, lon:p.lon, hoek:Math.round(p.hoek || 0) }));
  const c = B.kaart ? { lat:rond(B.kaart.lat), lon:rond(B.kaart.lon), zoom:B.kaart.z } : {};
  const eigen = B.parkId === 'eigen';
  if (await bewaarPark(B.club, B.parkId, { naam:B.park.naam || (eigen ? 'Eigen sportpark' : 'Sportpark'), adres:B.park.adres || '', plaats:B.park.plaats || '', eigen, ...c, velden, plekken })){
    telGebruik('veldkaart_sportpark');
    meld('Sportpark opgeslagen');
  }
}

/* Welke veld- en kleedkamernamen gebruikt Sportlink bij thuiswedstrijden
   (laatste 60 dagen en komend)? Per naam: herkend op de kaart of niet. */
async function sportlinkNamen(club){
  const grens = new Date(Date.now() - 60 * 864e5).toISOString().slice(0, 10);
  const teams = (S.clubTeams || []).filter(t => !t.club || t.club === club).slice(0, 60);
  const velden = new Map(), kleed = new Map(), parken = new Map();
  const tel = (m, n, sleutel) => { const o = m.get(sleutel); if (o) o.keer++; else m.set(sleutel, { naam:n, keer:1 }); };
  await Promise.all(teams.map(async t => {
    try {
      const snap = await getDocs(query(collection(db, 'teams', t.id, 'wedstrijden'), where('datum', '>=', grens)));
      snap.forEach(d => {
        const w = d.data();
        if (!w.thuis){
          const id = parkSleutel(w), acc = w.slAccommodatie || {};
          if (id){ const o = parken.get(id); if (o) o.keer++; else parken.set(id, { id, keer:1, naam:acc.naam || w.locatie || `Sportpark van ${String(w.tegenstander || '').replace(/\s+(JO|MO|O)\d.*$/i, '')}`, plaats:acc.plaats || w.plaats || '', adres:acc.adres || w.adres || '', tegen:String(w.tegenstander || '').replace(/\s+(JO|MO|O)\d.*$/i, '') }); }
          return;
        }
        const v = String(w.slVeld || w.veld || '').trim(), k = String(w.slKleedkamer || w.kleedkamer || '').trim();
        if (v) tel(velden, v, veldNorm(v));
        if (k) tel(kleed, k, k.toLowerCase().replace(/[^a-z0-9]+/g, ''));
      });
    } catch { /* geen leesrecht op dit team: overslaan */ }
  }));
  const sorteer = m => [...m.values()].sort((a, b) => a.naam.localeCompare(b.naam, 'nl', { numeric:true }));
  return { velden:sorteer(velden), kleed:sorteer(kleed), parken:sorteer(parken) };
}
function tekenSl(){
  const vak = document.querySelector('#vkLaag [data-vk-sl]');
  if (!vak) return;
  if (B.parkId !== 'eigen' && !B.park.thuispark){ vak.innerHTML = ''; return; }   /* Sportlink-namen gelden voor thuiswedstrijden */
  if (!B.slNamen){
    vak.innerHTML = laden('Namen uit Sportlink ophalen…');
    B.slNamen = sportlinkNamen(B.club);
  }
  B.slNamen.then(({ velden, kleed }) => {
    const nu = document.querySelector('#vkLaag [data-vk-sl]');
    if (!nu || !B) return;
    const rij = (ok, naam, keer, waarom) => `<div class="vk-sl-rij"><span class="${ok ? 'vk-c-ok' : 'vk-c-let'}">${ico(ok ? 'action-check' : 'action-warning', 16)}</span><b>${esc(naam)}</b><span class="vk-zacht">${keer}×</span>${ok ? '' : `<span class="vk-c-let">${waarom}</span>`}</div>`;
    const vRijen = velden.map(x => { const d = zoekDoel(B.park, x.naam); return rij(d && !d.deelOnbekend, metVeld(x.naam), x.keer, d?.deelOnbekend ? 'deel niet ingedeeld' : 'niet op de kaart'); }).join('');
    const kRijen = kleed.map(x => rij(!!zoekKleedkamer(B.park, x.naam), /^\d/.test(x.naam) ? 'Kleedkamer ' + x.naam : x.naam, x.keer, 'niet op de kaart')).join('');
    nu.innerHTML = `<div class="vk-label">Zo noemt Sportlink de velden</div>${vRijen || '<p class="vk-zacht">Nog geen thuiswedstrijden met een veldnaam gevonden.</p>'}
      ${kRijen ? `<div class="vk-label">En de kleedkamers</div>${kRijen}` : ''}`;
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
        <button type="button" class="knop licht klein" data-vk-bekijk="${esc(m.id)}">${ico('match-location', 16)}Bekijk en pas aan</button>
        <button type="button" class="knop licht klein" data-vk-klaar="${esc(m.id)}">${ico('action-check', 16)}Opgelost</button></div>`}
    </div>`;
  paneel.innerHTML = `${open.length ? open.map(kaart).join('') : '<p class="vk-zacht">Geen open meldingen.</p>'}
    ${klaar.length ? `<div class="vk-label">Afgehandeld</div>${klaar.map(kaart).join('')}` : ''}`;
  paneel.querySelectorAll('[data-vk-bekijk]').forEach(b => b.onclick = () => {
    const m = lijst.find(x => x.id === b.dataset.vkBekijk); if (!m) return;
    openSportparkBeheer(B.club, 'velden', m.park || 'eigen', m.park === 'eigen' ? null : { naam:m.parkNaam || '', plaats:m.parkPlaats || '', adres:m.parkAdres || '' });
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
