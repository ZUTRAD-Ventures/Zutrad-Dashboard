// ─────────────────────────────────────────────────────────────────────────────
// useSupply.js  –  All state, derived values, handlers, and export utilities
//                  for the SupplyPage. No JSX lives here.
// ─────────────────────────────────────────────────────────────────────────────

import { useState, useMemo, useEffect, useRef } from "react";
import { mockDataClients } from "../../data/mockData";
import { hasPermission, isAdminOrSuper, isSuperAdmin } from "../../utils/auth";
import { notifySupplyChanged } from "../../utils/eventbus";
import PictureAsPdfOutlinedIcon from "@mui/icons-material/PictureAsPdfOutlined";
import DescriptionOutlinedIcon from "@mui/icons-material/DescriptionOutlined";
import TableChartOutlinedIcon from "@mui/icons-material/TableChartOutlined";
import InsertDriveFileOutlinedIcon from "@mui/icons-material/InsertDriveFileOutlined";
import { isSupplyPreview } from "./supply.preview";
import { parseSupplyFile, downloadSupplyTemplate } from "./supply.excel";

const API_BASE = process.env.REACT_APP_API_BASE || "http://localhost:5000";

// DEV-ONLY preview switch. Off by default. When true, no network calls are
// made and data lives in memory (resets on refresh). See supply.preview.jsx.
const USE_MOCK = isSupplyPreview;

// Rows per request when bulk-importing, so a 5,000-row file doesn't become one
// giant request body.
const IMPORT_CHUNK = 500;

// Moving stock from one client's holding to another client creates an "owed"
// record for the client it was taken from. true = only administrators and
// superadmins may do this (recommended — it creates a debt). false = anyone
// with the "supply" permission. The backend MUST enforce the same rule.
const TRANSFER_REQUIRES_ADMIN = true;

// ══════════════════════════════════════════════════════════════════════════════
// BACKEND GUIDE — TAKING STOCK FROM ANOTHER CLIENT  ("owed" ledger)
// ══════════════════════════════════════════════════════════════════════════════
// Scenario: stock is held in the store for Client A. You supply it to Client B
// instead. A's stock is gone, so A must be replaced later → "we owe A".
//
// Design: an APPEND-ONLY LEDGER. Never keep a bare number you edit in place —
// every change is a row, and "owed" is calculated by adding the rows up. That
// gives you history (who/when/why) and makes mistakes reversible.
//
// ── 1. NEW COLLECTION / TABLE: supplyLedger ──────────────────────────────────
//   {
//     _id,
//     client:        ref Client   // the client who is OWED (the one taken FROM)
//     partNumber:    String       // trim + uppercase before saving, so
//                                 // "pr-1001 " and "PR-1001" are the same part
//     goodsSupplied: String       // description, for display
//     qtyChange:     Number       // NEGATIVE = taken (we owe more)
//                                 // POSITIVE = repaid / reversed (we owe less)
//     type:          "borrowed_out" | "settled" | "reversed"
//     relatedSupply: ref Supply   // the supply entry that caused it (if any)
//     note:          String       // reason (required for borrowed_out)
//     createdBy:     ref User     // from the TOKEN, never from the request body
//     createdAt:     Date
//   }
//   Index:  { client: 1, partNumber: 1 }  and  { relatedSupply: 1 }
//   NEVER update or delete ledger rows. Corrections = a new row.
//
// ── 2. ADD TO THE EXISTING Supply model ──────────────────────────────────────
//   takenFrom:    ref Client (optional)   // set only when stock came from another client
//   transferNote: String     (optional)
//
// ── 3. CHANGE  POST /supply  (multipart, currently multer) ───────────────────
//   New optional text fields in the form data:  takenFromClientId, transferNote.
//   If takenFromClientId is present:
//     a) PERMISSION: only administrator / superadmin (mirror
//        TRANSFER_REQUIRES_ADMIN above). Otherwise 403 { message }.
//     b) VALIDATE: client exists; it is NOT the same as clientId (the client
//        receiving it); transferNote is non-empty (max ~300 chars).
//     c) In ONE database transaction:
//          i.  insert the Supply row (with takenFrom + transferNote)
//          ii. insert a ledger row:
//              { client: takenFromClientId, partNumber, goodsSupplied,
//                qtyChange: -quantity, type: "borrowed_out",
//                relatedSupply: supply._id, note: transferNote,
//                createdBy: req.user._id }
//        (MongoDB transactions need a replica set. If you can't use one, insert
//         the ledger row first, then the supply, and delete the ledger row if
//         the supply insert fails.)
//   If takenFromClientId is absent, behave exactly as today.
//   The response row must now include  takenFrom  populated as
//   { _id, id, companyName } (or null) — the table shows it in a column.
//   Likewise GET /supply must populate takenFrom on every row.
//
// ── 4. NEW ROUTE:  GET /supply/owed ──────────────────────────────────────────
//   Returns what is currently owed, aggregated from the ledger. Any user with
//   the "supply" permission may read it.
//   Response: array of
//     { client: { _id, id, companyName }, partNumber, goodsSupplied,
//       owed: Number /* positive */, lastTakenAt: Date }
//   Only include groups whose total is below zero. (A total at or above zero
//   means nothing is owed. It can go positive if a supply entry is deleted
//   AFTER part of it was repaid — i.e. the client was over-repaid. Just hide
//   those; don't show a negative "owed".) Mongoose pipeline:
//
//     SupplyLedger.aggregate([
//       { $group: {
//           _id:   { client: "$client", partNumber: "$partNumber" },
//           total: { $sum: "$qtyChange" },
//           goodsSupplied: { $last: "$goodsSupplied" },
//           lastTakenAt: { $max: { $cond: [{ $eq: ["$type", "borrowed_out"] }, "$createdAt", null] } },
//       }},
//       { $match: { total: { $lt: 0 } } },
//       { $project: { client: "$_id.client", partNumber: "$_id.partNumber",
//                     goodsSupplied: 1, lastTakenAt: 1, owed: { $multiply: ["$total", -1] } } },
//     ])
//     // then populate client { companyName } before responding
//
// ── 5. NEW ROUTE:  POST /supply/owed/repay ───────────────────────────────────
//   Body: { clientId, partNumber, quantity, note }
//   - Same permission rule as step 3a.
//   - Recalculate the current owed for (clientId, partNumber) INSIDE the
//     transaction and reject (400) if quantity <= 0 or quantity > owed, so two
//     people repaying at once can't overpay.
//   - Insert a ledger row: { qtyChange: +quantity, type: "settled", note,
//     createdBy: req.user._id }. Respond 201 { message }.
//
// ── 6. WHEN A SUPPLY ENTRY IS DELETED (DELETE /supply/:id and /bulk-delete) ──
//   If the supply had takenFrom set, ALSO insert a compensating ledger row for
//   each linked borrowed_out row:  { qtyChange: +(that row's absolute qty),
//   type: "reversed", relatedSupply: id, note: "Supply entry deleted" }.
//   Do it in the same transaction as the delete. Do NOT delete the original
//   ledger rows — the history stays intact and the net owed goes back to
//   what it was.
//
// ── 7. CHANGE  POST /supply/bulk (Excel import) ──────────────────────────────
//   Each entry may now carry takenFromClientId + transferNote. For every such
//   entry apply steps 3a–3c (permission, validation, ledger row) inside the
//   same transaction as the insertMany. Use insertMany for the ledger rows
//   too — don't loop one by one. One bad entry rejects the whole chunk.
//
// ── 8. LATER (when the Store tracks stock PER CLIENT) ────────────────────────
//   Today the Store has one quantity per part with no client, so every take is
//   treated as owed until replaced. Once the Store knows which client a unit
//   belongs to:
//     - when taking from A, first use A's held stock and only the SHORTFALL
//       becomes a borrowed_out ledger row;
//     - when stock for A is restocked (POST /store or PATCH /store/:id/quantity
//       with clientId = A), auto-settle: compute A's owed for that part and
//       insert a "settled" row for min(owed, restocked quantity).
//   Keep the Store's physical quantity clamped at 0 (it can't be negative).
//   Only the owed figure is a claim, and it comes from this ledger.
// ══════════════════════════════════════════════════════════════════════════════

