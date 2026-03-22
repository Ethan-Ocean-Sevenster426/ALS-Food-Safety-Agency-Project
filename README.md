# Egg Production Verification System (EPVS)

A full-stack web application for managing egg production facilities, client allocations, user invitations, support tickets, and statutory levy verifications. Built for ALS Food Safety Agency.

---

## Tech Stack

| Layer    | Technology                                                    |
| -------- | ------------------------------------------------------------- |
| Frontend | React 19, React Router 7, Axios, Recharts                    |
| Backend  | Express 5 (Node.js)                                          |
| Database | Microsoft SQL Server (via `mssql` + `msnodesqlv8` ODBC)      |
| Auth     | JWT (`jsonwebtoken`) + bcrypt (`bcryptjs`)                    |
| Email    | Nodemailer (Gmail via Google OAuth2 — `googleapis`)           |
| Uploads  | Multer (file uploads for POP documents)                       |
| Other    | `xlsx` for Excel import, `dotenv` for config                  |

---

## Project Structure

```
├── client/                         # React frontend (Create React App)
│   ├── public/
│   │   └── index.html              # Favicon (fsa-logo.png), title "EPVS"
│   └── src/
│       ├── App.js                  # Root component — routing & auth guards
│       ├── components/
│       │   ├── AppLayout.js        # Shared layout (Navbar + SupportButton + <Outlet />)
│       │   ├── Navbar.js           # Top navigation bar (role-aware)
│       │   ├── Navbar.css
│       │   ├── SupportButton.js    # Floating support ticket button (bottom-right)
│       │   └── SupportButton.css
│       └── pages/
│           ├── Login.js            # Email/password login + forgot password
│           ├── Signup.js           # Self-registration form
│           ├── ResetPassword.js    # Token-based password reset
│           ├── AcceptInvite.js     # Invitation acceptance + wizard for Company Admins
│           ├── Dashboard.js        # Super Admin holistic dashboard (KPIs, charts, action items)
│           ├── Settings.js         # User Management — user table, edit, deactivate, reset
│           ├── ClientAllocation.js # Master abattoir database CRUD + audit log
│           ├── CompanyOverview.js  # Per-company detail view, users, invites, EPVs, POP & reconciliation
│           ├── Inspectors.js       # Inspector dashboard — KPIs, approvals, visits, reconciliation
│           ├── Administrators.js   # Admin dashboard — reconciliation management, financial KPIs
│           ├── EPVForm.js          # 5-step egg production verification wizard
│           ├── Support.js          # Support ticket list, detail view, comments, admin controls
│           ├── Auth.css            # Shared login/signup/reset styles
│           ├── PageStyles.css      # Shared page layout styles
│           └── *.css               # Page-specific CSS files
│
├── server/                         # Express backend
│   ├── index.js                    # App entry — middleware + route mounting
│   ├── initDb.js                   # One-time DB + table creation script
│   ├── seed-demo.js                # Demo seed script — populates EPVs for Jan–Mar 2026
│   ├── seed-admins.js              # Seed script — creates 3 Admin users
│   ├── config/
│   │   └── db.js                   # MSSQL connection pool (singleton)
│   ├── routes/
│   │   ├── auth.js                 # Signup, login, password reset, user CRUD, edit, deactivate
│   │   ├── clients.js              # Client allocation CRUD + audit log
│   │   ├── invites.js              # Invitation send/accept flow (with FacilityProvince)
│   │   ├── company.js              # Company overview + per-company user/invite mgmt
│   │   ├── epv.js                  # EPV send/submit/edit/list + POP upload + reconciliation + inspector endpoints
│   │   ├── admin.js                # Admin reconciliation endpoints — stats, list, batch reconcile
│   │   ├── support.js              # Support tickets CRUD, comments, email notifications
│   │   ├── dashboard.js            # Dashboard analytics + EPV overview endpoint
│   │   └── invoices.js             # Invoice generation (feature under development)
│   ├── services/
│   │   └── emailService.js         # Nodemailer transport (Gmail OAuth2)
│   ├── uploads/
│   │   ├── pop/                    # Uploaded Proof of Payment files
│   │   └── invoices/               # Generated invoice PDFs
│   └── scripts/
│       ├── createAuditLog.js       # Creates ClientAllocationAuditLog table
│       ├── createEPVTables.js      # Creates EggProductionVerifications table + migration columns
│       ├── getGmailToken.js        # OAuth2 token retrieval helper
│       └── importClientAllocation.js # Imports client data from Excel
```

