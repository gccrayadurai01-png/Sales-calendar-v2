# Sales Calendar

HubSpot-connected Sales Calendar app: React + Vite frontend, Express + SQLite backend.

## Quick Setup

```bash
# 1. Install all dependencies
npm run install:all

# 2. Ensure backend/.env has your HubSpot token (already included)
# 3. Start both servers
npm run dev
```

- Frontend: http://localhost:5173
- Backend API: http://localhost:3001

## Architecture

- `backend/server.js` — Express API proxy for HubSpot + SQLite DB
- `backend/db/` — DB schema, sync, queries, pipeline velocity
- `backend/.env` — HubSpot Private App token (`HUBSPOT_ACCESS_TOKEN`)
- `frontend/src/App.jsx` — Main app with 4 tabs: Calendar, Deal Flow, Contacts, Pipeline Velocity
- `frontend/src/components/` — All React components
- `frontend/src/hooks/` — Data fetching hooks

## HubSpot Integration

- Private App token (not OAuth)
- Deals: POST /crm/v3/objects/deals/search
- Owners: GET /crm/v3/owners (includes teams[])
- Contacts: POST /crm/v3/objects/contacts/search (syncs mql_type, lead_source, etc.)
- DB syncs on server start, then every 15 minutes

## Key Properties

- Deals: closedate (UTC midnight), dealstage, amount, hubspot_owner_id
- Contacts: mql_type ("Business MQL" / "Personal MQL"), lead_source, createdate, lifecyclestage
- Dates stored as UTC midnight — use UTC methods for parsing

## Tabs

1. **Calendar** — Monthly deal calendar with rep color coding, filters, weekly totals
2. **Deal Flow** — Deal flow analytics
3. **Contacts** — MQL contacts view (defaults to Business MQL), multi-select source filter
4. **Pipeline Velocity** — Stage transition analysis with scoped insights (org/team/rep)
