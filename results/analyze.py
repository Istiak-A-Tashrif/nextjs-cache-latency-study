#!/usr/bin/env python3
"""Audit all primary traces, aggregate runs, regenerate manuscript tables and figures."""
from pathlib import Path
import json,collections,statistics,hashlib,re,csv,sys
import numpy as np
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
from matplotlib.patches import FancyBboxPatch
ROOT=Path(__file__).resolve().parents[1];RAW=ROOT/'results/raw';OUT=ROOT/'results/derived';OUT.mkdir(exist_ok=True)
FIG=ROOT/'manuscript/figures';FIG.mkdir(parents=True,exist_ok=True)
def read(name):
 p=RAW/name
 return [json.loads(x) for x in p.read_text().splitlines() if x.strip()] if p.exists() else []
prefix='smoke' if '--smoke' in sys.argv else 'primary'
runs=[x for x in read('runs.jsonl') if x['run'].startswith(prefix+'-')]
manifest=json.loads((RAW/(prefix+'-manifest.json')).read_text())
assert len(runs)==len(manifest['configs']),f'Incomplete primary sweep: {len(runs)}/{len(manifest["configs"])}'
assert len({r['run'] for r in runs})==len(runs),'Duplicate completed run'
fields=('seed','delay','mode','fe','be')
assert collections.Counter(tuple(x[k] for k in fields) for x in runs)==collections.Counter(tuple(x[k] for k in fields) for x in manifest['configs']),'Manifest/cell mismatch'
browser=read('browser.jsonl');api=read('api.jsonl');B=collections.defaultdict(list);A=collections.defaultdict(list)
for x in browser:B[x['run']].append(x)
for x in api:A[x['run']].append(x)
rng=np.random.default_rng(20261020)
def ci(values):
 v=np.array(values,float);return [float(v.mean()),*map(float,np.percentile(v[rng.integers(0,len(v),(10000,len(v)))].mean(axis=1),[2.5,97.5]))]
def fmt(v):return f'{v[0]:.1f} [{v[1]:.1f}, {v[2]:.1f}]'
groups=collections.defaultdict(list);audit=[];per_run=[];anomalies=[];action_audit=[]
for r in runs:
 b=B[r['run']];a=A[r['run']]
 assert len(b)==7,(r['run'],'browser observations',len(b))
 assert not any(x.get('error') for x in a),(r['run'],'API error')
 assert not any(x.get('errors') for x in b),(r['run'],'browser error')
 byid={x['id']:x for x in a};assert len(byid)==len(a),'Duplicate API ID'
 assert len(a)==(3 if r['mode']=='ssr' and r['fe'] else 4 if r['mode']=='csr' and r['fe'] else 7),(r['run'],'unexpected API count',len(a))
 seenkeys=set();replays=0
 for x in a:
  expect='off' if not r['be'] else 'hit' if x['page'] in seenkeys else 'miss'
  assert x['outcome']==expect,(r['run'],x,expect)
  assert (x['dbMs'] is None)==(expect=='hit')
  seenkeys.add(x['page'])
 seen={};
 for x in b:
  assert x['response'] in byid,(r['run'],'response missing API provenance')
  assert x['visibleMs']>=x['domMs']>=0
  scope=x['session'] if r['mode']=='csr' else 'shared';key=(scope,x['page'])
  expected_replay=r['fe'] and key in seen
  if expected_replay:
   assert x['response']==seen[key],(r['run'],'front cache did not replay')
   replays+=1
  else:
   assert x['response'] not in seen.values(),(r['run'],'unexpected replay with cache off')
  action_audit.append({'run':r['run'],'session':x['session'],'step':x['step'],'page':x['page'],'response':x['response'],'upper':'hit' if expected_replay else 'miss' if r['fe'] else 'off','redis':None if expected_replay else byid[x['response']]['outcome'],'db_executed':False if expected_replay else byid[x['response']]['dbMs'] is not None})
  seen[key]=x['response']
  assert (x['product']-1)//25+1==x['page']
 categories={'first':[x['visibleMs'] for x in b if x['session']==0 and x['step']==0],
 'repeat_initial':[x['visibleMs'] for x in b if x['session']==1],
 'navigation':[x['visibleMs'] for x in b if x['step']>0]}
 row={**r,'api_requests':len(a),'db_queries':sum(x['dbMs'] is not None for x in a),'front_replays':replays,
 'redis_hits':sum(x['outcome']=='hit' for x in a),'redis_misses':sum(x['outcome']=='miss' for x in a),
 'mean_service_ms':statistics.mean(x['serviceMs'] for x in a),'cache_bytes':sum(x['cacheBytes'] for x in {x['page']:x for x in a}.values()),
 **{k:statistics.mean(v) for k,v in categories.items()}}
 per_run.append(row);groups[(r['delay'],r['mode'],r['fe'],r['be'])].append(row)
 audit.append({'run':r['run'],'status':'PASS','api_requests':len(a),'frontend_replays':replays,'redis_hits':row['redis_hits'],'redis_misses':row['redis_misses']})
