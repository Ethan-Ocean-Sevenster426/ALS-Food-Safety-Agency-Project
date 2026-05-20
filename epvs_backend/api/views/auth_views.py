import secrets
import bcrypt
import jwt
import math
from datetime import datetime, timedelta, timezone

from django.conf import settings
from django.db.models import Q
from django.utils import timezone as dj_timezone
from django.views.decorators.csrf import csrf_exempt

from rest_framework.decorators import api_view
from rest_framework.response import Response
from rest_framework import status

from api.models import User, Invitation, ClientRecord


VALID_ROLES = ['Super Admin', 'Admin', 'Inspector', 'Company Admin', 'User']


def _send_email(to, subject, html):
    """Placeholder for email sending - import and call the actual email service."""
    try:
        from api.services.email_service import send_email
        send_email(to=to, subject=subject, html=html)
    except ImportError:
        print(f"Email service not available. Would send to {to}: {subject}")


@csrf_exempt
@api_view(['POST'])
def signup(request):
    data = request.data
    first_name = data.get('firstName')
    last_name = data.get('lastName')
    email = data.get('email')
    password = data.get('password')
    role = data.get('role')
    inspector_province = data.get('inspectorProvince')
    client_record_id = data.get('clientRecordId')

    if not first_name or not last_name or not email or not password:
        return Response({'message': 'All fields are required.'}, status=status.HTTP_400_BAD_REQUEST)

    assigned_role = role if role in VALID_ROLES else 'User'

    try:
        if User.objects.filter(email__iexact=email).exists():
            return Response({'message': 'An account with this email already exists.'}, status=status.HTTP_409_CONFLICT)

        salt = bcrypt.gensalt(rounds=10)
        password_hash = bcrypt.hashpw(password.encode('utf-8'), salt).decode('utf-8')

        user = User.objects.create(
            first_name=first_name,
            last_name=last_name,
            email=email,
            password_hash=password_hash,
            role=assigned_role,
            inspector_province=inspector_province if assigned_role == 'Inspector' else None,
        )

        # If a clientRecordId is provided for Company Admin or User, create an accepted invitation link
        if client_record_id and assigned_role in ('Company Admin', 'User'):
            token = secrets.token_hex(32)
            Invitation.objects.create(
                client_record_id=int(client_record_id),
                email=email,
                role=assigned_role,
                token=token,
                invited_by='Super Admin',
                status='Accepted',
                accepted_at=dj_timezone.now(),
            )

        return Response({'message': 'Account created successfully.'}, status=status.HTTP_201_CREATED)
    except Exception as e:
        print(f'Signup error: {e}')
        return Response({'message': 'Server error. Please try again.'}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)


@csrf_exempt
@api_view(['POST'])
def login(request):
    data = request.data
    email = data.get('email')
    password = data.get('password')

    if not email or not password:
        return Response({'message': 'Email and password are required.'}, status=status.HTTP_400_BAD_REQUEST)

    try:
        # Find user by email (case-insensitive)
        try:
            user = User.objects.get(email__iexact=email)
        except User.DoesNotExist:
            return Response({'message': 'Invalid email or password.'}, status=status.HTTP_401_UNAUTHORIZED)

        if not user.is_active:
            return Response(
                {'message': 'Your account has been deactivated. Please contact an administrator.'},
                status=status.HTTP_403_FORBIDDEN,
            )

        is_match = bcrypt.checkpw(password.encode('utf-8'), user.password_hash.encode('utf-8'))
        if not is_match:
            return Response({'message': 'Invalid email or password.'}, status=status.HTTP_401_UNAUTHORIZED)

        # Get clientRecordId from most recent accepted invitation
        client_record_id = None
        invitation = (
            Invitation.objects.filter(email__iexact=email, status='Accepted')
            .order_by('-accepted_at')
            .first()
        )
        if invitation:
            client_record_id = invitation.client_record_id

        # Generate JWT token (24h expiry)
        payload = {
            'id': user.id,
            'email': user.email,
            'firstName': user.first_name,
            'role': user.role,
            'exp': datetime.now(timezone.utc) + timedelta(hours=24),
            'iat': datetime.now(timezone.utc),
        }
        token = jwt.encode(payload, settings.SECRET_KEY, algorithm='HS256')

        return Response({
            'message': 'Login successful.',
            'token': token,
            'user': {
                'id': user.id,
                'firstName': user.first_name,
                'lastName': user.last_name,
                'email': user.email,
                'role': user.role,
                'clientRecordId': client_record_id,
                'inspectorProvince': user.inspector_province or None,
            },
        })
    except Exception as e:
        print(f'Login error: {e}')
        return Response({'message': 'Server error. Please try again.'}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)


