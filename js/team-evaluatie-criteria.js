/* ==================== TEAMEVALUATIE: criteria, zinnen, vertaling, radar ====================
   [20261119c] Nieuwe teamevaluatie (mockup "Teamevaluatie met blokdoel"):
     1. Waar werkten we aan?   blokdoelen uit de oefenstof + het wedstrijddoel
     2. Zagen we het terug?    ladder per gekozen doel + één moment als bewijs
     3. Wat zag je per moment? 4 groepen, criteria per leeftijd, vaste zin per niveau
     4. Hoe verder?            door / meer weerstand / terug naar de basis
     5. Spelers (optioneel)    duimen tellen in de kleedkamer

   Datamodel (teams/{id}/teamevaluaties), versie 2:
     versie: 2, lft, scores: { opbouwen: 1..5, ... }   ← nieuwe criterium-id's
     focus: [{ tekst, bron, niveau, bewijs }], blok: { planId, naam, blok, week, weken } | null,
     vervolg: 'door'|'druk'|'basis'|null, spelers: { ja, half, nee } | null,
     tags, notitieGoed, notitieAandacht   ← zoals voorheen
   Oude evaluaties (zonder versie) blijven ongewijzigd bewaard; teScores()
   vertaalt ze bij het lezen naar de nieuwe criteria, zodat ze meetellen in
   radars, trends en cluboverzichten.

   Deze module is een blad: geen imports, zodat wijzigingen hier geen grote
   versie-cascade geven. */

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export const TE_NIV = [null,'Aandacht','Op weg','Prima','Sterk','Uitblinker'];

/* Leeftijd uit de teamcategorie ("O13-1", "JO13" → 13); senioren → 99. */
export function teLeeftijd(categorie){
  const m = String(categorie || '').match(/O(\d+)/);
  return m ? Number(m[1]) : 99;
}

