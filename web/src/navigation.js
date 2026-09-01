const TOP_LEVEL_ROUTES = new Set(['#/', '#/assistant', '#/optimize', '#/notes', '#/monitor'])

export function routeBackTarget(route) {
  if (route.startsWith('#/task/') && route.endsWith('/from-optimizer')) return '#/assistant/mobile-optimizer'
  if (route.startsWith('#/task/') && route.endsWith('/from-optimize')) return '#/optimize'
  if (route.startsWith('#/paint')) return '#/tools'
  if (route.startsWith('#/resume')) return '#/tools'
  if (route.startsWith('#/tools')) return '#/monitor'
  if (route.startsWith('#/assistant/mobile-optimizer') && route.includes('from=optimize')) return '#/optimize'
  if (route.startsWith('#/assistant/')) return '#/assistant'
  return '#/'
}

export function activeTabForRoute(route) {
  if (route.startsWith('#/task/') && route.endsWith('/from-optimizer')) return '#/assistant'
  if (route.startsWith('#/assistant/mobile-optimizer') && route.includes('from=optimize')) return '#/optimize'
  if (route.startsWith('#/task/') && route.endsWith('/from-optimize')) return '#/optimize'
  if (route.startsWith('#/chat/') || route.startsWith('#/task/')) return '#/'
  if (route.startsWith('#/assistant')) return '#/assistant'
  if (route.startsWith('#/optimize')) return '#/optimize'
  if (route.startsWith('#/notes')) return '#/notes'
  if (route.startsWith('#/monitor') || route.startsWith('#/tools') || route.startsWith('#/paint')) return '#/monitor'
  return route
}

export function isTopLevelRoute(route) {
  return TOP_LEVEL_ROUTES.has(route)
}
