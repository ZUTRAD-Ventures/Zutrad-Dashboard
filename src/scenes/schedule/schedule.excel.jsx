// ─────────────────────────────────────────────────────────────────────────────
// schedule.excel.jsx – Pure helpers for bulk-importing SCHEDULE tasks from an
// Excel/CSV file and for downloading a blank template. No React / JSX in here.
//
// Uses the same SheetJS package as the Store import (npm install xlsx), loaded
// lazily so it only costs bundle size when the import dialog is used.
// ─────────────────────────────────────────────────────────────────────────────

export const MAX_IMPORT_ROWS = 2000;
export const MAX_IMPORT_BYTES = 5 * 1024 * 1024; // 5 MB
export const ACCEPTED_EXT = [".xlsx", ".xls", ".csv"];

const TITLE_MIN = 3;
const TITLE_MAX = 120;
const DESCRIPTION_MAX = 1000;

// Accepted header spellings → canonical field. Matching ignores case, spaces,
// dots, underscores and punctuation ("Due Date" == "due_date").
const HEADER_ALIASES = {
  title:       ["title", "tasktitle", "task", "taskname"],
  description: ["description", "details", "instructions", "descriptioninstructions", "notes", "note"],
  assignedTo:  ["assignedto", "assignee", "assigned", "person", "responsible", "employee", "staff", "user", "email"],
  dueDate:     ["duedate", "due", "deadline", "date"],
};

const REQUIRED_FIELDS = ["title", "assignedTo", "dueDate"];

export const FIELD_LABELS = {
  title: "Title",
  description: "Description",
  assignedTo: "Assigned To",
  dueDate: "Due Date",
};

const norm = (s) => String(s ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
const text = (v) => String(v ?? "").trim();
const pad = (n) => String(n).padStart(2, "0");

const localDateKey = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

// Returns "YYYY-MM-DD" only if y/m/d is a real calendar day.
const buildKey = (y, m, d) => {
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
  return `${y}-${pad(m)}-${pad(d)}`;
};

// Excel date cells arrive as serial numbers; typed text can be 2026-12-31 or
// 31/12/2026 (day first — same as the app's default date format).
const parseDueDate = (value) => {
  if (value instanceof Date && !isNaN(value)) {
    return buildKey(value.getFullYear(), value.getMonth() + 1, value.getDate());
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value) || value < 1 || value > 80000) return null;
    // Excel serial day → calendar day (serial 25569 = 1970-01-01). Plain math,
    // so it does not depend on how the xlsx package exposes its helpers.
    const dt = new Date(Math.round((Math.floor(value) - 25569) * 86400000));
    return buildKey(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate());
  }
  const s = text(value);
  if (!s) return null;
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return buildKey(Number(m[1]), Number(m[2]), Number(m[3]));
  m = s.match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2}|\d{4})$/);
  if (m) {
    const y = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
    return buildKey(y, Number(m[2]), Number(m[1]));
  }
  return null;
};

const personName = (u) => `${u.firstName ?? ""} ${u.surname ?? ""}`.trim();

