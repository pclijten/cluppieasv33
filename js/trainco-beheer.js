/* ==================== TRAININGSCOÖRDINATOR — BEHEER ====================
   Kaart voor de clubbeheerder (tab Coaches): de coördinator uitnodigen,
   aanvragen accepteren, toegang intrekken en meekijken zoals hij het ziet.

   Uitnodigen = de bestaande clubuitnodiging (?club=CODE). Wie die opent komt in
   `clubs/{id}.ledenInfo`; hier maakt de beheerder iemand daarna expliciet
   trainingscoördinator. Rechtenbron: `trainingscoordinatoren.<uid> = true`.
   Importeert niets uit club.js (geen kringimport). */
import { db, doc, updateDoc, deleteField } from './firebase.js?v=20261106m';
import { S, esc, meld } from './state.js?v=20261106m';
import { ico } from './icons.js?v=20261106m';

const naamKort = n => String(n || 'Naamloos').split('@')[0];
const twee = n => naamKort(n).split(/\s+/).map(w => w[0]).slice(0, 2).join('').toUpperCase();

function coordinatoren(){
  const c = S.club?.trainingscoordinatoren || {};
  return Object.keys(c).filter(u => c[u] === true)
    .map(uid => ({ uid, naam: naamKort(S.club.trainingscoordinatorenInfo?.[uid]?.naam || S.club.ledenInfo?.[uid]?.naam) }));
}
/* Aanvragen: leden van de club die nog geen beheerder of coördinator zijn en
   in geen enkel team zitten (anders zijn het gewone coaches). */
/* Aanmeldingen: wie zich via de coördinator-link heeft aangemeld
   (ledenInfo.<uid>.traincoAanvraag), ook als hij al trainer is. Daarnaast,
   zoals voorheen, clubleden zonder team en zonder rol. */
function wachtenden(teams){
  const teamsVan = new Map();
  for (const t of teams || []) for (const u of Object.keys(t.leden || {})) if (t.leden[u] === true){
    if (!teamsVan.has(u)) teamsVan.set(u, []); teamsVan.get(u).push(t.naam);
  }
  const bezet = new Set([...Object.keys(S.club?.admins || {}), ...coordinatoren().map(c => c.uid)]);
  return Object.entries(S.club?.ledenInfo || {})
    .filter(([uid, i]) => S.club.leden?.[uid] === true && !bezet.has(uid) && (i?.traincoAanvraag === true || !teamsVan.has(uid)))
    .map(([uid, i]) => ({ uid, naam: naamKort(i?.naam), email: i?.email || '', aanvraag: i?.traincoAanvraag === true, teams: teamsVan.get(uid) || [] }))
    .sort((a, b) => (b.aanvraag - a.aanvraag) || a.naam.localeCompare(b.naam, 'nl'));
}

