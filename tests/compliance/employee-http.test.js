import test from 'node:test';
import assert from 'node:assert/strict';
import {createEmployeeHandler} from '../../backend/employee-portal/http.mjs';
const env={EMPLOYEE_ORIGIN:'https://clock.example',EMPLOYEE_RATE_PEPPER:'test-only-pepper-with-at-least-32-characters'};
const company='11111111-1111-4111-8111-111111111111';
async function invoke(action,{body,method='POST',headers={},result={success:true},cookie}={}){
 const calls=[],response={headers:{},setHeader(k,v){this.headers[k]=v;},end(value){this.body=JSON.parse(value);}};
 const handler=createEmployeeHandler({env,random:n=>Buffer.alloc(n,7),client:{rpc:async(name,args)=>{calls.push({name,args});return {data:result};}}});
 await handler({url:'/api/employee?action='+action,method,headers:{origin:env.EMPLOYEE_ORIGIN,'content-type':'application/json',...(cookie?{cookie}:{}),...headers},body,socket:{remoteAddress:'127.0.0.1'}},response);
 return {...response,calls};
}
test('login creates secure HttpOnly cookie and sends only token hash to DB',async()=>{
 const res=await invoke('login',{body:{clienteId:company,clave:'EMP',pin:'12345'}});
 assert.equal(res.statusCode,200);assert.match(res.headers['Set-Cookie'],/HttpOnly; SameSite=Strict; Max-Age=28800; Secure/);
 assert.equal(res.calls[0].args.p_input.token_hash.length,64);assert.notEqual(res.calls[0].args.p_input.token_hash,'07'.repeat(32));assert.ok(!JSON.stringify(res.body).includes('12345'));
});
test('cross-origin login denied before database call',async()=>{const r=await invoke('login',{headers:{origin:'https://attacker.example'},body:{}});assert.equal(r.statusCode,403);assert.equal(r.calls.length,0);});
test('arbitrary anonymous caller has no verified session',async()=>{const r=await invoke('session',{method:'GET'});assert.equal(r.statusCode,401);assert.equal(r.calls.length,0);});
test('browser identity and authoritative timestamp keys rejected',async()=>{
 for(const property of ['empleado_id','cliente_id','timestamp','verificado_at']){
  const r=await invoke('punch',{cookie:'__Host-sc_employee='+'ab'.repeat(32),body:{direction:'entrada',clockSlug:'cancun',requestId:company,evidence:{},[property]:company}});
  assert.equal(r.statusCode,400);assert.equal(r.calls.length,0);
 }
});
test('punch uses session cookie and strips untrusted GPS time',async()=>{
 const r=await invoke('punch',{cookie:'__Host-sc_employee='+'ab'.repeat(32),body:{direction:'entrada',clockSlug:'cancun',requestId:company,evidence:{ubicacion_gps:{latitud:0,longitud:0,precision_metros:5,timestamp:1,mapa_url:'https://attacker.example'}}}});
 assert.equal(r.statusCode,200);assert.deepEqual(r.calls[0].args.p_input.evidence.ubicacion_gps,{latitud:0,longitud:0,precision_metros:5});assert.ok(!('cliente_id' in r.calls[0].args.p_input));
});
test('invalid GPS and duplicate cookies denied',async()=>{
 const cookie='__Host-sc_employee='+'ab'.repeat(32);
 const r=await invoke('punch',{cookie,body:{direction:'entrada',clockSlug:'cancun',requestId:company,evidence:{ubicacion_gps:{latitud:100,longitud:0,precision_metros:5}}}});assert.equal(r.statusCode,400);assert.equal(r.calls.length,0);
 assert.equal((await invoke('session',{method:'GET',cookie:cookie+'; '+cookie})).statusCode,401);
});
test('failed login has generic response and no session cookie',async()=>{const r=await invoke('login',{body:{clienteId:company,clave:'EMP',pin:'99999'},result:{success:false,error:'LOGIN_DENIED'}});assert.equal(r.statusCode,401);assert.equal(r.headers['Set-Cookie'],undefined);});
test('logout revokes server session and clears cookie',async()=>{const r=await invoke('logout',{body:{},cookie:'__Host-sc_employee='+'ab'.repeat(32)});assert.equal(r.calls[0].args.p_action,'LOGOUT');assert.match(r.headers['Set-Cookie'],/Max-Age=0/);});
