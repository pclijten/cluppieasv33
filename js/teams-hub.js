/* ==================== TEAM-HUB (startscherm van een team) ====================
   Onderdeel van de teams.js-modulaire split. Dit bestand bevat de HTML-bouwers
   voor het nieuwe tegel-startscherm dat de onderbalk vervangt, plus de nieuwe
   pagina's die daarbij horen:
     • htmlHub()               — het tegel-startscherm (kop + secties)
     • htmlPresWedstrijd()     — presentie/selectie per wedstrijd (met kiezer)
     • htmlEvaluatieLijst()    — wedstrijden die nog geëvalueerd moeten worden
     • htmlLeerlijnOverzicht() — alle open leerpunten per speler in één lijst
     • htmlHistorieLijst()     — spelerslijst als ingang naar het historie-tab
   Event-koppeling gebeurt in teams.js (koppelTeamTab) — dit bestand levert
   alleen HTML + de opslaghulpjes voor de wedstrijd-presentie. Het importeert
   bewust NIET terug uit teams.js (geen circulaire import). */
import { db, doc, updateDoc } from './firebase.js?v=20261106r';
import { S, esc, meld, datumNL, modAan } from './state.js?v=20261106r';
import { AFWEZIG_REDENEN, afwezigRedenInfo } from './config.js?v=20261106r';
import { ico } from './icons.js?v=20261106r';
import { analyseWedstrijd } from './analyse.js?v=20261106r';
import { telGebruik } from './tracker.js?v=20261106r';
import { ongelezenBerichten } from './berichten.js?v=20261106r';
import { lijstjesOpenTotaal } from './teams-lijsten.js?v=20261106r';
import { htmlRondeBalk } from './evaluatierondes.js?v=20261106r';
import { htmlNu } from './nu-scherm.js?v=20261106w';
import { htmlSelectieDashboard, heeftElftallen, elftalWedstrijd, elftalNaam, spelersVoorElftal, elftalPillWedstrijd } from './elftallen.js?v=20261106r';

/* Zelfde sentinel als in wedstrijd.js (daar niet geëxporteerd): geplande
   wissel met "wie aan de beurt is" i.p.v. een concrete speler. */
const WISSEL_BEURT = '__beurt__';

/* ---------- Hulpjes ---------- */
function voornaamCoach(){
  // eerst het team dat open staat: in andere teams kan een oude of afgekorte naam staan
  let naam = S.team?.ledenInfo?.[S.user.uid]?.naam || '';
  if (!naam) for (const t of S.teams){ const n = t.ledenInfo?.[S.user.uid]?.naam; if (n){ naam = n; break; } }
  if (!naam) for (const c of S.clubs){ const n = c.ledenInfo?.[S.user.uid]?.naam; if (n){ naam = n; break; } }
  naam = (naam || S.user.displayName || S.user.email || '').trim();
  const v = naam ? naam.split(/[ @.]/)[0] : '';
  return v ? v.charAt(0).toUpperCase() + v.slice(1) : 'coach';
}

function vandaagIso(){ return new Date().toISOString().slice(0,10); }

/* Wedstrijden die nog geëvalueerd moeten worden (zelfde criteria als de
   "nog te evalueren"-herinnering op het teamsoverzicht, maar dan binnen
   het geopende team op basis van de al geladen state). */
export function evaluatieOpen(){
  if (!modAan('evaluaties')) return [];
  const vandaag = vandaagIso();
  const geevalueerd = new Set((S.teamEvaluaties || []).map(e => e.wedstrijdId));
  return S.wedstrijden
    .filter(w => (w.datum || '') <= vandaag)
    .filter(w => !w.evaluatieGenegeerd && !geevalueerd.has(w.id))
    .filter(w => (w.goals || []).length || analyseWedstrijd(w).kwarten)
    .sort((a,b) => (b.datum||'').localeCompare(a.datum||''));
}

