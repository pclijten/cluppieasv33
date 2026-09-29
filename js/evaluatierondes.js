/* ==================== EVALUATIERONDES ====================
   [20260929a] De clubbeheerder zet een verplichte evaluatieronde klaar
   (bijv. "Najaarsevaluatie 2026") voor een zelfgekozen set teams. Coaches
   zien de ronde bovenaan hun team en beoordelen per speler; beheerder en
   bouwcoördinatoren volgen de voortgang.

   Opslag: alleen op het clubdocument (alleen een clubadmin mag dat wijzigen,
   dus geen rules-wijziging nodig), veld
     evaluatieRondes: [{ id, naam, soort:'volledig'|'snel', van, tot,
                         teams:[teamId…], status:'open'|'gesloten', seizoen,
                         gemaaktMs, resultaat?:{klaar,totaal}, geslotenMs? }]
   Een beoordeling in een ronde krijgt `ronde: <id>` (teams/{id}/beoordelingen).
   Een volledige beoordeling in een ronde krijgt daarnaast `officieel: true`,
   zodat de bestaande "halfjaar"-weergaven blijven werken.
   Na de einddatum blijft invullen mogelijk; het team kleurt dan rood.

   Dit bestand importeert niets uit club.js of teams*.js (geen kringimport):
   club.js geeft een klein api-object mee voor hertekenen en berichten. */
import { db, collection, doc, getDocs, query, where, updateDoc, addDoc, serverTimestamp } from './firebase.js?v=20260922c';
import { S, esc, meld } from './state.js?v=20260922c';
import { SEIZOEN_FALLBACK } from './config.js?v=20260922c';
import { ico } from './icons.js?v=20260922c';

/* ---------- pure hulpjes (ook gebruikt door team-hub, bouw-hub, desktop) ---------- */
export function rondesVan(club){ return Array.isArray(club?.evaluatieRondes) ? club.evaluatieRondes.filter(r => r && r.id) : []; }
const vandaagIso = () => new Date().toISOString().slice(0, 10);
export function rondeLoopt(r){ return !!r && r.status !== 'gesloten' && (!r.van || r.van <= vandaagIso()); }
/* Lopende rondes van één team, de eerstvolgende einddatum eerst. */
export function rondesVoorTeam(rondes, teamId){
  return (rondes || []).filter(r => rondeLoopt(r) && (r.teams || []).includes(teamId))
    .sort((a, b) => (a.tot || '9999').localeCompare(b.tot || '9999'));
}
/* Spelers die meetellen: geen gastspelers en geen ingeleende spelers (die horen bij hun eigen team). */
export function rondeSpelers(spelers){ return (spelers || []).filter(p => p && !p.gast && !p._ingeleend); }
export function rondeTelling(ronde, spelers, beoordelingen){
  const ids = new Set(rondeSpelers(spelers).map(p => p.id));
  const klaar = new Set((beoordelingen || []).filter(b => b.ronde === ronde.id && ids.has(b.spelerId)).map(b => b.spelerId)).size;
  return { klaar, totaal: ids.size };
}
export function datumKort(iso){
  if (!iso) return '';
  try { return new Date(iso + 'T12:00').toLocaleDateString('nl-NL', { day:'numeric', month:'short' }); } catch(e){ return iso; }
}
export function dagenTot(iso){
  if (!iso) return null;
  return Math.ceil((new Date(iso + 'T23:59:59') - new Date()) / 864e5);
}
const soortTekst = s => s === 'snel' ? 'snelle beoordeling' : 'volledige beoordeling';
const pctKleur = (pct, verlopen) => pct >= 100 ? 'var(--ok)' : (verlopen || pct < 50) ? 'var(--uit)' : 'var(--warn)';
const balk = (pct, kleur) => `<div class="cb-balk"><span style="width:${Math.max(0, Math.min(100, pct))}%;background:${kleur}"></span></div>`;

