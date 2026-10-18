const {test}=require('node:test');
const assert=require('node:assert/strict');
const {spawn}=require('node:child_process');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {once}=require('node:events');
test('reservation lifecycle, authentication, privacy, validation and restart persistence',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'roadster-test-'));
 let child,base,cookie;
 const password='Test-only-password-83592!';
 async function start(){
  child=spawn(process.execPath,['server.js'],{cwd:path.join(__dirname,'..'),env:{...process.env,NODE_ENV:'test',PORT:'0',ADMIN_PASSWORD:password,SESSION_SECRET:'test-secret-'.repeat(5),DATABASE_FILE:path.join(dir,'test.sqlite')},stdio:['ignore','pipe','pipe']});
  base=await new Promise((resolve,reject)=>{let output='';child.stdout.on('data',x=>{output+=x;const m=output.match(/listening on port (\d+)/);if(m)resolve('http://127.0.0.1:'+m[1]);});child.once('exit',code=>reject(Error('server exited '+code)));child.stderr.on('data',()=>{});});
 }
 async function stop(){const ended=once(child,'exit');child.kill();await ended;}
 async function req(url,method='GET',body,admin=false){return fetch(base+url,{method,headers:{...(body?{'Content-Type':'application/json'}:{}),...(admin?{'X-Requested-With':'RoadsterAdmin',Cookie:cookie||''}:{})},body:body?JSON.stringify(body):undefined});}
 try{
  await start();
  for(let i=0;i<85;i++) assert.equal((await req('/api/health')).status,200);
  assert.equal((await req('/api/admin/stats')).status,401);
  assert.equal((await req('/api/admin/login','POST',{username:'admin',password})).status,403);
  let r=await req('/api/admin/login','POST',{username:'admin',password:'wrong'},true);assert.equal(r.status,401);
  r=await req('/api/admin/login','POST',{username:'admin',password},true);assert.equal(r.status,200);
  cookie=r.headers.get('set-cookie');assert.match(cookie,/HttpOnly/i);assert.match(cookie,/SameSite=Strict/i);cookie=cookie.split(';')[0];assert.equal((await r.json()).token,undefined);
  const data={firstName:'Demo',lastName:'Tester',email:'demo@example.com',country:'Other',configuration:'Performance',demoAcknowledged:true};
  assert.equal((await req('/api/reservations','POST',{...data,demoAcknowledged:false})).status,400);
  assert.equal((await req('/api/reservations','POST',{...data,configuration:'Invented'})).status,400);
  assert.equal((await req('/api/reservations','POST',{...data,email:'invalid'})).status,400);
  assert.equal((await req('/api/reservations','POST',{...data,firstName:'x'.repeat(61)})).status,400);
  r=await req('/api/reservations','POST',data);assert.equal(r.status,201);const record=(await r.json()).reservation;assert.match(record.reference,/^RD-[A-F0-9]{24}$/);
  r=await req('/api/reservations/'+record.reference);assert.equal(r.headers.get('cache-control'),'no-store');let publicData=await r.json();assert.equal(publicData.reservation.email,undefined);assert.equal(publicData.reservation.firstName,undefined);
  r=await req('/api/admin/reservations?search=demo@example.com','GET',null,true);assert.equal((await r.json()).total,1);
  assert.equal((await req('/api/admin/reservations/'+record.reference,'PATCH',{status:'confirmed'})).status,403);
  assert.equal((await req('/api/admin/reservations/'+record.reference,'PATCH',{status:'confirmed'},true)).status,200);
  await stop();await start();
  r=await req('/api/reservations/'+record.reference);assert.equal((await r.json()).reservation.status,'confirmed');
  r=await req('/api/admin/stats','GET',null,true);assert.equal((await r.json()).total,1);
  assert.equal((await req('/api/admin/export')).status,401);
  r=await req('/api/admin/export','GET',null,true);assert.match(r.headers.get('content-disposition'),/attachment/);const backup=await r.json();assert.equal(backup.reservations[0].reference,record.reference);assert.equal(backup.reservations[0].token_hash,undefined);
  assert.equal((await req('/api/missing')).status,404);
  assert.equal((await req('/.env')).status,404);
  assert.equal((await req('/api/admin/logout','POST',{},true)).status,200);
  assert.equal((await req('/api/admin/stats','GET',null,true)).status,401);
 }finally{if(child?.exitCode===null)await stop();fs.rmSync(dir,{recursive:true,force:true});}
});