/* ==================== HUB ==================== */
/* Eén tegel. data-hub-open="<tab>" wordt in teams.js gekoppeld aan zetTeamTab. */
function tegel(tab, naam, icoNaam, badge){
  const mark = badge === true ? '<span class="hub-dot"></span>'
             : badge ? `<span class="hub-badge">${badge}</span>` : '';
  return `<button class="hub-tegel" data-hub-open="${tab}">${mark}${ico(icoNaam, 40)}<span class="hub-tnaam">${esc(naam)}</span></button>`;
}

/* Tekst van de knop die alle tegels openklapt (tussenstap startscherm, 6 nov). */
const HUB_ALLES_LABEL = 'Alles';

export function htmlHub(updInfo){
  const upd = updInfo || { ongelezen:0, nieuwsteTitel:'' };
  const vandaagMooi = (() => {
    let d = '';
    try { d = new Date().toLocaleDateString('nl-NL',{weekday:'long',day:'numeric',month:'long'}); } catch(e){}
    return d.charAt(0).toUpperCase() + d.slice(1);
  })();

  const evalOpen = evaluatieOpen().length;
  const documentenOngelezen = S.documenten
    .filter(d => (d.teams||[]).includes(S.teamId) && !S.trainingenGelezen[d.id]).length;
  const oefenstofOngelezen = S.trainingen
    .filter(t => (t.teams||[]).includes(S.teamId) && !S.trainingenGelezen[t.id]).length;

  /* Teamkeuze-dropdown: alle teams van deze coach + doorlink naar het
     teamsoverzicht (daar wonen clubbeheer, berichten en team-aanmaken). */
  const teamKeuze = `
    <div class="hub-teamrij">
      <button class="hub-teamnaam" id="hubTeamKnop">${esc(S.team.naam)}
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M8 9l4 4 4-4"/></svg></button>
      <span class="hub-teamsub">${S.team.categorie ? esc(S.team.categorie)+'<span class="sep" aria-hidden="true"></span>' : ''}${esc(S.team.format)} tegen ${esc(S.team.format)}</span>
      <div class="hub-teamkeuze" id="hubTeamKeuze">
        ${S.teams.map(t => `
          <button data-hub-team="${t.id}" class="${t.id === S.teamId ? 'actief' : ''}">${esc(t.naam)}
            <span class="sub">${esc(t.format)}v${esc(t.format)}</span></button>`).join('')}
        <button data-hub-overzicht="1">Teamoverzicht &amp; beheer <span class="sub">›</span></button>
      </div>
    </div>`;

  /* Secties conform de goedgekeurde mockup (v4, feedback 18 aug). */
  const secties = [
    ['Oefenstof', [
      tegel('trainingen',       'Oefenstof',    'training-cones', oefenstofOngelezen || null),
      `<button class="hub-tegel" data-open-tactiek="1">${ico('football-tactics', 40)}<span class="hub-tnaam">Tactiek</span></button>`,
      tegel('videos',           'Video\u2019s', 'training-video'),
    ]],
    ['Presentie', [
      tegel('presentietraining','Training',     'training-cones'),
      tegel('preswedstrijd',    'Wedstrijd',    'football-whistle'),
      tegel('stats',            'Stats',        'stats-bars'),
    ]],
    ['Wedstrijden', [
      tegel('wedstrijden',      'Wedstrijden',  'football-lineup'),
      ...(modAan('evaluaties') ? [tegel('evaluatie', 'Evaluatie', 'attendance-evaluatie', evalOpen || null)] : []),
      tegel('poule',            'Poule',        'football-competition'),
    ]],
    ['Spelers', [
      tegel('spelers',          'Overzicht',    'team-members'),
      ...(modAan('leerlijn') ? [tegel('leerlijnoverzicht', 'Leerlijn', 'football-training')] : []),
      tegel('historie',         'Historie',     'attendance-overview'),
    ]],
    ['Meer', [
      tegel('planning',         'Planning',     'planning-calendar'),
      tegel('documenten',       'Documenten',   'admin-document', documentenOngelezen || null),
      ...(modAan('lijstjes') ? [tegel('lijstjes', 'Lijstjes', 'attendance-fill', lijstjesOpenTotaal() || null)] : []),
      tegel('instellingen',     'Instellingen', 'navigation-settings'),
      tegel('help',             'Help',         'navigation-help'),
      `<button class="hub-tegel" data-open-hulpchat="1">${ico('communication-chat', 40)}<span class="hub-tnaam">Hulpchat</span></button>`,
      tegel('berichten',        'Berichten',    'communication-announcement', ongelezenBerichten() || null),
    ]],
  ];

  /* Tussenstap (6 nov): de tegels staan achter één knop. Het getal op die knop telt
     de onderdelen waar iets nieuws of openstaands is; open/dicht blijft bewaard. */
  const nieuwIn = [oefenstofOngelezen, documentenOngelezen, evalOpen, ongelezenBerichten(),
    modAan('lijstjes') ? lijstjesOpenTotaal() : 0].filter(n => n > 0).length;
  const allesOpen = (() => { try { return localStorage.getItem('cluppieHubAlles') === '1'; } catch(e){ return false; } })();

  /* Update-melding: alleen de onder-link met teller. De banner bovenaan de hub is
     bewust weg (6 nov): het startscherm blijft rustig. */
  const updLink = upd.ongelezen > 0 ? `
    <button class="hub-updates-link plus" data-hub-open="updates">
      <span class="upd-l-dot"></span>Wat is er nieuw?<span class="upd-l-pil">${upd.ongelezen} nieuw</span><span class="upd-l-pijl">&#8250;</span>
    </button>` : `
    <button class="hub-updates-link" data-hub-open="updates">Wat is er nieuw? Bekijk de updates &#8250;</button>`;

  return `
    <div class="welkom-kop hub-kop">
      <div class="asv-streep" aria-hidden="true"></div>
      <img src="icons/asv-schild.png" alt="ASV'33" class="welkom-schild">
      <div class="welkom-tekst">
        <div class="welkom-datum">${esc(vandaagMooi)}</div>
        <h1 class="welkom-groet">Hoi <span class="groet-naam">${esc(voornaamCoach())}</span></h1>
      </div>
      <button class="uitlog-knop" id="hubUitloggen" title="Uitloggen"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M15 17l5-5-5-5"/><path d="M20 12H9"/><path d="M9 4H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h3"/></svg></button>
    </div>
    ${teamKeuze}
    ${htmlNu({ evaluatie: modAan('evaluaties') })}
    ${modAan('evaluaties') ? htmlRondeBalk(S._clubRondes, S.teamId, S.spelers, S.beoordelingen) : ''}
    ${htmlSelectieDashboard()}
    <button type="button" class="hub-alles-knop" id="hubAllesKnop" aria-expanded="${allesOpen}" aria-controls="hubAlles">
      ${ico('navigation-dashboard', 22)}<span class="hub-alles-naam">${HUB_ALLES_LABEL}</span>${nieuwIn ? `<span class="hub-alles-tel" aria-label="${nieuwIn} met iets nieuws">${nieuwIn}</span>` : ''}
      <svg class="hub-alles-pijl" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M6 9l6 6 6-6"/></svg>
    </button>
    <div class="hub-alles" id="hubAlles"${allesOpen ? '' : ' hidden'}>
    ${secties.map(([kop, tegels]) => `
      <section class="hub-sectie">
        <div class="hub-sectie-kop">${esc(kop)}</div>
        <div class="hub-grid">${tegels.join('')}</div>
      </section>`).join('')}
    </div>
    ${updLink}`;
}

