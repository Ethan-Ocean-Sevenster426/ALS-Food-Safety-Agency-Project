import os
import re
import math
from decimal import Decimal
from datetime import datetime

from django.conf import settings
from django.http import FileResponse
from django.views.decorators.csrf import csrf_exempt
from django.utils import timezone

from rest_framework.decorators import api_view
from rest_framework.response import Response
from rest_framework import status

from api.models import (
    EggProductionVerification, ClientRecord, EPVInvoice, EmailSendLog, ClientAuditLog,
)
from api.services.helpers import log_company_audit, LEVY_RATE
from api.services.email_service import send_email, send_email_to_each

LEVY_RATE_FLOAT = 0.02
MONTH_NAMES = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December',
]


def _calc_totals(epv):
    """Calculate totals from an EPV record (model instance or dict)."""
    if isinstance(epv, dict):
        egg_levy = float(epv.get('levy_amount') or epv.get('LevyAmount') or 0)
        pulp_sold = int(float(epv.get('pulp_sold_to_trade') or epv.get('PulpSoldToTrade') or 0))
    else:
        egg_levy = float(epv.levy_amount or 0)
        pulp_sold = int(float(epv.pulp_sold_to_trade or 0))
    pulp_levy_dozens = round(pulp_sold * 1.7)
    pulp_levy = pulp_levy_dozens * LEVY_RATE_FLOAT
    return {
        'eggLevy': egg_levy,
        'pulpLevy': pulp_levy,
        'total': egg_levy + pulp_levy,
    }


def _generate_invoice_number(month, year):
    """Generate unique invoice number: INV-YYYY-MM-XXXX."""
    prefix = f"INV-{year}-{str(month).zfill(2)}"
    count = EPVInvoice.objects.filter(invoice_number__startswith=prefix).count()
    seq = count + 1
    return f"{prefix}-{str(seq).zfill(4)}"


