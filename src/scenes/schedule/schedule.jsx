// ─────────────────────────────────────────────────────────────────────────────
// SchedulePage.jsx – Pure UI. All logic/state lives in useSchedulePage.
//
// Internal task-assignment & accountability page (admins + superadmins only).
// Visual language mirrors ReportsPage: stat tiles, collapsible create form,
// status tabs + search toolbar, left-bordered cards, same dialogs/toast.
//
// BACKEND: this page needs a /schedules API that does NOT exist yet. The full
// contract (collection fields, endpoints, role guard, completion stamping,
// 21-day archive job) is documented at the top of schedule.logic.jsx.
// ─────────────────────────────────────────────────────────────────────────────

import {
  Box, Typography, useTheme, Button, TextField, MenuItem, Collapse,
  IconButton, Chip, Snackbar, Alert, Stack, Divider, CircularProgress,
  Dialog, DialogTitle, DialogContent, DialogContentText, DialogActions,
  Table, TableHead, TableBody, TableRow, TableCell, TableContainer,
  LinearProgress, FormControlLabel, Checkbox,
} from "@mui/material";
import { tokens } from "../../theme";
import KeyboardArrowDownIcon from "@mui/icons-material/KeyboardArrowDown";
import KeyboardArrowUpIcon from "@mui/icons-material/KeyboardArrowUp";
import CheckCircleOutlineIcon from "@mui/icons-material/CheckCircleOutline";
import SearchOutlinedIcon from "@mui/icons-material/SearchOutlined";
import AddOutlinedIcon from "@mui/icons-material/AddOutlined";
import EventNoteOutlinedIcon from "@mui/icons-material/EventNoteOutlined";
import PendingOutlinedIcon from "@mui/icons-material/PendingOutlined";
import TaskAltOutlinedIcon from "@mui/icons-material/TaskAltOutlined";
import WarningAmberOutlinedIcon from "@mui/icons-material/WarningAmberOutlined";
import PersonOutlineOutlinedIcon from "@mui/icons-material/PersonOutlineOutlined";
import ErrorOutlineIcon from "@mui/icons-material/ErrorOutline";
import UploadFileOutlinedIcon from "@mui/icons-material/UploadFileOutlined";
import DownloadOutlinedIcon from "@mui/icons-material/DownloadOutlined";
import Header from "../../components/Header";
import { useDateFormat } from "../settings/dateFormat.logic";
import {
  STATUS_TABS, TITLE_MAX, DESCRIPTION_MAX, COMPLETED_RETENTION_DAYS,
  statusStyles, getTabColor, getDisplayState, isDueToday, fullName,
  daysUntilRemoval, removalDate, useSchedulePage,
} from "./schedule.logic";

/* ── StatCard (same shape as Reports/Supply) ─────────────────────────────── */
const StatCard = ({ icon, label, value, accent, colors }) => (
  <Box
    display="flex" alignItems="center" gap="12px" px="18px" py="12px"
    backgroundColor={colors.primary[400]} borderRadius="6px"
    borderLeft={`3px solid ${accent}`} minWidth="150px"
  >
    <Box color={accent} display="flex">{icon}</Box>
    <Box>
      <Typography fontSize="20px" fontWeight="700" color={colors.grey[100]} lineHeight={1}>{value}</Typography>
      <Typography fontSize="11px" color={colors.grey[400]} mt="2px">{label}</Typography>
    </Box>
  </Box>
);

/* ── Small labelled value used in each card's detail grid ────────────────── */
const Meta = ({ label, children, colors }) => (
  <Box minWidth={0}>
    <Typography fontSize="11px" color={colors.grey[500]} sx={{ textTransform: "uppercase", letterSpacing: "0.05em" }}>
      {label}
    </Typography>
    <Typography fontSize="13px" color={colors.grey[100]} fontWeight={500} sx={{ wordBreak: "break-word" }}>
      {children}
    </Typography>
  </Box>
);

