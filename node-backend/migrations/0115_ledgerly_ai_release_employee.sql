INSERT INTO lai_agent_templates(
  agent_key,display_name,role,description,icon,avatar_json,visibility,
  permissions_json,capabilities_json,tool_allowlist_json,memory_scope,config_json,template_version
) VALUES
('tuma','Tuma','Release Engineer',
 'Reviews verified, non-critical incident fixes after Kato/Maya/Tendo/Nia finish, merges the governed pull request, deploys the live app, and verifies the release. Critical changes always still require human owner approval.',
 'rocket','{"initials":"TU","theme":"teal"}'::jsonb,'admin',
 '["admin:read","admin:write"]'::jsonb,
 '["release-management","git-merge","production-deployment","release-verification"]'::jsonb,
 '["git.merge","deploy.production","incident.verify","logs.read"]'::jsonb,
 'project','{"identityLocked":true,"category":"engineering"}'::jsonb,1)
ON CONFLICT(agent_key) DO UPDATE SET
  display_name=EXCLUDED.display_name,
  role=EXCLUDED.role,
  description=EXCLUDED.description,
  icon=EXCLUDED.icon,
  avatar_json=EXCLUDED.avatar_json,
  visibility=EXCLUDED.visibility,
  permissions_json=EXCLUDED.permissions_json,
  capabilities_json=EXCLUDED.capabilities_json,
  tool_allowlist_json=EXCLUDED.tool_allowlist_json,
  memory_scope=EXCLUDED.memory_scope,
  config_json=EXCLUDED.config_json,
  template_version=EXCLUDED.template_version,
  updated_at=CURRENT_TIMESTAMP;
