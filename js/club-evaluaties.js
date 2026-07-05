/* ==================== CLUBBREDE EVALUATIES (admin-only) ====================
   Aggregeert teamevaluaties en spelersbeoordelingen van ALLE teams in de club,
   voor het admin-dashboard (club.js, tab "dashboard" → segment "Evaluaties").
   Puur leeswerk — geen schrijf-acties hier — plus een client-side Excel-export.
   Losse module (i.p.v. in club.js) omdat de Excel-export een eigen lui geladen
   library (ExcelJS via CDN) nodig heeft die de rest van de app nooit gebruikt. */
import { db, collection, getDocs, query, where } from './firebase.js';
import { S, esc, meld, openModal } from './state.js';
import { TEAM_CATEGORIEEN, SKILLS } from './config.js';

/* korte kolomkoppen voor de heatmap — TEAM_CATEGORIEEN.naam is te lang voor
   een tabelkop; alleen hier lokaal gebruikt, config.js blijft de brontekst. */
const KORT_LABEL = {
  inzet:'Inzet', samenwerking:'Samen-werking', taken:'Taken', opbouw:'Opbouw',
  omschakeling:'Omscha-keling', druk:'Druk', plezier:'Plezier', coachbaar:'Coach-baar',
};

/* dark-theme kleurschaal (zelfde 5 tinten als --n1..--n5 in styles.css) */
const KLEUR_SCHAAL = ['#F0565B','#F59C4A','#F2C94C','#7DCB6A','#35C47A'];
function kleurVoorGemiddelde(v){
  if (v == null) return null;
  if (v >= 4.5) return KLEUR_SCHAAL[4];
  if (v >= 3.5) return KLEUR_SCHAAL[3];
  if (v >= 2.5) return KLEUR_SCHAAL[2];
  if (v >= 1.5) return KLEUR_SCHAAL[1];
  return KLEUR_SCHAAL[0];
}
function gemiddelde(vals){ return vals.length ? vals.reduce((a,b)=>a+b,0)/vals.length : null; }

/* ==================== DATA OPHALEN ====================
   Eén keer per team: teamevaluaties + volledige spelersbeoordelingen + spelersnamen.
   Wordt alleen aangeroepen als de Evaluaties-submodus van het dashboard ook echt
   open staat (zie koppeling in club.js), net als de andere lazy-loaded club-reads. */
export async function clubEvaluatiesOphalen(teams){
  // Teamevaluaties (na de wedstrijd) horen bij een seizoen en stapelen zich
  // seizoen na seizoen op — filter op het huidige seizoen zodat dit niet
  // steeds meer leeswerk wordt. Spelersbeoordelingen laten we ongefilterd:
  // daarvan pakken we hieronder toch alleen de láátste per speler, ongeacht
  // in welk seizoen die geschreven is (dat is nu eenmaal het actuele profiel).
  const seizoenFilter = S.huidigSeizoen ? [where('seizoen','==',S.huidigSeizoen)] : [];
  return Promise.all(teams.map(async t => {
    const [evalSnap, beoordSnap, spelersSnap] = await Promise.all([
      getDocs(query(collection(db,'teams',t.id,'teamevaluaties'), ...seizoenFilter)),
      getDocs(collection(db,'teams',t.id,'beoordelingen')),
      getDocs(collection(db,'teams',t.id,'spelers')),
    ]);
    const evals = evalSnap.docs.map(d => ({id:d.id, ...d.data()}))
      .sort((a,b) => (a.gemaaktMs||0) - (b.gemaaktMs||0)); // oud → nieuw

    const spelersNaam = {};
    spelersSnap.docs.forEach(d => { spelersNaam[d.id] = d.data().naam || '?'; });

    const volledig = beoordSnap.docs.map(d => ({id:d.id, ...d.data()})).filter(b => b.soort === 'volledig');
    const laatstePerSpeler = {};
    for (const b of volledig){
      const huidig = laatstePerSpeler[b.spelerId];
      if (!huidig || (b.gemaaktMs||0) > (huidig.gemaaktMs||0)) laatstePerSpeler[b.spelerId] = b;
    }
    const spelersDomeinen = Object.values(laatstePerSpeler).map(b => ({
      spelerId: b.spelerId, naam: spelersNaam[b.spelerId] || '?', scores: b.scores || {}, datum: b.datum,
    })).sort((a,b) => a.naam.localeCompare(b.naam));

    const domeinGem = {};
    for (const s of SKILLS) domeinGem[s.id] = gemiddelde(spelersDomeinen.map(sp => sp.scores[s.id]).filter(Boolean));

    return { team:t, evals, spelersDomeinen, domeinGem };
  }));
}

