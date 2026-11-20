/* ==================== OPSTELLINGSADVISEUR ====================
   [20261120a] Stelt voor de hele wedstrijd een opstelling voor (alle periodes),
   op basis van:
     • beschikbaarheid      w.selectie, w.telaat/telaatVanaf, uitleningen
     • seizoensspeeltijd    speeltijdReserve() over de eerdere wedstrijden
     • trainingsopkomst     opkomstVoor() over de laatste 6 weken
     • beoordelingen        S.beoordelingen (alleen wat deze coach mag zien)
     • resultaat            plus/min per speler en de laatste teamevaluatie
   Vooraf legt de coach vast: speelwijze (eerlijk/balans/resultaat), minimum
   per speler, formatie, wie de eerste periode disciplinair op de bank zit,
   de keeper (Cluppie kiest / per helft / per periode) en in welke periodes er
   extra gewisseld wordt (en na hoeveel minuten).

   Het rekenmodel draait volledig op het toestel: er gaan geen spelersgegevens
   naar een AI-dienst (AVG). Het is deterministisch; "Variant" geeft met een
   ander zaadje een andere verdeling binnen dezelfde regels.

   Toepassen schrijft alleen bestaande velden:
     kwarten[nr].lineup, kwarten[nr].formatie, kwarten[nr].plan (geplande
     wissels binnen een periode), w.formatie, w.startBankReden (disciplinair),
   plus w.advies = {modus, versie, gemaaktMs} ter herkenning. De laatst
   gekozen instellingen staan op het teamdoc als opstellingAdvies.

   Opgeroepen vanuit wedstrijd.js (openOpstellingAdvies). Opslaan en hertekenen
   gebeurt via de callback van wedstrijd.js, zodat er één schrijfpad blijft. */
import { db, doc, updateDoc } from './firebase.js?v=20261106r';
import { S, esc, meld, openModal, sluitModal, spelerNaam, spelerNr } from './state.js?v=20261111g';
import {
  bouwSlots, positieNaam, formatieNamen, isToernooi,
  POSITIE_GROEPEN, afwezigRedenInfo
} from './config.js?v=20261111g';
import { analyseWedstrijd, speeltijdReserve } from './analyse.js?v=20261111g';
import { opkomstVoor, MIN_OPKOMST_TRAININGEN } from './opkomst.js?v=20261106r';
import { spelersOpWedstrijd } from './uitleen-regels.js?v=20261111d';
import { TE_GROEPEN, teScores, teLaagste, teLeeftijd } from './team-evaluatie-criteria.js?v=20261119e';
import { ico } from './icons.js?v=20261106r';
import { telGebruik } from './tracker.js?v=20261111g';

const VERSIE = 1;
const svg = (d, n = 16, w = 1.8) => `<svg width="${n}" height="${n}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${d}</svg>`;
export const ADVIES_ICO = n => svg('<path d="M12 3.5l1.7 4.3 4.3 1.7-4.3 1.7L12 15.5l-1.7-4.3L6 9.5l4.3-1.7z"/><path d="M18.5 14.5l.8 2 2 .8-2 .8-.8 2-.8-2-2-.8 2-.8z"/><path d="M5.5 15.5l.6 1.4 1.4.6-1.4.6-.6 1.4-.6-1.4-1.4-.6 1.4-.6z"/>', n);
const IC = {
  pijl: svg('<path d="M5 12h14"/><path d="M13 6l6 6-6 6"/>', 13, 2),
  min: svg('<path d="M6 12h12"/>', 16, 2.2),
  plus: svg('<path d="M6 12h12M12 6v12"/>', 16, 2.2),
  klok: svg('<circle cx="12" cy="12" r="8.6"/><path d="M12 7.2V12l3.4 2.2"/>', 14),
  wissel: svg('<path d="M7 4v14"/><path d="M3.5 14.5L7 18l3.5-3.5"/><path d="M17 20V6"/><path d="M13.5 9.5L17 6l3.5 3.5"/>', 15),
  schild: svg('<path d="M12 3.5l7 3v5.2c0 4.3-3 7.6-7 8.8-4-1.2-7-4.5-7-8.8V6.5z"/><path d="M9 12l2 2 4-4"/>', 16),
  variant: svg('<path d="M4 12a8 8 0 0 1 13.7-5.6L20 8.5"/><path d="M20 4v4.5h-4.5"/><path d="M20 12a8 8 0 0 1-13.7 5.6L4 15.5"/><path d="M4 20v-4.5h4.5"/>', 16),
};
const komma = n => (Math.round(n * 10) / 10).toString().replace('.', ',');
const tijd = m => `${Math.floor(m)}:${String(Math.round((m % 1) * 60)).padStart(2, '0')}`;
const hoofd = s => s.charAt(0).toUpperCase() + s.slice(1);

/* ==================== INVOER VERZAMELEN ==================== */
const LIJN_VAN_POSITIE = (() => {
  const m = { Keeper: 'K', Linksbuiten: 'A', Rechtsbuiten: 'A' };
  for (const g of POSITIE_GROEPEN) for (const n of g.posities) m[n] = g.lijn;
  return m;
})();
/* Criteria uit de volledige beoordeling die iets zeggen over een linie
   (sleutels als in beoordeling-volledig.js: 'TE-0' … 'TA-5'). */
const LIJN_CRITERIA = { V: ['TE-4', 'TA-1', 'TA-2'], M: ['TE-2', 'TA-0', 'TA-4'], A: ['TE-1', 'TE-3', 'TA-3'] };
/* Zwakste teamevaluatie-criterium → linie die extra gewicht krijgt. */
const EVAL_LIJN = { opbouwen: 'M', kansen: 'A', storen: 'M', voorkomen: 'V', meedoen: 'M', balverlies: 'M', balwinst: 'A' };

function dagenVoor(datum, n){
  const d = new Date((datum || new Date().toISOString().slice(0, 10)) + 'T12:00');
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}

/* Opstelling (slot → speler) in een periode op seconde t: start + echte wissels. */
function veldOp(k, t){
  const l = { ...(k.lineup || {}) };
  for (const e of [...(k.events || [])].sort((a, b) => a.sec - b.sec)){
    if (e.sec > t) break;
    if (e.in) l[e.slot] = e.in; else delete l[e.slot];
  }
  return l;
}

