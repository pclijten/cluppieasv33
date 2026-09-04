/* ==================== SPELERSPROFIEL (teams.js-modulaire split) ====================
   Onderdeel van de teams.js-modulaire split. Alles rond een individuele
   speler: het spelersoverzicht, het spelersprofiel (leerlijn, tijdlijn,
   ontwikkelbeoordelingen: snel + volledig), leerpunten, spelergegevens
   bewerken, én het uitlenen van een speler aan een ander team binnen de
   club (thematisch dezelfde "speler"-context, vandaar in één bestand). */
import {
  db, collection, doc, addDoc, deleteDoc, updateDoc, setDoc,
  getDoc, getDocs, query, where, serverTimestamp, documentId
} from './firebase.js?v=20260811a';
import {
  S, $, $$, esc, meld, datumNL, speler, uurMin, openModal, sluitModal, modAan, isBeheerder
} from './state.js?v=20260902d';
import {
  niveau, niveauKleur, NIVEAUS, SKILLS, skillDomein,
  LEERCURVE, leercurveRelevant, leercurveThema, snelTag, SNEL_TAGS,
  POSITIE_GROEPEN, SEIZOEN_FALLBACK, AFWEZIG_REDENEN, afwezigRedenInfo,
  wisselReden, isToernooi
} from './config.js?v=20260902d';
import { analyseWedstrijd, speeltijdReserve, disciplinaireTijd } from './analyse.js?v=20260902d';
import { ico } from './icons.js?v=20260825b';

import { toonThemaInfo } from './teams-leerlijn.js?v=20260902d';
import { telGebruik } from './tracker.js?v=20260902d';

/* Cross-module her-render: teams.js importeert functies van hieruit, dus
   deze module mag teams.js niet statisch terug-importeren (circulaire
   import). Dynamic import() binnen de aanroepende functie is het patroon
   dat de rest van de app ook al gebruikt (zie club.js/wedstrijd.js). */
async function herrenderTeam(){
  const m = await import('./teams.js?v=20260904a');
  m.renderTeam();
}

export function htmlSpelers(){
  // laatste snelle beoordeling per speler → kleurstip
  const laatsteSnel = {};
  for (const b of S.beoordelingen){
    if (b.soort !== 'snel') continue;
    if (!laatsteSnel[b.spelerId]) laatsteSnel[b.spelerId] = b;   // lijst is al op datum gesorteerd
  }
  const openLeerpunten = pid => ((speler(pid)?.leerpunten)||[]).filter(l => !l.klaar).length;
  const evalAan = modAan('evaluaties');

  return `
    ${evalAan ? `<div class="segment" id="spelersModus" style="margin-bottom:14px">
      <button data-modus="selectie" class="actief">Selectie</button>
      <button data-modus="snel">${ico('training-favorite', 15)} Snel beoordelen</button>
    </div>` : ''}

    <div class="avg-balk">
      <span class="slot">🔒</span>
      <span>Beoordelingen en leerpunten zijn alleen zichtbaar voor coaches van dit team. Spelers en ouders zien deze gegevens niet.</span>
    </div>

    <button class="knop vol licht" id="nieuweSpeler" style="margin-bottom:14px">+ Speler toevoegen</button>
    ${(() => {
      const eigen = S.spelers.filter(p => !p._ingeleend);
      const spelerRij = (p, ingeleend) => {
        const b = laatsteSnel[p.id];
        const stip = !evalAan ? ''
                   : b ? `<span class="beoordeel-stip" style="background:${niveauKleur(b.niveau)}" title="Laatste: ${esc(niveau(b.niveau)?.label||'')}"></span>`
                       : `<span class="beoordeel-stip leeg" title="Nog niet beoordeeld"></span>`;
        const lp = openLeerpunten(p.id);
        const heeftNotitie = !!(p.notitie && p.notitie.trim());
        const pos = meestGespeeldePositie(p);
        // Subregel onder de naam: herkomst (ingeleend), uitgeleend-aan, en/of
        // positie, subtiel grijs. Een uitgeleende speler blijft gewoon
        // opstelbaar bij ons — het label maakt alleen zichtbaar dat hij ook
        // elders speelt, zodat je dat zelf tegen de klok kan houden.
        const subDelen = [];
        if (ingeleend) subDelen.push(`ingeleend van ${esc(p._bronTeamNaam||'ander team')}`);
        if (p._uitgeleendAan) subDelen.push(`⇄ ook bij ${esc(p._uitgeleendAan)}`);
        if (pos) subDelen.push(esc(pos));
        const sub = subDelen.length
          ? `<div class="speler-sub">${subDelen.join(' · ')}</div>` : '';
        return `
        <button class="speler-rij" data-open-profiel="${p.id}">
          <div class="mini-shirt"${ingeleend?' style="background:var(--ink-2)"':''}>${esc(p.nummer ?? '·')}</div>
          <div class="n">${esc(p.naam)}${sub}</div>
          ${lp ? `<span class="chip-info">${lp} leerpunt${lp===1?'':'en'}</span>` : ''}
          ${heeftNotitie ? `<span class="notitie-vlag" title="Heeft een coach-notitie">!</span>` : ''}
          ${ingeleend ? `<span class="chip-info" style="background:rgba(53,196,122,.15);color:var(--ok)">ingeleend</span>` : ''}
          ${p._uitgeleendAan ? `<span class="chip-info" style="cursor:pointer" data-uitleen-terug="${p._leenIdUit}" title="Terughalen">⇄ terug</span>` : ''}
          ${stip}
          <span class="pijl">›</span>
        </button>`;
      };

      let h = eigen.length
        ? eigen.map(p => spelerRij(p, false)).join('')
        : `<div class="kaart leeg">Nog geen spelers.<br>Voeg je selectie toe — naam en rugnummer is genoeg.</div>`;

      // Ingeleende spelers (zonder gast-koppeling): draaien volwaardig mee.
      const in_ = S.spelers.filter(p => p._ingeleend && !p._gast);
      if (in_.length){
        h += `<div class="sectie-kop">⇄ Ingeleend</div>`;
        h += in_.map(p => spelerRij(p, true)).join('');
      }

      // Gastspelers: nog-te-koppelen placeholders + gekoppelde (echte) gasten.
      const gasten = S.spelers.filter(p => p._gast);
      if (gasten.length){
        h += `<div class="sectie-kop">👤 Gastspelers</div>`;
        h += gasten.map(g => {
          if (g._gekoppeld){
            return `<button class="speler-rij" data-open-profiel="${g.id}">
              <div class="mini-shirt" style="background:var(--ink-2)">${esc(g.nummer ?? '·')}</div>
              <div class="n">${esc(g.naam)}<div style="font-size:calc(11px * var(--fs));color:var(--ink-2);font-weight:400">gast · gekoppeld aan uitleen van ${esc(g._bronTeamNaam||'ander team')}</div></div>
              <span class="chip-info" style="background:rgba(53,196,122,.15);color:var(--ok)">ingeleend</span>
              <span class="pijl">›</span>
            </button>`;
          }
          return `<button class="speler-rij" data-open-profiel="${g.id}" style="border-style:dashed">
            <div class="mini-shirt" style="background:transparent;border:1px dashed var(--ink-2)">${esc(g.nummer ?? '?')}</div>
            <div class="n">${esc(g.naam)}<div style="font-size:calc(11px * var(--fs));color:var(--ink-2);font-weight:400">gast · nog te koppelen</div></div>
            <span class="chip-info" style="background:rgba(139,149,161,.15);color:var(--ink-2)">gast</span>
            <span class="pijl">›</span>
          </button>`;
        }).join('');
      }

      // Gast aanmaken — alleen zinvol binnen een club (uitleen bestaat dan).
      if (S.team?.club){
        h += `<button class="knop klein licht" id="nieuweGast" style="width:100%;margin-top:10px">+ Gastspeler aanmaken</button>`;
      }
      return h;
    })()}

    <p style="font-size:calc(12px * var(--fs));color:var(--ink-2);margin-top:12px;line-height:1.5">
      <span class="notitie-vlag inline">!</span> toont een coach-notitie. Het gekleurde stipje toont de laatste snelle beoordeling. Tik op een speler voor het volledige profiel met statistieken, leerlijn en historie.</p>`;
}

/* ==================== BEOORDELINGEN ====================
   Datamodel (Firestore: teams/{teamId}/beoordelingen/{id}):
     soort:    'snel' | 'volledig'
     spelerId, datum:'YYYY-MM-DD'
     bron:     {type:'wedstrijd'|'training'|'los', id, label}
     niveau:   1..5            (soort 'snel')
     tags:     ['inzet',...]   (soort 'snel')
     scores:   {T,I,P,S}       (soort 'volledig')
     notities: {algemeen} of {T,I,P,S}
     door:     {uid, naam}, gemaaktMs
   Leerpunten leven als array op het spelerdoc (lopen dóór over beoordelingen):
     {id, domein, tekst, sinds, klaar, klaarOp} */

/* Meest gespeelde positie voor de spelertegel. Telt over alle wedstrijden hoe
   vaak de speler op elke positie stond (uit spelerStats().posities, dat de
   specifieke positienamen bijhoudt) en kiest de vaakst voorkomende. Nog geen
   speelhistorie? Val terug op de ingestelde voorkeurspositie (p.positie). */
