import {
  db, collection, doc, addDoc, setDoc, deleteDoc, onSnapshot, serverTimestamp
} from './firebase.js';
import {
  S, $, $$, esc, meld, mmss, uurMin, datumNL, speler, spelerNaam, spelerNr,
  openModal, sluitModal, toon, stopUnsubs
} from './state.js';
import {
  FORMATIES, LIJN_NAAM, bouwSlots, slotLijn, catInfo, isToernooi,
  tijdstrafSec, KAART_ICOON, KAART_NAAM,
  periodeNaam, periodeNrs, periodeLabel, toernooiWnr, periodeOmschrijving,
  CLUB_FORMATIE_11, doelSuggesties
} from './config.js';
import { kwartGespeeld, effectieveLineup, analyseKwart, analyseWedstrijd } from './analyse.js';

/* ==================== AANMAKEN ==================== */
function leegKwart(){ return {lineup:{}, events:[], plan:[], klok:{base:0, running:false, start:0}}; }

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
    ${cat ? `<p style="font-size:12.5px;color:var(--ink-2);margin-bottom:12px">KNVB ${esc(S.team.categorie)}: ${esc(cat.knvb)} — standaarden zijn ingevuld.</p>` : ''}

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
        <span style="display:block;font-size:11.5px;color:var(--ink-2);font-weight:400" id="mWOvernemenInfo"></span></div>
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
        if (FORMATIES[format][vorige.formatie]) formatie = vorige.formatie;
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
      seizoen: S.huidigSeizoen,
      gemaakt: serverTimestamp(),
    });
    const ref = await addDoc(collection(db,'teams',S.teamId,'wedstrijden'), w);
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
  if (!w.formatie || !FORMATIES[w.format][w.formatie]){
    w.formatie = Object.keys(FORMATIES[w.format])[0]; veranderd = true;
  }
  if (!w.kwarten || typeof w.kwarten !== 'object' || !Object.keys(w.kwarten).length){
    const kwarten = {};
    for (let i = 1; i <= w.periodes; i++) kwarten[i] = leegKwart();
    w.kwarten = kwarten; veranderd = true;
  }
  if (!Array.isArray(w.goals)){ w.goals = []; veranderd = true; }
  if (!Array.isArray(w.kaarten)){ w.kaarten = []; veranderd = true; }
  if (!Array.isArray(w.selectie) || !w.selectie.length){ w.selectie = S.spelers.map(p => p.id); veranderd = true; }
  return veranderd;
}

export function openWedstrijd(wid){
  S.wedstrijdId = wid; S.kwart = '1'; S.geselecteerd = null; S._confroOpen = false;
  stopUnsubs('wedstrijd');
  S.unsub.wedstrijd = onSnapshot(doc(db,'teams',S.teamId,'wedstrijden',wid), snap => {
    if (!snap.exists()){ sluitWedstrijd(); return; }
    if (snap.metadata.hasPendingWrites) return;
    if (Date.now() - S.lokaalTot < 1800) return;
    const data = snap.data();
    const aangevuld = normaliseerWedstrijd(data);
    S.wedstrijd = data;
    renderWedstrijd();
    if (aangevuld) bewaarWedstrijd();
  }, (err) => {
    console.error(`[Cluppie] Listener "wedstrijd" kon niet lezen (teamId=${S.teamId}, wid=${wid}):`, err.code, err.message);
    if (err.code === 'permission-denied') meld('Geen toegang tot deze wedstrijd — controleer de Firestore-rules');
  });
  toon('wedstrijd');
}
export function sluitWedstrijd(){
  stopUnsubs('wedstrijd');
  clearInterval(S.klokInterval); S.klokInterval = null;
  S.wedstrijd = null; S.wedstrijdId = null;
  import('./teams.js').then(m => { m.renderTeam(); toon('team'); });
}
function bewaarWedstrijd(){
  S.lokaalTot = Date.now();
  clearTimeout(S.saveTimer);
  S.saveTimer = setTimeout(() => {
    setDoc(doc(db,'teams',S.teamId,'wedstrijden',S.wedstrijdId), S.wedstrijd)
      .catch(e => meld('Opslaan mislukt: ' + e.code));
  }, 600);
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
      meld(`Geplande wissel: ${spelerNaam(p.in)} erin voor ${spelerNaam(p.uit)}`);
    }
  });
}