/* ---------- Groepen en criteria (jeugdbeleidsplan §3.2/§3.3 + KNVB-teamtaken) ---------- */
export const TE_GROEPEN = [
  {id:'bal', naam:'Wij hebben de bal', sub:'Balbezit', kleur:'#f25a53', crit:[
    {id:'opbouwen', naam:'Opbouwen', kort:'Opbouw', vanaf:8, leercurve:'Positiespel opbouw', label:'Positiespel + dieptespel opbouw', z:[
      'Bij de eerste druk gaat de bal lang naar voren of verloren.',
      'Opbouwen lukt als de coach aanwijst wie vrijstaat.',
      'Spelers bieden zich zelf aan en vinden de vrije man, zolang de druk laag is.',
      'Ook onder druk komt de bal over de grond door de linies; ze kiezen bewust tussen breed en diep.',
      'Gaat vanzelf; spelers sturen elkaar aan (“man!”, “draai!”).']},
    {id:'kansen', naam:'Kansen creëren en scoren', kort:'Kansen', vanaf:6, leercurve:'Scoren', label:'Scoren · uitspelen 1:1 · voorzet', z:[
      'Aanvallen stranden voordat er een kans komt.',
      'Kansen komen vooral uit een losse actie of een fout van de tegenstander.',
      'Het team maakt zelf kansen, via een actie, pass of voorzet.',
      'Steeds opnieuw kansen, ook tegen een gesloten verdediging; spelers lopen mee de zestien in.',
      'Gevarieerd en doelgericht; spelers zoeken samen de beste oplossing.']},
  ]},
  {id:'zonder', naam:'Zij hebben de bal', sub:'Balbezit tegenstander', kleur:'#6db3ff', crit:[
    {id:'storen', naam:'Storen en veroveren', kort:'Storen', vanaf:10, leercurve:'Storen en veroveren', label:'Storen en veroveren', z:[
      'Iedereen wacht af; de tegenstander speelt vrij uit.',
      'Er wordt druk gezet, maar los: één speler jaagt alleen.',
      'Het team zet samen druk en dwingt de tegenstander soms naar de zijkant.',
      'Druk op het juiste moment, als linie; ballen worden hoog op het veld veroverd.',
      'Spelers geven elkaar het signaal en schuiven vanzelf door.']},
    {id:'voorkomen', naam:'Doelpunten voorkomen', kort:'Voorkomen', vanaf:10, leercurve:'Voorkomen van doelpunten', label:'Voorkomen van doelpunten · verdedigen dieptespel', z:[
      'De tegenstander komt makkelijk vrij voor de keeper.',
      'Verdedigen lukt als de coach de posities aanwijst.',
      'Het team staat compact en dekt de ruimte achter de verdediging af.',
      'Ook onder druk blijft de organisatie staan; weinig kansen weggegeven.',
      'Spelers organiseren het zelf: coachen, rugdekking geven, doorschuiven.']},
  ]},
  {id:'om', naam:'Omschakelen', sub:'Wisselen van balbezit · alle leeftijden', kleur:'#f5b13d', crit:[
    /* t/m O13: één criterium met een lat per fase (KNVB: snel weer meedoen).
       Vanaf O14 in tweeën, zoals de leercurve het als trainingsthema uitwerkt. */
    {id:'meedoen', naam:'Snel weer meedoen', kort:'Meedoen', vanaf:6, tot:13, label:'KNVB', fase:true, z:[
      'Na balverlies blijven spelers staan of kijken; na balwinst gaat de bal direct weer weg.',
      'Spelers gaan terug naar de bal als de coach het roept.',
      'De dichtstbijzijnde speler gaat meteen terug naar de bal; na balwinst kijkt de speler eerst vooruit.',
      'Meerdere spelers reageren meteen, ook laat in de wedstrijd.',
      'Gaat vanzelf; spelers roepen elkaar terug en vooruit.'],
     zTeam:[
      'Na balverlies blijven spelers staan of kijken; na balwinst gaat de bal direct weer weg.',
      'Eén speler zet druk, de rest schuift pas mee als de coach roept.',
      'Het team reageert samen: druk op de bal en de rest schuift mee. Na balwinst eerst vooruit kijken.',
      'Snel en als team, ook laat in de wedstrijd; ballen worden direct heroverd.',
      'Gaat vanzelf; spelers sturen elkaar bij het wisselen van balbezit.']},
    {id:'balverlies', naam:'Na balverlies', kort:'Na verlies', vanaf:14, leercurve:'Omschakelen balverlies', label:'Omschakelen balverlies', z:[
      'Na balverlies blijven spelers staan of kijken.',
      'Een paar spelers schakelen om, de rest na een roep van de coach.',
      'Het team schakelt meestal direct om: druk op de bal of terug achter de bal.',
      'Snel en samen, ook laat in de wedstrijd; tegenkansen zijn zeldzaam.',
      'Gaat vanzelf; spelers roepen elkaar direct terug.']},
    {id:'balwinst', naam:'Na balwinst', kort:'Na winst', vanaf:14, leercurve:'Omschakelen balwinst', label:'Omschakelen balwinst', z:[
      'Na balwinst gaat de bal direct weer verloren.',
      'Soms een snelle pass vooruit, vaak terugspelen.',
      'Het team kijkt eerst vooruit en maakt het veld groot.',
      'Snel en doelgericht, met lopers mee; kansen uit omschakelmomenten.',
      'Gaat vanzelf; spelers weten al waar ze heen gaan vóór de bal is veroverd.']},
  ]},
  {id:'team', naam:'Team en beleving', sub:'Alle leeftijden', kleur:'#35c47a', crit:[
    {id:'inzet', naam:'Inzet en weerbaarheid', kort:'Inzet', vanaf:6, z:[
      'De koppies hangen; de inzet zakt weg als het tegenzit.',
      'Werken hard zolang het goed gaat of de coach aanmoedigt.',
      'Blijven werken voor elkaar, ook na een tegendoelpunt.',
      'Zetten door tot het eind en herpakken zich zelf na tegenslag.',
      'Trekken elkaar erdoorheen en moedigen elkaar aan.']},
    {id:'samenspel', naam:'Samenspel en communicatie', kort:'Samenspel', vanaf:6, z:[
      'Ieder speelt voor zich; het is stil op het veld.',
      'Samenspel als de coach erom vraagt; er wordt weinig gepraat.',
      'Spelers zien elkaar staan en spelen samen; je hoort ze.',
      'Ze coachen elkaar kort en duidelijk, ook onder druk.',
      'Sturen elkaar positief aan; het team praat als één.']},
    {id:'afspraken', naam:'Afspraken uitvoeren', kort:'Afspraken', vanaf:6, label:'§3.2 tactische opdrachten', z:[
      'Afspraken uit de bespreking zie je niet terug.',
      'Afspraken komen terug als de coach ze herhaalt.',
      'Spelers voeren hun taak en de afspraken zelf uit.',
      'Houden zich eraan, ook als de wedstrijd anders loopt dan gepland.',
      'Passen afspraken samen aan en wijzen elkaar erop.']},
    {id:'plezier', naam:'Plezier en sportiviteit', kort:'Plezier', vanaf:6, leercurve:'Teamsport en plezier', label:'Teamsport en plezier', z:[
      'Weinig plezier; irritatie naar elkaar, de scheidsrechter of de tegenstander.',
      'Het plezier hangt af van de stand.',
      'Spelen met plezier en gaan respectvol met iedereen om.',
      'Plezier en respect blijven, ook bij verlies of een lastige scheidsrechter.',
      'Zijn een voorbeeld: vieren samen en helpen de tegenstander overeind.']},
  ]},
];
export const TE_CRITERIA = TE_GROEPEN.flatMap(g => g.crit.map(c => ({ ...c, groep: g.id, groepKleur: g.kleur })));
export const teCriterium = id => TE_CRITERIA.find(c => c.id === id) || null;
export const teGroep = id => TE_GROEPEN.find(g => g.id === id) || null;
export const teZichtbaar = (c, lft) => lft >= c.vanaf && (!c.tot || lft <= c.tot);
export const teCriteriaVoor = lft => TE_CRITERIA.filter(c => teZichtbaar(c, lft));
export const teZinnen = (c, lft) => (c.zTeam && lft >= 12) ? c.zTeam : c.z;
export const teFaseLabel = lft => lft <= 11 ? 'O6–O11: de speler' : lft <= 13 ? 'O12–O13: als team' : '';

