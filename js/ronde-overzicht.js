/* ==================== RONDE-OVERZICHT: team in één beeld + rondecockpit ====================
   [20261125b] Twee schermen bij een evaluatieronde van de club (winter, lente):

   1. TEAMOVERZICHT (trainer). Alle spelers van het team in één matrix met de
      eigen beoordelingen per domein. Vergeten spelers en niet-complete
      beoordelingen springen eruit, een tik op een speler opent zijn
      beoordeling. Tik op een domein voor de criteria eronder. Daaronder
      "Wat valt op": verdeling van je scores, sterkste en zwakste domein,
      lage score zonder toelichting, groei sinds de vorige meting.

   2. RONDECOCKPIT (coördinator, in de bouw-omgeving op desktop en telefoon):
        Voortgang  per trainer: niet begonnen / bezig / klaar, laatst actief
        Scores     heatmap per team en domein; per team dezelfde matrix als de
                   trainer, gemiddeld over de trainers of per trainer, met een
                   markering waar trainers het anders zien
        Inzichten  strengheid per trainer, verschil van inzicht, uitblinkers,
                   extra aandacht, groei en terugval, kwaliteit van invullen

   Alleen lezen en rekenen. Geen nieuw datamodel, geen extra Firestore-lees,
   geen rules-wijziging: alles komt uit wat de gastschermen al hebben.
     trainer      S.spelers + S.beoordelingen (eigen privé-rondebeoordelingen)
     coördinator  bouw-context uit bouw-hub.laadBouwData (ctx.teams, ctx.data,
                  ctx.rondes); privé-beoordelingen zitten daar al in
   Status (klaar / bezig / niet begonnen) is afgeleid uit de beoordelingen.

   AVG: niets verlaat de app. De herinnering die een coördinator kan delen
   bevat alleen de naam van de ronde en de einddatum, geen namen.

   Blad-module: importeert alleen icons.js en beoordeling-volledig.js. De
   kleine hulpjes rondeSpelers/datumKort/dagenTot staan hier bewust dubbel
   (ook in evaluatierondes.js), zodat dit bestand geen firebase/state nodig
   heeft. De gastschermen leveren de gegevens en hertekenen zichzelf. */
import { ico } from './icons.js?v=20261106r';
import { VB_DOMEINEN, critSleutel, critZichtbaar, NIV_LABEL, leeftijdTeam } from './beoordeling-volledig.js?v=20261119e';

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const KORT = { TE:'Techniek', TA:'Tactiek', FY:'Fysiek', ME:'Mentaal', GE:'Gedrag' };
const DOM = VB_DOMEINEN.map(d => ({ id:d.id, naam:d.naam, kort:KORT[d.id] || d.naam }));
const gem = a => { const w = a.filter(v => v != null && !Number.isNaN(v)); return w.length ? w.reduce((x, y) => x + y, 0) / w.length : null; };
const komma = (v, d = 1) => v == null ? '–' : v.toFixed(d).replace('.', ',');
const niv = v => v == null ? 0 : Math.max(1, Math.min(5, Math.round(v)));
const meerv = (n, een, meer) => `${n} ${n === 1 ? een : meer}`;
const opsom = a => a.length < 2 ? a.join('') : a.slice(0, -1).join(', ') + ' en ' + a[a.length - 1];
const voornaam = n => String(n || '').split('@')[0].trim().split(/\s+/)[0] || 'Trainer';

/* Drempels, op één plek zodat ze makkelijk bij te stellen zijn. */
const D = {
  delta: 0.25,        // verschil met de vorige meting dat als groei/terugval telt
  verschil: 1.5,      // verschil tussen trainers op één domein dat we markeren
  uitblinker: 4.3,    // gemiddelde vanaf waar een speler opvalt
  aandacht: 2.3,      // gemiddelde tot waar een speler extra aandacht vraagt
  laag: 2,            // domeinscore die om een toelichting vraagt
  eenzijdig: 0.6,     // aandeel van één niveau waarbij we op spreiding wijzen
  minStreng: 3,       // minimum aantal beoordelingen voor de strengheidsvergelijking
};

function datumKort(iso){
  if (!iso) return '';
  try { return new Date(iso + 'T12:00').toLocaleDateString('nl-NL', { day:'numeric', month:'short' }); } catch(e){ return iso; }
}
function dagenTot(iso){ return iso ? Math.ceil((new Date(iso + 'T23:59:59') - new Date()) / 864e5) : null; }
function geleden(ms){
  if (!ms) return '';
  const d = Math.floor((Date.now() - ms) / 864e5);
  return d <= 0 ? 'vandaag' : d === 1 ? 'gisteren' : d < 14 ? d + ' dagen geleden' : Math.round(d / 7) + ' weken geleden';
}
function termijn(r){
  if (!r) return '';
  if (r.status === 'gesloten') return 'afgesloten';
  if (!r.tot) return '';
  const d = dagenTot(r.tot);
  return d < 0 ? `einddatum ${datumKort(r.tot)} is verstreken` : `t/m ${datumKort(r.tot)} · ${d === 0 ? 'laatste dag' : 'nog ' + meerv(d, 'dag', 'dagen')}`;
}
/* Spelers die meetellen: zelfde regel als evaluatierondes.rondeSpelers (geen gasten,
   geen ingeleende spelers), zodat de tellingen overal gelijk zijn. */
const rondeSpelers = spelers => (spelers || []).filter(p => p && !p.gast && !p._ingeleend && !p.gearchiveerd);

/* ==================== REKENEN ==================== */
/* Eén beoordeling → domeinen (exact gemiddelde van de criteria), criteria,
   gemiddelde, aantal open criteria en aantal toelichtingen. */
