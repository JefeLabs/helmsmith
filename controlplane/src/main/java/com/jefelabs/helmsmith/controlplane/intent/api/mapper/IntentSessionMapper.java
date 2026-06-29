package com.jefelabs.helmsmith.controlplane.intent.api.mapper;

import com.jefelabs.helmsmith.controlplane.intent.api.dto.IntentSessionDTO;
import com.jefelabs.helmsmith.controlplane.intent.domain.IntentSession;
import org.mapstruct.Mapper;
import org.mapstruct.ReportingPolicy;

@Mapper(componentModel = "spring", unmappedTargetPolicy = ReportingPolicy.IGNORE)
public interface IntentSessionMapper {

    IntentSessionDTO toDTO(IntentSession domain);
}