function meestGespeeldePositie(p){
  const pos = spelerStats(p.id).posities || {};
  let best = null, max = 0;
  for (const [naam, n] of Object.entries(pos)){
    if (n > max){ max = n; best = naam; }
  }
  return best || p.positie || null;
}

function spelerStats(pid){
  let wedstrijden = 0, tijd = 0, keeper = 0, goals = 0;
  const posities = {};
  for (const w of S.wedstrijden){
    for (const g of (w.goals||[])) if (g.type === 'voor' && g.pid === pid) goals++;
    const a = analyseWedstrijd(w);
    if (!a.kwarten) continue;
    if (a.tijd[pid]){ tijd += a.tijd[pid]; wedstrijden++; }
    if (a.keeper[pid]) keeper += a.keeper[pid];
    if (a.lijn[pid]) for (const [naam, n] of Object.entries(a.lijn[pid])) posities[naam] = (posities[naam]||0) + n;
  }
  const totTr = (S.presentie||[]).length;
  let aanwezig = 0;
  const afwPerReden = {}; // redenId -> aantal
  for (const sessie of (S.presentie||[])){
    const afw = (sessie.afwezig||[]).includes(pid);
    if (!afw){ aanwezig++; continue; }
    const rec = (sessie.afwezigRedenen||{})[pid];
    const info = rec ? afwezigRedenInfo(rec) : null;
    const id = info?.id || 'geen';
    afwPerReden[id] = (afwPerReden[id]||0) + 1;
  }
  const opkomst = totTr ? Math.round((aanwezig/totTr)*100) : null;
  // reserve/speelbaar + percentages over wedstrijden waarin de speler in de selectie zat
  const sr = speeltijdReserve(S.wedstrijden)[pid] || {speeltijd:0, reserve:0, speelbaar:0};
  const reserve = sr.reserve;
  const speelbaar = sr.speelbaar;
  const pctSpeeltijd = speelbaar > 0 ? Math.round((sr.speeltijd/speelbaar)*100) : null;
  const pctReserve   = pctSpeeltijd != null ? 100 - pctSpeeltijd : null;
  return {wedstrijden, tijd, keeper, goals, opkomst, totTr, afwPerReden, posities,
    reserve, speelbaar, pctSpeeltijd, pctReserve, disciplinair: sr.disciplinair||0};
}

/* Meest gespeelde posities voor een speler, aflopend gesorteerd: [{naam, n}, ...] */
function meestGespeeldePosities(pid){
  const posities = spelerStats(pid).posities;
  return Object.entries(posities)
    .map(([naam, n]) => ({naam, n}))
    .sort((a, b) => b.n - a.n);
}

function laatsteVolledig(pid){
  return S.beoordelingen.find(b => b.spelerId === pid && b.soort === 'volledig') || null;
}

function tipsBalk(score){
  let segs = '';
  for (let i = 1; i <= 5; i++)
    segs += `<div class="tips-seg" style="background:${i <= score ? niveauKleur(score) : 'rgba(255,255,255,.08)'}"></div>`;
  return `<div class="tips-track">${segs}</div>`;
}

/* ---------- Spelerprofiel ---------- */
/* Bepaalt voor één speler in één wedstrijd: speeltijd-label + eventuele
   wisselreden (inclusief vooraf ingestelde disciplinaire bankbeurt). Gebruikt
   in het spelersprofiel onder "Wedstrijden". */
function wisselInfoVoorSpeler(w, pid){
  const a = analyseWedstrijd(w);
  const disc = disciplinaireTijd(w)[pid] || 0;
  const gespeeld = a.tijd?.[pid] || 0;
  // percentage over de eerlijke (disciplinair-gecorrigeerde) noemer
  const speelbaar = a.matchduur ? Math.max(gespeeld, a.matchduur - Math.min(disc, Math.max(0, a.matchduur - gespeeld))) : 0;
  const pct = speelbaar > 0 ? Math.round((gespeeld / speelbaar) * 100) : null;

  // reden verzamelen: vooraf ingestelde bankbeurt of een wissel-event met reden
  let redenTekst = '';
  const sb = (w.startBankReden || {})[pid];
  const wisselEvents = [];
  for (const nr of Object.keys(w.kwarten || {})){
    for (const e of (w.kwarten[nr].events || []))
      if (e.uit === pid && (e.reden || e.disciplinair)) wisselEvents.push(e);
  }
  const disciplinair = sb?.disciplinair || wisselEvents.some(e => e.disciplinair);
  if (sb?.reden){
    const r = wisselReden(sb.reden);
    redenTekst = `${r?r.emoji+' '+r.label:''}${sb.disciplinair?' · disciplinaire reservebeurt':' · startte op de bank'}`;
  } else if (wisselEvents.length){
    const e = wisselEvents[wisselEvents.length-1];
    const r = e.reden ? wisselReden(e.reden) : null;
    redenTekst = `${r?r.emoji+' '+r.label+' gewisseld':'Gewisseld'}${e.disciplinair?' · disciplinaire reservebeurt':''}`;
  }

  let label, klasse;
  if (pct == null){ label = '—'; klasse = 'leeg'; }
  else if (disciplinair){ label = 'Straf'; klasse = 'straf'; }
  else if (pct >= 90){ label = pct+'%'; klasse = 'vol'; }
  else { label = pct+'%'; klasse = 'deel'; }
  return { label, klasse, reden: redenTekst ? esc(redenTekst) : '' };
}

