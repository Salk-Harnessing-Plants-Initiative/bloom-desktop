## REMOVED Requirements

### Requirement: Row-Merge Scanning

**Reason**: Hardware testing (2026-04-09) confirmed direct grid ROI scanning is reliable at all resolutions. Row-merge (scan bounding box + PIL crop) added complexity and crop alignment risk with no benefit over direct grid scanning.

**Migration**: All plates now scan individually at their exact grid region coordinates. No data migration needed — output TIFF format and metadata are unchanged.
