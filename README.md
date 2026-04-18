# Whiskey Map MVP (Firebase-ready)

This is a runnable MVP for your interactive American whiskey map with:

- tree-style exploration: company -> distillery -> bottle
- filters for category, price, proof, and text search
- recommendations by conditions
- recommendations from selected bottles
- Firebase Firestore support with automatic fallback to local seed JSON

## 1) Run locally

1. Install dependencies:

```bash
npm install
```

2. Start the app:

```bash
npm run dev
```

3. Open the local URL shown by Vite (usually `http://localhost:5173`).

## 2) Should you use Firebase?

For your current stage, Firebase is a good choice if you want:

- quick launch
- managed backend
- simple hosting and auth later
- straightforward document reads for 50-500 bottles

If you later need heavy relational analytics, PostgreSQL may still be better for reporting and complex joins.

## 3) How to set up Firebase for this project

1. Create a Firebase project in Firebase Console.
2. Enable Firestore Database.
3. Create a web app in your Firebase project.
4. Copy `.env.example` to `.env` and fill in your Firebase values.
5. Create a Firestore collection named `whiskeys`.
6. Import records from `data/whiskeys.seed.json` into that collection.

Each document can match a bottle object from the seed file.

## 4) Firestore shape

Collection:

- `whiskeys`

Document fields example:

- `name` (string)
- `slug` (string)
- `category` (string)
- `companyName` (string)
- `distilleryName` (string)
- `state` (string)
- `msrpUsd` (number|null)
- `proof` (number|null)
- `ageStatementYears` (number|null)
- `mashBillText` (string|null)
- `mashBillKnown` (boolean)
- `flavorTags` (array of strings)
- `availability` (string)

## 5) Security rules (starter only)

Use read-only public rules for MVP browsing:

```txt
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /whiskeys/{docId} {
      allow read: if true;
      allow write: if false;
    }
  }
}
```

Tighten rules before production writes.