export function htmlProfiel(){
  const p = speler(S._beoordeelProfiel);
  if (!p) { S._beoordeelProfiel = null; return htmlSpelers(); }

  // Niet-gekoppelde gastspeler: kaal placeholder-profiel met koppelactie.
  if (p._gast && !p._gekoppeld){
    const st = spelerStats(p.id);
    const koppelbaar = (S.uitleningenIn || []).filter(u => !u.adopteertGast);
    const lijn = p.nummer != null && p.nummer !== '' ? '#'+esc(p.nummer) : '';
    return `
      <button class="profiel-terug" id="profielTerug">‹ Terug naar spelers</button>
      <div class="profiel-top">
        <div class="pt-shirt" style="background:transparent;border:1px dashed var(--ink-2)">${esc(p.nummer ?? '?')}</div>
        <div><h2>${esc(p.naam)}</h2><div class="meta">${lijn?lijn+' · ':''}gastspeler · nog te koppelen</div></div>
      </div>
      <div class="leen-strook">
        <span class="ic">👤</span>
        <span class="tx">Placeholder voor een nog onbekende uitleen. Doet volwaardig mee in opstelling en presentie. Koppel hem zodra bekend is wie het wordt.</span>
      </div>
      <div class="stat-grid">
        <div class="stat-box"><div class="v">${st.wedstrijden}</div><div class="l">Wedstr.</div></div>
        <div class="stat-box"><div class="v">${st.tijd ? uurMin(st.tijd) : '—'}</div><div class="l">Speeltijd</div></div>
        <div class="stat-box"><div class="v">${st.goals}</div><div class="l">Goals</div></div>
        <div class="stat-box"><div class="v">${st.opkomst != null ? st.opkomst+'%' : '—'}</div><div class="l">Training</div></div>
      </div>
      <button class="knop vol" data-gast-koppel="${p.id}" style="margin-top:4px">🔗 Koppel aan ingeleende speler</button>
      <div class="rij" style="margin-top:8px">
        <button class="knop licht klein" data-gast-bewerk="${p.id}">${ico('admin-edit', 16)} Gast bewerken</button>
        <button class="knop gevaar klein" data-gast-weg="${p.id}">🗑 Verwijderen</button>
      </div>
      ${koppelbaar.length ? '' : `<p style="font-size:calc(12px * var(--fs));color:var(--ink-2);margin-top:12px;line-height:1.5">Er staat nog geen uitleen voor jou klaar om aan te koppelen. Zodra een ander team de speler naar jou uitleent, verschijnt die in de koppel-lijst.</p>`}
    `;
  }

  const leerlijnAan = modAan('leerlijn');
  const evalAan = modAan('evaluaties');
  // Leerlijn-module uit? Nooit op het Leerlijn-tabblad blijven staan.
  if (!leerlijnAan && S._profielTab === 'leerlijn') S._profielTab = 'overzicht';
  const tab = S._profielTab || 'overzicht';
  const st = spelerStats(p.id);
  const vol = laatsteVolledig(p.id);
  const eigen = S.beoordelingen.filter(b => b.spelerId === p.id);

  const lijn = p.nummer != null && p.nummer !== '' ? '#'+esc(p.nummer) : '';
  return `
    <button class="profiel-terug" id="profielTerug">‹ Terug naar spelers</button>
    <div class="profiel-top">
      <div class="pt-shirt"${p._ingeleend?' style="background:var(--ink-2)"':''}>${esc(p.nummer ?? '·')}</div>
      <div><h2>${esc(p.naam)}</h2><div class="meta">${lijn?lijn+' · ':''}${p._ingeleend?`ingeleend van ${esc(p._bronTeamNaam||'ander team')}`:esc(S.team.naam)}</div></div>
    </div>
    ${(() => {
      if (p._ingeleend){
        const gastNoot = p._gast ? ' Gekoppeld aan je gastspeler — je opstellingen bleven behouden.' : ' Doet volwaardig mee bij jou.';
        return `<div class="leen-strook in">
          <span class="ic">⇄</span>
          <span class="tx">Ingeleend van <b>${esc(p._bronTeamNaam||'ander team')}</b>.${gastNoot}</span>
          <button data-uitleen-terug="${p._leenId}">Terugzetten</button>
        </div>
        ${isBeheerder() ? `<button class="knop vol" style="margin-bottom:12px" data-uitleen-definitief="${p._leenId}">Definitief toevoegen aan ${esc(S.team.naam)}</button>` : ''}`;
      }
      const u = actieveUitleningVoor(p.id);
      if (!u) return '';
      return `<div class="leen-strook">
        <span class="ic">⇄</span>
        <span class="tx">Uitgeleend aan <b>${esc(u.naarTeamNaam)}</b></span>
        <button data-uitleen-terug="${u.id}">Terughalen</button>
      </div>`;
    })()}

    <div class="avg-balk"><span class="slot">🔒</span>
      <span>Coach-only. Deel niets uit dit profiel buiten het technisch kader.</span></div>

    <div class="segment" id="profielTabs" style="margin-bottom:14px">
      <button data-ptab="overzicht" class="${tab==='overzicht'?'actief':''}">Overzicht</button>
      ${leerlijnAan ? `<button data-ptab="leerlijn" class="${tab==='leerlijn'?'actief':''}">Leerlijn</button>` : ''}
      <button data-ptab="historie" class="${tab==='historie'?'actief':''}">Historie</button>
    </div>

    ${tab === 'overzicht' ? `
      <div class="stat-grid">
        <div class="stat-box"><div class="v">${st.wedstrijden}</div><div class="l">Wedstr.</div></div>
        <div class="stat-box"><div class="v">${st.tijd ? uurMin(st.tijd) : '—'}</div><div class="l">Speeltijd</div>${st.pctSpeeltijd!=null?`<div class="sub">${st.pctSpeeltijd}% van speelbaar</div>`:''}</div>
        <div class="stat-box"><div class="v">${st.reserve ? uurMin(st.reserve) : '—'}</div><div class="l">Reserve</div>${st.pctReserve!=null?`<div class="sub">${st.pctReserve}% van speelbaar</div>`:''}</div>
        <div class="stat-box"><div class="v">${st.goals}</div><div class="l">Goals</div></div>
      </div>
      ${st.pctSpeeltijd != null ? `
      <div class="kaart" style="margin-top:-2px">
        <div class="veldlabel" style="margin-top:0">Verhouding speeltijd / bank</div>
        <div class="speeltijd-split">
          <div class="veld" style="width:${st.pctSpeeltijd}%"></div>
          <div class="bank" style="width:${st.pctReserve}%"></div>
        </div>
        <div class="split-legend">
          <span><span class="dotje" style="background:var(--ok)"></span> Op het veld · ${uurMin(st.tijd)}</span>
          <span><span class="dotje" style="background:var(--warn)"></span> Reserve · ${uurMin(st.reserve)}</span>
        </div>
      </div>` : ''}
      ${Object.keys(st.afwPerReden||{}).length ? `
      <div class="presentie-uitsplitsing" style="margin:-6px 0 14px">
        ${Object.entries(st.afwPerReden).sort((a,b)=>b[1]-a[1]).map(([id,n]) => {
          if (id === 'geen') return `<span>❔ ${n}× zonder reden</span>`;
          const r = AFWEZIG_REDENEN.find(x => x.id === id) || {emoji:'❓',label:'Anders'};
          return `<span>${r.ico?ico(r.ico,15):r.emoji} ${n}× ${esc(r.label.toLowerCase())}</span>`;
        }).join('')}
      </div>` : ''}

      ${(() => {
        const notitie = (p.notitie || '').trim();
        return `<div class="notitie-kaart${notitie ? '' : ' leeg'}">
          <div class="notitie-kop">
            <div class="veldlabel" style="margin:0">Notitie</div>
            <button class="notitie-bewerk" data-notitie="${p.id}" aria-label="${notitie ? 'Notitie bewerken' : 'Notitie toevoegen'}">
              ${notitie ? ico('admin-edit', 18) : ico('action-add', 18)}
            </button>
          </div>
          ${notitie
            ? `<div class="notitie-tekst">${esc(notitie)}</div>`
            : `<div class="notitie-leeg-tekst">Nog geen notitie. Bijzonderheden, afspraken of aandachtspunten voor deze speler.</div>`}
        </div>`;
      })()}

      ${evalAan ? `<div class="kaart">
        <div class="veldlabel" style="margin-top:0">Ontwikkelprofiel${vol ? ` · ${datumNL(vol.datum)}` : ''}</div>
        ${vol ? SKILLS.map(d => `
          <div class="tips-rij">
            <div class="tips-letter">${d.id}</div>
            <div class="tips-naam">${d.naam}</div>
            ${tipsBalk(vol.scores?.[d.id] || 0)}
            <div class="tips-score">${vol.scores?.[d.id] || '—'}</div>
          </div>`).join('')
        : `<p style="font-size:calc(13px * var(--fs));color:var(--ink-2);padding:6px 0">Nog geen volledige beoordeling. Maak er één om het ontwikkelprofiel te zien.</p>`}
      </div>

      <div class="fab-rij">
        <button class="knop fluo klein" style="flex:1" data-snel-speler="${p.id}">${ico('training-favorite', 17)} Snel beoordelen</button>
        <button class="knop klein" style="flex:1" data-volledig-speler="${p.id}">${ico('training-completed', 17)} Volledige beoordeling</button>
      </div>` : ''}

      <div class="rij" style="margin-top:4px">
        ${p._ingeleend
          ? `<button class="knop licht klein" data-leen-overlay="${p.id}">${ico('admin-edit', 16)} Nummer/positie bij jou</button>`
          : `<button class="knop licht klein" data-bewerk-speler="${p.id}">${ico('admin-edit', 16)} Speler bewerken</button>
             <button class="knop gevaar klein" data-weg-speler="${p.id}">🗑 Verwijderen</button>`}
      </div>
      ${(!p._ingeleend && S.team?.club) ? `<button class="knop klein" style="margin-top:4px;width:100%" data-uitleen-speler="${p.id}">⇄ Uitlenen aan ander team</button>` : ''}
    ` : ''}

    ${tab === 'leerlijn' ? htmlLeerlijn(p) : ''}

    ${tab === 'historie' ? `
      ${evalAan ? `<div class="kaart">
        <div class="veldlabel" style="margin-top:0">Tijdlijn</div>
        ${eigen.length ? eigen.map(b => htmlTijdlijnItem(b)).join('')
          : `<p style="font-size:calc(13px * var(--fs));color:var(--ink-2);padding:6px 0">Nog geen beoordelingen vastgelegd.</p>`}
      </div>` : ''}
      <div class="kaart">
        <div class="veldlabel" style="margin-top:0">Wedstrijden</div>
        ${(() => {
          const weds = (S.wedstrijden||[])
            .filter(w => (w.selectie||[]).includes(p.id))
            .sort((a,b) => (b.datum||'').localeCompare(a.datum||''));
          if (!weds.length) return `<p style="font-size:calc(13px * var(--fs));color:var(--ink-2);padding:6px 0">Nog geen wedstrijden.</p>`;
          return weds.map(w => {
            const info = wisselInfoVoorSpeler(w, p.id);
            const teg = w.tegenstander || (isToernooi(w) ? 'Toernooi' : 'Wedstrijd');
            return `<div class="wed-hist-rij">
              <span class="whr-datum">${datumNL(w.datum)}</span>
              <div class="whr-mid">
                <div class="whr-teg">${esc(teg)}</div>
                ${info.reden ? `<div class="whr-reden">${info.reden}</div>` : ''}
              </div>
              <span class="whr-status ${info.klasse}">${info.label}</span>
            </div>`;
          }).join('');
        })()}
      </div>
      <div class="kaart">
        <div class="veldlabel" style="margin-top:0">Presentie training</div>
        ${S.presentie.length ? S.presentie.map(ses => {
          const afw = (ses.afwezig||[]).includes(p.id);
          const reden = (ses.afwezigRedenen||{})[p.id];
          const info = afw && reden ? afwezigRedenInfo(reden) : null;
          const statusTxt = !afw ? 'Aanwezig'
            : info ? `${info.emoji} ${info.label}${info.notitie ? ' · '+esc(info.notitie) : ''}`
            : '❔ Zonder reden';
          return `<div class="presentie-hist-rij"><span>${datumNL(ses.datum)}</span><span class="phr-status ${afw?'afw':'aanw'}">${statusTxt}</span></div>`;
        }).join('') : `<p style="font-size:calc(13px * var(--fs));color:var(--ink-2);padding:6px 0">Nog geen presentie geregistreerd.</p>`}
      </div>` : ''}`;
}

