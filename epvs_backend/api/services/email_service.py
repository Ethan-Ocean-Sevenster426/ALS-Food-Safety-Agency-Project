import time
import logging
import requests
from django.conf import settings

logger = logging.getLogger(__name__)

# Module-level token cache
_cached_token = None
_token_expiry = 0


def get_access_token():
    """
    Obtain an OAuth2 access token from Microsoft identity platform using
    client credentials flow.  Caches the token until ~60 seconds before expiry.
    """
    global _cached_token, _token_expiry

    if _cached_token and time.time() < _token_expiry:
        return _cached_token

    url = (
        f"https://login.microsoftonline.com/"
        f"{settings.MS_TENANT_ID}/oauth2/v2.0/token"
    )
    data = {
        'client_id': settings.MS_CLIENT_ID,
        'client_secret': settings.MS_CLIENT_SECRET,
        'scope': 'https://graph.microsoft.com/.default',
        'grant_type': 'client_credentials',
    }

    response = requests.post(
        url,
        data=data,
        headers={'Content-Type': 'application/x-www-form-urlencoded'},
        timeout=30,
    )
    response.raise_for_status()
    token_data = response.json()

    _cached_token = token_data['access_token']
    # Expire 60 seconds early to avoid edge-case failures
    _token_expiry = time.time() + (token_data['expires_in'] - 60)
    return _cached_token


def send_email(to, subject, html, cc=None):
    """
    Send a single email via Microsoft Graph API.

    Args:
        to:      Recipient email address (str).
        subject: Email subject line (str).
        html:    HTML body content (str).
        cc:      Optional comma-separated CC addresses (str or None).

    Returns:
        dict with 'status', 'to', and 'from' keys.
    """
    token = get_access_token()
    from_email = settings.MS_FROM_EMAIL

    message = {
        'subject': subject,
        'body': {'contentType': 'HTML', 'content': html},
        'from': {'emailAddress': {'address': from_email}},
        'toRecipients': [{'emailAddress': {'address': to}}],
    }

    if cc:
        cc_addresses = [addr.strip() for addr in cc.split(',') if addr.strip()]
        message['ccRecipients'] = [
            {'emailAddress': {'address': addr}} for addr in cc_addresses
        ]

    response = requests.post(
        f'https://graph.microsoft.com/v1.0/users/{from_email}/sendMail',
        json={'message': message, 'saveToSentItems': True},
        headers={
            'Authorization': f'Bearer {token}',
            'Content-Type': 'application/json',
        },
        timeout=30,
    )
    response.raise_for_status()

    return {'status': 'sent', 'to': to, 'from': from_email}


def send_email_to_each(recipients, subject, html):
    """
    Send the same email individually to each recipient and track results.

    Args:
        recipients: List of email address strings.
        subject:    Email subject line (str).
        html:       HTML body content (str).

    Returns:
        dict with 'succeeded' (list of str) and 'failed' (list of str).
    """
    succeeded = []
    failed = []

    for email in recipients:
        try:
            send_email(to=email, subject=subject, html=html)
            succeeded.append(email)
        except Exception as exc:
            logger.error("Email failed for %s: %s", email, exc)
            failed.append(email)

    return {'succeeded': succeeded, 'failed': failed}


def build_invite_email(business_name, role, invite_url):
    """
    Build the subject and HTML body for an EPVS invitation email.

    Returns:
        dict with 'subject' (str) and 'html' (str).
    """
    company_admin_notice = ''
    if role == 'Company Admin':
        company_admin_notice = (
            '<div style="background: #fffbeb; border: 1px solid #fbbf24; '
            'border-radius: 8px; padding: 14px; margin: 16px 0;">'
            '<p style="margin: 0; color: #92400e; font-size: 14px;">'
            '<strong>As a Company Admin</strong>, you will be asked to verify '
            'and complete your business details after registration.'
            '</p></div>'
        )

    html = (
        '<div style="font-family: Arial, sans-serif; max-width: 600px; '
        'margin: 0 auto; padding: 20px;">'
        '<div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); '
        'padding: 30px; border-radius: 12px 12px 0 0; text-align: center;">'
        '<h1 style="color: #fff; margin: 0; font-size: 28px;">EPVS</h1>'
        '<p style="color: rgba(255,255,255,0.85); margin: 8px 0 0; font-size: 14px;">'
        'Egg Production Verification System</p></div>'
        '<div style="background: #fff; padding: 30px; border: 1px solid #e5e7eb; '
        'border-top: none; border-radius: 0 0 12px 12px;">'
        '<h2 style="color: #333; margin-top: 0;">You\'ve Been Invited!</h2>'
        '<p style="color: #555; font-size: 15px; line-height: 1.6;">'
        'You have been invited to join the <strong>Egg Production Verification System'
        f'</strong> as a <strong style="color: #4f46e5;">{role}</strong> for '
        f'<strong>{business_name}</strong>.</p>'
        f'{company_admin_notice}'
        '<p style="color: #555; font-size: 15px; line-height: 1.6;">'
        'Click the button below to create your password and access the system:</p>'
        '<div style="text-align: center; margin: 30px 0;">'
        f'<a href="{invite_url}" style="display: inline-block; '
        'background-color: #4f46e5; color: #ffffff; padding: 14px 40px; '
        'border-radius: 8px; text-decoration: none; font-size: 16px; '
        'font-weight: 600; mso-padding-alt: 0; text-align: center;">'
        '<!--[if mso]><i style="mso-font-width:150%;mso-text-raise:22pt">'
        '&nbsp;</i><![endif]-->Accept Invitation'
        '<!--[if mso]><i style="mso-font-width:150%">&nbsp;</i><![endif]-->'
        '</a></div>'
        '<p style="color: #999; font-size: 12px; text-align: center;">'
        'If the button doesn\'t work, copy and paste this link into your browser:<br>'
        f'<a href="{invite_url}" style="color: #667eea;">{invite_url}</a></p>'
        '</div>'
        '<p style="color: #aaa; font-size: 11px; text-align: center; margin-top: 20px;">'
        'This invitation was sent by the EPVS administration team. '
        'If you did not expect this email, you can safely ignore it.</p></div>'
    )

    return {
        'subject': "You're invited to join EPVS - Egg Production Verification System",
        'html': html,
    }
