import { classifyFailure } from '../src/importers/claude_api_sync';
const cases: [number,string,string,string,string][] = [
  [401,'application/json','','{"error":"x"}','AUTH_EXPIRED'],
  [403,'application/json','','{"type":"error","error":{"type":"permission_error"}}','AUTH_EXPIRED'],
  [403,'text/html','challenge','<html>Just a moment...</html>','CF_BLOCKED'],
  [403,'text/html','','<html>blocked</html>','CF_BLOCKED'],
  [503,'text/html','','down','TRANSIENT'],
  [429,'application/json','','{}','TRANSIENT'],
  [404,'application/json','','{}','HTTP_ERROR'],
];
let bad=0; for (const [s,ct,cf,b,want] of cases){const e=classifyFailure(s,ct,cf,b); const ok=e.message.startsWith(want); if(!ok)bad++; console.log(ok?'PASS':'FAIL',s,ct,cf||'-','->',e.message.split(' ')[0],'retry='+e.retryable);} process.exit(bad?1:0);