if prefix=='smoke':
 (OUT/'smoke-cache-audit.json').write_text(json.dumps(audit,indent=2));print('Smoke PASS: all cache outcomes, provenance and endpoints verified.');sys.exit(0)
startup_all=read('startup-runs.jsonl');startup_failures=read('startup-failures.jsonl')
failed_pairs={x['pair'] for x in startup_failures}
complete_pairs={x['pair'] for x in startup_all if x['state']=='warm'}-failed_pairs
startup=[x for x in startup_all if x['pair'] in complete_pairs]
assert len(startup)==48,'Startup companion sweep incomplete'
startup_groups=collections.defaultdict(dict)
for r in startup:
 b=B[r['run']];a=A[r['run']];assert len(b)==7
 expected=3 if r['mode']=='ssr' and r['fe'] else 4 if r['fe'] else 7
 assert len(a)==expected,(r['run'],'startup API count')
 assert not any(x.get('errors') for x in b) and not any(x.get('error') for x in a)
 seenkeys=set()
 for x in a:
  expect='off' if not r['be'] else 'hit' if x['page'] in seenkeys else 'miss'
  assert x['outcome']==expect and (x['dbMs'] is None)==(expect=='hit')
  seenkeys.add(x['page'])
 ids={x['id'] for x in a};seen={}
 for x in b:
  assert x['response'] in ids and x['visibleMs']>=x['domMs']>=0
  key=(x['session'] if r['mode']=='csr' else 'shared',x['page'])
  if r['fe'] and key in seen:assert seen[key]==x['response']
  else:assert x['response'] not in seen.values()
  seen[key]=x['response']
 first=next(x['visibleMs'] for x in b if x['session']==0 and x['step']==0)
 startup_groups[(r['mode'],r['fe'],r['be'],r['seed'])][r['state']]=first
startup_summary=[]
for mode in ['csr','ssr']:
 for fe in [False,True]:
  for be in [False,True]:
   pairs=[v for k,v in startup_groups.items() if k[:3]==(mode,fe,be)]
   assert len(pairs)==3 and all(set(v)=={'cold','warm'} for v in pairs)
   startup_summary.append({'mode':mode,'fe':fe,'be':be,'pairs':3,'cold_mean_ms':statistics.mean(v['cold'] for v in pairs),'warm_mean_ms':statistics.mean(v['warm'] for v in pairs),'paired_cold_minus_warm_ms':[v['cold']-v['warm'] for v in pairs]})
(OUT/'startup-summary.json').write_text(json.dumps(startup_summary,indent=2))
(OUT/'startup-cache-audit.json').write_text(json.dumps([{'run':r['run'],'status':'PASS','api_requests':len(A[r['run']]),'redis_hits':sum(x['outcome']=='hit' for x in A[r['run']]),'redis_misses':sum(x['outcome']=='miss' for x in A[r['run']])} for r in startup],indent=2))
summary=[]
for (d,m,f,b),rows in sorted(groups.items()):
 summary.append({'delay':d,'mode':m,'fe':f,'be':b,'n':len(rows),
 **{k:ci([x[k] for x in rows]) for k in ['first','repeat_initial','navigation','mean_service_ms','cache_bytes']},
 'api_per_action':sum(x['api_requests'] for x in rows)/(7*len(rows)),
 'db_per_action':sum(x['db_queries'] for x in rows)/(7*len(rows)),
 'front_replays':sum(x['front_replays'] for x in rows),
 'redis_hits':sum(x['redis_hits'] for x in rows),'redis_misses':sum(x['redis_misses'] for x in rows)})
