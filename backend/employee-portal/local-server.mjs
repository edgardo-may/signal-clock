import {createServer} from 'node:http';
import {createEmployeeHandler} from './http.mjs';
const handle=createEmployeeHandler();
createServer((req,res)=>{
 if(req.url.split('?')[0]!=='/api/employee'){res.statusCode=404;res.end();return;}
 return handle(req,res);
}).listen(4004,'127.0.0.1',()=>process.stdout.write('Employee local API: 127.0.0.1:4004\n'));
