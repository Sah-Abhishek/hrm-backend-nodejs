# Backend API Test Report

**Date:** 2025-12-21T01:49:39.075Z
**Base URL:** http://localhost:9002

## Summary
- **Total Tests:** 7
- **Passed:** 4
- **Failed:** 3

## Detailed Results

| Test Name | Method | Endpoint | Status | Time | Result |
|-----------|--------|----------|--------|------|--------|
| Health Check | GET | /health | 200 | 159ms | ✅ |
| Register User | POST | /api/auth/register | 201 | 1423ms | ✅ |
| Get Profile | GET | /api/auth/me | 200 | 107ms | ✅ |
| List Employees | GET | /api/employees | 403 | 45ms | ❌ |
| List Leaves | GET | /api/leaves | 404 | 8ms | ❌ |
| Dashboard Stats | GET | /api/dashboard/stats | 200 | 122ms | ✅ |
| Notifications | GET | /api/notifications | 404 | 5ms | ❌ |

## Response Details

### ❌ List Employees
**Endpoint:** `GET /api/employees`
**Status:** 403
**Error/Response:**
```json
{
  "detail": "Not enough permissions"
}
```

### ❌ List Leaves
**Endpoint:** `GET /api/leaves`
**Status:** 404
**Error/Response:**
```json
{
  "detail": "Not found"
}
```

### ❌ Notifications
**Endpoint:** `GET /api/notifications`
**Status:** 404
**Error/Response:**
```json
{
  "detail": "Not found"
}
```

