/* ==================== TRAININGEN / VIDEO'S / INSTELLINGEN (teams.js-split) ====================
   Onderdeel van de teams.js-modulaire split. Alles rond de Training- en
   Instellingen-tabbladen van een team: gedeelde trainingen + video's tonen,
   presentie bijhouden (incl. eigen/geplande dagen), en teaminstellingen
   (naam wijzigen, teamcode, uitnodigen — modalUitnodig komt uit club.js). */
import {
  db, collection, doc, addDoc, deleteDoc, updateDoc, setDoc, getDocs, query, where, serverTimestamp
} from './firebase.js?v=20260719';
import {
  S, $, $$, esc, meld, datumNL, speler, initialen, openModal, sluitModal, toon
} from './state.js?v=20260719';
import {
  CATEGORIEEN, CATEGORIEEN_MEIDEN, catInfo, youtubeId, youtubeThumb, youtubeWatch
} from './config.js?v=20260719';
import { htmlKompas } from './teams-leerlijn.js?v=20260719';

/* ---------- Afgelaste training (banner + WhatsApp-deeltekst) ----------
   Hierheen verplaatst (i.p.v. in de hub) omdat dit uitsluitend door de
   Training-tab wordt gebruikt: htmlTeamTrainingen() hieronder, en de
   "stuur door"-knop die de hub (teams.js/koppelTeamTab) aansluit — de hub
   importeert afgelastGeldig/afgelastWhatsappTekst vandaar terug, en
   re-exporteert afgelastDatumTekst voor externe consumenten. */
function afgelastGeldig(){
  const a = S.team && S.team.afgelast;
  if (!a || !a.datum) return null;
  const vandaag = new Date().toISOString().slice(0,10);
  return (a.datum >= vandaag) ? a : null;   // alleen vandaag of in de toekomst
}

/* 'YYYY-MM-DD' -> 'donderdag 25 juni' (met hoofdletter) */
export function afgelastDatumTekst(datum){
  const d = new Date(datum+'T12:00').toLocaleDateString('nl-NL',{weekday:'long',day:'numeric',month:'long'});
  return d.charAt(0).toUpperCase()+d.slice(1);
}

/* de WhatsApp-tekst die de trainer doorstuurt naar zijn eigen teamgroep — zonder naam */
export function afgelastWhatsappTekst(a){
  const dag = afgelastDatumTekst(a.datum);
  let t = `⛔ *Training afgelast*\n`;
  t += `De training van ${dag} gaat *niet* door.`;
  if (a.reden && a.reden.trim()) t += `\n\n${a.reden.trim()}`;
  return t;
}

/* de rode banner bovenaan de trainingen-tab (zichtbaar voor alle teamleden) */
function afgelastBannerHtml(a){
  const dag = afgelastDatumTekst(a.datum);
  return `
    <div class="afgelast-banner">
      <div class="ab-kop"><span class="ab-ico">⛔</span><h2>Training afgelast</h2></div>
      <div class="ab-tekst">De training van <b>${esc(dag)}</b> gaat <b>niet</b> door.
        ${a.reden && a.reden.trim() ? `<div class="ab-reden">${esc(a.reden.trim())}</div>` : ''}</div>
      <button class="ab-wa-vol" id="afgelastDeel">📲 Stuur door in mijn teamgroep</button>
    </div>`;
}

export { afgelastGeldig };


