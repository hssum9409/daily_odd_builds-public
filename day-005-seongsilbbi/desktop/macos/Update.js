/* 별도 JXA 도우미: 공개 릴리스 확인 → 검증 → 자기 모니터 종료 → 교체/복구. */
ObjC.import('Foundation');ObjC.import('AppKit');
function run(argv) {
    var root=argv[0],home=argv[1],force=argv.indexOf('--force')>=0, fm=$.NSFileManager.defaultManager;
    function read(p){var v=$.NSString.stringWithContentsOfFileEncodingError($(p),$.NSUTF8StringEncoding,null);return v?ObjC.unwrap(v):'';}
    function json(p){try{return JSON.parse(read(p));}catch(_){return null;}}
    function write(p,v){if(!$(JSON.stringify(v,null,2)).writeToFileAtomicallyEncodingError($(p),true,$.NSUTF8StringEncoding,null))throw new Error('update_install');}
    // 새 작업 폴더에도 attributes 사전 대신 NSNull이 전달되지 않도록 bridged nil을 쓴다.
    function mkdir(p){if(!fm.createDirectoryAtPathWithIntermediateDirectoriesAttributesError($(p),true,$(),$()))throw new Error('update_install');}
    function exec(path,args,installBase){
        var p=$.NSTask.alloc.init,out=$.NSPipe.pipe,environment=$.NSProcessInfo.processInfo.environment.mutableCopy;
        // argv로 받은 프로필과 설치 위치를 자식에도 전달한다. 포터블/별도 QA 프로필을 섞지 않는다.
        environment.setObjectForKey($(home),$('WORKLOG_SCRIPTS_HOME'));
        if(installBase!==undefined){
            if(installBase)environment.setObjectForKey($(installBase),$('WORKLOG_SCRIPTS_INSTALL_BASE'));
            else environment.removeObjectForKey($('WORKLOG_SCRIPTS_INSTALL_BASE'));
        }
        p.currentDirectoryPath=$('/tmp');p.environment=environment;p.launchPath=$(path);p.arguments=$(args);p.standardOutput=out;p.standardError=$.NSFileHandle.fileHandleForWritingAtPath($('/dev/null'));
        p.launch;var bytes=out.fileHandleForReading.readDataToEndOfFile;p.waitUntilExit;if(Number(p.terminationStatus)!==0)throw new Error('update_download');
        return ObjC.unwrap($.NSString.alloc.initWithDataEncoding(bytes,$.NSUTF8StringEncoding))||'';
    }
    eval(read(root+'/desktop/updates.js'));
    var current=json(root+'/release.json').version,cache=json(home+'/updates.json')||{},now=Date.now()/1000;
    if(cache.blockedUntil>now && cache.blockedUntil<=now+86400)return 'rate limited';
    if(!force && cache.nextCheck>now && cache.nextCheck<=now+86400)return 'cached';
    var lock=$.NSDistributedLock.lockWithPath($(home+'/update.lock'));
    if(!lock.tryLock){
        // 조회/교체는 수분 안에 끝난다. 비정상 종료 후의 오래된 잠금만 복구한다.
        var date=lock.lockDate,age=date?-Number(date.timeIntervalSinceNow):0;
        var owner=json(home+'/update-owner.json'),live=false;
        if(owner && Number.isInteger(owner.pid) && owner.pid>0){try{live=exec('/bin/ps',['-p',String(owner.pid),'-o','command=']).indexOf(owner.root+'/desktop/macos/Update.js')>=0;}catch(_){}}
        if(live)return 'busy';
        if(age<600)return 'busy';lock.breakLock;if(!lock.tryLock)return 'busy';
    }
    var job=home+'/updates/'+ObjC.unwrap($.NSUUID.UUID.UUIDString),backup=job+'/backup',files=[],oldFiles=[],swapped=false,candidate=null;
    cache.nextCheck=now+21600;
    function status(s){cache.status=s;write(home+'/updates.json',cache);}
    function fetch(url,path,max){
        if(!/^https:\/\/(api\.github\.com|github\.com)\//.test(url))throw new Error('update_download');
        var result=exec('/usr/bin/curl',['--disable','--silent','--show-error','--location','--proto','=https','--proto-redir','=https','--connect-timeout','10','--max-time','30','--max-filesize',String(max),'-A','WorklogScripts-Updater','-D',path+'.headers','-o',path,'--write-out','%{url_effective}\n%{http_code}',url]).split('\n'),final=result[0],code=Number(result[1]);
        if(!/^https:\/\/(api\.github\.com|github\.com|objects\.githubusercontent\.com|release-assets\.githubusercontent\.com)\//.test(final) || Number(fm.attributesOfItemAtPathError($(path),null).objectForKey($.NSFileSize))>max)throw new Error('update_download');
        if(code===403 || code===429){var matches=read(path+'.headers').match(/^retry-after:\s*(.+)$/gim)||[],retry=matches.length?matches[matches.length-1].replace(/^retry-after:\s*/i,'').trim():'',seconds=/^\d+$/.test(retry)?Number(retry):Math.max(0,(Date.parse(retry)-Date.now())/1000);cache.blockedUntil=now+Math.min(86400,Math.max(21600,Number.isFinite(seconds)?seconds:21600));cache.nextCheck=cache.blockedUntil;throw new Error('update_rate_limit');}
        if(code!==200)throw new Error('update_network');
    }
    function digest(path){return exec('/usr/bin/shasum',['-a','256',path]).split(/\s/)[0];}
    function safe(path){var p=path;while(p && p!=='/'){var attr=fm.attributesOfItemAtPathError($(p),null);if(attr && ObjC.unwrap(attr.objectForKey($.NSFileType))==='NSFileTypeSymbolicLink')throw new Error('update_install');p=p.slice(0,p.lastIndexOf('/'));}return path;}
    function payload(path){var names=[],seen={};read(safe(path+'/payload.sha256')).trim().split(/\r?\n/).forEach(function(line){var m=/^([a-f0-9]{64})  ([a-zA-Z0-9_./-]+)$/.exec(line);if(!m || /(^\/|(^|\/)\.\.($|\/)|^desktop\/windows\/)/.test(m[2]) || seen[m[2]] || digest(safe(path+'/'+m[2]))!==m[1])throw new Error('update_checksum');seen[m[2]]=true;names.push(m[2]);});['desktop/macos/Runtime.js','desktop/macos/install.command','config/firebase.json','release.json'].forEach(function(n){if(names.indexOf(n)<0)throw new Error('update_checksum');});return names;}
    function copy(from,to,names){names.concat(['payload.sha256']).forEach(function(n){safe(to+'/'+n);var slash=n.lastIndexOf('/');mkdir(slash<0?to:to+'/'+n.slice(0,slash));exec('/bin/cp',['-f',safe(from+'/'+n),to+'/'+n]);});}
    function stop(){
        var record=json(home+'/instance.json');
        if(record && record.root!==root)throw new Error('update_shutdown');
        if(record && (!Number.isInteger(record.pid) || record.pid<=0 || exec('/bin/ps',['-p',String(record.pid),'-o','command=']).indexOf(root+'/desktop/macos/Runtime.js')<0))throw new Error('update_shutdown');
        exec('/bin/sh',[root+'/desktop/macos/control.command','stop']);var end=Date.now()+25000;while(fm.fileExistsAtPath($(home+'/instance.json')) && Date.now()<end)$.NSThread.sleepForTimeInterval(0.2);if(fm.fileExistsAtPath($(home+'/instance.json')))throw new Error('update_shutdown');
    }
    function start(expected){exec('/bin/sh',[root+'/desktop/macos/run.command']);var end=Date.now()+30000,ready=false;while(Date.now()<end){var r=json(home+'/instance.json');if(r && r.ready && (r.version===expected || (!r.version && json(root+'/release.json').version===expected)) && r.root===root){ready=true;break;}$.NSThread.sleepForTimeInterval(0.2);}if(!ready)throw new Error('update_startup');$.NSThread.sleepForTimeInterval(2);if(!fm.fileExistsAtPath($(home+'/instance.json')))throw new Error('update_startup');}
    function apply(source,names,obsolete){
        if(fm.fileExistsAtPath($(root+'/installed.txt'))){
            var receipt=read(root+'/installed.txt').trim().split(/\r?\n/);
            if(receipt[0]!=='WorklogScripts' || receipt[1]!==root)throw new Error('update_install');
            var standard=ObjC.unwrap($.NSHomeDirectory())+'/Library/Application Support/DailyOddBuilds/WorklogScripts/app';
            exec('/bin/sh',[source+'/desktop/macos/install.command','--update'],root===standard?'':root.slice(0,root.lastIndexOf('/')));
        }
        else{copy(source,root,names);obsolete.forEach(function(n){if(names.indexOf(n)<0)exec('/bin/rm',['-f',root+'/'+n]);});}
    }
    try {
        write(home+'/update-owner.json',{pid:Number($.NSProcessInfo.processInfo.processIdentifier),root:root});mkdir(job);
        status('update_checking');fetch(WorklogUpdates.api,job+'/releases.json',4194304);
        candidate=WorklogUpdates.select(json(job+'/releases.json'),current,'macos');
        if(!candidate){status('update_unavailable');return 'no update';}
        if(!force && candidate.version===cache.failedVersion)return 'failed version skipped';
        var settings=json(home+'/updates-settings.json')||{},words={update_title:'성실삐 업데이트',update_body:'새 버전 {new}을 설치할까요? 현재 버전은 {old}입니다. 기록과 설정은 유지됩니다.',update_now:'업데이트',startup_later:'나중에'};
        if(!settings.autoUpdate){var alert=$.NSAlert.alloc.init;alert.messageText=$(words.update_title);alert.informativeText=$(words.update_body.replace('{old}',current).replace('{new}',candidate.version));alert.addButtonWithTitle($(words.update_now));alert.addButtonWithTitle($(words.startup_later));if(Number(alert.runModal)!==1000){status('update_available');return 'declined';}}
        status('update_downloading');fetch(candidate.sums,job+'/SHA256SUMS.txt',262144);var sum=WorklogUpdates.checksum(read(job+'/SHA256SUMS.txt'),candidate.name);
        if(candidate.digest && candidate.digest!==sum)throw new Error('update_checksum');fetch(candidate.url,job+'/payload.zip',33554432);
        if(digest(job+'/payload.zip')!==sum || Number(fm.attributesOfItemAtPathError($(job+'/payload.zip'),null).objectForKey($.NSFileSize))!==candidate.size)throw new Error('update_checksum');
        var entries=exec('/usr/bin/unzip',['-Z1',job+'/payload.zip']).trim().split('\n'),seen={};
        if(entries.length>256)throw new Error('update_checksum');entries.forEach(function(n){if(!/^WorklogScripts\/[a-zA-Z0-9_./-]+$/.test(n)||n.split('/').indexOf('..')>=0||seen[n])throw new Error('update_checksum');seen[n]=true;});
        var listing=exec('/usr/bin/unzip',['-Z','-l',job+'/payload.zip']);if(/^l[rwx-]{9}/m.test(listing))throw new Error('update_checksum');
        var sizes=listing.split('\n').filter(function(line){return /^-[rwx-]{9}/.test(line);}).map(function(line){return Number(line.trim().split(/\s+/)[3]);});if(sizes.length!==entries.length || sizes.reduce(function(a,b){return a+b;},0)>67108864)throw new Error('update_checksum');
        mkdir(job+'/payload');exec('/usr/bin/unzip',['-q',job+'/payload.zip','-d',job+'/payload']);var source=job+'/payload/WorklogScripts';files=payload(source);oldFiles=payload(root);
        if(json(source+'/release.json').version!==candidate.version || json(source+'/release.json').product!=='WorklogScripts' || json(source+'/release.json').platform!=='macos')throw new Error('update_response');copy(root,backup,oldFiles);
        status('applying');stop();swapped=true;apply(source,files,oldFiles);start(candidate.version);
        cache.failedVersion='';status('installed');write(job+'/result.json',{status:'installed',version:candidate.version});return 'installed';
    } catch(error){
        var state='failed';
        if(swapped){try{stop();apply(backup,oldFiles,files);start(current);state='rolled_back';}catch(_){state='recovery_required';}}
        cache.failedVersion=candidate?candidate.version:'';status(/^update_/.test(error.message)?error.message:'update_network');write(job+'/result.json',{status:state,error:String(error),backup:backup});return state;
    } finally {fm.removeItemAtPathError($(home+'/update-owner.json'),null);lock.unlock;}
}
