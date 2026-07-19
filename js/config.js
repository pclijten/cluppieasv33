import { S } from './state.js?v=20260719';

/* ==================== KNVB-CATEGORIEËN ====================
   Bron: KNVB wedstrijdvormen & speeltijden (knvb.nl)
   Pupillen spelen officieel 2 helften met een time-out halverwege
   elke helft — in de praktijk dus 4 kwarten. Junioren/senioren: 2 helften. */
export const CATEGORIEEN = {
  'JO7':  {format:'4',  periodes:4, duur:10,   knvb:'4 tegen 4 · geen keeper · 2×20 min'},
  'JO8':  {format:'6',  periodes:4, duur:10,   knvb:'6 tegen 6 · 2×20 min, time-out per helft'},
  'JO9':  {format:'6',  periodes:4, duur:10,   knvb:'6 tegen 6 · 2×20 min, time-out per helft'},
  'JO10': {format:'6',  periodes:4, duur:12.5, knvb:'6 tegen 6 · 2×25 min, time-out per helft'},
  'JO11': {format:'8',  periodes:4, duur:15,   knvb:'8 tegen 8 · 2×30 min, time-out per helft'},
  'JO12': {format:'8',  periodes:4, duur:15,   knvb:'8 tegen 8 · 2×30 min, time-out per helft'},
  'JO13': {format:'11', periodes:2, duur:30,   knvb:'11 tegen 11 · 2×30 min'},
  'JO14': {format:'11', periodes:2, duur:35,   knvb:'11 tegen 11 · 2×35 min'},
  'JO15': {format:'11', periodes:2, duur:35,   knvb:'11 tegen 11 · 2×35 min'},
  'JO16': {format:'11', periodes:2, duur:40,   knvb:'11 tegen 11 · 2×40 min'},
  'JO17': {format:'11', periodes:2, duur:40,   knvb:'11 tegen 11 · 2×40 min'},
  'JO19': {format:'11', periodes:2, duur:45,   knvb:'11 tegen 11 · 2×45 min'},
  'Senioren': {format:'11', periodes:2, duur:45, knvb:'11 tegen 11 · 2×45 min'},
};
export const CATEGORIEEN_MEIDEN = {
  'MO7':  {format:'4',  periodes:4, duur:10,   knvb:'4 tegen 4 · geen keeper · 2×20 min'},
  'MO8':  {format:'6',  periodes:4, duur:10,   knvb:'6 tegen 6 · 2×20 min, time-out per helft'},
  'MO9':  {format:'6',  periodes:4, duur:10,   knvb:'6 tegen 6 · 2×20 min, time-out per helft'},
  'MO10': {format:'6',  periodes:4, duur:12.5, knvb:'6 tegen 6 · 2×25 min, time-out per helft'},
  'MO11': {format:'8',  periodes:4, duur:15,   knvb:'8 tegen 8 · 2×30 min, time-out per helft'},
  'MO12': {format:'8',  periodes:4, duur:15,   knvb:'8 tegen 8 · 2×30 min, time-out per helft'},
  'MO13': {format:'9',  periodes:2, duur:30,   knvb:'9 tegen 9 · 2×30 min'},
  'MO15': {format:'9',  periodes:2, duur:35,   knvb:'9 tegen 9 · 2×35 min'},
  'MO17': {format:'9',  periodes:2, duur:40,   knvb:'9 tegen 9 · 2×40 min'},
  'MO20': {format:'9',  periodes:2, duur:45,   knvb:'9 tegen 9 · 2×45 min'},
  'Vrouwen': {format:'11', periodes:2, duur:45, knvb:'11 tegen 11 · 2×45 min'},
};
export function catInfo(naam){ return CATEGORIEEN[naam] || CATEGORIEEN_MEIDEN[naam] || null; }

export function isToernooi(w){ return w.type === 'toernooi'; }

/* tijdstraf in seconden — KNVB: 5 min pupillen (t/m JO/MO15), 10 min junioren+/senioren */
export function tijdstrafSec(){
  const cat = S.team?.categorie || '';
  const m = cat.match(/^[JM]O(\d+)$/);
  if (m && Number(m[1]) >= 16) return 600;
  if (cat === 'Senioren' || cat === 'Vrouwen') return 600;
  return 300;
}
export const KAART_ICOON = {geel:'🟨', rood:'🟥', tijd:'⏱'};
export const KAART_NAAM  = {geel:'gele kaart', rood:'rode kaart', tijd:'tijdstraf'};

export function periodeNaam(w){
  if (isToernooi(w)) return w.toernooi.helften === 1 ? 'Wedstrijd' : 'Helft';
  return (w.periodes||4) === 2 ? 'Helft' : 'Kwart';
}
export function periodeNrs(w){ return Array.from({length: w.periodes||4}, (_,i) => String(i+1)); }
export function periodeLabel(w, nr){
  if (isToernooi(w)){
    const h = w.toernooi.helften;
    return h === 1 ? 'W'+nr : 'W'+Math.ceil(nr/h)+'.'+(((nr-1)%h)+1);
  }
  return ((w.periodes||4) === 2 ? 'H' : 'K') + nr;
}
export function toernooiWnr(w, nr = S.kwart){ return Math.ceil(Number(nr) / w.toernooi.helften); }
export function periodeOmschrijving(w, nr = S.kwart){
  if (isToernooi(w)){
    const wnr = toernooiWnr(w, nr);
    return w.toernooi.helften === 1 ? 'wedstrijd '+wnr : `wedstrijd ${wnr}, helft ${((Number(nr)-1)%w.toernooi.helften)+1}`;
  }
  return periodeNaam(w).toLowerCase()+' '+nr;
}

