const axios = require('axios');

const HUBSPOT_BASE = 'https://api.hubapi.com';

function hsHeaders(token) {
  return { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
}

// Retry on 429 rate-limit with exponential backoff
async function withRetry(fn, retries = 5) {
  for (let i = 0; i < retries; i++) {
    try {
      return await fn();
    } catch (err) {
      const status = err.response?.status;
      if (status === 429 && i < retries - 1) {
        const wait = (i + 1) * 2000;
        console.log(`  ⏳ Rate limited, waiting ${wait}ms before retry ${i + 2}/${retries}...`);
        await new Promise((r) => setTimeout(r, wait));
      } else {
        throw err;
      }
    }
  }
}

// ── Sync Owners ──
async function syncOwners(db, token) {
  console.log('  📥 Syncing owners...');
  let owners = [];
  let after;
  do {
    const params = new URLSearchParams({ limit: '100' });
    if (after) params.set('after', after);
    const res = await withRetry(() =>
      axios.get(`${HUBSPOT_BASE}/crm/v3/owners?${params}`, { headers: hsHeaders(token) })
    );
    owners = owners.concat(res.data.results);
    after = res.data.paging?.next?.after;
  } while (after);

  const upsert = db.prepare(`
    INSERT OR REPLACE INTO owners (id, email, firstName, lastName, userId, createdAt, updatedAt, archived, teams_json)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const tx = db.transaction((rows) => {
    db.prepare('DELETE FROM owners').run();
    for (const o of rows) {
      upsert.run(o.id, o.email, o.firstName, o.lastName, o.userId,
        o.createdAt, o.updatedAt, o.archived ? 1 : 0, JSON.stringify(o.teams || []));
    }
  });
  tx(owners);
  console.log(`  ✓ ${owners.length} owners synced`);
  return owners.length;
}

// ── Sync Stages ──
async function syncStages(db, token) {
  console.log('  📥 Syncing stages...');
  const res = await withRetry(() =>
    axios.get(`${HUBSPOT_BASE}/crm/v3/pipelines/deals`, { headers: hsHeaders(token) })
  );
  const pipelines = res.data.results || [];
  const stages = pipelines.flatMap((p) =>
    (p.stages || []).map((s) => ({
      id: s.id,
      label: s.label,
      displayOrder: s.displayOrder,
      pipelineId: p.id,
      pipelineLabel: p.label,
      probability: s.metadata?.probability ?? null,
    }))
  );

  const upsert = db.prepare(`
    INSERT OR REPLACE INTO stages (id, label, displayOrder, pipelineId, pipelineLabel, probability)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  const tx = db.transaction((rows) => {
    db.prepare('DELETE FROM stages').run();
    for (const s of rows) {
      upsert.run(s.id, s.label, s.displayOrder, s.pipelineId, s.pipelineLabel, s.probability);
    }
  });
  tx(stages);
  console.log(`  ✓ ${stages.length} stages synced`);
  return stages.length;
}

// ── Sync Deals ──
async function syncDeals(db, token) {
  console.log('  📥 Syncing deals...');

  // Get stage IDs for hs_v2_date_entered_* properties
  const stageRows = db.prepare('SELECT id FROM stages').all();
  const stageIds = stageRows.map((r) => r.id);
  const dateEnteredProps = stageIds.map((id) => `hs_v2_date_entered_${id}`);

  const baseProps = [
    'dealname', 'amount', 'createdate', 'closedate',
    'hubspot_owner_id', 'dealstage', 'pipeline', 'dealtype',
  ];

  // Fetch ALL deals chunked by quarter to avoid 10k limit
  const now = new Date();
  const ranges = generateQuarterlyRanges(now.getFullYear() - 3, now.getFullYear() + 1);

  let deals = [];
  for (const range of ranges) {
    let chunk = [];
    let after;
    do {
      const body = {
        filterGroups: [{
          filters: [
            { propertyName: 'createdate', operator: 'GTE', value: range.startMs },
            { propertyName: 'createdate', operator: 'LTE', value: range.endMs },
          ],
        }],
        properties: [...baseProps, ...dateEnteredProps],
        limit: 100,
      };
      if (after) body.after = after;

      const res = await withRetry(() =>
        axios.post(`${HUBSPOT_BASE}/crm/v3/objects/deals/search`, body, { headers: hsHeaders(token) })
      );
      chunk = chunk.concat(res.data.results);
      after = res.data.paging?.next?.after;
    } while (after);

    if (chunk.length > 0) {
      deals = deals.concat(chunk);
      console.log(`    ${range.label}: ${chunk.length} deals (total: ${deals.length})`);
    }
  }

  const upsertDeal = db.prepare(`
    INSERT OR REPLACE INTO deals (id, dealname, amount, closedate, createdate, hubspot_owner_id, dealstage, pipeline, dealtype, createdAt, updatedAt, archived)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const upsertStageDate = db.prepare(`
    INSERT OR REPLACE INTO deal_stage_dates (deal_id, stage_id, date_entered) VALUES (?, ?, ?)
  `);

  const tx = db.transaction((rows) => {
    db.prepare('DELETE FROM deals').run();
    db.prepare('DELETE FROM deal_stage_dates').run();
    for (const d of rows) {
      const p = d.properties;
      upsertDeal.run(d.id, p.dealname, parseFloat(p.amount) || 0,
        p.closedate, p.createdate, p.hubspot_owner_id, p.dealstage,
        p.pipeline, p.dealtype, d.createdAt, d.updatedAt, d.archived ? 1 : 0);

      // Store hs_v2_date_entered_* values
      for (const sid of stageIds) {
        const val = p[`hs_v2_date_entered_${sid}`];
        if (val) upsertStageDate.run(d.id, sid, val);
      }
    }
  });
  tx(deals);
  console.log(`  ✓ ${deals.length} deals synced`);
  return deals.length;
}

// Helper: generate quarterly date ranges for deals
function generateQuarterlyRanges(startYear, endYear) {
  const ranges = [];
  for (let y = startYear; y <= endYear; y++) {
    for (let q = 0; q < 4; q++) {
      const start = new Date(y, q * 3, 1);
      const end = new Date(y, q * 3 + 3, 0, 23, 59, 59, 999);
      ranges.push({
        startMs: start.getTime().toString(),
        endMs: end.getTime().toString(),
        label: `${y}-Q${q + 1}`,
      });
    }
  }
  return ranges;
}

// Helper: generate monthly date ranges to stay under HubSpot's 10k search limit
function generateMonthlyRanges(startYear, endYear) {
  const ranges = [];
  for (let y = startYear; y <= endYear; y++) {
    for (let m = 0; m < 12; m++) {
      const start = new Date(y, m, 1);
      const end = new Date(y, m + 1, 0, 23, 59, 59, 999); // last ms of month
      ranges.push({
        startMs: start.getTime().toString(),
        endMs: end.getTime().toString(),
        label: `${y}-${String(m + 1).padStart(2, '0')}`,
      });
    }
  }
  return ranges;
}

// ── Sync Contacts ──
async function syncContacts(db, token) {
  console.log('  📥 Syncing contacts (chunked by month to avoid 10k limit)...');

  const properties = [
    'firstname', 'lastname', 'email', 'company', 'createdate',
    'lifecyclestage', 'hs_lead_status', 'lead_source', 'lead_category', 'mql_type',
    'hubspot_owner_id', 'num_associated_deals', 'num_contacted_notes', 'num_notes',
  ];

  const now = new Date();
  const ranges = generateMonthlyRanges(now.getFullYear() - 3, now.getFullYear());

  let allContacts = [];

  for (const range of ranges) {
    let contacts = [];
    let after;
    do {
      const body = {
        filterGroups: [{
          filters: [
            { propertyName: 'createdate', operator: 'GTE', value: range.startMs },
            { propertyName: 'createdate', operator: 'LTE', value: range.endMs },
          ],
        }],
        properties,
        limit: 100,
      };
      if (after) body.after = after;

      const res = await withRetry(() =>
        axios.post(`${HUBSPOT_BASE}/crm/v3/objects/contacts/search`, body, { headers: hsHeaders(token) })
      );
      contacts = contacts.concat(res.data.results);
      after = res.data.paging?.next?.after;
    } while (after);

    if (contacts.length > 0) {
      allContacts = allContacts.concat(contacts);
      console.log(`    ${range.label}: ${contacts.length} contacts (total: ${allContacts.length})`);
    }
  }

  const upsert = db.prepare(`
    INSERT OR REPLACE INTO contacts (id, firstname, lastname, email, company, createdate, lifecyclestage,
      hs_lead_status, lead_source, lead_category, mql_type, hubspot_owner_id, num_associated_deals, num_contacted_notes, num_notes, createdAt, updatedAt, archived)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const tx = db.transaction((rows) => {
    db.prepare('DELETE FROM contacts').run();
    for (const c of rows) {
      const p = c.properties;
      upsert.run(c.id, p.firstname, p.lastname, p.email, p.company, p.createdate,
        p.lifecyclestage, p.hs_lead_status, p.lead_source, p.lead_category, p.mql_type,
        p.hubspot_owner_id, parseInt(p.num_associated_deals) || 0,
        parseInt(p.num_contacted_notes) || 0, parseInt(p.num_notes) || 0,
        c.createdAt, c.updatedAt, c.archived ? 1 : 0);
    }
  });
  tx(allContacts);
  console.log(`  ✓ ${allContacts.length} contacts synced`);
  return allContacts.length;
}

// ── Full Sync Orchestrator ──
async function syncAll(db, token) {
  console.log('\n🔄 Starting full HubSpot sync...');
  const startedAt = new Date().toISOString();

  db.prepare(`UPDATE sync_meta SET last_sync_started_at = ?, last_sync_status = 'running', last_sync_error = NULL WHERE id = 1`)
    .run(startedAt);

  try {
    const ownersCount = await syncOwners(db, token);
    const stagesCount = await syncStages(db, token);
    const dealsCount = await syncDeals(db, token);
    const contactsCount = await syncContacts(db, token);

    const completedAt = new Date().toISOString();
    db.prepare(`UPDATE sync_meta SET last_sync_completed_at = ?, last_sync_status = 'success',
      owners_count = ?, stages_count = ?, deals_count = ?, contacts_count = ? WHERE id = 1`)
      .run(completedAt, ownersCount, stagesCount, dealsCount, contactsCount);

    const elapsed = ((new Date(completedAt) - new Date(startedAt)) / 1000).toFixed(1);
    console.log(`\n✅ Sync complete in ${elapsed}s — ${dealsCount} deals, ${contactsCount} contacts, ${ownersCount} owners, ${stagesCount} stages\n`);
    return { status: 'success', dealsCount, contactsCount, ownersCount, stagesCount };
  } catch (err) {
    const errMsg = err.response?.data?.message || err.message;
    console.error(`\n❌ Sync failed: ${errMsg}\n`);
    db.prepare(`UPDATE sync_meta SET last_sync_status = 'error', last_sync_error = ? WHERE id = 1`)
      .run(errMsg);
    return { status: 'error', error: errMsg };
  }
}

module.exports = { syncAll };
