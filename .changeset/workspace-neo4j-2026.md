---
"@helmsmith/workspace": patch
---

The devcontainer template's `neo4j-edge` sidecar moves from Neo4j 5 (5.26) to Neo4j 2026 (`neo4j:2026-community`). An existing `neo4j-edge-data` volume keeps working: Neo4j 2026 opens a database written by 5.26 as-is. New databases default to Cypher 25; the queries edge-context-server runs pass unchanged under it.
