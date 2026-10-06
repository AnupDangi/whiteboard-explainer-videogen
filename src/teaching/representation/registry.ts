import { createRepresentationProviderRegistry } from './providerRegistry.js';
import { stateTransitionProvider } from './stateTransition.js';

/** Providers are enabled only after their typed model and replay tests pass. */
export const REPRESENTATION_PROVIDER_REGISTRY = createRepresentationProviderRegistry([stateTransitionProvider]);