export function htmlTeamTrainingen(){
  const pdfs = S.trainingen.filter(t => (t.teams||[]).includes(S.teamId));
  const vandaag = new Date().toISOString().slice(0,10);
  const alGeregistreerd = S.presentie.find(p => p.datum === vandaag);

  // afgelasting: toon banner als die geldt (geen aflast-knop hier; dat doet de beheerder op het clubscherm)
  const afg = afgelastGeldig();
  const afgelastSectie = afg ? afgelastBannerHtml(afg) : '';

  // welke maanden zijn opengeklapt? standaard alles dicht; openTeam reset dit
  // bij elke teamopening. Hier alleen een vangnet als de sets nog niet bestaan.
  if (!S._presentieOpen){
    S._presentieOpen = new Set();                       // 'YYYY-MM' van opengeklapte maanden
    S._presentieToonAlles = new Set();                  // maanden waar alle items getoond worden
  }
  const TOON_PER_MAAND = 4;   // standaard aantal per maand voordat "toon meer" verschijnt

  const maandNaam = (ym) => {
    const [j,m] = ym.split('-');
    const d = new Date(parseInt(j), parseInt(m)-1, 1);
    const s = d.toLocaleDateString('nl-NL', {month:'long', year:'numeric'});
    return s.charAt(0).toUpperCase()+s.slice(1);
  };
  const rijHtml = (p) => {
    const afw = (p.afwezig || []);
    const aanwezig = Math.max(0, S.spelers.length - afw.length);
    const dat = new Date(p.datum+'T12:00').toLocaleDateString('nl-NL',{weekday:'short',day:'numeric',month:'short'});
    const datMooi = dat.charAt(0).toUpperCase()+dat.slice(1);
    const afwNamen = afw.length
      ? afw.map(id => {
          const sp = S.spelers.find(s => s.id === id); if (!sp) return null;
          const reden = (p.afwezigRedenen||{})[id];
          const icoon = reden?.type === 'blessure' ? ' 🩹' : reden?.type === 'reden' ? ' 📋' : '';
          return esc(sp.naam) + icoon;
        }).filter(Boolean).join(', ')
      : '';
    return `
      <div class="presentie-rij" data-presentie="${p.id}" style="cursor:pointer">
        <div class="pr-datum"><span class="pr-dag">${datMooi}</span></div>
        <div class="pr-info">
          ${afw.length
            ? `<span class="pr-afw">${aanwezig} aanwezig · ${afw.length} afwezig</span><span class="pr-namen">${afwNamen}</span>`
            : `<span class="pr-allen">✓ Iedereen aanwezig (${aanwezig})</span>`}
        </div>
        <span class="acties"><button title="Aanpassen">✏️</button></span>
      </div>`;
  };

  // groepeer presentie per maand (S.presentie is al gesorteerd nieuw → oud)
  let presentieLijst;
  if (!S.presentie.length){
    presentieLijst = `<div class="kaart leeg" style="margin-bottom:14px">Nog geen presentie geregistreerd.</div>`;
  } else {
    const perMaand = new Map();
    for (const p of S.presentie){
      const ym = (p.datum||'').slice(0,7);
      if (!perMaand.has(ym)) perMaand.set(ym, []);
      perMaand.get(ym).push(p);
    }
    presentieLijst = [...perMaand.entries()].map(([ym, items]) => {
      const open = S._presentieOpen.has(ym);
      const toonAlles = S._presentieToonAlles.has(ym);
      const afwTotaal = items.reduce((n,p) => n + (p.afwezig||[]).length, 0);
      const zichtbaar = (open && !toonAlles) ? items.slice(0, TOON_PER_MAAND) : items;
      const meer = items.length - TOON_PER_MAAND;
      return `
        <div class="maand-groep">
          <button class="maand-kop" data-maand="${ym}">
            <span class="maand-naam">${maandNaam(ym)}</span>
            <span class="maand-tel">${items.length} training${items.length>1?'en':''}${afwTotaal?` · ${afwTotaal} afm.`:''}</span>
            <span class="maand-pijl ${open?'open':''}">▾</span>
          </button>
          ${open ? `
            <div class="maand-inhoud">
              ${zichtbaar.map(rijHtml).join('')}
              ${(!toonAlles && meer > 0) ? `<button class="toon-meer" data-toonmeer="${ym}">Toon ${meer} eerdere uit deze maand</button>` : ''}
            </div>` : ''}
        </div>`;
    }).join('');
  }

  const alGeregAanwezig = alGeregistreerd ? Math.max(0, S.spelers.length - (alGeregistreerd.afwezig||[]).length) : 0;
  const alGeregAfwezig = alGeregistreerd ? (alGeregistreerd.afwezig||[]).length : 0;

  const presentieSectie = `
    <div class="sectie-kop" style="margin-top:0">📋 Presentie training</div>
    ${alGeregistreerd
      ? `<div class="kaart" style="background:rgba(226,6,19,.07);border-left:3px solid var(--grass);font-size:13px;margin-bottom:10px">Vandaag al geregistreerd. ${alGeregAanwezig} aanwezig en ${alGeregAfwezig} afwezig.</div>`
      : `<button class="knop vol" id="presentieVandaag" style="margin-bottom:12px">✓ Wie is er vandaag?</button>`}
    ${presentieLijst}`;

  // --- PDF-sectie (ook per maand, zelfde gedrag als presentie) ---
  // huidige maand staat standaard open; gebruiker kan maanden dicht/open klappen.
  if (!S._pdfDicht){ S._pdfDicht = new Set(); S._pdfToonAlles = new Set(); }

  const pdfRijHtml = (t) => {
    const ongelezen = !S.trainingenGelezen[t.id];
    const datum = t.gemaakt?.seconds ? new Date(t.gemaakt.seconds*1000).toLocaleDateString('nl-NL',{day:'numeric',month:'short'}) : '';
    return `
      <div class="training-rij ${ongelezen?'ongelezen':''}" data-open-training="${t.id}" data-url="${esc(t.url)}" style="cursor:pointer">
        <div class="ico">PDF</div>
        <div class="t"><div class="t-titel">${esc(t.titel || t.bestandsnaam)}</div>
          <div class="t-meta">${esc(t.week || '')}${t.week && datum?' · ':''}${esc(datum)}${t.clubNaam?' · '+esc(t.clubNaam):''}</div></div>
        <div class="acties"><button title="Openen">↗</button></div>
      </div>`;
  };

  let pdfLijst;
  if (!pdfs.length){
    pdfLijst = `<div class="kaart leeg">Nog geen trainingen gedeeld.<br>Elke zondag zet je clubadmin hier de oefenstof voor de komende week klaar.</div>`;
  } else {
    // nieuw → oud op uploaddatum; items zonder datum gaan naar 'Eerder'
    const gesorteerd = [...pdfs].sort((a,b) => (b.gemaakt?.seconds||0) - (a.gemaakt?.seconds||0));
    const perMaand = new Map();
    for (const t of gesorteerd){
      const ym = t.gemaakt?.seconds
        ? new Date(t.gemaakt.seconds*1000).toISOString().slice(0,7)
        : 'eerder';
      if (!perMaand.has(ym)) perMaand.set(ym, []);
      perMaand.get(ym).push(t);
    }
    const eersteYm = [...perMaand.keys()][0];   // nieuwste maand
    const TOON_PDF = 5;
    pdfLijst = [...perMaand.entries()].map(([ym, items]) => {
      // standaard open: de nieuwste maand. Tenzij de gebruiker hem dichtklapte.
      // overige maanden standaard dicht, tenzij de gebruiker ze openklapte (dan staan ze NIET in _pdfDicht maar markeren we expliciet).
      const standaardOpen = (ym === eersteYm);
      const open = standaardOpen ? !S._pdfDicht.has(ym) : S._pdfDicht.has('open:'+ym);
      const toonAlles = S._pdfToonAlles.has(ym);
      const titel = ym === 'eerder' ? 'Eerder' : maandNaam(ym);
      const ongelezenInMaand = items.filter(t => !S.trainingenGelezen[t.id]).length;
      const zichtbaar = (open && !toonAlles) ? items.slice(0, TOON_PDF) : items;
      const meer = items.length - TOON_PDF;
      return `
        <div class="maand-groep">
          <button class="maand-kop" data-pdfmaand="${ym}">
            <span class="maand-naam">${esc(titel)}</span>
            <span class="maand-tel">${items.length} training${items.length>1?'en':''}${ongelezenInMaand?` · <b style="color:var(--uit)">${ongelezenInMaand} nieuw</b>`:''}</span>
            <span class="maand-pijl ${open?'open':''}">▾</span>
          </button>
          ${open ? `
            <div class="maand-inhoud">
              ${zichtbaar.map(pdfRijHtml).join('')}
              ${(!toonAlles && meer > 0) ? `<button class="toon-meer" data-pdftoonmeer="${ym}">Toon ${meer} eerdere uit deze maand</button>` : ''}
            </div>` : ''}
        </div>`;
    }).join('');
  }

  const pdfSectie = `
    <div class="sectie-kop">📄 Gedeelde trainingen</div>
    ${pdfLijst}`;

  return htmlKompas() + afgelastSectie + presentieSectie + pdfSectie;
}

