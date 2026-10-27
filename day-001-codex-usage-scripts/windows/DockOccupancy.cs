// 입력창 접근성 경계가 없는 호스트를 위한 보조 관찰.
// 패널 바깥의 3픽셀 색상 띠만 즉시 검사한다. 이미지·문자·대화 내용은 보관하지 않는다.
using System;
using System.Diagnostics;
using System.Globalization;
using System.IO;
using System.Runtime.InteropServices;
using System.Text.RegularExpressions;
using System.Threading.Tasks;
namespace UsageScripts {
    public sealed class DockProbe { public bool Known,Blocked,Full;public int Inset;public double Milliseconds,Stamp;public string Key=""; }
    public static class DockOccupancy {
        static volatile bool busy;public static volatile DockProbe Current;
        public static bool Busy{get{return busy;}}
        public static void Request(string key,long host,int screenX,Box client,double scale,int background){
            if(busy)return;busy=true;
            Task.Run(delegate{
                try{var result=Read(host,screenX,client,scale,background);result.Key=key;result.Stamp=DateTimeOffset.UtcNow.ToUnixTimeMilliseconds()/1000.0;Current=result;}
                finally{busy=false;}
            });
        }
        [StructLayout(LayoutKind.Sequential)]struct Point{public int x,y;}
        [StructLayout(LayoutKind.Sequential)]struct Header{public int size,width,height;public short planes,bits;public int compression,image,xppm,yppm,used,important;}
        [DllImport("user32.dll")]static extern IntPtr GetDC(IntPtr window);
        [DllImport("user32.dll")]static extern int ReleaseDC(IntPtr window,IntPtr dc);
        [DllImport("user32.dll")]static extern IntPtr WindowFromPoint(Point point);
        [DllImport("user32.dll")]static extern IntPtr GetAncestor(IntPtr hwnd,uint flags);
        [DllImport("user32.dll")]static extern IntPtr SetThreadDpiAwarenessContext(IntPtr value);
        [DllImport("gdi32.dll")]static extern IntPtr CreateCompatibleDC(IntPtr dc);
        [DllImport("gdi32.dll")]static extern IntPtr CreateDIBSection(IntPtr dc,ref Header info,uint usage,out IntPtr bits,IntPtr section,uint offset);
        [DllImport("gdi32.dll")]static extern IntPtr SelectObject(IntPtr dc,IntPtr obj);
        [DllImport("gdi32.dll")]static extern bool DeleteObject(IntPtr obj);
        [DllImport("gdi32.dll")]static extern bool DeleteDC(IntPtr dc);
        [DllImport("gdi32.dll")]static extern bool BitBlt(IntPtr target,int x,int y,int w,int h,IntPtr source,int sx,int sy,int rop);
        [DllImport("gdi32.dll")]static extern bool GdiFlush();
        public static DockProbe Analyze(bool[] occupied,bool[] valid,int step,int bottomInset,int minimumRun){
            var result=new DockProbe();if(occupied.Length==0 || valid.Length!=occupied.Length)return result;
            int known=0,total=0,run=0,chosenEnd=-1,chosenStart=-1,runEnd=-1;
            for(int i=occupied.Length-1;i>=0;i--){
                if(valid[i])known++;
                if(valid[i] && occupied[i]){total++;if(run==0)runEnd=i;run++;}
                else{
                    if(run>=minimumRun && chosenEnd<0){chosenEnd=runEnd;chosenStart=i+1;}run=0;
                }
            }
            if(run>=minimumRun && chosenEnd<0){chosenEnd=runEnd;chosenStart=0;}
            result.Known=known>=occupied.Length*0.85;
            result.Full=result.Known && total>=occupied.Length*0.85;
            result.Blocked=result.Known && chosenEnd>=0;
            if(result.Blocked)result.Inset=bottomInset+(occupied.Length-1-chosenStart)*step;
            return result;
        }
        public static DockProbe Read(long host,int screenX,Box client,double scale,int background){
            var watch=Stopwatch.StartNew();var result=new DockProbe();IntPtr previous=SetThreadDpiAwarenessContext(new IntPtr(-4));
            IntPtr screen=IntPtr.Zero,memory=IntPtr.Zero,bitmap=IntPtr.Zero,old=IntPtr.Zero;
            try{
                int step=Math.Max(4,(int)Math.Round(8*scale)),bottom=Math.Max(12,(int)Math.Round(24*scale));
                int height=(int)Math.Min(client.h-(int)(100*scale),(int)(360*scale));if(height<step*5)return result;
                int top=(int)(client.y+client.h-bottom-height);
                var occupied=new bool[height/step];var valid=new bool[occupied.Length];
                screen=GetDC(IntPtr.Zero);memory=CreateCompatibleDC(screen);
                var header=new Header{size=40,width=3,height=-height,planes=1,bits=32};IntPtr bits;
                bitmap=CreateDIBSection(screen,ref header,0,out bits,IntPtr.Zero,0);if(bitmap==IntPtr.Zero || bits==IntPtr.Zero)return result;
                old=SelectObject(memory,bitmap);if(!BitBlt(memory,0,0,3,height,screen,screenX,top,0x00CC0020))return result;GdiFlush();
                for(int i=0;i<occupied.Length;i++){
                    int y=i*step;valid[i]=GetAncestor(WindowFromPoint(new Point{x=screenX+1,y=top+y}),2).ToInt64()==host;
                    int differs=0;
                    for(int x=0;x<3;x++){
                        int color=Marshal.ReadInt32(bits,(y*3+x)*4);
                        if(Math.Abs(((color>>16)&255)-((background>>16)&255))>5 || Math.Abs(((color>>8)&255)-((background>>8)&255))>5 || Math.Abs((color&255)-(background&255))>5)differs++;
                    }
                    occupied[i]=differs>=2;
                }
                // 한두 줄 툴팁은 입력창/사이드 패널이 아니다. 최소 48 DIP 높이의 연속된 영역만 회피한다.
                result=Analyze(occupied,valid,step,bottom+height-(occupied.Length-1)*step,6);result.Milliseconds=watch.Elapsed.TotalMilliseconds;return result;
            }catch{return result;}finally{
                if(old!=IntPtr.Zero)SelectObject(memory,old);if(bitmap!=IntPtr.Zero)DeleteObject(bitmap);if(memory!=IntPtr.Zero)DeleteDC(memory);if(screen!=IntPtr.Zero)ReleaseDC(IntPtr.Zero,screen);
                if(previous!=IntPtr.Zero)SetThreadDpiAwarenessContext(previous);
            }
        }
        static volatile bool sidebarBusy;static DateTime nextSidebar;static string sidebarSignature="";public static volatile int SidebarWidth=320;
        static readonly Regex WidthPattern=new Regex(@"(?<!\\)""sidebar-width""\s*:\s*([0-9]{1,4}(?:\.[0-9]{1,16})?)",RegexOptions.CultureInvariant);
        public static void RefreshSidebar(string home){
            if(sidebarBusy || DateTime.UtcNow<nextSidebar)return;sidebarBusy=true;nextSidebar=DateTime.UtcNow.AddSeconds(5);
            Task.Run(delegate{
                try{
                    string path=Path.Combine(home,".codex-global-state.json");if(!File.Exists(path))return;var file=new FileInfo(path);if(file.Length>8*1024*1024)return;
                    string signature=path+":"+file.Length+":"+file.LastWriteTimeUtc.Ticks;if(signature==sidebarSignature)return;
                    using(var stream=new FileStream(path,FileMode.Open,FileAccess.Read,FileShare.ReadWrite|FileShare.Delete))using(var reader=new StreamReader(stream)){
                        var buffer=new char[8192];string tail="";int count;
                        while((count=reader.Read(buffer,0,buffer.Length))>0){
                            string text=tail+new string(buffer,0,count);var match=WidthPattern.Match(text);double value;
                            if(match.Success && Double.TryParse(match.Groups[1].Value,NumberStyles.Float,CultureInfo.InvariantCulture,out value) && value>=160 && value<=640){SidebarWidth=(int)Math.Ceiling(value);sidebarSignature=signature;return;}
                            tail=text.Substring(Math.Max(0,text.Length-128));
                        }
                    }
                }catch{}finally{sidebarBusy=false;}
            });
        }
    }
}
