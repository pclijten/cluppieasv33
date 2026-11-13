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

Zet dit blok **naast** je bestaande `match /teams/{teamId}`, binnen `match /databases/{database}/documents`:

```
match /beoordelingenPrive/{id} {
  // lezen: alleen wie in zichtbaarVoor staat
  allow read: if request.auth != null
    && request.auth.uid in resource.data.zichtbaarVoor;

  // aanmaken: alleen als jezelf, en jezelf moet in zichtbaarVoor staan
  allow create: if request.auth != null
    && request.resource.data.door.uid == request.auth.uid
    && request.auth.uid in request.resource.data.zichtbaarVoor
    && request.resource.data.teamId is string;

  // aanpassen en verwijderen: alleen de schrijver zelf
  allow update: if request.auth != null
    && resource.data.door.uid == request.auth.uid
    && request.resource.data.door.uid == request.auth.uid;
  allow delete: if request.auth != null
    && resource.data.door.uid == request.auth.uid;
}
```

## 2. Controleer je bestaande regels

- **Geen algemene regel** zoals `match /{document=**} { allow read, write: if request.auth != null; }`. Regels tellen bij elkaar op: zo'n regel maakt de privé-collectie toch voor iedereen leesbaar.
- Wil je strenger zijn bij aanmaken, voeg dan aan `allow create` je bestaande check toe dat de gebruiker lid is van het team (`request.resource.data.teamId`).

## 3. Volgorde

1. Eerst de regel publiceren.
2. Daarna de PR mergen.

Zonder de regel lukt opslaan van een rondebeoordeling niet ("missing or insufficient permissions"). Het lezen faalt dan stil: de app laat gewoon de teambeoordelingen zien.

## 4. Index

De app vraagt privé-beoordelingen op met `teamId ==` plus `zichtbaarVoor array-contains`. Vraagt Firestore om een samengestelde index, dan staat in de browserconsole een link `https://console.firebase.google.com/...` die de index in één klik aanmaakt. Velden: `teamId` (oplopend) + `zichtbaarVoor` (array-contains).

## 5. Bekende beperking

`zichtbaarVoor` wordt vastgelegd bij opslaan. Wordt iemand later coördinator of beheerder, dan ziet die oudere privé-beoordelingen pas nadat de trainer ze opnieuw opslaat.
