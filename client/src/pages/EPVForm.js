import React, { useEffect, useState, useCallback, useMemo } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import axios from 'axios';
import './EPVForm.css';


const LEVY_RATE = 0.020;

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

function EPVForm() {
  const { token } = useParams();
  const navigate = useNavigate();
  const user = JSON.parse(localStorage.getItem('user') || '{}');
  const isAdmin = user.role === 'Super Admin' || user.role === 'Admin' || user.role === 'Super';
  const isLoggedIn = !!user.role;

  const [verification, setVerification] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [, setSuccessMsg] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [attachments, setAttachments] = useState([]);
  const [uploadingCategory, setUploadingCategory] = useState(null); // 'egg' | 'pulp' | null
  const [step, setStep] = useState(1); // Wizard steps: 1=Business Details, 2=Calculation, 3=Review
  const [validationErrors, setValidationErrors] = useState({});
  const [focusedField, setFocusedField] = useState(null);
  // Pulp dozens stored independently so typing in dozens doesn't get mangled
  // by the kg→dozens rounding (e.g. 123 doz → 72 kg → 122 doz).
  const [pulpDozens, setPulpDozens] = useState({
    PulpOpeningStock: 0, PulpPurchased: 0, PulpConverted: 0,
    PulpSoldToTrade: 0, PulpSoldToProducers: 0, PulpConversionLoss: 0,
  });
  const [pulpEggs, setPulpEggs] = useState({
    PulpOpeningStock: 0, PulpPurchased: 0,
  });
  const [powderDozens, setPowderDozens] = useState({
    PowderOpeningStock: 0, PowderPurchased: 0, PowderConverted: 0,
    PowderSoldToTrade: 0, PowderSoldToProducers: 0, PowderConversionLoss: 0,
  });
  const [powderEggs, setPowderEggs] = useState({
    PowderOpeningStock: 0, PowderPurchased: 0,
  });

  // Form data
  const [form, setForm] = useState({
    BusinessName: '', FacilityType: '', FacilityProvince: '', PhysicalAddress: '', TradingName: '',
    AuthorizedPersonName: '', PositionInCompany: '',
    TelephoneNumber: '', CellPhoneNumber: '', EmailAddress: '',
    OpeningStock: 0, EggsProducedDuringMonth: 0, GradedEggsPurchased: 0, UngradedEggsPurchased: 0,
    TransferredOrPurchasedFromProducers: 0,
    MarketReturns: 0, MachineLoss: 0, SentToPulp: 0, Destroyed: 0, Exported: 0,
    SoldToTrade: 0, SoldToStaff: 0, SoldThroughFarmStall: 0,
    TransferredToOtherProducers: 0, ActualClosingStock: 0,
    PulpOpeningStock: 0, PulpPurchased: 0, PulpConverted: 0,
    PulpSoldToTrade: 0, PulpSoldToProducers: 0, PulpConversionLoss: 0,
    PowderOpeningStock: 0, PowderPurchased: 0, PowderConverted: 0,
    PowderSoldToTrade: 0, PowderSoldToProducers: 0, PowderConversionLoss: 0,
    VarianceReason: '',
    EggPurchaseComment: '', PulpPurchaseComment: '', PowderPurchaseComment: '', TransferPurchaseComment: '',
  });

  const fetchVerification = useCallback(async () => {
    setLoading(true);
    try {
      const res = await axios.get(`/api/epv/token/${token}`);
      const v = res.data.verification;
      setVerification(v);
      setForm({
        BusinessName: v.BusinessName || '',
        FacilityType: v.FacilityType || '',
        FacilityProvince: v.FacilityProvince || '',
        PhysicalAddress: v.PhysicalAddress || '',
        TradingName: v.TradingName || '',
        AuthorizedPersonName: v.AuthorizedPersonName || '',
        PositionInCompany: v.PositionInCompany || '',
        TelephoneNumber: v.TelephoneNumber || '',
        CellPhoneNumber: v.CellPhoneNumber || '',
        EmailAddress: v.EmailAddress || '',
        OpeningStock: parseFloat(v.OpeningStock) || 0,
        EggsProducedDuringMonth: parseFloat(v.EggsProducedDuringMonth) || 0,
        GradedEggsPurchased: parseFloat(v.GradedEggsPurchased) || 0,
        UngradedEggsPurchased: parseFloat(v.UngradedEggsPurchased) || 0,
        TransferredOrPurchasedFromProducers: parseFloat(v.TransferredOrPurchasedFromProducers) || 0,
        MarketReturns: parseFloat(v.MarketReturns) || 0,
        MachineLoss: parseFloat(v.MachineLoss) || 0,
        SentToPulp: parseFloat(v.SentToPulp) || 0,
        Destroyed: parseFloat(v.Destroyed) || 0,
        Exported: parseFloat(v.Exported) || 0,
        SoldToTrade: parseFloat(v.SoldToTrade) || 0,
        SoldToStaff: parseFloat(v.SoldToStaff) || 0,
        SoldThroughFarmStall: parseFloat(v.SoldThroughFarmStall) || 0,
        TransferredToOtherProducers: parseFloat(v.TransferredToOtherProducers) || 0,
        ActualClosingStock: parseFloat(v.ActualClosingStock) || 0,
        PulpOpeningStock: parseInt(v.PulpOpeningStock) || 0,
        PulpPurchased: parseInt(v.PulpPurchased) || 0,
        PulpConverted: parseInt(v.PulpConverted) || 0,
        PulpSoldToTrade: parseInt(v.PulpSoldToTrade) || 0,
        PulpSoldToProducers: parseInt(v.PulpSoldToProducers) || 0,
        PulpConversionLoss: parseInt(v.PulpConversionLoss) || 0,
        PowderOpeningStock: parseInt(v.PowderOpeningStock) || 0,
        PowderPurchased: parseInt(v.PowderPurchased) || 0,
        PowderConverted: parseInt(v.PowderConverted) || 0,
        PowderSoldToTrade: parseInt(v.PowderSoldToTrade) || 0,
        PowderSoldToProducers: parseInt(v.PowderSoldToProducers) || 0,
        PowderConversionLoss: parseInt(v.PowderConversionLoss) || 0,
        VarianceReason: v.VarianceReason || '',
        EggPurchaseComment: v.EggPurchaseComment || '',
        PulpPurchaseComment: v.PulpPurchaseComment || '',
        PowderPurchaseComment: v.PowderPurchaseComment || '',
        TransferPurchaseComment: v.TransferPurchaseComment || '',
      });
      // Initialize pulp dozens from kg values
      const initDozens = {
        PulpOpeningStock: parseFloat(((parseInt(v.PulpOpeningStock) || 0) * 7).toFixed(1)),
        PulpPurchased: parseFloat(((parseInt(v.PulpPurchased) || 0) * 7).toFixed(1)),
        PulpConverted: parseFloat(((parseInt(v.PulpConverted) || 0) * 7).toFixed(1)),
        PulpSoldToTrade: parseFloat(((parseInt(v.PulpSoldToTrade) || 0) * 7).toFixed(1)),
        PulpSoldToProducers: parseFloat(((parseInt(v.PulpSoldToProducers) || 0) * 7).toFixed(1)),
        PulpConversionLoss: parseFloat(((parseInt(v.PulpConversionLoss) || 0) * 7).toFixed(1)),
      };
      setPulpDozens(initDozens);
      setPulpEggs({
        PulpOpeningStock: parseFloat((initDozens.PulpOpeningStock * 12).toFixed(1)),
        PulpPurchased: parseFloat((initDozens.PulpPurchased * 12).toFixed(1)),
      });
      // Initialize powder dozens from kg values
      const initPowderDozens = {
        PowderOpeningStock: parseFloat(((parseInt(v.PowderOpeningStock) || 0) * 7).toFixed(1)),
        PowderPurchased: parseFloat(((parseInt(v.PowderPurchased) || 0) * 7).toFixed(1)),
        PowderConverted: parseFloat(((parseInt(v.PowderConverted) || 0) * 7).toFixed(1)),
        PowderSoldToTrade: parseFloat(((parseInt(v.PowderSoldToTrade) || 0) * 7).toFixed(1)),
        PowderSoldToProducers: parseFloat(((parseInt(v.PowderSoldToProducers) || 0) * 7).toFixed(1)),
        PowderConversionLoss: parseFloat(((parseInt(v.PowderConversionLoss) || 0) * 7).toFixed(1)),
      };
      setPowderDozens(initPowderDozens);
      setPowderEggs({
        PowderOpeningStock: parseFloat((initPowderDozens.PowderOpeningStock * 12).toFixed(1)),
        PowderPurchased: parseFloat((initPowderDozens.PowderPurchased * 12).toFixed(1)),
      });
      setAttachments(res.data.attachments || []);
    } catch (err) {
      setError('Verification form not found or has expired.');
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => { fetchVerification(); }, [fetchVerification]);

  // Calculated totals
  const totals = useMemo(() => {
    // A = Opening Stock + Eggs Produced
    const openingStock = parseFloat(form.OpeningStock) || 0;
    const eggsProduced = parseFloat(form.EggsProducedDuringMonth) || 0;
    const totalA = openingStock + eggsProduced;

    // B = Purchases (Graded + Ungraded)
    const graded = parseFloat(form.GradedEggsPurchased) || 0;
    const ungraded = parseFloat(form.UngradedEggsPurchased) || 0;
    const totalB = graded + ungraded;

    // C = Deductions (incl. Market Returns)
    const marketReturns = parseFloat(form.MarketReturns) || 0;
    const machineLoss = parseFloat(form.MachineLoss) || 0;
    const sentToPulp = parseFloat(form.SentToPulp) || 0;
    const destroyed = parseFloat(form.Destroyed) || 0;
    const exported = parseFloat(form.Exported) || 0;
    const totalC = marketReturns + machineLoss + sentToPulp + destroyed + exported;

    // D = Sales
    const soldToTrade = parseFloat(form.SoldToTrade) || 0;
    const soldToStaff = parseFloat(form.SoldToStaff) || 0;
    const soldThroughFarmStall = parseFloat(form.SoldThroughFarmStall) || 0;
    const totalD = soldToTrade + soldToStaff + soldThroughFarmStall;
    const levyAmount = totalD * LEVY_RATE;

    // E = Transfers (out minus in)
    const transferredTo = parseFloat(form.TransferredToOtherProducers) || 0;
    const transferredFrom = parseFloat(form.TransferredOrPurchasedFromProducers) || 0;
    const totalE = transferredTo - transferredFrom;

    // Closing Stock (Theoretical) = A + B - C - D - E
    const closingStock = totalA + totalB - totalC - totalD - totalE;

    // Actual Closing Stock (provided by producer)
    const actualClosingStock = parseFloat(form.ActualClosingStock) || 0;

    // (Loss)/Gain = Actual - Theoretical
    const lossGain = actualClosingStock - closingStock;

    // Pulp calculations (KG and Dozens)
    const pulpA = parseInt(form.PulpOpeningStock) || 0;
    const pulpB = parseInt(form.PulpPurchased) || 0;
    const pulpC = parseInt(form.PulpConverted) || 0;
    // Dozens come from the independent pulpDozens state (not derived from kg)
    const pulpADozens = pulpDozens.PulpOpeningStock;
    const pulpBDozens = pulpDozens.PulpPurchased;
    const pulpCDozens = pulpDozens.PulpConverted;

    // Stock on Hand = A + B + C
    const pulpStockOnHand = pulpA + pulpB + pulpC;
    const pulpStockOnHandDozens = pulpADozens + pulpBDozens + pulpCDozens;

    // Pulp Sales & Transfers
    const pulpSoldToTrade = parseInt(form.PulpSoldToTrade) || 0;
    const pulpSoldToProducers = parseInt(form.PulpSoldToProducers) || 0;
    const pulpConversionLoss = parseInt(form.PulpConversionLoss) || 0;
    const pulpSoldToTradeDozens = pulpDozens.PulpSoldToTrade;
    const pulpSoldToProducersDozens = pulpDozens.PulpSoldToProducers;
    const pulpConversionLossDozens = pulpDozens.PulpConversionLoss;
    // Conversion loss does not contribute to the levy.
    const pulpLevyAmount = pulpSoldToTradeDozens * LEVY_RATE;

    // Closing Stock = Stock on Hand - Sales - Sold to Producers - Conversion Loss
    const pulpClosingStock = pulpStockOnHand - pulpSoldToTrade - pulpSoldToProducers - pulpConversionLoss;
    const pulpClosingStockDozens = pulpStockOnHandDozens - pulpSoldToTradeDozens - pulpSoldToProducersDozens - pulpConversionLossDozens;

    // Powder calculations (same structure as Pulp)
    const powderA = parseInt(form.PowderOpeningStock) || 0;
    const powderB = parseInt(form.PowderPurchased) || 0;
    const powderC = parseInt(form.PowderConverted) || 0;
    const powderADozens = powderDozens.PowderOpeningStock;
    const powderBDozens = powderDozens.PowderPurchased;
    const powderCDozens = powderDozens.PowderConverted;
    const powderStockOnHand = powderA + powderB + powderC;
    const powderStockOnHandDozens = powderADozens + powderBDozens + powderCDozens;
    const powderSoldToTrade = parseInt(form.PowderSoldToTrade) || 0;
    const powderSoldToProducers = parseInt(form.PowderSoldToProducers) || 0;
    const powderConversionLoss = parseInt(form.PowderConversionLoss) || 0;
    const powderSoldToTradeDozens = powderDozens.PowderSoldToTrade;
    const powderSoldToProducersDozens = powderDozens.PowderSoldToProducers;
    const powderConversionLossDozens = powderDozens.PowderConversionLoss;
    const powderLevyAmount = powderSoldToTrade * LEVY_RATE;
    const powderClosingStock = powderStockOnHand - powderSoldToTrade - powderSoldToProducers - powderConversionLoss;
    const powderClosingStockDozens = powderStockOnHandDozens - powderSoldToTradeDozens - powderSoldToProducersDozens - powderConversionLossDozens;

    return { totalA, totalB, totalC, totalD, totalE, levyAmount, closingStock, actualClosingStock, lossGain, pulpA, pulpB, pulpC, pulpADozens, pulpBDozens, pulpCDozens, pulpStockOnHand, pulpStockOnHandDozens, pulpSoldToTrade, pulpSoldToProducers, pulpConversionLoss, pulpSoldToTradeDozens, pulpSoldToProducersDozens, pulpConversionLossDozens, pulpLevyAmount, pulpClosingStock, pulpClosingStockDozens, powderA, powderB, powderC, powderADozens, powderBDozens, powderCDozens, powderStockOnHand, powderStockOnHandDozens, powderSoldToTrade, powderSoldToProducers, powderConversionLoss, powderSoldToTradeDozens, powderSoldToProducersDozens, powderConversionLossDozens, powderLevyAmount, powderClosingStock, powderClosingStockDozens };
  }, [form, pulpDozens, powderDozens]);

  const REQUIRED_FIELDS = [
    { key: 'BusinessName', label: 'Facility Name' },
    { key: 'FacilityType', label: 'Facility Type' },
    { key: 'FacilityProvince', label: 'Facility Province' },
    { key: 'AuthorizedPersonName', label: 'Name of Owner, Manager or Authorized Person' },
    { key: 'EmailAddress', label: 'Email Address' },
  ];

  const validateStep1 = () => {
    const errors = {};
    REQUIRED_FIELDS.forEach(f => {
      if (!form[f.key] || !form[f.key].trim()) {
        errors[f.key] = `${f.label} is required`;
      }
    });
    setValidationErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const goToStep2 = () => {
    if (validateStep1()) {
      setStep(2);
    }
  };

  const handleChange = (key, value) => {
    setForm(prev => ({ ...prev, [key]: value }));
    if (validationErrors[key]) {
      setValidationErrors(prev => { const n = { ...prev }; delete n[key]; return n; });
    }
  };

  const PULP_KG_FIELDS = ['PulpOpeningStock', 'PulpPurchased', 'PulpConverted', 'PulpSoldToTrade', 'PulpSoldToProducers', 'PulpConversionLoss'];
  const PULP_EGGS_FIELDS = ['PulpOpeningStock', 'PulpPurchased'];
  const POWDER_KG_FIELDS = ['PowderOpeningStock', 'PowderPurchased', 'PowderConverted', 'PowderSoldToTrade', 'PowderSoldToProducers', 'PowderConversionLoss'];
  const POWDER_EGGS_FIELDS = ['PowderOpeningStock', 'PowderPurchased'];

  const handleNumberChange = (key, value) => {
    const isPulpKg = PULP_KG_FIELDS.includes(key);
    const isPowderKg = POWDER_KG_FIELDS.includes(key);
    const isKgField = isPulpKg || isPowderKg;
    // Allow decimals for kg fields, integers for everything else
    const raw = isKgField ? value.replace(/[^0-9.\-]/g, '') : value.replace(/[^0-9-]/g, '');
    const num = raw === '' || raw === '-' || raw === '.' ? 0 : (isKgField ? parseFloat(raw) : parseInt(raw, 10));
    const safe = isNaN(num) ? 0 : num;
    setForm(prev => ({ ...prev, [key]: safe }));
    if (isPulpKg) {
      const newDozens = parseFloat((safe * 7).toFixed(1));
      setPulpDozens(prev => ({ ...prev, [key]: newDozens }));
      if (PULP_EGGS_FIELDS.includes(key)) {
        setPulpEggs(prev => ({ ...prev, [key]: parseFloat((newDozens * 12).toFixed(1)) }));
      }
    }
    if (isPowderKg) {
      const newDozens = parseFloat((safe * 7).toFixed(1));
      setPowderDozens(prev => ({ ...prev, [key]: newDozens }));
      if (POWDER_EGGS_FIELDS.includes(key)) {
        setPowderEggs(prev => ({ ...prev, [key]: parseFloat((newDozens * 12).toFixed(1)) }));
      }
    }
  };

  // Handle pulp dozens input (1 kg = 7 dozens)
  const handlePulpDozensChange = (kgKey, dozensValue) => {
    const raw = dozensValue.replace(/[^0-9.\-]/g, '');
    const dozens = raw === '' || raw === '-' || raw === '.' ? 0 : parseFloat(raw);
    const safeD = isNaN(dozens) ? 0 : dozens;
    const kg = parseFloat((safeD / 7).toFixed(1));
    setPulpDozens(prev => ({ ...prev, [kgKey]: safeD }));
    setForm(prev => ({ ...prev, [kgKey]: kg }));
    if (PULP_EGGS_FIELDS.includes(kgKey)) {
      setPulpEggs(prev => ({ ...prev, [kgKey]: parseFloat((safeD * 12).toFixed(1)) }));
    }
  };

  // Handle pulp eggs input (1 kg = 84 eggs = 7 dozens)
  const handlePulpEggsChange = (kgKey, eggsValue) => {
    const raw = eggsValue.replace(/[^0-9.\-]/g, '');
    const eggs = raw === '' || raw === '-' || raw === '.' ? 0 : parseFloat(raw);
    const safeE = isNaN(eggs) ? 0 : eggs;
    const dozens = parseFloat((safeE / 12).toFixed(1));
    const kg = parseFloat((dozens / 7).toFixed(1));
    setPulpEggs(prev => ({ ...prev, [kgKey]: safeE }));
    setPulpDozens(prev => ({ ...prev, [kgKey]: dozens }));
    setForm(prev => ({ ...prev, [kgKey]: kg }));
  };

  // Handle powder dozens input (1 kg = 7 dozens for powder eggs)
  const handlePowderDozensChange = (kgKey, dozensValue) => {
    const raw = dozensValue.replace(/[^0-9.\-]/g, '');
    const dozens = raw === '' || raw === '-' || raw === '.' ? 0 : parseFloat(raw);
    const safeD = isNaN(dozens) ? 0 : dozens;
    const kg = parseFloat((safeD / 7).toFixed(1));
    setPowderDozens(prev => ({ ...prev, [kgKey]: safeD }));
    setForm(prev => ({ ...prev, [kgKey]: kg }));
    if (POWDER_EGGS_FIELDS.includes(kgKey)) {
      setPowderEggs(prev => ({ ...prev, [kgKey]: parseFloat((safeD * 12).toFixed(1)) }));
    }
  };

  // Handle powder eggs input (1 kg = 84 eggs = 7 dozens for powder eggs)
  const handlePowderEggsChange = (kgKey, eggsValue) => {
    const raw = eggsValue.replace(/[^0-9.\-]/g, '');
    const eggs = raw === '' || raw === '-' || raw === '.' ? 0 : parseFloat(raw);
    const safeE = isNaN(eggs) ? 0 : eggs;
    const dozens = parseFloat((safeE / 12).toFixed(1));
    const kg = parseFloat((dozens / 7).toFixed(1));
    setPowderEggs(prev => ({ ...prev, [kgKey]: safeE }));
    setPowderDozens(prev => ({ ...prev, [kgKey]: dozens }));
    setForm(prev => ({ ...prev, [kgKey]: kg }));
  };

  const MAX_UPLOAD_BYTES = 15 * 1024 * 1024;
  const ATTACHMENT_ACCEPT = '.pdf,.png,.jpg,.jpeg,application/pdf,image/png,image/jpeg';

  const handleAttachmentUpload = async (category, file) => {
    if (!file) return;
    if (file.size > MAX_UPLOAD_BYTES) {
      setError('File is larger than 15MB. Please choose a smaller file.');
      return;
    }
    const ext = (file.name.split('.').pop() || '').toLowerCase();
    if (!['pdf', 'png', 'jpg', 'jpeg'].includes(ext)) {
      setError('Only PDF, PNG, and JPG files are allowed.');
      return;
    }
    setUploadingCategory(category);
    setError('');
    try {
      const uploadedBy = user.firstName
        ? `${user.firstName} ${user.lastName} (${user.email})`
        : form.AuthorizedPersonName || form.EmailAddress || 'Unknown';
      const fd = new FormData();
      fd.append('file', file);
      fd.append('uploadedBy', uploadedBy);
      const res = await axios.post(
        `/api/epv/token/${token}/attachment?category=${category}`,
        fd,
        { headers: { 'Content-Type': 'multipart/form-data' } }
      );
      setAttachments(prev => [res.data.attachment, ...prev]);
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to upload attachment.');
    } finally {
      setUploadingCategory(null);
    }
  };

  const handleAttachmentDelete = async (attachmentId) => {
    if (!window.confirm('Delete this attachment?')) return;
    try {
      await axios.delete(`/api/epv/attachment/${attachmentId}`);
      setAttachments(prev => prev.filter(a => a.Id !== attachmentId));
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to delete attachment.');
    }
  };

  const formatBytes = (bytes) => {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / 1024 / 1024).toFixed(1) + ' MB';
  };

  const renderPurchaseEvidence = (category, commentKey, label) => {
    const apiCategory = category === 'EggPurchase' ? 'egg' : category === 'TransferPurchase' ? 'transfer' : 'pulp';
    const items = attachments.filter(a => a.Category === category);
    return (
      <div className="epv-purchase-evidence" style={{ marginTop: 12, padding: 12, background: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: 8 }}>
        <label style={{ display: 'block', fontWeight: 600, marginBottom: 6 }}>
          {label} — Source &amp; Supplier Detail
        </label>
        <textarea
          value={form[commentKey]}
          onChange={(e) => handleChange(commentKey, e.target.value)}
          disabled={isReadOnly}
          rows={3}
          placeholder="Where and from whom was the purchase made?"
          style={{ width: '100%', padding: 8, border: '1px solid #d1d5db', borderRadius: 6, fontFamily: 'inherit' }}
        />
        <div style={{ marginTop: 10 }}>
          <label style={{ display: 'block', fontWeight: 600, marginBottom: 6, fontSize: 13 }}>
            Supporting Documents (PDF / PNG / JPG, max 15MB each)
          </label>
          {!isReadOnly && (
            <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '8px 16px', background: '#0E7C7B', color: '#fff', borderRadius: 6, cursor: uploadingCategory === apiCategory ? 'not-allowed' : 'pointer', fontSize: 13, fontWeight: 600, opacity: uploadingCategory === apiCategory ? 0.6 : 1, marginBottom: 8 }}>
              <span style={{ fontSize: 16 }}>&#8593;</span> Choose File
              <input
                type="file"
                accept={ATTACHMENT_ACCEPT}
                disabled={uploadingCategory === apiCategory}
                onChange={(e) => {
                  const f = e.target.files && e.target.files[0];
                  if (f) handleAttachmentUpload(apiCategory, f);
                  e.target.value = '';
                }}
                style={{ display: 'none' }}
              />
            </label>
          )}
          {uploadingCategory === apiCategory && <div style={{ fontSize: 13, color: '#666' }}>Uploading...</div>}
          {items.length === 0 && <div style={{ fontSize: 13, color: '#888' }}>No documents uploaded yet.</div>}
          {items.length > 0 && (
            <ul style={{ listStyle: 'none', padding: 0, margin: '8px 0 0' }}>
              {items.map(a => (
                <li key={a.Id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', marginBottom: 6, background: '#fff', border: '1px solid #e5e7eb', borderRadius: 6 }}>
                  <span style={{ fontSize: 18, color: '#0E7C7B' }}>&#128196;</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 600, color: '#1f2937', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{a.OriginalName}</div>
                    <div style={{ fontSize: 11, color: '#888' }}>{formatBytes(a.FileSize)}</div>
                  </div>
                  <a href={`/api/epv/attachment/${a.Id}`} target="_blank" rel="noopener noreferrer" style={{ padding: '4px 10px', background: '#f3f4f6', border: '1px solid #d1d5db', borderRadius: 4, color: '#374151', fontSize: 12, fontWeight: 500, textDecoration: 'none', whiteSpace: 'nowrap' }}>
                    View
                  </a>
                  {!isReadOnly && (
                    <button type="button" onClick={() => handleAttachmentDelete(a.Id)} style={{ padding: '4px 10px', background: '#fef2f2', border: '1px solid #fca5a5', borderRadius: 4, color: '#dc2626', cursor: 'pointer', fontSize: 12, fontWeight: 500 }}>
                      Remove
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    );
  };

  const formatNumber = (val) => {
    const num = parseFloat(val);
    if (isNaN(num) || num === 0) return '';
    // If it has decimals, format with 1 decimal place
    if (num % 1 !== 0) {
      const [whole, dec] = num.toFixed(1).split('.');
      return parseInt(whole).toLocaleString() + '.' + dec;
    }
    return Math.floor(num).toLocaleString();
  };

  // Show raw number (no commas) while field is focused to prevent cursor jumping.
  const displayVal = (key, val) => {
    const v = val !== undefined ? val : form[key];
    if (focusedField === key) {
      const num = parseFloat(v);
      return isNaN(num) || num === 0 ? '' : String(num);
    }
    return formatNumber(v);
  };

  const numFieldProps = (key) => ({
    onFocus: () => setFocusedField(key),
    onBlur: () => setFocusedField(null),
  });

  const handleSubmit = async () => {
    setSubmitting(true);
    setError('');
    try {
      const completedBy = user.firstName
        ? `${user.firstName} ${user.lastName} (${user.email})`
        : form.AuthorizedPersonName || form.EmailAddress || 'Unknown';

      if (isCompleted && canEdit) {
        // Admin editing a completed form
        await axios.put(`/api/epv/${verification.Id}/edit`, {
          data: form,
          editedBy: completedBy,
        });
        setSuccessMsg('Verification updated successfully!');
        setStep(6);
      } else {
        await axios.put(`/api/epv/token/${token}/submit`, {
          data: form,
          completedBy,
        });
        setSuccessMsg('Verification submitted successfully!');
        setStep(6);
      }
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to submit verification.');
    } finally {
      setSubmitting(false);
    }
  };

  const isCompleted = verification?.Status === 'Completed';
  const isInspectorEPV = verification?.EPVType === 'Inspector';
  const isInspectorOwner = isInspectorEPV && user.role === 'Inspector' && verification?.InspectorId === user.id;
  const canEdit = isAdmin || (isInspectorEPV && (user.role === 'Admin' || user.role === 'Super Admin')) || (isInspectorOwner && !isCompleted);
  const isReadOnly = isCompleted && !canEdit;
  const periodLabel = verification
    ? `${MONTH_NAMES[(verification.PeriodMonth || 1) - 1]} ${verification.PeriodYear}`
    : '';

  if (loading) {
    return (
      <div className="epv-container">
        <div className="epv-card">
          <p className="epv-loading">Loading verification form...</p>
        </div>
      </div>
    );
  }

  if (error && !verification) {
    return (
      <div className="epv-container">
        <div className="epv-card">
          <div className="epv-brand">
            <img src="/fsa-logo.png" alt="Food Safety Agency" className="epv-logo" />
            <p>Egg Production Verification System</p>
          </div>
          <p className="epv-error">{error}</p>
          <div style={{ textAlign: 'center', marginTop: 20 }}>
            <Link to="/login" className="epv-link">Go to Login</Link>
          </div>
        </div>
      </div>
    );
  }

  // Already submitted message for non-admin users
  if (isCompleted && !canEdit && !user.role) {
    // Public access (via email link) - show already submitted
    return (
      <div className="epv-container">
        <div className="epv-card">
          <div className="epv-brand">
            <img src="/fsa-logo.png" alt="Food Safety Agency" className="epv-logo" />
            <p>Egg Production Verification System</p>
          </div>
          <div className="epv-success-box">
            <div className="epv-success-icon">&#10003;</div>
            <h2>Already Submitted</h2>
            <p>The Egg Production Verification for <strong>{periodLabel}</strong> has already been submitted.</p>
            <p style={{ color: '#666', fontSize: '14px', marginTop: '12px' }}>If you need to make changes, please log a support ticket.</p>
          </div>
        </div>
      </div>
    );
  }

  // Success state
  if (step === 6) {
    return (
      <div className="epv-container">
        <div className="epv-card">
          <div className="epv-brand">
            <img src="/fsa-logo.png" alt="Food Safety Agency" className="epv-logo" />
            <p>Egg Production Verification System</p>
          </div>
          <div className="epv-success-box">
            <div className="epv-success-icon">&#10003;</div>
            <h2>{isInspectorEPV ? 'Inspection Submitted' : 'Verification Submitted'}</h2>
            <p>The {isInspectorEPV ? 'Inspector Verification' : 'Egg Production Verification'} for <strong>{periodLabel}</strong> has been submitted successfully.</p>
            <div className="epv-summary-box">
              <div className="epv-summary-row"><span>Theoretical Closing Stock:</span><strong>{totals.closingStock.toLocaleString()}</strong></div>
              <div className="epv-summary-row"><span>Actual Closing Stock:</span><strong>{totals.actualClosingStock.toLocaleString()}</strong></div>
              <div className="epv-summary-row"><span>Egg Levy Amount:</span><strong>R {totals.levyAmount.toFixed(2)}</strong></div>
              <div className="epv-summary-row"><span>Pulp Levy Amount:</span><strong>R {totals.pulpLevyAmount.toFixed(2)}</strong></div>
              <div className="epv-summary-row"><span>Powder Egg Levy Amount:</span><strong>R {totals.powderLevyAmount.toFixed(2)}</strong></div>
              <div className="epv-summary-row" style={{ borderTop: '2px solid #065f46', paddingTop: 8, marginTop: 4 }}><span style={{ color: '#065f46', fontWeight: 700 }}>Total Owed:</span><strong style={{ color: '#065f46' }}>R {(totals.levyAmount + totals.pulpLevyAmount + totals.powderLevyAmount).toFixed(2)}</strong></div>
            </div>
          </div>
          <div style={{ textAlign: 'center', marginTop: 20 }}>
            {isLoggedIn ? (
              <button className="epv-back-to-company" onClick={() => navigate(verification?.ClientRecordId ? `/company?companyId=${verification.ClientRecordId}` : '/company')}>
                &larr; Back to Company Overview
              </button>
            ) : (
              <Link to="/login" className="epv-link">Go to Login</Link>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="epv-container">
      <div className="epv-card epv-wide">
        <div className="epv-brand">
          <img src="/fsa-logo.png" alt="Food Safety Agency" className="epv-logo" />
          <p>Egg Production Verification System</p>
        </div>

        {isLoggedIn && (
          <button className="epv-back-to-company" onClick={() => navigate(verification?.ClientRecordId ? `/company?companyId=${verification.ClientRecordId}` : '/company')}>
            &larr; Back to Company Overview
          </button>
        )}

        <div className="epv-period-header">
          <h2>{isInspectorEPV ? 'Inspector Verification' : 'Egg Production Verification'}</h2>
          {isInspectorEPV && <span className="epv-inspector-badge">Inspector EPV</span>}
          <span className="epv-period-badge">{periodLabel}</span>
          {verification?.ReferenceNumber && <span className="epv-ref-badge">{verification.ReferenceNumber}</span>}
          {isCompleted && <span className="epv-completed-badge">Completed</span>}
          {isCompleted && canEdit && <span className="epv-edit-badge">Editing as {user.role}</span>}
        </div>

        {error && <p className="epv-error">{error}</p>}

        {/* Step Indicator */}
        <div className="epv-steps">
          <div className={`epv-step ${step >= 1 ? 'active' : ''} ${step > 1 ? 'done' : ''}`}>
            <span className="epv-step-num">1</span>
            <span className="epv-step-label">Business Details</span>
          </div>
          <div className="epv-step-line" />
          <div className={`epv-step ${step >= 2 ? 'active' : ''} ${step > 2 ? 'done' : ''}`}>
            <span className="epv-step-num">2</span>
            <span className="epv-step-label">Levy (Eggs)</span>
          </div>
          <div className="epv-step-line" />
          <div className={`epv-step ${step >= 3 ? 'active' : ''} ${step > 3 ? 'done' : ''}`}>
            <span className="epv-step-num">3</span>
            <span className="epv-step-label">Levy (Pulp)</span>
          </div>
          <div className="epv-step-line" />
          <div className={`epv-step ${step >= 4 ? 'active' : ''} ${step > 4 ? 'done' : ''}`}>
            <span className="epv-step-num">4</span>
            <span className="epv-step-label">Levy (Powder Eggs)</span>
          </div>
          <div className="epv-step-line" />
          <div className={`epv-step ${step >= 5 ? 'active' : ''}`}>
            <span className="epv-step-num">5</span>
            <span className="epv-step-label">Review & Submit</span>
          </div>
        </div>

        {/* STEP 1: Business Details */}
        {step === 1 && (
          <div className="epv-step-content">
            <h3>Business & Contact Details</h3>
            <p className="epv-step-desc">Please verify and complete the following information. Fields marked with <span className="epv-required-star">*</span> are compulsory.</p>
            <div className="epv-form-grid">
              <div className={`epv-field ${validationErrors.BusinessName ? 'epv-field-error' : ''}`}>
                <label>Facility Name <span className="epv-required-star">*</span></label>
                <input type="text" value={form.BusinessName} onChange={(e) => handleChange('BusinessName', e.target.value)} disabled={isReadOnly} />
                {validationErrors.BusinessName && <span className="epv-error-msg">{validationErrors.BusinessName}</span>}
              </div>
              <div className={`epv-field ${validationErrors.FacilityType ? 'epv-field-error' : ''}`}>
                <label>Facility Type <span className="epv-required-star">*</span></label>
                <div className="epv-facility-type-options">
                  {['Producer', 'Re-Packer', 'Breaking Plant'].map(type => (
                    <label key={type} className="epv-checkbox-label">
                      <input
                        type="checkbox"
                        checked={form.FacilityType === type}
                        onChange={() => handleChange('FacilityType', form.FacilityType === type ? '' : type)}
                        disabled={isReadOnly}
                      />
                      {type}
                    </label>
                  ))}
                </div>
                {validationErrors.FacilityType && <span className="epv-error-msg">{validationErrors.FacilityType}</span>}
              </div>
              <div className={`epv-field ${validationErrors.FacilityProvince ? 'epv-field-error' : ''}`}>
                <label>Facility Province <span className="epv-required-star">*</span></label>
                <select value={form.FacilityProvince} onChange={(e) => handleChange('FacilityProvince', e.target.value)} disabled={isReadOnly} className="epv-select">
                  <option value="">— Select —</option>
                  <option value="Eastern Cape">Eastern Cape</option>
                  <option value="Free State">Free State</option>
                  <option value="Gauteng">Gauteng</option>
                  <option value="KwaZulu-Natal">KwaZulu-Natal</option>
                  <option value="Limpopo">Limpopo</option>
                  <option value="Mpumalanga">Mpumalanga</option>
                  <option value="North West">North West</option>
                  <option value="Northern Cape">Northern Cape</option>
                  <option value="Western Cape">Western Cape</option>
                </select>
                {validationErrors.FacilityProvince && <span className="epv-error-msg">{validationErrors.FacilityProvince}</span>}
              </div>
              <div className="epv-field epv-full">
                <label>Trading Name</label>
                <input type="text" value={form.TradingName} onChange={(e) => handleChange('TradingName', e.target.value)} disabled={isReadOnly} />
              </div>
              <div className="epv-field epv-full">
                <label>Physical Address</label>
                <input type="text" value={form.PhysicalAddress} onChange={(e) => handleChange('PhysicalAddress', e.target.value)} disabled={isReadOnly} />
              </div>
              <div className={`epv-field epv-full ${validationErrors.AuthorizedPersonName ? 'epv-field-error' : ''}`}>
                <label>Name of Owner, Manager or Authorized Person <span className="epv-required-star">*</span></label>
                <input type="text" value={form.AuthorizedPersonName} onChange={(e) => handleChange('AuthorizedPersonName', e.target.value)} disabled={isReadOnly} />
                {validationErrors.AuthorizedPersonName && <span className="epv-error-msg">{validationErrors.AuthorizedPersonName}</span>}
              </div>
              <div className="epv-field">
                <label>Position in the Company</label>
                <input type="text" value={form.PositionInCompany} onChange={(e) => handleChange('PositionInCompany', e.target.value)} disabled={isReadOnly} />
              </div>
              <div className="epv-field">
                <label>Telephone Number</label>
                <input type="tel" value={form.TelephoneNumber} onChange={(e) => handleChange('TelephoneNumber', e.target.value)} disabled={isReadOnly} />
              </div>
              <div className="epv-field">
                <label>Cell Phone Number</label>
                <input type="tel" value={form.CellPhoneNumber} onChange={(e) => handleChange('CellPhoneNumber', e.target.value)} disabled={isReadOnly} />
              </div>
              <div className={`epv-field ${validationErrors.EmailAddress ? 'epv-field-error' : ''}`}>
                <label>Email Address <span className="epv-required-star">*</span></label>
                <input type="email" value={form.EmailAddress} onChange={(e) => handleChange('EmailAddress', e.target.value)} disabled={isReadOnly} />
                {validationErrors.EmailAddress && <span className="epv-error-msg">{validationErrors.EmailAddress}</span>}
              </div>
            </div>
            <div className="epv-nav">
              <div />
              <button className="epv-next-btn" onClick={goToStep2}>Next: Egg Calculation &rarr;</button>
            </div>
          </div>
        )}

        {/* STEP 2: Egg Calculation */}
        {step === 2 && (
          <div className="epv-step-content">
            <h3>Calculation of Statutory Levy (Eggs)</h3>
            <p className="epv-step-desc" style={{ color: '#dc2626', fontWeight: 600 }}>All values are in <strong>dozens</strong>.</p>

            {/* Section A: Opening Stock */}
            <div className="epv-calc-section">
              <h4>A. Opening Stock</h4>
              <div className="epv-calc-rows">
                <div className="epv-calc-row">
                  <label>Opening Stock (previous month closing):</label>
                  <input type="text" value={displayVal('OpeningStock')} onChange={(e) => handleNumberChange('OpeningStock', e.target.value)} {...numFieldProps('OpeningStock')} disabled={isReadOnly} placeholder="0" />
                </div>
                <div className="epv-calc-row">
                  <label>Eggs Produced during the Month:</label>
                  <input type="text" value={displayVal('EggsProducedDuringMonth')} onChange={(e) => handleNumberChange('EggsProducedDuringMonth', e.target.value)} {...numFieldProps('EggsProducedDuringMonth')} disabled={isReadOnly} placeholder="0" />
                </div>
                <div className="epv-calc-row epv-total-row">
                  <label>Total A:</label>
                  <span className="epv-calc-total">{totals.totalA.toLocaleString()}</span>
                </div>
              </div>
            </div>

            {/* Section B: Purchases */}
            <div className="epv-calc-section">
              <h4>B. Purchases</h4>
              <div className="epv-calc-rows">
                <div className="epv-calc-row">
                  <label>+ Graded Eggs Purchased:</label>
                  <input type="text" value={displayVal('GradedEggsPurchased')} onChange={(e) => handleNumberChange('GradedEggsPurchased', e.target.value)} {...numFieldProps('GradedEggsPurchased')} disabled={isReadOnly} placeholder="0" />
                </div>
                <div className="epv-calc-row">
                  <label>+ Ungraded Eggs Purchased:</label>
                  <input type="text" value={displayVal('UngradedEggsPurchased')} onChange={(e) => handleNumberChange('UngradedEggsPurchased', e.target.value)} {...numFieldProps('UngradedEggsPurchased')} disabled={isReadOnly} placeholder="0" />
                </div>
                <div className="epv-calc-row epv-total-row">
                  <label>Total B (Purchases):</label>
                  <span className="epv-calc-total">{totals.totalB.toLocaleString()}</span>
                </div>
                {((parseFloat(form.GradedEggsPurchased) || 0) + (parseFloat(form.UngradedEggsPurchased) || 0)) > 0 &&
                  renderPurchaseEvidence('EggPurchase', 'EggPurchaseComment', 'Egg Purchases')}
              </div>
            </div>

            {/* Section C: Deductions */}
            <div className="epv-calc-section epv-deduction-section">
              <h4>C. Deductions</h4>
              <div className="epv-calc-rows">
                <div className="epv-calc-row epv-deduction-row">
                  <label>- Market Returns:</label>
                  <input type="text" value={displayVal('MarketReturns')} onChange={(e) => handleNumberChange('MarketReturns', e.target.value)} {...numFieldProps('MarketReturns')} disabled={isReadOnly} placeholder="0" />
                </div>
                <div className="epv-calc-row epv-deduction-row">
                  <label>- Machine Loss:</label>
                  <input type="text" value={displayVal('MachineLoss')} onChange={(e) => handleNumberChange('MachineLoss', e.target.value)} {...numFieldProps('MachineLoss')} disabled={isReadOnly} placeholder="0" />
                </div>
                <div className="epv-calc-row epv-deduction-row">
                  <label>- Sent to Powder Eggs:</label>
                  <input type="text" value={displayVal('SentToPulp')} onChange={(e) => handleNumberChange('SentToPulp', e.target.value)} {...numFieldProps('SentToPulp')} disabled={isReadOnly} placeholder="0" />
                </div>
                <div className="epv-calc-row epv-deduction-row">
                  <label>- Destroyed (other e.g., full bloods):</label>
                  <input type="text" value={displayVal('Destroyed')} onChange={(e) => handleNumberChange('Destroyed', e.target.value)} {...numFieldProps('Destroyed')} disabled={isReadOnly} placeholder="0" />
                </div>
                <div className="epv-calc-row epv-deduction-row">
                  <label>- Eggs Exported:</label>
                  <input type="text" value={displayVal('Exported')} onChange={(e) => handleNumberChange('Exported', e.target.value)} {...numFieldProps('Exported')} disabled={isReadOnly} placeholder="0" />
                </div>
                <div className="epv-calc-row epv-total-row epv-deduction-total">
                  <label>Total C (Deductions):</label>
                  <span className="epv-calc-total">- {totals.totalC.toLocaleString()}</span>
                </div>
              </div>
            </div>

            {/* Section D: Sales */}
            <div className="epv-calc-section epv-deduction-section">
              <h4>D. Sales</h4>
              <div className="epv-calc-rows">
                <div className="epv-calc-row epv-deduction-row">
                  <label>- Sold to Trade:</label>
                  <input type="text" value={displayVal('SoldToTrade')} onChange={(e) => handleNumberChange('SoldToTrade', e.target.value)} {...numFieldProps('SoldToTrade')} disabled={isReadOnly} placeholder="0" />
                </div>
                <div className="epv-calc-row epv-deduction-row">
                  <label>- Sold to Staff or Own Use:</label>
                  <input type="text" value={displayVal('SoldToStaff')} onChange={(e) => handleNumberChange('SoldToStaff', e.target.value)} {...numFieldProps('SoldToStaff')} disabled={isReadOnly} placeholder="0" />
                </div>
                <div className="epv-calc-row epv-deduction-row">
                  <label>- Sold through Farm Stall (Informal Market):</label>
                  <input type="text" value={displayVal('SoldThroughFarmStall')} onChange={(e) => handleNumberChange('SoldThroughFarmStall', e.target.value)} {...numFieldProps('SoldThroughFarmStall')} disabled={isReadOnly} placeholder="0" />
                </div>
                <div className="epv-calc-row epv-total-row epv-deduction-total">
                  <label>Total D (Sales):</label>
                  <span className="epv-calc-total">- {totals.totalD.toLocaleString()}</span>
                </div>
                <div className="epv-calc-row epv-levy-row">
                  <label>Egg Levy Amount (D &times; R{LEVY_RATE}):</label>
                  <span className="epv-levy-amount">R {totals.levyAmount.toFixed(2)}</span>
                </div>
              </div>
            </div>

            {/* Section E: Transfers */}
            <div className="epv-calc-section">
              <h4>E. Transfers</h4>
              <div className="epv-calc-rows">
                <div className="epv-calc-row epv-deduction-row">
                  <label>- Transferred or Sold to Other Producers:</label>
                  <input type="text" value={displayVal('TransferredToOtherProducers')} onChange={(e) => handleNumberChange('TransferredToOtherProducers', e.target.value)} {...numFieldProps('TransferredToOtherProducers')} disabled={isReadOnly} placeholder="0" />
                </div>
                <div className="epv-calc-row epv-addition-row">
                  <label>+ Transferred or Purchased from Other Producers:</label>
                  <input type="text" value={displayVal('TransferredOrPurchasedFromProducers')} onChange={(e) => handleNumberChange('TransferredOrPurchasedFromProducers', e.target.value)} {...numFieldProps('TransferredOrPurchasedFromProducers')} disabled={isReadOnly} placeholder="0" />
                </div>
                <div className={`epv-calc-row epv-total-row ${totals.totalE > 0 ? 'epv-deduction-total' : totals.totalE < 0 ? 'epv-addition-total' : ''}`}>
                  <label>Total E (Transfers):</label>
                  <span className="epv-calc-total" style={totals.totalE < 0 ? { color: '#059669' } : totals.totalE > 0 ? { color: '#dc2626' } : {}}>{totals.totalE < 0 ? '+ ' : totals.totalE > 0 ? '- ' : ''}{Math.abs(totals.totalE).toLocaleString()}</span>
                </div>
                {renderPurchaseEvidence('TransferPurchase', 'TransferPurchaseComment', 'Transfers to Other Producers')}
              </div>
            </div>

            {/* Closing Stock & Actuals */}
            <div className="epv-calc-section epv-closing-section">
              <h4>Closing Stock</h4>
              <div className="epv-calc-rows">
                <div className="epv-calc-row epv-closing-row">
                  <label>Closing Stock — Graded &amp; Ungraded (Theoretical: A + B - C - D - E):</label>
                  <span className={`epv-closing-stock ${totals.closingStock < 0 ? 'negative' : ''}`}>
                    {totals.closingStock.toLocaleString()}
                  </span>
                </div>
                <div className="epv-calc-row">
                  <label>Actual Closing Stock (provided by producer):</label>
                  <input type="text" value={displayVal('ActualClosingStock')} onChange={(e) => handleNumberChange('ActualClosingStock', e.target.value)} {...numFieldProps('ActualClosingStock')} disabled={isReadOnly} placeholder="0" />
                </div>
                <div className={`epv-calc-row epv-lossgain-row ${totals.lossGain < 0 ? 'loss' : totals.lossGain > 0 ? 'gain' : ''}`}>
                  <label>(Loss) / Gain:</label>
                  <span className="epv-lossgain-value">
                    {totals.lossGain < 0 ? `(${Math.abs(totals.lossGain).toLocaleString()})` : totals.lossGain.toLocaleString()}
                  </span>
                </div>
              </div>
            </div>

            {/* Variance Explanation - shows when actual != theoretical */}
            {totals.lossGain !== 0 && (
              <div className="epv-calc-section epv-variance-section">
                <h4>Variance Explanation</h4>
                <p className="epv-variance-desc">
                  There is a {totals.lossGain < 0 ? 'loss' : 'gain'} of <strong>{Math.abs(totals.lossGain).toLocaleString()}</strong> dozen(s) between the theoretical closing stock and the actual closing stock. Please provide a reason for this variance.
                </p>
                <div className="epv-variance-field">
                  <label>Reason for Variance <span className="epv-required-star">*</span></label>
                  <textarea
                    value={form.VarianceReason}
                    onChange={(e) => handleChange('VarianceReason', e.target.value)}
                    disabled={isReadOnly}
                    placeholder="Please explain the reason for the difference between theoretical and actual closing stock..."
                    rows={4}
                    className="epv-variance-textarea"
                  />
                </div>
              </div>
            )}

            <div className="epv-nav">
              <button className="epv-back-btn" onClick={() => setStep(1)}>&larr; Back</button>
              <button className="epv-next-btn" onClick={() => {
                if (totals.lossGain !== 0 && !form.VarianceReason.trim()) {
                  setError('Please provide a reason for the variance between theoretical and actual closing stock.');
                  return;
                }
                setError('');
                setStep(3);
              }}>Next: Levy (Pulp) &rarr;</button>
            </div>
          </div>
        )}

        {/* STEP 3: Pulp Calculation */}
        {step === 3 && (
          <div className="epv-step-content">
            <h3>Calculation of Statutory Levy (Pulp)</h3>
            <p className="epv-step-desc">All values in Kilograms. Dozens are automatically calculated at 7 dozens per kilogram of pulp.</p>

            {/* Stock In */}
            <div className="epv-calc-section">
              <div className="epv-pulp-header">
                <span></span>
                <span className="epv-pulp-col-label">Kilograms</span>
                <span className="epv-pulp-col-label">Dozens</span>
              </div>
              <div className="epv-calc-rows">
                <div className="epv-calc-row epv-pulp-row">
                  <label>A. Opening Stock (Pulp brought forward):</label>
                  <input type="text" value={displayVal('PulpOpeningStock')} onChange={(e) => handleNumberChange('PulpOpeningStock', e.target.value)} {...numFieldProps('PulpOpeningStock')} disabled={isReadOnly} placeholder="0" />
                  <input type="text" value={displayVal('pulpADoz', pulpDozens.PulpOpeningStock)} onChange={(e) => handlePulpDozensChange('PulpOpeningStock', e.target.value)} {...numFieldProps('pulpADoz')} disabled={isReadOnly} placeholder="0" className="epv-pulp-dozens-input" />
                </div>
                <div className="epv-calc-row epv-pulp-row">
                  <label>B. Pulp Purchased from Others:</label>
                  <input type="text" value={displayVal('PulpPurchased')} onChange={(e) => handleNumberChange('PulpPurchased', e.target.value)} {...numFieldProps('PulpPurchased')} disabled={isReadOnly} placeholder="0" />
                  <input type="text" value={displayVal('pulpBDoz', pulpDozens.PulpPurchased)} onChange={(e) => handlePulpDozensChange('PulpPurchased', e.target.value)} {...numFieldProps('pulpBDoz')} disabled={isReadOnly} placeholder="0" className="epv-pulp-dozens-input" />
                </div>
                <div className="epv-calc-row epv-pulp-row">
                  <label>C. Eggs Converted to Pulp:</label>
                  <input type="text" value={displayVal('PulpConverted')} onChange={(e) => handleNumberChange('PulpConverted', e.target.value)} {...numFieldProps('PulpConverted')} disabled={isReadOnly} placeholder="0" />
                  <input type="text" value={displayVal('pulpCDoz', pulpDozens.PulpConverted)} onChange={(e) => handlePulpDozensChange('PulpConverted', e.target.value)} {...numFieldProps('pulpCDoz')} disabled={isReadOnly} placeholder="0" className="epv-pulp-dozens-input" />
                </div>
                <div className="epv-calc-row epv-total-row epv-pulp-row">
                  <label>= Stock on Hand (A + B + C):</label>
                  <span className="epv-calc-total">{totals.pulpStockOnHand.toLocaleString()}</span>
                  <span className="epv-calc-total">{totals.pulpStockOnHandDozens.toLocaleString()}</span>
                </div>
                {(parseInt(form.PulpPurchased) || 0) > 0 &&
                  renderPurchaseEvidence('PulpPurchase', 'PulpPurchaseComment', 'Pulp Purchased from Others')}
              </div>
            </div>

            {/* Sales & Deductions */}
            <div className="epv-calc-section">
              <h4>Sales &amp; Deductions</h4>
              <div className="epv-pulp-header">
                <span></span>
                <span className="epv-pulp-col-label">Kilograms</span>
                <span className="epv-pulp-col-label">Dozens</span>
              </div>
              <div className="epv-calc-rows">
                <div className="epv-calc-row epv-pulp-row epv-deduction-row">
                  <label>- Sales to Trade:</label>
                  <input type="text" value={displayVal('PulpSoldToTrade')} onChange={(e) => handleNumberChange('PulpSoldToTrade', e.target.value)} {...numFieldProps('PulpSoldToTrade')} disabled={isReadOnly} placeholder="0" />
                  <input type="text" value={displayVal('pulpSTDoz', pulpDozens.PulpSoldToTrade)} onChange={(e) => handlePulpDozensChange('PulpSoldToTrade', e.target.value)} {...numFieldProps('pulpSTDoz')} disabled={isReadOnly} placeholder="0" className="epv-pulp-dozens-input" />
                </div>
                <div className="epv-calc-row epv-levy-row">
                  <label>Pulp Levy (Dozens &times; R{LEVY_RATE}):</label>
                  <span className="epv-levy-amount" style={{ gridColumn: 'span 2', textAlign: 'right' }}>R {totals.pulpLevyAmount.toFixed(2)}</span>
                </div>
                <div className="epv-calc-row epv-pulp-row epv-deduction-row">
                  <label>- Sold to Other Producers:</label>
                  <input type="text" value={displayVal('PulpSoldToProducers')} onChange={(e) => handleNumberChange('PulpSoldToProducers', e.target.value)} {...numFieldProps('PulpSoldToProducers')} disabled={isReadOnly} placeholder="0" />
                  <input type="text" value={displayVal('pulpSPDoz', pulpDozens.PulpSoldToProducers)} onChange={(e) => handlePulpDozensChange('PulpSoldToProducers', e.target.value)} {...numFieldProps('pulpSPDoz')} disabled={isReadOnly} placeholder="0" className="epv-pulp-dozens-input" />
                </div>
                <div className="epv-calc-row epv-pulp-row epv-deduction-row">
                  <label>- Conversion Loss:</label>
                  <input type="text" value={displayVal('PulpConversionLoss')} onChange={(e) => handleNumberChange('PulpConversionLoss', e.target.value)} {...numFieldProps('PulpConversionLoss')} disabled={isReadOnly} placeholder="0" />
                  <input type="text" value={displayVal('pulpCLDoz', pulpDozens.PulpConversionLoss)} onChange={(e) => handlePulpDozensChange('PulpConversionLoss', e.target.value)} {...numFieldProps('pulpCLDoz')} disabled={isReadOnly} placeholder="0" className="epv-pulp-dozens-input" />
                </div>
              </div>
            </div>

            {/* Closing Stock */}
            <div className="epv-calc-section epv-closing-section">
              <div className="epv-pulp-header">
                <span></span>
                <span className="epv-pulp-col-label">Kilograms</span>
                <span className="epv-pulp-col-label">Dozens</span>
              </div>
              <div className="epv-calc-rows">
                <div className="epv-calc-row epv-total-row epv-pulp-row">
                  <label>= Closing Stock Carried Forward:</label>
                  <span className={`epv-calc-total ${totals.pulpClosingStock < 0 ? 'negative' : ''}`}>{totals.pulpClosingStock.toLocaleString()}</span>
                  <span className={`epv-calc-total ${totals.pulpClosingStockDozens < 0 ? 'negative' : ''}`}>{totals.pulpClosingStockDozens.toLocaleString()}</span>
                </div>
              </div>
            </div>

            <div className="epv-nav">
              <button className="epv-back-btn" onClick={() => setStep(2)}>&larr; Back</button>
              <button className="epv-next-btn" onClick={() => setStep(4)}>Next: Levy (Powder Eggs) &rarr;</button>
            </div>
          </div>
        )}

        {/* STEP 4: Powder Egg Calculation */}
        {step === 4 && (
          <div className="epv-step-content">
            <h3>Calculation of Statutory Levy (Powder Eggs)</h3>
            <p className="epv-step-desc">All values in Kilograms. Dozens are automatically calculated at 7 dozens per kilogram of powder eggs.</p>

            {/* Stock In */}
            <div className="epv-calc-section">
              <div className="epv-pulp-header epv-pulp-header-eggs">
                <span></span>
                <span className="epv-pulp-col-label">Eggs</span>
                <span className="epv-pulp-col-label">Kilograms</span>
                <span className="epv-pulp-col-label">Dozens</span>
              </div>
              <div className="epv-calc-rows">
                <div className="epv-calc-row epv-pulp-row epv-pulp-row-eggs">
                  <label>A. Opening Stock (Powder Eggs brought forward):</label>
                  <input type="text" value={displayVal('powderAEggs', powderEggs.PowderOpeningStock)} onChange={(e) => handlePowderEggsChange('PowderOpeningStock', e.target.value)} {...numFieldProps('powderAEggs')} disabled={isReadOnly} placeholder="0" className="epv-pulp-eggs-input" />
                  <input type="text" value={displayVal('PowderOpeningStock')} onChange={(e) => handleNumberChange('PowderOpeningStock', e.target.value)} {...numFieldProps('PowderOpeningStock')} disabled={isReadOnly} placeholder="0" />
                  <input type="text" value={displayVal('powderADoz', powderDozens.PowderOpeningStock)} onChange={(e) => handlePowderDozensChange('PowderOpeningStock', e.target.value)} {...numFieldProps('powderADoz')} disabled={isReadOnly} placeholder="0" className="epv-pulp-dozens-input" />
                </div>
                <div className="epv-calc-row epv-pulp-row epv-pulp-row-eggs">
                  <label>B. Powder Eggs Purchased from Others:</label>
                  <input type="text" value={displayVal('powderBEggs', powderEggs.PowderPurchased)} onChange={(e) => handlePowderEggsChange('PowderPurchased', e.target.value)} {...numFieldProps('powderBEggs')} disabled={isReadOnly} placeholder="0" className="epv-pulp-eggs-input" />
                  <input type="text" value={displayVal('PowderPurchased')} onChange={(e) => handleNumberChange('PowderPurchased', e.target.value)} {...numFieldProps('PowderPurchased')} disabled={isReadOnly} placeholder="0" />
                  <input type="text" value={displayVal('powderBDoz', powderDozens.PowderPurchased)} onChange={(e) => handlePowderDozensChange('PowderPurchased', e.target.value)} {...numFieldProps('powderBDoz')} disabled={isReadOnly} placeholder="0" className="epv-pulp-dozens-input" />
                </div>
                <div className="epv-calc-row epv-pulp-row epv-pulp-row-eggs">
                  <label>C. Eggs Converted to Powder Eggs:</label>
                  <span></span>
                  <input type="text" value={displayVal('PowderConverted')} onChange={(e) => handleNumberChange('PowderConverted', e.target.value)} {...numFieldProps('PowderConverted')} disabled={isReadOnly} placeholder="0" />
                  <input type="text" value={displayVal('powderCDoz', powderDozens.PowderConverted)} onChange={(e) => handlePowderDozensChange('PowderConverted', e.target.value)} {...numFieldProps('powderCDoz')} disabled={isReadOnly} placeholder="0" className="epv-pulp-dozens-input" />
                </div>
                <div className="epv-calc-row epv-total-row epv-pulp-row epv-pulp-row-eggs">
                  <label>= Stock on Hand (A + B + C):</label>
                  <span></span>
                  <span className="epv-calc-total">{totals.powderStockOnHand.toLocaleString()}</span>
                  <span className="epv-calc-total">{totals.powderStockOnHandDozens.toLocaleString()}</span>
                </div>
                {(parseInt(form.PowderPurchased) || 0) > 0 &&
                  renderPurchaseEvidence('PowderPurchase', 'PowderPurchaseComment', 'Powder Eggs Purchased from Others')}
              </div>
            </div>

            {/* Sales & Deductions */}
            <div className="epv-calc-section">
              <h4>Sales &amp; Deductions</h4>
              <div className="epv-pulp-header">
                <span></span>
                <span className="epv-pulp-col-label">Kilograms</span>
                <span className="epv-pulp-col-label">Dozens</span>
              </div>
              <div className="epv-calc-rows">
                <div className="epv-calc-row epv-pulp-row epv-deduction-row">
                  <label>- Sales to Trade:</label>
                  <input type="text" value={displayVal('PowderSoldToTrade')} onChange={(e) => handleNumberChange('PowderSoldToTrade', e.target.value)} {...numFieldProps('PowderSoldToTrade')} disabled={isReadOnly} placeholder="0" />
                  <input type="text" value={displayVal('powderSTDoz', powderDozens.PowderSoldToTrade)} onChange={(e) => handlePowderDozensChange('PowderSoldToTrade', e.target.value)} {...numFieldProps('powderSTDoz')} disabled={isReadOnly} placeholder="0" className="epv-pulp-dozens-input" />
                </div>
                <div className="epv-calc-row epv-levy-row">
                  <label>Powder Egg Levy (Kg &times; R{LEVY_RATE}):</label>
                  <span className="epv-levy-amount" style={{ gridColumn: 'span 2', textAlign: 'right' }}>R {totals.powderLevyAmount.toFixed(2)}</span>
                </div>
                <div className="epv-calc-row epv-pulp-row epv-deduction-row">
                  <label>- Sold to Other Producers:</label>
                  <input type="text" value={displayVal('PowderSoldToProducers')} onChange={(e) => handleNumberChange('PowderSoldToProducers', e.target.value)} {...numFieldProps('PowderSoldToProducers')} disabled={isReadOnly} placeholder="0" />
                  <input type="text" value={displayVal('powderSPDoz', powderDozens.PowderSoldToProducers)} onChange={(e) => handlePowderDozensChange('PowderSoldToProducers', e.target.value)} {...numFieldProps('powderSPDoz')} disabled={isReadOnly} placeholder="0" className="epv-pulp-dozens-input" />
                </div>
                <div className="epv-calc-row epv-pulp-row epv-deduction-row">
                  <label>- Conversion Loss:</label>
                  <input type="text" value={displayVal('PowderConversionLoss')} onChange={(e) => handleNumberChange('PowderConversionLoss', e.target.value)} {...numFieldProps('PowderConversionLoss')} disabled={isReadOnly} placeholder="0" />
                  <input type="text" value={displayVal('powderCLDoz', powderDozens.PowderConversionLoss)} onChange={(e) => handlePowderDozensChange('PowderConversionLoss', e.target.value)} {...numFieldProps('powderCLDoz')} disabled={isReadOnly} placeholder="0" className="epv-pulp-dozens-input" />
                </div>
              </div>
            </div>

            {/* Closing Stock */}
            <div className="epv-calc-section epv-closing-section">
              <div className="epv-pulp-header">
                <span></span>
                <span className="epv-pulp-col-label">Kilograms</span>
                <span className="epv-pulp-col-label">Dozens</span>
              </div>
              <div className="epv-calc-rows">
                <div className="epv-calc-row epv-total-row epv-pulp-row">
                  <label>= Closing Stock Carried Forward:</label>
                  <span className={`epv-calc-total ${totals.powderClosingStock < 0 ? 'negative' : ''}`}>{totals.powderClosingStock.toLocaleString()}</span>
                  <span className={`epv-calc-total ${totals.powderClosingStockDozens < 0 ? 'negative' : ''}`}>{totals.powderClosingStockDozens.toLocaleString()}</span>
                </div>
              </div>
            </div>

            <div className="epv-nav">
              <button className="epv-back-btn" onClick={() => setStep(3)}>&larr; Back</button>
              <button className="epv-next-btn" onClick={() => setStep(5)}>Next: Review &rarr;</button>
            </div>
          </div>
        )}

        {/* STEP 5: Review & Submit */}
        {step === 5 && (
          <div className="epv-step-content">
            <h3>Review & Submit</h3>
            <p className="epv-step-desc">Please review all information before submitting.</p>

            <div className="epv-review-section">
              <h4>Business Details</h4>
              <div className="epv-review-grid">
                <div><span>Facility Name:</span> <strong>{form.BusinessName}</strong></div>
                <div><span>Facility Type:</span> <strong>{form.FacilityType}</strong></div>
                <div><span>Facility Province:</span> <strong>{form.FacilityProvince}</strong></div>
                <div><span>Trading Name:</span> <strong>{form.TradingName}</strong></div>
                <div className="epv-review-full"><span>Physical Address:</span> <strong>{form.PhysicalAddress}</strong></div>
                <div><span>Authorized Person:</span> <strong>{form.AuthorizedPersonName}</strong></div>
                <div><span>Position:</span> <strong>{form.PositionInCompany}</strong></div>
                <div><span>Telephone:</span> <strong>{form.TelephoneNumber}</strong></div>
                <div><span>Cell Phone:</span> <strong>{form.CellPhoneNumber}</strong></div>
                <div><span>Email:</span> <strong>{form.EmailAddress}</strong></div>
              </div>
            </div>

            <div className="epv-review-section">
              <h4>Egg Production Calculation</h4>
              <table className="epv-review-table">
                <tbody>
                  <tr className="epv-review-section-header"><td colSpan="2">A. Opening Stock</td></tr>
                  <tr><td>Opening Stock (previous month closing)</td><td className="epv-num">{(parseFloat(form.OpeningStock) || 0).toLocaleString()}</td></tr>
                  <tr><td>Eggs Produced during the Month</td><td className="epv-num">{(parseFloat(form.EggsProducedDuringMonth) || 0).toLocaleString()}</td></tr>
                  <tr className="epv-review-total"><td>Total A</td><td className="epv-num">{totals.totalA.toLocaleString()}</td></tr>

                  <tr className="epv-review-section-header"><td colSpan="2">B. Purchases</td></tr>
                  <tr><td>+ Graded Eggs Purchased</td><td className="epv-num">{(parseFloat(form.GradedEggsPurchased) || 0).toLocaleString()}</td></tr>
                  <tr><td>+ Ungraded Eggs Purchased</td><td className="epv-num">{(parseFloat(form.UngradedEggsPurchased) || 0).toLocaleString()}</td></tr>
                  <tr className="epv-review-total"><td>Total B (Purchases)</td><td className="epv-num">{totals.totalB.toLocaleString()}</td></tr>
                  {(form.EggPurchaseComment || attachments.some(a => a.Category === 'EggPurchase')) && (
                    <tr><td colSpan="2" style={{ background: '#fafafa', padding: 8 }}>
                      {form.EggPurchaseComment && (
                        <div style={{ marginBottom: 6 }}><strong>Source &amp; Supplier:</strong> {form.EggPurchaseComment}</div>
                      )}
                      {attachments.filter(a => a.Category === 'EggPurchase').map(a => (
                        <div key={a.Id} style={{ fontSize: 13 }}>
                          <a href={`/api/epv/attachment/${a.Id}`} target="_blank" rel="noopener noreferrer">{a.OriginalName}</a>
                          <span style={{ color: '#888', marginLeft: 6 }}>({formatBytes(a.FileSize)})</span>
                        </div>
                      ))}
                    </td></tr>
                  )}

                  <tr className="epv-review-section-header"><td colSpan="2">C. Deductions</td></tr>
                  <tr><td>- Market Returns</td><td className="epv-num">{(parseFloat(form.MarketReturns) || 0).toLocaleString()}</td></tr>
                  <tr><td>- Machine Loss</td><td className="epv-num">{(parseFloat(form.MachineLoss) || 0).toLocaleString()}</td></tr>
                  <tr><td>- Sent to Powder Eggs</td><td className="epv-num">{(parseFloat(form.SentToPulp) || 0).toLocaleString()}</td></tr>
                  <tr><td>- Destroyed</td><td className="epv-num">{(parseFloat(form.Destroyed) || 0).toLocaleString()}</td></tr>
                  <tr><td>- Eggs Exported</td><td className="epv-num">{(parseFloat(form.Exported) || 0).toLocaleString()}</td></tr>
                  <tr className="epv-review-total"><td>Total C (Deductions)</td><td className="epv-num">{totals.totalC.toLocaleString()}</td></tr>

                  <tr className="epv-review-section-header"><td colSpan="2">D. Sales</td></tr>
                  <tr><td>Sold to Trade</td><td className="epv-num">{(parseFloat(form.SoldToTrade) || 0).toLocaleString()}</td></tr>
                  <tr><td>Sold to Staff / Own Use</td><td className="epv-num">{(parseFloat(form.SoldToStaff) || 0).toLocaleString()}</td></tr>
                  <tr><td>Sold through Farm Stall (Informal Market)</td><td className="epv-num">{(parseFloat(form.SoldThroughFarmStall) || 0).toLocaleString()}</td></tr>
                  <tr className="epv-review-total"><td>Total D (Sales)</td><td className="epv-num">{totals.totalD.toLocaleString()}</td></tr>
                  <tr className="epv-review-levy"><td>Egg Levy Amount (D &times; R{LEVY_RATE})</td><td className="epv-num">R {totals.levyAmount.toFixed(2)}</td></tr>

                  <tr className="epv-review-section-header"><td colSpan="2">E. Transfers</td></tr>
                  <tr><td>- Transferred or Sold to Other Producers</td><td className="epv-num">{(parseFloat(form.TransferredToOtherProducers) || 0).toLocaleString()}</td></tr>
                  <tr><td>+ Transferred or Purchased from Other Producers</td><td className="epv-num">{(parseFloat(form.TransferredOrPurchasedFromProducers) || 0).toLocaleString()}</td></tr>
                  <tr className="epv-review-total"><td>Total E (Transfers)</td><td className="epv-num">{totals.totalE < 0 ? `+ ${Math.abs(totals.totalE).toLocaleString()}` : totals.totalE.toLocaleString()}</td></tr>
                  {(form.TransferPurchaseComment || attachments.some(a => a.Category === 'TransferPurchase')) && (
                    <tr><td colSpan="2" style={{ background: '#fafafa', padding: 8 }}>
                      {form.TransferPurchaseComment && (
                        <div style={{ marginBottom: 6 }}><strong>Transfer Details:</strong> {form.TransferPurchaseComment}</div>
                      )}
                      {attachments.filter(a => a.Category === 'TransferPurchase').map(a => (
                        <div key={a.Id} style={{ fontSize: 13 }}>
                          <a href={`/api/epv/attachment/${a.Id}`} target="_blank" rel="noopener noreferrer">{a.OriginalName}</a>
                          <span style={{ color: '#888', marginLeft: 6 }}>({formatBytes(a.FileSize)})</span>
                        </div>
                      ))}
                    </td></tr>
                  )}

                  <tr className="epv-review-section-header"><td colSpan="2">Closing Stock</td></tr>
                  <tr className="epv-review-closing"><td>Closing Stock — Theoretical (A + B - C - D - E)</td><td className="epv-num">{totals.closingStock.toLocaleString()}</td></tr>
                  <tr><td>Actual Closing Stock (provided by producer)</td><td className="epv-num">{totals.actualClosingStock.toLocaleString()}</td></tr>
                  <tr className={`epv-review-lossgain ${totals.lossGain < 0 ? 'loss' : totals.lossGain > 0 ? 'gain' : ''}`}>
                    <td>(Loss) / Gain</td>
                    <td className="epv-num">{totals.lossGain < 0 ? `(${Math.abs(totals.lossGain).toLocaleString()})` : totals.lossGain.toLocaleString()}</td>
                  </tr>
                  {totals.lossGain !== 0 && form.VarianceReason && (
                    <tr className="epv-review-variance">
                      <td colSpan="2">
                        <strong>Variance Reason:</strong> {form.VarianceReason}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            <div className="epv-review-section">
              <h4>Calculation of Statutory Levy (Pulp)</h4>
              <table className="epv-review-table">
                <thead>
                  <tr>
                    <th></th>
                    <th className="epv-num">Kilograms</th>
                    <th className="epv-num">Dozens</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td>A. Opening Stock (Pulp brought forward)</td>
                    <td className="epv-num">{totals.pulpA.toLocaleString()}</td>
                    <td className="epv-num">{totals.pulpADozens.toLocaleString()}</td>
                  </tr>
                  <tr>
                    <td>B. Pulp Purchased from Others</td>
                    <td className="epv-num">{totals.pulpB.toLocaleString()}</td>
                    <td className="epv-num">{totals.pulpBDozens.toLocaleString()}</td>
                  </tr>
                  <tr>
                    <td>C. Eggs Converted to Pulp</td>
                    <td className="epv-num">{totals.pulpC.toLocaleString()}</td>
                    <td className="epv-num">{totals.pulpCDozens.toLocaleString()}</td>
                  </tr>
                  <tr className="epv-review-total">
                    <td>= Stock on Hand</td>
                    <td className="epv-num">{totals.pulpStockOnHand.toLocaleString()}</td>
                    <td className="epv-num">{totals.pulpStockOnHandDozens.toLocaleString()}</td>
                  </tr>
                  {(form.PulpPurchaseComment || attachments.some(a => a.Category === 'PulpPurchase')) && (
                    <tr><td colSpan="3" style={{ background: '#fafafa', padding: 8 }}>
                      {form.PulpPurchaseComment && (
                        <div style={{ marginBottom: 6 }}><strong>Pulp Source &amp; Supplier:</strong> {form.PulpPurchaseComment}</div>
                      )}
                      {attachments.filter(a => a.Category === 'PulpPurchase').map(a => (
                        <div key={a.Id} style={{ fontSize: 13 }}>
                          <a href={`/api/epv/attachment/${a.Id}`} target="_blank" rel="noopener noreferrer">{a.OriginalName}</a>
                          <span style={{ color: '#888', marginLeft: 6 }}>({formatBytes(a.FileSize)})</span>
                        </div>
                      ))}
                    </td></tr>
                  )}
                  <tr className="epv-review-deduction">
                    <td>- Sales to Trade</td>
                    <td className="epv-num">{totals.pulpSoldToTrade.toLocaleString()}</td>
                    <td className="epv-num">{totals.pulpSoldToTradeDozens.toLocaleString()}</td>
                  </tr>
                  <tr className="epv-review-levy">
                    <td>Pulp Levy (Dozens &times; R{LEVY_RATE})</td>
                    <td colSpan="2" className="epv-num">R {totals.pulpLevyAmount.toFixed(2)}</td>
                  </tr>
                  <tr className="epv-review-deduction">
                    <td>- Sold to Other Producers</td>
                    <td className="epv-num">{totals.pulpSoldToProducers.toLocaleString()}</td>
                    <td className="epv-num">{totals.pulpSoldToProducersDozens.toLocaleString()}</td>
                  </tr>
                  <tr className="epv-review-deduction">
                    <td>- Conversion Loss</td>
                    <td className="epv-num">{totals.pulpConversionLoss.toLocaleString()}</td>
                    <td className="epv-num">{totals.pulpConversionLossDozens.toLocaleString()}</td>
                  </tr>
                  <tr className="epv-review-total">
                    <td>= Closing Stock Carried Forward</td>
                    <td className="epv-num">{totals.pulpClosingStock.toLocaleString()}</td>
                    <td className="epv-num">{totals.pulpClosingStockDozens.toLocaleString()}</td>
                  </tr>
                </tbody>
              </table>
            </div>

            <div className="epv-review-section">
              <h4>Calculation of Statutory Levy (Powder Eggs)</h4>
              <table className="epv-review-table">
                <thead>
                  <tr>
                    <th></th>
                    <th className="epv-num">Kilograms</th>
                    <th className="epv-num">Dozens</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td>A. Opening Stock (Powder Eggs brought forward)</td>
                    <td className="epv-num">{totals.powderA.toLocaleString()}</td>
                    <td className="epv-num">{totals.powderADozens.toLocaleString()}</td>
                  </tr>
                  <tr>
                    <td>B. Powder Eggs Purchased from Others</td>
                    <td className="epv-num">{totals.powderB.toLocaleString()}</td>
                    <td className="epv-num">{totals.powderBDozens.toLocaleString()}</td>
                  </tr>
                  <tr>
                    <td>C. Eggs Converted to Powder Eggs</td>
                    <td className="epv-num">{totals.powderC.toLocaleString()}</td>
                    <td className="epv-num">{totals.powderCDozens.toLocaleString()}</td>
                  </tr>
                  <tr className="epv-review-total">
                    <td>= Stock on Hand</td>
                    <td className="epv-num">{totals.powderStockOnHand.toLocaleString()}</td>
                    <td className="epv-num">{totals.powderStockOnHandDozens.toLocaleString()}</td>
                  </tr>
                  {(form.PowderPurchaseComment || attachments.some(a => a.Category === 'PowderPurchase')) && (
                    <tr><td colSpan="3" style={{ background: '#fafafa', padding: 8 }}>
                      {form.PowderPurchaseComment && (
                        <div style={{ marginBottom: 6 }}><strong>Powder Egg Source &amp; Supplier:</strong> {form.PowderPurchaseComment}</div>
                      )}
                      {attachments.filter(a => a.Category === 'PowderPurchase').map(a => (
                        <div key={a.Id} style={{ fontSize: 13 }}>
                          <a href={`/api/epv/attachment/${a.Id}`} target="_blank" rel="noopener noreferrer">{a.OriginalName}</a>
                          <span style={{ color: '#888', marginLeft: 6 }}>({formatBytes(a.FileSize)})</span>
                        </div>
                      ))}
                    </td></tr>
                  )}
                  <tr className="epv-review-deduction">
                    <td>- Sales to Trade</td>
                    <td className="epv-num">{totals.powderSoldToTrade.toLocaleString()}</td>
                    <td className="epv-num">{totals.powderSoldToTradeDozens.toLocaleString()}</td>
                  </tr>
                  <tr className="epv-review-levy">
                    <td>Powder Egg Levy (Kg &times; R{LEVY_RATE})</td>
                    <td colSpan="2" className="epv-num">R {totals.powderLevyAmount.toFixed(2)}</td>
                  </tr>
                  <tr className="epv-review-deduction">
                    <td>- Sold to Other Producers</td>
                    <td className="epv-num">{totals.powderSoldToProducers.toLocaleString()}</td>
                    <td className="epv-num">{totals.powderSoldToProducersDozens.toLocaleString()}</td>
                  </tr>
                  <tr className="epv-review-deduction">
                    <td>- Conversion Loss</td>
                    <td className="epv-num">{totals.powderConversionLoss.toLocaleString()}</td>
                    <td className="epv-num">{totals.powderConversionLossDozens.toLocaleString()}</td>
                  </tr>
                  <tr className="epv-review-total">
                    <td>= Closing Stock Carried Forward</td>
                    <td className="epv-num">{totals.powderClosingStock.toLocaleString()}</td>
                    <td className="epv-num">{totals.powderClosingStockDozens.toLocaleString()}</td>
                  </tr>
                </tbody>
              </table>
            </div>

            {/* Total Owed */}
            <div className="epv-review-section epv-total-owed-section">
              <h4>Total Owed</h4>
              <table className="epv-review-table">
                <tbody>
                  <tr>
                    <td>Egg Levy Amount</td>
                    <td className="epv-num">R {totals.levyAmount.toFixed(2)}</td>
                  </tr>
                  <tr>
                    <td>Pulp Levy Amount</td>
                    <td className="epv-num">R {totals.pulpLevyAmount.toFixed(2)}</td>
                  </tr>
                  <tr>
                    <td>Powder Egg Levy Amount</td>
                    <td className="epv-num">R {totals.powderLevyAmount.toFixed(2)}</td>
                  </tr>
                  <tr className="epv-review-grand-total">
                    <td>Total Owed</td>
                    <td className="epv-num">R {(totals.levyAmount + totals.pulpLevyAmount + totals.powderLevyAmount).toFixed(2)}</td>
                  </tr>
                </tbody>
              </table>
            </div>

            {isReadOnly && (
              <div className="epv-readonly-banner">
                <p>This verification has been submitted. If you need to make changes, please log a support ticket.</p>
              </div>
            )}

            <div className="epv-nav">
              <button className="epv-back-btn" onClick={() => setStep(4)}>&larr; Back to Powder Eggs</button>
              {!isCompleted && (
                <button className="epv-submit-btn" onClick={handleSubmit} disabled={submitting}>
                  {submitting ? 'Submitting...' : 'Submit Verification'}
                </button>
              )}
              {isCompleted && canEdit && (
                <button className="epv-submit-btn" onClick={handleSubmit} disabled={submitting}>
                  {submitting ? 'Saving...' : 'Save Changes'}
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default EPVForm;