/* ---------- Tab: video's ---------- */
export function htmlTeamVideos(){
  const lijst = S.videos.filter(t => (t.teams||[]).includes(S.teamId));
  if (!lijst.length) return `<div class="kaart leeg">Nog geen video's.<br>Vraag je clubadmin om YouTube-video's te delen met dit team.</div>`;
  return lijst.map(vid => {
    const id = youtubeId(vid.url);
    return `
    <div class="video-rij" data-open-video="${esc(youtubeWatch(id) || vid.url)}" style="cursor:pointer">
      <div class="thumb">${id ? `<img src="${esc(youtubeThumb(id))}" alt="" loading="lazy"><span class="play">▶</span>` : '<span class="play">▶</span>'}</div>
      <div class="v"><div class="v-titel">${esc(vid.titel || 'Video')}</div>
        <div class="v-meta">${vid.clubNaam ? esc(vid.clubNaam) : 'YouTube'}</div></div>
      <div class="acties"><button title="Afspelen">▶</button></div>
    </div>`;
  }).join('');
}

/* ---------- Tab: instellingen (incl. ledenbeheer) ---------- */
export function htmlInstellingen(){
  const ledenInfo = S.team.ledenInfo || {};
  const ledenIds = Object.keys(S.team.leden || {});
  const ledenHtml = ledenIds.length ? ledenIds.map(uid => {
    const naam = (ledenInfo[uid]?.naam) || 'Coach';
    const jij = uid === S.user.uid;
    return `
      <div class="lid-rij">
        <div class="lid-avatar">${esc(initialen(naam))}</div>
        <div class="lid-naam">${esc(naam)}${jij?'<span class="jij">(jij)</span>':''}</div>
        ${jij ? '' : `<button class="lid-weg" data-lid-weg="${uid}" data-lid-naam="${esc(naam)}" title="Coach verwijderen">🗑</button>`}
      </div>`;
  }).join('') : '<p style="font-size:14px">—</p>';

  return `
    <div class="kaart">
      <div class="sectie-kop" style="margin-top:0">Teamnaam</div>
      <input class="invoer" id="iTeamNaam" value="${esc(S.team.naam)}" autocomplete="off" style="margin-bottom:10px">
      <label class="lid-rij" style="cursor:pointer;margin-bottom:10px">
        <input type="checkbox" id="iCodeVolgtNaam" checked style="width:19px;height:19px;accent-color:var(--grass)">
        <div class="lid-naam" style="font-weight:500">Code aanpassen aan de nieuwe naam
          <span style="display:block;font-size:11.5px;color:var(--ink-2);font-weight:400">Bijv. ASVJO10-2 — let op: oude uitnodigingslinks werken dan niet meer</span></div>
      </label>
      <button class="knop vol" id="iNaamOk">Naam opslaan</button>
    </div>
    <div class="kaart">
      <div class="sectie-kop" style="margin-top:0">Teamcode voor coaches</div>
      <p style="font-size:13.5px;color:var(--ink-2)">Deel deze code of een uitnodigingslink met collega-coaches. Zij loggen in met e-mail of Google en zitten direct in dit team.</p>
      <div class="teamcode">${esc(S.team.code)}</div>
      <div class="rij">
        <button class="knop licht vol" id="deelCode">Code kopiëren</button>
        <button class="knop fluo vol" id="deelLink">📲 Uitnodigen</button>
      </div>
      <button class="knop licht vol" id="wijzigCode" style="margin-top:8px">✏️ Code handmatig wijzigen</button>
    </div>
    <div class="kaart">
      <div class="sectie-kop" style="margin-top:0">Coaches (${ledenIds.length})</div>
      <p style="font-size:12.5px;color:var(--ink-2);margin-bottom:10px">Staat er iemand dubbel of verkeerd in de lijst? Verwijder die met 🗑.</p>
      ${ledenHtml}
      <button class="knop licht vol" id="wijzigMijnNaam" style="margin-top:10px">✏️ Mijn weergavenaam wijzigen</button>
    </div>
    <div class="kaart">
      <div class="sectie-kop" style="margin-top:0">Categorie & speelregels</div>
      <select class="invoer" id="iCategorie" style="margin-bottom:8px">
        <option value="">— geen categorie —</option>
        <optgroup label="Jongens">${Object.keys(CATEGORIEEN).map(c => `<option value="${c}" ${S.team.categorie===c?'selected':''}>${c}</option>`).join('')}</optgroup>
        <optgroup label="Meiden">${Object.keys(CATEGORIEEN_MEIDEN).map(c => `<option value="${c}" ${S.team.categorie===c?'selected':''}>${c}</option>`).join('')}</optgroup>
      </select>
      <p style="font-size:12.5px;color:var(--ink-2)" id="iCatInfo">${S.team.categorie && catInfo(S.team.categorie)
        ? 'KNVB: ' + esc(catInfo(S.team.categorie).knvb) + '. Nieuwe wedstrijden krijgen automatisch de juiste speeltijd en periodes.'
        : 'Kies de categorie zodat nieuwe wedstrijden automatisch de juiste KNVB-speeltijd en het juiste aantal helften/kwarten krijgen.'}</p>
    </div>
    <button class="knop gevaar vol" id="verlaatTeam">Team verlaten</button>`;
}

