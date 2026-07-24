#!/usr/bin/env python
"""Import all data from the Excel export files into PostgreSQL."""
import os
import sys
import django
from datetime import datetime
from decimal import Decimal, InvalidOperation

os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'epvs_backend.settings')
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
django.setup()

import openpyxl
from django.utils import timezone
from api.models import (
    User, ClientRecord, ClientAuditLog, Invitation,
    EggProductionVerification, EPVAuditLog,
    SupportTicketCategory, SupportTicket, SupportTicketComment,
    KPITarget, EPVInvoice, EmailSendLog,
)

EXPORTS_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'server', 'exports')

def reset_sequence(table):
    """Reset the id sequence after explicit-ID bulk inserts (Postgres only —
    MySQL's AUTO_INCREMENT adjusts itself when higher explicit IDs are inserted)."""
    from django.db import connection
    if connection.vendor != 'postgresql':
        return
    with connection.cursor() as cursor:
        cursor.execute(
            f"SELECT setval(pg_get_serial_sequence('{table}', 'id'), COALESCE(MAX(id), 1)) FROM {table};"
        )



def parse_dt(val):
    """Parse a datetime value from Excel."""
    if val is None:
        return None
    if isinstance(val, datetime):
        if val.tzinfo is None:
            return timezone.make_aware(val)
        return val
    if isinstance(val, str):
        val = val.strip()
        if not val:
            return None
        for fmt in ('%Y-%m-%d %H:%M:%S.%f', '%Y-%m-%d %H:%M:%S', '%Y-%m-%dT%H:%M:%S.%fZ', '%Y-%m-%dT%H:%M:%S'):
            try:
                dt = datetime.strptime(val, fmt)
                return timezone.make_aware(dt)
            except ValueError:
                continue
    return None


def parse_int(val, default=0):
    if val is None:
        return default
    try:
        return int(float(val))
    except (ValueError, TypeError):
        return default


def parse_dec(val, default=Decimal('0')):
    if val is None:
        return default
    try:
        return Decimal(str(val))
    except (InvalidOperation, ValueError, TypeError):
        return default


def parse_bool(val, default=False):
    if val is None:
        return default
    if isinstance(val, bool):
        return val
    if isinstance(val, (int, float)):
        return bool(int(val))
    if isinstance(val, str):
        return val.lower() in ('true', '1', 'yes')
    return default


def s(val, default=''):
    """Safe string."""
    if val is None:
        return default
    return str(val).strip()


def read_xlsx(filename):
    """Read Excel file and return list of dicts."""
    filepath = os.path.join(EXPORTS_DIR, filename)
    if not os.path.exists(filepath):
        print(f'  SKIP: {filename} not found')
        return []
    wb = openpyxl.load_workbook(filepath, read_only=True)
    ws = wb.active
    rows = list(ws.iter_rows(values_only=True))
    wb.close()
    if len(rows) < 2:
        print(f'  SKIP: {filename} is empty')
        return []
    headers = [str(h).strip() if h else f'col_{i}' for i, h in enumerate(rows[0])]
    data = []
    for row in rows[1:]:
        d = {}
        for i, val in enumerate(row):
            if i < len(headers):
                d[headers[i]] = val
        data.append(d)
    return data


def import_users():
    print('\n=== Importing Users (723 rows) ===')
    data = read_xlsx('Users.xlsx')
    if not data:
        return
    User.objects.all().delete()
    batch = []
    for r in data:
        batch.append(User(
            id=parse_int(r.get('Id')),
            first_name=s(r.get('FirstName')),
            last_name=s(r.get('LastName')),
            email=s(r.get('Email')),
            password_hash=s(r.get('PasswordHash')),
            role=s(r.get('Role'), 'User'),
            is_active=parse_bool(r.get('IsActive'), True),
            inspector_province=s(r.get('InspectorProvince')) or None,
            created_at=parse_dt(r.get('CreatedAt')) or timezone.now(),
        ))
    User.objects.bulk_create(batch, ignore_conflicts=True)
    # Reset sequence
    reset_sequence('users')
    print(f'  Imported {len(batch)} users')


