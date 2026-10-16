const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const core=vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../desktop/macos/Core.js'),'utf8'),{Intl});
const start=Date.parse('2026-10-17T00:00:00Z');
function segment(id,kind,from,to,phase='regular'){return {id,kind,phase,start:start+from,end:to===null?null:start+to,deletedAt:null,title:''};}
function snapshot(status,segments,segmentId,date='2026-10-17'){const day={date,segments,clockedOutAt:status==='off'?start+3000:null};return {state:{status,segmentId,dayId:date,timeZone:'Asia/Seoul'},activeDay:day,days:[day]};}
test('widget clock is cumulative work and stays frozen throughout rest',()=>{
 const data=snapshot('break',[segment('w','work',0,5000),segment('b','break',5000,null)],'b');
 assert.equal(core.view(data,start+8000).clock,'00:00:05');assert.equal(core.view(data,start+300000).clock,'00:00:05');assert.equal(core.view(data,start+300000).primary,'resume');
 data.activeDay.segments[1].end=start+300000;data.activeDay.segments.push(segment('w2','work',300000,null));data.state.status='working';data.state.segmentId='w2';
 assert.equal(core.view(data,start+310000).clock,'00:00:15');assert.equal(core.view(data,start+310000).primary,'pause');
});
test('deleted segments and off-duty gaps never inflate regular plus overtime total',()=>{
 const removed=segment('gone','work',3000,10000);removed.deletedAt=start+11000;
 const v=core.view(snapshot('overtime',[segment('w','work',0,3000),removed,segment('ot','work',20000,null,'overtime')],'ot'),start+25000);
 assert.equal(v.work,8000);assert.equal(v.secondary,'clockOut');
});
test('today widget follows workday attribution while overnight controls still operate',()=>{
 const v=core.view(snapshot('working',[segment('w','work',0,null)],'w'),start+86400000);
 assert.equal(v.today,'2026-10-18');assert.equal(v.work,0);assert.equal(v.primary,'pause');
});
test('curl configuration cannot escape quoted values with line breaks or quotes',()=>{
 assert.equal(core.curlValue('a"b\nc\\d\r'),'"a\\"b\\nc\\\\d\\r"');
});
test('rest counter measures only the current rest while the work clock stays frozen',()=>{
 const data=snapshot('break',[segment('w','work',0,5000),segment('b1','break',5000,10000),segment('w2','work',10000,20000),segment('b2','break',20000,null)],'b2');
 const a=core.view(data,start+23000),b=core.view(data,start+31000);
 assert.equal(a.clock,'00:00:15');assert.equal(b.clock,a.clock);assert.equal(a.restClock,'00:00:03');assert.equal(b.restClock,'00:00:11');assert.equal(b.rest,16000);
});
test('ratio timeline excludes off-duty gaps and deleted records',()=>{
 const gone=segment('gone','work',3000,5000);gone.deletedAt=start+20000;
 const bar=core.timeline({segments:[segment('b','break',6000,null),gone,segment('w','work',0,3000)]},start+10000);
 assert.equal(bar.rows.length,2);assert.equal(bar.rows[0].id,'w');assert.equal(bar.rows[0].left,0);assert.equal(bar.rows[0].width,3/7);assert.equal(bar.rows[1].kind,'break');assert.equal(bar.rows[1].left,3/7);assert.equal(bar.rows[1].width,4/7);
 assert.equal(core.timeline(undefined,start).rows.length,0);
 const completed=core.timeline({segments:[segment('w','work',0,3000)]},start+300000);assert.equal(completed.progress,1);assert.equal(completed.rows[0].width,1);
});
test('first clock-in fills the whole ratio bar even at zero elapsed time',()=>{
 const bar=core.timeline({segments:[segment('first','work',0,null)]},start);
 assert.equal(bar.progress,1);assert.equal(bar.rows[0].width,1);
});
test('goal progress excludes breaks and partitions only the filled half at 4:1',()=>{
 const hour=3600000,day={segments:[segment('w','work',0,4*hour),segment('b','break',4*hour,null)]};
 const bar=core.timeline(day,start+5*hour,8*hour);
 assert.equal(bar.progress,.5);assert.equal(bar.rows[0].width,.4);assert.equal(bar.rows[1].left,.4);assert.equal(bar.rows[1].width,.1);
 assert.equal(core.timeline(day,start+6*hour,8*hour).progress,.5);
 assert.equal(core.timeline(day,start+6*hour,null).progress,1);
 assert.equal(core.timeline({segments:[segment('w','work',0,10*hour)]},start+10*hour,8*hour).progress,1);
});
test('welcome is only for the first work start of the selected workday',()=>{
 assert.equal(core.view(snapshot('idle',[],null),start).firstStart,true);
 const day=snapshot('off',[segment('w','work',0,5000)],null);
 assert.equal(core.view(day,start+6000).firstStart,false);
 day.activeDay.segments[0].deletedAt=start+6000;
 assert.equal(core.view(day,start+7000).firstStart,false);
 assert.equal(core.view(day,start+86400000).firstStart,true);
 const overnight=snapshot('working',[segment('w','work',0,null)],'w');
 assert.equal(core.view(overnight,start+86400000).firstStart,false);
 const missing=snapshot('working',[],'not-yet-loaded');
 assert.equal(core.view(missing,start).firstStart,false);
});

