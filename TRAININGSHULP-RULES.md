# Firestore-rules: Trainingshulp (Lijstjes)

Sinds release `20261118a` heeft Lijstjes een vijfde startpunt: **Trainingshulp**. Ouders schrijven zich via een link zelf in als helper bij een training, zonder Cluppie-account.

**Niet getest tegen jullie project.** De Firestore-rules staan niet in deze repo. De app is getest met een nagebootste database; de regels hieronder zijn daarbij niet uitgevoerd. Test ze in de Rules Playground (stap 3) vóór je publiceert.

## Wat er wordt opgeslagen

| pad | inhoud | wie leest |
| --- | --- | --- |
| `teams/{teamId}/lijsten/{id}` | de kaart in Lijstjes: `naam`, `sjabloon: 'trainingshulp'`, `rijen: 'trainingen'`, `hulpDeelId` | de staf (bestaande regel) |
| `hulpDeel/{deelId}` | `teamId`, `lijstId`, `teamNaam`, `titel`, `open`, `standaard`, `momenten` (per training: `datum`, `start`, `eind`, `nodig`) | de staf altijd; iedereen met de link zolang `open == true` |
| `hulpDeel/{deelId}/aanmeldingen/{id}` | één helper bij één training: `uid`, `rij`, `naam` (voornaam), `ms`, `door` (`'ouder'` of `'coach'`) | idem |

Een ouder logt anoniem in (zoals bij de trainings-deellink) en schrijft onder het vaste id `<uid>_<rij>`: één aanmelding per training per toestel. Er staan geen spelers of andere teamgegevens in `hulpDeel`.

## 1. Regel toevoegen (Firebase-console → Firestore → Rules)

Gebruikt de bestaande hulpfuncties `isEchteGebruiker()` en `isTeamMember()`. Zet dit blok binnen `match /databases/{database}/documents`, direct vóór `// ===== Clubs =====`:

```
    // ===== [20261118a] Trainingshulp (Lijstjes) =====
    // Ouders schrijven zich via een link (?hulp=<deelId>) in als helper bij
    // een training. Top-level, zodat een ouder niets van teams/{teamId} hoeft
    // te lezen. Alleen 'get' op het document: de collectie doorzoeken kan
    // niemand, je moet de link (het id) hebben.
    match /hulpDeel/{deelId} {
      // Staf altijd; iedereen met de link (ook anoniem) zolang de link aan staat.
      allow get: if request.auth != null
                 && (resource.data.open == true
                     || (isEchteGebruiker() && isTeamMember(resource.data.teamId)));
      allow create: if isEchteGebruiker()
                    && request.resource.data.teamId is string
                    && isTeamMember(request.resource.data.teamId);
      // Aanpassen (aantal helpers, trainingen, link aan/uit): alleen de staf,
      // en het team kan niet veranderen.
      allow update: if isEchteGebruiker()
                    && isTeamMember(resource.data.teamId)
                    && request.resource.data.teamId == resource.data.teamId;
      allow delete: if isEchteGebruiker()
                    && isTeamMember(resource.data.teamId);

      match /aanmeldingen/{aanmId} {
        function deel() {
          return get(/databases/$(database)/documents/hulpDeel/$(deelId)).data;
        }
        function isStaf() {
          return isEchteGebruiker() && isTeamMember(deel().teamId);
        }
        allow read: if request.auth != null
                    && (deel().open == true || isStaf());
        // Aanmaken: alleen de vijf bekende velden, op eigen uid, een voornaam
        // van hooguit 24 tekens, bij een training die in de lijst staat.
        // - ouder: alleen als de link aan staat, en alleen onder het vaste id
        //   <uid>_<rij> (dus één aanmelding per training per toestel);
        // - coach: de staf van het team.
        allow create: if request.auth != null
                      && request.resource.data.keys().hasOnly(['uid', 'rij', 'naam', 'ms', 'door'])
                      && request.resource.data.uid == request.auth.uid
                      && request.resource.data.naam is string
                      && request.resource.data.naam.size() > 0
                      && request.resource.data.naam.size() <= 24
                      && request.resource.data.rij is string
                      && request.resource.data.rij in deel().momenten
                      && (
                           (request.resource.data.door == 'ouder'
                            && deel().open == true
                            && aanmId == request.auth.uid + '_' + request.resource.data.rij)
                           || (request.resource.data.door == 'coach' && isStaf())
                         );
        allow update: if false;
        // Weghalen: de ouder zijn eigen aanmelding, de staf elke aanmelding.
        allow delete: if request.auth != null
                      && (resource.data.uid == request.auth.uid || isStaf());
      }
    }
```

## 2. Wat de regels niet afdwingen

- **Vol is vol** controleert de app, niet de database. Schrijven twee ouders zich in dezelfde seconde in op de laatste plek, dan staan er even drie namen bij twee plekken. De coach haalt er één weg of zet het aantal op drie.
- **Eén aanmelding per training per toestel.** Een ouder die op een tweede telefoon of in een privévenster de link opent, krijgt een nieuwe anonieme sessie en kan zich nog eens inschrijven. Afmelden kan alleen op het toestel waarmee is ingeschreven, of via de coach.
- Wie de link heeft, kan elke voornaam invullen. Er is geen controle dat het een ouder van het team is.

## 3. Testen in de Rules Playground

| als | actie | pad | verwacht |
| --- | --- | --- | --- |
| anoniem ingelogd | get | `hulpDeel/<id>` met `open: true` | toegestaan |
| anoniem ingelogd | get | `hulpDeel/<id>` met `open: false` | geweigerd |
| anoniem ingelogd | get | `teams/<teamId>` | geweigerd |
| anoniem ingelogd | create | `hulpDeel/<id>/aanmeldingen/<uid>_d20261123` met `door: 'ouder'` en eigen `uid` | toegestaan |
| anoniem ingelogd | create | idem, maar met `door: 'coach'` of een ander id | geweigerd |
| coach van het team | update | `hulpDeel/<id>` | toegestaan |
| coach van een ander team | get | `hulpDeel/<id>` met `open: false` | geweigerd |

## 4. Volgorde

1. Eerst de regel publiceren.
2. Daarna de PR mergen.

Staat de app al live zonder deze regel, dan werkt de rest van Lijstjes gewoon. Alleen het aanmaken van een Trainingshulp-lijst geeft de melding dat de rules nog gepubliceerd moeten worden.