/* Status van de lopende ronde van een team, voor pills op bouw-dashboards. */
export function rondeStatusTeam(rondes, teamId, spelers, beoordelingen){
  const r = rondesVoorTeam(rondes, teamId)[0];
  if (!r) return null;
  const { klaar, totaal } = rondeTelling(r, spelers, beoordelingen);
  return { ronde:r, klaar, totaal, klaarAlles: totaal > 0 && klaar >= totaal };
}

/* ---------- coach: balk bovenaan de team-hub ---------- */
export function htmlRondeBalk(rondes, teamId, spelers, beoordelingen){
  const lopend = rondesVoorTeam(rondes, teamId);
  if (!lopend.length) return '';
  return lopend.map(r => {
    const { klaar, totaal } = rondeTelling(r, spelers, beoordelingen);
    const pct = totaal ? Math.round(klaar / totaal * 100) : 0;
    const d = dagenTot(r.tot);
    const verlopen = d != null && d < 0;
    const kleur = pctKleur(pct, verlopen);
    const termijn = r.tot ? (verlopen ? `einddatum ${datumKort(r.tot)} is verstreken` : `t/m ${datumKort(r.tot)}`) : '';
    if (totaal && klaar >= totaal) return `
      <div class="cb-rondebalk klaar"><div class="cb-rondebalk-kop">${ico('action-check', 20)}
        <div class="cb-team-naam">${esc(r.naam)}<small>Alle ${totaal} spelers zijn beoordeeld. Top!</small></div></div></div>`;
    return `
      <div class="cb-rondebalk">
        <div class="cb-rondebalk-kop">${ico('attendance-evaluatie', 20)}
          <div class="cb-team-naam">${esc(r.naam)}<small>Vul voor elke speler een ${soortTekst(r.soort)} in${termijn ? ' · ' + esc(termijn) : ''}</small></div></div>
        <div class="cb-ronde-cijfers"><b style="color:${kleur}">${klaar}/${totaal}</b><span>spelers gedaan</span></div>
        ${balk(pct, kleur)}
        <button class="knop fluo vol" data-ronde-start="${esc(r.id)}" style="margin-top:10px">${klaar ? 'Verder met de volgende speler' : 'Beginnen'} →</button>
      </div>`;
  }).join('');
}

/* ==================== BEHEER (Club → Evaluaties) ==================== */
/* Voortgang per ronde per team: { rondeId: { teamId: {klaar, totaal} } }.
   Leest per betrokken team de spelers en alleen de beoordelingen met een ronde-id. */
let cache = null;   // { sleutel, tijd, data }
export function rondeCacheWeg(){ cache = null; }
export async function voortgangOphalen(teams, rondes){
  const ids = rondes.map(r => r.id).slice(0, 30);
  if (!ids.length) return {};
  const sleutel = ids.join(',') + '|' + rondes.map(r => (r.teams || []).join('.')).join('|');
  if (cache && cache.sleutel === sleutel && Date.now() - cache.tijd < 60000) return cache.data;
  const betrokken = teams.filter(t => rondes.some(r => (r.teams || []).includes(t.id)));
  const perTeam = await Promise.all(betrokken.map(async t => {
    try {
      const [ssnap, bsnap] = await Promise.all([
        getDocs(collection(db, 'teams', t.id, 'spelers')),
        getDocs(query(collection(db, 'teams', t.id, 'beoordelingen'), where('ronde', 'in', ids))),
      ]);
      return { t, spelers: ssnap.docs.map(d => ({ id:d.id, ...d.data() })), beoordelingen: bsnap.docs.map(d => ({ id:d.id, ...d.data() })) };
    } catch(e){
      console.warn('[Cluppie] evaluatierondes: team niet gelezen', t.naam, e.code || e.message);
      return { t, spelers: [], beoordelingen: [], fout: true };
    }
  }));
  const data = {};
  for (const r of rondes){
    data[r.id] = {};
    for (const x of perTeam) if ((r.teams || []).includes(x.t.id)) data[r.id][x.t.id] = { ...rondeTelling(r, x.spelers, x.beoordelingen), fout: !!x.fout };
  }
  cache = { sleutel, tijd: Date.now(), data };
  return data;
}
function som(per){
  let klaar = 0, totaal = 0;
  Object.values(per || {}).forEach(v => { klaar += v.klaar; totaal += v.totaal; });
  return { klaar, totaal, pct: totaal ? Math.round(klaar / totaal * 100) : 0 };
}

