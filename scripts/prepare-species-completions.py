"""Reproduce the focused iNaturalist dictionary supplement from the saved API audit.
Usage: python scripts/prepare-species-completions.py AUDIT_DIRECTORY [--write]
"""
import argparse, hashlib, json, pathlib
p=argparse.ArgumentParser(description=__doc__); p.add_argument('audit',type=pathlib.Path); p.add_argument('--write',action='store_true'); args=p.parse_args()
findings=json.loads((args.audit/'findings.json').read_text(encoding='utf-8'))
assert len(findings)==177 and len({f['taxon_id'] for f in findings})==177
records=[]
for f in sorted(findings,key=lambda f:f['name']):
    assert not f['issues'] and f['is_active'] and f['name']==f['canonical_name']
    aliases=sorted({a['Scientific_Name'] for a in f['existing_aliases']})
    assert len(aliases)<=1
    records.append({'Scientific_Name':f['name'],'Hebrew_Name':f['Hebrew_Name'] or f['name'],
        'English_Name':f['English_Name'],'Category':f['Category'],'isGeneric':f['isGeneric'],
        'inaturalistTaxonId':f['taxon_id'],'taxonRank':f['rank'],
        **({'existingScientificName':aliases[0]} if aliases else {}),
        'apiUrl':f"https://api.inaturalist.org/v1/taxa/{f['taxon_id']}?all_names=true&locale=he",
        'apiResponseSha256':f['provenance']['sha256'],'verifiedAt':f['provenance']['retrieved_utc']})
assert sum(r['isGeneric'] for r in records)==52
assert sum('existingScientificName' in r for r in records)==1
header='''// Generated from 177 ID-verified, active iNaturalist taxa. See the focused audit.
// Existing dictionary entries and rare/invasive classifications are not replaced.
export type SpeciesCompletion = {
  Scientific_Name: string;
  Hebrew_Name: string;
  English_Name: string;
  Category: string;
  isGeneric: boolean;
  inaturalistTaxonId: number;
  taxonRank: string;
  existingScientificName?: string;
  apiUrl: string;
  apiResponseSha256: string;
  verifiedAt: string;
};

export const speciesCompletions: SpeciesCompletion[] = '''
data=(header+json.dumps(records,ensure_ascii=False,indent=2)+';\n').encode()
target=pathlib.Path(__file__).resolve().parent.parent/'src/lib/species-completions-data.ts'
if args.write: target.write_bytes(data)
else: assert target.read_text(encoding='utf-8').encode()==data
print(json.dumps({'verified_taxa':len(records),'new_dictionary_rows':176,'existing_aliases':1,'generic':52,'sha256':hashlib.sha256(data).hexdigest()}))
