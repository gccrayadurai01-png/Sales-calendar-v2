// Query helpers — all async, using @libsql/client

async function getOwners(db) {
  const result = await db.execute('SELECT * FROM owners');
  return result.rows.map((r) => ({
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

async function getStages(db) {
  const result = await db.execute('SELECT * FROM stages ORDER BY displayOrder');
  return result.rows;
}

// Deals by closedate range (Calendar view)
async function getDealsByCloseDate(db, startDate, endDate) {
  const startISO = new Date(startDate).toISOString();
  const endISO = new Date(endDate + 'T23:59:59.999Z').toISOString();

  const result = await db.execute({
    sql: 'SELECT * FROM deals WHERE closedate >= ? AND closedate <= ?',
    args: [startISO, endISO],
  });

  return result.rows.map((r) => ({
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
async function getDealsByCreateDate(db, startDate, endDate) {
  const startISO = new Date(startDate).toISOString();
  const endISO = new Date(endDate + 'T23:59:59.999Z').toISOString();

  const result = await db.execute({
    sql: 'SELECT * FROM deals WHERE createdate >= ? AND createdate <= ?',
    args: [startISO, endISO],
  });
  const rows = result.rows;
  const dealIds = rows.map((r) => r.id);
  let stageDatesMap = {};

  if (dealIds.length > 0) {
    // Batch in chunks of 200 to stay well within parameter limits
    for (let i = 0; i < dealIds.length; i += 200) {
      const chunk = dealIds.slice(i, i + 200);
      const placeholders = chunk.map(() => '?').join(',');
      const sdResult = await db.execute({
        sql: `SELECT * FROM deal_stage_dates WHERE deal_id IN (${placeholders})`,
        args: chunk,
      });
      for (const sd of sdResult.rows) {
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
async function getContactsByCreateDate(db, startDate, endDate) {
  let result;
  if (startDate && endDate) {
    const startISO = new Date(startDate).toISOString();
    const endISO = new Date(endDate + 'T23:59:59.999Z').toISOString();
    result = await db.execute({
      sql: 'SELECT * FROM contacts WHERE createdate >= ? AND createdate <= ?',
      args: [startISO, endISO],
    });
  } else {
    result = await db.execute('SELECT * FROM contacts');
  }

  return result.rows.map((r) => ({
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

async function getSyncStatus(db) {
  const result = await db.execute('SELECT * FROM sync_meta WHERE id = 1');
  return result.rows[0] || null;
}

module.exports = {
  getOwners,
  getStages,
  getDealsByCloseDate,
  getDealsByCreateDate,
  getContactsByCreateDate,
  getSyncStatus,
};
