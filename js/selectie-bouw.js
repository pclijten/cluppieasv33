/* ==================== SELECTIE-BOUW (1e + 2e als twee teams) ====================
   [20260928f] Voor een eigen bouw die een seniorenselectie is (bv. bouw
   "Selectie" met ASV33-1 en ASV33-2). Op het bouw-dashboard:
     - onder elke teamtegel een radar: laatste evaluatie + seizoensgemiddelde
     - een tegel "Selectie maken" → scherm met alle spelers van beide teams
       (plus wie is ingeleend van buiten de bouw), per speler 1e / 2e / beide,
       met cijfers, positie en score (kaartcijfer + trendpijl).

   Wanneer is een bouw een selectie?
     clubs/{id}.eigenBouwen[].selectie === true, of (nog niet ingesteld) de
     naam bevat "selectie". Instelbaar in Club → Instellingen → Eigen bouwen.
     Het eerste team (op naam) is het 1e, de rest het 2e.

   [20260928g] De keuze wordt echt uitgevoerd (op verzoek van Paul):
     1e / 2e → het spelerdocument verhuist naar het 1e / 2e team, met
               DEZELFDE id (zoals definitiefOverzetten), zodat opstellingen,
               goals en beoordelingen aan de speler gekoppeld blijven.
               Een uitlening binnen de bouw vervalt.
     Beide   → de speler blijft in zijn team en krijgt een uitlening naar het
               andere team (bestaand spiegelmodel): hij staat in beide selecties.
   Alles in één writeBatch per speler: lukt één stap niet (rechten), dan
   gebeurt er niets. teams/{id}/spelers/{pid}.elftal bewaart de keuze; wijkt
   die af van waar de speler echt staat (keuzes van vóór deze versie), dan
   toont het scherm "Keuzes doorvoeren".
   Cijfers, beoordelingen en opkomst tellen over alle teams in de bouw, zodat
   een verhuisde speler zijn historie houdt. Geen extra reads, behalve één
   getDoc per verhuizing (vers spelerdocument). */
import { S, esc, meld } from './state.js?v=20260922c';
import { db, doc, collection, getDoc, writeBatch, serverTimestamp } from './firebase.js?v=20260922c';
import { bouwLeenSnapshot } from './teams-spelers.js?v=20261005a';
import { SKILLS, POSITIE_GROEPEN, TEAM_CATEGORIEEN } from './config.js?v=20260922c';
import { analyseWedstrijd, speeltijdReserve } from './analyse.js?v=20260928a';
import { opkomstVoor } from './opkomst.js?v=20260922c';

/* ---------- basis ---------- */
export function isSelectieBouw(ctx){
  const eb = ctx?.eigenBouw;
  if (!eb || (ctx.teams || []).length < 2) return false;
  return eb.selectie === true || (eb.selectie == null && /selectie/i.test(eb.naam || ''));
}
const elftalVanTeam = (ctx, teamId) => ctx.teams.findIndex(t => t.id === teamId) === 0 ? '1' : '2';
const binnenBouw = (ctx, u) => ctx.teams.some(t => t.id === u.vanTeam) && ctx.teams.some(t => t.id === u.naarTeam);
const internLeen = (ctx, pid) => (ctx.uitleningen || []).filter(u => u.spelerId === pid && binnenBouw(ctx, u));
/* Waar staat de speler nu echt? Uitlening binnen de bouw = beide; anders het elftal van zijn team. */
const werkelijk = (ctx, teamId, pid) => internLeen(ctx, pid).length ? 'b' : elftalVanTeam(ctx, teamId);
const geldig = e => e === '1' || e === '2' || e === 'b';
const cijfer = n => Math.round(40 + (n - 1) * 14);
const gem = a => a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0;
function analyse(w){ try { return analyseWedstrijd(w); } catch(e){ return null; } }
const isVolledig = b => (b.soort === 'volledig' || (b.soort == null && b.scores)) && b.scores;
const nieuwstEerst = (a, b) => (b.datum || '').localeCompare(a.datum || '') || (b.gemaaktMs || 0) - (a.gemaaktMs || 0);
const LIJN = Object.fromEntries(POSITIE_GROEPEN.flatMap(g => g.posities.map(p => [p, g.lijn])));
const LIJN_KLEUR = { K:'var(--keeper)', V:'#5b8def', M:'var(--ok)', A:'var(--accent)' };

/* ---------- filterstaat (runtime, per sessie) ---------- */
const f = { e:'alle', l:'alle', q:'', s:'score', r:-1 };

/* ---------- cijfers over de wedstrijden van alle teams in de bouw ----------
   Zelfde regels als spelerStats (teams-spelers.js): een wedstrijd telt als
   de speler speeltijd had; goals/assists uit de goal-events; speeltijd en
   reserve als % van de speelbare tijd (speeltijdReserve). */
