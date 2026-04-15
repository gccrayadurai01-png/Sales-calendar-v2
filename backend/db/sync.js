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

// ── Helpers ──
function generateQuarterlyRanges(startYear, endYear) {
  const ranges = [];
  for (let y = startYear; y <= endYear; y++) {
    for (let q = 0; q < 4; q++) {
      const start = new Date(y, q * 3, 1);
      const end = new Date(y, q * 3 + 3, 0, 23, 59, 59, 999);
      ranges.push({ startMs: start.getTime().toString(), endMs: end.getTime().toString(), label: `${y}-Q${q + 1}` });
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
      ranges.push({ startMs: start.getTime().toString(), endMs: end.getTime().toString(), label: `${y}-${String(m + 1).padStart(2, '0')}` });
    }
  }
  return ranges;
}

async function getStageIds(db) {
  const result = await db.execute('SELECT id FROM stages');
  return result.rows.map((r) => r.id);
}

// ── Sync Owners (always full — small dataset) ──
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
      sql: `INSERT OR REPLACE INTO owners (id, email, firstName, lastName, userId, createdAt, updatedAt, archived, teams_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [o.id, o.email, o.firstName, o.lastName, o.userId, o.createdAt, o.updatedAt, o.archived ? 1 : 0, JSON.stringify(o.teams || [])],
    })),
  ];
  await db.batch(stmts, 'write');
  console.log(`  ✓ ${owners.length} owners synced`);
  return owners.length;
}

// ── Sync Stages (always full — small dataset) ──
async function syncStages(db, token) {
  console.log('  📥 Syncing stages...');
  const res = await withRetry(() =>
    axios.get(`${HUBSPOT_BASE}/crm/v3/pipelines/deals`, { headers: hsHeaders(token) })
  );
  const stages = (res.data.results || []).flatMap((p) =>
    (p.stages || []).map((s) => ({
      id: s.id, label: s.label, displayOrder: s.displayOrder,
      pipelineId: p.id, pipelineLabel: p.label, probability: s.metadata?.probability ?? null,
    }))
  );
  const stmts = [
    { sql: 'DELETE FROM stages', args: [] },
    ...stages.map((s) => ({
      sql: `INSERT OR REPLACE INTO stages (id, label, displayOrder, pipelineId, pipelineLabel, probability) VALUES (?, ?, ?, ?, ?, ?)`,
      args: [s.id, s.label, s.displayOrder, s.pipelineId, s.pipelineLabel, s.probability],
    })),
  ];
  await db.batch(stmts, 'write');
  console.log(`  ✓ ${stages.length} stages synced`);
  return stages.length;
}

// ── FULL: Sync all deals (first sync only) ──
async function syncDealsFull(db, token) {
  console.log('  📥 Syncing all deals (full)...');
  const stageIds = await getStageIds(db);
  const dateEnteredProps = stageIds.map((id) => `hs_v2_date_entered_${id}`);
  const baseProps = ['dealname', 'amount', 'createdate', 'closedate', 'hubspot_owner_id', 'dealstage', 'pipeline', 'dealtype'];
  const now = new Date();
  const ranges = generateQuarterlyRanges(now.getFullYear() - 3, now.getFullYear() + 1);

  let deals = [];
  for (const range of ranges) {
    let chunk = [], after;
    do {
      const body = { filterGroups: [{ filters: [{ propertyName: 'createdate', operator: 'GTE', value: range.startMs }, { propertyName: 'createdate', operator: 'LTE', value: range.endMs }] }], properties: [...baseProps, ...dateEnteredProps], limit: 100 };
      if (after) body.after = after;
      const res = await withRetry(() => axios.post(`${HUBSPOT_BASE}/crm/v3/objects/deals/search`, body, { headers: hsHeaders(token) }));
      chunk = chunk.concat(res.data.results);
      after = res.data.paging?.next?.after;
    } while (after);
    if (chunk.length > 0) { deals = deals.concat(chunk); console.log(`    ${range.label}: ${chunk.length} deals`); }
  }

  await upsertDeals(db, deals, stageIds, true);
  console.log(`  ✓ ${deals.length} deals synced (full)`);
  return deals.length;
}

// ── INCREMENTAL: Sync only modified deals since lastSyncAt ──
async function syncDealsIncremental(db, token, lastSyncAt) {
  console.log(`  📥 Syncing deals modified since ${lastSyncAt}...`);
  const stageIds = await getStageIds(db);
  const dateEnteredProps = stageIds.map((id) => `hs_v2_date_entered_${id}`);
  const baseProps = ['dealname', 'amount', 'createdate', 'closedate', 'hubspot_owner_id', 'dealstage', 'pipeline', 'dealtype'];
  const sinceMs = new Date(lastSyncAt).getTime().toString();

  let deals = [], after;
  do {
    const body = { filterGroups: [{ filters: [{ propertyName: 'hs_lastmodifieddate', operator: 'GTE', value: sinceMs }] }], properties: [...baseProps, ...dateEnteredProps], limit: 100 };
    if (after) body.after = after;
    const res = await withRetry(() => axios.post(`${HUBSPOT_BASE}/crm/v3/objects/deals/search`, body, { headers: hsHeaders(token) }));
    deals = deals.concat(res.data.results);
    after = res.data.paging?.next?.after;
  } while (after);

  if (deals.length > 0) await upsertDeals(db, deals, stageIds, false);
  console.log(`  ✓ ${deals.length} deals updated (incremental)`);
  return deals.length;
}

// ── Shared upsert for deals (chunked batch, fast) ──
async function upsertDeals(db, deals, stageIds, deleteFirst) {
  if (deleteFirst) {
    await db.execute({ sql: 'DELETE FROM deals', args: [] });
    await db.execute({ sql: 'DELETE FROM deal_stage_dates', args: [] });
  }

  const CHUNK = 50;
  for (let i = 0; i < deals.length; i += CHUNK) {
    const stmts = [];
    for (const d of deals.slice(i, i + CHUNK)) {
      const p = d.properties;
      stmts.push({
        sql: `INSERT OR REPLACE INTO deals (id, dealname, amount, closedate, createdate, hubspot_owner_id, dealstage, pipeline, dealtype, createdAt, updatedAt, archived) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        args: [d.id, p.dealname, parseFloat(p.amount) || 0, p.closedate, p.createdate, p.hubspot_owner_id, p.dealstage, p.pipeline, p.dealtype, d.createdAt, d.updatedAt, d.archived ? 1 : 0],
      });
      for (const sid of stageIds) {
        const val = p[`hs_v2_date_entered_${sid}`];
        if (val) stmts.push({ sql: 'INSERT OR REPLACE INTO deal_stage_dates (deal_id, stage_id, date_entered) VALUES (?, ?, ?)', args: [d.id, sid, val] });
      }
    }
    try {
      await db.batch(stmts, 'write');
    } catch (batchErr) {
      console.error(`  ❌ Deals batch error at chunk ${i}: ${batchErr.message}`);
      throw batchErr;
    }
    if (i % 500 === 0 && i > 0) console.log(`    deals: ${i}/${deals.length} inserted...`);
  }
}