/* ==================== GEPLANDE WISSELS ==================== */
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
      <select class="invoer" id="mPlanIn">${bankSpelers.map(optie).join('')}</select></div>
    <div class="veldgroep"><label>Eruit (van het veld)</label>
      <select class="invoer" id="mPlanUit">${veldSpelers.map(optie).join('')}</select></div>
    <div class="veldgroep"><label>Na hoeveel minuten</label>
      <input class="invoer" id="mPlanMin" inputmode="decimal" value="${Math.round(S.wedstrijd.kwartduur/2)}"></div>
    <button class="knop vol" id="mPlanOk">Wissel inplannen</button>
    <p style="font-size:12.5px;color:var(--ink-2);margin-top:10px;line-height:1.5">Zodra de kwartklok dit moment passeert, licht de wissel op in het wisselvak. Tik dan op ✓ om hem door te voeren — de echte wisseltijd wordt geregistreerd.</p>`);
  $('#mPlanOk').onclick = () => {
    const min = parseFloat(($('#mPlanMin').value||'').replace(',','.'));
    if (!(min >= 0)) return meld('Vul een geldig aantal minuten in');
    const k2 = huidigKwart();
    (k2.plan ||= []).push({in: $('#mPlanIn').value, uit: $('#mPlanUit').value, min});
    k2.plan.sort((a,b) => a.min - b.min);
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
  if (Object.values(l).includes(p.in)) return meld(`${spelerNaam(p.in)} staat al op het veld`);
  if (kwartLive(k)){
    const sec = Math.round(klokSec(k));
    k.events.push({in: p.in, uit: p.uit, slot, sec});
    meld(`${spelerNaam(p.in)} erin, ${spelerNaam(p.uit)} eruit · ${mmss(sec)}`);
  } else {
    k.lineup[slot] = p.in;
    for (const e of k.events) if (e.in === p.uit && e.slot === slot) e.in = p.in;
  }
  k.plan.splice(i,1);
  bewaarWedstrijd(); renderWedstrijd();
}

/* ==================== DOELPUNTEN ==================== */
function registreerGoal({type, pid = null}){
  const w = S.wedstrijd;
  const sec = Math.round(klokSec(huidigKwart()));
  (w.goals ||= []).push({type, pid, kwart: S.kwart, sec});
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
    <p style="font-size:13.5px;color:var(--ink-2);margin-bottom:14px">Nu geregistreerd als <b>${esc(huidigeOmschrijving)}</b> op ${mmss(g.sec||0)}.</p>
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
      <p style="font-size:13.5px;color:var(--ink);margin-bottom:4px">Dit staat als doelpunt voor de tegenstander.</p>
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
    <p style="font-size:12.5px;color:var(--ink-2);margin-bottom:14px;line-height:1.5">
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
    <p style="font-size:13.5px;color:var(--ink-2);margin-bottom:14px">Nu: <b>${esc(KAART_NAAM[c.type])}</b> voor <b>${esc(spelerNaam(c.pid))}</b> op ${mmss(c.sec||0)}.</p>
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

function modalVerslag(){
  const tekst = genereerVerslag();
  openModal(`
    <h2>📋 Wedstrijdverslag</h2>
    <textarea class="invoer" id="mVTekst" style="min-height:280px;font-family:inherit;line-height:1.55;resize:vertical;font-size:13.5px">${esc(tekst)}</textarea>
    <p style="font-size:12px;color:var(--ink-2);margin:8px 0 14px">Je kunt de tekst nog aanpassen voordat je hem deelt.</p>
    <button class="knop vol" id="mVDeel">📤 Delen / kopiëren</button>`);
  $('#mVDeel').onclick = async () => {
    const t = $('#mVTekst').value;
    try {
      if (navigator.share) await navigator.share({title:'Wedstrijdverslag', text:t});
      else { await navigator.clipboard.writeText(t); meld('Verslag gekopieerd'); }
    } catch { try { await navigator.clipboard.writeText(t); meld('Verslag gekopieerd'); } catch { meld('Kon niet kopiëren'); } }
  };
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
    if (bezet) meld(`${spelerNaam(pid)} erin, ${spelerNaam(bezet)} eruit · ${mmss(sec)}`);
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
    meld(`${spelerNaam(pid)} eruit · ${mmss(sec)}`);
  } else delete k.lineup[slot];
  S.geselecteerd = null;
  bewaarWedstrijd(); renderWedstrijd();
}
function verwijderEvent(i){
  huidigKwart().events.splice(i,1);
  bewaarWedstrijd(); renderWedstrijd();
}
function kopieerVorigKwart(){
  const nr = Number(S.kwart);
  if (nr === 1) return;
  const vorig = S.wedstrijd.kwarten[nr-1];
  huidigKwart().lineup = effectieveLineup(vorig);
  bewaarWedstrijd(); renderWedstrijd();
  meld('Eindopstelling van kwart ' + (nr-1) + ' overgenomen');
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
  const rijen = [...S.spelers].sort((a,b) => (tot.tijd[b.id]||0) - (tot.tijd[a.id]||0));
  const heeftData = Object.keys(tot.tijd).length > 0;

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
  return `
    ${heeftData ? '' : `<div class="kaart leeg" style="margin-bottom:12px">Nog geen gespeelde wedstrijden.<br>Zodra je opstellingen maakt, verschijnt hier automatisch de speeltijd per speler.</div>`}
    <table class="stat-tabel">
      <thead><tr><th>Speler</th><th>Wed.</th><th>Speeltijd</th><th>⚽</th><th>C</th><th>K</th><th>🟨</th><th>🟥</th>${toonOpkomst?'<th>Tr.</th>':''}</tr></thead>
      <tbody>${rijen.map(p => `<tr>
          <td class="naam-cel">${esc(p.naam)}</td>
          <td>${tot.wedstrijden[p.id]||0}</td>
          <td class="tijd-cel">${tot.tijd[p.id] ? uurMin(tot.tijd[p.id]) : '—'}</td>
          <td style="font-weight:700">${tot.goals[p.id]||0}</td>
          <td>${tot.aanv[p.id] ? tot.aanv[p.id]+'×' : ''}</td>
          <td>${tot.keeper[p.id]||0}</td>
          <td>${tot.geel[p.id]||0}</td>
          <td>${tot.rood[p.id]||0}</td>${toonOpkomst?`<td class="opkomst-cel ${opkomst[p.id]>=80?'goed':opkomst[p.id]>=50?'matig':'laag'}">${opkomst[p.id]}%</td>`:''}</tr>`).join('')}</tbody>
    </table>
    <p style="font-size:12px;color:var(--ink-2);margin-top:10px;line-height:1.5">
      ⚽ doelpunten · <b>C</b> aanvoerdersbeurten · <b>K</b> periodes als keeper · 🟨 gele kaarten · 🟥 rode kaarten${toonOpkomst?' · <b>Tr.</b> opkomst training ('+totTrainingen+' geregistreerd)':''}.
      Speeltijd komt van de kwartklok; zonder klok telt de ingestelde periodeduur.</p>`;
}

/* ==================== WEERGAVE ==================== */
export function renderWedstrijd(){
  const w = S.wedstrijd; if (!w) return;
  w.goals ||= [];
  w.kaarten ||= [];
  const k = huidigKwart();
  const slots = bouwSlots(w.format, w.formatie);
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
    return `<div class="chip ${slotId==='K'?'keeper':''} ${sel?'geselecteerd':''}"
      data-chip="${pid}" data-bron="${bron}" data-chipslot="${slotId}">
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
      <span class="sub">${datumNL(w.datum)} · ${isToernooi(w) ? w.toernooi.wedstrijden+' wedstrijden · ' : ''}<span id="subFormatieKlik" style="text-decoration:underline dotted;cursor:pointer">${esc(w.formatie)}</span></span></h1>
      <button class="terug" id="wInstellingen" title="Wedstrijd aanpassen">⚙️</button></div>
    <div class="kaart doelbanner" id="doelBanner" style="${w.doel
      ? 'background:rgba(226,6,19,.08);border-left:3px solid var(--grass)'
      : 'background:var(--surface-2);border-left:3px dashed var(--line-d)'};font-size:13.5px;color:${w.doel?'var(--ink)':'var(--ink-2)'};padding:9px 12px;margin-bottom:10px;cursor:pointer">${w.doel ? `<b>🎯 Doel:</b> ${esc(w.doel)}` : '🎯 Nog geen wedstrijddoel gezet — tik om er een te kiezen'}</div>
