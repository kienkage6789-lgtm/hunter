const express = require('express');

const router = express.Router();

router.post('/', (req, res) => {
  const { text } = req.body;
  res.json({ ok: true, text: text || '' });
});

module.exports = router;
