from django.urls import path
from api.views.admin_views import (
    stats,
    reconciliation,
    reconcile_batch,
)

urlpatterns = [
    path('stats', stats, name='admin_stats'),
    path('reconciliation', reconciliation, name='admin_reconciliation'),
    path('reconcile-batch', reconcile_batch, name='admin_reconcile_batch'),
]