export function meet(b, lft){
  if (!b) return null;
  const notities = Object.values(b.notities || {}).filter(t => String(t || '').trim()).length;
  if (b.soort === 'snel' || (!b.scores && !b.criteria)){
    const n = Number(b.niveau) || null;
    return { b, snel:true, dom:{}, crit:{}, openDom:{}, gem:n, open:0, notities };
  }
  const dom = {}, crit = {}, openDom = {};
  let open = 0;
  for (const d of VB_DOMEINEN){
    const zicht = d.criteria.map((c, i) => ({ c, i })).filter(x => critZichtbaar(x.c, lft));
    const w = [];
    for (const x of zicht){
      const k = critSleutel(d.id, x.i), n = Number(b.criteria?.[k]);
      if (n >= 1 && n <= 5){ crit[k] = n; w.push(n); }
    }
    const oud = Number(b.scores?.[d.id]);
    if (w.length){ dom[d.id] = gem(w); openDom[d.id] = zicht.length - w.length; }
    else if (oud >= 1 && oud <= 5) dom[d.id] = oud;          // eerder alleen als domeinscore ingevuld
    else openDom[d.id] = b.criteria ? zicht.length : 1;
    open += openDom[d.id] || 0;
  }
  return { b, snel:false, dom, crit, openDom, gem: gem(Object.values(dom)), open, notities };
}
/* Meerdere beoordelingen van één speler (per trainer één) → gemiddeld beeld. */
function bundel(metingen){
  if (!metingen.length) return null;
  const dom = {}, spr = {}, crit = {}, openDom = {};
  for (const d of DOM){
    const w = metingen.map(m => m.dom[d.id]).filter(v => v != null);
    if (w.length){ dom[d.id] = gem(w); spr[d.id] = Math.max(...w) - Math.min(...w); }
    openDom[d.id] = metingen.reduce((a, m) => a + (m.openDom[d.id] || 0), 0);
  }
  for (const k of new Set(metingen.flatMap(m => Object.keys(m.crit)))) crit[k] = gem(metingen.map(m => m.crit[k]));
  return { metingen, dom, spr, crit, openDom, snel: metingen.every(m => m.snel), gem: gem(metingen.map(m => m.gem)),
    open: metingen.reduce((a, m) => a + m.open, 0), notities: metingen.reduce((a, m) => a + m.notities, 0),
    maxSpr: Math.max(0, ...Object.values(spr)), n: metingen.length };
}

/* Model van één team in één ronde.
   uid gezet   → alleen de beoordelingen van die trainer (het teamoverzicht van
                 de trainer, of de trainer-filter van de coördinator)
   uid leeg    → alle trainers, per speler gemiddeld (coördinator) */
export function teamModel({ ronde, spelers, beoordelingen, lft, uid = null }){
  const lijst = beoordelingen || [];
  const perTrainer = !!uid && ronde.soort !== 'snel';      // snelle ronde telt per team, niet per trainer
  const inRonde = lijst.filter(b => b.ronde === ronde.id && (!perTrainer || b.door?.uid === uid));
  const rijen = rondeSpelers(spelers).map(p => {
    const laatste = new Map();                              // per trainer de laatst opgeslagen beoordeling
    for (const b of inRonde){
      if (b.spelerId !== p.id) continue;
      const k = b.door?.uid || '_';
      const al = laatste.get(k);
      if (!al || (b.gemaaktMs || 0) > (al.gemaaktMs || 0)) laatste.set(k, b);
    }
    const agg = bundel([...laatste.values()].map(b => meet(b, lft)));
    const eerder = lijst.filter(b => b.spelerId === p.id && b.ronde !== ronde.id && b.soort === 'volledig' && b.scores)
      .sort((a, b) => (b.datum || '').localeCompare(a.datum || '') || (b.gemaaktMs || 0) - (a.gemaaktMs || 0))[0];
    const vorig = eerder ? meet(eerder, lft) : null;
    const delta = agg && !agg.snel && vorig?.gem != null && agg.gem != null ? agg.gem - vorig.gem : null;
    return { p, agg, vorig, delta, status: !agg ? 'open' : agg.open ? 'deels' : 'klaar' };
  });
  const met = rijen.filter(r => r.agg);
  const teamDom = {};
  for (const d of DOM) teamDom[d.id] = gem(met.map(r => r.agg.dom[d.id]));
  const verdeling = [0, 0, 0, 0, 0, 0];
  for (const r of met) for (const m of r.agg.metingen){
    const w = m.snel ? [m.gem] : Object.keys(m.crit).length ? Object.values(m.crit) : Object.values(m.dom);
    for (const v of w) if (v != null) verdeling[niv(v)]++;
  }
  return { ronde, lft, snel: ronde.soort === 'snel', rijen, teamDom, teamGem: gem(met.map(r => r.agg.gem)), verdeling,
    totaal: rijen.length, klaar: rijen.filter(r => r.status === 'klaar').length,
    deels: rijen.filter(r => r.status === 'deels').length, open: rijen.filter(r => r.status === 'open').length };
}

/* ==================== BOUWSTENEN ==================== */
const cel = (v, { dec = false, leeg = '–', extra = '' } = {}) => v == null
  ? `<span class="ro-c nvt${extra}">${leeg}</span>`
  : `<span class="ro-c${extra}" data-n="${niv(v)}">${dec ? komma(v) : Math.round(v)}</span>`;
const deltaHtml = d => d == null ? '' : d > D.delta ? `<em class="ro-d op" title="Hoger dan de vorige meting">▲</em>`
  : d < -D.delta ? `<em class="ro-d neer" title="Lager dan de vorige meting">▼</em>` : '';
function ring(klaar, totaal, grootte = 76){
  const r = grootte / 2 - 6, o = 2 * Math.PI * r, pct = totaal ? Math.min(1, klaar / totaal) : 0;
  const kleur = pct >= 1 ? 'var(--ok)' : pct >= .5 ? 'var(--warn)' : 'var(--accent)';
  return `<span class="ro-ring" style="width:${grootte}px;height:${grootte}px">
    <svg width="${grootte}" height="${grootte}" viewBox="0 0 ${grootte} ${grootte}" aria-hidden="true">
      <circle cx="${grootte / 2}" cy="${grootte / 2}" r="${r}" fill="none" stroke="var(--surface-2)" stroke-width="7"/>
      <circle cx="${grootte / 2}" cy="${grootte / 2}" r="${r}" fill="none" stroke="${kleur}" stroke-width="7" stroke-linecap="round"
        stroke-dasharray="${(o * pct).toFixed(1)} ${o.toFixed(1)}" transform="rotate(-90 ${grootte / 2} ${grootte / 2})"/></svg>
    <b>${klaar}<small>/${totaal}</small></b></span>`;
}
const legenda = (mist = false) => `<div class="ro-legenda">${[1, 2, 3, 4, 5].map(n => `<span><i class="ro-c" data-n="${n}">${n}</i>${NIV_LABEL[n]}</span>`).join('')}${mist ? '<span><i class="ro-stip"></i>criteria open</span>' : ''}</div>`;
const balk = (pct, kleur) => `<span class="ro-balk"><i style="width:${Math.max(0, Math.min(100, pct))}%;background:${kleur}"></i></span>`;
const statusKleur = s => s === 'klaar' ? 'var(--ok)' : s === 'bezig' ? 'var(--warn)' : 'var(--accent)';

