/* ==================== BOUW: TRAININGEN VAN DE WEEK ====================
   [20261116b] Coördinatoren zien per week wat de teams in hun bouw trainen,
   wanneer, en of het gebeurd is. Twee plekken, op desktop en telefoon:
     • een blok bovenaan het bouw-dashboard ("Deze week op het trainingsveld")
     • een eigen scherm Trainingen (per dag of per team), met de training
       zelf als paneel (desktop: van rechts; telefoon: volledig scherm)

   Alleen lezen. Geen nieuw datamodel: alles komt uit wat er al is.
     trainingen (club)              oefenstof per week, met plan/blokWeek/doelen
     teams/{id}.trainingsmomenten   dag + tijd per team (trainingsmomenten.js)
     teams/{id}/presentie           al geladen door bouw-hub (ctx.data)
     teams/{id}/trainingGeopend     of de coach de oefenstof opende (training-log.js)
     clubs/{id}/afgelastingen       afgelaste dagen (mag ontbreken)

   Welke training bij welke dag hoort: zelfde regel als het teamscherm en de
   trainingscoördinator (trainco.js): de trainingen van die week op volgorde,
   training 1 op het eerste trainingsmoment, training 2 op het tweede; een
   vaste trainingsdag op de training zelf gaat voor.

   Status per training van een team:
     getraind   er is presentie ingevuld op die dag
     geenpres   de dag is voorbij, geen presentie
     bekeken    komt nog; de oefenstof is door het team geopend
     klaar      komt nog; nog niet geopend
     wacht      komt nog; voor coaches pas later zichtbaar (zichtbaarVanaf)
     geenstof   het team traint, maar er is geen oefenstof gekoppeld
     afgelast   de dag is afgelast

   Meekijken telt niet als "geopend": dit scherm logt zelf niets.
   AVG: teamniveau. Aantallen aanwezig, geen spelersnamen.

   De gastschermen (desktop-bouw.js, mobiel-bouw.js) leveren de bouw-context
   uit bouw-hub.laadBouwData en hertekenen zichzelf; dit bestand houdt de
   opgehaalde gegevens en de weekkeuze op die context bij (ctx._btr, ctx._btrSt). */
import { db, collection, getDocs, query, where } from './firebase.js?v=20261106r';
import { esc, openModal, sluitModal } from './state.js?v=20261111g';
import { ico } from './icons.js?v=20261106r';
import { teltMee } from './opkomst.js?v=20261106r';
import { momentenVanTeam, DAGEN_LANG, DAGEN_KORT } from './trainingsmomenten.js?v=20261111g';
import { oefHtml, bronHtml, diagramVoorOefening, openLightbox } from './training-weergave.js?v=20261111g';
import { doelTeksten, samenvattingNu } from './doel-samenvatting.js?v=20261106r';

/* ---------- datums (lokaal, 12:00 als anker tegen zomertijd) ---------- */
const pad = n => String(n).padStart(2, '0');
const ymd = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const vanIso = iso => new Date(iso + 'T12:00');
const plusDagen = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
function maandagNu(offset){
  const d = new Date(); d.setHours(12, 0, 0, 0);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7) + offset * 7);
  return d;
}
function isoWeekNr(d){
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  x.setDate(x.getDate() + 3 - ((x.getDay() + 6) % 7));
  const w1 = new Date(x.getFullYear(), 0, 4);
  return 1 + Math.round(((x - w1) / 86400000 - 3 + ((w1.getDay() + 6) % 7)) / 7);
}
const kortDatum = d => d.toLocaleDateString('nl-NL', { day: 'numeric', month: 'short' }).replace('.', '');
const langDatum = d => d.toLocaleDateString('nl-NL', { weekday: 'long', day: 'numeric', month: 'long' });
const dagNr = iso => ((vanIso(iso).getDay() + 6) % 7) + 1;      // 1 = ma … 7 = zo

/* ---------- in welke week valt een training (gelijk aan trainco.js) ---------- */
function weekNrUit(tekst){
  const m = String(tekst || '').match(/\b([1-9]|[1-4]\d|5[0-3])\b/);
  return m ? parseInt(m[1], 10) : null;
}
function jaarVoorWeek(weekNr, sec){
  const nu = sec ? new Date(sec * 1000) : new Date();
  let jaar = nu.getFullYear(); const maand = nu.getMonth();
  if (maand === 0 && weekNr >= 50) jaar -= 1;
  if (maand === 11 && weekNr <= 2) jaar += 1;
  return jaar;
}
function maandagVanWeek(weekNr, jaar){
  const vierJan = new Date(jaar, 0, 4, 12);
  const m1 = new Date(vierJan); m1.setDate(vierJan.getDate() - ((vierJan.getDay() + 6) % 7));
  const m = new Date(m1); m.setDate(m1.getDate() + (weekNr - 1) * 7); return m;
}
function maandagVanTraining(tr){
  if (/^\d{4}-\d{2}-\d{2}$/.test(tr.weekStart || '')){
    const d = vanIso(tr.weekStart); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return ymd(d);
  }
  const nr = weekNrUit(tr.week);
  return nr ? ymd(maandagVanWeek(nr, jaarVoorWeek(nr, tr.gemaakt?.seconds))) : null;
}