/* ==================== PRESENTIE WEDSTRIJD ==================== */
/* [20260928e] Standaardselectie als de wedstrijd er (nog) geen heeft: iedereen,
   of bij een team met 1e + 2e elftal de spelers van het elftal van die wedstrijd.
   Zelfde regel als normaliseerWedstrijd in wedstrijd.js. */
function standaardSelectie(w){
  if (Array.isArray(w.selectie) && w.selectie.length) return w.selectie;
  if (heeftElftallen() && w.type !== 'toernooi'){
    const e = spelersVoorElftal(S.spelers, elftalWedstrijd(w)).eigen;
    if (e.length) return e.map(p => p.id);
  }
  return S.spelers.map(p => p.id);
}
/* De wedstrijd waarvoor presentie getoond wordt: gekozen door de coach, of
   standaard de eerstvolgende (vandaag of later); zonder komende wedstrijden
   de meest recente. */
export function presWedstrijdHuidig(){
  const gekozen = S.wedstrijden.find(w => w.id === S._presWedstrijdId);
  if (gekozen) return gekozen;
  const vandaag = vandaagIso();
  const komend = S.wedstrijden
    .filter(w => (w.datum || '') >= vandaag)
    .sort((a,b) => (a.datum||'').localeCompare(b.datum||'') || (a.aftrap||'').localeCompare(b.aftrap||''));
  return komend[0] || S.wedstrijden[0] || null;
}

