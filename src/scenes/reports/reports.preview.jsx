// ─────────────────────────────────────────────────────────────────────────────
// reports.preview.jsx – LOCAL TESTING ONLY. Lets you open the Reports page
// (including file attachments) without the backend, a database, or a real login.
//
// Enable it with a one-line file at the project root (next to package.json)
// named ".env.development.local" containing:
//     REACT_APP_REPORTS_MOCK=true
//   or for a single terminal session (PowerShell):
//     $env:REACT_APP_REPORTS_MOCK="true"; npm start
//   Restart `npm start` after changing it: React only reads env at startup.
//
// Optional: test what other roles see (default is superadmin):
//     REACT_APP_REPORTS_MOCK_ROLE=administrator    (can approve/reject/download, can't delete)
//     REACT_APP_REPORTS_MOCK_ROLE=engineer         (can file reports, nothing else)
//
// What it does when enabled:
//   1. Replaces window.fetch with a mock for the API paths the Reports page and
//      the Sidebar badge use (/reports, /clients, /maintenance). Everything works:
//      file a report, attach files, approve, reject, delete, download. Data lives
//      in memory only and resets on page refresh.
//      Uploaded files are really kept in memory, so "download" gives you back the
//      exact file you attached. This is how you verify the attachment flow.
//   2. Writes a fake login session (fake token + user) to localStorage so the
//      existing route guards let you in. No core file (App.js, auth.jsx,
//      Sidebar.jsx) is modified.
//   3. Shows a small "PREVIEW MODE" badge so you never forget you're not on real data.
//
// Safety:
//   - Requires NODE_ENV === "development", so it is inert in production builds
//     (`npm run build`) and in Jest tests, even if the env var is set.
//   - While the flag is on, it ALWAYS replaces whatever session is in
//     localStorage with the fake one. Real sessions are untouched when it's off.
//   - The fake token is NOT accepted by any real backend; it only satisfies the
//     frontend's expiry check.
//   - Any other API call (not mocked here) gets a 503 instead of reaching a
//     real server, so preview mode can never touch live data.
//   - Logging out clears the session; it is re-seeded on the next page reload.
// ─────────────────────────────────────────────────────────────────────────────

// Same base URL the rest of the app uses, so we intercept exactly its requests.
const API_BASE = process.env.REACT_APP_API_BASE || "http://localhost:5000";

export const isReportsPreview =
  process.env.NODE_ENV === "development" && process.env.REACT_APP_REPORTS_MOCK === "true";

/* =========================================================================
   FAKE SESSION
   ========================================================================= */

// Which role to simulate. Falls back to superadmin if the value is missing/invalid.
const VALID_ROLES = ["superadmin", "administrator", "engineer"];
export const previewRole = VALID_ROLES.includes(process.env.REACT_APP_REPORTS_MOCK_ROLE)
  ? process.env.REACT_APP_REPORTS_MOCK_ROLE
  : "superadmin";

// Superadmins bypass the permissions list (see hasPermission in utils/auth.jsx);
// everyone else needs "reports" in their list to be allowed to file reports.
const PREVIEW_USER = {
  _id: `local-${previewRole}`,
  firstName: "Local",
  surname: previewRole.charAt(0).toUpperCase() + previewRole.slice(1),
  role: previewRole,
  permissions: previewRole === "superadmin" ? [] : ["reports"],
};

