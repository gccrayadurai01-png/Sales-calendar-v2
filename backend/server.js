const path = require('path');
const crypto = require('crypto');
const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');
require('dotenv').config({ path: path.join(__dirname, '.env') });

const { getDb } = require('./db');
const { syncAll } = require('./db/sync');
const {
  getOwners, getStages, getDealsByCloseDate, getDealsByCreateDate,
  getContactsByCreateDate, getSyncStatus,
} = require('./db/queries');
const { getPipelineVelocity } = require('./db/pipelineVelocity');
const { REP_GOALS, GOALS_TEAMS, getWeekRanges, getMonthRanges, deriveWeeklyGoals, deriveMonthlyGoals } = require('./goals-config');

const app = express();
app.use(cors({ origin: true, credentials: true }));
app.use(cookieParser());
app.use(express.json());

const TOKEN = process.env.HUBSPOT_ACCESS_TOKEN;

if (!TOKEN) {
  console.warn('\n\u26a0\ufe0f  WARNING: HUBSPOT_ACCESS_TOKEN is not set in backend/.env');
  console.warn('   Create backend/.env with your token. See .env.example for instructions.\n');
}

// Initialize database
const db = getDb();

// Track if a sync is currently in progress
let syncInProgress = false;

// ──────── Auth (hardcoded demo — change via env in production) ────────
const AUTH_COOKIE = 'sc_session';
const AUTH_USER = process.env.AUTH_USERNAME || 'admin';
const AUTH_PASS = process.env.AUTH_PASSWORD || 'admin@123';

function authToken() {
  const secret = process.env.AUTH_SECRET || 'sales-calendar-auth-dev';
  return crypto.createHmac('sha256', secret).update('sales-calendar-session-v1').digest('hex');
}

function isAuthenticated(req) {
  const v = req.cookies && req.cookies[AUTH_COOKIE];
  if (!v || typeof v !== 'string') return false;
  const t = authToken();
  try {
    return v.length === t.length && crypto.timingSafeEqual(Buffer.from(v), Buffer.from(t));
  } catch {
    return false;
  }
}

app.post('/api/auth/login', (req, res) => {
  const { username, password } = req.body || {};
  if (username === AUTH_USER && password === AUTH_PASS) {
    res.cookie(AUTH_COOKIE, authToken(), {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      maxAge: 7 * 24 * 60 * 60 * 1000,
    });
    return res.json({ ok: true });
  }
  return res.status(401).json({ ok: false, error: 'Invalid credentials' });
});

app.post('/api/auth/logout', (req, res) => {
  res.clearCookie(AUTH_COOKIE, { path: '/' });
  res.json({ ok: true });
});

app.get('/api/auth/me', (req, res) => {
  res.json({ authenticated: isAuthenticated(req) });
});