/* ---------- Tab: handleiding ---------- */

export function modalWijzigCode(){
  openModal(`
    <h2>Teamcode wijzigen</h2>
    <p style="font-size:13.5px;color:var(--ink-2);margin-bottom:6px">De code is wat coaches invullen om aan te sluiten. Houd 'm herkenbaar (bijv. <b>ASVJO11-1</b>) of juist moeilijk te raden.</p>
    <p style="font-size:12px;color:var(--ink-2);margin-bottom:12px">Let op: bestaande uitnodigingslinks met de oude code werken daarna niet meer.</p>
    <div class="veldgroep"><label>Nieuwe code</label>
      <input class="invoer" id="mWcCode" value="${esc(S.team.code)}" maxlength="20"
        style="text-transform:uppercase;font-family:'Barlow Condensed';font-size:20px;letter-spacing:1px"></div>
    <button class="knop vol" id="mWcOk">Code opslaan</button>`);
  $('#mWcOk').onclick = async () => {
    const nieuw = $('#mWcCode').value.trim().toUpperCase().replace(/[^A-Z0-9-]+/g,'');
    if (nieuw.length < 4) return meld('Een code is minstens 4 tekens');
    if (nieuw === S.team.code){ sluitModal(); return; }
    $('#mWcOk').disabled = true; $('#mWcOk').textContent = 'Controleren...';
    try {
      const snap = await getDocs(query(collection(db,'teams'), where('code','==',nieuw)));
      if (!snap.empty){
        $('#mWcOk').disabled = false; $('#mWcOk').textContent = 'Code opslaan';
        return meld('Die code is al in gebruik bij een ander team');
      }
      await updateDoc(doc(db,'teams',S.teamId), {code: nieuw});
      sluitModal(); meld('Teamcode gewijzigd naar ' + nieuw);
    } catch(e){
      $('#mWcOk').disabled = false; $('#mWcOk').textContent = 'Code opslaan';
      meld('Wijzigen mislukt: ' + (e.code || e.message));
    }
  };
}