def import_clients():
    print('\n=== Importing Client Records (503 rows) ===')
    data = read_xlsx('ConsolidatedMasterAbattoirDatabase.xlsx')
    if not data:
        return
    ClientRecord.objects.all().delete()
    batch = []
    for r in data:
        batch.append(ClientRecord(
            id=parse_int(r.get('Id')),
            business_name=s(r.get('BusinessName')),
            account_code=s(r.get('AccountCode')),
            email=s(r.get('Email')),
            manual_email=s(r.get('ManualEmail')),
            town=s(r.get('Town')),
            corporate_group=s(r.get('CorporateGroup')),
            group_type=s(r.get('GroupType')),
            facility_type=s(r.get('FacilityType')),
            facility_province=s(r.get('FacilityProvince')),
            company_reg_number=s(r.get('CompanyRegNumber')),
            physical_address=s(r.get('PhysicalAddress')),
            vat_number=s(r.get('VATNumber')),
            abattoir_owner_name=s(r.get('AbattoirOwnerName')),
            abattoir_owner_cell=s(r.get('AbattoirOwnerCell')),
            abattoir_owner_email=s(r.get('AbattoirOwnerEmail')),
            accounts_contact_name=s(r.get('AccountsContactName')),
            accounts_telephone=s(r.get('AccountsTelephone')),
            accounts_email=s(r.get('AccountsEmail')),
            abattoir_manager_name=s(r.get('AbattoirManagerName')),
            abattoir_manager_cell=s(r.get('AbattoirManagerCell')),
            abattoir_manager_email=s(r.get('AbattoirManagerEmail')),
            verified_at=parse_dt(r.get('VerifiedAt')),
            verified_by=s(r.get('VerifiedBy')) or None,
            epv_cycle_status=s(r.get('EPVCycleStatus')) or None,
        ))
    ClientRecord.objects.bulk_create(batch, ignore_conflicts=True)
    reset_sequence('client_records')
    print(f'  Imported {len(batch)} client records')


def import_audit_log():
    print('\n=== Importing Client Audit Log (56 rows) ===')
    data = read_xlsx('ClientAuditLog.xlsx')
    if not data:
        return
    ClientAuditLog.objects.all().delete()
    batch = []
    for r in data:
        batch.append(ClientAuditLog(
            id=parse_int(r.get('Id')),
            record_id=parse_int(r.get('RecordId')),
            field_name=s(r.get('FieldName')),
            old_value=s(r.get('OldValue')) or None,
            new_value=s(r.get('NewValue')) or None,
            changed_by=s(r.get('ChangedBy')),
            user_role=s(r.get('UserRole')) or None,
            changed_at=parse_dt(r.get('ChangedAt')) or timezone.now(),
        ))
    ClientAuditLog.objects.bulk_create(batch, ignore_conflicts=True)
    reset_sequence('client_audit_log')
    print(f'  Imported {len(batch)} audit log entries')


def import_invitations():
    print('\n=== Importing Invitations (704 rows) ===')
    data = read_xlsx('Invitations.xlsx')
    if not data:
        return
    Invitation.objects.all().delete()
    batch = []
    for r in data:
        batch.append(Invitation(
            id=parse_int(r.get('Id')),
            client_record_id=parse_int(r.get('ClientRecordId')),
            email=s(r.get('Email')),
            role=s(r.get('Role')),
            token=s(r.get('Token')),
            status=s(r.get('Status'), 'Pending'),
            invited_by=s(r.get('InvitedBy')),
            accepted_at=parse_dt(r.get('AcceptedAt')),
            created_at=parse_dt(r.get('CreatedAt')) or timezone.now(),
        ))
    Invitation.objects.bulk_create(batch, ignore_conflicts=True)
    reset_sequence('invitations')
    print(f'  Imported {len(batch)} invitations')