/* Overzicht van alle rondes. `voortgang` = uitkomst van voortgangOphalen voor de lopende rondes. */
export function htmlEvalRondes(rondes, voortgang){
  const lopend = rondes.filter(r => r.status !== 'gesloten').sort((a, b) => (a.tot || '').localeCompare(b.tot || ''));
  const dicht = rondes.filter(r => r.status === 'gesloten').sort((a, b) => (b.tot || '').localeCompare(a.tot || ''));
  const kaart = r => {
    const s = r.status === 'gesloten' ? { ...(r.resultaat || { klaar:0, totaal:0 }), pct: r.resultaat?.totaal ? Math.round(r.resultaat.klaar / r.resultaat.totaal * 100) : 0 } : som(voortgang[r.id]);
    const d = dagenTot(r.tot), verlopen = r.status !== 'gesloten' && d != null && d < 0;
    const kleur = pctKleur(s.pct, verlopen);
    const nogNiet = r.van && r.van > vandaagIso() && r.status !== 'gesloten';
    const achter = r.status === 'gesloten' ? 0 : Object.values(voortgang[r.id] || {}).filter(v => v.klaar < v.totaal).length;
    const termijn = r.status === 'gesloten' ? '<span class="cb-st">Afgesloten</span>'
      : nogNiet ? `<span class="cb-st">${ico('planning-calendar', 12)} start ${esc(datumKort(r.van))}</span>`
      : r.tot ? `<span class="cb-st ${verlopen || d <= 14 ? 'let' : ''}">${ico('planning-calendar', 12)} ${verlopen ? 'verlopen ' + esc(datumKort(r.tot)) : 't/m ' + esc(datumKort(r.tot)) + ' · nog ' + d + ' dag' + (d === 1 ? '' : 'en')}</span>` : '';
    return `<button class="cb-ronde" data-ronde-open="${esc(r.id)}">
      <div class="cb-ronde-kop"><div class="cb-team-naam">${esc(r.naam)}<small>${r.soort === 'snel' ? 'Snelle beoordeling' : 'Volledige beoordeling · 5 domeinen'} · ${(r.teams || []).length} teams</small></div>
        <span class="cb-pijl">${ico('navigation-forward', 18)}</span></div>
      <div class="cb-ronde-cijfers"><b style="color:${kleur}">${s.pct}%</b><span>${s.klaar} van ${s.totaal} spelers</span>${termijn}</div>
      ${balk(s.pct, kleur)}
      ${achter ? `<div class="cb-uitleg">${achter} team${achter === 1 ? '' : 's'} nog niet klaar</div>` : ''}
    </button>`;
  };
  return `
    <p class="cb-legenda">Zet een verplichte evaluatieronde klaar voor de teams die jij kiest. Coaches zien de ronde bovenaan hun team en vullen per speler de beoordeling in. Jij en de bouwcoördinatoren volgen de voortgang.</p>
    <button class="knop fluo vol" id="rondeNieuw" style="margin-bottom:6px">${ico('action-add', 16)} Nieuwe evaluatieronde</button>
    <div class="sectie-kop">Loopt nu</div>
    ${lopend.map(kaart).join('') || '<div class="kaart leeg">Er loopt geen evaluatieronde.</div>'}
    ${dicht.length ? `<div class="sectie-kop">Afgesloten</div>${dicht.map(kaart).join('')}` : ''}
    <p class="cb-uitleg" style="text-align:center;margin-top:10px">Cijfers en radars per team vind je onder Inzicht → Evaluaties.</p>`;
}

