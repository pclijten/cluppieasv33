/* ==================== TEAMEVALUATIE (na de wedstrijd) ====================
   Onderdeel van de teams.js-modulaire split. Team-niveau evaluatie na een
   wedstrijd ([20261119c/d] wedstrijd- of blokdoel + criteria per leeftijd, zie
   team-evaluatie-criteria.js; voorheen 8 categorieën) en het bijbehorende
   dashboard/geschiedenis, plus de "Stats"-tab die dit combineert met de
   spelersstatistieken uit wedstrijd.js. */
import {
  db, collection, doc, addDoc, deleteDoc, updateDoc
} from './firebase.js?v=20261106r';
import {
  S, $, $$, esc, meld, datumNL, openModal, sluitModal, toon, modAan
} from './state.js?v=20261111g';
import { SEIZOEN_FALLBACK } from './config.js?v=20261111g';
import {
  TE_GROEPEN, TE_NIV, TE_FOCUS_LADDER, TE_STEM, teDoelIco, teLeeftijd, teCriteriaVoor, teCriterium, teZichtbaar, teZinnen, teFaseLabel,
  teScores, teIsNieuw, teGem, teGroepWaarden, teCritGemiddelden, teLaagste, teKleur, teCijfer, teBlokVoorDatum,
  htmlTeNieuwMelding, koppelTeNieuwMelding, openTeNaslag
} from './team-evaluatie-criteria.js?v=20261119e';
import { ico } from './icons.js?v=20261106r';

import { htmlStats } from './wedstrijd.js?v=20261119e';
import { telGebruik } from './tracker.js?v=20261111g';

/* Kleine lokale kopie van de deelnemer-helper (ook aanwezig in teams-spelers.js)
   — bewust hier gedupliceerd i.p.v. een cross-module import voor één regel. */
function deelnemer(){
  return { uid: S.user.uid, naam: (S.team.ledenInfo?.[S.user.uid]?.naam) || S.user.displayName || S.user.email || '' };
}

/* [20261119c] Teamevaluatie in vijf stappen (zie team-evaluatie-criteria.js).
   Oude evaluaties openen in dit formulier met hun scores vertaald naar de
   nieuwe criteria; pas bij opslaan wordt het document versie 2. */
const teamLft = () => teLeeftijd(S.team?.categorie);
const afgerond = sc => Object.fromEntries(Object.entries(sc || {}).map(([k, v]) => [k, Math.max(1, Math.min(5, Math.round(v)))]));

