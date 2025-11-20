import { User } from '../models/User';
import { Payment } from '../models/Payment';
import { Subscription } from '../models/Subscription';

export const validateUser = (user: Partial<User>): string[] => {
  const errors: string[] = [];

  if (!user.email) {
    errors.push('Email is required');
  } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(user.email)) {
    errors.push('Invalid email format');
  }

  if (!user.password) {
    errors.push('Password is required');
  } else if (user.password.length < 6) {
    errors.push('Password must be at least 6 characters long');
  }

  if (!user.firstName?.trim()) {
    errors.push('First name is required');
  }

  if (!user.lastName?.trim()) {
    errors.push('Last name is required');
  }

  return errors;
};

export const validatePayment = (payment: Partial<Payment>): string[] => {
  const errors: string[] = [];

  if (!payment.amount || payment.amount <= 0) {
    errors.push('Valid payment amount is required');
  }

  if (!payment.userId) {
    errors.push('User ID is required');
  }

  if (!payment.subscriptionId) {
    errors.push('Subscription ID is required');
  }

  return errors;
};

export const validateSubscription = (subscription: Partial<Subscription>): string[] => {
  const errors: string[] = [];

  if (!subscription.userId) {
    errors.push('User ID is required');
  }

  if (!subscription.planType) {
    errors.push('Plan type is required');
  }

  if (!subscription.startDate) {
    errors.push('Start date is required');
  }

  if (!subscription.endDate) {
    errors.push('End date is required');
  }

  // Validate that end date is after start date
  if (subscription.startDate && subscription.endDate) {
    const start = new Date(subscription.startDate);
    const end = new Date(subscription.endDate);
    if (end <= start) {
      errors.push('End date must be after start date');
    }
  }

  return errors;
};

export const sanitizeInput = (input: string): string => {
  return input.trim().replace(/[<>&'"]/g, '');
};

export const isValidDate = (date: string): boolean => {
  const parsedDate = new Date(date);
  return parsedDate.toString() !== 'Invalid Date';
};