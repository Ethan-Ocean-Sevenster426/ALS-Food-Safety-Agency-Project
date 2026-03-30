import jwt
from django.conf import settings
from django.http import JsonResponse
from django.urls import resolve, Resolver404
from api.models import User


class SlashNormalizationMiddleware:
    """Try the URL as-is; if it 404s, try with/without trailing slash."""

    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        path = request.path
        try:
            resolve(path)
        except Resolver404:
            # Try the opposite slash variant
            if path.endswith('/'):
                alt = path.rstrip('/')
            else:
                alt = path + '/'
            try:
                resolve(alt)
                request.path_info = alt
                request.path = alt
            except Resolver404:
                pass  # Let it 404 naturally
        return self.get_response(request)


# Routes that don't require authentication
PUBLIC_PATHS = [
    '/api/health',
    '/api/auth/login',
    '/api/auth/signup',
    '/api/auth/forgot-password',
    '/api/auth/reset-password/',
    '/api/invites/',
    '/api/epv/token/',
    '/api/invoices/download/',
]


def is_public_path(path):
    for public in PUBLIC_PATHS:
        if path.startswith(public):
            return True
    return False


class JWTAuthMiddleware:
    """Middleware to verify JWT tokens on protected routes."""

    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        path = request.path

        # Skip auth for public routes
        if is_public_path(path):
            return self.get_response(request)

        # Skip auth for non-API routes
        if not path.startswith('/api/'):
            return self.get_response(request)

        # Extract token from Authorization header
        auth_header = request.headers.get('Authorization', '')

        if not auth_header:
            # Also check query params for token (for file downloads)
            token = request.GET.get('token')
            if not token:
                return JsonResponse(
                    {'message': 'Authentication required.'},
                    status=401,
                )
        else:
            # Support "Bearer <token>" format
            parts = auth_header.split(' ')
            if len(parts) == 2 and parts[0].lower() == 'bearer':
                token = parts[1]
            else:
                token = auth_header

        try:
            payload = jwt.decode(token, settings.SECRET_KEY, algorithms=['HS256'])
            request.jwt_user = payload
            request.jwt_user_id = payload.get('id')
            request.jwt_user_role = payload.get('role')
        except jwt.ExpiredSignatureError:
            return JsonResponse(
                {'message': 'Token has expired. Please log in again.'},
                status=401,
            )
        except jwt.InvalidTokenError:
            return JsonResponse(
                {'message': 'Invalid token. Please log in again.'},
                status=401,
            )

        return self.get_response(request)


class RoleRequiredMixin:
    """Helper to check roles in views."""

    @staticmethod
    def require_roles(request, allowed_roles):
        role = getattr(request, 'jwt_user_role', None)
        if role not in allowed_roles:
            return JsonResponse(
                {'message': 'You do not have permission to perform this action.'},
                status=403,
            )
        return None