export function modalTeamEvaluatie(wedstrijdId){
  if (!modAan('evaluaties')) return meld('Evaluaties staan uit voor dit team');
  const w = S.wedstrijden.find(x => x.id === wedstrijdId);
  if (!w) return meld('Kon de wedstrijd niet vinden, probeer de pagina te verversen');
  const bestaande = S.teamEvaluaties.find(e => e.wedstrijdId === wedstrijdId) || null;
  const lft = teamLft();
  const criteria = teCriteriaVoor(lft);
  const scores = bestaande ? afgerond(teScores(bestaande, lft)) : {};
  for (const k of Object.keys(scores)) if (!criteria.some(c => c.id === k)) delete scores[k];
  const blok = teBlokVoorDatum(S.trainingen, S.teamId, w.datum);
  const spelers = { ja:0, half:0, nee:0, ...(bestaande?.spelers || {}) };

  /* [20261119d] Stap 1: het wedstrijddoel is het doel. Zonder wedstrijddoel kies
     je één blokdoel (de paar doelen die in het blok terugkomen). */
  const wedDoel = String(w.doel || '').replace(/\s+/g, ' ').trim();
  const eerder = (bestaande?.focus || [])[0] || null;
  const blokOpties = (blok?.kern || []).map(t => ({ tekst:t, bron:'Blokdoel' }));
  if (!wedDoel && eerder && !blokOpties.some(o => o.tekst.toLowerCase() === String(eerder.tekst).toLowerCase())) blokOpties.unshift({ tekst:eerder.tekst, bron:eerder.bron || 'Blokdoel' });
  let focus = null;   // { tekst, bron, niveau, bewijs }
  if (wedDoel) focus = { tekst:wedDoel, bron:'Wedstrijddoel', niveau:0, bewijs:'' };
  else if (eerder) focus = { tekst:eerder.tekst, bron:eerder.bron || 'Blokdoel', niveau:0, bewijs:'' };
  if (focus && eerder && String(eerder.tekst).toLowerCase() === focus.tekst.toLowerCase()){ focus.niveau = Number(eerder.niveau) || 0; focus.bewijs = eerder.bewijs || ''; }

  const schaal = (sleutel, gekozen) => `<div class="vb-schaal te-schaal" data-te-schaal="${esc(sleutel)}" role="radiogroup">${[1,2,3,4,5].map(n =>
    `<button type="button" data-niv="${n}" class="kn${n}${gekozen === n ? ' gekozen' : ''}" aria-label="${TE_NIV[n]}"></button>`).join('')}</div>`;
  const anker = (n, zin, leeg) => n ? `<b style="color:var(--n${n})">${TE_NIV[n]}</b> · ${esc(zin)}` : `<i>${leeg}</i>`;

  const htmlBlokKop = () => {
    if (!blok) return '';
    const balk = blok.week && blok.weken && blok.weken <= 16
      ? `<div class="nu-blok-balk" role="img" aria-label="Week ${blok.week} van ${blok.weken}" style="--n:${blok.weken}">${Array.from({ length: blok.weken }, (_, i) =>
          `<span class="${i + 1 < blok.week ? 'af' : i + 1 === blok.week ? 'nu' : ''}"></span>`).join('')}</div>` : '';
    return `<div class="te-blok-naam">${esc(blok.naam)}</div>${blok.week && blok.weken ? `<div class="te-blok-wk">week ${blok.week} van ${blok.weken}</div>` : ''}${balk}`;
  };
  const htmlStap1 = () => {
    if (wedDoel) return `${htmlBlokKop()}
      <div class="te-doel aan vast"><span class="vk">${teDoelIco(16)}</span><span class="t">${esc(wedDoel)}<span class="bron">Wedstrijddoel</span></span></div>
      <div class="te-hint">Dit doel gaf je de wedstrijd mee. Aanpassen kan via “Wijzig opzet” op het wedstrijdscherm.</div>`;
    return `${htmlBlokKop()}
      <div class="te-geen">Er is geen wedstrijddoel aangegeven.${blokOpties.length ? ' Kies het blokdoel waar je naar keek.' : ''}</div>
      ${blokOpties.length ? `<div id="mTeDoelen" role="radiogroup">${blokOpties.map((o, i) => { const aan = focus && focus.tekst.toLowerCase() === o.tekst.toLowerCase();
        return `<button type="button" class="te-doel radio${aan ? ' aan' : ''}" data-te-doel="${i}" role="radio" aria-checked="${!!aan}"><span class="vk"></span><span class="t">${esc(o.tekst)}<span class="bron">${esc(o.bron)}</span></span></button>`; }).join('')}</div>`
        : `<div class="te-hint">Er is ook geen blok met doelen geüpload. Sla deze stap over, of geef de volgende wedstrijd een doel mee via “Wijzig opzet”.</div>`}`;
  };
  const htmlFocus = () => {
    if (!focus) return `<p class="te-hint u-mt-0">${wedDoel || blokOpties.length ? 'Kies bij stap 1 het doel.' : 'Geen doel om te beoordelen. Ga door naar stap 3.'}</p>`;
    const spoor = blok ? spoorVan(focus.tekst, blok.planId, wedstrijdId) : [];
    return `<div class="te-focus">
        <div class="te-focus-t"><span class="ic">${teDoelIco(17)}</span><span>${esc(focus.tekst)}</span></div>
        ${spoor.length ? `<div class="te-spoor"><span>Eerder dit blok</span>${spoor.map(s => `<i style="background:var(--n${s.niveau})" title="${esc(s.label)}"></i>`).join('')}</div>` : ''}
        ${schaal('f0', focus.niveau)}
        <div class="vb-anker toon te-anker" data-te-anker="f0">${anker(focus.niveau, TE_FOCUS_LADDER[focus.niveau] || '', 'Tik een kleur. De zin eronder zegt wat die betekent.')}</div>
        <textarea class="invoer" rows="2" id="mTeBewijs" placeholder="Eén moment dat je zag. Bijv. 12e min: keeper speelt in op 3, die draait open en speelt 6 aan">${esc(focus.bewijs)}</textarea>
      </div>`;
  };
  const htmlGroepen = () => TE_GROEPEN.map(g => {
    const items = g.crit.filter(c => teZichtbaar(c, lft));
    if (!items.length) return `<div class="kaart te-groep"><div class="te-groep-kop"><span class="gs-stip" style="background:${g.kleur}"></span><div><div class="gn">${esc(g.naam)}</div><div class="gs">${esc(g.sub)}</div></div></div>
      <div class="te-hint">In de leercurve vanaf O${Math.min(...g.crit.map(c => c.vanaf))}. Bij deze leeftijd nog niet beoordelen.</div></div>`;
    return `<div class="kaart te-groep"><div class="te-groep-kop"><span class="gs-stip" style="background:${g.kleur}"></span><div><div class="gn">${esc(g.naam)}</div><div class="gs">${esc(g.sub)}</div></div></div>
      ${items.map(c => { const n = scores[c.id] || 0; return `<div class="te-crit">
        <div class="te-crit-naam"><span>${esc(c.naam)}</span>${c.label ? `<span class="vb-badge te-lc">${esc(c.label)}</span>` : ''}${c.fase ? `<span class="vb-badge">${esc(teFaseLabel(lft))}</span>` : ''}<span class="te-overslaan" data-te-over="${c.id}">${n ? '' : 'overslaan mag'}</span></div>
        ${schaal(c.id, n)}
        <div class="vb-anker toon te-anker" data-te-anker="${c.id}">${anker(n, n ? teZinnen(c, lft)[n - 1] : '', 'Niet gezien? Sla over.')}</div>
        ${c.fase ? `<div class="te-hint">Vanaf O14 in tweeën: na balverlies en na balwinst (leercurve).</div>` : ''}</div>`; }).join('')}
    </div>`;
  }).join('');
  const vraag = () => `Vraag het in de kleedkamer${focus ? `: <b>“Lukte het ons: ${esc(focus.tekst.charAt(0).toLowerCase() + focus.tekst.slice(1))}?”</b>` : '. Lukte ons doel?'} Laat de spelers kiezen: ja, deels of nee.`;
  const stemOpen = spelers.ja + spelers.half + spelers.nee > 0;

  openModal(`
    <h2>${bestaande ? 'Team-evaluatie bijwerken' : 'Team evalueren'}</h2>
    <div class="snel-kop">
      <div class="mini-shirt">${ico('football-lineup', 20)}</div>
      <div><div class="nm">${esc(S.team.naam)} – ${esc(w.tegenstander)}</div>
        <div class="pos">${datumNL(w.datum)}${w.thuis!=null?(w.thuis?'<span class="sep" aria-hidden="true"></span>Thuis':'<span class="sep" aria-hidden="true"></span>Uit'):''}</div></div>
    </div>
    ${htmlTeNieuwMelding()}
    <button type="button" class="vb-naslag-link compact" data-te-naslag><span class="ic">${ico('training-plan', 18)}</span><span class="tx">Zo evalueren we<small>Eerst het doel, dan wat je zag</small></span><span class="vb-pijl">${ico('navigation-forward', 16)}</span></button>
    ${bestaande && !teIsNieuw(bestaande) ? `<div class="te-oud">Deze evaluatie is gemaakt met de oude vragen. De scores staan alvast bij de nieuwe onderdelen; controleer ze voor je opslaat.</div>` : ''}
    <div class="te-voortgang" id="mTeVoortgang"></div>

    <div class="kaart te-blok"><div class="te-stapkop"><span class="te-stap">1</span><span class="vb-veldlabel">Waar werkten we aan?</span></div><div id="mTeStap1">${htmlStap1()}</div></div>
    <div class="kaart"><div class="te-stapkop"><span class="te-stap">2</span><span class="vb-veldlabel">Zagen we het terug?</span></div><div id="mTeFocus">${htmlFocus()}</div></div>
    <div class="kaart"><div class="te-stapkop"><span class="te-stap">3</span><span class="vb-veldlabel">Wat zag je per moment?</span><span class="vb-aantal" id="mTeCritTel"></span></div>
      <p class="te-hint u-mt-0">Tik een kleur en lees de zin eronder: klopt die met wat je zag? Niet gezien of geen tijd? Sla het over.</p>
      <div class="vb-legenda"><span>AAND</span><span>OP WEG</span><span>PRIMA</span><span>STERK</span><span>UITBL</span></div></div>
    ${htmlGroepen()}
    <div class="kaart"><button type="button" class="te-uitklap" data-te-klap aria-expanded="${stemOpen}"><span class="te-stap stil">4</span><span class="vb-veldlabel">Wat vonden de spelers? <span class="te-opt">(optioneel)</span></span><span class="te-chevron">${ico('navigation-forward', 16)}</span></button>
      <div class="te-uitklap-in${stemOpen ? ' open' : ''}">
        <p class="te-hint u-mt-xs" id="mTeVraag">${vraag()}</p>
        <div class="te-stem">${TE_STEM.map(o => `<div><div class="e" style="color:${o.kleur}">${ico(o.ico, 22)}<small>${o.label}</small></div><div class="tel"><button type="button" data-te-stem="${o.id}" data-d="-1" aria-label="${o.label} min één">−</button><b data-te-stemval="${o.id}">${spelers[o.id] || 0}</b><button type="button" data-te-stem="${o.id}" data-d="1" aria-label="${o.label} plus één">+</button></div></div>`).join('')}</div>
        <div class="te-hint">Wijkt hun oordeel af van het jouwe? Dat is een mooi begin van de volgende teambespreking.</div></div></div>

    <div class="kaart"><div class="vb-veldlabel u-mb-xs">Opvallend (optioneel)</div>
      <textarea class="invoer" id="mTeOpvallend" rows="3" placeholder="Wat viel je op? Bijv. sterke tweede helft, de druk vooraan leverde balwinst op">${esc(bestaande?.opvallend || '')}</textarea></div>

    <button class="knop vol fluo u-mt-sm" id="mTeOk">${bestaande?'Bijwerken':'Opslaan'}</button>
    ${bestaande?`<button class="knop vol gevaar u-mt-xs" id="mTeWeg">Verwijderen</button>`:''}
    <p class="u-t-xs u-zacht u-mt-sm u-lh-ruim">Alleen zichtbaar voor coaches. De uitslag staat bewust niet op dit scherm.</p>
  `);

  const root = $('#modalInhoud');
  koppelTeNieuwMelding(root);
  const tel = () => {
    const k = criteria.filter(c => scores[c.id]).length;
    const ct = $('#mTeCritTel'); if (ct) ct.textContent = `${k} van ${criteria.length}`;
    const v = $('#mTeVoortgang');
    if (v) v.innerHTML = `Doel <b>${focus?.niveau ? 'beoordeeld' : focus ? 'nog kiezen' : 'geen'}</b><span class="sep" aria-hidden="true"></span>Momenten <b>${k} van ${criteria.length}</b>`;
    const vr = $('#mTeVraag'); if (vr) vr.innerHTML = vraag();
  };
  const bewaarBewijs = () => { const t = $('#mTeBewijs'); if (t && focus) focus.bewijs = t.value; };

  root.addEventListener('click', e => {
    if (e.target.closest('[data-te-naslag]')) { openTeNaslag(lft); return; }
    const d = e.target.closest('[data-te-doel]');
    if (d){
      bewaarBewijs();
      const o = blokOpties[Number(d.dataset.teDoel)];
      const zelfde = focus && focus.tekst.toLowerCase() === o.tekst.toLowerCase();
      focus = zelfde ? null : { tekst:o.tekst, bron:o.bron, niveau:0, bewijs:'' };
      root.querySelectorAll('[data-te-doel]').forEach(x => { const aan = !zelfde && x === d; x.classList.toggle('aan', aan); x.setAttribute('aria-checked', aan); });
      $('#mTeFocus').innerHTML = htmlFocus(); tel(); return;
    }
    const b = e.target.closest('[data-te-schaal] [data-niv]');
    if (b){
      const sl = b.closest('[data-te-schaal]').dataset.teSchaal, n = Number(b.dataset.niv);
      if (sl === 'f0'){
        if (!focus) return;
        focus.niveau = focus.niveau === n ? 0 : n;
        b.parentElement.querySelectorAll('[data-niv]').forEach(x => x.classList.toggle('gekozen', Number(x.dataset.niv) === focus.niveau));
        root.querySelector('[data-te-anker="f0"]').innerHTML = anker(focus.niveau, TE_FOCUS_LADDER[focus.niveau] || '', 'Tik een kleur. De zin eronder zegt wat die betekent.');
      } else {
        const c = criteria.find(x => x.id === sl); if (!c) return;
        if (scores[sl] === n) delete scores[sl]; else scores[sl] = n;
        const m = scores[sl] || 0;
        b.parentElement.querySelectorAll('[data-niv]').forEach(x => x.classList.toggle('gekozen', Number(x.dataset.niv) === m));
        root.querySelector(`[data-te-anker="${sl}"]`).innerHTML = anker(m, m ? teZinnen(c, lft)[m - 1] : '', 'Niet gezien? Sla over.');
        const o = root.querySelector(`[data-te-over="${sl}"]`); if (o) o.textContent = m ? '' : 'overslaan mag';
      }
      tel(); return;
    }
    const kl = e.target.closest('[data-te-klap]');
    if (kl){ const open = kl.getAttribute('aria-expanded') !== 'true'; kl.setAttribute('aria-expanded', open); kl.nextElementSibling.classList.toggle('open', open); return; }
    const st = e.target.closest('[data-te-stem]');
    if (st){ const k = st.dataset.teStem; spelers[k] = Math.max(0, Math.min(40, (spelers[k] || 0) + Number(st.dataset.d)));
      root.querySelector(`[data-te-stemval="${k}"]`).textContent = spelers[k]; return; }
  });
  tel();

  $('#mTeOk').onclick = async () => {
    bewaarBewijs();
    const f = focus && (focus.niveau || (focus.bewijs || '').trim()) ? [{ tekst:focus.tekst, bron:focus.bron || '', niveau:focus.niveau || null, bewijs:(focus.bewijs || '').trim() }] : [];
    if (!Object.keys(scores).length && !f.some(x => x.niveau)) return meld('Kies minstens één kleur, bij het doel of bij een moment');
    const ok = await bewaarTeamEvaluatie(wedstrijdId, {
      scores, focus:f, lft, opvallend:$('#mTeOpvallend').value.trim(),
      spelers: (spelers.ja + spelers.half + spelers.nee) ? { ja:spelers.ja, half:spelers.half, nee:spelers.nee } : null,
      blok: blok ? { planId:blok.planId, naam:blok.naam, blok:blok.blok, week:blok.week, weken:blok.weken } : null,
    });
    if (ok) sluitModal();
  };
  const wegBtn = $('#mTeWeg');
  if (wegBtn) wegBtn.onclick = async () => {
    if (!confirm('Deze teamevaluatie verwijderen?')) return;
    await deleteDoc(doc(db,'teams',S.teamId,'teamevaluaties',bestaande.id));
    sluitModal();
  };
}