/* ---------- weekkeuze en weergave, per bouw-context ---------- */
function staat(ctx){
  if (!ctx._btrSt) ctx._btrSt = { week: 0, weergave: 'dag', dag: null };
  return ctx._btrSt;
}

/* ---------- ophalen (één keer per bouw-context) ---------- */
const bezig = new WeakMap();
const GEEN_TOEGANG = 'De oefenstof van deze teams kon niet gelezen worden. Vraag de clubbeheerder om je toegang te controleren.';

async function laad(ctx){
  const ids = ctx.teams.map(t => t.id);
  if (!ids.length) return { stof: [], geopend: new Map(), afgelast: new Set(), fout: '' };
  const stil = (wat, p) => p.catch(e => { console.warn(`[Cluppie] bouw-trainingen: ${wat} niet gelezen:`, e?.code || e?.message); return null; });
  const delen = [];
  for (let i = 0; i < ids.length; i += 30) delen.push(ids.slice(i, i + 30));
  const [stofSnaps, geopendSnaps, aflSnap] = await Promise.all([
    /* zelfde query als de coach-app (teams.js): op team, niet op club */
    Promise.all(delen.map(c => stil('oefenstof', getDocs(query(collection(db, 'trainingen'), where('teams', 'array-contains-any', c)))))),
    Promise.all(ctx.teams.map(t => stil('openingen van ' + (t.naam || t.id), getDocs(collection(db, 'teams', t.id, 'trainingGeopend'))))),
    stil('afgelastingen', getDocs(collection(db, 'clubs', ctx.clubId, 'afgelastingen'))),
  ]);
  const stof = new Map();
  let gelukt = false;
  for (const s of stofSnaps){
    if (!s) continue;
    gelukt = true;
    s.docs.forEach(d => stof.set(d.id, { id: d.id, ...d.data() }));
  }
  if (!gelukt){
    /* terugval voor wie de hele club mag lezen (clubbeheerder) */
    const s = await stil('oefenstof van de club', getDocs(query(collection(db, 'trainingen'), where('club', '==', ctx.clubId))));
    if (s){
      gelukt = true;
      const set = new Set(ids);
      s.docs.forEach(d => { const x = d.data(); if ((x.teams || []).some(id => set.has(id))) stof.set(d.id, { id: d.id, ...x }); });
    }
  }
  const geopend = new Map();
  ctx.teams.forEach((t, i) => {
    const m = new Map();
    geopendSnaps[i]?.docs.forEach(d => {
      const x = d.data();
      const ms = Object.keys(x.momenten || {}).map(Number).filter(Boolean).sort((a, b) => a - b);
      m.set(d.id, { aantal: x.aantal || ms.length, eerste: ms[0] || null });
    });
    geopend.set(t.id, m);
  });
  return {
    stof: [...stof.values()], geopend,
    afgelast: new Set(aflSnap ? aflSnap.docs.map(d => d.data().datum).filter(Boolean) : []),
    fout: gelukt ? '' : GEEN_TOEGANG,
  };
}

/* Start het ophalen als dat nog niet gebeurd is; `klaar` wordt één keer
   aangeroepen zodra de gegevens er zijn (het gastscherm hertekent dan). */
export function zorgVoorTrainingen(ctx, klaar){
  if (!ctx || ctx._btr || bezig.has(ctx)) return;
  const p = laad(ctx)
    .then(d => { ctx._btr = d; })
    .catch(e => {
      console.warn('[Cluppie] bouw-trainingen: ophalen mislukt:', e?.code || e?.message);
      ctx._btr = { stof: [], geopend: new Map(), afgelast: new Set(), fout: 'Trainingen ophalen mislukt. Controleer je verbinding en probeer het opnieuw.' };
    })
    .then(() => { bezig.delete(ctx); try { if (klaar) klaar(); } catch(e){ console.warn('[Cluppie] bouw-trainingen: hertekenen mislukt', e); } });
  bezig.set(ctx, p);
}