function verzamel(w){
  const P = Number(w.periodes) || 4;
  const D = Number(w.kwartduur) || 15;
  const sel = new Set(w.selectie || []);
  const opW = spelersOpWedstrijd(S.spelers || [], w).lijst;
  const spelersRuw = opW.filter(p => sel.has(p.id));
  const afwezig = opW.filter(p => !sel.has(p.id)).map(p => {
    const r = (w.afwezigRedenen || {})[p.id];
    return { id: p.id, reden: r ? afwezigRedenInfo(r)?.label?.toLowerCase() : null };
  }).filter(x => x.reden);

  const eerder = (S.wedstrijden || []).filter(x => x.id !== S.wedstrijdId && !isToernooi(x)
    && (x.seizoen || '') === (w.seizoen || '') && (x.datum || '') <= (w.datum || '9999'))
    .sort((a, b) => (b.datum || '').localeCompare(a.datum || ''));
  const gespeeld = eerder.filter(x => analyseWedstrijd(x).kwarten > 0);

  const sr = speeltijdReserve(gespeeld);
  const hist = {};   // pid -> {keeper, lijn:{K,V,M,A}}
  for (const x of gespeeld){
    const a = analyseWedstrijd(x);
    for (const [pid, n] of Object.entries(a.keeper)) ((hist[pid] ||= { keeper: 0, lijn: {} }).keeper += n);
    for (const [pid, l] of Object.entries(a.lijn)){
      const h = (hist[pid] ||= { keeper: 0, lijn: {} });
      for (const [naam, n] of Object.entries(l)){
        const lijn = LIJN_VAN_POSITIE[naam] || (['K', 'V', 'M', 'A'].includes(naam[0]) && naam.length <= 2 ? naam[0] : null);
        if (lijn) h.lijn[lijn] = (h.lijn[lijn] || 0) + n;
      }
    }
  }

  /* plus/min: doelpunten voor en tegen terwijl de speler op het veld stond,
     over de laatste 8 gespeelde wedstrijden; gekrompen naar 0 bij weinig minuten. */
  const pm = {};
  for (const x of gespeeld.slice(0, 8)){
    const a = analyseWedstrijd(x);
    for (const g of (x.goals || [])){
      const k = x.kwarten?.[g.kwart]; if (!k || g.sec == null) continue;
      const op = Object.values(veldOp(k, g.sec));
      for (const pid of op){ const r = (pm[pid] ||= { saldo: 0, sec: 0 }); r.saldo += g.type === 'voor' ? 1 : g.type === 'tegen' ? -1 : 0; }
    }
    for (const [pid, s] of Object.entries(a.tijd)) (pm[pid] ||= { saldo: 0, sec: 0 }).sec += s;
  }

  const sessies = (S.presentie || []).filter(s => s.datum && s.datum >= dagenVoor(w.datum, 42) && s.datum < (w.datum || '9999'));
  const beo = {};
  for (const b of (S.beoordelingen || [])){
    if (!b.spelerId || (b.datum || '') < dagenVoor(w.datum, 150)) continue;
    (beo[b.spelerId] ||= []).push(b);
  }

  const spelers = spelersRuw.map(p => {
    const h = hist[p.id] || { keeper: 0, lijn: {} };
    const s = sr[p.id];
    const o = opkomstVoor(p, sessies);
    const lijst = (beo[p.id] || []).sort((a, b) => (b.datum || '').localeCompare(a.datum || '')).slice(0, 3);
    const niveaus = [];
    const crit = {};
    for (const b of lijst){
      if (b.soort === 'snel' && b.niveau >= 1) niveaus.push(Number(b.niveau));
      const sc = Object.values(b.scores || {}).map(Number).filter(v => v >= 1 && v <= 5);
      if (sc.length) niveaus.push(sc.reduce((x, y) => x + y, 0) / sc.length);
      for (const [c, v] of Object.entries(b.criteria || {})) if (crit[c] == null && v >= 1) crit[c] = Number(v);
    }
    const q = niveaus.length ? niveaus.reduce((x, y) => x + y, 0) / niveaus.length : null;
    const critGem = Object.values(crit).length ? Object.values(crit).reduce((x, y) => x + y, 0) / Object.values(crit).length : null;
    const lijnTot = Object.values(h.lijn).reduce((x, y) => x + y, 0) || 0;
    const voorkeurLijn = LIJN_VAN_POSITIE[p.positie] || null;
    const b = {};
    for (const L of ['V', 'M', 'A']){
      let v = q ?? 3;
      const cs = LIJN_CRITERIA[L].map(c => crit[c]).filter(x => x != null);
      if (cs.length && critGem != null) v += (cs.reduce((x, y) => x + y, 0) / cs.length - critGem) * 0.6;
      if (lijnTot) v += (h.lijn[L] || 0) / lijnTot * 0.6;
      if (voorkeurLijn === L) v += 0.4;
      b[L] = Math.round(Math.max(1, Math.min(5, v)) * 10) / 10;
    }
    b.K = Math.round(Math.min(5, (q ?? 3) + Math.min(1.2, h.keeper * 0.15) + (p.positie === 'Keeper' ? 0.8 : 0)) * 10) / 10;
    const m = pm[p.id];
    const minuten = m ? m.sec / 60 : 0;
    let vanaf = 1, laatOnbekend = false;
    if ((w.telaat || []).includes(p.id)){
      const min = Number((w.telaatVanaf || {})[p.id]);
      /* erbij op een periodegrens: vanaf die periode; anders vanaf de volgende */
      if (min > 0) vanaf = Math.min(P, min % D === 0 ? min / D + 1 : Math.floor(min / D) + 2);
      else { vanaf = Math.min(P, 2); laatOnbekend = true; }
    }
    return {
      id: p.id, nr: p.nummer ?? '', naam: spelerNaam(p.id) || p.naam || '', pos: p.positie || null,
      keeper: h.keeper > 0 || p.positie === 'Keeper', keeperKw: h.keeper,
      b, heeftBeo: q != null, q,
      gesp: s ? s.speeltijd / 60 : 0, speelb: s ? s.speelbaar / 60 : 0,
      opk: o.totaal >= MIN_OPKOMST_TRAININGEN ? o.pct : null, opkTotaal: o.totaal,
      pm: minuten >= 30 ? Math.round(m.saldo / (minuten / 60 + 1) * 10) / 10 : 0,
      vanaf, laatOnbekend,
    };
  });

  /* laatste teamevaluatie vóór deze wedstrijd */
  const lft = teLeeftijd(S.team?.categorie);
  const evs = (S.teamEvaluaties || []).filter(e => (e.datum || '') < (w.datum || '9999') && e.scores)
    .sort((a, b) => (b.datum || '').localeCompare(a.datum || ''));
  let evaluatie = null;
  if (evs.length){
    const l = teLaagste(teScores(evs[0], lft), lft);
    if (l){
      const crit = TE_GROEPEN.flatMap(g => g.crit).find(c => c.id === l.id);
      evaluatie = { id: l.id, naam: crit?.naam || l.id, score: l.score, datum: evs[0].datum, lijn: EVAL_LIJN[l.id] || null };
    }
  }
  const uitslagen = gespeeld.filter(x => (x.goals || []).length || analyseWedstrijd(x).kwarten).slice(0, 3).map(x => {
    const v = (x.goals || []).filter(g => g.type === 'voor').length, t = (x.goals || []).filter(g => g.type === 'tegen').length;
    return { r: v > t ? 'W' : v < t ? 'V' : 'G', s: `${v}-${t}` };
  });
  return { P, D, spelers, afwezig, nWedstrijden: gespeeld.length, nSessies: sessies.length, evaluatie, uitslagen };
}

/* ==================== REKENMODEL ==================== */
const ALPHA = { eerlijk: 0, balans: 0.6, resultaat: 1 };        // prestatie bij plek, start en slot
const ALPHA_TIJD = { eerlijk: 0, balans: 0.1, resultaat: 1 };   // prestatie bij de verdeling van minuten

/* Hongaarse methode: minimale kosten, n rijen ≤ m kolommen. → kolom per rij. */
function hongaars(a){
  const n = a.length, m = a[0]?.length || 0, INF = 1e18;
  if (!n || !m) return [];
  const u = new Array(n + 1).fill(0), v = new Array(m + 1).fill(0), p = new Array(m + 1).fill(0), way = new Array(m + 1).fill(0);
  for (let i = 1; i <= n; i++){
    p[0] = i; let j0 = 0;
    const minv = new Array(m + 1).fill(INF), used = new Array(m + 1).fill(false);
    do {
      used[j0] = true; const i0 = p[j0]; let delta = INF, j1 = 0;
      for (let j = 1; j <= m; j++) if (!used[j]){
        const cur = a[i0 - 1][j - 1] - u[i0] - v[j];
        if (cur < minv[j]){ minv[j] = cur; way[j] = j0; }
        if (minv[j] < delta){ delta = minv[j]; j1 = j; }
      }
      for (let j = 0; j <= m; j++){ if (used[j]){ u[p[j]] += delta; v[j] -= delta; } else minv[j] -= delta; }
      j0 = j1;
    } while (p[j0] !== 0);
    do { const j1 = way[j0]; p[j0] = p[j1]; j0 = j1; } while (j0);
  }
  const res = new Array(n).fill(-1);
  for (let j = 1; j <= m; j++) if (p[j]) res[p[j] - 1] = j - 1;
  return res;
}

