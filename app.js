require('dotenv').config();

const express = require('express');
const mongoose = require('mongoose');
const healthCheck = require('./controllers/healthchecks');
const logger = require('./middleware/logger');
const cors = require('cors');
// No longer need to import jwtauth here
const apiRoutes = require('./routes/api.routes');
const userRoutes = require('./routes/user.routes');

const app = express();
const port = process.env.PORT || 3000;
const MONGO_URI = process.env.MONGO_URI;

// --- DATABASE CONNECTION ---
if (!MONGO_URI) {
    console.error('FATAL ERROR: MONGO_URI is not defined in the .env file.');
    process.exit(1);
}
mongoose.connect(MONGO_URI)
  .then(() => console.log('✅ MongoDB connection successful.'))
  .catch(err => {
    console.error('❌ MongoDB connection error:', err.message);
    process.exit(1);
  });

// --- MIDDLEWARE ---
app.use(express.json());
app.use(logger);
app.use(cors());

// --- ROUTES ---
app.use('/', healthCheck);
app.use('/users', userRoutes);
app.use('/api', apiRoutes);

// REMOVE THIS LINE: app.use(jwtauth);

app.listen(port, () => {
    console.log(`App listening on port ${port}`);
});