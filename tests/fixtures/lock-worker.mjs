import {acquireRunLock} from '../../src/run-lock.ts';
try {const release=await acquireRunLock(process.argv[2]);process.send?.('acquired');const timer=setInterval(()=>{},1000);process.on('message',async()=>{await release();await release();clearInterval(timer);process.exit(0);});}
catch {process.send?.('refused');process.exit(0);}
