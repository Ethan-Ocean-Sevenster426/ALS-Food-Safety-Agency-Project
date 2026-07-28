import logging
import math
from datetime import datetime

from django.views.decorators.csrf import csrf_exempt
from django.db.models import (
    Count, Sum, Case, When, F, Q, Value, IntegerField, DecimalField,
)
from django.db.models.functions import Coalesce
from django.utils import timezone
from rest_framework.decorators import api_view
from rest_framework.response import Response
from rest_framework import status

from api.models import (
    User,
    ClientRecord,
    EggProductionVerification,
    SupportTicket,
    SupportTicketCategory,
    SupportTicketComment,
    Invitation,
    KPITarget,
)

logger = logging.getLogger(__name__)

LEVY_RATE = 0.02


# ---------------------------------------------------------------------------
# GET /api/dashboard/stats
# ---------------------------------------------------------------------------
@csrf_exempt
@api_view(['GET'])
def dashboard_stats(request):
    try:
        # Total users / active users
        user_agg = User.objects.aggregate(
            total=Count('id'),
            active=Count(
                Case(
                    When(Q(is_active=True) | Q(is_active__isnull=True), then=1),
                    output_field=IntegerField(),
                )
            ),
        )

        # Users by role
        role_qs = (
            User.objects
            .values('role')
            .annotate(count=Count('id'))
            .order_by(
                Case(
                    When(role='Super Admin', then=Value(1)),
                    When(role='Admin', then=Value(2)),
                    When(role='Company Admin', then=Value(3)),
                    default=Value(4),
                    output_field=IntegerField(),
                )
            )
        )
        by_role = [{'Role': r['role'], 'count': r['count']} for r in role_qs]

        # Total clients
        client_agg = ClientRecord.objects.aggregate(
            total=Count('id'),
            verified=Count(
                Case(When(verified_at__isnull=False, then=1), output_field=IntegerField())
            ),
        )

        # EPV stats
        try:
            epv_agg = EggProductionVerification.objects.aggregate(
                total=Count('id'),
                pending=Count(Case(When(status='Pending', then=1), output_field=IntegerField())),
                completed=Count(Case(When(status='Completed', then=1), output_field=IntegerField())),
            )
        except Exception:
            epv_agg = {'total': 0, 'pending': 0, 'completed': 0}

        # Ticket stats
        try:
            ticket_agg = SupportTicket.objects.aggregate(
                total=Count('id'),
                open=Count(Case(When(status='Open', then=1), output_field=IntegerField())),
                inProgress=Count(Case(When(status='In Progress', then=1), output_field=IntegerField())),
                resolved=Count(Case(When(status='Resolved', then=1), output_field=IntegerField())),
                closed=Count(Case(When(status='Closed', then=1), output_field=IntegerField())),
            )
        except Exception:
            ticket_agg = {'total': 0, 'open': 0, 'inProgress': 0, 'resolved': 0, 'closed': 0}

        # Pending invitations
        try:
            pending_invites = Invitation.objects.filter(status='Pending').count()
        except Exception:
            pending_invites = 0

        # Recent users (last 5)
        recent_users_qs = User.objects.order_by('-created_at')[:5]
        recent_users = [
            {
                'FirstName': u.first_name,
                'LastName': u.last_name,
                'Email': u.email,
                'Role': u.role,
                'CreatedAt': u.created_at.isoformat() if u.created_at else None,
            }
            for u in recent_users_qs
        ]

        # Recent tickets (last 5)
        recent_tickets = []
        try:
            rt_qs = (
                SupportTicket.objects
                .select_related('category')
                .order_by('-created_at')[:5]
            )
            creator_ids = {t.created_by_user_id for t in rt_qs}
            creators_map = {u.id: u for u in User.objects.filter(pk__in=creator_ids)}

            for t in rt_qs:
                creator = creators_map.get(t.created_by_user_id)
                recent_tickets.append({
                    'Id': t.id,
                    'Subject': t.subject,
                    'Priority': t.priority,
                    'Status': t.status,
                    'CreatedAt': t.created_at.isoformat() if t.created_at else None,
                    'CategoryName': t.category.name if t.category else None,
                    'CreatedByName': f'{creator.first_name} {creator.last_name}' if creator else None,
                })
        except Exception:
            pass

        return Response({
            'users': {
                'total': user_agg['total'],
                'active': user_agg['active'],
                'byRole': by_role,
            },
            'clients': {
                'total': client_agg['total'],
                'verified': client_agg['verified'],
                'unverified': client_agg['total'] - (client_agg['verified'] or 0),
            },
            'epv': epv_agg,
            'tickets': ticket_agg,
            'pendingInvites': pending_invites,
            'recentUsers': recent_users,
            'recentTickets': recent_tickets,
        })
    except Exception:
        logger.exception('Dashboard stats error')
        return Response({'message': 'Server error.'}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)


