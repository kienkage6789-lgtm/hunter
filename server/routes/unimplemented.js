const express = require('express');

function createUnimplementedRouter(featureName) {
  const router = express.Router();
  router.all('*', (req, res) => {
    res.status(501).json({
      ok: false,
      error: `Chức năng ${featureName || 'này'} hiện chưa được hỗ trợ trên máy chủ`
    });
  });
  return router;
}

module.exports = {
  createUnimplementedRouter
};
