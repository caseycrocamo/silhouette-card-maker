const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { PassThrough } = require('node:stream');
const { createCardWorkerClient, resolveCardWorker } = require('../GUI/Utilities/cardWorkerClient');
function fake() {
  const child = new EventEmitter();
  child.stdout = new PassThrough(); child.stderr = new PassThrough(); child.stdin = new PassThrough();
  child.kill = () => { queueMicrotask(() => child.emit('close',0)); };
  return child;
}
test('card worker correlates responses and surfaces worker errors', async () => {
  const child = fake();
  const client = createCardWorkerClient({ launch: () => child, resolve: () => ({command:'worker',args:[]}), env:{} });
  const result = client.request({op:'parse',text:'x'});
  child.stdout.write('{"id":1,"result":{"entries":[]}}\n');
  assert.deepEqual(await result, {entries:[]});
  const error = client.request({op:'invalid'});
  child.stdout.write('{"id":2,"error":"Invalid operation"}\n');
  await assert.rejects(error,/Invalid operation/);
  client.stop();
});
test('crash rejects all pending jobs and next request starts a new worker', async () => {
  const children=[];
  const client=createCardWorkerClient({launch:()=>{const c=fake();children.push(c);return c;},resolve:()=>({command:'w',args:[]}),env:{}});
  const first=client.request({op:'parse'});
  children[0].emit('close',1);
  await assert.rejects(first,/stopped/);
  const second=client.request({op:'parse'});
  assert.equal(children.length,2);
  children[1].stdout.write('{"id":2,"result":{"ok":true}}\n');
  assert.deepEqual(await second,{ok:true});client.stop();
});
test('stop rejects requests and packaged lookup never falls back to Python', async () => {
  const client=createCardWorkerClient({launch:fake,resolve:()=>({command:'w',args:[]}),env:{}});
  const task=client.request({op:'parse'}); client.stop(); await assert.rejects(task,/stopped/);
  const target=resolveCardWorker({packaged:true,resourcesPath:'/resources',platform:'win32'});
  assert.equal(target.command,require('node:path').join('/resources','bin','card_worker.exe')); assert.deepEqual(target.args,[]);
});
test('request timeout kills stalled work and allows a fresh request', async () => {
  const children=[];
  const client=createCardWorkerClient({launch:()=>{const c=fake();children.push(c);return c;},resolve:()=>({command:'w',args:[]}),env:{},timeoutMs:5});
  await assert.rejects(client.request({op:'parse'}),/timed out/);
  const next=client.request({op:'parse'});
  children[1].stdout.write('{"id":2,"result":{"entries":[]}}\n');
  assert.deepEqual(await next,{entries:[]});await client.stop();
});

test('bulk imports have their own deadline for long decks', async () => {
  const child = fake();
  const client = createCardWorkerClient({ launch: () => child,
    resolve: () => ({ command: 'worker', args: [] }), env: {}, timeoutMs: 1, importTimeoutMs: 1000 });
  const request = client.request({ op: 'import', game: 'lorcana' });
  await new Promise(resolve => setTimeout(resolve, 5));
  child.stdout.write('{"id":1,"result":{"status":"success","entries":[]}}\n');
  assert.equal((await request).status, 'success');
  await client.stop();
});

test('development uses source despite existing binaries; packaged apps keep their binary', t => {
  const previous = process.env.SCM_DEV_PYTHON;
  t.after(() => { if (previous === undefined) delete process.env.SCM_DEV_PYTHON; else process.env.SCM_DEV_PYTHON = previous; });
  process.env.SCM_DEV_PYTHON = '/chosen/python';
  const target = resolveCardWorker({ packaged: false });
  assert.equal(target.command, '/chosen/python');
  assert.equal(target.args[0], require('node:path').resolve(__dirname, '../card_worker.py'));
  const packaged = resolveCardWorker({ packaged: true, resourcesPath: '/resources' });
  assert.equal(packaged.args.length, 0);
  assert.notEqual(packaged.command, '/chosen/python');
});

test('progress records keep the import pending until its final response',async()=>{
  const child=fake(),updates=[];
  const client=createCardWorkerClient({launch:()=>child,resolve:()=>({command:'worker',args:[]}),env:{}});
  let settled=false;
  const result=client.request({op:'import',game:'mtg'},progress=>updates.push(progress));
  result.then(()=>{settled=true;});
  assert.equal(JSON.parse(child.stdin.read().toString()).streamProgress,true);
  child.stdout.write(JSON.stringify({id:1,type:'progress',progress:{completed:1,total:2,entries:[{id:'one'}]}})+'\n');
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(settled,false);
  assert.equal(updates[0].completed,1);
  child.stdout.write('{"id":1,"result":{"entries":[{"id":"one"},{"id":"two"}]}}\n');
  assert.equal((await result).entries.length,2);
  await client.stop();
});