# ---------------------------------------------------------------------------
# GET /api/dashboard/epv-overview
# ---------------------------------------------------------------------------
@csrf_exempt
@api_view(['GET'])
def epv_overview(request):
    try:
        now = timezone.now()
        cur_month = now.month
        cur_year = now.year
        cur_quarter = math.ceil(cur_month / 3)
        q_start_month = (cur_quarter - 1) * 3 + 1

        # Date filters from query params
        filter_year = int(request.query_params['year']) if request.query_params.get('year') else None
        filter_month = int(request.query_params['month']) if request.query_params.get('month') else None
        filter_quarter = int(request.query_params['quarter']) if request.query_params.get('quarter') else None

        # Build effective year and date filter Q object
        effective_year = filter_year or ((cur_year) if (filter_month or filter_quarter) else None)

        date_q = Q(epv_type='Client', status='Completed')
        if effective_year and filter_month:
            date_q &= Q(period_year=effective_year, period_month=filter_month)
        elif effective_year and filter_quarter:
            qsm = (filter_quarter - 1) * 3 + 1
            date_q &= Q(period_year=effective_year, period_month__gte=qsm, period_month__lte=qsm + 2)
        elif effective_year:
            date_q &= Q(period_year=effective_year)

        # 1. Aggregate stats
        base_qs = EggProductionVerification.objects.filter(date_q)

        stats_agg = base_qs.aggregate(
            TotalFacilitiesWithEPV=Count('client_record_id', distinct=True),
            TotalEPVs=Count('id'),
            ReconciledCount=Count(Case(When(is_reconciled=True, then=1), output_field=IntegerField())),
            TotalEggLevy=Coalesce(Sum('levy_amount'), 0, output_field=DecimalField()),
            TotalEggDozens=Coalesce(Sum('sold_to_trade'), 0, output_field=DecimalField()),
            TotalPulpDozens=Coalesce(Sum('pulp_sold_to_trade'), 0, output_field=DecimalField()),
            TotalPaid=Coalesce(Sum('reconciled_amount'), 0, output_field=DecimalField()),
            ManualInspections=Count(Case(When(manual_inspection=True, then=1), output_field=IntegerField())),
            VerifiedCount=Count(Case(When(is_verified=True, then=1), output_field=IntegerField())),
        )

        # Compute pulp levy, total billed, total outstanding, and rejections via Python
        total_pulp_levy = float(stats_agg['TotalPulpDozens']) * 1.7 * LEVY_RATE
        total_egg_levy = float(stats_agg['TotalEggLevy'])
        total_billed = total_egg_levy + total_pulp_levy
        total_paid = float(stats_agg['TotalPaid'])
        total_outstanding = total_billed - total_paid

        # Rejections count (inspector EPVs linked to client EPVs)
        rejection_count = EggProductionVerification.objects.filter(
            epv_type='Inspector',
            linked_epv_id__in=base_qs.values_list('id', flat=True),
        ).count()

        # Actioned = approved OR rejected with the inspector's corrected EPV completed.
        # Add the unverified EPVs whose linked inspector EPV is Completed.
        actioned_rejections = (
            base_qs
            .filter(Q(is_verified=False) | Q(is_verified__isnull=True))
            .filter(id__in=EggProductionVerification.objects.filter(
                epv_type='Inspector', status='Completed',
                linked_epv_id__isnull=False,
            ).values_list('linked_epv_id', flat=True))
            .count()
        )

        stats = {
            'TotalFacilitiesWithEPV': stats_agg['TotalFacilitiesWithEPV'],
            'TotalEPVs': stats_agg['TotalEPVs'],
            'TotalEpvs': stats_agg['TotalEPVs'],  # alias: Express backend casing, used by the frontend
            'ReconciledCount': stats_agg['ReconciledCount'],
            'TotalEggLevy': total_egg_levy,
            'TotalPulpLevy': total_pulp_levy,
            'TotalBilled': total_billed,
            'TotalPaid': total_paid,
            'TotalOutstanding': total_outstanding,
            'TotalEggDozens': float(stats_agg['TotalEggDozens']),
            'TotalPulpDozens': float(stats_agg['TotalPulpDozens']),
            'TotalRejections': rejection_count,
            'ManualInspections': stats_agg['ManualInspections'],
            'VerifiedCount': stats_agg['VerifiedCount'] + actioned_rejections,
        }

        # 2. Monthly breakdown
        monthly_qs = (
            base_qs
            .values('period_month', 'period_year')
            .annotate(
                EPVCount=Count('id'),
                EggLevy=Coalesce(Sum('levy_amount'), 0, output_field=DecimalField()),
                PulpDozens=Coalesce(Sum('pulp_sold_to_trade'), 0, output_field=DecimalField()),
                TotalPaid=Coalesce(Sum('reconciled_amount'), 0, output_field=DecimalField()),
                PaidCount=Count(Case(When(is_reconciled=True, then=1), output_field=IntegerField())),
                EggDozens=Coalesce(Sum('sold_to_trade'), 0, output_field=DecimalField()),
            )
            .order_by('-period_year', '-period_month')
        )

        # Get rejection counts per month
        client_epv_ids = list(base_qs.values_list('id', flat=True))
        inspector_epvs = (
            EggProductionVerification.objects
            .filter(epv_type='Inspector', linked_epv_id__in=client_epv_ids)
            .values('linked_epv_id')
        )
        # Map linked_epv_id -> client EPV's period for grouping
        epv_period_map = dict(base_qs.values_list('id', 'period_month', 'period_year').values_list('id', flat=False)) if False else {}
        # Build month -> rejection count by querying differently
        monthly_rejection_map = {}
        if client_epv_ids:
            rej_qs = (
                EggProductionVerification.objects
                .filter(epv_type='Inspector', linked_epv_id__in=client_epv_ids)
                .values('linked_epv_id')
            )
            linked_ids = [r['linked_epv_id'] for r in rej_qs]
            if linked_ids:
                rej_by_month = (
                    EggProductionVerification.objects
                    .filter(id__in=linked_ids, epv_type='Client')
                    .values('period_year', 'period_month')
                    .annotate(Rejections=Count('id'))
                )
                for r in rej_by_month:
                    key = (r['period_year'], r['period_month'])
                    monthly_rejection_map[key] = r['Rejections']

        monthly = []
        for m in monthly_qs:
            pulp_levy = float(m['PulpDozens']) * 1.7 * LEVY_RATE
            egg_levy = float(m['EggLevy'])
            rej_key = (m['period_year'], m['period_month'])
            monthly.append({
                'PeriodMonth': m['period_month'],
                'PeriodYear': m['period_year'],
                'EPVCount': m['EPVCount'],
                'EggLevy': egg_levy,
                'PulpLevy': pulp_levy,
                'TotalBilled': egg_levy + pulp_levy,
                'TotalPaid': float(m['TotalPaid']),
                'PaidCount': m['PaidCount'],
                'EggDozens': float(m['EggDozens']),
                'PulpDozens': float(m['PulpDozens']),
                'Rejections': monthly_rejection_map.get(rej_key, 0),
            })

        # 3. Facilities by province
        fac_by_prov = list(
            ClientRecord.objects
            .filter(facility_province__isnull=False)
            .exclude(facility_province='')
            .values('facility_province')
            .annotate(FacilityCount=Count('id', distinct=True))
            .order_by('facility_province')
        )
        facilities_by_province = [
            {'FacilityProvince': f['facility_province'], 'FacilityCount': f['FacilityCount']}
            for f in fac_by_prov
        ]
        total_facilities = sum(f['FacilityCount'] for f in fac_by_prov)

        # 4. Need visit this quarter
        visit_q_year = filter_year or cur_year
        if filter_quarter:
            visit_q_start = (filter_quarter - 1) * 3 + 1
            visit_q_end = visit_q_start + 2
        elif filter_month:
            visit_q_start = filter_month
            visit_q_end = filter_month
        else:
            visit_q_start = q_start_month
            visit_q_end = q_start_month + 2

        # Visited = inspection performed in the window (manual_inspection_at);
        # legacy rows without a timestamp fall back to the EPV period.
        from api.views.epv_views import _visit_window
        visit_start, visit_end = _visit_window(visit_q_year, visit_q_start, visit_q_end)
        visited_client_ids = (
            EggProductionVerification.objects
            .filter(epv_type='Client', manual_inspection=True)
            .filter(
                Q(manual_inspection_at__gte=visit_start,
                  manual_inspection_at__lt=visit_end)
                | Q(manual_inspection_at__isnull=True,
                    period_year=visit_q_year,
                    period_month__gte=visit_q_start,
                    period_month__lte=visit_q_end)
            )
            .values_list('client_record_id', flat=True)
            .distinct()
        )
        need_visit_count = (
            ClientRecord.objects
            .filter(facility_province__isnull=False)
            .exclude(facility_province='')
            .exclude(id__in=visited_client_ids)
            .count()
        )

        # 5. Outstanding facility count
        outstanding_count = (
            base_qs
            .filter(
                Q(is_reconciled=False) | Q(is_reconciled__isnull=True),
            )
            .values_list('client_record_id', flat=True)
            .distinct()
        )
        # Filter to those with positive outstanding amount in Python
        outstanding_epvs = base_qs.filter(
            Q(is_reconciled=False) | Q(is_reconciled__isnull=True),
        )
        outstanding_client_ids = set()
        for e in outstanding_epvs.only('client_record_id', 'levy_amount', 'pulp_sold_to_trade', 'reconciled_amount'):
            levy = float(e.levy_amount or 0)
            pulp_levy = float(e.pulp_sold_to_trade or 0) * 1.7 * LEVY_RATE
            reconciled = float(e.reconciled_amount or 0)
            if (levy + pulp_levy - reconciled) > 0:
                outstanding_client_ids.add(e.client_record_id)
        outstanding_count_val = len(outstanding_client_ids)

        # 6. Pending approvals count
        approved_or_inspected_ids = (
            EggProductionVerification.objects
            .filter(epv_type='Inspector', linked_epv_id__in=base_qs.values_list('id', flat=True))
            .values_list('linked_epv_id', flat=True)
        )
        pending_approvals_count = (
            base_qs
            .filter(Q(is_verified=False) | Q(is_verified__isnull=True))
            .exclude(id__in=approved_or_inspected_ids)
            .count()
        )

        # 7. Inspector EPVs to complete count
        insp_to_complete_count = (
            EggProductionVerification.objects
            .filter(
                epv_type='Inspector',
                status='Pending',
                linked_epv_id__in=base_qs.values_list('id', flat=True),
            )
            .count()
        )

        # 8. Not completed EPVs count
        def calc_nc_month_count():
            if filter_year and filter_month:
                return 1
            if filter_year and filter_quarter:
                qsm = (filter_quarter - 1) * 3 + 1
                cnt = 0
                for m in range(qsm, qsm + 3):
                    if filter_year < cur_year or m <= cur_month:
                        cnt += 1
                return cnt
            if filter_year:
                return 12 if filter_year < cur_year else cur_month
            # No filter — count all months from 2025 to current
            cnt = 0
            for y in range(2025, cur_year + 1):
                cnt += 12 if y < cur_year else cur_month
            return cnt

        nc_month_count = calc_nc_month_count()

        completed_per_month = (
            base_qs
            .values('period_year', 'period_month')
            .annotate(CompletedFacs=Count('client_record_id', distinct=True))
        )
        total_completed_slots = sum(r['CompletedFacs'] for r in completed_per_month)
        not_completed_count = (total_facilities * nc_month_count) - total_completed_slots

        # 9. Rejections by province
        rej_by_prov = []
        if client_epv_ids:
            inspector_linked_ids = list(
                EggProductionVerification.objects
                .filter(epv_type='Inspector', linked_epv_id__in=client_epv_ids)
                .values_list('linked_epv_id', flat=True)
            )
            if inspector_linked_ids:
                rej_by_prov_qs = (
                    EggProductionVerification.objects
                    .filter(id__in=inspector_linked_ids, epv_type='Client')
                    .values('facility_province')
                    .annotate(Rejections=Count('id'))
                    .order_by('-Rejections')
                )
                rej_by_prov = [
                    {'FacilityProvince': r['facility_province'], 'Rejections': r['Rejections']}
                    for r in rej_by_prov_qs
                ]

        return Response({
            'stats': stats,
            'monthly': monthly,
            'facilitiesByProvince': facilities_by_province,
            'rejectionsByProvince': rej_by_prov,
            'totalFacilities': total_facilities,
            'needVisitCount': need_visit_count,
            'outstandingCount': outstanding_count_val,
            'pendingApprovalsCount': pending_approvals_count,
            'inspToCompleteCount': insp_to_complete_count,
            'notCompletedCount': not_completed_count,
            'quarter': {
                'quarter': cur_quarter,
                'year': cur_year,
                'startMonth': q_start_month,
                'endMonth': q_start_month + 2,
            },
        })
    except Exception:
        logger.exception('Dashboard EPV overview error')
        return Response({'message': 'Server error.'}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)


