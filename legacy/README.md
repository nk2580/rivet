# Rivet · Adventure sheet

A mobile-first, single-page D&D character sheet. Browser-native ES modules, no framework, no build step, no custom server. The app is designed for **Firebase Spark only**: Firebase Authentication, Cloud Firestore and classic static Firebase Hosting.

## What works

- Editable starter for Torren “Rivet” Stonehand, a level-5 Goliath Forge Cleric. Starting values are clearly provisional and must be confirmed with the DM.
- HP, healing, temporary HP, death-save tracking, conditions, exhaustion, inspiration and concentration.
- Configurable abilities, skills and expertise, saves, HP, armour, speed, initiative, hit dice and spell slots.
- Spell preparation, custom spells, slot selection/upcasting, concentration replacement and editable class resources.
- A red, black and white interface with locally hosted Cinzel fantasy headings.
- Manual character tracking, undo, rest controls and an action log. There is no dice roller; abilities, skills, saves and initiative display bonuses only.
- Session journals with editable notes, categories, per-note ChatGPT inclusion and carry-forward notes.
- Explicit, inspectable character + session context copied for use in ChatGPT.
- Local autosave, local draft recovery, JSON export/import, PWA manifest and offline app-shell caching.
- Firebase email/password and Google authentication plus owner-scoped cloud records when configured.
- Debounced writes and revision checks. Concurrent device edits produce a choice rather than silently overwriting another device.

## Integration status and the hard constraint

**Embedded ChatGPT sign-in, in-app model replies and programmatic Fast mode are not implemented.** The app prepares context, copies it to the clipboard, and opens ChatGPT in another tab. The user signs in, pastes the context and selects their response mode there. No prompt is put in a URL and nothing is sent to an AI API by this app.

As verified on 22 October 2026:

