package com.jefelabs.helmsmith.controlplane.catalog.api.dto;

import com.jefelabs.helmsmith.controlplane.catalog.domain.SkillCategory;
import tools.jackson.databind.JsonNode;

public record SkillCreateRequestDTO(
    String id,
    SkillCategory category,
    String description,
    JsonNode metadata
) {
}
