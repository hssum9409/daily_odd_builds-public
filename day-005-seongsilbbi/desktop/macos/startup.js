ObjC.import('Foundation');
function run() {
 var env=$.NSProcessInfo.processInfo.environment,root=ObjC.unwrap(env.objectForKey('WORKLOG_AGENT_ROOT')),home=ObjC.unwrap(env.objectForKey('WORKLOG_AGENT_HOME')),path=ObjC.unwrap(env.objectForKey('WORKLOG_AGENT_PATH'));
 var plist=$({Label:'com.dailyoddbuilds.worklog-scripts',ProgramArguments:['/usr/bin/osascript','-l','JavaScript',root+'/desktop/macos/Runtime.js'],EnvironmentVariables:{WORKLOG_SCRIPTS_ROOT:root,WORKLOG_SCRIPTS_HOME:home},RunAtLoad:true,StandardOutPath:home+'/startup.log',StandardErrorPath:home+'/startup.log'});
 if(!plist.writeToFileAtomically($(path),true))throw new Error('Cannot register login startup');
 return 'Registered for next login';
}
