/* ==================== UITLEENFORMULIER (coördinator) ====================
   [20261111] Eén formulier voor elke plek waar een speler wordt uitgeleend:
   bouw-hub (mobiel), mobiele bouwomgeving, desktop-bouw en het spelersprofiel.
   [20261111d] Twee tabbladen, elk met een eigen Ja/Nee en een eigen periode:
     - Wedstrijden: één wedstrijd, aanvinken, aantal, tot en met datum of
       geen einddatum; plus per datum met twee wedstrijden de keuze van de
       coördinator (beide / alleen het ene team).
     - Meetrainen:  vanaf/tot (los van de wedstrijden) en trainingsdagen per team.
   "Allebei" bestaat niet meer: zet je beide tabbladen op Ja, dan is het allebei.
   Regels en recordvorm: js/uitleen-regels.js.

   Alleen coördinatoren (bouw of eigen bouw) en de clubadmin mogen uitlenen;
   magUitlenen() is de zichtbaarheidscheck voor de knoppen. */
import { S, esc, meld, openModal, sluitModal } from './state.js?v=20261111g';
import {
  db, collection, doc, getDoc, getDocs, addDoc, updateDoc, query, where, documentId, serverTimestamp
} from './firebase.js?v=20261106r';
import { momentenVanTeam, tijdTekst } from './trainingsmomenten.js?v=20261111g';
import { bouwLeenSnapshot } from './teams-spelers.js?v=20261112d';
import { telGebruik } from './tracker.js?v=20261111g';
import {
  vandaagLokaal, plusDagen, DAG_NAMEN, leenDatum, leenDelen, leenGrenzen, wedDeelTekst, trainDeelTekst
} from './uitleen-regels.js?v=20261111d';

