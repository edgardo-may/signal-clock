import {createEmployeeHandler} from '../backend/employee-portal/http.mjs';

const handleEmployeeRequest=createEmployeeHandler();

// Vercel invokes one stateless Node.js function per request. All auth, session,
// and attendance rules remain in the shared Employee handler and SQL RPC.
export default function employee(req,res){
  return handleEmployeeRequest(req,res);
}
