/* ==================== UITLEENFORMULIER (coördinator) ====================
   [20261111] Eén formulier voor elke plek waar een speler wordt uitgeleend:
   bouw-hub (mobiel), mobiele bouwomgeving, desktop-bouw en het spelersprofiel.
   Twee tabbladen:
     - Eén wedstrijd: kies één wedstrijd van het ontvangende team; daarna is de
       uitlening vanzelf voorbij.
     - Uitgebreid:   wedstrijden en/of meetrainen, vanaf/tot, aantal of
       aangevinkte wedstrijden, trainingsdagen per team, en per datum met twee
       wedstrijden de keuze van de coördinator (beide / alleen het ene team).
   Regels en recordvorm: js/uitleen-regels.js.

   Alleen coördinatoren (bouw of eigen bouw) en de clubadmin mogen uitlenen;
   magUitlenen() is de zichtbaarheidscheck voor de knoppen. */
import { S, esc, meld, openModal, sluitModal } from './state.js?v=20261107e';
import {
  db, collection, doc, getDoc, getDocs, addDoc, updateDoc, query, where, documentId, serverTimestamp
} from './firebase.js?v=20261106r';
import { momentenVanTeam, tijdTekst } from './trainingsmomenten.js?v=20261107e';
import { bouwLeenSnapshot } from './teams-spelers.js?v=20261111c';
import { telGebruik } from './tracker.js?v=20261107e';
import {
  vandaagLokaal, plusDagen, DAG_NAMEN, leenOmschrijving, leenDatum
} from './uitleen-regels.js?v=20261111a';

export { magUitlenen } from './uitleen-rechten.js?v=20261111a';

/* ---------- Data ophalen ---------- */
async function clubTeams(clubId, behalve){
  const csnap = await getDoc(doc(db, 'clubs', clubId));
  const club = csnap.exists() ? csnap.data() : {};
  const ids = Object.keys(club.teams || {}).filter(id => id !== behalve);
  const uit = [];
  for (let i = 0; i < ids.length; i += 30){
    const chunk = ids.slice(i, i + 30);
    const tsnap = await getDocs(query(collection(db, 'teams'), where(documentId(), 'in', chunk)));
    tsnap.docs.forEach(d => uit.push({ id: d.id, ...d.data() }));
  }
  return { teams: uit, eigenBouwen: Array.isArray(club.eigenBouwen) ? club.eigenBouwen : [] };
}

/* ---------- Volgorde van de doelteams ----------
   [20261111c] Meestal gaat een speler naar een HOGER team (ouder, of zelfde
   leeftijd met een lager teamnummer). De keuzelijst toont daarom:
     1. de eigen bouw: eerst de hogere teams (dichtstbijzijnde bovenaan, met ↑),
        daarna de overige teams van de bouw;
     2. daarna de andere bouwen, de bouw boven de eigen eerst, met per bouw
        ook weer de hogere teams bovenaan.
   Niveau: leeftijd uit categorie of naam (JO13, MO17, O19), senioren = 40;
   binnen een leeftijd is -1 hoger dan -2. */
