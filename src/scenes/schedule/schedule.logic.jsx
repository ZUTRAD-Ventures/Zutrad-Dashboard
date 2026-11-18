import { useState, useMemo, useEffect, useRef, useCallback } from "react";
import { getToken, isAdminOrSuper } from "../../utils/auth";
import { isSchedulePreview } from "./schedule.preview";

const API_BASE = process.env.REACT_APP_API_BASE || "http://localhost:5000";

/* =========================================================================
   ██████  BACKEND INTEGRATION GUIDE — SCHEDULE PAGE  ██████

   STATUS: FRONTEND IMPLEMENTED — BACKEND NOT IMPLEMENTED.
   The backend source is not part of this codebase drop, so NONE of the
   endpoints below exist yet. This file calls them exactly as documented, so
   the page will show its error state ("Failed to load schedules") until the
   backend is built. For UI-only previews there is an opt-in mock mode
   (REACT_APP_SCHEDULE_MOCK=true with `npm start`, see schedule.preview.jsx). Mock
   mode keeps data in memory only; it does NOT enforce permissions or the
   21-day rule and must never be used in production.

   ─────────────────────────────────────────────────────────────────────────
   1. DATABASE — new collection/table: `schedules`
      (Mongo/Mongoose style, matching the existing `reports` model)

        title        String,   required, trimmed, 3–120 chars
        description  String,   optional, trimmed, max 1000 chars
        assignedTo   ObjectId → User, required (the responsible person)
        dueDate      Date,     required
        status       String,   enum ["pending","completed"], default "pending"
        createdBy    ObjectId → User, required, set FROM THE JWT, never from the body
        createdAt    Date,     auto (timestamps: true)
        updatedAt    Date,     auto
        completedAt  Date,     null until completed. Set by the SERVER (new Date()),
                               never accepted from the client.
        completedBy  ObjectId → User, null until completed. Set from the JWT.
        archivedAt   Date,     null until the cleanup job archives the record
                               (see section 4).

      Indexes: { status: 1, completedAt: 1 }, { archivedAt: 1 }, { assignedTo: 1 }

      Records are NEVER hard-deleted by this feature. There is intentionally
      no DELETE or edit endpoint: completed/archived rows are the audit trail.

   ─────────────────────────────────────────────────────────────────────────
   2. ENDPOINTS — all require a valid JWT (same auth middleware as /reports)
      and an ADMIN-ONLY role guard (role === "administrator" || "superadmin").
      Return 403 for every other role. Hiding UI is not enough — the guard
      must live in the route middleware, e.g. router.use(auth, requireAdmin).

      GET   /schedules
            Returns the ACTIVE list only:
              - every status:"pending" schedule (never auto-removed), plus
              - every status:"completed" schedule with
                    completedAt >= now - 21 days   AND   archivedAt == null
            Filter by completedAt, NOT createdAt. Populate assignedTo,
            createdBy and completedBy with { _id, firstName, surname }.
            Sort in the DB or leave to the client (the client sorts too).
            Evaluate the 21-day cutoff on every request, so a completed row
            disappears on time even if the cleanup job is late or down.

      POST  /schedules
            Body: { title, description?, assignedTo, dueDate }
            - Validate: title required/length, description length,
              assignedTo is a valid ObjectId of an EXISTING, ACTIVE user,
              dueDate is a valid ISO date and not in the past.
            - Server sets createdBy = req.user.id, status = "pending",
              completedAt = null, completedBy = null.
            - IGNORE any status/createdBy/completedAt/completedBy sent by the
              client (mass-assignment protection): whitelist the 4 fields above.
            - Respond 201 with the populated schedule document.

      PATCH /schedules/:id/complete
            No body needed.
            - Validate :id is a valid ObjectId; 404 if not found.
            - 409 if already completed (do not overwrite the original
              completedAt/completedBy — that would corrupt the audit trail).
            - Do it atomically so two admins cannot both "win":
                findOneAndUpdate(
                  { _id, status: "pending" },
                  { status: "completed", completedAt: new Date(),
                    completedBy: req.user.id },
                  { new: true })
            - Respond 200 with the populated schedule document.
            - Note: there is deliberately no "un-complete" endpoint.

      GET   /auth/users  (ALREADY EXISTS — used by All Users page)
            Used here to fill the "Assigned to" dropdown. Confirm that
            administrators (not only superadmins) are allowed to call it. If
            the endpoint is later restricted, add a lighter
            GET /schedules/assignees returning [{ _id, firstName, surname }]
            for active users only.

   ─────────────────────────────────────────────────────────────────────────
   3. SECURITY / VALIDATION CHECKLIST
      - Role guard on every /schedules route (403 otherwise) — non-admins
        must not be able to read, create, or complete schedules.
      - Take identity (createdBy / completedBy) from the verified JWT only.
      - Whitelist body fields; reject unknown fields.
      - Validate ObjectIds (avoid "Cast to ObjectId failed" 500s, as hit on
        reports) and return clean 400/404 JSON: { message: "..." }.
      - Escape/limit text lengths; the React UI escapes output, but the API
        must not trust the client.
      - Rate-limit POST/PATCH like other write routes.
      - Write an audit log entry (who/what/when) for create + complete if
        the app has an audit mechanism.

   ─────────────────────────────────────────────────────────────────────────
   4. 21-DAY AUTOMATIC REMOVAL (server-side)
      Rule: a completed schedule stays visible for 21 days after completedAt,
      then leaves the active Schedule page. Pending schedules never expire.

      Two layers (both server-side):
        a) Query filter in GET /schedules (see above). This is the source of
           truth for visibility and is exact to the second.
        b) Scheduled cleanup job (node-cron / agenda / DB scheduler), e.g.
           daily at 02:00 server time:
              Schedule.updateMany(
                { status: "completed", archivedAt: null,
                  completedAt: { $lte: new Date(Date.now() - 21*24*60*60*1000) } },
                { $set: { archivedAt: new Date() } })
           This ARCHIVES (soft-removes), it does not delete, so history
           remains for audits. Optionally expose a super-admin-only
           GET /schedules/archive for viewing history in future.
      The frontend also hides completed items older than 21 days as a
      defence-in-depth measure (see isVisible below), but it is NOT a
      substitute for the server-side logic.
   ========================================================================= */

