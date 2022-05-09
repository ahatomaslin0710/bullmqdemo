module.exports = {
  apps: [
    {
      name: 'queue-core',
      script: 'app.js',
      watch: '.',
      env: {
        NODE_ENV: 'dev',
      },
    },
  ],
};
