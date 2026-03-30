import logging

from django.views.decorators.csrf import csrf_exempt
from django.utils import timezone
from rest_framework.decorators import api_view
from rest_framework.response import Response
from rest_framework import status

from api.models import (
    SupportTicket,
    SupportTicketCategory,
    SupportTicketComment,
    User,
    ClientRecord,
)
from api.services.email_service import send_email

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Email helpers
# ---------------------------------------------------------------------------

EMAIL_HEADER = (
    '<div style="background: rgb(30, 41, 59); padding: 24px 30px; '
    'border-radius: 12px 12px 0 0; text-align: center;">'
    '<h1 style="color: #fff; margin: 0; font-size: 24px;">EPVS Support</h1>'
    '<p style="color: rgba(255,255,255,0.7); margin: 6px 0 0; font-size: 13px;">'
    'Egg Production Verification System</p></div>'
)

EMAIL_FOOTER = (
    '<p style="color: #aaa; font-size: 11px; text-align: center; margin-top: 20px;">'
    'This is an automated message from the EPVS Support System. '
    'Please do not reply directly to this email.</p>'
)


def wrap_email(content):
    return (
        '<div style="font-family: Arial, sans-serif; max-width: 600px; '
        f'margin: 0 auto; padding: 20px;">{EMAIL_HEADER}'
        '<div style="background: #fff; padding: 30px; border: 1px solid #e5e7eb; '
        f'border-top: none; border-radius: 0 0 12px 12px;">{content}</div>'
        f'{EMAIL_FOOTER}</div>'
    )


# ---------------------------------------------------------------------------
# GET /api/support/categories
# ---------------------------------------------------------------------------
@csrf_exempt
@api_view(['GET'])
def list_categories(request):
    try:
        categories = (
            SupportTicketCategory.objects
            .filter(is_active=True)
            .order_by('sort_order', 'name')
            .values_list('id', 'name', 'category_type')
        )
        return Response({
            'categories': [
                {'Id': c[0], 'Name': c[1], 'CategoryType': c[2]}
                for c in categories
            ]
        })
    except Exception:
        logger.exception('Fetch categories error')
        return Response({'message': 'Server error.'}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)


# ---------------------------------------------------------------------------
# GET/POST /api/support/tickets
# ---------------------------------------------------------------------------
@csrf_exempt
@api_view(['GET', 'POST'])
def tickets_list_create(request):
    if request.method == 'GET':
        return _list_tickets(request)
    return _create_ticket(request)


def _create_ticket(request):
    data = request.data
    category_id = data.get('categoryId')
    subject = data.get('subject')
    description = data.get('description', '')
    priority = data.get('priority', 'Medium')
    user_id = data.get('userId')
    client_record_id = data.get('clientRecordId')

    if not category_id or not subject or not user_id:
        return Response(
            {'message': 'Category, subject, and user are required.'},
            status=status.HTTP_400_BAD_REQUEST,
        )

    try:
        # Get category info
        try:
            category = SupportTicketCategory.objects.get(pk=category_id)
        except SupportTicketCategory.DoesNotExist:
            return Response({'message': 'Invalid category.'}, status=status.HTTP_400_BAD_REQUEST)

        category_type = category.category_type
        category_name = category.name

        ticket = SupportTicket.objects.create(
            category=category,
            category_type=category_type,
            subject=subject,
            description=description,
            priority=priority,
            created_by_user_id=user_id,
            client_record_id=client_record_id,
        )

        # Send confirmation email
        try:
            user = User.objects.get(pk=user_id)
            send_email(
                to=user.email,
                subject=f'EPVS Support - Ticket #{ticket.id} Received',
                html=wrap_email(
                    f'<h2 style="color: #1e293b; margin-top: 0;">Thank You, {user.first_name}!</h2>'
                    '<p style="color: #555; font-size: 15px; line-height: 1.6;">'
                    'Your support ticket has been received and logged. Our team will review it and get back to you shortly.'
                    '</p>'
                    '<div style="background: #f0f9f9; border: 1px solid #b8e4e4; border-radius: 8px; padding: 16px; margin: 20px 0;">'
                    '<table style="width: 100%; font-size: 14px; color: #374151;">'
                    '<tr><td style="padding: 6px 0; font-weight: 600; width: 130px;">Ticket Reference:</td>'
                    f'<td style="padding: 6px 0; color: #0E7C7B; font-weight: 700; font-size: 16px;">#{ticket.id}</td></tr>'
                    '<tr><td style="padding: 6px 0; font-weight: 600;">Issue Type:</td>'
                    f'<td style="padding: 6px 0;">{category_name}</td></tr>'
                    '<tr><td style="padding: 6px 0; font-weight: 600;">Subject:</td>'
                    f'<td style="padding: 6px 0;">{subject}</td></tr>'
                    '<tr><td style="padding: 6px 0; font-weight: 600;">Priority:</td>'
                    f'<td style="padding: 6px 0;">{priority}</td></tr>'
                    '</table></div>'
                    '<p style="color: #555; font-size: 14px; line-height: 1.6;">'
                    'You can view the status of your ticket at any time by navigating to the <strong>Support</strong> tab in the EPVS system.'
                    '</p>'
                    f'<p style="color: #999; font-size: 13px;">Please use ticket reference <strong>#{ticket.id}</strong> for any follow-up communication.</p>'
                ),
            )
        except Exception as email_err:
            logger.error('Failed to send ticket confirmation email: %s', email_err)

        return Response(
            {'message': 'Support ticket created successfully.', 'ticketId': ticket.id},
            status=status.HTTP_201_CREATED,
        )
    except Exception:
        logger.exception('Create ticket error')
        return Response({'message': 'Server error.'}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)


