# Service 2 Integration Handover (Service 1 Pull API)

This document is the implementation contract for Service 2 to pull transaction data from Service 1 (FinTrack).

## Scope

- Service 1 provides data API only.
- Service 2 is responsible for pulling, storing cursor, processing analysis, and forwarding to Service 3.
- This contract does not require Service 2 to call Service 1 user-auth endpoints.

## Endpoint

- Method: `GET`
- URL: `/api/service2/users/{userId}/transactions-feed`
- Example: `http://127.0.0.1:8000/api/service2/users/2/transactions-feed`

## Authentication

- Header required: `x-api-key: <SERVICE2_PULL_API_KEY>`
- Current local key (dev): `fintrack123`

## Query Parameters

- `since` (optional): ISO-8601 datetime for delta sync.
    - Accepted format example: `2026-04-13T07:48:43+00:00`
- `include_summary` (optional): `1` or `0`
    - Default: `1`

## Sync Modes

- Snapshot sync: request without `since`
- Delta sync: request with `since`

## Response Contract

### Success Response

```json
{
    "success": true,
    "message": "Transactions feed fetched successfully.",
    "data": {
        "transactions": [
            {
                "id": 11,
                "user_id": 2,
                "amount": 1000000,
                "description": "uang gaji bulan ini",
                "category": "gaji",
                "type": "income",
                "transaction_date": "2026-04-13",
                "created_at": "2026-04-13T06:43:20+00:00",
                "updated_at": "2026-04-13T06:43:20+00:00"
            }
        ],
        "summary": {
            "total_income": 6000000,
            "total_expense": 2525000,
            "net_balance": 3475000,
            "breakdown_category": {
                "gaji": {
                    "count": 1,
                    "total_amount": 1000000
                }
            }
        }
    },
    "meta": {
        "user_id": 2,
        "requested_at": "2026-04-13T07:48:43+00:00",
        "sync_mode": "snapshot",
        "since": null,
        "next_since": "2026-04-13T06:46:19+00:00",
        "total_items": 5,
        "max_items": 1000,
        "has_more": false
    }
}
```

### Error Response Matrix

- `400` invalid request params (`since` malformed, etc.)
- `401` invalid `x-api-key`
- `404` user not found
- `500` server-side config/runtime error

## Required Service 2 Behavior

1. Initial pull per user without `since`.
2. Save `meta.next_since` per user after successful response.
3. Next pull uses `since=<saved next_since>`.
4. If `meta.has_more=true`, immediately continue pulling until `has_more=false`.
5. Upsert transactions by `id` (do not duplicate).
6. Continue analysis pipeline and push analysis result to Service 3.
7. Apply retry/backoff for `5xx` and network failures.

## Minimal Retry Guidance

- Network/timeout/5xx: retry with exponential backoff (1s, 2s, 4s, max 3-5 attempts)
- 401: stop and alert (configuration issue)
- 400: stop and log request bug
- 404: skip user and continue other users

## What Service 1 Must Share to Service 2 Team

1. Base URL per environment (dev/staging/prod)
2. `SERVICE2_PULL_API_KEY` per environment
3. User list or user mapping strategy
4. Polling interval target (for realtime)
5. Contract doc + Postman collection in this folder

## Quick Curl Examples

### Snapshot

```bash
curl -X GET "http://127.0.0.1:8000/api/service2/users/2/transactions-feed" \
  -H "x-api-key: fintrack123" \
  -H "Accept: application/json"
```

### Delta

```bash
curl -X GET "http://127.0.0.1:8000/api/service2/users/2/transactions-feed?since=2026-04-13T07:48:43%2B00:00" \
  -H "x-api-key: fintrack123" \
  -H "Accept: application/json"
```

### Without Summary

```bash
curl -X GET "http://127.0.0.1:8000/api/service2/users/2/transactions-feed?include_summary=0" \
  -H "x-api-key: fintrack123" \
  -H "Accept: application/json"
```
