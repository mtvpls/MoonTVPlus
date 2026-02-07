
INSERT INTO users (username, password_hash, role, banned, tags, oidc_sub, enabled_apis, created_at, playrecord_migrated, favorite_migrated, skip_migrated)
VALUES ('lizhi', '5e884898da28047151d0e56f8dc6292773603d0d6aabbdd62a11ef721d1542d8', 'owner', 0, NULL, NULL, NULL, 1770491489932, 1, 1, 1)
ON CONFLICT(username) DO UPDATE SET password_hash = excluded.password_hash, role = 'owner';
