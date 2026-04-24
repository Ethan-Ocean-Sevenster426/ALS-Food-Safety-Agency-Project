const express = require('express');
const cors = require('cors');
require('dotenv').config();

const authRoutes = require('./routes/auth');
const clientRoutes = require('./routes/clients');
const inviteRoutes = require('./routes/invites');
const companyRoutes = require('./routes/company');
const epvRoutes = require('./routes/epv');
const supportRoutes = require('./routes/support');
const dashboardRoutes = require('./routes/dashboard');
const invoiceRoutes = require('./routes/invoices');
const adminRoutes = require('./routes/admin');
const manualRoutes = require('./routes/manuals');
const { startEPVScheduler } = require('./jobs/epvScheduler');

const app = express();
const PORT = process.env.PORT || 5000;

// Middleware
app.use(cors());
app.use(express.json());

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/clients', clientRoutes);
app.use('/api/invites', inviteRoutes);
app.use('/api/company', companyRoutes);
app.use('/api/epv', epvRoutes);
app.use('/api/support', supportRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/invoices', invoiceRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/manuals', manualRoutes);

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok' });
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
  startEPVScheduler();
});