function htmlLeerlijn(p){
  const lp = (p.leerpunten || []).slice().sort((a,b) => (a.klaar?1:0)-(b.klaar?1:0) || (b.sinds||'').localeCompare(a.sinds||''));
  return `
    <div class="kaart">
      <div class="veldlabel" style="margin-top:0">Leerpunten</div>
      ${lp.length ? lp.map(l => {
        const d = skillDomein(l.domein);
        const thema = leercurveThema(l.tekst);
        return `
        <div class="leerpunt ${l.klaar?'klaar':''}">
          <button class="lp-check ${l.klaar?'klaar':''}" data-lp-toggle="${l.id}">${l.klaar?'✓':''}</button>
          <div class="lp-tekst">
            <div class="lp-domein">${d ? esc(d.naam) : 'Algemeen'}</div>
            <div class="t">${esc(l.tekst)}</div>
            <div class="d">${l.klaar ? 'Afgerond op '+datumNL(l.klaarOp||l.sinds)+' 🎉' : 'Sinds '+datumNL(l.sinds)}</div>
            ${thema ? `<div style="font-size:calc(11px * var(--fs));color:var(--accent);font-weight:700;margin-top:3px;cursor:pointer" data-thema-info="${esc(thema.thema)}">ℹ️ Achtergrond &amp; tips bekijken</div>` : ''}
          </div>
          <button class="lp-weg" data-lp-weg="${l.id}" title="Verwijderen">🗑</button>
        </div>`;
      }).join('')
      : `<p style="font-size:calc(13px * var(--fs));color:var(--ink-2);padding:6px 0 10px">Nog geen leerpunten. Voeg een concreet, observeerbaar ontwikkeldoel toe.</p>`}
      <button class="knop licht klein" style="width:100%;margin-top:6px" data-lp-nieuw="${p.id}">+ Leerpunt toevoegen</button>
    </div>
    <p style="font-size:calc(12px * var(--fs));color:var(--ink-2);line-height:1.5">Leerpunten lopen door over meerdere wedstrijden en beoordelingen. Vink ze af zodra ze beheerst zijn.</p>`;
}

function htmlTijdlijnItem(b){
  if (b.soort === 'snel'){
    const nv = niveau(b.niveau);
    const tags = (b.tags||[]).map(t => { const s = snelTag(t); return s ? s.emoji+' '+s.label : ''; }).filter(Boolean).join(' · ');
    const not = b.notities?.algemeen ? ` — "${esc(b.notities.algemeen)}"` : '';
    return `
      <div class="tijdlijn-item" data-open-beoordeling="${b.id}">
        <div class="tl-stip" style="background:${niveauKleur(b.niveau)}"></div>
        <div class="tl-lijn">
          <div class="dat">${datumNL(b.datum)} · Snelle beoordeling</div>
          <div class="wat">${esc(b.bron?.label || 'Los')}${nv ? ' · '+nv.label : ''}</div>
          ${tags || not ? `<div class="det">${tags}${not}</div>` : ''}
        </div>
      </div>`;
  }
  const scores = SKILLS.map(d => d.id+(b.scores?.[d.id]||'–')).join(' · ');
  return `
    <div class="tijdlijn-item" data-open-beoordeling="${b.id}">
      <div class="tl-stip" style="background:var(--n5)"></div>
      <div class="tl-lijn">
        <div class="dat">${datumNL(b.datum)} · Volledige beoordeling</div>
        <div class="wat">${esc(b.bron?.label || 'Periodieke meting')}</div>
        <div class="det">${scores}</div>
      </div>
    </div>`;
}


function bronOpties(){
  const opts = [];
  for (const w of S.wedstrijden.slice(0, 8)){
    const tit = w.type === 'toernooi' ? '🏆 '+(w.tegenstander||'Toernooi')
      : (w.thuis ? S.team.naam+' – '+w.tegenstander : w.tegenstander+' – '+S.team.naam);
    opts.push({type:'wedstrijd', id:w.id, datum:w.datum, label:tit});
  }
  for (const t of (S.presentie||[]).slice(0, 8)){
    opts.push({type:'training', id:t.id, datum:t.datum, label:'Training '+datumNL(t.datum)});
  }
  opts.sort((a,b) => (b.datum||'').localeCompare(a.datum||''));
  return opts;
}

function vandaagISO(){ return new Date().toISOString().slice(0,10); }
function deelnemer(){ return {uid:S.user.uid, naam:(S.team.ledenInfo?.[S.user.uid]?.naam)||S.user.displayName||S.user.email||''}; }

/* --- Snelle beoordeling (één speler) --- */
export function modalSnelBeoordeling(spelerId, bestaande = null){
  if (!modAan('evaluaties')) return meld('Evaluaties staan uit voor dit team');
  const p = speler(spelerId); if (!p) return;
  const opts = bronOpties();
  let gekozenNiveau = bestaande?.niveau || 0;
  let gekozenTags = new Set(bestaande?.tags || []);
  // standaard bron: bestaande bron, anders meest recente wedstrijd/training, anders los
  let bronType = bestaande?.bron?.type || (opts[0]?.type || 'los');
  let bronId   = bestaande?.bron?.id   || (opts[0]?.id || '');

  const bronSelect = () => {
    const lijst = opts.filter(o => o.type === bronType);
    return lijst.length
      ? `<select class="invoer" id="mSnBron">${lijst.map(o =>
          `<option value="${o.id}" ${o.id===bronId?'selected':''}>${esc(o.label)} · ${datumNL(o.datum)}</option>`).join('')}</select>`
      : `<p style="font-size:calc(12.5px * var(--fs));color:var(--ink-2);padding:4px 0">Geen ${bronType==='wedstrijd'?'wedstrijden':'trainingen'} gevonden — kies "Los".</p>`;
  };

  const kleurbalk = () => `<div class="kleurbalk" id="mSnNiveau">${NIVEAUS.slice(1).map(n =>
    `<button data-niv="${n.n}" class="kn${n.n} ${gekozenNiveau===n.n?'gekozen':''}"><span class="lbl">${n.label.toUpperCase()}</span></button>`).join('')}</div>`;

  const tagRij = () => `<div class="tag-rij" id="mSnTags">${SNEL_TAGS.map(t =>
    `<button class="tag ${gekozenTags.has(t.id)?'aan':''}" data-tag="${t.id}">${t.ico?ico(t.ico,16):t.emoji} ${t.label}</button>`).join('')}</div>`;

  const rondeVoortgang = () => {
    const r = S._snelRonde; if (!r) return '';
    const totaal = r.ids.length, positie = r.index + 1, gedaan = r.index, teGaan = totaal - positie;
    const seg = r.ids.map((id,i) => {
      const kl = i < gedaan ? (r.overgeslagen && r.overgeslagen.has(id) ? 'oversla' : 'gedaan')
        : i === r.index ? 'nu' : '';
      return `<span class="rv-seg ${kl}"></span>`;
    }).join('');
    return `<div class="ronde-voortgang">
      <div class="rv-top">
        <div class="rv-teller"><b>${positie}</b> / ${totaal} spelers</div>
        <div class="rv-klaar">${teGaan > 0 ? 'nog '+teGaan+' te gaan' : 'laatste speler'}</div>
      </div>
      <div class="rv-track">${seg}</div>
    </div>`;
  };

  openModal(`
    <h2>Snel beoordelen</h2>
    <div class="snel-kop">
      <div class="mini-shirt">${esc(p.nummer ?? '·')}</div>
      <div><div class="nm">${esc(p.naam)}</div><div class="pos" id="mSnPos"></div></div>
    </div>
    ${rondeVoortgang()}

    <div class="veldlabel">Koppelen aan</div>
    <div class="segment klein-seg" id="mSnBronType">
      <button data-bt="wedstrijd" class="${bronType==='wedstrijd'?'actief':''}">Wedstrijd</button>
      <button data-bt="training" class="${bronType==='training'?'actief':''}">Training</button>
      <button data-bt="los" class="${bronType==='los'?'actief':''}">Los</button>
    </div>
    <div id="mSnBronWrap" style="margin-bottom:4px">${bronType==='los'?'':bronSelect()}</div>

    <div class="veldlabel">Hoe ging het?</div>
    ${kleurbalk()}

    <div class="veldlabel">Opvallend (optioneel)</div>
    ${tagRij()}

    <div class="veldlabel">Korte notitie (optioneel)</div>
    <textarea class="invoer" id="mSnNotitie" rows="2" placeholder="Bijv. durfde aan de bal te komen...">${esc(bestaande?.notities?.algemeen||'')}</textarea>

    <button class="knop vol fluo" id="mSnOk" style="margin-top:12px">${bestaande?'Bijwerken':'Opslaan'}</button>
    ${S._snelRonde ? `<button class="knop licht vol" id="mSnSkip" style="margin-top:8px">Speler overslaan (niet aanwezig) →</button>` : ''}
    ${bestaande?`<button class="knop vol gevaar" id="mSnWeg" style="margin-top:8px">Verwijderen</button>`:''}`);

  const updatePos = () => {
    const o = opts.find(x => x.id === bronId && x.type === bronType);
    $('#mSnPos').textContent = bronType==='los' ? 'Losse beoordeling' : (o ? o.label : '');
  };
  const koppelBron = () => {
    $('#mSnBronWrap').innerHTML = bronType==='los' ? '' : bronSelect();
    const sel = $('#mSnBron');
    if (sel){ bronId = sel.value; sel.onchange = () => { bronId = sel.value; updatePos(); }; }
    else bronId = '';
    updatePos();
  };
  $$('#mSnBronType [data-bt]').forEach(b => b.onclick = () => {
    bronType = b.dataset.bt;
    $$('#mSnBronType [data-bt]').forEach(x => x.classList.toggle('actief', x===b));
    koppelBron();
  });
  $$('#mSnNiveau [data-niv]').forEach(b => b.onclick = () => {
    gekozenNiveau = Number(b.dataset.niv);
    $$('#mSnNiveau [data-niv]').forEach(x => x.classList.toggle('gekozen', x===b));
  });
  $$('#mSnTags [data-tag]').forEach(b => b.onclick = () => {
    const id = b.dataset.tag;
    if (gekozenTags.has(id)) gekozenTags.delete(id); else gekozenTags.add(id);
    b.classList.toggle('aan');
  });
  koppelBron();

  $('#mSnOk').onclick = async () => {
    if (!gekozenNiveau) return meld('Kies een niveau');
    const o = opts.find(x => x.id === bronId && x.type === bronType);
    const bron = bronType==='los' ? {type:'los'} : (o ? {type:bronType, id:o.id, label:o.label} : {type:'los'});
    const datum = o?.datum || vandaagISO();
    const data = {
      soort:'snel', spelerId, datum, bron, niveau:gekozenNiveau,
      tags:[...gekozenTags], notities:{algemeen:$('#mSnNotitie').value.trim()},
      door:deelnemer(), gemaaktMs:Date.now(),
    };
    if (!bestaande) data.seizoen = S.huidigSeizoen || SEIZOEN_FALLBACK;
    try {
      if (bestaande) await updateDoc(doc(db,'teams',S.teamId,'beoordelingen',bestaande.id), data);
      else { await addDoc(collection(db,'teams',S.teamId,'beoordelingen'), data); telGebruik('snel_beoordeling'); }
      sluitModal();
      if (S._snelRonde) volgendeSnelRonde(); else { herrenderTeam(); meld(p.naam+' beoordeeld'); }
    } catch(e){ meld('Opslaan mislukt: '+(e.code||e.message)); }
  };
  const wegBtn = $('#mSnWeg');
  if (wegBtn) wegBtn.onclick = async () => {
    if (!confirm('Deze beoordeling verwijderen?')) return;
    await deleteDoc(doc(db,'teams',S.teamId,'beoordelingen',bestaande.id));
    sluitModal(); herrenderTeam();
  };
  const skipBtn = $('#mSnSkip');
  if (skipBtn) skipBtn.onclick = () => {
    if (S._snelRonde){ (S._snelRonde.overgeslagen ||= new Set()).add(spelerId); }
    sluitModal(); volgendeSnelRonde();
  };
}

