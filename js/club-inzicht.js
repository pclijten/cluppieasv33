/* ==================== CLUB-INZICHT ====================
   Rendert de statistiek-tabs en de flashy rapporten op basis van het
   gebruikstats/{clubId}-document (gegenereerd door de Cloud Function
   aggregeerGebruik). Alles leest uit één in-memory object — geen extra reads.

   Tabs:  Teams (coördinator, visueel) · Gebruik · Pagina's · Tijd
   Rapporten: schermvullend in-app te bekijken én te delen als bestand.

   AVG: teamniveau overal; de coach-namenlijst alleen voor beheerders.
   ====================================================================== */

import { esc, isBeheerder } from './state.js?v=20260902b';
import { ico } from './icons.js?v=20260825b';

/* ---------- kleine formatteerhelpers ---------- */
const DAG_NAMEN = ['Maandag','Dinsdag','Woensdag','Donderdag','Vrijdag','Zaterdag','Zondag'];
const DAG_KORT  = ['Ma','Di','Wo','Do','Vr','Za','Zo'];

// verblijftijd in seconden → leesbaar
function fmtTot(sec){
  if (!sec || sec < 1) return '—';
  if (sec < 60) return `${sec}s`;
  if (sec < 3600) return `${Math.floor(sec/60)}m`;
  return `${Math.floor(sec/3600)}u ${Math.floor((sec%3600)/60)}m`;
}
function fmtMed(sec){
  if (!sec || sec < 1) return '—';
  if (sec < 60) return `${sec}s`;
  return `${Math.floor(sec/60)}m${String(sec%60).padStart(2,'0')}`;
}
// leesbare schermnaam voor de coördinator
const SCHERM_LABELS = {
  'team:hub':'Team-hub', 'club:hub':'Club-hub', 'teams':'Teams-overzicht',
  'team:trainingen':'Trainingen', 'club:trainingen':'Club-trainingen',
  'team:presentietraining':'Aanwezigheid training', 'team:preswedstrijd':'Aanwezigheid wedstrijd',
  'wedstrijd:opstelling':'Opstelling maken', 'team:wedstrijden':'Wedstrijdoverzicht',
  'team:poule':'Poule & programma', 'team:instellingen':'Teaminstellingen',
  'team:documenten':'Documenten', 'team:videos':'Video-uitleg', 'spelerprofiel':'Spelerprofiel',
  'team:spelers':'Spelerslijst', 'team:stats':'Statistieken', 'team:evaluatie':'Speler evalueren',
  'team:updates':'Wat is nieuw', 'team:leerlijnoverzicht':'Leerlijn', 'team:historie':'Historie',
  'wedstrijd:kwart1':'1e kwart','wedstrijd:kwart2':'2e kwart','wedstrijd:kwart3':'3e kwart',
  'wedstrijd:kwart4':'4e kwart','wedstrijd:kwart5':'5e kwart','wedstrijd:tactiek':'Tactiekbord',
};
function schermLabel(s){ return SCHERM_LABELS[s] || s; }

// De Cloud Function schrijft de heatmap plat weg (168 getallen, index = dag*24+uur),
// omdat Firestore geen geneste arrays toestaat. Hier vouwen we terug naar 7x24.
// Robuust: accepteert ook de oude geneste vorm, mocht die ergens voorkomen.
function heatmapMatrix(h){
  if (Array.isArray(h) && h.length === 7 && Array.isArray(h[0])) return h;
  const plat = Array.isArray(h) ? h : [];
  return Array.from({length:7}, (_, d) => Array.from({length:24}, (_, u) => plat[d*24+u] || 0));
}

// categoriekleuren (consistent met de rapporten)
const CAT_KLEUR = { Trainingen:'#e2342f', Wedstrijden:'#2b6cb0', Spelers:'#3fb950', Media:'#d69e2e', Clubbeheer:'#a371f7', Overig:'#8b949e', Navigatie:'#5b6472' };