/* Eén ronde: voortgang per team, gegroepeerd per bouw. `groepen` = bouwGroepen(teams). */
export function htmlRondeDetail(r, voortgangRonde, groepen){
  if (!r) return '<div class="kaart leeg">Deze evaluatieronde bestaat niet meer.</div>';
  const per = voortgangRonde || {};
  const s = som(per);
  const d = dagenTot(r.tot), verlopen = r.status !== 'gesloten' && d != null && d < 0;
  const inRonde = new Set(r.teams || []);
  const gezien = new Set();
  const blokken = groepen.map(g => {
    const lijst = g.teams.filter(t => inRonde.has(t.id) && !gezien.has(t.id));
    lijst.forEach(t => gezien.add(t.id));
    if (!lijst.length) return '';
    const ratio = t => { const v = per[t.id]; return v && v.totaal ? v.klaar / v.totaal : 1; };
    return `<div class="cb-groep"><i style="background:${esc(g.kleur || 'var(--ink-2)')}"></i><b>${esc(g.naam)}</b></div>
      <div class="cb-kaart" style="padding:4px 14px">${lijst.sort((a, b) => ratio(a) - ratio(b)).map(t => {
        const v = per[t.id] || { klaar:0, totaal:0 };
        const pct = v.totaal ? Math.round(v.klaar / v.totaal * 100) : 0;
        const coaches = Object.keys(t.leden || {}).filter(u => t.leden[u] === true).map(u => String(t.ledenInfo?.[u]?.naam || 'Coach').split('@')[0]);
        return `<div class="cb-rteam"><div class="cb-rteam-n">${esc(t.naam)}<small>${coaches.length ? esc(coaches.join(', ')) : 'geen coach'}</small></div>
          <div class="cb-rteam-v"><span style="color:${pctKleur(pct, verlopen)}">${v.fout ? '?' : v.klaar + '/' + v.totaal}</span>${balk(pct, pctKleur(pct, verlopen))}</div></div>`;
      }).join('')}</div>`;
  }).join('');
  const achter = Object.values(per).filter(v => v.klaar < v.totaal).length;
  return `
    <div class="cb-kaart">
      <div class="cb-team-naam" style="font-size:calc(19px * var(--fs))">${esc(r.naam)}<small>${r.van ? esc(datumKort(r.van)) + ' ' : ''}t/m ${esc(datumKort(r.tot) || '—')} · ${soortTekst(r.soort)}${r.soort === 'snel' ? '' : ' (5 domeinen)'}${r.status === 'gesloten' ? ' · afgesloten' : ''}</small></div>
      <div class="cb-ronde-cijfers" style="margin-top:10px"><b style="color:${pctKleur(s.pct, verlopen)}">${s.pct}%</b><span>${s.klaar} van ${s.totaal} spelers beoordeeld</span></div>
      ${balk(s.pct, pctKleur(s.pct, verlopen))}
    </div>
    <div class="cb-acties">
      ${r.status !== 'gesloten' ? `<button class="knop licht klein" id="rondeHerinner" ${achter ? '' : 'disabled'}>${ico('communication-announcement', 16)} Herinnering</button>` : ''}
      <button class="knop licht klein" id="rondeWijzig">${ico('admin-edit', 16)} Wijzigen</button>
      ${r.status !== 'gesloten' ? `<button class="knop licht klein" id="rondeSluit">${ico('action-check', 16)} Afsluiten</button>` : `<button class="knop licht klein" id="rondeHeropen">${ico('action-loading', 16)} Heropenen</button>`}
    </div>
    ${blokken || '<div class="kaart leeg">Geen teams in deze ronde.</div>'}`;
}

