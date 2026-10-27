// 데이터 확인은 500ms, 부드러운 상태 전환은 입력 직후에만 실행한다.
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Windows.Forms;
using System.Web.Script.Serialization;
namespace UsageScripts {
    public sealed class TaskbarWidget : Form {
        readonly string statePath,reportPath;readonly int parentId;readonly long parentStamp;long commandHwnd;
        readonly ToolTip tooltip=new ToolTip();readonly Timer timer=new Timer(),animation=new Timer();
        readonly JavaScriptSerializer json=new JavaScriptSerializer();readonly Dictionary<string,object> report=new Dictionary<string,object>();
        TaskbarReading[] readings=new TaskbarReading[0];TaskbarSlot slot;
        bool light=true,remaining,hovered,pressed,dirty=true;float hover;double nextScan,nextParentCheck;string designKey="",tipKey="",basis="",capturedKey="";
        Dictionary<string,object> cachedState;long stateLength=-1,stateStamp;
        protected override bool ShowWithoutActivation{get{return true;}}
        // 스타일을 나중에 덮어쓰지 않고 레이어·비활성·최상위 속성을 생성 시 정한다.
        protected override CreateParams CreateParams{get{var p=base.CreateParams;p.ExStyle|=0x08080088;return p;}}
        static double Now(){return DateTimeOffset.UtcNow.ToUnixTimeSeconds();}
        public TaskbarWidget(string path,int parent,string diagnostic){
            statePath=path;parentId=parent;reportPath=diagnostic;
            TaskbarHost.DiagnosticsEnabled=!String.IsNullOrEmpty(diagnostic);
            using(var process=Process.GetProcessById(parent))parentStamp=process.StartTime.ToUniversalTime().Ticks;
            Text="Codex Usage Monitor - taskbar";FormBorderStyle=FormBorderStyle.None;ShowInTaskbar=false;TopMost=true;
            StartPosition=FormStartPosition.Manual;Location=new Point(-32000,-32000);Size=new Size(104,48);AutoScaleMode=AutoScaleMode.None;
            Cursor=Cursors.Hand;AccessibleRole=AccessibleRole.PushButton;
            report["parentId"]=parent;report["workerPid"]=Process.GetCurrentProcess().Id;report["extraAccountRequests"]=0;report["error"]=null;
            timer.Interval=500;timer.Tick+=delegate{TickWidget();};timer.Start();
            animation.Interval=16;animation.Tick+=delegate{
                float target=hovered?1:0;hover+=(target-hover)*0.32f;
                if(Math.Abs(target-hover)<0.015f){hover=target;animation.Stop();}
                try{DrawSurface();}catch(Exception e){report["error"]=e.GetType().FullName;animation.Stop();HideWidget();}
            };
        }
        protected override void OnMouseEnter(EventArgs e){base.OnMouseEnter(e);hovered=true;animation.Start();}
        protected override void OnMouseLeave(EventArgs e){base.OnMouseLeave(e);hovered=false;pressed=false;animation.Start();}
        protected override void OnMouseDown(MouseEventArgs e){base.OnMouseDown(e);if(e.Button==MouseButtons.Left){pressed=true;Capture=true;DrawSurface();}}
        protected override void OnMouseUp(MouseEventArgs e){base.OnMouseUp(e);if(e.Button==MouseButtons.Left){pressed=false;Capture=false;DrawSurface();}}
        protected override void OnMouseCaptureChanged(EventArgs e){base.OnMouseCaptureChanged(e);if(pressed){pressed=false;dirty=true;}}
        protected override void OnMouseClick(MouseEventArgs e){
            base.OnMouseClick(e);if(e.Button!=MouseButtons.Left || !ClientRectangle.Contains(e.Location))return;
            TaskbarHost.AllowForeground(parentId);string folder=Path.Combine(Path.GetDirectoryName(statePath),"commands");
            try{if(Directory.Exists(folder)){
                string path=Path.Combine(folder,Guid.NewGuid().ToString("N"));
                File.WriteAllText(path+".tmp",json.Serialize(new{command="settings",requestedAt=DateTimeOffset.UtcNow.ToUnixTimeMilliseconds()}));
                File.Move(path+".tmp",path+".json");TaskbarHost.Signal(commandHwnd);
            }}catch{}
        }
        static object Get(Dictionary<string,object> state,string key){object value;return state.TryGetValue(key,out value)?value:null;}
        Dictionary<string,object> ReadState(){
            try{
                var file=new FileInfo(statePath);
                if(!file.Exists || file.Length>32768){cachedState=null;return null;}
                long stamp=file.LastWriteTimeUtc.Ticks,length=file.Length;
                if(cachedState!=null && stamp==stateStamp && length==stateLength)return cachedState;
                using(var stream=new FileStream(statePath,FileMode.Open,FileAccess.Read,FileShare.ReadWrite|FileShare.Delete)){
                if(stream.Length>32768)return null;
                using(var reader=new StreamReader(stream))cachedState=json.DeserializeObject(reader.ReadToEnd()) as Dictionary<string,object>;
                stateStamp=stamp;stateLength=length;return cachedState;
            }}catch{return null;}
        }
        void HideWidget(){animation.Stop();hovered=pressed=false;hover=0;dirty=true;if(Visible)Hide();}
        void ApplyState(Dictionary<string,object> state){
            commandHwnd=Convert.ToInt64(Get(state,"commandHwnd")??0);
            string tip=Convert.ToString(Get(state,"tooltip"));if(tip!=tipKey){tipKey=tip;tooltip.SetToolTip(this,tip);AccessibleName=tip;}
            string key=json.Serialize(new[]{Get(state,"items"),Get(state,"light"),Get(state,"remaining"),Get(state,"basis")});if(key==designKey)return;designKey=key;
            light=Object.Equals(Get(state,"light"),true);remaining=Object.Equals(Get(state,"remaining"),true);basis=Convert.ToString(Get(state,"basis"));
            var list=new List<TaskbarReading>();var items=Get(state,"items") as object[];
            if(items!=null)foreach(var raw in items){
                var item=raw as Dictionary<string,object>;if(item==null || list.Count>=2)continue;
                double number;double? value=null;
                if(Get(item,"used")!=null && Double.TryParse(Convert.ToString(Get(item,"used"),System.Globalization.CultureInfo.InvariantCulture),System.Globalization.NumberStyles.Float,System.Globalization.CultureInfo.InvariantCulture,out number) && !Double.IsNaN(number) && !Double.IsInfinity(number))value=Math.Max(0,Math.Min(100,number));
                list.Add(new TaskbarReading{Label=Convert.ToString(Get(item,"label")),Detail=Convert.ToString(Get(item,"detail")),Used=value,Weekly=Object.Equals(Get(item,"weekly"),true)});
            }
            readings=list.ToArray();int width=TaskbarDesign.WidthDip(readings.Length);
            if(TaskbarHost.PreferredWidthDip!=width){TaskbarHost.PreferredWidthDip=width;nextScan=0;}
            dirty=true;
        }
        void DrawSurface(){
            if(slot==null || !Visible)return;
            using(var bitmap=TaskbarDesign.Render(slot.Width,slot.Height,(float)slot.Scale,light,readings,remaining,basis,hover,pressed)){
                TaskbarLayer.Upload(Handle,bitmap);
                string captureKey=designKey+":"+slot.Width+":"+slot.Height;
                if(!String.IsNullOrEmpty(reportPath) && capturedKey!=captureKey){bitmap.Save(reportPath+".png");capturedKey=captureKey;}
            }
            dirty=false;
        }
        void TickWidget(){
            try{
                double now=Now();
                // 부모 확인은 5초마다, 상태 파일은 변경 시에만 해석한다. 만료 판정은 매 틱 유지한다.
                if(now>=nextParentCheck){
                    try{using(var parent=Process.GetProcessById(parentId)){if(parent.StartTime.ToUniversalTime().Ticks!=parentStamp){Close();return;}}}catch{Close();return;}
                    nextParentCheck=now+5;
                }
                var previous=cachedState;var state=ReadState();
                if(state==null || !Object.Equals(Get(state,"enabled"),true) || now-Convert.ToDouble(Get(state,"at"))>15){HideWidget();return;}
                if(!Object.ReferenceEquals(previous,state))ApplyState(state);if(now>=nextScan){TaskbarHost.Refresh();nextScan=now+2;}
                var next=TaskbarHost.GetSlot();if(next==null || now-next.Stamp>5){HideWidget();return;}
                if(slot==null || slot.Width!=next.Width || slot.Height!=next.Height || slot.Scale!=next.Scale)dirty=true;slot=next;
                if(TaskbarHost.Attach(Handle,slot)){
                    if(!Visible){Show();dirty=true;}if(dirty)DrawSurface();
                    report["width"]=slot.Width;report["height"]=slot.Height;report["readingCount"]=readings.Length;report["light"]=light;
                }else HideWidget();
            }catch(Exception error){report["error"]=error.GetType().FullName;HideWidget();}
            finally{if(!IsDisposed && !String.IsNullOrEmpty(reportPath)){report["placed"]=TaskbarHost.IsPlaced(Handle,slot);report["visible"]=Visible;report["surfaceHit"]=TaskbarHost.SurfaceHit;report["anchorKind"]=TaskbarHost.AnchorKind;report["anchorLeft"]=TaskbarHost.AnchorLeft;report["layered"]=true;report["animationActive"]=animation.Enabled;report["reason"]=TaskbarHost.Status;report["phase"]=TaskbarHost.PlacementState;Save(reportPath,report);}}
        }
        void Save(string path,object value){
            if(String.IsNullOrEmpty(path))return;string temp=path+"."+Process.GetCurrentProcess().Id+".tmp";
            try{File.WriteAllText(temp,json.Serialize(value));if(File.Exists(path))File.Replace(temp,path,null);else File.Move(temp,path);}catch{}finally{try{if(File.Exists(temp))File.Delete(temp);}catch{}}
        }
        protected override void Dispose(bool disposing){if(disposing){timer.Stop();timer.Dispose();animation.Stop();animation.Dispose();tooltip.Dispose();}base.Dispose(disposing);}
        public static void Run(string path,int parent,string report){
            Application.SetUnhandledExceptionMode(UnhandledExceptionMode.CatchException);
            using(var widget=new TaskbarWidget(path,parent,report)){
                System.Threading.ThreadExceptionEventHandler handler=delegate(object sender,System.Threading.ThreadExceptionEventArgs e){widget.Save(String.IsNullOrEmpty(report)?null:report+".exception.json",new{error=e.Exception.GetType().FullName,detail=e.Exception.Message});widget.HideWidget();};
                Application.ThreadException+=handler;try{Application.Run(widget);}finally{Application.ThreadException-=handler;}
            }
        }
    }
}