/* ==================== FORMATIES ==================== */
/* [x%, y%, lijn]  — keeper wordt automatisch toegevoegd op (50, 90),
   behalve bij 4 tegen 4 (JO7): daar speelt niemand op doel. */
export const FORMATIES = {
  '4': {
    '1-2-1': [[50,76,'V'],[24,50,'M'],[76,50,'M'],[50,24,'A']],
    '2-2':   [[30,68,'V'],[70,68,'V'],[30,32,'A'],[70,32,'A']],
    '1-1-2': [[50,76,'V'],[50,50,'M'],[30,26,'A'],[70,26,'A']],
  },
  '6': {
    '2-1-2': [[30,72,'V'],[70,72,'V'],[50,49,'M'],[30,26,'A'],[70,26,'A']],
    '1-2-2': [[50,73,'V'],[30,49,'M'],[70,49,'M'],[30,26,'A'],[70,26,'A']],
    '2-2-1': [[30,72,'V'],[70,72,'V'],[30,47,'M'],[70,47,'M'],[50,24,'A']],
    '1-3-1': [[50,73,'V'],[20,49,'M'],[50,46,'M'],[80,49,'M'],[50,24,'A']],
    '3-1-1': [[22,72,'V'],[50,75,'V'],[78,72,'V'],[50,48,'M'],[50,24,'A']],
  },
  '8': {
    '3-3-1': [[22,73,'V'],[50,76,'V'],[78,73,'V'],[22,48,'M'],[50,45,'M'],[78,48,'M'],[50,23,'A']],
    '2-3-2': [[32,74,'V'],[68,74,'V'],[20,48,'M'],[50,45,'M'],[80,48,'M'],[32,23,'A'],[68,23,'A']],
    '3-2-2': [[22,73,'V'],[50,76,'V'],[78,73,'V'],[32,47,'M'],[68,47,'M'],[32,23,'A'],[68,23,'A']],
    '2-4-1': [[32,74,'V'],[68,74,'V'],[14,48,'M'],[38,45,'M'],[62,45,'M'],[86,48,'M'],[50,23,'A']],
    '1-3-3': [[50,75,'V'],[22,49,'M'],[50,46,'M'],[78,49,'M'],[22,24,'A'],[50,21,'A'],[78,24,'A']],
    '1-4-2': [[50,75,'V'],[14,49,'M'],[38,46,'M'],[62,46,'M'],[86,49,'M'],[32,23,'A'],[68,23,'A']],
  },
  '9': {
    '3-3-2': [[22,74,'V'],[50,77,'V'],[78,74,'V'],[22,49,'M'],[50,46,'M'],[78,49,'M'],[32,23,'A'],[68,23,'A']],
    '3-2-3': [[22,74,'V'],[50,77,'V'],[78,74,'V'],[32,48,'M'],[68,48,'M'],[20,24,'A'],[50,21,'A'],[80,24,'A']],
    '2-4-2': [[32,75,'V'],[68,75,'V'],[14,49,'M'],[38,46,'M'],[62,46,'M'],[86,49,'M'],[32,23,'A'],[68,23,'A']],
    '4-3-1': [[14,73,'V'],[38,77,'V'],[62,77,'V'],[86,73,'V'],[25,47,'M'],[50,44,'M'],[75,47,'M'],[50,21,'A']],
  },
  '11': {
    '4-3-3': [[14,75,'V'],[38,78,'V'],[62,78,'V'],[86,75,'V'],[27,52,'M'],[50,48,'M'],[73,52,'M'],[19,25,'A'],[50,21,'A'],[81,25,'A']],
    '4-4-2': [[14,75,'V'],[38,78,'V'],[62,78,'V'],[86,75,'V'],[14,49,'M'],[38,46,'M'],[62,46,'M'],[86,49,'M'],[35,23,'A'],[65,23,'A']],
    '3-4-3': [[25,76,'V'],[50,78,'V'],[75,76,'V'],[14,49,'M'],[38,46,'M'],[62,46,'M'],[86,49,'M'],[19,25,'A'],[50,21,'A'],[81,25,'A']],
    '4-2-3-1': [[14,77,'V'],[38,80,'V'],[62,80,'V'],[86,77,'V'],[36,58,'M'],[64,58,'M'],[20,38,'M'],[50,35,'M'],[80,38,'M'],[50,17,'A']],
    '4-1-4-1': [[14,77,'V'],[38,80,'V'],[62,80,'V'],[86,77,'V'],[50,60,'M'],[14,40,'M'],[38,37,'M'],[62,37,'M'],[86,40,'M'],[50,17,'A']],
    '3-5-2': [[25,77,'V'],[50,79,'V'],[75,77,'V'],[10,46,'M'],[32,48,'M'],[50,52,'M'],[68,48,'M'],[90,46,'M'],[35,21,'A'],[65,21,'A']],
    '5-3-2': [[10,72,'V'],[30,78,'V'],[50,80,'V'],[70,78,'V'],[90,72,'V'],[27,48,'M'],[50,45,'M'],[73,48,'M'],[35,21,'A'],[65,21,'A']],
  },
};
export const LIJN_NAAM = {K:'Keeper', V:'Verdediging', M:'Middenveld', A:'Aanval'};

export function bouwSlots(format, formatie){
  const def = (FORMATIES[format] && FORMATIES[format][formatie])
           || Object.values(FORMATIES[format])[0];
  const slots = format === '4' ? [] : [{id:'K', x:50, y:90, lijn:'K'}];
  const tel = {V:0, M:0, A:0};
  for (const [x,y,l] of def){ tel[l]++; slots.push({id:l+tel[l], x, y, lijn:l}); }
  return slots;
}
export const slotLijn = id => id[0];

