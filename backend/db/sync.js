const axios = require('axios');

const HUBSPOT_BASE = 'https://api.hubapi.com';

function hsHeaders(token) {
  return { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
}

async function withRetry(fn, retries = 5) {
  for (let i = 0; i < retries; i++) {
    try {
      return await fn();
    } catch (err) {
      const status = err.response?.status;
      if (status === 429 && i < retries - 1) {
        const wait = (i + 1) * 2000;
        console.log(`  ⏳ Rate limited, waiting ${wait}ms...`);
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

  const stmts = [
    { sql: 'DELETE FROM owners', args: [] },
    ...owners.map((o) => ({
      sql: `INSERT OR REPLACE INTO owners (id, email, firstName, lastName, userId, createdAt, updatedAt, archived, teams_json)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [o.id, o.email, o.firstName, o.lastName, o.userId,
        o.createdAt, o.updatedAt, o.archived ? 1 : 0, JSON.stringify(o.teams || [])],
    })),
  ];
  await db.batch(stmts, 'write');
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

  const stmts = [
    { sql: 'DELETE FROM stages', args: [] },
    ...stages.map((s) => ({
      sql: `INSERT OR REPLACE INTO stages (id, label, displayOrder, pipelineId, pipelineLabel, probability)
            VALUES (?, ?, ?, ?, ?, ?)`,
      args: [s.id, s.label, s.displayOrder, s.pipelineId, s.pipelineLabel, s.probability],
    })),
  ];
  await db.batch(stmts, 'write');
  console.log(`  ✓ ${stages.length} stages synced`);
  return stages.length;
}

// ── Sync Deals ──
async function syncDeals(db, token) {
  console.log('  📥 Syncing deals...');

  const stagesResult = await db.execute('SELECT id FROM stages');
  const stageIds = stagesResult.rows.map((r) => r.id);
  const dateEnteredProps = stageIds.map((id) => `hs_v2_date_entered_${id}`);

  const baseProps = [
    'dealname', 'amount', 'createdate', 'closedate',
    'hubspot_owner_id', 'dealstage', 'pipeline', 'dealtype',
  ];

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

  // Use interactive transaction for large datasets
  const txn = await db.transaction('write');
  try {
    await txn.execute('DELETE FROM deals');
    await txn.execute('DELETE FROM deal_stage_dates');
    for (const d of deals) {
      const p = d.properties;
      await txn.execute({
        sql: `INSERT OR REPLACE INTO deals (id, dealname, amount, closedate, createdate, hubspot_owner_id, dealstage, pipeline, dealtype, createdAt, updatedAt, archived)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        args: [d.id, p.dealname, parseFloat(p.amount) || 0, p.closedate, p.createdate,
          p.hubspot_owner_id, p.dealstage, p.pipeline, p.dealtype,
          d.createdAt, d.updatedAt, d.archived ? 1 : 0],
      });
      for (const sid of stageIds) {
        const val = p[`hs_v2_date_entered_${sid}`];
        if (val) {
          await txn.execute({
            sql: 'INSERT OR REPLACE INTO deal_stage_dates (deal_id, stage_id, date_entered) VALUES (?, ?, ?)',
            args: [d.id, sid, val],
          });
        }
      }
    }
    await txn.commit();
  } catch (err) {
    await txn.rollback();
    throw err;
  }

  console.log(`  ✓ ${deals.length} deals synced`);
  return deals.length;
}

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

function generateMonthlyRanges(startYear, endYear) {
  const ranges = [];
  for (let y = startYear; y <= endYear; y++) {
    for (let m = 0; m < 12; m++) {
      const start = new Date(y, m, 1);
      const end = new Date(y, m + 1, 0, 23, 59, 59, 999);
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
  console.log('  📥 Syncing contacts...');

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

  // Use interactive transaction for large datasets
  const txn = await db.transaction('write');
  try {
    await txn.execute('DELETE FROM contacts');
    for (const c of allContacts) {
      const p = c.properties;
      await txn.execute({
        sql: `INSERT OR REPLACE INTO contacts (id, firstname, lastname, email, company, createdate, lifecyclestage,
              hs_lead_status, lead_source, lead_category, mql_type, hubspot_owner_id,
              num_associated_deals, num_contacted_notes, num_notes, createdAt, updatedAt, archived)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        args: [c.id, p.firstname, p.lastname, p.email, p.company, p.createdate,
          p.lifecyclestage, p.hs_lead_status, p.lead_source, p.lead_category, p.mql_type,
          p.hubspot_owner_id, parseInt(p.num_associated_deals) || 0,
          parseInt(p.num_contacted_notes) || 0, parseInt(p.num_notes) || 0,
          c.createdAt, c.updatedAt, c.archived ? 1 : 0],
      });
    }
    await txn.commit();
  } catch (err) {
    await txn.rollback();
    throw err;
  }

  console.log(`  ✓ ${allContacts.length} contacts synced`);
  return allContacts.length;
}

// ── Full Sync Orchestrator ──
async function syncAll(db, token) {
  console.log('\n🔄 Starting full HubSpot sync...');
  const startedAt = new Date().toISOString();

  await db.execute({
    sql: `UPDATE sync_meta SET last_sync_started_at = ?, last_sync_status = 'running', last_sync_error = NULL WHERE id = 1`,
    args: [startedAt],
  });

  try {
    const ownersCount = await syncOwners(db, token);
    const stagesCount = await syncStages(db, token);
    const dealsCount = await syncDeals(db, token);
    const contactsCount = await syncContacts(db, token);

    const completedAt = new Date().toISOString();
    await db.execute({
      sql: `UPDATE sync_meta SET last_sync_completed_at = ?, last_sync_status = 'success',
            owners_count = ?, stages_count = ?, deals_count = ?, contacts_count = ? WHERE id = 1`,
      args: [completedAt, ownersCount, stagesCount, dealsCount, contactsCount],
    });

    const elapsed = ((new Date(completedAt) - new Date(startedAt)) / 1000).toFixed(1);
    console.log(`\n✅ Sync complete in ${elapsed}s — ${dealsCount} deals, ${contactsCount} contacts\n`);
    return { status: 'success', dealsCount, contactsCount, ownersCount, stagesCount };
  } catch (err) {
    const errMsg = err.response?.data?.message || err.message;
    console.error(`\n❌ Sync failed: ${errMsg}\n`);
    await db.execute({
      sql: `UPDATE sync_meta SET last_sync_status = 'error', last_sync_error = ? WHERE id = 1`,
      args: [errMsg],
    });
    return { status: 'error', error: errMsg };
  }
}

module.exports = { syncAll };
