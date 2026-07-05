/* ==================== LEERLIJN / ASV-KOMPAS INFOSCHERMEN ====================
   Onderdeel van de teams.js-modulaire split (voorheen: sectie "LEERCURVE/
   KOMPAS-INFOSCHERMEN" in het monolithische teams.js).

   De roterende ASV-kompas-banner (getoond op de Training-tab) en de gedeelde
   infobladen die de achtergrond + tips tonen voor een leercurve-thema (§3.3)
   of een losse kompas-tip (§3.1/§3.4). De bewerkbare TEKST komt niet meer uit
   config.js maar uit content.js (Firestore-collectie 'content') — zie
   CONTENTBEHEER in het clubdashboard. Structurele data (thema/vanaf/domein)
   blijft in config.js staan; dat verandert niet via het contentbeheer-tabblad. */
import { S, $, esc, openModal } from './state.js';
import { skillDomein, leercurveThema, isoWeek, kompasIndexVoorWeek } from './config.js';
import { contentVoorThema, kompasTips } from './content.js';

/* ---------- ASV-kompas-banner (Training-tab) ---------- */
export function htmlKompas(){
  const tips = kompasTips();
  if (!tips.length){
    // Nog geen content geladen/gepubliceerd (bv. gloednieuw testproject vóór
    // het indrukken van "Seed content naar Firestore" in het admin-tabblad).
    return `<div class="kompas"><div class="kompas-tekst">🧭 ASV-kompas — nog geen tips beschikbaar.</div></div>`;
  }
  const idx = S._kompasIdx ?? kompasIndexVoorWeek(tips.length);
  const t = tips[idx] || tips[0];
  return `
    <div class="kompas">
      <div class="kompas-top">
        <span class="kompas-label">🧭 ASV-kompas · week ${isoWeek()}</span>
        <span class="kompas-bron">${esc((t.tags||[])[0] || '')}</span>
      </div>
      <div class="kompas-tekst" data-kompas-info style="cursor:pointer">${esc(t.titel)} <span style="opacity:.55;font-size:11px">ℹ️</span></div>
      <div class="kompas-dots">${tips.map((_,i) => `<span class="${i===idx?'actief':''}"></span>`).join('')}</div>
      <div class="kompas-nav">
        <button data-kompas="vorige" title="Vorige tip">‹</button>
        <button data-kompas="volgende" title="Volgende tip">›</button>
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
    <p style="font-size:11.5px;color:var(--ink-2);margin-bottom:14px">Leercurve-thema · vanaf <b>O${t.vanaf}</b> · domein <b>${esc(d?.naam || t.domein)}</b></p>
    <div class="sectie-kop" style="margin-top:0">Achtergrond</div>
    <p style="font-size:13.5px;line-height:1.6">${esc(t.achtergrond) || '<i>Nog geen achtergrondtekst — voeg toe via het contentbeheer-tabblad.</i>'}</p>
    <div class="sectie-kop">Tips om dit te verbeteren</div>
    ${(t.tips||[]).map((tip,i) => `
      <div style="display:flex;gap:10px;padding:9px 0;${i===0?'border-top:none':'border-top:1px solid var(--line-d)'}">
        <div style="width:20px;height:20px;border-radius:50%;background:var(--surface-2);color:var(--ink-2);font-size:11px;font-weight:700;display:flex;align-items:center;justify-content:center;flex-shrink:0;margin-top:1px">${i+1}</div>
        <div style="font-size:13px;line-height:1.5">${esc(tip)}</div>
      </div>`).join('')}
    <div class="badge" style="margin-top:14px">Jeugdbeleidsplan §3.1 · §3.2 · §3.3</div>`;
}
function htmlKompasInfoBlad(t){
  const bron = (t.tags||[])[0] || '';
  return `
    <h2>Achtergrond</h2>
    <p style="font-size:11.5px;color:var(--ink-2);margin-bottom:6px">ASV-kompas · ${esc(bron)}</p>
    <p style="font-size:13.5px;line-height:1.6;font-style:italic;margin-bottom:14px">"${esc(t.titel)}"</p>
    <div class="sectie-kop" style="margin-top:0">Waarom dit werkt</div>
    <p style="font-size:13.5px;line-height:1.6">${esc(t.achtergrond) || '<i>Nog geen achtergrondtekst.</i>'}</p>
    <div class="sectie-kop">Concreet</div>
    ${(t.tips||[]).map((tip,i) => `
      <div style="display:flex;gap:10px;padding:9px 0;${i===0?'border-top:none':'border-top:1px solid var(--line-d)'}">
        <div style="width:20px;height:20px;border-radius:50%;background:var(--surface-2);color:var(--ink-2);font-size:11px;font-weight:700;display:flex;align-items:center;justify-content:center;flex-shrink:0;margin-top:1px">${i+1}</div>
        <div style="font-size:13px;line-height:1.5">${esc(tip)}</div>
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
