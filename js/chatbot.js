/* ==================== CLUPPIE HULP-CHATBOT (client) ====================
   Zwevende hulp-knop + chat-bottomsheet. Beantwoordt ALLEEN vragen over het
   gebruik van de app; de eigenlijke afhandeling (en de Anthropic API-key) zit
   veilig in de Cloud Function 'chatHulp' (europe-west1). Deze module stuurt
   enkel de sessie-berichten door en toont het antwoord.

   Kenmerken (afgestemd op de gemaakte keuzes):
   - Zwevende knop, altijd zichtbaar zodra je in een team/wedstrijd zit.
   - Onthoudt het gesprek PER SESSIE: de hele berichtenlijst gaat mee, zodat
     vervolgvragen ("en hoe wissel ik dan?") context hebben. Bij het sluiten
     van de app is de sessie weg (geen opslag = AVG-vriendelijk).
   - Kan de interactieve rondleiding aanbieden als iemand vastloopt.

   Publieke API:
     initChatbot()   -> bouwt de chat-bottomsheet klaar (één keer, vanuit main.js)
     openChatbot()   -> opent de chat (aangeroepen vanuit de "Hulpchat"-tegel
                        onder Meer). Er is bewust GEEN zwevende knop meer:
                        die stond te veel in beeld op mobiel.
   ============================================================================ */

import { functions, httpsCallable } from './firebase.js?v=20260811a';
import { S, esc } from './state.js?v=20260811a';
import { telGebruik } from './tracker.js?v=20260814a';
import { startOnboarding, startOnboardingHoofdstuk, heeftOnboardingHoofdstuk } from './onboarding.js?v=20260814b';

/* Sessiegeschiedenis — leeft alleen zolang de app open is. */
let berichten = [];   // [{role:'user'|'assistant', content:'...'}]
let bezig = false;

const chatHulp = () => httpsCallable(functions, 'chatHulp');

/* Startvragen (chips) — puur app-gericht. */
const START_CHIPS = [
  'Hoe maak ik een opstelling?',
  'Hoe nodig ik een coach uit?',
  'Waar staan de trainingen?',
  'Hoe beoordeel ik een speler?',
];

export function initChatbot(){
  if (document.getElementById('cbAchter')) return;

  const achter = document.createElement('div');
  achter.id = 'cbAchter'; achter.className = 'cb-achter';
  achter.innerHTML = `
    <div class="cb-paneel">
      <div class="cb-kop">
        <div class="cb-avatar">🐝</div>
        <div><div class="cb-naam">Cluppie-hulp</div>
          <div class="cb-sub">Vragen over de app</div></div>
        <button class="cb-x" id="cbX" aria-label="Sluiten">✕</button>
      </div>
      <div class="cb-lijf" id="cbLijf"></div>
      <div class="cb-chips" id="cbChips"></div>
      <div class="cb-invoer">
        <input id="cbInput" placeholder="Typ je vraag over de app…" autocomplete="off"
          autocapitalize="sentences" enterkeyhint="send">
        <button class="cb-stuur" id="cbStuur" aria-label="Versturen">➤</button>
      </div>
    </div>`;
  document.body.appendChild(achter);

  document.getElementById('cbX').onclick = sluitChat;
  achter.addEventListener('click', e => { if (e.target === achter) sluitChat(); });

  const stuur = () => {
    const inp = document.getElementById('cbInput');
    const v = (inp.value || '').trim();
    if (!v || bezig) return;
    inp.value = '';
    verstuur(v);
  };
  document.getElementById('cbStuur').onclick = stuur;
  document.getElementById('cbInput').addEventListener('keydown', e => { if (e.key === 'Enter') stuur(); });
  document.getElementById('cbChips').addEventListener('click', e => {
    const b = e.target.closest('.cb-chip'); if (!b || bezig) return;
    verstuur(b.textContent);
  });
}

/* Opent de hulpchat. Bouwt de bottomsheet lui op als dat nog niet gebeurd is
   (zodat een tik op de tegel altijd werkt, ook vóór de eerste init). */
export function openChatbot(){
  if (!document.getElementById('cbAchter')) initChatbot();
  openChat();
}

function openChat(){
  const achter = document.getElementById('cbAchter');
  const lijf = document.getElementById('cbLijf');
  // eerste keer: welkom + startchips
  if (!berichten.length && !lijf.children.length){
    bot('Hoi! Ik beantwoord vragen over het <b>gebruik van Cluppie</b>. Waar kan ik je mee helpen? 👇');
    toonChips(START_CHIPS);
  }
  achter.classList.add('open');
  setTimeout(() => document.getElementById('cbInput')?.focus(), 300);
}
function sluitChat(){ document.getElementById('cbAchter')?.classList.remove('open'); }

function toonChips(lijst){
  const c = document.getElementById('cbChips');
  c.innerHTML = (lijst || []).map(t => `<button class="cb-chip">${esc(t)}</button>`).join('');
}