/* =========================================================================
   CONFIG
   ========================================================================= */

// Must match the backend retention window (section 4 above).
export const COMPLETED_RETENTION_DAYS = 21;
const DAY_MS = 24 * 60 * 60 * 1000;

export const STATUS_TABS = ["all", "pending", "overdue", "completed"];

const TITLE_MAX = 120;
const DESCRIPTION_MAX = 1000;
export { TITLE_MAX, DESCRIPTION_MAX };

// DEV-ONLY preview switch. Off by default. When "true", no network calls are
// made and data lives in memory (resets on refresh). NOT real functionality.
const USE_MOCK = isSchedulePreview; // see schedule.preview.jsx (dev-server only)

const authHeaders = () => ({
  "Content-Type": "application/json",
  Authorization: `Bearer ${getToken()}`,
});

/* =========================================================================
   PURE HELPERS
   ========================================================================= */

// Mongo gives `_id`; the UI uses `id` (same normalisation as reports).
const normalizeSchedule = (s) => ({ ...s, id: s._id ?? s.id });
const normalizeUser = (u) => ({ ...u, id: u._id ?? u.id });

export const fullName = (u) => (u ? `${u.firstName ?? ""} ${u.surname ?? ""}`.trim() || "—" : "—");

// Local-calendar "YYYY-MM-DD" for a date (used for "today" comparisons).
const localDateKey = (d) => {
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

// Due dates are sent as noon-UTC (see handleSubmit) so the calendar day is
// the same in every timezone from UTC-12 to UTC+11. We therefore read the due
// date's day in UTC, and compare it with today's LOCAL day.
const dueKey = (dueDate) => {
  const d = new Date(dueDate);
  return isNaN(d.getTime()) ? "" : d.toISOString().slice(0, 10);
};

export const isOverdue = (s, now = new Date()) =>
  s.status === "pending" && !!dueKey(s.dueDate) && dueKey(s.dueDate) < localDateKey(now);

export const isDueToday = (s, now = new Date()) =>
  s.status === "pending" && dueKey(s.dueDate) === localDateKey(now);

// When a completed schedule will leave the active page.
export const removalDate = (s) =>
  s.completedAt ? new Date(new Date(s.completedAt).getTime() + COMPLETED_RETENTION_DAYS * DAY_MS) : null;

// Whole days left before auto-removal (min 0). null for pending items.
export const daysUntilRemoval = (s, now = new Date()) => {
  const r = removalDate(s);
  if (!r) return null;
  return Math.max(0, Math.ceil((r.getTime() - now.getTime()) / DAY_MS));
};

// Defence-in-depth only — the BACKEND must already exclude these rows.
// Pending always shown; completed shown until completedAt + 21 days.
export const isVisible = (s, now = new Date()) => {
  if (s.status !== "completed") return true;
  const r = removalDate(s);
  return !r || r.getTime() > now.getTime();
};

// Colours keyed by display state, mirroring statusStyles in reports.logic.
export const statusStyles = (state, colors) => {
  if (state === "completed") return { bg: colors.greenAccent[700], text: colors.greenAccent[300], border: colors.greenAccent[600] };
  if (state === "overdue") return { bg: colors.redAccent[700], text: colors.redAccent[300], border: colors.redAccent[500] };
  return { bg: colors.blueAccent[700], text: colors.blueAccent[200], border: colors.blueAccent[500] };
};

export const getDisplayState = (s) => (s.status === "completed" ? "completed" : isOverdue(s) ? "overdue" : "pending");

export const getTabColor = (tab, colors) => {
  if (tab === "pending") return colors.blueAccent[400];
  if (tab === "overdue") return colors.redAccent[400];
  if (tab === "completed") return colors.greenAccent[400];
  return colors.grey[300];
};

// Pending first (soonest due first), then completed (most recent first).
const sortSchedules = (list) =>
  [...list].sort((a, b) => {
    if (a.status !== b.status) return a.status === "pending" ? -1 : 1;
    if (a.status === "pending") return new Date(a.dueDate) - new Date(b.dueDate);
    return new Date(b.completedAt) - new Date(a.completedAt);
  });

/* =========================================================================
   API LAYER — real calls documented in the guide above, or in-memory mock.
   ========================================================================= */

const apiFetch = async (path, options = {}) => {
  const res = await fetch(`${API_BASE}${path}`, { headers: authHeaders(), ...options });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.message || `Request failed (HTTP ${res.status}).`);
    err.status = res.status;
    throw err;
  }
  return data;
};

