#!/usr/bin/env python3
"""Print five manuscript quantities directly from raw logs, independently of analyze.py."""
from pathlib import Path
import json
R=Path(__file__).resolve().parents[1];P=R/'results/raw'
load=lambda n:[json.loads(x) for x in (P/n).read_text().splitlines() if x.strip()]
runs=load('runs.jsonl');browser=load('browser.jsonl');api=load('api.jsonl')
sql=[json.loads(x) for x in (P/'sql-check.txt').read_text().splitlines() if x.startswith('{')]
print('1. Review count, exact DB log:',next(x['reviews'] for x in sql if 'reviews' in x))
print('2. Legacy mismatches, exact DB log:',next(x['legacy_count_mismatches'] for x in sql if 'legacy_count_mismatches' in x))
def ids(mode,fe,be,delay):
 rr=[x for x in runs if x['run'].startswith('primary-') and x['mode']==mode and x['fe']==fe and x['be']==be and x['delay']==delay]
 assert len(rr)==30
 return {x['run'] for x in rr}
k=ids('csr',True,False,0);numerator=sum(x['run'] in k for x in api);denominator=sum(x['run'] in k for x in browser)
print('3. Table 2 CSR F1 R0 API/action:',numerator,'/',denominator,'=',numerator/denominator)
k=ids('ssr',True,True,0);numerator=sum(x['run'] in k and x['dbMs'] is not None for x in api);denominator=sum(x['run'] in k for x in browser)
print('4. Table 2 SSR F1 R1 DB/action:',numerator,'/',denominator,'=',numerator/denominator)
k=ids('csr',False,False,170);values=[x['visibleMs'] for x in browser if x['run'] in k and x['session']==0 and x['step']==0]
assert len(values)==30
print('5. Table 3 CSR F0 R0 first initial, 170 ms:')
print('Raw values:',json.dumps(values));print('Sum:',sum(values),'n:',len(values),'Mean:',sum(values)/len(values),'Rounded:',round(sum(values)/len(values),1))
