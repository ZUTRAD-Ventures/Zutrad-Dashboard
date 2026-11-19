// ─────────────────────────────────────────────────────────────────────────────
// store.preview.jsx – LOCAL TESTING ONLY. Lets you open the Store page without
// the backend or a real login.
//
// Enable it by starting the dev server with:
//     REACT_APP_STORE_MOCK=true npm start
//   (Windows PowerShell:  $env:REACT_APP_STORE_MOCK="true"; npm start)
//
// REACT_APP_SUPPLY_MOCK=true turns this on too, because the Store and Supply
// pages share one "owed to clients" ledger — previewing either gives you both,
// so you can take stock on Supply and watch it appear on Store.
//
// What it does when enabled:
//   1. store.logic.jsx uses an in-memory parts list instead of /store, and the
//      owed ledger (supply.owed.jsx) is in-memory instead of /supply/owed.
//      Everything works but resets on page refresh.
//   2. A fake superadmin session (fake token + user) is written to
//      localStorage so the existing login/route guards let you in. No core
//      file (App.js, Sidebar.jsx, utils/auth.jsx) is modified for this.
//
// Safety:
//   - Requires NODE_ENV === "development", so it is inert in production
//     builds (`npm run build`) and in Jest tests, even if the env var is set.
//   - While the flag is on, it ALWAYS replaces whatever session is in
//     localStorage with the fake superadmin. Real sessions are not touched
//     when the flag is off.
//   - The fake token is NOT accepted by any real backend; it only satisfies
//     the frontend's expiry check.
//   - Logging out clears it; it is re-seeded on the next page reload.
// ─────────────────────────────────────────────────────────────────────────────

import { isSupplyPreview, seedFakePreviewSession } from "../supply/supply.preview";

export const isStorePreview =
  process.env.NODE_ENV === "development" &&
  (process.env.REACT_APP_STORE_MOCK === "true" || isSupplyPreview);

export const seedStorePreviewSession = () => {
  if (!isStorePreview) return;
  seedFakePreviewSession();
  // eslint-disable-next-line no-console
  console.info("[store preview] signed in as fake superadmin (dev only)");
};

// Runs once when this module is first imported. store.jsx is imported by
// App.js at startup, i.e. BEFORE App reads the session from localStorage.
seedStorePreviewSession();
