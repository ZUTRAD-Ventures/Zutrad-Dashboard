import { useDateFormat } from "../settings/dateFormat.logic";
import {
  Box,
  Typography,
  useTheme,
  Button,
  Snackbar,
  Alert,
  Stack,
  Chip,
  MenuItem,
  TextField,
} from "@mui/material";
import { tokens } from "../../theme";
import Header from "../../components/Header";
import { Link } from "react-router-dom";
import BusinessOutlinedIcon from "@mui/icons-material/BusinessOutlined";
import AdminPanelSettingsOutlinedIcon from "@mui/icons-material/AdminPanelSettingsOutlined";
import UploadFileOutlinedIcon from "@mui/icons-material/UploadFileOutlined";
import CheckCircleOutlineIcon from "@mui/icons-material/CheckCircleOutline";
import CancelOutlinedIcon from "@mui/icons-material/CancelOutlined";
import SupportAgentOutlinedIcon from "@mui/icons-material/SupportAgentOutlined";
import EngineeringOutlinedIcon from "@mui/icons-material/EngineeringOutlined";
import GroupOutlinedIcon from "@mui/icons-material/GroupOutlined";
import HowToRegOutlinedIcon from "@mui/icons-material/HowToRegOutlined";
import BlockOutlinedIcon from "@mui/icons-material/BlockOutlined";
import AccessTimeOutlinedIcon from "@mui/icons-material/AccessTimeOutlined";
import InboxOutlinedIcon from "@mui/icons-material/InboxOutlined";

import { useAdminPage as useAdminPageLogic } from "../global/management.logic";
import ClientImportDialog from "../global/clientImportDialog";

// ════════════════════════════════════════════════════════════════════════════
// STAT CARD
// ════════════════════════════════════════════════════════════════════════════
const StatCard = ({ icon, label, value, accent, colors }) => (
  <Box
    display="flex" alignItems="center" gap="12px"
    px="18px" py="12px"
    backgroundColor={colors.primary[400]}
    borderRadius="6px"
    borderLeft={`3px solid ${accent}`}
    minWidth="150px"
  >
    <Box color={accent} display="flex">{icon}</Box>
    <Box>
      <Typography fontSize="20px" fontWeight="700" color={colors.grey[100]} lineHeight={1}>{value}</Typography>
      <Typography fontSize="11px" color={colors.grey[400]} mt="2px">{label}</Typography>
    </Box>
  </Box>
);

// ════════════════════════════════════════════════════════════════════════════
// SECTION WRAPPERS
// ════════════════════════════════════════════════════════════════════════════
const SectionBox = ({ children, colors, accentColor }) => (
  <Box
    backgroundColor={colors.primary[400]}
    borderRadius="6px"
    p="20px 24px"
    mb="20px"
    borderLeft={`4px solid ${accentColor}`}
  >
    {children}
  </Box>
);

const SectionTitle = ({ title, subtitle, linkTo, linkLabel, colors, action }) => (
  <Box display="flex" justifyContent="space-between" alignItems="flex-start" mb="16px">
    <Box>
      <Typography color={colors.grey[100]} fontWeight="700" fontSize="15px">{title}</Typography>
      {subtitle && <Typography color={colors.grey[400]} fontSize="12px" mt="2px">{subtitle}</Typography>}
    </Box>
    <Box display="flex" alignItems="center" gap="12px">
      {action}
      {linkTo && (
        <Typography component={Link} to={linkTo} color={colors.greenAccent[400]} fontSize="13px"
          sx={{ textDecoration: "none", "&:hover": { textDecoration: "underline" } }}>
          {linkLabel} →
        </Typography>
      )}
    </Box>
  </Box>
);

