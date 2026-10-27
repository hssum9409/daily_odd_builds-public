// 작업표시줄 전용 렌더러. 투명한 비트맵을 사용해 바탕색이 사각형으로 드러나지 않는다.
using System;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Imaging;
using System.Drawing.Text;
using System.Globalization;
using System.Runtime.InteropServices;
namespace UsageScripts {
    public sealed class TaskbarReading {
        public string Label="",Detail=""; public double? Used; public bool Weekly;
        public double? Value(bool remaining){return Used.HasValue?(double?)(remaining?100-Used.Value:Used.Value):null;}
    }
    public static class TaskbarDesign {
        public static int WidthDip(int count){return count>1?256:136;}
        static GraphicsPath Rounded(RectangleF box,float radius){
            var path=new GraphicsPath();float d=radius*2;
            path.AddArc(box.X,box.Y,d,d,180,90);path.AddArc(box.Right-d,box.Y,d,d,270,90);
            path.AddArc(box.Right-d,box.Bottom-d,d,d,0,90);path.AddArc(box.X,box.Bottom-d,d,d,90,90);path.CloseFigure();return path;
        }
        public static Color Accent(bool light,double? used,bool weekly){
            if(!used.HasValue)return light?Color.FromArgb(114,122,134):Color.FromArgb(157,166,179);
            if(used.Value>=90)return light?Color.FromArgb(194,59,63):Color.FromArgb(255,140,146);
            if(used.Value>=75)return light?Color.FromArgb(166,105,14):Color.FromArgb(237,192,113);
            return weekly?(light?Color.FromArgb(20,128,104):Color.FromArgb(142,218,198)):(light?Color.FromArgb(40,116,194):Color.FromArgb(140,189,245));
        }
        public static Bitmap Render(int width,int height,float scale,bool light,TaskbarReading[] readings,bool remaining,string basis,float hover,bool pressed){
            var bitmap=new Bitmap(width,height,PixelFormat.Format32bppPArgb);
            using(var g=Graphics.FromImage(bitmap)){
                g.Clear(Color.Transparent);g.SmoothingMode=SmoothingMode.AntiAlias;g.TextRenderingHint=TextRenderingHint.AntiAliasGridFit;
                int count=Math.Min(2,readings.Length);var ink=light?Color.FromArgb(34,40,47):Color.FromArgb(242,245,249);
                var muted=light?Color.FromArgb(86,96,108):Color.FromArgb(180,190,203);
                float bodyHeight=Math.Min(34*scale,height-4*scale),top=(height-bodyHeight)/2;
                // alpha=1은 눈에 띄지 않으면서 글자 사이도 하나의 클릭 영역으로 만든다.
                int alpha=pressed?(light?34:44):1+(int)((light?18:24)*Math.Max(0,Math.Min(1,hover)));
                using(var path=Rounded(new RectangleF(2*scale,top,width-4*scale,bodyHeight),6*scale))
                using(var brush=new SolidBrush(Color.FromArgb(alpha,light?Color.Black:Color.White)))g.FillPath(brush,path);
                float shift=pressed?0.6f*scale:0;
                float groupWidth=(width-16*scale)/Math.Max(1,count),left=8*scale;
                using(var small=new Font("Segoe UI",9*scale,FontStyle.Regular,GraphicsUnit.Pixel))
                using(var labelFont=new Font("Segoe UI",10*scale,FontStyle.Regular,GraphicsUnit.Pixel))
                using(var number=new Font("Segoe UI",12*scale,FontStyle.Bold,GraphicsUnit.Pixel))
                using(var inkBrush=new SolidBrush(ink))using(var mutedBrush=new SolidBrush(muted))
                using(var format=new StringFormat{FormatFlags=StringFormatFlags.NoWrap,Trimming=StringTrimming.EllipsisCharacter}){
                    int groups=Math.Max(1,count);
                    for(int index=0;index<groups;index++){
                        var reading=count==0?new TaskbarReading{Label="Codex"}:readings[index];var value=reading.Value(remaining);
                        float x=left+index*groupWidth+shift,cy=height/2f+shift;
                        var circle=new RectangleF(x,cy-10*scale,20*scale,20*scale);
                        using(var track=new Pen(Color.FromArgb(light?28:44,light?Color.Black:Color.White),2.2f*scale))g.DrawEllipse(track,circle);
                        using(var pen=new Pen(Accent(light,reading.Used,reading.Weekly),2.2f*scale)){
                            pen.StartCap=pen.EndCap=LineCap.Round;
                            if(value.HasValue && value.Value>=100)g.DrawEllipse(pen,circle);
                            else if(value.HasValue && value.Value>0)g.DrawArc(pen,circle,-90,(float)(value.Value*3.6));
                        }
                        float textX=x+28*scale,textWidth=groupWidth-32*scale;
                        string percent=value.HasValue?Math.Round(value.Value,1).ToString("0.#",CultureInfo.InvariantCulture)+"%":"—";
                        float lineShift=String.IsNullOrEmpty(reading.Detail)?5*scale:0;
                        using(var tight=(StringFormat)StringFormat.GenericTypographic.Clone()){
                            float labelWidth=g.MeasureString(reading.Label,labelFont,1000,tight).Width;
                            g.DrawString(reading.Label,labelFont,inkBrush,new PointF(textX,cy-11*scale+lineShift),tight);
                            float valueX=textX+labelWidth+4*scale;
                            g.DrawString(percent,number,inkBrush,new PointF(valueX,cy-13*scale+lineShift),tight);
                            float valueWidth=g.MeasureString(percent,number,1000,tight).Width;
                            if(count>0)g.DrawString(basis,small,mutedBrush,new RectangleF(valueX+valueWidth+4*scale,cy-9.5f*scale+lineShift,Math.Max(1,textX+textWidth-valueX-valueWidth-4*scale),13*scale),format);
                        }
                        g.DrawString(reading.Detail,small,mutedBrush,new RectangleF(textX,cy+3*scale,textWidth,13*scale),format);
                    }
                }
            }
            return bitmap;
        }
    }
    public static class TaskbarLayer {
        [StructLayout(LayoutKind.Sequential)]struct Point{public int x,y;}
        [StructLayout(LayoutKind.Sequential)]struct Size{public int w,h;}
        [StructLayout(LayoutKind.Sequential)]struct Rect{public int l,t,r,b;}
        [StructLayout(LayoutKind.Sequential,Pack=1)]struct Blend{public byte operation,flags,alpha,format;}
        [DllImport("user32.dll")]static extern IntPtr GetDC(IntPtr window);
        [DllImport("user32.dll")]static extern int ReleaseDC(IntPtr window,IntPtr dc);
        [DllImport("user32.dll")]static extern bool GetWindowRect(IntPtr hwnd,out Rect rect);
        [DllImport("user32.dll")]static extern IntPtr SetThreadDpiAwarenessContext(IntPtr value);
        [DllImport("gdi32.dll")]static extern IntPtr CreateCompatibleDC(IntPtr dc);
        [DllImport("gdi32.dll")]static extern IntPtr SelectObject(IntPtr dc,IntPtr obj);
        [DllImport("gdi32.dll")]static extern bool DeleteObject(IntPtr obj);
        [DllImport("gdi32.dll")]static extern bool DeleteDC(IntPtr dc);
        [DllImport("user32.dll",SetLastError=true)]static extern bool UpdateLayeredWindow(IntPtr hwnd,IntPtr target,ref Point position,ref Size size,IntPtr source,ref Point origin,int key,ref Blend blend,int flags);
        public static void Upload(IntPtr hwnd,Bitmap bitmap){
            IntPtr previous=SetThreadDpiAwarenessContext(new IntPtr(-4)),screen=IntPtr.Zero,dc=IntPtr.Zero,hbitmap=IntPtr.Zero,old=IntPtr.Zero;
            try{
                Rect rect;if(!GetWindowRect(hwnd,out rect))throw new InvalidOperationException("widget bounds unavailable");
                screen=GetDC(IntPtr.Zero);dc=CreateCompatibleDC(screen);hbitmap=bitmap.GetHbitmap(Color.FromArgb(0));old=SelectObject(dc,hbitmap);
                var position=new Point{x=rect.l,y=rect.t};var origin=new Point();var size=new Size{w=bitmap.Width,h=bitmap.Height};var blend=new Blend{alpha=255,format=1};
                if(!UpdateLayeredWindow(hwnd,screen,ref position,ref size,dc,ref origin,0,ref blend,2))throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error());
            }finally{
                if(old!=IntPtr.Zero)SelectObject(dc,old);if(hbitmap!=IntPtr.Zero)DeleteObject(hbitmap);if(dc!=IntPtr.Zero)DeleteDC(dc);if(screen!=IntPtr.Zero)ReleaseDC(IntPtr.Zero,screen);
                if(previous!=IntPtr.Zero)SetThreadDpiAwarenessContext(previous);
            }
        }
    }
}