function wedstrijdTitel(w){
  return w.thuis ? `${esc(S.team.naam)} – ${esc(w.tegenstander)}`
                 : `${esc(w.tegenstander)} – ${esc(S.team.naam)}`;
}

export function htmlPresWedstrijd(){
  const w = presWedstrijdHuidig();
  if (!w){
    return `<div class="kaart leeg">Nog geen wedstrijden.<br>Maak eerst een wedstrijd aan via de tegel <b>Wedstrijden</b>.</div>`;
  }
  /* Zonder expliciete selectie geldt: iedereen speelt mee (zelfde aanname als
     normaliseerWedstrijd in wedstrijd.js). */
  const sel = new Set(standaardSelectie(w));
  const redenen = w.afwezigRedenen || {};
  const laat = new Set(w.telaat || []);          // erbij, maar komt later
  const vanaf = w.telaatVanaf || {};             // wedstrijdminuut van aankomst
  const maxMin = Math.round((w.periodes || 4) * (w.kwartduur || 0)) || 90;
  const aanwezigN = S.spelers.filter(p => sel.has(p.id)).length;

  const kiezer = `
    <button class="pw-kiezer" id="pwKiezer">
      <span class="pw-ico">${ico('football-whistle', 20)}</span>
      <span class="pw-txt"><span class="pw-t">${wedstrijdTitel(w)}</span>
        <span class="pw-m">${elftalPillWedstrijd(w)}${datumNL(w.datum)}${w.aftrap ? '<span class="sep" aria-hidden="true"></span>'+esc(w.aftrap) : ''}<span class="sep" aria-hidden="true"></span>${w.thuis ? 'thuis' : 'uit'}</span></span>
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" class="pw-pijl"><path d="M8 9l4 4 4-4"/></svg>
    </button>`;

  /* Team met 1e + 2e elftal: eerst het elftal van deze wedstrijd, dan de
     rest van de selectie ("niet mee" zonder redenkeuze). */
  const tweeElftallen = heeftElftallen() && w.type !== 'toernooi';
  const groepen = tweeElftallen ? spelersVoorElftal(S.spelers, elftalWedstrijd(w)) : { eigen: S.spelers, rest: [] };
  const rij = (p, rest) => {
    const aanwezig = sel.has(p.id);
    const isLaat = aanwezig && laat.has(p.id);
    const info = redenen[p.id] ? afwezigRedenInfo(redenen[p.id]) : null;
    const klasse = !aanwezig ? 'afwezig' : (isLaat ? 'telaat' : 'aanwezig');
    const nietMee = !aanwezig && rest && !info;
    return `
    <div class="pres-speler ${klasse}${nietMee ? ' nietmee' : ''}">
      <button type="button" class="pres-speler-kop" data-pw-toggle="${p.id}">
        <span class="pres-shirt">${esc(p.nummer ?? '·')}</span>
        <span class="pres-naam">${esc(p.naam)}</span>
        <span class="pres-status">${!aanwezig ? (nietMee ? 'Niet mee' : 'Afwezig') : (isLaat ? 'Komt later' : 'Erbij')}</span>
      </button>
      ${!aanwezig && !nietMee ? `
      <div class="pres-reden-rij">${AFWEZIG_REDENEN.map(r =>
        `<button type="button" class="pres-reden-chip ${info?.id===r.id?'actief':''}" data-pw-reden="${r.id}" data-pid="${p.id}">${r.ico?ico(r.ico,16):r.emoji} ${r.label}</button>`).join('')}<button type="button" class="pres-reden-chip telaat-chip" data-pw-laat="${p.id}"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><circle cx="12" cy="12" r="8.6"/><path d="M12 7.2V12l3.4 2.2"/></svg> Komt later</button></div>
      ${info?.id==='anders' || (info && redenen[p.id]?.notitie) ? `<input class="invoer pres-reden-notitie" data-pw-notitie="${p.id}" placeholder="Toelichting (optioneel)" value="${esc(redenen[p.id]?.notitie||'')}">` : ''}
      ` : isLaat ? `
      <div class="pres-telaat-rij"><button type="button" class="pres-reden-chip telaat-chip actief" data-pw-laat="${p.id}"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><circle cx="12" cy="12" r="8.6"/><path d="M12 7.2V12l3.4 2.2"/></svg> Komt later: tik om te wissen</button>
        <label class="telaat-minuut">erbij vanaf min.<input type="number" inputmode="numeric" min="1" max="${maxMin}" class="invoer" data-pw-vanaf="${p.id}" value="${esc(vanaf[p.id] ?? '')}" placeholder="—"></label></div>
      ` : ''}
    </div>`;
  };
  const rijen = (tweeElftallen ? `<div class="elf-groep">${elftalNaam(elftalWedstrijd(w))}</div>` : '')
    + groepen.eigen.map(p => rij(p, false)).join('')
    + (groepen.rest.length ? `<div class="elf-groep">Rest van de selectie</div>` + groepen.rest.map(p => rij(p, true)).join('') : '');

  return `
    ${kiezer}
    <div class="pw-tel">${aanwezigN} van ${S.spelers.length} spelen mee${laat.size ? ` (${[...laat].filter(id => sel.has(id)).length} later)` : ''}<span class="sep" aria-hidden="true"></span>wijzigingen worden direct bewaard</div>
    <div class="pw-tel" style="margin-top:-4px">Komt iemand later? Tik hem op afwezig, kies <b><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><circle cx="12" cy="12" r="8.6"/><path d="M12 7.2V12l3.4 2.2"/></svg> Komt later</b> en vul eventueel de wedstrijdminuut in. De tijd daarvóór telt niet mee in zijn speeltijd-%.</div>
    ${S.spelers.length ? rijen : `<div class="kaart leeg">Nog geen spelers in dit team.</div>`}
    <button class="knop vol u-mt-md" id="pwKlaar" >Klaar</button>`;
}

