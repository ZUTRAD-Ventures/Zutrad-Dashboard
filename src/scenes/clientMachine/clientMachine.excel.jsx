// ─────────────────────────────────────────────────────────────────────────────
// clientMachine.excel.jsx – Pure helpers for bulk-importing CLIENT MACHINES from
// an Excel/CSV file and for downloading a blank template. No React / JSX here.
//
// Same approach as store.excel.jsx: the browser reads + validates the file, the
// user previews the result, then the valid rows are sent to the backend in
// chunks (POST /clients/machines/bulk).
//
// Requires the SheetJS package (already used by the Store page):  npm install xlsx
// It is loaded lazily so it only costs bundle size when the dialog is used.
// ─────────────────────────────────────────────────────────────────────────────

export const MAX_IMPORT_ROWS = 5000;
export const MAX_IMPORT_BYTES = 5 * 1024 * 1024; // 5 MB
export const ACCEPTED_EXT = [".xlsx", ".xls", ".csv"];

// Accepted header spellings → canonical field. Matching ignores case, spaces,
// dots, brackets and punctuation ("Line No." == "line_no").
const HEADER_ALIASES = {
  serialNumber:        ["serialnumber", "serialno", "serialnum", "serial", "sn", "machineserial", "machineserialnumber"],
  client:              ["client", "clientname", "company", "companyname", "customer"],
  machine:             ["machinetype", "machine", "type", "machinemodel", "model"],
  lineInstalled:       ["linenumber", "lineno", "linenum", "line", "lineinstalled"],
  installedDate:       ["installationdate", "installeddate", "installdate", "dateinstalled", "installed", "dateofinstallation"],
  maintenanceCycle:    ["maintenancecyclemonths", "maintenancecycle", "maintcycle", "cyclemonths", "cycle", "maintenanceinterval"],
  // OPTIONAL — defaults to the installation date (same as the Register form)
  lastMaintenanceDate: ["lastmaintenancedate", "lastmaintenance", "lastmaint", "lastmaintdate", "lastservice", "lastservicedate"],
};

const REQUIRED_FIELDS = ["serialNumber", "client", "machine", "lineInstalled", "installedDate", "maintenanceCycle"];

export const FIELD_LABELS = {
  serialNumber: "Serial Number",
  client: "Client",
  machine: "Machine Type",
  lineInstalled: "Line Number",
  installedDate: "Installation Date",
  maintenanceCycle: "Maintenance Cycle (months)",
  lastMaintenanceDate: "Last Maintenance Date",
};

const norm = (s) => String(s ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
const text = (v) => String(v ?? "").trim();
const pad2 = (n) => String(n).padStart(2, "0");

// ── value parsers ───────────────────────────────────────────────────────────

// Whole number >= 1. Accepts 4, "4", "Line 4" (line) and "6 months" (cycle).
const parsePositiveInt = (value) => {
  if (value === null || value === undefined || value === "") return null;
  let n;
  if (typeof value === "number") n = value;
  else {
    const m = String(value).trim().match(/^(?:line\s*)?(\d+)\s*(?:months?|mos?|m)?$/i);
    n = m ? Number(m[1]) : NaN;
  }
  return Number.isInteger(n) && n >= 1 ? n : null;
};

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

const toISO = (y, m, d) => {
  if (y < 1970 || y > 2100 || m < 1 || m > 12 || d < 1 || d > 31) return null;
  const check = new Date(Date.UTC(y, m - 1, d));
  if (check.getUTCFullYear() !== y || check.getUTCMonth() !== m - 1 || check.getUTCDate() !== d) return null; // e.g. 31/02
  return `${y}-${pad2(m)}-${pad2(d)}`;
};

const fromExcelSerial = (n) => {
  if (!Number.isFinite(n) || n < 1 || n > 80000) return null;
  const d = new Date(Date.UTC(1899, 11, 30) + Math.floor(n) * 86400000);
  return toISO(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
};

// Returns { value: "YYYY-MM-DD" | "" , invalid: bool }.
// Handles Excel date cells (serial numbers), "17/09/2018", "17-09-2018",
// "2018-09-17", "17 Sep 2018". Day-first is assumed (the app's default) unless
// the numbers make that impossible (e.g. "09/17/2018").
export const parseDateCell = (v) => {
  if (v === null || v === undefined || v === "") return { value: "", invalid: false };

  if (v instanceof Date) {
    const iso = isNaN(v.getTime()) ? null : toISO(v.getFullYear(), v.getMonth() + 1, v.getDate());
    return iso ? { value: iso, invalid: false } : { value: "", invalid: true };
  }
  if (typeof v === "number") {
    const iso = fromExcelSerial(v);
    return iso ? { value: iso, invalid: false } : { value: "", invalid: true };
  }

  const s = String(v).trim();
  let m;
  let iso = null;

  if ((m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?:[T\s].*)?$/))) {
    iso = toISO(+m[1], +m[2], +m[3]);
  } else if ((m = s.match(/^(\d{1,2})[-/. ](\d{1,2})[-/. ](\d{2}|\d{4})$/))) {
    let a = +m[1], b = +m[2], y = +m[3];
    if (y < 100) y += y <= 69 ? 2000 : 1900;
    iso = b > 12 && a <= 12 ? toISO(y, a, b) : toISO(y, b, a); // day-first by default
  } else if ((m = s.match(/^(\d{1,2})[-/ ]([A-Za-z]{3,9})\.?[-/ ,]*(\d{2}|\d{4})$/))) {
    const mon = MONTHS.indexOf(m[2].slice(0, 3).toLowerCase()) + 1;
    let y = +m[3];
    if (y < 100) y += y <= 69 ? 2000 : 1900;
    iso = mon ? toISO(y, mon, +m[1]) : null;
  } else if (/^\d{5}$/.test(s)) {
    iso = fromExcelSerial(Number(s)); // a date cell exported to CSV as a bare serial
  }

  return iso ? { value: iso, invalid: false } : { value: "", invalid: true };
};

