/* ==================== TEAMEVALUATIE (na de wedstrijd) ====================
   Onderdeel van de teams.js-modulaire split. Team-niveau evaluatie na een
   wedstrijd (8 categorieën + tags + toelichtingen) en het bijbehorende
   dashboard/geschiedenis, plus de "Stats"-tab die dit combineert met de
   spelersstatistieken uit wedstrijd.js. */
import {
  db, collection, doc, addDoc, deleteDoc, updateDoc
} from './firebase.js?v=20260719';
import {
  S, $, $$, esc, meld, datumNL, openModal, sluitModal, toon
} from './state.js?v=20260719';
import { NIVEAUS, niveauKleur, TEAM_CATEGORIEEN, TEAM_TAGS, teamCategorie } from './config.js?v=20260719';
import { htmlStats } from './wedstrijd.js?v=20260719';

/* Kleine lokale kopie van de deelnemer-helper (ook aanwezig in teams-spelers.js)
   — bewust hier gedupliceerd i.p.v. een cross-module import voor één regel. */
function deelnemer(){
  return { uid: S.user.uid, naam: (S.team.ledenInfo?.[S.user.uid]?.naam) || S.user.displayName || S.user.email || '' };
}

export function modalTeamEvaluatie(wedstrijdId){
  const w = S.wedstrijden.find(x => x.id === wedstrijdId);
  if (!w) return meld('Kon de wedstrijd niet vinden — probeer de pagina te verversen');
  const bestaande = S.teamEvaluaties.find(e => e.wedstrijdId === wedstrijdId) || null;
  const scores = {...(bestaande?.scores || {})};
  let gekozenTags = new Set(bestaande?.tags || []);

  const kleurbalk = (catId) => `<div class="kleurbalk" data-cat="${catId}">${NIVEAUS.slice(1).map(n =>
    `<button data-niv="${n.n}" class="kn${n.n} ${scores[catId]===n.n?'gekozen':''}"><span class="lbl">${n.label.toUpperCase()}</span></button>`).join('')}</div>`;

  openModal(`
    <h2>${bestaande?'Team-evaluatie bijwerken':'Team evalueren'}</h2>
    <div class="snel-kop">
      <div class="mini-shirt">⚽</div>
      <div><div class="nm">${esc(S.team.naam)} – ${esc(w.tegenstander)}</div>
        <div class="pos">${datumNL(w.datum)}${w.thuis!=null?(w.thuis?' · Thuis':' · Uit'):''}</div></div>
    </div>
    ${TEAM_CATEGORIEEN.map(c => `<div class="veldlabel">${esc(c.naam)}</div>${kleurbalk(c.id)}`).join('')}

    <div class="veldlabel">Opvallend (optioneel)</div>
    <div class="tag-rij" id="mTeTags">${TEAM_TAGS.map(t =>
      `<button class="tag ${gekozenTags.has(t.id)?'aan':''}" data-tag="${t.id}">${t.emoji} ${t.label}</button>`).join('')}</div>

    <div class="veldlabel">Wat ging het beste? (optioneel)</div>
    <textarea class="invoer" id="mTeGoed" rows="2" placeholder="Bijv. de druk vooraan zorgde voor balwinst hoog op het veld">${esc(bestaande?.notitieGoed||'')}</textarea>

    <div class="veldlabel">Aandachtspunt voor volgende training? (optioneel)</div>
    <textarea class="invoer" id="mTeAandacht" rows="2" placeholder="Bijv. rustiger opbouwen vanuit de verdediging">${esc(bestaande?.notitieAandacht||'')}</textarea>

    <button class="knop vol fluo" id="mTeOk" style="margin-top:12px">${bestaande?'Bijwerken':'Opslaan'}</button>
    ${bestaande?`<button class="knop vol gevaar" id="mTeWeg" style="margin-top:8px">Verwijderen</button>`:''}`);

  $$('.kleurbalk[data-cat] [data-niv]').forEach(b => b.onclick = () => {
    const wrap = b.closest('.kleurbalk'); const catId = wrap.dataset.cat;
    scores[catId] = Number(b.dataset.niv);
    wrap.querySelectorAll('[data-niv]').forEach(x => x.classList.toggle('gekozen', x===b));
  });
  $$('#mTeTags [data-tag]').forEach(b => b.onclick = () => {
    const id = b.dataset.tag;
    if (gekozenTags.has(id)) gekozenTags.delete(id); else gekozenTags.add(id);
    b.classList.toggle('aan');
  });

  $('#mTeOk').onclick = async () => {
    if (Object.keys(scores).length < TEAM_CATEGORIEEN.length) return meld('Vul alle categorieën in');
    const data = {
      wedstrijdId, tegenstander:w.tegenstander, datum:w.datum, scores,
      tags:[...gekozenTags],
      notitieGoed:$('#mTeGoed').value.trim(), notitieAandacht:$('#mTeAandacht').value.trim(),
      door:deelnemer(), gemaaktMs:Date.now(),
    };
    if (!bestaande) data.seizoen = S.huidigSeizoen;
    try {
      if (bestaande) await updateDoc(doc(db,'teams',S.teamId,'teamevaluaties',bestaande.id), data);
      else await addDoc(collection(db,'teams',S.teamId,'teamevaluaties'), data);
      sluitModal(); meld('Teamevaluatie opgeslagen');
    } catch(e){ meld('Opslaan mislukt: '+(e.code||e.message)); }
  };
  const wegBtn = $('#mTeWeg');
  if (wegBtn) wegBtn.onclick = async () => {
    if (!confirm('Deze teamevaluatie verwijderen?')) return;
    await deleteDoc(doc(db,'teams',S.teamId,'teamevaluaties',bestaande.id));
    sluitModal();
  };
}