function maakBlokken(cfg, P, D){
  const b = [];
  for (let k = 1; k <= P; k++){
    if (cfg.extra.includes(k)){
      b.push({ k, deel: 1, dur: cfg.moment });
      b.push({ k, deel: 2, dur: D - cfg.moment });
    } else b.push({ k, deel: 0, dur: D });
  }
  return b;
}

export function maakVoorstel(inv, cfg, w, variant = 0){
  let seed = 7 + variant * 31;
  const rnd = () => { seed = (seed * 9301 + 49297) % 233280; return seed / 233280; };
  const { P, D } = inv;
  const a = ALPHA[cfg.modus] ?? 0.6, at = ALPHA_TIJD[cfg.modus] ?? 0.2;
  const blokken = maakBlokken(cfg, P, D);
  const alle = bouwSlots(w.format, cfg.formatie);
  const metKeeper = alle.some(s => s.id === 'K');
  const slots = alle.filter(s => s.id !== 'K').map(s => ({ ...s, naam: positieNaam(s.lijn, s.x) }));
  const veldPlekken = slots.length;
  const spelers = inv.spelers.map(p => ({ ...p }));
  const metPct = spelers.filter(p => p.speelb > 0);
  const teamPct = metPct.length ? metPct.reduce((s, p) => s + p.gesp / p.speelb, 0) / metPct.length : 0;
  const evalLijn = cfg.resultaat && inv.evaluatie?.lijn ? inv.evaluatie.lijn : null;
  const disc = new Set(cfg.disc);

  for (const p of spelers){
    p.avK = Array.from({ length: P }, (_, i) => i + 1 >= p.vanaf && !(disc.has(p.id) && i === 0));
    p.pct = p.speelb > 0 ? p.gesp / p.speelb : teamPct;
    p.veldQ = Math.max(p.b.V, p.b.M, p.b.A);
    p.qn = cfg.beoordeling ? (p.veldQ - 3.2) / 0.9 : 0;
    p.pmn = cfg.resultaat ? Math.max(-1, Math.min(1, p.pm)) : 0;
    p.tekort = cfg.seizoen && p.speelb > 0 ? Math.max(-1.5, Math.min(1.5, (teamPct - p.pct) / 0.2)) : 0;
    p.opkn = cfg.opkomst && p.opk != null ? (p.opk < 60 ? -1 : p.opk < 75 ? -0.4 : 0) : 0;
    p.rol = blokken.map(b => p.avK[b.k - 1] ? 'b' : (disc.has(p.id) && b.k === 1) ? 's' : 'x');
  }
  const byId = Object.fromEntries(spelers.map(p => [p.id, p]));

  /* keeper per periode (wisselt alleen aan het begin van een periode) */
  const keeperVan = {}, keeperBron = {};
  if (metKeeper){
    const kand = spelers.filter(p => p.keeper).sort((x, y) => y.b.K - x.b.K);
    for (let k = 1; k <= P; k++){
      const kan = p => p && p.avK[k - 1];
      const id = cfg.keeperModus === 'helft' ? cfg.keeperHelft[k <= P / 2 ? 1 : 2]
               : cfg.keeperModus === 'periode' ? cfg.keeperPeriode[k] : null;
      if (id && kan(byId[id])){ keeperVan[k] = id; keeperBron[k] = 'coach'; continue; }
      const besch = kand.filter(kan);
      const p = (a >= 1 || besch.length < 2) ? besch[0] : (k <= P / 2 ? besch[0] : besch[1]);
      if (p){ keeperVan[k] = p.id; keeperBron[k] = 'auto'; continue; }
      /* Geen keeper beschikbaar (bv. de vaste keeper zit disciplinair op de bank):
         wie eerder in deze wedstrijd keepte blijft, anders de hoogste keepersscore. */
      const eerder = keeperVan[k - 1] && kan(byId[keeperVan[k - 1]]) ? byId[keeperVan[k - 1]] : null;
      const nood = eerder || spelers.filter(kan).sort((x, y) => y.b.K - x.b.K)[0];
      if (nood){ keeperVan[k] = nood.id; keeperBron[k] = 'nood'; }
    }
    blokken.forEach((b, i) => { const p = byId[keeperVan[b.k]]; if (p) p.rol[i] = 'k'; });
  }

  /* 1. doelminuten in eenheden van het kortste blok */
  const E = Math.min(...blokken.map(b => b.dur));
  const u = b => b.dur / E;
  const veldAv = p => blokken.reduce((s, b, i) => s + (p.rol[i] === 'b' ? u(b) : 0), 0);
  const keepU = p => blokken.reduce((s, b, i) => s + (p.rol[i] === 'k' ? u(b) : 0), 0);
  const minU = cfg.min * D / E;
  const T = {};
  for (const p of spelers) T[p.id] = Math.max(0, Math.min(minU - keepU(p), veldAv(p)));
  let over = veldPlekken * P * D / E - Object.values(T).reduce((s, x) => s + x, 0);
  while (over > 0.01){
    let best = null, bestS = -1e9;
    for (const p of spelers){
      if (T[p.id] >= veldAv(p)) continue;
      const avTot = blokken.reduce((s, b, i) => s + (p.rol[i] === 'b' || p.rol[i] === 'k' ? u(b) : 0), 0) || 1;
      const eerlijk = -(T[p.id] + keepU(p)) / avTot * 6 + p.tekort;
      const prestatie = p.qn * 1.3 + p.pmn * 0.5;
      const s = (1 - at) * eerlijk + at * prestatie + p.opkn * 0.8 + rnd() * 0.25;
      if (s > bestS){ bestS = s; best = p; }
    }
    if (!best) break;
    T[best.id]++; over--;
  }

  /* 2. wie speelt welk blok */
  const rest = { ...T };
  blokken.forEach((b, i) => {
    const kand = spelers.filter(p => p.rol[i] === 'b');
    const restAv = p => blokken.slice(i).reduce((s, bb, j) => s + (p.rol[i + j] === 'b' ? u(bb) : 0), 0);
    const score = p => {
      if (rest[p.id] <= 0.01) return -100 + p.qn * a;
      if (rest[p.id] >= restAv(p) - 0.01) return 100;
      let s = rest[p.id] / restAv(p) * 2;
      const vorige = i > 0 ? p.rol[i - 1] : null;
      if (vorige === 'b' || vorige === 's') s += 0.8;
      if (b.deel === 2 && vorige === 'v') s += 0.6;
      if (b.k === 1 || b.k === P) s += a * p.qn * 0.7;
      return s + rnd() * 0.2;
    };
    const gekozen = kand.sort((x, y) => score(y) - score(x)).slice(0, veldPlekken);
    for (const p of gekozen){ p.rol[i] = 'v'; rest[p.id] -= u(b); }
  });

  /* 2b. vangnet: niemand onder het minimum (een hele periode kost twee
     eenheden tegelijk, dus de verdeling kan net misgrijpen). */
  const minMin = cfg.min * D;
  const speeltijd = p => blokken.reduce((s, b, i) => s + (p.rol[i] === 'v' || p.rol[i] === 'k' ? b.dur : 0), 0);
  for (let poging = 0; poging < 60; poging++){
    const tekort = spelers.filter(p => speeltijd(p) < minMin - 0.01 && p.rol.includes('b'))
      .sort((x, y) => speeltijd(x) - speeltijd(y))[0];
    if (!tekort) break;
    let ruil = null;
    blokken.forEach((b, i) => {
      if (tekort.rol[i] !== 'b') return;
      for (const q of spelers){
        if (q.rol[i] !== 'v' || speeltijd(q) - b.dur < minMin - 0.01) continue;
        const s = speeltijd(q) - a * q.qn * 5;
        if (!ruil || s > ruil.s) ruil = { i, q, s };
      }
    });
    if (!ruil) break;
    tekort.rol[ruil.i] = 'v'; ruil.q.rol[ruil.i] = 'b';
  }

  /* 3. posities per blok
     [20261120b] Een periode met een extra wisselmoment wordt als geheel ingedeeld:
     de invaller neemt de plek over van wie eruit gaat (zo werkt een geplande
     wissel) en wie doorspeelt houdt de hele periode dezelfde plek. Daarom:
       a. wie eruit gaat mag ruilen met een doorspeler als de opstelling na het
          wisselmoment daardoor beter klopt, zonder de minutenverdeling scheef
          te trekken (de doorspeler heeft ook na de ruil nog minstens zoveel
          gespeeld en blijft boven het minimum);
       b. eerst de beste opstelling na het wisselmoment (doorspelers en invallers),
       c. dan krijgen de spelers die eruit gaan de plekken van de invallers. */
  const plekScore = (p, s, vorige, si) => {
    let v = (p.b[s.lijn] || 2) * (cfg.beoordeling ? (0.6 + a) : 0.3);
    if (evalLijn === s.lijn) v += (p.b[s.lijn] || 2) * 0.25 * a;
    if (p.pos === s.naam) v += 0.9; else if (LIJN_VAN_POSITIE[p.pos] === s.lijn) v += 0.4;
    if (vorige){
      if (vorige[si] === p.id) v += 1.1;
      else if (vorige.some((pid, j) => pid === p.id && slots[j].lijn === s.lijn)) v += 0.5;
    }
    return v;
  };
  /* beste indeling van spelers op plekken; gewicht per speler (minuten) */
  const indelen = (spelersLijst, plekken, vorige, gewicht = () => 1) => {
    const uit = {};
    if (!spelersLijst.length || !plekken.length) return { uit, score: 0 };
    const rijen = spelersLijst.slice(0, plekken.length);
    const kosten = rijen.map(p => plekken.map(si => -plekScore(p, slots[si], vorige, si) * gewicht(p)));
    let score = 0;
    hongaars(kosten).forEach((j, r) => { if (j >= 0){ uit[plekken[j]] = rijen[r].id; score -= kosten[r][j]; } });
    return { uit, score };
  };
  const allePlekken = slots.map((_, si) => si);
  const opstelling = new Array(blokken.length);
  let vorige = null;
  for (let i = 0; i < blokken.length; i++){
    const b = blokken[i];
    if (b.deel !== 1){
      const veld = spelers.filter(p => p.rol[i] === 'v');
      const { uit } = indelen(veld, allePlekken, vorige);
      const rij = slots.map((_, si) => uit[si] || null);
      opstelling[i] = { K: keeperVan[b.k] || null, slots: rij };
      vorige = rij;
      continue;
    }
    /* periode met extra wisselmoment: blokken i (begin) en i+1 (na het moment) */
    const j = i + 1, b2 = blokken[j];
    const veld1 = () => spelers.filter(p => p.rol[i] === 'v');
    const veld2 = () => spelers.filter(p => p.rol[j] === 'v');
    const gewicht2 = p => p.rol[i] === 'v' ? (b.dur + b2.dur) / b2.dur : 1;   // doorspelers wegen de hele periode
    const scoreNa = () => indelen(veld2(), allePlekken, vorige, gewicht2).score;
    /* a. ruilen: geplande vertrekker blijft, doorspeler gaat eruit */
    for (let ronde = 0; ronde < 4; ronde++){
      const weg = veld1().filter(p => p.rol[j] !== 'v');
      const blijf = veld1().filter(p => p.rol[j] === 'v');
      if (!weg.length) break;
      const basis = scoreNa();
      let beste = null;
      for (const L of weg) for (const Sp of blijf){
        if (speeltijd(Sp) - b2.dur < minMin - 0.01) continue;
        if (speeltijd(Sp) - b2.dur < speeltijd(L) - 0.01) continue;
        L.rol[j] = 'v'; Sp.rol[j] = 'b';
        const winst = scoreNa() - basis - 0.8 - a * Sp.qn * 0.5;
        L.rol[j] = 'b'; Sp.rol[j] = 'v';
        if (winst > 0.01 && (!beste || winst > beste.winst)) beste = { L, Sp, winst };
      }
      if (!beste) break;
      beste.L.rol[j] = 'v'; beste.Sp.rol[j] = 'b';
    }
    /* b. opstelling na het wisselmoment */
    const na = indelen(veld2(), allePlekken, vorige, gewicht2).uit;
    const rij2 = slots.map((_, si) => na[si] || null);
    /* c. begin van de periode: doorspelers op dezelfde plek, vertrekkers op de plekken van de invallers */
    const rij1 = rij2.map(pid => (pid && spelers.find(p => p.id === pid).rol[i] === 'v') ? pid : null);
    const vertrekkers = veld1().filter(p => !rij1.includes(p.id));
    const vrij = allePlekken.filter(si => !rij1[si]);
    const { uit: begin } = indelen(vertrekkers, vrij, vorige);
    for (const [si, pid] of Object.entries(begin)) rij1[si] = pid;
    opstelling[i] = { K: keeperVan[b.k] || null, slots: rij1 };
    opstelling[j] = { K: keeperVan[b2.k] || null, slots: rij2 };
    vorige = rij2;
    i = j;
  }
  return { spelers, blokken, opstelling, slots, metKeeper, keeperBron, a, teamPct, evalLijn, P, D };
}