// ── turn a sheet grid into validated rows (pure — easy to test) ─────────────
// grid:           array of arrays (first sheet)
// machineTypes:   ["Macsa ID", "Savema", ...]
// clients:        [{ id, companyName }]
// existing:       current machines (flags duplicate serial numbers)
// opts.defaultClientName: used when the file has no Client column
export const buildMachineRows = (grid, { machineTypes, clients = [], existing = [], defaultClientName = "" }) => {
  if (!grid.length) throw new Error("The file is empty.");

  const aliasToField = {};
  Object.entries(HEADER_ALIASES).forEach(([field, list]) => list.forEach((a) => (aliasToField[a] = field)));

  // Find the header row within the first 10 rows (tolerates title rows above).
  let headerIdx = -1, colIdx = {};
  for (let i = 0; i < Math.min(grid.length, 10); i++) {
    const found = {};
    grid[i].forEach((cell, c) => {
      const f = aliasToField[norm(cell)];
      if (f && found[f] === undefined) found[f] = c;
    });
    if (Object.keys(found).length >= 3 && Object.keys(found).length > Object.keys(colIdx).length) {
      headerIdx = i;
      colIdx = found;
    }
  }
  if (headerIdx === -1) {
    throw new Error(
      "Could not find the header row. The first row should contain: Serial Number, Client, Machine Type, Line Number, Installation Date, Maintenance Cycle (months). Use the template if unsure."
    );
  }

  const missingColumns = REQUIRED_FIELDS
    .filter((f) => colIdx[f] === undefined)
    .filter((f) => !(f === "client" && defaultClientName))
    .map((f) => FIELD_LABELS[f]);

  const dataRows = grid.slice(headerIdx + 1).filter((r) => r.some((c) => text(c) !== ""));
  if (dataRows.length === 0) throw new Error("No data rows found under the header.");
  if (dataRows.length > MAX_IMPORT_ROWS) {
    throw new Error(`This file has ${dataRows.length.toLocaleString()} rows. The maximum per import is ${MAX_IMPORT_ROWS.toLocaleString()}.`);
  }

  const machineByName = new Map(machineTypes.map((m) => [norm(m), m]));
  const clientByName = new Map(clients.map((c) => [norm(c.companyName), c]));

  // Same rule as the backend: serial numbers are unique across ALL clients,
  // compared trimmed and case-insensitively.
  const keyOf = (serial) => text(serial).toLowerCase();
  const existingKeys = new Set(existing.map((m) => keyOf(m.serialNumber)));
  const seenInFile = new Set();

  const rows = dataRows.map((r, i) => {
    const get = (f) => (colIdx[f] === undefined ? "" : r[colIdx[f]]);
    const errors = [];

    const serialNumber = text(get("serialNumber"));
    if (!serialNumber) errors.push("Serial Number is empty");
    else if (serialNumber.length > 100) errors.push("Serial Number is longer than 100 characters");

    // client
    const clientRaw = colIdx.client === undefined ? defaultClientName : text(get("client"));
    const clientDoc = clientByName.get(norm(clientRaw));
    if (!clientRaw) errors.push("Client is empty");
    else if (!clientDoc) errors.push(`Client "${clientRaw}" not found (add it under All Clients first)`);

    // machine type
    const machineRaw = text(get("machine"));
    const machine = machineByName.get(norm(machineRaw));
    if (!machineRaw) errors.push("Machine Type is empty");
    else if (!machine) errors.push(`Machine Type "${machineRaw}" not recognised (use: ${machineTypes.join(", ")})`);

    // line + cycle
    const lineInstalled = parsePositiveInt(get("lineInstalled"));
    if (lineInstalled === null) errors.push("Line Number must be a whole number, 1 or more");
    const maintenanceCycle = parsePositiveInt(get("maintenanceCycle"));
    if (maintenanceCycle === null) errors.push("Maintenance Cycle must be a whole number of months, 1 or more");

    // dates
    const inst = parseDateCell(get("installedDate"));
    if (!inst.value) errors.push(inst.invalid ? "Installation Date is not a valid date" : "Installation Date is empty");
    const last = parseDateCell(get("lastMaintenanceDate"));
    if (last.invalid) errors.push("Last Maintenance Date is not a valid date");
    const lastMaintenanceDate = last.value || inst.value; // blank → installation date, like the Register form

    let duplicate = false;
    if (serialNumber) {
      const k = keyOf(serialNumber);
      duplicate = !errors.length && (existingKeys.has(k) || seenInFile.has(k));
      if (!errors.length) seenInFile.add(k);
    }

    return {
      rowNum: headerIdx + 2 + i, // spreadsheet row number as the user sees it
      data: {
        serialNumber,
        clientId: clientDoc?.id ?? "",
        clientName: clientDoc?.companyName ?? clientRaw,
        machine: machine ?? machineRaw,
        lineInstalled: lineInstalled ?? "",
        installedDate: inst.value,
        maintenanceCycle: maintenanceCycle ?? "",
        lastMaintenanceDate,
      },
      errors,
      duplicate,
    };
  });

  return { rows, missingColumns };
};

