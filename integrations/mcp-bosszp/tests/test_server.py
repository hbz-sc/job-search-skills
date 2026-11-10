from pathlib import Path
import sys
import tempfile
import unittest
from starlette.testclient import TestClient

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from boss_bridge.session import Session, HostLock, publish_discovery
from boss_bridge.server import create_app

class ServerTests(unittest.TestCase):
    def test_server_rejects_missing_wrong_credentials_host_origin_session(self):
        session = Session(port=19234)
        app = create_app(session, None)
        good={'Authorization': 'Bearer '+session.token, 'Host':'127.0.0.1:19234', 'X-Boss-Session':session.id}
        with TestClient(app) as client:
            for changes in [{'Authorization':''},{'Authorization':'Bearer wrong'},{'Host':'evil.test'},{'Origin':'https://evil.test'},{'X-Boss-Session':'old'}]:
                response=client.get('/health',headers={**good,**changes})
                self.assertEqual(response.status_code,403)
            self.assertEqual(client.get('/health',headers=good).json()['sessionId'],session.id)

    def test_single_host_lock_and_discovery_not_published_early(self):
        with tempfile.TemporaryDirectory() as td:
            root=Path(td)
            with HostLock(root/'host.lock'):
                with self.assertRaises(RuntimeError):
                    with HostLock(root/'host.lock'): pass
            with HostLock(root/'host.lock'): pass
            session=Session(port=19234)
            with self.assertRaises(RuntimeError): publish_discovery(root,session)
            self.assertFalse((root/'discovery.json').exists())
            session.ready=True
            path=publish_discovery(root,session)
            self.assertIn(session.id,path.read_text())
            self.assertNotIn(session.token,repr(session))

if __name__=='__main__':unittest.main()
