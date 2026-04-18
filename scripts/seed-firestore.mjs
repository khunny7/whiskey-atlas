import { readFile } from "node:fs/promises";
import process from "node:process";
import { applicationDefault, cert, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

const projectId =
  process.env.FIREBASE_PROJECT_ID ||
  process.env.VITE_FIREBASE_PROJECT_ID ||
  "whiskey-atlas";

function resolveCredential() {
  const serviceAccountJson = process.env.FIREBASE_SERVICE_ACCOUNT_KEY_JSON;
  if (serviceAccountJson) {
    return cert(JSON.parse(serviceAccountJson));
  }
  return applicationDefault();
}

async function loadSeedBottles() {
  const raw = await readFile("data/whiskeys.seed.json", "utf8");
  const payload = JSON.parse(raw);
  return payload.bottles || [];
}

function chunk(items, size) {
  const out = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(items.slice(i, i + size));
  }
  return out;
}

async function main() {
  initializeApp({
    credential: resolveCredential(),
    projectId
  });

  const db = getFirestore();
  const bottles = await loadSeedBottles();

  if (!bottles.length) {
    console.log("No bottles found in data/whiskeys.seed.json");
    return;
  }

  const batches = chunk(bottles, 400);

  for (const group of batches) {
    const batch = db.batch();

    for (const bottle of group) {
      const docId = bottle.slug || `${bottle.distilleryName}-${bottle.name}`.toLowerCase().replace(/[^a-z0-9]+/g, "-");
      batch.set(db.collection("whiskeys").doc(docId), bottle, { merge: true });
    }

    await batch.commit();
  }

  console.log(`Seeded ${bottles.length} whiskey records into Firestore project ${projectId}.`);
}

main().catch((err) => {
  console.error("Failed to seed Firestore:", err.message);
  process.exitCode = 1;
});