/* ==================== EXACTE POSITIENAMEN (KNVB) ====================
   Leidt uit lijn (K/V/M/A) + horizontale positie (x%) de meest gebruikelijke
   KNVB-benaming af: links (<35%), midden (35–65%), rechts (>65%). Werkt
   generiek voor elke formatie/format, zonder per formatie te hoeven hardcoden. */
const ZONE_NAAM = {
  V: {links:'Linksback', midden:'Centrale verdediger', rechts:'Rechtsback'},
  M: {links:'Linksmidden', midden:'Centrale middenvelder', rechts:'Rechtsmidden'},
  A: {links:'Linksbuiten', midden:'Spits', rechts:'Rechtsbuiten'},
};
function zone(x){ return x < 35 ? 'links' : x > 65 ? 'rechts' : 'midden'; }
export function positieNaam(lijn, x){
  if (lijn === 'K') return 'Keeper';
  return (ZONE_NAAM[lijn] && ZONE_NAAM[lijn][zone(x)]) || LIJN_NAAM[lijn] || '';
}
export function slotPositieNaam(format, formatie, slotId){
  const slot = bouwSlots(format, formatie).find(s => s.id === slotId);
  return slot ? positieNaam(slot.lijn, slot.x) : null;
}
/* Volledige, gegroepeerde lijst voor de voorkeurspositie-kiezer in het spelerprofiel. */
export const POSITIE_GROEPEN = [
  {lijn:'K', naam:'Keeper', posities:['Keeper']},
  {lijn:'V', naam:'Verdediging', posities:['Linksback','Centrale verdediger','Rechtsback']},
  {lijn:'M', naam:'Middenveld', posities:['Linksmidden','Centrale middenvelder','Rechtsmidden']},
  {lijn:'A', naam:'Aanval', posities:['Linksbuiten','Spits','Rechtsbuiten']},
];

/* ==================== BOUW-INDELING (voor trainingen) ====================
   Onderbouw  : JO7–JO11  / MO7–MO11
   Middenbouw : JO12–JO15 / MO12–MO15
   Bovenbouw  : JO16–JO19 / MO17–MO20, plus Senioren/Vrouwen en onbekend. */
export const BOUWEN = [
  {id:'onder',  naam:'Onderbouw',  kort:'Onder'},
  {id:'midden', naam:'Middenbouw', kort:'Midden'},
  {id:'boven',  naam:'Bovenbouw',  kort:'Boven'},
];
export function bouwVanCategorie(categorie){
  const m = String(categorie||'').toUpperCase().match(/^[JM]O(\d+)/);
  if (m){
    const lft = Number(m[1]);
    if (lft <= 11) return 'onder';
    if (lft <= 15) return 'midden';
    return 'boven';
  }
  // Senioren, Vrouwen of niets ingesteld → bovenbouw
  return 'boven';
}
export function bouwNaam(id){ return (BOUWEN.find(b => b.id === id)?.naam) || 'Overig'; }

/* ==================== YOUTUBE-HELPERS ==================== */
/* haalt de video-id uit allerlei YouTube-URL-vormen; null als het geen YouTube is */
export function youtubeId(url){
  if (!url) return null;
  const s = String(url).trim();
  const patronen = [
    /(?:youtube\.com\/watch\?[^ ]*\bv=)([A-Za-z0-9_-]{11})/,
    /(?:youtu\.be\/)([A-Za-z0-9_-]{11})/,
    /(?:youtube\.com\/embed\/)([A-Za-z0-9_-]{11})/,
    /(?:youtube\.com\/shorts\/)([A-Za-z0-9_-]{11})/,
    /(?:youtube\.com\/live\/)([A-Za-z0-9_-]{11})/,
  ];
  for (const p of patronen){ const m = s.match(p); if (m) return m[1]; }
  // kale 11-teken id
  if (/^[A-Za-z0-9_-]{11}$/.test(s)) return s;
  return null;
}
export function youtubeThumb(id){ return `https://img.youtube.com/vi/${id}/mqdefault.jpg`; }
export function youtubeWatch(id){ return `https://www.youtube.com/watch?v=${id}`; }

/* ==================== KNVB SPEELDAGENKALENDER 2026/'27 ====================
   Districten Zuid I en II. Zaterdagdatum per speelweek (ISO).
   t: wd=wedstrijddag, beker, inhaal, vrij. l=label, n=opmerking (optioneel).
   pup=O7-O12, jun=O13-O19, sen=Senioren/Vrouwen, mei=Meiden MO13-MO20. */
export const KNVB_SEIZOEN = "2026/'27";

/* Standaardwaarde voor clubs/{clubId}.huidigSeizoen zolang de beheerder nog
   niet op "Nieuw seizoen starten" heeft gedrukt (zie club.js/teams.js). Dit is
   los van KNVB_SEIZOEN hierboven, dat alleen de KNVB-speeldagenkalender labelt. */
