// PowerShell에 없는 비동기 I/O와 읽기 전용 Win32/UIA 접근만 맡는다.
// 독립 exe를 설치하지 않고 Windows 기본 .NET Framework로 메모리에서 컴파일한다.
using System;
using System.Collections.Generic;
using System.Collections.Concurrent;
using System.Diagnostics;
using System.IO;
using System.Net;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using System.Web.Script.Serialization;
using System.Windows.Automation;

namespace UsageScripts {
    public sealed class Rpc : IDisposable {
        readonly ConcurrentQueue<string> lines = new ConcurrentQueue<string>();
        readonly JavaScriptSerializer json = new JavaScriptSerializer { MaxJsonLength = 2097152 };
        readonly object gate = new object();
        Process process;
        int nextId;
        bool initialized;
        volatile bool disposed;
        public volatile bool Busy;
        public volatile bool Dirty;
        public string Result;
        public string Error;
        public string Executable;
        // 기본은 Codex stdio 서버다. 격리 전송 QA는 OS 내장 스크립트 서버로 대체한다.
        public string ServerArguments = "app-server --listen stdio://";
        public string ClientVersion = "1.4.3";
        public int TimeoutMilliseconds = 20000;
        public int OwnedPid { get { return process == null ? 0 : process.Id; } }
        public Rpc(string path) { Executable = path; }
        void Start() { lock (gate) {
            if (disposed) throw new ObjectDisposedException("Rpc");
            var p = new Process();
            p.StartInfo = new ProcessStartInfo(Executable, ServerArguments) {
                UseShellExecute = false, CreateNoWindow = true,
                RedirectStandardInput = true, RedirectStandardOutput = true, RedirectStandardError = true,
                StandardOutputEncoding = Encoding.UTF8, StandardErrorEncoding = Encoding.UTF8
            };
            if (!p.Start()) throw new IOException("start");
            process = p;
            // stderr에는 계정 정보가 포함될 수 있으므로 기록하거나 UI에 전달하지 않는다.
            p.ErrorDataReceived += delegate { };
            p.BeginErrorReadLine();
            Task.Run(delegate {
                try {
                    string line;
                    while (!disposed && (line = p.StandardOutput.ReadLine()) != null) {
                        if (line.Length <= 2097152) {
                            if (line.Contains("account/rateLimits/updated")) Dirty=true;
                            lines.Enqueue(line);
                        }
                    }
                } catch { }
            });
        } }
        object Call(string method, object parameters) {
            // 호출 범위를 고정하여 채팅 생성이나 초기화권 사용 요청을 보낼 수 없게 한다.
            if (method != "initialize" && method != "account/read" && method != "account/rateLimits/read") throw new InvalidOperationException("method");
            int id = ++nextId;
            var message = new Dictionary<string, object> { {"id", id}, {"method", method} };
            if (parameters != null) message["params"] = parameters;
            process.StandardInput.WriteLine(json.Serialize(message));
            process.StandardInput.Flush();
            var watch = Stopwatch.StartNew();
            while (!disposed && watch.ElapsedMilliseconds < TimeoutMilliseconds) {
                string line;
                if (lines.TryDequeue(out line)) {
                    var response = json.DeserializeObject(line) as Dictionary<string, object>;
                    if (response == null) continue;
                    object value;
                    if (response.TryGetValue("method", out value) && Convert.ToString(value) == "account/rateLimits/updated") Dirty = true;
                    if (!response.TryGetValue("id", out value) || Convert.ToInt32(value) != id) continue;
                    if (response.ContainsKey("error")) throw new IOException("rpc");
                    return response.ContainsKey("result") ? response["result"] : null;
                }
                if (process.HasExited) throw new IOException("closed");
                Thread.Sleep(10);
            }
            throw new TimeoutException();
        }
        public void Refresh() {
            lock (gate) {
                if (Busy || disposed) return;
                Busy = true; Result = null; Error = null;
            }
            Task.Run(delegate {
                try {
                    if (process == null) Start();
                    if (!initialized) {
                        Call("initialize", new {clientInfo = new {name = "codex_usage_scripts", title = "Codex Usage Monitor Scripts", version = ClientVersion}});
                        process.StandardInput.WriteLine("{\"method\":\"initialized\"}");
                        process.StandardInput.Flush();
                        var result = Call("account/read", new {refreshToken = false}) as Dictionary<string, object>;
                        var account = result != null && result.ContainsKey("account") ? result["account"] as Dictionary<string, object> : null;
                        if (account == null || !account.ContainsKey("type") || Convert.ToString(account["type"]) == "apiKey") throw new InvalidOperationException("login");
                        initialized = true;
                    }
                    Result = json.Serialize(Call("account/rateLimits/read", null));
                    Dirty = false;
                } catch (Exception ex) {
                    Error = ex is TimeoutException ? "timeout" : ex is InvalidOperationException ? "login" : "connection";
                    CloseProcess(); initialized = false;
                } finally { Busy = false; }
            });
        }
        void CloseProcess() {
            var p = process; process = null;
            if (p == null) return;
            try { p.StandardInput.Close(); if (!p.WaitForExit(1000)) { p.Kill(); p.WaitForExit(1000); } } catch { }
            p.Dispose();
            string ignored; while (lines.TryDequeue(out ignored)) { }
        }
        public void Dispose() { lock (gate) { disposed = true; CloseProcess(); } }
    }
    public sealed class Feed {
        volatile HttpWebRequest activeRequest;
        public volatile bool Busy;
        public string Result, Error, ETag;
        public int Status, RetrySeconds = 60;
        public static int RetryDelay(string header,int previous) {
            int delay;DateTimeOffset date;
            if (int.TryParse(header,out delay)) return Math.Max(60,Math.Min(86400,delay));
            if (DateTimeOffset.TryParse(header,out date)) return Math.Max(60,Math.Min(86400,(int)Math.Ceiling((date-DateTimeOffset.UtcNow).TotalSeconds)));
            return Math.Min(900,Math.Max(60,previous*2));
        }
        public void Cancel() { var r=activeRequest; if (r!=null) r.Abort(); Result=null; }
        public void Refresh() {
            if (Busy) return;
            Busy = true; Result = null; Error = null; Status = 0;
            Task.Run(delegate {
                try {
                    ServicePointManager.SecurityProtocol |= SecurityProtocolType.Tls12;
                    var request = (HttpWebRequest)WebRequest.Create("https://codex-resets.com/api/v1/status");
                    activeRequest=request;
                    request.Timeout = 15000; request.ReadWriteTimeout = 15000;
                    request.Accept = "application/json"; request.UserAgent = "CodexUsageMonitorScripts";
                    if (!String.IsNullOrEmpty(ETag)) request.Headers["If-None-Match"] = ETag;
                    using (var response = (HttpWebResponse)request.GetResponse()) {
                        Status = (int)response.StatusCode;
                        if (response.ContentLength > 2097152) throw new IOException("size");
                        ETag = response.Headers["ETag"];
                        using (var stream = response.GetResponseStream()) using (var output = new MemoryStream()) {
                            byte[] buffer = new byte[8192]; int count;
                            while ((count = stream.Read(buffer, 0, buffer.Length)) > 0) { output.Write(buffer, 0, count); if (output.Length > 2097152) throw new IOException("size"); }
                            Result = Encoding.UTF8.GetString(output.ToArray());
                        }
                    }
                    RetrySeconds = 60;
                } catch (WebException ex) {
                    using (var response = ex.Response as HttpWebResponse) {
                        if (response != null) {
                            Status = (int)response.StatusCode;
                            RetrySeconds=RetryDelay(response.Headers["Retry-After"],RetrySeconds);
                        }
                    }
                    if (Status != 304) Error = "feed";
                } catch { Error = "feed"; RetrySeconds = Math.Min(900, Math.Max(60, RetrySeconds * 2)); }
                finally { activeRequest=null; Busy = false; }
            });
        }
    }
    public sealed class Box { public double x, y, w, h; public Box(double a, double b, double c, double d) { x=a; y=b; w=c; h=d; } }
    public sealed class Frame { public bool Alive; public long Hwnd, Revision; public Box Pet, Window; public Box[] Blockers = new Box[0]; }
    public static class WindowChrome {
        const int ExtendedStyleIndex = -20;
        const long ToolWindow = 0x80, AppWindow = 0x40000;
        [DllImport("user32.dll", EntryPoint="GetWindowLongW", SetLastError=true)]
        static extern int GetStyle32(IntPtr hwnd, int index);
        [DllImport("user32.dll", EntryPoint="GetWindowLongPtrW", SetLastError=true)]
        static extern IntPtr GetStyle64(IntPtr hwnd, int index);
        [DllImport("user32.dll", EntryPoint="SetWindowLongW", SetLastError=true)]
        static extern int SetStyle32(IntPtr hwnd, int index, int value);
        [DllImport("user32.dll", EntryPoint="SetWindowLongPtrW", SetLastError=true)]
        static extern IntPtr SetStyle64(IntPtr hwnd, int index, IntPtr value);
        [DllImport("kernel32.dll")] static extern void SetLastError(uint error);
        [DllImport("user32.dll", SetLastError=true)]
        static extern bool SetWindowPos(IntPtr hwnd, IntPtr after, int x, int y, int width, int height, uint flags);