const SchedulePage = () => {
  const theme = useTheme();
  const colors = tokens(theme.palette.mode);

  const {
    visible, filtered, counts, assignees, loading, loadError, fetchSchedules,
    search, setSearch, activeTab, setActiveTab, clearFilters,
    formOpen, setFormOpen, form, formError, submitting,
    handleChange, handleSubmit, handleCancelForm,
    importState, importParsing, importing, importProgress, importSummary,
    skipDuplicates, setSkipDuplicates,
    openImport, closeImport, handleImportFile, confirmImport, handleDownloadTemplate,
    handleComplete, completingId,
    confirmDialog, closeConfirmDialog, submitConfirmDialog,
    toast, closeToast, errorDialog, closeErrorDialog,
    canManage,
  } = useSchedulePage();
  const { formatDate, formatDateTime } = useDateFormat();

  const stateIcon = {
    completed: <TaskAltOutlinedIcon sx={{ fontSize: 14 }} />,
    overdue: <WarningAmberOutlinedIcon sx={{ fontSize: 14 }} />,
    pending: <PendingOutlinedIcon sx={{ fontSize: 14 }} />,
  };
  const stateLabel = { completed: "Completed", overdue: "Overdue", pending: "Pending" };

  // Defensive UI guard — the route is already admin-only (App.js protectAdmin)
  // and the backend must enforce the same rule (see schedule.logic.jsx §2/§3).
  if (!canManage) {
    return (
      <Box m="20px">
        <Header title="SCHEDULE" subtitle="Task Assignments & Accountability" />
        <Alert severity="error">Only administrators and superadmins can access the Schedule page.</Alert>
      </Box>
    );
  }

  return (
    <Box m="20px">
      <Header title="SCHEDULE" subtitle="Task Assignments & Accountability" />

      {/* STATS BAR */}
      <Stack direction="row" mt="24px" flexWrap="wrap" gap="12px">
        <StatCard icon={<EventNoteOutlinedIcon />} label="Total Tasks" value={counts.all} accent={colors.grey[400]} colors={colors} />
        <StatCard icon={<PendingOutlinedIcon />} label="Pending" value={counts.pending} accent={colors.blueAccent[400]} colors={colors} />
        <StatCard icon={<WarningAmberOutlinedIcon />} label="Overdue" value={counts.overdue} accent={counts.overdue > 0 ? colors.redAccent[400] : colors.grey[500]} colors={colors} />
        <StatCard icon={<TaskAltOutlinedIcon />} label="Completed" value={counts.completed} accent={colors.greenAccent[400]} colors={colors} />
      </Stack>

      {/* CREATE FORM (collapsible) */}
      <Box mt="24px" mb="16px" backgroundColor={colors.primary[400]} borderRadius="6px" overflow="hidden">
        <Box
          display="flex" justifyContent="space-between" alignItems="center"
          p="12px 16px" sx={{ cursor: "pointer" }}
          onClick={() => (formOpen ? handleCancelForm() : setFormOpen(true))}
        >
          <Box display="flex" alignItems="center" gap="8px">
            <AddOutlinedIcon sx={{ color: colors.greenAccent[400], fontSize: "18px" }} />
            <Typography color={colors.grey[100]} fontWeight="600" fontSize="14px">Assign New Task</Typography>
          </Box>
          <IconButton size="small" sx={{ color: colors.greenAccent[400] }}>
            {formOpen ? <KeyboardArrowUpIcon /> : <KeyboardArrowDownIcon />}
          </IconButton>
        </Box>

        <Collapse in={formOpen}>
          <Box
            p="16px" display="grid" gap="16px"
            gridTemplateColumns={{ xs: "1fr", sm: "repeat(2, 1fr)" }}
            borderTop={`1px solid ${colors.primary[300]}`}
          >
            <TextField
              variant="filled" label="Task Title" name="title" value={form.title} onChange={handleChange}
              fullWidth sx={{ gridColumn: { sm: "span 2" } }} inputProps={{ maxLength: TITLE_MAX }}
              error={!!formError && !form.title.trim()} disabled={submitting}
            />
            <TextField
              variant="filled" label="Description / Instructions (optional)" name="description"
              value={form.description} onChange={handleChange} multiline rows={3} fullWidth
              sx={{ gridColumn: { sm: "span 2" } }} inputProps={{ maxLength: DESCRIPTION_MAX }}
              disabled={submitting}
            />
            <TextField
              select variant="filled" label="Assigned To" name="assignedTo"
              value={form.assignedTo} onChange={handleChange} fullWidth
              error={!!formError && !form.assignedTo} disabled={submitting}
              helperText={assignees.length === 0 ? "No users could be loaded." : ""}
            >
              {assignees.map((u) => (
                <MenuItem key={u.id} value={u.id}>
                  {fullName(u)}{u.role ? ` · ${u.role}` : ""}
                </MenuItem>
              ))}
            </TextField>
            <TextField
              variant="filled" label="Due Date" name="dueDate" type="date"
              value={form.dueDate} onChange={handleChange} fullWidth
              InputLabelProps={{ shrink: true }} error={!!formError && !form.dueDate} disabled={submitting}
            />
            {formError && (
              <Box sx={{ gridColumn: { sm: "span 2" } }}>
                <Alert severity="error" sx={{ fontSize: "12px", py: "2px" }}>{formError}</Alert>
              </Box>
            )}
            <Box sx={{ gridColumn: { sm: "span 2" } }} display="flex" justifyContent="flex-end" gap="10px">
              <Button
                size="small" variant="outlined" onClick={handleCancelForm} disabled={submitting}
                sx={{ borderColor: colors.grey[600], color: colors.grey[300], textTransform: "none" }}
              >
                Cancel
              </Button>
              <Button
                variant="contained" color="secondary" onClick={handleSubmit} disabled={submitting}
                startIcon={submitting ? <CircularProgress size={14} color="inherit" /> : null}
                sx={{ px: "28px", textTransform: "none" }}
              >
                {submitting ? "Saving…" : "Assign Task"}
              </Button>
            </Box>
          </Box>
        </Collapse>
      </Box>

      {/* TOOLBAR: tabs + search */}
      <Box display="flex" alignItems="center" justifyContent="space-between" flexWrap="wrap" gap="12px" mb="16px">
        <Stack direction="row" spacing={0.5} flexWrap="wrap" useFlexGap>
          {STATUS_TABS.map((tab) => {
            const active = activeTab === tab;
            return (
              <Button
                key={tab} size="small" onClick={() => setActiveTab(tab)}
                sx={{
                  textTransform: "capitalize", fontSize: "12px", px: "12px", borderRadius: "4px",
                  backgroundColor: active ? colors.primary[300] : "transparent",
                  color: active ? getTabColor(tab, colors) : colors.grey[500],
                  borderBottom: active ? `2px solid ${getTabColor(tab, colors)}` : "2px solid transparent",
                  "&:hover": { backgroundColor: colors.primary[300] },
                }}
              >
                {tab} ({counts[tab]})
              </Button>
            );
          })}
        </Stack>

        <Stack direction="row" spacing={1.5} alignItems="center" sx={{ width: { xs: "100%", sm: "auto" } }}>
          <TextField
            variant="outlined" size="small" placeholder="Search task, person…"
            value={search} onChange={(e) => setSearch(e.target.value)}
            InputProps={{ startAdornment: <SearchOutlinedIcon sx={{ color: colors.grey[400], mr: "6px", fontSize: "18px" }} /> }}
            sx={{
              width: { xs: "100%", sm: 250 },
              "& .MuiOutlinedInput-root": { backgroundColor: colors.primary[400], fontSize: "13px" },
            }}
          />
          <Typography color={colors.grey[500]} fontSize="12px" sx={{ whiteSpace: "nowrap" }}>
            {filtered.length} / {visible.length}
          </Typography>
          <Button
            size="small" variant="outlined" startIcon={<UploadFileOutlinedIcon />}
            onClick={openImport}
            sx={{
              borderColor: colors.greenAccent[600], color: colors.greenAccent[400],
              fontSize: "12px", textTransform: "none", whiteSpace: "nowrap",
              "&:hover": { borderColor: colors.greenAccent[400], backgroundColor: colors.greenAccent[900] },
            }}
          >
            Import Excel
          </Button>
        </Stack>
      </Box>

      {/* LIST: loading / error / empty / cards */}
      <Box display="flex" flexDirection="column" gap="10px">
        {loading ? (
          <Box py="60px" display="flex" flexDirection="column" alignItems="center" backgroundColor={colors.primary[400]} borderRadius="6px">
            <CircularProgress size={28} color="secondary" />
            <Typography color={colors.grey[500]} fontSize="13px" mt="12px">Loading schedules…</Typography>
          </Box>
        ) : loadError ? (
          <Box py="50px" px="20px" display="flex" flexDirection="column" alignItems="center" textAlign="center" backgroundColor={colors.primary[400]} borderRadius="6px">
            <ErrorOutlineIcon sx={{ fontSize: 40, color: colors.redAccent[400] }} />
            <Typography color={colors.grey[200]} fontSize="14px" mt="10px">Couldn't load schedules</Typography>
            <Typography color={colors.grey[500]} fontSize="12px" mt="4px">{loadError}</Typography>
            <Button size="small" onClick={fetchSchedules} sx={{ mt: "10px", color: colors.blueAccent[300], fontSize: "12px", textTransform: "none" }}>
              Try again
            </Button>
          </Box>
        ) : filtered.length === 0 ? (
          <Box py="60px" display="flex" flexDirection="column" alignItems="center" backgroundColor={colors.primary[400]} borderRadius="6px">
            <EventNoteOutlinedIcon sx={{ fontSize: 40, color: colors.grey[600] }} />
            <Typography color={colors.grey[500]} fontSize="14px" mt="10px">
              {visible.length === 0 ? "No tasks have been assigned yet" : "No tasks match your filters"}
            </Typography>
            {visible.length === 0 ? (
              <Button size="small" onClick={() => setFormOpen(true)} sx={{ mt: "8px", color: colors.blueAccent[300], fontSize: "12px", textTransform: "none" }}>
                Assign the first task
              </Button>
            ) : (
              <Button size="small" onClick={clearFilters} sx={{ mt: "8px", color: colors.blueAccent[300], fontSize: "12px", textTransform: "none" }}>
                Clear filters
              </Button>
            )}
          </Box>
        ) : (
          filtered.map((s) => {
            const state = getDisplayState(s);
            const ss = statusStyles(state, colors);
            const done = s.status === "completed";
            const left = daysUntilRemoval(s);
            return (
              <Box
                key={s.id} backgroundColor={colors.primary[400]} borderRadius="6px"
                borderLeft={`4px solid ${ss.border}`} overflow="hidden"
                sx={{ opacity: done ? 0.85 : 1, transition: "box-shadow 0.15s", "&:hover": { boxShadow: `0 2px 12px ${colors.primary[200]}22` } }}
              >
                <Box p="16px 20px">
                  {/* header */}
                  <Box display="flex" justifyContent="space-between" alignItems="flex-start" gap="12px" mb="10px" flexWrap="wrap">
                    <Box minWidth={0} flex={1}>
                      <Typography
                        color={done ? colors.grey[400] : colors.greenAccent[400]} fontWeight="700" fontSize="15px"
                        sx={{ textDecoration: done ? "line-through" : "none", wordBreak: "break-word" }}
                      >
                        {s.title}
                      </Typography>
                      <Typography color={colors.grey[500]} fontSize="12px" mt="2px" display="flex" alignItems="center" gap="4px">
                        <PersonOutlineOutlinedIcon sx={{ fontSize: 14 }} />
                        Assigned to {fullName(s.assignedTo)}
                      </Typography>
                    </Box>
                    <Chip
                      icon={stateIcon[state]} label={stateLabel[state]} size="small"
                      sx={{
                        backgroundColor: ss.bg, color: ss.text, fontWeight: 600, fontSize: "11px",
                        "& .MuiChip-icon": { color: ss.text },
                      }}
                    />
                  </Box>

                  <Divider sx={{ borderColor: colors.primary[300], mb: "10px" }} />

                  {s.description && (
                    <Typography color={colors.grey[200]} fontSize="13px" lineHeight={1.7} mb="12px" sx={{ whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
                      {s.description}
                    </Typography>
                  )}

                  {/* detail grid */}
                  <Box display="grid" gap="12px" mb={done ? "0" : "12px"} gridTemplateColumns={{ xs: "repeat(2, 1fr)", md: "repeat(4, 1fr)" }}>
                    <Meta label="Due" colors={colors}>
                      <Box component="span" color={state === "overdue" ? colors.redAccent[300] : "inherit"}>
                        {formatDate(s.dueDate)}
                        {state === "overdue" && " · overdue"}
                        {!done && isDueToday(s) && " · today"}
                      </Box>
                    </Meta>
                    <Meta label="Created by" colors={colors}>
                      {fullName(s.createdBy)}
                      <Typography component="span" display="block" fontSize="11px" color={colors.grey[500]}>
                        {formatDate(s.createdAt)}
                      </Typography>
                    </Meta>
                    {done && (
                      <>
                        <Meta label="Completed by" colors={colors}>{fullName(s.completedBy)}</Meta>
                        <Meta label="Completed on" colors={colors}>{formatDateTime(s.completedAt)}</Meta>
                      </>
                    )}
                  </Box>

                  {done && (
                    <Typography color={colors.grey[500]} fontSize="11px" mt="10px">
                      Leaves this page on {formatDate(removalDate(s))} ({left === 0 ? "today" : `in ${left} day${left === 1 ? "" : "s"}`}) · kept {COMPLETED_RETENTION_DAYS} days after completion
                    </Typography>
                  )}

                  {!done && (
                    <Button
                      size="small" variant="contained"
                      disabled={completingId === s.id}
                      startIcon={completingId === s.id ? <CircularProgress size={14} color="inherit" /> : <CheckCircleOutlineIcon />}
                      onClick={() => handleComplete(s.id)}
                      sx={{
                        backgroundColor: colors.greenAccent[700], color: colors.greenAccent[100],
                        textTransform: "none", fontSize: "12px",
                        "&:hover": { backgroundColor: colors.greenAccent[600] },
                      }}
                    >
                      Mark as Completed
                    </Button>
                  )}
                </Box>
              </Box>
            );
          })
        )}
      </Box>

      {/* EXCEL IMPORT — bulk upload of tasks (POST /schedules/bulk) */}
      <Dialog
        open={importState.open} onClose={closeImport} maxWidth="md" fullWidth
        PaperProps={{ sx: { backgroundColor: colors.primary[400] } }}
      >
        <DialogTitle sx={{ display: "flex", alignItems: "center", gap: "10px", fontSize: "15px", fontWeight: 700 }}>
          <UploadFileOutlinedIcon sx={{ color: colors.greenAccent[400] }} />
          Import Tasks from Excel
        </DialogTitle>

        <DialogContent>
          {/* step 1 — choose file */}
          {importState.rows.length === 0 && !importParsing && (
            <Box display="flex" flexDirection="column" gap="14px" py="4px">
              <Typography color={colors.grey[300]} fontSize="13px">
                Upload an <b>.xlsx</b>, <b>.xls</b> or <b>.csv</b> file. The first row must be a header with these
                columns (any order): <b>Title, Description, Assigned To, Due Date</b>. Description is optional.
                Assigned To is a person's full name or email (see the People sheet in the template).
                Due Date can be an Excel date or text like 2026-12-31 or 31/12/2026, and cannot be in the past.
              </Typography>

              <Box
                component="label"
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => { e.preventDefault(); handleImportFile(e.dataTransfer.files?.[0]); }}
                sx={{
                  display: "flex", flexDirection: "column", alignItems: "center", gap: "8px",
                  p: "28px", cursor: "pointer", borderRadius: "6px",
                  border: `2px dashed ${colors.grey[600]}`,
                  "&:hover": { borderColor: colors.greenAccent[400] },
                }}
              >
                <UploadFileOutlinedIcon sx={{ fontSize: 36, color: colors.greenAccent[400] }} />
                <Typography color={colors.grey[200]} fontSize="13px">
                  Click to choose a file, or drag it here
                </Typography>
                <input
                  type="file" hidden accept=".xlsx,.xls,.csv"
                  onChange={(e) => { handleImportFile(e.target.files?.[0]); e.target.value = ""; }}
                />
              </Box>

              {importState.error && (
                <Alert severity="error" sx={{ fontSize: "12px" }}>
                  {importState.fileName ? `${importState.fileName}: ` : ""}{importState.error}
                </Alert>
              )}

              <Box>
                <Button
                  size="small" startIcon={<DownloadOutlinedIcon />} onClick={handleDownloadTemplate}
                  sx={{ color: colors.blueAccent[300], textTransform: "none", fontSize: "12px" }}
                >
                  Download blank template
                </Button>
              </Box>
            </Box>
          )}

          {/* parsing */}
          {importParsing && (
            <Box display="flex" alignItems="center" gap="12px" py="24px" justifyContent="center">
              <CircularProgress size={20} color="secondary" />
              <Typography color={colors.grey[300]} fontSize="13px">Reading {importState.fileName}…</Typography>
            </Box>
          )}

          {/* step 2 — preview */}
          {importState.rows.length > 0 && (
            <Box display="flex" flexDirection="column" gap="12px">
              <Typography color={colors.grey[300]} fontSize="13px">
                <b>{importState.fileName}</b> — {importSummary.total.toLocaleString()} row{importSummary.total !== 1 ? "s" : ""} found
              </Typography>

              <Box display="flex" gap="8px" flexWrap="wrap">
                <Chip
                  icon={<CheckCircleOutlineIcon />}
                  label={`${importSummary.toImport.toLocaleString()} ready to import`}
                  size="small"
                  sx={{ backgroundColor: colors.greenAccent[800], color: colors.greenAccent[200] }}
                />
                {importSummary.invalid > 0 && (
                  <Chip
                    icon={<ErrorOutlineIcon />}
                    label={`${importSummary.invalid} with errors (skipped)`}
                    size="small"
                    sx={{ backgroundColor: colors.redAccent[800], color: colors.redAccent[200] }}
                  />
                )}
                {importSummary.duplicates > 0 && (
                  <Chip
                    icon={<WarningAmberOutlinedIcon />}
                    label={`${importSummary.duplicates} possible duplicate${importSummary.duplicates !== 1 ? "s" : ""}`}
                    size="small"
                    sx={{ backgroundColor: colors.grey[700], color: colors.grey[100] }}
                  />
                )}
              </Box>

              {importState.missingColumns.length > 0 && (
                <Alert severity="warning" sx={{ fontSize: "12px" }}>
                  Column(s) not found: {importState.missingColumns.join(", ")}. Rows will be marked as errors until they are added.
                </Alert>
              )}

              {importSummary.duplicates > 0 && (
                <FormControlLabel
                  control={
                    <Checkbox
                      size="small" checked={skipDuplicates}
                      onChange={(e) => setSkipDuplicates(e.target.checked)}
                      sx={{ color: `${colors.greenAccent[300]} !important` }}
                    />
                  }
                  label={<Typography fontSize="12px" color={colors.grey[300]}>Skip rows that already exist (same title, person and due date as a pending task)</Typography>}
                />
              )}

              <TableContainer sx={{ maxHeight: 340, border: `1px solid ${colors.primary[300]}`, borderRadius: "4px" }}>
                <Table size="small" stickyHeader>
                  <TableHead>
                    <TableRow>
                      {["Row", "Title", "Assigned To", "Due Date", "Description", "Status"].map((h) => (
                        <TableCell key={h} sx={{ backgroundColor: colors.blueAccent[700], color: colors.grey[100], fontSize: "11px", fontWeight: 700 }}>
                          {h}
                        </TableCell>
                      ))}
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {importState.rows.slice(0, 200).map((r) => {
                      const bad = r.errors.length > 0;
                      const cell = { fontSize: "12px", color: bad ? colors.grey[500] : colors.grey[100], borderBottom: `1px solid ${colors.primary[300]}` };
                      return (
                        <TableRow key={r.rowNum} sx={bad ? { backgroundColor: `${colors.redAccent[900]}66` } : undefined}>
                          <TableCell sx={cell}>{r.rowNum}</TableCell>
                          <TableCell sx={cell}>{r.data.title || "—"}</TableCell>
                          <TableCell sx={cell}>{r.data.assigneeName || r.data.assigneeText || "—"}</TableCell>
                          <TableCell sx={cell}>{r.data.dueDate || "—"}</TableCell>
                          <TableCell sx={{ ...cell, maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                            {r.data.description || "—"}
                          </TableCell>
                          <TableCell sx={{ ...cell, color: bad ? colors.redAccent[300] : r.duplicate ? colors.grey[300] : colors.greenAccent[300] }}>
                            {bad ? r.errors.join("; ") : r.duplicate ? "Possible duplicate" : "OK"}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </TableContainer>
              {importState.rows.length > 200 && (
                <Typography color={colors.grey[500]} fontSize="11px">
                  Showing the first 200 of {importState.rows.length.toLocaleString()} rows. All valid rows will be imported.
                </Typography>
              )}

              {importing && (
                <Box>
                  <LinearProgress variant="determinate" value={importProgress} color="secondary" />
                  <Typography color={colors.grey[400]} fontSize="11px" mt="4px">Importing… {importProgress}%</Typography>
                </Box>
              )}
            </Box>
          )}
        </DialogContent>

        <DialogActions sx={{ px: "24px", pb: "16px", gap: "8px" }}>
          <Button size="small" onClick={closeImport} disabled={importing} sx={{ color: colors.grey[400], textTransform: "none" }}>
            Cancel
          </Button>
          {importState.rows.length > 0 && (
            <>
              <Button
                size="small" variant="outlined" component="label" disabled={importing}
                sx={{ borderColor: colors.grey[600], color: colors.grey[300], textTransform: "none" }}
              >
                Choose different file
                <input
                  type="file" hidden accept=".xlsx,.xls,.csv"
                  onChange={(e) => { handleImportFile(e.target.files?.[0]); e.target.value = ""; }}
                />
              </Button>
              <Button
                size="small" variant="contained" color="secondary"
                disabled={importing || importSummary.toImport === 0}
                onClick={confirmImport}
                sx={{ textTransform: "none" }}
              >
                Import {importSummary.toImport.toLocaleString()} task{importSummary.toImport === 1 ? "" : "s"}
              </Button>
            </>
          )}
        </DialogActions>
      </Dialog>

      {/* CONFIRM COMPLETE */}
      <Dialog open={confirmDialog.open} onClose={closeConfirmDialog} maxWidth="xs" fullWidth>
        <DialogTitle sx={{ display: "flex", alignItems: "center", gap: "10px" }}>
          <CheckCircleOutlineIcon sx={{ color: colors.greenAccent[400] }} />
          {confirmDialog.title}
        </DialogTitle>
        <DialogContent>
          <DialogContentText sx={{ color: colors.grey[300] }}>{confirmDialog.message}</DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={closeConfirmDialog} size="small">Cancel</Button>
          <Button onClick={submitConfirmDialog} variant="contained" color="success" size="small">Mark Completed</Button>
        </DialogActions>
      </Dialog>

      {/* ACCESS DENIED / ERROR */}
      <Dialog open={errorDialog.open} onClose={closeErrorDialog} maxWidth="xs" fullWidth>
        <DialogTitle sx={{ display: "flex", alignItems: "center", gap: "10px" }}>
          <ErrorOutlineIcon sx={{ color: colors.redAccent[400] }} />
          {errorDialog.title}
        </DialogTitle>
        <DialogContent>
          <DialogContentText sx={{ color: colors.grey[300] }}>{errorDialog.message}</DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={closeErrorDialog} variant="contained" color="error" size="small">OK</Button>
        </DialogActions>
      </Dialog>

      {/* TOAST */}
      <Snackbar open={toast.open} autoHideDuration={3000} onClose={closeToast} anchorOrigin={{ vertical: "bottom", horizontal: "center" }}>
        <Alert severity={toast.severity} onClose={closeToast} sx={{ fontSize: "13px" }}>{toast.message}</Alert>
      </Snackbar>
    </Box>
  );
};

export default SchedulePage;