/* ---------- de week in kaart ---------- */
const GENERIEK = /^\s*week\s*\d+\s*[-–,:]?\s*training\s*\d+\s*$/i;
const ruweTitel = tr => tr.titel || tr.bestandsnaam || '';
function trainingNr(tr, index){
  if (Number.isFinite(tr.trainingNr) && tr.trainingNr > 0) return tr.trainingNr;
  const m = ruweTitel(tr).match(/training\s*(\d+)/i);
  return m ? Number(m[1]) : (index != null ? index + 1 : null);
}
/* "Week 47 - training 2" zegt niets extra's: dan heet hij gewoon Training 2. */
const trKop = (tr, nr) => { const t = ruweTitel(tr); return (!t || GENERIEK.test(t)) ? (nr ? 'Training ' + nr : 'Training') : t; };
const doelRegel = tr => samenvattingNu(tr) || doelTeksten(tr).slice(0, 2).join(' · ');
const groepVan = team => String(team.naam || '').trim().replace(/\s*-\s*\d+\s*$/, '') || 'Team';
const tijdVan = m => (m && m.start) ? m.start : '';
const teamSorteer = (a, b) => (a.naam || '').localeCompare(b.naam || '', 'nl', { numeric: true });

function statusVan(ctx, s, vandaag){
  const D = ctx._btr;
  const d = ctx.data.get(s.team.id) || {};
  const pres = s.datum ? (d.presentie || []).find(p => p.datum === s.datum) : null;
  const geopend = s.tr ? D.geopend.get(s.team.id)?.get(s.tr.id) : null;
  if (pres){
    const mee = (d.spelers || []).filter(sp => teltMee(pres, sp));
    const aanwezig = mee.filter(sp => !(pres.afwezig || []).includes(sp.id)).length;
    return { code: 'getraind', toon: 'ok', tekst: mee.length ? `Getraind, ${aanwezig} van ${mee.length} aanwezig` : 'Getraind',
      extra: !s.tr ? 'geen oefenstof gekoppeld' : (geopend ? '' : 'oefenstof niet geopend') };
  }
  if (s.datum && (D.afgelast.has(s.datum) || s.team.afgelast?.datum === s.datum)) return { code: 'afgelast', toon: 'grijs', tekst: 'Afgelast' };
  if (!s.datum) return { code: 'geendag', toon: 'grijs', tekst: 'Geen trainingsdag ingesteld' };
  if (s.datum < vandaag) return { code: 'geenpres', toon: 'warn', tekst: 'Presentie ontbreekt', extra: s.tr ? (geopend ? 'oefenstof wel geopend' : '') : 'geen oefenstof gekoppeld' };
  if (!s.tr) return { code: 'geenstof', toon: 'warn', tekst: 'Geen oefenstof gekoppeld' };
  if (s.tr.zichtbaarVanaf && s.tr.zichtbaarVanaf > vandaag)
    return { code: 'wacht', toon: 'grijs', tekst: 'Voor de coach zichtbaar vanaf ' + kortDatum(vanIso(s.tr.zichtbaarVanaf)) };
  if (geopend) return { code: 'bekeken', toon: 'info', tekst: 'Bekeken door coach' };
  return { code: 'klaar', toon: 'grijs', tekst: 'Klaargezet, nog niet bekeken' };
}

function weekData(ctx, offset){
  const D = ctx._btr;
  const ma = maandagNu(offset), maIso = ymd(ma), vandaag = ymd(new Date());
  const sessies = [];
  const zonderMoment = [];
  for (const team of ctx.teams){
    const mo = momentenVanTeam(team);
    if (!mo.length) zonderMoment.push(team);
    const items = D.stof.filter(tr => (tr.teams || []).includes(team.id) && maandagVanTraining(tr) === maIso);
    items.sort((a, b) => ((a.plan?.id && a.plan.id === b.plan?.id) ? (a.trainingNr || 0) - (b.trainingNr || 0) : 0)
      || (a.gemaakt?.seconds || 0) - (b.gemaakt?.seconds || 0));
    const bezet = new Set();
    items.forEach((tr, i) => {
      const vast = Number(tr.trainingsdag) || 0;
      const moment = vast ? (mo.find(m => m.dag === vast) || { dag: vast, start: '', eind: '' }) : (mo[i] || null);
      if (moment) bezet.add(moment.dag);
      sessies.push({ team, tr, nr: trainingNr(tr, i), moment, datum: moment ? ymd(plusDagen(ma, moment.dag - 1)) : null });
    });
    for (const m of mo) if (!bezet.has(m.dag)) sessies.push({ team, tr: null, nr: null, moment: m, datum: ymd(plusDagen(ma, m.dag - 1)) });
  }
  for (const s of sessies) s.st = statusVan(ctx, s, vandaag);
  sessies.sort((a, b) => (a.datum || '9').localeCompare(b.datum || '9')
    || (a.moment?.start || '99').localeCompare(b.moment?.start || '99') || teamSorteer(a.team, b.team));
  return { ma, maIso, vandaag, sessies, zonderMoment, nr: isoWeekNr(plusDagen(ma, 3)), heeftStof: sessies.some(s => s.tr) };
}

