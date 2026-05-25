import React, { useState, useRef, useEffect } from 'react';
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
  { title: 'Email Verification', isOtp: true },
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

  // OTP state
  const [otpDigits, setOtpDigits] = useState(['', '', '', '', '', '']);
  const [otpSent, setOtpSent] = useState(false);
  const [otpSending, setOtpSending] = useState(false);
  const [otpVerifying, setOtpVerifying] = useState(false);
  const [otpToken, setOtpToken] = useState('');
  const [otpVerified, setOtpVerified] = useState(false);
  const [resendCooldown, setResendCooldown] = useState(0);
  const inputRefs = useRef([]);

  // Resend cooldown timer
  useEffect(() => {
    if (resendCooldown <= 0) return;
    const timer = setTimeout(() => setResendCooldown(resendCooldown - 1), 1000);
    return () => clearTimeout(timer);
  }, [resendCooldown]);

  const handleChange = (key, value) => {
    setFormData(prev => ({ ...prev, [key]: value }));
    setError('');
  };

  const validateStep = () => {
    const currentStep = WIZARD_STEPS[step];
    if (currentStep.isOtp) return true;
    for (const field of currentStep.fields) {
      if (field.required && !formData[field.key]?.trim()) {
        setError(`${field.label} is required.`);
        return false;
      }
    }
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

  const sendOtp = async () => {
    setOtpSending(true);
    setError('');
    try {
      const res = await axios.post('/api/auth/send-otp', { email: formData.email });
      setOtpSent(true);
      setResendCooldown(60);
      setError('');
      // Show success briefly
      setError('');
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to send verification code.');
    } finally {
      setOtpSending(false);
    }
  };

  const handleOtpChange = (index, value) => {
    if (value.length > 1) value = value.slice(-1);
    if (value && !/^\d$/.test(value)) return;

    const newDigits = [...otpDigits];
    newDigits[index] = value;
    setOtpDigits(newDigits);
    setError('');

    // Auto-focus next input
    if (value && index < 5) {
      inputRefs.current[index + 1]?.focus();
    }
  };

  const handleOtpKeyDown = (index, e) => {
    if (e.key === 'Backspace' && !otpDigits[index] && index > 0) {
      inputRefs.current[index - 1]?.focus();
    }
  };

  const handleOtpPaste = (e) => {
    e.preventDefault();
    const pasted = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, 6);
    if (pasted.length === 6) {
      const newDigits = pasted.split('');
      setOtpDigits(newDigits);
      inputRefs.current[5]?.focus();
    }
  };

  const verifyOtp = async () => {
    const code = otpDigits.join('');
    if (code.length !== 6) {
      setError('Please enter the full 6-digit code.');
      return;
    }
    setOtpVerifying(true);
    setError('');
    try {
      const res = await axios.post('/api/auth/verify-otp', { email: formData.email, code });
      setOtpToken(res.data.otpToken);
      setOtpVerified(true);
      setStep(prev => prev + 1);
    } catch (err) {
      setError(err.response?.data?.message || 'Invalid verification code.');
    } finally {
      setOtpVerifying(false);
    }
  };

  const handleNext = async () => {
    if (!validateStep()) return;
    setError('');

    // If moving from Account Details to OTP step, send OTP automatically
    if (step === 0 && !otpVerified) {
      setStep(1);
      if (!otpSent) {
        await sendOtp();
      }
      return;
    }

    // If already verified OTP, skip the OTP step
    if (step === 0 && otpVerified) {
      setStep(2);
      return;
    }

    setStep(prev => prev + 1);
  };

  const handleBack = () => {
    setError('');
    // From OTP step, go back to Account Details
    if (step === 1) {
      setStep(0);
      return;
    }
    setStep(prev => prev - 1);
  };

  const handleSubmit = async () => {
    if (!validateStep()) return;
    setLoading(true);
    setError('');

    try {
      await axios.post('/api/auth/register-company', { ...formData, otpToken });
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
            <Link to="/login" style={{ display: 'inline-block', marginTop: 20, padding: '10px 30px', background: '#0E7C7B', color: '#fff', borderRadius: 8, textDecoration: 'none', fontWeight: 600 }}>
              Go to Sign In
            </Link>
          </div>
        </div>
      </div>
    );
  }

  const currentStep = WIZARD_STEPS[step];
  const isLastStep = step === WIZARD_STEPS.length - 1;
  const isOtpStep = currentStep.isOtp;

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
              background: i === step ? '#0E7C7B' : i < step ? '#059669' : '#d1d5db',
              transition: 'background 0.2s',
            }} title={s.title} />
          ))}
        </div>

        <h3 style={{ textAlign: 'center', margin: '8px 0 16px', color: '#333', fontSize: 16 }}>
          Step {step + 1}: {currentStep.title}
        </h3>

        {error && <div className="auth-error">{error}</div>}

        <div className="auth-form">
          {isOtpStep ? (
            /* OTP Verification Step */
            <div style={{ textAlign: 'center', padding: '10px 0' }}>
              {otpVerified ? (
                <div>
                  <div style={{ fontSize: 40, color: '#059669', marginBottom: 8 }}>&#10003;</div>
                  <p style={{ color: '#059669', fontWeight: 600, fontSize: 15 }}>Email verified!</p>
                </div>
              ) : (
                <>
                  <p style={{ color: '#555', fontSize: 14, lineHeight: 1.6, marginBottom: 20 }}>
                    We've sent a 6-digit verification code to<br />
                    <strong>{formData.email}</strong>
                  </p>

                  {/* 6-digit OTP inputs */}
                  <div style={{ display: 'flex', justifyContent: 'center', gap: 8, marginBottom: 20 }}>
                    {otpDigits.map((digit, i) => (
                      <input
                        key={i}
                        ref={el => inputRefs.current[i] = el}
                        type="text"
                        inputMode="numeric"
                        maxLength={1}
                        value={digit}
                        onChange={(e) => handleOtpChange(i, e.target.value)}
                        onKeyDown={(e) => handleOtpKeyDown(i, e)}
                        onPaste={i === 0 ? handleOtpPaste : undefined}
                        style={{
                          width: 48, height: 56, textAlign: 'center', fontSize: 24,
                          fontWeight: 700, border: '2px solid #ddd', borderRadius: 10,
                          outline: 'none', transition: 'border-color 0.2s',
                        }}
                        onFocus={(e) => e.target.style.borderColor = '#0E7C7B'}
                        onBlur={(e) => e.target.style.borderColor = '#ddd'}
                      />
                    ))}
                  </div>

                  <button
                    type="button"
                    onClick={verifyOtp}
                    disabled={otpVerifying || otpDigits.join('').length !== 6}
                    className="auth-button"
                    style={{ marginBottom: 16 }}
                  >
                    {otpVerifying ? 'Verifying...' : 'Verify Code'}
                  </button>

                  <p style={{ color: '#888', fontSize: 13, marginTop: 8 }}>
                    Didn't receive the code?{' '}
                    {resendCooldown > 0 ? (
                      <span style={{ color: '#aaa' }}>Resend in {resendCooldown}s</span>
                    ) : (
                      <button
                        type="button"
                        onClick={() => { setOtpDigits(['', '', '', '', '', '']); sendOtp(); }}
                        disabled={otpSending}
                        style={{
                          background: 'none', border: 'none', color: '#0E7C7B',
                          fontWeight: 600, cursor: 'pointer', fontSize: 13, padding: 0,
                        }}
                      >
                        {otpSending ? 'Sending...' : 'Resend Code'}
                      </button>
                    )}
                  </p>
                </>
              )}

              <div style={{ marginTop: 20 }}>
                <button type="button" onClick={handleBack} className="auth-button" style={{ background: '#6b7280', width: '100%' }}>
                  Back
                </button>
              </div>
            </div>
          ) : (
            /* Regular form step */
            <>
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

              <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 16 }}>
                {isLastStep ? (
                  <button type="button" onClick={handleSubmit} disabled={loading} className="auth-button" style={{ width: '100%' }}>
                    {loading ? 'Submitting...' : 'Submit Registration'}
                  </button>
                ) : (
                  <button type="button" onClick={handleNext} className="auth-button" style={{ width: '100%' }}>
                    Next
                  </button>
                )}
                {step > 0 && (
                  <button type="button" onClick={handleBack} className="auth-button" style={{ background: '#6b7280', width: '100%' }}>
                    Back
                  </button>
                )}
              </div>
            </>
          )}
        </div>

        <p className="auth-switch">
          Already have an account? <Link to="/login">Sign In</Link>
        </p>
      </div>
    </div>
  );
}

export default CompanyRegister;
