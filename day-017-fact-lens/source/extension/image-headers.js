import { dcinsideImageRule } from '../shared/dcinside.mjs';
let ready;
export function prepareImageHeaders() {
  return ready ||= (async () => {
    const rule = dcinsideImageRule(chrome.runtime.id);
    await chrome.declarativeNetRequest.updateSessionRules({ removeRuleIds: [rule.id], addRules: [rule] });
  })().catch(error => { ready = undefined; throw error; });
}