/* ---------- Snelle beoordelingsronde (alle spelers achter elkaar) ---------- */
export function startSnelRonde(){
  if (!modAan('evaluaties')) return meld('Evaluaties staan uit voor dit team');
  if (!S.spelers.length) return meld('Voeg eerst spelers toe');
  S._snelRonde = {index:0, ids:S.spelers.map(p => p.id), overgeslagen:new Set()};
  telGebruik('snel_ronde');
  modalSnelBeoordeling(S._snelRonde.ids[0]);
}
function volgendeSnelRonde(){
  const r = S._snelRonde; if (!r) return;
  r.index++;
  if (r.index >= r.ids.length){ S._snelRonde = null; herrenderTeam(); meld('Ronde klaar ✓'); return; }
  modalSnelBeoordeling(r.ids[r.index]);
}

/* --- Volledige beoordeling (5 ontwikkeldomeinen) --- */

export function modalVolledigeBeoordeling(spelerId, bestaande = null){
  if (!modAan('evaluaties')) return meld('Evaluaties staan uit voor dit team');
  const p = speler(spelerId); if (!p) return;
  const scores = {...(bestaande?.scores || {})};
  const notities = {...(bestaande?.notities || {})};
  const moment = bestaande?.bron?.label || '';

  const domeinKaart = (d) => `
    <div class="kaart">
      <div class="veldlabel" style="margin-top:0">${d.id} · ${d.naam}</div>
      <p style="font-size:calc(11.5px * var(--fs));color:var(--ink-2);margin:-2px 0 4px">${esc(d.omschrijving)}</p>
      <div class="kleurbalk dom" data-dom="${d.id}">${NIVEAUS.slice(1).map(n =>
        `<button data-niv="${n.n}" class="kn${n.n} ${scores[d.id]===n.n?'gekozen':''}"><span class="lbl">${n.kort}</span></button>`).join('')}</div>
      <textarea class="invoer" data-not="${d.id}" rows="2" placeholder="Toelichting ${d.naam.toLowerCase()}...">${esc(notities[d.id]||'')}</textarea>
    </div>`;

  openModal(`
    <h2>Volledige beoordeling</h2>
    <p style="font-size:calc(13px * var(--fs));color:var(--ink-2);margin-bottom:10px">${esc(p.naam)}${p.nummer!=null&&p.nummer!==''?' · #'+esc(p.nummer):''}</p>
    <div class="veldgroep"><label>Moment</label>
      <input class="invoer" id="mVbMoment" value="${esc(moment)}" placeholder="Bijv. Kwartaalmeting Q3"></div>
    ${SKILLS.map(domeinKaart).join('')}
    <button class="knop vol fluo" id="mVbOk" style="margin-top:6px">${bestaande?'Bijwerken':'Beoordeling opslaan'}</button>
    ${bestaande?`<button class="knop vol gevaar" id="mVbWeg" style="margin-top:8px">Verwijderen</button>`:''}
    <p style="font-size:calc(11.5px * var(--fs));color:var(--ink-2);margin-top:10px;line-height:1.45">Tip: leerpunten beheer je in het tabblad <b>Leerlijn</b> van de speler — die lopen door over meerdere beoordelingen.</p>`);

  $$('.kleurbalk.dom').forEach(balk => {
    const dom = balk.dataset.dom;
    balk.querySelectorAll('[data-niv]').forEach(b => b.onclick = () => {
      scores[dom] = Number(b.dataset.niv);
      balk.querySelectorAll('[data-niv]').forEach(x => x.classList.toggle('gekozen', x===b));
    });
  });

  $('#mVbOk').onclick = async () => {
    if (!Object.keys(scores).length) return meld('Geef minstens één score');
    SKILLS.forEach(d => { const t = $(`[data-not="${d.id}"]`); if (t) notities[d.id] = t.value.trim(); });
    const data = {
      soort:'volledig', spelerId, datum:bestaande?.datum || vandaagISO(),
      bron:{type:'los', label:$('#mVbMoment').value.trim() || 'Periodieke meting'},
      scores, notities, door:deelnemer(), gemaaktMs:Date.now(),
    };
    if (!bestaande) data.seizoen = S.huidigSeizoen || SEIZOEN_FALLBACK;
    try {
      if (bestaande) await updateDoc(doc(db,'teams',S.teamId,'beoordelingen',bestaande.id), data);
      else { await addDoc(collection(db,'teams',S.teamId,'beoordelingen'), data); telGebruik('volledige_beoordeling'); }
      sluitModal(); herrenderTeam(); meld('Beoordeling opgeslagen');
    } catch(e){ meld('Opslaan mislukt: '+(e.code||e.message)); }
  };
  const wegBtn = $('#mVbWeg');
  if (wegBtn) wegBtn.onclick = async () => {
    if (!confirm('Deze beoordeling verwijderen?')) return;
    await deleteDoc(doc(db,'teams',S.teamId,'beoordelingen',bestaande.id));
    sluitModal(); herrenderTeam();
  };
}