/* ---------- Doelen (stap 1 en 2) en vervolg (stap 4) ---------- */
export const TE_FOCUS_LADDER = [null,
  'Niet teruggezien in het spel.',
  'Een enkele keer, vooral als de coach het riep.',
  'Regelmatig en uit zichzelf, zolang er weinig druk was.',
  'Vaak, ook tegen een tegenstander die druk zette.',
  'Ging vanzelf; spelers wezen elkaar erop.'];
export const TE_VERVOLG = [
  {id:'door',  ico:'➡️', titel:'Doel zit erin, door naar de volgende stap', sub:'De volgende training in het blok mag een stap verder.'},
  {id:'druk',  ico:'🔁', titel:'Zelfde doel, met meer weerstand', sub:'Blijven oefenen, maar met een tegenstander die druk zet.'},
  {id:'basis', ico:'↩️', titel:'Terug naar de basis', sub:'Eerst zonder druk laten lukken.'},
];
export const teVervolg = id => TE_VERVOLG.find(v => v.id === id) || null;

/* ---------- Oude evaluaties lezen in de nieuwe criteria ----------
   Oud (8 categorieën, zonder vaste betekenis per kleur) → nieuw:
     opbouw → opbouwen · druk → storen · inzet → inzet · samenwerking → samenspel
     plezier → plezier · taken + coachbaar → afspraken (gemiddelde)
     omschakeling → meedoen (t/m O13) of na balverlies + na balwinst (O14+)
   Kansen en Doelpunten voorkomen bestonden niet: die blijven leeg. */
