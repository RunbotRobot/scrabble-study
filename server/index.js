'use strict';

const path = require('node:path');
const express = require('express');
const apiRouter = require('./routes/api');

const app = express();
app.use(express.json());
app.use('/api', apiRouter);
app.use(express.static(path.join(__dirname, '..', 'public')));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Scrabble study app listening on http://localhost:${PORT}`);
});
