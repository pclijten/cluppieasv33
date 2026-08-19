/* ==================== LEERLIJN / ASV-KOMPAS INFOSCHERMEN ====================
   Onderdeel van de teams.js-modulaire split (voorheen: sectie "LEERCURVE/
   KOMPAS-INFOSCHERMEN" in het monolithische teams.js).

   De roterende ASV-kompas-banner (getoond op de Training-tab) en de gedeelde
   infobladen die de achtergrond + tips tonen voor een leercurve-thema (§3.3)
   of een losse kompas-tip (§3.1/§3.4). De bewerkbare TEKST komt niet meer uit
   config.js maar uit content.js (Firestore-collectie 'content') — zie
   CONTENTBEHEER in het clubdashboard. Structurele data (thema/vanaf/domein)
   blijft in config.js staan; dat verandert niet via het contentbeheer-tabblad. */
import { S, $, esc, openModal, modAan } from './state.js?v=20260819b';
import { skillDomein, leercurveThema, isoWeek, kompasIndexVoorWeek,
         LEERCURVE, leercurveRelevant } from './config.js?v=20260819b';
import { contentVoorThema, kompasTips } from './content.js?v=20260819b';

/* ---------- Leerlijn-blok: ASV-kompas + leerlijn (Training-tab) ----------
   Eén rustig blok waarin de coach met de pijltjes door twee series bladert:
   eerst de wekelijkse ASV-kompas-tips (§3.1/§3.4), daarna de leercurve-thema's
   (§3.3) die bij de leeftijd van dit team horen. Het label + icoon bovenin
   bewegen mee, en bij een leerlijn-item toont de bron-tag de domein-badge.
   Beide series staan los per team uit te zetten: kompas via de 'kompas'-module,
   de leerlijn-thema's via de 'leerlijn'-module. Staat álles uit → geen blok.
   Het startpunt wisselt per keer dat de tab geopend wordt (kompasItems()), zodat
   een coach niet steeds hetzelfde item als eerste ziet — onbewust leren. */

/* De gecombineerde reeks items voor het huidige team. Eén bron van waarheid,
   zodat de HTML én de blader-handler (teams.js) exact dezelfde volgorde delen. */
export function kompasItems(){
  const uit = [];
  if (modAan('kompas')){
    for (const t of kompasTips()) uit.push({ soort:'kompas', titel:t.titel, tag:(t.tags||[])[0]||'' });
  }
  if (modAan('leerlijn')){
    const cat = S.team?.categorie || '';
    for (const th of LEERCURVE){
      if (leercurveRelevant(th, cat)){
        const inhoud = contentVoorThema(th.thema);
        uit.push({ soort:'leer', thema:th.thema, domein:th.domein,
                   tekst:(inhoud?.achtergrond || '').trim() });
      }
    }
  }
  return uit;
}

/* Willekeurig startpunt binnen de reeks, zodat elke tab-open een ander item
   toont. Wordt door teams.js in S._kompasIdx gezet bij het openen van de tab. */
export function kompasStartIndex(aantal){
  if (!aantal) return 0;
  return Math.floor(Math.random() * aantal);
}

/* Eerste zin uit een achtergrondtekst — kort genoeg voor het blok, de volledige
   tekst blijft beschikbaar via het info-blad (tik op de tekst). */
function eersteZin(tekst){
  const t = (tekst||'').trim();
  if (!t) return '';
  const m = t.match(/^[\s\S]*?[.!?](?=\s|$)/);
  return (m ? m[0] : t).trim();
}

export function htmlKompas(){
  const items = kompasItems();
  if (!items.length) return '';
  // Eerste render van de tab: nog geen index? Kies eenmalig een willekeurig
  // startpunt en bewaar het, zodat bladeren daarna vanaf dat punt verdergaat.
  if (S._kompasIdx == null) S._kompasIdx = kompasStartIndex(items.length);
  const idx = ((S._kompasIdx ?? 0) % items.length + items.length) % items.length;
  const it = items[idx];

  // waar gaat kompas over in leerlijn? (voor het scheidingsstreepje in de dots)
  const grens = items.findIndex(x => x.soort === 'leer');

  let label, bron, tekst;
  if (it.soort === 'kompas'){
    label = `🧭 ASV-kompas · week ${isoWeek()}`;
    bron  = esc(it.tag || '');
    tekst = `${esc(it.titel)} <span class="ll-info-ico">ℹ️</span>`;
  } else {
    const d = skillDomein(it.domein);
    label = `📈 Leerlijn · ${esc(S.team?.categorie || '')}`;
    bron  = `<span class="ll-dombadge" style="background:${d?.kleur||'var(--accent)'}">${esc(it.domein)}</span>${esc(d?.naam || '')}`;
    const zin = eersteZin(it.tekst);
    tekst = `<span class="ll-titel">${esc(it.thema)}.</span> ${esc(zin)} <span class="ll-info-ico">ℹ️</span>`;
  }

  const dots = items.map((_,i) => {
    const sep = (grens > 0 && i === grens) ? '<span class="ll-sep"></span>' : '';
    return `${sep}<span class="${i===idx?'actief':''}"></span>`;
  }).join('');

  return `
    <div class="kompas leerblok ${it.soort==='leer'?'is-leer':''}">
      <div class="kompas-top">
        <span class="kompas-label">${label}</span>
        <span class="kompas-bron">${bron}</span>
      </div>
      <div class="kompas-tekst" data-kompas-info style="cursor:pointer">${tekst}</div>
      <div class="kompas-dots">${dots}</div>
      <div class="kompas-nav">
        <button data-kompas="vorige" title="Vorige">‹</button>
        <button data-kompas="volgende" title="Volgende">›</button>
      </div>
    </div>`;
}