const statsCache = new WeakMap();
function statsVan(ctx){
  if (statsCache.has(ctx)) return statsCache.get(ctx);
  const per = {};
  const r = pid => (per[pid] ||= { w:0, g:0, a:0, pos:{} });
  const alle = [];
  for (const t of ctx.teams){
    for (const w of (ctx.data.get(t.id)?.wedstrijden || [])){
      for (const g of (w.goals || [])){
        if (g.type !== 'voor') continue;
        if (g.pid) r(g.pid).g++;
        if (g.assist) r(g.assist).a++;
      }
      const a = analyse(w);
      if (!a?.kwarten) continue;
      alle.push(w);
      for (const [pid, s] of Object.entries(a.tijd || {})) if (s > 0) r(pid).w++;
      for (const [pid, lijn] of Object.entries(a.lijn || {}))
        for (const [naam, n] of Object.entries(lijn || {})) r(pid).pos[naam] = (r(pid).pos[naam] || 0) + n;
    }
  }
  let sr = {};
  try { sr = speeltijdReserve(alle); } catch(e){ console.warn('[Cluppie] selectie: speeltijd niet berekend', e); }
  /* beoordelingen en trainingen van alle teams samen: een verhuisde speler houdt zo zijn score en opkomst.
     Opkomst telt per sessie alleen wie in de selectie van die training stond (opkomst.teltMee). */
  const beoordelingen = ctx.teams.flatMap(t => ctx.data.get(t.id)?.beoordelingen || []);
  const presentie = ctx.teams.flatMap(t => ctx.data.get(t.id)?.presentie || []);
  const uit = { per, sr, beoordelingen, presentie };
  statsCache.set(ctx, uit);
  return uit;
}

/* Score = kaartcijfer (40–96) uit de laatste volledige beoordeling, anders
   de laatste snelle. Trend = verschil met de meting daarvoor (zelfde soort). */
function scoreVan(pid, beoordelingen){
  const eigen = (beoordelingen || []).filter(b => b.spelerId === pid);
  const vol = eigen.filter(isVolledig).map(b => {
    const w = SKILLS.map(d => Number(b.scores?.[d.id])).filter(Boolean);
    return { b, v: w.length ? gem(w) : null };
  }).filter(x => x.v != null);
  const snel = eigen.filter(b => b.soort === 'snel' && Number(b.niveau) >= 1).map(b => ({ b, v:Number(b.niveau) }));
  const reeks = (vol.length ? vol : snel).sort((x, y) => nieuwstEerst(x.b, y.b));
  if (!reeks.length) return null;
  const nu = cijfer(reeks[0].v);
  const vorig = reeks[1] ? cijfer(reeks[1].v) : null;
  return { score:nu, delta: vorig == null ? null : nu - vorig, snel: !vol.length };
}

/* ---------- rijen ---------- */
export function selectieRijen(ctx){
  { const [a, b] = ctx.teams; anderTeam = a && b ? { [a.id]: b.naam, [b.id]: a.naam } : {}; }
  const { per, sr, beoordelingen, presentie } = statsVan(ctx);
  const ids = new Set(ctx.teams.map(t => t.id));
  const stat = pid => {
    const x = per[pid] || { w:0, g:0, a:0, pos:{} };
    const s = sr[pid];
    const pct = s?.speelbaar > 0 ? Math.min(100, Math.round(s.speeltijd / s.speelbaar * 100)) : null;
    return { w:x.w, g:x.g, a:x.a, pos:x.pos, pct, res: pct == null ? null : 100 - pct };
  };
  const meest = pos => Object.entries(pos || {}).sort((a, b) => b[1] - a[1])[0]?.[0] || null;
  const rijen = [];
  for (const t of ctx.teams){
    const d = ctx.data.get(t.id) || {};
    for (const p of (d.spelers || [])){
      const st = stat(p.id);
      const el = werkelijk(ctx, t.id, p.id);
      const wens = geldig(p.elftal) ? p.elftal : el;
      rijen.push({ sleutel: p.id, pid:p.id, naam:p.naam || 'Speler', nummer:p.nummer ?? null, teamId:t.id, teamNaam:t.naam || '',
        positie: p.positie || meest(st.pos), el, wens, open: wens !== el, ...st,
        opk: (() => { try { return opkomstVoor(p, presentie).pct; } catch(e){ return null; } })(),
        sc: scoreVan(p.id, beoordelingen), bron:p });
    }
  }
  /* ingeleend van buiten de bouw (bv. een jeugdspeler); binnen de bouw staat hij al bij zijn eigen team */
  for (const u of (ctx.uitleningen || [])){
    if (!ids.has(u.naarTeam) || ids.has(u.vanTeam)) continue;
    const s = u.snapshot || {};
    const pid = u.adopteertGast || u.spelerId;
    const st = stat(pid);
    rijen.push({ sleutel: 'leen:' + u.id, pid, naam:s.naam || 'Speler', nummer:u.overlay?.nummer ?? s.nummer ?? null,
      teamId:u.naarTeam, teamNaam: ctx.teams.find(t => t.id === u.naarTeam)?.naam || u.naarTeamNaam || '', leen:u, uit:u.vanTeamNaam || 'ander team',
      positie: u.overlay?.positie ?? s.positie ?? meest(st.pos), el: elftalVanTeam(ctx, u.naarTeam), wens:null, open:false, ...st,
      opk: (() => { try { return opkomstVoor({ id:pid, meetelVanaf:u.overlay?.meetelVanaf ?? null }, presentie).pct; } catch(e){ return null; } })(),
      sc:null });
  }
  return rijen;
}
function tellen(rijen){
  const t = { '1':0, '2':0, b:0 };
  rijen.forEach(r => t[r.el]++);
  return { e1: t['1'] + t.b, e2: t['2'] + t.b, b: t.b };
}
function gefilterd(rijen){
  const q = f.q.trim().toLowerCase();
  const posIdx = r => { const i = POSITIE_GROEPEN.flatMap(g => g.posities).indexOf(r.positie); return i < 0 ? 99 : i; };
  const waarde = (r, k) => ({ nr: Number(r.nummer) || 999, naam: r.naam.toLowerCase(), pos: posIdx(r), w: r.w, pct: r.pct ?? -1,
    g: r.g, a: r.a, opk: r.opk ?? -1, score: r.sc?.score ?? -1 })[k];
  return rijen.filter(r => (f.e === 'alle' || (f.e === 'b' ? r.el === 'b' : r.el === f.e || r.el === 'b'))
      && (f.l === 'alle' || LIJN[r.positie] === f.l)
      && (!q || r.naam.toLowerCase().includes(q)))
    .sort((a, b) => { const x = waarde(a, f.s), y = waarde(b, f.s);
      return (typeof x === 'string' ? x.localeCompare(y, 'nl') : x - y) * f.r || a.naam.localeCompare(b.naam, 'nl'); });
}

