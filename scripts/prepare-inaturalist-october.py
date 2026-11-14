"""Reproduce the reviewed additive batch without modifying either input CSV.

Usage: python scripts/prepare-inaturalist-october.py PATH_TO_ADDITIVE_AUDIT [--write]
The audit directory holds candidates.json, current-review.json, baseline.json,
and the public API responses and SHA-256 sidecars in api/.
"""
import argparse, collections, csv, datetime, hashlib, json, pathlib

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('audit', type=pathlib.Path)
parser.add_argument('--write', action='store_true')
args = parser.parse_args()
def read(p): return json.loads(p.read_text(encoding='utf-8-sig'))
work=args.audit
repo=pathlib.Path(__file__).resolve().parent.parent
date_root=work.parent/'date-repair-2026-11-13'
csv_name='all observations until October 2026 - observed_on corrected.csv'
csv_hash='458236338a35c2a8ae43a5724e5b031bcf720d02a66bed6a96d717d9ea4edf14'
date_hash='5a3b242321a990cf6e2e424abb9102d527d82f81ec432acdde70c5fc6ad43811'
assert hashlib.sha256((date_root/'outputs'/csv_name).read_bytes()).hexdigest()==csv_hash
assert hashlib.sha256((date_root/'outputs/date-correction-log.csv').read_bytes()).hexdigest()==date_hash
with (date_root/'outputs'/csv_name).open(encoding='utf-8-sig', newline='') as handle:
    source_rows=list(csv.DictReader(handle))
assert len(source_rows)==16088
candidates=read(work/'candidates.json')
review={r['id']:r for r in read(work/'current-review.json')}
baseline=read(work/'baseline.json')
assert hashlib.sha256((work/'baseline.json').read_bytes()).hexdigest()=='ebff2a887d42003b3c02990d5928abc71a59e2c2124d78c8d4d20f9d2334a0a4'
existing={r['composite_id'] for r in baseline}
assert len(baseline)==15389 and len(existing)==15389
assert len(candidates)==798 and len({r['id'] for r in candidates})==798
api={}; provenance={}
for path in sorted((work/'api').glob('current-*.json')):
    if path.name.endswith('.meta.json'): continue
    meta=read(path.with_name(path.name+'.meta.json'))
    assert hashlib.sha256(path.read_bytes()).hexdigest()==meta['sha256']
    for r in read(path)['results']:
        key=str(r['id']); assert key not in api
        api[key]=r; provenance[key]=meta
records=[]; held=[]
for c in candidates:
    key=c['id']; r=api[key]; v=c['values']; d=c['date_verification']; meta=provenance[key]
    assert v==source_rows[c['csv_record_number']-2]
    assert 'inat_'+key not in existing
    assert r['uuid']==c['uuid']==v['originalRecordId']
    assert d['inaturalist_id']==key and d['corrected_observed_on']==v['observed_on']
    for field in ('observed_on','observed_on_string','observed_time_zone'):
        assert r[field]==d['api_'+field]
    assert datetime.datetime.fromisoformat(r['time_observed_at'])==datetime.datetime.fromisoformat(d['api_time_observed_at'])
    if review[key]['issues']:
        held.append(key)
        continue
    assert d['status'] in ('verified_datetime','verified_date_conflicting_time')
    day,*time=v['observed_on'].split(' ')
    assert day==r['observed_on']
    assert (len(time)==1)==(d['status']=='verified_datetime')
    coords=r['geojson']['coordinates']
    assert abs(float(v['latitude'])-coords[1])<=1e-8 and abs(float(v['longitude'])-coords[0])<=1e-8
    assert not r['obscured'] and r['geoprivacy'] in (None,'open') and r['taxon_geoprivacy'] in (None,'open')
    assert r['quality_grade']==v['quality_grade'] and r['user']['login']==v['user_login']
    tax=r['taxon']
    verification={
        'inaturalist_id':key,'uuid':r['uuid'],'retrieved_at':meta['retrieved_utc'],
        'response_sha256':meta['sha256'],
        **{k:r[k] for k in ('observed_on','observed_on_string','time_observed_at','observed_time_zone','quality_grade','geoprivacy','taxon_geoprivacy','obscured')},
        'date_status':d['status'],'taxon_id':tax['id'],'taxon_rank':tax['rank'],
        'scientific_name':tax['name'],'iconic_taxon_name':tax.get('iconic_taxon_name') or '',
        'user_login':r['user']['login'],'latitude':coords[1],'longitude':coords[0],
    }
    records.append({'inaturalist_id':key,'excel_row':c['csv_record_number'],
        'observed_date':'/'.join(reversed(day.split('-'))),'observed_time':time[0] if time else '',
        'values':v,'verification':verification})
assert len(records)==792
assert sorted(held)==['410656308','410656312','410656314','410656316','410656320','410656326']
batch={'schemaVersion':2,'source':{'fileName':csv_name,'sha256':csv_hash,'sheetName':'',
    'dateAuditSha256':date_hash,'recordNumberMeaning':'CSV logical record, header is record 1',
    'groupPolicy':'Source group for new observations only; historical assignments unchanged. User approved 2026-11-14.',
    'candidateCount':798,'heldUnverifiedDateIds':held},'records':records}
data=(json.dumps(batch,ensure_ascii=False,indent=2)+'\n').encode('utf-8')
output=repo/'public/inaturalist-october-2026-additions.json'
if args.write: output.write_bytes(data)
else: assert output.read_bytes()==data, 'Batch is not reproducible'
print(json.dumps({'records':len(records),'held':len(held),'sha256':hashlib.sha256(data).hexdigest(),
    'grades':dict(collections.Counter(r['values']['quality_grade'] for r in records)),
    'groups':dict(collections.Counter(r['values']['user_category']+'|'+r['values']['user_subcategory'] for r in records)),
    'date_only':[r['inaturalist_id'] for r in records if not r['observed_time']]},ensure_ascii=False))