@csrf_exempt
@api_view(['GET'])
def get_users(request):
    try:
        users = User.objects.all().order_by('-created_at')
        user_list = []

        for u in users:
            # Get allocated client from most recent accepted invitation
            allocated_client = None
            invitation = (
                Invitation.objects.filter(email__iexact=u.email, status='Accepted')
                .order_by('-accepted_at')
                .first()
            )
            if invitation:
                try:
                    client = ClientRecord.objects.get(id=invitation.client_record_id)
                    allocated_client = client.business_name
                except ClientRecord.DoesNotExist:
                    pass

            user_list.append({
                'Id': u.id,
                'FirstName': u.first_name,
                'LastName': u.last_name,
                'Email': u.email,
                'Role': u.role,
                'CreatedAt': u.created_at.isoformat() if u.created_at else None,
                'AllocatedClient': allocated_client,
                'IsActive': u.is_active,
                'InspectorProvince': u.inspector_province,
            })

        return Response({'users': user_list})
    except Exception as e:
        print(f'Users fetch error: {e}')
        return Response({'message': 'Server error.'}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)


@csrf_exempt
@api_view(['PUT', 'DELETE'])
def user_detail(request, id):
    """Handles PUT (edit user) and DELETE (delete user) on /users/<id>."""
    if request.method == 'DELETE':
        return _delete_user(request, id)
    return _edit_user(request, id)


def _edit_user(request, id):
    data = request.data
    first_name = data.get('firstName')
    last_name = data.get('lastName')
    email = data.get('email')
    role = data.get('role')
    inspector_province = data.get('inspectorProvince')

    if not first_name or not last_name or not email:
        return Response({'message': 'First name, last name, and email are required.'}, status=status.HTTP_400_BAD_REQUEST)

    if role and role not in VALID_ROLES:
        return Response(
            {'message': f"Invalid role. Must be one of: {', '.join(VALID_ROLES)}"},
            status=status.HTTP_400_BAD_REQUEST,
        )

    try:
        try:
            user = User.objects.get(id=id)
        except User.DoesNotExist:
            return Response({'message': 'User not found.'}, status=status.HTTP_404_NOT_FOUND)

        # Check if email is taken by another user
        if User.objects.filter(email__iexact=email).exclude(id=id).exists():
            return Response({'message': 'Another account with this email already exists.'}, status=status.HTTP_409_CONFLICT)

        assigned_role = role or 'User'
        user.first_name = first_name
        user.last_name = last_name
        user.email = email
        user.role = assigned_role
        user.inspector_province = inspector_province if assigned_role == 'Inspector' else None
        user.save()

        return Response({'message': 'User updated successfully.'})
    except User.DoesNotExist:
        return Response({'message': 'User not found.'}, status=status.HTTP_404_NOT_FOUND)
    except Exception as e:
        print(f'User update error: {e}')
        return Response({'message': 'Server error.'}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)


def _delete_user(request, id):
    try:
        try:
            user = User.objects.get(id=id)
        except User.DoesNotExist:
            return Response({'message': 'User not found.'}, status=status.HTTP_404_NOT_FOUND)

        user.delete()
        return Response({'message': 'User deleted.'})
    except Exception as e:
        print(f'User delete error: {e}')
        return Response({'message': 'Server error.'}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)


@csrf_exempt
@api_view(['PUT'])
def update_role(request, id):
    role = request.data.get('role')

    if role not in VALID_ROLES:
        return Response(
            {'message': f"Invalid role. Must be one of: {', '.join(VALID_ROLES)}"},
            status=status.HTTP_400_BAD_REQUEST,
        )

    try:
        try:
            user = User.objects.get(id=id)
        except User.DoesNotExist:
            return Response({'message': 'User not found.'}, status=status.HTTP_404_NOT_FOUND)

        user.role = role
        user.save()

        return Response({'message': 'Role updated successfully.'})
    except Exception as e:
        print(f'Role update error: {e}')
        return Response({'message': 'Server error.'}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)


@csrf_exempt
@api_view(['PUT'])
def reset_password(request, id):
    new_password = request.data.get('newPassword')

    if not new_password or len(new_password) < 6:
        return Response({'message': 'Password must be at least 6 characters.'}, status=status.HTTP_400_BAD_REQUEST)

    try:
        try:
            user = User.objects.get(id=id)
        except User.DoesNotExist:
            return Response({'message': 'User not found.'}, status=status.HTTP_404_NOT_FOUND)

        salt = bcrypt.gensalt(rounds=10)
        password_hash = bcrypt.hashpw(new_password.encode('utf-8'), salt).decode('utf-8')

        user.password_hash = password_hash
        user.save()

        return Response({'message': 'Password reset successfully.'})
    except Exception as e:
        print(f'Password reset error: {e}')
        return Response({'message': 'Server error.'}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)


