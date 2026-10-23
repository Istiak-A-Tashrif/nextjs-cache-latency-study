#!/usr/bin/env python3
"""Resume only guard-aborted work, retaining every attempt; never weaken the process guard."""
from pathlib import Path
import subprocess,time,json,os,sys
A=Path(__file__).resolve().parent;R=A.parent;RAW=R/'results/raw';DER=R/'results/derived';DER.mkdir(exist_ok=True)
def clear():
 result=subprocess.run(['pgrep','-f','harness.mjs'],stdout=subprocess.DEVNULL)
 if result.returncode not in (0,1):raise RuntimeError('Process enumeration unavailable')
 return result.returncode==1

def wait_clear():
 while True:
  if clear():
   time.sleep(3)
   if clear():return
  time.sleep(3)
def own_client():subprocess.run(['docker','compose','-p','unibench','-f',str(A/'docker-compose.yml'),'up','-d','--no-deps','client'],cwd=A,check=True,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
def stage(command,logname):
 while True:
  wait_clear();own_client()
  with (RAW/logname).open('a') as f:status=subprocess.run(['node',*command],cwd=A,stdout=f,stderr=subprocess.STDOUT).returncode
  if status==0:return
  tail=(RAW/logname).read_text()[-6000:]
  if 'Main harness active' not in tail:raise RuntimeError('Non-guard failure; see '+logname)
  print('Guard abort retained; waiting for two clear process checks before retry.',flush=True)
  subprocess.run(['docker','compose','-p','unibench','-f',str(A/'docker-compose.yml'),'stop','-t','0','client'],cwd=A,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
stage(['benchmark.mjs','run'],'primary-auto-console.txt')
print('All primary cells complete; collecting startup pairs.',flush=True)
stage(['startup-check.mjs'],'startup-console.txt')
print('Measurements complete.',flush=True)
