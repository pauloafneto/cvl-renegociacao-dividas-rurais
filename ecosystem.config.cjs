/**
 * PM2 — Hostinger VPS
 * Uso: pm2 start ecosystem.config.cjs
 */
module.exports = {
  apps: [
    {
      name: "cvl-crm",
      script: "server/index.js",
      cwd: __dirname,
      instances: 1,
      exec_mode: "fork",
      env: {
        NODE_ENV: "production",
        PORT: process.env.PORT || "8787",
      },
      // Disco local: SQLite + uploads + PDFs em ./data (ou CVL_DATA_DIR)
      max_memory_restart: "400M",
      time: true,
    },
  ],
};
