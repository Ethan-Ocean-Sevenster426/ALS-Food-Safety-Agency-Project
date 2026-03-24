#!/usr/bin/env python
"""Seed script - creates default user, support categories, and KPI targets."""
import os
import sys
import django

os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'epvs_backend.settings')
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
django.setup()

import bcrypt
from api.models import User, SupportTicketCategory, KPITarget

# 1. Default Super Admin user
email = 'anthony@epvs.com'
if not User.objects.filter(email=email).exists():
    pw_hash = bcrypt.hashpw(b'StrongPassword123!', bcrypt.gensalt()).decode()
    User.objects.create(
        first_name='Anthony',
        last_name='Penzes',
        email=email,
        password_hash=pw_hash,
        role='Super Admin',
    )
    print(f'Created default user: {email}')
else:
    print(f'User {email} already exists.')

# 2. Support Ticket Categories
categories = [
    {'name': 'Access/Permission Issue', 'type': 'Administration', 'sort': 1},
    {'name': 'User Registration/Invitation Issue', 'type': 'Administration', 'sort': 2},
    {'name': 'Role or Permission Change Request', 'type': 'Administration', 'sort': 3},
    {'name': 'EPV Submission Issue', 'type': 'Administration', 'sort': 4},
    {'name': 'EPV Data Incorrect/Amendment', 'type': 'Administration', 'sort': 5},
    {'name': 'EPV Status Not Updating', 'type': 'IT', 'sort': 6},
    {'name': 'Inspector Verification Issue', 'type': 'Administration', 'sort': 7},
    {'name': 'Payment Status Issue', 'type': 'Administration', 'sort': 8},
    {'name': 'Proof of Payment Upload Issue', 'type': 'IT', 'sort': 9},
    {'name': 'Reconciliation Issue', 'type': 'Administration', 'sort': 10},
    {'name': 'Levy Calculation Query', 'type': 'Administration', 'sort': 11},
    {'name': 'Dashboard Data Incorrect', 'type': 'IT', 'sort': 12},
    {'name': 'Report Generation/Export Issue', 'type': 'IT', 'sort': 13},
    {'name': 'Company Overview Issue', 'type': 'Administration', 'sort': 14},
    {'name': 'Facility Information Update', 'type': 'Administration', 'sort': 15},
    {'name': 'Province Assignment Issue', 'type': 'Administration', 'sort': 16},
    {'name': 'Question/Help', 'type': 'Administration', 'sort': 17},
    {'name': 'Feature Request', 'type': 'IT', 'sort': 18},
    {'name': 'Performance/Speed Issue', 'type': 'IT', 'sort': 19},
    {'name': 'System Error/Bug', 'type': 'IT', 'sort': 20},
    {'name': 'Other', 'type': 'Administration', 'sort': 21},
]

for cat in categories:
    obj, created = SupportTicketCategory.objects.update_or_create(
        name=cat['name'],
        defaults={'category_type': cat['type'], 'sort_order': cat['sort']},
    )
    if created:
        print(f'  Created category: {cat["name"]}')

# Deactivate old categories not in list
valid_names = [c['name'] for c in categories]
SupportTicketCategory.objects.exclude(name__in=valid_names).filter(is_active=True).update(is_active=False)
print(f'Support categories seeded ({len(categories)} total).')

# 3. KPI Targets
kpi_defaults = [
    {'key': 'collection_rate', 'value': 80, 'label': 'Collection Rate'},
    {'key': 'approvals_actioned', 'value': 90, 'label': 'Approvals Actioned'},
    {'key': 'facilities_visited', 'value': 100, 'label': 'Facilities Visited'},
    {'key': 'reconciliation_rate', 'value': 90, 'label': 'Reconciliation Rate'},
    {'key': 'outstanding_rate', 'value': 5, 'label': 'Outstanding Rate'},
    {'key': 'verification_rate', 'value': 90, 'label': 'Verification Rate'},
]

for kpi in kpi_defaults:
    _, created = KPITarget.objects.get_or_create(
        kpi_key=kpi['key'],
        defaults={'target_value': kpi['value'], 'label': kpi['label']},
    )
    if created:
        print(f'  Created KPI: {kpi["key"]} = {kpi["value"]}%')

print('KPI targets seeded.')

# 4. Seed Admin users
admins = [
    {'first': 'Sarah', 'last': 'van der Merwe', 'email': 'sarah.admin@fsa.co.za'},
    {'first': 'James', 'last': 'Nkosi', 'email': 'james.admin@fsa.co.za'},
    {'first': 'Lindiwe', 'last': 'Dlamini', 'email': 'lindiwe.admin@fsa.co.za'},
]
admin_pw = bcrypt.hashpw(b'Admin@123', bcrypt.gensalt()).decode()
for a in admins:
    if not User.objects.filter(email=a['email']).exists():
        User.objects.create(
            first_name=a['first'], last_name=a['last'],
            email=a['email'], password_hash=admin_pw, role='Admin',
        )
        print(f'  Created admin: {a["email"]}')

print('\nDatabase seeding complete!')
