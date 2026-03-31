import React, { useEffect, useState, useCallback } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import axios from 'axios';
import './PageStyles.css';
import './CompanyOverview.css';

const DETAIL_FIELDS = [
  { key: 'BusinessName', label: 'Business Name' },
  { key: 'AccountCode', label: 'Account Code', readOnly: true },
  { key: 'Email', label: 'Email' },
  { key: 'Town', label: 'Town' },
  { key: 'FacilityType', label: 'Facility Type' },
  { key: 'FacilityProvince', label: 'Facility Province' },
  { key: 'CompanyRegNumber', label: 'Company Reg No.' },
  { key: 'PhysicalAddress', label: 'Physical Address' },
  { key: 'VATNumber', label: 'VAT Number' },
];

const CONTACT_GROUPS = [
  {
    title: 'Facility Owner',
    fields: [
      { key: 'AbattoirOwnerName', label: 'Name' },
      { key: 'AbattoirOwnerCell', label: 'Cellphone' },
      { key: 'AbattoirOwnerEmail', label: 'Email' },
    ],
  },
  {
    title: 'Accounts Contact',
    fields: [
      { key: 'AccountsContactName', label: 'Contact Name' },
      { key: 'AccountsTelephone', label: 'Telephone' },
      { key: 'AccountsEmail', label: 'Email' },
    ],
  },
  {
    title: 'Facility Manager',
    fields: [
      { key: 'AbattoirManagerName', label: 'Name' },
      { key: 'AbattoirManagerCell', label: 'Cellphone' },
      { key: 'AbattoirManagerEmail', label: 'Email' },
    ],
  },
];

const ALL_EDITABLE = [
  ...DETAIL_FIELDS.filter(f => !f.readOnly),
  ...CONTACT_GROUPS.flatMap(g => g.fields),
];

const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

// Check if an EPV has a completed inspector EPV
const hasInspectorAmount = (epv) => epv.inspectorEPV && epv.inspectorEPV.Status === 'Completed';

const LEVY_RATE = 0.018;

// Calculate total owed from a single EPV record
const calcTotalOwed = (record) => {
  const eggLevy = parseFloat(record.LevyAmount) || 0;
  const pulpSoldToTrade = parseInt(record.PulpSoldToTrade) || 0;
  const pulpLevyDozens = Math.round(pulpSoldToTrade * 1.7);
  const pulpLevy = pulpLevyDozens * LEVY_RATE;
  return eggLevy + pulpLevy;
};

// Get the amount outstanding based on verification status
const getAmountOutstanding = (epv) => {
  if (epv.Status !== 'Completed') return { label: '—', className: '' };
  // Rejected and inspector EPV completed — use inspector EPV amount
  if (!epv.IsVerified && epv.inspectorEPV && epv.inspectorEPV.Status === 'Completed') {
    return { label: `R ${calcTotalOwed(epv.inspectorEPV).toFixed(2)}`, className: 'co-amount-value' };
  }
  // Completed facility EPV — always show the facility amount (approved, awaiting approval, or rejected awaiting inspector EPV)
  return { label: `R ${calcTotalOwed(epv).toFixed(2)}`, className: 'co-amount-value' };
};

// Payment status based on POP and Reconciled — requires inspector EPV to be completed for amount
const getPaymentStatus = (epv) => {
  if (epv.Status !== 'Completed' && !hasInspectorAmount(epv)) return { label: '—', className: '' };
  if (epv.IsReconciled && epv.POPFilePath) return { label: 'Paid', className: 'co-pay-paid' };
  if (epv.POPFilePath) return { label: 'Pending Reconciliation', className: 'co-pay-pending' };
  return { label: 'Outstanding', className: 'co-pay-outstanding' };
};

// Build progress steps for an EPV lifecycle
const getProgressSteps = (epv) => {
  const steps = [];

  // Step 1: EPV Sent
  steps.push({
    label: 'EPV Sent',
    status: 'complete', // always complete if it exists in the list
  });

  // Step 2: Facility Completes EPV
  steps.push({
    label: 'Facility Completes EPV',
    status: epv.Status === 'Completed' ? 'complete' : 'active',
  });

  // Step 3: Inspector Approves / Rejects
  const inspectorDecided = epv.IsVerified || (epv.inspectorEPV != null);
  steps.push({
    label: 'Inspector Verification',
    status: epv.Status !== 'Completed' ? 'pending'
      : inspectorDecided ? 'complete' : 'active',
    detail: epv.IsVerified ? 'Approved' : epv.inspectorEPV ? 'Rejected' : null,
  });

  // Step 4: Inspector Completes EPV (only if rejected)
  if (epv.inspectorEPV) {
    steps.push({
      label: 'Inspector Completes EPV',
      status: epv.inspectorEPV.Status === 'Completed' ? 'complete' : 'active',
    });
  }

  // Step 5: Invoice Sent
  const invoiceReady = epv.Status === 'Completed' && (epv.IsVerified || (epv.inspectorEPV && epv.inspectorEPV.Status === 'Completed'));
  const hasInvoice = epv._invoice != null;
  const invoiceSentDone = hasInvoice && epv._invoice.SentAt;
  steps.push({
    label: 'Invoice Sent',
    status: invoiceSentDone ? 'complete' : hasInvoice ? 'active' : invoiceReady ? 'active' : 'pending',
    detail: invoiceSentDone ? 'Sent' : hasInvoice ? 'Generated' : null,
  });

  // Step 6: POP Uploaded
  steps.push({
    label: 'POP Uploaded',
    status: epv.POPFilePath ? 'complete' : invoiceSentDone ? 'active' : 'pending',
  });

  // Step 7: Payment Reconciled
  steps.push({
    label: 'Payment Reconciled',
    status: epv.IsReconciled ? 'complete' : epv.POPFilePath ? 'active' : 'pending',
  });

  return steps;
};

const SA_PROVINCES = [
  'Eastern Cape', 'Free State', 'Gauteng', 'KwaZulu-Natal', 'Limpopo',
  'Mpumalanga', 'North West', 'Northern Cape', 'Western Cape',
];

