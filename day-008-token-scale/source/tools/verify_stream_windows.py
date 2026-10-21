"""Windows daemon + real local Firebase emulators. Synthetic source, never production."""
import base64, ctypes, hashlib, http.client, http.server, json, os, shutil, subprocess, sys, tempfile, threading, time, uuid
from datetime import datetime, timezone, timedelta
from pathlib import Path
from urllib.request import Request, urlopen

SOURCE_FIXTURE = "import sys,json,time\nfrom pathlib import Path\nfrom datetime import datetime,timezone,timedelta\nroot=Path(__file__).parent\nfor line in sys.stdin:\n try:\n  request=json.loads(line)\n  if 'id' not in request:continue\n  method=request['method'];s=json.loads((root/'source.json').read_text());result={}\n  with (root/'rpc.jsonl').open('a') as log:log.write(json.dumps({'method':method,'at':time.time()})+'\\n')\n  if method=='account/read':result={'account':{'type':'chatgpt','email':'synthetic-stream@example.invalid','planType':'plus'}}\n  if method=='account/usage/read':result={'summary':{'lifetimeTokens':s['lifetime'],'longestRunningTurnSec':60},'dailyUsageBuckets':[{'startDate':(datetime.now(timezone.utc)-timedelta(days=2)).date().isoformat(),'tokens':s['tokens']}]}\n  if method=='skills/list':result={'data':[{'errors':[],'skills':[{'enabled':True,'path':'synthetic-'+str(i)} for i in range(s['skills'])]}]}\n  if method=='app/installed':result={'apps':[]}\n  print(json.dumps({'id':request['id'],'result':result}),flush=True)\n except Exception:sys.exit(1)\n\n"

