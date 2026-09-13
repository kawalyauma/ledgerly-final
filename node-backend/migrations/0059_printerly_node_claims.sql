ALTER TABLE prn_jobs ADD COLUMN claim_token_hash text;
ALTER TABLE prn_jobs ADD COLUMN claimed_at timestamptz;
ALTER TABLE prn_jobs ADD COLUMN claim_expires_at timestamptz;
ALTER TABLE prn_jobs ADD COLUMN lease_renewed_at timestamptz;
CREATE INDEX prn_jobs_claim_idx ON prn_jobs(organization_id,node_id,status,claim_expires_at);
