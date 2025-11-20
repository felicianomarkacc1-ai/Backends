CREATE DATABASE activecore;

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

   export interface Payment {
    id?: number;
    userId: number;
    amount: number;
    paymentMethod: string;
    membershipType: string;
    subscriptionStart?: string;
    subscriptionEnd?: string;
    paymentDate?: Date;
    paymentStatus?: 'pending' | 'completed' | 'failed' | 'pending_approval';
    transactionId?: string;
    notes?: string;
}

export interface PaymentCreate extends Omit<Payment, 'id' | 'paymentDate'> {
    userId: number;
    amount: number;
}

export interface PaymentUpdate extends Partial<Payment> {
    id: number;
}