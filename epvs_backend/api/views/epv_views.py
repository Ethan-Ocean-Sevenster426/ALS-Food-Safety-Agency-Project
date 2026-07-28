import os
import re
import math
import secrets
import logging
from decimal import Decimal

from django.conf import settings
from django.utils import timezone
from django.http import FileResponse
from django.views.decorators.csrf import csrf_exempt
from django.db.models import (
    Q, F, Sum, Count, Case, When, Value, IntegerField, DecimalField,
    Subquery, OuterRef,
)
from django.db.models.functions import Coalesce
from rest_framework.decorators import api_view
from rest_framework.response import Response
from rest_framework import status

from api.models import (
    EggProductionVerification, EPVAuditLog, ClientRecord, User, EmailSendLog,
)
from api.services.helpers import (
    calculate_totals, log_company_audit, generate_reference_number, LEVY_RATE,
)
from api.services.email_service import send_email_to_each
from api.middleware import inspector_user_id

logger = logging.getLogger(__name__)


def _visit_window(year, start_month, end_month):
    """Aware [start, end) datetime range for a month window — range comparisons
    work on MySQL without timezone tables, unlike __year/__month lookups."""
    from datetime import datetime as _dt
    end_y, end_m = (year + 1, 1) if end_month >= 12 else (year, end_month + 1)
    return (
        timezone.make_aware(_dt(year, start_month, 1)),
        timezone.make_aware(_dt(end_y, end_m, 1)),
    )


def _inspector_company_block(request, client_record_id):
    """403 Response if the requester is an Inspector not assigned to this facility, else None."""
    insp_id = inspector_user_id(request)
    if not insp_id:
        return None
    assigned = ClientRecord.objects.filter(
        id=int(client_record_id), assigned_inspector_id=insp_id,
    ).exists()
    if assigned:
        return None
    return Response(
        {'message': 'You are not assigned to this facility.'},
        status=status.HTTP_403_FORBIDDEN,
    )

MONTH_NAMES = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December',
]


def _float_val(v):
    """Safely convert a value to float, defaulting to 0."""
    try:
        return float(v)
    except (TypeError, ValueError):
        return 0.0


def _int_val(v):
    """Safely convert a value to int, defaulting to 0."""
    try:
        return int(v)
    except (TypeError, ValueError):
        return 0


def _build_epv_email(business_name, month, year, form_url, opening_stock):
    """Build the HTML email for an EPV notification."""
    opening_stock_val = _float_val(opening_stock)
    opening_notice = ''
    if opening_stock_val > 0:
        opening_notice = (
            '<div style="background: #f0fdf4; border: 1px solid #bbf7d0; '
            'border-radius: 8px; padding: 14px; margin: 16px 0;">'
            '<p style="margin: 0; color: #15803d; font-size: 14px;">'
            f'<strong>Opening Stock:</strong> {opening_stock_val:,.0f} '
            '(carried over from previous month)</p></div>'
        )
    return (
        '<div style="font-family: Arial, sans-serif; max-width: 600px; '
        'margin: 0 auto; padding: 20px;">'
        '<div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); '
        'padding: 30px; border-radius: 12px 12px 0 0; text-align: center;">'
        '<h1 style="color: #fff; margin: 0; font-size: 28px;">EPVS</h1>'
        '<p style="color: rgba(255,255,255,0.85); margin: 8px 0 0; font-size: 14px;">'
        'Egg Production Verification System</p></div>'
        '<div style="background: #fff; padding: 30px; border: 1px solid #e5e7eb; '
        'border-top: none; border-radius: 0 0 12px 12px;">'
        '<h2 style="color: #333; margin-top: 0;">Egg Production Verification Due</h2>'
        '<p style="color: #555; font-size: 15px; line-height: 1.6;">'
        f'The monthly Egg Production Verification for <strong>{business_name}</strong> '
        f'is due for <strong style="color: #4f46e5;">{month} {year}</strong>.</p>'
        f'{opening_notice}'
        '<p style="color: #555; font-size: 15px; line-height: 1.6;">'
        'Please click the button below to complete the verification form:</p>'
        '<div style="text-align: center; margin: 30px 0;">'
        f'<a href="{form_url}" style="display: inline-block; background-color: #4f46e5; '
        'color: #ffffff; padding: 14px 40px; border-radius: 8px; text-decoration: none; '
        'font-size: 16px; font-weight: 600;">Complete Verification</a></div>'
        '<p style="color: #999; font-size: 12px; text-align: center;">'
        "If the button doesn't work, copy and paste this link into your browser:<br>"
        f'<a href="{form_url}" style="color: #667eea;">{form_url}</a></p></div>'
        '<p style="color: #aaa; font-size: 11px; text-align: center; margin-top: 20px;">'
        'This email was sent by the EPVS system. If you did not expect this email, '
        'please contact your administrator.</p></div>'
    )


def _get_prev_closing_stock(client_record_id, month, year):
    """Get previous month's closing stock for carry-over."""
    prev_month = 12 if month == 1 else month - 1
    prev_year = year - 1 if month == 1 else year
    try:
        prev_epv = EggProductionVerification.objects.get(
            client_record_id=client_record_id,
            period_month=prev_month,
            period_year=prev_year,
            status='Completed',
        )
        return float(prev_epv.closing_stock or 0)
    except EggProductionVerification.DoesNotExist:
        return 0
    except EggProductionVerification.MultipleObjectsReturned:
        prev_epv = EggProductionVerification.objects.filter(
            client_record_id=client_record_id,
            period_month=prev_month,
            period_year=prev_year,
            status='Completed',
        ).first()
        return float(prev_epv.closing_stock or 0) if prev_epv else 0


def _build_date_filter_q(params, field_prefix=''):
    """Build Q objects for year/month/quarter date filters."""
    cur_year = timezone.now().year
    cur_month = timezone.now().month
    filter_year = _int_val(params.get('year')) or None
    filter_month = _int_val(params.get('month')) or None
    filter_quarter = _int_val(params.get('quarter')) or None

    effective_year = filter_year or ((cur_year) if (filter_month or filter_quarter) else None)

    ym_field = f'{field_prefix}period_year' if field_prefix else 'period_year'
    mm_field = f'{field_prefix}period_month' if field_prefix else 'period_month'

    q = Q()
    if effective_year and filter_month:
        q = Q(**{ym_field: effective_year, mm_field: filter_month})
    elif effective_year and filter_quarter:
        qsm = (filter_quarter - 1) * 3 + 1
        q = Q(**{ym_field: effective_year, f'{mm_field}__gte': qsm, f'{mm_field}__lte': qsm + 2})
    elif effective_year:
        q = Q(**{ym_field: effective_year})
    return q


def _epv_audit_to_js(log):
    """Convert EPVAuditLog to JS-style dict."""
    return {
        'Id': log.id,
        'VerificationId': log.verification_id,
        'FieldName': log.field_name,
        'OldValue': log.old_value,
        'NewValue': log.new_value,
        'ChangedBy': log.changed_by,
        'ChangedAt': log.changed_at.isoformat() if log.changed_at else None,
    }