/* --- Leerpunten (array op spelerdoc) --- */
export function modalLeerpunt(spelerId, voorlopigeTekst = ''){
  const p = speler(spelerId); if (!p) return;
  const cat = S.team.categorie || '';
  let domein = 'TA';
  // leercurve: relevante thema's eerst, daarna de overige (altijd zichtbaar)
  const themas = LEERCURVE
    .map(t => ({...t, rel: leercurveRelevant(t, cat)}))
    .sort((a,b) => (b.rel?1:0)-(a.rel?1:0));

  openModal(`
    <h2>Leerpunt toevoegen</h2>
    <p style="font-size:calc(13px * var(--fs));color:var(--ink-2);margin-bottom:10px">Formuleer een concreet, observeerbaar doel voor ${esc(p.naam)}. Kies een thema uit de leerlijn of schrijf je eigen leerpunt.</p>

    <div class="veldlabel">Uit de leerlijn${cat?` · ${esc(cat)}`:''}</div>
    <div class="leercurve-keuze" id="mLpCurve">
      ${themas.map(t => {
        const d = skillDomein(t.domein);
        return `<button class="lc-thema ${t.rel?'rel':''}" data-thema="${esc(t.thema)}" data-dom="${t.domein}" title="${esc(d?.naam||'')}${t.rel?'':' · vanaf O'+t.vanaf}">
          <span class="lc-dot" style="background:${t.rel?'var(--n5)':'var(--line-d)'}"></span>${esc(t.thema)}<span data-thema-info="${esc(t.thema)}" title="Achtergrond en tips" style="display:inline-flex;align-items:center;justify-content:center;width:16px;height:16px;border-radius:50%;background:rgba(255,255,255,.15);font-size:calc(10px * var(--fs));font-weight:700;margin-left:1px">ℹ</span></button>`;
      }).join('')}
    </div>
    <p style="font-size:calc(11px * var(--fs));color:var(--ink-2);margin:2px 0 12px">🟢 = hoort bij deze leeftijd volgens het jeugdbeleidsplan. Tik ℹ voor achtergrond en oefentips.</p>

    <div class="veldlabel">Domein</div>
    <div class="dom-kiezer" id="mLpDom">${SKILLS.map(d =>
      `<button data-d="${d.id}" class="${d.id==='TA'?'actief':''}" title="${esc(d.naam)}"><span class="dk-emoji">${d.ico?ico(d.ico,18):(d.emoji||'')}</span>${esc(d.kort||d.naam)}</button>`).join('')}</div>
    <p style="font-size:calc(11px * var(--fs));color:var(--ink-2);line-height:1.5;margin:6px 0 12px">Techniek · Tactiek · Fysiek · Mentaal · Gedrag &amp; beleving — de vijf ontwikkeldomeinen uit het jeugdbeleidsplan.</p>

    <div class="veldgroep"><label>Leerpunt</label>
      <textarea class="invoer" id="mLpTekst" rows="3" placeholder="Bijv. eerder het hoofd omhoog vóór de aanname">${esc(voorlopigeTekst)}</textarea></div>
    <button class="knop vol fluo" id="mLpOk">Toevoegen</button>`);

  const zetDomein = (d) => { domein = d; $$('#mLpDom [data-d]').forEach(x => x.classList.toggle('actief', x.dataset.d===d)); };
  $$('#mLpDom [data-d]').forEach(b => b.onclick = () => zetDomein(b.dataset.d));
  $$('#mLpCurve [data-thema]').forEach(b => b.onclick = () => {
    $('#mLpTekst').value = b.dataset.thema;
    zetDomein(b.dataset.dom);
    $$('#mLpCurve .lc-thema').forEach(x => x.classList.toggle('gekozen', x===b));
  });
  $$('#mLpCurve [data-thema-info]').forEach(el => el.addEventListener('click', (e) => {
    e.stopPropagation();
    const behouden = $('#mLpTekst').value;
    toonThemaInfo(el.dataset.themaInfo, () => modalLeerpunt(spelerId, behouden));
  }));
  $('#mLpTekst').focus();
  $('#mLpOk').onclick = async () => {
    const tekst = $('#mLpTekst').value.trim();
    if (tekst.length < 3) return meld('Vul een leerpunt in');
    const nieuw = {id:'lp_'+Date.now().toString(36), domein, tekst, sinds:vandaagISO(), klaar:false};
    const lp = [...(p.leerpunten||[]), nieuw];
    try {
      await updateDoc(doc(db,'teams',S.teamId,'spelers',spelerId), {leerpunten: lp});
      telGebruik('leerpunt_nieuw');
      sluitModal(); herrenderTeam(); meld('Leerpunt toegevoegd');
    } catch(e){ meld('Opslaan mislukt: '+(e.code||e.message)); }
  };
}
export async function toggleLeerpunt(lpId){
  const p = speler(S._beoordeelProfiel); if (!p) return;
  const doel = (p.leerpunten||[]).find(l => l.id === lpId);
  const wordtKlaar = doel && !doel.klaar;
  const lp = (p.leerpunten||[]).map(l => l.id === lpId
    ? {...l, klaar:!l.klaar, klaarOp: !l.klaar ? vandaagISO() : null} : l);
  await updateDoc(doc(db,'teams',S.teamId,'spelers',p.id), {leerpunten: lp});
  if (wordtKlaar) telGebruik('leerpunt_klaar');
}
export async function verwijderLeerpunt(lpId){
  const p = speler(S._beoordeelProfiel); if (!p) return;
  if (!confirm('Dit leerpunt verwijderen?')) return;
  const lp = (p.leerpunten||[]).filter(l => l.id !== lpId);
  await updateDoc(doc(db,'teams',S.teamId,'spelers',p.id), {leerpunten: lp});
}

function meestGespeeldHtml(top){
  if (!top.length) return '';
  const beste = top[0];
  return `
    <div class="meest-gespeeld" id="mSpMg">
      <div class="mg-titel">⚽ Meest gespeeld dit seizoen</div>
      <div class="mg-lijst">
        ${top.slice(0,4).map((t,i) => `<span class="mg-item${i===0?' mg-top':''}">${esc(t.naam)} <b>${t.n}×</b></span>`).join('')}
      </div>
      <button type="button" class="mg-knop" id="mSpMgOk" data-pos="${esc(beste.naam)}">Overnemen: ${esc(beste.naam)}</button>
    </div>`;
}

export function modalSpeler(p){
  const bewerken = !!p;
  let gekozenPositie = p?.positie || '';
  const topPosities = bewerken ? meestGespeeldePosities(p.id) : [];
  openModal(`
    <h2>${bewerken ? 'Speler bewerken' : 'Speler toevoegen'}</h2>
    <div class="rij">
      <div class="veldgroep" style="flex:3"><label>Voornaam</label>
        <input class="invoer" id="mSpNaam" value="${esc(p?.naam||'')}" placeholder="Voornaam" autocomplete="off"></div>
      <div class="veldgroep" style="flex:1"><label>Nr.</label>
        <input class="invoer" id="mSpNr" value="${esc(p?.nummer ?? '')}" inputmode="numeric" placeholder="7"></div>
    </div>
    <div class="veldgroep"><label>Achternaam</label>
      <input class="invoer" id="mSpAchter" value="${esc(p?.achternaam||'')}" placeholder="Achternaam" autocomplete="off"></div>
    <div class="avg-balk"><span class="slot">🔒</span>
      <span>De achternaam blijft binnen je eigen team en wordt nergens in de app getoond. Leen je deze speler uit, dan ziet de andere coach alleen de voorletter.</span></div>
    ${bewerken ? `
      <div class="veldgroep">
        <label>Voorkeurspositie</label>
        ${meestGespeeldHtml(topPosities)}
        <div id="mSpPos">
          ${POSITIE_GROEPEN.map(g => `
            <div class="pos-groep">
              <div class="pos-lijnlabel">${esc(g.naam)}</div>
              <div class="segment klein-seg wrap">
                ${g.posities.map(pos => `<button type="button" data-pos="${esc(pos)}" class="${gekozenPositie===pos?'actief':''}">${esc(pos)}</button>`).join('')}
              </div>
            </div>`).join('')}
        </div>
      </div>` : ''}
    <button class="knop vol" id="mSpOk">${bewerken ? 'Opslaan' : 'Toevoegen'}</button>`);

  if (bewerken){
    const zetPositie = (pos) => {
      gekozenPositie = pos;
      $('#mSpPos').querySelectorAll('[data-pos]').forEach(x =>
        x.classList.toggle('actief', x.dataset.pos === gekozenPositie));
    };
    $('#mSpPos').querySelectorAll('[data-pos]').forEach(b => b.onclick = () => {
      zetPositie(gekozenPositie === b.dataset.pos ? '' : b.dataset.pos);   // nogmaals tikken = leegmaken
    });
    if ($('#mSpMgOk')) $('#mSpMgOk').onclick = () => zetPositie($('#mSpMgOk').dataset.pos);
  }

  const ok = async (sluiten) => {
    const naam = $('#mSpNaam').value.trim();
    if (!naam) return meld('Vul een naam in');
    const nr = $('#mSpNr').value.trim();
    const data = {
      naam,
      achternaam: $('#mSpAchter').value.trim() || null,
      nummer: nr === '' ? null : Number(nr),
    };
    if (bewerken) data.positie = gekozenPositie || null;
    if (p){ await updateDoc(doc(db,'teams',S.teamId,'spelers',p.id), data); telGebruik('speler_bewerken'); }
    else  { await addDoc(collection(db,'teams',S.teamId,'spelers'), data); telGebruik('speler_nieuw'); }
    if (sluiten) sluitModal();
    else { $('#mSpNaam').value=''; $('#mSpNr').value=''; $('#mSpAchter').value=''; $('#mSpNaam').focus(); meld(naam+' toegevoegd'); }
  };
  $('#mSpOk').onclick = () => ok(bewerken);
  const enterAdd = e => { if (e.key === 'Enter') ok(false); };
  $('#mSpNaam').addEventListener('keydown', enterAdd);
  $('#mSpAchter').addEventListener('keydown', enterAdd);
}

/* ===================== Coach-notitie ===================== *
 * Vrij tekstveld op het spelerdoc (veld: notitie). Coach-only, valt onder
 * dezelfde afscherming als de rest van het profiel. Een gevulde notitie
 * toont een vlaggetje in de spelerslijst (zie htmlSpelers). */
export function modalNotitie(spelerId){
  const p = speler(spelerId);
  if (!p) return;
  openModal(`
    <h2>Notitie · ${esc(p.naam)}</h2>
    <div class="veldgroep">
      <textarea class="invoer" id="mNotTekst" rows="5"
        placeholder="Bijv. is altijd op de eerste van de maand afwezig voor werk · vindt het fijn om extra complimenten te krijgen">${esc(p.notitie || '')}</textarea>
    </div>
    <div class="avg-balk"><span class="slot">🔒</span>
      <span>Coach-only. Niet zichtbaar voor spelers of ouders. Zet hier geen gevoelige (medische/AVG) gegevens in.</span></div>
    <button class="knop vol" id="mNotOk">Opslaan</button>`);

  $('#mNotOk').onclick = async () => {
    const tekst = $('#mNotTekst').value.trim();
    const knop = $('#mNotOk');
    knop.disabled = true; knop.textContent = 'Opslaan...';
    try {
      await updateDoc(doc(db,'teams',S.teamId,'spelers',p.id), { notitie: tekst || null });
      telGebruik('speler_notitie');
      sluitModal();
      meld(tekst ? 'Notitie opgeslagen' : 'Notitie verwijderd');
    } catch (e){
      console.error(e); knop.disabled = false; knop.textContent = 'Opslaan';
      meld('Opslaan mislukt');
    }
  };
  setTimeout(() => $('#mNotTekst')?.focus(), 50);
}

