/* 설치 언어는 새 프로필에만 적용하고, 시작 등록 동의는 기존 프로필에도 기억한다. */
ObjC.import('Foundation');
function run(args){
    var path=args[0]+'/settings.json',fm=$.NSFileManager.defaultManager,exists=fm.fileExistsAtPath($(path));
    function json(p){return JSON.parse(ObjC.unwrap($.NSString.stringWithContentsOfFileEncodingError($(p),$.NSUTF8StringEncoding,null)));}
    var config=exists?json(path):json(args[1]+'/defaults.json');
    if(!exists && ['ko','en','zh','ja'].indexOf(args[2])>=0)config.language=args[2];
    if(args[3]==='1')config.startupPromptDismissed=true;
    if(!$(JSON.stringify(config,null,2)).writeToFileAtomicallyEncodingError($(path),true,$.NSUTF8StringEncoding,null))throw new Error('Could not save installer preferences');
}