/* Teams die deze week precies dezelfde trainingen krijgen vormen één groep. */
function groepenVan(w){
  const perTeam = new Map();
  for (const s of w.sessies){
    if (!s.tr) continue;
    if (!perTeam.has(s.team.id)) perTeam.set(s.team.id, { team: s.team, lijst: [] });
    perTeam.get(s.team.id).lijst.push(s);
  }
  const groepen = new Map();
  for (const { team, lijst } of perTeam.values()){
    const volgorde = [...lijst].sort((a, b) => (a.nr || 99) - (b.nr || 99));
    const sleutel = volgorde.map(s => s.tr.id).join('|');
    if (!groepen.has(sleutel)) groepen.set(sleutel, { teams: [], trainingen: volgorde.map(s => ({ tr: s.tr, nr: s.nr, sessies: [] })) });
    const g = groepen.get(sleutel);
    g.teams.push(team);
    volgorde.forEach((s, i) => g.trainingen[i].sessies.push(s));
  }
  const uit = [...groepen.values()];
  for (const g of uit){
    g.teams.sort(teamSorteer);
    const eerste = g.trainingen[0]?.tr;
    const plan = eerste?.plan || {};
    const zelfdePlan = g.trainingen.every(x => (x.tr.plan?.id || '') === (plan.id || ''));
    const soorten = [...new Set(g.teams.map(groepVan))].join(', ');
    g.naam = (zelfdePlan && plan.naam) ? plan.naam : (zelfdePlan && plan.blok ? `Blok ${plan.blok}, ${soorten}` : soorten);
    const wk = Number(eerste?.blokWeek) || null, wks = Number(plan.weken) || null;
    g.blok = zelfdePlan && wk && wks ? { blok: plan.blok || null, wk, wks } : null;
  }
  uit.sort((a, b) => teamSorteer(a.teams[0] || {}, b.teams[0] || {}));
  const metStof = new Set(perTeam.keys());
  const zonderStof = [...new Map(w.sessies.filter(s => !metStof.has(s.team.id)).map(s => [s.team.id, s.team])).values()].sort(teamSorteer);
  return { groepen: uit, zonderStof };
}

function opsom(lijst){
  return lijst.length <= 1 ? (lijst[0] || '') : lijst.slice(0, -1).join(', ') + ' en ' + lijst[lijst.length - 1];
}
function dagWoord(iso, vandaag){
  if (iso === vandaag) return 'vandaag';
  if (iso === ymd(plusDagen(vanIso(vandaag), 1))) return 'morgen';
  return DAGEN_LANG[dagNr(iso) - 1].toLowerCase();
}
/* Eén regel over alle teams die deze training krijgen. */
function samenvatting(sessies, vandaag){
  const afg = sessies.filter(s => s.st.code === 'afgelast').length;
  const n = sessies.length - afg;
  const gedaan = sessies.filter(s => s.st.code === 'getraind').length;
  const mist = sessies.filter(s => s.st.code === 'geenpres');
  const komt = sessies.filter(s => ['bekeken', 'klaar', 'wacht'].includes(s.st.code));
  const teams = n === 1 ? 'team' : 'teams';
  if (mist.length) return { toon: 'warn', tekst: `${gedaan} van ${n} ${teams} getraind, presentie ontbreekt bij ${opsom(mist.map(s => s.team.naam))}` };
  if (komt.length){
    const dagen = opsom([...new Set(komt.map(s => s.datum))].sort().map(d => dagWoord(d, vandaag)));
    return { toon: 'grijs', tekst: gedaan ? `${gedaan} van ${n} ${teams} getraind, de rest ${dagen}` : dagen.charAt(0).toUpperCase() + dagen.slice(1) };
  }
  if (gedaan) return { toon: 'ok', tekst: `Getraind door ${gedaan} van ${n} ${teams}${afg ? ', ' + afg + ' afgelast' : ''}` };
  if (afg) return { toon: 'grijs', tekst: 'Afgelast' };
  return { toon: 'grijs', tekst: 'Geen trainingsdag ingesteld' };
}

/* ---------- kleine onderdelen ---------- */
const ST_ICO = { ok: 'action-check', info: 'training-view', grijs: 'training-duration', warn: 'action-warning' };
const stHtml = st => `<span class="btr-st ${esc(st.toon)}">${ico(ST_ICO[st.toon] || 'training-duration', 15)}<span>${esc(st.tekst)}${st.extra ? `<em>, ${esc(st.extra)}</em>` : ''}</span></span>`;

