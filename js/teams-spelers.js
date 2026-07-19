/* ==================== SPELERSPROFIEL (teams.js-modulaire split) ====================
   Onderdeel van de teams.js-modulaire split. Alles rond een individuele
   speler: het spelersoverzicht, het spelersprofiel (leerlijn, tijdlijn,
   ontwikkelbeoordelingen: snel + volledig), leerpunten, spelergegevens
   bewerken, én het uitlenen van een speler aan een ander team binnen de
   club (thematisch dezelfde "speler"-context, vandaar in één bestand). */
import {
  db, collection, doc, addDoc, deleteDoc, updateDoc,
  getDoc, getDocs, query, where, serverTimestamp, documentId
} from './firebase.js?v=20260719';
import {
  S, $, $$, esc, meld, datumNL, speler, uurMin, openModal, sluitModal
} from './state.js?v=20260719';
import {
  niveau, niveauKleur, NIVEAUS, SKILLS, skillDomein,
  LEERCURVE, leercurveRelevant, leercurveThema, snelTag, SNEL_TAGS,
  POSITIE_GROEPEN
} from './config.js?v=20260719';
import { analyseWedstrijd } from './analyse.js?v=20260719';
import { toonThemaInfo } from './teams-leerlijn.js?v=20260719';

/* Cross-module her-render: teams.js importeert functies van hieruit, dus
   deze module mag teams.js niet statisch terug-importeren (circulaire
   import). Dynamic import() binnen de aanroepende functie is het patroon
   dat de rest van de app ook al gebruikt (zie club.js/wedstrijd.js). */
async function herrenderTeam(){
  const m = await import('./teams.js?v=20260719');
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

  return `
    <div class="segment" id="spelersModus" style="margin-bottom:14px">
      <button data-modus="selectie" class="actief">Selectie</button>
      <button data-modus="snel">⚡ Snel beoordelen</button>
    </div>

    <div class="avg-balk">
      <span class="slot">🔒</span>
      <span>Beoordelingen en leerpunten zijn alleen zichtbaar voor coaches van dit team. Spelers en ouders zien deze gegevens niet.</span>
    </div>

    <button class="knop vol licht" id="nieuweSpeler" style="margin-bottom:14px">+ Speler toevoegen</button>
    ${S.spelers.length ? S.spelers.map(p => {
      const b = laatsteSnel[p.id];
      const stip = b ? `<span class="beoordeel-stip" style="background:${niveauKleur(b.niveau)}" title="Laatste: ${esc(niveau(b.niveau)?.label||'')}"></span>`
                     : `<span class="beoordeel-stip leeg" title="Nog niet beoordeeld"></span>`;
      const lp = openLeerpunten(p.id);
      return `
      <button class="speler-rij" data-open-profiel="${p.id}">
        <div class="mini-shirt">${esc(p.nummer ?? '·')}</div>
        <div class="n">${esc(p.naam)}</div>
        ${lp ? `<span class="chip-info">${lp} leerpunt${lp===1?'':'en'}</span>` : ''}
        ${stip}
        <span class="pijl">›</span>
      </button>`;
    }).join('')
    : `<div class="kaart leeg">Nog geen spelers.<br>Voeg je selectie toe — naam en rugnummer is genoeg.</div>`}

    ${(() => {
      const nu = vandaagIso();
      const actief = (S.uitleningenIn||[]).filter(u => u.van <= nu && nu <= u.tot);
      if (!actief.length) return '';
      return `
        <div class="sectie-kop" style="margin:18px 0 10px;font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;color:var(--ink-2)">⇄ Geleend (tijdelijk)</div>
        ${actief.map(u => {
          const s = u.snapshot || {};
          const nm = s.voorletter ? `${s.naam} ${s.voorletter}.` : (s.naam||'Speler');
          return `
          <button class="speler-rij" data-open-leen="${u.id}">
            <div class="mini-shirt" style="background:var(--ink-2)">${esc(s.nummer ?? '·')}</div>
            <div class="n">${esc(nm)}<div style="font-size:11px;color:var(--ink-2);font-weight:400">van ${esc(u.vanTeamNaam||'ander team')} · t/m ${datumNL(u.tot)}</div></div>
            <span class="pijl">›</span>
          </button>`;
        }).join('')}`;
    })()}

    <p style="font-size:12px;color:var(--ink-2);margin-top:12px;line-height:1.5">
      Het gekleurde stipje toont de laatste snelle beoordeling. Tik op een speler voor het volledige profiel met statistieken, leerlijn en historie.</p>`;
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
  let aanwezig = 0, blessure = 0, metReden = 0, zonderReden = 0;
  for (const sessie of (S.presentie||[])){
    const afw = (sessie.afwezig||[]).includes(pid);
    if (!afw){ aanwezig++; continue; }
    const reden = (sessie.afwezigRedenen||{})[pid];
    if (reden?.type === 'blessure') blessure++;
    else if (reden?.type === 'reden') metReden++;
    else zonderReden++;
  }
  const opkomst = totTr ? Math.round((aanwezig/totTr)*100) : null;
  return {wedstrijden, tijd, keeper, goals, opkomst, totTr, blessure, metReden, zonderReden, posities};
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
    segs += `<div class="tips-seg" style="background:${i <= score ? niveauKleur(score) : '#EFEFED'}"></div>`;
  return `<div class="tips-track">${segs}</div>`;
}

