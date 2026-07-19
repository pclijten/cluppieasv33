import { auth, onAuthStateChanged } from './firebase.js?v=20260719';
import { S, $, initModalSluiten, meld, initTerugknop, initGlobaleFoutafhandeling } from './state.js?v=20260719';
import {
  initAuthUI, checkUitnodiging, handelPendingJoin, verwerkDeeplink, registreerLogin
} from './auth.js?v=20260719';
import { startTeams, openTeam, renderTeam, verlaatTeamView } from './teams.js?v=20260719';
import { sluitWedstrijd } from './wedstrijd.js?v=20260719';

/* club.js is alleen nodig voor club-admins die het clubdashboard openen —
   dynamisch laden scheelt elke jeugdcoach het downloaden/parsen van het
   hele adminscherm. Eén keer geladen blijft de module door de browser
   gecached, dus latere aanroepen zijn instant. */
const openClubLazy = id => import('./club.js?v=20260719').then(m => m.openClub(id));

/* knoppen en modal-gedrag één keer registreren */
initModalSluiten();
initAuthUI();
initGlobaleFoutafhandeling();

/* Terugknop-afhandeling: koppel de abstracte hooks uit state.js aan de
   echte navigatiefuncties (voorkomt circulaire imports in state.js).
   _navVerlaatClub laadt club.js pas op het moment dat hij echt wordt
   aangeroepen — dat gebeurt alleen als de club-view al open was, dus dan
   is club.js sowieso al geladen en is dit een instant cache-hit. */
S._navRerender       = renderTeam;
S._navVerlaatTeam    = verlaatTeamView;
S._navVerlaatClub    = () => import('./club.js?v=20260719').then(m => m.verlaatClubView());
S._navTerugWedstrijd = sluitWedstrijd;
initTerugknop();

onAuthStateChanged(auth, async user => {
  S.user = user;
  if (user){
    $('#login').style.display = 'none';
    $('#uitnodiging').style.display = 'none';
    $('#app').style.display = '';
    startTeams();
    registreerLogin();

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
  }
});