// ════════════════════════════════════════════════════════════════════════════
// MAIN PAGE (UI) — state/handlers come from useAdminPageLogic
// ════════════════════════════════════════════════════════════════════════════
const AdminPage = () => {
  const theme = useTheme();
  const colors = tokens(theme.palette.mode);

  const { formatDate } = useDateFormat();

  const {
    // signups
    pendingSignups,
    handleApproveSignup,
    handleRejectSignup,

    // permissions - assign
    nonAdminUsers,
    assignUserId,
    setAssignUserId,
    assignPage,
    setAssignPage,
    assignablePages,
    handleAssignRole,

    // permissions - revoke
    removeUserId,
    setRemoveUserId,
    removePage,
    setRemovePage,
    removablePages,
    handleRemoveRole,

    // client form
    clientForm,
    setClientForm,
    clientError,
    setClientError,
    handleAddClient,
    clientImportOpen,
    setClientImportOpen,
    handleClientImport,

    // stats
    totalUsers,
    adminCount,
    engineerCount,
    otherCount,

    // toast
    toast,
    setToast,
  } = useAdminPageLogic();

  // ── render ─────────────────────────────────────────────────────────────────
  return (
    <Box m="20px">
      <Header title="ADMIN PANEL" subtitle="User Management, Clients & Permissions" />

      {/* stats */}
      <Stack direction="row" spacing={2} mt="24px" mb="28px" flexWrap="wrap" gap="12px">
        <StatCard icon={<GroupOutlinedIcon />} label="Total Users" value={totalUsers} accent={colors.grey[400]} colors={colors} />
        <StatCard icon={<AdminPanelSettingsOutlinedIcon />} label="Administrators" value={adminCount} accent={colors.greenAccent[500]} colors={colors} />
        <StatCard icon={<EngineeringOutlinedIcon />} label="Engineers" value={engineerCount} accent={colors.blueAccent[400]} colors={colors} />
        <StatCard icon={<SupportAgentOutlinedIcon />} label="Receptionists" value={otherCount} accent={colors.greenAccent[400]} colors={colors} />
      </Stack>

      {/* ── SIGNUP REQUESTS ── */}
      <SectionBox colors={colors} accentColor={colors.greenAccent[600]}>
        <SectionTitle
          title="Signup Requests"
          subtitle="Review and approve or reject new account requests"
          linkTo="/users"
          linkLabel="View all users"
          colors={colors}
          action={
            pendingSignups.length > 0 ? (
              <Box
                px="10px" py="3px" borderRadius="20px"
                backgroundColor={`${colors.blueAccent[800]}`}
                border={`1px solid ${colors.blueAccent[600]}`}
              >
                <Typography fontSize="11px" fontWeight={700} color={colors.blueAccent[200]}>
                  {pendingSignups.length} pending
                </Typography>
              </Box>
            ) : null
          }
        />

        {pendingSignups.length === 0 ? (
          <Box
            display="flex" flexDirection="column" alignItems="center" justifyContent="center"
            py="36px" gap="10px"
            border={`1px dashed ${colors.grey[700]}`}
            borderRadius="6px"
          >
            <InboxOutlinedIcon sx={{ fontSize: 36, color: colors.grey[600] }} />
            <Typography color={colors.grey[500]} fontSize="13px">No pending requests</Typography>
          </Box>
        ) : (
          <Stack spacing="10px">
            {pendingSignups.map((req) => (
              <Box
                key={req.id}
                display="flex" alignItems="center" gap="14px"
                px="16px" py="12px"
                backgroundColor={`${colors.greenAccent[900]}33`}
                borderRadius="6px"
                border={`2px solid ${colors.greenAccent[600]}`}
                transition="all 0.2s ease"
                sx={{ "&:hover": { backgroundColor: `${colors.greenAccent[900]}55`, borderColor: colors.greenAccent[500] } }}
              >
                {/* Avatar */}
                <Box
                  width="38px" height="38px" borderRadius="50%" flexShrink={0}
                  display="flex" alignItems="center" justifyContent="center"
                  backgroundColor={colors.greenAccent[800]}
                >
                  <Typography fontSize="13px" fontWeight={700} color={colors.greenAccent[200]}>
                    {req.firstName[0]}{req.surname[0]}
                  </Typography>
                </Box>

                {/* Info */}
                <Box flex={1} minWidth={0}>
                  <Box display="flex" alignItems="center" gap="8px" flexWrap="wrap">
                    <Typography fontSize="14px" fontWeight={600} color={colors.grey[100]}>
                      {req.firstName} {req.surname}
                    </Typography>
                    <Chip
                      label={req.requestedRole}
                      size="small"
                      sx={{
                        fontSize: "10px", height: "18px", textTransform: "capitalize",
                        backgroundColor: colors.greenAccent[800],
                        color: colors.greenAccent[200],
                        fontWeight: 600,
                      }}
                    />
                  </Box>
                  <Typography fontSize="12px" color={colors.grey[500]} noWrap>
                    {req.email}
                  </Typography>
                </Box>

                {/* Date */}
                <Box display="flex" alignItems="center" gap="4px" flexShrink={0}>
                  <AccessTimeOutlinedIcon sx={{ fontSize: 13, color: colors.grey[500] }} />
                    <Typography fontSize="11px" color={colors.grey[500]}>
                      {formatDate(req.requestedAt)}
                  </Typography>
                </Box>

                {/* Actions */}
                <Box display="flex" gap="8px" flexShrink={0}>
                  <Button
                    size="small"
                    variant="contained"
                    color="secondary"
                    startIcon={<HowToRegOutlinedIcon />}
                    onClick={() => handleApproveSignup(req)}
                    sx={{ textTransform: "none", fontSize: "12px", py: "5px" }}
                  >
                    Approve
                  </Button>
                  <Button
                    size="small"
                    variant="outlined"
                    startIcon={<BlockOutlinedIcon />}
                    onClick={() => handleRejectSignup(req)}
                    sx={{
                      textTransform: "none", fontSize: "12px", py: "5px",
                      borderColor: colors.redAccent[500],
                      color: colors.redAccent[400],
                      "&:hover": { backgroundColor: `${colors.redAccent[900]}55`, borderColor: colors.redAccent[400] },
                    }}
                  >
                    Reject
                  </Button>
                </Box>
              </Box>
            ))}
          </Stack>
        )}
      </SectionBox>

      {/* ── SPECIAL ROLES ── */}
      <SectionBox colors={colors} accentColor={colors.blueAccent[500]}>
        <SectionTitle
          title="Special Page Access"
          subtitle="Grant or revoke page permissions for Engineers & Receptionists"
          colors={colors}
        />

        <Box display="grid" gridTemplateColumns="1fr 1fr" gap="24px">
          {/* assign */}
          <Box
            p="18px" borderRadius="8px"
            backgroundColor={`${colors.greenAccent[900]}22`}
            border={`1.5px solid ${colors.greenAccent[700]}`}
          >
            <Box display="flex" alignItems="center" gap="8px" mb="14px">
              <CheckCircleOutlineIcon sx={{ fontSize: 18, color: colors.greenAccent[400] }} />
              <Typography color={colors.greenAccent[300]} fontWeight="700" fontSize="13px">
                Grant Permission
              </Typography>
            </Box>
            <Stack spacing={1.5}>
              <TextField select variant="outlined" label="User" value={assignUserId}
                onChange={(e) => { setAssignUserId(e.target.value); setAssignPage(""); }} fullWidth size="small"
                sx={{
                  "& .MuiOutlinedInput-root": {
                    backgroundColor: colors.greenAccent[900],
                    color: colors.greenAccent[100],
                    borderColor: colors.greenAccent[600],
                    "&:hover .MuiOutlinedInput-notchedOutline": { borderColor: colors.greenAccent[500] },
                    "&.Mui-focused .MuiOutlinedInput-notchedOutline": { borderColor: colors.greenAccent[400] },
                  },
                  "& .MuiInputLabel-root": { color: colors.greenAccent[300] },
                  "& .MuiInputBase-input": { color: colors.grey[100] },
                }}>
                {nonAdminUsers.map((u) => (
                  <MenuItem key={u.id} value={u.id}>
                    {u.firstName} {u.surname}
                    <Chip label={u.role} size="small" sx={{ ml: 1, fontSize: "10px", height: "18px", textTransform: "capitalize", backgroundColor: colors.greenAccent[900], color: colors.greenAccent[300] }} />
                  </MenuItem>
                ))}
              </TextField>
              <TextField select variant="outlined" label="Page" value={assignPage}
                onChange={(e) => setAssignPage(e.target.value)} fullWidth size="small"
                disabled={!assignUserId}
                sx={{
                  "& .MuiOutlinedInput-root": {
                    backgroundColor: colors.greenAccent[900],
                    color: colors.greenAccent[100],
                    borderColor: colors.greenAccent[600],
                    "&:hover .MuiOutlinedInput-notchedOutline": { borderColor: colors.greenAccent[500] },
                    "&.Mui-focused .MuiOutlinedInput-notchedOutline": { borderColor: colors.greenAccent[400] },
                  },
                  "& .MuiInputLabel-root": { color: colors.greenAccent[300] },
                  "& .MuiInputBase-input": { color: colors.grey[100] },
                }}>
                {assignablePages.map((p) => (
                  <MenuItem key={p} value={p} sx={{ textTransform: "capitalize" }}>{p}</MenuItem>
                ))}
              </TextField>
              <Button variant="contained" color="secondary" onClick={handleAssignRole}
                disabled={!assignUserId || !assignPage}
                startIcon={<CheckCircleOutlineIcon />}
                sx={{ textTransform: "none", fontSize: "13px", fontWeight: 600, py: "8px" }}>
                Grant Access
              </Button>
            </Stack>
          </Box>

          {/* revoke */}
          <Box
            p="18px" borderRadius="8px"
            backgroundColor={`${colors.redAccent[900]}22`}
            border={`1.5px solid ${colors.redAccent[700]}`}
          >
            <Box display="flex" alignItems="center" gap="8px" mb="14px">
              <BlockOutlinedIcon sx={{ fontSize: 18, color: colors.redAccent[400] }} />
              <Typography color={colors.redAccent[300]} fontWeight="700" fontSize="13px">
                Revoke Permission
              </Typography>
            </Box>
            <Stack spacing={1.5}>
              <TextField select variant="outlined" label="User" value={removeUserId}
                onChange={(e) => { setRemoveUserId(e.target.value); setRemovePage(""); }} fullWidth size="small"
                sx={{
                  "& .MuiOutlinedInput-root": {
                    backgroundColor: colors.redAccent[900],
                    color: colors.redAccent[100],
                    borderColor: colors.redAccent[600],
                    "&:hover .MuiOutlinedInput-notchedOutline": { borderColor: colors.redAccent[500] },
                    "&.Mui-focused .MuiOutlinedInput-notchedOutline": { borderColor: colors.redAccent[400] },
                  },
                  "& .MuiInputLabel-root": { color: colors.redAccent[300] },
                  "& .MuiInputBase-input": { color: colors.grey[100] },
                }}>
                {nonAdminUsers.filter((u) => u.permissions?.length > 0).map((u) => (
                  <MenuItem key={u.id} value={u.id}>
                    {u.firstName} {u.surname}
                    <Chip label={u.role} size="small" sx={{ ml: 1, fontSize: "10px", height: "18px", textTransform: "capitalize", backgroundColor: colors.redAccent[900], color: colors.redAccent[300] }} />
                  </MenuItem>
                ))}
              </TextField>
              <TextField select variant="outlined" label="Page to Revoke" value={removePage}
                onChange={(e) => setRemovePage(e.target.value)} fullWidth size="small"
                disabled={!removeUserId}
                sx={{
                  "& .MuiOutlinedInput-root": {
                    backgroundColor: colors.redAccent[900],
                    color: colors.redAccent[100],
                    borderColor: colors.redAccent[600],
                    "&:hover .MuiOutlinedInput-notchedOutline": { borderColor: colors.redAccent[500] },
                    "&.Mui-focused .MuiOutlinedInput-notchedOutline": { borderColor: colors.redAccent[400] },
                  },
                  "& .MuiInputLabel-root": { color: colors.redAccent[300] },
                  "& .MuiInputBase-input": { color: colors.grey[100] },
                }}>
                {removablePages.map((p) => (
                  <MenuItem key={p} value={p} sx={{ textTransform: "capitalize" }}>{p}</MenuItem>
                ))}
              </TextField>
              <Button variant="outlined" onClick={handleRemoveRole}
                disabled={!removeUserId || !removePage}
                startIcon={<CancelOutlinedIcon />}
                sx={{
                  borderColor: colors.redAccent[500], color: colors.redAccent[300],
                  textTransform: "none", fontSize: "13px", fontWeight: 600,
                  "&:hover": { backgroundColor: `${colors.redAccent[900]}55`, borderColor: colors.redAccent[400] },
                }}>
                Revoke Access
              </Button>
            </Stack>
          </Box>
        </Box>
      </SectionBox>

      {/* ── ADD CLIENT ── */}
      <SectionBox colors={colors} accentColor={colors.grey[500]}>
        <SectionTitle
          title="Add Client"
          subtitle="Register a new client company manually or import from a file"
          linkTo="/clients-list"
          linkLabel="View all clients"
          colors={colors}
          action={
            <Button
              size="small" variant="outlined"
              startIcon={<UploadFileOutlinedIcon />}
              onClick={() => setClientImportOpen(true)}
              sx={{
                borderColor: colors.blueAccent[500], color: colors.blueAccent[300],
                fontSize: "12px", textTransform: "none",
                "&:hover": { borderColor: colors.blueAccent[300], backgroundColor: colors.blueAccent[900] },
              }}
            >
              Import Excel / CSV
            </Button>
          }
        />

        <Box
          p="18px" borderRadius="8px"
          backgroundColor={`${colors.blueAccent[900]}22`}
          border={`1.5px solid ${colors.blueAccent[700]}`}
        >
          <Box display="grid" gridTemplateColumns="repeat(2, 1fr)" gap="14px" mb="14px">
            <TextField variant="outlined" label="Company Name" value={clientForm.companyName}
              onChange={(e) => { setClientError(""); setClientForm((p) => ({ ...p, companyName: e.target.value })); }}
              fullWidth error={!!clientError && !clientForm.companyName}
              sx={{
                "& .MuiOutlinedInput-root": {
                  backgroundColor: colors.blueAccent[900],
                  color: colors.blueAccent[100],
                  borderColor: colors.blueAccent[600],
                  "&:hover .MuiOutlinedInput-notchedOutline": { borderColor: colors.blueAccent[500] },
                  "&.Mui-focused .MuiOutlinedInput-notchedOutline": { borderColor: colors.blueAccent[400] },
                },
                "& .MuiInputLabel-root": { color: colors.blueAccent[300] },
                "& .MuiInputBase-input": { color: colors.grey[100] },
              }} />
            <TextField variant="outlined" label="Address" value={clientForm.address}
              onChange={(e) => { setClientError(""); setClientForm((p) => ({ ...p, address: e.target.value })); }}
              fullWidth error={!!clientError && !clientForm.address}
              sx={{
                "& .MuiOutlinedInput-root": {
                  backgroundColor: colors.blueAccent[900],
                  color: colors.blueAccent[100],
                  borderColor: colors.blueAccent[600],
                  "&:hover .MuiOutlinedInput-notchedOutline": { borderColor: colors.blueAccent[500] },
                  "&.Mui-focused .MuiOutlinedInput-notchedOutline": { borderColor: colors.blueAccent[400] },
                },
                "& .MuiInputLabel-root": { color: colors.blueAccent[300] },
                "& .MuiInputBase-input": { color: colors.grey[100] },
              }} />
          </Box>

          {clientError && (
            <Alert severity="error" sx={{ mb: "14px", fontSize: "12px", py: "6px" }}>{clientError}</Alert>
          )}

          <Box display="flex" justifyContent="flex-end">
            <Button variant="contained" color="secondary" onClick={handleAddClient}
              startIcon={<BusinessOutlinedIcon />} sx={{ px: "24px", textTransform: "none", fontWeight: 600, py: "8px" }}>
              Add Client
            </Button>
          </Box>
        </Box>
      </SectionBox>

      {/* import dialog — clients only */}
      <ClientImportDialog
        open={clientImportOpen}
        onClose={() => setClientImportOpen(false)}
        onImported={handleClientImport}
        colors={colors}
      />

      {/* toast */}
      <Snackbar
        open={toast.open} autoHideDuration={3500}
        onClose={() => setToast((t) => ({ ...t, open: false }))}
        anchorOrigin={{ vertical: "bottom", horizontal: "center" }}
      >
        <Alert severity={toast.severity} onClose={() => setToast((t) => ({ ...t, open: false }))} sx={{ fontSize: "13px" }}>
          {toast.message}
        </Alert>
      </Snackbar>
    </Box>
  );
};

export default AdminPage;