/* Segment-control voor de tabkeuze binnen Inzicht. */
export function htmlInzichtTabs(actief){
  const tabs = [['teams','Teams'],['gebruik','Gebruik'],['paginas','Pagina\u2019s'],['tijd','Tijd'],['rapporten','Rapporten']];
  return `<div class="segment inzicht-tabs">${tabs.map(([id,label]) =>
    `<button data-inztab="${id}" class="${actief===id?'actief':''}">${label}</button>`).join('')}</div>`;
}

/* Lege staat als er nog nooit gesynchroniseerd is. */
function htmlGeenData(){
  return `<div class="kaart" style="text-align:center;padding:calc(26px * var(--fs)) calc(16px * var(--fs))">
    <div style="font-size:calc(15px * var(--fs));font-weight:600;margin-bottom:calc(6px * var(--fs))">Nog geen cijfers</div>
    <div style="font-size:calc(12.5px * var(--fs));color:var(--ink-2)">Druk op <b>Synchroniseer</b> om de statistieken voor het eerst op te halen.</div>
  </div>`;
}

/* ---------- TAB: TEAMS (coördinator) ---------- */
export function htmlInzichtTeams(stats){
  if (!stats) return htmlGeenData();
  const teams = (stats.teams || []).filter(t => t.teamId && t.naam !== '(geen team)' && !/test/i.test(t.naam));
  const kpi = (g, l) => `<div class="inz-kpi"><div class="g">${g}</div><div class="l">${esc(l)}</div></div>`;

  const maxSes = Math.max(1, ...teams.map(t => t.ses));
  const actiefRijen = teams.slice().sort((a,b)=>b.ses-a.ses).map(t => `
    <div class="inz-trij">
      <div class="tn">${esc(t.naam)}</div>
      <div class="ts"><span class="tv" style="width:${Math.round(100*t.ses/maxSes)}%"></span></div>
      <div class="tw">${t.ses}\u00d7 \u00b7 ${t.coaches} coach${t.coaches===1?'':'es'}</div>
    </div>`).join('');

  const profielRijen = teams.slice().sort((a,b)=>{
    const sa=Object.values(a.cat||{}).reduce((x,y)=>x+y,0), sb=Object.values(b.cat||{}).reduce((x,y)=>x+y,0);
    return sb-sa;
  }).map(t => {
    const cat = t.cat || {};
    const inh = ['Trainingen','Wedstrijden','Spelers','Media','Clubbeheer','Overig'].reduce((a,k)=>a+(cat[k]||0),0) || 1;
    const seg = (k) => (cat[k]>0) ? `<div class="inz-seg" style="width:${100*cat[k]/inh}%;background:${CAT_KLEUR[k]}"></div>` : '';
    return `<div class="inz-prij">
      <div class="pn">${esc(t.naam)} <span class="inz-badge">${esc(t.profiel||'')}</span></div>
      <div class="inz-pbalk">${seg('Trainingen')}${seg('Wedstrijden')}${seg('Spelers')}${seg('Media')}${seg('Clubbeheer')}${seg('Overig')}</div>
    </div>`;
  }).join('');

  const legenda = ['Trainingen','Wedstrijden','Spelers','Media','Clubbeheer'].map(k =>
    `<span><i style="background:${CAT_KLEUR[k]}"></i>${k}</span>`).join('');

  return `
    <div class="inz-kpis">
      ${kpi(stats.bron?.teams ?? teams.length, 'actieve teams')}
      ${kpi(stats.bron?.sessies ?? 0, 'sessies')}
      ${kpi(stats.bron?.coaches ?? 0, 'coaches')}
    </div>
    <div class="kaart">
      <div class="sectie-kop">Hoe actief is elk team?</div>
      <div class="inz-sub">Aantal keren de app geopend</div>
      ${actiefRijen || '<div class="inz-sub">Geen teamdata.</div>'}
    </div>
    <div class="kaart">
      <div class="sectie-kop">Waar besteedt elk team zijn tijd?</div>
      <div class="inz-sub">Verdeling van de tijd binnen elk team</div>
      ${profielRijen}
      <div class="inz-legenda">${legenda}</div>
    </div>`;
}

