// Public GET source inspection only. No credentials, account profile, form writes,
// or claims that a login-only application form has been tested successfully.
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const directory = resolve(dirname(fileURLToPath(import.meta.url)), '../../.preview');
const entries = [
  ['三一', 'https://sanycampus.zhiye.com/form?fromPage=editMyResume'],
  ['京东', 'https://campus.jd.com/web/resume/resume_index'],
  ['华为', 'https://career.huawei.com/reccampportal/next/mini/faq_h5.html'],
  ['百度', 'https://talent.baidu.com/jobs/campus'],
  ['美团', 'https://zhaopin.meituan.com/web/question/campus'],
  ['小米', 'https://hr.xiaomi.com/website/campus.html'],
  ['腾讯', 'https://careers.tencent.com/'],
  ['联想', 'https://talent.lenovo.com.cn/'],
  ['中国石化', 'https://job.sinopec.com/']
];
async function inspect([company, url]) {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(20000), credentials: 'omit' });
    const reader = response.body.getReader(), chunks = []; let bytes = 0;
    while (true) { const item = await reader.read(); if (item.done) break; bytes += item.value.byteLength; if (bytes > 4 * 1024 * 1024) { await reader.cancel(); break; } chunks.push(Buffer.from(item.value)); }
    const html = Buffer.concat(chunks).toString('utf8');
    const scripts = [...html.matchAll(/<script\b[^>]*\bsrc\s*=\s*["']([^"']+)/gi)].map(match => new URL(match[1], response.url).href);
    const result = { company, url, finalURL: response.url, status: response.status,
      title: /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1].replace(/\s+/g, ' ').trim() || '',
      bytes, inputTagsInHTML: [...html.matchAll(/<input\b/gi)].length, scripts: scripts.slice(0, 8),
      scope: 'public source only; no logged-in form acceptance test' };
    console.log(`${company}: HTTP ${result.status}, ${result.title || '(dynamic document)'}`); return result;
  } catch (error) { console.log(`${company}: ${error.name}`); return { company, url, error: error.name, scope: 'public source unavailable in this run' }; }
}
const results = await Promise.all(entries.map(inspect));
await mkdir(directory, { recursive: true });
await writeFile(resolve(directory, 'company-source-audit.json'), JSON.stringify({ checkedAt: new Date().toISOString(), results }, null, 2));
console.log('Saved .preview/company-source-audit.json. Public-page availability does not establish form compatibility.');
