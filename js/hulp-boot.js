/* ==================== HULP-BOOT (kant van de ouder) ====================
   [20261118a] Wordt aangeroepen door main.js zodra de URL een ?hulp=<id>
   bevat, los van de normale login. Een ouder zonder Cluppie-account schrijft
   zich hier in als helper bij een training (Lijstjes → Trainingshulp, zie
   lijst-hulp.js voor het datamodel).

   De ouder logt automatisch anoniem in. Met die anonieme sessie mag hij, zolang
   de link aan staat (hulpDeel.open), het deel-document en de aanmeldingen
   lezen en per training één eigen aanmelding maken of weghalen. Meer niet: geen
   team, geen spelers, geen andere lijstjes (zie TRAININGSHULP-RULES.md).

   Deze module heeft alleen firebase.js nodig en houdt zijn eigen kleine
   hulpjes (esc, datums), zodat hij los staat van de rest van de app. */
import { auth, db, signInAnonymously, onAuthStateChanged, doc, collection, setDoc, deleteDoc, onSnapshot } from './firebase.js?v=20261106r';

const NAAM_MAX = 24;
const NAAM_SLEUTEL = 'cluppieHulpNaam';
const DAGEN = ['Maandag', 'Dinsdag', 'Woensdag', 'Donderdag', 'Vrijdag', 'Zaterdag', 'Zondag'];

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
const isoLokaal = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const datumObj = iso => new Date(iso + 'T12:00');
const tijdTekst = m => m.start && m.eind ? `${m.start}–${m.eind}` : (m.start || '');
const svg = (pad, maat, dikte) => `<svg width="${maat}" height="${maat}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${dikte}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${pad}</svg>`;
const I_SLOT = svg('<rect x="4.6" y="10.4" width="14.8" height="9.8" rx="2.4"/><path d="M8 10.4V8a4 4 0 0 1 8 0v2.4"/><circle cx="12" cy="15.2" r="1.4" fill="currentColor" stroke="none"/>', 18, 1.8);
const I_VINK = svg('<path d="M5 12.5l4.5 4.5L19 7.5"/>', 16, 2.2);

function meldingHtml(titel, tekst){
  return `<div class="hp"><div class="hp-melding">${I_SLOT}<h1 class="hp-h1">${esc(titel)}</h1><p class="hp-intro">${esc(tekst)}</p></div></div>`;
}

/* Wacht tot Firebase Auth een eventuele bestaande sessie heeft hersteld. Zonder
   dit zou een coach die de link in zijn eigen browser opent anoniem worden
   ingelogd, bovenop zijn echte sessie. */
function authKlaar(){
  return new Promise(klaar => { const stop = onAuthStateChanged(auth, () => { stop(); klaar(); }, () => klaar()); });
}