// ── parse a File into validated rows ────────────────────────────────────────
// Throws an Error with a user-friendly message for unreadable files.
export const parseMachineFile = async (file, config) => {
  const ext = "." + (file.name.split(".").pop() || "").toLowerCase();
  if (!ACCEPTED_EXT.includes(ext)) {
    throw new Error("Unsupported file type. Please upload an .xlsx, .xls or .csv file.");
  }
  if (file.size > MAX_IMPORT_BYTES) {
    throw new Error("File is larger than 5 MB. Split it into smaller files and import them one at a time.");
  }

  let XLSX;
  try {
    XLSX = await import("xlsx");
  } catch {
    throw new Error('The "xlsx" package is not installed. Run "npm install xlsx" and restart the dev server.');
  }

  let grid;
  try {
    const buf = await file.arrayBuffer();
    const wb = XLSX.read(buf, { type: "array" }); // dates stay as Excel serial numbers → parseDateCell
    const ws = wb.Sheets[wb.SheetNames[0]];
    if (!ws) throw new Error("empty");
    grid = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: "", blankrows: false });
  } catch {
    throw new Error("Could not read this file. Make sure it is a valid, non-password-protected Excel or CSV file.");
  }

  return buildMachineRows(grid, config);
};

// ── blank template download ─────────────────────────────────────────────────
export const downloadMachineTemplate = async ({ machineTypes, clientNames = [] }) => {
  const XLSX = await import("xlsx");
  const ws = XLSX.utils.aoa_to_sheet([
    ["Serial Number", "Client", "Machine Type", "Line Number", "Installation Date", "Maintenance Cycle (months)", "Last Maintenance Date"],
    ["17294 SA1030 1805", clientNames[0] ?? "", machineTypes[0] ?? "Macsa ID", 4, "17/09/2018", 6, ""],
  ]);
  ws["!cols"] = [{ wch: 22 }, { wch: 26 }, { wch: 16 }, { wch: 13 }, { wch: 18 }, { wch: 26 }, { wch: 22 }];

  const help = XLSX.utils.aoa_to_sheet([
    ["How to fill in the Machines sheet"],
    ["Required: Serial Number, Client, Machine Type, Line Number, Installation Date, Maintenance Cycle (months)."],
    ["Optional: Last Maintenance Date (blank = same as Installation Date)."],
    ["Client must match an existing client name (see the 'Clients' sheet). Machine Type must match the 'Lists' sheet."],
    ["Dates: type them as normal Excel dates, or as day/month/year (e.g. 17/09/2018). Line Number and Maintenance Cycle are whole numbers."],
    ["Serial Numbers must be unique across all clients. Rows whose Serial Number already exists are flagged as possible duplicates."],
    ["Only the first sheet is imported. Maximum 5,000 rows per file."],
  ]);
  help["!cols"] = [{ wch: 120 }];

  const lists = XLSX.utils.aoa_to_sheet([["Valid Machine Types"], ...machineTypes.map((m) => [m])]);
  lists["!cols"] = [{ wch: 26 }];

  const clientsSheet = XLSX.utils.aoa_to_sheet([["Existing Clients (copy exactly)"], ...clientNames.map((n) => [n])]);
  clientsSheet["!cols"] = [{ wch: 40 }];

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Machines");
  XLSX.utils.book_append_sheet(wb, clientsSheet, "Clients");
  XLSX.utils.book_append_sheet(wb, lists, "Lists");
  XLSX.utils.book_append_sheet(wb, help, "Help");
  XLSX.writeFile(wb, "zutrad_machines_template.xlsx");
};
