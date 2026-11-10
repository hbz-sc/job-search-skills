import hashlib
import json
from pathlib import Path
import sqlite3
from datetime import datetime,timezone
from .diagnostics import safe_metadata

class Journal:
    def __init__(self,path:Path):
        path.parent.mkdir(parents=True,exist_ok=True)
        self.db=sqlite3.connect(path)
        self.db.execute('PRAGMA journal_mode=WAL')
        self.db.execute('CREATE TABLE IF NOT EXISTS actions(id TEXT PRIMARY KEY, run TEXT NOT NULL, fingerprint TEXT NOT NULL, result TEXT NOT NULL)')
        self.db.execute('CREATE TABLE IF NOT EXISTS events(id INTEGER PRIMARY KEY, run TEXT NOT NULL, request TEXT, stage TEXT NOT NULL, at TEXT NOT NULL, meta TEXT NOT NULL)')
        for rid,raw in self.db.execute('SELECT id,result FROM actions').fetchall():
            if json.loads(raw)['phase'] in ('accepted','validated','executing'):
                self.finish(rid,self.unknown(rid,'HOST_RESTARTED'))
    @staticmethod
    def unknown(rid,code='RESULT_UNKNOWN'):
        return {'requestId':rid,'phase':'uncertain','error':{'code':code,'message':'Result unknown; do not replay'},'evidenceIds':[]}
    def accept(self,rid,run,command)->bool:
        fingerprint=hashlib.sha256(json.dumps(command,sort_keys=True,separators=(',',':')).encode()).hexdigest()
        row=self.db.execute('SELECT fingerprint FROM actions WHERE id=?',(rid,)).fetchone()
        if row:
            if row[0]!=fingerprint:raise ValueError('REQUEST_ID_CONFLICT')
            return False
        result={'requestId':rid,'phase':'accepted','evidenceIds':[]}
        with self.db:self.db.execute('INSERT INTO actions VALUES(?,?,?,?)',(rid,run,fingerprint,json.dumps(result)))
        return True
    def finish(self,rid,result):
        with self.db:self.db.execute('UPDATE actions SET result=? WHERE id=?',(json.dumps(result,ensure_ascii=False),rid))
    def result(self,rid):
        row=self.db.execute('SELECT result FROM actions WHERE id=?',(rid,)).fetchone()
        return json.loads(row[0]) if row else self.unknown(rid)
    def run_for_request(self,rid):
        row=self.db.execute('SELECT run FROM actions WHERE id=?',(rid,)).fetchone()
        return row[0] if row else None
    def results_for_run(self,run):
        return [json.loads(row[0]) for row in self.db.execute('SELECT result FROM actions WHERE run=? ORDER BY rowid',(run,))]
    def event(self,run,rid,stage,meta):
        with self.db:
            c=self.db.execute('INSERT INTO events(run,request,stage,at,meta) VALUES(?,?,?,?,?)',(run,rid,stage,datetime.now(timezone.utc).isoformat(),json.dumps(safe_metadata(meta),ensure_ascii=False)))
        return str(c.lastrowid)
    def events(self,run):
        return [{'id':str(r[0]),'requestId':r[1],'stage':r[2],'at':r[3],**json.loads(r[4])} for r in self.db.execute('SELECT id,request,stage,at,meta FROM events WHERE run=? ORDER BY id',(run,))]
    def close(self):self.db.close()
