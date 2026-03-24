import math

from django.db.models import Q
from django.utils import timezone
from django.views.decorators.csrf import csrf_exempt

from rest_framework.decorators import api_view
from rest_framework.response import Response
from rest_framework import status

from api.models import ClientRecord, ClientAuditLog, Invitation, EggProductionVerification, SupportTicket


@csrf_exempt
@api_view(['GET'])
def list_clients(request):
    try:
        page = int(request.query_params.get('page', 1))
        limit = int(request.query_params.get('limit', 50))
        search = request.query_params.get('search', '')
        offset = (page - 1) * limit

        queryset = ClientRecord.objects.all()

        if search:
            queryset = queryset.filter(
                Q(business_name__icontains=search)
                | Q(account_code__icontains=search)
                | Q(email__icontains=search)
                | Q(town__icontains=search)
                | Q(facility_province__icontains=search)
            )

        total = queryset.count()
        records = queryset.order_by('id')[offset : offset + limit]

        data = []
        for r in records:
            data.append({
                'Id': r.id,
                'BusinessName': r.business_name,
                'AccountCode': r.account_code,
                'Email': r.email,
                'Town': r.town,
                'FacilityType': r.facility_type,
                'FacilityProvince': r.facility_province,
                'CompanyRegNumber': r.company_reg_number,
                'PhysicalAddress': r.physical_address,
                'VATNumber': r.vat_number,
                'AbattoirOwnerName': r.abattoir_owner_name,
                'AbattoirOwnerCell': r.abattoir_owner_cell,
                'AbattoirOwnerEmail': r.abattoir_owner_email,
                'AccountsContactName': r.accounts_contact_name,
                'AccountsTelephone': r.accounts_telephone,
                'AccountsEmail': r.accounts_email,
                'AbattoirManagerName': r.abattoir_manager_name,
                'AbattoirManagerCell': r.abattoir_manager_cell,
                'AbattoirManagerEmail': r.abattoir_manager_email,
                'VerifiedAt': r.verified_at.isoformat() if r.verified_at else None,
                'VerifiedBy': r.verified_by,
                'EPVCycleStatus': r.epv_cycle_status,
            })

        return Response({
            'data': data,
            'page': page,
            'limit': limit,
            'total': total,
            'totalPages': math.ceil(total / limit) if limit else 0,
        })
    except Exception as e:
        print(f'Clients fetch error: {e}')
        return Response({'message': 'Server error fetching clients.'}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)


@csrf_exempt
@api_view(['POST'])
def create_client(request):
    data = request.data
    client = data.get('client')
    created_by = data.get('createdBy')

    if not client or not created_by:
        return Response({'message': 'client and createdBy are required.'}, status=status.HTTP_400_BAD_REQUEST)

    try:
        # Build kwargs from EDITABLE_FIELDS using FIELD_MAP
        kwargs = {}
        for js_field in ClientRecord.EDITABLE_FIELDS:
            django_field = ClientRecord.FIELD_MAP.get(js_field)
            if django_field:
                kwargs[django_field] = str(client.get(js_field, '') or '')

        record = ClientRecord.objects.create(**kwargs)

        # Log the creation in the audit log
        ClientAuditLog.objects.create(
            record_id=record.id,
            field_name='_CREATED',
            old_value='',
            new_value=f"New record: {client.get('BusinessName', 'Unknown')}",
            changed_by=created_by,
        )

        return Response({'message': 'Client created.', 'id': record.id}, status=status.HTTP_201_CREATED)
    except Exception as e:
        print(f'Client create error: {e}')
        return Response({'message': 'Server error creating client.'}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)


@csrf_exempt
@api_view(['PUT', 'DELETE'])
def client_detail(request, id):
    """Handles PUT (update client) and DELETE (delete client) on /<id>."""
    if request.method == 'DELETE':
        return _delete_client(request, id)
    return _update_client(request, id)


