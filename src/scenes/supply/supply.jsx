// ─────────────────────────────────────────────────────────────────────────────
// SupplyPage.jsx  –  Pure UI. All logic and state lives in useSupply.
// ─────────────────────────────────────────────────────────────────────────────

import {
  Box, Typography, useTheme, Button, TextField, MenuItem,
  Collapse, IconButton, Snackbar, Alert, Stack, Tooltip, Chip,
  Dialog, DialogTitle, DialogContent, DialogContentText, DialogActions,
  Table, TableHead, TableBody, TableRow, TableCell, TableContainer,
  LinearProgress, CircularProgress, FormControlLabel, Checkbox,
} from "@mui/material";
import {
  DataGrid,
  GridToolbarColumnsButton,
  GridToolbarDensitySelector,
} from "@mui/x-data-grid";
import { tokens } from "../../theme";
import { mockDataClients } from "../../data/mockData";

// ── icons ─────────────────────────────────────────────────────────────────────
import KeyboardArrowDownIcon      from "@mui/icons-material/KeyboardArrowDown";
import KeyboardArrowUpIcon        from "@mui/icons-material/KeyboardArrowUp";
import AddOutlinedIcon            from "@mui/icons-material/AddOutlined";
import SearchOutlinedIcon         from "@mui/icons-material/SearchOutlined";
import FileDownloadOutlinedIcon   from "@mui/icons-material/FileDownloadOutlined";
import DeleteSweepOutlinedIcon    from "@mui/icons-material/DeleteSweepOutlined";
import DeleteOutlineOutlinedIcon  from "@mui/icons-material/DeleteOutlineOutlined";
import Inventory2OutlinedIcon     from "@mui/icons-material/Inventory2Outlined";
import AttachFileOutlinedIcon     from "@mui/icons-material/AttachFileOutlined";
import LocalShippingOutlinedIcon  from "@mui/icons-material/LocalShippingOutlined";
import NumbersOutlinedIcon        from "@mui/icons-material/NumbersOutlined";
import LockOutlinedIcon           from "@mui/icons-material/LockOutlined";
import ErrorOutlineIcon           from "@mui/icons-material/ErrorOutline";
import DownloadOutlinedIcon       from "@mui/icons-material/DownloadOutlined";
import UploadFileOutlinedIcon     from "@mui/icons-material/UploadFileOutlined";
import CheckCircleOutlineIcon     from "@mui/icons-material/CheckCircleOutline";
import WarningAmberOutlinedIcon   from "@mui/icons-material/WarningAmberOutlined";
import SwapHorizOutlinedIcon      from "@mui/icons-material/SwapHorizOutlined";

// ── logic ─────────────────────────────────────────────────────────────────────
import { useSupply, fileIcon } from "./supply.logic";
import Header from "../../components/Header";
import { useDateFormat } from "../settings/dateFormat.logic";


// ── StatCard ──────────────────────────────────────────────────────────────────
const StatCard = ({ icon, label, value, accent, colors }) => (
  <Box
    display="flex" alignItems="center" gap="12px"
    px="18px" py="12px"
    backgroundColor={colors.primary[400]}
    borderRadius="6px"
    borderLeft={`3px solid ${accent}`}
    minWidth="160px"
  >
    <Box color={accent} display="flex">{icon}</Box>
    <Box>
      <Typography fontSize="20px" fontWeight="700" color={colors.grey[100]} lineHeight={1}>
        {value}
      </Typography>
      <Typography fontSize="11px" color={colors.grey[400]} mt="2px">{label}</Typography>
    </Box>
  </Box>
);


