# PCO taxonomy review — 2026-06-23

Zero-write ingestion preview against the latest completed ELK, LV, MG, and SLP
plans. All four campuses completed successfully. No Planning Center or Supabase
values were changed.

## Review summary

| Classification | Count | Treatment |
| --- | ---: | --- |
| Combined title | 6 | Manual bucket or planned-time split; never auto-alias |
| Rollup review | 5 | Decide whether the song is a child of a timed parent |
| Section mismatch | 1 | Review the source header before moving buckets |

## Combined titles

- SLP: `Host Pastor//New Guest`
- SLP: `Salvation Response//Connect Card`
- MG: `Salvation Response/Next steps`
- ELK: `Salvation Response CC` (Salvation Response plus Connect Card; local
  after the broadcast LIVE time)
- LV: `Host Pastor//Close Worship`
- LV: `Final Prayer//Dismissal`

These rows name more than one moment. Mapping the whole duration to one element
would fabricate precision, so the importer leaves them unmapped for review.

## Rollup candidates

- MG opening worship: `Battle Belongs`, `Worthy`
- MG local response: `Midst`
- ELK local response: `Cornerstone`
- LV local response: `Worthy Of It All`

Song titles should not become durable aliases. They need an occurrence-level
decision about whether they roll up under the surrounding timed worship or
response parent.

## Approved alias

- `Closing Prayer` maps to `local.final_prayer`.

## Section mismatch

- MG: `Close Worship` appears under `worship_open`, while the shared taxonomy
  maps that title to `mid.close_worship` in `mid_service`. The importer reports
  the suggested destination but does not move it automatically.
