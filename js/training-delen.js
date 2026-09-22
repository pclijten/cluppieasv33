/* ==================== TRAINING DELEN MET OUDERS ====================
   [20260921] Knop rechtsboven in de trainingsweergave (.trw-balk, volgt
   hetzelfde plugin-patroon als training-video.js/training-tactiek.js: een
   los, additief laagje dat zijn eigen knop in de balk zet en zichzelf
   opruimt via resetTrainingDelen()).

   Een coach kiest hoelang de link geldig is, de app maakt een
   trainingDeel-document aan, en toont een deelbare link (?deel=<id>) die
   de ouder — zonder Cluppie-account — naar een eigen, sterk vereenvoudigde
   pagina stuurt: alleen die ene training + de presentie ervan. Zie
   deel-boot.js voor de kant van de ouder, en firestore.rules voor hoe die
   toegang precies is afgebakend (trainingDeel + trainingToegang). */
import { db, collection, addDoc, serverTimestamp, Timestamp } from './firebase.js?v=20260922c';
import { S, esc, meld, openModal, sluitModal } from './state.js?v=20260922c';
import { ico } from './icons.js?v=20260922c';

let _ctx = null;

function zetBalkKnop(){
  const balk = _ctx.balk;
  let knop = balk.querySelector('.trw-deel-knop');
  if (!knop){
    knop = document.createElement('button');
    // Hergebruikt de bestaande .trw-notitie-knop-stijl (simpele ronde
    // icoonknop in de balk) i.p.v. een nieuwe CSS-klasse te verzinnen.
    knop.className = 'trw-notitie-knop trw-deel-knop';
    knop.setAttribute('aria-label', 'Delen met een ouder');
    knop.innerHTML = ico('action-share', 17) || '⇪';
    balk.appendChild(knop);
  }
  knop.onclick = () => openDeelModal();
  _ctx.deelKnop = knop;
}

export function initTrainingDelen({ balk, trainingId, teamId, teamNaam, clubNaam, titel }){
  if (!teamId) return; // geen teamcontext (zou niet moeten voorkomen bij coaches) → geen deel-knop
  _ctx = { balk, trainingId, teamId, teamNaam: teamNaam || '', clubNaam: clubNaam || '', titel: titel || 'Training' };
  zetBalkKnop();
}

export function resetTrainingDelen(){
  if (_ctx?.deelKnop) _ctx.deelKnop.remove();
  _ctx = null;
}

const PRESETS = [
  { id: 'vanavond', label: 'Tot vanavond 22:00', bereken: () => {
      const d = new Date(); d.setHours(22,0,0,0);
      if (d.getTime() <= Date.now()) d.setDate(d.getDate()+1);
      return d;
    } },
  { id: '24u',   label: '24 uur',      bereken: () => new Date(Date.now() + 24*60*60*1000) },
  { id: '3d',    label: '3 dagen',     bereken: () => new Date(Date.now() + 3*24*60*60*1000) },
  { id: 'week',  label: '1 week',      bereken: () => new Date(Date.now() + 7*24*60*60*1000) },
];

function deelLinkUrl(deelId){
  return `${location.origin}${location.pathname}?deel=${deelId}`;
}