/* per-categorie gemiddelde over de laatste 5 evaluaties van één team */
function teamCatGemiddelden(evals){
  const laatste5 = evals.slice(-5);
  const vorige5 = evals.slice(-10,-5);
  const nu = {}, was = {};
  for (const c of TEAM_CATEGORIEEN){
    nu[c.id] = gemiddelde(laatste5.map(e => e.scores?.[c.id]).filter(Boolean));
    was[c.id] = gemiddelde(vorige5.map(e => e.scores?.[c.id]).filter(Boolean));
  }
  return {nu, was, aantal:laatste5.length};
}
function evalLaagsteCategorie(ev){
  let laagste = null;
  for (const c of TEAM_CATEGORIEEN){
    const s = ev.scores?.[c.id]; if (!s) continue;
    if (!laagste || s < laagste.score) laagste = {id:c.id, score:s};
  }
  return laagste;
}

/* ==================== RENDER ==================== */
export function htmlClubEvaluaties(teamsData){
  const modus = S.clubEvalModus || 'teams';
  return `
    <div class="rij" style="margin-bottom:14px;align-items:stretch">
      <div class="segment" style="flex:1;margin-bottom:0">
        <button data-evalmodus="teams" class="${modus==='teams'?'actief':''}">📈 Teamevaluaties</button>
        <button data-evalmodus="spelers" class="${modus==='spelers'?'actief':''}">👕 Spelersbeoordelingen</button>
      </div>
      <button class="knop licht" id="clubEvalExport">
        <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v12"/><path d="m7 10 5 5 5-5"/><path d="M5 21h14"/></svg>
        Excel
      </button>
    </div>
    ${modus==='teams' ? htmlClubEvalTeams(teamsData) : htmlClubEvalSpelers(teamsData)}`;
}