/* Voeg een bericht toe aan de UI (en optioneel aan de sessiegeschiedenis). */
function bericht(html, wie){
  const lijf = document.getElementById('cbLijf');
  const m = document.createElement('div');
  m.className = 'cb-msg ' + wie;
  m.innerHTML = html;
  lijf.appendChild(m);
  lijf.scrollTop = lijf.scrollHeight;
  return m;
}
function ik(tekst){ bericht(esc(tekst), 'ik'); }
function bot(html){ bericht(html, 'bot'); }

function tik(aan){
  const lijf = document.getElementById('cbLijf');
  let t = document.getElementById('cbTik');
  if (aan && !t){
    t = document.createElement('div'); t.id = 'cbTik'; t.className = 'cb-msg bot cb-tik';
    t.innerHTML = '<span></span><span></span><span></span>';
    lijf.appendChild(t); lijf.scrollTop = lijf.scrollHeight;
  }
  if (!aan && t) t.remove();
}

/* Zet markdown-vet (**...**) om naar <b> en escape de rest, zodat het antwoord
   veilig maar netjes gerenderd wordt (het model gebruikt soms **vet**). */
function veiligHtml(tekst){
  const delen = String(tekst).split(/(\*\*[^*]+\*\*)/g);
  return delen.map(d => {
    const m = d.match(/^\*\*([^*]+)\*\*$/);
    return m ? '<b>' + esc(m[1]) + '</b>' : esc(d);
  }).join('').replace(/\n/g, '<br>');
}

async function verstuur(vraag){
  if (bezig) return;
  bezig = true;
  document.getElementById('cbChips').innerHTML = '';
  ik(vraag);
  telGebruik('chatbot');
  berichten.push({ role: 'user', content: vraag });
  tik(true);

  try {
    const res = await chatHulp()({ berichten });
    tik(false);
    const ruw = res?.data?.antwoord || 'Sorry, ik heb hier geen antwoord op.';
    // De Cloud Function kan aan het eind een verwijzing naar een rondleiding-
    // hoofdstuk meegeven als marker [[TOUR:opstelling]]. Die halen we uit de
    // zichtbare tekst en gebruiken we voor een gerichte "start"-knop.
    const { schoon, hfd } = haalTourUit(ruw);
    berichten.push({ role: 'assistant', content: schoon });
    bot(veiligHtml(schoon));
    naspel(schoon, hfd);
  } catch (err){
    tik(false);
    const reden = err?.code === 'unauthenticated'
      ? 'Log opnieuw in om de hulp te gebruiken.'
      : 'De hulp is even niet bereikbaar. Probeer het zo nog eens.';
    bot(esc(reden));
    console.error('[chatbot] fout:', err?.code, err?.message);
  } finally {
    bezig = false;
  }
}

/* Leesbare labels per rondleiding-hoofdstuk, voor de knoptekst. */
const HFD_LABEL = {
  team:'je team', wedstrijden:'de wedstrijden', opstelling:'de opstelling',
  spelers:'de spelers', training:'de trainingen', video:'de video’s',
  planning:'de planning', documenten:'de documenten', stats:'de statistieken',
  instellingen:'de instellingen', meer:'het Meer-menu',
};

/* Splitst een [[TOUR:hfd]]-marker af van het antwoord. Retourneert de schone
   tekst (zonder marker) en het hoofdstuk-id (of null). */
function haalTourUit(tekst){
  const m = String(tekst).match(/\[\[TOUR:\s*([a-z]+)\s*\]\]/i);
  if (!m) return { schoon: String(tekst).trim(), hfd: null };
  const hfd = m[1].toLowerCase();
  const schoon = String(tekst).replace(m[0], '').replace(/\n{3,}/g, '\n\n').trim();
  return { schoon, hfd: heeftOnboardingHoofdstuk(hfd) ? hfd : null };
}

/* Biedt na een antwoord waar nodig de rondleiding aan (knop onder het bericht).
   Als er een specifiek hoofdstuk (hfd) bij hoort, starten we alleen dát deel —
   dus een vraag over de opstelling geeft alleen de opstelling-rondleiding. */
function naspel(antwoord, hfd){
  const algemeen = /rondleiding|tour|stap voor stap/i.test(antwoord);
  if (!hfd && !algemeen) return;
  const lijf = document.getElementById('cbLijf');
  const wrap = document.createElement('div');
  wrap.className = 'cb-actie';
  const label = hfd
    ? `🎓 Laat me ${HFD_LABEL[hfd] || 'dit onderdeel'} zien`
    : '🎓 Start de rondleiding';
  wrap.innerHTML = `<button class="cb-actie-knop" id="cbTour">${esc(label)}</button>`;
  lijf.appendChild(wrap);
  lijf.scrollTop = lijf.scrollHeight;
  document.getElementById('cbTour').onclick = () => {
    sluitChat();
    if (hfd) startOnboardingHoofdstuk(hfd);
    else startOnboarding(true);
  };
}
