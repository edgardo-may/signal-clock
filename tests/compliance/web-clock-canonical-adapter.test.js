import test from 'node:test';
import assert from 'node:assert/strict';
import {RegistroAttendanceAdapter} from '../../src/domain/attendance/adapters/RegistroAttendanceAdapter.ts';
const record={id:'record',cliente_id:'company',empleado_id:'employee',dispositivo_id:'terminal',verificado_at:'2026-10-11T15:00:00.000Z',tipo_verificacion:'entrada',metodo:'web',source_event_id:'source',raw_payload:{source:'WEB_CLOCK'},es_manual:false};
const device={id:'terminal',cliente_id:'company',timezone:'America/Cancun'};
const proof={registro_id:'record',source_event_id:'source',cliente_id:'company',empleado_id:'employee',device_id:'terminal'};
test('raw WEB_CLOCK label and metodo cannot authorize WEB classification',()=>{
 assert.equal(RegistroAttendanceAdapter.fromRegistro(record,device).rawPunch.source,'ADMS');
 assert.equal(RegistroAttendanceAdapter.fromRegistro({...record,metodo:'huella',raw_payload:{}},device).rawPunch.source,'ADMS');
});
test('verified canonical context classifies WEB without changing punch direction/time',()=>{
 const event=RegistroAttendanceAdapter.fromRegistro(record,device,proof);
 assert.equal(event.rawPunch.source,'WEB');assert.equal(event.rawPunch.timestamp,record.verificado_at);assert.equal(event.rawPunch.inOutState,'entrada');
});
test('canonical adapter context rejects every mismatched identity',()=>{
 for(const key of Object.keys(proof))assert.throws(()=>RegistroAttendanceAdapter.fromRegistro(record,device,{...proof,[key]:'foreign'}));
});
