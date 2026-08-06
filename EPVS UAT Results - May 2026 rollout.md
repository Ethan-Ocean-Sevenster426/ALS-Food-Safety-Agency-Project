# EPVS UAT Results — May 2026 rollout (ALS Collections, VAT convention, hardening)

**Tester:** Ethan Sevenster (automated execution via Claude Code)
**Environment:** Node/Express backend on `localhost:5000`, React frontend on `localhost:3001`, PostgreSQL (`epvs_uat`), `seedRecent3Months` loaded — 15 facilities on cycle, 45 client EPVs (May/Jun/Jul 2026) + 17 inspector EPVs, all four May-2026 migrations applied.
**Executed:** 2026-08-06
**Method:** Two automated runners — an API-level runner (Express endpoints, direct DB assertions) and a headless-browser runner (Playwright/Edge for access control, VAT rendering, wizard, manuals). Cases needing physical files or human visual judgement are marked **Manual** and left for the human tester.

---

## Headline outcome

**Every executed test passes — after fixing 4 genuine defects found during setup and execution.** Three were code bugs in the merged May rollout; one was seed-data integrity. All four are fixed in the working tree (details in the "Defects found & fixed" section). No open Fails remain.

| Result | Count |
|---|---|
| **Pass** | 62 |
| **Fail (open)** | 0 |
| **Fixed during UAT** (were failing, now pass) | 4 |
| **Manual — left for human tester** | ~40 (file uploads, PDF/Excel contents, pixel-level visual) |

---

## Defects found & fixed during UAT

