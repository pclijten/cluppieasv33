import { S } from './state.js';
import { periodeNrs, slotLijn } from './config.js';

/* ==================== SPEELTIJD-BEREKENING ====================
   Losse module zonder UI-afhankelijkheden, zodat zowel het wedstrijdscherm
   als het statistiekentabblad ervan gebruik kunnen maken zonder kringverwijzing. */

export function kwartGespeeld(k){
  return Object.keys(k.lineup||{}).length > 0 || (k.events||[]).length > 0;
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
function kwartDuurSec(w, k){
  const e = klokSecRaw(k);
  return e > 5 ? Math.round(e) : Math.round(w.kwartduur*60);
}

export function analyseKwart(w, k){
  const res = {tijd:{}, keeper:new Set(), lijn:{}};
  if (!kwartGespeeld(k)) return res;
  const D = kwartDuurSec(w, k);
  const aan = {};
  const telLijn = (pid, l) => { (res.lijn[pid] ||= {}); res.lijn[pid][l] = (res.lijn[pid][l]||0) + 1; };
  for (const [slot, pid] of Object.entries(k.lineup||{})){
    aan[pid] = 0; telLijn(pid, slotLijn(slot));
    if (slot === 'K') res.keeper.add(pid);
  }
  for (const e of [...(k.events||[])].sort((a,b) => a.sec - b.sec)){
    const sec = Math.min(e.sec, D);
    if (e.uit && aan[e.uit] != null){
      res.tijd[e.uit] = (res.tijd[e.uit]||0) + Math.max(0, sec - aan[e.uit]);
      delete aan[e.uit];
    }
    if (e.in){
      aan[e.in] = sec; telLijn(e.in, slotLijn(e.slot));
      if (e.slot === 'K') res.keeper.add(e.in);
    }
  }
  for (const [pid, start] of Object.entries(aan))
    res.tijd[pid] = (res.tijd[pid]||0) + Math.max(0, D - start);
  return res;
}

export function analyseWedstrijd(w){
  const tot = {tijd:{}, keeper:{}, lijn:{}, kwarten:0};
  for (const nr of periodeNrs(w)){
    const k = w.kwarten?.[nr]; if (!k || !kwartGespeeld(k)) continue;
    tot.kwarten++;
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
