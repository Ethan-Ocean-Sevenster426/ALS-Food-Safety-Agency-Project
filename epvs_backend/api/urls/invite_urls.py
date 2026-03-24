from django.urls import path
from api.views.invite_views import send_invite, get_invite, accept_invite

urlpatterns = [
    path('', send_invite, name='send-invite'),
    path('<str:token>/', get_invite, name='get-invite'),
    path('<str:token>/accept/', accept_invite, name='accept-invite'),
]