/* ---------- kleine HTML-bouwstenen ---------- */
const PIJL = {
  op:'<svg viewBox="0 0 12 12" aria-hidden="true"><path d="M6 2l4 6H2z" fill="currentColor"/></svg>',
  af:'<svg viewBox="0 0 12 12" aria-hidden="true"><path d="M6 10l4-6H2z" fill="currentColor"/></svg>',
  gl:'<svg viewBox="0 0 12 12" aria-hidden="true"><rect x="2" y="5" width="8" height="2" rx="1" fill="currentColor"/></svg>',
};
export function trendHtml(d){
  if (d == null) return '<span class="sbw-tr gl" title="Nog geen eerdere meting">–</span>';
  if (d >= 2) return `<span class="sbw-tr op" title="Gestegen">${PIJL.op}+${d}</span>`;
  if (d <= -2) return `<span class="sbw-tr af" title="Gedaald">${PIJL.af}${d}</span>`;
  return `<span class="sbw-tr gl" title="Gelijk gebleven">${PIJL.gl}${d > 0 ? '+' + d : d}</span>`;
}
function scoreHtml(sc){
  if (!sc) return '<span class="sbw-nul">nog geen</span>';
  return `<span class="sbw-score"><b>${sc.score}</b>${sc.snel ? '<small>snel</small>' : ''}${trendHtml(sc.delta)}</span>`;
}
function posHtml(pos){
  if (!pos) return '<span class="sbw-nul">–</span>';
  const l = LIJN[pos];
  return `<span class="sbw-pos">${l ? `<i style="background:${LIJN_KLEUR[l]}">${l}</i>` : ''}${esc(pos)}</span>`;
}
function elPill(e){ return e === 'b' ? '<span class="elf-pill sbw-eb">1+2</span>' : `<span class="elf-pill e${e}">${e}e</span>`; }
function keuzeHtml(r){
  if (r.leen) return '<span class="sbw-viauit" title="Aanpassen via Uitleningen">via uitlening</span>';
  return `<div class="sbw-seg" role="group" aria-label="Elftal van ${esc(r.naam)}">${[['1', '1e'], ['2', '2e'], ['b', 'Beide']].map(([v, l]) =>
    `<button type="button" data-sel="el" data-k="${esc(r.sleutel)}" data-e="${v}" class="${r.el === v ? 'aan e' + v : ''}" aria-pressed="${r.el === v}">${l}</button>`).join('')}</div>`;
}
function teamRegel(r){
  if (r.leen) return `<small class="sbw-team leen">ingeleend van ${esc(r.uit)} · ${esc(r.teamNaam)}</small>`;
  const ook = r.el === 'b' ? ' + ' + esc(anderTeam[r.teamId] || 'ander team') : '';
  return `<small class="sbw-team ${r.open ? 'open' : ''}">${esc(r.teamNaam)}${ook}${r.open ? ` · gekozen: ${r.wens === 'b' ? 'beide' : r.wens + 'e'}` : ''}</small>`;
}
let anderTeam = {};   // teamId → naam van het ándere team (voor "ASV33-1 + ASV33-2"), gezet in selectieRijen
function openHtml(rijen){
  const n = rijen.filter(r => r.open).length;
  return n ? `<div class="sbw-melding"><span><b>${n} speler${n === 1 ? '' : 's'}</b> ${n === 1 ? 'staat' : 'staan'} nog niet in het team dat je koos.</span>
    <button type="button" class="sbw-doorvoer" data-sel="doorvoeren">Keuzes doorvoeren</button></div>` : '';
}
function sbHtml(r){
  return `<div class="sbw-sb"><i>${r.pct != null ? `<b class="g" style="width:${r.pct}%"></b><b class="y" style="width:${r.res}%"></b>` : ''}</i>
    <em>${r.pct != null ? `<b>${r.pct}%</b> · ${r.res}%` : 'nog niet'}</em></div>`;
}
function telHtml(rijen){
  const t = tellen(rijen);
  return `<span class="elf-pill e1">1e</span><b>${t.e1}</b><span class="elf-pill e2">2e</span><b>${t.e2}</b><span class="elf-pill sbw-eb">beide</span><b>${t.b}</b>`;
}
function filterHtml(){
  const seg = (soort, lijst) => `<div class="sbw-seg sbw-filter">${lijst.map(([v, l]) =>
    `<button type="button" data-sel="${soort}" data-v="${v}" class="${f[soort] === v ? 'aan f' : ''}" aria-pressed="${f[soort] === v}">${l}</button>`).join('')}</div>`;
  return `${seg('e', [['alle', 'Alle'], ['1', '1e'], ['2', '2e'], ['b', 'Beide']])}
    ${seg('l', [['alle', 'Alle posities'], ...POSITIE_GROEPEN.map(g => [g.lijn, g.lijn])])}
    <input class="sbw-zoek" id="sbwZoek" type="search" placeholder="Zoek speler…" aria-label="Zoek speler" value="${esc(f.q)}" autocomplete="off">`;
}

