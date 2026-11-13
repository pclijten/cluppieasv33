/* ==================== VOLLEDIGE BEOORDELING: criteria, niveau-ladder, naslag ====================
   [20261113v] Vervangt de oude volledige beoordeling (één score per domein) door
   het scherm uit de mockup /ramonneke/: 22 criteria verdeeld over de 5 domeinen,
   met per niveau een vaste betekenis (de "ladder"), ⓘ-uitleg per criterium en
   domein, en de naslag "Zo beoordelen we" (Kort + Verdieping).

   Datamodel (teams-spelers.js slaat op):
     criteria: { 'TE-0': 1..5, ... }   ← nieuw, per criterium
     scores:   { TE: 1..5, ... }       ← afgerond gemiddelde per domein; alle
                                         bestaande schermen (radar, kaartcijfer,
                                         bouw-dashboards) lezen dit veld ongewijzigd.
   Ladders: TE/FY = Dave (motorisch leren), TA = Bloom (denken), ME/GE = Krathwohl
   (houding). De snelle beoordeling krijgt één algemene ladder.

   Deze module is een blad: ze importeert alleen icons.js en config.js, zodat
   een wijziging hier geen grote versie-cascade geeft. */
import { ico } from './icons.js?v=20261106r';
import { SKILLS, leeftijdVanCategorie } from './config.js?v=20261111g';

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const domIco = id => SKILLS.find(s => s.id === id)?.ico || 'stats-bars';

/* ---------- Criteria per domein (uit de mockup, jeugdbeleidsplan §3.3 + 4-Skills) ---------- */
export const VB_DOMEINEN = [
  {id:'TE', naam:'Technisch', omschrijving:'Balbeheersing, traptechniek, 1v1: elke 1v1 durven aangaan', criteria:[
    {naam:'Balbehandeling / -controle', uitleg:'Neemt de bal soepel aan, houdt hem dicht bij de voet, blijft in balans.', beleid:'Technische vaardigheden', vanaf:6, skill4:'Basistechniek'},
    {naam:'Schieten / afwerken', uitleg:'Kiest de juiste techniek en plaatsing bij het afronden van een kans.', beleid:'Scoren', vanaf:8, skill4:'Basistechniek'},
    {naam:'Passen', uitleg:'Speelt de bal met de juiste snelheid en richting naar een medespeler.', skill4:'Basistechniek'},
    {naam:'Individuele actie (1:1 uitspelen)', uitleg:'Durft de tegenstander 1-tegen-1 uit te spelen met een schijnbeweging of snelheid.', beleid:'Uitspelen 1:1', vanaf:8, skill4:'Domineren 1v1, kappen/draaien/trucs'},
    {naam:'Verdedigen 1-tegen-1', uitleg:'Verdedigt een directe tegenstander: houdt afstand, kiest het juiste moment om in te tikken.', beleid:'Verdedigen 1:1', vanaf:10, skill4:'Domineren 1v1'},
  ]},
  {id:'TA', naam:'Tactisch', omschrijving:'Inzicht, positiespel, keuzes maken, omschakelen', criteria:[
    {naam:'Positiegevoel', uitleg:'Staat op de juiste plek ten opzichte van bal, tegenstander en medespelers, zonder dat te hoeven zeggen.', skill4:'De juiste keuze maken'},
    {naam:'Verdedigen', uitleg:'Kiest het juiste moment om druk te zetten of af te wachten, dekt de juiste man of ruimte.', beleid:'Bundelt Storen en veroveren, Verdedigen dieptespel en Voorkomen van doelpunten (§3.3)', skill4:'Aanvallend/verdedigend spel'},
    {naam:'Verdedigen van voorzet', uitleg:'Verdedigt een voorzet: kiest positie ten opzichte van de tegenstander in het strafschopgebied en de timing van inspringen.', beleid:'Verdedigen van voorzet', vanaf:11, skill4:'Aanvallend/verdedigend spel'},
    {naam:'Aanvallen', uitleg:'Zoekt de vrije ruimte op, biedt zich aan, maakt het speelveld groot.', beleid:'Bundelt Positiespel opbouw, Dieptespel opbouw en Aanvallen met voorzet (§3.3)', skill4:'Aanvallend/verdedigend spel'},
    {naam:'Samenspel / oog voor medespeler', uitleg:'Ziet een vrijstaande medespeler en speelt de bal op tijd over.', skill4:'De juiste keuze maken'},
    {naam:'Omschakelen (bij balwinst/-verlies)', uitleg:'Schakelt direct van aanvallen naar verdedigen en andersom, zodra de bal van bezit wisselt.', beleid:'Omschakelen balwinst + Omschakelen balverlies', vanaf:14, skill4:'De juiste keuze maken'},
  ]},
  {id:'FY', naam:'Fysiek', omschrijving:'Snelheid, actiesnelheid, duelkracht, fitheid', criteria:[
    {naam:'Duelkracht', uitleg:'Houdt stand in een fysiek duel, wint de bal terug in een twee-strijd.', skill4:'Kracht'},
    {naam:'Snelheid', uitleg:'Sprintsnelheid over een korte afstand, bijvoorbeeld bij een counter of terugzakken.', skill4:'Snelheid'},
    {naam:'Coördinatie', uitleg:'Balans en lichaamsbeheersing bij richting veranderen, springen of draaien.'},
    {naam:'Conditionele gesteldheid', uitleg:'Houdt hetzelfde niveau vast tot het einde van de training of wedstrijd.', skill4:'Conditie'},
  ]},
  {id:'ME', naam:'Mentaal', omschrijving:'Zelfvertrouwen, durven kiezen, spelen onder weerstand', criteria:[
    {naam:'Motivatie tijdens trainingen', uitleg:'Werkt actief mee, vraagt door, wil zichzelf steeds verbeteren.', skill4:'Attitude'},
    {naam:'Omgaan met tegenslag / teleurstelling', uitleg:'Blijft doorzetten en positief na een fout, tegendoelpunt of verlies.', skill4:'Winnaarsmentaliteit'},
    {naam:'Zelfvertrouwen', uitleg:'Durft een actie te maken of risico te nemen, ook als het eerder misging.', skill4:'Persoonlijkheid'},
  ]},
  {id:'GE', naam:'Gedrag & beleving', omschrijving:'Inzet, teamgevoel, normen & waarden, plezier', criteria:[
    {naam:'Opkomst', uitleg:'Is op tijd aanwezig bij trainingen, meldt zich tijdig af bij verhindering.'},
    {naam:'Omgang met andere spelers', uitleg:'Gaat respectvol om met teamgenoten, zowel bij winst als verlies.'},
    {naam:'Luisteren / aandacht tijdens training', uitleg:'Blijft gefocust tijdens uitleg, kan een aanwijzing direct toepassen.'},
    {naam:'Teamsport en plezier', uitleg:'Speelt met plezier, viert successen samen, voelt zich onderdeel van het team.', beleid:'Teamsport en plezier', vanaf:6},
  ]},
];
export const critSleutel = (domId, i) => `${domId}-${i}`;

