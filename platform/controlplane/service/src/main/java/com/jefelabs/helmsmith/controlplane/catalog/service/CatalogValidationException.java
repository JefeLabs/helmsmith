package com.jefelabs.helmsmith.controlplane.catalog.service;

/**
 * A PUT /v1/catalog body failed the flow-spec schema gate (or carried
 * content this endpoint does not manage). Maps to 400 with the harness
 * wire error shape {@code { error }} — same contract the designer's
 * catalog client parses from harness-server.
 */
public class CatalogValidationException extends RuntimeException {
    public CatalogValidationException(String message) {
        super(message);
    }
}