/* --- Dashboard-berekeningen --- */
function teamEvalGemiddelde(ev){
  const vals = TEAM_CATEGORIEEN.map(c => ev.scores?.[c.id]).filter(Boolean);
  return vals.length ? vals.reduce((a,b) => a+b, 0) / vals.length : 0;
}
function teamEvalLaagsteCategorie(ev){
  let laagste = null;
  for (const c of TEAM_CATEGORIEEN){
    const s = ev.scores?.[c.id]; if (!s) continue;
    if (!laagste || s < laagste.score) laagste = {id:c.id, score:s};
  }
  return laagste;
}

/* Historie: alle ingevulde teamevaluaties van dit team (gefilterd op het
   gekozen seizoen), nieuw → oud, met een mini kleurenstrip per categorie.
   Standaard tonen we de laatste 6; "Toon eerdere" onthoudt S._histAlles
   zodat de knop niet telkens terugklapt bij een re-render. */
function htmlTeamEvalHistorie(evalsOudNieuw){
  const evals = [...evalsOudNieuw].reverse(); // nieuw → oud
  const LIMIET = 6;
  const getoond = S._histAlles ? evals : evals.slice(0, LIMIET);
  const rest = evals.length - getoond.length;

  const rij = ev => {
    const gem = teamEvalGemiddelde(ev);
    return `
    <button class="hist-item" data-open-teameval="${ev.wedstrijdId}">
      <div class="hist-cijfer" style="background:${gem?niveauKleur(Math.round(gem)):'var(--surface-2)'}">${gem?gem.toFixed(1).replace('.',','):'—'}</div>
      <div class="hist-tekst">
        <div class="hist-titel">${esc(ev.tegenstander||'Onbekend')}</div>
        <div class="hist-datum">${datumNL(ev.datum)}</div>
        <div class="hist-strip">${TEAM_CATEGORIEEN.map(c => `<span style="background:${ev.scores?.[c.id]?niveauKleur(ev.scores[c.id]):'var(--surface-2)'}"></span>`).join('')}</div>
      </div>
      <div class="hist-pijl">›</div>
    </button>`;
  };

  return `
    <div class="kaart">
      <div class="sectie-kop" style="margin-top:0">🗂️ Historie · al je evaluaties</div>
      ${getoond.map(rij).join('')}
      ${rest > 0 ? `<button class="hist-meer" data-hist-toon-meer>Toon ${rest} eerdere wedstrijd${rest===1?'':'en'}</button>` : ''}
    </div>`;
}

