from django.urls import path
from api.views.support_views import (
    list_categories,
    tickets_list_create,
    ticket_detail_update,
    add_comment,
)

urlpatterns = [
    path('categories', list_categories, name='support-categories'),
    path('tickets', tickets_list_create, name='support-tickets'),
    path('tickets/<int:id>', ticket_detail_update, name='support-ticket-detail'),
    path('tickets/<int:id>/comments', add_comment, name='support-ticket-add-comment'),
]
