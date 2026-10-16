using System;
using System.IO;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Media;
using Microsoft.Win32;

namespace WorklogScripts {
 public static class StartupRegistration {
  private static bool asked;
  private static Window prompt;
  public static bool Visible{get{return prompt!=null&&prompt.IsVisible;}}
  private const string RunKey="Software\\Microsoft\\Windows\\CurrentVersion\\Run";
  public static bool ShouldAsk(string choice,bool registered){return !registered&&choice!="registered"&&choice!="never";}
  public static void Remember(string profile,string choice){
   if(choice!="registered"&&choice!="never"&&choice!="later")throw new ArgumentException("Unknown startup choice");
   Directory.CreateDirectory(profile);var path=Path.Combine(profile,"startup-settings.json");
   File.WriteAllText(path+".tmp",Json.Write(new{choice=choice}),new System.Text.UTF8Encoding(false));
   if(File.Exists(path))File.Replace(path+".tmp",path,null);else File.Move(path+".tmp",path);
  }
  private static bool Eligible(string root){
   if(Environment.GetEnvironmentVariable("WORKLOG_DISABLE_STARTUP_PROMPT")=="1"||!string.IsNullOrEmpty(Environment.GetEnvironmentVariable("WORKLOG_QA_EMAIL")))return false;
   try{var receipt=Json.Read(File.ReadAllText(Path.Combine(root,"installed.json")));return Json.Text(receipt,"product")=="WorklogScripts"&&Path.GetFullPath(Json.Text(receipt,"root"))==Path.GetFullPath(root)&&!(Json.Get(receipt,"isolated") as bool? ?? false);}catch{return false;}
  }
  private static string Existing(){using(var key=Registry.CurrentUser.OpenSubKey(RunKey)){return key==null?"":Convert.ToString(key.GetValue("WorklogScripts"));}}
  public static void ShowIfNeeded(string root,string profile,bool dark){
   if(asked||!Eligible(root))return;asked=true;
   try{
    string choice="",path=Path.Combine(profile,"startup-settings.json");if(File.Exists(path)){try{choice=Json.Text(Json.Read(File.ReadAllText(path)),"choice");}catch{}}
    string launcher=Path.Combine(root,"desktop","windows","Launch.ps1");bool registered=Existing().IndexOf(launcher,StringComparison.OrdinalIgnoreCase)>=0;
    if(!ShouldAsk(choice,registered)){if(registered&&choice!="registered")Remember(profile,"registered");return;}
    prompt=CreatePrompt(root,dark,()=>{
     string current=Existing();if(current!=""&&current.IndexOf(launcher,StringComparison.OrdinalIgnoreCase)<0)throw new InvalidOperationException("다른 앱의 시작 항목을 덮어쓸 수 없어요.");
     string ps=Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.System),"WindowsPowerShell","v1.0","powershell.exe");
     using(var key=Registry.CurrentUser.CreateSubKey(RunKey)){key.SetValue("WorklogScripts","\""+ps+"\" -NoProfile -STA -WindowStyle Hidden -ExecutionPolicy Bypass -File \""+launcher+"\"",RegistryValueKind.String);}
    },value=>Remember(profile,value));
    prompt.Closed+=(s,e)=>prompt=null;prompt.Show();prompt.Activate();
   }catch{/* A startup preference must never prevent the widget from running. */}
  }
  // Registration is supplied separately so native UI tests never change OS login items.
  public static Window CreatePrompt(string root,bool dark,Action register,Action<string> remember){
   Func<string,Brush> brush=s=>new SolidColorBrush((Color)ColorConverter.ConvertFromString(s));
   Brush ink=brush(dark?"#F1F1E8":"#353A34"),muted=brush(dark?"#B0B9AA":"#767F70"),accent=brush(dark?"#BDDBAE":"#496844");
   var font=new FontFamily(new Uri(Path.Combine(root,"desktop","assets")+Path.DirectorySeparatorChar,UriKind.Absolute),"./#NanumSquareRound Regular");
   var window=new Window{Title="성실삐🤖",Width=460,SizeToContent=SizeToContent.Height,ResizeMode=ResizeMode.NoResize,WindowStartupLocation=WindowStartupLocation.CenterScreen,Background=brush(dark?"#202620":"#F2F0E8"),FontFamily=font,ShowInTaskbar=true};
   using(var stream=File.OpenRead(Path.Combine(root,"desktop","assets","app.ico"))){window.Icon=System.Windows.Media.Imaging.BitmapFrame.Create(stream,System.Windows.Media.Imaging.BitmapCreateOptions.PreservePixelFormat,System.Windows.Media.Imaging.BitmapCacheOption.OnLoad);}
   var canvas=new Grid();var body=new StackPanel{Margin=new Thickness(28)};canvas.Children.Add(body);window.Content=canvas;
   var image=new Image{Source=new System.Windows.Media.Imaging.BitmapImage(new Uri(Path.Combine(root,"desktop","assets","robot.png"))),Width=40,Height=40,HorizontalAlignment=HorizontalAlignment.Left,Margin=new Thickness(0,0,0,18)};body.Children.Add(image);
   body.Children.Add(new TextBlock{Text="컴퓨터를 켜면, 같이 시작할까요?",FontSize=20,FontWeight=FontWeights.Bold,Foreground=ink,TextWrapping=TextWrapping.Wrap});
   body.Children.Add(new TextBlock{Text="Windows에 로그인하면 성실삐 위젯을 띄워둘게요.\n업무 시간은 직접 시작할 때부터 기록해요.",FontSize=13,Foreground=muted,TextWrapping=TextWrapping.Wrap,LineHeight=22,Margin=new Thickness(0,12,0,22)});
   var error=new TextBlock{Foreground=brush(dark?"#E8B9A3":"#A55F4D"),TextWrapping=TextWrapping.Wrap};body.Children.Add(error);
   var actions=new StackPanel{Orientation=Orientation.Horizontal,HorizontalAlignment=HorizontalAlignment.Right};body.Children.Add(actions);bool decided=false;
   Action<string,bool> choose=(choice,enable)=>{try{if(enable)register();remember(choice);decided=true;window.Close();}catch{error.Text="등록하지 못했어요. 권한을 확인한 뒤 다시 시도해 주세요.";}};
   foreach(string choice in new[]{"never","later","registered"}){
    string captured=choice;var button=new Button{Content=choice=="registered"?"등록하기":choice=="never"?"다시는 묻지 않음":"나중에",Tag=choice,Padding=new Thickness(13,10,13,10),Margin=new Thickness(6,6,0,0),Background=choice=="registered"?accent:brush(dark?"#3B4938":"#DFE5D9"),Foreground=choice=="registered"?(dark?brush("#243421"):Brushes.White):ink,BorderThickness=new Thickness(0),FontSize=12,Cursor=System.Windows.Input.Cursors.Hand};
    var border=new FrameworkElementFactory(typeof(Border));border.SetValue(Border.CornerRadiusProperty,new CornerRadius(10));border.SetBinding(Border.BackgroundProperty,new System.Windows.Data.Binding("Background"){RelativeSource=new System.Windows.Data.RelativeSource(System.Windows.Data.RelativeSourceMode.TemplatedParent)});var content=new FrameworkElementFactory(typeof(ContentPresenter));content.SetValue(FrameworkElement.MarginProperty,new Thickness(13,10,13,10));border.AppendChild(content);button.Template=new ControlTemplate(typeof(Button)){VisualTree=border};button.Click+=(s,e)=>choose(captured,captured=="registered");actions.Children.Add(button);
   }
   window.Closing+=(s,e)=>{if(!decided){try{remember("later");}catch{}}};return window;
  }
 }
}