/* Niveaus van een blokdoel bij eerdere wedstrijden in hetzelfde blok (oud → nieuw). */
function spoorVan(tekst, planId, behalveWedstrijd){
  const k = String(tekst || '').toLowerCase();
  return (S.teamEvaluaties || []).filter(e => e.blok?.planId === planId && e.wedstrijdId !== behalveWedstrijd)
    .sort((a, b) => (a.datum || '').localeCompare(b.datum || ''))
    .map(e => { const f = (e.focus || []).find(x => String(x.tekst || '').toLowerCase() === k && x.niveau); return f ? { niveau:f.niveau, label:`${e.tegenstander || ''}, ${datumNL(e.datum)}` } : null; })
    .filter(Boolean);
}

/* [20260923a] Opslaan van een teamevaluatie, gedeeld door de modal hierboven.
   [20261119c] Nieuwe velden (versie 2); oude documenten blijven ongewijzigd
   tot ze opnieuw worden opgeslagen. Geeft true terug bij succes. */
export async function bewaarTeamEvaluatie(wedstrijdId, { scores, tags, notitieGoed, notitieAandacht, opvallend, focus = [], vervolg, spelers = null, blok = null, lft = null }){
  const w = S.wedstrijden.find(x => x.id === wedstrijdId);
  if (!w){ meld('Kon de wedstrijd niet vinden, probeer de pagina te verversen'); return false; }
  if ((!scores || !Object.keys(scores).length) && !(focus || []).some(f => f.niveau)){ meld('Kies minstens één kleur'); return false; }
  const bestaande = S.teamEvaluaties.find(e => e.wedstrijdId === wedstrijdId) || null;
  const data = {
    wedstrijdId, tegenstander:w.tegenstander, datum:w.datum, scores: scores || {},
    versie:2, lft: lft ?? teamLft(), focus, spelers, blok,
    door:deelnemer(), gemaaktMs:Date.now(),
  };
  /* [20261119d] Alleen meegeven wat het venster nog vraagt; bestaande tags,
     notities en vervolg van eerdere evaluaties blijven zo bewaard. */
  if (opvallend !== undefined) data.opvallend = opvallend;
  if (tags !== undefined) data.tags = [...tags];
  if (notitieGoed !== undefined) data.notitieGoed = notitieGoed;
  if (notitieAandacht !== undefined) data.notitieAandacht = notitieAandacht;
  if (vervolg !== undefined) data.vervolg = vervolg;
  if (!bestaande) data.seizoen = S.huidigSeizoen || SEIZOEN_FALLBACK;
  try {
    if (bestaande) await updateDoc(doc(db,'teams',S.teamId,'teamevaluaties',bestaande.id), data);
    else await addDoc(collection(db,'teams',S.teamId,'teamevaluaties'), data);
    telGebruik('team_evaluatie');
    meld('Teamevaluatie opgeslagen');
    return true;
  } catch(e){ meld('Opslaan mislukt: '+(e.code||e.message)); return false; }
}

