// 대화 본문을 수집하지 않고 로컬 사용량/시간 이벤트만 해석한다. 결과는 메모리에만 둔다.
using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text.RegularExpressions;
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
        string selectedPath;DateTime pathCheck=DateTime.MinValue;
        string cachedPath;long cachedLength=-1;DateTime cachedWrite;
        public int LastDecodedRows {get;private set;}
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
                if(DateTime.UtcNow>=pathCheck || selectedPath==null || (thread.Length>0 && !Path.GetFileName(selectedPath).Contains(thread))){
                    pathCheck=DateTime.UtcNow.AddSeconds(10);
                    string folder=Path.Combine(home,"sessions");
                    selectedPath=Directory.Exists(folder) ? Directory.EnumerateFiles(folder,"*.jsonl",SearchOption.AllDirectories).Where(p=>thread.Length==0 || Path.GetFileName(p).Contains(thread)).OrderByDescending(File.GetLastWriteTimeUtc).FirstOrDefault():null;
                }
                if(selectedPath==null){Current=new SessionSnapshot();return;}
                var fileInfo=new FileInfo(selectedPath);
                if(cachedPath==selectedPath && cachedLength==fileInfo.Length && cachedWrite==fileInfo.LastWriteTimeUtc && Current.Source==source)return;
                var snapshot=new SessionSnapshot{Source=source,Thread=thread,Checked=DateTimeOffset.UtcNow.ToUnixTimeSeconds()};
                var points=new List<MetricPoint>();var seen=new HashSet<string>();var turns=new Dictionary<string,object>();
                var json=new JavaScriptSerializer{MaxJsonLength=1048576};string model="";bool recorded=false;int decoded=0;
                using(var file=new FileStream(selectedPath,FileMode.Open,FileAccess.Read,FileShare.ReadWrite|FileShare.Delete)){
                    // 대화 본문을 색인하지 않는다. 최근 8MiB의 누적 카운터와 관측치만 읽는다.
                    file.Seek(Math.Max(0,file.Length-8*1024*1024),SeekOrigin.Begin);
                    using(var reader=new StreamReader(file)){
                        if(file.Position>0)reader.ReadLine();string line;
                        while((line=reader.ReadLine())!=null){
                            if(line.Length>1048576 || !(line.Contains("token_usage_record") || line.Contains("token_count") || line.Contains("turn_context") || line.Contains("task_complete")))continue;
                            string envelope=Kind(line,0);
                            if(envelope!="token_usage_record" && envelope!="turn_context" && envelope!="event_msg")continue;
                            if(envelope=="event_msg"){
                                int payloadAt=FieldStart(line,0,"payload");if(payloadAt<0 || line[payloadAt]!='{')continue;
                                string eventKind=Kind(line,payloadAt);if(eventKind!="token_count" && eventKind!="task_complete")continue;
                            }
                            object row;try{row=json.DeserializeObject(line);}catch{continue;}
                            decoded++;
                            string type=Convert.ToString(Field(row,"type"));object payload=Field(row,"payload");
                            if(type=="turn_context"){model=Convert.ToString(Field(payload,"model"));snapshot.Model=model;continue;}
                            DateTimeOffset stamp;if(!DateTimeOffset.TryParse(Convert.ToString(Field(row,"timestamp")),out stamp))continue;
                            if(type=="token_usage_record"){
                                string identity=Convert.ToString(Field(payload,"response_id"));if(identity.Length>0 && !seen.Add(identity))continue;
                                var total=Field(payload,"thread_token_usage");var usage=Field(payload,"usage");
                                if(Totals(total)){SetTotals(snapshot,total);recorded=true;}
                                points.Add(new MetricPoint{At=stamp.ToUnixTimeSeconds(),Input=Number(Field(usage,"input_tokens")),Cached=Number(Field(usage,"cached_input_tokens")),Output=Number(Field(usage,"output_tokens")),Model=model});
                                string turn=Convert.ToString(Field(payload,"turn_id"));if(turn.Length>0)turns[turn]=Field(payload,"turn_token_usage");
                            }else if(type=="event_msg" && Convert.ToString(Field(payload,"type"))=="token_count" && !recorded){
                                var totals=Field(Field(payload,"info"),"total_token_usage");if(Totals(totals))SetTotals(snapshot,totals);
                            }else if(type=="event_msg" && Convert.ToString(Field(payload,"type"))=="task_complete"){
                                string turn=Convert.ToString(Field(payload,"turn_id"));object usage;double ms=Number(Field(payload,"duration_ms"));
                                if(ms>0 && turns.TryGetValue(turn,out usage))points.Add(new MetricPoint{At=stamp.ToUnixTimeSeconds(),Speed=Number(Field(usage,"output_tokens"))/(ms/1000),Model=model});
                            }
                        }
                    }
                }
                LastDecodedRows=decoded;snapshot.Points=points.Skip(Math.Max(0,points.Count-40)).ToArray();Current=snapshot;
                cachedPath=selectedPath;cachedLength=fileInfo.Length;cachedWrite=fileInfo.LastWriteTimeUtc;
            }catch{Current=new SessionSnapshot{Source="delayed"};}finally{busy=false;}});
        }
    }
}
