// 작업표시줄의 빈 공간에 독립 도구 창을 배치한다. Explorer는 수정하지 않는다.
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Threading.Tasks;
using System.Windows.Automation;
namespace UsageScripts {
    public sealed class TaskbarSlot {public long Hwnd;public int X,Y,Width,Height;public double Stamp,Scale;}
    public static class TaskbarHost {
        [StructLayout(LayoutKind.Sequential)] struct Rect {public int l,t,r,b;}
        [StructLayout(LayoutKind.Sequential)] struct Point {public int x,y;}
        [DllImport("user32.dll",CharSet=CharSet.Unicode)]static extern IntPtr FindWindow(string cls,string title);
        [DllImport("user32.dll",CharSet=CharSet.Unicode)]static extern IntPtr FindWindowEx(IntPtr parent,IntPtr after,string cls,string title);
        [DllImport("user32.dll")]static extern bool GetWindowRect(IntPtr hwnd,out Rect rect);
        [DllImport("user32.dll",CharSet=CharSet.Unicode)]static extern int GetClassName(IntPtr hwnd,System.Text.StringBuilder text,int capacity);
        [DllImport("user32.dll")]static extern bool ScreenToClient(IntPtr hwnd,ref Point point);
        [DllImport("user32.dll")]static extern uint GetDpiForWindow(IntPtr hwnd);
        [DllImport("user32.dll")]static extern IntPtr SetThreadDpiAwarenessContext(IntPtr value);
        [DllImport("user32.dll")]static extern IntPtr GetWindow(IntPtr hwnd,uint command);
        [DllImport("user32.dll")]static extern IntPtr GetForegroundWindow();
        [DllImport("user32.dll")]static extern bool AllowSetForegroundWindow(uint process);
        [DllImport("user32.dll")]static extern bool PostMessage(IntPtr hwnd,uint message,IntPtr wparam,IntPtr lparam);
        public static void Signal(long handle){if(handle!=0)PostMessage(new IntPtr(handle),0x8271,IntPtr.Zero,IntPtr.Zero);}
        public static void AllowForeground(int process){AllowSetForegroundWindow((uint)process);}
        [DllImport("user32.dll")]static extern IntPtr MonitorFromWindow(IntPtr hwnd,uint flags);
        [StructLayout(LayoutKind.Sequential)]struct MonitorInfo{public int size;public Rect monitor,work;public uint flags;}
        [DllImport("user32.dll")]static extern bool GetMonitorInfo(IntPtr monitor,ref MonitorInfo info);
        [DllImport("user32.dll")]static extern int GetWindowLong(IntPtr hwnd,int index);
        [DllImport("user32.dll")]static extern bool IsWindow(IntPtr hwnd);
        [DllImport("user32.dll")]static extern bool IsWindowVisible(IntPtr hwnd);
        [DllImport("user32.dll")]static extern IntPtr WindowFromPoint(Point point);
        [DllImport("user32.dll")]static extern IntPtr GetAncestor(IntPtr hwnd,uint flags);
        [DllImport("dwmapi.dll")]static extern int DwmGetWindowAttribute(IntPtr hwnd,int attribute,out int value,int size);
        [DllImport("user32.dll",SetLastError=true)]static extern bool SetWindowPos(IntPtr hwnd,IntPtr after,int x,int y,int w,int h,uint flags);
        static volatile bool busy;public static volatile TaskbarSlot Current;public static volatile string Status="starting";public static volatile string LayoutFacts="";public static volatile string PlacementState="";
        public static volatile bool SurfaceHit,DiagnosticsEnabled;public static volatile int AnchorLeft;public static volatile string AnchorKind="";
        public static volatile int PreferredWidthDip=104;
        static string anchorSignature="",cachedAnchorKind="";static int cachedAnchor;static DateTime nextAnchorCheck;
        public static bool Busy{get{return busy;}}
        public static TaskbarSlot GetSlot(){return Current;}
        public static bool IsPlaced(IntPtr hwnd,TaskbarSlot slot){
            if(slot==null || !IsWindow(hwnd) || !IsWindowVisible(hwnd) || (GetWindowLong(hwnd,-20)&8)==0)return false;
            var previous=SetThreadDpiAwarenessContext(new IntPtr(-4));
            try{Rect actual,bar;return GetWindowRect(hwnd,out actual) && GetWindowRect(new IntPtr(slot.Hwnd),out bar) && actual.l==bar.l+slot.X && actual.t==bar.t+slot.Y && actual.r-actual.l==slot.Width && actual.b-actual.t==slot.Height;}
            finally{if(previous!=IntPtr.Zero)SetThreadDpiAwarenessContext(previous);}
        }
        public static bool Attach(IntPtr hwnd,TaskbarSlot slot){
            SurfaceHit=false;PlacementState="checking";var parent=new IntPtr(slot.Hwnd);Rect bar;if(!IsWindow(parent)){PlacementState="missing-parent";return false;}
            var previous=SetThreadDpiAwarenessContext(new IntPtr(-4));
            try{
                if(!GetWindowRect(parent,out bar)){PlacementState="missing-bounds";return false;}
                var monitor=new MonitorInfo();monitor.size=Marshal.SizeOf(typeof(MonitorInfo));
                if(GetMonitorInfo(MonitorFromWindow(parent,2),ref monitor)){
                    if(Math.Min(bar.b,monitor.monitor.b)-Math.Max(bar.t,monitor.monitor.t)<(bar.b-bar.t)/2){PlacementState="auto-hidden";return false;}
                    var foreground=GetForegroundWindow();Rect front;var cls=new System.Text.StringBuilder(80);GetClassName(foreground,cls,80);
                    if(foreground!=parent && foreground!=hwnd && cls.ToString()!="Progman" && cls.ToString()!="WorkerW" && (GetWindowLong(foreground,-16)&0xC00000)==0 && GetWindowRect(foreground,out front) && front.l<=monitor.monitor.l && front.t<=monitor.monitor.t && front.r>=monitor.monitor.r && front.b>=monitor.monitor.b){PlacementState="fullscreen-"+cls;return false;}
                }
                // 스타일은 WinForms 생성 시 한 번 정한다. 매 틱 SetWindowLong으로
                // 다시 쓰면 프레임워크의 창 순서 복구와 충돌할 수 있다.
                // 이미 같은 자리에 보이면 Z 순서·좌표를 다시 쓰지 않는다. 전체 화면/자동 숨김 검사는 위에서 유지한다.
                bool placed=IsPlaced(hwnd,slot) || SetWindowPos(hwnd,new IntPtr(-1),bar.l+slot.X,bar.t+slot.Y,slot.Width,slot.Height,0x0050);
                if(placed && !DiagnosticsEnabled){PlacementState="placed";return true;}
                int placementError=placed?0:Marshal.GetLastWin32Error();Rect actual;GetWindowRect(hwnd,out actual);
                var hit=GetAncestor(WindowFromPoint(new Point{x=(actual.l+actual.r)/2,y=(actual.t+actual.b)/2}),2);var hitClass=new System.Text.StringBuilder(100);GetClassName(hit,hitClass,100);int cloaked=0;DwmGetWindowAttribute(hwnd,14,out cloaked,4);
                SurfaceHit=hit==hwnd && cloaked==0;
                PlacementState="placed="+placed+";error="+placementError+";bounds="+actual.l+","+actual.t+","+actual.r+","+actual.b+";exStyle="+GetWindowLong(hwnd,-20).ToString("X")+";surfaceHit="+SurfaceHit+";hitClass="+hitClass+";cloaked="+cloaked;
                return placed;
            }finally{if(previous!=IntPtr.Zero)SetThreadDpiAwarenessContext(previous);}
        }
        public static void Refresh(){
            if(busy)return;busy=true;
            Task.Run(delegate{
                var previous=SetThreadDpiAwarenessContext(new IntPtr(-4));
                try{
                    var host=FindWindow("Shell_TrayWnd",null);Rect bar,tray;
                    var notification=FindWindowEx(host,IntPtr.Zero,"TrayNotifyWnd",null);
                    if(host==IntPtr.Zero || !IsWindowVisible(host) || !GetWindowRect(host,out bar) || notification==IntPtr.Zero || !GetWindowRect(notification,out tray) || bar.r-bar.l<bar.b-bar.t){Current=null;Status="unsupported-or-hidden";return;}
                    double scale=(GetDpiForWindow(host)>0 ? GetDpiForWindow(host):96)/96.0;
                    int width=(int)Math.Ceiling(Math.Max(96,Math.Min(264,PreferredWidthDip))*scale),height=bar.b-bar.t,gap=(int)Math.Ceiling(8*scale);
                    var blocked=new List<Rect>();blocked.Add(tray);
                    // 앱 버튼 등 점유 영역은 가벼운 native 경계 조회로 확인한다.
                    var facts=new System.Text.StringBuilder("bar="+bar.l+","+bar.t+","+bar.r+","+bar.b+";tray="+tray.l+","+tray.r+";children=");
                    IntPtr child=IntPtr.Zero;
                    int found=0;
                    while((child=FindWindowEx(host,child,null,null))!=IntPtr.Zero){
                        Rect box;var cls=new System.Text.StringBuilder(200);GetClassName(child,cls,200);
                        if(!GetWindowRect(child,out box))continue;
                        facts.Append(cls+":"+box.l+","+box.t+","+box.r+","+box.b+";");
                        if((cls.ToString()=="ReBarWindow32" || cls.ToString()=="Start" || cls.ToString()=="TrayDummySearchControl") && IsWindowVisible(child) && box.r>box.l){blocked.Add(new Rect{l=box.l-gap,r=box.r+gap,t=box.t,b=box.b});found++;}
                    }
                    LayoutFacts=facts.ToString();
                    if(found==0){Current=null;Status="unconfirmed-layout";return;}
                    using(var key=Microsoft.Win32.Registry.CurrentUser.OpenSubKey(@"Software\Microsoft\Windows\CurrentVersion\Explorer\Advanced")){
                        if(key!=null && Convert.ToInt32(key.GetValue("TaskbarAl",1))==0 && Convert.ToInt32(key.GetValue("TaskbarDa",0))!=0)tray.l-=(int)Math.Ceiling(200*scale);
                    }
                    // 시계가 아니라 숨겨진 아이콘 화살표의 실제 경계를 우선한다.
                    // 공급자 조회는 배경 작업에서만 실행하여 UI 스레드를 막지 않는다.
                    string signature=host+":"+bar.l+","+bar.t+","+bar.r+","+bar.b+":"+tray.l+","+tray.r;
                    if(signature!=anchorSignature || DateTime.UtcNow>=nextAnchorCheck){
                      int anchor=tray.l;string anchorKind="notification-area-fallback";
                      try{
                        var element=AutomationElement.FromHandle(host);
                        var buttons=element.FindAll(TreeScope.Descendants,new PropertyCondition(AutomationElement.ControlTypeProperty,ControlType.Button));
                        foreach(AutomationElement button in buttons){
                            var current=button.Current;string id=current.AutomationId??"",cls=current.ClassName??"",name=current.Name??"";
                            if(id=="OverflowButton" || cls=="SystemTray.OverflowButton" || name.IndexOf("숨겨진 아이콘",StringComparison.OrdinalIgnoreCase)>=0 || name.IndexOf("hidden icons",StringComparison.OrdinalIgnoreCase)>=0){
                                var box=current.BoundingRectangle;
                                if(!current.IsOffscreen && box.Width>0 && box.Left>=bar.l && box.Right<=bar.r && box.Bottom>bar.t && box.Top<bar.b){anchor=(int)Math.Floor(box.Left);anchorKind="hidden-icons-button";break;}
                            }
                        }
                      }catch{}
                      cachedAnchor=anchor;cachedAnchorKind=anchorKind;anchorSignature=signature;nextAnchorCheck=DateTime.UtcNow.AddSeconds(30);
                    }
                    AnchorLeft=cachedAnchor;AnchorKind=cachedAnchorKind;
                    LayoutFacts+="anchor="+AnchorKind+":"+AnchorLeft+";";
                    int edge=Math.Min(Math.Min(AnchorLeft,tray.l)-gap,bar.r-gap);bool collision;
                    do{collision=false;foreach(var item in blocked){if(edge-width<item.r && edge>item.l){edge=item.l-gap;collision=true;break;}}}while(collision && edge-width>=bar.l+gap);
                    if(edge-width<bar.l+gap || height<20){Current=null;Status="no-space";return;}
                    var point=new Point{x=edge-width,y=bar.t};if(!ScreenToClient(host,ref point)){Current=null;return;}
                    Current=new TaskbarSlot{Hwnd=host.ToInt64(),X=point.x,Y=point.y,Width=width,Height=height,Scale=scale,Stamp=DateTimeOffset.UtcNow.ToUnixTimeSeconds()};
                    Status="ready";
                }catch{Current=null;Status="layout-unavailable";}finally{if(previous!=IntPtr.Zero)SetThreadDpiAwarenessContext(previous);busy=false;}
            });
        }
    }
}