export const SEIZOEN_FALLBACK = "2025/'26";
export const KNVB_KALENDER = {
  pup: [
    {d:'2026-08-16',t:'vrij',l:'Vrij',n:'Schoolvakanties N t/m 16 aug'},
    {d:'2026-08-23',t:'vrij',l:'Vrij',n:'Schoolvakanties Z t/m 23 aug.'},
    {d:'2026-08-30',t:'wd',l:'Fase 1 · start',n:'Schoolvakanties M t/m 30 aug.'},
    {d:'2026-09-06',t:'wd',l:'Fase 1'},
    {d:'2026-09-13',t:'wd',l:'Fase 1'},
    {d:'2026-09-20',t:'wd',l:'Fase 1'},
    {d:'2026-09-27',t:'wd',l:'Fase 1'},
    {d:'2026-10-04',t:'wd',l:'Fase 1'},
    {d:'2026-10-11',t:'wd',l:'Fase 1',n:'Herfstvakantie N: 10-18 okt'},
    {d:'2026-10-18',t:'vrij',l:'Vrij',n:'Herfstvakantie alle regio\'s'},
    {d:'2026-10-25',t:'vrij',l:'Vrij',n:'Herfstvakantie M-Z: 17-25 okt'},
    {d:'2026-10-31',t:'wd',l:'Fase 2 · start'},
    {d:'2026-11-08',t:'wd',l:'Fase 2'},
    {d:'2026-11-15',t:'wd',l:'Fase 2'},
    {d:'2026-11-22',t:'wd',l:'Fase 2'},
    {d:'2026-11-29',t:'wd',l:'Fase 2'},
    {d:'2026-12-06',t:'wd',l:'Fase 2'},
    {d:'2026-12-13',t:'wd',l:'Fase 2'},
    {d:'2026-12-20',t:'vrij',l:'Vrij',n:'Kerstvakantie 19 dec.-3 jan.'},
    {d:'2027-01-10',t:'vrij',l:'Vrij'},
    {d:'2027-01-17',t:'vrij',l:'Vrij'},
    {d:'2027-01-24',t:'wd',l:'Fase 3 · start'},
    {d:'2027-01-31',t:'wd',l:'Fase 3'},
    {d:'2027-02-07',t:'vrij',l:'Vrij',n:'Carnavalsweekend'},
    {d:'2027-02-14',t:'vrij',l:'Vrij',n:'Vrj.vak. Z: 13-21 feb.'},
    {d:'2027-02-21',t:'wd',l:'Fase 3',n:'Vrj.vak. alle regio\'s'},
    {d:'2027-02-28',t:'wd',l:'Fase 3',n:'Vrj.vak. N-M: 20-28 feb'},
    {d:'2027-03-07',t:'wd',l:'Fase 3'},
    {d:'2027-03-14',t:'wd',l:'Fase 3'},
    {d:'2027-03-21',t:'wd',l:'Fase 3'},
    {d:'2027-03-27',t:'vrij',l:'Vrij',n:'Paaszaterdag'},
    {d:'2027-03-29',t:'vrij',l:'Vrij',n:'2e Paasdag'},
    {d:'2027-04-04',t:'wd',l:'Fase 4 · start'},
    {d:'2027-04-11',t:'wd',l:'Fase 4'},
    {d:'2027-04-18',t:'wd',l:'Fase 4'},
    {d:'2027-04-25',t:'vrij',l:'Vrij',n:'Meivakantie 24 apr.-2 mei'},
    {d:'2027-05-02',t:'vrij',l:'Vrij',n:'Meivakantie 24 apr.-2 mei'},
    {d:'2027-05-06',t:'vrij',l:'Vrij',n:'Hemelvaartsdag'},
    {d:'2027-05-09',t:'vrij',l:'Vrij'},
    {d:'2027-05-15',t:'vrij',l:'Vrij'},
    {d:'2027-05-23',t:'wd',l:'Fase 4'},
    {d:'2027-05-30',t:'wd',l:'Fase 4'},
    {d:'2027-06-06',t:'vrij',l:'Vrij',n:'Finales Districtsbeker'}
  ],
  jun: [
    {d:'2026-08-16',t:'vrij',l:'Vrij',n:'Schoolvakanties N t/m 16 aug'},
    {d:'2026-08-23',t:'vrij',l:'Vrij',n:'Schoolvakanties Z t/m 23 aug.'},
    {d:'2026-08-30',t:'beker',l:'Beker',n:'Schoolvakanties M t/m 30 aug.'},
    {d:'2026-09-06',t:'beker',l:'Beker'},
    {d:'2026-09-13',t:'beker',l:'Beker'},
    {d:'2026-09-20',t:'wd',l:'Wedstrijddag najaar'},
    {d:'2026-09-27',t:'wd',l:'Wedstrijddag najaar'},
    {d:'2026-10-04',t:'wd',l:'Wedstrijddag najaar'},
    {d:'2026-10-11',t:'wd',l:'Wedstrijddag najaar',n:'Herfstvakantie N: 10-18 okt'},
    {d:'2026-10-18',t:'inhaal',l:'Inhaal / Beker',n:'Herfstvakantie alle regio\'s'},
    {d:'2026-10-25',t:'wd',l:'Wedstrijddag najaar',n:'Herfstvakantie M-Z: 17-25 okt'},
    {d:'2026-10-31',t:'wd',l:'Wedstrijddag najaar'},
    {d:'2026-11-08',t:'wd',l:'Wedstrijddag najaar'},
    {d:'2026-11-15',t:'wd',l:'Wedstrijddag najaar'},
    {d:'2026-11-22',t:'wd',l:'Wedstrijddag najaar'},
    {d:'2026-11-29',t:'wd',l:'Wedstrijddag najaar'},
    {d:'2026-12-06',t:'wd',l:'Wedstrijddag najaar'},
    {d:'2026-12-13',t:'inhaal',l:'Inhaal / Beker'},
    {d:'2026-12-20',t:'inhaal',l:'Inhaal / Beker',n:'Kerstvakantie 19 dec.-3 jan.'},
    {d:'2027-01-10',t:'vrij',l:'Vrij'},
    {d:'2027-01-17',t:'beker',l:'Beker'},
    {d:'2027-01-24',t:'wd',l:'Wedstrijddag voorjaar'},
    {d:'2027-01-31',t:'wd',l:'Wedstrijddag voorjaar'},
    {d:'2027-02-07',t:'vrij',l:'Vrij',n:'Carnavalsweekend'},
    {d:'2027-02-14',t:'inhaal',l:'Inhaal / Beker',n:'Vrj.vak. Z: 13-21 feb.'},
    {d:'2027-02-21',t:'inhaal',l:'Inhaal / Beker',n:'Vrj.vak. alle regio\'s'},
    {d:'2027-02-28',t:'wd',l:'Wedstrijddag voorjaar',n:'Vrj.vak. N-M: 20-28 feb'},
    {d:'2027-03-07',t:'wd',l:'Wedstrijddag voorjaar'},
    {d:'2027-03-14',t:'wd',l:'Wedstrijddag voorjaar'},
    {d:'2027-03-21',t:'wd',l:'Wedstrijddag voorjaar'},
    {d:'2027-03-27',t:'inhaal',l:'Inhaal / Beker',n:'Paaszaterdag'},
    {d:'2027-03-29',t:'inhaal',l:'Inhaal / Beker',n:'2e Paasdag'},
    {d:'2027-04-04',t:'wd',l:'Wedstrijddag voorjaar'},
    {d:'2027-04-11',t:'wd',l:'Wedstrijddag voorjaar'},
    {d:'2027-04-18',t:'wd',l:'Wedstrijddag voorjaar'},
    {d:'2027-04-25',t:'inhaal',l:'Inhaal / Beker',n:'Meivakantie 24 apr.-2 mei'},
    {d:'2027-05-02',t:'inhaal',l:'Inhaal / Beker',n:'Meivakantie 24 apr.-2 mei'},
    {d:'2027-05-06',t:'vrij',l:'Vrij',n:'Hemelvaartsdag'},
    {d:'2027-05-09',t:'wd',l:'Wedstrijddag voorjaar'},
    {d:'2027-05-15',t:'inhaal',l:'Inhaal / Beker'},
    {d:'2027-05-23',t:'wd',l:'Wedstrijddag voorjaar'}
  ],
  sen: [
    {d:'2026-08-16',t:'vrij',l:'Vrij',n:'Schoolvakanties N t/m 16 aug'},
    {d:'2026-08-23',t:'vrij',l:'Vrij',n:'Schoolvakanties Z t/m 23 aug.'},
    {d:'2026-08-30',t:'beker',l:'Beker',n:'Schoolvakanties M t/m 30 aug.'},
    {d:'2026-09-06',t:'beker',l:'Beker'},
    {d:'2026-09-13',t:'beker',l:'Beker'},
    {d:'2026-09-20',t:'wd',l:'Wedstrijddag'},
    {d:'2026-09-27',t:'wd',l:'Wedstrijddag'},
    {d:'2026-10-04',t:'wd',l:'Wedstrijddag'},
    {d:'2026-10-11',t:'wd',l:'Wedstrijddag',n:'Herfstvakantie N: 10-18 okt'},
    {d:'2026-10-18',t:'inhaal',l:'Inhaal / Beker',n:'Herfstvakantie alle regio\'s'},
    {d:'2026-10-25',t:'wd',l:'Wedstrijddag',n:'Herfstvakantie M-Z: 17-25 okt'},
    {d:'2026-10-31',t:'wd',l:'Wedstrijddag'},
    {d:'2026-11-08',t:'wd',l:'Wedstrijddag'},
    {d:'2026-11-15',t:'wd',l:'Wedstrijddag'},
    {d:'2026-11-22',t:'inhaal',l:'Inhaal / Beker'},
    {d:'2026-11-29',t:'wd',l:'Wedstrijddag'},
    {d:'2026-12-06',t:'wd',l:'Wedstrijddag'},
    {d:'2026-12-13',t:'inhaal',l:'Inhaal / Beker'},
    {d:'2026-12-20',t:'inhaal',l:'Inhaal / Beker',n:'Kerstvakantie 19 dec.-3 jan.'},
    {d:'2027-01-10',t:'inhaal',l:'Inhaal / Beker'},
    {d:'2027-01-17',t:'inhaal',l:'Inhaal / Beker'},
    {d:'2027-01-24',t:'wd',l:'Wedstrijddag'},
    {d:'2027-01-31',t:'wd',l:'Wedstrijddag'},
    {d:'2027-02-07',t:'vrij',l:'Vrij',n:'Carnavalsweekend'},
    {d:'2027-02-14',t:'inhaal',l:'Inhaal / Beker',n:'Vrj.vak. Z: 13-21 feb.'},
    {d:'2027-02-21',t:'wd',l:'Wedstrijddag',n:'Vrj.vak. alle regio\'s'},
    {d:'2027-02-28',t:'wd',l:'Wedstrijddag',n:'Vrj.vak. N-M: 20-28 feb'},
    {d:'2027-03-07',t:'wd',l:'Wedstrijddag'},
    {d:'2027-03-11',t:'beker',l:'Beker'},
    {d:'2027-03-14',t:'wd',l:'Wedstrijddag'},
    {d:'2027-03-21',t:'wd',l:'Wedstrijddag'},
    {d:'2027-03-27',t:'inhaal',l:'Inhaal / Beker',n:'Paaszaterdag'},
    {d:'2027-03-29',t:'inhaal',l:'Inhaal / Beker',n:'2e Paasdag'},
    {d:'2027-04-04',t:'wd',l:'Wedstrijddag'},
    {d:'2027-04-11',t:'wd',l:'Wedstrijddag'},
    {d:'2027-04-18',t:'wd',l:'Wedstrijddag'},
    {d:'2027-04-25',t:'inhaal',l:'Inhaal / Beker',n:'Meivakantie 24 apr.-2 mei'},
    {d:'2027-05-02',t:'inhaal',l:'Inhaal / Beker',n:'Meivakantie 24 apr.-2 mei'},
    {d:'2027-05-06',t:'beker',l:'Beker',n:'Hemelvaartsdag'},
    {d:'2027-05-09',t:'wd',l:'Wedstrijddag'},
    {d:'2027-05-15',t:'vrij',l:'Vrij'},
    {d:'2027-05-23',t:'wd',l:'Wedstrijddag'}
  ],
  mei: [
    {d:'2026-08-16',t:'vrij',l:'Vrij',n:'Schoolvakanties N t/m 16 aug'},
    {d:'2026-08-23',t:'vrij',l:'Vrij',n:'Schoolvakanties Z t/m 23 aug.'},
    {d:'2026-08-30',t:'wd',l:'Fase 1 · start',n:'Schoolvakanties M t/m 30 aug.'},
    {d:'2026-09-06',t:'wd',l:'Fase 1'},
    {d:'2026-09-13',t:'wd',l:'Fase 1'},
    {d:'2026-09-20',t:'wd',l:'Fase 1'},
    {d:'2026-09-27',t:'wd',l:'Fase 1'},
    {d:'2026-10-04',t:'wd',l:'Fase 1'},
    {d:'2026-10-11',t:'wd',l:'Fase 1',n:'Herfstvakantie N: 10-18 okt'},
    {d:'2026-10-18',t:'inhaal',l:'Inhaal',n:'Herfstvakantie alle regio\'s'},
    {d:'2026-10-25',t:'inhaal',l:'Inhaal',n:'Herfstvakantie M-Z: 17-25 okt'},
    {d:'2026-10-31',t:'wd',l:'Div Fase 2 - Hfdkl F2'},
    {d:'2026-11-08',t:'wd',l:'Div Fase 2 - Hfdkl F2'},
    {d:'2026-11-15',t:'wd',l:'Div Fase 2 - Hfdkl F2'},
    {d:'2026-11-22',t:'wd',l:'Div Fase 2 - Hfdkl F2'},
    {d:'2026-11-29',t:'wd',l:'Div Fase 2 - Hfdkl F2'},
    {d:'2026-12-06',t:'wd',l:'Div Fase 2 - Hfdkl F2'},
    {d:'2026-12-13',t:'wd',l:'Div Fase 2 - Hfdkl F2'},
    {d:'2026-12-20',t:'inhaal',l:'Inhaal',n:'Kerstvakantie 19 dec.-3 jan.'},
    {d:'2027-01-10',t:'vrij',l:'Vrij'},
    {d:'2027-01-17',t:'vrij',l:'Vrij'},
    {d:'2027-01-24',t:'wd',l:'Div Fase 2 - Hfdkl F3'},
    {d:'2027-01-31',t:'wd',l:'Div Fase 2 - Hfdkl F3'},
    {d:'2027-02-07',t:'vrij',l:'Vrij',n:'Carnavalsweekend'},
    {d:'2027-02-14',t:'inhaal',l:'Inhaal',n:'Vrj.vak. Z: 13-21 feb.'},
    {d:'2027-02-21',t:'wd',l:'Div Inhaal - Hfdkl F3',n:'Vrj.vak. alle regio\'s'},
    {d:'2027-02-28',t:'wd',l:'Div Fase 2 - Hfdkl F3',n:'Vrj.vak. N-M: 20-28 feb'},
    {d:'2027-03-07',t:'wd',l:'Div Fase 2 - Hfdkl F3'},
    {d:'2027-03-14',t:'wd',l:'Div Fase 2 - Hfdkl F3'},
    {d:'2027-03-21',t:'wd',l:'Div Fase 2 - Hfdkl F3'},
    {d:'2027-03-27',t:'inhaal',l:'Inhaal',n:'Paaszaterdag'},
    {d:'2027-03-29',t:'vrij',l:'Vrij',n:'2e Paasdag'},
    {d:'2027-04-04',t:'wd',l:'Div Fase 2 - Hfdkl F3'},
    {d:'2027-04-11',t:'wd',l:'Div Fase 2 - Hfdkl F3'},
    {d:'2027-04-18',t:'wd',l:'Div Fase 2 - Hfdkl F3'},
    {d:'2027-04-25',t:'inhaal',l:'Inhaal',n:'Meivakantie 24 apr.-2 mei'},
    {d:'2027-05-02',t:'inhaal',l:'Inhaal',n:'Meivakantie 24 apr.-2 mei'},
    {d:'2027-05-06',t:'vrij',l:'Vrij',n:'Hemelvaartsdag'},
    {d:'2027-05-09',t:'wd',l:'Div Fase 2 - Hfdkl F3'},
    {d:'2027-05-15',t:'wd',l:'Div Inhaal - Hfdkl F3'},
    {d:'2027-05-23',t:'wd',l:'Div Fase 2 - Hfdkl F3'},
    {d:'2027-05-30',t:'wd',l:'Hfdkl Fase 3'},
    {d:'2027-06-06',t:'wd',l:'Final League',n:'Finales Districtsbeker'}
  ],
};

