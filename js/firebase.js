/* ====================================================================
   FIREBASE CONFIG — TESTOMGEVING
   ------------------------------------------------------------------
   Dit is bewust een LEEG/nieuw Firebase-project, los van de productie-
   backend (asv33-21865), zodat je hier veilig kunt testen zonder enig
   risico voor de live clubdata.

   Vervang de placeholders hieronder door de config van je nieuwe project:
   Firebase Console → (nieuw project aanmaken) → Project settings →
   "Your apps" → Web app (</>) toevoegen → kopieer het firebaseConfig-object.

   Vergeet niet in datzelfde nieuwe project:
   1. Authentication → Sign-in method → Google én E-mail/Wachtwoord aanzetten.
   2. Firestore Database aanmaken (production mode, regio europe-west1).
   3. firestore.rules deployen (Firebase CLI: `firebase deploy --only firestore:rules`,
      of plak de inhoud handmatig in Firebase Console → Firestore → Rules).
   4. (optioneel, voor de voetbal.nl-sync) cloud.functions deployen — zie
      LEES-MIJ-DEPLOY.md in de root van deze zip.
==================================================================== */
const firebaseConfig = {
  apiKey: "AIzaSyBA_bCwzw_sggWBo53GiEOdmMahUEFTJLo",
  authDomain: "cluppieasv33.firebaseapp.com",
  projectId: "cluppieasv33",
  storageBucket: "cluppieasv33.firebasestorage.app",
  messagingSenderId: "883305195610",
  appId: "1:883305195610:web:81b08d8a450184404cd063",
  measurementId: "G-N044F9FHBZ"
};

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getAuth, GoogleAuthProvider, OAuthProvider, signInWithPopup, signInAnonymously, updateProfile, signOut, onAuthStateChanged,         signInWithEmailAndPassword, createUserWithEmailAndPassword, sendPasswordResetEmail, fetchSignInMethodsForEmail }
  from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { getFirestore, initializeFirestore, persistentLocalCache, persistentMultipleTabManager,
         collection, doc, addDoc, setDoc, updateDoc, deleteDoc, deleteField, writeBatch,
         getDoc, getDocs, query, where, onSnapshot, serverTimestamp, documentId, increment }
  from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { getStorage, ref as sRef, uploadBytes, getDownloadURL, deleteObject }
  from "https://www.gstatic.com/firebasejs/10.12.2/firebase-storage.js";
import { getFunctions, httpsCallable }
  from "https://www.gstatic.com/firebasejs/10.12.2/firebase-functions.js";

const app  = initializeApp(firebaseConfig);
const auth = getAuth(app);

/* Offline-persistence aan: langs de lijn met slecht of geen bereik blijft de
   app gewoon werken; wijzigingen synchroniseren automatisch zodra er weer
   verbinding is. Valt terug op de gewone modus als persistence niet kan. */
let db;
try {
  db = initializeFirestore(app, {
    localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() })
  });
} catch (e) {
  console.warn('Offline-persistence niet beschikbaar, terugval op standaard:', e);
  db = getFirestore(app);
}

const storage = getStorage(app);
const functions = getFunctions(app, 'europe-west1');

export {
  app, auth, db, storage,
  /* auth */
  GoogleAuthProvider, OAuthProvider, signInWithPopup, signInAnonymously, updateProfile, signOut, onAuthStateChanged,  signInWithEmailAndPassword, createUserWithEmailAndPassword, sendPasswordResetEmail, fetchSignInMethodsForEmail,
  /* firestore */
  collection, doc, addDoc, setDoc, updateDoc, deleteDoc, deleteField, writeBatch,
  getDoc, getDocs, query, where, onSnapshot, serverTimestamp, documentId, increment,
  /* storage */
  sRef, uploadBytes, getDownloadURL, deleteObject,
  /* functions */
  functions, httpsCallable,
};
