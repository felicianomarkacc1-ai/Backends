### Step 1: Set Up MySQL Database

1. **Install MySQL**: If you haven't already, install MySQL on your local machine or use a cloud-based MySQL service.

2. **Create a Database**:
   ```sql
   CREATE DATABASE activecore;
   ```

3. **Create a Users Table**:
   ```sql
   USE activecore;

   CREATE TABLE users (
       id INT AUTO_INCREMENT PRIMARY KEY,
       full_name VARCHAR(100) NOT NULL,
       email VARCHAR(100) NOT NULL UNIQUE,
       password VARCHAR(255) NOT NULL,
       plan VARCHAR(50),
       membership_since DATE,
       next_payment DATE,
       total_workouts INT DEFAULT 0,
       avg_duration INT DEFAULT 0,
       calories_burned INT DEFAULT 0,
       attendance_rate DECIMAL(5,2) DEFAULT 0.00
   );
   ```

### Step 2: Set Up Backend API

1. **Create a Node.js Backend**:
   - Create a new directory for your backend and initialize a new Node.js project:
     ```bash
     mkdir activecore-backend
     cd activecore-backend
     npm init -y
     ```

2. **Install Required Packages**:
   ```bash
   npm install express mysql2 bcryptjs jsonwebtoken cors
   ```

3. **Create a Basic Server**:
   Create a file named `server.js` in your backend directory:
   ```javascript
   const express = require('express');
   const mysql = require('mysql2');
   const bcrypt = require('bcryptjs');
   const jwt = require('jsonwebtoken');
   const cors = require('cors');

   const app = express();
   const PORT = process.env.PORT || 5000;

   app.use(cors());
   app.use(express.json());

   // MySQL connection
   const db = mysql.createConnection({
       host: 'localhost',
       user: 'your_username',
       password: 'your_password',
       database: 'activecore'
   });

   db.connect(err => {
       if (err) throw err;
       console.log('MySQL Connected...');
   });

   // Register route
   app.post('/register', async (req, res) => {
       const { full_name, email, password, plan } = req.body;
       const hashedPassword = await bcrypt.hash(password, 10);

       db.query('INSERT INTO users (full_name, email, password, plan) VALUES (?, ?, ?, ?)', 
       [full_name, email, hashedPassword, plan], (err, results) => {
           if (err) return res.status(500).json({ error: err.message });
           res.status(201).json({ message: 'User registered successfully!' });
       });
   });

   // Login route
   app.post('/login', (req, res) => {
       const { email, password } = req.body;

       db.query('SELECT * FROM users WHERE email = ?', [email], async (err, results) => {
           if (err) return res.status(500).json({ error: err.message });
           if (results.length === 0) return res.status(401).json({ message: 'Invalid email or password' });

           const user = results[0];
           const isMatch = await bcrypt.compare(password, user.password);
           if (!isMatch) return res.status(401).json({ message: 'Invalid email or password' });

           const token = jwt.sign({ id: user.id }, 'your_jwt_secret', { expiresIn: '1h' });
           res.json({ token, user: { id: user.id, full_name: user.full_name, email: user.email } });
       });
   });

   app.listen(PORT, () => {
       console.log(`Server running on port ${PORT}`);
   });
   ```

### Step 3: Connect Frontend to Backend

1. **Install Axios**:
   In your Ionic React project, install Axios for making HTTP requests:
   ```bash
   npm install axios
   ```

2. **Update Registration and Login Logic**:
   Modify your `RegisterMember.tsx` and `Home.tsx` (or wherever you handle registration and login) to make API calls to your backend.

   **Example for Registration**:
   ```javascript
   import axios from 'axios';

   const handleRegister = async () => {
       try {
           const response = await axios.post('http://localhost:5000/register', {
               full_name: memberName,
               email: memberEmail,
               password: memberPassword,
               plan: selectedPlan
           });
           alert(response.data.message);
       } catch (error) {
           console.error(error);
           alert('Registration failed');
       }
   };
   ```

   **Example for Login**:
   ```javascript
   const handleLogin = async () => {
       try {
           const response = await axios.post('http://localhost:5000/login', {
               email,
               password
           });
           localStorage.setItem('token', response.data.token);
           // Redirect to member dashboard or wherever
       } catch (error) {
           console.error(error);
           alert('Login failed');
       }
   };
   ```

### Step 4: Test Your Application

1. **Run Your Backend**:
   ```bash
   node server.js
   ```

2. **Run Your Ionic App**:
   ```bash
   npm start
   ```

3. **Test Registration and Login**: Use the registration form to create a new user and then log in with the same credentials.

### Step 5: Deploy Your Application

- Once everything is working locally, consider deploying your backend to a service like Heroku or Vercel and your frontend to Vercel or Netlify.

### Security Considerations

- Ensure to use environment variables for sensitive information like database credentials and JWT secret.
- Implement proper error handling and validation on both frontend and backend.
- Consider using HTTPS for secure data transmission.

This setup provides a basic user registration and login system with a MySQL database. You can expand upon this by adding features like email verification, password reset, and more.