(OUT/'action-cache-audit.jsonl').write_text(''.join(json.dumps(x)+'\n' for x in action_audit))
(OUT/'summary.json').write_text(json.dumps(summary,indent=2));(OUT/'per-run.json').write_text(json.dumps(per_run,indent=2));(OUT/'cache-audit.json').write_text(json.dumps(audit,indent=2))
with (OUT/'per-run.csv').open('w') as f:
 fields=['run','seed','delay','mode','fe','be','first','repeat_initial','navigation','mean_service_ms','api_requests','db_queries','front_replays','redis_hits','redis_misses','cache_bytes'];w=csv.DictWriter(f,fieldnames=fields,extrasaction='ignore');w.writeheader();w.writerows(per_run)
# SQL truth is captured only after own DB has fully loaded.
sql=[json.loads(l) for l in (RAW/'sql-check.txt').read_text().splitlines() if l.startswith('{')]
counts=next(x for x in sql if 'reviews'in x);correct=next(x for x in sql if x.get('check')=='all_product_aggregates');legacy=next(x['legacy_count_mismatches'] for x in sql if 'legacy_count_mismatches'in x)
assert correct['mismatches']==0 and correct['rows']==counts['products']
# Figure 1: the two evaluated request paths, drawn separately because F means a different cache in each mode.
plt.rcParams.update({'font.size':10,'pdf.fonttype':42,'font.family':'Times New Roman'})
fig,ax=plt.subplots(figsize=(7.0,3.6));ax.axis('off');ax.set_xlim(0,10);ax.set_ylim(0,5)
def box(x,y,w,h,label,color):
 ax.add_patch(FancyBboxPatch((x,y),w,h,boxstyle='round,pad=0.08',facecolor=color,edgecolor='#333'));ax.text(x+w/2,y+h/2,label,ha='center',va='center',fontsize=9)
def arrow(x0,x1,y):ax.annotate('',xy=(x1,y),xytext=(x0,y),arrowprops={'arrowstyle':'->'})
ax.text(.05,4.85,'CSR path (F = TanStack Query in the browser)',fontsize=10,fontweight='bold',va='center')
box(.1,3.4,2.2,1,'Browser\nTanStack Query\n(optional reuse)','#e8f1fb');box(3.2,3.4,2.0,1,'Express API','#fff0d8');box(5.9,3.4,1.8,1,'Redis\n(R)','#fde7e7');box(8.4,3.4,1.4,1,'PostgreSQL','#eee8f5')
for x0,x1 in [(2.4,3.1),(5.3,5.8),(7.8,8.3)]:arrow(x0,x1,3.9)
ax.text(.05,2.65,'SSR path (F = Next.js server data cache)',fontsize=10,fontweight='bold',va='center')
box(.1,1.2,2.2,1,'Browser\nHTML + RSC','#e8f1fb');box(2.9,1.2,2.0,1,'Next.js server\ndata cache (F)','#e5f3e5');box(5.3,1.2,1.4,1,'Express API','#fff0d8');box(7.0,1.2,1.1,1,'Redis\n(R)','#fde7e7');box(8.5,1.2,1.3,1,'PostgreSQL','#eee8f5')
for x0,x1 in [(2.4,2.8),(5.0,5.2),(6.8,6.95),(8.15,8.45)]:arrow(x0,x1,1.7)
ax.text(4.9,.55,'Client outgoing traffic: tc netem delay; internal links unshaped.',ha='center',fontsize=9)
ax.text(4.9,.15,'A route request can remain on the path when an upper cache avoids the API request.',ha='center',fontsize=9,color='#555')
fig.tight_layout();fig.savefig(FIG/'architecture.pdf',bbox_inches='tight');fig.savefig(FIG/'architecture.png',dpi=300,bbox_inches='tight');plt.close(fig)
# Figure 2 covers all ablation cells without duplicating the compact 170 ms table.
fig,axs=plt.subplots(1,2,figsize=(7,3.3),sharey=True)
colors=['#333333','#c47812','#2878a8','#198754']
for ax,mode in zip(axs,['csr','ssr']):
 for (fe,be),color,style,marker in zip([(False,False),(False,True),(True,False),(True,True)],colors,['-','--','-.',':'],['o','s','^','x']):
  s=sorted([x for x in summary if x['mode']==mode and x['fe']==fe and x['be']==be],key=lambda x:x['delay']);xx=[x['delay'] for x in s];v=np.array([x['navigation'] for x in s]);
  ax.errorbar(xx,v[:,0],yerr=[v[:,0]-v[:,1],v[:,2]-v[:,0]],label=f'F={int(fe)}, R={int(be)}',marker=marker,linestyle=style,markersize=6,markerfacecolor='none',markeredgewidth=1.2,capsize=3,color=color)
 ax.set_title(mode.upper());ax.set_xlabel('Client-egress delay (ms)');ax.set_xticks([0,40,170]);ax.grid(alpha=.2)
