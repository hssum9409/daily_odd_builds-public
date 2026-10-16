// Per-machine startup consent. The UI has its own delegate, independent of settings.
(function (host) {
    var asked = false, prompt = null, actions = {}, activeRemember = null, decided = false;
    function shouldAsk(choice, registered) { return !registered && choice !== 'registered' && choice !== 'never'; }
    function remember(choice) { host.write(host.home + '/startup-settings.json', {choice: choice}); }
    function agentPath() { return ObjC.unwrap($.NSHomeDirectory()) + '/Library/LaunchAgents/com.dailyoddbuilds.worklog-scripts.plist'; }
    function existing() {
        var data = $.NSDictionary.dictionaryWithContentsOfFile($(agentPath()));
        if (!data) return null;
        return ObjC.deepUnwrap(data);
    }
    function owned(agent) { return !!agent && (agent.ProgramArguments || []).indexOf(host.root + '/desktop/macos/Runtime.js') >= 0; }
    function register() {
        var current = existing();
        if (current && !owned(current)) throw new Error('Another login item owns this name');
        $.NSFileManager.defaultManager.createDirectoryAtPathWithIntermediateDirectoriesAttributesError($(agentPath().replace(/\/[^/]+$/, '')), true, $(), $());
        var data = $({Label:'com.dailyoddbuilds.worklog-scripts',ProgramArguments:['/usr/bin/osascript','-l','JavaScript',host.root+'/desktop/macos/Runtime.js'],EnvironmentVariables:{WORKLOG_SCRIPTS_ROOT:host.root,WORKLOG_SCRIPTS_HOME:host.home},RunAtLoad:true,StandardOutPath:host.home+'/startup.log',StandardErrorPath:host.home+'/startup.log'});
        if (!data.writeToFileAtomically($(agentPath()), true)) throw new Error('Could not save login item');
    }
    function createPrompt(onRegister, onRemember) {
        decided = false; activeRemember = onRemember; actions = {};
        var dark = host.isDark(), bg = dark?'#202620':'#F2F0E8', ink = dark?'#F1F1E8':'#353A34', muted = dark?'#B0B9AA':'#767F70';
        var delegate = $.WorklogStartupDelegate.alloc.init;
        var w = $.NSWindow.alloc.initWithContentRectStyleMaskBackingDefer($.NSMakeRect(0,0,460,300), $.NSWindowStyleMaskTitled | $.NSWindowStyleMaskClosable, $.NSBackingStoreBuffered, false);
        w.title = $('성실삐🤖'); w.releasedWhenClosed = false; w.delegate = delegate; w.backgroundColor = host.color(bg,1); w.center;
        var canvas = $.WorklogStartupCanvas.alloc.initWithFrame($.NSMakeRect(0,0,460,300)); w.contentView = canvas;
        function text(value,x,y,width,height,size,color) { var t=$.NSTextField.alloc.initWithFrame($.NSMakeRect(x,y,width,height));t.editable=false;t.selectable=false;t.bezeled=false;t.drawsBackground=false;t.stringValue=$(value);t.font=host.font('korean',size);t.textColor=host.color(color,1);t.cell.wraps=true;canvas.addSubview(t);return t; }
        var robot=$.NSImageView.alloc.initWithFrame($.NSMakeRect(28,24,40,40));robot.image=$.NSImage.alloc.initWithContentsOfFile($(host.root+'/desktop/assets/robot.png'));robot.imageScaling=$.NSImageScaleProportionallyUpOrDown;canvas.addSubview(robot);
        var title=text('컴퓨터를 켜면, 같이 시작할까요?',28,84,404,32,20,ink);title.font=host.font('koreanBold',20);
        text('Mac에 로그인하면 성실삐 위젯을 띄워둘게요.\n업무 시간은 직접 시작할 때부터 기록해요.',28,128,404,48,13,muted);
        var error=text('',28,182,404,32,12,dark?'#E8B9A3':'#A55F4D'), buttons={};
        ['never','later','registered'].forEach(function(choice,index) {
            var b=$.NSButton.alloc.initWithFrame($.NSMakeRect([28,182,294][index],230,[142,100,138][index],38));b.title=$(choice==='registered'?'등록하기':choice==='never'?'다시는 묻지 않음':'나중에');b.bordered=false;b.wantsLayer=true;b.layer.cornerRadius=10;b.layer.backgroundColor=host.color(choice==='registered'?(dark?'#BDDBAE':'#496844'):(dark?'#3B4938':'#DFE5D9'),1).CGColor;b.font=host.font('koreanBold',12);b.contentTintColor=host.color(choice==='registered'?(dark?'#243421':'#FFFFFF'):ink,1);var title=b.attributedTitle.mutableCopy;title.addAttributeValueRange($.NSForegroundColorAttributeName,host.color(choice==='registered'?(dark?'#243421':'#FFFFFF'):ink,1),$.NSMakeRange(0,Number(title.length)));b.attributedTitle=title;b.tag=index;b.target=delegate;b.action='startupChoose:';canvas.addSubview(b);buttons[choice]=b;
            actions[index]=function(){try{if(choice==='registered')onRegister();onRemember(choice);decided=true;w.close;}catch(_){error.stringValue=$('등록하지 못했어요. 권한을 확인한 뒤 다시 시도해 주세요.');}};
        });
        // Keep the delegate alive for the window's lifetime.
        return {window:w,buttons:buttons,delegate:delegate};
    }
    function ensureTypes() {
        if (typeof $ === 'undefined') return;
        ObjC.registerSubclass({name:'WorklogStartupCanvas',superclass:'NSView',methods:{isFlipped:{types:['bool',[]],implementation:function(){return true;}}}});
        ObjC.registerSubclass({name:'WorklogStartupDelegate',superclass:'NSObject',methods:{'startupChoose:':{types:['void',['id']],implementation:function(sender){var action=actions[Number(sender.tag)];if(action)action();}},'windowWillClose:':{types:['void',['id']],implementation:function(){if(!decided&&activeRemember){try{activeRemember('later');}catch(_){}}prompt=null;}}}});
    }
    function showIfNeeded() {
        if (asked || host.disabled) return;
        asked=true;
        var receipt=host.text(host.root+'/installed.txt').trim().split('\n');
        if(receipt[0]!=='WorklogScripts'||receipt[1]!==host.root||receipt[2]==='isolated')return;
        var choice=(host.read(host.home+'/startup-settings.json')||{}).choice, registered=owned(existing());
        if(!shouldAsk(choice,registered)){if(registered&&choice!=='registered')remember('registered');return;}
        prompt=createPrompt(register,remember);prompt.window.makeKeyAndOrderFront($());$.NSApplication.sharedApplication.activateIgnoringOtherApps(true);
    }
    function verify() {
        if(!shouldAsk('later',false)||shouldAsk('registered',false)||shouldAsk('never',false)||shouldAsk('',true))throw new Error('Startup decision policy mismatch');
        var registrations=0,choices=[];
        ['later','never','registered'].forEach(function(choice){var p=createPrompt(function(){registrations++;},function(value){choices.push(value);});p.window.makeKeyAndOrderFront($());p.buttons[choice].performClick($());});
        if(registrations!==1||choices.join(',')!=='later,never,registered')throw new Error('Startup consent controls mismatch');
    }
    ensureTypes();
    return {visible:function(){return !!prompt&&!!prompt.window.visible;},showIfNeeded:showIfNeeded,shouldAsk:shouldAsk,verify:verify,close:function(){if(prompt)prompt.window.close;}};
})
