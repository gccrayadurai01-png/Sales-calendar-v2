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
  console.warn('\n⚠️  WARNING: HUBSPOT_ACCESS_TOKEN is not set');
}

let syncInProgress = false;

// ──────── Auth ────────
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
  if (['/api/health', '/api/auth/login', '/api/auth/logout', '/api/auth/me'].includes(req.path)) {
    return next();
  }
  if (!isAuthenticated(req)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
});

// ──────── API Endpoints ────────

app.get('/api/deals', async (req, res) => {
  const { startDate, endDate } = req.query;
  if (!startDate || !endDate) return res.status(400).json({ error: 'startDate and endDate are required' });
  try {
    const db = await getDb();
    res.json(await getDealsByCloseDate(db, startDate, endDate));
  } catch (err) {
    console.error('DB deals error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/owners', async (req, res) => {
  try {
    const db = await getDb();
    res.json(await getOwners(db));
  } catch (err) {
    console.error('DB owners error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/deals/created', async (req, res) => {
  const { startDate, endDate } = req.query;
  if (!startDate || !endDate) return res.status(400).json({ error: 'startDate and endDate are required' });
  try {
    const db = await getDb();
    res.json(await getDealsByCreateDate(db, startDate, endDate));
  } catch (err) {
    console.error('DB deals/created error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/stages', async (req, res) => {
  try {
    const db = await getDb();
    const stages = await getStages(db);
    stages.sort((a, b) => Number(a.displayOrder) - Number(b.displayOrder));
    res.json(stages);
  } catch (err) {
    console.error('DB stages error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/contacts/created', async (req, res) => {
  const { startDate, endDate } = req.query;
  try {
    const db = await getDb();
    res.json(await getContactsByCreateDate(db, startDate || null, endDate || null));
  } catch (err) {
    console.error('DB contacts/created error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/pipeline-velocity', async (req, res) => {
  try {
    const db = await getDb();
    res.json(await getPipelineVelocity(db));
  } catch (err) {
    console.error('Pipeline velocity error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ──────── Goals Tracker ────────

app.get('/api/goals-tracker', async (req, res) => {
  try {
    const db = await getDb();
    const view = req.query.view || 'weekly';
    const periods = view === 'monthly' ? getMonthRanges(6) : getWeekRanges(16);

    const owners = await getOwners(db);
    const ownerByFirstName = {};
    for (const o of owners) {
      const first = (o.firstName || '').trim();
      if (first) ownerByFirstName[first] = o;
    }
    if (ownerByFirstName['Yogesh'] && !ownerByFirstName['Yogi']) {
      ownerByFirstName['Yogi'] = ownerByFirstName['Yogesh'];
    }

    const allStages = await getStages(db);
    const closedWonStageIds = new Set(
      allStages.filter((s) => parseFloat(s.probability) === 1).map((s) => s.id)
    );

    const pipelineStageLabels = ['sql', 'demo', 'trial', 'quote sent', 'signature'];
    const pipelineStageIds = allStages
      .filter((s) => pipelineStageLabels.includes(String(s.label).toLowerCase()))
      .map((s) => s.id);

    const results = [];

    for (const [repName, goals] of Object.entries(REP_GOALS)) {
      const owner = ownerByFirstName[repName];
      if (!owner) continue;

      const ownerId = owner.id;
      const fullName = `${owner.firstName || ''} ${owner.lastName || ''}`.trim();

      const periodActuals = await Promise.all(periods.map(async (period) => {
        const startISO = new Date(period.start).toISOString();
        const endISO = new Date(period.end + 'T23:59:59.999Z').toISOString();

        const wonResult = await db.execute({
          sql: `SELECT amount, dealstage FROM deals WHERE hubspot_owner_id = ? AND closedate >= ? AND closedate <= ?`,
          args: [ownerId, startISO, endISO],
        });
        const wonDeals = wonResult.rows;
        const closedWon = wonDeals.filter((d) => closedWonStageIds.has(d.dealstage));
        const revenue = closedWon.reduce((sum, d) => sum + (Number(d.amount) || 0), 0);
        const deals = closedWon.length;

        let pipeline = 0;
        let opps = 0;
        if (pipelineStageIds.length > 0) {
          const ph = pipelineStageIds.map(() => '?').join(',');
          const pipelineResult = await db.execute({
            sql: `SELECT amount FROM deals WHERE hubspot_owner_id = ? AND archived = 0 AND dealstage IN (${ph}) AND createdate >= ? AND createdate <= ?`,
            args: [ownerId, ...pipelineStageIds, startISO, endISO],
          });
          pipeline = pipelineResult.rows.reduce((sum, d) => sum + (Number(d.amount) || 0), 0);
          opps = pipelineResult.rows.length;
        }

        const mqlsResult = await db.execute({
          sql: `SELECT COUNT(*) as count FROM contacts WHERE hubspot_owner_id = ? AND createdate >= ? AND createdate <= ? AND (mql_type IS NOT NULL OR lifecyclestage = 'marketingqualifiedlead')`,
          args: [ownerId, startISO, endISO],
        });
        const mqls = Number(mqlsResult.rows[0].count);

        const periodGoals = view === 'monthly' ? deriveMonthlyGoals(goals) : deriveWeeklyGoals(goals);
        return { ...period, actuals: { revenue, deals, pipeline, opps, mqls }, goals: periodGoals };
      }));

      results.push({ repName, fullName, ownerId, team: goals.team, avgDealValue: goals.avgDealValue, periods: periodActuals });
    }

    res.json({ view, teams: GOALS_TEAMS, results });
  } catch (err) {
    console.error('Goals tracker error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/goals-tracker/details', async (req, res) => {
  try {
    const db = await getDb();
    const { ownerId, metric, startDate, endDate } = req.query;
    if (!ownerId) return res.status(400).json({ error: 'ownerId is required' });
    if (!metric) return res.status(400).json({ error: 'metric is required' });

    const startISO = startDate ? new Date(startDate).toISOString() : null;
    const endISO = endDate ? new Date(endDate + 'T23:59:59.999Z').toISOString() : null;
    const allStages = await getStages(db);
    const dateFilter = startISO && endISO ? 'AND closedate >= ? AND closedate <= ?' : '';

    if (metric === 'revenue' || metric === 'deals') {
      const closedWonStageIds = allStages.filter((s) => parseFloat(s.probability) === 1).map((s) => s.id);
      if (closedWonStageIds.length === 0) return res.json({ type: 'deals', items: [] });
      const ph = closedWonStageIds.map(() => '?').join(',');
      const args = [ownerId, ...closedWonStageIds, ...(startISO && endISO ? [startISO, endISO] : [])];
      const result = await db.execute({
        sql: `SELECT id, dealname, amount, dealstage, createdate, closedate FROM deals WHERE hubspot_owner_id = ? AND dealstage IN (${ph}) ${dateFilter} ORDER BY closedate DESC, amount DESC`,
        args,
      });
      return res.json({ type: 'deals', label: 'Closed Won Deals', items: result.rows.map((d) => ({ id: d.id, dealname: d.dealname, amount: d.amount, createdate: d.createdate, closedate: d.closedate })) });
    }

    if (metric === 'pipeline' || metric === 'opps') {
      const pipelineStageLabels = ['sql', 'demo', 'trial', 'quote sent', 'signature'];
      const pipelineStages = allStages.filter((s) => pipelineStageLabels.includes(String(s.label).toLowerCase()));
      const pipelineStageIds = pipelineStages.map((s) => s.id);
      const stageMap = Object.fromEntries(pipelineStages.map((s) => [s.id, s.label]));
      if (pipelineStageIds.length === 0) return res.json({ type: 'deals', items: [] });
      const ph = pipelineStageIds.map(() => '?').join(',');
      const cdFilter = startISO && endISO ? 'AND createdate >= ? AND createdate <= ?' : '';
      const args = [ownerId, ...pipelineStageIds, ...(startISO && endISO ? [startISO, endISO] : [])];
      const result = await db.execute({
        sql: `SELECT id, dealname, amount, dealstage, createdate, closedate FROM deals WHERE hubspot_owner_id = ? AND archived = 0 AND dealstage IN (${ph}) ${cdFilter} ORDER BY amount DESC`,
        args,
      });
      return res.json({ type: 'deals', label: 'Pipeline Deals', grouped: true, items: result.rows.map((d) => ({ id: d.id, dealname: d.dealname, amount: d.amount, stage: stageMap[d.dealstage] || d.dealstage, createdate: d.createdate, closedate: d.closedate })) });
    }

    if (metric === 'mqls') {
      const cdFilter = startISO && endISO ? 'AND createdate >= ? AND createdate <= ?' : '';
      const args = [ownerId, ...(startISO && endISO ? [startISO, endISO] : [])];
      const result = await db.execute({
        sql: `SELECT id, email, firstname, lastname, mql_type, lead_source, createdate, lifecyclestage FROM contacts WHERE hubspot_owner_id = ? AND (mql_type IS NOT NULL OR lifecyclestage = 'marketingqualifiedlead') ${cdFilter} ORDER BY createdate DESC`,
        args,
      });
      return res.json({ type: 'contacts', label: 'MQL Contacts', items: result.rows.map((c) => ({ id: c.id, name: [c.firstname, c.lastname].filter(Boolean).join(' ') || c.email || 'Unknown', email: c.email, mqlType: c.mql_type, leadSource: c.lead_source, createdate: c.createdate, lifecyclestage: c.lifecyclestage })) });
    }

    res.status(400).json({ error: `Unknown metric: ${metric}` });
  } catch (err) {
    console.error('Goals details error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/goals-tracker/pipeline-deals', async (req, res) => {
  try {
    const db = await getDb();
    const { ownerId, startDate, endDate } = req.query;
    if (!ownerId) return res.status(400).json({ error: 'ownerId is required' });

    const allStages = await getStages(db);
    const pipelineStageLabels = ['sql', 'demo', 'trial', 'quote sent', 'signature'];
    const pipelineStages = allStages.filter((s) => pipelineStageLabels.includes(String(s.label).toLowerCase()));
    const pipelineStageIds = pipelineStages.map((s) => s.id);
    const stageMap = Object.fromEntries(pipelineStages.map((s) => [s.id, s.label]));
    if (pipelineStageIds.length === 0) return res.json([]);

    const ph = pipelineStageIds.map(() => '?').join(',');
    let result;
    if (startDate && endDate) {
      const startISO = new Date(startDate).toISOString();
      const endISO = new Date(endDate + 'T23:59:59.999Z').toISOString();
      result = await db.execute({
        sql: `SELECT id, dealname, amount, dealstage, createdate, closedate FROM deals WHERE hubspot_owner_id = ? AND archived = 0 AND dealstage IN (${ph}) AND createdate >= ? AND createdate <= ? ORDER BY amount DESC`,
        args: [ownerId, ...pipelineStageIds, startISO, endISO],
      });
    } else {
      result = await db.execute({
        sql: `SELECT id, dealname, amount, dealstage, createdate, closedate FROM deals WHERE hubspot_owner_id = ? AND archived = 0 AND dealstage IN (${ph}) ORDER BY amount DESC`,
        args: [ownerId, ...pipelineStageIds],
      });
    }

    res.json(result.rows.map((d) => ({ id: d.id, dealname: d.dealname, amount: d.amount, stage: stageMap[d.dealstage] || d.dealstage, createdate: d.createdate, closedate: d.closedate })));
  } catch (err) {
    console.error('Pipeline deals error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ──────── Sync Endpoints ────────

// POST /api/sync — awaits full sync completion (works on Vercel)
app.post('/api/sync', async (req, res) => {
  if (!TOKEN) return res.status(500).json({ error: 'HUBSPOT_ACCESS_TOKEN not configured' });
  if (syncInProgress) return res.json({ status: 'already_running' });

  try {
    const db = await getDb();
    syncInProgress = true;
    const result = await syncAll(db, TOKEN);
    res.json(result);
  } catch (err) {
    res.status(500).json({ status: 'error', error: err.message });
  } finally {
    syncInProgress = false;
  }
});

app.get('/api/sync/status', async (req, res) => {
  try {
    const db = await getDb();
    const meta = await getSyncStatus(db);
    res.json({
      lastSyncAt: meta?.last_sync_completed_at || null,
      status: syncInProgress ? 'running' : (meta?.last_sync_status || 'never'),
      error: meta?.last_sync_error || null,
      counts: {
        deals: Number(meta?.deals_count) || 0,
        contacts: Number(meta?.contacts_count) || 0,
        owners: Number(meta?.owners_count) || 0,
        stages: Number(meta?.stages_count) || 0,
      },
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/health', async (req, res) => {
  try {
    const db = await getDb();
    const meta = await getSyncStatus(db);
    res.json({
      status: 'ok',
      tokenConfigured: !!TOKEN,
      dbReady: true,
      lastSync: meta?.last_sync_completed_at || 'never',
      syncStatus: syncInProgress ? 'running' : (meta?.last_sync_status || 'never'),
    });
  } catch (err) {
    res.json({ status: 'ok', tokenConfigured: !!TOKEN, dbReady: false, error: err.message });
  }
});

// Production: serve Vite build from Express (for non-Vercel environments)
const distPath = path.join(__dirname, '..', 'frontend', 'dist');
if (process.env.NODE_ENV === 'production') {
  const fs = require('fs');
  if (fs.existsSync(distPath)) {
    app.use(express.static(distPath));
    app.get('*', (req, res, next) => {
      if (req.path.startsWith('/api')) return next();
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }
}

// ──────── Start Server (non-Vercel only) ────────
if (process.env.VERCEL !== '1') {
  const PORT = process.env.PORT || 3001;
  app.listen(PORT, async () => {
    console.log(`\n✅ Sales Calendar backend running on http://localhost:${PORT}`);
    console.log(`   HubSpot token: ${TOKEN ? '✓ configured' : '✗ MISSING'}`);
    try {
      const db = await getDb();
      const meta = await getSyncStatus(db);
      if (!meta?.last_sync_completed_at && TOKEN) {
        console.log('   No previous sync — starting initial sync...');
        syncInProgress = true;
        syncAll(db, TOKEN).finally(() => { syncInProgress = false; });
      } else if (meta?.last_sync_completed_at) {
        console.log(`   Last sync: ${meta.last_sync_completed_at}`);
        console.log(`   Cached: ${meta.deals_count} deals, ${meta.contacts_count} contacts\n`);
      }
    } catch (err) {
      console.error('   DB init error:', err.message);
    }
  });
}

// Trigger startup sync on Vercel (runs when module loads in serverless)
if (process.env.VERCEL === '1' && TOKEN) {
  getDb().then(async (db) => {
    const meta = await getSyncStatus(db);
    if (!meta?.last_sync_completed_at && !syncInProgress) {
      console.log('Vercel cold start: no prior sync found, triggering sync...');
      syncInProgress = true;
      syncAll(db, TOKEN).finally(() => { syncInProgress = false; });
    }
  }).catch(err => console.error('Startup sync check failed:', err.message));
}

module.exports = app;