@csrf_exempt
@api_view(['PUT'])
def deactivate_user(request, id):
    is_active = request.data.get('isActive')

    try:
        try:
            user = User.objects.get(id=id)
        except User.DoesNotExist:
            return Response({'message': 'User not found.'}, status=status.HTTP_404_NOT_FOUND)

        if isinstance(is_active, bool):
            new_status = is_active
        else:
            new_status = not user.is_active

        user.is_active = new_status
        user.save()

        return Response({
            'message': 'User activated.' if new_status else 'User deactivated.',
            'isActive': new_status,
        })
    except Exception as e:
        print(f'Deactivate error: {e}')
        return Response({'message': 'Server error.'}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)


@csrf_exempt
@api_view(['POST'])
def forgot_password(request):
    email = request.data.get('email')

    if not email:
        return Response({'message': 'Email is required.'}, status=status.HTTP_400_BAD_REQUEST)

    try:
        try:
            user = User.objects.get(email__iexact=email)
        except User.DoesNotExist:
            # Don't reveal whether email exists
            return Response({'message': 'If an account with that email exists, a reset link has been sent.'})

        # Generate JWT reset token (1h expiry)
        payload = {
            'userId': user.id,
            'email': user.email,
            'purpose': 'password-reset',
            'exp': datetime.now(timezone.utc) + timedelta(hours=1),
            'iat': datetime.now(timezone.utc),
        }
        reset_token = jwt.encode(payload, settings.SECRET_KEY, algorithm='HS256')

        reset_url = f'https://egg-production-verification.fsa-pty.co.za/reset-password/{reset_token}'

        html = f'''
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
          <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 30px; border-radius: 12px 12px 0 0; text-align: center;">
            <h1 style="color: #fff; margin: 0; font-size: 28px;">EPVS</h1>
            <p style="color: rgba(255,255,255,0.85); margin: 8px 0 0; font-size: 14px;">Egg Production Verification System</p>
          </div>
          <div style="background: #fff; padding: 30px; border: 1px solid #e5e7eb; border-top: none; border-radius: 0 0 12px 12px;">
            <h2 style="color: #333; margin-top: 0;">Password Reset</h2>
            <p style="color: #555; font-size: 15px; line-height: 1.6;">
              Hi <strong>{user.first_name}</strong>, we received a request to reset your password.
            </p>
            <p style="color: #555; font-size: 15px; line-height: 1.6;">
              Click the button below to set a new password. This link expires in <strong>1 hour</strong>.
            </p>
            <div style="text-align: center; margin: 30px 0;">
              <a href="{reset_url}" style="display: inline-block; background-color: #4f46e5; color: #ffffff; padding: 14px 40px; border-radius: 8px; text-decoration: none; font-size: 16px; font-weight: 600;">
                Reset Password
              </a>
            </div>
            <p style="color: #999; font-size: 12px; text-align: center;">
              If you didn't request this, you can safely ignore this email.<br>
              <a href="{reset_url}" style="color: #667eea;">{reset_url}</a>
            </p>
          </div>
        </div>
        '''

        _send_email(
            to=user.email,
            subject='EPVS - Password Reset Request',
            html=html,
        )

        return Response({'message': 'If an account with that email exists, a reset link has been sent.'})
    except Exception as e:
        print(f'Forgot password error: {e}')
        return Response({'message': 'Server error. Please try again.'}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)


@csrf_exempt
@api_view(['POST'])
def reset_password_token(request, token):
    new_password = request.data.get('newPassword')

    if not new_password or len(new_password) < 6:
        return Response({'message': 'Password must be at least 6 characters.'}, status=status.HTTP_400_BAD_REQUEST)

    try:
        decoded = jwt.decode(token, settings.SECRET_KEY, algorithms=['HS256'])

        if decoded.get('purpose') != 'password-reset':
            return Response({'message': 'Invalid reset link.'}, status=status.HTTP_400_BAD_REQUEST)

        user_id = decoded.get('userId')

        try:
            user = User.objects.get(id=user_id)
        except User.DoesNotExist:
            return Response({'message': 'User not found.'}, status=status.HTTP_404_NOT_FOUND)

        salt = bcrypt.gensalt(rounds=10)
        password_hash = bcrypt.hashpw(new_password.encode('utf-8'), salt).decode('utf-8')

        user.password_hash = password_hash
        user.save()

        return Response({'message': 'Password reset successfully. You can now sign in.'})
    except jwt.ExpiredSignatureError:
        return Response({'message': 'Reset link has expired. Please request a new one.'}, status=status.HTTP_400_BAD_REQUEST)
    except jwt.InvalidTokenError:
        return Response({'message': 'Invalid reset link.'}, status=status.HTTP_400_BAD_REQUEST)
    except Exception as e:
        print(f'Reset password error: {e}')
        return Response({'message': 'Server error.'}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)
