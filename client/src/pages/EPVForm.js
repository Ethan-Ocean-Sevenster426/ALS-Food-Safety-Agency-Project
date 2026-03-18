import React, { useEffect, useState, useCallback, useMemo } from 'react';
import { useParams, Link } from 'react-router-dom';
import axios from 'axios';
import './EPVForm.css';

const LEVY_RATE = 0.018;

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

function EPVForm() {
  const { token } = useParams();
  const user = JSON.parse(localStorage.getItem('user') || '{}');

  const [verification, setVerification] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [successMsg, setSuccessMsg] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [step, setStep] = useState(1); // Wizard steps: 1=Business Details, 2=Calculation, 3=Review
  const [validationErrors, setValidationErrors] = useState({});

  // Form data
  const [form, setForm] = useState({
    BusinessName: '', FacilityType: '', TradingName: '',
    AuthorizedPersonName: '', PositionInCompany: '',
    TelephoneNumber: '', CellPhoneNumber: '', EmailAddress: '',
    OpeningStock: 0, GradedEggsPurchased: 0, UngradedEggsPurchased: 0,
    MarketReturns: 0, MachineLoss: 0, SentToPulp: 0, Destroyed: 0,
    SoldToTrade: 0, Exported: 0, SoldToStaff: 0, SoldThroughFarmStall: 0,
    TransferredToOtherProducers: 0,
  });

  const fetchVerification = useCallback(async () => {
    setLoading(true);
    try {
      const res = await axios.get(`http://localhost:5000/api/epv/token/${token}`);
      const v = res.data.verification;
      setVerification(v);
      setForm({
        BusinessName: v.BusinessName || '',
        FacilityType: v.FacilityType || '',
        TradingName: v.TradingName || '',
        AuthorizedPersonName: v.AuthorizedPersonName || '',
        PositionInCompany: v.PositionInCompany || '',
        TelephoneNumber: v.TelephoneNumber || '',
        CellPhoneNumber: v.CellPhoneNumber || '',
        EmailAddress: v.EmailAddress || '',
        OpeningStock: parseFloat(v.OpeningStock) || 0,
        GradedEggsPurchased: parseFloat(v.GradedEggsPurchased) || 0,
        UngradedEggsPurchased: parseFloat(v.UngradedEggsPurchased) || 0,
        MarketReturns: parseFloat(v.MarketReturns) || 0,
        MachineLoss: parseFloat(v.MachineLoss) || 0,
        SentToPulp: parseFloat(v.SentToPulp) || 0,
        Destroyed: parseFloat(v.Destroyed) || 0,
        SoldToTrade: parseFloat(v.SoldToTrade) || 0,
        Exported: parseFloat(v.Exported) || 0,
        SoldToStaff: parseFloat(v.SoldToStaff) || 0,
        SoldThroughFarmStall: parseFloat(v.SoldThroughFarmStall) || 0,
        TransferredToOtherProducers: parseFloat(v.TransferredToOtherProducers) || 0,
      });
    } catch (err) {
      setError('Verification form not found or has expired.');
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => { fetchVerification(); }, [fetchVerification]);

  // Calculated totals
  const totals = useMemo(() => {
    const opening = parseFloat(form.OpeningStock) || 0;
    const graded = parseFloat(form.GradedEggsPurchased) || 0;
    const ungraded = parseFloat(form.UngradedEggsPurchased) || 0;
    const totalB = opening + graded + ungraded;

    const marketReturns = parseFloat(form.MarketReturns) || 0;
    const machineLoss = parseFloat(form.MachineLoss) || 0;
    const sentToPulp = parseFloat(form.SentToPulp) || 0;
    const destroyed = parseFloat(form.Destroyed) || 0;
    const totalC = totalB - marketReturns - machineLoss - sentToPulp - destroyed;

    const soldToTrade = parseFloat(form.SoldToTrade) || 0;
    const exported = parseFloat(form.Exported) || 0;
    const soldToStaff = parseFloat(form.SoldToStaff) || 0;
    const soldThroughFarmStall = parseFloat(form.SoldThroughFarmStall) || 0;
    const totalD = soldToTrade + exported + soldToStaff + soldThroughFarmStall;
    const levyAmount = totalD * LEVY_RATE;

    const transferred = parseFloat(form.TransferredToOtherProducers) || 0;
    const closingStock = totalC - totalD - transferred;

    return { totalB, totalC, totalD, levyAmount, closingStock };
  }, [form]);

  const REQUIRED_FIELDS = [
    { key: 'BusinessName', label: 'Facility Name' },
    { key: 'FacilityType', label: 'Facility Type' },
    { key: 'AuthorizedPersonName', label: 'Name of Owner, Manager or Authorized Person' },
    { key: 'PositionInCompany', label: 'Position in the Company' },
    { key: 'TelephoneNumber', label: 'Telephone Number' },
    { key: 'CellPhoneNumber', label: 'Cell Phone Number' },
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

  const handleNumberChange = (key, value) => {
    const num = value === '' ? 0 : parseFloat(value);
    setForm(prev => ({ ...prev, [key]: isNaN(num) ? 0 : num }));
  };

  const handleSubmit = async () => {
    setSubmitting(true);
    setError('');
    try {
      const completedBy = user.firstName
        ? `${user.firstName} ${user.lastName} (${user.email})`
        : form.AuthorizedPersonName || form.EmailAddress || 'Unknown';

      await axios.put(`http://localhost:5000/api/epv/token/${token}/submit`, {
        data: form,
        completedBy,
      });
      setSuccessMsg('Verification submitted successfully!');
      setStep(4); // Success step
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to submit verification.');
    } finally {
      setSubmitting(false);
    }
  };

  const isCompleted = verification?.Status === 'Completed';
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
            <h1>EPVS</h1>
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

  // Success state
  if (step === 4) {
    return (
      <div className="epv-container">
        <div className="epv-card">
          <div className="epv-brand">
            <h1>EPVS</h1>
            <p>Egg Production Verification System</p>
          </div>
          <div className="epv-success-box">
            <div className="epv-success-icon">&#10003;</div>
            <h2>Verification Submitted</h2>
            <p>The Egg Production Verification for <strong>{periodLabel}</strong> has been submitted successfully.</p>
            <div className="epv-summary-box">
              <div className="epv-summary-row"><span>Closing Stock:</span><strong>{totals.closingStock.toLocaleString()}</strong></div>
              <div className="epv-summary-row"><span>Levy Amount (@ R{LEVY_RATE}):</span><strong>R {totals.levyAmount.toFixed(2)}</strong></div>
            </div>
          </div>
          {user.token && (
            <div style={{ textAlign: 'center', marginTop: 20 }}>
              <Link to="/company" className="epv-link">Back to Company Overview</Link>
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="epv-container">
      <div className="epv-card epv-wide">
        <div className="epv-brand">
          <h1>EPVS</h1>
          <p>Egg Production Verification System</p>
        </div>

        <div className="epv-period-header">
          <h2>Egg Production Verification</h2>
          <span className="epv-period-badge">{periodLabel}</span>
          {isCompleted && <span className="epv-completed-badge">Completed</span>}
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
            <span className="epv-step-label">Egg Calculation</span>
          </div>
          <div className="epv-step-line" />
          <div className={`epv-step ${step >= 3 ? 'active' : ''}`}>
            <span className="epv-step-num">3</span>
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
                <input type="text" value={form.BusinessName} onChange={(e) => handleChange('BusinessName', e.target.value)} disabled={isCompleted} />
                {validationErrors.BusinessName && <span className="epv-error-msg">{validationErrors.BusinessName}</span>}
              </div>
              <div className={`epv-field ${validationErrors.FacilityType ? 'epv-field-error' : ''}`}>
                <label>Facility Type <span className="epv-required-star">*</span></label>
                <select value={form.FacilityType} onChange={(e) => handleChange('FacilityType', e.target.value)} disabled={isCompleted} className="epv-select">
                  <option value="">— Select —</option>
                  <option value="Producer">Producer</option>
                  <option value="Re-Packer">Re-Packer</option>
                </select>
                {validationErrors.FacilityType && <span className="epv-error-msg">{validationErrors.FacilityType}</span>}
              </div>
              <div className="epv-field epv-full">
                <label>Trading Name</label>
                <input type="text" value={form.TradingName} onChange={(e) => handleChange('TradingName', e.target.value)} disabled={isCompleted} />
              </div>
              <div className={`epv-field epv-full ${validationErrors.AuthorizedPersonName ? 'epv-field-error' : ''}`}>
                <label>Name of Owner, Manager or Authorized Person <span className="epv-required-star">*</span></label>
                <input type="text" value={form.AuthorizedPersonName} onChange={(e) => handleChange('AuthorizedPersonName', e.target.value)} disabled={isCompleted} />
                {validationErrors.AuthorizedPersonName && <span className="epv-error-msg">{validationErrors.AuthorizedPersonName}</span>}
              </div>
              <div className={`epv-field ${validationErrors.PositionInCompany ? 'epv-field-error' : ''}`}>
                <label>Position in the Company <span className="epv-required-star">*</span></label>
                <input type="text" value={form.PositionInCompany} onChange={(e) => handleChange('PositionInCompany', e.target.value)} disabled={isCompleted} />
                {validationErrors.PositionInCompany && <span className="epv-error-msg">{validationErrors.PositionInCompany}</span>}
              </div>
              <div className={`epv-field ${validationErrors.TelephoneNumber ? 'epv-field-error' : ''}`}>
                <label>Telephone Number <span className="epv-required-star">*</span></label>
                <input type="tel" value={form.TelephoneNumber} onChange={(e) => handleChange('TelephoneNumber', e.target.value)} disabled={isCompleted} />
                {validationErrors.TelephoneNumber && <span className="epv-error-msg">{validationErrors.TelephoneNumber}</span>}
              </div>
              <div className={`epv-field ${validationErrors.CellPhoneNumber ? 'epv-field-error' : ''}`}>
                <label>Cell Phone Number <span className="epv-required-star">*</span></label>
                <input type="tel" value={form.CellPhoneNumber} onChange={(e) => handleChange('CellPhoneNumber', e.target.value)} disabled={isCompleted} />
                {validationErrors.CellPhoneNumber && <span className="epv-error-msg">{validationErrors.CellPhoneNumber}</span>}
              </div>
              <div className={`epv-field ${validationErrors.EmailAddress ? 'epv-field-error' : ''}`}>
                <label>Email Address <span className="epv-required-star">*</span></label>
                <input type="email" value={form.EmailAddress} onChange={(e) => handleChange('EmailAddress', e.target.value)} disabled={isCompleted} />
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

            {/* Section A: Opening Stock & Purchases */}
            <div className="epv-calc-section">
              <h4>A. Opening Stock & Purchases</h4>
              <div className="epv-calc-rows">
                <div className="epv-calc-row">
                  <label>A. Opening Stock (previous month closing):</label>
                  <input type="number" step="0.01" value={form.OpeningStock || ''} onChange={(e) => handleNumberChange('OpeningStock', e.target.value)} disabled={isCompleted} placeholder="0" />
                </div>
                <div className="epv-calc-row">
                  <label>+ Graded Eggs Purchased:</label>
                  <input type="number" step="0.01" value={form.GradedEggsPurchased || ''} onChange={(e) => handleNumberChange('GradedEggsPurchased', e.target.value)} disabled={isCompleted} placeholder="0" />
                </div>
                <div className="epv-calc-row">
                  <label>+ Ungraded Eggs Purchased:</label>
                  <input type="number" step="0.01" value={form.UngradedEggsPurchased || ''} onChange={(e) => handleNumberChange('UngradedEggsPurchased', e.target.value)} disabled={isCompleted} placeholder="0" />
                </div>
                <div className="epv-calc-row epv-total-row">
                  <label>Total B (A + Graded + Ungraded):</label>
                  <span className="epv-calc-total">{totals.totalB.toLocaleString()}</span>
                </div>
              </div>
            </div>

            {/* Section B: Deductions */}
            <div className="epv-calc-section">
              <h4>B. Deductions</h4>
              <div className="epv-calc-rows">
                <div className="epv-calc-row">
                  <label>- Market Returns:</label>
                  <input type="number" step="0.01" value={form.MarketReturns || ''} onChange={(e) => handleNumberChange('MarketReturns', e.target.value)} disabled={isCompleted} placeholder="0" />
                </div>
                <div className="epv-calc-row">
                  <label>- Machine Loss:</label>
                  <input type="number" step="0.01" value={form.MachineLoss || ''} onChange={(e) => handleNumberChange('MachineLoss', e.target.value)} disabled={isCompleted} placeholder="0" />
                </div>
                <div className="epv-calc-row">
                  <label>- Sent to Pulp:</label>
                  <input type="number" step="0.01" value={form.SentToPulp || ''} onChange={(e) => handleNumberChange('SentToPulp', e.target.value)} disabled={isCompleted} placeholder="0" />
                </div>
                <div className="epv-calc-row">
                  <label>- Destroyed (other e.g., full bloods):</label>
                  <input type="number" step="0.01" value={form.Destroyed || ''} onChange={(e) => handleNumberChange('Destroyed', e.target.value)} disabled={isCompleted} placeholder="0" />
                </div>
                <div className="epv-calc-row epv-total-row">
                  <label>Total C (B - Deductions):</label>
                  <span className="epv-calc-total">{totals.totalC.toLocaleString()}</span>
                </div>
              </div>
            </div>

            {/* Section C: Sales */}
            <div className="epv-calc-section">
              <h4>C. Sales</h4>
              <div className="epv-calc-rows">
                <div className="epv-calc-row">
                  <label>Sold to Trade:</label>
                  <input type="number" step="0.01" value={form.SoldToTrade || ''} onChange={(e) => handleNumberChange('SoldToTrade', e.target.value)} disabled={isCompleted} placeholder="0" />
                </div>
                <div className="epv-calc-row">
                  <label>Exported:</label>
                  <input type="number" step="0.01" value={form.Exported || ''} onChange={(e) => handleNumberChange('Exported', e.target.value)} disabled={isCompleted} placeholder="0" />
                </div>
                <div className="epv-calc-row">
                  <label>Sold to Staff or Own Use:</label>
                  <input type="number" step="0.01" value={form.SoldToStaff || ''} onChange={(e) => handleNumberChange('SoldToStaff', e.target.value)} disabled={isCompleted} placeholder="0" />
                </div>
                <div className="epv-calc-row">
                  <label>Sold through Farm Stall:</label>
                  <input type="number" step="0.01" value={form.SoldThroughFarmStall || ''} onChange={(e) => handleNumberChange('SoldThroughFarmStall', e.target.value)} disabled={isCompleted} placeholder="0" />
                </div>
                <div className="epv-calc-row epv-total-row">
                  <label>Total D (Total Sales):</label>
                  <span className="epv-calc-total">{totals.totalD.toLocaleString()}</span>
                </div>
                <div className="epv-calc-row epv-levy-row">
                  <label>Levy Amount (D x R{LEVY_RATE}):</label>
                  <span className="epv-levy-amount">R {totals.levyAmount.toFixed(2)}</span>
                </div>
              </div>
            </div>

            {/* Section D: Transfers & Closing */}
            <div className="epv-calc-section">
              <h4>D. Transfers & Closing Stock</h4>
              <div className="epv-calc-rows">
                <div className="epv-calc-row">
                  <label>Transferred or Sold to Other Producers:</label>
                  <input type="number" step="0.01" value={form.TransferredToOtherProducers || ''} onChange={(e) => handleNumberChange('TransferredToOtherProducers', e.target.value)} disabled={isCompleted} placeholder="0" />
                </div>
                <div className="epv-calc-row epv-closing-row">
                  <label>Closing Stock (C - D - Transfers):</label>
                  <span className={`epv-closing-stock ${totals.closingStock < 0 ? 'negative' : ''}`}>
                    {totals.closingStock.toLocaleString()}
                  </span>
                </div>
              </div>
            </div>

            <div className="epv-nav">
              <button className="epv-back-btn" onClick={() => setStep(1)}>&larr; Back</button>
              <button className="epv-next-btn" onClick={() => setStep(3)}>Next: Review &rarr;</button>
            </div>
          </div>
        )}

        {/* STEP 3: Review & Submit */}
        {step === 3 && (
          <div className="epv-step-content">
            <h3>Review & Submit</h3>
            <p className="epv-step-desc">Please review all information before submitting.</p>

            <div className="epv-review-section">
              <h4>Business Details</h4>
              <div className="epv-review-grid">
                <div><span>Facility Name:</span> <strong>{form.BusinessName}</strong></div>
                <div><span>Facility Type:</span> <strong>{form.FacilityType}</strong></div>
                <div><span>Trading Name:</span> <strong>{form.TradingName}</strong></div>
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
                  <tr><td>A. Opening Stock</td><td className="epv-num">{(parseFloat(form.OpeningStock) || 0).toLocaleString()}</td></tr>
                  <tr><td>+ Graded Eggs Purchased</td><td className="epv-num">{(parseFloat(form.GradedEggsPurchased) || 0).toLocaleString()}</td></tr>
                  <tr><td>+ Ungraded Eggs Purchased</td><td className="epv-num">{(parseFloat(form.UngradedEggsPurchased) || 0).toLocaleString()}</td></tr>
                  <tr className="epv-review-total"><td>Total B</td><td className="epv-num">{totals.totalB.toLocaleString()}</td></tr>
                  <tr><td>- Market Returns</td><td className="epv-num">{(parseFloat(form.MarketReturns) || 0).toLocaleString()}</td></tr>
                  <tr><td>- Machine Loss</td><td className="epv-num">{(parseFloat(form.MachineLoss) || 0).toLocaleString()}</td></tr>
                  <tr><td>- Sent to Pulp</td><td className="epv-num">{(parseFloat(form.SentToPulp) || 0).toLocaleString()}</td></tr>
                  <tr><td>- Destroyed</td><td className="epv-num">{(parseFloat(form.Destroyed) || 0).toLocaleString()}</td></tr>
                  <tr className="epv-review-total"><td>Total C</td><td className="epv-num">{totals.totalC.toLocaleString()}</td></tr>
                  <tr><td>Sold to Trade</td><td className="epv-num">{(parseFloat(form.SoldToTrade) || 0).toLocaleString()}</td></tr>
                  <tr><td>Exported</td><td className="epv-num">{(parseFloat(form.Exported) || 0).toLocaleString()}</td></tr>
                  <tr><td>Sold to Staff / Own Use</td><td className="epv-num">{(parseFloat(form.SoldToStaff) || 0).toLocaleString()}</td></tr>
                  <tr><td>Sold through Farm Stall</td><td className="epv-num">{(parseFloat(form.SoldThroughFarmStall) || 0).toLocaleString()}</td></tr>
                  <tr className="epv-review-total"><td>Total D (Sales)</td><td className="epv-num">{totals.totalD.toLocaleString()}</td></tr>
                  <tr className="epv-review-levy"><td>Levy (D x R{LEVY_RATE})</td><td className="epv-num">R {totals.levyAmount.toFixed(2)}</td></tr>
                  <tr><td>Transferred to Other Producers</td><td className="epv-num">{(parseFloat(form.TransferredToOtherProducers) || 0).toLocaleString()}</td></tr>
                  <tr className="epv-review-closing"><td>Closing Stock (E)</td><td className="epv-num">{totals.closingStock.toLocaleString()}</td></tr>
                </tbody>
              </table>
            </div>

            <div className="epv-nav">
              <button className="epv-back-btn" onClick={() => setStep(2)}>&larr; Back to Calculation</button>
              {!isCompleted && (
                <button className="epv-submit-btn" onClick={handleSubmit} disabled={submitting}>
                  {submitting ? 'Submitting...' : 'Submit Verification'}
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
