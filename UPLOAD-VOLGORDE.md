# UPLOAD-VOLGORDE release 20261120e (Veldkaart)

Upload in deze volgorde via GitHub (Add file → Upload files). Nieuwe bestanden: `js/veldkaart.js` en `VELDKAART-RULES.md`.

1. `VELDKAART-RULES.md` (root, alleen documentatie)
2. `js/veldkaart.js`
3. `js/bouw-hub.js`
4. `js/chatbot.js`
5. `js/club.js`
6. `js/desktop-bouw.js`
7. `js/desktop-schermen.js`
8. `js/desktop.js`
9. `js/main.js`
10. `js/mobiel-bouw.js`
11. `js/nu-scherm.js`
12. `js/onboarding.js`
13. `js/opstelling-sjabloon.js`
14. `js/selectie-bouw.js`
15. `js/teams-evaluatie.js`
16. `js/teams-handleiding.js`
17. `js/teams-hub.js`
18. `js/teams-spelers.js`
19. `js/teams.js`
20. `js/uitleen-form.js`
21. `js/wedstrijd-voorbereiding.js`
22. `js/wedstrijd.js`
23. `styles.css`
24. `sw.js`
25. `index.html`  ← altijd als laatste

Daarna: publiceer de Firestore-regels uit `VELDKAART-RULES.md` (Firebase-console → Firestore → Rules). Zonder die regels werkt de app gewoon door, maar de kaart toont "geen rechten" en er wordt niets opgeslagen.

Cache: `sw.js` heeft CACHE_VERSIE `cluppie-v20261120e`, alle gewijzigde modules staan op `?v=20261120e`. `firebase.js` en `pwa.js` zijn niet aangeraakt.
