# PCO taxonomy review — 2026-06-23

Zero-write ingestion preview against the latest completed ELK, LV, MG, and SLP
plans. All four campuses completed successfully. No Planning Center or Supabase
values were changed.

## Review summary

| Classification | Count | Treatment |
| --- | ---: | --- |
| Combined title | 5 | Manual bucket or planned-time split; never auto-alias |
| Rollup review | 5 | Decide whether the song is a child of a timed parent |
| Missing alias | 2 | Approve a durable alias or leave occurrence unmapped |
| Section mismatch | 1 | Review the source header before moving buckets |

## Combined titles

- SLP: `Host Pastor//New Guest`
- SLP: `Salvation Response//Connect Card`
- MG: `Salvation Response/Next steps`
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

## Missing aliases

- MG local: `Closing Prayer` — likely candidate for `local.final_prayer`, pending
  approval.
- ELK live: `Salvation Response CC` — section placement and whether `CC` means
  Connect Card must be confirmed before mapping.

## Section mismatch

- MG: `Close Worship` appears under `worship_open`, while the shared taxonomy
  maps that title to `mid.close_worship` in `mid_service`. The importer reports
  the suggested destination but does not move it automatically.