axs[0].set_ylabel('Repeat navigation data-visible time (ms)');axs[1].legend(fontsize=10);fig.tight_layout();fig.savefig(FIG/'navigation.pdf');fig.savefig(FIG/'navigation.png',dpi=300);plt.close(fig)
# All displayed numeric material is injected into the manuscript from these artifacts.
table='| Mode | F | R | First initial (ms) | Fresh-session revisit (ms) | Navigation (ms) |\n|--------|---:|---:|---------------------------:|---------------------------:|---------------------------:|\n'
for x in summary:
 if x['delay']==170:table+=f'| {x["mode"].upper()} | {int(x["fe"])} | {int(x["be"])} | {fmt(x["first"])} | {fmt(x["repeat_initial"])} | {fmt(x["navigation"])} |\n'
cache='| Mode | F | R | API requests/action | DB queries/action | Redis hit / reached |\n|--------|---:|---:|-------------------------:|-------------------------:|-------------------------------:|\n'
for x in summary:
 if x['delay']==0:cache+=f'| {x["mode"].upper()} | {int(x["fe"])} | {int(x["be"])} | {x["api_per_action"]:.3f} | {x["db_per_action"]:.3f} | '+(f'{x["redis_hits"]}/{x["redis_hits"]+x["redis_misses"]}' if x['be'] else 'disabled')+' |\n'
rtt='| Configured client-egress delay (ms) | TCP to Next.js (ms) | TCP to API (ms) |\n|---:|---:|---:|\n'
for d in manifest['delays']:
 rr=[x for x in runs if x['delay']==d];rtt+=f'| {d} | {fmt(ci([x["tcp"]["client_web"]["median"] for x in rr]))} | {fmt(ci([x["tcp"]["client_api"]["median"] for x in rr]))} |\n'
# Independent of per-cell data-visible summaries, keep service outcomes separate.
service={}
for outcome in ['off','miss','hit']:
 means=[statistics.mean(x['serviceMs'] for x in A[r['run']] if x['outcome']==outcome) for r in runs if any(x['outcome']==outcome for x in A[r['run']])];service[outcome]=ci(means)
# Descriptive paired all-cache versus no-cache navigation effects; no significance language.
effects={}
for mode in ['csr','ssr']:
 rows=[x for x in per_run if x['mode']==mode and x['delay']==170];base={x['seed']:x for x in rows if not x['fe'] and not x['be']};on={x['seed']:x for x in rows if x['fe'] and x['be']};effects[mode]=ci([on[s]['navigation']-base[s]['navigation'] for s in base])
# Action-class reanalysis: classify every browser action from its observed page sequence and audited cache path.
audit_by=collections.defaultdict(dict)
for x in action_audit:audit_by[x['run']][(x['session'],x['step'])]=x
CLASSES=[('first_initial','First initial'),('new_key','New key, same session'),('revisit','Same-session revisit'),('fresh_initial','Fresh-session initial')]
class_rows=[]
for r in runs:
 seen_pages=set();rec=collections.defaultdict(list)
 for x in sorted(B[r['run']],key=lambda x:(x['session'],x['step'])):
  if x['session']==1:c='fresh_initial'
  elif x['step']==0:c='first_initial'
  else:c='revisit' if x['page'] in seen_pages else 'new_key'
  if x['session']==0:seen_pages.add(x['page'])
  au=audit_by[r['run']][(x['session'],x['step'])]
  rec[c].append((x['visibleMs'],au['upper']!='hit',au['db_executed']))
 assert {k:len(v) for k,v in rec.items()}=={'first_initial':1,'new_key':2,'revisit':3,'fresh_initial':1},(r['run'],'unexpected action-class mix')
 for c,v in rec.items():class_rows.append({'run':r['run'],'seed':r['seed'],'delay':r['delay'],'mode':r['mode'],'fe':r['fe'],'be':r['be'],'class':c,'actions':len(v),'visible_ms':statistics.mean(q[0] for q in v),'api_per_action':statistics.mean(q[1] for q in v),'db_per_action':statistics.mean(q[2] for q in v)})