export function teamNiveau(t){
  const bron = `${t?.categorie || ''} ${t?.naam || ''}`.toUpperCase();
  const m = bron.match(/(?:^|[^A-Z0-9])[JM]?O\s?(\d{1,2})(?!\d)/);
  const leeftijd = m ? Number(m[1]) : 40;
  const n = String(t?.naam || '').match(/[-\s](\d{1,2})\s*$/);
  const nr = n ? Number(n[1]) : 1;
  return leeftijd * 100 - Math.min(nr, 99);
}
const BOUW_VOLGORDE = ['onder', 'midden', 'boven'];
export function groepeerDoelTeams({ teams, vanTeam, bouw, bouwNaam, bouwTeamIds }){
  const vanNiveau = teamNiveau(vanTeam);
  const hoger = t => teamNiveau(t) > vanNiveau;
  const ordenen = lijst => [
    ...lijst.filter(hoger).sort((a, b) => teamNiveau(a) - teamNiveau(b)),
    ...lijst.filter(t => !hoger(t)).sort((a, b) => teamNiveau(b) - teamNiveau(a)),
  ];
  const inBouw = new Set(bouwTeamIds || []);
  const eigen = teams.filter(t => inBouw.has(t.id) || (!bouwTeamIds && bouw && t.bouw === bouw));
  const rest = teams.filter(t => !eigen.includes(t));
  const groepen = [];
  const eigenHoger = ordenen(eigen).filter(hoger), eigenRest = ordenen(eigen).filter(t => !hoger(t));
  const naamBouw = bouwNaam || 'Eigen bouw';
  if (eigenHoger.length) groepen.push({ label: `${naamBouw} · hoger`, teams: eigenHoger });
  if (eigenRest.length) groepen.push({ label: eigenHoger.length ? `${naamBouw} · overige` : naamBouw, teams: eigenRest });
  /* andere bouwen: standaardbouw van elk team; volgorde = eerst de bouwen
     boven die van het eigen team, oplopend, daarna die eronder, aflopend */
  const vanIdx = Math.max(0, BOUW_VOLGORDE.indexOf(vanTeam?.bouw || (vanNiveau >= 1600 ? 'boven' : vanNiveau >= 1200 ? 'midden' : 'onder')));
  const perBouw = new Map();
  for (const t of rest){
    const b = BOUW_VOLGORDE.includes(t.bouw) ? t.bouw : 'boven';
    if (!perBouw.has(b)) perBouw.set(b, []);
    perBouw.get(b).push(t);
  }
  const volgorde = [...BOUW_VOLGORDE.slice(vanIdx), ...BOUW_VOLGORDE.slice(0, vanIdx).reverse()];
  const NAMEN = { onder: 'Onderbouw', midden: 'Middenbouw', boven: 'Bovenbouw' };
  for (const b of volgorde){
    const lijst = perBouw.get(b); if (!lijst?.length) continue;
    groepen.push({ label: NAMEN[b], teams: ordenen(lijst) });
  }
  return groepen.map(g => ({ ...g, teams: g.teams.map(t => ({ id: t.id, naam: t.naam || '?', hoger: hoger(t) })) }));
}
async function teamDoc(id){
  try { const s = await getDoc(doc(db, 'teams', id)); return s.exists() ? { id: s.id, ...s.data() } : null; }
  catch(e){ return null; }
}
/* Komende wedstrijden; null als we ze niet mogen lezen (ander team, geen rechten). */
async function komendeWedstrijden(teamId, vanaf){
  try {
    const snap = await getDocs(query(collection(db, 'teams', teamId, 'wedstrijden'), where('datum', '>=', vanaf)));
    return snap.docs.map(d => ({ id: d.id, datum: d.data().datum || '', aftrap: d.data().aftrap || '',
      tegenstander: d.data().tegenstander || 'Tegenstander', thuis: !!d.data().thuis, type: d.data().type || '' }))
      .filter(w => w.datum && w.type !== 'toernooi')
      .sort((a, b) => (a.datum + a.aftrap).localeCompare(b.datum + b.aftrap));
  } catch(e){ return null; }
}
const wKort = w => ({ id: w.id, datum: w.datum, aftrap: w.aftrap || '', tegenstander: w.tegenstander || '' });
const wTekst = w => `${w.thuis ? '' : '@ '}${w.tegenstander}`;

/* ==================== Formulier ====================
   opties: { clubId, vanTeam:{id,naam,bouw?,club?}, speler?:{id,naam,...},
             spelersVan?: [teams waaruit gekozen mag worden], bestaand?: record,
             naOpslaan?: (record) => void } */