/* ---------- TAB: GEBRUIK ---------- */
export function htmlInzichtGebruik(stats){
  if (!stats) return htmlGeenData();
  const dag = stats.dag || new Array(7).fill(0);
  const dagTeams = stats.dagTeams || new Array(7).fill(0);
  const maxDag = Math.max(1, ...dag);
  const dagRijen = DAG_NAMEN.map((d,i) => `
    <div class="inz-dagrij">
      <span class="dn">${d}</span>
      <span class="ds"><span class="dv" style="width:${Math.round(100*dag[i]/maxDag)}%"></span></span>
      <span class="dw">${dag[i]}</span>
    </div>`).join('');

  const vb = stats.voorbereiding || {};
  const vTot = (vb.zelf||0)+(vb.dag1||0)+(vb.dag2||0)+(vb.dag3||0)+(vb.dag4plus||0) || 1;
  const pct = (n) => Math.round(100*(n||0)/vTot);
  const vooruit = pct((vb.dag2||0)+(vb.dag3||0)+(vb.dag4plus||0));

  return `
    <div class="kaart">
      <div class="sectie-kop">Drukste dagen</div>
      <div class="inz-sub">Schermweergaves per weekdag</div>
      ${dagRijen}
    </div>
    <div class="kaart">
      <div class="sectie-kop">Voorbereiding training</div>
      <div class="inz-sub">Wanneer wordt het trainingsscherm geopend t.o.v. de trainingsdag?</div>
      <div class="inz-vgrid">
        <div class="inz-vc"><div class="g">${pct(vb.zelf)}%</div><div class="l">op de dag zelf</div></div>
        <div class="inz-vc"><div class="g">${pct(vb.dag1)}%</div><div class="l">de dag ervoor</div></div>
        <div class="inz-vc"><div class="g">${vooruit}%</div><div class="l">2+ dagen vooruit</div></div>
      </div>
    </div>`;
}

/* ---------- TAB: PAGINA'S (nerds) ---------- */
export function htmlInzichtPaginas(stats){
  if (!stats) return htmlGeenData();
  const paginas = (stats.paginas || []).filter(p => p.n >= 3);
  const rijen = paginas.map(p => `
    <tr>
      <td>${esc(schermLabel(p.s))}</td>
      <td class="num">${p.n}</td>
      <td class="num">${fmtMed(p.med)}</td>
      <td class="num inz-mono">${fmtTot(p.tot)}</td>
    </tr>`).join('');

  const beheerderExtra = isBeheerder() ? htmlCoachLijst(stats) : '';

  return `
    <div class="kaart">
      <div class="sectie-kop">Alle schermen</div>
      <div class="inz-sub">Verblijftijd en bezoeken per scherm</div>
      <table class="inz-ptab">
        <thead><tr><th>Scherm</th><th class="num">Bez.</th><th class="num">Med.</th><th class="num">Totaal</th></tr></thead>
        <tbody>${rijen}</tbody>
      </table>
    </div>
    ${beheerderExtra}`;
}

/* Alleen voor beheerders: de meest actieve coaches (met naam). Niet in de
   coördinator-weergave, vanwege AVG. */
function htmlCoachLijst(stats){
  const coaches = (stats.coaches || []).filter(c => c.ses > 0).slice(0, 15);
  if (!coaches.length) return '';
  const rijen = coaches.map(c => `
    <tr>
      <td>${esc(c.naam || c.uid.slice(0,8))}</td>
      <td class="num">${c.ses}</td>
      <td class="num inz-mono">${fmtTot(c.tot)}</td>
    </tr>`).join('');
  return `
    <div class="kaart">
      <div class="sectie-kop">Meest actieve coaches</div>
      <div class="inz-sub">Alleen zichtbaar voor beheerders</div>
      <table class="inz-ptab">
        <thead><tr><th>Coach</th><th class="num">Sessies</th><th class="num">Totaal</th></tr></thead>
        <tbody>${rijen}</tbody>
      </table>
    </div>`;
}