// ── mock store (preview only) ─────────────────────────────────────────────────
const mockMe = { _id: "local-superadmin", firstName: "Local", surname: "Superadmin" };
const mockClientRef = (id) => {
  const c = mockDataClients.find((x) => String(x.id) === String(id)) || mockDataClients[0];
  return { id: c?.id, _id: c?.id, companyName: c?.companyName };
};
const daysAgoISO = (n) => new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);
// Mock ledger — mirrors the backend "supplyLedger" collection described above.
// Append-only: corrections are new rows, never edits.
let mockLedger = [];
const partKey = (p) => String(p ?? "").trim().toUpperCase();
const mockAddLedger = (entry) => {
  mockLedger = [
    ...mockLedger,
    { _id: `l${Date.now()}_${mockLedger.length}`, createdAt: new Date().toISOString(), createdBy: mockMe, ...entry },
  ];
};
// Same aggregation as GET /supply/owed on the real backend
const mockOwedList = () => {
  const groups = new Map();
  mockLedger.forEach((e) => {
    const k = `${e.clientId}|${partKey(e.partNumber)}`;
    const g = groups.get(k) || { clientId: e.clientId, partNumber: partKey(e.partNumber), goodsSupplied: e.goodsSupplied, total: 0, lastTakenAt: null };
    g.total += e.qtyChange;
    g.goodsSupplied = e.goodsSupplied || g.goodsSupplied;
    if (e.type === "borrowed_out" && (!g.lastTakenAt || e.createdAt > g.lastTakenAt)) g.lastTakenAt = e.createdAt;
    groups.set(k, g);
  });
  return [...groups.values()]
    .filter((g) => g.total < 0)
    .map((g) => ({
      client: mockClientRef(g.clientId),
      partNumber: g.partNumber,
      goodsSupplied: g.goodsSupplied,
      owed: -g.total,
      lastTakenAt: g.lastTakenAt,
    }));
};
// Reverse the ledger effect of deleted supply entries (step 6 of the guide)
const mockReverseTransfers = (supplyIds) => {
  mockLedger
    .filter((e) => supplyIds.includes(e.relatedSupply) && e.type === "borrowed_out")
    .forEach((e) =>
      mockAddLedger({
        clientId: e.clientId, partNumber: e.partNumber, goodsSupplied: e.goodsSupplied,
        qtyChange: -e.qtyChange, type: "reversed", relatedSupply: e.relatedSupply, note: "Supply entry deleted",
      })
    );
};

let mockRows = [
  { _id: "m1", goodsSupplied: "Printer ribbon", partNumber: "PR-1001", quantity: 12, supplyDate: daysAgoISO(3),  client: mockClientRef(mockDataClients[0]?.id), user: mockMe, attachments: [] },
  { _id: "m2", goodsSupplied: "Ink cartridge",  partNumber: "IC-2040", quantity: 30, supplyDate: daysAgoISO(9),  client: mockClientRef(mockDataClients[1]?.id ?? mockDataClients[0]?.id), user: mockMe, attachments: [] },
  { _id: "m3", goodsSupplied: "Cleaning fluid", partNumber: "CF-77",   quantity: 6,  supplyDate: daysAgoISO(20), client: mockClientRef(mockDataClients[0]?.id), user: mockMe, attachments: [],
    takenFrom: mockClientRef(mockDataClients[1]?.id ?? mockDataClients[0]?.id), transferNote: "Urgent job — replace when next order lands" },
];
// Seed one transfer so the "Owed to Clients" panel has something to show
mockAddLedger({
  clientId: mockDataClients[1]?.id ?? mockDataClients[0]?.id, partNumber: "CF-77", goodsSupplied: "Cleaning fluid",
  qtyChange: -6, type: "borrowed_out", relatedSupply: "m3", note: "Urgent job — replace when next order lands",
});
const mockDelay = (ms = 250) => new Promise((r) => setTimeout(r, ms));

