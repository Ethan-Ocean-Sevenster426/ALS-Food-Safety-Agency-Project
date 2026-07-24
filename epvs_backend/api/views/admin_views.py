import math
from decimal import Decimal
from datetime import datetime

from django.db.models import Q, Sum, Count, Case, When, Value, F, DecimalField, IntegerField
from django.db.models.functions import Coalesce
from django.views.decorators.csrf import csrf_exempt
from django.utils import timezone

from rest_framework.decorators import api_view
from rest_framework.response import Response
from rest_framework import status

from api.models import EggProductionVerification, ClientRecord, ClientAuditLog
from api.services.helpers import log_company_audit, LEVY_RATE

LEVY_RATE_FLOAT = 0.018


def _calc_total_billed(epv):
    """Calculate TotalBilled for a single EPV record."""
    levy = float(epv.levy_amount or 0)
    pulp = float(epv.pulp_sold_to_trade or 0) * 1.7 * LEVY_RATE_FLOAT
    return levy + pulp


def _calc_outstanding(epv):
    """Calculate Outstanding for a single EPV record."""
    return _calc_total_billed(epv) - float(epv.reconciled_amount or 0)


@csrf_exempt
@api_view(['GET'])
def stats(request):
    try:
        now = datetime.now()
        cur_month = now.month
        cur_year = now.year
        cur_quarter = math.ceil(cur_month / 3)

        # Date filters
        filter_year = request.query_params.get('year')
        filter_month = request.query_params.get('month')
        filter_quarter = request.query_params.get('quarter')

        filter_year = int(filter_year) if filter_year else None
        filter_month = int(filter_month) if filter_month else None
        filter_quarter = int(filter_quarter) if filter_quarter else None

        # Default year to current year if month or quarter specified without year
        effective_year = filter_year or (cur_year if (filter_month or filter_quarter) else None)

        # Base queryset
        qs = EggProductionVerification.objects.filter(
            epv_type='Client',
            status='Completed',
        )

        # Apply date filters
        if effective_year and filter_month:
            qs = qs.filter(period_year=effective_year, period_month=filter_month)
        elif effective_year and filter_quarter:
            qsm = (filter_quarter - 1) * 3 + 1
            qs = qs.filter(period_year=effective_year, period_month__gte=qsm, period_month__lte=qsm + 2)
        elif effective_year:
            qs = qs.filter(period_year=effective_year)

        # 1. Aggregate financial stats - compute in Python for accuracy matching Express
        epvs = list(qs.values(
            'id', 'levy_amount', 'pulp_sold_to_trade', 'reconciled_amount',
            'is_reconciled', 'is_verified',
        ))

        total_epvs = len(epvs)
        total_billed = 0.0
        total_paid = 0.0
        total_outstanding = 0.0
        reconciled_count = 0
        need_recon_count = 0
        partial_recon_count = 0
        verified_count = 0
        total_egg_levy = 0.0
        total_pulp_levy = 0.0

        for e in epvs:
            levy = float(e['levy_amount'] or 0)
            pulp_sold = float(e['pulp_sold_to_trade'] or 0)
            pulp_levy = pulp_sold * 1.7 * LEVY_RATE_FLOAT
            billed = levy + pulp_levy
            recon_amt = float(e['reconciled_amount'] or 0)
            outstanding = billed - recon_amt

            total_billed += billed
            total_paid += recon_amt
            total_outstanding += outstanding
            total_egg_levy += levy
            total_pulp_levy += pulp_levy

            if e['is_reconciled']:
                reconciled_count += 1
            if (not e['is_reconciled']) and outstanding > 0:
                need_recon_count += 1
            if (e['reconciled_amount'] is not None and recon_amt > 0 and not e['is_reconciled']):
                partial_recon_count += 1
            if e['is_verified']:
                verified_count += 1

        stats_data = {
            'TotalEPVs': total_epvs,
            'TotalBilled': round(total_billed, 2),
            'TotalPaid': round(total_paid, 2),
            'TotalOutstanding': round(total_outstanding, 2),
            'ReconciledCount': reconciled_count,
            'NeedReconCount': need_recon_count,
            'PartialReconCount': partial_recon_count,
            'VerifiedCount': verified_count,
            'TotalEggLevy': round(total_egg_levy, 2),
            'TotalPulpLevy': round(total_pulp_levy, 2),
        }

        # 2. Monthly breakdown for charts
        monthly_epvs = {}
        for e in epvs:
            key = (e.get('period_month'), e.get('period_year'))
            if key not in monthly_epvs:
                monthly_epvs[key] = []
            monthly_epvs[key].append(e)

        # Re-query to get period_month/period_year since values() above didn't include them
        epvs_full = list(qs.values(
            'id', 'levy_amount', 'pulp_sold_to_trade', 'reconciled_amount',
            'is_reconciled', 'is_verified', 'period_month', 'period_year',
        ))

        monthly_map = {}
        for e in epvs_full:
            key = (e['period_month'], e['period_year'])
            if key not in monthly_map:
                monthly_map[key] = {
                    'PeriodMonth': e['period_month'],
                    'PeriodYear': e['period_year'],
                    'EPVCount': 0,
                    'TotalBilled': 0.0,
                    'TotalPaid': 0.0,
                    'Outstanding': 0.0,
                    'ReconciledCount': 0,
                    'NeedReconCount': 0,
                }
            m = monthly_map[key]
            levy = float(e['levy_amount'] or 0)
            pulp_levy = float(e['pulp_sold_to_trade'] or 0) * 1.7 * LEVY_RATE_FLOAT
            billed = levy + pulp_levy
            recon_amt = float(e['reconciled_amount'] or 0)
            outstanding = billed - recon_amt

            m['EPVCount'] += 1
            m['TotalBilled'] += billed
            m['TotalPaid'] += recon_amt
            m['Outstanding'] += outstanding
            if e['is_reconciled']:
                m['ReconciledCount'] += 1
            if (not e['is_reconciled']) and outstanding > 0:
                m['NeedReconCount'] += 1

        monthly = sorted(monthly_map.values(), key=lambda x: (x['PeriodYear'], x['PeriodMonth']), reverse=True)

        # 3. Outstanding by province (join ClientRecord for FacilityProvince)
        province_map = {}
        epvs_with_client = list(qs.values(
            'id', 'client_record_id', 'levy_amount', 'pulp_sold_to_trade', 'reconciled_amount',
        ))

        # Get all client records for province lookup
        client_record_ids = set(e['client_record_id'] for e in epvs_with_client)
        clients = {
            c['id']: c['facility_province']
            for c in ClientRecord.objects.filter(id__in=client_record_ids).values('id', 'facility_province')
        }

        for e in epvs_with_client:
            province = clients.get(e['client_record_id'], '') or ''
            if province not in province_map:
                province_map[province] = {
                    'FacilityProvince': province,
                    'EPVCount': 0,
                    'TotalBilled': 0.0,
                    'TotalPaid': 0.0,
                    'Outstanding': 0.0,
                }
            p = province_map[province]
            levy = float(e['levy_amount'] or 0)
            pulp_levy = float(e['pulp_sold_to_trade'] or 0) * 1.7 * LEVY_RATE_FLOAT
            billed = levy + pulp_levy
            recon_amt = float(e['reconciled_amount'] or 0)

            p['EPVCount'] += 1
            p['TotalBilled'] += billed
            p['TotalPaid'] += recon_amt
            p['Outstanding'] += billed - recon_amt

        by_province = sorted(province_map.values(), key=lambda x: x['Outstanding'], reverse=True)

        return Response({
            'stats': stats_data,
            'monthly': monthly,
            'byProvince': by_province,
            'quarter': {'quarter': cur_quarter, 'year': cur_year},
        })
    except Exception as e:
        print(f'Admin stats error: {e}')
        return Response({'message': 'Server error.'}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)