/* Wissels tussen twee blokken: wie komt erin, voor wie (zelfde plek waar mogelijk). */
function wisselsTussen(van, naar, slots){
  if (!van) return [];
  const uitOver = van.slots.filter(pid => pid && !naar.slots.includes(pid));
  const lijst = [];
  naar.slots.forEach((pid, j) => {
    if (!pid || van.slots.includes(pid)) return;
    const weg = uitOver.includes(van.slots[j]) ? van.slots[j] : uitOver[0];
    if (weg) uitOver.splice(uitOver.indexOf(weg), 1);
    lijst.push({ in: pid, uit: weg || null, plek: slots[j]?.naam });
  });
  return lijst;
}
const minuten = (p, r, soort) => r.blokken.reduce((s, b, i) => s + (soort.includes(p.rol[i]) ? b.dur : 0), 0);

/* ==================== UITLEG PER SPELER ==================== */
function waarom(p, r, cfg, inv, pn){
  const uit = [];
  const gespeeld = minuten(p, r, 'vk');
  const gem = r.spelers.reduce((s, x) => s + minuten(x, r, 'vk'), 0) / (r.spelers.length || 1);
  const pctT = Math.round(r.teamPct * 100), pct = Math.round(p.pct * 100);
  if (cfg.disc.includes(p.id)) uit.push(`${hoofd(pn)} 1 disciplinair op de bank. Telt niet mee in zijn speelminuten-%.`);
  if (p.vanaf > 1) uit.push(p.laatOnbekend ? `Komt later (minuut onbekend): ingedeeld vanaf ${pn} ${p.vanaf}.` : `Komt later: speelt pas vanaf ${pn} ${p.vanaf}. Die tijd telt niet mee in zijn %.`);
  const kk = [...new Set(r.blokken.filter((b, i) => p.rol[i] === 'k').map(b => b.k))];
  if (kk.length){
    const doorCoach = kk.every(k => r.keeperBron[k] === 'coach');
    const nood = kk.some(k => r.keeperBron[k] === 'nood');
    uit.push(`Keeper in ${pn} ${kk.join(', ')}${doorCoach ? ', zoals jij hebt gekozen' : nood ? ': er was geen vaste keeper beschikbaar. Kies zelf een keeper als je dat anders wilt' : p.keeperKw ? `: keepte dit seizoen ${p.keeperKw} keer` : ''}.`);
  }
  if (cfg.seizoen && r.a < 1 && p.speelb > 0){
    if (p.pct < r.teamPct - 0.06 && gespeeld > gem) uit.push(`Seizoen ${pct}% speeltijd, teamgemiddelde ${pctT}%: krijgt voorrang op extra minuten.`);
    else if (p.pct > r.teamPct + 0.08 && gespeeld < gem) uit.push(`Seizoen ${pct}%, ruim boven het gemiddelde (${pctT}%): staat deze keer vaker op de bank.`);
  }
  if (cfg.opkomst && p.opk != null && p.opk < 75) uit.push(`Trainingsopkomst ${p.opk}% (laatste 6 weken): minder voorrang bij de extra minuten, nooit onder het minimum.`);
  if (r.a > 0 && cfg.beoordeling && p.heeftBeo && p.q >= 3.8) uit.push(`Hoge beoordeling (${komma(p.q)}): krijgt een plek waar hij het meest toevoegt.`);
  if (r.a > 0 && cfg.resultaat && Math.abs(p.pm) >= 0.8) uit.push(`Plus/min ${p.pm > 0 ? '+' : ''}${komma(p.pm)} per uur op het veld (laatste 8 wedstrijden).`);
  const plekken = [...new Set(r.opstelling.map(o => { const j = o.slots.indexOf(p.id); return j > -1 ? r.slots[j].naam : null; }).filter(Boolean))];
  if (r.a > 0 && r.evalLijn && inv.evaluatie && plekken.some(n => r.slots.some(s => s.naam === n && s.lijn === r.evalLijn)) && (p.b[r.evalLijn] || 0) >= 3.4)
    uit.push(`Op deze linie gezet: in de laatste teamevaluatie scoorde "${inv.evaluatie.naam}" het laagst.`);
  const deels = [...new Set(r.blokken.filter((b, i) => b.deel && p.rol[i] === 'v' && p.rol[b.deel === 1 ? i + 1 : i - 1] !== 'v').map(b => b.k))];
  if (deels.length) uit.push(`Speelt een deel van ${pn} ${deels.join(' en ')} dankzij het extra wisselmoment.`);
  const invalPlek = r.blokken.map((b, i) => b.deel === 2 && p.rol[i] === 'v' && p.rol[i - 1] !== 'v' ? r.slots[r.opstelling[i].slots.indexOf(p.id)]?.naam : null).filter(Boolean);
  if (invalPlek.length) uit.push(`Valt in als ${[...new Set(invalPlek)].join(' en ').toLowerCase()}: Cluppie koos de wissel zo dat hij op een passende plek komt.`);
  if (plekken.length) uit.push(`Speelt als ${plekken.join(' en ').toLowerCase()}${p.pos && plekken.includes(p.pos) ? ' (zijn voorkeursplek)' : ''}.`);
  return uit;
}