${confroHtml}
    <div class="scorebord">
      <button class="sb-goal" id="${sbLinks.knop}" title="Doelpunt ${esc(sbLinks.naam)}">⚽</button>
      <span class="sb-team" ${!w.thuis && isToernooi(w) ? 'id="sbTegenNaam" style="text-decoration:underline dotted;cursor:pointer"' : ''}>${esc(sbLinks.naam)}</span>
      <span class="sb-cijfers">${sbLinks.n} – ${sbRechts.n}</span>
      <span class="sb-team" ${w.thuis && isToernooi(w) ? 'id="sbTegenNaam" style="text-decoration:underline dotted;cursor:pointer"' : ''}>${esc(sbRechts.naam)}</span>
      <button class="sb-goal" id="${sbRechts.knop}" title="Doelpunt ${esc(sbRechts.naam)}">⚽</button>
      <button class="sb-goal kaart-knop" id="kaartKnop" title="Kaart of straf">🟨</button>
    </div>

    ${opVeld.size > 0 && opVeld.size < slots.length ? `<div class="kaart" style="background:#FFF3CD;color:#8B6F00;font-size:13px;padding:9px 12px;margin-bottom:10px">⚠️ Er staan ${opVeld.size} van ${slots.length} spelers op het veld — vul de opstelling aan.</div>` : ''}
    ${(w.selectie||[]).filter(pid => speler(pid)).length < slots.length ? `<div class="kaart" style="background:#FFF3CD;color:#8B6F00;font-size:13px;padding:9px 12px;margin-bottom:10px">⚠️ Selectie heeft maar ${(w.selectie||[]).filter(pid => speler(pid)).length} spelers, je hebt er ${slots.length} nodig voor ${w.format} tegen ${w.format}.</div>` : ''}

    <div class="kwarten" style="${(w.periodes||4) > 5 ? 'flex-wrap:wrap' : ''}">${periodeNrs(w).map(nr => {
      const kk = w.kwarten[nr];
      return `<button data-kwart="${nr}" style="${(w.periodes||4) > 5 ? 'font-size:14px;flex:1 1 20%;padding:8px 0' : ''}" class="${S.kwart===nr?'actief':''}">${periodeLabel(w, nr)}${kwartGespeeld(kk)?' •':''}</button>`;
    }).join('')}</div>

    <div class="klok">
      <div><div class="tijd" id="klokTijd">${mmss(klokSec(k))}</div>
        <div class="label">${esc(periodeOmschrijving(w))} · max ${String(w.kwartduur).replace('.',',')} min</div></div>
      <div class="acties">
        ${Number(S.kwart) > 1 && !kwartGespeeld(k) ? `<button id="kopieerKwart" title="Eindopstelling vorig kwart overnemen">⧉</button>` : ''}
        <button id="klokReset" title="Klok terugzetten">↺</button>
        <button id="klokStart" class="primair" title="${k.klok.running?'Pauze':'Start'}">${k.klok.running?'❚❚':'▶'}</button>
      </div>
    </div>

    ${(() => {
      if (Number(S.kwart) !== 1 || opVeld.size > 0) return '';
      const vorige = laatsteOpstelling(w.format);
      if (!vorige || vorige.bron?.id === S.wedstrijdId) return '';
      return `<button class="knop vol" id="neemVorigeOver" style="margin-bottom:10px;background:var(--ink);color:#fff">⧉ Opstelling vorige wedstrijd overnemen${vorige.bron.tegenstander ? ' (tegen '+esc(vorige.bron.tegenstander)+')' : ''}</button>`;
    })()}

    <div class="veld-wrap"><div class="veld" id="veld">
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
        <span class="n">${bank.length} op de bank · <button id="kiesSelectie" style="color:var(--fluo);font-weight:600;font-size:12px;text-decoration:underline">selectie</button></span></div>
      <div class="bank-chips">${bank.length ? bank.map(pid => chipHtml(pid, 'bank')).join('')
        : `<div class="leeg-bank">Iedereen staat op het veld. Sleep een veldspeler hierheen om te wisselen.</div>`}</div>
      <div class="plan-lijst">
        ${(k.plan||[]).length ? `<div class="plan-kop">Geplande wissels</div>` : ''}
        ${(k.plan||[]).map((p,i) => `
          <div class="plan-item ${klokSec(k) >= p.min*60 ? 'nu' : ''}" data-plan-i="${i}">
            <span class="nr in">▲${esc(spelerNr(p.in))}</span>
            <span class="nr uit">▼${esc(spelerNr(p.uit))}</span>
            <span>${esc(spelerNaam(p.in))} voor ${esc(spelerNaam(p.uit))}</span>
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
          if (e.soort === 'wissel') return `
            <div class="log-item">
              ${e.in ? `<span class="nr in">▲${esc(spelerNr(e.in))}</span>` : ''}
              ${e.uit ? `<span class="nr uit">▼${esc(spelerNr(e.uit))}</span>` : ''}
              <span>${e.in ? esc(spelerNaam(e.in)) : ''}${e.in && e.uit ? ' ↔ ' : ''}${e.uit ? esc(spelerNaam(e.uit)) : ''}</span>
              <span class="min">${mmss(e.sec)}</span>
              <button class="verwijder" data-weg-ev="${e.i}" title="Wissel verwijderen">✕</button>
            </div>`;
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
          .sort((a,b) => (aWed.tijd[b]||0) - (aWed.tijd[a]||0)).map(pid => `
          <tr><td class="naam-cel">${esc(spelerNaam(pid))}</td>
            <td>${aKwart.tijd[pid] ? mmss(aKwart.tijd[pid]) : '—'}</td>
            <td class="tijd-cel">${aWed.tijd[pid] ? uurMin(aWed.tijd[pid]) : '—'}</td>
            <td>${aWed.keeper[pid] ? aWed.keeper[pid]+'×' : ''}</td></tr>`).join('')}
        </tbody></table></div>
    </details>

    <button class="knop vol" id="toonVerslag" style="margin-top:16px">📋 Wedstrijdverslag</button>
    <button class="knop ${teamEvalBestaand?'licht':'fluo'} vol" id="teamEvalKnop" style="margin-top:10px">${teamEvalBestaand?'✓ Teamevaluatie bijwerken':'📈 Team evalueren'}</button>
    <button class="knop gevaar vol" id="wegWedstrijd" style="margin-top:10px">Wedstrijd verwijderen</button>`;

  /* ---- koppelingen ---- */
  v.querySelector('#naarTeam').onclick = () => history.back();
  v.querySelector('#wInstellingen').onclick = modalWedstrijdMenu;
  v.querySelector('#doelBanner').onclick = () => modalDoelNotitie(false);
  v.querySelector('#subFormatieKlik').onclick = (e) => { e.stopPropagation(); modalSpeelwijze(false); };
  v.querySelectorAll('[data-kwart]').forEach(b => b.onclick = () => {
    S.kwart = b.dataset.kwart; S.geselecteerd = null;
    const nr = Number(S.kwart);
    const doelK = huidigKwart();
    const vorig = w.kwarten[nr-1];
    if (nr > 1 && !kwartGespeeld(doelK) && vorig && kwartGespeeld(vorig)){
      doelK.lineup = effectieveLineup(vorig);
      bewaarWedstrijd();
      meld(`Eindopstelling ${periodeOmschrijving(w, String(nr-1))} overgenomen — pas aan waar nodig`);
    }
    renderWedstrijd();
  });
  v.querySelector('#goalVoor').onclick = modalGoalVoor;
  v.querySelector('#goalTegen').onclick = () => registreerGoal({type:'tegen'});
  v.querySelector('#kaartKnop').onclick = modalKaart;
  v.querySelector('#toonVerslag').onclick = modalVerslag;
  v.querySelector('#teamEvalKnop').onclick = () => {
    import('./teams.js').then(m => m.modalTeamEvaluatie(S.wedstrijdId));
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
    const naam = prompt('Tegenstander voor wedstrijd ' + wnr + ':', (w.tegenstanders||{})[wnr] || '');
    if (naam === null) return;
    (w.tegenstanders ||= {})[wnr] = naam.trim();
    bewaarWedstrijd(); renderWedstrijd();
  };
  v.querySelector('#klokStart').onclick = klokStartPauze;
  v.querySelector('#klokReset').onclick = klokReset;
  const kp = v.querySelector('#kopieerKwart'); if (kp) kp.onclick = kopieerVorigKwart;

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
    if (FORMATIES[w.format][vorige.formatie]) w.formatie = vorige.formatie;
    S.kwart = '1';
    bewaarWedstrijd(); renderWedstrijd();
    meld(`Opstelling overgenomen${vorige.bron.tegenstander ? ' van wedstrijd tegen '+vorige.bron.tegenstander : ''} — pas aan waar nodig`);
  };
  v.querySelector('#kiesSelectie').onclick = modalSelectie;
  v.querySelector('#planWissel').onclick = modalPlanWissel;
  v.querySelectorAll('[data-plan-uitvoer]').forEach(b => b.onclick = e => { e.stopPropagation(); voerPlanUit(Number(b.dataset.planUitvoer)); });
  v.querySelectorAll('[data-plan-weg]').forEach(b => b.onclick = e => { e.stopPropagation(); (huidigKwart().plan||[]).splice(Number(b.dataset.planWeg),1); bewaarWedstrijd(); renderWedstrijd(); });
  v.querySelectorAll('[data-weg-ev]').forEach(b => b.onclick = e => { e.stopPropagation(); verwijderEvent(Number(b.dataset.wegEv)); });
  v.querySelector('#wegWedstrijd').onclick = async () => {
    if (!confirm('Deze wedstrijd en alle opstellingen verwijderen?')) return;
    await deleteDoc(doc(db,'teams',S.teamId,'wedstrijden',S.wedstrijdId));
    sluitWedstrijd();
  };

  clearInterval(S.klokInterval);
  if (k.klok.running) S.klokInterval = setInterval(tikKlok, 500);

  koppelSleep(v);
}

