/* ==================== ELFTALLEN (1e + 2e binnen één team) ====================
   [20260928e] Voor een selectie die met twee elftallen speelt (bv. "Selectie"
   = ASV'33 1 + ASV'33 2). Eén Cluppie-team, twee elftallen, zodat spelers die
   wisselen geen uitlening nodig hebben en hun cijfers bij elkaar blijven.

   Datamodel (alles optioneel, bestaande teams merken er niets van):
     teams/{id}.tweedeElftal = { sportlinkNaam: "ASV'33 2" | null }
         aanwezig = dit team heeft een 1e én 2e elftal. Het 1e elftal gebruikt
         de bestaande koppeling (sportlinkNaam || naam).
     teams/{id}/spelers/{pid}.elftal = '1' | '2' | 'b'   (leeg = '1')
     teams/{id}/wedstrijden/{wid}.elftal = '1' | '2'      (leeg = '1')
     goal-event {type, pid, assist?, kwart, sec}  — assist staat in wedstrijd.js

   De filterkeuze (1e / 2e / totaal) leeft runtime op S._elftalFilter, zodat
   state.js niet geraakt wordt. */
import { S, $, $$, esc, meld, openModal, sluitModal } from './state.js?v=20260922c';
import { db, doc, updateDoc } from './firebase.js?v=20260922c';
import { analyseWedstrijd } from './analyse.js?v=20260928a';

/* ---------- basis ---------- */
export function heeftElftallen(team = S.team){ return !!(team && team.tweedeElftal); }
export function elftalSpeler(p){ const e = p?.elftal; return e === '2' || e === 'b' ? e : '1'; }
export function elftalWedstrijd(w){ return String(w?.elftal || '1') === '2' ? '2' : '1'; }
export function hoortBijElftal(p, e){ const x = elftalSpeler(p); return x === 'b' || x === e; }
export function elftalNaam(e){ return e === '2' ? '2e elftal' : '1e elftal'; }
/* Eigen spelers (geen gast- of ingeleende spiegel): alleen die zijn toe te wijzen. */
function eigenSpeler(p){ return p && !p._ingeleend && !p.gast && !p._gast; }

export function elftalFilter(){
  if (!heeftElftallen()) return 't';
  return ['1', '2', 't'].includes(S._elftalFilter) ? S._elftalFilter : 't';
}
export function filterOpElftal(lijst, f = elftalFilter()){
  if (!heeftElftallen() || f === 't') return lijst;
  return lijst.filter(w => elftalWedstrijd(w) === f);
}

/* ---------- kleine HTML-bouwstenen ---------- */
export function elftalPillen(p){
  if (!heeftElftallen() || !eigenSpeler(p)) return '';
  const e = elftalSpeler(p);
  return `<span class="elf-pillen">${e !== '2' ? '<span class="elf-pill e1">1</span>' : ''}${e !== '1' ? '<span class="elf-pill e2">2</span>' : ''}</span>`;
}
export function elftalPillWedstrijd(w){
  if (!heeftElftallen() || w?.type === 'toernooi') return '';
  const e = elftalWedstrijd(w);
  return `<span class="elf-pill e${e}">${e}e</span>`;
}
/* Segment 1e / 2e / Totaal. Koppelen met koppelElftalFilter(). */
export function elftalFilterHtml(extraKlasse = ''){
  if (!heeftElftallen()) return '';
  const f = elftalFilter();
  return `<div class="segment elf-filter ${extraKlasse}">
    <button data-elftalfilter="1" class="${f === '1' ? 'actief' : ''}">1e elftal</button>
    <button data-elftalfilter="2" class="${f === '2' ? 'actief' : ''}">2e elftal</button>
    <button data-elftalfilter="t" class="${f === 't' ? 'actief' : ''}">Totaal</button>
  </div>`;
}
export function koppelElftalFilter(root, opnieuw){
  (root || document).querySelectorAll('[data-elftalfilter]').forEach(b => b.onclick = () => {
    S._elftalFilter = b.dataset.elftalfilter;
    opnieuw?.();
  });
}

/* Spelers voor een wedstrijd van elftal e: eerst wie erbij hoort, dan de rest. */
export function spelersVoorElftal(spelers, e){
  const eigen = [], rest = [];
  for (const p of spelers) (!eigenSpeler(p) || hoortBijElftal(p, e) ? eigen : rest).push(p);
  return { eigen, rest };
}