def _list_tickets(request):
    user_id = request.query_params.get('userId')
    role = request.query_params.get('role')
    client_record_id = request.query_params.get('clientRecordId')

    try:
        from django.db.models import Q

        qs = (
            SupportTicket.objects
            .select_related('category')
            .order_by('-created_at')
        )

        if role == 'Super Admin':
            pass  # no filter
        elif role == 'Admin':
            qs = qs.filter(category_type='Administration')
        else:
            q = Q(created_by_user_id=int(user_id)) if user_id else Q()
            if client_record_id:
                q |= Q(client_record_id=int(client_record_id))
            qs = qs.filter(q)

        # Build user lookup maps
        user_ids = set()
        ticket_list = list(qs)
        for t in ticket_list:
            user_ids.add(t.created_by_user_id)
            if t.assigned_to_user_id:
                user_ids.add(t.assigned_to_user_id)

        users_map = {}
        if user_ids:
            for u in User.objects.filter(pk__in=user_ids):
                users_map[u.id] = u

        # Client record lookup
        cr_ids = {t.client_record_id for t in ticket_list if t.client_record_id}
        cr_map = {}
        if cr_ids:
            for cr in ClientRecord.objects.filter(pk__in=cr_ids):
                cr_map[cr.id] = cr

        tickets = []
        for t in ticket_list:
            creator = users_map.get(t.created_by_user_id)
            assignee = users_map.get(t.assigned_to_user_id) if t.assigned_to_user_id else None
            client = cr_map.get(t.client_record_id) if t.client_record_id else None

            tickets.append({
                'Id': t.id,
                'Subject': t.subject,
                'Description': t.description,
                'Priority': t.priority,
                'Status': t.status,
                'CategoryType': t.category_type,
                'CreatedAt': t.created_at.isoformat() if t.created_at else None,
                'UpdatedAt': t.updated_at.isoformat() if t.updated_at else None,
                'ClientRecordId': t.client_record_id,
                'AssignedToUserId': t.assigned_to_user_id,
                'CategoryName': t.category.name if t.category else None,
                'CreatedByName': f'{creator.first_name} {creator.last_name}' if creator else None,
                'CreatedByEmail': creator.email if creator else None,
                'AssignedToName': f'{assignee.first_name} {assignee.last_name}' if assignee else None,
                'CompanyName': client.business_name if client else None,
            })

        return Response({'tickets': tickets})
    except Exception:
        logger.exception('Fetch tickets error')
        return Response({'message': 'Server error.'}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)


# ---------------------------------------------------------------------------
# GET/PUT /api/support/tickets/<id>
# ---------------------------------------------------------------------------
@csrf_exempt
@api_view(['GET', 'PUT'])
def ticket_detail_update(request, id):
    if request.method == 'GET':
        return _get_ticket(request, id)
    return _update_ticket(request, id)


