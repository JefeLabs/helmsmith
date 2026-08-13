package com.jefelabs.helmsmith.controlplane.catalog.service;

import com.networknt.schema.JsonSchema;
import com.networknt.schema.JsonSchemaFactory;
import com.networknt.schema.SchemaLocation;
import com.networknt.schema.SchemaValidatorsConfig;
import com.networknt.schema.SpecVersion;
import com.networknt.schema.ValidationMessage;
import org.springframework.stereotype.Component;

import java.io.IOException;
import java.io.InputStream;
import java.io.UncheckedIOException;
import java.util.List;
import java.util.Set;

/**
 * Write-time flow-spec validation (catalog PRD §6.3 Phase 2 / flow-spec
 * roadmap 3.3): validates a unified-catalog JSON document against the
 * {@code Catalog} definition of the GENERATED schema artifact
 * ({@code flow-spec/flow-spec.schema.json}, checked in as a resource and
 * drift-guarded against the source artifact by
 * {@code SchemaArtifactDriftTest}).
 *
 * <p>This is deliberately a SCHEMA-SHAPE gate, not a reimplementation of
 * the TypeScript validator: semantic rules (cycles, join guarantees,
 * shadowed error edges, …) stay single-sourced in
 * {@code @helmsmith/flow-spec} and run when the harness loads the catalog
 * — reimplementing them in Java is exactly the drift machine the original
 * design review warned about. Likewise, unsupported-feature WARNINGS
 * ({@code expression-js}, {@code subflow-version-pin}) are computed at
 * harness load, never here.
 *
 * <p>Self-contained on Jackson 2: networknt's validator consumes
 * {@code com.fasterxml} nodes, while the rest of this service speaks
 * Jackson 3 ({@code tools.jackson}). This component accepts the raw JSON
 * string and keeps the Jackson 2 surface private to itself.
 */
@Component
public class FlowSpecCatalogValidator {

    private static final String SCHEMA_RESOURCE = "/flow-spec/flow-spec.schema.json";

    private final JsonSchema catalogSchema;

    public FlowSpecCatalogValidator() {
        JsonSchemaFactory factory = JsonSchemaFactory.getInstance(SpecVersion.VersionFlag.V7);
        SchemaValidatorsConfig config = SchemaValidatorsConfig.builder().build();
        try (InputStream in = FlowSpecCatalogValidator.class.getResourceAsStream(SCHEMA_RESOURCE)) {
            if (in == null) {
                throw new IllegalStateException("schema resource missing: " + SCHEMA_RESOURCE);
            }
            // Load the artifact once, then bind the Catalog definition as
            // the validation root (the artifact's own root is the
            // FlowSpecSchemaRoots envelope of every wire shape).
            this.catalogSchema = factory
                .getSchema(SchemaLocation.of("classpath:" + SCHEMA_RESOURCE + "#/definitions/Catalog"), config);
        } catch (IOException e) {
            throw new UncheckedIOException(e);
        }
    }

    /**
     * Validates the raw JSON body of a PUT /v1/catalog request. Returns an
     * empty list when the document conforms to the {@code Catalog} shape;
     * otherwise one human-readable, JSON-pointer-located message per
     * violation (the harness convention: reject with the exact spot).
     */
    public List<String> violations(String rawCatalogJson) {
        Set<ValidationMessage> messages;
        try {
            messages = catalogSchema.validate(
                new com.fasterxml.jackson.databind.ObjectMapper().readTree(rawCatalogJson));
        } catch (com.fasterxml.jackson.core.JacksonException e) {
            return List.of("body is not valid JSON: " + e.getOriginalMessage());
        }
        return messages.stream().map(ValidationMessage::getMessage).sorted().toList();
    }
}