        public static long ExtendedStyle(IntPtr hwnd) {
            return IntPtr.Size == 8 ? GetStyle64(hwnd, ExtendedStyleIndex).ToInt64() : (uint)GetStyle32(hwnd, ExtendedStyleIndex);
        }
        public static void HideFromSwitcher(IntPtr hwnd) {
            if (hwnd == IntPtr.Zero) throw new ArgumentException("Window handle is not initialized.", "hwnd");
            // 작업표시줄 숨김만으로는 Alt+Tab에서 제외되지 않는다. 패널만 도구 창으로 지정한다.
            // 기존 투명도/최상단 속성은 유지하며, 클릭·드래그를 막는 NOACTIVATE는 추가하지 않는다.
            long style = (ExtendedStyle(hwnd) | ToolWindow) & ~AppWindow;
            SetLastError(0);
            long previous = IntPtr.Size == 8
                ? SetStyle64(hwnd, ExtendedStyleIndex, new IntPtr(style)).ToInt64()
                : SetStyle32(hwnd, ExtendedStyleIndex, unchecked((int)style));
            int error = Marshal.GetLastWin32Error();
            if (previous == 0 && error != 0) throw new System.ComponentModel.Win32Exception(error);
            // 크기·위치·포커스를 바꾸지 않고 Windows에 변경된 창 속성을 반영한다.
            if (!SetWindowPos(hwnd, IntPtr.Zero, 0, 0, 0, 0, 0x37))
                throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error());
        }
    }
    public static class Desktop {
        delegate bool EnumProc(IntPtr hwnd, IntPtr param);
        [StructLayout(LayoutKind.Sequential)] struct Rect { public int left, top, right, bottom; }
        [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc proc, IntPtr param);
        [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr hwnd);
        [DllImport("user32.dll")] static extern short GetAsyncKeyState(int key);
        public static bool PointerDown {get{return (GetAsyncKeyState(1) & 0x8000)!=0;}}
        [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr hwnd, out Rect rect);
        [DllImport("user32.dll")] static extern int GetWindowLong(IntPtr hwnd, int index);
        [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr hwnd, out uint pid);
        [DllImport("user32.dll")] static extern int GetWindowText(IntPtr hwnd, StringBuilder text, int count);
        [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hwnd);
        [DllImport("dwmapi.dll")] static extern int DwmSetWindowAttribute(IntPtr hwnd, int attribute, ref int value, int size);
        public static void DarkTitleBar(IntPtr hwnd) { int enabled=1; DwmSetWindowAttribute(hwnd,20,ref enabled,4); }
        [DllImport("user32.dll")] static extern IntPtr SetThreadDpiAwarenessContext(IntPtr value);
        [DllImport("kernel32.dll")] static extern IntPtr OpenProcess(uint access, bool inherit, int pid);
        [DllImport("kernel32.dll", CharSet=CharSet.Unicode)] static extern bool QueryFullProcessImageName(IntPtr process, int flags, StringBuilder path, ref int size);
        [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr handle);
        [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)] struct ProcessEntry {
            public uint size, usage, pid; public IntPtr heap; public uint module, threads, parent; public int priority; public uint flags;
            [MarshalAs(UnmanagedType.ByValTStr, SizeConst=260)] public string exe;
        }
        [DllImport("kernel32.dll")] static extern IntPtr CreateToolhelp32Snapshot(uint flags, uint pid);
        [DllImport("kernel32.dll", CharSet=CharSet.Unicode, EntryPoint="Process32FirstW")] static extern bool Process32First(IntPtr snapshot, ref ProcessEntry entry);
        [DllImport("kernel32.dll", CharSet=CharSet.Unicode, EntryPoint="Process32NextW")] static extern bool Process32Next(IntPtr snapshot, ref ProcessEntry entry);
        [DllImport("kernel32.dll")] static extern bool ProcessIdToSessionId(uint pid, out uint session);
        [DllImport("kernel32.dll")] static extern bool GetThreadTimes(IntPtr thread,out long created,out long exited,out long kernel,out long user);
        static long scanTicks;
        public static double ScanCPUSeconds {get{return Interlocked.Read(ref scanTicks)/10000000.0;}}
        static long ThreadTicks() {long a,b,c,d;return GetThreadTimes(new IntPtr(-2),out a,out b,out c,out d) ? c+d : 0;}
        public static double ThreadCPUSeconds() {return ThreadTicks()/10000000.0;}
        static volatile bool busy;
        static Box lastMovedWindow;
        static long lastMovedRevision=-1;
        public static Frame Current = new Frame();
        static string ImagePath(int pid) {
            IntPtr handle=OpenProcess(0x1000,false,pid);
            if (handle==IntPtr.Zero) return "";
            try { var path=new StringBuilder(32768);int size=path.Capacity;return QueryFullProcessImageName(handle,0,path,ref size) ? path.ToString() : ""; }
            finally { CloseHandle(handle); }
        }
        public static string FindCodex() {
            string root = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "OpenAI", "Codex", "bin");
            if (Directory.Exists(root)) {
                var found = Directory.GetFiles(root, "codex.exe", SearchOption.AllDirectories);
                Array.Sort(found, delegate(string a, string b) { return File.GetLastWriteTimeUtc(b).CompareTo(File.GetLastWriteTimeUtc(a)); });
                if (found.Length > 0) return found[0];
            }
            foreach (int pid in Applications()) {
                try { string exe = Path.Combine(Path.GetDirectoryName(ImagePath(pid)), "resources", "codex.exe"); if (File.Exists(exe)) return exe; } catch { }
            }
            foreach (string path in (Environment.GetEnvironmentVariable("PATH") ?? "").Split(';')) { try { string exe = Path.Combine(path, "codex.exe"); if (File.Exists(exe)) return exe; } catch { } }
            return null;
        }
        static List<int> Applications() {
            var apps = new List<int>();uint mine;ProcessIdToSessionId((uint)Process.GetCurrentProcess().Id,out mine);
            IntPtr snapshot=CreateToolhelp32Snapshot(2,0);
            if (snapshot==new IntPtr(-1)) return apps;
            try {
                var entry=new ProcessEntry();entry.size=(uint)Marshal.SizeOf(typeof(ProcessEntry));
                if (!Process32First(snapshot,ref entry)) return apps;
                do {
                    if (!String.Equals(entry.exe,"Codex.exe",StringComparison.OrdinalIgnoreCase) && !String.Equals(entry.exe,"ChatGPT.exe",StringComparison.OrdinalIgnoreCase)) continue;
                    uint session;if (!ProcessIdToSessionId(entry.pid,out session) || session!=mine) continue;
                    string path = ImagePath((int)entry.pid).Replace('/', '\\').ToLowerInvariant();
                    if (path.Length==0) continue;
                    if (path.Contains("\\bin\\") || path.Contains("\\resources\\") || path.Contains("app.asar.unpacked")) continue;
                    bool packaged=path.Contains("\\openai.codex_") || path.Contains("\\openai.chatgpt_");
                    if (!packaged && !Directory.Exists(Path.Combine(Path.GetDirectoryName(path),"resources"))) continue;
                    apps.Add((int)entry.pid);
                } while (Process32Next(snapshot,ref entry));
            } finally { CloseHandle(snapshot); }
            return apps;
        }
        public static bool Alive() { return Applications().Count > 0; }
        static Box ReadBox(IntPtr hwnd) {
            IntPtr previous=IntPtr.Zero;try { previous=SetThreadDpiAwarenessContext(new IntPtr(-4)); } catch { }
            try {Rect r;return GetWindowRect(hwnd,out r) ? new Box(r.left,r.top,r.right-r.left,r.bottom-r.top) : null;}
            finally {if (previous!=IntPtr.Zero) try {SetThreadDpiAwarenessContext(previous);} catch { }}
        }
        public static Frame ChangedFrame() {
            var f=Current;if (f.Pet==null) return null;
            var r=ReadBox(new IntPtr(f.Hwnd));
            if (Same(r,lastMovedWindow) && f.Revision==lastMovedRevision) return null;
            lastMovedWindow=r;lastMovedRevision=f.Revision;return MovedFrame();
        }
        public static Frame MovedFrame() {
            var f = Current;
            if (f.Pet == null || f.Window == null) return f;
            var r = ReadBox(new IntPtr(f.Hwnd));
            if (r == null || !IsWindowVisible(new IntPtr(f.Hwnd))) return new Frame {Alive=f.Alive};
            double dx=r.x-f.Window.x, dy=r.y-f.Window.y;
            var blockers = new List<Box>();
            foreach (var b in f.Blockers) blockers.Add(new Box(b.x+dx,b.y+dy,b.w,b.h));
            return new Frame {Alive=f.Alive,Hwnd=f.Hwnd,Revision=f.Revision,Window=r,Pet=new Box(f.Pet.x+dx,f.Pet.y+dy,f.Pet.w,f.Pet.h),Blockers=blockers.ToArray()};
        }
        public static void Refresh() {
            if (busy) return; busy=true;
            Task.Run(delegate {
                long cpu=ThreadTicks();
                try {
                    try { SetThreadDpiAwarenessContext(new IntPtr(-4)); } catch { }
                    var apps = Applications(); var pids = new HashSet<uint>();
                    foreach (int pid in apps) pids.Add((uint)pid);
                    var frame = new Frame {Alive=apps.Count > 0};
                    EnumWindows(delegate(IntPtr hwnd, IntPtr ignored) {
                        uint pid; GetWindowThreadProcessId(hwnd, out pid);
                        if (!pids.Contains(pid) || !IsWindowVisible(hwnd)) return true;
                        int ex=GetWindowLong(hwnd,-20), style=GetWindowLong(hwnd,-16);
                        if ((ex & 8)==0 || (ex & 0x80000)==0 || (style & 0xC00000)!=0) return true;
                        var title=new StringBuilder(256); GetWindowText(hwnd,title,256);
                        var box=ReadBox(hwnd);
                        if (box==null || box.w<=0 || box.h<=0) return true;
                        try {
                            var root=AutomationElement.FromHandle(hwnd);
                            var images=root.FindAll(TreeScope.Descendants,new PropertyCondition(AutomationElement.ControlTypeProperty, ControlType.Image));
                            Box mascot=null;
                            foreach (AutomationElement e in images) {
                                var r=e.Current.BoundingRectangle;
                                if (!e.Current.IsOffscreen && r.Width>=30 && r.Width<=350 && r.Height>=40 && r.Height<=350) { mascot=new Box(r.X,r.Y,r.Width,r.Height); break; }
                            }
                            if (mascot==null) return true;
                            var chrome=new List<Box>();
                            var elements=root.FindAll(TreeScope.Descendants,new OrCondition(new PropertyCondition(AutomationElement.ControlTypeProperty,ControlType.ListItem),new PropertyCondition(AutomationElement.ControlTypeProperty,ControlType.Group),new PropertyCondition(AutomationElement.ControlTypeProperty,ControlType.Button)));
                            foreach (AutomationElement e in elements) {
                                var r=e.Current.BoundingRectangle;
                                if (!e.Current.IsOffscreen && r.Width>30 && r.Width<=1000 && r.Height>10 && r.Height<=160 && (r.Bottom<=mascot.y+4 || r.Top>=mascot.y+mascot.h-4)) chrome.Add(new Box(r.X,r.Y,r.Width,r.Height));
                            }
                            frame.Hwnd=hwnd.ToInt64();frame.Window=box;frame.Pet=mascot;frame.Blockers=chrome.ToArray();
                            return false;
                        } catch { return true; }
                    },IntPtr.Zero);
                    var old=Current;bool changed=old.Hwnd!=frame.Hwnd || old.Blockers.Length!=frame.Blockers.Length || !Same(old.Pet,frame.Pet);
                    if (!changed) for (int i=0;i<old.Blockers.Length;i++) if (!Same(old.Blockers[i],frame.Blockers[i])) {changed=true;break;}
                    frame.Revision=old.Revision+(changed ? 1 : 0);Current=frame;
                } catch { Current=new Frame(); }
                finally { Interlocked.Add(ref scanTicks,ThreadTicks()-cpu);busy=false; }
            });
        }
        static bool Same(Box a,Box b) {return a==null ? b==null : b!=null && a.x==b.x && a.y==b.y && a.w==b.w && a.h==b.h;}
    }
}