export async function openUitleenForm(opties){
  const { clubId } = opties;
  if (!clubId) return meld('Dit team hoort niet bij een club');
  const vandaag = vandaagLokaal();
  const b = opties.bestaand || null;

  const st = {
    vanTeam: opties.vanTeam || null, speler: opties.speler || null,
    teamsKeuze: opties.spelersVan || null, spelersVanTeam: [],
    naarTeams: [], naarGroepen: [], naar: null,
    naarDoc: null, vanDoc: null, naarW: null, vanW: [],
    laden: false,
    tab: b?.soort === 'wedstrijd' ? 'snel' : (b ? 'uitg' : 'snel'),
    snelW: b?.soort === 'wedstrijd' ? b.wedstrijd?.id : null,
    wat: b?.wat || 'b',
    vanaf: b?.soort === 'periode' && b.vanaf ? b.vanaf : vandaag,
    duur: b?.soort === 'periode' ? (Array.isArray(b.wedstrijden) ? 'kies' : (b.tot ? 'datum' : 'open')) : 'datum',
    tot: b?.tot && b.soort === 'periode' ? b.tot : plusDagen(vandaag, 28),
    aantal: 4,
    gekozen: new Set(Array.isArray(b?.wedstrijden) ? b.wedstrijden.map(w => w.id) : []),
    trainNaar: b?.trainNaar ? new Set(b.trainNaar) : null,
    trainVan: b?.trainVan ? new Set(b.trainVan) : null,
    conflicten: { ...(b?.conflicten || {}) },
    bezig: false,
  };
  if (b){ st.naar = { id: b.naarTeam, naam: b.naarTeamNaam }; }

  openModal(`<h2>${b ? 'Uitlening wijzigen' : 'Speler uitlenen'}</h2><div id="ulForm" class="ul-form"></div>`);
  /* [20261111b] Op desktop schuift het formulier als paneel van rechts over
     het scherm, in plaats van het hele scherm te vervangen. Op de telefoon
     blijft het een volledig scherm (CSS: .modal-achter[data-vorm="paneel"]).
     openModal zet data-vorm bij elke volgende modal opnieuw. */
  const achter = document.getElementById('modalAchter');
  achter?.setAttribute('data-vorm', 'paneel');
  const opEsc = e => { if (e.key === 'Escape' && achter?.classList.contains('open') && achter.dataset.vorm === 'paneel') sluitModal(); };
  document.addEventListener('keydown', opEsc);
  const opruimen = new MutationObserver(() => {
    if (!achter?.classList.contains('open') || achter.dataset.vorm !== 'paneel'){ document.removeEventListener('keydown', opEsc); opruimen.disconnect(); }
  });
  if (achter) opruimen.observe(achter, { attributes: true, attributeFilter: ['class', 'data-vorm'] });
  const root = document.getElementById('ulForm');

  /* ---------- afgeleiden ---------- */
  const naarW = () => st.naarW || [];
  const naarMomenten = () => st.naarDoc ? momentenVanTeam(st.naarDoc) : [];
  const vanMomenten = () => st.vanDoc ? momentenVanTeam(st.vanDoc) : [];
  const binnen = d => d >= st.vanaf && (st.duur !== 'datum' || d <= st.tot);
  function gedekteWedstrijden(){
    if (st.tab === 'snel') return naarW().filter(w => w.id === st.snelW);
    if (st.wat === 't') return [];
    const lijst = naarW().filter(w => w.datum >= st.vanaf);
    if (st.duur === 'kies') return lijst.filter(w => st.gekozen.has(w.id));
    if (st.duur === 'aantal') return lijst.slice(0, Math.max(1, Number(st.aantal) || 1));
    return lijst.filter(w => binnen(w.datum));
  }
  /* Datums waarop het eigen team óók speelt: daar kiest de coördinator. */
  function conflictDatums(){
    const vanPer = new Map();
    for (const w of st.vanW) if (!vanPer.has(w.datum)) vanPer.set(w.datum, w);
    const uit = [];
    for (const w of gedekteWedstrijden()){
      const v = vanPer.get(w.datum);
      if (v && !uit.some(x => x.datum === w.datum)) uit.push({ datum: w.datum, naar: w, van: v });
    }
    return uit;
  }
  function record(){
    const conf = {};
    for (const c of conflictDatums()) conf[c.datum] = st.conflicten[c.datum] || 'beide';
    if (st.tab === 'snel'){
      const w = naarW().find(x => x.id === st.snelW);
      return w ? { soort: 'wedstrijd', wedstrijd: wKort(w), tot: w.datum, conflicten: conf } : null;
    }
    const r = { soort: 'periode', wat: st.wat, vanaf: st.vanaf, conflicten: conf, wedstrijden: null, tot: null, trainNaar: [], trainVan: null, trainVanNiet: [] };
    if (st.wat !== 't' && (st.duur === 'kies' || st.duur === 'aantal')){
      const ws = gedekteWedstrijden();
      r.wedstrijden = ws.map(wKort);
      r.tot = ws.length ? ws[ws.length - 1].datum : st.vanaf;
    }
    if (st.duur === 'datum') r.tot = st.tot;
    if (st.wat !== 'w'){
      r.trainNaar = [...(st.trainNaar || [])].sort();
      r.trainVan = [...(st.trainVan || [])].sort();
      r.trainVanNiet = vanMomenten().map(m => m.dag).filter(d => !st.trainVan?.has(d));
    }
    return r;
  }
  function fout(){
    if (!st.vanTeam || !st.speler) return 'Kies een team en een speler';
    if (!st.naar) return 'Kies naar welk team';
    if (st.laden) return 'Even geduld…';
    if (st.tab === 'snel') return st.snelW ? null : 'Kies de wedstrijd';
    if (st.duur === 'datum' && (!st.tot || st.tot < st.vanaf)) return 'De einddatum ligt vóór de startdatum';
    if (st.wat !== 't' && (st.duur === 'kies' || st.duur === 'aantal') && !gedekteWedstrijden().length) return 'Kies minstens één wedstrijd';
    if (st.wat !== 'w' && !(st.trainNaar && st.trainNaar.size)) return `Kies minstens één trainingsdag bij ${st.naar.naam}`;
    return null;
  }

  /* ---------- html-bouwstenen ---------- */
  const seg = (naam, keuzes, actief) => `<div class="segment ul-seg" role="group">${keuzes.map(([w, l]) =>
    `<button type="button" class="${w === actief ? 'actief' : ''}" aria-pressed="${w === actief}" data-ul="${naam}" data-w="${w}">${l}</button>`).join('')}</div>`;
  const veld = (label, inhoud) => `<label class="ul-veld"><span>${label}</span>${inhoud}</label>`;
  const wRij = (w, type, aan) => `<label class="ul-wrij${aan ? ' aan' : ''}">
      <input type="${type}" name="ulW" data-ul="${type === 'radio' ? 'snelw' : 'kiesw'}" value="${esc(w.id)}" ${aan ? 'checked' : ''}>
      <span class="ul-wd">${esc(leenDatum(w.datum))}</span><span class="ul-wt">${esc(wTekst(w))}</span>${w.aftrap ? `<span class="ul-tijd">${esc(w.aftrap)}</span>` : ''}</label>`;
  const dagKnop = (set, naam, dag, aan) => `<div class="segment segment-sub ul-mini" role="group">
      <button type="button" class="${aan ? 'actief' : ''}" aria-pressed="${aan}" data-ul="${naam}" data-dag="${dag}" data-aan="1">Erbij</button>
      <button type="button" class="${aan ? '' : 'actief'}" aria-pressed="${!aan}" data-ul="${naam}" data-dag="${dag}" data-aan="0">Niet</button></div>`;

  function htmlKeuzeSpeler(){
    if (opties.speler) return '';
    return `
      ${veld('Van team', `<select class="invoer" id="ulVan"><option value="">Kies een team…</option>${(st.teamsKeuze || []).map(t => `<option value="${esc(t.id)}" ${st.vanTeam?.id === t.id ? 'selected' : ''}>${esc(t.naam)}</option>`).join('')}</select>`)}
      ${veld('Speler', `<select class="invoer" id="ulSpeler" ${st.vanTeam ? '' : 'disabled'}><option value="">${st.vanTeam ? 'Kies een speler…' : 'Kies eerst een team…'}</option>${st.spelersVanTeam.map(p => `<option value="${esc(p.id)}" ${st.speler?.id === p.id ? 'selected' : ''}>${esc(p.naam)}${p.nummer != null && p.nummer !== '' ? ' · #' + esc(p.nummer) : ''}</option>`).join('')}</select>`)}`;
  }

  function htmlSnel(){
    if (st.naarW === null) return `<p class="ul-noot">De wedstrijden van ${esc(st.naar.naam)} zijn niet te lezen met jouw rechten. Gebruik <b>Uitgebreid</b> met een periode.</p>`;
    if (!naarW().length) return `<p class="ul-noot">${esc(st.naar.naam)} heeft geen komende wedstrijden in Cluppie. Gebruik <b>Uitgebreid</b> met een periode.</p>`;
    return `<div class="ul-kop">Welke wedstrijd</div>
      <div class="ul-lijst">${naarW().slice(0, 12).map(w => wRij(w, 'radio', w.id === st.snelW)).join('')}</div>`;
  }

  function htmlUitg(){
    const nm = naarMomenten(), vm = vanMomenten();
    const kanKiezen = st.naarW !== null && naarW().length > 0;
    if (!kanKiezen && (st.duur === 'kies' || st.duur === 'aantal')) st.duur = 'datum';
    const duurOpties = [['datum', 'Tot en met datum'], ...(kanKiezen && st.wat !== 't' ? [['aantal', 'Aantal wedstrijden'], ['kies', 'Wedstrijden aanvinken']] : []), ['open', 'Geen einddatum']];
    return `
      <div class="ul-kop">Wat doet ${esc(st.speler?.naam || 'de speler')} bij ${esc(st.naar.naam)}</div>
      ${seg('wat', [['w', 'Wedstrijden'], ['t', 'Meetrainen'], ['b', 'Allebei']], st.wat)}

      <div class="ul-kop">Periode</div>
      ${veld('Vanaf', `<input class="invoer" type="date" id="ulVanaf" value="${esc(st.vanaf)}" min="${esc(vandaag)}">`)}
      <div class="ul-opties">${duurOpties.map(([w, l]) => `
        <label class="ul-optie${st.duur === w ? ' aan' : ''}"><input type="radio" name="ulDuur" data-ul="duur" value="${w}" ${st.duur === w ? 'checked' : ''}><span>${l}</span>
          ${w === 'datum' && st.duur === 'datum' ? `<input class="invoer ul-klein" type="date" id="ulTot" value="${esc(st.tot)}" min="${esc(st.vanaf)}">` : ''}
          ${w === 'aantal' && st.duur === 'aantal' ? `<input class="invoer ul-klein ul-getal" type="number" inputmode="numeric" id="ulAantal" min="1" max="30" value="${esc(st.aantal)}">` : ''}
        </label>`).join('')}</div>
      ${st.duur === 'kies' ? `<div class="ul-lijst">${naarW().filter(w => w.datum >= st.vanaf).slice(0, 20).map(w => wRij(w, 'checkbox', st.gekozen.has(w.id))).join('')}</div>` : ''}
      ${st.duur === 'aantal' ? `<p class="ul-noot">${gedekteWedstrijden().map(w => esc(leenDatum(w.datum))).join(', ') || 'Geen wedstrijden in deze periode.'}</p>` : ''}
      ${st.naarW === null && st.wat !== 't' ? `<p class="ul-noot">De wedstrijden van ${esc(st.naar.naam)} zijn niet te lezen met jouw rechten: de uitlening geldt voor alle wedstrijden in de periode.</p>` : ''}

      ${st.wat !== 'w' ? `
      <div class="ul-kop">Trainingen per dag</div>
      ${nm.length || vm.length ? `<div class="ul-dagen">
        ${[...nm.map(m => ({ m, naar: true })), ...vm.map(m => ({ m, naar: false }))]
          .sort((a, c) => a.m.dag - c.m.dag || (a.m.start || '').localeCompare(c.m.start || ''))
          .map(({ m, naar }) => `<div class="ul-dag"><b>${DAG_NAMEN[m.dag]}</b><span>${esc(naar ? st.naar.naam : (st.vanTeam?.naam || 'Eigen team'))}<small>${esc(tijdTekst(m) || 'tijd onbekend')} · ${naar ? 'bij uitleenteam' : 'eigen team'}</small></span>${naar
            ? dagKnop(st.trainNaar, 'tnaar', m.dag, st.trainNaar.has(m.dag))
            : dagKnop(st.trainVan, 'tvan', m.dag, st.trainVan.has(m.dag))}</div>`).join('')}
      </div>` : ''}
      ${!nm.length ? `<p class="ul-noot">${esc(st.naar.naam)} heeft nog geen trainingsdagen ingesteld (Club › Teams). Zonder trainingsdag kan meetrainen niet.</p>` : ''}
      <p class="ul-noot">Op dagen bij het eigen team vult de eigen trainer de presentie in. Zet je een eigen dag op Niet, dan telt die training niet mee voor de speler.</p>` : ''}`;
  }

  function htmlConflicten(){
    const lijst = conflictDatums();
    if (!lijst.length) return '';
    return `<div class="ul-kop">Twee wedstrijden op één dag</div>${lijst.map(c => {
      const k = st.conflicten[c.datum] || 'beide';
      return `<div class="ul-conflict">
        <p><b>${esc(leenDatum(c.datum))}</b>: ${esc(st.vanTeam?.naam || 'eigen team')} ${c.van.aftrap ? 'om ' + esc(c.van.aftrap) : ''}, ${esc(st.naar.naam)} ${c.naar.aftrap ? 'om ' + esc(c.naar.aftrap) : ''}. Waar speelt ${esc(st.speler?.naam || 'de speler')}?</p>
        <div class="segment segment-sub ul-mini" role="group">${[['beide', 'Allebei'], ['naar', 'Alleen ' + st.naar.naam], ['van', 'Alleen ' + (st.vanTeam?.naam || 'eigen')]].map(([w, l]) =>
          `<button type="button" class="${k === w ? 'actief' : ''}" aria-pressed="${k === w}" data-ul="conflict" data-d="${esc(c.datum)}" data-w="${w}">${esc(l)}</button>`).join('')}</div>
      </div>`; }).join('')}`;
  }

  function samenvatting(){
    const r = record(); if (!r || !st.naar) return '';
    const tekst = leenOmschrijving({ ...r, naarTeamNaam: st.naar.naam });
    const eind = st.tab === 'snel' ? 'Na deze wedstrijd is de uitlening vanzelf voorbij.' : (r.tot ? `Na ${leenDatum(r.tot)} is de uitlening vanzelf voorbij.` : 'Beëindig hem zelf als hij klaar is.');
    return `<div class="ul-samenvat"><b>${esc(st.speler?.naam || 'Speler')} → ${esc(st.naar.naam)}</b><span>${esc(tekst)}</span><span>${esc(eind)}</span></div>`;
  }

  function teken(){
    const f = fout();
    root.innerHTML = `
      ${st.vanTeam && opties.speler ? `<p class="ul-sub">${esc(opties.speler.naam)} · ${esc(st.vanTeam.naam)}</p>` : ''}
      ${htmlKeuzeSpeler()}
      ${veld('Naar team', b
        ? `<input class="invoer" value="${esc(st.naar?.naam || '')}" disabled>`
        : `<select class="invoer" id="ulNaar" ${st.naarTeams.length ? '' : 'disabled'}><option value="">${st.naarTeams.length ? 'Kies een team…' : 'Teams laden…'}</option>${st.naarGroepen.map(g => `<optgroup label="${esc(g.label)}">${g.teams.map(t => `<option value="${esc(t.id)}" ${st.naar?.id === t.id ? 'selected' : ''}>${t.hoger ? '↑ ' : ''}${esc(t.naam)}</option>`).join('')}</optgroup>`).join('')}</select>`)}
      ${!b && !st.naar && st.naarTeams.length ? `<p class="ul-noot">Eerst de teams van ${esc(st.naarGroepen[0]?.label.split(' · ')[0] || 'de eigen bouw')}, daarna de andere bouwen. <b>↑</b> = hoger team dan ${esc(st.vanTeam?.naam || 'het eigen team')}, het dichtstbijzijnde bovenaan.</p>` : ''}
      ${st.naar ? `
        ${seg('tab', [['snel', 'Eén wedstrijd'], ['uitg', 'Uitgebreid']], st.tab)}
        ${st.laden ? '<p class="ul-noot">Wedstrijden en trainingsdagen laden…</p>' : (st.tab === 'snel' ? htmlSnel() : htmlUitg()) + htmlConflicten()}
        ${st.laden ? '' : samenvatting()}` : ''}
      <div class="ul-voet">
        ${f && st.naar && !st.laden ? `<p class="ul-fout" role="status">${esc(f)}</p>` : ''}
        <div class="ul-voetknoppen">
          <button class="knop licht" id="ulAnnuleer">Annuleren</button>
          <button class="knop fluo ul-ok" id="ulOk" ${f || st.bezig ? 'disabled' : ''}>${st.bezig ? 'Bezig…' : b ? 'Wijziging bewaren' : (st.tab === 'snel' ? 'Uitlenen voor deze wedstrijd' : 'Uitlening vastleggen')}</button>
        </div>
      </div>`;
  }

  async function laadNaar(){
    st.laden = true; teken();
    const [nd, nw, vd, vw] = await Promise.all([
      teamDoc(st.naar.id), komendeWedstrijden(st.naar.id, vandaag),
      st.vanTeam ? (st.vanTeam.trainingsdagen || st.vanTeam.trainingsmomenten ? Promise.resolve(st.vanTeam) : teamDoc(st.vanTeam.id)) : Promise.resolve(null),
      st.vanTeam ? komendeWedstrijden(st.vanTeam.id, vandaag) : Promise.resolve([]),
    ]);
    st.naarDoc = nd; st.naarW = nw; st.vanDoc = vd; st.vanW = vw || [];
    /* Standaard: alle trainingsdagen van beide teams staan op Erbij (bij
       wijzigen blijft de bewaarde keuze staan). */
    if (!b || !b.trainNaar) st.trainNaar = new Set(naarMomenten().map(m => m.dag));
    if (!b || !Array.isArray(b.trainVan)) st.trainVan = new Set(vanMomenten().map(m => m.dag));
    if (st.tab === 'snel' && (st.naarW === null || !st.naarW.length) && !b) st.tab = 'uitg';
    st.laden = false; teken();
  }
  async function laadNaarTeams(){
    if (b || !st.vanTeam) return;
    try {
      const { teams, eigenBouwen } = await clubTeams(clubId, st.vanTeam.id);
      /* Welke bouw is "de eigen bouw"? Vanuit de bouw-hub de geopende bouw
         (ook een eigen bouw zoals Meidenbouw), anders de bouw van het team. */
      const bouwId = opties.bouw || st.vanTeam.bouw || null;
      const eb = eigenBouwen.find(x => x.id === bouwId);
      const NAMEN = { onder: 'Onderbouw', midden: 'Middenbouw', boven: 'Bovenbouw' };
      st.naarGroepen = groepeerDoelTeams({
        teams, vanTeam: st.vanTeam, bouw: bouwId,
        bouwNaam: eb?.naam || NAMEN[bouwId] || 'Eigen bouw',
        bouwTeamIds: eb ? (eb.teams || []) : (opties.bouwTeamIds || null),
      });
      st.naarTeams = st.naarGroepen.flatMap(g => g.teams);
    }
    catch(e){ meld('Teams ophalen mislukt: ' + (e.code || e.message)); }
    teken();
  }

  /* ---------- events (gedelegeerd, overleeft elk teken()) ---------- */
  root.addEventListener('click', e => {
    const k = e.target.closest('[data-ul]');
    if (!k || k.tagName === 'INPUT') return;
    const a = k.dataset.ul;
    if (a === 'tab') st.tab = k.dataset.w;
    else if (a === 'wat') st.wat = k.dataset.w;
    else if (a === 'tnaar' || a === 'tvan'){
      const set = a === 'tnaar' ? st.trainNaar : st.trainVan, dag = Number(k.dataset.dag);
      if (k.dataset.aan === '1') set.add(dag); else set.delete(dag);
    } else if (a === 'conflict') st.conflicten[k.dataset.d] = k.dataset.w;
    else return;
    teken();
  });
  root.addEventListener('change', async e => {
    const t = e.target;
    if (t.id === 'ulVan'){
      const team = (st.teamsKeuze || []).find(x => x.id === t.value) || null;
      st.vanTeam = team; st.speler = null; st.spelersVanTeam = []; st.naar = null; st.naarTeams = [];
      teken();
      if (team){
        try {
          const lijst = opties.spelersVoorTeam ? await opties.spelersVoorTeam(team.id)
            : (await getDocs(collection(db, 'teams', team.id, 'spelers'))).docs.map(d => ({ id: d.id, ...d.data() }));
          st.spelersVanTeam = lijst.filter(p => !p.gast && !p._ingeleend && !p.gearchiveerd).sort((a, b2) => (a.naam || '').localeCompare(b2.naam || ''));
        } catch(err){ meld('Spelers ophalen mislukt: ' + (err.code || err.message)); }
        teken(); laadNaarTeams();
      }
      return;
    }
    if (t.id === 'ulSpeler'){ st.speler = st.spelersVanTeam.find(p => p.id === t.value) || null; teken(); return; }
    if (t.id === 'ulNaar'){
      st.naar = st.naarTeams.find(x => x.id === t.value) || null;
      st.snelW = null; st.gekozen = new Set(); st.conflicten = {};
      if (st.naar) await laadNaar(); else teken();
      return;
    }
    if (t.id === 'ulVanaf'){ st.vanaf = t.value || vandaag; if (st.tot < st.vanaf) st.tot = st.vanaf; }
    else if (t.id === 'ulTot') st.tot = t.value;
    else if (t.id === 'ulAantal') st.aantal = Math.max(1, Math.min(30, Number(t.value) || 1));
    else if (t.dataset.ul === 'duur') st.duur = t.value;
    else if (t.dataset.ul === 'snelw') st.snelW = t.value;
    else if (t.dataset.ul === 'kiesw'){ if (t.checked) st.gekozen.add(t.value); else st.gekozen.delete(t.value); }
    else return;
    teken();
  });
  root.addEventListener('click', async e => {
    if (e.target.closest('#ulAnnuleer')){ sluitModal(); return; }
    if (!e.target.closest('#ulOk') || fout() || st.bezig) return;
    st.bezig = true; teken();
    const regels = record();
    try {
      let resultaat;
      if (b){
        const wijziging = { soort: regels.soort, tot: regels.tot ?? null, conflicten: regels.conflicten,
          wedstrijd: regels.wedstrijd || null, wat: regels.wat || null, vanaf: regels.vanaf || null,
          wedstrijden: regels.wedstrijden ?? null, trainNaar: regels.trainNaar || [], trainVan: regels.trainVan ?? null, trainVanNiet: regels.trainVanNiet || [],
          gewijzigd: serverTimestamp(), gewijzigdDoor: S.user?.uid || null };
        await updateDoc(doc(db, 'clubs', clubId, 'uitleningen', b.id), wijziging);
        resultaat = { ...b, ...wijziging };
        meld('Uitlening bijgewerkt');
      } else {
        let bron = st.speler;
        if (!bron.leerpunten && !opties.speler){
          const ps = await getDoc(doc(db, 'teams', st.vanTeam.id, 'spelers', bron.id));
          if (ps.exists()) bron = { id: ps.id, ...ps.data() };
        }
        telGebruik('uitlenen');
        const data = {
          spelerId: bron.id, vanTeam: st.vanTeam.id, vanTeamNaam: st.vanTeam.naam,
          naarTeam: st.naar.id, naarTeamNaam: st.naar.naam,
          overlay: {}, snapshot: bouwLeenSnapshot(bron),
          door: S.user?.uid || null, gemaakt: serverTimestamp(),
          ...regels,
        };
        const ref = await addDoc(collection(db, 'clubs', clubId, 'uitleningen'), data);
        resultaat = { id: ref.id, ...data };
        meld(`${bron.naam} uitgeleend aan ${st.naar.naam}`);
      }
      sluitModal();
      opties.naOpslaan?.(resultaat);
    } catch(err){
      st.bezig = false; teken();
      meld((b ? 'Bewaren' : 'Uitlenen') + ' mislukt: ' + (err.code || err.message));
    }
  });

  teken();
  if (b) laadNaar();
  else if (st.vanTeam) laadNaarTeams();
}