/* De ingelogde coach past zijn eigen weergavenaam aan. Dit werkt door in
   ALLE teams waar hij lid van is, zodat hij overal met dezelfde naam staat. */
export function modalMijnNaam(){
  const huidige = (S.team.ledenInfo?.[S.user.uid]?.naam) || S.user.displayName || '';
  const aantalTeams = S.teams.length;
  openModal(`
    <h2>Mijn weergavenaam</h2>
    <p style="font-size:13.5px;color:var(--ink-2);margin-bottom:12px">Zo verschijn je in de coachlijst. ${aantalTeams > 1 ? `De naam wordt aangepast in al je <b>${aantalTeams}</b> teams.` : ''}</p>
    <div class="veldgroep"><label>Je naam</label>
      <input class="invoer" id="mMnNaam" value="${esc(huidige)}" placeholder="Bijv. Paul Lijten" autocomplete="name"></div>
    <button class="knop vol" id="mMnOk">Opslaan</button>`);
  $('#mMnNaam').focus();
  $('#mMnOk').onclick = async () => {
    const naam = $('#mMnNaam').value.trim();
    if (naam.length < 2) return meld('Vul je naam in (minstens 2 tekens)');
    const knop = $('#mMnOk');
    knop.disabled = true; knop.textContent = 'Opslaan...';
    try {
      // bijwerken in elk team waar deze gebruiker lid van is
      const mijnTeams = S.teams.filter(t => (t.leden||{})[S.user.uid]);
      for (const t of mijnTeams){
        await updateDoc(doc(db,'teams',t.id), {
          ['ledenInfo.'+S.user.uid+'.naam']: naam,
        });
      }
      sluitModal();
      meld(mijnTeams.length > 1 ? `Naam aangepast in ${mijnTeams.length} teams` : 'Naam aangepast');
    } catch(e){
      knop.disabled = false; knop.textContent = 'Opslaan';
      meld('Opslaan mislukt: ' + (e.code || e.message));
    }
  };
}

/* ---------- Presentie registreren / aanpassen ----------
   Iedereen staat standaard op AANWEZIG. De coach tikt alleen de afwezigen aan.
   Bij een nieuwe registratie (bestaande=null) kan de datum gekozen worden
   (standaard vandaag). Voor afwezige spelers kan optioneel een reden
   aangevinkt worden: geblesseerd of "met reden" (+ vrije notitie). Geen van
   beide aangevinkt = "zonder reden". */