---

## Getting Started

### Prerequisites

- **Node.js** (v18+)
- **Microsoft SQL Server** (local instance with Windows Authentication)
- **ODBC Driver 18 for SQL Server** installed
- **Gmail account** with OAuth2 credentials (for sending emails)

### 1. Clone & Install

```bash
git clone <repo-url>
cd "Egg Production Verification System"

# Install server dependencies
cd server
npm install

# Install client dependencies
cd ../client
npm install
```

### 2. Environment Variables

Create `server/.env`:

```env
DB_SERVER=localhost           # Your SQL Server instance
DB_NAME=EPVS                  # Database name (created automatically)
JWT_SECRET=your-secret-key    # Any strong random string
PORT=5000

# Gmail OAuth2 (for sending emails)
GMAIL_CLIENT_ID=...
GMAIL_CLIENT_SECRET=...
GMAIL_REFRESH_TOKEN=...
GMAIL_USER=your@gmail.com
```

### 3. Initialize the Database

```bash
cd server
npm run init-db
```

This creates the database and all core tables (Users, SupportTicketCategories, SupportTickets, SupportTicketComments), seeds support categories, and creates a default Super Admin account:
- **Email:** `anthony@epvs.com`
- **Password:** `StrongPassword123!`

Then run the additional table scripts:

```bash
node scripts/createAuditLog.js
node scripts/createEPVTables.js
```

### 4. Seed Demo Data (Optional)

```bash
# Seed EPVs for Jan–Mar 2026 for all facilities
npx dotenv-cli -- node seed-demo.js

# Seed 3 Admin users
npx dotenv-cli -- node seed-admins.js
```

Admin users created by seed script:
| Name | Email | Password |
|------|-------|----------|
| Sarah van der Merwe | sarah.admin@fsa.co.za | Admin@123 |
| James Nkosi | james.admin@fsa.co.za | Admin@123 |
| Lindiwe Dlamini | lindiwe.admin@fsa.co.za | Admin@123 |

### 5. Run the App

```bash
# Terminal 1 — Backend (port 5000)
cd server
npm start

# Terminal 2 — Frontend (port 3000)
cd client
npm start
```

The frontend runs on `http://localhost:3000` and calls the API at `http://localhost:5000`.

---

## Frontend Architecture

### Routing & Auth Guards (`App.js`)

All routing is defined in `App.js` using React Router v7. There are three types of routes:

1. **Public routes** — accessible without login:
   - `/login`, `/signup`
   - `/accept-invite/:token` — invitation acceptance
   - `/reset-password/:token` — password reset
   - `/epv/:token` — EPV form (accessible via email link)

2. **Protected routes** — wrapped in `<PrivateRoute>` which checks `localStorage` for a JWT token. These render inside `<AppLayout>` (Navbar + SupportButton + content area):
   - `/dashboard` — wrapped in `<AdminRoute>` (Super Admin/Admin only)
   - `/clients` — wrapped in `<AdminRoute>` (Super Admin/Admin only)
   - `/inspectors` — wrapped in `<InspectorRoute>` (Inspector/Admin/Super Admin)
   - `/administrators` — wrapped in `<AdminRoute>` (Super Admin/Admin only)
   - `/company`, `/settings`, `/support`

