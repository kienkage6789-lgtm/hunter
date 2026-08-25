const express = require('express');

const router = express.Router();

router.get('/', (req, res) => {
  res.json({ ok: true, online_count: 168 });
});

module.exports = router;
