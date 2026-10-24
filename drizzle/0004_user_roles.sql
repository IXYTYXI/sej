ALTER TABLE users ADD COLUMN role TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('admin', 'user'));
UPDATE users SET role='admin' WHERE id='owner';
