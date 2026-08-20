import {
  db, collection, doc, addDoc, setDoc, updateDoc, deleteDoc, onSnapshot, serverTimestamp,
  functions, httpsCallable
} from './firebase.js?v=20260811a';
import {
  S, $, $$, esc, meld, mmss, uurMin, datumNL, speler, spelerNaam, spelerNr,
  openModal, sluitModal, toon, stopUnsubs, modAan
} from './state.js?v=20260819d';
import {
  FORMATIES, LIJN_NAAM, bouwSlots, slotLijn, catInfo, isToernooi,
  parseFormatie, formatieBestaat, formatieNamen, aantalVeldspelers,
  tijdstrafSec, KAART_ICOON, KAART_NAAM,
  periodeNaam, periodeNrs, periodeLabel, toernooiWnr, periodeOmschrijving,
  CLUB_FORMATIE_11, doelSuggesties, SEIZOEN_FALLBACK,
  WISSEL_REDENEN, wisselReden, AFWEZIG_REDENEN, afwezigRedenInfo
} from './config.js?v=20260819f';
import { kwartGespeeld, effectieveLineup, analyseKwart, analyseWedstrijd, speeltijdReserve, disciplinaireTijd } from './analyse.js?v=20260819f';
import { ico } from './icons.js?v=20260818e';

import { telGebruik, telNav } from './tracker.js?v=20260819d';

/* ==================== AANMAKEN ==================== */
function leegKwart(){ return {lineup:{}, events:[], plan:[], correcties:{}, klok:{base:0, running:false, start:0}}; }

/* Formatie die dit specifieke kwart hanteert. Valt terug op de
   wedstrijd-brede startformatie (w.formatie) zolang het kwart zelf
   nog geen eigen formatie heeft — zo blijven oude wedstrijden en
   nog-lege kwarten gewoon werken. */
function kwartFormatie(w, k){
  const f = k && k.formatie;
  return (f && (formatieBestaat(w.format, f, eigenFormatiesVanTeam()) || parseFormatie(f, w.format))) ? f : w.formatie;
}

/* Eigen formaties van het huidige team ({ '11': ['4-2-1-3'], ... }), veilig als
   er nog geen zijn. */
function eigenFormatiesVanTeam(){
  return (S.team && S.team.eigenFormaties) || {};
}

/* Sla een zelfgemaakte formatie op bij het team, zodat hij voortaan als knop
   naast de vaste formaties verschijnt. Retourneert de genormaliseerde naam of
   null als de invoer niet klopt. De live team-subscription (teams.js) werkt
   S.team daarna vanzelf bij. */
async function bewaarEigenFormatie(format, ruweNaam){
  const coords = parseFormatie(ruweNaam, format);
  if (!coords) return null;
  const naam = ruweNaam.trim().split(/[-\s.]+/).filter(Boolean).join('-');
  if (formatieBestaat(format, naam, eigenFormatiesVanTeam())) return naam; // bestaat al
  const eigen = { ...(eigenFormatiesVanTeam()) };
  eigen[format] = (eigen[format] || []).concat(naam);
  try {
    await updateDoc(doc(db,'teams',S.teamId), { eigenFormaties: eigen });
    if (S.team) S.team.eigenFormaties = eigen; // direct lokaal, vóór snapshot
    telGebruik('eigen_formatie');
  } catch(e){ console.warn('[Cluppie] eigen formatie opslaan mislukt', e); return null; }
  return naam;
}

/* Herbruikbare "+ Eigen"-invoer voor de formatiekiezers (wizard én wijzig-opzet).
   Rendert een knoppenrij (vaste + eigen formaties) plus een uitklapbaar
   invoerveld. onKies(naam) wordt aangeroepen bij elke keuze; herteken() vult de
   knoppenrij opnieuw (na opslaan van een nieuwe eigen formatie).
   knopHtml(naam, actief) en actiefNaam() maken het geschikt voor zowel de
   tegel-stijl (wizard) als de knop-stijl (wijzig-opzet). */
function eigenFormatieInvoerHtml(){
  return `
    <div class="ef-invoer" hidden>
      <div class="ef-rij">
        <input class="invoer ef-veld" inputmode="numeric" placeholder="bijv. 4-2-1-3" autocomplete="off" maxlength="15">
        <button class="knop ef-bewaar" disabled>Toevoegen</button>
      </div>
      <div class="ef-status"></div>
    </div>`;
}
/* Koppelt de invoer-interactie. container = element dat de .ef-invoer,
   .ef-veld, .ef-bewaar, .ef-status bevat. getFormat() geeft het huidige format.
   onToegevoegd(naam) na succesvol opslaan. */
function koppelEigenFormatieInvoer(container, getFormat, onToegevoegd){
  const wrap = container.querySelector('.ef-invoer');
  const veld = container.querySelector('.ef-veld');
  const knop = container.querySelector('.ef-bewaar');
  const status = container.querySelector('.ef-status');
  if (!wrap || !veld || !knop) return { toon(){}, };
  const check = () => {
    const fmt = getFormat();
    const coords = parseFormatie(veld.value, fmt);
    if (!veld.value.trim()){ status.textContent=''; status.className='ef-status'; knop.disabled=true; return; }
    if (coords){
      const naam = veld.value.trim().split(/[-\s.]+/).filter(Boolean).join('-');
      status.textContent = `✓ ${naam} — ${aantalVeldspelers(fmt)} veldspelers${fmt!=='4'?' + keeper':''}`;
      status.className = 'ef-status ok'; knop.disabled = false;
    } else {
      status.textContent = `Samen ${aantalVeldspelers(fmt)} veldspelers, elke linie 1–6`;
      status.className = 'ef-status fout'; knop.disabled = true;
    }
  };
  veld.oninput = check;
  knop.onclick = async () => {
    const fmt = getFormat();
    knop.disabled = true;
    const naam = await bewaarEigenFormatie(fmt, veld.value);
    if (naam){ veld.value=''; status.textContent=''; status.className='ef-status'; wrap.hidden=true; onToegevoegd(naam); }
    else { status.textContent='Opslaan lukte niet — probeer opnieuw'; status.className='ef-status fout'; }
  };
  return { toonInvoer(){ wrap.hidden = !wrap.hidden; if (!wrap.hidden){ veld.focus(); check(); } } };
}

/* Herplaats de opstelling van één kwart naar een nieuwe formatie en houd
   spelers zoveel mogelijk op hun plek: per linie (K/V/M/A) op slotvolgorde
   overzetten. Spelers uit een krimpende linie schuiven door naar een vrije
   plek in een andere linie; blijft er niets vrij, dan gaan ze naar de bank.
   Events die verwijzen naar een slot dat in de nieuwe formatie niet meer
   bestaat, laten we vallen (net als bij een format-wijziging). */
function herplaatsKwart(w, k, nieuweFormatie){
  const oudeSlots   = bouwSlots(w.format, kwartFormatie(w, k));
  const nieuweSlots = bouwSlots(w.format, nieuweFormatie);
  const perLinie = {K:[], V:[], M:[], A:[]};
  for (const sl of oudeSlots){
    const pid = k.lineup[sl.id];
    if (pid) (perLinie[sl.lijn] ||= []).push(pid);
  }
  const nieuw = {};
  const teller = {K:0, V:0, M:0, A:0};
  for (const sl of nieuweSlots){
    const rij = perLinie[sl.lijn] || [];
    if (teller[sl.lijn] < rij.length) nieuw[sl.id] = rij[teller[sl.lijn]++];
  }
  const overschot = [];
  for (const l of ['K','V','M','A'])
    for (let i = teller[l]; i < (perLinie[l]||[]).length; i++) overschot.push(perLinie[l][i]);
  for (const sl of nieuweSlots)
    if (!nieuw[sl.id] && overschot.length) nieuw[sl.id] = overschot.shift();
  k.lineup = nieuw;
  const geldig = new Set(nieuweSlots.map(sl => sl.id));
  k.events = (k.events || []).filter(e => geldig.has(e.slot));
  k.formatie = nieuweFormatie;
}


/* startopstelling van de laatste gespeelde wedstrijd met hetzelfde format */
function laatsteOpstelling(format){
  for (const w of S.wedstrijden){            // gesorteerd nieuw → oud
    if (w.format !== format) continue;
    const k1 = w.kwarten?.['1'];
    if (k1 && Object.keys(k1.lineup||{}).length){
      const lineup = {};
      for (const [slot, pid] of Object.entries(k1.lineup)) if (speler(pid)) lineup[slot] = pid;
      if (Object.keys(lineup).length) return {lineup, formatie: w.formatie, bron: w};
    }
  }
  return null;
}

/* ---- Vorige confrontatie tegen dezelfde tegenstander ----
   Genormaliseerde naamvergelijking: negeert hoofdletters, spaties, leestekens
   en het eigen clubvoorvoegsel (ASV'33), zodat "ASV'33 JO11-2" en "jo11 2"
   als dezelfde tegenstander gelden. */