def _update_client(request, id):
    data = request.data
    updates = data.get('updates')
    changed_by = data.get('changedBy')

    if not updates or not changed_by:
        return Response({'message': 'updates and changedBy are required.'}, status=status.HTTP_400_BAD_REQUEST)

    try:
        try:
            record = ClientRecord.objects.get(id=id)
        except ClientRecord.DoesNotExist:
            return Response({'message': 'Record not found.'}, status=status.HTTP_404_NOT_FOUND)

        # Build update and audit entries
        audit_entries = []
        changes_made = False

        for js_field, new_value in updates.items():
            if js_field not in ClientRecord.EDITABLE_FIELDS:
                continue

            django_field = ClientRecord.FIELD_MAP.get(js_field)
            if not django_field:
                continue

            old_value = str(getattr(record, django_field, '') or '')
            if old_value == str(new_value):
                continue  # no change

            setattr(record, django_field, str(new_value))
            audit_entries.append({
                'field': js_field,
                'oldValue': old_value,
                'newValue': str(new_value),
            })
            changes_made = True

        if not changes_made:
            return Response({'message': 'No changes detected.'})

        record.save()

        # Insert audit log entries
        for entry in audit_entries:
            ClientAuditLog.objects.create(
                record_id=id,
                field_name=entry['field'],
                old_value=entry['oldValue'],
                new_value=entry['newValue'],
                changed_by=changed_by,
            )

        return Response({
            'message': f"{len(audit_entries)} field(s) updated.",
            'changes': audit_entries,
        })
    except ClientRecord.DoesNotExist:
        return Response({'message': 'Record not found.'}, status=status.HTTP_404_NOT_FOUND)
    except Exception as e:
        print(f'Client update error: {e}')
        return Response({'message': 'Server error updating client.'}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)


def _delete_client(request, id):
    deleted_by = (request.data.get('deletedBy') if request.data else None) or 'Unknown'

    try:
        try:
            record = ClientRecord.objects.get(id=id)
        except ClientRecord.DoesNotExist:
            return Response({'message': 'Record not found.'}, status=status.HTTP_404_NOT_FOUND)

        business_name = record.business_name

        # Clean up related records that reference this client
        ClientAuditLog.objects.filter(record_id=id).delete()

        # Clean up invitations referencing this client
        try:
            Invitation.objects.filter(client_record_id=id).delete()
        except Exception:
            pass

        # Clean up EPVs referencing this client
        try:
            EggProductionVerification.objects.filter(client_record_id=id).delete()
        except Exception:
            pass

        # Nullify support tickets referencing this client (don't delete tickets)
        try:
            SupportTicket.objects.filter(client_record_id=id).update(client_record_id=None)
        except Exception:
            pass

        # Delete the client record
        record.delete()

        # Log deletion with RecordId 0 (record no longer exists)
        ClientAuditLog.objects.create(
            record_id=0,
            field_name='_DELETED',
            old_value=str(business_name),
            new_value='',
            changed_by=deleted_by,
        )

        return Response({'message': 'Client deleted.'})
    except ClientRecord.DoesNotExist:
        return Response({'message': 'Record not found.'}, status=status.HTTP_404_NOT_FOUND)
    except Exception as e:
        print(f'Client delete error: {e}')
        return Response({'message': 'Server error deleting client.'}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)


@csrf_exempt
@api_view(['GET'])
def audit_log(request):
    try:
        page = int(request.query_params.get('page', 1))
        limit = int(request.query_params.get('limit', 50))
        record_id = request.query_params.get('recordId', '')
        offset = (page - 1) * limit

        queryset = ClientAuditLog.objects.all()

        if record_id:
            queryset = queryset.filter(record_id=int(record_id))

        total = queryset.count()
        entries = queryset.order_by('-changed_at')[offset : offset + limit]

        data = []
        for entry in entries:
            # Join BusinessName from ClientRecord
            business_name = None
            if entry.record_id:
                try:
                    client = ClientRecord.objects.get(id=entry.record_id)
                    business_name = client.business_name
                except ClientRecord.DoesNotExist:
                    pass

            data.append({
                'Id': entry.id,
                'RecordId': entry.record_id,
                'BusinessName': business_name,
                'FieldName': entry.field_name,
                'OldValue': entry.old_value,
                'NewValue': entry.new_value,
                'ChangedBy': entry.changed_by,
                'ChangedAt': entry.changed_at.isoformat() if entry.changed_at else None,
            })

        return Response({
            'data': data,
            'page': page,
            'limit': limit,
            'total': total,
            'totalPages': math.ceil(total / limit) if limit else 0,
        })
    except Exception as e:
        print(f'Audit log fetch error: {e}')
        return Response({'message': 'Server error fetching audit log.'}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)