function htmlClubEvalTeams(teamsData){
  const metData = teamsData.filter(d => d.evals.length);
  if (!metData.length){
    return `<div class="kaart leeg">Nog geen teamevaluaties in de club.<br>Zodra coaches na wedstrijden "Team evalueren" invullen, verschijnt hier de clubbrede scorekaart.</div>`;
  }

  const rijen = metData.map(d => {
    const {nu, was, aantal} = teamCatGemiddelden(d.evals);
    const alleWaarden = Object.values(nu).filter(v => v != null);
    const gemTotaal = gemiddelde(alleWaarden);
    const vorigeWaarden = Object.values(was).filter(v => v != null);
    const gemVorige = gemiddelde(vorigeWaarden);
    const trend = (gemTotaal==null || gemVorige==null) ? {sym:'→', cls:''}
      : gemTotaal - gemVorige > 0.15 ? {sym:'↗', cls:'op'}
      : gemTotaal - gemVorige < -0.15 ? {sym:'↘', cls:'neer'} : {sym:'→', cls:''};
    return {team:d.team, nu, aantal, trend};
  });

  const cellen = (r) => TEAM_CATEGORIEEN.map(c => {
    const v = r.nu[c.id];
    const kleur = kleurVoorGemiddelde(v);
    return `<td>${v!=null
      ? `<div class="heat-cel" style="background:${kleur}" data-heatcel data-team="${esc(r.team.naam)}" data-catnaam="${esc(c.naam)}" data-v="${v}" data-n="${r.aantal}">${v.toFixed(1).replace('.',',')}</div>`
      : `<div class="heat-cel leeg">—</div>`}</td>`;
  }).join('');

  const heatTabel = `
    <div class="heat-wrap">
      <table class="heat-tabel">
        <tr><th class="teamkop">Team</th>${TEAM_CATEGORIEEN.map(c => `<th>${esc(KORT_LABEL[c.id]||c.naam)}</th>`).join('')}<th>Trend</th></tr>
        ${rijen.map(r => `
          <tr>
            <td class="teamnaam">${esc(r.team.naam)}<span class="n">${r.aantal} wedstr.</span></td>
            ${cellen(r)}
            <td class="heat-trend ${r.trend.cls}">${r.trend.sym}</td>
          </tr>`).join('')}
      </table>
    </div>
    <div class="heat-legenda">
      ${[1,2,3,4,5].map(n => `<span><span class="stip" style="background:${KLEUR_SCHAAL[n-1]}"></span>${n}</span>`).join('')}
      <span style="margin-left:auto">Tik een vakje voor details →</span>
    </div>`;

  /* clubbrede signalen: welke categorie is het vaakst de laagste van een team? */
  const tellingen = {}, teamsPerCat = {};
  for (const d of metData){
    const laatste4 = d.evals.slice(-4);
    const perTeamTelling = {};
    for (const ev of laatste4){
      const l = evalLaagsteCategorie(ev); if (!l) continue;
      perTeamTelling[l.id] = (perTeamTelling[l.id]||0) + 1;
    }
    // per team telt de vaakst-laagste categorie mee als "signaal" voor dat team
    const top = Object.entries(perTeamTelling).sort((a,b)=>b[1]-a[1])[0];
    if (top && top[1] >= 2){
      tellingen[top[0]] = (tellingen[top[0]]||0) + 1;
      (teamsPerCat[top[0]] ||= []).push(d.team.naam);
    }
  }
  const signalen = Object.entries(tellingen).filter(([,n]) => n >= 2).sort((a,b)=>b[1]-a[1])
    .map(([id,n]) => ({cat: TEAM_CATEGORIEEN.find(c=>c.id===id), n, teams: teamsPerCat[id]}));

  return `
    <div class="kaart">
      <div class="sectie-kop" style="margin-top:0">🔥 Scorekaart per team · laatste 5 wedstrijden</div>
      ${heatTabel}
    </div>
    <div class="kaart">
      <div class="sectie-kop" style="margin-top:0">⚠️ Clubbrede aandachtspunten</div>
      ${signalen.length ? signalen.map(s => `
        <div class="sig-rij">
          <div class="sig-stip" style="background:var(--warn)"></div>
          <div style="flex:1">
            <div class="sig-titel">${esc(s.cat.naam)}</div>
            <div class="sig-sub">Vaakst de zwakste categorie bij <b>${s.n} van de ${metData.length}</b> teams.</div>
            <div class="sig-teams">${s.teams.map(t=>`<span>${esc(t)}</span>`).join('')}</div>
          </div>
        </div>`).join('') : `<p style="font-size:12.5px;color:var(--ink-2)">Geen duidelijk clubbreed patroon deze periode.</p>`}
    </div>`;
}

function htmlClubEvalSpelers(teamsData){
  const metData = teamsData.filter(d => d.spelersDomeinen.length);
  if (!metData.length){
    return `<div class="kaart leeg">Nog geen volledige spelersbeoordelingen in de club.<br>Zodra coaches de "Volledige beoordeling" invullen bij spelers, verschijnt hier het overzicht per ontwikkeldomein.</div>`;
  }
  return `
    <div class="kaart">
      <div class="sectie-kop" style="margin-top:0">Gemiddeld per ontwikkeldomein · per team</div>
      ${metData.map((d, idx) => `
        <div class="domein-rij">
          <div class="domein-rij-kop" data-domeintoggle="${idx}">
            <div><span class="domein-rij-naam">${esc(d.team.naam)}</span><span class="domein-rij-n">${d.spelersDomeinen.length} spelers beoordeeld</span></div>
            <span class="domein-rij-pijl" id="domeinpijl-${idx}">›</span>
          </div>
          <div class="domein-balkjes">
            ${SKILLS.map(s => {
              const v = d.domeinGem[s.id];
              const pct = v!=null ? Math.round((v/5)*100) : 0;
              const kleur = kleurVoorGemiddelde(v);
              return `<div class="domein-balk">
                <div class="label">${s.id}</div>
                <div class="buis"><div class="vulling" style="height:${pct}%;background:${kleur||'var(--surface-2)'}"></div></div>
                <div class="waarde">${v!=null?v.toFixed(1).replace('.',','):'—'}</div>
              </div>`;
            }).join('')}
          </div>
          <div class="domein-spelerlijst" id="domeinlijst-${idx}">
            ${d.spelersDomeinen.map(sp => `
              <div class="domein-speler-rij">
                <span class="naam">${esc(sp.naam)}</span>
                <div class="mini-dom">${SKILLS.map(s => `<span style="background:${kleurVoorGemiddelde(sp.scores[s.id])||'var(--surface-2)'}">${sp.scores[s.id] ?? '—'}</span>`).join('')}</div>
              </div>`).join('')}
          </div>
        </div>`).join('')}
    </div>`;
}