/* Kiezerlijst voor de dropdown (komend eerst, dan afgelopen — beide op datum). */
export function presWedstrijdKeuzes(){
  const vandaag = vandaagIso();
  const komend = [], eerder = [];
  for (const w of S.wedstrijden){
    if ((w.datum || '') >= vandaag) komend.push(w); else eerder.push(w);
  }
  komend.sort((a,b) => (a.datum||'').localeCompare(b.datum||''));
  // eerder staat al nieuw → oud (S.wedstrijden-sortering)
  return { komend, eerder };
}

export function presWedstrijdKeuzeHtml(){
  const { komend, eerder } = presWedstrijdKeuzes();
  const huidig = presWedstrijdHuidig();
  const rij = (w) => `
    <button class="lijst-item ${huidig && w.id === huidig.id ? 'eerstvolgend' : ''}" data-pw-kies="${w.id}">
      <div class="li-tekst"><div class="titel">${wedstrijdTitel(w)}</div>
      <div class="meta">${elftalPillWedstrijd(w)}${datumNL(w.datum)}${w.aftrap ? '<span class="sep" aria-hidden="true"></span>'+esc(w.aftrap) : ''}<span class="sep" aria-hidden="true"></span>${w.thuis ? 'thuis' : 'uit'}</div></div>
      <span class="pijl">›</span></button>`;
  return `
    <h2>Kies een wedstrijd</h2>
    ${komend.length ? `<div class="veldlabel u-mb-xs">Komend</div>${komend.map(rij).join('')}` : ''}
    ${eerder.length ? `<div class="veldlabel" style="margin:var(--space-md) 0 var(--space-xs)">Gespeeld</div>${eerder.slice(0, 10).map(rij).join('')}` : ''}
    ${!komend.length && !eerder.length ? `<div class="kaart leeg">Geen wedstrijden.</div>` : ''}`;
}