/* ---------- Spelerprofiel ---------- */
/* Read-only profiel van een geleende speler (snapshot uit clubs/{clubId}/uitleningen). */
export function htmlLeenProfiel(){
  const u = (S.uitleningenIn||[]).find(x => x.id === S._leenProfiel);
  if (!u) { S._leenProfiel = null; return htmlSpelers(); }
  const s = u.snapshot || {};
  const nm = s.voorletter ? `${s.naam} ${s.voorletter}.` : (s.naam || 'Speler');
  const st = s.stats || {};
  const sc = s.profielScores || null;
  const lijn = s.nummer != null && s.nummer !== '' ? '#'+esc(s.nummer) : '';
  return `
    <button class="profiel-terug" id="leenTerug">‹ Terug naar spelers</button>
    <div class="profiel-top">
      <div class="pt-shirt" style="background:var(--ink-2)">${esc(s.nummer ?? '·')}</div>
      <div><h2>${esc(nm)}</h2><div class="meta">${lijn?lijn+' · ':''}geleend van ${esc(u.vanTeamNaam||'ander team')}</div></div>
    </div>

    <div class="avg-balk"><span class="slot">🔒</span>
      <span>Tijdelijk geleende speler · alleen-lezen. Zichtbaar t/m ${datumNL(u.tot)}, daarna verdwijnt hij automatisch.</span></div>

    <div class="kaart" style="margin-bottom:12px">
      <div class="veldlabel" style="margin-top:0">Profiel</div>
      <div class="kv-rij" style="display:flex;justify-content:space-between;padding:8px 0">
        <span style="color:var(--ink-2)">Voorkeurspositie</span>
        <span style="font-weight:600">${s.positie ? esc(s.positie) : '—'}</span></div>
    </div>

    <div class="stat-grid">
      <div class="stat-box"><div class="v">${st.wedstrijden ?? 0}</div><div class="l">Wedstr.</div></div>
      <div class="stat-box"><div class="v">${st.tijd ? uurMin(st.tijd) : '—'}</div><div class="l">Speeltijd</div></div>
      <div class="stat-box"><div class="v">${st.goals ?? 0}</div><div class="l">Goals</div></div>
      <div class="stat-box"><div class="v">${st.opkomst != null ? st.opkomst+'%' : '—'}</div><div class="l">Training</div></div>
    </div>

    <div class="kaart">
      <div class="veldlabel" style="margin-top:0">Ontwikkelprofiel${s.profielDatum ? ` · ${datumNL(s.profielDatum)}` : ''}</div>
      ${sc ? SKILLS.map(d => `
        <div class="tips-rij">
          <div class="tips-letter">${d.id}</div>
          <div class="tips-naam">${d.naam}</div>
          ${tipsBalk(sc[d.id] || 0)}
          <div class="tips-score">${sc[d.id] || '—'}</div>
        </div>`).join('')
      : `<p style="font-size:13px;color:var(--ink-2);padding:6px 0">De uitlenende coach heeft (nog) geen volledige beoordeling gedeeld.</p>`}
    </div>

    <p style="font-size:12px;color:var(--ink-2);margin-top:12px;line-height:1.5">
      Deze gegevens zijn een momentopname van het moment van uitlenen, gedeeld door ${esc(u.vanTeamNaam||'het andere team')}.</p>`;
}