# ---------------------------------------------------------------------------
# A) POST /api/epv/send
# ---------------------------------------------------------------------------
@csrf_exempt
@api_view(['POST'])
def send_epv(request):
    """Send EPV for a specific client."""
    client_record_id = request.data.get('clientRecordId')
    sent_by = request.data.get('sentBy')
    user_role = request.data.get('userRole')

    if not client_record_id or not sent_by:
        return Response(
            {'message': 'clientRecordId and sentBy are required.'},
            status=status.HTTP_400_BAD_REQUEST,
        )

    try:
        try:
            client = ClientRecord.objects.get(id=int(client_record_id))
        except ClientRecord.DoesNotExist:
            return Response({'message': 'Client not found.'}, status=status.HTTP_404_NOT_FOUND)

        now = timezone.now()
        month = now.month
        year = now.year

        # Check if EPV already exists for this month
        existing = EggProductionVerification.objects.filter(
            client_record_id=int(client_record_id),
            period_month=month,
            period_year=year,
        ).filter(Q(epv_type='Client') | Q(epv_type__isnull=True)).first()

        if existing:
            return Response(
                {'message': f'An EPV for {year}-{str(month).zfill(2)} already exists ({existing.status}).'},
                status=status.HTTP_409_CONFLICT,
            )

        prev_closing_stock = _get_prev_closing_stock(int(client_record_id), month, year)
        token = secrets.token_hex(32)
        reference_number = generate_reference_number(month, year)

        EggProductionVerification.objects.create(
            client_record_id=int(client_record_id),
            period_month=month,
            period_year=year,
            token=token,
            reference_number=reference_number,
            status='Pending',
            business_name=client.business_name or '',
            facility_type=client.facility_type or '',
            email_address=client.email or '',
            authorized_person_name=client.abattoir_owner_name or '',
            opening_stock=prev_closing_stock,
        )

        # Collect all valid facility emails
        email_regex = re.compile(r'^[^\s@]+@[^\s@]+\.[^\s@]+$')
        raw_emails = [
            client.email, client.abattoir_owner_email,
            client.accounts_email, client.abattoir_manager_email,
            client.manual_email,
        ]
        all_emails = [e.strip() for e in raw_emails if e and e.strip() and email_regex.match(e.strip())]
        unique_emails = list(set(e.lower() for e in all_emails))

        form_url = f"https://egg-production-verification.fsa-pty.co.za/epv/{token}"
        month_name = MONTH_NAMES[month - 1]
        email_subject = f"EPVS - Egg Production Verification Due: {month_name} {year}"
        email_html = _build_epv_email(
            business_name=client.business_name,
            month=month_name,
            year=year,
            form_url=form_url,
            opening_stock=prev_closing_stock,
        )

        result = send_email_to_each(
            recipients=unique_emails,
            subject=email_subject,
            html=email_html,
        )

        # Log results to EmailSendLog
        for email_addr in result.get('succeeded', []):
            EmailSendLog.objects.create(
                client_record_id=int(client_record_id),
                email_address=email_addr,
                email_type='EPV',
                subject=email_subject,
                status='Sent',
                sent_by=sent_by,
            )
        for email_addr in result.get('failed', []):
            EmailSendLog.objects.create(
                client_record_id=int(client_record_id),
                email_address=email_addr,
                email_type='EPV',
                subject=email_subject,
                status='Failed',
                sent_by=sent_by,
            )

        if len(result.get('succeeded', [])) == 0:
            return Response(
                {'message': 'All emails failed to send.'},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR,
            )

        # Mark client as "On EPV Cycle"
        client.epv_cycle_status = 'On EPV Cycle'
        client.save()

        log_company_audit(
            int(client_record_id),
            'EPV Sent',
            None,
            f'{reference_number} for {month_name} {year}',
            sent_by,
            user_role,
        )

        return Response({'message': f'EPV sent to {client.email} for {month_name} {year}.'})

    except Exception as e:
        logger.error('EPV send error: %s', e)
        return Response(
            {'message': 'Failed to send EPV.'},
            status=status.HTTP_500_INTERNAL_SERVER_ERROR,
        )


# ---------------------------------------------------------------------------
# B) POST /api/epv/create-manual
# ---------------------------------------------------------------------------
@csrf_exempt
@api_view(['POST'])
def create_manual_epv(request):
    """Company Admin creates EPV for a specific month."""
    client_record_id = request.data.get('clientRecordId')
    period_month = request.data.get('periodMonth')
    period_year = request.data.get('periodYear')
    created_by = request.data.get('createdBy')

    if not client_record_id or not period_month or not period_year or not created_by:
        return Response(
            {'message': 'clientRecordId, periodMonth, periodYear, and createdBy are required.'},
            status=status.HTTP_400_BAD_REQUEST,
        )

    month = int(period_month)
    year = int(period_year)

    if month < 1 or month > 12:
        return Response({'message': 'Invalid month.'}, status=status.HTTP_400_BAD_REQUEST)

    now = timezone.now()
    current_month = now.month
    current_year = now.year
    if year > current_year or (year == current_year and month > current_month):
        return Response(
            {'message': 'Cannot create a verification for a future month.'},
            status=status.HTTP_400_BAD_REQUEST,
        )

    try:
        # Check duplicate
        existing = EggProductionVerification.objects.filter(
            client_record_id=int(client_record_id),
            period_month=month,
            period_year=year,
        ).filter(Q(epv_type='Client') | Q(epv_type__isnull=True)).first()

        if existing:
            month_name = MONTH_NAMES[month - 1]
            return Response(
                {'message': f'A verification for {month_name} {year} already exists ({existing.status}). Only one verification per month is allowed.'},
                status=status.HTTP_409_CONFLICT,
            )

        try:
            client = ClientRecord.objects.get(id=int(client_record_id))
        except ClientRecord.DoesNotExist:
            return Response({'message': 'Client not found.'}, status=status.HTTP_404_NOT_FOUND)

        prev_closing_stock = _get_prev_closing_stock(int(client_record_id), month, year)
        token = secrets.token_hex(32)
        reference_number = generate_reference_number(month, year)

        EggProductionVerification.objects.create(
            client_record_id=int(client_record_id),
            period_month=month,
            period_year=year,
            token=token,
            reference_number=reference_number,
            status='Pending',
            business_name=client.business_name or '',
            facility_type=client.facility_type or '',
            email_address=client.email or '',
            authorized_person_name=client.abattoir_owner_name or '',
            opening_stock=prev_closing_stock,
        )

        return Response({'message': 'Verification created.', 'token': token})

    except Exception as e:
        logger.error('EPV create-manual error: %s', e)
        return Response(
            {'message': 'Failed to create verification.'},
            status=status.HTTP_500_INTERNAL_SERVER_ERROR,
        )


# ---------------------------------------------------------------------------
# C) GET /api/epv/token/:token
# ---------------------------------------------------------------------------
@csrf_exempt
@api_view(['GET'])
def get_epv_by_token(request, token):
    """Get EPV form by token - public endpoint for email link."""
    try:
        try:
            epv = EggProductionVerification.objects.get(token=token)
        except EggProductionVerification.DoesNotExist:
            return Response(
                {'message': 'Verification form not found.'},
                status=status.HTTP_404_NOT_FOUND,
            )

        data = epv.to_js_dict()

        # Join with ClientRecord for additional fields
        try:
            client = ClientRecord.objects.get(id=epv.client_record_id)
            data['AccountCode'] = client.account_code
            data['Town'] = client.town
            data['PhysicalAddress'] = client.physical_address
            data['AbattoirOwnerName'] = client.abattoir_owner_name
            data['AbattoirOwnerCell'] = client.abattoir_owner_cell
            data['AbattoirOwnerEmail'] = client.abattoir_owner_email
            data['AccountsContactName'] = client.accounts_contact_name
            data['AccountsTelephone'] = client.accounts_telephone
            data['AccountsEmail'] = client.accounts_email
            data['AbattoirManagerName'] = client.abattoir_manager_name
            data['AbattoirManagerCell'] = client.abattoir_manager_cell
            data['AbattoirManagerEmail'] = client.abattoir_manager_email
        except ClientRecord.DoesNotExist:
            pass

        return Response({'verification': data})

    except Exception as e:
        logger.error('EPV fetch error: %s', e)
        return Response({'message': 'Server error.'}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)


# ---------------------------------------------------------------------------
# D) PUT /api/epv/token/:token/submit
# ---------------------------------------------------------------------------
@csrf_exempt
@api_view(['PUT'])
def submit_epv_by_token(request, token):
    """Submit/complete EPV form."""
    data = request.data.get('data')
    completed_by = request.data.get('completedBy')

    if not data or not completed_by:
        return Response(
            {'message': 'data and completedBy are required.'},
            status=status.HTTP_400_BAD_REQUEST,
        )

    try:
        try:
            epv = EggProductionVerification.objects.get(token=token)
        except EggProductionVerification.DoesNotExist:
            return Response(
                {'message': 'Verification form not found.'},
                status=status.HTTP_404_NOT_FOUND,
            )

        if epv.status == 'Completed':
            return Response(
                {'message': 'This verification has already been submitted. If you need to make changes, please log a support ticket.'},
                status=status.HTTP_409_CONFLICT,
            )

        totals = calculate_totals(data)

        # Update text fields
        for js_name, django_name in EggProductionVerification.TEXT_FIELD_MAP.items():
            setattr(epv, django_name, data.get(js_name, '') or '')

        # Update numeric fields
        for js_name, django_name in EggProductionVerification.NUMERIC_FIELD_MAP.items():
            setattr(epv, django_name, _float_val(data.get(js_name, 0)))

        # Update calculated totals
        epv.total_b = totals['TotalB']
        epv.total_c = totals['TotalC']
        epv.total_d = totals['TotalD']
        epv.total_e = totals['TotalE']
        epv.levy_amount = totals['LevyAmount']
        epv.closing_stock = totals['ClosingStock']
        epv.actual_closing_stock = totals['ActualClosingStock']
        epv.loss_gain = totals['LossGain']

        epv.status = 'Completed'
        epv.completed_at = timezone.now()
        epv.completed_by = completed_by
        epv.save()

        # Audit log
        EPVAuditLog.objects.create(
            verification_id=epv.id,
            field_name='_SUBMITTED',
            new_value=f'Form submitted by {completed_by}',
            changed_by=completed_by,
        )

        return Response({'message': 'Verification submitted successfully.', 'totals': totals})

    except Exception as e:
        logger.error('EPV submit error: %s', e)
        return Response(
            {'message': 'Failed to submit verification.'},
            status=status.HTTP_500_INTERNAL_SERVER_ERROR,
        )