def _build_invoice_pdf(invoice_data):
    """
    Build a Pro Forma Invoice PDF using reportlab.
    Returns the full file path of the generated PDF.
    """
    from reportlab.lib.pagesizes import A4
    from reportlab.lib.colors import HexColor, white, Color
    from reportlab.pdfgen import canvas

    invoices_dir = os.path.join(settings.MEDIA_ROOT, 'invoices')
    os.makedirs(invoices_dir, exist_ok=True)

    file_name = f"{invoice_data['invoiceNumber']}.pdf"
    file_path = os.path.join(invoices_dir, file_name)

    width, height = A4  # 595, 842
    c = canvas.Canvas(file_path, pagesize=A4)

    # Header bar
    c.setFillColor(HexColor('#4f46e5'))
    c.rect(0, height - 100, width, 100, fill=1, stroke=0)

    c.setFillColor(white)
    c.setFont('Helvetica-Bold', 28)
    c.drawString(50, height - 55, 'EPVS')

    c.setFont('Helvetica', 10)
    c.setFillColor(Color(1, 1, 1, alpha=0.85))
    c.drawString(50, height - 72, 'Egg Production Verification System')

    c.setFont('Helvetica-Bold', 22)
    c.setFillColor(white)
    c.drawRightString(width - 50, height - 55, 'PRO FORMA INVOICE')

    # Reset text color
    c.setFillColor(HexColor('#333333'))

    # Invoice details
    y1 = height - 140

    c.setFont('Helvetica', 10)
    c.setFillColor(HexColor('#666666'))
    c.drawString(50, y1, 'Invoice Number:')
    c.setFont('Helvetica-Bold', 10)
    c.setFillColor(HexColor('#333333'))
    c.drawString(160, y1, invoice_data['invoiceNumber'])

    c.setFont('Helvetica', 10)
    c.setFillColor(HexColor('#666666'))
    c.drawString(50, y1 - 18, 'Reference:')
    c.setFont('Helvetica-Bold', 10)
    c.setFillColor(HexColor('#0E7C7B'))
    c.drawString(160, y1 - 18, invoice_data['referenceNumber'])

    c.setFont('Helvetica', 10)
    c.setFillColor(HexColor('#666666'))
    c.drawString(50, y1 - 36, 'Date:')
    c.setFillColor(HexColor('#333333'))
    c.drawString(160, y1 - 36, datetime.now().strftime('%Y/%m/%d'))

    c.setFillColor(HexColor('#666666'))
    c.drawString(50, y1 - 54, 'Period:')
    c.setFillColor(HexColor('#333333'))
    c.drawString(160, y1 - 54, invoice_data['period'])

    # Right side - Bill To
    c.setFillColor(HexColor('#666666'))
    c.drawString(350, y1, 'Bill To:')
    c.setFont('Helvetica-Bold', 10)
    c.setFillColor(HexColor('#333333'))
    c.drawString(350, y1 - 18, invoice_data['businessName'])
    c.setFont('Helvetica', 10)
    line_y = y1 - 33
    if invoice_data.get('tradingName'):
        c.drawString(350, line_y, f"t/a {invoice_data['tradingName']}")
        line_y -= 15
    if invoice_data.get('province'):
        c.drawString(350, line_y, invoice_data['province'])
        line_y -= 15
    if invoice_data.get('email'):
        c.setFillColor(HexColor('#4f46e5'))
        c.drawString(350, line_y, invoice_data['email'])

    c.setFillColor(HexColor('#333333'))

    # Divider
    table_top = y1 - 100
    c.setStrokeColor(HexColor('#dddddd'))
    c.line(50, table_top, 545, table_top)

    # Table header
    c.setFillColor(HexColor('#f3f4f6'))
    c.rect(50, table_top - 30, 495, 25, fill=1, stroke=0)
    c.setFillColor(HexColor('#333333'))
    c.setFont('Helvetica-Bold', 10)
    c.drawString(60, table_top - 22, 'Description')
    c.drawString(300, table_top - 22, 'Qty/Details')
    c.drawRightString(535, table_top - 22, 'Amount')

    c.setFont('Helvetica', 10)
    c.setFillColor(HexColor('#333333'))

    # Table rows
    rows = []
    if invoice_data['eggLevy'] > 0:
        rows.append({
            'desc': 'Egg Levy',
            'detail': f"Levy on {invoice_data.get('totalD', 0)} dozen eggs @ R{LEVY_RATE_FLOAT}/dozen",
            'amount': invoice_data['eggLevy'],
        })
    if invoice_data['pulpLevy'] > 0:
        pulp_sold = invoice_data.get('pulpSoldToTrade', 0)
        rows.append({
            'desc': 'Pulp Levy',
            'detail': f"{pulp_sold} containers x 1.7 = {round(pulp_sold * 1.7)} dozen @ R{LEVY_RATE_FLOAT}/dozen",
            'amount': invoice_data['pulpLevy'],
        })
    if len(rows) == 0:
        rows.append({'desc': 'Egg Production Levy', 'detail': 'No levy amounts calculated', 'amount': 0})

    row_y = table_top - 42
    for i, row in enumerate(rows):
        if i % 2 == 1:
            c.setFillColor(HexColor('#fafafa'))
            c.rect(50, row_y - 10, 495, 22, fill=1, stroke=0)
        c.setFillColor(HexColor('#333333'))
        c.setFont('Helvetica', 10)
        c.drawString(60, row_y, row['desc'])
        c.setFont('Helvetica', 8)
        c.setFillColor(HexColor('#666666'))
        c.drawString(60, row_y - 13, row['detail'])
        c.setFillColor(HexColor('#333333'))
        c.setFont('Helvetica', 10)
        c.drawRightString(535, row_y, f"R {row['amount']:.2f}")
        row_y -= 32

    # Total line
    c.setStrokeColor(HexColor('#dddddd'))
    c.line(350, row_y + 5, 545, row_y + 5)
    c.setFillColor(HexColor('#4f46e5'))
    c.rect(350, row_y - 25, 195, 30, fill=1, stroke=0)
    c.setFillColor(white)
    c.setFont('Helvetica-Bold', 12)
    c.drawString(360, row_y - 15, 'TOTAL DUE:')
    c.drawRightString(535, row_y - 15, f"R {invoice_data['total']:.2f}")

    c.setFillColor(HexColor('#333333'))
    c.setFont('Helvetica', 10)

    # Payment instructions
    pay_y = row_y - 60
    c.setFillColor(HexColor('#f0fdf4'))
    c.setStrokeColor(HexColor('#bbf7d0'))
    c.rect(50, pay_y - 80, 495, 80, fill=1, stroke=1)
    c.setFillColor(HexColor('#15803d'))
    c.setFont('Helvetica-Bold', 11)
    c.drawString(65, pay_y - 20, 'Payment Instructions')
    c.setFont('Helvetica', 9)
    c.setFillColor(HexColor('#166534'))
    c.drawString(65, pay_y - 38, 'Please use the Reference Number above as your payment reference.')
    c.drawString(65, pay_y - 52, 'Upload your Proof of Payment (POP) to the EPVS system after making payment.')
    c.drawString(65, pay_y - 66, 'Payment is due within 30 days of the invoice date.')

    # Footer
    c.setFillColor(HexColor('#aaaaaa'))
    c.setFont('Helvetica', 8)
    c.drawCentredString(width / 2, 50, 'This is a system-generated Pro Forma Invoice from the Egg Production Verification System (EPVS).')
    c.drawCentredString(width / 2, 38, f"Generated on {datetime.now().strftime('%Y/%m/%d, %H:%M:%S')}")

    c.save()
    return file_path