/* --- Dashboard (Wedstrijden → Evaluatie) ---
   [20261119c] Geen totaalcijfer meer: per groep, per criterium en de
   Blokspiegel (blokdoelen per week). Oude evaluaties tellen mee via teScores(). */
const stip = v => `<i style="background:${teKleur(v)}"></i>`;
function trendVan(nu, was){
  if (nu == null || was == null) return { sym:'→', kleur:'var(--ink-2)' };
  return nu - was > 0.15 ? { sym:'↑', kleur:'var(--ok)' } : nu - was < -0.15 ? { sym:'↓', kleur:'var(--warn)' } : { sym:'→', kleur:'var(--ink-2)' };
}

function htmlBlokspiegel(evals, lft){
  const blok = teBlokVoorDatum(S.trainingen, S.teamId, new Date().toISOString().slice(0, 10));
  const planId = blok?.planId || [...evals].reverse().find(e => e.blok?.planId)?.blok?.planId;
  if (!planId) return '';
  const inBlok = evals.filter(e => e.blok?.planId === planId);
  const info = blok?.planId === planId ? blok : inBlok[inBlok.length - 1]?.blok;
  const weken = Number(info?.weken) || Math.max(1, ...inBlok.map(e => Number(e.blok?.week) || 1));
  const doelen = new Map();
  for (const e of inBlok) for (const f of (e.focus || [])) if (f.niveau){
    const k = String(f.tekst).toLowerCase();
    if (!doelen.has(k)) doelen.set(k, { tekst:f.tekst, perWeek:{}, n:0 });
    const d = doelen.get(k), wk = Number(e.blok?.week) || 0; d.n++;
    d.perWeek[wk] = Math.max(d.perWeek[wk] || 0, Number(f.niveau));
  }
  const balk = info?.week && weken <= 16 ? `<div class="nu-blok-balk" style="--n:${weken}">${Array.from({ length: weken }, (_, i) => `<span class="${i + 1 < info.week ? 'af' : i + 1 === info.week ? 'nu' : ''}"></span>`).join('')}</div>` : '';
  return `<div class="kaart te-blok">
    <div class="sectie-kop u-mt-0">${ico('training-plan', 16)} Blokspiegel</div>
    <div class="te-blok-naam">${esc(info?.naam || 'Blok')}</div>
    <div class="te-blok-wk">${info?.week ? `week ${info.week} van ${weken}<span class="sep" aria-hidden="true"></span>` : ''}${inBlok.length} wedstrijd${inBlok.length === 1 ? '' : 'en'} geëvalueerd</div>${balk}
    ${doelen.size ? [...doelen.values()].map(d => {
      const reeks = Array.from({ length: weken }, (_, i) => d.perWeek[i + 1] || null);
      const gevuld = reeks.filter(Boolean), tr = trendVan(gevuld[gevuld.length - 1], gevuld.length > 1 ? gevuld[gevuld.length - 2] : null);
      return `<div class="te-spiegel-rij"><span class="nm">${esc(d.tekst)}<small>${d.n}× gekozen</small></span>
        <span class="te-stippen">${reeks.map((v, i) => v ? stip(v) : `<i class="${info?.week && i + 1 > info.week ? 'te-o' : 'te-l'}"></i>`).join('')}</span>
        <span class="te-trend" style="color:${tr.kleur}">${gevuld.length > 1 ? tr.sym : '–'}</span></div>`; }).join('')
      : `<p class="te-hint">Nog geen doel beoordeeld in dit blok.</p>`}
    <div class="te-hint">Elk vakje is een week van het blok. Gestippeld: nog te spelen.</div>
  </div>`;
}