3. **Default redirect** — `/*` redirects based on role:
   - Company Admin / User → `/company`
   - Inspector → `/inspectors`
   - Super Admin / Admin → `/dashboard`

### Layout System

```
<AppLayout>           ← components/AppLayout.js
  <Navbar />          ← Top bar with role-aware nav links
  <Outlet />          ← Current page renders here
  <SupportButton />   ← Floating ticket button (bottom-right corner)
</AppLayout>
```

- **AppLayout** uses React Router's `<Outlet>` for nested route rendering
- **Navbar** reads the user object from `localStorage` and shows different links based on role
- **SupportButton** is a floating teal button on every authenticated page for quick ticket logging

### Role-Based UI

There are 5 roles: `Super Admin`, `Admin`, `Inspector`, `Company Admin`, `User`

| Feature                              | Super Admin | Admin | Inspector | Company Admin | User |
| ------------------------------------ | :---------: | :---: | :-------: | :-----------: | :--: |
| Dashboard (holistic analytics)       |      Y      |   Y   |     -     |       -       |  -   |
| Client Allocation (CRUD)             |      Y      |   Y   |     -     |       -       |  -   |
| Inspectors Dashboard                 |      Y      |   Y   |     Y     |       -       |  -   |
| Administrators Dashboard             |      Y      |   Y   |     -     |       -       |  -   |
| Company Overview                     |      Y      |   Y   |     Y     |       Y       |  Y   |
| User Management                      |      Y      |   Y   |     -     |       -       |  -   |
| Support (all tickets)                |      Y      |   -   |     -     |       -       |  -   |
| Support (Administration tickets)     |      Y      |   Y   |     -     |       -       |  -   |
| Support (own company tickets)        |      -      |   -   |     -     |       Y       |  Y   |
| Edit company details                 |      Y      |   Y   |     -     |       Y       |  -   |
| Edit/Deactivate users                |      Y      |   Y   |     -     |       -       |  -   |
| Reset passwords                      |      Y      |   -   |     -     |       Y       |  -   |
| Invite users to company              |      Y      |   Y   |     -     |       Y       |  -   |
| Send EPV                             |      Y      |   Y   |     -     |       -       |  -   |
| Complete/view EPV                    |      Y      |   Y   |     -     |       Y       |  Y   |
| Edit submitted EPV                   |      Y      |   Y   |     -     |       -       |  -   |
| Add manual EPV (old months)          |      -      |   -   |     -     |       Y       |  Y   |
| Upload POP                           |      Y      |   Y   |     -     |       Y       |  Y   |
| Delete POP                           |      Y      |   Y   |     -     |       -       |  -   |
| Reconcile EPV (confirm payment)      |      Y      |   Y   |     -     |       -       |  -   |
| Approve/Reject EPV (verification)    |      Y      |   Y   |     Y     |       -       |  -   |
| Complete Inspector EPV               |      -      |   -   |     Y     |       -       |  -   |
| Batch Reconciliation                 |      Y      |   Y   |     -     |       -       |  -   |

---

## Page-by-Page Guide

### Login (`/login`)
- Email/password form with "Forgot password?" toggle
- Blocks deactivated users with a clear error message
- On success: stores JWT + user object in localStorage, redirects based on role
- API: `POST /api/auth/login`, `POST /api/auth/forgot-password`

### Signup (`/signup`)
- Self-registration with first name, last name, email, password
- API: `POST /api/auth/signup`

### Accept Invite (`/accept-invite/:token`)
- Invitation flow for new users added by an admin
- For **Company Admin** role: includes a 4-step wizard to verify business details (business info, owner, accounts contact, manager)
- Captures **Facility Province** as a dropdown with all 9 South African provinces
- For **User** role: simple registration form
- API: `GET /api/invites/:token`, `POST /api/invites/:token/accept`

### Reset Password (`/reset-password/:token`)
- Token-based password reset form (accessed via email link)
- API: `POST /api/auth/reset-password/:token`