function normTegenstander(naam){
  if (!naam) return '';
  let s = String(naam).toLowerCase();
  s = s.replace(/asv['’`]?\s*33/g, ' ');     // eigen club weglaten
  s = s.replace(/[^a-z0-9]+/g, '');          // alleen letters/cijfers
  return s;
}

/* Telt een wedstrijd als "gespeeld"? Uitslag (goals) of een ingevulde
   startopstelling. Lege/toekomstige (geïmporteerde) wedstrijden tellen niet. */
function isGespeeld(w){
  if (Array.isArray(w.goals) && w.goals.length) return true;
  for (const k of Object.values(w.kwarten || {}))
    if (Object.keys(k.lineup || {}).length) return true;
  return false;
}

/* Zoekt de meest recente gespeelde wedstrijd tegen dezelfde tegenstander,
   exclusief de huidige wedstrijd. Toernooien slaan we over (geen vaste
   tegenstander op wedstrijdniveau). Geeft het bron-wedstrijddocument terug. */
function vorigeConfrontatie(huidige){
  if (!huidige || isToernooi(huidige)) return null;
  const doel = normTegenstander(huidige.tegenstander);
  if (!doel) return null;
  for (const w of S.wedstrijden){            // gesorteerd nieuw → oud
    if (w.id === S.wedstrijdId) continue;
    if (isToernooi(w)) continue;
    if (normTegenstander(w.tegenstander) !== doel) continue;
    if (!isGespeeld(w)) continue;
    return w;
  }
  return null;
}

/* Startopstelling (kwart 1) van een bronwedstrijd als [{pid,slot,keeper}]. */
/* Bouwt het kleine regeltje + uitklappaneel voor de vorige confrontatie.
   Geeft '' terug als er geen eerdere ontmoeting is. Open/dicht-stand wordt
   bewaard in S._confroOpen zodat het paneel niet dichtklapt bij elke rerender. */
function bouwConfrontatie(w){
  const v = vorigeConfrontatie(w);
  if (!v) return '';

  const voor  = (v.goals||[]).filter(g => g.type==='voor').length;
  const tegen = (v.goals||[]).filter(g => g.type==='tegen').length;
  const heeftUitslag = (v.goals||[]).length > 0;

  /* Uitslag vanuit óns perspectief; klasse stuurt de kleur. */
  let kl = 'g', uitslagTekst = '—';
  if (heeftUitslag){
    uitslagTekst = `${voor}–${tegen}`;
    kl = voor > tegen ? 'w' : voor < tegen ? 'v' : 'g';
  }
  const thuisuit = v.thuis ? 'thuis' : 'uit';
  const open = S._confroOpen ? ' open' : '';

  /* --- paneel-inhoud --- */
  const teamNaam = esc(S.team.naam);
  const tegenN   = esc(v.tegenstander);
  const linksNaam  = v.thuis ? teamNaam : tegenN;
  const rechtsNaam = v.thuis ? tegenN : teamNaam;
  const scoreMid = heeftUitslag ? `${v.thuis ? voor : tegen} – ${v.thuis ? tegen : voor}` : '–';

  const doelHtml = v.doel
    ? `<div class="confro-rij doel"><div class="lbl">🎯 Wedstrijddoel</div><div class="val">${esc(v.doel)}</div></div>`
    : '';
  const notitieHtml = v.notitie
    ? `<div class="confro-rij"><div class="lbl">📝 Notitie</div><div class="val">${esc(v.notitie)}</div></div>`
    : '';

  /* Directe link naar de betreffende wedstrijd (daar staat de opstelling). */
  const linkHtml = `<button class="confro-link" id="confroOpen" data-wid="${esc(v.id)}">→ Bekijk deze wedstrijd</button>`;

  return `
    <button class="confro-regel${open}" id="confroRegel">
      <span class="ico">↩︎</span>
      <span class="confro-tekst"><b>Vorige keer:</b> ${esc(datumNL(v.datum))} · ${thuisuit}</span>
      ${heeftUitslag ? `<span class="confro-uitslag ${kl}">${esc(uitslagTekst)}</span>` : ''}
      <span class="confro-chev">▾</span>
    </button>
    <div class="confro-paneel${open}" id="confroPaneel">
      <div class="confro-card">
        <div class="confro-titel">↩︎ Vorige confrontatie · ${tegenN}</div>
        <div class="confro-uitslagblok">
          <div class="partij">${linksNaam}</div>
          <div class="score">${scoreMid}</div>
          <div class="partij r">${rechtsNaam}<span class="datum">${esc(datumNL(v.datum))} · ${thuisuit}</span></div>
        </div>
        ${doelHtml}${notitieHtml}${linkHtml}
      </div>
    </div>`;
}

export function modalNieuweWedstrijd(){
  if (!S.spelers.length) return meld('Voeg eerst spelers toe onder het tabblad Spelers');
  const vandaag = new Date().toISOString().slice(0,10);
  const cat = catInfo(S.team.categorie) || null;
  let type = 'normaal';
  let periodes = cat ? cat.periodes : 4;
  let format = cat ? cat.format : S.team.format;
  let toernooiHelften = 1;
  const stdDuur = cat ? cat.duur : 15;

  openModal(`
    <h2>Nieuwe wedstrijd</h2>
    <div class="veldgroep"><label>Type</label>
      <div class="segment" id="mWType">
        <button data-ty="normaal" class="actief">Competitie</button>
        <button data-ty="toernooi">🏆 Toernooi</button>
      </div></div>
    ${cat ? `<p style="font-size:calc(12.5px * var(--fs));color:var(--ink-2);margin-bottom:12px">KNVB ${esc(S.team.categorie)}: ${esc(cat.knvb)} — standaarden zijn ingevuld.</p>` : ''}

    <div id="mWNormaal">
      <div class="veldgroep"><label>Tegenstander</label>
        <input class="invoer" id="mWTegen" placeholder="Bijv. ASV'33 ${esc(S.team.categorie || 'JO11')}-2" autocomplete="off"></div>
      <div class="veldgroep"><label>Periodes</label>
        <div class="segment" id="mWPeriodes">
          <button data-p="2" class="${periodes===2?'actief':''}">2 helften</button>
          <button data-p="4" class="${periodes===4?'actief':''}">4 kwarten</button>
        </div></div>
    </div>

    <div id="mWToernooi" style="display:none">
      <div class="veldgroep"><label>Naam toernooi</label>
        <input class="invoer" id="mWToernooiNaam" placeholder="Bijv. Pinkstertoernooi Mifano" autocomplete="off"></div>
      <div class="rij">
        <div class="veldgroep"><label>Aantal wedstrijden</label>
          <select class="invoer" id="mWAantal">${Array.from({length:9},(_,i)=>`<option value="${i+2}" ${i+2===4?'selected':''}>${i+2}</option>`).join('')}</select></div>
        <div class="veldgroep"><label>Helften per wedstrijd</label>
          <div class="segment" id="mWHelften">
            <button data-h="1" class="actief">1</button><button data-h="2">2</button>
          </div></div>
      </div>
    </div>

    <div class="rij">
      <div class="veldgroep"><label>Datum</label><input class="invoer" type="date" id="mWDatum" value="${vandaag}"></div>
      <div class="veldgroep"><label id="mWDuurLabel">Minuten per ${periodes===2?'helft':'kwart'}</label><input class="invoer" id="mWDuur" inputmode="decimal" value="${String(stdDuur).replace('.',',')}"></div>
    </div>
    <div class="rij">
      <div class="veldgroep" id="mWThuisWrap"><label>Thuis of uit</label>
        <div class="segment" id="mWThuis"><button data-t="1" class="actief">Thuis</button><button data-t="0">Uit</button></div></div>
      <div class="veldgroep"><label>Aantal spelers</label>
        <div class="segment" id="mWFormat">${['4','6','8','9','11'].map(f =>
          `<button data-f="${f}" class="${format===f?'actief':''}">${f}</button>`).join('')}</div></div>
    </div>

    <label class="lid-rij" id="mWOvernemenWrap" style="cursor:pointer;display:none">
      <input type="checkbox" id="mWOvernemen" style="width:19px;height:19px;accent-color:var(--grass)">
      <div class="lid-naam" style="font-weight:500">Begin met opstelling van vorige wedstrijd
        <span style="display:block;font-size:calc(11.5px * var(--fs));color:var(--ink-2);font-weight:400" id="mWOvernemenInfo"></span></div>
    </label>

    <button class="knop vol" id="mWOk" style="margin-top:6px">Aanmaken</button>`);

  let thuis = true;
  const duurLabel = () => {
    $('#mWDuurLabel').textContent = type === 'toernooi'
      ? (toernooiHelften === 1 ? 'Minuten per wedstrijd' : 'Minuten per helft')
      : 'Minuten per ' + (periodes===2?'helft':'kwart');
  };
  const werkOvernemenBij = () => {
    const vorige = laatsteOpstelling(format);
    const wrap = $('#mWOvernemenWrap');
    if (vorige && type === 'normaal'){
      wrap.style.display = '';
      const aantal = Object.keys(vorige.lineup).length;
      $('#mWOvernemenInfo').textContent =
        `${vorige.bron.tegenstander ? 'tegen '+vorige.bron.tegenstander+' · ' : ''}${aantal} spelers · ${vorige.formatie}`;
    } else {
      wrap.style.display = 'none';
      $('#mWOvernemen').checked = false;
    }
  };
  $$('#mWType button').forEach(b => b.onclick = () => {
    $$('#mWType button').forEach(x=>x.classList.remove('actief')); b.classList.add('actief');
    type = b.dataset.ty;
    $('#mWNormaal').style.display = type === 'normaal' ? '' : 'none';
    $('#mWToernooi').style.display = type === 'toernooi' ? '' : 'none';
    $('#mWThuisWrap').style.display = type === 'normaal' ? '' : 'none';
    $('#mWDuur').value = type === 'toernooi' ? '15' : String(stdDuur).replace('.',',');
    duurLabel(); werkOvernemenBij();
  });
  $$('#mWThuis button').forEach(b => b.onclick = () => { $$('#mWThuis button').forEach(x=>x.classList.remove('actief')); b.classList.add('actief'); thuis = b.dataset.t==='1'; });
  $$('#mWFormat button').forEach(b => b.onclick = () => { $$('#mWFormat button').forEach(x=>x.classList.remove('actief')); b.classList.add('actief'); format = b.dataset.f; werkOvernemenBij(); });
  $$('#mWHelften button').forEach(b => b.onclick = () => { $$('#mWHelften button').forEach(x=>x.classList.remove('actief')); b.classList.add('actief'); toernooiHelften = Number(b.dataset.h); duurLabel(); });
  $$('#mWPeriodes button').forEach(b => b.onclick = () => {
    $$('#mWPeriodes button').forEach(x=>x.classList.remove('actief')); b.classList.add('actief');
    periodes = Number(b.dataset.p);
    duurLabel();
    const huidig = parseFloat(($('#mWDuur').value||'').replace(',','.'));
    if (huidig) $('#mWDuur').value = String(periodes===2 ? huidig*2 : huidig/2).replace('.',',');
  });
  werkOvernemenBij();

  $('#mWOk').onclick = async () => {
    const duur = parseFloat(($('#mWDuur').value||String(stdDuur)).replace(',','.')) || stdDuur;
    const overnemen = $('#mWOvernemen').checked && type === 'normaal';
    let w, overTeNemen = null, formatie = Object.keys(FORMATIES[format])[0];
    if (overnemen){
      const vorige = laatsteOpstelling(format);
      if (vorige){
        overTeNemen = {...vorige.lineup};
        if (formatieBestaat(format, vorige.formatie, eigenFormatiesVanTeam()) || parseFormatie(vorige.formatie, format)) formatie = vorige.formatie;
      }
    }
    if (type === 'toernooi'){
      const aantal = Number($('#mWAantal').value);
      w = {
        type: 'toernooi',
        tegenstander: $('#mWToernooiNaam').value.trim() || 'Toernooi',
        thuis: true, format,
        toernooi: {wedstrijden: aantal, helften: toernooiHelften},
        tegenstanders: {},
        periodes: aantal * toernooiHelften,
      };
    } else {
      w = {
        type: 'normaal',
        tegenstander: $('#mWTegen').value.trim() || 'Tegenstander',
        thuis, format, periodes,
      };
    }
    const kwarten = {};
    for (let i = 1; i <= w.periodes; i++) kwarten[i] = leegKwart();
    if (overTeNemen) kwarten[1].lineup = {...overTeNemen};
    Object.assign(w, {
      formatie,
      datum: $('#mWDatum').value || vandaag,
      kwartduur: duur,
      selectie: S.spelers.map(p => p.id),
      goals: [],
      kaarten: [],
      kwarten,
      seizoen: S.huidigSeizoen || SEIZOEN_FALLBACK,
      gemaakt: serverTimestamp(),
      opzetGedaan: false,
    });
    const ref = await addDoc(collection(db,'teams',S.teamId,'wedstrijden'), w);
    telGebruik('wedstrijd_start');
    sluitModal();
    if (overTeNemen) meld('Opstelling van vorige wedstrijd overgenomen — pas aan waar nodig');
    openWedstrijd(ref.id);
  };
}

/* ==================== OPENEN & OPSLAAN ==================== */

/* Vult ontbrekende wedstrijdvelden aan (bv. geïmporteerde voetbal.nl-wedstrijden
   hebben geen format/periodes/formatie/kwartduur/kwarten). Geeft true terug als
   er iets is aangevuld, zodat we het document één keer kunnen wegschrijven. */
function normaliseerWedstrijd(w){
  const cat = catInfo(S.team.categorie) || null;
  let veranderd = false;
  if (w.type !== 'toernooi' && w.type !== 'normaal'){ w.type = 'normaal'; veranderd = true; }
  if (!w.format){ w.format = (cat ? cat.format : S.team.format) || '8'; veranderd = true; }
  if (typeof w.thuis !== 'boolean'){ w.thuis = true; veranderd = true; }
  if (!w.periodes){ w.periodes = cat ? cat.periodes : 4; veranderd = true; }
  if (!w.kwartduur){ w.kwartduur = cat ? cat.duur : 15; veranderd = true; }
  if (!FORMATIES[w.format]){ w.format = '8'; veranderd = true; }
  if (!w.formatie || !(FORMATIES[w.format][w.formatie] || parseFormatie(w.formatie, w.format))){
    w.formatie = Object.keys(FORMATIES[w.format])[0]; veranderd = true;
  }
  if (!w.kwarten || typeof w.kwarten !== 'object' || !Object.keys(w.kwarten).length){
    const kwarten = {};
    for (let i = 1; i <= w.periodes; i++) kwarten[i] = leegKwart();
    w.kwarten = kwarten; veranderd = true;
  }
  /* Per-kwart formatie: bestaande wedstrijden hebben alleen w.formatie.
     We zetten die als startwaarde op elk kwart, zodat elk kwart voortaan
     zijn eigen speelwijze kan onthouden. Ongeldige waarden corrigeren we. */
  for (const kk of Object.values(w.kwarten)){
    if (!kk || typeof kk !== 'object') continue;
    if (!kk.formatie || !(FORMATIES[w.format][kk.formatie] || parseFormatie(kk.formatie, w.format))){
      kk.formatie = w.formatie; veranderd = true;
    }
  }
  if (!Array.isArray(w.goals)){ w.goals = []; veranderd = true; }
  if (!Array.isArray(w.kaarten)){ w.kaarten = []; veranderd = true; }
  if (!Array.isArray(w.selectie) || !w.selectie.length){ w.selectie = S.spelers.map(p => p.id); veranderd = true; }
  if (typeof w.opzetGedaan !== 'boolean'){ w.opzetGedaan = true; veranderd = true; }
  return veranderd;
}

export function openWedstrijd(wid){
  // Vangnet: als teamId (of wid) ontbreekt — bv. na een tijdelijke lege
  // team-snapshot die de teamstaat leegde terwijl de lijst nog op het scherm
  // stond — bouw dan géén Firestore-pad met null (dat crasht op path.indexOf).
  // Val stil terug naar de teamweergave i.p.v. de app te laten omvallen.
  if (!S.teamId || !wid){
    console.warn('[Cluppie] openWedstrijd afgebroken: ontbrekende teamId of wid', {teamId:S.teamId, wid});
    S.wedstrijdId = null;
    if (S.teamId) import('./teams.js?v=20260819j').then(m => m.renderTeam?.());
    return;
  }
  S.wedstrijdId = wid; S.kwart = '1'; S.geselecteerd = null; S._confroOpen = false; S._wizardActief = false;
  stopUnsubs('wedstrijd');
  S.unsub.wedstrijd = onSnapshot(doc(db,'teams',S.teamId,'wedstrijden',wid), snap => {
    if (!snap.exists()){ sluitWedstrijd(); return; }
    if (snap.metadata.hasPendingWrites) return;
    const data = snap.data();
    // De opzet-wizard-check mag NIET achter de lokaalTot-throttle vallen: anders
    // mist een nieuwe wedstrijd (net aangemaakt) zijn enige schone snapshot en
    // verschijnt de wizard nooit. Daarom eerst normaliseren + wizard beslissen,
    // en pas daarna de throttle voor het overschrijven van de lokale staat.
    const moetWizard = data.opzetGedaan === false && !S._wizardActief;
    if (Date.now() - S.lokaalTot < 1800){
      // In het throttle-venster niet de lokale staat overschrijven, maar de
      // wizard mag wel: zorg dat S.wedstrijd bestaat zodat de wizard data heeft.
      if (moetWizard){ S.wedstrijd ||= data; S._wizardActief = true; toonWedstrijdWizard(); }
      return;
    }
    const aangevuld = normaliseerWedstrijd(data);
    S.wedstrijd = data;
    // Wizard-beslissing vóór renderWedstrijd(), zodat een eventuele render-fout
    // de wizard niet kan tegenhouden bij een gloednieuwe wedstrijd.
    if (data.opzetGedaan === false && !S._wizardActief){
      S._wizardActief = true;
      toonWedstrijdWizard();
    }
    renderWedstrijd();
    if (aangevuld) bewaarWedstrijd();
  }, (err) => {
    console.error(`[Cluppie] Listener "wedstrijd" kon niet lezen (teamId=${S.teamId}, wid=${wid}):`, err.code, err.message);
    if (err.code === 'permission-denied') meld('Geen toegang tot deze wedstrijd — controleer de Firestore-rules');
  });
  toon('wedstrijd');
  telNav('wedstrijd:opstelling', 'open');
}
export function sluitWedstrijd(naarTab){
  stopUnsubs('wedstrijd');
  clearInterval(S.klokInterval); S.klokInterval = null;
  S.wedstrijd = null; S.wedstrijdId = null;
  verbergWedstrijdWizard();
  verbergWijzigOpzet();
  if (typeof naarTab === 'string') S.teamTab = naarTab;
  import('./teams.js?v=20260819j').then(m => { m.renderTeam(); toon('team'); });
}
function bewaarWedstrijd(){
  S.lokaalTot = Date.now();
  clearTimeout(S.saveTimer);
  S.saveTimer = setTimeout(() => {
    setDoc(doc(db,'teams',S.teamId,'wedstrijden',S.wedstrijdId), S.wedstrijd)
      .catch(e => meld('Opslaan mislukt: ' + e.code));
  }, 600);
}

/* ==================== WEDSTRIJD-WIZARD (eerste keer opzetten) ====================
   Volledig scherm, verschijnt automatisch bij een gloednieuwe wedstrijd (opzetGedaan
   === false). Vier korte stappen: aanvoerder, aantal spelers, speelwijze, doel.
   Overslaan kan altijd, met een korte waarschuwing dat alles later nog aan te passen
   is via "Wijzig opzet" rechtsboven. Oude wedstrijden (voor deze feature) krijgen via
   normaliseerWedstrijd() al opzetGedaan=true en zien deze wizard dus nooit. */
const WIZARD_STAPPEN = 4;

function toonWedstrijdWizard(){
  const w = S.wedstrijd;
  const spelersInSelectie = (w.selectie||[]).map(pid => speler(pid)).filter(Boolean);

  let stap = 0;
  let gekAanvoerder = w.aanvoerder || null;
  let gekFormat = w.format;
  let gekFormatie = w.formatie;

  const stapHtml = [
    `<div class="wz-icoon">🎖️</div>
     <h2>Wie is aanvoerder?</h2>
     <p class="wz-uitleg">Kies de aanvoerder voor deze wedstrijd. Je kunt dit later altijd wijzigen.</p>
     <div class="wz-keuzelijst" id="wzAanvoerderLijst">
       <div class="wz-keuze ${!gekAanvoerder?'wz-actief':''}" data-pid="">
         <div class="wz-shirt">—</div><div class="wz-naam">Nog geen keuze</div><div class="wz-check"></div>
       </div>
       ${spelersInSelectie.map(p => `
         <div class="wz-keuze ${gekAanvoerder===p.id?'wz-actief':''}" data-pid="${p.id}">
           <div class="wz-shirt">${esc(spelerNr(p.id))}</div>
           <div class="wz-naam">${esc(p.naam)}</div><div class="wz-check"></div>
         </div>`).join('')}
     </div>`,
    `<div class="wz-icoon">👥</div>
     <h2>Hoeveel spelers per team?</h2>
     <p class="wz-uitleg">Dit bepaalt het speelformat van de wedstrijd.</p>
     <div class="wz-tegels" id="wzFormatTegels">
       ${['4','6','8','9','11'].map(f => `<div class="wz-tegel ${gekFormat===f?'wz-actief':''}" data-f="${f}"><span class="wz-cijfer">${f}×${f}</span></div>`).join('')}
     </div>`,
    `<div class="wz-icoon">📐</div>
     <h2>Welke speelwijze?</h2>
     <p class="wz-uitleg" id="wzFormatieUitleg">Kies de formatie voor ${gekFormat}×${gekFormat}.</p>
     <div class="wz-tegels wz-tegels-drie" id="wzFormatieTegels"></div>
     <div id="wzEigen">${eigenFormatieInvoerHtml()}</div>`,
    `<div class="wz-icoon">🎯</div>
     <h2>Wat is het wedstrijddoel?</h2>
     <p class="wz-uitleg">Waar wil je dit team vandaag op laten letten?</p>
     <input class="invoer" id="wzDoelInvoer" value="${esc(w.doel||'')}" placeholder="Bijv. opbouw van achteruit, durven schieten">
     <div class="wz-chips">
       ${doelSuggesties(S.team?.categorie).slice(0,4).map(s => `<div class="wz-chip" data-doelsug="${esc(s)}">${esc(s)}</div>`).join('')}
     </div>`,
  ];

  $('#wizardAchter').innerHTML = `
    <div class="wz-scherm">
      <div class="wz-topbar">
        <span class="wz-titel-mini">Wedstrijd opzetten</span>
        <div class="wz-dots" id="wzDots">${Array.from({length:WIZARD_STAPPEN},(_,i) =>
          `<span class="wz-dot ${i===0?'wz-actief':''}" data-d="${i}"></span>`).join('')}</div>
      </div>
      <div class="wz-body" id="wzBody">${stapHtml.map((html,i) =>
        `<div class="wz-stap ${i===0?'wz-actief':''}" data-stap="${i}">${html}</div>`).join('')}</div>
      <div class="wz-klaar" id="wzKlaar">
        <div class="wz-klaar-icoon">✓</div>
        <h2>Helemaal klaar!</h2>
        <p>De opzet staat. Veel plezier vandaag — je past dit altijd aan via <b>Wijzig opzet</b> rechtsboven.</p>
      </div>
      <div class="wz-bottom" id="wzBottom">
        <div class="wz-skipwarn" id="wzSkipWarn">
          <span class="wz-skipwarn-ico">💡</span>
          <div class="wz-skipwarn-tekst">
            <b>Weet je het zeker?</b> Je kunt aanvoerder, speelwijze, aantal spelers en wedstrijddoel altijd nog aanpassen via <b>Wijzig opzet</b> rechtsboven in het wedstrijdscherm.
            <div class="wz-skipwarn-btns">
              <button class="knop licht" id="wzSkipTerug">Toch instellen</button>
              <button class="knop fluo" id="wzSkipDoor">Ja, overslaan</button>
            </div>
          </div>
        </div>
        <div class="wz-btnrij" id="wzBtnRij">
          <button class="wz-terug" id="wzTerug" style="visibility:hidden">←</button>
          <button class="knop vol fluo" id="wzVolgende">Volgende</button>
        </div>
        <button class="wz-skiplink" id="wzSkipLink">Overslaan</button>
      </div>
    </div>`;
  $('#wizardAchter').classList.add('open');

  const efWizard = koppelEigenFormatieInvoer($('#wzEigen'), () => gekFormat, (naam) => {
    gekFormatie = naam; vulFormatieTegels();
  });
  const vulFormatieTegels = () => {
    if (!formatieBestaat(gekFormat, gekFormatie, eigenFormatiesVanTeam())) gekFormatie = Object.keys(FORMATIES[gekFormat])[0];
    $('#wzFormatieUitleg').textContent = `Kies de formatie voor ${gekFormat}×${gekFormat}.`;
    const namen = formatieNamen(gekFormat, eigenFormatiesVanTeam());
    $('#wzFormatieTegels').innerHTML = namen.map(fm =>
      `<div class="wz-tegel ${gekFormatie===fm?'wz-actief':''}" data-fm="${fm}"><span class="wz-cijfer wz-cijfer-klein">${fm}</span></div>`).join('') +
      `<div class="wz-tegel wz-tegel-eigen" data-eigen="1"><span class="wz-cijfer wz-cijfer-klein">+ Eigen</span></div>`;
    $$('#wzFormatieTegels .wz-tegel[data-fm]').forEach(el => el.onclick = () => {
      $$('#wzFormatieTegels .wz-tegel').forEach(x => x.classList.remove('wz-actief'));
      el.classList.add('wz-actief');
      gekFormatie = el.dataset.fm;
    });
    const et = $('#wzFormatieTegels .wz-tegel[data-eigen]');
    if (et) et.onclick = () => efWizard.toonInvoer();
  };
  vulFormatieTegels();

  const koppelAanvoerderKliks = () => $$('#wzAanvoerderLijst .wz-keuze').forEach(el => el.onclick = () => {
    $$('#wzAanvoerderLijst .wz-keuze').forEach(x => x.classList.remove('wz-actief'));
    el.classList.add('wz-actief');
    gekAanvoerder = el.dataset.pid || null;
  });
  koppelAanvoerderKliks();

  $$('#wzFormatTegels .wz-tegel').forEach(el => el.onclick = () => {
    $$('#wzFormatTegels .wz-tegel').forEach(x => x.classList.remove('wz-actief'));
    el.classList.add('wz-actief');
    gekFormat = el.dataset.f;
    vulFormatieTegels();
  });

  $$('#wzBody [data-doelsug]').forEach(b => b.onclick = () => { $('#wzDoelInvoer').value = b.dataset.doelsug; });

  const toonStap = i => {
    $$('.wz-stap').forEach(s => s.classList.remove('wz-actief'));
    $(`.wz-stap[data-stap="${i}"]`).classList.add('wz-actief');
    $$('.wz-dot').forEach((d,di) => d.classList.toggle('wz-actief', di===i));
    $('#wzTerug').style.visibility = i===0 ? 'hidden' : 'visible';
    $('#wzVolgende').textContent = i===WIZARD_STAPPEN-1 ? 'Klaar' : 'Volgende';
  };

  const opslaanEnSluiten = () => {
    const formatVeranderd = gekFormat !== w.format || gekFormatie !== w.formatie;
    if (formatVeranderd){
      const nieuweIds = new Set(bouwSlots(gekFormat, gekFormatie).map(s => s.id));
      for (const kk of Object.values(w.kwarten)){
        for (const slot of Object.keys(kk.lineup)) if (!nieuweIds.has(slot)) delete kk.lineup[slot];
        kk.events = kk.events.filter(e => nieuweIds.has(e.slot));
      }
      w.format = gekFormat; w.formatie = gekFormatie;
    }
    w.aanvoerder = gekAanvoerder || null;
    w.doel = ($('#wzDoelInvoer')?.value || '').trim();
    w.opzetGedaan = true;
    bewaarWedstrijd();
    renderWedstrijd();
    $('#wzBody').style.display = 'none';
    $('#wzBottom').style.display = 'none';
    $('#wzKlaar').classList.add('wz-actief');
    setTimeout(verbergWedstrijdWizard, 1800);
  };

  $('#wzVolgende').onclick = () => {
    if (stap < WIZARD_STAPPEN-1){ stap++; toonStap(stap); }
    else opslaanEnSluiten();
  };
  $('#wzTerug').onclick = () => { if (stap > 0){ stap--; toonStap(stap); } };
  $('#wzSkipLink').onclick = () => {
    $('#wzSkipWarn').classList.add('wz-actief');
    $('#wzBtnRij').style.display = 'none';
    $('#wzSkipLink').style.display = 'none';
  };
  $('#wzSkipTerug').onclick = () => {
    $('#wzSkipWarn').classList.remove('wz-actief');
    $('#wzBtnRij').style.display = 'flex';
    $('#wzSkipLink').style.display = 'block';
  };
  $('#wzSkipDoor').onclick = opslaanEnSluiten;
}

function verbergWedstrijdWizard(){
  const el = $('#wizardAchter');
  if (!el) return;
  el.classList.remove('open');
  el.innerHTML = '';
  S._wizardActief = false;
}


/* ==================== KLOK ==================== */
const huidigKwart = () => S.wedstrijd.kwarten[S.kwart];
function klokSec(k){ return k.klok.base + (k.klok.running ? (Date.now() - k.klok.start)/1000 : 0); }
function kwartLive(k){ return k.klok.running || k.klok.base > 0; }

function klokStartPauze(){
  const k = huidigKwart();
  if (k.klok.running){ k.klok.base = klokSec(k); k.klok.running = false; }
  else { k.klok.start = Date.now(); k.klok.running = true; }
  bewaarWedstrijd(); renderWedstrijd();
}
function klokReset(){
  const k = huidigKwart();
  if (!confirm('Klok van deze periode op nul zetten?' + (k.events.length ? '\nGeregistreerde wissels blijven staan.' : ''))) return;
  k.klok = {base:0, running:false, start:0};
  bewaarWedstrijd(); renderWedstrijd();
}
function klokNaarEinde(){
  const w = S.wedstrijd, k = huidigKwart();
  const eind = Math.round(w.kwartduur*60);
  if (!confirm(`Klok direct op eindtijd (${mmss(eind)}) zetten voor ${periodeOmschrijving(w)}?`)) return;
  k.klok = {base:eind, running:false, start:0};
  bewaarWedstrijd(); renderWedstrijd();
  if (navigator.vibrate) navigator.vibrate([300,120,300,120,300]);
  meld(`⏱ Klok gezet op einde ${periodeOmschrijving(w)} (${mmss(eind)})`);
}
function tikKlok(){
  const w = S.wedstrijd; if (!w) return;
  const k = huidigKwart();
  if (k.klok.running && klokSec(k) >= w.kwartduur*60){
    k.klok.base = Math.round(w.kwartduur*60);
    k.klok.running = false;
    bewaarWedstrijd();
    if (navigator.vibrate) navigator.vibrate([300,120,300,120,300]);
    meld(`⏱ Einde ${periodeOmschrijving(w)} — klok gestopt op ${mmss(w.kwartduur*60)}`);
    renderWedstrijd();
    return;
  }
  const el = $('#klokTijd'); if (el) el.textContent = mmss(klokSec(k));
  const sec = klokSec(k);
  (k.plan||[]).forEach((p,i) => {
    const item = $(`[data-plan-i="${i}"]`);
    if (!item) return;
    if (sec >= p.min*60 && !item.classList.contains('nu')){
      item.classList.add('nu');
      if (navigator.vibrate) navigator.vibrate([180,90,180]);
      const inNaam = p.in === WISSEL_BEURT ? (spelerNaam(beurtSpeler(k)) + ' (aan de beurt)') : spelerNaam(p.in);
      meld(`Geplande wissel: ${inNaam} erin voor ${spelerNaam(p.uit)}`);
    }
  });
}

/* ==================== GEPLANDE WISSELS ====================
   Sentinel-waarde voor "Wie aan de beurt is": in plaats van een vaste speler
   kiest de coach dat de app op het wisselmoment automatisch de speler met de
   minste speeltijd van de bank inbrengt. Zo hoeft hij vooraf niet te weten wie
   het minst gespeeld heeft — dat rekent de app pas uit als de wissel valt. */
const WISSEL_BEURT = '__beurt__';

/* Wie is er "aan de beurt": de beschikbare bankspeler met de minste speeltijd
   over de hele wedstrijd. uitgesloten = spelers die op dit moment al ingepland
   staan (voorkomt dat dezelfde speler dubbel wordt gekozen). Retourneert een
   pid of null als er niemand (meer) op de bank staat. */
function beurtSpeler(k, uitgesloten = new Set()){
  const l = effectieveLineup(k);
  const opVeld = new Set(Object.values(l));
  const aWed = analyseWedstrijd(S.wedstrijd);
  const bank = (S.wedstrijd.selectie||[])
    .filter(pid => !opVeld.has(pid) && speler(pid) && !uitgesloten.has(pid))
    .sort((a,b) => (aWed.tijd[a]||0) - (aWed.tijd[b]||0));
  return bank[0] || null;
}
/* Leesbare naam voor een plan-"in", inclusief de aan-de-beurt-sentinel. */
function planInNaam(pid){ return pid === WISSEL_BEURT ? 'Wie aan de beurt is' : spelerNaam(pid); }
function planInNr(pid){ return pid === WISSEL_BEURT ? '★' : spelerNr(pid); }

function modalPlanWissel(){
  const k = huidigKwart();
  const l = effectieveLineup(k);
  const gepland = k.plan || [];
  const geplandIn = new Set(gepland.map(p => p.in));
  const geplandUit = new Set(gepland.map(p => p.uit));
  const veldSpelers = Object.values(l).filter(pid => speler(pid) && !geplandUit.has(pid));
  const bankSpelers = (S.wedstrijd.selectie||[]).filter(pid => !Object.values(l).includes(pid) && speler(pid) && !geplandIn.has(pid));
  if (!veldSpelers.length) return meld('Zet eerst een opstelling neer voor deze periode');
  if (!bankSpelers.length) return meld('Er staat niemand op de bank om in te brengen');
  const optie = pid => `<option value="${pid}">${esc(spelerNr(pid))} · ${esc(spelerNaam(pid))}</option>`;
  openModal(`
    <h2>Wissel plannen — ${esc(periodeOmschrijving(S.wedstrijd))}</h2>
    <div class="veldgroep"><label>Erin (van de bank)</label>
      <select class="invoer" id="mPlanIn"><option value="${WISSEL_BEURT}">★ Wie aan de beurt is (minst gespeeld)</option>${bankSpelers.map(optie).join('')}</select>
      <p style="font-size:calc(11.5px * var(--fs));color:var(--ink-2);margin-top:6px;line-height:1.5">Bij <b>“wie aan de beurt is”</b> kiest de app op het wisselmoment automatisch de speler met de minste speeltijd van de bank.</p></div>
    <div class="veldgroep"><label>Eruit (van het veld)</label>
      <select class="invoer" id="mPlanUit">${veldSpelers.map(optie).join('')}</select></div>
    <div class="veldgroep"><label>Na hoeveel minuten</label>
      <input class="invoer" id="mPlanMin" inputmode="decimal" value="${Math.round(S.wedstrijd.kwartduur/2)}"></div>
    <label style="font-size:calc(11.5px * var(--fs));font-weight:700;color:var(--ink-2);text-transform:uppercase;letter-spacing:.5px;display:block;margin:12px 0 6px">Reden (optioneel)</label>
    <div class="reden-rij" id="mPlanRedenen">${WISSEL_REDENEN.map(r =>
      `<button class="reden" data-reden="${r.id}"><span class="ic">${r.ico?ico(r.ico,18):r.emoji}</span> ${r.label}</button>`).join('')}</div>
    <button class="knop vol" id="mPlanOk" style="margin-top:14px">Wissel inplannen</button>
    <p style="font-size:calc(12.5px * var(--fs));color:var(--ink-2);margin-top:10px;line-height:1.5">Zodra de kwartklok dit moment passeert, licht de wissel op in het wisselvak. Tik dan op ✓ om hem door te voeren — de echte wisseltijd en reden worden geregistreerd.</p>`);
  let planReden = null;
  $$('#mPlanRedenen [data-reden]').forEach(b => b.onclick = () => {
    const id = b.dataset.reden;
    planReden = (planReden === id) ? null : id;
    $$('#mPlanRedenen [data-reden]').forEach(x => x.classList.toggle('aan', x.dataset.reden === planReden));
  });
  $('#mPlanOk').onclick = () => {
    const min = parseFloat(($('#mPlanMin').value||'').replace(',','.'));
    if (!(min >= 0)) return meld('Vul een geldig aantal minuten in');
    const k2 = huidigKwart();
    const item = {in: $('#mPlanIn').value, uit: $('#mPlanUit').value, min};
    if (planReden) item.reden = planReden;
    (k2.plan ||= []).push(item);
    k2.plan.sort((a,b) => a.min - b.min);
    telGebruik('wissel_gepland');
    sluitModal(); bewaarWedstrijd(); renderWedstrijd();
  };
}

function voerPlanUit(i){
  const k = huidigKwart();
  const p = (k.plan||[])[i];
  if (!p) return;
  const l = effectieveLineup(k);
  const slot = Object.keys(l).find(s => l[s] === p.uit);
  if (!slot) return meld(`${spelerNaam(p.uit)} staat niet (meer) op het veld`);
  /* "Wie aan de beurt is" pas nu omzetten naar een concrete speler: de
     minst-gespeelde bankspeler op dit moment. De uitgaande speler tellen we
     mee als "op het veld" zodat hij niet per ongeluk zichzelf vervangt. */
  const inPid = p.in === WISSEL_BEURT ? beurtSpeler(k) : p.in;
  if (!inPid) return meld('Er staat niemand op de bank om in te brengen');
  if (Object.values(l).includes(inPid)) return meld(`${spelerNaam(inPid)} staat al op het veld`);
  if (kwartLive(k)){
    const sec = Math.round(klokSec(k));
    const ev = {in: inPid, uit: p.uit, slot, sec};
    if (p.reden) ev.reden = p.reden;
    k.events.push(ev);
    telGebruik('wissel_direct');
    meld(`${spelerNaam(inPid)} erin, ${spelerNaam(p.uit)} eruit · ${mmss(sec)}`);
  } else {
    k.lineup[slot] = inPid;
    for (const e of k.events) if (e.in === p.uit && e.slot === slot) e.in = inPid;
  }
  k.plan.splice(i,1);
  bewaarWedstrijd(); renderWedstrijd();
}

/* ==================== SPEELTIJD-CORRECTIE ==================== */
/* Handmatige overschrijving van de berekende speeltijd voor één speler in de huidige
   periode — bedoeld voor het geval een wissel vergeten is door te voeren. */
function modalSpeeltijdCorrigeren(pid){
  const w = S.wedstrijd, k = huidigKwart();
  const aKwart = analyseKwart(w, k);
  const huidigSec = aKwart.tijd[pid] || 0;
  const heeftCorrectie = k.correcties && k.correcties[pid] != null;
  openModal(`
    <h2>Speeltijd aanpassen</h2>
    <p style="font-size:calc(13px * var(--fs));color:var(--ink-2);margin-bottom:14px">${esc(spelerNaam(pid))} · ${esc(periodeOmschrijving(w))}</p>
    <div class="veldgroep"><label>Gespeelde minuten</label>
      <input class="invoer" id="mCorrMin" inputmode="decimal" value="${String(Math.round(huidigSec/6)/10).replace('.',',')}"></div>
    <p style="font-size:calc(12px * var(--fs));color:var(--ink-2);margin:8px 0 14px;line-height:1.5">Overschrijft de automatische berekening voor deze periode — handig als een wissel vergeten is door te voeren.</p>
    <button class="knop vol" id="mCorrOk">Opslaan</button>
    ${heeftCorrectie ? `<button class="knop licht vol" id="mCorrWeg" style="margin-top:8px">Correctie verwijderen</button>` : ''}`);
  $('#mCorrOk').onclick = () => {
    const min = parseFloat(($('#mCorrMin').value||'').replace(',','.'));
    if (!(min >= 0)) return meld('Vul een geldig aantal minuten in');
    const sec = Math.round(min*60);
    (k.correcties ||= {})[pid] = sec;
    telGebruik('speeltijd_correctie');
    sluitModal(); bewaarWedstrijd(); renderWedstrijd();
    meld(`Speeltijd ${spelerNaam(pid)} aangepast naar ${mmss(sec)}`);
  };
  const wegBtn = $('#mCorrWeg');
  if (wegBtn) wegBtn.onclick = () => {
    delete k.correcties[pid];
    sluitModal(); bewaarWedstrijd(); renderWedstrijd();
    meld(`Correctie verwijderd — speeltijd weer automatisch berekend`);
  };
}

/* ==================== DOELPUNTEN ==================== */
function registreerGoal({type, pid = null}){
  const w = S.wedstrijd;
  const sec = Math.round(klokSec(huidigKwart()));
  (w.goals ||= []).push({type, pid, kwart: S.kwart, sec});
  telGebruik('doelpunt');
  if (navigator.vibrate) navigator.vibrate(type === 'voor' ? [90,60,90,60,200] : 120);
  meld(type === 'voor' ? `⚽ GOAL! ${pid ? spelerNaam(pid) : S.team.naam}` : `Tegendoelpunt · ${mmss(sec)}`);
  bewaarWedstrijd(); renderWedstrijd();
}

function modalGoalVoor(){
  const k = huidigKwart();
  const l = effectieveLineup(k);
  const veldSpelers = Object.values(l).filter(pid => speler(pid));
  if (!veldSpelers.length){ registreerGoal({type:'voor'}); return; }
  openModal(`
    <h2>⚽ Wie scoorde er?</h2>
    <div class="goal-kies">${veldSpelers.map(pid => `
      <div class="chip" data-goal-pid="${pid}" style="cursor:pointer">
        <div class="shirt">${esc(spelerNr(pid))}</div>
        <div class="naam">${esc(spelerNaam(pid))}</div>
      </div>`).join('')}</div>
    <button class="knop licht vol" id="mGoalOnbekend" style="margin-top:10px">Eigen doelpunt tegenstander / onbekend</button>`);
  $$('#modalInhoud [data-goal-pid]').forEach(c => c.onclick = () => { sluitModal(); registreerGoal({type:'voor', pid: c.dataset.goalPid}); });
  $('#mGoalOnbekend').onclick = () => { sluitModal(); registreerGoal({type:'voor'}); };
}

/* ---------- Doelpunt corrigeren (verkeerde knop / verkeerde scorer) ---------- */
function modalGoalCorrigeren(i){
  const w = S.wedstrijd;
  const g = (w.goals||[])[i];
  if (!g) return;
  const k = huidigKwart();
  const l = effectieveLineup(k);
  const veldSpelers = Object.values(l).filter(pid => speler(pid));
  const overig = (w.selectie||[]).filter(pid => speler(pid) && !veldSpelers.includes(pid));
  const huidigeOmschrijving = g.type === 'voor'
    ? (g.pid ? spelerNaam(g.pid) : 'doelpunt (onbekende maker)')
    : 'tegendoelpunt';
  const scorerOptie = pid => `<option value="${pid}" ${g.pid===pid?'selected':''}>${esc(spelerNr(pid))} · ${esc(spelerNaam(pid))}</option>`;

  openModal(`
    <h2>Doelpunt corrigeren</h2>
    <p style="font-size:calc(13.5px * var(--fs));color:var(--ink-2);margin-bottom:14px">Nu geregistreerd als <b>${esc(huidigeOmschrijving)}</b> op ${mmss(g.sec||0)}.</p>
    <div class="correctie-opties">
      ${g.type === 'voor' ? `
      <div class="veldgroep" style="margin-bottom:6px"><label>Andere scorer kiezen</label>
        <select class="invoer" id="mGcScorer">
          <option value="">Onbekend / geen maker</option>
          ${veldSpelers.length ? `<optgroup label="Op het veld">${veldSpelers.map(scorerOptie).join('')}</optgroup>` : ''}
          ${overig.length ? `<optgroup label="Overige selectie">${overig.map(scorerOptie).join('')}</optgroup>` : ''}
        </select></div>
      <button class="knop vol" id="mGcScorerOk">Scorer opslaan</button>
      <button class="knop licht vol" id="mGcKant">↔ Toch een tegendoelpunt</button>
      ` : `
      <p style="font-size:calc(13.5px * var(--fs));color:var(--ink);margin-bottom:4px">Dit staat als doelpunt voor de tegenstander.</p>
      <button class="knop vol" id="mGcKant">↔ Maak er een doelpunt vóór ${esc(S.team.naam)} van</button>
      `}
      <button class="knop gevaar vol" id="mGcWeg">🗑 Doelpunt verwijderen</button>
    </div>`);

  const scOk = $('#mGcScorerOk');
  if (scOk) scOk.onclick = () => {
    const pid = $('#mGcScorer').value || null;
    w.goals[i].pid = pid;
    sluitModal(); bewaarWedstrijd(); renderWedstrijd();
    meld(pid ? `Scorer gewijzigd naar ${spelerNaam(pid)}` : 'Scorer op onbekend gezet');
  };
  $('#mGcKant').onclick = () => {
    if (g.type === 'voor'){ w.goals[i].type = 'tegen'; w.goals[i].pid = null; }
    else { w.goals[i].type = 'voor'; }
    sluitModal(); bewaarWedstrijd(); renderWedstrijd();
    meld('Doelpunt omgezet');
  };
  $('#mGcWeg').onclick = () => {
    w.goals.splice(i,1);
    sluitModal(); bewaarWedstrijd(); renderWedstrijd();
    meld('Doelpunt verwijderd');
  };
}

/* ==================== KAARTEN & STRAFFEN ==================== */
function modalKaart(){
  const w = S.wedstrijd;
  const k = huidigKwart();
  const l = effectieveLineup(k);
  const veldSpelers = Object.values(l).filter(pid => speler(pid));
  const bankSpelers = (w.selectie||[]).filter(pid => !Object.values(l).includes(pid) && speler(pid));
  const alle = [...veldSpelers, ...bankSpelers];
  if (!alle.length) return meld('Voeg eerst spelers toe aan de selectie');
  const optie = pid => `<option value="${pid}">${esc(spelerNr(pid))} · ${esc(spelerNaam(pid))}${veldSpelers.includes(pid)?' (veld)':' (bank)'}</option>`;
  const duur = tijdstrafSec();
  openModal(`
    <h2>Kaart of straf</h2>
    <div class="veldgroep"><label>Speler</label>
      <select class="invoer" id="mKSpeler">${alle.map(optie).join('')}</select></div>
    <div class="veldgroep"><label>Type</label>
      <div class="segment" id="mKType">
        <button data-t="geel" class="actief">🟨 Geel</button>
        <button data-t="tijd">⏱ Tijdstraf</button>
        <button data-t="rood">🟥 Rood</button>
      </div></div>
    <p style="font-size:calc(12.5px * var(--fs));color:var(--ink-2);margin-bottom:14px;line-height:1.5">
      <b>KNVB:</b> een gele kaart is een waarschuwing. Bij een tweede gele in dezelfde wedstrijd volgt rood. In de B-categorie geldt een tijdstrafregeling: ${Math.round(duur/60)} minuten voor deze leeftijd${duur===300?' (pupillen)':' (junioren/senioren)'}.
    </p>
    <button class="knop vol" id="mKOk">Registreren</button>`);
  let type = 'geel';
  $$('#mKType button').forEach(b => b.onclick = () => {
    $$('#mKType button').forEach(x=>x.classList.remove('actief')); b.classList.add('actief'); type = b.dataset.t;
  });
  $('#mKOk').onclick = () => {
    const pid = $('#mKSpeler').value;
    const sec = Math.round(klokSec(k));
    const kaart = {pid, type, kwart: S.kwart, sec};
    if (type === 'tijd') kaart.duur = duur;
    (w.kaarten ||= []).push(kaart);
    telGebruik('kaart');
    if (type === 'geel'){
      const aantalGeel = w.kaarten.filter(c => c.pid === pid && c.type === 'geel').length;
      if (aantalGeel >= 2){
        w.kaarten.push({pid, type:'rood', kwart: S.kwart, sec, auto:true});
        meld(`Tweede gele kaart → rode kaart voor ${spelerNaam(pid)}`);
      }
    }
    if (type === 'rood' || w.kaarten[w.kaarten.length-1].type === 'rood'){
      const lineup = effectieveLineup(k);
      const slot = Object.keys(lineup).find(s => lineup[s] === pid);
      if (slot){
        if (kwartLive(k)) k.events.push({in: null, uit: pid, slot, sec});
        else delete k.lineup[slot];
      }
    }
    if (navigator.vibrate) navigator.vibrate(type==='rood' ? [300,100,300] : 180);
    sluitModal(); bewaarWedstrijd(); renderWedstrijd();
    meld(`${KAART_NAAM[type]} voor ${spelerNaam(pid)} geregistreerd`);
  };
}

/* ---------- Kaart corrigeren ---------- */
function modalKaartCorrigeren(i){
  const w = S.wedstrijd;
  const c = (w.kaarten||[])[i];
  if (!c) return;
  const alle = (w.selectie||[]).filter(pid => speler(pid));
  const optie = pid => `<option value="${pid}" ${c.pid===pid?'selected':''}>${esc(spelerNr(pid))} · ${esc(spelerNaam(pid))}</option>`;
  openModal(`
    <h2>Kaart corrigeren</h2>
    <p style="font-size:calc(13.5px * var(--fs));color:var(--ink-2);margin-bottom:14px">Nu: <b>${esc(KAART_NAAM[c.type])}</b> voor <b>${esc(spelerNaam(c.pid))}</b> op ${mmss(c.sec||0)}.</p>
    <div class="veldgroep"><label>Andere speler</label>
      <select class="invoer" id="mKcSpeler">${alle.map(optie).join('')}</select></div>
    <div class="correctie-opties">
      <button class="knop vol" id="mKcOk">Speler opslaan</button>
      <button class="knop gevaar vol" id="mKcWeg">🗑 Kaart verwijderen</button>
    </div>`);
  $('#mKcOk').onclick = () => {
    w.kaarten[i].pid = $('#mKcSpeler').value;
    sluitModal(); bewaarWedstrijd(); renderWedstrijd();
    meld('Kaart aangepast');
  };
  $('#mKcWeg').onclick = () => {
    w.kaarten.splice(i,1);
    sluitModal(); bewaarWedstrijd(); renderWedstrijd();
    meld('Kaart verwijderd');
  };
}

/* ==================== WEDSTRIJDVERSLAG ==================== */
function genereerVerslag(){
  const w = S.wedstrijd;
  const voor = (w.goals||[]).filter(g => g.type==='voor').length;
  const tegen = (w.goals||[]).filter(g => g.type==='tegen').length;
  const uitslag = w.thuis ? `${voor}–${tegen}` : `${tegen}–${voor}`;
  const wedstrijdtitel = isToernooi(w)
    ? `🏆 ${w.tegenstander}`
    : (w.thuis ? `${S.team.naam} – ${w.tegenstander}` : `${w.tegenstander} – ${S.team.naam}`);
  const ww = voor > tegen ? 'gewonnen' : voor < tegen ? 'verloren' : 'gelijkgespeeld';

  const lines = [];
  lines.push(`${wedstrijdtitel}`);
  lines.push(`${new Date(w.datum+'T12:00').toLocaleDateString('nl-NL',{weekday:'long',day:'numeric',month:'long',year:'numeric'})}`);
  lines.push('');
  if (w.doel){ lines.push(`🎯 Wedstrijddoel: ${w.doel}`); lines.push(''); }
  if (voor + tegen > 0 || analyseWedstrijd(w).kwarten){ lines.push(`Eindstand: ${uitslag} (${ww})`); lines.push(''); }

  const scorers = {};
  for (const g of (w.goals||[])) if (g.type==='voor' && g.pid) scorers[g.pid] = (scorers[g.pid]||0)+1;
  const top = Object.entries(scorers).sort((a,b) => b[1]-a[1]);
  if (top.length){
    lines.push('Doelpuntenmakers:');
    for (const [pid, n] of top) lines.push(`• ${spelerNaam(pid)}${n>1?` (${n}×)`:''}`);
    lines.push('');
  }
  if (w.aanvoerder){ lines.push(`Aanvoerder: ${spelerNaam(w.aanvoerder)}`); lines.push(''); }

  const a = analyseWedstrijd(w);
  if (a.kwarten){
    lines.push('Speeltijd:');
    const sorted = [...(w.selectie||[])].filter(pid => speler(pid) && a.tijd[pid])
      .sort((x,y) => (a.tijd[y]||0) - (a.tijd[x]||0));
    for (const pid of sorted){
      const kk = a.keeper[pid] ? ` (${a.keeper[pid]}× keeper)` : '';
      lines.push(`• ${spelerNaam(pid)}: ${uurMin(a.tijd[pid])}${kk}`);
    }
    const nietGespeeld = (w.selectie||[]).filter(pid => speler(pid) && !a.tijd[pid]);
    if (nietGespeeld.length) lines.push(`• Niet ingezet: ${nietGespeeld.map(spelerNaam).join(', ')}`);
    lines.push('');
  }

  const heeftWissels = periodeNrs(w).some(nr => (w.kwarten[nr]?.events||[]).length);
  if (heeftWissels){
    lines.push('Wissels:');
    for (const nr of periodeNrs(w)){
      const k = w.kwarten[nr];
      if (!k.events?.length) continue;
      lines.push(`  ${periodeLabel(w, nr)}:`);
      for (const e of [...k.events].sort((a,b)=>a.sec-b.sec)){
        const t = mmss(e.sec);
        if (e.in && e.uit) lines.push(`  • ${t} — ${spelerNaam(e.in)} in voor ${spelerNaam(e.uit)}`);
        else if (e.in)     lines.push(`  • ${t} — ${spelerNaam(e.in)} erin`);
        else if (e.uit)    lines.push(`  • ${t} — ${spelerNaam(e.uit)} eruit`);
      }
    }
    lines.push('');
  }

  if ((w.kaarten||[]).filter(c => !c.auto).length){
    lines.push('Kaarten:');
    for (const c of [...w.kaarten].filter(c => !c.auto).sort((a,b)=>a.sec-b.sec)){
      const lbl = periodeLabel(w, String(c.kwart));
      const txt = c.type === 'tijd' ? `tijdstraf ${Math.round(c.duur/60)} min` : KAART_NAAM[c.type];
      lines.push(`• ${spelerNaam(c.pid)} — ${txt} (${lbl}, ${mmss(c.sec)})`);
    }
    lines.push('');
  }
  return lines.join('\n').trim();
}

/* ---- AI-wedstrijdverslag ----
   We laten Claude (server-side Cloud Function 'genereerVerslagAI', europe-west1)
   een levendig, vlot lopend verslagje schrijven. AVG: er gaan NOOIT namen van
   (minderjarige) spelers naar het model. In plaats daarvan sturen we neutrale
   labels ("Speler 1", "Speler 2", …); ná het antwoord zetten we die labels
   client-side terug naar de echte namen. Zo blijft alle herleidbare data op het
   toestel. Lukt de AI-generatie niet, dan valt de modal terug op de kale
   feitentekst uit genereerVerslag(). */
function genereerVerslagData(){
  const w = S.wedstrijd;
  const voor = (w.goals||[]).filter(g => g.type==='voor').length;
  const tegen = (w.goals||[]).filter(g => g.type==='tegen').length;
  const ww = voor > tegen ? 'gewonnen' : voor < tegen ? 'verloren' : 'gelijkgespeeld';

  // Pseudonimiseer elke betrokken speler-id naar een neutraal label.
  const labels = {};                 // pid -> "Speler N"
  const naamVoor = {};               // "Speler N" -> echte naam (blijft client-side)
  let teller = 0;
  const label = (pid) => {
    if (!pid) return null;
    if (!labels[pid]){
      teller++;
      labels[pid] = 'Speler ' + teller;
      naamVoor[labels[pid]] = spelerNaam(pid);
    }
    return labels[pid];
  };

  const scorers = {};
  for (const g of (w.goals||[])) if (g.type==='voor' && g.pid) scorers[g.pid] = (scorers[g.pid]||0)+1;
  const doelpunten = Object.entries(scorers)
    .sort((a,b) => b[1]-a[1])
    .map(([pid,n]) => ({ speler: label(pid), aantal: n }));

  const a = analyseWedstrijd(w);
  const speeltijd = [];
  if (a.kwarten){
    for (const pid of (w.selectie||[]).filter(pid => speler(pid) && a.tijd[pid])){
      speeltijd.push({ speler: label(pid), minuten: Math.round((a.tijd[pid]||0)/60),
        keerKeeper: a.keeper[pid] || 0 });
    }
  }

  const data = {
    team: S.team?.naam || 'ons team',
    tegenstander: w.tegenstander || 'de tegenstander',
    thuis: !!w.thuis,
    toernooi: isToernooi(w),
    datum: w.datum || null,
    doel: w.doel || null,
    doelBin: voor, doelTegen: tegen, resultaat: ww,
    aanvoerder: w.aanvoerder ? label(w.aanvoerder) : null,
    doelpunten,
    speeltijd,
  };
  return { data, naamVoor };
}

/* Zet neutrale labels ("Speler 3") in de AI-tekst terug naar echte namen. */
function herstelNamen(tekst, naamVoor){
  let t = String(tekst);
  // langste labels eerst, zodat "Speler 12" niet half door "Speler 1" wordt geraakt
  for (const lbl of Object.keys(naamVoor).sort((a,b) => b.length - a.length)){
    t = t.split(lbl).join(naamVoor[lbl]);
  }
  return t;
}

async function modalVerslag(){
  telGebruik('verslag_ai');
  const fallback = genereerVerslag();
  openModal(`
    <h2>📋 Wedstrijdverslag</h2>
    <div id="mVLaad" style="display:flex;align-items:center;gap:10px;padding:22px 4px;color:var(--ink-2);font-size:calc(14px * var(--fs))">
      <span class="mV-spin" aria-hidden="true"></span>
      <span>Cluppie schrijft het verslag…</span>
    </div>
    <textarea class="invoer" id="mVTekst" style="display:none;min-height:280px;font-family:inherit;line-height:1.55;resize:vertical;font-size:calc(13.5px * var(--fs))"></textarea>
    <p id="mVHint" style="display:none;font-size:calc(12px * var(--fs));color:var(--ink-2);margin:8px 0 14px">Je kunt de tekst nog aanpassen voordat je hem deelt.</p>
    <div id="mVKnoppen" style="display:none">
      <button class="knop vol" id="mVDeel">${ico('admin-upload',16)} Delen / kopiëren</button>
      <button class="knop licht vol" id="mVFeiten" style="margin-top:8px">📊 Toon kale feiten</button>
    </div>`);

  const toonTekst = (tekst, isAI) => {
    const laad = $('#mVLaad'); if (laad) laad.style.display = 'none';
    const ta = $('#mVTekst'); ta.style.display = ''; ta.value = tekst;
    $('#mVHint').style.display = ''; $('#mVKnoppen').style.display = '';
    // Bij de AI-versie kun je terugvallen op de feiten; bij de feiten verbergen.
    const fk = $('#mVFeiten'); if (fk) fk.style.display = isAI ? '' : 'none';
  };

  const koppelKnoppen = () => {
    $('#mVDeel').onclick = async () => {
      const t = $('#mVTekst').value;
      try {
        if (navigator.share) await navigator.share({title:'Wedstrijdverslag', text:t});
        else { await navigator.clipboard.writeText(t); meld('Verslag gekopieerd'); }
      } catch { try { await navigator.clipboard.writeText(t); meld('Verslag gekopieerd'); } catch { meld('Kon niet kopiëren'); } }
    };
    const fk = $('#mVFeiten');
    if (fk) fk.onclick = () => toonTekst(fallback, false);
  };
  koppelKnoppen();

  // Probeer de AI-versie; val bij elke hapering terug op de feitentekst.
  try {
    const { data, naamVoor } = genereerVerslagData();
    const res = await httpsCallable(functions, 'genereerVerslagAI')({ data });
    const ruw = res?.data?.verslag;
    if (ruw && $('#mVTekst')){          // modal kan intussen gesloten zijn
      toonTekst(herstelNamen(ruw, naamVoor), true);
    } else if ($('#mVTekst')){
      toonTekst(fallback, false);
    }
  } catch (err){
    console.warn('[verslag] AI-generatie mislukt, val terug op feiten:', err?.code, err?.message);
    if ($('#mVTekst')) toonTekst(fallback, false);
  }
}

/* ==================== OPSTELLING-LOGICA ==================== */
function plaats(pid, slotId){
  const k = huidigKwart(), live = kwartLive(k);
  const l = effectieveLineup(k);
  const huidigeSlot = Object.keys(l).find(s => l[s] === pid);
  const bezet = l[slotId];
  if (huidigeSlot === slotId) return;
  if (huidigeSlot){
    delete k.lineup[huidigeSlot];
    if (k.lineup[slotId] !== undefined || bezet){
      const ander = k.lineup[slotId];
      if (ander !== undefined){ k.lineup[huidigeSlot] = ander; }
      for (const e of k.events){ if (e.slot === slotId) e.slot = huidigeSlot; else if (e.slot === huidigeSlot) e.slot = slotId; }
    }
    k.lineup[slotId] = pid;
  } else if (live){
    const sec = Math.round(klokSec(k));
    k.events.push({in: pid, uit: bezet || null, slot: slotId, sec});
    telGebruik('wissel_direct');
    if (bezet){
      meld(`${spelerNaam(pid)} erin, ${spelerNaam(bezet)} eruit · ${mmss(sec)}`);
      S.geselecteerd = null;
      bewaarWedstrijd(); renderWedstrijd();
      modalWisselReden(k, k.events.length - 1); // facultatieve reden vragen
      return;
    }
  } else {
    k.lineup[slotId] = pid;
  }
  S.geselecteerd = null;
  bewaarWedstrijd(); renderWedstrijd();
}
function naarBank(pid){
  const k = huidigKwart(), live = kwartLive(k);
  const l = effectieveLineup(k);
  const slot = Object.keys(l).find(s => l[s] === pid);
  if (!slot){ S.geselecteerd = null; renderWedstrijd(); return; }
  if (live){
    const sec = Math.round(klokSec(k));
    k.events.push({in: null, uit: pid, slot, sec});
    telGebruik('wissel_direct');
    meld(`${spelerNaam(pid)} eruit · ${mmss(sec)}`);
    S.geselecteerd = null;
    bewaarWedstrijd(); renderWedstrijd();
    modalWisselReden(k, k.events.length - 1); // facultatieve reden vragen
    return;
  } else delete k.lineup[slot];
  S.geselecteerd = null;
  bewaarWedstrijd(); renderWedstrijd();
}

/* Facultatieve wisselreden koppelen aan een wissel-event. Nooit verplicht:
   de wissel is al doorgevoerd; dit is een korte, weg-te-tikken keuze achteraf. */
function modalWisselReden(k, eventIndex){
  const e = (k.events||[])[eventIndex];
  if (!e || !e.uit) return; // reden hoort bij iemand die eruit gaat
  const naam = spelerNaam(e.uit);
  const huidig = e.reden || null;
  openModal(`
    <h2>Reden wissel <span style="font-size:calc(13px * var(--fs));color:var(--ink-2);font-weight:500;text-transform:none;letter-spacing:0">(optioneel)</span></h2>
    <p style="font-size:calc(13px * var(--fs));color:var(--ink-2);margin-bottom:12px">${esc(naam)} naar de bank · ${mmss(e.sec)}</p>
    <div class="reden-rij" id="mWrRedenen">${WISSEL_REDENEN.map(r =>
      `<button class="reden ${huidig===r.id?'aan':''}" data-reden="${r.id}"><span class="ic">${r.ico?ico(r.ico,18):r.emoji}</span> ${r.label}</button>`).join('')}</div>
    <div class="disc-blok ${huidig==='gedrag'?'zicht':''}" id="mWrDisc">
      <label class="disc-toggle">
        <input type="checkbox" id="mWrDiscChk" ${e.disciplinair?'checked':''}>
        <span class="disc-toggle-t">Disciplinaire reservebeurt</span>
      </label>
      <div class="disc-uitleg">Deze bankbeurt telt <b>niet mee</b> in het speelminuten-percentage van de speler — zo verlaagt een strafmoment zijn eerlijke gemiddelde niet. Altijd terug te zien in het wedstrijdlog.</div>
      <input class="disc-notitie ${e.disciplinair?'zicht':''}" id="mWrDiscNotitie" placeholder="Reden (optioneel, alleen voor coaches)" value="${esc(e.discNotitie||'')}">
    </div>
    <button class="knop vol fluo" id="mWrOk" style="margin-top:16px">Opslaan</button>
    <button class="knop vol licht" id="mWrGeen" style="margin-top:8px">${huidig?'Reden wissen':'Zonder reden'}</button>`);

  let gekozen = huidig;
  const discBlok = $('#mWrDisc'), discChk = $('#mWrDiscChk'), discNot = $('#mWrDiscNotitie');
  const werkDiscBij = () => {
    discBlok.classList.toggle('zicht', gekozen === 'gedrag');
    if (gekozen !== 'gedrag'){ discChk.checked = false; discNot.classList.remove('zicht'); }
  };
  $$('#mWrRedenen [data-reden]').forEach(b => b.onclick = () => {
    const id = b.dataset.reden;
    gekozen = (gekozen === id) ? null : id;
    $$('#mWrRedenen [data-reden]').forEach(x => x.classList.toggle('aan', x.dataset.reden === gekozen));
    werkDiscBij();
  });
  discChk.onchange = () => discNot.classList.toggle('zicht', discChk.checked);
  $('#mWrOk').onclick = () => {
    if (gekozen) e.reden = gekozen; else delete e.reden;
    // disciplinaire vlag alleen bij reden 'gedrag'
    if (gekozen === 'gedrag' && discChk.checked){
      e.disciplinair = true;
      const n = discNot.value.trim();
      if (n) e.discNotitie = n; else delete e.discNotitie;
    } else {
      delete e.disciplinair; delete e.discNotitie;
    }
    sluitModal(); bewaarWedstrijd(); renderWedstrijd();
  };
  $('#mWrGeen').onclick = () => {
    delete e.reden; delete e.disciplinair; delete e.discNotitie;
    sluitModal(); bewaarWedstrijd(); renderWedstrijd();
  };
}

/* Reden voor een speler die (vooraf) op de bank start. Bij reden 'gedrag' kan de
   coach een disciplinaire reservebeurt aanvinken; die banktijd telt dan niet mee
   in het speelminuten-percentage. Opgeslagen op w.startBankReden[pid]. */
function modalStartBankReden(pid){
  const w = S.wedstrijd;
  w.startBankReden ||= {};
  const huidig = w.startBankReden[pid] || null;
  openModal(`
    <h2>Bankbeurt <span style="font-size:calc(13px * var(--fs));color:var(--ink-2);font-weight:500;text-transform:none;letter-spacing:0">(optioneel)</span></h2>
    <p style="font-size:calc(13px * var(--fs));color:var(--ink-2);margin-bottom:12px">${esc(spelerNaam(pid))} start op de bank. Waarom? Dit leg je vóór de wedstrijd vast.</p>
    <div class="reden-rij" id="mSbRedenen">${WISSEL_REDENEN.map(r =>
      `<button class="reden ${huidig?.reden===r.id?'aan':''}" data-reden="${r.id}"><span class="ic">${r.ico?ico(r.ico,18):r.emoji}</span> ${r.label}</button>`).join('')}</div>
    <div class="disc-blok ${huidig?.reden==='gedrag'?'zicht':''}" id="mSbDisc">
      <label class="disc-toggle">
        <input type="checkbox" id="mSbDiscChk" ${huidig?.disciplinair?'checked':''}>
        <span class="disc-toggle-t">Disciplinaire reservebeurt</span>
      </label>
      <div class="disc-uitleg">Deze bankbeurt telt <b>niet mee</b> in het speelminuten-percentage. Alleen zichtbaar voor coaches.</div>
      <input class="disc-notitie ${huidig?.disciplinair?'zicht':''}" id="mSbDiscNotitie" placeholder="Reden (optioneel, alleen voor coaches)" value="${esc(huidig?.notitie||'')}">
    </div>
    <button class="knop vol fluo" id="mSbOk" style="margin-top:16px">Opslaan</button>
    <button class="knop vol licht" id="mSbGeen" style="margin-top:8px">${huidig?'Reden wissen':'Zonder reden'}</button>`);

  let gekozen = huidig?.reden || null;
  const discBlok = $('#mSbDisc'), discChk = $('#mSbDiscChk'), discNot = $('#mSbDiscNotitie');
  const werkDiscBij = () => {
    discBlok.classList.toggle('zicht', gekozen === 'gedrag');
    if (gekozen !== 'gedrag'){ discChk.checked = false; discNot.classList.remove('zicht'); }
  };
  $$('#mSbRedenen [data-reden]').forEach(b => b.onclick = () => {
    const id = b.dataset.reden;
    gekozen = (gekozen === id) ? null : id;
    $$('#mSbRedenen [data-reden]').forEach(x => x.classList.toggle('aan', x.dataset.reden === gekozen));
    werkDiscBij();
  });
  discChk.onchange = () => discNot.classList.toggle('zicht', discChk.checked);
  $('#mSbOk').onclick = () => {
    if (!gekozen){ delete w.startBankReden[pid]; }
    else {
      const rec = { reden: gekozen };
      if (gekozen === 'gedrag' && discChk.checked){
        rec.disciplinair = true;
        const n = discNot.value.trim(); if (n) rec.notitie = n;
      }
      w.startBankReden[pid] = rec;
    }
    sluitModal(); bewaarWedstrijd(); renderWedstrijd();
  };
  $('#mSbGeen').onclick = () => {
    delete w.startBankReden[pid];
    sluitModal(); bewaarWedstrijd(); renderWedstrijd();
  };
}
function verwijderEvent(i){
  huidigKwart().events.splice(i,1);
  bewaarWedstrijd(); renderWedstrijd();
}
function kopieerVorigKwart(){
  const nr = Number(S.kwart);
  if (nr === 1) return;
  const vorig = S.wedstrijd.kwarten[nr-1];
  const k = huidigKwart();
  k.lineup = effectieveLineup(vorig);
  k.formatie = kwartFormatie(S.wedstrijd, vorig);
  bewaarWedstrijd(); renderWedstrijd();
  meld('Eindopstelling ' + periodeOmschrijving(S.wedstrijd, String(nr-1)) + ' overgenomen — pas aan waar nodig');
}

/* ==================== STATISTIEK-TAB ==================== */
export function htmlStats(){
  if (!S.spelers.length) return `<div class="kaart leeg">Voeg eerst spelers toe.</div>`;
  const alleSeizoenen = S.statsSeizoen === 'alles';
  const wedstrijdenLijst = alleSeizoenen ? S.wedstrijden : S.wedstrijden.filter(w => w.seizoen === S.statsSeizoen);
  const presentieLijst = alleSeizoenen ? (S.presentie||[]) : (S.presentie||[]).filter(p => p.seizoen === S.statsSeizoen);
  const tot = {tijd:{}, keeper:{}, lijn:{}, wedstrijden:{}, goals:{}, geel:{}, rood:{}, tijd_:{}, aanv:{}};
  for (const w of wedstrijdenLijst){
    for (const g of (w.goals||[])) if (g.type==='voor' && g.pid) tot.goals[g.pid] = (tot.goals[g.pid]||0) + 1;
    for (const c of (w.kaarten||[])){
      if (c.auto) continue;
      if (c.type === 'geel') tot.geel[c.pid] = (tot.geel[c.pid]||0) + 1;
      if (c.type === 'rood') tot.rood[c.pid] = (tot.rood[c.pid]||0) + 1;
      if (c.type === 'tijd') tot.tijd_[c.pid] = (tot.tijd_[c.pid]||0) + 1;
    }
    if (w.aanvoerder) tot.aanv[w.aanvoerder] = (tot.aanv[w.aanvoerder]||0) + 1;
    const a = analyseWedstrijd(w);
    if (!a.kwarten) continue;
    for (const [pid, s] of Object.entries(a.tijd)){
      tot.tijd[pid] = (tot.tijd[pid]||0) + s;
      tot.wedstrijden[pid] = (tot.wedstrijden[pid]||0) + 1;
    }
    for (const [pid, n] of Object.entries(a.keeper)) tot.keeper[pid] = (tot.keeper[pid]||0) + n;
    for (const [pid, l] of Object.entries(a.lijn)){
      tot.lijn[pid] ||= {};
      for (const [ln, n] of Object.entries(l)) tot.lijn[pid][ln] = (tot.lijn[pid][ln]||0) + n;
    }
  }
  // speeltijd- en reserve-percentages, over wedstrijden waarin de speler in de selectie zat
  const sr = speeltijdReserve(wedstrijdenLijst);
  const pctSpeeltijd = {}, pctReserve = {};
  for (const [pid, r] of Object.entries(sr)){
    if (r.speelbaar > 0){
      pctSpeeltijd[pid] = Math.round((r.speeltijd / r.speelbaar) * 100);
      pctReserve[pid]   = 100 - pctSpeeltijd[pid];
    }
  }
  const rijen = [...S.spelers].sort((a,b) => (pctSpeeltijd[b.id]??-1) - (pctSpeeltijd[a.id]??-1) || (tot.tijd[b.id]||0) - (tot.tijd[a.id]||0));
  const heeftData = Object.keys(tot.tijd).length > 0;
  const pctKleur = p => p==null ? 'var(--ink-2)' : p>=60?'var(--n5)':p>=45?'var(--n4)':p>=30?'var(--n3)':'var(--n2)';

  // Opkomst training: aanwezig = niet in de afwezig-lijst van een sessie
  const totTrainingen = presentieLijst.length;
  const opkomst = {};
  if (totTrainingen){
    for (const p of S.spelers){
      let aanwezig = 0;
      for (const sessie of presentieLijst){
        if (!(sessie.afwezig || []).includes(p.id)) aanwezig++;
      }
      opkomst[p.id] = Math.round((aanwezig / totTrainingen) * 100);
    }
  }
  const toonOpkomst = totTrainingen > 0;

  // Reden-uitsplitsing van afwezigheid per speler (training), voor inzicht onder
  // de opkomst. Telt per reden-type; oude vrije notities vallen onder 'anders'.
  const afwezigTelling = {}; // pid -> {redenId: aantal}
  if (totTrainingen){
    for (const sessie of presentieLijst){
      for (const pid of (sessie.afwezig || [])){
        const rec = (sessie.afwezigRedenen || {})[pid];
        const info = rec ? afwezigRedenInfo(rec) : null;
        const id = info?.id || 'anders';
        (afwezigTelling[pid] ||= {}); afwezigTelling[pid][id] = (afwezigTelling[pid][id]||0) + 1;
      }
    }
  }

  // Drie losse bladen i.p.v. één brede tabel die horizontaal moet scrollen op
  // mobiel: speelminuten, wedstrijdstatistiek en trainingsopkomst. De actieve
  // keuze staat in S.statsBlad (default 'speel'); koppeling in koppelStatsBlad().
  const blad = S.statsBlad || 'speel';
  const bladBalk = `
    <div class="segment stats-blad" id="statsBlad" style="margin-bottom:14px">
      <button data-statsblad="speel" class="${blad==='speel'?'actief':''}">⏱ Speelminuten</button>
      <button data-statsblad="wed" class="${blad==='wed'?'actief':''}">📋 Wedstrijd</button>
      <button data-statsblad="tr" class="${blad==='tr'?'actief':''}">🏃 Training</button>
    </div>`;

  // Naam in de stats-tabel is klikbaar → opent het spelersprofiel (details).
  // De koppeling zit in koppelStatsBlad(); navigatie via de Spelers-tab zodat
  // de terugknop netjes terugkeert naar Stats.
  const naamCel = p => `<td class="naam-cel"><button type="button" class="stats-naam" data-statsprofiel="${p.id}">${esc(p.naam)}</button></td>`;
  // naam-cel met disciplinaire-badge als de speler ≥1 disciplinaire beurt had
  const naamCelDisc = p => {
    const dsec = Math.round((sr[p.id]?.disciplinair || 0));
    const badge = dsec > 0 ? ` <span class="disc-badge" title="Disciplinaire reservebeurt(en) — niet meegeteld in %">disc.</span>` : '';
    return `<td class="naam-cel"><button type="button" class="stats-naam" data-statsprofiel="${p.id}">${esc(p.naam)}</button>${badge}</td>`;
  };

  const speelBlad = () => `
    <table class="stat-tabel">
      <thead><tr><th>Speler</th><th>Wed.</th><th>Speeltijd</th><th>Res.</th></tr></thead>
      <tbody>${rijen.map(p => {
        const ps = pctSpeeltijd[p.id], pr = pctReserve[p.id];
        return `<tr>
          ${naamCelDisc(p)}
          <td>${tot.wedstrijden[p.id]||0}</td>
          <td class="pct-cel">${ps!=null?`<span style="font-weight:700;color:${pctKleur(ps)}">${ps}%</span><span class="pct-bar"><span style="width:${ps}%;background:${pctKleur(ps)}"></span></span>`:'—'}</td>
          <td class="res-cel">${pr!=null?pr+'%':''}</td></tr>`;
      }).join('')}</tbody>
    </table>
    <p style="font-size:calc(12px * var(--fs));color:var(--ink-2);margin-top:10px;line-height:1.5">
      <b>Speeltijd</b>/<b>Res.</b> = % gespeeld resp. reserve, over de wedstrijden waarin de speler in de selectie zat (samen 100%). Een <span class="disc-badge">disc.</span>-beurt telt niet mee in het percentage. De exacte minuten staan in het spelersprofiel.</p>`;

  const wedBlad = () => `
    <table class="stat-tabel">
      <thead><tr><th>Speler</th><th>⚽</th><th>C</th><th>K</th><th>🟨</th><th>🟥</th></tr></thead>
      <tbody>${rijen.map(p => `<tr>
        ${naamCel(p)}
        <td style="font-weight:700">${tot.goals[p.id]||0}</td>
        <td>${tot.aanv[p.id] ? tot.aanv[p.id]+'×' : ''}</td>
        <td>${tot.keeper[p.id]||0}</td>
        <td>${tot.geel[p.id]||0}</td>
        <td>${tot.rood[p.id]||0}</td></tr>`).join('')}</tbody>
    </table>
    <p style="font-size:calc(12px * var(--fs));color:var(--ink-2);margin-top:10px;line-height:1.5">
      ⚽ doelpunten · <b>C</b> aanvoerdersbeurten · <b>K</b> periodes als keeper · 🟨 gele kaarten · 🟥 rode kaarten.</p>`;

  const redenLabel = id => (AFWEZIG_REDENEN.find(r => r.id === id) || {emoji:'❓',label:'Anders'});
  const trBlad = () => toonOpkomst ? `
    <table class="stat-tabel">
      <thead><tr><th>Speler</th><th>Aanwezig</th><th>Opkomst</th></tr></thead>
      <tbody>${rijen.map(p => {
        const pct = opkomst[p.id] ?? 0;
        const aanw = Math.round((pct/100) * totTrainingen);
        const tel = afwezigTelling[p.id] || {};
        const redenChips = Object.entries(tel).sort((a,b) => b[1]-a[1]).map(([id,n]) => {
          const r = redenLabel(id);
          return `<span class="reden-tel-chip">${r.emoji} ${esc(r.label)} <b>${n}×</b></span>`;
        }).join('');
        return `<tr>
          ${naamCel(p)}
          <td>${aanw} / ${totTrainingen}</td>
          <td class="opkomst-cel ${pct>=80?'goed':pct>=50?'matig':'laag'}">${pct}%</td></tr>
          ${redenChips ? `<tr class="reden-tel-rij"><td colspan="3"><div class="reden-tel">${redenChips}</div></td></tr>` : ''}`;
      }).join('')}</tbody>
    </table>
    <p style="font-size:calc(12px * var(--fs));color:var(--ink-2);margin-top:10px;line-height:1.5">
      <b>Opkomst</b> = % aanwezig van de ${totTrainingen} geregistreerde training${totTrainingen>1?'en':''}. Onder elke speler zie je waarom hij afwezig was.</p>`
    : `<div class="kaart leeg">Nog geen trainingsopkomst geregistreerd.<br>Zodra je op de Training-tab presentie bijhoudt, verschijnt hier per speler het opkomstpercentage.</div>`;

  const leegWed = `<div class="kaart leeg" style="margin-bottom:12px">Nog geen gespeelde wedstrijden.<br>Zodra je opstellingen maakt, verschijnt hier automatisch de speeltijd per speler.</div>`;

  let inhoud;
  if (blad === 'speel') inhoud = (heeftData ? '' : leegWed) + speelBlad();
  else if (blad === 'wed') inhoud = (heeftData ? '' : leegWed) + wedBlad();
  else inhoud = trBlad();

  return bladBalk + inhoud;
}

/* Koppelt de drie stats-blad-knoppen (speelminuten / wedstrijd / training).
   Aangeroepen vanuit teams.js nadat de Stats-tab is getekend. */
export function koppelStatsBlad(root){
  (root || document).querySelectorAll('[data-statsblad]').forEach(b => b.onclick = () => {
    S.statsBlad = b.dataset.statsblad;
    import('./teams.js?v=20260819j').then(m => m.renderTeam?.());
  });
}

/* ==================== WEERGAVE ==================== */
export function renderWedstrijd(){
  const w = S.wedstrijd; if (!w) return;
  /* Scrollpositie vasthouden: elke tik op een speler (of geplande wissel, doelpunt,
     enz.) tekent het hele wedstrijdscherm opnieuw. Zonder dit sprong de pagina
     naar boven — hinderlijk als je onderin bij de bank of het log bezig bent.
     De eerste keer binnenkomen scrollt toon('wedstrijd') zelf al naar boven, dus
     dit herstelt alleen bij hertekenen binnen hetzelfde scherm. */
  const bewaardeScroll = window.scrollY;
  w.goals ||= [];
  w.kaarten ||= [];
  const k = huidigKwart();
  const kFormatie = kwartFormatie(w, k);
  const slots = bouwSlots(w.format, kFormatie);
  const lineup = effectieveLineup(k);
  const opVeld = new Set(Object.values(lineup));
  const aKwart = analyseKwart(w, k);
  const aWed = analyseWedstrijd(w);
  const bank = (w.selectie||[]).filter(pid => !opVeld.has(pid) && speler(pid))
    .sort((a,b) => (aWed.tijd[a]||0) - (aWed.tijd[b]||0));

  const historie = {};
  for (let nr = 1; nr < Number(S.kwart); nr++){
    const kk = w.kwarten[nr];
    if (!kk || !kwartGespeeld(kk)) continue;
    const a = analyseKwart(w, kk);
    for (const pid of (w.selectie||[]))
      (historie[pid] ||= []).push({nr, speelde: (a.tijd[pid]||0) > 0});
  }
  const dotsHtml = pid => (historie[pid]||[]).length
    ? `<div class="dots">${historie[pid].map(h =>
        `<span class="dot ${h.speelde?'s':'b'}" title="${esc(periodeLabel(w, String(h.nr)))}: ${h.speelde?'gespeeld':'bank'}"></span>`).join('')}</div>`
    : '';

  const chipHtml = (pid, bron, slotId='') => {
    const sel = S.geselecteerd?.pid === pid;
    const aanv = w.aanvoerder === pid;
    // Vooraf ingestelde disciplinaire bankbeurt (start op de bank met straf)
    const straf = bron === 'bank' && (w.startBankReden||{})[pid]?.disciplinair;
    return `<div class="chip ${slotId==='K'?'keeper':''} ${sel?'geselecteerd':''} ${straf?'straf-chip':''}"
      data-chip="${pid}" data-bron="${bron}" data-chipslot="${slotId}">
      ${bron === 'bank' ? `<button class="chip-reden ${straf?'straf':''}" data-bankreden="${pid}" title="Reden bankbeurt">⚑</button>` : ''}
      <div class="shirt">${esc(spelerNr(pid))}${aanv ? '<span class="aanvoerder-band">C</span>' : ''}</div>
      <div class="naam">${esc(spelerNaam(pid))}</div>${dotsHtml(pid)}</div>`;
  };

  const inHuidigeW = g => !isToernooi(w) || toernooiWnr(w, g.kwart) === toernooiWnr(w);
  const voor = w.goals.filter(g => g.type==='voor' && inHuidigeW(g)).length;
  const tegen = w.goals.filter(g => g.type==='tegen' && inHuidigeW(g)).length;
  const tegenNaam = isToernooi(w)
    ? ((w.tegenstanders||{})[toernooiWnr(w)] || 'Tegenstander '+toernooiWnr(w))
    : w.tegenstander;
  const sbLinks  = w.thuis ? {naam:S.team.naam, n:voor, knop:'goalVoor'}  : {naam:tegenNaam, n:tegen, knop:'goalTegen'};
  const sbRechts = w.thuis ? {naam:tegenNaam, n:tegen, knop:'goalTegen'} : {naam:S.team.naam, n:voor, knop:'goalVoor'};

  const confroHtml = bouwConfrontatie(w);
  const teamEvalBestaand = (S.teamEvaluaties||[]).some(e => e.wedstrijdId === S.wedstrijdId);

  const v = $('#view-wedstrijd');
  v.innerHTML = `
    <div class="kop"><button class="terug" id="naarTeam">‹</button>
      <h1>${isToernooi(w)
        ? '🏆 '+esc(w.tegenstander)
        : (w.thuis ? esc(S.team.naam)+' – '+esc(w.tegenstander) : esc(w.tegenstander)+' – '+esc(S.team.naam))}
      <span class="sub">${datumNL(w.datum)} · ${isToernooi(w) ? w.toernooi.wedstrijden+' wedstrijden · ' : ''}<span id="subFormatieKlik" style="text-decoration:underline dotted;cursor:pointer">${esc(kFormatie)}</span></span></h1>
      <button class="terug opzet-knop" id="wInstellingen" title="Wedstrijd aanpassen">
        <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M12 3L20 6.5V11C20 15.5 16.9 19.7 12 21C7.1 19.7 4 15.5 4 11V6.5L12 3Z" stroke="var(--accent)" stroke-width="1.7" stroke-linejoin="round"/>
          <path d="M9 12L11 14L15.5 9.5" stroke="var(--accent)" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
        <span>Wijzig opzet</span>
      </button></div>
    <div class="kaart doelbanner" id="doelBanner" style="${w.doel
      ? 'background:rgba(226,52,47,.12);border-left:3px solid var(--accent)'
      : 'background:rgba(226,52,47,.10);border-left:3px dashed var(--accent)'};font-size:calc(13.5px * var(--fs));color:var(--ink);padding:10px 12px;margin-bottom:10px;cursor:pointer;display:flex;align-items:center;gap:8px">${w.doel
        ? `<span style="font-size:calc(16px * var(--fs))">🎯</span><span><b>Doel:</b> ${esc(w.doel)}</span>`
        : `<span style="font-size:calc(16px * var(--fs))">🎯</span><span><b>Wedstrijddoel kiezen</b> — tik hier om een doel voor vandaag te zetten <span style="color:var(--accent);font-weight:700">›</span></span>`}</div>
${confroHtml}
    <div class="scorebord v2">
      <div class="sb-rij">
        <button class="sb-goal" id="${sbLinks.knop}" title="Doelpunt ${esc(sbLinks.naam)}">⚽</button>
        <span class="sb-cijfers">${sbLinks.n} – ${sbRechts.n}</span>
        <button class="sb-goal" id="${sbRechts.knop}" title="Doelpunt ${esc(sbRechts.naam)}">⚽</button>
      </div>
      <div class="sb-namen">
        <span class="sb-team" ${!w.thuis && isToernooi(w) ? 'id="sbTegenNaam" style="text-decoration:underline dotted;cursor:pointer"' : ''}>${esc(sbLinks.naam)}</span>
        <span class="sb-team" ${w.thuis && isToernooi(w) ? 'id="sbTegenNaam" style="text-decoration:underline dotted;cursor:pointer"' : ''}>${esc(sbRechts.naam)}</span>
      </div>
    </div>

    ${opVeld.size > 0 && opVeld.size < slots.length ? `<div class="waarschuwing"><span>⚠️</span><span>Er staan ${opVeld.size} van ${slots.length} spelers op het veld — vul de opstelling aan.</span></div>` : ''}
    ${(w.selectie||[]).filter(pid => speler(pid)).length < slots.length ? `<div class="waarschuwing"><span>⚠️</span><span>Selectie heeft maar ${(w.selectie||[]).filter(pid => speler(pid)).length} spelers, je hebt er ${slots.length} nodig voor ${w.format} tegen ${w.format}.</span></div>` : ''}

    <div class="kwarten" style="${(w.periodes||4) > 5 ? 'flex-wrap:wrap' : ''}">${periodeNrs(w).map(nr => {
      const kk = w.kwarten[nr];
      return `<button data-kwart="${nr}" style="${(w.periodes||4) > 5 ? 'font-size:calc(14px * var(--fs));flex:1 1 20%;padding:8px 0' : ''}" class="${S.kwart===nr?'actief':''}">${periodeLabel(w, nr)}${kwartGespeeld(kk)?' •':''}</button>`;
    }).join('')}</div>

    ${(() => {
      /* Leeg kwart na een gespeeld kwart: expliciete overneem-keuze in plaats
         van de vroegere automatische kopie bij het aantikken van de tab —
         kijken naar een kwart mag nooit stilletjes data wijzigen. */
      const nr = Number(S.kwart);
      const vorig = w.kwarten[nr-1];
      if (nr <= 1 || opVeld.size > 0 || !vorig || !kwartGespeeld(vorig)) return '';
      return `<div class="kwart-leeg-actie"><span>${esc(periodeOmschrijving(w))} heeft nog geen opstelling.</span><button id="overneemVorigKwart">⧉ Eindopstelling ${esc(periodeLabel(w, String(nr-1)))} overnemen</button></div>`;
    })()}

    <div class="klok">
      <div><div class="tijd" id="klokTijd">${mmss(klokSec(k))}</div>
        <div class="label">${esc(periodeOmschrijving(w))} · max ${String(w.kwartduur).replace('.',',')} min</div></div>
      <div class="acties">
        <button id="kaartKnop" title="Kaart of straf">🟨</button>
        <button id="klokReset" title="Klok terugzetten">↺</button>
        <button id="klokNaarEinde" title="Spring naar eindtijd">⏭</button>
        <button id="klokStart" class="primair" title="${k.klok.running?'Pauze':'Start'}">${k.klok.running?'❚❚':'▶'}</button>
      </div>
    </div>

    ${(() => {
      if (Number(S.kwart) !== 1 || opVeld.size > 0) return '';
      const vorige = laatsteOpstelling(w.format);
      if (!vorige || vorige.bron?.id === S.wedstrijdId) return '';
      return `<button class="knop vol" id="neemVorigeOver" style="margin-bottom:10px;background:var(--surface-2);color:var(--ink);border:1px solid var(--line-d)">⧉ Opstelling vorige wedstrijd overnemen${vorige.bron.tegenstander ? ' (tegen '+esc(vorige.bron.tegenstander)+')' : ''}</button>`;
    })()}

    <div class="veld-wrap"><div class="veld" id="veld">
      <div class="veld-overlay">
        <span class="vo-badge">
          <span class="k">${esc(periodeLabel(w, S.kwart))}</span>
          <span class="f">${esc(kFormatie)}</span>
        </span>
        <button class="vo-knop" id="kwartFormatieKnop" title="Speelwijze van ${esc(periodeOmschrijving(w))} aanpassen">
          <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
            <path d="M4 7h11M4 12h16M4 17h8" stroke="#fff" stroke-width="2" stroke-linecap="round"/>
            <circle cx="18" cy="7" r="2.4" fill="#fff"/><circle cx="9" cy="17" r="2.4" fill="#fff"/>
          </svg>
          <span>Speelwijze</span>
        </button>
      </div>
      <div class="lijn midden"></div><div class="lijn cirkel"></div>
      <div class="lijn zestien-o"></div><div class="lijn vijf-o"></div>
      <div class="lijn zestien-b"></div><div class="lijn vijf-b"></div>
      ${slots.map(s => `
        <div class="slot ${s.id==='K'?'doel':''}" data-slot="${s.id}" style="left:${s.x}%;top:${s.y}%">
          ${lineup[s.id] ? chipHtml(lineup[s.id], 'veld', s.id) : `<div class="ring">${s.id}</div>`}
        </div>`).join('')}
    </div></div>

    <div class="bank" id="bank">
      <div class="bank-kop"><span class="t">Wissels</span>
        <span class="n">${bank.length} op de bank · <span class="sorteer">minst gespeeld eerst</span> · <button id="kiesSelectie" style="color:var(--fluo);font-weight:600;font-size:calc(12px * var(--fs));text-decoration:underline">selectie</button></span></div>
      <div class="bank-chips">${bank.length ? bank.map(pid => chipHtml(pid, 'bank')).join('')
        : `<div class="leeg-bank">Iedereen staat op het veld. Sleep een veldspeler hierheen om te wisselen.</div>`}</div>
      <div class="plan-lijst">
        ${(k.plan||[]).length ? `<div class="plan-kop">Geplande wissels</div>` : ''}
        ${(k.plan||[]).map((p,i) => `
          <div class="plan-item ${klokSec(k) >= p.min*60 ? 'nu' : ''}" data-plan-i="${i}">
            <span class="nr in">▲${esc(planInNr(p.in))}</span>
            <span class="nr uit">▼${esc(spelerNr(p.uit))}</span>
            <span>${esc(planInNaam(p.in))} voor ${esc(spelerNaam(p.uit))}</span>
            <span class="min">${String(p.min).replace('.',',')}'</span>
            <button class="pk ok" data-plan-uitvoer="${i}" title="Wissel nu doorvoeren">✓</button>
            <button class="pk weg" data-plan-weg="${i}" title="Geplande wissel verwijderen">✕</button>
          </div>`).join('')}
        <button class="plan-toevoegen" id="planWissel">+ Wissel plannen voor ${esc(periodeOmschrijving(w))}</button>
      </div>
    </div>

    ${(() => {
      const items = [
        ...k.events.map((e,i) => ({soort:'wissel', ...e, i})),
        ...w.goals.map((g,i) => ({soort:'goal', ...g, i})).filter(g => String(g.kwart) === S.kwart),
        ...(w.kaarten||[]).map((c,i) => ({soort:'kaart', ...c, i})).filter(c => String(c.kwart) === S.kwart),
      ].sort((a,b) => (a.sec||0) - (b.sec||0));
      if (!items.length) return '';
      return `<div class="log">
        <div class="sectie-kop">Gebeurtenissen ${esc(periodeOmschrijving(w))}</div>
        ${items.map(e => {
          if (e.soort === 'wissel'){
            const r = e.reden ? wisselReden(e.reden) : null;
            return `
            <div class="log-item">
              ${e.in ? `<span class="nr in">▲${esc(spelerNr(e.in))}</span>` : ''}
              ${e.uit ? `<span class="nr uit">▼${esc(spelerNr(e.uit))}</span>` : ''}
              <span>${e.in ? esc(spelerNaam(e.in)) : ''}${e.in && e.uit ? ' ↔ ' : ''}${e.uit ? esc(spelerNaam(e.uit)) : ''}</span>
              ${e.uit ? `<button class="wissel-reden-badge${r?'':' leeg'}${e.disciplinair?' disc':''}" data-reden-ev="${e.i}" title="Wisselreden ${r?'wijzigen':'toevoegen'}">${r ? r.emoji+' '+esc(r.label)+(e.disciplinair?' ⚑':'') : '+ reden'}</button>` : ''}
              <span class="min">${mmss(e.sec)}</span>
              <button class="verwijder" data-weg-ev="${e.i}" title="Wissel verwijderen">✕</button>
            </div>`;
          }
          if (e.soort === 'goal') return `
            <div class="log-item bewerkbaar" data-corrigeer-goal="${e.i}" title="Tik om te corrigeren">
              <span class="goal-bal">${e.type==='voor' ? '⚽' : '🥅'}</span>
              <span><b>${e.type==='voor' ? (e.pid ? esc(spelerNaam(e.pid)) : 'Doelpunt') : 'Tegendoelpunt'}</b></span>
              <span class="min">${mmss(e.sec)}</span>
              <span class="bewerk-hint">✎</span>
            </div>`;
          return `
            <div class="log-item kaart bewerkbaar ${e.type==='rood'?'rood':''}" ${e.auto?'':`data-corrigeer-kaart="${e.i}" title="Tik om te corrigeren"`}>
              <span class="goal-bal">${KAART_ICOON[e.type]}</span>
              <span><b>${esc(spelerNaam(e.pid))}</b> · ${esc(KAART_NAAM[e.type])}${e.type==='tijd' ? ' ('+Math.round(e.duur/60)+' min)' : ''}${e.auto?' (automatisch)':''}</span>
              <span class="min">${mmss(e.sec)}</span>
              ${e.auto ? '' : '<span class="bewerk-hint">✎</span>'}
            </div>`;
        }).join('')}
      </div>`;
    })()}

    <details class="uitklap"><summary>Speeltijd deze wedstrijd</summary>
      <div class="inhoud"><table class="stat-tabel">
        <thead><tr><th>Speler</th><th>${periodeLabel(w, S.kwart)}</th><th>Totaal</th><th>Keeper</th></tr></thead>
        <tbody>${(w.selectie||[]).filter(pid => speler(pid))
          .sort((a,b) => (aWed.tijd[b]||0) - (aWed.tijd[a]||0)).map(pid => { const aangepast = k.correcties && k.correcties[pid] != null; return `
          <tr><td class="naam-cel">${esc(spelerNaam(pid))}</td>
            <td class="bewerkbaar${aangepast?' aangepast':''}" data-corrigeer-speeltijd="${pid}" title="Tik om speeltijd deze periode aan te passen">${aKwart.tijd[pid] ? mmss(aKwart.tijd[pid]) : '—'}<span class="bewerk-hint">✎</span></td>
            <td class="tijd-cel">${aWed.tijd[pid] ? uurMin(aWed.tijd[pid]) : '—'}</td>
            <td>${aWed.keeper[pid] ? aWed.keeper[pid]+'×' : ''}</td></tr>`; }).join('')}
        </tbody></table></div>
      <p style="font-size:calc(12px * var(--fs));color:var(--ink-2);margin-top:8px;line-height:1.5">Tik op een speeltijd om die periode voor een speler handmatig te corrigeren — bijvoorbeeld als een wissel vergeten is door te voeren.</p>
    </details>

    <button class="knop fluo vol" id="wedstrijdKlaar" style="margin-top:16px">${ico('admin-save',16)} Opslaan &amp; terug naar team</button>
    <button class="knop secundair vol" id="toonVerslag" style="margin-top:10px">📋 Wedstrijdverslag</button>
    ${modAan('evaluaties') ? `<button class="knop secundair vol" id="teamEvalKnop" style="margin-top:10px">${teamEvalBestaand?'✓ Teamevaluatie bijwerken':'📈 Team evalueren'}</button>` : ''}
    <button class="knop destructief vol" id="wegWedstrijd" style="margin-top:14px">Wedstrijd verwijderen</button>`;

  /* ---- koppelingen ---- */
  v.querySelector('#naarTeam').onclick = () => history.back();
  v.querySelector('#wInstellingen').onclick = () => toonWijzigOpzet();
  v.querySelector('#doelBanner').onclick = () => toonWijzigOpzet('doel');
  v.querySelector('#subFormatieKlik').onclick = (e) => { e.stopPropagation(); toonKwartFormatie(); };
  { const kfk = v.querySelector('#kwartFormatieKnop'); if (kfk) kfk.onclick = toonKwartFormatie; }
  v.querySelectorAll('[data-kwart]').forEach(b => b.onclick = () => {
    /* Alleen van tab wisselen — geen automatische kopie meer; het lege kwart
       toont zelf een expliciete overneem-knop (kwart-leeg-actie). */
    S.kwart = b.dataset.kwart; S.geselecteerd = null;
    telNav('wedstrijd:kwart' + b.dataset.kwart, 'tab');
    renderWedstrijd();
  });
  v.querySelector('#goalVoor').onclick = modalGoalVoor;
  v.querySelector('#goalTegen').onclick = () => registreerGoal({type:'tegen'});
  v.querySelector('#kaartKnop').onclick = modalKaart;
  v.querySelector('#wedstrijdKlaar').onclick = () => {
    // Directe (flush) save — het meeste is al automatisch bewaard, maar dit
    // geeft de coach het vertrouwde "opslaan"-gevoel en dekt de laatste wijziging.
    clearTimeout(S.saveTimer);
    setDoc(doc(db,'teams',S.teamId,'wedstrijden',S.wedstrijdId), S.wedstrijd)
      .catch(e => meld('Opslaan mislukt: ' + e.code));
    meld('Wedstrijd opgeslagen');
    sluitWedstrijd('trainingen');
  };
  v.querySelector('#toonVerslag').onclick = modalVerslag;
  const teamEvalKnop = v.querySelector('#teamEvalKnop');
  if (teamEvalKnop) teamEvalKnop.onclick = () => {
    import('./teams.js?v=20260819j').then(m => m.modalTeamEvaluatie(S.wedstrijdId));
  };
  v.querySelectorAll('[data-corrigeer-goal]').forEach(b => b.onclick = e => {
    e.stopPropagation(); modalGoalCorrigeren(Number(b.dataset.corrigeerGoal));
  });
  v.querySelectorAll('[data-corrigeer-kaart]').forEach(b => b.onclick = e => {
    e.stopPropagation(); modalKaartCorrigeren(Number(b.dataset.corrigeerKaart));
  });
  const sbT = v.querySelector('#sbTegenNaam');
  if (sbT) sbT.onclick = () => {
    const wnr = toernooiWnr(w);
    openModal(`
      <h2>Tegenstander wedstrijd ${wnr}</h2>
      <p style="font-size:calc(13.5px * var(--fs));color:var(--ink-2);margin-bottom:12px">Vul de naam in zoals die op het wedstrijdschema staat.</p>
      <input class="invoer" id="mTegenNaam" value="${esc((w.tegenstanders||{})[wnr] || '')}" style="margin-bottom:14px">
      <div style="display:flex;gap:10px">
        <button class="knop secundair" id="mTegenNee" style="flex:1">Annuleren</button>
        <button class="knop fluo" id="mTegenJa" style="flex:1">Opslaan</button>
      </div>`);
    $('#mTegenNaam').focus();
    $('#mTegenNee').onclick = sluitModal;
    $('#mTegenJa').onclick = () => {
      (w.tegenstanders ||= {})[wnr] = $('#mTegenNaam').value.trim();
      sluitModal(); bewaarWedstrijd(); renderWedstrijd();
    };
  };
  v.querySelector('#klokStart').onclick = klokStartPauze;
  v.querySelector('#klokReset').onclick = () => {
    if (klokSec(k) < 1){ klokReset(); return; }
    openModal(`
      <h2>Klok terugzetten?</h2>
      <p style="font-size:calc(13.5px * var(--fs));color:var(--ink-2);line-height:1.5;margin-bottom:16px">Er is al <b style="color:var(--ink)">${mmss(klokSec(k))}</b> gespeeld in ${esc(periodeOmschrijving(w))}. De klok gaat terug naar 00:00 — geregistreerde wissels en doelpunten blijven staan.</p>
      <div style="display:flex;gap:10px">
        <button class="knop secundair" id="mResetNee" style="flex:1">Annuleren</button>
        <button class="knop fluo" id="mResetJa" style="flex:1">↺ Terugzetten</button>
      </div>`, {vorm:'dialoog'});
    $('#mResetNee').onclick = sluitModal;
    $('#mResetJa').onclick = () => { sluitModal(); klokReset(); };
  };
  v.querySelector('#klokNaarEinde').onclick = klokNaarEinde;
  const ovk = v.querySelector('#overneemVorigKwart'); if (ovk) ovk.onclick = kopieerVorigKwart;
  // (selectie-hint verwijderd op verzoek — gaf visuele ruis en veroorzaakte
  // een scroll-sprong doordat de pagina-hoogte veranderde bij het selecteren)

  /* Vorige confrontatie: regeltje klapt het paneel open/dicht (lokale UI-stand). */
  const confroRegel = v.querySelector('#confroRegel');
  if (confroRegel) confroRegel.onclick = () => {
    S._confroOpen = !S._confroOpen;
    v.querySelector('#confroRegel')?.classList.toggle('open', S._confroOpen);
    v.querySelector('#confroPaneel')?.classList.toggle('open', S._confroOpen);
  };
  const confroOpen = v.querySelector('#confroOpen');
  if (confroOpen) confroOpen.onclick = () => {
    const wid = confroOpen.dataset.wid;
    if (wid){ S._confroOpen = false; openWedstrijd(wid); }
  };
  const nvo = v.querySelector('#neemVorigeOver');
  if (nvo) nvo.onclick = () => {
    const vorige = laatsteOpstelling(w.format);
    if (!vorige){ meld('Geen vorige opstelling gevonden'); return; }
    const lineup = {};
    for (const [slot, pid] of Object.entries(vorige.lineup))
      if ((w.selectie||[]).includes(pid) && speler(pid)) lineup[slot] = pid;
    if (!Object.keys(lineup).length){ meld('Geen spelers uit de vorige opstelling zitten in deze selectie'); return; }
    w.kwarten['1'].lineup = lineup;
    if (formatieBestaat(w.format, vorige.formatie, eigenFormatiesVanTeam()) || parseFormatie(vorige.formatie, w.format)) w.formatie = vorige.formatie;
    S.kwart = '1';
    bewaarWedstrijd(); renderWedstrijd();
    meld(`Opstelling overgenomen${vorige.bron.tegenstander ? ' van wedstrijd tegen '+vorige.bron.tegenstander : ''} — pas aan waar nodig`);
  };
  v.querySelector('#kiesSelectie').onclick = modalSelectie;
  v.querySelector('#planWissel').onclick = modalPlanWissel;
  v.querySelectorAll('[data-plan-uitvoer]').forEach(b => b.onclick = e => { e.stopPropagation(); voerPlanUit(Number(b.dataset.planUitvoer)); });
  v.querySelectorAll('[data-plan-weg]').forEach(b => b.onclick = e => { e.stopPropagation(); (huidigKwart().plan||[]).splice(Number(b.dataset.planWeg),1); bewaarWedstrijd(); renderWedstrijd(); });
  v.querySelectorAll('[data-weg-ev]').forEach(b => b.onclick = e => { e.stopPropagation(); verwijderEvent(Number(b.dataset.wegEv)); });
  v.querySelectorAll('[data-reden-ev]').forEach(b => b.onclick = e => { e.stopPropagation(); modalWisselReden(huidigKwart(), Number(b.dataset.redenEv)); });
  v.querySelectorAll('[data-corrigeer-speeltijd]').forEach(td => td.onclick = e => {
    e.stopPropagation(); modalSpeeltijdCorrigeren(td.dataset.corrigeerSpeeltijd);
  });
  v.querySelector('#wegWedstrijd').onclick = async () => {
    if (!confirm('Deze wedstrijd en alle opstellingen verwijderen?')) return;
    await deleteDoc(doc(db,'teams',S.teamId,'wedstrijden',S.wedstrijdId));
    sluitWedstrijd();
  };

  clearInterval(S.klokInterval);
  if (k.klok.running) S.klokInterval = setInterval(tikKlok, 500);

  koppelSleep(v);

  /* Scrollpositie terugzetten na het hertekenen, zodat de coach niet steeds
     omhoog springt bij het selecteren van een speler. In een rAF zodat de
     browser eerst de nieuwe layout heeft berekend voordat we terugscrollen. */
  if (bewaardeScroll > 0) requestAnimationFrame(() => window.scrollTo(0, bewaardeScroll));
}

/* ==================== WEDSTRIJDINSTELLINGEN & SELECTIE ==================== */
/* ==================== WIJZIG OPZET (basisgegevens + speelwijze + doel & notitie) ====================
   Eén doorlopend top-paneel met alle drie onderdelen onder elkaar (i.p.v. los doorklikken via
   een menu). Klapt van bovenaf open — een bewuste keuze t.o.v. de bottom-sheet die de rest van
   de app gebruikt, omdat dit paneel bewust "zwaarder" mag voelen dan een snelle actie.
   sectie ('basis' | 'speelwijze' | 'doel') scrollt direct naar het juiste kopje wanneer je
   binnenkomt via een snelkoppeling (tik op de formatie of het doel-banner in het wedstrijdscherm). */
function toonWijzigOpzet(sectie){
  const w = S.wedstrijd;
  let format = w.format, formatie = w.formatie;

  $('#woPaneel').innerHTML = `
    <div class="wo-topbar"><h2>Wijzig opzet</h2><div class="wo-sluit" id="woSluit">✕</div></div>

    <div class="wo-sectiekop" id="woSecBasis"><span class="ico">📝</span><span>Basisgegevens</span><div class="wo-lijn"></div></div>
    <div class="veldgroep"><label>${isToernooi(w) ? 'Naam toernooi' : 'Tegenstander'}</label>
      <input class="invoer" id="woTegen" value="${esc(w.tegenstander)}"></div>
    <div class="rij">
      <div class="veldgroep"><label>Datum</label><input class="invoer" type="date" id="woDatum" value="${esc(w.datum)}"></div>
      <div class="veldgroep"><label>Minuten per periode</label><input class="invoer" id="woDuur" inputmode="decimal" value="${esc(w.kwartduur)}"></div>
    </div>
    <div class="veldgroep"><label>Aanvoerder</label>
      <select class="invoer" id="woAanvoerder">
        <option value="">— geen aanvoerder gekozen —</option>
        ${(w.selectie||[]).map(pid => speler(pid)).filter(Boolean)
          .map(p => `<option value="${p.id}" ${w.aanvoerder===p.id?'selected':''}>${esc(spelerNr(p.id))} · ${esc(p.naam)}</option>`).join('')}
      </select></div>

    <div class="wo-sectiekop" id="woSecSpeelwijze"><span class="ico">⚽</span><span>Speelwijze & formatie</span><div class="wo-lijn"></div></div>
    <div class="veldgroep"><label>Aantal spelers</label>
      <div class="segment" id="woFormat">${['4','6','8','9','11'].map(f =>
        `<button data-f="${f}" class="${w.format===f?'actief':''}">${f}×${f}</button>`).join('')}</div></div>
    <div class="veldgroep"><label>Formatie (excl. keeper)</label>
      <div class="segment wrap" id="woFormatie"></div>
      <div id="woEigen">${eigenFormatieInvoerHtml()}</div>
      <p style="font-size:calc(12px * var(--fs));color:var(--ink-2);margin-top:6px">Wijzig je het format, dan past de app de formatie automatisch aan en blijven spelers zoveel mogelijk op hun plek.</p>
      <div id="woFormatieHint"></div></div>

    <div class="wo-sectiekop" id="woSecDoel"><span class="ico">🎯</span><span>Doel & notitie</span><div class="wo-lijn"></div></div>
    <div class="veldgroep"><label>Wedstrijddoel</label>
      <input class="invoer" id="woDoel" value="${esc(w.doel||'')}" placeholder="Bijv. opbouw van achteruit, durven schieten">
      <div class="doel-suggesties" id="woDoelSug">
        ${doelSuggesties(S.team?.categorie).map(s => `<button type="button" data-doelsug="${esc(s)}">${esc(s)}</button>`).join('')}
      </div>
      <p style="font-size:calc(11px * var(--fs));color:var(--ink-2);margin-top:5px">💡 Suggesties op basis van de leercurve (§3.3) voor ${esc(S.team?.categorie||'dit team')} — tik om over te nemen, of typ je eigen doel.</p></div>
    <div class="veldgroep"><label>Notitie</label>
      <textarea class="invoer" id="woNotitie" rows="3" placeholder="Bijv. sterke counter, druk zetten op hun nr. 7. Zichtbaar bij de volgende keer tegen deze tegenstander.">${esc(w.notitie||'')}</textarea></div>

    <button class="knop vol fluo" id="woOk">Opslaan</button>`;
  $('#woAchter').classList.add('open');

  const toonFormatieHint = () => {
    const el = $('#woFormatieHint');
    if (!el) return;
    if (format !== '11'){ el.innerHTML = ''; return; }
    if (formatie === CLUB_FORMATIE_11){
      el.innerHTML = `<div class="formatie-hint match"><span class="fh-ico">✓</span><span><b>Sluit aan bij de clubvisie (§3.2).</b> Bij balbezit schuift één verdediger in naar het middenveld (1:3:4:3) voor een overtal — steeds een andere speler, zodat iedereen leert opbouwen.</span></div>`;
    } else {
      el.innerHTML = `<div class="formatie-hint info"><span class="fh-ico">💡</span><span>Het jeugdbeleidsplan gaat uit van <b>${esc(CLUB_FORMATIE_11)}</b> als basis (§3.2). Kies je bewust voor ${esc(formatie)}? Laat dan de vrije verdediger een opbouwende rol spelen, niet achter de mandekkers.</span></div>`;
    }
  };
  const efInvoer = koppelEigenFormatieInvoer($('#woEigen'), () => format, (naam) => {
    formatie = naam; vulFormaties(); toonFormatieHint();
  });
  const vulFormaties = () => {
    const namen = formatieNamen(format, eigenFormatiesVanTeam());
    $('#woFormatie').innerHTML = namen.map(f =>
      `<button data-f="${f}" class="${formatie===f?'actief':''}">${f}</button>`).join('') +
      `<button class="ef-knop" data-eigen="1">+ Eigen</button>`;
    $$('#woFormatie button[data-f]').forEach(b => b.onclick = () => {
      $$('#woFormatie button').forEach(x=>x.classList.remove('actief')); b.classList.add('actief'); formatie = b.dataset.f;
      toonFormatieHint();
    });
    const eb = $('#woFormatie button[data-eigen]');
    if (eb) eb.onclick = () => efInvoer.toonInvoer();
    toonFormatieHint();
  };
  vulFormaties();
  $$('#woFormat button').forEach(b => b.onclick = () => {
    $$('#woFormat button').forEach(x=>x.classList.remove('actief')); b.classList.add('actief');
    format = b.dataset.f;
    if (!formatieBestaat(format, formatie, eigenFormatiesVanTeam())) formatie = Object.keys(FORMATIES[format])[0];
    vulFormaties();
  });

  $$('#woDoelSug [data-doelsug]').forEach(b => b.onclick = () => { $('#woDoel').value = b.dataset.doelsug; });

  $('#woSluit').onclick = verbergWijzigOpzet;
  $('#woAchter').onclick = (e) => { if (e.target.id === 'woAchter') verbergWijzigOpzet(); };

  $('#woOk').onclick = () => {
    w.tegenstander = $('#woTegen').value.trim() || w.tegenstander;
    w.datum = $('#woDatum').value || w.datum;
    w.kwartduur = parseFloat(($('#woDuur').value||'').replace(',','.')) || w.kwartduur;
    w.aanvoerder = $('#woAanvoerder').value || null;
    if (format !== w.format || formatie !== w.formatie){
      const nieuweIds = new Set(bouwSlots(format, formatie).map(s => s.id));
      for (const kk of Object.values(w.kwarten)){
        for (const slot of Object.keys(kk.lineup)) if (!nieuweIds.has(slot)) delete kk.lineup[slot];
        kk.events = kk.events.filter(e => nieuweIds.has(e.slot));
      }
      w.format = format; w.formatie = formatie;
    }
    w.doel = $('#woDoel').value.trim();
    w.notitie = $('#woNotitie').value.trim();
    verbergWijzigOpzet();
    bewaarWedstrijd();
    renderWedstrijd();
  };

  if (sectie){
    const anker = {basis:'woSecBasis', speelwijze:'woSecSpeelwijze', doel:'woSecDoel'}[sectie];
    if (anker) requestAnimationFrame(() => $(`#${anker}`)?.scrollIntoView({block:'start'}));
  }
}

/* Kwart-formatie kiezer (bottom-sheet). Wijzigt ALLEEN de speelwijze van het
   actieve kwart; andere kwarten blijven ongemoeid. Spelers schuiven zoveel
   mogelijk mee naar hun plek (zie herplaatsKwart). Bereikbaar via de knop in
   de balk boven het veld én via de onderstreepte formatie onder de titel. */
function toonKwartFormatie(){
  const w = S.wedstrijd; if (!w) return;
  const k = huidigKwart();
  const huidig = kwartFormatie(w, k);
  let gekozen = huidig;
  const kwartTekst = periodeOmschrijving(w);

  const el = document.createElement('div');
  el.className = 'kf-achter';
  el.innerHTML = `
    <div class="kf-sheet">
      <div class="kf-greep"></div>
      <h2>Speelwijze ${esc(periodeLabel(w, S.kwart))}</h2>
      <p class="kf-sub">Alleen de speelwijze van <b>${esc(kwartTekst)}</b> verandert. Andere ${esc((w.periodes||4)===2?'helften':'kwarten')} blijven staan. Opgestelde spelers schuiven zoveel mogelijk mee naar hun plek.</p>
      <div class="kf-grid">${formatieNamen(w.format, eigenFormatiesVanTeam()).map(f =>
        `<button data-f="${esc(f)}" class="${f===huidig?'actief':''}">${esc(f)}</button>`).join('')}<button class="ef-knop kf-eigen" data-eigen="1">+ Eigen</button></div>
      <div id="kfEigen">${eigenFormatieInvoerHtml()}</div>
      <div class="kf-acties">
        <button class="kf-annuleer" id="kfAnnuleer">Annuleren</button>
        <button class="kf-ok" id="kfOk">Toepassen op dit ${esc((w.periodes||4)===2?'helft':'kwart')}</button>
      </div>
    </div>`;
  document.body.appendChild(el);
  requestAnimationFrame(() => el.classList.add('open'));

  const sluit = () => { el.classList.remove('open'); setTimeout(() => el.remove(), 220); };

  const efKwart = koppelEigenFormatieInvoer(el.querySelector('#kfEigen'), () => w.format, (naam) => {
    gekozen = naam; vulGrid();
  });
  const bindGrid = () => {
    el.querySelectorAll('.kf-grid button[data-f]').forEach(b => b.onclick = () => {
      el.querySelectorAll('.kf-grid button').forEach(x => x.classList.remove('actief'));
      b.classList.add('actief'); gekozen = b.dataset.f;
    });
    const eb = el.querySelector('.kf-grid button[data-eigen]');
    if (eb) eb.onclick = () => efKwart.toonInvoer();
  };
  const vulGrid = () => {
    el.querySelector('.kf-grid').innerHTML = formatieNamen(w.format, eigenFormatiesVanTeam()).map(f =>
      `<button data-f="${esc(f)}" class="${f===gekozen?'actief':''}">${esc(f)}</button>`).join('') +
      `<button class="ef-knop kf-eigen" data-eigen="1">+ Eigen</button>`;
    bindGrid();
  };
  bindGrid();
  el.querySelector('#kfAnnuleer').onclick = sluit;
  el.onclick = (e) => { if (e.target === el) sluit(); };
  el.querySelector('#kfOk').onclick = () => {
    if (gekozen !== huidig && formatieBestaat(w.format, gekozen, eigenFormatiesVanTeam())){
      herplaatsKwart(w, k, gekozen);
      bewaarWedstrijd();
      sluit();
      renderWedstrijd();
      meld(`Speelwijze ${periodeOmschrijving(w)} → ${gekozen}`);
    } else {
      sluit();
    }
  };
}

function verbergWijzigOpzet(){
  const el = $('#woAchter');
  if (!el) return;
  el.classList.remove('open');
}

function modalSelectie(){
  const w = S.wedstrijd;
  let sel = new Set(w.selectie || []);
  // afwezig-redenen op de wedstrijd; kopie zodat annuleren niks wijzigt
  let redenen = JSON.parse(JSON.stringify(w.afwezigRedenen || {}));

  const rijenHtml = () => S.spelers.map(p => {
    const aanwezig = sel.has(p.id);
    const info = redenen[p.id] ? afwezigRedenInfo(redenen[p.id]) : null;
    return `
    <div class="pres-speler ${aanwezig?'aanwezig':'afwezig'}">
      <button type="button" class="pres-speler-kop" data-seltoggle="${p.id}">
        <span class="pres-shirt">${esc(p.nummer ?? '·')}</span>
        <span class="pres-naam">${esc(p.naam)}</span>
        <span class="pres-status">${aanwezig?'Erbij':'Afwezig'}</span>
      </button>
      ${!aanwezig ? `
      <div class="pres-reden-rij">${AFWEZIG_REDENEN.map(r =>
        `<button type="button" class="pres-reden-chip ${info?.id===r.id?'actief':''}" data-selreden="${r.id}" data-pid="${p.id}">${r.ico?ico(r.ico,16):r.emoji} ${r.label}</button>`).join('')}</div>
      ${info?.id==='anders' || (info && redenen[p.id]?.notitie) ? `<input class="invoer pres-reden-notitie" data-pid="${p.id}" placeholder="Toelichting (optioneel)" value="${esc(redenen[p.id]?.notitie||'')}">` : ''}
      ` : ''}
    </div>`;
  }).join('');

  openModal(`
    <h2>Selectie voor deze wedstrijd</h2>
    <p style="font-size:calc(13.5px * var(--fs));color:var(--ink-2);margin-bottom:12px">Iedereen staat op <b>erbij</b>. Tik wie er <b>niet</b> is en geef eventueel de reden. Afwezige spelers verschijnen niet op de bank.</p>
    <div id="mSelLijst">${rijenHtml()}</div>
    <button class="knop vol" id="mSelOk" style="margin-top:6px">Klaar</button>`);

  const koppel = () => {
    $$('#mSelLijst [data-seltoggle]').forEach(b => b.onclick = () => {
      const id = b.dataset.seltoggle;
      if (sel.has(id)){ sel.delete(id); }
      else { sel.add(id); delete redenen[id]; }
      $('#mSelLijst').innerHTML = rijenHtml(); koppel();
    });
    $$('#mSelLijst [data-selreden]').forEach(b => b.onclick = () => {
      const id = b.dataset.pid, type = b.dataset.selreden;
      const huidig = redenen[id];
      if (huidig && afwezigRedenInfo(huidig).id === type) delete redenen[id];
      else redenen[id] = {type, notitie: huidig?.notitie || ''};
      $('#mSelLijst').innerHTML = rijenHtml(); koppel();
    });
    $$('#mSelLijst .pres-reden-notitie').forEach(inp => inp.oninput = () => {
      const id = inp.dataset.pid;
      if (redenen[id]) redenen[id].notitie = inp.value;
    });
  };
  koppel();

  $('#mSelOk').onclick = () => {
    w.selectie = [...sel];
    // alleen redenen bewaren van wie ook echt afwezig is
    const schoon = {};
    for (const [pid, r] of Object.entries(redenen)) if (!sel.has(pid)) schoon[pid] = r;
    w.afwezigRedenen = schoon;
    telGebruik('selectie_kiezen');
    const toegestaan = new Set(w.selectie);
    for (const kk of Object.values(w.kwarten)){
      for (const [slot, pid] of Object.entries(kk.lineup)) if (!toegestaan.has(pid)) delete kk.lineup[slot];
      kk.events = kk.events.filter(e => (!e.in || toegestaan.has(e.in)) && (!e.uit || toegestaan.has(e.uit)));
      kk.plan = (kk.plan||[]).filter(p => (p.in === WISSEL_BEURT || toegestaan.has(p.in)) && toegestaan.has(p.uit));
    }
    w.kaarten = (w.kaarten||[]).filter(c => toegestaan.has(c.pid));
    if (w.aanvoerder && !toegestaan.has(w.aanvoerder)) w.aanvoerder = null;
    sluitModal(); bewaarWedstrijd(); renderWedstrijd();
  };
}

/* ==================== TIKKEN (geen slepen meer — verticaal scrollen blijft werken) ==================== */
function koppelSleep(v){
  const veld = v.querySelector('#veld');
  const bank = v.querySelector('#bank');

  // tik op een chip: selecteer/deselecteer, of wissel met al-geselecteerde speler
  v.querySelectorAll('[data-chip]').forEach(chip => {
    chip.addEventListener('click', ev => {
      ev.stopPropagation();
      const pid = chip.dataset.chip;
      const bron = chip.dataset.bron;
      if (S.geselecteerd && S.geselecteerd.pid !== pid){
        // staat de getikte speler op het veld? dan ruilen we van plek
        const k = huidigKwart(), l = effectieveLineup(k);
        const slot = Object.keys(l).find(s => l[s] === pid);
        if (slot){ plaats(S.geselecteerd.pid, slot); return; }
      }
      S.geselecteerd = S.geselecteerd?.pid === pid ? null : {pid, bron};
      renderWedstrijd();
    });
  });

  v.querySelectorAll('[data-bankreden]').forEach(b => b.addEventListener('click', ev => {
    ev.stopPropagation();
    modalStartBankReden(b.dataset.bankreden);
  }));

  // tik op een leeg veldvak: plaats de geselecteerde speler daar
  veld.querySelectorAll('.slot').forEach(slot => {
    slot.addEventListener('click', ev => {
      if (!S.geselecteerd) return;
      if (ev.target.closest('[data-chip]')) return;
      plaats(S.geselecteerd.pid, slot.dataset.slot);
    });
  });

  // tik op de bank: haal de geselecteerde veldspeler naar de bank
  bank.addEventListener('click', ev => {
    if (!S.geselecteerd || S.geselecteerd.bron !== 'veld') return;
    if (ev.target.closest('[data-chip],button')) return;
    naarBank(S.geselecteerd.pid);
  });
}