/* ===================== Uitlenen (spiegelmodel) ===================== *
 * Leen-records leven centraal onder clubs/{clubId}/uitleningen/{leenId}.
 * Model 1a (spiegel): het echte spelerdocument BLIJFT in teams/{vanTeam}/spelers.
 * Het ontvangende team krijgt de speler via een merge in S.spelers (zie
 * herbouwSpelers in teams.js) en laat hem volwaardig meedraaien in opstelling,
 * presentie en evaluatie. Bij het bronteam blijft de speler EVENEENS gewoon
 * bruikbaar (sinds 2026-09-04 geen blokkade meer) — dekt het geval waarin
 * dezelfde speler dezelfde dag voor beide teams speelt (bv. 9:00 bij ons,
 * 11:00 elders). Een chip "⇄ ook bij {team}" bij zijn naam maakt dat
 * zichtbaar; de coach houdt zelf de klok in de gaten. Er is GEEN tijdvenster:
 * de uitleen loopt door tot coach A óf coach B hem terugzet, of tot de
 * clubadmin hem definitief overzet.
 *
 * Recordvorm:
 *   { spelerId, vanTeam, vanTeamNaam, naarTeam, naarTeamNaam,
 *     overlay:{nummer?,positie?},   // door ontvangend team aanpasbaar; origineel blijft ongemoeid
 *     snapshot:{naam,nummer,positie,achternaam},  // basisgegevens reizen mee (B heeft geen leesrecht op A's spelers)
 *     door, gemaakt }
 */

// Actieve UITGAANDE uitlening voor een speler van het eigen team (of null).
function actieveUitleningVoor(spelerId){
  return (S.uitleningenUit||[]).find(u => u.spelerId === spelerId) || null;
}

// Basisgegevens die met het leen-record meereizen zodat het ontvangende team
// de speler kan tonen zonder leesrecht op de spelers-collectie van het bronteam.
function bouwLeenSnapshot(p){
  return {
    naam: p.naam,
    achternaam: p.achternaam || null,
    nummer: p.nummer ?? null,
    positie: p.positie || null,
  };
}

export async function modalUitlenen(spelerId){
  const p = speler(spelerId);
  if (!p) return;
  if (p._ingeleend) return meld('Een ingeleende speler kun je niet doorlenen');
  const clubId = S.team?.club;
  if (!clubId) return meld('Dit team hoort niet bij een club');

  openModal(`
    <h2>${esc(p.naam)} uitlenen</h2>
    <div class="veldgroep"><label>Aan welk team?</label>
      <select class="invoer" id="mUlTeam"><option value="">Teams laden…</option></select></div>
    <div class="avg-balk"><span class="slot">🔒</span>
      <span>De speler doet vanaf nu volwaardig mee bij het gekozen team: opstelling, presentie en evaluatie. Bij jou blijft hij ook gewoon bruikbaar — handig als hij dezelfde dag voor beide teams speelt. Er zit geen einddatum op — jij of de andere coach zet hem terug.</span></div>
    <button class="knop vol" id="mUlOk" disabled>Uitlenen bevestigen</button>`);

  // Doelteams ophalen: alle teams van de club behalve het eigen team.
  let doelTeams = [];
  try {
    const csnap = await getDoc(doc(db,'clubs',clubId));
    const ids = csnap.exists() ? Object.keys(csnap.data().teams || {}) : [];
    const andere = ids.filter(id => id !== S.teamId);
    for (let i=0;i<andere.length;i+=30){
      const chunk = andere.slice(i,i+30);
      if (!chunk.length) break;
      const tsnap = await getDocs(query(collection(db,'teams'), where(documentId(),'in',chunk)));
      tsnap.docs.forEach(d => doelTeams.push({id:d.id, naam:d.data().naam || '?'}));
    }
    doelTeams.sort((a,b)=> a.naam.localeCompare(b.naam));
  } catch(e){
    meld('Teams ophalen mislukt: ' + (e.code||e.message));
  }

  const sel = $('#mUlTeam');
  if (!doelTeams.length){
    sel.innerHTML = '<option value="">Geen andere teams gevonden</option>';
  } else {
    sel.innerHTML = '<option value="">Kies een team…</option>' +
      doelTeams.map(t => `<option value="${t.id}|${esc(t.naam)}">${esc(t.naam)}</option>`).join('');
  }

  const okBtn = $('#mUlOk');
  const check = () => { okBtn.disabled = !sel.value; };
  sel.onchange = check;

  okBtn.onclick = async () => {
    const [naarTeam, naarTeamNaam] = sel.value.split('|');
    if (!naarTeam) return;
    okBtn.disabled = true; okBtn.textContent = 'Bezig…';
    try {
      telGebruik('uitlenen');
      await addDoc(collection(db,'clubs',clubId,'uitleningen'), {
        spelerId: p.id,
        vanTeam: S.teamId,
        vanTeamNaam: S.team.naam,
        naarTeam,
        naarTeamNaam,
        overlay: {},
        snapshot: bouwLeenSnapshot(p),
        door: S.user?.uid || null,
        gemaakt: serverTimestamp(),
      });
      sluitModal();
      meld(`${p.naam} uitgeleend aan ${naarTeamNaam}`);
    } catch(e){
      okBtn.disabled = false; okBtn.textContent = 'Uitlenen bevestigen';
      meld('Uitlenen mislukt: ' + (e.code||e.message));
    }
  };
}

/* Terugzetten naar het eigen team. Mag door coach A (vanTeam) én coach B
   (naarTeam): het leen-record wordt verwijderd. Alles wat team B tijdens de
   uitleen op de speler bouwde (presentie/opstelling/evaluatie in teams/B/…)
   blijft in team B staan — bewuste keuze: beide teams houden hun historie. */
export async function trekUitleningIn(uitleenId){
  const clubId = S.team?.club;
  if (!clubId) return;
  const u = (S.uitleningenUit||[]).find(x => x.id === uitleenId)
         || (S.uitleningenIn ||[]).find(x => x.id === uitleenId);
  const naam = u?.snapshot?.naam || 'De speler';
  const naarEigen = u ? (u.vanTeam === S.teamId ? u.vanTeamNaam : u.vanTeamNaam) : 'het eigen team';
  const vraag = u && u.naarTeam === S.teamId
    ? `${naam} terugzetten naar ${u.vanTeamNaam}? Hij verdwijnt dan uit jouw selectie.`
    : `${naam} terughalen? Hij verdwijnt direct bij ${u?.naarTeamNaam || 'het andere team'} en komt terug in jouw selectie.`;
  if (!confirm(vraag)) return;
  try {
    await deleteDoc(doc(db,'clubs',clubId,'uitleningen',uitleenId));
    telGebruik('uitlenen_intrek');
    // Lokale lijsten meteen bijwerken zodat de UI klopt ook als de
    // listener-snapshot voor deze eigen delete (tijdelijk) uitblijft.
    S.uitleningenUit = (S.uitleningenUit||[]).filter(u => u.id !== uitleenId);
    S.uitleningenIn  = (S.uitleningenIn ||[]).filter(u => u.id !== uitleenId);
    S._beoordeelProfiel = null;
    herrenderTeam();
    meld('Speler teruggezet');
  } catch(e){
    meld('Terugzetten mislukt: ' + (e.code||e.message));
  }
}

/* Overlay bewerken door het ONTVANGENDE team: nummer/positie die alleen bij
   team B gelden. Het origineel bij team A blijft ongemoeid. */
export function modalLeenOverlay(spelerId){
  const p = speler(spelerId);
  if (!p || !p._ingeleend) return;
  const clubId = S.team?.club;
  if (!clubId) return;
  let gekozenPositie = p.positie || '';
  openModal(`
    <h2>Bij jou aanpassen</h2>
    <div class="avg-balk"><span class="slot">⇄</span>
      <span>${esc(p.naam)} is ingeleend van <b>${esc(p._bronTeamNaam||'een ander team')}</b>. Wat je hier wijzigt geldt <b>alleen in jouw team</b> — het origineel bij het andere team blijft ongemoeid.</span></div>
    <div class="veldgroep"><label>Rugnummer bij jou</label>
      <input class="invoer" id="mLoNr" value="${esc(p.nummer ?? '')}" inputmode="numeric" placeholder="7"></div>
    <div class="veldgroep">
      <label>Voorkeurspositie bij jou</label>
      <div id="mLoPos">
        ${POSITIE_GROEPEN.map(g => `
          <div class="pos-groep">
            <div class="pos-lijnlabel">${esc(g.naam)}</div>
            <div class="segment klein-seg wrap">
              ${g.posities.map(pos => `<button type="button" data-pos="${esc(pos)}" class="${gekozenPositie===pos?'actief':''}">${esc(pos)}</button>`).join('')}
            </div>
          </div>`).join('')}
      </div>
    </div>
    <button class="knop vol" id="mLoOk">Opslaan</button>`);

  const zetPositie = (pos) => {
    gekozenPositie = pos;
    $('#mLoPos').querySelectorAll('[data-pos]').forEach(x =>
      x.classList.toggle('actief', x.dataset.pos === gekozenPositie));
  };
  $('#mLoPos').querySelectorAll('[data-pos]').forEach(b => b.onclick = () => {
    zetPositie(gekozenPositie === b.dataset.pos ? '' : b.dataset.pos);
  });

  $('#mLoOk').onclick = async () => {
    const nr = $('#mLoNr').value.trim();
    const overlay = {
      nummer: nr === '' ? null : Number(nr),
      positie: gekozenPositie || null,
    };
    const knop = $('#mLoOk'); knop.disabled = true; knop.textContent = 'Opslaan…';
    try {
      await updateDoc(doc(db,'clubs',clubId,'uitleningen',p._leenId), { overlay });
      telGebruik('uitlenen_overlay');
      sluitModal();
      meld('Aangepast bij jou');
    } catch(e){
      knop.disabled = false; knop.textContent = 'Opslaan';
      meld('Opslaan mislukt: ' + (e.code||e.message));
    }
  };
}