### Dashboard (`/dashboard`) — Admin/Super Admin only
- **Holistic overview** of the entire EPVS system
- Top-level stat cards: Total Users, Total Clients, EPV Forms, Support Tickets
- **4 KPI Gauges** with progress bars and target indicators:
  - Collection Rate — Prior Months (target ≥80%)
  - Collection Rate — Current Month (target ≥80%)
  - Approvals Actioned (target ≥90%)
  - Facilities Visited (target 100%)
- **Action Items** (2x2 grid): Pending Approvals, Inspector EPVs to Complete, Facilities Need Visit, Not Completed EPVs — all clickable to navigate to Inspectors page
- **Financial Summary**: Total Billed, Total Paid, Outstanding, Egg/Pulp Levy breakdown, Collection Rate percentage
- **EPV Stats Row**: Facilities, Completed EPVs, Verified, Rejections, Inspections Done, Outstanding
- **Charts**: Billed vs Paid bar chart, Egg vs Pulp Levy line chart (dual Y-axes), Facilities by Province pie chart, Rejections by Province bar chart
- **System Overview**: Users by Role, Client Verification, Ticket Overview
- Recent Users and Recent Tickets tables
- API: `GET /api/dashboard/stats`, `GET /api/dashboard/epv-overview`

### Inspectors Dashboard (`/inspectors`) — Inspector/Admin/Super Admin
- **Inspector-focused dashboard** for managing EPV verification workflow
- **4 KPI Gauges**:
  - Collection Rate — Prior Months (target ≥80%)
  - Collection Rate — Current Month (target ≥80%)
  - Approvals Actioned (target ≥90%)
  - Facilities Visited (target 100%)
- **Action Items**: Pending Approvals, Inspector EPVs to Complete, Facilities Need Visit, Outstanding Payments
- **Financial Summary**: Total Billed, Total Paid, Outstanding, Egg/Pulp Levy breakdown
- **Charts**: Billed vs Paid bar chart, Egg Levy vs Pulp Levy line chart (dual Y-axes)
- **Province Filter** (Admin/Super Admin only): filter all data by province
- **Tabbed Content** with red badge counts:
  - **Pending Approvals** — Completed facility EPVs awaiting inspector verification (approve/reject)
  - **EPVs to Complete** — Rejected EPVs where inspector needs to complete their own form
  - **Not Completed** — Facilities that haven't completed EPVs per month (with month filter badges)
  - **Need Visit** — Facilities not yet visited this quarter
  - **Outstanding** — Facilities with outstanding payment amounts
  - **Monthly Breakdown** — EPV summary by month
  - **By Province** — EPV breakdown per province (Admin only)
- Inspectors can only complete their own inspector EPVs, not facility EPVs
- API: `GET /api/epv/inspector/stats`, `GET /api/epv/inspector/pending-approvals`, `GET /api/epv/inspector/not-completed`, `PUT /api/epv/:id/verify`, `POST /api/epv/inspector/create`

### Administrators Dashboard (`/administrators`) — Admin/Super Admin only
- **Reconciliation & financial management** dashboard
- **4 KPI Gauges**:
  - Collection Rate (target ≥80%)
  - Reconciliation Rate (target ≥90%)
  - Outstanding Rate (target ≤5%)
  - Verification Rate (target ≥90%)
- **Action Items**: Needs Reconciliation, Partially Reconciled, Fully Reconciled, Total Completed EPVs
- **Financial Summary**: Total Billed, Total Reconciled, Outstanding, Egg/Pulp Levy totals
- **Charts**: Billed vs Reconciled vs Outstanding bar chart, Outstanding by Province horizontal bar chart
- **Tabbed Reconciliation Table**:
  - Needs Reconciliation / Partially Reconciled / Reconciled / All EPVs
  - Red badge counts on tabs
  - Filterable by province, month, year, and search
  - **Reconciliation Actions**: Enter amount + Reconcile button, "Full" button for full payment, batch select + reconcile selected
  - Clickable facility names navigate to Company Overview
  - Sortable columns, pagination (50/page)