- [Website Sign in with ChatGPT](https://developers.openai.com/siwc/website) is a limited trial for selected commercial partners. Identity permission is separate from model-plan usage.
- [Open-source ChatGPT plan usage registration](https://developers.openai.com/siwc/token-sharing-open-source/sign-in) requires a local HTTP loopback callback listener on `127.0.0.1`. A mobile-only browser app cannot host that listener.
- [Firebase Spark](https://firebase.google.com/docs/projects/billing/firebase-pricing-plans) does not provide Cloud Functions. Do not upgrade to Blaze or add another backend to conceal this incompatibility.

An approved browser integration would need to be separately designed and verified if access becomes available. Do not insert an API key, client secret, partner secret or copied OAuth token into the SPA. The private Sites preview's access gate is not an embedded ChatGPT model integration and is not part of the Firebase-hosted app.

**Firebase was not connected in this build session.** The adapter and security rules are included; real account login, security-rule enforcement and cross-device sync have not been exercised against a live project. Local functionality does not depend on Firebase being configured.

## Run locally

From the project directory:

```bash
python3 -m http.server 8080 --directory dist
```

Open `http://localhost:8080`. Production needs HTTPS for service workers and clipboard access. Localhost is normally treated as a secure development origin. No npm dependencies are required to run the app. Google Firebase modules are loaded from the official CDN, pinned to version 13.1.0, only when a Firebase project is configured.

## Deploy exclusively to Firebase's free Spark plan

1. Create or select a Firebase project. Keep **Spark** selected; do **not** link a billing account.
2. Register a **Web app** in Project settings. Copy the public Firebase configuration into `dist/firebase-config.js`:

   ```js
   export const firebaseConfig = {
     apiKey: "YOUR_PUBLIC_FIREBASE_WEB_KEY",
     authDomain: "YOUR_PROJECT_ID.firebaseapp.com",
     projectId: "YOUR_PROJECT_ID",
     appId: "YOUR_WEB_APP_ID"
   };
   ```

   This is the Firebase client configuration, not an administrative service-account key. You can alternatively paste the JSON config into the app's **Connections → Firebase configuration** screen; that setting applies only to that browser. Bundled config works on every device. An explicit browser configuration overrides the bundled default on that device.
3. Enable **Authentication → Sign-in method → Email/Password** and optionally Google. Avoid phone/SMS authentication. Add your Firebase Hosting domain to Authorized domains; add `localhost` only if developing locally. Do not enable Identity Platform/OIDC for this implementation.
4. Create the **default Cloud Firestore database in Standard/native mode**, choosing a region. Start in production mode and deploy the included rules before signing in to the app.
5. Using a recent Node.js installation, authenticate and deploy just the two included services:

   ```bash
   npx firebase-tools login
   npx firebase-tools deploy --project YOUR_PROJECT_ID --only firestore:rules,hosting
   ```

   `firebase.json` contains static Hosting and Firestore rules only. No Functions, Cloud Run, Storage, extensions or App Hosting are configured. The source ZIP's `.openai` directory is intentionally omitted; it is not required for Firebase.
6. Open your Firebase Hosting URL. Sign in via **Connections**. Choose **Use this device's guest sheet** if you want to transfer local play into the signed-in account; otherwise edit or explicitly sync the account's sheet. A pre-existing cloud sheet loads automatically. New signed-in accounts do not silently adopt another account's local data.
7. On your phone, use **Add to Home Screen**. Load once online before offline play. Keep a JSON backup when switching domains: browser storage is origin-specific, so data does not automatically move from the Sites preview to Firebase Hosting. Export in the preview and import on the Firebase URL.

No Firebase resources have been created by this repository. The Firebase console controls the actual billing plan; code cannot guarantee the project remains Spark if someone changes it outside the app. When a Spark quota is exhausted, cloud operations pause rather than this app upgrading the plan.

## Saving and synchronization

- Local storage is keyed separately for guest and each Firebase user ID. Do not rely on browser storage as the only backup: OS storage pressure, private browsing or clearing site data can remove it.
- Firestore uses `/users/{uid}/sheets/main`, containing `schemaVersion`, JSON `payload`, incrementing `revision` and a server `updatedAt` timestamp. Rules deny other users and other paths; creates start at revision 1 and updates must increment exactly once.
- One debounced write follows a burst of changes. Cloud updates use a Firestore transaction and compare the expected revision. Failed/offline saves remain marked pending in local storage and retry on reconnection or explicit sync.
- A new cloud version while this device has unsynced changes prompts an explicit choice. This is whole-sheet conflict resolution, not collaborative text merging. A recovery copy is retained before replacement.
- The Firestore client uses a memory cache. Durable offline saving is handled by the app rather than a persistent shared Firestore cache. Signing out keeps local per-account saves unless **Clear saved data on this device** is selected.
- App data is capped at 650 KB of UTF-8 JSON; Firestore rules accept less than 700,000 characters. Maximums: 100 sessions, 300 notes per session, 10,000 characters per note, 200 spells. Export and remove older material if approaching the cap. No attachments or Firebase Storage are required.
- Game events and prepared question history are bounded. Undo is limited to 20 changes in the current tab and resets on reload or cloud replacement.

## Rules behavior

The starter follows 2024 values where implemented and labels the DM-approved legacy subclass explicitly. It is not a full rules engine. Slot totals are manual to support multiclassing and house rules; changing level does not silently rebuild your spellbook or equipment.

Damage is entered **after resistance/vulnerability**. Temporary HP absorb damage first. Concentration reminders use the full damage amount, a minimum DC of 10, half damage rounded down, and the 2024 maximum DC of 30. Reaching zero ends concentration; death saves, massive damage and unconsciousness require DM review. Healing clears death saves. The app does not silently remove user-tracked conditions when healed.

2024 long rests restore HP, all hit dice, slots and configured eligible resources, clear temporary HP and concentration, and reduce exhaustion by one. Review maximum-HP reductions, ability reductions, eligibility, duration and other special effects manually. Short rests record the number of Hit Dice spent and the total healing you enter, including Constitution, and restore configured resources. Roll at your table and enter the result manually. Advantage, War Caster and exhaustion penalties are not inferred automatically.

See `dist/LICENSES.txt` for SRD attribution. Spell summaries are brief, editable aids, not a replacement for full spell text or DM rulings.

## Verification

```bash
npm test
npm run check
```

Eleven Node tests cover HP bounds, temporary HP, concentration reminders, spell exhaustion, manually entered rest healing, note-context isolation, import validation and Firebase transaction revision behavior. Firebase transaction tests use an in-memory test double and do not validate live service access or deployed rules.

Browser QA covers desktop and a 390px phone viewport: damage/undo, casting with slot tracking, journal notes surviving reload, context preparation, editable forms and manual short rests. The revised layout has also been checked for horizontal overflow at phone width. Real Firebase login/sync and real-device PWA installation remain environment-dependent checks after project setup.

## Files

- `dist/index.html`, `styles.css`, `app.js`: the single-page interface.
- `dist/model.js`: character state, validation, game actions and context assembly.
- `dist/firebase.js`: lazy Firebase Auth and Firestore adapter.
- `dist/firebase-config.js`: public configuration, unset in the delivered version.
- `dist/sw.js`, `manifest.webmanifest`, icons: offline shell and install metadata.
- `dist/fonts/`: locally hosted Cinzel and Cinzel Decorative fonts and their SIL Open Font Licenses.
- `firebase.json`, `firestore.rules`: Spark-compatible deployment and data isolation.
- `tests/model.test.mjs`: executable core behavior checks.

The private Sites publication is a static preview. Its application data backend is not a Sites database or Worker. Deploying the same `dist/` folder through `firebase.json` hosts the complete app on Firebase.