// ── FULL: Sync all contacts (first sync only) ──
async function syncContactsFull(db, token) {
  console.log('  📥 Syncing all contacts (full)...');
  const properties = ['firstname', 'lastname', 'email', 'company', 'createdate', 'lifecyclestage', 'hs_lead_status', 'lead_source', 'lead_category', 'mql_type', 'hubspot_owner_id', 'num_associated_deals', 'num_contacted_notes', 'num_notes'];
  const now = new Date();
  const ranges = generateMonthlyRanges(now.getFullYear() - 3, now.getFullYear());

  let allContacts = [];
  for (const range of ranges) {
    let contacts = [], after;
    do {
      const body = { filterGroups: [{ filters: [{ propertyName: 'createdate', operator: 'GTE', value: range.startMs }, { propertyName: 'createdate', operator: 'LTE', value: range.endMs }] }], properties, limit: 100 };
      if (after) body.after = after;
      const res = await withRetry(() => axios.post(`${HUBSPOT_BASE}/crm/v3/objects/contacts/search`, body, { headers: hsHeaders(token) }));
      contacts = contacts.concat(res.data.results);
      after = res.data.paging?.next?.after;
    } while (after);
    if (contacts.length > 0) { allContacts = allContacts.concat(contacts); console.log(`    ${range.label}: ${contacts.length} contacts`); }
  }

  await upsertContacts(db, allContacts, true);
  console.log(`  ✓ ${allContacts.length} contacts synced (full)`);
  return allContacts.length;
}

