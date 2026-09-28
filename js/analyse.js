import { S } from './state.js?v=20260922c';
import { periodeNrs, slotLijn, slotPositieNaam } from './config.js?v=20260922c';

/* ==================== SPEELTIJD-BEREKENING ====================
   Losse module zonder UI-afhankelijkheden, zodat zowel het wedstrijdscherm
   als het statistiekentabblad ervan gebruik kunnen maken zonder kringverwijzing. */

export function kwartGespeeld(k){
  return Object.keys(k.lineup||{}).length > 0 || (k.events||[]).length > 0
    || Object.keys(k.correcties||{}).length > 0;
}

/* effectieve opstelling = startopstelling + alle wissel-events in volgorde */
export function effectieveLineup(k){
  const l = {...k.lineup};
  for (const e of [...(k.events||[])].sort((a,b) => a.sec - b.sec)){
    if (e.in) l[e.slot] = e.in;
    else delete l[e.slot];
  }
  return l;
}

function klokSecRaw(k){
  return k.klok.base + (k.klok.running ? (Date.now() - k.klok.start)/1000 : 0);
}
/* Duur van een periode in seconden. De ingestelde kwartduur is de ONDERGRENS:
   de klok kan een periode alleen verlengen (blessuretijd), nooit verkorten.
   Voorheen gold de klokstand zodra die boven 5 sec lag, waardoor een klok die
   halverwege gepauzeerd werd en niet hervat de hele periode inkortte — alle
   spelers verloren dan tijd en de invaller kwam op 0:00 uit. */
function kwartDuurSec(w, k){
  const e = klokSecRaw(k);
  const ingesteld = Math.round((w.kwartduur || 0) * 60);
  return Math.max(ingesteld, e > 5 ? Math.round(e) : 0);
}

export function analyseKwart(w, k){
  const res = {tijd:{}, keeper:new Set(), lijn:{}};
  if (!kwartGespeeld(k)) return res;
  const D = kwartDuurSec(w, k);
  const aan = {};
  const kFormatie = (k && k.formatie) || w.formatie;
  const telLijn = (pid, slot) => {
    const naam = slotPositieNaam(w.format, kFormatie, slot) || slotLijn(slot);
    (res.lijn[pid] ||= {}); res.lijn[pid][naam] = (res.lijn[pid][naam]||0) + 1;
  };
  for (const [slot, pid] of Object.entries(k.lineup||{})){
    aan[pid] = 0; telLijn(pid, slot);
    if (slot === 'K') res.keeper.add(pid);
  }
  for (const e of [...(k.events||[])].sort((a,b) => a.sec - b.sec)){
    const sec = Math.min(e.sec, D);
    if (e.uit){
      if (aan[e.uit] != null){
        res.tijd[e.uit] = (res.tijd[e.uit]||0) + Math.max(0, sec - aan[e.uit]);
        delete aan[e.uit];
      } else if (res.tijd[e.uit] == null){
        /* Hij is eruit gewisseld, maar staat niet in de startopstelling en kreeg
           ook geen 'in'-event: dat gebeurt als de opstelling pas na het starten
           van de klok is neergezet, of als een wissel achteraf is toegevoegd.
           Voorheen viel zijn gespeelde tijd dan volledig weg; nu telt hij vanaf
           het begin van de periode. De voorwaarde res.tijd == null voorkomt
           dubbeltelling bij een tweede 'uit' zonder 'in' ertussen. */
        res.tijd[e.uit] = Math.max(0, sec);
        telLijn(e.uit, e.slot);
        if (e.slot === 'K') res.keeper.add(e.uit);
      }
    }
    if (e.in){
      aan[e.in] = sec; telLijn(e.in, e.slot);
      if (e.slot === 'K') res.keeper.add(e.in);
    }
  }
  for (const [pid, start] of Object.entries(aan))
    res.tijd[pid] = (res.tijd[pid]||0) + Math.max(0, D - start);
  if (k.correcties){
    for (const [pid, sec] of Object.entries(k.correcties)) res.tijd[pid] = sec;
  }
  return res;
}

export function analyseWedstrijd(w){
  const tot = {tijd:{}, keeper:{}, lijn:{}, kwarten:0, matchduur:0};
  for (const nr of periodeNrs(w)){
    const k = w.kwarten?.[nr]; if (!k || !kwartGespeeld(k)) continue;
    tot.kwarten++;
    tot.matchduur += kwartDuurSec(w, k); // totale speelbare tijd van dit gespeelde kwart
    const a = analyseKwart(w, k);
    for (const [pid, s] of Object.entries(a.tijd)) tot.tijd[pid] = (tot.tijd[pid]||0) + s;
    for (const pid of a.keeper) tot.keeper[pid] = (tot.keeper[pid]||0) + 1;
    for (const [pid, l] of Object.entries(a.lijn)){
      tot.lijn[pid] ||= {};
      for (const [ln, n] of Object.entries(l)) tot.lijn[pid][ln] = (tot.lijn[pid][ln]||0) + n;
    }
  }
  return tot;
}

/* Disciplinaire banktijd per speler over de hele wedstrijd (in seconden).
   Een 'uit'-event met disciplinair:true markeert het begin van een strafbeurt op
   de bank; die loopt tot de speler weer een 'in'-event krijgt of tot het einde
   van het kwart. Deze tijd wordt in speeltijdReserve() van de PERSOONLIJKE
   speelbare tijd van díe speler afgetrokken, zodat een strafmoment het eerlijke
   speelminuten-percentage niet verlaagt. Zonder disciplinaire vlag: 0 — alles
   telt dan exact zoals voorheen. */