/* ---------- formulier (nieuw of wijzigen) ---------- */
let concept = null;   // { id|null, naam, soort, van, tot, teams:Set, bericht }
export function startConcept(bestaand){
  const v = vandaagIso();
  const over6w = new Date(Date.now() + 42 * 864e5).toISOString().slice(0, 10);
  concept = bestaand
    ? { id: bestaand.id, naam: bestaand.naam || '', soort: bestaand.soort || 'volledig', van: bestaand.van || v, tot: bestaand.tot || over6w, teams: new Set(bestaand.teams || []), bericht: false }
    : { id: null, naam: '', soort: 'volledig', van: v, tot: over6w, teams: new Set(), bericht: true };
}
function suggesties(){
  const j = new Date().getFullYear(), m = new Date().getMonth();
  return m >= 7 ? [`Najaarsevaluatie ${j}`, `Voorjaarsevaluatie ${j + 1}`, 'Eindevaluatie seizoen'] : [`Voorjaarsevaluatie ${j}`, 'Eindevaluatie seizoen', `Najaarsevaluatie ${j}`];
}
export function htmlRondeFormulier(groepen, alleTeams){
  if (!concept) startConcept(null);
  const c = concept;
  const gezien = new Set();
  const chips = groepen.map(g => {
    const lijst = g.teams.filter(t => !gezien.has(t.id)); lijst.forEach(t => gezien.add(t.id));
    if (!lijst.length) return '';
    const alle = lijst.every(t => c.teams.has(t.id));
    return `<div class="cb-bouw-lbl" style="margin-top:12px">${esc(g.naam)} <button type="button" class="cb-link" data-rf-groep="${esc(lijst.map(t => t.id).join(','))}">${alle ? 'Geen' : 'Alle'}</button></div>
      <div class="eb-chips">${lijst.map(t => `<button type="button" class="eb-chip ${c.teams.has(t.id) ? 'aan' : ''}" data-rf-team="${esc(t.id)}">${esc(t.naam)}</button>`).join('')}</div>`;
  }).join('');
  return `
    <div class="cb-kaart">
      <div class="veldlabel" style="margin-top:0">Naam</div>
      <input class="invoer" id="rfNaam" value="${esc(c.naam)}" placeholder="Bijv. Najaarsevaluatie ${new Date().getFullYear()}" maxlength="60" autocomplete="off">
      <div class="cb-tags" style="margin-top:8px">${suggesties().map(s => `<button type="button" class="cb-tag" data-rf-sug="${esc(s)}">${esc(s)}</button>`).join('')}</div>
      <div class="veldlabel">Wat vult de coach in?</div>
      <div class="segment klein-seg" id="rfSoort">
        <button type="button" class="${c.soort === 'volledig' ? 'actief' : ''}" data-rf-soort="volledig">Volledig · 5 domeinen</button>
        <button type="button" class="${c.soort === 'snel' ? 'actief' : ''}" data-rf-soort="snel">Snel · niveau</button></div>
      <div class="veldlabel">Periode</div>
      <div class="cb-datums"><input class="invoer" type="date" id="rfVan" value="${esc(c.van)}"><span style="color:var(--ink-2)">t/m</span><input class="invoer" type="date" id="rfTot" value="${esc(c.tot)}"></div>
      <p class="cb-uitleg">Coaches zien de ronde vanaf de startdatum. Na de einddatum blijft invullen mogelijk, maar het team kleurt rood in het overzicht.</p>
    </div>
    <div class="cb-kaart">
      <div class="cb-kaart-kop">${ico('team-members', 18)}<b>Voor welke teams?</b><span class="cb-telling" id="rfTelling">${c.teams.size} gekozen</span></div>
      <div class="cb-acties" style="margin:0"><button type="button" class="knop licht klein" data-rf-snel="alle">Alle teams</button><button type="button" class="knop licht klein" data-rf-snel="jeugd">Alleen jeugd</button><button type="button" class="knop licht klein" data-rf-snel="geen">Niets</button></div>
      ${chips || '<p class="cb-uitleg">Nog geen teams in de club.</p>'}
    </div>
    ${c.id ? '' : `<div class="cb-kaart">
      <button type="button" class="cb-schakelrij" data-rf-bericht>${ico('communication-announcement', 20)}<div class="cb-persoon-n">Bericht naar de coaches<small>Plaatst een bericht bij de gekozen teams met de naam en de einddatum.</small></div><span class="lj-schakel ${c.bericht ? 'aan' : ''}"></span></button>
    </div>`}
    <button class="knop fluo vol" id="rfOpslaan">${c.id ? 'Wijzigingen opslaan' : 'Ronde klaarzetten'}</button>
    ${c.id ? '<button class="knop gevaar vol" id="rfVerwijder" style="margin-top:10px">Ronde verwijderen</button>' : ''}`;
}

