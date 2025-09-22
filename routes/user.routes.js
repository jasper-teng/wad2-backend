const express = require('express');
const router = express.Router();
const userController = require('../controllers/user.controller');
const jwtauth = require('../middleware/jwtauth'); // 1. Import the middleware

// Public routes for signup and signin
router.post('/signup', userController.signup);
router.post('/signin', userController.signin);

// Protected route to get user info
// 2. Add 'jwtauth' middleware here
router.get('/me', jwtauth, userController.getMe);

module.exports = router;