// 데스크톱 경로 동기화 로그에서 현재 로컬 대화 ID만 해석한다. 대화 본문은 해석하거나 저장하지 않는다.
using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading.Tasks;
namespace UsageScripts {
    public sealed class VisibleSession {
        public volatile string Thread="",Status="waiting";volatile bool busy;
        public bool Busy{get{return busy;}}
        public long LastReadBytes{get;private set;}
        readonly Dictionary<string,string> routes=new Dictionary<string,string>();
        readonly HashSet<string> inactive=new HashSet<string>();
        static readonly Regex Fields=new Regex(@"\b(windowId|ownerRoutePath|rendererWindowId|conversationId|active)=([^\s]+)");
        static readonly Regex Id=new Regex(@"^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$",RegexOptions.IgnoreCase);
        string filePath="",prefix="";long offset;DateTime modified;int processId;
        readonly List<byte> partial=new List<byte>();bool skip;double nextDiscovery;
        public void Consume(string line){
            bool route=line.Contains("IAB_LIFECYCLE received browser sidebar owner sync"),activity=line.Contains("thread_stream_view_activity_changed");
            if(!route && !activity)return;
            var fields=new Dictionary<string,string>();foreach(Match m in Fields.Matches(line))fields[m.Groups[1].Value]=m.Groups[2].Value;
            string window;
            if(route && fields.TryGetValue("windowId",out window)){
                string value,thread="";if(fields.TryGetValue("ownerRoutePath",out value)){
                    Uri absolute;if(Uri.TryCreate(value,UriKind.Absolute,out absolute) && (absolute.Scheme=="http" || absolute.Scheme=="https"))value=absolute.PathAndQuery;
                    int query=value.IndexOf('?');string path=query<0?value:value.Substring(0,query);string parameters=query<0?"":value.Substring(query+1);
                    bool local=!parameters.Split('&').Any(p=>p.StartsWith("hostId=") && p!="hostId=local");
                    if(local && (path.StartsWith("/local/") || path.StartsWith("/c/"))){
                        string candidate=Uri.UnescapeDataString(path.Substring(path.StartsWith("/local/")?7:3));
                        if(candidate.StartsWith("local-chatgpt:"))candidate=candidate.Substring(14);
                        if(Id.IsMatch(candidate))thread=candidate.ToLowerInvariant();
                    }
                }
                routes[window]=thread;inactive.Remove(window);
            }else if(activity && fields.TryGetValue("rendererWindowId",out window)){
                string conversation,active,current;
                if(fields.TryGetValue("conversationId",out conversation) && routes.TryGetValue(window,out current) && current==conversation.Replace("local-chatgpt:","").ToLowerInvariant() && fields.TryGetValue("active",out active)){
                    if(active=="false")inactive.Add(window);else if(active=="true")inactive.Remove(window);
                }
            }
        }
        void Publish(){
            // 여러 창의 대화가 다르면 하나를 임의 선택하지 않는다. 원격/새 대화도 기존 수치로 위장하지 않는다.
            var active=routes.Where(p=>!inactive.Contains(p.Key)).Select(p=>p.Value).Distinct().ToArray();
            Thread=active.Length==1?active[0]:"";Status=Thread.Length>0?"current":active.Length>1?"ambiguous":"waiting";
        }
        public void ObserveLine(string line){Consume(line);Publish();}
        void Reset(int pid){processId=pid;filePath="";offset=0;modified=DateTime.MinValue;prefix="";partial.Clear();skip=false;routes.Clear();inactive.Clear();nextDiscovery=0;Thread="";Status="waiting";}
        public void Refresh(string local,int pid){
            if(busy)return;busy=true;
            Task.Run(delegate{try{
                if(pid<=0){Reset(0);return;}if(pid!=processId)Reset(pid);
                double now=DateTimeOffset.UtcNow.ToUnixTimeSeconds();LastReadBytes=0;
                if(now>=nextDiscovery){
                    nextDiscovery=now+2;var roots=new List<string>{Path.Combine(local,"Codex","Logs")};
                    string packages=Path.Combine(local,"Packages");
                    if(Directory.Exists(packages))foreach(string p in Directory.EnumerateDirectories(packages,"OpenAI.Codex_*"))roots.Add(Path.Combine(p,"LocalCache","Local","Codex","Logs"));
                    var files=new List<string>();foreach(string root in roots)foreach(int ago in new[]{0,1,2}){
                        string folder=Path.Combine(root,DateTime.Now.AddDays(-ago).ToString("yyyy/MM/dd",CultureInfo.InvariantCulture).Replace('/',Path.DirectorySeparatorChar));
                        if(Directory.Exists(folder))files.AddRange(Directory.EnumerateFiles(folder,"codex-desktop-*-"+pid+"-t0-*.log"));
                    }
                    string latest=files.OrderByDescending(File.GetLastWriteTimeUtc).FirstOrDefault();
                    // 같은 앱 프로세스의 날짜별 로그 교체는 마지막 경로를 승계한다. 새 경로 이벤트가 즉시 덮어쓴다.
                    if(latest!=null && latest!=filePath){filePath=latest;offset=0;prefix="";partial.Clear();skip=false;Thread="";Status="catching-up";}
                }
                if(filePath.Length==0){Status="unavailable";return;}
                var info=new FileInfo(filePath);
                if(info.Length==offset && info.LastWriteTimeUtc==modified){Publish();return;}
                using(var file=new FileStream(filePath,FileMode.Open,FileAccess.Read,FileShare.ReadWrite|FileShare.Delete)){
                    var head=new byte[Math.Min(file.Length,128)];file.Read(head,0,head.Length);LastReadBytes+=head.Length;string signature=Convert.ToBase64String(head);
                    if(file.Length<offset || (file.Length==offset && modified!=info.LastWriteTimeUtc) || (prefix.Length>0 && !signature.StartsWith(prefix))){offset=0;routes.Clear();inactive.Clear();partial.Clear();skip=false;Thread="";}
                    prefix=signature;file.Seek(offset,SeekOrigin.Begin);long remaining=Math.Min(2*1024*1024,file.Length-offset);var buffer=new byte[65536];int count;
                    while(remaining>0 && (count=file.Read(buffer,0,(int)Math.Min(buffer.Length,remaining)))>0){offset+=count;remaining-=count;LastReadBytes+=count;
                        for(int i=0;i<count;i++){byte b=buffer[i];if(b==10){if(!skip)Consume(Encoding.UTF8.GetString(partial.ToArray()));partial.Clear();skip=false;}else if(!skip){if(partial.Count>=65536){partial.Clear();skip=true;}else partial.Add(b);}}
                    }
                    modified=info.LastWriteTimeUtc;if(offset>=file.Length && partial.Count==0 && !skip)Publish();else{Thread="";Status="catching-up";}
                }
            }catch{Thread="";Status="delayed";}finally{busy=false;}});
        }
    }
}