@csrf_exempt
@api_view(['POST'])
def generate(request):
    verification_id = request.data.get('verificationId')
    generated_by = request.data.get('generatedBy')
    user_role = request.data.get('userRole')

    if not verification_id:
        return Response({'message': 'verificationId is required.'}, status=status.HTTP_400_BAD_REQUEST)

    try:
        # Check if invoice already exists for this EPV
        existing = EPVInvoice.objects.filter(verification_id=int(verification_id)).first()
        if existing:
            return Response({
                'message': 'Invoice already exists for this verification.',
                'invoice': {
                    'Id': existing.id,
                    'InvoiceNumber': existing.invoice_number,
                },
            }, status=status.HTTP_409_CONFLICT)

        # Get full EPV data
        try:
            epv = EggProductionVerification.objects.get(id=int(verification_id))
        except EggProductionVerification.DoesNotExist:
            return Response({'message': 'Verification not found.'}, status=status.HTTP_404_NOT_FOUND)

        # Get client data
        client = None
        try:
            client = ClientRecord.objects.get(id=epv.client_record_id)
        except ClientRecord.DoesNotExist:
            pass

        # Check if there's an inspector EPV (rejected case) - use inspector amounts
        source_epv = epv
        if not epv.is_verified:
            inspector_epv = EggProductionVerification.objects.filter(
                linked_epv_id=int(verification_id),
                epv_type='Inspector',
                status='Completed',
            ).first()
            if inspector_epv:
                source_epv = inspector_epv

        totals = _calc_totals(source_epv)
        invoice_number = _generate_invoice_number(epv.period_month, epv.period_year)
        period = f"{MONTH_NAMES[(epv.period_month or 1) - 1]} {epv.period_year}"

        company_name = ''
        if client:
            company_name = client.business_name or ''
        if not company_name:
            company_name = epv.business_name or 'Unknown'

        invoice_data = {
            'invoiceNumber': invoice_number,
            'referenceNumber': epv.reference_number or f"EPV-{epv.id}",
            'period': period,
            'businessName': company_name,
            'tradingName': epv.trading_name or '',
            'province': epv.facility_province or '',
            'email': (client.email if client else '') or epv.email_address or '',
            'eggLevy': totals['eggLevy'],
            'pulpLevy': totals['pulpLevy'],
            'total': totals['total'],
            'totalD': float(source_epv.total_d or 0),
            'pulpSoldToTrade': int(float(source_epv.pulp_sold_to_trade or 0)),
        }

        file_path = _build_invoice_pdf(invoice_data)
        file_name = os.path.basename(file_path)

        # Save to DB
        EPVInvoice.objects.create(
            verification_id=int(verification_id),
            client_record_id=epv.client_record_id,
            invoice_number=invoice_number,
            reference_number=epv.reference_number,
            amount=Decimal(str(round(totals['total'], 2))),
            file_path=file_name,
            generated_by=generated_by or 'Unknown',
        )

        # Audit log
        log_company_audit(
            record_id=epv.client_record_id,
            field_name='Invoice Generated',
            old_value=None,
            new_value=f"{invoice_number} \u2014 R {totals['total']:.2f}",
            changed_by=generated_by or 'Unknown',
            user_role=user_role,
        )

        return Response({
            'message': 'Invoice generated.',
            'invoiceNumber': invoice_number,
            'fileName': file_name,
        })
    except Exception as e:
        print(f'Invoice generate error: {e}')
        return Response({'message': 'Failed to generate invoice.'}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)