# The overall navigation mean is the workload-weighted mix of the new-key and revisit classes (2 and 3 of its 5 actions).
cr={(x['run'],x['class']):x for x in class_rows}
for x in per_run:assert abs(x['navigation']-(2*cr[(x['run'],'new_key')]['visible_ms']+3*cr[(x['run'],'revisit')]['visible_ms'])/5)<1e-9,x['run']
class_summary=[]
for (d,m,f,b) in sorted(groups):
 for c,_ in CLASSES:
  rows=[x for x in class_rows if (x['delay'],x['mode'],x['fe'],x['be'],x['class'])==(d,m,f,b,c)];assert len(rows)==30
  class_summary.append({'delay':d,'mode':m,'fe':f,'be':b,'class':c,'runs':len(rows),'visible_ms':ci([x['visible_ms'] for x in rows]),'api_per_action':statistics.mean(x['api_per_action'] for x in rows),'db_per_action':statistics.mean(x['db_per_action'] for x in rows)})
(OUT/'action-class-summary.json').write_text(json.dumps(class_summary,indent=2))
with (OUT/'per-run-action-class.csv').open('w') as f:
 w=csv.DictWriter(f,fieldnames=list(class_rows[0]));w.writeheader();w.writerows(class_rows)
cname=dict(CLASSES)
def cs(d,m,f,b,c):return next(x for x in class_summary if (x['delay'],x['mode'],x['fe'],x['be'],x['class'])==(d,m,f,b,c))
action_table='| Mode | F | R | New key, ms [95% CI] | Revisit, ms [95% CI] | Revisit API requests | Revisit DB queries |\n|---|---:|---:|---:|---:|---:|---:|\n'
for m in ['csr','ssr']:
 for f in [False,True]:
  for b in [False,True]:
   nk=cs(170,m,f,b,'new_key');rv=cs(170,m,f,b,'revisit');assert nk['api_per_action']==1 and nk['db_per_action']==1
   action_table+=f'| {m.upper()} | {int(f)} | {int(b)} | {fmt(nk["visible_ms"])} | {fmt(rv["visible_ms"])} | {rv["api_per_action"]:.2f} | {rv["db_per_action"]:.2f} |\n'
# Paired all-caches minus no-caches contrasts by action class; runs are paired by seed and the run is the resampling unit.
def class_pair(mode,delay,c):
 g=lambda f,b:{x['seed']:x['visible_ms'] for x in class_rows if (x['mode'],x['delay'],x['fe'],x['be'],x['class'])==(mode,delay,f,b,c)}
 on,off=g(True,True),g(False,False);assert on.keys()==off.keys() and len(on)==30
 return ci([on[k]-off[k] for k in sorted(on)])
paired_class={}
pair_table='| Delay, ms | Mode | New key, same session | Same-session revisit | Overall navigation | Fresh-session initial |\n|---:|---|---:|---:|---:|---:|\n'
for d in manifest['delays']:
 for m in ['csr','ssr']:
  cells=[class_pair(m,d,c) for c in ['new_key','revisit']]
  rows=[x for x in per_run if x['mode']==m and x['delay']==d];base={x['seed']:x for x in rows if not x['fe'] and not x['be']};on={x['seed']:x for x in rows if x['fe'] and x['be']}
  nav=ci([on[k]['navigation']-base[k]['navigation'] for k in base]);fresh=class_pair(m,d,'fresh_initial')
  paired_class[(d,m)]={'new_key':cells[0],'revisit':cells[1],'navigation':nav,'fresh_initial':fresh}
  pair_table+=f'| {d} | {m.upper()} | {fmt(cells[0])} | {fmt(cells[1])} | {fmt(nav)} | {fmt(fresh)} |\n'
