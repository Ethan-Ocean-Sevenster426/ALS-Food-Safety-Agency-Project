from django.urls import path
from api.views.auth_views import (
    signup,
    login,
    get_users,
    user_detail,
    update_role,
    reset_password,
    deactivate_user,
    forgot_password,
    reset_password_token,
)

urlpatterns = [
    path('signup', signup, name='signup'),
    path('login', login, name='login'),
    path('users', get_users, name='get_users'),
    path('users/<int:id>', user_detail, name='user_detail'),
    path('users/<int:id>/role', update_role, name='update_role'),
    path('users/<int:id>/reset-password', reset_password, name='reset_password'),
    path('users/<int:id>/deactivate', deactivate_user, name='deactivate_user'),
    path('forgot-password', forgot_password, name='forgot_password'),
    path('reset-password/<str:token>', reset_password_token, name='reset_password_token'),
]
