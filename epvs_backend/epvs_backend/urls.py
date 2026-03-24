from django.contrib import admin
from django.urls import path, include
from django.http import JsonResponse


def health_check(request):
    return JsonResponse({'status': 'ok'})


urlpatterns = [
    path('admin/', admin.site.urls),
    path('api/health', health_check),
    path('api/auth/', include('api.urls.auth_urls')),
    path('api/clients/', include('api.urls.client_urls')),
    path('api/invites/', include('api.urls.invite_urls')),
    path('api/company/', include('api.urls.company_urls')),
    path('api/epv/', include('api.urls.epv_urls')),
    path('api/support/', include('api.urls.support_urls')),
    path('api/dashboard/', include('api.urls.dashboard_urls')),
    path('api/invoices/', include('api.urls.invoice_urls')),
    path('api/admin/', include('api.urls.admin_urls')),
]
