import React, { useEffect, useState, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import axios from 'axios';
import './Auth.css';
import './AcceptInvite.css';


const WIZARD_STEPS = [
  {
    title: 'Business Information',
    fields: [
      { key: 'BusinessName', label: 'Business Name' },
      { key: 'CompanyRegNumber', label: 'Company Registration Number' },
      { key: 'PhysicalAddress', label: 'Physical Address' },
      { key: 'VATNumber', label: 'VAT Number' },
    ],
  },
  {
    title: 'Abattoir Owner Details',
    fields: [
      { key: 'AbattoirOwnerName', label: 'Name of Abattoir Owner' },
      { key: 'AbattoirOwnerCell', label: 'Abattoir Owner Cellphone Number' },
      { key: 'AbattoirOwnerEmail', label: 'Abattoir Owner Email Address' },
    ],
  },
  {
    title: 'Accounts Contact',
    fields: [
      { key: 'AccountsContactName', label: 'Contact Person for Accounts' },
      { key: 'AccountsTelephone', label: 'Accounts Telephone Number' },
      { key: 'AccountsEmail', label: 'Accounts Email Address' },
    ],
  },
  {
    title: 'Abattoir Manager Details',
    fields: [
      { key: 'AbattoirManagerName', label: 'Manager of Abattoir Name' },
      { key: 'AbattoirManagerCell', label: 'Manager of Abattoir Cellphone Number' },
      { key: 'AbattoirManagerEmail', label: 'Manager of Abattoir Email Address' },
    ],
  },
];

function AcceptInvite() {
  const { token } = useParams();
  const navigate = useNavigate();

  const [invite, setInvite] = useState(null);
  const [loadError, setLoadError] = useState('');
  const [loading, setLoading] = useState(true);

  // Registration step
  const [step, setStep] = useState('register'); // 'register' | 'wizard' | 'done'
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // Wizard step (for Company Admin)
  const [wizardStep, setWizardStep] = useState(0);
  const [wizardData, setWizardData] = useState({});
  const [wizardErrors, setWizardErrors] = useState({});

  const fetchInvite = useCallback(async () => {
    try {
      const res = await axios.get(`http://localhost:5000/api/invites/${token}`);
      setInvite(res.data.invite);

      // Pre-fill wizard data from existing record
      const data = {};
      WIZARD_STEPS.forEach(s => {
        s.fields.forEach(f => {
          data[f.key] = res.data.invite[f.key] || '';
        });
      });
      setWizardData(data);
    } catch (err) {
      setLoadError(err.response?.data?.message || 'Invalid or expired invitation link.');
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => { fetchInvite(); }, [fetchInvite]);

  const handleRegister = async (e) => {
    e.preventDefault();
    setError('');

    if (password !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }
    if (password.length < 6) {
      setError('Password must be at least 6 characters.');
      return;
    }

    // If Company Admin, go to wizard first before submitting
    if (invite.Role === 'Company Admin') {
      setStep('wizard');
      return;
    }

    // For regular User, submit directly
    await submitAcceptance(null);
  };

  const submitAcceptance = async (verificationData) => {
    setSubmitting(true);
    setError('');
    try {
      await axios.post(`http://localhost:5000/api/invites/${token}/accept`, {
        firstName,
        lastName,
        password,
        verificationData,
      });
      setStep('done');
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to create account.');
      if (invite.Role === 'Company Admin') {
        // Stay on wizard if error
      } else {
        setStep('register');
      }
    } finally {
      setSubmitting(false);
    }
  };

  const handleWizardFieldChange = (key, value) => {
    setWizardData(prev => ({ ...prev, [key]: value }));
    if (wizardErrors[key]) {
      setWizardErrors(prev => { const n = { ...prev }; delete n[key]; return n; });
    }
  };

  const validateWizardStep = () => {
    const currentFields = WIZARD_STEPS[wizardStep].fields;
    const errors = {};
    currentFields.forEach(f => {
      if (!wizardData[f.key] || !wizardData[f.key].trim()) {
        errors[f.key] = 'This field is required.';
      }
    });
    setWizardErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const nextWizardStep = () => {
    if (!validateWizardStep()) return;
    if (wizardStep < WIZARD_STEPS.length - 1) {
      setWizardStep(wizardStep + 1);
    } else {
      // Final step — submit everything
      submitAcceptance(wizardData);
    }
  };

  const prevWizardStep = () => {
    if (wizardStep > 0) {
      setWizardStep(wizardStep - 1);
    } else {
      setStep('register');
    }
  };

  // ===== LOADING / ERROR =====
  if (loading) {
    return (
      <div className="auth-container">
        <div className="auth-card"><p style={{ textAlign: 'center', color: '#888' }}>Loading invitation...</p></div>
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="auth-container">
        <div className="auth-card">
          <div className="auth-header">
            <img src="/fsa-logo.png" alt="Food Safety Agency" className="auth-logo" />
            <h2>Invitation</h2>
          </div>
          <div className="auth-error">{loadError}</div>
          <button className="auth-button" onClick={() => navigate('/login')}>Go to Login</button>
        </div>
      </div>
    );
  }

  // ===== DONE =====
  if (step === 'done') {
    return (
      <div className="auth-container">
        <div className="auth-card">
          <div className="auth-header">
            <img src="/fsa-logo.png" alt="Food Safety Agency" className="auth-logo" />
            <h2>Account Created!</h2>
          </div>
          <div className="auth-success">Your account has been created successfully. You can now sign in.</div>
          <button className="auth-button" onClick={() => navigate('/login')}>Sign In</button>
        </div>
      </div>
    );
  }

  // ===== WIZARD (Company Admin) =====
  if (step === 'wizard') {
    const currentStep = WIZARD_STEPS[wizardStep];
    return (
      <div className="auth-container">
        <div className="auth-card wizard-card">
          <div className="auth-header">
            <img src="/fsa-logo.png" alt="Food Safety Agency" className="auth-logo" />
            <h2>Verify Business Details</h2>
            <p>Step {wizardStep + 1} of {WIZARD_STEPS.length}: {currentStep.title}</p>
          </div>

          <div className="wizard-progress">
            {WIZARD_STEPS.map((s, i) => (
              <div key={i} className={`wizard-progress-step ${i <= wizardStep ? 'active' : ''} ${i < wizardStep ? 'completed' : ''}`}>
                <div className="wizard-progress-dot">{i < wizardStep ? '\u2713' : i + 1}</div>
                <span className="wizard-progress-label">{s.title}</span>
              </div>
            ))}
          </div>

          {error && <div className="auth-error">{error}</div>}

          <div className="wizard-fields">
            {currentStep.fields.map(f => (
              <div key={f.key} className="form-group">
                <label htmlFor={f.key}>{f.label} <span className="required">*</span></label>
                <input
                  type={f.key.toLowerCase().includes('email') ? 'email' : 'text'}
                  id={f.key}
                  value={wizardData[f.key] || ''}
                  onChange={(e) => handleWizardFieldChange(f.key, e.target.value)}
                  placeholder={f.label}
                  className={wizardErrors[f.key] ? 'input-error' : ''}
                />
                {wizardErrors[f.key] && <span className="field-error">{wizardErrors[f.key]}</span>}
              </div>
            ))}
          </div>

          <div className="wizard-nav">
            <button className="wizard-back-btn" onClick={prevWizardStep}>
              {wizardStep === 0 ? 'Back to Registration' : 'Previous'}
            </button>
            <button className="auth-button wizard-next-btn" onClick={nextWizardStep} disabled={submitting}>
              {submitting ? 'Submitting...' : wizardStep === WIZARD_STEPS.length - 1 ? 'Submit & Create Account' : 'Next'}
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ===== REGISTRATION =====
  return (
    <div className="auth-container">
      <div className="auth-card">
        <div className="auth-header">
          <img src="/fsa-logo.png" alt="Food Safety Agency" className="auth-logo" />
          <h2>Accept Invitation</h2>
          <p>
            You've been invited to join as <strong style={{ color: '#DC3545' }}>{invite.Role}</strong>
            {' '}for <strong>{invite.BusinessName}</strong>
          </p>
        </div>

        {error && <div className="auth-error">{error}</div>}

        <form onSubmit={handleRegister} className="auth-form">
          <div className="form-group">
            <label>Email</label>
            <input type="email" value={invite.Email} disabled className="input-disabled" />
          </div>

          <div className="form-row">
            <div className="form-group">
              <label htmlFor="firstName">First Name</label>
              <input
                type="text" id="firstName" value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
                placeholder="First name" required
              />
            </div>
            <div className="form-group">
              <label htmlFor="lastName">Last Name</label>
              <input
                type="text" id="lastName" value={lastName}
                onChange={(e) => setLastName(e.target.value)}
                placeholder="Last name" required
              />
            </div>
          </div>

          <div className="form-group">
            <label htmlFor="password">Create Password</label>
            <input
              type="password" id="password" value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="At least 6 characters" required
            />
          </div>

          <div className="form-group">
            <label htmlFor="confirmPassword">Confirm Password</label>
            <input
              type="password" id="confirmPassword" value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              placeholder="Confirm your password" required
            />
          </div>

          <button type="submit" className="auth-button" disabled={submitting}>
            {invite.Role === 'Company Admin' ? 'Next: Verify Business Details' : 'Create Account'}
          </button>
        </form>
      </div>
    </div>
  );
}

export default AcceptInvite;