export function htmlTraincoKaart(teams){
  if (!S.club?.admins?.[S.user?.uid]) return '';
  const co = coordinatoren(), wacht = wachtenden(teams);
  const link = location.origin + location.pathname + '?club=' + (S.club.code || '') + '&rol=trainco';
  return `
    <div class="cb-kaart" id="traincoKaart">
      <div class="cb-kaart-kop">${ico('team-add', 18)}<b>Trainingscoördinator</b><span class="cb-telling">${co.length}</span></div>
      <p class="cb-uitleg" style="margin:0 0 var(--space-xs)">Een coördinator ziet alle teams waarvoor trainingen klaarstaan: wie wanneer traint, het aantal spelers, de AI-training, de PDF en de diagrammen. Geen spelersnamen, geen video's.</p>
      ${co.map(c => `<div class="cb-persoon"><div class="cb-av">${esc(twee(c.naam))}</div><div class="cb-persoon-n">${esc(c.naam)} <span class="cb-rol coord">Coördinator</span></div>
        <button class="knop licht klein" data-tc-weg="${esc(c.uid)}">Toegang intrekken</button></div>`).join('')}
      ${wacht.length ? `<div class="sectie-kop" style="margin:var(--space-sm) 0 var(--space-xs)">Wacht op acceptatie</div>
        ${wacht.map(w => `<div class="cb-persoon"><div class="cb-av">${esc(twee(w.naam))}</div><div class="cb-persoon-n">${esc(w.naam)}${w.email ? `<small class="cb-inline">${esc(w.email)}</small>` : ''}
          <div class="cb-uitleg" style="margin:var(--space-3xs) 0 0">${w.aanvraag ? 'Heeft zich aangemeld als trainingscoördinator' : 'Clublid zonder team'}${w.teams.length ? '<span class="sep" aria-hidden="true"></span>ook trainer van ' + esc(w.teams.join(', ')) : ''}</div></div>
          <button class="knop klein" data-tc-maak="${esc(w.uid)}">Maak coördinator</button>
          <button class="knop licht klein cb-verwijder" data-tc-afwijs="${esc(w.uid)}" style="margin-left:var(--space-xs)">Verwijderen</button></div>`).join('')}` : ''}
      <div class="sectie-kop" style="margin:var(--space-sm) 0 var(--space-xs)">Uitnodigen</div>
      <p class="cb-uitleg" style="margin:0 0 var(--space-xs)">Stuur deze link. Na inloggen verschijnt de persoon hierboven onder "Wacht op acceptatie", ook als hij al trainer is. Hij krijgt pas toegang als jij hem accepteert.</p>
      <div class="uitnodig-link" id="traincoLink">${esc(link)}</div>
      <div class="cb-acties" style="margin:var(--space-sm) 0 0">
        <button class="knop licht klein" id="traincoKopieer">Link kopiëren</button>
        <a class="knop licht klein" id="traincoWhatsapp" target="_blank" rel="noopener" href="https://wa.me/?text=${encodeURIComponent('Hoi! Open deze link en log in met je e-mailadres om de trainingen van ASV\'33 te bekijken: ' + link)}">WhatsApp</a>
        <a class="knop licht klein" href="${esc(location.pathname)}?trainco=1">Bekijk als coördinator</a>
      </div>
    </div>`;
}

/* api: { herteken() } */
export function koppelTraincoKaart(v, api){
  const kaart = v.querySelector('#traincoKaart'); if (!kaart) return;
  const schrijf = async (data, ok) => {
    try { await updateDoc(doc(db, 'clubs', S.club.id), data); meld(ok); }
    catch(e){ meld('Opslaan mislukt: ' + (e.code || e.message)); }
  };
  kaart.querySelectorAll('[data-tc-maak]').forEach(b => b.onclick = async () => {
    const uid = b.dataset.tcMaak; b.disabled = true;
    const naam = naamKort(S.club.ledenInfo?.[uid]?.naam);
    await schrijf({ ['trainingscoordinatoren.' + uid]: true, ['trainingscoordinatorenInfo.' + uid]: { naam }, ['ledenInfo.' + uid + '.traincoAanvraag']: deleteField() }, naam + ' is nu trainingscoördinator');
  });
  kaart.querySelectorAll('[data-tc-weg]').forEach(b => b.onclick = async () => {
    if (!confirm('Toegang van deze trainingscoördinator intrekken?')) return;
    const uid = b.dataset.tcWeg; b.disabled = true;
    await schrijf({ ['trainingscoordinatoren.' + uid]: deleteField(), ['trainingscoordinatorenInfo.' + uid]: deleteField() }, 'Toegang ingetrokken');
  });
  kaart.querySelectorAll('[data-tc-afwijs]').forEach(b => b.onclick = async () => {
    const uid = b.dataset.tcAfwijs, naam = naamKort(S.club.ledenInfo?.[uid]?.naam);
    if (!confirm(`Aanmelding van ${naam} verwijderen?\n\nDe persoon krijgt geen toegang als trainingscoördinator. Hij kan zich opnieuw aanmelden via de uitnodigingslink.`)) return;
    b.disabled = true;
    /* Is hij ook trainer, dan alleen de aanmelding weghalen (clublidmaatschap
       is nodig voor zijn team). Anders, zoals voorheen, uit de club halen. */
    const isTrainer = (S._cbCoachTeams || []).some(t => t.leden?.[uid] === true);
    try {
      if (isTrainer){
        await updateDoc(doc(db, 'clubs', S.club.id), { ['ledenInfo.' + uid + '.traincoAanvraag']: deleteField() });
        if (S.club.ledenInfo?.[uid]) delete S.club.ledenInfo[uid].traincoAanvraag;
      } else {
        await updateDoc(doc(db, 'clubs', S.club.id), { ['leden.' + uid]: deleteField(), ['ledenInfo.' + uid]: deleteField() });
        if (S.club.leden) delete S.club.leden[uid]; if (S.club.ledenInfo) delete S.club.ledenInfo[uid];
      }
      meld('Aanmelding verwijderd'); api.herteken();
    } catch(e){ b.disabled = false; meld('Verwijderen mislukt: ' + (e.code || e.message)); }
  });
  const kopie = kaart.querySelector('#traincoKopieer');
  if (kopie) kopie.onclick = async () => {
    try { await navigator.clipboard.writeText(kaart.querySelector('#traincoLink').textContent); meld('Link gekopieerd'); }
    catch(e){ meld('Kopiëren mislukt: selecteer de link handmatig'); }
  };
}

