import { CLI_TOOL_BLUEPRINT } from './archetypes/cli-tool.js';
import { DATA_PIPELINE_BLUEPRINT } from './archetypes/data-pipeline.js';
import { EVENT_DRIVEN_BLUEPRINT } from './archetypes/event-driven.js';
import { FRONTEND_SPA_BLUEPRINT } from './archetypes/frontend-spa.js';
import { FULLSTACK_WEB_BLUEPRINT } from './archetypes/fullstack-web.js';
import { LIBRARY_SDK_BLUEPRINT } from './archetypes/library-sdk.js';
import { REST_API_BLUEPRINT } from './archetypes/rest-api.js';
import type { ApplicationBlueprint } from './types.js';

export const BLUEPRINTS: Record<string, ApplicationBlueprint> = {
  'rest-api': REST_API_BLUEPRINT,
  'event-driven': EVENT_DRIVEN_BLUEPRINT,
  'cli-tool': CLI_TOOL_BLUEPRINT,
  'data-pipeline': DATA_PIPELINE_BLUEPRINT,
  'frontend-spa': FRONTEND_SPA_BLUEPRINT,
  'fullstack-web': FULLSTACK_WEB_BLUEPRINT,
  'library-sdk': LIBRARY_SDK_BLUEPRINT,
};

export const BLUEPRINT_IDS = Object.keys(BLUEPRINTS);

/**
 * Get a blueprint by ID.
 */
export function getBlueprint(id: string): ApplicationBlueprint | undefined {
  return BLUEPRINTS[id];
}

/**
 * List all available blueprints with summary info.
 */
export function listBlueprints(): Array<{
  id: string;
  name: string;
  appType: string;
  concernCount: number;
  nonNegotiableCount: number;
}> {
  return Object.values(BLUEPRINTS).map((bp) => ({
    id: bp.id,
    name: bp.name,
    appType: bp.appType,
    concernCount: bp.concerns.length,
    nonNegotiableCount: bp.nonNegotiableBundle.length,
  }));
}

/**
 * Get blueprints filtered by application type.
 */
export function getBlueprintsByAppType(appType: string): ApplicationBlueprint[] {
  return Object.values(BLUEPRINTS).filter((bp) => bp.appType === appType);
}