/* map een team-categorie naar de juiste KNVB-kolom */
export function kalenderKolomVoorCategorie(categorie){
  const c = String(categorie||'').toUpperCase();
  if (c === 'SENIOREN' || c === 'VROUWEN') return 'sen';
  const m = c.match(/^([JM])O(\d+)/);
  if (m){
    const meiden = m[1] === 'M';
    const lft = Number(m[2]);
    if (lft <= 12) return 'pup';
    return meiden ? 'mei' : 'jun';
  }
  return 'jun';
}
export function knvbKalenderVoorTeam(team){
  const kol = kalenderKolomVoorCategorie(team?.categorie);
  return KNVB_KALENDER[kol] || KNVB_KALENDER.jun;
}

/* ==================== ONTWIKKELDOMEINEN (ASV'33 hybride model) ====================
   De 4 voetbal-skills (Technisch/Tactisch/Fysiek/Mentaal) + een pedagogische laag
   (Gedrag & beleving), zoals 4-Skills en het Jeugdbeleidsplan ASV'33 voorstaan:
   "Leren voetballen, met plezier als basis en groei als doel."
   De pedagogische laag komt uit §5 (normen & waarden, teamgevoel, inzet, plezier). */
export const SKILLS = [
  {id:'TE', naam:'Technisch', omschrijving:'Balbeheersing, traptechniek, 1v1 — elke 1v1 durven aangaan'},
  {id:'TA', naam:'Tactisch',  omschrijving:'Inzicht, positiespel, keuzes maken, omschakelen'},
  {id:'FY', naam:'Fysiek',    omschrijving:'Snelheid, actiesnelheid, duelkracht, fitheid'},
  {id:'ME', naam:'Mentaal',   omschrijving:'Zelfvertrouwen, durven kiezen, spelen onder weerstand'},
  {id:'GE', naam:'Gedrag & beleving', omschrijving:'Inzet, teamgevoel, normen & waarden, plezier'},
];
export function skillDomein(id){ return SKILLS.find(s => s.id === id) || null; }
/* alias voor compatibiliteit met eerdere code die 'tipsDomein' aanriep */
export const TIPS = SKILLS;
export function tipsDomein(id){ return skillDomein(id); }