/* ---------- radar per team ----------
   Laatste = per speler zijn meest recente volledige evaluatie, gemiddeld
   over het team. Gemiddelde = alle volledige evaluaties van dit seizoen. */
export function teamRadar(ctx, team){
  const d = ctx.data.get(team.id) || {};
  /* spelers die nu in dit team staan, met hun beoordelingen uit alle teams van de bouw */
  const ids = new Set((d.spelers || []).map(p => p.id));
  const vol = statsVan(ctx).beoordelingen.filter(b => ids.has(b.spelerId)).filter(isVolledig).sort((a, b) => nieuwstEerst(b, a));
  if (!vol.length) return null;
  const perSpeler = {};
  vol.forEach(b => { perSpeler[b.spelerId] = b; });
  const laatsten = Object.values(perSpeler);
  const dom = lijst => SKILLS.map(s => { const v = lijst.map(b => Number(b.scores?.[s.id])).filter(Boolean); return v.length ? gem(v) : null; });
  return { laatste: dom(laatsten), gem: dom(vol), aantal: laatsten.length, spelers: (d.spelers || []).length, datum: vol[vol.length - 1].datum || '' };
}
/* ---------- [20260928h] radar van de wedstrijdevaluaties (teamevaluaties) ----------
   Los van de spelersbeoordelingen hierboven: de 8 categorieën die de coach
   na elke wedstrijd invult (Evaluatie wedstrijden). Laatste = de meest
   recente geëvalueerde wedstrijd, gemiddelde = alle wedstrijden dit seizoen.
   De data zit al in de hub-context (teamevaluaties) — geen extra reads. */