/* ==================== INSTELLINGEN ==================== */
function standaardCfg(w, inv){
  const bewaard = S.team?.opstellingAdvies || {};
  const P = inv.P, D = inv.D;
  const formatie = w.kwarten?.['1']?.formatie || w.formatie;
  const momenten = momentOpties(D);
  return {
    modus: ['eerlijk', 'balans', 'resultaat'].includes(bewaard.modus) ? bewaard.modus : 'balans',
    min: Math.max(1, Math.min(P - 1, Number(bewaard.min) || Math.ceil(P / 2))),
    formatie,
    disc: Object.entries(w.startBankReden || {}).filter(([pid, r]) => r?.disciplinair && inv.spelers.some(p => p.id === pid)).map(([pid]) => pid),
    keeperModus: 'auto', keeperHelft: {}, keeperPeriode: {},
    extra: [], moment: momenten.includes(Number(bewaard.moment)) ? Number(bewaard.moment) : momenten[1],
    seizoen: bewaard.seizoen !== false, opkomst: bewaard.opkomst !== false,
    beoordeling: bewaard.beoordeling !== false, resultaat: bewaard.resultaat !== false,
  };
}
function momentOpties(D){
  const r = x => Math.round(x);
  return [...new Set([r(D / 3), D / 2, r(D * 2 / 3)])].filter(m => m > 0 && m < D);
}

/* ==================== SCHERM ==================== */
let _st = null;   // {w, inv, cfg, stap, voorstel, variant, kwart, deel, onToepassen}

export function openOpstellingAdvies(w, onToepassen){
  if (!w) return;
  if (isToernooi(w)) return meld('Bij een toernooi werkt het opstellingsvoorstel nog niet');
  if (Object.values(w.kwarten || {}).some(k => (k.events || []).length || (k.klok?.base || 0) > 0 || k.klok?.running))
    return meld('De wedstrijd is al begonnen. Een voorstel kan alleen vooraf.');
  const inv = verzamel(w);
  if (!inv.spelers.length) return meld('Zet eerst spelers in de selectie van deze wedstrijd');
  _st = { w, inv, cfg: standaardCfg(w, inv), stap: 'instellen', voorstel: null, variant: 0, kwart: 1, deel: 1, onToepassen };
  openModal(`<h2>Opstelling voorstellen</h2><div class="oa" id="oaRoot"></div>`, { vorm: 'paneel' });
  const root = document.getElementById('oaRoot');
  root.addEventListener('click', klik);
  teken();
  telGebruik('opstelling_advies_open');
}

function pn(){ return (_st.inv.P === 2 ? 'helft' : 'kwart'); }
function pLabel(k){ return (_st.inv.P === 2 ? 'H' : 'K') + k; }

function teken(){
  const root = document.getElementById('oaRoot');
  if (!root || !_st) return;
  root.innerHTML = _st.stap === 'instellen' ? htmlInstellen() : htmlVoorstel();
  const body = root.closest('.modal-body');
  if (_st._naarBoven && body){ body.scrollTop = 0; _st._naarBoven = false; }
}

function chip(p, aan, attr, uit = false, soort = ''){
  return `<button type="button" class="oa-chip ${soort}${aan ? ' aan' : ''}" ${attr} ${uit ? 'disabled' : ''}><span class="nr">${esc(p.nr)}</span>${esc(p.naam)}</button>`;
}