@csrf_exempt
@api_view(['GET'])
def reconciliation(request):
    try:
        province = request.query_params.get('province')
        month = request.query_params.get('month')
        year = request.query_params.get('year')
        status_filter = request.query_params.get('status')
        search = request.query_params.get('search')
        page = int(request.query_params.get('page', 1))
        limit = int(request.query_params.get('limit', 50))
        offset = (page - 1) * limit

        # Base queryset - join with ClientRecord
        qs = EggProductionVerification.objects.filter(
            epv_type='Client',
            status='Completed',
        )

        # Province filter - need to filter via client record
        if province:
            client_ids = ClientRecord.objects.filter(
                facility_province=province
            ).values_list('id', flat=True)
            qs = qs.filter(client_record_id__in=client_ids)

        # Month/year filter
        if month:
            qs = qs.filter(period_month=int(month))
        if year:
            qs = qs.filter(period_year=int(year))

        # Search filter
        if search:
            # Search by business name (via client record) or reference number
            matching_client_ids = ClientRecord.objects.filter(
                business_name__icontains=search
            ).values_list('id', flat=True)
            qs = qs.filter(
                Q(client_record_id__in=matching_client_ids) |
                Q(reference_number__icontains=search)
            )

        # Fetch all matching EPVs to apply status filter and calculate fields
        all_epvs = list(qs.values(
            'id', 'client_record_id', 'reference_number', 'period_month', 'period_year',
            'levy_amount', 'pulp_sold_to_trade', 'sold_to_trade',
            'reconciled_amount', 'is_reconciled', 'reconciled_by', 'reconciled_at',
            'is_verified', 'pop_file_path', 'completed_at',
        ))

        # Get client data for all records
        client_ids_set = set(e['client_record_id'] for e in all_epvs)
        clients = {
            c['id']: c
            for c in ClientRecord.objects.filter(id__in=client_ids_set).values(
                'id', 'business_name', 'facility_province', 'town'
            )
        }

        # Build result records with calculated fields
        records = []
        for e in all_epvs:
            levy = float(e['levy_amount'] or 0)
            pulp_levy = float(e['pulp_sold_to_trade'] or 0) * 1.7 * LEVY_RATE_FLOAT
            total_billed = levy + pulp_levy
            recon_amt = float(e['reconciled_amount'] or 0)
            outstanding = total_billed - recon_amt

            # Status filter
            if status_filter == 'outstanding':
                if not ((not e['is_reconciled']) and outstanding > 0):
                    continue
            elif status_filter == 'partial':
                if not ((not e['is_reconciled']) and e['reconciled_amount'] is not None and recon_amt > 0):
                    continue
            elif status_filter == 'reconciled':
                if not e['is_reconciled']:
                    continue

            client = clients.get(e['client_record_id'], {})
            records.append({
                'Id': e['id'],
                'ClientRecordId': e['client_record_id'],
                'ReferenceNumber': e['reference_number'],
                'PeriodMonth': e['period_month'],
                'PeriodYear': e['period_year'],
                'LevyAmount': levy,
                'PulpSoldToTrade': float(e['pulp_sold_to_trade'] or 0),
                'SoldToTrade': float(e['sold_to_trade'] or 0),
                'TotalBilled': round(total_billed, 2),
                'ReconciledAmount': round(recon_amt, 2),
                'Outstanding': round(outstanding, 2),
                'IsReconciled': e['is_reconciled'],
                'ReconciledBy': e['reconciled_by'],
                'ReconciledAt': e['reconciled_at'].isoformat() if e['reconciled_at'] else None,
                'IsVerified': e['is_verified'],
                'POPFilePath': e['pop_file_path'],
                'CompletedAt': e['completed_at'].isoformat() if e['completed_at'] else None,
                'BusinessName': client.get('business_name', ''),
                'FacilityProvince': client.get('facility_province', ''),
                'Town': client.get('town', ''),
            })

        # Sort: outstanding first (not reconciled and outstanding > 0), then by outstanding amount desc
        records.sort(key=lambda r: (
            0 if (not r['IsReconciled'] and r['Outstanding'] > 0) else 1,
            -r['Outstanding'],
        ))

        total = len(records)
        total_pages = math.ceil(total / limit) if limit > 0 else 0
        paginated = records[offset:offset + limit]

        return Response({
            'data': paginated,
            'page': page,
            'limit': limit,
            'total': total,
            'totalPages': total_pages,
        })
    except Exception as e:
        print(f'Reconciliation list error: {e}')
        return Response({'message': 'Server error.'}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)


