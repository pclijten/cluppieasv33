# Firestore-rules: privé-rondebeoordelingen

Sinds release `20261113v` staan volledige beoordelingen die bij een **evaluatieronde van de club** horen (winter, lente) in een eigen top-level collectie: `beoordelingenPrive`. Losse beoordelingen blijven in `teams/{teamId}/beoordelingen`.

Elk privé-document heeft:

| veld | betekenis |
| --- | --- |
| `teamId`, `club` | bij welk team en welke club het hoort |
| `door.uid` | de trainer die het schreef |
| `zichtbaarVoor` | lijst met uid's die het mogen lezen: de schrijver, de clubbeheerders en de coördinatoren van de bouw(en) van het team, vastgelegd op het moment van opslaan |
| `ronde`, `prive: true` | de evaluatieronde |

## 1. Regel toevoegen (Firebase-console → Firestore → Rules)

Gebruikt de bestaande hulpfuncties `isEchteGebruiker()` en `isTeamMember()`. Zet dit blok binnen `match /databases/{database}/documents`, direct vóór `// ===== Clubs =====`:

```
    // ===== [20261113v] Privé-rondebeoordelingen =====
    // Volledige beoordelingen die bij een evaluatieronde van de club horen
    // (winter, lente). Top-level i.p.v. onder teams/{teamId}, zodat de brede
    // subcollectie-regel van teams (isTeamMember) er niet bij kan: andere
    // trainers van het team lezen ze dus NIET. Wie wel mag lezen staat in het
    // document zelf (zichtbaarVoor): de schrijver, de clubbeheerders en de
    // coördinatoren van de bouw(en) van het team — vastgelegd bij opslaan.
    // De app vraagt altijd op met zichtbaarVoor array-contains <eigen uid>,
    // anders weigert Firestore de hele query.
    match /beoordelingenPrive/{beoordelingId} {
      allow read: if isEchteGebruiker()
                  && request.auth.uid in resource.data.zichtbaarVoor;
      // Aanmaken: alleen een teamlid (coach, bouwcoördinator of eigen-bouw-coach)
      // van dat team, op eigen naam, en zelf in zichtbaarVoor.
      allow create: if isEchteGebruiker()
                    && request.resource.data.teamId is string
                    && isTeamMember(request.resource.data.teamId)
                    && request.resource.data.door.uid == request.auth.uid
                    && request.resource.data.zichtbaarVoor is list
                    && request.auth.uid in request.resource.data.zichtbaarVoor;
      // Aanpassen: alleen de schrijver; team en schrijver blijven gelijk.
      allow update: if isEchteGebruiker()
                    && resource.data.door.uid == request.auth.uid
                    && request.resource.data.door.uid == request.auth.uid
                    && request.resource.data.teamId == resource.data.teamId
                    && request.resource.data.zichtbaarVoor is list
                    && request.auth.uid in request.resource.data.zichtbaarVoor;
      allow delete: if isEchteGebruiker()
                    && resource.data.door.uid == request.auth.uid;
    }
```

## 2. Controleer je bestaande regels

- **Geen algemene regel** (gecontroleerd op 14 nov 2026: de huidige rules hebben er geen) zoals `match /{document=**} { allow read, write: if request.auth != null; }`. Regels tellen bij elkaar op: zo'n regel maakt de privé-collectie toch voor iedereen leesbaar.
- Wil je strenger zijn bij aanmaken, voeg dan aan `allow create` je bestaande check toe dat de gebruiker lid is van het team (`request.resource.data.teamId`).

## 3. Volgorde

1. Eerst de regel publiceren.
2. Daarna de PR mergen.

Zonder de regel lukt opslaan van een rondebeoordeling niet ("missing or insufficient permissions"). Het lezen faalt dan stil: de app laat gewoon de teambeoordelingen zien.

## 4. Index

De app vraagt privé-beoordelingen op met `teamId ==` plus `zichtbaarVoor array-contains`. Vraagt Firestore om een samengestelde index, dan staat in de browserconsole een link `https://console.firebase.google.com/...` die de index in één klik aanmaakt. Velden: `teamId` (oplopend) + `zichtbaarVoor` (array-contains).

## 5. Bekende beperking

`zichtbaarVoor` wordt vastgelegd bij opslaan. Wordt iemand later coördinator of beheerder, dan ziet die oudere privé-beoordelingen pas nadat de trainer ze opnieuw opslaat.
