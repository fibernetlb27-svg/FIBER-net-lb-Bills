'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const deploy=path.resolve(__dirname,'../deploy');
function unit(name){
 const result={};let section='';
 for(const raw of fs.readFileSync(path.join(deploy,name),'utf8').split(/\r?\n/)){
  const text=raw.trim();if(!text||text.startsWith('#'))continue;
  const heading=text.match(/^\[([^\]]+)\]$/);if(heading){section=heading[1];assert(!result[section],'Duplicate unit section.');result[section]={};continue;}
  const setting=text.match(/^([A-Za-z][A-Za-z0-9]*)=(.*)$/);assert(setting&&section,'Unit directives must belong to a section.');const key=setting[1],rows=result[section][key]||[];rows.push(setting[2]);result[section][key]=rows;
 }
 return result;
}
function one(value,section,key){const rows=value[section]?.[key];assert.equal(rows?.length,1,section+'.'+key+' is unambiguous');return rows[0];}
function words(value,section,key){return one(value,section,key).split(/\s+/).filter(Boolean);}
function seconds(value){assert.match(value,/^\d+s$/);return Number(value.slice(0,-1));}
const recovery=unit('fibernetlb-boot-recovery.service'),attest=unit('fibernetlb-recovery-attest.service'),timer=unit('fibernetlb-recovery-attest.timer');
test('boot recovery waits for Docker and networking, retries within a bounded budget and respects the drain deadline',()=>{
 assert.equal(one(recovery,'Service','Type'),'oneshot');assert.equal(one(recovery,'Service','RemainAfterExit'),'yes');assert.equal(one(recovery,'Service','Restart'),'on-failure');
 assert(words(recovery,'Unit','Requires').includes('docker.service'));assert(words(recovery,'Unit','After').includes('docker.service'));assert(words(recovery,'Unit','After').includes('network-online.target'));assert(words(recovery,'Unit','Wants').includes('network-online.target'));
 assert.equal(one(recovery,'Install','WantedBy'),'multi-user.target');
 const interval=seconds(one(recovery,'Unit','StartLimitIntervalSec')),burst=Number(one(recovery,'Unit','StartLimitBurst')),delay=seconds(one(recovery,'Service','RestartSec'));
 assert(interval>=60&&interval<=600);assert(Number.isSafeInteger(burst)&&burst>=1&&burst<=3);assert(delay>=15&&delay<interval);assert(seconds(one(recovery,'Service','TimeoutStartSec'))>=720+90);
});
test('recovery and healthy attestation use the same nonblocking kernel lock without a shell or a second recovery mode',()=>{
 const commands=[recovery,attest].map(value=>words(value,'Service','ExecStart'));
 for(const command of commands){assert.deepEqual(command.slice(0,6),['/usr/bin/flock','--no-fork','--nonblock','/srv/fibernetlb/private/power-recovery.guard.lock','/opt/fibernetlb/runtime/node24/bin/node','/opt/fibernetlb/power-recovery/power-recovery.cjs']);assert.deepEqual(command.slice(6,8),['--config','/etc/fibernetlb/power-recovery.json']);assert.equal(command.length,9);assert(!command.some(arg=>/[;|&`$]/.test(arg)),'No shell interpolation is part of the service command.');}
 assert.equal(commands[0][8],'--recover');assert.equal(commands[1][8],'--attest');
});
test('attestation timer can repeat a short healthy-only oneshot independently of the completed recovery unit',()=>{
 assert.equal(one(attest,'Service','Type'),'oneshot');assert.equal(one(attest,'Service','RemainAfterExit'),'no');assert.equal(attest.Service.Restart,undefined);assert(seconds(one(attest,'Service','TimeoutStartSec'))<=90);
 assert(words(attest,'Unit','After').includes('fibernetlb-boot-recovery.service'));assert.equal(one(timer,'Timer','Unit'),'fibernetlb-recovery-attest.service');assert.equal(one(timer,'Install','WantedBy'),'timers.target');
 assert(seconds(one(timer,'Timer','OnBootSec'))>=60);assert.equal(seconds(one(timer,'Timer','OnUnitInactiveSec')),60);assert(seconds(one(timer,'Timer','AccuracySec'))<=5);assert.equal(timer.Timer.OnCalendar,undefined,'Healthy attestation does not depend on the real-time clock.');
});
test('recovery units retain host evidence visibility and constrain writes to the private deployment directory',()=>{
 for(const value of [recovery,attest]){
  assert.equal(one(value,'Service','User'),'root');assert.equal(one(value,'Service','Group'),'root');assert.equal(one(value,'Service','UMask'),'0077');assert.equal(one(value,'Service','NoNewPrivileges'),'yes');assert.equal(one(value,'Service','ProtectSystem'),'strict');assert.deepEqual(words(value,'Service','ReadWritePaths'),['/srv/fibernetlb/private']);assert.equal(one(value,'Service','ProtectHome'),'yes');
  assert.equal(one(value,'Service','ProtectProc'),'default');assert.equal(one(value,'Service','ProcSubset'),'all');assert.equal(value.Service.PrivateUsers,undefined);assert.equal(value.Service.InaccessiblePaths,undefined);assert.equal(value.Service.SystemCallFilter,undefined);
  assert(value.Service.Environment.includes('DOCKER_HOST=unix:///var/run/docker.sock'));assert(value.Service.Environment.includes('DOCKER_CONFIG=/etc/fibernetlb/docker-client'));assert(value.Service.Environment.includes('NODE_OPTIONS='));assert(value.Service.Environment.includes('NODE_PATH='));
  assert.equal(one(value,'Service','StandardOutput'),'journal');assert.equal(one(value,'Service','StandardError'),'journal');
 }
});