/* Kolommen van de matrix: de 5 domeinen, of de criteria van één domein. */
function kolommen(model, st){
  if (model.snel) return { soort:'snel', kol:[{ id:'N', kop:'Niveau' }] };
  const d = st.dom && VB_DOMEINEN.find(x => x.id === st.dom);
  if (d) return { soort:'crit', domein:d, kol: d.criteria.map((c, i) => ({ c, i })).filter(x => critZichtbaar(x.c, model.lft))
    .map((x, n) => ({ id: critSleutel(d.id, x.i), kop: String(n + 1), naam: x.c.naam })) };
  return { soort:'dom', kol: DOM.map(x => ({ id:x.id, kop:x.id, naam:x.naam })) };
}
function gesorteerd(rijen, sort){
  const naam = (a, b) => (a.p.naam || '').localeCompare(b.p.naam || '', 'nl', { sensitivity:'base' });
  const rang = { open:0, deels:1, klaar:2 };
  const r = [...rijen];
  if (sort === 'naam') return r.sort(naam);
  if (sort === 'hoog') return r.sort((a, b) => (b.agg?.gem ?? -1) - (a.agg?.gem ?? -1) || naam(a, b));
  return r.sort((a, b) => rang[a.status] - rang[b.status] || naam(a, b));
}

/* De matrix zelf. opties.lees = coördinator (alleen lezen, tik klapt de speler uit);
   opties.verschil = markeer waar trainers het anders zien. */
function htmlMatrix(model, st, opties = {}){
  const K = kolommen(model, st);
  const n = K.kol.length;
  const stijl = `style="--ro-n:${n}"`;
  const dec = !!opties.dec && K.soort !== 'snel';
  const waarde = (agg, k) => K.soort === 'snel' ? agg.gem : K.soort === 'crit' ? agg.crit[k.id] : agg.dom[k.id];
  const kop = `<div class="ro-rij ro-kopr" ${stijl}><span class="ro-nm"></span>${K.kol.map(k => K.soort === 'dom'
      ? `<button type="button" class="ro-kh" data-ro="dom" data-id="${k.id}" title="${esc(k.naam)}: criteria bekijken">${k.kop}</button>`
      : `<span class="ro-kh" title="${esc(k.naam || k.kop)}">${esc(k.kop)}</span>`).join('')}<span class="ro-kh g">Gem</span></div>`;
  const rijen = gesorteerd(model.rijen, st.sort).map(r => {
    const p = r.p, a = r.agg;
    const nm = `<span class="ro-nm"><i class="ro-nr">${esc(p.nummer ?? '·')}</i><span class="ro-nmt"><b>${esc(p.naam)}</b>${
      !a ? '' : a.open ? `<small class="let">${meerv(a.open, 'criterium', 'criteria')} open</small>`
      : opties.lees && a.n > 1 ? `<small>${a.n} trainers</small>` : ''}</span></span>`;
    if (!a) return `<button type="button" class="ro-rij ro-open" ${stijl} data-ro="speler" data-id="${esc(p.id)}"${opties.lees ? ' disabled' : ''}>${nm}
      <span class="ro-nog">${opties.lees ? 'Nog niet beoordeeld' : 'Nog niet beoordeeld <b>+</b>'}</span></button>`;
    const cellen = K.kol.map(k => {
      const v = waarde(a, k);
      const anders = opties.verschil && K.soort === 'dom' && (a.spr[k.id] || 0) >= D.verschil;
      const mist = K.soort === 'dom' && a.openDom[k.id] > 0;
      return cel(v, { dec, extra: (anders ? ' anders' : '') + (mist ? ' mist' : '') });
    }).join('');
    const uit = opties.lees && st.uit === p.id;
    return `<button type="button" class="ro-rij${r.status === 'deels' ? ' ro-deels' : ''}${uit ? ' uit' : ''}" ${stijl} data-ro="speler" data-id="${esc(p.id)}" aria-expanded="${uit}">${nm}${cellen}
      <span class="ro-g">${komma(a.gem)}${deltaHtml(r.delta)}</span></button>${uit ? htmlSpelerUit(r, model) : ''}`;
  }).join('');
  const voet = model.rijen.some(r => r.agg) ? `<div class="ro-rij ro-voet" ${stijl}><span class="ro-nm"><span class="ro-nmt"><b>Team</b><small>gemiddeld</small></span></span>${K.kol.map(k => {
      const v = K.soort === 'snel' ? model.teamGem : K.soort === 'crit' ? gem(model.rijen.filter(r => r.agg).map(r => r.agg.crit[k.id])) : model.teamDom[k.id];
      return cel(v, { dec:true });
    }).join('')}<span class="ro-g">${komma(model.teamGem)}</span></div>` : '';
  const domKiezer = model.snel ? '' : `<div class="ro-chips" role="tablist" aria-label="Domein">
      <button type="button" class="ro-chip${!st.dom ? ' aan' : ''}" data-ro="dom" data-id="">Alle domeinen</button>
      ${DOM.map(d => `<button type="button" class="ro-chip${st.dom === d.id ? ' aan' : ''}" data-ro="dom" data-id="${d.id}">${esc(d.kort)}</button>`).join('')}</div>`;
  const critLegenda = K.soort === 'crit' ? `<ol class="ro-critleg">${K.kol.map(k => `<li>${esc(k.naam)}</li>`).join('')}</ol>` : '';
  const sorteer = `<div class="ro-sort"><span>Sorteer</span>${[['open', 'Open eerst'], ['naam', 'Naam'], ['hoog', 'Hoog → laag']].map(([k, l]) =>
    `<button type="button" class="${(st.sort || 'open') === k ? 'aan' : ''}" data-ro="sort" data-id="${k}">${l}</button>`).join('')}</div>`;
  return `${domKiezer}${sorteer}<div class="ro-matrix ro-${K.soort}">${kop}${rijen}${voet}</div>${critLegenda}`;
}

/* Coördinator: één speler uitgeklapt, per trainer de scores en de toelichtingen. */
function htmlSpelerUit(r, model){
  const blok = m => {
    const not = DOM.map(d => ({ d, t: String(m.b.notities?.[d.id] || '').trim() })).filter(x => x.t);
    const alg = String(m.b.notities?.algemeen || '').trim();
    return `<div class="ro-tr"><div class="ro-tr-kop"><b>${esc(voornaam(m.b.door?.naam))}</b><span>${esc(datumKort(m.b.datum))}${m.open ? ` · ${meerv(m.open, 'criterium', 'criteria')} open` : ''}</span>
        <span class="ro-tr-c">${m.snel ? cel(m.gem) : DOM.map(d => cel(m.dom[d.id])).join('')}</span></div>
      ${not.map(x => `<p><i>${esc(x.d.kort)}</i>${esc(x.t)}</p>`).join('')}${alg ? `<p><i>Algemeen</i>${esc(alg)}</p>` : ''}
      ${!not.length && !alg ? '<p class="zacht">Geen toelichting geschreven.</p>' : ''}</div>`;
  };
  const anders = DOM.filter(d => (r.agg.spr[d.id] || 0) >= D.verschil).map(d => d.kort.toLowerCase());
  return `<div class="ro-uit">${anders.length ? `<div class="ro-let">${ico('action-warning', 15)}<span>De trainers zien <b>${esc(opsom(anders))}</b> duidelijk anders. Goed om samen te bespreken.</span></div>` : ''}
    ${r.vorig?.gem != null ? `<div class="ro-vorig">Vorige meting (${esc(datumKort(r.vorig.b.datum))}): gemiddeld <b>${komma(r.vorig.gem)}</b>, nu <b>${komma(r.agg.gem)}</b>${deltaHtml(r.delta)}</div>` : ''}
    ${r.agg.metingen.map(blok).join('')}</div>`;
}

