// 별도 PowerShell 대신 같은 프로세스의 STA 스레드에서 WinForms를 실행한다.
// UI 간 통신은 기존 파일/창 메시지만 사용하고 PowerShell 콜백을 넘기지 않는다.
using System;
using System.Threading;
using System.Windows.Forms;
namespace UsageScripts {
    public static class TaskbarService {
        static readonly object gate=new object();static Thread thread;static TaskbarWidget widget;static bool stopping;
        public static string Error {get;private set;}
        public static bool Running {get{lock(gate)return thread!=null && thread.IsAlive;}}
        public static int ThreadId {get{lock(gate)return thread==null?0:thread.ManagedThreadId;}}
        public static void Start(string path,int parent,string report){
            lock(gate){
                if(thread!=null && thread.IsAlive)return;
                stopping=false;Error=null;
                thread=new Thread(delegate(){
                    try{
                        Application.SetUnhandledExceptionMode(UnhandledExceptionMode.ThrowException,true);
                        using(var form=new TaskbarWidget(path,parent,report)){
                            lock(gate){widget=form;if(stopping)return;}
                            form.HandleCreated+=delegate{lock(gate){if(stopping)form.BeginInvoke(new Action(form.Close));}};
                            Application.Run(form);
                        }
                    }catch(Exception e){Error=e.GetType().Name;}
                    finally{lock(gate){widget=null;}}
                });
                thread.IsBackground=true;thread.Name="Codex usage taskbar";thread.SetApartmentState(ApartmentState.STA);thread.Start();
            }
        }
        public static void Stop(){
            Thread join;
            lock(gate){stopping=true;join=thread;if(widget!=null && widget.IsHandleCreated){try{widget.BeginInvoke(new Action(widget.Close));}catch(InvalidOperationException){}}}
            // 종료 중 WinForms 메시지를 처리할 시간만 기다린다. 메인 WPF의 포커스는 건드리지 않는다.
            if(join!=null && join!=Thread.CurrentThread)join.Join(2000);
        }
    }
}