const TEAM_KORT = { inzet:'Inzet', samenwerking:'Samenwerking', taken:'Taken', opbouw:'Opbouw', omschakeling:'Omschakelen', druk:'Druk zetten', plezier:'Plezier', coachbaar:'Coachbaar' };
export function wedRadar(ctx, team){
  const d = ctx.data.get(team.id) || {};
  const ev = (d.teamevaluaties || []).filter(e => e.scores);
  if (!ev.length) return null;
  const wed = new Map((d.wedstrijden || []).map(w => [w.id, w]));
  const datum = e => e.datum || wed.get(e.wedstrijdId)?.datum || '';
  const lijst = [...ev].sort((a, b) => datum(a).localeCompare(datum(b)));
  const laatsteE = lijst[lijst.length - 1];
  const dom = l => TEAM_CATEGORIEEN.map(c => { const v = l.map(e => Number(e.scores?.[c.id])).filter(Boolean); return v.length ? gem(v) : null; });
  return { laatste: dom([laatsteE]), gem: dom(lijst), aantal: lijst.length, tegen: wed.get(laatsteE.wedstrijdId)?.tegenstander || '', datum: datum(laatsteE) };
}
/* Radar-SVG voor n assen. maat: 5 domeinen (korte codes) of 8 categorieën (woorden). */
function radarSvg(laatste, gemid, assen, breed = false){
  const W = breed ? 320 : 220, H = breed ? 260 : 220, cx = W / 2, cy = breed ? 130 : 112, R = breed ? 86 : 74, n = assen.length;
  const pt = (i, v) => { const a = -Math.PI / 2 + i * 2 * Math.PI / n; return [cx + R * (v || 0) / 5 * Math.cos(a), cy + R * (v || 0) / 5 * Math.sin(a)]; };
  const poly = vals => vals.map((v, i) => pt(i, v).map(x => x.toFixed(1)).join(',')).join(' ');
  let s = `<svg viewBox="0 0 ${W} ${H}" class="sbw-radarsvg${breed ? ' breed' : ''}" role="img" aria-label="Radar: laatste evaluatie en seizoensgemiddelde">`;
  for (let v = 1; v <= 5; v++) s += `<polygon points="${poly(Array(n).fill(v))}" style="fill:none;stroke:var(--line-d)"/>`;
  assen.forEach((d, i) => {
    const [x, y] = pt(i, 5), [lx, ly] = pt(i, breed ? 6.1 : 6.3);
    const anker = breed && Math.abs(lx - cx) > 8 ? (lx > cx ? 'start' : 'end') : 'middle';
    s += `<line x1="${cx}" y1="${cy}" x2="${x.toFixed(1)}" y2="${y.toFixed(1)}" style="stroke:var(--line-d)"/>`;
    s += `<text x="${lx.toFixed(1)}" y="${ly.toFixed(1)}" text-anchor="${anker}" dominant-baseline="middle" style="fill:${d.kleur};font-family:${breed ? 'Inter,sans-serif;font-weight:600;font-size:12px' : "'Barlow Condensed',sans-serif;font-weight:800;font-size:15px"}">${esc(d.label)}</text>`;
  });
  s += `<polygon points="${poly(gemid)}" style="fill:color-mix(in srgb,var(--elf2) 14%,transparent);stroke:var(--elf2);stroke-width:1.8;stroke-dasharray:5 3"/>`;
  s += `<polygon points="${poly(laatste)}" style="fill:color-mix(in srgb,var(--accent) 30%,transparent);stroke:var(--accent);stroke-width:2.4;stroke-linejoin:round"/>`;
  laatste.forEach((v, i) => { if (!v) return; const [x, y] = pt(i, v); s += `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="4.5" style="fill:${assen[i].stip || assen[i].kleur};stroke:var(--surface);stroke-width:2"/>`; });
  return s + '</svg>';
}
function maandKort(iso){ try { return new Date(iso + 'T12:00').toLocaleDateString('nl-NL', { month:'short' }); } catch(e){ return ''; } }
const pctVan = v => Math.round(v / 5 * 100);
function spelersRadar(ctx, team){
  const r = teamRadar(ctx, team);
  if (!r) return { kop:'', html:'<p class="sbw-leeg">Nog geen spelersbeoordelingen met domeinscores.</p>' };
  const rijen = SKILLS.map((d, i) => {
    const l = r.laatste[i], g = r.gem[i];
    const dd = l != null && g != null ? cijfer(l) - cijfer(g) : null;
    return `<div class="sbw-dom"><span class="d" style="color:${d.kleur}">${esc(d.kort)}</span>
      <i><b style="width:${(l || 0) / 5 * 100}%;background:${d.kleur}"></b>${g ? `<em style="left:calc(${g / 5 * 100}% - 1px)"></em>` : ''}</i>
      <span class="g">${g ? cijfer(g) : '–'}</span><span class="l">${l ? cijfer(l) : '–'}</span>${trendHtml(dd)}</div>`;
  }).join('');
  return {
    kop: `${r.aantal} van ${r.spelers} geëvalueerd${r.datum ? ' · ' + esc(maandKort(r.datum)) : ''}`,
    html: `<div class="sbw-radar">${radarSvg(r.laatste, r.gem, SKILLS.map(d => ({ label:d.id, kleur:d.kleur })))}<div class="sbw-radarinfo">
      <div class="sbw-leg"><span><i class="l"></i>laatste evaluatie</span><span><i class="g"></i>gemiddelde seizoen</span></div>
      ${rijen}<div class="sbw-meta">Cijfers: <span style="color:var(--elf2)">gemiddeld</span> · <b>laatst</b> · verschil</div></div></div>`,
  };
}
function wedstrijdRadar(ctx, team){
  const r = wedRadar(ctx, team);
  if (!r) return { kop:'', html:'<p class="sbw-leeg">Nog geen wedstrijden geëvalueerd.</p>' };
  const rijen = TEAM_CATEGORIEEN.map((c, i) => {
    const l = r.laatste[i], g = r.gem[i];
    const dd = l != null && g != null ? pctVan(l) - pctVan(g) : null;
    return `<div class="sbw-dom"><span class="d">${esc(TEAM_KORT[c.id] || c.naam)}</span>
      <i><b style="width:${(l || 0) / 5 * 100}%;background:var(--accent)"></b>${g ? `<em style="left:calc(${g / 5 * 100}% - 1px)"></em>` : ''}</i>
      <span class="g">${g ? pctVan(g) : '–'}</span><span class="l">${l ? pctVan(l) : '–'}</span>${trendHtml(dd)}</div>`;
  }).join('');
  return {
    kop: `${r.aantal} wedstrijd${r.aantal === 1 ? '' : 'en'} geëvalueerd`,
    html: `<div class="sbw-radar breed">${radarSvg(r.laatste, r.gem, TEAM_CATEGORIEEN.map(c => ({ label:TEAM_KORT[c.id] || c.naam, kleur:'var(--ink-2)', stip:'var(--accent)' })), true)}<div class="sbw-radarinfo">
      <div class="sbw-leg"><span><i class="l"></i>laatste: ${esc(r.tegen || 'wedstrijd')}${r.datum ? ' · ' + esc(Number(r.datum.slice(8, 10)) + ' ' + maandKort(r.datum)) : ''}</span><span><i class="g"></i>gemiddelde seizoen</span></div>
      ${rijen}<div class="sbw-meta">Teamscore in %: <span style="color:var(--elf2)">gemiddeld</span> · <b>laatst</b> · verschil</div></div></div>`,
  };
}
/* Welke radar per team (runtime): 'w' = wedstrijden, 's' = spelers.
   Zonder keuze: wedstrijden als die er zijn, anders spelers. */
const radarModus = {};
function radarBinnen(ctx, team){
  const heeftW = !!wedRadar(ctx, team), heeftS = !!teamRadar(ctx, team);
  const m = radarModus[team.id] || (heeftW || !heeftS ? 'w' : 's');
  const r = m === 'w' ? wedstrijdRadar(ctx, team) : spelersRadar(ctx, team);
  const knop = (v, l) => `<button type="button" data-sel="radar" data-t="${esc(team.id)}" data-v="${v}" class="${m === v ? 'aan f' : ''}" aria-pressed="${m === v}">${l}</button>`;
  return { ...r, keus: `<div class="sbw-seg sbw-radarkeus" role="group" aria-label="Radar kiezen">${knop('w', 'Wedstrijden')}${knop('s', 'Spelers')}</div>` };
}

