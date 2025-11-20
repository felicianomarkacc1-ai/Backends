export interface Subscription {
    id?: number;
    userId: number;
    planType: string;
    startDate: Date;
    endDate: Date;
    status?: 'active' | 'expired' | 'cancelled';
}