function htmlTeamEvalHistorie(evalsOudNieuw, lft){
  const evals = [...evalsOudNieuw].reverse();
  const LIMIET = 6;
  const getoond = S._histAlles ? evals : evals.slice(0, LIMIET);
  const rest = evals.length - getoond.length;
  const crit = teCriteriaVoor(lft);
  const rij = ev => {
    const sc = teScores(ev, lft), f = (ev.focus || []).find(x => x.niveau);
    return `
    <button class="hist-item" data-open-teameval="${ev.wedstrijdId}">
      <div class="hist-cijfer te-hist-doel" style="background:${f ? `var(--n${f.niveau})` : 'var(--surface-2)'}" title="${f ? esc('Doel: ' + TE_NIV[f.niveau]) : ''}">${f ? teDoelIco(18) : (teIsNieuw(ev) ? '–' : 'oud')}</div>
      <div class="hist-tekst">
        <div class="hist-titel">${esc(ev.tegenstander||'Onbekend')}</div>
        <div class="hist-datum">${datumNL(ev.datum)}${f ? `<span class="sep" aria-hidden="true"></span>${esc(f.tekst)}` : ''}</div>
        <div class="hist-strip">${crit.map(c => `<span style="background:${sc[c.id] ? teKleur(sc[c.id]) : 'var(--surface-2)'}"></span>`).join('')}</div>
      </div>
      <div class="hist-pijl">›</div>
    </button>`;
  };
  return `
    <div class="kaart">
      <div class="sectie-kop u-mt-0">${ico('admin-protocol', 16)} Historie<span class="sep" aria-hidden="true"></span>al je evaluaties</div>
      ${getoond.map(rij).join('')}
      ${rest > 0 ? `<button class="hist-meer" data-hist-toon-meer>Toon ${rest} eerdere wedstrijd${rest===1?'':'en'}</button>` : ''}
      <div class="te-hint">Gekleurd vakje met doel-icoon: kleur van het doel. “oud”: gemaakt met de vragen van vóór 19 november; die tellen mee via een vertaling.</div>
    </div>`;
}