/* ---------- TAB: TIJD (heatmap, nerds) ---------- */
export function htmlInzichtTijd(stats){
  if (!stats) return htmlGeenData();
  const heat = heatmapMatrix(stats.heatmap);
  let maxCel = 0; for (const rij of heat) for (const v of rij) if (v>maxCel) maxCel=v;
  maxCel = Math.max(1, maxCel);

  const uurKop = Array.from({length:24}, (_,u) => u%3===0 ? `<th>${u}</th>` : '<th></th>').join('');
  const rijen = heat.map((rij,i) => {
    const cellen = rij.map(v => {
      const a = v===0 ? 0 : (0.12 + 0.88*(v/maxCel));
      return `<td><div class="inz-hc" style="background:rgba(226,52,47,${a.toFixed(2)})" title="${v}"></div></td>`;
    }).join('');
    return `<tr><td class="rl">${DAG_KORT[i]}</td>${cellen}</tr>`;
  }).join('');

  return `
    <div class="kaart">
      <div class="sectie-kop">Heatmap \u2014 dag \u00d7 uur</div>
      <div class="inz-sub">Wanneer wordt de app gebruikt? Donkerder = drukker (Nederlandse tijd)</div>
      <div class="inz-hmwrap">
        <table class="inz-hm"><tr><th class="rl"></th>${uurKop}</tr>${rijen}</table>
      </div>
    </div>`;
}

/* ---------- TAB: RAPPORTEN ---------- */
export function htmlInzichtRapporten(stats){
  if (!stats) return htmlGeenData();
  const knop = (id, titel, sub) => `
    <button class="inz-rapportknop" data-rapport="${id}">
      <div><div class="rt">${esc(titel)}</div><div class="rs">${esc(sub)}</div></div>
      <span class="rp">${ico('navigation-chevron-right', 20)}</span>
    </button>`;
  return `
    <div class="kaart">
      <div class="sectie-kop">Volledige rapporten</div>
      <div class="inz-sub">Open schermvullend of deel als bestand</div>
      ${knop('teams', 'Teamgebruik', 'Visueel overzicht voor de coördinator')}
      ${knop('wedstrijd', 'Wedstrijden', 'Opstelling vooraf & live langs de lijn')}
      ${knop('tijd', 'Tijd-analyse', 'Dag/uur-patronen, technisch detail')}
    </div>`;
}

/* Router: geeft de juiste tab-HTML terug. */
export function htmlInzichtTab(tab, stats){
  switch(tab){
    case 'gebruik':   return htmlInzichtGebruik(stats);
    case 'paginas':   return htmlInzichtPaginas(stats);
    case 'tijd':      return htmlInzichtTijd(stats);
    case 'rapporten': return htmlInzichtRapporten(stats);
    case 'teams':
    default:          return htmlInzichtTeams(stats);
  }
}

/* ==================== FLASHY RAPPORTEN (Fase 3) ====================
   Genereren een zelfstandige, opgemaakte HTML-pagina uit het gebruikstats-
   object en tonen die schermvullend in een overlay (iframe met srcdoc).
   Delen gebeurt als HTML-bestand via de native deel-sheet (betrouwbaar op iOS)
   met <a download> als desktop-fallback.
   ================================================================== */

let _rapportOverlay = null;

function bouwRapportOverlay(){
  if (_rapportOverlay) return _rapportOverlay;
  const el = document.createElement('div');
  el.className = 'rapport-achter';
  el.innerHTML = `
    <div class="rapport-kop">
      <button class="rapport-sluit" aria-label="Sluiten">\u2715</button>
      <div class="rapport-titel"></div>
      <button class="rapport-deel" aria-label="Delen">\u21e7 Delen</button>
    </div>
    <iframe class="rapport-frame" title="Rapport"></iframe>`;
  document.body.appendChild(el);
  el.querySelector('.rapport-sluit').onclick = () => sluitRapport();
  _rapportOverlay = el;
  return el;
}