/* api: { teams, groepen, herteken(), naarRonde(id), naarOverzicht() } */
export function koppelRondeFormulier(v, api){
  const c = concept; if (!c) return;
  const naamBij = () => { const i = v.querySelector('#rfNaam'); if (i) c.naam = i.value; const a = v.querySelector('#rfVan'), b = v.querySelector('#rfTot'); if (a) c.van = a.value; if (b) c.tot = b.value; };
  const teken = () => { naamBij(); api.herteken(); };
  v.querySelectorAll('[data-rf-sug]').forEach(b => b.onclick = () => { naamBij(); c.naam = b.dataset.rfSug; api.herteken(); });
  v.querySelectorAll('[data-rf-soort]').forEach(b => b.onclick = () => { c.soort = b.dataset.rfSoort; teken(); });
  v.querySelectorAll('[data-rf-team]').forEach(b => b.onclick = () => { const id = b.dataset.rfTeam; c.teams.has(id) ? c.teams.delete(id) : c.teams.add(id); teken(); });
  v.querySelectorAll('[data-rf-groep]').forEach(b => b.onclick = () => {
    const ids = b.dataset.rfGroep.split(',').filter(Boolean); const alle = ids.every(id => c.teams.has(id));
    ids.forEach(id => alle ? c.teams.delete(id) : c.teams.add(id)); teken();
  });
  v.querySelectorAll('[data-rf-snel]').forEach(b => b.onclick = () => {
    const w = b.dataset.rfSnel;
    if (w === 'geen') c.teams.clear();
    else if (w === 'alle') api.teams.forEach(t => c.teams.add(t.id));
    else c.teams = new Set(api.teams.filter(t => !/^(senioren|vrouwen|veteranen)/i.test(String(t.categorie || ''))).map(t => t.id));
    teken();
  });
  const ber = v.querySelector('[data-rf-bericht]'); if (ber) ber.onclick = () => { c.bericht = !c.bericht; teken(); };
  const ok = v.querySelector('#rfOpslaan');
  if (ok) ok.onclick = async () => {
    naamBij();
    const naam = c.naam.trim();
    if (!naam) return meld('Geef de ronde een naam');
    if (!c.tot) return meld('Kies een einddatum');
    if (c.van && c.tot < c.van) return meld('De einddatum ligt vóór de startdatum');
    const teams = [...c.teams].filter(id => api.teams.some(t => t.id === id));
    if (!teams.length) return meld('Kies minstens één team');
    const lijst = rondesVan(S.club);
    if (lijst.some(r => r.id !== c.id && r.naam.toLowerCase() === naam.toLowerCase())) return meld('Er bestaat al een ronde met die naam');
    ok.disabled = true; ok.textContent = 'Opslaan…';
    let volgende, id = c.id;
    if (id){
      volgende = lijst.map(r => r.id === id ? { ...r, naam, soort: c.soort, van: c.van || null, tot: c.tot, teams } : r);
    } else {
      id = 'r' + Date.now().toString(36);
      volgende = [...lijst, { id, naam, soort: c.soort, van: c.van || null, tot: c.tot, teams, status:'open', seizoen: S.club.huidigSeizoen || SEIZOEN_FALLBACK, gemaaktMs: Date.now() }];
    }
    try {
      await updateDoc(doc(db, 'clubs', S.clubId), { evaluatieRondes: volgende });
      S.club.evaluatieRondes = volgende;
      if (!c.id && c.bericht){
        await plaatsBericht(teams, naam, `Vul voor elke speler van je team een ${soortTekst(c.soort)} in, uiterlijk ${datumKort(c.tot)}. Je vindt de ronde bovenaan je teampagina.`, c.tot);
      }
      const nieuw = !c.id;
      concept = null; rondeCacheWeg();
      meld(nieuw ? `${naam} staat klaar voor ${teams.length} team${teams.length === 1 ? '' : 's'}` : 'Ronde bijgewerkt');
      api.naarRonde(id);
    } catch(e){
      ok.disabled = false; ok.textContent = c.id ? 'Wijzigingen opslaan' : 'Ronde klaarzetten';
      meld('Opslaan mislukt: ' + (e.code || e.message));
    }
  };
  const weg = v.querySelector('#rfVerwijder');
  if (weg) weg.onclick = async () => {
    const r = rondesVan(S.club).find(x => x.id === c.id); if (!r) return;
    if (!confirm(`${r.naam} verwijderen? Ingevulde beoordelingen blijven gewoon bewaard bij de spelers.`)) return;
    const volgende = rondesVan(S.club).filter(x => x.id !== r.id);
    try { await updateDoc(doc(db, 'clubs', S.clubId), { evaluatieRondes: volgende }); S.club.evaluatieRondes = volgende; concept = null; rondeCacheWeg(); meld(`${r.naam} verwijderd`); api.naarOverzicht(); }
    catch(e){ meld('Verwijderen mislukt: ' + (e.code || e.message)); }
  };
}