// ── auth headers ──────────────────────────────────────────────────────────────
// IMPORTANT: never include Content-Type when sending FormData — the browser
// must set the multipart boundary itself or multer will reject the request.
const authBearer = () => ({
  Authorization: `Bearer ${localStorage.getItem("token")}`,
});

const authJson = () => ({
  "Content-Type": "application/json",
  Authorization: `Bearer ${localStorage.getItem("token")}`,
});

// ── safeJson ──────────────────────────────────────────────────────────────────
// Safely parses a fetch Response as JSON.  If the server returns HTML (e.g. a
// crash page, a 502 from a proxy, or multer not yet installed) `.json()` would
// normally throw "JSON.parse: unexpected character at line 1 column 1".
// This helper swallows that and returns a plain object instead so callers can
// always do `data.message` without crashing.
const safeJson = async (res) => {
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    // Server returned non-JSON (HTML error page, plain-text, etc.)
    // Surface the raw text in development so it's easy to diagnose.
    console.error("[supply] Non-JSON response from server:", text.slice(0, 300));
    return { message: "Server returned an unexpected response. Check the backend console." };
  }
};

// ── export helpers ────────────────────────────────────────────────────────────

export const exportCSV = (rows) => {
  const headers = [
    "ID", "Goods Supplied", "Part Number", "Qty",
    "Client", "Supply Date", "Taken From", "Transfer Note", "Logged By", "Attachments",
  ];
  const data = rows.map((r) => [
    r.id ?? r._id,
    r.goodsSupplied,
    r.partNumber,
    r.quantity,
    r.client?.companyName ?? "",
    r.supplyDate,
    r.takenFrom?.companyName ?? "",
    r.transferNote ?? "",
    r.user ? `${r.user.firstName} ${r.user.surname}` : "",
    (r.attachments || []).map((f) => f.name).join("; "),
  ]);
  const content = [headers, ...data]
    .map((row) => row.map((v) => `"${v}"`).join(","))
    .join("\n");
  const blob = new Blob([content], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `zutrad_supply_${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
};

export const exportJSON = (rows) => {
  const serializable = rows.map((r) => ({
    ...r,
    attachments: (r.attachments || []).map((f) => f.name),
  }));
  const blob = new Blob([JSON.stringify(serializable, null, 2)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `zutrad_supply_${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
};

// ── file-type icon resolver ───────────────────────────────────────────────────

export const fileIcon = (filename) => {
  const ext = (filename ?? "").split(".").pop()?.toLowerCase();
  if (ext === "pdf")                   return PictureAsPdfOutlinedIcon;
  if (ext === "doc" || ext === "docx") return DescriptionOutlinedIcon;
  if (ext === "xls" || ext === "xlsx") return TableChartOutlinedIcon;
  return InsertDriveFileOutlinedIcon;
};

// ── FORM INITIAL STATE ────────────────────────────────────────────────────────

const EMPTY_FORM = {
  goodsSupplied: "",
  partNumber: "",
  quantity: "",
  supplyDate: "",
  clientId: "",
  takenFromClientId: "", // optional: stock was taken from THIS client's holding
  transferNote: "",      // required when takenFromClientId is set
};

// ── main hook ─────────────────────────────────────────────────────────────────

export const useSupply = () => {

  // ── permission flags ───────────────────────────────────────────────────────
  const canLogSupply = hasPermission("supply");
  const canDelete    = isSuperAdmin();
  const canExport    = isAdminOrSuper();
  const canDownload  = isAdminOrSuper(); // download attachments
  // Taking stock from another client / repaying what is owed
  const canTransfer  = TRANSFER_REQUIRES_ADMIN ? isAdminOrSuper() : hasPermission("supply");

  // ── core data ───────────────────────────────────────────────────────────────
  const [rows,        setRows]        = useState([]);
  const [loading,     setLoading]     = useState(true);
  const [loadError,   setLoadError]   = useState("");
  const [selectedIds, setSelectedIds] = useState([]);

  // ── owed-to-clients state ───────────────────────────────────────────────────
  // owed: [{ client, partNumber, goodsSupplied, owed, lastTakenAt }]
  const [owed,       setOwed]       = useState([]);
  const [owedOpen,   setOwedOpen]   = useState(false);
  const [repayDialog, setRepayDialog] = useState({ open: false, item: null, quantity: "", note: "", error: "" });
  const [repaying,   setRepaying]   = useState(false);

  // ── ui state ────────────────────────────────────────────────────────────────
  const [formOpen, setFormOpen] = useState(false);
  const [toast,    setToast]    = useState({ open: false, message: "", severity: "success" });

  // ── error / access-denied dialog ──────────────────────────────────────────
  const [errorDialog, setErrorDialog] = useState({ open: false, title: "", message: "" });
  const closeErrorDialog = () => setErrorDialog({ open: false, title: "", message: "" });
  const showErrorDialog  = (title, message) => setErrorDialog({ open: true, title, message });

  const [confirmDialog, setConfirmDialog] = useState({ open: false, title: "", message: "" });
  const confirmDialogAction = useRef(null);
  const closeConfirmDialog = () => {
    setConfirmDialog({ open: false, title: "", message: "" });
    confirmDialogAction.current = null;
  };
  const submitConfirmDialog = async () => {
    if (confirmDialogAction.current) {
      await confirmDialogAction.current();
    }
    closeConfirmDialog();
  };

  const openFormIfAuthorised = () => {
    if (!canLogSupply) {
      showErrorDialog(
        "Access Denied",
        "You don't have permission to log supply. Ask an administrator to grant you supply access."
      );
      return;
    }
    setFormOpen(true);
  };

  // ── download confirmation dialog ───────────────────────────────────────────
  const [downloadDialog, setDownloadDialog] = useState({ open: false, file: null });
  const closeDownloadDialog = () => setDownloadDialog({ open: false, file: null });

  const handleFileClick = (file) => {
    if (!canDownload) {
      showErrorDialog(
        "Access Denied",
        "Only administrators and superadmins can download attachments."
      );
      return;
    }
    setDownloadDialog({ open: true, file });
  };

  const handleDownloadConfirm = async () => {
    const { name, storedName } = downloadDialog.file ?? {};
    closeDownloadDialog();

    if (!storedName) {
      // Legacy entry saved before the file-upload feature was added —
      // it only has a display name, no stored file on disk.
      showErrorDialog(
        "File Not Available",
        "This attachment was logged before file uploads were enabled and has no stored file to download."
      );
      return;
    }

    try {
      if (USE_MOCK) {
        showErrorDialog("Preview mode", "Attachment downloads need the real backend.");
        return;
      }
      const res = await fetch(
        `${API_BASE}/supply/files/${encodeURIComponent(storedName)}`,
        { headers: authBearer() }
      );

      if (!res.ok) {
        // Error responses from our API are JSON; guard with safeJson
        const body = await safeJson(res);
        throw new Error(body.message || `Download failed (${res.status}).`);
      }

      // Success — the response is the raw file binary, not JSON
      const blob = await res.blob();
      const url  = URL.createObjectURL(blob);
      const a    = document.createElement("a");
      a.href     = url;
      a.download = name ?? storedName;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      showErrorDialog("Download Failed", err.message);
    }
  };

  // ── filter state ────────────────────────────────────────────────────────────
  const [search,       setSearch]       = useState("");
  const [clientFilter, setClientFilter] = useState("all");

  // ── form state ──────────────────────────────────────────────────────────────
  const [form,        setForm]        = useState(EMPTY_FORM);
  const [formError,   setFormError]   = useState("");
  const [submitting,  setSubmitting]  = useState(false);
  const [attachments, setAttachments] = useState([]); // File[] from <input type="file">

  // ── toast helpers ──────────────────────────────────────────────────────────
  const showToast = (message, severity = "success") =>
    setToast({ open: true, message, severity });
  const closeToast = () => setToast((t) => ({ ...t, open: false }));

  // ── fetch supply rows on mount ──────────────────────────────────────────────
  const fetchRows = async () => {
    setLoading(true);
    setLoadError("");
    try {
      if (USE_MOCK) {
        await mockDelay();
        setRows(mockRows);
        return;
      }
      const res  = await fetch(`${API_BASE}/supply`, { headers: authBearer() });
      const data = await safeJson(res);
      if (!res.ok) throw new Error(data.message || "Failed to load supply log.");
      setRows(data);
    } catch (err) {
      setLoadError(err.message);
      showToast(err.message, "error");
    } finally {
      setLoading(false);
    }
  };

  // Aggregated "we owe these clients" list — GET /supply/owed (guide step 4)
  const fetchOwed = async () => {
    try {
      if (USE_MOCK) {
        setOwed(mockOwedList());
        return;
      }
      const res  = await fetch(`${API_BASE}/supply/owed`, { headers: authBearer() });
      const data = await safeJson(res);
      if (!res.ok) throw new Error(data.message || "Failed to load owed stock.");
      setOwed(Array.isArray(data) ? data : []);
    } catch (err) {
      showToast(err.message, "error");
    }
  };

  useEffect(() => {
    fetchRows();
    fetchOwed();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── derived stats ─────────────────────────────────────────────────────────
  const totalQty      = rows.reduce((acc, r) => acc + (Number(r.quantity) || 0), 0);
  const uniqueClients = new Set(rows.map((r) => r.client?.id ?? r.client?._id)).size;
  const totalOwed     = owed.reduce((acc, o) => acc + (Number(o.owed) || 0), 0);

  // ── filtered rows ─────────────────────────────────────────────────────────
  const filteredRows = useMemo(() => {
    return rows.filter((r) => {
      const q = search.toLowerCase();
      const matchSearch =
        !q ||
        r.goodsSupplied?.toLowerCase().includes(q) ||
        r.partNumber?.toLowerCase().includes(q) ||
        r.client?.companyName?.toLowerCase().includes(q) ||
        (r.user ? `${r.user.firstName} ${r.user.surname}` : "").toLowerCase().includes(q);
      const matchClient =
        clientFilter === "all" || String(r.client?.id ?? r.client?._id) === clientFilter;
      return matchSearch && matchClient;
    });
  }, [rows, search, clientFilter]);

  // ── form handlers ─────────────────────────────────────────────────────────

  const handleChange = (e) => {
    setFormError("");
    const { name, value } = e.target;
    setForm((prev) => {
      const next = { ...prev, [name]: value };
      // The client receiving the goods can't also be the one taken from
      if (name === "clientId" && String(value) === String(prev.takenFromClientId)) {
        next.takenFromClientId = "";
        next.transferNote = "";
      }
      if (name === "takenFromClientId" && !value) next.transferNote = "";
      return next;
    });
  };

  const handleFileChange = (e) => {
    setAttachments(Array.from(e.target.files || []));
  };

  const resetForm = () => {
    setForm(EMPTY_FORM);
    setAttachments([]);
    setFormError("");
  };

  // ── submit — multipart/form-data so files are actually uploaded ────────────
  // DO NOT set Content-Type header — the browser sets it with the correct
  // multipart boundary automatically when the body is a FormData instance.
  // Setting it manually breaks multer's parser on the server.
  const handleSubmit = async () => {
    if (!canLogSupply) {
      showErrorDialog(
        "Access Denied",
        "You don't have permission to log supply. Ask an administrator to grant you supply access."
      );
      return;
    }

    const { goodsSupplied, partNumber, quantity, supplyDate, clientId, takenFromClientId, transferNote } = form;
    if (!goodsSupplied.trim()) { setFormError("Goods Supplied is required."); return; }
    if (!partNumber.trim())    { setFormError("Part Number is required.");    return; }
    if (!quantity || Number(quantity) <= 0) { setFormError("Enter a valid quantity."); return; }
    if (!supplyDate)           { setFormError("Supply Date is required.");    return; }
    if (!clientId)             { setFormError("Please select a client.");     return; }

    if (takenFromClientId) {
      if (!canTransfer) {
        showErrorDialog("Access Denied", "Only administrators and superadmins can take stock from another client.");
        return;
      }
      if (String(takenFromClientId) === String(clientId)) { setFormError("\"Taken from\" must be a different client."); return; }
      if (!transferNote.trim()) { setFormError("Add a note explaining why stock was taken from another client."); return; }
    }

    setSubmitting(true);
    try {
      if (USE_MOCK) {
        await mockDelay();
        const row = {
          _id: `m${Date.now()}`,
          goodsSupplied, partNumber, quantity: Number(quantity), supplyDate,
          client: mockClientRef(clientId), user: mockMe,
          attachments: attachments.map((f) => ({ name: f.name })),
          ...(takenFromClientId ? { takenFrom: mockClientRef(takenFromClientId), transferNote: transferNote.trim() } : {}),
        };
        mockRows = [row, ...mockRows];
        if (takenFromClientId) {
          mockAddLedger({
            clientId: takenFromClientId, partNumber, goodsSupplied, qtyChange: -Number(quantity),
            type: "borrowed_out", relatedSupply: row._id, note: transferNote.trim(),
          });
          fetchOwed();
        }
        setRows((prev) => [row, ...prev]);
        resetForm();
        setFormOpen(false);
        showToast("Supply log added successfully.");
        return;
      }
      const fd = new FormData();
      fd.append("goodsSupplied", goodsSupplied);
      fd.append("partNumber",    partNumber);
      fd.append("quantity",      quantity);
      fd.append("supplyDate",    supplyDate);
      fd.append("clientId",      clientId);
      if (takenFromClientId) {
        fd.append("takenFromClientId", takenFromClientId);
        fd.append("transferNote",      transferNote.trim());
      }
      // Append each File object under the key "files" — multer's
      // upload.array("files") picks them all up on the server side.
      attachments.forEach((file) => fd.append("files", file));

      const res  = await fetch(`${API_BASE}/supply`, {
        method:  "POST",
        headers: authBearer(), // no Content-Type — critical for multipart
        body:    fd,
      });
      const data = await safeJson(res);
      if (!res.ok) throw new Error(data.message || "Failed to add supply log.");

      setRows((prev) => [data, ...prev]);
      if (takenFromClientId) fetchOwed(); // a new "owed" record was created server-side
      notifySupplyChanged();
      resetForm();
      setFormOpen(false);
      showToast("Supply log added successfully.");
    } catch (err) {
      setFormError(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  const handleCancelForm = () => {
    setFormOpen(false);
    resetForm();
  };

  // ── delete handlers ───────────────────────────────────────────────────────

  const handleDelete = (id) => {
    if (!canDelete) {
      showErrorDialog(
        "Access Denied",
        "Only superadmins can delete entries. Contact your superadmin if you need this action performed."
      );
      return;
    }

    setConfirmDialog({
      open: true,
      title: "Delete supply entry?",
      message: "Delete this supply entry? This cannot be undone.",
    });
    confirmDialogAction.current = async () => {
      try {
        if (USE_MOCK) {
          mockReverseTransfers([id]);
          mockRows = mockRows.filter((r) => r._id !== id);
          setRows((prev) => prev.filter((r) => r._id !== id));
          fetchOwed();
          showToast("Entry deleted.");
          return;
        }
        const res  = await fetch(`${API_BASE}/supply/${id}`, {
          method:  "DELETE",
          headers: authBearer(),
        });
        const data = await safeJson(res);
        if (!res.ok) throw new Error(data.message || "Failed to delete entry.");
        setRows((prev) => prev.filter((r) => r._id !== id));
        fetchOwed(); // server reversed any linked "owed" record
        notifySupplyChanged();
        showToast("Entry deleted.");
      } catch (err) {
        showToast(err.message, "error");
      }
    };
  };

  const handleBulkDelete = () => {
    if (!canDelete) {
      showErrorDialog(
        "Access Denied",
        "Only superadmins can delete entries. Contact your superadmin if you need this action performed."
      );
      return;
    }

    setConfirmDialog({
      open: true,
      title: "Delete selected entries?",
      message: `Delete ${selectedIds.length} selected entries? This cannot be undone.`,
    });
    confirmDialogAction.current = async () => {
      try {
        if (USE_MOCK) {
          mockReverseTransfers(selectedIds);
          mockRows = mockRows.filter((r) => !selectedIds.includes(r._id));
          setRows((prev) => prev.filter((r) => !selectedIds.includes(r._id)));
          fetchOwed();
          showToast(`${selectedIds.length} entries deleted.`);
          setSelectedIds([]);
          return;
        }
        const res  = await fetch(`${API_BASE}/supply/bulk-delete`, {
          method:  "POST",
          headers: authJson(),
          body:    JSON.stringify({ ids: selectedIds }),
        });
        const data = await safeJson(res);
        if (!res.ok) throw new Error(data.message || "Failed to delete entries.");
        setRows((prev) => prev.filter((r) => !selectedIds.includes(r._id)));
        fetchOwed();
        notifySupplyChanged();
        showToast(data.message || `${selectedIds.length} entries deleted.`);
        setSelectedIds([]);
      } catch (err) {
        showToast(err.message, "error");
      }
    };
  };

  // ── excel import ──────────────────────────────────────────────────────────
  // Flow: pick file → parse + validate in the browser → preview dialog →
  // confirm → POST valid rows to /supply/bulk in chunks.
  //
  // ══════════════════════════════════════════════════════════════════════════
  // BACKEND GUIDE — what to add so the import works outside preview mode
  // (the frontend already calls this; only the server side is missing)
  // ══════════════════════════════════════════════════════════════════════════
  //
  // 1. NEW ROUTE:  POST /supply/bulk
  //    - JSON body, "Authorization: Bearer <token>" header.
  //    - Use the SAME auth + permission middleware as POST /supply (the user
  //      needs the "supply" permission; superadmin always passes).
  //    - Do NOT use multer here: this is JSON, not multipart.
  //
  // 2. ROUTE ORDER (common gotcha):
  //    Declare  router.post("/supply/bulk", ...)  BEFORE any
  //    router.post("/supply/:id", ...) / router.delete("/supply/:id", ...)
  //    so "bulk" is not treated as an :id. (/supply/bulk-delete already
  //    exists and follows the same rule.)
  //
  // 3. REQUEST BODY:
  //      { entries: [ { goodsSupplied, partNumber, quantity, supplyDate, clientId,
  //                     takenFromClientId?, transferNote? } ] }
  //    takenFromClientId / transferNote are OPTIONAL and only present for rows
  //    that take stock from another client — see the "TAKING STOCK FROM
  //    ANOTHER CLIENT" guide at the top of this file (steps 3 and 7).
  //    - The page sends at most IMPORT_CHUNK (500) entries per request, and a
  //      file may produce several requests in a row.
  //    - supplyDate is "YYYY-MM-DD". clientId is the client's id.
  //    - If you use express.json(), the default 100kb body limit is too
  //      small for 500 rows on some data. Set it, e.g.
  //      app.use(express.json({ limit: "1mb" })).
  //
  // 4. SERVER-SIDE VALIDATION (never trust the browser's checks):
  //    - entries must be a non-empty array, max 500 (reject more with 400).
  //    - per entry: goodsSupplied / partNumber non-empty strings (trim,
  //      cap length); quantity a finite number > 0; supplyDate a valid date;
  //      clientId must exist in your clients collection.
  //    - Look up all client ids in ONE query (e.g. Client.find({ _id: { $in: ids } }))
  //      instead of one query per row.
  //    - If ANY entry is invalid, reject the whole chunk with 400 and a
  //      message naming the entry index, e.g.
  //      { message: "Entry 12: quantity must be greater than 0." }
  //      (all-or-nothing per chunk keeps data consistent).
  //
  // 4b. SET THESE ON THE SERVER, never from the request body:
  //    - user:        the logged-in user from the token (same as POST /supply)
  //    - attachments: [] (imports carry no files)
  //    - createdAt:   server time
  //
  // 5. SAVE IN ONE OPERATION:
  //    - Mongoose:  const docs = await Supply.insertMany(rows)
  //      then populate user + client so the response matches POST /supply
  //      (the table reads row.client.companyName and row.user.firstName/surname):
  //        await Supply.populate(docs, [
  //          { path: "client", select: "companyName" },
  //          { path: "user",   select: "firstName surname" },
  //        ]);
  //    - SQL:  a single multi-row INSERT inside a transaction.
  //
  // 6. RESPONSE (201):
  //      { created: [ <row>, <row>, ... ] }
  //    Each row must have the SAME shape POST /supply returns (including
  //    _id, client and user objects). The page prepends them to the table
  //    directly, with no refetch.
  //    Errors must be JSON { message } with a non-2xx status; the page shows
  //    that message in the "Import stopped" dialog.
  //
  // 7. SIDE EFFECTS — match POST /supply:
  //    - If POST /supply updates anything else (store stock levels,
  //      notifications, audit log), do the same for bulk inserts, once per
  //      entry. Check that handler and copy its behaviour.
  //    - Entries with takenFromClientId also need a supplyLedger row each,
  //      in the same transaction (top-of-file guide, step 7).
  //
  // 8. DUPLICATES:
  //    - The page already warns about duplicates and skips them by default.
  //      The server doesn't have to enforce uniqueness, since a repeat supply
  //      of the same part on the same day can be legitimate. If you do want
  //      a hard rule, add a unique index and return 409 with a clear message.
  //
  // 9. SKELETON (Express + Mongoose — adjust names to your project):
  //
  //    router.post("/supply/bulk", auth, requirePermission("supply"), async (req, res) => {
  //      try {
  //        const { entries } = req.body || {};
  //        if (!Array.isArray(entries) || entries.length === 0)
  //          return res.status(400).json({ message: "No entries provided." });
  //        if (entries.length > 500)
  //          return res.status(400).json({ message: "Too many entries (max 500 per request)." });
  //
  //        const ids = [...new Set(entries.map((e) => String(e.clientId)))];
  //        const clients = await Client.find({ _id: { $in: ids } }).select("_id");
  //        const valid = new Set(clients.map((c) => String(c._id)));
  //
  //        const rows = [];
  //        for (let i = 0; i < entries.length; i++) {
  //          const e = entries[i];
  //          const qty = Number(e.quantity);
  //          if (!String(e.goodsSupplied || "").trim()) return res.status(400).json({ message: `Entry ${i + 1}: goods supplied is required.` });
  //          if (!String(e.partNumber || "").trim())    return res.status(400).json({ message: `Entry ${i + 1}: part number is required.` });
  //          if (!Number.isFinite(qty) || qty <= 0)     return res.status(400).json({ message: `Entry ${i + 1}: quantity must be greater than 0.` });
  //          if (isNaN(new Date(e.supplyDate)))         return res.status(400).json({ message: `Entry ${i + 1}: invalid supply date.` });
  //          if (!valid.has(String(e.clientId)))        return res.status(400).json({ message: `Entry ${i + 1}: unknown client.` });
  //          rows.push({
  //            goodsSupplied: String(e.goodsSupplied).trim(),
  //            partNumber:    String(e.partNumber).trim(),
  //            quantity:      qty,
  //            supplyDate:    e.supplyDate,
  //            client:        e.clientId,
  //            user:          req.user._id,   // from the token, not the body
  //            attachments:   [],
  //          });
  //        }
  //
  //        const docs = await Supply.insertMany(rows);
  //        await Supply.populate(docs, [
  //          { path: "client", select: "companyName" },
  //          { path: "user",   select: "firstName surname" },
  //        ]);
  //        res.status(201).json({ created: docs });
  //      } catch (err) {
  //        res.status(500).json({ message: "Bulk import failed." });
  //      }
  //    });
  //
  // 10. TEST IT without the page:
  //    curl -X POST http://localhost:5000/supply/bulk \
  //      -H "Authorization: Bearer <token>" -H "Content-Type: application/json" \
  //      -d '{"entries":[{"goodsSupplied":"Ribbon","partNumber":"PR-1","quantity":5,"supplyDate":"2026-03-15","clientId":1}]}'
  // ══════════════════════════════════════════════════════════════════════════
  const EMPTY_IMPORT = { open: false, fileName: "", rows: [], missingColumns: [], error: "" };
  const [importState,    setImportState]    = useState(EMPTY_IMPORT);
  const [importParsing,  setImportParsing]  = useState(false);
  const [importing,      setImporting]      = useState(false);
  const [importProgress, setImportProgress] = useState(0);
  const [skipDuplicates, setSkipDuplicates] = useState(true);

  const openImportIfAuthorised = () => {
    if (!canLogSupply) {
      showErrorDialog(
        "Access Denied",
        "You don't have permission to log supply. Ask an administrator to grant you supply access."
      );
      return;
    }
    setImportState({ ...EMPTY_IMPORT, open: true });
  };

  const closeImport = () => {
    if (importing) return; // don't close mid-upload
    setImportState(EMPTY_IMPORT);
    setImportProgress(0);
  };

  const handleImportFile = async (file) => {
    if (!file) return;
    setImportParsing(true);
    setImportState({ ...EMPTY_IMPORT, open: true, fileName: file.name });
    try {
      const { rows: parsed, missingColumns } = await parseSupplyFile(file, mockDataClients, rows, { allowTransfer: canTransfer });
      setImportState({ open: true, fileName: file.name, rows: parsed, missingColumns, error: "" });
    } catch (err) {
      setImportState({ ...EMPTY_IMPORT, open: true, fileName: file.name, error: err.message });
    } finally {
      setImportParsing(false);
    }
  };

  const importSummary = useMemo(() => {
    const total      = importState.rows.length;
    const invalid    = importState.rows.filter((r) => r.errors.length).length;
    const duplicates = importState.rows.filter((r) => !r.errors.length && r.duplicate).length;
    const toImport   = importState.rows.filter(
      (r) => !r.errors.length && !(skipDuplicates && r.duplicate)
    ).length;
    const transfers  = importState.rows.filter(
      (r) => !r.errors.length && r.data.takenFromId && !(skipDuplicates && r.duplicate)
    ).length;
    return { total, invalid, duplicates, toImport, transfers };
  }, [importState.rows, skipDuplicates]);

  const confirmImport = async () => {
    const entries = importState.rows
      .filter((r) => !r.errors.length && !(skipDuplicates && r.duplicate))
      .map(({ data }) => ({
        goodsSupplied: data.goodsSupplied,
        partNumber:    data.partNumber,
        quantity:      data.quantity,
        supplyDate:    data.supplyDate,
        clientId:      data.clientId,
        // optional — only sent for rows that take stock from another client
        ...(data.takenFromId ? { takenFromClientId: data.takenFromId, transferNote: data.transferNote } : {}),
      }));
    if (entries.length === 0) return;

    setImporting(true);
    setImportProgress(0);
    const created = [];
    try {
      for (let i = 0; i < entries.length; i += IMPORT_CHUNK) {
        const chunk = entries.slice(i, i + IMPORT_CHUNK);

        if (USE_MOCK) {
          await mockDelay(300);
          const made = chunk.map((e, j) => ({
            _id: `m${Date.now()}_${i + j}`,
            ...e,
            client: mockClientRef(e.clientId),
            user: mockMe,
            attachments: [],
            ...(e.takenFromClientId ? { takenFrom: mockClientRef(e.takenFromClientId) } : {}),
          }));
          made.forEach((m) => {
            if (m.takenFromClientId) {
              mockAddLedger({
                clientId: m.takenFromClientId, partNumber: m.partNumber, goodsSupplied: m.goodsSupplied,
                qtyChange: -Number(m.quantity), type: "borrowed_out", relatedSupply: m._id, note: m.transferNote,
              });
            }
          });
          mockRows = [...made, ...mockRows];
          created.push(...made);
        } else {
          const res = await fetch(`${API_BASE}/supply/bulk`, {
            method: "POST",
            headers: authJson(),
            body: JSON.stringify({ entries: chunk }),
          });
          const data = await safeJson(res);
          if (!res.ok) throw new Error(data.message || "Bulk import failed.");
          created.push(...(data.created || []));
        }
        setImportProgress(Math.round(((i + chunk.length) / entries.length) * 100));
      }
      setRows((prev) => [...created, ...prev]);
      if (entries.some((e) => e.takenFromClientId)) fetchOwed();
      if (!USE_MOCK) notifySupplyChanged();
      setImportState(EMPTY_IMPORT);
      showToast(`${created.length} supply entr${created.length === 1 ? "y" : "ies"} imported.`);
    } catch (err) {
      // Earlier chunks may already be saved — show them and say so.
      if (created.length) setRows((prev) => [...created, ...prev]);
      if (created.length) fetchOwed();
      if (created.length && !USE_MOCK) notifySupplyChanged();
      setImportState(EMPTY_IMPORT);
      showErrorDialog(
        "Import stopped",
        `${err.message}${created.length ? ` ${created.length} of ${entries.length} entries were saved before the error. Re-importing the same file will skip those (duplicates are detected).` : " Nothing was saved."}`
      );
    } finally {
      setImporting(false);
      setImportProgress(0);
    }
  };

  const handleDownloadTemplate = async () => {
    try {
      await downloadSupplyTemplate(mockDataClients);
    } catch (err) {
      showErrorDialog("Template failed", 'Could not create the template. Make sure "xlsx" is installed (npm install xlsx).');
    }
  };

  // ── repaying what is owed ─────────────────────────────────────────────────
  // POST /supply/owed/repay { clientId, partNumber, quantity, note } (guide step 5)
  const openRepay = (item) => {
    if (!canTransfer) {
      showErrorDialog("Access Denied", "Only administrators and superadmins can record repayments.");
      return;
    }
    setRepayDialog({ open: true, item, quantity: String(item.owed), note: "", error: "" });
  };

  const closeRepay = () => {
    if (repaying) return;
    setRepayDialog({ open: false, item: null, quantity: "", note: "", error: "" });
  };

  const changeRepay = (field, value) =>
    setRepayDialog((d) => ({ ...d, [field]: value, error: "" }));

  const confirmRepay = async () => {
    const { item, quantity, note } = repayDialog;
    const qty = Number(quantity);
    if (!Number.isFinite(qty) || qty <= 0) { changeRepay("error", "Enter a quantity above 0."); return; }
    if (qty > item.owed) { setRepayDialog((d) => ({ ...d, error: `You only owe ${item.owed}. Enter ${item.owed} or less.` })); return; }

    setRepaying(true);
    try {
      const clientId = item.client?.id ?? item.client?._id;
      if (USE_MOCK) {
        await mockDelay();
        mockAddLedger({
          clientId, partNumber: item.partNumber, goodsSupplied: item.goodsSupplied,
          qtyChange: qty, type: "settled", note: note.trim(),
        });
      } else {
        const res  = await fetch(`${API_BASE}/supply/owed/repay`, {
          method: "POST",
          headers: authJson(),
          body: JSON.stringify({ clientId, partNumber: item.partNumber, quantity: qty, note: note.trim() }),
        });
        const data = await safeJson(res);
        if (!res.ok) throw new Error(data.message || "Failed to record repayment.");
      }
      await fetchOwed();
      setRepayDialog({ open: false, item: null, quantity: "", note: "", error: "" });
      showToast(`Repayment of ${qty} recorded.`);
    } catch (err) {
      setRepayDialog((d) => ({ ...d, error: err.message }));
    } finally {
      setRepaying(false);
    }
  };

  // ── clear filters ─────────────────────────────────────────────────────────
  const clearFilters = () => {
    setSearch("");
    setClientFilter("all");
  };

  // ── gated export handlers — admin/superadmin only ─────────────────────────
  const handleExportCSV = () => {
    if (!canExport) {
      showErrorDialog("Access Denied", "Only administrators and superadmins can export data.");
      return;
    }
    exportCSV(filteredRows);
  };

  const handleExportJSON = () => {
    if (!canExport) {
      showErrorDialog("Access Denied", "Only administrators and superadmins can export data.");
      return;
    }
    exportJSON(filteredRows);
  };

  // ── exposed API ───────────────────────────────────────────────────────────
  return {
    // data
    rows,
    filteredRows,
    selectedIds,
    setSelectedIds,
    loading,
    loadError,
    clients: mockDataClients,

    // stats
    totalQty,
    uniqueClients,

    // filters
    search,
    setSearch,
    clientFilter,
    setClientFilter,
    clearFilters,

    // form
    form,
    formOpen,
    setFormOpen,
    openFormIfAuthorised,
    formError,
    submitting,
    attachments,
    setAttachments,
    handleChange,
    handleFileChange,
    handleSubmit,
    handleCancelForm,

    // delete
    handleDelete,
    handleBulkDelete,
    confirmDialog,
    closeConfirmDialog,
    submitConfirmDialog,

    // export
    handleExportCSV,
    handleExportJSON,

    // file download
    handleFileClick,
    downloadDialog,
    closeDownloadDialog,
    handleDownloadConfirm,

    // toast
    toast,
    closeToast,

    // error / access-denied dialog
    errorDialog,
    closeErrorDialog,

    // owed to clients (stock taken from another client's holding)
    owed,
    totalOwed,
    owedOpen,
    setOwedOpen,
    repayDialog,
    repaying,
    openRepay,
    closeRepay,
    changeRepay,
    confirmRepay,
    canTransfer,

    // excel import
    importState,
    importParsing,
    importing,
    importProgress,
    importSummary,
    skipDuplicates,
    setSkipDuplicates,
    openImportIfAuthorised,
    closeImport,
    handleImportFile,
    confirmImport,
    handleDownloadTemplate,

    // preview mode flag
    isMock: USE_MOCK,

    // permissions
    canLogSupply,
    canDelete,
    canExport,
    canDownload,
  };
};