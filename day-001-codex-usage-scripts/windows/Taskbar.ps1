# 작업표시줄 전용 보조 창. 계정 요청 없이 메인 모니터의 표시 데이터만 받는다.
param([Parameter(Mandatory=$true)][string]$StatePath,[Parameter(Mandatory=$true)][int]$ParentId,[string]$ReportPath='')
$ErrorActionPreference='Stop'
. "$PSScriptRoot/Launch.ps1" -LoadOnly
Disconnect-MonitorConsole
Add-Type -AssemblyName System.Windows.Forms,System.Drawing,System.Web.Extensions,UIAutomationClient,UIAutomationTypes,WindowsBase
Add-Type -Path @("$PSScriptRoot/TaskbarNative.cs","$PSScriptRoot/TaskbarDesign.cs","$PSScriptRoot/TaskbarWidget.cs") -ReferencedAssemblies @('System.dll','System.Core.dll',[Web.Script.Serialization.JavaScriptSerializer].Assembly.Location,[Windows.Forms.Form].Assembly.Location,[Drawing.Bitmap].Assembly.Location,[Windows.Automation.AutomationElement].Assembly.Location,[Windows.Automation.ControlType].Assembly.Location,[Windows.Rect].Assembly.Location)
[UsageScripts.TaskbarWidget]::Run($StatePath,$ParentId,$ReportPath)
