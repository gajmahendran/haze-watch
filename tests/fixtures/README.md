# Test fixtures

- `nea-psi-2026-10-22.json`, `nea-pm25-2026-10-22.json`: responses recorded from data.gov.sg on
  22 October 2026 (NEA, Singapore Open Data Licence v1.0). Used only to test the parser.
- `firms-sample.csv`: the header and first row were recorded from the NASA FIRMS NOAA-20 Southeast
  Asia 24-hour file. **All other rows are hand-written edge cases** (a duplicate, a bad brightness
  value, an impossible time, a truncated line, points placed to test country labelling). They are
  not real detections.