@csrf_exempt
@api_view(['DELETE'])
def delete_invoice(request, id):
    deleted_by = request.data.get('deletedBy')
    user_role = request.data.get('userRole')

    try:
        try:
            inv = EPVInvoice.objects.get(id=int(id))
        except EPVInvoice.DoesNotExist:
            return Response({'message': 'Invoice not found.'}, status=status.HTTP_404_NOT_FOUND)

        # Delete the PDF file
        file_path = os.path.join(settings.MEDIA_ROOT, 'invoices', inv.file_path)
        try:
            os.remove(file_path)
        except OSError:
            pass  # file may already be gone

        # Audit log
        log_company_audit(
            record_id=inv.client_record_id,
            field_name='Invoice Deleted',
            old_value=f"{inv.invoice_number} \u2014 R {float(inv.amount):.2f}",
            new_value=None,
            changed_by=deleted_by or 'Unknown',
            user_role=user_role,
        )

        # Delete from DB
        inv.delete()

        return Response({'message': 'Invoice deleted.'})
    except Exception as e:
        print(f'Invoice delete error: {e}')
        return Response({'message': 'Failed to delete invoice.'}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)


@csrf_exempt
@api_view(['POST'])
def send_invoice(request, id):
    sent_by = request.data.get('sentBy')
    user_role = request.data.get('userRole')

    try:
        # Get invoice with related EPV and client data
        try:
            inv = EPVInvoice.objects.get(id=int(id))
        except EPVInvoice.DoesNotExist:
            return Response({'message': 'Invoice not found.'}, status=status.HTTP_404_NOT_FOUND)

        try:
            epv = EggProductionVerification.objects.get(id=inv.verification_id)
        except EggProductionVerification.DoesNotExist:
            return Response({'message': 'Verification not found.'}, status=status.HTTP_404_NOT_FOUND)

        try:
            client = ClientRecord.objects.get(id=inv.client_record_id)
        except ClientRecord.DoesNotExist:
            return Response({'message': 'Client record not found.'}, status=status.HTTP_404_NOT_FOUND)

        # Collect all facility emails (validate format)
        email_regex = re.compile(r'^[^\s@]+@[^\s@]+\.[^\s@]+$')
        raw_emails = [
            client.email, client.abattoir_owner_email,
            client.accounts_email, client.abattoir_manager_email,
            client.manual_email,
        ]
        emails = [e.strip() for e in raw_emails if e and e.strip() and email_regex.match(e.strip())]
        unique_emails = list(dict.fromkeys([e.lower() for e in emails]))

        if len(unique_emails) == 0:
            return Response({'message': 'No email addresses found for this facility.'}, status=status.HTTP_400_BAD_REQUEST)

        period = f"{MONTH_NAMES[(epv.period_month or 1) - 1]} {epv.period_year}"

        email_html = f"""
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
          <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 30px; border-radius: 12px 12px 0 0; text-align: center;">
            <h1 style="color: #fff; margin: 0; font-size: 28px;">EPVS</h1>
            <p style="color: rgba(255,255,255,0.85); margin: 8px 0 0; font-size: 14px;">Egg Production Verification System</p>
          </div>
          <div style="background: #fff; padding: 30px; border: 1px solid #e5e7eb; border-top: none; border-radius: 0 0 12px 12px;">
            <h2 style="color: #333; margin-top: 0;">Pro Forma Invoice</h2>
            <p style="color: #555; font-size: 15px; line-height: 1.6;">
              Dear <strong>{client.business_name}</strong>,
            </p>
            <p style="color: #555; font-size: 15px; line-height: 1.6;">
              Please find attached the Pro Forma Invoice for the Egg Production Levy for
              <strong style="color: #4f46e5;">{period}</strong>.
            </p>
            <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 18px; margin: 20px 0;">
              <table style="width: 100%; font-size: 14px; color: #555;">
                <tr><td style="padding: 4px 0;"><strong>Invoice Number:</strong></td><td>{inv.invoice_number}</td></tr>
                <tr><td style="padding: 4px 0;"><strong>Reference:</strong></td><td style="color: #0E7C7B; font-weight: 600;">{inv.reference_number or chr(8212)}</td></tr>
                <tr><td style="padding: 4px 0;"><strong>Amount Due:</strong></td><td style="color: #dc2626; font-weight: 700; font-size: 16px;">R {float(inv.amount):.2f}</td></tr>
              </table>
            </div>
            <p style="color: #555; font-size: 15px; line-height: 1.6;">
              Please use the reference number <strong style="color: #0E7C7B;">{inv.reference_number or inv.invoice_number}</strong> when making payment,
              and upload your Proof of Payment (POP) to the EPVS system.
            </p>
            <div style="text-align: center; margin: 25px 0;">
              <a href="https://egg-production-verification.fsa-pty.co.za/company" style="display: inline-block; background-color: #4f46e5; color: #ffffff; padding: 14px 40px; border-radius: 8px; text-decoration: none; font-size: 16px; font-weight: 600;">
                Go to EPVS Portal
              </a>
            </div>
          </div>
          <p style="color: #aaa; font-size: 11px; text-align: center; margin-top: 20px;">
            This email was sent by the EPVS system. If you did not expect this email, please contact your administrator.
          </p>
        </div>
        """

        email_subject = f"Pro Forma Invoice {inv.invoice_number} \u2014 {period} \u2014 R {float(inv.amount):.2f}"

        # Send to each recipient individually to track failures
        result = send_email_to_each(
            recipients=unique_emails,
            subject=email_subject,
            html=email_html,
        )
        succeeded = result['succeeded']
        failed = result['failed']

        # Log each result to EmailSendLog
        for email_addr in succeeded:
            EmailSendLog.objects.create(
                client_record_id=inv.client_record_id,
                email_address=email_addr,
                email_type='Invoice',
                subject=email_subject,
                status='Sent',
                sent_by=sent_by or 'Unknown',
            )
        for email_addr in failed:
            EmailSendLog.objects.create(
                client_record_id=inv.client_record_id,
                email_address=email_addr,
                email_type='Invoice',
                subject=email_subject,
                status='Failed',
                sent_by=sent_by or 'Unknown',
            )

        if len(succeeded) == 0:
            return Response({
                'message': 'All emails failed to send.',
                'failed': failed,
            }, status=status.HTTP_500_INTERNAL_SERVER_ERROR)

        # Update invoice record
        sent_to_list = ', '.join(succeeded)
        failed_list = ', '.join(failed) if failed else None
        inv.sent_at = timezone.now()
        inv.sent_by = sent_by or 'Unknown'
        inv.sent_to = sent_to_list + (f' | FAILED: {failed_list}' if failed_list else '')
        inv.save()

        # Audit log
        audit_new_value = f"{inv.invoice_number} sent to {sent_to_list}"
        if failed_list:
            audit_new_value += f" | Failed: {failed_list}"
        log_company_audit(
            record_id=inv.client_record_id,
            field_name='Invoice Sent',
            old_value=None,
            new_value=audit_new_value,
            changed_by=sent_by or 'Unknown',
            user_role=user_role,
        )

        message = f"Invoice sent to {len(succeeded)} recipient(s)."
        if failed:
            message += f" Failed: {', '.join(failed)}"

        return Response({
            'message': message,
            'sentTo': sent_to_list,
            'failed': failed,
        })
    except Exception as e:
        print(f'Invoice send error: {e}')
        return Response({'message': 'Failed to send invoice.'}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)