/* ==================== 1. TEAMOVERZICHT (trainer) ==================== */
function inzichtenTrainer(model){
  const uit = [];
  const met = model.rijen.filter(r => r.agg);
  if (!met.length) return uit;
  const totaal = model.verdeling.reduce((a, b) => a + b, 0);
  if (totaal){
    const top = [1, 2, 3, 4, 5].sort((a, b) => model.verdeling[b] - model.verdeling[a])[0];
    const aandeel = model.verdeling[top] / totaal;
    uit.push({ ico:'stats-bars', titel:'Zo gebruik je de schaal',
      html:`<div class="ro-verd">${[1, 2, 3, 4, 5].map(n => model.verdeling[n] ? `<i data-n="${n}" style="flex:${model.verdeling[n]}" title="${NIV_LABEL[n]}: ${model.verdeling[n]}×">${Math.round(model.verdeling[n] / totaal * 100) >= 9 ? Math.round(model.verdeling[n] / totaal * 100) + '%' : ''}</i>` : '').join('')}</div>
        <p>${aandeel >= D.eenzijdig && met.length >= 4
          ? `Je kiest vaak <b>${NIV_LABEL[top]}</b> (${Math.round(aandeel * 100)}%). Kijk of je de spelers hier en daar nog wat meer van elkaar kunt onderscheiden.`
          : `Je gebruikt de schaal breed. Meest gekozen: <b>${NIV_LABEL[top]}</b> (${Math.round(aandeel * 100)}%).`}</p>` });
  }
  if (!model.snel){
    const d = DOM.map(x => ({ ...x, v: model.teamDom[x.id] })).filter(x => x.v != null).sort((a, b) => b.v - a.v);
    if (d.length >= 2 && d[0].v - d[d.length - 1].v >= 0.3) uit.push({ ico:'tag-insight', titel:'Het profiel van je team',
      html:`<p>Sterkst: <b>${esc(d[0].kort)}</b> (${komma(d[0].v)}). Meeste winst te halen: <b>${esc(d[d.length - 1].kort)}</b> (${komma(d[d.length - 1].v)}). Handig bij het kiezen van je trainingsaccenten.</p>` });
    const zonder = met.filter(r => r.agg.metingen.some(m => DOM.some(x => m.dom[x.id] != null && m.dom[x.id] <= D.laag && !String(m.b.notities?.[x.id] || '').trim())));
    if (zonder.length) uit.push({ ico:'communication-chat', titel:'Lage score zonder toelichting', spelers: zonder,
      html:`<p>Bij ${meerv(zonder.length, 'speler', 'spelers')} staat een domein op Aandacht of Op weg zonder toelichting. Eén zin helpt de coördinator en het gesprek met de speler.</p>` });
    const groei = met.filter(r => r.delta != null && r.delta > D.delta).sort((a, b) => b.delta - a.delta);
    const terug = met.filter(r => r.delta != null && r.delta < -D.delta).sort((a, b) => a.delta - b.delta);
    if (groei.length || terug.length) uit.push({ ico:'training-intensity', titel:'Vergeleken met de vorige meting',
      html:`<p>${groei.length ? `Hoger: <b>${esc(groei.slice(0, 4).map(r => r.p.naam).join(', '))}</b>${groei.length > 4 ? ' en ' + (groei.length - 4) + ' anderen' : ''}. ` : ''}${terug.length ? `Lager: <b>${esc(terug.slice(0, 4).map(r => r.p.naam).join(', '))}</b>${terug.length > 4 ? ' en ' + (terug.length - 4) + ' anderen' : ''}.` : ''}</p>` });
  }
  return uit;
}

/* opties: { teamNaam } — st: { sort, dom } */
export function htmlTeamOverzicht(model, st = {}, opties = {}){
  const r = model.ronde;
  const open = model.rijen.filter(x => x.status === 'open'), deels = model.rijen.filter(x => x.status === 'deels');
  const gedaan = model.klaar + model.deels;
  const strip = `<div class="ro-strip" aria-hidden="true">${gesorteerd(model.rijen, 'open').reverse().map(x => `<i class="${x.status}"></i>`).join('')}</div>`;
  const chips = lijst => lijst.map(x => `<button type="button" class="ro-spchip" data-ro="speler" data-id="${esc(x.p.id)}"><i>${esc(x.p.nummer ?? '·')}</i>${esc(x.p.naam)}</button>`).join('');
  const allesKlaar = model.totaal > 0 && model.klaar === model.totaal;
  const hero = `<div class="ro-kaart ro-hero${allesKlaar ? ' klaar' : ''}">
      <div class="ro-hero-top">${ring(gedaan, model.totaal)}
        <div class="ro-hero-t"><small>${esc(opties.teamNaam || 'Jouw team')}</small><b>${esc(r.naam)}</b><span>${esc(termijn(r))}</span></div></div>
      ${strip}
      <div class="ro-tellers">
        <span class="klaar"><b>${model.klaar}</b>compleet</span>
        <span class="deels"><b>${model.deels}</b>niet compleet</span>
        <span class="open"><b>${model.open}</b>nog te doen</span></div>
      ${allesKlaar ? `<p class="ro-top">${ico('action-check', 16)}Alle ${model.totaal} spelers zijn compleet beoordeeld. Top!</p>`
        : model.open ? `<button type="button" class="knop fluo vol" data-ro="verder">${gedaan ? 'Verder met de volgende speler' : 'Beginnen'} →</button>` : ''}
    </div>`;
  const vergeten = open.length ? `<div class="ro-kaart ro-meld open"><div class="ro-meld-kop">${ico('action-warning', 17)}<b>${open.length === model.totaal ? 'Je bent nog niet begonnen' : meerv(open.length, 'speler', 'spelers') + ' nog niet beoordeeld'}</b></div>
      ${open.length === model.totaal ? '<p>Tik op Beginnen, of kies hieronder zelf een speler.</p>' : ''}<div class="ro-spchips">${chips(open)}</div></div>` : '';
  const nietCompleet = deels.length ? `<div class="ro-kaart ro-meld deels"><div class="ro-meld-kop">${ico('action-info', 17)}<b>${meerv(deels.length, 'beoordeling', 'beoordelingen')} niet compleet</b></div>
      <p>Hier ontbreken nog criteria. Tik op een speler om ze aan te vullen.</p><div class="ro-spchips">${chips(deels)}</div></div>` : '';
  const inz = inzichtenTrainer(model);
  return `<div class="ro-wortel ro-trainer">
    ${hero}${vergeten}${nietCompleet}
    <div class="ro-kaart"><div class="ro-kk">${ico('attendance-overview', 18)}<b>Jouw beoordelingen</b><span>${model.snel ? 'niveau per speler' : 'tik een domein voor de criteria'}</span></div>
      ${htmlMatrix(model, st)}${legenda(model.deels > 0)}</div>
    ${inz.length ? `<div class="ro-kaart"><div class="ro-kk">${ico('tag-insight', 18)}<b>Wat valt op</b></div>
      ${inz.map(i => `<div class="ro-inz"><span class="ro-inz-ic">${ico(i.ico, 17)}</span><div><b>${esc(i.titel)}</b>${i.html}${i.spelers ? `<div class="ro-spchips">${chips(i.spelers)}</div>` : ''}</div></div>`).join('')}</div>` : ''}
    <p class="ro-prive">${ico('admin-permissions', 14)}Privé: alleen jij, de coördinatoren van de bouw en de clubbeheerder zien deze beoordelingen.</p>
  </div>`;
}

