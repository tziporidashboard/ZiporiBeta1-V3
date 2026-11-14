"""Prepare the six separately reviewed Observed-field additions, preserving source CSV literals.
Usage: python scripts/prepare-inaturalist-observed-display.py AUDIT_DIRECTORY [--write]
"""
import argparse,csv,datetime,hashlib,json,pathlib
p=argparse.ArgumentParser(description=__doc__)
p.add_argument('audit',type=pathlib.Path);p.add_argument('--write',action='store_true');args=p.parse_args()
work=args.audit;repo=pathlib.Path(__file__).resolve().parent.parent
def read(path):return json.loads(path.read_text(encoding='utf-8-sig'))
def sha(data):return hashlib.sha256(data).hexdigest()
def encoded(value):return (json.dumps(value,ensure_ascii=False,indent=2)+'\n').encode()
csv_name='all observations until October 2026 - observed_on corrected.csv'
csv_hash='458236338a35c2a8ae43a5724e5b031bcf720d02a66bed6a96d717d9ea4edf14'
source_path=work.parent/'date-repair-2026-11-13/outputs'/csv_name
assert sha(source_path.read_bytes())==csv_hash
with source_path.open(encoding='utf-8-sig',newline='') as f:source=list(csv.DictReader(f))
review=read(work/'screenshots-review.json');meta=read(work/'api-current.meta.json')
assert review['mapping_confirmed_by_user'] is True
api_bytes=(work/'api-current.json').read_bytes();assert sha(api_bytes)==meta['sha256']
api={str(o['id']):o for o in read(work/'api-current.json')['results']}
expected=['410656308','410656312','410656314','410656316','410656320','410656326']
assert list(r['inaturalist_id'] for r in review['records'])==expected and set(api)==set(expected)
baseline=read(work/'baseline-observations.json');assert len(baseline)==16181
existing={o['composite_id'] for o in baseline}
records=[];pins={}
for display in review['records']:
    id=display['inaturalist_id'];o=api[id]
    assert 'inat_'+id not in existing
    assert sha((work/display['evidence_file']).read_bytes())==display['screenshot_sha256']
    matches=[(n,r) for n,r in enumerate(source,2) if r['originalRecordId']==o['uuid']]
    assert len(matches)==1
    rownum,v=matches[0];coords=o['geojson']['coordinates'];tax=o['taxon']
    assert o['user']['login']==v['user_login']==display['displayed_observer']=='yuvalev'
    assert tax['is_active'] and tax['name']==v['scientific_name']
    assert o['quality_grade']==v['quality_grade']
    assert [float(v['longitude']),float(v['latitude'])]==coords
    assert not o['obscured'] and o['geoprivacy'] in (None,'open') and o['taxon_geoprivacy'] in (None,'open')
    assert v['user_category']==v['user_subcategory']=='online communities'
    # Screenshots, rather than API text or created_at, select the timestamp.
    day=display['displayed_date'];time=display['displayed_time']
    assert display['field_label']=='נצפה' and display['time_zone_label']=='IDT' and display['precision']=='minute'
    assert o['observed_on']==day and o['observed_time_zone']=='Asia/Jerusalem'
    timestamp=datetime.datetime.fromisoformat(o['time_observed_at'])
    assert timestamp.strftime('%Y-%m-%d %H:%M')==day+' '+time
    assert timestamp.utcoffset()==datetime.timedelta(hours=3)
    assert o['observed_on_string'].startswith('2026/10/24 23:')
    assert v['observed_on'].startswith('2026-10-25 09:48:')
    pins[id]={'uuid':o['uuid'],'sourceObservedOn':v['observed_on'],'date':day,'time':time,'screenshotSha256':display['screenshot_sha256']}
    verification={'inaturalist_id':id,'uuid':o['uuid'],'retrieved_at':meta['retrieved_utc'],'response_sha256':meta['sha256'],
        **{k:o[k] for k in ['observed_on','observed_on_string','time_observed_at','observed_time_zone','quality_grade','geoprivacy','taxon_geoprivacy','obscured']},
        'date_status':'verified_observed_display','taxon_id':tax['id'],'taxon_rank':tax['rank'],'scientific_name':tax['name'],
        'iconic_taxon_name':tax.get('iconic_taxon_name') or '', 'user_login':o['user']['login'],'latitude':coords[1],'longitude':coords[0],
        'observed_display':display}
    records.append({'inaturalist_id':id,'excel_row':rownum,'observed_date':'/'.join(reversed(day.split('-'))),'observed_time':time,'values':v,'verification':verification})
audit={**review,'source_csv_sha256':csv_hash,'api':meta,'api_conflict':'observed_on_string is on 2026-10-24; observed_on/time_observed_at are on 2026-10-25. Website Observed field selects 2026-10-25.',
    'source_records':[{ 'inaturalist_id':r['inaturalist_id'],'uuid':r['verification']['uuid'],'csv_record_number':r['excel_row'],
        'csv_observed_on':r['values']['observed_on'],'api_observed_on_string':r['verification']['observed_on_string'],
        'api_observed_on':r['verification']['observed_on'],'api_time_observed_at':r['verification']['time_observed_at']} for r in records]}
audit_bytes=encoded(audit);audit_hash=sha(audit_bytes)
batch={'schemaVersion':3,'source':{'fileName':csv_name,'sha256':csv_hash,'sheetName':'','dateAuditSha256':audit_hash,
    'recordNumberMeaning':'CSV logical record, header is record 1','datePolicy':'User-approved visible Observed field, verified from six screenshots. Source literals remain unchanged.',
    'groupPolicy':'Source group for these six new observations only; all existing assignments unchanged.'},'records':records}
ts='// Reviewed screenshot values. Source records retain their original dates in metadata.\n'
ts+='export const OBSERVED_DISPLAY_REVIEW_SHA256 = '+json.dumps(audit_hash)+';\n'
ts+='export const OBSERVED_DISPLAY_SOURCE_SHA256 = '+json.dumps(csv_hash)+';\n'
ts+='export const OBSERVED_DISPLAY_DATES: Readonly<Record<string, {uuid: string; sourceObservedOn: string; date: string; time: string; screenshotSha256: string}>> = '+json.dumps(pins,indent=2)+';\n'
outputs={repo/'public/inaturalist-observed-display-additions.json':encoded(batch),
    repo/'src/lib/observed-display-review.ts':ts.encode(),repo/'docs/inaturalist-observed-display-2026-11-14/review.json':audit_bytes}
for path,data in outputs.items():
    if args.write:path.parent.mkdir(parents=True,exist_ok=True);path.write_bytes(data)
    else:assert path.read_text(encoding='utf-8').encode()==data,path
print(json.dumps({'records':len(records),'review_sha256':audit_hash,'batch_sha256':sha(encoded(batch)),'dates':[[r['inaturalist_id'],r['observed_date'],r['observed_time']] for r in records]}))
