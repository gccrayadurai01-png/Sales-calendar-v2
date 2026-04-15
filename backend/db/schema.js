// Database schema — all CREATE TABLE statements

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS sync_meta (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  last_sync_started_at TEXT,
  last_sync_completed_at TEXT,
  last_sync_status TEXT,
  last_sync_error TEXT,
  deals_count INTEGER DEFAULT 0,
  contacts_count INTEGER DEFAULT 0,
  owners_count INTEGER DEFAULT 0,
  stages_count INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS owners (
  id TEXT PRIMARY KEY,
  email TEXT,
  firstName TEXT,
  lastName TEXT,
  userId INTEGER,
  createdAt TEXT,
  updatedAt TEXT,
  archived INTEGER DEFAULT 0,
  teams_json TEXT
);

CREATE TABLE IF NOT EXISTS stages (
  id TEXT PRIMARY KEY,
  label TEXT,
  displayOrder INTEGER,
  pipelineId TEXT,
  pipelineLabel TEXT,
  probability REAL
);

CREATE TABLE IF NOT EXISTS deals (
  id TEXT PRIMARY KEY,
  dealname TEXT,
  amount REAL,
  closedate TEXT,
  createdate TEXT,
  hubspot_owner_id TEXT,
  dealstage TEXT,
  pipeline TEXT,
  dealtype TEXT,
  createdAt TEXT,
  updatedAt TEXT,
  archived INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS deal_stage_dates (
  deal_id TEXT NOT NULL,
  stage_id TEXT NOT NULL,
  date_entered TEXT,
  PRIMARY KEY (deal_id, stage_id)
);

CREATE TABLE IF NOT EXISTS contacts (
  id TEXT PRIMARY KEY,
  firstname TEXT,
  lastname TEXT,
  email TEXT,
  company TEXT,
  createdate TEXT,
  lifecyclestage TEXT,
  hs_lead_status TEXT,
  lead_source TEXT,
  lead_category TEXT,
  hubspot_owner_id TEXT,
  num_associated_deals INTEGER DEFAULT 0,
  num_contacted_notes INTEGER DEFAULT 0,
  num_notes INTEGER DEFAULT 0,
  createdAt TEXT,
  updatedAt TEXT,
  archived INTEGER DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_deals_closedate ON deals(closedate);
CREATE INDEX IF NOT EXISTS idx_deals_createdate ON deals(createdate);
CREATE INDEX IF NOT EXISTS idx_deals_owner ON deals(hubspot_owner_id);
CREATE INDEX IF NOT EXISTS idx_contacts_createdate ON contacts(createdate);
CREATE INDEX IF NOT EXISTS idx_contacts_owner ON contacts(hubspot_owner_id);
CREATE INDEX IF NOT EXISTS idx_deal_stage_dates_deal ON deal_stage_dates(deal_id);

INSERT OR IGNORE INTO sync_meta (id) VALUES (1);
`;

function initSchema(db) {
  db.exec(SCHEMA_SQL);
  // Migration: add num_contacted_notes and num_notes columns if missing
  try {
    db.exec('ALTER TABLE contacts ADD COLUMN num_contacted_notes INTEGER DEFAULT 0');
  } catch { /* column already exists */ }
  try {
    db.exec('ALTER TABLE contacts ADD COLUMN num_notes INTEGER DEFAULT 0');
  } catch { /* column already exists */ }
  try {
    db.exec('ALTER TABLE contacts ADD COLUMN mql_type TEXT');
  } catch { /* column already exists */ }
}

module.exports = { initSchema };
