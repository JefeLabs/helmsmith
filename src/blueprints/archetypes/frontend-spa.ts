import type { ApplicationBlueprint } from '../types.js';

export const FRONTEND_SPA_BLUEPRINT: ApplicationBlueprint = {
  id: 'frontend-spa',
  name: 'Frontend SPA',
  description:
    'Single-page application with client-side routing, state management, error boundaries, and an optimized build pipeline for modern web browsers.',
  appType: 'frontend',

  // --- Context questions for parameterization ---

  contextQuestions: [
    {
      id: 'framework',
      question: 'Which frontend framework will be used?',
      type: 'single-select',
      options: ['react', 'vue', 'svelte', 'angular'],
      default: 'react',
    },
    {
      id: 'state-complexity',
      question: 'What is the complexity of client-side state management?',
      type: 'single-select',
      options: ['simple', 'moderate', 'complex'],
      default: 'moderate',
    },
    {
      id: 'ssr-needed',
      question: 'Is server-side rendering (SSR) needed?',
      type: 'boolean',
      default: false,
    },
    {
      id: 'i18n-needed',
      question: 'Is internationalization (i18n) needed?',
      type: 'boolean',
      default: false,
    },
  ],

  // --- Cross-cutting concerns ---

  concerns: [
    // UPFRONT (non-negotiable)
    {
      id: 'error-boundary',
      title: 'Error boundaries',
      description:
        'Catch and gracefully handle rendering errors in component subtrees, preventing a single component failure from crashing the entire application.',
      category: 'reliability',
      urgency: 'upfront',
      estimatedComplexity: 4,
      requiredSkills: ['frontend'],
      tags: ['concern:reliability', 'layer:ui'],
      implementationGuidance:
        'Implement error boundary components at strategic points in the component tree (layout level, route level, widget level). Display a user-friendly fallback UI with a retry option. Log the error details and component stack to an error tracking service. In React, use componentDidCatch or error boundary libraries; in Vue, use errorCaptured.',
    },
    {
      id: 'routing-setup',
      title: 'Client-side routing',
      description:
        'Configure a client-side router that maps URL paths to views, supports nested routes, and handles navigation guards and not-found states.',
      category: 'core',
      urgency: 'upfront',
      estimatedComplexity: 4,
      requiredSkills: ['frontend'],
      tags: ['concern:core', 'layer:ui'],
      implementationGuidance:
        'Use the framework standard router (React Router, Vue Router, SvelteKit routing, Angular Router). Define routes declaratively with lazy-loaded route components for code splitting. Implement a catch-all 404 route. Add navigation guards for protected routes that redirect unauthenticated users to login.',
    },
    {
      id: 'state-management',
      title: 'State management',
      description:
        'Establish a predictable state management pattern that separates UI state, server cache, and application state with clear data flow.',
      category: 'architecture',
      urgency: 'upfront',
      estimatedComplexity: 5,
      requiredSkills: ['frontend'],
      tags: ['concern:architecture', 'layer:ui'],
      implementationGuidance:
        'Separate concerns: use component-local state for UI-only state, a server cache layer (React Query, SWR, Apollo) for remote data, and a global store (Zustand, Pinia, Redux) only for truly shared application state. Avoid putting everything in a single global store. Define clear boundaries for what belongs in each layer.',
    },
    {
      id: 'build-pipeline',
      title: 'Build pipeline',
      description:
        'Configure the build toolchain for development (hot reload, source maps) and production (minification, tree-shaking, code splitting).',
      category: 'tooling',
      urgency: 'upfront',
      estimatedComplexity: 4,
      requiredSkills: ['frontend', 'tooling'],
      tags: ['concern:tooling', 'layer:infra'],
      implementationGuidance:
        'Use a modern bundler (Vite, webpack, or Turbopack) with framework-specific plugins. Configure separate dev and production builds. Enable source maps in development, disable in production. Set up code splitting at route boundaries. Configure asset hashing for cache busting and a public path for CDN deployment.',
    },
    {
      id: 'accessibility-basics',
      title: 'Accessibility basics',
      description:
        'Ensure the application meets WCAG 2.1 Level AA standards with semantic HTML, keyboard navigation, focus management, and ARIA attributes.',
      category: 'accessibility',
      urgency: 'upfront',
      estimatedComplexity: 5,
      requiredSkills: ['frontend', 'accessibility'],
      tags: ['concern:accessibility', 'layer:ui'],
      implementationGuidance:
        'Use semantic HTML elements (nav, main, article, button) instead of generic divs. Ensure all interactive elements are keyboard-accessible with visible focus indicators. Add ARIA labels to icons and non-text content. Manage focus on route changes and modal opens. Integrate an accessibility linter (eslint-plugin-jsx-a11y or axe-core) into the build pipeline.',
    },

    // PATTERN-FIRST
    {
      id: 'loading-states',
      title: 'Loading states',
      description:
        'Display appropriate loading indicators during data fetching, route transitions, and lazy component loading to provide user feedback.',
      category: 'usability',
      urgency: 'pattern-first',
      estimatedComplexity: 3,
      requiredSkills: ['frontend'],
      tags: ['concern:usability', 'layer:ui'],
      implementationGuidance:
        'Create reusable loading skeleton components that match the layout of the content they replace. Show loading indicators for data fetches longer than 200ms to avoid flickering. Use Suspense boundaries (React) or async components (Vue) for code-split chunks. Implement optimistic UI updates for mutations to reduce perceived latency.',
    },
    {
      id: 'form-validation',
      title: 'Form validation',
      description:
        'Validate form inputs on the client side with real-time feedback, supporting complex validation rules and accessible error messages.',
      category: 'usability',
      urgency: 'pattern-first',
      estimatedComplexity: 4,
      requiredSkills: ['frontend'],
      tags: ['concern:usability', 'layer:ui'],
      implementationGuidance:
        'Use a form library (React Hook Form, Formik, VeeValidate) with schema-based validation (Zod, Yup). Validate on blur for individual fields and on submit for the full form. Display inline error messages associated with their fields using aria-describedby. Share validation schemas with the backend when possible.',
    },
    {
      id: 'auth-flow',
      title: 'Authentication flow',
      description:
        'Implement login, logout, and session management with token storage, automatic refresh, and protected route enforcement.',
      category: 'security',
      urgency: 'pattern-first',
      estimatedComplexity: 6,
      requiredSkills: ['frontend', 'security'],
      tags: ['concern:security', 'layer:ui'],
      implementationGuidance:
        'Store auth tokens in httpOnly cookies (preferred) or in-memory (never localStorage for sensitive tokens). Implement an auth context that provides the current user and login/logout functions. Add an HTTP interceptor that attaches the token to API requests and handles 401 responses with automatic token refresh. Redirect unauthenticated users to the login page via route guards.',
    },
    {
      id: 'responsive-design',
      title: 'Responsive design',
      description:
        'Ensure the application adapts to different screen sizes and devices using responsive layout patterns and mobile-first CSS.',
      category: 'usability',
      urgency: 'pattern-first',
      estimatedComplexity: 4,
      requiredSkills: ['frontend', 'css'],
      tags: ['concern:usability', 'layer:ui'],
      implementationGuidance:
        'Use a mobile-first approach: define base styles for mobile and add breakpoints for larger screens. Use CSS Grid and Flexbox for layouts that naturally adapt. Define a consistent set of breakpoints (e.g., sm/md/lg/xl) and use them across all components. Test on real devices and use Chrome DevTools device emulation during development.',
    },
    {
      id: 'bundle-optimization',
      title: 'Bundle optimization',
      description:
        'Analyze and optimize the JavaScript bundle size by identifying large dependencies, enabling tree-shaking, and implementing dynamic imports.',
      category: 'performance',
      urgency: 'pattern-first',
      estimatedComplexity: 5,
      requiredSkills: ['frontend', 'performance'],
      tags: ['concern:performance', 'layer:infra'],
      implementationGuidance:
        'Run a bundle analyzer (webpack-bundle-analyzer, rollup-plugin-visualizer) to identify large dependencies. Replace heavy libraries with lighter alternatives where possible. Use dynamic imports for routes and large feature modules. Set a bundle size budget and fail the build if it is exceeded. Enable gzip or brotli compression on the server.',
    },
    {
      id: 'e2e-testing',
      title: 'End-to-end testing',
      description:
        'Establish E2E tests that validate critical user flows through the full application stack, catching integration issues that unit tests miss.',
      category: 'testing',
      urgency: 'pattern-first',
      estimatedComplexity: 5,
      requiredSkills: ['frontend', 'testing'],
      tags: ['concern:testing', 'layer:tests'],
      implementationGuidance:
        'Use Playwright or Cypress for browser-based E2E tests. Cover the critical user journeys: login, core CRUD flows, error scenarios. Use page object patterns to keep tests maintainable. Run E2E tests in CI against a stable test environment. Keep the E2E suite fast by testing happy paths and key error paths, not exhaustive combinations.',
    },

    // DEFERRED
    {
      id: 'design-system',
      title: 'Design system',
      description:
        'Build a reusable component library with consistent styling, theming support, and documentation for shared use across the application.',
      category: 'architecture',
      urgency: 'deferred',
      estimatedComplexity: 7,
      requiredSkills: ['frontend', 'design'],
      tags: ['concern:architecture', 'layer:ui'],
      implementationGuidance:
        'Start with a small set of foundational components (Button, Input, Card, Modal) following a consistent API pattern. Use design tokens (colors, spacing, typography) for theming. Document components with Storybook or a similar tool. Enforce usage of design system components via linting rules that discourage raw HTML elements for common patterns.',
    },
    {
      id: 'analytics-integration',
      title: 'Analytics integration',
      description:
        'Integrate an analytics platform to track page views, user interactions, and conversion funnels for product insight and optimization.',
      category: 'observability',
      urgency: 'deferred',
      estimatedComplexity: 4,
      requiredSkills: ['frontend'],
      tags: ['concern:observability', 'layer:ui'],
      implementationGuidance:
        'Create an analytics abstraction layer that wraps the analytics provider SDK (Google Analytics, Mixpanel, PostHog). Track page views on route changes automatically. Define a standard event taxonomy for user interactions. Respect user privacy preferences (cookie consent, do-not-track). Load the analytics script asynchronously to avoid blocking rendering.',
    },
    {
      id: 'pwa-support',
      title: 'Progressive web app support',
      description:
        'Add service workers, a web app manifest, and offline caching to enable installation on devices and basic offline functionality.',
      category: 'usability',
      urgency: 'deferred',
      estimatedComplexity: 5,
      requiredSkills: ['frontend'],
      tags: ['concern:usability', 'layer:infra'],
      implementationGuidance:
        'Register a service worker using Workbox or the framework PWA plugin. Configure a cache-first strategy for static assets and a network-first strategy for API calls. Add a web app manifest with icons, theme color, and display mode. Implement an update prompt when a new service worker version is available.',
    },
    {
      id: 'seo-meta',
      title: 'SEO and meta tags',
      description:
        'Manage document titles, meta descriptions, Open Graph tags, and structured data for search engine visibility and social media previews.',
      category: 'usability',
      urgency: 'deferred',
      estimatedComplexity: 3,
      requiredSkills: ['frontend'],
      tags: ['concern:usability', 'layer:ui'],
      implementationGuidance:
        'Use a head management library (React Helmet, Vue Meta, svelte:head) to set page-specific titles and meta tags. Define default meta tags at the app level and override them per route. Add Open Graph and Twitter Card tags for social sharing. For SPAs without SSR, consider prerendering critical pages for search engine crawlers.',
    },
  ],

  // --- Conditional rules for context-driven adjustments ---

  conditionalRules: [
    {
      questionId: 'state-complexity',
      answerEquals: 'complex',
      addConcerns: ['design-system'],
      promoteToUrgency: 'pattern-first',
    },
    {
      questionId: 'ssr-needed',
      answerEquals: true,
      addConcerns: ['seo-meta'],
      promoteToUrgency: 'upfront',
    },
    {
      questionId: 'i18n-needed',
      answerEquals: true,
      addConcerns: ['loading-states'],
      promoteToUrgency: 'upfront',
    },
  ],

  // --- Non-negotiable concerns that must always be addressed upfront ---

  nonNegotiableBundle: [
    'error-boundary',
    'routing-setup',
    'state-management',
    'build-pipeline',
    'accessibility-basics',
  ],

  // --- Detection hints for auto-detecting this archetype from a codebase ---

  detectionHints: {
    patterns: ['frontend-framework', 'SPA'],
    frameworks: [
      'framework:react',
      'framework:vue',
      'framework:svelte',
      'framework:angular',
      'framework:next',
      'framework:nuxt',
    ],
    capabilities: [],
    fileIndicators: [
      'src/components/',
      'src/pages/',
      'src/views/',
      'public/',
      'src/App.tsx',
    ],
    weight: 0.8,
  },
};
