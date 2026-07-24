from django.db import models


class User(models.Model):
    first_name = models.CharField(max_length=100)
    last_name = models.CharField(max_length=100)
    email = models.EmailField(max_length=255, unique=True)
    password_hash = models.CharField(max_length=255)
    role = models.CharField(max_length=50, default='User')
    is_active = models.BooleanField(default=True)
    inspector_province = models.CharField(max_length=100, null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = 'users'

    def __str__(self):
        return f"{self.first_name} {self.last_name} ({self.role})"


class ClientRecord(models.Model):
    business_name = models.CharField(max_length=255, blank=True, default='')
    account_code = models.CharField(max_length=100, blank=True, default='')
    email = models.CharField(max_length=255, blank=True, default='')
    manual_email = models.CharField(max_length=255, blank=True, default='')
    town = models.CharField(max_length=255, blank=True, default='')
    corporate_group = models.CharField(max_length=255, blank=True, default='')
    group_type = models.CharField(max_length=100, blank=True, default='')
    facility_type = models.CharField(max_length=100, blank=True, default='')
    facility_province = models.CharField(max_length=100, blank=True, default='')
    company_reg_number = models.CharField(max_length=100, blank=True, default='')
    physical_address = models.TextField(blank=True, default='')
    vat_number = models.CharField(max_length=100, blank=True, default='')
    abattoir_owner_name = models.CharField(max_length=255, blank=True, default='')
    abattoir_owner_cell = models.CharField(max_length=50, blank=True, default='')
    abattoir_owner_email = models.CharField(max_length=255, blank=True, default='')
    accounts_contact_name = models.CharField(max_length=255, blank=True, default='')
    accounts_telephone = models.CharField(max_length=50, blank=True, default='')
    accounts_email = models.CharField(max_length=255, blank=True, default='')
    abattoir_manager_name = models.CharField(max_length=255, blank=True, default='')
    abattoir_manager_cell = models.CharField(max_length=50, blank=True, default='')
    abattoir_manager_email = models.CharField(max_length=255, blank=True, default='')
    verified_at = models.DateTimeField(null=True, blank=True)
    verified_by = models.CharField(max_length=255, null=True, blank=True)
    epv_cycle_status = models.CharField(max_length=50, null=True, blank=True)
    assigned_inspector = models.ForeignKey(
        User, null=True, blank=True, on_delete=models.SET_NULL,
        db_column='assigned_inspector_id', related_name='assigned_facilities',
    )

    class Meta:
        db_table = 'client_records'

    # Map between JS field names and Django field names
    FIELD_MAP = {
        'BusinessName': 'business_name',
        'AccountCode': 'account_code',
        'Email': 'email',
        'ManualEmail': 'manual_email',
        'Town': 'town',
        'FacilityType': 'facility_type',
        'FacilityProvince': 'facility_province',
        'CompanyRegNumber': 'company_reg_number',
        'PhysicalAddress': 'physical_address',
        'VATNumber': 'vat_number',
        'AbattoirOwnerName': 'abattoir_owner_name',
        'AbattoirOwnerCell': 'abattoir_owner_cell',
        'AbattoirOwnerEmail': 'abattoir_owner_email',
        'AccountsContactName': 'accounts_contact_name',
        'AccountsTelephone': 'accounts_telephone',
        'AccountsEmail': 'accounts_email',
        'AbattoirManagerName': 'abattoir_manager_name',
        'AbattoirManagerCell': 'abattoir_manager_cell',
        'AbattoirManagerEmail': 'abattoir_manager_email',
        'CorporateGroup': 'corporate_group',
        'GroupType': 'group_type',
        'AssignedInspectorId': 'assigned_inspector_id',
    }

    EDITABLE_FIELDS = [
        'BusinessName', 'AccountCode', 'Email',
        'Town', 'FacilityType', 'FacilityProvince',
        'CompanyRegNumber', 'PhysicalAddress', 'VATNumber',
        'AbattoirOwnerName', 'AbattoirOwnerCell', 'AbattoirOwnerEmail',
        'AccountsContactName', 'AccountsTelephone', 'AccountsEmail',
        'AbattoirManagerName', 'AbattoirManagerCell', 'AbattoirManagerEmail',
        'AssignedInspectorId',
    ]

    def assigned_inspector_name(self):
        if not self.assigned_inspector:
            return None
        return f"{self.assigned_inspector.first_name} {self.assigned_inspector.last_name}".strip()

    def to_js_dict(self):
        return {
            'Id': self.id,
            'BusinessName': self.business_name,
            'AccountCode': self.account_code,
            'Email': self.email,
            'ManualEmail': self.manual_email,
            'Town': self.town,
            'CorporateGroup': self.corporate_group,
            'GroupType': self.group_type,
            'FacilityType': self.facility_type,
            'FacilityProvince': self.facility_province,
            'CompanyRegNumber': self.company_reg_number,
            'PhysicalAddress': self.physical_address,
            'VATNumber': self.vat_number,
            'AbattoirOwnerName': self.abattoir_owner_name,
            'AbattoirOwnerCell': self.abattoir_owner_cell,
            'AbattoirOwnerEmail': self.abattoir_owner_email,
            'AccountsContactName': self.accounts_contact_name,
            'AccountsTelephone': self.accounts_telephone,
            'AccountsEmail': self.accounts_email,
            'AbattoirManagerName': self.abattoir_manager_name,
            'AbattoirManagerCell': self.abattoir_manager_cell,
            'AbattoirManagerEmail': self.abattoir_manager_email,
            'VerifiedAt': self.verified_at.isoformat() if self.verified_at else None,
            'VerifiedBy': self.verified_by,
            'EPVCycleStatus': self.epv_cycle_status,
            'AssignedInspectorId': self.assigned_inspector_id,
            'AssignedInspectorName': self.assigned_inspector_name(),
        }


class ClientAuditLog(models.Model):
    record_id = models.IntegerField()
    field_name = models.CharField(max_length=255)
    old_value = models.TextField(null=True, blank=True)
    new_value = models.TextField(null=True, blank=True)
    changed_by = models.CharField(max_length=255)
    user_role = models.CharField(max_length=50, null=True, blank=True)
    changed_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = 'client_audit_log'

    def to_js_dict(self):
        return {
            'Id': self.id,
            'RecordId': self.record_id,
            'FieldName': self.field_name,
            'OldValue': self.old_value,
            'NewValue': self.new_value,
            'ChangedBy': self.changed_by,
            'UserRole': self.user_role,
            'ChangedAt': self.changed_at.isoformat() if self.changed_at else None,
        }


class Invitation(models.Model):
    client_record_id = models.IntegerField()
    email = models.CharField(max_length=255)
    role = models.CharField(max_length=50)
    token = models.CharField(max_length=255, unique=True)
    invited_by = models.CharField(max_length=255)
    status = models.CharField(max_length=20, default='Pending')
    accepted_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = 'invitations'


class EggProductionVerification(models.Model):
    client_record_id = models.IntegerField()
    period_month = models.IntegerField()
    period_year = models.IntegerField()
    token = models.CharField(max_length=255, unique=True)
    reference_number = models.CharField(max_length=50, null=True, blank=True)
    status = models.CharField(max_length=20, default='Pending')
    sent_at = models.DateTimeField(auto_now_add=True)
    completed_at = models.DateTimeField(null=True, blank=True)
    completed_by = models.CharField(max_length=255, null=True, blank=True)
    # Text fields
    business_name = models.CharField(max_length=255, blank=True, default='')
    facility_type = models.CharField(max_length=100, blank=True, default='')
    facility_province = models.CharField(max_length=100, blank=True, default='')
    trading_name = models.CharField(max_length=255, blank=True, default='')
    authorized_person_name = models.CharField(max_length=255, blank=True, default='')
    position_in_company = models.CharField(max_length=255, blank=True, default='')
    telephone_number = models.CharField(max_length=50, blank=True, default='')
    cell_phone_number = models.CharField(max_length=50, blank=True, default='')
    email_address = models.CharField(max_length=255, blank=True, default='')
    variance_reason = models.TextField(blank=True, default='')
    # Numeric fields - Eggs
    opening_stock = models.DecimalField(max_digits=18, decimal_places=2, default=0)
    graded_eggs_purchased = models.DecimalField(max_digits=18, decimal_places=2, default=0)
    ungraded_eggs_purchased = models.DecimalField(max_digits=18, decimal_places=2, default=0)
    market_returns = models.DecimalField(max_digits=18, decimal_places=2, default=0)
    machine_loss = models.DecimalField(max_digits=18, decimal_places=2, default=0)
    sent_to_pulp = models.DecimalField(max_digits=18, decimal_places=2, default=0)
    destroyed = models.DecimalField(max_digits=18, decimal_places=2, default=0)
    sold_to_trade = models.DecimalField(max_digits=18, decimal_places=2, default=0)
    sold_to_staff = models.DecimalField(max_digits=18, decimal_places=2, default=0)
    sold_through_farm_stall = models.DecimalField(max_digits=18, decimal_places=2, default=0)
    transferred_to_other_producers = models.DecimalField(max_digits=18, decimal_places=2, default=0)
    # Numeric fields - Pulp
    pulp_opening_stock = models.DecimalField(max_digits=18, decimal_places=2, default=0)
    pulp_purchased = models.DecimalField(max_digits=18, decimal_places=2, default=0)
    pulp_converted = models.DecimalField(max_digits=18, decimal_places=2, default=0)
    pulp_sold_to_trade = models.DecimalField(max_digits=18, decimal_places=2, default=0)
    # Egg powder sold to trade, in KG (1 kg whole egg powder ~ 6.7 dozen eggs)
    powder_sold_to_trade = models.DecimalField(max_digits=18, decimal_places=2, default=0)
    pulp_sold_to_producers = models.DecimalField(max_digits=18, decimal_places=2, default=0)
    # Calculated totals
    total_b = models.DecimalField(max_digits=18, decimal_places=2, default=0)
    total_c = models.DecimalField(max_digits=18, decimal_places=2, default=0)
    total_d = models.DecimalField(max_digits=18, decimal_places=2, default=0)
    total_e = models.DecimalField(max_digits=18, decimal_places=2, default=0)
    levy_amount = models.DecimalField(max_digits=18, decimal_places=4, default=0)
    closing_stock = models.DecimalField(max_digits=18, decimal_places=2, default=0)
    actual_closing_stock = models.DecimalField(max_digits=18, decimal_places=2, default=0)
    loss_gain = models.DecimalField(max_digits=18, decimal_places=2, default=0)
    # POP
    pop_file_path = models.CharField(max_length=500, null=True, blank=True)
    pop_uploaded_at = models.DateTimeField(null=True, blank=True)
    pop_uploaded_by = models.CharField(max_length=255, null=True, blank=True)
    pop_comment = models.TextField(null=True, blank=True)
    # Payment
    client_payment_status = models.CharField(max_length=50, null=True, blank=True)
    # Reconciliation
    is_reconciled = models.BooleanField(default=False)
    reconciled_by = models.CharField(max_length=255, null=True, blank=True)
    reconciled_at = models.DateTimeField(null=True, blank=True)
    reconciled_amount = models.DecimalField(max_digits=18, decimal_places=2, null=True, blank=True)
    # Verification
    is_verified = models.BooleanField(default=False)
    verified_by = models.CharField(max_length=255, null=True, blank=True)
    verified_at = models.DateTimeField(null=True, blank=True)
    inspector_comment = models.TextField(null=True, blank=True)
    # Inspection
    manual_inspection = models.BooleanField(default=False)
    manual_inspection_by = models.CharField(max_length=255, null=True, blank=True)
    manual_inspection_at = models.DateTimeField(null=True, blank=True)
    # Inspector EPV
    epv_type = models.CharField(max_length=20, default='Client')
    inspector_id = models.IntegerField(null=True, blank=True)
    linked_epv_id = models.IntegerField(null=True, blank=True)

    class Meta:
        db_table = 'egg_production_verifications'

    # Map JS field names to Django field names
    TEXT_FIELD_MAP = {
        'BusinessName': 'business_name',
        'FacilityType': 'facility_type',
        'FacilityProvince': 'facility_province',
        'TradingName': 'trading_name',
        'AuthorizedPersonName': 'authorized_person_name',
        'PositionInCompany': 'position_in_company',
        'TelephoneNumber': 'telephone_number',
        'CellPhoneNumber': 'cell_phone_number',
        'EmailAddress': 'email_address',
        'VarianceReason': 'variance_reason',
    }

    NUMERIC_FIELD_MAP = {
        'OpeningStock': 'opening_stock',
        'GradedEggsPurchased': 'graded_eggs_purchased',
        'UngradedEggsPurchased': 'ungraded_eggs_purchased',
        'MarketReturns': 'market_returns',
        'MachineLoss': 'machine_loss',
        'SentToPulp': 'sent_to_pulp',
        'Destroyed': 'destroyed',
        'SoldToTrade': 'sold_to_trade',
        'SoldToStaff': 'sold_to_staff',
        'SoldThroughFarmStall': 'sold_through_farm_stall',
        'TransferredToOtherProducers': 'transferred_to_other_producers',
        'PulpOpeningStock': 'pulp_opening_stock',
        'PulpPurchased': 'pulp_purchased',
        'PulpConverted': 'pulp_converted',
        'PulpSoldToTrade': 'pulp_sold_to_trade',
        'PowderSoldToTrade': 'powder_sold_to_trade',
        'PulpSoldToProducers': 'pulp_sold_to_producers',
    }

    def to_js_dict(self):
        d = {
            'Id': self.id,
            'ClientRecordId': self.client_record_id,
            'PeriodMonth': self.period_month,
            'PeriodYear': self.period_year,
            'Token': self.token,
            'ReferenceNumber': self.reference_number,
            'Status': self.status,
            'SentAt': self.sent_at.isoformat() if self.sent_at else None,
            'CompletedAt': self.completed_at.isoformat() if self.completed_at else None,
            'CompletedBy': self.completed_by,
            'BusinessName': self.business_name,
            'FacilityType': self.facility_type,
            'FacilityProvince': self.facility_province,
            'TradingName': self.trading_name,
            'AuthorizedPersonName': self.authorized_person_name,
            'PositionInCompany': self.position_in_company,
            'TelephoneNumber': self.telephone_number,
            'CellPhoneNumber': self.cell_phone_number,
            'EmailAddress': self.email_address,
            'VarianceReason': self.variance_reason,
            'OpeningStock': float(self.opening_stock),
            'GradedEggsPurchased': float(self.graded_eggs_purchased),
            'UngradedEggsPurchased': float(self.ungraded_eggs_purchased),
            'MarketReturns': float(self.market_returns),
            'MachineLoss': float(self.machine_loss),
            'SentToPulp': float(self.sent_to_pulp),
            'Destroyed': float(self.destroyed),
            'SoldToTrade': float(self.sold_to_trade),
            'SoldToStaff': float(self.sold_to_staff),
            'SoldThroughFarmStall': float(self.sold_through_farm_stall),
            'TransferredToOtherProducers': float(self.transferred_to_other_producers),
            'PulpOpeningStock': float(self.pulp_opening_stock),
            'PulpPurchased': float(self.pulp_purchased),
            'PulpConverted': float(self.pulp_converted),
            'PulpSoldToTrade': float(self.pulp_sold_to_trade),
            'PowderSoldToTrade': float(self.powder_sold_to_trade or 0),
            'PulpSoldToProducers': float(self.pulp_sold_to_producers),
            'TotalB': float(self.total_b),
            'TotalC': float(self.total_c),
            'TotalD': float(self.total_d),
            'TotalE': float(self.total_e),
            'LevyAmount': float(self.levy_amount),
            'ClosingStock': float(self.closing_stock),
            'ActualClosingStock': float(self.actual_closing_stock),
            'LossGain': float(self.loss_gain),
            'POPFilePath': self.pop_file_path,
            'POPUploadedAt': self.pop_uploaded_at.isoformat() if self.pop_uploaded_at else None,
            'POPUploadedBy': self.pop_uploaded_by,
            'POPComment': self.pop_comment,
            'ClientPaymentStatus': self.client_payment_status,
            'IsReconciled': self.is_reconciled,
            'ReconciledBy': self.reconciled_by,
            'ReconciledAt': self.reconciled_at.isoformat() if self.reconciled_at else None,
            'ReconciledAmount': float(self.reconciled_amount) if self.reconciled_amount is not None else None,
            'IsVerified': self.is_verified,
            'VerifiedBy': self.verified_by,
            'VerifiedAt': self.verified_at.isoformat() if self.verified_at else None,
            'InspectorComment': self.inspector_comment,
            'ManualInspection': self.manual_inspection,
            'ManualInspectionBy': self.manual_inspection_by,
            'ManualInspectionAt': self.manual_inspection_at.isoformat() if self.manual_inspection_at else None,
            'EPVType': self.epv_type,
            'InspectorId': self.inspector_id,
            'LinkedEPVId': self.linked_epv_id,
        }
        return d


class EPVAuditLog(models.Model):
    verification_id = models.IntegerField()
    field_name = models.CharField(max_length=255)
    old_value = models.TextField(null=True, blank=True)
    new_value = models.TextField(null=True, blank=True)
    changed_by = models.CharField(max_length=255)
    changed_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = 'epv_audit_log'


class SupportTicketCategory(models.Model):
    name = models.CharField(max_length=100)
    category_type = models.CharField(max_length=20)
    is_active = models.BooleanField(default=True)
    sort_order = models.IntegerField(default=0)

    class Meta:
        db_table = 'support_ticket_categories'


class SupportTicket(models.Model):
    category = models.ForeignKey(SupportTicketCategory, on_delete=models.CASCADE)
    category_type = models.CharField(max_length=20)
    subject = models.CharField(max_length=255)
    description = models.TextField(blank=True, default='')
    priority = models.CharField(max_length=20, default='Medium')
    status = models.CharField(max_length=20, default='Open')
    created_by_user_id = models.IntegerField()
    client_record_id = models.IntegerField(null=True, blank=True)
    assigned_to_user_id = models.IntegerField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = 'support_tickets'


class SupportTicketComment(models.Model):
    ticket = models.ForeignKey(SupportTicket, on_delete=models.CASCADE, related_name='comments')
    user_id = models.IntegerField()
    comment = models.TextField()
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = 'support_ticket_comments'


class KPITarget(models.Model):
    kpi_key = models.CharField(max_length=50, unique=True)
    target_value = models.DecimalField(max_digits=10, decimal_places=2)
    label = models.CharField(max_length=100)
    updated_at = models.DateTimeField(auto_now=True)
    updated_by = models.CharField(max_length=255, null=True, blank=True)

    class Meta:
        db_table = 'kpi_targets'


class EPVInvoice(models.Model):
    verification_id = models.IntegerField()
    client_record_id = models.IntegerField()
    invoice_number = models.CharField(max_length=50)
    reference_number = models.CharField(max_length=50, null=True, blank=True)
    amount = models.DecimalField(max_digits=18, decimal_places=2)
    file_path = models.CharField(max_length=500)
    generated_by = models.CharField(max_length=255)
    generated_at = models.DateTimeField(auto_now_add=True)
    sent_at = models.DateTimeField(null=True, blank=True)
    sent_to = models.TextField(null=True, blank=True)
    sent_by = models.CharField(max_length=255, null=True, blank=True)

    class Meta:
        db_table = 'epv_invoices'


class EmailSendLog(models.Model):
    client_record_id = models.IntegerField()
    email_address = models.CharField(max_length=255)
    email_type = models.CharField(max_length=50)
    subject = models.CharField(max_length=500, null=True, blank=True)
    status = models.CharField(max_length=20)
    error_message = models.TextField(null=True, blank=True)
    sent_at = models.DateTimeField(auto_now_add=True)
    sent_by = models.CharField(max_length=255, null=True, blank=True)

    class Meta:
        db_table = 'email_send_log'
