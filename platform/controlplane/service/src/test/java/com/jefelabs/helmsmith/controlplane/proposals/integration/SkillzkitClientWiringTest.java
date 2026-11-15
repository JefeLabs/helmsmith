package com.jefelabs.helmsmith.controlplane.proposals.integration;

import com.jefelabs.helmsmith.controlplane.proposals.api.dto.ComposeRequestDTO;
import com.sun.net.httpserver.HttpServer;
import org.junit.jupiter.api.Test;
import org.springframework.boot.autoconfigure.AutoConfigurations;
import org.springframework.boot.jackson.autoconfigure.JacksonAutoConfiguration;
import org.springframework.boot.test.context.runner.ApplicationContextRunner;

import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * The test suite never loads the full application context, so a constructor that asks for a
 * bean Spring Boot does not create fails only at startup. That took the controlplane container
 * down: SkillzkitClient asked for Jackson 2's ObjectMapper, and Spring Boot 4 auto-configures
 * Jackson 3. These tests build the client the way the app does, from Boot's own Jackson
 * auto-configuration.
 */
class SkillzkitClientWiringTest {

    private final ApplicationContextRunner runner = new ApplicationContextRunner()
        .withConfiguration(AutoConfigurations.of(JacksonAutoConfiguration.class))
        .withUserConfiguration(SkillzkitClient.class);

    @Test
    void wiresAgainstSpringBootsAutoConfiguredJsonMapper() {
        runner.run(context -> {
            assertThat(context).hasNotFailed();
            assertThat(context).hasSingleBean(SkillzkitClient.class);
        });
    }

    @Test
    void parsesSkillzkitsErrorEnvelopeWithThatMapper() throws Exception {
        HttpServer server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        server.createContext("/api/v1/contributions", exchange -> {
            byte[] body = """
                {"code":"validation_failed","message":"slug is taken","details":{"field":"slug"}}
                """.getBytes(StandardCharsets.UTF_8);
            exchange.getResponseHeaders().add("Content-Type", "application/json");
            exchange.sendResponseHeaders(422, body.length);
            exchange.getResponseBody().write(body);
            exchange.close();
        });
        server.start();
        try {
            String url = "http://127.0.0.1:" + server.getAddress().getPort();
            runner.withPropertyValues("helmsmith.skillzkit.url=" + url, "helmsmith.skillzkit.token=t")
                .run(context -> {
                    SkillzkitClient client = context.getBean(SkillzkitClient.class);
                    SkillzkitClient.ComposeResult result = client.submitContribution(
                        new ComposeRequestDTO("command", "deploy", Map.of(), List.of(), "patch", "x")
                    );
                    assertThat(result).isEqualTo(new SkillzkitClient.ComposeResult.ApiError(
                        422, "validation_failed", "slug is taken", Map.of("field", "slug")
                    ));
                });
        } finally {
            server.stop(0);
        }
    }
}
