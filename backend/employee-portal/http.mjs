import {createHash, randomBytes} from 'node:crypto';
import {createClient} from '@supabase/supabase-js';

const ACTIONS={directory:['GET','DIRECTORY'],session:['GET','STATE'],login:['POST','LOGIN'],punch:['POST','PUNCH'],logout:['POST','LOGOUT']};
const MAX_BODY=240000;
const bad=(code,status=400)=>Object.assign(new Error(code),{status,code});
const hash=value=>createHash('sha256').update(value).digest('hex');
function onlyKeys(object,keys){
  if(!object || Array.isArray(object) || typeof object!=='object' || Object.keys(object).some(k=>!keys.includes(k))) throw bad('INVALID_REQUEST');
}
async function readBody(req){
  if(!String(req.headers['content-type']||'').toLowerCase().startsWith('application/json')) throw bad('JSON_REQUIRED',415);
  if(req.body!==undefined){
    const raw=typeof req.body==='string'?req.body:JSON.stringify(req.body);
    if(Buffer.byteLength(raw)>MAX_BODY) throw bad('REQUEST_TOO_LARGE',413);
    try{return JSON.parse(raw);}catch{throw bad('INVALID_REQUEST');}
  }
  let raw='';
  for await(const chunk of req){raw+=chunk;if(Buffer.byteLength(raw)>MAX_BODY) throw bad('REQUEST_TOO_LARGE',413);}
  try{return JSON.parse(raw||'{}');}catch{throw bad('INVALID_REQUEST');}
}
function tokenFromCookie(req,name){
  const found=String(req.headers.cookie||'').split(';').map(s=>s.trim()).filter(s=>s.startsWith(name+'='));
  if(found.length!==1) return null;
  const token=found[0].slice(name.length+1);
  return /^[a-f0-9]{64}$/.test(token)?token:null;
}
export function validateEvidence(value){
  onlyKeys(value,['ubicacion_gps','snapshot','foto_tomada']);
  const gps=value.ubicacion_gps;
  onlyKeys(gps,['latitud','longitud','precision_metros','altitud','timestamp','mapa_url']);
  if(!Number.isFinite(gps.latitud)||Math.abs(gps.latitud)>90||!Number.isFinite(gps.longitud)||Math.abs(gps.longitud)>180
    || !Number.isFinite(gps.precision_metros)||gps.precision_metros<0) throw bad('GPS_REQUIRED');
  const snapshot=value.snapshot;
  if(snapshot!=null && (typeof snapshot!=='string'||snapshot.length>180000||!/^data:image\/(jpeg|png);base64,[a-zA-Z0-9+/=]+$/.test(snapshot))) throw bad('PHOTO_INVALID');
  return {ubicacion_gps:{latitud:gps.latitud,longitud:gps.longitud,precision_metros:gps.precision_metros},snapshot:snapshot||null,foto_tomada:Boolean(snapshot)};
}
export function createEmployeeHandler({env=process.env,client,random=randomBytes}={}){
  return async function handler(req,res){
    res.setHeader('Cache-Control','no-store');
    res.setHeader('Content-Type','application/json; charset=utf-8');
    const send=(status,value)=>{res.statusCode=status;res.end(JSON.stringify(value));};
    try{
      // This deployment-time gate is independent of the Employee schema, so it
      // can be enabled before the release migrations are applied.
      if(env.EMPLOYEE_PORTAL_MAINTENANCE==='true'){
        return send(503,{success:false,error:'EMPLOYEE_PORTAL_MAINTENANCE',message:'El Portal del Empleado está temporalmente en mantenimiento.'});
      }
      const origin=new URL(env.EMPLOYEE_ORIGIN);
      const loopback=['localhost','127.0.0.1','[::1]'].includes(origin.hostname);
      const insecure=env.EMPLOYEE_ALLOW_INSECURE_LOOPBACK_COOKIE==='true' && loopback && env.NODE_ENV!=='production';
      if(origin.origin!==env.EMPLOYEE_ORIGIN || (origin.protocol!=='https:'&&!insecure) || !env.EMPLOYEE_RATE_PEPPER || env.EMPLOYEE_RATE_PEPPER.length<32) throw bad('SERVER_CONFIG_REQUIRED',503);
      const cookieName=insecure?'sc_local_employee':'__Host-sc_employee';
      const cookie=(token,maxAge)=>`${cookieName}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${insecure?'':'; Secure'}`;
      const url=new URL(req.url,'http://internal.invalid');
      const action=url.searchParams.get('action')||'session';
      if([...url.searchParams.keys()].some(k=>!['action','clock'].includes(k)) || url.searchParams.getAll('action').length>1 || url.searchParams.getAll('clock').length>1) throw bad('INVALID_REQUEST');
      const contract=ACTIONS[action];
      if(!contract) throw bad('NOT_FOUND',404);
      if(req.method!==contract[0]) throw bad('METHOD_NOT_ALLOWED',405);
      if(req.method==='POST' && (req.headers.origin!==origin.origin || req.headers['sec-fetch-site']==='cross-site')) throw bad('ORIGIN_DENIED',403);
      const rpcClient=client||createClient(env.SUPABASE_URL,env.SUPABASE_SERVICE_ROLE_KEY||env.SUPABASE_SECRET_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
      let input={},createdToken;
      if(action==='login'){
        const body=await readBody(req);
        onlyKeys(body,['clienteId','clave','pin','clockSlug']);
        if(typeof body.clienteId!=='string'||!/^[a-f0-9-]{36}$/i.test(body.clienteId)||typeof body.clave!=='string'||body.clave.trim().length<1||body.clave.length>100||typeof body.pin!=='string'||!/^[0-9]{5}$/.test(body.pin)) throw bad('LOGIN_DENIED',401);
        createdToken=random(32).toString('hex');
        // Vercel supplies this protected header; local server trusts socket only.
        const remote=env.VERCEL?String(req.headers['x-vercel-forwarded-for']||'unknown'):String(req.socket?.remoteAddress||'unknown');
        input={cliente_id:body.clienteId,clave:body.clave.trim(),pin:body.pin,token_hash:hash(createdToken),source_hash:hash(env.EMPLOYEE_RATE_PEPPER+':'+remote),clock_slug:body.clockSlug||null};
      }else if(action!=='directory'){
        const token=tokenFromCookie(req,cookieName);
        if(!token) throw bad('SESSION_DENIED',401);
        input={token_hash:hash(token),clock_slug:url.searchParams.get('clock')||null};
        if(action==='punch'){
          const body=await readBody(req);
          onlyKeys(body,['direction','clockSlug','requestId','evidence']);
          if(!['entrada','salida','descanso_inicio','descanso_fin'].includes(body.direction)||typeof body.requestId!=='string'||!/^[a-f0-9-]{36}$/i.test(body.requestId)||typeof body.clockSlug!=='string') throw bad('INVALID_REQUEST');
          input={...input,direction:body.direction,clock_slug:body.clockSlug,request_id:body.requestId,evidence:validateEvidence(body.evidence)};
        }else if(action==='logout'){onlyKeys(await readBody(req),[]);}
      }
      const {data,error}=await rpcClient.rpc('fn_employee_portal',{p_action:contract[1],p_input:input});
      if(error || !data) throw bad('PORTAL_UNAVAILABLE',503);
      if(data.success!==true){
        if(action==='logout' && data.error==='SESSION_DENIED') {
          res.setHeader('Set-Cookie',cookie('',0));
          return send(200,{success:true});
        }
        const status=data.rate_limited?429:action==='login'||data.error==='SESSION_DENIED'?401:403;
        return send(status,{success:false,error:action==='login'?'LOGIN_DENIED':data.error});
      }
      if(createdToken) res.setHeader('Set-Cookie',cookie(createdToken,8*60*60));
      if(action==='logout') res.setHeader('Set-Cookie',cookie('',0));
      send(200,data);
    }catch(error){send(error.status||503,{success:false,error:error.status?error.code:'PORTAL_UNAVAILABLE'});}
  };
}