export function sluitRapport(){
  if (_rapportOverlay) _rapportOverlay.classList.remove('open');
}

// deelt de rapport-HTML als bestand (share-sheet op mobiel, download op desktop)
async function deelRapport(html, bestandsnaam){
  const blob = new Blob([html], { type: 'text/html' });
  const naam = bestandsnaam.replace(/[^\w.-]+/g,'-') + '.html';
  if (navigator.canShare){
    try {
      const file = new File([blob], naam, { type: 'text/html' });
      if (navigator.canShare({ files: [file] })){
        await navigator.share({ files: [file], title: bestandsnaam });
        return;
      }
    } catch (e){
      if (e && e.name === 'AbortError') return;
    }
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = naam;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

/* Opent een rapport schermvullend. soort = 'teams' | 'wedstrijd' | 'tijd'. */
export function openRapport(soort, stats){
  if (!stats) return;
  const { html, titel, bestand } = bouwRapportHtml(soort, stats);
  const el = bouwRapportOverlay();
  el.querySelector('.rapport-titel').textContent = titel;
  el.querySelector('.rapport-frame').srcdoc = html;
  el.querySelector('.rapport-deel').onclick = () => deelRapport(html, bestand);
  el.classList.add('open');
}

/* ---------- rapport-HTML-generatie ---------- */
function fmtUur(sec){ const h=Math.floor(sec/3600), m=Math.floor((sec%3600)/60); return h?`${h}u ${String(m).padStart(2,'0')}m`:`${m}m`; }

// gedeelde <style> voor alle rapporten (los, want het draait in een iframe)
const RAPPORT_CSS = `
<style>
@import url('https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@600;700&family=Inter:wght@400;500;600&display=swap');
:root{--rood:#e2342f;--rdiep:#b3221e;--inkt:#161a20;--grijs:#5b6472;--lijn:#e7e9ee;--zacht:#f6f7f9;--groen:#1f9d6b;}
*{box-sizing:border-box;margin:0;padding:0;}
body{font-family:'Inter',sans-serif;color:var(--inkt);background:#fff;line-height:1.5;padding:0 0 40px;}
.kop{background:var(--inkt);color:#fff;padding:30px 24px;}
.kop .merk{font-family:'Barlow Condensed';font-weight:700;letter-spacing:.08em;text-transform:uppercase;font-size:12px;color:var(--rood);margin-bottom:10px;}
.kop h1{font-family:'Barlow Condensed';font-weight:700;font-size:30px;line-height:1.05;}
.kop .sub{margin-top:8px;color:#b8bfca;font-size:13px;}
.kop .per{margin-top:12px;display:inline-block;font-size:11px;background:rgba(255,255,255,.1);padding:5px 11px;border-radius:999px;color:#dfe3e9;}
.kpis{display:grid;grid-template-columns:repeat(3,1fr);border-bottom:1px solid var(--lijn);}
.kpi{padding:18px 8px;text-align:center;border-right:1px solid var(--lijn);}
.kpi:last-child{border-right:none;}
.kpi .g{font-family:'Barlow Condensed';font-weight:700;font-size:32px;color:var(--rood);line-height:1;}
.kpi .l{margin-top:5px;font-size:10.5px;color:var(--grijs);}
.sectie{padding:24px;border-bottom:1px solid var(--lijn);}
.eyebrow{font-family:'Barlow Condensed';font-weight:600;text-transform:uppercase;letter-spacing:.08em;font-size:12px;color:var(--rood);margin-bottom:3px;}
h2{font-family:'Barlow Condensed';font-weight:700;font-size:22px;margin-bottom:3px;}
.lead{color:var(--grijs);font-size:13px;margin-bottom:16px;}
.balk{display:flex;align-items:center;gap:10px;margin-bottom:9px;}
.balk .n{width:120px;font-size:12.5px;font-weight:500;text-align:right;flex-shrink:0;}
.balk .s{flex:1;background:var(--zacht);border-radius:7px;height:24px;overflow:hidden;}
.balk .v{height:100%;border-radius:7px;background:linear-gradient(90deg,var(--rood),var(--rdiep));display:flex;align-items:center;justify-content:flex-end;padding-right:9px;color:#fff;font-size:11.5px;font-weight:600;min-width:30px;}
.balk .m{width:78px;font-size:11px;color:var(--grijs);}
.prij{margin-bottom:11px;}
.pn{font-size:12.5px;font-weight:600;margin-bottom:4px;display:flex;gap:7px;align-items:center;flex-wrap:wrap;}
.badge{font-size:10px;font-weight:600;padding:2px 8px;border-radius:999px;background:var(--zacht);color:var(--grijs);}
.pbalk{display:flex;height:15px;border-radius:5px;overflow:hidden;background:var(--zacht);}
.seg{height:100%;}
.legenda{display:flex;flex-wrap:wrap;gap:12px;margin-top:12px;font-size:11px;color:var(--grijs);}
.legenda span{display:flex;align-items:center;gap:5px;}
.legenda i{width:10px;height:10px;border-radius:3px;}
.vgrid{display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px;text-align:center;}
.vc{background:var(--zacht);border-radius:11px;padding:16px 8px;}
.vc .g{font-family:'Barlow Condensed';font-weight:700;font-size:28px;color:var(--rood);}
.vc .l{font-size:11px;color:var(--grijs);margin-top:4px;}
.hm{width:100%;border-collapse:collapse;font-size:9px;}
.hm th{color:var(--grijs);font-weight:500;font-size:8px;height:14px;}
.hm .rl{text-align:right;padding-right:5px;color:var(--grijs);font-weight:600;font-size:10px;width:24px;}
.hm .hc{width:100%;height:16px;border-radius:2px;}
.voet{padding:18px 24px;background:var(--zacht);font-size:10.5px;color:var(--grijs);line-height:1.6;}
</style>`;

const CAT_KLEUR_R = { Trainingen:'#e2342f', Wedstrijden:'#2b6cb0', Spelers:'#3fb950', Media:'#d69e2e', Clubbeheer:'#a371f7', Overig:'#8b949e' };

function periodeTekst(stats){
  if (!stats.periodeVan || !stats.periodeTot) return '';
  const f = (d) => { const [j,m,dag]=d.split('-'); return `${+dag} ${['jan','feb','mrt','apr','mei','jun','jul','aug','sep','okt','nov','dec'][+m-1]}`; };
  return `${f(stats.periodeVan)} \u2013 ${f(stats.periodeTot)} ${stats.periodeTot.slice(0,4)} \u00b7 ${stats.dagenGemeten} dagen`;
}

function bouwRapportHtml(soort, stats){
  if (soort === 'wedstrijd') return rapportWedstrijd(stats);
  if (soort === 'tijd')      return rapportTijd(stats);
  return rapportTeams(stats);
}

function rapportTeams(stats){
  const teams = (stats.teams||[]).filter(t => t.teamId && t.naam!=='(geen team)' && !/test/i.test(t.naam));
  const maxSes = Math.max(1, ...teams.map(t=>t.ses));
  const actief = teams.slice().sort((a,b)=>b.ses-a.ses).map(t=>`
    <div class="balk"><div class="n">${escR(t.naam)}</div><div class="s"><div class="v" style="width:${Math.round(100*t.ses/maxSes)}%">${t.ses}\u00d7</div></div><div class="m">${t.coaches} coach${t.coaches===1?'':'es'}</div></div>`).join('');
  const profiel = teams.slice().sort((a,b)=>{
    const sa=Object.values(a.cat||{}).reduce((x,y)=>x+y,0),sb=Object.values(b.cat||{}).reduce((x,y)=>x+y,0);return sb-sa;
  }).map(t=>{
    const cat=t.cat||{}; const inh=['Trainingen','Wedstrijden','Spelers','Media','Clubbeheer','Overig'].reduce((a,k)=>a+(cat[k]||0),0)||1;
    const seg=(k)=>cat[k]>0?`<div class="seg" style="width:${100*cat[k]/inh}%;background:${CAT_KLEUR_R[k]}"></div>`:'';
    return `<div class="prij"><div class="pn">${escR(t.naam)} <span class="badge">${escR(t.profiel||'')}</span></div><div class="pbalk">${seg('Trainingen')}${seg('Wedstrijden')}${seg('Spelers')}${seg('Media')}${seg('Clubbeheer')}${seg('Overig')}</div></div>`;
  }).join('');
  const legenda=['Trainingen','Wedstrijden','Spelers','Media','Clubbeheer'].map(k=>`<span><i style="background:${CAT_KLEUR_R[k]}"></i>${k}</span>`).join('');
  const html = `<!DOCTYPE html><html lang="nl"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1">${RAPPORT_CSS}</head><body>
    <div class="kop"><div class="merk">Cluppie \u00b7 teamgebruik</div><h1>Hoe gebruikt elk team de app?</h1><div class="sub">Activiteit en tijdsbesteding per team.</div><div class="per">${periodeTekst(stats)}</div></div>
    <div class="kpis"><div class="kpi"><div class="g">${teams.length}</div><div class="l">actieve teams</div></div><div class="kpi"><div class="g">${stats.bron?.sessies||0}</div><div class="l">sessies</div></div><div class="kpi"><div class="g">${stats.bron?.coaches||0}</div><div class="l">coaches</div></div></div>
    <div class="sectie"><div class="eyebrow">Hoe actief</div><h2>Aantal keren de app geopend</h2><div class="lead">Per team, aflopend gesorteerd.</div>${actief}</div>
    <div class="sectie"><div class="eyebrow">Tijdsbesteding</div><h2>Waar besteedt elk team zijn tijd?</h2><div class="lead">De app buigt mee met hoe een team werkt.</div>${profiel}<div class="legenda">${legenda}</div></div>
    <div class="voet"><b>Over deze cijfers.</b> Anoniem gemeten schermgebruik (nooit spelergegevens). ${escR(periodeTekst(stats))}. Tijden zijn een voorzichtige ondergrens.</div>
    </body></html>`;
  return { html, titel:'Teamgebruik', bestand:'Cluppie-teamgebruik' };
}

function rapportWedstrijd(stats){
  const w = stats.wedstrijd||{};
  const fasen = [
    ['Opstelling maken', w.opstelling_n||0, '#e2342f'],
    ['Live tijdens de wedstrijd', w.live_n||0, '#7a1512'],
    ['Aanwezigheid vooraf', w.aanwezigheid_n||0, '#c77'],
  ];
  const maxF = Math.max(1, ...fasen.map(f=>f[1]));
  const fbars = fasen.map(([l,n,c])=>`<div class="balk"><div class="n">${l}</div><div class="s"><div class="v" style="width:${Math.round(100*n/maxF)}%;background:${c}">${n}\u00d7</div></div></div>`).join('');
  const dagN=['Ma','Di','Wo','Do','Vr','Za','Zo']; const ld=w.liveDag||new Array(7).fill(0); const maxLd=Math.max(1,...ld);
  const liveDag = dagN.map((d,i)=>`<div class="balk"><div class="n">${d}</div><div class="s"><div class="v" style="width:${Math.round(100*ld[i]/maxLd)}%">${ld[i]}</div></div></div>`).join('');
  const html = `<!DOCTYPE html><html lang="nl"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1">${RAPPORT_CSS}</head><body>
    <div class="kop"><div class="merk">Cluppie \u00b7 wedstrijden</div><h1>Van opstelling tot langs de lijn</h1><div class="sub">Gebruiken coaches de app alleen vooraf, of ook tijdens de wedstrijd?</div><div class="per">${periodeTekst(stats)}</div></div>
    <div class="kpis"><div class="kpi"><div class="g">${w.opstelling_n||0}</div><div class="l">opstellingen</div></div><div class="kpi"><div class="g">${w.live_n||0}</div><div class="l">keer live gevolgd</div></div><div class="kpi"><div class="g">${w.aanwezigheid_n||0}</div><div class="l">aanwezigheid vooraf</div></div></div>
    <div class="sectie"><div class="eyebrow">De wedstrijddag in fasen</div><h2>Waar zit het gebruik?</h2><div class="lead">Opstelling vooraf versus de app live erbij pakken.</div>${fbars}</div>
    <div class="sectie"><div class="eyebrow">Live-gebruik</div><h2>Op welke dag wordt live gevolgd?</h2><div class="lead">Het openen van de kwart-schermen, per weekdag.</div>${liveDag}</div>
    <div class="voet"><b>Over deze cijfers.</b> "Live" = een kwart-scherm werd geopend; dat valt in het weekend samen met de wedstrijden. Anoniem gemeten, ${escR(periodeTekst(stats))}.</div>
    </body></html>`;
  return { html, titel:'Wedstrijden', bestand:'Cluppie-wedstrijden' };
}

function rapportTijd(stats){
  const heat = heatmapMatrix(stats.heatmap);
  let maxCel=0; for(const r of heat) for(const v of r) if(v>maxCel)maxCel=v; maxCel=Math.max(1,maxCel);
  const dagN=['Ma','Di','Wo','Do','Vr','Za','Zo'];
  const uurKop=Array.from({length:24},(_,u)=>u%3===0?`<th>${u}</th>`:'<th></th>').join('');
  const rows=heat.map((r,i)=>{
    const cellen=r.map(v=>{const a=v===0?0:0.12+0.88*(v/maxCel);return `<td><div class="hc" style="background:rgba(226,52,47,${a.toFixed(2)})"></div></td>`;}).join('');
    return `<tr><td class="rl">${dagN[i]}</td>${cellen}</tr>`;
  }).join('');
  const vb=stats.voorbereiding||{}; const vTot=(vb.zelf||0)+(vb.dag1||0)+(vb.dag2||0)+(vb.dag3||0)+(vb.dag4plus||0)||1;
  const pct=n=>Math.round(100*(n||0)/vTot);
  const html = `<!DOCTYPE html><html lang="nl"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1">${RAPPORT_CSS}</head><body>
    <div class="kop"><div class="merk">Cluppie \u00b7 tijd-analyse</div><h1>Wanneer wordt de app gebruikt?</h1><div class="sub">Dag- en uurpatronen, Nederlandse tijd.</div><div class="per">${periodeTekst(stats)}</div></div>
    <div class="sectie"><div class="eyebrow">Voorbereiding</div><h2>Hoe lang vóór de training?</h2><div class="lead">Openen van het trainingsscherm t.o.v. de trainingsdag.</div>
      <div class="vgrid"><div class="vc"><div class="g">${pct(vb.zelf)}%</div><div class="l">op de dag zelf</div></div><div class="vc"><div class="g">${pct(vb.dag1)}%</div><div class="l">de dag ervoor</div></div><div class="vc"><div class="g">${pct((vb.dag2||0)+(vb.dag3||0)+(vb.dag4plus||0))}%</div><div class="l">2+ dagen vooruit</div></div></div></div>
    <div class="sectie"><div class="eyebrow">Heatmap</div><h2>Dag \u00d7 uur</h2><div class="lead">Donkerder = drukker.</div>
      <table class="hm"><tr><th class="rl"></th>${uurKop}</tr>${rows}</table></div>
    <div class="voet"><b>Methode.</b> Absoluut tijdstip = sessiestart + offset binnen de sessie, gecorrigeerd naar Nederlandse tijd. Anoniem, ${escR(periodeTekst(stats))}.</div>
    </body></html>`;
  return { html, titel:'Tijd-analyse', bestand:'Cluppie-tijd-analyse' };
}

// eigen esc voor de iframe-HTML (module-scope, los van state.js esc voor duidelijkheid)
function escR(s){ return String(s==null?'':s).replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