/* Definitief overzetten — ALLEEN clubadmin. Echte verhuizing: het
   spelerdocument wordt naar het ontvangende team gekopieerd (met de overlay
   als nieuwe basiswaarde), daarna bij het bronteam verwijderd en het
   leen-record opgeruimd. De speler-id verandert bewust NIET, zodat de
   historie in beide teams intact blijft. */
export async function definitiefOverzetten(uitleenId){
  const clubId = S.team?.club;
  if (!clubId) return meld('Geen club-context');
  if (!isBeheerder()) return meld('Alleen de clubadmin kan een speler definitief overzetten');
  const u = (S.uitleningenIn||[]).find(x => x.id === uitleenId)
         || (S.uitleningenUit||[]).find(x => x.id === uitleenId);
  if (!u) return meld('Uitlening niet gevonden');
  const naam = u.snapshot?.naam || 'De speler';
  if (!confirm(`${naam} definitief toevoegen aan ${u.naarTeamNaam}? De speler verhuist echt: weg bij ${u.vanTeamNaam}, voortaan eigendom van ${u.naarTeamNaam}. De historie in beide teams blijft behouden.`)) return;
  try {
    // 1) origineel ophalen uit het bronteam
    const bronRef = doc(db,'teams',u.vanTeam,'spelers',u.spelerId);
    const snap = await getDoc(bronRef);
    if (!snap.exists()) return meld('Origineel niet meer gevonden bij het bronteam');
    const data = snap.data();
    // 2) overlay als nieuwe basiswaarde toepassen
    if (u.overlay?.nummer !== undefined && u.overlay.nummer !== null) data.nummer = u.overlay.nummer;
    if (u.overlay?.positie) data.positie = u.overlay.positie;
    delete data.gast;   // een definitief overgezette speler is nooit meer een gast

    if (u.adopteertGast){
      /* Koppeling aan een gast: het ontvangende team heeft al een gast-document
         (met eigen id) waar alle opstellingen aan hangen. Dat document wordt
         overschreven met de echte spelergegevens — id blijft, historie intact. */
      await setDoc(doc(db,'teams',u.naarTeam,'spelers',u.adopteertGast), data);
    } else {
      /* Directe uitleen: met DEZELFDE id naar het ontvangende team schrijven,
         zodat ook daar de historie die al aan spelerId hing blijft kloppen. */
      await setDoc(doc(db,'teams',u.naarTeam,'spelers',u.spelerId), data);
    }
    // origineel bij bronteam verwijderen + leen-record opruimen
    await deleteDoc(bronRef);
    await deleteDoc(doc(db,'clubs',clubId,'uitleningen',uitleenId));
    telGebruik('uitlenen_definitief');
    meld(`${naam} nu definitief bij ${u.naarTeamNaam}`);
    herrenderTeam();
  } catch(e){
    meld('Overzetten mislukt: ' + (e.code||e.message));
  }
}

/* ===================== Gastspelers ===================== *
 * Een gast is een lokaal placeholder-spelerdocument in het EIGEN team
 * (teams/{teamId}/spelers met gast:true), bedoeld om alvast op te stellen
 * zolang nog niet bekend is wie precies wordt ingeleend. Zodra dat duidelijk
 * is, adopteert een inkomend leen-record het gast-id (zie modalKoppelGast):
 * de gast houdt zijn plek in alle opstellingen/presenties en toont voortaan
 * de echte naam en herkomst. Een gast hoort altijd bij een (komende) uitleen;
 * een proefspeler van buiten hoort als gewone speler in de selectie. */
export function modalGast(gastId){
  const g = gastId ? speler(gastId) : null;
  openModal(`
    <h2>${g ? 'Gast bewerken' : 'Gastspeler aanmaken'}</h2>
    <div class="avg-balk"><span class="slot">👤</span>
      <span>Een gast is een tijdelijke placeholder om alvast op te stellen, zolang nog niet bekend is wie je precies inleent. Zodra dat duidelijk is, koppel je hem aan de echte uitleen.</span></div>
    <div class="rij">
      <div class="veldgroep" style="flex:3"><label>Label / omschrijving</label>
        <input class="invoer" id="mGNaam" value="${esc(g?.naam||'')}" placeholder="Bijv. Gast — links achter" autocomplete="off"></div>
      <div class="veldgroep" style="flex:1"><label>Nr.</label>
        <input class="invoer" id="mGNr" value="${esc(g?.nummer ?? '')}" inputmode="numeric" placeholder="15"></div>
    </div>
    <button class="knop vol" id="mGOk">${g ? 'Opslaan' : 'Aanmaken'}</button>`);

  $('#mGOk').onclick = async () => {
    const naam = $('#mGNaam').value.trim() || 'Gastspeler';
    const nr = $('#mGNr').value.trim();
    const data = { naam, nummer: nr === '' ? null : Number(nr), gast: true };
    const knop = $('#mGOk'); knop.disabled = true; knop.textContent = 'Bezig…';
    try {
      if (g){ await updateDoc(doc(db,'teams',S.teamId,'spelers',g.id), { naam: data.naam, nummer: data.nummer }); }
      else  { await addDoc(collection(db,'teams',S.teamId,'spelers'), data); }
      telGebruik(g ? 'gast_bewerken' : 'gast_nieuw');
      sluitModal();
      meld(g ? 'Gast bijgewerkt' : `${naam} aangemaakt`);
    } catch(e){
      knop.disabled = false; knop.textContent = g ? 'Opslaan' : 'Aanmaken';
      meld('Opslaan mislukt: ' + (e.code||e.message));
    }
  };
  setTimeout(() => $('#mGNaam')?.focus(), 50);
}

export async function verwijderGast(gastId){
  const g = speler(gastId);
  if (!g) return;
  // Hangt er een uitlening aan (geadopteerd)? Dan is het geen losse gast meer.
  const gekoppeld = (S.uitleningenIn||[]).some(u => u.adopteertGast === gastId);
  if (gekoppeld) return meld('Deze gast is gekoppeld aan een uitleen — zet die eerst terug');
  if (!confirm(`${g.naam} verwijderen? De opstellingen en presenties waarin deze gast stond, verliezen hem.`)) return;
  try {
    await deleteDoc(doc(db,'teams',S.teamId,'spelers',gastId));
    telGebruik('gast_weg');
    S._beoordeelProfiel = null;
    herrenderTeam();
    meld('Gast verwijderd');
  } catch(e){
    meld('Verwijderen mislukt: ' + (e.code||e.message));
  }
}

/* Koppelen: een inkomend leen-record adopteert het gast-id. Eén schrijfactie
   op het leen-record — het gast-id blijft, dus alle bestaande opstellingen en
   presenties blijven intact. Alleen uitleningen die nog geen gast hebben
   geadopteerd zijn koppelbaar (één uitleen ↔ één speler). */
export function modalKoppelGast(gastId){
  const g = speler(gastId);
  if (!g) return;
  const clubId = S.team?.club;
  if (!clubId) return;
  const koppelbaar = (S.uitleningenIn||[]).filter(u => !u.adopteertGast);
  openModal(`
    <h2>Koppel aan ingeleende speler</h2>
    <div class="avg-balk"><span class="slot">🔗</span>
      <span>Kies welke uitleen deze gast wordt. De gast houdt zijn plek in al je opstellingen en presenties — alleen de naam en herkomst komen erbij.</span></div>
    <div class="veldgroep"><label>Beschikbare uitleningen naar jouw team</label>
      <select class="invoer" id="mKgSel">
        ${koppelbaar.length
          ? koppelbaar.map(u => `<option value="${u.id}">${esc(u.snapshot?.naam || 'Speler')} — van ${esc(u.vanTeamNaam||'ander team')}</option>`).join('')
          : `<option value="">Nog geen uitleningen beschikbaar</option>`}
      </select></div>
    <button class="knop vol" id="mKgOk"${koppelbaar.length ? '' : ' disabled'}>Koppelen</button>`);

  $('#mKgOk').onclick = async () => {
    const leenId = $('#mKgSel').value;
    if (!leenId) return;
    const knop = $('#mKgOk'); knop.disabled = true; knop.textContent = 'Bezig…';
    try {
      await updateDoc(doc(db,'clubs',clubId,'uitleningen',leenId), { adopteertGast: gastId });
      telGebruik('gast_koppel');
      sluitModal();
      meld('Gast gekoppeld');
    } catch(e){
      knop.disabled = false; knop.textContent = 'Koppelen';
      meld('Koppelen mislukt: ' + (e.code||e.message));
    }
  };
}