export function htmlTeamEvaluatieDashboard(){
  const alleSeizoenen = S.statsSeizoen === 'alles';
  const evals = (alleSeizoenen ? S.teamEvaluaties : S.teamEvaluaties.filter(e => e.seizoen === S.statsSeizoen))
    .filter(e => e.scores || e.focus).sort((a, b) => (a.datum || '').localeCompare(b.datum || '') || (a.gemaaktMs || 0) - (b.gemaaktMs || 0));
  if (!evals.length){
    return `<div class="kaart leeg">Nog geen teamevaluaties${alleSeizoenen?'':' dit seizoen'}.<br>Vul na de eerstvolgende wedstrijd "Team evalueren" in op het wedstrijdscherm, daarna verschijnt hier de Blokspiegel.</div>`;
  }
  const lft = teamLft();
  const laatste5 = evals.slice(-5), vorige5 = evals.slice(-10, -5);
  const nu = teCritGemiddelden(laatste5, lft), was = teCritGemiddelden(vorige5, lft);

  /* per groep: stip per wedstrijd (laatste 5) + trend */
  const groepRijen = TE_GROEPEN.map(g => {
    const zicht = g.crit.filter(c => teZichtbaar(c, lft)); if (!zicht.length) return '';
    const reeks = laatste5.map(e => teGroepWaarden(teScores(e, lft), lft)[g.id]);
    const gemNu = teGem(zicht.map(c => nu[c.id])), gemWas = teGem(zicht.map(c => was[c.id]));
    const tr = trendVan(gemNu, gemWas);
    return `<div class="te-spiegel-rij"><span class="nm"><span class="gs-stip" style="background:${g.kleur}"></span>${esc(g.naam)}<small>${zicht.map(c => esc(c.kort)).join(' · ')}</small></span>
      <span class="te-stippen">${reeks.map(v => v ? stip(v) : '<i class="te-l"></i>').join('')}</span><span class="te-trend" style="color:${tr.kleur}">${tr.sym}</span></div>`;
  }).join('');

  /* criteria: gemiddelde laatste 5 + trend */
  const critRijen = teCriteriaVoor(lft).map(c => {
    const v = nu[c.id], tr = trendVan(v, was[c.id]);
    return `<div class="te-crit-rij">
      <span class="gs-stip" style="background:${c.groepKleur}"></span><span class="u-flex-1 u-t-sm u-fw-6">${esc(c.naam)}</span>
      <span class="te-balk"><span style="width:${v ? Math.round(v / 5 * 100) : 0}%;background:${teKleur(v)}"></span></span>
      <span class="te-cijfer">${teCijfer(v)}</span><span class="te-trend" style="color:${tr.kleur}">${tr.sym}</span></div>`;
  }).join('');

  /* terugkerende aandachtspunten: criterium vaak het laagst én onder Prima */
  const laatste4 = evals.slice(-4), tellingen = {};
  for (const ev of laatste4){ const l = teLaagste(teScores(ev, lft), lft); if (l) tellingen[l.id] = (tellingen[l.id] || 0) + 1; }
  const signalen = Object.entries(tellingen).filter(([id, n]) => n >= 2 && (nu[id] ?? 5) < 3).sort((a, b) => b[1] - a[1]).map(([id, n]) => ({ c:teCriterium(id), n }));
  const groeier = teCriteriaVoor(lft).map(c => ({ c, v:nu[c.id], d:(nu[c.id] ?? 0) - (was[c.id] ?? 99) })).filter(x => x.v != null && x.d > 0.15).sort((a, b) => b.d - a.d)[0];
  const advies = signalen[0]?.c || teCriterium(teLaagste(nu, lft)?.id);

  return `
    ${htmlBlokspiegel(evals, lft)}
    <div class="kaart">
      <div class="sectie-kop u-mt-0">${ico('stats-bars', 16)} Per moment<span class="sep" aria-hidden="true"></span>laatste ${laatste5.length} wedstrijd${laatste5.length === 1 ? '' : 'en'}</div>
      ${groepRijen}
      <div class="te-hint">Geen totaalcijfer: verdedigen en plezier zijn geen optelsom.</div>
    </div>
    ${htmlTeamEvalHistorie(evals, lft)}
    <div class="kaart">
      <div class="sectie-kop u-mt-0">Onderdelen<span class="sep" aria-hidden="true"></span>gemiddelde laatste ${laatste5.length}</div>
      ${critRijen}
    </div>
    <div class="kaart">
      <div class="sectie-kop u-mt-0">${ico('tag-agreement-warn', 16)} Terugkerende aandachtspunten</div>
      ${signalen.map(s => `<div class="te-sig"><span class="gs-stip" style="background:var(--warn)"></span><div><div class="u-fw-6 u-t-md">${esc(s.c.naam)}</div>
        <div class="u-t-xs u-zacht">Laagst beoordeelde onderdeel in ${s.n} van de laatste ${laatste4.length} wedstrijden.</div></div></div>`).join('')}
      ${groeier ? `<div class="te-sig"><span class="gs-stip" style="background:var(--ok)"></span><div><div class="u-fw-6 u-t-md">${esc(groeier.c.naam)}</div><div class="u-t-xs u-zacht">Positieve trend de laatste wedstrijden.</div></div></div>` : ''}
      ${(!signalen.length && !groeier) ? `<p class="u-t-sm u-zacht">Nog geen duidelijk patroon, na een paar evaluaties verschijnen hier terugkerende punten.</p>` : ''}
    </div>
    ${advies ? `
    <div class="kaart" ${advies.leercurve?`data-thema-info="${esc(advies.leercurve)}" style="background:linear-gradient(150deg,var(--accent),var(--grass-2));border:none;cursor:pointer"`:`style="background:linear-gradient(150deg,var(--accent),var(--grass-2));border:none"`}>
      <div class="u-t-2xs u-fw-7 u-mb-2xs" style="color:color-mix(in srgb, var(--wit) 85%, transparent);text-transform:uppercase;letter-spacing:.4px">Voorgesteld trainingsthema</div>
      <div class="u-fw-7 u-t-2xl u-mb-2xs" style="color:var(--wit);font-family:'Barlow Condensed';text-transform:uppercase">${esc(advies.leercurve || advies.naam)}${advies.leercurve?' <span class="u-t-md" style="opacity:.85">›</span>':''}</div>
      <div class="u-t-sm u-lh-ruim" style="color:color-mix(in srgb, var(--wit) 90%, transparent)">${advies.leercurve
        ? `Leercurve-thema uit het jeugdbeleidsplan (§3.3), sluit aan op "${esc(advies.naam)}", het onderdeel dat nu aandacht vraagt.`
        : `"${esc(advies.naam)}" vraagt nu de meeste aandacht, geen apart leercurve-thema, wel een mooi gespreksonderwerp voor de volgende training.`}</div>
      ${advies.leercurve?`<div class="u-t-2xs u-mt-xs u-fw-6" style="color:color-mix(in srgb, var(--wit) 75%, transparent)">Tik voor achtergrond en oefentips →</div>`:''}
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
/* Seizoensfilter (huidig seizoen + "Alle", oudere seizoenen als tweede rij).
   Gedeeld door de Stats-tab (spelersstatistieken) en de Evaluatie-pagina
   (teamevaluatie-dashboard); beide binden data-seizoenfilter zelf. */
export function htmlSeizoenFilter(){
  if (!S.statsSeizoen) S.statsSeizoen = S.huidigSeizoen || 'alles';
  const seizoenen = seizoenenLijst();
  if (!seizoenen.length) return '';
  const huidig = S.huidigSeizoen || seizoenen[0];
  const oudere = seizoenen.filter(sz => sz !== huidig); // eerdere seizoenen
  const alleActief = S.statsSeizoen === 'alles' || oudere.includes(S.statsSeizoen);
  return `
    <div class="segment" id="statsSeizoen" style="margin-bottom:${alleActief && oudere.length ? '8' : '10'}px">
      ${huidig ? `<button data-seizoenfilter="${esc(huidig)}" class="${S.statsSeizoen===huidig?'actief':''}">${esc(huidig)}</button>` : ''}
      <button data-seizoenfilter="alles" class="${alleActief?'actief':''}">Alle</button>
    </div>
    ${alleActief && oudere.length ? `
    <div class="segment segment-sub u-mb-sm" id="statsSeizoenOud" >
      <button data-seizoenfilter="alles" class="${S.statsSeizoen==='alles'?'actief':''}">Alle seizoenen</button>
      ${oudere.map(sz => `<button data-seizoenfilter="${esc(sz)}" class="${S.statsSeizoen===sz?'actief':''}">${esc(sz)}</button>`).join('')}
    </div>` : ''}`;
}

/* De Stats-tab bevat sinds de hub-navigatie alleen nog de spelersstatistieken;
   het teamevaluatie-dashboard woont op de Evaluatie-pagina (hub-tegel
   Wedstrijden → Evaluatie, samengesteld in teams.js). */
export function htmlStatsTab(){
  return htmlSeizoenFilter() + htmlStats() + `
    <button class="knop licht vol u-mt-md" id="statsExcelExport" >
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M4 19V10"/><path d="M11 19V5"/><path d="M18 19v-7"/></svg> Exporteer naar Excel</button>`;
}

