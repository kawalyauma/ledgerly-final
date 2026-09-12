CREATE TABLE contacts (
  id text PRIMARY KEY,
  organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  type text NOT NULL CHECK (type IN ('customer','supplier','employee','other')),
  code text,
  name text NOT NULL,
  email text,
  tax_number text,
  payment_terms_days integer NOT NULL DEFAULT 0 CHECK (payment_terms_days BETWEEN 0 AND 365),
  custom_fields jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(custom_fields)='object'),
  credit_limit_minor bigint NOT NULL DEFAULT 0 CHECK (credit_limit_minor >= 0),
  pricing_tier text,
  active boolean NOT NULL DEFAULT true,
  archived_at timestamptz,
  merged_into_contact_id text REFERENCES contacts(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX contacts_org_type_name_idx ON contacts (organization_id,type,name);
CREATE INDEX contacts_org_code_idx ON contacts (organization_id,code) WHERE code IS NOT NULL;
CREATE INDEX contacts_org_email_idx ON contacts (organization_id,lower(email)) WHERE email IS NOT NULL;
CREATE INDEX contacts_org_active_idx ON contacts (organization_id,active,name) WHERE archived_at IS NULL;

CREATE TABLE contact_addresses (
  id text PRIMARY KEY,
  organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  contact_id text NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  type text NOT NULL CHECK (type IN ('billing','shipping','registered','other')),
  line1 text NOT NULL,
  line2 text,
  city text,
  state text,
  postal_code text,
  country text NOT NULL CHECK (char_length(country)=2),
  is_default boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX contact_addresses_contact_idx ON contact_addresses (organization_id,contact_id,type);
CREATE UNIQUE INDEX contact_addresses_default_type_uq
  ON contact_addresses (organization_id,contact_id,type) WHERE is_default=true;

CREATE TABLE contact_people (
  id text PRIMARY KEY,
  organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  contact_id text NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  name text NOT NULL,
  email text,
  phone text,
  role text,
  is_primary boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX contact_people_contact_idx ON contact_people (organization_id,contact_id,name);
CREATE INDEX contact_people_phone_idx ON contact_people (organization_id,phone) WHERE phone IS NOT NULL;
CREATE UNIQUE INDEX contact_people_primary_uq
  ON contact_people (organization_id,contact_id) WHERE is_primary=true;