export function htmlProfiel(){
  const p = speler(S._beoordeelProfiel);
  if (!p) { S._beoordeelProfiel = null; return htmlSpelers(); }
  const tab = S._profielTab || 'overzicht';
  const st = spelerStats(p.id);
  const vol = laatsteVolledig(p.id);
  const eigen = S.beoordelingen.filter(b => b.spelerId === p.id);

  const lijn = p.nummer != null && p.nummer !== '' ? '#'+esc(p.nummer) : '';
  return `
    <button class="profiel-terug" id="profielTerug">‹ Terug naar spelers</button>
    <div class="profiel-top">
      <div class="pt-shirt">${esc(p.nummer ?? '·')}</div>
      <div><h2>${esc(p.naam)}</h2><div class="meta">${lijn?lijn+' · ':''}${esc(S.team.naam)}</div></div>
    </div>
    ${(() => {
      const u = actieveUitleningVoor(p.id);
      if (!u) return '';
      return `<div class="leen-strook">
        <span class="ic">⇄</span>
        <span class="tx">Uitgeleend aan <b>${esc(u.naarTeamNaam)}</b> · t/m ${datumNL(u.tot)}</span>
        <button data-uitleen-intrek="${u.id}">Intrekken</button>
      </div>`;
    })()}

    <div class="avg-balk"><span class="slot">🔒</span>
      <span>Coach-only. Deel niets uit dit profiel buiten het technisch kader.</span></div>

    <div class="segment" id="profielTabs" style="margin-bottom:14px">
      <button data-ptab="overzicht" class="${tab==='overzicht'?'actief':''}">Overzicht</button>
      <button data-ptab="leerlijn" class="${tab==='leerlijn'?'actief':''}">Leerlijn</button>
      <button data-ptab="historie" class="${tab==='historie'?'actief':''}">Historie</button>
    </div>

    ${tab === 'overzicht' ? `
      <div class="stat-grid">
        <div class="stat-box"><div class="v">${st.wedstrijden}</div><div class="l">Wedstr.</div></div>
        <div class="stat-box"><div class="v">${st.tijd ? uurMin(st.tijd) : '—'}</div><div class="l">Speeltijd</div></div>
        <div class="stat-box"><div class="v">${st.goals}</div><div class="l">Goals</div></div>
        <div class="stat-box"><div class="v">${st.opkomst != null ? st.opkomst+'%' : '—'}</div><div class="l">Training</div></div>
      </div>
      ${(st.blessure || st.metReden || st.zonderReden) ? `
      <div class="presentie-uitsplitsing" style="margin:-6px 0 14px">
        ${st.blessure ? `<span>🩹 ${st.blessure}× geblesseerd</span>` : ''}
        ${st.metReden ? `<span>📋 ${st.metReden}× met reden</span>` : ''}
        ${st.zonderReden ? `<span>❔ ${st.zonderReden}× zonder reden</span>` : ''}
      </div>` : ''}

      <div class="kaart">
        <div class="veldlabel" style="margin-top:0">Ontwikkelprofiel${vol ? ` · ${datumNL(vol.datum)}` : ''}</div>
        ${vol ? SKILLS.map(d => `
          <div class="tips-rij">
            <div class="tips-letter">${d.id}</div>
            <div class="tips-naam">${d.naam}</div>
            ${tipsBalk(vol.scores?.[d.id] || 0)}
            <div class="tips-score">${vol.scores?.[d.id] || '—'}</div>
          </div>`).join('')
        : `<p style="font-size:13px;color:var(--ink-2);padding:6px 0">Nog geen volledige beoordeling. Maak er één om het ontwikkelprofiel te zien.</p>`}
      </div>

      <div class="fab-rij">
        <button class="knop fluo klein" style="flex:1" data-snel-speler="${p.id}">⚡ Snel beoordelen</button>
        <button class="knop klein" style="flex:1" data-volledig-speler="${p.id}">📋 Volledige beoordeling</button>
      </div>

      <div class="rij" style="margin-top:4px">
        <button class="knop licht klein" data-bewerk-speler="${p.id}">✏️ Speler bewerken</button>
        <button class="knop gevaar klein" data-weg-speler="${p.id}">🗑 Verwijderen</button>
      </div>
      ${S.team?.club ? `<button class="knop klein" style="margin-top:4px;width:100%" data-uitleen-speler="${p.id}">⇄ Uitlenen aan ander team</button>` : ''}
    ` : ''}

    ${tab === 'leerlijn' ? htmlLeerlijn(p) : ''}

    ${tab === 'historie' ? `
      <div class="kaart">
        <div class="veldlabel" style="margin-top:0">Tijdlijn</div>
        ${eigen.length ? eigen.map(b => htmlTijdlijnItem(b)).join('')
          : `<p style="font-size:13px;color:var(--ink-2);padding:6px 0">Nog geen beoordelingen vastgelegd.</p>`}
      </div>
      <div class="kaart">
        <div class="veldlabel" style="margin-top:0">Presentie training</div>
        ${S.presentie.length ? S.presentie.map(ses => {
          const afw = (ses.afwezig||[]).includes(p.id);
          const reden = (ses.afwezigRedenen||{})[p.id];
          const statusTxt = !afw ? 'Aanwezig'
            : reden?.type === 'blessure' ? '🩹 Geblesseerd'
            : reden?.type === 'reden' ? `📋 Met reden${reden.notitie ? ' · '+esc(reden.notitie) : ''}`
            : '❔ Zonder reden';
          return `<div class="presentie-hist-rij"><span>${datumNL(ses.datum)}</span><span class="phr-status ${afw?'afw':'aanw'}">${statusTxt}</span></div>`;
        }).join('') : `<p style="font-size:13px;color:var(--ink-2);padding:6px 0">Nog geen presentie geregistreerd.</p>`}
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
            ${thema ? `<div style="font-size:11px;color:var(--accent);font-weight:700;margin-top:3px;cursor:pointer" data-thema-info="${esc(thema.thema)}">ℹ️ Achtergrond &amp; tips bekijken</div>` : ''}
          </div>
          <button class="lp-weg" data-lp-weg="${l.id}" title="Verwijderen">🗑</button>
        </div>`;
      }).join('')
      : `<p style="font-size:13px;color:var(--ink-2);padding:6px 0 10px">Nog geen leerpunten. Voeg een concreet, observeerbaar ontwikkeldoel toe.</p>`}
      <button class="knop licht klein" style="width:100%;margin-top:6px" data-lp-nieuw="${p.id}">+ Leerpunt toevoegen</button>
    </div>
    <p style="font-size:12px;color:var(--ink-2);line-height:1.5">Leerpunten lopen door over meerdere wedstrijden en beoordelingen. Vink ze af zodra ze beheerst zijn.</p>`;
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
      : `<p style="font-size:12.5px;color:var(--ink-2);padding:4px 0">Geen ${bronType==='wedstrijd'?'wedstrijden':'trainingen'} gevonden — kies "Los".</p>`;
  };

  const kleurbalk = () => `<div class="kleurbalk" id="mSnNiveau">${NIVEAUS.slice(1).map(n =>
    `<button data-niv="${n.n}" class="kn${n.n} ${gekozenNiveau===n.n?'gekozen':''}"><span class="lbl">${n.label.toUpperCase()}</span></button>`).join('')}</div>`;

  const tagRij = () => `<div class="tag-rij" id="mSnTags">${SNEL_TAGS.map(t =>
    `<button class="tag ${gekozenTags.has(t.id)?'aan':''}" data-tag="${t.id}">${t.emoji} ${t.label}</button>`).join('')}</div>`;

  openModal(`
    <h2>Snel beoordelen</h2>
    <div class="snel-kop">
      <div class="mini-shirt">${esc(p.nummer ?? '·')}</div>
      <div><div class="nm">${esc(p.naam)}</div><div class="pos" id="mSnPos"></div></div>
    </div>

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
    if (!bestaande) data.seizoen = S.huidigSeizoen;
    try {
      if (bestaande) await updateDoc(doc(db,'teams',S.teamId,'beoordelingen',bestaande.id), data);
      else await addDoc(collection(db,'teams',S.teamId,'beoordelingen'), data);
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
  if (skipBtn) skipBtn.onclick = () => { sluitModal(); volgendeSnelRonde(); };
}

/* ---------- Snelle beoordelingsronde (alle spelers achter elkaar) ---------- */
export function startSnelRonde(){
  if (!S.spelers.length) return meld('Voeg eerst spelers toe');
  S._snelRonde = {index:0, ids:S.spelers.map(p => p.id)};
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
  const p = speler(spelerId); if (!p) return;
  const scores = {...(bestaande?.scores || {})};
  const notities = {...(bestaande?.notities || {})};
  const moment = bestaande?.bron?.label || '';

  const domeinKaart = (d) => `
    <div class="kaart">
      <div class="veldlabel" style="margin-top:0">${d.id} · ${d.naam}</div>
      <p style="font-size:11.5px;color:var(--ink-2);margin:-2px 0 4px">${esc(d.omschrijving)}</p>
      <div class="kleurbalk dom" data-dom="${d.id}">${NIVEAUS.slice(1).map(n =>
        `<button data-niv="${n.n}" class="kn${n.n} ${scores[d.id]===n.n?'gekozen':''}"><span class="lbl">${n.kort}</span></button>`).join('')}</div>
      <textarea class="invoer" data-not="${d.id}" rows="2" placeholder="Toelichting ${d.naam.toLowerCase()}...">${esc(notities[d.id]||'')}</textarea>
    </div>`;

  openModal(`
    <h2>Volledige beoordeling</h2>
    <p style="font-size:13px;color:var(--ink-2);margin-bottom:10px">${esc(p.naam)}${p.nummer!=null&&p.nummer!==''?' · #'+esc(p.nummer):''}</p>
    <div class="veldgroep"><label>Moment</label>
      <input class="invoer" id="mVbMoment" value="${esc(moment)}" placeholder="Bijv. Kwartaalmeting Q3"></div>
    ${SKILLS.map(domeinKaart).join('')}
    <button class="knop vol fluo" id="mVbOk" style="margin-top:6px">${bestaande?'Bijwerken':'Beoordeling opslaan'}</button>
    ${bestaande?`<button class="knop vol gevaar" id="mVbWeg" style="margin-top:8px">Verwijderen</button>`:''}
    <p style="font-size:11.5px;color:var(--ink-2);margin-top:10px;line-height:1.45">Tip: leerpunten beheer je in het tabblad <b>Leerlijn</b> van de speler — die lopen door over meerdere beoordelingen.</p>`);

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
    if (!bestaande) data.seizoen = S.huidigSeizoen;
    try {
      if (bestaande) await updateDoc(doc(db,'teams',S.teamId,'beoordelingen',bestaande.id), data);
      else await addDoc(collection(db,'teams',S.teamId,'beoordelingen'), data);
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
    <p style="font-size:13px;color:var(--ink-2);margin-bottom:10px">Formuleer een concreet, observeerbaar doel voor ${esc(p.naam)}. Kies een thema uit de leerlijn of schrijf je eigen leerpunt.</p>

    <div class="veldlabel">Uit de leerlijn${cat?` · ${esc(cat)}`:''}</div>
    <div class="leercurve-keuze" id="mLpCurve">
      ${themas.map(t => {
        const d = skillDomein(t.domein);
        return `<button class="lc-thema ${t.rel?'rel':''}" data-thema="${esc(t.thema)}" data-dom="${t.domein}" title="${esc(d?.naam||'')}${t.rel?'':' · vanaf O'+t.vanaf}">
          <span class="lc-dot" style="background:${t.rel?'var(--n5)':'var(--line-d)'}"></span>${esc(t.thema)}<span data-thema-info="${esc(t.thema)}" title="Achtergrond en tips" style="display:inline-flex;align-items:center;justify-content:center;width:16px;height:16px;border-radius:50%;background:rgba(255,255,255,.15);font-size:10px;font-weight:700;margin-left:1px">ℹ</span></button>`;
      }).join('')}
    </div>
    <p style="font-size:11px;color:var(--ink-2);margin:2px 0 12px">🟢 = hoort bij deze leeftijd volgens het jeugdbeleidsplan. Tik ℹ voor achtergrond en oefentips.</p>

    <div class="veldlabel">Domein</div>
    <div class="segment klein-seg" id="mLpDom">${SKILLS.map(d =>
      `<button data-d="${d.id}" class="${d.id==='TA'?'actief':''}" title="${esc(d.naam)}">${d.id}</button>`).join('')}</div>

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
      sluitModal(); herrenderTeam(); meld('Leerpunt toegevoegd');
    } catch(e){ meld('Opslaan mislukt: '+(e.code||e.message)); }
  };
}
export async function toggleLeerpunt(lpId){
  const p = speler(S._beoordeelProfiel); if (!p) return;
  const lp = (p.leerpunten||[]).map(l => l.id === lpId
    ? {...l, klaar:!l.klaar, klaarOp: !l.klaar ? vandaagISO() : null} : l);
  await updateDoc(doc(db,'teams',S.teamId,'spelers',p.id), {leerpunten: lp});
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
    if (p) await updateDoc(doc(db,'teams',S.teamId,'spelers',p.id), data);
    else   await addDoc(collection(db,'teams',S.teamId,'spelers'), data);
    if (sluiten) sluitModal();
    else { $('#mSpNaam').value=''; $('#mSpNr').value=''; $('#mSpAchter').value=''; $('#mSpNaam').focus(); meld(naam+' toegevoegd'); }
  };
  $('#mSpOk').onclick = () => ok(bewerken);
  const enterAdd = e => { if (e.key === 'Enter') ok(false); };
  $('#mSpNaam').addEventListener('keydown', enterAdd);
  $('#mSpAchter').addEventListener('keydown', enterAdd);
}

/* ===================== Uitlenen ===================== *
 * Leen-records leven centraal onder clubs/{clubId}/uitleningen.
 * Een record bevat een afgeschermde momentopname (snapshot) van de speler,
 * zodat de ontvangende coach hem read-only ziet zonder toegang tot het bronteam.
 * Venster: 3 dagen vóór t/m 3 dagen ná de wedstrijddag (vast).
 */
const LEEN_VENSTER_DAGEN = 3;


function isoDatum(d){ return d.toISOString().slice(0,10); }
function plusDagen(isoStr, n){
  const d = new Date(isoStr + 'T12:00'); d.setDate(d.getDate() + n); return isoDatum(d);
}
function vandaagIso(){ return isoDatum(new Date()); }

// Actieve uitlening (binnen venster) voor een speler van het EIGEN team.
function actieveUitleningVoor(spelerId){
  const nu = vandaagIso();
  return (S.uitleningenUit||[]).find(u =>
    u.spelerId === spelerId && u.van <= nu && nu <= u.tot) || null;
}

// Voornaam + voorletter achternaam, bv. "Tim B." — privacy-vriendelijke weergave.
function leenNaam(naam, achternaam){
  const vl = (achternaam||'').trim().charAt(0).toUpperCase();
  return vl ? `${naam} ${vl}.` : naam;
}

// Bouw de afgeschermde snapshot die de andere coach mag zien.
function bouwLeenSnapshot(p){
  const st = spelerStats(p.id);
  const vol = laatsteVolledig(p.id);   // laatste volledige beoordeling (ontwikkelprofiel) of null
  const scores = {};
  if (vol && vol.scores) for (const s of SKILLS) if (vol.scores[s.id] != null) scores[s.id] = vol.scores[s.id];
  return {
    naam: p.naam,
    voorletter: (p.achternaam||'').trim().charAt(0).toUpperCase() || null,
    nummer: p.nummer ?? null,
    positie: p.positie || null,
    stats: { wedstrijden: st.wedstrijden, tijd: st.tijd, goals: st.goals, keeper: st.keeper, opkomst: st.opkomst },
    profielScores: Object.keys(scores).length ? scores : null,
    profielDatum: vol?.datum || null,
  };
}

export async function modalUitlenen(spelerId){
  const p = speler(spelerId);
  if (!p) return;
  const clubId = S.team?.club;
  if (!clubId) return meld('Dit team hoort niet bij een club');

  openModal(`
    <h2>${esc(p.naam)} uitlenen</h2>
    <div class="veldgroep"><label>Aan welk team?</label>
      <select class="invoer" id="mUlTeam"><option value="">Teams laden…</option></select></div>
    <div class="veldgroep"><label>Wedstrijddag</label>
      <input class="invoer" id="mUlDatum" type="date" value="${vandaagIso()}"></div>
    <div class="avg-balk"><span class="slot">🔒</span>
      <span>De ontvangende coach ziet <b>${esc(leenNaam(p.naam,p.achternaam))}</b> alleen van 3 dagen vóór t/m 3 dagen ná deze dag, en alleen positie, statistieken en ontwikkelprofiel — read-only.</span></div>
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
  const check = () => { okBtn.disabled = !(sel.value && $('#mUlDatum').value); };
  sel.onchange = check; $('#mUlDatum').oninput = check;

  okBtn.onclick = async () => {
    const [naarTeam, naarTeamNaam] = sel.value.split('|');
    const dag = $('#mUlDatum').value;
    if (!naarTeam || !dag) return;
    okBtn.disabled = true; okBtn.textContent = 'Bezig…';
    try {
      await addDoc(collection(db,'clubs',clubId,'uitleningen'), {
        spelerId: p.id,
        vanTeam: S.teamId,
        vanTeamNaam: S.team.naam,
        naarTeam,
        naarTeamNaam,
        dag,
        van: plusDagen(dag, -LEEN_VENSTER_DAGEN),
        tot: plusDagen(dag,  LEEN_VENSTER_DAGEN),
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

export async function trekUitleningIn(uitleenId){
  const clubId = S.team?.club;
  if (!clubId) return;
  if (!confirm('Uitlening intrekken? De speler verdwijnt direct bij het andere team.')) return;
  try {
    await deleteDoc(doc(db,'clubs',clubId,'uitleningen',uitleenId));
    // Werk de lokale lijsten meteen bij en render, zodat de UI klopt ook als
    // de listener-snapshot voor deze eigen delete (tijdelijk) uitblijft.
    S.uitleningenUit = (S.uitleningenUit||[]).filter(u => u.id !== uitleenId);
    S.uitleningenIn  = (S.uitleningenIn ||[]).filter(u => u.id !== uitleenId);
    herrenderTeam();
    meld('Uitlening ingetrokken');
  } catch(e){
    meld('Intrekken mislukt: ' + (e.code||e.message));
  }
}
