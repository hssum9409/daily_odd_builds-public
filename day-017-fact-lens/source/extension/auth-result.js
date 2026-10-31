async function update() {
 const response = await chrome.runtime.sendMessage({type:'auth.status'});
 const status = response?.data;
 document.getElementById('result').textContent = status?.pending ? '열린 ChatGPT 로그인 절차를 진행하고 있습니다.' : status?.error || (status?.sharing ? '연결했습니다. 사이드패널에서 검증을 시작하세요.' : status?.connected ? '로그인했습니다. 요금제 사용 권한을 승인해야 검증할 수 있습니다.' : '로그인을 준비하고 있습니다.');
}
chrome.storage.onChanged.addListener(() => { void update(); });
void update();
