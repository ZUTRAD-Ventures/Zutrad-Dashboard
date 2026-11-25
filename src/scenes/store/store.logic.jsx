import { useState, useMemo, useEffect, useRef } from "react";
import { hasPermission, isAdminOrSuper, isSuperAdmin } from "../../utils/auth";
import { formatDate } from "../../utils/dateFormat";
import { notifyStoreChanged } from "../../utils/eventbus";
import { parseStoreFile, downloadStoreTemplate } from "./store.excel";
import { fetchOwedList, repayOwed, owedBySerial, serialKey, canRecordTransfers } from "../supply/supply.owed";

const API_BASE = process.env.REACT_APP_API_BASE || "http://localhost:5000";

const authHeaders = () => ({
  "Content-Type": "application/json",
  Authorization: `Bearer ${localStorage.getItem("token")}`,
});

// Parses a Response as JSON; a crash page / proxy error (HTML) becomes a plain
// { message } instead of throwing "unexpected character at line 1 column 1".
const safeJson = async (res) => {
  const body = await res.text();
  try {
    return JSON.parse(body);
  } catch {
    console.error("[store] Non-JSON response from server:", body.slice(0, 300));
    return { message: "Server returned an unexpected response. Check the backend console." };
  }
};

/* =========================================================================
   BACKEND GUIDE — SHOWING & SETTLING "OWED TO CLIENTS" ON THE STORE PAGE
   =========================================================================
   Background: when stock held for Client A is supplied to Client B, A is
   recorded as OWED that quantity (see the big guide at the top of
   scenes/supply/supply.logic.jsx — the supplyLedger collection and the
   /supply/owed routes). The Store page now shows that per part and lets an
   administrator mark it as replaced when new stock arrives.

   WHAT THE STORE PAGE CALLS (all already described in the supply guide):
     GET  /supply/owed          → [{ client, serialNumber, goodsSupplied, owed, lastTakenAt }]
     POST /supply/owed/repay    → { clientId, serialNumber, quantity, note }

   WHAT YOU NEED TO DO ON THE BACKEND FOR THE STORE:

   1. PERMISSIONS on GET /supply/owed:
      allow users with the "store" permission as well as "supply" — the Store
      page loads it for everyone who can open Store. It is READ-ONLY info.
      (If the call fails — e.g. a user has neither permission — the Store page
      still works; it just shows no owed column data.)

   2. SERIAL NUMBER MATCHING:
      the Store page links a store item to owed stock by SERIAL number (part
      number is optional and not used for this), compared case-insensitively
      after trimming ("sn-1001 " == "SN-1001"). Ledger rows save serialNumber
      trimmed + uppercased, so they line up with the Store.

   3. SETTLING (POST /supply/owed/repay) — rules to enforce server-side:
      - administrator / superadmin only (same rule as taking stock from another
        client; see TRANSFER_REQUIRES_ADMIN in supply.owed.jsx),
      - quantity > 0 and <= what is currently owed to THAT client for THAT
        serial number, recalculated inside the transaction (two people settling at once
        must not overpay),
      - insert a ledger row { qtyChange: +quantity, type: "settled", note,
        createdBy: req.user._id }. Never edit older ledger rows.

   4. DO NOT auto-settle inside  PATCH /store/:id/quantity.
      The page asks the admin "is this stock replacing what we owe?" because a
      restock is not always a replacement (it may be a normal reorder for
      other clients). Keep PATCH /store/:id/quantity exactly as it is — it
      only changes the physical quantity. The page then calls
      POST /supply/owed/repay if the admin confirms.
      (If you ever want it automatic, do it in the same transaction as the
      quantity change and only when the request includes
      { replacesClientId } so it's still an explicit choice.)

   5. PHYSICAL STOCK STAYS >= 0:
      keep the existing clamp (quantity can't go below 0). "Owed" is a claim on
      FUTURE stock tracked only in the ledger. The page shows
      "free = on hand − owed" so staff can see how much of the shelf stock is
      already promised; the server doesn't need to store that number.

   6. OPTIONAL (performance): instead of a second request, GET /store could
      return  owed: <total owed for that serialNumber>  on each item (a $lookup /
      join on the aggregated ledger). The page matches client-side today, so
      this is not required.

   7. NOT DONE (decide if you want it): supplying goods on the Supply page does
      not reduce the Store quantity today. If it should, decrement the store
      item in the same transaction as POST /supply.
   ========================================================================= */