// ── INCREMENTAL: Sync only modified contacts since lastSyncAt ──
async function syncContactsIncremental(db, token, lastSyncAt) {
  console.log(`  📥 Syncing contacts modified since ${lastSyncAt}...`);
  const properties = ['firstname', 'lastname', 'email', 'company', 'createdate', 'lifecyclestage', 'hs_lead_status', 'lead_source', 'lead_category', 'mql_type', 'hubspot_owner_id', 'num_associated_deals', 'num_contacted_notes', 'num_notes'];
  const sinceMs = new Date(lastSyncAt).getTime().toString();

  let contacts = [], after;
  do {
    const body = { filterGroups: [{ filters: [{ propertyName: 'lastmodifieddate', operator: 'GTE', value: sinceMs }] }], properties, limit: 100 };
    if (after) body.after = after;
    const res = await withRetry(() => axios.post(`${HUBSPOT_BASE}/crm/v3/objects/contacts/search`, body, { headers: hsHeaders(token) }));
    contacts = contacts.concat(res.data.results);
    after = res.data.paging?.next?.after;
  } while (after);

  if (contacts.length > 0) await upsertContacts(db, contacts, false);
  console.log(`  ✓ ${contacts.length} contacts updated (incremental)`);
  return contacts.length;
}

// ── Shared upsert for contacts (chunked batch, fast) ──
async function upsertContacts(db, contacts, deleteFirst) {
  if (deleteFirst) {
    await db.execute({ sql: 'DELETE FROM contacts', args: [] });
  }

  const CHUNK = 50;
  for (let i = 0; i < contacts.length; i += CHUNK) {
    const stmts = contacts.slice(i, i + CHUNK).map((c) => {
      const p = c.properties;
      return {
        sql: `INSERT OR REPLACE INTO contacts (id, firstname, lastname, email, company, createdate, lifecyclestage, hs_lead_status, lead_source, lead_category, mql_type, hubspot_owner_id, num_associated_deals, num_contacted_notes, num_notes, createdAt, updatedAt, archived) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        args: [c.id, p.firstname, p.lastname, p.email, p.company, p.createdate, p.lifecyclestage, p.hs_lead_status, p.lead_source, p.lead_category, p.mql_type, p.hubspot_owner_id, parseInt(p.num_associated_deals) || 0, parseInt(p.num_contacted_notes) || 0, parseInt(p.num_notes) || 0, c.createdAt, c.updatedAt, c.archived ? 1 : 0],
      };
    });
    try {
      await db.batch(stmts, 'write');
    } catch (batchErr) {
      console.error(`  ❌ Contacts batch error at chunk ${i}: ${batchErr.message}`);
      throw batchErr;
    }
    if (i % 1000 === 0 && i > 0) console.log(`    contacts: ${i}/${contacts.length} inserted...`);
  }
}

// ── Full Sync Orchestrator ──
async function syncAll(db, token, opts = {}) {
  const metaResult = await db.execute('SELECT * FROM sync_meta WHERE id = 1');
  const lastCompleted = metaResult.rows[0]?.last_sync_completed_at;
  const isIncremental = !opts.force && !!lastCompleted;

  console.log(`\n🔄 Starting ${isIncremental ? 'incremental' : 'FULL'} HubSpot sync...`);
  const startedAt = new Date().toISOString();

  await db.execute({
    sql: `UPDATE sync_meta SET last_sync_started_at = ?, last_sync_status = 'running', last_sync_error = NULL WHERE id = 1`,
    args: [startedAt],
  });

  try {
    const ownersCount = await syncOwners(db, token);
    const stagesCount = await syncStages(db, token);

    let dealsCount, contactsCount;
    if (isIncremental) {
      dealsCount = await syncDealsIncremental(db, token, lastCompleted);
      contactsCount = await syncContactsIncremental(db, token, lastCompleted);
    } else {
      dealsCount = await syncDealsFull(db, token);
      contactsCount = await syncContactsFull(db, token);
    }

    // Update total counts in DB
    const totalDeals = (await db.execute('SELECT COUNT(*) as c FROM deals')).rows[0].c;
    const totalContacts = (await db.execute('SELECT COUNT(*) as c FROM contacts')).rows[0].c;

    const completedAt = new Date().toISOString();
    await db.execute({
      sql: `UPDATE sync_meta SET last_sync_completed_at = ?, last_sync_status = 'success', owners_count = ?, stages_count = ?, deals_count = ?, contacts_count = ? WHERE id = 1`,
      args: [completedAt, ownersCount, stagesCount, Number(totalDeals), Number(totalContacts)],
    });

    const elapsed = ((new Date(completedAt) - new Date(startedAt)) / 1000).toFixed(1);
    console.log(`\n✅ Sync complete in ${elapsed}s (${isIncremental ? 'incremental' : 'full'}) — ${dealsCount} changed, ${contactsCount} contacts changed\n`);
    return { status: 'success', type: isIncremental ? 'incremental' : 'full', dealsCount: Number(totalDeals), contactsCount: Number(totalContacts) };
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