export const TE_OUD_NAAR_NIEUW = { opbouw:'opbouwen', druk:'storen', inzet:'inzet', samenwerking:'samenspel', plezier:'plezier', taken:'afspraken', coachbaar:'afspraken', omschakeling:'*om' };
export const teIsNieuw = ev => Number(ev?.versie) >= 2;
export function teScores(ev, lft){
  const s = ev?.scores || {};
  if (teIsNieuw(ev)) return { ...s };
  const uit = {}, bak = {};
  for (const [oud, v] of Object.entries(s)){
    const n = Number(v); if (!(n >= 1 && n <= 5)) continue;
    const doel = TE_OUD_NAAR_NIEUW[oud]; if (!doel) continue;
    const doelen = doel === '*om' ? (lft >= 14 ? ['balverlies','balwinst'] : ['meedoen']) : [doel];
    for (const d of doelen) (bak[d] ||= []).push(n);
  }
  for (const [d, l] of Object.entries(bak)) uit[d] = l.reduce((a, b) => a + b, 0) / l.length;
  return uit;
}
export const teGem = l => { const w = (l || []).filter(v => v != null && !isNaN(v)); return w.length ? w.reduce((a, b) => a + b, 0) / w.length : null; };
/* Per groep het gemiddelde van de ingevulde criteria die bij de leeftijd horen. */
export function teGroepWaarden(scores, lft){
  const uit = {};
  for (const g of TE_GROEPEN) uit[g.id] = teGem(g.crit.filter(c => teZichtbaar(c, lft)).map(c => scores?.[c.id]).filter(v => v >= 1));
  return uit;
}
/* Gemiddelde per criterium over een lijst evaluaties (oud en nieuw door elkaar). */
export function teCritGemiddelden(evals, lft){
  const uit = {};
  for (const c of TE_CRITERIA) uit[c.id] = teGem((evals || []).map(e => teScores(e, lft)[c.id]).filter(v => v >= 1));
  return uit;
}
export function teLaagste(scores, lft){
  let l = null;
  for (const c of teCriteriaVoor(lft)){ const v = scores?.[c.id]; if (v >= 1 && (!l || v < l.score)) l = { id:c.id, score:v }; }
  return l;
}
export const teKleur = v => v == null ? 'var(--surface-2)' : `var(--n${Math.max(1, Math.min(5, Math.round(v)))})`;
export const teKleurHex = v => v == null ? null : ['#F0565B','#F59C4A','#F2C94C','#7DCB6A','#35C47A'][Math.max(1, Math.min(5, Math.round(v))) - 1];
export const teCijfer = v => v == null ? '–' : v.toFixed(1).replace('.', ',');

/* ---------- Blok bij een wedstrijddatum (oefenstof van de trainingscoördinator) ----------
   Neemt het blok van de laatste ingeplande training in of vóór de week van de
   wedstrijd en verzamelt de doelen van dat blok tot en met die week. */