/* ---------- cijfers per speler ----------
   Wedstrijden, goals, assists en speelseconden over het huidige seizoen,
   gefilterd op elftal. Een wedstrijd telt voor een speler als hij speeltijd
   had (zelfde regel als spelerStats in teams-spelers.js). */
function gespeeld(w){ try { return (w.goals || []).length > 0 || analyseWedstrijd(w).kwarten > 0; } catch(e){ return false; } }
export function selectieCijfers(f = elftalFilter()){
  const seizoen = S.huidigSeizoen;
  const lijst = filterOpElftal(S.wedstrijden.filter(w => !seizoen || !w.seizoen || w.seizoen === seizoen), f);
  const per = {};
  const rij = pid => (per[pid] ||= { w:0, g:0, a:0, sec:0 });
  let wedstrijden = 0, voor = 0, tegen = 0, winst = 0, gelijk = 0, verlies = 0, assists = 0;
  for (const w of lijst){
    if (w.type === 'toernooi' || !gespeeld(w)) continue;
    wedstrijden++;
    let v = 0, t = 0;
    for (const g of (w.goals || [])){
      if (g.type === 'voor'){ v++; if (g.pid) rij(g.pid).g++; if (g.assist){ rij(g.assist).a++; assists++; } }
      else if (g.type === 'tegen') t++;
    }
    voor += v; tegen += t;
    if (v > t) winst++; else if (v === t) gelijk++; else verlies++;
    let a = null; try { a = analyseWedstrijd(w); } catch(e){}
    if (a?.kwarten) for (const [pid, s] of Object.entries(a.tijd || {})){ if (s > 0){ rij(pid).w++; rij(pid).sec += s; } }
  }
  return { per, wedstrijden, voor, tegen, winst, gelijk, verlies, assists };
}

/* ---------- selectie-dashboard (hub, mobiel) ----------
   Standaard de top 8 (goals, assists, minuten), zodat de tegels van de hub
   niet ver naar beneden zakken; "Toon alle" klapt de rest uit. */
const MAX_RIJEN = 8;
export function htmlSelectieDashboard(){
  if (!heeftElftallen()) return '';
  const f = elftalFilter();
  const c = selectieCijfers(f);
  const nr = p => Number(p.nummer) || 99;
  const zichtbaar = S.spelers.filter(p => {
    const r = c.per[p.id];
    if (r && (r.w || r.g || r.a)) return true;
    return f === 't' || (eigenSpeler(p) && hoortBijElftal(p, f));
  }).sort((a, b) => {
    const ra = c.per[a.id] || {}, rb = c.per[b.id] || {};
    return (rb.g || 0) - (ra.g || 0) || (rb.a || 0) - (ra.a || 0) || (rb.sec || 0) - (ra.sec || 0) || nr(a) - nr(b);
  });
  const sl2 = S.team.tweedeElftal?.sportlinkNaam;
  const sub = [S.team.sportlinkNaam || null, sl2 || null].filter(Boolean).map(esc).join(' · ');
  return `
    <section class="hub-sectie sel-dash">
      <div class="hub-sectie-kop">Selectie${sub ? `<span class="sel-dash-sub">${sub}</span>` : ''}</div>
      ${elftalFilterHtml()}
      <div class="sel-kpis">
        <div><b>${c.wedstrijden}</b><small>Wedstr.</small></div>
        <div><b>${c.voor}</b><small>Goals</small></div>
        <div><b>${c.assists}</b><small>Assists</small></div>
        <div><b>${c.winst}-${c.gelijk}-${c.verlies}</b><small>W-G-V</small></div>
      </div>
      <div class="sel-tabel">
        <div class="sel-rij sel-kop"><span>#</span><span>Speler</span><span>W</span><span>G</span><span>A</span><span>Min.</span></div>
        ${zichtbaar.slice(0, S._selDashAlles ? zichtbaar.length : MAX_RIJEN).map(p => { const r = c.per[p.id] || { w:0, g:0, a:0, sec:0 };
          return `<button class="sel-rij" data-statsprofiel="${esc(p.id)}"><span class="nr">${esc(p.nummer ?? '')}</span><span class="n">${esc(p.naam || '')}${elftalPillen(p)}</span>
            <span class="${r.w ? '' : 'nul'}">${r.w}</span><span class="${r.g ? 'sterk' : 'nul'}">${r.g}</span><span class="${r.a ? 'sterk' : 'nul'}">${r.a}</span><span class="${r.sec ? 'klein' : 'nul'}">${Math.round(r.sec / 60)}</span></button>`; }).join('')
          || '<div class="sel-leeg">Nog geen spelers voor dit elftal. Wijs ze toe via de knop hieronder.</div>'}
        ${zichtbaar.length > MAX_RIJEN ? `<button class="sel-meer" id="selDashMeer">${S._selDashAlles ? 'Toon minder' : `Toon alle ${zichtbaar.length} spelers`}</button>` : ''}
      </div>
      <p class="sel-uitleg">W = wedstrijden · G = goals · A = assists · Min. = speelminuten, dit seizoen. Tik op een speler voor zijn profiel.</p>
      <div class="sel-knoppen">
        <button class="knop licht" id="selToewijzen">Spelers toewijzen</button>
        <button class="knop licht" data-hub-open="stats">Alle statistieken ›</button>
      </div>
    </section>`;
}