/* ==================== KOPPELING (klik-handlers) ====================
   herRender: callback van club.js (renderClub) — hier niet zelf geïmporteerd
   om een circulaire import tussen club.js en deze module te vermijden. */
export function koppelClubEvaluaties(v, teamsData, herRender){
  v.querySelectorAll('[data-evalmodus]').forEach(b => b.onclick = () => {
    S.clubEvalModus = b.dataset.evalmodus; herRender();
  });
  v.querySelectorAll('[data-heatcel]').forEach(el => el.onclick = () => {
    openModal(`
      <h2>${esc(el.dataset.catnaam)}</h2>
      <p style="font-size:13px;color:var(--ink-2);margin-bottom:14px">${esc(el.dataset.team)} · gemiddelde laatste ${esc(el.dataset.n)} wedstrijden</p>
      <div style="font-family:'Barlow Condensed';font-weight:700;font-size:38px;color:${kleurVoorGemiddelde(parseFloat(el.dataset.v))}">${parseFloat(el.dataset.v).toFixed(1).replace('.',',')}<span style="font-size:14px;color:var(--ink-2);font-weight:500"> / 5</span></div>`);
  });
  v.querySelectorAll('[data-domeintoggle]').forEach(kop => kop.onclick = () => {
    const i = kop.dataset.domeintoggle;
    v.querySelector('#domeinlijst-'+i).classList.toggle('open');
    v.querySelector('#domeinpijl-'+i).classList.toggle('open');
  });
  const exportBtn = v.querySelector('#clubEvalExport');
  if (exportBtn) exportBtn.onclick = () => exportClubEvaluaties(teamsData, exportBtn);
}

/* ==================== EXCEL-EXPORT ====================
   ExcelJS wordt pas geladen op het moment dat de admin echt exporteert —
   de rest van de app heeft deze (relatief zware) library nooit nodig. */
let _exceljsLoad = null;
function laadExcelJS(){
  if (window.ExcelJS) return Promise.resolve();
  if (_exceljsLoad) return _exceljsLoad;
  _exceljsLoad = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'https://cdn.jsdelivr.net/npm/exceljs@4.4.0/dist/exceljs.min.js';
    script.onload = resolve;
    script.onerror = () => { _exceljsLoad = null; reject(new Error('Kon Excel-library niet laden — controleer je internetverbinding')); };
    document.head.appendChild(script);
  });
  return _exceljsLoad;
}
function hexNaarArgb(hex){ return 'FF' + hex.replace('#','').toUpperCase(); }