/* ---------- desktop ---------- */
export function htmlRadarBlok(ctx, team){
  const r = radarBinnen(ctx, team);
  return `<div class="dk-blok sbw-radarblok"><h3>Evaluatie ${esc(team.naam)}<span>${r.kop}</span></h3>${r.keus}${r.html}</div>`;
}
function stijgersDalers(rijen){
  const met = rijen.filter(r => r.sc?.delta != null);
  return { op: met.filter(r => r.sc.delta > 0).sort((a, b) => b.sc.delta - a.sc.delta).slice(0, 4),
           af: met.filter(r => r.sc.delta < 0).sort((a, b) => a.sc.delta - b.sc.delta).slice(0, 4) };
}
function miniRij(r){
  return `<div class="sbw-mini">${elPill(r.el)}<span class="nm">${esc(r.naam)}${r.positie ? ` <small>· ${esc(r.positie)}</small>` : ''}</span>${scoreHtml(r.sc)}</div>`;
}
export function htmlSelectieTegel(ctx){
  const rijen = selectieRijen(ctx);
  const t = tellen(rijen);
  const { op, af } = stijgersDalers(rijen);
  const open = rijen.filter(r => r.open).length;
  return `<button type="button" class="dk-blok sbw-tegel" data-bk="selmaken">
    <div class="sbw-kol"><h3>Selectie maken<span>${rijen.length} spelers</span></h3>
      <p class="sbw-uitleg">Alle spelers van ${ctx.teams.map(x => esc(x.naam)).join(' en ')} in één lijst. Kies per speler 1e, 2e of beide; hij komt dan in het juiste team.</p>
      <div class="sbw-verdeling"><div><b class="e1">${t.e1}</b><small>1E ELFTAL</small></div><div><b class="e2">${t.e2}</b><small>2E ELFTAL</small></div><div><b>${t.b}</b><small>BEIDE</small></div></div>
      ${open ? `<span class="dk-pill oranje sbw-openpil">${open} keuze${open === 1 ? '' : 's'} nog niet doorgevoerd</span>` : ''}</div>
    <div class="sbw-kol"><h3>Stijgers<span>laatste evaluatie</span></h3>${op.map(miniRij).join('') || '<p class="sbw-leeg">Nog geen stijgers.</p>'}</div>
    <div class="sbw-kol"><h3>Dalers<span>laatste evaluatie</span></h3>${af.map(miniRij).join('') || '<p class="sbw-leeg">Nog geen dalers.</p>'}
      <div class="sbw-open"><span class="dk-knop">Open selectie ›</span></div></div>
  </button>`;
}
function dkRijen(rijen){
  return gefilterd(rijen).map(r => `<tr data-k="${esc(r.sleutel)}">
      <td>${esc(r.nummer ?? '')}</td>
      <td><b>${esc(r.naam)}</b>${teamRegel(r)}</td>
      <td>${posHtml(r.positie)}</td>
      <td>${keuzeHtml(r)}</td>
      <td class="n ${r.w ? '' : 'sbw-nul'}">${r.w}</td>
      <td>${sbHtml(r)}</td>
      <td class="n ${r.g ? '' : 'sbw-nul'}">${r.g}</td>
      <td class="n ${r.a ? '' : 'sbw-nul'}">${r.a}</td>
      <td class="n">${r.opk != null ? r.opk + '%' : '–'}</td>
      <td class="n">${scoreHtml(r.sc)}</td></tr>`).join('')
    || '<tr><td colspan="10" class="sbw-leeg">Geen spelers gevonden.</td></tr>';
}
export function htmlSelectieScherm(ctx, kopHtml){
  const rijen = selectieRijen(ctx);
  const th = (k, l, n = false) => `<th class="${n ? 'n' : ''}" data-sel="sort" data-v="${k}" aria-sort="${f.s === k ? (f.r > 0 ? 'ascending' : 'descending') : 'none'}">${l}${f.s === k ? (f.r > 0 ? ' ▴' : ' ▾') : ''}</th>`;
  return `<div class="dk-scherm sbw-scherm" data-sbw="dk">${kopHtml}
    <div class="sbw-body">
      <div class="dkb-hallo"><h1 class="dk-groot">Selectie <span class="dk-omlijnd" style="display:inline">maken</span></h1></div>
      <div class="sbw-balk">${filterHtml()}<div class="sbw-tel" id="sbwTel">${telHtml(rijen)}</div></div>
      <div id="sbwOpen">${openHtml(rijen)}</div>
      <div class="dk-blok dk-tabelblok"><table class="dk-tabel sbw-tabel">
        <colgroup><col class="c-nr"><col class="c-naam"><col class="c-pos"><col class="c-sel"><col class="c-w"><col class="c-sb"><col class="c-g"><col class="c-a"><col class="c-opk"><col class="c-sc"></colgroup>
        <thead><tr>
        ${th('nr', '#')}${th('naam', 'Speler')}${th('pos', 'Positie')}<th>Selectie</th>${th('w', 'Wedstr.', true)}${th('pct', 'Speeltijd / reserve')}
        ${th('g', 'Goals', true)}${th('a', 'Assists', true)}${th('opk', 'Opkomst', true)}${th('score', 'Score', true)}</tr></thead>
        <tbody id="sbwBody">${dkRijen(rijen)}</tbody></table></div>
      <p class="dk-leeg sbw-voet">Cijfers tellen over de wedstrijden van alle teams in deze bouw, dit seizoen. Score = kaartcijfer uit de laatste beoordeling (40–96); het pijltje vergelijkt met de meting daarvoor. Kies je 1e of 2e, dan verhuist de speler direct naar dat team; bij Beide blijft hij in zijn team en staat hij via een uitlening ook bij het andere team. Zijn historie blijft behouden. Een jeugdspeler voeg je toe met een uitlening; die verschijnt dan vanzelf in deze lijst.</p>
    </div></div>`;
}

