export const schema = `
 PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;
 CREATE TABLE IF NOT EXISTS runs(id TEXT PRIMARY KEY, accountKey TEXT NOT NULL, config TEXT NOT NULL, templateHash TEXT, createdAt TEXT NOT NULL, stopReason TEXT, evidence TEXT);
 CREATE TABLE IF NOT EXISTS jobs(key TEXT PRIMARY KEY, url TEXT NOT NULL, data TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS templates(hash TEXT PRIMARY KEY, text TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS attempts(id TEXT PRIMARY KEY, runId TEXT NOT NULL REFERENCES runs(id), accountKey TEXT NOT NULL, jobKey TEXT NOT NULL, templateHash TEXT NOT NULL, phase TEXT NOT NULL, conversationKey TEXT, conversationUrl TEXT, evidence TEXT, updatedAt TEXT NOT NULL, UNIQUE(accountKey,jobKey));
 CREATE INDEX IF NOT EXISTS attempts_conversation ON attempts(accountKey,conversationKey);
`;