/* ==================== WEDSTRIJDINSTELLINGEN & SELECTIE ==================== */
function modalWedstrijdMenu(){
  const w = S.wedstrijd;
  openModal(`
    <h2>Wedstrijd aanpassen</h2>
    <p style="font-size:11.5px;color:var(--ink-2);margin:2px 0 14px">Tip: doel en formatie kun je ook direct aantikken op het wedstrijdscherm.</p>
    <div class="menu-item" id="mMenuBasis">
      <span class="mi-ico">📝</span>
      <span class="mi-tekst"><span class="mi-titel">Basisgegevens</span><span class="mi-sub">${isToernooi(w) ? 'Naam toernooi' : 'Tegenstander'}, datum, speeltijd, aanvoerder</span></span>
      <span class="mi-pijl">›</span></div>
    <div class="menu-item" id="mMenuSpeelwijze">
      <span class="mi-ico">⚽</span>
      <span class="mi-tekst"><span class="mi-titel">Speelwijze & formatie</span><span class="mi-sub">Aantal spelers, opstelling · §3.2</span></span>
      <span class="mi-pijl">›</span></div>
    <div class="menu-item" id="mMenuDoel">
      <span class="mi-ico">🎯</span>
      <span class="mi-tekst"><span class="mi-titel">Doel & notitie</span><span class="mi-sub">Wedstrijddoel, scouting-notitie · §3.3</span></span>
      <span class="mi-pijl">›</span></div>`);
  $('#mMenuBasis').onclick = () => modalBasisgegevens(true);
  $('#mMenuSpeelwijze').onclick = () => modalSpeelwijze(true);
  $('#mMenuDoel').onclick = () => modalDoelNotitie(true);
}