/* Een coach uit de club halen: uit al zijn teams, uit de club zelf en uit zijn
   rollen (trainingscoördinator, bouwcoördinator). Beheerders kunnen hier niet
   worden verwijderd. Vraagt eerst bevestiging. Geeft true terug bij gelukt. */
export async function verwijderCoach(uid, naam, teams){
  if (!S.club?.admins?.[S.user?.uid]) return false;
  if (uid === S.user.uid || S.club.admins?.[uid]) return false;
  const zijnTeams = (teams || []).filter(t => t.leden?.[uid] === true);
  const lijst = zijnTeams.length ? zijnTeams.map(t => t.naam).join(', ') : 'geen eigen team';
  if (!confirm(`${naam} verwijderen?\n\nTeams: ${lijst}\n\nHij verliest de toegang tot deze teams en de club. Dit kun je niet ongedaan maken, maar hij kan zich opnieuw aanmelden via een uitnodigingslink.`)) return false;
  try {
    for (const t of zijnTeams){
      await updateDoc(doc(db, 'teams', t.id), { ['leden.' + uid]: deleteField(), ['ledenInfo.' + uid]: deleteField() });
      if (t.leden) delete t.leden[uid]; if (t.ledenInfo) delete t.ledenInfo[uid];
    }
    const club = { ['leden.' + uid]: deleteField(), ['ledenInfo.' + uid]: deleteField() };
    if (S.club.trainingscoordinatoren?.[uid] !== undefined){ club['trainingscoordinatoren.' + uid] = deleteField(); club['trainingscoordinatorenInfo.' + uid] = deleteField(); }
    for (const [bouw, m] of Object.entries(S.club.bouwCoordinatoren || {})){
      if (m && m[uid] !== undefined){ club[`bouwCoordinatoren.${bouw}.${uid}`] = deleteField(); club[`bouwCoordinatorenInfo.${uid}`] = deleteField(); }
    }
    await updateDoc(doc(db, 'clubs', S.club.id), club);
    for (const k of ['leden', 'ledenInfo', 'trainingscoordinatoren', 'trainingscoordinatorenInfo']) if (S.club[k]) delete S.club[k][uid];
    for (const m of Object.values(S.club.bouwCoordinatoren || {})) if (m) delete m[uid];
    meld(naam + ' is verwijderd');
    return true;
  } catch(e){
    meld('Verwijderen mislukt: ' + (e.code || e.message));
    return false;
  }
}
