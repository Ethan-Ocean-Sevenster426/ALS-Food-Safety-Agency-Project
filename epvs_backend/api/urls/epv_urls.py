from django.urls import path
from api.views.epv_views import (
    send_epv,
    create_manual_epv,
    get_epv_by_token,
    submit_epv_by_token,
    edit_epv,
    list_company_epvs,
    get_epv_by_id,
    get_epv_audit_log,
    upload_pop,
    serve_pop,
    delete_pop,
    toggle_reconcile,
    toggle_verify,
    toggle_manual_inspection,
    save_reconciled_amount,
    save_comment,
    save_pop_comment,
    update_payment_status,
    delete_inspector_epv,
    create_inspector_epv,
    inspector_company_epvs,
    inspector_not_completed,
    inspector_pending_approvals,
    inspector_stats,
)

urlpatterns = [
    # Client EPV routes
    path('send/', send_epv, name='epv-send'),
    path('create-manual/', create_manual_epv, name='epv-create-manual'),
    path('token/<str:token>/', get_epv_by_token, name='epv-by-token'),
    path('token/<str:token>/submit/', submit_epv_by_token, name='epv-submit'),

    # Inspector EPV routes (must come before /:id patterns)
    path('inspector/create/', create_inspector_epv, name='inspector-epv-create'),
    path('inspector/company/<int:client_record_id>/', inspector_company_epvs, name='inspector-company-epvs'),
    path('inspector/not-completed/', inspector_not_completed, name='inspector-not-completed'),
    path('inspector/pending-approvals/', inspector_pending_approvals, name='inspector-pending-approvals'),
    path('inspector/stats/', inspector_stats, name='inspector-stats'),
    path('inspector/<int:id>/', delete_inspector_epv, name='inspector-epv-delete'),

    # Company EPV list
    path('company/<int:client_record_id>/', list_company_epvs, name='epv-company-list'),

    # Single EPV operations (must come after more specific patterns)
    path('<int:id>/edit/', edit_epv, name='epv-edit'),
    path('<int:id>/audit-log/', get_epv_audit_log, name='epv-audit-log'),
    path('<int:id>/upload-pop/', upload_pop, name='epv-upload-pop'),
    path('<int:id>/pop/', serve_pop, name='epv-serve-pop'),
    path('<int:id>/reconcile/', toggle_reconcile, name='epv-reconcile'),
    path('<int:id>/verify/', toggle_verify, name='epv-verify'),
    path('<int:id>/manual-inspection/', toggle_manual_inspection, name='epv-manual-inspection'),
    path('<int:id>/reconciled-amount/', save_reconciled_amount, name='epv-reconciled-amount'),
    path('<int:id>/comment/', save_comment, name='epv-comment'),
    path('<int:id>/pop-comment/', save_pop_comment, name='epv-pop-comment'),
    path('<int:id>/payment-status/', update_payment_status, name='epv-payment-status'),
    path('<int:id>/', get_epv_by_id, name='epv-by-id'),
]