export function modalPresentie(bestaande = null){
  if (!S.spelers.length) return meld('Voeg eerst spelers toe onder het tabblad Spelers');
  const vandaag = new Date().toISOString().slice(0,10);
  let datum = bestaande ? bestaande.datum : vandaag;
  let afwezig = new Set(bestaande ? (bestaande.afwezig || []) : []);
  let redenen = bestaande ? JSON.parse(JSON.stringify(bestaande.afwezigRedenen || {})) : {};
  const kanDatumWijzigen = !bestaande;

  const datLeesbaar = (d) => {
    const s = new Date(d+'T12:00').toLocaleDateString('nl-NL',{weekday:'long',day:'numeric',month:'long'});
    return s.charAt(0).toUpperCase()+s.slice(1);
  };

  const rijenHtml = () => S.spelers.map(p => {
    const isAfw = afwezig.has(p.id);
    const reden = redenen[p.id];
    return `
    <div class="pres-speler ${isAfw?'afwezig':'aanwezig'}">
      <button type="button" class="pres-speler-kop" data-toggle="${p.id}">
        <span class="pres-shirt">${esc(p.nummer ?? '·')}</span>
        <span class="pres-naam">${esc(p.naam)}</span>
        <span class="pres-status">${isAfw?'Afwezig':'Aanwezig'}</span>
      </button>
      ${isAfw ? `
      <div class="pres-reden-rij">
        <button type="button" class="pres-reden-chip ${reden?.type==='blessure'?'actief':''}" data-reden="blessure" data-pid="${p.id}">🩹 Geblesseerd</button>
        <button type="button" class="pres-reden-chip ${reden?.type==='reden'?'actief':''}" data-reden="reden" data-pid="${p.id}">📋 Met reden</button>
      </div>
      ${reden?.type==='reden' ? `<input class="invoer pres-reden-notitie" data-pid="${p.id}" placeholder="Bijv. ziek, vakantie, school (optioneel)" value="${esc(reden.notitie||'')}">` : ''}
      ` : ''}
    </div>`;
  }).join('');

  openModal(`
    <h2>Presentie training</h2>
    ${kanDatumWijzigen ? `
    <div class="veldgroep" style="margin-bottom:10px">
      <label>Datum</label>
      <div class="segment" id="mPresDatumSeg">
        <button type="button" data-d="vandaag" class="actief">Vandaag</button>
        <button type="button" data-d="ander">Andere dag</button>
      </div>
      <input class="invoer" type="date" id="mPresDatumInput" value="${datum}" style="display:none;margin-top:8px">
    </div>` : ''}
    <p style="font-size:13px;color:var(--ink-2);margin-bottom:4px;text-transform:capitalize" id="mPresDatumTekst">${esc(datLeesbaar(datum))}</p>
    <p style="font-size:12px;color:var(--warn);margin-bottom:4px;display:none" id="mPresBestaatMelding">Let op: voor deze dag is al presentie geregistreerd — je past de bestaande registratie aan.</p>
    <p style="font-size:12.5px;color:var(--ink-2);margin-bottom:12px">Iedereen staat op <b>aanwezig</b>. Tik wie er <b>niet</b> is.</p>
    <div class="pres-lijst" id="mPresLijst">${rijenHtml()}</div>
    <div class="rij" style="margin-top:14px">
      ${bestaande ? '<button class="knop licht vol" id="mPresWeg" style="color:var(--uit)">Verwijderen</button>' : ''}
      <button class="knop vol" id="mPresOk">Opslaan</button>
    </div>`);

  const koppelRijen = () => {
    $$('[data-toggle]').forEach(b => b.onclick = () => {
      const id = b.dataset.toggle;
      if (afwezig.has(id)){ afwezig.delete(id); delete redenen[id]; }
      else afwezig.add(id);
      $('#mPresLijst').innerHTML = rijenHtml();
      koppelRijen();
    });
    $$('.pres-reden-chip').forEach(b => b.onclick = () => {
      const id = b.dataset.pid, type = b.dataset.reden;
      const huidig = redenen[id];
      if (huidig && huidig.type === type) delete redenen[id];
      else redenen[id] = {type, notitie: huidig?.notitie || ''};
      $('#mPresLijst').innerHTML = rijenHtml();
      koppelRijen();
    });
    $$('.pres-reden-notitie').forEach(inp => inp.oninput = () => {
      const id = inp.dataset.pid;
      if (redenen[id]) redenen[id].notitie = inp.value;
    });
  };
  koppelRijen();

  const werkMeldingBij = () => {
    const bestaandRecord = S.presentie.find(p => p.datum === datum);
    $('#mPresBestaatMelding').style.display = (bestaandRecord && !bestaande) ? '' : 'none';
  };

  const zetDatum = (nieuweDatum) => {
    datum = nieuweDatum;
    $('#mPresDatumTekst').textContent = datLeesbaar(datum);
    const bestaandRecord = S.presentie.find(p => p.datum === datum);
    afwezig = new Set(bestaandRecord ? (bestaandRecord.afwezig || []) : []);
    redenen = bestaandRecord ? JSON.parse(JSON.stringify(bestaandRecord.afwezigRedenen || {})) : {};
    $('#mPresLijst').innerHTML = rijenHtml();
    koppelRijen();
    werkMeldingBij();
  };

  if (kanDatumWijzigen){
    werkMeldingBij();
    const seg = $('#mPresDatumSeg'), input = $('#mPresDatumInput');
    seg.querySelectorAll('button').forEach(b => b.onclick = () => {
      seg.querySelectorAll('button').forEach(x=>x.classList.remove('actief'));
      b.classList.add('actief');
      if (b.dataset.d === 'vandaag'){ input.style.display = 'none'; zetDatum(vandaag); }
      else {
        input.style.display = '';
        input.value = datum;
        input.focus();
        if (input.showPicker){ try { input.showPicker(); } catch(e){} }
      }
    });
    input.onchange = () => { if (input.value) zetDatum(input.value); };
  }

  $('#mPresOk').onclick = async () => {
    const knop = $('#mPresOk'); knop.disabled = true; knop.textContent = 'Opslaan...';
    const data = {
      datum,
      afwezig: Array.from(afwezig),
      afwezigRedenen: redenen,
      aantalAanwezig: S.spelers.length - afwezig.size,
      aantalSpelers: S.spelers.length,
      door: S.user.displayName || S.user.email || '',
      gewijzigd: serverTimestamp(),
    };
    try {
      const zelfde = S.presentie.find(p => p.datum === datum);
      if (bestaande) await updateDoc(doc(db,'teams',S.teamId,'presentie',bestaande.id), data);
      else if (zelfde) await updateDoc(doc(db,'teams',S.teamId,'presentie',zelfde.id), data);
      else await addDoc(collection(db,'teams',S.teamId,'presentie'), {...data, gemaakt: serverTimestamp(), seizoen: S.huidigSeizoen});
      sluitModal();
      meld(afwezig.size ? `${afwezig.size} afwezig genoteerd` : 'Iedereen aanwezig genoteerd');
    } catch(e){
      knop.disabled = false; knop.textContent = 'Opslaan';
      meld('Opslaan mislukt: ' + (e.code || e.message));
    }
  };

  const weg = $('#mPresWeg');
  if (weg) weg.onclick = async () => {
    if (!confirm('Deze presentieregistratie verwijderen?')) return;
    try {
      await deleteDoc(doc(db,'teams',S.teamId,'presentie',bestaande.id));
      sluitModal(); meld('Presentie verwijderd');
    } catch(e){ meld('Verwijderen mislukt: ' + (e.code || e.message)); }
  };
}