@csrf_exempt
@api_view(['PUT'])
def reconcile_batch(request):
    items = request.data.get('items')
    reconciled_by = request.data.get('reconciledBy')
    user_role = request.data.get('userRole')

    if not items or not isinstance(items, list) or len(items) == 0:
        return Response({'message': 'No items provided.'}, status=status.HTTP_400_BAD_REQUEST)

    try:
        updated = 0

        for item in items:
            epv_id = item.get('id')
            amount = item.get('amount')

            try:
                parsed_amount = float(amount)
            except (TypeError, ValueError):
                continue
            if parsed_amount <= 0:
                continue

            try:
                epv = EggProductionVerification.objects.get(id=int(epv_id))
            except EggProductionVerification.DoesNotExist:
                continue

            # Calculate TotalBilled
            total_billed = float(epv.levy_amount or 0) + float(epv.pulp_sold_to_trade or 0) * 1.7 * LEVY_RATE_FLOAT
            old_recon_amount = float(epv.reconciled_amount or 0)
            fully_reconciled = parsed_amount >= total_billed

            epv.reconciled_amount = Decimal(str(round(parsed_amount, 2)))
            epv.is_reconciled = fully_reconciled
            epv.reconciled_by = reconciled_by or 'Unknown'
            epv.reconciled_at = timezone.now()
            epv.save()

            # Audit log
            if epv.client_record_id:
                log_company_audit(
                    record_id=epv.client_record_id,
                    field_name='Reconciled Amount',
                    old_value=f'R {old_recon_amount}',
                    new_value=f'R {parsed_amount}',
                    changed_by=reconciled_by or 'Unknown',
                    user_role=user_role,
                )

            updated += 1

        return Response({
            'message': f'{updated} EPV(s) reconciled successfully.',
            'updated': updated,
        })
    except Exception as e:
        print(f'Batch reconcile error: {e}')
        return Response({'message': 'Failed to batch reconcile.'}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)