function modalBasisgegevens(vanuitMenu){
  const w = S.wedstrijd;
  openModal(`
    ${vanuitMenu ? `<span class="terugnaarmenu" id="mBTerug">‹ Terug naar menu</span>` : ''}
    <h2>Basisgegevens</h2>
    <div class="veldgroep"><label>${isToernooi(w) ? 'Naam toernooi' : 'Tegenstander'}</label>
      <input class="invoer" id="mITegen" value="${esc(w.tegenstander)}"></div>
    <div class="rij">
      <div class="veldgroep"><label>Datum</label><input class="invoer" type="date" id="mIDatum" value="${esc(w.datum)}"></div>
      <div class="veldgroep"><label>Minuten per periode</label><input class="invoer" id="mIDuur" inputmode="decimal" value="${esc(w.kwartduur)}"></div>
    </div>
    <div class="veldgroep"><label>Aanvoerder</label>
      <select class="invoer" id="mIAanvoerder">
        <option value="">— geen aanvoerder gekozen —</option>
        ${(w.selectie||[]).map(pid => speler(pid)).filter(Boolean)
          .map(p => `<option value="${p.id}" ${w.aanvoerder===p.id?'selected':''}>${esc(spelerNr(p.id))} · ${esc(p.naam)}</option>`).join('')}
      </select></div>
    <button class="knop vol" id="mBOk">Opslaan</button>`);
  if (vanuitMenu) $('#mBTerug').onclick = modalWedstrijdMenu;
  $('#mBOk').onclick = () => {
    w.tegenstander = $('#mITegen').value.trim() || w.tegenstander;
    w.datum = $('#mIDatum').value || w.datum;
    w.kwartduur = parseFloat(($('#mIDuur').value||'').replace(',','.')) || w.kwartduur;
    w.aanvoerder = $('#mIAanvoerder').value || null;
    sluitModal(); bewaarWedstrijd(); renderWedstrijd();
  };
}