def _get_ticket(request, id):
    try:
        try:
            t = SupportTicket.objects.select_related('category').get(pk=id)
        except SupportTicket.DoesNotExist:
            return Response({'message': 'Ticket not found.'}, status=status.HTTP_404_NOT_FOUND)

        # Creator
        creator = User.objects.filter(pk=t.created_by_user_id).first()
        # Assignee
        assignee = User.objects.filter(pk=t.assigned_to_user_id).first() if t.assigned_to_user_id else None
        # Client record
        client = ClientRecord.objects.filter(pk=t.client_record_id).first() if t.client_record_id else None

        ticket_data = {
            'Id': t.id,
            'CategoryId': t.category_id,
            'CategoryType': t.category_type,
            'Subject': t.subject,
            'Description': t.description,
            'Priority': t.priority,
            'Status': t.status,
            'CreatedByUserId': t.created_by_user_id,
            'ClientRecordId': t.client_record_id,
            'AssignedToUserId': t.assigned_to_user_id,
            'CreatedAt': t.created_at.isoformat() if t.created_at else None,
            'UpdatedAt': t.updated_at.isoformat() if t.updated_at else None,
            'CategoryName': t.category.name if t.category else None,
            'CreatedByName': f'{creator.first_name} {creator.last_name}' if creator else None,
            'CreatedByEmail': creator.email if creator else None,
            'AssignedToName': f'{assignee.first_name} {assignee.last_name}' if assignee else None,
            'CompanyName': client.business_name if client else None,
        }

        # Comments
        comments_qs = (
            SupportTicketComment.objects
            .filter(ticket_id=id)
            .order_by('created_at')
        )
        comment_user_ids = {c.user_id for c in comments_qs}
        comment_users = {}
        if comment_user_ids:
            for u in User.objects.filter(pk__in=comment_user_ids):
                comment_users[u.id] = u

        comments = []
        for c in comments_qs:
            cu = comment_users.get(c.user_id)
            comments.append({
                'Id': c.id,
                'Comment': c.comment,
                'CreatedAt': c.created_at.isoformat() if c.created_at else None,
                'UserName': f'{cu.first_name} {cu.last_name}' if cu else None,
                'UserRole': cu.role if cu else None,
            })

        return Response({'ticket': ticket_data, 'comments': comments})
    except Exception:
        logger.exception('Fetch ticket error')
        return Response({'message': 'Server error.'}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)


def _update_ticket(request, id):
    data = request.data
    new_status = data.get('status')
    new_priority = data.get('priority')
    assigned_to = data.get('assignedToUserId')

    try:
        try:
            ticket = SupportTicket.objects.get(pk=id)
        except SupportTicket.DoesNotExist:
            return Response({'message': 'Ticket not found.'}, status=status.HTTP_404_NOT_FOUND)

        updated = False
        if new_status:
            ticket.status = new_status
            updated = True
        if new_priority:
            ticket.priority = new_priority
            updated = True
        if assigned_to is not None:
            ticket.assigned_to_user_id = assigned_to or None
            updated = True

        if not updated:
            return Response({'message': 'No updates provided.'}, status=status.HTTP_400_BAD_REQUEST)

        ticket.updated_at = timezone.now()
        ticket.save()

        # Send notification email for any status or priority change
        if new_status or new_priority:
            try:
                creator = User.objects.filter(pk=ticket.created_by_user_id).first()
                category = SupportTicketCategory.objects.filter(pk=ticket.category_id).first()
                if creator:
                    changes_html = ''
                    if new_status:
                        status_color = '#16a34a' if new_status == 'Closed' else '#d97706' if new_status == 'In Progress' else '#0E7C7B'
                        changes_html += (
                            f'<tr><td style="padding: 6px 0; font-weight: 600;">Status:</td>'
                            f'<td style="padding: 6px 0; color: {status_color}; font-weight: 700;">{new_status}</td></tr>'
                        )
                    if new_priority:
                        priority_color = '#dc2626' if new_priority in ('High', 'Urgent') else '#d97706' if new_priority == 'Medium' else '#6b7280'
                        changes_html += (
                            f'<tr><td style="padding: 6px 0; font-weight: 600;">Priority:</td>'
                            f'<td style="padding: 6px 0; color: {priority_color}; font-weight: 700;">{new_priority}</td></tr>'
                        )

                    title = f'Ticket #{ticket.id} Updated'
                    if new_status == 'Closed':
                        title = f'Ticket #{ticket.id} Closed'
                        intro = f'Hi {creator.first_name}, your support ticket has been resolved and closed.'
                    elif new_status == 'In Progress':
                        intro = f'Hi {creator.first_name}, your support ticket is now being worked on.'
                    elif new_status == 'Resolved':
                        intro = f'Hi {creator.first_name}, your support ticket has been resolved.'
                    else:
                        intro = f'Hi {creator.first_name}, your support ticket has been updated.'

                    send_email(
                        to=creator.email,
                        subject=f'EPVS Support - {title}',
                        html=wrap_email(
                            f'<h2 style="color: #1e293b; margin-top: 0;">{title}</h2>'
                            f'<p style="color: #555; font-size: 15px; line-height: 1.6;">{intro}</p>'
                            '<div style="background: #f9fafb; border: 1px solid #e5e7eb; border-radius: 8px; padding: 16px; margin: 20px 0;">'
                            '<table style="width: 100%; font-size: 14px; color: #374151;">'
                            '<tr><td style="padding: 6px 0; font-weight: 600; width: 130px;">Ticket Reference:</td>'
                            f'<td style="padding: 6px 0; color: #0E7C7B; font-weight: 700; font-size: 16px;">#{ticket.id}</td></tr>'
                            '<tr><td style="padding: 6px 0; font-weight: 600;">Subject:</td>'
                            f'<td style="padding: 6px 0;">{ticket.subject}</td></tr>'
                            '<tr><td style="padding: 6px 0; font-weight: 600;">Issue Type:</td>'
                            f'<td style="padding: 6px 0;">{category.name if category else ""}</td></tr>'
                            f'{changes_html}'
                            '</table></div>'
                            '<p style="color: #555; font-size: 14px; line-height: 1.6;">'
                            'You can view this ticket by navigating to the <strong>Support</strong> tab in the EPVS system.'
                            '</p>'
                        ),
                    )
            except Exception as email_err:
                logger.error('Failed to send ticket update email: %s', email_err)

        return Response({'message': 'Ticket updated.'})
    except Exception:
        logger.exception('Update ticket error')
        return Response({'message': 'Server error.'}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)