/* ---------- Planning: eigen dag toevoegen ---------- */
export function modalEigenDag(){
  const vandaag = new Date().toISOString().slice(0,10);
  openModal(`
    <h2>Eigen dag toevoegen</h2>
    <p style="font-size:13.5px;color:var(--ink-2);margin-bottom:12px">Voeg een eigen datum toe aan de planning — bijvoorbeeld een toernooi, teamuitje of trainingskamp.</p>
    <div class="veldgroep"><label>Datum</label>
      <input class="invoer" id="mEdDatum" type="date" value="${vandaag}"></div>
    <div class="veldgroep"><label>Omschrijving</label>
      <input class="invoer" id="mEdLabel" placeholder="Bijv. Teamfoto, toernooi, vrij" autocomplete="off"></div>
    <div class="veldgroep"><label>Notitie (optioneel)</label>
      <input class="invoer" id="mEdOpm" placeholder="Extra info" autocomplete="off"></div>
    <button class="knop vol" id="mEdOk">Toevoegen</button>`);
  $('#mEdOk').onclick = async () => {
    const datum = $('#mEdDatum').value;
    const label = $('#mEdLabel').value.trim();
    if (!datum) return meld('Kies een datum');
    if (!label) return meld('Geef een omschrijving');
    try {
      await addDoc(collection(db,'teams',S.teamId,'planning'), {
        bron: 'eigen', datum, type: 'eigen', label,
        opmerking: $('#mEdOpm').value.trim(),
        gemaakt: serverTimestamp(),
      });
      // zorg dat de maand zichtbaar is na toevoegen
      if (S._planningDichteMaanden) S._planningDichteMaanden.delete(datum.slice(0,7));
      sluitModal(); meld('Dag toegevoegd');
    } catch(e){ meld('Toevoegen mislukt: ' + (e.code || e.message)); }
  };
}