// ── parse a File into validated rows ────────────────────────────────────────
// assignees: users from /auth/users ({ id, firstName, surname, email, role })
// existing:  current schedules (used to flag duplicates)
// Returns { rows: [{ rowNum, data, errors, duplicate }], missingColumns: [] }
// Throws an Error with a user-friendly message for unreadable files.
export const parseScheduleFile = async (file, assignees = [], existing = []) => {
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
    const wb = XLSX.read(buf, { type: "array" });
    const ws = wb.Sheets[wb.SheetNames[0]];
    if (!ws) throw new Error("empty");
    grid = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: "", blankrows: false });
  } catch {
    throw new Error("Could not read this file. Make sure it is a valid, non-password-protected Excel or CSV file.");
  }

  if (!grid.length) throw new Error("The file is empty.");

  // Find the header row within the first 10 rows (tolerates title rows above).
  const aliasToField = {};
  Object.entries(HEADER_ALIASES).forEach(([field, list]) => list.forEach((a) => (aliasToField[a] = field)));

  let headerIdx = -1, colIdx = {};
  for (let i = 0; i < Math.min(grid.length, 10); i++) {
    const found = {};
    grid[i].forEach((cell, c) => {
      const f = aliasToField[norm(cell)];
      if (f && found[f] === undefined) found[f] = c;
    });
    if (Object.keys(found).length >= 2 && Object.keys(found).length > Object.keys(colIdx).length) {
      headerIdx = i;
      colIdx = found;
    }
  }
  if (headerIdx === -1) {
    throw new Error(
      "Could not find the header row. The first row should contain: Title, Description, Assigned To, Due Date. Use the template if unsure."
    );
  }

  const missingColumns = REQUIRED_FIELDS.filter((f) => colIdx[f] === undefined).map((f) => FIELD_LABELS[f]);

  const dataRows = grid.slice(headerIdx + 1).filter((r) => r.some((c) => text(c) !== ""));
  if (dataRows.length === 0) throw new Error("No data rows found under the header.");
  if (dataRows.length > MAX_IMPORT_ROWS) {
    throw new Error(`This file has ${dataRows.length.toLocaleString()} rows. The maximum per import is ${MAX_IMPORT_ROWS.toLocaleString()}.`);
  }

  // people lookup: by email (unique), then "First Surname" (as shown in the app),
  // and only if that finds nobody, "Surname First". Trying the app's order first
  // keeps "Lewin Authur" and "Authur Lewin" (two different people) apart.
  const byEmail = new Map();
  const byFull = new Map();
  const byReversed = new Map();
  const addTo = (map, key, u) => {
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(u);
  };
  assignees.forEach((u) => {
    if (u.email) byEmail.set(norm(u.email), u);
    addTo(byFull, norm(`${u.firstName}${u.surname}`), u);
    addTo(byReversed, norm(`${u.surname}${u.firstName}`), u);
  });

  const todayKey = localDateKey(new Date());
  const keyOf = (title, userId, due) => [norm(title), String(userId), due].join("|");
  const existingKeys = new Set(
    existing
      .filter((s) => s.status === "pending")
      .map((s) => keyOf(s.title, s.assignedTo?._id ?? s.assignedTo?.id ?? s.assignedTo, new Date(s.dueDate).toISOString().slice(0, 10)))
  );
  const seenInFile = new Set();

  const rows = dataRows.map((r, i) => {
    const get = (f) => (colIdx[f] === undefined ? "" : r[colIdx[f]]);
    const errors = [];

    const title = text(get("title"));
    const description = text(get("description"));
    const assigneeText = text(get("assignedTo"));
    const dueRaw = get("dueDate");
    const dueDate = parseDueDate(dueRaw);

    if (title.length < TITLE_MIN) errors.push(title ? `Title must be at least ${TITLE_MIN} characters` : "Title is empty");
    else if (title.length > TITLE_MAX) errors.push(`Title is longer than ${TITLE_MAX} characters`);
    if (description.length > DESCRIPTION_MAX) errors.push(`Description is longer than ${DESCRIPTION_MAX} characters`);

    let user = null;
    if (!assigneeText) {
      errors.push("Assigned To is empty");
    } else {
      user = byEmail.get(norm(assigneeText)) ?? null;
      if (!user) {
        const key = norm(assigneeText);
        const exact = byFull.get(key) ?? [];
        const matches = exact.length ? exact : byReversed.get(key) ?? [];
        if (matches.length === 1) user = matches[0];
        else if (matches.length > 1) errors.push(`"${assigneeText}" matches more than one person — use their email`);
        else errors.push(`Person "${assigneeText}" not found`);
      }
    }

    if (text(dueRaw) === "") errors.push("Due Date is empty");
    else if (!dueDate) errors.push("Due Date not recognised (use YYYY-MM-DD or DD/MM/YYYY)");
    else if (dueDate < todayKey) errors.push("Due Date is in the past");

    let duplicate = false;
    if (!errors.length) {
      const k = keyOf(title, user.id, dueDate);
      duplicate = existingKeys.has(k) || seenInFile.has(k);
      seenInFile.add(k);
    }

    return {
      rowNum: headerIdx + 2 + i, // spreadsheet row number as the user sees it
      data: {
        title,
        description,
        assigneeText,
        assignedTo: user?.id ?? "",
        assigneeName: user ? personName(user) : "",
        dueDate: dueDate ?? text(dueRaw),
      },
      errors,
      duplicate,
    };
  });

  return { rows, missingColumns };
};

// ── blank template download ─────────────────────────────────────────────────
export const downloadScheduleTemplate = async (assignees = []) => {
  const XLSX = await import("xlsx");
  const nextWeek = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  const sample = [
    "Service printer on Line 2",
    "Replace ribbon and run a test print",
    assignees[0] ? personName(assignees[0]) : "First Surname",
    localDateKey(nextWeek),
  ];
  const ws = XLSX.utils.aoa_to_sheet([["Title", "Description", "Assigned To", "Due Date"], sample]);
  ws["!cols"] = [{ wch: 36 }, { wch: 44 }, { wch: 26 }, { wch: 14 }];

  const help = XLSX.utils.aoa_to_sheet([
    ["How to fill in the Schedule sheet"],
    ["Required: Title, Assigned To, Due Date. Description is optional."],
    ["Title must be 3 to 120 characters. Description can be up to 1000 characters."],
    ["Assigned To: a person's full name (First Surname, as shown in the app) or their email, as listed on the 'People' sheet."],
    ["Due Date: a real Excel date, or text as YYYY-MM-DD or DD/MM/YYYY. It cannot be in the past."],
    ["Rows with the same Title + person + Due Date as a pending task are flagged as possible duplicates."],
    ["Only the first sheet is imported. Maximum 2,000 rows per file."],
  ]);
  help["!cols"] = [{ wch: 100 }];

  const people = XLSX.utils.aoa_to_sheet([
    ["Name", "Email", "Role"],
    ...assignees.map((u) => [personName(u), u.email ?? "", u.role ?? ""]),
  ]);
  people["!cols"] = [{ wch: 30 }, { wch: 36 }, { wch: 16 }];

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Schedule");
  XLSX.utils.book_append_sheet(wb, people, "People");
  XLSX.utils.book_append_sheet(wb, help, "Help");
  XLSX.writeFile(wb, "zutrad_schedule_template.xlsx");
};