// §3.3 Leercurve: vanaf welke leeftijdskolom een thema meetelt (p.10).
const BRACKETS = ['O6/O7','O8/O9','O10','O11/O12','O13','O14/O15','O16/O17','O18/O19'];
const THEMA_MATRIX = {
  'Technische vaardigheden': {domein:'TE', kolom:0}, 'Uitspelen 1:1': {domein:'TE', kolom:1},
  'Scoren': {domein:'TE', kolom:1}, 'Verdedigen 1:1': {domein:'TE', kolom:2},
  'Positiespel opbouw': {domein:'TA', kolom:1}, 'Dieptespel opbouw': {domein:'TA', kolom:1},
  'Storen en veroveren': {domein:'TA', kolom:2}, 'Verdedigen dieptespel': {domein:'TA', kolom:2},
  'Voorkomen van doelpunten': {domein:'TA', kolom:2}, 'Aanvallen met voorzet': {domein:'TA', kolom:3},
  'Verdedigen van voorzet': {domein:'TA', kolom:3}, 'Omschakelen balwinst': {domein:'TA', kolom:5},
  'Omschakelen balverlies': {domein:'TA', kolom:5}, 'Teamsport en plezier': {domein:'GE', kolom:0},
};
// Letterlijke citaten uit het jeugdbeleidsplan, met paginaverwijzing.
const CITATEN = {
  TE: [{tekst:'Spelers de kans bieden om basistechniek en coördinatie te trainen en te verbeteren', bron:'§3.1 Rode draad, p.8'},
       {tekst:'Iedere speler een bal · Veel herhalingen en balcontacten · Stimuleren om beide benen te gebruiken', bron:'§3.1 Gouden regels, p.8'}],
  TA: [{tekst:'Technisch verzorgd, herkenbaar en sportief voetbal spelen', bron:'§3.1 Rode draad, p.8'},
       {tekst:'Goed positiespel en het gedisciplineerd uitvoeren van tactische opdrachten zijn belangrijke aandachtspunten in de opleiding', bron:'§3.2 Gewenste speelwijze, p.9'}],
  FY: [{tekst:'Fitheid en vitaliteit bij onze spelers', bron:'§3.1 Rode draad, p.8'},
       {tekst:'De conditie verbeter je door veel te voetballen. Trainingsvormen zonder bal leveren geen directe bijdrage aan het beter aanvallen, verdedigen en omschakelen van een speler.', bron:'§3.4 Conditie, p.12'}],
  ME: [{tekst:'Spelers leren om onder weerstand te spelen', bron:'§3.1 Rode draad, p.8'},
       {tekst:'Deze spelers voorbereiden op het spelen onder druk en prestaties leveren onder weerstand', bron:'§2.2 Missie, p.4'}],
  GE: [{tekst:'Plezier in het voetbal en een positieve sfeer in en rondom het team', bron:'§2.2 Missie, p.4'},
       {tekst:'Plezier, inzet en samenspel · Positief coachen', bron:'§3.1 Gouden regels, p.8'},
       {tekst:'Je bent respectvol naar medespelers, tegenstanders, scheidsrechters, trainers, leiders, publiek en verenigingen', bron:'§5.1 Individuele- en groepsdiscipline, p.23'}],
};