/* ---------- mobiel ---------- */
export function htmlRadarMobiel(ctx, team){
  const r = radarBinnen(ctx, team);
  return `<div class="mb-kaart"><div class="mb-lbl">Evaluatie ${esc(team.naam)}<span>${r.kop}</span></div>${r.keus}${r.html}</div>`;
}
export function htmlSelectieTegelMobiel(ctx){
  const rijen = selectieRijen(ctx);
  const t = tellen(rijen);
  const { op, af } = stijgersDalers(rijen);
  return `<button type="button" class="mb-kaart sbw-tegel-mb" data-mb="selmaken">
    <div class="mb-lbl">Selectie maken<span>${rijen.length} spelers ›</span></div>
    <div class="sbw-verdeling"><div><b class="e1">${t.e1}</b><small>1E</small></div><div><b class="e2">${t.e2}</b><small>2E</small></div><div><b>${t.b}</b><small>BEIDE</small></div></div>
    ${op.length || af.length ? `<div class="sbw-sk" style="margin-top:10px">Grootste verschillen</div>${[...op.slice(0, 2), ...af.slice(0, 2)].map(miniRij).join('')}` : ''}
  </button>`;
}
function mbRijen(rijen){
  return gefilterd(rijen).map(r => `<div class="mb-kaart sbw-mbrij" data-k="${esc(r.sleutel)}">
      <div class="sbw-mbkop"><span class="nm"><b>${esc(r.naam)}</b>${teamRegel(r)}</span>${scoreHtml(r.sc)}</div>
      <div class="sbw-mbmid">${posHtml(r.positie)}${keuzeHtml(r)}</div>
      <div class="sbw-mbcijfers"><span><b>${r.w}</b> wedstr.</span><span><b>${r.pct != null ? r.pct + '%' : '–'}</b> speeltijd</span><span><b>${r.g}</b> G</span><span><b>${r.a}</b> A</span><span><b>${r.opk != null ? r.opk + '%' : '–'}</b> opk.</span></div>
    </div>`).join('') || '<p class="mb-leeg">Geen spelers gevonden.</p>';
}
export function htmlSelectieMobiel(ctx){
  const rijen = selectieRijen(ctx);
  const sorteer = [['score', 'Score'], ['naam', 'Naam'], ['pos', 'Positie'], ['w', 'Wedstrijden'], ['pct', 'Speeltijd'], ['g', 'Goals'], ['opk', 'Opkomst']];
  return `<div class="sbw-scherm" data-sbw="mb">
    <div class="sbw-balk">${filterHtml()}
      <select class="sbw-zoek" data-sel="sortsel" aria-label="Sorteren op">${sorteer.map(([k, l]) => `<option value="${k}" ${f.s === k ? 'selected' : ''}>Sorteer: ${l}</option>`).join('')}</select>
      <div class="sbw-tel" id="sbwTel">${telHtml(rijen)}</div></div>
    <div id="sbwOpen">${openHtml(rijen)}</div>
    <div class="sbw-mblijst" id="sbwBody">${mbRijen(rijen)}</div>
    <p class="mb-leeg sbw-voet">Score = kaartcijfer uit de laatste beoordeling; het pijltje vergelijkt met de meting daarvoor. Kies je 1e of 2e, dan verhuist de speler naar dat team; bij Beide staat hij via een uitlening in beide teams.</p>
  </div>`;
}

/* ---------- interactie (gedeeld door desktop en mobiel) ----------
   Alleen de lijst en de tellers worden opnieuw getekend: zoekveld, focus en
   scrollpositie blijven staan. */
function hertekenLijst(root, ctx){
  if (!root) return;
  const rijen = selectieRijen(ctx);
  const body = root.querySelector('#sbwBody');
  if (body) body.innerHTML = root.dataset.sbw === 'mb' ? mbRijen(rijen) : dkRijen(rijen);
  const tel = root.querySelector('#sbwTel'); if (tel) tel.innerHTML = telHtml(rijen);
  const open = root.querySelector('#sbwOpen'); if (open) open.innerHTML = openHtml(rijen);
  root.querySelectorAll('[data-sel="e"],[data-sel="l"]').forEach(b => {
    const aan = f[b.dataset.sel] === b.dataset.v; b.className = aan ? 'aan f' : ''; b.setAttribute('aria-pressed', aan);
  });
}
/* Geeft true terug als de klik bij de selectie hoorde. opnieuw() tekent het
   hele scherm (nodig na sorteren, omdat de kopjes dan veranderen). */