function weekNav(w, st){
  return `<div class="btr-weeknav">
    <button type="button" class="btr-rond" data-btr="week" data-id="-1" aria-label="Vorige week">${ico('navigation-back', 18)}</button>
    <div class="btr-week"><b>Week ${w.nr}</b><small>${esc(kortDatum(w.ma))} – ${esc(kortDatum(plusDagen(w.ma, 6)))}</small></div>
    <button type="button" class="btr-rond" data-btr="week" data-id="1" aria-label="Volgende week">${ico('navigation-forward', 18)}</button>
  </div>${st.week !== 0 ? '<button type="button" class="btr-nuknop" data-btr="week" data-id="0">Deze week</button>' : ''}`;
}
/* Eén balk bovenaan als alle groepen in dezelfde blokweek zitten. */
function blokStrook(groepen){
  const b = groepen.map(g => g.blok).filter(Boolean);
  if (!b.length || b.length !== groepen.length) return '';
  const e = b[0];
  if (!b.every(x => x.wk === e.wk && x.wks === e.wks && (x.blok || '') === (e.blok || '')) || e.wks > 16) return '';
  const rest = e.wks - e.wk;
  return `<div class="btr-blok"><b>${e.blok ? 'Blok ' + esc(e.blok) + ', ' : ''}week ${e.wk} van ${e.wks}</b>
    <div class="nu-blok-balk" role="img" aria-label="Week ${e.wk} van ${e.wks}" style="--n:${e.wks}">${
      Array.from({ length: e.wks }, (_, i) => `<span class="${i + 1 < e.wk ? 'af' : i + 1 === e.wk ? 'nu' : ''}"></span>`).join('')}</div>
    <small>${rest > 0 ? `Nog ${rest} ${rest === 1 ? 'week' : 'weken'} in dit blok` : 'Laatste week van dit blok'}</small></div>`;
}
function groepKaart(g, vandaag, eenStrook){
  const blokTekst = g.blok && !eenStrook ? `week ${g.blok.wk} van ${g.blok.wks}` : '';
  return `<article class="btr-groep">
    <div class="btr-groep-kop"><b>${esc(g.naam)}</b>${blokTekst ? `<small>${esc(blokTekst)}</small>` : ''}
      <span class="btr-chips">${g.teams.map(t => `<i>${esc(t.naam)}</i>`).join('')}</span></div>
    ${g.trainingen.map(x => {
      const doel = doelRegel(x.tr);
      return `<button type="button" class="btr-tr" data-btr="open" data-id="${esc(x.tr.id)}">
        <i class="btr-t">T${x.nr || ''}</i>
        <span class="btr-tr-tekst"><b>${esc(trKop(x.tr, x.nr))}</b>${doel ? `<span>${esc(doel)}</span>` : ''}${stHtml(samenvatting(x.sessies, vandaag))}</span>
        <span class="btr-pijl">${ico('navigation-forward', 16)}</span></button>`; }).join('')}
  </article>`;
}
/* Eén training van één team. `metDag`: toon de dag bij de tijd (lijst per team). */
function sessieHtml(s, metDag = false){
  const tijd = tijdVan(s.moment);
  const dag = metDag && s.moment ? DAGEN_KORT[s.moment.dag - 1] : '';
  const tijdHtml = `<span class="btr-tijd">${dag ? `<em>${esc(dag)}</em>` : ''}${tijd ? esc(tijd) : '<em>tijd?</em>'}</span>`;
  if (!s.tr){
    return `<div class="btr-sessie mist">${tijdHtml}
      <span class="btr-s-tekst"><b>${esc(s.team.naam)}</b>${stHtml(s.st)}</span></div>`;
  }
  const wat = GENERIEK.test(ruweTitel(s.tr)) || !ruweTitel(s.tr) ? (doelRegel(s.tr) || trKop(s.tr, s.nr)) : ruweTitel(s.tr);
  return `<button type="button" class="btr-sessie" data-btr="open" data-id="${esc(s.tr.id)}">${tijdHtml}
    <span class="btr-s-tekst"><b>${esc(s.team.naam)}</b>
      <span class="btr-s-wat"><i class="btr-t">T${s.nr || ''}</i><span>${esc(wat)}</span></span>${stHtml(s.st)}</span></button>`;
}
function letRegels(w, zonderStof, uitgebreid){
  const uit = [];
  if (zonderStof.length) uit.push(`Nog geen oefenstof voor deze week: ${esc(opsom(zonderStof.map(t => t.naam)))}.`);
  if (uitgebreid && w.zonderMoment.length) uit.push(`Geen trainingsmomenten ingesteld: ${esc(opsom(w.zonderMoment.map(t => t.naam)))}. De clubbeheerder stelt die in bij het team.`);
  return uit.map(t => `<p class="btr-let">${ico('action-warning', 16)}<span>${t}</span></p>`).join('');
}