(OUT/'paired-class-contrasts.json').write_text(json.dumps({f'{d}-{m}':v for (d,m),v in paired_class.items()},indent=2))
# Five spot-check targets; manual arithmetic is recorded separately.
spot=[{'kind':'dataset','reviews':counts['reviews']},{'kind':'first_initial','run':runs[0]['run'],'value':B[runs[0]['run']][0]['visibleMs']},{'kind':'navigation_mean','run':runs[0]['run'],'value':statistics.mean(x['visibleMs'] for x in B[runs[0]['run']] if x['step']>0)},{'kind':'api_count','run':runs[0]['run'],'value':len(A[runs[0]['run']])},{'kind':'all_cache_db_queries','run':next(x['run'] for x in per_run if x['fe'] and x['be'] and x['mode']=='ssr'),'value':3}]
(OUT/'spot-check-targets.json').write_text(json.dumps(spot,indent=2))
# Warm-up/drift evidence: first and last ten run means within each cell, never exclusions.
drift=[]
for key,rr in sorted(groups.items()):
 ordered=sorted(rr,key=lambda x:x['order']);drift.append({'cell':str(key),'early_mean':statistics.mean(x['navigation'] for x in ordered[:10]),'late_mean':statistics.mean(x['navigation'] for x in ordered[-10:])})
(OUT/'drift.json').write_text(json.dumps(drift,indent=2))
batches=read('batches.jsonl')
failures=read('failures.jsonl');excluded={x['run'] for x in failures}
assert not excluded.intersection(x['run'] for x in runs),'An excluded attempt was accepted'
accepted_ids={x['run'] for x in runs}|{x['run'] for x in startup}
flagged=[x for x in batches if x.get('pgrep')!='empty']
for x in flagged:
 args=' '.join(x.get('args',[]))
 assert not any(('\"run\":\"'+rid+'\"') in args for rid in accepted_ids),'Accepted browser run has a guard flag'
(OUT/'exclusions.json').write_text(json.dumps({'failed_attempts':failures,'failed_startup_pairs':startup_failures,'flagged_guard_records':flagged,'accepted_browser_runs':len(accepted_ids),'reason':'Guard protocol failure only; all records retained, fresh namespace on retry'},indent=2))
start=min(x['at'] for x in batches);end=max(x['at'] for x in batches)
cachebytes=[x['cache_bytes'] for x in per_run]
env=json.loads((RAW/'environment.json').read_text());docker=json.loads(env['docker'])
os_version=re.search(r'ProductVersion:\s*(\S+)',env['os']).group(1)
desktop=re.search(r'Docker Desktop\s+(\S+)',docker['Server']['Platform']['Name']).group(1)
pg_version=re.search(r'PostgreSQL\)\s+([\d.]+)',env['postgres']).group(1)
redis_version=re.search(r'v=([^\s]+)',env['redis']).group(1)
pw=json.loads((ROOT/'app/benchmark/package.json').read_text())['dependencies']['playwright']
v=env['web_versions']
environment_sentence=(f"The machine is an {env['hardware']} Mac with {env['memory_bytes']/2**30:g} GiB memory and {env['logical_cpus']} logical CPUs running macOS {os_version}. "
 f"Docker Desktop {desktop} provides Docker Engine {docker['Server']['Version']} and Compose {env['compose'].split()[-1].lstrip('v')}. "
 f"The Docker VM exposes {env['docker_vm_cpus']} CPUs and {env['docker_vm_memory_bytes']/2**30:.2f} GiB memory. "
 f"The application uses Node.js {v['node'].lstrip('v')}, Next.js {v['next']}, React {v['react']}, TanStack Query {v['tanstack']}, PostgreSQL {pg_version} and Redis {redis_version}. "
 f"Playwright {pw} drives Chromium {runs[0]['versions']['chromium']}.")