export { magUitlenen } from './uitleen-rechten.js?v=20261111g';

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
  /* [20261111d] Bestaande uitlening (ook de vormen van eerder vandaag) omzetten
     naar twee losse delen; de gekozen optie komt letterlijk terug. */
  const bd = b ? leenDelen(b) : { wed: null, train: null };
  const bw = bd.wed, bt = bd.train;
  const bewaardeLijst = Array.isArray(bw?.wedstrijden) ? bw.wedstrijden : [];

  const st = {
    vanTeam: opties.vanTeam || null, speler: opties.speler || null,
    teamsKeuze: opties.spelersVan || null, spelersVanTeam: [],
    naarTeams: [], naarGroepen: [], naar: null,
    naarDoc: null, vanDoc: null, naarW: null, vanW: [],
    /* bij wijzigen meteen 'laden': zo tekent het formulier de keuzes pas als
       de wedstrijden binnen zijn (anders sprong "aanvinken" terug naar datum) */
    laden: !!b,
    tab: b && !bw && bt ? 't' : 'w',
    w: {
      aan: b ? !!bw : true,
      keuze: bw?.keuze || 'een',
      een: bw?.keuze === 'een' ? (bewaardeLijst[0]?.id || null) : null,
      gekozen: new Set(bw?.keuze === 'kies' ? bewaardeLijst.map(w => w.id) : []),
      vanaf: bw?.vanaf && !['een', 'kies'].includes(bw.keuze) ? bw.vanaf : vandaag,
      tot: bw?.keuze === 'datum' && bw.tot ? bw.tot : plusDagen(vandaag, 28),
      aantal: bw?.aantal || (bw?.keuze === 'aantal' ? bewaardeLijst.length : 0) || 4,
    },
    t: {
      aan: !!bt,
      vanaf: bt?.vanaf || vandaag,
      duur: bt ? (bt.tot ? 'datum' : 'open') : 'datum',
      tot: bt?.tot || plusDagen(vandaag, 28),
      naar: bt?.trainNaar ? new Set(bt.trainNaar) : null,
      van: Array.isArray(bt?.trainVan) ? new Set(bt.trainVan) : null,
    },
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

  /* ---------- afgeleiden (geen wijzigingen in st tijdens het tekenen) ---------- */
  /* Wedstrijden om uit te kiezen: die van het ontvangende team; mag je die niet
     lezen, dan de eerder bewaarde lijst (zodat een keuze niet verloren gaat). */
  const naarLijst = () => st.naarW !== null ? st.naarW : bewaardeLijst;
  const kanKiezen = () => naarLijst().length > 0;
  const keuzeNu = () => (!kanKiezen() && ['een', 'kies', 'aantal'].includes(st.w.keuze)) ? 'datum' : st.w.keuze;
  const naarMomenten = () => st.naarDoc ? momentenVanTeam(st.naarDoc) : [];
  const vanMomenten = () => st.vanDoc ? momentenVanTeam(st.vanDoc) : [];

  function gedekteWedstrijden(){
    if (!st.w.aan) return [];
    const k = keuzeNu();
    if (k === 'een') return naarLijst().filter(w => w.id === st.w.een);
    if (k === 'kies') return naarLijst().filter(w => st.w.gekozen.has(w.id));
    const lijst = naarLijst().filter(w => w.datum >= st.w.vanaf);
    if (k === 'aantal') return lijst.slice(0, Math.max(1, Number(st.w.aantal) || 1));
    if (k === 'datum') return lijst.filter(w => w.datum <= st.w.tot);
    return lijst;
  }
  /* Laatste dag van het wedstrijddeel (null = geen einddatum). */
  function wedTot(){
    if (!st.w.aan) return null;
    const k = keuzeNu();
    if (k === 'datum') return st.w.tot;
    if (k === 'open') return null;
    const g = gedekteWedstrijden();
    return g.length ? g[g.length - 1].datum : null;
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
  function delen(){
    let wed = null, train = null;
    if (st.w.aan){
      const k = keuzeNu(), g = gedekteWedstrijden();
      const metLijst = ['een', 'kies', 'aantal'].includes(k);
      wed = {
        keuze: k,
        vanaf: metLijst && k !== 'aantal' ? (g[0]?.datum || vandaag) : st.w.vanaf,
        tot: wedTot(),
        aantal: k === 'aantal' ? Math.max(1, Number(st.w.aantal) || 1) : null,
        wedstrijden: metLijst ? g.map(wKort) : null,
      };
    }
    if (st.t.aan){
      train = {
        vanaf: st.t.vanaf,
        tot: st.t.duur === 'datum' ? st.t.tot : null,
        trainNaar: [...(st.t.naar || [])].sort(),
        trainVan: [...(st.t.van || [])].sort(),
        trainVanNiet: vanMomenten().map(m => m.dag).filter(d => !st.t.van?.has(d)),
      };
    }
    return { wed, train };
  }
  function record(){
    const conf = {};
    for (const c of conflictDatums()) conf[c.datum] = st.conflicten[c.datum] || 'beide';
    const { wed, train } = delen();
    const { vanaf, tot } = leenGrenzen(wed, train);
    return { soort: 'periode', versie: 2, wed, train, vanaf, tot, conflicten: conf };
  }
  function fout(){
    if (!st.vanTeam || !st.speler) return 'Kies een team en een speler';
    if (!st.naar) return 'Kies naar welk team';
    if (st.laden) return 'Even geduld…';
    if (!st.w.aan && !st.t.aan) return 'Zet Wedstrijden of Meetrainen op Ja';
    if (st.w.aan){
      const k = keuzeNu();
      if (k === 'een' && !gedekteWedstrijden().length) return 'Kies de wedstrijd (tabblad Wedstrijden)';
      if (k === 'datum' && (!st.w.tot || st.w.tot < st.w.vanaf)) return 'Wedstrijden: de einddatum ligt vóór de startdatum';
      if ((k === 'kies' || k === 'aantal') && !gedekteWedstrijden().length) return 'Kies minstens één wedstrijd (tabblad Wedstrijden)';
    }
    if (st.t.aan){
      if (st.t.duur === 'datum' && (!st.t.tot || st.t.tot < st.t.vanaf)) return 'Meetrainen: de einddatum ligt vóór de startdatum';
      if (!(st.t.naar && st.t.naar.size)) return `Kies minstens één trainingsdag bij ${st.naar.naam} (tabblad Meetrainen)`;
    }
    return null;
  }
  function tabStatus(k){
    if (k === 'w'){
      if (!st.w.aan) return 'Speelt niet mee';
      const n = gedekteWedstrijden().length;
      return { een: 'Eén wedstrijd', kies: `${n} aangevinkt`, aantal: `${n} wedstrijd${n === 1 ? '' : 'en'}`,
        datum: `t/m ${leenDatum(st.w.tot)}`, open: 'Geen einddatum' }[keuzeNu()];
    }
    if (!st.t.aan) return 'Traint niet mee';
    const dagen = [...(st.t.naar || [])].sort().map(d => DAG_NAMEN[d]).join(' + ') || 'geen dag';
    return dagen + (st.t.duur === 'datum' ? ` t/m ${leenDatum(st.t.tot)}` : '');
  }

  /* ---------- html-bouwstenen ---------- */
  const veld = (label, inhoud) => `<label class="ul-veld"><span>${label}</span>${inhoud}</label>`;
  const wRij = (w, type, aan) => `<label class="ul-wrij${aan ? ' aan' : ''}">
      <input type="${type}" name="${type === 'radio' ? 'ulEen' : 'ulKies'}" data-ul="${type === 'radio' ? 'een' : 'kiesw'}" value="${esc(w.id)}" ${aan ? 'checked' : ''}>
      <span class="ul-wd">${esc(leenDatum(w.datum))}</span><span class="ul-wt">${esc(wTekst(w))}</span>${w.aftrap ? `<span class="ul-tijd">${esc(w.aftrap)}</span>` : ''}</label>`;
  const dagKnop = (naam, dag, aan) => `<div class="segment segment-sub ul-mini" role="group">
      <button type="button" class="${aan ? 'actief' : ''}" aria-pressed="${aan}" data-ul="${naam}" data-dag="${dag}" data-aan="1">Erbij</button>
      <button type="button" class="${aan ? '' : 'actief'}" aria-pressed="${!aan}" data-ul="${naam}" data-dag="${dag}" data-aan="0">Niet</button></div>`;
  const jaNee = (naam, aan) => `<div class="segment segment-sub ul-mini" role="group">
      <button type="button" class="${aan ? 'actief' : ''}" aria-pressed="${aan}" data-ul="${naam}" data-aan="1">Ja</button>
      <button type="button" class="${aan ? '' : 'actief'}" aria-pressed="${!aan}" data-ul="${naam}" data-aan="0">Nee</button></div>`;
  const optie = (naam, w, label, actief, extra = '') => `
        <label class="ul-optie${actief ? ' aan' : ''}${actief && extra ? ' breed' : ''}"><input type="radio" name="${naam}" data-ul="${naam}" value="${w}" ${actief ? 'checked' : ''}><span>${label}</span>${actief ? extra : ''}</label>`;

  function htmlKeuzeSpeler(){
    if (opties.speler) return '';
    return `
      ${veld('Van team', `<select class="invoer" id="ulVan"><option value="">Kies een team…</option>${(st.teamsKeuze || []).map(t => `<option value="${esc(t.id)}" ${st.vanTeam?.id === t.id ? 'selected' : ''}>${esc(t.naam)}</option>`).join('')}</select>`)}
      ${veld('Speler', `<select class="invoer" id="ulSpeler" ${st.vanTeam ? '' : 'disabled'}><option value="">${st.vanTeam ? 'Kies een speler…' : 'Kies eerst een team…'}</option>${st.spelersVanTeam.map(p => `<option value="${esc(p.id)}" ${st.speler?.id === p.id ? 'selected' : ''}>${esc(p.naam)}${p.nummer != null && p.nummer !== '' ? ' · #' + esc(p.nummer) : ''}</option>`).join('')}</select>`)}`;
  }

  function htmlTabs(){
    return `<div class="ul-tabs" role="tablist">${[['w', 'Wedstrijden', st.w.aan], ['t', 'Meetrainen', st.t.aan]].map(([k, l, aan]) =>
      `<button type="button" class="ul-tab${st.tab === k ? ' actief' : ''}${aan ? ' ingesteld' : ''}" role="tab" aria-selected="${st.tab === k}" data-ul="tab" data-w="${k}"><b>${l}</b><small>${esc(tabStatus(k))}</small></button>`).join('')}</div>`;
  }

  function htmlWed(){
    const naam = esc(st.naar.naam);
    const kop = `<div class="ul-doet"><span>Speelt wedstrijden mee bij ${naam}</span>${jaNee('waan', st.w.aan)}</div>`;
    if (!st.w.aan) return kop + `<p class="ul-noot">${esc(st.speler?.naam || 'De speler')} speelt in deze uitlening geen wedstrijden bij ${naam}.</p>`;
    const k = keuzeNu(), kan = kanKiezen();
    const keuzes = [
      ...(kan ? [['een', 'Eén wedstrijd'], ['kies', 'Wedstrijden aanvinken'], ['aantal', 'Aantal wedstrijden']] : []),
      ['datum', 'Tot en met datum'], ['open', 'Geen einddatum'],
    ];
    const lijst = naarLijst();
    return `${kop}
      <div class="ul-kop">Welke wedstrijden</div>
      <div class="ul-opties">${keuzes.map(([w, l]) => optie('wkeuze', w, l, k === w,
        w === 'datum' ? `<input class="invoer ul-klein" type="date" id="ulWtot" value="${esc(st.w.tot)}" min="${esc(st.w.vanaf)}">`
        : w === 'aantal' ? `<input class="invoer ul-klein ul-getal" type="number" inputmode="numeric" id="ulWaantal" min="1" max="30" value="${esc(st.w.aantal)}">` : '')).join('')}</div>
      ${['aantal', 'datum', 'open'].includes(k) ? veld('Vanaf', `<input class="invoer" type="date" id="ulWvanaf" value="${esc(st.w.vanaf)}" min="${esc(vandaag)}">`) : ''}
      ${k === 'een' ? `<div class="ul-lijst">${lijst.slice(0, 12).map(w => wRij(w, 'radio', w.id === st.w.een)).join('')}</div>` : ''}
      ${k === 'kies' ? `<div class="ul-lijst">${lijst.slice(0, 20).map(w => wRij(w, 'checkbox', st.w.gekozen.has(w.id))).join('')}</div>` : ''}
      ${k === 'aantal' ? `<p class="ul-noot">${gedekteWedstrijden().map(w => esc(leenDatum(w.datum))).join(', ') || 'Geen wedstrijden in deze periode.'}</p>` : ''}
      ${st.naarW === null ? `<p class="ul-noot">De wedstrijden van ${naam} zijn niet te lezen met jouw rechten${bewaardeLijst.length ? '; je ziet de eerder gekozen wedstrijden' : ': de uitlening geldt voor alle wedstrijden in de periode'}.</p>`
        : !st.naarW.length ? `<p class="ul-noot">${naam} heeft geen komende wedstrijden in Cluppie. Kies een periode.</p>` : ''}
      ${htmlConflicten()}`;
  }

  function htmlTrain(){
    const naam = esc(st.naar.naam);
    const kop = `<div class="ul-doet"><span>Traint mee bij ${naam}</span>${jaNee('taan', st.t.aan)}</div>`;
    if (!st.t.aan) return kop + `<p class="ul-noot">${esc(st.speler?.naam || 'De speler')} blijft gewoon bij ${esc(st.vanTeam?.naam || 'het eigen team')} trainen.</p>`;
    const nm = naarMomenten(), vm = vanMomenten(), wt = wedTot();
    return `${kop}
      <div class="ul-kop">Periode meetrainen</div>
      ${veld('Vanaf', `<input class="invoer" type="date" id="ulTvanaf" value="${esc(st.t.vanaf)}" min="${esc(vandaag)}">`)}
      <div class="ul-opties">
        ${optie('tduur', 'datum', 'Tot en met datum', st.t.duur === 'datum', `<input class="invoer ul-klein" type="date" id="ulTtot" value="${esc(st.t.tot)}" min="${esc(st.t.vanaf)}">`)}
        ${optie('tduur', 'open', 'Geen einddatum', st.t.duur === 'open')}
      </div>
      ${st.w.aan && wt && wt >= st.t.vanaf && !(st.t.duur === 'datum' && st.t.tot === wt) ? `<button type="button" class="ul-linkknop" data-ul="neemover">Zelfde einddatum als de wedstrijden (${esc(leenDatum(wt))})</button>` : ''}
      <div class="ul-kop">Trainingen per dag</div>
      ${nm.length || vm.length ? `<div class="ul-dagen">
        ${[...nm.map(m => ({ m, naar: true })), ...vm.map(m => ({ m, naar: false }))]
          .sort((a, c) => a.m.dag - c.m.dag || (a.m.start || '').localeCompare(c.m.start || ''))
          .map(({ m, naar }) => `<div class="ul-dag"><b>${DAG_NAMEN[m.dag]}</b><span>${esc(naar ? st.naar.naam : (st.vanTeam?.naam || 'Eigen team'))}<small>${esc(tijdTekst(m) || 'tijd onbekend')} · ${naar ? 'bij uitleenteam' : 'eigen team'}</small></span>${naar
            ? dagKnop('tnaar', m.dag, !!st.t.naar?.has(m.dag))
            : dagKnop('tvan', m.dag, !!st.t.van?.has(m.dag))}</div>`).join('')}
      </div>` : ''}
      ${!nm.length ? `<p class="ul-noot">${naam} heeft nog geen trainingsdagen ingesteld (Club › Teams). Zonder trainingsdag kan meetrainen niet.</p>` : ''}
      <p class="ul-noot">Op dagen bij het eigen team vult de eigen trainer de presentie in. Zet je een eigen dag op Niet, dan telt die training niet mee voor de speler.</p>`;
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
    if (!st.naar) return '';
    const { wed, train } = delen();
    const { tot } = leenGrenzen(wed, train);
    const eind = !wed && !train ? '' : tot ? `Na ${leenDatum(tot)} is de uitlening vanzelf voorbij.` : 'Beëindig hem zelf als hij klaar is.';
    return `<div class="ul-samenvat"><b>${esc(st.speler?.naam || 'Speler')} → ${esc(st.naar.naam)}</b>
      <div class="ul-regel"><i>Wedstrijden</i><span>${esc(wed ? wedDeelTekst(wed) : 'nee')}</span></div>
      <div class="ul-regel"><i>Meetrainen</i><span>${esc(train ? trainDeelTekst(train, st.naar.naam) : 'nee')}</span></div>
      ${eind ? `<span>${esc(eind)}</span>` : ''}</div>`;
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
      ${st.naar ? (st.laden ? '<p class="ul-noot">Wedstrijden en trainingsdagen laden…</p>'
        : `${htmlTabs()}<div class="ul-tabinhoud" role="tabpanel">${st.tab === 't' ? htmlTrain() : htmlWed()}</div>${samenvatting()}`) : ''}
      <div class="ul-voet">
        ${f && st.naar && !st.laden ? `<p class="ul-fout" role="status">${esc(f)}</p>` : ''}
        <div class="ul-voetknoppen">
          <button class="knop licht" id="ulAnnuleer">Annuleren</button>
          <button class="knop fluo ul-ok" id="ulOk" ${f || st.bezig ? 'disabled' : ''}>${st.bezig ? 'Bezig…' : b ? 'Wijziging bewaren' : 'Uitlening vastleggen'}</button>
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
    /* Bewaarde wedstrijden die al voorbij zijn staan niet meer in de komende
       lijst; houd ze erbij zodat een wijziging ze niet stilletjes wegpoetst. */
    if (Array.isArray(st.naarW) && bewaardeLijst.length){
      const ids = new Set(st.naarW.map(w => w.id));
      const oud = bewaardeLijst.filter(w => !ids.has(w.id));
      if (oud.length) st.naarW = [...oud, ...st.naarW].sort((a, c) => (a.datum + (a.aftrap || '')).localeCompare(c.datum + (c.aftrap || '')));
    }
    /* Standaard: alle trainingsdagen van beide teams staan op Erbij (bij
       wijzigen blijft de bewaarde keuze staan). */
    if (!st.t.naar) st.t.naar = new Set(naarMomenten().map(m => m.dag));
    if (!st.t.van) st.t.van = new Set(vanMomenten().map(m => m.dag));
    /* Nieuwe uitlening zonder leesbare wedstrijden: begin bij een periode. */
    if (!b && !kanKiezen()) st.w.keuze = 'datum';
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
    else if (a === 'waan') st.w.aan = k.dataset.aan === '1';
    else if (a === 'taan') st.t.aan = k.dataset.aan === '1';
    else if (a === 'tnaar' || a === 'tvan'){
      const set = a === 'tnaar' ? st.t.naar : st.t.van, dag = Number(k.dataset.dag);
      if (!set) return;
      if (k.dataset.aan === '1') set.add(dag); else set.delete(dag);
    } else if (a === 'conflict') st.conflicten[k.dataset.d] = k.dataset.w;
    else if (a === 'neemover'){ const wt = wedTot(); if (wt){ st.t.duur = 'datum'; st.t.tot = wt; } }
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
      st.w.een = null; st.w.gekozen = new Set(); st.conflicten = {}; st.t.naar = null; st.t.van = null;
      if (st.naar) await laadNaar(); else teken();
      return;
    }
    if (t.id === 'ulWvanaf'){ st.w.vanaf = t.value || vandaag; if (st.w.tot < st.w.vanaf) st.w.tot = st.w.vanaf; }
    else if (t.id === 'ulWtot') st.w.tot = t.value;
    else if (t.id === 'ulWaantal') st.w.aantal = Math.max(1, Math.min(30, Number(t.value) || 1));
    else if (t.id === 'ulTvanaf'){ st.t.vanaf = t.value || vandaag; if (st.t.tot < st.t.vanaf) st.t.tot = st.t.vanaf; }
    else if (t.id === 'ulTtot') st.t.tot = t.value;
    else if (t.dataset.ul === 'wkeuze') st.w.keuze = t.value;
    else if (t.dataset.ul === 'tduur') st.t.duur = t.value;
    else if (t.dataset.ul === 'een') st.w.een = t.value;
    else if (t.dataset.ul === 'kiesw'){ if (t.checked) st.w.gekozen.add(t.value); else st.w.gekozen.delete(t.value); }
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
        /* Velden van de vorige vormen leegmaken: leenDelen() leest bij versie 2
           alleen wed/train, maar zo blijft het record schoon. */
        const wijziging = { ...regels, wat: null, wedstrijd: null, wedstrijden: null, trainNaar: null, trainVan: null, trainVanNiet: null,
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