/* ---------- Niveau-ladders ---------- */
export const NIV_LABEL = [null,'Aandacht','Op weg','Prima','Sterk','Uitblinker'];
export const LADDERS = {
  dave: { naam:'Beheersing', model:'Dave · motorisch leren', bron:'Ravindra Dave (1970), ladder voor motorisch leren', domeinen:['TE','FY'],
    treden:[null,
      {trede:'Nadoen',        tekst:'Doet het na als er een voorbeeld bij is.'},
      {trede:'Op instructie', tekst:'Voert het uit op aanwijzing, zolang er geen druk is.'},
      {trede:'Zuiver',        tekst:'Voert het zuiver uit, ook in tempo.'},
      {trede:'Onder druk',    tekst:'Combineert en past het aan onder weerstand van een tegenstander.'},
      {trede:'Vanzelf',       tekst:'Gaat automatisch, ook creatief en onder hoge druk.'}]},
  bloom: { naam:'Inzicht', model:'Bloom · denken en keuzes maken', bron:'Benjamin Bloom (1956, herzien 2001), taxonomie van Bloom', domeinen:['TA'],
    treden:[null,
      {trede:'Herkent nog niet', tekst:'Ziet de situatie nog niet; heeft uitleg en sturing nodig.'},
      {trede:'Begrijpt',         tekst:'Snapt de uitleg en past het toe met hulp van de coach.'},
      {trede:'Past toe',         tekst:'Past het zelfstandig toe in de wedstrijd.'},
      {trede:'Kiest bewust',     tekst:'Ziet wat er gebeurt en kiest bewust de beste oplossing.'},
      {trede:'Bedenkt & coacht', tekst:'Bedenkt eigen oplossingen en stuurt medespelers aan.'}]},
  krathwohl: { naam:'Houding', model:'Krathwohl · houding en gedrag', bron:'David Krathwohl (1964), ladder voor houding', domeinen:['ME','GE'],
    treden:[null,
      {trede:'Luistert',         tekst:'Hoort het aan, maar het komt nog niet van zichzelf.'},
      {trede:'Doet mee',         tekst:'Laat het zien als erom gevraagd wordt.'},
      {trede:'Wil het zelf',     tekst:'Laat het uit zichzelf zien, ook zonder aansporing.'},
      {trede:'Houdt vol',        tekst:'Stelt eigen doelen en houdt dat vol, ook als het tegenzit.'},
      {trede:'Is een voorbeeld', tekst:'Is hierin een voorbeeld voor anderen in het team.'}]},
};
/* Snelle beoordeling: één algemeen niveau, dus één algemene ladder. */
export const SNEL_LADDER = [null,
  'Kwam er nog niet goed in; had veel hulp nodig.',
  'Liet het zien met hulp, of zolang er geen druk was.',
  'Deed zelfstandig wat je op deze leeftijd mag verwachten.',
  'Ging goed, ook onder druk; maakte bewuste keuzes.',
  'Was een voorbeeld voor anderen.'];
export const ladderVan = domId => Object.values(LADDERS).find(l => l.domeinen.includes(domId));

/* Fases uit het opleidingsmodel (Meulensteen/KNVB), gekoppeld aan de leeftijd van het team. */
const FASES = [
  {tot:9,  naam:'Basisfase',      leeft:'O6–O9',   nadruk:'Techniek', stap:'Aanleren: nadoen en begrijpen. Lage scores op TA en ME zijn hier normaal.', kort:['Aanleren','nadoen en begrijpen']},
  {tot:12, naam:'Herhalingsfase', leeft:'O10–O12', nadruk:'Tactiek',  stap:'Toepassen: technieken tactisch inzetten en zelf keuzes leren maken.', kort:['Toepassen','techniek inzetten in het spel']},
  {tot:15, naam:'Competitiefase', leeft:'O13–O15', nadruk:'Fysiek',   stap:'Analyseren: bewust kiezen wanneer wat, met rendement als doel.', kort:['Analyseren','bewust kiezen wanneer wat']},
  {tot:999,naam:'Winfase',        leeft:'O16–O19', nadruk:'Mentaal',  stap:'Evalueren en creëren: eigen oplossingen, elkaar coachen.', kort:['Evalueren','zelf oplossen, elkaar coachen']},
];
export const faseVan = lft => FASES.find(f => lft <= f.tot);
export const leeftijdTeam = categorie => leeftijdVanCategorie(categorie);
export const critZichtbaar = (c, lft) => !c.vanaf || lft >= c.vanaf;

/* Afgerond gemiddelde per domein uit de criteriumscores (alleen zichtbare criteria).
   Domein zonder ingevulde criteria → valt terug op `oud` (een eerdere domeinscore). */
export function domeinScores(criteria, lft, oud = {}){
  const uit = {};
  for (const d of VB_DOMEINEN){
    const w = d.criteria.map((c, i) => critZichtbaar(c, lft) ? criteria[critSleutel(d.id, i)] : null).filter(n => n >= 1 && n <= 5);
    if (w.length) uit[d.id] = Math.round(w.reduce((a, b) => a + b, 0) / w.length);
    else if (oud[d.id] >= 1 && oud[d.id] <= 5) uit[d.id] = oud[d.id];
  }
  return uit;
}

/* ---------- HTML-bouwstenen ---------- */
function ladderHtml(l){
  return l.treden.slice(1).map((t, i) => `
    <div class="vb-ladder-rij"><span class="vb-chip kn${i+1}">${NIV_LABEL[i+1]}</span><span class="tx">${t.tekst}<small>${t.trede}</small></span></div>`).join('')
    + `<div class="vb-ladder-bron">Gebaseerd op <b>${l.bron}</b>. <button type="button" data-vb-naslag>Lees hoe we beoordelen</button></div>`;
}
export function htmlNaslagLink(compact = false){
  return `<button type="button" class="vb-naslag-link${compact ? ' compact' : ''}" data-vb-naslag>
    <span class="ic">${ico('training-plan', 18)}</span>
    <span class="tx">Zo beoordelen we<small>Achtergrond bij de niveaus · Bloom, Krathwohl en Dave</small></span>
    <span class="vb-pijl">${ico('navigation-forward', 16)}</span></button>`;
}
export function htmlSnelAnker(n){
  return n ? `<b style="color:var(--n${n})">${NIV_LABEL[n]}</b> · ${SNEL_LADDER[n]}` : '';
}