const maandagVan = iso => { const d = new Date((iso || '') + 'T12:00'); if (isNaN(d)) return ''; d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const doelTekst = d => String(d?.tekst ?? d ?? '').replace(/\s+/g, ' ').trim();
export function teBlokVoorDatum(trainingen, teamId, datum){
  const ma = maandagVan(datum); if (!ma) return null;
  const eigen = (trainingen || []).filter(t => t.plan?.id && /^\d{4}-\d{2}-\d{2}$/.test(t.weekStart || '') && t.weekStart <= ma
    && (!Array.isArray(t.teams) || !t.teams.length || t.teams.includes(teamId)));
  if (!eigen.length) return null;
  const laatste = eigen.sort((a, b) => b.weekStart.localeCompare(a.weekStart) || (b.trainingNr || 0) - (a.trainingNr || 0))[0];
  const plan = laatste.plan, weken = Number(plan.weken) || null, week = Number(laatste.blokWeek) || null;
  /* Laatste oefenstof meer dan een week vóór de wedstrijdweek: geen lopend blok meer. */
  const dagen = (new Date(ma + 'T12:00') - new Date(laatste.weekStart + 'T12:00')) / 864e5;
  if (dagen > 13) return null;
  const gezien = new Set(), doelen = [];
  eigen.filter(t => t.plan?.id === plan.id).sort((a, b) => (b.blokWeek || 0) - (a.blokWeek || 0) || (a.trainingNr || 0) - (b.trainingNr || 0))
    .forEach(t => (Array.isArray(t.doelen) ? t.doelen : []).forEach(d => {
      const tekst = doelTekst(d), k = tekst.toLowerCase();
      if (tekst && !gezien.has(k)){ gezien.add(k); doelen.push({ tekst, week: Number(t.blokWeek) || null }); }
    }));
  return { planId: plan.id, naam: plan.naam || (plan.blok ? `Blok ${plan.blok}` : 'Blok'), blok: plan.blok || null, week, weken, doelen };
}

/* ---------- Radar met een variabel aantal assen (gedeeld door alle schermen) ---------- */
export function teRadarSvg(nu, vgl, labels, kleuren, { breed = 330, hoog = 300, R = 105, klasse = 'te-radar-svg', klikbaar = false } = {}){
  const n = nu.length; if (n < 3) return '';
  const cx = breed / 2, cy = hoog / 2;
  const pt = (v, i) => { const a = -Math.PI / 2 + i * 2 * Math.PI / n, r = R * (v || 0) / 5; return [cx + r * Math.cos(a), cy + r * Math.sin(a)]; };
  const pp = a => a.map(p => p.map(x => x.toFixed(1)).join(',')).join(' ');
  let s = `<svg class="${klasse}" viewBox="0 0 ${breed} ${hoog}" role="img" aria-label="Radar">`;
  for (let l = 1; l <= 5; l++) s += `<polygon points="${pp(nu.map((_, i) => pt(l, i)))}" fill="none" style="stroke:var(--line-d)"${l === 5 ? ' stroke-width="1.5"' : ''}/>`;
  if (vgl && vgl.some(v => v)) s += `<polygon points="${pp(vgl.map(pt))}" fill="none" style="stroke:var(--ink-2)" stroke-width="1.6" stroke-dasharray="4 4"/>`;
  s += `<polygon points="${pp(nu.map(pt))}" style="fill:color-mix(in srgb,var(--accent) 26%,transparent);stroke:var(--accent)" stroke-width="2.4" stroke-linejoin="round"/>`;
  nu.forEach((v, i) => { if (!v) return; const [x, y] = pt(v, i); s += `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="5" fill="${kleuren[i]}" style="stroke:var(--card)" stroke-width="2"/>`; });
  labels.forEach((l, i) => { const [x, y] = pt(n > 6 ? 6.3 : 6.0, i);
    s += `<text x="${x.toFixed(1)}" y="${(y + 4).toFixed(1)}" text-anchor="middle" font-size="${n > 6 ? 10.5 : 13}" font-weight="700" fill="${kleuren[i]}"${klikbaar ? ` data-radar-as="${i}" style="cursor:pointer"` : ''}>${esc(l)}</text>`; });
  return s + '</svg>';
}
/* Wedstrijdradar: assen = criteria bij de leeftijd. */
export function teWedRadar(scoresNu, scoresVgl, lft, opts = {}){
  const ax = teCriteriaVoor(lft);
  return teRadarSvg(ax.map(c => scoresNu?.[c.id] || 0), scoresVgl ? ax.map(c => scoresVgl[c.id] || 0) : null, ax.map(c => c.kort), ax.map(c => c.groepKleur), opts);
}

/* ---------- Melding "evalueren is anders" (tot en met 19 december 2026) ---------- */
export const TE_NIEUW_TOT = '2026-12-19';
const MELD_KEY = 'cluppie_te_nieuw_gelezen_v1';
export function teMeldingActief(vandaag){
  const d = vandaag || new Date().toISOString().slice(0, 10);
  return d <= TE_NIEUW_TOT;
}
const gelezen = () => { try { return localStorage.getItem(MELD_KEY) === '1'; } catch(e){ return false; } };
export function htmlTeNieuwMelding(){
  if (!teMeldingActief()) return '';
  const open = !gelezen();
  return `<div class="te-nieuw${open ? ' open' : ''}" id="teNieuw">
    <button type="button" class="te-nieuw-kop" data-te-nieuw-klap aria-expanded="${open}">
      <span class="te-nieuw-ic">✨</span><span class="te-nieuw-t"><b>Evalueren gaat vanaf nu anders</b><small>Doel eerst, dan wat je zag, dan de volgende stap</small></span><span class="te-nieuw-pijl">▾</span></button>
    <div class="te-nieuw-in">
      <p><b>Wat is er anders?</b> Je begint bij het blokdoel of wedstrijddoel waar het team aan werkt. Daarna kies je per onderdeel de zin die past bij wat je zag. De kleur volgt uit die zin. Je sluit af met de volgende stap voor de training.</p>
      <p><b>Waarom?</b> Een kleur zonder uitleg betekent voor iedere coach iets anders. Goede feedback beantwoordt drie vragen: waar werken we aan, hoe ging het, en wat is de volgende stap (Hattie &amp; Timperley). Coaches onthouden na een wedstrijd maar een deel van de belangrijke momenten, en de uitslag kleurt wat je onthoudt. Daarom kijk je naar één doel, noem je één moment en staat de uitslag niet op dit scherm.</p>
      <p><b>Wat blijft?</b> Je oude evaluaties blijven bewaard en tellen mee in de radars en trends. Overslaan mag nog steeds.</p>
      <div class="te-nieuw-knoppen"><button type="button" class="knop klein licht" data-te-naslag>Zo evalueren we</button><button type="button" class="knop klein" data-te-nieuw-ok>Begrepen</button></div>
    </div></div>`;
}
export function koppelTeNieuwMelding(root){
  const el = root?.querySelector('#teNieuw'); if (!el) return;
  el.querySelector('[data-te-nieuw-klap]')?.addEventListener('click', () => {
    const open = !el.classList.contains('open'); el.classList.toggle('open', open);
    el.querySelector('[data-te-nieuw-klap]').setAttribute('aria-expanded', open);
  });
  el.querySelector('[data-te-nieuw-ok]')?.addEventListener('click', () => {
    try { localStorage.setItem(MELD_KEY, '1'); } catch(e){}
    el.classList.remove('open'); el.querySelector('[data-te-nieuw-klap]').setAttribute('aria-expanded', 'false');
  });
}

/* ---------- Naslag "Zo evalueren we" (zelfde popup-stijl als "Zo beoordelen we") ---------- */
function popup(){
  let el = document.getElementById('tePopup'); if (el) return el;
  el = document.createElement('div'); el.id = 'tePopup'; el.className = 'vb-popup';
  el.innerHTML = `<div class="vb-popup-doos" role="dialog" aria-modal="true"><div class="vb-popup-inhoud"></div><button type="button" class="vb-popup-sluit">Sluiten</button></div>`;
  document.body.appendChild(el);
  el.addEventListener('click', e => { if (e.target === el || e.target.closest('.vb-popup-sluit')) el.classList.remove('toon'); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && el.classList.contains('toon')){ e.stopPropagation(); el.classList.remove('toon'); } }, true);
  return el;
}
export function openTeNaslag(lft = 99){
  const el = popup();
  const regels = [
    ['Begin bij het doel', 'Waar werkte het team deze weken aan? Kies het blokdoel of wedstrijddoel waar je naar keek.'],
    ['Kijk naar wat je zag, niet naar de uitslag', 'Een wedstrijd van 1-0 kan slecht gespeeld zijn, een 0-3 juist goed. Daarom staat de uitslag niet op het scherm.'],
    ['Een kleur is een zin', 'Elk niveau heeft een vaste beschrijving. Kies de zin die het beste past bij wat je zag.'],
    ['Noem één moment', 'Eén voorbeeld maakt je oordeel controleerbaar en bespreekbaar. Wat je niet zag, sla je over.'],
    ['Eindig met de volgende stap', 'Door, nog eens met meer weerstand, of terug naar de basis. Dat stuurt de volgende training.'],
  ];
  const bronnen = [
    ['2007', 'Hattie & Timperley', 'Goede feedback beantwoordt drie vragen: waar gaan we heen, hoe gaat het, en wat is de volgende stap? Dat zijn stap 1, 2 en 4.'],
    ['2005', 'Leahy, Lyon, Thompson & Wiliam', 'Formatief evalueren begint met duidelijke leerdoelen en succescriteria. Het blokdoel is het leerdoel; de zinnen per niveau zijn de succescriteria. Spelers laten meebeoordelen past bij hun strategie van eigenaarschap.'],
    ['1986', 'Franks & Miller · Laird & Waters (2008)', 'Coaches herinneren zich na een wedstrijd maar een deel van de belangrijke momenten; ook gediplomeerde coaches missen er ongeveer vier op de tien.'],
    ['2015', 'Lefgren, Platt & Price', 'Coaches veranderen na een nipte nederlaag vaker hun aanpak dan na een nipte overwinning, terwijl zo’n uitslag weinig zegt. Daarom beoordelen we het spel, niet de stand.'],
    ['KNVB', 'Teamtaken per moment', 'Met de bal, zonder de bal en bij het wisselen van balbezit, met het resultaat ondergeschikt aan de ontwikkeling. Ook jonge spelers leren al snel weer meedoen na balverlies of balwinst.'],
  ];
  const ladder = TE_FOCUS_LADDER.slice(1).map((z, i) => `<div class="vb-ladder-rij"><span class="vb-chip kn${i + 1}">${TE_NIV[i + 1]}</span><span class="tx">${esc(z)}</span></div>`).join('');
  el.querySelector('.vb-popup-inhoud').innerHTML = `
    <h3>Zo evalueren we</h3>
    <p>Een teamevaluatie is een spiegel voor de volgende training, geen rapportcijfer.</p>
    ${regels.map(([t, u], i) => `<div class="te-ns-rij"><span class="n">${i + 1}</span><div><b>${esc(t)}</b><span>${esc(u)}</span></div></div>`).join('')}
    <div class="vb-ladder-kop">De ladder bij het blokdoel</div>${ladder}
    <div class="vb-ladder-kop">Waarom zo</div>
    ${bronnen.map(([j, w, u]) => `<div class="te-ns-bron"><span class="jr">${esc(j)}</span><div><b>${esc(w)}</b><span>${esc(u)}</span></div></div>`).join('')}
    <div class="vb-ladder-kop">Omschakelen per leeftijd</div>
    <p>Tot en met O11 kijk je of de speler meteen weer meedoet, bij O12 en O13 of het team samen reageert. Vanaf O14 beoordeel je omschakelen na balverlies en na balwinst apart, zoals in de leercurve.${lft < 99 ? ` Dit team: O${lft}.` : ''}</p>`;
  el.classList.add('toon');
  el.querySelector('.vb-popup-inhoud').scrollTop = 0;
}