/* ==================== 2. RONDECOCKPIT (coördinator) ==================== */
/* Rondes die voor deze bouw gelden: lopend eerst (eerste einddatum bovenaan), dan afgesloten. */
export function rondesVanBouw(ctx){
  const ids = new Set((ctx?.teams || []).map(t => t.id));
  const vandaag = new Date().toISOString().slice(0, 10);
  const lijst = (ctx?.rondes || []).filter(r => r && r.id && (r.teams || []).some(id => ids.has(id)) && (!r.van || r.van <= vandaag || r.status === 'gesloten'));
  const lopend = lijst.filter(r => r.status !== 'gesloten').sort((a, b) => (a.tot || '9999').localeCompare(b.tot || '9999'));
  const dicht = lijst.filter(r => r.status === 'gesloten').sort((a, b) => (b.tot || '').localeCompare(a.tot || ''));
  return [...lopend, ...dicht];
}
function staat(ctx){
  const rondes = rondesVanBouw(ctx);
  const st = (ctx._roSt ||= { tab:'voortgang', rondeId:null, teamId:null, trainer:'', dom:'', sort:'open', uit:null });
  if (!rondes.some(r => r.id === st.rondeId)) st.rondeId = rondes[0]?.id || null;
  return { st, rondes, ronde: rondes.find(r => r.id === st.rondeId) || null };
}
/* Alles van de bouw voor één ronde: per team het model, de trainers en hun status. */
export function bouwModel(ctx, ronde){
  const teams = (ctx.teams || []).filter(t => (ronde.teams || []).includes(t.id)).map(t => {
    const d = ctx.data.get(t.id) || {};
    const lft = leeftijdTeam(t.categorie);
    const basis = { ronde, spelers: d.spelers || [], beoordelingen: d.beoordelingen || [], lft };
    const model = teamModel(basis);
    const spelerIds = new Set(model.rijen.map(r => r.p.id));
    const inRonde = (d.beoordelingen || []).filter(b => b.ronde === ronde.id && spelerIds.has(b.spelerId));
    const namen = new Map();
    for (const [u, v] of Object.entries(t.leden || {})) if (v === true) namen.set(u, t.ledenInfo?.[u]?.naam || 'Coach');
    for (const b of inRonde) if (b.door?.uid && !namen.has(b.door.uid)) namen.set(b.door.uid, b.door.naam || 'Trainer');
    const trainers = [...namen].map(([uid, naam]) => {
      const eigen = inRonde.filter(b => b.door?.uid === uid);
      const m = teamModel({ ...basis, uid });
      const gedaan = ronde.soort === 'snel' ? new Set(eigen.map(b => b.spelerId)).size : m.klaar + m.deels;
      return { uid, naam: String(naam).split('@')[0], team: t, gedaan, totaal: model.totaal, deels: ronde.soort === 'snel' ? 0 : m.deels,
        laatst: Math.max(0, ...eigen.map(b => b.gemaaktMs || 0)), gem: m.teamGem, aantal: eigen.length,
        status: !gedaan ? 'niet' : gedaan >= model.totaal && model.totaal > 0 ? 'klaar' : 'bezig' };
    });
    return { t, lft, basis, model, trainers };
  });
  const rijen = teams.flatMap(x => x.model.rijen.map(r => ({ ...r, team: x.t })));
  const met = rijen.filter(r => r.agg);
  const bouwDom = {};
  for (const d of DOM) bouwDom[d.id] = gem(met.map(r => r.agg.dom[d.id]));
  const trainers = teams.flatMap(x => x.trainers);
  return { ronde, teams, rijen, met, trainers, bouwDom, bouwGem: gem(met.map(r => r.agg.gem)),
    spelers: rijen.length, beoordeeld: met.length,
    tel: { niet: trainers.filter(t => t.status === 'niet').length, bezig: trainers.filter(t => t.status === 'bezig').length, klaar: trainers.filter(t => t.status === 'klaar').length } };
}
const stoplicht = tel => `<div class="ro-stop">
    <span class="niet"><b>${tel.niet}</b>niet begonnen</span><span class="bezig"><b>${tel.bezig}</b>bezig</span><span class="klaar"><b>${tel.klaar}</b>klaar</span></div>`;

/* Blok bovenaan het bouw-dashboard. Leeg als er geen ronde loopt voor deze bouw. */
export function htmlRondeDashBlok(ctx, modus){
  const { rondes } = staat(ctx);
  const r = rondes.find(x => x.status !== 'gesloten');
  if (!r) return '';
  const b = bouwModel(ctx, r);
  const pct = b.spelers ? Math.round(b.beoordeeld / b.spelers * 100) : 0;
  const d = dagenTot(r.tot), verlopen = d != null && d < 0;
  const kleur = pct >= 100 ? 'var(--ok)' : verlopen || pct < 50 ? 'var(--accent)' : 'var(--warn)';
  return `<div class="ro-dash ro-kaart ${modus === 'dk' ? 'ro-dk' : 'ro-mb'}">
    <div class="ro-kk">${ico('attendance-evaluatie', 18)}<b>${esc(r.naam)}</b><span>${esc(termijn(r))}</span></div>
    <div class="ro-dash-in">
      <div class="ro-dash-pct"><b style="color:${kleur}">${pct}%</b><span>${b.beoordeeld} van ${b.spelers} spelers beoordeeld</span>${balk(pct, kleur)}</div>
      ${stoplicht(b.tel)}
      <button type="button" class="${modus === 'dk' ? 'dk-knop rood' : 'mb-knop rood'}" data-ro="naarscherm" data-id="${esc(r.id)}">Open de evaluatieronde ›</button>
    </div></div>`;
}