function htmlInstellen(){
  const { inv, cfg, w } = _st;
  const P = inv.P, n = pn();
  const later = inv.spelers.filter(p => p.vanaf > 1);
  const afw = inv.afwezig;
  const formaties = formatieNamen(w.format, S.team?.eigenFormaties || {});
  const metKeeper = bouwSlots(w.format, cfg.formatie).some(s => s.id === 'K');
  const keepersEerst = [...inv.spelers].sort((x, y) => (y.keeperKw - x.keeperKw) || ((y.pos === 'Keeper') - (x.pos === 'Keeper')) || String(x.naam).localeCompare(y.naam));
  const kanIn = (p, ks) => ks.every(k => k >= p.vanaf && !(cfg.disc.includes(p.id) && k === 1));
  const kpRij = (label, sleutel, ks, gekozen) => `<div class="oa-kp-rij"><span class="oa-kp-l">${label}</span><div class="oa-chips oa-scroll">${
    keepersEerst.map(p => chip(p, gekozen === p.id, `data-oa-kp="${sleutel}" data-pid="${esc(p.id)}"`, !kanIn(p, ks), 'kp')).join('')}</div></div>`;
  let kpHtml = '';
  if (cfg.keeperModus === 'helft') kpHtml = kpRij('1e helft', 'h1', Array.from({ length: P / 2 }, (_, i) => i + 1), cfg.keeperHelft[1]) + kpRij('2e helft', 'h2', Array.from({ length: P / 2 }, (_, i) => P / 2 + i + 1), cfg.keeperHelft[2]);
  else if (cfg.keeperModus === 'periode') kpHtml = Array.from({ length: P }, (_, i) => kpRij(`${hoofd(n)} ${i + 1}`, 'p' + (i + 1), [i + 1], cfg.keeperPeriode[i + 1])).join('');
  const keepersNamen = inv.spelers.filter(p => p.keeper).map(p => p.naam);
  const momenten = momentOpties(inv.D);
  const schakel = (id, t, s, icoon) => `<div class="oa-schakel"><span class="oa-s-ico">${ico(icoon, 18)}</span><span class="oa-s-t"><b>${t}</b><small>${s}</small></span>
    <button type="button" class="oa-toggle${cfg[id] ? ' aan' : ''}" data-oa-sch="${id}" role="switch" aria-checked="${cfg[id]}" aria-label="${t}"></button></div>`;
  const modusUitleg = {
    eerlijk: 'Iedereen zo gelijk mogelijk. Wie dit seizoen achterloopt in speeltijd krijgt voorrang. Posities volgen de voorkeursplek.',
    balans: 'Speeltijd blijft eerlijk verdeeld, maar sterke spelers staan op hun beste plek en de sterkste combinatie start en sluit af.',
    resultaat: 'Meer minuten voor de spelers die het team het meest helpen, wel altijd met het minimum dat je hieronder instelt.',
  }[cfg.modus];

  return `
  <div class="kaart oa-intro"><span class="oa-bol">${ADVIES_ICO(22)}</span>
    <p><b>Kies hoe je wilt spelen en leg vast wat vooraf al vaststaat.</b> Je krijgt een voorstel voor alle ${n === 'helft' ? 'helften' : 'kwarten'}, met per speler waarom. Daarna pas je alles nog zelf aan.</p></div>

  <div class="sectie-kop">${ico('team-members', 18)}Wie is er</div>
  <div class="kaart oa-rijen">
    <div class="oa-rij"><span>Erbij</span><b>${inv.spelers.length} spelers</b></div>
    ${afw.map(x => `<div class="oa-rij"><span>Afwezig</span><b>${esc(spelerNaam(x.id))} (${esc(x.reden)})</b></div>`).join('')}
    ${later.map(p => `<div class="oa-rij"><span>Komt later</span><b>${esc(p.naam)}, vanaf ${n} ${p.vanaf}</b></div>`).join('')}
    <div class="oa-rij"><span>Klopt dit niet? Pas eerst de selectie van de wedstrijd aan.</span></div>
  </div>

  <div class="sectie-kop">${ico('stats-bars', 18)}Speelwijze</div>
  <div class="kaart">
    <div class="segment" role="radiogroup">${[['eerlijk', 'Eerlijk'], ['balans', 'Balans'], ['resultaat', 'Resultaat']].map(([id, t]) =>
      `<button type="button" data-oa-modus="${id}" class="${cfg.modus === id ? 'actief' : ''}" role="radio" aria-checked="${cfg.modus === id}">${t}</button>`).join('')}</div>
    <p class="oa-uitleg">${modusUitleg}</p>
    <div class="oa-rij"><span>Minimaal per speler</span>
      <div class="oa-stepper"><button type="button" data-oa-min="-1" aria-label="Minder">${IC.min}</button><span>${cfg.min} ${cfg.min === 1 ? n : (n === 'helft' ? 'helften' : 'kwarten')}</span><button type="button" data-oa-min="1" aria-label="Meer">${IC.plus}</button></div></div>
    <div class="oa-rij oa-rij-blok"><span>Formatie</span>
      <div class="segment wrap">${formaties.map(f => `<button type="button" data-oa-formatie="${esc(f)}" class="${cfg.formatie === f ? 'actief' : ''}">${esc(f)}</button>`).join('')}</div></div>
  </div>

  <div class="sectie-kop">${ico('planning-calendar', 18)}Vooraf vastleggen</div>
  <div class="kaart">
    <div class="oa-label">Eerste ${n} reserve (disciplinair)</div>
    <div class="oa-chips">${inv.spelers.map(p => chip(p, cfg.disc.includes(p.id), `data-oa-disc="${esc(p.id)}"`, false, 'straf')).join('')}</div>
    <div class="oa-disc-uitleg">Deze spelers starten ${n} 1 op de bank. Die banktijd telt <b>niet</b> mee in hun speelminuten-percentage, net als een disciplinaire wissel. De reden zie je alleen als coach.</div>

    ${metKeeper ? `<div class="oa-label oa-mt">Keeper</div>
    <div class="segment">${[['auto', 'Cluppie kiest'], ...(P === 4 ? [['helft', 'Per helft']] : []), ['periode', `Per ${n}`]].map(([id, t]) =>
      `<button type="button" data-oa-kpm="${id}" class="${cfg.keeperModus === id ? 'actief' : ''}">${t}</button>`).join('')}</div>
    <div class="oa-kp">${kpHtml}</div>
    <p class="oa-hint">${cfg.keeperModus === 'auto'
      ? (keepersNamen.length ? `Cluppie kiest uit wie dit seizoen keepte (${esc(keepersNamen.join(', '))}). Bij Resultaat de beste keeper de hele wedstrijd, anders een helft ieder.` : 'Nog niemand keepte dit seizoen. Kies hierboven per helft of per ' + n + ' zelf een keeper.')
      : 'Wie dit seizoen keepte staat vooraan. Niemand gekozen? Dan kiest Cluppie. Grijs: niet beschikbaar in die periode. De keeper staat altijd de hele ' + n + '.'}</p>` : ''}

    <div class="oa-label oa-mt">Extra wisselen binnen een ${n}</div>
    <div class="oa-kw-kies" style="grid-template-columns:repeat(${P},1fr)">${Array.from({ length: P }, (_, i) => i + 1).map(k =>
      `<button type="button" data-oa-extra="${k}" class="${cfg.extra.includes(k) ? 'aan' : ''}" aria-pressed="${cfg.extra.includes(k)}"><b>${pLabel(k)}</b><small>${cfg.extra.includes(k) ? 'extra wissel' : 'alleen bij start'}</small></button>`).join('')}</div>
    ${cfg.extra.length ? `<div class="oa-rij"><span>Wisselmoment na</span>
      <div class="segment">${momenten.map(m => `<button type="button" data-oa-moment="${m}" class="${cfg.moment === m ? 'actief' : ''}">${tijd(m)}</button>`).join('')}</div></div>` : ''}
    <p class="oa-hint">${cfg.extra.length
      ? `In ${n} ${[...cfg.extra].sort().join(' en ')} wisselt Cluppie ook na ${tijd(cfg.moment)}, zodat de minuten eerlijker uitkomen. Je ziet die wissels tijdens de wedstrijd als geplande wissel.`
      : `Tik een ${n} aan om daar ook tussendoor te wisselen. Anders wisselt Cluppie alleen bij het begin van een ${n}.`}</p>
  </div>

  <div class="sectie-kop">${ico('action-filter', 18)}Meewegen</div>
  <div class="kaart oa-schakels">
    ${schakel('seizoen', 'Seizoensspeeltijd', `Wie achterloopt in speelminuten-% krijgt voorrang (${inv.nWedstrijden} wedstrijden)`, 'training-duration')}
    ${schakel('opkomst', 'Trainingsopkomst', 'Laatste 6 weken. Lage opkomst geeft minder voorrang, nooit onder het minimum', 'attendance-present')}
    ${schakel('beoordeling', 'Beoordelingen', 'Laatste beoordelingen die jij mag zien, voor de beste plek op het veld', 'team-player')}
    ${schakel('resultaat', 'Resultaat en evaluatie', 'Plus/min per speler en het zwakste punt uit de laatste teamevaluatie', 'match-score')}
  </div>

  <div class="oa-voet"><button type="button" class="knop fluo vol" data-oa-maak>${ADVIES_ICO(18)}Maak voorstel</button></div>`;
}

function veldHtml(r, i, k){
  const o = r.opstelling[i];
  const vorige = i > 0 ? r.opstelling[i - 1].slots : null;
  const alle = bouwSlots(_st.w.format, _st.cfg.formatie);
  let h = `<div class="lijn midden"></div><div class="lijn cirkel"></div><div class="lijn zestien-b"></div><div class="lijn zestien-o"></div><div class="lijn vijf-b"></div><div class="lijn vijf-o"></div>`;
  for (const s of alle){
    const pid = s.id === 'K' ? o.K : o.slots[r.slots.findIndex(x => x.id === s.id)];
    const nieuw = pid && s.id !== 'K' && vorige && !vorige.includes(pid);
    h += `<div class="slot" style="left:${s.x}%;top:${s.y}%">${pid
      ? `<div class="chip${s.id === 'K' ? ' keeper' : ''}${nieuw ? ' oa-nieuw' : ''}"><div class="shirt">${esc(spelerNr(pid) ?? '')}</div><div class="naam">${esc(spelerNaam(pid))}</div></div>`
      : `<div class="ring">${s.lijn}</div>`}</div>`;
  }
  return h;
}