function modalSpeelwijze(vanuitMenu){
  const w = S.wedstrijd;
  openModal(`
    ${vanuitMenu ? `<span class="terugnaarmenu" id="mSTerug">‹ Terug naar menu</span>` : ''}
    <h2>Speelwijze</h2>
    <div class="veldgroep"><label>Aantal spelers</label>
      <div class="segment" id="mIFormat">${['4','6','8','9','11'].map(f =>
        `<button data-f="${f}" class="${w.format===f?'actief':''}">${f}×${f}</button>`).join('')}</div></div>
    <div class="veldgroep"><label>Formatie (excl. keeper)</label>
      <div class="segment wrap" id="mIFormatie"></div>
      <p style="font-size:12px;color:var(--ink-2);margin-top:6px">Wijzig je het format, dan past de app de formatie automatisch aan en blijven spelers zoveel mogelijk op hun plek.</p>
      <div id="mIFormatieHint"></div></div>
    <button class="knop vol" id="mSOk">Opslaan</button>`);
  if (vanuitMenu) $('#mSTerug').onclick = modalWedstrijdMenu;

  let format = w.format, formatie = w.formatie;
  const toonFormatieHint = () => {
    const el = $('#mIFormatieHint');
    if (!el) return;
    if (format !== '11'){ el.innerHTML = ''; return; }
    if (formatie === CLUB_FORMATIE_11){
      el.innerHTML = `<div class="formatie-hint match"><span class="fh-ico">✓</span><span><b>Sluit aan bij de clubvisie (§3.2).</b> Bij balbezit schuift één verdediger in naar het middenveld (1:3:4:3) voor een overtal — steeds een andere speler, zodat iedereen leert opbouwen.</span></div>`;
    } else {
      el.innerHTML = `<div class="formatie-hint info"><span class="fh-ico">💡</span><span>Het jeugdbeleidsplan gaat uit van <b>${esc(CLUB_FORMATIE_11)}</b> als basis (§3.2). Kies je bewust voor ${esc(formatie)}? Laat dan de vrije verdediger een opbouwende rol spelen, niet achter de mandekkers.</span></div>`;
    }
  };
  const vulFormaties = () => {
    $('#mIFormatie').innerHTML = Object.keys(FORMATIES[format]).map(f =>
      `<button data-f="${f}" class="${formatie===f?'actief':''}">${f}</button>`).join('');
    $$('#mIFormatie button').forEach(b => b.onclick = () => {
      $$('#mIFormatie button').forEach(x=>x.classList.remove('actief')); b.classList.add('actief'); formatie = b.dataset.f;
      toonFormatieHint();
    });
    toonFormatieHint();
  };
  vulFormaties();
  $$('#mIFormat button').forEach(b => b.onclick = () => {
    $$('#mIFormat button').forEach(x=>x.classList.remove('actief')); b.classList.add('actief');
    format = b.dataset.f;
    if (!FORMATIES[format][formatie]) formatie = Object.keys(FORMATIES[format])[0];
    vulFormaties();
  });

  $('#mSOk').onclick = () => {
    if (format !== w.format || formatie !== w.formatie){
      const nieuweIds = new Set(bouwSlots(format, formatie).map(s => s.id));
      for (const kk of Object.values(w.kwarten)){
        for (const slot of Object.keys(kk.lineup)) if (!nieuweIds.has(slot)) delete kk.lineup[slot];
        kk.events = kk.events.filter(e => nieuweIds.has(e.slot));
      }
      w.format = format; w.formatie = formatie;
    }
    sluitModal(); bewaarWedstrijd(); renderWedstrijd();
  };
}