app.use((req, res, next) => {
  if (req.method === 'OPTIONS') return next();
  if (!req.path.startsWith('/api')) return next();
  if (
    req.path === '/api/health' ||
    req.path === '/api/auth/login' ||
    req.path === '/api/auth/logout' ||
    req.path === '/api/auth/me'
  ) {
    return next();
  }
  if (!isAuthenticated(req)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
});

// ──────── API Endpoints (all served from SQLite) ────────

// GET /api/deals?startDate=YYYY-MM-DD&endDate=YYYY-MM-DD
app.get('/api/deals', (req, res) => {
  const { startDate, endDate } = req.query;
  if (!startDate || !endDate) {
    return res.status(400).json({ error: 'startDate and endDate query params are required' });
  }
  try {
    const deals = getDealsByCloseDate(db, startDate, endDate);
    res.json(deals);
  } catch (err) {
    console.error('DB deals error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/owners
app.get('/api/owners', (req, res) => {
  try {
    res.json(getOwners(db));
  } catch (err) {
    console.error('DB owners error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/deals/created?startDate=YYYY-MM-DD&endDate=YYYY-MM-DD
app.get('/api/deals/created', (req, res) => {
  const { startDate, endDate } = req.query;
  if (!startDate || !endDate) {
    return res.status(400).json({ error: 'startDate and endDate query params are required' });
  }
  try {
    const deals = getDealsByCreateDate(db, startDate, endDate);
    res.json(deals);
  } catch (err) {
    console.error('DB deals/created error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/stages
app.get('/api/stages', (req, res) => {
  try {
    const stages = getStages(db);
    stages.sort((a, b) => a.displayOrder - b.displayOrder);
    res.json(stages);
  } catch (err) {
    console.error('DB stages error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/contacts/created?startDate=YYYY-MM-DD&endDate=YYYY-MM-DD
// startDate/endDate are optional — omit both for all-time
app.get('/api/contacts/created', (req, res) => {
  const { startDate, endDate } = req.query;
  try {
    const contacts = getContactsByCreateDate(db, startDate || null, endDate || null);
    res.json(contacts);
  } catch (err) {
    console.error('DB contacts/created error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ──────── Agent Endpoints ────────

// GET /api/pipeline-velocity
app.get('/api/pipeline-velocity', (req, res) => {
  try {
    res.json(getPipelineVelocity(db));
  } catch (err) {
    console.error('Pipeline velocity error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ──────── Goals Tracker ────────

// GET /api/goals-tracker?view=weekly|monthly
app.get('/api/goals-tracker', (req, res) => {
  try {
    const view = req.query.view || 'weekly';
    const periods = view === 'monthly' ? getMonthRanges(6) : getWeekRanges(16);

    // Get owners and build firstName → ownerId map
    const owners = getOwners(db);
    const ownerByFirstName = {};
    for (const o of owners) {
      const first = (o.firstName || '').trim();
      if (first) ownerByFirstName[first] = o;
    }
    // Special case: Yogi → Yogesh
    if (ownerByFirstName['Yogesh'] && !ownerByFirstName['Yogi']) {
      ownerByFirstName['Yogi'] = ownerByFirstName['Yogesh'];
    }

    // Get closed-won stage IDs (probability = 1)
    const allStages = getStages(db);
    const closedWonStageIds = new Set(
      allStages.filter((s) => parseFloat(s.probability) === 1).map((s) => s.id)
    );
    // Closed-lost stage IDs (probability = 0)
    const closedLostStageIds = new Set(
      allStages.filter((s) => parseFloat(s.probability) === 0).map((s) => s.id)
    );

    const results = [];

    for (const [repName, goals] of Object.entries(REP_GOALS)) {
      const owner = ownerByFirstName[repName];
      if (!owner) continue;

      const ownerId = owner.id;
      const fullName = `${owner.firstName || ''} ${owner.lastName || ''}`.trim();

      const periodActuals = periods.map((period) => {
        const startISO = new Date(period.start).toISOString();
        const endISO = new Date(period.end + 'T23:59:59.999Z').toISOString();

        // Closed-won deals in this period (by closedate)
        const wonDeals = db.prepare(`
          SELECT amount, dealstage FROM deals
          WHERE hubspot_owner_id = ? AND closedate >= ? AND closedate <= ?
        `).all(ownerId, startISO, endISO);

        const closedWon = wonDeals.filter((d) => closedWonStageIds.has(d.dealstage));
        const revenue = closedWon.reduce((sum, d) => sum + (d.amount || 0), 0);
        const deals = closedWon.length;

        // Pipeline deals created in this period — only active sales stages
        const pipelineStageLabels = ['sql', 'demo', 'trial', 'quote sent', 'signature'];
        const pipelineStageIds = allStages
          .filter((s) => pipelineStageLabels.includes(s.label.toLowerCase()))
          .map((s) => s.id);
        const pipelineDeals = db.prepare(`
          SELECT amount FROM deals
          WHERE hubspot_owner_id = ? AND archived = 0
            AND dealstage IN (${pipelineStageIds.map(() => '?').join(',')})
            AND createdate >= ? AND createdate <= ?
        `).all(ownerId, ...pipelineStageIds, startISO, endISO);

        const pipeline = pipelineDeals.reduce((sum, d) => sum + (d.amount || 0), 0);
        const opps = pipelineDeals.length;

        // MQLs created in this period owned by this rep
        const mqls = db.prepare(`
          SELECT COUNT(*) as count FROM contacts
          WHERE hubspot_owner_id = ? AND createdate >= ? AND createdate <= ?
            AND (mql_type IS NOT NULL OR lifecyclestage = 'marketingqualifiedlead')
        `).all(ownerId, startISO, endISO)[0].count;

        // Derive goals for this period
        const periodGoals = view === 'monthly'
          ? deriveMonthlyGoals(goals)
          : deriveWeeklyGoals(goals);

        return {
          ...period,
          actuals: { revenue, deals, pipeline, opps, mqls },
          goals: periodGoals,
        };
      });

      results.push({
        repName,
        fullName,
        ownerId,
        team: goals.team,
        avgDealValue: goals.avgDealValue,
        periods: periodActuals,
      });
    }

    res.json({ view, teams: GOALS_TEAMS, results });
  } catch (err) {
    console.error('Goals tracker error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/goals-tracker/details?ownerId=X&metric=revenue|pipeline|mqls&startDate=&endDate=
app.get('/api/goals-tracker/details', (req, res) => {
  try {
    const { ownerId, metric, startDate, endDate } = req.query;
    if (!ownerId) return res.status(400).json({ error: 'ownerId is required' });
    if (!metric) return res.status(400).json({ error: 'metric is required' });

    const startISO = startDate ? new Date(startDate).toISOString() : null;
    const endISO = endDate ? new Date(endDate + 'T23:59:59.999Z').toISOString() : null;

    const allStages = getStages(db);

    if (metric === 'revenue' || metric === 'deals') {
      // Closed-won deals by closedate
      const closedWonStageIds = allStages
        .filter((s) => parseFloat(s.probability) === 1)
        .map((s) => s.id);
      if (closedWonStageIds.length === 0) return res.json({ type: 'deals', items: [] });

      const dateFilter = startISO && endISO ? 'AND closedate >= ? AND closedate <= ?' : '';
      const params = [ownerId, ...closedWonStageIds, ...(startISO && endISO ? [startISO, endISO] : [])];
      const deals = db.prepare(`
        SELECT id, dealname, amount, dealstage, createdate, closedate FROM deals
        WHERE hubspot_owner_id = ? AND dealstage IN (${closedWonStageIds.map(() => '?').join(',')})
          ${dateFilter}
        ORDER BY closedate DESC, amount DESC
      `).all(...params);

      return res.json({
        type: 'deals',
        label: 'Closed Won Deals',
        items: deals.map((d) => ({
          id: d.id,
          dealname: d.dealname,
          amount: d.amount,
          createdate: d.createdate,
          closedate: d.closedate,
        })),
      });
    }

    if (metric === 'pipeline' || metric === 'opps') {
      // Pipeline deals created in period
      const pipelineStageLabels = ['sql', 'demo', 'trial', 'quote sent', 'signature'];
      const pipelineStages = allStages.filter((s) => pipelineStageLabels.includes(s.label.toLowerCase()));
      const pipelineStageIds = pipelineStages.map((s) => s.id);
      const stageMap = Object.fromEntries(pipelineStages.map((s) => [s.id, s.label]));

      if (pipelineStageIds.length === 0) return res.json({ type: 'deals', items: [] });

      const dateFilter = startISO && endISO ? 'AND createdate >= ? AND createdate <= ?' : '';
      const params = [ownerId, ...pipelineStageIds, ...(startISO && endISO ? [startISO, endISO] : [])];
      const deals = db.prepare(`
        SELECT id, dealname, amount, dealstage, createdate, closedate FROM deals
        WHERE hubspot_owner_id = ? AND archived = 0
          AND dealstage IN (${pipelineStageIds.map(() => '?').join(',')})
          ${dateFilter}
        ORDER BY amount DESC
      `).all(...params);

      return res.json({
        type: 'deals',
        label: 'Pipeline Deals',
        grouped: true,
        items: deals.map((d) => ({
          id: d.id,
          dealname: d.dealname,
          amount: d.amount,
          stage: stageMap[d.dealstage] || d.dealstage,
          createdate: d.createdate,
          closedate: d.closedate,
        })),
      });
    }

    if (metric === 'mqls') {
      // MQL contacts created in period
      const dateFilter = startISO && endISO ? 'AND createdate >= ? AND createdate <= ?' : '';
      const params = [ownerId, ...(startISO && endISO ? [startISO, endISO] : [])];
      const contacts = db.prepare(`
        SELECT id, email, firstname, lastname, mql_type, lead_source, createdate, lifecyclestage FROM contacts
        WHERE hubspot_owner_id = ?
          AND (mql_type IS NOT NULL OR lifecyclestage = 'marketingqualifiedlead')
          ${dateFilter}
        ORDER BY createdate DESC
      `).all(...params);

      return res.json({
        type: 'contacts',
        label: 'MQL Contacts',
        items: contacts.map((c) => ({
          id: c.id,
          name: [c.firstname, c.lastname].filter(Boolean).join(' ') || c.email || 'Unknown',
          email: c.email,
          mqlType: c.mql_type,
          leadSource: c.lead_source,
          createdate: c.createdate,
          lifecyclestage: c.lifecyclestage,
        })),
      });
    }

    res.status(400).json({ error: `Unknown metric: ${metric}` });
  } catch (err) {
    console.error('Goals details error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/goals-tracker/pipeline-deals?ownerId=X&startDate=YYYY-MM-DD&endDate=YYYY-MM-DD (legacy)
app.get('/api/goals-tracker/pipeline-deals', (req, res) => {
  try {
    const { ownerId, startDate, endDate } = req.query;
    if (!ownerId) return res.status(400).json({ error: 'ownerId is required' });

    const allStages = getStages(db);
    const pipelineStageLabels = ['sql', 'demo', 'trial', 'quote sent', 'signature'];
    const pipelineStages = allStages.filter((s) => pipelineStageLabels.includes(s.label.toLowerCase()));
    const pipelineStageIds = pipelineStages.map((s) => s.id);
    const stageMap = Object.fromEntries(pipelineStages.map((s) => [s.id, s.label]));

    if (pipelineStageIds.length === 0) return res.json([]);

    let deals;
    if (startDate && endDate) {
      const startISO = new Date(startDate).toISOString();
      const endISO = new Date(endDate + 'T23:59:59.999Z').toISOString();
      deals = db.prepare(`
        SELECT id, dealname, amount, dealstage, createdate, closedate FROM deals
        WHERE hubspot_owner_id = ? AND archived = 0
          AND dealstage IN (${pipelineStageIds.map(() => '?').join(',')})
          AND createdate >= ? AND createdate <= ?
        ORDER BY amount DESC
      `).all(ownerId, ...pipelineStageIds, startISO, endISO);
    } else {
      deals = db.prepare(`
        SELECT id, dealname, amount, dealstage, createdate, closedate FROM deals
        WHERE hubspot_owner_id = ? AND archived = 0
          AND dealstage IN (${pipelineStageIds.map(() => '?').join(',')})
        ORDER BY amount DESC
      `).all(ownerId, ...pipelineStageIds);
    }

    res.json(deals.map((d) => ({
      id: d.id,
      dealname: d.dealname,
      amount: d.amount,
      stage: stageMap[d.dealstage] || d.dealstage,
      createdate: d.createdate,
      closedate: d.closedate,
    })));
  } catch (err) {
    console.error('Pipeline deals error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ──────── Sync Endpoints ────────

// POST /api/sync — trigger a full sync from HubSpot
app.post('/api/sync', (req, res) => {
  if (!TOKEN) {
    return res.status(500).json({ error: 'HUBSPOT_ACCESS_TOKEN not configured' });
  }
  if (syncInProgress) {
    return res.json({ status: 'already_running' });
  }

  syncInProgress = true;
  res.json({ status: 'started' });

  // Run sync in background
  syncAll(db, TOKEN)
    .finally(() => { syncInProgress = false; });
});

// GET /api/sync/status
app.get('/api/sync/status', (req, res) => {
  try {
    const meta = getSyncStatus(db);
    res.json({
      lastSyncAt: meta?.last_sync_completed_at || null,
      status: syncInProgress ? 'running' : (meta?.last_sync_status || 'never'),
      error: meta?.last_sync_error || null,
      counts: {
        deals: meta?.deals_count || 0,
        contacts: meta?.contacts_count || 0,
        owners: meta?.owners_count || 0,
        stages: meta?.stages_count || 0,
      },
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Health check
app.get('/api/health', (req, res) => {
  const meta = getSyncStatus(db);
  res.json({
    status: 'ok',
    tokenConfigured: !!TOKEN,
    dbReady: true,
    lastSync: meta?.last_sync_completed_at || 'never',
    syncStatus: meta?.last_sync_status || 'never',
  });
});

// Production: serve Vite app from same origin as /api (relative fetch paths)
const distPath = path.join(__dirname, '..', 'frontend', 'dist');
if (process.env.NODE_ENV === 'production') {
  app.use(express.static(distPath));
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api')) return next();
    res.sendFile(path.join(distPath, 'index.html'));
  });
}

// ──────── Start Server ────────

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`\n\u2705 Sales Calendar backend running on http://localhost:${PORT}`);
  console.log(`   HubSpot token: ${TOKEN ? '\u2713 configured' : '\u2717 MISSING \u2014 add to backend/.env'}`);
  console.log(`   Database: \u2713 SQLite ready\n`);

  // Auto-sync on startup if DB is empty (never synced)
  const meta = getSyncStatus(db);
  if (!meta?.last_sync_completed_at && TOKEN) {
    console.log('   No previous sync found \u2014 starting initial sync...');
    syncInProgress = true;
    syncAll(db, TOKEN).finally(() => { syncInProgress = false; });
  } else if (meta?.last_sync_completed_at) {
    console.log(`   Last sync: ${meta.last_sync_completed_at}`);
    console.log(`   Cached: ${meta.deals_count} deals, ${meta.contacts_count} contacts, ${meta.owners_count} owners\n`);
  }
});
