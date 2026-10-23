#!/usr/bin/env python3
"""Audit and summarize the symmetric-delay sensitivity sweep and compare it with the primary egress-only sweep."""
from pathlib import Path
import json,collections,statistics
import numpy as np
ROOT=Path(__file__).resolve().parents[1];RAW=ROOT/'results/raw-symmetric';PRI=ROOT/'results/derived';OUT=ROOT/'results/derived';
read=lambda n:[json.loads(x) for x in (RAW/n).read_text().splitlines() if x.strip()]
manifest=json.loads((RAW/'symmetric-manifest.json').read_text())
runs=[x for x in read('runs.jsonl') if x['run'].startswith('symmetric-')]
assert len(runs)==len(manifest['configs'])==480 and len({r['run'] for r in runs})==480
B=collections.defaultdict(list);A=collections.defaultdict(list)
for x in read('browser.jsonl'):B[x['run']].append(x)
for x in read('api.jsonl'):A[x['run']].append(x)
rng=np.random.default_rng(20261023)
def ci(v):
 v=np.array(v,float);return [float(v.mean()),*map(float,np.percentile(v[rng.integers(0,len(v),(10000,len(v)))].mean(axis=1),[2.5,97.5]))]
fmt=lambda a:f'{a[0]:.1f} [{a[1]:.1f}, {a[2]:.1f}]'
rows=[]
for r in runs:
 b=sorted(B[r['run']],key=lambda x:(x['session'],x['step']));a=A[r['run']]
 assert len(b)==7 and not any(x.get('errors') for x in b) and not any(x.get('error') for x in a),r['run']
 assert len(a)==(3 if r['mode']=='ssr' and r['fe'] else 4 if r['mode']=='csr' and r['fe'] else 7),(r['run'],'API count')
 byid={x['id']:x for x in a};seen={};keys=set()
 for x in a:
  expect='off' if not r['be'] else 'hit' if x['page'] in keys else 'miss';assert x['outcome']==expect,(r['run'],x['page']);keys.add(x['page'])
 seen_pages=set();rec=collections.defaultdict(list);replay={}
 for x in b:
  assert x['response'] in byid
  key=(x['session'] if r['mode']=='csr' else 'shared',x['page'])
  if r['fe'] and key in replay:assert x['response']==replay[key],(r['run'],'front cache did not replay')
  elif not r['fe']:assert x['response'] not in replay.values()
  replay[key]=x['response']
  c='fresh_initial' if x['session']==1 else 'first_initial' if x['step']==0 else 'revisit' if x['page'] in seen_pages else 'new_key'
  if x['session']==0:seen_pages.add(x['page'])
  rec[c].append(x['visibleMs'])
 assert {k:len(v) for k,v in rec.items()}=={'first_initial':1,'new_key':2,'revisit':3,'fresh_initial':1}
 nav=statistics.mean(q for c in ('new_key','revisit') for q in rec[c])
 rows.append({**{k:r[k] for k in ('run','seed','delay','mode','fe','be')},'tcp_web':r['tcp']['client_web']['median'],'tcp_api':r['tcp']['client_api']['median'],'navigation':nav,**{c:statistics.mean(v) for c,v in rec.items()}})
cells=collections.defaultdict(list)
for x in rows:cells[(x['delay'],x['mode'],x['fe'],x['be'])].append(x)
assert all(len(v)==30 for v in cells.values()) and len(cells)==16
summary=[{'delay':d,'mode':m,'fe':f,'be':b,**{k:ci([x[k] for x in v]) for k in ['first_initial','new_key','revisit','fresh_initial','navigation','tcp_web','tcp_api']}} for (d,m,f,b),v in sorted(cells.items())]
(OUT/'symmetric-summary.json').write_text(json.dumps(summary,indent=2))
# Paired all-caches minus no-caches contrasts by class, runs paired by seed.
def pair(d,m,k):
 g=lambda f,b:{x['seed']:x[k] for x in cells[(d,m,f,b)]};on,off=g(True,True),g(False,False);return ci([on[s]-off[s] for s in sorted(on)])
