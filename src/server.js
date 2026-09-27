const express = require('express');
const path = require('node:path');
const { getDb } = require('./db/database');
const { seed } = require('./db/seeder');
const { authMiddleware } = require('./middleware/auth');

// Import routes
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

// Serve static frontend assets
app.use(express.static(path.join(__dirname, '../public')));

// Authentication middleware
app.use(authMiddleware);

// Mount API & page routes
app.use(publicRoutes);
app.use(submissionRoutes);
app.use(judgeRoutes);
app.use(organizerRoutes);
app.use(exportRoutes);
app.use(resultsRoutes);

// Root route redirects to gallery or serves SPA
app.get('/', (req, res) => {
  res.redirect('/projects');
});

// Current user state endpoint for frontend role switcher
app.get('/api/auth/me', (req, res) => {
  res.json({ user: req.user || { role: 'visitor' } });
});

// Global error handler
app.use((err, req, res, next) => {
  console.error('Unhandled server error:', err);
  res.status(500).json({
    error: 'Internal Server Error',
    message: process.env.NODE_ENV === 'production' ? 'An unexpected error occurred.' : err.message
  });
});

function startServer(port = PORT) {
  // Ensure database exists and is seeded with fixtures.json
  const db = getDb();
  const event = db.prepare('SELECT id FROM events WHERE id = ?').get('evt_01');
  if (!event) {
    console.log('Database empty. Seeding fixtures.json...');
    seed(db);
  }

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