/* ---------- blok op het bouw-dashboard ---------- */
export function htmlDashBlok(ctx, modus){
  const st = staat(ctx);
  const wrap = inner => `<div class="${modus === 'dk' ? 'dk-blok' : 'mb-kaart'} btr-dash">${inner}</div>`;
  const kop = (titel, acties = '') => `<div class="btr-kop"><span class="btr-kop-ico">${ico('football-training', 20)}</span>
    <div class="btr-kop-t"><b>${esc(titel)}</b><small>Wat de teams trainen, en of het gebeurd is</small></div>
    ${acties ? `<div class="btr-kop-acties">${acties}</div>` : ''}</div>`;
  if (!ctx._btr) return wrap(kop('Deze week op het trainingsveld') + '<p class="btr-leeg">Trainingen van deze week ophalen…</p>');
  if (ctx._btr.fout) return wrap(kop('Deze week op het trainingsveld') + `<p class="btr-leeg">${esc(ctx._btr.fout)}</p>`);

  const w = weekData(ctx, st.week);
  const { groepen, zonderStof } = groepenVan(w);
  const strook = blokStrook(groepen);
  const naarKnop = modus === 'dk'
    ? `<button type="button" class="dk-knop rood" data-btr="naar">Hele week bekijken ${ico('navigation-forward', 16)}</button>`
    : '';
  /* de dag die er nu toe doet: vandaag, anders de eerstvolgende trainingsdag van deze week */
  let dagBlok = '';
  if (st.week === 0){
    const dagen = [...new Set(w.sessies.filter(s => s.datum && s.datum >= w.vandaag).map(s => s.datum))].sort();
    const kies = dagen[0];
    if (kies){
      const woord = dagWoord(kies, w.vandaag);
      const label = (kies === w.vandaag ? 'Vandaag' : woord === 'morgen' ? 'Morgen' : 'Eerstvolgende') + ', ' + langDatum(vanIso(kies));
      dagBlok = `<div class="btr-lbl">${esc(label)}</div>
        <div class="btr-vandaag">${w.sessies.filter(s => s.datum === kies).map(s => sessieHtml(s)).join('')}</div>`;
    }
  }
  const titel = st.week === 0 ? 'Deze week op het trainingsveld' : `Week ${w.nr} op het trainingsveld`;
  return wrap(`${kop(titel, weekNav(w, st) + naarKnop)}
    ${strook}
    ${groepen.length ? `<div class="btr-groepen">${groepen.map(g => groepKaart(g, w.vandaag, !!strook)).join('')}</div>`
      : `<p class="btr-leeg">Voor week ${w.nr} staat nog geen oefenstof klaar.</p>`}
    ${dagBlok}
    ${letRegels(w, groepen.length ? zonderStof : [], false)}
    ${modus === 'mb' ? `<button type="button" class="mb-knop" data-btr="naar">Hele week bekijken ›</button>` : ''}`);
}