// ── SupplyPage ────────────────────────────────────────────────────────────────
const SupplyPage = () => {
  const theme  = useTheme();
  const colors = tokens(theme.palette.mode);

  const {
    rows, filteredRows, selectedIds, setSelectedIds,
    totalQty, uniqueClients,
    search, setSearch, clientFilter, setClientFilter, clearFilters,
    form, formOpen, setFormOpen, openFormIfAuthorised,
    formError, attachments, setAttachments,
    handleChange, handleFileChange, handleSubmit, handleCancelForm,
    handleDelete, handleBulkDelete,
    confirmDialog, closeConfirmDialog, submitConfirmDialog,
    handleExportCSV, handleExportJSON,
    handleFileClick, downloadDialog, closeDownloadDialog, handleDownloadConfirm,
    toast, closeToast,
    errorDialog, closeErrorDialog,
    canLogSupply, canDelete, canExport, canDownload,
    importState, importParsing, importing, importProgress, importSummary,
    skipDuplicates, setSkipDuplicates,
    openImportIfAuthorised, closeImport, handleImportFile, confirmImport,
    handleDownloadTemplate, isMock,
    owed, totalOwed, owedOpen, setOwedOpen,
    repayDialog, repaying, openRepay, closeRepay, changeRepay, confirmRepay,
    canTransfer,
  } = useSupply();

  const { formatDate } = useDateFormat();


  // ── column definitions ─────────────────────────────────────────────────────
  const columns = [
    { field: "_id", headerName: "ID", width: 60 },

    {
      field: "goodsSupplied",
      headerName: "Goods Supplied",
      flex: 1.2,
      renderCell: ({ value }) => (
        <Typography color={colors.greenAccent[300]} fontWeight={600} fontSize="13px">
          {value}
        </Typography>
      ),
    },

    {
      field: "partNumber",
      headerName: "Part Number",
      flex: 0.9,
      renderCell: ({ value }) => (
        <Chip
          label={value}
          size="small"
          sx={{
            backgroundColor: colors.blueAccent[800],
            color: colors.blueAccent[200],
            fontSize: "11px",
            fontFamily: "monospace",
            height: "22px",
          }}
        />
      ),
    },

    {
      field: "quantity",
      headerName: "Qty",
      width: 80,
      type: "number",
      headerAlign: "left",
      align: "left",
      renderCell: ({ value }) => (
        <Typography fontWeight={700} color={colors.grey[100]} fontSize="13px">
          {value}
        </Typography>
      ),
    },

    {
      field: "client",
      headerName: "Client",
      flex: 1,
      valueGetter: (params) => params.row.client?.companyName || "—",
    },

    {
      field: "supplyDate",
      headerName: "Supply Date",
      flex: 0.8,
      renderCell: ({ value }) => (
        <Typography color={colors.grey[300]} fontSize="12px">
          {value ? formatDate(value) : "—"}
        </Typography>
      ),
    },

    {
      field: "takenFrom",
      headerName: "Taken From",
      flex: 1,
      valueGetter: (params) => params.row.takenFrom?.companyName || "",
      renderCell: ({ row }) =>
        row.takenFrom ? (
          <Tooltip title={row.transferNote || "Taken from this client's holding"}>
            <Chip
              icon={<SwapHorizOutlinedIcon />}
              label={row.takenFrom.companyName}
              size="small"
              sx={{
                backgroundColor: colors.redAccent[800],
                color: colors.redAccent[200],
                fontSize: "11px", height: "22px",
                "& .MuiChip-icon": { color: colors.redAccent[300], fontSize: "14px" },
              }}
            />
          </Tooltip>
        ) : (
          <Typography color={colors.grey[600]} fontSize="12px">—</Typography>
        ),
    },

    {
      field: "loggedBy",
      headerName: "Logged By",
      flex: 0.9,
      valueGetter: (params) =>
        params.row.user
          ? `${params.row.user.firstName} ${params.row.user.surname}`
          : "—",
    },

    // ── attachments column ──────────────────────────────────────────────────
    // Each file icon is clickable for admins/superadmins and triggers the
    // download confirmation dialog. Non-admins see a dimmed lock icon instead.
    {
      field: "attachments",
      headerName: "Files",
      flex: 1,
      sortable: false,
      renderCell: ({ row }) => {
        const atts = row.attachments || [];
        if (atts.length === 0)
          return <Typography color={colors.grey[600]} fontSize="12px">—</Typography>;

        return (
          <Box display="flex" gap="4px" alignItems="center" flexWrap="wrap">
            {atts.map((file, i) => {
              const Icon = fileIcon(file.name);
              return canDownload ? (
                <Tooltip key={i} title={`Download: ${file.name}`}>
                  <IconButton
                    size="small"
                    onClick={() => handleFileClick(file)}
                    sx={{
                      color: colors.blueAccent[300],
                      "&:hover": { color: colors.blueAccent[100] },
                    }}
                  >
                    <Icon sx={{ fontSize: "16px" }} />
                  </IconButton>
                </Tooltip>
              ) : (
                <Tooltip key={i} title={`${file.name} (admin access required to download)`}>
                  <span>
                    <IconButton size="small" disabled sx={{ color: colors.grey[600] }}>
                      <Icon sx={{ fontSize: "16px" }} />
                    </IconButton>
                  </span>
                </Tooltip>
              );
            })}
          </Box>
        );
      },
    },

    // ── row-level delete — lock icon for non-superadmins ───────────────────
    {
      field: "actions",
      headerName: "",
      width: 60,
      sortable: false,
      renderCell: ({ row }) =>
        canDelete ? (
          <Tooltip title="Delete entry">
            <IconButton
              size="small"
              onClick={() => handleDelete(row._id)}
              sx={{ color: colors.redAccent[400] }}
            >
              <DeleteOutlineOutlinedIcon sx={{ fontSize: "16px" }} />
            </IconButton>
          </Tooltip>
        ) : (
          <Tooltip title="Superadmin access required to delete">
            <span>
              <IconButton size="small" disabled sx={{ color: colors.grey[700] }}>
                <LockOutlinedIcon sx={{ fontSize: "16px" }} />
              </IconButton>
            </span>
          </Tooltip>
        ),
    },
  ];


  // ── render ─────────────────────────────────────────────────────────────────
  return (
    <Box m="20px">
      <Header title="SUPPLY" subtitle="Goods Supplied to Clients" />

      {isMock && (
        <Alert severity="warning" sx={{ mb: "16px", fontSize: "12px" }}>
          Preview mode: data is stored in memory only (REACT_APP_SUPPLY_MOCK). The /supply backend is not connected.
        </Alert>
      )}

      {/* ── stats bar ──────────────────────────────────────────────────────── */}
      <Stack direction="row" spacing={2} mt="24px" flexWrap="wrap" gap="12px">
        <StatCard
          icon={<Inventory2OutlinedIcon />}
          label="Total Entries"
          value={rows.length}
          accent={colors.greenAccent[500]}
          colors={colors}
        />
        <StatCard
          icon={<NumbersOutlinedIcon />}
          label="Total Units Supplied"
          value={totalQty.toLocaleString()}
          accent={colors.blueAccent[400]}
          colors={colors}
        />
        <StatCard
          icon={<LocalShippingOutlinedIcon />}
          label="Clients Served"
          value={uniqueClients}
          accent={colors.grey[400]}
          colors={colors}
        />
        <StatCard
          icon={<SwapHorizOutlinedIcon />}
          label="Units Owed to Clients"
          value={totalOwed.toLocaleString()}
          accent={totalOwed > 0 ? colors.redAccent[400] : colors.grey[500]}
          colors={colors}
        />
      </Stack>

      {/* ── log new supply form — always visible ───────────────────────────── */}
      <Box
        mt="24px" mb="16px"
        backgroundColor={colors.primary[400]}
        borderRadius="6px"
        overflow="hidden"
      >
        <Box
          display="flex" justifyContent="space-between" alignItems="center"
          p="12px 16px"
          sx={{ cursor: "pointer" }}
          onClick={() => (formOpen ? setFormOpen(false) : openFormIfAuthorised())}
        >
          <Box display="flex" alignItems="center" gap="8px">
            <AddOutlinedIcon sx={{ color: canLogSupply ? colors.greenAccent[400] : colors.grey[600], fontSize: "18px" }} />
            <Typography color={canLogSupply ? colors.grey[100] : colors.grey[500]} fontWeight="600" fontSize="14px">
              Log New Supply
              {!canLogSupply && (
                <Typography component="span" fontSize="11px" color={colors.grey[600]} ml="8px">
                  (supply access required)
                </Typography>
              )}
            </Typography>
          </Box>
          <IconButton size="small" sx={{ color: canLogSupply ? colors.greenAccent[400] : colors.grey[600] }}>
            {formOpen ? <KeyboardArrowUpIcon /> : <KeyboardArrowDownIcon />}
          </IconButton>
        </Box>

        <Collapse in={formOpen}>
          <Box
            p="16px"
            display="grid"
            gridTemplateColumns="repeat(3, 1fr)"
            gap="16px"
            borderTop={`1px solid ${colors.primary[300]}`}
          >
            <TextField
              variant="filled" label="Goods Supplied" name="goodsSupplied"
              value={form.goodsSupplied} onChange={handleChange} fullWidth
              error={!!formError && !form.goodsSupplied}
            />
            <TextField
              variant="filled" label="Part Number" name="partNumber"
              value={form.partNumber} onChange={handleChange} fullWidth
              error={!!formError && !form.partNumber}
            />
            <TextField
              variant="filled" label="Quantity" name="quantity" type="number"
              value={form.quantity} onChange={handleChange} fullWidth
              error={!!formError && (!form.quantity || Number(form.quantity) <= 0)}
            />
            <TextField
              variant="filled" label="Supply Date" name="supplyDate" type="date"
              InputLabelProps={{ shrink: true }}
              value={form.supplyDate} onChange={handleChange}
              fullWidth error={!!formError && !form.supplyDate}
            />
            <TextField
              select variant="filled" label="Client" name="clientId"
              value={form.clientId} onChange={handleChange}
              fullWidth error={!!formError && !form.clientId}
            >
              {mockDataClients.map((c) => (
                <MenuItem key={c.id} value={c.id}>{c.companyName}</MenuItem>
              ))}
            </TextField>

            {/* ── file attachments — real file picker ──────────────────────── */}
            <Box display="flex" alignItems="center" gap="8px">
              <Button
                component="label"
                variant="outlined"
                startIcon={<AttachFileOutlinedIcon />}
                sx={{
                  height: "56px", flex: 1,
                  borderColor: colors.grey[600], color: colors.grey[300],
                  textTransform: "none", fontSize: "13px",
                  justifyContent: "flex-start", px: "14px",
                }}
              >
                {attachments.length > 0
                  ? `${attachments.length} file${attachments.length !== 1 ? "s" : ""} selected`
                  : "Attach Files (optional)"}
                <input type="file" multiple hidden onChange={handleFileChange} />
              </Button>
              {attachments.length > 0 && (
                <Tooltip title="Clear selected files">
                  <IconButton
                    size="small"
                    onClick={() => setAttachments([])}
                    sx={{ color: colors.redAccent[400] }}
                  >
                    <DeleteOutlineOutlinedIcon sx={{ fontSize: "18px" }} />
                  </IconButton>
                </Tooltip>
              )}
            </Box>

            {/* Show selected filenames so user can confirm before submitting */}
            {attachments.length > 0 && (
              <Box sx={{ gridColumn: "span 3", display: "flex", flexWrap: "wrap", gap: "6px" }}>
                {attachments.map((f, i) => (
                  <Chip
                    key={i}
                    label={f.name}
                    size="small"
                    onDelete={() => setAttachments((prev) => prev.filter((_, idx) => idx !== i))}
                    sx={{
                      backgroundColor: colors.blueAccent[800],
                      color: colors.blueAccent[200],
                      fontSize: "11px",
                    }}
                  />
                ))}
              </Box>
            )}

            {/* ── optional: stock taken from another client's holding ─────── */}
            <TextField
              select variant="filled" label="Taken From (optional)" name="takenFromClientId"
              value={form.takenFromClientId} onChange={handleChange}
              fullWidth disabled={!canTransfer}
              helperText={
                canTransfer
                  ? "Only if this stock was being held for another client"
                  : "Administrator access required"
              }
            >
              <MenuItem value="">— None (own / general stock) —</MenuItem>
              {mockDataClients
                .filter((c) => String(c.id) !== String(form.clientId))
                .map((c) => (
                  <MenuItem key={c.id} value={c.id}>{c.companyName}</MenuItem>
                ))}
            </TextField>
            {form.takenFromClientId && (
              <TextField
                variant="filled" label="Why was it taken? (required)" name="transferNote"
                value={form.transferNote} onChange={handleChange}
                fullWidth sx={{ gridColumn: "span 2" }}
                inputProps={{ maxLength: 300 }}
                error={!!formError && !form.transferNote.trim()}
                helperText="The client it was taken from will be recorded as owed this quantity until it is replaced."
              />
            )}

            <Box
              display="flex" alignItems="center" justifyContent="flex-end"
              gap="10px" sx={{ gridColumn: "span 3" }}
            >
              <Button
                size="small" variant="outlined"
                onClick={handleCancelForm}
                sx={{ borderColor: colors.grey[600], color: colors.grey[300], textTransform: "none" }}
              >
                Cancel
              </Button>
              <Button
                variant="contained" color="secondary"
                onClick={handleSubmit}
                disabled={false}
                sx={{ height: "40px", px: "24px", textTransform: "none" }}
              >
                Log Supply
              </Button>
            </Box>

            {formError && (
              <Box sx={{ gridColumn: "span 3" }}>
                <Alert severity="error" sx={{ fontSize: "12px", py: "2px" }}>
                  {formError}
                </Alert>
              </Box>
            )}
          </Box>
        </Collapse>
      </Box>

      {/* ── owed to clients ───────────────────────────────────────────────── */}
      <Box
        mb="16px"
        backgroundColor={colors.primary[400]}
        borderRadius="6px"
        overflow="hidden"
        borderLeft={`3px solid ${owed.length > 0 ? colors.redAccent[400] : colors.grey[600]}`}
      >
        <Box
          display="flex" justifyContent="space-between" alignItems="center"
          p="12px 16px" sx={{ cursor: "pointer" }}
          onClick={() => setOwedOpen(!owedOpen)}
        >
          <Box display="flex" alignItems="center" gap="8px">
            <SwapHorizOutlinedIcon sx={{ color: owed.length > 0 ? colors.redAccent[400] : colors.grey[500], fontSize: "18px" }} />
            <Typography color={colors.grey[100]} fontWeight="600" fontSize="14px">
              Owed to Clients
            </Typography>
            {owed.length > 0 && (
              <Chip
                label={`${owed.length} item${owed.length !== 1 ? "s" : ""} · ${totalOwed.toLocaleString()} units`}
                size="small"
                sx={{ backgroundColor: colors.redAccent[800], color: colors.redAccent[200], fontSize: "11px", height: "20px" }}
              />
            )}
          </Box>
          <IconButton size="small" sx={{ color: colors.grey[400] }}>
            {owedOpen ? <KeyboardArrowUpIcon /> : <KeyboardArrowDownIcon />}
          </IconButton>
        </Box>

        <Collapse in={owedOpen}>
          <Box borderTop={`1px solid ${colors.primary[300]}`} p="8px 16px 16px">
            {owed.length === 0 ? (
              <Typography color={colors.grey[500]} fontSize="13px" py="12px">
                Nothing owed. When stock held for one client is supplied to another, it appears here until it is replaced.
              </Typography>
            ) : (
              <TableContainer sx={{ maxHeight: 280 }}>
                <Table size="small" stickyHeader>
                  <TableHead>
                    <TableRow>
                      {["Client we owe", "Part Number", "Goods", "Owed", "Last Taken", ""].map((h) => (
                        <TableCell
                          key={h || "action"}
                          sx={{ backgroundColor: colors.primary[400], color: colors.grey[300], fontSize: "11px", fontWeight: 700, borderBottom: `1px solid ${colors.primary[300]}` }}
                        >
                          {h}
                        </TableCell>
                      ))}
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {owed.map((o) => {
                      const cell = { fontSize: "12px", color: colors.grey[100], borderBottom: `1px solid ${colors.primary[300]}` };
                      return (
                        <TableRow key={`${o.client?.id ?? o.client?._id}-${o.partNumber}`}>
                          <TableCell sx={cell}>{o.client?.companyName}</TableCell>
                          <TableCell sx={{ ...cell, fontFamily: "monospace" }}>{o.partNumber}</TableCell>
                          <TableCell sx={cell}>{o.goodsSupplied}</TableCell>
                          <TableCell sx={{ ...cell, color: colors.redAccent[300], fontWeight: 700 }}>
                            -{Number(o.owed).toLocaleString()}
                          </TableCell>
                          <TableCell sx={{ ...cell, color: colors.grey[400] }}>
                            {o.lastTakenAt ? formatDate(o.lastTakenAt) : "—"}
                          </TableCell>
                          <TableCell sx={{ ...cell, textAlign: "right" }}>
                            <Tooltip title={canTransfer ? "" : "Administrator access required"}>
                              <span>
                                <Button
                                  size="small" variant="outlined"
                                  startIcon={<CheckCircleOutlineIcon />}
                                  onClick={() => openRepay(o)}
                                  sx={{
                                    fontSize: "11px", textTransform: "none",
                                    borderColor: canTransfer ? colors.greenAccent[600] : colors.grey[700],
                                    color: canTransfer ? colors.greenAccent[400] : colors.grey[600],
                                  }}
                                >
                                  Record repayment
                                </Button>
                              </span>
                            </Tooltip>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </TableContainer>
            )}
          </Box>
        </Collapse>
      </Box>

      {/* ── search / filter toolbar ────────────────────────────────────────── */}
      <Box
        display="flex" alignItems="center" justifyContent="space-between"
        flexWrap="wrap" gap="12px" mb="12px"
      >
        <Stack direction="row" spacing={1.5} alignItems="center">
          <TextField
            variant="outlined" size="small"
            placeholder="Search goods, part number, client…"
            value={search} onChange={(e) => setSearch(e.target.value)}
            InputProps={{
              startAdornment: (
                <SearchOutlinedIcon sx={{ color: colors.grey[400], mr: "6px", fontSize: "18px" }} />
              ),
            }}
            sx={{
              width: 260,
              "& .MuiOutlinedInput-root": { backgroundColor: colors.primary[400], fontSize: "13px" },
            }}
          />
          <TextField
            select variant="outlined" size="small" label="Client"
            value={clientFilter} onChange={(e) => setClientFilter(e.target.value)}
            sx={{
              minWidth: 160,
              "& .MuiOutlinedInput-root": { backgroundColor: colors.primary[400], fontSize: "13px" },
            }}
          >
            <MenuItem value="all">All Clients</MenuItem>
            {mockDataClients.map((c) => (
              <MenuItem key={c.id} value={String(c.id)}>{c.companyName}</MenuItem>
            ))}
          </TextField>
          <Typography color={colors.grey[500]} fontSize="12px" sx={{ whiteSpace: "nowrap" }}>
            {filteredRows.length} / {rows.length} entries
          </Typography>
        </Stack>

        <Stack direction="row" spacing={1} alignItems="center">
          {selectedIds.length > 0 && (
            <>
              <Tooltip title={canDelete ? "" : "Superadmin access required to delete"}>
                <span>
                  <Button
                    size="small" variant="contained"
                    startIcon={<DeleteSweepOutlinedIcon />}
                    onClick={handleBulkDelete}
                    sx={{
                      backgroundColor: canDelete ? colors.redAccent[700] : colors.grey[700],
                      "&:hover": { backgroundColor: canDelete ? colors.redAccent[600] : colors.grey[700] },
                      fontSize: "12px", textTransform: "none",
                    }}
                  >
                    Delete {selectedIds.length} selected
                  </Button>
                </span>
              </Tooltip>
              <Box sx={{ width: "1px", height: "24px", backgroundColor: colors.grey[600] }} />
            </>
          )}

          <Tooltip title={canLogSupply ? "Add many entries at once from an Excel or CSV file" : "Supply access required"}>
            <span>
              <Button
                size="small" variant="contained"
                startIcon={<UploadFileOutlinedIcon />}
                onClick={openImportIfAuthorised}
                sx={{
                  backgroundColor: canLogSupply ? colors.greenAccent[700] : colors.grey[700],
                  color: colors.grey[100],
                  fontSize: "12px", textTransform: "none",
                  "&:hover": { backgroundColor: canLogSupply ? colors.greenAccent[600] : colors.grey[700] },
                }}
              >
                Import Excel
              </Button>
            </span>
          </Tooltip>

          <Tooltip title={canExport ? "" : "Admin access required to export"}>
            <span>
              <Button
                size="small" variant="outlined"
                startIcon={<FileDownloadOutlinedIcon />}
                onClick={handleExportCSV}
                sx={{
                  borderColor: canExport ? colors.blueAccent[500] : colors.grey[700],
                  color: canExport ? colors.blueAccent[300] : colors.grey[600],
                  fontSize: "12px", textTransform: "none",
                  "&:hover": {
                    borderColor: canExport ? colors.blueAccent[300] : colors.grey[600],
                    backgroundColor: canExport ? colors.blueAccent[900] : "transparent",
                  },
                }}
              >
                Export CSV
              </Button>
            </span>
          </Tooltip>

          <Tooltip title={canExport ? "" : "Admin access required to export"}>
            <span>
              <Button
                size="small" variant="outlined"
                startIcon={<FileDownloadOutlinedIcon />}
                onClick={handleExportJSON}
                sx={{
                  borderColor: canExport ? colors.greenAccent[600] : colors.grey[700],
                  color: canExport ? colors.greenAccent[400] : colors.grey[600],
                  fontSize: "12px", textTransform: "none",
                  "&:hover": {
                    borderColor: canExport ? colors.greenAccent[400] : colors.grey[600],
                    backgroundColor: canExport ? colors.greenAccent[900] : "transparent",
                  },
                }}
              >
                Export JSON
              </Button>
            </span>
          </Tooltip>
        </Stack>
      </Box>

      {/* ── data grid ─────────────────────────────────────────────────────── */}
      <Box
        height="60vh"
        sx={{
          "& .MuiDataGrid-root": { border: "none" },
          "& .MuiDataGrid-cell": { borderBottom: "none" },
          "& .MuiDataGrid-columnHeaders": {
            backgroundColor: colors.blueAccent[700],
            borderBottom: "none",
            fontSize: "13px",
          },
          "& .MuiDataGrid-virtualScroller": { backgroundColor: colors.primary[400] },
          "& .MuiDataGrid-footerContainer": {
            borderTop: "none",
            backgroundColor: colors.blueAccent[700],
          },
          "& .MuiCheckbox-root": { color: `${colors.greenAccent[200]} !important` },
          "& .MuiDataGrid-row:hover": { backgroundColor: `${colors.primary[300]}55` },
          "& .MuiDataGrid-overlay": { backgroundColor: colors.primary[400] },
        }}
      >
        <DataGrid
          checkboxSelection
          disableRowSelectionOnClick
          rows={filteredRows}
          columns={columns}
          rowHeight={52}
          getRowId={(row) => row._id}
          onRowSelectionModelChange={(ids) => setSelectedIds(ids)}
          rowSelectionModel={selectedIds}
          slots={{
            toolbar: () => (
              <Box px="8px" pt="6px" display="flex" gap="4px">
                <GridToolbarColumnsButton />
                <GridToolbarDensitySelector />
              </Box>
            ),
            noRowsOverlay: () => (
              <Box
                display="flex" flexDirection="column" alignItems="center"
                justifyContent="center" height="100%" gap="8px"
              >
                <Inventory2OutlinedIcon sx={{ fontSize: 40, color: colors.grey[600] }} />
                <Typography color={colors.grey[500]} fontSize="14px">
                  No supply entries match your filters
                </Typography>
                <Button
                  size="small" onClick={clearFilters}
                  sx={{ color: colors.blueAccent[300], fontSize: "12px", textTransform: "none" }}
                >
                  Clear filters
                </Button>
              </Box>
            ),
          }}
        />
      </Box>

      {/* ── excel import dialog ──────────────────────────────────────────── */}
      <Dialog
        open={importState.open}
        onClose={closeImport}
        maxWidth="md"
        fullWidth
        PaperProps={{ sx: { backgroundColor: colors.primary[400] } }}
      >
        <DialogTitle sx={{ display: "flex", alignItems: "center", gap: "10px", fontSize: "15px", fontWeight: 700 }}>
          <UploadFileOutlinedIcon sx={{ color: colors.greenAccent[400] }} />
          Import Supply from Excel
        </DialogTitle>

        <DialogContent>
          {/* step 1 — choose file */}
          {importState.rows.length === 0 && !importParsing && (
            <Box display="flex" flexDirection="column" gap="14px" py="4px">
              <Typography color={colors.grey[300]} fontSize="13px">
                Upload an <b>.xlsx</b>, <b>.xls</b> or <b>.csv</b> file. The first row must be a header with these
                columns (any order): <b>Goods Supplied, Part Number, Quantity, Client, Supply Date</b>.
                Client names must match an existing client exactly. Dates can be DD/MM/YYYY or YYYY-MM-DD.
                Optional columns: <b>Taken From</b> (the client whose held stock you used — they will be recorded as
                owed) and <b>Transfer Note</b>.
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
                  type="file" hidden
                  accept=".xlsx,.xls,.csv"
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
                  size="small" startIcon={<DownloadOutlinedIcon />}
                  onClick={handleDownloadTemplate}
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
                {importSummary.transfers > 0 && (
                  <Chip
                    icon={<SwapHorizOutlinedIcon />}
                    label={`${importSummary.transfers} taken from another client`}
                    size="small"
                    sx={{ backgroundColor: colors.blueAccent[800], color: colors.blueAccent[200] }}
                  />
                )}
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
                  label={<Typography fontSize="12px" color={colors.grey[300]}>Skip rows that already exist (same goods, part, qty, client and date)</Typography>}
                />
              )}

              <TableContainer sx={{ maxHeight: 340, border: `1px solid ${colors.primary[300]}`, borderRadius: "4px" }}>
                <Table size="small" stickyHeader>
                  <TableHead>
                    <TableRow>
                      {["Row", "Goods Supplied", "Part No.", "Qty", "Client", "Taken From", "Date", "Status"].map((h) => (
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
                          <TableCell sx={cell}>{r.data.goodsSupplied || "—"}</TableCell>
                          <TableCell sx={cell}>{r.data.partNumber || "—"}</TableCell>
                          <TableCell sx={cell}>{r.data.quantity ?? "—"}</TableCell>
                          <TableCell sx={cell}>{r.data.clientName || "—"}</TableCell>
                          <TableCell sx={cell}>{r.data.takenFromName || "—"}</TableCell>
                          <TableCell sx={cell}>{r.data.supplyDate ? formatDate(r.data.supplyDate) : "—"}</TableCell>
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
                Import {importSummary.toImport.toLocaleString()} entr{importSummary.toImport === 1 ? "y" : "ies"}
              </Button>
            </>
          )}
        </DialogActions>
      </Dialog>

      {/* ── record repayment dialog ──────────────────────────────────────── */}
      <Dialog
        open={repayDialog.open}
        onClose={closeRepay}
        maxWidth="xs"
        fullWidth
        PaperProps={{ sx: { backgroundColor: colors.primary[400] } }}
      >
        <DialogTitle sx={{ display: "flex", alignItems: "center", gap: "10px", fontSize: "15px", fontWeight: 700 }}>
          <CheckCircleOutlineIcon sx={{ color: colors.greenAccent[400] }} />
          Record repayment
        </DialogTitle>
        <DialogContent>
          <DialogContentText sx={{ color: colors.grey[300], fontSize: "13px", mb: "14px" }}>
            Stock replaced for{" "}
            <b>{repayDialog.item?.client?.companyName}</b> —{" "}
            <b>{repayDialog.item?.partNumber}</b> (currently owed: {repayDialog.item?.owed}).
          </DialogContentText>
          <Box display="flex" flexDirection="column" gap="12px">
            <TextField
              variant="filled" label="Quantity replaced" type="number" fullWidth
              value={repayDialog.quantity}
              onChange={(e) => changeRepay("quantity", e.target.value)}
              inputProps={{ min: 1, max: repayDialog.item?.owed }}
            />
            <TextField
              variant="filled" label="Note (optional)" fullWidth
              value={repayDialog.note}
              onChange={(e) => changeRepay("note", e.target.value)}
              inputProps={{ maxLength: 300 }}
            />
            {repayDialog.error && (
              <Alert severity="error" sx={{ fontSize: "12px", py: "2px" }}>{repayDialog.error}</Alert>
            )}
          </Box>
        </DialogContent>
        <DialogActions sx={{ px: "24px", pb: "16px", gap: "8px" }}>
          <Button size="small" onClick={closeRepay} disabled={repaying} sx={{ color: colors.grey[400], textTransform: "none" }}>
            Cancel
          </Button>
          <Button
            size="small" variant="contained" color="secondary"
            onClick={confirmRepay} disabled={repaying}
            sx={{ textTransform: "none" }}
          >
            {repaying ? "Saving…" : "Record repayment"}
          </Button>
        </DialogActions>
      </Dialog>

      {/* ── download confirmation dialog ─────────────────────────────────── */}
      <Dialog
        open={downloadDialog.open}
        onClose={closeDownloadDialog}
        PaperProps={{ sx: { backgroundColor: colors.primary[400], minWidth: 340 } }}
      >
        <DialogTitle sx={{ display: "flex", alignItems: "center", gap: "10px", color: colors.grey[100], fontSize: "15px", fontWeight: 700 }}>
          <DownloadOutlinedIcon sx={{ color: colors.blueAccent[300] }} />
          Download File
        </DialogTitle>
        <DialogContent>
          <DialogContentText sx={{ color: colors.grey[300], fontSize: "13px" }}>
            Download{" "}
            <Typography component="span" fontWeight={700} color={colors.greenAccent[300]}>
              {downloadDialog.file?.name}
            </Typography>
            ?
          </DialogContentText>
        </DialogContent>
        <DialogActions sx={{ px: "24px", pb: "16px", gap: "8px" }}>
          <Button
            size="small" onClick={closeDownloadDialog}
            sx={{ color: colors.grey[400], textTransform: "none" }}
          >
            Cancel
          </Button>
          <Button
            size="small" variant="contained"
            startIcon={<DownloadOutlinedIcon />}
            onClick={handleDownloadConfirm}
            sx={{
              backgroundColor: colors.blueAccent[700],
              color: colors.blueAccent[100],
              textTransform: "none",
              "&:hover": { backgroundColor: colors.blueAccent[600] },
            }}
          >
            Download
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog open={confirmDialog.open} onClose={closeConfirmDialog} maxWidth="xs" fullWidth>
        <DialogTitle sx={{ display: "flex", alignItems: "center", gap: "10px" }}>
          <DeleteOutlineOutlinedIcon sx={{ color: colors.redAccent[400] }} />
          {confirmDialog.title}
        </DialogTitle>
        <DialogContent>
          <DialogContentText sx={{ color: colors.grey[300] }}>
            {confirmDialog.message}
          </DialogContentText>
        </DialogContent>
        <DialogActions sx={{ px: "24px", pb: "16px", gap: "8px" }}>
          <Button
            size="small" onClick={closeConfirmDialog}
            sx={{ color: colors.grey[400], textTransform: "none" }}
          >
            Cancel
          </Button>
          <Button
            size="small" variant="contained" color="error"
            onClick={submitConfirmDialog}
            sx={{ textTransform: "none" }}
          >
            Delete
          </Button>
        </DialogActions>
      </Dialog>

      {/* ── access denied / error dialog ─────────────────────────────────── */}
      <Dialog open={errorDialog.open} onClose={closeErrorDialog} maxWidth="xs" fullWidth>
        <DialogTitle sx={{ display: "flex", alignItems: "center", gap: "10px" }}>
          <ErrorOutlineIcon sx={{ color: colors.redAccent[400] }} />
          {errorDialog.title}
        </DialogTitle>
        <DialogContent>
          <DialogContentText sx={{ color: colors.grey[300] }}>
            {errorDialog.message}
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={closeErrorDialog} variant="contained" color="error" size="small">
            OK
          </Button>
        </DialogActions>
      </Dialog>

      {/* ── toast ────────────────────────────────────────────────────────── */}
      <Snackbar
        open={toast.open}
        autoHideDuration={3000}
        onClose={closeToast}
        anchorOrigin={{ vertical: "bottom", horizontal: "center" }}
      >
        <Alert severity={toast.severity} onClose={closeToast} sx={{ fontSize: "13px" }}>
          {toast.message}
        </Alert>
      </Snackbar>
    </Box>
  );
};

export default SupplyPage;