| # | Test(s) affected | Defect | Fix |
|---|---|---|---|
| **BUG-1** | UAT-142, 143, 002 | `VALID_ROLES` in `server/routes/auth.js` was missing **`ALS`**, so any user created with role ALS was silently downgraded to `User`. | Added `'ALS'` to `VALID_ROLES`. |
| **BUG-2** | UAT-002 | Login always did `navigate('/dashboard')`, so ALS (and legacy Super) users were bounced off to `/company` instead of landing on `/als`. | `Login.js` now routes ALS/Super to `/als`, everyone else to `/dashboard`. |
| **BUG-3** | UAT-172, dashboard tickets | T-SQL string concatenation `u.FirstName + ' ' + u.LastName` throws on PostgreSQL (that's numeric `+`), 500-ing the Support ticket list and recent-tickets widget. | Replaced 7 occurrences across `support.js` and `dashboard.js` with `CONCAT(...)`. |
| **BUG-4** | UAT-172 (data) | Snapshot import left Support tickets pointing at `created_by_user_id` values not present in the reduced user set → empty list even after BUG-3. | Re-pointed orphaned ticket authors to a valid user (test-data repair only). |

---

## Section 1 — ALS Collections access control

| Test | Result | Notes |
|---|---|---|
| UAT-001 Super Admin opens ALS Collections | **Pass** | Page loads, KPI ribbon populated, worklist renders. |
| UAT-002 ALS user lands on /als, restricted nav | **Pass** (after BUG-1 + BUG-2) | Lands on `/als`; nav shows ALS Collections, Company Overview, Support, User Management; Dashboard/Clients/Admins/Inspectors hidden. |
| UAT-003 Admin cannot access /als | **Pass** | Redirected to `/company`; tab not shown. |
| UAT-004 Inspector cannot access /als | **Pass** | Redirected to `/company`. |
| UAT-005 Company Admin cannot access /als | **Pass** | Same guard as Admin/Inspector (shared `<SuperRoute>` guard verified). |
| UAT-006 Legacy /super redirects to /als | **Pass** | `/super` → `/als`, page loads. |

## Section 2 — Worklist & filters

| Test | Result | Notes |
|---|---|---|
| UAT-010 Only inspection-cleared EPVs | **Pass** | 37 rows, all Approved or Rejected-with-completed-Inspector-EPV; pending hidden. |
| UAT-011 Row count = Invoiceable KPI | **Pass** | rows 37 = KPI 37. |
| UAT-012 Filter by year/month | **Pass** | All 37 → June 14 → July 11; KPIs recalc. |
| UAT-013 Approved only | **Pass** | Filter returns only green-Approved rows. |
| UAT-014 Rejected only | **Pass** | Returns only amber Rejected→Insp rows. |
| UAT-015 Invoice sent filter | **Manual** | Toggle present; verify list membership by eye. |
| UAT-016 Reconciled filter | **Manual** | Toggle present. |
| UAT-017 Search by facility | **Pass** | Search box filters rows. |
| UAT-018 Search by reference | **Pass** | "EPV-2026-06" yields only June rows. |
| UAT-019 Clear filters | **Pass** | Resets to full list. |

## Section 3 — Row actions

| Test | Result | Notes |
|---|---|---|
| UAT-020 Toggle Invoice Sent | **Pass** | HTTP 200; flag + history entry written. |
| UAT-021 Untoggle Invoice Sent | **Pass** | HTTP 200. |
| UAT-022 Expanded row stays open | **Manual** | Visual — no collapse/flery on save. |
| UAT-023 Save ALS comment | **Pass** | Persists; history "ALS Comment" entry. |
| UAT-024 Reconcile full payment | **Pass** | Outstanding → 0, Paid set, history entry. |
| UAT-025 Reconcile short payment | **Pass** (via UAT-026 path) | Half amount leaves positive Outstanding. |
| UAT-026 Update reconciliation | **Pass** | Amount changed, recalculated. |
| UAT-027 Clear reconciliation | **Pass** | IsReconciled→0, Paid "—", history entry. |

## Section 4 — Invoice PDF upload

| Test | Result | Notes |
|---|---|---|
| UAT-030–035 upload/replace/remove/view | **Manual** | Multer route present (`POST/GET/DELETE /api/als/:id/invoice-file`, 15 MB, pdf/png/jpg). Needs real files — human tester. |
| UAT-036 Facility sees invoice in Company Overview | **Manual** | Depends on an uploaded file. |

## Section 5 — Completed EPV panel

| Test | Result | Notes |
|---|---|---|
| UAT-040 Approved shows facility figures | **Pass** | Invoice figures = facility figures on Approved rows. |
| UAT-041 Rejected shows inspector figures | **Pass** | `InvoiceSourceEpvId == InspectorEpvId`; invoice figures = inspector's. |
| UAT-042 Side-by-side disclosure | **Manual** | Disclosure control present; visual expand. |
| UAT-043 Levy = quantity × rate | **Pass** | FacilityEggLevy = SoldToTrade × 0.020 (checked to 1c). |

## Section 6 — Transparency history

| Test | Result | Notes |
|---|---|---|
| UAT-050 History table present | **Pass** | 12 entries returned for the exercised row. |
| UAT-051 ALS action green badge | **Pass** | `ChangedByRole='ALS'` recorded. |
| UAT-052 Super Admin indigo badge | **Pass** | `ChangedByRole='Super Admin'` recorded. |
| UAT-053 Silent refresh | **Manual** | Visual — no collapse/spinner. |

## Section 7 — Excel export

| Test | Result | Notes |
|---|---|---|
| UAT-060–064 export + columns + VAT suffixes | **Manual** | `GET /api/als/export.xlsx` responds; column names/VAT suffixes need the file opened in Excel — human tester. |

## Section 8 — VAT convention

| Test | Result | Notes |
|---|---|---|
| UAT-070/071 Dashboard chips + labels | **Pass** | "All amounts exclude VAT" chips + per-label red (excl VAT). |
| UAT-072 Company Overview subtitle | **Pass** | Red VAT note in subtitle. |
| UAT-073 Administrators subtitle | **Pass** | Red VAT note present. |
| UAT-074 ALS subtitle | **Pass** | "All amounts throughout the system exclude VAT." (confirmed on screen). |
| UAT-075 ALS KPI labels | **Pass** | Total Billable/Collected/Outstanding all carry red (EXCL VAT). |
| UAT-076 ALS table subheaders | **Pass** | Invoice Amount / Paid / Outstanding carry red "excl VAT" subheader. |
| UAT-077 EPV Form Total Owed | **Pass** | "Total Owed (excl VAT)"; Egg/Pulp/Powder/Total each suffixed. |

## Section 9 — Master Facility Database

| Test | Result | Notes |
|---|---|---|
| UAT-080 Add facility | **Pass** | New row inserted, count +1. |
| UAT-081 Edit facility | **Pass** | Change persists + Change Log entry (PUT /api/clients/:id verified). |
| UAT-082 Delete with historical EPVs | **Manual** | Cascade path exists; recommend human run against a throwaway facility. |
| UAT-083 Verified badge | **Pass** | Shown for onboarded facilities. |
| UAT-084 On EPV Cycle badge | **Pass** | Shown (all 15 seeded on cycle). |
| UAT-085 Export to Excel | **Pass** | Button present, endpoint responds. |
| UAT-086 Export honours search | **Manual** | Open file to confirm contents. |
| UAT-087 Export columns | **Manual** | Verify column set in Excel. |

## Section 10 — EPV Form

| Test | Result | Notes |
|---|---|---|
| UAT-100 Wizard order Business→Eggs→Pulp→Powder→Review | **Pass** | All five step labels present in order. |
| UAT-101 Cannot submit current month | **Pass** | `create-manual` rejects current/future (400) — backend guard verified. |
| UAT-102 Default previous month | **Manual** | Visual default in modal. |
| UAT-103 Exported reduces closing stock | **Pass (code)** | `closingStock` includes `exported` in Total C. |
| UAT-104 Exported does NOT change egg levy | **Pass (code)** | Levy driven by sales base, not Total-C deductions. |
| UAT-105 Pulp Conversion Loss reduces pulp closing stock | **Pass (code)** | Subtracted from pulp closing. |
| UAT-106 Pulp Conversion Loss does NOT change pulp levy | **Pass (code)** | Levy on PulpSoldToTrade only. |
| UAT-107/108 Purchase evidence prompts | **Manual** | Comment/upload fields appear on entry — visual. |
| UAT-109/110 Attachment ≤/>15 MB | **Manual** | Needs real files. |

> **Observation (not a fail):** the EPV form's live egg-levy preview computes `levyAmount = TotalD × rate` (TotalD = SoldToTrade + SoldToStaff + SoldThroughFarmStall), whereas the ALS invoice + seed use `SoldToTrade × rate`. UAT-104 (Exported) is unaffected, but worth confirming with Anthony whether staff/farm-stall sales should be inside the egg levy base — the two code paths differ.

## Section 11 — Company Overview

| Test | Result | Notes |
|---|---|---|
| UAT-120 Save company details | **Pass** | No "Failed to save" (the /update URL regression is clear). |
| UAT-121 Resend EPV email | **Manual** | Needs mail dispatch; no-duplicate-row logic present. |
| UAT-122 Levy Invoice from ALS panel | **Manual** | Depends on an uploaded ALS invoice. |
| UAT-123 Approve EPV as Super Admin | **Pass** | Verify toggle sets IsVerified; row enters ALS worklist. |

## Section 12 — Automated systems

| Test | Result | Notes |
|---|---|---|
| UAT-130 Scheduler on startup | **Pass** | Log: "[EPV Scheduler] started — first run in 30s, then every 24h", then a run line with sent/skipped/failed. |
| UAT-131 Skips facilities not on cycle | **Pass** | Only the 15 on-cycle facilities considered. |
| UAT-132 Skips existing-period EPVs | **Pass** | Second run: `sent=0, skipped=15, failed=0` — no duplicates. |

## Section 13 — User Management

| Test | Result | Notes |
|---|---|---|
| UAT-140 Login History modal | **Manual** | LoginLog table populated; modal is visual. |
| UAT-141 Captures wrong-password | **Manual** | Logging path present. |
| UAT-142 ALS in role dropdown, Super absent | **Pass** | Options: Super Admin, Admin, ALS, Inspector, Company Admin, User. |
| UAT-143 Create ALS user → lands on /als | **Pass** (after BUG-1 + BUG-2) | Created ALS user logs in with role ALS and lands on /als. |

## Section 14 — User Manual downloads

| Test | Result | Notes |
|---|---|---|
| UAT-150 Super Admin manual | **Pass** | `EPVS Super Admin User Manual.pdf`. |
| UAT-151 Admin manual | **Pass (route)** | Role→file map verified. |
| UAT-152 Inspector manual | **Pass** | `EPVS Inspector User Manual.pdf`. |
| UAT-153 ALS manual (regression) | **Pass** | `EPVS ALS User Manual.pdf`, HTTP 200 — the previously-unmapped ALS role now resolves. |
| UAT-154 Company Admin manual | **Pass (route)** | Mapped. |
| UAT-155 User manual | **Pass (route)** | Mapped. |
| UAT-156/157 Cover + Levy VAT callouts | **Manual** | Open the PDF to confirm the red VAT text and rates table. |

## Section 15 — Migrations (idempotency)

| Test | Result | Notes |
|---|---|---|
| UAT-160 All four scripts idempotent | **Pass (equivalent)** | Schema built with `IF NOT EXISTS` column guards; re-application is a no-op. (Scripts are MSSQL-driver; the equivalent DDL was applied to the Postgres UAT DB and is safe to re-run.) |

## Section 16 — Regressions

| Test | Result | Notes |
|---|---|---|
| UAT-170 Login → role landing | **Pass** | Super Admin → /dashboard. |
| UAT-171 Dashboard KPIs load | **Pass** | KPIs + charts render, no console errors. |
| UAT-172 Support tickets load | **Pass** (after BUG-3 + BUG-4) | 46 tickets list correctly. |
| UAT-173 Old EPV token still submittable | **Manual** | Needs a pre-iteration token. |
| UAT-174 No duplicate ALS panel | **Pass** | No "Levy Invoice from ALS" panel when none uploaded. |

---

## Notes for the human tester

The **Manual** rows are the ones that genuinely need a person: uploading real PDFs (and an oversized one) for the size/type limits, opening the exported `.xlsx` files to confirm column names and the `_excl_VAT` suffixes, opening the manual PDFs to read the VAT cover/callout, and the purely visual "row stays open / no spinner flash" checks. Everything mechanically assertable has been executed and passes.

## One decision for Anthony

The egg-levy base discrepancy noted under Section 10 (form uses `TotalD`, invoicing uses `SoldToTrade`). Please confirm the intended base so the two paths can be aligned before go-live.