export function selectieKlik(e, ctx, opnieuw){
  const b = e.target.closest('[data-sel]');
  if (!b || !ctx) return false;
  const root = b.closest('.sbw-scherm');
  const soort = b.dataset.sel;
  if (soort === 'radar'){ radarModus[b.dataset.t] = b.dataset.v === 's' ? 's' : 'w'; opnieuw?.(); return true; }
  if (soort === 'e' || soort === 'l'){ f[soort] = b.dataset.v; hertekenLijst(root, ctx); return true; }
  if (soort === 'sort'){ const k = b.dataset.v; f.r = f.s === k ? -f.r : (['naam', 'nr', 'pos'].includes(k) ? 1 : -1); f.s = k; opnieuw?.(); return true; }
  if (soort === 'el'){ zetElftal(ctx, b.dataset.k, b.dataset.e, root); return true; }
  if (soort === 'doorvoeren'){ doorvoeren(ctx, root); return true; }
  return soort === 'sortsel';
}
export function selectieInvoer(e, ctx){
  const t = e.target;
  if (t.id === 'sbwZoek'){ f.q = t.value; hertekenLijst(t.closest('.sbw-scherm'), ctx); return true; }
  if (t.dataset?.sel === 'sortsel'){ f.s = t.value; f.r = ['naam', 'nr', 'pos'].includes(t.value) ? 1 : -1; hertekenLijst(t.closest('.sbw-scherm'), ctx); return true; }
  return false;
}
/* ---------- de keuze echt uitvoeren ---------- */
let bezig = false;
async function voerUit(ctx, r, e){
  const [t1, t2] = ctx.teams;
  const pid = r.pid, huis = r.teamId;
  const leningen = internLeen(ctx, pid);
  const batch = writeBatch(db);
  if (e === '1' || e === '2'){
    const doel = e === '1' ? t1 : t2;
    leningen.forEach(u => batch.delete(doc(db, 'clubs', ctx.clubId, 'uitleningen', u.id)));
    let nieuw = null;
    if (doel.id !== huis){
      /* verhuizen met dezelfde id: vers document ophalen, bij het doelteam zetten, bij het oude weghalen */
      const snap = await getDoc(doc(db, 'teams', huis, 'spelers', pid));
      if (!snap.exists()) throw new Error(`${r.naam} staat niet meer bij ${r.teamNaam}`);
      nieuw = { ...snap.data(), elftal:e };
      delete nieuw.gast;
      batch.set(doc(db, 'teams', doel.id, 'spelers', pid), nieuw);
      batch.delete(doc(db, 'teams', huis, 'spelers', pid));
    } else batch.update(doc(db, 'teams', huis, 'spelers', pid), { elftal:e });
    await batch.commit();
    /* lokaal bijwerken, zodat lijst en dashboard meteen kloppen */
    const weg = new Set(leningen.map(u => u.id));
    ctx.uitleningen = (ctx.uitleningen || []).filter(u => !weg.has(u.id));
    if (nieuw){
      const dv = ctx.data.get(huis), dn = ctx.data.get(doel.id);
      dv.spelers = (dv.spelers || []).filter(p => p.id !== pid);
      dn.spelers = [...(dn.spelers || []), { id:pid, ...nieuw }];
    } else r.bron.elftal = e;
    return e === '1' ? `${r.naam} staat nu bij ${t1.naam}` : `${r.naam} staat nu bij ${t2.naam}`;
  }
  /* beide: blijft in zijn team, uitlening naar het andere team (als die er nog niet is) */
  const ander = huis === t1.id ? t2 : t1;
  batch.update(doc(db, 'teams', huis, 'spelers', pid), { elftal:'b' });
  let leen = null;
  if (!leningen.length){
    const ref = doc(collection(db, 'clubs', ctx.clubId, 'uitleningen'));
    leen = { spelerId:pid, vanTeam:huis, vanTeamNaam:r.teamNaam, naarTeam:ander.id, naarTeamNaam:ander.naam,
      overlay:{}, snapshot: bouwLeenSnapshot(r.bron), door: S.user?.uid || null };
    batch.set(ref, { ...leen, gemaakt: serverTimestamp() });
    leen.id = ref.id;
  }
  await batch.commit();
  r.bron.elftal = 'b';
  if (leen) ctx.uitleningen = [...(ctx.uitleningen || []), leen];
  return `${r.naam} staat nu bij ${t1.naam} én ${t2.naam}`;
}
function foutTekst(err, r){
  return err?.code === 'permission-denied'
    ? `Geen rechten op ${r.teamNaam} of het andere team. Koppel je als coach aan deze bouw.`
    : 'Mislukt: ' + (err?.code || err?.message);
}
async function zetElftal(ctx, sleutel, e, root){
  if (bezig) return meld('Even wachten, de vorige wijziging loopt nog');
  const r = selectieRijen(ctx).find(x => x.sleutel === sleutel);
  if (!r || r.leen || !geldig(e) || (r.el === e && !r.open)) return;
  bezig = true;
  root?.querySelector(`[data-k="${CSS.escape(sleutel)}"]`)?.classList.add('sbw-bezig');
  try { meld(await voerUit(ctx, r, e)); }
  catch(err){ console.warn('[Cluppie] selectie: uitvoeren mislukt', err); meld(foutTekst(err, r)); }
  finally { bezig = false; hertekenLijst(root, ctx); }
}
/* Keuzes van vóór deze versie (alleen een label) in één keer uitvoeren. */
async function doorvoeren(ctx, root){
  if (bezig) return;
  const open = selectieRijen(ctx).filter(r => r.open);
  if (!open.length) return;
  const naar = e => open.filter(r => r.wens === e).length;
  if (!confirm(`${open.length} spelers in het gekozen team zetten?\n\n` +
    `• ${naar('1')} naar ${ctx.teams[0].naam}\n• ${naar('2')} naar ${ctx.teams[1].naam}\n• ${naar('b')} in beide teams (via een uitlening)\n\n` +
    'Opstellingen, goals en beoordelingen blijven aan de spelers gekoppeld.')) return;
  bezig = true;
  const knop = root?.querySelector('[data-sel="doorvoeren"]');
  let ok = 0, fout = 0, laatsteFout = '';
  for (const r of open){
    if (knop) knop.textContent = `Bezig… ${ok + fout + 1}/${open.length}`;
    try { await voerUit(ctx, r, r.wens); ok++; }
    catch(err){ fout++; laatsteFout = foutTekst(err, r); console.warn('[Cluppie] selectie: doorvoeren', r.naam, err); }
  }
  bezig = false;
  hertekenLijst(root, ctx);
  meld(fout ? `${ok} doorgevoerd, ${fout} mislukt. ${laatsteFout}` : `${ok} spelers staan nu in het gekozen team`);
}
/* Voor Club → Instellingen: staat de selectie-optie aan voor deze bouw? */
export function selectieStandaard(eb){ return eb?.selectie === true || (eb?.selectie == null && /selectie/i.test(eb?.naam || '')); }
