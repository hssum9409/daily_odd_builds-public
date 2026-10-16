/* Day 1 release-channel rules, scoped to Day 005. No credentials or user records. */
var WorklogUpdates = (function () {
    'use strict';
    var repository = 'hssum9409/daily_odd_builds-public';
    function version(value) { var m = /^(?:day005-v)?(\d+)\.(\d+)\.(\d+)$/.exec(value || ''); return m ? m.slice(1).map(Number) : null; }
    function newer(a, b) { a=version(a); b=version(b); if(!a || !b)return false; for(var i=0;i<3;i++){if(a[i]!==b[i])return a[i]>b[i];} return false; }
    function select(items,current,platform) {
        if(!Array.isArray(items)||!version(current)||['windows','macos'].indexOf(platform)<0)throw new Error('update_response');
        var name=platform==='windows'?'WorklogScripts-windows-update.zip':'WorklogScripts-macos-update-preview.zip',found=[];
        items.forEach(function(item){
            if(!item||item.draft!==false||item.prerelease!==false||!/^day005-v\d+\.\d+\.\d+$/.test(item.tag_name||'')||!newer(item.tag_name,current)||!Array.isArray(item.assets))return;
            var base='https://github.com/'+repository+'/releases/download/'+item.tag_name+'/',assets={},duplicate={};
            item.assets.forEach(function(a){if(a&&a.state==='uploaded'){if(assets[a.name])duplicate[a.name]=true;assets[a.name]=a;}});
            var zip=assets[name],sums=assets['SHA256SUMS.txt'];
            if(!zip||!sums||duplicate[name]||duplicate['SHA256SUMS.txt']||zip.browser_download_url!==base+name||sums.browser_download_url!==base+'SHA256SUMS.txt'||!Number.isInteger(zip.size)||zip.size<=0||zip.size>33554432)return;
            if(zip.digest&&!/^sha256:[a-fA-F0-9]{64}$/.test(zip.digest))return;
            found.push({version:item.tag_name.slice(8),name:name,url:zip.browser_download_url,sums:sums.browser_download_url,size:zip.size,digest:(zip.digest||'').slice(7).toLowerCase()});
        });
        return found.sort(function(a,b){return newer(a.version,b.version)?-1:newer(b.version,a.version)?1:0;})[0]||null;
    }
    function checksum(text,name){var matches=text.split(/\r?\n/).filter(function(line){var p=line.split(/\s+/);return /^[a-fA-F0-9]{64}$/.test(p[0])&&p.length===2&&p[1].replace(/^\*/,'')===name;});if(matches.length!==1)throw new Error('update_checksum');return matches[0].split(/\s+/)[0].toLowerCase();}
    return {repository:repository,api:'https://api.github.com/repos/'+repository+'/releases?per_page=100',version:version,newer:newer,select:select,checksum:checksum};
}());
if(typeof module!=='undefined')module.exports=WorklogUpdates;