# ---------------------------------------------------------------------------
# E) PUT /api/epv/:id/edit
# ---------------------------------------------------------------------------
@csrf_exempt
@api_view(['PUT'])
def edit_epv(request, id):
    """Edit a completed EPV with audit trail."""
    data = request.data.get('data')
    edited_by = request.data.get('editedBy')

    if not data or not edited_by:
        return Response(
            {'message': 'data and editedBy are required.'},
            status=status.HTTP_400_BAD_REQUEST,
        )

    try:
        try:
            epv = EggProductionVerification.objects.get(id=int(id))
        except EggProductionVerification.DoesNotExist:
            return Response(
                {'message': 'Verification not found.'},
                status=status.HTTP_404_NOT_FOUND,
            )

        totals = calculate_totals(data)

        # Build audit entries by comparing old vs new
        audit_entries = []
        all_field_map = {}
        all_field_map.update(EggProductionVerification.TEXT_FIELD_MAP)
        all_field_map.update(EggProductionVerification.NUMERIC_FIELD_MAP)

        for js_name, django_name in all_field_map.items():
            old_val = str(getattr(epv, django_name, '') or '')
            new_val = str(data.get(js_name, '') or '')
            if old_val != new_val:
                audit_entries.append({
                    'field': js_name,
                    'old_value': old_val,
                    'new_value': new_val,
                })

        # Check calculated fields
        calc_fields = {
            'TotalB': totals['TotalB'],
            'TotalC': totals['TotalC'],
            'TotalD': totals['TotalD'],
            'LevyAmount': totals['LevyAmount'],
            'ClosingStock': totals['ClosingStock'],
        }
        calc_django_map = {
            'TotalB': 'total_b',
            'TotalC': 'total_c',
            'TotalD': 'total_d',
            'LevyAmount': 'levy_amount',
            'ClosingStock': 'closing_stock',
        }
        for field, new_val in calc_fields.items():
            old_val = str(getattr(epv, calc_django_map[field], '') or '')
            if old_val != str(new_val):
                audit_entries.append({
                    'field': field,
                    'old_value': old_val,
                    'new_value': str(new_val),
                })

        if not audit_entries:
            return Response({'message': 'No changes detected.'})

        # Update text fields
        for js_name, django_name in EggProductionVerification.TEXT_FIELD_MAP.items():
            setattr(epv, django_name, data.get(js_name, '') or '')

        # Update numeric fields
        for js_name, django_name in EggProductionVerification.NUMERIC_FIELD_MAP.items():
            setattr(epv, django_name, _float_val(data.get(js_name, 0)))

        # Update calculated totals
        epv.total_b = totals['TotalB']
        epv.total_c = totals['TotalC']
        epv.total_d = totals['TotalD']
        epv.total_e = totals['TotalE']
        epv.levy_amount = totals['LevyAmount']
        epv.closing_stock = totals['ClosingStock']
        epv.actual_closing_stock = totals['ActualClosingStock']
        epv.loss_gain = totals['LossGain']
        epv.save()

        # Log all audit entries
        for entry in audit_entries:
            EPVAuditLog.objects.create(
                verification_id=int(id),
                field_name=entry['field'],
                old_value=entry['old_value'],
                new_value=entry['new_value'],
                changed_by=edited_by,
            )

        return Response({
            'message': f'{len(audit_entries)} field(s) updated.',
            'totals': totals,
        })

    except Exception as e:
        logger.error('EPV edit error: %s', e)
        return Response(
            {'message': 'Failed to update verification.'},
            status=status.HTTP_500_INTERNAL_SERVER_ERROR,
        )


# ---------------------------------------------------------------------------
# F) GET /api/epv/company/:clientRecordId
# ---------------------------------------------------------------------------
@csrf_exempt
@api_view(['GET'])
def list_company_epvs(request, client_record_id):
    """List all EPVs for a company (Client type only) with inspector EPV map."""
    blocked = _inspector_company_block(request, client_record_id)
    if blocked:
        return blocked
    try:
        client_epvs = EggProductionVerification.objects.filter(
            client_record_id=int(client_record_id),
        ).filter(
            Q(epv_type='Client') | Q(epv_type__isnull=True),
        ).order_by('-period_year', '-period_month')

        # Get inspector EPVs linked to this company
        inspector_epvs = EggProductionVerification.objects.filter(
            client_record_id=int(client_record_id),
            epv_type='Inspector',
        ).select_related()

        # Build map of inspector EPVs by LinkedEPVId
        inspector_map = {}
        for ie in inspector_epvs:
            ie_dict = ie.to_js_dict()
            # Get inspector name
            try:
                inspector_user = User.objects.get(id=ie.inspector_id)
                ie_dict['InspectorFirstName'] = inspector_user.first_name
                ie_dict['InspectorLastName'] = inspector_user.last_name
            except (User.DoesNotExist, TypeError):
                ie_dict['InspectorFirstName'] = None
                ie_dict['InspectorLastName'] = None
            inspector_map[ie.linked_epv_id] = ie_dict

        verifications = []
        for ce in client_epvs:
            v = ce.to_js_dict()
            v['inspectorEPV'] = inspector_map.get(ce.id, None)
            verifications.append(v)

        return Response({'verifications': verifications})

    except Exception as e:
        logger.error('EPV list error: %s', e)
        return Response({'message': 'Server error.'}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)


# ---------------------------------------------------------------------------
# G) GET /api/epv/:id
# ---------------------------------------------------------------------------
@csrf_exempt
@api_view(['GET'])
def get_epv_by_id(request, id):
    """Get a single EPV by ID."""
    try:
        try:
            epv = EggProductionVerification.objects.get(id=int(id))
        except EggProductionVerification.DoesNotExist:
            return Response(
                {'message': 'Verification not found.'},
                status=status.HTTP_404_NOT_FOUND,
            )
        return Response({'verification': epv.to_js_dict()})

    except Exception as e:
        logger.error('EPV fetch error: %s', e)
        return Response({'message': 'Server error.'}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)


# ---------------------------------------------------------------------------
# H) GET /api/epv/:id/audit-log
# ---------------------------------------------------------------------------
@csrf_exempt
@api_view(['GET'])
def get_epv_audit_log(request, id):
    """Get audit log for a specific EPV."""
    try:
        logs = EPVAuditLog.objects.filter(
            verification_id=int(id),
        ).order_by('-changed_at')

        return Response({'auditLog': [_epv_audit_to_js(log) for log in logs]})

    except Exception as e:
        logger.error('EPV audit log error: %s', e)
        return Response({'message': 'Server error.'}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)