function htmlTeamEvaluatieDashboard(){
  const alleSeizoenen = S.statsSeizoen === 'alles';
  const evals = alleSeizoenen ? S.teamEvaluaties : S.teamEvaluaties.filter(e => e.seizoen === S.statsSeizoen); // oud → nieuw
  if (!evals.length){
    return `<div class="kaart leeg">Nog geen teamevaluaties${alleSeizoenen?'':' dit seizoen'}.<br>Vul na de eerstvolgende wedstrijd "Team evalueren" in op het wedstrijdscherm — daarna verschijnt hier de groeicurve.</div>`;
  }
  const laatste = evals[evals.length-1];
  const vorige = evals.length > 1 ? evals[evals.length-2] : null;
  const gemLaatste = teamEvalGemiddelde(laatste);
  const gemVorige = vorige ? teamEvalGemiddelde(vorige) : null;
  const verschil = gemVorige != null ? gemLaatste - gemVorige : null;

  // --- SVG-groeicurve: teamontwikkelscore per evaluatie ---
  const laatste8 = evals.slice(-8);
  const W = 300, H = 90, pad = 14;
  const punten = laatste8.map((ev,i) => {
    const x = laatste8.length > 1 ? pad + (i/(laatste8.length-1)) * (W-2*pad) : W/2;
    const g = teamEvalGemiddelde(ev);
    const y = H - pad - ((g-1)/4) * (H-2*pad); // schaal 1..5 -> boven/onder
    return {x, y};
  });
  const lijnPad = punten.map(p => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
  const laatstePunt = punten[punten.length-1];

  // --- categorieën: gemiddelde + trend over de laatste 5 evaluaties ---
  const laatste5 = evals.slice(-5);
  const vorige5  = evals.slice(-10,-5);
  const catGemiddelde = (lijst, catId) => {
    const vals = lijst.map(e => e.scores?.[catId]).filter(Boolean);
    return vals.length ? vals.reduce((a,b)=>a+b,0)/vals.length : null;
  };
  const catRijen = TEAM_CATEGORIEEN.map(c => {
    const nu = catGemiddelde(laatste5, c.id);
    const was = catGemiddelde(vorige5, c.id);
    const trend = (nu==null || was==null) ? '→' : (nu - was > 0.15 ? '↗' : nu - was < -0.15 ? '↘' : '→');
    const kleur = nu==null ? 'var(--surface-2)' : nu>=4.5?'var(--n5)':nu>=3.5?'var(--n4)':nu>=2.5?'var(--n3)':nu>=1.5?'var(--n2)':'var(--n1)';
    return {naam:c.naam, nu, trend, kleur};
  });

  // --- terugkerende aandachtspunten: welke categorie is het vaakst de laagste, laatste 4 evaluaties ---
  const laatste4 = evals.slice(-4);
  const laagsteTellingen = {};
  for (const ev of laatste4){
    const l = teamEvalLaagsteCategorie(ev); if (!l) continue;
    laagsteTellingen[l.id] = (laagsteTellingen[l.id]||0) + 1;
  }
  const signalen = Object.entries(laagsteTellingen)
    .filter(([,n]) => n >= 2)
    .sort((a,b) => b[1]-a[1])
    .map(([catId,n]) => ({cat:teamCategorie(catId), n}));
  // groeiers: categorie die het sterkst is gestegen (laatste 5 t.o.v. de 5 daarvoor)
  const groeiers = catRijen.filter(c => c.trend === '↗').sort((a,b) => (b.nu||0)-(a.nu||0)).slice(0,1);

  // --- advies: zwakste categorie van de laatste evaluatie(s), gekoppeld aan leercurve-thema indien aanwezig ---
  const adviesCat = signalen[0]?.cat || teamCategorie(teamEvalLaagsteCategorie(laatste)?.id);

  return `
    <div class="kaart">
      <div class="sectie-kop" style="margin-top:0">📈 Groeicurve</div>
      <div style="margin:4px 0 2px">
        <span style="font-family:'Barlow Condensed';font-weight:700;font-size:30px">${gemLaatste.toFixed(1).replace('.',',')}</span><span style="font-size:13px;color:var(--ink-2)"> / 5</span>
        <div style="font-size:12px;color:var(--ink-2);margin-bottom:8px">Laatste wedstrijd (${esc(laatste.tegenstander)}, ${datumNL(laatste.datum)})${verschil!=null?` · <span style="color:${verschil>=0?'var(--ok)':'var(--warn)'};font-weight:700">${verschil>=0?'↑':'↓'} ${Math.abs(verschil).toFixed(1).replace('.',',')} t.o.v. vorige</span>`:''}</div>
      </div>
      ${punten.length > 1 ? `
      <svg viewBox="0 0 ${W} ${H}" style="width:100%;height:90px">
        <polyline points="${lijnPad}" fill="none" stroke="var(--accent)" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>
        <circle cx="${laatstePunt.x}" cy="${laatstePunt.y}" r="4.5" fill="var(--accent)"/>
        <line x1="${pad}" y1="${H-pad}" x2="${W-pad}" y2="${H-pad}" stroke="var(--line-d)" stroke-width="1"/>
      </svg>` : `<p style="font-size:12.5px;color:var(--ink-2)">Nog minstens 2 evaluaties nodig voor een lijn.</p>`}
    </div>

    ${htmlTeamEvalHistorie(evals)}

    <div class="kaart">
      <div class="sectie-kop" style="margin-top:0">Categorieën · laatste ${Math.min(5,evals.length)} wedstrijden</div>
      ${catRijen.map(c => `
        <div style="display:flex;align-items:center;gap:10px;padding:7px 0;border-bottom:1px solid var(--hair)">
          <span style="flex:1;font-size:13px;font-weight:600">${esc(c.naam)}</span>
          <span style="width:80px;height:8px;border-radius:4px;background:var(--surface-2);overflow:hidden;flex-shrink:0">
            <span style="display:block;height:100%;border-radius:4px;width:${c.nu?Math.round((c.nu/5)*100):0}%;background:${c.kleur}"></span>
          </span>
          <span style="width:34px;text-align:right;font-family:'Barlow Condensed';font-weight:700;font-size:15px">${c.nu?c.nu.toFixed(1).replace('.',','):'—'}</span>
          <span style="width:16px;text-align:center;font-size:12px;color:${c.trend==='↘'?'var(--warn)':'var(--ink-2)'}">${c.trend}</span>
        </div>`).join('')}
    </div>

    <div class="kaart">
      <div class="sectie-kop" style="margin-top:0">⚠️ Terugkerende aandachtspunten</div>
      ${signalen.length ? signalen.map(s => `
        <div style="display:flex;align-items:flex-start;gap:10px;padding:9px 0;border-bottom:1px solid var(--hair)">
          <div style="width:9px;height:9px;border-radius:50%;background:var(--warn);flex-shrink:0;margin-top:5px"></div>
          <div><div style="font-weight:600;font-size:13.5px">${esc(s.cat.naam)}</div>
            <div style="font-size:12px;color:var(--ink-2);margin-top:1px">Laagst scorende onderdeel in ${s.n} van de laatste ${laatste4.length} wedstrijden.</div></div>
        </div>`).join('') : ''}
      ${groeiers.length && groeiers[0].nu ? `
        <div style="display:flex;align-items:flex-start;gap:10px;padding:9px 0;${signalen.length?'':''}">
          <div style="width:9px;height:9px;border-radius:50%;background:var(--ok);flex-shrink:0;margin-top:5px"></div>
          <div><div style="font-weight:600;font-size:13.5px">${esc(groeiers[0].naam)}</div>
            <div style="font-size:12px;color:var(--ink-2);margin-top:1px">Positieve trend de laatste wedstrijden.</div></div>
        </div>` : ''}
      ${(!signalen.length && !groeiers.length) ? `<p style="font-size:12.5px;color:var(--ink-2)">Nog geen duidelijk patroon — na een paar evaluaties verschijnen hier terugkerende punten.</p>` : ''}
    </div>

    ${adviesCat ? `
    <div class="kaart" ${adviesCat.leercurve?`data-thema-info="${esc(adviesCat.leercurve)}" style="background:linear-gradient(150deg,var(--accent),var(--grass-2));border:none;cursor:pointer"`:`style="background:linear-gradient(150deg,var(--accent),var(--grass-2));border:none"`}>
      <div style="color:rgba(255,255,255,.85);font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.4px;margin-bottom:4px">💡 Voorgesteld trainingsthema</div>
      <div style="color:#fff;font-family:'Barlow Condensed';font-weight:700;font-size:19px;text-transform:uppercase;margin-bottom:4px">${esc(adviesCat.leercurve || adviesCat.naam)}${adviesCat.leercurve?' <span style="font-size:14px;opacity:.85">›</span>':''}</div>
      <div style="color:rgba(255,255,255,.9);font-size:12.5px;line-height:1.5">${adviesCat.leercurve
        ? `Leercurve-thema uit het jeugdbeleidsplan (§3.3) — sluit direct aan op "${esc(adviesCat.naam)}", het onderdeel dat nu aandacht vraagt.`
        : `"${esc(adviesCat.naam)}" vraagt nu de meeste aandacht — geen apart leercurve-thema, wel een mooi gespreksonderwerp voor de volgende training.`}</div>
      ${adviesCat.leercurve?`<div style="color:rgba(255,255,255,.75);font-size:11px;margin-top:8px;font-weight:600">Tik voor achtergrond en oefentips →</div>`:''}
    </div>` : ''}`;
}

/* Alle seizoenen die voorkomen in de wedstrijden/presentie van dit team,
   plus het huidige seizoen (ook als er nog geen data voor is), nieuwste eerst. */
function seizoenenLijst(){
  const set = new Set();
  if (S.huidigSeizoen) set.add(S.huidigSeizoen);
  for (const w of (S.wedstrijden||[])) if (w.seizoen) set.add(w.seizoen);
  for (const p of (S.presentie||[])) if (p.seizoen) set.add(p.seizoen);
  return [...set].sort((a,b) => (parseInt(b)||0) - (parseInt(a)||0));
}
export function htmlStatsTab(){
  if (!S.statsSeizoen) S.statsSeizoen = S.huidigSeizoen || 'alles';
  const modus = S.statsSubTab || 'spelers';
  const seizoenen = seizoenenLijst();
  return `
    ${seizoenen.length ? `
    <div class="segment" id="statsSeizoen" style="margin-bottom:10px">
      ${seizoenen.map(sz => `<button data-seizoenfilter="${esc(sz)}" class="${S.statsSeizoen===sz?'actief':''}">${esc(sz)}</button>`).join('')}
      <button data-seizoenfilter="alles" class="${S.statsSeizoen==='alles'?'actief':''}">Alle</button>
    </div>` : ''}
    <div class="segment" id="statsModus" style="margin-bottom:14px">
      <button data-statsmodus="spelers" class="${modus==='spelers'?'actief':''}">Spelers</button>
      <button data-statsmodus="evaluatie" class="${modus==='evaluatie'?'actief':''}">📈 Teamevaluatie</button>
    </div>
    ${modus==='spelers' ? htmlStats() : htmlTeamEvaluatieDashboard()}`;
}