/* ==================== LEERCURVE (Jeugdbeleidsplan §3.3) ====================
   De 14 leerthema's met de leeftijd waarop ze "aan" gaan. Per thema geven we
   de minimale leeftijd (O-getal) en het bijbehorende skill-domein, zodat de app
   leerpunten kan voorstellen die passen bij de leeftijdscategorie van het team.
   Alle thema's blijven altijd kiesbaar; de leeftijdsrelevante worden gemarkeerd. */
/* ==================== LEERCURVE (Jeugdbeleidsplan §3.3) ====================
   De 14 leerthema's met de leeftijd waarop ze "aan" gaan. Per thema: minimale
   leeftijd (O-getal) en het bijbehorende skill-domein, zodat de app leerpunten
   kan voorstellen die passen bij de leeftijdscategorie van het team.
   De bewerkbare tekst (achtergrond + tips per thema) staat NIET meer hier,
   maar in de Firestore-collectie 'content' — zie content.js:contentVoorThema().
   Alle thema's blijven altijd kiesbaar; de leeftijdsrelevante worden gemarkeerd. */
export const LEERCURVE = [
  {thema:"Teamsport en plezier", vanaf:6, domein:"GE"},
  {thema:"Technische vaardigheden", vanaf:6, domein:"TE"},
  {thema:"Uitspelen 1:1", vanaf:8, domein:"TE"},
  {thema:"Scoren", vanaf:8, domein:"TE"},
  {thema:"Positiespel opbouw", vanaf:8, domein:"TA"},
  {thema:"Dieptespel opbouw", vanaf:8, domein:"TA"},
  {thema:"Storen en veroveren", vanaf:10, domein:"TA"},
  {thema:"Verdedigen dieptespel", vanaf:10, domein:"TA"},
  {thema:"Verdedigen 1:1", vanaf:10, domein:"TE"},
  {thema:"Voorkomen van doelpunten", vanaf:10, domein:"TA"},
  {thema:"Aanvallen met voorzet", vanaf:11, domein:"TA"},
  {thema:"Verdedigen van voorzet", vanaf:11, domein:"TA"},
  {thema:"Omschakelen balwinst", vanaf:14, domein:"TA"},
  {thema:"Omschakelen balverlies", vanaf:14, domein:"TA"},
];