function htmlVoortgang(b, ctx){
  const groepen = [['niet', 'Niet begonnen', 'Nog geen enkele speler beoordeeld'], ['bezig', 'Bezig', 'Begonnen, nog niet alle spelers'], ['klaar', 'Klaar', 'Alle spelers beoordeeld']];
  const eigenUid = ctx._roUid || '';
  const kaart = t => {
    const pct = t.totaal ? Math.round(t.gedaan / t.totaal * 100) : 0;
    return `<button type="button" class="ro-trk" data-ro="team" data-id="${esc(t.team.id)}" data-trainer="${esc(t.uid)}">
      <span class="ro-trk-t"><b>${esc(t.naam)}${t.uid === eigenUid ? ' (jij)' : ''}</b><small>${esc(t.team.naam)}</small></span>
      <span class="ro-trk-n">${t.gedaan}/${t.totaal}</span>${balk(pct, statusKleur(t.status))}
      <span class="ro-trk-s">${t.status === 'niet' ? 'nog niets ingevuld' : 'laatst actief ' + esc(geleden(t.laatst))}${t.deels ? ` · ${t.deels} niet compleet` : ''}</span></button>`;
  };
  const kolom = ([k, titel, sub]) => {
    const lijst = b.trainers.filter(t => t.status === k).sort((x, y) => (x.gedaan / (x.totaal || 1)) - (y.gedaan / (y.totaal || 1)) || x.team.naam.localeCompare(y.team.naam, 'nl', { numeric:true }));
    return `<section class="ro-kol ${k}"><h4><i></i>${titel}<span>${lijst.length}</span></h4><p>${sub}</p>${lijst.map(kaart).join('') || '<div class="ro-kol-leeg">Niemand</div>'}</section>`;
  };
  const zonder = b.teams.filter(x => !x.trainers.length);
  const teams = [...b.teams].sort((x, y) => (x.model.totaal ? (x.model.klaar + x.model.deels) / x.model.totaal : 1) - (y.model.totaal ? (y.model.klaar + y.model.deels) / y.model.totaal : 1));
  return `<div class="ro-kan">${groepen.map(kolom).join('')}</div>
    <div class="ro-kaart"><div class="ro-kk">${ico('team-team', 18)}<b>Dekking per team</b><span>spelers met minstens één beoordeling</span></div>
      ${teams.map(x => { const g = x.model.klaar + x.model.deels, pct = x.model.totaal ? Math.round(g / x.model.totaal * 100) : 0;
        return `<button type="button" class="ro-dek" data-ro="team" data-id="${esc(x.t.id)}"><b>${esc(x.t.naam)}</b>${balk(pct, pct >= 100 ? 'var(--ok)' : pct >= 50 ? 'var(--warn)' : 'var(--accent)')}<span>${g}/${x.model.totaal}</span>
          <small>${x.trainers.length ? x.trainers.map(t => `<i class="${t.status}"></i>${esc(voornaam(t.naam))}`).join(' ') : 'geen coach gekoppeld'}</small></button>`; }).join('')}
      ${zonder.length ? `<p class="ro-voetnoot">${meerv(zonder.length, 'team heeft', 'teams hebben')} geen gekoppelde coach.</p>` : ''}</div>
    ${b.ronde.status !== 'gesloten' && (b.tel.niet || b.tel.bezig) ? `<div class="ro-kaart ro-deel"><div><b>Trainers een duwtje geven?</b><span>Deel een korte herinnering in de trainersgroep. Er staan geen namen in.</span></div>
      <button type="button" class="knop licht klein" data-ro="deel">${ico('action-share', 16)}Herinnering delen</button></div>` : ''}`;
}

function htmlScores(b, ctx, st){
  const team = st.teamId && b.teams.find(x => x.t.id === st.teamId);
  if (team){
    const snel = b.ronde.soort === 'snel';
    const actief = !snel && team.trainers.some(t => t.uid === st.trainer) ? st.trainer : '';
    const model = actief ? teamModel({ ...team.basis, uid: actief }) : team.model;
    const anders = team.model.rijen.filter(r => r.agg && r.agg.maxSpr >= D.verschil).length;
    return `<button type="button" class="ro-terug" data-ro="teamterug">‹ Alle teams</button>
      <div class="ro-kaart"><div class="ro-kk">${ico('team-team', 18)}<b>${esc(team.t.naam)}</b><span>${team.model.klaar + team.model.deels} van ${team.model.totaal} spelers beoordeeld</span></div>
        ${snel || team.trainers.length < 2 ? '' : `<div class="ro-chips ro-wie" aria-label="Trainer">
          <button type="button" class="ro-chip${!actief ? ' aan' : ''}" data-ro="trainer" data-id="">Gemiddeld</button>
          ${team.trainers.map(t => `<button type="button" class="ro-chip${actief === t.uid ? ' aan' : ''}" data-ro="trainer" data-id="${esc(t.uid)}"><i class="${t.status}"></i>${esc(voornaam(t.naam))} ${t.gedaan}/${t.totaal}</button>`).join('')}</div>`}
        ${!actief && anders ? `<div class="ro-let">${ico('action-warning', 15)}<span>Bij ${meerv(anders, 'speler', 'spelers')} zien de trainers een domein duidelijk anders (omlijnd vakje). Tik op de speler voor beide beoordelingen.</span></div>` : ''}
        ${htmlMatrix(model, st, { lees:true, dec: !actief && team.trainers.length > 1, verschil: !actief })}${legenda(model.deels > 0)}
        <p class="ro-voetnoot">Tik op een speler voor de scores per trainer en de toelichtingen. Alleen lezen.</p></div>`;
  }
  const rijen = b.teams.map(x => `<button type="button" class="ro-rij" style="--ro-n:${b.ronde.soort === 'snel' ? 1 : 5}" data-ro="team" data-id="${esc(x.t.id)}">
      <span class="ro-nm"><span class="ro-nmt"><b>${esc(x.t.naam)}</b><small>${x.model.klaar + x.model.deels}/${x.model.totaal} spelers</small></span></span>
      ${b.ronde.soort === 'snel' ? cel(x.model.teamGem, { dec:true }) : DOM.map(d => cel(x.model.teamDom[d.id], { dec:true })).join('')}<span class="ro-g">${komma(x.model.teamGem)}</span></button>`).join('');
  return `<div class="ro-kaart"><div class="ro-kk">${ico('stats-bars', 18)}<b>Teams naast elkaar</b><span>gemiddelde per domein · tik een team</span></div>
      <div class="ro-matrix ro-dom ro-teams"><div class="ro-rij ro-kopr" style="--ro-n:${b.ronde.soort === 'snel' ? 1 : 5}"><span class="ro-nm"></span>${b.ronde.soort === 'snel' ? '<span class="ro-kh">Niveau</span>' : DOM.map(d => `<span class="ro-kh" title="${esc(d.naam)}">${d.id}</span>`).join('')}<span class="ro-kh g">Gem</span></div>
        ${rijen}
        ${b.met.length ? `<div class="ro-rij ro-voet" style="--ro-n:${b.ronde.soort === 'snel' ? 1 : 5}"><span class="ro-nm"><span class="ro-nmt"><b>Hele bouw</b><small>${b.beoordeeld} spelers</small></span></span>${b.ronde.soort === 'snel' ? cel(b.bouwGem, { dec:true }) : DOM.map(d => cel(b.bouwDom[d.id], { dec:true })).join('')}<span class="ro-g">${komma(b.bouwGem)}</span></div>` : ''}</div>
      ${legenda()}
      <p class="ro-voetnoot">Een score zegt iets over de ontwikkeling binnen de eigen leeftijd. Vergelijk teams daarom vooral op hun profiel (welk domein springt eruit), niet op wie het hoogst staat.</p></div>`;
}

