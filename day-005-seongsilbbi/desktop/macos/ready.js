ObjC.import('Foundation');
function run() {
    var env = $.NSProcessInfo.processInfo.environment, home = ObjC.unwrap(env.objectForKey('WORKLOG_SCRIPTS_HOME'));
    var data = $.NSString.stringWithContentsOfFileEncodingError($(home + '/status.json'), $.NSUTF8StringEncoding, $());
    if (!data) throw new Error('No heartbeat');
    var status = JSON.parse(ObjC.unwrap(data)), expected = ObjC.unwrap(env.objectForKey('WORKLOG_READY_ROOT'));
    if (!status.ready || status.root !== expected || Date.now() - status.updatedAt > 3000 || status.ticks < 2) throw new Error('Not ready');
    return 'ready';
}