function htmlVoorstel(){
  const { inv, cfg } = _st;
  const r = _st.voorstel;
  const n = pn();
  const P = inv.P;
  const bi = (k, deel) => r.blokken.findIndex(b => b.k === k && (b.deel === 0 || b.deel === deel));
  const pctNa = p => p.speelb + inv.P * inv.D - minuten(p, r, 'sx') > 0
    ? (p.gesp + minuten(p, r, 'vk')) / (p.speelb + inv.P * inv.D - minuten(p, r, 'sx')) : null;
  const mins = r.spelers.map(p => minuten(p, r, 'vk'));
  const metSeizoen = r.spelers.filter(p => p.speelb > 0);
  const spr = arr => arr.length ? `${Math.round(Math.min(...arr) * 100)}–${Math.round(Math.max(...arr) * 100)}%` : '–';
  const i = bi(_st.kwart, _st.deel);
  const extraHier = cfg.extra.includes(_st.kwart);
  const tabSub = k => {
    const iS = bi(k, 1);
    const nS = iS > 0 ? wisselsTussen(r.opstelling[iS - 1], r.opstelling[iS], r.slots).length : null;
    const nE = cfg.extra.includes(k) ? wisselsTussen(r.opstelling[iS], r.opstelling[iS + 1], r.slots).length : null;
    const start = nS == null ? 'start' : `${nS} wissel${nS === 1 ? '' : 's'}`;
    return nE != null ? `${start}, +${nE}` : start;
  };
  const bank = r.spelers.filter(p => p.rol[i] !== 'v' && p.rol[i] !== 'k').map(p => {
    const soort = p.rol[i] === 's' ? 'straf' : p.rol[i] === 'x' ? 'later' : '';
    return `<span class="oa-bank-chip ${soort}"><span class="nr">${esc(p.nr)}</span>${esc(p.naam)} <small>${soort === 'straf' ? 'disciplinair' : soort === 'later' ? 'nog niet' : 'bank'}</small></span>`;
  }).join('');
  let plan = '';
  if (extraHier){
    const i1 = bi(_st.kwart, 1);
    const ws = wisselsTussen(r.opstelling[i1], r.opstelling[i1 + 1], r.slots);
    plan = `<div class="oa-plan"><div class="oa-plan-kop">${IC.klok} Geplande wissel${ws.length === 1 ? '' : 's'} na ${tijd(cfg.moment)} in ${n} ${_st.kwart}</div>${ws.length
      ? ws.map(x => `<div class="oa-plan-rij">${IC.wissel}<span class="in">${esc(spelerNaam(x.in))}</span><span class="u-zacht">erin voor</span><span>${esc(spelerNaam(x.uit))}</span></div>`).join('')
      : `<div class="oa-plan-rij u-zacht">Niemand hoeft te wisselen: de minuten kloppen al.</div>`}</div>`;
  }
  const dots = p => Array.from({ length: P }, (_, j) => j + 1).map(k => `<span class="oa-kw">${r.blokken.map((b, j) => b.k === k ? `<i class="${p.rol[j]}${b.deel ? ' h' : ''}"></i>` : '').join('')}</span>`).join('');
  const lijst = [...r.spelers].sort((x, y) => minuten(y, r, 'vk') - minuten(x, r, 'vk') || String(x.naam).localeCompare(y.naam));
  const totaal = inv.P * inv.D;
  const spelersHtml = lijst.map(p => {
    const v = p.speelb > 0 ? Math.round(p.pct * 100) : null, na = pctNa(p), nw = na != null ? Math.round(na * 100) : null;
    return `<div class="oa-st"><button type="button" class="oa-st-kop" data-oa-open>
      <span class="nr">${esc(p.nr)}</span>
      <span class="nm">${esc(p.naam)}<small>${komma(minuten(p, r, 'vk'))} van ${totaal} min</small></span>
      <span class="oa-dots">${dots(p)}</span>
      <span class="oa-pct">${v != null ? `${v}% ${IC.pijl} <b class="${nw > v ? 'op' : nw < v ? 'neer' : ''}">${nw}%</b>` : '<span class="u-zacht">nieuw</span>'}</span></button>
      <ul class="oa-waarom">${waarom(p, r, cfg, inv, n).map(t => `<li>${esc(t)}</li>`).join('')}</ul></div>`;
  }).join('');
  const u = inv.uitslagen.map(x => `${x.r} ${x.s}`).join(', ');
  const nBeo = inv.spelers.filter(p => p.heeftBeo).length;
  const bron = (icoon, t, s, aan = true) => `<div class="oa-bron${aan ? '' : ' uit'}">${ico(icoon, 16)}<div><b>${t}</b><span>${aan ? s : 'Uitgezet voor dit voorstel'}</span></div></div>`;
  const modusNaam = { eerlijk: 'Eerlijke speeltijd', balans: 'Balans', resultaat: 'Resultaat' }[cfg.modus];

  return `
  <div class="kaart">
    <div class="oa-samen-kop"><span class="oa-pil">${ADVIES_ICO(14)}${modusNaam}</span><button type="button" class="oa-link" data-oa-terug>Instellingen</button></div>
    <div class="oa-samen">
      <div><b>${komma(Math.min(...mins))}–${komma(Math.max(...mins))}</b><small>minuten per speler</small></div>
      <div><b>${spr(metSeizoen.map(p => p.pct))}</b><small>seizoen nu</small></div>
      <div><b>${spr(metSeizoen.map(pctNa).filter(x => x != null))}</b><small>na deze wedstrijd</small></div>
    </div>
  </div>
  <div class="oa-tabs" style="grid-template-columns:repeat(${P},1fr)">${Array.from({ length: P }, (_, j) => j + 1).map(k =>
    `<button type="button" data-oa-kwart="${k}" class="${k === _st.kwart ? 'actief' : ''}">${pLabel(k)}<small>${tabSub(k)}</small></button>`).join('')}</div>
  ${extraHier ? `<div class="segment oa-moment"><button type="button" data-oa-deel="1" class="${_st.deel === 1 ? 'actief' : ''}">Begin ${n}</button><button type="button" data-oa-deel="2" class="${_st.deel === 2 ? 'actief' : ''}">Na ${tijd(cfg.moment)}</button></div>` : ''}
  <div class="veld-wrap oa-veld"><div class="veld">${veldHtml(r, i)}</div></div>
  <div class="oa-legenda"><span><i class="nieuw"></i>Nieuw erin</span><span><i class="keeper"></i>Keeper</span></div>
  <div class="oa-bank">${bank}</div>
  ${plan}

  <div class="sectie-kop">${ico('training-duration', 18)}Speeltijd per speler</div>
  <div class="kaart oa-spelers">
    <div class="oa-legenda oa-legenda-blok"><span><i class="v"></i>Veld</span><span><i class="k"></i>Keeper</span><span><i class="b"></i>Bank</span><span><i class="s"></i>Disciplinair</span><span><i class="x"></i>Nog niet</span>${cfg.extra.length ? '<span><i class="v h"></i>Deel van een ' + n + '</span>' : ''}</div>
    ${spelersHtml}
    <p class="oa-hint">Tik op een speler voor het waarom. Rechts: speelminuten-% dit seizoen en na deze wedstrijd.</p>
  </div>

  <div class="sectie-kop">${ico('admin-document', 18)}Waar het voorstel op leunt</div>
  <div class="kaart oa-bronnen">
    ${bron('team-members', 'Beschikbaarheid', `${inv.spelers.length} spelers erbij${inv.afwezig.length ? `, ${inv.afwezig.length} afwezig` : ''}${cfg.disc.length ? `, ${cfg.disc.length} disciplinair in ${n} 1` : ''}`)}
    ${bron('training-duration', 'Seizoensspeeltijd', inv.nWedstrijden ? `${inv.nWedstrijden} wedstrijden, teamgemiddelde ${Math.round(r.teamPct * 100)}%` : 'Nog geen gespeelde wedstrijden dit seizoen', cfg.seizoen)}
    ${bron('attendance-present', 'Trainingsopkomst', inv.nSessies ? `${inv.nSessies} trainingen in de laatste 6 weken` : 'Geen presentie in de laatste 6 weken', cfg.opkomst)}
    ${bron('team-player', 'Beoordelingen', nBeo ? `Recente beoordeling van ${nBeo} van de ${inv.spelers.length} spelers` : 'Nog geen recente beoordelingen: positie volgt de speelhistorie', cfg.beoordeling)}
    ${bron('match-score', 'Resultaat en evaluatie', `${u ? `Laatste ${inv.uitslagen.length}: ${u}.` : 'Nog geen uitslagen.'} ${inv.evaluatie ? `Laagste in de laatste teamevaluatie: ${inv.evaluatie.naam} (${komma(inv.evaluatie.score)})${r.evalLijn && r.a > 0 ? ', die linie krijgt extra gewicht' : ''}.` : 'Nog geen teamevaluatie.'}`, cfg.resultaat)}
  </div>
  <p class="oa-avg">${IC.schild}<span>Het voorstel wordt op je eigen toestel berekend. Er gaan geen spelersgegevens naar een AI-dienst of buiten Cluppie.</span></p>

  <div class="oa-voet oa-voet-2">
    <button type="button" class="knop licht" data-oa-variant>${IC.variant}Variant</button>
    <button type="button" class="knop fluo" data-oa-toepassen>Zet in wedstrijd</button>
  </div>`;
}