/* Vind een leercurve-thema op naam, bijv. voor het openen van het infoscherm
   vanuit een string (adviesCat.leercurve, een gekozen leerpunt-tekst, etc). */
export function leercurveThema(naam){ return LEERCURVE.find(t => t.thema === naam) || null; }

/* haal het leeftijdsgetal uit een categorie: 'JO11' → 11, 'MO13' → 13, 'Senioren' → 99 */
export function leeftijdVanCategorie(categorie){
  const m = String(categorie||'').match(/O(\d+)/);
  if (m) return Number(m[1]);
  return 99; // Senioren / Vrouwen → alles relevant
}
/* is een leercurve-thema relevant voor deze categorie? */
export function leercurveRelevant(thema, categorie){
  const lft = leeftijdVanCategorie(categorie);
  return lft >= thema.vanaf;
}

/* Gouden regels en ASV-kompas-tips (§3.1/§3.4) zijn verplaatst naar de
   Firestore-collectie 'content' (zie content.js) — daar zijn ze te bewerken
   via het clubdashboard-tabblad "Content", zonder JS aan te passen.
   isoWeek()/kompasIndexVoorWeek() blijven hier staan: dit is pure logica
   (weeknummerberekening), geen bewerkbare tekst. */

/* ISO-weeknummer van vandaag, gebruikt om de kompas-tip per week te bepalen. */
export function isoWeek(d = new Date()){
  const dt = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const dagNr = (dt.getUTCDay() + 6) % 7;
  dt.setUTCDate(dt.getUTCDate() - dagNr + 3);
  const eersteDonderdag = new Date(Date.UTC(dt.getUTCFullYear(), 0, 4));
  const weekNr = 1 + Math.round(((dt - eersteDonderdag) / 86400000 - 3 + ((eersteDonderdag.getUTCDay() + 6) % 7)) / 7);
  return weekNr;
}
/* aantal: KOMPAS_TIPS.length van de dag zelf (content.kompasTips().length) —
   als parameter meegeven i.p.v. hardcoded, want de lijst leeft nu in content.js. */
export function kompasIndexVoorWeek(aantal, week = isoWeek()){
  if (!aantal) return 0;
  return ((week % aantal) + aantal) % aantal;
}

/* Formatie-uitgangspunt van de club (§3.2): 1:4:3:3, omschakelend naar 1:3:4:3 bij balbezit. */
export const CLUB_FORMATIE_11 = '4-3-3';

