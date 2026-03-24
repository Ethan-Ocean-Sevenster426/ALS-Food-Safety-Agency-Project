from django.urls import path
from api.views.client_views import (
    list_clients,
    create_client,
    client_detail,
    audit_log,
)

urlpatterns = [
    path('', list_clients, name='list_clients'),
    path('create', create_client, name='create_client'),
    path('<int:id>', client_detail, name='client_detail'),
    path('audit-log', audit_log, name='audit_log'),
]