- Admin/Super Admin can reconcile even without POP uploaded
- API: `GET /api/admin/stats`, `GET /api/admin/reconciliation`, `PUT /api/admin/reconcile-batch`

### Client Allocation (`/clients`) — Admin only
- Full CRUD table for the "Consolidated Master Abattoir Database"
- Includes **Facility Province** column (dropdown with SA provinces)
- Features: search, pagination (50/page), inline editing with change tracking, expandable detail rows (owner/accounts/manager contacts), add new record, delete with confirmation, audit/change log viewer
- Send Invite and Send EPV buttons per row
- Delete handles cleanup of related records (invitations, EPVs, audit log, support tickets)
- API: `GET /api/clients`, `POST /api/clients`, `PUT /api/clients/:id`, `DELETE /api/clients/:id`, `GET /api/clients/audit-log`

### Company Overview (`/company`)
- **For Admins:** company selector dropdown → pick a business to view
- **For Company users:** auto-loads their linked company
- Sections:
  - **Company header** with stats
  - **Editable company details** including Facility Province (SA provinces dropdown)
  - **User list** with invite/remove/reset
  - **Change log** with expandable entries
  - **EPV list** with enhanced table showing:
    - Reference number (EPV-YYYY-MM-XXXX format)
    - Period (month/year)
    - Status (Pending/Completed)
    - Completion date
    - POP (Proof of Payment) column — upload button, view link with styled modal
    - Reconciled column (Admin/Super Admin only) — checkbox to confirm payment received (no POP required for Admin)
    - Actions column — View/Edit links
  - **"+ Add" button** for Company Admin/User to create manual EPVs for past months (one per month enforced)
  - **Invoices section** (Feature Under Development)
- API: `GET /api/company/:id`, `PUT /api/company/:id`, `GET /api/company/:id/users`, `POST /api/company/:id/invite`, `DELETE /api/company/:id/users/:userId`, `GET /api/company/:id/audit-log`

### EPV Form (`/epv/:token`)
- **5-step wizard:**
  1. **Business Details** — company info, authorized person, contact details, Facility Province (SA provinces dropdown)
  2. **Levy (Eggs)** — structured calculation with sections:
     - **A:** Opening Stock (previous month closing)
     - **B:** Purchases (Graded + Ungraded)
     - **C:** Deductions (Market Returns, Machine Loss, Sent to Pulp, Destroyed)
     - **D:** Sales (Sold to Trade, Exported, Sold to Staff, Farm Stall) × R0.018 levy rate
     - **E:** Transfers (to other producers)
     - **Closing Stock:** Theoretical (A+B-C-D-E), Actual (user input), (Loss)/Gain
  3. **Levy (Pulp)** — Statutory Levy calculation:
     - A: Opening Stock (Pulp brought forward) — KG input, auto-calculated Dozens (×1.7)
     - B: Pulp Purchased from others — KG input, auto-calculated Dozens
     - C: Converted to Pulp Excluding Grading — KG input, auto-calculated Dozens
  4. **Review & Submit** — summary of all sections with formatted numbers
  5. **Success** — confirmation with back to Company Overview button
- All inputs use **whole numbers** with **thousand comma separation** for readability
- **Unique reference numbers** per EPV (format: `EPV-YYYY-MM-XXXX`)
- **Role-based access control:**
  - Admin/Super Admin: can edit submitted forms (edit badge + Save Changes button)
  - Company Admin/User: read-only view of submitted forms with "log a support ticket" message
  - Unauthenticated users: "Already Submitted" screen if form is completed
- **Back to Company Overview** button (solid teal) prominently displayed at top of form
- API: `GET /api/epv/token/:token`, `PUT /api/epv/token/:token/submit`, `PUT /api/epv/:id/edit`