/* =========================================================================
   BACKEND GUIDE — BULK IMPORT FROM EXCEL  (POST /store/bulk)
   =========================================================================
   The Excel / CSV import lives on the STORE page now (it used to be on the
   Supply page). The browser parses + validates the file, then sends the valid
   rows in chunks of IMPORT_CHUNK (500). Only the server side is missing:

   1. NEW ROUTE:  POST /store/bulk
      - JSON body, "Authorization: Bearer <token>" header. No multer.
      - Same auth + permission as POST /store (the "store" permission;
        superadmin always passes).
      - Declare it BEFORE router.patch("/store/:id/quantity") /
        router.delete("/store/:id") so "bulk" is not treated as an :id.
      - If you use express.json() raise the limit, e.g. { limit: "1mb" }.

   2. REQUEST BODY:
        { items: [ { serialNumber, partNumber?, machinePart, machine, quantity } ] }
      Same field names as POST /store. machine is one of MACHINE_TYPES.

   3. SERVER-SIDE VALIDATION (never trust the browser):
      - items: non-empty array, max 500 (else 400).
      - per item: serialNumber / machinePart non-empty strings, partNumber
        optional (trim, cap length); machine in the allowed list; quantity finite and >= 0.
      - Any invalid item rejects the whole chunk with 400 and a message naming
        the entry, e.g. { message: "Entry 12: quantity must be 0 or more." }.
      - partNumber is saved trimmed + uppercased when given, blank otherwise.

   4. SAVE IN ONE OPERATION:  Store.insertMany(rows)  (or one multi-row INSERT
      in a transaction). Respond 201 { created: [ <item>, ... ] } where every
      item has the SAME shape POST /store returns (incl. _id, updatedAt) — the
      page prepends them to the table without refetching.

   5. DUPLICATES: the page flags rows whose serialNumber
      already exists and skips them by default. The server may enforce it too
      (unique index → 409 with a clear message) but doesn't have to.

   6. DO NOT auto-settle owed stock here. After an import the page reloads the
      owed list; an administrator settles from the Owed chip as usual.

   7. TEST:
        curl -X POST http://localhost:5000/store/bulk \
          -H "Authorization: Bearer <token>" -H "Content-Type: application/json" \
          -d '{"items":[{"serialNumber":"SN-1","machinePart":"Ribbon","machine":"Macsa ID","quantity":5}]}'
   ========================================================================= */

// Rows per request when bulk-importing, so a 5,000-row file doesn't become one
// giant request body.
const IMPORT_CHUNK = 500;

/* =========================================================================
   CONSTANTS
   ========================================================================= */

export const MACHINE_TYPES = ["Macsa ID", "Savema", "Sojet", "BestCode"];
export const ALL_TAB_INDEX = MACHINE_TYPES.length; // "All" tab sits after the machine tabs
export const LOW_STOCK_THRESHOLD = 2;

/* =========================================================================
   CSV EXPORT HELPERS
   ========================================================================= */

const escapeCsvCell = (val) => {
  const s = String(val ?? "");
  if (s.includes(",") || s.includes('"') || s.includes("\n")) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
};

const downloadCsv = (rows, filename) => {
  const headers = [
    "ID",
    "Serial Number",
    "Part Number",
    "Description",
    "Machine",
    "Client",
    "Quantity",
    "Last Updated",
  ];
  const lines = [
    headers.join(","),
    ...rows.map((r) =>
      [
        r.id ?? r._id,
        r.serialNumber,
        r.partNumber,
        r.machinePart,
        r.machine,
        r.client?.companyName ?? "",
        r.quantity,
        formatDate(r.updatedAt),
      ]
        .map(escapeCsvCell)
        .join(",")
    ),
  ];
  const csvContent = lines.join("\n");
  const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.setAttribute("download", filename);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
};