function openDeelModal(){
  if (!_ctx) return;
  // [20260921] BUGFIX: alles wat de modal nodig heeft wordt hier ÉÉN keer
  // vastgelegd in een lokale constante i.p.v. steeds de gedeelde, veranderlijke
  // _ctx te blijven lezen. Bleek nodig: als de trainingsweergave ondertussen
  // sluit (bv. door een terug-actie terwijl de modal nog open staat) wordt
  // _ctx via resetTrainingDelen() naar null gezet — en dan crashte de
  // "Deellink maken"-knop op _ctx.teamId, terwijl de modal zelf nog gewoon
  // zichtbaar was. Door hier een snapshot te pakken is de modal volledig
  // onafhankelijk van wat er daarna met _ctx gebeurt.
  const gegevens = { ..._ctx };
  openModal(`
    <h2>Training delen</h2>
    <p style="font-size:calc(13px * var(--fs));color:var(--ink-2);margin-bottom:10px">
      Deel <b>${esc(gegevens.titel)}</b> met een ouder die vandaag meehelpt. Die krijgt een
      link waarmee hij de training kan bekijken én kan zien wie er is (presentie, alleen-lezen) — verder niets
      van de app.
    </p>
    <div class="veldgroep">
      <label>Hoelang moet de link geldig zijn?</label>
      <div class="segment" id="mDeelDuur" style="flex-wrap:wrap">
        ${PRESETS.map((p,i) => `<button type="button" data-duur="${p.id}" class="${i===0?'actief':''}">${esc(p.label)}</button>`).join('')}
      </div>
    </div>
    <button class="knop vol" id="mDeelMaak">Deellink maken</button>
    <button class="knop licht vol" id="mDeelAnnuleer" style="margin-top:8px">Annuleren</button>
    <div id="mDeelResultaat" style="display:none;margin-top:14px">
      <div class="veldgroep">
        <label>Link (geldig tot <span id="mDeelVervalt"></span>)</label>
        <div style="display:flex;gap:8px">
          <input class="invoer" id="mDeelLinkVeld" readonly style="flex:1;font-size:calc(12.5px * var(--fs))">
          <button class="knop licht" id="mDeelKopieer" style="flex-shrink:0">Kopieer</button>
        </div>
      </div>
      <button class="knop vol" id="mDeelWhatsapp" style="background:#25D366">WhatsApp</button>
    </div>`);

  const $ = sel => document.getElementById(sel);
  let gekozenDuur = PRESETS[0];
  $('mDeelDuur').querySelectorAll('button').forEach(b => b.onclick = () => {
    $('mDeelDuur').querySelectorAll('button').forEach(x => x.classList.remove('actief'));
    b.classList.add('actief');
    gekozenDuur = PRESETS.find(p => p.id === b.dataset.duur) || PRESETS[0];
  });
  $('mDeelAnnuleer').onclick = () => sluitModal();

  $('mDeelMaak').onclick = async () => {
    const knop = $('mDeelMaak');
    knop.disabled = true; knop.textContent = 'Bezig…';
    try {
      const vervaltDatum = gekozenDuur.bereken();
      const ref = await addDoc(collection(db,'trainingDeel'), {
        teamId: gegevens.teamId,
        trainingId: gegevens.trainingId,
        titel: gegevens.titel,
        teamNaam: gegevens.teamNaam,
        clubNaam: gegevens.clubNaam,
        vervaltOp: Timestamp.fromDate(vervaltDatum),
        gemaaktDoor: S.user?.uid || null,
        gemaakt: serverTimestamp(),
      });
      const url = deelLinkUrl(ref.id);
      $('mDeelDuur').style.display = 'none';
      knop.style.display = 'none';
      $('mDeelAnnuleer').textContent = 'Sluiten';
      $('mDeelResultaat').style.display = '';
      $('mDeelVervalt').textContent = vervaltDatum.toLocaleString('nl-NL', {weekday:'short', day:'numeric', month:'short', hour:'2-digit', minute:'2-digit'});
      $('mDeelLinkVeld').value = url;
      $('mDeelKopieer').onclick = async () => {
        try { await navigator.clipboard.writeText(url); meld('Link gekopieerd'); }
        catch(e){ $('mDeelLinkVeld').select(); document.execCommand('copy'); meld('Link gekopieerd'); }
      };
      $('mDeelWhatsapp').onclick = () => {
        const tekst = `Hoi! Je helpt vandaag mee bij de training van ${gegevens.teamNaam || 'het team'}. Via deze link zie je de training: ${url}`;
        window.open('https://wa.me/?text=' + encodeURIComponent(tekst), '_blank');
      };
    } catch(e){
      knop.disabled = false; knop.textContent = 'Deellink maken';
      meld('Deellink maken mislukt: ' + (e.code||e.message));
    }
  };
}