export function disciplinaireTijd(w){
  const uit = {}; // pid -> seconden
  const startStraf = w.startBankReden || {}; // vooraf ingestelde bankbeurten
  let eersteGespeeld = true;
  for (const nr of periodeNrs(w)){
    const k = w.kwarten?.[nr]; if (!k || !kwartGespeeld(k)) continue;
    const D = kwartDuurSec(w, k);
    const events = [...(k.events||[])].sort((a,b) => a.sec - b.sec);
    // per speler bijhouden of hij disciplinair op de bank staat, en sinds wanneer
    const strafSinds = {}; // pid -> sec waarop de strafbeurt begon
    // Vooraf ingestelde disciplinaire bankbeurt: telt vanaf het begin van het
    // eerste gespeelde kwart, mits de speler daar niet in de startopstelling staat.
    if (eersteGespeeld){
      const inLineup = new Set(Object.values(k.lineup || {}));
      for (const [pid, rec] of Object.entries(startStraf))
        if (rec?.disciplinair && !inLineup.has(pid)) strafSinds[pid] = 0;
      eersteGespeeld = false;
    }
    for (const e of events){
      const sec = Math.min(e.sec, D);
      if (e.uit && e.disciplinair) strafSinds[e.uit] = sec;
      // komt iemand er (weer) in, dan eindigt zijn eventuele strafbeurt
      if (e.in && strafSinds[e.in] != null){
        uit[e.in] = (uit[e.in]||0) + Math.max(0, sec - strafSinds[e.in]);
        delete strafSinds[e.in];
      }
    }
    // wie aan het eind nog disciplinair op de bank zit: tot einde kwart
    for (const [pid, sinds] of Object.entries(strafSinds))
      uit[pid] = (uit[pid]||0) + Math.max(0, D - sinds);
  }
  return uit;
}
/* Te-laat-tijd per speler over de hele wedstrijd (in seconden).
   Een speler met een te-laat-vlag (w.telaat) en een ingestelde wedstrijdminuut
   (w.telaatVanaf[pid]) was vóór die minuut niet beschikbaar. Die tijd telt in
   speeltijdReserve() niet mee in zijn PERSOONLIJKE noemer, zodat te laat komen
   zijn speelminuten-percentage niet drukt. De minuut is de doorlopende
   wedstrijdminuut (periode 2 begint na de duur van periode 1, enz.).
   Zonder minuut of zonder te-laat-vlag: 0 — alles telt dan exact zoals voorheen. */
export function telaatTijd(w){
  const uit = {}; // pid -> seconden niet beschikbaar
  const vanaf = w.telaatVanaf || {};
  const laat = new Set(Array.isArray(w.telaat) ? w.telaat : []);
  const spelers = Object.entries(vanaf)
    .map(([pid, m]) => [pid, Number(m)])
    .filter(([pid, m]) => laat.has(pid) && m > 0);
  if (!spelers.length) return uit;
  let start = 0; // begin van deze periode in wedstrijdseconden
  for (const nr of periodeNrs(w)){
    const k = w.kwarten?.[nr];
    const gespeeld = k && kwartGespeeld(k);
    const D = gespeeld ? kwartDuurSec(w, k) : Math.round((w.kwartduur || 0) * 60);
    if (gespeeld){
      for (const [pid, m] of spelers){
        const s = Math.min(D, Math.max(0, m * 60 - start));
        if (s > 0) uit[pid] = (uit[pid]||0) + s;
      }
    }
    start += D;
  }
  return uit;
}

/* Speeltijd- en reserve-aggregatie over meerdere wedstrijden, alleen geteld
   voor wedstrijden waarin de speler in de selectie zat (de eerlijke noemer).
   Geeft per speler: speeltijd (sec), reserve (sec) en speelbaar (sec).
   reserve = speelbaar - speeltijd; percentages worden in de UI berekend.
   Te-laat-tijd (telaatTijd) en disciplinaire banktijd gaan beide van de
   persoonlijke noemer af; samen nooit onder de al gespeelde tijd. */
export function speeltijdReserve(wedstrijden){
  const uit = {}; // pid -> {speeltijd, reserve, speelbaar, wedstrijden}
  for (const w of wedstrijden){
    const a = analyseWedstrijd(w);
    if (!a.kwarten || !a.matchduur) continue;
    const selectie = Array.isArray(w.selectie) ? w.selectie : [];
    const disc = disciplinaireTijd(w); // pid -> disciplinaire banktijd (sec)
    const laat = telaatTijd(w);        // pid -> tijd vóór aankomst (sec)
    for (const pid of selectie){
      const n = persoonlijkeNoemer(a, pid, disc[pid] || 0, laat[pid] || 0);
      const r = (uit[pid] ||= {speeltijd:0, reserve:0, speelbaar:0, wedstrijden:0, disciplinair:0, telaat:0});
      r.speeltijd += n.gespeeld;
      r.speelbaar += n.speelbaar;
      r.reserve   += Math.max(0, n.speelbaar - n.gespeeld);
      r.disciplinair += n.straf;
      r.telaat += n.laat;
      r.wedstrijden++;
    }
  }
  return uit;
}

/* Persoonlijke noemer voor één speler in één wedstrijd. Te-laat-tijd en
   disciplinaire banktijd worden van de wedstrijdduur afgehaald, maar samen
   nooit meer dan de tijd die hij NIET speelde (een verkeerd ingestelde minuut
   kan zo nooit tot een percentage boven 100% leiden). */
export function persoonlijkeNoemer(a, pid, disc = 0, laat = 0){
  const gespeeld = a.tijd[pid] || 0;
  const ruimte = Math.max(0, a.matchduur - gespeeld);
  const l = Math.min(laat, ruimte);
  const straf = Math.min(disc, ruimte - l);
  return {gespeeld, laat: l, straf, speelbaar: Math.max(gespeeld, a.matchduur - l - straf)};
}