/* ---------- Planning: KNVB-dag aanpassen/verbergen of eigen dag bewerken ---------- */
export function modalPlanDag(it){
  const isEigen = it.bron === 'eigen';
  const typeOpties = [['wd','Wedstrijddag'],['beker','Beker'],['inhaal','Inhaal'],['vrij','Vrij'],['eigen','Eigen dag']];
  openModal(`
    <h2>${datumNL(it.datum)}</h2>
    <p style="font-size:13px;color:var(--ink-2);margin-bottom:12px">${isEigen ? 'Eigen dag bewerken of verwijderen.' : 'KNVB-speeldag aanpassen of verbergen voor dit team. De originele kalender blijft bewaard.'}</p>
    <div class="veldgroep"><label>Type</label>
      <select class="invoer" id="mPdType">${typeOpties.map(([v,l]) => `<option value="${v}" ${it.type===v?'selected':''}>${l}</option>`).join('')}</select></div>
    <div class="veldgroep"><label>Omschrijving</label>
      <input class="invoer" id="mPdLabel" value="${esc(it.label||'')}" autocomplete="off"></div>
    <div class="veldgroep"><label>Notitie (optioneel)</label>
      <input class="invoer" id="mPdOpm" value="${esc(it.opmerking||'')}" autocomplete="off"></div>
    <button class="knop vol" id="mPdOk">Opslaan</button>
    <div class="rij" style="margin-top:8px">
      ${it.aangepast && !isEigen ? `<button class="knop licht" id="mPdReset" style="flex:1">Herstel KNVB</button>` : ''}
      <button class="knop gevaar" id="mPdWeg" style="flex:1">${isEigen ? 'Verwijderen' : 'Verbergen'}</button>
    </div>`);
  $('#mPdOk').onclick = async () => {
    const type = $('#mPdType').value;
    const label = $('#mPdLabel').value.trim() || (PLAN_TYPE[type]?.naam || 'Dag');
    const opmerking = $('#mPdOpm').value.trim();
    try {
      if (isEigen){
        await updateDoc(doc(db,'teams',S.teamId,'planning',it.docId), {type, label, opmerking});
      } else {
        await setDoc(doc(db,'teams',S.teamId,'planning','knvb_'+it.datum), {
          bron:'knvb', datum: it.datum, type, label, opmerking, verborgen:false,
        });
      }
      sluitModal(); meld('Opgeslagen');
    } catch(e){ meld('Opslaan mislukt: ' + (e.code || e.message)); }
  };
  const reset = $('#mPdReset');
  if (reset) reset.onclick = async () => {
    try {
      await deleteDoc(doc(db,'teams',S.teamId,'planning','knvb_'+it.datum));
      sluitModal(); meld('KNVB-dag hersteld');
    } catch(e){ meld('Mislukt: ' + (e.code || e.message)); }
  };
  $('#mPdWeg').onclick = async () => {
    if (isEigen){
      if (!confirm('Deze eigen dag verwijderen?')) return;
      try {
        await deleteDoc(doc(db,'teams',S.teamId,'planning',it.docId));
        sluitModal(); meld('Verwijderd');
      } catch(e){ meld('Mislukt: ' + (e.code || e.message)); }
    } else {
      if (!confirm('Deze KNVB-dag verbergen voor dit team?')) return;
      try {
        await setDoc(doc(db,'teams',S.teamId,'planning','knvb_'+it.datum), {
          bron:'knvb', datum: it.datum, verborgen:true,
        });
        sluitModal(); meld('Verborgen');
      } catch(e){ meld('Mislukt: ' + (e.code || e.message)); }
    }
  };
}