/* =========================================================================
   MAIN HOOK — all state, derived data, and event handlers for the page.
   The UI file just calls this and renders whatever it returns.
   ========================================================================= */

export const useStorePage = () => {
  // ---- permission flags ------------------------------------------------------
  // canAddPart / canAdjustQuantity: requires "store" permission (or superadmin)
  // canDelete: superadmin only
  // canExport: administrator or superadmin only
  const canAddPart = hasPermission("store");
  // Excel import: superadmin only
  const canImport = isSuperAdmin();
  const canAdjustQuantity = hasPermission("store");
  const canDelete = isSuperAdmin();
  const canExport = isAdminOrSuper();

  // ---- raw state ----------------------------------------------------------
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");

  const [activeTab, setActiveTab] = useState(0);
  const [formOpen, setFormOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [successMsg, setSuccessMsg] = useState("");
  const [lowStockOnly, setLowStockOnly] = useState(false);
  const [owedOnly, setOwedOnly] = useState(false);

  // owed: [{ client, serialNumber, goodsSupplied, owed, lastTakenAt }] from GET /supply/owed
  const [owed, setOwed] = useState([]);
  // Real clients for the "Client" dropdown and for checking the import file.
  const [clients, setClients] = useState([]);
  // settleDialog.options: [{ clientId, companyName, owed, quantity (string) }]
  const [settleDialog, setSettleDialog] = useState({
    open: false, serialNumber: "", description: "", restocked: null, options: [], error: "",
  });
  const [settling, setSettling] = useState(false);
  const canSettle = canRecordTransfers();
  const [submitting, setSubmitting] = useState(false);
  const [confirmDialog, setConfirmDialog] = useState({ open: false, title: "", message: "" });
  const confirmDialogAction = useRef(null);

  const [form, setForm] = useState({
    serialNumber: "",
    partNumber: "",
    machinePart: "",
    machine: MACHINE_TYPES[0],
    quantity: "",
    clientId: "", // optional: the client this part belongs to
  });

  // ---- error / access-denied dialog ------------------------------------------
  // Mirrors the pattern used on the Client Machines page: forms/buttons stay
  // visible to everyone, but opening/submitting them when unauthorized pops
  // this dialog instead of silently hiding the control.
  const [errorDialog, setErrorDialog] = useState({ open: false, title: "", message: "" });
  const closeErrorDialog = () => setErrorDialog({ open: false, title: "", message: "" });
  const showErrorDialog = (title, message) => setErrorDialog({ open: true, title, message });

  // Opens the Add Part form — guard runs against live permission state.
  const openFormIfAuthorised = () => {
    if (!canAddPart) {
      showErrorDialog(
        "Access Denied",
        "You don't have permission to add parts. Ask an administrator to grant you store access."
      );
      return;
    }
    setFormOpen(true);
  };

  // ---- fetch inventory on mount ---------------------------------------------
  const fetchItems = async () => {
    setLoading(true);
    setLoadError("");
    try {
      const res = await fetch(`${API_BASE}/store`, { headers: authHeaders() });
      if (!res.ok) throw new Error("Failed to load inventory.");
      const data = await res.json();
      setItems(data);
    } catch (err) {
      setLoadError(err.message);
    } finally {
      setLoading(false);
    }
  };

  // Owed stock is extra info — if it can't be loaded (endpoint not built yet,
  // or the user lacks permission) the Store keeps working without it.
  const fetchOwed = async () => {
    try {
      setOwed(await fetchOwedList());
    } catch (err) {
      console.warn("[store] could not load owed stock:", err.message);
      setOwed([]);
    }
  };

  const fetchClients = async () => {
    try {
      const res = await fetch(`${API_BASE}/clients`, { headers: authHeaders() });
      const data = await safeJson(res);
      if (!res.ok) throw new Error(data.message || "Failed to load clients.");
      setClients((Array.isArray(data) ? data : []).map((c) => ({ ...c, id: c._id ?? c.id })));
    } catch (err) {
      // The Store still works without it; the Client dropdown is just empty.
      console.warn("[store] could not load clients:", err.message);
    }
  };

  useEffect(() => {
    fetchItems();
    fetchOwed();
    fetchClients();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---- tab state -----------------------------------------------------------
  const isAllTab = activeTab === ALL_TAB_INDEX;
  const currentMachineType = isAllTab ? null : MACHINE_TYPES[activeTab];

  const handleTabChange = (_, newTab) => {
    setActiveTab(newTab);
    if (newTab !== ALL_TAB_INDEX) {
      setForm((prev) => ({ ...prev, machine: MACHINE_TYPES[newTab] }));
    }
    setSearch("");
  };

  // ---- add-part form handlers -----------------------------------------------
  const handleFormChange = (e) =>
    setForm((prev) => ({ ...prev, [e.target.name]: e.target.value }));

  const handleAdd = async () => {
    if (!canAddPart) {
      showErrorDialog(
        "Access Denied",
        "You don't have permission to add parts. Ask an administrator to grant you store access."
      );
      return;
    }

    const { serialNumber, partNumber, machinePart, machine, quantity } = form;
    if (!serialNumber.trim() || !machinePart || !machine || quantity === "") {
      setFormErrorOrAlert("Serial number, description, machine and quantity are required.");
      return;
    }
    const qtyNum = Number(quantity);
    if (Number.isNaN(qtyNum) || qtyNum < 0) {
      setFormErrorOrAlert("Quantity must be a number that is 0 or greater.");
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch(`${API_BASE}/store`, {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({
          serialNumber: serialNumber.trim(),
          partNumber: partNumber.trim(),
          machinePart,
          machine,
          quantity: qtyNum,
          clientId: form.clientId || undefined,
        }),
      });
      const data = await safeJson(res);
      if (!res.ok) throw new Error(data.message || "Failed to add part.");

      setItems((prev) => [data, ...prev]);
      notifyStoreChanged();
      if (qtyNum > 0) offerSettle(data.serialNumber, data.machinePart, qtyNum);
      setForm({
        serialNumber: "",
        partNumber: "",
        machinePart: "",
        machine: MACHINE_TYPES[activeTab] ?? MACHINE_TYPES[0],
        quantity: "",
        clientId: "",
      });
      setFormOpen(false);
      setSuccessMsg("Part added to inventory.");
      setTimeout(() => setSuccessMsg(""), 3000);
    } catch (err) {
      setFormErrorOrAlert(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  // small helper so validation/server errors still surface even though the
  // form has no dedicated inline error UI in this page (kept as alert() to
  // match original behavior; swap for setFormError state if you add one)
  const setFormErrorOrAlert = (msg) => alert(msg);

  // ---- quantity adjustment ---------------------------------------------------
  const adjustQuantity = async (id, delta) => {
    if (!canAdjustQuantity) {
      showErrorDialog(
        "Access Denied",
        "You don't have permission to adjust quantity. Ask an administrator to grant you store access."
      );
      return;
    }

    // optimistic update so the UI feels instant; rolled back on failure
    const prevItems = items;
    setItems((prev) =>
      prev.map((item) =>
        item._id === id
          ? { ...item, quantity: Math.max(0, item.quantity + delta) }
          : item
      )
    );

    try {
      const res = await fetch(`${API_BASE}/store/${id}/quantity`, {
        method: "PATCH",
        headers: authHeaders(),
        body: JSON.stringify({ delta }),
      });
      const data = await safeJson(res);
      if (!res.ok) throw new Error(data.message || "Failed to update quantity.");
      setItems((prev) => prev.map((item) => (item._id === id ? data : item)));
      notifyStoreChanged();
      // Stock went UP for a part we owe clients → ask if it's the replacement
      if (delta > 0) offerSettle(data.serialNumber, data.machinePart, delta);
    } catch (err) {
      setItems(prevItems); // rollback
      alert(err.message);
    }
  };

  // ---- delete --------------------------------------------------------------
  const handleDelete = (id) => {
    if (!canDelete) {
      showErrorDialog(
        "Access Denied",
        "Only superadmins can delete parts. Contact your superadmin if you need this action performed."
      );
      return;
    }

    setConfirmDialog({
      open: true,
      title: "Delete part?",
      message: "Delete this part from inventory?",
    });
    confirmDialogAction.current = async () => {
      try {
        const res = await fetch(`${API_BASE}/store/${id}`, {
          method: "DELETE",
          headers: authHeaders(),
        });
        const data = await safeJson(res);
        if (!res.ok) throw new Error(data.message || "Failed to delete part.");
        setItems((prev) => prev.filter((item) => item._id !== id));
        notifyStoreChanged();
        setSuccessMsg("Part deleted.");
        setTimeout(() => setSuccessMsg(""), 3000);
      } catch (err) {
        alert(err.message);
      }
    };
  };

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

  // ---- owed stock: lookup + settle flow ---------------------------------------
  const owedMap = useMemo(() => owedBySerial(owed), [owed]);
  const totalOwed = useMemo(() => owed.reduce((sum, o) => sum + (Number(o.owed) || 0), 0), [owed]);

  // Open the "is this replacing owed stock?" dialog for a part.
  //   restocked = how many units were just added (caps the total you can settle),
  //               or null when opened manually from the Owed chip (no cap).
  // Only users allowed to record repayments see it (the backend enforces the
  // same rule); everyone else just sees the owed chip as information.
  const openSettle = (serialNumber, description, restocked = null) => {
    if (!canSettle) return;
    const group = owedMap.get(serialKey(serialNumber));
    if (!group || group.total <= 0) return;
    let left = restocked ?? Infinity;
    const options = group.entries.map((e) => {
      const q = Math.min(e.owed, left);
      left -= q;
      return { clientId: e.clientId, companyName: e.companyName, goodsSupplied: e.goodsSupplied, serialNumber: e.serialNumber, owed: e.owed, quantity: String(q) };
    });
    setSettleDialog({ open: true, serialNumber: serialKey(serialNumber), description, restocked, options, error: "" });
  };

  // Called after stock is added: only opens when that part is actually owed.
  function offerSettle(serialNumber, description, addedQty) {
    openSettle(serialNumber, description, addedQty);
  }

  const closeSettle = () => {
    if (settling) return;
    setSettleDialog({ open: false, serialNumber: "", description: "", restocked: null, options: [], error: "" });
  };

  const changeSettleQty = (clientId, value) =>
    setSettleDialog((d) => ({
      ...d,
      error: "",
      options: d.options.map((o) => (String(o.clientId) === String(clientId) ? { ...o, quantity: value } : o)),
    }));

  const confirmSettle = async () => {
    const picks = settleDialog.options
      .map((o) => ({ ...o, qty: Number(o.quantity) || 0 }))
      .filter((o) => o.qty > 0);
    if (picks.length === 0) {
      setSettleDialog((d) => ({ ...d, error: "Enter a quantity for at least one client, or choose 'No, keep as general stock'." }));
      return;
    }
    const over = picks.find((o) => o.qty > o.owed);
    if (over) {
      setSettleDialog((d) => ({ ...d, error: `You only owe ${over.owed} to ${over.companyName}.` }));
      return;
    }
    const total = picks.reduce((s, o) => s + o.qty, 0);
    if (settleDialog.restocked != null && total > settleDialog.restocked) {
      setSettleDialog((d) => ({ ...d, error: `You only added ${d.restocked} unit${d.restocked !== 1 ? "s" : ""}, so you can't settle ${total}.` }));
      return;
    }

    setSettling(true);
    try {
      for (const o of picks) {
        await repayOwed({
          clientId: o.clientId,
          serialNumber: o.serialNumber,
          goodsSupplied: o.goodsSupplied,
          quantity: o.qty,
          note: "Replaced from Store restock",
        });
      }
      await fetchOwed();
      setSettleDialog({ open: false, serialNumber: "", description: "", restocked: null, options: [], error: "" });
      setSuccessMsg(`Recorded ${total} unit${total !== 1 ? "s" : ""} as replaced.`);
      setTimeout(() => setSuccessMsg(""), 3000);
    } catch (err) {
      // some clients may already have been settled before the error
      await fetchOwed();
      setSettleDialog((d) => ({ ...d, error: err.message }));
    } finally {
      setSettling(false);
    }
  };

  // ---- derived data: summary counts (always across ALL items) ----------------
  const summary = useMemo(() => {
    const totalParts = items.length;
    const totalQuantity = items.reduce((sum, i) => sum + i.quantity, 0);
    const lowStockCount = items.filter((i) => i.quantity <= LOW_STOCK_THRESHOLD).length;
    return { totalParts, totalQuantity, lowStockCount };
  }, [items]);

  // ---- derived data: filtering by tab + search + low-stock toggle ------------
  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return items.filter((item) => {
      const matchesMachine = isAllTab || item.machine === currentMachineType;
      const matchesSearch =
        !q ||
        item.machinePart.toLowerCase().includes(q) ||
        (item.partNumber ?? "").toLowerCase().includes(q) ||
        item.serialNumber.toLowerCase().includes(q) ||
        item.machine.toLowerCase().includes(q) ||
        (item.client?.companyName ?? "").toLowerCase().includes(q);
      const matchesLowStock = !lowStockOnly || item.quantity <= LOW_STOCK_THRESHOLD;
      const matchesOwed = !owedOnly || (owedMap.get(serialKey(item.serialNumber))?.total ?? 0) > 0;
      return matchesMachine && matchesSearch && matchesLowStock && matchesOwed;
    });
  }, [items, isAllTab, currentMachineType, search, lowStockOnly, owedOnly, owedMap]);

  // pre-format the date on the row itself, and give DataGrid an `id` field
  // since Mongo documents use `_id`
  const rows = useMemo(
    () =>
      filtered.map((item) => {
        const group = owedMap.get(serialKey(item.serialNumber));
        const owedQty = group?.total ?? 0;
        return {
          ...item,
          id: item._id,
          clientName: item.client?.companyName ?? "", // "" = general stock
          updatedAtDisplay: formatDate(item.updatedAt),
          owedQty,                          // units we owe clients for this item
          owedEntries: group?.entries ?? [], // who we owe, for the tooltip / dialog
          freeQty: item.quantity - owedQty,  // on hand minus already-promised (can be < 0)
        };
      }),
    [filtered, owedMap]
  );

  // ---- export ----------------------------------------------------------------
  const handleExport = () => {
    if (!canExport) {
      showErrorDialog(
        "Access Denied",
        "Only administrators and superadmins can export data."
      );
      return;
    }
    if (filtered.length === 0) {
      alert("There's nothing to export with the current filters.");
      return;
    }
    const stamp = new Date().toISOString().slice(0, 10);
    const scope = isAllTab ? "all-machines" : currentMachineType.toLowerCase().replace(/\s+/g, "-");
    downloadCsv(filtered, `store-inventory-${scope}-${stamp}.csv`);
  };

  // ---- excel import ------------------------------------------------------------
  // Flow: pick file → parse + validate in the browser → preview dialog →
  // confirm → POST valid rows to /store/bulk in chunks (backend guide above).
  const EMPTY_IMPORT = { open: false, fileName: "", rows: [], missingColumns: [], error: "" };
  const [importState, setImportState] = useState(EMPTY_IMPORT);
  const [importParsing, setImportParsing] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importProgress, setImportProgress] = useState(0);
  const [skipDuplicates, setSkipDuplicates] = useState(true);

  const openImportIfAuthorised = () => {
    if (!canImport) {
      showErrorDialog("Access Denied", "Only superadmins can import parts from Excel.");
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
      const { rows: parsed, missingColumns } = await parseStoreFile(file, MACHINE_TYPES, items, {
        // On a machine tab, a file with no Machine column imports into that machine.
        defaultMachine: currentMachineType || "",
        clientNames: clients.map((c) => c.companyName),
      });
      setImportState({ open: true, fileName: file.name, rows: parsed, missingColumns, error: "" });
    } catch (err) {
      setImportState({ ...EMPTY_IMPORT, open: true, fileName: file.name, error: err.message });
    } finally {
      setImportParsing(false);
    }
  };

  const importSummary = useMemo(() => {
    const total = importState.rows.length;
    const invalid = importState.rows.filter((r) => r.errors.length).length;
    const duplicates = importState.rows.filter((r) => !r.errors.length && r.duplicate).length;
    const toImport = importState.rows.filter(
      (r) => !r.errors.length && !(skipDuplicates && r.duplicate)
    ).length;
    return { total, invalid, duplicates, toImport };
  }, [importState.rows, skipDuplicates]);

  const confirmImport = async () => {
    if (!canImport) return;
    const entries = importState.rows
      .filter((r) => !r.errors.length && !(skipDuplicates && r.duplicate))
      .map(({ data }) => ({
        serialNumber: data.serialNumber,
        partNumber: data.partNumber,
        machinePart: data.machinePart,
        machine: data.machine,
        quantity: data.quantity,
        client: data.client || undefined,
      }));
    if (entries.length === 0) return;

    setImporting(true);
    setImportProgress(0);
    const created = [];
    try {
      for (let i = 0; i < entries.length; i += IMPORT_CHUNK) {
        const chunk = entries.slice(i, i + IMPORT_CHUNK);

        const res = await fetch(`${API_BASE}/store/bulk`, {
          method: "POST",
          headers: authHeaders(),
          body: JSON.stringify({ items: chunk }),
        });
        const data = await safeJson(res);
        if (!res.ok) throw new Error(data.message || "Bulk import failed.");
        created.push(...(data.created || []));
        setImportProgress(Math.round(((i + chunk.length) / entries.length) * 100));
      }
      setItems((prev) => [...created, ...prev]);
      notifyStoreChanged();
      fetchOwed(); // new stock may replace owed stock — refresh the Owed chips
      setImportState(EMPTY_IMPORT);
      setSuccessMsg(`${created.length} part${created.length === 1 ? "" : "s"} imported.`);
      setTimeout(() => setSuccessMsg(""), 3000);
    } catch (err) {
      // Earlier chunks may already be saved — show them and say so.
      if (created.length) {
        setItems((prev) => [...created, ...prev]);
        notifyStoreChanged();
        fetchOwed();
      }
      setImportState(EMPTY_IMPORT);
      showErrorDialog(
        "Import stopped",
        `${err.message}${created.length ? ` ${created.length} of ${entries.length} parts were saved before the error. Re-importing the same file will skip those (duplicates are detected).` : " Nothing was saved."}`
      );
    } finally {
      setImporting(false);
      setImportProgress(0);
    }
  };

  const handleDownloadTemplate = async () => {
    try {
      await downloadStoreTemplate(MACHINE_TYPES);
    } catch {
      showErrorDialog("Template failed", 'Could not create the template. Make sure "xlsx" is installed (npm install xlsx).');
    }
  };

  // ---- low-stock filter toggle -------------------------------------------------
  const toggleLowStockOnly = () => setLowStockOnly((v) => !v);
  const clearLowStockOnly = () => setLowStockOnly(false);
  const toggleOwedOnly = () => setOwedOnly((v) => !v);
  const clearOwedOnly = () => setOwedOnly(false);

  // ---- public API returned to the UI component --------------------------------
  return {
    // data
    clients,
    rows,
    filtered,
    summary,
    isAllTab,
    currentMachineType,
    loading,
    loadError,

    // tabs
    activeTab,
    handleTabChange,

    // form state + handlers
    formOpen,
    setFormOpen,
    openFormIfAuthorised,
    form,
    submitting,
    handleFormChange,
    handleAdd,

    // row actions
    adjustQuantity,
    handleDelete,

    // search
    search,
    setSearch,

    // owed to clients
    owedOnly,
    toggleOwedOnly,
    clearOwedOnly,
    totalOwed,
    canSettle,
    openSettle,
    settleDialog,
    settling,
    closeSettle,
    changeSettleQty,
    confirmSettle,

    // low stock filter
    lowStockOnly,
    toggleLowStockOnly,
    clearLowStockOnly,

    // confirm dialog
    confirmDialog,
    closeConfirmDialog,
    submitConfirmDialog,

    // export
    handleExport,

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

    // feedback
    successMsg,

    // error / access-denied dialog
    errorDialog,
    closeErrorDialog,

    // permissions
    canAddPart,
    canImport,
    canAdjustQuantity,
    canDelete,
    canExport,
  };
};