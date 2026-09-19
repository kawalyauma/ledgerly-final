UPDATE lai_agent_templates
   SET role='GitHub Specialist',
       description='Owns governed Git commits, GitHub pull requests, CI tracking, merge readiness, and the handoff to Jabali for deployment.',
       capabilities_json='["git-governance","github-pull-requests","ci-tracking","git-merge","release-handoff"]'::jsonb,
       tool_allowlist_json='["git.commit","git.pull-request","git.ci-status","git.merge","incident.read"]'::jsonb,
       updated_at=CURRENT_TIMESTAMP
 WHERE agent_key='tuma';

UPDATE lai_agents a
   SET role=t.role,
       description=t.description,
       capabilities_json=t.capabilities_json,
       tool_allowlist_json=t.tool_allowlist_json,
       template_version=GREATEST(a.template_version,2),
       updated_at=CURRENT_TIMESTAMP
  FROM lai_agent_templates t
 WHERE t.agent_key='tuma'
   AND a.agent_key='tuma';