function modalDoelNotitie(vanuitMenu){
  const w = S.wedstrijd;
  openModal(`
    ${vanuitMenu ? `<span class="terugnaarmenu" id="mDTerug">‹ Terug naar menu</span>` : ''}
    <h2>🎯 Wedstrijddoel</h2>
    <div class="veldgroep">
      <input class="invoer" id="mIDoel" value="${esc(w.doel||'')}" placeholder="Bijv. opbouw van achteruit, durven schieten">
      <div class="doel-suggesties" id="mIDoelSug">
        ${doelSuggesties(S.team?.categorie).map(s => `<button type="button" data-doelsug="${esc(s)}">${esc(s)}</button>`).join('')}
      </div>
      <p style="font-size:11px;color:var(--ink-2);margin-top:5px">💡 Suggesties op basis van de leercurve (§3.3) voor ${esc(S.team?.categorie||'dit team')} — tik om over te nemen, of typ je eigen doel.</p></div>
    <div class="veldgroep"><label>📝 Notitie</label>
      <textarea class="invoer" id="mINotitie" rows="3" placeholder="Bijv. sterke counter, druk zetten op hun nr. 7. Zichtbaar bij de volgende keer tegen deze tegenstander.">${esc(w.notitie||'')}</textarea></div>
    <button class="knop vol" id="mDOk">Opslaan</button>`);
  if (vanuitMenu) $('#mDTerug').onclick = modalWedstrijdMenu;
  $$('#mIDoelSug [data-doelsug]').forEach(b => b.onclick = () => { $('#mIDoel').value = b.dataset.doelsug; });
  $('#mDOk').onclick = () => {
    w.doel = $('#mIDoel').value.trim();
    w.notitie = $('#mINotitie').value.trim();
    sluitModal(); bewaarWedstrijd(); renderWedstrijd();
  };
}