// ── mock store (preview only) ───────────────────────────────────────────────
const mockUsers = [
  { _id: "u1", firstName: "Ada", surname: "Okafor", role: "engineer" },
  { _id: "u2", firstName: "Tunde", surname: "Bello", role: "engineer" },
  { _id: "u3", firstName: "Ngozi", surname: "Eze", role: "receptionist" },
];
const daysAgo = (n) => new Date(Date.now() - n * DAY_MS).toISOString();
const daysFromNow = (n) => new Date(Date.now() + n * DAY_MS).toISOString();
let mockSchedules = [
  { _id: "s1", title: "Service Line 4 compressor", description: "Check oil and belt tension.", assignedTo: mockUsers[0], dueDate: daysFromNow(3), status: "pending", createdBy: mockUsers[2], createdAt: daysAgo(2), completedAt: null, completedBy: null },
  { _id: "s2", title: "Submit weekly site report", description: "", assignedTo: mockUsers[1], dueDate: daysAgo(2), status: "pending", createdBy: mockUsers[2], createdAt: daysAgo(9), completedAt: null, completedBy: null },
  { _id: "s3", title: "Restock spare filters", description: "Count and log in Store.", assignedTo: mockUsers[1], dueDate: daysAgo(10), status: "completed", createdBy: mockUsers[2], createdAt: daysAgo(15), completedAt: daysAgo(18), completedBy: mockUsers[2] },
  { _id: "s4", title: "Old completed task (hidden)", description: "", assignedTo: mockUsers[0], dueDate: daysAgo(40), status: "completed", createdBy: mockUsers[2], createdAt: daysAgo(45), completedAt: daysAgo(30), completedBy: mockUsers[2] },
];
const delay = (ms = 300) => new Promise((r) => setTimeout(r, ms));

