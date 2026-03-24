from django.urls import path
from api.views.dashboard_views import (
    dashboard_stats,
    epv_overview,
    kpi_targets,
)

urlpatterns = [
    path('stats', dashboard_stats, name='dashboard-stats'),
    path('epv-overview', epv_overview, name='dashboard-epv-overview'),
    path('kpi-targets', kpi_targets, name='dashboard-kpi-targets'),
]