export async function bootHulpPagina(deelId){
  const el = document.getElementById('deel');
  if (!el) return;
  el.style.display = 'block';
  el.innerHTML = `<div class="hp"><p class="hp-intro">Bezig met laden…</p></div>`;

  try {
    await authKlaar();
    if (!auth.currentUser) await signInAnonymously(auth);
  } catch(e){
    el.innerHTML = meldingHtml('Laden is niet gelukt', 'Controleer je verbinding en ververs de pagina.');
    return;
  }
  const uid = auth.currentUser.uid;
  const st = { deel:null, aanm:null, mijnNaam:'', bezig:false, getekend:false };
  try { st.mijnNaam = (localStorage.getItem(NAAM_SLEUTEL) || '').slice(0, NAAM_MAX); } catch(e){ /* geen opslag: prima */ }

  const stopFout = e => {
    console.error('[Cluppie] trainingshulp', e);
    st.getekend = false;
    el.innerHTML = e?.code === 'permission-denied'
      ? meldingHtml('Deze inschrijflijst staat uit', 'Vraag de trainer om een nieuwe link.')
      : meldingHtml('Laden is niet gelukt', 'Controleer je verbinding en ververs de pagina.');
  };

  onSnapshot(doc(db, 'hulpDeel', deelId), snap => {
    if (!snap.exists()){
      /* [20261118b] Komt dit uit de lokale cache (trage of wegvallende verbinding,
         of de ingebouwde browser van WhatsApp), dan weet de app nog niet of de
         lijst bestaat. Niet "verwijderd" melden, maar wachten: Firestore probeert
         het zelf opnieuw en tekent de lijst zodra de server antwoordt. */
      if (snap.metadata?.fromCache){
        if (!st.deel){ st.getekend = false; el.innerHTML = meldingHtml('Even geduld', 'We maken verbinding met Cluppie. Lukt het niet, controleer dan je internet of open de link in je gewone browser.'); }
        return;
      }
      st.getekend = false;
      el.innerHTML = meldingHtml('Deze link werkt niet (meer)', 'De lijst is verwijderd. Vraag de trainer om een nieuwe link.');
      return;
    }
    st.deel = snap.data(); teken();
  }, stopFout);
  onSnapshot(collection(db, 'hulpDeel', deelId, 'aanmeldingen'), snap => {
    st.aanm = snap.docs.map(d => ({ id:d.id, ...d.data() })); teken();
  }, stopFout);

  /* Komende trainingen waar hulp bij gevraagd is of al iemand helpt. */
  function rijen(){
    const nu = isoLokaal(new Date());
    return Object.entries(st.deel?.momenten || {})
      .filter(([, x]) => x && x.datum && String(x.datum) >= nu)
      .map(([id, x]) => {
        const helpers = (st.aanm || []).filter(a => a.rij === id && a.naam).sort((a, b) => (a.ms || 0) - (b.ms || 0));
        const nodig = Math.max(0, Number(x.nodig) || 0);
        return { id, datum:String(x.datum), start:x.start || '', eind:x.eind || '', nodig, helpers,
          ik:helpers.some(a => a.uid === uid && a.door === 'ouder'), vrij:Math.max(0, nodig - helpers.length) };
      })
      .filter(r => r.nodig > 0 || r.helpers.length)
      .sort((a, b) => a.datum.localeCompare(b.datum));
  }

  function waarschuw(tekst){
    const w = el.querySelector('#hpWaarschuw'); if (!w) return;
    w.textContent = tekst || ''; w.hidden = !tekst;
    el.querySelector('#hpNaam')?.classList.toggle('fout', !!tekst);
  }

  /* Het raamwerk (kop, naamveld, voet) tekenen we één keer; daarna verversen
     we alleen de lijst, zodat het naamveld zijn focus en tekst houdt. */
  function teken(){
    if (!st.deel || !st.aanm) return;
    if (!st.getekend){
      const titel = st.deel.titel || 'Trainingshulp';
      el.innerHTML = `<div class="hp">
        <div>
          <div class="hp-label">${esc([st.deel.teamNaam, titel].filter(Boolean).join(' · '))}</div>
          <h1 class="hp-h1">Help je mee bij de training?</h1>
          <p class="hp-intro">We zoeken bij elke training een paar ouders die meehelpen. De trainer legt uit wat je doet. Kies de dagen waarop je kunt.</p>
        </div>
        <div class="veldgroep">
          <label for="hpNaam">Je voornaam</label>
          <input class="invoer hp-naam" id="hpNaam" type="text" value="${esc(st.mijnNaam)}" placeholder="bv. Sandra" maxlength="${NAAM_MAX}" autocomplete="given-name" autocapitalize="words">
          <div class="hp-waarschuw" id="hpWaarschuw" role="alert" hidden></div>
        </div>
        <div class="hp-lijst" id="hpLijst"></div>
        <div class="hp-dank" id="hpDank" role="status" hidden></div>
        <p class="hp-voet">${I_SLOT}<span>Andere ouders met deze link zien wie zich heeft ingeschreven, alleen met voornaam. Afmelden kan op deze telefoon, of via de trainer.</span></p>
      </div>`;
      const inp = el.querySelector('#hpNaam');
      inp.oninput = () => {
        st.mijnNaam = inp.value.slice(0, NAAM_MAX);
        try { localStorage.setItem(NAAM_SLEUTEL, st.mijnNaam.trim()); } catch(e){ /* geen opslag: prima */ }
        waarschuw('');
      };
      st.getekend = true;
    }
    tekenLijst();
  }

  function tekenLijst(){
    const lijst = el.querySelector('#hpLijst'); if (!lijst) return;
    const rs = rijen();
    lijst.innerHTML = rs.length ? rs.map(r => {
      const d = datumObj(r.datum);
      const mnd = d.toLocaleDateString('nl-NL', { month:'short' }).replace('.', '');
      const dag = DAGEN[(d.getDay() + 6) % 7];
      const tijd = tijdTekst(r);
      const namen = [...r.helpers.filter(a => a.uid === uid && a.door === 'ouder').map(a => `${a.naam} (jij)`),
        ...r.helpers.filter(a => !(a.uid === uid && a.door === 'ouder')).map(a => a.naam)];
      const plek = r.vrij ? `nog ${r.vrij} ${r.vrij === 1 ? 'plek' : 'plekken'}` : '';
      const wie = namen.length ? namen.join(', ') + (plek ? ' · ' + plek : '') : `Nog niemand · ${r.vrij} ${r.vrij === 1 ? 'plek' : 'plekken'}`;
      const actie = r.ik ? `<button class="knop hp-knop" data-hp-af="${esc(r.id)}">Afmelden</button>`
        : r.vrij ? `<button class="knop fluo hp-knop" data-hp-help="${esc(r.id)}">Ik help</button>`
        : `<span class="hp-vol">${I_VINK} Vol</span>`;
      return `<div class="hp-rij ${r.ik ? 'ik' : ''}">
        <span class="lj-dag"><b>${d.getDate()}</b><small>${esc(mnd)}</small></span>
        <span class="hp-t"><b>${esc(dag)}${tijd ? ` <span class="lh-tijd">${esc(tijd)}</span>` : ''}</b><small>${esc(wie)}</small></span>
        ${actie}</div>`;
    }).join('') : `<div class="kaart leeg">Er staan op dit moment geen trainingen open.</div>`;

    const aantal = rs.filter(r => r.ik).length;
    const dank = el.querySelector('#hpDank');
    if (dank){
      dank.hidden = !aantal;
      dank.textContent = aantal ? `Bedankt, je staat op de lijst voor ${aantal} ${aantal === 1 ? 'training' : 'trainingen'}. De trainer ziet het direct.` : '';
    }
    lijst.querySelectorAll('[data-hp-help]').forEach(b => b.onclick = () => meldAan(b.dataset.hpHelp, b));
    lijst.querySelectorAll('[data-hp-af]').forEach(b => b.onclick = () => meldAf(b.dataset.hpAf, b));
  }

  const eigenRef = rid => doc(db, 'hulpDeel', deelId, 'aanmeldingen', `${uid}_${rid}`);

  async function meldAan(rid, knop){
    if (st.bezig) return;
    const naam = st.mijnNaam.trim().slice(0, NAAM_MAX);
    if (!naam){ waarschuw('Vul eerst je voornaam in, dan kun je een dag kiezen.'); el.querySelector('#hpNaam')?.focus(); return; }
    const r = rijen().find(x => x.id === rid);
    if (!r || !r.vrij){ tekenLijst(); return; }
    st.bezig = true; knop.disabled = true;
    try { await setDoc(eigenRef(rid), { uid, rij:rid, naam, ms:Date.now(), door:'ouder' }); waarschuw(''); }
    catch(e){ console.error('[Cluppie] aanmelden', e); waarschuw('Inschrijven is niet gelukt. Probeer het nog een keer.'); knop.disabled = false; }
    st.bezig = false;
  }
  async function meldAf(rid, knop){
    if (st.bezig) return;
    st.bezig = true; knop.disabled = true;
    try { await deleteDoc(eigenRef(rid)); waarschuw(''); }
    catch(e){ console.error('[Cluppie] afmelden', e); waarschuw('Afmelden is niet gelukt. Probeer het nog een keer.'); knop.disabled = false; }
    st.bezig = false;
  }
}
