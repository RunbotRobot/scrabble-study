'use strict';

const express = require('express');
const study = require('../study');

const router = express.Router();

router.post('/words/add-random', (req, res) => {
  const result = study.addRandomWord();
  if (!result.ok) return res.status(409).json(result);
  res.json(result);
});

router.get('/study/next', (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 1, 50);
  res.json(study.getNextDue(limit));
});

router.post('/study/:id/answer', (req, res) => {
  const id = Number(req.params.id);
  const { correct } = req.body || {};
  if (typeof correct !== 'boolean') {
    return res.status(400).json({ error: 'body must include boolean "correct"' });
  }
  const updated = study.answerCard(id, correct);
  if (!updated) return res.status(404).json({ error: 'card not found' });
  res.json(updated);
});

router.get('/stats', (req, res) => {
  res.json(study.getStats());
});

router.get('/words/recent', (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 25, 200);
  res.json(study.getRecentWords(limit));
});

module.exports = router;
