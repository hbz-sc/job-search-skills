from pathlib import Path
import os
import subprocess
import sys
import unittest
import uuid
import winreg

ROOT=Path(__file__).resolve().parents[3]
class RegistrationTests(unittest.TestCase):
    def test_dry_run_apply_and_exact_uninstall(self):
        name='com.jobsearch.boss_bridge.test_'+uuid.uuid4().hex
        key='Software\\Google\\Chrome\\NativeMessagingHosts\\'+name
        env={k:v for k,v in os.environ.items() if k.lower()!='psmodulepath'}
        def run(script,*args):
            return subprocess.run(['powershell.exe','-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',str(ROOT/'scripts'/script),'-HostName',name,*args],capture_output=True,env=env)
        try:
            result=run('register-boss-bridge.ps1');self.assertEqual(result.returncode,0,result.stderr)
            with self.assertRaises(FileNotFoundError):winreg.OpenKey(winreg.HKEY_CURRENT_USER,key)
            result=run('register-boss-bridge.ps1','-Apply');self.assertEqual(result.returncode,0,result.stderr)
            with winreg.OpenKey(winreg.HKEY_CURRENT_USER,key) as handle:
                value=winreg.QueryValueEx(handle,'')[0];self.assertTrue(Path(value).exists())
            result=run('unregister-boss-bridge.ps1','-Apply');self.assertEqual(result.returncode,0,result.stderr)
            with self.assertRaises(FileNotFoundError):winreg.OpenKey(winreg.HKEY_CURRENT_USER,key)
        finally:
            # Only this generated test key and its test manifest are owned here.
            try:winreg.DeleteKey(winreg.HKEY_CURRENT_USER,key)
            except FileNotFoundError:pass
            (ROOT/'private/boss-extension/hosts'/f'{name}.json').unlink(missing_ok=True)