### Support (`/support`)
- Full support ticket system with search, filters (status, priority, issue type)
- Ticket detail view with comments thread
- Admin controls: change status, priority, assign to admin users
- **Visibility rules:**
  - Super Admin — sees all tickets
  - Admin — sees Administration-category tickets only
  - Company Admin/User — sees only their company's tickets
- **Email notifications:** ticket created (with ref #), comment added (with comment text), ticket closed (resolution notice)
- **Floating SupportButton** on every authenticated page for quick ticket creation
- API: `GET /api/support/categories`, `POST /api/support/tickets`, `GET /api/support/tickets`, `GET /api/support/tickets/:id`, `PUT /api/support/tickets/:id`, `POST /api/support/tickets/:id/comments`

### User Management (`/settings`)
- Shows current user's profile (name, email, role)
- **Admin-only section:** user management table with:
  - Status column (Active/Inactive badges)
  - Company association column (business name + client ID)
  - Edit user modal (name, email, role)
  - Deactivate/Activate toggle with confirmation
  - Reset password, Delete user
- API: `GET /api/auth/users`, `PUT /api/auth/users/:id`, `PUT /api/auth/users/:id/role`, `PUT /api/auth/users/:id/deactivate`, `PUT /api/auth/users/:id/reset-password`, `DELETE /api/auth/users/:id`

---

## API Routes Summary

### Auth (`/api/auth`)
| Method | Endpoint                    | Description                        |
| ------ | --------------------------- | ---------------------------------- |
| POST   | `/signup`                   | Create new user                    |
| POST   | `/login`                    | Login, returns JWT + user          |
| GET    | `/users`                    | List all users (admin)             |
| PUT    | `/users/:id`                | Edit user (name, email, role)      |
| PUT    | `/users/:id/role`           | Update user role                   |
| PUT    | `/users/:id/deactivate`     | Toggle user active/inactive status |
| PUT    | `/users/:id/reset-password` | Reset user password (admin)        |
| DELETE | `/users/:id`                | Delete user                        |
| POST   | `/forgot-password`          | Send reset email                   |
| POST   | `/reset-password/:token`    | Reset password via token           |

### Clients (`/api/clients`)
| Method | Endpoint      | Description                          |
| ------ | ------------- | ------------------------------------ |
| GET    | `/`           | List clients (paginated, searchable) |
| POST   | `/`           | Create new client                    |
| PUT    | `/:id`        | Update client fields                 |
| DELETE | `/:id`        | Delete client + cleanup related data |
| GET    | `/audit-log`  | Client change audit log              |

### Invites (`/api/invites`)
| Method | Endpoint           | Description                              |
| ------ | ------------------ | ---------------------------------------- |
| POST   | `/`                | Send invitation email                    |
| GET    | `/:token`          | Get invitation details                   |
| POST   | `/:token/accept`   | Accept invite + register (saves province)|

### Company (`/api/company`)
| Method | Endpoint              | Description                    |
| ------ | --------------------- | ------------------------------ |
| GET    | `/:id`                | Get company details            |
| PUT    | `/:id`                | Update company details         |
| GET    | `/:id/users`          | List company users + invites   |
| POST   | `/:id/invite`         | Invite user to company         |
| DELETE | `/:id/users/:userId`  | Remove user from company       |
| GET    | `/:id/audit-log`      | Company-specific audit log     |

### EPV (`/api/epv`)
| Method | Endpoint                       | Description                                       |
| ------ | ------------------------------ | ------------------------------------------------- |
| POST   | `/send`                        | Send EPV email to client (generates ref number)   |
| POST   | `/create-manual`               | Create manual EPV for past month                  |
| GET    | `/token/:token`                | Get verification by token                         |
| PUT    | `/token/:token/submit`         | Submit completed verification                     |
| PUT    | `/:id/edit`                    | Edit submitted EPV (Admin/Super Admin only)       |
| GET    | `/company/:id`                 | List verifications for a company                  |
| GET    | `/:id`                         | Get single EPV by ID                              |
| GET    | `/:id/audit-log`               | EPV change audit log                              |
| POST   | `/:id/upload-pop`              | Upload Proof of Payment (PDF/PNG/JPG, max 10MB)   |
| GET    | `/:id/pop`                     | Download/view POP file                            |
| DELETE | `/:id/pop`                     | Delete POP file (Admin/Super Admin only)          |
| PUT    | `/:id/reconcile`               | Toggle reconciliation status                      |
| PUT    | `/:id/reconciled-amount`       | Save reconciled amount                            |
| PUT    | `/:id/verify`                  | Toggle verification status (Inspector/Admin)      |
| PUT    | `/:id/comment`                 | Save inspector comment                            |
| GET    | `/inspector/stats`             | Inspector dashboard aggregate stats               |
| GET    | `/inspector/pending-approvals` | EPVs pending inspector approval                   |
| GET    | `/inspector/not-completed`     | Facilities missing EPVs per month                 |
| POST   | `/inspector/create`            | Create inspector EPV (on rejection)               |

### Admin (`/api/admin`)
| Method | Endpoint            | Description                                             |
| ------ | ------------------- | ------------------------------------------------------- |
| GET    | `/stats`            | Admin financial stats, monthly breakdown, by province   |
| GET    | `/reconciliation`   | Paginated EPVs with filters (status, province, search)  |
| PUT    | `/reconcile-batch`  | Batch reconcile EPVs with amounts + audit logging       |

### Support (`/api/support`)
| Method | Endpoint                | Description                                    |
| ------ | ----------------------- | ---------------------------------------------- |
| GET    | `/categories`           | List active support ticket categories           |
| POST   | `/tickets`              | Create a ticket (sends confirmation email)      |
| GET    | `/tickets`              | List tickets (role-filtered)                    |
| GET    | `/tickets/:id`          | Get ticket detail with comments                 |
| PUT    | `/tickets/:id`          | Update ticket (status, priority, assignee)      |
| POST   | `/tickets/:id/comments` | Add comment (sends notification email)          |

### Dashboard (`/api/dashboard`)
| Method | Endpoint         | Description                                                     |
| ------ | ---------------- | --------------------------------------------------------------- |
| GET    | `/stats`         | Aggregated stats: users, clients, EPVs, tickets, recent activity|
| GET    | `/epv-overview`  | Holistic EPV data: KPIs, monthly, province, action item counts  |

---

## Database Tables

Created by `initDb.js` and the scripts in `server/scripts/`:

- **Users** — user accounts (Id, FirstName, LastName, Email, PasswordHash, Role, IsActive, InspectorProvince, CreatedAt)
- **ConsolidatedMasterAbattoirDatabase** — client/facility records with extensive contact fields, FacilityProvince, FacilityType
- **ClientAuditLog** — change history for client records (with UserRole tracking)
- **Invitations** — invitation tokens linking users to client records
- **EggProductionVerifications** — monthly EPV submissions with:
  - EPV types: `Client` (facility EPV) and `Inspector` (inspector EPV linked via LinkedEPVId)
  - Calculation fields: OpeningStock, GradedEggsPurchased, UngradedEggsPurchased, MarketReturns, MachineLoss, SentToPulp, Destroyed, SoldToTrade, Exported, SoldToStaff, SoldThroughFarmStall, TransferredToOtherProducers
  - Computed totals: TotalB, TotalC, TotalD, TotalE, LevyAmount, ClosingStock, ActualClosingStock, LossGain
  - Pulp fields: PulpOpeningStock, PulpPurchased, PulpConverted, PulpSoldToTrade
  - Reference: ReferenceNumber (EPV-YYYY-MM-XXXX)
  - POP tracking: POPFilePath, POPUploadedAt, POPUploadedBy, POPComment
  - Reconciliation: IsReconciled, ReconciledBy, ReconciledAt, ReconciledAmount
  - Verification: IsVerified, VerifiedBy, VerifiedAt, InspectorComment
  - Inspection: ManualInspection (flag for physical visit)
  - Province: FacilityProvince
- **SupportTicketCategories** — ticket issue types with CategoryType (IT/Administration) and SortOrder
- **SupportTickets** — support tickets with category, priority, status, assignment
- **SupportTicketComments** — threaded comments on tickets

---

## Key Features

### EPV Reference Numbers
- Every EPV gets a unique reference number in format `EPV-YYYY-MM-XXXX` (e.g., `EPV-2026-03-0001`)
- Sequential numbering per month to avoid collisions
- Used on quotations and for payment reconciliation

### EPV Approval Workflow
- Facility completes EPV → status becomes "Completed"
- Inspector can **Approve** (sets IsVerified=1) or **Reject** (creates an Inspector EPV)
- Rejected EPVs appear in inspector's "EPVs to Complete" tab
- Inspector completes their own EPV form with their findings

### Proof of Payment (POP) Upload
- Clients can upload POP documents (PDF, PNG, JPG — max 10MB) against completed EPVs
- Uploaded files are stored in `server/uploads/pop/`
- Admin/Super Admin can delete uploaded POPs
- POP cannot be uploaded once an EPV is reconciled

### Payment Reconciliation
- Admin/Super Admin can reconcile EPVs from Company Overview or Administrators dashboard
- **Admin/Super Admin can reconcile without POP uploaded**
- Batch reconciliation available on Administrators page
- Auto-marks as fully reconciled when amount equals total billed
- All reconciliation actions are audit logged
- Reconciled EPVs are visually highlighted

### KPI Tracking
- **Collection Rate**: Split into prior months vs current month (so current month doesn't drag down overall rate)
- **Approvals Actioned**: Percentage of EPVs verified by inspectors (target ≥90%)
- **Facilities Visited**: Percentage visited per quarter (target 100%)
- **Outstanding Rate**: Percentage of outstanding payments (target ≤5%)
- **Reconciliation Rate**: Percentage of EPVs fully reconciled (target ≥90%)

### Facility Province Tracking
- Province is captured during invitation acceptance (Company Admin wizard)
- Province is included in EPV form (Step 1: Business Details)
- Province is editable in Company Overview and Client Allocation
- Uses dropdown with all 9 South African provinces
- Inspector dashboards can filter by province

### Manual EPV Creation
- Company Admin/User can create EPVs for past months via "+ Add" button
- One EPV per month enforced (duplicate check)
- Cannot create EPVs for future months

---

## Key Notes for Development

1. **No auth middleware on routes yet:** The backend routes don't verify the JWT token. Add middleware to protect routes and enforce role-based access server-side.

2. **Frontend expects this API response pattern:**
   ```js
   // Success
   res.json({ message: '...', data: [...], total: N, totalPages: N })
   // Error
   res.status(4xx).json({ message: 'Error description' })
   ```

3. **Frontend reads user from localStorage:**
   ```js
   const user = JSON.parse(localStorage.getItem('user') || '{}');
   // user = { id, firstName, lastName, email, role, clientRecordId, inspectorProvince }
   ```

4. **All API calls go to `http://localhost:5000`** — hardcoded in each page. Consider centralizing this.

5. **Database uses Windows Authentication** via ODBC — no username/password in the connection string. The developer needs SQL Server running locally with ODBC Driver 18.

6. **Email notifications** are sent via Gmail OAuth2 for: invitations, password resets, EPV requests, support ticket events (created, commented, closed).

7. **Database migrations** use `IF NOT EXISTS` column checks in `createEPVTables.js` — safe to re-run without data loss.

8. **Levy calculation:** Egg Levy = LevyAmount (SoldToTrade × R0.018), Pulp Levy = (PulpSoldToTrade × 1.7) × R0.018.

9. **Invoices feature** is under development — the section exists in Company Overview but is not yet functional.