/* ---------- scherm Trainingen ---------- */
function dagenVan(w){
  const gebruikt = new Set([1, 2, 3, 4, 5]);
  for (const s of w.sessies) if (s.moment) gebruikt.add(s.moment.dag);
  return [...gebruikt].sort((a, b) => a - b).map(d => ({ d, iso: ymd(plusDagen(w.ma, d - 1)) }));
}
function htmlPerDagDesktop(w){
  const dagen = dagenVan(w);
  return `<div class="btr-roosterwrap"><div class="btr-rooster" style="--n:${dagen.length}">${dagen.map(x => {
    const lijst = w.sessies.filter(s => s.datum === x.iso);
    return `<section class="btr-dagkol"><div class="btr-dagkop"><b>${DAGEN_KORT[x.d - 1]}</b><small>${esc(kortDatum(vanIso(x.iso)))}</small>${x.iso === w.vandaag ? '<i>vandaag</i>' : ''}</div>
      ${lijst.length ? lijst.map(s => sessieHtml(s)).join('') : '<div class="btr-geen">Geen trainingen</div>'}</section>`; }).join('')}</div></div>`;
}
function htmlPerDagMobiel(w, st){
  const dagen = dagenVan(w);
  const metSessies = dagen.filter(x => w.sessies.some(s => s.datum === x.iso));
  const kies = dagen.some(x => x.iso === st.dag) ? st.dag
    : (metSessies.find(x => x.iso >= w.vandaag) || metSessies[0] || dagen[0]).iso;
  const lijst = w.sessies.filter(s => s.datum === kies);
  return `<div class="btr-dagen" style="--n:${dagen.length}">${dagen.map(x => {
      const n = w.sessies.filter(s => s.datum === x.iso).length;
      return `<button type="button" class="btr-dagknop${x.iso === kies ? ' aan' : ''}${x.iso === w.vandaag ? ' nu' : ''}" data-btr="dag" data-id="${x.iso}" aria-pressed="${x.iso === kies}">
        ${DAGEN_KORT[x.d - 1]}<b>${vanIso(x.iso).getDate()}</b><small>${n ? n + (n === 1 ? ' team' : ' teams') : '–'}</small></button>`; }).join('')}</div>
    <div class="btr-lbl">${esc(langDatum(vanIso(kies)))}${kies === w.vandaag ? ', vandaag' : ''}</div>
    <div class="btr-lijst">${lijst.length ? lijst.map(s => sessieHtml(s)).join('') : '<div class="btr-geen">Geen trainingen op deze dag</div>'}</div>`;
}
function htmlPerTeam(ctx, w){
  const teams = [...ctx.teams].sort(teamSorteer);
  return `<div class="btr-teams">${teams.map(t => {
    const lijst = w.sessies.filter(s => s.team.id === t.id);
    const n = (ctx.data.get(t.id)?.spelers || []).length;
    return `<section class="btr-team"><div class="btr-team-kop"><b>${esc(t.naam)}</b><small>${n} spelers</small></div>
      ${lijst.length ? lijst.map(s => sessieHtml(s, true)).join('') : '<div class="btr-geen">Geen trainingsmomenten ingesteld</div>'}</section>`; }).join('')}</div>`;
}
export function htmlTrainingenScherm(ctx, modus){
  const st = staat(ctx);
  if (!ctx._btr) return '<p class="btr-leeg">Trainingen ophalen…</p>';
  if (ctx._btr.fout) return `<p class="btr-leeg">${esc(ctx._btr.fout)}</p>`;
  const w = weekData(ctx, st.week);
  const { groepen, zonderStof } = groepenVan(w);
  const strook = blokStrook(groepen);
  const metStof = w.sessies.filter(s => s.tr);
  const gedaan = w.sessies.filter(s => s.st.code === 'getraind').length;
  const mist = w.sessies.filter(s => s.st.code === 'geenpres').length;
  const pill = modus === 'dk' ? 'dk-pill' : 'mb-pill';
  const oranje = modus === 'dk' ? 'oranje' : 'geel';
  const legenda = [
    { toon: 'grijs', tekst: 'Klaargezet' }, { toon: 'info', tekst: 'Bekeken door coach' },
    { toon: 'ok', tekst: 'Getraind, presentie ingevuld' }, { toon: 'warn', tekst: 'Presentie of oefenstof ontbreekt' },
  ];
  return `
    <div class="btr-balk">${weekNav(w, st)}
      <div class="segment btr-seg">
        <button type="button" class="${st.weergave === 'dag' ? 'actief' : ''}" data-btr="weergave" data-id="dag" aria-pressed="${st.weergave === 'dag'}">Per dag</button>
        <button type="button" class="${st.weergave === 'team' ? 'actief' : ''}" data-btr="weergave" data-id="team" aria-pressed="${st.weergave === 'team'}">Per team</button>
      </div></div>
    <div class="btr-pills"><span class="${pill}">${metStof.length} ${metStof.length === 1 ? 'training' : 'trainingen'} gepland</span>
      ${gedaan ? `<span class="${pill} groen">${gedaan} getraind</span>` : ''}
      ${mist ? `<span class="${pill} ${oranje}">${mist} zonder presentie</span>` : ''}</div>
    ${strook}
    ${w.sessies.length ? '' : '<p class="btr-leeg">Deze week staan er geen trainingen gepland voor de teams in deze bouw.</p>'}
    ${st.weergave === 'team' ? htmlPerTeam(ctx, w) : (modus === 'dk' ? htmlPerDagDesktop(w) : htmlPerDagMobiel(w, st))}
    <div class="btr-legenda">${legenda.map(l => stHtml(l)).join('')}</div>
    ${letRegels(w, zonderStof, true)}
    ${groepen.length ? `<div class="btr-lbl">Wat er deze week getraind wordt</div>
      <div class="btr-groepen">${groepen.map(g => groepKaart(g, w.vandaag, !!strook)).join('')}</div>`
      : (w.heeftStof ? '' : `<p class="btr-leeg">Voor week ${w.nr} staat nog geen oefenstof klaar. Blader met de pijlen naar een andere week.</p>`)}`;
}

