# Firestore-rules: Veldkaart (sportparken en veldmeldingen)

Sinds release `20261120e` kan een coach bij een wedstrijd een luchtfoto van het sportpark openen met het veld gemarkeerd. Clubbeheer zet de velden van het eigen sportpark op de kaart. Coaches kunnen velden bij tegenstanders aanwijzen en fouten melden.

**Niet getest tegen jullie project.** De Firestore-rules staan niet in deze repo. Test ze in de Rules Playground vóór je publiceert. Pas namen aan als jullie hulpfuncties anders heten.

## Wat er wordt opgeslagen

| pad | inhoud | wie schrijft |
| --- | --- | --- |
| `clubs/{clubId}/sportparken/eigen` | eigen sportpark: `naam`, `adres`, `lat`, `lon`, `zoom`, `eigen: true`, `velden` (per veld naam, middelpunt, lengte, breedte, hoek, `splits: { half, kwart }` en namen van de delen), `plekken` (kantine, kleedkamers, ingang, parkeren: soort, naam, punt) | alleen clubbeheer (`clubs.admins`) |
| `clubs/{clubId}/sportparken/p-<naam-plaats>` | sportpark van een tegenstander: zelfde velden, maar per veld alleen een stip met `door: { uid, team }` | elke coach van de club (`clubs.leden`) |
| `clubs/{clubId}/veldmeldingen/{id}` | melding: `park`, `parkNaam`, `veld`, `reden`, `toelichting` (max. 500 tekens), wedstrijddatum, tegenstander, `teamId`, `teamNaam`, `door` (uid), `ms`, `status` | aanmaken: elke coach; lezen en afhandelen: clubbeheer |

Er staan geen spelersgegevens in. Naar buiten gaan alleen het adres of de zoektekst (PDOK, OpenStreetMap Nominatim) en de kaarttegels. De knop "Mijn plek" gebruikt de locatie alleen op het toestel; die wordt nergens opgeslagen of verstuurd.

Release `20261120f` (plekken, half/kwart veld per team) verandert niets aan de regels: alles staat in hetzelfde sportpark-document.

## 1. Regels toevoegen (Firebase-console → Firestore → Rules)

Gebruikt de bestaande hulpfunctie `isEchteGebruiker()`. Zet dit blok binnen `match /databases/{database}/documents`, direct vóór `// ===== Clubs =====`:

```
    // ===== [20261120e] Veldkaart =====
    function vkClub(clubId) {
      return get(/databases/$(database)/documents/clubs/$(clubId)).data;
    }
    function vkIsClubAdmin(clubId) {
      return isEchteGebruiker()
        && vkClub(clubId).get('admins', {}).get(request.auth.uid, false) == true;
    }
    function vkIsClubLid(clubId) {
      return isEchteGebruiker()
        && (vkClub(clubId).get('leden', {}).get(request.auth.uid, false) == true
            || vkClub(clubId).get('admins', {}).get(request.auth.uid, false) == true);
    }

    match /clubs/{clubId}/sportparken/{parkId} {
      allow read: if vkIsClubLid(clubId);
      // Eigen sportpark: alleen clubbeheer. Sportparken van tegenstanders:
      // elke coach van de club mag een veld aanwijzen.
      allow create, update: if (parkId == 'eigen' && vkIsClubAdmin(clubId))
                            || (parkId != 'eigen' && vkIsClubLid(clubId));
      allow delete: if vkIsClubAdmin(clubId);
    }

    match /clubs/{clubId}/veldmeldingen/{meldingId} {
      allow create: if vkIsClubLid(clubId)
                    && request.resource.data.door == request.auth.uid
                    && request.resource.data.status == 'open'
                    && request.resource.data.toelichting is string
                    && request.resource.data.toelichting.size() <= 500;
      allow read, update, delete: if vkIsClubAdmin(clubId);
    }
```

Hebben jullie al een regel `match /clubs/{clubId}/{document=**}` die alles onder een club afsluit of openzet: Firestore combineert regels met OF. Een bredere regel die schrijven toestaat, gaat dus vóór deze.

## 2. Testen in de Rules Playground

1. **Lezen eigen sportpark** als coach (uid staat in `clubs/{clubId}.leden`): `get /clubs/{clubId}/sportparken/eigen` → toegestaan.
2. **Schrijven eigen sportpark** als dezelfde coach → geweigerd. Als clubbeheerder (uid in `admins`) → toegestaan.
3. **Veld aanwijzen** bij een tegenstander als coach: `set /clubs/{clubId}/sportparken/p-test` → toegestaan.
4. **Melding maken** als coach met `door` = eigen uid en `status: 'open'` → toegestaan; met een andere `door` → geweigerd.
5. **Meldingen lezen** als coach → geweigerd; als clubbeheerder → toegestaan.

## 3. Wat er gebeurt zonder deze regels

De app blijft werken. Het veld-label opent de kaart, maar je ziet "geen rechten" en er wordt niets opgeslagen. De Sportpark-tegel bij Club laat dezelfde melding zien.
