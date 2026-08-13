package com.jefelabs.helmsmith.controlplane.catalog;

import org.junit.jupiter.api.Test;

import java.nio.file.Files;
import java.nio.file.Path;

import static org.assertj.core.api.Assertions.assertThat;
import static org.junit.jupiter.api.Assumptions.assumeTrue;

/**
 * Drift guard, Java half: the checked-in schema resource must be
 * byte-identical to the GENERATED artifact in the flow-spec package
 * (whose own drift guard ties it to the TypeScript types). A monorepo
 * checkout has both files; outside one (e.g. a Docker build context that
 * only carries the service) the source is absent and the check is
 * skipped — the resource is then simply the vendored copy.
 *
 * <p>On failure: {@code cp platform/harness/flow-spec/schema/flow-spec.schema.json
 * platform/controlplane/service/src/main/resources/flow-spec/}.
 */
class SchemaArtifactDriftTest {

    @Test
    void resourceMatchesTheGeneratedArtifact() throws Exception {
        Path source = Path.of("../../harness/flow-spec/schema/flow-spec.schema.json");
        assumeTrue(Files.exists(source), "flow-spec artifact not in build context — vendored copy stands");
        String artifact = Files.readString(source);
        String resource = new String(
            getClass().getResourceAsStream("/flow-spec/flow-spec.schema.json").readAllBytes());
        assertThat(resource)
            .withFailMessage("schema resource drifted from the generated artifact — re-copy it "
                + "(see this test's javadoc)")
            .isEqualTo(artifact);
    }
}