/* Formulier met de 5 domeinkaarten. `waarden` = {criteria, notities, oud} */
export function htmlVolledigFormulier({ lft, waarden, alleenLezen = false }){
  const { criteria = {}, notities = {}, oud = {} } = waarden || {};
  const kaart = d => {
    const items = d.criteria.map((c, i) => ({ c, i })).filter(x => critZichtbaar(x.c, lft));
    return `<div class="vb-kaart" data-vb-dom="${d.id}">
      <div class="vb-dom-kop">
        <span class="vb-dom-ic">${ico(domIco(d.id), 17)}</span>
        <span class="vb-veldlabel">${d.id} · ${esc(d.naam)}</span>
        <button type="button" class="vb-info" data-vb-info="dom" data-dom="${d.id}" aria-label="Uitleg ${esc(d.naam)}">i</button>
        <span class="vb-aantal">${items.length}</span>
      </div>
      ${oud[d.id] && !items.some(x => criteria[critSleutel(d.id, x.i)]) ? `<div class="vb-oud">Eerder ingevuld als domeinscore: <b style="color:var(--n${oud[d.id]})">${NIV_LABEL[oud[d.id]]}</b>. Vul de criteria in om die te vervangen.</div>` : ''}
      ${items.map(({ c, i }) => {
        const k = critSleutel(d.id, i), gekozen = criteria[k] || 0, t = gekozen ? ladderVan(d.id).treden[gekozen] : null;
        return `<div class="vb-crit">
          <div class="vb-crit-naam"><span>${esc(c.naam)}${c.vanaf ? `<span class="vb-badge">vanaf O${c.vanaf}</span>` : ''}</span>
            <button type="button" class="vb-info${(c.beleid || c.skill4) ? ' koppeling' : ''}" data-vb-info="crit" data-dom="${d.id}" data-idx="${i}" aria-label="Uitleg ${esc(c.naam)}">i</button></div>
          <div class="vb-schaal" data-vb-crit="${k}" data-dom="${d.id}" role="radiogroup" aria-label="${esc(c.naam)}">
            ${[1,2,3,4,5].map(n => `<button type="button" data-niv="${n}" class="kn${n}${gekozen === n ? ' gekozen' : ''}" aria-label="${NIV_LABEL[n]}"${alleenLezen ? ' disabled' : ''}></button>`).join('')}
          </div>
          <div class="vb-anker${t ? ' toon' : ''}">${t ? `<b style="color:var(--n${gekozen})">${NIV_LABEL[gekozen]}</b> · ${t.tekst}` : ''}</div>
        </div>`;
      }).join('')}
      <textarea class="invoer" data-vb-not="${d.id}" rows="2" placeholder="Toelichting ${esc(d.naam.toLowerCase())}…"${alleenLezen ? ' readonly' : ''}>${esc(notities[d.id] || '')}</textarea>
    </div>`;
  };
  return `<div class="vb-legenda"><span>AAND</span><span>OP WEG</span><span>PRIMA</span><span>STERK</span><span>UITBL</span></div>
    <button type="button" class="vb-legenda-info" data-vb-info="ladders"><span class="vb-info">i</span>Wat betekent elk niveau?</button>
    ${VB_DOMEINEN.map(kaart).join('')}`;
}

/* Samenvatting bovenaan. `s` komt uit teams-spelers.js (echte spelerdata). */
export function htmlSamenvatting(s){
  const pct = v => v == null ? '–' : v + '%';
  const trendPijl = {op:'↑', gelijk:'→', neer:'↓'};
  return `<div class="vb-samenvatting">
    <div class="vb-sv-grid">
      <div class="vb-sv-box"><div class="v">${pct(s.opkomst)}</div><div class="l">Opkomst</div></div>
      <div class="vb-sv-box"><div class="v">${pct(s.speeltijd)}</div><div class="l">Speeltijd</div><div class="sub">v. speelbaar</div></div>
      <div class="vb-sv-box"><div class="v">${pct(s.reserve)}</div><div class="l">Reserve</div><div class="sub">v. speelbaar</div></div>
      <div class="vb-sv-box"><div class="v">${esc(s.laatsteKort || '–')}</div><div class="l">Laatste beoord.</div><div class="sub">${esc(s.laatsteDatum || '')}</div></div>
    </div>
    ${s.posities.length ? `<div class="vb-sv-label">Meest gespeelde posities</div>
      <div class="vb-pos-balk">${s.posities.map(p => `<div style="width:${p.pct}%;background:${p.kleur}"></div>`).join('')}</div>
      <div class="vb-pos-legend">${s.posities.map(p => `<span><span class="dot" style="background:${p.kleur}"></span>${esc(p.naam)} · ${p.pct}%</span>`).join('')}</div>` : ''}
    <div class="vb-sv-label">Gemiddelde score per domein <span class="extra">· laatste 3 volledige beoordelingen</span></div>
    ${s.domeinen ? `<div class="vb-dom-rij">${VB_DOMEINEN.map(d => {
        const g = s.domeinen[d.id];
        return g ? `<button type="button" class="vb-dom-mini" data-vb-info="dom" data-dom="${d.id}"><span class="id">${d.id}</span><span class="stip kn${g.s}">${g.s}</span><span class="trend ${g.t}">${trendPijl[g.t]} ${NIV_LABEL[g.s] === 'Uitblinker' ? 'Uitbl.' : NIV_LABEL[g.s]}</span></button>`
                 : `<button type="button" class="vb-dom-mini leeg" data-vb-info="dom" data-dom="${d.id}"><span class="id">${d.id}</span><span class="stip">–</span><span class="trend gelijk">nog niet</span></button>`;
      }).join('')}</div>` : `<p class="vb-sv-leeg">Nog geen volledige beoordeling: dit wordt de eerste.</p>`}
    <div class="vb-sv-rij"><span class="ic">${ico('stats-bars', 17)}</span><span class="tx"><b>${s.leerpunten.length ? s.leerpunten.length + ' open ' + (s.leerpunten.length === 1 ? 'leerpunt' : 'leerpunten') : 'Geen open leerpunten'}</b>${s.leerpunten.length ? `<span class="sub">${esc(s.leerpunten.join(' · '))}</span>` : ''}</span></div>
    ${s.notitie ? `<div class="vb-sv-rij"><span class="ic">${ico('communication-chat', 17)}</span><span class="tx"><b>Notitie</b><span class="sub">${esc(s.notitie)}</span></span></div>` : ''}
  </div>`;
}

