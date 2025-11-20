

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