def import_epvs():
    print('\n=== Importing EPVs (8111 rows) - this may take a moment ===')
    data = read_xlsx('EggProductionVerifications.xlsx')
    if not data:
        return
    EggProductionVerification.objects.all().delete()
    batch = []
    for r in data:
        batch.append(EggProductionVerification(
            id=parse_int(r.get('Id')),
            client_record_id=parse_int(r.get('ClientRecordId')),
            period_month=parse_int(r.get('PeriodMonth')),
            period_year=parse_int(r.get('PeriodYear')),
            status=s(r.get('Status'), 'Pending'),
            token=s(r.get('Token')),
            sent_at=parse_dt(r.get('SentAt')) or parse_dt(r.get('CreatedAt')) or timezone.now(),
            completed_at=parse_dt(r.get('CompletedAt')),
            completed_by=s(r.get('CompletedBy')) or None,
            business_name=s(r.get('BusinessName')),
            facility_type=s(r.get('FacilityType')),
            facility_province=s(r.get('FacilityProvince')),
            trading_name=s(r.get('TradingName')),
            authorized_person_name=s(r.get('AuthorizedPersonName')),
            position_in_company=s(r.get('PositionInCompany')),
            telephone_number=s(r.get('TelephoneNumber')),
            cell_phone_number=s(r.get('CellPhoneNumber')),
            email_address=s(r.get('EmailAddress')),
            variance_reason=s(r.get('VarianceReason')),
            reference_number=s(r.get('ReferenceNumber')) or None,
            # Numeric egg fields
            opening_stock=parse_dec(r.get('OpeningStock')),
            graded_eggs_purchased=parse_dec(r.get('GradedEggsPurchased')),
            ungraded_eggs_purchased=parse_dec(r.get('UngradedEggsPurchased')),
            market_returns=parse_dec(r.get('MarketReturns')),
            machine_loss=parse_dec(r.get('MachineLoss')),
            sent_to_pulp=parse_dec(r.get('SentToPulp')),
            destroyed=parse_dec(r.get('Destroyed')),
            sold_to_trade=parse_dec(r.get('SoldToTrade')),
            sold_to_staff=parse_dec(r.get('SoldToStaff')),
            sold_through_farm_stall=parse_dec(r.get('SoldThroughFarmStall')),
            transferred_to_other_producers=parse_dec(r.get('TransferredToOtherProducers')),
            # Pulp fields
            pulp_opening_stock=parse_dec(r.get('PulpOpeningStock')),
            pulp_purchased=parse_dec(r.get('PulpPurchased')),
            pulp_converted=parse_dec(r.get('PulpConverted')),
            pulp_sold_to_trade=parse_dec(r.get('PulpSoldToTrade')),
            pulp_sold_to_producers=parse_dec(r.get('PulpSoldToProducers')),
            # Calculated
            total_b=parse_dec(r.get('TotalB')),
            total_c=parse_dec(r.get('TotalC')),
            total_d=parse_dec(r.get('TotalD')),
            total_e=parse_dec(r.get('TotalE')),
            levy_amount=parse_dec(r.get('LevyAmount')),
            closing_stock=parse_dec(r.get('ClosingStock')),
            actual_closing_stock=parse_dec(r.get('ActualClosingStock')),
            loss_gain=parse_dec(r.get('LossGain')),
            # POP
            pop_file_path=s(r.get('POPFilePath')) or None,
            pop_uploaded_at=parse_dt(r.get('POPUploadedAt')),
            pop_uploaded_by=s(r.get('POPUploadedBy')) or None,
            pop_comment=s(r.get('POPComment')) or None,
            # Payment
            client_payment_status=s(r.get('ClientPaymentStatus')) or None,
            # Reconciliation
            is_reconciled=parse_bool(r.get('IsReconciled')),
            reconciled_by=s(r.get('ReconciledBy')) or None,
            reconciled_at=parse_dt(r.get('ReconciledAt')),
            reconciled_amount=parse_dec(r.get('ReconciledAmount')) if r.get('ReconciledAmount') is not None else None,
            # Verification
            is_verified=parse_bool(r.get('IsVerified')),
            verified_by=s(r.get('VerifiedBy')) or None,
            verified_at=parse_dt(r.get('VerifiedAt')),
            inspector_comment=s(r.get('InspectorComment')) or None,
            # Inspection
            manual_inspection=parse_bool(r.get('ManualInspection')),
            manual_inspection_by=s(r.get('ManualInspectionBy')) or None,
            manual_inspection_at=parse_dt(r.get('ManualInspectionAt')),
            # Inspector EPV
            epv_type=s(r.get('EPVType'), 'Client'),
            inspector_id=parse_int(r.get('InspectorId')) or None,
            linked_epv_id=parse_int(r.get('LinkedEPVId')) or None,
        ))

    # Bulk create in batches of 500 to avoid memory issues
    BATCH_SIZE = 500
    for i in range(0, len(batch), BATCH_SIZE):
        EggProductionVerification.objects.bulk_create(batch[i:i+BATCH_SIZE], ignore_conflicts=True)
        print(f'  ... {min(i+BATCH_SIZE, len(batch))}/{len(batch)}')

    reset_sequence('egg_production_verifications')
    print(f'  Imported {len(batch)} EPV records')


