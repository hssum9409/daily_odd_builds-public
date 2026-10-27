// PowerShell에 없는 비동기 I/O, Win32/UIA 조회와 자체 창의 Shell 속성 설정을 맡는다.
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
        public string AccountKey = "";
        public string Executable;
        // 기본은 Codex stdio 서버다. 격리 전송 QA는 OS 내장 스크립트 서버로 대체한다.
        public string ServerArguments = "app-server --listen stdio://";
        public string ClientVersion = "1.5.2";
        public int TimeoutMilliseconds = 20000;
        public int OwnedPid { get { return process == null ? 0 : process.Id; } }
        public Rpc(string path) { Executable = path; }
        void Start() { lock (gate) {
            if (disposed) throw new ObjectDisposedException("Rpc");
            // .NET Framework의 stdin writer는 Console.InputEncoding을 따른다.
            // UTF-8 BOM이 첫 JSON 앞에 붙지 않도록 모니터 프로세스의 입력 인코딩을 고정한다.
            try { Console.InputEncoding = new UTF8Encoding(false); }
            catch (IOException ex) {
                // 콘솔에서 분리된 WPF에서는 SetConsoleCP가 ERROR_INVALID_HANDLE을 반환한다.
                // 허용된 요청은 ASCII 고정 필드뿐이므로 기존 파이프 입력 경로를 유지한다.
                if ((ex.HResult & 0xffff) != 6) throw;
            }
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
        string ReadIdentity() {
            var result=Call("account/read",new {refreshToken=false}) as Dictionary<string,object>;
            object raw;var account=result!=null && result.TryGetValue("account",out raw) ? raw as Dictionary<string,object> : null;
            if(account==null || !account.ContainsKey("type") || Convert.ToString(account["type"])=="apiKey") throw new InvalidOperationException("login");
            string identity="";bool known=false;
            foreach(string key in new string[]{"type","id","email"}){object value;if(account.TryGetValue(key,out value)){identity+=key+":"+Convert.ToString(value)+"\n";if(key!="type" && !String.IsNullOrEmpty(Convert.ToString(value)))known=true;}}
            if(!known)return "";
            using(var sha=System.Security.Cryptography.SHA256.Create())return BitConverter.ToString(sha.ComputeHash(Encoding.UTF8.GetBytes(identity))).Replace("-","");
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
                        initialized = true;
                    }
                    // 계정 전환 중에 다른 계정의 잔액/초기화권을 합치지 않는다.
                    string before=ReadIdentity();
                    var snapshot=Call("account/rateLimits/read",null) as Dictionary<string,object>;
                    if(snapshot==null)throw new IOException("schema");
                    string after=ReadIdentity();
                    if(before!=after)throw new InvalidOperationException("account-changed");
                    object accountId;
                    // 이메일만 같은 다른 워크스페이스를 구분할 수 없으면 상세 캐시를 재사용하지 않는다.
                    AccountKey="";
                    if(snapshot.TryGetValue("accountId",out accountId) && !String.IsNullOrEmpty(Convert.ToString(accountId))){
                        using(var sha=System.Security.Cryptography.SHA256.Create())AccountKey=BitConverter.ToString(sha.ComputeHash(Encoding.UTF8.GetBytes(before+":"+Convert.ToString(accountId)))).Replace("-","");
                    }
                    Result = json.Serialize(snapshot);
                    Dirty = false;
                } catch (Exception ex) {
                    Error = ex is TimeoutException ? "timeout" : ex is InvalidOperationException ? (ex.Message=="account-changed" ? "account" : "login") : "connection";
                    CloseProcess(); initialized = false; AccountKey="";
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
        public string Result, Error, ETag, ResponseETag;
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
            Busy = true; Result = null; Error = null; Status = 0; ResponseETag = null;
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
                        // 검증되지 않은 본문과 ETag를 함께 확정하면 손상 응답 뒤 304에서 복구할 수 없다.
                        ResponseETag = response.Headers["ETag"];
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
                            RetrySeconds = Status == 304 ? 60 : RetryDelay(response.Headers["Retry-After"],RetrySeconds);
                        }
                    }
                    if (Status != 304) { Error = Status == 0 ? "network" : "http"; if (Status == 0) RetrySeconds = Math.Min(900, Math.Max(60, RetrySeconds * 2)); }
                } catch { Error = "feed"; RetrySeconds = Math.Min(900, Math.Max(60, RetrySeconds * 2)); }
                finally { activeRequest=null; Busy = false; }
            });
        }
    }
    public sealed class Box { public double x, y, w, h; public Box(double a, double b, double c, double d) { x=a; y=b; w=c; h=d; } }
    public sealed class Frame { public bool Alive; public long Hwnd, Revision; public Box Pet, Window; public Box[] Blockers = new Box[0]; }
    public static class TaskbarIdentity {
        public const string AppId = "DailyOddBuilds.CodexUsageMonitor";
        public const string DisplayName = "Codex Usage Monitor";
        static readonly Guid PropertyFormat = new Guid("9F4C2855-9F79-4B39-A8D0-E1D42DE1D5F3");
        [StructLayout(LayoutKind.Sequential, Pack=4)]
        struct PropertyKey { public Guid format; public uint id; }
        // PROPVARIANT의 union은 x64에서 16바이트, x86에서 8바이트다. 문자열 포인터만 사용한다.
        [StructLayout(LayoutKind.Sequential)]
        struct PropertyValue { public ushort type, reserved1, reserved2, reserved3; public IntPtr text, unused; }
        [ComImport, Guid("886D8EEB-8CF2-4446-8D02-CDBA1DBDCF99"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
        interface PropertyStore {
            [PreserveSig] int GetCount(out uint count);
            [PreserveSig] int GetAt(uint index, out PropertyKey key);
            [PreserveSig] int GetValue(ref PropertyKey key, out PropertyValue value);
            [PreserveSig] int SetValue(ref PropertyKey key, ref PropertyValue value);
            [PreserveSig] int Commit();
        }
        [DllImport("shell32.dll", CharSet=CharSet.Unicode, ExactSpelling=true)]
        static extern int SetCurrentProcessExplicitAppUserModelID(string appId);
        [DllImport("shell32.dll", ExactSpelling=true)]
        static extern int GetCurrentProcessExplicitAppUserModelID(out IntPtr appId);
        [DllImport("shell32.dll", ExactSpelling=true)]
        static extern int SHGetPropertyStoreForWindow(IntPtr hwnd, ref Guid iid, out PropertyStore store);
        [DllImport("shell32.dll", CharSet=CharSet.Unicode, ExactSpelling=true)]
        static extern int SHGetPropertyStoreFromParsingName(string path, IntPtr bindContext, uint flags, ref Guid iid, out PropertyStore store);
        [DllImport("ole32.dll", ExactSpelling=true)]
        static extern int PropVariantClear(ref PropertyValue value);

        public static void InitializeProcess() {
            // 어떤 창도 표시하기 전에 PowerShell 호스트와 별개의 앱으로 등록한다.
            Marshal.ThrowExceptionForHR(SetCurrentProcessExplicitAppUserModelID(AppId));
        }
        public static string CurrentProcessId() {
            IntPtr value;
            Marshal.ThrowExceptionForHR(GetCurrentProcessExplicitAppUserModelID(out value));
            try { return Marshal.PtrToStringUni(value); }
            finally { Marshal.FreeCoTaskMem(value); }
        }
        static PropertyStore Open(IntPtr hwnd) {
            if (hwnd == IntPtr.Zero) throw new ArgumentException("Window handle is not initialized.", "hwnd");
            Guid iid = typeof(PropertyStore).GUID; PropertyStore store;
            Marshal.ThrowExceptionForHR(SHGetPropertyStoreForWindow(hwnd, ref iid, out store));
            return store;
        }
        static void SetString(PropertyStore store, uint id, string text) {
            var key = new PropertyKey { format=PropertyFormat, id=id };
            var value = new PropertyValue { type=31, text=Marshal.StringToCoTaskMemUni(text) };
            try { Marshal.ThrowExceptionForHR(store.SetValue(ref key, ref value)); }
            finally { PropVariantClear(ref value); }
        }
        public static void ApplyToWindow(IntPtr hwnd, string iconPath, string relaunchCommand) {
            iconPath = Path.GetFullPath(iconPath);
            if (!File.Exists(iconPath)) throw new FileNotFoundException("Taskbar icon was not found.", iconPath);
            if (String.IsNullOrWhiteSpace(relaunchCommand)) throw new ArgumentException("A relaunch command is required.", "relaunchCommand");
            var store = Open(hwnd);
            try {
                // 이름과 재실행 명령은 함께 지정한다. 앱 ID는 나머지 속성을 설정한 뒤 적용한다.
                SetString(store, 2, relaunchCommand);
                SetString(store, 3, iconPath + ",0");
                SetString(store, 4, DisplayName);
                SetString(store, 5, AppId);
            } catch {
                try { ClearValues(store); } catch { }
                throw;
            } finally { Marshal.ReleaseComObject(store); }
        }
        static void ClearValues(PropertyStore store) {
            // 창이 닫히기 전에 VT_EMPTY로 지워 Shell의 속성 리소스를 반환한다.
            for (uint id=2; id<=5; id++) {
                var key = new PropertyKey { format=PropertyFormat, id=id }; var value = new PropertyValue();
                Marshal.ThrowExceptionForHR(store.SetValue(ref key, ref value));
            }
        }
        public static void ClearWindow(IntPtr hwnd) {
            var store = Open(hwnd);
            try { ClearValues(store); }
            finally { Marshal.ReleaseComObject(store); }
        }
        public static void ApplyToShortcut(string path) {
            Guid iid = typeof(PropertyStore).GUID; PropertyStore store;
            Marshal.ThrowExceptionForHR(SHGetPropertyStoreFromParsingName(Path.GetFullPath(path), IntPtr.Zero, 2, ref iid, out store));
            try { SetString(store, 5, AppId); Marshal.ThrowExceptionForHR(store.Commit()); }
            finally { Marshal.ReleaseComObject(store); }
        }
        public static string ReadWindowProperty(IntPtr hwnd, uint id) {
            var store = Open(hwnd);
            try {
                var key = new PropertyKey { format=PropertyFormat, id=id }; PropertyValue value;
                Marshal.ThrowExceptionForHR(store.GetValue(ref key, out value));
                try { return value.type == 31 ? Marshal.PtrToStringUni(value.text) : ""; }
                finally { PropVariantClear(ref value); }
            } finally { Marshal.ReleaseComObject(store); }
        }
    }
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
        public static void SetNoActivate(IntPtr hwnd,bool enabled) {
            long style=ExtendedStyle(hwnd);style=enabled ? style|0x08000000 : style&~0x08000000;
            if(IntPtr.Size==8)SetStyle64(hwnd,ExtendedStyleIndex,new IntPtr(style));else SetStyle32(hwnd,ExtendedStyleIndex,unchecked((int)style));
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
        internal static List<int> Applications() {
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
    // 앱 내부 코드를 주입하지 않는다. 도구 창의 소유자만 Codex로 지정하고,
    // 클라이언트 영역의 물리 좌표를 읽어 우측 하단에 배치한다.
    public sealed class HostFrame { public long Hwnd; public Box Client,Caret; public bool Visible; }
    public static class AppDock {
        [DllImport("user32.dll")]static extern bool EnumChildWindows(IntPtr hwnd,EnumProc proc,IntPtr unused);
        [DllImport("user32.dll",CharSet=CharSet.Unicode)]static extern int GetClassName(IntPtr hwnd,StringBuilder name,int length);
        [DllImport("user32.dll")]static extern bool GetWindowRect(IntPtr hwnd,out Rect rect);
        public static string ChildLayout(){
            var text=new StringBuilder();EnumChildWindows(new IntPtr(Current.Hwnd),delegate(IntPtr hwnd,IntPtr unused){Rect r;var name=new StringBuilder(128);GetClassName(hwnd,name,128);if(IsWindowVisible(hwnd) && GetWindowRect(hwnd,out r))text.Append(name+":"+r.left+","+r.top+","+r.right+","+r.bottom+";");return true;},IntPtr.Zero);return text.ToString();
        }
        delegate void WinEventProc(IntPtr hook,uint kind,IntPtr hwnd,int obj,int child,uint thread,uint time);
        static readonly WinEventProc EventCallback=OnWindowEvent;
        static readonly List<IntPtr> Hooks=new List<IntPtr>();
        static readonly List<IntPtr> TargetHooks=new List<IntPtr>();
        static bool watching;
        static uint watchedProcess;
        static long wakeWindow;
        static bool moving;static long changedAt;static HostFrame lastObserved;
        public static bool IsSettled{get{return !moving && (changedAt==0 || (Stopwatch.GetTimestamp()-changedAt)*1000.0/Stopwatch.Frequency>=200);}}
        [DllImport("user32.dll")]static extern bool PostMessage(IntPtr hwnd,uint message,IntPtr wparam,IntPtr lparam);
        public static void SetWakeWindow(long handle){wakeWindow=handle;}
        public static uint WatchedProcess {get{return watchedProcess;}}
        static long revision;
        public static long Revision {get{return Interlocked.Read(ref revision);}}
        [DllImport("user32.dll")] static extern IntPtr SetWinEventHook(uint first,uint last,IntPtr module,WinEventProc proc,uint process,uint thread,uint flags);
        [DllImport("user32.dll")] static extern bool UnhookWinEvent(IntPtr hook);
        static void OnWindowEvent(IntPtr hook,uint kind,IntPtr hwnd,int obj,int child,uint thread,uint time) {
            if(kind!=3 && (hwnd.ToInt64()!=Current.Hwnd || obj!=0 || child!=0))return;
            if(kind==0xA)moving=true;
            if(kind==0xB){moving=false;changedAt=Stopwatch.GetTimestamp();}
            Interlocked.Increment(ref revision);
            if(wakeWindow!=0)PostMessage(new IntPtr(wakeWindow),0x8272,IntPtr.Zero,IntPtr.Zero);
        }
        public static void StartWatching() {
            if(watching)return;watching=true;
            // 전역으로 필요한 이벤트는 전면 창 변경 하나뿐이다. 자체 UI 이벤트는 제외한다.
            // OUTOFCONTEXT 관찰이며 키보드 훅이나 다른 프로세스에 대한 DLL 주입은 아니다.
            var hook=SetWinEventHook(3,3,IntPtr.Zero,EventCallback,0,0,2);
            if(hook!=IntPtr.Zero)Hooks.Add(hook);
            BindTarget();
        }
        static void BindTarget(){
            uint pid=0;if(Current.Hwnd!=0)GetWindowThreadProcessId(new IntPtr(Current.Hwnd),out pid);
            if(pid==watchedProcess)return;
            foreach(var hook in TargetHooks)UnhookWinEvent(hook);TargetHooks.Clear();watchedProcess=pid;
            if(pid==0)return;
            // 이동 시작/종료·최소화만 받는다. 객체 생성·위치 이벤트는 채팅 접근성 갱신까지
            // 대량으로 전달하므로 아예 구독하지 않는다. 일반 크기 변경은 느린 경계 확인으로 처리한다.
            foreach(var pair in new uint[][]{new uint[]{0xA,0xB},new uint[]{0x16,0x17}}){
                var hook=SetWinEventHook(pair[0],pair[1],IntPtr.Zero,EventCallback,pid,0,2);
                if(hook!=IntPtr.Zero)TargetHooks.Add(hook);
            }
        }
        public static void StopWatching(){
            if(!watching)return;
            foreach(var hook in Hooks)UnhookWinEvent(hook);Hooks.Clear();
            foreach(var hook in TargetHooks)UnhookWinEvent(hook);TargetHooks.Clear();
            watchedProcess=0;watching=false;moving=false;changedAt=0;lastObserved=null;
        }
        [StructLayout(LayoutKind.Sequential)] struct Rect { public int left, top, right, bottom; }
        [StructLayout(LayoutKind.Sequential)] struct Point { public int x,y; }
        [StructLayout(LayoutKind.Sequential)] struct GuiInfo {public int size;public uint flags;public IntPtr active,focus,capture,menu,moving,caret;public Rect rect;}
        [DllImport("user32.dll")]static extern bool GetGUIThreadInfo(uint thread,ref GuiInfo info);
        delegate bool EnumProc(IntPtr hwnd, IntPtr unused);
        [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc proc, IntPtr unused);
        [DllImport("user32.dll")] static extern bool IsWindow(IntPtr hwnd);
        [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr hwnd);
        [DllImport("user32.dll")] static extern bool IsIconic(IntPtr hwnd);
        [DllImport("user32.dll")] static extern bool GetClientRect(IntPtr hwnd,out Rect rect);
        [DllImport("user32.dll")] static extern bool ClientToScreen(IntPtr hwnd,ref Point point);
        [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr hwnd,out uint pid);
        [DllImport("user32.dll")] static extern IntPtr GetWindow(IntPtr hwnd,uint command);
        [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
        [DllImport("user32.dll")] static extern int GetWindowLong(IntPtr hwnd,int index);
        [DllImport("user32.dll")] static extern IntPtr SetThreadDpiAwarenessContext(IntPtr context);
        [DllImport("dwmapi.dll")] static extern int DwmGetWindowAttribute(IntPtr hwnd,int attr,out int value,int size);
        public static HostFrame Current = new HostFrame();
        public static bool IsForeground(long handle){return handle!=0 && GetForegroundWindow().ToInt64()==handle;}
        public static HostFrame Read(long handle) {
            IntPtr hwnd=new IntPtr(handle); var frame=new HostFrame {Hwnd=handle};
            if(handle==0 || !IsWindow(hwnd)) return new HostFrame();
            int cloaked=0; DwmGetWindowAttribute(hwnd,14,out cloaked,4);
            frame.Visible=IsWindowVisible(hwnd) && !IsIconic(hwnd) && cloaked==0;
            IntPtr old=IntPtr.Zero;
            try {
                old=SetThreadDpiAwarenessContext(new IntPtr(-4));
                Rect r;var p=new Point();
                if(GetClientRect(hwnd,out r) && ClientToScreen(hwnd,ref p)) frame.Client=new Box(p.x,p.y,r.right-r.left,r.bottom-r.top);
                // 입력창 경계를 접근성으로 제공하지 않는 앱에서도 실제 텍스트 커서는 피한다.
                var info=new GuiInfo();info.size=Marshal.SizeOf(typeof(GuiInfo));
                if(GetForegroundWindow()==hwnd && GetGUIThreadInfo(0,ref info) && info.caret!=IntPtr.Zero && info.rect.bottom>info.rect.top){
                    uint appPid,caretPid;GetWindowThreadProcessId(hwnd,out appPid);GetWindowThreadProcessId(info.caret,out caretPid);
                    var caretPoint=new Point{x=info.rect.left,y=info.rect.top};
                    if(appPid==caretPid && ClientToScreen(info.caret,ref caretPoint))frame.Caret=new Box(caretPoint.x,caretPoint.y,Math.Max(1,info.rect.right-info.rect.left),info.rect.bottom-info.rect.top);
                }
            } finally {if(old!=IntPtr.Zero) SetThreadDpiAwarenessContext(old);}
            if(watching && frame.Hwnd==Current.Hwnd){
                if(lastObserved!=null && lastObserved.Hwnd==frame.Hwnd && frame.Client!=null && lastObserved.Client!=null){
                    var a=lastObserved.Client;var b=frame.Client;
                    if(a.x!=b.x || a.y!=b.y || a.w!=b.w || a.h!=b.h)changedAt=Stopwatch.GetTimestamp();
                }
                lastObserved=frame;
            }
            return frame;
        }
        public static void Refresh() {
            // 프로세스 열거는 기존 감지 주기에만 수행한다. 이동 중에는 Read만 호출한다.
            var pids=new HashSet<int>(Desktop.Applications());var selected=new HostFrame();
            var front=GetForegroundWindow();double score=-1;
            EnumWindows(delegate(IntPtr hwnd,IntPtr unused) {
                uint pid;GetWindowThreadProcessId(hwnd,out pid);
                if(!pids.Contains((int)pid) || GetWindow(hwnd,4)!=IntPtr.Zero || (GetWindowLong(hwnd,-20)&0x80)!=0) return true;
                var f=Read(hwnd.ToInt64());if(f.Client==null || f.Client.w<600 || f.Client.h<400) return true;
                double value=f.Client.w*f.Client.h;
                if(f.Visible) value+=1e9;
                if(hwnd==front) value+=1e10;
                else if(f.Hwnd==Current.Hwnd) value+=1e8;
                if(value>score){selected=f;score=value;} return true;
            },IntPtr.Zero);
            if(Current.Hwnd!=selected.Hwnd)Interlocked.Increment(ref revision);
            Current=selected;
            if(watching)BindTarget();
        }
    }
}