function CompanyOverview() {
  const user = JSON.parse(localStorage.getItem('user') || '{}');
  const isAdmin = user.role === 'Super Admin' || user.role === 'Admin';
  const isInspector = user.role === 'Inspector';
  const canSelectCompany = isAdmin || isInspector;
  const userLabel = `${user.firstName || ''} ${user.lastName || ''} (${user.email || 'unknown'})`.trim();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const queryCompanyId = searchParams.get('companyId');

  // Company selector state (admin/inspector)
  const [allCompanies, setAllCompanies] = useState([]);
  const [companiesLoading, setCompaniesLoading] = useState(false);
  const [companySearch, setCompanySearch] = useState('');

  // Active company ID - for admin/inspector it's selected (or from query param), for company users it's from login
  const [activeCompanyId, setActiveCompanyId] = useState(
    queryCompanyId ? parseInt(queryCompanyId) : (canSelectCompany ? null : user.clientRecordId)
  );

  const [company, setCompany] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [successMsg, setSuccessMsg] = useState('');

  // Edit state
  const [editing, setEditing] = useState(false);
  const [editValues, setEditValues] = useState({});
  const [originalValues, setOriginalValues] = useState({});
  const [saving, setSaving] = useState(false);

  // Users state
  const [companyUsers, setCompanyUsers] = useState([]);
  const [pendingInvites, setPendingInvites] = useState([]);
  const [usersLoading, setUsersLoading] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState(null);

  // Reset password state
  const [resetModal, setResetModal] = useState(null);
  const [resetPassword, setResetPassword] = useState('');
  const [resetting, setResetting] = useState(false);

  // Invite state
  const [showInviteForm, setShowInviteForm] = useState(false);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState('User');
  const [inviteSending, setInviteSending] = useState(false);

  // Audit log state
  const [showAuditLog, setShowAuditLog] = useState(false);
  const [auditLog, setAuditLog] = useState([]);
  const [auditPage, setAuditPage] = useState(1);
  const [auditTotalPages, setAuditTotalPages] = useState(1);
  const [auditTotal, setAuditTotal] = useState(0);
  const [auditLoading, setAuditLoading] = useState(false);

  // EPV state
  const [epvList, setEpvList] = useState([]);
  const [epvLoading, setEpvLoading] = useState(false);
  const [epvSending, setEpvSending] = useState(false);

  // Add EPV modal state (for company users to submit old VPS forms)
  const [showAddEpvModal, setShowAddEpvModal] = useState(false);
  const [addEpvMonth, setAddEpvMonth] = useState('');
  const [addEpvYear, setAddEpvYear] = useState('');
  const [addEpvCreating, setAddEpvCreating] = useState(false);

  // POP upload state
  const [popUploading, setPopUploading] = useState(null); // EPV Id being uploaded
  const [inspCreating, setInspCreating] = useState(null); // EPV Id for inspector creation
  const [epvComments, setEpvComments] = useState({}); // { epvId: commentText }
  const [reconciledAmounts, setReconciledAmounts] = useState({}); // { epvId: amountString }
  const [expandedEpvId, setExpandedEpvId] = useState(null); // EPV Id with progress tracker open
  const [popComments, setPopComments] = useState({}); // { epvId: commentText }

  // Invoice state
  const [invoices, setInvoices] = useState([]); // array of invoice records
  const [invoiceGenerating, setInvoiceGenerating] = useState(null); // EPV Id being generated
  const [invoiceSending, setInvoiceSending] = useState(null); // Invoice Id being sent

  // Email status state — tracks which emails have failed
  const [emailStatus, setEmailStatus] = useState({}); // { email: 'Sent' | 'Failed' }

  // Table filter state
  const [epvFilters, setEpvFilters] = useState({});
  const [invFilters, setInvFilters] = useState({});

  // ===== FETCH ALL COMPANIES (admin only) =====
  const fetchAllCompanies = useCallback(async () => {
    if (!canSelectCompany) return;
    setCompaniesLoading(true);
    try {
      const res = await axios.get('/api/clients', { params: { limit: 9999 } });
      setAllCompanies(res.data.data);
    } catch (err) {
      console.error('Failed to load companies');
    } finally {
      setCompaniesLoading(false);
    }
  }, [canSelectCompany]);

  useEffect(() => { fetchAllCompanies(); }, [fetchAllCompanies]);

  // ===== FETCH COMPANY DATA =====
  const fetchCompany = useCallback(async () => {
    if (!activeCompanyId) { setLoading(false); return; }
    setLoading(true);
    try {
      const res = await axios.get(`/api/company/${activeCompanyId}`);
      setCompany(res.data.company);
    } catch (err) {
      setError('Failed to load company details.');
    } finally {
      setLoading(false);
    }
  }, [activeCompanyId]);

  const fetchUsers = useCallback(async () => {
    if (!activeCompanyId) return;
    setUsersLoading(true);
    try {
      const res = await axios.get(`/api/company/${activeCompanyId}/users`);
      setCompanyUsers(res.data.users);
      setPendingInvites(res.data.pendingInvites);
    } catch (err) {
      console.error('Failed to load users');
    } finally {
      setUsersLoading(false);
    }
  }, [activeCompanyId]);

  // Fetch just the audit log count (always, not only when expanded)
  const fetchAuditCount = useCallback(async () => {
    if (!activeCompanyId) return;
    try {
      const res = await axios.get(`/api/company/${activeCompanyId}/audit-log`, {
        params: { page: 1, limit: 1 },
      });
      setAuditTotal(res.data.total);
    } catch (err) {
      console.error('Failed to load audit count');
    }
  }, [activeCompanyId]);

  const fetchAuditLog = useCallback(async () => {
    if (!activeCompanyId) return;
    setAuditLoading(true);
    try {
      const res = await axios.get(`/api/company/${activeCompanyId}/audit-log`, {
        params: { page: auditPage, limit: 50 },
      });
      setAuditLog(res.data.data);
      setAuditTotalPages(res.data.totalPages);
      setAuditTotal(res.data.total);
    } catch (err) {
      console.error('Failed to load audit log');
    } finally {
      setAuditLoading(false);
    }
  }, [activeCompanyId, auditPage]);

  const fetchEPVs = useCallback(async () => {
    if (!activeCompanyId) return;
    setEpvLoading(true);
    try {
      const res = await axios.get(`/api/epv/company/${activeCompanyId}`);
      setEpvList(res.data.verifications);
    } catch (err) {
      console.error('Failed to load EPVs');
    } finally {
      setEpvLoading(false);
    }
  }, [activeCompanyId]);

  const fetchInvoices = useCallback(async () => {
    if (!activeCompanyId) return;
    try {
      const res = await axios.get(`/api/invoices/company/${activeCompanyId}`);
      setInvoices(res.data);
    } catch (err) {
      console.error('Failed to load invoices');
    }
  }, [activeCompanyId]);

  const fetchEmailStatus = useCallback(async () => {
    if (!activeCompanyId) return;
    try {
      const res = await axios.get(`/api/invoices/email-log/${activeCompanyId}`);
      setEmailStatus(res.data.emailStatus || {});
    } catch (err) {
      console.error('Failed to load email status');
    }
  }, [activeCompanyId]);

  useEffect(() => { fetchCompany(); }, [fetchCompany]);
  useEffect(() => { fetchUsers(); }, [fetchUsers]);
  useEffect(() => { fetchEPVs(); }, [fetchEPVs]);
  useEffect(() => { fetchInvoices(); }, [fetchInvoices]);
  useEffect(() => { fetchEmailStatus(); }, [fetchEmailStatus]);
  useEffect(() => { fetchAuditCount(); }, [fetchAuditCount]);
  useEffect(() => { if (showAuditLog) fetchAuditLog(); }, [fetchAuditLog, showAuditLog]);

  // Helper: refresh EPVs + audit log after any action
  const refreshAll = useCallback(() => {
    fetchEPVs();
    fetchInvoices();
    fetchEmailStatus();
    fetchAuditCount();
    if (showAuditLog) fetchAuditLog();
  }, [fetchEPVs, fetchInvoices, fetchEmailStatus, fetchAuditCount, fetchAuditLog, showAuditLog]);

  // Reset sub-sections when switching company
  useEffect(() => {
    setEditing(false);
    setEditValues({});
    setOriginalValues({});
    setShowAuditLog(false);
    setAuditPage(1);
    setShowInviteForm(false);
    setError('');
    setSuccessMsg('');
  }, [activeCompanyId]);

  useEffect(() => {
    if (successMsg) {
      const t = setTimeout(() => setSuccessMsg(''), 4000);
      return () => clearTimeout(t);
    }
  }, [successMsg]);

  // ===== SWITCH COMPANY (admin) =====
  const selectCompany = (companyId) => {
    setActiveCompanyId(companyId);
    setSearchParams({ companyId: String(companyId) }, { replace: true });
  };

  const filteredCompanies = allCompanies.filter(c => {
    if (!companySearch) return true;
    const s = companySearch.toLowerCase();
    return (c.BusinessName || '').toLowerCase().includes(s)
      || (c.AccountCode || '').toLowerCase().includes(s)
      || (c.Town || '').toLowerCase().includes(s);
  });

  // ===== EDIT =====
  const canEdit = isAdmin || user.role === 'Company Admin';

  const startEdit = () => {
    const values = {};
    ALL_EDITABLE.forEach(f => { values[f.key] = company[f.key] || ''; });
    setEditValues(values);
    setOriginalValues({ ...values });
    setEditing(true);
  };

  const cancelEdit = () => {
    setEditing(false);
    setEditValues({});
    setOriginalValues({});
  };

  const saveEdit = async () => {
    const changes = {};
    ALL_EDITABLE.forEach(f => {
      if (editValues[f.key] !== originalValues[f.key]) {
        changes[f.key] = editValues[f.key];
      }
    });

    if (Object.keys(changes).length === 0) {
      cancelEdit();
      return;
    }

    setSaving(true);
    try {
      await axios.put(`/api/company/${activeCompanyId}/update`, {
        updates: changes,
        changedBy: userLabel,
      });
      cancelEdit();
      setSuccessMsg('Company details updated successfully.');
      fetchCompany();
      fetchAuditCount();
      if (showAuditLog) fetchAuditLog();
    } catch (err) {
      setError('Failed to save changes.');
    } finally {
      setSaving(false);
    }
  };

  // ===== INVITE =====
  const sendInvite = async (e) => {
    e.preventDefault();
    if (!inviteEmail) return;
    setInviteSending(true);
    setError('');
    try {
      const res = await axios.post(`/api/company/${activeCompanyId}/invite`, {
        email: inviteEmail,
        role: inviteRole,
        invitedBy: userLabel,
      });
      setSuccessMsg(res.data.message);
      setShowInviteForm(false);
      setInviteEmail('');
      setInviteRole('User');
      fetchUsers();
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to send invitation.');
    } finally {
      setInviteSending(false);
    }
  };

  // ===== DELETE USER =====
  const executeDeleteUser = async () => {
    if (!deleteConfirm) return;
    try {
      await axios.delete(`/api/company/${activeCompanyId}/users/${deleteConfirm.Id}`);
      setDeleteConfirm(null);
      setSuccessMsg(`User "${deleteConfirm.FirstName} ${deleteConfirm.LastName}" removed.`);
      fetchUsers();
    } catch (err) {
      setError('Failed to remove user.');
      setDeleteConfirm(null);
    }
  };

  // ===== RESET PASSWORD =====
  const canResetPassword = user.role === 'Super Admin' || user.role === 'Company Admin';

  const executeResetPassword = async () => {
    if (!resetModal || !resetPassword) return;
    if (resetPassword.length < 6) {
      setError('Password must be at least 6 characters.');
      return;
    }
    setResetting(true);
    setError('');
    try {
      await axios.put(`/api/auth/users/${resetModal.Id}/reset-password`, {
        newPassword: resetPassword,
      });
      setResetModal(null);
      setResetPassword('');
      setSuccessMsg(`Password reset for ${resetModal.FirstName} ${resetModal.LastName}.`);
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to reset password.');
    } finally {
      setResetting(false);
    }
  };

  // ===== CREATE MANUAL EPV (company users for old months) =====
  const openAddEpvModal = () => {
    const now = new Date();
    setAddEpvMonth(String(now.getMonth() + 1));
    setAddEpvYear(String(now.getFullYear()));
    setShowAddEpvModal(true);
  };

  const createManualEPV = async () => {
    if (!addEpvMonth || !addEpvYear) return;
    setAddEpvCreating(true);
    setError('');
    try {
      const res = await axios.post('/api/epv/create-manual', {
        clientRecordId: activeCompanyId,
        periodMonth: parseInt(addEpvMonth),
        periodYear: parseInt(addEpvYear),
        createdBy: userLabel,
      });
      setShowAddEpvModal(false);
      refreshAll();
      // Navigate to the form
      navigate(`/epv/${res.data.token}`);
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to create verification.');
    } finally {
      setAddEpvCreating(false);
    }
  };

  // ===== UPLOAD POP =====
  const handlePopUpload = async (epvId, file) => {
    if (!file) return;
    setPopUploading(epvId);
    setError('');
    try {
      const formData = new FormData();
      formData.append('pop', file);
      formData.append('uploadedBy', userLabel);
      formData.append('userRole', user.role);
      await axios.post(`/api/epv/${epvId}/upload-pop`, formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      setSuccessMsg('Proof of Payment uploaded successfully.');
      refreshAll();
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to upload POP.');
    } finally {
      setPopUploading(null);
    }
  };

  // ===== DELETE POP (admin only) =====
  const deletePop = async (epvId) => {
    if (!window.confirm('Are you sure you want to delete this Proof of Payment? This will also remove reconciliation.')) return;
    setError('');
    try {
      await axios.delete(`/api/epv/${epvId}/pop`, { data: { deletedBy: userLabel, userRole: user.role } });
      setSuccessMsg('POP deleted successfully.');
      refreshAll();
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to delete POP.');
    }
  };

  // ===== RECONCILE EPV (admin only) =====
  const toggleReconcile = async (epvId, currentValue) => {
    setError('');
    try {
      await axios.put(`/api/epv/${epvId}/reconcile`, {
        reconciled: !currentValue,
        reconciledBy: userLabel,
        userRole: user.role,
      });
      setSuccessMsg(!currentValue ? 'EPV marked as reconciled.' : 'Reconciliation removed.');
      refreshAll();
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to update reconciliation.');
    }
  };

  // ===== TOGGLE VERIFY (Inspector/Super Admin only) =====
  const toggleVerify = async (epvId, currentValue) => {
    setError('');
    try {
      await axios.put(`/api/epv/${epvId}/verify`, {
        verified: !currentValue,
        verifiedBy: userLabel,
        userRole: user.role,
      });
      setSuccessMsg(!currentValue ? 'EPV marked as verified.' : 'Verification removed.');
      refreshAll();
    } catch (err) {
      const msg = err.response?.data?.message || 'Failed to update verification.';
      const detail = err.response?.data?.error || '';
      setError(detail ? `${msg} (${detail})` : msg);
    }
  };

  // ===== TOGGLE MANUAL INSPECTION =====
  const toggleManualInspection = async (epvId, currentValue) => {
    setError('');
    try {
      await axios.put(`/api/epv/${epvId}/manual-inspection`, {
        checked: !currentValue,
        changedBy: userLabel,
        userRole: user.role,
      });
      setSuccessMsg(!currentValue ? 'Manual inspection marked.' : 'Manual inspection removed.');
      refreshAll();
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to update manual inspection.');
    }
  };

  // ===== SAVE RECONCILED AMOUNT =====
  const saveReconciledAmount = async (epvId) => {
    setError('');
    try {
      await axios.put(`/api/epv/${epvId}/reconciled-amount`, {
        amount: reconciledAmounts[epvId] || null,
        changedBy: userLabel,
        userRole: user.role,
      });
      setSuccessMsg('Reconciled amount saved.');
      setReconciledAmounts(prev => { const n = { ...prev }; delete n[epvId]; return n; });
      refreshAll();
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to save reconciled amount.');
    }
  };

  // ===== SAVE INSPECTOR COMMENT =====
  const saveComment = async (epvId) => {
    setError('');
    try {
      await axios.put(`/api/epv/${epvId}/comment`, {
        comment: epvComments[epvId] || '',
        commentBy: userLabel,
        userRole: user.role,
      });
      setSuccessMsg('Comment saved.');
      setEpvComments(prev => { const n = { ...prev }; delete n[epvId]; return n; });
      refreshAll();
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to save comment.');
    }
  };

  // ===== SAVE POP COMMENT =====
  const savePopComment = async (epvId) => {
    setError('');
    try {
      await axios.put(`/api/epv/${epvId}/pop-comment`, {
        comment: popComments[epvId] || '',
        commentBy: userLabel,
        userRole: user.role,
      });
      setSuccessMsg('POP comment saved.');
      setPopComments(prev => { const n = { ...prev }; delete n[epvId]; return n; });
      refreshAll();
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to save POP comment.');
    }
  };

  // ===== UPDATE PAYMENT STATUS =====
  const updatePaymentStatus = async (epvId, status) => {
    setError('');
    try {
      await axios.put(`/api/epv/${epvId}/payment-status`, {
        status,
        changedBy: userLabel,
        userRole: user.role,
      });
      setSuccessMsg('Payment status updated.');
      refreshAll();
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to update payment status.');
    }
  };

  // ===== GENERATE INVOICE =====
  const generateInvoice = async (epvId) => {
    setInvoiceGenerating(epvId);
    setError('');
    try {
      const res = await axios.post('/api/invoices/generate', {
        verificationId: epvId,
        generatedBy: userLabel,
        userRole: user.role,
      });
      setSuccessMsg(`Invoice ${res.data.invoiceNumber} generated.`);
      refreshAll();
    } catch (err) {
      if (err.response?.status === 409) {
        setSuccessMsg('Invoice already exists for this EPV.');
      } else {
        setError(err.response?.data?.message || 'Failed to generate invoice.');
      }
    } finally {
      setInvoiceGenerating(null);
    }
  };

  // ===== SEND INVOICE =====
  const sendInvoice = async (invoiceId) => {
    if (!window.confirm('Send this invoice to all facility email addresses?')) return;
    setInvoiceSending(invoiceId);
    setError('');
    try {
      const res = await axios.post(`/api/invoices/send/${invoiceId}`, {
        sentBy: userLabel,
        userRole: user.role,
      });
      setSuccessMsg(`Invoice sent to: ${res.data.sentTo}`);
      refreshAll();
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to send invoice.');
    } finally {
      setInvoiceSending(null);
    }
  };

  // ===== DELETE INVOICE =====
  const deleteInvoice = async (invoiceId) => {
    if (!window.confirm('Are you sure you want to delete this invoice?')) return;
    setError('');
    try {
      await axios.delete(`/api/invoices/${invoiceId}`, {
        data: { deletedBy: userLabel, userRole: user.role },
      });
      setSuccessMsg('Invoice deleted.');
      refreshAll();
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to delete invoice.');
    }
  };

  // Helper: get invoice for an EPV
  const getInvoiceForEpv = (epvId) => invoices.find(inv => inv.VerificationId === epvId);

  // Helper: get invoice status for an EPV
  const getInvoiceStatus = (epv) => {
    if (epv.Status !== 'Completed') return { status: 'not-ready', label: '—' };
    // Awaiting inspector EPV
    if (epv.inspectorEPV && epv.inspectorEPV.Status !== 'Completed') {
      return { status: 'awaiting', label: 'Rejected — Awaiting Inspector EPV' };
    }
    // Not yet verified and no inspector EPV
    if (!epv.IsVerified && !epv.inspectorEPV) {
      return { status: 'not-verified', label: 'Awaiting Verification' };
    }
    // Has amount — ready for invoice
    return { status: 'ready', label: 'Ready' };
  };

  // ===== REJECT EPV — create inspector EPV to correct amounts =====
  const rejectAndInspect = async (epv) => {
    if (!window.confirm('Reject this EPV? You will be redirected to complete an Inspector EPV with the correct amounts.')) return;
    // If inspector EPV already exists, navigate to it
    if (epv.inspectorEPV) {
      navigate(`/epv/${epv.inspectorEPV.Token}`);
      return;
    }
    // Otherwise create a new inspector EPV
    setInspCreating(epv.Id);
    setError('');
    try {
      const res = await axios.post('/api/epv/inspector/create', {
        clientEpvId: epv.Id,
        inspectorId: user.id,
        inspectorName: `${user.firstName} ${user.lastName}`,
        userRole: user.role,
      });
      setSuccessMsg('Inspector EPV created. Redirecting to form...');
      setTimeout(() => navigate(`/epv/${res.data.token}`), 500);
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to create Inspector EPV.');
    } finally {
      setInspCreating(null);
    }
  };

  // ===== DELETE INSPECTOR EPV (Super Admin only) =====
  const deleteInspectorEPV = async (inspEpvId) => {
    if (!window.confirm('Are you sure you want to delete this Inspector EPV? This action cannot be undone.')) return;
    try {
      await axios.delete(`/api/epv/inspector/${inspEpvId}`, { data: { deletedBy: userLabel, userRole: user.role } });
      setSuccessMsg('Inspector EPV deleted.');
      refreshAll();
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to delete Inspector EPV.');
    }
  };

  // ===== CREATE INSPECTOR EPV =====
  const createInspectorEPV = async (clientEpvId) => {
    setInspCreating(clientEpvId);
    setError('');
    try {
      const res = await axios.post('/api/epv/inspector/create', {
        clientEpvId,
        inspectorId: user.id,
        inspectorName: `${user.firstName} ${user.lastName}`,
      });
      setSuccessMsg('Inspector EPV created. Redirecting to form...');
      setTimeout(() => navigate(`/epv/${res.data.token}`), 500);
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to create Inspector EPV.');
    } finally {
      setInspCreating(null);
    }
  };

  // ===== SEND EPV (admin only) =====
  const sendEPV = async () => {
    if (!activeCompanyId) return;
    setEpvSending(true);
    setError('');
    try {
      const res = await axios.post('/api/epv/send', {
        clientRecordId: activeCompanyId,
        sentBy: userLabel,
        userRole: user.role,
      });
      setSuccessMsg(res.data.message);
      refreshAll();
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to send EPV.');
    } finally {
      setEpvSending(false);
    }
  };

  const formatDate = (dateStr) => {
    if (!dateStr) return '';
    return new Date(dateStr).toLocaleString();
  };

  // ===== NO COMPANY SELECTED (admin without selection) =====
  if (canSelectCompany && !activeCompanyId) {
    return (
      <div className="page-container co-page">
        <div className="page-card co-selector-card">
          <h2>Company Overview</h2>
          <p className="co-selector-desc">Select a business to view its company overview.</p>
          <div className="co-selector-search">
            <input
              type="text"
              placeholder="Search by name, Account Code, or Town..."
              value={companySearch}
              onChange={(e) => setCompanySearch(e.target.value)}
              className="co-selector-input"
            />
          </div>
          {companiesLoading ? (
            <p className="co-loading">Loading businesses...</p>
          ) : (
            <div className="co-selector-list">
              {filteredCompanies.length === 0 ? (
                <p className="co-loading">No businesses found.</p>
              ) : (
                filteredCompanies.map(c => (
                  <div key={c.Id} className="co-selector-item" onClick={() => selectCompany(c.Id)}>
                    <div className="co-selector-item-main">
                      <strong>{c.BusinessName || 'Unknown'}</strong>
                      <span className="co-selector-badges">
                        {c.AccountCode && <span className="co-selector-badge co-selector-badge-acc">{c.AccountCode}</span>}
                      </span>
                    </div>
                    <div className="co-selector-item-sub">
                      {c.Town && <span>{c.Town}</span>}
                      {c.Email && <span>{c.Email}</span>}
                      {c.VerifiedAt ? (
                        <span className="co-selector-verified">Verified</span>
                      ) : (
                        <span className="co-selector-pending">Pending</span>
                      )}
                    </div>
                  </div>
                ))
              )}
            </div>
          )}
        </div>
      </div>
    );
  }

  // ===== NO COMPANY for company user =====
  if (!canSelectCompany && !activeCompanyId) {
    return (
      <div className="page-container co-page">
        <div className="page-card">
          <h2>Company Overview</h2>
          <p className="co-no-company">Your account is not linked to a company. Please contact your administrator.</p>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="page-container co-page">
        <div className="page-card">
          <h2>Company Overview</h2>
          <p style={{ color: '#888' }}>Loading company details...</p>
        </div>
      </div>
    );
  }

  // ===== TABLE FILTERING =====
  const matchesFilter = (value, filter) => {
    if (!filter) return true;
    return String(value || '').toLowerCase().includes(filter.toLowerCase());
  };

  const filteredEpvList = epvList.filter(epv => {
    const f = epvFilters;
    if (!Object.values(f).some(v => v)) return true;
    const period = `${MONTH_NAMES[(epv.PeriodMonth || 1) - 1]} ${epv.PeriodYear}`;
    const ao = getAmountOutstanding(epv);
    return matchesFilter(epv.ReferenceNumber, f.ref)
      && matchesFilter(period, f.period)
      && matchesFilter(epv.Status, f.status)
      && matchesFilter(epv.CompletedAt ? formatDate(epv.CompletedAt) : '', f.completed)
      && matchesFilter(epv.ClientPaymentStatus || 'Not Paid', f.payment)
      && matchesFilter(ao.label, f.amount)
      && matchesFilter(epv.ReconciledAmount, f.reconciled);
  });

  const filteredInvEpvList = epvList.filter(e => e.Status === 'Completed').filter(epv => {
    const f = invFilters;
    if (!Object.values(f).some(v => v)) return true;
    const inv = getInvoiceForEpv(epv.Id);
    const invStatus = getInvoiceStatus(epv);
    const ao = getAmountOutstanding(epv);
    const period = `${MONTH_NAMES[(epv.PeriodMonth || 1) - 1]} ${epv.PeriodYear}`;
    const statusLabel = inv ? (inv.SentAt ? 'Sent' : 'Ready to Send') : invStatus.label || 'No Invoice';
    return matchesFilter(epv.ReferenceNumber, f.ref)
      && matchesFilter(period, f.period)
      && matchesFilter(inv?.InvoiceNumber, f.invoiceNum)
      && matchesFilter(ao.label, f.amount)
      && matchesFilter(statusLabel, f.status)
      && matchesFilter(inv?.SentTo, f.sentTo);
  });

  return (
    <div className="page-container co-page">
      {error && <p className="co-error">{error}</p>}
      {successMsg && <p className="co-success">{successMsg}</p>}

      {/* Admin: Switch Company Bar */}
      {canSelectCompany && (
        <div className="co-switch-bar">
          <button className="co-switch-btn" onClick={() => { setActiveCompanyId(null); setCompany(null); setCompanyUsers([]); setPendingInvites([]); setEpvList([]); setSearchParams({}, { replace: true }); }}>
            &larr; Switch Business
          </button>
          <span className="co-switch-label">Viewing as {user.role}</span>
        </div>
      )}

      {/* Delete User Modal */}
      {deleteConfirm && (
        <div className="co-modal-overlay">
          <div className="co-modal">
            <h3>Remove User</h3>
            <p>Are you sure you want to remove this user from this company?</p>
            <div className="co-modal-record">
              <strong>{deleteConfirm.FirstName} {deleteConfirm.LastName}</strong><br />
              {deleteConfirm.Email} — {deleteConfirm.Role}
            </div>
            <p className="co-modal-warning">This will delete their account.</p>
            <div className="co-modal-actions">
              <button className="co-delete-confirm-btn" onClick={executeDeleteUser}>Yes, Remove</button>
              <button className="co-cancel-btn" onClick={() => setDeleteConfirm(null)}>Cancel</button>
            </div>
          </div>
        </div>
      )}

      {/* Reset Password Modal */}
      {resetModal && (
        <div className="co-modal-overlay">
          <div className="co-modal">
            <h3 style={{ color: '#0E7C7B' }}>Reset Password</h3>
            <p>Set a new password for:</p>
            <div className="co-modal-record">
              <strong>{resetModal.FirstName} {resetModal.LastName}</strong><br />
              {resetModal.Email}
            </div>
            <div style={{ margin: '16px 0' }}>
              <input
                type="password"
                placeholder="New password (min 6 characters)"
                value={resetPassword}
                onChange={(e) => setResetPassword(e.target.value)}
                className="co-input"
              />
            </div>
            <div className="co-modal-actions">
              <button className="co-save-btn" onClick={executeResetPassword} disabled={resetting || resetPassword.length < 6}>
                {resetting ? 'Resetting...' : 'Reset Password'}
              </button>
              <button className="co-cancel-btn" onClick={() => { setResetModal(null); setResetPassword(''); }} disabled={resetting}>Cancel</button>
            </div>
          </div>
        </div>
      )}

      {/* Add EPV Modal */}
      {showAddEpvModal && (
        <div className="co-modal-overlay">
          <div className="co-modal">
            <h3 style={{ color: '#0E7C7B' }}>Add Verification</h3>
            <p>Select the month and year for the verification you want to submit.</p>
            <div style={{ display: 'flex', gap: '12px', margin: '16px 0' }}>
              <select value={addEpvMonth} onChange={(e) => setAddEpvMonth(e.target.value)} className="co-input" style={{ flex: 1 }}>
                {MONTH_NAMES.map((m, i) => (
                  <option key={i} value={i + 1}>{m}</option>
                ))}
              </select>
              <select value={addEpvYear} onChange={(e) => setAddEpvYear(e.target.value)} className="co-input" style={{ width: '120px' }}>
                {Array.from({ length: 5 }, (_, i) => new Date().getFullYear() - i).map(y => (
                  <option key={y} value={y}>{y}</option>
                ))}
              </select>
            </div>
            {epvList.some(e => e.PeriodMonth === parseInt(addEpvMonth) && e.PeriodYear === parseInt(addEpvYear)) && (
              <p style={{ color: '#DC3545', fontSize: '13px', margin: '0 0 12px' }}>
                A verification for {MONTH_NAMES[parseInt(addEpvMonth) - 1]} {addEpvYear} already exists.
              </p>
            )}
            <div className="co-modal-actions">
              <button
                className="co-save-btn"
                onClick={createManualEPV}
                disabled={addEpvCreating || epvList.some(e => e.PeriodMonth === parseInt(addEpvMonth) && e.PeriodYear === parseInt(addEpvYear))}
              >
                {addEpvCreating ? 'Creating...' : 'Create & Complete'}
              </button>
              <button className="co-cancel-btn" onClick={() => setShowAddEpvModal(false)} disabled={addEpvCreating}>Cancel</button>
            </div>
          </div>
        </div>
      )}

      {/* ===== COMPANY HEADER ===== */}
      <div className="page-card co-header-card">
        <div className="co-header">
          <div>
            <h2>{company?.BusinessName || 'Company Overview'}</h2>
            <p className="co-subtitle">
              {company?.AccountCode && <span className="co-account-code">{company.AccountCode}</span>}
              {company?.Town && <span className="co-town">{company.Town}</span>}
            </p>
          </div>
          <div className="co-header-badges">
            {company?.VerifiedAt ? (
              <span className="co-verified-badge">Verified</span>
            ) : (
              <span className="co-pending-badge">Pending Verification</span>
            )}
          </div>
        </div>

        {/* Stats row */}
        <div className="co-stats">
          <div className="co-stat">
            <span className="co-stat-number">{companyUsers.length}</span>
            <span className="co-stat-label">Active Users</span>
          </div>
          <div className="co-stat">
            <span className="co-stat-number">{pendingInvites.length}</span>
            <span className="co-stat-label">Pending Invites</span>
          </div>
          <div className="co-stat">
            <span className="co-stat-number">{epvList.filter(e => e.Status === 'Pending').length}</span>
            <span className="co-stat-label">Verifications Due</span>
          </div>
          <div className="co-stat">
            <span className="co-stat-number">{epvList.filter(e => e.Status === 'Completed').length}</span>
            <span className="co-stat-label">Completed</span>
          </div>
          {(() => {
            const netTotal = epvList.reduce((sum, e) => {
              const ao = getAmountOutstanding(e);
              if (ao.className === 'co-amount-value') {
                const owed = parseFloat(ao.label.replace('R ', ''));
                const reconciled = parseFloat(e.ReconciledAmount) || 0;
                return sum + (owed - reconciled);
              }
              return sum;
            }, 0);
            const isPositive = netTotal <= 0;
            return (
              <div className={`co-stat ${isPositive ? 'co-stat-positive' : 'co-stat-outstanding'}`}>
                <span className="co-stat-number">R {Math.abs(netTotal).toFixed(2)}</span>
                <span className="co-stat-label">{isPositive ? 'Positive Amount' : 'Amount Outstanding'}</span>
              </div>
            );
          })()}
        </div>
      </div>

      {/* ===== COMPANY DETAILS ===== */}
      <div className="page-card co-section">
        <div className="co-section-header">
          <h3>Company Details</h3>
          {canEdit && !editing ? (
            <button className="co-edit-btn" onClick={startEdit}>Edit Details</button>
          ) : editing ? (
            <div className="co-edit-actions">
              <button className="co-save-btn" onClick={saveEdit} disabled={saving}>{saving ? 'Saving...' : 'Save Changes'}</button>
              <button className="co-cancel-btn" onClick={cancelEdit} disabled={saving}>Cancel</button>
            </div>
          ) : null}
        </div>

        <div className="co-details-grid">
          {DETAIL_FIELDS.map(f => (
            <div key={f.key} className="co-detail-item">
              <label>{f.label}</label>
              {editing && !f.readOnly ? (
                f.key === 'FacilityProvince' ? (
                  <select
                    className={`co-input ${editValues[f.key] !== originalValues[f.key] ? 'co-changed' : ''}`}
                    value={editValues[f.key]}
                    onChange={(e) => setEditValues(prev => ({ ...prev, [f.key]: e.target.value }))}
                  >
                    <option value="">— Select Province —</option>
                    {SA_PROVINCES.map(p => <option key={p} value={p}>{p}</option>)}
                  </select>
                ) : (
                  <input
                    type="text"
                    className={`co-input ${editValues[f.key] !== originalValues[f.key] ? 'co-changed' : ''}`}
                    value={editValues[f.key]}
                    onChange={(e) => setEditValues(prev => ({ ...prev, [f.key]: e.target.value }))}
                  />
                )
              ) : (
                <span className={`co-detail-value${f.key === 'Email' && company?.[f.key] && emailStatus[company[f.key]?.trim().toLowerCase()] === 'Failed' ? ' co-email-failed' : ''}`}>
                  {company?.[f.key] || '—'}
                  {f.key === 'Email' && company?.[f.key] && emailStatus[company[f.key]?.trim().toLowerCase()] === 'Failed' && (
                    <span className="co-email-failed-badge">Email Failed</span>
                  )}
                </span>
              )}
            </div>
          ))}
        </div>

        {/* Contact Groups */}
        <div className="co-contacts">
          {CONTACT_GROUPS.map(group => (
            <div key={group.title} className="co-contact-group">
              <h4>{group.title}</h4>
              <div className="co-contact-fields">
                {group.fields.map(f => {
                  const isEmailField = f.key.toLowerCase().includes('email');
                  const emailVal = company?.[f.key]?.trim().toLowerCase();
                  const isFailed = isEmailField && emailVal && emailStatus[emailVal] === 'Failed';
                  return (
                  <div key={f.key} className="co-detail-item">
                    <label>{f.label}</label>
                    {editing ? (
                      <input
                        type="text"
                        className={`co-input ${editValues[f.key] !== originalValues[f.key] ? 'co-changed' : ''}`}
                        value={editValues[f.key]}
                        onChange={(e) => setEditValues(prev => ({ ...prev, [f.key]: e.target.value }))}
                      />
                    ) : (
                      <span className={`co-detail-value${isFailed ? ' co-email-failed' : ''}`}>
                        {company?.[f.key] || '—'}
                        {isFailed && <span className="co-email-failed-badge">Email Failed</span>}
                      </span>
                    )}
                  </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* ===== USERS ===== */}
      <div className="page-card co-section">
        <div className="co-section-header">
          <h3>Users ({companyUsers.length})</h3>
          {(isAdmin || user.role === 'Company Admin') && (
            <button className="co-invite-btn" onClick={() => setShowInviteForm(!showInviteForm)}>
              {showInviteForm ? 'Cancel' : '+ Invite User'}
            </button>
          )}
        </div>

        {showInviteForm && (
          <form className="co-invite-form" onSubmit={sendInvite}>
            <input
              type="email"
              placeholder="Email address"
              value={inviteEmail}
              onChange={(e) => setInviteEmail(e.target.value)}
              className="co-input"
              required
            />
            <select value={inviteRole} onChange={(e) => setInviteRole(e.target.value)} className="co-input co-role-select">
              <option value="User">User</option>
              <option value="Company Admin">Company Admin</option>
            </select>
            <button type="submit" className="co-send-invite-btn" disabled={inviteSending}>
              {inviteSending ? 'Sending...' : 'Send Invite'}
            </button>
          </form>
        )}

        {usersLoading ? (
          <p className="co-loading">Loading users...</p>
        ) : (
          <>
            <div className="co-table-wrap"><table className="co-table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Email</th>
                  <th>Role</th>
                  <th>Joined</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {companyUsers.length === 0 ? (
                  <tr><td colSpan="5" className="co-loading">No users yet.</td></tr>
                ) : (
                  companyUsers.map(u => (
                    <tr key={u.Id}>
                      <td>{u.FirstName} {u.LastName}</td>
                      <td>{u.Email}</td>
                      <td><span className={`co-role-badge co-role-${u.Role.toLowerCase().replace(/\s/g, '-')}`}>{u.Role}</span></td>
                      <td className="co-date">{formatDate(u.CreatedAt)}</td>
                      <td className="co-user-actions">
                        {canResetPassword && (
                          <button
                            className="co-reset-btn"
                            onClick={() => { setResetModal(u); setResetPassword(''); }}
                            title="Reset password"
                          >
                            Reset PW
                          </button>
                        )}
                        {(isAdmin || user.role === 'Company Admin') && (
                          <button
                            className="co-remove-btn"
                            onClick={() => setDeleteConfirm(u)}
                            disabled={u.Email === user.email}
                            title={u.Email === user.email ? "Can't remove yourself" : 'Remove user'}
                          >
                            Remove
                          </button>
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table></div>

            {pendingInvites.length > 0 && (
              <div className="co-pending-section">
                <h4>Pending Invitations</h4>
                {pendingInvites.map(inv => (
                  <div key={inv.Id} className="co-pending-item">
                    <span>{inv.Email}</span>
                    <span className="co-pending-role">{inv.Role}</span>
                    <span className="co-date">{formatDate(inv.CreatedAt)}</span>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>

      {/* ===== EGG PRODUCTION VERIFICATIONS ===== */}
      <div className="page-card co-section">
        <div className="co-section-header">
          <h3 style={{fontSize: '13px', margin: 0}}>EPVs ({epvList.length})</h3>
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
            {isAdmin && (() => {
              const now = new Date();
              const curMonth = now.getMonth() + 1;
              const curYear = now.getFullYear();
              const existsThisMonth = epvList.some(e => e.PeriodMonth === curMonth && e.PeriodYear === curYear);
              return existsThisMonth ? (
                <span className="co-epv-sent-label">EPV SENT {MONTH_NAMES[curMonth - 1].slice(0,3).toUpperCase()} {curYear}</span>
              ) : (
                <button className="co-epv-send-btn" onClick={sendEPV} disabled={epvSending}>
                  {epvSending ? 'Sending...' : 'Send EPV'}
                </button>
              );
            })()}
            <button className="co-epv-send-btn" onClick={openAddEpvModal}>
              + Add
            </button>
          </div>
        </div>

        {epvLoading ? (
          <p className="co-loading">Loading verifications...</p>
        ) : epvList.length === 0 ? (
          <p className="co-loading">No verifications sent yet.{isAdmin ? ' Click "Send EPV" to send the first one.' : ' Your administrator will send the first one.'}</p>
        ) : (
          <div className="co-table-wrap"><table className="co-table co-epv-table">
            <thead>
              <tr>
                <th>Ref #</th>
                <th>Period</th>
                <th>Completed</th>
                <th>Facility EPV</th>
                <th>Insp. EPV</th>
                <th>Verified</th>
                <th>Man.</th>
                <th>Comments</th>
                <th>Owing</th>
                <th>Paid</th>
                <th>POP</th>
                <th>POP Note</th>
                <th>Recon. Am</th>
                <th>Reconciled</th>
              </tr>
              <tr className="co-filter-row">
                <th><input className="co-filter-input" placeholder="Search..." value={epvFilters.ref || ''} onChange={e => setEpvFilters(p => ({...p, ref: e.target.value}))} /></th>
                <th><input className="co-filter-input" placeholder="Search..." value={epvFilters.period || ''} onChange={e => setEpvFilters(p => ({...p, period: e.target.value}))} /></th>
                <th><input className="co-filter-input" placeholder="Search..." value={epvFilters.completed || ''} onChange={e => setEpvFilters(p => ({...p, completed: e.target.value}))} /></th>
                <th></th>
                <th></th>
                <th></th>
                <th></th>
                <th></th>
                <th><input className="co-filter-input" placeholder="Search..." value={epvFilters.amount || ''} onChange={e => setEpvFilters(p => ({...p, amount: e.target.value}))} /></th>
                <th><input className="co-filter-input" placeholder="Search..." value={epvFilters.payment || ''} onChange={e => setEpvFilters(p => ({...p, payment: e.target.value}))} /></th>
                <th></th>
                <th></th>
                <th><input className="co-filter-input" placeholder="Search..." value={epvFilters.reconciled || ''} onChange={e => setEpvFilters(p => ({...p, reconciled: e.target.value}))} /></th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {filteredEpvList.map(epv => {
                epv._invoice = getInvoiceForEpv(epv.Id);
                return (
                <React.Fragment key={epv.Id}>
                <tr
                  className={`co-epv-row ${epv.IsReconciled ? 'co-epv-reconciled' : ''} ${expandedEpvId === epv.Id ? 'co-epv-expanded' : ''}`}
                  onClick={() => setExpandedEpvId(expandedEpvId === epv.Id ? null : epv.Id)}
                >
                  <td className="co-epv-ref">{(epv.ReferenceNumber || '—').replace('EPV-', '')}</td>
                  <td className="co-epv-period">
                    {MONTH_NAMES[(epv.PeriodMonth || 1) - 1].slice(0,3)} '{String(epv.PeriodYear).slice(2)}
                  </td>
                  <td className="co-date">{epv.CompletedAt ? formatDate(epv.CompletedAt) : '—'}</td>
                  <td className="co-epv-actions" onClick={e => e.stopPropagation()}>
                    {epv.Status === 'Pending' ? (
                      <button className="co-epv-complete-btn" onClick={() => navigate(`/epv/${epv.Token}`)}>
                        Complete
                      </button>
                    ) : isAdmin ? (
                      <button className="co-epv-edit-btn" onClick={() => navigate(`/epv/${epv.Token}`)}>
                        Edit
                      </button>
                    ) : (
                      <button className="co-epv-view-btn" onClick={() => navigate(`/epv/${epv.Token}`)}>
                        View
                      </button>
                    )}
                  </td>
                  <td className="co-epv-inspection" onClick={e => e.stopPropagation()}>
                    {epv.inspectorEPV ? (
                      epv.inspectorEPV.Status === 'Pending' ? (
                        (user.role === 'Super Admin' || user.role === 'Inspector') ? (
                          <button className="co-epv-complete-btn" onClick={() => navigate(`/epv/${epv.inspectorEPV.Token}`)}>
                            Complete
                          </button>
                        ) : (
                          <span className="co-insp-awaiting">In Progress</span>
                        )
                      ) : user.role === 'Super Admin' ? (
                        <button className="co-epv-edit-btn" onClick={() => navigate(`/epv/${epv.inspectorEPV.Token}`)}>
                          Edit
                        </button>
                      ) : (
                        <button className="co-epv-view-btn" onClick={() => navigate(`/epv/${epv.inspectorEPV.Token}`)}>
                          View
                        </button>
                      )
                    ) : (
                      <span className="co-pop-na">—</span>
                    )}
                  </td>
                  <td className="co-epv-verify" onClick={e => e.stopPropagation()}>
                    {epv.Status !== 'Completed' ? (
                      <span className="co-not-verified">—</span>
                    ) : epv.IsVerified ? (
                      user.role === 'Super Admin' ? (
                        <label className="co-verify-checkbox">
                          <input
                            type="checkbox"
                            checked
                            onChange={() => toggleVerify(epv.Id, epv.IsVerified)}
                          />
                          <span>Approved</span>
                        </label>
                      ) : (
                        <span className="co-verified-badge">Approved</span>
                      )
                    ) : epv.inspectorEPV && epv.inspectorEPV.Status === 'Completed' ? (
                      user.role === 'Super Admin' ? (
                        <div>
                          <span className="co-rejected-badge">Facility EPV Rejected</span>
                          <label className="co-verify-checkbox" style={{ marginTop: 6 }}>
                            <input
                              type="checkbox"
                              checked={false}
                              onChange={() => toggleVerify(epv.Id, false)}
                            />
                            <span>Override to Approved</span>
                          </label>
                        </div>
                      ) : (
                        <span className="co-rejected-badge">Facility EPV Rejected</span>
                      )
                    ) : epv.inspectorEPV && epv.inspectorEPV.Status !== 'Completed' ? (
                      <span className="co-rejected-awaiting-badge">Rejected — Awaiting Inspector EPV</span>
                    ) : (user.role === 'Super Admin' || user.role === 'Inspector') ? (
                      <div className="co-verify-actions">
                        <button
                          className="co-verify-approve-btn"
                          onClick={() => toggleVerify(epv.Id, false)}
                          title="Approve — amounts are correct"
                        >
                          Approve
                        </button>
                        <button
                          className="co-verify-reject-btn"
                          onClick={() => rejectAndInspect(epv)}
                          disabled={inspCreating === epv.Id}
                          title="Reject — complete Inspector EPV with correct amounts"
                        >
                          {inspCreating === epv.Id ? 'Creating...' : 'Reject'}
                        </button>
                      </div>
                    ) : (
                      <span className="co-not-verified">Not Verified</span>
                    )}
                  </td>
                  <td className="co-epv-manual-insp" onClick={e => e.stopPropagation()}>
                    {epv.Status === 'Completed' ? (
                      (isAdmin || isInspector) ? (
                        <label className="co-manual-insp-label">
                          <input
                            type="checkbox"
                            checked={!!epv.ManualInspection}
                            onChange={() => toggleManualInspection(epv.Id, epv.ManualInspection)}
                          />
                          {epv.ManualInspection && (
                            <>
                              <span className="co-manual-insp-yes">Yes</span>
                              {epv.ManualInspectionBy && (
                                <span className="co-manual-insp-by">{epv.ManualInspectionBy}</span>
                              )}
                            </>
                          )}
                        </label>
                      ) : (
                        epv.ManualInspection ? (
                          <span className="co-manual-insp-yes">
                            Yes
                            {epv.ManualInspectionBy && (
                              <span className="co-manual-insp-by">{epv.ManualInspectionBy}</span>
                            )}
                          </span>
                        ) : (
                          <span className="co-pop-na">—</span>
                        )
                      )
                    ) : (
                      <span className="co-pop-na">—</span>
                    )}
                  </td>
                  <td className="co-epv-comment" onClick={e => e.stopPropagation()}>
                    {epv.Status === 'Completed' ? (
                      (user.role === 'Super Admin' || user.role === 'Inspector') ? (
                        <div className="co-comment-cell">
                          <textarea
                            className="co-comment-input"
                            placeholder="Note..."
                            value={epvComments[epv.Id] !== undefined ? epvComments[epv.Id] : (epv.InspectorComment || '')}
                            onChange={(e) => setEpvComments(prev => ({ ...prev, [epv.Id]: e.target.value }))}
                            rows={2}
                          />
                          {(epvComments[epv.Id] !== undefined && epvComments[epv.Id] !== (epv.InspectorComment || '')) && (
                            <button
                              className="co-comment-save-btn"
                              onClick={() => saveComment(epv.Id)}
                            >
                              Save
                            </button>
                          )}
                        </div>
                      ) : epv.InspectorComment ? (
                        <span className="co-comment-text">{epv.InspectorComment}</span>
                      ) : (
                        <span className="co-pop-na">—</span>
                      )
                    ) : (
                      <span className="co-pop-na">—</span>
                    )}
                  </td>
                  <td className="co-epv-amount-outstanding">
                    {(() => {
                      const ao = getAmountOutstanding(epv);
                      if (ao.className === 'co-amount-value') {
                        const owed = parseFloat(ao.label.replace('R ', ''));
                        const reconciled = parseFloat(epv.ReconciledAmount) || 0;
                        const net = owed - reconciled;
                        if (net < 0) return <span className="co-amount-credit">R {Math.abs(net).toFixed(2)} credit</span>;
                        if (net === 0) return <span className="co-amount-settled">R 0.00</span>;
                        return <span className="co-amount-value">R {net.toFixed(2)}</span>;
                      }
                      return ao.className ? <span className={ao.className}>{ao.label}</span> : <span className="co-pop-na">{ao.label}</span>;
                    })()}
                  </td>
                  <td className="co-epv-payment-status" onClick={e => e.stopPropagation()}>
                    {epv.Status === 'Completed' ? (
                      epv.POPFilePath ? (
                        <span className="co-payment-badge co-payment-paid">Paid</span>
                      ) : (
                        <select
                          className={`co-payment-select ${(epv.ClientPaymentStatus || 'Not Paid') === 'Paid' ? 'co-payment-paid' : 'co-payment-not-paid'}`}
                          value={epv.ClientPaymentStatus || 'Not Paid'}
                          onChange={e => updatePaymentStatus(epv.Id, e.target.value)}
                        >
                          <option value="Not Paid">Not Paid</option>
                          <option value="Paid">Paid</option>
                        </select>
                      )
                    ) : (
                      <span className="co-pop-na">—</span>
                    )}
                  </td>
                  <td className="co-epv-pop" onClick={e => e.stopPropagation()}>
                    {epv.POPFilePath ? (
                      <div className="co-pop-uploaded-container">
                        <a href={`/api/epv/${epv.Id}/pop`} target="_blank" rel="noreferrer" className="co-pop-view-btn">
                          <span className="co-pop-icon">&#128196;</span> View
                        </a>
                        <span className="co-pop-date">{formatDate(epv.POPUploadedAt)}</span>
                        {isAdmin && (
                          <button className="co-pop-delete-btn" onClick={() => deletePop(epv.Id)} title="Delete POP">
                            &#10005;
                          </button>
                        )}
                      </div>
                    ) : epv.Status === 'Completed' && !epv.IsReconciled && user.role !== 'Inspector' ? (
                      <label className="co-pop-upload-btn">
                        {popUploading === epv.Id ? '...' : 'Upload'}
                        <input
                          type="file"
                          accept=".pdf,.png,.jpg,.jpeg"
                          style={{ display: 'none' }}
                          onChange={(e) => { if (e.target.files[0]) handlePopUpload(epv.Id, e.target.files[0]); }}
                          disabled={popUploading === epv.Id}
                        />
                      </label>
                    ) : (
                      <span className="co-pop-na">—</span>
                    )}
                  </td>
                  <td className="co-epv-pop-comment" onClick={e => e.stopPropagation()}>
                    {epv.Status === 'Completed' ? (
                      <div className="co-comment-cell">
                        <textarea
                          className="co-comment-input"
                          placeholder="Note..."
                          value={popComments[epv.Id] !== undefined ? popComments[epv.Id] : (epv.POPComment || '')}
                          onChange={(e) => setPopComments(prev => ({ ...prev, [epv.Id]: e.target.value }))}
                          rows={2}
                        />
                        {(popComments[epv.Id] !== undefined && popComments[epv.Id] !== (epv.POPComment || '')) && (
                          <button
                            className="co-comment-save-btn"
                            onClick={() => savePopComment(epv.Id)}
                          >
                            Save
                          </button>
                        )}
                      </div>
                    ) : (
                      <span className="co-pop-na">—</span>
                    )}
                  </td>
                  <td className="co-epv-reconciled-amount" onClick={e => e.stopPropagation()}>
                    {(() => {
                      const ao = getAmountOutstanding(epv);
                      if (ao.className !== 'co-amount-value') return <span className="co-pop-na">—</span>;
                      return isAdmin ? (
                        <div className="co-reconciled-amount-cell">
                          <input
                            type="number"
                            step="0.01"
                            className="co-reconciled-amount-input"
                            placeholder="0.00"
                            value={reconciledAmounts[epv.Id] !== undefined ? reconciledAmounts[epv.Id] : (epv.ReconciledAmount || '')}
                            onChange={(e) => setReconciledAmounts(prev => ({ ...prev, [epv.Id]: e.target.value }))}
                          />
                          {(reconciledAmounts[epv.Id] !== undefined && reconciledAmounts[epv.Id] !== String(epv.ReconciledAmount || '')) && (
                            <button className="co-reconciled-amount-save" onClick={() => saveReconciledAmount(epv.Id)}>
                              Save
                            </button>
                          )}
                        </div>
                      ) : (
                        <span className="co-reconciled-amount-text">
                          {epv.ReconciledAmount ? `R ${parseFloat(epv.ReconciledAmount).toFixed(2)}` : '—'}
                        </span>
                      );
                    })()}
                  </td>
                  <td className="co-epv-reconcile" onClick={e => e.stopPropagation()}>
                    {epv.IsReconciled ? (
                      isAdmin ? (
                        <label className="co-reconcile-checkbox">
                          <input
                            type="checkbox"
                            checked
                            onChange={() => toggleReconcile(epv.Id, epv.IsReconciled)}
                          />
                          <span>Reconciled</span>
                        </label>
                      ) : (
                        <span className="co-reconciled-badge">Reconciled</span>
                      )
                    ) : isAdmin ? (
                      <label className="co-reconcile-checkbox">
                        <input
                          type="checkbox"
                          checked={false}
                          onChange={() => toggleReconcile(epv.Id, epv.IsReconciled)}
                        />
                      </label>
                    ) : (
                      <span className="co-not-reconciled">Not Reconciled</span>
                    )}
                  </td>
                </tr>
                {expandedEpvId === epv.Id && (
                  <tr className="co-progress-row">
                    <td colSpan={14}>
                      <div className="co-progress-tracker">
                        {getProgressSteps(epv).map((step, idx, arr) => (
                          <div key={idx} className={`co-progress-step co-step-${step.status}`}>
                            <div className="co-step-indicator">
                              <div className="co-step-circle">
                                {step.status === 'complete' ? '✓' : idx + 1}
                              </div>
                              {idx < arr.length - 1 && <div className="co-step-line" />}
                            </div>
                            <div className="co-step-label">{step.label}</div>
                            {step.detail && <div className="co-step-detail">{step.detail}</div>}
                          </div>
                        ))}
                      </div>
                    </td>
                  </tr>
                )}
                </React.Fragment>
              );
              })}
            </tbody>
          </table></div>
        )}
      </div>

      {/* ===== INVOICES MODULE ===== */}
      <div className="page-card co-section">
        <div className="co-section-header">
          <h3>Invoices ({invoices.length}) <span style={{ color: '#dc2626', fontSize: 13, fontWeight: 600 }}>— Feature Under Development</span></h3>
        </div>

        {epvList.filter(e => e.Status === 'Completed').length === 0 ? (
          <p className="co-loading">No completed verifications yet.</p>
        ) : (
          <div className="co-table-wrap"><table className="co-table co-invoice-table">
            <thead>
              <tr>
                <th>EPV Ref #</th>
                <th>Period</th>
                <th>Invoice #</th>
                <th>Amount</th>
                <th>Invoice Status</th>
                <th>Generated</th>
                <th>Sent</th>
                <th>Sent To</th>
                <th>Actions</th>
              </tr>
              <tr className="co-filter-row">
                <th><input className="co-filter-input" placeholder="Search..." value={invFilters.ref || ''} onChange={e => setInvFilters(p => ({...p, ref: e.target.value}))} /></th>
                <th><input className="co-filter-input" placeholder="Search..." value={invFilters.period || ''} onChange={e => setInvFilters(p => ({...p, period: e.target.value}))} /></th>
                <th><input className="co-filter-input" placeholder="Search..." value={invFilters.invoiceNum || ''} onChange={e => setInvFilters(p => ({...p, invoiceNum: e.target.value}))} /></th>
                <th><input className="co-filter-input" placeholder="Search..." value={invFilters.amount || ''} onChange={e => setInvFilters(p => ({...p, amount: e.target.value}))} /></th>
                <th><input className="co-filter-input" placeholder="Search..." value={invFilters.status || ''} onChange={e => setInvFilters(p => ({...p, status: e.target.value}))} /></th>
                <th></th>
                <th></th>
                <th><input className="co-filter-input" placeholder="Search..." value={invFilters.sentTo || ''} onChange={e => setInvFilters(p => ({...p, sentTo: e.target.value}))} /></th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {filteredInvEpvList.map(epv => {
                const inv = getInvoiceForEpv(epv.Id);
                const invStatus = getInvoiceStatus(epv);
                const ao = getAmountOutstanding(epv);
                return (
                  <tr key={epv.Id} className={inv && inv.SentAt ? 'co-inv-sent-row' : ''}>
                    <td className="co-epv-ref">{(epv.ReferenceNumber || '—').replace('EPV-', '')}</td>
                    <td>{MONTH_NAMES[(epv.PeriodMonth || 1) - 1]} {epv.PeriodYear}</td>
                    <td className="co-epv-ref">
                      {inv ? (
                        <a href={`/api/invoices/download/${inv.FilePath}`} target="_blank" rel="noreferrer" className="co-invoice-link">
                          {inv.InvoiceNumber}
                        </a>
                      ) : '—'}
                    </td>
                    <td>
                      {ao.className === 'co-amount-value' ? (
                        <strong style={{color:'#0E7C7B'}}>{ao.label}</strong>
                      ) : '—'}
                    </td>
                    <td>
                      {inv ? (
                        inv.SentAt ? (
                          <span className="co-invoice-sent-badge">Sent</span>
                        ) : (
                          <span className="co-invoice-ready-badge">Ready to Send</span>
                        )
                      ) : invStatus.status === 'awaiting' ? (
                        <span className="co-rejected-awaiting-badge">{invStatus.label}</span>
                      ) : invStatus.status === 'not-verified' ? (
                        <span className="co-invoice-pending">{invStatus.label}</span>
                      ) : invStatus.status === 'ready' ? (
                        <span className="co-invoice-pending">No Invoice</span>
                      ) : (
                        <span className="co-pop-na">—</span>
                      )}
                    </td>
                    <td className="co-date">
                      {inv ? (
                        <>{new Date(inv.GeneratedAt).toLocaleDateString('en-ZA')}<br/><span style={{fontSize:'10px',color:'#888'}}>{inv.GeneratedBy}</span></>
                      ) : '—'}
                    </td>
                    <td className="co-date">
                      {inv && inv.SentAt ? (
                        <>{new Date(inv.SentAt).toLocaleDateString('en-ZA')}<br/><span style={{fontSize:'10px',color:'#888'}}>{inv.SentBy}</span></>
                      ) : '—'}
                    </td>
                    <td style={{fontSize:'11px',maxWidth:'180px',wordBreak:'break-all'}}>
                      {inv && inv.SentTo ? inv.SentTo : '—'}
                    </td>
                    <td>
                      <div className="co-invoice-actions">
                        {/* View PDF — everyone can see if invoice exists */}
                        {inv && (
                          <a href={`/api/invoices/download/${inv.FilePath}`} target="_blank" rel="noreferrer" className="co-invoice-download-btn">
                            View
                          </a>
                        )}
                        {/* Admin/Super Admin: Generate, Send, Delete */}
                        {isAdmin && !inv && invStatus.status === 'ready' && (
                          <button
                            className="co-invoice-generate-btn"
                            onClick={() => generateInvoice(epv.Id)}
                            disabled={invoiceGenerating === epv.Id}
                          >
                            {invoiceGenerating === epv.Id ? 'Generating...' : 'Generate Invoice'}
                          </button>
                        )}
                        {isAdmin && inv && !inv.SentAt && (
                          <button
                            className="co-invoice-send-btn"
                            onClick={() => sendInvoice(inv.Id)}
                            disabled={invoiceSending === inv.Id}
                          >
                            {invoiceSending === inv.Id ? 'Sending...' : 'Send'}
                          </button>
                        )}
                        {isAdmin && inv && (
                          <button
                            className="co-invoice-delete-btn"
                            onClick={() => deleteInvoice(inv.Id)}
                          >
                            Delete
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table></div>
        )}
      </div>

      {/* ===== CHANGE LOG ===== */}
      <div className="page-card co-section">
        <div className="co-section-header">
          <h3>Change Log ({auditTotal})</h3>
          <button className="co-toggle-btn" onClick={() => { setShowAuditLog(!showAuditLog); setAuditPage(1); }}>
            {showAuditLog ? 'Hide' : 'Show'}
          </button>
        </div>

        {showAuditLog && (
          <>
            {auditLoading ? (
              <p className="co-loading">Loading change log...</p>
            ) : auditLog.length === 0 ? (
              <p className="co-loading">No changes recorded yet.</p>
            ) : (
              <div className="co-table-wrap"><table className="co-table co-audit-table">
                <thead>
                  <tr>
                    <th>Date/Time</th>
                    <th>Field</th>
                    <th>Old Value</th>
                    <th>New Value</th>
                    <th>Changed By</th>
                    <th>Role</th>
                  </tr>
                </thead>
                <tbody>
                  {auditLog.map(entry => (
                    <tr key={entry.Id}>
                      <td className="co-date">{formatDate(entry.ChangedAt)}</td>
                      <td><span className={`co-field-badge ${entry.FieldName.startsWith('_') ? 'co-badge-event' : ''}`}>{entry.FieldName}</span></td>
                      <td className="co-old-value">{entry.OldValue || '—'}</td>
                      <td className="co-new-value">{entry.NewValue || '—'}</td>
                      <td>{entry.ChangedBy}</td>
                      <td><span className="co-role-badge">{entry.UserRole || '—'}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table></div>
            )}
            {auditTotalPages > 1 && (
              <div className="co-pagination">
                <button onClick={() => setAuditPage(p => Math.max(1, p - 1))} disabled={auditPage === 1} className="co-page-btn">Previous</button>
                <span className="co-page-info">Page {auditPage} of {auditTotalPages}</span>
                <button onClick={() => setAuditPage(p => Math.min(auditTotalPages, p + 1))} disabled={auditPage === auditTotalPages} className="co-page-btn">Next</button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

export default CompanyOverview;