/* ---------- Opslaan (selectie + redenen rechtstreeks op het wedstrijddoc) ----------
   Zelfde opschoning als modalSelectie in wedstrijd.js: valt een speler uit de
   selectie, dan verdwijnt hij ook uit opstellingen, geplande wissels en
   kaarten — maar alléén als de wedstrijd al kwarten heeft (geïmporteerde
   wedstrijden zonder opzet laten we met rust). */
export async function presWedstrijdBewaar(wijzig){
  const w = presWedstrijdHuidig();
  if (!w) return;
  const sel = new Set(standaardSelectie(w));
  const redenen = JSON.parse(JSON.stringify(w.afwezigRedenen || {}));
  const laat = new Set(w.telaat || []);
  const vanaf = {...(w.telaatVanaf || {})};
  wijzig(sel, redenen, laat, vanaf);

  const update = { selectie: [...sel] };
  const schoon = {};
  for (const [pid, r] of Object.entries(redenen)) if (!sel.has(pid)) schoon[pid] = r;
  update.afwezigRedenen = schoon;
  // "Komt later" alleen voor wie erbij is; minuut alleen voor wie later komt
  update.telaat = [...laat].filter(pid => sel.has(pid));
  const schoonVanaf = {};
  for (const pid of update.telaat) if (vanaf[pid] > 0) schoonVanaf[pid] = vanaf[pid];
  update.telaatVanaf = schoonVanaf;

  if (w.kwarten){
    const toegestaan = new Set(update.selectie);
    const kwarten = JSON.parse(JSON.stringify(w.kwarten));
    for (const kk of Object.values(kwarten)){
      for (const [slot, pid] of Object.entries(kk.lineup || {})) if (!toegestaan.has(pid)) delete kk.lineup[slot];
      kk.events = (kk.events || []).filter(e => (!e.in || toegestaan.has(e.in)) && (!e.uit || toegestaan.has(e.uit)));
      kk.plan = (kk.plan || []).filter(p => (p.in === WISSEL_BEURT || toegestaan.has(p.in)) && toegestaan.has(p.uit));
    }
    update.kwarten = kwarten;
    if (Array.isArray(w.kaarten)) update.kaarten = w.kaarten.filter(c => toegestaan.has(c.pid));
    if (w.aanvoerder && !toegestaan.has(w.aanvoerder)) update.aanvoerder = null;
  }

  try {
    await updateDoc(doc(db,'teams',S.teamId,'wedstrijden',w.id), update);
    telGebruik('selectie_kiezen');
  } catch(e){
    console.error('[Cluppie] presentie wedstrijd opslaan mislukt:', e);
    meld('Opslaan mislukt: controleer je verbinding');
  }
}

