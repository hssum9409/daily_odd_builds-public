// 실행 세대마다 바뀌는 HWND 대신 프로필별 GUID로 트레이 슬롯을 식별한다.
// 비정상 종료 뒤에도 같은 슬롯을 교체하므로 유령 아이콘이 누적되지 않는다.
using System;
using System.Drawing;
using System.IO;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text;
using System.Windows.Forms;

namespace UsageScripts {
    public sealed class TrayIcon : NativeWindow, IDisposable {
        [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)]
        struct Data {
            public int size; public IntPtr window; public uint id,flags,callback;
            public IntPtr icon;
            [MarshalAs(UnmanagedType.ByValTStr,SizeConst=128)] public string tip;
            public uint state,stateMask;
            [MarshalAs(UnmanagedType.ByValTStr,SizeConst=256)] public string info;
            public uint timeout;
            [MarshalAs(UnmanagedType.ByValTStr,SizeConst=64)] public string title;
            public uint infoFlags; public Guid guid; public IntPtr balloon;
        }
        [DllImport("shell32.dll",CharSet=CharSet.Unicode)] static extern bool Shell_NotifyIcon(uint message,ref Data data);
        [DllImport("user32.dll",CharSet=CharSet.Unicode)] static extern uint RegisterWindowMessage(string name);
        [DllImport("user32.dll")] static extern bool SetForegroundWindow(IntPtr window);
        [DllImport("user32.dll")] static extern bool PostMessage(IntPtr window,uint message,IntPtr w,IntPtr l);
        readonly uint taskbarCreated=RegisterWindowMessage("TaskbarCreated");
        const uint Callback=0x8015;
        bool visible,disposed;
        public Guid Identity { get; private set; }
        public Icon Icon {get;set;}
        public string Text {get;set;}
        public ContextMenuStrip ContextMenuStrip {get;set;}
        public Action<Exception> OnError {get;set;}
        public event EventHandler DoubleClick;
        public TrayIcon(string profile) {
            using(var sha=SHA256.Create()) {
                var hash=sha.ComputeHash(Encoding.UTF8.GetBytes("CodexUsageMonitorScripts:tray:"+Path.GetFullPath(profile).TrimEnd('\\','/').ToLowerInvariant()));
                var bytes=new byte[16];Array.Copy(hash,bytes,16);Identity=new Guid(bytes);
            }
            CreateHandle(new CreateParams {Caption="Codex Usage Monitor tray"});
        }
        Data Packet() {
            return new Data {size=Marshal.SizeOf(typeof(Data)),window=Handle,id=1,
                flags=0x20|1|2|4,callback=Callback,icon=Icon==null?IntPtr.Zero:Icon.Handle,
                tip=Text??"Codex Usage Monitor",guid=Identity};
        }
        public bool Visible {
            get{return visible;}
            set {
                if(disposed || visible==value)return;
                if(value) {
                    // 단일 인스턴스 잠금을 획득한 프로필만 호출한다. 다른 앱/프로필은 삭제하지 않는다.
                    var old=Packet();Shell_NotifyIcon(2,ref old);
                    var data=Packet();Shell_NotifyIcon(0,ref data);visible=true;
                    // Explorer가 재시작 중이면 TaskbarCreated에서 다시 등록한다.
                }else{var data=Packet();Shell_NotifyIcon(2,ref data);visible=false;}
            }
        }
        protected override void WndProc(ref Message message) {
          try {
            if(message.Msg==taskbarCreated && visible){visible=false;Visible=true;}
            if(message.Msg==Callback) {
                var kind=message.LParam.ToInt32();
                if(kind==0x203){var action=DoubleClick;if(action!=null)action(this,EventArgs.Empty);}
                else if(kind==0x205 && ContextMenuStrip!=null) {
                    SetForegroundWindow(Handle);ContextMenuStrip.Show(Cursor.Position);
                    PostMessage(Handle,0,IntPtr.Zero,IntPtr.Zero);
                }
            }
          } catch(Exception error) {
              // 메뉴 동작 실패로 WinForms의 기본 예외 대화상자가 실행 루프를 가로막지 않는다.
              try{if(OnError!=null)OnError(error);}catch{}
          }
            base.WndProc(ref message);
        }
        public void Dispose(){if(disposed)return;try{Visible=false;}finally{disposed=true;DestroyHandle();}}
    }
}
