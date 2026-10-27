// 대화 본문을 수집하지 않고 로컬 사용량/시간 이벤트만 해석한다. 결과는 메모리에만 둔다.
using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text.RegularExpressions;
using System.Text;
using System.Threading.Tasks;
using System.Web.Script.Serialization;
namespace UsageScripts {
    public sealed class MetricPoint {public double At,Input,Cached,Output;public double? Speed;public string Model="";}
    public sealed class SessionSnapshot {
        public string Source="waiting",Model="",Thread="";public double Input,Cached,Output,Total,Checked;
        public MetricPoint[] Points=new MetricPoint[0]; public bool Valid;
    }
    public sealed class SessionMetrics {
        volatile bool busy;public volatile SessionSnapshot Current=new SessionSnapshot();
        public bool Busy{get{return busy;}}
        string selectedPath,lookupKey="";DateTime pathCheck=DateTime.MinValue;
        string cachedPath;long cachedLength=-1;DateTime cachedWrite;
        public int LastDecodedRows {get;private set;}
        public long LastReadBytes {get;private set;}
        long offset;DateTime identityCreated;byte[] prefix=new byte[0];
        readonly List<byte> partial=new List<byte>();bool skipping,previewed,recorded;
        SessionSnapshot aggregate=new SessionSnapshot();string model="";
        readonly List<MetricPoint> points=new List<MetricPoint>();
        readonly HashSet<string> seen=new HashSet<string>(),speeds=new HashSet<string>();
        readonly Queue<string> seenOrder=new Queue<string>(),speedOrder=new Queue<string>(),turnOrder=new Queue<string>();
        readonly Dictionary<string,object> turns=new Dictionary<string,object>();
        readonly JavaScriptSerializer json=new JavaScriptSerializer{MaxJsonLength=1048576};
        void ResetParser(){offset=0;prefix=new byte[0];partial.Clear();skipping=previewed=recorded=false;aggregate=new SessionSnapshot();model="";points.Clear();seen.Clear();speeds.Clear();seenOrder.Clear();speedOrder.Clear();turnOrder.Clear();turns.Clear();}
        static bool Remember(HashSet<string> set,Queue<string> order,string key){if(!set.Add(key))return false;order.Enqueue(key);while(order.Count>2048)set.Remove(order.Dequeue());return true;}
        void AddPoint(MetricPoint point){points.Add(point);if(points.Count>40)points.RemoveAt(0);}
        bool Consume(string line){
            if(line.Length>1048576 || !(line.Contains("token_usage_record") || line.Contains("token_count") || line.Contains("turn_context") || line.Contains("task_complete")))return false;
            string envelope=Kind(line,0);
            if(envelope!="token_usage_record" && envelope!="turn_context" && envelope!="event_msg")return false;
            if(envelope=="event_msg"){
                int at=FieldStart(line,0,"payload");if(at<0 || line[at]!='{')return false;
                string kind=Kind(line,at);if(kind!="token_count" && kind!="task_complete")return false;
            }
            object row;try{row=json.DeserializeObject(line);}catch{return false;}
            LastDecodedRows++;
            string type=Convert.ToString(Field(row,"type"));object payload=Field(row,"payload");
            if(type=="turn_context"){model=Convert.ToString(Field(payload,"model"));aggregate.Model=model;return true;}
            DateTimeOffset stamp;if(!DateTimeOffset.TryParse(Convert.ToString(Field(row,"timestamp")),out stamp))return true;
            if(type=="token_usage_record"){
                string id=Convert.ToString(Field(payload,"response_id"));if(id.Length>0 && !Remember(seen,seenOrder,id))return true;
                var total=Field(payload,"thread_token_usage");var usage=Field(payload,"usage");
                if(Totals(total)){SetTotals(aggregate,total);recorded=true;}
                AddPoint(new MetricPoint{At=stamp.ToUnixTimeSeconds(),Input=Number(Field(usage,"input_tokens")),Cached=Number(Field(usage,"cached_input_tokens")),Output=Number(Field(usage,"output_tokens")),Model=model});
                string turn=Convert.ToString(Field(payload,"turn_id"));
                if(turn.Length>0){if(!turns.ContainsKey(turn))turnOrder.Enqueue(turn);turns[turn]=Field(payload,"turn_token_usage");while(turnOrder.Count>2048)turns.Remove(turnOrder.Dequeue());}
            }else if(Convert.ToString(Field(payload,"type"))=="token_count" && !recorded){
                var total=Field(Field(payload,"info"),"total_token_usage");if(Totals(total))SetTotals(aggregate,total);
            }else if(Convert.ToString(Field(payload,"type"))=="task_complete"){
                string turn=Convert.ToString(Field(payload,"turn_id"));object usage;double ms=Number(Field(payload,"duration_ms"));
                if(ms>0 && turns.TryGetValue(turn,out usage) && Remember(speeds,speedOrder,turn+":"+stamp.Ticks))AddPoint(new MetricPoint{At=stamp.ToUnixTimeSeconds(),Speed=Number(Field(usage,"output_tokens"))/(ms/1000),Model=model});
            }
            return true;
        }
        // 본문 안에 메타데이터 단어가 등장해도 큰 메시지 전체를 JSON 디코드하지 않는다.
        // 최상위 필드만 훑고, 필요한 이벤트의 payload.type도 같은 방법으로 확인한다.
        static int FieldStart(string text,int start,string name){
            int depth=0;
            for(int i=start;i<text.Length;i++){
                char ch=text[i];
                if(ch=='{' || ch=='['){depth++;continue;}
                if(ch=='}' || ch==']'){if(--depth<=0)return -1;continue;}
                if(ch!='"')continue;
                int begin=++i;
                while(i<text.Length){if(text[i]=='\\'){i+=2;continue;}if(text[i]=='"')break;i++;}
                if(i>=text.Length)return -1;
                if(depth!=1 || i-begin!=name.Length || String.CompareOrdinal(text,begin,name,0,name.Length)!=0)continue;
                int at=i+1;while(at<text.Length && Char.IsWhiteSpace(text[at]))at++;
                if(at>=text.Length || text[at++]!=':')continue;
                while(at<text.Length && Char.IsWhiteSpace(text[at]))at++;
                return at<text.Length?at:-1;
            }
            return -1;
        }
        static string Kind(string text,int start){
            int at=FieldStart(text,start,"type");if(at<0 || text[at]!='"')return "";
            int end=text.IndexOf('"',at+1);if(end<0 || end-at>40)return "";
            return text.Substring(at+1,end-at-1);
        }
        static object Field(object value,string name){var map=value as Dictionary<string,object>;object item;return map!=null && map.TryGetValue(name,out item) ? item:null;}
        static double Number(object value){double n;return value!=null && Double.TryParse(Convert.ToString(value),out n) && !Double.IsNaN(n) && !Double.IsInfinity(n) && n>=0 ? n:0;}
        static bool Counter(object value){double n;return value!=null && !(value is bool) && Double.TryParse(Convert.ToString(value),out n) && !Double.IsNaN(n) && !Double.IsInfinity(n) && n>=0;}
        static bool Totals(object value){return Counter(Field(value,"input_tokens")) && Counter(Field(value,"cached_input_tokens")) && Counter(Field(value,"output_tokens")) && Counter(Field(value,"total_tokens")) && Number(Field(value,"cached_input_tokens"))<=Number(Field(value,"input_tokens"));}
        static void SetTotals(SessionSnapshot snapshot,object total){snapshot.Input=Number(Field(total,"input_tokens"));snapshot.Cached=Number(Field(total,"cached_input_tokens"));snapshot.Output=Number(Field(total,"output_tokens"));snapshot.Total=Number(Field(total,"total_tokens"));snapshot.Valid=true;}
        public void Refresh(string home,string requestedThread,string launchThread) {
            if(busy)return;busy=true;
            Task.Run(delegate{try{
                string thread=Regex.IsMatch(requestedThread??"","^[a-f0-9-]{36}$") ? requestedThread : Regex.IsMatch(launchThread??"","^[a-f0-9-]{36}$") ? launchThread:"";
                string source=Regex.IsMatch(requestedThread??"","^[a-f0-9-]{36}$") ? "selected" : !String.IsNullOrEmpty(thread) ? "launch":"recent";
                string lookup=home+"|"+thread;
                if(lookup!=lookupKey){lookupKey=lookup;selectedPath=null;pathCheck=DateTime.MinValue;}
                if(DateTime.UtcNow>=pathCheck || (selectedPath!=null && !File.Exists(selectedPath))){
                    pathCheck=DateTime.UtcNow.AddSeconds(thread.Length>0?30:10);
                    string folder=Path.Combine(home,"sessions");
                    // Work는 대화ID_실행ID.jsonl 형태도 사용한다. 대화 ID 뒤의 실행 식별자를 허용한다.
                    string pattern=thread.Length==0?"*.jsonl":"*"+thread+"*.jsonl";
                    selectedPath=Directory.Exists(folder) ? Directory.EnumerateFiles(folder,pattern,SearchOption.AllDirectories).OrderByDescending(File.GetLastWriteTimeUtc).FirstOrDefault():null;
                    if(selectedPath==null)pathCheck=DateTime.UtcNow.AddSeconds(2);
                }
                if(selectedPath==null){ResetParser();cachedPath=null;Current=new SessionSnapshot{Thread=thread,Source=source};return;}
                var fileInfo=new FileInfo(selectedPath);
                LastReadBytes=0;LastDecodedRows=0;
                if(cachedPath==selectedPath && cachedLength==fileInfo.Length && cachedWrite==fileInfo.LastWriteTimeUtc && Current.Source==source)return;
                using(var file=new FileStream(selectedPath,FileMode.Open,FileAccess.Read,FileShare.ReadWrite|FileShare.Delete)){
                    var head=new byte[Math.Min(128,file.Length)];file.Read(head,0,head.Length);LastReadBytes+=head.Length;
                    bool reset=cachedPath!=selectedPath || identityCreated!=fileInfo.CreationTimeUtc || file.Length<offset ||
                        (file.Length==offset && cachedWrite!=fileInfo.LastWriteTimeUtc) || prefix.Length>head.Length || !head.Take(prefix.Length).SequenceEqual(prefix);
                    if(reset){ResetParser();identityCreated=fileInfo.CreationTimeUtc;offset=Math.Max(0,file.Length-8*1024*1024);skipping=offset>0;}
                    prefix=head;file.Seek(offset,SeekOrigin.Begin);
                    // 첫 읽기만 최근 8MiB, 이후에는 추가 바이트만 처리한다. UTF-8 미완성 행은 다음 읽기로 넘긴다.
                    var buffer=new byte[65536];long remaining=Math.Min(8*1024*1024,file.Length-offset);int count;
                    while(remaining>0 && (count=file.Read(buffer,0,(int)Math.Min(buffer.Length,remaining)))>0){
                        offset+=count;LastReadBytes+=count;remaining-=count;
                        for(int i=0;i<count;i++){
                            byte b=buffer[i];
                            if(b==10){if(!skipping && !previewed)Consume(Encoding.UTF8.GetString(partial.ToArray()).TrimStart('\uFEFF'));partial.Clear();skipping=previewed=false;}
                            else if(!skipping){if(partial.Count>=1048576){partial.Clear();skipping=true;previewed=false;}else partial.Add(b);}
                        }
                    }
                    // 줄바꿈 없이 끝나는 기존 기록도 읽되, 다음 줄바꿈에서 중복 적용하지 않는다.
                    if(!skipping && !previewed && partial.Count>0)previewed=Consume(Encoding.UTF8.GetString(partial.ToArray()).TrimStart('\uFEFF'));
                }
                Current=new SessionSnapshot{Source=source,Thread=thread,Checked=DateTimeOffset.UtcNow.ToUnixTimeSeconds(),Input=aggregate.Input,Cached=aggregate.Cached,Output=aggregate.Output,Total=aggregate.Total,Valid=aggregate.Valid,Model=model,Points=points.ToArray()};
                cachedPath=selectedPath;cachedLength=offset;cachedWrite=fileInfo.LastWriteTimeUtc;
            }catch{Current=new SessionSnapshot{Source="delayed"};}finally{busy=false;}});
        }
    }
}