contrasts={f'{d}-{m}':{k:pair(d,m,k) for k in ['new_key','revisit','navigation','fresh_initial']} for d in (40,170) for m in ('csr','ssr')}
(OUT/'symmetric-contrasts.json').write_text(json.dumps(contrasts,indent=2))
pri={(x['delay'],x['mode'],x['fe'],x['be'],x['class']):x for x in json.loads((PRI/'action-class-summary.json').read_text())}
priC=json.loads((PRI/'paired-class-contrasts.json').read_text())
sc=lambda d,m,f,b,k:next(x for x in summary if (x['delay'],x['mode'],x['fe'],x['be'])==(d,m,f,b))[k]
t='| Mode | Class, both caches | Egress only | Split egress and return |\n|---|---|---:|---:|\n'
for d in (170,):
 for m in ('csr','ssr'):
  for c,name in [('new_key','New key'),('revisit','Revisit')]:
   t+=f'| {m.upper()} | {name} | {fmt(pri[(d,m,True,True,c)]["visible_ms"])} | {fmt(sc(d,m,True,True,c))} |\n'
t2='| Delay, ms | Mode | Navigation effect, egress only | Navigation effect, split | Revisit effect, egress only | Revisit effect, split |\n|---:|---|---:|---:|---:|---:|\n'
for d in (40,170):
 for m in ('csr','ssr'):
  t2+=f'| {d} | {m.upper()} | {fmt(priC[f"{d}-{m}"]["navigation"])} | {fmt(contrasts[f"{d}-{m}"]["navigation"])} | {fmt(priC[f"{d}-{m}"]["revisit"])} | {fmt(contrasts[f"{d}-{m}"]["revisit"])} |\n'
t3='| Added delay, ms | Shaping | TCP to Next.js, ms [95% CI] | TCP to API, ms [95% CI] |\n|---:|---|---:|---:|\n'
prir=[json.loads(l) for l in (ROOT/'results/raw/runs.jsonl').read_text().splitlines() if l.strip()]
for d in (40,170):
 pr=[x for x in prir if x['run'].startswith('primary-') and x['delay']==d]
 t3+=f'| {d} | Egress only | {fmt(ci([x["tcp"]["client_web"]["median"] for x in pr]))} | {fmt(ci([x["tcp"]["client_api"]["median"] for x in pr]))} |\n'
 t3+=f'| {d} | Split | {fmt(ci([x["tcp_web"] for x in rows if x["delay"]==d]))} | {fmt(ci([x["tcp_api"] for x in rows if x["delay"]==d]))} |\n'
tcp=lambda d:ci([x['tcp_web'] for x in rows if x['delay']==d])[0]
vals={'sym_csr_nk':f'{sc(170,"csr",True,True,"new_key")[0]:.1f}','sym_ssr_nk':f'{sc(170,"ssr",True,True,"new_key")[0]:.1f}','sym_csr_rv':f'{sc(170,"csr",True,True,"revisit")[0]:.1f}','sym_ssr_rv':f'{sc(170,"ssr",True,True,"revisit")[0]:.1f}','sym_tcp170':f'{tcp(170):.1f}','sym_csr_nav_eff':fmt(contrasts['170-csr']['navigation']),'sym_ssr_nav_eff':fmt(contrasts['170-ssr']['navigation']),'sym_csr_rv_eff':fmt(contrasts['170-csr']['revisit']),'sym_ssr_rv_eff':fmt(contrasts['170-ssr']['revisit']),'sym_table_classes':t,'sym_table_effects':t2,'sym_table_tcp':t3,'sym_runs':len(runs),'sym_actions':len(runs)*7}
(OUT/'symmetric-values.json').write_text(json.dumps(vals,indent=2))
print('PASS',len(runs),'runs');print(t);print(t2);print(t3)