@csrf_exempt
@api_view(['GET'])
def company_invoices(request, clientRecordId):
    try:
        invoices = EPVInvoice.objects.filter(
            client_record_id=int(clientRecordId)
        ).order_by('-generated_at')

        result = []
        for inv in invoices:
            result.append({
                'Id': inv.id,
                'VerificationId': inv.verification_id,
                'InvoiceNumber': inv.invoice_number,
                'ReferenceNumber': inv.reference_number,
                'Amount': float(inv.amount),
                'FilePath': inv.file_path,
                'GeneratedBy': inv.generated_by,
                'GeneratedAt': inv.generated_at.isoformat() if inv.generated_at else None,
                'SentAt': inv.sent_at.isoformat() if inv.sent_at else None,
                'SentTo': inv.sent_to,
                'SentBy': inv.sent_by,
            })

        return Response(result)
    except Exception as e:
        print(f'Invoice list error: {e}')
        return Response({'message': 'Failed to load invoices.'}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)


@csrf_exempt
@api_view(['GET'])
def epv_invoice(request, verificationId):
    try:
        inv = EPVInvoice.objects.filter(verification_id=int(verificationId)).first()

        if not inv:
            return Response(None)

        return Response({
            'Id': inv.id,
            'VerificationId': inv.verification_id,
            'InvoiceNumber': inv.invoice_number,
            'ReferenceNumber': inv.reference_number,
            'Amount': float(inv.amount),
            'FilePath': inv.file_path,
            'GeneratedBy': inv.generated_by,
            'GeneratedAt': inv.generated_at.isoformat() if inv.generated_at else None,
            'SentAt': inv.sent_at.isoformat() if inv.sent_at else None,
            'SentTo': inv.sent_to,
            'SentBy': inv.sent_by,
        })
    except Exception as e:
        print(f'Invoice by EPV error: {e}')
        return Response({'message': 'Failed to load invoice.'}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)


@csrf_exempt
@api_view(['GET'])
def download_invoice(request, fileName):
    file_path = os.path.join(settings.MEDIA_ROOT, 'invoices', fileName)
    if not os.path.exists(file_path):
        return Response({'message': 'Invoice file not found.'}, status=status.HTTP_404_NOT_FOUND)
    return FileResponse(open(file_path, 'rb'), content_type='application/pdf')


@csrf_exempt
@api_view(['GET'])
def email_log(request, clientRecordId):
    try:
        logs = EmailSendLog.objects.filter(
            client_record_id=int(clientRecordId)
        ).order_by('-sent_at')

        log_list = []
        email_status = {}
        for entry in logs:
            log_list.append({
                'EmailAddress': entry.email_address,
                'EmailType': entry.email_type,
                'Status': entry.status,
                'SentAt': entry.sent_at.isoformat() if entry.sent_at else None,
                'Subject': entry.subject,
            })
            # Build map of latest status per email address
            if entry.email_address not in email_status:
                email_status[entry.email_address] = entry.status

        return Response({
            'log': log_list,
            'emailStatus': email_status,
        })
    except Exception as e:
        print(f'Email log error: {e}')
        return Response({'message': 'Failed to load email log.'}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)
