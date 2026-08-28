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
import { db, doc, updateDoc } from './firebase.js?v=20260811a';
import { S, esc, meld, datumNL, modAan } from './state.js?v=20260828b';
import { AFWEZIG_REDENEN, afwezigRedenInfo } from './config.js?v=20260828b';
import { ico } from './icons.js?v=20260825b';
import { analyseWedstrijd } from './analyse.js?v=20260828b';
import { telGebruik } from './tracker.js?v=20260828b';
import { ongelezenBerichten } from './berichten.js?v=20260828b';

/* Zelfde sentinel als in wedstrijd.js (daar niet geëxporteerd): geplande
   wissel met "wie aan de beurt is" i.p.v. een concrete speler. */
const WISSEL_BEURT = '__beurt__';

/* ---------- Hulpjes ---------- */
function voornaamCoach(){
  let naam = '';
  for (const t of S.teams){ const n = t.ledenInfo?.[S.user.uid]?.naam; if (n){ naam = n; break; } }
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
      <span class="hub-teamsub">${S.team.categorie ? esc(S.team.categorie)+' · ' : ''}${esc(S.team.format)} tegen ${esc(S.team.format)}</span>
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
      tegel('instellingen',     'Instellingen', 'navigation-settings'),
      tegel('help',             'Help',         'navigation-help'),
      `<button class="hub-tegel" data-open-hulpchat="1">${ico('communication-chat', 40)}<span class="hub-tnaam">Hulpchat</span></button>`,
      tegel('berichten',        'Berichten',    'communication-announcement', ongelezenBerichten() || null),
    ]],
  ];

  /* Update-melding — combi van banner (bovenaan) en verrijkte onder-link.
     Beide verschijnen alleen zolang er ongelezen updates zijn; zodra de
     coach de Updates-tab opent, markeert htmlUpdates() alles als gezien en
     valt de melding vanzelf weg. De banner is per sessie weg te tikken
     (S._updBannerWeg) zonder de teller op de onder-link te wissen. */
  const updBanner = (upd.ongelezen > 0 && !S._updBannerWeg) ? `
    <button class="upd-banner" data-hub-open="updates">
      <span class="upd-b-ico">${ico('communication-announcement', 22)}</span>
      <span class="upd-b-txt">
        <span class="upd-b-rij1"><span class="upd-b-badge">Nieuw</span><span class="upd-b-tel">${upd.ongelezen} nieuwe update${upd.ongelezen === 1 ? '' : 's'}</span></span>
        <span class="upd-b-titel">${esc(upd.nieuwsteTitel)}</span>
        <span class="upd-b-sub">Tik om te bekijken wat er nieuw is</span>
      </span>
      <svg class="upd-b-pijl" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 6l6 6-6 6"/></svg>
      <span class="upd-b-sluit" id="updBannerSluit" role="button" aria-label="Verbergen">&#10005;</span>
    </button>` : '';

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
    ${updBanner}
    ${secties.map(([kop, tegels]) => `
      <section class="hub-sectie">
        <div class="hub-sectie-kop">${esc(kop)}</div>
        <div class="hub-grid">${tegels.join('')}</div>
      </section>`).join('')}
    ${updLink}`;
}

/* ==================== PRESENTIE WEDSTRIJD ==================== */
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
  const sel = new Set(Array.isArray(w.selectie) && w.selectie.length ? w.selectie : S.spelers.map(p => p.id));
  const redenen = w.afwezigRedenen || {};
  const aanwezigN = S.spelers.filter(p => sel.has(p.id)).length;

  const kiezer = `
    <button class="pw-kiezer" id="pwKiezer">
      <span class="pw-ico">${ico('football-whistle', 20)}</span>
      <span class="pw-txt"><span class="pw-t">${wedstrijdTitel(w)}</span>
        <span class="pw-m">${datumNL(w.datum)}${w.aftrap ? ' · '+esc(w.aftrap) : ''} · ${w.thuis ? 'thuis' : 'uit'}</span></span>
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" class="pw-pijl"><path d="M8 9l4 4 4-4"/></svg>
    </button>`;

  const rijen = S.spelers.map(p => {
    const aanwezig = sel.has(p.id);
    const info = redenen[p.id] ? afwezigRedenInfo(redenen[p.id]) : null;
    return `
    <div class="pres-speler ${aanwezig ? 'aanwezig' : 'afwezig'}">
      <button type="button" class="pres-speler-kop" data-pw-toggle="${p.id}">
        <span class="pres-shirt">${esc(p.nummer ?? '·')}</span>
        <span class="pres-naam">${esc(p.naam)}</span>
        <span class="pres-status">${aanwezig ? 'Erbij' : 'Afwezig'}</span>
      </button>
      ${!aanwezig ? `
      <div class="pres-reden-rij">${AFWEZIG_REDENEN.map(r =>
        `<button type="button" class="pres-reden-chip ${info?.id===r.id?'actief':''}" data-pw-reden="${r.id}" data-pid="${p.id}">${r.ico?ico(r.ico,16):r.emoji} ${r.label}</button>`).join('')}</div>
      ${info?.id==='anders' || (info && redenen[p.id]?.notitie) ? `<input class="invoer pres-reden-notitie" data-pw-notitie="${p.id}" placeholder="Toelichting (optioneel)" value="${esc(redenen[p.id]?.notitie||'')}">` : ''}
      ` : ''}
    </div>`;
  }).join('');

  return `
    ${kiezer}
    <div class="pw-tel">${aanwezigN} van ${S.spelers.length} spelen mee · wijzigingen worden direct bewaard</div>
    ${S.spelers.length ? rijen : `<div class="kaart leeg">Nog geen spelers in dit team.</div>`}`;
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
      <div class="meta">${datumNL(w.datum)}${w.aftrap ? ' · '+esc(w.aftrap) : ''} · ${w.thuis ? 'thuis' : 'uit'}</div></div>
      <span class="pijl">›</span></button>`;
  return `
    <h2>Kies een wedstrijd</h2>
    ${komend.length ? `<div class="veldlabel" style="margin-bottom:8px">Komend</div>${komend.map(rij).join('')}` : ''}
    ${eerder.length ? `<div class="veldlabel" style="margin:14px 0 8px">Gespeeld</div>${eerder.slice(0, 10).map(rij).join('')}` : ''}
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
  const sel = new Set(Array.isArray(w.selectie) && w.selectie.length ? w.selectie : S.spelers.map(p => p.id));
  const redenen = JSON.parse(JSON.stringify(w.afwezigRedenen || {}));
  wijzig(sel, redenen);

  const update = { selectie: [...sel] };
  const schoon = {};
  for (const [pid, r] of Object.entries(redenen)) if (!sel.has(pid)) schoon[pid] = r;
  update.afwezigRedenen = schoon;

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
    meld('Opslaan mislukt — controleer je verbinding');
  }
}

/* ==================== EVALUATIE (nog te evalueren) ==================== */
export function htmlEvaluatieLijst(){
  const open = evaluatieOpen();
  if (!open.length){
    return `<div class="kaart leeg">Alles is geëvalueerd. 🎉<br>Na de eerstvolgende gespeelde wedstrijd verschijnt hij hier.</div>`;
  }
  return `
    <p style="font-size:calc(13px * var(--fs));color:var(--ink-2);margin-bottom:12px;line-height:1.5">Deze wedstrijden zijn gespeeld maar nog niet geëvalueerd. Tik op een wedstrijd om de teamevaluatie in te vullen.</p>
    ${open.map(w => `
      <button class="lijst-item" data-eval-w="${w.id}">
        <div class="li-tekst"><div class="titel">${wedstrijdTitel(w)}</div>
        <div class="meta">${datumNL(w.datum)}${w.aftrap ? ' · '+esc(w.aftrap) : ''}</div></div>
        <span class="badge" style="background:var(--accent);color:#fff">Evalueren</span>
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
      <button class="lp-blok" data-lp-profiel="${p.id}">
        <div class="lp-kop">
          <span class="pres-shirt">${esc(p.nummer ?? '·')}</span>
          <span class="lp-naam">${esc(p.naam)}</span>
          <span class="lp-tel">${open ? `${open} open` : 'alles behaald ✓'}</span>
        </div>
        <div class="lp-wrap">${gesorteerd.map(l =>
          `<span class="lp-chip ${l.klaar ? 'klaar' : ''}">${l.domein ? `<span class="lp-dom">${esc(l.domein)}</span>` : ''}${esc(l.tekst || '')}</span>`).join('')}</div>
      </button>`;
  };
  const totOpen = metPunten.reduce((n,x) => n + x.lps.filter(l=>!l.klaar).length, 0);
  return `
    <p style="font-size:calc(13px * var(--fs));color:var(--ink-2);margin-bottom:12px;line-height:1.5">${totOpen} open leerpunt${totOpen===1?'':'en'} in het team. Tik op een speler om leerpunten te bewerken of af te vinken.</p>
    ${metPunten.map(blok).join('')}`;
}

/* ==================== HISTORIE (spelerkeuze) ==================== */
export function htmlHistorieLijst(){
  if (!S.spelers.length){
    return `<div class="kaart leeg">Nog geen spelers in dit team.</div>`;
  }
  return `
    <p style="font-size:calc(13px * var(--fs));color:var(--ink-2);margin-bottom:12px;line-height:1.5">Kies een speler om de historie te bekijken: beoordelingen en ontwikkeling over de tijd.</p>
    ${S.spelers.map(p => `
      <button class="lijst-item" data-hist-profiel="${p.id}">
        <span class="pres-shirt" style="margin-right:2px">${esc(p.nummer ?? '·')}</span>
        <div class="li-tekst"><div class="titel">${esc(p.naam)}</div></div>
        <span class="pijl">›</span></button>`).join('')}`;
}
