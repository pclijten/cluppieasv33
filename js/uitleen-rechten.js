/* ==================== UITLEEN-RECHTEN ====================
   [20261111] Wie mag een speler uitlenen? Alleen de clubadmin en de
   coördinatoren van de bouw (ook een eigen bouw) waar het team in zit.
   Zichtbaarheidscheck voor knoppen; los bestand zodat teams-spelers.js,
   desktop-schermen.js en uitleen-form.js hem delen zonder importkringloop. */
import { S, isBeheerder } from './state.js?v=20261107e';
import { isBouwCoordinator } from './coordinatoren.js?v=20261107e';

export function magUitlenen(team){
  if (!team) return false;
  if (isBeheerder()) return true;
  if (team.bouw && isBouwCoordinator(team.bouw)) return true;
  const mijn = new Set((S.coordinatorBouwen || []).filter(x => !team.club || x.clubId === team.club).map(x => x.bouw));
  if (team.bouw && mijn.has(team.bouw)) return true;
  const club = (S.clubs || []).find(c => c.id === team.club) || (S.club?.id === team.club ? S.club : null);
  return (Array.isArray(club?.eigenBouwen) ? club.eigenBouwen : [])
    .some(eb => mijn.has(eb.id) && (eb.teams || []).includes(team.id));
}