function htmlInzichten(b){
  if (!b.met.length) return '<div class="ro-kaart ro-leeg">Nog geen beoordelingen in deze ronde. Zodra de eerste trainers invullen, verschijnen hier de inzichten.</div>';
  const snel = b.ronde.soort === 'snel';
  const spRij = (r, rechts) => `<button type="button" class="ro-lr" data-ro="team" data-id="${esc(r.team.id)}" data-speler="${esc(r.p.id)}"><b>${esc(r.p.naam)}</b><small>${esc(r.team.naam)}</small><span>${rechts}</span></button>`;
  const blok = (icoon, titel, sub, inhoud) => `<div class="ro-kaart"><div class="ro-kk">${ico(icoon, 18)}<b>${titel}</b></div><p class="ro-sub">${sub}</p>${inhoud}</div>`;
  const uit = [];
  /* strengheid per trainer */
  const tr = b.trainers.filter(t => t.aantal >= D.minStreng && t.gem != null);
  if (!snel && tr.length >= 2 && b.bouwGem != null){
    const max = Math.max(0.5, ...tr.map(t => Math.abs(t.gem - b.bouwGem)));
    uit.push(blok('tag-agreement-warn', 'Hoe streng beoordeelt iedere trainer?', `Gemiddelde score per trainer, afgezet tegen het gemiddelde van de bouw (${komma(b.bouwGem)}). Een verschil kan ook aan het team liggen: gebruik het als gespreksopening, niet als oordeel.`,
      `<div class="ro-streng">${[...tr].sort((x, y) => y.gem - x.gem).map(t => { const v = t.gem - b.bouwGem, w = Math.round(Math.abs(v) / max * 50);
        return `<div class="ro-str"><span><b>${esc(voornaam(t.naam))}</b><small>${esc(t.team.naam)}</small></span><span class="ro-str-b"><i class="${v >= 0 ? 'plus' : 'min'}" style="width:${w}%"></i></span><em>${Math.abs(v) < 0.05 ? '' : v > 0 ? '+' : '−'}${komma(Math.abs(v))}</em></div>`; }).join('')}</div>`));
  }
  /* verschil van inzicht */
  const anders = b.met.filter(r => r.agg.n > 1 && r.agg.maxSpr >= D.verschil).sort((x, y) => y.agg.maxSpr - x.agg.maxSpr).slice(0, 8);
  if (anders.length) uit.push(blok('action-warning', 'Trainers zien het anders', 'Spelers waarbij de trainers van hetzelfde team op een domein ver uit elkaar zitten. Vaak het interessantste gesprek.',
    anders.map(r => { const d = DOM.filter(x => r.agg.spr[x.id] != null).sort((x, y) => r.agg.spr[y.id] - r.agg.spr[x.id])[0];
      const w = r.agg.metingen.map(m => m.dom[d.id]).filter(v => v != null);
      return spRij(r, `${esc(d.kort)} ${cel(Math.min(...w))}<i class="ro-vs">vs</i>${cel(Math.max(...w))}`); }).join('')));
  /* uitblinkers en aandacht */
  const top = b.met.filter(r => r.agg.gem >= D.uitblinker).sort((x, y) => y.agg.gem - x.agg.gem).slice(0, 8);
  if (top.length) uit.push(blok('tag-leader', 'Vallen positief op', 'Hoogste gemiddelden van de bouw. Denk aan extra uitdaging, meetrainen of doorstromen.', top.map(r => spRij(r, cel(r.agg.gem, { dec:true }))).join('')));
  const zorg = b.met.filter(r => r.agg.gem <= D.aandacht).sort((x, y) => x.agg.gem - y.agg.gem).slice(0, 8);
  if (zorg.length) uit.push(blok('action-info', 'Vragen extra aandacht', 'Laagste gemiddelden van de bouw. Kijk mee met de trainer wat deze speler nodig heeft.', zorg.map(r => {
    const d = DOM.filter(x => r.agg.dom[x.id] != null).sort((x, y) => r.agg.dom[x.id] - r.agg.dom[y.id])[0];
    return spRij(r, `${d ? esc(d.kort) + ' ' : ''}${cel(r.agg.gem, { dec:true })}`); }).join('')));
  /* groei en terugval */
  const metDelta = b.met.filter(r => r.delta != null);
  const groei = metDelta.filter(r => r.delta > D.delta).sort((x, y) => y.delta - x.delta).slice(0, 5);
  const terug = metDelta.filter(r => r.delta < -D.delta).sort((x, y) => x.delta - y.delta).slice(0, 5);
  if (groei.length || terug.length) uit.push(blok('training-intensity', 'Groei sinds de vorige meting', `Vergeleken met de laatste volledige beoordeling vóór deze ronde (${metDelta.length} spelers hebben er een).`,
    `${groei.map(r => spRij(r, `<em class="ro-d op">▲ ${komma(r.delta)}</em>`)).join('')}${terug.map(r => spRij(r, `<em class="ro-d neer">▼ ${komma(Math.abs(r.delta))}</em>`)).join('')}`));
  /* kwaliteit van invullen */
  const metingen = b.met.flatMap(r => r.agg.metingen);
  const metNotitie = metingen.filter(m => m.notities > 0).length, deels = metingen.filter(m => m.open > 0).length;
  uit.push(blok('admin-document', 'Kwaliteit van invullen', 'Hoe volledig en hoe goed toegelicht de beoordelingen zijn.',
    `<div class="ro-kw"><span><b>${metingen.length}</b>beoordelingen</span><span><b>${Math.round(metNotitie / metingen.length * 100)}%</b>met toelichting</span><span><b>${deels}</b>niet compleet</span></div>`));
  return `<div class="ro-inzgrid">${uit.join('')}</div>`;
}

