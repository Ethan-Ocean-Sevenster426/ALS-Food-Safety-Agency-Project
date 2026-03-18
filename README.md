# Egg Production Verification System (EPVS)

A full-stack web application for managing egg production facilities, client allocations, user invitations, and statutory levy verifications. Built for ALS Food Safety Agency.

---

## Tech Stack

| Layer    | Technology                                                    |
| -------- | ------------------------------------------------------------- |
| Frontend | React 19, React Router 7, Axios                              |
| Backend  | Express 5 (Node.js)                                          |
| Database | Microsoft SQL Server (via `mssql` + `msnodesqlv8` ODBC)      |
| Auth     | JWT (`jsonwebtoken`) + bcrypt (`bcryptjs`)                    |
| Email    | Nodemailer (Gmail via Google OAuth2 — `googleapis`)           |
| Other    | `xlsx` for Excel import, `dotenv` for config                  |

---

## Project Structure

```
├── client/                         # React frontend (Create React App)
│   └── src/
│       ├── App.js                  # Root component — routing & auth guards
│       ├── components/
│       │   ├── AppLayout.js        # Shared layout (Navbar + <Outlet />)
│       │   ├── Navbar.js           # Top navigation bar (role-aware)
│       │   └── Navbar.css
│       └── pages/
│           ├── Login.js            # Email/password login + forgot password
│           ├── Signup.js           # Self-registration form
│           ├── ResetPassword.js    # Token-based password reset
│           ├── AcceptInvite.js     # Invitation acceptance + wizard for Company Admins
│           ├── Dashboard.js        # Welcome page (placeholder — needs backend)
│           ├── Production.js       # Placeholder — needs backend
│           ├── Inventory.js        # Placeholder — needs backend
│           ├── Reports.js          # Placeholder — needs backend
│           ├── Settings.js         # User profile + admin user management table
│           ├── ClientAllocation.js # Master abattoir database CRUD + audit log
│           ├── CompanyOverview.js  # Per-company detail view, users, invites, EPVs
│           ├── EPVForm.js          # 3-step egg production verification wizard
│           ├── Auth.css            # Shared login/signup/reset styles
│           ├── PageStyles.css      # Shared page layout styles
│           └── *.css               # Page-specific CSS files
│
├── server/                         # Express backend
│   ├── index.js                    # App entry — middleware + route mounting
│   ├── initDb.js                   # One-time DB + table creation script
│   ├── config/
│   │   └── db.js                   # MSSQL connection pool (singleton)
│   ├── routes/
│   │   ├── auth.js                 # Signup, login, password reset, user CRUD
│   │   ├── clients.js              # Client allocation CRUD + audit log
│   │   ├── invites.js              # Invitation send/accept flow
│   │   ├── company.js              # Company overview + per-company user/invite mgmt
│   │   └── epv.js                  # Egg production verification send/submit/list
│   ├── services/
│   │   └── emailService.js         # Nodemailer transport (Gmail OAuth2)
│   └── scripts/
│       ├── createAuditLog.js       # Creates ClientAllocationAuditLog table
│       ├── createEPVTables.js      # Creates EggProductionVerifications table
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

This creates the database and `Users` table, and seeds a default Super Admin account:
- **Email:** `anthony@epvs.com`
- **Password:** `StrongPassword123!`

Then run the additional table scripts:

```bash
node scripts/createAuditLog.js
node scripts/createEPVTables.js
```

### 4. Run the App

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

2. **Protected routes** — wrapped in `<PrivateRoute>` which checks `localStorage` for a JWT token. These render inside `<AppLayout>` (Navbar + content area):
   - `/dashboard`, `/production`, `/inventory`, `/reports`, `/settings`, `/company`
   - `/clients` — additionally wrapped in `<AdminRoute>` (Super Admin/Admin only)

3. **Default redirect** — `/*` redirects based on role:
   - Company Admin / User → `/company`
   - Super Admin / Admin → `/dashboard`

### Layout System

```
<AppLayout>           ← components/AppLayout.js
  <Navbar />          ← Top bar with role-aware nav links
  <Outlet />          ← Current page renders here
</AppLayout>
```

- **AppLayout** uses React Router's `<Outlet>` for nested route rendering
- **Navbar** reads the user object from `localStorage` and shows different links based on role

### Role-Based UI

There are 4 roles: `Super Admin`, `Admin`, `Company Admin`, `User`

| Feature                    | Super Admin | Admin | Company Admin | User |
| -------------------------- | :---------: | :---: | :-----------: | :--: |
| Dashboard                  |      Y      |   Y   |       -       |  -   |
| Production / Inventory     |      Y      |   Y   |       -       |  -   |
| Reports                    |      Y      |   Y   |       -       |  -   |
| Client Allocation (CRUD)   |      Y      |   Y   |       -       |  -   |
| Company Overview           |      Y      |   Y   |       Y       |  Y   |
| Settings (user mgmt)       |      Y      |   Y   |       -       |  -   |
| Edit company details       |      Y      |   Y   |       Y       |  -   |
| Reset passwords            |      Y      |   -   |       Y       |  -   |
| Invite users to company    |      Y      |   Y   |       Y       |  -   |
| Send EPV                   |      Y      |   Y   |       -       |  -   |
| Complete/view EPV          |      Y      |   Y   |       Y       |  Y   |

### Authentication Pattern

- On login, the server returns a JWT and a user object
- Both are stored in `localStorage` as `token` and `user`
- Every API call uses `axios` with the base URL `http://localhost:5000`
- **Note:** There is no axios interceptor or auth header middleware yet — most routes are currently unprotected on the backend. This is something to add.

### Styling Approach

- Each page has its own CSS file (e.g., `ClientAllocation.css`, `EPVForm.css`)
- Shared styles live in `Auth.css` (login/signup pages) and `PageStyles.css` (generic page container/card)
- No CSS framework — all custom CSS with CSS variables for colors
- Common patterns: `.page-container` > `.page-card` for content sections

### State Management

- No global state library (no Redux/Context) — each page manages its own state with `useState`/`useEffect`
- User info is read from `localStorage` where needed
- Data fetching uses `useCallback` + `useEffect` pattern with `axios`

---

## Page-by-Page Guide

### Login (`/login`)
- Email/password form with "Forgot password?" toggle
- On success: stores JWT + user object in localStorage, redirects to dashboard
- API: `POST /api/auth/login`, `POST /api/auth/forgot-password`

### Signup (`/signup`)
- Self-registration with first name, last name, email, password
- API: `POST /api/auth/signup`

### Accept Invite (`/accept-invite/:token`)
- Invitation flow for new users added by an admin
- For **Company Admin** role: includes a 4-step wizard to verify business details (business info, owner, accounts contact, manager)
- For **User** role: simple registration form
- API: `GET /api/invites/:token`, `POST /api/invites/:token/accept`

### Reset Password (`/reset-password/:token`)
- Token-based password reset form (accessed via email link)
- API: `POST /api/auth/reset-password/:token`

### Dashboard (`/dashboard`)
- Placeholder page — shows welcome message with user's name
- **Needs backend work:** production stats, charts, summaries

### Production (`/production`)
- Placeholder — "Track and manage daily egg production records."
- **Needs backend:** daily production data entry and tracking

### Inventory (`/inventory`)
- Placeholder — "Monitor egg stock levels, batches, and storage details."
- **Needs backend:** stock management, batch tracking

### Reports (`/reports`)
- Placeholder — "View production summaries, trends, and verification reports."
- **Needs backend:** report generation, data aggregation

### Settings (`/settings`)
- Shows current user's profile (name, email, role)
- **Admin-only section:** user management table with role editing, password reset, delete
- API: `GET /api/auth/users`, `PUT /api/auth/users/:id/role`, `PUT /api/auth/users/:id/reset-password`, `DELETE /api/auth/users/:id`

### Client Allocation (`/clients`) — Admin only
- Full CRUD table for the "Consolidated Master Abattoir Database"
- Features: search, pagination (50/page), inline editing with change tracking, expandable detail rows (owner/accounts/manager contacts), add new record, delete with confirmation, audit/change log viewer
- Send Invite and Send EPV buttons per row
- API: `GET /api/clients`, `POST /api/clients`, `PUT /api/clients/:id`, `DELETE /api/clients/:id`, `GET /api/clients/audit-log`

### Company Overview (`/company`)
- **For Admins:** company selector → pick a business to view
- **For Company users:** auto-loads their linked company
- Sections: company header with stats, editable company details, user list with invite/remove/reset, change log, EPV list with status tracking
- API: `GET /api/company/:id`, `PUT /api/company/:id`, `GET /api/company/:id/users`, `POST /api/company/:id/invite`, `DELETE /api/company/:id/users/:userId`, `GET /api/company/:id/audit-log`

### EPV Form (`/epv/:token`)
- 3-step wizard: (1) Business Details → (2) Egg Calculation → (3) Review & Submit
- Calculates: Total Stock (B), Deductions (C), Sales (D), Levy Amount (D x R0.018), Closing Stock
- Can be accessed via direct link (from email) or from Company Overview
- API: `GET /api/epv/token/:token`, `PUT /api/epv/token/:token/submit`

---

## API Routes Summary

### Auth (`/api/auth`)
| Method | Endpoint                    | Description                  |
| ------ | --------------------------- | ---------------------------- |
| POST   | `/signup`                   | Create new user              |
| POST   | `/login`                    | Login, returns JWT + user    |
| GET    | `/users`                    | List all users (admin)       |
| PUT    | `/users/:id/role`           | Update user role             |
| PUT    | `/users/:id/reset-password` | Reset user password (admin)  |
| DELETE | `/users/:id`                | Delete user                  |
| POST   | `/forgot-password`          | Send reset email             |
| POST   | `/reset-password/:token`    | Reset password via token     |

### Clients (`/api/clients`)
| Method | Endpoint      | Description                          |
| ------ | ------------- | ------------------------------------ |
| GET    | `/`           | List clients (paginated, searchable) |
| POST   | `/`           | Create new client                    |
| PUT    | `/:id`        | Update client fields                 |
| DELETE | `/:id`        | Delete client                        |
| GET    | `/audit-log`  | Client change audit log              |

### Invites (`/api/invites`)
| Method | Endpoint           | Description                |
| ------ | ------------------ | -------------------------- |
| POST   | `/`                | Send invitation email      |
| GET    | `/:token`          | Get invitation details     |
| POST   | `/:token/accept`   | Accept invite + register   |

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
| Method | Endpoint                | Description                       |
| ------ | ----------------------- | --------------------------------- |
| POST   | `/send`                 | Send EPV email to client          |
| GET    | `/token/:token`         | Get verification by token         |
| PUT    | `/token/:token/submit`  | Submit completed verification     |
| GET    | `/company/:id`          | List verifications for a company  |

---

## Database Tables

Created by `initDb.js` and the scripts in `server/scripts/`:

- **Users** — user accounts (Id, FirstName, LastName, Email, PasswordHash, Role, CreatedAt)
- **ConsolidatedMasterAbattoirDatabase** — client/facility records with extensive contact fields
- **ClientAllocationAuditLog** — change history for client records
- **Invitations** — invitation tokens linking users to client records
- **EggProductionVerifications** — monthly EPV submissions with full calculation data

---

## Key Things for Backend Development

1. **Placeholder pages need API endpoints:** Dashboard, Production, Inventory, and Reports are frontend shells waiting for backend data. Design the tables/endpoints to power these pages.

2. **No auth middleware on routes yet:** The backend routes don't verify the JWT token. Add middleware to protect routes and enforce role-based access.

3. **Frontend expects this API response pattern:**
   ```js
   // Success
   res.json({ message: '...', data: [...], total: N, totalPages: N })
   // Error
   res.status(4xx).json({ message: 'Error description' })
   ```

4. **Frontend reads user from localStorage:**
   ```js
   const user = JSON.parse(localStorage.getItem('user') || '{}');
   // user = { id, firstName, lastName, email, role, clientRecordId }
   ```

5. **All API calls go to `http://localhost:5000`** — hardcoded in each page. Consider centralizing this.

6. **Database uses Windows Authentication** via ODBC — no username/password in the connection string. The developer needs SQL Server running locally with ODBC Driver 18.
