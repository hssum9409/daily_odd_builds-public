// Win32 메시지마다 PowerShell을 호출하지 않는다. 필요한 자체 메시지만 Dispatcher로 전달한다.
using System;
using System.IO;
using System.Windows.Interop;
using System.Windows.Threading;
namespace UsageScripts {
    public sealed class WindowSignals : IDisposable {
        readonly HwndSource source;readonly HwndSourceHook hook;readonly string errorPath;
        Action command,geometry;bool queued,disposed;DateTime lastError;
        public bool NoActivate {get;set;}
        public IntPtr Handle {get{return source.Handle;}}
        public WindowSignals(IntPtr handle,string log){
            source=HwndSource.FromHwnd(handle);if(source==null)throw new ArgumentException("Missing HwndSource");
            errorPath=log;hook=Receive;source.AddHook(hook);source.Disposed+=delegate{disposed=true;command=geometry=null;};
        }
        public void SetActions(Action onCommand,Action onGeometry){command=onCommand;geometry=onGeometry;}
        IntPtr Receive(IntPtr hwnd,int message,IntPtr wparam,IntPtr lparam,ref bool handled){
            if(message==0x21 && NoActivate){handled=true;return new IntPtr(3);}
            if(message==0x8271)Queue(false);
            else if(message==0x8272 && NoActivate)Queue(true);
            return IntPtr.Zero;
        }
        void Queue(bool layout){
            if(disposed || (layout && queued))return;
            var action=layout?geometry:command;if(action==null)return;if(layout)queued=true;
            source.Dispatcher.BeginInvoke(DispatcherPriority.Background,new Action(delegate{
                if(layout)queued=false;if(disposed)return;
                try{action();}catch(Exception e){Log(layout?"geometry":"command",e);}
            }));
        }
        void Log(string stage,Exception error){
            // UI 명령 오류만 남긴다. 입력 문자열·계정 응답·인증정보는 취급하지 않는다.
            if(String.IsNullOrEmpty(errorPath) || (DateTime.UtcNow-lastError).TotalSeconds<1)return;lastError=DateTime.UtcNow;
            try{string message=(error.Message??"").Replace('\r',' ').Replace('\n',' ');if(message.Length>500)message=message.Substring(0,500);
                File.AppendAllText(errorPath,DateTime.UtcNow.ToString("o")+" "+stage+" "+error.GetType().FullName+" "+message+Environment.NewLine);
            }catch{}
        }
        public void Dispose(){if(disposed)return;source.RemoveHook(hook);disposed=true;command=geometry=null;}
    }
}
