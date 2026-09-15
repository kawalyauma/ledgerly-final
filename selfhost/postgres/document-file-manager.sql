-- Documents & Files v1.0 PostgreSQL parity for the modular self-host runtime.

CREATE TABLE IF NOT EXISTS file_folders (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  parent_id TEXT REFERENCES file_folders(id) ON DELETE RESTRICT,
  name TEXT NOT NULL,
  name_normalized TEXT NOT NULL,
  created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  updated_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  deleted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS file_folders_org_parent_name_uq
  ON file_folders(organization_id,COALESCE(parent_id,''),name_normalized)
  WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS file_folders_org_parent_idx
  ON file_folders(organization_id,parent_id,deleted_at,name);

CREATE TABLE IF NOT EXISTS file_items (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  folder_id TEXT REFERENCES file_folders(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  filename TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  size_bytes BIGINT NOT NULL DEFAULT 0 CHECK(size_bytes >= 0),
  checksum_sha256 TEXT,
  storage_bucket TEXT NOT NULL DEFAULT 'work' CHECK(storage_bucket IN ('work','reports')),
  object_key TEXT,
  preview_object_key TEXT,
  preview_mime_type TEXT,
  preview_size_bytes BIGINT CHECK(preview_size_bytes IS NULL OR preview_size_bytes >= 0),
  source_type TEXT NOT NULL DEFAULT 'upload' CHECK(source_type IN ('upload','ai_generated','school_file','scannerly','report_export','system_generated','finance_attachment','printerly')),
  source_module TEXT,
  source_entity_type TEXT,
  source_entity_id TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','archived','trashed')),
  current_version INTEGER NOT NULL DEFAULT 1 CHECK(current_version >= 1),
  tags_json TEXT NOT NULL DEFAULT '[]',
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  updated_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  deleted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS file_items_org_folder_idx ON file_items(organization_id,folder_id,status,updated_at DESC);
CREATE INDEX IF NOT EXISTS file_items_org_source_idx ON file_items(organization_id,source_type,source_module,updated_at DESC);
CREATE INDEX IF NOT EXISTS file_items_org_title_idx ON file_items(organization_id,title);
CREATE UNIQUE INDEX IF NOT EXISTS file_items_source_entity_uq
  ON file_items(organization_id,source_module,source_entity_type,source_entity_id)
  WHERE source_module IS NOT NULL AND source_entity_type IS NOT NULL AND source_entity_id IS NOT NULL AND deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS file_versions (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  file_item_id TEXT NOT NULL REFERENCES file_items(id) ON DELETE CASCADE,
  version_number INTEGER NOT NULL CHECK(version_number >= 1),
  filename TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  size_bytes BIGINT NOT NULL DEFAULT 0 CHECK(size_bytes >= 0),
  checksum_sha256 TEXT,
  storage_bucket TEXT NOT NULL DEFAULT 'work' CHECK(storage_bucket IN ('work','reports')),
  object_key TEXT NOT NULL,
  preview_object_key TEXT,
  preview_mime_type TEXT,
  preview_size_bytes BIGINT,
  created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(organization_id,file_item_id,version_number)
);
CREATE INDEX IF NOT EXISTS file_versions_item_idx ON file_versions(organization_id,file_item_id,version_number DESC);

CREATE TABLE IF NOT EXISTS file_links (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  file_item_id TEXT NOT NULL REFERENCES file_items(id) ON DELETE CASCADE,
  module_key TEXT,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  label TEXT,
  created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(organization_id,file_item_id,entity_type,entity_id)
);
CREATE INDEX IF NOT EXISTS file_links_entity_idx ON file_links(organization_id,entity_type,entity_id,created_at DESC);

INSERT INTO app_modules(module_key,name,version,description,category,core,manifest_json,active)
VALUES('file-manager','Documents & Files','1.0.0','Unified document library for uploaded, scanned and Ledgerly-generated files with folders, versions, links and previews.','operations',1,'{"standalone":true,"sharedCore":["organizations","users","files"],"features":["folders","uploads","generated-documents","version-history","entity-links","preview-download","archive-trash","source-traceability"]}',1)
ON CONFLICT (module_key) DO UPDATE SET name=EXCLUDED.name,version=EXCLUDED.version,description=EXCLUDED.description,category=EXCLUDED.category,core=EXCLUDED.core,manifest_json=EXCLUDED.manifest_json,active=EXCLUDED.active,updated_at=CURRENT_TIMESTAMP;

INSERT INTO organization_modules(organization_id,module_key,enabled,configuration_json,enabled_at)
SELECT id,'file-manager',1,'{}',CURRENT_TIMESTAMP FROM organizations
ON CONFLICT (organization_id,module_key) DO NOTHING;

-- Backfill already-existing objects into the unified catalog without copying bytes.
INSERT INTO file_items(
  id,organization_id,title,filename,mime_type,size_bytes,checksum_sha256,storage_bucket,object_key,
  preview_object_key,preview_mime_type,preview_size_bytes,source_type,source_module,source_entity_type,source_entity_id,
  status,current_version,metadata_json,created_by,updated_by,created_at,updated_at
)
SELECT
  'fil_ai_'||d.id,d.organization_id,d.title,d.title||'.'||d.format,d.source_mime_type,d.source_size_bytes,d.checksum_sha256,'work',d.source_object_key,
  d.pdf_object_key,'application/pdf',d.pdf_size_bytes,'ai_generated','agentic-employees','generated_document',d.id,
  CASE WHEN d.status='archived' THEN 'archived' ELSE 'active' END,1,'{"backfilled":true}',d.created_by,d.created_by,d.created_at,d.updated_at
FROM ae_generated_documents d WHERE d.status<>'deleted'
ON CONFLICT DO NOTHING;

INSERT INTO file_versions(
  id,organization_id,file_item_id,version_number,filename,mime_type,size_bytes,checksum_sha256,storage_bucket,object_key,
  preview_object_key,preview_mime_type,preview_size_bytes,created_by,created_at
)
SELECT
  'fver_ai_'||d.id,d.organization_id,'fil_ai_'||d.id,1,d.title||'.'||d.format,d.source_mime_type,d.source_size_bytes,d.checksum_sha256,'work',d.source_object_key,
  d.pdf_object_key,'application/pdf',d.pdf_size_bytes,d.created_by,d.created_at
FROM ae_generated_documents d WHERE d.status<>'deleted'
ON CONFLICT DO NOTHING;

INSERT INTO file_items(
  id,organization_id,title,filename,mime_type,size_bytes,checksum_sha256,storage_bucket,object_key,
  source_type,source_module,source_entity_type,source_entity_id,status,current_version,metadata_json,created_by,updated_by,created_at,updated_at
)
SELECT
  'fil_school_'||f.id,f.organization_id,f.original_name,f.original_name,f.mime_type,f.size_bytes,f.checksum_sha256,'reports',f.object_key,
  'school_file','school-management','school_file',f.id,'active',1,'{"backfilled":true}',f.uploaded_by,f.uploaded_by,f.created_at,f.updated_at
FROM school_files f WHERE f.deleted_at IS NULL
ON CONFLICT DO NOTHING;

INSERT INTO file_versions(
  id,organization_id,file_item_id,version_number,filename,mime_type,size_bytes,checksum_sha256,storage_bucket,object_key,created_by,created_at
)
SELECT
  'fver_school_'||f.id,f.organization_id,'fil_school_'||f.id,1,f.original_name,f.mime_type,f.size_bytes,f.checksum_sha256,'reports',f.object_key,f.uploaded_by,f.created_at
FROM school_files f WHERE f.deleted_at IS NULL
ON CONFLICT DO NOTHING;

INSERT INTO file_items(
  id,organization_id,title,filename,mime_type,size_bytes,checksum_sha256,storage_bucket,object_key,
  source_type,source_module,source_entity_type,source_entity_id,status,current_version,metadata_json,created_by,updated_by,created_at,updated_at
)
SELECT
  'fil_scan_'||d.id,d.organization_id,COALESCE(j.title,d.original_name),d.original_name,d.mime_type,d.size_bytes,d.checksum_sha256,'work',d.object_key,
  'scannerly','printerly','scan_document',d.id,'active',1,'{"backfilled":true}',j.created_by,j.created_by,d.created_at,COALESCE(j.completed_at,d.created_at)
FROM prn_scan_documents d JOIN prn_scan_jobs j ON j.id=d.scan_job_id AND j.organization_id=d.organization_id
ON CONFLICT DO NOTHING;

INSERT INTO file_versions(
  id,organization_id,file_item_id,version_number,filename,mime_type,size_bytes,checksum_sha256,storage_bucket,object_key,created_by,created_at
)
SELECT
  'fver_scan_'||d.id,d.organization_id,'fil_scan_'||d.id,1,d.original_name,d.mime_type,d.size_bytes,d.checksum_sha256,'work',d.object_key,j.created_by,d.created_at
FROM prn_scan_documents d JOIN prn_scan_jobs j ON j.id=d.scan_job_id AND j.organization_id=d.organization_id
ON CONFLICT DO NOTHING;
