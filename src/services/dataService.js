import { collection, getDocs } from "firebase/firestore";
import { db, hasFirebaseConfig } from "./firebaseClient.js";

async function loadFromFirestore() {
  if (!hasFirebaseConfig || !db) {
    return null;
  }
  const snap = await getDocs(collection(db, "whiskeys"));
  const rows = snap.docs.map((d) => d.data());
  return rows.length ? rows : null;
}

async function loadFromLocalJson() {
  const resp = await fetch("/data/whiskeys.seed.json");
  if (!resp.ok) {
    throw new Error("Could not load local seed data from /data/whiskeys.seed.json");
  }
  const payload = await resp.json();
  return payload.bottles || [];
}

export async function loadWhiskeys() {
  try {
    const fromFirebase = await loadFromFirestore();
    if (fromFirebase && fromFirebase.length) {
      return fromFirebase;
    }
  } catch (_err) {
    // If Firebase fails, continue with local seed data to keep the app running.
  }

  return loadFromLocalJson();
}
