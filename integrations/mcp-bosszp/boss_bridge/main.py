"""Chrome owns this process; EOF shuts it down without touching browser tabs."""
import argparse
import asyncio
import base64
import hashlib
import json
import logging
import os
from pathlib import Path
import socket
import sys
import threading
import uvicorn
from .native import encode_native,read_native
from .session import Session,HostLock,publish_discovery,secure_directory
from .journal import Journal
from .tools import Bridge
from .server import create_app

ROOT=Path(__file__).resolve().parents[3]

async def serve(root:Path):
    secure_directory(root)
    with HostLock(root/'host.lock'):
        sock=socket.socket();sock.bind(('127.0.0.1',0))
        session=Session(port=sock.getsockname()[1])
        journal=Journal(root/'actions.sqlite')
        def send(value):
            sys.stdout.buffer.write(encode_native(value));sys.stdout.buffer.flush()
        bridge=Bridge(journal,send,root)
        server=uvicorn.Server(uvicorn.Config(create_app(session,bridge),log_config=None,access_log=False,log_level='warning',lifespan='on',timeout_graceful_shutdown=3))
        serving=asyncio.create_task(server.serve(sockets=[sock]));discovery=None
        loop=asyncio.get_running_loop();ended=asyncio.Event()
        def deliver(message):
            try:bridge.receive(message)
            except Exception:
                journal.event('session',None,'native_protocol_error',{'code':'INVALID_NATIVE_MESSAGE'})
                bridge.disconnect();ended.set()
        def eof():bridge.disconnect();ended.set()
        def reader():
            try:
                while (message:=read_native(sys.stdin.buffer)) is not None:loop.call_soon_threadsafe(deliver,message)
            except Exception:
                # No raw native messages or tokens in exception logs.
                logging.error('NATIVE_INPUT_FAILED')
            finally:loop.call_soon_threadsafe(eof)
        try:
            while not server.started:
                if serving.done():await serving;raise RuntimeError('HTTP_START_FAILED')
                await asyncio.sleep(.02)
            session.ready=True;discovery=publish_discovery(root,session)
            send({'kind':'ready','protocolVersion':1,'sessionId':session.id,'writeEnabled':False})
            threading.Thread(target=reader,daemon=True).start()
            ending=asyncio.create_task(ended.wait())
            await asyncio.wait([ending,serving],return_when=asyncio.FIRST_COMPLETED)
            ending.cancel()
        finally:
            bridge.disconnect();server.should_exit=True
            await serving
            if discovery and discovery.exists():
                try:
                    if json.loads(discovery.read_text())['sessionId']==session.id:discovery.unlink()
                except (OSError,ValueError,KeyError):pass
            journal.close();sock.close()

def main():
    parser=argparse.ArgumentParser();parser.add_argument('origin',nargs='?');parser.add_argument('--root');parser.add_argument('--parent-window')
    args=parser.parse_args()
    if not args.root:
        key=json.loads((ROOT/'extensions/boss-page/manifest.json').read_text(encoding='utf-8'))['key']
        digest=hashlib.sha256(base64.b64decode(key)).hexdigest()[:32]
        extension_id=''.join(chr(ord('a')+int(c,16)) for c in digest)
        if args.origin!=f'chrome-extension://{extension_id}/':raise SystemExit('CALLER_ORIGIN_REJECTED')
    if os.name=='nt':
        import msvcrt
        msvcrt.setmode(sys.stdin.fileno(),os.O_BINARY);msvcrt.setmode(sys.stdout.fileno(),os.O_BINARY)
    logging.basicConfig(stream=sys.stderr,level=logging.WARNING,format='%(levelname)s %(message)s')
    asyncio.run(serve(Path(args.root).resolve() if args.root else ROOT/'private/boss-extension'))

if __name__=='__main__':main()