def import_support_categories():
    print('\n=== Importing Support Categories (23 rows) ===')
    data = read_xlsx('SupportTicketCategories.xlsx')
    if not data:
        return
    SupportTicketCategory.objects.all().delete()
    batch = []
    for r in data:
        batch.append(SupportTicketCategory(
            id=parse_int(r.get('Id')),
            name=s(r.get('Name')),
            category_type=s(r.get('CategoryType')),
            is_active=parse_bool(r.get('IsActive'), True),
            sort_order=parse_int(r.get('SortOrder')),
        ))
    SupportTicketCategory.objects.bulk_create(batch, ignore_conflicts=True)
    reset_sequence('support_ticket_categories')
    print(f'  Imported {len(batch)} categories')


def import_support_tickets():
    print('\n=== Importing Support Tickets (46 rows) ===')
    data = read_xlsx('SupportTickets.xlsx')
    if not data:
        return
    SupportTicket.objects.all().delete()
    batch = []
    for r in data:
        cat_id = parse_int(r.get('CategoryId'))
        batch.append(SupportTicket(
            id=parse_int(r.get('Id')),
            category_id=cat_id,
            category_type=s(r.get('CategoryType')),
            subject=s(r.get('Subject')),
            description=s(r.get('Description')),
            priority=s(r.get('Priority'), 'Medium'),
            status=s(r.get('Status'), 'Open'),
            created_by_user_id=parse_int(r.get('CreatedByUserId')),
            client_record_id=parse_int(r.get('ClientRecordId')) or None,
            assigned_to_user_id=parse_int(r.get('AssignedToUserId')) or None,
            created_at=parse_dt(r.get('CreatedAt')) or timezone.now(),
            updated_at=parse_dt(r.get('UpdatedAt')) or timezone.now(),
        ))
    SupportTicket.objects.bulk_create(batch, ignore_conflicts=True)
    reset_sequence('support_tickets')
    print(f'  Imported {len(batch)} tickets')


def import_support_comments():
    print('\n=== Importing Support Comments (143 rows) ===')
    data = read_xlsx('SupportTicketComments.xlsx')
    if not data:
        return
    SupportTicketComment.objects.all().delete()
    batch = []
    for r in data:
        batch.append(SupportTicketComment(
            id=parse_int(r.get('Id')),
            ticket_id=parse_int(r.get('TicketId')),
            user_id=parse_int(r.get('UserId')),
            comment=s(r.get('Comment')),
            created_at=parse_dt(r.get('CreatedAt')) or timezone.now(),
        ))
    SupportTicketComment.objects.bulk_create(batch, ignore_conflicts=True)
    reset_sequence('support_ticket_comments')
    print(f'  Imported {len(batch)} comments')


def import_kpi_targets():
    print('\n=== Importing KPI Targets (6 rows) ===')
    data = read_xlsx('KPITargets.xlsx')
    if not data:
        return
    KPITarget.objects.all().delete()
    batch = []
    for r in data:
        batch.append(KPITarget(
            id=parse_int(r.get('Id')),
            kpi_key=s(r.get('KPIKey')),
            target_value=parse_dec(r.get('TargetValue')),
            label=s(r.get('Label')),
            updated_by=s(r.get('UpdatedBy')) or None,
        ))
    KPITarget.objects.bulk_create(batch, ignore_conflicts=True)
    reset_sequence('kpi_targets')
    print(f'  Imported {len(batch)} KPI targets')


if __name__ == '__main__':
    print('Starting data import from Excel exports...')
    print(f'Source: {EXPORTS_DIR}')

    import_support_categories()  # Must be before tickets (FK)
    import_users()
    import_clients()
    import_audit_log()
    import_invitations()
    import_epvs()
    import_support_tickets()
    import_support_comments()
    import_kpi_targets()

    # Print summary
    print('\n========== IMPORT COMPLETE ==========')
    print(f'  Users:            {User.objects.count()}')
    print(f'  Client Records:   {ClientRecord.objects.count()}')
    print(f'  Audit Log:        {ClientAuditLog.objects.count()}')
    print(f'  Invitations:      {Invitation.objects.count()}')
    print(f'  EPVs:             {EggProductionVerification.objects.count()}')
    print(f'  Support Cats:     {SupportTicketCategory.objects.count()}')
    print(f'  Support Tickets:  {SupportTicket.objects.count()}')
    print(f'  Ticket Comments:  {SupportTicketComment.objects.count()}')
    print(f'  KPI Targets:      {KPITarget.objects.count()}')
    print('=====================================')
