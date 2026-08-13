package com.jefelabs.helmsmith.controlplane.catalog.api;

import com.jefelabs.helmsmith.controlplane.catalog.service.CatalogValidationException;
import com.jefelabs.helmsmith.controlplane.catalog.service.HarnessCatalogService;
import com.jefelabs.helmsmith.controlplane.core.tenancy.TenantContext;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;
import java.util.Map;

/**
 * The harness {@code /v1/catalog} wire contract, served by the
 * controlplane — deliberately OUTSIDE the {@code /api} prefix so the flow
 * designer's proxy can point at this service instead of a harness with
 * zero client changes (the seam promised in flow-spec's save-to-server
 * slice: same wire shape, different base URL).
 *
 * <p>GET returns {@code { catalog }}; PUT validates against the generated
 * flow-spec schema artifact and responds {@code { flowCount, warnings }}
 * (warnings always empty here — unsupported-feature reporting runs at
 * harness load, where the TS validator lives). Validation failures are
 * 400 {@code { error }} with the pointer-located message.
 */
@RestController
@RequestMapping("/v1/catalog")
public class HarnessCatalogController {

    private final HarnessCatalogService harnessCatalogService;

    public HarnessCatalogController(HarnessCatalogService harnessCatalogService) {
        this.harnessCatalogService = harnessCatalogService;
    }

    @GetMapping
    public ResponseEntity<Object> get() {
        var tenant = TenantContext.current();
        var catalog = harnessCatalogService.wireCatalog(tenant.orgId());
        return ResponseEntity.ok(Map.of("catalog", catalog));
    }

    @PutMapping
    public ResponseEntity<Object> put(@RequestBody String rawCatalogJson) {
        var tenant = TenantContext.current();
        int flowCount = harnessCatalogService.replace(tenant.orgId(), rawCatalogJson, tenant.userId());
        return ResponseEntity.ok(Map.of("flowCount", flowCount, "warnings", List.of()));
    }

    @ExceptionHandler(CatalogValidationException.class)
    public ResponseEntity<Object> onValidationFailure(CatalogValidationException e) {
        return ResponseEntity.badRequest().body(Map.of("error", e.getMessage()));
    }
}
