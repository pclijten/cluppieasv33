/* ==================== OVER-PAGINA: DE BELEVING ====================
   Bovenop de gewone pagina (die zonder dit script volledig werkt):
   - Locomotive Scroll (Lenis) voor zacht scrollen, gekoppeld aan GSAP ScrollTrigger
   - een 3D-veld in de hero (Three.js, zie over-3d.js)
   - ScrollTrigger: woorden die oplichten, een teller, een horizontale rail,
     de bal die door de cirkel rolt, een foto die opengaat
   - Vanilla-Tilt op de kaarten, Zdog voor de bal in de cirkel
   Bij "minder beweging" in het systeem gebeurt hier niets: de pagina blijft stil. */
(() => {
const { gsap, ScrollTrigger, VanillaTilt, Zdog } = window;
let loco = null;
const rustig = matchMedia('(prefers-reduced-motion: reduce)').matches;

if (gsap && ScrollTrigger && !rustig) {
  gsap.registerPlugin(ScrollTrigger);
  document.documentElement.classList.add('beleving');
  const mm = gsap.matchMedia();

  /* ---------- zacht scrollen ---------- */
  const Loco = window.locomotiveScroll && (window.locomotiveScroll.default || window.locomotiveScroll);
  if (typeof Loco === 'function') {
    loco = window.__overLoco = new Loco({
      lenisOptions: { lerp: 0.11, smoothWheel: true },
      scrollCallback: () => ScrollTrigger.update(),
    });
    /* ankerlinks (#meedoen) via Lenis, zodat ze ook zacht gaan */
    document.querySelectorAll('a[href^="#"]').forEach(a => a.addEventListener('click', e => {
      const doel = document.querySelector(a.getAttribute('href'));
      if (!doel) return;
      e.preventDefault();
      loco.scrollTo(doel, { offset: -90 });
      doel.setAttribute('tabindex', '-1'); doel.focus({ preventScroll: true });
    }));
  }

  /* ---------- hero: de kop komt woord voor woord omhoog ---------- */
  const kop = document.querySelector('.hero h1');
  kop.innerHTML = kop.textContent.trim().split(' ')
    .map(w => `<span class="w"><span>${w}</span></span>`).join(' ');
  kop.setAttribute('aria-label', kop.textContent);
  gsap.from('.hero h1 .w > span', { yPercent: 110, duration: 0.9, stagger: 0.07, ease: 'power4.out', delay: 0.1 });
  gsap.from('.hero .lead, .hero .acties, .hero__noot', { y: 18, opacity: 0, duration: 0.7, stagger: 0.08, ease: 'power3.out', delay: 0.45 });

  /* ---------- elke oefenvorm in 3D (alleen met WebGL); de SVG blijft als terugval ---------- */
  const kanWebGL = (() => { try { return !!document.createElement('canvas').getContext('webgl2'); } catch { return false; } })();
  if (window.Veld3D && kanWebGL){
    const maak3D = box => {
      if (box._veld3d) return box._veld3d;
      const data = box.querySelector('script[data-vorm]');
      if (!data) return null;
      try {
        const hero = box.closest('.hero');
        box._veld3d = window.Veld3D.maak(box, JSON.parse(data.textContent), { kantelBijScroll: hero || null });
        box.classList.add('is-3d');
      } catch (e){ console.warn('[over] 3D niet gelukt', e); box._veld3d = null; }
      return box._veld3d;
    };
    window.speel3D = box => { const v = box && maak3D(box); if (v) v.speel(); };
    const io3 = new IntersectionObserver(es => es.forEach(e => {
      if (e.isIntersecting && e.target.offsetParent !== null){ window.speel3D(e.target); io3.unobserve(e.target); }
    }), { threshold: 0.3 });
    document.querySelectorAll('[data-tekening]').forEach(box => io3.observe(box));
    document.querySelector('[data-opnieuw]')?.addEventListener('click', () => window.speel3D(document.querySelector('.hero [data-tekening]')));
  }

  /* ---------- groene band: de zin licht woord voor woord op ---------- */
  const zin = document.querySelector('.statement');
  zin.innerHTML = zin.textContent.trim().split(' ').map(w => `<span class="sw">${w}</span>`).join(' ');
  gsap.fromTo('.statement .sw', { opacity: 0.18 }, {
    opacity: 1, stagger: 0.1, ease: 'none',
    scrollTrigger: { trigger: '.statement', start: 'top 80%', end: 'bottom 45%', scrub: 0.5 },
  });
  gsap.from('.pijlers li', {
    y: 60, opacity: 0, duration: 0.8, stagger: 0.12, ease: 'power3.out',
    scrollTrigger: { trigger: '.pijlers', start: 'top 85%', once: true },
  });

  /* ---------- "bijna 170" telt op ---------- */
  const getal = document.querySelector('.cijfer__getal');
  if (getal) {
    const teller = { n: 0 };
    ScrollTrigger.create({
      trigger: getal, start: 'top 85%', once: true,
      onEnter: () => gsap.to(teller, { n: 170, duration: 1.6, ease: 'power3.out', snap: { n: 1 },
        onUpdate: () => { getal.textContent = 'bijna ' + teller.n; } }),
    });
  }

  /* ---------- nieuw: de rail schuift horizontaal mee met scrollen (brede schermen) ---------- */
  mm.add('(min-width: 60rem)', () => {
    const sectie = document.querySelector('.nieuw'), rail = sectie.querySelector('.rail');
    sectie.classList.add('is-gepind');
    const afstand = () => rail.scrollWidth - document.documentElement.clientWidth;
    const tw = gsap.to(rail, {
      x: () => -afstand(), ease: 'none',
      scrollTrigger: { trigger: sectie, start: 'top top', end: () => '+=' + afstand(), pin: true, scrub: 0.6, invalidateOnRefresh: true },
    });
    return () => { sectie.classList.remove('is-gepind'); if (tw.scrollTrigger) tw.scrollTrigger.kill(); tw.kill(); gsap.set(rail, { clearProps: 'x' }); };
  });

  /* ---------- de cirkel: een Zdog-bal rolt mee met het zaterdag-verhaal ---------- */
  const rond = document.querySelector('.rond');
  if (rond && Zdog) {
    rond.classList.add('rond--zdog');
    const loper = document.createElement('div'); loper.className = 'loper'; loper.setAttribute('aria-hidden', 'true');
    loper.innerHTML = '<canvas width="128" height="128"></canvas>';
    rond.prepend(loper);
    const illo = new Zdog.Illustration({ element: loper.querySelector('canvas'), zoom: 3.6 });
    const bol = new Zdog.Anchor({ addTo: illo });
    new Zdog.Shape({ addTo: bol, stroke: 30, color: '#f4f4ef' });
    /* twaalf zwarte vijfhoeken op de plekken van een echte voetbal (de hoekpunten van een icosaëder) */
    const vlak = n => {
      const ry = Math.atan2(n[0], n[2]), rx = -Math.asin(n[1]);
      const buiten = new Zdog.Group({ addTo: bol, rotate: { y: ry } });
      const binnen = new Zdog.Group({ addTo: buiten, rotate: { x: rx } });
      new Zdog.Polygon({ addTo: binnen, sides: 5, radius: 5.2, stroke: 1, fill: true, color: '#1b1f24', translate: { z: 14.6 } });
    };
    const h = Math.atan(0.5);
    vlak([0, 1, 0]); vlak([0, -1, 0]);
    for (let k = 0; k < 5; k++){
      const f1 = k * Zdog.TAU / 5, f2 = f1 + Zdog.TAU / 10;
      vlak([Math.cos(h) * Math.sin(f1), Math.sin(h), Math.cos(h) * Math.cos(f1)]);
      vlak([Math.cos(h) * Math.sin(f2), -Math.sin(h), Math.cos(h) * Math.cos(f2)]);
    }
    const zetStand = s => {
      if (rond.dataset.stand === String(s)) return;
      rond.dataset.stand = s;
      rond.querySelectorAll('[data-naar]').forEach(b => b.setAttribute('aria-pressed', b.dataset.naar === String(s)));
    };
    /* de bal rust bij de stations (evaluatie, tussen groeicurve en thema, training) en rolt ertussen */
    const SLEUTELS = [[0, 36], [0.22, 36], [0.42, 180], [0.58, 180], [0.78, 324], [1, 324]];
    const hoekVan = p => {
      for (let i = 1; i < SLEUTELS.length; i++){
        const [p0, h0] = SLEUTELS[i - 1], [p1, h1] = SLEUTELS[i];
        if (p <= p1){ const f = (p - p0) / (p1 - p0 || 1), z = f * f * (3 - 2 * f); return h0 + (h1 - h0) * z; }
      }
      return 324;
    };
    const zet = p => {
      const hoek = hoekVan(p);
      loper.style.rotate = hoek + 'deg';
      /* rollen: de bal draait in de looprichting, evenredig met de afgelegde weg */
      bol.rotate.y = hoek * Math.PI / 180 * 4.5;
      illo.rotate.x = -0.35;
      illo.updateRenderGraph();
      zetStand(p < 0.34 ? 1 : p < 0.67 ? 2 : 3);
    };
    zet(0);
    /* brede schermen: de cirkel blijft staan tot de bal rond is; het zaterdag-verhaal wisselt op zijn plek */
    mm.add('(min-width: 60rem)', () => {
      const sectie = document.querySelector('.cirkel');
      const stappen = [...sectie.querySelectorAll('.log li')];
      sectie.classList.add('is-gepind');
      const toon = p => { const i = p < 0.34 ? 0 : p < 0.67 ? 1 : 2; stappen.forEach((li, k) => li.classList.toggle('is-actief', k === i)); };
      toon(0);
      const st = ScrollTrigger.create({
        trigger: '.cirkel__grid', start: 'center 54%', end: '+=' + Math.round(innerHeight * 2.4), pin: true, scrub: 0.8,
        onUpdate: s => { zet(s.progress); toon(s.progress); },
      });
      /* klik op een station: scrol naar dat deel van het verhaal */
      const naar = { 1: 0.15, 2: 0.5, 3: 0.88 };
      const klik = e => { const b = e.target.closest('[data-naar]'); if (!b) return; e.stopImmediatePropagation(); scrolNaar(st, naar[b.dataset.naar]); };
      rond.addEventListener('click', klik, true);
      return () => { sectie.classList.remove('is-gepind'); stappen.forEach(li => li.classList.remove('is-actief')); rond.removeEventListener('click', klik, true); st.kill(); };
    });
  }

  /* ---------- alles op een rij: de tabbladen lopen mee met scrollen ---------- */
  mm.add('(min-width: 60rem)', () => {
    const sectie = document.querySelector('.alles');
    const tabs = [...sectie.querySelectorAll('[role=tab]')];
    sectie.classList.add('is-gepind');
    let huidig = 0;
    const st = ScrollTrigger.create({
      trigger: sectie, start: 'top top', end: '+=' + Math.round(innerHeight * 0.45 * (tabs.length - 1)), pin: true, scrub: true,
      onUpdate: s => {
        const i = Math.min(tabs.length - 1, Math.round(s.progress * (tabs.length - 1)));
        if (i !== huidig) { huidig = i; tabs[i].click(); tabs[i].scrollIntoView({ block: 'nearest', inline: 'center' }); }
      },
    });
    const klik = e => { const t = e.target.closest('[role=tab]'); if (!t || !e.isTrusted) return; const i = tabs.indexOf(t); huidig = i; scrolNaar(st, i / (tabs.length - 1)); };
    sectie.addEventListener('click', klik);
    return () => { sectie.classList.remove('is-gepind'); sectie.removeEventListener('click', klik); st.kill(); };
  });

  /* ---------- doe mee: de foto gaat open als een gordijn ---------- */
  gsap.fromTo('.meedoen__foto', { clipPath: 'inset(18% 14% 18% 14% round 20px)' }, {
    clipPath: 'inset(0% 0% 0% 0% round 20px)', ease: 'none',
    scrollTrigger: { trigger: '.meedoen__foto', start: 'top 95%', end: 'top 35%', scrub: 0.6 },
  });
  gsap.from('.meedoen__foto img', {
    scale: 1.25, ease: 'none',
    scrollTrigger: { trigger: '.meedoen__foto', start: 'top 95%', end: 'top 35%', scrub: 0.6 },
  });

  /* ---------- footer: de slotzin komt regel voor regel binnen ---------- */
  const slot = document.querySelector('.voet__slot');
  slot.innerHTML = slot.textContent.trim().split(' ').map(w => `<span class="w"><span>${w}</span></span>`).join(' ');
  gsap.from('.voet__slot .w > span', {
    yPercent: 110, duration: 0.9, stagger: 0.06, ease: 'power4.out',
    scrollTrigger: { trigger: '.voet', start: 'top 75%', once: true },
  });

  /* ---------- kaarten die meebewegen met de muis (alleen met een echte muis) ---------- */
  if (VanillaTilt && matchMedia('(hover: hover) and (pointer: fine)').matches) {
    VanillaTilt.init(document.querySelectorAll('.rail > li, .vorm__veld, .veldkaart'), {
      max: 6, speed: 600, perspective: 1100, glare: true, 'max-glare': 0.12, scale: 1.01, gyroscope: false,
    });
  }

  function scrolNaar(st, p) {
    const y = st.start + (st.end - st.start) * p;
    if (loco) loco.scrollTo(y, { duration: 1.1 }); else window.scrollTo({ top: y, behavior: 'smooth' });
  }

  /* fonts en foto's kunnen de lengte nog veranderen */
  window.addEventListener('load', () => ScrollTrigger.refresh());
}
})();