exclusion_sentence=(f'The process guard excluded {len(failures)} primary attempts and {len(startup_failures)} startup pairs. Matches included short-lived shell processes; the first transient identity could not be recovered, so possible overlap cannot be ruled out for that attempt. Interrupted cells/pairs were repeated with fresh namespaces. Accepted runs had clear guard records; no latency-based exclusion was applied.')
cached_nav={m:next(x['navigation'][0] for x in summary if x['delay']==170 and x['mode']==m and x['fe'] and x['be']) for m in ['csr','ssr']}
def cls(m,c,f=True,b=True,d=170):return next(x for x in class_summary if (x['delay'],x['mode'],x['fe'],x['be'],x['class'])==(d,m,f,b,c))['visible_ms']
tcp170=ci([x['tcp']['client_web']['median'] for x in runs if x['delay']==170])[0]
sub={'csr_nk':f'{cls("csr","new_key")[0]:.1f}','ssr_nk':f'{cls("ssr","new_key")[0]:.1f}','csr_rv':f'{cls("csr","revisit")[0]:.1f}','ssr_rv':f'{cls("ssr","revisit")[0]:.1f}','csr_rv_off':f'{cls("csr","revisit",False,False)[0]:.1f}','ssr_rv_off':f'{cls("ssr","revisit",False,False)[0]:.1f}','csr_nk_off':f'{cls("csr","new_key",False,False)[0]:.1f}','ssr_nk_off':f'{cls("ssr","new_key",False,False)[0]:.1f}','tcp170':f'{tcp170:.1f}','csr_rv_effect':fmt(paired_class[(170,'csr')]['revisit']),'ssr_rv_effect':fmt(paired_class[(170,'ssr')]['revisit']),'csr_nk_effect':fmt(paired_class[(170,'csr')]['new_key']),'ssr_nk_effect':fmt(paired_class[(170,'ssr')]['new_key']),'action_table':action_table,'pair_table':pair_table,'csr_cached_nav':f'{cached_nav["csr"]:.1f}','ssr_cached_nav':f'{cached_nav["ssr"]:.1f}','exclusion_sentence':exclusion_sentence,'csr_effect_mean':f'{effects["csr"][0]:.1f}','ssr_effect_mean':f'{effects["ssr"][0]:.1f}','environment_sentence':environment_sentence,'startup_pairs':str(len(startup_groups)),'cold_min':f'{min(x["cold_mean_ms"] for x in startup_summary):.1f}','cold_max':f'{max(x["cold_mean_ms"] for x in startup_summary):.1f}','warm_min':f'{min(x["warm_mean_ms"] for x in startup_summary):.1f}','warm_max':f'{max(x["warm_mean_ms"] for x in startup_summary):.1f}','latency_table':table,'cache_table':cache,'rtt_table':rtt,'chromium_version':runs[0]['versions']['chromium'],'n_runs':str(len(runs)),'n_actions':str(len(runs)*7),'n_reps':str(manifest['reps']),'counts':', '.join(f'{k}: {v:,}' for k,v in counts.items()),'legacy_mismatches':f'{legacy:,}',
 'off_service':fmt(service['off']),'miss_service':fmt(service['miss']),'hit_service':fmt(service['hit']),'csr_effect':fmt(effects['csr']),'ssr_effect':fmt(effects['ssr']),
 'bytes_min':str(min(cachebytes)),'bytes_max':str(max(cachebytes)),'batch_start':start,'batch_end':end,'n_api':str(sum(len(A[r['run']]) for r in runs))}
symv=OUT/'symmetric-values.json'
if symv.exists():
 for k,v in json.loads(symv.read_text()).items():
  if isinstance(v,(str,int,float)):sub[k]=str(v)
(OUT/'manuscript-values.json').write_text(json.dumps(sub,indent=2))
if (ROOT/'manuscript/paper.template.md').exists():
 source=(ROOT/'manuscript/paper.template.md').read_text()
 for k,v in sub.items():source=source.replace('{{'+k+'}}',v)
 assert not re.search(r'\{\{[^}]+\}\}',source),'Unresolved result token'
 (ROOT/'manuscript/paper.md').write_text(source)
 changes=(ROOT/'manuscript/CHANGES.template.md').read_text()
 for k,v in sub.items():changes=changes.replace('{{'+k+'}}',v)
 assert not re.search(r'\{\{[^}]+\}\}',changes)
 (ROOT/'manuscript/CHANGES.md').write_text(changes)
checksums={str(p.relative_to(ROOT)):hashlib.sha256(p.read_bytes()).hexdigest() for p in sorted(RAW.glob('*')) if p.is_file()};(OUT/'raw-sha256.json').write_text(json.dumps(checksums,indent=2))
print(f'PASS: {len(runs)} independent runs, {len(runs)*7} browser observations, {sum(len(A[r["run"]]) for r in runs)} API requests; all cache traces verified; manuscript and figures regenerated.')