/* ---------- Gedrag: schaal, ankers, popups, naslag ---------- */
export function koppelVolledigFormulier(root, { lft, waarden, alleenLezen = false }){
  root.querySelectorAll('.vb-schaal').forEach(sch => {
    sch.querySelectorAll('[data-niv]').forEach(b => b.onclick = () => {
      if (alleenLezen) return;
      const n = Number(b.dataset.niv), k = sch.dataset.vbCrit;
      const opnieuw = waarden.criteria[k] === n;          // nog eens tikken = leegmaken
      if (opnieuw) delete waarden.criteria[k]; else waarden.criteria[k] = n;
      sch.querySelectorAll('[data-niv]').forEach(x => x.classList.toggle('gekozen', !opnieuw && x === b));
      const anker = sch.nextElementSibling, t = ladderVan(sch.dataset.dom).treden[n];
      anker.innerHTML = opnieuw ? '' : `<b style="color:var(--n${n})">${NIV_LABEL[n]}</b> · ${t.tekst}`;
      anker.classList.toggle('toon', !opnieuw);
    });
  });
  koppelInfo(root, lft);
}
/* ⓘ-knoppen, de legenda-uitleg en "Zo beoordelen we" (ook bruikbaar in het snelle scherm). */
export function koppelInfo(root, lft){
  root.addEventListener('click', e => {
    const n = e.target.closest('[data-vb-naslag]');
    if (n){ e.preventDefault(); openNaslag({ lft }); return; }
    const b = e.target.closest('[data-vb-info]');
    if (!b) return;
    e.preventDefault();
    const soort = b.dataset.vbInfo;
    if (soort === 'ladders') toonLadderOverzicht('dave', lft);
    else if (soort === 'dom') toonDomeinPopup(b.dataset.dom, lft);
    else if (soort === 'crit') toonCriteriumPopup(b.dataset.dom, Number(b.dataset.idx), lft);
  });
}

function popupEl(){
  let el = document.getElementById('vbPopup');
  if (el) return el;
  el = document.createElement('div');
  el.id = 'vbPopup'; el.className = 'vb-popup';
  el.innerHTML = `<div class="vb-popup-doos" role="dialog" aria-modal="true"><div class="vb-popup-inhoud"></div>
    <button type="button" class="vb-popup-sluit">Sluiten</button></div>`;
  document.body.appendChild(el);
  el.addEventListener('click', e => {
    if (e.target === el || e.target.closest('.vb-popup-sluit')) { el.classList.remove('toon'); return; }
    const t = e.target.closest('[data-vb-ladder]');
    if (t) { toonLadderOverzicht(t.dataset.vbLadder, Number(el.dataset.lft)); return; }
    if (e.target.closest('[data-vb-naslag]')) { el.classList.remove('toon'); openNaslag({ lft: Number(el.dataset.lft) }); }
  });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && el.classList.contains('toon')) { e.stopPropagation(); el.classList.remove('toon'); }
  }, true);
  return el;
}
function toonPopup(html, lft){
  const el = popupEl();
  el.dataset.lft = lft;
  el.querySelector('.vb-popup-inhoud').innerHTML = html;
  el.classList.add('toon');
  el.querySelector('.vb-popup-inhoud').scrollTop = 0;
}
const faseKaart = f => `<div class="vb-fase-kaart"><b>Dit team: ${f.naam} (${f.leeft}) · nadruk ${f.nadruk.toLowerCase()}</b>${f.stap}</div>`;