const api = {
  async list() {
    if (USE_MOCK) { await delay(); return mockSchedules; }
    return apiFetch("/schedules"); // GET /schedules — see guide §2
  },
  async assignees() {
    if (USE_MOCK) { await delay(100); return mockUsers; }
    return apiFetch("/auth/users"); // existing endpoint — see guide §2
  },
  async create(payload, me) {
    if (USE_MOCK) {
      await delay();
      const assignee = mockUsers.find((u) => u._id === payload.assignedTo) || mockUsers[0];
      const row = { _id: `s${Date.now()}`, ...payload, assignedTo: assignee, status: "pending", createdBy: me, createdAt: new Date().toISOString(), completedAt: null, completedBy: null };
      mockSchedules = [row, ...mockSchedules];
      return row;
    }
    // POST /schedules { title, description, assignedTo, dueDate } — guide §2
    return apiFetch("/schedules", { method: "POST", body: JSON.stringify(payload) });
  },
  async complete(id, me) {
    if (USE_MOCK) {
      await delay();
      const row = { ...mockSchedules.find((s) => s._id === id), status: "completed", completedAt: new Date().toISOString(), completedBy: me };
      mockSchedules = mockSchedules.map((s) => (s._id === id ? row : s));
      return row;
    }
    // PATCH /schedules/:id/complete — server stamps completedAt/completedBy (guide §2)
    return apiFetch(`/schedules/${id}/complete`, { method: "PATCH" });
  },
};

/* =========================================================================
   MAIN HOOK
   ========================================================================= */

const EMPTY_FORM = { title: "", description: "", assignedTo: "", dueDate: "" };