// Base64url-encode an object (a JWT segment). Only used to build a fake token.
const b64url = (obj) =>
  btoa(JSON.stringify(obj)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

export const seedReportsPreviewSession = () => {
  if (!isReportsPreview) return;
  try {
    // App.js rejects tokens whose "exp" is in the past, so give it a far-off one.
    const exp = Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 7; // 7 days
    localStorage.setItem("token", `${b64url({ alg: "none", typ: "JWT" })}.${b64url({ exp })}.preview`);
    localStorage.setItem("user", JSON.stringify(PREVIEW_USER));
    // eslint-disable-next-line no-console
    console.info(`[reports preview] signed in as fake ${previewRole} (dev only)`);
  } catch {
    /* storage unavailable, nothing to seed */
  }
};

/* =========================================================================
   MOCK DATA (in memory, resets on refresh)
   ========================================================================= */

const CLIENTS = [
  { _id: "mock-client-1", companyName: "Acme Cement Ltd" },
  { _id: "mock-client-2", companyName: "Lagos Steelworks" },
  { _id: "mock-client-3", companyName: "Sunrise Foods" },
];

const daysAgo = (d) => new Date(Date.now() - d * 24 * 60 * 60 * 1000).toISOString();

// Maps storedName -> Blob so downloads return real file contents.
const fileStore = new Map();

// Best-effort MIME type from a filename, only used for seeded sample files.
const mimeFor = (name) => {
  const ext = name.split(".").pop().toLowerCase();
  return (
    {
      pdf: "application/pdf",
      docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      png: "image/png",
    }[ext] || "application/octet-stream"
  );
};

let idCounter = 100; // for new reports and stored filenames

// Builds one seeded attachment AND stores a tiny sample file behind it,
// so clicking download on seeded reports works too.
const seedAttachment = (name) => {
  const storedName = `seed-${++idCounter}-${name}`;
  const blob = new Blob([`Sample file generated by reports.preview.jsx for "${name}".`], {
    type: mimeFor(name),
  });
  fileStore.set(storedName, blob);
  return { name, storedName, mimetype: blob.type, size: blob.size };
};

// A few reports covering every status and attachment case (several files,
// one file, none, and a type that falls back to the generic icon).
const reports = [
  {
    _id: "mock-report-1",
    reportDetails: "Conveyor belt on line 3 is slipping under load. Tension adjusted twice but the fault returns after about an hour.",
    lineNumber: 3,
    status: "pending",
    rejectionReason: "",
    client: CLIENTS[0],
    user: { _id: "u1", firstName: "Ada", surname: "Obi" },
    attachments: [seedAttachment("line3-inspection.pdf"), seedAttachment("tension-readings.xlsx")],
    createdAt: daysAgo(0.2),
    updatedAt: daysAgo(0.2),
  },
  {
    _id: "mock-report-2",
    reportDetails: "Routine check complete. No faults found. (Legacy-style report: no attachments at all.)",
    lineNumber: 1,
    status: "pending",
    rejectionReason: "",
    client: CLIENTS[1],
    user: { _id: "u2", firstName: "Tunde", surname: "Bello" },
    attachments: [],
    createdAt: daysAgo(1),
    updatedAt: daysAgo(1),
  },
  {
    _id: "mock-report-3",
    reportDetails: "Replaced worn bearing on packing machine and ran a full test cycle without issues.",
    lineNumber: 7,
    status: "approved",
    rejectionReason: "",
    client: CLIENTS[2],
    user: { _id: "u1", firstName: "Ada", surname: "Obi" },
    attachments: [seedAttachment("bearing-replacement.docx")],
    createdAt: daysAgo(3),
    updatedAt: daysAgo(2),
  },
  {
    _id: "mock-report-4",
    reportDetails: "Reported coolant leak at the main pump. Photo attached.",
    lineNumber: 2,
    status: "rejected",
    rejectionReason: "Photo is too blurry to confirm the leak. Please resubmit with a clearer image.",
    client: CLIENTS[0],
    user: { _id: "u2", firstName: "Tunde", surname: "Bello" },
    attachments: [seedAttachment("pump-leak.png")],
    createdAt: daysAgo(5),
    updatedAt: daysAgo(4),
  },
];

/* =========================================================================
   MOCK API
   ========================================================================= */

const LATENCY_MS = 250; // small delay so loading states are visible, like a real server

// Mirrors the server's upload rules (routes/report.js) so error paths can be
// tested too: blocked file types, 100 MB per file, max 20 files.
const BLOCKED = /\.(exe|sh|bat|cmd|ps1|msi|dll|so)$/i;
const MAX_FILE_BYTES = 100 * 1024 * 1024;
const MAX_FILES = 20;

// Mirrors the server-side role checks. The UI already hides/locks controls,
// but the real server enforces these too, so the mock does the same.
const isAdminOrSuper = previewRole === "administrator" || previewRole === "superadmin";
const isSuper = previewRole === "superadmin";

// Build a JSON Response, the shape every real endpoint returns.
const json = (status, body) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

// Deep-copy before returning so the UI can never mutate our "database" by accident.
const clone = (x) => JSON.parse(JSON.stringify(x));

// Remove a report's stored files (what the real DELETE route does on disk).
const dropFiles = (report) =>
  (report.attachments || []).forEach((a) => fileStore.delete(a.storedName));

const handle = async (method, path, init) => {
  // GET /clients: the dropdown on the create-report form
  if (method === "GET" && path === "/clients") return json(200, clone(CLIENTS));

  // GET /maintenance: only the Sidebar's pending-badge calls this
  if (method === "GET" && path === "/maintenance") return json(200, []);

  // GET /reports: newest first, like the real route
  if (method === "GET" && path === "/reports") {
    const sorted = [...reports].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    return json(200, clone(sorted));
  }

  // GET /reports/files/:storedName: download (admin/superadmin only on the real server)
  let m = path.match(/^\/reports\/files\/(.+)$/);
  if (method === "GET" && m) {
    if (!isAdminOrSuper) return json(403, { message: "Access denied." });
    const blob = fileStore.get(decodeURIComponent(m[1]));
    if (!blob) return json(404, { message: "File not found on disk." });
    // The real server streams raw bytes (not JSON); the frontend calls res.blob()
    return new Response(blob, {
      status: 200,
      headers: { "Content-Type": blob.type || "application/octet-stream" },
    });
  }

  // POST /reports: create a report. The frontend sends multipart FormData.
  if (method === "POST" && path === "/reports") {
    const body = init.body;
    const isForm = typeof FormData !== "undefined" && body instanceof FormData;
    const fields = isForm
      ? {
          reportDetails: body.get("reportDetails"),
          lineNumber: body.get("lineNumber"),
          clientId: body.get("clientId"),
        }
      : JSON.parse(body || "{}");
    // Only real File objects count (FormData can also hold plain strings)
    const files = isForm ? body.getAll("files").filter((f) => typeof f !== "string") : [];

    // Same checks as the real route, in the same order
    const blocked = files.find((f) => BLOCKED.test(f.name));
    if (blocked) return json(400, { message: `File type not allowed: ${blocked.name}` });
    if (files.some((f) => f.size > MAX_FILE_BYTES))
      return json(400, { message: "One or more files exceed the 100 MB size limit." });
    if (files.length > MAX_FILES)
      return json(400, { message: "You can attach a maximum of 20 files per report." });

    if (!fields.reportDetails || !fields.lineNumber || !fields.clientId)
      return json(400, { message: "Report details, line number and client are required." });

    const client = CLIENTS.find((c) => c._id === fields.clientId);
    if (!client) return json(400, { message: "Client not found." });

    // Keep each uploaded file in memory under a unique stored name, like multer does on disk
    const attachments = files.map((f) => {
      const storedName = `${Date.now()}-${++idCounter}-${f.name}`;
      fileStore.set(storedName, f); // a File is a Blob, so download returns the exact upload
      return { name: f.name, storedName, mimetype: f.type, size: f.size };
    });

    const now = new Date().toISOString();
    const report = {
      _id: `mock-report-${++idCounter}`,
      reportDetails: String(fields.reportDetails).trim(),
      lineNumber: Number(fields.lineNumber), // FormData sends strings, so convert like the server
      status: "pending",
      rejectionReason: "",
      client,
      user: { _id: PREVIEW_USER._id, firstName: PREVIEW_USER.firstName, surname: PREVIEW_USER.surname },
      attachments,
      createdAt: now,
      updatedAt: now,
    };
    reports.unshift(report);
    return json(201, clone(report));
  }

  // PATCH /reports/:id/approve
  m = path.match(/^\/reports\/([^/]+)\/approve$/);
  if (method === "PATCH" && m) {
    if (!isAdminOrSuper) return json(403, { message: "Access denied." });
    const report = reports.find((r) => r._id === m[1]);
    if (!report) return json(404, { message: "Report not found." });
    report.status = "approved";
    return json(200, clone(report));
  }

  // PATCH /reports/:id/reject
  m = path.match(/^\/reports\/([^/]+)\/reject$/);
  if (method === "PATCH" && m) {
    if (!isAdminOrSuper) return json(403, { message: "Access denied." });
    const report = reports.find((r) => r._id === m[1]);
    if (!report) return json(404, { message: "Report not found." });
    const { reason } = JSON.parse(init.body || "{}");
    report.status = "rejected";
    report.rejectionReason = reason || "";
    return json(200, clone(report));
  }

  // DELETE /reports/:id (superadmin only), also removes the report's files
  m = path.match(/^\/reports\/([^/]+)$/);
  if (method === "DELETE" && m) {
    if (!isSuper) return json(403, { message: "Access denied." });
    const index = reports.findIndex((r) => r._id === m[1]);
    if (index === -1) return json(404, { message: "Report not found." });
    dropFiles(reports[index]);
    reports.splice(index, 1);
    return json(200, { message: "Report deleted." });
  }

  // Anything else on the API: refuse instead of letting it reach a real server
  return json(503, { message: "Preview mode: this endpoint is not mocked." });
};

/* =========================================================================
   INSTALL THE MOCK
   ========================================================================= */

const installMockFetch = () => {
  // Remember the real fetch on `window` so a hot reload (which re-runs this
  // module) doesn't wrap the mock inside itself.
  const realFetch = window.__reportsPreviewRealFetch || window.fetch.bind(window);
  window.__reportsPreviewRealFetch = realFetch;

  window.fetch = async (input, init = {}) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : null;

    // Not an API call (or a Request object we don't handle): use the real fetch
    // (webpack hot-reload and other dev-server traffic still has to work).
    if (!url || !url.startsWith(API_BASE)) return realFetch(input, init);

    const method = (init.method || "GET").toUpperCase();
    const path = url.slice(API_BASE.length).split("?")[0].replace(/\/+$/, "");

    await new Promise((resolve) => setTimeout(resolve, LATENCY_MS));
    return handle(method, path, init);
  };
};

// A small corner badge so it's always obvious you're looking at fake data.
// pointer-events:none means it never blocks clicks on the page underneath.
const showBadge = () => {
  const add = () => {
    const el = document.createElement("div");
    el.textContent = `PREVIEW MODE · ${previewRole} · no backend`;
    el.style.cssText =
      "position:fixed;bottom:8px;left:8px;z-index:99999;padding:3px 10px;" +
      "background:#b45309;color:#fff;font:600 11px sans-serif;border-radius:4px;" +
      "opacity:.9;pointer-events:none;";
    document.body.appendChild(el);
  };
  if (document.body) add();
  else document.addEventListener("DOMContentLoaded", add);
};

// Runs once when this module is first imported. reports.logic.jsx imports it,
// and App.js imports the Reports page at startup, i.e. BEFORE App reads the
// session from localStorage. That ordering is what makes the fake login work.
if (isReportsPreview) {
  seedReportsPreviewSession();
  installMockFetch();
  showBadge();
}