function modalSelectie(){
  const w = S.wedstrijd;
  const sel = new Set(w.selectie || []);
  openModal(`
    <h2>Selectie voor deze wedstrijd</h2>
    <p style="font-size:13.5px;color:var(--ink-2);margin-bottom:12px">Vink af wie er vandaag bij is. Afwezige spelers verschijnen niet op de bank.</p>
    ${S.spelers.map(p => `
      <label class="speler-rij" style="cursor:pointer">
        <input type="checkbox" data-sel="${p.id}" ${sel.has(p.id)?'checked':''} style="width:19px;height:19px;accent-color:var(--grass)">
        <div class="mini-shirt">${esc(p.nummer ?? '·')}</div><div class="n">${esc(p.naam)}</div>
      </label>`).join('')}
    <button class="knop vol" id="mSelOk" style="margin-top:6px">Klaar</button>`);
  $('#mSelOk').onclick = () => {
    w.selectie = $$('#modalInhoud [data-sel]').filter(c => c.checked).map(c => c.dataset.sel);
    const toegestaan = new Set(w.selectie);
    for (const kk of Object.values(w.kwarten)){
      for (const [slot, pid] of Object.entries(kk.lineup)) if (!toegestaan.has(pid)) delete kk.lineup[slot];
      kk.events = kk.events.filter(e => (!e.in || toegestaan.has(e.in)) && (!e.uit || toegestaan.has(e.uit)));
      kk.plan = (kk.plan||[]).filter(p => toegestaan.has(p.in) && toegestaan.has(p.uit));
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
