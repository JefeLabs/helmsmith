package com.jefelabs.helmsmith.controlplane.catalog.service;

import com.jefelabs.helmsmith.controlplane.catalog.domain.Flow;
import com.jefelabs.helmsmith.controlplane.catalog.domain.FlowKind;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;
import tools.jackson.databind.node.ArrayNode;
import tools.jackson.databind.node.ObjectNode;

import java.util.HashSet;
import java.util.List;
import java.util.Set;

/**
 * The harness {@code /v1/catalog} seam, controlplane-side: assemble the
 * org's flows into the unified-catalog wire shape, and replace them
 * wholesale from a designer save. Same wire contract as harness-server's
 * {@code GET/PUT /v1/catalog} — the designer points its proxy at either.
 *
 * <p>Replace semantics mirror the harness: the payload is the complete
 * intended catalog, so flows absent from it are soft-deleted (the
 * designer's save is authoritative, not additive). Writes go through
 * {@link FlowService} so each row change publishes its
 * {@code CatalogChangedEvent} as usual.
 *
 * <p>v1 boundary: this endpoint manages FLOWS. A payload carrying
 * {@code products} is rejected loudly (products have their own CRUD at
 * {@code /api/catalog/products}); silently dropping them would violate
 * the never-ignore-config rule the spec is built on.
 */
@Service
public class HarnessCatalogService {

    /** Effectively-unbounded page for whole-catalog assembly. */
    private static final int ALL_FLOWS = 10_000;

    private final FlowService flowService;
    private final FlowSpecCatalogValidator validator;
    private final ObjectMapper objectMapper;

    public HarnessCatalogService(
        FlowService flowService,
        FlowSpecCatalogValidator validator,
        ObjectMapper objectMapper
    ) {
        this.flowService = flowService;
        this.validator = validator;
        this.objectMapper = objectMapper;
    }

    /** The org's flows in the unified-catalog wire shape: {@code { flows: [FlowDef…] }}. */
    public ObjectNode wireCatalog(String orgId) {
        ObjectNode catalog = objectMapper.createObjectNode();
        ArrayNode flows = catalog.putArray("flows");
        for (Flow flow : flowService.listByOrg(orgId, ALL_FLOWS, 0)) {
            flows.add(wireFlow(flow));
        }
        return catalog;
    }

    /**
     * Validate and store a complete catalog. Returns the stored flow
     * count. Throws {@link CatalogValidationException} (→ 400 with the
     * message) when the body fails the schema gate or carries products.
     */
    @Transactional
    public int replace(String orgId, String rawCatalogJson, String userId) {
        List<String> violations = validator.violations(rawCatalogJson);
        if (!violations.isEmpty()) {
            throw new CatalogValidationException(
                "PUT /v1/catalog: " + String.join("; ", violations));
        }
        JsonNode catalog = objectMapper.readTree(rawCatalogJson);
        if (catalog.has("products")) {
            throw new CatalogValidationException(
                "PUT /v1/catalog: this endpoint manages flows only — products are managed via "
                    + "/api/catalog/products (dropping them silently would violate the catalog contract)");
        }

        Set<String> incoming = new HashSet<>();
        for (JsonNode flowNode : catalog.get("flows")) {
            Flow flow = domainFlow(orgId, flowNode, userId);
            incoming.add(flow.id());
            flowService.upsert(flow);
        }
        // The payload is the complete catalog: flows it no longer carries
        // are gone, not merely unmentioned.
        for (Flow existing : flowService.listByOrg(orgId, ALL_FLOWS, 0)) {
            if (!incoming.contains(existing.id())) {
                flowService.softDelete(orgId, existing.id(), userId);
            }
        }
        return incoming.size();
    }

    /** Domain → wire FlowDef (audit fields stay server-side, absent fields stay absent). */
    private ObjectNode wireFlow(Flow flow) {
        ObjectNode node = objectMapper.createObjectNode();
        node.put("id", flow.id());
        if (flow.description() != null) {
            node.put("description", flow.description());
        }
        if (flow.kind() != null && flow.kind() != FlowKind.WORK) {
            node.put("kind", flow.kind().dbValue());
        }
        if (flow.output() != null && !flow.output().isNull()) {
            node.set("output", flow.output());
        }
        node.set("nodes", flow.nodes());
        node.set("edges", flow.edges());
        return node;
    }

    /** Wire FlowDef → domain. The schema gate already ran, so shapes hold. */
    private Flow domainFlow(String orgId, JsonNode flowNode, String userId) {
        String kindWire = flowNode.has("kind") ? flowNode.get("kind").asString() : "work";
        FlowKind kind = switch (kindWire) {
            case "job-definition" -> FlowKind.JOB_DEFINITION;
            case "post-job" -> FlowKind.POST_JOB;
            default -> FlowKind.WORK;
        };
        return new Flow(
            orgId,
            flowNode.get("id").asString(),
            flowNode.has("description") ? flowNode.get("description").asString() : null,
            kind,
            flowNode.get("output"),
            flowNode.get("nodes"),
            flowNode.get("edges"),
            null,
            null,
            userId,
            userId
        );
    }
}