/* ==================== INTERACTIE ==================== */
function bewaarVoorkeur(){
  const { cfg } = _st;
  const v = { modus: cfg.modus, min: cfg.min, moment: cfg.moment, seizoen: cfg.seizoen, opkomst: cfg.opkomst, beoordeling: cfg.beoordeling, resultaat: cfg.resultaat };
  if (S.team) S.team.opstellingAdvies = v;
  if (S.teamId) updateDoc(doc(db, 'teams', S.teamId), { opstellingAdvies: v }).catch(e => console.warn('[Cluppie] advies-voorkeur opslaan mislukt', e));
}

function klik(ev){
  const t = ev.target.closest('button');
  if (!t || !_st) return;
  const { cfg, inv } = _st;
  const d = t.dataset;
  if (d.oaModus){ cfg.modus = d.oaModus; return teken(); }
  if (d.oaMin){ cfg.min = Math.max(1, Math.min(inv.P, cfg.min + Number(d.oaMin))); return teken(); }
  if (d.oaFormatie){ cfg.formatie = d.oaFormatie; return teken(); }
  if (d.oaDisc){
    const id = d.oaDisc;
    cfg.disc = cfg.disc.includes(id) ? cfg.disc.filter(x => x !== id) : [...cfg.disc, id];
    return teken();
  }
  if (d.oaKpm){ cfg.keeperModus = d.oaKpm; return teken(); }
  if (d.oaKp){
    const s = d.oaKp, id = d.pid;
    const doel = s[0] === 'h' ? cfg.keeperHelft : cfg.keeperPeriode;
    const nr = Number(s.slice(1));
    doel[nr] = doel[nr] === id ? null : id;
    return teken();
  }
  if (d.oaExtra){
    const k = Number(d.oaExtra);
    cfg.extra = cfg.extra.includes(k) ? cfg.extra.filter(x => x !== k) : [...cfg.extra, k].sort();
    return teken();
  }
  if (d.oaMoment){ cfg.moment = Number(d.oaMoment); return teken(); }
  if (d.oaSch){ cfg[d.oaSch] = !cfg[d.oaSch]; return teken(); }
  if ('oaMaak' in d){
    _st.variant = 0;
    _st.voorstel = maakVoorstel(inv, cfg, _st.w, 0);
    _st.stap = 'voorstel'; _st.kwart = 1; _st.deel = 1; _st._naarBoven = true;
    bewaarVoorkeur();
    telGebruik('opstelling_advies_voorstel');
    return teken();
  }
  if ('oaTerug' in d){ _st.stap = 'instellen'; _st._naarBoven = true; return teken(); }
  if (d.oaKwart){ _st.kwart = Number(d.oaKwart); _st.deel = 1; return teken(); }
  if (d.oaDeel){ _st.deel = Number(d.oaDeel); return teken(); }
  if ('oaOpen' in d){ t.parentElement.classList.toggle('open'); return; }
  if ('oaVariant' in d){
    _st.variant++;
    _st.voorstel = maakVoorstel(inv, cfg, _st.w, _st.variant);
    meld('Andere variant: zelfde regels, andere verdeling van de wissels');
    return teken();
  }
  if ('oaToepassen' in d) return toepassen();
}

function toepassen(){
  const { cfg, inv } = _st;
  /* Altijd op de actuele wedstrijd schrijven: kwam er tijdens het kiezen een
     nieuwe snapshot binnen, dan is S.wedstrijd een ander object dan bij openen. */
  const w = S.wedstrijd || _st.w;
  const r = _st.voorstel;
  if (!r) return;
  const heeftOpstelling = Object.values(w.kwarten || {}).some(k => Object.keys(k.lineup || {}).length);
  if (heeftOpstelling && !confirm('De huidige opstellingen van alle periodes worden vervangen. Doorgaan?')) return;
  for (let k = 1; k <= inv.P; k++){
    const kk = (w.kwarten ||= {})[k] ||= { lineup: {}, events: [], plan: [], correcties: {}, klok: { base: 0, running: false, start: 0 } };
    const i1 = r.blokken.findIndex(b => b.k === k);
    const o = r.opstelling[i1];
    const lineup = {};
    if (o.K) lineup.K = o.K;
    o.slots.forEach((pid, j) => { if (pid) lineup[r.slots[j].id] = pid; });
    kk.lineup = lineup;
    kk.formatie = cfg.formatie;
    kk.plan = [];
    if (cfg.extra.includes(k)){
      for (const x of wisselsTussen(o, r.opstelling[i1 + 1], r.slots))
        if (x.uit) kk.plan.push({ in: x.in, uit: x.uit, min: cfg.moment });
    }
  }
  w.formatie = cfg.formatie;
  /* disciplinair: bestaande vlaggen van spelers die nu niet meer gekozen zijn weg */
  const sbr = { ...(w.startBankReden || {}) };
  for (const [pid, rec] of Object.entries(sbr)) if (rec?.disciplinair && !cfg.disc.includes(pid)) delete sbr[pid];
  for (const pid of cfg.disc) sbr[pid] = { ...(sbr[pid] || {}), reden: 'gedrag', disciplinair: true, ...(sbr[pid]?.disciplinair ? {} : { bron: 'advies' }) };
  w.startBankReden = sbr;
  w.advies = { modus: cfg.modus, versie: VERSIE, gemaaktMs: Date.now() };
  telGebruik('opstelling_advies_toegepast');
  const disc = cfg.disc.map(pid => spelerNaam(pid));
  const extra = [...cfg.extra].sort();
  const n = pn();
  sluitModal();
  _st.onToepassen?.();
  meld(`Opstelling in alle ${inv.P} ${n === 'helft' ? 'helften' : 'kwarten'} gezet.${extra.length ? ` Geplande wissels na ${tijd(cfg.moment)} in ${n} ${extra.join(' en ')}.` : ''}${disc.length ? ` ${disc.join(' en ')} start${disc.length > 1 ? 'en' : ''} disciplinair op de bank.` : ''}`);
  _st = null;
}

/* Alleen voor tests: rekenmodel los aanroepen. */
export const _intern = { verzamel, maakVoorstel, wisselsTussen, minuten, standaardCfg, hongaars };
