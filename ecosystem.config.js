module.exports = {
  apps: [{
    name: 'reviewer',
    script: 'src/index.ts',
    interpreter: 'bun',
    env: {
      NODE_ENV: 'production'
    },
    max_memory_restart: '512M',
    error_file: './logs/error.log',
    out_file: './logs/out.log',
    merge_logs: true
  }]
};