function toonCriteriumPopup(domId, idx, lft){
  const d = VB_DOMEINEN.find(x => x.id === domId), c = d?.criteria[idx]; if (!c) return;
  const l = ladderVan(domId);
  toonPopup(`<div class="vb-pop-lbl">${d.id} · ${esc(d.naam)}</div><h3>${esc(c.naam)}</h3>
    <p>${esc(c.uitleg)}</p>
    <div class="vb-ladder-kop">Zo scoor je dit <span>· ${l.naam.toLowerCase()}</span></div>${ladderHtml(l)}
    ${c.beleid ? `<div class="vb-pop-box"><span>${ico('admin-document', 16)}</span><div><b>Jeugdbeleidsplan §3.3</b>${esc(c.vanaf ? `${c.beleid}, vanaf O${c.vanaf}` : c.beleid)}</div></div>` : ''}
    ${c.skill4 ? `<div class="vb-pop-box vier"><span>${ico('tag-leader', 16)}</span><div><b>4-Skills-methodiek</b>${esc(c.skill4)}</div></div>` : ''}`, lft);
}
function toonDomeinPopup(domId, lft){
  const d = VB_DOMEINEN.find(x => x.id === domId); if (!d) return;
  const l = ladderVan(domId), f = faseVan(lft);
  const themas = Object.entries(THEMA_MATRIX).filter(([, t]) => t.domein === domId);
  const cit = CITATEN[domId] || [];
  toonPopup(`<div class="vb-pop-lbl">${d.id} · ${esc(d.naam)}</div><h3>${esc(d.naam)}</h3><p>${esc(d.omschrijving)}</p>
    <div class="vb-ladder-kop">Wat betekent elk niveau <span>· ${l.model}</span></div>${ladderHtml(l)}${faseKaart(f)}
    ${themas.length ? `<div class="vb-pop-let">§3.3 Leercurve: vanaf welke leeftijd dit thema meetelt (p.10)</div>
      <div class="vb-matrix lbl">${BRACKETS.map(b => `<span>${b.replace('O', '').replace('/O', '/')}</span>`).join('')}</div>
      ${themas.map(([naam, t]) => `<div class="vb-thema"><b>${esc(naam)}</b><div class="vb-matrix">${BRACKETS.map((_, i) => `<span class="${i >= t.kolom ? 'aan' : ''}"></span>`).join('')}</div></div>`).join('')}`
      : `<div class="vb-pop-let">${esc(d.naam)} heeft geen §3.3-thema's: dit domein staat niet als aparte leercurve in het plan.</div>`}
    ${cit.length ? `<div class="vb-pop-let">Letterlijk uit het jeugdbeleidsplan</div>${cit.map(c => `<div class="vb-citaat">&ldquo;${esc(c.tekst)}&rdquo;<span>${esc(c.bron)}</span></div>`).join('')}` : ''}`, lft);
}
function toonLadderOverzicht(sleutel, lft){
  const l = LADDERS[sleutel];
  toonPopup(`<div class="vb-pop-lbl">De 5 niveaus</div><h3>Wat betekent elk niveau?</h3>
    <p>Elk niveau heeft een vaste betekenis. Die verschilt per soort vaardigheid: een techniek beheers je, inzicht ontwikkel je, een houding laat je zien.</p>
    <div class="vb-tabs">${Object.entries(LADDERS).map(([k, v]) => `<button type="button" data-vb-ladder="${k}" class="${k === sleutel ? 'aan' : ''}">${v.naam}<small>${v.domeinen.join(' · ')}</small></button>`).join('')}</div>
    <div class="vb-ladder-kop">${l.naam} <span>· ${l.model}</span></div>${ladderHtml(l)}${faseKaart(faseVan(lft))}`, lft);
}

/* ---------- Naslag "Zo beoordelen we" (Kort / Verdieping) ---------- */
const NASLAG_KEY = 'cluppie_naslag_beoordelen_app_v1';   // versie ophogen = iedereen ziet hem één keer opnieuw
export function naslagAlGezien(){ try { return localStorage.getItem(NASLAG_KEY) === '1'; } catch(e){ return true; } }
function markeerNaslag(){ try { localStorage.setItem(NASLAG_KEY, '1'); } catch(e){} }

const NS = {
  dave: { iconen:['football-ball','tag-effort'], vraag:'Hoe goed beheerst de speler de beweging?',
    voorbeeld:'Lukt de pass alleen in een oefening zonder tegenstander? Dan is het <b>Op weg</b>. Lukt hij ook in de partij met druk erop? Dan is het <b>Sterk</b>.',
    persoon:'Ravindra Dave', jaar:'1970', over:'Indiase onderwijskundige. Beschreef hoe je een beweging leert: van nadoen tot vanzelf.',
    diep:'Dave vulde in 1970 het motorische deel aan bij de taxonomie van Bloom. Een vaardigheid groeit van nadoen, via op instructie en zuiver, naar aanpassen aan de situatie, tot het vanzelf gaat. Kijk bij techniek en fysiek dus: onder welke omstandigheden lukt het nog?',
    stappen:['Imitatie (nadoen)','Manipulatie (op instructie)','Precisie (zuiver)','Articulatie (aanpassen)','Naturalisatie (vanzelf)'] },
  bloom: { iconen:['tag-insight'], vraag:'Hoe goed begrijpt de speler het spel en maakt hij keuzes?',
    voorbeeld:'Zakt terug als jij "terug!" roept? Dan is het <b>Op weg</b>. Zet zelf direct druk op de bal en wijst een medespeler zijn man aan? Dan is het <b>Uitblinker</b>.',
    persoon:'Benjamin Bloom', jaar:'1956, herzien 2001', over:'Amerikaanse onderwijspsycholoog. Ordende denken in stappen: van onthouden tot zelf iets bedenken.',
    diep:'Bloom ordende in 1956 het denken in stappen. In 2001 herzagen Anderson en Krathwohl die tot: onthouden, begrijpen, toepassen, analyseren, evalueren en creëren. In voetbal is dat spelinzicht. Wij voegen de laatste twee samen, zodat de ladder op onze vijf niveaus past.',
    stappen:['Nog niet herkennen','Begrijpen','Toepassen','Analyseren','Evalueren en creëren'] },
  krathwohl: { iconen:['tag-strong-second','tag-handshake'], vraag:'Hoe sterk laat de speler deze houding zelf zien?',
    voorbeeld:'Laat na een fout de schouders hangen, maar pakt het op als jij aanmoedigt? Dan is het <b>Op weg</b>. Peppt na een tegengoal zelf het team op? Dan is het <b>Uitblinker</b>.',
    persoon:'David Krathwohl', jaar:'1964', over:'Amerikaanse onderwijskundige en collega van Bloom. Beschreef hoe een houding groeit: van horen tot een voorbeeld zijn.',
    diep:'Krathwohl schreef in 1964 met Bloom en Masia het deel over houding. Een houding groeit van iets horen, via meedoen als het gevraagd wordt, naar het zelf willen, tot het bij je hoort. Kijk bij mentaliteit en gedrag dus: komt het uit de speler zelf?',
    stappen:['Ontvangen (luisteren)','Reageren (meedoen)','Waarderen (zelf willen)','Organiseren (eigen doelen)','Karakteriseren (hoort bij je)'] },
};
const nsIconen = (lijst, g = 16) => `<span class="iconen">${lijst.map(n => ico(n, g)).join('')}</span>`;
const nsKop = (icoon, label) => `<div class="vb-dom-kop"><span class="vb-dom-ic">${ico(icoon, 17)}</span><span class="vb-veldlabel">${label}</span></div>`;
const nsRij = (icoon, titel, uitleg, accent) => `<div class="ns-rij"><span class="ns-ic${accent ? ' accent' : ''}">${ico(icoon, 17)}</span><span class="tx">${titel}<small>${uitleg}</small></span></div>`;
const nsTrede = (n, tekst) => `<div class="ns-trede"><span class="vb-chip kn${n}">${NIV_LABEL[n]}</span><span class="tx">${tekst}</span></div>`;
function nsPaneel(k){
  const l = LADDERS[k], x = NS[k];
  return `<div class="ns-vraag">${x.vraag}</div>${l.treden.slice(1).map((t, i) => nsTrede(i + 1, t.tekst)).join('')}
    <div class="ns-voorbeeld"><span class="ic">${ico('football-ball', 16)}</span><span>${x.voorbeeld}</span></div>
    <div class="ns-bron"><span class="ns-ic">${ico('admin-document', 16)}</span><span><b>Gebaseerd op ${x.persoon} (${x.jaar})</b>${x.over}</span></div>`;
}
function nsModel(k){
  const x = NS[k], l = LADDERS[k];
  return `<div class="ns-kaart"><div class="ns-model-kop"><span class="ns-ic">${ico('admin-document', 17)}</span>
      <span class="tx"><b>${x.persoon}</b>${x.jaar} · ${l.naam.toLowerCase()}</span>${nsIconen(x.iconen, 17)}</div>
    <p class="ns-p klein">${x.diep}</p>
    <table class="ns-map">${x.stappen.map((r, i) => `<tr><td>${r}</td><td>${ico('navigation-forward', 14)}</td><td><span class="vb-chip kn${i+1}">${NIV_LABEL[i+1]}</span></td></tr>`).join('')}</table></div>`;
}
function naslagHtml(lft){
  const f = faseVan(lft);
  return `<div class="ns-modus"><div class="ns-tabs rij">
      <button type="button" data-ns-modus="kort" class="aan">${ico('action-check', 16)}Kort</button>
      <button type="button" data-ns-modus="diep">${ico('training-plan', 16)}Verdieping</button></div></div>
    <div class="ns-deel aan" data-ns-deel="kort">
      <div class="ns-kaart">${nsKop('navigation-help', 'In het kort')}
        ${nsRij('stats-bars', 'Elk niveau heeft een vaste betekenis', 'Lees de zin onder de schaal, niet alleen de kleur.', true)}
        ${nsRij('football-tactics', 'Techniek, inzicht en houding leer je anders', 'Daarom zijn er drie ladders.', true)}
        ${nsRij('team-player', 'Leeftijd telt mee', 'Een lage score bij een jonge speler is geen zwakte.', true)}</div>
      <div class="ns-kaart">${nsKop('stats-bars', 'De drie ladders')}
        <div class="ns-tabs">${Object.entries(LADDERS).map(([k, v], i) => `<button type="button" data-ns-tab="${k}" class="${i === 0 ? 'aan' : ''}">${nsIconen(NS[k].iconen)}${v.naam}</button>`).join('')}</div>
        <div class="ns-paneel">${nsPaneel('dave')}</div></div>
      <div class="ns-kaart">${nsKop('team-player', 'Dit team')}
        ${nsRij('planning-calendar', `${f.naam} (${f.leeft})`, `${f.kort[0]}: ${f.kort[1]}. Nadruk ${f.nadruk.toLowerCase()}.`, true)}</div>
      <div class="ns-kaart">${nsKop('action-check', 'Tips bij het scoren')}
        ${nsRij('planning-calendar', 'Kijk over meerdere weken', 'Scoor wat je meestal ziet, niet die ene uitschieter.')}
        ${nsRij('action-filter', 'Twijfel? Kies het lagere niveau', 'Schrijf in de toelichting wat al wél lukt.')}
        ${nsRij('tag-leader', 'Uitblinker is zeldzaam', 'Het betekent: een voorbeeld voor leeftijdsgenoten.')}</div>
      <button type="button" class="ns-meer" data-ns-modus="diep"><span class="ns-ic accent">${ico('training-plan', 17)}</span>
        <span class="tx">Meer weten?<small>Waar de ladders vandaan komen, de fases en coachvragen</small></span><span class="vb-pijl">${ico('navigation-forward', 18)}</span></button>
    </div>
    <div class="ns-deel" data-ns-deel="diep">
      <div class="ns-kaart">${nsKop('navigation-help', 'Waarom vaste niveaus')}
        <p class="ns-p">Een kleur zonder uitleg betekent voor iedere coach iets anders. De één geeft snel Sterk, de ander bijna nooit. Met een vaste beschrijving per niveau scoren alle coaches op dezelfde manier.</p>
        <p class="ns-p">Dat telt, want beoordelingen wegen mee bij de teamindeling. En een score die je kunt onderbouwen, kun je ook uitleggen aan speler en ouders.</p></div>
      <div class="ns-kaart">${nsKop('stats-bars', 'Hoofd, handen en hart')}
        <p class="ns-p zacht">Drie bekende ladders uit het onderwijs, elk voor een ander soort leren. Zo vertalen wij hun stappen naar onze vijf niveaus.</p></div>
      ${nsModel('dave')}${nsModel('bloom')}${nsModel('krathwohl')}
      <div class="ns-kaart">${nsKop('planning-calendar', 'Fases in het opleidingsmodel')}
        <p class="ns-p zacht">Meulensteen/KNVB delen de jeugd in vier fases. Elke fase legt de nadruk op één pijler.</p>
        <div class="ns-fases">${FASES.map(x => `<div class="ns-fase${x === f ? ' nu' : ''}"><div class="lft"><span>${x.leeft} · nadruk ${x.nadruk.toLowerCase()}</span>${x === f ? `<span class="ic" title="Dit team">${ico('team-player', 15)}</span>` : ''}</div><div class="nm">${x.naam}</div><div class="tx">${x.stap}</div></div>`).join('')}</div></div>
      <div class="ns-kaart">${nsKop('communication-chat', 'Coachvragen per stap')}
        <p class="ns-p zacht">Een vraag bij de volgende stap daagt de speler uit net iets verder te denken.</p>
        ${nsTrede(2, 'Wat zie je hier gebeuren?')}${nsTrede(3, 'Wat doe je als de bal daar komt?')}${nsTrede(4, 'Waarom koos je die pass?')}${nsTrede(5, 'Hoe help je je medespeler?')}</div>
      <div class="ns-kaart">${nsKop('admin-document', 'Bronnen')}
        <ul class="ns-bronnen">
          <li>Bloom, B.S. e.a. (1956). <i>Taxonomy of Educational Objectives, Handbook I: Cognitive Domain.</i></li>
          <li>Anderson, L.W. &amp; Krathwohl, D.R. (2001). <i>A Taxonomy for Learning, Teaching, and Assessing.</i></li>
          <li>Krathwohl, D.R., Bloom, B.S. &amp; Masia, B.B. (1964). <i>Handbook II: Affective Domain.</i></li>
          <li>Dave, R.H. (1970). Psychomotor levels. In: Armstrong (red.), <i>Developing and Writing Behavioral Objectives.</i></li>
          <li>Meulensteen, R. Opleidingsmodel (basis-, herhalings-, competitie- en winfase).</li>
        </ul></div>
    </div>`;
}
let naslagNa = null;
function sluitNaslag(){
  const el = document.getElementById('vbNaslag'); if (!el) return;
  el.classList.remove('toon');
  markeerNaslag();
  if (naslagNa){ const f = naslagNa; naslagNa = null; f(); }
}
/* Open de naslag. `eersteKeer`: met de melding bovenaan. `daarna`: wordt na sluiten aangeroepen. */
export function openNaslag({ lft = 99, eersteKeer = false, daarna = null } = {}){
  let el = document.getElementById('vbNaslag');
  if (!el){
    el = document.createElement('div');
    el.id = 'vbNaslag'; el.className = 'vb-naslag'; el.setAttribute('role', 'dialog'); el.setAttribute('aria-modal', 'true');
    el.innerHTML = `<div class="vb-naslag-in">
      <div class="vb-naslag-kop"><h2>Zo beoordelen we</h2><button type="button" class="vb-naslag-x" aria-label="Sluiten">${ico('navigation-close', 18)}</button></div>
      <div class="vb-naslag-eerste"><span class="ic">${ico('navigation-help', 17)}</span><span>Eerste keer? Lees dit even door. Je vindt het daarna altijd terug bovenaan het beoordelingsscherm.</span></div>
      <div class="vb-naslag-tekst"></div>
      <button type="button" class="knop vol fluo vb-naslag-ok">Begrepen</button></div>`;
    document.body.appendChild(el);
    el.querySelector('.vb-naslag-x').onclick = sluitNaslag;
    el.querySelector('.vb-naslag-ok').onclick = sluitNaslag;
    el.addEventListener('click', e => {
      const m = e.target.closest('[data-ns-modus]');
      if (m){
        el.querySelectorAll('.ns-modus [data-ns-modus]').forEach(b => b.classList.toggle('aan', b.dataset.nsModus === m.dataset.nsModus));
        el.querySelectorAll('[data-ns-deel]').forEach(d => d.classList.toggle('aan', d.dataset.nsDeel === m.dataset.nsModus));
        el.scrollTop = 0; return;
      }
      const t = e.target.closest('[data-ns-tab]');
      if (t){
        el.querySelectorAll('[data-ns-tab]').forEach(b => b.classList.toggle('aan', b === t));
        el.querySelector('.ns-paneel').innerHTML = nsPaneel(t.dataset.nsTab);
      }
    });
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape' && el.classList.contains('toon')) { e.stopPropagation(); sluitNaslag(); }
    }, true);
  }
  naslagNa = daarna;
  el.querySelector('.vb-naslag-tekst').innerHTML = naslagHtml(lft);
  el.classList.toggle('eerste', !!eersteKeer);
  el.querySelector('.vb-naslag-ok').textContent = 'Begrepen';
  el.classList.add('toon');
  el.scrollTop = 0;
  el.querySelector('.vb-naslag-x').focus({ preventScroll: true });
}
/* Eerste keer een beoordelingsscherm open? Dan de naslag er direct overheen. */
export function naslagEersteKeer(lft){
  if (!naslagAlGezien()) openNaslag({ lft, eersteKeer: true });
}