/* ---------- spelers toewijzen aan een elftal ---------- */
export function modalElftalToewijzen(naSluiten){
  if (!heeftElftallen()) return;
  const lijst = S.spelers.filter(eigenSpeler).sort((a, b) => (a.naam || '').localeCompare(b.naam || '', 'nl', { sensitivity:'base' }));
  /* Keuze per speler lokaal bijhouden: de spelers-listener kan S.spelers
     tussendoor vervangen, en we hertekenen de lijst niet (scrollpositie). */
  const keuze = Object.fromEntries(lijst.map(p => [p.id, elftalSpeler(p)]));
  const telHtml = () => {
    const tel = e => lijst.filter(p => keuze[p.id] === 'b' || keuze[p.id] === e).length;
    return `<span class="elf-pill e1">1e</span> ${tel('1')} spelers <span class="elf-pill e2" style="margin-left:10px">2e</span> ${tel('2')} spelers`;
  };
  openModal(`
    <h2>Spelers toewijzen</h2>
    <p style="font-size:calc(13px * var(--fs));color:var(--ink-2);line-height:1.5;margin-bottom:12px">Bij welk elftal hoort iemand? Wie bij het gekozen elftal hoort, staat bij een nieuwe wedstrijd bovenaan en is vooraf aangevinkt. Je kunt altijd iedereen uit de selectie opstellen.</p>
    <div class="elf-tel" id="elfTel">${telHtml()}</div>
    <div class="elf-toew">${lijst.map(p => `<div class="elf-toew-rij"><span class="n">${esc(p.naam || '')}</span>
        <div class="segment elf-keuze">${[['1', '1e'], ['2', '2e'], ['b', 'Beide']].map(([v, l]) =>
          `<button data-elftoew="${esc(p.id)}" data-e="${v}" class="${keuze[p.id] === v ? 'actief e' + v : ''}">${l}</button>`).join('')}</div></div>`).join('')
      || '<p style="color:var(--ink-2)">Nog geen spelers in dit team.</p>'}</div>
    <button class="knop vol" id="elfToewKlaar" style="margin-top:12px">Klaar</button>`);
  const zet = (pid, e) => {
    keuze[pid] = e;
    $$(`#modalInhoud [data-elftoew="${CSS.escape(pid)}"]`).forEach(x => x.className = x.dataset.e === e ? 'actief e' + e : '');
    const t = $('#elfTel'); if (t) t.innerHTML = telHtml();
  };
  $$('#modalInhoud [data-elftoew]').forEach(b => b.onclick = async () => {
    const pid = b.dataset.elftoew, e = b.dataset.e, oud = keuze[pid];
    if (oud === e) return;
    zet(pid, e);
    try { await updateDoc(doc(db, 'teams', S.teamId, 'spelers', pid), { elftal: e }); }
    catch(err){ zet(pid, oud); meld('Opslaan mislukt: ' + (err.code || err.message)); }
  });
  $('#elfToewKlaar').onclick = () => { sluitModal(); naSluiten?.(); };
}