# ---------------------------------------------------------------------------
# GET/PUT /api/dashboard/kpi-targets
# ---------------------------------------------------------------------------
@csrf_exempt
@api_view(['GET', 'PUT'])
def kpi_targets(request):
    if request.method == 'GET':
        return _get_kpi_targets(request)
    return _put_kpi_targets(request)


def _get_kpi_targets(request):
    try:
        targets = {}
        for t in KPITarget.objects.order_by('id'):
            targets[t.kpi_key] = {'value': float(t.target_value), 'label': t.label}
        return Response({'targets': targets})
    except Exception:
        logger.exception('Fetch KPI targets error')
        return Response({'message': 'Server error.'}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)


def _put_kpi_targets(request):
    data = request.data
    user_role = data.get('userRole')
    targets = data.get('targets')
    updated_by = data.get('updatedBy', 'Unknown')

    if user_role != 'Super Admin':
        return Response(
            {'message': 'Only Super Admin can update KPI targets.'},
            status=status.HTTP_403_FORBIDDEN,
        )

    if not targets or not isinstance(targets, dict):
        return Response({'message': 'Invalid targets.'}, status=status.HTTP_400_BAD_REQUEST)

    try:
        for key, value in targets.items():
            KPITarget.objects.filter(kpi_key=key).update(
                target_value=float(value),
                updated_at=timezone.now(),
                updated_by=updated_by,
            )
        return Response({'message': 'KPI targets updated successfully.'})
    except Exception:
        logger.exception('Update KPI targets error')
        return Response({'message': 'Server error.'}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)
