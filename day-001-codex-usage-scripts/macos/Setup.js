/* 설치 안내 UI. 실제 AppKit 실행은 Mac QA 대상이다. */
ObjC.import('Foundation');ObjC.import('AppKit');
function run(argv){
    var root=argv[0],app=$.NSApplication.sharedApplication;app.setActivationPolicy($.NSApplicationActivationPolicyAccessory);app.activateIgnoringOtherApps(true);
    function read(path){return ObjC.unwrap($.NSString.stringWithContentsOfFileEncodingError($(path),$.NSUTF8StringEncoding,null));}
    var strings=JSON.parse(read(root+'/strings.json')),language=ObjC.unwrap($.NSLocale.preferredLanguages.objectAtIndex(0)).split('-')[0];if(['ko','en','zh','ja'].indexOf(language)<0)language='ko';
    var picker=$.NSPopUpButton.alloc.initWithFramePullsDown($.NSMakeRect(0,0,300,32),false);picker.addItemsWithTitles($(['한국어','English','中文','日本語']));picker.selectItemAtIndex(['ko','en','zh','ja'].indexOf(language));
    var choice=$.NSAlert.alloc.init;choice.messageText=$('Codex Usage Monitor Scripts');choice.informativeText=$(strings[language].language);choice.accessoryView=picker;choice.addButtonWithTitle($(strings[language].install_continue));choice.addButtonWithTitle($(strings[language].install_cancel));if(Number(choice.runModal())!==1000)return '';
    language=['ko','en','zh','ja'][Number(picker.indexOfSelectedItem)];var words=strings[language];
    var area=$.NSView.alloc.initWithFrame($.NSMakeRect(0,0,520,390)),scroll=$.NSScrollView.alloc.initWithFrame($.NSMakeRect(0,110,520,280));scroll.hasVerticalScroller=true;
    var text=$.NSTextView.alloc.initWithFrame($.NSMakeRect(0,0,500,280));text.editable=false;text.string=$(read(language==='en'?root+'/LICENSE':root+'/docs/licenses/MIT.'+language+'.txt'));scroll.documentView=text;area.addSubview(scroll);
    var startup=$.NSButton.alloc.initWithFrame($.NSMakeRect(0,76,520,25));startup.setButtonType($.NSSwitchButton);startup.title=$(words.startup_register);area.addSubview(startup);
    var help=$.NSTextField.alloc.initWithFrame($.NSMakeRect(0,0,520,70));help.editable=false;help.bezeled=false;help.drawsBackground=false;help.font=$.NSFont.systemFontOfSize(11);help.stringValue=$(words.install_startup_help);help.cell.wraps=true;area.addSubview(help);
    var license=$.NSAlert.alloc.init;license.messageText=$(words.install_license);license.accessoryView=area;license.addButtonWithTitle($(words.install_accept));license.addButtonWithTitle($(words.install_cancel));if(Number(license.runModal())!==1000)return '';
    return JSON.stringify({language:language,startup:Number(startup.state)===1});
}
