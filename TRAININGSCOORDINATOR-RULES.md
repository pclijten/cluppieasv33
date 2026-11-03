# Firestore-rules voor de trainingscoördinator

**Niet getest en niet gedeployd.** De Firestore-rules staan niet in deze repo. Voeg onderstaande toe aan jullie bestaande rules (Firebase Console → Firestore → Rules) en test ze in de Rules Playground vóór je publiceert. Pas de bestaande functies/namen aan waar nodig.

De coördinator mag lezen:
- `clubs/{clubId}` waar `trainingscoordinatoren.<uid> == true`
- `teams/{teamId}` van die club (alleen het teamdocument, **niet** de subcollectie `spelers`)
- `trainingen/{id}` van die club

Schrijven mag hij nergens. Alleen een clubbeheerder zet `trainingscoordinatoren`.

```
function isTraincoVanClub(clubId) {
  return request.auth != null
    && get(/databases/$(database)/documents/clubs/$(clubId)).data.get('trainingscoordinatoren', {}).get(request.auth.uid, false) == true;
}

match /clubs/{clubId} {
  allow read: if (resource.data.get('trainingscoordinatoren', {}).get(request.auth.uid, false) == true) || <bestaande leesregel>;
}
match /teams/{teamId} {
  allow read: if isTraincoVanClub(resource.data.club) || <bestaande leesregel>;
  // spelers-subcollectie: GEEN coördinator-regel toevoegen
}
match /trainingen/{id} {
  allow read: if isTraincoVanClub(resource.data.club) || <bestaande leesregel>;
}
```

Let op: de queries in de app filteren op `club == <clubId>`; de rules moeten daarom op `resource.data.club` controleren (zoals hierboven).
Het veld `clubs.admins` beschermt het schrijven van `trainingscoordinatoren`; controleer dat jullie updateregel voor clubdocumenten dat alleen aan beheerders geeft.
