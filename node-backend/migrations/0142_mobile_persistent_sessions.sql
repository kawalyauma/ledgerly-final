-- Academics mobile sessions remain signed in until explicit logout or revocation.
-- Existing Android refresh tokens are upgraded so installed apps are not forced out.
UPDATE sessions
SET expires_at = GREATEST(expires_at, CURRENT_TIMESTAMP + INTERVAL '100 years'),
    updated_at = CURRENT_TIMESTAMP
WHERE revoked_at IS NULL
  AND user_agent ILIKE 'okhttp/%';
