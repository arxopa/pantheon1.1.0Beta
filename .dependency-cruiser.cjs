module.exports = {
  forbidden: [
    {
      name: 'no-circular',
      severity: 'error',
      from: {},
      to: { circular: true },
    },
    {
      name: 'static-no-server-imports',
      severity: 'error',
      from: { path: '^static/' },
      to: { path: '^server/' },
    },
    {
      name: 'src-no-server-imports',
      severity: 'error',
      from: { path: '^src/' },
      to: { path: '^server/' },
    },
    {
      name: 'runtime-no-test-utils-imports',
      severity: 'error',
      from: { path: '^(server/(?!testing/)|src/|static/)' },
      to: { path: '^server/testing/(?!test-suite\.mjs$)' },
    },
  ],
  options: {
    doNotFollow: {
      path: 'node_modules',
    },
    includeOnly: '^(server|src|static)/',
    tsPreCompilationDeps: true,
    combinedDependencies: true,
    reporterOptions: {
      dot: {
        collapsePattern: 'node_modules/[^/]+',
      },
    },
  },
};
