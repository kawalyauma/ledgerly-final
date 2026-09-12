WITH defaults(code,name,type,subtype,normal_balance) AS (
  VALUES
    ('1000','Cash and Bank','asset','cash','debit'),
    ('1100','Accounts Receivable','asset','receivable','debit'),
    ('1200','Inventory','asset','inventory','debit'),
    ('2000','Accounts Payable','liability','payable','credit'),
    ('2100','Tax Payable','liability','tax','credit'),
    ('2200','Payroll Payable','liability','payroll','credit'),
    ('3000','Owner''s Equity','equity','equity','credit'),
    ('4000','Sales Revenue','revenue','sales','credit'),
    ('5000','Cost of Goods Sold','expense','cogs','debit'),
    ('6000','Operating Expenses','expense','operating','debit'),
    ('6100','Payroll Expense','expense','payroll','debit')
)
INSERT INTO accounts(id,organization_id,code,name,type,subtype,normal_balance)
SELECT 'acc_' || md5(o.id || ':' || d.code),o.id,d.code,d.name,d.type,d.subtype,d.normal_balance
FROM organizations o CROSS JOIN defaults d
WHERE o.status='active'
ON CONFLICT (organization_id,code) DO NOTHING;

INSERT INTO finance_tenant_provisioning(organization_id,schema_version,status,provisioned_at,updated_at)
SELECT id,1,'completed',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP
FROM organizations
WHERE status='active'
ON CONFLICT (organization_id) DO UPDATE SET
  schema_version=EXCLUDED.schema_version,
  status='completed',
  last_error=NULL,
  provisioned_at=COALESCE(finance_tenant_provisioning.provisioned_at,CURRENT_TIMESTAMP),
  updated_at=CURRENT_TIMESTAMP;

INSERT INTO finance_event_consumptions(event_id,consumer)
SELECT e.id,'finance-core'
FROM backend_outbox_events e
JOIN finance_tenant_provisioning p ON p.organization_id=e.aggregate_id AND p.status='completed'
WHERE e.topic='organization.created'
ON CONFLICT (event_id,consumer) DO NOTHING;
