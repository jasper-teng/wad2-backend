require('dotenv').config();

const express = require('express');
const mongoose = require('mongoose');
const healthCheck = require('./controllers/healthchecks');
const logger = require('./middleware/logger');
const cors = require('cors');
const axios = require('axios');
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
app.use(cors({
  origin: 'https://wad2-proj.vercel.app',  // EDITED for quick fix CORS between renderer and Vercel
  methods: ['GET', 'POST'], 
  allowedHeaders: ['Content-Type'], 
}));

// --- ROUTES ---
app.use('/', healthCheck);
app.use('/users', userRoutes);
app.use('/api', apiRoutes);


// Data.sg CORS issue quick fix
const datasetId = 'd_688b934f82c1059ed0a6993d2a829089';
const apiUrl = `https://data.gov.sg/api/action/datastore_search?resource_id=${datasetId}&limit=500`;

app.get('/api/fetch-schools', async (req, res) => {
  try {
    const response = await axios.get(apiUrl); 
    res.json(response.data)
  } catch (error) {
    console.error('Error fetching data:', error);
    res.status(500).json({ error: 'Failed to fetch data' });
  }
});


// REMOVE THIS LINE: app.use(jwtauth);

app.listen(port, () => {
    console.log(`App listening on port ${port}`);
});