import {spawn} from 'node:child_process';
import {mkdir,writeFile} from 'node:fs/promises';
const tests=[
 'global-security-final-gate-dbreal.test.js',
 'employee-web-clock-dbreal.test.js',
 'employee-http.test.js',
 'employee-global-security-regression-dbreal.test.js',
 'employee-biometric-regression-dbreal.test.js',
 'employee-horarios-regression-dbreal.test.js',
 'employee-punch-flow.test.js',
 'attendance-engine.test.js',
 'attendance-runtime-v3-persist.test.js',
 'phase-26-adapters.test.js',
 'web-clock-canonical-adapter.test.js',
].map(name=>'tests/compliance/'+name);
const child=spawn(process.execPath,['--test','--test-concurrency=1','--test-reporter=tap',...tests],{cwd:new URL('../',import.meta.url),stdio:['ignore','pipe','pipe']});
let log='';child.stdout.on('data',chunk=>{log+=chunk;});child.stderr.on('data',chunk=>{log+=chunk;});
child.on('error',error=>{console.error(error.code||'TEST_RUNNER_FAILED');process.exitCode=1;});
child.on('close',async code=>{
 await mkdir('outputs',{recursive:true});await writeFile('outputs/employee-local-matrix.tap',log);
 const counts={};for(const key of ['tests','pass','fail','skipped','cancelled']) counts[key]=Number(log.match(new RegExp('^# '+key+' (\\d+)','m'))?.[1]??NaN);
 await writeFile('outputs/employee-local-matrix.json',JSON.stringify({timestamp:new Date().toISOString(),...counts,exitCode:code},null,2)+'\n');
 console.log(JSON.stringify(counts));
 if(code!==0||counts.fail!==0||counts.skipped!==0||counts.cancelled!==0||!Number.isFinite(counts.tests)){console.error('CLOSURE_GATE_NOT_MET: inspect outputs/employee-local-matrix.tap');process.exitCode=1;}
});
