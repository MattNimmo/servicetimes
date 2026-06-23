# PCO data-shape validation — 2026-06-23

Read-only probe against the latest completed plan for ELK, LV, MG, and SLP.
No Planning Center or database values were changed.

## Confirmed

- The four allowlisted Service Types are readable with the dedicated Viewer token.
- A service target must come from each mapped PlanTime's `starts_at` and `ends_at`.
  Latest targets were SLP `72:15`, MG `90:10`, ELK `73:50`, and LV `71:45`.
- `ItemTime.length` matched `live_end_at - live_start_at` within one second for
  all 138 completed ItemTimes. `length_offset` is not added to actual duration.
- For PlanTimes with complete LIVE data, summed ItemTime durations matched the
  PlanTime live window. The item layer can therefore explain the headline while
  a reconciliation gap handles incomplete or corrected data.
- Section dividers arrived as zero-length `header` items. Timed bundle rows such
  as `Worship Bundle` arrived as ordinary `item` rows, so item type alone cannot
  define parent/child rollups.
- `service_position='pre'` is populated and can exclude Countdown/Pre-Service
  from service-element analytics.

## Production blockers exposed by live data

PCO's `time_type`, `recorded`, and `name` fields do not identify production
slots by themselves:

- Run-throughs and rehearsals can be `time_type='service'` and `recorded=true`.
- PlanTime names can be null.
- MG had a mapped-looking `Service #1` with complete item timers totaling
  `79:33`, while its PlanTime LIVE window was zero seconds and `recorded=false`.
- SLP, ELK, and LV each had an earlier run-through mixed with production-service
  candidates.

Production slots should therefore be mapped from the PlanTime's planned local
start to a configured campus slot (9 AM, 10 AM, 11 AM). Names and PCO flags are
diagnostic evidence only. Missing, duplicate, or zero-duration mapped slots go
to Admin review; the app must not silently substitute item sums for the
headline or write corrections back to PCO.

## Review candidates found

The sequence-based overlap detector found timed worship parent rows followed by
independently timed songs at MG, ELK, and LV. MG's opening `Worship Bundle` was
`20:00` while two following songs added `11:00`. These are review candidates,
not automatic corrections.

No zero-allotment-over-three-seconds or timer-bleed candidate appeared in this
latest-plan sample.

## Backend consequence

The first migration needs explicit PlanTime selection state and occurrence-level
slot assignment. Raw PCO values remain immutable; approved planned or actual
corrections are database overlays for that service occurrence only.
