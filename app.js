const express = require('express');
require('dotenv').config();
const healthCheck = require('./controllers/healthchecks');
const logger = require('./middleware/logger');
const app = express();
const port = process.env.port;
const jwtauth = require('./middleware/jwtauth');

app.use(logger);

app.use(jwtauth)

app.use('/', healthCheck);

app.listen(port, () => {
  console.log(`Example app listening on port ${port}`)
});