def main():
    DAY=Path(__file__).resolve().parents[1]
    CASE=Path(tempfile.mkdtemp(prefix='token-scale-stream-fixture-'))
    ROOT=CASE/'install';DATA=CASE/'data';PAYLOAD=CASE/'payload';DATA.mkdir()
    KEY='DailyOddBuilds.TokenScale.StreamFixture_'+uuid.uuid4().hex[:8]
    dart_command=Path(shutil.which('dart') or '')
    DART=dart_command.parent/'cache/dart-sdk/bin/dart.exe'
    if not DART.is_file():DART=dart_command
    assert DART.is_file() and DART.suffix.lower()=='.exe', 'Install the Dart/Flutter SDK first'
    FLAGS=subprocess.CREATE_NO_WINDOW
    def req(url,body=None,token=None):
        headers={'Content-Type':'application/json'}
        if token:headers['Authorization']='Bearer '+token
        with urlopen(Request(url,data=None if body is None else json.dumps(body).encode(),headers=headers),timeout=30) as r:return json.load(r)
    def write(path,value):
        temp=path.with_suffix(path.suffix+'.tmp');temp.write_text(json.dumps(value),encoding='utf-8');temp.replace(path)
    def read(path):return json.loads(path.read_text(encoding='utf-8-sig'))
    def wait(predicate,label,timeout=150):
        deadline=time.monotonic()+timeout
        while time.monotonic()<deadline:
            try:
                result=predicate()
                if result:return result
            except (OSError,KeyError,ValueError):pass
            time.sleep(.3)
        raise AssertionError('Timeout: '+label)
    def run(args,**kwargs):return subprocess.run([str(x) for x in args],creationflags=FLAGS,capture_output=True,text=True,check=True,**kwargs)
    def protect(value):
        class Blob(ctypes.Structure):_fields_=[('size',ctypes.c_ulong),('data',ctypes.POINTER(ctypes.c_byte))]
        raw=value.encode();buf=ctypes.create_string_buffer(raw);a=Blob(len(raw),ctypes.cast(buf,ctypes.POINTER(ctypes.c_byte)));b=Blob()
        assert ctypes.windll.crypt32.CryptProtectData(ctypes.byref(a),None,None,None,None,0,ctypes.byref(b))
        result=base64.b64encode(ctypes.string_at(b.data,b.size)).decode();ctypes.windll.kernel32.LocalFree(b.data);return result

    assert os.name=='nt'
    AUTH='http://127.0.0.1:9199/identitytoolkit.googleapis.com/v1/accounts:signInWithIdp?key=fixture'
    API='http://127.0.0.1:5004/demo-token-arena/asia-northeast3/arenaApi/v1/'
    claims={'iss':'https://accounts.google.com','sub':'stream-os-'+uuid.uuid4().hex,'aud':'fixture','email':'synthetic-stream@example.invalid','email_verified':True}
    enc=lambda v:base64.urlsafe_b64encode(json.dumps(v).encode()).decode().rstrip('=')
    google=enc({'alg':'none'})+'.'+enc(claims)+'.'
    auth=req(AUTH,{'requestUri':'http://localhost','postBody':'id_token='+google+'&providerId=google.com','returnSecureToken':True})
    UID=auth['localId'];TOKEN=auth['idToken']
    req(API+'profile',{'nickname':'Synthetic OS fixture','locale':'en','isPublic':False,'declaredPlan':'unknown'},TOKEN)
    ledger=[];fault={'drop':False}
    class Proxy(http.server.BaseHTTPRequestHandler):
        def do_POST(self):
            data=self.rfile.read(int(self.headers['Content-Length']));body=json.loads(data)
            item={'path':self.path,'at':time.time(),'digest':hashlib.sha256(data).hexdigest(),'sequence':body.get('sequence'),
                  'patchKeys':list(body.get('patch',{})),'summaryKeys':list(body.get('patch',{}).get('summary',{})),
                  'observationKeys':list(body.get('patch',{}).get('observations',{}))}
            conn=http.client.HTTPConnection('127.0.0.1',5004,timeout=60)
            conn.request('POST','/demo-token-arena/asia-northeast3/arenaApi'+self.path,data,{'Content-Type':'application/json','Authorization':self.headers['Authorization']})
            response=conn.getresponse();out=response.read();item['status']=response.status
            if self.path.endswith('/stream-patch') and fault['drop'] and response.status==200:
                fault['drop']=False;item['responseDropped']=True;ledger.append(item);self.close_connection=True;conn.close();return
            ledger.append(item);self.send_response(response.status);self.send_header('Content-Type','application/json');self.end_headers();self.wfile.write(out);conn.close()
        def log_message(self,*args):pass
    proxy=http.server.ThreadingHTTPServer(('127.0.0.1',0),Proxy)
    threading.Thread(target=proxy.serve_forever,daemon=True).start()
    shutil.copytree(DAY/'build/cli/windows-x64-0.4.0',PAYLOAD)
    run([DART,'compile','aot-snapshot','-DARENA_EMULATOR=true','-DFIREBASE_PROJECT_ID=demo-token-arena','-DFIREBASE_API_KEY=fixture',
         f'-DARENA_API_URL=http://127.0.0.1:{proxy.server_port}','-DCOLLECTOR_VERSION=0.4.0',
         'cli_collector/bin/token_scale.dart','-o',PAYLOAD/'token-scale.aot'],cwd=DAY)
    write(DATA/'preferences.json',{'autoSync':False,'autoUpdate':False,'uploadConsent':True})
    session={'uid':UID,'idToken':TOKEN,'refreshToken':auth['refreshToken'],'expiresAt':(datetime.now(timezone.utc)+timedelta(minutes=40)).isoformat()}
    (DATA/'session').write_text(protect(json.dumps(session)),encoding='utf-8')
    files=sorted(p for p in PAYLOAD.iterdir() if p.is_file() and p.name!='SHA256SUMS.txt')
    (PAYLOAD/'SHA256SUMS.txt').write_text(''.join(hashlib.sha256(p.read_bytes()).hexdigest()+'  '+p.name+'\n' for p in files),encoding='utf-8')
    env=dict(os.environ,CODEX_EXECUTABLE=sys.executable)
    report={'actualWindows':True,'syntheticSource':True,'productionWrites':False,'caseRoot':str(CASE)}
    try:
        run([PAYLOAD/'dartaotruntime.exe',PAYLOAD/'token-scale.aot','install','--consent','--payload-root',PAYLOAD,'--install-root',ROOT,'--home',DATA,'--product-key',KEY],env=env,timeout=70)
        source={'tokens':100,'lifetime':1000,'skills':2}
        write(ROOT/'source.json',source)
        (ROOT/'app-server').write_text(SOURCE_FIXTURE,encoding='utf-8')
        (ROOT/'resume.request').write_text('resume')
        cache=wait(lambda:read(DATA/'statistics-cache.json') if (DATA/'statistics-cache.json').exists() and 'pending' not in read(DATA/'statistics-cache.json') else None,'initial background acknowledgement')
        assert cache['sequence']==1
        initialCount=len(ledger);initialTime=time.monotonic()
        print('initial OS daemon -> emulator sync passed',flush=True)
        def calls():return [json.loads(l) for l in (ROOT/'rpc.jsonl').read_text().splitlines()]
        wait(lambda:len([x for x in calls() if x['method']=='account/usage/read'])>=3,'three real 30-second OS polls',90)
        assert len(ledger)==initialCount,'unchanged data produced network requests'
        samples=[x['at'] for x in calls() if x['method']=='account/usage/read']
        report['pollIntervalsSeconds']=[round(b-a,2) for a,b in zip(samples,samples[1:])]
        assert all(27<=x<=35 for x in report['pollIntervalsSeconds'])
        report['unchangedPollsMadeNoRequests']=True
        report['metadataProbeCountBeforeRefresh']=len([x for x in calls() if x['method']=='skills/list'])
        assert report['metadataProbeCountBeforeRefresh']==1
        source['tokens']=40;write(ROOT/'source.json',source);fault['drop']=True
        wait(lambda:any(x.get('responseDropped') for x in ledger),'drop response after successful server commit',50)
        pending=read(DATA/'statistics-cache.json');assert pending['pending']['body']['sequence']==2
        print('past correction committed, response intentionally lost; waiting for real daemon retry',flush=True)
        wait(lambda:read(DATA/'statistics-cache.json').get('sequence')==2 and 'pending' not in read(DATA/'statistics-cache.json'),'persisted retry acknowledgement',100)
        retries=[x for x in ledger if x['sequence']==2]
        assert len(retries)==2 and retries[0]['digest']==retries[1]['digest']
        assert retries[0]['summaryKeys']==[] and retries[0]['observationKeys']==[]
        report['retrySameSequenceAndBody']=True;report['retryDelaySeconds']=round(retries[1]['at']-retries[0]['at'],2)
        hot=req(f'http://127.0.0.1:9004/ingest/{UID}.json?ns=demo-token-arena-default-rtdb&auth={TOKEN}')
        date=(datetime.now(timezone.utc)-timedelta(days=2)).date().isoformat()
        assert hot['sequence']==2 and hot['pending']['daily'][date]['tokens']==40
        report['pastCorrectionReplacesNotAdds']=True
        source['skills']=3;write(ROOT/'source.json',source)
        state=read(DATA/'state.json');state['metadataCheckedAt']='2000-01-01T00:00:00Z';write(DATA/'state.json',state)
        wait(lambda:read(DATA/'statistics-cache.json').get('sequence')==3,'metadata refresh',55)
        meta=[x for x in ledger if x['sequence']==3][-1]
        assert meta['patchKeys']==['observations','fetchedAt'];assert meta['observationKeys']==['enabledSkills']
        report['metadataOnlyPatch']=True
        helper=CASE/'flush.mjs'
        helper.write_text("import {createRequire} from 'node:module';const require=createRequire("+json.dumps(str(DAY/'firebase/functions/package.json'))+");const {initializeApp,deleteApp}=require('firebase-admin/app');const {getFirestore}=require('firebase-admin/firestore');const {getDatabase}=require('firebase-admin/database');const {ArenaService}=await import("+json.dumps((DAY/'firebase/functions/src/service.js').as_uri())+");const a=initializeApp({projectId:'demo-token-arena',databaseURL:'https://demo-token-arena-default-rtdb.firebaseio.com'});await new ArenaService(getFirestore(a),getDatabase(a)).fast.flushUid(process.argv[2]);const s=(await getFirestore(a).doc('users/'+process.argv[2]+'/private/snapshot').get()).data();console.log(JSON.stringify({tokens:s.usage.daily[process.argv[3]].tokens,sequence:s.fastRevision}));await deleteApp(a);",encoding='utf-8')
        result=run(['node',helper,UID,date],env=dict(os.environ,GCLOUD_PROJECT='demo-token-arena',FIRESTORE_EMULATOR_HOST='127.0.0.1:8788',FIREBASE_DATABASE_EMULATOR_HOST='127.0.0.1:9004'))
        persisted=json.loads(result.stdout);assert persisted=={'tokens':40,'sequence':3}
        report['correctedFirestoreAfterFlush']=True
        report['passed']=True;print(json.dumps(report),flush=True)
    finally:
        proxy.shutdown()
        if (ROOT/'manage.ps1').exists():
            run(['powershell.exe','-NoProfile','-ExecutionPolicy','Bypass','-File',ROOT/'manage.ps1','-Action','remove','-Root',ROOT],timeout=100)
        (DATA/'session').unlink(missing_ok=True)
        for name in ('app-server','source.json','rpc.jsonl'):(ROOT/name).unlink(missing_ok=True)
        if ROOT.exists() and not any(ROOT.iterdir()):ROOT.rmdir()
        write(CASE/'report.json',report);write(CASE/'requests.json',ledger)
        print('Evidence: '+str(CASE/'report.json'),flush=True)

if __name__=='__main__':main()