/* ==================== EVALUATIE (nog te evalueren) ==================== */
export function htmlEvaluatieLijst(){
  const open = evaluatieOpen();
  if (!open.length){
    return `<div class="kaart leeg">Alles is geëvalueerd.<br>Na de eerstvolgende gespeelde wedstrijd verschijnt hij hier.</div>`;
  }
  return `
    <p class="u-t-sm u-zacht u-mb-sm u-lh-ruim">Deze wedstrijden zijn gespeeld maar nog niet geëvalueerd. Tik op een wedstrijd om de teamevaluatie in te vullen.</p>
    ${open.map(w => `
      <button class="lijst-item" data-eval-w="${w.id}">
        <div class="li-tekst"><div class="titel">${wedstrijdTitel(w)}</div>
        <div class="meta">${datumNL(w.datum)}${w.aftrap ? '<span class="sep" aria-hidden="true"></span>'+esc(w.aftrap) : ''}</div></div>
        <span class="badge" style="background:var(--accent);color:var(--wit)">Evalueren</span>
        <span class="pijl">›</span></button>`).join('')}`;
}

/* ==================== LEERLIJN-OVERZICHT ==================== */
export function htmlLeerlijnOverzicht(){
  const metPunten = S.spelers
    .map(p => ({ p, lps: (p.leerpunten || []) }))
    .filter(x => x.lps.length);
  if (!metPunten.length){
    return `<div class="kaart leeg">Nog geen leerpunten.<br>Voeg leerpunten toe via het spelersprofiel (tegel <b>Overzicht</b> → speler → tab <b>Leerlijn</b>).</div>`;
  }
  const blok = ({p, lps}) => {
    const open = lps.filter(l => !l.klaar).length;
    const gesorteerd = [...lps].sort((a,b) => (a.klaar?1:0)-(b.klaar?1:0) || (b.sinds||'').localeCompare(a.sinds||''));
    return `
      <button class="lpl-blok" data-lp-profiel="${p.id}">
        <div class="lpl-kop">
          <span class="pres-shirt">${esc(p.nummer ?? '·')}</span>
          <span class="lpl-naam">${esc(p.naam)}</span>
          <span class="lpl-tel">${open ? `${open} open` : 'alles behaald ✓'}</span>
        </div>
        <div class="lpl-wrap">${gesorteerd.map(l =>
          `<span class="lpl-chip ${l.klaar ? 'klaar' : ''}">${l.domein ? `<span class="lpl-dom">${esc(l.domein)}</span>` : ''}${esc(l.tekst || '')}</span>`).join('')}</div>
      </button>`;
  };
  const totOpen = metPunten.reduce((n,x) => n + x.lps.filter(l=>!l.klaar).length, 0);
  return `
    <p class="u-t-sm u-zacht u-mb-sm u-lh-ruim">${totOpen} open leerpunt${totOpen===1?'':'en'} in het team. Tik op een speler om leerpunten te bewerken of af te vinken.</p>
    ${metPunten.map(blok).join('')}`;
}

/* ==================== HISTORIE (spelerkeuze) ==================== */
export function htmlHistorieLijst(){
  if (!S.spelers.length){
    return `<div class="kaart leeg">Nog geen spelers in dit team.</div>`;
  }
  return `
    <p class="u-t-sm u-zacht u-mb-sm u-lh-ruim">Kies een speler om de historie te bekijken: beoordelingen en ontwikkeling over de tijd.</p>
    ${S.spelers.map(p => `
      <button class="lijst-item" data-hist-profiel="${p.id}">
        <span class="pres-shirt" style="margin-right:var(--space-3xs)">${esc(p.nummer ?? '·')}</span>
        <div class="li-tekst"><div class="titel">${esc(p.naam)}</div></div>
        <span class="pijl">›</span></button>`).join('')}`;
}