# ---------------------------------------------------------------------------
# I) POST /api/epv/:id/upload-pop
# ---------------------------------------------------------------------------
@csrf_exempt
@api_view(['POST'])
def upload_pop(request, id):
    """Upload Proof of Payment file."""
    uploaded_by = request.data.get('uploadedBy', 'Unknown')
    user_role = request.data.get('userRole')

    pop_file = request.FILES.get('pop')
    if not pop_file:
        return Response({'message': 'No file uploaded.'}, status=status.HTTP_400_BAD_REQUEST)

    # Validate file extension
    ext = os.path.splitext(pop_file.name)[1].lower()
    if ext not in ('.pdf', '.png', '.jpg', '.jpeg'):
        return Response(
            {'message': 'Only PDF, PNG, and JPG files are allowed.'},
            status=status.HTTP_400_BAD_REQUEST,
        )

    try:
        try:
            epv = EggProductionVerification.objects.get(id=int(id))
        except EggProductionVerification.DoesNotExist:
            return Response(
                {'message': 'Verification not found.'},
                status=status.HTTP_404_NOT_FOUND,
            )

        if epv.is_reconciled:
            return Response(
                {'message': 'This EPV has already been reconciled. Cannot upload a new POP.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        # Save file
        import time
        timestamp = int(time.time() * 1000)
        filename = f"pop-{id}-{timestamp}{ext}"
        upload_dir = os.path.join(settings.MEDIA_ROOT, 'pop')
        os.makedirs(upload_dir, exist_ok=True)
        file_path = os.path.join(upload_dir, filename)

        with open(file_path, 'wb+') as dest:
            for chunk in pop_file.chunks():
                dest.write(chunk)

        epv.pop_file_path = filename
        epv.pop_uploaded_at = timezone.now()
        epv.pop_uploaded_by = uploaded_by
        epv.client_payment_status = 'Paid'
        epv.save()

        log_company_audit(
            epv.client_record_id,
            'POP Uploaded',
            None,
            f'{epv.reference_number or "EPV"} - {filename}',
            uploaded_by,
            user_role,
        )

        return Response({'message': 'Proof of Payment uploaded successfully.', 'filename': filename})

    except Exception as e:
        logger.error('POP upload error: %s', e)
        return Response(
            {'message': 'Failed to upload POP.'},
            status=status.HTTP_500_INTERNAL_SERVER_ERROR,
        )


# ---------------------------------------------------------------------------
# J) GET /api/epv/:id/pop
# ---------------------------------------------------------------------------
@csrf_exempt
@api_view(['GET'])
def serve_pop(request, id):
    """Serve POP file."""
    try:
        try:
            epv = EggProductionVerification.objects.get(id=int(id))
        except EggProductionVerification.DoesNotExist:
            return Response(
                {'message': 'Verification not found.'},
                status=status.HTTP_404_NOT_FOUND,
            )

        if not epv.pop_file_path:
            return Response(
                {'message': 'No POP file found.'},
                status=status.HTTP_404_NOT_FOUND,
            )

        file_path = os.path.join(settings.MEDIA_ROOT, 'pop', epv.pop_file_path)
        if not os.path.exists(file_path):
            return Response(
                {'message': 'No POP file found.'},
                status=status.HTTP_404_NOT_FOUND,
            )

        return FileResponse(open(file_path, 'rb'))

    except Exception as e:
        logger.error('POP serve error: %s', e)
        return Response(
            {'message': 'Failed to retrieve POP.'},
            status=status.HTTP_500_INTERNAL_SERVER_ERROR,
        )


# ---------------------------------------------------------------------------
# K) DELETE /api/epv/:id/pop
# ---------------------------------------------------------------------------
@csrf_exempt
@api_view(['DELETE'])
def delete_pop(request, id):
    """Delete POP file from disk and DB."""
    try:
        try:
            epv = EggProductionVerification.objects.get(id=int(id))
        except EggProductionVerification.DoesNotExist:
            return Response(
                {'message': 'Verification not found.'},
                status=status.HTTP_404_NOT_FOUND,
            )

        if not epv.pop_file_path:
            return Response(
                {'message': 'No POP file to delete.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        # Delete file from disk
        file_path = os.path.join(settings.MEDIA_ROOT, 'pop', epv.pop_file_path)
        try:
            os.unlink(file_path)
        except OSError:
            pass  # file may already be gone

        deleted_by = request.data.get('deletedBy', 'Unknown')
        user_role = request.data.get('userRole')
        old_filename = epv.pop_file_path

        # Clear POP and reconcile fields
        epv.pop_file_path = None
        epv.pop_uploaded_at = None
        epv.pop_uploaded_by = None
        epv.is_reconciled = False
        epv.reconciled_by = None
        epv.reconciled_at = None
        epv.client_payment_status = 'Not Paid'
        epv.save()

        log_company_audit(
            epv.client_record_id,
            'POP Deleted',
            old_filename,
            None,
            deleted_by,
            user_role,
        )

        return Response({'message': 'POP deleted successfully.'})

    except Exception as e:
        logger.error('POP delete error: %s', e)
        return Response(
            {'message': 'Failed to delete POP.'},
            status=status.HTTP_500_INTERNAL_SERVER_ERROR,
        )


# ---------------------------------------------------------------------------
# L) PUT /api/epv/:id/reconcile
# ---------------------------------------------------------------------------
@csrf_exempt
@api_view(['PUT'])
def toggle_reconcile(request, id):
    """Toggle reconciled status."""
    reconciled = request.data.get('reconciled')
    reconciled_by = request.data.get('reconciledBy')
    user_role = request.data.get('userRole', '')

    try:
        try:
            epv = EggProductionVerification.objects.get(id=int(id))
        except EggProductionVerification.DoesNotExist:
            return Response(
                {'message': 'Verification not found.'},
                status=status.HTTP_404_NOT_FOUND,
            )

        is_admin_role = user_role in ('Super Admin', 'Admin')
        if reconciled and not epv.pop_file_path and not is_admin_role:
            return Response(
                {'message': 'Cannot reconcile without a Proof of Payment uploaded.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        epv.is_reconciled = bool(reconciled)
        if reconciled:
            epv.reconciled_by = reconciled_by or 'Unknown'
            epv.reconciled_at = timezone.now()
        else:
            epv.reconciled_by = None
            epv.reconciled_at = None
        epv.save()

        log_company_audit(
            epv.client_record_id,
            'Reconciled',
            str(bool(not reconciled)),
            str(bool(reconciled)),
            reconciled_by,
            user_role,
        )

        msg = 'EPV marked as reconciled.' if reconciled else 'Reconciliation removed.'
        return Response({'message': msg})

    except Exception as e:
        logger.error('Reconcile error: %s', e)
        return Response(
            {'message': 'Failed to update reconciliation.'},
            status=status.HTTP_500_INTERNAL_SERVER_ERROR,
        )


# ---------------------------------------------------------------------------
# M) PUT /api/epv/:id/verify
# ---------------------------------------------------------------------------
@csrf_exempt
@api_view(['PUT'])
def toggle_verify(request, id):
    """Toggle verified status."""
    verified = request.data.get('verified')
    verified_by = request.data.get('verifiedBy')
    user_role = request.data.get('userRole')

    try:
        try:
            epv = EggProductionVerification.objects.get(id=int(id))
        except EggProductionVerification.DoesNotExist:
            return Response(
                {'message': 'Verification not found.'},
                status=status.HTTP_404_NOT_FOUND,
            )

        if verified and epv.status != 'Completed':
            return Response(
                {'message': 'Cannot verify an incomplete EPV.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        epv.is_verified = bool(verified)
        if verified:
            epv.verified_by = verified_by or 'Unknown'
            epv.verified_at = timezone.now()
        else:
            epv.verified_by = None
            epv.verified_at = None
        epv.save()

        old_val = 'Approved' if (not verified and epv.is_verified) else 'Not Verified'
        new_val = 'Inspector Approved' if verified else 'Verification Removed'
        log_company_audit(
            epv.client_record_id,
            'Verified',
            old_val,
            new_val,
            verified_by,
            user_role,
        )

        msg = 'EPV marked as verified.' if verified else 'Verification removed.'
        return Response({'message': msg})

    except Exception as e:
        logger.error('Verify error: %s', e)
        return Response(
            {'message': 'Failed to update verification.', 'error': str(e)},
            status=status.HTTP_500_INTERNAL_SERVER_ERROR,
        )


# ---------------------------------------------------------------------------
# N) PUT /api/epv/:id/manual-inspection
# ---------------------------------------------------------------------------
@csrf_exempt
@api_view(['PUT'])
def toggle_manual_inspection(request, id):
    """Toggle manual inspection checkbox."""
    checked = request.data.get('checked')
    changed_by = request.data.get('changedBy')
    user_role = request.data.get('userRole')

    try:
        try:
            epv = EggProductionVerification.objects.get(id=int(id))
        except EggProductionVerification.DoesNotExist:
            return Response(
                {'message': 'Verification not found.'},
                status=status.HTTP_404_NOT_FOUND,
            )

        old_val = 'Yes' if epv.manual_inspection else 'No'
        epv.manual_inspection = bool(checked)
        if checked:
            epv.manual_inspection_by = changed_by or 'Unknown'
            epv.manual_inspection_at = timezone.now()
        else:
            epv.manual_inspection_by = None
            epv.manual_inspection_at = None
        epv.save()

        log_company_audit(
            epv.client_record_id,
            'Manual Inspection',
            old_val,
            'Yes' if checked else 'No',
            changed_by,
            user_role,
        )

        msg = 'Manual inspection marked.' if checked else 'Manual inspection removed.'
        return Response({'message': msg})

    except Exception as e:
        logger.error('Manual inspection error: %s', e)
        return Response(
            {'message': 'Failed to update manual inspection.', 'error': str(e)},
            status=status.HTTP_500_INTERNAL_SERVER_ERROR,
        )


# ---------------------------------------------------------------------------
# O) PUT /api/epv/:id/reconciled-amount
# ---------------------------------------------------------------------------
@csrf_exempt
@api_view(['PUT'])
def save_reconciled_amount(request, id):
    """Save reconciled amount with audit."""
    amount = request.data.get('amount')
    changed_by = request.data.get('changedBy', 'Unknown')
    user_role = request.data.get('userRole')

    try:
        try:
            epv = EggProductionVerification.objects.get(id=int(id))
        except EggProductionVerification.DoesNotExist:
            return Response(
                {'message': 'Verification not found.'},
                status=status.HTTP_404_NOT_FOUND,
            )

        old_amount = epv.reconciled_amount
        new_amount = float(amount) if amount is not None and amount != '' else None

        epv.reconciled_amount = new_amount
        epv.save()

        log_company_audit(
            epv.client_record_id,
            'Reconciled Amount',
            f'R {old_amount}' if old_amount is not None else None,
            f'R {new_amount}' if new_amount is not None else None,
            changed_by,
            user_role,
        )

        return Response({'message': 'Reconciled amount saved.'})

    except Exception as e:
        logger.error('Reconciled amount error: %s', e)
        return Response(
            {'message': 'Failed to save reconciled amount.'},
            status=status.HTTP_500_INTERNAL_SERVER_ERROR,
        )


# ---------------------------------------------------------------------------
# P) PUT /api/epv/:id/comment
# ---------------------------------------------------------------------------
@csrf_exempt
@api_view(['PUT'])
def save_comment(request, id):
    """Save inspector comment with audit."""
    comment = request.data.get('comment')
    comment_by = request.data.get('commentBy', 'Unknown')
    user_role = request.data.get('userRole')

    try:
        try:
            epv = EggProductionVerification.objects.get(id=int(id))
        except EggProductionVerification.DoesNotExist:
            return Response(
                {'message': 'Verification not found.'},
                status=status.HTTP_404_NOT_FOUND,
            )

        old_comment = epv.inspector_comment
        epv.inspector_comment = comment or None
        epv.save()

        log_company_audit(
            epv.client_record_id,
            'Inspector Comment',
            old_comment or None,
            comment or None,
            comment_by,
            user_role,
        )

        return Response({'message': 'Comment saved.'})

    except Exception as e:
        logger.error('Comment error: %s', e)
        return Response(
            {'message': 'Failed to save comment.'},
            status=status.HTTP_500_INTERNAL_SERVER_ERROR,
        )


# ---------------------------------------------------------------------------
# Q) PUT /api/epv/:id/pop-comment
# ---------------------------------------------------------------------------
@csrf_exempt
@api_view(['PUT'])
def save_pop_comment(request, id):
    """Save POP comment with audit."""
    comment = request.data.get('comment')
    comment_by = request.data.get('commentBy', 'Unknown')
    user_role = request.data.get('userRole')

    try:
        try:
            epv = EggProductionVerification.objects.get(id=int(id))
        except EggProductionVerification.DoesNotExist:
            return Response(
                {'message': 'Verification not found.'},
                status=status.HTTP_404_NOT_FOUND,
            )

        old_comment = epv.pop_comment
        epv.pop_comment = comment or None
        epv.save()

        log_company_audit(
            epv.client_record_id,
            'POP Comment',
            old_comment or None,
            comment or None,
            comment_by,
            user_role,
        )

        return Response({'message': 'POP comment saved.'})

    except Exception as e:
        logger.error('POP comment error: %s', e)
        return Response(
            {'message': 'Failed to save POP comment.'},
            status=status.HTTP_500_INTERNAL_SERVER_ERROR,
        )


# ---------------------------------------------------------------------------
# R) PUT /api/epv/:id/payment-status
# ---------------------------------------------------------------------------
@csrf_exempt
@api_view(['PUT'])
def update_payment_status(request, id):
    """Update client payment status with audit."""
    new_status = request.data.get('status')
    changed_by = request.data.get('changedBy', 'Unknown')
    user_role = request.data.get('userRole')

    try:
        try:
            epv = EggProductionVerification.objects.get(id=int(id))
        except EggProductionVerification.DoesNotExist:
            return Response(
                {'message': 'Verification not found.'},
                status=status.HTTP_404_NOT_FOUND,
            )

        old_status = epv.client_payment_status
        epv.client_payment_status = new_status or None
        epv.save()

        log_company_audit(
            epv.client_record_id,
            'Client Payment Status',
            old_status or None,
            new_status or None,
            changed_by,
            user_role,
        )

        return Response({'message': 'Payment status updated.'})

    except Exception as e:
        logger.error('Payment status error: %s', e)
        return Response(
            {'message': 'Failed to update payment status.'},
            status=status.HTTP_500_INTERNAL_SERVER_ERROR,
        )


# ---------------------------------------------------------------------------
# S) DELETE /api/epv/inspector/:id
# ---------------------------------------------------------------------------
@csrf_exempt
@api_view(['DELETE'])
def delete_inspector_epv(request, id):
    """Delete an Inspector EPV (must be EPVType='Inspector')."""
    try:
        try:
            epv = EggProductionVerification.objects.get(id=int(id))
        except EggProductionVerification.DoesNotExist:
            return Response(
                {'message': 'Inspector EPV not found.'},
                status=status.HTTP_404_NOT_FOUND,
            )

        if epv.epv_type != 'Inspector':
            return Response(
                {'message': 'Can only delete Inspector EPVs.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        client_record_id = epv.client_record_id
        ref_number = epv.reference_number
        deleted_by = request.data.get('deletedBy', 'Unknown')
        user_role = request.data.get('userRole')

        # Delete audit log entries first
        EPVAuditLog.objects.filter(verification_id=int(id)).delete()

        # Delete the inspector EPV
        epv.delete()

        log_company_audit(
            client_record_id,
            'Inspector EPV Deleted',
            ref_number or f'EPV #{id}',
            None,
            deleted_by,
            user_role,
        )

        return Response({'message': 'Inspector EPV deleted.'})

    except Exception as e:
        logger.error('Inspector EPV delete error: %s', e)
        return Response(
            {'message': 'Failed to delete Inspector EPV.'},
            status=status.HTTP_500_INTERNAL_SERVER_ERROR,
        )


# ---------------------------------------------------------------------------
# T) POST /api/epv/inspector/create
# ---------------------------------------------------------------------------
@csrf_exempt
@api_view(['POST'])
def create_inspector_epv(request):
    """Create an Inspector EPV linked to a Client EPV."""
    client_epv_id = request.data.get('clientEpvId')
    inspector_id = request.data.get('inspectorId')
    inspector_name = request.data.get('inspectorName')
    user_role = request.data.get('userRole')

    if not client_epv_id or not inspector_id:
        return Response(
            {'message': 'clientEpvId and inspectorId are required.'},
            status=status.HTTP_400_BAD_REQUEST,
        )

    try:
        try:
            client_epv = EggProductionVerification.objects.get(id=int(client_epv_id))
        except EggProductionVerification.DoesNotExist:
            return Response(
                {'message': 'Client EPV not found.'},
                status=status.HTTP_404_NOT_FOUND,
            )

        # Check if Inspector EPV already exists
        existing = EggProductionVerification.objects.filter(
            linked_epv_id=int(client_epv_id),
            inspector_id=int(inspector_id),
            epv_type='Inspector',
        ).exists()

        if existing:
            return Response(
                {'message': 'An Inspector EPV already exists for this verification.'},
                status=status.HTTP_409_CONFLICT,
            )

        token = secrets.token_hex(32)
        ref_number = generate_reference_number(
            client_epv.period_month, client_epv.period_year,
        )

        # Create Inspector EPV pre-populated with facility figures
        EggProductionVerification.objects.create(
            client_record_id=client_epv.client_record_id,
            period_month=client_epv.period_month,
            period_year=client_epv.period_year,
            token=token,
            reference_number=ref_number,
            status='Pending',
            business_name=client_epv.business_name or '',
            facility_type=client_epv.facility_type or '',
            facility_province=client_epv.facility_province or '',
            email_address=client_epv.email_address or '',
            authorized_person_name=client_epv.authorized_person_name or '',
            trading_name=client_epv.trading_name or '',
            position_in_company=client_epv.position_in_company or '',
            telephone_number=client_epv.telephone_number or '',
            cell_phone_number=client_epv.cell_phone_number or '',
            opening_stock=_float_val(client_epv.opening_stock),
            graded_eggs_purchased=_float_val(client_epv.graded_eggs_purchased),
            ungraded_eggs_purchased=_float_val(client_epv.ungraded_eggs_purchased),
            market_returns=_float_val(client_epv.market_returns),
            machine_loss=_float_val(client_epv.machine_loss),
            sent_to_pulp=_float_val(client_epv.sent_to_pulp),
            destroyed=_float_val(client_epv.destroyed),
            sold_to_trade=_float_val(client_epv.sold_to_trade),
            sold_to_staff=_float_val(client_epv.sold_to_staff),
            sold_through_farm_stall=_float_val(client_epv.sold_through_farm_stall),
            transferred_to_other_producers=_float_val(client_epv.transferred_to_other_producers),
            actual_closing_stock=_float_val(client_epv.actual_closing_stock),
            pulp_opening_stock=_float_val(client_epv.pulp_opening_stock),
            pulp_purchased=_float_val(client_epv.pulp_purchased),
            pulp_converted=_float_val(client_epv.pulp_converted),
            pulp_sold_to_trade=_float_val(client_epv.pulp_sold_to_trade),
            pulp_sold_to_producers=_float_val(client_epv.pulp_sold_to_producers),
            variance_reason=client_epv.variance_reason or '',
            levy_amount=_float_val(client_epv.levy_amount),
            epv_type='Inspector',
            inspector_id=int(inspector_id),
            linked_epv_id=int(client_epv_id),
        )

        log_company_audit(
            client_epv.client_record_id,
            'Inspector EPV Created',
            None,
            ref_number,
            inspector_name or 'Unknown',
            user_role,
        )

        return Response({'message': 'Inspector EPV created.', 'token': token})

    except Exception as e:
        logger.error('Inspector EPV create error: %s', e)
        return Response(
            {'message': 'Failed to create Inspector EPV.'},
            status=status.HTTP_500_INTERNAL_SERVER_ERROR,
        )


# ---------------------------------------------------------------------------
# U) GET /api/epv/inspector/company/:clientRecordId
# ---------------------------------------------------------------------------
@csrf_exempt
@api_view(['GET'])
def inspector_company_epvs(request, client_record_id):
    """Get both Client and Inspector EPVs for a company."""
    blocked = _inspector_company_block(request, client_record_id)
    if blocked:
        return blocked
    inspector_id = request.query_params.get('inspectorId')

    try:
        # Client EPVs
        client_epvs = EggProductionVerification.objects.filter(
            client_record_id=int(client_record_id),
        ).filter(
            Q(epv_type='Client') | Q(epv_type__isnull=True),
        ).order_by('-period_year', '-period_month')

        # Inspector EPVs
        inspector_qs = EggProductionVerification.objects.filter(
            client_record_id=int(client_record_id),
            epv_type='Inspector',
        )
        if inspector_id:
            inspector_qs = inspector_qs.filter(inspector_id=int(inspector_id))
        inspector_qs = inspector_qs.order_by('-period_year', '-period_month')

        # Build map by LinkedEPVId
        inspector_map = {}
        inspector_epv_list = []
        for ie in inspector_qs:
            ie_dict = ie.to_js_dict()
            inspector_epv_list.append(ie_dict)
            if ie.linked_epv_id not in inspector_map:
                inspector_map[ie.linked_epv_id] = []
            inspector_map[ie.linked_epv_id].append(ie_dict)

        combined = []
        for ce in client_epvs:
            v = ce.to_js_dict()
            linked_list = inspector_map.get(ce.id, [])
            v['inspectorEPV'] = linked_list[0] if linked_list else None
            combined.append(v)

        return Response({'epvList': combined, 'inspectorEPVs': inspector_epv_list})

    except Exception as e:
        logger.error('Inspector EPV list error: %s', e)
        return Response({'message': 'Server error.'}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)


# ---------------------------------------------------------------------------
# V) GET /api/epv/inspector/not-completed
# ---------------------------------------------------------------------------
@csrf_exempt
@api_view(['GET'])
def inspector_not_completed(request):
    """Facilities that haven't completed EPVs. Supports date and province filters."""
    province = request.query_params.get('province')

    try:
        now = timezone.now()
        cur_year = now.year
        cur_month = now.month

        filter_year = _int_val(request.query_params.get('year')) or None
        filter_month = _int_val(request.query_params.get('month')) or None
        filter_quarter = _int_val(request.query_params.get('quarter')) or None

        # Build list of year+month pairs to check
        year_months = []
        if filter_year and filter_month:
            year_months.append((filter_year, filter_month))
        elif filter_year and filter_quarter:
            qsm = (filter_quarter - 1) * 3 + 1
            for m in range(qsm, qsm + 3):
                if filter_year < cur_year or m <= cur_month:
                    year_months.append((filter_year, m))
        elif filter_year:
            end_m = 12 if filter_year < cur_year else cur_month
            for m in range(1, end_m + 1):
                year_months.append((filter_year, m))
        elif filter_quarter:
            qsm = (filter_quarter - 1) * 3 + 1
            for m in range(qsm, qsm + 3):
                if m <= cur_month:
                    year_months.append((cur_year, m))
        elif filter_month:
            year_months.append((cur_year, filter_month))
        else:
            # No filter - all months from Jan 2025 to current month
            start_year = 2025
            for y in range(start_year, cur_year + 1):
                end_m = 12 if y < cur_year else cur_month
                for m in range(1, end_m + 1):
                    year_months.append((y, m))

        results = []
        if year_months:
            # Get all facilities
            facilities_qs = ClientRecord.objects.filter(
                facility_province__isnull=False,
            ).exclude(facility_province='')
            insp_id = inspector_user_id(request)
            inspector_filter = request.query_params.get('inspectorId')
            if insp_id:
                # Inspectors only see their own assigned facilities
                facilities_qs = facilities_qs.filter(assigned_inspector_id=insp_id)
            elif inspector_filter == 'unassigned':
                facilities_qs = facilities_qs.filter(assigned_inspector__isnull=True)
            elif inspector_filter:
                # Admin filtering the dashboard by a specific inspector
                facilities_qs = facilities_qs.filter(assigned_inspector_id=int(inspector_filter))
            elif province:
                facilities_qs = facilities_qs.filter(facility_province=province)

            facilities = list(facilities_qs.values(
                'id', 'business_name', 'facility_province', 'facility_type', 'town',
                'assigned_inspector__first_name', 'assigned_inspector__last_name',
            ))

            for yr, mo in year_months:
                # Get facilities that have a completed or no EPV for this period
                epv_map = {}
                epvs = EggProductionVerification.objects.filter(
                    period_month=mo,
                    period_year=yr,
                ).filter(
                    Q(epv_type='Client') | Q(epv_type__isnull=True),
                ).values('client_record_id', 'id', 'status', 'reference_number', 'token')

                for e in epvs:
                    epv_map[e['client_record_id']] = e

                for f in facilities:
                    epv_info = epv_map.get(f['id'])
                    # Not completed = no EPV at all or status is Pending
                    if epv_info is None or epv_info['status'] == 'Pending':
                        insp_name = f"{f['assigned_inspector__first_name'] or ''} {f['assigned_inspector__last_name'] or ''}".strip() or None
                        results.append({
                            'Id': f['id'],
                            'BusinessName': f['business_name'],
                            'FacilityProvince': f['facility_province'],
                            'FacilityType': f['facility_type'],
                            'Town': f['town'],
                            'AssignedInspector': insp_name,
                            'EPVId': epv_info['id'] if epv_info else None,
                            'EPVStatus': epv_info['status'] if epv_info else None,
                            'ReferenceNumber': epv_info['reference_number'] if epv_info else None,
                            'EPVToken': epv_info['token'] if epv_info else None,
                            'PeriodMonth': mo,
                            'PeriodYear': yr,
                        })

        return Response({'notCompleted': results})

    except Exception as e:
        logger.error('Not completed error: %s', e)
        return Response(
            {'message': 'Failed to load not-completed facilities.'},
            status=status.HTTP_500_INTERNAL_SERVER_ERROR,
        )


# ---------------------------------------------------------------------------
# W) GET /api/epv/inspector/pending-approvals
# ---------------------------------------------------------------------------
@csrf_exempt
@api_view(['GET'])
def inspector_pending_approvals(request):
    """Completed facility EPVs not yet verified (no inspector EPV linked)."""
    province = request.query_params.get('province')

    try:
        date_q = _build_date_filter_q(request.query_params)

        # Base queryset: Client EPVs that are Completed and not verified
        base_qs = EggProductionVerification.objects.filter(
            epv_type='Client',
            status='Completed',
        ).filter(Q(is_verified=False) | Q(is_verified__isnull=True))

        if date_q:
            base_qs = base_qs.filter(date_q)

        # Join with client records for province filter and business info
        client_ids_with_epv = base_qs.values_list('client_record_id', flat=True).distinct()
        client_map = {}
        clients_qs = ClientRecord.objects.select_related('assigned_inspector').filter(id__in=client_ids_with_epv)
        insp_id = inspector_user_id(request)
        inspector_filter = request.query_params.get('inspectorId')
        if insp_id:
            # Inspectors only see their own assigned facilities
            clients_qs = clients_qs.filter(assigned_inspector_id=insp_id)
        elif inspector_filter == 'unassigned':
            clients_qs = clients_qs.filter(assigned_inspector__isnull=True)
        elif inspector_filter:
            # Admin filtering the dashboard by a specific inspector
            clients_qs = clients_qs.filter(assigned_inspector_id=int(inspector_filter))
        elif province:
            clients_qs = clients_qs.filter(facility_province=province)
        for c in clients_qs:
            client_map[c.id] = c

        # Filter base_qs to only include EPVs from matching clients
        valid_client_ids = set(client_map.keys())

        # Pending approvals: no inspector EPV linked at all
        inspector_linked_ids = set(
            EggProductionVerification.objects.filter(
                epv_type='Inspector',
            ).values_list('linked_epv_id', flat=True)
        )

        pending_approvals = []
        for epv in base_qs:
            if epv.client_record_id not in valid_client_ids:
                continue
            if epv.id in inspector_linked_ids:
                continue
            client = client_map[epv.client_record_id]
            d = epv.to_js_dict()
            d['BusinessName'] = client.business_name
            d['FacilityProvince'] = client.facility_province
            d['FacilityType'] = client.facility_type
            d['Town'] = client.town
            d['AssignedInspector'] = client.assigned_inspector_name()
            d['InspEPVId'] = None
            d['InspEPVToken'] = None
            d['InspEPVStatus'] = None
            d['InspEPVRef'] = None
            d['InspLevyAmount'] = None
            d['InspPulpSoldToTrade'] = None
            pending_approvals.append(d)

        # Inspector EPVs to complete: where inspector EPV exists but is Pending
        inspector_pending_qs = EggProductionVerification.objects.filter(
            epv_type='Inspector',
            status='Pending',
        )
        inspector_pending_linked_ids = set(
            inspector_pending_qs.values_list('linked_epv_id', flat=True)
        )
        inspector_pending_map = {}
        for ie in inspector_pending_qs:
            inspector_pending_map[ie.linked_epv_id] = ie

        inspector_epvs_to_complete = []
        for epv in base_qs:
            if epv.client_record_id not in valid_client_ids:
                continue
            if epv.id not in inspector_pending_linked_ids:
                continue
            client = client_map[epv.client_record_id]
            ie = inspector_pending_map[epv.id]
            d = epv.to_js_dict()
            d['BusinessName'] = client.business_name
            d['FacilityProvince'] = client.facility_province
            d['FacilityType'] = client.facility_type
            d['Town'] = client.town
            d['InspEPVId'] = ie.id
            d['InspEPVToken'] = ie.token
            d['InspEPVStatus'] = ie.status
            d['InspEPVRef'] = ie.reference_number
            inspector_epvs_to_complete.append(d)

        return Response({
            'pendingApprovals': pending_approvals,
            'inspectorEPVsToComplete': inspector_epvs_to_complete,
        })

    except Exception as e:
        logger.error('Pending approvals error: %s', e)
        return Response(
            {'message': 'Failed to load pending approvals.'},
            status=status.HTTP_500_INTERNAL_SERVER_ERROR,
        )


# ---------------------------------------------------------------------------
# X) GET /api/epv/inspector/stats
# ---------------------------------------------------------------------------
@csrf_exempt
@api_view(['GET'])
def inspector_stats(request):
    """Full inspector dashboard stats with province/date filters."""
    province = request.query_params.get('province')

    try:
        now = timezone.now()
        cur_month = now.month
        cur_year = now.year
        cur_quarter = math.ceil(cur_month / 3)
        q_start_month = (cur_quarter - 1) * 3 + 1

        filter_year = _int_val(request.query_params.get('year')) or None
        filter_month = _int_val(request.query_params.get('month')) or None
        filter_quarter = _int_val(request.query_params.get('quarter')) or None

        date_q = _build_date_filter_q(request.query_params)

        # Province filter for client records
        client_qs = ClientRecord.objects.select_related('assigned_inspector').filter(
            facility_province__isnull=False,
        ).exclude(facility_province='')
        insp_id = inspector_user_id(request)
        inspector_filter = request.query_params.get('inspectorId')
        if insp_id:
            # Inspectors only see their own assigned facilities
            client_qs = client_qs.filter(assigned_inspector_id=insp_id)
        elif inspector_filter == 'unassigned':
            client_qs = client_qs.filter(assigned_inspector__isnull=True)
        elif inspector_filter:
            # Admin filtering the dashboard by a specific inspector
            client_qs = client_qs.filter(assigned_inspector_id=int(inspector_filter))
        elif province:
            client_qs = client_qs.filter(facility_province=province)

        # 1. Facility summary per province
        from django.db.models import Count as DjCount
        facilities_by_province = list(
            client_qs.values('facility_province').annotate(
                FacilityCount=DjCount('id', distinct=True),
            ).order_by('facility_province')
        )
        facilities_by_province = [
            {'FacilityProvince': f['facility_province'], 'FacilityCount': f['FacilityCount']}
            for f in facilities_by_province
        ]

        # Build set of valid client IDs for province filter
        valid_client_ids = set(client_qs.values_list('id', flat=True))

        # 2. Facilities needing visit this quarter (or filtered period)
        visit_q_year = filter_year or cur_year
        if filter_quarter:
            visit_q_start = (filter_quarter - 1) * 3 + 1
            visit_q_end = (filter_quarter - 1) * 3 + 3
        elif filter_month:
            visit_q_start = filter_month
            visit_q_end = filter_month
        else:
            visit_q_start = q_start_month
            visit_q_end = q_start_month + 2

        # A facility counts as visited when the inspection was PERFORMED in the
        # window (manual_inspection_at) — EPV periods lag a month behind, so
        # matching on period alone misses inspections done this quarter.
        # Legacy rows without a timestamp fall back to the EPV period.
        visit_start, visit_end = _visit_window(visit_q_year, visit_q_start, visit_q_end)
        inspected_client_ids = set(
            EggProductionVerification.objects.filter(
                epv_type='Client',
                manual_inspection=True,
            ).filter(
                Q(manual_inspection_at__gte=visit_start,
                  manual_inspection_at__lt=visit_end)
                | Q(manual_inspection_at__isnull=True,
                    period_year=visit_q_year,
                    period_month__gte=visit_q_start,
                    period_month__lte=visit_q_end)
            ).values_list('client_record_id', flat=True)
        )

        need_visit = []
        for c in client_qs:
            if c.id not in inspected_client_ids:
                need_visit.append({
                    'Id': c.id,
                    'BusinessName': c.business_name,
                    'Town': c.town,
                    'FacilityProvince': c.facility_province,
                    'FacilityType': c.facility_type,
                    'AssignedInspector': c.assigned_inspector_name(),
                })

        # 3. Outstanding amounts (not reconciled)
        outstanding_qs = EggProductionVerification.objects.filter(
            epv_type='Client',
            status='Completed',
            client_record_id__in=valid_client_ids,
        ).filter(Q(is_reconciled=False) | Q(is_reconciled__isnull=True))
        if date_q:
            outstanding_qs = outstanding_qs.filter(date_q)

        # Group by client
        outstanding_map = {}
        for epv in outstanding_qs:
            cid = epv.client_record_id
            if cid not in outstanding_map:
                outstanding_map[cid] = {'TotalBilled': 0, 'TotalPaid': 0}
            levy = float(epv.levy_amount or 0)
            pulp_levy = float(epv.pulp_sold_to_trade or 0) * 1.7 * 0.02
            reconciled = float(epv.reconciled_amount or 0)
            outstanding_map[cid]['TotalBilled'] += levy + pulp_levy
            outstanding_map[cid]['TotalPaid'] += reconciled

        client_detail_map = {}
        for c in client_qs:
            client_detail_map[c.id] = c

        outstanding_by_facility = []
        for cid, amounts in outstanding_map.items():
            owing = amounts['TotalBilled'] - amounts['TotalPaid']
            if owing > 0:
                c = client_detail_map.get(cid)
                if c:
                    outstanding_by_facility.append({
                        'ClientRecordId': cid,
                        'BusinessName': c.business_name,
                        'Town': c.town,
                        'FacilityProvince': c.facility_province,
                        'AssignedInspector': c.assigned_inspector_name(),
                        'TotalBilled': round(amounts['TotalBilled'], 2),
                        'TotalPaid': round(amounts['TotalPaid'], 2),
                        'TotalOwing': round(owing, 2),
                    })
        outstanding_by_facility.sort(key=lambda x: x['TotalOwing'], reverse=True)

        # 4. Aggregate stats
        completed_qs = EggProductionVerification.objects.filter(
            epv_type='Client',
            status='Completed',
            client_record_id__in=valid_client_ids,
        )
        if date_q:
            completed_qs = completed_qs.filter(date_q)

        completed_ids = list(completed_qs.values_list('id', flat=True))

        # Inspector EPVs linked to these
        inspector_epv_map = {}
        inspector_epvs_all = EggProductionVerification.objects.filter(
            epv_type='Inspector',
            linked_epv_id__in=completed_ids,
        )
        for ie in inspector_epvs_all:
            inspector_epv_map[ie.linked_epv_id] = ie

        total_facilities_with_epv = len(set(completed_qs.values_list('client_record_id', flat=True)))
        total_epvs = completed_qs.count()
        reconciled_count = completed_qs.filter(is_reconciled=True).count()
        unreconciled_count = total_epvs - reconciled_count

        total_egg_levy = 0
        total_pulp_levy = 0
        total_powder_levy = 0
        total_billed = 0
        total_paid = 0
        total_egg_dozens = 0
        total_pulp_dozens = 0
        total_powder_dozens = 0
        total_rejections = 0
        pending_inspector_epvs = 0
        manual_inspections = 0
        verified_count = 0

        for epv in completed_qs:
            egg_levy = float(epv.levy_amount or 0)
            pulp_levy = float(epv.pulp_sold_to_trade or 0) * 1.7 * 0.02
            powder_dozens = float(epv.powder_sold_to_trade or 0) * 7  # display: 1 kg powder ~ 7 doz
            powder_levy = float(epv.powder_sold_to_trade or 0) * 0.02  # kg-based levy
            total_egg_levy += egg_levy
            total_pulp_levy += pulp_levy
            total_powder_levy += powder_levy
            total_billed += egg_levy + pulp_levy
            total_paid += float(epv.reconciled_amount or 0)
            total_egg_dozens += float(epv.sold_to_trade or 0)
            total_pulp_dozens += float(epv.pulp_sold_to_trade or 0)
            total_powder_dozens += powder_dozens
            if epv.manual_inspection:
                manual_inspections += 1
            ie = inspector_epv_map.get(epv.id)
            # Actioned = approved, or rejected with the inspector's corrected EPV completed
            if epv.is_verified or (ie is not None and ie.status == 'Completed'):
                verified_count += 1
            if ie:
                total_rejections += 1
                if ie.status == 'Pending':
                    pending_inspector_epvs += 1

        stats_data = {
            'TotalFacilitiesWithEPV': total_facilities_with_epv,
            'TotalEPVs': total_epvs,
            'TotalEpvs': total_epvs,  # alias: Express backend casing, used by the frontend
            'ReconciledCount': reconciled_count,
            'UnreconciledCount': unreconciled_count,
            'TotalEggLevy': round(total_egg_levy, 2),
            'TotalPulpLevy': round(total_pulp_levy, 2),
            'TotalPowderLevy': round(total_powder_levy, 2),
            'TotalPowderDozens': round(total_powder_dozens, 2),
            'TotalBilled': round(total_billed, 2),
            'TotalPaid': round(total_paid, 2),
            'TotalOutstanding': round(total_billed - total_paid, 2),
            'TotalEggDozens': round(total_egg_dozens, 2),
            'TotalPulpDozens': round(total_pulp_dozens, 2),
            'TotalRejections': total_rejections,
            'PendingInspectorEPVs': pending_inspector_epvs,
            'ManualInspections': manual_inspections,
            'VerifiedCount': verified_count,
        }

        # 5. Per-month breakdown
        monthly_map = {}
        for epv in completed_qs:
            key = (epv.period_year, epv.period_month)
            if key not in monthly_map:
                monthly_map[key] = {
                    'PeriodMonth': epv.period_month,
                    'PeriodYear': epv.period_year,
                    'EPVCount': 0,
                    'EggLevy': 0,
                    'PulpLevy': 0,
                    'PowderLevy': 0,
                    'TotalBilled': 0,
                    'TotalPaid': 0,
                    'PaidCount': 0,
                    'EggDozens': 0,
                    'PulpDozens': 0,
                    'PowderDozens': 0,
                    'Rejections': 0,
                }
            entry = monthly_map[key]
            entry['EPVCount'] += 1
            egg_levy = float(epv.levy_amount or 0)
            pulp_levy = float(epv.pulp_sold_to_trade or 0) * 1.7 * 0.02
            powder_dozens = float(epv.powder_sold_to_trade or 0) * 7
            entry['EggLevy'] += egg_levy
            entry['PulpLevy'] += pulp_levy
            entry['PowderLevy'] += float(epv.powder_sold_to_trade or 0) * 0.02
            entry['TotalBilled'] += egg_levy + pulp_levy
            entry['TotalPaid'] += float(epv.reconciled_amount or 0)
            if epv.is_reconciled:
                entry['PaidCount'] += 1
            entry['EggDozens'] += float(epv.sold_to_trade or 0)
            entry['PulpDozens'] += float(epv.pulp_sold_to_trade or 0)
            entry['PowderDozens'] += powder_dozens
            if epv.id in inspector_epv_map:
                entry['Rejections'] += 1

        monthly = sorted(
            monthly_map.values(),
            key=lambda x: (x['PeriodYear'], x['PeriodMonth']),
            reverse=True,
        )
        # Round values
        for m in monthly:
            m['EggLevy'] = round(m['EggLevy'], 2)
            m['PulpLevy'] = round(m['PulpLevy'], 2)
            m['PowderLevy'] = round(m['PowderLevy'], 2)
            m['PowderDozens'] = round(m['PowderDozens'], 2)
            m['TotalBilled'] = round(m['TotalBilled'], 2)
            m['TotalPaid'] = round(m['TotalPaid'], 2)
            m['EggDozens'] = round(m['EggDozens'], 2)
            m['PulpDozens'] = round(m['PulpDozens'], 2)

        # 6. Rejections per province
        rejections_by_province_map = {}
        for epv in completed_qs:
            if epv.id in inspector_epv_map:
                c = client_detail_map.get(epv.client_record_id)
                prov = c.facility_province if c else 'Unknown'
                rejections_by_province_map[prov] = rejections_by_province_map.get(prov, 0) + 1

        rejections_by_province = sorted(
            [{'FacilityProvince': p, 'Rejections': r} for p, r in rejections_by_province_map.items()],
            key=lambda x: x['Rejections'],
            reverse=True,
        )

        return Response({
            'facilitiesByProvince': facilities_by_province,
            'needVisitThisQuarter': need_visit,
            'outstandingByFacility': outstanding_by_facility,
            'stats': stats_data,
            'monthly': monthly,
            'rejectionsByProvince': rejections_by_province,
            'quarter': {
                'quarter': cur_quarter,
                'year': cur_year,
                'startMonth': q_start_month,
                'endMonth': q_start_month + 2,
            },
        })

    except Exception as e:
        logger.error('Inspector stats error: %s', e)
        return Response(
            {'message': 'Failed to load inspector stats.'},
            status=status.HTTP_500_INTERNAL_SERVER_ERROR,
        )