/* ---------- de training zelf: paneel (desktop) of volledig scherm (telefoon) ---------- */
function oefenvormen(tr){
  const oef = Array.isArray(tr.oefeningen) ? tr.oefeningen : [];
  if (oef.length){
    return oef.map((o, i) => ({ url: diagramVoorOefening(i + 1, tr.diagramUrls || {}), titel: `${i + 1}. ${o.titel || 'Oefening ' + (i + 1)}` })).filter(x => x.url);
  }
  return Object.entries(tr.diagramUrls || {}).filter(([, u]) => u).sort((a, b) => Number(a[0]) - Number(b[0]))
    .map(([, url], i) => ({ url, titel: `Oefenvorm ${i + 1}` }));
}
function openDetail(ctx, trId){
  const tr = ctx._btr?.stof.find(x => x.id === trId);
  if (!tr) return;
  /* de week waarin deze training valt (kan een andere zijn dan de getoonde week) */
  const maIso = maandagVanTraining(tr);
  const offset = maIso ? Math.round((vanIso(maIso) - maandagNu(0)) / (7 * 86400000)) : staat(ctx).week;
  const w = weekData(ctx, offset);
  const regels = w.sessies.filter(s => s.tr?.id === trId);
  const nr = regels[0]?.nr || trainingNr(tr, null);
  const pl = tr.plan || {};
  const wk = Number(tr.blokWeek) || null, wks = Number(pl.weken) || null;
  const meta = [pl.naam || (pl.blok ? 'Blok ' + pl.blok : ''), wk && wks ? `week ${wk} van ${wks}` : '', `week ${w.nr}`].filter(Boolean).join(', ');
  const doelen = doelTeksten(tr);
  const vormen = oefenvormen(tr);
  const oef = Array.isArray(tr.oefeningen) ? tr.oefeningen : [];
  const vanaf = tr.zichtbaarVanaf && tr.zichtbaarVanaf > w.vandaag ? `<p class="btr-let">${ico('training-duration', 16)}<span>Voor coaches zichtbaar vanaf ${esc(kortDatum(vanIso(tr.zichtbaarVanaf)))}.</span></p>` : '';
  const wie = regels.map(s => `<div class="btr-wie-rij"><b>${esc(s.team.naam)}</b>
      <span>${s.datum ? esc(DAGEN_KORT[dagNr(s.datum) - 1] + ' ' + kortDatum(vanIso(s.datum))) + (tijdVan(s.moment) ? ', ' + esc(tijdVan(s.moment)) : '') : 'dag nog niet bekend'}</span>${stHtml(s.st)}</div>`).join('');
  openModal(`<h2>${esc(trKop(tr, nr))}</h2>
    <div class="btr-detail">
      <div class="btr-meta">${esc(meta)}</div>
      ${vanaf}
      ${doelen.length ? `<section><div class="btr-kopje">Doelen</div>
        <ul class="btr-doelen">${doelen.map(d => `<li>${ico('football-training', 16)}<span>${esc(d)}</span></li>`).join('')}</ul></section>` : ''}
      ${vormen.length ? `<section><div class="btr-kopje">Oefenvormen</div>
        <div class="btr-vormen">${vormen.map(v => `<button type="button" class="btr-vorm" data-btr-zoom="${esc(v.url)}" data-btr-zoomtitel="${esc(v.titel)}"><img src="${esc(v.url)}" alt="" loading="lazy"><span>${esc(v.titel)}</span></button>`).join('')}</div></section>` : ''}
      <section><div class="btr-kopje">Wie traint dit</div>
        <div class="btr-wie">${wie || '<p class="btr-leeg">Nog niet aan een team in deze bouw gekoppeld.</p>'}</div></section>
      ${oef.length ? `<details class="btr-uitwerking"><summary>Uitgewerkte training lezen</summary>
        <div class="btr-oefeningen">${oef.map((o, i) => oefHtml(i + 1, o, tr.diagramUrls || {})).join('')}</div></details>` : ''}
      ${tr.url ? `<a class="knop licht vol" href="${esc(tr.url)}" target="_blank" rel="noopener">${ico('admin-document', 18)} PDF openen</a>` : ''}
      ${oef.length ? bronHtml() : ''}
    </div>`);
  /* Zelfde vorm als het planning- en uitleenpaneel: van rechts op desktop,
     volledig scherm op de telefoon (CSS: .modal-achter[data-vorm="paneel"]). */
  const achter = document.getElementById('modalAchter');
  if (!achter) return;
  achter.setAttribute('data-vorm', 'paneel');
  const opEsc = e => { if (e.key === 'Escape' && achter.classList.contains('open') && achter.dataset.vorm === 'paneel' && !document.querySelector('.trw-lb.open')) sluitModal(); };
  document.addEventListener('keydown', opEsc);
  const opruimen = new MutationObserver(() => {
    if (!achter.classList.contains('open') || achter.dataset.vorm !== 'paneel'){ document.removeEventListener('keydown', opEsc); opruimen.disconnect(); }
  });
  opruimen.observe(achter, { attributes: true, attributeFilter: ['class', 'data-vorm'] });
  const inhoud = document.getElementById('modalInhoud');
  inhoud?.querySelectorAll('[data-btr-zoom]').forEach(b => b.onclick = () => openLightbox(b.dataset.btrZoom, b.dataset.btrZoomtitel));
  inhoud?.querySelectorAll('.trw-diagram[data-zoom]').forEach(f => f.onclick = () => openLightbox(f.dataset.zoom, f.dataset.zoomtitel));
}

/* ---------- klikken (aangeroepen door het gastscherm) ----------
   opties: { herteken(), naarScherm() }. Geeft true terug als de klik hier hoorde. */
export function trainingenKlik(e, ctx, opties = {}){
  const b = e.target.closest('[data-btr]');
  if (!b || !ctx) return false;
  const st = staat(ctx), a = b.dataset.btr, id = b.dataset.id;
  if (a === 'week'){ st.week = id === '0' ? 0 : st.week + Number(id); st.dag = null; opties.herteken?.(); return true; }
  if (a === 'weergave'){ st.weergave = id === 'team' ? 'team' : 'dag'; opties.herteken?.(); return true; }
  if (a === 'dag'){ st.dag = id; opties.herteken?.(); return true; }
  if (a === 'naar'){ opties.naarScherm?.(); return true; }
  if (a === 'open'){ openDetail(ctx, id); return true; }
  return false;
}
