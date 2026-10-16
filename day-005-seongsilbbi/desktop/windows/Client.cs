// Compiled in memory by Windows PowerShell 5.1 using OS-provided assemblies.
using System;
using System.Collections;
using System.Collections.Generic;
using System.Diagnostics;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Net.Http;
using System.Net.Http.Headers;
using System.Security.Cryptography;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using System.Web.Script.Serialization;

namespace WorklogScripts {
 public static class Json {
  public static string Write(object value) { return new JavaScriptSerializer { MaxJsonLength=2097152 }.Serialize(value); }
  public static Dictionary<string,object> Read(string value) { return new JavaScriptSerializer { MaxJsonLength=2097152 }.Deserialize<Dictionary<string,object>>(value); }
  public static object Get(Dictionary<string,object> value,string key) { if(value==null)return null; object result; if(value.TryGetValue(key,out result))return result; if(value.TryGetValue(char.ToUpperInvariant(key[0])+key.Substring(1),out result))return result; return null; }
  public static string Text(Dictionary<string,object> value,string key) { return Convert.ToString(Get(value,key),CultureInfo.InvariantCulture); }
  public static long Number(Dictionary<string,object> value,string key) { var v=Get(value,key);return v==null?0:Convert.ToInt64(v,CultureInfo.InvariantCulture); }
  public static Dictionary<string,object> Map(Dictionary<string,object> value,string key) { return Get(value,key) as Dictionary<string,object>; }
  public static List<Dictionary<string,object>> Rows(Dictionary<string,object> value,string key) { var list=Get(value,key) as IEnumerable;return list==null?new List<Dictionary<string,object>>():list.Cast<object>().OfType<Dictionary<string,object>>().ToList(); }
 }
 public class ApiError:Exception { public int Status;public ApiError(string message,int status):base(message){Status=status;} }
 public sealed class Store {
  public readonly string DirectoryPath;
  public Store(string directory) { DirectoryPath=Path.GetFullPath(directory);Directory.CreateDirectory(DirectoryPath); }
  private string PathFor(string name) { if(!new[]{"session","pending","panel"}.Contains(name))throw new ArgumentException("Unknown store entry");return Path.Combine(DirectoryPath,name+".bin"); }
  public void Save(string name,object value) { string path=PathFor(name);byte[] bytes=ProtectedData.Protect(Encoding.UTF8.GetBytes(Json.Write(value)),null,DataProtectionScope.CurrentUser);File.WriteAllBytes(path+".tmp",bytes);if(File.Exists(path))File.Replace(path+".tmp",path,null);else File.Move(path+".tmp",path); }
  public Dictionary<string,object> Read(string name) { try{string p=PathFor(name);return File.Exists(p)?Json.Read(Encoding.UTF8.GetString(ProtectedData.Unprotect(File.ReadAllBytes(p),null,DataProtectionScope.CurrentUser))):null;}catch{return null;} }
  public void Remove(string name) { var p=PathFor(name);if(File.Exists(p))File.Delete(p); }
 }
 public sealed class Client:IDisposable {
  public readonly Store Store;
  public Dictionary<string,object> Session,Snapshot,Pending;
  public event Action Changed;
  public readonly string Dashboard;
  public string ApiBase { get {return api;} }
  private readonly string api,key,database,identity,tokenUrl;
  private readonly bool emulator;
  private readonly HttpClient http=new HttpClient { Timeout=TimeSpan.FromSeconds(25) };
  private readonly HttpClient streaming=new HttpClient { Timeout=Timeout.InfiniteTimeSpan };
  private readonly SemaphoreSlim tokenLock=new SemaphoreSlim(1),readLock=new SemaphoreSlim(1),writeLock=new SemaphoreSlim(1);
  private readonly Stopwatch elapsed=Stopwatch.StartNew();
  private long sessionGeneration;
  private long anchor=UtcNow();private CancellationTokenSource cancellation;private bool disposed;
  public long Now {get{return anchor+elapsed.ElapsedMilliseconds;}}
  public static long UtcNow() {return (long)(DateTime.UtcNow-new DateTime(1970,1,1,0,0,0,DateTimeKind.Utc)).TotalMilliseconds;}
  public Client(string root,string profile,bool local) {
   emulator=local;Store=new Store(profile);var config=Json.Read(File.ReadAllText(Path.Combine(root,"config","firebase.json")));
   key=Json.Text(config,"apiKey");database=Json.Text(config,"databaseURL");string project=Json.Text(config,"projectId");
   api=local?"http://127.0.0.1:5188/demo-worklog/asia-northeast3/api":"https://asia-northeast3-"+project+".cloudfunctions.net/api";
   identity=local?"http://127.0.0.1:9198/identitytoolkit.googleapis.com/v1":"https://identitytoolkit.googleapis.com/v1";
   tokenUrl=local?"http://127.0.0.1:9198/securetoken.googleapis.com/v1/token":"https://securetoken.googleapis.com/v1/token";
   string dashboard=Json.Text(config,"appUrl");
   Dashboard=local?"http://127.0.0.1:5178/":(string.IsNullOrWhiteSpace(dashboard)?"https://"+project+".web.app/":dashboard);
  }
  private void Signal() {var handler=Changed;if(handler!=null)handler();}
  private static async Task<Dictionary<string,object>> ReadResponse(HttpResponseMessage response,string fallback) {
   Dictionary<string,object> data;try{data=Json.Read(await response.Content.ReadAsStringAsync().ConfigureAwait(false));}catch{throw new ApiError(fallback,(int)response.StatusCode);}
   if(response.IsSuccessStatusCode)return data;string message=Json.Text(Json.Map(data,"error"),"message");throw new ApiError(message.Any(c=>c>127)?message:fallback,(int)response.StatusCode);
  }
  public async Task<bool> Restore() {
   Session=Store.Read("session");if(Session==null)return false;Pending=Store.Read("pending");if(Json.Text(Pending,"uid")!=Json.Text(Session,"uid"))Pending=null;
   try{await Refresh().ConfigureAwait(false);StartStream();return true;}catch(ApiError e){if(e.Status==400||e.Status==401){Logout();return false;}throw;}
  }
  public async Task<string> DashboardLink() {
   if(Session==null)return Dashboard;
   string uid=Json.Text(Session,"uid");long generation=Interlocked.Read(ref sessionGeneration);
   using(var request=new HttpRequestMessage(HttpMethod.Post,api+"/desktop-login/issue")) {
    request.Content=new StringContent("{}",Encoding.UTF8,"application/json");
    request.Headers.Authorization=new AuthenticationHeaderValue("Bearer",await Token().ConfigureAwait(false));
    if(Json.Text(Session,"uid")!=uid||Interlocked.Read(ref sessionGeneration)!=generation)throw new OperationCanceledException();
    using(var response=await http.SendAsync(request).ConfigureAwait(false)) {
     var result=await ReadResponse(response,"대시보드 로그인을 연결하지 못했습니다. 잠시 후 다시 열어 주세요.").ConfigureAwait(false);
     if(Json.Text(Session,"uid")!=uid||Interlocked.Read(ref sessionGeneration)!=generation)throw new OperationCanceledException();
     string ticket=Json.Text(result,"ticket");
     if(!System.Text.RegularExpressions.Regex.IsMatch(ticket,"^[A-Za-z0-9_-]{43}$"))throw new ApiError("로그인 연결 응답이 올바르지 않습니다.",502);
     return Dashboard+"#desktop-login="+ticket;
    }
   }
  }
  public async Task Login(string email,string password) {
   using(var response=await http.PostAsync(identity+"/accounts:signInWithPassword?key="+key,new StringContent(Json.Write(new{email=email,password=password,returnSecureToken=true}),Encoding.UTF8,"application/json")).ConfigureAwait(false)) {
    var r=await ReadResponse(response,"이메일과 비밀번호를 확인해 주세요.").ConfigureAwait(false);
    Interlocked.Increment(ref sessionGeneration);Session=new Dictionary<string,object>{{"idToken",r["idToken"]},{"refreshToken",r["refreshToken"]},{"uid",r["localId"]},{"email",email},{"expiresAt",UtcNow()+3500000}};Store.Save("session",Session);
   }
   Pending=Store.Read("pending");if(Json.Text(Pending,"uid")!=Json.Text(Session,"uid"))Pending=null;await Refresh().ConfigureAwait(false);StartStream();
  }
  private async Task<string> Token() {
   await tokenLock.WaitAsync().ConfigureAwait(false);try{
    if(Session==null)throw new ApiError("로그인이 필요합니다.",401);var previous=Session;string uid=Json.Text(previous,"uid");
    if(Json.Number(previous,"expiresAt")>UtcNow()+60000)return Json.Text(previous,"idToken");
    using(var response=await http.PostAsync(tokenUrl+"?key="+key,new FormUrlEncodedContent(new Dictionary<string,string>{{"grant_type","refresh_token"},{"refresh_token",Json.Text(previous,"refreshToken")}})).ConfigureAwait(false)) {
     var r=await ReadResponse(response,"로그인이 만료되었습니다. 다시 로그인해 주세요.").ConfigureAwait(false);if(Json.Text(Session,"uid")!=uid)throw new OperationCanceledException();
     Session=new Dictionary<string,object>{{"idToken",r["id_token"]},{"refreshToken",r["refresh_token"]},{"uid",uid},{"email",Json.Text(previous,"email")},{"expiresAt",UtcNow()+3500000}};Store.Save("session",Session);return Json.Text(Session,"idToken");
    }
   }finally{tokenLock.Release();}
  }
  public static string DateKey(long now,string zone) {
   var ids=new Dictionary<string,string>{{"Asia/Seoul","Korea Standard Time"},{"Asia/Tokyo","Tokyo Standard Time"},{"America/Los_Angeles","Pacific Standard Time"},{"America/New_York","Eastern Standard Time"},{"Europe/London","GMT Standard Time"},{"UTC","UTC"}};
   string id;TimeZoneInfo tz;try{tz=TimeZoneInfo.FindSystemTimeZoneById(ids.TryGetValue(zone,out id)?id:zone);}catch{throw new ApiError("웹 설정에서 지원되는 시간대를 선택해 주세요.",400);}
   return TimeZoneInfo.ConvertTimeFromUtc(new DateTime(1970,1,1,0,0,0,DateTimeKind.Utc).AddMilliseconds(now),tz).ToString("yyyy-MM-dd",CultureInfo.InvariantCulture);
  }
  public async Task Refresh() {
   await readLock.WaitAsync().ConfigureAwait(false);try{
    string uid=Json.Text(Session,"uid"),zone=Json.Text(Json.Map(Snapshot,"state"),"timeZone");if(zone=="")zone="Asia/Seoul";string day=DateKey(Now,zone);
    using(var request=new HttpRequestMessage(HttpMethod.Get,api+"/snapshot?from="+day+"&to="+day)) {
     request.Headers.Authorization=new AuthenticationHeaderValue("Bearer",await Token().ConfigureAwait(false));using(var response=await http.SendAsync(request).ConfigureAwait(false)) {
      var next=await ReadResponse(response,"기록을 불러오지 못했습니다.").ConfigureAwait(false);if(Json.Text(Session,"uid")!=uid)return;
      if(Json.Number(Json.Map(Snapshot,"state"),"revision")>Json.Number(Json.Map(next,"state"),"revision"))return;
      Snapshot=next;anchor=Json.Number(next,"serverNow");elapsed.Restart();Signal();
     }
    }
   }finally{readLock.Release();}
  }
  public async Task Command(string action,string dayId,long? dailyGoalMs=null) {
   if(Pending!=null||Snapshot==null||Session==null)throw new ApiError("먼저 기록과 저장 결과를 확인해 주세요.",409);
   var body=new Dictionary<string,object>{{"action",action},{"expectedRevision",Json.Number(Json.Map(Snapshot,"state"),"revision")},{"requestId",Guid.NewGuid().ToString()}};if(dayId!=null)body["dayId"]=dayId;if(action=="setDailyGoal")body["dailyGoalMs"]=dailyGoalMs;
   Pending=new Dictionary<string,object>{{"uid",Json.Text(Session,"uid")},{"json",Json.Write(body)}};Store.Save("pending",Pending);await Retry().ConfigureAwait(false);
  }
  public async Task Retry() {
   await writeLock.WaitAsync().ConfigureAwait(false);try{
    if(Pending==null){await Refresh().ConfigureAwait(false);StartStream();return;}
    if(Json.Text(Pending,"uid")!=Json.Text(Session,"uid"))throw new ApiError("저장 요청 계정이 다릅니다.",409);
    using(var request=new HttpRequestMessage(HttpMethod.Post,api+"/command")) {
     request.Content=new StringContent(Json.Text(Pending,"json"),Encoding.UTF8,"application/json");request.Headers.Authorization=new AuthenticationHeaderValue("Bearer",await Token().ConfigureAwait(false));
     using(var response=await http.SendAsync(request).ConfigureAwait(false)) {
      int status=(int)response.StatusCode;if(status<500){Pending=null;Store.Remove("pending");}
      ApiError failure=null;try{await ReadResponse(response,"기록을 저장하지 못했습니다.").ConfigureAwait(false);}catch(ApiError e){failure=e;}
      if(failure!=null){if(failure.Status==409)await Refresh().ConfigureAwait(false);throw failure;}
     }
    }
    await Refresh().ConfigureAwait(false);
   }finally{writeLock.Release();Signal();}
  }
  private void StartStream() {if(cancellation!=null)cancellation.Cancel();cancellation=new CancellationTokenSource();Stream(cancellation.Token);}
  private async void Stream(CancellationToken token) {
   int delay=1;while(!token.IsCancellationRequested&&Session!=null){
    try{string t=await Token().ConfigureAwait(false),uid=Json.Text(Session,"uid");string url=emulator?"http://127.0.0.1:9197/signals/"+uid+".json?ns=demo-worklog-default-rtdb&auth=":""+database+"/signals/"+uid+".json?auth=";
     using(var lifetime=CancellationTokenSource.CreateLinkedTokenSource(token)) {lifetime.CancelAfter(TimeSpan.FromMinutes(45));using(var request=new HttpRequestMessage(HttpMethod.Get,url+Uri.EscapeDataString(t))) {
      request.Headers.Accept.Add(new MediaTypeWithQualityHeaderValue("text/event-stream"));using(var response=await streaming.SendAsync(request,HttpCompletionOption.ResponseHeadersRead,lifetime.Token).ConfigureAwait(false)) {
       response.EnsureSuccessStatusCode();using(var content=await response.Content.ReadAsStreamAsync().ConfigureAwait(false))using(lifetime.Token.Register(()=>content.Dispose()))using(var reader=new StreamReader(content)) {
        delay=1;while(!lifetime.IsCancellationRequested){var line=await reader.ReadLineAsync().ConfigureAwait(false);if(line==null)break;if(line.StartsWith("event: auth_revoked")){if(Session!=null)Session["expiresAt"]=0;break;}if(line.StartsWith("event: cancel"))break;if(line.StartsWith("event: put")||line.StartsWith("event: patch"))await Refresh().ConfigureAwait(false);}
       }
      }
     }}
    }catch{if(token.IsCancellationRequested)break;}
    try{await Task.Delay(TimeSpan.FromSeconds(delay),token).ConfigureAwait(false);}catch{break;}delay=Math.Min(30,delay*2);
   }
  }
  public void Logout() {Interlocked.Increment(ref sessionGeneration);if(cancellation!=null)cancellation.Cancel();Session=null;Snapshot=null;Pending=null;Store.Remove("session");Store.Remove("pending");Signal();}
  public void Dispose(){if(disposed)return;disposed=true;if(cancellation!=null)cancellation.Cancel();http.Dispose();streaming.Dispose();}
 }
}
