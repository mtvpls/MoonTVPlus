INSERT INTO users (username, password_hash, role, banned, tags, oidc_sub, enabled_apis, created_at, playrecord_migrated, favorite_migrated, skip_migrated)
VALUES ('lizhi123le', 'a3caeaf44ff4b53ec823e728688a0f45e8a467c4b3ca114b034027c94de7fcea', 'owner', 0, NULL, NULL, NULL, 1770491500000, 1, 1, 1)
ON CONFLICT(username) DO UPDATE SET password_hash = excluded.password_hash, role = 'owner';
