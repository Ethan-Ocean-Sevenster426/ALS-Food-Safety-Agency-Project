from django.urls import path
from api.views.company_views import (
    get_company,
    update_company,
    get_company_users,
    invite_company_user,
    delete_company_user,
    get_company_audit_log,
)

urlpatterns = [
    path('<int:client_record_id>/', get_company, name='get-company'),
    path('<int:client_record_id>/update/', update_company, name='update-company'),
    path('<int:client_record_id>/users/', get_company_users, name='get-company-users'),
    path('<int:client_record_id>/invite/', invite_company_user, name='invite-company-user'),
    path('<int:client_record_id>/users/<int:user_id>/', delete_company_user, name='delete-company-user'),
    path('<int:client_record_id>/audit-log/', get_company_audit_log, name='get-company-audit-log'),
]
