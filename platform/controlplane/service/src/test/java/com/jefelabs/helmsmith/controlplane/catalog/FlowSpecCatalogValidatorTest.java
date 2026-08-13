package com.jefelabs.helmsmith.controlplane.catalog;

import com.jefelabs.helmsmith.controlplane.catalog.service.FlowSpecCatalogValidator;
import org.junit.jupiter.api.Test;

import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * The schema-shape gate (catalog PRD §6.3 Phase 2 / flow-spec 3.3):
 * PUT /v1/catalog bodies validate against the GENERATED flow-spec schema
 * artifact's {@code Catalog} definition. These cases mirror the spirit of
 * the TS-side {@code VALIDATION_CASES} at the shape level — semantic
 * rules (cycles, joins, …) deliberately stay TS-side.
 */
class FlowSpecCatalogValidatorTest {

    private final FlowSpecCatalogValidator validator = new FlowSpecCatalogValidator();

    private static final String VALID_CATALOG = """
        { "flows": [ {
            "id": "demo",
            "nodes": [
              { "id": "t", "kind": "trigger", "config": { "kind": "manual" } },
              { "id": "a", "kind": "transform",
                "config": { "expression": { "kind": "literal", "value": 1 } } }
            ],
            "edges": [ { "from": "t", "to": "a", "type": "sequence" } ]
        } ] }""";

    @Test
    void acceptsAMinimalValidCatalog() {
        assertThat(validator.violations(VALID_CATALOG)).isEmpty();
    }

    @Test
    void rejectsAMissingFlowsArray() {
        List<String> v = validator.violations("{}");
        assertThat(v).isNotEmpty();
        assertThat(String.join("; ", v)).contains("flows");
    }

    @Test
    void rejectsAnUnknownNodeKindWithALocatedMessage() {
        String bad = VALID_CATALOG.replace("\"kind\": \"transform\"", "\"kind\": \"banana\"");
        List<String> v = validator.violations(bad);
        assertThat(v).isNotEmpty();
        // The message names the offending location, harness-style.
        assertThat(String.join("; ", v)).contains("nodes");
    }

    @Test
    void rejectsNonJsonBodiesReadably() {
        List<String> v = validator.violations("{nope");
        assertThat(v).hasSize(1);
        assertThat(v.getFirst()).contains("not valid JSON");
    }

    @Test
    void acceptsOptionalTopLevelSectionsTheSchemaKnows() {
        String withProducts = """
            { "flows": [ { "id": "f",
                "nodes": [ { "id": "t", "kind": "trigger", "config": { "kind": "manual" } } ],
                "edges": [] } ],
              "products": [] }""";
        // Products are schema-valid (the service layer rejects them for
        // THIS endpoint with its own message — that is policy, not shape).
        assertThat(validator.violations(withProducts)).isEmpty();
    }
}