/* ==================== LEERCURVE/KOMPAS-INFOSCHERMEN ====================
   Gedeelde onderbladen die de achtergrond (jeugdbeleidsplan) en concrete
   verbetertips tonen voor een leercurve-thema (§3.3) of een losse
   ASV-kompas-tip (§3.1/§3.4). Overal waar de app nu al een thema of tip
   toont, opent dit dezelfde soort blad — zie de aanroepen bij het
   trainingsthema-advies, de leerpunt-kiezer, de Leerlijn-tab en het kompas. */
function htmlThemaInfoBlad(t, metTerug){
  const d = skillDomein(t.domein);
  return `
    ${metTerug ? `<button class="knop licht vol" id="mThemaTerug" style="margin-bottom:14px">← Terug naar leerpunt</button>` : ''}
    <h2>${esc(t.thema)}</h2>
    <p style="font-size:calc(11.5px * var(--fs));color:var(--ink-2);margin-bottom:14px">Leercurve-thema · vanaf <b>O${t.vanaf}</b> · domein <b>${esc(d?.naam || t.domein)}</b></p>
    <div class="sectie-kop" style="margin-top:0">Achtergrond</div>
    <p style="font-size:calc(13.5px * var(--fs));line-height:1.6">${esc(t.achtergrond) || '<i>Nog geen achtergrondtekst — voeg toe via het contentbeheer-tabblad.</i>'}</p>
    <div class="sectie-kop">Tips om dit te verbeteren</div>
    ${(t.tips||[]).map((tip,i) => `
      <div style="display:flex;gap:10px;padding:9px 0;${i===0?'border-top:none':'border-top:1px solid var(--line-d)'}">
        <div style="width:20px;height:20px;border-radius:50%;background:var(--surface-2);color:var(--ink-2);font-size:calc(11px * var(--fs));font-weight:700;display:flex;align-items:center;justify-content:center;flex-shrink:0;margin-top:1px">${i+1}</div>
        <div style="font-size:calc(13px * var(--fs));line-height:1.5">${esc(tip)}</div>
      </div>`).join('')}
    <div class="badge" style="margin-top:14px">Jeugdbeleidsplan §3.1 · §3.2 · §3.3</div>`;
}
function htmlKompasInfoBlad(t){
  const bron = (t.tags||[])[0] || '';
  return `
    <h2>Achtergrond</h2>
    <p style="font-size:calc(11.5px * var(--fs));color:var(--ink-2);margin-bottom:6px">ASV-kompas · ${esc(bron)}</p>
    <p style="font-size:calc(13.5px * var(--fs));line-height:1.6;font-style:italic;margin-bottom:14px">"${esc(t.titel)}"</p>
    <div class="sectie-kop" style="margin-top:0">Waarom dit werkt</div>
    <p style="font-size:calc(13.5px * var(--fs));line-height:1.6">${esc(t.achtergrond) || '<i>Nog geen achtergrondtekst.</i>'}</p>
    <div class="sectie-kop">Concreet</div>
    ${(t.tips||[]).map((tip,i) => `
      <div style="display:flex;gap:10px;padding:9px 0;${i===0?'border-top:none':'border-top:1px solid var(--line-d)'}">
        <div style="width:20px;height:20px;border-radius:50%;background:var(--surface-2);color:var(--ink-2);font-size:calc(11px * var(--fs));font-weight:700;display:flex;align-items:center;justify-content:center;flex-shrink:0;margin-top:1px">${i+1}</div>
        <div style="font-size:calc(13px * var(--fs));line-height:1.5">${esc(tip)}</div>
      </div>`).join('')}
    <div class="badge" style="margin-top:14px">Jeugdbeleidsplan ${esc(bron)}</div>`;
}
/* terugFn optioneel: als de info-knop vanuit een modal met invoer komt (bijv.
   leerpunt toevoegen), geven we een weg terug zonder de invoer te verliezen. */
export function toonThemaInfo(themaNaam, terugFn = null){
  const struct = leercurveThema(themaNaam);
  if (!struct) return;
  const inhoud = contentVoorThema(themaNaam);
  openModal(htmlThemaInfoBlad({ ...struct, achtergrond: inhoud?.achtergrond || '', tips: inhoud?.tips || [] }, !!terugFn));
  if (terugFn){ const b = $('#mThemaTerug'); if (b) b.onclick = () => terugFn(); }
}
export function toonKompasInfo(idx){
  const tips = kompasTips();
  const t = tips[idx];
  if (!t) return;
  openModal(htmlKompasInfoBlad(t));
}
