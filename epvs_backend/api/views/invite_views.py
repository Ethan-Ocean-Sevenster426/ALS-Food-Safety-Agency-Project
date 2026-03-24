import secrets
import logging

import bcrypt
from django.conf import settings
from django.utils import timezone
from django.views.decorators.csrf import csrf_exempt
from rest_framework.decorators import api_view
from rest_framework.response import Response
from rest_framework import status

from api.models import User, ClientRecord, Invitation, ClientAuditLog
from api.services.email_service import send_email, build_invite_email

logger = logging.getLogger(__name__)


@csrf_exempt
@api_view(['POST'])
def send_invite(request):
    """POST /api/invites - send an invitation."""
    client_record_id = request.data.get('clientRecordId')
    role = request.data.get('role')
    invited_by = request.data.get('invitedBy')

    if not client_record_id or not role or not invited_by:
        return Response(
            {'message': 'clientRecordId, role, and invitedBy are required.'},
            status=status.HTTP_400_BAD_REQUEST,
        )

    if role not in ('Company Admin', 'User'):
        return Response(
            {'message': 'Role must be Company Admin or User.'},
            status=status.HTTP_400_BAD_REQUEST,
        )

    try:
        try:
            record = ClientRecord.objects.get(id=client_record_id)
        except ClientRecord.DoesNotExist:
            return Response(
                {'message': 'Client record not found.'},
                status=status.HTTP_404_NOT_FOUND,
            )

        email = record.email
        if not email:
            return Response(
                {'message': 'This client has no email address on file.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        # Expire old pending invites for this client record
        Invitation.objects.filter(
            client_record_id=client_record_id,
            status='Pending',
        ).update(status='Expired')

        # Generate unique token
        token = secrets.token_hex(32)

        # Save invitation
        Invitation.objects.create(
            client_record_id=client_record_id,
            email=email,
            role=role,
            token=token,
            invited_by=invited_by,
        )

        # Send invite email
        invite_url = f"{settings.FRONTEND_URL}/accept-invite/{token}"
        email_content = build_invite_email(
            business_name=record.business_name,
            role=role,
            invite_url=invite_url,
        )

        send_email(
            to=email,
            subject=email_content['subject'],
            html=email_content['html'],
        )

        return Response({'message': f'Invitation sent to {email} as {role}.'})

    except Exception as e:
        logger.error('Invite error: %s', e)
        return Response(
            {'message': 'Failed to send invitation.'},
            status=status.HTTP_500_INTERNAL_SERVER_ERROR,
        )


@csrf_exempt
@api_view(['GET'])
def get_invite(request, token):
    """GET /api/invites/:token - get invite details for registration page."""
    try:
        try:
            invite = Invitation.objects.get(token=token)
        except Invitation.DoesNotExist:
            return Response(
                {'message': 'Invalid invitation link.'},
                status=status.HTTP_404_NOT_FOUND,
            )

        if invite.status != 'Pending':
            return Response(
                {'message': 'This invitation has already been used or expired.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        # Get the associated client record
        try:
            client = ClientRecord.objects.get(id=invite.client_record_id)
        except ClientRecord.DoesNotExist:
            return Response(
                {'message': 'Invalid invitation link.'},
                status=status.HTTP_404_NOT_FOUND,
            )

        # Build response matching Express join query fields
        invite_data = {
            'Id': invite.id,
            'ClientRecordId': invite.client_record_id,
            'Email': invite.email,
            'Role': invite.role,
            'Token': invite.token,
            'InvitedBy': invite.invited_by,
            'Status': invite.status,
            'AcceptedAt': invite.accepted_at.isoformat() if invite.accepted_at else None,
            'CreatedAt': invite.created_at.isoformat() if invite.created_at else None,
            'BusinessName': client.business_name,
            'AccountCode': client.account_code,
            'ClientEmail': client.email,
            'ManualEmail': client.manual_email,
            'Town': client.town,
            'FacilityType': client.facility_type,
            'FacilityProvince': client.facility_province,
            'CompanyRegNumber': client.company_reg_number,
            'PhysicalAddress': client.physical_address,
            'VATNumber': client.vat_number,
            'AbattoirOwnerName': client.abattoir_owner_name,
            'AbattoirOwnerCell': client.abattoir_owner_cell,
            'AbattoirOwnerEmail': client.abattoir_owner_email,
            'AccountsContactName': client.accounts_contact_name,
            'AccountsTelephone': client.accounts_telephone,
            'AccountsEmail': client.accounts_email,
            'AbattoirManagerName': client.abattoir_manager_name,
            'AbattoirManagerCell': client.abattoir_manager_cell,
            'AbattoirManagerEmail': client.abattoir_manager_email,
        }

        return Response({'invite': invite_data})

    except Exception as e:
        logger.error('Invite lookup error: %s', e)
        return Response(
            {'message': 'Server error.'},
            status=status.HTTP_500_INTERNAL_SERVER_ERROR,
        )


@csrf_exempt
@api_view(['POST'])
def accept_invite(request, token):
    """POST /api/invites/:token/accept - accept invite, create user, set password."""
    first_name = request.data.get('firstName')
    last_name = request.data.get('lastName')
    password = request.data.get('password')
    verification_data = request.data.get('verificationData')

    if not first_name or not last_name or not password:
        return Response(
            {'message': 'First name, last name, and password are required.'},
            status=status.HTTP_400_BAD_REQUEST,
        )

    if len(password) < 6:
        return Response(
            {'message': 'Password must be at least 6 characters.'},
            status=status.HTTP_400_BAD_REQUEST,
        )

    try:
        # Get pending invite
        try:
            invite = Invitation.objects.get(token=token, status='Pending')
        except Invitation.DoesNotExist:
            return Response(
                {'message': 'Invalid or expired invitation.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        # Check if user already exists
        if User.objects.filter(email=invite.email).exists():
            return Response(
                {'message': 'An account with this email already exists.'},
                status=status.HTTP_409_CONFLICT,
            )

        # Create user with bcrypt hashed password
        salt = bcrypt.gensalt(rounds=10)
        password_hash = bcrypt.hashpw(password.encode('utf-8'), salt).decode('utf-8')

        User.objects.create(
            first_name=first_name,
            last_name=last_name,
            email=invite.email,
            password_hash=password_hash,
            role=invite.role,
        )

        # Mark invite as accepted
        invite.status = 'Accepted'
        invite.accepted_at = timezone.now()
        invite.save()

        # If Company Admin and verification data provided, update client record
        if invite.role == 'Company Admin' and verification_data:
            fields = [
                'BusinessName', 'FacilityProvince', 'CompanyRegNumber',
                'PhysicalAddress', 'VATNumber',
                'AbattoirOwnerName', 'AbattoirOwnerCell', 'AbattoirOwnerEmail',
                'AccountsContactName', 'AccountsTelephone', 'AccountsEmail',
                'AbattoirManagerName', 'AbattoirManagerCell', 'AbattoirManagerEmail',
            ]

            changed_by = f"{first_name} {last_name} ({invite.email}) [Registration]"

            # Fetch old record for audit comparison
            try:
                record = ClientRecord.objects.get(id=invite.client_record_id)
            except ClientRecord.DoesNotExist:
                record = None

            if record:
                audit_entries = []

                for field in fields:
                    if field in verification_data:
                        new_val = str(verification_data[field] or '')
                        django_field = ClientRecord.FIELD_MAP.get(field)
                        if django_field:
                            old_val = str(getattr(record, django_field, '') or '')
                            setattr(record, django_field, new_val)
                            if new_val != old_val:
                                audit_entries.append({
                                    'field': field,
                                    'old_value': old_val,
                                    'new_value': new_val,
                                })

                record.verified_at = timezone.now()
                record.verified_by = f"{first_name} {last_name} ({invite.email})"
                record.save()

                # Log each changed field
                for entry in audit_entries:
                    ClientAuditLog.objects.create(
                        record_id=invite.client_record_id,
                        field_name=entry['field'],
                        old_value=entry['old_value'],
                        new_value=entry['new_value'],
                        changed_by=changed_by,
                    )

                # Log the verification event
                ClientAuditLog.objects.create(
                    record_id=invite.client_record_id,
                    field_name='_VERIFIED',
                    old_value='',
                    new_value=f"Verified by {first_name} {last_name} ({invite.email})",
                    changed_by=changed_by,
                )

        return Response({'message': 'Account created successfully. You can now sign in.'})

    except Exception as e:
        logger.error('Accept invite error: %s', e)
        return Response(
            {'message': 'Server error accepting invitation.'},
            status=status.HTTP_500_INTERNAL_SERVER_ERROR,
        )
