package com.jefelabs.helmsmith.controlplane.catalog;

import com.jefelabs.helmsmith.controlplane.catalog.domain.Flow;
import com.jefelabs.helmsmith.controlplane.catalog.domain.FlowKind;
import com.jefelabs.helmsmith.controlplane.catalog.api.HarnessCatalogController;
import com.jefelabs.helmsmith.controlplane.catalog.service.FlowSpecCatalogValidator;
import com.jefelabs.helmsmith.controlplane.catalog.service.FlowService;
import com.jefelabs.helmsmith.controlplane.catalog.service.HarnessCatalogService;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import tools.jackson.databind.ObjectMapper;

import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * The harness /v1/catalog wire contract, controlplane-side. Standalone
 * MockMvc (no Spring context, no database): FlowService is mocked, the
 * REAL schema validator runs, and the tenant filter is simulated by the
 * dev-mode defaults the real filter would apply. Asserts the exact wire
 * shapes the flow designer's catalog client parses.
 */
class HarnessCatalogControllerTest {

    private static final ObjectMapper JSON = new ObjectMapper();

    private FlowService flowService;
    private MockMvc mvc;

    @BeforeEach
    void setUp() {
        flowService = mock(FlowService.class);
        var service = new HarnessCatalogService(flowService, new FlowSpecCatalogValidator(), JSON);
        mvc = MockMvcBuilders.standaloneSetup(new HarnessCatalogController(service))
            .addFilters(new com.jefelabs.helmsmith.controlplane.core.tenancy.DevModeTenantContextFilter())
            .build();
    }

    private static Flow storedFlow(String id) {
        return new Flow(
            "dev-org",
            id,
            null,
            FlowKind.WORK,
            null,
            JSON.readTree("""
                [ { "id": "t", "kind": "trigger", "config": { "kind": "manual" } } ]"""),
            JSON.readTree("[]"),
            null,
            null,
            "dev-user",
            "dev-user"
        );
    }

    @Test
    void getAssemblesTheWireCatalogFromStoredFlows() throws Exception {
        when(flowService.listByOrg(eq("dev-org"), org.mockito.ArgumentMatchers.anyInt(), eq(0)))
            .thenReturn(List.of(storedFlow("review-and-ship")));

        mvc.perform(get("/v1/catalog"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.catalog.flows[0].id").value("review-and-ship"))
            .andExpect(jsonPath("$.catalog.flows[0].nodes[0].kind").value("trigger"))
            // Audit fields and null optionals stay OFF the wire.
            .andExpect(jsonPath("$.catalog.flows[0].createdAt").doesNotExist())
            .andExpect(jsonPath("$.catalog.flows[0].description").doesNotExist());
    }

    @Test
    void putValidCatalogUpsertsSoftDeletesStaleAndReportsCount() throws Exception {
        when(flowService.listByOrg(eq("dev-org"), org.mockito.ArgumentMatchers.anyInt(), eq(0)))
            .thenReturn(List.of(storedFlow("stale-flow")));

        String body = """
            { "flows": [ {
                "id": "fresh",
                "nodes": [ { "id": "t", "kind": "trigger", "config": { "kind": "manual" } } ],
                "edges": []
            } ] }""";
        mvc.perform(put("/v1/catalog").contentType("application/json").content(body))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.flowCount").value(1))
            .andExpect(jsonPath("$.warnings").isEmpty());

        ArgumentCaptor<Flow> upserted = ArgumentCaptor.forClass(Flow.class);
        verify(flowService).upsert(upserted.capture());
        assertThat(upserted.getValue().id()).isEqualTo("fresh");
        assertThat(upserted.getValue().orgId()).isEqualTo("dev-org");
        // The payload is the COMPLETE catalog: stored flows it no longer
        // carries are soft-deleted.
        verify(flowService).softDelete("dev-org", "stale-flow", "dev-user");
    }

    @Test
    void putSchemaViolationIs400WithErrorAndNothingStored() throws Exception {
        mvc.perform(put("/v1/catalog").contentType("application/json").content("{}"))
            .andExpect(status().isBadRequest())
            .andExpect(jsonPath("$.error").exists());
        verify(flowService, never()).upsert(any());
        verify(flowService, never()).softDelete(any(), any(), any());
    }

    @Test
    void putWithProductsIs400WithAPointerToTheirOwnApi() throws Exception {
        String body = """
            { "flows": [ { "id": "f",
                "nodes": [ { "id": "t", "kind": "trigger", "config": { "kind": "manual" } } ],
                "edges": [] } ],
              "products": [] }""";
        mvc.perform(put("/v1/catalog").contentType("application/json").content(body))
            .andExpect(status().isBadRequest())
            .andExpect(jsonPath("$.error").value(
                org.hamcrest.Matchers.containsString("/api/catalog/products")));
        verify(flowService, never()).upsert(any());
    }
}
