import secrets
import math
import logging

from django.conf import settings
from django.db.models import Q
from django.views.decorators.csrf import csrf_exempt
from rest_framework.decorators import api_view
from rest_framework.response import Response
from rest_framework import status

from api.models import User, ClientRecord, Invitation, ClientAuditLog
from api.services.email_service import send_email, build_invite_email

logger = logging.getLogger(__name__)


@csrf_exempt
@api_view(['GET'])
def get_company(request, client_record_id):
    """GET /api/company/:clientRecordId - get company details."""
    try:
        try:
            record = ClientRecord.objects.get(id=client_record_id)
        except ClientRecord.DoesNotExist:
            return Response(
                {'message': 'Company not found.'},
                status=status.HTTP_404_NOT_FOUND,
            )

        return Response({'company': record.to_js_dict()})

    except Exception as e:
        logger.error('Company fetch error: %s', e)
        return Response(
            {'message': 'Server error.'},
            status=status.HTTP_500_INTERNAL_SERVER_ERROR,
        )


@csrf_exempt
@api_view(['PUT'])
def update_company(request, client_record_id):
    """PUT /api/company/:clientRecordId - update company details with audit logging."""
    updates = request.data.get('updates')
    changed_by = request.data.get('changedBy')

    if not updates or not changed_by:
        return Response(
            {'message': 'updates and changedBy are required.'},
            status=status.HTTP_400_BAD_REQUEST,
        )

    try:
        try:
            record = ClientRecord.objects.get(id=client_record_id)
        except ClientRecord.DoesNotExist:
            return Response(
                {'message': 'Record not found.'},
                status=status.HTTP_404_NOT_FOUND,
            )

        audit_entries = []

        for field, new_value in updates.items():
            if field not in ClientRecord.EDITABLE_FIELDS:
                continue

            django_field = ClientRecord.FIELD_MAP.get(field)
            if not django_field:
                continue

            old_value = str(getattr(record, django_field, '') or '')
            new_value_str = str(new_value)

            if old_value == new_value_str:
                continue

            setattr(record, django_field, new_value_str)
            audit_entries.append({
                'field': field,
                'oldValue': old_value,
                'newValue': new_value_str,
            })

        if not audit_entries:
            return Response({'message': 'No changes detected.'})

        record.save()

        # Log each changed field
        for entry in audit_entries:
            ClientAuditLog.objects.create(
                record_id=client_record_id,
                field_name=entry['field'],
                old_value=entry['oldValue'],
                new_value=entry['newValue'],
                changed_by=changed_by,
            )

        return Response({
            'message': f"{len(audit_entries)} field(s) updated.",
            'changes': audit_entries,
        })

    except Exception as e:
        logger.error('Company update error: %s', e)
        return Response(
            {'message': 'Server error updating company.'},
            status=status.HTTP_500_INTERNAL_SERVER_ERROR,
        )


@csrf_exempt
@api_view(['GET'])
def get_company_users(request, client_record_id):
    """GET /api/company/:clientRecordId/users - list users allocated to this company."""
    try:
        # Get accepted invitation emails for this company
        accepted_invites = Invitation.objects.filter(
            client_record_id=client_record_id,
            status='Accepted',
        ).values_list('email', flat=True)

        # Get users matching those emails (case-insensitive)
        email_list = [e.lower() for e in accepted_invites]
        users = User.objects.filter(
            email__in=email_list,
        ).order_by('-created_at').distinct()

        users_data = [
            {
                'Id': u.id,
                'FirstName': u.first_name,
                'LastName': u.last_name,
                'Email': u.email,
                'Role': u.role,
                'CreatedAt': u.created_at.isoformat() if u.created_at else None,
            }
            for u in users
        ]

        # Get pending invites
        pending = Invitation.objects.filter(
            client_record_id=client_record_id,
            status='Pending',
        ).order_by('-created_at')

        pending_data = [
            {
                'Id': inv.id,
                'Email': inv.email,
                'Role': inv.role,
                'CreatedAt': inv.created_at.isoformat() if inv.created_at else None,
            }
            for inv in pending
        ]

        return Response({
            'users': users_data,
            'pendingInvites': pending_data,
        })

    except Exception as e:
        logger.error('Company users fetch error: %s', e)
        return Response(
            {'message': 'Server error.'},
            status=status.HTTP_500_INTERNAL_SERVER_ERROR,
        )


@csrf_exempt
@api_view(['POST'])
def invite_company_user(request, client_record_id):
    """POST /api/company/:clientRecordId/invite - invite a user to this company."""
    email = request.data.get('email')
    role = request.data.get('role')
    invited_by = request.data.get('invitedBy')

    if not email or not role or not invited_by:
        return Response(
            {'message': 'email, role, and invitedBy are required.'},
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
                {'message': 'Company not found.'},
                status=status.HTTP_404_NOT_FOUND,
            )

        # Check for existing user
        if User.objects.filter(email=email).exists():
            return Response(
                {'message': 'A user with this email already exists.'},
                status=status.HTTP_409_CONFLICT,
            )

        # Expire old pending invites for this email + company
        Invitation.objects.filter(
            client_record_id=client_record_id,
            email=email,
            status='Pending',
        ).update(status='Expired')

        token = secrets.token_hex(32)

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
        logger.error('Company invite error: %s', e)
        return Response(
            {'message': 'Failed to send invitation.'},
            status=status.HTTP_500_INTERNAL_SERVER_ERROR,
        )


@csrf_exempt
@api_view(['DELETE'])
def delete_company_user(request, client_record_id, user_id):
    """DELETE /api/company/:clientRecordId/users/:userId - remove a user from this company."""
    try:
        # Verify the user belongs to this company via accepted invitation
        try:
            user = User.objects.get(id=user_id)
        except User.DoesNotExist:
            return Response(
                {'message': 'User not found in this company.'},
                status=status.HTTP_404_NOT_FOUND,
            )

        belongs = Invitation.objects.filter(
            client_record_id=client_record_id,
            email=user.email,
            status='Accepted',
        ).exists()

        if not belongs:
            return Response(
                {'message': 'User not found in this company.'},
                status=status.HTTP_404_NOT_FOUND,
            )

        user.delete()

        return Response({'message': 'User removed.'})

    except Exception as e:
        logger.error('Company user delete error: %s', e)
        return Response(
            {'message': 'Server error.'},
            status=status.HTTP_500_INTERNAL_SERVER_ERROR,
        )


@csrf_exempt
@api_view(['GET'])
def get_company_audit_log(request, client_record_id):
    """GET /api/company/:clientRecordId/audit-log - paginated audit log."""
    try:
        page = int(request.query_params.get('page', 1))
    except (ValueError, TypeError):
        page = 1

    try:
        limit = int(request.query_params.get('limit', 50))
    except (ValueError, TypeError):
        limit = 50

    offset = (page - 1) * limit

    try:
        total = ClientAuditLog.objects.filter(record_id=client_record_id).count()

        logs = ClientAuditLog.objects.filter(
            record_id=client_record_id,
        ).order_by('-changed_at')[offset:offset + limit]

        data = [log.to_js_dict() for log in logs]

        return Response({
            'data': data,
            'page': page,
            'limit': limit,
            'total': total,
            'totalPages': math.ceil(total / limit) if limit > 0 else 0,
        })

    except Exception as e:
        logger.error('Company audit log error: %s', e)
        return Response(
            {'message': 'Server error.'},
            status=status.HTTP_500_INTERNAL_SERVER_ERROR,
        )
