const axios = require('axios');
require('dotenv').config();

const TENANT_ID = process.env.MS_TENANT_ID;
const CLIENT_ID = process.env.MS_CLIENT_ID;
const CLIENT_SECRET = process.env.MS_CLIENT_SECRET;
const FROM_EMAIL = process.env.MS_FROM_EMAIL || 'automaticmails@afsq.co.za';

let cachedToken = null;
let tokenExpiry = 0;

async function getAccessToken() {
  if (cachedToken && Date.now() < tokenExpiry) return cachedToken;

  const url = `https://login.microsoftonline.com/${TENANT_ID}/oauth2/v2.0/token`;
  const params = new URLSearchParams({
    client_id: CLIENT_ID,
    client_secret: CLIENT_SECRET,
    scope: 'https://graph.microsoft.com/.default',
    grant_type: 'client_credentials',
  });

  const res = await axios.post(url, params.toString(), {
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  });

  cachedToken = res.data.access_token;
  tokenExpiry = Date.now() + (res.data.expires_in - 60) * 1000;
  return cachedToken;
}

async function sendEmail({ to, cc, subject, html }) {
  const token = await getAccessToken();

  const message = {
    subject,
    body: { contentType: 'HTML', content: html },
    from: { emailAddress: { address: FROM_EMAIL } },
    toRecipients: [{ emailAddress: { address: to } }],
  };

  if (cc) {
    const ccAddresses = cc.split(',').map(e => e.trim()).filter(Boolean);
    message.ccRecipients = ccAddresses.map(addr => ({ emailAddress: { address: addr } }));
  }

  await axios.post(
    `https://graph.microsoft.com/v1.0/users/${FROM_EMAIL}/sendMail`,
    { message, saveToSentItems: true },
    { headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } }
  );

  return { status: 'sent', to, from: FROM_EMAIL };
}

function buildInviteEmail({ businessName, role, inviteUrl }) {
  return {
    subject: `You're invited to join EPVS - Egg Production Verification System`,
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
        <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 30px; border-radius: 12px 12px 0 0; text-align: center;">
          <h1 style="color: #fff; margin: 0; font-size: 28px;">EPVS</h1>
          <p style="color: rgba(255,255,255,0.85); margin: 8px 0 0; font-size: 14px;">Egg Production Verification System</p>
        </div>
        <div style="background: #fff; padding: 30px; border: 1px solid #e5e7eb; border-top: none; border-radius: 0 0 12px 12px;">
          <h2 style="color: #333; margin-top: 0;">You've Been Invited!</h2>
          <p style="color: #555; font-size: 15px; line-height: 1.6;">
            You have been invited to join the <strong>Egg Production Verification System</strong> as a
            <strong style="color: #4f46e5;">${role}</strong> for <strong>${businessName}</strong>.
          </p>
          ${role === 'Company Admin' ? `
          <div style="background: #fffbeb; border: 1px solid #fbbf24; border-radius: 8px; padding: 14px; margin: 16px 0;">
            <p style="margin: 0; color: #92400e; font-size: 14px;">
              <strong>As a Company Admin</strong>, you will be asked to verify and complete your business details after registration.
            </p>
          </div>
          ` : ''}
          <p style="color: #555; font-size: 15px; line-height: 1.6;">
            Click the button below to create your password and access the system:
          </p>
          <div style="text-align: center; margin: 30px 0;">
            <a href="${inviteUrl}" style="display: inline-block; background-color: #4f46e5; color: #ffffff; padding: 14px 40px; border-radius: 8px; text-decoration: none; font-size: 16px; font-weight: 600; mso-padding-alt: 0; text-align: center;">
              <!--[if mso]><i style="mso-font-width:150%;mso-text-raise:22pt">&nbsp;</i><![endif]-->
              Accept Invitation
              <!--[if mso]><i style="mso-font-width:150%">&nbsp;</i><![endif]-->
            </a>
          </div>
          <p style="color: #999; font-size: 12px; text-align: center;">
            If the button doesn't work, copy and paste this link into your browser:<br>
            <a href="${inviteUrl}" style="color: #667eea;">${inviteUrl}</a>
          </p>
        </div>
        <p style="color: #aaa; font-size: 11px; text-align: center; margin-top: 20px;">
          This invitation was sent by the EPVS administration team. If you did not expect this email, you can safely ignore it.
        </p>
      </div>
    `,
  };
}

/**
 * Send an email to each recipient individually and return per-recipient results.
 * @param {Object} opts - { recipients: string[], subject, html }
 * @returns {Promise<{ succeeded: string[], failed: string[] }>}
 */
async function sendEmailToEach({ recipients, subject, html }) {
  const succeeded = [];
  const failed = [];
  for (const email of recipients) {
    try {
      await sendEmail({ to: email, subject, html });
      succeeded.push(email);
    } catch (err) {
      console.error(`Email failed for ${email}:`, err.response?.data?.error?.message || err.message);
      failed.push(email);
    }
  }
  return { succeeded, failed };
}

module.exports = { sendEmail, sendEmailToEach, buildInviteEmail };
