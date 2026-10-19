"""Development-only conversion of official public directories to offline JSON.
Requires pypdf and xlrd (2.0.2). Never included in extension execution paths.
"""
import json
import re
import sys
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CACHE = ROOT / '.preview' / 'official-catalogs'
sys.path.insert(0, str(ROOT / '.preview' / 'catalog-tools'))
CACHE.mkdir(parents=True, exist_ok=True)
OUT = ROOT / 'data'
OUT.mkdir(exist_ok=True)

def download(name, url):
    path = CACHE / name
    if not path.exists():
        request = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
        with urllib.request.urlopen(request, timeout=40) as response:
            path.write_bytes(response.read())
    return path

def save(name, source, items):
    (OUT / name).write_text(json.dumps({'source': source, 'version': '2026', 'items': items}, ensure_ascii=False, separators=(',', ':')) + '\n', encoding='utf-8')

import xlrd
schools = []
for filename in ['W020260618416094865984.xls', 'W020260618307096079727.xls']:
    path = download(filename, 'https://www.moe.gov.cn/jyb_xxgk/s5743/s5744/202606/' + filename)
    book = xlrd.open_workbook(path)
    for sheet in book.sheets():
        for row in sheet.get_rows():
            cells = [str(cell.value).strip() for cell in row]
            if len(cells) > 2 and re.fullmatch(r'\d{10}(?:\.0)?', cells[2]):
                schools.append({'name': cells[1], 'code': cells[2].removesuffix('.0')})
assert len(schools) > 2500, f'Unexpected school count: {len(schools)}'
save('schools-cn.json', 'https://www.moe.gov.cn/jyb_xxgk/s5743/s5744/202606/t20260618_1441074.html', schools)

from pypdf import PdfReader
path = download('majors-2026.pdf', 'https://www.moe.gov.cn/srcsite/A08/moe_1034/s3882/202604/W020260427440749576927.pdf')
text = '\n'.join(page.extract_text(extraction_mode='layout') for page in PdfReader(path).pages)
(CACHE / 'majors.txt').write_text(text, encoding='utf-8')
groups = []
majors = []
for line in text.splitlines():
    match = re.match(r'^\s*(\d{2}|\d{4})\s+(?:学科门类[：:]\s*)?([\u4e00-\u9fff]+)\s*$', line)
    if match and not any(item['code'] == match[1] for item in groups):
        groups.append({'code': match[1], 'name': match[2]})
    match = re.match(r'^\s*(\d{6,7}[TK]*)\s+([\u4e00-\u9fff]+)', line)
    if match:
        majors.append({'code': match[1], 'name': match[2]})
assert sum(len(item['code']) == 4 for item in groups) == 92, f'Unexpected category count: {len(groups)}; inspect cached text'
save('major-categories-cn.json', 'https://www.moe.gov.cn/srcsite/A08/moe_1034/s3882/202604/t20260427_1434931.html', groups)
assert len(majors) == 883, f'Unexpected major count: {len(majors)}'
save('majors-cn.json', 'https://www.moe.gov.cn/srcsite/A08/moe_1034/s3882/202604/t20260427_1434931.html', majors)
print(f'Official offline catalogs: {len(schools)} schools; {len(groups)} discipline/category rows')