export async function exportClubEvaluaties(teamsData, knop){
  const label = knop ? knop.innerHTML : null;
  if (knop){ knop.disabled = true; knop.innerHTML = 'Bezig…'; }
  meld('Excel-export wordt klaargezet…');
  try {
    await laadExcelJS();

    const wb = new window.ExcelJS.Workbook();
    wb.creator = 'Cluppie'; wb.created = new Date();

    /* --- Tabblad 1: teamevaluaties, laatste 5 wedstrijden per team --- */
    const ws1 = wb.addWorksheet('Teamevaluaties');
    ws1.columns = [
      {header:'Team', key:'team', width:16},
      ...TEAM_CATEGORIEEN.map(c => ({header:c.naam, key:c.id, width:20})),
      {header:'Gemiddelde', key:'gem', width:12},
      {header:'Trend', key:'trend', width:8},
      {header:'Wedstrijden', key:'n', width:12},
    ];
    ws1.getRow(1).font = {bold:true};
    for (const d of teamsData){
      if (!d.evals.length) continue;
      const {nu, was, aantal} = teamCatGemiddelden(d.evals);
      const gemTotaal = gemiddelde(Object.values(nu).filter(v=>v!=null));
      const gemVorige = gemiddelde(Object.values(was).filter(v=>v!=null));
      const trend = (gemTotaal==null||gemVorige==null) ? '→' : gemTotaal-gemVorige>0.15?'↗':gemTotaal-gemVorige<-0.15?'↘':'→';
      const rij = {team:d.team.naam, gem: gemTotaal!=null?Number(gemTotaal.toFixed(2)):null, trend, n:aantal};
      TEAM_CATEGORIEEN.forEach(c => { rij[c.id] = nu[c.id]!=null ? Number(nu[c.id].toFixed(2)) : null; });
      const row = ws1.addRow(rij);
      TEAM_CATEGORIEEN.forEach(c => {
        const kleur = kleurVoorGemiddelde(nu[c.id]);
        if (kleur) row.getCell(c.id).fill = {type:'pattern', pattern:'solid', fgColor:{argb:hexNaarArgb(kleur)}};
      });
      const gemKleur = kleurVoorGemiddelde(gemTotaal);
      if (gemKleur) row.getCell('gem').fill = {type:'pattern', pattern:'solid', fgColor:{argb:hexNaarArgb(gemKleur)}};
    }

    /* --- Tabblad 2: spelersbeoordelingen (laatste volledige meting per speler) --- */
    const ws2 = wb.addWorksheet('Spelersbeoordelingen');
    ws2.columns = [
      {header:'Team', key:'team', width:14},
      {header:'Speler', key:'speler', width:22},
      ...SKILLS.map(s => ({header:s.naam, key:s.id, width:16})),
      {header:'Laatst gemeten', key:'datum', width:16},
    ];
    ws2.getRow(1).font = {bold:true};
    for (const d of teamsData){
      for (const sp of d.spelersDomeinen){
        const rij = {team:d.team.naam, speler:sp.naam, datum: sp.datum || ''};
        SKILLS.forEach(s => { rij[s.id] = sp.scores[s.id] ?? null; });
        const row = ws2.addRow(rij);
        SKILLS.forEach(s => {
          const kleur = kleurVoorGemiddelde(sp.scores[s.id]);
          if (kleur) row.getCell(s.id).fill = {type:'pattern', pattern:'solid', fgColor:{argb:hexNaarArgb(kleur)}};
        });
      }
    }

    /* --- Tabblad 3: platte ruwe data, één rij per wedstrijd × categorie --- */
    const ws3 = wb.addWorksheet('Ruwe data wedstrijden');
    ws3.columns = [
      {header:'Team', key:'team', width:14},
      {header:'Datum', key:'datum', width:12},
      {header:'Tegenstander', key:'tegenstander', width:20},
      {header:'Categorie', key:'categorie', width:32},
      {header:'Score', key:'score', width:10},
    ];
    ws3.getRow(1).font = {bold:true};
    for (const d of teamsData){
      for (const ev of d.evals){
        for (const c of TEAM_CATEGORIEEN){
          const score = ev.scores?.[c.id];
          if (score == null) continue;
          ws3.addRow({team:d.team.naam, datum:ev.datum, tegenstander:ev.tegenstander||'', categorie:c.naam, score});
        }
      }
    }

    const buffer = await wb.xlsx.writeBuffer();
    const blob = new Blob([buffer], {type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'});
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const vandaag = new Date().toISOString().slice(0,10);
    a.href = url; a.download = `clubevaluaties-${vandaag}.xlsx`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
    meld('Excel-export gedownload');
  } catch(e){
    meld(e.message || 'Export mislukt');
  } finally {
    if (knop){ knop.disabled = false; if (label != null) knop.innerHTML = label; }
  }
}
