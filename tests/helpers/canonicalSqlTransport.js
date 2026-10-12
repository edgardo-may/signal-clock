// Test transport only: actual SQL rows and actual existing RPC, no simulated engine.
import pg from 'pg';
const ident=value=>{if(!/^[a-z_][a-z_0-9]*$/.test(value))throw Error('UNSAFE_TEST_IDENTIFIER');return '"'+value+'"';};
export function canonicalSqlTransport(db){
 return {
  from(table){
   let fields='*',where=[],params=[],order=[],limit='';
   const filter=(field,operator,value)=>{params.push(value);where.push(`${ident(field)} ${operator} $${params.length}`);return query;};
   async function execute(single=false){
    try{
     const sql=`SELECT ${fields} FROM public.${ident(table)}${where.length?' WHERE '+where.join(' AND '):''}${order.length?' ORDER BY '+order.join(','):''}${limit}`;
     const rows=JSON.parse(JSON.stringify((await db.query({text:sql,values:params,types:{getTypeParser(oid,format){
      if(oid===1184)return value=>value.replace(' ','T').replace(/([+-][0-9]{2})$/,'$1:00');
      if(oid===1082)return value=>value;
      return pg.types.getTypeParser(oid,format);
     }}})).rows));
     // PostgREST encodes PostgreSQL date as YYYY-MM-DD, not a JS Date timestamp.
     for(const row of rows)for(const key of ['fecha_inicio','fecha_fin','effective_from'])if(typeof row[key]==='string')row[key]=row[key].slice(0,10);
     if(single&&rows.length>1)return {data:null,error:{code:'MULTIPLE_ROWS'}};
     return {data:single?rows[0]||null:rows,error:null};
    }catch(error){return {data:null,error};}
   }
   const query={
    select(value){fields=value.split(',').map(x=>ident(x.trim())).join(',');return this;},
    eq(field,value){return filter(field,'=',value);},gte(field,value){return filter(field,'>=',value);},lte(field,value){return filter(field,'<=',value);},
    in(field,values){params.push(values);where.push(`${ident(field)}=ANY($${params.length})`);return this;},
    order(field,{ascending=true}={}){order.push(ident(field)+(ascending?' ASC':' DESC'));return this;},
    limit(value){if(!Number.isInteger(value)||value<0)throw Error('INVALID_TEST_LIMIT');limit=' LIMIT '+value;return this;},
    maybeSingle(){return execute(true);},then(resolve,reject){return execute().then(resolve,reject);},
   };return query;
  },
  async rpc(name,args){
   if(name!=='upsert_workday_record')throw Error('UNEXPECTED_TEST_RPC');
   await db.query('SAVEPOINT transport_rpc');
   try{const keys=Object.keys(args);return {data:(await db.query(`SELECT * FROM public.${ident(name)}(${keys.map((k,i)=>ident(k)+' => $'+(i+1)).join(',')})`,keys.map(k=>args[k]))).rows,error:null};}
   catch(error){await db.query('ROLLBACK TO SAVEPOINT transport_rpc');return {data:null,error};}
   finally{await db.query('RELEASE SAVEPOINT transport_rpc');}
  },
 };
}
