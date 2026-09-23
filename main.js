import { auth, onAuthStateChanged } from './firebase.js?v=20260922c';
import { S, $, initModalSluiten, meld, initTerugknop, initGlobaleFoutafhandeling } from './state.js?v=20260922c';
import {
  initAuthUI, checkUitnodiging, handelPendingJoin, verwerkDeeplink, registreerLogin
} from './auth.js?v=20260922c';
import { startTeams, openTeam, renderTeam, verlaatTeamView, teamTabTerug } from './teams.js?v=20260923g';
import { sluitWedstrijd } from './wedstrijd.js?v=20260923g';
import { initChatbot } from './chatbot.js?v=20260923g';

/* [20260921] Training gedeeld met een ouder (?deel=<id>): volledig losse,
   sterk vereenvoudigde flow — geen normale login, geen navigatie, alleen de
   ene gedeelde training + de presentie ervan. Zie js/deel-boot.js voor de
   uitwerking (anonieme login, link inwisselen, tonen). Deze tak stopt hier:
   de rest van dit bestand (normale coach-login/app-boot) draait dan niet. */
const _deelId = new URLSearchParams(location.search).get('deel');
if (_deelId){
  document.getElementById('opstart')?.remove();
  import('./deel-boot.js?v=20260922c').then(m => m.bootDeelPagina(_deelId));
} else {

/* club.js is alleen nodig voor club-admins die het clubdashboard openen —
   dynamisch laden scheelt elke jeugdcoach het downloaden/parsen van het
   hele adminscherm. Eén keer geladen blijft de module door de browser
   gecached, dus latere aanroepen zijn instant. */
const openClubLazy = id => import('./club.js?v=20260923g').then(m => m.openClub(id));

/* knoppen en modal-gedrag één keer registreren */
initModalSluiten();
initAuthUI();
initGlobaleFoutafhandeling();

/* Opstart-laadscherm: standaard zichtbaar in index.html zodat een coach nooit
   naar een leeg zwart scherm kijkt terwijl Firebase Auth de sessie herstelt.
   Duurt dat langer dan 8 s (zwak bereik langs de lijn), dan verschijnt een
   geduld-melding. Zodra onAuthStateChanged een scherm toont fadet het weg. */
const opstartGeduldTimer = setTimeout(() => {
  $('#opstartGeduld')?.classList.add('zichtbaar');
}, 8000);
function verbergOpstart(){
  clearTimeout(opstartGeduldTimer);
  const o = $('#opstart');
  if (!o) return;
  o.classList.add('weg');
  setTimeout(() => o.remove(), 450);   // na de fade helemaal opruimen
}

/* Terugknop-afhandeling: koppel de abstracte hooks uit state.js aan de
   echte navigatiefuncties (voorkomt circulaire imports in state.js).
   _navVerlaatClub laadt club.js pas op het moment dat hij echt wordt
   aangeroepen — dat gebeurt alleen als de club-view al open was, dus dan
   is club.js sowieso al geladen en is dit een instant cache-hit. */
S._navRerender       = renderTeam;
S._navTeamTabTerug   = teamTabTerug;
S._navVerlaatTeam    = verlaatTeamView;
S._navVerlaatClub    = () => import('./club.js?v=20260923g').then(m => m.verlaatClubView());
S._navClubTerug      = () => import('./club.js?v=20260923g').then(m => m.clubTerugEen());
S._navTerugWedstrijd = sluitWedstrijd;
initTerugknop();

/* [20260922d] Desktop-schil (zijbalk links). Alleen op schermen van minstens
   1100 × 520 px wordt js/desktop.js geladen; een telefoon downloadt die
   module nooit. Wordt het venster later breder (of smaller), dan pakt de
   change-listener dat op; desktop.js zelf zet html.desk aan/uit. */
const _deskMq = window.matchMedia('(min-width:1100px) and (min-height:520px)');
function _laadDesktop(){
  if (!_deskMq.matches) return;
  import('./desktop.js?v=20260923g')
    .then(m => m.initDesktop(_deskMq))
    .catch(e => console.warn('[Cluppie] desktop-schil niet geladen', e));
}
_laadDesktop();
_deskMq.addEventListener?.('change', _laadDesktop);

onAuthStateChanged(auth, async user => {
  S.user = user;
  if (user){
    $('#login').style.display = 'none';
    $('#uitnodiging').style.display = 'none';
    $('#app').style.display = '';
    verbergOpstart();
    startTeams();
    registreerLogin();

    /* Hulp-chatbot: paneel klaarzetten. Openen gebeurt via de "Hulpchat"-tegel
       onder Meer (er is geen zwevende knop meer). */
    initChatbot();

    /* De interactieve rondleiding start NIET meer automatisch. Coaches starten
       hem zelf via de tegel "Rondleiding opnieuw" onder Meer → Handleiding. */

    /* openstaande teamkoppeling (uit uitnodiging) afhandelen */
    const t = await handelPendingJoin();
    if (t){ meld('Welkom bij ' + t.data().naam); openTeam(t.id); }

    /* deep-link in de URL verwerken na inloggen */
    setTimeout(() => verwerkDeeplink(openTeam, openClubLazy), 800);
  } else {
    $('#app').style.display = 'none';
    for (const k of Object.keys(S.unsub)){ try { S.unsub[k](); } catch(e){} delete S.unsub[k]; }

    const heeftUitnodiging = await checkUitnodiging();
    if (heeftUitnodiging){
      $('#login').style.display = 'none';
      $('#uitnodiging').style.display = '';
      setTimeout(() => $('#uitnodigEmail')?.focus(), 100);
    } else {
      $('#login').style.display = '';
      $('#uitnodiging').style.display = 'none';
    }
    verbergOpstart();
  }
});

} // einde van de normale (niet-?deel=) boot-tak