/* Bericht via de bestaande Berichten (zelfde velden als club.js → modalNieuwBericht). Geen spelersnamen. */
async function plaatsBericht(teams, titel, body, tot){
  const eind = tot ? new Date(tot + 'T23:59:59').getTime() : Date.now() + 14 * 864e5;
  await addDoc(collection(db, 'berichten'), {
    club: S.clubId, clubNaam: S.club.naam || '', titel, body, teams,
    zichtbaarTot: Math.max(eind, Date.now() + 3 * 864e5),
    gemaakt: serverTimestamp(), door: S.user?.displayName || S.user?.email || '',
  });
}

/* Knoppen op het detailscherm. api: { naarFormulier(), herteken() } */
export function koppelRondeDetail(v, r, voortgangRonde, api){
  if (!r) return;
  const zet = async (patch, melding) => {
    const volgende = rondesVan(S.club).map(x => x.id === r.id ? { ...x, ...patch } : x);
    await updateDoc(doc(db, 'clubs', S.clubId), { evaluatieRondes: volgende });
    S.club.evaluatieRondes = volgende; rondeCacheWeg(); meld(melding); api.herteken();
  };
  v.querySelector('#rondeWijzig')?.addEventListener('click', () => { startConcept(r); api.naarFormulier(); });
  v.querySelector('#rondeSluit')?.addEventListener('click', async () => {
    const s = som(voortgangRonde);
    if (!confirm(`${r.naam} afsluiten? Coaches zien de ronde dan niet meer. De ingevulde beoordelingen blijven bewaard (${s.klaar} van ${s.totaal} spelers).`)) return;
    try { await zet({ status:'gesloten', geslotenMs: Date.now(), resultaat:{ klaar:s.klaar, totaal:s.totaal } }, `${r.naam} afgesloten`); }
    catch(e){ meld('Afsluiten mislukt: ' + (e.code || e.message)); }
  });
  v.querySelector('#rondeHeropen')?.addEventListener('click', async () => {
    try { await zet({ status:'open' }, `${r.naam} staat weer open`); }
    catch(e){ meld('Heropenen mislukt: ' + (e.code || e.message)); }
  });
  v.querySelector('#rondeHerinner')?.addEventListener('click', async () => {
    const achter = Object.entries(voortgangRonde || {}).filter(([, x]) => x.klaar < x.totaal).map(([id]) => id);
    if (!achter.length) return meld('Alle teams zijn klaar');
    if (!confirm(`Herinnering plaatsen bij ${achter.length} team${achter.length === 1 ? '' : 's'} die nog niet klaar ${achter.length === 1 ? 'is' : 'zijn'}?`)) return;
    try {
      const d = dagenTot(r.tot);
      await plaatsBericht(achter, `Herinnering: ${r.naam}`,
        `Nog niet alle spelers van je team zijn beoordeeld voor ${r.naam}. ${d != null && d < 0 ? 'De einddatum is verstreken — rond het zo snel mogelijk af.' : 'De einddatum is ' + datumKort(r.tot) + '.'} Je vindt de ronde bovenaan je teampagina.`,
        d != null && d >= 0 ? r.tot : null);
      meld(`Herinnering geplaatst bij ${achter.length} team${achter.length === 1 ? '' : 's'}`);
    } catch(e){ meld('Plaatsen mislukt: ' + (e.code || e.message)); }
  });
}
