import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import axios from 'axios';
import './Auth.css';
import './AcceptInvite.css';

const PROVINCES = [
  '', 'Eastern Cape', 'Free State', 'Gauteng', 'KwaZulu-Natal', 'Limpopo',
  'Mpumalanga', 'North West', 'Northern Cape', 'Western Cape',
];

const WIZARD_STEPS = [
  {
    title: 'Account Details',
    fields: [
      { key: 'firstName', label: 'First Name', required: true },
      { key: 'lastName', label: 'Last Name', required: true },
      { key: 'email', label: 'Email Address', type: 'email', required: true },
      { key: 'password', label: 'Password', type: 'password', required: true },
      { key: 'confirmPassword', label: 'Confirm Password', type: 'password', required: true },
    ],
  },
  {
    title: 'Business Information',
    fields: [
      { key: 'businessName', label: 'Business Name', required: true },
      { key: 'facilityType', label: 'Facility Type', type: 'select', options: ['', 'Producer', 'Re-Packer', 'Breaking Plant'] },
      { key: 'facilityProvince', label: 'Facility Province', type: 'select', options: PROVINCES },
      { key: 'town', label: 'Town' },
      { key: 'companyRegNumber', label: 'Company Registration Number' },
      { key: 'physicalAddress', label: 'Physical Address' },
      { key: 'vatNumber', label: 'VAT Number' },
    ],
  },
  {
    title: 'Facility Owner Details',
    fields: [
      { key: 'abattoirOwnerName', label: 'Name of Facility Owner' },
      { key: 'abattoirOwnerCell', label: 'Facility Owner Cellphone Number' },
      { key: 'abattoirOwnerEmail', label: 'Facility Owner Email Address' },
    ],
  },
  {
    title: 'Accounts Contact',
    fields: [
      { key: 'accountsContactName', label: 'Contact Person for Accounts' },
      { key: 'accountsTelephone', label: 'Accounts Telephone Number' },
      { key: 'accountsEmail', label: 'Accounts Email Address' },
    ],
  },
  {
    title: 'Facility Manager Details',
    fields: [
      { key: 'abattoirManagerName', label: 'Facility Manager Name' },
      { key: 'abattoirManagerCell', label: 'Facility Manager Cellphone Number' },
      { key: 'abattoirManagerEmail', label: 'Facility Manager Email Address' },
    ],
  },
];

function CompanyRegister() {
  const [step, setStep] = useState(0);
  const [formData, setFormData] = useState({});
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);

  const handleChange = (key, value) => {
    setFormData(prev => ({ ...prev, [key]: value }));
    setError('');
  };

  const validateStep = () => {
    const currentStep = WIZARD_STEPS[step];
    for (const field of currentStep.fields) {
      if (field.required && !formData[field.key]?.trim()) {
        setError(`${field.label} is required.`);
        return false;
      }
    }
    // Account details validation
    if (step === 0) {
      if (formData.password && formData.password.length < 6) {
        setError('Password must be at least 6 characters.');
        return false;
      }
      if (formData.password !== formData.confirmPassword) {
        setError('Passwords do not match.');
        return false;
      }
    }
    return true;
  };

  const handleNext = () => {
    if (!validateStep()) return;
    setError('');
    setStep(prev => prev + 1);
  };

  const handleBack = () => {
    setError('');
    setStep(prev => prev - 1);
  };

  const handleSubmit = async () => {
    if (!validateStep()) return;
    setLoading(true);
    setError('');

    try {
      await axios.post('/api/auth/register-company', formData);
      setSuccess(true);
    } catch (err) {
      setError(err.response?.data?.message || 'Registration failed. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  if (success) {
    return (
      <div className="auth-container">
        <div className="auth-card" style={{ maxWidth: 520 }}>
          <div className="auth-header">
            <img src="/fsa-logo.png" alt="Food Safety Agency" className="auth-logo" />
            <h2>Registration Submitted</h2>
          </div>
          <div style={{ textAlign: 'center', padding: '20px 0' }}>
            <div style={{ fontSize: 48, color: '#059669', marginBottom: 12 }}>&#10003;</div>
            <p style={{ color: '#555', fontSize: 15, lineHeight: 1.6 }}>
              Your company registration has been submitted and is <strong>pending approval</strong>.
            </p>
            <p style={{ color: '#555', fontSize: 15, lineHeight: 1.6 }}>
              You will receive an email notification once your registration has been approved.
              After approval, you can sign in to access the system.
            </p>
            <Link to="/login" style={{ display: 'inline-block', marginTop: 20, padding: '10px 30px', background: '#4f46e5', color: '#fff', borderRadius: 8, textDecoration: 'none', fontWeight: 600 }}>
              Go to Sign In
            </Link>
          </div>
        </div>
      </div>
    );
  }

  const currentStep = WIZARD_STEPS[step];
  const isLastStep = step === WIZARD_STEPS.length - 1;

  return (
    <div className="auth-container">
      <div className="auth-card" style={{ maxWidth: 560 }}>
        <div className="auth-header">
          <img src="/fsa-logo.png" alt="Food Safety Agency" className="auth-logo" />
          <h2>Company Registration</h2>
          <p>Register your company on the Egg Production Verification System</p>
        </div>

        {/* Progress indicator */}
        <div style={{ display: 'flex', justifyContent: 'center', gap: 6, margin: '16px 0' }}>
          {WIZARD_STEPS.map((s, i) => (
            <div key={i} style={{
              width: 10, height: 10, borderRadius: '50%',
              background: i === step ? '#4f46e5' : i < step ? '#059669' : '#d1d5db',
              transition: 'background 0.2s',
            }} title={s.title} />
          ))}
        </div>

        <h3 style={{ textAlign: 'center', margin: '8px 0 16px', color: '#333', fontSize: 16 }}>
          Step {step + 1}: {currentStep.title}
        </h3>

        {error && <div className="auth-error">{error}</div>}

        <div className="auth-form">
          {currentStep.fields.map(field => (
            <div key={field.key} className="form-group">
              <label htmlFor={field.key}>
                {field.label} {field.required && <span style={{ color: '#dc2626' }}>*</span>}
              </label>
              {field.type === 'select' ? (
                <select
                  id={field.key}
                  value={formData[field.key] || ''}
                  onChange={(e) => handleChange(field.key, e.target.value)}
                  className="auth-input"
                >
                  {field.options.map(opt => (
                    <option key={opt} value={opt}>{opt || '-- Select --'}</option>
                  ))}
                </select>
              ) : (
                <input
                  type={field.type || 'text'}
                  id={field.key}
                  value={formData[field.key] || ''}
                  onChange={(e) => handleChange(field.key, e.target.value)}
                  placeholder={field.label}
                />
              )}
            </div>
          ))}

          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 16 }}>
            {step > 0 ? (
              <button type="button" onClick={handleBack} className="auth-button" style={{ background: '#6b7280', flex: '0 0 auto', marginRight: 8 }}>
                Back
              </button>
            ) : (
              <div />
            )}
            {isLastStep ? (
              <button type="button" onClick={handleSubmit} disabled={loading} className="auth-button" style={{ flex: '1 1 auto' }}>
                {loading ? 'Submitting...' : 'Submit Registration'}
              </button>
            ) : (
              <button type="button" onClick={handleNext} className="auth-button" style={{ flex: '1 1 auto' }}>
                Next
              </button>
            )}
          </div>
        </div>

        <p className="auth-switch">
          Already have an account? <Link to="/login">Sign In</Link>
        </p>
      </div>
    </div>
  );
}

export default CompanyRegister;
