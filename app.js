// app.js
const express = require('express');
require('dotenv').config();
const cors = require("cors");

const healthCheck = require('./controllers/healthchecks');
const userController = require('./controllers/user');
const recipesController = require('./controllers/recipes');
const historicalGameController = require('./controllers/historicalgame');
const activeGameController = require('./controllers/activegame'); 
const moveController = require('./controllers/move');
const profileController = require('./controllers/profile');

const logger = require('./middleware/logger');
const jwtauth = require('./middleware/jwtauth');
const errorHandler = require('./middleware/errorHandler');

const app = express();
const port = process.env.port || 5050;

app.use(logger);
app.use(express.json()); // <-- important for JSON bodies
app.use(cors());
app.use(jwtauth);

app.use('/', healthCheck);
app.use('/', userController); // exposes /signup, /signin, /me
app.use('/', recipesController); // exposes /recipes and /recipes/:id
app.use('/', historicalGameController); // exposes /historicalgames and /historicalgames/:id
app.use('/', activeGameController); // exposes /activegames and /activegames/:id
app.use ('/', moveController); // exposes /activegames/:id/move
app.use('/', profileController); // exposes /profile/active-matches and /profile/historic-matches

app.use(errorHandler);

app.listen(port, () => {
  console.log(`Example app listening on port ${port}`);
});
