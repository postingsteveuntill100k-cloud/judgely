const express = require('express');
const path = require('node:path');
const { getDb } = require('./db/database');
const { seed } = require('./db/seeder');
const { authMiddleware } = require('./middleware/auth');

// Import routes
const authRoutes = require('./routes/auth');
const publicRoutes = require('./routes/public');
const submissionRoutes = require('./routes/submissions');
const judgeRoutes = require('./routes/judge');
const organizerRoutes = require('./routes/organizer');
const exportRoutes = require('./routes/export');
const resultsRoutes = require('./routes/results');

const app = express();
const PORT = process.env.PORT || 8080;

// Basic middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Authentication middleware
app.use(authMiddleware);

// Mount API & page routes
app.use(authRoutes);
app.use(publicRoutes);
app.use(submissionRoutes);
app.use(judgeRoutes);
app.use(organizerRoutes);
app.use(exportRoutes);
app.use(resultsRoutes);

// Serve static frontend assets (css, js, assets)
app.use(express.static(path.join(__dirname, '../public')));

// Root route redirects to gallery or serves SPA
app.get('/', (req, res) => {
  res.redirect('/projects');
});

// Global error handler
app.use((err, req, res, next) => {
  console.error('Unhandled server error:', err);
  const status = err.statusCode || 500;
  res.status(status).json({
    error: status === 403 ? 'Forbidden' : (status === 400 ? 'Bad Request' : 'Internal Server Error'),
    message: process.env.NODE_ENV === 'production' ? 'An unexpected error occurred.' : err.message
  });
});

function ensureSeeded() {
  const db = getDb();
  const event = db.prepare('SELECT id FROM events LIMIT 1').get();
  if (!event) {
    console.log('Database empty. Seeding fixtures.json...');
    seed(db);
  }
}

// Auto-seed on load so both server and test imports have data
ensureSeeded();

function startServer(port = PORT) {
  ensureSeeded();

  const server = app.listen(port, () => {
    console.log('================================================================');
    console.log('  JUDGELY — Open-Source Judging Infrastructure');
    console.log(`  Portal listening on http://localhost:${port}`);
    console.log('----------------------------------------------------------------');
    console.log('  DOGFOOD Checker Authentication Headers:');
    console.log('    organizer   : Cookie: session=org_7f2a');
    console.log('    judge_a     : Cookie: session=jdg_a_91bc');
    console.log('    judge_b     : Cookie: session=jdg_b_44de');
    console.log('    participant : Cookie: session=prt_2e88');
    console.log('================================================================');
  });

  return { app, server };
}

if (require.main === module) {
  startServer();
}

module.exports = { app, startServer };
