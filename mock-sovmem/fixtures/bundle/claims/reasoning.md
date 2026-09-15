---
{
  "type": "Claim",
  "title": "AI assistance can reduce independent reasoning practice.",
  "status": "stable",
  "schema_version": "sovmem-record-v4",
  "synthetic": true,
  "sovmem": {
    "id": "claim-reasoning",
    "store_id": "demo-nous",
    "profile_id": "nous-mock-v1",
    "kind": "claim",
    "revision": 1,
    "previous_revision": null,
    "scope": "pilot",
    "lifecycle": "active",
    "epistemic_status": "hypothesis",
    "decision_ref": "demo-seed-verdict",
    "recorded_at": "2026-09-15T00:00:00Z",
    "valid_from": null,
    "valid_until": null,
    "sensitivity": "synthetic",
    "retention_class": "demo",
    "provenance": {
      "tier": "unknown",
      "reason": "synthetic fixture"
    },
    "edges": [
      {
        "relation": "contradicts",
        "target_id": "claim-ai",
        "target_revision": 1,
        "scope": "pilot",
        "evidence_locator": "/sources/risk.md"
      }
    ]
  },
  "sources": [
    {
      "id": "risk",
      "resource": "/sources/risk.md"
    }
  ]
}
---

Synthetic counterposition: delegating explanations can reduce practice. This can coexist with productivity gains.[^risk]

[^risk]: Synthetic source for this fixture.
