from dataclasses import dataclass, field
import json
import os
from pathlib import Path
import secrets
import subprocess
import uuid

@dataclass
class Session:
    port: int
    id: str = field(default_factory=lambda: str(uuid.uuid4()))
    token: str = field(default_factory=lambda: secrets.token_urlsafe(32), repr=False)
    ready: bool = False

def secure_directory(path: Path):
    path.mkdir(parents=True, exist_ok=True)
    if os.name == 'nt':
        script=Path(__file__).resolve().parents[3]/'scripts'/'secure-boss-directory.ps1'
        # PowerShell 7's inherited module path cannot be loaded by Windows PowerShell 5.
        env={k:v for k,v in os.environ.items() if k.lower()!='psmodulepath'}
        subprocess.run(['powershell.exe','-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',str(script),'-Path',str(path.resolve())],check=True,capture_output=True,creationflags=subprocess.CREATE_NO_WINDOW,env=env)
    else:
        path.chmod(0o700)

def publish_discovery(root: Path, session: Session) -> Path:
    if not session.ready:
        raise RuntimeError('HOST_NOT_READY')
    secure_directory(root)
    temp=root/(session.id+'.tmp')
    temp.write_text(json.dumps({'protocolVersion':1,'sessionId':session.id,'port':session.port,'token':session.token,'pid':os.getpid()}),encoding='utf-8')
    if os.name != 'nt': temp.chmod(0o600)
    path=root/'discovery.json'
    os.replace(temp,path)
    return path

class HostLock:
    def __init__(self,path:Path): self.path=path;self.file=None
    def __enter__(self):
        self.path.parent.mkdir(parents=True,exist_ok=True)
        self.file=self.path.open('a+b')
        self.file.seek(0,2)
        if self.file.tell()==0:self.file.write(b'0');self.file.flush()
        self.file.seek(0)
        try:
            if os.name=='nt':
                import msvcrt
                msvcrt.locking(self.file.fileno(),msvcrt.LK_NBLCK,1)
            else:
                import fcntl
                fcntl.flock(self.file,fcntl.LOCK_EX|fcntl.LOCK_NB)
        except OSError:
            self.file.close();self.file=None
            raise RuntimeError('HOST_BUSY') from None
        return self
    def __exit__(self,*args):
        if self.file:self.file.close();self.file=None
