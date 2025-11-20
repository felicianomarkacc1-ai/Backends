DROP DATABASE IF EXISTS activecore;
CREATE DATABASE activecore;
USE activecore;

CREATE TABLE users (
    id INT AUTO_INCREMENT PRIMARY KEY,
    email VARCHAR(100) NOT NULL UNIQUE,
    password VARCHAR(255) NOT NULL,
    first_name VARCHAR(100) NOT NULL,
    last_name VARCHAR(100) NOT NULL,
    role ENUM('member', 'admin') DEFAULT 'member',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create test users
INSERT INTO users (email, password, first_name, last_name, role) 
VALUES 
('admin@activecore.com', '$2b$10$xJwq5rkqZ7QY5D8X9yZ9Z.9Y5D8X9yZ9Z.', 'Admin', 'User', 'admin'),
('member@activecore.com', '$2b$10$xJwq5rkqZ7QY5D8X9yZ9Z.9Y5D8X9yZ9Z.', 'Member', 'User', 'member');

-- Attendance table
CREATE TABLE IF NOT EXISTS attendance (
  id INT PRIMARY KEY AUTO_INCREMENT,
  user_id INT NOT NULL,
  check_in_time DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  location VARCHAR(100) DEFAULT 'Main Gym',
  status ENUM('present', 'late') DEFAULT 'present',
  qr_token_id INT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  INDEX idx_user_date (user_id, check_in_time),
  INDEX idx_date (check_in_time)
);

-- QR Attendance Tokens (Admin generates these)
CREATE TABLE IF NOT EXISTS qr_attendance_tokens (
  id INT PRIMARY KEY AUTO_INCREMENT,
  token VARCHAR(255) UNIQUE NOT NULL,
  expires_at DATETIME NOT NULL,
  is_active BOOLEAN DEFAULT 1,
  created_by INT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (created_by) REFERENCES users(id),
  INDEX idx_token (token),
  INDEX idx_expires (expires_at)
);

-- Rewards table
CREATE TABLE IF NOT EXISTS rewards (
  id INT PRIMARY KEY AUTO_INCREMENT,
  title VARCHAR(255) NOT NULL,
  description TEXT,
  required_attendance INT NOT NULL,
  points INT DEFAULT 0,
  category ENUM('product', 'service', 'discount') DEFAULT 'product',
  icon VARCHAR(10) DEFAULT '🎁',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- User claimed rewards
CREATE TABLE IF NOT EXISTS user_rewards (
  id INT PRIMARY KEY AUTO_INCREMENT,
  user_id INT NOT NULL,
  reward_id INT NOT NULL,
  claimed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (reward_id) REFERENCES rewards(id) ON DELETE CASCADE,
  UNIQUE KEY unique_user_reward (user_id, reward_id)
);

-- Add attendance tracking columns to users table
ALTER TABLE users 
ADD COLUMN IF NOT EXISTS attendance_streak INT DEFAULT 0,
ADD COLUMN IF NOT EXISTS last_attendance_date DATE;

-- Insert default rewards
INSERT INTO rewards (title, description, required_attendance, points, category, icon) VALUES
('Free Protein Shake', 'Get a complimentary protein shake from our juice bar', 5, 10, 'product', '🥤'),
('Free Personal Training Session', 'One-on-one session with our certified trainers', 10, 50, 'service', '💪'),
('ActiveCore Water Bottle', 'Premium stainless steel water bottle', 15, 25, 'product', '🍶'),
('20% Off Supplements', 'Discount on all supplement products', 20, 30, 'discount', '💊'),
('Massage Therapy Session', '45-minute relaxation massage session', 25, 75, 'service', '💆'),
('ActiveCore Gym Bag', 'Premium branded gym bag with compartments', 30, 40, 'product', '🎒')
ON DUPLICATE KEY UPDATE title=title;