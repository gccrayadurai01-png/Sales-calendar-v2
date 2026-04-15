// Query helpers that return data in the same shape as HubSpot API responses

function getOwners(db) {
  const rows = db.prepare('SELECT * FROM owners').all();
  return rows.map((r) => ({
    id: r.id,
    email: r.email,
    firstName: r.firstName,
    lastName: r.lastName,
    userId: r.userId,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
    archived: !!r.archived,
    teams: JSON.parse(r.teams_json || '[]'),
  }));
}

function getStages(db) {
  return db.prepare('SELECT * FROM stages ORDER BY displayOrder').all();
}

// Deals by closedate range (Calendar view)
function getDealsByCloseDate(db, startDate, endDate) {
  const startISO = new Date(startDate).toISOString();
  const endISO = new Date(endDate + 'T23:59:59.999Z').toISOString();

  const rows = db.prepare(`
    SELECT * FROM deals WHERE closedate >= ? AND closedate <= ?
  `).all(startISO, endISO);

  return rows.map((r) => ({
    id: r.id,
    properties: {
      dealname: r.dealname,
      amount: r.amount != null ? String(r.amount) : null,
      closedate: r.closedate,
      hubspot_owner_id: r.hubspot_owner_id,
      dealstage: r.dealstage,
      pipeline: r.pipeline,
    },
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
    archived: !!r.archived,
  }));
}

// Deals by createdate range (Deal Flow view) — includes hs_v2_date_entered_* props
function getDealsByCreateDate(db, startDate, endDate) {
  const startISO = new Date(startDate).toISOString();
  const endISO = new Date(endDate + 'T23:59:59.999Z').toISOString();

  const rows = db.prepare(`
    SELECT * FROM deals WHERE createdate >= ? AND createdate <= ?
  `).all(startISO, endISO);

  // Fetch all stage dates for these deals in one query
  const dealIds = rows.map((r) => r.id);
  let stageDatesMap = {};

  if (dealIds.length > 0) {
    // Batch in chunks of 500 to avoid SQLite variable limit
    for (let i = 0; i < dealIds.length; i += 500) {
      const chunk = dealIds.slice(i, i + 500);
      const placeholders = chunk.map(() => '?').join(',');
      const sdRows = db.prepare(`
        SELECT * FROM deal_stage_dates WHERE deal_id IN (${placeholders})
      `).all(...chunk);
      for (const sd of sdRows) {
        if (!stageDatesMap[sd.deal_id]) stageDatesMap[sd.deal_id] = {};
        stageDatesMap[sd.deal_id][`hs_v2_date_entered_${sd.stage_id}`] = sd.date_entered;
      }
    }
  }

  return rows.map((r) => ({
    id: r.id,
    properties: {
      dealname: r.dealname,
      amount: r.amount != null ? String(r.amount) : null,
      closedate: r.closedate,
      createdate: r.createdate,
      hubspot_owner_id: r.hubspot_owner_id,
      dealstage: r.dealstage,
      pipeline: r.pipeline,
      dealtype: r.dealtype,
      ...(stageDatesMap[r.id] || {}),
    },
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
    archived: !!r.archived,
  }));
}

// Contacts by createdate range (Contacts view)
// If startDate/endDate are null, returns all contacts (all-time)
function getContactsByCreateDate(db, startDate, endDate) {
  let rows;
  if (startDate && endDate) {
    const startISO = new Date(startDate).toISOString();
    const endISO = new Date(endDate + 'T23:59:59.999Z').toISOString();
    rows = db.prepare(`
      SELECT * FROM contacts WHERE createdate >= ? AND createdate <= ?
    `).all(startISO, endISO);
  } else {
    rows = db.prepare(`SELECT * FROM contacts`).all();
  }

  return rows.map((r) => ({
    id: r.id,
    properties: {
      firstname: r.firstname,
      lastname: r.lastname,
      email: r.email,
      company: r.company,
      createdate: r.createdate,
      lifecyclestage: r.lifecyclestage,
      hs_lead_status: r.hs_lead_status,
      lead_source: r.lead_source,
      lead_category: r.lead_category,
      mql_type: r.mql_type,
      hubspot_owner_id: r.hubspot_owner_id,
      num_associated_deals: r.num_associated_deals != null ? String(r.num_associated_deals) : null,
      num_contacted_notes: r.num_contacted_notes != null ? String(r.num_contacted_notes) : null,
      num_notes: r.num_notes != null ? String(r.num_notes) : null,
      lastmodifieddate: r.updatedAt,
      hs_object_id: r.id,
    },
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
    archived: !!r.archived,
    url: `https://app.hubspot.com/contacts/22689012/record/0-1/${r.id}`,
  }));
}

function getSyncStatus(db) {
  return db.prepare('SELECT * FROM sync_meta WHERE id = 1').get();
}

module.exports = {
  getOwners,
  getStages,
  getDealsByCloseDate,
  getDealsByCreateDate,
  getContactsByCreateDate,
  getSyncStatus,
};
