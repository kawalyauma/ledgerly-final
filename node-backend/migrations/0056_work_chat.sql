CREATE TABLE work_chat_threads (
  id text PRIMARY KEY,
  organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  task_id text REFERENCES work_tasks(id) ON DELETE SET NULL,
  title text NOT NULL,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','closed','archived')),
  created_by text REFERENCES users(id) ON DELETE SET NULL,
  closed_by text REFERENCES users(id) ON DELETE SET NULL,
  closed_at timestamptz,
  last_message_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX work_chat_threads_org_idx ON work_chat_threads(organization_id,status,last_message_at DESC);

CREATE TABLE work_chat_participants (
  organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  thread_id text NOT NULL REFERENCES work_chat_threads(id) ON DELETE CASCADE,
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  unread_count integer NOT NULL DEFAULT 0 CHECK (unread_count>=0),
  joined_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_read_at timestamptz,
  PRIMARY KEY (organization_id,thread_id,user_id)
);

CREATE TABLE work_chat_messages (
  id text PRIMARY KEY,
  organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  thread_id text NOT NULL REFERENCES work_chat_threads(id) ON DELETE CASCADE,
  sender_user_id text REFERENCES users(id) ON DELETE SET NULL,
  message_type text NOT NULL DEFAULT 'text' CHECK (message_type IN ('text','system','document','image','audio','video')),
  body text,
  file_key text,
  file_name text,
  mime_type text,
  size_bytes bigint,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (body IS NOT NULL OR file_key IS NOT NULL)
);
CREATE INDEX work_chat_messages_thread_idx ON work_chat_messages(organization_id,thread_id,created_at,id);