/* Het hele scherm. modus: 'dk' (desktop) | 'mb' (telefoon). */
export function htmlRondeScherm(ctx, modus){
  const { st, rondes, ronde } = staat(ctx);
  if (!ronde) return `<div class="ro-wortel ro-coord ${modus === 'dk' ? 'ro-dk' : 'ro-mb'}"><div class="ro-kaart ro-leeg">${ico('attendance-evaluatie', 22)}<b>Er loopt geen evaluatieronde voor deze bouw</b>
    <span>De clubbeheerder zet een ronde klaar onder Club, Evaluaties. Zodra hij loopt, volg je hier de voortgang en de scores.</span></div></div>`;
  const b = bouwModel(ctx, ronde);
  const pct = b.spelers ? Math.round(b.beoordeeld / b.spelers * 100) : 0;
  const tabs = [['voortgang', 'Voortgang'], ['scores', 'Scores'], ['inzicht', 'Inzichten']];
  let binnen = '';
  try { binnen = st.tab === 'scores' ? htmlScores(b, ctx, st) : st.tab === 'inzicht' ? htmlInzichten(b) : htmlVoortgang(b, ctx); }
  catch(e){ console.warn('[Cluppie] rondecockpit tekenen mislukt', e); binnen = '<div class="ro-kaart ro-leeg">Dit onderdeel kon niet getekend worden.</div>'; }
  return `<div class="ro-wortel ro-coord ${modus === 'dk' ? 'ro-dk' : 'ro-mb'}">
    ${rondes.length > 1 ? `<div class="ro-chips ro-rondes" aria-label="Evaluatieronde">${rondes.map(r => `<button type="button" class="ro-chip${r.id === ronde.id ? ' aan' : ''}" data-ro="ronde" data-id="${esc(r.id)}">${esc(r.naam)}${r.status === 'gesloten' ? ' · afgesloten' : ''}</button>`).join('')}</div>` : ''}
    <div class="ro-kaart ro-hero ro-chero">
      <div class="ro-hero-top">${ring(b.beoordeeld, b.spelers, 84)}
        <div class="ro-hero-t"><small>${meerv(b.teams.length, 'team', 'teams')} · ${meerv(b.trainers.length, 'trainer', 'trainers')} · ${ronde.soort === 'snel' ? 'snelle beoordeling' : 'volledige beoordeling'}</small><b>${esc(ronde.naam)}</b><span>${esc(termijn(ronde))} · ${pct}% van de spelers beoordeeld</span></div></div>
      ${stoplicht(b.tel)}
    </div>
    <div class="ro-tabs" role="tablist">${tabs.map(([k, l]) => `<button type="button" role="tab" aria-selected="${st.tab === k}" class="${st.tab === k ? 'aan' : ''}" data-ro="tab" data-id="${k}">${l}</button>`).join('')}</div>
    ${binnen}
  </div>`;
}

/* Tekst voor de herinnering: alleen ronde en einddatum, geen namen. */
export function herinnerTekst(ronde){
  const d = dagenTot(ronde.tot);
  return `Herinnering: ${ronde.naam}\n\n${d != null && d < 0 ? 'De einddatum is verstreken. Wil je je beoordelingen zo snel mogelijk afronden?' : `Wil je voor ${datumKort(ronde.tot)} alle spelers van je team beoordelen?`}\n\nIn Cluppie vind je de ronde bovenaan je teampagina. Onder Overzicht zie je in één beeld wie je al hebt beoordeeld en wie nog niet.`;
}
async function deel(tekst){
  try { if (navigator.share){ await navigator.share({ text: tekst }); return; } }
  catch(e){ if (e?.name === 'AbortError') return; }
  window.open('https://wa.me/?text=' + encodeURIComponent(tekst), '_blank', 'noopener');
}

/* ==================== KLIKKEN ====================
   Eén afhandeling voor beide schermen. Geeft true terug als de klik hier hoorde.
   Trainer:      roKlik(e, { st }, { herteken, speler(id), verder() })
   Coördinator:  roKlik(e, { ctx }, { herteken, naarScherm() })               */
export function roKlik(e, bron, api = {}){
  const b = e.target.closest('[data-ro]'); if (!b) return false;
  const a = b.dataset.ro, id = b.dataset.id || '';
  const coord = !!bron.ctx;
  const st = coord ? staat(bron.ctx).st : bron.st;
  const teken = () => api.herteken?.();
  if (a === 'dom'){ st.dom = st.dom === id ? '' : id; teken(); return true; }
  if (a === 'sort'){ st.sort = id; teken(); return true; }
  if (a === 'verder'){ api.verder?.(); return true; }
  if (a === 'speler'){
    if (api.speler) api.speler(id); else { st.uit = st.uit === id ? null : id; teken(); }
    return true;
  }
  if (!coord) return true;
  if (a === 'naarscherm'){ st.rondeId = id || st.rondeId; st.tab = 'voortgang'; st.teamId = null; api.naarScherm?.(); return true; }
  if (a === 'tab'){ st.tab = id; st.teamId = null; st.uit = null; teken(); return true; }
  if (a === 'ronde'){ st.rondeId = id; st.teamId = null; st.uit = null; teken(); return true; }
  if (a === 'team'){ st.tab = 'scores'; st.teamId = id; st.trainer = b.dataset.trainer || ''; st.uit = b.dataset.speler || null; st.dom = ''; teken(); try { window.scrollTo(0, 0); } catch(_){ } return true; }
  if (a === 'teamterug'){ st.teamId = null; st.uit = null; st.trainer = ''; st.dom = ''; teken(); return true; }
  if (a === 'trainer'){ st.trainer = id; st.uit = null; teken(); return true; }
  if (a === 'deel'){ const r = staat(bron.ctx).ronde; if (r) deel(herinnerTekst(r)); return true; }
  return true;
}