/* ==================== WEDSTRIJDDOEL-SUGGESTIES (§3.1 t/m §3.4) ====================
   Korte, concrete voorbeelden per leeftijdsband, aansluitend op de leercurve (§3.3),
   de gouden regels (§3.1) en de gewenste speelwijze (§3.2). Puur als inspiratie bij
   het invullen van het vrije 🎯 Wedstrijddoel-veld — nooit verplicht, altijd overschrijfbaar. */
const DOEL_SUGGESTIES_BANDEN = [
  {tot:9,  teksten:[
    'Iedereen probeert minstens 1x een 1-tegen-1',
    'Na balverovering meteen naar het doel dribbelen',
    'Een actie proberen met het zwakke been',
    'Iedereen minstens 1x een doelpoging',
  ]},
  {tot:12, teksten:[
    'Bij balbezit rustig opbouwen van achteruit',
    'Direct druk zetten binnen 5 seconden na balverlies',
    'Voorkomen dat de tegenstander je 1-tegen-1 passeert',
    'Positiespel: steeds een passlijn aanbieden',
  ]},
  {tot:15, teksten:[
    'Voorzetten geven vanaf de zijkant',
    'Snel omschakelen bij balwinst — meteen vooruit denken',
    'Tegenstander naar de zijlijn dwingen bij verdedigen',
    'Bewust omschakelen bij balverlies: direct terugzakken of aftroeven',
  ]},
  {tot:99, teksten:[
    'Bij balbezit een verdediger laten inschuiven naar het middenveld',
    'Compact blijven staan — linies dicht bij elkaar',
    'Constant coachen van je medespelers',
    'Bewust balverlies voorkomen in de opbouw',
  ]},
];
/* geeft 3 roterende suggesties terug, passend bij de categorie van het team. */
export function doelSuggesties(categorie, n = 3){
  const lft = leeftijdVanCategorie(categorie);
  const band = DOEL_SUGGESTIES_BANDEN.find(b => lft <= b.tot) || DOEL_SUGGESTIES_BANDEN[DOEL_SUGGESTIES_BANDEN.length-1];
  const start = isoWeek() % band.teksten.length;
  const uit = [];
  for (let i = 0; i < Math.min(n, band.teksten.length); i++) uit.push(band.teksten[(start+i) % band.teksten.length]);
  return uit;
}

/* niveau 1..5 → kleur + label. Index 0 blijft leeg (scores beginnen bij 1). */
export const NIVEAUS = [
  null,
  {n:1, kleur:'#E5484D', label:'Aandacht',  kort:'AAND'},
  {n:2, kleur:'#F2913C', label:'Op weg',    kort:'OPW'},
  {n:3, kleur:'#F2C94C', label:'Prima',     kort:'PRIMA'},
  {n:4, kleur:'#7DCB6A', label:'Sterk',     kort:'STERK'},
  {n:5, kleur:'#2EA043', label:'Uitblinker',kort:'UITBL'},
];
export function niveau(n){ return NIVEAUS[n] || null; }
export function niveauKleur(n){ return NIVEAUS[n]?.kleur || '#EFEFED'; }

/* Snelle 'opvallend'-tags (optioneel aan te tikken na een wedstrijd/training). */
export const SNEL_TAGS = [
  {id:'inzet',    emoji:'💪', label:'Goede inzet'},
  {id:'duel',     emoji:'🎯', label:'Sterk in 1v1'},
  {id:'team',     emoji:'🤝', label:'Teamspeler'},
  {id:'snel',     emoji:'⚡', label:'Snel'},
  {id:'inzicht',  emoji:'🧠', label:'Goed inzicht'},
  {id:'coach',    emoji:'📣', label:'Coachbaar'},
  {id:'plezier',  emoji:'😄', label:'Veel plezier'},
  {id:'leider',   emoji:'👑', label:'Neemt leiding'},
];
export function snelTag(id){ return SNEL_TAGS.find(t => t.id === id) || null; }

/* ==================== TEAMEVALUATIE (na de wedstrijd) ====================
   8 categorieën voor de teambeoordeling na een wedstrijd. Waar een categorie
   overeenkomt met een leercurve-thema (§3.3), leggen we dat verband vast —
   dat is de schakel voor het automatische trainingsadvies. */
export const TEAM_CATEGORIEEN = [
  {id:'inzet',        naam:'Inzet & concentratie'},
  {id:'samenwerking', naam:'Samenwerking & communicatie'},
  {id:'taken',         naam:'Taakuitvoering per linie'},
  {id:'opbouw',        naam:'Opbouw van achteruit',              leercurve:'Positiespel opbouw'},
  {id:'omschakeling',  naam:'Omschakeling bij balverlies/-winst', leercurve:'Omschakelen balverlies'},
  {id:'druk',          naam:'Druk zetten & veroveren',            leercurve:'Storen en veroveren'},
  {id:'plezier',       naam:'Spelplezier'},
  {id:'coachbaar',     naam:'Coachbaarheid'},
];
export function teamCategorie(id){ return TEAM_CATEGORIEEN.find(c => c.id === id) || null; }

/* Snelle 'opvallend'-tags voor de teamevaluatie (los van de speler-tags hierboven). */
export const TEAM_TAGS = [
  {id:'samenwerking', emoji:'🤝', label:'Goede samenwerking'},
  {id:'geluisterd',   emoji:'📣', label:'Goed geluisterd'},
  {id:'plezier',      emoji:'😄', label:'Veel plezier'},
  {id:'afspraken',    emoji:'⚠️', label:'Afspraken niet nagekomen'},
  {id:'sterke2e',     emoji:'🔥', label:'Sterke 2e helft'},
  {id:'terugval',     emoji:'📉', label:'Terugval na rust'},
];
