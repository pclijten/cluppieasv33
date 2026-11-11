# Firestore-rules voor de trainingscoördinator

De volledige, aangepaste ruleset staat in `firestore.rules` (gebaseerd op jullie huidige rules). **Niet getest en niet gedeployd**: plak hem in Firebase Console → Firestore → Rules, probeer hem eerst in de Rules Playground en publiceer dan.

Wat er verandert ten opzichte van de huidige rules:

1. **Commentaarblok** bij de hulpfuncties: legt de rol uit.
2. **`teams` update**: een club-admin mag ook de teams van zijn club bijwerken (nodig om trainingsmomenten in te stellen als hij zelf geen coach van dat team is).

Wat bewust **niet** verandert:

- De coördinator leest `clubs`, `teams` en `trainingen` al via de bestaande regel `isEchteGebruiker()`. Daar is geen extra regel voor nodig.
- De `spelers`-subcollectie vereist `isTeamMember`, dus de coördinator kan geen spelersnamen lezen. Het aantal komt uit `teams.spelersAantal`.
- Alleen een club-admin kan `trainingscoordinatoren` op het clubdocument zetten (de zelf-aanmeld-regel staat alleen `leden`/`ledenInfo` toe). Een coördinator kan nergens schrijven.

Let op: de bestaande leesregel op `teams` en `clubs` geldt voor elke echte gebruiker in jullie Firebase-project. Dat is niet nieuw, maar de coördinator-weergave leunt erop.
