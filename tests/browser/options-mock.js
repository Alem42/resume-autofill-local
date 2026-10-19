// Local test server injects this only into its virtual copy of the options page.
import { fixtureProfile } from './fixture-profile.js';
import { normalizeProfile, DEFAULT_MODEL } from '../../shared/profile.js';
const profile = normalizeProfile(JSON.parse(localStorage.getItem('fictional-test-profile') || 'null') || { ...fixtureProfile,
  family: [{ name: '虚构父亲', relationship: '父亲', political: '群众' }, { name: '虚构母亲', relationship: '母亲', political: '中共党员' }] });
globalThis.chrome = { runtime: { sendMessage: async message => {
  if (message.type === 'GET_OPTIONS') return { profile, model: DEFAULT_MODEL, rememberKey: false, hasKey: false };
  if (message.type === 'SAVE_OPTIONS') { window.savedTestProfile = message.profile; localStorage.setItem('fictional-test-profile', JSON.stringify(message.profile)); return { hasKey: false }; }
  if (message.type === 'CLEAR_PROFILE') { localStorage.removeItem('fictional-test-profile'); return {}; }
  return { error: '测试页不连接外部服务' };
} } };