export const useSchedulePage = () => {
  // ── permission flag ────────────────────────────────────────────────────────
  // Frontend gate only (UX + defence in depth). The route is also wrapped in
  // protectAdmin (App.js). The REAL enforcement must be the role guard on the
  // backend /schedules routes (see guide §2/§3).
  const canManage = isAdminOrSuper();

  const [schedules, setSchedules] = useState([]);
  const [assignees, setAssignees] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");

  const [formOpen, setFormOpen] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [formError, setFormError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const [search, setSearch] = useState("");
  const [activeTab, setActiveTab] = useState("all");
  const [toast, setToast] = useState({ open: false, message: "", severity: "success" });

  const [errorDialog, setErrorDialog] = useState({ open: false, title: "", message: "" });
  const closeErrorDialog = () => setErrorDialog({ open: false, title: "", message: "" });
  const showErrorDialog = (title, message) => setErrorDialog({ open: true, title, message });

  const [confirmDialog, setConfirmDialog] = useState({ open: false, title: "", message: "" });
  const confirmDialogAction = useRef(null);
  const [completingId, setCompletingId] = useState(null);

  const showToast = (message, severity = "success") => setToast({ open: true, message, severity });
  const closeToast = () => setToast((t) => ({ ...t, open: false }));

  const denyAccess = (action) =>
    showErrorDialog("Access Denied", `Only administrators and superadmins can ${action}.`);

  // ── load ───────────────────────────────────────────────────────────────────
  const fetchSchedules = useCallback(async () => {
    setLoading(true);
    setLoadError("");
    try {
      const [list, users] = await Promise.all([
        api.list(),
        // Assignee list failing must not block viewing schedules.
        api.assignees().catch(() => []),
      ]);
      setSchedules(list.map(normalizeSchedule));
      setAssignees(users.map(normalizeUser));
    } catch (err) {
      setLoadError(err.message || "Failed to load schedules.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (canManage) fetchSchedules();
    else setLoading(false);
  }, [canManage, fetchSchedules]);

  // ── derived data ───────────────────────────────────────────────────────────
  const visible = useMemo(() => sortSchedules(schedules.filter((s) => isVisible(s))), [schedules]);

  const counts = useMemo(() => ({
    all: visible.length,
    pending: visible.filter((s) => s.status === "pending").length,
    overdue: visible.filter((s) => isOverdue(s)).length,
    completed: visible.filter((s) => s.status === "completed").length,
  }), [visible]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return visible.filter((s) => {
      const matchSearch =
        !q ||
        s.title?.toLowerCase().includes(q) ||
        s.description?.toLowerCase().includes(q) ||
        fullName(s.assignedTo).toLowerCase().includes(q) ||
        fullName(s.createdBy).toLowerCase().includes(q);
      const matchTab =
        activeTab === "all" ||
        (activeTab === "overdue" ? isOverdue(s) : s.status === activeTab);
      return matchSearch && matchTab;
    });
  }, [visible, search, activeTab]);

  const clearFilters = () => { setSearch(""); setActiveTab("all"); };

  // ── create form ────────────────────────────────────────────────────────────
  const handleChange = (e) => {
    setFormError("");
    setForm((prev) => ({ ...prev, [e.target.name]: e.target.value }));
  };

  const resetForm = () => { setForm(EMPTY_FORM); setFormError(""); };
  const handleCancelForm = () => { setFormOpen(false); resetForm(); };

  const handleSubmit = async () => {
    if (!canManage) { denyAccess("create schedules"); return; }

    const title = form.title.trim();
    const description = form.description.trim();
    if (!title) { setFormError("Task title is required."); return; }
    if (title.length > TITLE_MAX) { setFormError(`Title must be ${TITLE_MAX} characters or fewer.`); return; }
    if (description.length > DESCRIPTION_MAX) { setFormError(`Description must be ${DESCRIPTION_MAX} characters or fewer.`); return; }
    if (!form.assignedTo) { setFormError("Please choose who this task is assigned to."); return; }
    if (!form.dueDate) { setFormError("Due date is required."); return; }
    if (form.dueDate < localDateKey(new Date())) { setFormError("Due date cannot be in the past."); return; }

    setSubmitting(true);
    try {
      const me = JSON.parse(localStorage.getItem("user") || "null");
      const created = await api.create(
        {
          title,
          description,
          assignedTo: form.assignedTo,
          // Noon UTC keeps the calendar day stable across timezones.
          dueDate: `${form.dueDate}T12:00:00.000Z`,
        },
        me
      );
      setSchedules((prev) => [normalizeSchedule(created), ...prev]);
      resetForm();
      setFormOpen(false);
      showToast("Schedule created.");
    } catch (err) {
      if (err.status === 403) showErrorDialog("Access Denied", err.message);
      else setFormError(err.message || "Failed to create schedule.");
    } finally {
      setSubmitting(false);
    }
  };

  // ── mark complete (confirm first — it cannot be undone) ───────────────────
  const handleComplete = (id) => {
    if (!canManage) { denyAccess("mark schedules as completed"); return; }
    const target = schedules.find((s) => s.id === id);
    setConfirmDialog({
      open: true,
      title: "Mark as completed?",
      message: `Mark "${target?.title ?? "this task"}" as completed? Your name and the time will be recorded, and it cannot be undone. It will stay visible for ${COMPLETED_RETENTION_DAYS} days.`,
    });
    confirmDialogAction.current = async () => {
      setCompletingId(id);
      try {
        const me = JSON.parse(localStorage.getItem("user") || "null");
        const updated = await api.complete(id, me);
        setSchedules((prev) => prev.map((s) => (s.id === id ? normalizeSchedule(updated) : s)));
        showToast("Task marked as completed.");
      } catch (err) {
        if (err.status === 403) showErrorDialog("Access Denied", err.message);
        else showToast(err.message || "Failed to mark as completed.", "error");
      } finally {
        setCompletingId(null);
      }
    };
  };

  const closeConfirmDialog = () => {
    setConfirmDialog({ open: false, title: "", message: "" });
    confirmDialogAction.current = null;
  };

  const submitConfirmDialog = async () => {
    const action = confirmDialogAction.current;
    closeConfirmDialog();
    if (action) await action();
  };

  return {
    // data
    visible, filtered, counts, assignees, loading, loadError, fetchSchedules,
    // filters
    search, setSearch, activeTab, setActiveTab, clearFilters,
    // form
    formOpen, setFormOpen, form, formError, submitting,
    handleChange, handleSubmit, handleCancelForm,
    // completion
    handleComplete, completingId,
    confirmDialog, closeConfirmDialog, submitConfirmDialog,
    // feedback
    toast, closeToast, errorDialog, closeErrorDialog,
    // permissions + meta
    canManage,
    isMock: USE_MOCK,
  };
};