# ---------------------------------------------------------------------------
# POST /api/support/tickets/<id>/comments
# ---------------------------------------------------------------------------
@csrf_exempt
@api_view(['POST'])
def add_comment(request, id):
    data = request.data
    user_id = data.get('userId')
    comment_text = data.get('comment')

    if not user_id or not comment_text:
        return Response(
            {'message': 'User and comment are required.'},
            status=status.HTTP_400_BAD_REQUEST,
        )

    try:
        SupportTicketComment.objects.create(
            ticket_id=id,
            user_id=user_id,
            comment=comment_text,
        )

        # Update ticket's UpdatedAt
        SupportTicket.objects.filter(pk=id).update(updated_at=timezone.now())

        # Send notification email to ticket creator
        try:
            ticket = SupportTicket.objects.get(pk=id)
            creator = User.objects.filter(pk=ticket.created_by_user_id).first()
            commenter = User.objects.filter(pk=user_id).first()

            if creator and commenter:
                commenter_name = f'{commenter.first_name} {commenter.last_name}'
                commenter_role = commenter.role
                comment_html = comment_text.replace('\n', '<br>')

                send_email(
                    to=creator.email,
                    subject=f'EPVS Support - New Comment on Ticket #{ticket.id}',
                    html=wrap_email(
                        '<h2 style="color: #1e293b; margin-top: 0;">New Comment on Your Ticket</h2>'
                        '<p style="color: #555; font-size: 15px; line-height: 1.6;">'
                        f'Hi {creator.first_name}, a new comment has been added to your support ticket.'
                        '</p>'
                        '<div style="background: #f9fafb; border: 1px solid #e5e7eb; border-radius: 8px; padding: 16px; margin: 20px 0;">'
                        '<table style="width: 100%; font-size: 14px; color: #374151; margin-bottom: 14px;">'
                        '<tr><td style="padding: 4px 0; font-weight: 600; width: 130px;">Ticket Reference:</td>'
                        f'<td style="padding: 4px 0; color: #0E7C7B; font-weight: 700;">#{ticket.id}</td></tr>'
                        '<tr><td style="padding: 4px 0; font-weight: 600;">Subject:</td>'
                        f'<td style="padding: 4px 0;">{ticket.subject}</td></tr></table>'
                        '<div style="border-top: 1px solid #e5e7eb; padding-top: 14px;">'
                        '<p style="margin: 0 0 6px; font-size: 13px; color: #6b7280;">'
                        f'<strong style="color: #1f2937;">{commenter_name}</strong>'
                        f'<span style="background: #e0f2f2; color: #065f5e; padding: 2px 8px; border-radius: 10px; font-size: 11px; font-weight: 600; margin-left: 6px;">{commenter_role}</span>'
                        '</p>'
                        '<p style="margin: 0; font-size: 14px; color: #374151; line-height: 1.6; background: #fff; padding: 12px; border-radius: 6px; border: 1px solid #e5e7eb;">'
                        f'{comment_html}</p></div></div>'
                        '<p style="color: #555; font-size: 14px; line-height: 1.6;">'
                        'You can view and reply to this ticket by navigating to the <strong>Support</strong> tab in the EPVS system.'
                        '</p>'
                    ),
                )
        except Exception as email_err:
            logger.error('Failed to send comment notification email: %s', email_err)

        return Response({'message': 'Comment added.'}, status=status.HTTP_201_CREATED)
    except Exception:
        logger.exception('Add comment error')
        return Response({'message': 'Server error.'}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)