test('completed workday offers restart while an empty next day offers first start',()=>{
 const data=snapshot('off',[segment('w','work',0,5000)],null);
 const completed=core.view(data,start+6000);
 assert.equal(completed.completed,true);assert.equal(completed.firstStart,false);assert.equal(completed.primary,'clockIn');
 const next=core.view(data,start+86400000);
 assert.equal(next.completed,false);assert.equal(next.firstStart,true);
 data.activeDay.segments[0].deletedAt=start+6000;
 assert.equal(core.view(data,start+7000).completed,true);
});

test('a running or unresolved segment never exposes the completed-day exit state',()=>{
 assert.equal(core.view(snapshot('working',[segment('w','work',0,null)],'w'),start+3000).completed,false);
 assert.equal(core.view(snapshot('break',[segment('w','work',0,1000),segment('r','break',1000,null)],'r'),start+3000).completed,false);
 assert.equal(core.view(snapshot('working',[],'not-yet-loaded'),start+3000).completed,false);
});
test('two opacity settings preserve legacy customization and stay usable',()=>{
 assert.equal(core.appearance().idle,.45);assert.equal(core.appearance().hover,.95);
 assert.equal(core.appearance({opacity:.8}).hover,.8);
 const custom=core.appearance({opacity:.8,opacityIdle:.25,opacityHover:.9});
 assert.equal(custom.idle,.25);assert.equal(custom.hover,.9);
 assert.equal(core.appearance({opacityIdle:0,opacityHover:2}).idle,.1);
 assert.equal(core.appearance({opacityIdle:NaN,opacityHover:Infinity}).hover,.95);
});

const themes=JSON.parse(fs.readFileSync(path.join(__dirname,'../desktop/themes.json'),'utf8'));
test('cream is the default and old default design migrates without resetting opacity',()=>{
 assert.equal(core.design(null,themes).theme,'cream');
 assert.equal(core.design(null,themes).color,'#F5F1E8');
 const migrated=core.design({color:'#202020',text:'#F8F8F8',opacity:.7,opacityIdle:.25,x:12,y:24,showRest:true},themes);
 assert.equal(migrated.theme,'cream');assert.equal(migrated.opacityHover,.7);assert.equal(migrated.opacityIdle,.25);assert.equal(migrated.x,12);assert.equal(migrated.showRest,true);
});
test('dark selection and previous custom colors survive normalization',()=>{
 const dark=core.design({theme:'dark',color:'#FFFFFF'},themes);
 assert.equal(dark.color,'#292C29');assert.equal(core.palette(dark,themes).text,'#F1F1E8');
 const saved={color:'#dde8dc',text:'#102030',autoText:false,pinned:false};
 const custom=core.design(saved,themes);assert.equal(custom.theme,'custom');assert.equal(custom.color,'#DDE8DC');assert.equal(custom.pinned,false);assert.equal(core.palette(custom,themes).text,'#102030');
 assert.equal(core.design(custom,themes).theme,'custom');
 assert.equal(core.design({theme:'custom',color:'bad',text:null},themes).color,'#F5F1E8');
});
test('theme text and essential controls retain readable contrast',()=>{
 function luminance(hex){return hex.slice(1).match(/../g).map(h=>parseInt(h,16)/255).map(c=>c<=.04045?c/12.92:((c+.055)/1.055)**2.4).reduce((sum,c,i)=>sum+c*[.2126,.7152,.0722][i],0);}
 function contrast(a,b){const values=[luminance(a),luminance(b)].sort((a,b)=>b-a);return (values[0]+.05)/(values[1]+.05);}
 for(const key of ['cream','dark']){const p=core.palette(core.design({theme:key},themes),themes);assert.ok(contrast(p.color,p.text)>=7,key+' text');assert.ok(contrast(p.button,p.icon)>=4.5,key+' toggle');}
 const custom=core.design({theme:'custom',color:'#222222'},themes);assert.equal(core.palette(custom,themes).text,themes.dark.text);
});


test('startup consent asks again only after later and never silently re-enables registration',()=>{
 const startup=vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../desktop/macos/StartupConsent.js'),'utf8'),{})({});
 assert.equal(startup.shouldAsk('',false),true);
 assert.equal(startup.shouldAsk('later',false),true);
 assert.equal(startup.shouldAsk('never',false),false);
 assert.equal(startup.shouldAsk('registered',false),false);
 assert.equal(startup.shouldAsk('',true),false);
});
