import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { validateSuite, validateRun, gradeTrial, summarizeRun, inspectSuite, checkReference, reportMarkdown } from '../docs/workspace/eval-engine.mjs';
const cli = fileURLToPath(new URL('../bin/eval-harness.mjs', import.meta.url));
function fixture() {
  return { schemaVersion: 1, id: 'basic', name: 'A bounded example', example: true,
    target: { kind: 'coding-agent', description: 'Configured local adapter', version: 'test-v1' },
    product: { customer: 'A teammate', job: 'Write a result', success: 'The result exists' }, purpose: 'regression',
    environment: { description: 'Fresh local folder', mode: 'pinned', reset: 'fresh-trial', context: '', tools: ['filesystem'], memory: '', dependencies: 'Node 20+', constraints: 'No external services' },
    plan: { trials: 3, k: 3, mix: 'balanced', rationale: 'Check consistency', passRateThreshold: 0.9 },
    tasks: [{ id: 'write', name: 'Write one result', prompt: 'Write the result.', context: '', successCriteria: 'Result exists.', category: 'positive', difficulty: 'easy', customerValue: 'Reliable saved work', weight: 1,
      reference: { description: 'Known good result', output: 'done', outcome: { saved: true } },
      graders: [{ id: 'saved', name: 'Saved result', type: 'code', source: 'outcome', required: true, weight: 1, threshold: 1, check: { operator: 'equals', path: 'saved', expected: true }, rubric: 'Check actual state.', calibration: '' }] }] };
}
function temp(t, suite = fixture()) {
  const dir = mkdtempSync(join(tmpdir(), 'pmstack-harness-test-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const suitePath = join(dir, 'suite.json'); writeFileSync(suitePath, JSON.stringify(suite));
  return { dir, suitePath };
}
function script(dir, name, body) { const path = join(dir, name); writeFileSync(path, body); return { command: [process.execPath, `./${name}`], timeoutMs: 2000 }; }
function invoke(...args) { const result = spawnSync(process.execPath, [cli, ...args], { encoding: 'utf8', timeout: 20000 }); assert.ifError(result.error); assert.equal(result.signal, null); return result; }
function execute(t, suite, build) {
  const { dir, suitePath } = temp(t, suite), config = build(dir), adapterPath = join(dir, 'adapter.json'), output = join(dir, 'results');
  writeFileSync(adapterPath, JSON.stringify(config));
  const result = invoke('run', suitePath, '--adapter', adapterPath, '--output', output);
  const runPath = join(output, 'run.json');
  const run = existsSync(runPath) ? JSON.parse(readFileSync(runPath, 'utf8')) : null;
  if (run) t.after(() => { for (const row of run.trials) rmSync(row.workspace, { recursive: true, force: true }); });
  return { result, run, output, suitePath, adapterPath };
}
const input = "let raw='';for await(const chunk of process.stdin)raw+=chunk;const input=JSON.parse(raw);";

test('schema is strict, bounded, and keeps references separate from execution', () => {
  const suite = validateSuite(fixture()); assert.equal(suite.tasks[0].critical, false); assert.equal(inspectSuite(suite).ready, true); assert.equal(checkReference(suite, 'write').status, 'pass');
  for (const mutate of [s=>{s.command=['bad'];},s=>{s.plan.trials=0;},s=>{s.plan.k=4;},s=>{s.tasks[0].graders=[];},s=>{s.tasks[0].graders[0].check.path='__proto__.x';},s=>{s.tasks.push(structuredClone(s.tasks[0]));}]) { const s=fixture(); mutate(s); assert.throws(()=>validateSuite(s)); }
});
test('bad reference is a task validity issue, not an agent failure', () => { const s=fixture();s.tasks[0].reference.outcome.saved=false;assert.equal(inspectSuite(s).ready,false);assert.equal(checkReference(s,'write').status,'fail'); });
test('required unknown grades cannot be averaged away by passing code', () => {
  const s=fixture();s.tasks[0].graders.push({id:'judgment',name:'Quality',type:'model',source:'output',required:true,weight:1,threshold:0.8,rubric:'Check usefulness',calibration:'Human examples'});
  const evidence={outcome:{saved:true},output:'done'};assert.equal(gradeTrial(s,'write',evidence).status,'unknown');
  evidence.graderResults={judgment:{score:0.5,reason:'Partial success'}};const partial=gradeTrial(s,'write',evidence);assert.equal(partial.status,'fail');assert.equal(partial.score,0.75);
  evidence.graderResults.judgment.score=0.9;assert.equal(gradeTrial(s,'write',evidence).status,'pass');
});
test('code graders check actual values and support all declared operators', () => {
  const s=fixture(),g=s.tasks[0].graders[0];g.source='output';g.check={operator:'contains',path:'',expected:'done'};assert.equal(gradeTrial(s,'write',{output:'not yet'}).status,'fail');
  g.check={operator:'number-range',path:'n',min:2,max:4};assert.equal(gradeTrial(s,'write',{output:{n:3}}).status,'pass');assert.equal(gradeTrial(s,'write',{output:{n:'3'}}).status,'fail');
  g.check={operator:'exists',path:'value'};assert.equal(gradeTrial(s,'write',{output:{value:false}}).status,'pass');assert.equal(gradeTrial(s,'write',{output:{}}).status,'fail');
  assert.equal(gradeTrial(s,'write',{}).status,'unknown');
});
test('repeated metrics keep invalid and unknown trials visible and block decisions', () => {
  const s=fixture();const rows=[{taskId:'write',trial:1,outcome:{saved:true}},{taskId:'write',trial:2,outcome:{saved:false}},{taskId:'write',trial:3}];
  const summary=summarizeRun(s,rows);assert.equal(summary.status,'incomplete');assert.equal(summary.valid,2);assert.equal(summary.passRate,0.5);assert.equal(summary.estimatedPassAtK,0.875);assert.equal(summary.estimatedPassPowerK,0.125);
  rows[2].errors=[{stage:'target',message:'Timed out'}];assert.equal(summarizeRun(s,rows).invalid,1);assert.equal(summarizeRun(s,rows.slice(0,1)).missing,2);assert.throws(()=>summarizeRun(s,[rows[0],rows[0]]));
});
test('critical failures cannot hide behind a low aggregate threshold', () => {const s=fixture();s.tasks[0].critical=true;s.plan.passRateThreshold=0.5;const rows=[1,2,3].map(trial=>({taskId:'write',trial,outcome:{saved:trial!==1}}));const summary=summarizeRun(s,rows);assert.equal(summary.status,'fail');assert.deepEqual(summary.criticalFailed,['write']);});
test('macro and production weights are separate and task slices remain visible', () => {const s=fixture();s.tasks.push({...structuredClone(s.tasks[0]),id:'second',weight:9,category:'negative'});s.plan.mix='production-weighted';const rows=s.tasks.flatMap(task=>[1,2,3].map(trial=>({taskId:task.id,trial,outcome:{saved:task.id!=='write'}})));const result=summarizeRun(s,rows);assert.equal(result.macroPassRate,0.5);assert.equal(result.weightedPassRate,0.9);assert.equal(result.slices.category.negative.passRate,1);});

test('CLI runs repeated trials with isolated folders and an independent observer', t => {
  const {result,run,output,suitePath,adapterPath}=execute(t,fixture(),dir=>({
    setup:script(dir,'setup.mjs',"import fs from 'node:fs';fs.writeFileSync('state.json',JSON.stringify({saved:false}));console.log('{}');"),
    target:script(dir,'target.mjs',`import fs from 'node:fs';${input}if(input.task.reference||input.task.graders||input.reference||input.graders)throw Error('reference leaked');fs.writeFileSync('state.json',JSON.stringify({saved:true}));console.log(JSON.stringify({output:'done',transcript:[{tool:'write',ok:true}]}));`),
    observe:script(dir,'observe.mjs',"import fs from 'node:fs';console.log(JSON.stringify({outcome:JSON.parse(fs.readFileSync('state.json','utf8'))}));")
  }));
  assert.equal(result.status,0,result.stderr);assert.equal(run.trials.length,3);assert.equal(new Set(run.trials.map(t=>t.workspace)).size,3);assert.equal(run.summary.status,'pass');assert.ok(run.trials.every(t=>t.outcome.saved));assert.ok(existsSync(join(output,'report.md')));
  const report=invoke('report',join(output,'run.json'));assert.equal(report.status,0);assert.match(report.stdout,/Example suite/);assert.match(report.stdout,/independent/);
  assert.equal(invoke('run',suitePath,'--adapter',adapterPath,'--output',output).status,2);
});
test('target self-reported outcomes never satisfy an outcome grader', t => {
  const {result,run}=execute(t,fixture(),dir=>({target:script(dir,'target.mjs',"console.log(JSON.stringify({output:'done',outcome:{saved:true},graderResults:{saved:{score:1,reason:'trust me'}}}));")}));
  assert.equal(result.status,1);assert.equal(run.summary.unknown,3);assert.ok(run.trials.every(t=>t.outcome===null));
});
test('observer contradiction beats a confident completion claim', t => {
  const {run}=execute(t,fixture(),dir=>({target:script(dir,'target.mjs',"console.log(JSON.stringify({output:'I saved it.',outcome:{saved:true}}));"),observe:script(dir,'observe.mjs',"console.log(JSON.stringify({outcome:{saved:false}}));")}));
  assert.equal(run.summary.failed,3);assert.equal(run.summary.status,'fail');
});
test('explicit unknown human judgment remains unknown despite successful target', t => {
  const s=fixture();s.tasks[0].graders=[{id:'human',name:'Human review',type:'human',source:'output',required:true,weight:1,threshold:1,rubric:'Review result',calibration:'Two reviewer examples'}];
  const {run}=execute(t,s,dir=>({target:script(dir,'target.mjs',"console.log(JSON.stringify({output:'done'}));"),graders:{human:script(dir,'human.mjs',"console.log(JSON.stringify({status:'unknown',reason:'Awaiting reviewer'}));")}}));assert.equal(run.summary.unknown,3);
});
test('independent model grader gets rubric and evidence, not authority from target scores', t => {
  const s=fixture();s.tasks[0].graders=[{id:'judge',name:'Quality',type:'model',source:'output',required:true,weight:1,threshold:0.8,rubric:'Check clarity',calibration:'Human examples'}];
  const {run}=execute(t,s,dir=>({target:script(dir,'target.mjs',"console.log(JSON.stringify({output:'done',graderResults:{judge:{score:1,reason:'self'}}}));"),graders:{judge:script(dir,'judge.mjs',`${input}if(!input.grader.rubric||!input.reference)throw Error('missing grader context');console.log(JSON.stringify({score:0.4,reason:'Independent partial credit'}));`)}}));assert.equal(run.summary.failed,3);assert.equal(run.trials[0].grades[0].score,0.4);
});
test('setup failure, malformed target, observer failure and timeout are invalid stages', async t => {
  for(const stage of ['setup','target','observe','timeout'])await t.test(stage, t=>{
    const s=fixture();s.plan.trials=1;s.plan.k=1;
    const {result,run}=execute(t,s,dir=>{const config={target:script(dir,'target.mjs',"console.log(JSON.stringify({output:'done'}));")};
      if(stage==='setup')config.setup=script(dir,'bad.mjs','process.exit(7)');
      if(stage==='target')config.target=script(dir,'bad.mjs',"console.log('not-json')");
      if(stage==='observe')config.observe=script(dir,'bad.mjs','process.exit(8)');
      if(stage==='timeout')config.target={...script(dir,'slow.mjs','setInterval(()=>{},1000)'),timeoutMs:100};return config;});
    assert.equal(result.status,1);assert.equal(run.summary.invalid,1);assert.equal(run.summary.valid,0);assert.equal(run.trials[0].errors[0].stage,stage==='timeout'?'target':stage);
  });
});
test('oversized output is bounded and invalid rather than a success', t => {const s=fixture();s.plan.trials=1;s.plan.k=1;const {run}=execute(t,s,dir=>({target:script(dir,'large.mjs',"process.stdout.write('x'.repeat(1100000));")}));assert.equal(run.summary.invalid,1);assert.match(run.trials[0].errors[0].message,/1 MB/);});
test('CLI validates without executing adapters and rejects malformed input', t => {const {dir,suitePath}=temp(t);assert.equal(invoke('validate',suitePath).status,0);const bad=join(dir,'bad.json');writeFileSync(bad,'{bad');assert.equal(invoke('validate',bad).status,2);assert.equal(invoke('run',suitePath).status,2);});


test('saved pass statuses and grades cannot override failing code evidence', () => {
  const suite=fixture();const trials=[1,2,3].map(trial=>({taskId:'write',trial,status:'pass',score:1,grades:[{status:'pass',score:1}],outcome:{saved:false}}));
  const run=validateRun({schemaVersion:1,suite,trials,summary:{status:'pass',passRate:1}});
  assert.equal(run.summary.status,'fail');assert.equal(run.summary.passRate,0);assert.ok(run.trials.every(t=>t.status==='fail'&&t.grades[0].status==='fail'));
  assert.match(reportMarkdown(run),/Decision: \*\*fail/);
});
test('recorded stage errors force invalid even if saved status and evidence claim success', () => {
  const suite=fixture();const trials=[1,2,3].map(trial=>({taskId:'write',trial,status:'pass',outcome:{saved:true},stages:{target:{code:1,error:'Command timed out.'}}}));
  const run=validateRun({schemaVersion:1,suite,trials});assert.equal(run.summary.invalid,3);assert.equal(run.summary.status,'incomplete');assert.equal(run.summary.passRate,null);assert.ok(run.trials.every(t=>t.errors[0].stage==='target'));
});
test('saved passing verdict with no separate observed outcome stays unknown', () => {
  const suite=fixture();const trials=[1,2,3].map(trial=>({taskId:'write',trial,status:'pass',output:'saved',stages:{target:{code:0,stdout:JSON.stringify({output:'saved',outcome:{saved:true}})}}}));
  assert.equal(validateRun({schemaVersion:1,suite,trials}).summary.unknown,3);
});
test('binary code failures cannot pass with threshold zero', () => {
  const suite=fixture();suite.tasks[0].graders[0].threshold=0;
  const result=gradeTrial(suite,'write',{outcome:{saved:false}});assert.equal(result.status,'fail');assert.equal(result.grades[0].score,0);
});
test('CLI report recomputes forged verdicts and fails unresolved execution', t => {
  const {dir}=temp(t),suite=fixture(),path=join(dir,'forged.json');
  const trials=[1,2,3].map(trial=>({taskId:'write',trial,status:'pass',outcome:{saved:false},errors:[{stage:'target',message:'Command timed out.'}],grades:[]}));
  writeFileSync(path,JSON.stringify({schemaVersion:1,suite,trials,summary:{status:'pass'}}));
  const result=invoke('report',path);assert.equal(result.status,1);assert.match(result.stdout,/invalid: 3/);assert.match(result.stdout,/Decision: \*\*incomplete/);assert.match(result.stdout,/unsigned assertions/);
});

test('blank task contract, product promise, or environment blocks readiness', () => {
  for (const key of ['name', 'prompt', 'successCriteria', 'customerValue']) {
    const suite=fixture();suite.tasks[0][key]='  ';
    const result=inspectSuite(suite);assert.equal(result.ready,false,key);assert.ok(result.issues.some(i=>i.level==='error'&&i.taskId==='write'));
  }
  for (const key of ['customer','job','success']) {
    const suite=fixture();suite.product[key]='';
    assert.equal(inspectSuite(suite).ready,false,key);
  }
  const suite=fixture();suite.environment.description='\n';assert.equal(inspectSuite(suite).ready,false);
});
test('missing reproducibility rationale warns without pretending to judge semantic quality', () => {
  const suite=fixture();suite.target.description='';suite.target.version='';suite.plan.rationale='';suite.tasks[0].reference.description='';
  const result=inspectSuite(suite);assert.equal(result.ready,true);assert.ok(result.issues.filter(i=>i.level==='warning').length>=3);
});
